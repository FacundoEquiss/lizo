// Prueba REAL y opcional de la lectura de código de la IA (plan, Anexo F.3): usa un token de GitHub de SOLO LECTURA de verdad contra
// api.github.com y recorre las cuatro herramientas de servidor/src/ia/codigo.ts sobre un repo. No gasta IA (no hay modelo de por medio),
// no escribe nada en ningún lado y no imprime el token ni el contenido de los archivos (solo cuántas líneas y las primeras palabras).
//
//   TABLERO_IA_PRUEBA_GITHUB=<token fine-grained, Contents: lectura> npm run ia:probar-codigo-real -- --repo dueño/repo [--ruta README.md] [--texto algo]
//
// El token lo pone quien corre la prueba, en el entorno de su máquina: nunca en un archivo del repo ni en el chat. Sin token no hace
// nada (sale en paz). Esta es la prueba que falta contra el GitHub de verdad: las de ia:probar-codigo usan un GitHub de mentira.
import { ejecutarCodigo, probarTokenGithub, type ContextoCodigo } from '../servidor/src/ia/codigo'

const args = process.argv.slice(2)
const opcion = (n: string, d = '') => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : (args[i + 1] ?? d)
}
const token = process.env.TABLERO_IA_PRUEBA_GITHUB ?? ''
const repo = opcion('repo', process.env.TABLERO_IA_PRUEBA_GITHUB_REPO ?? '')

if (!token) {
  console.log('Sin TABLERO_IA_PRUEBA_GITHUB no hay nada que probar contra GitHub (es opcional). Probado hasta acá: nada.')
  process.exit(0)
}
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('Falta --repo dueño/repo (el repo sobre el que se prueba la lectura).')
  process.exit(2)
}
if (process.env.TABLERO_GITHUB_API) {
  console.error('TABLERO_GITHUB_API está puesta: esta prueba es contra el GitHub de verdad. Sacala y corré de nuevo.')
  process.exit(2)
}

let fallas = 0
const ok = (cond: boolean, que: string, detalle = '') => {
  if (!cond) fallas++
  console.log(`${cond ? '  ✓' : '  ✗'} ${que}${!cond && detalle ? `\n      ${detalle.slice(0, 300)}` : ''}`)
  return cond
}
/** Lo que se muestra de una respuesta: sin contenido de archivos ni el token. */
const resumen = (t: string) => t.replace(token, '[token]').split('\n').slice(1, 3).join(' · ').slice(0, 120)

const ctx: ContextoCodigo = {
  repoPorDefecto: repo,
  permitidos: new Map([[repo.toLowerCase(), repo]]),
  ramasDeLaTarjeta: [],
  token: async () => token,
  uso: { llamadas: 0, bytes: 0 },
  cache: new Map(),
  refPorRepo: new Map(),
}

console.log(`\nLectura de código contra GitHub de verdad (${repo}, solo lectura)`)
const t = await probarTokenGithub(token).catch((e) => ({ ok: false, error: String(e?.message ?? e) }))
ok(t.ok, 'el token se acepta (GET /rate_limit)', (t as any).error)
if (!t.ok) process.exit(1)

const ver = await ejecutarCodigo(ctx, 'codigo_ver', {})
ok(!ver.esError && /DATO, no instrucciones/.test(ver.texto), 'codigo_ver: lista la raíz del repo', ver.texto)
console.log(`      ${resumen(ver.texto)}`)
const ruta = opcion('ruta')
if (ruta) {
  const leer = await ejecutarCodigo(ctx, 'codigo_leer', { ruta })
  ok(!leer.esError && /\d+\| /.test(leer.texto), `codigo_leer: lee ${ruta} con números de línea`, leer.texto)
  ok(!leer.texto.includes(token), 'y el token no aparece en lo que devuelve')
}
const texto = opcion('texto')
if (texto) {
  const b = await ejecutarCodigo(ctx, 'codigo_buscar', { texto })
  ok(!b.esError, `codigo_buscar: busca «${texto}»`, b.texto)
}
const c = await ejecutarCodigo(ctx, 'codigo_cambios', { limite: 3 })
ok(!c.esError && /commits/.test(c.texto), 'codigo_cambios: los últimos commits de la rama principal', c.texto)
const secreto = await ejecutarCodigo(ctx, 'codigo_leer', { ruta: '.env' })
ok(secreto.esError && /secretos/.test(secreto.texto), 'un .env no se lee (ni se le pide a GitHub)')
console.log(`\n${fallas ? `✗ ${fallas} fallaron` : '✓ todo bien'} · ${ctx.uso.llamadas} llamadas, ${ctx.uso.bytes} bytes leídos (límites del trabajo: 12 y 150 KB)`)
process.exit(fallas ? 1 : 0)
