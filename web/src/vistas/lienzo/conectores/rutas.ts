// Geometría de los conectores: de qué lado sale y a qué lado llega cada uno, y el punto exacto en el borde.
import { Position, type InternalNode } from '@xyflow/react'
import type { Lado } from '../../../../../compartido/tipos'

export const POSICION_DE_LADO: Record<Lado, Position> = {
  arriba: Position.Top,
  derecha: Position.Right,
  abajo: Position.Bottom,
  izquierda: Position.Left,
}
export const LADO_DE_POSICION: Record<Position, Lado> = {
  [Position.Top]: 'arriba',
  [Position.Right]: 'derecha',
  [Position.Bottom]: 'abajo',
  [Position.Left]: 'izquierda',
}
export const LADO_OPUESTO: Record<Lado, Lado> = { arriba: 'abajo', abajo: 'arriba', izquierda: 'derecha', derecha: 'izquierda' }

export interface Caja {
  x: number
  y: number
  w: number
  h: number
}

export function cajaDe(n: InternalNode): Caja {
  // Un objeto que todavía no se dibujó (fuera de la pantalla desde que se abrió el lienzo) tiene su medida provisoria.
  const w = n.measured.width ?? n.width ?? n.initialWidth ?? 0
  const h = n.measured.height ?? n.height ?? n.initialHeight ?? 0
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h }
}

export function puntoEnLado(c: Caja, lado: Position) {
  switch (lado) {
    case Position.Top:
      return { x: c.x + c.w / 2, y: c.y }
    case Position.Bottom:
      return { x: c.x + c.w / 2, y: c.y + c.h }
    case Position.Left:
      return { x: c.x, y: c.y + c.h / 2 }
    default:
      return { x: c.x + c.w, y: c.y + c.h / 2 }
  }
}

/** Elige los lados que se miran entre los dos objetos (conector "flotante", como en Miro). */
export function ladosAuto(a: Caja, b: Caja): [Position, Position] {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const dx = cb.x - ca.x
  const dy = cb.y - ca.y
  // Se compara contra el tamaño para que lo que está "abajo" use arriba/abajo aunque esté corrido.
  if (Math.abs(dx) / (a.w / 2 + b.w / 2 + 1) > Math.abs(dy) / (a.h / 2 + b.h / 2 + 1)) {
    return dx > 0 ? [Position.Right, Position.Left] : [Position.Left, Position.Right]
  }
  return dy > 0 ? [Position.Bottom, Position.Top] : [Position.Top, Position.Bottom]
}

/** Lado de una caja que mira hacia un punto. */
export function ladoHacia(c: Caja, p: { x: number; y: number }): Lado {
  const dx = p.x - (c.x + c.w / 2)
  const dy = p.y - (c.y + c.h / 2)
  if (Math.abs(dx) / (c.w / 2 + 1) > Math.abs(dy) / (c.h / 2 + 1)) return dx > 0 ? 'derecha' : 'izquierda'
  return dy > 0 ? 'abajo' : 'arriba'
}
