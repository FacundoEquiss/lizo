/** Minúsculas y sin tildes: para buscar sin que importen los acentos. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function slug(texto: string): string {
  return (
    normalizar(texto)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'tablero'
  )
}

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase()
  return (partes[0]![0]! + partes[1]![0]!).toUpperCase()
}

/** Recorta un texto largo para mostrarlo en una línea. */
export function recortar(texto: string, largo: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  return limpio.length > largo ? limpio.slice(0, largo - 1).trimEnd() + '…' : limpio
}

/** Quita el markdown más común para mostrar un resumen en texto plano. */
export function sinMarkdown(texto: string): string {
  return texto
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .trim()
}
