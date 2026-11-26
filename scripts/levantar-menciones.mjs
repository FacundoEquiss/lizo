// Levanta las menciones que ya estaban escritas en los comentarios antes de que existiera la función (por ejemplo, «@claude ya
// le respondi» en RC-104) contra un Telar LOCAL que está corriendo: llama a POST /api/ia/menciones/levantar y cuenta lo que
// encontró. Es idempotente (correrlo dos veces no duplica nada). Solo local: se niega a apuntar a otra cosa que 127.0.0.1 o
// localhost (online esto se hace desde la app, con la sesión: la clave del MCP no alcanza a propósito).
//
//   npm run dev                                         (en otra terminal)
//   node scripts/levantar-menciones.mjs                 (contra http://127.0.0.1:4318, el servidor de `npm run dev`)
//   node scripts/levantar-menciones.mjs --web http://127.0.0.1:4357
const args = process.argv.slice(2)
const i = args.indexOf('--web')
const WEB = i === -1 ? 'http://127.0.0.1:4318' : args[i + 1]
if (!['127.0.0.1', 'localhost'].includes(new URL(WEB).hostname)) {
  console.error('Solo contra un Telar local (127.0.0.1 o localhost).')
  process.exit(1)
}
const r = await fetch(`${WEB}/api/ia/menciones/levantar`, { method: 'POST', headers: { 'content-type': 'application/json', origin: WEB }, body: '{}' }).catch(() => null)
if (!r) {
  console.error(`No pude hablar con ${WEB}: ¿está corriendo npm run dev?`)
  process.exit(1)
}
const informe = await r.json().catch(() => ({}))
if (!r.ok) {
  console.error(`Telar contestó ${r.status}: ${informe.error ?? '(sin mensaje)'}`)
  process.exit(1)
}
console.log(`Menciones de antes levantadas en ${WEB}:`)
console.log(`  pendientes nuevas: ${informe.pendientes}`)
console.log(`  ya atendidas (la IA comentó después, o eran para una persona): ${informe.atendidas}`)
if (informe.miembrosCreados?.length) console.log(`  miembros IA creados para no perder menciones: ${informe.miembrosCreados.join(', ')}`)
