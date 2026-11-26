// El adaptador de Anthropic (docs/plan-ia-integrada.md, 9.1 a 9.5): la API Messages con el SDK oficial, el ciclo de herramientas
// armado a mano (no el «tool runner»), caché de prompts, errores tipados y la clave siempre fuera de cualquier texto.
//
// Cómo está armado (todo del plan, comprobado contra la documentación oficial el 25/11/2026):
//  · `prepararFijo` guarda por trabajo las herramientas y las instrucciones tal como van a la API, con la marca de caché al
//    final del último bloque de sistema (el orden de la API es herramientas → sistema → mensajes). Lo fijo no cambia nunca
//    dentro de un trabajo: el control de historial de Anthropic rechaza (400) cambiar instrucciones o herramientas mientras
//    se reenvían bloques de pensamiento.
//  · `aNativo` arma un mensaje de la conversación; el del asistente NO pasa por acá: es `RespuestaModelo.nativo`, el JSON
//    exacto que devolvió la API (con sus bloques de pensamiento y firmas), y vuelve tal cual (regla 1 de 9.1). La única
//    diferencia: un bloque de texto vacío se omite, porque la API rechaza reenviarlo.
//  · Streaming siempre: se lee el flujo de eventos y se junta el mensaje (evita cortes por tiempo y permite abortar). Se
//    arma a mano en vez de usar el ayudante del SDK para decidir nosotros qué pasa con un JSON de herramienta roto o cortado:
//    la llamada vuelve marcada `invalida` y el modelo la ve como error (regla 6).
//  · Caché: marca al final de lo fijo + `cache_control` de nivel superior (la API pone sola la marca en el último bloque de la
//    conversación). No se manda `thinking`: en Opus 5.5, Sonnet 5.5 y Haiku 5.5 el pensamiento adaptivo es lo que se usa
//    cuando se omite (en Opus 5.5 no se puede apagar). No se fuerza ninguna herramienta (`tool_choice` any/tool da 400 en
//    Opus 5.5 y Sonnet 5.5). No se usan los «fallbacks» del servidor (cambiarían el modelo y el costo a mitad del trabajo).
//  · Errores: todo lo que sale es un `ErrorProveedor` ya clasificado (6.11), con `reintentable` y `esperarMs` (el
//    `retry-after` de la API). El ciclo (C) es quien reintenta con su cola; el adaptador solo reintenta por su cuenta una
//    vez, si la espera es corta (≤ 3 s), para no mandar a la cola un parpadeo.
//  · Nunca se loguea ni se copia a un error la clave ni el contenido: los mensajes de error se arman con campos propios (tipo,
//    código HTTP, tipo de error de la API, id del pedido) y pasan por el filtro de claves.
import type { Corte, PedidoModelo, Proveedor, RespuestaModelo, LlamadaHerramienta, MensajeNeutro, ParteUsuario, BloqueSistema, DefHerramienta, CapacidadesModelo, TipoErrorProveedor, Uso } from '../tipos'
import { ErrorProveedor } from '../tipos'
import { filtrarClaves } from './filtro'
import { validarClave } from './http-ia'
import { precioDe } from './precios'

export const URL_BASE_ANTHROPIC = 'https://api.anthropic.com'
/** La beta del cinturón extra (9.2): descarta un bloque de pensamiento que no coincide en vez de fallar. Apagado de fábrica. */
export const BETA_CONTROLES_DE_PENSAMIENTO = 'thinking-binding-controls-2026-08-01'
const ESFUERZO = { bajo: 'low', medio: 'medium', alto: 'high' } as const
/** El mismo pedido tiene que dar el mismo cuerpo: la marca de caché es siempre ésta. */
const MARCA_DE_CACHE = { type: 'ephemeral' } as const

export interface OpcionesAnthropic {
  /** Para las pruebas: el `fetch` con el que habla el SDK (de fábrica, el de Node). */
  fetch?: typeof fetch
  /** Para las pruebas: dormir sin esperar de verdad. */
  dormir?: (ms: number) => Promise<void>
  /** Cuántas veces reintenta por su cuenta un 429 o 529 con espera corta (de fábrica, 1; 0 lo apaga). */
  reintentosInternos?: number
  /** La espera más larga que el adaptador se banca antes de devolverle el error al ciclo (de fábrica, 3 s). */
  esperaInternaMaxMs?: number
  /**
   * Pide la beta `thinking-binding-controls-2026-08-01` con `prefix_mismatch_behavior: "drop_block"`: si la API no acepta el
   * pensamiento que se reenvía, lo descarta en vez de dar 400 (el modelo pierde ese razonamiento). Apagado: sin la prueba
   * real no se sabe cómo reacciona el camino beta con las cuentas de la clave del dueño.
   */
  descartarPensamientoAjeno?: boolean
}

export interface ProveedorAnthropic extends Proveedor {
  /** La prueba barata de una clave al guardarla: lista los modelos (no gasta). */
  probarClave(clave: string, op?: { urlBase?: string; modelo?: string }): Promise<{ ok: boolean; error?: string; modelos?: string[] }>
}

// ───────────────────────── el SDK, cargado recién cuando hace falta ─────────────────────────
// Un `import()` dentro del adaptador: la función de Vercel no paga el arranque del SDK si ese pedido no usa Anthropic.
type ModuloSdk = typeof import('@anthropic-ai/sdk')
let sdkCargado: Promise<ModuloSdk> | undefined
const cargarSdk = (): Promise<ModuloSdk> => (sdkCargado ??= import('@anthropic-ai/sdk'))

async function crearCliente(clave: string, urlBase: string | undefined, fetchPropio: typeof fetch | undefined) {
  const { Anthropic } = await cargarSdk()
  return new Anthropic({
    apiKey: clave,
    // nada de lo que pueda haber en el entorno o en el disco de quien corre esto: solo la clave de esta cuenta
    authToken: null,
    credentials: null,
    config: null,
    profile: null,
    baseURL: urlBase || URL_BASE_ANTHROPIC,
    // los reintentos los decide este adaptador (y, más arriba, el ciclo): el SDK no reintenta por su cuenta
    maxRetries: 0,
    logLevel: 'off',
    openTelemetry: false,
    ...(fetchPropio ? { fetch: fetchPropio } : {}),
  })
}

// ───────────────────────── de nuestros mensajes a los de la API ─────────────────────────

type Bloque = Record<string, unknown>
interface MensajeApi { role: 'user' | 'assistant'; content: Bloque[] }

/**
 * Una parte de la persona. Una imagen queda como REFERENCIA (`source.type: 'telar'`, con la ruta del almacén): los bytes los
 * pone `llamar` al armar el pedido, con `leerImagen`. Así lo guardado en la base nunca lleva los bytes (7.4).
 */
function parteABloque(p: ParteUsuario): Bloque | null {
  if (p.tipo === 'texto') return p.texto === '' ? null : { type: 'text', text: p.texto }
  return { type: 'image', source: { type: 'telar', ruta: p.ruta, media_type: p.mime } }
}

const bloquesDe = (partes: ParteUsuario[], vacio: string): Bloque[] => {
  const b = partes.map(parteABloque).filter((x): x is Bloque => x !== null)
  return b.length ? b : [{ type: 'text', text: vacio }]
}

function aMensajeApi(m: MensajeNeutro): MensajeApi {
  switch (m.rol) {
    case 'usuario':
      return { role: 'user', content: bloquesDe(m.partes, '(sin texto)') }
    case 'herramienta':
      // todos los resultados de un mismo paso van juntos, en UN mensaje (si no, el modelo deja de llamar en paralelo)
      return {
        role: 'user',
        content: m.resultados.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: bloquesDe(r.partes, '(sin contenido)'),
          ...(r.esError ? { is_error: true } : {}),
        })),
      }
    case 'sistema':
      // Una nota de Telar a mitad de la conversación. Va como texto de la persona (Telar es quien escribe todos esos
      // mensajes): vale con cualquier modelo, sin las reglas de lugar de un mensaje `system` a mitad de la conversación.
      return { role: 'user', content: [{ type: 'text', text: `[Nota de Telar] ${m.texto}` }] }
    case 'asistente': {
      // No es el camino normal (el del asistente se reenvía tal cual vino): sirve para reconstruir una conversación.
      const contenido: Bloque[] = []
      if (m.texto) contenido.push({ type: 'text', text: m.texto })
      for (const l of m.llamadas) contenido.push({ type: 'tool_use', id: l.id, name: l.nombre, input: l.argumentos ?? {} })
      return { role: 'assistant', content: contenido.length ? contenido : [{ type: 'text', text: '(sin texto)' }] }
    }
  }
}

/** Cambia las referencias a imágenes por sus bytes en base64, en el cuerpo del pedido (ya copiado: no toca lo guardado). */
async function ponerImagenes(mensajes: MensajeApi[], leer: (ruta: string) => Promise<Uint8Array>): Promise<void> {
  const pendientes: Promise<void>[] = []
  const vistas = new Map<string, Promise<Uint8Array>>()
  const bytes = (ruta: string) => {
    let p = vistas.get(ruta)
    if (!p) vistas.set(ruta, (p = leer(ruta)))
    return p
  }
  const recorrer = (bloques: unknown) => {
    if (!Array.isArray(bloques)) return
    for (const b of bloques as Bloque[]) {
      if (b.type === 'tool_result') recorrer(b.content)
      const s = b.source as { type?: string; ruta?: string; media_type?: string } | undefined
      if (b.type === 'image' && s?.type === 'telar' && typeof s.ruta === 'string') {
        const { ruta, media_type } = s
        pendientes.push(
          bytes(ruta).then((buf) => {
            b.source = { type: 'base64', media_type, data: Buffer.from(buf).toString('base64') }
          }),
        )
      }
    }
  }
  for (const m of mensajes) recorrer(m.content)
  await Promise.all(pendientes)
}

// ───────────────────────── de la respuesta de la API a la nuestra ─────────────────────────

interface BloqueAcum extends Bloque {
  type: string
  /** Lo que llegó del JSON de los argumentos de una herramienta, a pedazos. */
  _json?: string
  _invalida?: string
}

interface Acumulado {
  id?: string
  stop?: string | null
  uso: { input?: number; output?: number; lectura?: number; escritura?: number }
  bloques: Map<number, BloqueAcum>
  completo: boolean
}

const numero = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)

function juntarUso(a: Acumulado, u: Record<string, unknown> | undefined): void {
  if (!u) return
  // lo último que informa la API gana (en message_delta los números son acumulados)
  a.uso.input = numero(u.input_tokens) ?? a.uso.input
  a.uso.output = numero(u.output_tokens) ?? a.uso.output
  a.uso.lectura = numero(u.cache_read_input_tokens) ?? a.uso.lectura
  a.uso.escritura = numero(u.cache_creation_input_tokens) ?? a.uso.escritura
}

type EventoApi = { type: string; index?: number; message?: Record<string, unknown>; content_block?: BloqueAcum; delta?: Record<string, unknown>; usage?: Record<string, unknown> }

function aplicarEvento(a: Acumulado, ev: EventoApi): void {
  switch (ev.type) {
    case 'message_start':
      a.id = typeof ev.message?.id === 'string' ? ev.message.id : a.id
      juntarUso(a, ev.message?.usage as Record<string, unknown> | undefined)
      return
    case 'content_block_start':
      if (ev.index !== undefined && ev.content_block) a.bloques.set(ev.index, { ...ev.content_block })
      return
    case 'content_block_delta': {
      const b = ev.index === undefined ? undefined : a.bloques.get(ev.index)
      const d = ev.delta
      if (!b || !d) return
      if (d.type === 'text_delta') b.text = `${(b.text as string | undefined) ?? ''}${d.text as string}`
      else if (d.type === 'thinking_delta') b.thinking = `${(b.thinking as string | undefined) ?? ''}${d.thinking as string}`
      else if (d.type === 'signature_delta') b.signature = `${(b.signature as string | undefined) ?? ''}${d.signature as string}`
      else if (d.type === 'input_json_delta') b._json = `${b._json ?? ''}${d.partial_json as string}`
      else if (d.type === 'citations_delta') b.citations = [...((b.citations as unknown[] | undefined) ?? []), d.citation]
      return
    }
    case 'content_block_stop': {
      const b = ev.index === undefined ? undefined : a.bloques.get(ev.index)
      if (b && b._json !== undefined) cerrarArgumentos(b)
      return
    }
    case 'message_delta':
      a.stop = (ev.delta?.stop_reason as string | null | undefined) ?? a.stop
      juntarUso(a, ev.usage)
      return
    case 'message_stop':
      a.completo = true
      return
    default:
      // ping y los eventos que no conocemos: se ignoran (la API puede sumar tipos)
      return
  }
}

/** Convierte el JSON de los argumentos de una herramienta en objeto; si vino roto o cortado, la llamada queda inválida. */
function cerrarArgumentos(b: BloqueAcum): void {
  const crudo = b._json ?? ''
  delete b._json
  if (crudo.trim() === '') {
    b.input = {}
    return
  }
  try {
    const v: unknown = JSON.parse(crudo)
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('no es un objeto')
    b.input = v
  } catch {
    // La API exige un objeto al reenviar: queda vacío, y la llamada se marca para que el modelo vea el error.
    b.input = {}
    b._invalida = 'Los argumentos de la herramienta llegaron cortados o con JSON roto: volvé a llamarla con argumentos completos.'
  }
}

const CORTES: Record<string, Corte> = {
  end_turn: 'fin',
  stop_sequence: 'fin',
  tool_use: 'herramientas',
  max_tokens: 'largo',
  model_context_window_exceeded: 'largo',
  refusal: 'rechazo',
  pause_turn: 'pausa',
}

function armarRespuesta(a: Acumulado, idPedido: string | undefined): RespuestaModelo {
  const bloques = [...a.bloques.entries()].sort((x, y) => x[0] - y[0]).map((e) => e[1])
  // Una herramienta que se cortó por el largo de la respuesta nunca se ejecuta, aunque el JSON haya quedado «completo».
  const cortada = a.stop === 'max_tokens' || a.stop === 'model_context_window_exceeded'
  const llamadas: LlamadaHerramienta[] = []
  for (const b of bloques) {
    if (b.type !== 'tool_use') continue
    const invalida = b._invalida ?? (cortada ? 'La respuesta se cortó por el largo antes de terminar la llamada: pedí menos por vez.' : undefined)
    llamadas.push({ id: String(b.id), nombre: String(b.name), argumentos: b.input ?? {}, ...(invalida ? { invalida } : {}) })
  }
  const contenido = bloques
    .map((b) => {
      const { _json: _j, _invalida: _i, ...limpio } = b
      return limpio
    })
    .filter((b) => !(b.type === 'text' && (b.text === '' || b.text === undefined)))
  const texto = bloques.map((b) => (b.type === 'text' ? String(b.text ?? '') : '')).join('')
  const uso: Uso = {
    entrada: a.uso.input ?? 0,
    salida: a.uso.output ?? 0,
    cacheLectura: a.uso.lectura ?? 0,
    cacheEscritura: a.uso.escritura ?? 0,
  }
  let corte: Corte = CORTES[a.stop ?? ''] ?? 'fin'
  // si hay llamadas pero la API dijo otra cosa (no debería), el ciclo tiene que verlas igual
  if (corte === 'fin' && llamadas.length) corte = 'herramientas'
  return { corte, texto, llamadas, uso, nativo: JSON.stringify({ role: 'assistant', content: contenido }), ...(idPedido ? { idPedido } : {}) }
}

// ───────────────────────── errores ─────────────────────────

const PATRON_SALDO = /credit balance|usage limits?|spend(ing)? limit|billing|purchase credits/i

interface DatosError {
  status?: number
  tipoApi?: string
  mensajeApi?: string
  retryAfterMs?: number
  idPedido?: string
}

function esperaDe(h: Headers | undefined): number | undefined {
  if (!h) return undefined
  const ms = Number(h.get('retry-after-ms'))
  if (h.get('retry-after-ms') && Number.isFinite(ms) && ms >= 0) return Math.min(ms, 3_600_000)
  const s = h.get('retry-after')
  if (!s) return undefined
  const seg = Number(s)
  if (Number.isFinite(seg) && seg >= 0) return Math.min(seg * 1000, 3_600_000)
  const fecha = Date.parse(s)
  return Number.isNaN(fecha) ? undefined : Math.min(Math.max(0, fecha - Date.now()), 3_600_000)
}

function clasificar(d: DatosError, modelo: string): { tipo: TipoErrorProveedor; reintentable: boolean; texto: string } {
  const { status, tipoApi } = d
  if (status === 401 || status === 403 || tipoApi === 'authentication_error' || tipoApi === 'permission_error') {
    return { tipo: 'clave', reintentable: false, texto: 'La clave de Anthropic no anda. Cambiala en Configuración → IA.' }
  }
  if (status === 402 || tipoApi === 'billing_error' || (status === 400 && PATRON_SALDO.test(d.mensajeApi ?? ''))) {
    return { tipo: 'saldo', reintentable: false, texto: 'Anthropic frenó: llegaste al límite de gasto o te quedaste sin saldo en tu cuenta de Console.' }
  }
  if (status === 429 || tipoApi === 'rate_limit_error') {
    return { tipo: 'limite', reintentable: true, texto: 'Esperando al proveedor: Anthropic pidió esperar un momento (límite de pedidos).' }
  }
  if (status === 504 || status === 408 || tipoApi === 'timeout_error') {
    return { tipo: 'tiempo', reintentable: true, texto: 'El pedido es muy grande para un solo paso: pedilo por partes.' }
  }
  if (status === 529 || tipoApi === 'overloaded_error' || tipoApi === 'api_error' || (status !== undefined && status >= 500)) {
    return { tipo: 'sobrecarga', reintentable: true, texto: 'El proveedor no responde. Probá de nuevo en un rato.' }
  }
  if (status === 404 || tipoApi === 'not_found_error') {
    return { tipo: 'pedido', reintentable: false, texto: `Anthropic no conoce el modelo «${modelo}» para esta clave.` }
  }
  if (status === undefined && tipoApi === undefined) {
    return { tipo: 'sobrecarga', reintentable: true, texto: 'El proveedor no responde. Probá de nuevo en un rato.' }
  }
  return { tipo: 'pedido', reintentable: false, texto: `Algo salió mal al hablar con el modelo (código ${tipoApi ?? status ?? 'desconocido'}).` }
}

/** Convierte lo que tire el SDK o el flujo en un `ErrorProveedor`: sin la clave, sin el contenido, sin `cause`. */
function aErrorProveedor(e: unknown, p: Pick<PedidoModelo, 'clave' | 'modelo' | 'senal'>): ErrorProveedor {
  if (e instanceof ErrorProveedor) return e
  const o = (e ?? {}) as { name?: string; status?: unknown; type?: unknown; apiMessage?: unknown; headers?: unknown; requestID?: unknown; error?: unknown }
  if (o.name === 'APIUserAbortError' || p.senal.aborted) {
    return new ErrorProveedor({ tipo: 'tiempo', reintentable: true, paraLaPersona: 'Se cortó el pedido.', mensaje: 'anthropic: pedido abortado' })
  }
  const headers = o.headers instanceof Headers ? o.headers : undefined
  const cuerpo = (o.error ?? {}) as { error?: { type?: unknown; message?: unknown } }
  const tipoApi = typeof o.type === 'string' ? o.type : typeof cuerpo.error?.type === 'string' ? cuerpo.error.type : undefined
  const mensajeApi = typeof o.apiMessage === 'string' ? o.apiMessage : typeof cuerpo.error?.message === 'string' ? cuerpo.error.message : undefined
  const status = typeof o.status === 'number' ? o.status : undefined
  const idPedido = typeof o.requestID === 'string' ? o.requestID : (headers?.get('request-id') ?? undefined)

  let c: ReturnType<typeof clasificar>
  let espera: number | undefined
  if (status === undefined && tipoApi === undefined) {
    // sin respuesta de la API: se cortó la conexión, se acabó el tiempo, o algo propio se rompió
    if (o.name === 'APIConnectionTimeoutError') c = { tipo: 'tiempo', reintentable: true, texto: 'El pedido es muy grande para un solo paso: pedilo por partes.' }
    else if (o.name === 'APIConnectionError' || o.name === 'TypeError') c = { tipo: 'red', reintentable: true, texto: 'No pude conectarme con Anthropic.' }
    else c = { tipo: 'red', reintentable: true, texto: 'Se cortó la conexión con Anthropic a mitad del pedido.' }
  } else {
    c = clasificar({ status, tipoApi, mensajeApi }, p.modelo)
    espera = esperaDe(headers)
    // un 529 sin espera pedida: un segundo alcanza para que valga la pena reintentar de inmediato
    if (c.tipo === 'sobrecarga' && espera === undefined && status === 529) espera = 1_000
  }
  const mensaje = filtrarClaves(`anthropic ${c.tipo} http=${status ?? '-'} api=${tipoApi ?? o.name ?? '-'}${idPedido ? ` pedido=${idPedido}` : ''}`, p.clave)
  return new ErrorProveedor({
    tipo: c.tipo,
    reintentable: c.reintentable,
    paraLaPersona: filtrarClaves(c.texto, p.clave),
    mensaje,
    ...(espera !== undefined ? { esperarMs: espera } : {}),
    ...(idPedido ? { idPedido } : {}),
  })
}

// ───────────────────────── el adaptador ─────────────────────────

const dormirDeVerdad = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const CAPACIDADES_DESCONOCIDAS: CapacidadesModelo = { imagenes: true, imagenesEnResultados: true, contexto: 200_000, salidaMax: 64_000 }

export function crearProveedorAnthropic(op: OpcionesAnthropic = {}): ProveedorAnthropic {
  const dormir = op.dormir ?? dormirDeVerdad
  const reintentosInternos = op.reintentosInternos ?? 1
  const esperaInternaMaxMs = op.esperaInternaMaxMs ?? 3_000

  async function probarClave(clave: string, o: { urlBase?: string; modelo?: string } = {}) {
    try {
      validarClave(clave, 'Anthropic')
    } catch (e) {
      return { ok: false, error: e instanceof ErrorProveedor ? e.paraLaPersona : 'La clave no sirve.' }
    }
    try {
      const cliente = await crearCliente(clave, o.urlBase, op.fetch)
      const pagina = await cliente.models.list({ limit: 1000 })
      const modelos = pagina.data.map((m) => m.id)
      if (o.modelo && modelos.length > 0 && !modelos.includes(o.modelo)) {
        return { ok: false, error: `Anthropic no tiene el modelo «${o.modelo}» para esta clave.`, modelos }
      }
      return { ok: true, modelos }
    } catch (e) {
      const err = aErrorProveedor(e, { clave, modelo: o.modelo ?? '', senal: new AbortController().signal })
      return { ok: false, error: err.tipo === 'clave' ? 'Anthropic la rechazó: revisá que esté completa.' : err.paraLaPersona }
    }
  }

  async function cuerpoDe(p: PedidoModelo): Promise<Record<string, unknown>> {
    let fijo: { system?: unknown; tools?: unknown }
    let mensajes: MensajeApi[]
    try {
      fijo = JSON.parse(p.fijo) as typeof fijo
      mensajes = p.historial.map((h) => JSON.parse(h) as MensajeApi)
    } catch {
      throw new ErrorProveedor({ tipo: 'pedido', reintentable: false, paraLaPersona: 'Lo guardado de la conversación no se puede leer (JSON roto).', mensaje: 'anthropic: fijo o historial con JSON roto' })
    }
    await ponerImagenes(mensajes, p.leerImagen)
    const cuerpo: Record<string, unknown> = {
      model: p.modelo,
      max_tokens: p.maxSalida,
      stream: true,
      // la API pone sola la marca de caché en el último bloque de la conversación; la de lo fijo va en prepararFijo
      cache_control: MARCA_DE_CACHE,
      ...(fijo.system ? { system: fijo.system } : {}),
      ...(Array.isArray(fijo.tools) && fijo.tools.length ? { tools: fijo.tools } : {}),
      messages: mensajes,
    }
    if (p.esfuerzo) cuerpo.output_config = { effort: ESFUERZO[p.esfuerzo] }
    if (op.descartarPensamientoAjeno) cuerpo.thinking = { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }
    return cuerpo
  }

  /** Un pedido, sin reintentos: junta el flujo de eventos en una respuesta. */
  async function unPedido(p: PedidoModelo, cuerpo: Record<string, unknown>): Promise<RespuestaModelo> {
    const cliente = await crearCliente(p.clave, p.urlBase, op.fetch)
    type Crear = (c: unknown, o: { signal: AbortSignal }) => { withResponse(): Promise<{ data: AsyncIterable<EventoApi>; response: Response }> }
    const crear: Crear = op.descartarPensamientoAjeno
      ? (c, o) => cliente.beta.messages.create({ ...(c as object), betas: [BETA_CONTROLES_DE_PENSAMIENTO] } as never, o) as never
      : (c, o) => cliente.messages.create(c as never, o) as never
    const { data, response } = await crear(cuerpo, { signal: p.senal }).withResponse()
    const a: Acumulado = { uso: {}, bloques: new Map(), completo: false }
    for await (const ev of data) aplicarEvento(a, ev)
    if (!a.completo || a.stop === undefined || a.stop === null) {
      throw new ErrorProveedor({
        tipo: 'red',
        reintentable: true,
        paraLaPersona: 'Se cortó la conexión con Anthropic a mitad del pedido.',
        mensaje: 'anthropic: el flujo terminó sin message_stop',
        ...(response.headers.get('request-id') ? { idPedido: response.headers.get('request-id')! } : {}),
      })
    }
    return armarRespuesta(a, response.headers.get('request-id') ?? a.id)
  }

  return {
    id: 'anthropic',

    prepararFijo({ sistema, herramientas }: { sistema: BloqueSistema[]; herramientas: DefHerramienta[]; modelo: string }): string {
      const tools = herramientas.map((h) => {
        // `$schema` sobra: la API pide un objeto de JSON Schema y el resto lo trae z.toJSONSchema
        const { $schema: _s, ...esquema } = h.esquema as Record<string, unknown>
        return { name: h.nombre, description: h.descripcion, input_schema: esquema }
      })
      const system: Record<string, unknown>[] = sistema.filter((b) => b.texto !== '').map((b) => ({ type: 'text', text: b.texto }))
      // La marca va al final de lo fijo: herramientas y sistema se guardan juntos (el orden de la API es herramientas → sistema).
      if (system.length) system[system.length - 1]!.cache_control = MARCA_DE_CACHE
      else if (tools.length) (tools[tools.length - 1] as Record<string, unknown>).cache_control = MARCA_DE_CACHE
      return JSON.stringify({ ...(system.length ? { system } : {}), ...(tools.length ? { tools } : {}) })
    },

    aNativo(m: MensajeNeutro): string {
      return JSON.stringify(aMensajeApi(m))
    },

    async llamar(p: PedidoModelo): Promise<RespuestaModelo> {
      // una clave con saltos de línea o letras raras no sale: se corta antes de armar nada (igual que OpenAI y los compatibles)
      validarClave(p.clave, 'Anthropic')
      const cuerpo = await cuerpoDe(p)
      for (let intento = 0; ; intento++) {
        try {
          return await unPedido(p, cuerpo)
        } catch (e) {
          const err = aErrorProveedor(e, p)
          const espera = err.esperarMs
          const vale = err.reintentable && (err.tipo === 'limite' || err.tipo === 'sobrecarga') && espera !== undefined && espera <= esperaInternaMaxMs
          if (!vale || intento >= reintentosInternos || p.senal.aborted) throw err
          await dormir(espera)
        }
      }
    },

    probar: (e) => probarClave(e.clave, { urlBase: e.urlBase, modelo: e.modelo }),
    probarClave,

    capacidades(modelo: string): CapacidadesModelo {
      return precioDe('anthropic', modelo)?.capacidades ?? CAPACIDADES_DESCONOCIDAS
    },
  }
}
