// El marco de todos los diálogos (9.3): velo, animación del catálogo, foco atrapado adentro mientras está abierto, que
// vuelve a donde estaba al cerrar, y el nombre que lee el lector de pantalla (su título). Esc lo cierra el atajo global
// (App.tsx); tocar el velo, también.
import { FloatingFocusManager, useFloating } from '@floating-ui/react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { DIALOGO, VELO } from '../util/movimiento'

export function Dialogo({
  abierto,
  alCerrar,
  tituloId,
  etiqueta,
  className = '',
  enfocarInicial = 0,
  children,
}: {
  abierto: boolean
  alCerrar: () => void
  /** El id del título (aria-labelledby). */
  tituloId?: string
  /** Si no hay un título con id: el nombre del diálogo. */
  etiqueta?: string
  className?: string
  /** Qué enfocar al abrir: el n-ésimo control (de fábrica, el primero) o -1 para dejarlo a un autoFocus de adentro. */
  enfocarInicial?: number
  children: ReactNode
}) {
  const { refs, context } = useFloating({ open: abierto, onOpenChange: (v) => !v && alCerrar() })
  return (
    <AnimatePresence>
      {abierto && (
        <motion.div className="velo velo--centro" {...VELO} onMouseDown={(e) => e.target === e.currentTarget && alCerrar()}>
          <FloatingFocusManager context={context} modal initialFocus={enfocarInicial}>
            <motion.div
              ref={refs.setFloating}
              className={`dialogo ${className}`}
              role="dialog"
              aria-modal
              aria-labelledby={tituloId}
              aria-label={tituloId ? undefined : etiqueta}
              {...DIALOGO}
            >
              {children}
            </motion.div>
          </FloatingFocusManager>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
