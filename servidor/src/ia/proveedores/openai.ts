// El adaptador de OpenAI (GPT) por la API **Responses** (plan 9.2, tarea 6.1). Verificado contra la documentación oficial el
// 25/11/2026 (Anexo D): developers.openai.com/api/docs/guides/function-calling, /guides/migrate-to-responses, /guides/prompt-caching
// y /models/gpt-6.2-sol. Por qué Responses y no Chat Completions: en los GPT-6 las herramientas piden Responses («Tool calling
// requires the Responses API»; en Luna, Chat Completions solo con `reasoning.effort: none`).
//
// Cómo se arma el pedido (9.1):
//   · `fijo` = `{"input":[{role:"developer",content}],"tools":[…]}` (las instrucciones van como mensaje `developer`, no como
//     `instructions`: en GPT-6.2 las de arriba no entran al caché).
//   · cada elemento del historial es una LISTA de ítems de Responses (`[…]`): `aNativo` la arma para el usuario, los resultados y
//     las notas; para el asistente es lo que vino en `response.output`, sin tocar (con los ítems de razonamiento cifrados).
//   · el cuerpo se arma pegando texto: `fijo.input` + los elementos del historial, sin volver a escribir lo guardado (byte por byte).
//   · `store: false` (la memoria es la base de Telar) y `include: ['reasoning.encrypted_content']` para poder reenviar el
//     razonamiento sin que el proveedor guarde nada.
//   · se pide con streaming y se junta: de los eventos solo hace falta `response.output_item.done` y el cierre
//     (`response.completed` / `incomplete` / `failed`), que trae el `output` entero y el `usage`.
//
// Uso: `entrada` = tokens de entrada que NO salieron del caché (input_tokens − cached_tokens − cache_write_tokens), como en
// Anthropic; `cacheEscritura` = `input_tokens_details.cache_write_tokens` (GPT-6 y 5.6: escribir cuesta 1,25× a 30 min, que es lo
// de fábrica); `salida` incluye los tokens de razonamiento (se cobran como salida).
//
// Esta dirección es fija (api.openai.com): `urlBase` del pedido se ignora a propósito, para que la clave de OpenAI nunca viaje a
// otro lado. Para otro servicio con formato de OpenAI está `compatible.ts`.
import {
  type BloqueSistema,
  type CapacidadesModelo,
  type DefHerramienta,
  ErrorProveedor,
  type LlamadaHerramienta,
  type MensajeNeutro,
  type PedidoModelo,
  type Proveedor,
  type RespuestaModelo,
  type Corte,
  type Uso,
} from '../tipos'
import {
  clasificarHttp,
  type ContextoError,
  corto,
  elementosDelHistorial,
  errorDeEvento,
  errorDeRed,
  leerArgumentos,
  leerSse,
  limpiarEsquema,
  OPCIONES_DE_FABRICA,
  type OpcionesHttp,
  pedir,
  referenciaImagen,
  transporteFetch,
  validarClave,
} from './http-ia'

export const URL_OPENAI = 'https://api.openai.com/v1'
const NOMBRE = 'OpenAI'
const CTX: ContextoError = { proveedor: NOMBRE }

// ───────────────────────── capacidades ─────────────────────────

/** De las páginas de los modelos (25/11/2026): GPT-6.x, 1.050.000 de contexto, 128.000 de salida, texto e imágenes. */
const GPT6: CapacidadesModelo = { imagenes: true, imagenesEnResultados: true, contexto: 1_050_000, salidaMax: 128_000 }
/** Lo que no conocemos: lo prudente. El dueño no puede declarar nada acá (solo en «compatible»). */
const DESCONOCIDO: CapacidadesModelo = { imagenes: true, imagenesEnResultados: true, contexto: 128_000, salidaMax: 16_000 }

export function capacidadesOpenAI(modelo: string): CapacidadesModelo {
  if (/^gpt-6(\.\d+)?-/.test(modelo) || /^gpt-5\.[6-9]/.test(modelo)) return GPT6
  return DESCONOCIDO
}

/** Los modelos que no razonan rechazan `reasoning`: no se manda. */
const sinRazonamiento = (m: string) => /^(gpt-4|gpt-3|chatgpt-4)/.test(m)

const ESFUERZO = { bajo: 'low', medio: 'medium', alto: 'high' } as const

// ───────────────────────── nativo ─────────────────────────

type Parte = { tipo: 'texto'; texto: string } | { tipo: 'imagen'; mime: string; ruta: string }

const aParteEntrada = (p: Parte) =>
  p.tipo === 'texto' ? { type: 'input_text', text: p.texto } : { type: 'input_image', image_url: referenciaImagen(p.mime, p.ruta) }

export function nativoOpenAI(m: MensajeNeutro): string {
  switch (m.rol) {
    case 'usuario':
      return JSON.stringify([{ type: 'message', role: 'user', content: m.partes.map(aParteEntrada) }])
    case 'sistema':
      return JSON.stringify([{ type: 'message', role: 'developer', content: m.texto }])
    case 'asistente': {
      const items: unknown[] = []
      if (m.texto) items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: m.texto }] })
      for (const l of m.llamadas) items.push({ type: 'function_call', call_id: l.id, name: l.nombre, arguments: JSON.stringify(l.argumentos ?? {}) })
      return JSON.stringify(items)
    }
    case 'herramienta':
      return JSON.stringify(
        m.resultados.map((r) => {
          const hayImagen = r.partes.some((p) => p.tipo === 'imagen')
          const texto = r.partes.filter((p) => p.tipo === 'texto').map((p) => (p as { texto: string }).texto).join('\n')
          return {
            type: 'function_call_output',
            call_id: r.id,
            // texto solo, si no hay imágenes; con imágenes, la lista de partes (function-calling: «output» puede ser una lista)
            output: hayImagen ? r.partes.map(aParteEntrada) : texto || '(sin contenido)',
          }
        }),
      )
  }
}

// ───────────────────────── fijo ─────────────────────────

interface Fijo { input: unknown[]; tools: unknown[] }

export function fijoOpenAI(e: { sistema: BloqueSistema[]; herramientas: DefHerramienta[] }): string {
  const dev = e.sistema.map((b) => b.texto).filter(Boolean).join('\n\n')
  const fijo: Fijo = {
    input: dev ? [{ role: 'developer', content: dev }] : [],
    tools: e.herramientas.map((h) => ({ type: 'function', name: h.nombre, description: h.descripcion, parameters: limpiarEsquema(h.esquema), strict: false })),
  }
  return JSON.stringify(fijo)
}

function leerFijo(texto: string): Fijo {
  try {
    const f = JSON.parse(texto)
    if (f && Array.isArray(f.input) && Array.isArray(f.tools)) return f
  } catch { /* cae al error */ }
  throw new ErrorProveedor({ tipo: 'pedido', reintentable: false, paraLaPersona: 'Lo fijo del trabajo está dañado: no se puede seguir este trabajo.', mensaje: 'fijo con forma inesperada' })
}

// ───────────────────────── armar el pedido ─────────────────────────

export async function cuerpoOpenAI(p: PedidoModelo): Promise<string> {
  const fijo = leerFijo(p.fijo)
  const partes: string[] = fijo.input.map((i) => JSON.stringify(i))
  for (const h of p.historial) partes.push(...(await elementosDelHistorial(h, p.leerImagen)))
  const cap = capacidadesOpenAI(p.modelo)
  const maxSalida = Math.max(16, Math.min(Math.floor(p.maxSalida), cap.salidaMax))
  const campos = [
    `"model":${JSON.stringify(p.modelo)}`,
    `"store":false`,
    `"stream":true`,
    `"max_output_tokens":${maxSalida}`,
    `"include":["reasoning.encrypted_content"]`,
  ]
  if (p.esfuerzo && !sinRazonamiento(p.modelo)) campos.push(`"reasoning":{"effort":"${ESFUERZO[p.esfuerzo]}"}`)
  if (fijo.tools.length) campos.push(`"tools":${JSON.stringify(fijo.tools)}`, `"tool_choice":"auto"`, `"parallel_tool_calls":true`)
  campos.push(`"input":[${partes.join(',')}]`)
  return `{${campos.join(',')}}`
}

// ───────────────────────── leer la respuesta ─────────────────────────

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

export function usoOpenAI(u: any): Uso {
  const d = u?.input_tokens_details ?? {}
  const cacheLectura = num(d.cached_tokens)
  const cacheEscritura = num(d.cache_write_tokens)
  return { entrada: Math.max(0, num(u?.input_tokens) - cacheLectura - cacheEscritura), salida: num(u?.output_tokens), cacheLectura, cacheEscritura }
}

/** Una respuesta de Responses (`response.output` + `usage`) → `RespuestaModelo`. */
export function respuestaOpenAI(r: any, items: unknown[]): RespuestaModelo {
  const textos: string[] = []
  let rechazo = ''
  const llamadas: LlamadaHerramienta[] = []
  for (const it of items as any[]) {
    if (it?.type === 'message') {
      for (const c of Array.isArray(it.content) ? it.content : []) {
        if (c?.type === 'output_text' && typeof c.text === 'string') textos.push(c.text)
        else if (c?.type === 'refusal' && typeof c.refusal === 'string') rechazo += c.refusal
      }
    } else if (it?.type === 'function_call' && typeof it.name === 'string') {
      const a = leerArgumentos(it.arguments)
      llamadas.push({ id: String(it.call_id ?? it.id ?? ''), nombre: it.name, argumentos: a.argumentos, ...(a.invalida ? { invalida: a.invalida } : {}) })
    }
  }
  const largo = r?.status === 'incomplete' && r?.incomplete_details?.reason === 'max_output_tokens'
  const filtro = r?.status === 'incomplete' && r?.incomplete_details?.reason === 'content_filter'
  let corte: Corte
  if (rechazo || filtro) corte = 'rechazo'
  else if (largo) corte = 'largo'
  else if (llamadas.length) corte = 'herramientas'
  else corte = 'fin'
  const texto = textos.join('\n\n') || rechazo
  return { corte, texto, llamadas, uso: usoOpenAI(r?.usage), nativo: JSON.stringify(items), idPedido: typeof r?.id === 'string' ? r.id : undefined }
}

async function juntar(res: Response, o: OpcionesHttp, senal: AbortSignal): Promise<RespuestaModelo> {
  // un servicio que contesta JSON entero (sin streaming) también sirve
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    let j: any
    try { j = await res.json() } catch { throw errorDeRed(CTX) }
    if (j?.error) throw errorDeEvento(j, CTX)
    return respuestaOpenAI(j, Array.isArray(j?.output) ? j.output : [])
  }
  const hechos: { n: number; item: unknown }[] = []
  let cierre: any = null
  for await (const ev of leerSse(res, o, senal, CTX)) {
    if (ev.datos === '[DONE]') break
    let j: any
    try { j = JSON.parse(ev.datos) } catch { continue }
    switch (j?.type) {
      case 'response.output_item.done':
        if (j.item) hechos.push({ n: typeof j.output_index === 'number' ? j.output_index : hechos.length, item: j.item })
        break
      case 'response.completed':
      case 'response.incomplete':
        cierre = j.response ?? {}
        break
      case 'response.failed':
        throw errorDeEvento({ error: j.response?.error ?? {} }, CTX)
      case 'error':
        throw errorDeEvento({ error: { code: j.code, type: j.type, message: j.message } }, CTX)
    }
    if (cierre) break
  }
  if (!cierre) throw new ErrorProveedor({ tipo: 'red', reintentable: true, paraLaPersona: `${NOMBRE} cortó la respuesta antes de terminar.`, mensaje: `${NOMBRE}: el streaming terminó sin cierre` })
  const porIndice = hechos.sort((a, b) => a.n - b.n).map((h) => h.item)
  // el cierre trae el `output` entero; si por algo viene vacío, valen los ítems que fueron llegando
  const items = Array.isArray(cierre.output) && cierre.output.length ? cierre.output : porIndice
  return respuestaOpenAI(cierre, items)
}

// ───────────────────────── el adaptador ─────────────────────────

export interface OpcionesOpenAI extends Partial<OpcionesHttp> {
  /** Solo para las pruebas (un servidor local de mentira). En producción es siempre api.openai.com. */
  urlBase?: string
}

export function crearProveedorOpenAI(opciones: OpcionesOpenAI = {}): Proveedor {
  const o: OpcionesHttp = { transporte: transporteFetch, ...OPCIONES_DE_FABRICA, ...opciones }
  const base = (opciones.urlBase ?? URL_OPENAI).replace(/\/+$/, '')
  const cabeceras = (clave: string) => ({ 'content-type': 'application/json', accept: 'text/event-stream, application/json', authorization: `Bearer ${clave}` })

  return {
    id: 'openai',
    prepararFijo: (e) => fijoOpenAI(e),
    aNativo: (m) => nativoOpenAI(m),
    capacidades: capacidadesOpenAI,

    async llamar(p) {
      validarClave(p.clave, NOMBRE)
      const cuerpo = await cuerpoOpenAI(p)
      const ctx: ContextoError = { ...CTX, modelo: p.modelo, claves: [p.clave] }
      const res = await pedir(`${base}/responses`, { method: 'POST', headers: cabeceras(p.clave), body: cuerpo }, p.senal, o, ctx)
      try {
        const r = await juntar(res, o, p.senal)
        return { ...r, idPedido: r.idPedido ?? res.headers.get('x-request-id') ?? undefined }
      } catch (e) {
        // nunca sale la clave, ni en el texto que arma el sistema ni en el que vino del proveedor
        if (e instanceof ErrorProveedor) throw e
        throw errorDeRed(ctx)
      }
    },

    async probar(e) {
      try {
        validarClave(e.clave, NOMBRE)
        const senal = AbortSignal.timeout(15_000)
        const res = await pedir(`${base}/models`, { method: 'GET', headers: { authorization: `Bearer ${e.clave}` } }, senal, o, { ...CTX, claves: [e.clave] })
        const j: any = await res.json().catch(() => ({}))
        const todos: string[] = (Array.isArray(j?.data) ? j.data : []).map((m: any) => String(m?.id ?? '')).filter(Boolean)
        const modelos = todos.filter((m) => !/embedding|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|search|computer-use|davinci|babbage/i.test(m)).sort().slice(0, 200)
        if (e.modelo && todos.length && !todos.includes(e.modelo))
          return { ok: false, error: `La clave anda, pero no tiene acceso al modelo «${corto(e.modelo, 80)}».`, modelos }
        return { ok: true, modelos }
      } catch (err) {
        return { ok: false, error: err instanceof ErrorProveedor ? err.paraLaPersona : `No se pudo probar la clave de ${NOMBRE}.` }
      }
    },
  }
}

export const proveedorOpenAI = crearProveedorOpenAI()
