// Escenario M16 de `npm run ia:probar` (docs/plan-ia-integrada.md, 15.5): comentar SIN «@» no suma consultas a la base.
// Abre una base descartable (PGlite en una carpeta temporal), arma un proyecto con una tarjeta y cuenta las consultas de
// `comentar` con los ganchos vacíos (como antes de la IA) y con `conectarIA` puesto. Imprime una línea `RESULTADO {…}` con los
// números para que scripts/probar-ia.mjs los compare. Nunca toca la .datos/ del dueño ni producción.
//
//   npx tsx scripts/probar-ia-consultas.ts
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { almacenCarpeta } from '../servidor/src/datos/almacen'
import { abrirConexion, type Conexion } from '../servidor/src/datos/conexion'
import { migrar } from '../servidor/src/datos/migraciones'
import { Servicio } from '../servidor/src/dominio/servicio'
import { BusEventos } from '../servidor/src/eventos'
import { conectarIA } from '../servidor/src/ia/conectar'

const carpeta = mkdtempSync(path.join(os.tmpdir(), 'telar-consultas-ia-'))
const db = await abrirConexion({ carpetaPglite: path.join(carpeta, 'pg') })
await migrar(db, path.resolve(import.meta.dirname, '..', 'supabase', 'migrations'))

let consultas = 0
const contada: Conexion = {
  tipo: db.tipo,
  consulta: (sql, p) => {
    consultas++
    return db.consulta(sql, p)
  },
  ejecutar: (sql) => db.ejecutar(sql),
  transaccion: (fn) =>
    db.transaccion((tx) => fn({ ...contada, consulta: (sql, p) => (consultas++, tx.consulta(sql, p)), transaccion: (f) => f(tx) } as Conexion)),
  cerrar: () => db.cerrar(),
}

const raiz = new Servicio(contada, new BusEventos(), almacenCarpeta(path.join(carpeta, 'archivos')))
const s = raiz.de('dueno')
const persona = { actor: { tipo: 'humano' as const, id: 'yo', nombre: 'Yo' }, via: 'sesion' as const }
const ia = { actor: { tipo: 'ia' as const, id: 'ia', nombre: 'Claude' } }
await s.crearMiembro({ nombre: 'Yo', esYo: true })
await s.asegurarMiembroIA('Claude')
const proyecto = await s.crearProyecto(persona, { nombre: 'Prueba', prefijo: 'PR' } as any)
const tarjeta = await s.crearTarjeta(persona, { tableroId: proyecto.tableros[0]!.id, titulo: 'Tarjeta' } as any)

async function medir(texto: string, ctx = persona): Promise<number> {
  await s.comentar(ctx, tarjeta.clave, `${texto} (calentamiento)`) // una de calentamiento (cachés de PGlite)
  consultas = 0
  await s.comentar(ctx, tarjeta.clave, texto)
  return consultas
}

const sinGanchos = await medir('Un comentario común, sin arroba')
conectarIA(raiz)
const conGanchos = await medir('Un comentario común, sin arroba')
const conArroba = await medir('Un comentario que menciona a @claude')
const deIA = await medir('Un comentario de una IA, sin arroba', ia as any)
console.log(`RESULTADO ${JSON.stringify({ sinGanchos, conGanchos, conArroba, deIA })}`)
await db.cerrar()
rmSync(carpeta, { recursive: true, force: true })
