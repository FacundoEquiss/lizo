// Toca la base DESCARTABLE de `npm run cuentas:probar` (carpeta temporal) para lo que la API no deja hacer: vencer una invitación (el
// mínimo de la app es un día) y buscar los tokens en claro en TODAS las tablas (no tiene que estar ninguno: en la base queda su sha256).
//
// PGlite es de un solo proceso: el Telar de la prueba tiene que estar APAGADO mientras esto corre. Se niega a tocar otra cosa que una
// carpeta temporal del sistema (nunca la .datos/ del dueño). Imprime una línea JSON.
//
//   npx tsx scripts/amigos/tocar-base.ts <carpeta de datos> vencer <id de invitación>
//   npx tsx scripts/amigos/tocar-base.ts <carpeta de datos> vencer-restablecimiento <id del restablecimiento>
//   npx tsx scripts/amigos/tocar-base.ts <carpeta de datos> viejar-solicitud <id de la cuenta> <días>
//     (pasa el pedido —y la decisión, si la hay— de una solicitud de cuenta a hace tantos días: para probar «Borrar solicitudes viejas» y que el mail de
//      una rechazada se libere; la API no deja viajar en el tiempo)
//   npx tsx scripts/amigos/tocar-base.ts <carpeta de datos> huerfanos
//     (cuántos códigos de recuperación y restablecimientos quedaron de cuentas que ya no existen: tiene que ser 0)
//   TELAR_TOKENS='["…","…"]' TELAR_CODIGOS='["K7M2-9QXA-WD4P"]' TELAR_SECRETOS='["una clave"]' npx tsx scripts/amigos/tocar-base.ts <carpeta de datos> buscar
//     (tokens de invitación y de restablecimiento, códigos de recuperación y contraseñas: ninguno puede estar en claro en ninguna tabla;
//      de cada token tiene que haber una fila con su sha256 y de cada código, una con sha256(sal:código))
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrirPglite } from '../../servidor/src/datos/pglite'

const [carpeta, accion, id] = process.argv.slice(2)
if (!carpeta || !accion) throw new Error('Uso: tocar-base.ts <carpeta de datos> vencer <id> | buscar')
const abs = path.resolve(carpeta)
if (!abs.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(abs).startsWith('telar-')) throw new Error('Solo toca una carpeta temporal de prueba (telar-…).')
if (!existsSync(path.join(abs, 'pg'))) throw new Error('No hay una base en esa carpeta.')

const db = await abrirPglite(path.join(abs, 'pg'))
try {
  if (accion === 'vencer') {
    if (!id) throw new Error('Falta el id de la invitación.')
    const filas = await db.consulta(`update invitaciones set vence_en = now() - interval '1 minute' where id = $1 returning id`, [id])
    console.log(JSON.stringify({ vencidas: filas.length }))
  } else if (accion === 'vencer-restablecimiento') {
    if (!id) throw new Error('Falta el id del restablecimiento.')
    const filas = await db.consulta(`update restablecimientos set vence_en = now() - interval '1 minute' where id = $1 returning id`, [id])
    console.log(JSON.stringify({ vencidos: filas.length }))
  } else if (accion === 'viejar-solicitud') {
    const dias = Number(process.argv[5])
    if (!id || !Number.isInteger(dias) || dias < 0) throw new Error('Falta el id de la cuenta y los días.')
    const filas = await db.consulta(
      `update cuentas set solicitada_en = now() - ($2::int * interval '1 day'),
         decidida_en = case when decidida_en is null then null else now() - ($2::int * interval '1 day') end where id = $1 returning id`,
      [id, dias],
    )
    console.log(JSON.stringify({ viejas: filas.length }))
  } else if (accion === 'huerfanos') {
    const [c] = await db.consulta<{ n: number }>(`select count(*)::int as n from codigos_recuperacion where cuenta not in (select id from cuentas)`)
    const [r] = await db.consulta<{ n: number }>(`select count(*)::int as n from restablecimientos where cuenta not in (select id from cuentas)`)
    console.log(JSON.stringify({ codigos: c?.n ?? 0, restablecimientos: r?.n ?? 0 }))
  } else if (accion === 'buscar') {
    const tokens: string[] = JSON.parse(process.env.TELAR_TOKENS || '[]')
    const codigos: string[] = JSON.parse(process.env.TELAR_CODIGOS || '[]')
    const secretos: string[] = JSON.parse(process.env.TELAR_SECRETOS || '[]')
    const tablas = (await db.consulta<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)).map((f) => f.tablename)
    const encontrados: string[] = []
    let hashes = 0
    const textoDeTodo: string[] = []
    for (const t of tablas) textoDeTodo.push(JSON.stringify(await db.consulta(`select * from "${t}"`)))
    const todo = textoDeTodo.join('\n')
    for (const token of tokens) {
      if (todo.includes(token)) encontrados.push(`${token.slice(0, 6)}…`)
      const [f] = await db.consulta(`select 1 from invitaciones where token_hash = $1`, [createHash('sha256').update(token).digest('hex')])
      if (f) hashes++
    }
    // el token de un restablecimiento: su sha256 está en `restablecimientos`
    let hashesRestablecer = 0
    for (const token of tokens) {
      const [f] = await db.consulta(`select 1 from restablecimientos where token_hash = $1`, [createHash('sha256').update(token).digest('hex')])
      if (f) hashesRestablecer++
    }
    // los códigos de recuperación: en claro (con o sin guiones) no están; de cada uno hay una fila con sha256(sal:código)
    const filasCodigos = await db.consulta<{ sal: string; codigo_hash: string }>(`select sal, codigo_hash from codigos_recuperacion`)
    const hashesCodigos = new Set(filasCodigos.map((f) => f.codigo_hash))
    let codigosConHash = 0
    for (const codigo of codigos) {
      const norm = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (todo.includes(codigo) || todo.includes(norm)) encontrados.push(`${codigo.slice(0, 4)}…`)
      if (filasCodigos.some((f) => hashesCodigos.has(createHash('sha256').update(`${f.sal}:${norm}`).digest('hex')))) codigosConHash++
    }
    for (const secreto of secretos) if (todo.includes(secreto)) encontrados.push(`secreto:${secreto.slice(0, 4)}…`)
    console.log(JSON.stringify({ tablas: tablas.length, tokens: tokens.length, encontrados, hashes, hashesRestablecer, codigos: codigos.length, codigosConHash }))
  } else throw new Error(`Acción desconocida: ${accion}`)
} finally {
  await db.cerrar()
}
