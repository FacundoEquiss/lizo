// El adaptador «compatible con OpenAI» (Chat Completions) con dirección base configurable (plan 9.2, tarea 6.2): DeepSeek, Gemini
// por su punto compatible, Groq, OpenRouter, Mistral, Ollama o LM Studio locales, etc. Verificado contra la documentación oficial el
// 25/11/2026 (Anexo D): api-docs.deepseek.com/guides/{tool_calls,thinking_mode} y aistudio.google.com/docs/openai.
//
// Lo que tiene de propio:
//   · **La dirección base se valida** (`validarUrlBase`): https obligatorio online; online se rechazan las direcciones a la propia
//     máquina, a redes privadas, de metadatos de la nube (169.254.169.254…) y los nombres internos (SSRF); en la computadora
//     se permite localhost y la red de la casa (Ollama), nunca los metadatos. Online además se resuelve el nombre y se mira
//     **a qué dirección se conecta el socket** (`transporteSeguro`), así un nombre que apunta adentro tampoco pasa.
//   · **No manda nada a otro lado:** `transporte` no sigue redirecciones, y la clave solo viaja a la dirección configurada.
//   · **Reenvío exacto:** el mensaje del asistente se guarda como vino (`reasoning_content` de DeepSeek, que si falta con herramientas
//     da 400; firmas de pensamiento de Gemini en `extra_content`; cualquier campo que el SDK no conozca).
//   · **Diferencias entre servicios:** `stream_options` (si lo rechazan, se reintenta sin él), `tool_call` sin `index` o sin `id`
//     (Gemini), herramientas no soportadas («Este modelo no admite herramientas»), uso con caché de DeepSeek
//     (`prompt_cache_hit_tokens`), `reasoning_effort` solo donde se sabe que existe.
//
// Uso: `entrada` = tokens de entrada que NO salieron del caché; `cacheLectura` = lo que salió de caché; `salida` incluye el razonamiento.
import dns from 'node:dns'
import https from 'node:https'
import { Readable } from 'node:stream'
import {
  type BloqueSistema,
  type CapacidadesModelo,
  type Corte,
  type DefHerramienta,
  ErrorProveedor,
  type LlamadaHerramienta,
  type MensajeNeutro,
  type PedidoModelo,
  type Proveedor,
  type RespuestaModelo,
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
  textoDelProveedor,
  type Transporte,
  transporteFetch,
  validarClave,
} from './http-ia'

// ───────────────────────── la dirección base (SSRF) ─────────────────────────

export type CategoriaDestino = 'publica' | 'loopback' | 'privada' | 'metadata' | 'reservada'

/** ¿Corre online (Vercel o `TABLERO_PUBLICO=1`)? Online no se puede hablar con nada de adentro. */
export const esOnline = (): boolean => process.env.TABLERO_PUBLICO === '1' || Boolean(process.env.VERCEL)

/** Clasifica una IPv4 (`a.b.c.d`). */
export function categoriaV4(o: readonly number[]): CategoriaDestino {
  const [a, b, c, d] = o as [number, number, number, number]
  if (a === 169 && b === 254) return 'metadata'                                 // link-local: 169.254.169.254 (AWS, GCP, Azure…)
  if (a === 100 && b === 100 && c === 100 && d === 200) return 'metadata'       // Alibaba
  if (a === 127 || a === 0) return 'loopback'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'privada'
  if (a === 100 && b >= 64 && b <= 127) return 'privada'                         // CGNAT
  if (a >= 224) return 'reservada'                                               // multicast, reservadas, broadcast
  if ((a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return 'reservada'
  return 'publica'
}

/** Pasa el texto de una IPv6 a sus 8 grupos de 16 bits (con `::` y con IPv4 al final), o null si no es una IPv6. */
export function grupos6(texto: string): number[] | null {
  let s = texto.replace(/^\[|\]$/g, '').toLowerCase()
  const z = s.indexOf('%')
  if (z >= 0) s = s.slice(0, z)
  const v4 = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const n = v4.slice(1).map(Number)
    if (n.some((x) => x > 255)) return null
    s = s.slice(0, s.length - v4[0].length) + ((n[0]! << 8) | n[1]!).toString(16) + ':' + ((n[2]! << 8) | n[3]!).toString(16)
  }
  const mitades = s.split('::')
  if (mitades.length > 2) return null
  const lado = (t: string) => (t === '' ? [] : t.split(':'))
  const izq = lado(mitades[0]!)
  const der = mitades.length === 2 ? lado(mitades[1]!) : []
  const faltan = 8 - izq.length - der.length
  if (mitades.length === 2 ? faltan < 1 : faltan !== 0) return null
  const todo = [...izq, ...Array<string>(mitades.length === 2 ? faltan : 0).fill('0'), ...der]
  if (todo.length !== 8 || todo.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return todo.map((g) => parseInt(g, 16))
}

/** Clasifica una IPv6 (incluidas las que llevan una IPv4 adentro: mapeada, NAT64, 6to4). */
export function categoriaV6(g: readonly number[]): CategoriaDestino {
  const v4 = (x: number, y: number) => categoriaV4([x >> 8, x & 255, y >> 8, y & 255])
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number]
  if (g.every((x) => x === 0) ) return 'loopback'
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return 'loopback'
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return v4(g6, g7)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return v4(g6, g7)
  if (g0 === 0x2002) return v4(g1, g2)
  if (g0 === 0xfd00 && g1 === 0x0ec2) return 'metadata'                       // AWS por IPv6
  if ((g0 & 0xfe00) === 0xfc00) return 'privada'                              // fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return 'metadata'                             // link-local
  if ((g0 & 0xff00) === 0xff00) return 'reservada'
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return 'reservada'        // Teredo y documentación
  return (g0 & 0xe000) === 0x2000 ? 'publica' : 'reservada'
}

/** Clasifica una IP (cualquier forma) o devuelve null si no es una IP. */
export function categoriaIp(texto: string): CategoriaDestino | null {
  const v4 = texto.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const n = v4.slice(1).map(Number)
    return n.some((x) => x > 255) ? 'reservada' : categoriaV4(n)
  }
  const g = texto.includes(':') ? grupos6(texto) : null
  return g ? categoriaV6(g) : null
}

const NOMBRES_DE_METADATOS = new Set(['metadata', 'metadata.google.internal', 'instance-data', 'instance-data.ec2.internal', 'metadata.azure.internal'])
const SUFIJOS_INTERNOS = ['.internal', '.local', '.localdomain', '.lan', '.home.arpa', '.intranet', '.corp', '.private', '.home', '.localnet']

/** Clasifica un nombre de host (sin tocar la red). */
export function categoriaNombre(host: string): CategoriaDestino {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (NOMBRES_DE_METADATOS.has(h)) return 'metadata'
  if (h === 'localhost' || h.endsWith('.localhost')) return 'loopback'
  if (!h.includes('.') || SUFIJOS_INTERNOS.some((s) => h.endsWith(s))) return 'privada'
  return 'publica'
}

export type ResultadoUrlBase =
  | { ok: true; url: string; host: string; categoria: CategoriaDestino; esIp: boolean }
  | { ok: false; motivo: string }

/**
 * Valida la dirección base de un servicio «compatible». Devuelve la dirección normalizada (sin barra al final) o el motivo, en
 * palabras para la persona. Solo mira el texto; el nombre se resuelve aparte (`verificarNombre`) y en la conexión (`transporteSeguro`).
 *
 *   online : https; nada de IP privadas, de la propia máquina ni de metadatos; nada de nombres internos; sin IPv6 literal.
 *   local  : http o https; se acepta localhost y la red de la casa (para Ollama o LM Studio); http solo con esas; nunca metadatos.
 */
export function validarUrlBase(entrada: string, o: { online?: boolean } = {}): ResultadoUrlBase {
  const online = o.online ?? esOnline()
  const texto = (entrada ?? '').trim()
  const no = (motivo: string): ResultadoUrlBase => ({ ok: false, motivo })
  if (!texto) return no('Falta la dirección base del servicio.')
  if (texto.length > 300 || /[\s\u0000-\u001f]/.test(texto)) return no('La dirección base no es válida.')
  let u: URL
  try { u = new URL(texto) } catch { return no('La dirección base no es válida: tiene que empezar con https://')}
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return no('La dirección base tiene que empezar con https://')
  if (u.username || u.password) return no('La dirección base no puede llevar usuario ni clave adentro: la clave se carga aparte.')
  if (u.search || u.hash) return no('La dirección base no puede llevar «?» ni «#»: es solo la dirección del servicio.')
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!host) return no('La dirección base no es válida.')
  const ip = categoriaIp(host)
  const esIp = ip !== null
  const categoria = ip ?? categoriaNombre(host)
  const salida = { ok: true as const, url: u.origin + u.pathname.replace(/\/+$/, ''), host, categoria, esIp }

  if (categoria === 'metadata' || categoria === 'reservada') return no('Esa dirección no se puede usar: es una dirección reservada o interna.')
  if (online) {
    if (u.protocol !== 'https:') return no('Online solo se aceptan direcciones https://.')
    if (esIp && host.includes(':')) return no('Usá el nombre del servicio (como api.ejemplo.com), no una dirección numérica IPv6.')
    if (categoria !== 'publica') return no('Esa dirección apunta a una red privada o a la propia máquina: online Telar no puede usarla. Un servicio local (Ollama, LM Studio) solo anda con Telar en tu computadora.')
    return salida
  }
  if (u.protocol === 'http:' && categoria === 'publica') return no('Una dirección de internet tiene que ser https:// (con http la clave viajaría sin cifrar).')
  return salida
}

const rechazar = (motivo: string) => new ErrorProveedor({ tipo: 'pedido', reintentable: false, paraLaPersona: motivo, mensaje: 'dirección base rechazada' })

/** El nombre del host tiene que resolver solo a direcciones públicas (un nombre público que apunta adentro no pasa). */
export type Resolutor = (host: string) => Promise<string[]>
export const resolverNombre: Resolutor = async (host) => (await dns.promises.lookup(host, { all: true })).map((a) => a.address)

export async function verificarNombre(host: string, esIp: boolean, resolver: Resolutor = resolverNombre): Promise<void> {
  if (esIp) return
  let direcciones: string[]
  try { direcciones = await resolver(host) } catch {
    throw new ErrorProveedor({ tipo: 'red', reintentable: true, paraLaPersona: `No se encontró el servicio «${corto(host, 80)}»: revisá la dirección base.`, mensaje: 'dns: no resuelve' })
  }
  if (!direcciones.length || direcciones.some((d) => (categoriaIp(d) ?? 'reservada') !== 'publica'))
    throw rechazar('Esa dirección apunta (por su nombre) a una red privada o a la propia máquina: online Telar no puede usarla.')
}

/**
 * Transporte para online: conecta por `node:https` y revisa, en el momento de abrir el socket, a qué dirección va (cierra el hueco
 * entre «resolví el nombre» y «me conecté»), sin seguir redirecciones. Solo https.
 */
export function transporteSeguro(o: { permitidas?: readonly CategoriaDestino[]; ca?: string } = {}): Transporte {
  // `permitidas` y `ca` son solo para las pruebas (un servidor https local con certificado propio): online son siempre las públicas
  const permitidas = o.permitidas ?? ['publica']
  // sin reutilizar conexiones: cada pedido pasa por el control de `lookup` (y en una función de Vercel no sirve guardar sockets)
  const agente = new https.Agent({ keepAlive: false })
  const lookup = ((host: string, opts: any, cb: any) => {
    dns.lookup(host, { ...opts, all: true }, (err, direcciones: any) => {
      if (err) return cb(err)
      const lista: { address: string; family: number }[] = Array.isArray(direcciones) ? direcciones : [{ address: direcciones, family: 4 }]
      if (!lista.length || lista.some((d) => !permitidas.includes(categoriaIp(d.address) ?? 'reservada'))) return cb(new Error('destino_no_permitido'))
      return opts?.all ? cb(null, lista) : cb(null, lista[0]!.address, lista[0]!.family)
    })
  }) as any
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const u = new URL(url)
      if (u.protocol !== 'https:') return reject(rechazar('Online solo se aceptan direcciones https://.'))
      const req = https.request(u, { method: init.method, headers: init.headers, lookup, agent: agente, signal: init.signal, ...(o.ca ? { ca: o.ca } : {}) }, (res) => {
        const h = new Headers()
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v)
        const estado = res.statusCode ?? 502
        const sinCuerpo = estado === 204 || estado === 304
        resolve(new Response(sinCuerpo ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), { status: estado, headers: h }))
      })
      req.on('error', (e: any) => reject(e?.message === 'destino_no_permitido' || /destino_no_permitido/.test(String(e?.cause?.message ?? ''))
        ? rechazar('Esa dirección apunta a una red privada o a la propia máquina: online Telar no puede usarla.')
        : e))
      if (init.body !== undefined) req.write(init.body)
      req.end()
    })
}

// ───────────────────────── perfiles por servicio ─────────────────────────

export type Perfil = 'deepseek' | 'gemini' | 'otro'

export function perfilDeHost(host: string): Perfil {
  if (host === 'api.deepseek.com' || host.endsWith('.deepseek.com')) return 'deepseek'
  if (host === 'generativelanguage.googleapis.com') return 'gemini'
  return 'otro'
}

/** El nombre para mostrar en los mensajes («Groq no responde…»). */
export function nombreDeHost(host: string): string {
  const h = host.toLowerCase()
  if (h.endsWith('deepseek.com')) return 'DeepSeek'
  if (h === 'generativelanguage.googleapis.com') return 'Gemini'
  if (h.endsWith('openrouter.ai')) return 'OpenRouter'
  if (h.endsWith('groq.com')) return 'Groq'
  if (h.endsWith('mistral.ai')) return 'Mistral'
  if (h.endsWith('together.xyz') || h.endsWith('together.ai')) return 'Together'
  if (h.endsWith('x.ai')) return 'xAI'
  if (categoriaNombre(h) !== 'publica' || categoriaIp(h)) return 'el servicio local'
  return h
}

/** `reasoning_effort` solo donde se sabe que existe: DeepSeek (low/high/max) y Gemini (minimal…xhigh). En los otros, no se manda. */
function esfuerzoDe(perfil: Perfil, e: PedidoModelo['esfuerzo']): string | null {
  if (!e) return null
  if (perfil === 'deepseek') return e === 'bajo' ? 'low' : 'high'
  if (perfil === 'gemini') return { bajo: 'low', medio: 'medium', alto: 'high' }[e]
  return null
}

// ───────────────────────── capacidades ─────────────────────────

export function capacidadesCompatible(modelo: string): CapacidadesModelo {
  const m = modelo.toLowerCase().replace(/^models\//, '')
  // DeepSeek (api-docs.deepseek.com/quick_start/pricing, 25/11/2026): 1M de contexto, 384K de salida; Flash ve imágenes, V4 Pro no.
  if (m === 'deepseek-flash' || m === 'deepseek-v4-flash') return { imagenes: true, imagenesEnResultados: true, contexto: 1_000_000, salidaMax: 384_000 }
  if (m.startsWith('deepseek-')) return { imagenes: false, imagenesEnResultados: false, contexto: 1_000_000, salidaMax: 384_000 }
  // Gemini (aistudio.google.com/docs/models, 25/11/2026): 1M de contexto, 64K de salida, imágenes.
  if (m.startsWith('gemini-')) return { imagenes: true, imagenesEnResultados: true, contexto: 1_000_000, salidaMax: 65_536 }
  // Cualquier otro: lo prudente. Si el dueño declara que ve imágenes, el ciclo lo suma (Agente.veImagenes).
  return { imagenes: false, imagenesEnResultados: false, contexto: 128_000, salidaMax: 8_000 }
}

// ───────────────────────── nativo ─────────────────────────

type Parte = { tipo: 'texto'; texto: string } | { tipo: 'imagen'; mime: string; ruta: string }

const aParte = (p: Parte) =>
  p.tipo === 'texto' ? { type: 'text', text: p.texto } : { type: 'image_url', image_url: { url: referenciaImagen(p.mime, p.ruta) } }

/** El contenido de un mensaje de usuario: texto solo como string; con imágenes, la lista de partes. */
const contenido = (partes: Parte[]) =>
  partes.some((p) => p.tipo === 'imagen') ? partes.map(aParte) : partes.map((p) => (p as { texto: string }).texto).join('\n\n')

export function nativoCompatible(m: MensajeNeutro, e: { modelo: string }): string {
  switch (m.rol) {
    case 'usuario':
      return JSON.stringify([{ role: 'user', content: contenido(m.partes) }])
    case 'sistema':
      // un `system` a mitad de la conversación lo rechazan varios servicios: va como una nota del usuario
      return JSON.stringify([{ role: 'user', content: `[Nota de Telar] ${m.texto}` }])
    case 'asistente':
      return JSON.stringify({
        role: 'assistant',
        content: m.texto || (m.llamadas.length ? null : ''),
        ...(m.llamadas.length
          ? { tool_calls: m.llamadas.map((l) => ({ id: l.id, type: 'function', function: { name: l.nombre, arguments: JSON.stringify(l.argumentos ?? {}) } })) }
          : {}),
      })
    case 'herramienta': {
      const conNombre = /^(models\/)?gemini/i.test(e.modelo)      // Gemini pide el nombre en la respuesta de la herramienta
      const mensajes: unknown[] = []
      const imagenes: unknown[] = []
      for (const r of m.resultados) {
        const texto = r.partes.filter((p) => p.tipo === 'texto').map((p) => (p as { texto: string }).texto).join('\n')
        mensajes.push({ role: 'tool', tool_call_id: r.id, ...(conNombre ? { name: r.nombre } : {}), content: texto || '(sin contenido)' })
        const ims = r.partes.filter((p) => p.tipo === 'imagen')
        if (ims.length) imagenes.push({ type: 'text', text: `Imágenes que devolvió la herramienta ${r.nombre} (${r.id}):` }, ...ims.map(aParte))
      }
      // `tool` solo admite texto: las imágenes de los resultados van en un mensaje de usuario justo después
      if (imagenes.length) mensajes.push({ role: 'user', content: imagenes })
      return JSON.stringify(mensajes)
    }
  }
}

export function fijoCompatible(e: { sistema: BloqueSistema[]; herramientas: DefHerramienta[] }): string {
  const sistema = e.sistema.map((b) => b.texto).filter(Boolean).join('\n\n')
  return JSON.stringify({
    mensajes: sistema ? [{ role: 'system', content: sistema }] : [],
    // sin `$schema` ni `additionalProperties`: Gemini y varios servidores locales los rechazan (zod valida igual en el ejecutor)
    tools: e.herramientas.map((h) => ({ type: 'function', function: { name: h.nombre, description: h.descripcion, parameters: limpiarEsquema(h.esquema, { sinAdicionales: true }) } })),
  })
}

function leerFijo(texto: string): { mensajes: unknown[]; tools: unknown[] } {
  try {
    const f = JSON.parse(texto)
    if (f && Array.isArray(f.mensajes) && Array.isArray(f.tools)) return f
  } catch { /* cae al error */ }
  throw new ErrorProveedor({ tipo: 'pedido', reintentable: false, paraLaPersona: 'Lo fijo del trabajo está dañado: no se puede seguir este trabajo.', mensaje: 'fijo con forma inesperada' })
}

export async function cuerpoCompatible(p: PedidoModelo, perfil: Perfil, o: { conOpcionesDeStream?: boolean } = {}): Promise<string> {
  const fijo = leerFijo(p.fijo)
  const partes: string[] = fijo.mensajes.map((m) => JSON.stringify(m))
  for (const h of p.historial) partes.push(...(await elementosDelHistorial(h, p.leerImagen)))
  const cap = capacidadesCompatible(p.modelo)
  const maxSalida = Math.max(16, Math.min(Math.floor(p.maxSalida), cap.salidaMax))
  const campos = [`"model":${JSON.stringify(p.modelo)}`, `"stream":true`]
  if (o.conOpcionesDeStream !== false) campos.push(`"stream_options":{"include_usage":true}`)
  campos.push(`"max_tokens":${maxSalida}`)
  const esfuerzo = esfuerzoDe(perfil, p.esfuerzo)
  if (esfuerzo) campos.push(`"reasoning_effort":"${esfuerzo}"`)
  if (fijo.tools.length) campos.push(`"tools":${JSON.stringify(fijo.tools)}`)
  campos.push(`"messages":[${partes.join(',')}]`)
  return `{${campos.join(',')}}`
}

// ───────────────────────── leer la respuesta ─────────────────────────

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

export function usoCompatible(u: any): Uso {
  if (!u || typeof u !== 'object') return { entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 }
  const prompt = num(u.prompt_tokens)
  const d = u.prompt_tokens_details ?? {}
  // DeepSeek informa aciertos y fallos de caché; OpenAI, Gemini y otros, `cached_tokens`
  const cacheLectura = u.prompt_cache_hit_tokens !== undefined ? num(u.prompt_cache_hit_tokens) : num(d.cached_tokens)
  const cacheEscritura = num(d.cache_write_tokens ?? d.cache_creation_tokens)
  const entrada = u.prompt_cache_miss_tokens !== undefined ? num(u.prompt_cache_miss_tokens) : Math.max(0, prompt - cacheLectura - cacheEscritura)
  // si el servicio no suma el razonamiento a `completion_tokens` pero sí al total, se cobra igual como salida
  const salida = Math.max(num(u.completion_tokens), u.total_tokens !== undefined ? num(u.total_tokens) - prompt : 0)
  return { entrada, salida, cacheLectura, cacheEscritura }
}

const CONCATENAR = new Set(['content', 'reasoning_content', 'reasoning', 'refusal'])
/** Campos que solo existen en la respuesta (no se reenvían: algunos servicios rechazan lo que no conocen en un mensaje de entrada). */
const SOLO_RESPUESTA = new Set(['annotations', 'audio', 'function_call', 'index', 'logprobs'])

/** Mezcla un pedazo del streaming en el mensaje: texto se suma, objetos se funden, listas se juntan, lo demás se pisa. */
function fundir(destino: Record<string, any>, clave: string, valor: unknown): void {
  if (valor === null || valor === undefined) return
  const actual = destino[clave]
  if (typeof valor === 'string') destino[clave] = typeof actual === 'string' ? actual + valor : valor
  else if (Array.isArray(valor)) destino[clave] = Array.isArray(actual) ? [...actual, ...valor] : [...valor]
  else if (typeof valor === 'object') {
    const o: Record<string, any> = actual && typeof actual === 'object' && !Array.isArray(actual) ? actual : {}
    for (const [k, v] of Object.entries(valor)) fundir(o, k, v)
    destino[clave] = o
  } else destino[clave] = valor
}

interface Hueco { id?: string; type?: string; name: string; args: string; extras: Record<string, any>; extrasFuncion: Record<string, any> }

class Acumulador {
  mensaje: Record<string, any> = {}
  huecos: Hueco[] = []
  porIndice = new Map<number, Hueco>()
  fin: string | null = null
  uso: any = null
  id: string | null = null

  agregar(c: any): void {
    if (typeof c?.id === 'string' && !this.id) this.id = c.id
    if (c?.usage && typeof c.usage === 'object') this.uso = c.usage
    const ch = Array.isArray(c?.choices) ? c.choices[0] : null
    if (!ch) return
    if (typeof ch.finish_reason === 'string') this.fin = ch.finish_reason
    const d = ch.delta ?? ch.message
    if (!d || typeof d !== 'object') return
    for (const [k, v] of Object.entries(d)) {
      if (k === 'tool_calls' || SOLO_RESPUESTA.has(k)) continue
      if (k === 'role') { this.mensaje.role ??= v; continue }
      if (k === 'content' || CONCATENAR.has(k)) { if (typeof v === 'string') this.mensaje[k] = (this.mensaje[k] ?? '') + v; continue }
      fundir(this.mensaje, k, v)
    }
    if (Array.isArray(d.tool_calls)) for (const tc of d.tool_calls) this.llamada(tc)
  }

  private llamada(tc: any): void {
    if (!tc || typeof tc !== 'object') return
    const indice = typeof tc.index === 'number' ? tc.index : undefined
    const id = typeof tc.id === 'string' && tc.id ? tc.id : undefined
    let h: Hueco | undefined
    if (indice !== undefined) h = this.porIndice.get(indice)
    else h = this.huecos[this.huecos.length - 1]
    // Gemini a veces manda cada llamada entera, sin índice, o repite el índice con otro id: una llamada nueva
    if (h && id && h.id && h.id !== id) h = undefined
    if (!h) {
      h = { name: '', args: '', extras: {}, extrasFuncion: {} }
      this.huecos.push(h)
      if (indice !== undefined) this.porIndice.set(indice, h)
    }
    if (id && !h.id) h.id = id
    if (typeof tc.type === 'string' && !h.type) h.type = tc.type
    const f = tc.function
    if (f && typeof f === 'object') {
      if (typeof f.name === 'string' && f.name) h.name = !h.name ? f.name : h.name === f.name ? h.name : h.name + f.name
      if (typeof f.arguments === 'string') h.args += f.arguments
      for (const [k, v] of Object.entries(f)) if (k !== 'name' && k !== 'arguments') h.extrasFuncion[k] = v
    }
    for (const [k, v] of Object.entries(tc)) if (!['index', 'id', 'type', 'function'].includes(k)) h.extras[k] = v   // p. ej. extra_content de Gemini
  }

  /** El mensaje del asistente, tal como hay que reenviarlo, y las llamadas ya leídas. */
  cerrar(): { mensaje: Record<string, any>; llamadas: LlamadaHerramienta[] } {
    const m: Record<string, any> = { role: 'assistant' }
    const texto = typeof this.mensaje.content === 'string' ? this.mensaje.content : ''
    const { role: _r, content: _c, ...resto } = this.mensaje
    m.content = texto || (this.huecos.length ? null : '')
    Object.assign(m, resto)
    const llamadas: LlamadaHerramienta[] = []
    if (this.huecos.length) {
      m.tool_calls = this.huecos.map((h) => {
        const id = h.id ?? `call_${crypto.randomUUID().slice(0, 8)}`
        const a = leerArgumentos(h.args)
        llamadas.push({ id, nombre: h.name, argumentos: a.argumentos, ...(a.invalida ? { invalida: a.invalida } : {}) })
        return { id, type: h.type ?? 'function', function: { name: h.name, arguments: h.args, ...h.extrasFuncion }, ...h.extras }
      })
    }
    return { mensaje: m, llamadas }
  }
}

/** Una respuesta de Chat Completions ya juntada → `RespuestaModelo`. */
function aRespuesta(a: Acumulador, c: ContextoError): RespuestaModelo {
  const { mensaje, llamadas } = a.cerrar()
  const texto = typeof mensaje.content === 'string' ? mensaje.content : ''
  const rechazo = typeof mensaje.refusal === 'string' && mensaje.refusal ? mensaje.refusal : ''
  if (a.fin === 'insufficient_system_resource')
    throw new ErrorProveedor({ tipo: 'sobrecarga', reintentable: true, paraLaPersona: `${c.proveedor} no tiene recursos libres en este momento. Probá de nuevo en un rato.`, mensaje: `${c.proveedor}: insufficient_system_resource` })
  let corte: Corte
  if (rechazo || a.fin === 'content_filter') corte = 'rechazo'
  else if (a.fin === 'length' || a.fin === 'max_tokens') corte = 'largo'
  else if (llamadas.length) corte = 'herramientas'      // Gemini a veces cierra con «stop» aunque haya llamadas
  else corte = 'fin'
  return { corte, texto: texto || rechazo, llamadas, uso: usoCompatible(a.uso), nativo: JSON.stringify(mensaje), idPedido: a.id ?? undefined }
}

async function juntar(res: Response, o: OpcionesHttp, senal: AbortSignal, c: ContextoError): Promise<RespuestaModelo> {
  const a = new Acumulador()
  // un servicio que contesta JSON entero (sin streaming) también sirve
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    let j: any
    try { j = await res.json() } catch { throw errorDeRed(c) }
    if (j?.error) throw errorDeEvento(j, c)
    a.agregar(j)
    return aRespuesta(a, c)
  }
  for await (const ev of leerSse(res, o, senal, c)) {
    if (ev.datos === '[DONE]') break
    let j: any
    try { j = JSON.parse(ev.datos) } catch { continue }
    if (j?.error) throw errorDeEvento(j, c)
    a.agregar(j)
  }
  if (a.fin === null && !Object.keys(a.mensaje).length && !a.huecos.length)
    throw new ErrorProveedor({ tipo: 'red', reintentable: true, paraLaPersona: `${c.proveedor} cortó la respuesta antes de empezar.`, mensaje: `${c.proveedor}: streaming vacío` })
  return aRespuesta(a, c)
}

// ───────────────────────── el adaptador ─────────────────────────

export interface OpcionesCompatible extends Partial<OpcionesHttp> {
  /** Online (Vercel o TABLERO_PUBLICO=1). De fábrica se mira el entorno; las pruebas lo fuerzan. */
  online?: boolean
  /** Para las pruebas: cómo se resuelven los nombres. */
  resolver?: Resolutor
}

export function crearProveedorCompatible(opciones: OpcionesCompatible = {}): Proveedor {
  const online = opciones.online ?? esOnline()
  const { online: _o, resolver: _r, transporte: _t, ...suelto } = opciones
  const o: OpcionesHttp = { ...OPCIONES_DE_FABRICA, ...suelto, transporte: opciones.transporte ?? (online ? transporteSeguro() : transporteFetch) }
  const resolver = opciones.resolver ?? resolverNombre

  /** Valida la dirección y, online, el nombre. Siempre antes de mandar nada. */
  async function destino(urlBase: string | undefined) {
    const v = validarUrlBase(urlBase ?? '', { online })
    if (!v.ok) throw rechazar(v.motivo)
    if (online) await verificarNombre(v.host, v.esIp, resolver)
    return v
  }
  const cabeceras = (clave: string): Record<string, string> => ({
    'content-type': 'application/json',
    accept: 'text/event-stream, application/json',
    ...(clave ? { authorization: `Bearer ${clave}` } : {}),
  })

  return {
    id: 'compatible',
    prepararFijo: (e) => fijoCompatible(e),
    aNativo: (m, e) => nativoCompatible(m, e),
    capacidades: capacidadesCompatible,

    async llamar(p) {
      const d = await destino(p.urlBase)
      const nombre = nombreDeHost(d.host)
      // sin clave solo se puede hablar con algo de la casa (Ollama, LM Studio): a un servicio de internet sin clave no se manda nada
      validarClave(p.clave, nombre, d.categoria !== 'publica')
      const ctx: ContextoError = { proveedor: nombre, modelo: p.modelo, claves: [p.clave] }
      const perfil = perfilDeHost(d.host)
      const url = `${d.url}/chat/completions`
      let res: Response
      try {
        res = await pedir(url, { method: 'POST', headers: cabeceras(p.clave), body: await cuerpoCompatible(p, perfil) }, p.senal, o, ctx)
      } catch (e) {
        // algunos servicios no conocen `stream_options` y lo dicen en el 400: se reintenta sin él, una vez
        if (e instanceof ErrorProveedor && e.tipo === 'pedido' && /stream_options|stream options/i.test(textoDelProveedor(e))) {
          res = await pedir(url, { method: 'POST', headers: cabeceras(p.clave), body: await cuerpoCompatible(p, perfil, { conOpcionesDeStream: false }) }, p.senal, o, ctx)
        } else throw e
      }
      try {
        return await juntar(res, o, p.senal, ctx)
      } catch (e) {
        if (e instanceof ErrorProveedor) throw e
        throw errorDeRed(ctx)
      }
    },

    async probar(e) {
      try {
        const d = await destino(e.urlBase)
        const nombre = nombreDeHost(d.host)
        validarClave(e.clave, nombre, d.categoria !== 'publica')
        const ctx: ContextoError = { proveedor: nombre, modelo: e.modelo, claves: [e.clave] }
        const senal = AbortSignal.timeout(15_000)
        try {
          const res = await pedir(`${d.url}/models`, { method: 'GET', headers: cabeceras(e.clave) }, senal, o, ctx)
          const j: any = await res.json().catch(() => ({}))
          const lista = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : []
          const modelos = lista.map((m: any) => String(m?.id ?? m?.name ?? '').replace(/^models\//, '')).filter(Boolean).sort().slice(0, 200)
          return { ok: true, modelos }
        } catch (err) {
          // algunos servicios no listan modelos: se prueba con el pedido más chico, si se sabe el modelo
          const noLista = err instanceof ErrorProveedor && err.tipo === 'pedido' && /HTTP (404|405)/.test(err.message)
          if (!noLista) throw err
          if (!e.modelo) return { ok: false, error: `${nombre} no tiene lista de modelos: escribí el nombre del modelo para probar la clave.` }
          const cuerpo = JSON.stringify({ model: e.modelo, messages: [{ role: 'user', content: 'hola' }], max_tokens: 1 })
          await pedir(`${d.url}/chat/completions`, { method: 'POST', headers: cabeceras(e.clave), body: cuerpo }, senal, o, ctx)
          return { ok: true }
        }
      } catch (err) {
        return { ok: false, error: err instanceof ErrorProveedor ? err.paraLaPersona : 'No se pudo probar la clave.' }
      }
    },
  }
}

export const proveedorCompatible = crearProveedorCompatible()

// `clasificarHttp` se re-exporta para las pruebas de contrato.
export { clasificarHttp }
