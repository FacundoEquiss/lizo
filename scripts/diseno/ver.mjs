// Ver un marco sin abrir la app (plan 7.4, plan B): le pide el dibujo al Telar local (que lo saca con el Chrome de la
// computadora) y lo guarda en un PNG. Sirve para Claude Code cuando el render online no está.
//   npm run diseno:ver -- --proyecto RC --marco m_0386ce97 [--capa a1b2c3] [--escala 2] [--salida .tmp/marco.png]
//   npm run diseno:ver -- --proyecto RC --pagina celular      (todas las miniaturas de la página, una por marco)
// La clave sale de TABLERO_CLAVE o de la carpeta de datos (TABLERO_DATOS/clave-mcp.txt). Nunca se muestra.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { RAIZ } from './comun.mjs'

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : d
}
const api = opcion('url', `http://127.0.0.1:${process.env.TABLERO_PUERTO || 4318}`)
const proyecto = (opcion('proyecto', '') || '').toUpperCase()
const marco = opcion('marco', '')
const pagina = opcion('pagina', '')
const capa = opcion('capa', '')
const escala = Number(opcion('escala', 1))
let clave = process.env.TABLERO_CLAVE || ''
if (!clave && process.env.TABLERO_DATOS) {
  try {
    clave = readFileSync(path.join(process.env.TABLERO_DATOS, 'clave-mcp.txt'), 'utf8').trim()
  } catch {
    // sin clave: sirve igual contra un Telar local abierto
  }
}
if (!proyecto || (!marco && !pagina)) {
  console.error('Uso: npm run diseno:ver -- --proyecto RC --marco <id o nombre> [--capa <id>] [--escala 2] [--salida archivo.png]\n     o --pagina <slug> para todas las miniaturas de una página.')
  process.exit(1)
}
const cabeceras = clave ? { 'x-tablero-clave': clave } : {}

async function bajar(id, salida) {
  const qs = new URLSearchParams({ formato: 'png', escala: String(escala) })
  if (capa) qs.set('capa', capa)
  const r = await fetch(`${api}/api/diseno/${encodeURIComponent(proyecto)}/marcos/${encodeURIComponent(id)}/render?${qs}`, { headers: cabeceras })
  if (!r.ok) throw new Error(`${id}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  mkdirSync(path.dirname(salida), { recursive: true })
  writeFileSync(salida, Buffer.from(await r.arrayBuffer()))
  const avisos = JSON.parse(decodeURIComponent(r.headers.get('x-telar-avisos') || '%5B%5D'))
  console.log(`${path.relative(RAIZ, salida)}${avisos.length ? `\n  avisos: ${avisos.join(' · ')}` : ''}`)
}

if (marco) await bajar(marco, path.resolve(RAIZ, opcion('salida', `.tmp/diseno/${proyecto}-${marco}${capa ? '-' + capa : ''}.png`)))
else {
  const r = await fetch(`${api}/api/diseno/${encodeURIComponent(proyecto)}/paginas/${encodeURIComponent(pagina)}`, { headers: cabeceras })
  if (!r.ok) throw new Error(`${pagina}: ${r.status}`)
  const { marcos } = await r.json()
  const carpeta = path.resolve(RAIZ, opcion('salida', `.tmp/diseno/${proyecto}-${pagina}`))
  for (const m of marcos) await bajar(m.id, path.join(carpeta, `${m.nombre.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-')}.png`))
}
