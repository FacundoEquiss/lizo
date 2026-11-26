// npm run importar:discord -- <ruta.json> [--proyecto RC] [--tablero Pendientes]
// Si el tablero está corriendo, la importación la hace ese servidor (y se ve en vivo);
// si no, abre la base un momento, importa y la cierra.
import path from 'node:path'
import { leerClave, urlServidor } from '../config'
import { CUENTA_DUENO } from '../datos/almacen'
import { hayTablero, iniciarServidor } from '../servidor'
import { importarDiscord, type InformeImportacion } from './discord-logica'

const args = process.argv.slice(2)
const opcion = (nombre: string) => {
  const i = args.indexOf(`--${nombre}`)
  if (i === -1) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const proyecto = opcion('proyecto')
const tablero = opcion('tablero')
const archivo = args[0]

if (!archivo) {
  console.error('Uso: npm run importar:discord -- <ruta del .json> [--proyecto RC] [--tablero Pendientes]')
  process.exit(1)
}
const ruta = path.resolve(process.env.INIT_CWD || process.cwd(), archivo)

function mostrar(inf: InformeImportacion) {
  console.log(`\nImporté ${path.relative(process.cwd(), inf.archivo) || inf.archivo}`)
  console.log(`  tarjetas nuevas: ${inf.nuevas} · actualizadas: ${inf.actualizadas}`)
  console.log(`  adjuntos copiados: ${inf.adjuntos} · vínculos entre tarjetas: ${inf.vinculos}`)
  for (const [lista, n] of Object.entries(inf.porLista)) console.log(`  ${lista}: ${n}`)
  if (inf.faltantes.length) {
    console.log(`  adjuntos que no encontré (${inf.faltantes.length}):`)
    for (const f of inf.faltantes) console.log(`    - ${f}`)
  }
}

try {
  if (await hayTablero()) {
    const r = await fetch(`${urlServidor()}/api/importar/discord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${leerClave()}` },
      body: JSON.stringify({ ruta, proyecto, tablero }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? `El servidor respondió ${r.status}`)
    mostrar(j)
  } else {
    const s = await iniciarServidor({ log: () => {} })
    try {
      mostrar(await importarDiscord(s.servicio.de(CUENTA_DUENO), ruta, { proyecto, tablero }))
    } finally {
      await s.cerrar()
    }
  }
  process.exit(0)
} catch (e) {
  console.error(`No pude importar: ${(e as Error).message}`)
  process.exit(1)
}
