import { create } from 'zustand'
import { generateKeyBetween } from 'fractional-indexing'
import type {
  Actividad,
  Conector,
  ElementoLienzo,
  Evento,
  InfoConexion,
  Lista,
  Miembro,
  Proyecto,
  TableroCompleto,
  TableroResumen,
  TarjetaDetalle,
  TarjetaResumen,
} from '../../../compartido/tipos'
import { api, clienteId } from './api'
import { aplicarOperaciones, leerTabla, medidaTabla, type OperacionTabla } from '../../../compartido/tabla'
import { avisar, avisarError } from './avisos'
import { deshacerEste, olvidarCreacion, registrarPaso } from './deshacer'
import { movimientoReducido } from '../util/movimiento'
import { irA } from './ruta'

export type Tema = 'claro' | 'oscuro' | 'sistema'
export type Herramienta = 'seleccionar' | 'mano' | 'nota' | 'texto' | 'forma' | 'marco' | 'conector' | 'tarjeta'

export const idLocal = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now())
    .replace(/-/g, '')
    .slice(0, 14)

function claveEntre(a: string | null, b: string | null) {
  try {
    if (a && b && a >= b) return generateKeyBetween(a, null)
    return generateKeyBetween(a, b)
  } catch {
    return generateKeyBetween(a, null)
  }
}

export const porOrden = <T extends { orden: string; id: string }>(a: T, b: T) =>
  a.orden < b.orden ? -1 : a.orden > b.orden ? 1 : a.id < b.id ? -1 : 1

// Índices por id memorizados por la referencia de la lista: los nodos del lienzo dejan de hacer `find` sobre todo el
// tablero en cada cambio. La lista cambia de referencia solo cuando cambia algo de ella.
const indices = new WeakMap<object, Map<string, unknown>>()
export function porId<T extends { id: string }>(lista: readonly T[]): Map<string, T> {
  let m = indices.get(lista) as Map<string, T> | undefined
  if (!m) {
    m = new Map(lista.map((x) => [x.id, x]))
    indices.set(lista, m)
  }
  return m
}

interface Tienda {
  listo: boolean
  proyectos: Proyecto[]
  miembros: Miembro[]
  info: InfoConexion | null
  tablero: TableroCompleto | null
  cargandoTablero: boolean
  errorTablero: string | null
  enVivo: boolean
  iaTrabajando: { nombre: string; hasta: number } | null
  filtro: string
  claveAbierta: string | null
  origenApertura: { x: number; y: number; ancho: number; alto: number } | null
  detalle: TarjetaDetalle | null
  destellos: Record<string, number>
  actividad: Actividad[]
  tema: Tema
  lateralAbierto: boolean
  panel: null | 'actividad' | 'archivadas'
  dialogo: null | 'paleta' | 'atajos' | 'conectar' | 'nuevo-proyecto' | 'nuevo-tablero' | 'editar-proyecto' | 'configuracion'
  /** El proyecto del diálogo "Editar proyecto" (null: el del tablero abierto). */
  proyectoDialogo: string | null
  /** La sección abierta de Configuración (por ejemplo, "lienzo" desde el engranaje del lienzo; sin pedir una, la última). */
  seccionConfiguracion: string | null
  // lienzo
  herramienta: Herramienta
  /** La herramienta queda activa después de crear (doble clic o tecla dos veces). */
  herramientaFija: boolean
  minimapa: boolean
  grilla: boolean
  editando: string | null
  /** Objetos que acaban de aparecer (entran con escala y opacidad): creados acá o por otro (la IA, otra pestaña). */
  nuevos: ReadonlyMap<string, 'aca' | 'remoto'>
  /** Objetos que se están yendo: se quitan de verdad 120 ms después (salen con escala y opacidad). */
  saliendo: ReadonlySet<string>

  cargarInicio: () => Promise<void>
  abrirTablero: (id: string) => Promise<void>
  recargarTablero: () => Promise<void>
  aplicarEvento: (e: Evento) => void
  setFiltro: (f: string) => void
  setTema: (t: Tema) => void
  setDialogo: (d: Tienda['dialogo']) => void
  /** Abre "Editar proyecto" para ese proyecto (de fábrica, el del tablero abierto). */
  editarProyecto: (id?: string) => void
  /** Abre «Nuevo tablero» (nombre y tipo) en ese proyecto (de fábrica, el del tablero abierto). */
  nuevoTablero: (id?: string) => void
  /** El tablero cuyo panel «Vistas» está abierto (null: ninguno). Lo abre la paleta; la barra lateral lo abre desde su menú. */
  vistasDe: string | null
  abrirVistas: (tableroId: string | null) => void
  /** Abre Configuración en una sección (sin sección: en la última que se miró). */
  abrirConfiguracion: (seccion?: string) => void
  /** Cambia un proyecto al instante (y vuelve atrás si el servidor no lo acepta). */
  actualizarProyecto: (id: string, cambios: Parameters<typeof api.actualizarProyecto>[1]) => Promise<Proyecto | null>
  /** Sube la foto del proyecto (ya recortada). */
  subirImagenProyecto: (id: string, imagen: Blob) => Promise<Proyecto | null>
  /** Cambia el proyecto solo en esta pestaña (la vista previa del color mientras se edita). No guarda. */
  ponerProyectoLocal: (id: string, cambios: Partial<Proyecto>) => void
  /** Cambia un tablero al instante (nombre, descripción, ajustes del lienzo). */
  actualizarTablero: (id: string, cambios: Parameters<typeof api.actualizarTablero>[1]) => Promise<TableroResumen | null>
  /** Archiva (o restaura) un tablero, con aviso y "Deshacer". Si era el abierto, pasa al primero que queda. */
  archivarTablero: (id: string, archivar?: boolean) => Promise<void>
  /** Archiva (o restaura) un proyecto, con aviso y "Deshacer". Si era el abierto, pasa al primero que queda. */
  archivarProyecto: (id: string, archivar?: boolean) => Promise<void>
  setPanel: (p: Tienda['panel']) => void
  alternarLateral: () => void
  destellar: (id: string) => void

  abrirTarjeta: (clave: string, origen?: DOMRect | null) => void
  cerrarTarjeta: () => void
  recargarDetalle: () => Promise<void>

  ponerTarjeta: (t: TarjetaResumen) => void
  crearTarjeta: (
    listaId: string,
    titulo: string,
    extra?: Record<string, unknown>,
    posicion?: 'arriba' | 'abajo' | number,
  ) => Promise<TarjetaResumen | null>
  actualizarTarjeta: (id: string, cambios: Record<string, unknown>, parcialLocal?: Partial<TarjetaResumen>) => Promise<void>
  moverTarjeta: (id: string, listaId: string, indice: number, opciones?: { registrar?: boolean }) => Promise<void>
  archivarTarjeta: (id: string, archivar?: boolean, opciones?: { registrar?: boolean }) => Promise<void>

  crearLista: (nombre: string) => Promise<void>
  actualizarLista: (id: string, cambios: Partial<Lista>) => Promise<void>
  moverLista: (id: string, indice: number) => Promise<void>

  crearElemento: (e: Partial<ElementoLienzo> & Pick<ElementoLienzo, 'tipo' | 'x' | 'y'>, opciones?: { registrar?: boolean }) => Promise<ElementoLienzo | null>
  actualizarElementos: (
    cambios: (Partial<ElementoLienzo> & { id: string })[],
    opciones?: { registrar?: string | false; local?: boolean },
  ) => Promise<void>
  /**
   * Cambia una tabla con operaciones: se ve al instante (las mismas reglas que el servidor), se manda y queda un paso para
   * deshacer. Devuelve los avisos (por ejemplo, valores que no encajaron y quedaron vacíos), o null si no se pudo.
   */
  operarTabla: (
    id: string,
    ops: OperacionTabla[],
    opciones?: { etiqueta?: string | false; cambios?: Record<string, unknown> },
  ) => Promise<string[] | null>
  eliminarSeleccion: (elementos: string[], conectores: string[], opciones?: { registrar?: boolean }) => Promise<void>
  /** Descarta un objeto que quedó vacío al terminar de escribirlo: si recién se creaba, se va sin dejar paso de deshacer. */
  descartarVacio: (id: string) => Promise<void>
  /**
   * Convierte una nota, un texto o una forma en otra de esas cosas o en una tarjeta del Kanban, en un solo paso de
   * deshacer (el objeto nuevo queda en el mismo lugar, con los conectores del viejo).
   */
  convertirElemento: (id: string, a: 'tarjeta' | 'nota' | 'texto' | 'forma', listaId?: string | null) => Promise<ElementoLienzo | null>
  crearConector: (c: Partial<Conector> & { desdeId: string; hastaId: string }, opciones?: { sinAnimacion?: boolean }) => Promise<Conector | null>
  actualizarConector: (id: string, cambios: Partial<Conector>) => Promise<void>
  setHerramienta: (h: Herramienta, fija?: boolean) => void
  setEditando: (id: string | null) => void
  alternarMinimapa: () => void
  alternarGrilla: () => void
}

const temaGuardado = (localStorage.getItem('tablero.tema') as Tema | null) ?? 'sistema'

let relojTema: ReturnType<typeof setTimeout> | null = null

/** Pone el tema en <html>. Al cambiarlo con la app abierta, fondos y textos se funden en 200 ms (sin salto). */
export function aplicarTema(t: Tema, animar = false) {
  const oscuro = t === 'oscuro' || (t === 'sistema' && matchMedia('(prefers-color-scheme: dark)').matches)
  const html = document.documentElement
  const nuevo = oscuro ? 'dark' : 'light'
  if (animar && html.dataset.theme !== nuevo && !movimientoReducido()) {
    html.classList.add('tema-cambiando')
    if (relojTema) clearTimeout(relojTema)
    relojTema = setTimeout(() => html.classList.remove('tema-cambiando'), 240)
  }
  html.dataset.theme = nuevo
}

let temporizadorDetalle: ReturnType<typeof setTimeout> | null = null

/** Objetos del lienzo que se están creando en el servidor: un cambio sobre ellos espera a que existan allá. */
const creandose = new Map<string, Promise<unknown>>()
/** ¿Ese objeto todavía se está creando en el servidor? */
export const estaCreandose = (id: string) => creandose.has(id)
const esperarCreacion = async (ids: string[]) => {
  const p = ids.map((id) => creandose.get(id)).filter(Boolean)
  if (p.length) await Promise.allSettled(p)
}

export const useTienda = create<Tienda>((set, get) => {
  const enTablero = (fn: (t: TableroCompleto) => TableroCompleto) => {
    const t = get().tablero
    if (t) set({ tablero: fn(t) })
  }
  const cambiarTarjetas = (fn: (ts: TarjetaResumen[]) => TarjetaResumen[]) =>
    enTablero((t) => ({ ...t, tarjetas: fn(t.tarjetas) }))
  const cambiarElementos = (fn: (es: ElementoLienzo[]) => ElementoLienzo[]) =>
    enTablero((t) => ({ ...t, elementos: fn(t.elementos) }))
  const cambiarConectores = (fn: (cs: Conector[]) => Conector[]) =>
    enTablero((t) => ({ ...t, conectores: fn(t.conectores) }))

  // Entradas y salidas de los objetos del lienzo (9.1): la clase la pone el lienzo según estos conjuntos.
  const marcarNuevos = (ids: string[], origen: 'aca' | 'remoto') => {
    if (!ids.length) return
    const m = new Map(get().nuevos)
    for (const id of ids) m.set(id, origen)
    set({ nuevos: m })
    setTimeout(
      () => {
        const n = new Map(get().nuevos)
        for (const id of ids) n.delete(id)
        set({ nuevos: n })
      },
      origen === 'aca' ? 300 : 420,
    )
  }
  const quitarConSalida = (ids: string[], quitar: () => void) => {
    if (!ids.length) return quitar()
    set({ saliendo: new Set([...get().saliendo, ...ids]) })
    setTimeout(() => {
      quitar()
      const s2 = new Set(get().saliendo)
      for (const id of ids) s2.delete(id)
      set({ saliendo: s2 })
    }, 120)
  }

  const recargarDetalleLuego = (id: string) => {
    const d = get().detalle
    if (!d || d.id !== id) return
    if (temporizadorDetalle) clearTimeout(temporizadorDetalle)
    temporizadorDetalle = setTimeout(() => get().recargarDetalle(), 120)
  }

  return {
    listo: false,
    proyectos: [],
    miembros: [],
    info: null,
    tablero: null,
    cargandoTablero: false,
    errorTablero: null,
    enVivo: false,
    iaTrabajando: null,
    filtro: '',
    claveAbierta: null,
    origenApertura: null,
    detalle: null,
    destellos: {},
    actividad: [],
    tema: temaGuardado,
    lateralAbierto: localStorage.getItem('tablero.lateral') !== 'no',
    panel: null,
    dialogo: null,
    proyectoDialogo: null,
    vistasDe: null,
    seccionConfiguracion: null,
    herramienta: 'seleccionar',
    herramientaFija: false,
    minimapa: localStorage.getItem('tablero.minimapa') !== 'no',
    grilla: localStorage.getItem('tablero.grilla') !== 'no',
    editando: null,
    nuevos: new Map(),
    saliendo: new Set(),

    async cargarInicio() {
      const [proyectos, miembros, info] = await Promise.all([api.proyectos(), api.miembros(), api.info().catch(() => null)])
      set({ proyectos, miembros, info, listo: true })
    },

    async abrirTablero(id) {
      if (get().tablero?.tablero.id !== id) set({ cargandoTablero: true, errorTablero: null })
      try {
        const t = await api.tablero(id)
        set({ tablero: t, cargandoTablero: false, miembros: t.miembros })
        api.actividad(id, 60).then((a) => set({ actividad: a })).catch(() => {})
      } catch (e) {
        set({ cargandoTablero: false, errorTablero: (e as Error).message })
      }
    },

    async recargarTablero() {
      const id = get().tablero?.tablero.id
      if (!id) return
      try {
        const t = await api.tablero(id)
        set({ tablero: t, miembros: t.miembros })
      } catch {
        // se reintenta con el próximo evento
      }
    },

    aplicarEvento(e) {
      const propio = e.clienteId === clienteId
      const t = get().tablero
      const deEsteTablero = t && (!e.tableroId || e.tableroId === t.tablero.id)
      if (e.tipo === 'actividad') {
        const act = e.datos as Actividad
        if (deEsteTablero) set({ actividad: [act, ...get().actividad].slice(0, 200) })
        if (!propio && e.actor.tipo === 'ia') {
          set({ iaTrabajando: { nombre: e.actor.nombre, hasta: Date.now() + 6000 } })
          avisar({ texto: `${e.actor.nombre} ${act.resumen}`, tipo: 'ia', actor: e.actor, duracion: 5200 })
        }
        return
      }
      if (e.tipo === 'proyecto' || e.tipo === 'tablero') {
        api.proyectos().then((proyectos) => set({ proyectos })).catch(() => {})
        if (t && e.tipo === 'proyecto' && e.proyectoId === t.proyecto.id && !propio) {
          const p = e.datos as Proyecto
          enTablero((x) => ({ ...x, proyecto: { ...x.proyecto, ...p } }))
        }
        if (t && e.tipo === 'tablero' && e.tableroId === t.tablero.id && !propio) {
          enTablero((x) => ({ ...x, tablero: { ...x.tablero, ...(e.datos as object) } }))
          // Si cambiaron las vistas (la IA, otra pestaña), puede haber listas nuevas: se vuelve a leer el tablero.
          const nuevas = (e.datos as Partial<TableroResumen>).vistas
          if (nuevas && nuevas.join() !== (t.tablero.vistas ?? []).join()) void get().recargarTablero()
        }
        return
      }
      if (e.tipo === 'miembro') {
        api.miembros().then((miembros) => {
          set({ miembros })
          enTablero((x) => ({ ...x, miembros }))
        })
        return
      }
      if (!t) return
      if (e.tipo === 'etiqueta') {
        if (e.proyectoId && e.proyectoId !== t.proyecto.id) return
        const et = e.datos as { id: string }
        if (e.accion === 'eliminada')
          enTablero((x) => ({ ...x, etiquetas: x.etiquetas.filter((y) => y.id !== et.id) }))
        else
          enTablero((x) => ({
            ...x,
            etiquetas: x.etiquetas.some((y) => y.id === et.id)
              ? x.etiquetas.map((y) => (y.id === et.id ? (e.datos as typeof y) : y))
              : [...x.etiquetas, e.datos as (typeof x.etiquetas)[number]],
          }))
        return
      }
      if (!deEsteTablero) {
        if (e.tipo === 'tarjeta' && e.accion === 'salio') cambiarTarjetas((ts) => ts.filter((x) => x.id !== e.tarjetaId))
        return
      }
      if (e.tipo === 'tarjeta') {
        const r = e.datos as TarjetaResumen
        if (e.accion === 'salio') {
          if (!propio) cambiarTarjetas((ts) => ts.filter((x) => x.id !== e.tarjetaId))
          return
        }
        if (!propio) {
          get().ponerTarjeta(r)
          if (e.actor.tipo !== 'humano') get().destellar(r.id)
        }
        recargarDetalleLuego(r.id)
        return
      }
      if (propio) return
      if (e.tipo === 'lista') {
        const l = e.datos as Lista
        enTablero((x) => ({
          ...x,
          listas: (l.archivada
            ? x.listas.filter((y) => y.id !== l.id)
            : x.listas.some((y) => y.id === l.id)
              ? x.listas.map((y) => (y.id === l.id ? l : y))
              : [...x.listas, l]
          ).sort(porOrden),
        }))
        return
      }
      if (e.tipo === 'lienzo' && e.accion === 'lote') {
        // Un diagrama armado de una vez (hasta 300 objetos y 600 conectores): entra todo junto y se destella una sola vez.
        const d = e.datos as { elementos: ElementoLienzo[]; conectores: Conector[] }
        const t = get().tablero
        if (!t) return
        const yaEl = new Set(t.elementos.map((y) => y.id))
        const yaCo = new Set(t.conectores.map((y) => y.id))
        const nuevosEl = (d.elementos ?? []).filter((y) => !yaEl.has(y.id))
        const nuevosCo = (d.conectores ?? []).filter((y) => !yaCo.has(y.id))
        marcarNuevos([...nuevosEl.map((y) => y.id), ...nuevosCo.map((y) => y.id)], 'remoto')
        if (nuevosEl.length) cambiarElementos((es) => [...es, ...nuevosEl])
        if (nuevosCo.length) cambiarConectores((cs) => [...cs, ...nuevosCo])
        if (e.actor.tipo !== 'humano' && nuevosEl[0]) get().destellar(nuevosEl[0].id)
        return
      }
      if (e.tipo === 'elemento') {
        const el = e.datos as ElementoLienzo
        if (e.accion === 'eliminado') quitarConSalida([el.id], () => cambiarElementos((es) => es.filter((y) => y.id !== el.id)))
        else {
          const existe = get().tablero?.elementos.some((y) => y.id === el.id)
          if (!existe) marcarNuevos([el.id], 'remoto')
          cambiarElementos((es) => (existe ? es.map((y) => (y.id === el.id ? el : y)) : [...es, el]))
          if (e.actor.tipo !== 'humano') get().destellar(el.id)
        }
        return
      }
      if (e.tipo === 'conector') {
        const c = e.datos as Conector
        if (e.accion === 'eliminado') cambiarConectores((cs) => cs.filter((y) => y.id !== c.id))
        else {
          const existe = get().tablero?.conectores.some((y) => y.id === c.id)
          if (!existe) marcarNuevos([c.id], 'remoto')
          cambiarConectores((cs) => (existe ? cs.map((y) => (y.id === c.id ? c : y)) : [...cs, c]))
        }
      }
    },

    setFiltro: (filtro) => set({ filtro }),
    setTema(tema) {
      localStorage.setItem('tablero.tema', tema)
      aplicarTema(tema, true)
      set({ tema })
    },
    setDialogo: (dialogo) => set({ dialogo, ...(dialogo === 'editar-proyecto' || dialogo === 'nuevo-tablero' ? {} : { proyectoDialogo: null }) }),
    editarProyecto: (id) => set({ dialogo: 'editar-proyecto', proyectoDialogo: id ?? null }),
    nuevoTablero: (id) => set({ dialogo: 'nuevo-tablero', proyectoDialogo: id ?? null }),
    abrirVistas: (tableroId) => set({ vistasDe: tableroId }),
    abrirConfiguracion: (seccion) => set((s) => ({ dialogo: 'configuracion', seccionConfiguracion: seccion ?? s.seccionConfiguracion })),

    async actualizarProyecto(id, cambios) {
      const antes = get().proyectos.find((p) => p.id === id)
      const aplicar = (c: Partial<Proyecto>) => {
        set({ proyectos: get().proyectos.map((p) => (p.id === id ? { ...p, ...c } : p)) })
        if (get().tablero?.proyecto.id === id) enTablero((t) => ({ ...t, proyecto: { ...t.proyecto, ...c } }))
      }
      const { imagen, ...resto } = cambios
      aplicar({ ...resto, ...(imagen === null ? { imagen: null } : {}) } as Partial<Proyecto>)
      try {
        const r = await api.actualizarProyecto(id, cambios)
        aplicar(r)
        return r
      } catch (e) {
        if (antes) aplicar(antes)
        avisarError(e)
        return null
      }
    },

    ponerProyectoLocal(id, cambios) {
      set({ proyectos: get().proyectos.map((p) => (p.id === id ? { ...p, ...cambios } : p)) })
      if (get().tablero?.proyecto.id === id) enTablero((t) => ({ ...t, proyecto: { ...t.proyecto, ...cambios } }))
    },

    async subirImagenProyecto(id, imagen) {
      try {
        const r = await api.subirImagenProyecto(id, imagen)
        get().ponerProyectoLocal(id, { imagen: r.imagen, emoji: r.emoji })
        return r
      } catch (e) {
        avisarError(e)
        return null
      }
    },

    async actualizarTablero(id, cambios) {
      const buscar = () => get().proyectos.flatMap((p) => p.tableros).find((t) => t.id === id)
      const antes = buscar()
      const aplicar = (c: Partial<TableroResumen>) => {
        set({ proyectos: get().proyectos.map((p) => ({ ...p, tableros: p.tableros.map((t) => (t.id === id ? { ...t, ...c } : t)) })) })
        if (get().tablero?.tablero.id === id) enTablero((t) => ({ ...t, tablero: { ...t.tablero, ...c } }))
      }
      const { ajustes, ...resto } = cambios
      const previosAjustes = get().tablero?.tablero.id === id ? get().tablero!.tablero.ajustes : (antes?.ajustes ?? {})
      aplicar({
        ...resto,
        ...(ajustes ? { ajustes: { ...previosAjustes, ...ajustes, lienzo: { ...(previosAjustes.lienzo ?? {}), ...(ajustes.lienzo ?? {}) } } } : {}),
      })
      try {
        const r = await api.actualizarTablero(id, cambios)
        aplicar(r)
        // Sumar el Kanban a un tablero que nunca lo tuvo le crea sus listas: se vuelve a leer para tenerlas.
        if (cambios.vistas && get().tablero?.tablero.id === id) void get().recargarTablero()
        return r
      } catch (e) {
        if (antes) aplicar(antes)
        avisarError(e)
        return null
      }
    },

    async archivarTablero(id, archivar = true) {
      const proyecto = get().proyectos.find((p) => p.tableros.some((t) => t.id === id))
      const t = proyecto?.tableros.find((x) => x.id === id)
      try {
        await api.actualizarTablero(id, { archivado: archivar })
        const proyectos = await api.proyectos()
        set({ proyectos })
        // Si era el abierto, la app pasa al primero que queda en su proyecto.
        if (archivar && get().tablero?.tablero.id === id && proyecto) {
          const p = proyectos.find((x) => x.id === proyecto.id)
          irA({ prefijo: proyecto.prefijo, slug: p?.tableros[0]?.slug ?? null, tarjeta: null })
        }
        if (archivar && t)
          avisar({ texto: `Archivaste el tablero «${t.nombre}»`, accion: { etiqueta: 'Deshacer', fn: () => get().archivarTablero(id, false) } })
      } catch (e) {
        avisarError(e)
      }
    },

    async archivarProyecto(id, archivar = true) {
      const p = get().proyectos.find((x) => x.id === id)
      try {
        await api.actualizarProyecto(id, { archivado: archivar })
        const proyectos = await api.proyectos()
        set({ proyectos })
        if (archivar && get().tablero?.proyecto.id === id) {
          const otro = proyectos[0]
          irA(otro ? { prefijo: otro.prefijo, slug: otro.tableros[0]?.slug ?? null, tarjeta: null } : { prefijo: null, slug: null, tarjeta: null })
          // Si no queda ninguno, la escena queda vacía ("Creá tu primer proyecto").
          if (!otro) set({ tablero: null, claveAbierta: null, detalle: null })
        }
        if (archivar && p)
          avisar({ texto: `Archivaste el proyecto «${p.nombre}»`, accion: { etiqueta: 'Deshacer', fn: () => get().archivarProyecto(id, false) } })
      } catch (e) {
        avisarError(e)
      }
    },
    setPanel: (panel) => set({ panel: get().panel === panel ? null : panel }),
    alternarLateral() {
      const v = !get().lateralAbierto
      localStorage.setItem('tablero.lateral', v ? 'si' : 'no')
      set({ lateralAbierto: v })
    },
    destellar(id) {
      set({ destellos: { ...get().destellos, [id]: Date.now() } })
    },

    abrirTarjeta(clave, origen) {
      set({
        claveAbierta: clave,
        origenApertura: origen ? { x: origen.x, y: origen.y, ancho: origen.width, alto: origen.height } : null,
        detalle: get().detalle?.clave === clave ? get().detalle : null,
      })
      api
        .tarjeta(clave)
        .then((d) => {
          if (get().claveAbierta === clave || get().claveAbierta === d.clave) set({ detalle: d })
        })
        .catch((e) => {
          avisarError(e)
          set({ claveAbierta: null })
        })
    },
    cerrarTarjeta: () => set({ claveAbierta: null, origenApertura: null }),
    async recargarDetalle() {
      const clave = get().claveAbierta
      if (!clave) return
      try {
        const d = await api.tarjeta(clave)
        if (get().claveAbierta === clave) set({ detalle: d })
      } catch {
        // la tarjeta pudo cambiar de clave o desaparecer
      }
    },

    ponerTarjeta(r) {
      const t = get().tablero
      if (!t) return
      if (r.tableroId !== t.tablero.id) {
        cambiarTarjetas((ts) => ts.filter((x) => x.id !== r.id))
        return
      }
      cambiarTarjetas((ts) => {
        const i = ts.findIndex((x) => x.id === r.id)
        if (i === -1) return [...ts, r]
        if (ts[i]!.version > r.version) return ts
        const copia = ts.slice()
        copia[i] = r
        return copia
      })
      const d = get().detalle
      if (d && d.id === r.id) set({ detalle: { ...d, ...r } })
    },

    async crearTarjeta(listaId, titulo, extra = {}, posicion = 'abajo') {
      const t = get().tablero
      if (!t) return null
      const hermanas = t.tarjetas.filter((x) => x.listaId === listaId && !x.archivada).sort(porOrden)
      const indice = posicion === 'arriba' ? 0 : posicion === 'abajo' ? hermanas.length : posicion
      const temporal: TarjetaResumen = {
        id: 'tmp-' + idLocal(),
        clave: `${t.proyecto.prefijo}-…`,
        numero: 0,
        proyectoId: t.proyecto.id,
        tableroId: t.tablero.id,
        listaId,
        orden: claveEntre(hermanas[indice - 1]?.orden ?? null, hermanas[indice]?.orden ?? null),
        padreId: null,
        tipo: (extra.tipo as TarjetaResumen['tipo']) ?? 'tarea',
        titulo,
        prioridad: (extra.prioridad as TarjetaResumen['prioridad']) ?? 'ninguna',
        estimacion: null,
        etiquetas: [],
        responsables: [],
        // En una lista de Hecho nace completada (y entra arriba de todo, como lo hace el servidor).
        fechas: { inicio: null, vence: null, conHora: false, completada: t.listas.find((l) => l.id === listaId)?.categoria === 'hecho' ? new Date().toISOString() : null },
        portada: null,
        contadores: { comentarios: 0, adjuntos: 0, checklistHechos: 0, checklistTotal: 0, vinculos: 0, bloqueadaPor: 0, hijas: 0 },
        enlaces: [],
        porque: null,
        tieneDescripcion: false,
        discord: false,
        archivada: false,
        version: 0,
        creadaEn: new Date().toISOString(),
        actualizadaEn: new Date().toISOString(),
        origen: null,
      }
      cambiarTarjetas((ts) => [...ts, temporal])
      try {
        const r = await api.crearTarjeta({ tableroId: t.tablero.id, listaId, titulo, posicion: indice, ...extra })
        cambiarTarjetas((ts) => [...ts.filter((x) => x.id !== temporal.id && x.id !== r.id), r])
        get().destellar(r.id)
        registrarPaso({
          etiqueta: `crear ${r.clave}`,
          deshacer: () => get().archivarTarjeta(r.id, true, { registrar: false }),
          rehacer: () => get().archivarTarjeta(r.id, false, { registrar: false }),
        })
        return r
      } catch (e) {
        cambiarTarjetas((ts) => ts.filter((x) => x.id !== temporal.id))
        avisarError(e)
        return null
      }
    },

    async actualizarTarjeta(id, cambios, parcialLocal) {
      const antes = get().tablero?.tarjetas.find((x) => x.id === id)
      if (parcialLocal) cambiarTarjetas((ts) => ts.map((x) => (x.id === id ? { ...x, ...parcialLocal } : x)))
      try {
        const r = await api.actualizarTarjeta(id, cambios)
        get().ponerTarjeta(r)
        recargarDetalleLuego(id)
      } catch (e) {
        if (antes) cambiarTarjetas((ts) => ts.map((x) => (x.id === id ? antes : x)))
        avisarError(e)
      }
    },

    async moverTarjeta(id, listaId, indice, opciones = {}) {
      const t = get().tablero
      if (!t) return
      const tarjeta = t.tarjetas.find((x) => x.id === id)
      if (!tarjeta) return
      const anterior = { listaId: tarjeta.listaId, orden: tarjeta.orden }
      const hermanas = t.tarjetas.filter((x) => x.listaId === listaId && x.id !== id && !x.archivada).sort(porOrden)
      const i = Math.max(0, Math.min(indice, hermanas.length))
      const orden = claveEntre(hermanas[i - 1]?.orden ?? null, hermanas[i]?.orden ?? null)
      const indiceAnterior = t.tarjetas
        .filter((x) => x.listaId === anterior.listaId && !x.archivada)
        .sort(porOrden)
        .findIndex((x) => x.id === id)
      // Igual que el servidor: llegar a Hecho desde otra lista es «completada ahora» (queda arriba de todo); salir de Hecho, sin completar.
      const categoria = (lid: string | null) => t.listas.find((l) => l.id === lid)?.categoria ?? null
      const completada =
        categoria(listaId) === 'hecho'
          ? categoria(anterior.listaId) === 'hecho' && tarjeta.fechas.completada
            ? tarjeta.fechas.completada
            : new Date().toISOString()
          : categoria(anterior.listaId) === 'hecho'
            ? null
            : tarjeta.fechas.completada
      cambiarTarjetas((ts) => ts.map((x) => (x.id === id ? { ...x, listaId, orden, fechas: { ...x.fechas, completada } } : x)))
      get().destellar(id)
      try {
        const r = await api.moverTarjeta(id, listaId, i)
        get().ponerTarjeta(r)
        if (opciones.registrar !== false && anterior.listaId)
          registrarPaso({
            etiqueta: `mover ${r.clave}`,
            deshacer: () => get().moverTarjeta(id, anterior.listaId!, Math.max(indiceAnterior, 0), { registrar: false }),
            rehacer: () => get().moverTarjeta(id, listaId, i, { registrar: false }),
          })
      } catch (e) {
        cambiarTarjetas((ts) => ts.map((x) => (x.id === id ? { ...x, ...anterior, fechas: tarjeta.fechas } : x)))
        avisarError(e)
      }
    },

    async archivarTarjeta(id, archivar = true, opciones = {}) {
      const t = get().tablero
      const tarjeta = t?.tarjetas.find((x) => x.id === id)
      cambiarTarjetas((ts) => ts.map((x) => (x.id === id ? { ...x, archivada: archivar } : x)))
      try {
        const r = await api.archivarTarjeta(id, archivar)
        get().ponerTarjeta(r)
        if (opciones.registrar !== false)
          registrarPaso({
            etiqueta: `${archivar ? 'archivar' : 'restaurar'} ${r.clave}`,
            deshacer: () => get().archivarTarjeta(id, !archivar, { registrar: false }),
            rehacer: () => get().archivarTarjeta(id, archivar, { registrar: false }),
          })
        if (archivar && opciones.registrar !== false) {
          if (get().claveAbierta === r.clave) get().cerrarTarjeta()
          avisar({
            texto: `Archivaste ${r.clave}`,
            accion: { etiqueta: 'Deshacer', fn: () => get().archivarTarjeta(id, false, { registrar: false }) },
          })
        }
      } catch (e) {
        if (tarjeta) cambiarTarjetas((ts) => ts.map((x) => (x.id === id ? tarjeta : x)))
        avisarError(e)
      }
    },

    async crearLista(nombre) {
      const t = get().tablero
      if (!t) return
      const id = idLocal()
      const ultima = [...t.listas].sort(porOrden).at(-1)
      const lista: Lista = {
        id,
        tableroId: t.tablero.id,
        nombre,
        orden: claveEntre(ultima?.orden ?? null, null),
        categoria: null,
        color: null,
        limite: null,
        archivada: false,
      }
      enTablero((x) => ({ ...x, listas: [...x.listas, lista] }))
      try {
        const r = await api.crearLista({ id, tableroId: t.tablero.id, nombre })
        enTablero((x) => ({ ...x, listas: x.listas.map((y) => (y.id === id ? r : y)).sort(porOrden) }))
      } catch (e) {
        enTablero((x) => ({ ...x, listas: x.listas.filter((y) => y.id !== id) }))
        avisarError(e)
      }
    },

    async actualizarLista(id, cambios) {
      const antes = get().tablero?.listas.find((x) => x.id === id)
      enTablero((x) => ({
        ...x,
        listas: cambios.archivada ? x.listas.filter((y) => y.id !== id) : x.listas.map((y) => (y.id === id ? { ...y, ...cambios } : y)),
      }))
      try {
        const r = await api.actualizarLista(id, cambios)
        if (!r.archivada) enTablero((x) => ({ ...x, listas: x.listas.map((y) => (y.id === id ? r : y)) }))
        if (cambios.archivada && antes)
          avisar({
            texto: `Archivaste la lista «${antes.nombre}»`,
            accion: {
              etiqueta: 'Deshacer',
              fn: async () => {
                const l = await api.actualizarLista(id, { archivada: false })
                enTablero((x) => ({ ...x, listas: [...x.listas, l].sort(porOrden) }))
              },
            },
          })
      } catch (e) {
        if (antes) enTablero((x) => ({ ...x, listas: [...x.listas.filter((y) => y.id !== id), antes].sort(porOrden) }))
        avisarError(e)
      }
    },

    async moverLista(id, indice) {
      const t = get().tablero
      if (!t) return
      const otras = t.listas.filter((x) => x.id !== id).sort(porOrden)
      const orden = claveEntre(otras[indice - 1]?.orden ?? null, otras[indice]?.orden ?? null)
      enTablero((x) => ({ ...x, listas: x.listas.map((y) => (y.id === id ? { ...y, orden } : y)).sort(porOrden) }))
      try {
        await api.actualizarLista(id, { indice })
      } catch (e) {
        avisarError(e)
        get().recargarTablero()
      }
    },

    async crearElemento(datos, opciones = {}) {
      const t = get().tablero
      if (!t) return null
      const id = datos.id ?? idLocal()
      const zMax = Math.max(0, ...t.elementos.map((e) => e.z))
      const el: ElementoLienzo = {
        id,
        tableroId: t.tablero.id,
        tipo: datos.tipo,
        x: datos.x,
        y: datos.y,
        ancho: datos.ancho ?? 220,
        alto: datos.alto ?? 220,
        z: datos.z ?? (datos.tipo === 'marco' ? 0 : zMax + 1),
        tarjetaId: datos.tarjetaId ?? null,
        listaId: datos.listaId ?? null,
        datos: datos.datos ?? {},
        bloqueado: false,
        actualizadoEn: new Date().toISOString(),
        creadoPor: null,
      }
      marcarNuevos([id], 'aca')
      cambiarElementos((es) => [...es, el])
      const enCurso = api.crearElemento(t.tablero.id, { ...el })
      creandose.set(id, enCurso)
      try {
        const r = await enCurso
        // Si mientras tanto ya se le escribió algo (o se movió), manda lo local: el servidor ya va a recibir el cambio.
        cambiarElementos((es) => es.map((x) => (x.id !== id ? x : x === el ? r : { ...x, actualizadoEn: r.actualizadoEn, creadoPor: r.creadoPor })))
        if (opciones.registrar !== false)
          registrarPaso({
            etiqueta: 'agregar al lienzo',
            creo: [id],
            deshacer: async () => {
              cambiarElementos((es) => es.filter((x) => x.id !== id))
              await api.eliminarElementos([id])
            },
            rehacer: async () => {
              const { elementos } = await api.restaurarElementos([id])
              cambiarElementos((es) => [...es.filter((x) => x.id !== id), ...elementos])
            },
          })
        return r
      } catch (e) {
        cambiarElementos((es) => es.filter((x) => x.id !== id))
        avisarError(e)
        return null
      } finally {
        creandose.delete(id)
      }
    },

    async actualizarElementos(cambiosPedidos, opciones = {}) {
      // Una clave con undefined no es un cambio (alinear manda solo x o solo y): si no, borraría el valor de antes.
      const cambios = cambiosPedidos.map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as typeof c)
      if (cambios.length === 0) return
      const antes = new Map((get().tablero?.elementos ?? []).map((e) => [e.id, e]))
      cambiarElementos((es) =>
        es.map((x) => {
          const c = cambios.find((y) => y.id === x.id)
          return c ? { ...x, ...c, datos: c.datos ? { ...x.datos, ...c.datos } : x.datos } : x
        }),
      )
      if (opciones.local) return
      const previos = cambios
        .map((c) => {
          const a = antes.get(c.id)
          if (!a) return null
          const p: Partial<ElementoLienzo> & { id: string } = { id: c.id }
          for (const k of Object.keys(c) as (keyof ElementoLienzo)[]) {
            if (k === 'id') continue
            if (k === 'datos') p.datos = Object.fromEntries(Object.keys(c.datos ?? {}).map((dk) => [dk, a.datos[dk] ?? null]))
            else (p as any)[k] = a[k]
          }
          return p
        })
        .filter(Boolean) as (Partial<ElementoLienzo> & { id: string })[]
      try {
        await esperarCreacion(cambios.map((c) => c.id))
        await api.actualizarElementos(cambios)
        if (opciones.registrar !== false)
          registrarPaso({
            etiqueta: opciones.registrar || 'cambio en el lienzo',
            deshacer: () => get().actualizarElementos(previos, { registrar: false }),
            rehacer: () => get().actualizarElementos(cambios, { registrar: false }),
          })
      } catch (e) {
        avisarError(e)
        get().recargarTablero()
      }
    },

    async operarTabla(id, ops, opciones = {}) {
      const el = get().tablero?.elementos.find((x) => x.id === id)
      if (!el || el.tipo !== 'tabla') return null
      if (el.bloqueado) {
        avisar({ texto: 'La tabla está bloqueada: desbloqueala para cambiarla.', tipo: 'error' })
        return null
      }
      const antes = leerTabla(el.datos)
      let r: ReturnType<typeof aplicarOperaciones>
      try {
        r = aplicarOperaciones(opciones.cambios ? leerTabla({ ...antes, ...opciones.cambios } as unknown as Record<string, unknown>) : antes, ops)
      } catch (e) {
        avisarError(e)
        return null
      }
      const poner = (tabla: typeof antes) => {
        const m = medidaTabla(tabla)
        cambiarElementos((es) => es.map((x) => (x.id === id ? { ...x, ancho: m.ancho, alto: m.alto, datos: tabla as unknown as Record<string, unknown> } : x)))
      }
      poner(r.tabla)
      try {
        await esperarCreacion([id])
        await api.operarTabla(id, ops, opciones.cambios)
        if (opciones.etiqueta !== false) {
          // Deshacer y rehacer devuelven la tabla entera a como estaba (los id de filas y columnas no cambian).
          const volver = (tabla: typeof antes) => async () => {
            poner(tabla)
            try {
              await api.operarTabla(id, [{ op: 'restaurar', tabla }])
            } catch (e) {
              avisarError(e)
              get().recargarTablero()
            }
          }
          registrarPaso({ etiqueta: opciones.etiqueta || 'cambio en la tabla', deshacer: volver(antes), rehacer: volver(r.tabla) })
        }
        return r.avisos
      } catch (e) {
        avisarError(e)
        get().recargarTablero()
        return null
      }
    },

    async convertirElemento(id, a, listaId) {
      const t = get().tablero
      const viejo = t?.elementos.find((x) => x.id === id)
      if (!t || !viejo) return null
      try {
        await esperarCreacion([id])
        const r = await api.convertirElemento(id, a, listaId)
        const nuevo = r.elemento
        const idsConectores = r.conectores.map((c) => c.id)
        marcarNuevos([nuevo.id], 'aca')
        cambiarElementos((es) => [...es.filter((x) => x.id !== id), nuevo])
        cambiarConectores((cs) => cs.map((c) => r.conectores.find((x) => x.id === c.id) ?? c))
        if (r.tarjeta) {
          get().ponerTarjeta(r.tarjeta)
          get().destellar(r.tarjeta.id)
        }
        // Volver a apuntar los conectores de un objeto al otro (para deshacer y rehacer).
        const repuntar = async (de: string, a2: string) => {
          const cs = get().tablero?.conectores.filter((c) => idsConectores.includes(c.id)) ?? []
          const cambiados = await Promise.all(
            cs.map((c) => api.actualizarConector(c.id, { ...(c.desdeId === de ? { desdeId: a2 } : {}), ...(c.hastaId === de ? { hastaId: a2 } : {}) })),
          )
          cambiarConectores((cs2) => cs2.map((c) => cambiados.find((x) => x.id === c.id) ?? c))
        }
        const paso = {
          etiqueta: r.tarjeta ? `convertir en ${r.tarjeta.clave}` : 'convertir',
          deshacer: async () => {
            const { elementos } = await api.restaurarElementos([id])
            cambiarElementos((es) => [...es.filter((x) => x.id !== id), ...elementos])
            await repuntar(nuevo.id, id)
            await api.eliminarElementos([nuevo.id])
            cambiarElementos((es) => es.filter((x) => x.id !== nuevo.id))
            if (r.tarjeta) await get().archivarTarjeta(r.tarjeta.id, true, { registrar: false })
          },
          rehacer: async () => {
            if (r.tarjeta) await get().archivarTarjeta(r.tarjeta.id, false, { registrar: false })
            const { elementos } = await api.restaurarElementos([nuevo.id])
            cambiarElementos((es) => [...es.filter((x) => x.id !== nuevo.id), ...elementos])
            await repuntar(id, nuevo.id)
            await api.eliminarElementos([id])
            cambiarElementos((es) => es.filter((x) => x.id !== id))
          },
        }
        registrarPaso(paso)
        const masculino = viejo.tipo === 'texto'
        const destino = r.tarjeta ? r.tarjeta.clave : a === 'nota' ? 'nota' : a === 'texto' ? 'texto' : 'forma'
        avisar({ texto: `${masculino ? 'Convertido' : 'Convertida'} en ${destino}`, accion: { etiqueta: 'Deshacer', fn: () => deshacerEste(paso) } })
        return nuevo
      } catch (e) {
        avisarError(e)
        return null
      }
    },

    async descartarVacio(id) {
      // Si todavía se está creando, se espera: así su paso "agregar" ya está anotado y se puede olvidar.
      await esperarCreacion([id])
      const eraNuevo = olvidarCreacion(id)
      return get().eliminarSeleccion([id], [], eraNuevo ? { registrar: false } : {})
    },

    async eliminarSeleccion(elementos, conectores, opciones = {}) {
      if (elementos.length === 0 && conectores.length === 0) return
      const t = get().tablero
      if (!t) return
      const sueltos = conectores.filter((c) => {
        const x = t.conectores.find((y) => y.id === c)
        return x && !elementos.includes(x.desdeId) && !elementos.includes(x.hastaId)
      })
      quitarConSalida(elementos, () => {
        cambiarElementos((es) => es.filter((x) => !elementos.includes(x.id)))
        cambiarConectores((cs) => cs.filter((x) => !conectores.includes(x.id) && !elementos.includes(x.desdeId) && !elementos.includes(x.hastaId)))
      })
      try {
        await esperarCreacion(elementos)
        const r = elementos.length ? await api.eliminarElementos(elementos) : { elementos: [], conectores: [] }
        if (sueltos.length) await api.eliminarConectores(sueltos)
        const todosConectores = [...new Set([...r.conectores, ...sueltos])]
        const restaurar = async () => {
          const x = await api.restaurarElementos(r.elementos, todosConectores)
          cambiarElementos((es) => [...es.filter((y) => !r.elementos.includes(y.id)), ...x.elementos])
          cambiarConectores((cs) => [...cs.filter((y) => !todosConectores.includes(y.id)), ...x.conectores])
        }
        if (opciones.registrar === false) return
        registrarPaso({
          etiqueta: 'borrar del lienzo',
          deshacer: restaurar,
          rehacer: async () => {
            cambiarElementos((es) => es.filter((x) => !r.elementos.includes(x.id)))
            cambiarConectores((cs) => cs.filter((x) => !todosConectores.includes(x.id)))
            if (r.elementos.length) await api.eliminarElementos(r.elementos)
            if (sueltos.length) await api.eliminarConectores(sueltos)
          },
        })
        const n = r.elementos.length + sueltos.length
        avisar({ texto: n === 1 ? 'Borraste 1 objeto' : `Borraste ${n} objetos`, accion: { etiqueta: 'Deshacer', fn: restaurar } })
      } catch (e) {
        avisarError(e)
        get().recargarTablero()
      }
    },

    async crearConector(datos, opciones = {}) {
      const t = get().tablero
      if (!t) return null
      const id = datos.id ?? idLocal()
      const c: Conector = {
        id,
        tableroId: t.tablero.id,
        desdeId: datos.desdeId,
        hastaId: datos.hastaId,
        desdeLado: datos.desdeLado ?? null,
        hastaLado: datos.hastaLado ?? null,
        trazo: datos.trazo ?? 'curvo',
        puntaInicio: datos.puntaInicio ?? 'ninguna',
        puntaFin: datos.puntaFin ?? 'flecha',
        guion: datos.guion ?? 'solido',
        color: datos.color ?? null,
        grosor: datos.grosor ?? 2,
        etiqueta: datos.etiqueta ?? '',
      }
      // Al aparecer, se dibuja de punta a punta (salvo que ya estuviera dibujada: la línea del menú "Crear y conectar").
      if (!opciones.sinAnimacion) marcarNuevos([id], 'aca')
      cambiarConectores((cs) => [...cs, c])
      try {
        // Si alguno de los dos extremos se está creando, el servidor tiene que tenerlo antes que al conector.
        await esperarCreacion([c.desdeId, c.hastaId])
        const r = await api.crearConector(t.tablero.id, c)
        cambiarConectores((cs) => cs.map((x) => (x.id === id ? r : x)))
        registrarPaso({
          etiqueta: 'conectar',
          deshacer: async () => {
            cambiarConectores((cs) => cs.filter((x) => x.id !== id))
            await api.eliminarConectores([id])
          },
          rehacer: async () => {
            const x = await api.restaurarElementos([], [id])
            cambiarConectores((cs) => [...cs.filter((y) => y.id !== id), ...x.conectores])
          },
        })
        return r
      } catch (e) {
        cambiarConectores((cs) => cs.filter((x) => x.id !== id))
        avisarError(e)
        return null
      }
    },

    async actualizarConector(id, cambios) {
      const antes = get().tablero?.conectores.find((x) => x.id === id)
      cambiarConectores((cs) => cs.map((x) => (x.id === id ? { ...x, ...cambios } : x)))
      try {
        await api.actualizarConector(id, cambios)
        if (antes) {
          const previo = Object.fromEntries(Object.keys(cambios).map((k) => [k, (antes as any)[k]])) as Partial<Conector>
          registrarPaso({
            etiqueta: 'cambiar conector',
            deshacer: async () => {
              cambiarConectores((cs) => cs.map((x) => (x.id === id ? { ...x, ...previo } : x)))
              await api.actualizarConector(id, previo)
            },
            rehacer: async () => {
              cambiarConectores((cs) => cs.map((x) => (x.id === id ? { ...x, ...cambios } : x)))
              await api.actualizarConector(id, cambios)
            },
          })
        }
      } catch (e) {
        avisarError(e)
      }
    },

    setHerramienta: (herramienta, fija = false) => set({ herramienta, herramientaFija: herramienta === 'seleccionar' || herramienta === 'mano' ? false : fija }),
    setEditando: (editando) => set({ editando }),
    alternarMinimapa() {
      const v = !get().minimapa
      localStorage.setItem('tablero.minimapa', v ? 'si' : 'no')
      set({ minimapa: v })
    },
    alternarGrilla() {
      const v = !get().grilla
      localStorage.setItem('tablero.grilla', v ? 'si' : 'no')
      set({ grilla: v })
    },
  }
})

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useTienda.getState().tema === 'sistema') aplicarTema('sistema', true)
})
