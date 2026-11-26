// Íconos, pantallas de arranque y manifest de la PWA (plan del celular, 9.2 a 9.4). Se generan desde la marca y desde
// tokens.css (nunca colores escritos a mano: el día que cambie un token, se corre esto de nuevo y queda al día).
//
//   npm run pwa:iconos       genera web/public/pwa/*, web/public/manifest.webmanifest y el bloque de index.html
//   npm run pwa:verificar    no escribe nada: falla si algo de lo generado no coincide con tokens.css o con la marca
//
// La marca sale de web/public/marca/telar.svg (y telar-glifo.svg, si está), que define el plan de escritorio. Si todavía
// no existe, se usa web/public/icono.svg, se avisa "MARCA PROVISORIA" y queda anotado en web/public/pwa/ORIGEN.txt:
// cuando llegue la marca definitiva, alcanza con correr esto otra vez.
import sharp from 'sharp'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const PUBLICO = path.join(RAIZ, 'web', 'public')
const SALIDA = path.join(PUBLICO, 'pwa')
const INDEX = path.join(RAIZ, 'web', 'index.html')
const MANIFEST = path.join(PUBLICO, 'manifest.webmanifest')
const VERIFICAR = process.argv.includes('--verificar')

// Pantallas de iPhone en vertical (puntos y densidad). Lista del plan, al día con la línea iPhone 17 / Air.
const PANTALLAS = [
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [428, 926, 3], // 12 y 13 Pro Max, 14 Plus
  [420, 912, 3], // iPhone Air
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [390, 844, 3], // 12, 13, 14, 16e
  [375, 812, 3], // X, XS, 11 Pro, 12 y 13 mini
  [375, 667, 2], // SE (2.ª y 3.ª)
]

// Íconos de los accesos directos (lucide, 24×24, trazo).
const GLIFOS_ATAJOS = {
  nueva: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  buscar: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  lienzo: '<line x1="22" x2="2" y1="6" y2="6"/><line x1="22" x2="2" y1="18" y2="18"/><line x1="6" x2="6" y1="2" y2="22"/><line x1="18" x2="18" y1="2" y2="22"/>',
}

// ───────── Colores de tokens.css ─────────

function leerTokens() {
  const css = readFileSync(path.join(RAIZ, 'web', 'src', 'estilos', 'tokens.css'), 'utf8')
  const bloque = (re, nombre) => {
    const m = css.match(re)
    if (!m) throw new Error(`No encontré el bloque del tema ${nombre} en tokens.css`)
    return m[1]
  }
  const valor = (b, token, nombre) => {
    const m = b.match(new RegExp(`${token}:\\s*([^;]+);`))
    if (!m) throw new Error(`No encontré ${token} en el tema ${nombre}`)
    return m[1].trim()
  }
  const claro = bloque(/:root,\s*\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/, 'claro')
  const oscuro = bloque(/\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/, 'oscuro')
  return {
    claro: { fondo: valor(claro, '--c-fondo', 'claro'), texto: valor(claro, '--c-texto', 'claro') },
    oscuro: { fondo: valor(oscuro, '--c-fondo', 'oscuro'), texto: valor(oscuro, '--c-texto', 'oscuro') },
  }
}

// ───────── Marca ─────────

function leerMarca() {
  const maestro = path.join(PUBLICO, 'marca', 'telar.svg')
  const glifo = path.join(PUBLICO, 'marca', 'telar-glifo.svg')
  if (existsSync(maestro))
    return {
      provisoria: false,
      origen: 'web/public/marca/telar.svg',
      svg: readFileSync(maestro, 'utf8'),
      glifo: existsSync(glifo) ? readFileSync(glifo, 'utf8') : null,
    }
  return { provisoria: true, origen: 'web/public/icono.svg', svg: readFileSync(path.join(PUBLICO, 'icono.svg'), 'utf8'), glifo: null }
}

/** El color de fondo del ícono: el del primer <rect> de la marca (no se escribe a mano). */
function fondoDe(svg) {
  const m = /<rect\b[^>]*\bfill="(#[0-9a-fA-F]{3,8})"/.exec(svg)
  if (!m) throw new Error('La marca no tiene un <rect> de fondo con fill.')
  return m[1]
}

const conTamano = (svg, tam) => svg.replace(/<svg\b/, `<svg width="${tam}" height="${tam}"`)
const pintado = (svg, color) => svg.replaceAll('currentColor', color)

async function render(svg, tam) {
  return sharp(Buffer.from(conTamano(svg, tam))).resize(tam, tam).png().toBuffer()
}

async function sobreFondo(ancho, alto, color, capa, lado) {
  const dibujo = await render(capa, Math.round(lado))
  return sharp({ create: { width: ancho, height: alto, channels: 4, background: color } })
    .composite([{ input: dibujo, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

function glifoAtajo(cuerpo, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${cuerpo}</svg>`
}

// ───────── Qué se genera ─────────

async function generar() {
  const tokens = leerTokens()
  const marca = leerMarca()
  const fondo = fondoDe(marca.svg)
  const archivos = new Map() // nombre → Buffer

  archivos.set('favicon-32.png', await render(marca.svg, 32))
  for (const t of [192, 512]) archivos.set(`icono-${t}.png`, await render(marca.svg, t))
  // Enmascarable: fondo a sangre y el dibujo dentro del círculo seguro del 80 % (el glifo al 62 %, como fija el plan de
  // escritorio; sin glifo, el ícono entero al 72 % sobre su propio color de fondo).
  for (const t of [192, 512]) {
    const capa = marca.glifo ? pintado(marca.glifo, tokens.claro.fondo) : marca.svg
    archivos.set(`icono-maskable-${t}.png`, await sobreFondo(t, t, fondo, capa, t * (marca.glifo ? 0.62 : 0.72)))
  }
  if (marca.glifo) archivos.set('icono-mono-512.png', await sobreFondo(512, 512, { r: 0, g: 0, b: 0, alpha: 0 }, pintado(marca.glifo, '#ffffff'), 512 * 0.62))
  // iOS: fondo opaco y sin esquinas redondeadas (las redondea iOS; lo transparente lo pinta de negro).
  archivos.set('apple-touch-icon.png', await sobreFondo(180, 180, fondo, marca.svg, 180))
  for (const [nombre, cuerpo] of Object.entries(GLIFOS_ATAJOS))
    archivos.set(`atajo-${nombre}-96.png`, await sobreFondo(96, 96, fondo, glifoAtajo(cuerpo, tokens.claro.fondo), 48))

  // Pantallas de arranque de iOS: el fondo de cada tema y la marca centrada a 96 puntos.
  const enlaces = []
  for (const [w, h, d] of PANTALLAS) {
    for (const [tema, nombreTema] of [
      ['claro', 'light'],
      ['oscuro', 'dark'],
    ]) {
      const colores = tokens[tema]
      const capa = marca.glifo ? pintado(marca.glifo, colores.texto) : marca.svg
      const imagen = await sharp(await sobreFondo(w * d, h * d, colores.fondo, capa, 96 * d))
        .png({ compressionLevel: 9, palette: true })
        .toBuffer()
      const nombre = `arranque-${w * d}x${h * d}-${tema}.png`
      archivos.set(nombre, imagen)
      enlaces.push(
        `    <link rel="apple-touch-startup-image" href="/pwa/${nombre}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${d}) and (orientation: portrait) and (prefers-color-scheme: ${nombreTema})" />`,
      )
    }
  }

  // Manifest: la base más los colores del tema claro (el de fábrica). Solo los íconos y capturas que existen.
  const base = JSON.parse(readFileSync(path.join(RAIZ, 'web', 'pwa', 'manifest.base.json'), 'utf8'))
  const manifest = {
    ...base,
    background_color: tokens.claro.fondo,
    theme_color: tokens.claro.fondo,
    icons: base.icons.filter((i) => archivos.has(path.basename(i.src))),
    screenshots: base.screenshots.filter((s) => existsSync(path.join(PUBLICO, s.src))),
  }
  const textoManifest = JSON.stringify(manifest, null, 2) + '\n'

  // index.html: los dos theme-color del primer cuadro y el bloque de pantallas de arranque.
  let html = readFileSync(INDEX, 'utf8')
  html = html
    .replace(/(<meta name="theme-color" content=")[^"]*(" media="\(prefers-color-scheme: light\)")/, `$1${tokens.claro.fondo}$2`)
    .replace(/(<meta name="theme-color" content=")[^"]*(" media="\(prefers-color-scheme: dark\)")/, `$1${tokens.oscuro.fondo}$2`)
  const bloque = `<!-- arranque-ios:inicio (lo escribe scripts/iconos-pwa.mjs) -->\n${enlaces.join('\n')}\n    <!-- arranque-ios:fin -->`
  if (!/<!-- arranque-ios:inicio[\s\S]*?<!-- arranque-ios:fin -->/.test(html)) throw new Error('index.html no tiene el bloque <!-- arranque-ios:inicio --> … <!-- arranque-ios:fin -->')
  html = html.replace(/<!-- arranque-ios:inicio[\s\S]*?<!-- arranque-ios:fin -->/, bloque)

  return { tokens, marca, archivos, textoManifest, html }
}

// ───────── Escribir o verificar ─────────

async function pixeles(buffer) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
  return { data, ancho: info.width, alto: info.height }
}

const r = await generar()
if (r.marca.provisoria) console.warn('MARCA PROVISORIA: no está web/public/marca/telar.svg; uso web/public/icono.svg. Cuando llegue la marca, correr npm run pwa:iconos.')

if (VERIFICAR) {
  const problemas = []
  for (const [nombre, buffer] of r.archivos) {
    const ruta = path.join(SALIDA, nombre)
    if (!existsSync(ruta)) {
      problemas.push(`falta web/public/pwa/${nombre}`)
      continue
    }
    const [a, b] = await Promise.all([pixeles(buffer), pixeles(readFileSync(ruta))])
    if (a.ancho !== b.ancho || a.alto !== b.alto || Buffer.compare(a.data, b.data) !== 0) problemas.push(`web/public/pwa/${nombre} no coincide con la marca o los tokens`)
  }
  if (!existsSync(MANIFEST) || readFileSync(MANIFEST, 'utf8') !== r.textoManifest) problemas.push('web/public/manifest.webmanifest no coincide (colores, íconos o capturas)')
  if (readFileSync(INDEX, 'utf8') !== r.html) problemas.push('web/index.html: los theme-color o las pantallas de arranque no coinciden con tokens.css')
  const origen = existsSync(path.join(SALIDA, 'ORIGEN.txt')) ? readFileSync(path.join(SALIDA, 'ORIGEN.txt'), 'utf8') : ''
  if (!origen.includes(r.marca.origen)) problemas.push(`web/public/pwa/ORIGEN.txt no dice que la marca es ${r.marca.origen}`)
  if (problemas.length) {
    console.error(`pwa:verificar: ${problemas.length} problema(s). Correr npm run pwa:iconos.\n  · ${problemas.join('\n  · ')}`)
    process.exit(1)
  }
  console.log(`pwa:verificar: todo al día (${r.archivos.size} imágenes, manifest e index.html; marca ${r.marca.provisoria ? 'PROVISORIA' : 'definitiva'}).`)
} else {
  mkdirSync(SALIDA, { recursive: true })
  let bytes = 0
  for (const [nombre, buffer] of r.archivos) {
    writeFileSync(path.join(SALIDA, nombre), buffer)
    bytes += buffer.length
  }
  writeFileSync(MANIFEST, r.textoManifest)
  writeFileSync(INDEX, r.html)
  writeFileSync(
    path.join(SALIDA, 'ORIGEN.txt'),
    `Marca usada para los íconos y las pantallas de arranque: ${r.marca.origen}${r.marca.provisoria ? ' (PROVISORIA: falta web/public/marca/telar.svg)' : ''}\n` +
      `Generado: ${new Date().toISOString().slice(0, 10)} con scripts/iconos-pwa.mjs. Colores: --c-fondo ${r.tokens.claro.fondo} (claro) y ${r.tokens.oscuro.fondo} (oscuro).\n`,
  )
  console.log(`pwa:iconos: ${r.archivos.size} imágenes (${Math.round(bytes / 1024)} KB), manifest e index.html al día.`)
}
