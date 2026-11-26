// Copiar, cortar y pegar objetos del lienzo (5.8), con los conectores que hay entre ellos. Lo copiado queda en la memoria
// y en el portapapeles del sistema como texto "telar:{…}": así se puede pegar en otro tablero o en otra pestaña. Si el
// portapapeles del sistema tiene otra cosa (una imagen, un enlace, un texto), el lienzo hace lo de siempre con eso.
import type { Conector, ElementoLienzo } from '../../../../compartido/tipos'

export const PREFIJO_RECORTE = 'telar:'

export type ElementoCopiado = Pick<ElementoLienzo, 'id' | 'tipo' | 'x' | 'y' | 'ancho' | 'alto' | 'z' | 'datos' | 'tarjetaId' | 'listaId'>
export type ConectorCopiado = Omit<Conector, 'tableroId'>

export interface Recorte {
  v: 1
  /** De qué tablero salió (las tarjetas y las listas del Kanban no pasan a otro). */
  tableroId: string
  elementos: ElementoCopiado[]
  conectores: ConectorCopiado[]
}

let memoria: Recorte | null = null

export function armarRecorte(tableroId: string, elementos: ElementoLienzo[], conectores: Conector[]): Recorte {
  const ids = new Set(elementos.map((e) => e.id))
  return {
    v: 1,
    tableroId,
    elementos: elementos.map(({ id, tipo, x, y, ancho, alto, z, datos, tarjetaId, listaId }) => ({ id, tipo, x, y, ancho, alto, z, datos, tarjetaId, listaId })),
    conectores: conectores.filter((c) => ids.has(c.desdeId) && ids.has(c.hastaId)).map(({ tableroId: _t, ...c }) => c),
  }
}

export const guardarRecorte = (r: Recorte) => {
  memoria = r
}

export const recorteEnMemoria = () => memoria

export const aTexto = (r: Recorte) => PREFIJO_RECORTE + JSON.stringify(r)

/** El recorte de un texto "telar:{…}" (o null si es otra cosa o no se puede leer). */
export function deTexto(texto: string | null | undefined): Recorte | null {
  if (!texto?.startsWith(PREFIJO_RECORTE)) return null
  try {
    const r = JSON.parse(texto.slice(PREFIJO_RECORTE.length)) as Recorte
    if (r?.v !== 1 || !Array.isArray(r.elementos) || !Array.isArray(r.conectores)) return null
    const valido = r.elementos.every((e) => typeof e.id === 'string' && typeof e.tipo === 'string' && Number.isFinite(e.x) && Number.isFinite(e.y))
    return valido ? r : null
  } catch {
    return null
  }
}

/** Lleva el recorte al portapapeles del sistema fuera de un evento de copiar (el menú contextual). */
export async function escribirEnSistema(r: Recorte) {
  try {
    await navigator.clipboard?.writeText(aTexto(r))
  } catch {
    // Sin permiso: queda en la memoria (alcanza para pegar en esta pestaña).
  }
}

/** Lee del portapapeles del sistema (el menú contextual "Pegar"): el texto, o null si no hay permiso. */
export async function leerDelSistema(): Promise<string | null> {
  try {
    return (await navigator.clipboard?.readText()) ?? null
  } catch {
    return null
  }
}
