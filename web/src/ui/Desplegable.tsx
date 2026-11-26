import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react'
import { Command } from 'cmdk'
import { Check } from 'lucide-react'
import { motion } from 'motion/react'
import { createContext, useContext, useState, type ComponentType, type ReactNode } from 'react'
import { esTactil } from '../movil/detectar'
import { Kbd } from './comunes'
import { MENU, origenDe } from '../util/movimiento'

export interface PropsPresentacion {
  abierta: boolean
  alCerrar: () => void
  clase?: string
  children: ReactNode
}

/** Si tiene valor (en el celular, la hoja inferior), los desplegables se muestran ahí en vez de flotar junto al disparador. */
export const PresentacionFlotante = createContext<ComponentType<PropsPresentacion> | null>(null)

interface PropsDesplegable {
  disparador: (props: Record<string, unknown> & { ref: (el: HTMLElement | null) => void; 'data-abierto'?: boolean }) => ReactNode
  children: (cerrar: () => void) => ReactNode
  lado?: Placement
  abierto?: boolean
  alCambiar?: (v: boolean) => void
  ancho?: number | 'disparador'
  className?: string
  enfocarInicial?: number
  /** Separación con el disparador (px). */
  separacion?: number
  /** El papel de la ventanita para el lector de pantalla (de fábrica, un diálogo; los menús, "menu"). */
  rol?: 'dialog' | 'menu' | 'listbox'
}

/** Popover flotante: se abre desde un disparador, se cierra con Esc o tocando afuera. Sin modales. */
export function Desplegable({ disparador, children, lado = 'bottom-start', abierto, alCambiar, ancho, className, enfocarInicial = 0, separacion = 6, rol = 'dialog' }: PropsDesplegable) {
  const [interno, setInterno] = useState(false)
  const esta = abierto ?? interno
  const cambiar = alCambiar ?? setInterno
  const { refs, floatingStyles, context, placement } = useFloating({
    open: esta,
    onOpenChange: cambiar,
    placement: lado,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(separacion),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements, rects }) {
          elements.floating.style.maxHeight = `${Math.max(180, availableHeight)}px`
          if (ancho === 'disparador') elements.floating.style.width = `${rects.reference.width}px`
        },
      }),
    ],
  })
  const Presentacion = useContext(PresentacionFlotante)
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context, { enabled: !Presentacion }),
    useRole(context, { role: rol }),
  ])
  return (
    <>
      {disparador({ ref: refs.setReference, ...getReferenceProps(), 'data-abierto': esta })}
      {Presentacion && (
        <Presentacion abierta={esta} alCerrar={() => cambiar(false)} clase={className}>
          {esta ? children(() => cambiar(false)) : null}
        </Presentacion>
      )}
      {!Presentacion && esta && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={enfocarInicial}>
            <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 80 }} {...getFloatingProps()}>
              <motion.div
                className={`flotante ${className ?? ''}`}
                style={{ ...(typeof ancho === 'number' ? { width: ancho } : {}), transformOrigin: origenDe(placement) }}
                {...MENU}
              >
                {children(() => cambiar(false))}
              </motion.div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}

export interface ItemMenu {
  id: string
  etiqueta: string
  icono?: ReactNode
  atajo?: string
  peligro?: boolean
  separador?: boolean
  alElegir: () => void
}

export function Menu({ disparador, items, lado = 'bottom-end' }: { disparador: PropsDesplegable['disparador']; items: ItemMenu[]; lado?: Placement }) {
  return (
    <Desplegable disparador={disparador} lado={lado} className="menu" rol="menu">
      {(cerrar) => (
        <div className="menu__lista">
          {items.map((it) => (
            <div key={it.id}>
              {it.separador && <div className="menu__separador" />}
              <button
                type="button"
                role="menuitem"
                className={`menu__item${it.peligro ? ' menu__item--peligro' : ''}`}
                onClick={() => {
                  cerrar()
                  it.alElegir()
                }}
              >
                <span className="menu__icono">{it.icono}</span>
                <span className="menu__texto">{it.etiqueta}</span>
                {it.atajo && <Kbd atajo={it.atajo} suave />}
              </button>
            </div>
          ))}
        </div>
      )}
    </Desplegable>
  )
}

export interface OpcionSelector {
  id: string
  etiqueta: string
  buscar?: string
  icono?: ReactNode
  detalle?: ReactNode
  grupo?: string
}

/** Lista con búsqueda (cmdk) para elegir una o varias cosas: etiquetas, personas, listas… */
export function Selector({
  opciones,
  elegidas,
  alElegir,
  multiple,
  placeholder = 'Buscar…',
  crear,
  vacio = 'No hay coincidencias',
}: {
  opciones: OpcionSelector[]
  elegidas: string[]
  alElegir: (id: string) => void
  multiple?: boolean
  placeholder?: string
  crear?: { etiqueta: (q: string) => string; alCrear: (q: string) => void }
  vacio?: string
}) {
  const [q, setQ] = useState('')
  const grupos = [...new Set(opciones.map((o) => o.grupo ?? ''))]
  const existeExacta = opciones.some((o) => o.etiqueta.toLowerCase() === q.trim().toLowerCase())
  return (
    <Command className="selector" loop>
      <Command.Input className="selector__buscar" placeholder={placeholder} value={q} onValueChange={setQ} autoFocus={!esTactil()} />
      <Command.List className="selector__lista">
        <Command.Empty className="selector__vacio">{vacio}</Command.Empty>
        {grupos.map((g) => (
          <Command.Group key={g || 'todo'} heading={g || undefined} className="selector__grupo">
            {opciones
              .filter((o) => (o.grupo ?? '') === g)
              .map((o) => {
                const sel = elegidas.includes(o.id)
                return (
                  <Command.Item
                    key={o.id}
                    value={`${o.etiqueta} ${o.buscar ?? ''} ${o.id}`}
                    onSelect={() => alElegir(o.id)}
                    className={`selector__item${sel ? ' selector__item--elegida' : ''}`}
                  >
                    {o.icono && <span className="selector__icono">{o.icono}</span>}
                    <span className="selector__texto">{o.etiqueta}</span>
                    {o.detalle && <span className="selector__detalle">{o.detalle}</span>}
                    {(multiple || sel) && (
                      <span className={`selector__marca${sel ? ' selector__marca--si' : ''}`}>{sel && <Check size={13} strokeWidth={3} />}</span>
                    )}
                  </Command.Item>
                )
              })}
          </Command.Group>
        ))}
        {crear && q.trim() && !existeExacta && (
          <Command.Item value={`__crear ${q}`} onSelect={() => crear.alCrear(q.trim())} className="selector__item selector__item--crear">
            <span className="selector__texto">{crear.etiqueta(q.trim())}</span>
          </Command.Item>
        )}
      </Command.List>
    </Command>
  )
}
