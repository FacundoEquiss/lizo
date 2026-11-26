// Datos de prueba para Diseño (plan PD-0): un proyecto con 3 páginas, 12 marcos y unos 40 ítems, por la API de un Telar
// LOCAL. Se niega a correr contra otra cosa que 127.0.0.1 o localhost.
//   npm run diseno:sembrar -- [--url http://127.0.0.1:4318] [--proyecto EP]
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { clienteApi, RAIZ } from './comun.mjs'

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : d
}
const base = opcion('url', `http://127.0.0.1:${process.env.TABLERO_PUERTO || 4318}`)
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
  console.error('sembrar.mjs solo corre contra un Telar local (127.0.0.1 o localhost).')
  process.exit(1)
}
const prefijo = opcion('proyecto', 'EP')
const api = clienteApi(base)

const proyectos = await api('GET', '/api/proyectos')
let p = proyectos.find((x) => x.prefijo === prefijo)
if (!p) p = await api('POST', '/api/proyectos', { nombre: 'Estudio de prueba', prefijo, color: 'violeta', tipo: 'completo' })
const D = `/api/diseno/${prefijo}`

// ── sistema: 20 colores, 6 medidas, 4 sombras, 3 estilos de texto ──
const colores = {
  'color/marca/primario': '#d2663a', 'color/marca/secundario': '#2f6fde', 'color/marca/crema': '#fbf3e4', 'color/marca/tinta': '#2b2118',
  'color/marca/mostaza': '#e8b730', 'color/marca/verde': '#3f8f4f', 'color/neutro/0': '#ffffff', 'color/neutro/50': '#f6f4f1',
  'color/neutro/100': '#ebe7e1', 'color/neutro/300': '#c9c2b8', 'color/neutro/500': '#8f877c', 'color/neutro/700': '#5d564d',
  'color/neutro/900': '#29241e', 'color/estado/ok': '#3f8f4f', 'color/estado/aviso': '#e2b52c', 'color/estado/error': '#c4473a',
  'color/fondo/claro': '#fffdf9', 'color/fondo/oscuro': '#1a1b1d', 'color/realce/rosa': '#d9649a', 'color/realce/celeste': '#38a7c0',
}
const tokens = [
  ...Object.entries(colores).map(([nombre, valor]) => ({ nombre, valor })),
  { nombre: 'espacio/s', valor: '8px' }, { nombre: 'espacio/m', valor: '16px' }, { nombre: 'espacio/l', valor: '32px' },
  { nombre: 'radio/s', valor: '8px' }, { nombre: 'radio/m', valor: '16px' }, { nombre: 'radio/pildora', valor: '999px' },
  { nombre: 'sombra/1', valor: '0 1px 3px rgba(43,33,24,.12)', clase: 'sombra' }, { nombre: 'sombra/2', valor: '0 6px 18px -4px rgba(43,33,24,.22)', clase: 'sombra' },
  { nombre: 'sombra/3', valor: '0 18px 40px -12px rgba(43,33,24,.35)', clase: 'sombra' }, { nombre: 'sombra/dura', valor: '4px 4px 0 #2b2118', clase: 'sombra' },
]
await api('POST', `${D}/tokens`, {
  tokens,
  estilos: [
    { nombre: 'Título', familia: 'Figtree', peso: 800, tamano: '96px', interlineado: '1.02' },
    { nombre: 'Subtítulo', familia: 'Figtree', peso: 700, tamano: '48px', interlineado: '1.1' },
    { nombre: 'Cuerpo', familia: 'Figtree', peso: 500, tamano: '28px', interlineado: '1.35' },
  ],
})

// ── fuente y activos ──
async function subir(nombre, bytes, mime, extra = {}) {
  const f = new FormData()
  f.append('archivo', new Blob([bytes], { type: mime }), nombre)
  f.append('nombre', nombre.replace(/\.\w+$/, ''))
  for (const [k, v] of Object.entries(extra)) f.append(k, v)
  const r = await fetch(`${base}${D}/activos`, { method: 'POST', body: f })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
await subir('Figtree.woff2', readFileSync(path.join(RAIZ, 'node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2')), 'font/woff2', { familia: 'Figtree', pesos: '300 900' })
const svg = (fondo, texto) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 64" width="220" height="64"><rect width="220" height="64" rx="14" fill="${fondo}"/><circle cx="32" cy="32" r="18" fill="#e8b730"/><text x="62" y="42" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#fbf3e4">${texto}</text></svg>`
const logo = await subir('logo.svg', svg('#2b2118', 'Burguesa'), 'image/svg+xml', { grupo: 'Marca' })
await subir('logo-claro.svg', svg('#d2663a', 'Burguesa'), 'image/svg+xml', { grupo: 'Marca' })
for (const [i, c] of ['#d2663a', '#2f6fde', '#3f8f4f', '#e8b730'].entries())
  await subir(`icono-${i + 1}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><rect x="4" y="4" width="40" height="40" rx="12" fill="${c}"/><path d="M14 25l7 7 13-15" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`, 'image/svg+xml', { grupo: 'Íconos' })

// ── piezas ──
await api('POST', `${D}/piezas`, {
  nombre: 'boton',
  html: `<a class="boton"><span>{{etiqueta}}</span></a>`,
  css: `.boton{display:inline-flex;align-items:center;gap:.5em;padding:.6em 1.4em;border-radius:var(--radio-pildora);background:var(--color-marca-primario);color:#fff;font:700 4cqw/1 "Figtree",sans-serif;white-space:nowrap;box-shadow:var(--sombra-2)} [data-color="verde"] .boton{background:var(--color-marca-verde)} [data-color="tinta"] .boton{background:var(--color-marca-tinta)}`,
  propiedades: [{ nombre: 'color', clase: 'variante', valores: ['naranja', 'verde', 'tinta'], defecto: 'naranja' }, { nombre: 'etiqueta', clase: 'texto', defecto: 'Pedí ahora' }],
})
await api('POST', `${D}/piezas`, {
  nombre: 'etiqueta',
  html: `<span class="etq"><b data-si="punto"></b>{{texto}}</span>`,
  css: `.etq{display:inline-flex;align-items:center;gap:.4em;padding:.35em .8em;border-radius:999px;background:var(--color-marca-mostaza);color:var(--color-marca-tinta);font:700 2.6cqw/1 "Figtree",sans-serif;text-transform:uppercase;letter-spacing:.04em} .etq b{width:.55em;height:.55em;border-radius:50%;background:var(--color-marca-primario)}`,
  propiedades: [{ nombre: 'texto', clase: 'texto', defecto: 'Nuevo' }, { nombre: 'punto', clase: 'booleano', defecto: true }],
})
await api('POST', `${D}/piezas`, {
  nombre: 'Historia promo',
  clase: 'plantilla',
  tamano: 'instagram-historia',
  html: `<div class="hp" data-nombre="Fondo"><img class="hp-logo" data-nombre="Logo" src="${logo.ruta}"><div class="hp-texto"><div data-pieza="etiqueta" data-props='{"texto":"{{etiqueta}}"}'></div><h1 class="t-titulo" data-nombre="Título">{{titulo}}</h1><p class="t-cuerpo" data-nombre="Bajada">{{bajada}}</p></div><div data-pieza="boton" data-props='{"etiqueta":"{{boton}}"}'></div></div>`,
  css: `.hp{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;padding:9cqw 8cqw 12cqw;background:linear-gradient(180deg,var(--color-marca-crema) 0 62%,var(--color-marca-mostaza) 62%)} .hp-logo{width:30cqw} .hp-texto{display:flex;flex-direction:column;gap:3cqw} .hp h1{margin:0;font-size:12cqw} .hp p{margin:0;font-size:5cqw;color:var(--color-neutro-700)}`,
})

// ── 12 marcos en 2 páginas propias (la tercera es Piezas, con las hojas de variantes) ──
const posteo = (titulo, bajada, fondo = 'var(--color-marca-crema)') => ({
  html: `<div class="fondo" data-nombre="Fondo"><img class="logo" data-nombre="Logo" src="${logo.ruta}"><h1 class="t-titulo titulo" data-nombre="Título">${titulo}</h1><p class="t-cuerpo" data-nombre="Bajada">${bajada}</p><div data-pieza="boton" data-nombre="Botón" data-props='{"etiqueta":"Pedí ahora"}'></div></div>`,
  css: `.fondo{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:4cqh;padding:8cqw;background:${fondo};color:var(--color-marca-tinta)} .logo{width:24cqw} .titulo{margin:0;font-size:11cqw} .t-cuerpo{margin:0;font-size:4.4cqw}`,
})
const campaña = [
  ['Posteo · 2x1', 'instagram-posteo', '2x1 en hamburguesas', 'Solo este finde'],
  ['Posteo · Combo', 'instagram-posteo', 'Combo doble con papas', 'Todos los martes'],
  ['Vertical · Papas', 'instagram-vertical', 'Papas rústicas', 'Con alioli de la casa'],
  ['Historia · Lanzamiento', 'instagram-historia', 'Abrimos en Palermo', 'Te esperamos el sábado'],
  ['Banner · 300×250', 'anuncio-300x250', 'Pedí online', 'Envío gratis'],
  ['Banner · 728×90', 'anuncio-728x90', 'Burguesa', 'Pedí ahora'],
]
for (const [nombre, tamano, titulo, bajada] of campaña) await api('POST', `${D}/marcos`, { pagina: 'Campaña de verano', nombre, tamano, seccion: 'Lanzamiento', ...posteo(titulo, bajada) })
await api('POST', `${D}/marcos`, { pagina: 'Campaña de verano', nombre: 'Historia · desde plantilla', seccion: 'Plantillas', plantilla: 'historia-promo', ranuras: { etiqueta: 'Nuevo', titulo: 'Smash burger', bajada: 'Doble carne, doble cheddar', boton: 'Probala' } })
const pantalla = (titulo) => ({
  html: `<header class="cab" data-nombre="Cabecera"><img src="${logo.ruta}" class="logo" data-nombre="Logo"><nav data-nombre="Menú"><a>Menú</a><a>Locales</a><a>Pedidos</a></nav></header><main class="hero" data-nombre="Hero"><h1 class="t-titulo">${titulo}</h1><p class="t-cuerpo">Hamburguesas hechas al momento, con pan de papa.</p><div data-pieza="boton" data-props='{"etiqueta":"Ver el menú"}'></div></main>`,
  css: `body{background:var(--color-fondo-claro)} .cab{display:flex;align-items:center;justify-content:space-between;padding:24px 48px} .logo{height:44px} nav{display:flex;gap:28px;font:600 18px Figtree,sans-serif} .hero{padding:80px 48px;display:flex;flex-direction:column;gap:24px;max-width:900px} .hero h1{margin:0;font-size:88px} .hero p{margin:0;font-size:26px;color:var(--color-neutro-700)}`,
})
for (const [nombre, tamano] of [['Inicio · escritorio', 'escritorio'], ['Inicio · portátil', 'portatil'], ['Inicio · tablet', 'tablet'], ['Inicio · celular', 'celular']])
  await api('POST', `${D}/marcos`, { pagina: 'Web', nombre, tamano, seccion: 'Inicio', ...pantalla('La hamburguesa del barrio') })
const resumen = await api('GET', D)
console.log(`Listo: ${resumen.paginas.map((x) => `${x.nombre} (${x.marcos})`).join(', ')} · ${Object.entries(resumen.conteo).map(([k, v]) => `${v} ${k}`).join(', ')}`)
console.log(`${base.replace(/:\d+$/, ':' + (process.env.TABLERO_PUERTO_WEB || 4317))}/${prefijo}/pendientes/diseno`)
