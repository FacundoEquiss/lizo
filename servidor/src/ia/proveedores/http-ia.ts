// Lo que comparten los adaptadores de OpenAI (Responses) y de «compatible» (Chat Completions): hablar HTTP con `fetch` (o con un
// transporte que se le pasa), leer el streaming (SSE), clasificar los errores del proveedor y no filtrar nunca una clave ni el
// contenido de un pedido (plan 9.1 reglas 3 y 5, 9.9, 6.11, 12.6).
//
// Por qué `fetch` y no el SDK de `openai` (plan 9.9 lo daba por bueno, 153 KB gzip): los dos adaptadores necesitan (1) reenviar el
// mensaje del asistente byte por byte, con los campos que el SDK no conoce (`reasoning_content` de DeepSeek, firmas de Gemini,
// ítems de razonamiento cifrados), (2) no seguir redirecciones y poder controlar a qué dirección se conecta el socket (SSRF) y
// (3) cero peso nuevo en `api.func`. Lo que cuesta: este archivo (~300 líneas) y leer el SSE a mano.
import { ErrorProveedor, type TipoErrorProveedor } from '../tipos'

/** Lo único que los adaptadores le piden a la red: mandar un pedido y recibir la respuesta. En las pruebas se reemplaza. */
export type Transporte = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<Response>

/** `fetch` sin seguir redirecciones: un 3xx es un error (no se manda la clave a otro lado). */
export const transporteFetch: Transporte = (url, init) => fetch(url, { ...init, redirect: 'manual' })

export interface OpcionesHttp {
  transporte: Transporte
  /** Sin datos del servidor durante tanto tiempo, se corta con `ErrorProveedor` de tipo `tiempo`. */
  ociosoMs: number
  /** Un 429 o un 5xx con `retry-after` de hasta tanto se reintenta acá mismo (más largo lo decide el ciclo, 6.11). */
  esperaEnLineaMaxMs: number
  reintentosEnLinea: number
  dormir: (ms: number, senal: AbortSignal) => Promise<void>
}

export const dormirAbortable = (ms: number, senal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (senal.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done() { clearTimeout(t); senal.removeEventListener('abort', done); resolve() }
    senal.addEventListener('abort', done, { once: true })
  })

export const OPCIONES_DE_FABRICA: Omit<OpcionesHttp, 'transporte'> = {
  ociosoMs: 120_000,
  esperaEnLineaMaxMs: 3_000,
  reintentosEnLinea: 2,
  dormir: dormirAbortable,
}

// ───────────────────────── claves: nunca salen ─────────────────────────

/** Saca la clave (entera) y todo lo que parezca una clave de los proveedores de cualquier texto que vaya a un error o a un registro. */
export function filtrarClaves(texto: string, claves: readonly string[] = []): string {
  let t = texto
  for (const c of claves) if (c && c.length >= 6) t = t.split(c).join('[clave]')
  return t.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{16,}|gsk_[A-Za-z0-9]{16,}|xai-[A-Za-z0-9]{16,}|pplx-[A-Za-z0-9]{16,})/g, '[clave]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [clave]')
}

/** La clave va en un encabezado: si trae saltos de línea o letras raras, se corta antes de armar nada. */
export function validarClave(clave: string, nombre: string, permitirVacia = false): void {
  if (!clave) {
    if (permitirVacia) return
    throw new ErrorProveedor({ tipo: 'clave', reintentable: false, paraLaPersona: `Falta la clave de ${nombre}. Cargala en Configuración → IA.` })
  }
  if (/[^\x21-\x7e]/.test(clave) || clave.length > 512) {
    throw new ErrorProveedor({
      tipo: 'clave', reintentable: false,
      paraLaPersona: `La clave de ${nombre} tiene espacios o letras que no puede tener: pegala de nuevo, completa y sin nada de más.`,
    })
  }
}

// ───────────────────────── tiempos y esperas ─────────────────────────

/** `retry-after-ms`, `retry-after` (segundos o fecha) y, si falta, el `x-ratelimit-reset-*` de OpenAI («1s», «6m0s», «20ms»). */
export function esperaDe(h: Headers, ahora = Date.now()): number | undefined {
  const ms = h.get('retry-after-ms')
  if (ms && /^\d+(\.\d+)?$/.test(ms.trim())) return acotar(Math.ceil(parseFloat(ms)))
  const ra = h.get('retry-after')?.trim()
  if (ra) {
    if (/^\d+(\.\d+)?$/.test(ra)) return acotar(Math.ceil(parseFloat(ra) * 1000))
    const f = Date.parse(ra)
    if (Number.isFinite(f)) return acotar(f - ahora)
  }
  const partes = ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens'].map((n) => duracionAMs(h.get(n))).filter((n): n is number => n !== undefined)
  return partes.length ? acotar(Math.max(...partes)) : undefined
}
const acotar = (ms: number) => Math.min(Math.max(ms, 0), 10 * 60_000)

/** «1s», «6m0s», «20ms», «1.5s», «33s» → milisegundos. */
export function duracionAMs(t: string | null | undefined): number | undefined {
  if (!t) return undefined
  const m = [...t.trim().matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)]
  if (!m.length || m.map((x) => x[0]).join('') !== t.trim()) return undefined
  const f: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }
  return Math.ceil(m.reduce((a, x) => a + parseFloat(x[1]!) * f[x[2]!]!, 0))
}

// ───────────────────────── clasificar errores ─────────────────────────

interface InfoError { codigo: string | null; tipo: string | null; mensaje: string; estadoGrpc: string | null; retryMs?: number; porDia: boolean }

const ID_SEGURO = /^[A-Za-z0-9_.:\-]{1,64}$/
const seguro = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number') && ID_SEGURO.test(String(v)) ? String(v) : null

/** Lee el cuerpo de un error de OpenAI, DeepSeek, Gemini (que a veces manda una lista) o cualquier otro; lo que no entienda, vacío. */
export function leerError(texto: string): InfoError {
  let j: any = null
  try { j = JSON.parse(texto) } catch { /* no era JSON */ }
  if (Array.isArray(j)) j = j[0]
  const e = j && typeof j === 'object' ? (j.error && typeof j.error === 'object' ? j.error : j) : null
  const mensaje = typeof e?.message === 'string' ? e.message : typeof e?.detail === 'string' ? e.detail : typeof j?.error === 'string' ? j.error : ''
  let retryMs: number | undefined
  let porDia = false
  if (Array.isArray(e?.details)) {
    for (const d of e.details) {
      if (typeof d?.retryDelay === 'string') retryMs = duracionAMs(d.retryDelay) ?? retryMs
      for (const v of Array.isArray(d?.violations) ? d.violations : []) if (/perday/i.test(String(v?.quotaId ?? ''))) porDia = true
    }
  }
  if (/per day|perday|daily/i.test(mensaje + JSON.stringify(e?.details ?? '').slice(0, 2000))) porDia = true
  return { codigo: seguro(e?.code), tipo: seguro(e?.type), mensaje: mensaje.slice(0, 600), estadoGrpc: seguro(e?.status), retryMs, porDia }
}

const RE_CLAVE = /api[_ ]?key.{0,30}(invalid|not valid|incorrect)|invalid.{0,20}api[_ ]?key|incorrect api key|api_key_invalid|invalid_api_key|authentication[_ ]?(error|failed)|unauthorized/i
const RE_SALDO = /insufficient[_ ]?(quota|balance|funds)|billing[_ ]?(hard[_ ]?limit|not active|account)|exceeded your current quota|credit balance|out of credits|payment required|spend(ing)? limit|enable billing|billing (is )?(required|not enabled)/i
const RE_HERRAMIENTAS = /(does not|doesn't|do not|don't|not)\s+(support|supported|allow).{0,40}(tool|function)|(tool|function)s?[ _-]?(calling|call|use)?\s+(is |are )?(not\s+supported|unsupported)|tools?\s+(is|are)\s+not\s+supported|no endpoints found that support tool|does not support tools/i
const RE_LARGO = /context[_ ]length|maximum context|too many tokens|prompt is too long|input.{0,20}too (long|large)|reduce the length|token limit/i
const RE_MODELO = /model[_ ]?(not[_ ]?found|does not exist)|does not exist or you do not have access|unknown model|invalid model|not found.*model|model.*not found/i

export interface ContextoError { proveedor: string; modelo?: string; claves?: readonly string[] }

/** Un pedido que el proveedor rechazó → `ErrorProveedor` ya clasificado (6.11). `mensaje` solo lleva estado y códigos del proveedor. */
export function clasificarHttp(estado: number, cuerpo: string, h: Headers, c: ContextoError): ErrorProveedor {
  const i = leerError(cuerpo)
  const idPedido = seguro(h.get('x-request-id') ?? h.get('request-id') ?? h.get('x-goog-request-id') ?? undefined) ?? undefined
  const texto = `${i.mensaje} ${i.codigo ?? ''} ${i.tipo ?? ''} ${i.estadoGrpc ?? ''}`
  const detalle = [`HTTP ${estado}`, i.codigo, i.tipo, i.estadoGrpc].filter(Boolean).join(' ')
  const mk = (tipo: TipoErrorProveedor, reintentable: boolean, paraLaPersona: string, esperarMs?: number): ErrorProveedor =>
    new ErrorProveedor({ tipo, reintentable, paraLaPersona, mensaje: `${c.proveedor}: ${detalle}`, esperarMs, idPedido })

  if (estado >= 300 && estado < 400)
    return mk('pedido', false, `${c.proveedor} mandó el pedido a otra dirección. Telar no la sigue por seguridad: revisá la dirección base.`)
  if (RE_CLAVE.test(texto) || estado === 401)
    return mk('clave', false, `La clave de ${c.proveedor} no anda. Cambiala en Configuración → IA.`)
  // en un 429 el texto «exceeded your current quota» lo usan también los límites por minuto (Gemini): ahí solo vale el código
  const saldoPorCodigo = /insufficient_quota|billing_hard_limit|insufficient_balance|insufficient_funds/i.test(`${i.codigo ?? ''} ${i.tipo ?? ''}`)
  if (estado === 402 || saldoPorCodigo || (estado !== 429 && RE_SALDO.test(texto)))
    return mk('saldo', false, `${c.proveedor} frenó el pedido: no hay saldo o se llegó al límite de gasto de tu cuenta del proveedor.`)
  if (estado === 403)
    return mk('clave', false, `${c.proveedor} no deja usar esa clave para este pedido (permisos, región o el modelo no está habilitado). Revisá la clave en su consola.`)
  if (estado === 429) {
    if (i.porDia) return mk('saldo', false, `${c.proveedor}: se acabó la cuota de hoy. Vuelve mañana o pasá a un plan con facturación.`)
    return mk('limite', true, `${c.proveedor} pide esperar un poco (límite de pedidos).`, esperaDe(h) ?? i.retryMs)
  }
  if (estado === 408 || estado === 504 || estado === 524) return mk('tiempo', true, `${c.proveedor} tardó demasiado en contestar.`, esperaDe(h))
  if (estado >= 500) return mk('sobrecarga', true, `${c.proveedor} no responde bien en este momento. Probá de nuevo en un rato.`, esperaDe(h))
  if (RE_HERRAMIENTAS.test(texto))
    return mk('pedido', false, `Este modelo no admite herramientas: Telar las necesita para actuar en el tablero. Elegí otro modelo.`)
  if (RE_LARGO.test(texto) || estado === 413)
    return mk('pedido', false, `La conversación es demasiado larga para este modelo: pedilo por partes.`)
  if (estado === 404 || RE_MODELO.test(texto))
    return mk('pedido', false, c.modelo
      ? `${c.proveedor} no encuentra el modelo «${c.modelo}», o tu clave no tiene acceso. Revisá el nombre.`
      : `${c.proveedor} no encontró lo que se pidió: revisá la dirección base y el nombre del modelo.`)
  return mk('pedido', false, `Algo salió mal al hablar con ${c.proveedor} (código ${estado}${i.codigo ? ' ' + i.codigo : ''}).`)
}

/** Un error que llega adentro del streaming (OpenAI y DeepSeek lo mandan como evento con 200 ya enviado). */
export function errorDeEvento(e: unknown, c: ContextoError): ErrorProveedor {
  const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
  const cuerpo = JSON.stringify({ error: o.error && typeof o.error === 'object' ? o.error : o })
  const i = leerError(cuerpo)
  const clave = `${i.codigo ?? ''} ${i.tipo ?? ''}`.toLowerCase()
  let estado = 500
  if (/rate_limit|too_many/.test(clave)) estado = 429
  else if (/insufficient_quota|billing/.test(clave)) estado = 402
  else if (/invalid_api_key|authentication/.test(clave)) estado = 401
  else if (/invalid_request|context_length|bad_request/.test(clave)) estado = 400
  else if (/overloaded|server_error|unavailable|insufficient_system_resource/.test(clave)) estado = 503
  return clasificarHttp(estado, cuerpo, new Headers(), c)
}

// ───────────────────────── pedir y reintentar ─────────────────────────

const abortado = (c: ContextoError) =>
  new ErrorProveedor({ tipo: 'tiempo', reintentable: true, paraLaPersona: `El pedido a ${c.proveedor} no terminó a tiempo.`, mensaje: `${c.proveedor}: abortado` })

export const errorDeRed = (c: ContextoError) =>
  new ErrorProveedor({ tipo: 'red', reintentable: true, paraLaPersona: `No se pudo hablar con ${c.proveedor}: revisá la conexión y la dirección.`, mensaje: `${c.proveedor}: error de red` })

/**
 * El texto que mandó el proveedor al rechazar un pedido, por si el adaptador necesita mirarlo para decidir algo (por ejemplo, que no
 * conoce un parámetro). Vive aparte del error, que es lo que se registra y se muestra: nunca sale de acá.
 */
const crudos = new WeakMap<ErrorProveedor, string>()
export const textoDelProveedor = (e: ErrorProveedor): string => crudos.get(e) ?? ''

/** Manda el pedido. Devuelve la respuesta 2xx (con el cuerpo sin leer) o tira `ErrorProveedor`. */
export async function pedir(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  senal: AbortSignal,
  o: OpcionesHttp,
  c: ContextoError,
): Promise<Response> {
  for (let intento = 0; ; intento++) {
    if (senal.aborted) throw abortado(c)
    let res: Response
    try {
      res = await o.transporte(url, { ...init, signal: senal })
    } catch (e) {
      if (e instanceof ErrorProveedor) throw e
      throw senal.aborted ? abortado(c) : errorDeRed(c)
    }
    if (res.status >= 200 && res.status < 300) return res
    let texto = ''
    try { texto = (await res.text()).slice(0, 8_000) } catch { /* sin cuerpo */ }
    const err = clasificarHttp(res.status, texto, res.headers, c)
    crudos.set(err, texto)
    if (err.reintentable && err.esperarMs !== undefined && err.esperarMs <= o.esperaEnLineaMaxMs && intento < o.reintentosEnLinea) {
      await o.dormir(err.esperarMs, senal)
      continue
    }
    throw err
  }
}

// ───────────────────────── SSE ─────────────────────────

export interface EventoSse { evento: string | null; datos: string }

/**
 * Lee un streaming `text/event-stream`: ignora comentarios (`: keep-alive`) y líneas vacías, junta las líneas `data:` de un
 * mismo evento y termina con `[DONE]` o al cerrarse la conexión. Sin datos por `ociosoMs` → `tiempo`.
 */
export async function* leerSse(res: Response, o: OpcionesHttp, senal: AbortSignal, c: ContextoError): AsyncGenerator<EventoSse> {
  if (!res.body) throw errorDeRed(c)
  const lector = res.body.getReader()
  const dec = new TextDecoder()
  let resto = ''
  let evento: string | null = null
  let datos: string[] = []
  const cerrar = () => { lector.cancel().catch(() => {}) }
  senal.addEventListener('abort', cerrar, { once: true })
  try {
    for (;;) {
      let leido: ReadableStreamReadResult<Uint8Array>
      let reloj: ReturnType<typeof setTimeout> | undefined
      try {
        leido = await Promise.race([
          lector.read(),
          new Promise<never>((_, rechazar) => { reloj = setTimeout(() => rechazar(new ErrorProveedor({ tipo: 'tiempo', reintentable: true, paraLaPersona: `${c.proveedor} dejó de mandar datos: se cortó el pedido.`, mensaje: `${c.proveedor}: sin datos` })), o.ociosoMs) }),
        ])
      } catch (e) {
        cerrar()
        if (e instanceof ErrorProveedor) throw e
        throw senal.aborted ? abortado(c) : errorDeRed(c)
      } finally {
        clearTimeout(reloj)
      }
      if (senal.aborted) throw abortado(c)
      resto += dec.decode(leido.value ?? new Uint8Array(), { stream: !leido.done })
      // un \r al final puede ser la mitad de un \r\n que sigue en el próximo pedazo
      let retenido = ''
      if (!leido.done && resto.endsWith('\r')) { retenido = '\r'; resto = resto.slice(0, -1) }
      const lineas = resto.split(/\r\n|\n|\r/)
      resto = leido.done ? '' : (lineas.pop() ?? '') + retenido
      for (const l of lineas) {
        if (l === '') {
          if (datos.length) yield { evento, datos: datos.join('\n') }
          evento = null
          datos = []
        } else if (l.startsWith(':')) {
          // comentario / keep-alive
        } else {
          const i = l.indexOf(':')
          const campo = i < 0 ? l : l.slice(0, i)
          const valor = i < 0 ? '' : l.slice(i + 1).replace(/^ /, '')
          if (campo === 'data') datos.push(valor)
          else if (campo === 'event') evento = valor
        }
      }
      if (leido.done) {
        if (datos.length) yield { evento, datos: datos.join('\n') }
        return
      }
    }
  } finally {
    senal.removeEventListener('abort', cerrar)
    cerrar()
  }
}

// ───────────────────────── esquemas y nativos ─────────────────────────

/**
 * El JSON Schema de zod listo para mandar: sin `$schema` ni `$id` (varios servicios los rechazan) y, si `sinAdicionales`, sin
 * `additionalProperties` (Gemini y algunos locales 400). La validación de fondo la hace zod en el ejecutor (9.1 regla 6).
 */
export function limpiarEsquema(esquema: unknown, o: { sinAdicionales?: boolean } = {}): Record<string, unknown> {
  const rec = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rec)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) {
        if (k === '$schema' || k === '$id') continue
        if (o.sinAdicionales && k === 'additionalProperties' && typeof x === 'boolean') continue
        out[k] = rec(x)
      }
      return out
    }
    return v
  }
  const r = rec(esquema) as Record<string, unknown>
  return r && typeof r === 'object' && !Array.isArray(r) && r.type ? r : { type: 'object', properties: {} }
}

/**
 * Los argumentos de una llamada, del texto que mandó el modelo. Vacío = `{}`; roto, cortado o que no sea un objeto = `invalida`
 * (la llamada no se ejecuta y vuelve al modelo como error, 9.1 regla 6).
 */
export function leerArgumentos(texto: unknown): { argumentos: unknown; invalida?: string } {
  const t = typeof texto === 'string' ? texto.trim() : ''
  if (t === '') return { argumentos: {} }
  try {
    const v = JSON.parse(t)
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return { argumentos: {}, invalida: 'Los argumentos de la herramienta tienen que ser un objeto JSON.' }
    return { argumentos: v }
  } catch {
    return { argumentos: {}, invalida: 'Los argumentos de la herramienta llegaron cortados o rotos (JSON inválido). Volvé a llamarla con los argumentos completos.' }
  }
}

/** Las imágenes de un nativo quedan como referencia hasta que se llama al modelo (los bytes no se guardan en la base). */
export const PREFIJO_IMAGEN = 'telar-imagen:'
export const referenciaImagen = (mime: string, ruta: string) => `${PREFIJO_IMAGEN}${mime};${ruta}`

/** Cambia las referencias de imagen de un valor ya parseado por `data:` URIs con los bytes. */
export async function ponerImagenes(valor: unknown, leer: (ruta: string) => Promise<Uint8Array>): Promise<unknown> {
  if (typeof valor === 'string') {
    if (!valor.startsWith(PREFIJO_IMAGEN)) return valor
    const r = valor.slice(PREFIJO_IMAGEN.length)
    const i = r.indexOf(';')
    const mime = r.slice(0, i)
    const ruta = r.slice(i + 1)
    const bytes = await leer(ruta)
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
  }
  if (Array.isArray(valor)) return Promise.all(valor.map((v) => ponerImagenes(v, leer)))
  if (valor && typeof valor === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor)) out[k] = await ponerImagenes(v, leer)
    return out
  }
  return valor
}

/**
 * Un elemento del historial listo para meter, tal cual, en la lista del pedido: si es una lista `[a,b]` van sus elementos sin los
 * corchetes; si es un objeto, entero. No se parsea ni se vuelve a escribir (reenvío exacto, 9.1 regla 1), salvo que traiga
 * referencias de imagen (usuario y resultados, nunca el asistente).
 */
export async function elementosDelHistorial(nativo: string, leer: (ruta: string) => Promise<Uint8Array>): Promise<string[]> {
  const t = nativo.trim()
  const roto = () => new ErrorProveedor({ tipo: 'pedido', reintentable: false, paraLaPersona: 'La conversación guardada está dañada: no se puede seguir este trabajo.', mensaje: 'historial: nativo con forma inesperada' })
  if (t.includes(PREFIJO_IMAGEN)) {
    let v: unknown
    try { v = JSON.parse(t) } catch { throw roto() }
    const arr = Array.isArray(v) ? v : [v]
    const hechos = await Promise.all(arr.map((x) => ponerImagenes(x, leer)))
    return hechos.map((x) => JSON.stringify(x))
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    const dentro = t.slice(1, -1).trim()
    return dentro ? [dentro] : []
  }
  if (t.startsWith('{') && t.endsWith('}')) return [t]
  throw roto()
}

/** Corta un texto a `n` caracteres (para mensajes de error). */
export const corto = (t: string, n = 200) => (t.length > n ? t.slice(0, n) + '…' : t)
