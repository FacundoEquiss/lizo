// Llamar una herramienta del MCP de Telar desde la terminal, con el cliente oficial (como cualquier cliente MCP). Lo usé
// para la prueba con un modelo de verdad (plan 7.5): el modelo lee las descripciones y llama de a una.
//   node scripts/diseno/mcp.mjs --lista                       → las herramientas con su descripción
//   node scripts/diseno/mcp.mjs crear_marco '{"proyecto":"EP", …}'   → la respuesta (las imágenes quedan en .tmp/mcp/)
// Opciones: --url http://127.0.0.1:4318 · TABLERO_CLAVE o TABLERO_DATOS para la clave · TABLERO_AUTOR para el nombre.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { conectarMcp, RAIZ } from './comun.mjs'

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  if (i < 0) return d
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const base = opcion('url', `http://127.0.0.1:${process.env.TABLERO_PUERTO || 4318}`)
let clave = process.env.TABLERO_CLAVE || ''
if (!clave && process.env.TABLERO_DATOS) clave = readFileSync(path.join(process.env.TABLERO_DATOS, 'clave-mcp.txt'), 'utf8').trim()
const mcp = await conectarMcp(base, clave, process.env.TABLERO_AUTOR || 'Claude')
try {
  if (args[0] === '--lista') {
    const { tools } = await mcp.cliente.listTools()
    for (const t of tools) console.log(`## ${t.name}\n${t.description}\n${JSON.stringify(t.inputSchema)}\n`)
  } else {
    const [nombre, json = '{}'] = args
    const t0 = Date.now()
    const r = await mcp.llamar(nombre, JSON.parse(json))
    const carpeta = path.join(RAIZ, '.tmp/mcp')
    mkdirSync(carpeta, { recursive: true })
    const imagenes = r.imagenes.map((im, i) => {
      const archivo = path.join(carpeta, `${Date.now()}-${nombre}-${i + 1}.${im.mime.includes('jpeg') ? 'jpg' : 'png'}`)
      writeFileSync(archivo, im.bytes)
      return path.relative(RAIZ, archivo)
    })
    console.log(`${r.error ? 'ERROR · ' : ''}${r.texto}${imagenes.length ? `\n[imágenes: ${imagenes.join(', ')}]` : ''}`)
    appendFileSync(path.join(carpeta, 'llamadas.log'), JSON.stringify({ nombre, args: JSON.parse(json), error: r.error, ms: Date.now() - t0, imagenes: imagenes.length }) + '\n')
  }
} finally {
  await mcp.cerrar()
}
