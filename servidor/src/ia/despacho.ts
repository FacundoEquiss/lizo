// El despacho de los trabajos (plan 11.2 a 11.4): cómo arranca un trabajo y qué lo levanta si queda trabado.
//
//   · ARRANQUE: quien crea un trabajo anota «esta cuenta tiene algo por correr» (`marcarPorCorrer`); el middleware de api.ts, después de
//     responder cada pedido, larga en segundo plano lo anotado (`despacharIA`). Ninguna ruta tiene que acordarse de arrancar nada, y
//     un trabajo normal (una respuesta en una tarjeta) empieza y termina dentro del mismo pedido que lo creó.
//   · REDES, para lo que quedó trabado (un proceso que murió, una espera larga, un encadenado que falló): el sondeo que ya existe con
//     `ia=1` (api.ts), el cron de Vercel (`/api/ia/interno/barrer`) y, en la computadora, un temporizador del proceso.
import type { Servicio } from '../dominio/servicio'
import { barrer, correr, ejecutorListo } from './ejecutor'
import { enSegundoPlano, tomarMarcadas } from './segundo-plano'

/** La llama el middleware después de cada pedido: larga en segundo plano lo que quedó marcado. Nunca tira y no espera. */
export function despacharIA(raiz: Servicio | null): void {
  if (!raiz) return
  for (const cuenta of tomarMarcadas()) if (ejecutorListo()) enSegundoPlano(correr(raiz, cuenta))
}

let temporizador: NodeJS.Timeout | null = null

/**
 * En la computadora no hay cron ni función que se congele: un temporizador del proceso (cada 5 s, donde no cuesta nada) levanta lo vencido y, una
 * vez por minuto, hace lo del cron (mantenimiento y resumen diario). No hace nada en Vercel. Con `unref`, no impide que el proceso termine.
 */
export function iniciarRedLocal(raiz: Servicio, cada = 5_000): void {
  if (process.env.VERCEL || temporizador) return
  let vueltas = 0
  let ocupado = false
  temporizador = setInterval(() => {
    if (ocupado) return
    ocupado = true
    vueltas++
    const tarea = vueltas % Math.max(1, Math.round(60_000 / cada)) === 0 ? barrer(raiz) : barridoDeVencidos(raiz)
    void tarea.catch(() => {}).finally(() => (ocupado = false))
  }, cada)
  temporizador.unref()
}

export function detenerRedLocal(): void {
  if (temporizador) clearInterval(temporizador)
  temporizador = null
}

/** Lo barato: ¿hay algo vencido? Si hay, se corre. */
async function barridoDeVencidos(raiz: Servicio): Promise<void> {
  if (!ejecutorListo()) return
  const filas = await raiz.db.consulta<{ propietario: string }>(
    `select distinct propietario from ia_trabajos where estado in ('en_cola', 'en_curso') and proximo_en <= now() and (tomado_hasta is null or tomado_hasta < now()) limit 20`,
  )
  for (const f of filas) await correr(raiz, f.propietario)
}
