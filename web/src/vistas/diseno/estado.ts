// La tienda de Diseño (zustand, propia): página, marcos, ítems, selección, herramienta, preferencias.
// Los cambios en vivo (Claude por MCP, otra pestaña) llegan por el evento `telar:diseno` (estado/eventos.ts los reenvía).
import { create } from 'zustand'
import type { OperacionMarco } from '../../../../compartido/diseno/operaciones'
import type { ItemDiseno, Marco, MarcoResumen, PaginaDiseno, ResumenDiseno, TipoItem } from '../../../../compartido/diseno/tipos'
import { clienteId } from '../../estado/api'
import { avisar, avisarError } from '../../estado/avisos'
import { registrarPaso } from '../../estado/deshacer'
import { apiDiseno, type MarcoCompleto, type ResultadoEdicion } from './api'

export type Herramienta = 'seleccionar' | 'mano' | 'marco' | 'texto' | 'imagen' | 'caja' | 'comentar'
export type FondoLienzo = 'claro' | 'medio' | 'oscuro'

export interface Seleccion {
  /** Marco seleccionado (o el de la capa). */
  marco: string | null
  /** Capa (data-id) dentro del marco. */
  capa: string | null
  /** Ítem del sistema ("token:--rc-azul"). */
  item: string | null
  /** Selección múltiple de marcos (Mayús + clic). */
  marcos: string[]
}

export interface PreferenciasDiseno {
  izq: number
  der: number
  fondo: FondoLienzo
  pestanaIzq: 'capas' | 'piezas'
  pestanaInspector: 'diseno' | 'codigo' | 'notas'
  unidad: 'px' | 'proyecto'
  resueltos: boolean
}

const CLAVE_PREF = 'telar.diseno'
function leerPreferencias(): PreferenciasDiseno {
  const defecto: PreferenciasDiseno = { izq: 248, der: 288, fondo: 'medio', pestanaIzq: 'capas', pestanaInspector: 'diseno', unidad: 'px', resueltos: false }
  try {
    return { ...defecto, ...(JSON.parse(localStorage.getItem(CLAVE_PREF) ?? '{}') as Partial<PreferenciasDiseno>) }
  } catch {
    return defecto
  }
}

interface EstadoDiseno {
  prefijo: string | null
  resumen: ResumenDiseno | null
  error: string | null
  pagina: PaginaDiseno | null
  marcos: MarcoResumen[]
  cargandoPagina: boolean
  completos: Record<string, MarcoCompleto>
  /** Revisión que ya está aplicada en el DOM vivo (cambio hecho acá): el iframe no se vuelve a armar. */
  aplicada: Record<string, number>
  cssTokens: string
  items: Partial<Record<TipoItem, ItemDiseno[]>>
  cargandoItems: Partial<Record<TipoItem, boolean>>
  seleccion: Seleccion
  sobre: { marco: string; capa: string | null } | null
  herramienta: Herramienta
  reglaFija: boolean
  midiendo: boolean
  probando: string | null
  editandoTexto: { marco: string; capa: string } | null
  paneles: boolean
  pref: PreferenciasDiseno
  modo: string | null
  probarValor: { variable: string; valor: string } | null
  marcoNuevo: { prefijado: string; ancho: number; alto: number; nombre: string } | null
  destellos: Record<string, number>
  version: number

  abrirProyecto: (prefijo: string) => Promise<void>
  recargarResumen: () => Promise<void>
  abrirPagina: (slug: string) => Promise<void>
  recargarPagina: () => Promise<void>
  cargarMarco: (id: string, forzar?: boolean) => Promise<MarcoCompleto | null>
  cargarTokens: () => Promise<void>
  cargarItems: (tipo: TipoItem, forzar?: boolean) => Promise<ItemDiseno[]>
  seleccionar: (s: Partial<Seleccion>) => void
  setSobre: (s: EstadoDiseno['sobre']) => void
  setHerramienta: (h: Herramienta) => void
  setPref: (p: Partial<PreferenciasDiseno>) => void
  set: (p: Partial<EstadoDiseno>) => void
  editar: (marco: string, ops: OperacionMarco[], o?: { etiqueta?: string; deshacer?: boolean; enDom?: boolean }) => Promise<ResultadoEdicion | null>
  /** Sin esperar ni juntar: para el código editado a mano. Devuelve true o el mensaje del servidor (no se pierde lo escrito). */
  editarDirecto: (marco: string, ops: OperacionMarco[], etiqueta: string) => Promise<true | string>
  moverMarco: (id: string, x: number, y: number) => Promise<void>
  redimensionarMarco: (id: string, ancho: number, alto: number, x?: number, y?: number) => Promise<void>
  aplicarEvento: (e: { accion: string; datos?: { accion?: string; paginaId?: string | null; marcos?: string[]; items?: { tipo: TipoItem; clave: string }[] }; clienteId?: string | null; actor?: { tipo: string } }) => void
}

/** Lista vacía fija: un selector que devuelve [] nuevo en cada llamada hace que React vuelva a dibujar sin fin. */
export const SIN_ITEMS: ItemDiseno[] = []

const pendiente: Record<string, { ops: OperacionMarco[]; reloj: ReturnType<typeof setTimeout>; etiqueta: string; enDom: boolean }> = {}

export const useDiseno = create<EstadoDiseno>((set, get) => ({
  prefijo: null,
  resumen: null,
  error: null,
  pagina: null,
  marcos: [],
  cargandoPagina: false,
  completos: {},
  aplicada: {},
  cssTokens: '',
  items: {},
  cargandoItems: {},
  seleccion: { marco: null, capa: null, item: null, marcos: [] },
  sobre: null,
  herramienta: 'seleccionar',
  reglaFija: false,
  midiendo: false,
  probando: null,
  editandoTexto: null,
  paneles: true,
  pref: leerPreferencias(),
  modo: null,
  probarValor: null,
  marcoNuevo: null,
  destellos: {},
  version: 0,

  async abrirProyecto(prefijo) {
    if (get().prefijo === prefijo && get().resumen) return
    set({ prefijo, resumen: null, pagina: null, marcos: [], completos: {}, aplicada: {}, items: {}, cssTokens: '', error: null, seleccion: { marco: null, capa: null, item: null, marcos: [] } })
    try {
      const resumen = await apiDiseno.resumen(prefijo)
      if (get().prefijo !== prefijo) return
      set({ resumen })
      void get().cargarTokens()
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async recargarResumen() {
    const p = get().prefijo
    if (!p) return
    try {
      const resumen = await apiDiseno.resumen(p)
      if (get().prefijo === p) set({ resumen })
    } catch {
      // se reintenta con el próximo evento
    }
  },

  async abrirPagina(slug) {
    const p = get().prefijo
    if (!p) return
    if (get().pagina?.slug !== slug) set({ cargandoPagina: true, seleccion: { marco: null, capa: null, item: null, marcos: [] }, sobre: null, probando: null, editandoTexto: null })
    try {
      const r = await apiDiseno.pagina(p, slug)
      if (get().prefijo !== p) return
      set({ pagina: r.pagina, marcos: r.marcos, cargandoPagina: false })
      for (const t of r.pagina.datos.tipos ?? []) void get().cargarItems(t)
    } catch (e) {
      set({ cargandoPagina: false, error: (e as Error).message })
    }
  },

  async recargarPagina() {
    const p = get().prefijo
    const pg = get().pagina
    if (!p || !pg) return
    try {
      const r = await apiDiseno.pagina(p, pg.id)
      if (get().pagina?.id === pg.id) set({ pagina: r.pagina, marcos: r.marcos })
    } catch {
      // nada
    }
  },

  async cargarMarco(id, forzar) {
    const p = get().prefijo
    if (!p) return null
    const ya = get().completos[id]
    if (ya && !forzar) return ya
    try {
      const c = await apiDiseno.marco(p, id)
      const completos = { ...get().completos, [id]: c }
      // tope: 40 marcos en memoria
      const ids = Object.keys(completos)
      if (ids.length > 40) for (const viejo of ids.slice(0, ids.length - 40)) if (viejo !== get().seleccion.marco) delete completos[viejo]
      set({ completos })
      return c
    } catch {
      return null
    }
  },

  async cargarTokens() {
    const p = get().prefijo
    if (!p) return
    const css = await apiDiseno.cssTokens(p)
    if (get().prefijo === p) set({ cssTokens: css })
  },

  async cargarItems(tipo, forzar) {
    const p = get().prefijo
    if (!p) return []
    const ya = get().items[tipo]
    if (ya && !forzar) return ya
    if (get().cargandoItems[tipo]) return ya ?? []
    set({ cargandoItems: { ...get().cargandoItems, [tipo]: true } })
    try {
      const todos: ItemDiseno[] = []
      let desde: number | null = 0
      while (desde !== null) {
        const r: { items: ItemDiseno[]; siguiente: number | null } = await apiDiseno.items(p, { tipo, desde, limite: 500 })
        todos.push(...r.items)
        desde = r.siguiente
      }
      if (get().prefijo === p) set({ items: { ...get().items, [tipo]: todos } })
      return todos
    } catch {
      return []
    } finally {
      set({ cargandoItems: { ...get().cargandoItems, [tipo]: false } })
    }
  },

  seleccionar(s) {
    const actual = get().seleccion
    const nueva = { ...actual, ...s }
    if (s.marco !== undefined && s.marco !== actual.marco && s.capa === undefined) nueva.capa = null
    if ((s.marco || s.capa) && s.item === undefined) nueva.item = null
    if (s.item) {
      nueva.marco = s.marco ?? null
      nueva.capa = s.capa ?? null
    }
    if (s.marcos === undefined) nueva.marcos = nueva.marco ? [nueva.marco] : []
    set({ seleccion: nueva, editandoTexto: get().editandoTexto?.marco === nueva.marco ? get().editandoTexto : null })
    if (nueva.marco) void get().cargarMarco(nueva.marco)
  },

  setSobre: (sobre) => {
    const a = get().sobre
    if (a?.marco === sobre?.marco && a?.capa === sobre?.capa) return
    set({ sobre })
  },
  setHerramienta: (herramienta) => set({ herramienta, probando: herramienta === 'seleccionar' ? get().probando : null }),
  setPref(p) {
    const pref = { ...get().pref, ...p }
    localStorage.setItem(CLAVE_PREF, JSON.stringify(pref))
    set({ pref })
  },
  set: (p) => set(p),

  /**
   * Edita un marco propio: el cambio ya se ve en el iframe (quien llama lo aplica en el DOM), y acá se manda al servidor.
   * Las operaciones de estilo y texto se juntan 250 ms; deshacer vuelve a la revisión anterior.
   */
  editar(marcoId, ops, o = {}) {
    const p = get().prefijo
    if (!p) return Promise.resolve(null)
    return new Promise((ok) => {
      const pend = pendiente[marcoId]
      if (pend) clearTimeout(pend.reloj)
      const todas = [...(pend?.ops ?? []), ...ops]
      const enDom = o.enDom !== false && (pend?.enDom ?? true)
      const etiqueta = o.etiqueta ?? pend?.etiqueta ?? 'cambio en el marco'
      pendiente[marcoId] = {
        ops: todas,
        etiqueta,
        enDom,
        reloj: setTimeout(async () => {
          delete pendiente[marcoId]
          try {
            const r = await apiDiseno.operaciones(p, marcoId, todas)
            const c = get().completos[marcoId]
            set({
              completos: c ? { ...get().completos, [marcoId]: { ...c, marco: r.marco } } : get().completos,
              aplicada: enDom ? { ...get().aplicada, [marcoId]: r.marco.revision } : get().aplicada,
              marcos: get().marcos.map((m) => (m.id === marcoId ? { ...m, ...resumenDe(r.marco) } : m)),
            })
            // lo que no estaba en el DOM (una pieza nueva, otra hoja): se vuelve a pedir el marco con sus piezas y hojas
            if (!enDom) void get().cargarMarco(marcoId, true)
            if (o.deshacer !== false && r.revisionAntes !== r.marco.revision) {
              const antes = r.revisionAntes
              const despues = r.marco.revision
              registrarPaso({
                etiqueta,
                deshacer: () => restaurarRevision(marcoId, antes),
                rehacer: () => restaurarRevision(marcoId, despues),
              })
            }
            for (const a of r.avisos) avisar({ texto: a, duracion: 5000 })
            ok(r)
          } catch (e) {
            avisarError(e)
            // vuelve a lo que dice el servidor
            await get().cargarMarco(marcoId, true)
            set({ aplicada: { ...get().aplicada, [marcoId]: -1 }, version: get().version + 1 })
            ok(null)
          }
        }, 250),
      }
    })
  },

  async editarDirecto(marcoId, ops, etiqueta) {
    const p = get().prefijo
    if (!p) return 'No hay un proyecto abierto.'
    try {
      const r = await apiDiseno.operaciones(p, marcoId, ops)
      const c = get().completos[marcoId]
      set({
        completos: c ? { ...get().completos, [marcoId]: { ...c, marco: r.marco } } : get().completos,
        aplicada: { ...get().aplicada, [marcoId]: -1 },
        marcos: get().marcos.map((m) => (m.id === marcoId ? { ...m, ...resumenDe(r.marco) } : m)),
      })
      void get().cargarMarco(marcoId, true)
      if (r.revisionAntes !== r.marco.revision) {
        const antes = r.revisionAntes
        const despues = r.marco.revision
        registrarPaso({ etiqueta, deshacer: () => restaurarRevision(marcoId, antes), rehacer: () => restaurarRevision(marcoId, despues) })
      }
      for (const a of r.avisos) avisar({ texto: a, duracion: 5000 })
      return true
    } catch (e) {
      return (e as Error).message
    }
  },

  async moverMarco(id, x, y) {
    const p = get().prefijo
    const m = get().marcos.find((x) => x.id === id)
    if (!p || !m) return
    const antes = { x: m.x, y: m.y }
    set({ marcos: get().marcos.map((z) => (z.id === id ? { ...z, x, y } : z)) })
    try {
      await apiDiseno.actualizarMarco(p, id, { x: Math.round(x), y: Math.round(y) })
      registrarPaso({
        etiqueta: 'mover el marco',
        deshacer: () => get().moverMarco(id, antes.x, antes.y),
        rehacer: () => get().moverMarco(id, x, y),
      })
    } catch (e) {
      avisarError(e)
      set({ marcos: get().marcos.map((z) => (z.id === id ? { ...z, ...antes } : z)) })
    }
  },

  async redimensionarMarco(id, ancho, alto, x, y) {
    const p = get().prefijo
    const m = get().marcos.find((z) => z.id === id)
    if (!p || !m) return
    const antes = { ancho: m.ancho, alto: m.alto, x: m.x, y: m.y }
    set({ marcos: get().marcos.map((z) => (z.id === id ? { ...z, ancho, alto, x: x ?? z.x, y: y ?? z.y } : z)) })
    try {
      const r = await apiDiseno.actualizarMarco(p, id, { ancho: Math.round(ancho), alto: Math.round(alto), ...(x !== undefined ? { x: Math.round(x), y: Math.round(y ?? m.y) } : {}) })
      const c = get().completos[id]
      if (c) set({ completos: { ...get().completos, [id]: { ...c, marco: r } } })
      set({ marcos: get().marcos.map((z) => (z.id === id ? { ...z, ...resumenDe(r) } : z)) })
      registrarPaso({
        etiqueta: 'cambiar el tamaño del marco',
        deshacer: () => get().redimensionarMarco(id, antes.ancho, antes.alto, antes.x, antes.y),
        rehacer: () => get().redimensionarMarco(id, ancho, alto, x, y),
      })
    } catch (e) {
      avisarError(e)
      set({ marcos: get().marcos.map((z) => (z.id === id ? { ...z, ...antes } : z)) })
    }
  },

  aplicarEvento(e) {
    const d = e.datos ?? {}
    const propio = e.clienteId === clienteId
    const s = get()
    if (d.accion === 'importacion' || d.accion === 'pagina' || d.accion === 'config') void s.recargarResumen()
    if (d.accion === 'importacion') {
      set({ items: {}, completos: {}, aplicada: {} })
      void s.cargarTokens()
      void s.recargarPagina()
      return
    }
    if (d.accion === 'item' && d.items?.length) {
      const tipos = new Set(d.items.map((i) => i.tipo))
      for (const t of tipos) if (s.items[t]) void s.cargarItems(t, true)
      if (tipos.has('token') || tipos.has('estilo_texto') || tipos.has('fuente')) void s.cargarTokens()
      if (tipos.has('pieza')) {
        // las piezas cambian el dibujo de los marcos que las usan
        for (const id of Object.keys(s.completos)) void s.cargarMarco(id, true)
      }
      void s.recargarResumen()
      return
    }
    if (d.accion === 'marco' || d.accion === 'comentario' || d.accion === 'vinculo' || d.accion === 'nota') {
      if (d.paginaId === s.pagina?.id || d.marcos?.some((id) => s.marcos.some((m) => m.id === id))) void s.recargarPagina()
      if (!propio)
        for (const id of d.marcos ?? []) {
          if (s.completos[id]) void s.cargarMarco(id, true)
          if (e.actor?.tipo !== 'humano') set({ destellos: { ...get().destellos, [id]: Date.now() } })
        }
      void s.recargarResumen()
    }
  },
}))

export function resumenDe(m: Marco): Partial<MarcoResumen> {
  const datos = { ...m.datos }
  delete datos.cajas
  return { nombre: m.nombre, x: m.x, y: m.y, ancho: m.ancho, alto: m.alto, revision: m.revision, seccion: m.seccion, grupo: m.grupo, datos, bloqueado: m.bloqueado, hojas: m.hojas }
}

async function restaurarRevision(marcoId: string, n: number) {
  const s = useDiseno.getState()
  const p = s.prefijo
  if (!p) return
  const r = await apiDiseno.restaurar(p, marcoId, n)
  const c = useDiseno.getState().completos[marcoId]
  useDiseno.setState({
    completos: c ? { ...useDiseno.getState().completos, [marcoId]: { ...c, marco: r.marco } } : useDiseno.getState().completos,
    aplicada: { ...useDiseno.getState().aplicada, [marcoId]: -1 },
    marcos: useDiseno.getState().marcos.map((m) => (m.id === marcoId ? { ...m, ...resumenDe(r.marco) } : m)),
  })
}

/** El marco seleccionado (resumen) y su completo, si ya llegó. */
export function marcoSeleccionado(): { resumen: MarcoResumen | null; completo: MarcoCompleto | null } {
  const s = useDiseno.getState()
  const id = s.seleccion.marco
  return { resumen: s.marcos.find((m) => m.id === id) ?? null, completo: id ? s.completos[id] ?? null : null }
}

export const esPropio = (m: { origen: string } | null | undefined) => m?.origen === 'propio'

/** Marco completo → para mostrar en el inspector sin esperar. */
export type { Marco }
