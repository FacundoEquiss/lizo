// El panel de marcos (5.5), en el botón "Marcos" (reemplaza al menú de la 0.1): una lista flotante de 280 px que queda
// abierta mientras se recorre. Cada fila: agarre, punto de color, título y cantidad. Clic: ir; doble clic o F2:
// renombrar; arrastrar por el agarre: reordenar (guarda el orden en cada marco, el que usan "." y ","). El marco que
// está en pantalla se marca. Flechas arriba y abajo para recorrer con el teclado.
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useViewport } from '@xyflow/react'
import { Frame, GripVertical, Plus } from 'lucide-react'
import { useState, type KeyboardEvent as EventoTecla } from 'react'
import { leerMarco } from '../../../../../compartido/lienzo'
import type { ElementoLienzo } from '../../../../../compartido/tipos'
import { useTienda } from '../../../estado/tienda'
import { Desplegable } from '../../../ui/Desplegable'
import { useAccionesLienzo } from '../acciones'
import { datosNuevos } from '../crear'
import { useLienzo } from '../estado'
import { conteoPorMarco, ordenDeMarcos } from '../indices'
import { guardarDatos } from '../nodos/comunes'
import { EstadoVacio } from '../../../ui/EstadoVacio'

const VACIO: ElementoLienzo[] = []

function FilaMarco({ marco, cantidad, actual }: { marco: ElementoLienzo; cantidad: number; actual: boolean }) {
  const acciones = useAccionesLienzo()
  const d = leerMarco(marco.datos)
  const [renombrando, setRenombrando] = useState(false)
  const [nombre, setNombre] = useState(d.titulo)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: marco.id })
  const guardar = () => {
    setRenombrando(false)
    const n = nombre.trim()
    if (n !== d.titulo) guardarDatos(marco.id, { titulo: n }, 'renombrar el marco')
  }
  return (
    <div
      ref={setNodeRef}
      className={`fila-marco${actual ? ' fila-marco--actual' : ''}${isDragging ? ' fila-marco--arrastrando' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button ref={setActivatorNodeRef} type="button" className="fila-marco__agarre" aria-label={`Mover «${d.titulo || 'Marco sin nombre'}» en la lista`} {...attributes} {...listeners}>
        <GripVertical size={14} />
      </button>
      {renombrando ? (
        <input
          className="fila-marco__campo"
          autoFocus
          value={nombre}
          placeholder="Marco sin nombre"
          aria-label="Nombre del marco"
          onFocus={(e) => e.target.select()}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={guardar}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setNombre(d.titulo)
              setRenombrando(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="fila-marco__ir"
          title={d.titulo ? `Ir a «${d.titulo}» · doble clic para renombrar` : 'Ir al marco'}
          onClick={() => acciones.irAMarco(marco.id)}
          onDoubleClick={() => {
            setNombre(d.titulo)
            setRenombrando(true)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'F2') return
            e.preventDefault()
            setNombre(d.titulo)
            setRenombrando(true)
          }}
        >
          <span className="fila-marco__punto" style={{ background: `var(--e-${d.color}-s)` }} />
          <span className={`fila-marco__titulo${d.titulo ? '' : ' fila-marco__titulo--vacio'}`}>{d.titulo || 'Marco sin nombre'}</span>
          <span className="fila-marco__cuenta">{cantidad || ''}</span>
        </button>
      )}
    </div>
  )
}

function ListaMarcos({ marcos, conteo }: { marcos: ElementoLienzo[]; conteo: Map<string, number> }) {
  const acciones = useAccionesLienzo()
  // Se vuelve a calcular cuál está en pantalla cuando se mueve el lienzo.
  useViewport()
  const actual = acciones.marcoEnPantalla()
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const alSoltar = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const de = marcos.findIndex((m) => m.id === e.active.id)
    const a = marcos.findIndex((m) => m.id === e.over!.id)
    const nuevos = arrayMove(marcos, de, a)
    void useTienda.getState().actualizarElementos(
      nuevos.map((m, i) => ({ id: m.id, datos: { orden: i + 1 } })),
      { registrar: 'ordenar los marcos' },
    )
  }
  const nuevo = async () => {
    const ultimo = marcos.at(-1)
    const c = acciones.centro()
    const x = ultimo ? ultimo.x + ultimo.ancho + 120 : c.x - 480
    const y = ultimo ? ultimo.y : c.y - 320
    const id = await acciones.crear('marco', x, y, datosNuevos('marco'), { ancho: 960, alto: 640, z: 0 })
    if (!id) return
    acciones.irAMarco(id)
    useTienda.getState().setEditando(id)
  }
  // Flechas arriba y abajo entre las filas (Enter va al marco).
  const alTecla = (e: EventoTecla<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const botones = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.fila-marco__ir')]
    const i = botones.indexOf(document.activeElement as HTMLButtonElement)
    e.preventDefault()
    const j = i === -1 ? 0 : Math.min(botones.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
    botones[j]?.focus()
  }
  return (
    <div className="panel-marcos__cuerpo" onKeyDown={alTecla}>
      <div className="panel-marcos__cabecera">
        <b>Marcos</b>
        <span className="panel-marcos__ayuda">
          <kbd>,</kbd> <kbd>.</kbd> para recorrerlos
        </span>
        <button type="button" className="panel-marcos__nuevo" onClick={() => void nuevo()}>
          <Plus size={14} /> Marco nuevo
        </button>
      </div>
      {marcos.length === 0 ? (
        <EstadoVacio className="estado-vacio--panel" icono={Frame} titulo="Todavía no hay marcos" ayuda="Dibujá uno con F" />
      ) : (
        <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={alSoltar}>
          <SortableContext items={marcos.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            <div className="panel-marcos__lista" role="list" aria-label="Marcos">
              {marcos.map((m) => (
                <FilaMarco key={m.id} marco={m} cantidad={conteo.get(m.id) ?? 0} actual={m.id === actual} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

export function PanelMarcos() {
  const elementos = useTienda((s) => s.tablero?.elementos ?? VACIO)
  const abierto = useLienzo((s) => s.panelMarcos)
  const marcos = ordenDeMarcos(elementos)
  const conteo = conteoPorMarco(elementos)
  return (
    <Desplegable
      abierto={abierto}
      alCambiar={(v) => useLienzo.getState().set({ panelMarcos: v })}
      lado="bottom-start"
      ancho={280}
      className="panel-marcos"
      enfocarInicial={-1}
      disparador={(p) => (
        <button {...p} type="button" className="boton-flotante" data-tip="Los marcos del lienzo" data-tecla=", .">
          <Frame size={15} /> Marcos <span className="boton-flotante__cuenta">{marcos.length}</span>
        </button>
      )}
    >
      {() => <ListaMarcos marcos={marcos} conteo={conteo} />}
    </Desplegable>
  )
}
