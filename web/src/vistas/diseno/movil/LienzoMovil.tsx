// Una página de lienzo en el teléfono: los marcos como en la PC (React Flow, el mismo nodo de marco con su miniatura, su
// nombre de tamaño fijo, sus secciones y los pines de comentarios), con los gestos del lienzo del celular: un dedo
// desplaza, dos dedos pellizcan. Un toque abre el marco a pantalla completa; mantener apretado abre su menú.
//   · Arranca ajustado a la primera sección (o a la primera fila, o al primer marco), alineado arriba: "ver todo" en una
//     página de 40 pantallas deja manchas ilegibles. La vista queda guardada por página (aparte de la de la PC).
//   · Los marcos grandes en la pantalla pasan a vivos (iframe) para verse nítidos; en el teléfono, como mucho 4.
//   · Arriba a la derecha: "Ver todo" y la lista de marcos (llegar a cualquiera en dos toques).
import { ReactFlow, ReactFlowProvider, useOnViewportChange, useReactFlow, type OnNodesChange, type Viewport } from '@xyflow/react'
import { LayoutList, Maximize } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { limitesDe } from '../../../../../compartido/diseno/acomodar'
import type { ComentarioDiseno, MarcoResumen } from '../../../../../compartido/diseno/tipos'
import { vibrar } from '../../../movil/haptica'
import { apiDiseno } from '../api'
import { useDiseno } from '../estado'
import { MarcoNodo, SeccionNodo, type NodoMarco, type NodoSeccion } from '../lienzo/MarcoNodo'
import { recalcularVivos, reiniciarVivos } from '../lienzo/vivos'
import { useDisenoMovil } from './estado'
import { EVENTO_INICIO } from './TiraPaginas'
import { VacioDeLienzo } from './Vacios'
import { enOrden, marcoDeObjetivo, pinesDe } from './util'

const TIPOS_NODO = { marco: MarcoNodo, seccion: SeccionNodo }
type Nodo = NodoMarco | NodoSeccion

/** Descarta el próximo click (si llega en menos de medio segundo). */
function tragarClick() {
  const f = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    quitar()
  }
  const reloj = setTimeout(() => quitar(), 500)
  const quitar = () => {
    clearTimeout(reloj)
    document.removeEventListener('click', f, true)
  }
  document.addEventListener('click', f, true)
}

/** Tope de iframes vivos en el teléfono. */
const TOPE_VIVOS_MOVIL = 4
/** Con menos zoom que esto los marcos se ven, pero no se leen: se arranca por el primero. */
const LEGIBLE = 0.3
const claveVista = (pagina: string) => `telar.diseno.movil.vista.${pagina}`

export function LienzoMovil() {
  return (
    <ReactFlowProvider>
      <Interno />
    </ReactFlowProvider>
  )
}

function Interno() {
  const rf = useReactFlow<Nodo>()
  const pagina = useDiseno((s) => s.pagina)!
  const marcos = useDiseno((s) => s.marcos)
  const prefijo = useDiseno((s) => s.prefijo)!
  const cargando = useDiseno((s) => s.cargandoPagina)
  const fondo = useDiseno((s) => s.pref.fondo)
  const contenedor = useRef<HTMLDivElement>(null)
  const [nodos, setNodos] = useState<Nodo[]>([])
  const [pines, setPines] = useState<ComentarioDiseno[]>([])

  // Los pines de la página (comentarios abiertos con lugar).
  useEffect(() => {
    let vivo = true
    const cargar = () =>
      apiDiseno
        .comentarios(prefijo)
        .then((cs) => vivo && setPines(pinesDe(cs)))
        .catch(() => {})
    cargar()
    window.addEventListener('telar:diseno-comentarios', cargar)
    return () => {
      vivo = false
      window.removeEventListener('telar:diseno-comentarios', cargar)
    }
  }, [prefijo, pagina.id, marcos])

  // Tienda → nodos (el mismo nodo de marco que la PC; en el teléfono nada se arrastra).
  useEffect(() => {
    const porMarco = new Map<string, ComentarioDiseno[]>()
    for (const c of pines) {
      const id = marcoDeObjetivo(c.objetivo)
      if (!porMarco.has(id)) porMarco.set(id, [])
      porMarco.get(id)!.push(c)
    }
    const r: Nodo[] = []
    const vistas = new Set<string>()
    for (const m of marcos) {
      r.push({
        id: m.id,
        type: 'marco',
        position: { x: m.x, y: m.y },
        data: { marco: m, prefijo, pines: porMarco.get(m.id) ?? [] },
        width: m.ancho,
        height: m.alto,
        draggable: false,
        selectable: false,
      })
      const s = m.seccion
      if (s && !vistas.has(s)) {
        vistas.add(s)
        const primero = marcos.filter((x) => x.seccion === s).reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a))
        r.push({ id: `sec:${s}`, type: 'seccion', position: { x: primero.x, y: primero.y }, data: { titulo: s }, draggable: false, selectable: false, width: 1200, height: 1 })
      }
    }
    setNodos(r)
  }, [marcos, pines, prefijo])

  const onNodesChange: OnNodesChange<Nodo> = useCallback((cambios) => setNodos((ns) => cambios.applyTo(ns)), [])

  // ── encuadres ──
  const encuadrar = useCallback(
    (rect: { x: number; y: number; ancho: number; alto: number }, o: { max?: number; arriba?: boolean; duracion?: number; margen?: number } = {}) => {
      const c = contenedor.current?.getBoundingClientRect()
      if (!c) return
      const margen = o.margen ?? 16
      // arriba: lugar para el título de la sección y los nombres (y los botones flotantes)
      const arriba = 64
      const zoom = Math.max(0.02, Math.min(o.max ?? 1, (c.width - margen * 2) / rect.ancho, (c.height - arriba - margen) / rect.alto))
      const x = rect.ancho * zoom < c.width - margen * 2 ? (c.width - rect.ancho * zoom) / 2 - rect.x * zoom : margen - rect.x * zoom
      const y = o.arriba ? arriba - rect.y * zoom : arriba + (c.height - arriba - margen - rect.alto * zoom) / 2 - rect.y * zoom
      void rf.setViewport({ x, y, zoom }, { duration: o.duracion ?? 380 })
    },
    [rf],
  )

  const verTodo = useCallback(
    (duracion = 380) => {
      const l = limitesDe(useDiseno.getState().marcos.map((m) => ({ x: m.x, y: m.y, ancho: m.ancho, alto: m.alto })))
      if (l) encuadrar(l, { duracion })
    },
    [encuadrar],
  )

  /**
   * La primera sección entera si se lee; si no, el primer marco grande y pegado a la izquierda, con el siguiente de su
   * fila asomando a la derecha (como la lista siguiente del Kanban): se lee y se ve que hay más.
   */
  const verInicio = useCallback(
    (duracion = 0) => {
      const c = contenedor.current?.getBoundingClientRect()
      const ms = enOrden(useDiseno.getState().marcos)
      if (!c || !ms.length) return
      const primero = ms[0]!
      const caja = (lista: MarcoResumen[]) => limitesDe(lista.map((m) => ({ x: m.x, y: m.y, ancho: m.ancho, alto: m.alto })))!
      const seccion = caja(ms.filter((m) => m.seccion === primero.seccion))
      if (Math.min((c.width - 32) / seccion.ancho, (c.height - 80) / seccion.alto) >= LEGIBLE) return encuadrar(seccion, { arriba: true, duracion })
      const vecino = ms.some((m) => m !== primero && Math.abs(m.y - primero.y) < 4 && m.x > primero.x)
      const zoom = Math.max(0.02, Math.min(1, (c.width * (vecino ? 0.78 : 1) - (vecino ? 0 : 32)) / primero.ancho, (c.height - 96) / primero.alto))
      const x = vecino ? 16 - primero.x * zoom : (c.width - primero.ancho * zoom) / 2 - primero.x * zoom
      void rf.setViewport({ x, y: 64 - primero.y * zoom, zoom }, { duration: duracion })
    },
    [encuadrar, rf],
  )

  // ── qué marcos viven (iframe) ──
  const quieto = useRef<ReturnType<typeof setTimeout> | null>(null)
  const calcularVivos = useCallback(() => {
    const c = contenedor.current?.getBoundingClientRect()
    if (!c) return
    recalcularVivos({ marcos: useDiseno.getState().marcos, vista: rf.getViewport(), ancho: c.width, alto: c.height, fijos: [], sobre: null, tope: TOPE_VIVOS_MOVIL })
  }, [rf])
  useEffect(() => () => reiniciarVivos(), [])

  // Primera vista de la página: la guardada o la de inicio.
  const lista = useRef(false)
  useEffect(() => {
    if (lista.current || cargando || !nodos.length) return
    lista.current = true
    let guardada: Viewport | null = null
    try {
      guardada = JSON.parse(localStorage.getItem(claveVista(pagina.id)) ?? 'null') as Viewport | null
    } catch {
      guardada = null
    }
    if (guardada && Number.isFinite(guardada.zoom)) void rf.setViewport(guardada, { duration: 0 })
    else requestAnimationFrame(() => verInicio(0))
    setTimeout(calcularVivos, 80)
  }, [nodos.length, cargando, pagina.id, rf, verInicio, calcularVivos])

  useEffect(() => {
    calcularVivos()
  }, [marcos, calcularVivos])

  useOnViewportChange({
    onChange: (vp) => {
      const el = contenedor.current
      if (!el) return
      el.style.setProperty('--z', String(vp.zoom))
      el.classList.toggle('dz-lienzo--lejos', vp.zoom < 0.12)
      if (quieto.current) clearTimeout(quieto.current)
      quieto.current = setTimeout(calcularVivos, 150)
    },
    onEnd: (vp) => {
      try {
        localStorage.setItem(claveVista(pagina.id), JSON.stringify(vp))
      } catch {}
    },
  })

  // Volver a tocar Diseño (o la página activa): ver todo.
  useEffect(() => {
    const f = () => verTodo()
    window.addEventListener(EVENTO_INICIO, f)
    return () => window.removeEventListener(EVENTO_INICIO, f)
  }, [verTodo])

  // Un pin del lienzo abre el marco con su hilo.
  useEffect(() => {
    const f = (e: Event) => {
      const { id, marco } = (e as CustomEvent<{ id: string; marco: string }>).detail
      useDisenoMovil.getState().abrirVisor(marco, { tipo: 'comentarios', marco, hilo: id })
    }
    window.addEventListener('telar:diseno-pin', f)
    return () => window.removeEventListener('telar:diseno-pin', f)
  }, [])

  // ── toques: un toque abre, mantener apretado abre el menú ──
  /** El marco bajo un punto de la pantalla (con su nombre, que está arriba del marco). */
  const marcoEn = (clientX: number, clientY: number): MarcoResumen | null => {
    const c = contenedor.current?.getBoundingClientRect()
    if (!c) return null
    const vp = rf.getViewport()
    const fx = (clientX - c.left - vp.x) / vp.zoom
    const fy = (clientY - c.top - vp.y) / vp.zoom
    const nombre = 26 / vp.zoom
    const ms = useDiseno.getState().marcos
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i]!
      if (fx >= m.x && fx <= m.x + m.ancho && fy >= m.y - nombre && fy <= m.y + m.alto) return m
    }
    return null
  }
  const toque = useRef<{ x: number; y: number; dedos: number; movido: boolean; mantenido: boolean; tipo: string; reloj: ReturnType<typeof setTimeout> | null }>({
    x: 0,
    y: 0,
    tipo: '',
    dedos: 0,
    movido: false,
    mantenido: false,
    reloj: null,
  })
  const cancelarReloj = () => {
    if (toque.current.reloj) clearTimeout(toque.current.reloj)
    toque.current.reloj = null
  }
  const alBajar = (e: React.PointerEvent) => {
    const t = toque.current
    t.tipo = e.pointerType
    t.dedos++
    if (t.dedos > 1) {
      t.movido = true
      cancelarReloj()
      return
    }
    t.x = e.clientX
    t.y = e.clientY
    t.movido = false
    t.mantenido = false
    cancelarReloj()
    if (e.pointerType === 'mouse') return
    t.reloj = setTimeout(() => {
      t.reloj = null
      if (t.movido || t.dedos !== 1) return
      const m = marcoEn(t.x, t.y)
      if (!m) return
      t.mantenido = true
      vibrar('menu')
      useDisenoMovil.getState().abrirHoja({ tipo: 'menu', marco: m.id })
    }, 450)
  }
  const alMover = (e: React.PointerEvent) => {
    const t = toque.current
    if (!t.movido && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) {
      t.movido = true
      cancelarReloj()
    }
  }
  const alSoltar = () => {
    const t = toque.current
    t.dedos = Math.max(0, t.dedos - 1)
    cancelarReloj()
    // Después de mantener apretado, el navegador puede mandar igual el click del toque: caería en el velo de la hoja
    // recién abierta y la cerraría. Ese click se descarta.
    if (t.mantenido) tragarClick()
  }
  const alClic = (e: React.MouseEvent) => {
    const t = toque.current
    if (t.movido || t.mantenido) return
    if ((e.target as HTMLElement).closest('.dz-pin, .dzm-flotantes')) return
    const m = marcoEn(e.clientX, e.clientY)
    if (m) useDisenoMovil.getState().abrirVisor(m.id)
  }

  return (
    <div
      ref={contenedor}
      className={`dz-lienzo dz-lienzo--${fondo} dzm-lienzo`}
      onPointerDownCapture={alBajar}
      onPointerMoveCapture={alMover}
      onPointerUpCapture={alSoltar}
      onPointerCancelCapture={alSoltar}
      onClick={alClic}
      onContextMenu={(e) => {
        e.preventDefault()
        // Con mouse (una ventana angosta en la computadora), el botón derecho abre el mismo menú que mantener apretado.
        if (toque.current.tipo !== 'mouse') return
        const m = marcoEn(e.clientX, e.clientY)
        if (m) useDisenoMovil.getState().abrirHoja({ tipo: 'menu', marco: m.id })
      }}
    >
      <ReactFlow<Nodo>
        nodes={nodos}
        edges={[]}
        nodeTypes={TIPOS_NODO}
        onNodesChange={onNodesChange}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable={false}
        selectNodesOnDrag={false}
        panOnDrag
        selectionOnDrag={false}
        panOnScroll={false}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.02}
        maxZoom={4}
        onlyRenderVisibleElements
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        panActivationKeyCode={null}
        zoomActivationKeyCode={null}
        proOptions={{ hideAttribution: true }}
      />
      {!cargando && marcos.length === 0 && <VacioDeLienzo />}
      {marcos.length > 0 && (
        <div className="dzm-flotantes">
          <button type="button" className="dzm-flotante" onClick={() => verTodo()} aria-label="Ver todo">
            <Maximize size={20} />
          </button>
          <button type="button" className="dzm-flotante" onClick={() => useDisenoMovil.getState().abrirHoja({ tipo: 'marcos' })} aria-label="Lista de marcos">
            <LayoutList size={20} />
          </button>
        </div>
      )}
    </div>
  )
}
