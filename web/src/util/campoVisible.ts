// Que el campo con foco quede a la vista en las pantallas de entrar (Entrar, Unirse) aunque el teclado del celular esté abierto o la barra
// del navegador se coma la pantalla. Dos cosas:
//   · Al enfocar un campo, se lo trae al centro de lo que se ve (el teclado tarda en abrirse: se intenta dos veces).
//   · En los navegadores donde el teclado no achica la página (iOS: solo se achica la ventana visual), `--entrar-teclado` guarda cuánto tapa,
//     y la pantalla suma ese alto abajo para que el último campo y el botón puedan subir por encima del teclado (entrar.css).
import { useEffect } from 'react'

const UMBRAL_TECLADO = 80

export function useCampoVisible() {
  useEffect(() => {
    const raiz = document.documentElement
    const vv = window.visualViewport
    const medir = () => {
      const tapa = vv ? Math.round(window.innerHeight - vv.height - vv.offsetTop) : 0
      raiz.style.setProperty('--entrar-teclado', `${tapa > UMBRAL_TECLADO ? tapa : 0}px`)
    }
    const traer = (e: FocusEvent) => {
      const campo = e.target
      if (!(campo instanceof HTMLElement) || !campo.matches('input, textarea, select') || !campo.closest('.entrar')) return
      for (const ms of [50, 300]) {
        setTimeout(() => {
          if (document.activeElement === campo) campo.scrollIntoView({ block: 'center', inline: 'nearest' })
        }, ms)
      }
    }
    medir()
    vv?.addEventListener('resize', medir)
    vv?.addEventListener('scroll', medir)
    document.addEventListener('focusin', traer)
    return () => {
      vv?.removeEventListener('resize', medir)
      vv?.removeEventListener('scroll', medir)
      document.removeEventListener('focusin', traer)
      raiz.style.removeProperty('--entrar-teclado')
    }
  }, [])
}
