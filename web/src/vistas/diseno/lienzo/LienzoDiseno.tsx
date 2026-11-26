// El lienzo de Diseño (plan 6.3): React Flow con un nodo por marco (iframe vivo o miniatura), títulos de sección y, en las
// páginas de sistema, un nodo por sección dibujado por React. Encima, la capa de selección y los controles flotantes.
import {
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useOnViewportChange,
  useReactFlow,
  type Node,
  type OnNodesChange,
  type Viewport,
} from '@xyflow/react'
import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tinykeys } from 'tinykeys'
import { limitesDe } from '../../../../../compartido/diseno/acomodar'
import type { ComentarioDiseno, MarcoResumen } from '../../../../../compartido/diseno/tipos'
import { avisar, avisarError } from '../../../estado/avisos'
import { escribiendo } from '../../../util/teclas'
import { apiDiseno } from '../api'
import { insertarEnMarco } from '../editar/insertar'
import { useDiseno } from '../estado'
import { MarcoSistemaNodo, nodosDeSistema, type NodoSistema } from '../sistema/PaginaSistema'
import { CapaSeleccion } from './CapaSeleccion'
import { alternarProbar, FondoYModo, Herramientas, MarcoNuevo, Migas, Zoom } from './Controles'
import { capaEn, capaParaClic, capaParaDobleClic, elementoDeCapa, esTexto, hijosCapa, padreCapa, documentoDe } from './elegir'
import { MarcoNodo, SeccionNodo, type NodoMarco, type NodoSeccion } from './MarcoNodo'
import { recalcularVivos, reiniciarVivos } from './vivos'
import { empezarEdicionTexto } from '../editar/texto'
import { ComposerComentario } from './Pines'

const TIPOS_NODO = { marco: MarcoNodo, seccion: SeccionNodo, marcoSistema: MarcoSistemaNodo }
type Nodo = NodoMarco | NodoSeccion | NodoSistema

export default function LienzoDiseno() {
  return (
    <ReactFlowProvider>
      <Interno />
    </ReactFlowProvider>
  )
}

function Interno() {
  const rf = useReactFlow<Nodo>()
  const pagina = useDiseno((s) => s.pagina)
  const marcos = useDiseno((s) => s.marcos)
  const prefijo = useDiseno((s) => s.prefijo)!
  const resumen = useDiseno((s) => s.resumen)
  const items = useDiseno((s) => s.items)
  const herramienta = useDiseno((s) => s.herramienta)
  const fondo = useDiseno((s) => s.pref.fondo)
  const probando = useDiseno((s) => s.probando)
  const marcoNuevo = useDiseno((s) => s.marcoNuevo)
  const reglaFija = useDiseno((s) => s.reglaFija)
  const contenedor = useRef<HTMLDivElement>(null)
  const [nodos, setNodos] = useState<Nodo[]>([])
  const [pines, setPines] = useState<ComentarioDiseno[]>([])
  const [minimapa, setMinimapa] = useState(() => localStorage.getItem('telar.diseno.minimapa') === 'si')
  const [ventanaMarco, setVentanaMarco] = useState(false)
  const [composer, setComposer] = useState<{ marco: string; capa: string | null; x: number; y: number; sx: number; sy: number } | null>(null)
  const [modoRueda] = useState<'auto' | 'mouse' | 'trackpad'>(() => (localStorage.getItem('tablero.rueda') as 'auto' | 'mouse' | 'trackpad') || 'auto')
  const [detectado, setDetectado] = useState<'mouse' | 'trackpad'>('trackpad')
  const espacio = useRef(false)
  const sistema = pagina?.tipo === 'sistema'
  const importada = pagina?.origen === 'importado'

  // comentarios abiertos de la página (pines)
  useEffect(() => {
    if (!pagina || sistema) return
    let vivo = true
    const cargar = () =>
      apiDiseno
        .comentarios(prefijo)
        .then((cs) => vivo && setPines(cs.filter((c) => !c.resuelto && !c.respuestaA && c.objetivo.startsWith('marco:'))))
        .catch(() => {})
    cargar()
    const f = () => cargar()
    window.addEventListener('telar:diseno-comentarios', f)
    return () => {
      vivo = false
      window.removeEventListener('telar:diseno-comentarios', f)
    }
  }, [pagina, prefijo, sistema, marcos])

  // tienda → nodos
  useEffect(() => {
    if (!pagina) return setNodos([])
    if (sistema) {
      setNodos(nodosDeSistema(pagina, items, resumen))
      return
    }
    const porMarco = new Map<string, ComentarioDiseno[]>()
    for (const c of pines) {
      const id = c.objetivo.slice(6).split('#')[0]!
      if (!porMarco.has(id)) porMarco.set(id, [])
      porMarco.get(id)!.push(c)
    }
    setNodos((previos) => {
      const ya = new Map(previos.map((n) => [n.id, n]))
      const r: Nodo[] = []
      const vistas = new Set<string>()
      for (const m of marcos) {
        const p = ya.get(m.id) as NodoMarco | undefined
        const propio = m.origen === 'propio'
        r.push({
          id: m.id,
          type: 'marco',
          position: p?.dragging ? p.position : { x: m.x, y: m.y },
          data: { marco: m, prefijo, pines: porMarco.get(m.id) ?? [] },
          width: m.ancho,
          height: m.alto,
          draggable: propio && !m.bloqueado,
          dragHandle: '.dz-marco__nombre',
          selectable: false,
          dragging: p?.dragging,
        })
        const s = m.seccion
        if (s && !vistas.has(s)) {
          vistas.add(s)
          const primero = marcos.filter((x) => x.seccion === s).reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a))
          r.push({ id: `sec:${s}`, type: 'seccion', position: { x: primero.x, y: primero.y }, data: { titulo: s }, draggable: false, selectable: false, width: 1200, height: 1 })
        }
      }
      return r
    })
  }, [pagina, marcos, sistema, items, resumen, prefijo, pines])

  const onNodesChange: OnNodesChange<Nodo> = useCallback((cambios) => setNodos((ns) => cambios.applyTo(ns)), [])

  // ── encuadres ──
  const encuadrar = useCallback(
    (rect: { x: number; y: number; ancho: number; alto: number } | null, o: { relleno?: number; max?: number; duracion?: number } = {}) => {
      const c = contenedor.current?.getBoundingClientRect()
      if (!rect || !c) return
      const util = { w: c.width - 32, h: c.height - 140 }
      const zoom = Math.min(o.max ?? 1, Math.min(util.w / rect.ancho, util.h / rect.alto) * (1 - (o.relleno ?? 0.08)))
      const x = c.width / 2 - (rect.x + rect.ancho / 2) * zoom
      const y = (c.height - 140) / 2 + 56 - (rect.y + rect.alto / 2) * zoom
      void rf.setViewport({ x, y, zoom: Math.max(0.02, zoom) }, { duration: o.duracion ?? 420 })
    },
    [rf],
  )
  const verTodo = useCallback(
    (duracion = 420) => {
      const ns = rf.getNodes()
      encuadrar(limitesDe(ns.map((n) => ({ x: n.position.x, y: n.position.y, ancho: n.width ?? 100, alto: n.height ?? 100 }))), { relleno: 0.06, max: 1, duracion })
    },
    [rf, encuadrar],
  )
  /** Un ítem de una página de sistema: la muestra (si está dibujada) o la sección que la tiene. */
  const encuadrarItem = useCallback(
    (item: string, duracion = 420) => {
      const n = rf.getNodes().find((x) => x.type === 'marcoSistema' && (x.data as NodoSistema['data']).items.some((i) => `${i.tipo}:${i.clave}` === item))
      if (!n) return false
      const el = contenedor.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(item)}"]`)
      const c = contenedor.current?.getBoundingClientRect()
      const vp = rf.getViewport()
      if (el && c) {
        const r = el.getBoundingClientRect()
        const x = (r.left - c.left - vp.x) / vp.zoom
        const y = (r.top - c.top - vp.y) / vp.zoom
        encuadrar({ x: x - 200, y: y - 160, ancho: r.width / vp.zoom + 400, alto: r.height / vp.zoom + 320 }, { max: 1.5, duracion })
        return true
      }
      // la sección, al ancho de la columna y desde su borde de arriba
      const ancho = n.width ?? 1480
      encuadrar({ x: n.position.x, y: n.position.y, ancho, alto: Math.min(n.height ?? 600, ancho * 0.6) }, { max: 1, duracion })
      return true
    },
    [rf, encuadrar],
  )
  /** Páginas de sistema: al ancho de la columna, desde arriba (se leen como un documento). */
  const verArriba = useCallback(
    (duracion = 420) => {
      const c = contenedor.current?.getBoundingClientRect()
      const ns = rf.getNodes()
      if (!c || !ns.length) return
      const l = limitesDe(ns.map((n) => ({ x: n.position.x, y: n.position.y, ancho: n.width ?? 100, alto: n.height ?? 100 })))
      if (!l) return
      const zoom = Math.max(0.02, Math.min(1, (c.width - 72) / l.ancho))
      void rf.setViewport({ x: (c.width - l.ancho * zoom) / 2 - l.x * zoom, y: 64 - l.y * zoom, zoom }, { duration: duracion })
    },
    [rf],
  )
  const verSeleccion = useCallback(() => {
    const s = useDiseno.getState()
    const m = s.marcos.find((x) => x.id === s.seleccion.marco)
    if (!m) return verTodo()
    if (s.seleccion.capa) {
      const el = elementoDeCapa(m.id, s.seleccion.capa)
      if (el) {
        const r = el.getBoundingClientRect()
        return encuadrar({ x: m.x + r.x, y: m.y + r.y, ancho: r.width, alto: r.height }, { relleno: 0.3, max: 4 })
      }
    }
    encuadrar({ x: m.x, y: m.y - 30, ancho: m.ancho, alto: m.alto + 30 }, { relleno: 0.06, max: 2 })
  }, [encuadrar, verTodo])

  // al cambiar de página: ver todo (o lo guardado)
  const paginaLista = useRef<string | null>(null)
  const cargandoItems = useDiseno((s) => s.cargandoItems)
  useEffect(() => {
    if (!pagina || !nodos.length || paginaLista.current === pagina.id) return
    // en una página de sistema se espera a que lleguen todos sus ítems (si no, "ver todo" encuadra la primera sección)
    if (sistema && (pagina.datos.tipos ?? []).some((t) => cargandoItems[t] || !items[t])) return
    paginaLista.current = pagina.id
    reiniciarVivos()
    const guardada = localStorage.getItem(`telar.diseno.vista.${pagina.id}`)
    const sel = useDiseno.getState().seleccion
    if (sel.marco) requestAnimationFrame(() => verSeleccion())
    else if (sel.item && sistema) requestAnimationFrame(() => encuadrarItem(sel.item!, 0) || verArriba(0))
    else if (guardada) {
      try {
        void rf.setViewport(JSON.parse(guardada) as Viewport, { duration: 0 })
      } catch {
        verTodo(0)
      }
    } else requestAnimationFrame(() => (sistema ? verArriba(0) : verTodo(0)))
    setTimeout(() => calcularVivos(), 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, nodos.length, cargandoItems, items])

  // ── qué marcos viven ──
  const quieto = useRef<ReturnType<typeof setTimeout> | null>(null)
  const calcularVivos = useCallback(() => {
    const c = contenedor.current?.getBoundingClientRect()
    if (!c || sistema) return
    const s = useDiseno.getState()
    const fijos = [s.seleccion.marco, s.probando, s.editandoTexto?.marco, ...s.seleccion.marcos].filter((x): x is string => Boolean(x))
    recalcularVivos({ marcos: s.marcos, vista: rf.getViewport(), ancho: c.width, alto: c.height, fijos, sobre: s.sobre?.marco ?? null })
  }, [rf, sistema])
  useEffect(() => {
    calcularVivos()
  }, [marcos, calcularVivos])
  useEffect(() => useDiseno.subscribe((s, a) => (s.seleccion !== a.seleccion || s.probando !== a.probando ? calcularVivos() : undefined)), [calcularVivos])

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
      if (pagina) localStorage.setItem(`telar.diseno.vista.${pagina.id}`, JSON.stringify(vp))
    },
  })

  // ── puntero: qué hay debajo ──
  const local = (clientX: number, clientY: number, m: MarcoResumen) => {
    const c = contenedor.current!.getBoundingClientRect()
    const vp = rf.getViewport()
    return { x: (clientX - c.left - vp.x) / vp.zoom - m.x, y: (clientY - c.top - vp.y) / vp.zoom - m.y }
  }
  const marcoEn = (clientX: number, clientY: number): MarcoResumen | null => {
    const c = contenedor.current?.getBoundingClientRect()
    if (!c) return null
    const vp = rf.getViewport()
    const fx = (clientX - c.left - vp.x) / vp.zoom
    const fy = (clientY - c.top - vp.y) / vp.zoom
    const ms = useDiseno.getState().marcos
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i]!
      if (fx >= m.x && fx <= m.x + m.ancho && fy >= m.y && fy <= m.y + m.alto) return m
    }
    return null
  }
  const cuadroPuntero = useRef<number | null>(null)
  const ultimoPuntero = useRef<{ x: number; y: number; ctrl: boolean } | null>(null)
  const alMoverPuntero = (e: React.PointerEvent) => {
    ultimoPuntero.current = { x: e.clientX, y: e.clientY, ctrl: e.metaKey || e.ctrlKey }
    if (cuadroPuntero.current) return
    cuadroPuntero.current = requestAnimationFrame(() => {
      cuadroPuntero.current = null
      const p = ultimoPuntero.current
      const s = useDiseno.getState()
      if (!p || sistema || s.editandoTexto || s.probando) return
      const m = marcoEn(p.x, p.y)
      if (!m) return s.setSobre(null)
      if (s.seleccion.marco !== m.id) return s.setSobre({ marco: m.id, capa: null })
      const l = local(p.x, p.y, m)
      const capa = capaParaClic(m.id, l.x, l.y, s.seleccion.capa, p.ctrl || s.midiendo)
      s.setSobre({ marco: m.id, capa })
    })
  }

  // ── clics ──
  const alClic = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.dz-pin, .react-flow__resize-control, .dz-manijas, .dz-marco-nuevo, .dz-composer')) return
    const s = useDiseno.getState()
    if (s.editandoTexto) return
    if (sistema) {
      const el = (document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]).find((x) => x.dataset.item)
      s.seleccionar({ item: el?.dataset.item ?? null, marco: null, capa: null })
      return
    }
    const m = marcoEn(e.clientX, e.clientY)
    const c = contenedor.current!.getBoundingClientRect()
    const vp = rf.getViewport()
    // herramientas de creación
    if (s.herramienta === 'marco') {
      const mn = s.marcoNuevo
      if (!mn) return setVentanaMarco(true)
      if (importada || !pagina) return avisar({ texto: 'Esta página viene del código: creá una página propia para diseñar.' })
      const x = Math.round((e.clientX - c.left - vp.x) / vp.zoom)
      const y = Math.round((e.clientY - c.top - vp.y) / vp.zoom)
      try {
        const r = await apiDiseno.crearMarco(prefijo, { pagina: pagina.id, nombre: mn.nombre, tamano: mn.prefijado === 'a-medida' ? { ancho: mn.ancho, alto: mn.alto } : mn.prefijado, x, y, html: '' })
        s.set({ herramienta: 'seleccionar', marcoNuevo: null })
        await s.recargarPagina()
        s.seleccionar({ marco: r.marco.id, capa: null })
      } catch (err) {
        avisarError(err)
      }
      return
    }
    if (!m) {
      if (!e.shiftKey) s.seleccionar({ marco: null, capa: null, marcos: [] })
      return
    }
    const l = local(e.clientX, e.clientY, m)
    if (s.herramienta === 'comentar') {
      const capa = capaEn(m.id, l.x, l.y)?.getAttribute('data-id') ?? null
      setComposer({ marco: m.id, capa, x: Math.round(l.x), y: Math.round(l.y), sx: e.clientX - c.left, sy: e.clientY - c.top })
      return
    }
    if (s.herramienta === 'texto' || s.herramienta === 'imagen' || s.herramienta === 'caja') {
      if (m.origen !== 'propio') return avisar({ texto: 'Este marco viene del código: hacé una copia editable para insertar cosas.' })
      await insertarEnMarco(m.id, s.herramienta, l.x, l.y)
      s.setHerramienta('seleccionar')
      return
    }
    // seleccionar
    if (e.shiftKey) {
      const ya = s.seleccion.marcos.includes(m.id)
      const lista = ya ? s.seleccion.marcos.filter((x) => x !== m.id) : [...s.seleccion.marcos, m.id]
      s.seleccionar({ marco: lista[lista.length - 1] ?? null, capa: null, marcos: lista })
      return
    }
    if (s.seleccion.marco !== m.id && !(e.metaKey || e.ctrlKey)) return s.seleccionar({ marco: m.id, capa: null })
    const capa = capaParaClic(m.id, l.x, l.y, s.seleccion.marco === m.id ? s.seleccion.capa : null, e.metaKey || e.ctrlKey)
    s.seleccionar({ marco: m.id, capa })
  }

  const alDobleClic = (e: React.MouseEvent) => {
    const s = useDiseno.getState()
    if (sistema || s.herramienta !== 'seleccionar') return
    const m = marcoEn(e.clientX, e.clientY)
    if (!m) return
    const l = local(e.clientX, e.clientY, m)
    const capa = capaParaDobleClic(m.id, l.x, l.y, s.seleccion.marco === m.id ? s.seleccion.capa : null)
    if (!capa) return
    const el = elementoDeCapa(m.id, capa)
    // doble clic sobre un texto de un marco propio: se edita en el lugar
    if (el && m.origen === 'propio' && esTexto(el) && (s.seleccion.capa === capa || capaEn(m.id, l.x, l.y) === el)) {
      s.seleccionar({ marco: m.id, capa })
      empezarEdicionTexto(m.id, capa)
      return
    }
    s.seleccionar({ marco: m.id, capa })
  }

  // ── teclado ──
  useEffect(() => {
    const s = () => useDiseno.getState()
    const una = (fn: (e: KeyboardEvent) => void) => (e: KeyboardEvent) => {
      if (escribiendo(e) || s().editandoTexto) return
      fn(e)
    }
    const moverSel = (dx: number, dy: number) => {
      const { marco, capa } = s().seleccion
      const m = s().marcos.find((x) => x.id === marco)
      if (!m || m.origen !== 'propio' || m.bloqueado) return
      if (!capa) return void s().moverMarco(m.id, m.x + dx, m.y + dy)
      const el = elementoDeCapa(m.id, capa)
      if (!el) return
      const cs = el.ownerDocument.defaultView!.getComputedStyle(el)
      if (cs.position !== 'absolute') return avisar({ texto: 'A esta capa la acomoda su contenedor: cambiá sus medidas en el inspector o editá el CSS.' })
      const left = Math.round((parseFloat(cs.left) || 0) + dx)
      const top = Math.round((parseFloat(cs.top) || 0) + dy)
      el.style.left = `${left}px`
      el.style.top = `${top}px`
      void s().editar(m.id, [{ op: 'estilo', capa, estilos: { left: `${left}px`, top: `${top}px` } }], { etiqueta: 'mover la capa' })
    }
    const nivel = (fn: (el: HTMLElement, doc: Document) => HTMLElement | null | undefined) => {
      const { marco, capa } = s().seleccion
      if (!marco) return
      const doc = documentoDe(marco)
      if (!doc) return
      if (!capa) {
        const primero = hijosCapa(doc)[0]
        if (primero) s().seleccionar({ marco, capa: primero.getAttribute('data-id') })
        return
      }
      const el = elementoDeCapa(marco, capa)
      if (!el) return
      const otro = fn(el, doc)
      if (otro !== undefined) s().seleccionar({ marco, capa: otro?.getAttribute('data-id') ?? null })
    }
    const hermano = (paso: number) => (el: HTMLElement, doc: Document) => {
      const padre = padreCapa(el)
      const lista = padre ? hijosCapa(padre) : hijosCapa(doc)
      const i = lista.indexOf(el)
      return lista[(i + paso + lista.length) % lista.length]
    }
    return tinykeys(window, {
      KeyV: una(() => s().setHerramienta('seleccionar')),
      KeyH: una(() => s().setHerramienta('mano')),
      KeyF: una(() => (importada ? avisar({ texto: 'Esta página viene del código: creá una página propia para diseñar.' }) : setVentanaMarco(true))),
      KeyT: una(() => !importada && s().setHerramienta('texto')),
      KeyI: una(() => !importada && s().setHerramienta('imagen')),
      KeyR: una(() => !importada && s().setHerramienta('caja')),
      KeyC: una(() => s().setHerramienta('comentar')),
      KeyP: una(() => alternarProbar()),
      'Shift+KeyM': una(() => s().set({ reglaFija: !s().reglaFija })),
      KeyM: una((e) => {
        if (e.shiftKey) return
        setMinimapa((v) => {
          localStorage.setItem('telar.diseno.minimapa', v ? 'no' : 'si')
          return !v
        })
      }),
      'Shift+Digit1': una(() => verTodo()),
      'Shift+!': una(() => verTodo()),
      'Shift+Digit2': una(() => verSeleccion()),
      'Shift+@': una(() => verSeleccion()),
      'Shift+Digit0': una(() => void rf.zoomTo(1, { duration: 240 })),
      'Shift+=': una(() => void rf.zoomTo(1, { duration: 240 })),
      Equal: una(() => void rf.zoomIn({ duration: 160 })),
      Minus: una(() => void rf.zoomOut({ duration: 160 })),
      KeyN: una((e) => {
        const ms = [...s().marcos].sort((a, b) => a.y - b.y || a.x - b.x)
        if (!ms.length) return
        const i = ms.findIndex((m) => m.id === s().seleccion.marco)
        const sig = ms[(i + (e.shiftKey ? -1 : 1) + ms.length) % ms.length]!
        s().seleccionar({ marco: sig.id, capa: null })
        encuadrar({ x: sig.x, y: sig.y - 30, ancho: sig.ancho, alto: sig.alto + 30 }, { relleno: 0.06, max: 2 })
      }),
      Enter: una((e) => {
        if (e.shiftKey) return nivel((el) => padreCapa(el))
        nivel((el) => hijosCapa(el)[0])
      }),
      'Shift+Enter': una(() => nivel((el) => padreCapa(el))),
      Tab: una((e) => {
        if (!s().seleccion.marco) return
        e.preventDefault()
        nivel(hermano(e.shiftKey ? -1 : 1))
      }),
      Escape: (e) => {
        const st = s()
        if (st.editandoTexto) return
        if (composer) return setComposer(null)
        if (ventanaMarco) return setVentanaMarco(false)
        if (st.probando) return st.set({ probando: null })
        if (st.reglaFija) return st.set({ reglaFija: false })
        if (st.herramienta !== 'seleccionar') return st.set({ herramienta: 'seleccionar', marcoNuevo: null })
        if (escribiendo(e)) return
        if (st.seleccion.capa) {
          const el = elementoDeCapa(st.seleccion.marco!, st.seleccion.capa)
          const p = el ? padreCapa(el) : null
          return st.seleccionar({ marco: st.seleccion.marco, capa: p?.getAttribute('data-id') ?? null })
        }
        if (st.seleccion.marco || st.seleccion.item) st.seleccionar({ marco: null, capa: null, item: null, marcos: [] })
      },
      ArrowLeft: una((e) => (e.preventDefault(), moverSel(e.shiftKey ? -10 : -1, 0))),
      ArrowRight: una((e) => (e.preventDefault(), moverSel(e.shiftKey ? 10 : 1, 0))),
      ArrowUp: una((e) => (e.preventDefault(), moverSel(0, e.shiftKey ? -10 : -1))),
      ArrowDown: una((e) => (e.preventDefault(), moverSel(0, e.shiftKey ? 10 : 1))),
    })
  }, [rf, verTodo, verSeleccion, encuadrar, importada, composer, ventanaMarco])

  // el ítem elegido en una página de sistema queda marcado
  useEffect(() => {
    if (!sistema) return
    const marcar = () => {
      const item = useDiseno.getState().seleccion.item
      for (const el of Array.from(contenedor.current?.querySelectorAll('.dz-elegido') ?? [])) if (el.getAttribute('data-item') !== item) el.classList.remove('dz-elegido')
      if (item) for (const el of Array.from(contenedor.current?.querySelectorAll(`[data-item="${CSS.escape(item)}"]`) ?? [])) el.classList.add('dz-elegido')
    }
    marcar()
    const t = setInterval(marcar, 500)
    const quitar = useDiseno.subscribe((s, a) => s.seleccion.item !== a.seleccion.item && marcar())
    return () => {
      clearInterval(t)
      quitar()
    }
  }, [sistema, nodos])

  // Alt: medir mientras se mantiene · Espacio: mano
  useEffect(() => {
    const abajo = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault()
        useDiseno.getState().set({ midiendo: true })
      }
      if (e.code === 'Space' && !escribiendo(e) && !espacio.current) {
        espacio.current = true
        contenedor.current?.classList.add('dz-lienzo--mano')
      }
    }
    const arriba = (e: KeyboardEvent) => {
      if (e.key === 'Alt') useDiseno.getState().set({ midiendo: false })
      if (e.code === 'Space') {
        espacio.current = false
        contenedor.current?.classList.remove('dz-lienzo--mano')
      }
    }
    const afuera = () => useDiseno.getState().set({ midiendo: false })
    window.addEventListener('keydown', abajo)
    window.addEventListener('keyup', arriba)
    window.addEventListener('blur', afuera)
    return () => {
      window.removeEventListener('keydown', abajo)
      window.removeEventListener('keyup', arriba)
      window.removeEventListener('blur', afuera)
    }
  }, [])

  // ir a un marco desde otra parte (buscador, migas, "Ver en PC")
  useEffect(() => {
    const ir = (ev: Event) => {
      const { marco, capa } = (ev as CustomEvent<{ marco: string; capa?: string }>).detail
      const m = useDiseno.getState().marcos.find((x) => x.id === marco)
      if (!m) return
      useDiseno.getState().seleccionar({ marco, capa: capa ?? null })
      encuadrar({ x: m.x, y: m.y - 30, ancho: m.ancho, alto: m.alto + 30 }, { relleno: 0.06, max: 2 })
    }
    const encuadrarSel = () => verSeleccion()
    // un ítem de una página de sistema: se encuadra la sección que lo muestra
    const irItem = (ev: Event) => encuadrarItem((ev as CustomEvent<{ item: string }>).detail.item)
    // un encuadre exacto (enlaces y capturas)
    const vista = (ev: Event) => void rf.setViewport((ev as CustomEvent<Viewport>).detail, { duration: 0 })
    window.addEventListener('telar:diseno-encuadrar', ir)
    window.addEventListener('telar:diseno-ver-seleccion', encuadrarSel)
    window.addEventListener('telar:diseno-encuadrar-item', irItem)
    window.addEventListener('telar:diseno-viewport', vista)
    return () => {
      window.removeEventListener('telar:diseno-encuadrar', ir)
      window.removeEventListener('telar:diseno-ver-seleccion', encuadrarSel)
      window.removeEventListener('telar:diseno-encuadrar-item', irItem)
      window.removeEventListener('telar:diseno-viewport', vista)
    }
  }, [encuadrar, verSeleccion, rf, encuadrarItem])

  const modo = modoRueda === 'auto' ? detectado : modoRueda
  const alRueda = (e: React.WheelEvent) => {
    if (modoRueda !== 'auto' || e.ctrlKey) return
    const pareceTrackpad = e.deltaX !== 0 || (e.deltaMode === 0 && Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY * 2))
    const pareceMouse = e.deltaX === 0 && (e.deltaMode === 1 || Math.abs(e.deltaY) >= 50)
    if (pareceTrackpad && detectado !== 'trackpad') setDetectado('trackpad')
    else if (pareceMouse && detectado !== 'mouse') setDetectado('mouse')
  }

  const mano = herramienta === 'mano'
  const creando = ['marco', 'texto', 'imagen', 'caja', 'comentar'].includes(herramienta)
  return (
    <div
      ref={contenedor}
      className={`dz-lienzo dz-lienzo--${fondo}${mano ? ' dz-lienzo--mano' : ''}${creando ? ' dz-lienzo--crear' : ''}${probando ? ' dz-lienzo--probando' : ''}`}
      onPointerMove={alMoverPuntero}
      onPointerLeave={() => useDiseno.getState().setSobre(null)}
      onClick={alClic}
      onDoubleClick={alDobleClic}
      onWheel={alRueda}
    >
      <ReactFlow<Nodo>
        nodes={nodos}
        edges={[]}
        nodeTypes={TIPOS_NODO}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_e, n) => {
          if (n.type === 'marco') void useDiseno.getState().moverMarco(n.id, Math.round(n.position.x), Math.round(n.position.y))
        }}
        nodesConnectable={false}
        elementsSelectable={false}
        selectNodesOnDrag={false}
        panOnDrag={mano || espacio.current ? true : [1, 2]}
        selectionOnDrag={false}
        panOnScroll={modo === 'trackpad'}
        zoomOnScroll={modo === 'mouse'}
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.02}
        maxZoom={8}
        onlyRenderVisibleElements
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        nodeDragThreshold={3}
        proOptions={{ hideAttribution: true }}
        noWheelClassName="dz-sin-rueda"
        noPanClassName="dz-sin-paneo"
      >
        {minimapa && !sistema && <MiniMap pannable zoomable position="bottom-right" className="dz-minimapa" nodeColor={(n: Node) => (n.type === 'marco' ? 'var(--dz-minimapa-marco)' : 'transparent')} />}
      </ReactFlow>
      <CapaSeleccion contenedor={contenedor} />
      <div className="dz-flotantes">
        <Migas />
        <FondoYModo />
        <Herramientas importada={importada || sistema} alMarcoNuevo={() => setVentanaMarco((v) => !v)} />
        <Zoom
          alVerTodo={() => verTodo()}
          alVerSeleccion={verSeleccion}
          minimapa={minimapa}
          alMinimapa={() =>
            setMinimapa((v) => {
              localStorage.setItem('telar.diseno.minimapa', v ? 'no' : 'si')
              return !v
            })
          }
        />
        {probando && <div className="dz-cartel dz-cartel--probar">Probando · Esc para salir</div>}
        {reglaFija && <div className="dz-cartel dz-cartel--regla">Regla fija · pasá por las capas · Esc para salir</div>}
        {herramienta === 'marco' && marcoNuevo && (
          <div className="dz-cartel">
            {marcoNuevo.nombre} · {marcoNuevo.ancho} × {marcoNuevo.alto} — hacé clic donde va
          </div>
        )}
      </div>
      <AnimatePresence>{ventanaMarco && <MarcoNuevo alCerrar={() => setVentanaMarco(false)} />}</AnimatePresence>
      {composer && (
        <ComposerComentario
          x={composer.sx}
          y={composer.sy}
          alCerrar={() => setComposer(null)}
          alPublicar={async (texto) => {
            try {
              await apiDiseno.comentar(prefijo, { en: `marco:${composer.marco}${composer.capa ? '#' + composer.capa : ''}`, texto, punto: { x: composer.x, y: composer.y } })
              setComposer(null)
              useDiseno.getState().setHerramienta('seleccionar')
              window.dispatchEvent(new Event('telar:diseno-comentarios'))
            } catch (err) {
              avisarError(err)
            }
          }}
        />
      )}
    </div>
  )
}
