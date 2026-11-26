// Las cinco fuentes del lienzo. Sans (Figtree) y Mono (Geist Mono) ya están en la app; Serif, Manuscrita y Títulos se
// cargan una sola vez cuando hacen falta: al abrir el selector de fuentes o al abrir un tablero que las usa. El CSS de
// cada una solo declara la fuente: el archivo .woff2 se baja recién cuando algún texto la usa.
import { useSyncExternalStore } from 'react'
import { FUENTES, type Fuente } from '../../../../../compartido/lienzo'
import type { ElementoLienzo } from '../../../../../compartido/tipos'

const IMPORTAR: Record<Fuente, () => Promise<unknown>> = {
  // Figtree y Geist Mono ya vienen con la app: acá solo se suma su cursiva verdadera (sin esto el navegador la inclina).
  sans: () => import('@fontsource-variable/figtree/wght-italic.css'),
  mono: () => import('@fontsource-variable/geist-mono/wght-italic.css'),
  serif: () => Promise.all([import('@fontsource-variable/newsreader/index.css'), import('@fontsource-variable/newsreader/wght-italic.css')]),
  mano: () => import('@fontsource-variable/caveat/index.css'),
  titulos: () => import('@fontsource-variable/bricolage-grotesque/index.css'),
}

const cargando = new Map<Fuente, Promise<void>>()
const oyentes = new Set<() => void>()
/** Cuántas veces terminó de cargar cada fuente (las medidas que dependen de ella se invalidan). */
const versiones = new Map<Fuente, number>()
let version = 0
export const versionFuente = (f: Fuente) => versiones.get(f) ?? 0

/** Para volver a dibujar cuando termina de cargar alguna fuente. */
export function useFuentesCargadas() {
  return useSyncExternalStore(alCargarFuentes, () => version)
}

/** Avisa cuando terminó de cargar una fuente (las notas con tamaño automático se vuelven a medir). */
export function alCargarFuentes(fn: () => void) {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

export function cargarFuente(f: Fuente): Promise<void> {
  let p = cargando.get(f)
  if (!p) {
    p = IMPORTAR[f]()
      // La letra se baja recién cuando algo la usa: se le pide explícitamente para no esperar al primer dibujo.
      .then(() => document.fonts.load(`500 16px ${familiaCss(f)}`).catch(() => []))
      .then(() => document.fonts.ready)
      .then(() => {
        versiones.set(f, (versiones.get(f) ?? 0) + 1)
        version++
        for (const o of oyentes) o()
      })
      .catch(() => {})
    cargando.set(f, p)
  }
  return p
}

export const cargarTodas = () => Promise.all(FUENTES.map((f) => cargarFuente(f.id)))

/** Al abrir un tablero: las fuentes que usan sus objetos. */
export function cargarFuentesDe(elementos: readonly ElementoLienzo[]) {
  const usadas = new Set<Fuente>(['sans'])
  for (const e of elementos) {
    const f = e.datos.fuente
    if (typeof f === 'string' && FUENTES.some((x) => x.id === f)) usadas.add(f as Fuente)
  }
  for (const f of usadas) void cargarFuente(f)
}

/** Familia CSS de cada fuente (tokens --f-*). */
export const familia = (f: Fuente) => `var(--f-${f})`

/** El nombre de la familia para document.fonts.load (no entiende variables CSS). */
function familiaCss(f: Fuente) {
  const nombre = { sans: 'Figtree Variable', serif: 'Newsreader Variable', mono: 'Geist Mono Variable', mano: 'Caveat Variable', titulos: 'Bricolage Grotesque Variable' }[f]
  return `'${nombre}'`
}
