// Medidas de una imagen leyendo solo su cabecera (sin dependencias): PNG, JPEG, GIF, WebP y SVG.
// La usan el servidor (subir_activo) y el importador (activos de un repo).

export interface MedidasImagen {
  ancho: number
  alto: number
  mime: string
}

const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0
const u16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8)
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)

export function medidasDeImagen(b: Uint8Array): MedidasImagen | null {
  if (b.length < 16) return null
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ancho: u32(b, 16), alto: u32(b, 20), mime: 'image/png' }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ancho: u16le(b, 6), alto: u16le(b, 8), mime: 'image/gif' }
  // WebP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const tipo = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)
    if (tipo === 'VP8X') return { ancho: u24le(b, 24) + 1, alto: u24le(b, 27) + 1, mime: 'image/webp' }
    if (tipo === 'VP8L') {
      const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
      return { ancho: (v & 0x3fff) + 1, alto: ((v >> 14) & 0x3fff) + 1, mime: 'image/webp' }
    }
    if (tipo === 'VP8 ') return { ancho: u16le(b, 26) & 0x3fff, alto: u16le(b, 28) & 0x3fff, mime: 'image/webp' }
    return null
  }
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marca = b[i + 1]!
      if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) return { alto: u16(b, i + 5), ancho: u16(b, i + 7), mime: 'image/jpeg' }
      i += 2 + u16(b, i + 2)
    }
    return null
  }
  // SVG
  const cabeza = new TextDecoder().decode(b.slice(0, Math.min(b.length, 4096)))
  if (/<svg[\s>]/i.test(cabeza)) {
    const etiqueta = /<svg\b[^>]*>/i.exec(cabeza)?.[0] ?? ''
    const num = (n: string) => {
      const m = new RegExp(`\\b${n}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(etiqueta)
      return m ? parseFloat(m[1]!) : NaN
    }
    let w = num('width')
    let h = num('height')
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(etiqueta)
    if ((!w || !h) && vb) {
      const vw = parseFloat(vb[1]!)
      const vh = parseFloat(vb[2]!)
      if (!w && !h) {
        w = vw
        h = vh
      } else if (!w) w = (h * vw) / vh
      else h = (w * vh) / vw
    }
    return { ancho: Math.round(w || 0), alto: Math.round(h || 0), mime: 'image/svg+xml' }
  }
  return null
}

export const EXTENSIONES_IMAGEN = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']
export const EXTENSIONES_FUENTE = ['woff2', 'woff', 'ttf', 'otf']

export function extensionDeMime(mime: string): string | null {
  return (
    (
      {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'image/avif': 'avif',
        'font/woff2': 'woff2',
        'font/woff': 'woff',
        'font/ttf': 'ttf',
        'font/otf': 'otf',
        'application/font-woff2': 'woff2',
        'application/font-woff': 'woff',
        'application/x-font-ttf': 'ttf',
        'text/css': 'css',
      } as Record<string, string>
    )[mime.split(';')[0]!.trim().toLowerCase()] ?? null
  )
}

export function mimeDeExtension(ext: string): string {
  return (
    (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        avif: 'image/avif',
        woff2: 'font/woff2',
        woff: 'font/woff',
        ttf: 'font/ttf',
        otf: 'font/otf',
        css: 'text/css; charset=utf-8',
      } as Record<string, string>
    )[ext.toLowerCase()] ?? 'application/octet-stream'
  )
}
