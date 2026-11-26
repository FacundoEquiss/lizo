// El campo de texto donde se puede mencionar con `@` (plan de la IA integrada, 14.3 y 14.9). Es un TextoAuto (mismo `value`,
// `onChange` y `onKeyDown` que el de siempre) que, al tipear `@` al principio o después de un espacio, abre una lista con
// las personas y las IA que se pueden mencionar y lo que va a pasar con cada una («responde sola», «le llega cuando se
// conecta», «le avisa», «sin clave»). Se filtra por alias y por nombre mientras se escribe.
//   · Teclado: flechas para moverse, Enter o Tab para elegir (inserta `@alias `), Esc cierra la lista (y no hace nada más:
//     no cierra la tarjeta ni cancela la edición). Con la lista abierta, Ctrl/⌘ + Enter sigue mandando.
//   · Lector de pantalla: patrón de caja combinada de ARIA. El foco nunca sale del campo: la opción activa se anuncia por
//     `aria-activedescendant`, y lo que va a pasar forma parte del nombre de cada opción.
//   · En la computadora, la lista flota pegada al `@`. En el celular la pieza que la dibuja es otra (una fila de chips sobre
//     el teclado: movil/ia/BarraMenciones), que AppMovil ofrece por `PresentacionMenciones`: lo de escritorio no importa nada
//     de movil/, igual que PresentacionFlotante.
//   · El servidor no usa prefijos para disparar: elegir inserta el alias entero. Lo que se escribe a medias no dispara nada.
import { autoUpdate, flip, FloatingPortal, offset, shift, size, useFloating } from '@floating-ui/react'
import { motion } from 'motion/react'
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type TextareaHTMLAttributes,
} from 'react'
import { sugerir } from '../../../compartido/menciones'
import type { Miembro } from '../../../compartido/tipos'
import { useTienda } from '../estado/tienda'
import { disparoDeMencion, efectoDeMencionar, rectDeCaracter, type Efecto } from '../util/menciones-ui'
import { MENU } from '../util/movimiento'
import { Avatar, TextoAuto } from './comunes'

/** Hasta cuántas opciones se ven a la vez (14.3). */
export const MAX_OPCIONES = 8

/** Una opción de la lista: el miembro, su alias (siempre hay) y lo que va a pasar. */
export interface OpcionMencion {
  miembro: Miembro
  alias: string
  efecto: Efecto
}

/** Lo que recibe quien dibuja las sugerencias (la lista de escritorio o la barra del celular). */
export interface PropsSugerencias {
  /** El campo, o el contenedor del campo que lo anclaje (data-ancla-menciones). */
  ancla: HTMLElement
  opciones: OpcionMencion[]
  activa: number
  idLista: string
  idOpcion: (i: number) => string
  alElegir: (i: number) => void
  alPasarPor: (i: number) => void
}

/** Si tiene valor (en el celular), las sugerencias se dibujan con esta pieza en vez de la lista flotante. */
export const PresentacionMenciones = createContext<ComponentType<PropsSugerencias> | null>(null)

/** El nombre de una opción para el lector de pantalla y para los títulos: «Claude, @claude, responde sola». */
export const nombreDeOpcion = (o: OpcionMencion) => `${o.miembro.nombre}, @${o.alias}, ${o.efecto.texto}`

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { minFilas?: number }

/** Textarea que crece y deja mencionar con `@` (ver la cabecera del archivo). */
export const CampoConMenciones = forwardRef<HTMLTextAreaElement, Props>(function CampoConMenciones(
  { onKeyDown, onChange, onFocus, onBlur, onSelect, onKeyUp, onClick, ...props },
  refExterna,
) {
  const miembros = useTienda((s) => s.miembros)
  const Presentacion = useContext(PresentacionMenciones)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const id = useId()
  const [cursor, setCursor] = useState(0)
  const [activa, setActiva] = useState(0)
  const [enfocado, setEnfocado] = useState(false)
  /** El `@` cuya lista se cerró con Esc: no se vuelve a abrir hasta que el cursor salga de esa mención. */
  const [cerrada, setCerrada] = useState<number | null>(null)
  const cursorPendiente = useRef<number | null>(null)
  const valor = String(props.value ?? '')

  const mencionables = useMemo(() => miembros.filter((m) => m.alias && !m.archivado), [miembros])
  const disparo = enfocado ? disparoDeMencion(valor, cursor) : null
  const abierta = !!disparo && mencionables.length > 0 && cerrada !== disparo.desde
  const opciones = useMemo<OpcionMencion[]>(() => {
    if (!abierta || !disparo) return []
    const candidatos = mencionables.map((m) => ({ id: m.id, alias: m.alias!, nombre: m.nombre }))
    return sugerir(disparo.parcial, candidatos, MAX_OPCIONES).map((c) => {
      const miembro = mencionables.find((m) => m.id === c.id)!
      return { miembro, alias: c.alias, efecto: efectoDeMencionar(miembro) }
    })
  }, [abierta, disparo?.parcial, mencionables])

  // Al cambiar lo que se filtra, se vuelve a la primera; al salir de la mención, se olvida que se había cerrado.
  useEffect(() => setActiva(0), [disparo?.desde, disparo?.parcial])
  useEffect(() => {
    if (!disparo || cerrada !== disparo.desde) setCerrada(null)
  }, [disparo?.desde])

  // Después de elegir, el cursor queda justo después del alias (React vuelve a escribir el valor y lo manda al final).
  useLayoutEffect(() => {
    const c = cursorPendiente.current
    const el = ref.current
    if (c === null || !el) return
    cursorPendiente.current = null
    el.setSelectionRange(c, c)
    setCursor(c)
  }, [valor])

  const idOpcion = (i: number) => `${id}-o${i}`
  const idLista = `${id}-lista`

  function elegir(i: number) {
    const o = opciones[i]
    const el = ref.current
    if (!o || !disparo || !el) return
    const antes = valor.slice(0, disparo.desde)
    const despues = valor.slice(disparo.hasta)
    const insertado = `@${o.alias} `
    cursorPendiente.current = antes.length + insertado.length
    // Con el setter nativo y un evento `input`, el campo controlado se entera como si se hubiera tipeado (onChange de siempre).
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, antes + insertado + despues.replace(/^ /, ''))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
  }

  const actualizarCursor = (el: HTMLTextAreaElement) => setCursor(el.selectionStart ?? 0)

  return (
    <>
      <TextoAuto
        {...props}
        ref={(el) => {
          ref.current = el
          if (typeof refExterna === 'function') refExterna(el)
          else if (refExterna) refExterna.current = el
        }}
        {...(mencionables.length
          ? {
              role: 'combobox',
              'aria-multiline': true,
              'aria-autocomplete': 'list' as const,
              'aria-haspopup': 'listbox' as const,
              'aria-expanded': abierta && opciones.length > 0,
              'aria-controls': abierta && opciones.length > 0 ? idLista : undefined,
              'aria-activedescendant': abierta && opciones.length > 0 ? idOpcion(activa) : undefined,
            }
          : {})}
        onChange={(e) => {
          actualizarCursor(e.currentTarget)
          onChange?.(e)
        }}
        onFocus={(e) => {
          setEnfocado(true)
          actualizarCursor(e.currentTarget)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setEnfocado(false)
          onBlur?.(e)
        }}
        onSelect={(e) => {
          actualizarCursor(e.currentTarget)
          onSelect?.(e)
        }}
        onKeyUp={(e) => {
          actualizarCursor(e.currentTarget)
          onKeyUp?.(e)
        }}
        onClick={(e) => {
          actualizarCursor(e.currentTarget)
          onClick?.(e)
        }}
        onKeyDown={(e) => {
          if (abierta && !e.nativeEvent.isComposing) {
            const n = opciones.length
            if (e.key === 'Escape') {
              // Cierra la lista y nada más: ni la tarjeta, ni la edición del campo.
              e.preventDefault()
              e.stopPropagation()
              setCerrada(disparo!.desde)
              return
            }
            if (n > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setActiva((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
                return
              }
              const sinModificador = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
              if ((e.key === 'Enter' || e.key === 'Tab') && sinModificador) {
                e.preventDefault()
                elegir(Math.min(activa, n - 1))
                return
              }
            }
          }
          onKeyDown?.(e)
        }}
      />
      {abierta && ref.current && (
        <>
          <span className="solo-lectores" role="status">
            {opciones.length ? `${opciones.length === 1 ? '1 opción' : `${opciones.length} opciones`} para mencionar. Usá las flechas y Enter.` : 'No hay nadie con ese nombre.'}
          </span>
          {Presentacion ? (
            <Presentacion
              ancla={ref.current.closest<HTMLElement>('[data-ancla-menciones]') ?? ref.current}
              opciones={opciones}
              activa={activa}
              idLista={idLista}
              idOpcion={idOpcion}
              alElegir={elegir}
              alPasarPor={setActiva}
            />
          ) : (
            <ListaMenciones campo={ref.current} desde={disparo!.desde} opciones={opciones} activa={activa} idLista={idLista} idOpcion={idOpcion} alElegir={elegir} alPasarPor={setActiva} />
          )}
        </>
      )}
    </>
  )
})

/** La lista flotante de escritorio, pegada al `@` que se está escribiendo. */
function ListaMenciones({
  campo,
  desde,
  opciones,
  activa,
  idLista,
  idOpcion,
  alElegir,
  alPasarPor,
}: {
  campo: HTMLTextAreaElement
  desde: number
  opciones: OpcionMencion[]
  activa: number
  idLista: string
  idOpcion: (i: number) => string
  alElegir: (i: number) => void
  alPasarPor: (i: number) => void
}) {
  const { refs, floatingStyles, placement, update } = useFloating({
    open: true,
    strategy: 'fixed',
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(120, Math.min(availableHeight, 340))}px`
        },
      }),
    ],
  })
  // La referencia es el carácter «@» dentro del campo (no la caja entera); se mide de nuevo al cambiar el texto.
  useLayoutEffect(() => {
    refs.setPositionReference({ getBoundingClientRect: () => rectDeCaracter(campo, desde) })
    update()
  }, [campo, desde, campo.value])
  const subida = placement.startsWith('top')
  return (
    <FloatingPortal>
      <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 90 }} onMouseDown={(e) => e.preventDefault()}>
        <motion.div className="flotante menciones" style={{ transformOrigin: subida ? 'left bottom' : 'left top' }} {...MENU}>
          {opciones.length === 0 ? (
            <p className="menciones__vacio">No hay nadie con ese nombre</p>
          ) : (
            <ul className="menciones__lista" role="listbox" id={idLista} aria-label="Mencionar a">
              {opciones.map((o, i) => (
                <li
                  key={o.miembro.id}
                  id={idOpcion(i)}
                  role="option"
                  aria-selected={i === activa}
                  className={`menciones__opcion${i === activa ? ' menciones__opcion--activa' : ''}`}
                  onClick={() => alElegir(i)}
                  onMouseMove={() => i !== activa && alPasarPor(i)}
                >
                  <Avatar miembro={o.miembro} tam={24} />
                  <span className="menciones__nombre">{o.miembro.nombre}</span>
                  <span className="menciones__alias">@{o.alias}</span>
                  <span className={`menciones__efecto${o.efecto.problema ? ' menciones__efecto--problema' : ''}`}>{o.efecto.texto}</span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      </div>
    </FloatingPortal>
  )
}
