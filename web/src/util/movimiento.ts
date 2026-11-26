// El movimiento de la app (9.1): un solo catálogo de curvas, duraciones y resortes, para que todo se mueva "igual".
// Reglas: nada dura más de 260 ms salvo los encuadres (420); lo que entra usa CURVA y lo que sale CURVA_SALE; solo se
// animan transform y opacity. Con "reducir movimiento" (del sistema o de Configuración) MotionConfig (App.tsx) deja solo
// los fundidos, el CSS pone las duraciones en 0 (tokens.css) y los encuadres son instantáneos (movimientoReducido).
import type { Transition } from 'motion/react'

const consulta = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null

/** ¿Hay que reducir el movimiento? Lo pide el sistema (prefers-reduced-motion) o la Configuración (data-movimiento). */
export function movimientoReducido(): boolean {
  const pref = typeof document !== 'undefined' ? document.documentElement.dataset.movimiento : undefined
  if (pref === 'reducido') return true
  if (pref === 'completo') return false
  return Boolean(consulta?.matches)
}

/** Una duración en ms, o 0 si hay que reducir el movimiento (para setViewport, zoomIn y compañía). */
export const duracion = (ms: number) => (movimientoReducido() ? 0 : ms)

/** var(--curva) y var(--curva-sale) de tokens.css, para motion. */
export const CURVA = [0.15, 1, 0.3, 1] as const
export const CURVA_SALE = [0.32, 0, 0.67, 0] as const

/** Diálogos: escala 0,97 → 1 y 10 px de subida con el resorte 480/36; se van en 120 ms. */
export const DIALOGO = {
  initial: { opacity: 0, scale: 0.97, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.12, ease: CURVA_SALE } },
  transition: { type: 'spring', stiffness: 480, damping: 36 } as Transition,
}

/** El velo detrás de un diálogo. */
export const VELO = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.16, ease: CURVA } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: CURVA_SALE } },
}

/** Menús y ventanitas: escala 0,96 → 1 y opacidad, desde su origen, en 140 ms. */
export const MENU = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.14, ease: CURVA } as Transition,
}

/** Las píldoras que se deslizan con layoutId: la de la herramienta activa y el resto (tema, sección, tablero). */
export const RESORTE_HERRAMIENTA: Transition = { type: 'spring', stiffness: 600, damping: 38 }
export const RESORTE_PILDORA: Transition = { type: 'spring', stiffness: 500, damping: 38 }

/** El origen de una ventanita según de qué lado del disparador se abrió (floating-ui). */
export function origenDe(lado: string): string {
  const [eje, punta] = lado.split('-') as [string, string | undefined]
  const vertical = eje === 'bottom' ? 'top' : eje === 'top' ? 'bottom' : 'center'
  const horizontal = eje === 'left' ? 'right' : eje === 'right' ? 'left' : punta === 'start' ? 'left' : punta === 'end' ? 'right' : 'center'
  return `${horizontal} ${vertical}`
}
