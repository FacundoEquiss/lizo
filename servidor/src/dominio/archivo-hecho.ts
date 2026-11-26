// El barrido del archivo automático de Hecho para el cron (el mismo que ya corre cada minuto en Vercel y, en la computadora, el
// temporizador del proceso): mira los tableros de TODAS las cuentas que tienen algo viejo en Hecho y le pide a cada cuenta,
// con su propio Servicio, que archive lo suyo (`Servicio.archivarHechasViejas`). Es el respaldo de lo perezoso: lo normal es que
// se archive al abrir el tablero; esto cubre los que nadie abre. De sistema (no es un pedido de una cuenta): solo decide a quién
// le toca; el trabajo, las reglas y los avisos son de cada cuenta.
import type { Servicio } from './servicio'

/** Cada cuánto mira todo el sistema (cada tablero, además, tiene su propio tope de una hora). */
const CADA_MS = 60 * 60 * 1000
/** Cuántos tableros se atienden por barrido: lo que falte se hace en el siguiente. */
const POR_BARRIDO = 40
/** El plazo más corto que se puede elegir: nada más nuevo que esto puede estar listo para archivarse. */
const PLAZO_MINIMO_DIAS = 7

let ultimo = 0

export async function barrerHechasViejas(raiz: Servicio, op: { ahora?: Date; forzar?: boolean } = {}): Promise<{ tableros: number; archivadas: number }> {
  const ahora = op.ahora ?? new Date()
  if (!op.forzar && ahora.getTime() - ultimo < CADA_MS) return { tableros: 0, archivadas: 0 }
  ultimo = ahora.getTime()
  const candidatos = await raiz.db.consulta<{ propietario: string; id: string }>(
    `select p.propietario, x.id from tableros x join proyectos p on p.id = x.proyecto_id
      where not x.archivado and not p.archivado
        and (x.archivo_hecho_en is null or x.archivo_hecho_en <= $1::timestamptz - interval '1 hour')
        and exists (select 1 from tarjetas t join listas l on l.id = t.lista_id
                     where t.tablero_id = x.id and not t.archivada and l.categoria = 'hecho'
                       and coalesce(t.completada_en, t.actualizada_en) < $1::timestamptz - make_interval(days => $2::int))
      order by x.archivo_hecho_en nulls first limit $3::int`,
    [ahora.toISOString(), PLAZO_MINIMO_DIAS, POR_BARRIDO],
  )
  let tableros = 0
  let archivadas = 0
  for (const c of candidatos) {
    try {
      const r = await raiz.de(c.propietario).archivarHechasViejas({ tableroId: c.id, ahora })
      tableros += r.tableros
      archivadas += r.archivadas
    } catch (e) {
      console.error('[tablero] no pude archivar lo viejo de Hecho en un barrido:', e instanceof Error ? e.message : e)
    }
  }
  return { tableros, archivadas }
}
