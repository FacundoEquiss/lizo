// Segundo plano de la IA integrada (plan 11.2 y 11.3): dejar corriendo un trabajo después de contestar, saber hasta cuándo se
// puede, y pedirle a otra ejecución que siga cuando el tiempo no alcanza.
//
//   · Online (Vercel): `waitUntil` de `@vercel/functions` mantiene viva la función hasta `maxDuration` (300 s) después de
//     responder; `getDeadline()` dice hasta cuándo.
//   · En la computadora: nada raro. La promesa se larga y el proceso sigue vivo (no hay plazo ni encadenado).
//
// Nada de acá tira: un fallo del segundo plano nunca rompe el pedido que lo disparó.
import { getDeadline, waitUntil } from '@vercel/functions'
import { urlPublica } from '../diseno/urls'
import { firmarAlcance } from '../sesion'

/** Cuánto antes del final de la ejecución se deja de empezar cosas (el pedido en vuelo tiene que poder cerrar). */
const MARGEN_MS = 15_000
/** Si Vercel no dice el plazo, se cuenta desde que empezó la corrida (300 s de `maxDuration` menos el colchón). */
const PLAZO_SIN_DATO_MS = 240_000

/** ¿Este proceso es una función de Vercel? */
const enVercel = () => Boolean(process.env.VERCEL)

/** Deja corriendo una promesa después de responder. Online: waitUntil. En la computadora: se larga y listo. Nunca tira. */
export function enSegundoPlano(promesa: Promise<unknown>): void {
  const segura = promesa.catch((e) => console.error('[tablero] ia: falló el segundo plano:', e instanceof Error ? e.name : 'error'))
  if (!enVercel()) return
  try {
    waitUntil(segura)
  } catch {
    // Sin contexto de pedido (o sin la función): la promesa sigue su curso igual; las redes cubren si el proceso se congela.
  }
}

/**
 * Hasta cuándo puede correr esta ejecución (ms de reloj), con 15 s de margen. En la computadora: Infinity. `desde` es cuándo
 * empezó la corrida: si Vercel no informa el plazo se cuenta 240 s desde ahí.
 */
export function plazo(desde: number = Date.now()): number {
  if (!enVercel()) return Number.POSITIVE_INFINITY
  let limite: number | undefined
  try {
    limite = getDeadline()?.getTime()
  } catch {
    limite = undefined
  }
  return limite !== undefined && Number.isFinite(limite) ? limite - MARGEN_MS : desde + PLAZO_SIN_DATO_MS
}

/**
 * Le pide a una ejecución nueva que siga con los trabajos de esa cuenta (11.3): un POST a la ruta interna `correr`, con la clave
 * del MCP y la cuenta firmada (el mismo mecanismo que usa Diseño con render.func). Responde 202 al toque; acá se espera 3 s como
 * máximo. Si falla no pasa nada grave: el trabajo quedó en cola y lo levanta una de las redes. En la computadora no hace nada.
 */
export async function encadenar(cuenta: string): Promise<void> {
  if (!enVercel()) return
  const clave = process.env.TABLERO_CLAVE
  if (!clave) return
  try {
    await fetch(`${urlPublica()}/api/ia/interno/correr`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tablero-clave': clave, 'x-tablero-alcance': firmarAlcance(cuenta) },
      body: '{}',
      signal: AbortSignal.timeout(3_000),
    })
  } catch {
    // Las redes (el sondeo con ia=1 y el cron) lo levantan.
  }
}

// ───────────────────────── «esta cuenta tiene algo por correr» ─────────────────────────

/** Las cuentas que tienen algo por correr, anotadas durante el pedido en curso (las larga `despachar` después de contestar). */
const porCorrer = new Set<string>()

/** La anota quien crea un trabajo (o un reintento): «esta cuenta tiene algo por correr». */
export function marcarPorCorrer(cuenta: string): void {
  porCorrer.add(cuenta)
}

/** Devuelve (y olvida) las cuentas marcadas. */
export function tomarMarcadas(): string[] {
  const cuentas = [...porCorrer]
  porCorrer.clear()
  return cuentas
}
