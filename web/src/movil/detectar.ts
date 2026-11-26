// Qué dispositivo es (plan del celular, 2.1). Una sola regla decide si se muestra la app del celular o la de escritorio,
// la misma que usa el script en línea de index.html para poner los atributos antes de pintar:
//   data-movil       teléfono en vertical (o ventana muy angosta) y teléfono acostado (dedo y poca altura)
//   data-apaisado    teléfono acostado
//   data-tactil      el puntero principal es el dedo (teléfono o tablet)
//   data-instalada   abierta como app instalada
// Para pruebas se puede forzar con localStorage['telar.movil'] = 'si' | 'no'.
//
// Con el dedo, el alto que cuenta es el de la ventana SIN teclado. En Android (interactive-widget=resizes-content) el
// teclado achica la ventana, y con la franja de autocompletar de Chrome un teléfono vertical de 360 px queda con 340 de
// alto: medido en ese momento parecía un teléfono acostado, y la app pasaba al riel lateral y a las hojas de costado en
// cuanto se abría el teclado (y una tablet acostada pasaba a la app del celular). El teclado cambia el alto pero nunca
// el ancho: se guarda el alto de cada ancho mientras no hay un campo enfocado, y con un campo enfocado se usa ese.
import { useSyncExternalStore } from 'react'

/** Ventana angosta (teléfono en vertical o ventana chica de escritorio). */
export const CONSULTA_ANGOSTA = '(max-width: 760px)'
/** Sin dedo (mouse o trackpad), la ventana manda: así se prueba el celular achicando la ventana de escritorio. */
export const CONSULTA_APAISADO = '(orientation: landscape) and (max-height: 500px)'
/** Teléfono acostado: hasta este alto (sin teclado). */
const ALTO_ACOSTADO = 500

const mqAngosta = matchMedia(CONSULTA_ANGOSTA)
const mqApaisado = matchMedia(CONSULTA_APAISADO)
const mqOrientacion = matchMedia('(orientation: landscape)')
const mqTactil = matchMedia('(pointer: coarse)')
const mqInstalada = matchMedia('(display-mode: standalone)')

function forzado(): boolean | null {
  try {
    const f = localStorage.getItem('telar.movil')
    return f === 'si' ? true : f === 'no' ? false : null
  } catch {
    return null
  }
}

/** ¿Hay un campo enfocado? (con el dedo, el teclado puede estar abierto). */
export const esCampo = (el: Element | null): el is HTMLElement =>
  !!el &&
  ((el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes((el as HTMLInputElement).type)) ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    (el as HTMLElement).isContentEditable)

/**
 * El alto de la ventana sin teclado, por ancho (girar cambia el ancho; el teclado, no): el mayor que se vio sin un campo
 * enfocado. El mayor y no el último: mientras el teclado termina de irse puede llegar un alto todavía achicado.
 */
const altosLibres = new Map<number, number>()
function anotarAlto() {
  if (esCampo(document.activeElement)) return
  const ancho = Math.round(innerWidth)
  altosLibres.set(ancho, Math.max(altosLibres.get(ancho) ?? 0, innerHeight))
}
/** El alto de la ventana sin el teclado en pantalla (si nunca se midió para este ancho, el de ahora). */
export const altoLibre = () => altosLibres.get(Math.round(innerWidth)) ?? innerHeight

/** ¿La pantalla está acostada? Según el sistema (no cambia con el teclado); sin ese dato, según la ventana. */
export function pantallaHorizontal(): boolean {
  const tipo = screen.orientation?.type
  if (tipo) return tipo.startsWith('landscape')
  const angulo = (window as Window & { orientation?: number }).orientation
  if (typeof angulo === 'number') return Math.abs(angulo) === 90
  return mqOrientacion.matches
}

/** El lado corto de la pantalla, en px CSS (iOS da siempre el de vertical; Android, el de la orientación actual). */
const ladoCorto = () => Math.min(screen.width || innerWidth, screen.height || innerHeight)

/**
 * Acostado, con el dedo: la ventana es mucho más ancha que el lado corto de la pantalla (en vertical miden lo mismo), o
 * el sistema dice que está acostada y la ventana sin teclado es más ancha que alta (pantalla dividida).
 */
const acostadoTactil = () => altoLibre() <= ALTO_ACOSTADO && (innerWidth > ladoCorto() + 100 || (pantallaHorizontal() && innerWidth > altoLibre()))

export const esTactil = () => mqTactil.matches
export const esMovil = () => forzado() ?? (mqAngosta.matches || (esTactil() && altoLibre() <= ALTO_ACOSTADO))
export const esApaisado = () => esMovil() && (esTactil() ? acostadoTactil() : mqApaisado.matches)
export const esInstalada = () => mqInstalada.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
export const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const oyentes = new Set<() => void>()
const foto = () => `${esMovil()}${esApaisado()}${esTactil()}${esInstalada()}`
let ultima = ''

function ponerAtributos() {
  const html = document.documentElement
  html.toggleAttribute('data-movil', esMovil())
  html.toggleAttribute('data-apaisado', esApaisado())
  html.toggleAttribute('data-tactil', esTactil())
  html.toggleAttribute('data-instalada', esInstalada())
}

function alCambiar() {
  anotarAlto()
  ponerAtributos()
  // Se avisa solo si algo cambió (llega también con cada resize de la ventana).
  const ahora = foto()
  if (ahora === ultima) return
  ultima = ahora
  for (const o of oyentes) o()
}

for (const mq of [mqAngosta, mqApaisado, mqOrientacion, mqTactil, mqInstalada]) mq.addEventListener('change', alCambiar)
// Girar: llega por el cambio de orientación y por el resize (en algunos navegadores, uno antes que el otro).
screen.orientation?.addEventListener?.('change', alCambiar)
addEventListener('orientationchange', () => setTimeout(alCambiar, 120))
addEventListener('resize', alCambiar)
// Al salir de un campo, el alto que se ve vuelve a ser el "libre" (si el teclado todavía se está yendo, llega otro resize).
document.addEventListener('focusout', () => setTimeout(alCambiar, 0))
anotarAlto()
ponerAtributos()
ultima = foto()

function suscribir(cb: () => void) {
  oyentes.add(cb)
  return () => {
    oyentes.delete(cb)
  }
}

/** ¿Se muestra la app del teléfono? Cambia en vivo (una ventana que se angosta pasa al celular). */
export const useEsMovil = () => useSyncExternalStore(suscribir, esMovil)

/** Teléfono acostado: la barra inferior pasa a riel lateral y las hojas a panel derecho. Girar no desmonta nada. */
export const useEsApaisado = () => useSyncExternalStore(suscribir, esApaisado)

export const useEsInstalada = () => useSyncExternalStore(suscribir, esInstalada)
