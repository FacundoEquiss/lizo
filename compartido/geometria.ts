// Geometría del lienzo, compartida por la web y el servidor: rectángulos, marcos y lugares libres.

export interface Rect {
  x: number
  y: number
  ancho: number
  alto: number
}

/** Alto de la franja del título de un marco (lo de adentro empieza más abajo). */
export const CABECERA_MARCO = 40
const MARGEN_MARCO = 40

export function intersecan(a: Rect, b: Rect, margen = 0): boolean {
  return (
    a.x < b.x + b.ancho + margen &&
    a.x + a.ancho + margen > b.x &&
    a.y < b.y + b.alto + margen &&
    a.y + a.alto + margen > b.y
  )
}

/** El centro de `a` cae dentro de `b`. */
export function centroDentro(a: Rect, b: Rect): boolean {
  const cx = a.x + a.ancho / 2
  const cy = a.y + a.alto / 2
  return cx >= b.x && cx <= b.x + b.ancho && cy >= b.y && cy <= b.y + b.alto
}

export function limites(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x)
    y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.ancho)
    y2 = Math.max(y2, r.y + r.alto)
  }
  return { x: x1, y: y1, ancho: x2 - x1, alto: y2 - y1 }
}

/** Primer hueco libre recorriendo el área en filas (de izquierda a derecha, de arriba abajo). */
export function buscarLugar(
  area: Rect,
  tam: { ancho: number; alto: number },
  ocupados: Rect[],
  separacion = 28,
): { x: number; y: number } | null {
  const paso = 20
  for (let y = area.y; y + tam.alto <= area.y + area.alto; y += paso) {
    for (let x = area.x; x + tam.ancho <= area.x + area.ancho; x += paso) {
      const r = { x, y, ancho: tam.ancho, alto: tam.alto }
      if (!ocupados.some((o) => intersecan(r, o, separacion))) return { x, y }
    }
  }
  return null
}

/** Ancho del carril (título adentro a la izquierda) o alto de la franja (título adentro arriba), en px. */
export const BANDA_CARRIL = 56

/**
 * Área útil adentro de un marco (sin la franja del título). Con el título adentro (carril a la izquierda o franja arriba,
 * `datos.tituloEn`) el interior arranca después de la banda.
 */
export function interiorMarco(m: Rect & { datos?: Record<string, unknown> }): Rect {
  const en = m.datos?.tituloEn
  if (en === 'izquierda') return { x: m.x + BANDA_CARRIL + 24, y: m.y + 24, ancho: m.ancho - BANDA_CARRIL - 48, alto: m.alto - 48 }
  if (en === 'arriba') return { x: m.x + 24, y: m.y + BANDA_CARRIL + 16, ancho: m.ancho - 48, alto: m.alto - BANDA_CARRIL - 40 }
  return {
    x: m.x + MARGEN_MARCO,
    y: m.y + CABECERA_MARCO,
    ancho: m.ancho - MARGEN_MARCO * 2,
    alto: m.alto - CABECERA_MARCO - MARGEN_MARCO,
  }
}

/** Marco más chico que contiene el centro del elemento (o null si no está en ninguno). */
export function marcoDe<M extends Rect & { id: string }>(e: Rect & { id?: string; tipo?: string }, marcos: readonly M[]): M | null {
  let mejor: M | null = null
  const esMarco = e.tipo === 'marco'
  for (const m of marcos) {
    if (m.id === e.id) continue
    if (!centroDentro(e, m)) continue
    // un marco solo queda adentro de uno más grande (como en contenidoDe): si no, un marco grande cuyo centro cae en un
    // andarivel chico figuraba "adentro" del chico y se desordenaba el lienzo que lee el MCP
    if (esMarco && m.ancho * m.alto <= e.ancho * e.alto) continue
    if (!mejor || m.ancho * m.alto < mejor.ancho * mejor.alto) mejor = m
  }
  return mejor
}

/**
 * Los marcos en orden (5.5): primero los que tienen un orden puesto a mano (en el panel), y después el de lectura: por
 * filas de arriba abajo y, dentro de una fila, de izquierda a derecha. Dos marcos están en la misma fila si sus centros
 * verticales difieren menos que la mitad del alto del más bajo. Lo usan el panel de marcos y el MCP.
 */
export function ordenarMarcos<M extends Rect & { datos: Record<string, unknown> }>(marcos: readonly M[]): M[] {
  const medio = (m: M) => m.y + m.alto / 2
  const filas: M[][] = []
  for (const m of [...marcos].sort((a, b) => medio(a) - medio(b))) {
    const fila = filas.find((f) => f.some((o) => Math.abs(medio(o) - medio(m)) < Math.min(o.alto, m.alto) / 2))
    if (fila) fila.push(m)
    else filas.push([m])
  }
  const lectura = filas.flatMap((f) => f.sort((a, b) => a.x - b.x))
  const orden = (m: M) => (typeof m.datos.orden === 'number' ? m.datos.orden : null)
  return [...lectura.filter((m) => orden(m) !== null).sort((a, b) => orden(a)! - orden(b)!), ...lectura.filter((m) => orden(m) === null)]
}

/** Lo que está adentro de un marco: lo que tiene el centro adentro (marcos más chicos incluidos, con lo suyo). */
export function contenidoDe<E extends Rect & { id: string; tipo: string }>(elementos: readonly E[], marco: E): E[] {
  return elementos.filter((e) => {
    if (e.id === marco.id) return false
    const cx = e.x + e.ancho / 2
    const cy = e.y + e.alto / 2
    if (cx <= marco.x || cx >= marco.x + marco.ancho || cy <= marco.y || cy >= marco.y + marco.alto) return false
    return !(e.tipo === 'marco' && e.ancho * e.alto >= marco.ancho * marco.alto)
  })
}
