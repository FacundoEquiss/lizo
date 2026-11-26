// La tienda de la IA integrada en la web (plan de la IA integrada, A.4): las notificaciones de la campana, los trabajos de los
// agentes y lo que hace falta para que cuenten bien. Aparte de la tienda de Telar porque no tiene que ver con el tablero: una
// pestaña cargada con la campana no vuelve a dibujar el Kanban.
//   · Un solo pedido al abrir (`GET /api/novedades`: notificaciones y no leídas, los trabajos vivos o que esperan algo y las
//     menciones que quedaron esperando) y, después, solo los eventos `notificacion` y `trabajo` que ya viajan por el canal en
//     vivo. Sin sondeo propio (D25): lo único que se suma es la bandera `ia=1` al sondeo que ya existe mientras haya un
//     trabajo vivo (`hayTrabajosVivos`, 11.4), para que el servidor levante lo que haya quedado sin dueño.
//   · Si el servidor todavía no tiene las rutas (404), la campana se esconde y nada se rompe: `estado: 'no_disponible'`.
//   · Marcar como leída es optimista (el número baja al toque); si el servidor dice que no, vuelve atrás y avisa.
//   · Un trabajo terminado se queda en `trabajos` (el pie «Hizo 1 cambio · ≈ USD 0,01» de su respuesta lo necesita); al
//     recargar todo, los que seguían vivos y ya no figuran se descartan (terminaron mientras no se miraba).
// «Pedile a…» y deshacer (F3) suman acá sus acciones.
import { create } from 'zustand'
import { esTerminal, esVivo, type EstadoIA, type Mencion, type Notificacion, type TrabajoResumen } from '../../../compartido/ia'
import type { Evento } from '../../../compartido/tipos'
import { api, ErrorApi } from './api'
import { avisarError } from './avisos'
import { irA } from './ruta'
import { actualizarSolicitudes } from './sesion'
import { useTienda } from './tienda'

/** De a cuántas se pide la bandeja (y cuántas trae el pedido de novedades). */
export const TANDA = 30

/**
 * Cómo está lo de la IA:
 *   · `sin_pedir`: todavía no se pidió nada;
 *   · `cargando`: el primer pedido va en camino;
 *   · `lista`: se cargó;
 *   · `error`: no se pudo (sin conexión o error del servidor): la bandeja lo dice y deja reintentar;
 *   · `no_disponible`: el servidor no tiene las rutas de la IA (una versión vieja): la campana no se dibuja.
 */
export type EstadoCarga = 'sin_pedir' | 'cargando' | 'lista' | 'error' | 'no_disponible'

export interface EstadoIAWeb {
  notificaciones: Notificacion[]
  sinLeer: number
  cargadas: boolean
  estado: EstadoCarga
  /** ¿Puede haber más viejas que las que se tienen? (la última tanda vino completa). */
  hayMas: boolean
  cargandoMas: boolean
  errorMas: boolean
  /** Los trabajos que la pantalla está mirando, por id (F2). */
  trabajos: Record<string, TrabajoResumen>
  /** Menciones a un agente que no pudo responder (sin clave, pausado, en el tope…): se ven en el hilo con «Reintentar» (F2). */
  esperando: Mencion[]
  /** Configuración → IA y los topes que cuentan los textos del hilo; se pide cuando se abre una de las dos (F2). */
  ia: EstadoIA | null
  /** El único pedido al abrir: GET /api/novedades. */
  cargarNovedades: () => Promise<void>
  /** Más viejas para la bandeja: GET /api/notificaciones?antes=. */
  cargarMasNotificaciones: () => Promise<void>
  /** Sin ids, todas. */
  marcarLeidas: (ids?: string[]) => Promise<void>
  /** Eventos `notificacion` y `trabajo` (los manda eventos.ts). */
  aplicarEvento: (e: Evento) => void
  /** ¿Hay que mandar ia=1 en el sondeo? Solo mientras haya un trabajo en cola o en curso. */
  hayTrabajosVivos: () => boolean
  /** Suma lo que respondió el servidor (un trabajo que ya existe se reemplaza, por id). */
  guardarTrabajos: (ts: TrabajoResumen[]) => void
  /** Una mención que quedó esperando (la respuesta de comentar la trae con su motivo). */
  sumarEsperando: (ms: Mencion[]) => void
  // Las cuatro acciones sobre un trabajo avisan solas si el servidor dice que no (con sus palabras) y devuelven si salió bien.
  /** Frena el trabajo (en cola, en curso, pausado o esperando permiso). */
  cancelar: (id: string) => Promise<boolean>
  /** Decide cada acción que esperaba permiso: `permitir` o no. */
  confirmar: (id: string, decisiones: { llamadaId: string; permitir: boolean }[]) => Promise<boolean>
  /** Sigue un trabajo pausado por tope o fallado («Reanudar», «Seguir igual», «Reintentar»). */
  reanudar: (id: string) => Promise<boolean>
  /** Una mención que esperaba un agente que ahora está listo: crea su trabajo. */
  reintentarMencion: (id: string) => Promise<boolean>
}

const noLeidas = (ns: Notificacion[]) => ns.filter((n) => !n.leidaEn).length
const porNuevas = (a: Notificacion, b: Notificacion) => (a.creadoEn < b.creadoEn ? 1 : a.creadoEn > b.creadoEn ? -1 : 0)

/** Suma sin repetir (por id) y deja lo más nuevo arriba. */
function juntar(actuales: Notificacion[], nuevas: Notificacion[]): Notificacion[] {
  const por = new Map(actuales.map((n) => [n.id, n]))
  for (const n of nuevas) por.set(n.id, n)
  return [...por.values()].sort(porNuevas)
}

/** Una notificación para otro miembro de la cuenta (equipos) no es de esta persona. Sin saber quién soy, se acepta. */
function esMia(n: Notificacion): boolean {
  const yo = useTienda.getState().miembros.find((m) => m.esYo)
  return !yo || n.paraId === yo.id
}

// ───────── «Respondiendo a…» (14.4) ─────────
// A qué comentario de qué tarjeta se está contestando. Es de la tarjeta abierta, y lo comparten el campo de escritorio
// (Secciones.tsx) y el de abajo de la hoja del celular (HojaTarjeta.tsx), que son dos componentes distintos.
export interface Respondiendo {
  /** La clave de la tarjeta (RC-12): si se abre otra, esto no vale. */
  tarjeta: string
  comentarioId: string
  /** A quién: «Claude». */
  autor: string
}

interface EstadoRespondiendo {
  a: Respondiendo | null
  /** Cambia cada vez que se pide «Responder»: quien tiene el campo a la vista le pone el foco. */
  foco: number
  responder: (a: Respondiendo) => void
  dejar: () => void
}

export const useRespondiendo = create<EstadoRespondiendo>((set) => ({
  a: null,
  foco: 0,
  responder: (a) => set((s) => ({ a, foco: s.foco + 1 })),
  dejar: () => set({ a: null }),
}))

let enCurso: Promise<void> | null = null

export const useIA = create<EstadoIAWeb>((set, get) => ({
  notificaciones: [],
  sinLeer: 0,
  cargadas: false,
  estado: 'sin_pedir',
  hayMas: false,
  cargandoMas: false,
  errorMas: false,
  trabajos: {},
  esperando: [],
  ia: null,

  cargarNovedades() {
    // Dos montajes seguidos (React en desarrollo, o el sondeo que pide recargar justo ahora) comparten el mismo pedido.
    if (enCurso) return enCurso
    // Con lo que ya hay a la vista no se vuelve a «cargando»: la campana no parpadea al recargar.
    if (!get().cargadas) set({ estado: 'cargando' })
    enCurso = api
      .novedades()
      .then((n) => {
        const lista = [...(n.notificaciones ?? [])].sort(porNuevas)
        set({
          notificaciones: lista,
          sinLeer: typeof n.sinLeer === 'number' ? n.sinLeer : noLeidas(lista),
          cargadas: true,
          estado: 'lista',
          hayMas: lista.length >= TANDA,
          errorMas: false,
          esperando: n.esperando ?? [],
          // Los terminados que ya se tenían se conservan; los que seguían vivos y ya no figuran, no.
          trabajos: {
            ...Object.fromEntries(Object.entries(get().trabajos).filter(([, t]) => esTerminal(t.estado))),
            ...Object.fromEntries((n.trabajos ?? []).map((t) => [t.id, t])),
          },
        })
      })
      .catch((e) => {
        // 404/405: una versión del servidor sin las rutas de la IA. Para la web es como si no existiera la campana.
        if (e instanceof ErrorApi && (e.estado === 404 || e.estado === 405)) set({ estado: 'no_disponible', cargadas: false })
        else if (!get().cargadas) set({ estado: 'error' })
      })
      .finally(() => {
        enCurso = null
      })
    return enCurso
  },

  async cargarMasNotificaciones() {
    const s = get()
    if (s.cargandoMas || !s.hayMas) return
    const ultima = s.notificaciones[s.notificaciones.length - 1]
    if (!ultima) return
    set({ cargandoMas: true, errorMas: false })
    try {
      const mas = await api.notificaciones({ antes: ultima.creadoEn, limite: TANDA })
      set((x) => ({ notificaciones: juntar(x.notificaciones, mas), hayMas: mas.length >= TANDA, cargandoMas: false }))
    } catch {
      set({ cargandoMas: false, errorMas: true })
    }
  },

  async marcarLeidas(ids) {
    const antes = get()
    const ahora = new Date().toISOString()
    const objetivo = ids ? new Set(ids) : null
    const cambian = antes.notificaciones.filter((n) => !n.leidaEn && (!objetivo || objetivo.has(n.id)))
    if (!cambian.length && ids) return
    set({
      notificaciones: antes.notificaciones.map((n) => (!n.leidaEn && (!objetivo || objetivo.has(n.id)) ? { ...n, leidaEn: ahora } : n)),
      sinLeer: ids ? Math.max(0, antes.sinLeer - cambian.length) : 0,
    })
    try {
      await api.marcarLeidas(ids ? { ids } : { todas: true })
    } catch (e) {
      // El servidor no la marcó: vuelven a figurar sin leer (solo las que seguían así).
      set((x) => ({
        notificaciones: x.notificaciones.map((n) => (cambian.some((c) => c.id === n.id) && n.leidaEn === ahora ? { ...n, leidaEn: null } : n)),
        sinLeer: x.sinLeer + cambian.length,
      }))
      avisarError(e)
    }
  },

  aplicarEvento(e) {
    if (e.tipo === 'trabajo') {
      const t = e.datos as TrabajoResumen
      if (!t?.id) return
      eventoDe.set(t.id, performance.now())
      get().guardarTrabajos([t])
      return
    }
    if (e.tipo !== 'notificacion') return
    if (e.accion === 'nueva') {
      const n = e.datos as Notificacion
      if (!n?.id || !esMia(n)) return
      const s = get()
      if (s.notificaciones.some((x) => x.id === n.id)) return
      set({ notificaciones: juntar(s.notificaciones, [n]), sinLeer: s.sinLeer + (n.leidaEn ? 0 : 1) })
      // Si la campana estaba escondida (o sin pedir) y ahora llega una, ya hay bandeja.
      if (s.estado === 'no_disponible' || s.estado === 'sin_pedir') set({ estado: 'lista', cargadas: true })
      // «Pablo pidió una cuenta»: el número de solicitudes del menú se pone al día.
      if (n.enlace === ENLACE_AMIGOS) void actualizarSolicitudes()
    } else if (e.accion === 'leida') {
      // Otra pestaña (o la IA, al atender) la marcó: acá solo se refleja.
      const ids = new Set((e.datos as { ids?: string[] })?.ids ?? [])
      const s = get()
      const cambian = s.notificaciones.filter((n) => !n.leidaEn && ids.has(n.id))
      if (!cambian.length) return
      const ahora = new Date().toISOString()
      set({ notificaciones: s.notificaciones.map((n) => (ids.has(n.id) && !n.leidaEn ? { ...n, leidaEn: ahora } : n)), sinLeer: Math.max(0, s.sinLeer - cambian.length) })
    } else if (e.accion === 'todas_leidas') {
      const ahora = new Date().toISOString()
      set((s) => ({ notificaciones: s.notificaciones.map((n) => (n.leidaEn ? n : { ...n, leidaEn: ahora })), sinLeer: 0 }))
    }
  },

  hayTrabajosVivos: () => Object.values(get().trabajos).some((t) => esVivo(t.estado)),

  guardarTrabajos(ts) {
    set((s) => {
      const trabajos = { ...s.trabajos }
      for (const t of ts) trabajos[t.id] = t
      // Un comentario con @ que ya tiene su trabajo deja de estar «esperando».
      const hechos = new Set(ts.filter((t) => t.respuestaA).map((t) => t.respuestaA))
      const esperando = hechos.size ? s.esperando.filter((m) => !(m.origen.tipo === 'comentario' && hechos.has(m.origen.id))) : s.esperando
      return { trabajos, esperando }
    })
  },

  sumarEsperando(ms) {
    const nuevas = ms.filter((m) => m.estado === 'pendiente' && m.motivo && !m.trabajoId)
    if (nuevas.length) set((s) => ({ esperando: [...nuevas.filter((m) => !s.esperando.some((x) => x.id === m.id)), ...s.esperando] }))
  },

  // Las cuatro acciones sobre un trabajo hacen lo mismo: pedir, guardar lo que el servidor contesta (el evento en vivo llega
  // igual y trae lo mismo) y, si falla, avisar con las palabras del servidor.
  cancelar: (id) => accion(() => api.cancelarTrabajo(id), (t, viejo) => viejo || get().guardarTrabajos([t])),
  confirmar: (id, decisiones) => accion(() => api.confirmarTrabajo(id, decisiones), (t, viejo) => viejo || get().guardarTrabajos([t])),
  reanudar: (id) => accion(() => api.reanudarTrabajo(id), (t, viejo) => viejo || get().guardarTrabajos([t])),
  reintentarMencion: (id) =>
    accion(
      () => api.reintentarMencion(id),
      (t, viejo) => {
        if (!viejo) get().guardarTrabajos([t])
        set((s) => ({ esperando: s.esperando.filter((m) => m.id !== id) }))
      },
    ),
}))

/**
 * Un repaso, UNO, unos segundos después de un botón que dejó el trabajo vivo (reanudar, permitir, reintentar): si el trabajo termina tan rápido
 * que sus eventos salen del servidor en otro orden (el de «terminó» antes que el de «en cola»), la pantalla se queda con el viejo y nada
 * lo corrige. No es un sondeo: es una sola lectura por botón, y no hace nada si el trabajo ya figura terminado.
 */
function repasar(id: string) {
  setTimeout(() => {
    const t = useIA.getState().trabajos[id]
    if (t && esVivo(t.estado)) api.trabajo(id).then((nuevo) => useIA.getState().guardarTrabajos([nuevo]), () => {})
  }, 5000)
}

/** Cuándo llegó el último evento de cada trabajo (reloj del navegador): para no pisar un estado nuevo con la respuesta vieja de un botón. */
const eventoDe = new Map<string, number>()

/**
 * Lo que hacen los cuatro botones: pedir y guardar lo que contesta el servidor. Esa respuesta es una foto del momento en que el servidor la
 * armó: un trabajo rápido ya puede haber vuelto a fallar o terminado, y su evento llegar ANTES que la respuesta. Si durante el pedido llegó un
 * evento del mismo trabajo, la respuesta es vieja y no se aplica (`viejo`): el evento ya dejó la pantalla al día.
 */
async function accion(pedir: () => Promise<TrabajoResumen>, alVolver: (t: TrabajoResumen, viejo: boolean) => void): Promise<boolean> {
  const desde = performance.now()
  try {
    const t = await pedir()
    const viejo = (eventoDe.get(t.id) ?? 0) > desde
    alVolver(t, viejo)
    if (esVivo(t.estado)) repasar(t.id)
    return true
  } catch (e) {
    avisarError(e)
    return false
  }
}

/**
 * Abre Configuración → IA: el diálogo en la computadora y la hoja «IA» en el teléfono (que no tiene Configuración). La tienda del
 * teléfono vive en `movil/`, que el escritorio no importa: se le avisa con un evento y AppMovil lo atiende.
 */
/** El enlace de una notificación que lleva a Configuración → Amigos (una solicitud de cuenta nueva, o muchas sin responder). */
export const ENLACE_AMIGOS = '/amigos'

/** Abre Configuración → Amigos: el diálogo en la computadora y la hoja «Amigos» en el teléfono (mismo camino que la IA). */
export function abrirConfiguracionAmigos() {
  if (document.documentElement.hasAttribute('data-movil')) window.dispatchEvent(new CustomEvent('telar:abrir-amigos'))
  else useTienda.getState().abrirConfiguracion('amigos')
}

export function abrirConfiguracionIA() {
  if (document.documentElement.hasAttribute('data-movil')) window.dispatchEvent(new CustomEvent('telar:abrir-ia'))
  else useTienda.getState().abrirConfiguracion('ia')
}

/**
 * Lleva a donde apunta una notificación (una ruta de Telar: `/RC/pendientes?tarjeta=RC-104`, nunca una dirección de
 * afuera) y la marca como leída. La usan la bandeja de escritorio y la hoja del celular.
 */
export function abrirNotificacion(n: Notificacion) {
  if (!n.leidaEn) void useIA.getState().marcarLeidas([n.id])
  const enlace = n.enlace
  // Un tope o un fallo sin tarjeta (la cuenta entera llegó al tope, una clave dejó de andar) se arregla en Configuración → IA.
  if (!enlace && (n.tipo === 'tope' || n.tipo === 'error_ia')) return abrirConfiguracionIA()
  if (enlace === ENLACE_AMIGOS) return abrirConfiguracionAmigos()
  if (!enlace || !enlace.startsWith('/') || enlace.startsWith('//')) return
  const url = new URL(enlace, location.origin)
  const partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const vista = partes[2] === 'lienzo' ? 'lienzo' : partes[2] === 'diseno' ? 'diseno' : 'kanban'
  irA({
    prefijo: partes[0]?.toUpperCase() ?? null,
    slug: partes[1] ?? null,
    vista,
    tarjeta: url.searchParams.get('tarjeta'),
    pagina: vista === 'diseno' ? (partes[3] ?? null) : null,
    sel: vista === 'diseno' ? url.searchParams.get('sel') : null,
  })
}
