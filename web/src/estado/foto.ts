// La foto del lienzo (ver_lienzo, MCP): el servidor abre la app en un Chromium con `?foto=x,y,zoom,ancho,alto` y saca
// una captura de lo que se ve. Este módulo lee ese pedido una sola vez, apenas arranca la app (antes de que las rutas
// reescriban la dirección), y marca <html data-foto> para que el CSS deje solo el lienzo, sin barras ni paneles.
// x, y: la esquina del área en coordenadas del lienzo · zoom · ancho, alto: el área (lo que se revisa).

export interface PedidoFoto {
  x: number
  y: number
  zoom: number
  ancho: number
  alto: number
}

/** Margen en px de pantalla entre el borde de la imagen y el área (lo mismo usa el servidor para recortar). */
export const MARGEN_FOTO = 24

function leer(): PedidoFoto | null {
  const crudo = new URLSearchParams(location.search).get('foto')
  if (!crudo) return null
  const [x, y, zoom, ancho, alto] = crudo.split(',').map(Number)
  if (![x, y, zoom, ancho, alto].every((n) => Number.isFinite(n)) || !(zoom! > 0)) return null
  return { x: x!, y: y!, zoom: zoom!, ancho: ancho!, alto: alto! }
}

/** El pedido de foto, o null si la app se abrió como siempre. */
export const FOTO: PedidoFoto | null = leer()
if (FOTO) document.documentElement.dataset.foto = 'si'
