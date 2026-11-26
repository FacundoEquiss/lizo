// Reproduce grabaciones (grabaciones/anthropic/*.json) como un `fetch`: el SDK de Anthropic acepta uno propio, y las pruebas le
// dan uno que contesta lo grabado, en orden, y anota lo que se le pidió. Lo usan contratos.prueba.ts y anthropic.prueba.ts.
// No es una prueba: no corre nada por sí solo.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crearProveedorAnthropic, type OpcionesAnthropic, type ProveedorAnthropic } from './anthropic'

const CARPETA = path.dirname(fileURLToPath(import.meta.url))
export const GRABACIONES = path.join(CARPETA, 'grabaciones', 'anthropic')

/** Un pedido HTTP que el adaptador hizo. */
export interface PedidoCapturado { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: string }
export interface Esperado {
  corte?: string
  texto?: string
  uso?: { entrada: number; salida: number; cacheLectura: number; cacheEscritura: number }
  llamadas?: { id: string; nombre: string; argumentos: unknown; invalida?: boolean }[]
  idPedido?: string
  error?: { tipo: string; reintentable: boolean; esperarMs?: number }
  segundo?: { corte: string; texto: string; uso: unknown }
  /** Cuántos pedidos tiene que haber hecho el adaptador (con los reintentos propios). */
  pedidos?: number
  /** Las esperas que tiene que haber pedido el adaptador antes de reintentar. */
  esperas?: number[]
  probar?: { ok: boolean; modelos?: string[] }
}

export interface Intercambio {
  pedido: { metodo: string; ruta: string; consulta?: Record<string, string>; cuerpo?: unknown }
  respuesta: { estado?: number; cabeceras?: Record<string, string>; eventos?: { event: string; data: unknown }[]; cuerpo?: unknown; red?: boolean }
}
export interface Grabacion { caso: string; descripcion: string; origen: string; esperado?: Esperado; intercambios: Intercambio[] }

export const cargarGrabacion = (caso: string, clave: string): Grabacion => {
  const archivo = path.join(GRABACIONES, `${caso}.json`)
  return JSON.parse(readFileSync(archivo, 'utf8').replaceAll('{{CLAVE}}', clave)) as Grabacion
}

/** ¿El `real` trae al menos todo lo que dice `esperado`? (los arreglos, por posición; los objetos, por campo). Devuelve la primera diferencia. */
export function faltaDe(esperado: unknown, real: unknown, ruta = ''): string | null {
  if (esperado !== null && typeof esperado === 'object') {
    if (real === null || typeof real !== 'object') return `${ruta || 'cuerpo'}: se esperaba un objeto`
    if (Array.isArray(esperado)) {
      if (!Array.isArray(real) || real.length < esperado.length) return `${ruta}: faltan elementos (${Array.isArray(real) ? real.length : '—'} < ${esperado.length})`
      for (let i = 0; i < esperado.length; i++) {
        const f = faltaDe(esperado[i], real[i], `${ruta}[${i}]`)
        if (f) return f
      }
      return null
    }
    for (const [k, v] of Object.entries(esperado)) {
      const f = faltaDe(v, (real as Record<string, unknown>)[k], `${ruta}.${k}`)
      if (f) return f
    }
    return null
  }
  return esperado === real ? null : `${ruta}: se esperaba ${JSON.stringify(esperado)} y llegó ${JSON.stringify(real)}`
}

/** Un `fetch` que contesta con lo grabado, en orden, y anota lo que se le pidió. */
export function fetchDeGrabacion(rec: Grabacion, capturas: PedidoCapturado[], diferencias: string[], opciones: { colgar?: boolean } = {}): typeof fetch {
  let i = 0
  const codificar = new TextEncoder()
  return (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url)
    const cabeceras = Object.fromEntries(new Headers(init?.headers).entries())
    const cuerpo = typeof init?.body === 'string' ? init.body : ''
    capturas.push({ url: url.href, metodo: init?.method ?? 'GET', cabeceras, cuerpo })
    if (opciones.colgar) {
      // como un fetch de verdad que no termina: se queda esperando hasta que lo abortan
      return new Promise<Response>((_, rechazar) => {
        const alAbortar = () => rechazar(new DOMException('This operation was aborted', 'AbortError'))
        if (init?.signal?.aborted) alAbortar()
        init?.signal?.addEventListener('abort', alAbortar, { once: true })
      })
    }
    const n = i++
    const x = rec.intercambios[n]
    if (!x) {
      diferencias.push(`pedido ${n + 1}: la grabación solo tiene ${rec.intercambios.length}`)
      return new Response('{}', { status: 500 })
    }
    if ((init?.method ?? 'GET') !== x.pedido.metodo) diferencias.push(`pedido ${n + 1}: método ${init?.method} y la grabación pide ${x.pedido.metodo}`)
    if (url.pathname !== x.pedido.ruta) diferencias.push(`pedido ${n + 1}: ruta ${url.pathname} y la grabación pide ${x.pedido.ruta}`)
    for (const [k, v] of Object.entries(x.pedido.consulta ?? {})) if (url.searchParams.get(k) !== v) diferencias.push(`pedido ${n + 1}: ?${k}=${url.searchParams.get(k)} y la grabación pide ${v}`)
    if (x.pedido.cuerpo !== undefined) {
      const f = faltaDe(x.pedido.cuerpo, cuerpo ? JSON.parse(cuerpo) : undefined)
      if (f) diferencias.push(`pedido ${n + 1}: ${f}`)
    }
    const r = x.respuesta
    if (r.red) throw new TypeError('fetch failed')
    const estado = r.estado ?? 200
    if (r.eventos) {
      const texto = r.eventos.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')
      const bytes = codificar.encode(texto)
      // en pedazos de 97 bytes (un número primo): un evento, y hasta un carácter con acento, queda cortado entre dos pedazos
      const flujo = new ReadableStream<Uint8Array>({
        start(c) {
          for (let o = 0; o < bytes.length; o += 97) c.enqueue(bytes.slice(o, o + 97))
          c.close()
        },
      })
      return new Response(flujo, { status: estado, headers: { 'content-type': 'text/event-stream', ...r.cabeceras } })
    }
    return new Response(JSON.stringify(r.cuerpo ?? {}), { status: estado, headers: { 'content-type': 'application/json', ...r.cabeceras } })
  }) as typeof fetch
}


export interface AnthropicGrabado {
  proveedor: ProveedorAnthropic
  rec: Grabacion
  capturas: PedidoCapturado[]
  diferencias: string[]
  esperas: number[]
}

/** El adaptador de Anthropic armado para hablar con una grabación (`abortar`: con un servidor que no contesta nunca). */
export function armarAnthropicGrabado(caso: string, clave: string, opciones: OpcionesAnthropic = {}): AnthropicGrabado | null {
  const colgar = caso === 'abortar'
  if (!colgar && !existsSync(path.join(GRABACIONES, `${caso}.json`))) return null
  const rec: Grabacion = colgar ? { caso, descripcion: '', origen: '', intercambios: [] } : cargarGrabacion(caso, clave)
  const capturas: PedidoCapturado[] = []
  const diferencias: string[] = []
  const esperas: number[] = []
  const proveedor = crearProveedorAnthropic({ fetch: fetchDeGrabacion(rec, capturas, diferencias, { colgar }), dormir: async (ms) => void esperas.push(ms), ...opciones })
  return { proveedor, rec, capturas, diferencias, esperas }
}
