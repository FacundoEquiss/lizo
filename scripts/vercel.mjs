// Arma la salida para Vercel (Build Output API v3) después de `vite build`:
//   · la web compilada (dist/web) como archivos estáticos;
//   · el servidor (servidor/src/vercel-entrada.ts) empaquetado en una sola función de Node, que atiende /api, /mcp y /archivos;
//   · Diseño: la función aparte render.func (servidor/src/diseno/vercel-render.ts) con el Chromium empaquetado para funciones
//     (@sparticuz/chromium + playwright-core, que van en su node_modules). Atiende el dibujo de los marcos; la principal no
//     lleva Chromium (no engorda ni tarda más en arrancar). Ver docs/plan-diseno.md, 7.4;
//   · lo demás (las rutas de la web, /RC/pendientes…) devuelve index.html.
// Así Vercel no tiene que adivinar nada del proyecto (TypeScript, módulos, carpetas).
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const salida = '.vercel/output'
if (!existsSync('dist/web/index.html')) throw new Error('Falta compilar la web (vite build).')
rmSync(salida, { recursive: true, force: true })
mkdirSync(`${salida}/static`, { recursive: true })
cpSync('dist/web', `${salida}/static`, { recursive: true })

// Chromium y playwright-core no se empaquetan con esbuild (traen binarios y archivos que leen del disco): la función de render
// los lleva en su node_modules; la principal nunca los carga (en Vercel le pide el dibujo a render.func por HTTP).
const NAVEGADOR = ['playwright-core', '@sparticuz/chromium']

async function empaquetar(entrada, fn, externos = []) {
  mkdirSync(fn, { recursive: true })
  await build({
  entryPoints: [entrada],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // pg-native es opcional de pg (no se usa)
  external: ['pg-native', ...externos],
  // PGlite es solo para la computadora (online la base es Postgres): en su lugar va un reemplazo vacío. Si quedara como
  // paquete externo, el import se carga al arrancar y la función se cae (no está instalado en Vercel).
  plugins: [
    {
      name: 'sin-pglite',
      setup(b) {
        b.onResolve({ filter: /^@electric-sql\/pglite/ }, () => ({ path: 'pglite', namespace: 'sin-pglite' }))
        b.onLoad({ filter: /.*/, namespace: 'sin-pglite' }, () => ({
          contents: "export class PGlite { constructor() { throw new Error('PGlite es solo para la computadora: online falta TABLERO_DB_URL.') } }",
          loader: 'js',
        }))
      },
    },
  ],
  // algunas dependencias usan require(): en un módulo ESM hay que dárselo
  banner: { js: "import { createRequire as __crearRequire } from 'node:module'; const require = __crearRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
  })
  writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }))
}

function configurarFuncion(fn, o) {
  writeFileSync(
    `${fn}/.vc-config.json`,
    JSON.stringify(
      {
        runtime: 'nodejs22.x',
        handler: 'index.mjs',
        launcherType: 'Nodejs',
        shouldAddHelpers: false,
        supportsResponseStreaming: true,
        maxDuration: 60,
        regions: ['gru1'], // al lado de la base (Supabase sa-east-1, São Paulo) y de quienes la usan (Argentina)
        ...o,
      },
      null,
      2,
    ),
  )
}

/** Copia los paquetes (y sus dependencias, tal como están instaladas) al node_modules de la función. */
function copiarPaquetes(fn, nombres) {
  const vistos = new Set()
  const copiar = (nombre) => {
    if (vistos.has(nombre)) return
    vistos.add(nombre)
    const origen = path.join('node_modules', nombre)
    if (!existsSync(path.join(origen, 'package.json'))) throw new Error(`Falta el paquete ${nombre} (npm install).`)
    cpSync(origen, path.join(fn, 'node_modules', nombre), { recursive: true, dereference: true })
    const pj = JSON.parse(readFileSync(path.join(origen, 'package.json'), 'utf8'))
    for (const d of Object.keys(pj.dependencies ?? {})) copiar(d)
    for (const d of Object.keys(pj.optionalDependencies ?? {})) if (existsSync(path.join('node_modules', d))) copiar(d)
  }
  for (const n of nombres) copiar(n)
  return vistos.size
}

function tamano(dir) {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    total += e.isDirectory() ? tamano(p) : statSync(p).size
  }
  return total
}

// la principal: /api, /mcp, /archivos, /oauth y /.well-known (metadatos de OAuth)
const fn = `${salida}/functions/api.func`
await empaquetar('servidor/src/vercel-entrada.ts', fn, NAVEGADOR)
// 300 s: un trabajo de la IA integrada sigue corriendo en segundo plano (waitUntil) después de contestar el pedido que lo creó, y un
// diagrama grande tarda. Es el máximo con cómputo fluido en Hobby y lo normal en Pro; no cambia lo que se paga (se cobra lo que cada
// ejecución usa de verdad). Si el proyecto no admitiera 300 s, Vercel rechaza la publicación con un error claro. render.func queda en 60.
configurarFuncion(fn, { memory: 1024, maxDuration: 300 })
const pesoApi = tamano(fn)

// Diseño: la de render, con Chromium (2 GB: el máximo de Hobby; @sparticuz/chromium pide 1.600 MB o más)
const render = `${salida}/functions/render.func`
await empaquetar('servidor/src/diseno/vercel-render.ts', render, NAVEGADOR)
const paquetes = copiarPaquetes(render, NAVEGADOR)
configurarFuncion(render, { memory: 2048 })
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`
console.log(`[tablero] api.func: ${mb(pesoApi)} sin comprimir (maxDuration 300 s; límite de Vercel: 250 MB)`)
const pesoRender = tamano(render)
console.log(`[tablero] render.func: ${mb(pesoRender)} sin comprimir (${paquetes} paquetes en node_modules; límite de Vercel: 250 MB)`)
if (pesoRender > 250 * 1024 * 1024) throw new Error('render.func pasa los 250 MB de Vercel: usar el plan B de docs/plan-diseno.md (7.4).')
writeFileSync(
  `${salida}/config.json`,
  JSON.stringify(
    {
      version: 3,
      // El cron de la IA integrada (plan 11.4): cada minuto levanta lo que quedó trabado (un proceso que murió, una espera larga) y hace el
      // mantenimiento. Pro admite hasta uno por minuto. Vercel manda `Authorization: Bearer <CRON_SECRET>` solo si la variable existe; la
      // ruta rechaza (401) todo pedido sin ese secreto, y sin la variable simplemente no hay cron.
      crons: [{ path: '/api/ia/interno/barrer', schedule: '* * * * *' }],
      routes: [
        // PWA (plan del celular, 9.5): el service worker y el manifest nunca quedan en caché (así siempre se ve la
        // versión nueva); los íconos, un día.
        { src: '^/sw\\.js$', headers: { 'cache-control': 'public, max-age=0, must-revalidate' }, continue: true },
        {
          src: '^/manifest\\.webmanifest$',
          headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' },
          continue: true,
        },
        { src: '^/pwa/(.*)$', headers: { 'cache-control': 'public, max-age=86400' }, continue: true },
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/(.*)$', headers: { 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff' }, continue: true },
        { handle: 'filesystem' },
        // Diseño: lo que dibuja con Chromium va a la función de render (exportar desde la web y los pedidos internos del MCP)
        { src: '^/api/diseno/[^/]+/marcos/[^/]+/render$', dest: '/render' },
        { src: '^/api/diseno/[^/]+/(render-interno|grilla-interna|foto-lienzo-interna)$', dest: '/render' },
        { src: '^/(api|mcp|archivos|oauth|\\.well-known)(/.*)?$', dest: '/api' },
        // Un archivo que no existe da 404 de verdad (no index.html con 200: el navegador intentaría correr HTML como
        // JavaScript y el error no diría nada, y el service worker podría guardar basura).
        { src: '^/(assets|pwa|marca)/.*$', status: 404 },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
)
console.log('[tablero] salida para Vercel lista en .vercel/output')
