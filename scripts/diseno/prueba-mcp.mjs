// Prueba de punta a punta del MCP de Diseño (plan 7.5): levanta un Telar local con una carpeta de datos nueva, crea el
// proyecto "Estudio de prueba" (EP) con la tarjeta EP-1 y se conecta a /mcp como cualquier cliente (cliente oficial de MCP
// por HTTP, con la clave). Corre los 13 pasos y comprueba cada uno. Al final saca la captura M1 de la página armada.
//   npm run diseno:probar-mcp [-- --salida docs/capturas/diseno] [--sin-captura] [--puerto 4391]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { clienteApi, conectarMcp, levantarTelar, medidasPng, RAIZ } from './comun.mjs'

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : d
}
const salida = path.resolve(RAIZ, opcion('salida', '.tmp/prueba-mcp'))
const puerto = Number(opcion('puerto', 4391))
mkdirSync(salida, { recursive: true })

const t0 = Date.now()
const pasos = []
let fallas = 0
function paso(n, que, ok, detalle = '') {
  pasos.push({ n, que, ok, detalle, ms: Date.now() - t0 })
  if (!ok) fallas++
  console.log(`${ok ? '✔' : '✘'} ${String(n).padStart(2)} · ${que}${detalle ? ` — ${detalle}` : ''}`)
}
const guardar = (nombre, img) => img && writeFileSync(path.join(salida, nombre), img.bytes)

const telar = await levantarTelar({ puerto })
const api = clienteApi(telar.base, telar.clave)
let mcp
try {
  // ── preparación: proyecto EP, tarjeta EP-1 ──
  const proyecto = await api('POST', '/api/proyectos', { nombre: 'Estudio de prueba', prefijo: 'EP', color: 'naranja', tipo: 'completo' })
  const tablero = proyecto.tableros[0]
  const tarjeta = await api('POST', '/api/tarjetas', { tableroId: tablero.id, titulo: 'Campaña de prueba: hamburguesería', tipo: 'epica' })
  if (tarjeta.clave !== 'EP-1') throw new Error(`La tarjeta salió ${tarjeta.clave}`)
  mcp = await conectarMcp(telar.base, telar.clave, 'Prueba MCP')
  const { tools } = await mcp.cliente.listTools()
  const nuestras = ['leer_diseno', 'buscar_en_diseno', 'ver_diseno', 'crear_marco', 'editar_marco', 'duplicar_marco', 'definir_tokens', 'definir_pieza', 'subir_activo', 'organizar_diseno', 'comentar_diseno', 'exportar_diseno', 'sincronizar_diseno']
  const faltan = nuestras.filter((n) => !tools.some((t) => t.name === n))
  paso(0, `el MCP lista las 13 herramientas de Diseño (${tools.length} en total)`, faltan.length === 0, faltan.length ? `faltan ${faltan.join(', ')}` : '')
  // la guía para IAs: listada primero, con su ejemplo y esquema estricto; su tema de Diseño trae lo aprendido
  const guia = tools.find((t) => t.name === 'leer_guia')
  const rg = await mcp.llamar('leer_guia', { tema: 'diseno' })
  paso(
    '0b',
    'leer_guia está listada (primera, con su ejemplo y esquema estricto) y da la guía de Diseño',
    tools[0]?.name === 'leer_guia' && /Ejemplo/.test(guia?.description ?? '') && guia?.inputSchema?.additionalProperties === false && !rg.error && /definir_tokens/.test(rg.texto) && /ver_diseno/.test(rg.texto) && /excluir/.test(rg.texto),
    rg.error ? rg.texto : `${rg.texto.length} caracteres`,
  )

  // 1
  let r = await mcp.llamar('leer_diseno', { proyecto: 'EP' })
  paso(1, 'leer_diseno: mapa vacío con Fundamentos', !r.error && /Fundamentos/.test(r.texto) && /Sin importar|sistema/i.test(r.texto), r.error ? r.texto : '')

  // 2
  r = await mcp.llamar('definir_tokens', {
    proyecto: 'EP',
    tokens: [
      { nombre: 'color/marca/primario', valor: '#d2663a', uso: 'Botones y realces' },
      { nombre: 'color/marca/crema', valor: '#fbf3e4' },
      { nombre: 'color/marca/tinta', valor: '#2b2118' },
      { nombre: 'color/marca/verde', valor: '#3f8f4f' },
      { nombre: 'color/marca/mostaza', valor: '#e8b730' },
    ],
    estilos_de_texto: [
      { nombre: 'Título', familia: 'Figtree', peso: 800, tamano: '96px', interlineado: '1.02' },
      { nombre: 'Bajada', familia: 'Figtree', peso: 500, tamano: '44px', interlineado: '1.25' },
    ],
  })
  const r2 = await mcp.llamar('leer_diseno', { proyecto: 'EP', sistema: 'tokens' })
  paso(2, 'definir_tokens: devuelve las variables y leer_diseno las lista', !r.error && /var\(--color-marca-primario\)/.test(r.texto) && /\.?t-titulo/.test(r.texto) && /color\/marca\/crema/.test(r2.texto), r.error ? r.texto : '')

  // 3 (y la fuente del proyecto)
  const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 64" width="220" height="64"><rect width="220" height="64" rx="14" fill="#2b2118"/><circle cx="32" cy="32" r="18" fill="#e8b730"/><text x="62" y="42" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#fbf3e4">Burguesa</text></svg>`
  r = await mcp.llamar('subir_activo', { proyecto: 'EP', nombre: 'logo', grupo: 'Marca', base64: Buffer.from(logo).toString('base64'), mime: 'image/svg+xml' })
  const rutaLogo = /(\/archivos\/diseno\/[^\s]+\.svg)/.exec(r.texto)?.[1]
  const figtree = readFileSync(path.join(RAIZ, 'node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2'))
  const rf = await mcp.llamar('subir_activo', { proyecto: 'EP', nombre: 'Figtree', base64: figtree.toString('base64'), mime: 'font/woff2', familia: 'Figtree', pesos: '300 900' })
  paso(3, 'subir_activo: el logo queda bajo /archivos/diseno/ (y la fuente Figtree)', !r.error && Boolean(rutaLogo) && !rf.error, r.error ? r.texto : rf.error ? rf.texto : rutaLogo)

  // 4
  r = await mcp.llamar('definir_pieza', {
    proyecto: 'EP',
    nombre: 'boton',
    html: `<a class="boton"><span>{{etiqueta}}</span></a>`,
    css: `.boton{display:inline-flex;align-items:center;padding:2.2cqw 5cqw;border-radius:999px;background:var(--color-marca-primario);color:#fff;font:700 4cqw/1 "Figtree",sans-serif;text-decoration:none;white-space:nowrap} [data-color="verde"] .boton{background:var(--color-marca-verde)}`,
    propiedades: [
      { nombre: 'color', clase: 'variante', valores: ['naranja', 'verde'], defecto: 'naranja' },
      { nombre: 'etiqueta', clase: 'texto', defecto: 'Pedí ahora' },
    ],
    ver: true,
  })
  guardar('paso4-hoja-boton.png', r.imagenes[0])
  paso(4, 'definir_pieza "boton": crea su hoja de variantes', !r.error && /Hoja de variantes/.test(r.texto) && r.imagenes.length === 1, r.error ? r.texto : '')

  // 5
  const html5 = `<div class="fondo" data-nombre="Fondo"><img class="logo" data-nombre="Logo" src="${rutaLogo}" alt="Burguesa"><h1 class="t-titulo titulo" data-nombre="Título">2x1 en hamburguesas</h1><p class="t-bajada bajada" data-nombre="Bajada">Solo este finde, en todos los locales</p><div data-pieza="boton" data-nombre="Botón" data-props='{"color":"naranja","etiqueta":"Pedí ahora"}'></div></div>`
  const css5 = `.fondo{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:4cqh;padding:8cqw;background:var(--color-marca-crema);color:var(--color-marca-tinta)} .logo{width:24cqw;height:auto} .titulo{margin:0;width:100%;max-height:30cqh;overflow:hidden;font-size:11cqw} .bajada{margin:0;font-size:4.4cqw}`
  r = await mcp.llamar('crear_marco', { proyecto: 'EP', pagina: 'Campaña de prueba', nombre: 'Posteo · 2x1', tamano: 'instagram-posteo', html: html5, css: css5, tarjetas: ['EP-1'], seccion: 'Lanzamiento', ver: true })
  const idPosteo = /\b(m_[a-z0-9]{8})\b/.exec(r.texto)?.[1]
  const img5 = r.imagenes[0]
  const m5 = img5 ? medidasPng(img5.bytes) : null
  guardar('paso5-posteo.png', img5)
  paso(5, 'crear_marco posteo 1080×1080 con tokens, logo, pieza y EP-1: imagen de 1024 px, sin avisos', !r.error && Boolean(idPosteo) && m5?.ancho === 1024 && m5?.alto === 1024 && /Avisos: ninguno/.test(r.texto), r.error ? r.texto : `${idPosteo} · ${m5?.ancho}×${m5?.alto} · ${/Avisos: ninguno/.test(r.texto) ? 'sin avisos' : r.texto.split('\n').filter((l) => l.startsWith('- ')).join(' | ')}`)

  // 6
  const antes6 = (await api('GET', '/api/diseno/EP/paginas/campana-de-prueba')).marcos.length
  r = await mcp.llamar('crear_marco', { proyecto: 'EP', pagina: 'Campaña de prueba', nombre: 'Malo', tamano: 'instagram-posteo', html: `<script>alert(1)</script><img src="https://ejemplo.com/foto.jpg">` })
  const despues6 = (await api('GET', '/api/diseno/EP/paginas/campana-de-prueba')).marcos.length
  paso(6, 'crear_marco con <script> e imagen de afuera: error claro que nombra subir_activo; no se crea nada', r.error && /subir_activo/.test(r.texto) && /script/.test(r.texto) && antes6 === despues6, r.texto.replace(/\n/g, ' ').slice(0, 160))

  // 7
  const arbol = await mcp.llamar('leer_diseno', { proyecto: 'EP', marco: idPosteo })
  const idTitulo = /\n\s*([a-z0-9]{6}) h1\b/.exec(arbol.texto)?.[1]
  r = await mcp.llamar('editar_marco', {
    proyecto: 'EP',
    marco: idPosteo,
    operaciones: [{ op: 'texto', capa: idTitulo, texto: '2x1 en hamburguesas dobles con cheddar, panceta crocante y papas fritas para compartir con toda la familia este fin de semana largo' }],
  })
  const cortado = /texto cortado/.test(r.texto)
  const r7 = await mcp.llamar('editar_marco', { proyecto: 'EP', marco: idPosteo, operaciones: [{ op: 'estilo', capa: idTitulo, estilos: { 'font-size': '4.5cqw' } }], ver: true })
  guardar('paso7-arreglado.png', r7.imagenes[0])
  paso(7, 'editar_marco: un título larguísimo da "texto cortado"; se arregla con estilo y vuelve sin avisos', !r.error && cortado && !r7.error && /Avisos: ninguno/.test(r7.texto), `${idTitulo} · ${cortado ? 'aviso de texto cortado' : 'NO avisó'} · ${/Avisos: ninguno/.test(r7.texto) ? 'arreglado' : r7.texto.split('\n').filter((l) => l.startsWith('- ')).join(' | ')}`)
  // se vuelve al título corto para lo que sigue
  await mcp.llamar('editar_marco', { proyecto: 'EP', marco: idPosteo, operaciones: [{ op: 'texto', capa: idTitulo, texto: '2x1 en hamburguesas' }, { op: 'estilo', capa: idTitulo, estilos: { 'font-size': null } }] })

  // 8
  r = await mcp.llamar('duplicar_marco', { proyecto: 'EP', marco: idPosteo, tamanos: ['instagram-historia', 'anuncio-300x250', 'anuncio-728x90'] })
  const variantes = [...new Set([...r.texto.matchAll(/\b(m_[a-z0-9]{8})\b/g)].map((m) => m[1]))].filter((id) => id !== idPosteo)
  const grupo = /grupo (g_[a-z0-9]{8})/.exec(r.texto)?.[1]
  const g8 = await mcp.llamar('ver_diseno', { proyecto: 'EP', marcos: [idPosteo, ...variantes] })
  guardar('paso8-grilla.png', g8.imagenes[0])
  paso(8, 'duplicar_marco a historia, 300×250 y 728×90: tres marcos del mismo grupo y la grilla', !r.error && variantes.length === 3 && Boolean(grupo) && g8.imagenes.length === 1 && !g8.error, `${variantes.join(', ')} · ${grupo}`)

  // 9
  const vista1 = await mcp.llamar('ver_diseno', { proyecto: 'EP', marco: idPosteo })
  await mcp.llamar('definir_tokens', { proyecto: 'EP', tokens: [{ nombre: 'color/marca/primario', valor: '#1f6fd1' }] })
  const vista2 = await mcp.llamar('ver_diseno', { proyecto: 'EP', marco: idPosteo })
  guardar('paso9-antes.png', vista1.imagenes[0])
  guardar('paso9-despues.png', vista2.imagenes[0])
  paso(9, 'definir_tokens cambia el primario: la captura del posteo cambia', vista1.imagenes[0] && vista2.imagenes[0] && !vista1.imagenes[0].bytes.equals(vista2.imagenes[0].bytes))

  // 10
  const c = await mcp.llamar('comentar_diseno', { proyecto: 'EP', en: `${idPosteo}#${idTitulo}`, texto: '¿Probamos el título en mostaza?', punto: { x: 120, y: 520 } })
  const o = await mcp.llamar('organizar_diseno', {
    proyecto: 'EP',
    acciones: [
      { accion: 'anotar', que: idPosteo, uso: 'Feed de Instagram', estado: 'revisar' },
      { accion: 'mover_marcos', marcos: variantes, seccion: 'Variantes' },
      { accion: 'vincular', que: variantes[0], tarjeta: 'EP-1' },
    ],
  })
  const lista = await mcp.llamar('comentar_diseno', { proyecto: 'EP' })
  const pag = await mcp.llamar('leer_diseno', { proyecto: 'EP', pagina: 'Campaña de prueba' })
  paso(10, 'comentar_diseno y organizar_diseno (anotar, mover a una sección, vincular): se leen de vuelta', !c.error && !o.error && /mostaza/.test(lista.texto) && /── Variantes ──/.test(pag.texto), [c.texto, o.error ? o.texto : ''].join(' ').slice(0, 140))

  // 11
  r = await mcp.llamar('exportar_diseno', { proyecto: 'EP', marcos: [idPosteo, ...variantes], formato: 'png', escala: 2, adjuntar_a: 'EP-1' })
  const ep1 = await api('GET', '/api/tarjetas/EP-1')
  const medidas = []
  for (const a of ep1.adjuntos) {
    const b = Buffer.from(await (await fetch(`${telar.base}${a.url}`)).arrayBuffer())
    const m = medidasPng(b)
    medidas.push(m ? `${m.ancho}×${m.alto}` : '?')
  }
  const esperadas = ['2160×2160', '2160×3840', '600×500', '1456×180']
  paso(11, 'exportar_diseno png 2x adjuntado a EP-1: 4 adjuntos de las medidas correctas', !r.error && ep1.adjuntos.length === 4 && esperadas.every((x) => medidas.includes(x)), medidas.join(', '))

  // 12: un marco importado (una importación chiquita por la API, con la clave)
  const imp = await api('POST', '/api/diseno/EP/importar/empezar', { origen: { repo: 'prueba', rama: 'main', commit: 'abc1234' }, archivos: [] })
  await api('POST', '/api/diseno/EP/importar/lote', {
    n: imp.n,
    paginas: [{ nombre: 'Pantallas', slug: 'pantallas', tipo: 'lienzo', datos: {} }],
    marcos: [{ clave: 'pantalla:prueba/inicio', pagina: 'pantallas', nombre: 'Inicio', seccion: 'Web', ancho: 390, alto: 844, html: '<main><h1>Inicio</h1></main>', css: 'h1{font:700 32px system-ui}', datos: { fondo: '#ffffff' } }],
  })
  const fin = await api('POST', '/api/diseno/EP/importar/terminar', { n: imp.n })
  r = await mcp.llamar('editar_marco', { proyecto: 'EP', marco: 'Inicio', operaciones: [{ op: 'css', css: 'h1{color:red}' }] })
  paso(12, 'editar_marco sobre un marco importado: error con la indicación de duplicar_marco', r.error && /duplicar_marco/.test(r.texto), `${fin.cambios} cambios importados · ${r.texto.slice(0, 90)}`)

  // 13
  const b = await mcp.llamar('buscar_en_diseno', { proyecto: 'EP', consulta: '#1f6fd1' })
  const lm = await mcp.llamar('leer_diseno', { proyecto: 'EP', marco: idPosteo })
  const capa = await mcp.llamar('leer_diseno', { proyecto: 'EP', marco: idPosteo, capa: idTitulo })
  paso(13, 'buscar_en_diseno por color encuentra el token; leer_diseno marco trae las cajas (y la capa, sus reglas)', /color\/marca\/primario/.test(b.texto) && /0,0 1080×1080/.test(lm.texto) && /Este marco/.test(capa.texto), `${b.texto.split('\n')[1]?.trim().slice(0, 80)}`)

  const s = await mcp.llamar('sincronizar_diseno', { proyecto: 'EP' })
  writeFileSync(path.join(salida, 'respuestas.txt'), [arbol.texto, '', lm.texto, '', capa.texto, '', pag.texto, '', s.texto].join('\n\n'))

  // M1: la página armada, en la app
  if (!args.includes('--sin-captura')) {
    try {
      const { chromium } = await import('playwright-core')
      const nav = await chromium.launch({ channel: 'chrome', headless: true })
      const pagina = await nav.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
      await pagina.addInitScript(() => localStorage.setItem('tablero.tema', 'claro'))
      await pagina.goto(`${telar.base}/EP/pendientes/diseno/campana-de-prueba`, { waitUntil: 'networkidle' })
      await pagina.waitForSelector('.dz-marco', { timeout: 15000 })
      await pagina.waitForTimeout(2500)
      await pagina.screenshot({ path: path.join(salida, 'M1-pagina-prueba-mcp.png') })
      await nav.close()
      paso(14, 'captura M1 de la página "Campaña de prueba"', true, path.relative(RAIZ, path.join(salida, 'M1-pagina-prueba-mcp.png')))
    } catch (e) {
      paso(14, 'captura M1 de la página "Campaña de prueba"', false, e.message.split('\n')[0])
    }
  }
} catch (e) {
  paso(99, 'la prueba se cortó', false, e.stack ?? String(e))
} finally {
  await mcp?.cerrar().catch(() => {})
  await telar.cerrar()
}
const total = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n${fallas ? `✘ ${fallas} paso(s) fallaron` : '✔ todo bien'} en ${total} s · imágenes en ${path.relative(RAIZ, salida)}`)
writeFileSync(path.join(salida, 'informe.json'), JSON.stringify({ pasos, segundos: Number(total) }, null, 2))
process.exit(fallas ? 1 : 0)
