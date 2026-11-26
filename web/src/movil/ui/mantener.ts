// "Mantener apretado" para filas táctiles (por ejemplo, un tablero en el selector abre Renombrar y Archivar).
// El evento contextmenu se dispara al mantener apretado en Android pero no en iOS: por eso hay un reloj propio, que se
// cancela si el dedo se mueve más de 8 px (es un scroll), si se levanta o si baja otro dedo.
import { useRef } from 'react'
import { vibrar } from '../haptica'

export function useMantenerApretado(alMantener: () => void, ms = 450) {
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inicio = useRef({ x: 0, y: 0 })
  const disparado = useRef(false)
  const cancelar = () => {
    if (reloj.current) clearTimeout(reloj.current)
    reloj.current = null
  }
  const disparar = () => {
    cancelar()
    disparado.current = true
    vibrar('menu')
    alMantener()
  }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      disparado.current = false
      if (e.pointerType === 'mouse') return
      inicio.current = { x: e.clientX, y: e.clientY }
      cancelar()
      reloj.current = setTimeout(disparar, ms)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (reloj.current && Math.hypot(e.clientX - inicio.current.x, e.clientY - inicio.current.y) > 8) cancelar()
    },
    onPointerUp: cancelar,
    onPointerCancel: cancelar,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      if (!disparado.current) disparar()
    },
    /** Envolver el onClick: si el toque terminó en "mantener", no es un toque. */
    fueMantener: () => {
      const f = disparado.current
      disparado.current = false
      return f
    },
  }
}
