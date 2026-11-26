// Paso 6 (solo con --con-paginas): las pantallas y las piezas. Levanta un servidor estático de solo lectura en la raíz del
// repo, abre cada pantalla con playwright-core + el Chrome del sistema en la vista pedida (tamaño, densidad, táctil), hace las
// acciones, espera a que no queden animaciones y saca la INSTANTÁNEA del DOM (en-pagina.mjs) y una miniatura WebP.
// Corre también las recetas de piezas. No corre ninguna prueba del proyecto ni escribe nada en su carpeta.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { paginaDeVista, type Perfil, type PantallaPerfil } from '../../compartido/diseno/perfil'
import { slug } from '../../compartido/texto'
import { leerHoja, procesarHoja } from './hojas'
import type { Paquete } from './paquete'

const MIMES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ico': 'image/x-icon',
}

/** Servidor estático de solo lectura sobre el repo (más el módulo que corre en la página y las recetas). */
function servidorEstatico(repo: string, extras: Record<string, string>): Promise<{ origen: string; cerrar: () => Promise<void> }> {
  const raiz = path.resolve(repo)
  const srv = http.createServer((req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x')
      const extra = extras[u.pathname]
      let archivo = extra ?? path.join(raiz, decodeURIComponent(u.pathname))
      if (!extra && !archivo.startsWith(raiz)) {
        res.writeHead(403).end()
        return
      }
      if (existsSync(archivo) && statSync(archivo).isDirectory()) archivo = path.join(archivo, 'index.html')
      if (!existsSync(archivo)) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-type': MIMES[path.extname(archivo).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      createReadStream(archivo).pipe(res)
    } catch {
      res.writeHead(500).end()
    }
  })
  return new Promise((ok) =>
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo
      ok({ origen: `http://127.0.0.1:${port}`, cerrar: () => new Promise((r) => srv.close(() => r())) })
    }),
  )
}

const DEFINIR_NAME = 'globalThis.__name = globalThis.__name || ((f) => f)'

async function contexto(b: Browser, vista: { ancho: number; alto: number; densidad?: number; tactil?: boolean }, perfil: Perfil, origen: string, repo: string, antes: string[], fuera: Set<string>): Promise<BrowserContext> {
  const ctx = await b.newContext({
    viewport: { width: vista.ancho, height: vista.alto },
    deviceScaleFactor: vista.densidad ?? 1,
    hasTouch: Boolean(vista.tactil),
    isMobile: Boolean(vista.tactil),
    serviceWorkers: 'block',
    reducedMotion: 'no-preference',
  })
  await ctx.addInitScript(DEFINIR_NAME)
  for (const a of antes) await ctx.addInitScript(a)
  await ctx.route('**/*', async (ruta) => {
    const url = ruta.request().url()
    if (url.startsWith(origen) || url.startsWith('data:') || url.startsWith('blob:')) return ruta.continue()
    for (const [prefijo, local] of Object.entries(perfil.reemplazos)) {
      if (!url.startsWith(prefijo)) continue
      const resto = url.slice(prefijo.length).split(/[?#]/)[0]!
      const archivo = path.join(repo, local + resto)
      if (existsSync(archivo) && statSync(archivo).isFile())
        return ruta.fulfill({ status: 200, contentType: MIMES[path.extname(archivo).toLowerCase()] ?? 'text/javascript; charset=utf-8', body: readFileSync(archivo) })
    }
    fuera.add(new URL(url).host)
    return ruta.abort('blockedbyclient')
  })
  return ctx
}

async function hacerAcciones(page: Page, p: PantallaPerfil) {
  for (const a of p.acciones ?? []) {
    if ('clic' in a) await page.click(a.clic, { timeout: 8000 })
    // corre aparte (sin esperar lo que devuelve: abrir una ventana devuelve una promesa que se cumple al cerrarla)
    else if ('evaluar' in a) await page.evaluate(`setTimeout(() => { ${a.evaluar} }, 0)`)
    else if ('tecla' in a) await page.keyboard.press(a.tecla)
    else if ('esperar' in a) {
      if (typeof a.esperar === 'number') await page.waitForTimeout(a.esperar)
      else await page.waitForSelector(a.esperar, { timeout: 15000, state: 'attached' })
    }
  }
}

export interface ResultadoPaginas {
  pantallas: number
  piezas: number
  fallas: string[]
}

export async function sacarPaginas(
  repo: string,
  perfil: Perfil,
  paquete: Paquete,
  hojasConocidas: Map<string, string>,
  o: { recetas?: string; solo?: string[]; log: (m: string) => void; excluidos?: Set<string> },
): Promise<ResultadoPaginas> {
  const excluidos = o.excluidos ?? new Set<string>()
  const { chromium } = await import('playwright-core')
  const enPagina = path.join(path.dirname(new URL(import.meta.url).pathname), 'en-pagina.mjs')
  const extras: Record<string, string> = { '/__telar/en-pagina.mjs': enPagina }
  if (o.recetas) extras['/__telar/recetas.mjs'] = o.recetas
  const srv = await servidorEstatico(repo, extras)
  const nav = await chromium.launch(process.env.TABLERO_CHROME ? { executablePath: process.env.TABLERO_CHROME, headless: true } : { channel: 'chrome', headless: true })
  const fallas: string[] = []
  const fuera = new Set<string>()
  let pantallas = 0
  let piezas = 0
  const paginasCreadas = new Set(paquete.paginas.map((p) => p.slug))
  const asegurarPagina = (nombre: string) => {
    const s = slug(nombre)
    if (!paginasCreadas.has(s)) {
      paquete.paginas.push({ nombre, slug: s, tipo: 'lienzo', datos: {} })
      paginasCreadas.add(s)
    }
    return s
  }
  // una hoja que no está en el perfil (por ejemplo la de una maqueta) se suma al paquete la primera vez que aparece
  const claveDeHoja = (archivo: string): string | null => {
    const ya = hojasConocidas.get(archivo)
    if (ya) return ya
    if (!existsSync(path.join(repo, archivo))) return null
    let clave = path.basename(archivo)
    if ([...hojasConocidas.values()].includes(clave)) clave = archivo.replace(/^.*?\/(?=[^/]+\/[^/]+$)/, '')
    const h = leerHoja(repo, archivo, clave)
    const { css, estados } = procesarHoja(repo, h, paquete, excluidos)
    const ruta = paquete.archivo(new TextEncoder().encode(css), 'css')
    const rutaEstados = paquete.archivo(new TextEncoder().encode(estados), 'css')
    paquete.item({ tipo: 'hoja', clave, nombre: clave, grupo: 'Hojas de la página', datos: { ruta, rutaEstados, reglas: h.reglas, peso: css.length, archivo } })
    hojasConocidas.set(archivo, clave)
    o.log(`  hoja de la página: ${archivo}`)
    return clave
  }
  const marcasAArchivos = (html: string, lienzos: string[]) =>
    html
      .replace(/\{\{archivo:([^}]+)\}\}/g, (_t, rel: string) => {
        const archivo = path.join(repo, rel.split(/[?#]/)[0]!)
        if (!existsSync(archivo) || !statSync(archivo).isFile() || excluidos.has(path.resolve(archivo))) return ''
        const ext = path.extname(archivo).slice(1).toLowerCase()
        if (!['png', 'webp', 'jpg', 'jpeg', 'gif', 'svg', 'avif'].includes(ext)) return ''
        return paquete.archivo(new Uint8Array(readFileSync(archivo)), ext)
      })
      .replace(/\{\{lienzo:(\d+)\}\}/g, (_t, n: string) => {
        const url = lienzos[Number(n)] ?? ''
        if (!url.startsWith('data:image/png;base64,')) return ''
        return paquete.archivo(new Uint8Array(Buffer.from(url.slice(22), 'base64')), 'png')
      })

  try {
    for (const p of perfil.pantallas) {
      if (o.solo && !o.solo.includes(p.clave)) continue
      for (const nombreVista of p.vistas) {
        const vista = perfil.vistas[nombreVista]
        if (!vista) {
          fallas.push(`${p.clave}: la vista «${nombreVista}» no está en el perfil`)
          continue
        }
        const antes = [perfil.antes, p.antes].filter((x): x is string => Boolean(x))
        const ctx = await contexto(nav, vista, perfil, srv.origen, repo, antes, fuera)
        const page = await ctx.newPage()
        const errores: string[] = []
        page.on('pageerror', (e) => errores.push(e.message.split('\n')[0]!))
        const t0 = Date.now()
        try {
          await page.goto(`${srv.origen}/${p.url.replace(/^\//, '')}`, { waitUntil: 'load', timeout: 30000 })
          await page.waitForSelector(p.esperar ?? p.raiz ?? 'body', { timeout: 20000, state: 'attached' })
          await hacerAcciones(page, p)
          const foto = (await page.evaluate(async (sel) => {
            const m = await import('/__telar/en-pagina.mjs' as string)
            return m.instantanea(sel)
          }, p.raiz ?? null)) as { html?: string; estiloRaiz?: Record<string, { clase: string; estilo: string }>; lienzos?: string[]; hojas?: string[]; error?: string }
          if (foto.error || !foto.html) throw new Error(foto.error ?? 'la instantánea salió vacía')
          const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' })
          const webp = (await page.evaluate(
            async ([b64]) => {
              const m = await import('/__telar/en-pagina.mjs' as string)
              return m.aWebp(`data:image/png;base64,${b64}`, 640, 0.82)
            },
            [png.toString('base64')],
          )) as string
          const miniatura = paquete.archivo(new Uint8Array(Buffer.from(webp.slice(webp.indexOf(',') + 1), 'base64')), 'webp')
          const hojas = (foto.hojas ?? []).map(claveDeHoja).filter((x): x is string => Boolean(x))
          const html = marcasAArchivos(foto.html, foto.lienzos ?? [])
          const estiloRaiz = JSON.parse(marcasAArchivos(JSON.stringify(foto.estiloRaiz ?? {}), [])) as Record<string, { clase: string; estilo: string }>
          const paginaNombre = paginaDeVista(p, nombreVista)
          paquete.marcos.push({
            clave: `pantalla:${nombreVista}/${p.clave}`,
            pagina: asegurarPagina(paginaNombre),
            nombre: p.nombre,
            seccion: p.seccion,
            ancho: vista.ancho,
            alto: vista.alto,
            html,
            css: '',
            hojas,
            datos: { vista: nombreVista, fondo: p.fondo, estiloRaiz, par: p.clave, nota: p.nota },
            miniatura,
          })
          pantallas++
          o.log(`  ✔ ${paginaNombre} · ${p.nombre} (${Date.now() - t0} ms${errores.length ? `, ${errores.length} errores de la página` : ''})`)
          if (errores.length) paquete.nota(`${p.clave} (${nombreVista}): la página tuvo errores: ${errores.slice(0, 3).join(' | ')}`)
        } catch (e) {
          const m = `${p.clave} (${nombreVista}): ${(e as Error).message.split('\n')[0]}`
          fallas.push(m)
          o.log(`  ✘ ${m}`)
        } finally {
          await ctx.close().catch(() => {})
        }
      }
    }

    // recetas de piezas
    if (o.recetas && !o.solo) {
      const primera = perfil.pantallas.find((x) => x.vistas.includes('pc')) ?? perfil.pantallas[0]
      const url = perfil.paginaRecetas ?? primera?.url
      const vista = perfil.vistas.pc ?? Object.values(perfil.vistas)[0]
      if (url && vista) {
        const ctx = await contexto(nav, vista, perfil, srv.origen, repo, [perfil.antes].filter((x): x is string => Boolean(x)), fuera)
        const page = await ctx.newPage()
        try {
          await page.goto(`${srv.origen}/${url.replace(/^\//, '')}`, { waitUntil: 'load', timeout: 30000 })
          await page.waitForSelector(primera?.raiz ?? 'body', { timeout: 20000, state: 'attached' })
          const r = (await page.evaluate(async () => {
            const m = await import('/__telar/en-pagina.mjs' as string)
            return m.recetas('/__telar/recetas.mjs')
          })) as { piezas: Record<string, any>[]; hojas: string[]; css: string }
          const hojas = r.hojas.map(claveDeHoja).filter((x): x is string => Boolean(x))
          asegurarPagina('Componentes')
          for (const pz of r.piezas) {
            if (pz.error) {
              fallas.push(`pieza ${pz.clave}: ${pz.error}`)
              continue
            }
            const variantes = Object.fromEntries(Object.entries(pz.variantes as Record<string, string>).map(([k, v]) => [k, marcasAArchivos(v, pz.lienzos)]))
            paquete.item({
              tipo: 'pieza',
              clave: pz.clave,
              nombre: pz.nombre,
              grupo: pz.grupo,
              datos: {
                variantes,
                css: '',
                hojas,
                propiedades: [{ nombre: 'variante', clase: 'variante', valores: Object.keys(variantes), defecto: Object.keys(variantes)[0] }],
                raizClase: pz.raizClase,
                escala: pz.escala,
                estados: pz.estados,
                descripcion: pz.nota,
              },
            })
            paquete.marcos.push({
              clave: `pieza:${pz.clave}`,
              pagina: 'componentes',
              nombre: pz.nombre,
              seccion: pz.grupo,
              ancho: Math.max(64, Math.min(8192, pz.ancho)),
              alto: Math.max(64, Math.min(8192, pz.alto)),
              html: marcasAArchivos(pz.html, pz.lienzos),
              css: r.css,
              hojas,
              datos: { fondo: '#ffffff', raizClase: pz.raizClase, escala: pz.escala, pieza: pz.clave },
            })
            piezas++
            o.log(`  ✔ Componentes · ${pz.nombre} (${Object.keys(variantes).length} variantes × ${pz.estados.length} estados)`)
          }
        } catch (e) {
          fallas.push(`recetas: ${(e as Error).message.split('\n')[0]}`)
        } finally {
          await ctx.close().catch(() => {})
        }
      }
    }
  } finally {
    await nav.close().catch(() => {})
    await srv.cerrar()
  }
  if (fuera.size) paquete.nota(`pedidos a otros sitios que se cortaron (sin red): ${[...fuera].join(', ')}`)
  return { pantallas, piezas, fallas }
}
