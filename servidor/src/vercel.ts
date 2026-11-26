// El tablero online (Vercel, 24/11/2026): la misma app que en la computadora, con estas diferencias:
//   · la base es Postgres (Supabase del juego, esquema `tablero`): TABLERO_DB_URL;
//   · los archivos van a la base (almacenBase): Vercel no tiene disco propio;
//   · los eventos en vivo se anotan en la base y la web pregunta cada pocos segundos (no hay un proceso que viva siempre);
//   · hay que entrar con la cuenta del juego (TABLERO_PUBLICO=1, ver sesion.ts) o mandar la clave del MCP (TABLERO_CLAVE).
// Las migraciones NO corren acá: se aplican aparte con el usuario dueño del esquema (README, "Online").
// Se arma una vez por proceso (Vercel reutiliza el proceso entre pedidos) y la base se abre con el primer pedido.
import { Hono } from 'hono'
import { crearApp, type Estado } from './api'
import { almacenBase, CUENTA_DUENO } from './datos/almacen'
import { abrirConexion } from './datos/conexion'
import { Servicio } from './dominio/servicio'
import { conectarIA } from './ia/conectar'
import { BusEventos } from './eventos'
import { sembrar } from './semilla'

export function crearAppOnline() {
  const estado: Estado = {
    servicio: null,
    clave: process.env.TABLERO_CLAVE || '',
    bus: new BusEventos(),
    listo: Promise.resolve(),
  }
  let arranque: Promise<void> | null = null
  const arrancar = () =>
    (arranque ??= (async () => {
      const url = process.env.TABLERO_DB_URL
      if (!url) throw new Error('Falta TABLERO_DB_URL.')
      const db = await abrirConexion({ urlPostgres: url, carpetaPglite: '' })
      const bus = new BusEventos(db)
      const servicio = new Servicio(db, bus, almacenBase(db))
      conectarIA(servicio)
      await sembrar(servicio.de(CUENTA_DUENO), (m) => console.log(`[tablero] ${m}`))
      estado.bus = bus
      estado.servicio = servicio
    })().catch((e) => {
      arranque = null   // el próximo pedido lo vuelve a intentar
      throw e
    }))

  const app = crearApp(estado, { produccion: true })
  const raiz = new Hono()
  raiz.use('*', async (c, next) => {
    try {
      await arrancar()
    } catch (e) {
      console.error('[tablero] no pude abrir la base:', e instanceof Error ? e.message : e)
      return c.json({ error: 'El tablero no pudo conectarse a la base. Probá de nuevo en un rato.' }, 503)
    }
    await next()
  })
  raiz.route('/', app)
  return raiz
}
