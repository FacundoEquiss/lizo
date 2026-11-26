// El lienzo: orquesta React Flow, los paneles y la selección. Los objetos están en nodos/, las acciones en
// acciones.ts, los atajos en atajos.ts y los conectores en conectores/.
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  ViewportPortal,
  type Connection,
  type OnEdgesChange,
  type OnNodeDrag,
  type OnNodesChange,
  type Viewport,
} from '@xyflow/react'
import { Search, SquareKanban } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { analizarEnlace, esUrl } from '../../../../compartido/enlaces'
import { leerAjustesLienzo, leerForma, leerMarco, leerNota, TAMANOS } from '../../../../compartido/lienzo'
import type { ElementoLienzo, Lado } from '../../../../compartido/tipos'
import { api } from '../../estado/api'
import { avisar, avisarError } from '../../estado/avisos'
import { FOTO, MARGEN_FOTO } from '../../estado/foto'
import { enUnPaso } from '../../estado/deshacer'
import { usePreferencias } from '../../estado/preferencias'
import { type Herramienta, idLocal, useTienda } from '../../estado/tienda'
import { escribiendo } from '../../util/teclas'
import {
  avisarNoSeDuplican,
  cajaNodo,
  ContextoLienzo,
  ContextoNivel,
  crearAcciones,
  ENCUADRES,
  ladoHaciaOrigen,
  MAX_ZOOM,
  MIN_ZOOM,
  type ContextoAcciones,
  type NivelDetalle,
  type OpcionCrear,
} from './acciones'
import { useAtajosLienzo } from './atajos'
import { BarraContextual } from './barra/BarraContextual'
import { crearConTeclado, datosNuevos, useCrearConPuntero } from './crear'
import { Arista } from './conectores/Arista'
import { marcarDestino, nodoBajoPuntero } from './conectores/destino'
import { LineaEnCurso } from './conectores/LineaEnCurso'
import { MenuCrearConectado } from './paneles/MenuCrearConectado'
import { useLienzo, type ConexionPendiente } from './estado'
import { precargarEditor } from './texto/CajaTexto'
import { iniciarEdicion } from './texto/editorActivo'
import { cargarFuentesDe } from './texto/fuentes'
import { escribirZoom } from './zoomCss'
import { tieneVista } from '../../../../compartido/vistas'
import { useAlCambiarVista } from './alCambiarVista'
import { esperarFoto } from './fotoLienzo'
import { TIPOS_NODO } from './nodos'
import { Buscador } from './paneles/Buscador'
import { ComposerTarjeta } from './paneles/ComposerTarjeta'
import { AvisoHerramienta } from './paneles/AvisoHerramienta'
import { Controles } from './paneles/Controles'
import { BarraHerramientas, elegirHerramienta } from './paneles/Herramientas'
import { LienzoVacio } from './paneles/LienzoVacio'
import { MenuContextual } from './paneles/MenuContextual'
import { PanelMarcos } from './paneles/PanelMarcos'
import { aTexto, deTexto, leerDelSistema, recorteEnMemoria } from './portapapeles'
import { PanelTarjetas } from './paneles/PanelTarjetas'
import type { AristaConector, InterfazLienzo, NodoLienzo } from './tipos'
import { limites } from '../../../../compartido/geometria'
import { fuenteSugerida } from '../../../../compartido/grafico'
import { armarTabla, esGrilla, leerTabla, medidaTabla, tablaDesdeTexto } from '../../../../compartido/tabla'
import { duracion } from '../../util/movimiento'

// Los editores de tablas y gráficos se bajan recién cuando se abren.
const DialogoTabla = lazy(() => import('./tabla/DialogoTabla'))
const DialogoGrafico = lazy(() => import('./grafico/DialogoGrafico'))

export type { InterfazLienzo } from './tipos'
export { useAccionesLienzo } from './acciones'

const TIPOS_ARISTA = { conector: Arista }
const INTERFAZ_COMPLETA: Required<InterfazLienzo> = {
  herramientas: true,
  aviso: true,
  controles: true,
  paneles: true,
  barraContextual: true,
  minimapa: true,
  menuConectar: true,
  buscador: true,
  barraContextualAbajo: false,
}

/** La foto del lienzo (ver_lienzo): solo los objetos, sin barras, paneles ni minimapa. */
const INTERFAZ_FOTO: Required<InterfazLienzo> = {
  herramientas: false,
  aviso: false,
  controles: false,
  paneles: false,
  barraContextual: false,
  minimapa: false,
  menuConectar: false,
  buscador: false,
  barraContextualAbajo: false,
}

/**
 * La vista con la que se ve todo al abrir un tablero sin vista guardada (más o menos la de verTodo, con la ventana en
 * vez del lienzo, que todavía no se midió). El primer cuadro ya sale con ese zoom y su nivel de detalle (9.4): con mil
 * objetos, empezar al 100 % y después alejar dibujaba (y medía) todo dos veces.
 */
function vistaParaVerTodo(elementos: readonly ElementoLienzo[]): Viewport | null {
  if (!elementos.length) return null
  const r = limites(elementos.map((e) => ({ x: e.x, y: e.y, ancho: e.ancho, alto: e.alto })))!
  const W = Math.max(320, window.innerWidth - 248)
  const H = Math.max(240, window.innerHeight - 56)
  const util = { x: 16, y: 68, w: W - 32, h: H - 160 }
  const zoom = Math.max(MIN_ZOOM, Math.min(1, Math.min(util.w / Math.max(1, r.ancho), util.h / Math.max(1, r.alto)) * (1 - ENCUADRES.todo.relleno)))
  return { x: util.x + (util.w - r.ancho * zoom) / 2 - r.x * zoom, y: util.y + (util.h - r.alto * zoom) / 2 - r.y * zoom, zoom }
}

/** Nodo de React Flow para un objeto. Si el objeto no cambió (misma referencia), se reusa el nodo: no se redibuja. */
/** Clases del nodo de React Flow: tipo, bloqueado, ancho automático y la animación de entrada o salida (9.1). */
function claseNodo(e: ElementoLienzo, nuevos: ReadonlyMap<string, 'aca' | 'remoto'>, saliendo: ReadonlySet<string>) {
  const animacion = saliendo.has(e.id) ? ' rf-saliendo' : nuevos.get(e.id) === 'aca' ? ' rf-nuevo' : nuevos.has(e.id) ? ' rf-nuevo-remoto' : ''
  return `rf-${e.tipo}${e.bloqueado ? ' rf-bloqueado' : ''}${e.tipo === 'texto' && e.datos.anchoAuto === true ? ' rf-texto-auto' : ''}${animacion}`
}

/**
 * Una nota o una forma que React Flow todavía no midió: sus puntos de conexión aproximados (el medio de cada lado, con la
 * medida guardada) y esa medida como provisoria. Sin esto React Flow dibuja TODOS los objetos al abrir el lienzo, aunque
 * estén fuera de la pantalla, solo para medir sus puntos (en RC, 682 objetos para mostrar 119; cada nota además mide su
 * letra automática). Con los puntos aproximados, lo que está afuera se dibuja recién cuando entra a la pantalla, y ahí se
 * mide de verdad (alCambiarNodos saca lo aproximado). Las tarjetas y los textos sí se dibujan al abrir: su alto real se
 * guarda (ver alCambiarNodos), y los marcos no tienen puntos.
 */
function sinDibujar(e: ElementoLienzo): Partial<NodoLienzo> {
  if (e.tipo !== 'nota' && e.tipo !== 'forma') return {}
  const w = e.ancho
  const h = e.alto
  const punto = (id: Lado, position: Position, x: number, y: number) => ({ id, type: 'source' as const, position, x, y, width: 1, height: 1 })
  return {
    initialWidth: w,
    initialHeight: h,
    handles: [
      punto('arriba', Position.Top, w / 2, 0),
      punto('derecha', Position.Right, w, h / 2),
      punto('abajo', Position.Bottom, w / 2, h),
      punto('izquierda', Position.Left, 0, h / 2),
    ],
  }
}

function aNodo(e: ElementoLienzo, previo: NodoLienzo | undefined, clase: string): NodoLienzo {
  if (previo && previo.data.elemento === e && previo.className === clase) return previo
  // La nota y la forma crecen hacia abajo si su texto no entra (tamaño de letra manual): su alto lo da el contenido,
  // con el guardado como mínimo.
  const altoAuto = e.tipo === 'tarjeta' || e.tipo === 'texto' || e.tipo === 'nota' || e.tipo === 'forma'
  return {
    id: e.id,
    type: e.tipo,
    position: { x: e.x, y: e.y },
    data: { elemento: e },
    // La medida que ya tenía. Sin ella React Flow toma el nodo nuevo por "sin medir" y lo esconde (visibility: hidden)
    // hasta volver a medirlo: un cuadro que no se ve, pero que le saca el foco al texto que se está escribiendo (y en el
    // teléfono cierra el teclado). Pasaba cada vez que el objeto cambiaba mientras se escribía: al terminar la animación
    // de "recién creado", cuando el servidor contesta que lo guardó, o si la IA lo toca. Si el tamaño cambió, React Flow
    // lo vuelve a medir igual.
    ...(previo?.measured ? { measured: previo.measured } : sinDibujar(e)),
    selected: previo?.selected ?? false,
    draggable: !e.bloqueado,
    width: e.tipo === 'texto' && e.datos.anchoAuto === true ? undefined : e.ancho,
    height: altoAuto ? undefined : e.alto,
    // Los marcos siempre van debajo; el resto, por su capa (z nunca es negativo).
    zIndex: e.tipo === 'marco' ? 0 : 2 + e.z,
    dragHandle: e.tipo === 'marco' ? '.marco__titulo, .marco__borde' : e.tipo === 'lista' ? '.nodo-lista__cabecera' : e.tipo === 'figma' ? '.figma-nodo__cabecera' : undefined,
    className: clase,
    // El nombre para el lector de pantalla lo escribe cada objeto adentro (Rotulo): "Nota: …", "Marco Mecánicas, 8 objetos".
    // Fuera del orden de Tab de la página: Tab los recorre en orden de lectura (atajos.ts), y el foco se pone a mano.
    domAttributes: { 'aria-labelledby': `rotulo-${e.id}`, tabIndex: -1 },
  }
}

/**
 * Guías de alineación: si un borde o el centro queda a pocos píxeles de otro objeto, se engancha. Con `soloExactas` (el
 * imán a la grilla prendido) solo se dibujan las guías de lo que ya quedó alineado, sin corregir la posición.
 */
function enganchar(n: NodoLienzo, pos: { x: number; y: number }, otros: NodoLienzo[], zoom: number, soloExactas = false) {
  const { w, h } = cajaNodo(n)
  const umbral = soloExactas ? 0.5 : 6 / zoom
  const xs = [pos.x, pos.x + w / 2, pos.x + w]
  const ys = [pos.y, pos.y + h / 2, pos.y + h]
  let mejorX: { d: number; ajuste: number; linea: number } | null = null
  let mejorY: { d: number; ajuste: number; linea: number } | null = null
  for (const o of otros) {
    const b = cajaNodo(o)
    const oxs = [b.x, b.x + b.w / 2, b.x + b.w]
    const oys = [b.y, b.y + b.h / 2, b.y + b.h]
    for (let i = 0; i < 3; i++)
      for (const ox of oxs) {
        const d = Math.abs(xs[i]! - ox)
        if (d < umbral && (!mejorX || d < mejorX.d)) mejorX = { d, ajuste: ox - xs[i]!, linea: ox }
      }
    for (let i = 0; i < 3; i++)
      for (const oy of oys) {
        const d = Math.abs(ys[i]! - oy)
        if (d < umbral && (!mejorY || d < mejorY.d)) mejorY = { d, ajuste: oy - ys[i]!, linea: oy }
      }
  }
  return {
    pos: soloExactas ? pos : { x: pos.x + (mejorX?.ajuste ?? 0), y: pos.y + (mejorY?.ajuste ?? 0) },
    guias: { v: mejorX ? [mejorX.linea] : [], h: mejorY ? [mejorY.linea] : [] },
  }
}

// Colores del minimapa: un mapa por tema (no se llama a getComputedStyle por nodo y por render).
const coloresMinimapa = new Map<string, Map<string, string>>()
function colorToken(nombre: string) {
  const tema = document.documentElement.dataset.theme ?? 'light'
  let m = coloresMinimapa.get(tema)
  if (!m) coloresMinimapa.set(tema, (m = new Map()))
  let c = m.get(nombre)
  if (!c) {
    c = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || '#ccc'
    m.set(nombre, c)
  }
  return c
}
function colorMinimapa(n: NodoLienzo) {
  const e = n.data.elemento
  switch (e.tipo) {
    case 'nota':
      return colorToken(`--n-${leerNota(e.datos).color}`)
    case 'marco':
      return colorToken(`--m-${leerMarco(e.datos).color}`)
    case 'forma': {
      const f = leerForma(e.datos)
      return f.relleno === 'ninguno' ? 'transparent' : colorToken(f.tono === 'fuerte' ? `--e-${f.relleno}-s` : `--e-${f.relleno}`)
    }
    case 'texto':
      return 'transparent'
    default:
      return colorToken('--c-superficie')
  }
}

export default function Lienzo({ interfaz, capa }: { interfaz?: InterfazLienzo; capa?: ReactNode }) {
  return (
    <ReactFlowProvider>
      <LienzoInterno interfaz={FOTO ? INTERFAZ_FOTO : { ...INTERFAZ_COMPLETA, ...interfaz }} capa={capa} />
    </ReactFlowProvider>
  )
}

/**
 * Una función con identidad fija que llama a la última versión de `fn`. Las funciones de los objetos y conectores (clic,
 * doble clic) React Flow se las pasa a cada envoltorio de objeto: si cambian en cada dibujo del lienzo, se vuelven a
 * dibujar los envoltorios de todos los objetos (en un arrastre, en cada cuadro).
 */
function useFija<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ultima = useRef(fn)
  ultima.current = fn
  return useCallback((...a: A) => ultima.current(...a), [])
}

/** Coordenadas de pantalla de un evento de mouse o táctil. */
function coordenadas(e: MouseEvent | TouchEvent | null | undefined): { x: number; y: number } | null {
  if (!e) return null
  if ('changedTouches' in e) {
    const t = e.changedTouches[0] ?? e.touches[0]
    return t ? { x: t.clientX, y: t.clientY } : null
  }
  return { x: e.clientX, y: e.clientY }
}

/** El menú "Crear y conectar" en el punto donde se soltó el conector (coordenadas de pantalla del contenedor). */
function MenuConexion({ pendiente, alElegir, alCerrar }: { pendiente: ConexionPendiente; alElegir: (o: OpcionCrear) => void; alCerrar: () => void }) {
  const rf = useReactFlow<NodoLienzo, AristaConector>()
  const origen = useTienda((s) => s.tablero?.elementos.find((e) => e.id === pendiente.desdeId))
  const [punto, setPunto] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const p = rf.flowToScreenPosition(pendiente.punto)
    const r = document.querySelector('.lienzo')?.getBoundingClientRect()
    setPunto({ x: p.x - (r?.left ?? 0), y: p.y - (r?.top ?? 0) })
  }, [rf, pendiente])
  if (!origen || !punto) return null
  return <MenuCrearConectado punto={punto} origen={origen} alElegir={alElegir} alCerrar={alCerrar} />
}

function LienzoInterno({ interfaz, capa }: { interfaz: Required<InterfazLienzo>; capa?: ReactNode }) {
  const tablero = useTienda((s) => s.tablero)!
  const herramienta = useTienda((s) => s.herramienta)
  const minimapa = useTienda((s) => s.minimapa)
  const grilla = useTienda((s) => s.grilla)
  const editando = useTienda((s) => s.editando)
  const rueda = usePreferencias((s) => s.rueda)
  // Ajustes del lienzo de este tablero (fondo, grilla e imanes): se guardan en el tablero, iguales en todos los dispositivos.
  const ajustes = useMemo(() => leerAjustesLienzo(tablero.tablero.ajustes), [tablero.tablero.ajustes])
  const [sinImanes, setSinImanes] = useState(false)
  const imanesRef = useRef({ objetos: true, grilla: false })
  imanesRef.current = { objetos: ajustes.imanObjetos && !sinImanes, grilla: ajustes.imanGrilla && !sinImanes }
  useEffect(() => {
    const alTecla = (e: KeyboardEvent) => setSinImanes(e.ctrlKey || e.metaKey)
    const soltar = () => setSinImanes(false)
    window.addEventListener('keydown', alTecla)
    window.addEventListener('keyup', alTecla)
    window.addEventListener('blur', soltar)
    return () => {
      window.removeEventListener('keydown', alTecla)
      window.removeEventListener('keyup', alTecla)
      window.removeEventListener('blur', soltar)
    }
  }, [])
  const panelTarjetas = useLienzo((s) => s.panelTarjetas)
  const conKanban = useTienda((s) => tieneVista(s.tablero?.tablero, 'kanban'))
  const subidas = useLienzo((s) => s.subidas)
  const vacio = tablero.elementos.length === 0
  const buscando = useLienzo((s) => s.buscando)
  const tablaAbierta = useLienzo((s) => s.tablaAbierta)
  const graficoAbierto = useLienzo((s) => s.graficoAbierto)
  const rf = useReactFlow<NodoLienzo, AristaConector>()

  const [nodos, setNodos] = useState<NodoLienzo[]>([])
  const [aristas, setAristas] = useState<AristaConector[]>([])
  const [guias, setGuias] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  const origenConexion = useLienzo((s) => s.origenConexion)
  const setOrigenConexion = (id: string | null) => useLienzo.getState().set({ origenConexion: id })
  // "Crear y conectar" (5.7.1): el conector soltado en el aire queda dibujado y se abre el menú.
  const conexionPendiente = useLienzo((s) => s.conexionPendiente)
  const [conexionCancelada, setConexionCancelada] = useState(false)
  const abrirConexion = (desdeId: string, desdeLado: Lado | null, punto: { x: number; y: number }) => {
    const n = rf.getNode(desdeId)
    if (!n) return
    setConexionCancelada(false)
    useLienzo.getState().set({ conexionPendiente: { desdeId, desdeLado, punto, ladoLlegada: ladoHaciaOrigen(cajaNodo(n), punto) } })
  }
  const cerrarConexion = (cancelada: boolean) => {
    setConexionCancelada(cancelada)
    useLienzo.getState().set({ conexionPendiente: null })
  }
  const [detectado, setDetectado] = useState<'mouse' | 'trackpad'>('trackpad')
  const [composer, setComposer] = useState<{ x: number; y: number; fx: number; fy: number } | null>(null)
  const menuContextual = useLienzo((s) => s.menuContextual)
  // Botón derecho: dónde se apretó (si al soltar se movió menos de 4 px, es un clic y abre el menú; si no, movió el lienzo).
  const derecho = useRef<{ x: number; y: number } | null>(null)
  // Un toque con el dedo en el fondo vacío (ver onPointerUp): dónde y cuándo empezó.
  const toqueFondo = useRef<{ id: number; x: number; y: number; t: number } | null>(null)
  const contenedor = useRef<HTMLDivElement>(null)
  const fantasma = useRef<HTMLDivElement>(null)
  const refImagen = useRef<HTMLInputElement>(null)
  const refReemplazo = useRef<HTMLInputElement>(null)
  const subirImagen = useCallback(() => refImagen.current?.click(), [])
  const puntero = useRef({ x: 0, y: 0 })
  // La caja de selección en curso: dónde empezó (lienzo) y lo que ya estaba elegido.
  const cajaSeleccion = useRef<{ desde: { x: number; y: number }; antes: Set<string> } | null>(null)
  const arrastre = useRef<{
    unico: boolean
    marcos: Map<string, { x: number; y: number }>
    hijos: Map<string, { x: number; y: number; marco: string }>
  } | null>(null)

  const antesDeZoom = useRef<((zoom: number) => void) | null>(null)
  const ctx = useMemo<ContextoAcciones>(
    () => ({ setNodos, setAristas, contenedor: () => contenedor.current, antesDeZoom: (z) => antesDeZoom.current?.(z) }),
    [],
  )
  const acciones = useMemo(() => crearAcciones(rf, ctx), [rf, ctx])

  // El editor de texto (trozo aparte) se baja en un momento libre después de abrir el lienzo; las fuentes que usan
  // los objetos, en cuanto aparecen (también las que llegan de otro lado: el MCP, otra persona).
  useEffect(() => precargarEditor(), [])
  useEffect(() => cargarFuentesDe(tablero.elementos), [tablero.elementos])

  // Crear con clic o con arrastre (y el fantasma bajo el cursor).
  const { alPunteroAbajo } = useCrearConPuntero({
    contenedor,
    fantasma,
    acciones,
    alTarjeta: (pantalla, punto) => {
      const r = contenedor.current!.getBoundingClientRect()
      setComposer({ x: pantalla.x - r.left, y: pantalla.y - r.top, fx: punto.x, fy: punto.y })
    },
  })

  const claveVista = `tablero.vista.${tablero.tablero.id}`
  const vistaGuardada = useMemo<Viewport | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(claveVista) ?? 'null')
    } catch {
      return null
    }
  }, [claveVista])

  // El nivel de detalle desde el primer dibujo (con la vista guardada): así los objetos que se montan lejos ya miden de a
  // poco (ajuste.ts). Después lo mantiene ponerZoom directo en el DOM (React no vuelve a tocar este atributo).
  // En la foto (ver_lienzo), el área pedida con su margen arriba a la izquierda.
  const [vistaInicial] = useState<Viewport | null>(() =>
    FOTO
      ? { x: MARGEN_FOTO - FOTO.x * FOTO.zoom, y: MARGEN_FOTO - FOTO.y * FOTO.zoom, zoom: FOTO.zoom }
      : (vistaGuardada ?? vistaParaVerTodo(tablero.elementos)),
  )
  const [zoomInicial] = useState<NivelDetalle | undefined>(() => {
    if (FOTO) return undefined
    const z = vistaInicial?.zoom ?? 1
    return z < 0.12 ? 'muy-lejos' : z < 0.3 ? 'lejos' : undefined
  })
  const [nivel, setNivel] = useState<NivelDetalle>(zoomInicial ?? '')

  // Tienda → nodos de React Flow (conservando la selección y lo que se está arrastrando o redimensionando).
  const nuevos = useTienda((s) => s.nuevos)
  const saliendo = useTienda((s) => s.saliendo)
  useEffect(() => {
    setNodos((prev) => {
      const previos = new Map(prev.map((n) => [n.id, n]))
      const orden = [...tablero.elementos].sort((a, b) => {
        const ma = a.tipo === 'marco' ? 0 : 1
        const mb = b.tipo === 'marco' ? 0 : 1
        if (ma !== mb) return ma - mb
        if (ma === 0) return b.ancho * b.alto - a.ancho * a.alto
        return a.z - b.z
      })
      return orden.map((e) => {
        const p = previos.get(e.id)
        if (p?.dragging || p?.resizing) return p.data.elemento === e ? p : { ...p, data: { ...p.data, elemento: e } }
        return aNodo(e, p, claseNodo(e, nuevos, saliendo))
      })
    })
  }, [tablero.elementos, nuevos, saliendo])

  useEffect(() => {
    setAristas((prev) => {
      const previas = new Map(prev.map((a) => [a.id, a]))
      return tablero.conectores.map((c) => {
        const p = previas.get(c.id)
        if (p && p.data?.conector === c) return p
        return {
          id: c.id,
          source: c.desdeId,
          target: c.hastaId,
          sourceHandle: c.desdeLado,
          targetHandle: c.hastaLado,
          type: 'conector' as const,
          data: { conector: c },
          selected: p?.selected ?? false,
          zIndex: 1,
          domAttributes: { 'aria-labelledby': `rotulo-${c.id}`, tabIndex: -1 },
        }
      })
    })
  }, [tablero.conectores])

  // La selección, para las barras y los menús que viven fuera de React Flow.
  useEffect(() => {
    useLienzo.getState().setSeleccion(
      nodos.filter((n) => n.selected).map((n) => n.id),
      aristas.filter((a) => a.selected).map((a) => a.id),
    )
  }, [nodos, aristas])

  // --z (zoom) y el nivel de detalle se escriben directo al DOM: no hacen render de React (ver zoomCss.ts).
  const ponerZoom = useCallback((zoom: number) => {
    const el = contenedor.current
    if (!el) return
    escribirZoom(zoom)
    // La foto va con todo el detalle: es para leerla (y revisarla), no para moverla.
    const nivel: NivelDetalle = FOTO ? '' : zoom < 0.12 ? 'muy-lejos' : zoom < 0.3 ? 'lejos' : ''
    if ((el.dataset.zoom ?? '') !== nivel) {
      if (nivel) el.dataset.zoom = nivel
      else delete el.dataset.zoom
    }
    setNivel(nivel)
  }, [])
  antesDeZoom.current = ponerZoom
  useAlCambiarVista((v) => ponerZoom(v.zoom))
  useEffect(() => {
    ponerZoom(rf.getZoom())
  }, [rf, ponerZoom])
  useEffect(() => (FOTO ? esperarFoto(rf) : undefined), [rf])

  // Lo que se está haciendo (arrastrar, redimensionar, mover el lienzo, conectar) también va al DOM.
  useEffect(
    () =>
      useLienzo.subscribe((s) => {
        const el = contenedor.current
        if (!el) return
        if (s.interaccion) el.dataset.interaccion = s.interaccion
        else delete el.dataset.interaccion
        if (s.conectando) el.dataset.conectando = 'si'
        else delete el.dataset.conectando
      }),
    [],
  )

  // Marca visual de la conexión en curso con la herramienta L.
  useEffect(() => {
    if (herramienta !== 'conector') setOrigenConexion(null)
  }, [herramienta])

  // Al salir del lienzo se cierran sus paneles y se suelta la selección.
  useEffect(
    () => () => {
      useLienzo.getState().set({ buscando: false, conexionPendiente: null, menuContextual: null, conectando: false })
      useLienzo.getState().setInteraccion(null)
      useLienzo.getState().setSeleccion([], [])
    },
    [],
  )

  // Ir a una tarjeta (desde "Mostrar en el lienzo") o hacer zoom a la selección (desde la paleta).
  useEffect(() => {
    const ir = (ev: Event) => {
      const tarjetaId = (ev as CustomEvent<string>).detail
      const e = useTienda.getState().tablero?.elementos.find((x) => x.tarjetaId === tarjetaId)
      if (!e) return
      setTimeout(() => {
        acciones.irA([e.id])
        acciones.seleccionar([e.id])
        useTienda.getState().destellar(tarjetaId)
      }, 60)
    }
    const zoomSel = () => acciones.zoomSeleccion()
    // Un clic en un punto de conexión: "el siguiente paso" (5.7.5). Si el origen no se duplica (una tarjeta, una
    // imagen…), se abre "Crear y conectar" a 80 px de ese lado.
    const siguiente = (ev: Event) => {
      const { id, lado } = (ev as CustomEvent<{ id: string; lado: Lado }>).detail
      if (useTienda.getState().herramienta !== 'seleccionar') return
      void acciones.siguientePaso(id, lado).then((nuevo) => {
        if (nuevo !== null) return
        const n = rf.getNode(id)
        if (!n) return
        const b = cajaNodo(n)
        const salida = { arriba: { x: 0, y: -1 }, abajo: { x: 0, y: 1 }, izquierda: { x: -1, y: 0 }, derecha: { x: 1, y: 0 } }[lado]
        const borde = { x: b.x + b.w / 2 + (salida.x * b.w) / 2, y: b.y + b.h / 2 + (salida.y * b.h) / 2 }
        abrirConexion(id, lado, { x: borde.x + salida.x * 80, y: borde.y + salida.y * 80 })
      })
    }
    // "Crear y conectar…" del menú contextual (el camino con teclado): el menú se abre a la derecha del objeto.
    const crearYConectar = (ev: Event) => {
      const { id } = (ev as CustomEvent<{ id: string }>).detail
      const n = rf.getNode(id)
      if (!n) return
      const b = cajaNodo(n)
      abrirConexion(id, 'derecha', { x: b.x + b.w + 80, y: b.y + b.h / 2 })
    }
    window.addEventListener('tablero:enfocar-tarjeta', ir)
    window.addEventListener('tablero:zoom-seleccion', zoomSel)
    window.addEventListener('tablero:siguiente-paso', siguiente)
    window.addEventListener('tablero:crear-y-conectar', crearYConectar)
    return () => {
      window.removeEventListener('tablero:enfocar-tarjeta', ir)
      window.removeEventListener('tablero:zoom-seleccion', zoomSel)
      window.removeEventListener('tablero:crear-y-conectar', crearYConectar)
      window.removeEventListener('tablero:siguiente-paso', siguiente)
    }
  }, [acciones])

  // Las tarjetas y los textos miden lo que miden: se guarda su medida real (alto; y el ancho de los textos con ancho
  // automático) para que alinear, enganchar, los conectores y lo que se agregue después usen la caja verdadera.
  const medidasPendientes = useRef(new Map<string, { ancho?: number; alto: number }>())
  const temporizadorMedidas = useRef<ReturnType<typeof setTimeout> | null>(null)
  const guardarMedidas = useCallback(() => {
    const cambios = [...medidasPendientes.current].map(([id, m]) => ({ id, ...m }))
    medidasPendientes.current.clear()
    if (cambios.length) useTienda.getState().actualizarElementos(cambios, { registrar: false })
  }, [])

  const alCambiarNodos: OnNodesChange<NodoLienzo> = useCallback(
    (cambios) => {
      for (const d of cambios.getByType('dimensions')) {
        if (!d.dimensions || d.resizing) continue
        const n = rf.getNode(d.id)
        if (n?.type !== 'tarjeta' && n?.type !== 'texto') continue
        // Mientras se escribe no: al terminar se guarda la medida junto con el texto, en el mismo cambio.
        if (useTienda.getState().editando === d.id) continue
        const e = n.data.elemento
        const alto = Math.round(d.dimensions.height)
        const ancho = n.type === 'texto' && e.datos.anchoAuto === true ? Math.round(d.dimensions.width) : undefined
        const umbral = n.type === 'texto' ? 1 : 8
        if (Math.abs(alto - e.alto) > umbral || (ancho !== undefined && Math.abs(ancho - e.ancho) > umbral)) {
          medidasPendientes.current.set(d.id, { alto, ...(ancho !== undefined ? { ancho } : {}) })
          if (temporizadorMedidas.current) clearTimeout(temporizadorMedidas.current)
          temporizadorMedidas.current = setTimeout(guardarMedidas, 600)
        }
      }
      const posiciones = cambios.getByType('position').filter((c) => c.dragging && c.position)
      let ajuste: { id: string; pos: { x: number; y: number } } | null = null
      // Los imanes del tablero (Configuración → Lienzo); mantener Ctrl/⌘ mientras se arrastra los apaga a los dos.
      const imanes = imanesRef.current
      if (posiciones.length === 1 && arrastre.current?.unico && imanes.objetos) {
        const c = posiciones[0]!
        const n = rf.getNode(c.id)
        if (n) {
          const hijos = arrastre.current.hijos
          const otros = rf.getNodes().filter((o) => o.id !== c.id && !hijos.has(o.id) && o.type !== 'marco')
          const r = enganchar(n, c.position!, otros, rf.getZoom(), imanes.grilla)
          ajuste = { id: c.id, pos: r.pos }
          setGuias(r.guias)
        }
      } else if (posiciones.length) setGuias((g) => (g.v.length || g.h.length ? { v: [], h: [] } : g))
      const medidos = new Set(cambios.getByType('dimensions').map((d) => d.id))
      setNodos((nds) => {
        let r = cambios.applyTo(nds)
        // Ya medido de verdad: afuera los puntos y la medida aproximados (ver sinDibujar), así React Flow usa los medidos.
        if (medidos.size) r = r.map((n) => (n.handles && medidos.has(n.id) ? { ...n, handles: undefined, initialWidth: undefined, initialHeight: undefined } : n))
        if (ajuste) r = r.map((n) => (n.id === ajuste!.id ? { ...n, position: ajuste!.pos } : n))
        // La caja de selección no se lleva lo bloqueado (se elige con un clic, para desbloquearlo) y se lleva un marco solo
        // si lo abarca entero: adentro de un marco se elige lo de adentro.
        const caja = cajaSeleccion.current
        if (caja) {
          const fin = rf.screenToFlowPosition(puntero.current)
          const [x1, x2] = [Math.min(caja.desde.x, fin.x), Math.max(caja.desde.x, fin.x)]
          const [y1, y2] = [Math.min(caja.desde.y, fin.y), Math.max(caja.desde.y, fin.y)]
          r = r.map((n) => {
            if (!n.selected || caja.antes.has(n.id)) return n
            if (n.data.elemento.bloqueado) return { ...n, selected: false }
            if (n.type !== 'marco') return n
            const c = cajaNodo(n)
            return c.x >= x1 && c.y >= y1 && c.x + c.w <= x2 && c.y + c.h <= y2 ? n : { ...n, selected: false }
          })
        }
        const a = arrastre.current
        if (a && a.hijos.size && posiciones.length) {
          const deltas = new Map<string, { dx: number; dy: number }>()
          for (const [id, inicio] of a.marcos) {
            const n = r.find((x) => x.id === id)
            if (n) deltas.set(id, { dx: n.position.x - inicio.x, dy: n.position.y - inicio.y })
          }
          r = r.map((n) => {
            const h = a.hijos.get(n.id)
            const d = h && deltas.get(h.marco)
            return h && d ? { ...n, position: { x: h.x + d.dx, y: h.y + d.dy } } : n
          })
        }
        return r
      })
    },
    [rf, guardarMedidas],
  )

  const alCambiarAristas: OnEdgesChange<AristaConector> = useCallback((cambios) => setAristas((as) => cambios.applyTo(as)), [])

  const alEmpezarArrastre: OnNodeDrag<NodoLienzo> = useCallback(
    (evento, _nodo, arrastrados) => {
      useLienzo.getState().setInteraccion('arrastre')
      const ids = new Set(arrastrados.map((n) => n.id))
      const marcos = new Map<string, { x: number; y: number }>()
      const hijos = new Map<string, { x: number; y: number; marco: string }>()
      const todos = rf.getNodes()
      for (const m of arrastrados) {
        if (m.type !== 'marco') continue
        marcos.set(m.id, { ...m.position })
        const cm = cajaNodo(m)
        for (const n of todos) {
          if (ids.has(n.id) || hijos.has(n.id) || n.id === m.id) continue
          const c = cajaNodo(n)
          const cx = c.x + c.w / 2
          const cy = c.y + c.h / 2
          if (cx > cm.x && cx < cm.x + cm.w && cy > cm.y && cy < cm.y + cm.h && !(n.type === 'marco' && c.w * c.h >= cm.w * cm.h))
            hijos.set(n.id, { x: n.position.x, y: n.position.y, marco: m.id })
        }
      }
      arrastre.current = { unico: arrastrados.length === 1, marcos, hijos }
      // Alt + arrastrar duplica: las copias (y los conectores entre ellas) quedan donde estaban los originales.
      if ((evento as MouseEvent).altKey) {
        const tienda = useTienda.getState()
        const mapa = new Map<string, string>()
        const copias = arrastrados
          .filter((n) => n.data.elemento.tipo !== 'tarjeta' && n.data.elemento.tipo !== 'lista')
          .map((n) => {
            const e = n.data.elemento
            const id = idLocal()
            mapa.set(e.id, id)
            return { id, tipo: e.tipo, x: n.position.x, y: n.position.y, ancho: e.ancho, alto: e.alto, datos: { ...e.datos } }
          })
        if (copias.length < arrastrados.length) avisarNoSeDuplican(arrastrados.length - copias.length)
        const conectores = (tienda.tablero?.conectores ?? []).filter((c) => mapa.has(c.desdeId) && mapa.has(c.hastaId))
        if (copias.length)
          void enUnPaso(copias.length > 1 ? `duplicar ${copias.length} objetos` : 'duplicar', async () => {
            await Promise.all(copias.map((c) => tienda.crearElemento(c)))
            await Promise.all(
              conectores.map(({ id: _id, tableroId: _t, ...c }) =>
                tienda.crearConector({ ...c, desdeId: mapa.get(c.desdeId)!, hastaId: mapa.get(c.hastaId)! }, { sinAnimacion: true }),
              ),
            )
          })
      }
    },
    [rf],
  )

  const alSoltarArrastre: OnNodeDrag<NodoLienzo> = useCallback(
    (_e, _nodo, arrastrados) => {
      useLienzo.getState().setInteraccion(null)
      setGuias({ v: [], h: [] })
      const a = arrastre.current
      arrastre.current = null
      const actuales = new Map(rf.getNodes().map((n) => [n.id, n]))
      const ids = [...arrastrados.map((n) => n.id), ...(a ? [...a.hijos.keys()] : [])]
      const elementos = new Map((useTienda.getState().tablero?.elementos ?? []).map((e) => [e.id, e]))
      const cambios = ids
        .map((id) => actuales.get(id))
        .filter(Boolean)
        .map((n) => ({ id: n!.id, x: Math.round(n!.position.x), y: Math.round(n!.position.y) }))
        .filter((c) => {
          const e = elementos.get(c.id)
          return e && (e.x !== c.x || e.y !== c.y)
        })
      if (cambios.length) useTienda.getState().actualizarElementos(cambios, { registrar: cambios.length > 1 ? `mover ${cambios.length} objetos` : 'mover' })
    },
    [rf],
  )

  const alTocarFondo = (ev: { clientX: number; clientY: number }) => {
    const s = useTienda.getState()
    if (s.editando) s.setEditando(null)
    // Con la herramienta Conector y un origen elegido, un clic en el vacío abre "Crear y conectar" ahí.
    if (s.herramienta === 'conector') {
      const origen = useLienzo.getState().origenConexion
      setOrigenConexion(null)
      if (origen) abrirConexion(origen, null, rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }))
    }
  }

  const alTocarNodo = (_ev: React.MouseEvent, nodo: NodoLienzo) => {
    if (herramienta !== 'conector') return
    if (!origenConexion) {
      setOrigenConexion(nodo.id)
      return
    }
    if (origenConexion !== nodo.id) {
      const e = usePreferencias.getState().estilos.conector
      useTienda.getState().crearConector({ desdeId: origenConexion, hastaId: nodo.id, ...e })
      setOrigenConexion(null)
      if (!useTienda.getState().herramientaFija) useTienda.getState().setHerramienta('seleccionar')
    }
  }

  /** Abre el menú contextual en un punto de la pantalla: sobre un objeto (lo elige si no estaba elegido) o sobre el vacío. */
  const abrirMenuContextual = (x: number, y: number, objetivo: Element | null) => {
    const nodo = objetivo?.closest<HTMLElement>('.react-flow__node')
    const arista = objetivo?.closest<SVGElement>('.react-flow__edge')
    const punto = rf.screenToFlowPosition({ x, y })
    let sobre: 'objeto' | 'vacio' = 'vacio'
    const nodoId = nodo?.dataset.id
    const aristaId = arista?.getAttribute('data-id') ?? arista?.dataset.id
    if (nodoId) {
      sobre = 'objeto'
      if (!rf.getNode(nodoId)?.selected) acciones.seleccionar([nodoId])
    } else if (aristaId) {
      sobre = 'objeto'
      if (!rf.getEdge(aristaId)?.selected) acciones.seleccionar([], [aristaId])
    }
    useLienzo.getState().set({ menuContextual: { x, y, sobre, punto } })
  }

  /** "Pegar" del menú: lo del portapapeles del sistema (si da permiso) o, si no, lo copiado en el lienzo. */
  const pegarEn = async (punto: { x: number; y: number }) => {
    const texto = await leerDelSistema()
    const recorte = deTexto(texto) ?? (texto?.trim() ? null : recorteEnMemoria())
    if (recorte) return acciones.pegarRecorte(recorte, punto)
    if (texto?.trim()) {
      const id = await acciones.crear('nota', punto.x - 110, punto.y - 110, { ...datosNuevos('nota'), texto: texto.trim() })
      return id
    }
    avisar({ texto: 'No hay nada para pegar', duracion: 1800 })
  }

  /** "Nota acá", "Texto acá" y "Tarjeta nueva acá" del menú. */
  const crearEn = async (que: 'nota' | 'texto' | 'tarjeta', punto: { x: number; y: number }) => {
    if (que === 'tarjeta') {
      const p = rf.flowToScreenPosition(punto)
      const r = contenedor.current!.getBoundingClientRect()
      setComposer({ x: p.x - r.left, y: p.y - r.top, fx: punto.x, fy: punto.y })
      return
    }
    const id =
      que === 'nota'
        ? await acciones.crear('nota', punto.x - 110, punto.y - 110, datosNuevos('nota'))
        : await acciones.crear('texto', punto.x, punto.y - 16, datosNuevos('texto', { anchoAuto: true }), { ancho: 240, alto: 32 })
    if (id) useTienda.getState().setEditando(id)
  }

  const editar = (nodo: NodoLienzo) => {
    const e = nodo.data.elemento
    if (e.bloqueado) return
    if (e.tipo === 'tarjeta') {
      const t = useTienda.getState().tablero?.tarjetas.find((x) => x.id === e.tarjetaId)
      if (t) useTienda.getState().abrirTarjeta(t.clave)
    } else if (e.tipo === 'tabla') useLienzo.getState().set({ tablaAbierta: e.id })
    else if (e.tipo === 'grafico') useLienzo.getState().set({ graficoAbierto: e.id })
    else if (['nota', 'texto', 'forma', 'marco'].includes(e.tipo)) iniciarEdicion(e.id)
  }

  /**
   * «Tabla» y «Gráfico» de la barra de herramientas: se crean en el centro de lo que se ve. La tabla abre su editor; un
   * gráfico con una tabla elegida arma solo sus datos (al lado de la tabla); sin tabla, trae datos de ejemplo para editar.
   */
  const crearObjeto = async (que: 'tabla' | 'grafico') => {
    if (que === 'tabla') {
      const { tabla } = armarTabla({
        columnas: [{ nombre: 'Nombre', tipo: 'texto' }, { nombre: 'Cantidad', tipo: 'numero' }, { nombre: 'Estado', tipo: 'etiqueta' }],
        filas: [[], [], []],
        estricto: false,
      })
      const m = medidaTabla(tabla)
      const c = acciones.centro()
      const id = await acciones.crear('tabla', c.x - m.ancho / 2, c.y - m.alto / 2, tabla as unknown as Record<string, unknown>, { ancho: m.ancho, alto: m.alto }, { esperar: true })
      if (id) useLienzo.getState().set({ tablaAbierta: id })
      return
    }
    const elegidos = useLienzo.getState().seleccion.nodos
    const tabla = elegidos.length === 1 ? useTienda.getState().tablero?.elementos.find((x) => x.id === elegidos[0] && x.tipo === 'tabla') : undefined
    const fuente = tabla ? fuenteSugerida(leerTabla(tabla.datos), tabla.id) : null
    const datos = fuente
      ? { v: 1, tipo: 'barras', titulo: '', fuente, propios: null }
      : { v: 1, tipo: 'barras', titulo: '', fuente: null, propios: { categorias: ['A', 'B', 'C'], series: [{ nombre: 'Serie 1', valores: [3, 5, 2] }] } }
    const c = acciones.centro()
    const x = tabla ? tabla.x + tabla.ancho + 48 : c.x - 240
    const y = tabla ? tabla.y : c.y - 160
    const id = await acciones.crear('grafico', x, y, datos, { ancho: 480, alto: 320 }, { esperar: true })
    if (id) acciones.irA([id])
  }

  // El celular crea tablas y gráficos desde su hoja «Agregar al lienzo»: avisa por un evento (como el «siguiente paso»).
  useEffect(() => {
    const oir = (ev: Event) => {
      const que = (ev as CustomEvent<string>).detail
      if (que === 'tabla' || que === 'grafico') void crearObjeto(que)
    }
    window.addEventListener('tablero:crear-objeto', oir)
    return () => window.removeEventListener('tablero:crear-objeto', oir)
  })

  const alCrearObjeto = useFija((q: 'tabla' | 'grafico') => void crearObjeto(q))
  const alTocarNodoFija = useFija(alTocarNodo)
  const alDobleClicNodo = useFija((_e: React.MouseEvent, n: NodoLienzo) => editar(n))
  const alDobleClicArista = useCallback((_e: React.MouseEvent, a: AristaConector) => useLienzo.getState().set({ etiquetaEditando: a.id }), [])

  const alConectar = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return
    const e = usePreferencias.getState().estilos.conector
    useTienda.getState().crearConector({
      desdeId: c.source,
      hastaId: c.target,
      desdeLado: (c.sourceHandle as never) ?? null,
      hastaLado: (c.targetHandle as never) ?? null,
      ...e,
    })
  }

  // ───── atajos del lienzo (una sola suscripción) ─────
  useAtajosLienzo({
    acciones,
    herramienta: (h: Herramienta) => elegirHerramienta(h),
    imagen: () => refImagen.current?.click(),
    escape: () => {
      setComposer(null)
      if (useLienzo.getState().conexionPendiente) cerrarConexion(true)
      useLienzo.getState().set({ buscando: false })
      setOrigenConexion(null)
      useTienda.getState().setHerramienta('seleccionar')
      if (!useTienda.getState().claveAbierta) acciones.seleccionar([])
    },
    editar: () => {
      const n = acciones.seleccion().nodos[0]
      if (n) editar(n)
    },
    buscar: () => useLienzo.getState().set({ buscando: true }),
    crearAca: () => void crearConTeclado(acciones, useTienda.getState().herramienta, (punto) => void crearEn('tarjeta', punto)),
    menu: () => {
      const el = contenedor.current
      if (!el) return
      const { nodos: ns, aristas: as } = acciones.seleccion()
      const r = el.getBoundingClientRect()
      if (!ns.length && !as.length) {
        const x = r.left + r.width / 2
        const y = r.top + r.height / 2
        useLienzo.getState().set({ menuContextual: { x, y, sobre: 'vacio', punto: rf.screenToFlowPosition({ x, y }) } })
        return
      }
      // Debajo del centro de la selección.
      const cajas = ns.map(cajaNodo)
      const cx = cajas.length ? (Math.min(...cajas.map((c) => c.x)) + Math.max(...cajas.map((c) => c.x + c.w))) / 2 : 0
      const abajo = cajas.length ? Math.max(...cajas.map((c) => c.y + c.h)) : 0
      const p = cajas.length ? rf.flowToScreenPosition({ x: cx, y: abajo }) : { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      const x = Math.min(Math.max(p.x, r.left + 16), r.right - 16)
      const y = Math.min(Math.max(p.y + 8, r.top + 16), r.bottom - 16)
      useLienzo.getState().set({ menuContextual: { x, y, sobre: 'objeto', punto: rf.screenToFlowPosition({ x, y }) } })
    },
    zoom: (como) => (como === 'cien' ? rf.zoomTo(1, { duration: duracion(260) }) : como === 'mas' ? rf.zoomIn({ duration: duracion(200) }) : rf.zoomOut({ duration: duracion(200) })),
  })

  // ───── pegar y soltar cosas en el lienzo ─────
  useEffect(() => {
    const ocupado = (e: Event) => escribiendo(e) || !!useTienda.getState().claveAbierta || !!useTienda.getState().dialogo || !!useTienda.getState().editando
    // Copiar y cortar objetos (con sus conectores): a la memoria y al portapapeles del sistema como "telar:{…}".
    const alCopiar = (cortar: boolean) => (e: ClipboardEvent) => {
      if (ocupado(e) || !acciones.seleccion().nodos.length) return
      const r = cortar ? acciones.cortar() : acciones.copiar()
      if (!r) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', aTexto(r))
      const n = r.elementos.length
      if (!cortar) avisar({ texto: n === 1 ? 'Copiado' : `${n} objetos copiados`, duracion: 1400 })
    }
    const copiar = alCopiar(false)
    const cortar = alCopiar(true)
    const alPegar = (e: ClipboardEvent) => {
      if (ocupado(e) || useLienzo.getState().tablaAbierta || useLienzo.getState().graficoAbierto) return
      const pos = rf.screenToFlowPosition(puntero.current)
      // Objetos copiados del lienzo (de este tablero o de otro): en el lugar del cursor.
      const recorte = deTexto(e.clipboardData?.getData('text/plain'))
      if (recorte) {
        e.preventDefault()
        void acciones.pegarRecorte(recorte, pos)
        return
      }
      const archivos = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (archivos.length) {
        e.preventDefault()
        archivos.forEach((f, i) => acciones.agregarImagen(f, pos.x + i * 40, pos.y + i * 40))
        return
      }
      const texto = e.clipboardData?.getData('text/plain')?.trim()
      if (!texto) return
      e.preventDefault()
      // Una grilla copiada de Excel o Sheets (2 o más columnas y filas) se vuelve una tabla, con los tipos adivinados.
      const pegada = esGrilla(texto) ? tablaDesdeTexto(texto) : null
      if (pegada) {
        const tabla = leerTabla({ columnas: pegada.columnas, filas: pegada.filas })
        const m = medidaTabla(tabla)
        void acciones.crear('tabla', pos.x, pos.y, tabla as unknown as Record<string, unknown>, { ancho: m.ancho, alto: m.alto })
      } else if (esUrl(texto)) {
        const a = analizarEnlace(texto)
        if (a.tipo === 'figma') void acciones.crear('figma', pos.x - 280, pos.y - 200, { url: texto, titulo: a.titulo })
        else if (/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(texto)) void acciones.crear('imagen', pos.x - 180, pos.y - 130, { url: texto, titulo: '' })
        else void acciones.crear('enlace', pos.x - 170, pos.y - 58, { url: texto, titulo: a.titulo })
      } else {
        void acciones.crear('nota', pos.x - 110, pos.y - 110, { texto, ...usePreferencias.getState().estilos.nota })
      }
    }
    window.addEventListener('paste', alPegar)
    window.addEventListener('copy', copiar)
    window.addEventListener('cut', cortar)
    return () => {
      window.removeEventListener('paste', alPegar)
      window.removeEventListener('copy', copiar)
      window.removeEventListener('cut', cortar)
    }
  }, [rf, acciones])

  // ───── navegación: mouse o trackpad ─────
  const modo = rueda === 'auto' ? detectado : rueda
  const alRueda = (e: React.WheelEvent) => {
    if (rueda !== 'auto' || e.ctrlKey) return
    const pareceTrackpad = e.deltaX !== 0 || (e.deltaMode === 0 && Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY * 2))
    const pareceMouse = e.deltaX === 0 && (e.deltaMode === 1 || Math.abs(e.deltaY) >= 50)
    if (pareceTrackpad && detectado !== 'trackpad') setDetectado('trackpad')
    else if (pareceMouse && detectado !== 'mouse') setDetectado('mouse')
  }

  const seleccionados = useMemo(() => nodos.filter((n) => n.selected), [nodos])
  const nodosVista = useMemo(
    () => (origenConexion ? nodos.map((n) => (n.id === origenConexion ? { ...n, className: `${n.className ?? ''} rf-origen` } : n)) : nodos),
    [nodos, origenConexion],
  )

  return (
    <ContextoLienzo.Provider value={ctx}>
      <ContextoNivel.Provider value={nivel}>
      <div
        ref={contenedor}
        className={`lienzo lienzo--${herramienta}${editando ? ' lienzo--editando' : ''}${seleccionados.length > 1 ? ' lienzo--multiple' : ''}`}
        data-fondo={ajustes.fondo}
        data-zoom={zoomInicial}
        onWheelCapture={alRueda}
        onPointerDownCapture={(e) => {
          if (e.button === 2) derecho.current = { x: e.clientX, y: e.clientY }
          // Mover el lienzo arrastrando el fondo (botón del medio o derecho; con la mano, cualquiera): el fondo captura el
          // mouse. Sin captura, en cada movimiento el navegador busca qué hay bajo el puntero entre todos los objetos y
          // conectores (con el tablero de RC en vista general era la mitad del trabajo de cada cuadro). Con el dedo la
          // captura ya es automática.
          const fondo = e.target as Element
          if (e.pointerType === 'mouse' && fondo.classList.contains('react-flow__pane') && (e.button === 1 || e.button === 2 || herramienta === 'mano'))
            fondo.setPointerCapture(e.pointerId)
          if (e.pointerType === 'touch')
            toqueFondo.current =
              e.isPrimary && (e.target as Element).classList.contains('react-flow__pane') ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null
          alPunteroAbajo(e)
        }}
        onPointerUp={(e) => {
          // Con el dedo, React Flow no suelta la selección al tocar el fondo (con Seleccionar, el arrastre con un dedo mueve
          // el lienzo en vez de hacer recuadro, y el clic del fondo queda sin escuchar): un toque corto y quieto en el vacío
          // hace lo mismo que el clic del mouse.
          const toque = toqueFondo.current
          if (e.pointerType === 'touch' && toque?.id === e.pointerId) {
            toqueFondo.current = null
            const quieto = Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 10 && e.timeStamp - toque.t < 600
            if (quieto && (e.target as Element).classList.contains('react-flow__pane') && useTienda.getState().herramienta === 'seleccionar') {
              alTocarFondo(e)
              acciones.seleccionar([])
            }
          }
          const d = derecho.current
          if (e.button !== 2 || !d) return
          derecho.current = null
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4) return
          if ((e.target as HTMLElement).closest('.react-flow__panel, .barra-ctx, .panel-tarjetas, .buscador, .composer-lienzo, .lienzo-vacio')) return
          abrirMenuContextual(e.clientX, e.clientY, e.target as Element)
        }}
        onContextMenu={(e) => {
          // En un texto que se está escribiendo queda el menú del navegador (ortografía); en el resto, el nuestro.
          if (escribiendo(e.nativeEvent)) return
          e.preventDefault()
        }}
        onPointerMove={(e) => (puntero.current = { x: e.clientX, y: e.clientY })}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).classList.contains('react-flow__pane') || herramienta !== 'seleccionar') return
          const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
          void acciones.crear('nota', pos.x - 110, pos.y - 110, { texto: '', ...usePreferencias.getState().estilos.nota }).then((id) => id && useTienda.getState().setEditando(id))
        }}
        onDragOver={(e) => {
          const tipos = e.dataTransfer.types
          const delPanel = tipos.includes('application/x-tablero-tarjeta') || tipos.includes('application/x-tablero-lista')
          if (delPanel || tipos.includes('Files')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
          // Mientras se arrastra una tarjeta (o una lista) del panel, su fantasma sigue al cursor.
          const el = fantasma.current
          if (el && delPanel) {
            const lista = tipos.includes('application/x-tablero-lista')
            const [w, h] = lista ? [TAMANOS.lista.ancho, 180] : [288, 100]
            const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
            el.dataset.modo = 'siguiendo'
            el.dataset.herramienta = 'tarjeta'
            el.style.transform = `translate(${p.x - w / 2}px, ${p.y - (lista ? 40 : 50)}px)`
            el.style.width = `${w}px`
            el.style.height = `${h}px`
          }
        }}
        onDragLeave={(e) => {
          if (!contenedor.current?.contains(e.relatedTarget as Node) && fantasma.current) fantasma.current.dataset.modo = 'oculto'
        }}
        onDrop={(e) => {
          if (fantasma.current) fantasma.current.dataset.modo = 'oculto'
          const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
          const tarjeta = e.dataTransfer.getData('application/x-tablero-tarjeta')
          if (tarjeta) {
            e.preventDefault()
            void acciones.agregarTarjeta(tarjeta, pos.x, pos.y)
            return
          }
          const lista = e.dataTransfer.getData('application/x-tablero-lista')
          if (lista) {
            e.preventDefault()
            void acciones.agregarLista(lista, pos.x, pos.y)
            return
          }
          const imagenes = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
          if (imagenes.length) {
            e.preventDefault()
            imagenes.forEach((f, i) => acciones.agregarImagen(f, pos.x + i * 40, pos.y + i * 40))
          }
        }}
      >
        <input
          ref={refImagen}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const c = acciones.centro()
            ;[...(e.target.files ?? [])].forEach((f, i) => acciones.agregarImagen(f, c.x + i * 40, c.y + i * 40))
            e.target.value = ''
          }}
        />
        <input
          ref={refReemplazo}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          hidden
          onChange={async (e) => {
            const archivo = e.target.files?.[0]
            e.target.value = ''
            const sel = acciones.seleccion().nodos.find((n) => n.type === 'imagen')
            if (!archivo || !sel) return
            try {
              const { url, nombre } = await api.subirArchivo(archivo)
              void useTienda.getState().actualizarElementos([{ id: sel.id, datos: { url, titulo: nombre } }], { registrar: 'reemplazar imagen' })
            } catch (err) {
              avisarError(err)
            }
          }}
        />
        <ReactFlow<NodoLienzo, AristaConector>
          nodes={nodosVista}
          edges={aristas}
          nodeTypes={TIPOS_NODO}
          edgeTypes={TIPOS_ARISTA}
          onNodesChange={alCambiarNodos}
          onEdgesChange={alCambiarAristas}
          onNodeDragStart={alEmpezarArrastre}
          onNodeDragStop={alSoltarArrastre}
          onSelectionDragStart={(e, ns) => alEmpezarArrastre(e as unknown as MouseEvent, ns[0]!, ns)}
          onSelectionDragStop={(e, ns) => alSoltarArrastre(e as unknown as MouseEvent, ns[0]!, ns)}
          onPaneClick={alTocarFondo}
          onSelectionStart={(ev) => {
            cajaSeleccion.current = {
              desde: rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }),
              antes: new Set(rf.getNodes().filter((n) => n.selected).map((n) => n.id)),
            }
          }}
          onSelectionEnd={() => {
            cajaSeleccion.current = null
          }}
          onNodeClick={alTocarNodoFija}
          onNodeDoubleClick={alDobleClicNodo}
          onConnect={alConectar}
          onEdgeDoubleClick={alDobleClicArista}
          onConnectStart={() => useLienzo.getState().set({ conectando: true })}
          onConnectEnd={(evento, estado) => {
            useLienzo.getState().set({ conectando: false })
            marcarDestino(null)
            if (estado.isValid || !estado.fromNode) return
            const desdeId = estado.fromNode.id
            const desdeLado = (estado.fromHandle?.id as Lado | undefined) ?? null
            const fin = coordenadas(evento)
            if (!estado.to) return
            // Soltar sobre el propio origen: no pasa nada.
            const to = estado.to
            if (rf.getIntersectingNodes({ x: to.x, y: to.y, width: 1, height: 1 }, true).some((n) => n.id === desdeId)) return
            // Soltar sobre cualquier parte de un objeto conecta (no hace falta acertarle al punto); sobre el título de
            // un marco, conecta con el marco.
            const destino = nodoBajoPuntero(rf, estado.to, [desdeId], fin ?? undefined)
            if (destino) {
              const e = usePreferencias.getState().estilos.conector
              void useTienda.getState().crearConector({ desdeId, desdeLado, hastaId: destino.id, ...e })
              return
            }
            // En el aire: la línea queda dibujada y se abre el menú "Crear y conectar".
            abrirConexion(desdeId, desdeLado, estado.to)
          }}
          onInit={() => {
            if (!vistaGuardada && !FOTO) acciones.verTodo(0)
          }}
          onMoveStart={() => {
            if (!useLienzo.getState().interaccion) useLienzo.getState().setInteraccion('movimiento')
            // Mover el lienzo con el menú "Crear y conectar" abierto lo cancela (el menú no viaja con el lienzo).
            if (useLienzo.getState().conexionPendiente) cerrarConexion(true)
          }}
          onMoveEnd={(_e, vp) => {
            if (useLienzo.getState().interaccion === 'movimiento') useLienzo.getState().setInteraccion(null)
            if (!FOTO) localStorage.setItem(claveVista, JSON.stringify(vp))
          }}
          connectionMode={ConnectionMode.Loose}
          connectOnClick={false}
          connectionLineStyle={{ stroke: 'var(--c-seleccion)', strokeWidth: 2 }}
          deleteKeyCode={null}
          selectionKeyCode={null}
          selectionOnDrag={herramienta === 'seleccionar'}
          // Con la mano solo se mueve el lienzo: los objetos no se eligen ni se arrastran aunque se los toque (lienzo.css
          // les saca el puntero), y tocar el vacío no suelta lo que estaba elegido.
          elementsSelectable={herramienta !== 'mano'}
          snapToGrid={ajustes.imanGrilla && !sinImanes}
          snapGrid={[ajustes.grilla, ajustes.grilla]}
          selectionMode={SelectionMode.Partial}
          panOnDrag={herramienta === 'mano' ? true : [1, 2]}
          panOnScroll={modo === 'trackpad'}
          zoomOnScroll={modo === 'mouse'}
          zoomOnPinch
          zoomOnDoubleClick={false}
          multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          nodeDragThreshold={3}
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
          zIndexMode="manual"
          onlyRenderVisibleElements
          defaultViewport={vistaInicial ?? undefined}
          attributionPosition="bottom-left"
          noDragClassName="nodrag"
          noWheelClassName="nowheel"
          noPanClassName="nopan"
          autoPanOnNodeDrag
          // El teclado lo maneja Telar (atajos.ts): Tab recorre, Enter edita, las flechas mueven, Esc suelta.
          disableKeyboardA11y
          tabIndex={0}
          aria-label={`Lienzo de ${tablero.tablero.nombre}. Tab recorre los objetos; Enter edita; las flechas mueven.`}
        >
          {grilla && ajustes.fondo !== 'liso' && (
            <Background
              variant={ajustes.fondo === 'lineas' ? BackgroundVariant.Lines : ajustes.fondo === 'cruces' ? BackgroundVariant.Cross : BackgroundVariant.Dots}
              gap={ajustes.grilla}
              size={ajustes.fondo === 'cruces' ? 6 : 1.7}
              lineWidth={ajustes.fondo === 'cruces' ? 1.2 : 1}
            />
          )}
          {minimapa && interfaz.minimapa && (
            <MiniMap<NodoLienzo>
              pannable
              zoomable
              position="bottom-right"
              nodeColor={colorMinimapa}
              nodeBorderRadius={8}
              ariaLabel="Minimapa"
              style={{ width: 168, height: 112 }}
            />
          )}
          <ViewportPortal>
            <LineaEnCurso pendiente={conexionPendiente} cancelada={conexionCancelada} />
            <div ref={fantasma} className="fantasma" data-modo="oculto" aria-hidden>
              <span className="fantasma__medidas" />
            </div>
            {guias.v.map((x) => (
              <div key={`v${x}`} className="guia guia--v" style={{ transform: `translate(${x}px, -50000px)` }} />
            ))}
            {guias.h.map((y) => (
              <div key={`h${y}`} className="guia guia--h" style={{ transform: `translate(-50000px, ${y}px)` }} />
            ))}
            {subidas.map((c) => (
              <div key={c.id} className="subida" style={{ transform: `translate(${c.x}px, ${c.y}px)`, width: c.ancho, height: c.alto }} role="status" aria-label="Subiendo la imagen">
                <span className="subida__barra" />
              </div>
            ))}
          </ViewportPortal>
          {interfaz.paneles && (
            <Panel position="top-left" className="panel-lienzo">
              {/* Sin Kanban no hay tarjetas que traer. */}
              {conKanban && (
                <button
                  className={`boton-flotante${panelTarjetas ? ' boton-flotante--activo' : ''}`}
                  onClick={() => useLienzo.getState().set({ panelTarjetas: !panelTarjetas })}
                >
                  <SquareKanban size={15} /> Tarjetas del Kanban
                </button>
              )}
              <PanelMarcos />
              <button className="boton-flotante" onClick={() => useLienzo.getState().set({ buscando: true })} data-tip="Buscar en el lienzo" data-tecla="$mod+F">
                <Search size={15} />
              </button>
            </Panel>
          )}
          {interfaz.controles && (
            <Panel position="top-right" className="panel-lienzo">
              <Controles />
            </Panel>
          )}
          {interfaz.aviso && (
            <Panel position="top-center" className="panel-lienzo panel-lienzo--aviso">
              <AvisoHerramienta />
            </Panel>
          )}
          {interfaz.herramientas && (
            <Panel position="bottom-center" className="panel-lienzo panel-lienzo--abajo">
              <BarraHerramientas alSubirImagen={subirImagen} alCrear={alCrearObjeto} />
            </Panel>
          )}
        </ReactFlow>
        <Suspense fallback={null}>
          {tablaAbierta && <DialogoTabla />}
          {graficoAbierto && <DialogoGrafico />}
        </Suspense>
        <AnimatePresence>{vacio && interfaz.paneles && <LienzoVacio />}</AnimatePresence>
        {interfaz.barraContextual && <BarraContextual abajo={interfaz.barraContextualAbajo} alReemplazarImagen={() => refReemplazo.current?.click()} />}
        {menuContextual && <MenuContextual menu={menuContextual} alPegar={(p) => void pegarEn(p)} alCrear={(q, p) => void crearEn(q, p)} />}
        {conexionPendiente && interfaz.menuConectar && (
          <MenuConexion
            pendiente={conexionPendiente}
            alElegir={(o) => {
              const p = conexionPendiente
              cerrarConexion(false)
              void acciones.crearYConectar(p.desdeId, p.desdeLado, p.punto, o, p.ladoLlegada)
            }}
            alCerrar={() => cerrarConexion(true)}
          />
        )}
        <AnimatePresence>
          {panelTarjetas && conKanban && interfaz.paneles && (
            <PanelTarjetas
              alCerrar={() => useLienzo.getState().set({ panelTarjetas: false })}
              alAgregar={(id) => {
                const c = acciones.centro()
                void acciones.agregarTarjeta(id, c.x, c.y)
              }}
            />
          )}
          {buscando && interfaz.buscador && (
            <Buscador
              alCerrar={() => useLienzo.getState().set({ buscando: false })}
              alIr={(e) => {
                useLienzo.getState().set({ buscando: false })
                acciones.irA([e.id])
                acciones.seleccionar([e.id])
                useTienda.getState().destellar(e.tarjetaId ?? e.id)
              }}
            />
          )}
        </AnimatePresence>
        {composer && (
          <ComposerTarjeta
            x={composer.x}
            y={composer.y}
            alCerrar={() => setComposer(null)}
            alCrear={async (titulo, listaId) => {
              const { fx, fy } = composer
              setComposer(null)
              if (!useTienda.getState().herramientaFija) useTienda.getState().setHerramienta('seleccionar')
              // Tarjeta y objeto, en un solo paso de deshacer.
              await enUnPaso('tarjeta nueva en el lienzo', async () => {
                const nueva = await useTienda.getState().crearTarjeta(listaId, titulo, {}, 'arriba')
                if (nueva) await acciones.crear('tarjeta', fx - 144, fy - 50, { variante: 'normal' }, { tarjetaId: nueva.id }, { esperar: true })
              })
            }}
          />
        )}
        {capa}
      </div>
      </ContextoNivel.Provider>
    </ContextoLienzo.Provider>
  )
}
