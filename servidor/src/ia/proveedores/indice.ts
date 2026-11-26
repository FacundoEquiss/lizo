// El registro de proveedores (docs/plan-ia-integrada.md, 9.1 y 9.10): `proveedorDe(id)` devuelve el adaptador de un
// proveedor o tira ErrorDominio si no existe o no está habilitado. El resto de la IA (el ciclo, las pantallas) solo conoce
// `Proveedor`, nunca un adaptador en particular.
//
// El proveedor FALSO es de pruebas: está disponible solo con `TABLERO_IA_FALSO=1` y fuera de Vercel. Dentro de Vercel
// (producción) NUNCA, ni con una variable de más. Un guion que gastara de mentira o contestara cualquier cosa en la cuenta del
// dueño sería un daño silencioso.
//
// Cómo se suma un proveedor (9.10): un archivo en proveedores/ que cumpla `Proveedor`, su fila acá (en FABRICAS) y sus
// filas en precios.ts. `openai` (la API Responses) y `compatible` (Chat Completions: Gemini, DeepSeek, «Otro», Ollama) son de ahí.
// Los tres de verdad están siempre; el falso, solo con TABLERO_IA_FALSO=1.
import type { IdProveedor } from '../../../../compartido/ia'
import { ErrorDominio } from '../../dominio/servicio'
import type { Proveedor } from '../tipos'
import { crearProveedorAnthropic } from './anthropic'
import { proveedorCompatible } from './compatible'
import { crearProveedorFalso, type ProveedorFalso } from './falso'
import { proveedorOpenAI } from './openai'

export type Entorno = Record<string, string | undefined>

export interface OpcionesRegistro {
  /** Las variables de entorno (de fábrica, las del proceso): para probar la regla sin tocarlas. */
  env?: Entorno
}

/** ¿Está el proveedor falso habilitado en este proceso? */
export function falsoDisponible(env: Entorno = process.env): boolean {
  if (env.TABLERO_IA_FALSO !== '1') return false
  return !env.VERCEL && !env.VERCEL_ENV
}

// Uno por proceso: el falso lleva la cuenta de los errores «solo las primeras veces» y el de Anthropic carga su SDK una vez.
const anthropic = crearProveedorAnthropic()
const falsos = new Map<string, ProveedorFalso>()

function falso(env: Entorno): Proveedor {
  const retraso = Number(env.TABLERO_IA_FALSO_RETRASO_MS)
  const retrasoMs = Number.isFinite(retraso) && retraso > 0 ? retraso : undefined
  const llave = String(retrasoMs ?? '')
  let p = falsos.get(llave)
  if (!p) falsos.set(llave, (p = crearProveedorFalso({ retrasoMs })))
  return p
}

/** Cada proveedor con su condición. Lo que no está acá todavía no existe. */
const FABRICAS: Partial<Record<IdProveedor, { disponible: (env: Entorno) => boolean; crear: (env: Entorno) => Proveedor }>> = {
  anthropic: { disponible: () => true, crear: () => anthropic },
  openai: { disponible: () => true, crear: () => proveedorOpenAI },
  compatible: { disponible: () => true, crear: () => proveedorCompatible },
  falso: { disponible: falsoDisponible, crear: falso },
}

export function proveedorDe(id: IdProveedor, opciones: OpcionesRegistro = {}): Proveedor {
  const env = opciones.env ?? process.env
  const f = FABRICAS[id]
  if (!f) throw new ErrorDominio(`El proveedor «${id}» todavía no está disponible en Telar.`, 400)
  if (!f.disponible(env)) {
    throw new ErrorDominio('El proveedor falso es solo para pruebas: no está habilitado acá (TABLERO_IA_FALSO=1, y nunca en Vercel).', 400)
  }
  return f.crear(env)
}

/** Los proveedores que se pueden usar ahora (para las pantallas y las pruebas). */
export function proveedoresDisponibles(opciones: OpcionesRegistro = {}): IdProveedor[] {
  const env = opciones.env ?? process.env
  return (Object.keys(FABRICAS) as IdProveedor[]).filter((id) => FABRICAS[id]!.disponible(env))
}
