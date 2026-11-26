import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  MeasuringStrategy,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, Check, ChevronDown, Ellipsis, Frame, Plus, SearchX } from 'lucide-react'
import { motion } from 'motion/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { tinykeys } from 'tinykeys'
import { CATEGORIAS } from '../../../../compartido/constantes'
import { filtrarTarjetas, hayFiltro } from '../../../../compartido/filtro'
import { PAGINA_HECHO, porRecienteEnHecho } from '../../../../compartido/hecho'
import type { Categoria, Etiqueta, Lista, Miembro, TarjetaResumen } from '../../../../compartido/tipos'
import { avisar } from '../../estado/avisos'
import { irA } from '../../estado/ruta'
import { porOrden, useTienda } from '../../estado/tienda'
import { esTactil } from '../../movil/detectar'
import { useAjustesArrastre } from '../../movil/kanban/arrastre'
import { Menu } from '../../ui/Desplegable'
import { movimientoReducido } from '../../util/movimiento'
import { escribiendo } from '../../util/teclas'
import { PanelArchivoHecho } from './ArchivoHecho'
import { Compositor } from './Compositor'
import { TarjetaFrente } from './TarjetaFrente'

type Columnas = Record<string, string[]>

/** Tarjeta y lista bajo el cursor: los atajos de una tecla (Trello) actúan sobre ellas. */
const bajoCursor = { tarjeta: null as string | null, lista: null as string | null }

/** En las listas de Hecho las tarjetas no se corren para dejar lugar: el orden lo da cuándo llegó cada una, no dónde se suelta. */
const sinMover = () => null

const animacionSoltar: DropAnimation = {
  duration: 260,
  easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)',
  sideEffects: ({ active, dragOverlay }) => {
    active.node.classList.add('ordenable--aterrizando')
    dragOverlay.node.classList.add('soltando')
    return () => {
      active.node.classList.remove('ordenable--aterrizando')
    }
  },
}

/**
 * `dentro` se dibuja dentro del contexto de arrastre (en el celular: la tira de listas, que también es destino).
 * `alAgregar`: si viene, agregar una tarjeta no abre el compositor de la lista sino lo que haga esta función (en el
 * celular, la hoja inferior pegada al teclado: un compositor al pie de la lista quedaría tapado por el teclado en iOS).
 */
export function Kanban({ dentro, alAgregar }: { dentro?: ReactNode; alAgregar?: (listaId: string) => void } = {}) {
  const tablero = useTienda((s) => s.tablero)!
  const filtro = useTienda((s) => s.filtro)
  const destellos = useTienda((s) => s.destellos)
  const moverTarjeta = useTienda((s) => s.moverTarjeta)
  const moverLista = useTienda((s) => s.moverLista)
  const crearLista = useTienda((s) => s.crearLista)

  const listas = useMemo(() => [...tablero.listas].sort(porOrden), [tablero.listas])
  const etiquetas = useMemo(() => new Map(tablero.etiquetas.map((e) => [e.id, e])), [tablero.etiquetas])
  const conFiltro = hayFiltro(filtro)

  const visibles = useMemo(() => {
    const activas = tablero.tarjetas.filter((t) => !t.archivada)
    if (!conFiltro) return activas
    return filtrarTarjetas(activas, filtro, {
      listas: new Map(tablero.listas.map((l) => [l.id, l])),
      etiquetas,
      miembros: new Map(tablero.miembros.map((m) => [m.id, m])),
    })
  }, [tablero.tarjetas, tablero.listas, tablero.miembros, etiquetas, filtro, conFiltro])

  const porId = useMemo(() => new Map(tablero.tarjetas.map((t) => [t.id, t])), [tablero.tarjetas])
  // Las listas de Hecho acumulan todo lo terminado: se ven las más recientes (por cuándo llegaron a Hecho) y el resto se pide
  // con «Ver N anteriores», de a PAGINA_HECHO. Con un filtro, se filtra sobre todas y se muestran las primeras que coinciden.
  const [mostradas, setMostradas] = useState<Record<string, number>>({})
  const verAnteriores = useCallback((lista: string) => setMostradas((m) => ({ ...m, [lista]: (m[lista] ?? PAGINA_HECHO) + PAGINA_HECHO })), [])
  const { base, coinciden } = useMemo(() => {
    const c: Columnas = Object.fromEntries(listas.map((l) => [l.id, [] as string[]]))
    const n: Record<string, number> = {}
    const hechas = new Set(listas.filter((l) => l.categoria === 'hecho').map((l) => l.id))
    const porLista = new Map<string, TarjetaResumen[]>()
    for (const t of visibles) {
      if (!t.listaId || !c[t.listaId]) continue
      const a = porLista.get(t.listaId)
      if (a) a.push(t)
      else porLista.set(t.listaId, [t])
    }
    for (const [lid, ts] of porLista) {
      const deHecho = hechas.has(lid)
      ts.sort(deHecho ? porRecienteEnHecho : porOrden)
      n[lid] = ts.length
      c[lid] = (deHecho ? ts.slice(0, mostradas[lid] ?? PAGINA_HECHO) : ts).map((t) => t.id)
    }
    return { base: c, coinciden: n }
  }, [visibles, listas, mostradas])

  const [columnas, setColumnas] = useState<Columnas | null>(null)
  const [activo, setActivo] = useState<{ tipo: 'tarjeta' | 'lista'; id: string } | null>(null)
  const [ordenListas, setOrdenListas] = useState<string[] | null>(null)
  // Qué lista tiene el compositor abierto; `pedido` sube cada vez que se pide abrirlo (también si ya estaba abierto).
  const [compositor, setCompositor] = useState<{ lista: string; pedido: number } | null>(null)
  const ultimoSobre = useRef<UniqueIdentifier | null>(null)
  const recienMovida = useRef(false)
  const inicio = useRef<{ lista: string; indice: number } | null>(null)

  const abrirCompositor = useCallback(
    (lista: string) => {
      if (alAgregar) return alAgregar(lista)
      setCompositor((c) => ({ lista, pedido: (c?.pedido ?? 0) + 1 }))
    },
    [alAgregar],
  )
  const cerrarCompositor = useCallback((lista: string) => setCompositor((c) => (c?.lista === lista ? null : c)), [])

  const cols = columnas ?? base
  const idsListas = ordenListas ?? listas.map((l) => l.id)
  const hechas = useMemo(() => new Set(listas.filter((l) => l.categoria === 'hecho').map((l) => l.id)), [listas])

  const { sensores, autoScroll, accesibilidad } = useAjustesArrastre()

  const buscarLista = useCallback(
    (id: UniqueIdentifier) => {
      const s = String(id)
      if (s in cols) return s
      return Object.keys(cols).find((k) => cols[k]!.includes(s)) ?? null
    },
    [cols],
  )

  const colision: CollisionDetection = useCallback(
    (args) => {
      if (activo?.tipo === 'lista') {
        return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => String(c.id) in cols) })
      }
      const conPuntero = pointerWithin(args)
      const choques = conPuntero.length > 0 ? conPuntero : rectIntersection(args)
      let sobre = getFirstCollision(choques, 'id')
      if (sobre != null) {
        if (String(sobre) in cols) {
          const dentro = cols[String(sobre)]!
          if (dentro.length > 0) {
            const cerca = closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter((c) => c.id !== sobre && dentro.includes(String(c.id))),
            })[0]?.id
            if (cerca != null) sobre = cerca
          }
        }
        ultimoSobre.current = sobre
        return [{ id: sobre }]
      }
      if (recienMovida.current && activo) ultimoSobre.current = activo.id
      return ultimoSobre.current ? [{ id: ultimoSobre.current }] : []
    },
    [activo, cols],
  )

  useEffect(() => {
    requestAnimationFrame(() => {
      recienMovida.current = false
    })
  }, [columnas])

  const alEmpezar = ({ active }: DragStartEvent) => {
    const tipo = active.data.current?.tipo === 'lista' ? 'lista' : 'tarjeta'
    setActivo({ tipo, id: String(active.id) })
    if (tipo === 'tarjeta') {
      setColumnas(base)
      const lista = Object.keys(base).find((k) => base[k]!.includes(String(active.id)))!
      inicio.current = { lista, indice: base[lista]!.indexOf(String(active.id)) }
    } else setOrdenListas(listas.map((l) => l.id))
    document.body.classList.add('arrastrando')
  }

  const alPasar = ({ active, over }: DragOverEvent) => {
    if (activo?.tipo !== 'tarjeta' || !over) return
    const desde = buscarLista(active.id)
    const hacia = buscarLista(over.id)
    if (!desde || !hacia || desde === hacia) return
    setColumnas((c) => {
      const actual = c ?? base
      const itemsHacia = actual[hacia]!
      const indiceSobre = itemsHacia.indexOf(String(over.id))
      let nuevo: number
      if (hechas.has(hacia)) nuevo = 0 // en Hecho se ordena por cuándo llegó: lo que llega queda arriba
      else if (String(over.id) in actual) nuevo = itemsHacia.length
      else {
        const abajo =
          active.rect.current.translated && active.rect.current.translated.top > over.rect.top + over.rect.height / 2
        nuevo = indiceSobre >= 0 ? indiceSobre + (abajo ? 1 : 0) : itemsHacia.length
      }
      recienMovida.current = true
      return {
        ...actual,
        [desde]: actual[desde]!.filter((i) => i !== String(active.id)),
        [hacia]: [...itemsHacia.slice(0, nuevo), String(active.id), ...itemsHacia.slice(nuevo)],
      }
    })
  }

  const terminar = () => {
    setActivo(null)
    setColumnas(null)
    setOrdenListas(null)
    inicio.current = null
    document.body.classList.remove('arrastrando')
  }

  const alSoltar = ({ active, over }: DragEndEvent) => {
    const id = String(active.id)
    if (activo?.tipo === 'lista') {
      if (over && over.id !== active.id && ordenListas) {
        const nuevo = arrayMove(ordenListas, ordenListas.indexOf(id), ordenListas.indexOf(String(over.id)))
        moverLista(id, nuevo.indexOf(id))
      }
      terminar()
      return
    }
    const actual = columnas ?? base
    const lista = buscarLista(id)
    const haciaLista = over ? buscarLista(over.id) : null
    if (!lista || !haciaLista) return terminar()
    let final = actual
    // Dentro de una lista de Hecho no se reordena a mano: el orden es por cuándo llegó cada tarjeta.
    if (lista === haciaLista && over && !(String(over.id) in actual) && !hechas.has(lista)) {
      const a = actual[lista]!.indexOf(id)
      const b = actual[lista]!.indexOf(String(over.id))
      if (a !== b && b >= 0) final = { ...actual, [lista]: arrayMove(actual[lista]!, a, b) }
    }
    const visiblesLista = final[haciaLista]!
    const i = visiblesLista.indexOf(id)
    const cambio = !inicio.current || inicio.current.lista !== haciaLista || inicio.current.indice !== i
    if (cambio) {
      // El índice que se guarda es entre TODAS las tarjetas de la lista (aunque haya un filtro).
      const todas = tablero.tarjetas.filter((t) => t.listaId === haciaLista && t.id !== id && !t.archivada).sort(porOrden).map((t) => t.id)
      const anterior = visiblesLista[i - 1]
      const siguiente = visiblesLista[i + 1]
      const indiceReal = hechas.has(haciaLista) ? 0 : anterior ? todas.indexOf(anterior) + 1 : siguiente ? Math.max(0, todas.indexOf(siguiente)) : todas.length
      // La vista queda en la posición nueva al toque; el servidor confirma en segundo plano.
      moverTarjeta(id, haciaLista, indiceReal)
    }
    terminar()
  }

  // Atajos de una tecla sobre la tarjeta o la lista bajo el cursor (como en Trello).
  useEffect(() => {
    const moverAlCostado = (dir: -1 | 1, arriba: boolean) => {
      const id = bajoCursor.tarjeta
      if (!id) return
      const t = porId.get(id)
      if (!t?.listaId) return
      const i = listas.findIndex((l) => l.id === t.listaId)
      const destino = listas[i + dir]
      if (!destino) return
      const n = tablero.tarjetas.filter((x) => x.listaId === destino.id && !x.archivada).length
      moverTarjeta(id, destino.id, arriba || destino.categoria === 'hecho' ? 0 : n)
      avisar({ texto: `${t.clave} → ${destino.nombre}`, duracion: 1600 })
    }
    const libre = (e: KeyboardEvent) => !escribiendo(e) && !useTienda.getState().claveAbierta && !useTienda.getState().dialogo
    return tinykeys(window, {
      KeyN: (e) => {
        if (!libre(e)) return
        const lista = bajoCursor.lista ?? listas[0]?.id
        if (!lista) return
        e.preventDefault()
        abrirCompositor(lista)
      },
      Enter: (e) => {
        if (!libre(e) || !bajoCursor.tarjeta) return
        const t = porId.get(bajoCursor.tarjeta)
        if (t) useTienda.getState().abrirTarjeta(t.clave)
      },
      KeyE: (e) => {
        if (!libre(e) || !bajoCursor.tarjeta) return
        const t = porId.get(bajoCursor.tarjeta)
        if (t) useTienda.getState().abrirTarjeta(t.clave)
      },
      KeyC: (e) => {
        if (!libre(e) || !bajoCursor.tarjeta) return
        useTienda.getState().archivarTarjeta(bajoCursor.tarjeta)
        bajoCursor.tarjeta = null
      },
      KeyM: (e) => {
        if (!libre(e) || !bajoCursor.tarjeta) return
        const t = porId.get(bajoCursor.tarjeta)
        const yo = tablero.miembros.find((m) => m.esYo)
        if (!t || !yo) return
        const tengo = t.responsables.includes(yo.id)
        useTienda
          .getState()
          .actualizarTarjeta(t.id, tengo ? { responsables: t.responsables.filter((x) => x !== yo.id) } : { responsables: [...t.responsables, yo.id] }, {
            responsables: tengo ? t.responsables.filter((x) => x !== yo.id) : [...t.responsables, yo.id],
          })
      },
      Comma: (e) => libre(e) && moverAlCostado(-1, false),
      Period: (e) => libre(e) && moverAlCostado(1, false),
      'Shift+Comma': (e) => libre(e) && moverAlCostado(-1, true),
      'Shift+Period': (e) => libre(e) && moverAlCostado(1, true),
      'Shift+<': (e) => libre(e) && moverAlCostado(-1, true),
      'Shift+>': (e) => libre(e) && moverAlCostado(1, true),
    })
  }, [listas, porId, tablero.tarjetas, tablero.miembros, moverTarjeta, abrirCompositor])

  const tarjetaActiva = activo?.tipo === 'tarjeta' ? porId.get(activo.id) : null
  const listaActiva = activo?.tipo === 'lista' ? listas.find((l) => l.id === activo.id) : null
  const totalVisibles = visibles.length

  return (
    <div className="kanban">
      {conFiltro && (
        <div className="kanban__filtro">
          {totalVisibles === 0 ? <SearchX size={14} /> : null}
          {totalVisibles === 1 ? '1 tarjeta coincide' : `${totalVisibles} tarjetas coinciden`} con «{filtro}»
          <button onClick={() => useTienda.getState().setFiltro('')}>Limpiar</button>
        </div>
      )}
      <DndContext
        sensors={sensores}
        collisionDetection={colision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        autoScroll={autoScroll}
        accessibility={accesibilidad}
        onDragStart={alEmpezar}
        onDragOver={alPasar}
        onDragEnd={alSoltar}
        onDragCancel={terminar}
      >
        {dentro}
        <div className="kanban__lienzo">
          <SortableContext items={idsListas} strategy={horizontalListSortingStrategy}>
            {idsListas.map((lid, posicion) => {
              const lista = listas.find((l) => l.id === lid)
              if (!lista) return null
              const ids = cols[lid] ?? []
              return (
                <ListaKanban
                  key={lid}
                  lista={lista}
                  ids={ids}
                  porId={porId}
                  etiquetas={etiquetas}
                  miembros={tablero.miembros}
                  destellos={destellos}
                  total={tablero.tarjetas.filter((t) => t.listaId === lid && !t.archivada).length}
                  coinciden={coinciden[lid] ?? 0}
                  anteriores={Math.max(0, (coinciden[lid] ?? 0) - (base[lid]?.length ?? 0))}
                  verAnteriores={verAnteriores}
                  destino={activo?.tipo === 'tarjeta' && buscarLista(activo.id) === lid && inicio.current?.lista !== lid}
                  compositorAbierto={compositor?.lista === lid}
                  pedidoCompositor={compositor?.lista === lid ? compositor.pedido : 0}
                  abrirCompositor={abrirCompositor}
                  cerrarCompositor={cerrarCompositor}
                  alAgregar={alAgregar}
                  arrastrandoAlgo={Boolean(activo)}
                  conFiltro={conFiltro}
                  posicion={posicion}
                  cantidadListas={idsListas.length}
                />
              )
            })}
          </SortableContext>
          <NuevaLista alCrear={crearLista} />
        </div>
        <DragOverlay dropAnimation={animacionSoltar}>
          {tarjetaActiva ? (
            <div className="sombra-arrastre">
              <motion.div
                className="sombra-arrastre__giro"
                initial={{ rotate: 0, scale: 1 }}
                animate={{ rotate: 3.5, scale: 1.035 }}
                transition={{ type: 'spring', stiffness: 420, damping: 22 }}
              >
                <TarjetaFrente tarjeta={tarjetaActiva} etiquetas={etiquetas} miembros={tablero.miembros} />
              </motion.div>
            </div>
          ) : listaActiva ? (
            <div className="sombra-arrastre sombra-arrastre--lista">
              <motion.div className="sombra-arrastre__giro" initial={{ rotate: 0 }} animate={{ rotate: 2 }} transition={{ type: 'spring', stiffness: 380, damping: 24 }}>
                <div className="lista lista--fantasma">
                  <div className="lista__cabecera">
                    <PuntoCategoria categoria={listaActiva.categoria} />
                    <span className="lista__nombre">{listaActiva.nombre}</span>
                    <span className="lista__cuenta">{(cols[listaActiva.id] ?? []).length}</span>
                  </div>
                  <div className="lista__tarjetas">
                    {(cols[listaActiva.id] ?? []).slice(0, 4).map((id) => {
                      const t = porId.get(id)
                      return t ? <TarjetaFrente key={id} tarjeta={t} etiquetas={etiquetas} miembros={tablero.miembros} compacta /> : null
                    })}
                  </div>
                </div>
              </motion.div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function PuntoCategoria({ categoria }: { categoria: Categoria | null }) {
  const c = CATEGORIAS.find((x) => x.id === categoria)
  return (
    <span
      className={`punto-categoria${c ? ` punto-categoria--${c.id}` : ''}`}
      title={c ? `Categoría: ${c.nombre}` : 'Sin categoría'}
    />
  )
}

interface PropsLista {
  lista: Lista
  ids: string[]
  porId: Map<string, TarjetaResumen>
  etiquetas: Map<string, Etiqueta>
  miembros: Miembro[]
  destellos: Record<string, number>
  total: number
  /** Cuántas tarjetas de la lista coinciden con el filtro (todas, no solo las que se ven: en Hecho se ven las más recientes). */
  coinciden: number
  /** Las que coinciden y todavía no se ven (solo en las listas de Hecho). */
  anteriores: number
  verAnteriores: (listaId: string) => void
  destino: boolean
  compositorAbierto: boolean
  pedidoCompositor: number
  abrirCompositor: (listaId: string) => void
  cerrarCompositor: (listaId: string) => void
  alAgregar?: (listaId: string) => void
  arrastrandoAlgo: boolean
  conFiltro: boolean
  posicion: number
  cantidadListas: number
}

const ListaKanban = memo(function ListaKanban({
  lista,
  ids,
  porId,
  etiquetas,
  miembros,
  destellos,
  total,
  coinciden,
  anteriores,
  verAnteriores,
  destino,
  compositorAbierto,
  pedidoCompositor,
  abrirCompositor,
  cerrarCompositor,
  alAgregar,
  arrastrandoAlgo,
  conFiltro,
  posicion,
  cantidadListas,
}: PropsLista) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: lista.id,
    data: { tipo: 'lista' },
  })
  const actualizarLista = useTienda((s) => s.actualizarLista)
  const moverLista = useTienda((s) => s.moverLista)
  const [editando, setEditando] = useState(false)
  const [archivoHecho, setArchivoHecho] = useState(false)
  const [nombre, setNombre] = useState(lista.nombre)
  const refTarjetas = useRef<HTMLDivElement>(null)
  useEffect(() => setNombre(lista.nombre), [lista.nombre])
  const hecha = lista.categoria === 'hecho'
  /** Lleva la lista adonde se agregan las tarjetas nuevas: al final (en Hecho, arriba: lo último que llegó es lo primero). */
  const traerFinal = useCallback(() => {
    const el = refTarjetas.current
    if (el) el.scrollTo({ top: hecha ? 0 : el.scrollHeight, behavior: movimientoReducido() ? 'auto' : 'smooth' })
  }, [hecha])
  // Mientras queden tarjetas por debajo de lo que se ve, el pie se separa con una sombra suave (la clase se pone directo
  // en el DOM: seguir el desplazamiento no vuelve a dibujar la lista).
  useEffect(() => {
    const el = refTarjetas.current
    const seccion = el?.parentElement
    if (!el || !seccion) return
    const medir = () => seccion.classList.toggle('lista--mas-abajo', el.scrollHeight - el.scrollTop - el.clientHeight > 6)
    medir()
    el.addEventListener('scroll', medir, { passive: true })
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    if (el.firstElementChild) obs.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', medir)
      obs.disconnect()
    }
  }, [ids.length])
  // Al abrir el compositor, la lista baja hasta donde va a caer la tarjeta nueva.
  useEffect(() => {
    if (compositorAbierto) requestAnimationFrame(traerFinal)
  }, [compositorAbierto, traerFinal])

  const estilo: CSSProperties = { transform: CSS.Translate.toString(transform), transition }
  const excedida = lista.limite != null && total > lista.limite

  const guardarNombre = () => {
    setEditando(false)
    const n = nombre.trim()
    if (n && n !== lista.nombre) actualizarLista(lista.id, { nombre: n })
    else setNombre(lista.nombre)
  }

  return (
    <section
      ref={setNodeRef}
      style={estilo}
      className={`lista${isDragging ? ' lista--hueco' : ''}${destino ? ' lista--destino' : ''}${excedida ? ' lista--excedida' : ''}`}
      data-lista={lista.id}
      onMouseEnter={() => (bajoCursor.lista = lista.id)}
      onMouseLeave={() => {
        if (bajoCursor.lista === lista.id) bajoCursor.lista = null
      }}
      aria-label={`Lista ${lista.nombre}`}
    >
      <header className="lista__cabecera" {...attributes} {...listeners}>
        <PuntoCategoria categoria={lista.categoria} />
        {editando ? (
          <input
            className="lista__nombre-input"
            value={nombre}
            autoFocus
            onChange={(e) => setNombre(e.target.value)}
            onBlur={guardarNombre}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') guardarNombre()
              if (e.key === 'Escape') {
                setNombre(lista.nombre)
                setEditando(false)
              }
            }}
          />
        ) : (
          <h2 className="lista__nombre" onClick={() => setEditando(true)} title={`${lista.nombre} · tocá para renombrar`}>
            {lista.nombre}
          </h2>
        )}
        <span
          className="lista__cuenta"
          aria-label={`${coinciden} ${coinciden === 1 ? 'tarjeta' : 'tarjetas'}${conFiltro && coinciden !== total ? ` de ${total}` : ''}`}
        >
          {conFiltro && coinciden !== total ? `${coinciden}/${total}` : coinciden}
          {lista.limite != null && <span className="lista__limite">/{lista.limite}</span>}
        </span>
        {/* Los dos botones son del mismo tamaño y de la misma familia (círculos): «+» agrega, «⋯» abre las opciones. */}
        <span className="lista__botones" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="lista__boton lista__boton--mas"
            onClick={() => abrirCompositor(lista.id)}
            aria-label="Agregar tarjeta"
            data-tip="Agregar tarjeta"
            data-tecla="N"
          >
            <Plus size={16} strokeWidth={2.4} />
          </button>
          <Menu
            disparador={(p) => (
              <button {...p} className="lista__boton lista__menu" aria-label="Opciones de la lista">
                <Ellipsis size={16} />
              </button>
            )}
            items={[
              { id: 'agregar', etiqueta: 'Agregar tarjeta', icono: <Plus size={15} />, atajo: 'N', alElegir: () => abrirCompositor(lista.id) },
              ...[null, ...CATEGORIAS.map((c) => c.id)].map((c, i) => ({
                id: `cat-${c ?? 'ninguna'}`,
                etiqueta: c ? `Categoría: ${CATEGORIAS.find((x) => x.id === c)!.nombre}` : 'Sin categoría',
                icono: lista.categoria === c ? <Check size={15} /> : <PuntoCategoria categoria={c} />,
                separador: i === 0,
                alElegir: () => actualizarLista(lista.id, { categoria: c }),
              })),
              ...(lista.categoria === 'hecho'
                ? [{ id: 'archivo-hecho', etiqueta: 'Archivo de Hecho…', icono: <ArchiveRestore size={15} />, separador: true, alElegir: () => setArchivoHecho(true) }]
                : []),
              // Con el dedo, mover una lista arrastrando su cabecera es incómodo: también se mueve desde acá.
              ...(esTactil()
                ? [
                    ...(posicion > 0
                      ? [{ id: 'izquierda', etiqueta: 'Mover a la izquierda', icono: <ArrowLeft size={15} />, separador: true, alElegir: () => moverLista(lista.id, posicion - 1) }]
                      : []),
                    ...(posicion < cantidadListas - 1
                      ? [{ id: 'derecha', etiqueta: 'Mover a la derecha', icono: <ArrowRight size={15} />, separador: posicion === 0, alElegir: () => moverLista(lista.id, posicion + 1) }]
                      : []),
                  ]
                : []),
              {
                id: 'lienzo',
                etiqueta: 'Mostrar en el lienzo',
                icono: <Frame size={15} />,
                separador: true,
                alElegir: async () => {
                  const s = useTienda.getState()
                  const t = s.tablero
                  if (!t) return
                  const ya = t.elementos.find((e) => e.tipo === 'lista' && e.listaId === lista.id)
                  if (!ya) {
                    const maxX = Math.max(0, ...t.elementos.map((e) => e.x + e.ancho))
                    await s.crearElemento({ tipo: 'lista', x: maxX + 120, y: 0, ancho: 304, alto: 560, listaId: lista.id })
                  }
                  irA({ vista: 'lienzo' })
                },
              },
              { id: 'archivar', etiqueta: 'Archivar lista', icono: <Archive size={15} />, peligro: true, separador: true, alElegir: () => actualizarLista(lista.id, { archivada: true }) },
            ]}
          />
        </span>
      </header>
      <div className="lista__tarjetas" ref={refTarjetas}>
        <SortableContext items={ids} strategy={hecha ? sinMover : verticalListSortingStrategy}>
          {ids.map((id) => {
            const t = porId.get(id)
            if (!t) return null
            return <TarjetaOrdenable key={id} tarjeta={t} etiquetas={etiquetas} miembros={miembros} destello={destellos[id]} hecha={hecha} />
          })}
        </SortableContext>
        {hecha && anteriores > 0 && !arrastrandoAlgo && (
          <button type="button" className="lista__anteriores" onClick={() => verAnteriores(lista.id)} data-anteriores>
            <ChevronDown size={15} aria-hidden />
            <span>
              Ver {anteriores} {anteriores === 1 ? 'anterior' : 'anteriores'}
            </span>
          </button>
        )}
        {ids.length === 0 && !compositorAbierto && (
          <div className={`lista__vacia${arrastrandoAlgo ? ' lista__vacia--arrastrando' : ''}`}>
            {arrastrandoAlgo ? 'Soltala acá' : total > 0 ? 'Nada coincide con el filtro' : 'Todavía no hay tarjetas'}
          </div>
        )}
      </div>
      {archivoHecho && <PanelArchivoHecho tableroId={lista.tableroId} abierto alCerrar={() => setArchivoHecho(false)} />}
      {/* El pie queda fuera de lo que se desplaza: «Agregar tarjeta» siempre a la vista, con 3 tarjetas o con 300. */}
      <Compositor
        listaId={lista.id}
        listaNombre={lista.nombre}
        abierto={compositorAbierto}
        pedido={pedidoCompositor}
        alAbrir={() => abrirCompositor(lista.id)}
        alCerrar={() => cerrarCompositor(lista.id)}
        traerFinal={traerFinal}
        alAgregar={alAgregar}
      />
    </section>
  )
})

const TarjetaOrdenable = memo(function TarjetaOrdenable({
  tarjeta,
  etiquetas,
  miembros,
  destello,
  hecha,
}: {
  tarjeta: TarjetaResumen
  etiquetas: Map<string, Etiqueta>
  miembros: Miembro[]
  destello?: number
  hecha?: boolean
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: tarjeta.id,
    data: { tipo: 'tarjeta', listaId: tarjeta.listaId },
    disabled: tarjeta.id.startsWith('tmp-'),
  })
  const abrir = useTienda((s) => s.abrirTarjeta)
  const estilo: CSSProperties = { transform: CSS.Translate.toString(transform), transition }
  return (
    <div
      ref={setNodeRef}
      style={estilo}
      className={`ordenable${isDragging ? ' ordenable--hueco' : ''}`}
      {...attributes}
      {...listeners}
      role="button"
      aria-roledescription="tarjeta"
      aria-label={`${tarjeta.clave}: ${tarjeta.titulo}`}
      onMouseEnter={() => (bajoCursor.tarjeta = tarjeta.id)}
      onMouseLeave={() => {
        if (bajoCursor.tarjeta === tarjeta.id) bajoCursor.tarjeta = null
      }}
      onClick={(e) => {
        if (tarjeta.id.startsWith('tmp-')) return
        abrir(tarjeta.clave, (e.currentTarget as HTMLElement).getBoundingClientRect())
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') abrir(tarjeta.clave, (e.currentTarget as HTMLElement).getBoundingClientRect())
        else listeners?.onKeyDown?.(e)
      }}
    >
      <TarjetaFrente tarjeta={tarjeta} etiquetas={etiquetas} miembros={miembros} destello={destello} hecha={hecha} />
    </div>
  )
})

function NuevaLista({ alCrear }: { alCrear: (nombre: string) => void }) {
  const [abierta, setAbierta] = useState(false)
  const [nombre, setNombre] = useState('')
  const crear = () => {
    const n = nombre.trim()
    if (!n) return
    alCrear(n)
    setNombre('')
  }
  if (!abierta)
    return (
      <button className="nueva-lista" onClick={() => setAbierta(true)}>
        <Plus size={16} /> Agregar lista
      </button>
    )
  return (
    <div className="nueva-lista nueva-lista--abierta">
      <input
        autoFocus
        className="nueva-lista__input"
        value={nombre}
        placeholder="Nombre de la lista…"
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') crear()
          if (e.key === 'Escape') {
            setNombre('')
            setAbierta(false)
          }
        }}
        onBlur={() => !nombre.trim() && setAbierta(false)}
      />
      <div className="nueva-lista__pie">
        <button className="boton boton--primario boton--chico" onMouseDown={(e) => e.preventDefault()} onClick={crear}>
          Crear lista
        </button>
        <button className="boton boton--chico" onMouseDown={(e) => e.preventDefault()} onClick={() => setAbierta(false)}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
