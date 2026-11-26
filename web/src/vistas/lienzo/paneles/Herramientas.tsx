// Barra de herramientas del lienzo (5.1): fija abajo al centro, nada la mueve. Las opciones de Nota y Forma salen en
// una píldora encima, en posición absoluta (no ocupa lugar en el flujo). Doble clic en una herramienta de creación
// (o su tecla dos veces) la deja fija.
// Si no entran todas (un teléfono, una ventana angosta), se ven las más usadas y el resto va a un botón ⋯ al final
// (PRIORIDAD): la barra entra siempre entera. Si la herramienta activa quedó en el ⋯, el botón muestra su ícono.
import { ChartColumn, Ellipsis, Frame, Hand, ImagePlus, MousePointer2, Redo2, Spline, Square, SquareKanban, StickyNote, Table2, Type, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as EventoTecla } from 'react'
import { tieneVista } from '../../../../../compartido/vistas'
import { COLORES_LIENZO, FORMAS, NOMBRES_COLOR, type TipoForma } from '../../../../../compartido/lienzo'
import { deshacer, rehacer, useHistorial } from '../../../estado/deshacer'
import { usePreferencias } from '../../../estado/preferencias'
import { useTienda, type Herramienta } from '../../../estado/tienda'
import { esTactil } from '../../../movil/detectar'
import { Kbd } from '../../../ui/comunes'
import { Desplegable } from '../../../ui/Desplegable'
import { esCreacion } from '../crear'
import { trazoForma } from '../nodos/formas'
import { RESORTE_HERRAMIENTA } from '../../../util/movimiento'

interface Boton {
  id: Herramienta | 'imagen' | 'tabla' | 'grafico' | 'deshacer' | 'rehacer'
  nombre: string
  tecla: string
  atajo: string
  icono: typeof Hand
}

export const GRUPOS_HERRAMIENTAS: Boton[][] = [
  [
    { id: 'seleccionar', nombre: 'Seleccionar', tecla: 'V', atajo: 'V', icono: MousePointer2 },
    { id: 'mano', nombre: 'Mano', tecla: 'H', atajo: 'H', icono: Hand },
  ],
  [
    { id: 'nota', nombre: 'Nota', tecla: 'N', atajo: 'N', icono: StickyNote },
    { id: 'texto', nombre: 'Texto', tecla: 'T', atajo: 'T', icono: Type },
    { id: 'forma', nombre: 'Forma', tecla: 'S', atajo: 'S', icono: Square },
    { id: 'marco', nombre: 'Marco', tecla: 'F', atajo: 'F', icono: Frame },
    { id: 'conector', nombre: 'Conector', tecla: 'L', atajo: 'L', icono: Spline },
  ],
  [
    { id: 'tarjeta', nombre: 'Tarjeta nueva del Kanban', tecla: 'D', atajo: 'D', icono: SquareKanban },
    { id: 'imagen', nombre: 'Imagen', tecla: 'I', atajo: 'I', icono: ImagePlus },
    // Tabla y gráfico se crean de una (en el centro de lo que se ve): sin tecla, no son herramientas de dibujo.
    { id: 'tabla', nombre: 'Tabla', tecla: '', atajo: '', icono: Table2 },
    { id: 'grafico', nombre: 'Gráfico (de una tabla o con datos)', tecla: '', atajo: '', icono: ChartColumn },
  ],
  [
    { id: 'deshacer', nombre: 'Deshacer', tecla: '$mod+Z', atajo: 'Control+Z Meta+Z', icono: Undo2 },
    { id: 'rehacer', nombre: 'Rehacer', tecla: '$mod+Shift+Z', atajo: 'Control+Shift+Z Meta+Shift+Z', icono: Redo2 },
  ],
]

/** Los grupos de botones de un tablero: sin Kanban no hay «Tarjeta nueva del Kanban» (compartido/vistas.ts: solo se ve lo que el tablero tiene). */
function gruposDe(conKanban: boolean): Boton[][] {
  return conKanban ? GRUPOS_HERRAMIENTAS : GRUPOS_HERRAMIENTAS.map((g) => g.filter((b) => b.id !== 'tarjeta'))
}

/** Si no entran todas, cuáles se ven primero: lo de todos los días y deshacer (con el dedo no hay Ctrl+Z). */
const PRIORIDAD: Boton['id'][] = ['seleccionar', 'nota', 'texto', 'forma', 'deshacer', 'mano', 'rehacer', 'conector', 'marco', 'tarjeta', 'imagen', 'tabla', 'grafico']

interface Medidas {
  boton: number
  hueco: number
  sep: number
  relleno: number
}

/** Ancho de la barra con esos botones (por grupo, con separadores entre grupos) y, si hace falta, el ⋯ al final. */
function anchoBarra(ids: ReadonlySet<string>, conMas: boolean, m: Medidas, todosLosGrupos: Boton[][]) {
  let total = m.relleno
  let grupos = 0
  for (const g of todosLosGrupos) {
    const n = g.filter((b) => ids.has(b.id)).length
    if (!n) continue
    grupos++
    total += n * m.boton + (n - 1) * m.hueco
  }
  if (conMas) {
    grupos++
    total += m.boton
  }
  return total + Math.max(0, grupos - 1) * m.sep
}

/** Qué botones se ven en ese ancho (null: todos). */
function calcularVisibles(disponible: number, m: Medidas, grupos: Boton[][]): Set<string> | null {
  const hay = new Set(grupos.flat().map((b) => b.id))
  if (anchoBarra(hay, false, m, grupos) <= disponible) return null
  const visibles = new Set<string>()
  for (const id of PRIORIDAD.filter((x) => hay.has(x))) {
    const prueba = new Set(visibles).add(id)
    if (anchoBarra(prueba, true, m, grupos) > disponible) break
    visibles.add(id)
  }
  return visibles
}

const mismos = (a: Set<string> | null, b: Set<string> | null) => a === b || (!!a && !!b && a.size === b.size && [...a].every((x) => b.has(x)))

let ultimaEleccion: { h: Herramienta | null; t: number } = { h: null, t: 0 }

/** Elige una herramienta. Elegir la misma herramienta de creación dos veces seguidas (o con doble clic) la deja fija. */
export function elegirHerramienta(h: Herramienta, forzarFija = false) {
  const s = useTienda.getState()
  const ahora = Date.now()
  const dosVeces = ultimaEleccion.h === h && ahora - ultimaEleccion.t < 500
  ultimaEleccion = { h, t: ahora }
  if (!esCreacion(h) && h !== 'conector') {
    s.setHerramienta(h)
    return
  }
  const fija = forzarFija || (dosVeces && s.herramienta === h) || (s.herramienta === h && s.herramientaFija)
  s.setHerramienta(h, fija)
}

/** Dibujo chico de una forma para los botones. */
export function MiniForma({ forma, tam = 20 }: { forma: TipoForma; tam?: number }) {
  const w = tam
  const h = Math.round(tam * 0.72)
  return (
    <svg width={w + 2} height={h + 2} viewBox={`-1 -1 ${w + 2} ${h + 2}`} aria-hidden className="mini-forma-svg">
      <path d={trazoForma(forma, w, h)} />
    </svg>
  )
}

/**
 * La barra de herramientas de abajo. Con memo: el lienzo se vuelve a dibujar cada vez que React Flow mide objetos nuevos
 * (al mover el lienzo entran objetos), y la pastilla de la herramienta activa (motion, layoutId) hacía que motion
 * midiera la página entera en cada uno de esos dibujos (un layout forzado por cuadro).
 */
export const BarraHerramientas = memo(function BarraHerramientas({ alSubirImagen, alCrear }: { alSubirImagen: () => void; alCrear: (que: 'tabla' | 'grafico') => void }) {
  const herramienta = useTienda((s) => s.herramienta)
  const fija = useTienda((s) => s.herramientaFija)
  const { puedeDeshacer, puedeRehacer } = useHistorial()
  const colorNota = usePreferencias((s) => s.estilos.nota.color)
  const formaActual = usePreferencias((s) => s.estilos.forma.forma)
  const botones = useRef(new Map<string, HTMLButtonElement>())
  const lugar = useRef<HTMLDivElement>(null)
  const [centroOpciones, setCentroOpciones] = useState(0)
  const [visibles, setVisibles] = useState<Set<string> | null>(null)
  const opciones = herramienta === 'nota' || herramienta === 'forma' ? herramienta : null

  const conKanban = useTienda((s) => tieneVista(s.tablero?.tablero, 'kanban'))
  const grupos = useMemo(() => gruposDe(conKanban), [conKanban])
  const todos = useMemo(() => grupos.flat(), [grupos])
  const ocultos = visibles ? todos.filter((b) => !visibles.has(b.id)) : []
  const activaOculta = ocultos.find((b) => b.id === herramienta) ?? null

  // Cuántas entran: con el ancho del lienzo (menos el margen del panel) y las medidas reales de los botones.
  useLayoutEffect(() => {
    const el = lugar.current
    const lienzo = el?.closest<HTMLElement>('.lienzo')
    if (!el || !lienzo) return
    const panel = el.closest<HTMLElement>('.react-flow__panel')
    const medir = () => {
      const barra = el.querySelector<HTMLElement>('.herramientas')
      const boton = barra?.querySelector<HTMLElement>('.herramienta')
      if (!barra || !boton) return
      const grupo = barra.querySelector<HTMLElement>('.herramientas__grupo')
      const sep = barra.querySelector<HTMLElement>('.herramientas__sep')
      const cb = getComputedStyle(barra)
      const cs = sep ? getComputedStyle(sep) : null
      const cp = panel ? getComputedStyle(panel) : null
      const m: Medidas = {
        boton: boton.offsetWidth,
        hueco: grupo ? parseFloat(getComputedStyle(grupo).columnGap) || 0 : 0,
        sep: sep && cs ? sep.offsetWidth + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight) : 13,
        relleno: parseFloat(cb.paddingLeft) + parseFloat(cb.paddingRight) + parseFloat(cb.borderLeftWidth) + parseFloat(cb.borderRightWidth),
      }
      const margen = cp ? parseFloat(cp.marginLeft) + parseFloat(cp.marginRight) : 32
      const nuevo = calcularVisibles(lienzo.clientWidth - margen, m, grupos)
      setVisibles((v) => (mismos(v, nuevo) ? v : nuevo))
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(lienzo)
    return () => ro.disconnect()
  }, [grupos])

  // La píldora de opciones se centra sobre el botón de su herramienta (o sobre el ⋯, si quedó adentro).
  useLayoutEffect(() => {
    if (!opciones) return
    const b = botones.current.get(opciones) ?? botones.current.get('mas')
    if (b) setCentroOpciones(b.offsetLeft + b.offsetWidth / 2)
  }, [opciones, visibles])

  const indiceActivo = Math.max(
    0,
    todos.findIndex((b) => b.id === herramienta),
  )

  // Foco itinerante: flechas izquierda y derecha, Inicio y Fin.
  const alTecla = (e: EventoTecla<HTMLDivElement>) => {
    const lista = [...todos.map((b) => botones.current.get(b.id)), botones.current.get('mas')].filter(Boolean) as HTMLButtonElement[]
    const i = lista.indexOf(document.activeElement as HTMLButtonElement)
    if (i === -1) return
    let j = i
    if (e.key === 'ArrowRight') j = (i + 1) % lista.length
    else if (e.key === 'ArrowLeft') j = (i - 1 + lista.length) % lista.length
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = lista.length - 1
    else return
    e.preventDefault()
    e.stopPropagation()
    lista[j]!.focus()
  }

  const accion = (b: Boton) => {
    if (b.id === 'imagen') return alSubirImagen()
    if (b.id === 'tabla' || b.id === 'grafico') return alCrear(b.id)
    if (b.id === 'deshacer') return void deshacer()
    if (b.id === 'rehacer') return void rehacer()
    elegirHerramienta(b.id)
  }

  return (
    <div ref={lugar} className="herramientas-lugar">
      <AnimatePresence>
        {opciones && (
          <motion.div
            key={opciones}
            className="herramientas__opciones"
            style={{ left: centroOpciones }}
            initial={{ opacity: 0, y: 6, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%', transition: { duration: 0.14, ease: [0.15, 1, 0.3, 1] } }}
            exit={{ opacity: 0, y: 4, x: '-50%', transition: { duration: 0.09 } }}
            role="group"
            aria-label={opciones === 'nota' ? 'Color de la nota' : 'Forma'}
          >
            {opciones === 'nota'
              ? COLORES_LIENZO.map((c) => (
                  <button
                    key={c}
                    className={`herramientas__color${colorNota === c ? ' herramientas__color--activo' : ''}`}
                    style={{ background: `var(--n-${c})` }}
                    onClick={() => usePreferencias.getState().cambiarEstilo('nota', { color: c })}
                    aria-label={NOMBRES_COLOR[c]}
                    aria-pressed={colorNota === c}
                    data-tip={NOMBRES_COLOR[c]}
                    data-tip-lado="arriba"
                  />
                ))
              : FORMAS.map((f) => (
                  <button
                    key={f.id}
                    className={`herramientas__forma${formaActual === f.id ? ' herramientas__forma--activa' : ''}`}
                    onClick={() => usePreferencias.getState().cambiarEstilo('forma', { forma: f.id })}
                    aria-label={`${f.nombre} (${f.uso})`}
                    aria-pressed={formaActual === f.id}
                    data-tip={`${f.nombre} · ${f.uso}`}
                    data-tip-lado="arriba"
                  >
                    <MiniForma forma={f.id} />
                  </button>
                ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="herramientas" role="toolbar" aria-label="Herramientas del lienzo" aria-orientation="horizontal" onKeyDown={alTecla}>
        {grupos.filter((grupo) => grupo.some((b) => !visibles || visibles.has(b.id))).map((grupo, g) => (
          <span key={grupo[0]!.id} className="herramientas__grupo">
            {g > 0 && <span className="herramientas__sep" aria-hidden />}
            {grupo.filter((b) => !visibles || visibles.has(b.id)).map((b) => {
              const activa = b.id === herramienta
              const apagado = (b.id === 'deshacer' && !puedeDeshacer) || (b.id === 'rehacer' && !puedeRehacer)
              const i = todos.indexOf(b)
              return (
                <button
                  key={b.id}
                  ref={(el) => {
                    if (el) botones.current.set(b.id, el)
                    else botones.current.delete(b.id)
                  }}
                  className={`herramienta${activa ? ' herramienta--activa' : ''}`}
                  onClick={() => !apagado && accion(b)}
                  onDoubleClick={() => esCreacion(b.id as Herramienta) && elegirHerramienta(b.id as Herramienta, true)}
                  data-tip={b.nombre}
                  data-tecla={b.tecla || undefined}
                  data-tip-lado="arriba"
                  aria-label={b.nombre}
                  aria-keyshortcuts={b.atajo || undefined}
                  aria-pressed={b.id === 'imagen' || b.id === 'tabla' || b.id === 'grafico' || b.id === 'deshacer' || b.id === 'rehacer' ? undefined : activa}
                  aria-disabled={apagado || undefined}
                  tabIndex={i === indiceActivo ? 0 : -1}
                >
                  {activa && <motion.span layoutId="herramienta-activa" className="herramienta__fondo" transition={RESORTE_HERRAMIENTA} />}
                  <b.icono size={19} strokeWidth={2} />
                  {activa && fija && <span className="herramienta__fija" aria-label="Fija" />}
                </button>
              )
            })}
          </span>
        ))}
        {ocultos.length > 0 && (
          <span className="herramientas__grupo">
            <span className="herramientas__sep" aria-hidden />
            <Desplegable
              lado="top-end"
              separacion={10}
              className="menu"
              rol="menu"
              disparador={(p) => (
                <button
                  {...p}
                  ref={(el) => {
                    p.ref(el)
                    if (el) botones.current.set('mas', el)
                    else botones.current.delete('mas')
                  }}
                  type="button"
                  className={`herramienta${activaOculta ? ' herramienta--activa' : ''}`}
                  aria-label={activaOculta ? `Más herramientas (elegida: ${activaOculta.nombre})` : 'Más herramientas'}
                  data-tip="Más herramientas"
                  data-tip-lado="arriba"
                  tabIndex={activaOculta ? 0 : -1}
                >
                  {activaOculta && <motion.span layoutId="herramienta-activa" className="herramienta__fondo" transition={RESORTE_HERRAMIENTA} />}
                  {activaOculta ? <activaOculta.icono size={19} strokeWidth={2} /> : <Ellipsis size={19} strokeWidth={2} />}
                  {activaOculta && fija && <span className="herramienta__fija" aria-label="Fija" />}
                </button>
              )}
            >
              {(cerrar) => (
                <div className="menu__lista" role="menu" aria-label="Más herramientas">
                  {ocultos.map((b) => {
                    const activa = b.id === herramienta
                    const apagado = (b.id === 'deshacer' && !puedeDeshacer) || (b.id === 'rehacer' && !puedeRehacer)
                    return (
                      <button
                        key={b.id}
                        type="button"
                        role="menuitem"
                        className={`menu__item${activa ? ' menu__item--activo' : ''}`}
                        aria-disabled={apagado || undefined}
                        aria-current={activa || undefined}
                        onClick={() => {
                          if (apagado) return
                          cerrar()
                          accion(b)
                        }}
                      >
                        <span className="menu__icono">
                          <b.icono size={16} />
                        </span>
                        <span className="menu__texto">{b.nombre}</span>
                        {!esTactil() && b.tecla && <Kbd atajo={b.tecla} suave />}
                      </button>
                    )
                  })}
                </div>
              )}
            </Desplegable>
          </span>
        )}
      </div>
    </div>
  )
})
