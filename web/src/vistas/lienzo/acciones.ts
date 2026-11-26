// Acciones del lienzo: crear, duplicar, borrar, mover, alinear, apilar, bloquear y encuadrar. Todo cambio de un objeto
// pasa por la tienda (tiene deshacer). Las usan el lienzo, sus barras y menús, y la capa del celular
// (useAccionesLienzo, dentro del ReactFlowProvider).
import { useReactFlow, type ReactFlowInstance } from '@xyflow/react'
import { createContext, useContext, useMemo, type Dispatch, type SetStateAction } from 'react'
import { limites, type Rect } from '../../../../compartido/geometria'
import { estiloPara, extraerEstilo, TAMANOS, type TipoForma } from '../../../../compartido/lienzo'
import type { ElementoLienzo, Lado, TipoElemento } from '../../../../compartido/tipos'
import { api } from '../../estado/api'
import { avisar, avisarError } from '../../estado/avisos'
import { enUnPaso } from '../../estado/deshacer'
import { usePreferencias } from '../../estado/preferencias'
import { idLocal, useTienda } from '../../estado/tienda'
import { movimientoReducido } from '../../util/movimiento'
import { LADO_OPUESTO } from './conectores/rutas'
import { datosNuevos } from './crear'
import { useLienzo } from './estado'
import { contenidoDeMarco, duenosDe, ordenDeLectura, ordenDeMarcos } from './indices'
import { armarRecorte, guardarRecorte, type Recorte } from './portapapeles'
import type { AristaConector, NodoLienzo } from './tipos'

export type RF = ReactFlowInstance<NodoLienzo, AristaConector>

/** Lo que el lienzo le presta a sus acciones: los nodos y aristas que maneja React (selección incluida). */
export interface ContextoAcciones {
  setNodos: Dispatch<SetStateAction<NodoLienzo[]>>
  setAristas: Dispatch<SetStateAction<AristaConector[]>>
  contenedor: () => HTMLElement | null
  /** El zoom de un encuadre instantáneo, antes de hacerlo: el nivel de detalle cambia en el mismo dibujo (9.4). */
  antesDeZoom?: (zoom: number) => void
}

export const ContextoLienzo = createContext<ContextoAcciones | null>(null)

/**
 * El nivel de detalle del lienzo (9.4, R7): '' de cerca, 'lejos' con zoom < 0,3 y 'muy-lejos' con < 0,12. Cambia solo
 * al cruzar un umbral: muy lejos, notas y formas se dibujan sin su texto (ni se arma ni se mide).
 */
export type NivelDetalle = '' | 'lejos' | 'muy-lejos'
export const ContextoNivel = createContext<NivelDetalle>('')

export const MIN_ZOOM = 0.06
export const MAX_ZOOM = 3

/** Caja de un nodo en coordenadas del lienzo (con la medida real si ya se midió). */
export const cajaNodo = (n: NodoLienzo) => ({
  x: n.position.x,
  y: n.position.y,
  w: n.measured?.width ?? n.width ?? n.data.elemento.ancho,
  h: n.measured?.height ?? n.height ?? n.data.elemento.alto,
})

const rectDe = (cajas: { x: number; y: number; w: number; h: number }[]): Rect | null =>
  limites(cajas.map((c) => ({ x: c.x, y: c.y, ancho: c.w, alto: c.h })))

/** Lo que se puede crear al soltar un conector en el aire (5.7.1) o con un clic en un punto de conexión (5.7.5). */
export type OpcionCrear =
  | { tipo: 'igual' }
  | { tipo: 'nota' | 'texto' | 'marco' }
  | { tipo: 'forma'; forma?: TipoForma }
  | { tipo: 'tarjeta-nueva'; titulo: string; listaId: string | null }
  | { tipo: 'tarjeta'; tarjetaId: string }

/** La caja de un objeto de w × h con el medio de su lado `lado` en `punto`. */
export function cajaConLado(w: number, h: number, lado: Lado, punto: { x: number; y: number }) {
  switch (lado) {
    case 'izquierda':
      return { x: punto.x, y: punto.y - h / 2 }
    case 'derecha':
      return { x: punto.x - w, y: punto.y - h / 2 }
    case 'arriba':
      return { x: punto.x - w / 2, y: punto.y }
    default:
      return { x: punto.x - w / 2, y: punto.y - h }
  }
}

/** El lado de un objeto nuevo en `punto` que mira al objeto de origen. */
export function ladoHaciaOrigen(origen: { x: number; y: number; w: number; h: number }, punto: { x: number; y: number }): Lado {
  const dx = origen.x + origen.w / 2 - punto.x
  const dy = origen.y + origen.h / 2 - punto.y
  if (Math.abs(dx) / (origen.w / 2 + 1) >= Math.abs(dy) / (origen.h / 2 + 1)) return dx < 0 ? 'izquierda' : 'derecha'
  return dy < 0 ? 'arriba' : 'abajo'
}

export type ComoAlinear = 'izq' | 'centroH' | 'der' | 'arriba' | 'medio' | 'abajo' | 'distH' | 'distV' | 'grilla'
export type ComoApilar = 'frente' | 'fondo' | 'subir' | 'bajar'

export interface OpcionesEncuadre {
  /** Fracción de aire alrededor (0,08 = 8 %). */
  relleno: number
  zoomMax: number
  /** Píxeles de pantalla extra arriba (el título de un marco va afuera, arriba). */
  titulo?: number
  duracion?: number
}

export const ENCUADRES = {
  todo: { relleno: 0.08, zoomMax: 1 },
  seleccion: { relleno: 0.2, zoomMax: 1.25 },
  marco: { relleno: 0.04, zoomMax: 1.5, titulo: 48 },
} satisfies Record<string, OpcionesEncuadre>

/** Las tarjetas y las listas del Kanban van una sola vez en el lienzo: al duplicarlas o pegarlas, se avisa. */
export function avisarNoSeDuplican(cuantas: number) {
  avisar({
    texto: cuantas === 1 ? 'Esa tarjeta ya está en el lienzo: cada tarjeta del Kanban va una sola vez' : 'Las tarjetas del Kanban no se duplican: cada una va una sola vez en el lienzo',
    duracion: 3200,
  })
}

/** El último marco al que se fue con "." o "," (o desde el panel) y hasta cuándo cuenta como el de la pantalla. */
let ultimoMarco: { id: string; hasta: number } | null = null

export function crearAcciones(rf: RF, ctx: ContextoAcciones) {
  const tienda = () => useTienda.getState()

  const seleccion = () => {
    const nodos = rf.getNodes().filter((n) => n.selected)
    const aristas = rf.getEdges().filter((a) => a.selected)
    return { nodos, aristas }
  }

  /** Selecciona esos objetos (y suelta lo demás). Solo cambian los nodos cuya selección cambia. */
  const seleccionar = (ids: string[], conectores: string[] = []) => {
    const set = new Set(ids)
    const setC = new Set(conectores)
    ctx.setNodos((nds) => nds.map((n) => (!!n.selected === set.has(n.id) ? n : { ...n, selected: set.has(n.id) })))
    ctx.setAristas((as) => as.map((a) => (!!a.selected === setC.has(a.id) ? a : { ...a, selected: setC.has(a.id) })))
  }

  /** Encuadra un rectángulo del lienzo respetando las barras flotantes (no queda nada tapado). */
  const encuadrar = (rect: Rect, op: OpcionesEncuadre) => {
    const el = ctx.contenedor()
    if (!el) return
    const W = el.clientWidth
    const H = el.clientHeight
    // Lo que tapan los paneles de la izquierda (Tarjetas del Kanban, o el de marcos si está abierto).
    const panel = useLienzo.getState().panelMarcos ? document.querySelector<HTMLElement>('.flotante.panel-marcos') : null
    const tapaPanel = panel ? panel.getBoundingClientRect().right - el.getBoundingClientRect().left + 16 : 16
    const izq = Math.max(useLienzo.getState().panelTarjetas ? 332 : 16, tapaPanel)
    const util = { x: izq, y: 68, w: Math.max(120, W - izq - 16), h: Math.max(120, H - 68 - 92) }
    const titulo = op.titulo ?? 0
    const ancho = Math.max(rect.ancho, 1)
    const alto = Math.max(rect.alto, 1)
    let zoom = Math.min(util.w / ancho, (util.h - titulo) / alto) * (1 - op.relleno)
    zoom = Math.min(Math.max(zoom, MIN_ZOOM), op.zoomMax)
    const x = util.x + (util.w - ancho * zoom) / 2 - rect.x * zoom
    const y = util.y + titulo + (util.h - titulo - alto * zoom) / 2 - rect.y * zoom
    const duracion = movimientoReducido() ? 0 : (op.duracion ?? 420)
    if (!duracion) ctx.antesDeZoom?.(zoom)
    rf.setViewport({ x, y, zoom }, { duration: duracion })
  }

  const rectElementos = (es: ElementoLienzo[]) => limites(es.map((e) => ({ x: e.x, y: e.y, ancho: e.ancho, alto: e.alto })))

  const verTodo = (duracion?: number) => {
    const es = tienda().tablero?.elementos ?? []
    if (!es.length) return rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: duracion ?? 0 })
    // Con las medidas reales de lo que ya se dibujó (las tarjetas miden lo que miden).
    const nodos = rf.getNodes()
    const r = nodos.length ? rectDe(nodos.map(cajaNodo)) : rectElementos(es)
    if (!r) return
    const arriba = Math.min(...es.map((e) => e.y))
    const hayMarcoArriba = es.some((e) => e.tipo === 'marco' && e.y <= arriba + 1)
    encuadrar(r, { ...ENCUADRES.todo, titulo: hayMarcoArriba ? 48 : 0, duracion })
  }

  const zoomSeleccion = () => {
    const { nodos } = seleccion()
    const r = rectDe(nodos.map(cajaNodo))
    if (r) encuadrar(r, ENCUADRES.seleccion)
  }

  const irA = (ids: string[]) => {
    const nodos = ids.map((id) => rf.getNode(id)).filter(Boolean) as NodoLienzo[]
    const r = nodos.length ? rectDe(nodos.map(cajaNodo)) : rectElementos((tienda().tablero?.elementos ?? []).filter((e) => ids.includes(e.id)))
    if (r) encuadrar(r, ENCUADRES.seleccion)
  }

  const irAMarco = (id: string) => {
    const m = tienda().tablero?.elementos.find((e) => e.id === id)
    if (!m) return
    encuadrar({ x: m.x, y: m.y, ancho: m.ancho, alto: m.alto }, ENCUADRES.marco)
    // Mientras dura el viaje, "el marco en pantalla" es este (apretar "." dos veces seguidas avanza dos).
    ultimoMarco = { id, hasta: Date.now() + 600 }
  }

  /** El objeto de más arriba bajo un punto del lienzo (sin contar los excluidos ni, si se pide, los marcos). */
  const nodoBajo = (punto: { x: number; y: number }, excluir: string[] = [], conMarcos = false): NodoLienzo | null => {
    const candidatos = rf
      .getIntersectingNodes({ x: punto.x, y: punto.y, width: 1, height: 1 }, true)
      .filter((n) => !excluir.includes(n.id) && (conMarcos || n.type !== 'marco'))
    if (!candidatos.length) return null
    // Gana el de más arriba: los marcos siempre debajo; entre el resto, la capa más alta.
    return candidatos.sort((a, b) => (a.type === 'marco' ? 0 : 2 + a.data.elemento.z) - (b.type === 'marco' ? 0 : 2 + b.data.elemento.z)).at(-1)!
  }

  /** Centro de lo que se ve, en coordenadas del lienzo. */
  const centro = () => {
    const el = ctx.contenedor()
    const r = el?.getBoundingClientRect()
    return rf.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 800) / 2, y: (r?.top ?? 0) + (r?.height ?? 600) / 2 })
  }

  /**
   * Crea un objeto con la esquina superior izquierda en (x, y) y lo selecciona. Devuelve el id enseguida (el objeto
   * aparece al instante y se puede editar mientras el servidor lo guarda); con `esperar`, recién cuando quedó guardado
   * (o null si falló), para las acciones compuestas que deshacen todo si algo falla.
   */
  const crear = async (
    tipo: TipoElemento,
    x: number,
    y: number,
    datos: Record<string, unknown> = {},
    extra: Partial<ElementoLienzo> = {},
    opciones: { esperar?: boolean } = {},
  ): Promise<string | null> => {
    const t = TAMANOS[tipo]
    const id = extra.id ?? idLocal()
    const p = tienda().crearElemento({
      id,
      tipo,
      x: Math.round(x),
      y: Math.round(y),
      ancho: extra.ancho ?? t.ancho,
      alto: extra.alto ?? t.alto,
      datos,
      ...extra,
    })
    requestAnimationFrame(() => seleccionar([id]))
    if (!opciones.esperar) {
      void p
      return id
    }
    const r = await p
    return r ? id : null
  }

  /** Lo que está adentro de un marco (con las medidas reales de lo que ya se dibujó). */
  const contenidoDe = (marcoId: string): ElementoLienzo[] => {
    const es = tienda().tablero?.elementos ?? []
    const m = es.find((e) => e.id === marcoId)
    if (!m) return []
    return contenidoDeMarco(es, m, (e) => {
      const n = rf.getNode(e.id)
      return n ? { ancho: cajaNodo(n).w, alto: cajaNodo(n).h } : e
    })
  }

  /**
   * Duplica lo elegido (al lado, o corrido 24 px). Un marco se duplica con su contenido, y los conectores entre lo que se
   * duplica también se copian. Las tarjetas del Kanban no se duplican (son una sola).
   */
  const duplicar = (dx: number | null, dy: number | null) => {
    const { nodos } = seleccion()
    const elegidos = new Set(nodos.map((n) => n.id))
    const fuentes: { e: ElementoLienzo; ox: number; oy: number }[] = []
    const vistos = new Set<string>()
    for (const n of nodos) {
      const c = cajaNodo(n)
      const ox = dx === null ? 24 : dx * (c.w + 24)
      const oy = dy === null ? 24 : dy * (c.h + 24)
      const e = n.data.elemento
      if (!vistos.has(e.id)) fuentes.push({ e: { ...e, x: n.position.x, y: n.position.y }, ox, oy })
      vistos.add(e.id)
      if (e.tipo === 'marco')
        for (const h of contenidoDe(e.id))
          if (!vistos.has(h.id) && !elegidos.has(h.id)) {
            vistos.add(h.id)
            fuentes.push({ e: h, ox, oy })
          }
    }
    const fijas = fuentes.filter(({ e }) => e.tipo === 'tarjeta' || e.tipo === 'lista').length
    if (fijas) avisarNoSeDuplican(fijas)
    const copias = fuentes
      .filter(({ e }) => e.tipo !== 'tarjeta' && e.tipo !== 'lista')
      .map(({ e, ox, oy }) => ({
        original: e.id,
        id: idLocal(),
        tipo: e.tipo,
        x: Math.round(e.x + ox),
        y: Math.round(e.y + oy),
        ancho: e.ancho,
        alto: e.alto,
        datos: { ...e.datos },
      }))
    if (!copias.length) return
    const mapa = new Map(copias.map((c) => [c.original, c.id]))
    const conectores = (tienda().tablero?.conectores ?? []).filter((c) => mapa.has(c.desdeId) && mapa.has(c.hastaId))
    void enUnPaso(copias.length > 1 ? `duplicar ${copias.length} objetos` : 'duplicar', async () => {
      await Promise.all(copias.map(({ original: _o, ...c }) => tienda().crearElemento(c)))
      await Promise.all(
        conectores.map(({ id: _id, tableroId: _t, ...c }) =>
          tienda().crearConector({ ...c, desdeId: mapa.get(c.desdeId)!, hastaId: mapa.get(c.hastaId)! }, { sinAnimacion: true }),
        ),
      )
    })
    // Queda elegido lo que se pidió duplicar (no el contenido de los marcos, que va con ellos).
    requestAnimationFrame(() => seleccionar(nodos.map((n) => mapa.get(n.id)).filter(Boolean) as string[]))
  }

  const borrar = (ids?: string[], conectores?: string[]) => {
    const s = seleccion()
    void tienda().eliminarSeleccion(ids ?? s.nodos.map((n) => n.id), conectores ?? s.aristas.map((a) => a.id))
  }

  const mover = (dx: number, dy: number) => {
    const { nodos } = seleccion()
    if (!nodos.length) return
    const cambios = nodos
      .filter((n) => !n.data.elemento.bloqueado)
      .map((n) => ({ id: n.id, x: Math.round(n.position.x + dx), y: Math.round(n.position.y + dy) }))
    void tienda().actualizarElementos(cambios, { registrar: 'mover' })
  }

  const bloquear = (valor?: boolean) => {
    const { nodos } = seleccion()
    if (!nodos.length) return
    const todos = nodos.every((n) => n.data.elemento.bloqueado)
    const nuevo = valor ?? !todos
    void tienda().actualizarElementos(
      nodos.map((n) => ({ id: n.id, bloqueado: nuevo })),
      { registrar: nuevo ? 'bloquear' : 'desbloquear' },
    )
    avisar({ texto: nuevo ? 'Bloqueado: no se mueve hasta que lo desbloquees' : 'Desbloqueado', duracion: 1800 })
  }

  /**
   * Capas (los marcos siempre van debajo y nunca hay z negativos). Al frente: z = máximo + 1. Al fondo: la selección
   * pasa a z = 1… y todo lo demás sube, en una sola llamada. Subir o bajar una capa: se intercambia con el objeto más
   * cercano en z que se encima con él.
   */
  const apilar = (como: ComoApilar) => {
    const { nodos } = seleccion()
    const sel = nodos.filter((n) => n.type !== 'marco')
    if (!sel.length) return
    const els = (tienda().tablero?.elementos ?? []).filter((e) => e.tipo !== 'marco')
    const ids = new Set(sel.map((n) => n.id))
    const elegidos = els.filter((e) => ids.has(e.id)).sort((a, b) => a.z - b.z)
    const resto = els.filter((e) => !ids.has(e.id))
    let cambios: { id: string; z: number }[] = []
    if (como === 'frente') {
      const max = Math.max(0, ...els.map((e) => e.z))
      cambios = elegidos.map((e, i) => ({ id: e.id, z: max + 1 + i }))
    } else if (como === 'fondo') {
      const k = elegidos.length
      cambios = [...elegidos.map((e, i) => ({ id: e.id, z: 1 + i })), ...resto.map((e) => ({ id: e.id, z: Math.max(1, e.z) + k }))]
    } else {
      const e = elegidos.length === 1 ? elegidos[0]! : null
      if (!e) return avisar({ texto: 'Elegí un solo objeto para subirlo o bajarlo una capa', duracion: 2400 })
      const encima = (o: ElementoLienzo) => o.x < e.x + e.ancho && o.x + o.ancho > e.x && o.y < e.y + e.alto && o.y + o.alto > e.y
      const candidatos = resto.filter(encima)
      const otro =
        como === 'subir'
          ? candidatos.filter((o) => o.z >= e.z).sort((a, b) => a.z - b.z)[0]
          : candidatos.filter((o) => o.z <= e.z).sort((a, b) => b.z - a.z)[0]
      if (!otro) return avisar({ texto: como === 'subir' ? 'Ya está arriba de todo' : 'Ya está abajo de todo', duracion: 2000 })
      const zOtro = otro.z === e.z ? (como === 'subir' ? e.z + 1 : Math.max(1, e.z - 1)) : otro.z
      cambios = [
        { id: e.id, z: zOtro },
        { id: otro.id, z: e.z },
      ]
    }
    const reales = cambios.filter((c) => els.find((e) => e.id === c.id)?.z !== c.z)
    if (!reales.length) return
    const etiqueta = { frente: 'traer al frente', fondo: 'mandar al fondo', subir: 'subir una capa', bajar: 'bajar una capa' }[como]
    void tienda().actualizarElementos(reales, { registrar: etiqueta })
  }

  const alinear = (como: ComoAlinear) => {
    const { nodos } = seleccion()
    const movibles = nodos.filter((n) => !n.data.elemento.bloqueado)
    if (movibles.length < 2) return
    const cs = movibles.map((n) => ({ n, ...cajaNodo(n) }))
    const x1 = Math.min(...cs.map((c) => c.x))
    const x2 = Math.max(...cs.map((c) => c.x + c.w))
    const y1 = Math.min(...cs.map((c) => c.y))
    const y2 = Math.max(...cs.map((c) => c.y + c.h))
    let cambios: { id: string; x?: number; y?: number }[] = []
    switch (como) {
      case 'izq':
        cambios = cs.map((c) => ({ id: c.n.id, x: x1 }))
        break
      case 'der':
        cambios = cs.map((c) => ({ id: c.n.id, x: x2 - c.w }))
        break
      case 'centroH':
        cambios = cs.map((c) => ({ id: c.n.id, x: (x1 + x2) / 2 - c.w / 2 }))
        break
      case 'arriba':
        cambios = cs.map((c) => ({ id: c.n.id, y: y1 }))
        break
      case 'abajo':
        cambios = cs.map((c) => ({ id: c.n.id, y: y2 - c.h }))
        break
      case 'medio':
        cambios = cs.map((c) => ({ id: c.n.id, y: (y1 + y2) / 2 - c.h / 2 }))
        break
      case 'distH':
      case 'distV': {
        const h = como === 'distH'
        const orden = [...cs].sort((a, b) => (h ? a.x - b.x : a.y - b.y))
        const total = orden.reduce((s, c) => s + (h ? c.w : c.h), 0)
        const libre = (h ? x2 - x1 : y2 - y1) - total
        const gap = libre / (orden.length - 1)
        let pos = h ? x1 : y1
        cambios = orden.map((c) => {
          const r = h ? { id: c.n.id, x: pos } : { id: c.n.id, y: pos }
          pos += (h ? c.w : c.h) + gap
          return r
        })
        break
      }
      case 'grilla': {
        // Columnas = techo de la raíz de n, separación 24, en orden de lectura.
        const orden = [...cs].sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x))
        const cols = Math.ceil(Math.sqrt(orden.length))
        const anchoCol = Math.max(...orden.map((c) => c.w))
        let y = y1
        for (let f = 0; f * cols < orden.length; f++) {
          const fila = orden.slice(f * cols, f * cols + cols)
          fila.forEach((c, i) => cambios.push({ id: c.n.id, x: x1 + i * (anchoCol + 24), y }))
          y += Math.max(...fila.map((c) => c.h)) + 24
        }
        break
      }
    }
    void tienda().actualizarElementos(
      cambios.map((c) => ({ id: c.id, ...(c.x !== undefined ? { x: Math.round(c.x) } : {}), ...(c.y !== undefined ? { y: Math.round(c.y) } : {}) })),
      { registrar: como === 'grilla' ? 'ordenar en grilla' : como.startsWith('dist') ? 'repartir' : 'alinear' },
    )
  }

  /** Anima el cambio de lugar y tamaño de los marcos durante 220 ms (ajustar al contenido, tamaños rápidos). */
  const animarMarcos = () => {
    const el = ctx.contenedor()
    if (!el || movimientoReducido()) return
    el.dataset.animandoMarcos = ''
    setTimeout(() => delete el.dataset.animandoMarcos, 280)
  }

  /** El marco pasa a medir lo que contiene, con 40 px de margen (56 arriba). Si está vacío, no hace nada. */
  const ajustarMarco = (ids?: string[]) => {
    const marcos = (ids ?? seleccion().nodos.map((n) => n.id))
      .map((id) => tienda().tablero?.elementos.find((e) => e.id === id))
      .filter((m): m is ElementoLienzo => !!m && m.tipo === 'marco' && !m.bloqueado)
    const cambios = marcos.flatMap((m) => {
      const contenido = contenidoDe(m.id)
      const r = rectDe(contenido.map((e) => (rf.getNode(e.id) ? cajaNodo(rf.getNode(e.id)!) : { x: e.x, y: e.y, w: e.ancho, h: e.alto })))
      if (!r) return []
      return [{ id: m.id, x: Math.round(r.x - 40), y: Math.round(r.y - 56), ancho: Math.round(r.ancho + 80), alto: Math.round(r.alto + 96) }]
    })
    if (!cambios.length) return
    animarMarcos()
    void tienda().actualizarElementos(cambios, { registrar: 'ajustar el marco al contenido' })
  }

  /** Tamaño rápido del marco (16:9, 4:3, A4, celular): queda en el mismo lugar, arriba a la izquierda. */
  const tamanoMarco = (ancho: number, alto: number, ids?: string[]) => {
    const marcos = (ids ?? seleccion().nodos.map((n) => n.id))
      .map((id) => tienda().tablero?.elementos.find((e) => e.id === id))
      .filter((m): m is ElementoLienzo => !!m && m.tipo === 'marco' && !m.bloqueado)
    if (!marcos.length) return
    animarMarcos()
    void tienda().actualizarElementos(
      marcos.map((m) => ({ id: m.id, ancho, alto })),
      { registrar: 'tamaño del marco' },
    )
  }

  /** Agrupar en un marco (Ctrl/⌘ + G): un marco gris alrededor de lo elegido, con 40 px de margen, y el título en edición. */
  const agruparEnMarco = async () => {
    const { nodos } = seleccion()
    if (!nodos.length) return
    const r = rectDe(nodos.map(cajaNodo))!
    let caja = { x: r.x - 40, y: r.y - 56, ancho: r.ancho + 80, alto: r.alto + 96 }
    // Adentro de otro marco, que no se salga de él (si no, los dos títulos quedan encimados): 48 px abajo de su borde de
    // arriba (lugar para el título nuevo) y 16 a los costados, si así todavía entra lo elegido con aire.
    const es = tienda().tablero?.elementos ?? []
    const duenos = duenosDe(es)
    const padres = new Set(nodos.map((n) => duenos.get(n.id) ?? null))
    const padre = padres.size === 1 ? es.find((e) => e.id === [...padres][0]) : undefined
    if (padre) {
      const x1 = Math.max(caja.x, padre.x + 16)
      const y1 = Math.max(caja.y, padre.y + 48)
      const x2 = Math.min(caja.x + caja.ancho, padre.x + padre.ancho - 16)
      const y2 = Math.min(caja.y + caja.alto, padre.y + padre.alto - 16)
      if (x1 <= r.x - 12 && y1 <= r.y - 12 && x2 >= r.x + r.ancho + 12 && y2 >= r.y + r.alto + 12) caja = { x: x1, y: y1, ancho: x2 - x1, alto: y2 - y1 }
    }
    const id = await crear('marco', caja.x, caja.y, datosNuevos('marco', { color: 'gris' }), { ancho: Math.round(caja.ancho), alto: Math.round(caja.alto), z: 0 })
    if (id) tienda().setEditando(id)
    return id
  }

  /** Borra el marco y todo lo que tiene adentro (Supr borra solo el marco). */
  const borrarConContenido = (marcoId: string) => {
    const ids = [marcoId, ...contenidoDe(marcoId).map((e) => e.id)]
    void tienda().eliminarSeleccion(ids, [])
  }

  /** El marco que más ocupa la pantalla (o null si ninguno ocupa al menos la cuarta parte: por ejemplo, con "Ver todo"). */
  const marcoEnPantalla = (): string | null => {
    const el = ctx.contenedor()
    if (!el) return null
    const v = rf.getViewport()
    const vista = { x: -v.x / v.zoom, y: -v.y / v.zoom, ancho: el.clientWidth / v.zoom, alto: el.clientHeight / v.zoom }
    let mejor: { id: string; area: number } | null = null
    for (const m of ordenDeMarcos(tienda().tablero?.elementos ?? [])) {
      const ancho = Math.min(m.x + m.ancho, vista.x + vista.ancho) - Math.max(m.x, vista.x)
      const alto = Math.min(m.y + m.alto, vista.y + vista.alto) - Math.max(m.y, vista.y)
      if (ancho <= 0 || alto <= 0) continue
      // Lo que se ve del marco, en proporción a la pantalla y al marco (un marco enorme no gana por tamaño).
      const area = (ancho * alto) / Math.max(vista.ancho * vista.alto, m.ancho * m.alto)
      if (!mejor || area > mejor.area) mejor = { id: m.id, area }
    }
    return mejor && mejor.area >= 0.25 ? mejor.id : null
  }

  /** `.` y `,`: el marco siguiente o el anterior, en el orden del panel. */
  const marcoSiguiente = (paso: 1 | -1) => {
    const lista = ordenDeMarcos(tienda().tablero?.elementos ?? [])
    if (!lista.length) return avisar({ texto: 'Todavía no hay marcos. Dibujá uno con F.', duracion: 2400 })
    const actual = ultimoMarco && Date.now() < ultimoMarco.hasta ? ultimoMarco.id : marcoEnPantalla()
    const i = actual ? lista.findIndex((m) => m.id === actual) : -1
    const j = i === -1 ? (paso === 1 ? 0 : lista.length - 1) : i + paso
    if (j < 0 || j >= lista.length) return avisar({ texto: paso === 1 ? 'Es el último marco' : 'Es el primer marco', duracion: 1600 })
    irAMarco(lista[j]!.id)
  }

  /** Lo elegido para copiar: los objetos en su lugar de ahora, y lo de adentro de los marcos. */
  const elegidosParaCopiar = (): ElementoLienzo[] => {
    const vistos = new Set<string>()
    const r: ElementoLienzo[] = []
    for (const n of seleccion().nodos) {
      const e = { ...n.data.elemento, x: n.position.x, y: n.position.y }
      if (!vistos.has(e.id)) {
        vistos.add(e.id)
        r.push(e)
      }
      if (e.tipo === 'marco')
        for (const h of contenidoDe(e.id))
          if (!vistos.has(h.id)) {
            vistos.add(h.id)
            r.push(h)
          }
    }
    return r
  }

  /** Copia lo elegido (con sus conectores internos) a la memoria; devuelve el recorte para el portapapeles del sistema. */
  const copiar = (): Recorte | null => {
    const t = tienda().tablero
    const els = elegidosParaCopiar()
    if (!t || !els.length) return null
    const r = armarRecorte(t.tablero.id, els, t.conectores)
    guardarRecorte(r)
    return r
  }

  /** Copia y borra (un paso de deshacer). */
  const cortar = (): Recorte | null => {
    const r = copiar()
    if (r) void tienda().eliminarSeleccion(r.elementos.map((e) => e.id), [])
    return r
  }

  /**
   * Pega un recorte con el centro del conjunto en `punto`, con ids nuevos y sus conectores, en un solo paso. Las
   * tarjetas y las listas del Kanban van una sola vez en el lienzo y no pasan a otro tablero: esas se saltean (y avisa).
   */
  const pegarRecorte = async (r: Recorte, punto: { x: number; y: number }) => {
    const t = tienda().tablero
    if (!t) return
    const otroTablero = r.tableroId !== t.tablero.id
    const tarjetasEnLienzo = new Set(t.elementos.map((e) => e.tarjetaId).filter(Boolean))
    const listasEnLienzo = new Set(t.elementos.map((e) => e.listaId).filter(Boolean))
    let salteadas = 0
    const usables = r.elementos.filter((e) => {
      const fija =
        e.tipo === 'tarjeta'
          ? otroTablero || !e.tarjetaId || tarjetasEnLienzo.has(e.tarjetaId) || !t.tarjetas.some((x) => x.id === e.tarjetaId)
          : e.tipo === 'lista'
            ? otroTablero || !e.listaId || listasEnLienzo.has(e.listaId) || !t.listas.some((l) => l.id === e.listaId)
            : false
      if (fija) salteadas++
      return !fija
    })
    if (salteadas)
      otroTablero
        ? avisar({ texto: 'Las tarjetas y las listas del Kanban no pasan a otro tablero: se pegó lo demás', duracion: 3600 })
        : avisarNoSeDuplican(salteadas)
    if (!usables.length) return
    const caja = limites(usables.map((e) => ({ x: e.x, y: e.y, ancho: e.ancho, alto: e.alto })))!
    const dx = punto.x - (caja.x + caja.ancho / 2)
    const dy = punto.y - (caja.y + caja.alto / 2)
    // Arriba de todo, en el mismo orden de capas que tenían entre ellos (los marcos, siempre abajo).
    const zMax = Math.max(0, ...t.elementos.map((e) => e.z))
    const capas = usables.filter((e) => e.tipo !== 'marco').sort((a, b) => a.z - b.z)
    const mapa = new Map(usables.map((e) => [e.id, idLocal()]))
    const nuevos = usables.map((e) => ({
      id: mapa.get(e.id)!,
      tipo: e.tipo,
      x: Math.round(e.x + dx),
      y: Math.round(e.y + dy),
      ancho: e.ancho,
      alto: e.alto,
      z: e.tipo === 'marco' ? 0 : zMax + 1 + capas.indexOf(e),
      datos: { ...e.datos },
      tarjetaId: e.tarjetaId ?? null,
      listaId: e.listaId ?? null,
    }))
    const conectores = r.conectores.filter((c) => mapa.has(c.desdeId) && mapa.has(c.hastaId))
    await enUnPaso(nuevos.length > 1 ? `pegar ${nuevos.length} objetos` : 'pegar', async () => {
      await Promise.all(nuevos.map((n) => tienda().crearElemento(n)))
      await Promise.all(
        conectores.map(({ id: _id, ...c }) =>
          tienda().crearConector({ ...c, desdeId: mapa.get(c.desdeId)!, hastaId: mapa.get(c.hastaId)! }, { sinAnimacion: true }),
        ),
      )
    })
    requestAnimationFrame(() => seleccionar(nuevos.map((n) => n.id)))
  }

  /** Copiar estilo: guarda el estilo del objeto (no el texto ni el tamaño). */
  const copiarEstilo = () => {
    const e = seleccion().nodos[0]?.data.elemento
    const estilo = e ? extraerEstilo(e.tipo, e.datos) : null
    if (!estilo) return avisar({ texto: 'Ese objeto no tiene estilo para copiar', duracion: 2000 })
    usePreferencias.getState().cambiar({ portapapelesEstilo: estilo })
    avisar({ texto: 'Estilo copiado: pegalo con Ctrl/⌘ + Alt + V', duracion: 2200 })
  }

  /** Pegar estilo: cada objeto toma lo que entiende (de nota a forma, el color pasa a ser el relleno…). */
  const pegarEstilo = () => {
    const estilo = usePreferencias.getState().portapapelesEstilo
    if (!estilo) return avisar({ texto: 'Primero copiá el estilo de un objeto', duracion: 2000 })
    const cambios = seleccion()
      .nodos.filter((n) => !n.data.elemento.bloqueado)
      .map((n) => ({ id: n.id, datos: estiloPara(n.data.elemento.tipo, estilo) }))
      .filter((c) => Object.keys(c.datos).length > 0)
    if (cambios.length) void tienda().actualizarElementos(cambios, { registrar: 'pegar estilo' })
  }

  /** Trae una tarjeta del Kanban al lienzo (si ya está, va a ella y destella). */
  const agregarTarjeta = async (tarjetaId: string, x: number, y: number) => {
    const ya = tienda().tablero?.elementos.find((e) => e.tarjetaId === tarjetaId)
    if (ya) {
      irA([ya.id])
      seleccionar([ya.id])
      tienda().destellar(tarjetaId)
      return ya.id
    }
    const id = await crear('tarjeta', x - TAMANOS.tarjeta.ancho / 2, y - 50, { variante: 'normal' }, { tarjetaId })
    // La primera vez, se explica qué es (y no se vuelve a decir).
    const p = usePreferencias.getState()
    if (id && !p.vistos['tarjeta-en-lienzo']) {
      p.marcarVisto('tarjeta-en-lienzo')
      avisar({ texto: 'Es la misma tarjeta del Kanban: doble clic para abrirla.', duracion: 6000 })
    }
    return id
  }

  /**
   * Sube una imagen y la deja centrada en (x, y). Mientras sube se ve un rectángulo del tamaño final con el avance (el
   * tamaño se lee del archivo antes de subirlo); la imagen aparece recién cargada, sin parpadeo.
   */
  const agregarImagen = async (archivo: File, x: number, y: number) => {
    let ancho = 360
    let alto = 260
    try {
      const b = await createImageBitmap(archivo)
      if (b.width) {
        ancho = Math.min(480, b.width)
        alto = Math.round((ancho * b.height) / b.width)
      }
      b.close()
    } catch {
      // Un formato que el navegador no lee de antemano: el tamaño de fábrica.
    }
    const caja = { id: idLocal(), x: Math.round(x - ancho / 2), y: Math.round(y - alto / 2), ancho, alto }
    const lienzo = useLienzo.getState()
    lienzo.set({ subidas: [...lienzo.subidas, caja] })
    try {
      const { url, nombre } = await api.subirArchivo(archivo)
      const img = new Image()
      img.src = url
      await img.decode().catch(() => {})
      return await crear('imagen', caja.x, caja.y, { url, titulo: nombre }, { ancho, alto })
    } catch (e) {
      avisarError(e)
      return null
    } finally {
      useLienzo.getState().set({ subidas: useLienzo.getState().subidas.filter((s) => s.id !== caja.id) })
    }
  }

  /** Trae una lista del Kanban entera (la columna viva). Si ya está en el lienzo, va a ella. */
  const agregarLista = async (listaId: string, x: number, y: number) => {
    const ya = tienda().tablero?.elementos.find((e) => e.tipo === 'lista' && e.listaId === listaId)
    if (ya) {
      irA([ya.id])
      seleccionar([ya.id])
      tienda().destellar(ya.id)
      return ya.id
    }
    return crear('lista', x - TAMANOS.lista.ancho / 2, y - 40, {}, { listaId })
  }

  /** Qué crea "igual al origen": el mismo tipo, tamaño y estilo, vacío (null si no tiene sentido: tarjeta, imagen…). */
  const igualA = (e: ElementoLienzo): { tipo: TipoElemento; datos: Record<string, unknown>; ancho: number; alto: number } | null => {
    if (e.tipo !== 'nota' && e.tipo !== 'texto' && e.tipo !== 'forma' && e.tipo !== 'marco') return null
    const { texto: _t, rico: _r, titulo: _ti, ...estilo } = e.datos as Record<string, unknown>
    return {
      tipo: e.tipo,
      datos: e.tipo === 'marco' ? { ...estilo, titulo: '' } : { ...estilo, texto: '' },
      ancho: e.ancho,
      alto: e.tipo === 'texto' ? TAMANOS.texto.alto : e.alto,
    }
  }

  /**
   * Crea un objeto con el lado que mira al origen centrado en `punto` y lo conecta desde el origen, en un solo paso de
   * deshacer. El objeto nuevo queda seleccionado y, si tiene texto, en edición. Devuelve su id.
   */
  const crearYConectar = async (
    origenId: string,
    desdeLado: Lado | null,
    punto: { x: number; y: number },
    opcion: OpcionCrear,
    /** El lado del objeto nuevo que mira al origen (si no, se calcula del punto). */
    ladoLlegada?: Lado,
  ) => {
    const n = rf.getNode(origenId)
    if (!n) return null
    const origen = n.data.elemento
    const lado = ladoLlegada ?? ladoHaciaOrigen(cajaNodo(n), punto)
    const fabrica = usePreferencias.getState().estilos
    const estiloConector = fabrica.conector
    let creado: string | null = null
    try {
      await enUnPaso('crear y conectar', async () => {
        let tarjetaId: string | null = null
        let plan: { tipo: TipoElemento; datos: Record<string, unknown>; ancho: number; alto: number } | null = null
        switch (opcion.tipo) {
          case 'igual':
            plan = igualA(origen) ?? { tipo: 'nota', datos: { texto: '', ...fabrica.nota }, ancho: TAMANOS.nota.ancho, alto: TAMANOS.nota.alto }
            break
          case 'nota':
            plan = { tipo: 'nota', datos: { texto: '', ...fabrica.nota }, ancho: TAMANOS.nota.ancho, alto: TAMANOS.nota.alto }
            break
          case 'texto':
            plan = { tipo: 'texto', datos: { texto: '', ...fabrica.texto, anchoAuto: true }, ancho: 200, alto: TAMANOS.texto.alto }
            break
          case 'forma':
            plan = {
              tipo: 'forma',
              datos: { texto: '', ...fabrica.forma, ...(opcion.forma ? { forma: opcion.forma } : {}) },
              ancho: TAMANOS.forma.ancho,
              alto: TAMANOS.forma.alto,
            }
            if (opcion.forma) usePreferencias.getState().recordar('forma', { forma: opcion.forma })
            break
          case 'marco':
            plan = { tipo: 'marco', datos: { titulo: '', ...fabrica.marco }, ancho: 640, alto: 420 }
            break
          case 'tarjeta-nueva': {
            const t = await tienda().crearTarjeta(opcion.listaId ?? '', opcion.titulo)
            if (!t) throw new Error('No se pudo crear la tarjeta.')
            tarjetaId = t.id
            break
          }
          case 'tarjeta':
            tarjetaId = opcion.tarjetaId
            break
        }
        let id: string
        if (tarjetaId) {
          // Si la tarjeta ya está en el lienzo, se conecta a esa (no se duplica).
          const ya = tienda().tablero?.elementos.find((e) => e.tarjetaId === tarjetaId)
          if (ya) id = ya.id
          else {
            const ancho = TAMANOS.tarjeta.ancho
            const caja = cajaConLado(ancho, 120, lado, punto)
            id = idLocal()
            const p = tienda().crearElemento({ id, tipo: 'tarjeta', x: Math.round(caja.x), y: Math.round(caja.y), ancho, alto: 120, tarjetaId, datos: { variante: 'normal' } })
            const r = await p
            if (!r) throw new Error('No se pudo poner la tarjeta en el lienzo.')
          }
        } else {
          const caja = cajaConLado(plan!.ancho, plan!.alto, lado, punto)
          id = idLocal()
          const p = tienda().crearElemento({
            id,
            tipo: plan!.tipo,
            x: Math.round(caja.x),
            y: Math.round(caja.y),
            ancho: Math.round(plan!.ancho),
            alto: Math.round(plan!.alto),
            datos: plan!.datos,
          })
          // Queda en edición enseguida (el objeto ya está en pantalla mientras el servidor lo guarda).
          creado = id
          requestAnimationFrame(() => {
            seleccionar([id])
            if (plan!.tipo === 'nota' || plan!.tipo === 'texto' || plan!.tipo === 'forma' || plan!.tipo === 'marco') tienda().setEditando(id)
          })
          if (!(await p)) throw new Error('No se pudo crear el objeto.')
        }
        creado = id
        const c = await tienda().crearConector({ desdeId: origenId, desdeLado, hastaId: id, ...estiloConector }, { sinAnimacion: true })
        if (!c) throw new Error('No se pudo conectar.')
      })
    } catch (e) {
      if (creado) tienda().setEditando(null)
      avisarError(e)
      return null
    }
    if (creado && opcion.tipo.startsWith('tarjeta')) requestAnimationFrame(() => seleccionar([creado!]))
    return creado
  }

  /**
   * "El siguiente paso" (5.7.5): un clic en un punto de conexión crea un objeto igual al de origen a 80 px en esa
   * dirección (corrido de a 40 px si el lugar está ocupado), conectado y en edición. En una tarjeta (o lo que no se
   * duplica) devuelve null: el lienzo abre el menú "Crear y conectar" en ese punto.
   */
  const siguientePaso = async (origenId: string, lado: Lado) => {
    const n = rf.getNode(origenId)
    if (!n) return null
    const plan = igualA(n.data.elemento)
    if (!plan) return null
    const b = cajaNodo(n)
    const w = plan.tipo === 'texto' ? b.w : plan.ancho
    const h = plan.tipo === 'texto' ? b.h : plan.alto
    const sep = 80
    let x = lado === 'derecha' ? b.x + b.w + sep : lado === 'izquierda' ? b.x - sep - w : b.x + (b.w - w) / 2
    let y = lado === 'abajo' ? b.y + b.h + sep : lado === 'arriba' ? b.y - sep - h : b.y + (b.h - h) / 2
    const horizontal = lado === 'derecha' || lado === 'izquierda'
    const ocupado = (x: number, y: number) =>
      rf.getIntersectingNodes({ x: x + 1, y: y + 1, width: w - 2, height: h - 2 }, true).some((o) => o.type !== 'marco' && o.id !== origenId)
    for (let i = 0; i < 40 && ocupado(x, y); i++) {
      if (horizontal) y += 40
      else x += 40
    }
    // El punto donde queda el medio del lado que mira al origen.
    const punto = horizontal ? { x: lado === 'derecha' ? x : x + w, y: y + h / 2 } : { x: x + w / 2, y: lado === 'abajo' ? y : y + h }
    return crearYConectar(origenId, lado, punto, { tipo: 'igual' }, LADO_OPUESTO[lado])
  }

  /**
   * Convierte el objeto seleccionado (nota, texto o forma) en otra de esas cosas o en una tarjeta del Kanban, en el
   * mismo lugar y con sus conectores. Queda seleccionado lo nuevo.
   */
  const convertir = async (a: 'tarjeta' | 'nota' | 'texto' | 'forma', listaId?: string | null, id?: string) => {
    const objetivo = id ?? seleccion().nodos[0]?.id
    if (!objetivo) return null
    const nuevo = await tienda().convertirElemento(objetivo, a, listaId)
    if (nuevo) setTimeout(() => seleccionar([nuevo.id]), 0)
    return nuevo?.id ?? null
  }

  /**
   * Tab y Mayús + Tab (9.3): el objeto siguiente (o el anterior) en orden de lectura queda seleccionado, a la vista y
   * con el foco (el lector de pantalla lee su nombre). Devuelve false en las puntas: ahí Tab sale del lienzo.
   */
  const recorrer = (paso: 1 | -1): boolean => {
    const els = ordenDeLectura(tienda().tablero?.elementos ?? [])
    if (!els.length) return false
    const enFoco = (document.activeElement as HTMLElement | null)?.closest('.react-flow__node')?.getAttribute('data-id')
    const sel = seleccion().nodos
    const actual = enFoco ?? (sel.length === 1 ? sel[0]!.id : null)
    const i = actual ? els.findIndex((e) => e.id === actual) : -1
    const j = i === -1 ? (paso === 1 ? 0 : els.length - 1) : i + paso
    if (j < 0 || j >= els.length) return false
    const e = els[j]!
    seleccionar([e.id])
    // A la vista: si no entra entero en la pantalla, se centra (sin cambiar el zoom, salvo que no entre).
    const el = ctx.contenedor()
    if (el) {
      const { x, y, zoom } = rf.getViewport()
      const W = el.clientWidth
      const H = el.clientHeight
      const caja = { x: e.x * zoom + x, y: e.y * zoom + y, w: e.ancho * zoom, h: e.alto * zoom }
      const visible = caja.x >= 16 && caja.y >= 68 && caja.x + caja.w <= W - 16 && caja.y + caja.h <= H - 92
      if (!visible) {
        if (caja.w > W - 64 || caja.h > H - 180) encuadrar({ x: e.x, y: e.y, ancho: e.ancho, alto: e.alto }, { ...ENCUADRES.seleccion, duracion: 260 })
        else rf.setCenter(e.x + e.ancho / 2, e.y + e.alto / 2, { zoom, duration: movimientoReducido() ? 0 : 260 })
      }
    }
    // El nodo puede no estar dibujado todavía (solo se dibuja lo visible): se reintenta unos cuadros.
    let intentos = 0
    const enfocar = () => {
      const nodo = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(e.id)}"]`)
      if (nodo) nodo.focus({ preventScroll: true })
      else if (intentos++ < 30) requestAnimationFrame(enfocar)
    }
    requestAnimationFrame(enfocar)
    return true
  }

  return {
    seleccion,
    seleccionar,
    recorrer,
    convertir,
    crearYConectar,
    siguientePaso,
    nodoBajo,
    encuadrar,
    verTodo,
    zoomSeleccion,
    irA,
    irAMarco,
    marcoEnPantalla,
    marcoSiguiente,
    contenidoDe,
    ajustarMarco,
    tamanoMarco,
    agruparEnMarco,
    borrarConContenido,
    copiar,
    cortar,
    pegarRecorte,
    centro,
    crear,
    duplicar,
    borrar,
    mover,
    bloquear,
    apilar,
    alinear,
    copiarEstilo,
    pegarEstilo,
    agregarTarjeta,
    agregarImagen,
    agregarLista,
  }
}

export type AccionesLienzo = ReturnType<typeof crearAcciones>

/** Acciones del lienzo (dentro del ReactFlowProvider y del lienzo). */
export function useAccionesLienzo(): AccionesLienzo {
  const rf = useReactFlow<NodoLienzo, AristaConector>()
  const ctx = useContext(ContextoLienzo)
  if (!ctx) throw new Error('useAccionesLienzo va dentro del lienzo.')
  return useMemo(() => crearAcciones(rf, ctx), [rf, ctx])
}
