// Siembra, en la base DESCARTABLE de una prueba (carpeta temporal), lo que deja un agente de la IA integrada en una cuenta: un agente (su
// miembro, una clave sellada de mentira y su configuración), un trabajo que espera permiso, su conversación, una llamada del libro, el
// gasto y una mención pendiente, todos con la «marca» de esa cuenta en su texto. Lo usa `npm run cuentas:probar` para probar que otra
// cuenta no ve, no frena, no confirma, no reanuda ni reintenta nada de eso (docs/cuentas.md), sin necesitar un proveedor ni una clave.
//
// PGlite es de un solo proceso: el Telar de la prueba tiene que estar APAGADO mientras esto corre. Se niega a tocar otra cosa que una
// carpeta temporal del sistema (nunca la .datos/ del dueño). Imprime una línea JSON con los ids sembrados.
//
//   npx tsx scripts/ia/sembrar-trabajo.ts <carpeta de datos> <cuenta> <marca>
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrirPglite } from '../../servidor/src/datos/pglite'
import { migrar } from '../../servidor/src/datos/migraciones'

const [carpeta, cuenta, marca] = process.argv.slice(2)
if (!carpeta || !cuenta || !marca) throw new Error('Uso: sembrar-trabajo.ts <carpeta de datos> <cuenta> <marca>')
const abs = path.resolve(carpeta)
if (!abs.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(abs).startsWith('telar-')) throw new Error('Solo siembra en una carpeta temporal de prueba (telar-…).')
if (!existsSync(path.join(abs, 'pg'))) throw new Error('No hay una base en esa carpeta.')

const db = await abrirPglite(path.join(abs, 'pg'))
await migrar(db, path.resolve(import.meta.dirname, '..', '..', 'supabase', 'migrations'))
const id = (p: string) => `${p}_sem_${marca.toLowerCase()}`
const humano = JSON.stringify({ tipo: 'humano', id: 'persona', nombre: `Persona ${marca}` })
try {
  const [yo] = await db.consulta<{ id: string }>(`select id from miembros where propietario = $1 and es_yo order by creado_en limit 1`, [cuenta])
  if (!yo) throw new Error(`La cuenta ${cuenta} no tiene un miembro «yo».`)
  const agente = id('m')
  await db.consulta(`insert into miembros (id, nombre, tipo, color, iniciales, propietario, alias) values ($1, $2, 'ia', 'violeta', 'BO', $3, $4)`, [agente, `Bot ${marca}`, cuenta, `bot-${marca.toLowerCase()}`])
  await db.consulta(`insert into ia_claves (id, propietario, proveedor, nombre, cifrada, ultimos4, estado) values ($1, $2, 'falso', $3, $4, 'ia-1', 'valida')`, [id('k'), cuenta, `Clave ${marca}`, Buffer.from(`sellada-${marca}`)])
  await db.consulta(`insert into ia_agentes (miembro_id, propietario, proveedor, modelo, clave_id) values ($1, $2, 'falso', 'guion:responder', $3)`, [agente, cuenta, id('k')])
  await db.consulta(
    `insert into ia_trabajos (id, propietario, agente_id, origen, superficie, pedido, pedido_por, proveedor, modelo, estado, fijo, paso, costo_usd, contexto)
     values ($1, $2, $3, 'mencion', 'tarjeta', $4, $5::jsonb, 'falso', 'guion:responder', 'esperando_confirmacion', $6, 1, 0.42, '{}'::jsonb)`,
    [id('tr'), cuenta, agente, `Pedido de ${marca}`, humano, `fijo de ${marca}`],
  )
  await db.consulta(`insert into ia_mensajes (trabajo_id, n, propietario, rol, neutro, nativo) values ($1, 1, $2, 'usuario', $3::jsonb, $4)`, [
    id('tr'),
    cuenta,
    JSON.stringify({ rol: 'usuario', partes: [{ tipo: 'texto', texto: `Contexto privado de ${marca}` }] }),
    `nativo ${marca}`,
  ])
  await db.consulta(
    `insert into ia_llamadas (id, trabajo_id, propietario, paso, orden, id_proveedor, herramienta, argumentos, estado, motivo, resultado)
     values ($1, $2, $3, 0, 0, 'call_1', 'archivar_tarjeta', $4::jsonb, 'esperando', $5, $6)`,
    [id('ll'), id('tr'), cuenta, JSON.stringify({ tarjeta: `Tarjeta de ${marca}` }), `Archivar la tarjeta de ${marca}`, `resultado de ${marca}`],
  )
  await db.consulta(`insert into ia_uso (id, propietario, trabajo_id, agente_id, proveedor, modelo, entrada, salida, costo_usd) values ($1, $2, $3, $4, 'falso', 'guion:responder', 1000, 200, 0.42)`, [id('u'), cuenta, id('tr'), agente])
  await db.consulta(`insert into ia_uso_mes (propietario, mes, agente_id, entrada, salida, costo_usd, llamadas) values ($1, to_char(now() at time zone 'UTC', 'YYYY-MM'), $2, 1000, 200, 0.42, 1)`, [cuenta, agente])
  await db.consulta(`insert into ia_ajustes (propietario, tope_mes_usd) values ($1, 25) on conflict (propietario) do nothing`, [cuenta])
  await db.consulta(
    `insert into menciones (id, propietario, origen_tipo, origen_id, destinatario_id, autor, extracto, estado) values ($1, $2, 'comentario', $3, $4, $5::jsonb, $6, 'pendiente')`,
    [id('mn'), cuenta, id('c'), agente, humano, `@bot-${marca.toLowerCase()} mirá lo de ${marca}`],
  )
  console.log(JSON.stringify({ agente, trabajo: id('tr'), llamada: id('ll'), mencion: id('mn'), yo: yo.id }))
} finally {
  await db.cerrar()
}
