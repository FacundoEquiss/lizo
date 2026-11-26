// Plugin de Vite que escribe dist/web/sw.js al compilar (plan del celular, 9.5). Toma la plantilla web/pwa/sw.js y le
// pone la lista de lo que se guarda al instalar (el esqueleto de la app) y una versión: los primeros 10 caracteres del
// SHA-256 de esa lista, del contenido de lo que no tiene el contenido en el nombre y de la plantilla. Cualquier cambio
// de la app da una versión nueva y el aviso de "Hay una versión nueva". En npm run dev no hay service worker.
// Con TELAR_SW=apagar escribe el de emergencia (web/pwa/sw-apagar.js) en su lugar.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

function listar(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = path.join(dir, n)
    return statSync(ruta).isDirectory() ? listar(ruta, base) : ['/' + path.relative(base, ruta).split(path.sep).join('/')]
  })
}

export function pluginServiceWorker(): Plugin {
  let raiz = ''
  let salida = ''
  return {
    name: 'telar-service-worker',
    apply: 'build',
    configResolved(c) {
      raiz = c.root
      salida = path.resolve(c.root, c.build.outDir)
    },
    closeBundle() {
      if (!existsSync(path.join(salida, 'index.html'))) return
      const apagar = process.env.TELAR_SW === 'apagar'
      const plantilla = readFileSync(path.join(raiz, 'pwa', apagar ? 'sw-apagar.js' : 'sw.js'), 'utf8')
      if (apagar) {
        writeFileSync(path.join(salida, 'sw.js'), plantilla)
        this.warn('TELAR_SW=apagar: se escribió el service worker de emergencia (borra las cachés y se da de baja).')
        return
      }
      const todos = listar(salida)
      // El esqueleto: index.html, todo el JavaScript y el CSS (también el del lienzo, para abrirlo sin red), las dos
      // fuentes latinas, la marca, el ícono chico y el manifest. Las otras fuentes, las pantallas de arranque y las
      // capturas no: se guardan si alguna vez se piden, o las lee iOS al instalar.
      const guardar = [
        '/index.html',
        ...todos.filter((a) => /^\/assets\/.+\.(js|css)$/.test(a)),
        ...todos.filter((a) => /^\/assets\/(figtree|geist-mono)-latin-wght-normal-.+\.woff2$/.test(a)),
        ...['/marca/telar.svg', '/icono.svg', '/pwa/icono-192.png', '/manifest.webmanifest'].filter((a) => todos.includes(a)),
      ]
      const hash = createHash('sha256')
      for (const a of guardar) {
        hash.update(a + '\n')
        if (!a.startsWith('/assets/')) hash.update(readFileSync(path.join(salida, a)))
      }
      hash.update(plantilla)
      // Para la revisión de la PWA (scripts/revisar-pwa.mjs): fuerza una versión distinta con el mismo código.
      if (process.env.TELAR_SW_MARCA) hash.update(process.env.TELAR_SW_MARCA)
      const version = hash.digest('hex').slice(0, 10)
      writeFileSync(
        path.join(salida, 'sw.js'),
        plantilla
          .replace("const VERSION = '__VERSION__'", `const VERSION = '${version}'`)
          .replace('const ARCHIVOS = __ARCHIVOS__', `const ARCHIVOS = ${JSON.stringify(guardar, null, 2)}`),
      )
    },
  }
}
