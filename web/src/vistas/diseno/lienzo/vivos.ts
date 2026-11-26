// Qué marcos se dibujan "vivos" (iframe) y cuáles con su miniatura (plan 9, R1–R3).
// Un marco pasa a iframe cuando está en pantalla, ocupa más de 240 px de ancho en pantalla y el lienzo lleva 150 ms quieto;
// o cuando está seleccionado o en modo Probar. Tope: 12 iframes vivos; los que salen de pantalla se apagan a los 3 s.
import { useSyncExternalStore } from 'react'

export const TOPE_VIVOS = 12
const ANCHO_MINIMO = 240

/** Los iframes montados, por marco (los usan la selección, la regla y el inspector). */
export const iframes = new Map<string, HTMLIFrameElement>()

let vivos = new Set<string>()
const oyentes = new Set<() => void>()
const ultimaVezVisto = new Map<string, number>()

export function suscribirVivos(fn: () => void) {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}
const avisar = () => {
  for (const o of oyentes) o()
}

export function useVivo(id: string): boolean {
  return useSyncExternalStore(suscribirVivos, () => vivos.has(id))
}

export function cantidadVivos() {
  return vivos.size
}

export interface EntradaVivos {
  marcos: { id: string; x: number; y: number; ancho: number; alto: number }[]
  vista: { x: number; y: number; zoom: number }
  ancho: number
  alto: number
  /** Siempre vivos: el seleccionado y el que está en Probar. */
  fijos: string[]
  sobre: string | null
  /** Tope de iframes vivos (de fábrica 12; el celular usa menos: tiene menos memoria). */
  tope?: number
}

/** Recalcula quiénes viven. Monta de a 2 por cuadro para no trabar el lienzo. */
export function recalcularVivos(e: EntradaVivos) {
  const ahora = performance.now()
  const cx = e.ancho / 2
  const cy = e.alto / 2
  const candidatos: { id: string; prioridad: number }[] = []
  for (const m of e.marcos) {
    const x = m.x * e.vista.zoom + e.vista.x
    const y = m.y * e.vista.zoom + e.vista.y
    const w = m.ancho * e.vista.zoom
    const h = m.alto * e.vista.zoom
    const visible = x < e.ancho && y < e.alto && x + w > 0 && y + h > 0
    if (visible) ultimaVezVisto.set(m.id, ahora)
    const fijo = e.fijos.includes(m.id)
    if (fijo || (visible && w >= ANCHO_MINIMO)) {
      const d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy)
      candidatos.push({ id: m.id, prioridad: fijo ? -2e9 : m.id === e.sobre ? -1e9 : d })
    } else if (vivos.has(m.id) && !visible && ahora - (ultimaVezVisto.get(m.id) ?? 0) < 3000) {
      // salió de pantalla hace poco: sigue vivo un rato (si vuelve, no parpadea)
      candidatos.push({ id: m.id, prioridad: 1e9 })
    }
  }
  candidatos.sort((a, b) => a.prioridad - b.prioridad)
  const quedan = new Set(candidatos.slice(0, e.tope ?? TOPE_VIVOS).map((c) => c.id))
  const nuevos = [...quedan].filter((id) => !vivos.has(id))
  const salen = [...vivos].filter((id) => !quedan.has(id))
  if (!nuevos.length && !salen.length) return
  vivos = new Set([...vivos].filter((id) => quedan.has(id)))
  avisar()
  // se montan de a 2 por cuadro libre
  const montar = () => {
    if (!nuevos.length) return
    const tanda = nuevos.splice(0, 2)
    vivos = new Set([...vivos, ...tanda])
    avisar()
    if (nuevos.length) (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 16)))(montar)
  }
  montar()
}

export function reiniciarVivos() {
  vivos = new Set()
  iframes.clear()
  ultimaVezVisto.clear()
  avisar()
}
