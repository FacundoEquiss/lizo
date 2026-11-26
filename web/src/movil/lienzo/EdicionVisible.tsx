// Escribir en el lienzo con el teclado del teléfono (plan del celular, 7.5).
//
// El problema: al agregar una nota o un texto en la parte de abajo del lienzo, el teclado se abría y se cerraba solo. El
// teclado de Android achica la ventana (interactive-widget=resizes-content), el lienzo queda más bajo, y React Flow, que
// dibuja solo lo que se ve (onlyRenderVisibleElements), desmontaba el objeto que se estaba escribiendo porque había quedado
// debajo del teclado: el editor se destruía, el foco se iba, el teclado se cerraba y la nota nueva quedaba vacía.
//
//   · Al entrar a escribir, la vista se lleva (220 ms) para que el objeto quede en la parte que el teclado no va a tapar,
//     con letra legible (zoom de 0,9 a 1,4; si no entra, el que entre).
//   · Cuando el teclado cambia el alto de la ventana (o del visualViewport en iOS), en ese mismo evento y sin animación, si
//     el objeto no quedó entero a la vista: el evento resize llega antes de que React Flow mida el lienzo nuevo, así el
//     objeto nunca sale de lo que React Flow dibuja.
//   · Al terminar, el zoom no vuelve atrás: devolverlo marea, y quien terminó de escribir quiere ver lo que escribió.
import { useReactFlow, type Viewport } from '@xyflow/react'
import { useContext, useEffect } from 'react'
import { useTienda } from '../../estado/tienda'
import { movimientoReducido } from '../../util/movimiento'
import { cajaNodo, ContextoLienzo } from '../../vistas/lienzo/acciones'
import type { AristaConector, NodoLienzo } from '../../vistas/lienzo/tipos'
import { altoLibre, esTactil } from '../detectar'

const ZOOM_LEGIBLE = { min: 0.9, max: 1.4 }
/** Si el objeto no entra ni así, se ve una parte (centrada, o la de arriba en un texto): más chico ya no se lee. */
const ZOOM_MINIMO = 0.6
const AIRE = 10
/** Arriba: los botones flotantes del lienzo (44 px y su margen). Con el teclado abierto se apartan (movil.css). */
const BOTONES_ARRIBA = 64
/** Abajo: la barra de lo elegido (52 px a 8 del borde) y un poco de aire. */
const BARRA_ABAJO = 68

interface Zona {
  left: number
  top: number
  right: number
  bottom: number
}

/** Lo de abajo de la pantalla que se ve (iOS superpone el teclado: cuenta el visualViewport). */
function abajoVisible() {
  const vv = window.visualViewport
  return vv ? Math.min(innerHeight, vv.offsetTop + vv.height) : innerHeight
}

/** ¿El teclado está abierto? Lo mismo que mira teclado.ts (el atributo data-teclado llega un cuadro después). */
function tecladoAbierto() {
  const vv = window.visualViewport
  const tapa = vv ? innerHeight - vv.height - vv.offsetTop : 0
  return tapa > 120 || innerHeight < altoLibre() * 0.75
}

/**
 * La parte del lienzo que se ve mientras se escribe, en px de pantalla. Con el teclado ya abierto, la real (la barra de
 * abajo de la app se esconde y el lienzo llega hasta el teclado); si todavía no se abrió, la que va a quedar (se estima
 * el teclado en la mitad de la ventana parada, o un poco más acostada: mejor de más que de menos).
 */
function zonaLibre(lienzo: HTMLElement, prever: boolean): Zona {
  const r = lienzo.getBoundingClientRect()
  const abierto = tecladoAbierto()
  let fondo: number
  if (abierto) fondo = abajoVisible()
  else if (prever) fondo = innerHeight - Math.round(innerHeight * (innerWidth > innerHeight ? 0.6 : 0.52))
  else fondo = Math.min(r.bottom, abajoVisible())
  const arriba = r.top + (abierto || prever ? AIRE : BOTONES_ARRIBA)
  const abajo = Math.max(fondo - BARRA_ABAJO, arriba + 80)
  return { left: r.left + AIRE, right: r.right - AIRE, top: arriba, bottom: abajo }
}

/** La vista con la que el objeto queda entero en la zona (o lo más que se pueda) y legible. null: ya está bien. */
function vistaParaEscribir(n: NodoLienzo, zona: Zona, lienzo: DOMRect, vp: Viewport, legible: boolean): Viewport | null {
  const tipo = n.data.elemento.tipo
  const libreW = zona.right - zona.left
  const libreH = zona.bottom - zona.top

  // El marco se escribe en su título (afuera, arriba, del mismo tamaño con cualquier zoom): solo se corre la vista.
  if (tipo === 'marco') {
    const t = document.querySelector<HTMLElement>(`.lienzo .react-flow__node[data-id="${CSS.escape(n.id)}"] .marco__titulo`)?.getBoundingClientRect()
    if (!t) return null
    const dx = t.left < zona.left ? zona.left - t.left : t.right > zona.right ? Math.max(zona.right - t.right, zona.left - t.left) : 0
    const dy = t.top < zona.top ? zona.top - t.top : t.bottom > zona.bottom ? zona.top + (libreH - t.height) / 2 - t.top : 0
    return dx || dy ? { x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom } : null
  }

  const c = cajaNodo(n)
  const ahora = {
    left: lienzo.left + vp.x + c.x * vp.zoom,
    top: lienzo.top + vp.y + c.y * vp.zoom,
    right: lienzo.left + vp.x + (c.x + c.w) * vp.zoom,
    bottom: lienzo.top + vp.y + (c.y + c.h) * vp.zoom,
  }
  const entero = ahora.left >= zona.left - 1 && ahora.right <= zona.right + 1 && ahora.top >= zona.top - 1 && ahora.bottom <= zona.bottom + 1
  if (entero && (!legible || vp.zoom >= ZOOM_LEGIBLE.min - 0.01)) return null

  let z = legible ? Math.min(Math.max(vp.zoom, ZOOM_LEGIBLE.min), ZOOM_LEGIBLE.max) : vp.zoom
  z = Math.min(z, libreW / c.w)
  if (c.h * z > libreH) z = Math.max(libreH / c.h, Math.min(z, ZOOM_MINIMO))
  const w = c.w * z
  const h = c.h * z
  // Adentro de la zona: centrado; si no entra, el texto se lee desde arriba (la nota y la forma centran su texto).
  const sx = zona.left + (libreW - w) / 2
  const sy = h <= libreH || tipo === 'nota' || tipo === 'forma' ? zona.top + (libreH - h) / 2 : zona.top
  return { x: sx - lienzo.left - c.x * z, y: sy - lienzo.top - c.y * z, zoom: z }
}

export function EdicionVisible() {
  const rf = useReactFlow<NodoLienzo, AristaConector>()
  const ctx = useContext(ContextoLienzo)

  useEffect(() => {
    if (!ctx || !esTactil()) return
    const lienzo = () => ctx.contenedor()
    const nodoEditado = () => {
      const id = useTienda.getState().editando
      return id ? (rf.getNode(id) ?? null) : null
    }
    const mover = (vista: Viewport, ms: number) => {
      const duracion = movimientoReducido() ? 0 : ms
      if (!duracion) ctx.antesDeZoom?.(vista.zoom)
      void rf.setViewport(vista, { duration: duracion })
    }

    // Al entrar a escribir (el editor se monta y toma el foco en el cuadro siguiente; el teclado llega después). Un objeto
    // recién creado puede tardar un cuadro o dos en llegar a React Flow: se reintenta.
    let cuadro = 0
    const desuscribir = useTienda.subscribe((s, antes) => {
      if (!s.editando || s.editando === antes.editando) return
      cancelAnimationFrame(cuadro)
      let intentos = 0
      const llevar = () => {
        const el = lienzo()
        const n = nodoEditado()
        if (!el) return
        if (!n) {
          if (useTienda.getState().editando && intentos++ < 10) cuadro = requestAnimationFrame(llevar)
          return
        }
        const vista = vistaParaEscribir(n, zonaLibre(el, true), el.getBoundingClientRect(), rf.getViewport(), true)
        if (vista) mover(vista, 220)
      }
      cuadro = requestAnimationFrame(llevar)
    })

    // El teclado cambió el alto: en el mismo evento, antes de que React Flow mida el lienzo nuevo.
    const alCambiarAlto = () => {
      const el = lienzo()
      const n = nodoEditado()
      if (!el || !n) return
      const vista = vistaParaEscribir(n, zonaLibre(el, false), el.getBoundingClientRect(), rf.getViewport(), false)
      if (vista) mover(vista, 0)
    }
    const vv = window.visualViewport
    window.addEventListener('resize', alCambiarAlto)
    vv?.addEventListener('resize', alCambiarAlto)
    return () => {
      cancelAnimationFrame(cuadro)
      desuscribir()
      window.removeEventListener('resize', alCambiarAlto)
      vv?.removeEventListener('resize', alCambiarAlto)
    }
  }, [rf, ctx])

  return null
}
