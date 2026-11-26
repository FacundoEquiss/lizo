// La hoja que sube desde abajo (plan del celular, 2.4): casi todo lo que en escritorio es un desplegable, un panel o un
// diálogo, en el teléfono es esta hoja. En horizontal es un panel que entra por la derecha (con 393 px de alto, una hoja
// inferior dejaría 100 px de contenido).
//   · Se cierra tocando el velo, con el botón, con "atrás" (useCierraConAtras), con Escape o deslizando hacia abajo (más
//     de 96 px o a más de 500 px/s): desde el agarre y el título siempre, y desde cualquier otra parte si lo que está
//     bajo el dedo ya está arriba de todo (deslizar.ts; si no, el contenido se desplaza como siempre).
//   · El foco entra al abrir (al contenedor, no a un campo: que no salte el teclado sin pedirlo) y vuelve al cerrar.
//   · Con el teclado abierto en iOS la hoja se sube --teclado (en Android la página ya se achica sola).
import {
  FloatingFocusManager,
  FloatingNode,
  useFloating,
  useFloatingNodeId,
  useFloatingParentNodeId,
  FloatingTree,
} from '@floating-ui/react'
import { X } from 'lucide-react'
import { AnimatePresence, motion, useDragControls, useMotionValue, useReducedMotion, type PanInfo } from 'motion/react'
import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useEsApaisado } from '../detectar'
import { useCierraConAtras } from '../historial'
import { useDeslizarParaCerrar } from './deslizar'

/** Profundidad de hojas abiertas (para apilarlas: cada nivel va encima del anterior). */
export const NivelHoja = createContext(0)

interface ContextoHoja {
  /** Cierra la hoja sacando su entrada del historial y después corre fn (por ejemplo, navegar). */
  cerrarYLuego: (fn: () => void) => void
  cerrar: () => void
}
const Contexto = createContext<ContextoHoja | null>(null)
export const useHoja = () => useContext(Contexto)

export interface PropsHoja {
  abierta: boolean
  alCerrar: () => void
  titulo?: ReactNode
  /** Nombre para lectores de pantalla (si no hay título de texto). */
  etiqueta?: string
  alto?: 'contenido' | 'completa'
  /** Fijo arriba, debajo del agarre (por ejemplo, un campo de búsqueda). */
  cabecera?: ReactNode
  /** Fijo abajo (botones). */
  pie?: ReactNode
  className?: string
  /** Qué enfoca al abrir. Por defecto, la hoja (sin teclado). */
  enfocar?: RefObject<HTMLElement | null>
  /** Sin botón de cerrar en el título. */
  sinCerrar?: boolean
  /** Otra hoja la tapa (por ejemplo, la tarjeta abierta desde el buscador): no atrapa el foco ni se lee. */
  inactiva?: boolean
  /** Al cerrar, el foco vuelve a donde estaba (por defecto). Con false lo maneja quien la abrió. */
  devolverFoco?: boolean
  children: ReactNode
}

const RESORTE = { type: 'spring' as const, stiffness: 420, damping: 40, mass: 0.9 }
const SALIDA = { duration: 0.2, ease: [0.32, 0, 0.67, 0] as [number, number, number, number] }

export function HojaInferior(props: PropsHoja) {
  // Cada hoja es un nodo del árbol de Floating UI: así una hoja abierta desde otra no le "roba" el foco a la de abajo.
  const padre = useFloatingParentNodeId()
  if (padre == null)
    return (
      <FloatingTree>
        <HojaConNodo {...props} />
      </FloatingTree>
    )
  return <HojaConNodo {...props} />
}

function HojaConNodo({ abierta, alCerrar, titulo, etiqueta, alto = 'contenido', cabecera, pie, className, enfocar, sinCerrar, inactiva, devolverFoco = true, children }: PropsHoja) {
  const nivel = useContext(NivelHoja)
  const apaisado = useEsApaisado()
  const reducido = useReducedMotion()
  const controles = useDragControls()
  const nodeId = useFloatingNodeId()
  const refHoja = useRef<HTMLDivElement | null>(null)
  const { refs, context } = useFloating({ nodeId, open: abierta, onOpenChange: (v) => !v && alCerrar() })
  const cerrarYLuego = useCierraConAtras(abierta, alCerrar)
  // El desplazamiento de la hoja: lo mueven el arrastre del agarre (motion) y el deslizar desde el contenido.
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  useDeslizarParaCerrar({ hoja: refHoja, eje: apaisado ? 'x' : 'y', valor: apaisado ? x : y, activo: abierta && !reducido, alCerrar, resorte: RESORTE })

  const fuera = apaisado ? { x: '100%' } : { y: '100%' }
  const inicial = reducido ? { opacity: 0 } : fuera
  const final = reducido ? { opacity: 1 } : { x: 0, y: 0 }
  const salida = reducido ? { opacity: 0, transition: { duration: 0.12 } } : { ...fuera, transition: SALIDA }

  const alSoltar = (_e: unknown, info: PanInfo) => {
    const d = apaisado ? info.offset.x : info.offset.y
    const v = apaisado ? info.velocity.x : info.velocity.y
    if (d > 96 || v > 500) alCerrar()
  }
  const agarrar = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    controles.start(e)
  }

  const z = 70 + nivel * 10
  const nombre = etiqueta ?? (typeof titulo === 'string' ? titulo : undefined)

  return createPortal(
    <FloatingNode id={nodeId}>
      <AnimatePresence>
        {abierta && (
          <NivelHoja.Provider value={nivel + 1}>
            <Contexto.Provider value={{ cerrarYLuego, cerrar: alCerrar }}>
              <motion.div className="hoja-inferior__capa" style={{ zIndex: z }} data-apaisado={apaisado || undefined} inert={inactiva || undefined}>
                <motion.div
                  className="hoja-inferior__velo"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: reducido ? 0.12 : 0.18 } }}
                  exit={{ opacity: 0, transition: { duration: reducido ? 0.12 : 0.16 } }}
                  onClick={alCerrar}
                  aria-hidden
                />
                <FloatingFocusManager context={context} modal initialFocus={enfocar ?? refHoja} returnFocus={devolverFoco} disabled={inactiva}>
                  <motion.div
                    ref={(el) => {
                      refHoja.current = el
                      refs.setFloating(el)
                    }}
                    className={`hoja-inferior hoja-inferior--${alto}${className ? ` ${className}` : ''}`}
                    style={{ x, y }}
                    role="dialog"
                    aria-modal="true"
                    aria-label={nombre}
                    tabIndex={-1}
                    initial={inicial}
                    animate={final}
                    exit={salida}
                    transition={RESORTE}
                    drag={reducido ? false : apaisado ? 'x' : 'y'}
                    dragControls={controles}
                    dragListener={false}
                    dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
                    dragElastic={apaisado ? { left: 0.04, right: 0.9 } : { top: 0.04, bottom: 0.9 }}
                    dragMomentum={false}
                    onDragEnd={alSoltar}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && !e.defaultPrevented) {
                        e.stopPropagation()
                        alCerrar()
                      }
                    }}
                  >
                    <div className="hoja-inferior__agarre" onPointerDown={agarrar}>
                      <span className="hoja-inferior__barrita" aria-hidden />
                      {titulo !== undefined && (
                        <div className="hoja-inferior__titulo">
                          <h2>{titulo}</h2>
                          {!sinCerrar && (
                            <button type="button" className="boton-icono hoja-inferior__cerrar" onClick={alCerrar} aria-label="Cerrar">
                              <X size={20} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {cabecera && <div className="hoja-inferior__cabecera">{cabecera}</div>}
                    <div className="hoja-inferior__contenido">{children}</div>
                    {pie && <div className="hoja-inferior__pie">{pie}</div>}
                  </motion.div>
                </FloatingFocusManager>
              </motion.div>
            </Contexto.Provider>
          </NivelHoja.Provider>
        )}
      </AnimatePresence>
    </FloatingNode>,
    document.body,
  )
}
