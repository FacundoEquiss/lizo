// Tamaños prefijados de marco (plan 6.7). Medidas de redes revisadas el 24/11/2026 contra las guías de 2026 de Sked Social,
// Influencer Marketing Hub y Buffer: Instagram cuadrado 1080 × 1080 y vertical 1080 × 1350 (4:5, el de fábrica de la API de
// Meta), historias y reels 1080 × 1920 (9:16), enlace de Facebook y LinkedIn 1200 × 630 (1,91:1; el plan decía 628), X 16:9
// a 1600 × 900, miniatura de YouTube 1280 × 720. Anuncios: los tamaños IAB de siempre.

export interface Prefijado {
  id: string
  nombre: string
  grupo: 'Redes' | 'Anuncios' | 'Web' | 'Presentación' | 'Del proyecto'
  ancho: number
  alto: number
}

export const PREFIJADOS: Prefijado[] = [
  { id: 'instagram-posteo', nombre: 'Instagram · posteo', grupo: 'Redes', ancho: 1080, alto: 1080 },
  { id: 'instagram-vertical', nombre: 'Instagram · posteo vertical', grupo: 'Redes', ancho: 1080, alto: 1350 },
  { id: 'instagram-historia', nombre: 'Historia y reel', grupo: 'Redes', ancho: 1080, alto: 1920 },
  { id: 'facebook', nombre: 'Facebook y LinkedIn', grupo: 'Redes', ancho: 1200, alto: 630 },
  { id: 'x', nombre: 'X', grupo: 'Redes', ancho: 1600, alto: 900 },
  { id: 'youtube-miniatura', nombre: 'Miniatura de YouTube', grupo: 'Redes', ancho: 1280, alto: 720 },

  { id: 'anuncio-300x250', nombre: 'Rectángulo mediano', grupo: 'Anuncios', ancho: 300, alto: 250 },
  { id: 'anuncio-336x280', nombre: 'Rectángulo grande', grupo: 'Anuncios', ancho: 336, alto: 280 },
  { id: 'anuncio-728x90', nombre: 'Tira', grupo: 'Anuncios', ancho: 728, alto: 90 },
  { id: 'anuncio-970x250', nombre: 'Cartelera', grupo: 'Anuncios', ancho: 970, alto: 250 },
  { id: 'anuncio-300x600', nombre: 'Media página', grupo: 'Anuncios', ancho: 300, alto: 600 },
  { id: 'anuncio-160x600', nombre: 'Rascacielos', grupo: 'Anuncios', ancho: 160, alto: 600 },
  { id: 'anuncio-320x50', nombre: 'Tira del celular', grupo: 'Anuncios', ancho: 320, alto: 50 },
  { id: 'anuncio-320x100', nombre: 'Tira grande del celular', grupo: 'Anuncios', ancho: 320, alto: 100 },

  { id: 'escritorio', nombre: 'Escritorio', grupo: 'Web', ancho: 1440, alto: 900 },
  { id: 'portatil', nombre: 'Portátil', grupo: 'Web', ancho: 1366, alto: 768 },
  { id: 'tablet', nombre: 'Tablet', grupo: 'Web', ancho: 820, alto: 1180 },
  { id: 'celular', nombre: 'Celular', grupo: 'Web', ancho: 390, alto: 844 },
  { id: 'celular-horizontal', nombre: 'Celular horizontal', grupo: 'Web', ancho: 844, alto: 390 },
  { id: 'compartir', nombre: 'Imagen para compartir', grupo: 'Web', ancho: 1200, alto: 630 },

  { id: 'presentacion', nombre: 'Presentación', grupo: 'Presentación', ancho: 1920, alto: 1080 },
]

export const GRUPOS_PREFIJADOS = ['Redes', 'Anuncios', 'Web', 'Presentación', 'Del proyecto'] as const

export function buscarPrefijado(id: string): Prefijado | undefined {
  const limpio = id.trim().toLowerCase()
  return PREFIJADOS.find((p) => p.id === limpio) ?? PREFIJADOS.find((p) => `${p.ancho}x${p.alto}` === limpio.replace(/\s|×/g, 'x'))
}

/** "instagram-historia" · "1080x1920" · "1080 × 1920" · { ancho, alto } → medidas. */
export function medidasDe(
  tamano: string | { ancho: number; alto: number },
  extra: Prefijado[] = [],
): { ancho: number; alto: number; prefijado: string | null } | null {
  if (typeof tamano !== 'string') return { ancho: Math.round(tamano.ancho), alto: Math.round(tamano.alto), prefijado: null }
  const p = extra.find((x) => x.id === tamano.trim()) ?? buscarPrefijado(tamano)
  if (p) return { ancho: p.ancho, alto: p.alto, prefijado: p.id }
  const m = /^\s*(\d{2,4})\s*[x×*]\s*(\d{2,4})\s*$/i.exec(tamano)
  if (m) return { ancho: Number(m[1]), alto: Number(m[2]), prefijado: null }
  return null
}

export const LISTA_PREFIJADOS = PREFIJADOS.map((p) => `${p.id} (${p.ancho}×${p.alto})`).join(', ')
