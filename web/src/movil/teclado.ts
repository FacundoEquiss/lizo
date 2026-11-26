// Teclado en pantalla (plan del celular, 3.4). Hacen falta dos mecanismos:
//   · Android (Chrome 108+ con interactive-widget=resizes-content): el teclado ACHICA la página, así que 100dvh ya lo
//     descuenta y --teclado queda en 0. El teclado se detecta por la altura que se perdió (data-teclado).
//   · iOS: el teclado se SUPERPONE y solo cambia el visualViewport. Acá se calcula cuánto tapa:
//       --teclado = max(0, innerHeight - visualViewport.height - visualViewport.offsetTop)
// Además: al enfocar un campo dentro de una zona con scroll se lo centra (el navegador solo garantiza ver el cursor), y
// tocar fuera de un campo lo desenfoca (una app instalada en iOS no lo hace sola).
import { esCampo as esEditable, esTactil } from './detectar'

let iniciado = false
/**
 * El alto visible "sin teclado" de cada ancho: el mayor que se vio sin un campo enfocado. Por ancho y no por orientación
 * de la ventana: con el teclado abierto, un teléfono vertical de 360 px puede quedar más ancho que alto, y comparado con
 * el alto libre de "horizontal" (que no tenía) parecía que no había teclado.
 */
const altosLibres = new Map<number, number>()

function zonaConScroll(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p
  }
  return null
}

export function iniciarTeclado() {
  if (iniciado) return
  iniciado = true
  const html = document.documentElement
  const vv = window.visualViewport
  let cuadro = 0

  const medir = () => {
    cuadro = 0
    const ancho = Math.round(innerWidth)
    const alto = vv ? vv.height : innerHeight
    const enfocado = esEditable(document.activeElement)
    const libre = altosLibres.get(ancho) ?? 0
    if (!enfocado || alto > libre) altosLibres.set(ancho, Math.max(libre, alto))
    const tapa = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0
    html.style.setProperty('--teclado', `${tapa}px`)
    const achico = enfocado && libre > 0 && alto < libre * 0.75
    html.toggleAttribute('data-teclado', tapa > 120 || achico)
    // iOS a veces corre todo el documento para mostrar el campo; la app mide 100dvh y no se desplaza: se vuelve arriba
    // (lo que se escribe ya queda a la vista porque las hojas se suben --teclado y el campo se centra en su zona).
    if (enfocado && html.hasAttribute('data-movil') && (document.scrollingElement?.scrollTop ?? 0) > 0) window.scrollTo(0, 0)
  }
  const pedirMedida = () => {
    if (!cuadro) cuadro = requestAnimationFrame(medir)
  }
  vv?.addEventListener('resize', pedirMedida)
  vv?.addEventListener('scroll', pedirMedida)
  addEventListener('resize', pedirMedida)
  addEventListener('orientationchange', () => setTimeout(medir, 250))
  medir()

  // Al enfocar un campo dentro de una zona con scroll: centrarlo, con aire arriba y abajo.
  document.addEventListener('focusin', (e) => {
    const el = e.target as Element
    if (!esTactil() || !esEditable(el) || el.closest('.react-flow, [data-sin-centrar]')) return
    medir()
    const centrar = () => {
      if (document.activeElement !== el || !zonaConScroll(el)) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    setTimeout(centrar, 100)
    // En iOS el teclado termina de subir después: se centra otra vez con el primer cambio del visualViewport.
    if (vv) {
      const una = () => {
        vv.removeEventListener('resize', una)
        setTimeout(centrar, 60)
      }
      vv.addEventListener('resize', una)
      setTimeout(() => vv.removeEventListener('resize', una), 900)
    }
  })
  document.addEventListener('focusout', () => setTimeout(medir, 50))

  // Tocar un espacio vacío fuera del campo cierra el teclado.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return
      const activo = document.activeElement
      if (!esEditable(activo)) return
      const t = e.target as Element
      if (activo.contains(t)) return
      if (t.closest('input, textarea, select, button, a, label, [role="button"], [role="menuitem"], [role="option"], [contenteditable], [data-conserva-foco], .react-flow'))
        return
      activo.blur()
    },
    { capture: true, passive: true },
  )
}
