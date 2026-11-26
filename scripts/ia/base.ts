// Herramientas para `npm run ia:probar` sobre la base DESCARTABLE de la prueba (una carpeta temporal «telar-…»): sembrar agentes (con su
// miembro, una clave «prueba-…» sellada con la bóveda de verdad —el mismo secreto que el Telar de la prueba, en TABLERO_SECRETO— y su configuración),
// agregar una clave suelta (`clave`) y correr un SQL suelto (por ejemplo, vencerle el préstamo a un trabajo cuando
// el proceso que lo tenía se cortó a propósito). PGlite es de un solo proceso: el Telar de la prueba tiene que estar APAGADO mientras esto corre.
// Se niega a tocar otra cosa que una carpeta temporal (nunca la .datos/ del dueño) y no sale a ninguna red.
//
//   npx tsx scripts/ia/base.ts agentes <carpeta> <cuenta> '<json: [{ nombre, guion, permisos?, confirmar?, topeMesUsd?, ... }]>'
//   npx tsx scripts/ia/base.ts clave <carpeta> <cuenta> <idDeLaClave>
//   npx tsx scripts/ia/base.ts sql <carpeta> '<sql>' ['<parámetro>' ...]
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrirPglite } from '../../servidor/src/datos/pglite'
import { sellar } from '../../servidor/src/ia/boveda'
import { migrar } from '../../servidor/src/datos/migraciones'
import { nuevoId } from '../../servidor/src/dominio/servicio'
import { normalizarAlias } from '../../compartido/menciones'

const [orden, carpeta, ...resto] = process.argv.slice(2)
if (!orden || !carpeta) throw new Error('Uso: base.ts agentes|sql <carpeta> …')
const abs = path.resolve(carpeta)
if (!abs.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(abs).startsWith('telar-')) throw new Error('Solo toca una carpeta temporal de prueba (telar-…).')
if (!existsSync(path.join(abs, 'pg'))) throw new Error('No hay una base en esa carpeta.')

interface Especificacion {
  nombre: string
  guion: string
  permisos?: string[]
  confirmar?: 'nunca' | 'peligrosas' | 'siempre'
  topeMesUsd?: number
  puedeMencionarIA?: boolean
  autonomia?: 'sugiere' | 'actua'
  disparadores?: Record<string, unknown>
  sinClave?: boolean
  claveEstado?: 'valida' | 'invalida' | 'sin_probar'
  activo?: boolean
}

/** La clave de mentira del proveedor falso (empieza con «prueba-»): se sella con la bóveda de verdad. */
const CLAVE_DE_PRUEBA = 'prueba-clave-de-la-bóveda-de-la-prueba-0123456789'
async function insertarClave(db: Awaited<ReturnType<typeof abrirPglite>>, cuenta: string, id: string, nombre: string, estado: string): Promise<void> {
  const s = sellar(CLAVE_DE_PRUEBA, { propietario: cuenta, id })
  await db.consulta(`insert into ia_claves (id, propietario, proveedor, nombre, cifrada, version, ultimos4, estado) values ($1, $2, 'falso', $3, $4, $5, $6, $7)`, [id, cuenta, nombre, Buffer.from(s.cifrada), s.version, s.ultimos4, estado])
}

const db = await abrirPglite(path.join(abs, 'pg'))
try {
  await migrar(db, path.resolve(import.meta.dirname, '..', '..', 'supabase', 'migrations'))
  if (orden === 'agentes') {
    const [cuenta, json] = resto as [string, string]
    const salida: Record<string, { id: string; alias: string }> = {}
    for (const e of JSON.parse(json) as Especificacion[]) {
      const id = nuevoId()
      const alias = normalizarAlias(e.nombre)
      await db.consulta(`insert into miembros (id, nombre, tipo, color, iniciales, propietario, alias) values ($1, $2, 'ia', 'violeta', $3, $4, $5)`, [id, e.nombre, e.nombre.slice(0, 2).toUpperCase(), cuenta, alias])
      let claveId: string | null = null
      if (!e.sinClave) {
        claveId = `k_${nuevoId()}`
        await insertarClave(db, cuenta, claveId, `Clave de ${e.nombre}`, e.claveEstado ?? 'valida')
      }
      await db.consulta(
        `insert into ia_agentes (miembro_id, propietario, modo, proveedor, modelo, clave_id, permisos, confirmar, puede_mencionar_ia, tope_mes_usd, autonomia, disparadores, activo)
         values ($1, $2, 'api', 'falso', $3, $4, $5::text[], $6, $7, $8, $9, $10::jsonb, $11)`,
        [id, cuenta, `guion:${e.guion}`, claveId, e.permisos ?? ['comentar', 'tarjetas', 'lienzo'], e.confirmar ?? 'peligrosas', e.puedeMencionarIA ?? false, e.topeMesUsd ?? 10, e.autonomia ?? 'sugiere', JSON.stringify(e.disparadores ?? {}), e.activo ?? true],
      )
      salida[e.nombre] = { id, alias }
    }
    console.log(JSON.stringify(salida))
  } else if (orden === 'clave') {
    const [cuenta, id] = resto as [string, string]
    await insertarClave(db, cuenta, id, 'Nueva', 'valida')
    console.log(JSON.stringify({ id }))
  } else if (orden === 'sql') {
    const [sql, ...parametros] = resto as [string, ...string[]]
    console.log(JSON.stringify(await db.consulta(sql, parametros)))
  } else throw new Error(`Orden desconocida: ${orden}`)
} finally {
  await db.cerrar()
}
