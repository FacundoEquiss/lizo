// Las 13 formas: el trazo SVG de cada una en coordenadas reales (ancho × alto, sin deformar esquinas ni borde) y el
// rectángulo interior donde va el texto.
import type { TipoForma } from '../../../../../compartido/lienzo'

export interface Zona {
  x: number
  y: number
  w: number
  h: number
}

const f = (n: number) => Math.round(n * 100) / 100

function rectRedondeado(w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  if (rr === 0) return `M0 0H${f(w)}V${f(h)}H0Z`
  return `M${f(rr)} 0H${f(w - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(w)} ${f(rr)}V${f(h - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(w - rr)} ${f(h)}H${f(rr)}A${f(rr)} ${f(rr)} 0 0 1 0 ${f(h - rr)}V${f(rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} 0Z`
}

const poligono = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`

/** Alto de la tapa del cilindro. */
const tapa = (w: number, h: number) => Math.max(6, Math.min(h * 0.22, w * 0.3, 40))
/** Inclinación del paralelogramo y del hexágono. */
const sesgo = (w: number, h: number) => Math.max(4, Math.min(w * 0.22, h * 0.5))
/** Onda del documento. */
const onda = (h: number) => Math.max(3, Math.min(h * 0.1, 16))
/** Largo de la punta de la flecha. */
const cabeza = (w: number, h: number) => Math.max(6, Math.min(w * 0.42, h * 0.9))
/** Cola del globo. */
const cola = (h: number) => Math.max(5, Math.min(h * 0.2, 26))

function estrella(w: number, h: number) {
  const pts: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const r = i % 2 === 0 ? 1 : 0.42
    pts.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  // Se estira para llenar la caja (la estrella de 5 puntas es más ancha que alta).
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  return poligono(pts.map(([x, y]) => [((x - x0) / (x1 - x0)) * w, ((y - y0) / (y1 - y0)) * h]))
}

/** Trazo de la forma (relleno y borde van en el mismo path). */
export function trazoForma(forma: TipoForma, w: number, h: number): string {
  switch (forma) {
    case 'rectangulo':
      return rectRedondeado(w, h, 0)
    case 'redondeado':
      return rectRedondeado(w, h, 14)
    case 'pildora':
      return rectRedondeado(w, h, Math.min(w, h) / 2)
    case 'elipse':
      return `M0 ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)}Z`
    case 'rombo':
      return poligono([
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ])
    case 'triangulo':
      return poligono([
        [w / 2, 0],
        [w, h],
        [0, h],
      ])
    case 'hexagono': {
      const d = sesgo(w, h) * 0.8
      return poligono([
        [d, 0],
        [w - d, 0],
        [w, h / 2],
        [w - d, h],
        [d, h],
        [0, h / 2],
      ])
    }
    case 'paralelogramo': {
      const d = sesgo(w, h)
      return poligono([
        [d, 0],
        [w, 0],
        [w - d, h],
        [0, h],
      ])
    }
    case 'cilindro': {
      const e = tapa(w, h)
      const rx = w / 2
      const ry = e / 2
      return `M0 ${f(ry)}A${f(rx)} ${f(ry)} 0 0 1 ${f(w)} ${f(ry)}V${f(h - ry)}A${f(rx)} ${f(ry)} 0 0 1 0 ${f(h - ry)}Z`
    }
    case 'documento': {
      const a = onda(h)
      return `M0 0H${f(w)}V${f(h - a)}C${f(w * 0.72)} ${f(h - a * 2.6)} ${f(w * 0.42)} ${f(h + a * 1.2)} 0 ${f(h - a * 0.6)}Z`
    }
    case 'estrella':
      return estrella(w, h)
    case 'globo': {
      const t = cola(h)
      const cuerpo = h - t
      const r = Math.min(14, w / 2, cuerpo / 2)
      return `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(cuerpo - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(cuerpo)}H${f(w * 0.36)}L${f(w * 0.16)} ${f(h)}L${f(w * 0.2)} ${f(cuerpo)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(cuerpo - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`
    }
    case 'flecha': {
      const c = cabeza(w, h)
      return poligono([
        [0, h * 0.27],
        [w - c, h * 0.27],
        [w - c, 0],
        [w, h / 2],
        [w - c, h],
        [w - c, h * 0.73],
        [0, h * 0.73],
      ])
    }
  }
}

/** Línea de adelante de la tapa del cilindro (se dibuja solo con el borde, encima del relleno). */
export function detalleForma(forma: TipoForma, w: number, h: number): string | null {
  if (forma !== 'cilindro') return null
  const e = tapa(w, h)
  return `M0 ${f(e / 2)}A${f(w / 2)} ${f(e / 2)} 0 0 0 ${f(w)} ${f(e / 2)}`
}

/** Rectángulo interior donde va el texto de cada forma. */
export function zonaTexto(forma: TipoForma, w: number, h: number): Zona {
  switch (forma) {
    case 'rectangulo':
    case 'redondeado':
      return { x: 12, y: 8, w: w - 24, h: h - 16 }
    case 'pildora': {
      const r = Math.min(w, h) / 2
      return { x: r * 0.55, y: 6, w: w - r * 1.1, h: h - 12 }
    }
    case 'elipse':
      return { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 }
    case 'rombo':
      return { x: w * 0.25, y: h * 0.25, w: w * 0.5, h: h * 0.5 }
    case 'triangulo':
      return { x: w * 0.25, y: h * 0.45, w: w * 0.5, h: h * 0.5 }
    case 'hexagono': {
      const d = sesgo(w, h) * 0.8
      return { x: d, y: 6, w: w - d * 2, h: h - 12 }
    }
    case 'paralelogramo': {
      const d = sesgo(w, h)
      return { x: d, y: 6, w: w - d * 2, h: h - 12 }
    }
    case 'cilindro': {
      const e = tapa(w, h)
      return { x: 10, y: e + 4, w: w - 20, h: h - e * 1.5 - 8 }
    }
    case 'documento': {
      const a = onda(h)
      return { x: 12, y: 8, w: w - 24, h: h - a * 1.6 - 12 }
    }
    case 'estrella':
      return { x: w * 0.3, y: h * 0.36, w: w * 0.4, h: h * 0.4 }
    case 'globo': {
      const t = cola(h)
      return { x: 12, y: 8, w: w - 24, h: h - t - 16 }
    }
    case 'flecha': {
      const c = cabeza(w, h)
      return { x: 10, y: h * 0.27, w: w - c - 10, h: h * 0.46 }
    }
  }
}

/**
 * El alto que necesita la forma (de ancho `w`) para que su zona de texto mida al menos `th`: nunca menos que `minimo`
 * (el alto guardado). La zona crece con el alto en todas las formas, así que alcanza una búsqueda binaria.
 */
export function altoParaTexto(forma: TipoForma, w: number, th: number, minimo: number): number {
  if (zonaTexto(forma, w, minimo).h >= th) return minimo
  let bajo = minimo
  let alto = Math.max(minimo * 2, th * 2 + 40)
  while (zonaTexto(forma, w, alto).h < th && alto < 100_000) alto *= 2
  for (let i = 0; i < 22; i++) {
    const medio = (bajo + alto) / 2
    if (zonaTexto(forma, w, medio).h >= th) alto = medio
    else bajo = medio
  }
  return Math.ceil(alto)
}
