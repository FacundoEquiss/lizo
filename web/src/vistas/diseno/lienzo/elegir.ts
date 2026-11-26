// Qué hay bajo el mouse y qué selecciona un clic (plan 6.4). En un marco vivo se le pregunta al iframe con
// elementFromPoint (el iframe tiene pointer-events: none: los gestos los recibe Telar) y se sube hasta el primer elemento con
// data-id. Niveles como en Figma: clic selecciona el marco; con el marco seleccionado, su hijo directo; doble clic baja un
// nivel; Ctrl/⌘ + clic va directo al de más adentro.
import { iframes } from './vivos'

export function documentoDe(marco: string): Document | null {
  const f = iframes.get(marco)
  try {
    return f?.contentDocument ?? null
  } catch {
    return null
  }
}

export function elementoDeCapa(marco: string, capa: string): HTMLElement | null {
  const d = documentoDe(marco)
  if (!d) return null
  try {
    return d.querySelector(`[data-id="${CSS.escape(capa)}"]`)
  } catch {
    return null
  }
}

/** El elemento con data-id más adentro en el punto (px del marco). */
export function capaEn(marco: string, x: number, y: number): HTMLElement | null {
  const d = documentoDe(marco)
  if (!d) return null
  let el = d.elementFromPoint(x, y) as HTMLElement | null
  while (el && el !== d.body && !el.hasAttribute('data-id')) el = el.parentElement
  return el && el !== d.body && el.hasAttribute('data-id') ? el : null
}

/** La cadena de capas desde la de más afuera hasta `el`. */
export function cadenaDe(el: HTMLElement): HTMLElement[] {
  const r: HTMLElement[] = []
  for (let p: HTMLElement | null = el; p && p.tagName !== 'BODY'; p = p.parentElement) if (p.hasAttribute('data-id')) r.unshift(p)
  return r
}

export function padreCapa(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p.tagName !== 'BODY'; p = p.parentElement) if (p.hasAttribute('data-id')) return p
  return null
}

export function hijosCapa(el: HTMLElement | Document): HTMLElement[] {
  const raiz = el instanceof Document ? el.body : el
  const r: HTMLElement[] = []
  const bajar = (n: Element) => {
    for (const h of Array.from(n.children)) {
      if (h.hasAttribute('data-id')) r.push(h as HTMLElement)
      else if (!(h instanceof HTMLStyleElement)) bajar(h)
    }
  }
  if (raiz) bajar(raiz)
  return r
}

/**
 * Qué selecciona un clic. `actual` es la capa seleccionada ahora (o null si está seleccionado el marco).
 *   · profundo (Ctrl/⌘): la de más adentro.
 *   · si la actual (o una hermana suya) está en la cadena: la del mismo nivel.
 *   · si no: la de más afuera.
 */
export function capaParaClic(marco: string, x: number, y: number, actual: string | null, profundo: boolean): string | null {
  const el = capaEn(marco, x, y)
  if (!el) return null
  const cadena = cadenaDe(el)
  if (profundo) return el.getAttribute('data-id')
  if (actual) {
    const a = elementoDeCapa(marco, actual)
    if (a) {
      const padreActual = padreCapa(a)
      for (const c of cadena) if (padreCapa(c) === padreActual) return c.getAttribute('data-id')
      // la actual es ancestro de lo que se tocó: se elige su hijo en la cadena
      const i = cadena.indexOf(a)
      if (i >= 0) return cadena[Math.min(i + 1, cadena.length - 1)]!.getAttribute('data-id')
    }
  }
  return cadena[0]!.getAttribute('data-id')
}

/** Doble clic: un nivel más adentro que la actual, por el camino del punto. */
export function capaParaDobleClic(marco: string, x: number, y: number, actual: string | null): string | null {
  const el = capaEn(marco, x, y)
  if (!el) return null
  const cadena = cadenaDe(el)
  if (!actual) return cadena[0]!.getAttribute('data-id')
  const a = elementoDeCapa(marco, actual)
  const i = a ? cadena.indexOf(a) : -1
  if (i >= 0) return cadena[Math.min(i + 1, cadena.length - 1)]!.getAttribute('data-id')
  return capaParaClic(marco, x, y, actual, false)
}

/** Rectángulo de una capa en px del marco. */
export function rectDeCapa(marco: string, capa: string): DOMRect | null {
  const el = elementoDeCapa(marco, capa)
  return el ? el.getBoundingClientRect() : null
}

/** ¿La capa está ubicada en absoluto (se puede mover y redimensionar con el mouse)? */
export function esAbsoluta(marco: string, capa: string): boolean {
  const el = elementoDeCapa(marco, capa)
  if (!el) return false
  const pos = el.ownerDocument.defaultView?.getComputedStyle(el).position
  return pos === 'absolute' || pos === 'fixed'
}

/** ¿Tiene solo texto (se puede editar en el lugar)? */
export function esTexto(el: HTMLElement): boolean {
  if (el.hasAttribute('data-pieza')) return false
  const tieneTexto = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())
  return tieneTexto && el.children.length === 0
}
