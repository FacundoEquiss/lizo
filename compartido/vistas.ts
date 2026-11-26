// Las vistas de un tablero: cada tablero tiene un subconjunto de Kanban, Lienzo y Diseño (al menos una). Antes todo tablero traía
// las tres y un diagrama solo arrastraba un Kanban y un Diseño vacíos («No me gusta que se crean paneles al pedo»). Ahora se
// elige el tipo al crearlo y la interfaz muestra solo lo que el tablero tiene.
// Dónde vive: en `tableros.ajustes.vistas` (JSON), así que no hace falta migrar nada: un tablero sin ese ajuste (todos los que ya
// existían) tiene las tres. Lo comparten la web (qué pestañas se dibujan), el servidor (qué se crea y qué se acepta) y el MCP.
import type { AjustesTablero } from './tipos'

export type VistaTablero = 'kanban' | 'lienzo' | 'diseno'

/** En el orden en que se dibujan las pestañas y se listan en los textos. */
export const VISTAS: readonly VistaTablero[] = ['kanban', 'lienzo', 'diseno']

/** Cómo se llama cada vista en la interfaz. */
export const NOMBRE_VISTA: Record<VistaTablero, string> = { kanban: 'Kanban', lienzo: 'Lienzo', diseno: 'Diseño' }

/** El tipo de tablero que se elige al crearlo: un atajo para un conjunto de vistas. */
export type TipoTablero = 'tablero' | 'diagrama' | 'diseno' | 'completo'

export const TIPOS_TABLERO: readonly TipoTablero[] = ['tablero', 'diagrama', 'diseno', 'completo']

export const VISTAS_DEL_TIPO: Record<TipoTablero, readonly VistaTablero[]> = {
  tablero: ['kanban'],
  diagrama: ['lienzo'],
  diseno: ['diseno'],
  completo: ['kanban', 'lienzo', 'diseno'],
}

/** Lo que dice la interfaz de cada tipo (el nombre y una frase). */
export const TEXTO_TIPO: Record<TipoTablero, { nombre: string; frase: string }> = {
  tablero: { nombre: 'Tablero', frase: 'Solo Kanban: listas y tarjetas con su porqué.' },
  diagrama: { nombre: 'Diagrama', frase: 'Solo lienzo infinito: diagramas, mapas, notas y tablas.' },
  diseno: { nombre: 'Diseño', frase: 'Solo hoja de diseño: manual de marca, sistema, marcos.' },
  completo: { nombre: 'Completo', frase: 'Las tres vistas: Kanban, lienzo y diseño.' },
}

/** De fábrica al crear: «Tablero» (es lo que el dueño usa más y lo que menos sorprende). */
export const TIPO_DE_FABRICA: TipoTablero = 'tablero'

const esVista = (v: unknown): v is VistaTablero => typeof v === 'string' && (VISTAS as readonly string[]).includes(v)

/** Ordena y saca los repetidos: ['lienzo', 'kanban', 'lienzo'] → ['kanban', 'lienzo']. */
export function ordenarVistas(vistas: readonly VistaTablero[]): VistaTablero[] {
  return VISTAS.filter((v) => vistas.includes(v))
}

/**
 * Las vistas de un tablero a partir de sus ajustes. Sin el ajuste (los tableros de antes) o con algo que no se entiende: las tres,
 * así lo que existía no cambia.
 */
export function leerVistas(ajustes: AjustesTablero | Record<string, unknown> | null | undefined): VistaTablero[] {
  const v = (ajustes as AjustesTablero | null | undefined)?.vistas
  if (!Array.isArray(v)) return [...VISTAS]
  const buenas = ordenarVistas(v.filter(esVista))
  return buenas.length ? buenas : [...VISTAS]
}

/** Valida lo que llega de afuera (web o MCP): al menos una, y solo de las tres que existen. Devuelve el texto del problema o null. */
export function problemaEnVistas(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return `Un tablero necesita al menos una vista. Elegí entre: ${VISTAS.join(', ')}.`
  const raras = v.filter((x) => !esVista(x))
  if (raras.length) return `Vista desconocida: ${raras.map((x) => `«${String(x)}»`).join(', ')}. Las vistas son: ${VISTAS.join(', ')}.`
  return null
}

/** El tipo que mejor describe un conjunto de vistas (una sola vista tiene su nombre; dos o tres, «completo»). */
export function tipoDeVistas(vistas: readonly VistaTablero[]): TipoTablero {
  if (vistas.length === 1) return vistas[0] === 'kanban' ? 'tablero' : vistas[0] === 'lienzo' ? 'diagrama' : 'diseno'
  return 'completo'
}

/** La vista a la que se entra cuando la que se pidió no está: la primera que el tablero tiene. */
export function vistaInicial(vistas: readonly VistaTablero[]): VistaTablero {
  return ordenarVistas(vistas)[0] ?? 'kanban'
}

/** ¿Tiene el tablero esa vista? (un tablero sin la lista de vistas las tiene todas). */
export function tieneVista(t: { vistas?: readonly VistaTablero[] } | null | undefined, v: VistaTablero): boolean {
  return !t?.vistas || t.vistas.includes(v)
}

/** «Kanban», «Kanban y Lienzo», «Kanban, Lienzo y Diseño»: para los mensajes. */
export function frasePorVistas(vistas: readonly VistaTablero[]): string {
  const n = ordenarVistas(vistas).map((v) => NOMBRE_VISTA[v])
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} y ${n.at(-1)}`
}

/** El mensaje cuando se pide algo de una vista que el tablero no tiene: cuál falta, qué tiene y cómo sumarla. */
export function mensajeSinVista(nombreTablero: string, falta: VistaTablero, tiene: readonly VistaTablero[]): string {
  const sumadas = ordenarVistas([...tiene, falta])
  return (
    `El tablero «${nombreTablero}» no tiene la vista ${NOMBRE_VISTA[falta]} (tiene: ${frasePorVistas(tiene)}). ` +
    `Para sumarla: actualizar_tablero { "tablero": "${nombreTablero}", "vistas": ${JSON.stringify(sumadas)} } (o en la app, ⋯ del tablero → Vistas).`
  )
}
