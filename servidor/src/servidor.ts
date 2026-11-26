// Arranque del servidor. Orden importante: primero se toma el puerto y recién
// después se abre la base. Así el puerto hace de candado: un solo proceso abre
// .datos/pg (PGlite no admite dos procesos a la vez), y los demás (otro
// `npm run dev`, `npm run mcp`, el importador) le hablan a ese por HTTP.
import { existsSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createAdaptorServer } from '@hono/node-server'
import { asegurarCarpetas, config, leerClave, rutas, urlServidor } from './config'
import { crearApp, type Estado } from './api'
import { almacenCarpeta, CUENTA_DUENO } from './datos/almacen'
import { abrirConexion, type Conexion } from './datos/conexion'
import { migrar } from './datos/migraciones'
import { Servicio } from './dominio/servicio'
import { conectarIA } from './ia/conectar'
import { BusEventos } from './eventos'
import { importarDiscord } from './importar/discord-logica'
import { sembrar } from './semilla'

export class PuertoOcupado extends Error {}

export interface ServidorEnMarcha {
  servicio: Servicio
  cerrar: () => Promise<void>
}

export async function iniciarServidor(op: {
  produccion?: boolean
  desarrollo?: boolean
  log?: (m: string) => void
}): Promise<ServidorEnMarcha> {
  const log = op.log ?? ((m: string) => console.error(`[tablero] ${m}`))
  asegurarCarpetas()
  const bus = new BusEventos()
  let avisarListo!: () => void
  let fallar!: (e: unknown) => void
  const estado: Estado = {
    servicio: null,
    clave: leerClave(),
    bus,
    listo: new Promise<void>((ok, mal) => {
      avisarListo = ok
      fallar = mal
    }),
  }
  estado.listo.catch(() => {})
  const app = crearApp(estado, { produccion: Boolean(op.produccion), desarrollo: Boolean(op.desarrollo) })
  const servidor = createAdaptorServer({ fetch: app.fetch })

  await new Promise<void>((ok, mal) => {
    const alFallar = (e: NodeJS.ErrnoException) => {
      servidor.off('listening', alEscuchar)
      if (e.code === 'EADDRINUSE') mal(new PuertoOcupado(`El puerto ${config.puerto} está ocupado.`))
      else mal(e)
    }
    const alEscuchar = () => {
      servidor.off('error', alFallar)
      ok()
    }
    servidor.once('error', alFallar)
    servidor.once('listening', alEscuchar)
    servidor.listen(config.puerto, config.host)
  })

  let db: Conexion
  try {
    db = await abrirConexion({ urlPostgres: config.urlBaseDeDatos, carpetaPglite: rutas.pg })
    await migrar(db, config.migraciones, log)
    // TABLERO_EVENTOS_EN_BASE=1: los eventos también se anotan en la base, como online (lo usa la prueba de cuentas para
    // probar /api/eventos/desde sin Vercel). Si no, solo en memoria (SSE).
    const busFinal = process.env.TABLERO_EVENTOS_EN_BASE === '1' ? new BusEventos(db) : bus
    estado.bus = busFinal
    const servicio = new Servicio(db, busFinal, almacenCarpeta(rutas.archivos))
    conectarIA(servicio)
    // Lo de siempre (la semilla y lo que llega de Discord) es de la cuenta 'dueno'.
    const dueno = servicio.de(CUENTA_DUENO)
    const sembrado = await sembrar(dueno, log)
    if (sembrado && config.semillaDiscord && config.semillaDiscord !== 'no' && existsSync(config.semillaDiscord)) {
      try {
        const inf = await importarDiscord(dueno, config.semillaDiscord)
        log(`pendientes de Discord importados: ${inf.nuevas} tarjetas, ${inf.adjuntos} adjuntos`)
      } catch (e) {
        log(`no pude importar los pendientes de Discord: ${(e as Error).message}`)
      }
    }
    estado.servicio = servicio
    avisarListo()
  } catch (e) {
    fallar(e)
    servidor.close()
    throw e
  }

  const direccion = servidor.address() as AddressInfo
  log(`listo en ${urlServidor()} (base: ${db.tipo === 'pglite' ? rutas.pg : 'Postgres'}, puerto ${direccion.port})`)

  let cerrado = false
  return {
    servicio: estado.servicio!,
    async cerrar() {
      if (cerrado) return
      cerrado = true
      await new Promise<void>((r) => {
        servidor.close(() => r())
        // Las conexiones de eventos en vivo quedan abiertas: se cortan.
        ;(servidor as any).closeAllConnections?.()
      })
      await db.cerrar()
    },
  }
}

/** ¿Hay un tablero escuchando en el puerto? */
export async function hayTablero(): Promise<boolean> {
  try {
    const r = await fetch(`${urlServidor()}/api/salud`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return false
    const j = (await r.json()) as { app?: string }
    return j.app === 'tablero'
  } catch {
    return false
  }
}
