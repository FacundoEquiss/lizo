// Ayudas chicas de Diseño en el celular.
import type { ComentarioDiseno, MarcoResumen } from '../../../../../compartido/diseno/tipos'

/** Los marcos en orden de lectura (de arriba abajo y de izquierda a derecha): el del visor y el de la lista. */
export function enOrden<T extends Pick<MarcoResumen, 'x' | 'y'>>(marcos: T[]): T[] {
  return [...marcos].sort((a, b) => a.y - b.y || a.x - b.x)
}

/** Los comentarios con lugar en un marco que se dibujan como pin (abiertos, sin las respuestas). */
export function pinesDe(comentarios: ComentarioDiseno[]): ComentarioDiseno[] {
  return comentarios.filter((c) => !c.resuelto && !c.respuestaA && c.x != null && c.objetivo.startsWith('marco:'))
}

/** "marco:m_1#capa" → "m_1" */
export const marcoDeObjetivo = (objetivo: string) => objetivo.slice(6).split('#')[0]!

/** Cuántos hilos abiertos tiene un marco (para el número del botón de comentarios). */
export function hilosAbiertos(comentarios: ComentarioDiseno[]): number {
  return comentarios.filter((c) => !c.respuestaA && !c.resuelto).length
}
