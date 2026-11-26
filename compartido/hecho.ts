// Las listas de «Hecho» (categoría `hecho`): lo listo se acumula, así que se muestran las más recientes y el resto se va
// a «Ver N anteriores»; y, pasado un tiempo, Telar archiva solo lo viejo (reversible: queda en Archivadas).
// Lo comparten la web (qué se dibuja), el servidor (qué se archiva) y el MCP (`leer_tablero`).
import type { AjustesTablero, TarjetaResumen } from './tipos'

/** Cuántas tarjetas de una lista de Hecho se muestran de entrada, y de a cuántas se suman con «Ver N anteriores». */
export const PAGINA_HECHO = 20

/** Los días que se pueden elegir para el archivo automático (`null` = nunca). */
export const DIAS_ARCHIVO_HECHO = [7, 14, 30, 60] as const
export type DiasArchivoHecho = (typeof DIAS_ARCHIVO_HECHO)[number] | null
/** De fábrica, para los tableros nuevos y para los que ya existían. */
export const DIAS_ARCHIVO_DE_FABRICA: DiasArchivoHecho = 30

/** Los días del archivo automático de un tablero: lo que eligió (incluido «nunca») o los de fábrica. */
export function leerDiasArchivoHecho(ajustes: AjustesTablero | Record<string, unknown> | null | undefined): DiasArchivoHecho {
  const a = (ajustes as AjustesTablero | null | undefined)?.archivoHecho
  if (!a || typeof a !== 'object' || !('dias' in a)) return DIAS_ARCHIVO_DE_FABRICA
  if (a.dias === null) return null
  return (DIAS_ARCHIVO_HECHO as readonly number[]).includes(a.dias as number) ? (a.dias as DiasArchivoHecho) : DIAS_ARCHIVO_DE_FABRICA
}

/** «Nunca», «a los 7 días»… para los textos de la app. */
export function frasePlazoHecho(dias: DiasArchivoHecho): string {
  return dias === null ? 'nunca' : `a los ${dias} días`
}

/**
 * Cuándo llegó la tarjeta a Hecho: `completada` (el servidor la pone al moverla a una lista de Hecho o al crearla ahí). Si no
 * la tiene (tarjetas viejas o importadas), la última vez que se tocó.
 */
export function llegoAHecho(t: Pick<TarjetaResumen, 'fechas' | 'actualizadaEn'>): string {
  return t.fechas.completada ?? t.actualizadaEn
}

/** De la que llegó más tarde a la que llegó antes (empate: por clave, así el orden no salta). */
export function porRecienteEnHecho(a: Pick<TarjetaResumen, 'fechas' | 'actualizadaEn' | 'id'>, b: Pick<TarjetaResumen, 'fechas' | 'actualizadaEn' | 'id'>): number {
  const x = llegoAHecho(a)
  const y = llegoAHecho(b)
  return x < y ? 1 : x > y ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
