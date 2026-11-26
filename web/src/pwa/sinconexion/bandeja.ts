// La bandeja sin conexión (plan del celular, 9.6): las tarjetas nuevas que se anotan sin señal. Crear es agregar: no pisa
// nada de nadie y no tiene conflicto posible; por eso es lo único que se guarda para mandar después.
//   · Se guardan en IndexedDB (almacén "pendientes") con un identificador propio y se ven en su lista con borde punteado,
//     la nube tachada y "Se sube cuando haya conexión". No se abren ni se arrastran: tocarlas abre la hoja de pendientes.
//   · Al volver la señal se mandan en orden, de a una. Si una falla por algo que no es la red (por ejemplo, la lista ya no
//     está), queda con "No se pudo subir · Reintentar · Descartar" y el texto no se pierde.
//   · Para no duplicar: se manda el identificador propio (lo usa un servidor que acepte `id`, N11a) y, si un envío quedó
//     sin respuesta, antes de reintentarlo se mira el tablero y, si ya hay una tarjeta con el mismo título creada después
//     del intento, se la da por subida (el respaldo de N11a).
import { generateKeyBetween } from 'fractional-indexing'
import { create } from 'zustand'
import type { TableroCompleto, TarjetaResumen } from '../../../../compartido/tipos'
import { ErrorApi } from '../../estado/api'
import { avisar, useAvisos } from '../../estado/avisos'
import { idLocal, porOrden, useTienda } from '../../estado/tienda'
import { usePwa } from '../estado'
import { borrar, guardar, todos } from './almacen'

export const PREFIJO_PENDIENTE = 'tmp-pend-'
export const LEYENDA_PENDIENTE = 'Se sube cuando haya conexión'
export const LEYENDA_SUBIENDO = 'Subiendo…'
export const LEYENDA_FALLIDA = 'No se pudo subir'
/** El reloj del teléfono y el del servidor pueden no coincidir: margen para reconocer una tarjeta ya subida. */
const MARGEN_RELOJ = 5 * 60_000

export interface Pendiente {
  id: string
  tableroId: string
  listaId: string
  /** Para mostrarla en la hoja aunque la lista ya no esté. */
  listaNombre: string
  titulo: string
  extra: Record<string, unknown>
  posicion: 'arriba' | 'abajo'
  creada: string
  /** Cuándo salió el último envío que quedó sin respuesta (puede haber llegado: se mira antes de reintentar). */
  intento: string | null
  /** Las tarjetas con el mismo título que ya existían cuando salió ese envío: no son esta. */
  conocidas?: string[]
  estado: 'pendiente' | 'fallida'
  error: string | null
}

interface ApiBandeja {
  crearTarjeta: (datos: Record<string, unknown>) => Promise<TarjetaResumen>
  tablero: (id: string) => Promise<TableroCompleto>
}

export const useBandeja = create<{ pendientes: Pendiente[]; subiendo: string | null }>(() => ({ pendientes: [], subiendo: null }))

let api: ApiBandeja | null = null
let enCurso = false

export const sinConexion = () => !usePwa.getState().enLinea
export const esPendiente = (id: string) => id.startsWith(PREFIJO_PENDIENTE)
export const hayPendientes = () => useBandeja.getState().pendientes.some((p) => p.estado === 'pendiente')

const poner = (pendientes: Pendiente[]) => useBandeja.setState({ pendientes })

function claveSegura(a: string | null, b: string | null) {
  try {
    return generateKeyBetween(a, b)
  } catch {
    return generateKeyBetween(a, null)
  }
}

// ───────── Las tarjetas que se ven en las listas ─────────

function tarjetaVisible(p: Pendiente, t: TableroCompleto, listaId: string, orden: string, subiendo: boolean): TarjetaResumen {
  const nombres = (x: unknown) => (Array.isArray(x) ? x.map((y) => String(y).toLowerCase()) : [])
  const etiquetas = nombres(p.extra.etiquetas)
  const responsables = nombres(p.extra.responsables)
  return {
    id: PREFIJO_PENDIENTE + p.id,
    // La clave hace de leyenda: el frente de la tarjeta (el mismo de escritorio) la muestra en su pie.
    clave: subiendo ? LEYENDA_SUBIENDO : p.estado === 'fallida' ? LEYENDA_FALLIDA : LEYENDA_PENDIENTE,
    numero: 0,
    proyectoId: t.proyecto.id,
    tableroId: t.tablero.id,
    listaId,
    orden,
    padreId: null,
    tipo: (p.extra.tipo as TarjetaResumen['tipo']) ?? 'tarea',
    titulo: p.titulo,
    prioridad: (p.extra.prioridad as TarjetaResumen['prioridad']) ?? 'ninguna',
    estimacion: null,
    etiquetas: t.etiquetas.filter((e) => etiquetas.includes(e.nombre.toLowerCase())).map((e) => e.id),
    responsables: t.miembros.filter((m) => responsables.some((r) => m.nombre.toLowerCase().startsWith(r))).map((m) => m.id),
    fechas: { inicio: null, vence: null, conHora: false, completada: null },
    portada: null,
    contadores: { comentarios: 0, adjuntos: 0, checklistHechos: 0, checklistTotal: 0, vinculos: 0, bloqueadaPor: 0, hijas: 0 },
    enlaces: [],
    porque: null,
    tieneDescripcion: false,
    discord: false,
    archivada: false,
    version: 0,
    creadaEn: p.creada,
    actualizadaEn: p.creada,
    origen: null,
  }
}

/** Pone las pendientes de este tablero en sus listas (arriba o abajo, como se anotaron). Se llama cada vez que cambia el tablero. */
function mostrar() {
  const t = useTienda.getState().tablero
  if (!t) return
  const { pendientes, subiendo } = useBandeja.getState()
  const reales = t.tarjetas.filter((x) => !esPendiente(x.id))
  const listas = [...t.listas].filter((l) => !l.archivada).sort(porOrden)
  const porLista = new Map<string, Pendiente[]>()
  for (const p of pendientes) {
    if (p.tableroId !== t.tablero.id) continue
    // Si la lista ya no está, se ve en la primera: que no quede escondida (al subir se avisa).
    const listaId = listas.some((l) => l.id === p.listaId) ? p.listaId : listas[0]?.id
    if (!listaId) continue
    porLista.set(listaId, [...(porLista.get(listaId) ?? []), p])
  }
  const visibles: TarjetaResumen[] = []
  for (const [listaId, ps] of porLista) {
    const hermanas = reales.filter((x) => x.listaId === listaId && !x.archivada).sort(porOrden)
    // Cada "arriba" nueva va encima de la anterior; cada "abajo" nueva, debajo.
    let arriba = hermanas[0]?.orden ?? null
    let tope: string | null = null
    for (const p of ps.filter((x) => x.posicion === 'arriba')) {
      arriba = claveSegura(null, arriba)
      tope ??= arriba
      visibles.push(tarjetaVisible(p, t, listaId, arriba, subiendo === p.id))
    }
    let abajo = hermanas.at(-1)?.orden ?? tope
    for (const p of ps.filter((x) => x.posicion === 'abajo')) {
      abajo = claveSegura(abajo, null)
      visibles.push(tarjetaVisible(p, t, listaId, abajo, subiendo === p.id))
    }
  }
  const firma = (ts: TarjetaResumen[]) =>
    ts
      .filter((x) => esPendiente(x.id))
      .map((x) => [x.id, x.clave, x.listaId, x.orden, x.titulo, x.etiquetas.join(), x.responsables.join()].join('\u0001'))
      .sort()
      .join('\u0002')
  if (firma(t.tarjetas) === firma(visibles)) return
  useTienda.setState({ tablero: { ...t, tarjetas: [...reales, ...visibles] } })
}

// ───────── Anotar ─────────

/**
 * Guarda una tarjeta nueva en el teléfono. `intento` es la hora de un envío que se cortó sin respuesta (puede haber
 * llegado al servidor): antes de mandarla se mira si ya está.
 */
export async function crearTarjetaSinConexion(
  listaId: string,
  titulo: string,
  extra: Record<string, unknown>,
  posicion: 'arriba' | 'abajo',
  intento: string | null = null,
): Promise<TarjetaResumen | null> {
  const t = useTienda.getState().tablero
  if (!t) return null
  const p: Pendiente = {
    id: idLocal(),
    tableroId: t.tablero.id,
    listaId,
    listaNombre: t.listas.find((l) => l.id === listaId)?.nombre ?? '',
    titulo,
    extra,
    posicion,
    creada: new Date().toISOString(),
    intento,
    conocidas: intento ? mismoTitulo(t.tarjetas, titulo) : [],
    estado: 'pendiente',
    error: null,
  }
  poner([...useBandeja.getState().pendientes, p])
  await guardar('pendientes', p.id, p)
  mostrar()
  return useTienda.getState().tablero?.tarjetas.find((x) => x.id === PREFIJO_PENDIENTE + p.id) ?? null
}

/**
 * Lo que usa el compositor rápido del teléfono: con señal crea como siempre; sin señal (o si se corta justo mientras se
 * manda), la tarjeta queda guardada en el teléfono en vez de perderse.
 */
export async function crearDesdeCompositor(
  listaId: string,
  titulo: string,
  extra: Record<string, unknown>,
  posicion: 'arriba' | 'abajo',
): Promise<TarjetaResumen | null> {
  if (sinConexion()) return crearTarjetaSinConexion(listaId, titulo, extra, posicion)
  const salio = new Date().toISOString()
  const antes = new Set(useAvisos.getState().avisos.map((a) => a.id))
  const r = await useTienda.getState().crearTarjeta(listaId, titulo, extra, posicion)
  if (r || !sinConexion()) return r
  // Se cortó la señal en el medio: en vez de "no se guardó", queda en la bandeja.
  for (const a of useAvisos.getState().avisos) if (!antes.has(a.id) && a.tipo === 'error') useAvisos.getState().quitar(a.id)
  return crearTarjetaSinConexion(listaId, titulo, extra, posicion, salio)
}

// ───────── Subir ─────────

const mismoTitulo = (ts: TarjetaResumen[], titulo: string) =>
  ts.filter((x) => !esPendiente(x.id) && x.titulo.trim() === titulo.trim()).map((x) => x.id)

/**
 * ¿Ya llegó? Entre las tarjetas del servidor con el mismo título y en la misma lista, que no existían cuando salió el
 * envío, la creada más cerca de la hora del intento (con margen por si los relojes no coinciden).
 */
function yaLlego(p: Pendiente, t: TableroCompleto, tomadas: Set<string>): TarjetaResumen | null {
  if (!p.intento) return null
  const intento = new Date(p.intento).getTime()
  const titulo = p.titulo.trim()
  const candidatas = t.tarjetas.filter(
    (x) =>
      !tomadas.has(x.id) &&
      !p.conocidas?.includes(x.id) &&
      x.listaId === p.listaId &&
      x.titulo.trim() === titulo &&
      new Date(x.creadaEn).getTime() >= intento - MARGEN_RELOJ,
  )
  const distancia = (x: TarjetaResumen) => Math.abs(new Date(x.creadaEn).getTime() - intento)
  return candidatas.sort((a, b) => distancia(a) - distancia(b))[0] ?? null
}

async function cambiar(p: Pendiente) {
  poner(useBandeja.getState().pendientes.map((x) => (x.id === p.id ? p : x)))
  await guardar('pendientes', p.id, p)
}

async function quitarDeLaBandeja(id: string) {
  poner(useBandeja.getState().pendientes.filter((x) => x.id !== id))
  await borrar('pendientes', id)
}

/** Ya está en el servidor: sale de la bandeja y en la lista queda la tarjeta de verdad (con su clave). */
async function subida(p: Pendiente, r: TarjetaResumen) {
  await quitarDeLaBandeja(p.id)
  const s = useTienda.getState()
  if (s.tablero?.tablero.id !== r.tableroId) return
  useTienda.setState({ tablero: { ...s.tablero, tarjetas: s.tablero.tarjetas.filter((x) => x.id !== PREFIJO_PENDIENTE + p.id) } })
  s.ponerTarjeta(r)
  s.destellar(r.id)
}

type Resultado = 'subida' | 'sin-red' | 'fallida'

async function subirUna(p: Pendiente, tableros: Map<string, TableroCompleto>, tomadas: Set<string>): Promise<Resultado> {
  if (!api) return 'sin-red'
  try {
    // El tablero como está en el servidor: si la lista sigue y, si hubo un envío sin respuesta, si la tarjeta ya llegó.
    let t = tableros.get(p.tableroId)
    if (!t) {
      t = await api.tablero(p.tableroId)
      tableros.set(p.tableroId, t)
    }
    if (!t.listas.some((l) => l.id === p.listaId && !l.archivada)) {
      await cambiar({ ...p, estado: 'fallida', intento: null, error: `La lista «${p.listaNombre || 'sin nombre'}» ya no está en el tablero` })
      return 'fallida'
    }
    const ya = yaLlego(p, t, tomadas)
    if (ya) {
      tomadas.add(ya.id)
      await subida(p, ya)
      return 'subida'
    }
    // Se anota la hora (y las que ya había con ese título) antes de mandar: si la app se cierra o la respuesta no vuelve,
    // la próxima vez se mira antes de repetir.
    await cambiar({ ...p, intento: new Date().toISOString(), conocidas: mismoTitulo(t.tarjetas, p.titulo) })
    useBandeja.setState({ subiendo: p.id })
    mostrar()
    const r = await api.crearTarjeta({ id: p.id, tableroId: p.tableroId, listaId: p.listaId, titulo: p.titulo, posicion: p.posicion, ...p.extra })
    tomadas.add(r.id)
    await subida(p, r)
    return 'subida'
  } catch (e) {
    if (e instanceof ErrorApi && (e.estado === 0 || e.estado === 401)) {
      // Sin red (o venció la sesión): queda como estaba y se intenta con la próxima señal.
      if (e.estado === 0) usePwa.setState({ enLinea: false })
      return 'sin-red'
    }
    const actual = useBandeja.getState().pendientes.find((x) => x.id === p.id) ?? p
    await cambiar({ ...actual, estado: 'fallida', intento: null, error: e instanceof Error ? e.message : String(e) })
    return 'fallida'
  } finally {
    if (useBandeja.getState().subiendo === p.id) {
      useBandeja.setState({ subiendo: null })
      mostrar()
    }
  }
}

/** Manda las pendientes en orden, de a una. Lo llaman la vuelta de la señal, Reintentar y "Subir ahora". */
export async function subirPendientes(): Promise<void> {
  if (enCurso || !api) return
  const cola = useBandeja.getState().pendientes.filter((p) => p.estado === 'pendiente')
  if (!cola.length) return
  enCurso = true
  let subidas = 0
  let fallidas = 0
  const tableros = new Map<string, TableroCompleto>()
  const tomadas = new Set<string>()
  try {
    for (const p of cola) {
      const r = await subirUna(p, tableros, tomadas)
      if (r === 'sin-red') break
      if (r === 'subida') subidas++
      else fallidas++
    }
  } finally {
    enCurso = false
    mostrar()
  }
  if (subidas)
    avisar({
      texto: subidas === 1 ? 'Se subió la tarjeta que anotaste sin conexión' : `Se subieron las ${subidas} tarjetas que anotaste sin conexión`,
      tipo: 'ok',
    })
  if (fallidas) avisar({ texto: fallidas === 1 ? 'Una tarjeta no se pudo subir' : `${fallidas} tarjetas no se pudieron subir`, tipo: 'error', duracion: 6000 })
}

export async function reintentar(id: string) {
  const p = useBandeja.getState().pendientes.find((x) => x.id === id)
  if (!p) return
  // Si su lista ya no está, va a la primera del tablero (y se dice en la hoja).
  const t = useTienda.getState().tablero
  let { listaId, listaNombre } = p
  if (t && t.tablero.id === p.tableroId && !t.listas.some((l) => l.id === listaId && !l.archivada)) {
    const primera = [...t.listas].filter((l) => !l.archivada).sort(porOrden)[0]
    if (primera) ({ id: listaId, nombre: listaNombre } = primera)
  }
  await cambiar({ ...p, listaId, listaNombre, estado: 'pendiente', error: null })
  mostrar()
  if (sinConexion()) avisar({ texto: 'Se sube cuando haya conexión' })
  else await subirPendientes()
}

export async function descartar(id: string) {
  const p = useBandeja.getState().pendientes.find((x) => x.id === id)
  if (!p) return
  await quitarDeLaBandeja(id)
  mostrar()
  avisar({
    texto: 'Descartaste la tarjeta',
    accion: {
      etiqueta: 'Deshacer',
      fn: async () => {
        poner([...useBandeja.getState().pendientes, p].sort((a, b) => (a.creada < b.creada ? -1 : 1)))
        await guardar('pendientes', p.id, p)
        mostrar()
      },
    },
  })
}

/** Al salir o al vencer la sesión: la bandeja se vacía (el almacén lo borra instantanea.ts). */
export function vaciarBandeja() {
  poner([])
  mostrar()
}

export async function iniciarBandeja(original: ApiBandeja) {
  api = original
  useTienda.subscribe((s, a) => {
    if (s.tablero !== a.tablero) mostrar()
    // Recién cargado con conexión (la sesión está bien): lo que quedó de otra vez se sube.
    if (s.listo && !a.listo && !sinConexion()) void subirPendientes()
  })
  const guardadas = await todos<Pendiente>('pendientes')
  poner(guardadas.sort((a, b) => (a.creada < b.creada ? -1 : 1)))
  mostrar()
  if (useTienda.getState().listo && !sinConexion()) void subirPendientes()
}
