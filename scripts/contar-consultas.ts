// Cuenta las consultas a la base (y el tiempo) de las rutas que más se usan, sobre una COPIA de una base local
// (PGlite). Sirve para encontrar consultas de más (N+1) antes de que se noten online, donde cada consulta va a Supabase.
//
//   cp -r /tmp/telar-prueba /tmp/telar-copia            (con el Telar de prueba sembrado: sembrar-lienzo --parecido-rc)
//   npx tsx scripts/contar-consultas.ts --datos /tmp/telar-copia --tablero parecido-rc
//
// Nunca toca producción: abre una carpeta de PGlite (y se niega si la carpeta es la .datos/ del dueño). Cambia la copia
// (arma y vuelve a sacar objetos): por eso va sobre una copia.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { ejecutorLocal } from '../servidor/src/api'
import { almacenCarpeta } from '../servidor/src/datos/almacen'
import { abrirConexion, type Conexion } from '../servidor/src/datos/conexion'
import { Servicio } from '../servidor/src/dominio/servicio'
import { BusEventos } from '../servidor/src/eventos'

const args = process.argv.slice(2)
const opcion = (n: string, d = '') => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]!
}
const datos = path.resolve(opcion('datos'))
if (!opcion('datos') || !existsSync(path.join(datos, 'pg'))) throw new Error('Pasá --datos <carpeta de un Telar local> (una copia).')
if (datos === path.resolve('.datos')) throw new Error('Esa es la base del dueño: usá una copia.')
const slug = opcion('tablero', 'parecido-rc')

const db = await abrirConexion({ carpetaPglite: path.join(datos, 'pg') })
let consultas = 0
const contada: Conexion = {
  tipo: db.tipo,
  consulta: (sql, p) => {
    consultas++
    return db.consulta(sql, p)
  },
  ejecutar: (sql) => db.ejecutar(sql),
  transaccion: (fn) =>
    db.transaccion((tx) =>
      fn({ ...contada, consulta: (sql, p) => (consultas++, tx.consulta(sql, p)), transaccion: (f) => f(tx) } as Conexion),
    ),
  cerrar: () => db.cerrar(),
}
const servicio = new Servicio(contada, new BusEventos(), almacenCarpeta(path.join(datos, 'archivos')))
const mcp = ejecutorLocal(servicio)
const ia = { tipo: 'ia' as const, id: 'ia', nombre: 'Contador' }

async function medir(que: string, fn: () => Promise<unknown>) {
  await fn() // una de calentamiento (cachés de PGlite)
  consultas = 0
  const t0 = performance.now()
  const r = await fn()
  console.log(`${que.padEnd(44)} ${String(consultas).padStart(5)} consultas  ${(performance.now() - t0).toFixed(0).padStart(6)} ms`)
  return r
}

const proyectos = await servicio.listarProyectos()
const rc = proyectos.find((p) => p.prefijo === 'RC')!
const tb = rc.tableros.find((t) => t.slug === slug)
if (!tb) throw new Error(`No está el tablero ${slug} en RC.`)
const completo = await servicio.leerTableroCompleto(tb.id)
console.log(`${slug}: ${completo.elementos.length} objetos, ${completo.conectores.length} conectores, ${completo.tarjetas.length} tarjetas\n`)

await medir('GET tablero completo (abrir el tablero)', () => servicio.leerTableroCompleto(tb.id))
await medir('MCP leer_lienzo (todo el lienzo)', () => mcp('leer_lienzo', { proyecto: 'RC', tablero: tb.id }, ia))
const marco = completo.elementos.find((e) => e.tipo === 'marco')!
await medir('MCP leer_lienzo de un marco', () => mcp('leer_lienzo', { proyecto: 'RC', tablero: tb.id, marco: marco.id }, ia))
await medir('MCP leer_tablero (el Kanban)', () => mcp('leer_tablero', { proyecto: 'RC', tablero: tb.id }, ia))
const objetos = Array.from({ length: 20 }, (_, i) => ({ ref: `o${i}`, tipo: i % 3 ? 'forma' : 'nota', texto: `**Paso ${i}**\nalgo más` }))
const conectores = Array.from({ length: 10 }, (_, i) => ({ desde: `o${i}`, hasta: `o${i + 1}` }))
const armado = (await medir('MCP armar_en_lienzo (20 objetos, 10 conectores)', () =>
  mcp('armar_en_lienzo', { proyecto: 'RC', tablero: tb.id, objetos, conectores, nuevo_marco: { titulo: 'Contar consultas' } }, ia),
)) as { objetos?: { id: string }[] }
const otro = completo.elementos.find((e) => e.tipo === 'nota')!
await medir('MCP agregar_al_lienzo (un conector por texto)', () =>
  mcp('agregar_al_lienzo', { proyecto: 'RC', tablero: tb.id, tipo: 'conector', desde: otro.id, hasta: marco.id }, ia),
)
void armado
await db.cerrar()
