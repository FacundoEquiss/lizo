// Leer sin conexión (plan del celular, 9.6). Lo último que se cargó se guarda desde la app (IndexedDB), no desde el
// service worker: el service worker contesta sin saber quién pregunta; la app sabe si hubo sesión, cuándo cerrar y qué
// borrar. Guardar "respuestas de la API" en el service worker es justo lo que no hay que hacer con datos de sesión.
//
//   · Se guarda escuchando la tienda desde afuera, 1,5 s después del último cambio y siempre al pasar a segundo plano:
//     inicio (proyectos y miembros), los últimos 3 tableros y las últimas 30 tarjetas abiertas. Vence a los 14 días.
//   · La API queda envuelta: sin red, las lecturas devuelven lo guardado (si hubo sesión) y las escrituras avisan
//     "Sin conexión: no se guardó" (la tienda deshace el cambio, como siempre). Así la tienda no se toca.
//   · Arranque sin red y sin nada guardado: "Telar necesita conexión la primera vez" (PantallaSinConexion), que reintenta
//     sola al volver la señal. Nunca más el ciclo de recargas (N12a).
//   · Se borra todo al salir y cuando el servidor dice que la sesión venció: lo guardado muere con la sesión.
import type { InfoConexion, Miembro, Proyecto, TableroCompleto, TarjetaDetalle } from '../../../../compartido/tipos'
import { api, ErrorApi } from '../../estado/api'
import { rutaActual } from '../../estado/ruta'
import { useSesion } from '../../estado/sesion'
import { useTienda } from '../../estado/tienda'
import { esInstalada, esMovil } from '../../movil/detectar'
import { usePwa } from '../estado'
import { borrar, guardar, leer, vaciar } from './almacen'
import { hayPendientes, iniciarBandeja, subirPendientes, vaciarBandeja } from './bandeja'

const VENCE = 14 * 24 * 3600 * 1000
const MAX_TABLEROS = 3
const MAX_TARJETAS = 30
const REINTENTO_INICIO = 10_000

interface Guardado<T> {
  datos: T
  guardado: string
}
interface Inicio {
  proyectos: Proyecto[]
  miembros: Miembro[]
}
interface Indice {
  tableros: string[]
  tarjetas: string[]
}

type Funcion = (...a: never[]) => Promise<unknown>
type Api = typeof api
let original = { ...api } as Api
let iniciado = false

export const sinRed = (e: unknown) => e instanceof ErrorApi && e.estado === 0
const vigente = <T,>(g: Guardado<T> | undefined): g is Guardado<T> => !!g && Date.now() - new Date(g.guardado).getTime() < VENCE

async function deLoGuardado<T>(clave: string): Promise<T | null> {
  const sesion = await leer<{ ok: boolean }>('instantanea', 'sesion')
  if (!sesion?.ok) return null
  const g = await leer<Guardado<T>>('instantanea', clave)
  if (!vigente(g)) return null
  const antes = usePwa.getState().instantanea
  // La franja dice desde cuándo es lo que se ve: lo más viejo de lo que se está mostrando.
  usePwa.setState({ enLinea: false, instantanea: !antes || g.guardado < antes ? g.guardado : antes })
  return g.datos
}

/** Una tarjeta que nunca se abrió: lo que trae el tablero, y la hoja muestra "El detalle se ve con conexión". */
function detalleMinimo(ref: string): TarjetaDetalle | null {
  const t = useTienda.getState().tablero
  const r = t?.tarjetas.find((x) => x.clave === ref || x.id === ref)
  if (!t || !r || r.id.startsWith('tmp-')) return null
  const lista = t.listas.find((l) => l.id === r.listaId)
  return {
    ...r,
    descripcion: '',
    campos: { __sinConexion: true },
    porqueCompleto: r.porque
      ? {
          motivo: r.porque.motivo,
          contexto: '',
          opciones: [],
          decision: '',
          consecuencias: '',
          estado: r.porque.estado,
          evidencias: [],
          decidieron: [],
          decididaEn: null,
          revisarEn: null,
          reemplazadaPor: null,
          actualizadoEn: r.actualizadaEn,
        }
      : null,
    checklists: [],
    adjuntos: [],
    comentarios: [],
    vinculos: [],
    actividad: [],
    discordDatos: null,
    listaNombre: lista?.nombre ?? null,
    categoria: lista?.categoria ?? null,
    padre: null,
    hijas: [],
    repoGithub: null,
    enLienzo: [],
  }
}

/**
 * Algo contestó bien: hay señal. Si se estaba viendo lo guardado (o hay tarjetas por subir), se pone al día. Como mucho
 * una vez cada 10 s (las novedades preguntan cada 3 s); el evento "online" no espera.
 */
const CADA_RECONEXION = 10_000
let ultimaReconexion = 0
function conectado() {
  const p = usePwa.getState()
  if (!p.enLinea) usePwa.setState({ enLinea: true })
  if ((p.instantanea || p.falloInicio || hayPendientes()) && Date.now() - ultimaReconexion > CADA_RECONEXION) void reconectar()
}

// Lecturas con respaldo en lo guardado; el resto de las lecturas, sin red, avisan con su texto.
const RESPALDOS: Partial<Record<keyof Api, (...a: string[]) => Promise<unknown>>> = {
  proyectos: async () => (await deLoGuardado<Inicio>('inicio'))?.proyectos ?? null,
  miembros: async () => (await deLoGuardado<Inicio>('inicio'))?.miembros ?? null,
  tablero: (id) => deLoGuardado<TableroCompleto>(`tablero:${id}`),
  tarjeta: async (ref) => (await deLoGuardado<TarjetaDetalle>(`tarjeta:${ref}`)) ?? detalleMinimo(ref),
}
const SIN_RESPALDO: Partial<Record<keyof Api, string>> = {
  proyectos: 'Sin conexión',
  miembros: 'Sin conexión',
  tablero: 'Sin conexión: este tablero no quedó guardado en el teléfono',
  tarjeta: 'Sin conexión: esta tarjeta no quedó guardada en el teléfono',
  info: 'Sin conexión',
  archivadas: 'Sin conexión: las archivadas se ven con conexión',
  actividad: 'Sin conexión: la actividad se ve con conexión',
  buscar: 'Sin conexión: buscar necesita conexión',
}

function envolverApi() {
  original = { ...api }
  const destino = api as unknown as Record<string, Funcion>
  for (const [nombre, fn] of Object.entries(original) as [keyof Api, Funcion][]) {
    const lectura = nombre in SIN_RESPALDO
    destino[nombre] = (async (...a: never[]) => {
      try {
        const r = await fn(...a)
        conectado()
        return r
      } catch (e) {
        if (!sinRed(e)) throw e
        usePwa.setState({ enLinea: false })
        if (!lectura) throw new ErrorApi('Sin conexión: no se guardó', 0)
        const respaldo = RESPALDOS[nombre]
        const g = respaldo ? await respaldo(...(a as unknown as string[])) : null
        if (g !== null && g !== undefined) return g
        throw new ErrorApi(SIN_RESPALDO[nombre]!, 0)
      }
    }) as Funcion
  }
}

// ───────── Guardar lo último que se cargó ─────────

let reloj: ReturnType<typeof setTimeout> | null = null
const programar = () => {
  if (reloj) clearTimeout(reloj)
  reloj = setTimeout(guardarAhora, 1500)
}

async function guardarAhora() {
  if (reloj) clearTimeout(reloj)
  reloj = null
  const p = usePwa.getState()
  const s = useTienda.getState()
  const sesion = useSesion.getState()
  // Solo lo que vino del servidor: sin red (o viendo lo guardado) no se pisa lo bueno con algo a medias. Y nunca sin
  // sesión: lo que quedó en memoria al vencer no se vuelve a guardar.
  if (!p.enLinea || p.instantanea || !s.listo || (sesion.publico && !sesion.entrado)) return
  const ahora = new Date().toISOString()
  await guardar('instantanea', 'sesion', { ok: true, desde: ahora })
  await guardar('instantanea', 'inicio', { datos: { proyectos: s.proyectos, miembros: s.miembros }, guardado: ahora })
  const indice = (await leer<Indice>('instantanea', 'indice')) ?? { tableros: [], tarjetas: [] }
  if (s.tablero) {
    // Las tarjetas temporales (las que se están creando y las de la bandeja) no son del servidor.
    const t = { ...s.tablero, tarjetas: s.tablero.tarjetas.filter((x) => !x.id.startsWith('tmp-')) }
    await guardar('instantanea', `tablero:${t.tablero.id}`, { datos: t, guardado: ahora })
    indice.tableros = [t.tablero.id, ...indice.tableros.filter((x) => x !== t.tablero.id)]
    for (const viejo of indice.tableros.splice(MAX_TABLEROS)) await borrar('instantanea', `tablero:${viejo}`)
  }
  const d = s.detalle
  if (d && !(d.campos as { __sinConexion?: boolean }).__sinConexion) {
    await guardar('instantanea', `tarjeta:${d.clave}`, { datos: d, guardado: ahora })
    indice.tarjetas = [d.clave, ...indice.tarjetas.filter((x) => x !== d.clave)]
    for (const vieja of indice.tarjetas.splice(MAX_TARJETAS)) await borrar('instantanea', `tarjeta:${vieja}`)
  }
  await guardar('instantanea', 'indice', indice)
}

// ───────── Volver a tener señal ─────────

const mismo = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** El mismo tablero sin contar el orden en que quedaron las tarjetas en el arreglo ni las de la bandeja (de este teléfono). */
function mismoTablero(a: TableroCompleto, b: TableroCompleto) {
  const orden = (t: TableroCompleto) => ({
    ...t,
    tarjetas: t.tarjetas.filter((x) => !x.id.startsWith('tmp-')).sort((x, y) => (x.id < y.id ? -1 : 1)),
    elementos: [...t.elementos].sort((x, y) => (x.id < y.id ? -1 : 1)),
    conectores: [...t.conectores].sort((x, y) => (x.id < y.id ? -1 : 1)),
  })
  return mismo(orden(a), orden(b))
}

let reconectando = false
async function reconectar() {
  if (reconectando) return
  reconectando = true
  ultimaReconexion = Date.now()
  try {
    const [proyectos, miembros, info] = await Promise.all([
      original.proyectos(),
      original.miembros(),
      original.info().catch(() => null as InfoConexion | null),
    ])
    // Lo que llegó igual a lo que ya se ve no se vuelve a poner: en un teléfono lento, redibujar el tablero entero
    // por nada es un cuadro largo justo al arrancar.
    const antes = useTienda.getState()
    useTienda.setState({
      ...(mismo(antes.proyectos, proyectos) ? {} : { proyectos }),
      ...(mismo(antes.miembros, miembros) ? {} : { miembros }),
      listo: true,
      ...(info ? { info } : {}),
    })
    const s = useTienda.getState()
    if (s.tablero) {
      const id = s.tablero.tablero.id
      const t = await original.tablero(id)
      const ahora = useTienda.getState().tablero
      if (!ahora || ahora.tablero.id !== id || !mismoTablero(ahora, t)) useTienda.setState({ tablero: t, miembros: t.miembros, errorTablero: null })
      else useTienda.setState({ errorTablero: null })
      original.actividad(id, 60).then((a) => useTienda.getState().tablero?.tablero.id === id && useTienda.setState({ actividad: a })).catch(() => {})
    }
    usePwa.setState({ enLinea: true, instantanea: null, falloInicio: null })
    cancelarEspera?.()
    if (useTienda.getState().claveAbierta) void useTienda.getState().recargarDetalle()
    await subirPendientes()
    void guardarAhora()
  } catch {
    // Sigue sin señal: se reintenta con el próximo "online", la próxima consulta de novedades o el próximo pedido.
  } finally {
    reconectando = false
  }
}

/**
 * El teléfono dice que hay red pero el servidor no contesta (señal mala, el servidor caído un rato): no va a llegar
 * ningún "online". Mientras tanto, cada 10 s y solo con la app a la vista, se pregunta /api/salud (liviano, sin sesión).
 */
let sondaVuelta: ReturnType<typeof setInterval> | null = null
function vigilarVuelta(enLinea: boolean) {
  if (enLinea) {
    if (sondaVuelta) clearInterval(sondaVuelta)
    sondaVuelta = null
    return
  }
  sondaVuelta ??= setInterval(() => {
    if (document.hidden || !navigator.onLine) return
    fetch('/api/salud', { cache: 'no-store' })
      .then((r) => {
        if (r.ok) conectado()
      })
      .catch(() => {})
  }, 10_000)
}

/** El cambio de la tienda fue solo "enVivo" (lo que hacen las novedades al responder), no otra cosa. */
function soloEnVivo<T extends object>(s: T, a: T) {
  for (const k in s) if (k !== 'enVivo' && s[k] !== a[k]) return false
  return true
}

// ───────── Arranque ─────────

/**
 * Segunda carga instantánea (10.1): en el teléfono (o con la app instalada), mientras la red contesta se muestra lo
 * guardado (proyectos y el tablero de la dirección). Con el primer pedido que sale bien, reconectar() lo reemplaza por lo
 * del servidor, como al volver la señal. Si la red llega antes, no se usa. Si la dirección pide un proyecto o un tablero
 * que no está guardado, se espera a la red (si no, la app iría a otro lado).
 */
async function arrancarConLoGuardado() {
  const sesion = await leer<{ ok: boolean }>('instantanea', 'sesion')
  const inicio = await leer<Guardado<Inicio>>('instantanea', 'inicio')
  if (!sesion?.ok || !vigente(inicio) || useTienda.getState().listo) return
  let { prefijo, slug } = rutaActual()
  if (!prefijo) {
    try {
      const partes = (localStorage.getItem('telar.ultima-ruta') ?? '').split('/').filter(Boolean).map(decodeURIComponent)
      ;[prefijo, slug] = [partes[0] ?? null, partes[1] ?? null]
    } catch {}
  }
  const { proyectos, miembros } = inicio.datos
  const proyecto = prefijo ? proyectos.find((p) => p.prefijo === prefijo) : proyectos[0]
  const tablero = slug ? proyecto?.tableros.find((t) => t.slug === slug) : proyecto?.tableros[0]
  if (!proyecto || !tablero) return
  const guardado = await leer<Guardado<TableroCompleto>>('instantanea', `tablero:${tablero.id}`)
  const ses = useSesion.getState()
  if (!vigente(guardado) || useTienda.getState().listo || (ses.revisada && ses.publico && !ses.entrado)) return
  usePwa.setState({ instantanea: inicio.guardado < guardado.guardado ? inicio.guardado : guardado.guardado })
  useTienda.setState({ proyectos, miembros: guardado.datos.miembros ?? miembros, tablero: guardado.datos, listo: true })
}

let cancelarEspera: (() => void) | null = null

/** cargarInicio falló (N12a): sin red y sin nada guardado, o un error del servidor. Reintenta sola, sin recargar. */
export function alFallarInicio(e?: unknown) {
  const red = sinRed(e) || !navigator.onLine
  usePwa.setState({
    ...(red ? { enLinea: false } : {}),
    falloInicio: { sinRed: red, mensaje: e instanceof Error ? e.message : String(e ?? '') },
  })
  cancelarEspera?.()
  const otraVez = () => {
    cancelarEspera?.()
    void reintentarInicio()
  }
  const t = setTimeout(otraVez, REINTENTO_INICIO)
  addEventListener('online', otraVez)
  cancelarEspera = () => {
    clearTimeout(t)
    removeEventListener('online', otraVez)
    cancelarEspera = null
  }
}

export function reintentarInicio(): Promise<void> {
  cancelarEspera?.()
  return useTienda
    .getState()
    .cargarInicio()
    .then(() => usePwa.setState({ falloInicio: null }))
    .catch(alFallarInicio)
}

/**
 * Salir o sesión vencida: se borra lo guardado para leer sin conexión y la bandeja. El borrador del compositor se borra
 * al salir; si la sesión venció, queda (8.4: lo que se estaba escribiendo no se pierde; vive solo en esta pestaña y se ve
 * recién después de volver a entrar).
 */
export async function borrarTodo({ borrador = true }: { borrador?: boolean } = {}) {
  if (reloj) clearTimeout(reloj)
  reloj = null
  vaciarBandeja()
  await Promise.all([vaciar('instantanea'), vaciar('pendientes')])
  try {
    if (borrador) sessionStorage.removeItem('telar.borrador-rapido')
  } catch {}
  usePwa.setState({ instantanea: null })
}

export function iniciarSinConexion() {
  if (iniciado || typeof indexedDB === 'undefined') return
  iniciado = true
  envolverApi()
  if (esMovil() || esInstalada()) void arrancarConLoGuardado()
  void iniciarBandeja(original)
  useTienda.subscribe((s, a) => {
    if (s.proyectos !== a.proyectos || s.tablero !== a.tablero || s.detalle !== a.detalle) programar()
    // Una consulta de novedades que responde bien también cuenta como "hay señal" (aunque el teléfono nunca haya dicho
    // que estaba sin red: el servidor pudo no contestar un rato). Se reconoce porque solo pone enVivo.
    if (s.enVivo && (!a.enVivo || (!usePwa.getState().enLinea && soloEnVivo(s, a)))) conectado()
  })
  usePwa.subscribe((s, a) => {
    if (s.enLinea !== a.enLinea) vigilarVuelta(s.enLinea)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void guardarAhora()
  })
  addEventListener('online', () => {
    ultimaReconexion = 0
    void reconectar()
  })
  // Sesión vencida (o nunca hubo): lo guardado muere con ella.
  useSesion.subscribe((s, a) => {
    if (s.revisada && s.publico && !s.entrado && (a.entrado || !a.revisada)) void borrarTodo({ borrador: false })
  })
  // iOS borra lo guardado de una web que no se abre por unas semanas; instalada no tiene ese límite si se pide una vez.
  try {
    if (esInstalada() && navigator.storage?.persist && !localStorage.getItem('telar.persistir'))
      void navigator.storage.persist().finally(() => localStorage.setItem('telar.persistir', '1'))
  } catch {}
}
