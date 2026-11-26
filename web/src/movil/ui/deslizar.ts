// Deslizar para cerrar desde cualquier parte de una hoja (como en las apps nativas). Si lo que está bajo el dedo ya está
// arriba de todo (o no se desplaza), arrastrar hacia abajo lleva la hoja con el dedo; al soltar se cierra si bajó más de
// 96 px o iba rápido (más de 500 px/s), y si no vuelve con el resorte. En horizontal (panel derecho), lo mismo hacia la
// derecha.
//   · Se decide con el primer movimiento: hacia arriba, de costado o con algo que todavía se puede desplazar hacia atrás,
//     el gesto es del navegador (scroll) y no se toca. Hacia abajo y arriba de todo, es de la hoja: se cancela el scroll.
//   · No arranca en campos de texto (seleccionar, mover el cursor), en lo que maneja su propio gesto (touch-action: none:
//     el agarre, deslizadores, superficies con pellizco), en lo que se arrastra para ordenar ni en [data-sin-deslizar].
//   · Toques del dedo (touch events, para poder cancelar el scroll); el mouse sigue arrastrando desde el agarre.
//   · La vuelta es un resorte propio de pocas líneas (el mismo de la hoja): el animate() de motion sumaba ~8 KB al
//     arranque del teléfono.
import type { MotionValue } from 'motion/react'
import { useEffect, useRef, type RefObject } from 'react'

/** Se cierra si se soltó más allá de esto (px) o con más velocidad que esto (px/s). */
const DISTANCIA = 96
const VELOCIDAD = 500

const SIN_DESLIZAR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [data-sin-deslizar], [aria-roledescription="sortable"], .ordenable'

export interface Resorte {
  stiffness: number
  damping: number
  mass: number
}

/** ¿El gesto puede empezar acá? (entre el elemento tocado y la hoja). */
function puedeEmpezar(objetivo: Element, hoja: HTMLElement) {
  if (objetivo.closest(SIN_DESLIZAR)) return false
  if (document.body.classList.contains('arrastrando')) return false
  for (let el: Element | null = objetivo; el; el = el.parentElement) {
    if (getComputedStyle(el).touchAction === 'none') return false
    if (el === hoja) break
  }
  return true
}

/** ¿Hay algo bajo el dedo que todavía se puede desplazar "hacia atrás" (arriba, o a la izquierda en el panel)? */
function sePuedeVolver(objetivo: Element, hoja: HTMLElement, eje: 'x' | 'y') {
  for (let el: Element | null = objetivo; el; el = el.parentElement) {
    const cs = getComputedStyle(el)
    if (eje === 'y') {
      if (/auto|scroll|overlay/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0) return true
    } else if (/auto|scroll|overlay/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.scrollLeft > 0) return true
    if (el === hoja) break
  }
  return false
}

/** Después de arrastrar no tiene que llegar un "click" al botón donde empezó el dedo. */
function tragarClic() {
  const fn = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener('click', fn, true)
  setTimeout(() => window.removeEventListener('click', fn, true), 350)
}

/** Lleva el valor a 0 con un resorte (masa, rigidez y amortiguación como los de motion). Devuelve cómo pararlo. */
function volverACero(valor: MotionValue<number>, { stiffness, damping, mass }: Resorte) {
  let x = Number(valor.get()) || 0
  let v = valor.getVelocity() || 0
  let antes = performance.now()
  let cuadro = requestAnimationFrame(function paso(ahora) {
    const dt = Math.min(0.032, (ahora - antes) / 1000)
    antes = ahora
    v += ((-stiffness * x - damping * v) / mass) * dt
    x += v * dt
    if (Math.abs(x) < 0.5 && Math.abs(v) < 10) {
      valor.set(0)
      return
    }
    valor.set(x)
    cuadro = requestAnimationFrame(paso)
  })
  return () => cancelAnimationFrame(cuadro)
}

interface Gesto {
  x0: number
  y0: number
  objetivo: Element
  arrastrando: boolean
  base: number
}

export function useDeslizarParaCerrar({
  hoja,
  eje,
  valor,
  activo,
  alCerrar,
  resorte,
}: {
  /** La hoja (el elemento que se mueve). */
  hoja: RefObject<HTMLElement | null>
  /** 'y': se cierra hacia abajo; 'x': hacia la derecha. */
  eje: 'x' | 'y'
  /** El desplazamiento de la hoja en ese eje (el mismo valor que mueve el arrastre del agarre). */
  valor: MotionValue<number>
  activo: boolean
  alCerrar: () => void
  resorte: Resorte
}) {
  const refCerrar = useRef(alCerrar)
  refCerrar.current = alCerrar
  const refResorte = useRef(resorte)
  refResorte.current = resorte

  useEffect(() => {
    const el = hoja.current
    if (!el || !activo) return
    let g: Gesto | null = null
    let pararVuelta: (() => void) | null = null

    const inicio = (e: TouchEvent) => {
      g = null
      if (e.touches.length !== 1) return
      const t = e.touches[0]!
      const objetivo = e.target as Element
      if (!puedeEmpezar(objetivo, el)) return
      g = { x0: t.clientX, y0: t.clientY, objetivo, arrastrando: false, base: 0 }
    }

    const mover = (e: TouchEvent) => {
      if (!g) return
      if (e.touches.length !== 1) {
        terminar()
        return
      }
      const t = e.touches[0]!
      const dx = t.clientX - g.x0
      const dy = t.clientY - g.y0
      const d = eje === 'y' ? dy : dx
      const cruzado = eje === 'y' ? dx : dy
      if (!g.arrastrando) {
        if (Math.abs(d) < 3 && Math.abs(cruzado) < 3) return
        // Hacia atrás, de costado o con scroll por recorrer: es del navegador.
        if (d <= 0 || Math.abs(cruzado) > Math.abs(d) || !e.cancelable || sePuedeVolver(g.objetivo, el, eje)) {
          g = null
          return
        }
        g.arrastrando = true
        g.base = d
        valor.stop()
        pararVuelta?.()
        pararVuelta = null
      }
      e.preventDefault()
      const desp = d - g.base
      // Hacia atrás (más allá de donde está abierta) apenas cede, como el agarre.
      valor.set(desp >= 0 ? desp : desp * 0.04)
    }

    const terminar = () => {
      const gesto = g
      g = null
      if (!gesto?.arrastrando) return
      tragarClic()
      const actual = Number(valor.get()) || 0
      if (actual > DISTANCIA || valor.getVelocity() > VELOCIDAD) refCerrar.current()
      else pararVuelta = volverACero(valor, refResorte.current)
    }

    el.addEventListener('touchstart', inicio, { passive: true })
    el.addEventListener('touchmove', mover, { passive: false })
    el.addEventListener('touchend', terminar)
    el.addEventListener('touchcancel', terminar)
    return () => {
      pararVuelta?.()
      el.removeEventListener('touchstart', inicio)
      el.removeEventListener('touchmove', mover)
      el.removeEventListener('touchend', terminar)
      el.removeEventListener('touchcancel', terminar)
    }
  }, [hoja, eje, valor, activo])
}
