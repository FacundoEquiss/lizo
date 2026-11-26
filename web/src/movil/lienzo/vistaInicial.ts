// Primera vista del lienzo en el teléfono (plan del celular, 7.2). Sin vista guardada, el lienzo de escritorio ajusta
// todo el contenido: en 393 px eso da el 11 % y no se lee nada. En el teléfono arranca ajustado al PRIMER MARCO, con 8 %
// de margen (sin marcos: todo el contenido, con zoom mínimo de 0,35). La vista se escribe donde el lienzo la guarda
// (localStorage 'tablero.vista.<id>'), así el lienzo no se toca. Cuando exista el contrato N8 lo hace el lienzo mismo.
import type { ElementoLienzo, TableroCompleto } from '../../../../compartido/tipos'

const MARGEN = 0.08
/** Zoom mínimo para que se lea algo: en horizontal, ajustar el marco al alto lo dejaría ilegible. */
const LEGIBLE = 0.35

export function prepararVistaLienzo(t: TableroCompleto, escena: { ancho: number; alto: number }) {
  const clave = `tablero.vista.${t.tablero.id}`
  try {
    if (localStorage.getItem(clave)) return
  } catch {
    return
  }
  const marcos = t.elementos.filter((e) => e.tipo === 'marco').sort((a, b) => a.y - b.y || a.x - b.x)
  let caja: Pick<ElementoLienzo, 'x' | 'y' | 'ancho' | 'alto'> | null = marcos[0] ?? null
  if (!caja && t.elementos.length) {
    const x1 = Math.min(...t.elementos.map((e) => e.x))
    const y1 = Math.min(...t.elementos.map((e) => e.y))
    const x2 = Math.max(...t.elementos.map((e) => e.x + e.ancho))
    const y2 = Math.max(...t.elementos.map((e) => e.y + e.alto))
    caja = { x: x1, y: y1, ancho: x2 - x1, alto: y2 - y1 }
  }
  if (!caja) return
  // Arriba quedan los botones flotantes del lienzo (44 px y su margen) y, encima del marco, su título.
  const arriba = escena.alto < 420 ? 84 : 108
  const alAncho = escena.ancho / (caja.ancho * (1 + 2 * MARGEN))
  const alAlto = (escena.alto - arriba) / (caja.alto * (1 + MARGEN))
  let zoom = Math.min(alAncho, Math.max(alAlto, LEGIBLE))
  if (!marcos.length) zoom = Math.max(zoom, LEGIBLE)
  zoom = Math.min(1.2, Math.max(0.06, zoom))
  const x = escena.ancho / 2 - (caja.x + caja.ancho / 2) * zoom
  // El marco se alinea arriba, no al centro: así su título queda a la vista, debajo de los botones flotantes.
  const y = Math.max(escena.alto * MARGEN, arriba) - caja.y * zoom
  try {
    localStorage.setItem(clave, JSON.stringify({ x, y, zoom }))
  } catch {}
}
