// Deshacer y rehacer de verdad (incluidos los borrados del lienzo y los archivados).
// Cada acción guarda cómo volver atrás y cómo repetirse. Las acciones compuestas (crear un objeto y conectarlo,
// convertir una nota en tarjeta…) se juntan en un solo paso con enUnPaso.
import { useSyncExternalStore } from 'react'
import { avisar, avisarError } from './avisos'

export interface Paso {
  etiqueta: string
  deshacer: () => Promise<unknown> | unknown
  rehacer: () => Promise<unknown> | unknown
  /** Objetos que creó este paso (para olvidarlo si el objeto se descarta enseguida, como un texto vacío). */
  creo?: string[]
}

const atras: Paso[] = []
const adelante: Paso[] = []
let ocupado = false
let grupo: Paso[] | null = null

// ───── para que la interfaz sepa si hay algo para deshacer o rehacer ─────
let version = 0
const oyentes = new Set<() => void>()
function notificar() {
  version++
  for (const o of oyentes) o()
}
let instantanea = { puedeDeshacer: false, puedeRehacer: false, version: 0 }
function leer() {
  if (instantanea.version !== version)
    instantanea = { puedeDeshacer: atras.length > 0 && !ocupado, puedeRehacer: adelante.length > 0 && !ocupado, version }
  return instantanea
}

/** ¿Hay algo para deshacer o rehacer? (para apagar los botones de la barra). */
export function useHistorial(): { puedeDeshacer: boolean; puedeRehacer: boolean } {
  return useSyncExternalStore((cb) => {
    oyentes.add(cb)
    return () => {
      oyentes.delete(cb)
    }
  }, leer)
}

export function registrarPaso(p: Paso) {
  if (grupo) {
    grupo.push(p)
    return
  }
  atras.push(p)
  if (atras.length > 200) atras.shift()
  adelante.length = 0
  notificar()
}

/**
 * Olvida el último paso si fue crear ese objeto (un texto que se creó y quedó vacío no deja nada para deshacer).
 * Devuelve si lo olvidó.
 */
export function olvidarCreacion(id: string): boolean {
  const ultimo = atras[atras.length - 1]
  if (ultimo?.creo?.length === 1 && ultimo.creo[0] === id) {
    atras.pop()
    notificar()
    return true
  }
  return false
}

/**
 * ¿El último paso (o el grupo abierto) creó ese objeto? El primer texto de un objeto recién creado va con su creación:
 * deshacer lo saca entero (con lo escrito), en vez de dejarlo vacío.
 */
export function ultimoPasoCreo(id: string): boolean {
  if (grupo?.some((p) => p.creo?.includes(id))) return true
  return !!atras[atras.length - 1]?.creo?.includes(id)
}

/**
 * Junta en un solo paso todo lo que se registre mientras corre `fn`. El paso deshace en orden inverso y rehace en
 * orden. Si `fn` falla, deshace lo que ya se hizo y vuelve a tirar el error. Anidado, se suma al grupo de afuera.
 */
export async function enUnPaso<T>(etiqueta: string, fn: () => Promise<T>): Promise<T> {
  if (grupo) return fn()
  grupo = []
  try {
    const r = await fn()
    const pasos = grupo
    grupo = null
    // Lo que crearon los pasos de adentro (un texto creado y conectado que queda vacío se olvida entero).
    const creo = pasos.flatMap((p) => p.creo ?? [])
    if (pasos.length === 1) registrarPaso({ ...pasos[0]!, etiqueta })
    else if (pasos.length > 1)
      registrarPaso({
        etiqueta,
        ...(creo.length ? { creo } : {}),
        deshacer: async () => {
          for (const p of [...pasos].reverse()) await p.deshacer()
        },
        rehacer: async () => {
          for (const p of pasos) await p.rehacer()
        },
      })
    return r
  } catch (e) {
    const pasos = grupo ?? []
    grupo = null
    for (const p of [...pasos].reverse()) {
      try {
        await p.deshacer()
      } catch {
        // seguimos deshaciendo lo demás
      }
    }
    throw e
  }
}

// Ctrl+Z apretado varias veces seguidas: cada pedido espera al anterior (no se pierde ninguno). Con más de 20
// esperando (la tecla mantenida), los de más no se anotan.
let enCola = 0
let cola: Promise<void> = Promise.resolve()
function encolar(fn: () => Promise<void>): Promise<void> {
  if (enCola >= 20) return cola
  enCola++
  cola = cola.then(fn).finally(() => {
    enCola--
  })
  return cola
}

export function deshacer(): Promise<void> {
  return encolar(deshacerAhora)
}

async function deshacerAhora() {
  const p = atras.pop()
  if (!p) {
    avisar({ texto: 'No hay nada para deshacer.' })
    return
  }
  ocupado = true
  notificar()
  try {
    await p.deshacer()
    adelante.push(p)
    avisar({ texto: `Deshecho: ${p.etiqueta}`, duracion: 2200 })
  } catch (e) {
    avisarError(e)
  } finally {
    ocupado = false
    notificar()
  }
}

/**
 * Deshace un paso puntual (el botón "Deshacer" de un aviso). Si es el último, es un deshacer común (se puede rehacer);
 * si ya hubo otros después, se deshace solo ese y sale de la historia.
 */
export function deshacerEste(p: Paso): Promise<void> {
  return encolar(() => deshacerEsteAhora(p))
}

async function deshacerEsteAhora(p: Paso) {
  const i = atras.lastIndexOf(p)
  if (i === -1) return
  if (i === atras.length - 1) return deshacerAhora()
  atras.splice(i, 1)
  ocupado = true
  notificar()
  try {
    await p.deshacer()
    avisar({ texto: `Deshecho: ${p.etiqueta}`, duracion: 2200 })
  } catch (e) {
    avisarError(e)
  } finally {
    ocupado = false
    notificar()
  }
}

export function rehacer(): Promise<void> {
  return encolar(rehacerAhora)
}

async function rehacerAhora() {
  const p = adelante.pop()
  if (!p) {
    avisar({ texto: 'No hay nada para rehacer.' })
    return
  }
  ocupado = true
  notificar()
  try {
    await p.rehacer()
    atras.push(p)
    avisar({ texto: `Rehecho: ${p.etiqueta}`, duracion: 2200 })
  } catch (e) {
    avisarError(e)
  } finally {
    ocupado = false
    notificar()
  }
}
