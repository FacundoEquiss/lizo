// Tokens → CSS. La hoja de tokens del proyecto se agrega sola a todo marco: `:root { --color-marca-primario: … }`,
// un bloque `[data-modo="oscuro"] { … }` por modo, las reglas @font-face de las fuentes y una clase `.t-<nombre>` por estilo
// de texto. Cambiar un token cambia todos los marcos que lo usan (la idea de las variables de Figma, sin mecanismo extra).
import type { DatosEstiloTexto, DatosFuente, DatosToken, ItemDiseno } from './tipos'

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** "color/marca/primario" → "--color-marca-primario". Un nombre que ya es una variable ("--rc-azul") queda igual. */
export function variableDeToken(nombre: string): string {
  const n = nombre.trim()
  if (n.startsWith('--')) return n
  const s = sinTildes(n)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return '--' + (s || 'token')
}

/** "Título grande" → "t-titulo-grande". */
export function claseDeEstilo(nombre: string): string {
  const s = sinTildes(nombre.trim())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return 't-' + (s || 'estilo')
}

const valorSeguro = (v: string) => v.replace(/[{};<>]/g, '').replace(/\/\*/g, '').trim()

/** Valor de un token resuelto: si es alias, `var(--otro)`. */
function valorDe(t: ItemDiseno<'token'>, porClave: Map<string, ItemDiseno<'token'>>): string {
  const d = t.datos
  if (d.alias) {
    const otro = porClave.get(d.alias)
    if (otro) return `var(${otro.datos.css || variableDeToken(otro.clave)})`
  }
  return valorSeguro(d.valor)
}

export interface EntradaTokens {
  tokens: ItemDiseno<'token'>[]
  estilos: ItemDiseno<'estilo_texto'>[]
  fuentes: ItemDiseno<'fuente'>[]
}

/**
 * La hoja de tokens. Propios: con su nombre (`--color-marca-primario`). Importados con nombre (`--rc-azul`) y valor literal:
 * también van a `:root`, así un diseño propio puede usarlos; las hojas importadas los vuelven a declarar en su alcance.
 */
export function hojaDeTokens(e: EntradaTokens): string {
  const tokens = e.tokens.filter((t) => !t.archivado)
  const porClave = new Map(tokens.map((t) => [t.clave, t]))
  const lineas: string[] = []
  for (const f of e.fuentes) {
    if (f.archivado || !f.datos.ruta) continue
    const d = f.datos as DatosFuente
    const formato = /\.woff2(\?|$)/.test(d.ruta) ? 'woff2' : /\.woff(\?|$)/.test(d.ruta) ? 'woff' : /\.otf(\?|$)/.test(d.ruta) ? 'opentype' : 'truetype'
    lineas.push(
      `@font-face { font-family: "${d.familia.replace(/"/g, '')}"; src: url("${d.ruta.replace(/"/g, '')}") format("${formato}"); font-weight: ${valorSeguro(d.pesos || '400')}; font-style: ${d.estilo === 'italic' ? 'italic' : 'normal'}; font-display: block; }`,
    )
  }
  const raiz: string[] = []
  const modos = new Map<string, string[]>()
  for (const t of tokens) {
    const d = t.datos as DatosToken
    if (d.suelto) continue
    const variable = t.origen === 'importado' ? d.css : d.css || variableDeToken(t.clave)
    if (!variable || !variable.startsWith('--')) continue
    if (t.origen === 'importado' && (/url\(/i.test(d.valor) || /var\(/.test(d.valor))) continue
    raiz.push(`  ${variable}: ${valorDe(t, porClave)};`)
    for (const [modo, v] of Object.entries(d.modos ?? {})) {
      if (!modos.has(modo)) modos.set(modo, [])
      modos.get(modo)!.push(`  ${variable}: ${valorSeguro(v)};`)
    }
  }
  if (raiz.length) lineas.push(`:root {\n${raiz.join('\n')}\n}`)
  for (const [modo, ls] of modos) lineas.push(`[data-modo="${modo.replace(/"/g, '')}"] {\n${ls.join('\n')}\n}`)
  for (const s of e.estilos) {
    if (s.archivado || s.origen === 'importado') continue
    lineas.push(reglaDeEstilo(claseDeEstilo(s.clave), s.datos as DatosEstiloTexto))
  }
  return lineas.join('\n')
}

export function reglaDeEstilo(clase: string, d: DatosEstiloTexto): string {
  const p: string[] = []
  if (d.familia) p.push(`font-family: "${d.familia.replace(/"/g, '')}", system-ui, sans-serif`)
  if (d.peso) p.push(`font-weight: ${Number(d.peso) || 400}`)
  if (d.tamano) p.push(`font-size: ${valorSeguro(d.tamano)}`)
  if (d.interlineado) p.push(`line-height: ${valorSeguro(d.interlineado)}`)
  if (d.espaciado) p.push(`letter-spacing: ${valorSeguro(d.espaciado)}`)
  if (d.mayusculas) p.push('text-transform: uppercase')
  if (d.color) p.push(`color: ${valorSeguro(d.color)}`)
  if (d.contorno) p.push(`-webkit-text-stroke: ${valorSeguro(d.contorno.grosor)} ${valorSeguro(d.contorno.color)}`, 'paint-order: stroke fill')
  return `.${clase} { ${p.join('; ')} }`
}

/** Un color en el formato que sea → [r, g, b, a] (0–255, a 0–1). null si no se entiende. */
export function aRgb(valor: string): [number, number, number, number] | null {
  const v = valor.trim().toLowerCase()
  let m = /^#([0-9a-f]{3,8})$/.exec(v)
  if (m) {
    const h = m[1]!
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [...h].map((c) => parseInt(c + c, 16))
      return [r!, g!, b!, h.length === 4 ? Math.round((a! / 255) * 1000) / 1000 : 1]
    }
    if (h.length === 6 || h.length === 8) {
      const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
      return [n(0), n(2), n(4), h.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1]
    }
    return null
  }
  m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v)
  if (m) {
    const c = (x: string) => (x.endsWith('%') ? Math.round((parseFloat(x) / 100) * 255) : Math.round(parseFloat(x)))
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return [c(m[1]!), c(m[2]!), c(m[3]!), Math.round(a * 1000) / 1000]
  }
  if (v === 'white') return [255, 255, 255, 1]
  if (v === 'black') return [0, 0, 0, 1]
  if (v === 'transparent') return [0, 0, 0, 0]
  return null
}

export function aHex([r, g, b, a]: [number, number, number, number]): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return a >= 1 ? `#${h(r)}${h(g)}${h(b)}` : `#${h(r)}${h(g)}${h(b)}${h(a * 255)}`
}

/** Valor normalizado de un color, para comparar ("#FFF" = "#ffffff" = "rgb(255,255,255)"). */
export function normalizarColor(valor: string): string | null {
  const c = aRgb(valor)
  return c ? aHex(c) : null
}

/** Diferencia de color CIE76 (ΔE) entre dos colores sRGB. Menos de 2 casi no se distingue. */
export function deltaE(a: [number, number, number, number], b: [number, number, number, number]): number {
  const [l1, a1, b1] = aLab(a)
  const [l2, a2, b2] = aLab(b)
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2) + Math.abs(a[3] - b[3]) * 100
}

function aLab([r, g, b]: [number, number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    const x = c / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}

/** Tono (0–360), saturación y luz (0–1), para ordenar muestras. */
export function aHsl([r, g, b]: [number, number, number, number]): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  h *= 60
  return [h, s, l]
}

/** Familia de un color para agrupar los sueltos: grises, rojos, naranjas, amarillos, verdes, celestes, azules, violetas, rosas. */
export function familiaDeColor(rgb: [number, number, number, number]): string {
  const [h, s, l] = aHsl(rgb)
  if (rgb[3] < 1 && rgb[3] <= 0.6) return 'Transparencias'
  if (s < 0.12 || l < 0.06 || l > 0.97) return 'Grises'
  if (h < 15 || h >= 345) return 'Rojos'
  if (h < 40) return 'Naranjas'
  if (h < 65) return 'Amarillos'
  if (h < 160) return 'Verdes'
  if (h < 200) return 'Celestes'
  if (h < 255) return 'Azules'
  if (h < 300) return 'Violetas'
  return 'Rosas'
}

/** Luminancia relativa y contraste WCAG, para el texto encima de una muestra. */
export function luminancia([r, g, b]: [number, number, number, number]): number {
  const lin = (c: number) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
