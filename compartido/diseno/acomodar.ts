// Acomodo automático de marcos (plan 6.3): por sección, en filas, con 64 px entre marcos, 160 px entre secciones y filas
// de hasta 4.000 px de ancho. Función pura: la usan la web ("Ordenar la página"), el servidor (marcos sin posición) y el
// importador. Entre filas hay 120 (no 64): el nombre de cada marco va arriba, a tamaño fijo en la pantalla, y con 64 se
// encimaba con la fila de arriba en cuanto se alejaba el zoom; y entre secciones, 200 más el título.

export interface ParaAcomodar {
  id: string
  seccion: string
  ancho: number
  alto: number
}

export interface OpcionesAcomodo {
  separacion?: number
  /** Entre filas (de fábrica 120: lugar para el nombre del marco). */
  separacionFilas?: number
  entreSecciones?: number
  anchoFila?: number
  /** Desde dónde se empieza (arriba a la izquierda). */
  x?: number
  y?: number
  /** Orden de las secciones (las que no están, al final en el orden en que aparecen). */
  ordenSecciones?: string[]
}

export const ALTO_TITULO_SECCION = 40

export function acomodar(marcos: ParaAcomodar[], o: OpcionesAcomodo = {}): Map<string, { x: number; y: number }> {
  const sep = o.separacion ?? 64
  const sepFilas = o.separacionFilas ?? (o.separacion !== undefined ? o.separacion : 120)
  const entre = o.entreSecciones ?? 200
  const tope = o.anchoFila ?? 4000
  const x0 = o.x ?? 0
  const secciones: string[] = []
  const porSeccion = new Map<string, ParaAcomodar[]>()
  for (const m of marcos) {
    if (!porSeccion.has(m.seccion)) {
      porSeccion.set(m.seccion, [])
      secciones.push(m.seccion)
    }
    porSeccion.get(m.seccion)!.push(m)
  }
  if (o.ordenSecciones?.length) {
    const pos = new Map(o.ordenSecciones.map((s, i) => [s, i]))
    secciones.sort((a, b) => (pos.get(a) ?? 1e6 + secciones.indexOf(a)) - (pos.get(b) ?? 1e6 + secciones.indexOf(b)))
  }
  const r = new Map<string, { x: number; y: number }>()
  let y = o.y ?? 0
  secciones.forEach((s, i) => {
    if (i > 0) y += entre
    // el título de la sección va 40 px arriba del primer marco: la primera fila deja ese lugar si hay título
    if (s && i > 0) y += ALTO_TITULO_SECCION
    let x = x0
    let altoFila = 0
    for (const m of porSeccion.get(s)!) {
      if (x > x0 && x + m.ancho > x0 + tope) {
        y += altoFila + sepFilas
        x = x0
        altoFila = 0
      }
      r.set(m.id, { x, y })
      x += m.ancho + sep
      altoFila = Math.max(altoFila, m.alto)
    }
    y += altoFila
  })
  return r
}

/** Rectángulo que encierra a todos. */
export function limitesDe(rects: { x: number; y: number; ancho: number; alto: number }[]) {
  if (!rects.length) return null
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
