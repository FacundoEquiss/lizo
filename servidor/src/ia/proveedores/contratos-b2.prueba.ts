// Pruebas de contrato de los adaptadores `openai` (Responses) y `compatible` (Chat Completions: DeepSeek y Gemini) y de lo que los
// rodea: la validación de la dirección base (SSRF), los precios y los preajustes. Plan 15.3 y 16.8 (tareas 6.1 a 6.3).
// `npm run ia:probar-contratos-b2`. Sin red de internet y sin clave real: las respuestas salen de `grabaciones/<proveedor>/*.json`
// (hechas a mano de la documentación oficial: ver el README de esa carpeta) y de un servidor http local de mentira.
//
// El juego de contrato es el MISMO que corren el proveedor falso y Anthropic (`contrato.ts`, plan 15.3): acá cada proveedor arma su «banco»
// (qué grabación va con cada caso) y llama a `correrContratos`. Lo que sigue es lo propio de cada uno.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { PREAJUSTES_IA } from '../../../../compartido/preajustes-ia'
import { type DefHerramienta, ErrorProveedor, type MensajeNeutro, type PedidoModelo, type Proveedor, type TipoErrorProveedor } from '../tipos'
import { type Banco, type Caso, correrContratos, type Esperado, type Montaje } from './contrato'
import {
  capacidadesCompatible,
  categoriaIp,
  crearProveedorCompatible,
  nombreDeHost,
  nativoCompatible,
  transporteSeguro,
  validarUrlBase,
  verificarNombre,
} from './compatible'
import { clasificarHttp, duracionAMs, esperaDe, filtrarClaves, leerSse, type OpcionesHttp, type Transporte } from './http-ia'
import { crearProveedorOpenAI, nativoOpenAI } from './openai'
import { ErrorSinPrecio, PRECIOS_B2, precioConocido, precioDelAgente } from './precios'

const CARPETA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'grabaciones')
/** La clave de prueba: no es de nadie. Ningún error, registro ni salida puede llevarla. */
const CLAVE = 'sk-prueba-SECRETA-9f8e7d6c5b4a3210'

// ───────────────────────── herramientas para armar las pruebas ─────────────────────────

interface Grabacion {
  descripcion: string
  fuente: string
  pedido: { metodo: string; ruta: string }
  respuesta: { estado: number; headers: Record<string, string>; eventos?: { event?: string; data: unknown }[]; cuerpo?: unknown }
}

const leerGrabacion = (prov: string, caso: string): Grabacion =>
  JSON.parse(readFileSync(path.join(CARPETA, prov, `${caso}.json`), 'utf8').replaceAll('${CLAVE}', CLAVE))

/** El texto SSE de una grabación. */
function textoSse(g: Grabacion): string {
  return (g.respuesta.eventos ?? [])
    .map((e) => (e.event ? `event: ${e.event}\n` : '') + `data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`)
    .join('')
}

/** El cuerpo en pedacitos de 53 bytes (corta en el medio de líneas y de letras con acento, como la red). */
function trozos(texto: string, n = 53): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(texto)
  let i = 0
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close()
      c.enqueue(bytes.slice(i, i + n))
      i += n
    },
  })
}

function respuestaDe(g: Grabacion): Response {
  const r = g.respuesta
  const cuerpo = r.eventos ? textoSse(g) : JSON.stringify(r.cuerpo ?? {})
  return new Response(trozos(cuerpo), { status: r.estado, headers: r.headers })
}

interface Visto { url: string; metodo: string; headers: Record<string, string>; cuerpo: string }

/** Un transporte que contesta con lo grabado, en orden, y anota cada pedido. */
function transporteGrabado(cola: Grabacion[], visto: Visto[]): Transporte {
  return async (url, init) => {
    visto.push({ url, metodo: init.method, headers: init.headers, cuerpo: init.body ?? '' })
    const g = cola.shift()
    if (!g) throw new Error(`pedido de más a ${url}`)
    return respuestaDe(g)
  }
}

const sinEspera: Partial<OpcionesHttp> = { dormir: async () => {}, ociosoMs: 2_000 }

const imagenPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const base64Png = Buffer.from(imagenPng).toString('base64')

const herramientas: DefHerramienta[] = [
  {
    nombre: 'leer_tarjeta',
    descripcion: 'Lee una tarjeta. Ejemplo: {"tarjeta":"RC-12"}',
    esquema: z.toJSONSchema(z.strictObject({ tarjeta: z.string(), campos: z.array(z.string()).optional() })) as Record<string, unknown>,
  },
  { nombre: 'leer_tablero', descripcion: 'Lee un tablero.', esquema: z.toJSONSchema(z.strictObject({ tablero: z.string() })) as Record<string, unknown> },
]

function pedidoDe(p: Proveedor, o: Partial<PedidoModelo> & { modelo: string; historial?: string[] }): PedidoModelo {
  return {
    maxSalida: 4_000,
    fijo: p.prepararFijo({ sistema: [{ texto: 'Sos una IA de prueba.' }, { texto: 'Contestá corto.' }], herramientas, modelo: o.modelo }),
    historial: [p.aNativo({ rol: 'usuario', partes: [{ tipo: 'texto', texto: 'Qué hay en RC-12?' }] }, { modelo: o.modelo })],
    clave: CLAVE,
    senal: new AbortController().signal,
    leerImagen: async () => imagenPng,
    ...o,
  }
}

const usuario = (texto: string): MensajeNeutro => ({ rol: 'usuario', partes: [{ tipo: 'texto', texto }] })
const resultado = (id: string, nombre: string, texto: string): MensajeNeutro => ({ rol: 'herramienta', resultados: [{ id, nombre, esError: false, partes: [{ tipo: 'texto', texto }] }] })

/** Todo lo que el adaptador pudo haber dejado escrito: la clave no puede estar en ningún lado. */
const rastro = (e: unknown) => {
  const er = e as ErrorProveedor
  return JSON.stringify({ m: er.message, p: er.paraLaPersona, s: er.stack, t: er.tipo, e: er.esperarMs, id: er.idPedido })
}

// Nadie escribe en la consola: ni la clave ni nada (9.1, 6.11).
const consola: string[] = []
for (const n of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[n]
  console[n] = (...a: unknown[]) => { consola.push(a.map(String).join(' ')); void original }
}
after(() => assert.equal(consola.join('\n').includes(CLAVE), false, 'la clave apareció en la consola'))

// ───────────────────────── el banco de B2 para el juego de contrato (15.3) ─────────────────────────
// El juego es UNO para todos (`contrato.ts`): acá solo se dice, para cada proveedor, qué grabación corresponde a cada caso y qué tiene que
// salir. Lo que no tiene grabación no lo cubre (el juego lo saltea y lo dice).

type Esperanza = { grabacion: string; tipo: TipoErrorProveedor; reintentable: boolean; esperarMs?: number }

interface Config {
  nombre: string
  carpeta: 'openai' | 'deepseek' | 'gemini'
  modelo: string
  crear: (transporte: Transporte, extra?: Partial<OpcionesHttp>) => Proveedor
  /** La dirección base que se le pasa en cada pedido (solo «compatible»). */
  urlBase?: string
  /** El origen al que tiene que ir TODO lo que se manda. */
  destino: string
  /** La dirección completa del POST. */
  rutaBase: string
  /** Lo que tiene que decir cada grabación. */
  texto: { texto: string; uso: { entrada: number; salida: number; cacheLectura: number; cacheEscritura: number } }
  herramienta: { id: string; argumentos: unknown }
  dos: string[]
  /** Grabaciones de los cortes: cache (uso con caché), largo, rechazo y largo-herramienta-cortada. */
  cortes: Partial<Record<'cache' | 'largo' | 'rechazo' | 'largo-herramienta-cortada', string>>
  /** Los errores que llegan al ciclo, por caso. */
  errores: Partial<Record<Caso, Esperanza>>
  /** El 429 que se reintenta ADENTRO (espera corta, o larga si se sube el tope) y después anda. */
  reintento429: { grabacion: string; esperaEnLineaMaxMs?: number }
  /** Los modelos que lista `probar`. */
  modelos: string[]
}

const CLAVE_CON_SALTOS = 'sk-abc\r\nx-evil: 1'
/** Un transporte que nunca contesta: se queda esperando hasta que lo abortan (como un servidor que no responde). */
const colgado: Transporte = (_url, init) =>
  new Promise<Response>((_, rechazar) => {
    const alAbortar = () => rechazar(new DOMException('This operation was aborted', 'AbortError'))
    if (init.signal.aborted) alAbortar()
    init.signal.addEventListener('abort', alAbortar, { once: true })
  })

function bancoB2(c: Config): Banco {
  return {
    nombre: c.nombre,
    clave: CLAVE,
    montar(caso) {
      const visto: Visto[] = []
      const montar = (grabaciones: string[], o: { extra?: Partial<OpcionesHttp>; clave?: string; esperado?: Esperado; transporte?: Transporte } = {}): Montaje => ({
        proveedor: c.crear(o.transporte ?? transporteGrabado(grabaciones.map((g) => leerGrabacion(c.carpeta, g)), visto), o.extra),
        modelo: c.modelo,
        clave: o.clave ?? CLAVE,
        esperado: o.esperado,
        urlBase: c.urlBase,
        destino: c.destino,
        pedidos: () => visto.map((v) => ({ url: v.url, metodo: v.metodo, cabeceras: v.headers, cuerpo: v.cuerpo })),
        esperas: () => [],
        diferencias: () => [],
        formato: {
          primerPedido: (p) => {
            assert.equal(p.metodo, 'POST')
            assert.equal(p.url, c.rutaBase)
            assert.equal(p.cabeceras.authorization, `Bearer ${CLAVE}`)
          },
        },
      })
      const error = (e: Esperanza | undefined) =>
        e ? montar([e.grabacion], { esperado: { error: { tipo: e.tipo, reintentable: e.reintentable, ...(e.esperarMs !== undefined ? { esperarMs: e.esperarMs } : {}) } } }) : null

      switch (caso) {
        case 'texto':
          return montar(['texto'], { esperado: { corte: 'fin', texto: c.texto.texto, uso: c.texto.uso, llamadas: [] } })
        case 'herramienta':
          return montar(['herramienta'], { esperado: { corte: 'herramientas', llamadas: [{ id: c.herramienta.id, nombre: 'leer_tarjeta', argumentos: c.herramienta.argumentos }] } })
        case 'dos-herramientas':
          return montar(['dos-herramientas'], {
            esperado: {
              corte: 'herramientas',
              llamadas: [
                { id: c.dos[0]!, nombre: 'leer_tarjeta', argumentos: { tarjeta: 'RC-12' } },
                { id: c.dos[1]!, nombre: 'leer_tablero', argumentos: { tablero: 'Pendientes' } },
              ],
            },
          })
        case 'reenvio':
          return montar(['herramienta', 'texto'])
        case 'resultado-con-imagen':
          return montar(['texto'])
        case 'cache':
        case 'largo':
        case 'rechazo':
        case 'largo-herramienta-cortada':
          return c.cortes[caso] ? montar([c.cortes[caso]!], { esperado: caso === 'cache' ? undefined : { corte: caso === 'largo-herramienta-cortada' ? 'largo' : caso } }) : null
        case 'error-401':
        case 'error-401-eco':
          return error(c.errores['error-401'])
        case 'error-429':
        case 'error-saldo':
        case 'error-529':
        case 'error-500':
        case 'error-400':
        case 'error-flujo-cortado':
          return error(c.errores[caso])
        case 'error-429-corto':
          return montar([c.reintento429.grabacion, 'texto'], { extra: c.reintento429.esperaEnLineaMaxMs ? { esperaEnLineaMaxMs: c.reintento429.esperaEnLineaMaxMs } : undefined, esperado: { corte: 'fin', texto: c.texto.texto } })
        case 'error-red':
          return montar([], { transporte: async () => { throw new TypeError('fetch failed') }, esperado: { error: { tipo: 'red', reintentable: true } } })
        case 'abortar':
          return montar([], { transporte: colgado })
        case 'clave-con-saltos':
          return montar(['texto'], { clave: CLAVE_CON_SALTOS })
        case 'probar-ok':
          return montar(['modelos'], { esperado: { probar: { ok: true, modelos: c.modelos } } })
        case 'probar-401':
          return montar([c.errores['error-401']!.grabacion])
        default:
          return null // json-roto, pausa y error-limite-gasto son de la API de Anthropic
      }
    },
  }
}

// ───────────────────────── OpenAI · Responses ─────────────────────────

const MODELO_GPT = 'gpt-6.2-sol'
const crearOpenAI = (t: Transporte, extra: Partial<OpcionesHttp> = {}) => crearProveedorOpenAI({ transporte: t, ...sinEspera, ...extra })

correrContratos(bancoB2({
  nombre: 'openai (Responses)',
  carpeta: 'openai',
  modelo: MODELO_GPT,
  crear: (t, extra) => crearOpenAI(t, extra),
  destino: 'https://api.openai.com',
  rutaBase: 'https://api.openai.com/v1/responses',
  texto: { texto: 'La tarjeta RC-12 está en «Pendientes» y no tiene responsable.', uso: { entrada: 1210, salida: 64, cacheLectura: 0, cacheEscritura: 0 } },
  herramienta: { id: 'call_leer_01', argumentos: { tarjeta: 'RC-12' } },
  dos: ['call_leer_a', 'call_leer_b'],
  cortes: { cache: 'uso-cache', largo: 'largo', rechazo: 'rechazo', 'largo-herramienta-cortada': 'argumentos-cortados' },
  errores: {
    'error-401': { grabacion: 'error-401', tipo: 'clave', reintentable: false },
    'error-429': { grabacion: 'error-429-larga', tipo: 'limite', reintentable: true, esperarMs: 45_000 },
    'error-saldo': { grabacion: 'error-429-cuota', tipo: 'saldo', reintentable: false },
    'error-529': { grabacion: 'error-503', tipo: 'sobrecarga', reintentable: true },
    'error-500': { grabacion: 'error-500', tipo: 'sobrecarga', reintentable: true },
    'error-400': { grabacion: 'error-400-largo', tipo: 'pedido', reintentable: false },
    'error-flujo-cortado': { grabacion: 'stream-cortado', tipo: 'red', reintentable: true },
  },
  reintento429: { grabacion: 'error-429-espera', esperaEnLineaMaxMs: 60_000 },
  modelos: ['gpt-6-luna', 'gpt-6.2-sol'],
}))

describe('openai · lo propio de Responses', () => {
  const g = (caso: string) => leerGrabacion('openai', caso)
  const crear = (cola: Grabacion[], visto: Visto[] = [], extra: Partial<OpcionesHttp> = {}) => crearOpenAI(transporteGrabado(cola, visto), extra)

  test('el cuerpo: store false, include del razonamiento cifrado, developer primero, herramientas no estrictas', async () => {
    const visto: Visto[] = []
    const p = crear([g('texto')], visto)
    await p.llamar(pedidoDe(p, { modelo: MODELO_GPT, esfuerzo: 'medio', maxSalida: 999_999 }))
    const b = JSON.parse(visto[0]!.cuerpo)
    assert.equal(b.model, MODELO_GPT)
    assert.equal(b.store, false)
    assert.equal(b.stream, true)
    assert.deepEqual(b.include, ['reasoning.encrypted_content'])
    assert.equal(b.max_output_tokens, 128_000, 'se acota a lo que el modelo admite')
    assert.deepEqual(b.reasoning, { effort: 'medium' })
    assert.equal(b.parallel_tool_calls, true)
    assert.deepEqual(b.input[0], { role: 'developer', content: 'Sos una IA de prueba.\n\nContestá corto.' })
    assert.equal(b.input[1].role, 'user')
    assert.deepEqual(b.input[1].content, [{ type: 'input_text', text: 'Qué hay en RC-12?' }])
    assert.equal(b.tools.length, 2)
    assert.deepEqual(Object.keys(b.tools[0]).sort(), ['description', 'name', 'parameters', 'strict', 'type'])
    assert.equal(b.tools[0].type, 'function')
    assert.equal(b.tools[0].strict, false)
    assert.equal('$schema' in b.tools[0].parameters, false)
    assert.equal(b.tools[0].parameters.additionalProperties, false)
    assert.equal(visto[0]!.url.includes('?'), false)
  })

  test('un modelo que no razona no recibe «reasoning»', async () => {
    const visto: Visto[] = []
    const p = crear([g('texto')], visto)
    await p.llamar(pedidoDe(p, { modelo: 'gpt-4.1', esfuerzo: 'alto' }))
    assert.equal('reasoning' in JSON.parse(visto[0]!.cuerpo), false)
  })

  test('reenvío: el ítem de razonamiento cifrado vuelve idéntico y los resultados llevan su call_id', async () => {
    const visto: Visto[] = []
    const p = crear([g('herramienta'), g('texto')], visto)
    const u = p.aNativo(usuario('hola'), { modelo: MODELO_GPT })
    const r1 = await p.llamar(pedidoDe(p, { modelo: MODELO_GPT, historial: [u] }))
    const original = g('herramienta').respuesta.eventos!.at(-1)!.data as any
    assert.deepEqual(JSON.parse(r1.nativo), original.response.output)
    const res = p.aNativo(resultado('call_leer_01', 'leer_tarjeta', 'listo'), { modelo: MODELO_GPT })
    await p.llamar(pedidoDe(p, { modelo: MODELO_GPT, historial: [u, r1.nativo, res] }))
    const input = JSON.parse(visto[1]!.cuerpo).input
    assert.deepEqual(input.slice(2, 4), original.response.output)
    assert.deepEqual(input[4], { type: 'function_call_output', call_id: 'call_leer_01', output: 'listo' })
    assert.equal(input[2].encrypted_content, 'gAAAAABrazonamientoCifrado02==')
  })

  test('uso con caché: lo leído y lo escrito salen de «entrada»', async () => {
    const p = crear([g('uso-cache')])
    const r = await p.llamar(pedidoDe(p, { modelo: MODELO_GPT }))
    assert.deepEqual(r.uso, { entrada: 10000 - 2048 - 4096, salida: 12, cacheLectura: 2048, cacheEscritura: 4096 })
    assert.equal(r.idPedido, 'resp_grabada_01')
  })

  test('corte por largo con texto parcial, rechazo y respuesta de JSON entero', async () => {
    let p = crear([g('largo')])
    let r = await p.llamar(pedidoDe(p, { modelo: MODELO_GPT }))
    assert.equal(r.corte, 'largo')
    assert.match(r.texto, /sigu$/)
    p = crear([g('rechazo')])
    r = await p.llamar(pedidoDe(p, { modelo: MODELO_GPT }))
    assert.equal(r.corte, 'rechazo')
    assert.equal(r.texto, 'No puedo ayudar con eso.')
    p = crear([g('json-sin-streaming')])
    r = await p.llamar(pedidoDe(p, { modelo: MODELO_GPT }))
    assert.equal(r.corte, 'fin')
    assert.equal(r.uso.entrada, 100)
  })

  test('el streaming que se corta sin cierre y el que falla adentro son errores de red y de servidor', async () => {
    let p = crear([g('stream-cortado')])
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: MODELO_GPT })), (e: ErrorProveedor) => e.tipo === 'red' && e.reintentable)
    p = crear([g('falla-en-stream')])
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: MODELO_GPT })), (e: ErrorProveedor) => e.tipo === 'sobrecarga' && e.reintentable)
  })

  test('errores de OpenAI: 429 con espera larga, sin saldo, saturado, modelo inexistente', async () => {
    let p = crear([g('error-429-larga')])
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: MODELO_GPT })), (e: ErrorProveedor) => e.tipo === 'limite' && e.reintentable && e.esperarMs === 45_000)
    p = crear([g('error-429-cuota')])
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: MODELO_GPT })), (e: ErrorProveedor) => e.tipo === 'saldo' && !e.reintentable)
    p = crear([g('error-503')])
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: MODELO_GPT })), (e: ErrorProveedor) => e.tipo === 'sobrecarga' && e.reintentable)
    p = crear([g('error-404-modelo')])
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: 'gpt-9' })), (e: ErrorProveedor) => e.tipo === 'pedido' && /gpt-9/.test(e.paraLaPersona))
    p = crear([g('error-400-largo')])
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: MODELO_GPT })), (e: ErrorProveedor) => e.tipo === 'pedido' && /demasiado larga/.test(e.paraLaPersona))
  })

  test('el 401 repite la clave en su mensaje y no se cuela en ningún lado', async () => {
    const p = crear([g('error-401')])
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: MODELO_GPT })), (e: ErrorProveedor) => {
      assert.ok(g('error-401').respuesta.cuerpo !== undefined && JSON.stringify(g('error-401').respuesta.cuerpo).includes(CLAVE), 'la grabación tiene que repetir la clave')
      assert.equal(rastro(e).includes(CLAVE), false)
      assert.match(e.paraLaPersona, /clave de OpenAI no anda/)
      assert.equal(e.idPedido, 'req_grabado_0001')
      return true
    })
  })

  test('nativos: usuario con imagen, nota del sistema, resultado con imagen', () => {
    const u = JSON.parse(nativoOpenAI({ rol: 'usuario', partes: [{ tipo: 'texto', texto: 'a' }, { tipo: 'imagen', mime: 'image/png', ruta: 'x/y.png' }] }))
    assert.deepEqual(u, [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'a' }, { type: 'input_image', image_url: 'telar-imagen:image/png;x/y.png' }] }])
    assert.deepEqual(JSON.parse(nativoOpenAI({ rol: 'sistema', texto: 'ojo' })), [{ type: 'message', role: 'developer', content: 'ojo' }])
    const r = JSON.parse(nativoOpenAI({ rol: 'herramienta', resultados: [{ id: 'c1', nombre: 'ver', esError: true, partes: [{ tipo: 'texto', texto: 'no' }, { tipo: 'imagen', mime: 'image/png', ruta: 'i.png' }] }] }))
    assert.equal(r[0].call_id, 'c1')
    assert.equal(r[0].output[1].type, 'input_image')
    const a = JSON.parse(nativoOpenAI({ rol: 'asistente', texto: 'hola', llamadas: [{ id: 'c2', nombre: 'leer_tarjeta', argumentos: { tarjeta: 'RC-1' } }] }))
    assert.equal(a[1].arguments, '{"tarjeta":"RC-1"}')
  })

  test('probar: lista los modelos de chat y avisa si la clave no llega al modelo; un 401 no trae la clave', async () => {
    let p = crear([g('modelos')])
    assert.deepEqual(await p.probar({ clave: CLAVE }), { ok: true, modelos: ['gpt-6-luna', 'gpt-6.2-sol'] })
    p = crear([g('modelos')])
    const sin = await p.probar({ clave: CLAVE, modelo: 'gpt-9' })
    assert.equal(sin.ok, false)
    p = crear([g('error-401')])
    const mal = await p.probar({ clave: CLAVE })
    assert.equal(mal.ok, false)
    assert.equal(JSON.stringify(mal).includes(CLAVE), false)
    assert.match(mal.error ?? '', /no anda/)
  })

  test('la dirección es siempre api.openai.com: «urlBase» del pedido se ignora', async () => {
    const visto: Visto[] = []
    const p = crear([g('texto')], visto)
    await p.llamar(pedidoDe(p, { modelo: MODELO_GPT, urlBase: 'https://evil.example.com/v1' }))
    assert.equal(new URL(visto[0]!.url).host, 'api.openai.com')
  })

  test('capacidades: los GPT-6 ven imágenes (también en resultados) y tienen 1.050.000 de contexto', () => {
    const p = crearOpenAI(transporteGrabado([], []))
    assert.deepEqual(p.capacidades('gpt-6.2-sol'), { imagenes: true, imagenesEnResultados: true, contexto: 1_050_000, salidaMax: 128_000 })
    assert.equal(p.capacidades('modelo-raro').contexto, 128_000)
  })
})

// ───────────────────────── DeepSeek · Chat Completions ─────────────────────────

const URL_DEEPSEEK = 'https://api.deepseek.com'
const MODELO_DS = 'deepseek-flash'
/** `online: false` para que no resuelva nombres (no hay internet acá): lo de online se prueba más abajo. */
const crearCompat = (t: Transporte, extra: Record<string, unknown> = {}) => crearProveedorCompatible({ transporte: t, online: false, ...sinEspera, ...extra })
const conUrl = (p: Proveedor, urlBase: string, o: Partial<PedidoModelo> & { modelo: string }) => pedidoDe(p, { urlBase, ...o })

correrContratos(bancoB2({
  nombre: 'compatible · DeepSeek',
  carpeta: 'deepseek',
  modelo: MODELO_DS,
  crear: (t, extra) => crearCompat(t, extra),
  urlBase: URL_DEEPSEEK,
  destino: URL_DEEPSEEK,
  rutaBase: `${URL_DEEPSEEK}/chat/completions`,
  texto: { texto: 'RC-12 está en «Pendientes».', uso: { entrada: 464, salida: 40, cacheLectura: 1536, cacheEscritura: 0 } },
  herramienta: { id: 'call_00_abc123', argumentos: { tarjeta: 'RC-12' } },
  dos: ['call_00_a', 'call_01_b'],
  // la grabación de «dos herramientas» es la del segundo pedido de una conversación: trae lo leído del caché
  cortes: { cache: 'dos-herramientas', 'largo-herramienta-cortada': 'argumentos-cortados' },
  errores: {
    'error-401': { grabacion: 'error-401', tipo: 'clave', reintentable: false },
    'error-saldo': { grabacion: 'error-402-saldo', tipo: 'saldo', reintentable: false },
    'error-529': { grabacion: 'error-503', tipo: 'sobrecarga', reintentable: true },
    'error-400': { grabacion: 'error-400-sin-herramientas', tipo: 'pedido', reintentable: false },
    'error-flujo-cortado': { grabacion: 'error-en-stream', tipo: 'sobrecarga', reintentable: true },
  },
  reintento429: { grabacion: 'error-429' },
  modelos: ['deepseek-flash', 'deepseek-v4-pro'],
}))

describe('compatible · DeepSeek, lo propio', () => {
  const g = (caso: string) => leerGrabacion('deepseek', caso)
  const crear = (cola: Grabacion[], visto: Visto[] = []) => crearCompat(transporteGrabado(cola, visto))

  test('el cuerpo: stream con uso, max_tokens, herramientas en formato de Chat Completions sin «$schema» ni «additionalProperties»', async () => {
    const visto: Visto[] = []
    const p = crear([g('texto')], visto)
    await p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS, esfuerzo: 'bajo' }))
    const b = JSON.parse(visto[0]!.cuerpo)
    assert.equal(b.model, MODELO_DS)
    assert.equal(b.stream, true)
    assert.deepEqual(b.stream_options, { include_usage: true })
    assert.equal(b.max_tokens, 4_000)
    assert.equal(b.reasoning_effort, 'low')
    assert.deepEqual(b.messages[0], { role: 'system', content: 'Sos una IA de prueba.\n\nContestá corto.' })
    assert.deepEqual(b.messages[1], { role: 'user', content: 'Qué hay en RC-12?' })
    assert.equal(b.tools[0].type, 'function')
    assert.deepEqual(Object.keys(b.tools[0].function).sort(), ['description', 'name', 'parameters'])
    assert.equal('$schema' in b.tools[0].function.parameters, false)
    assert.equal('additionalProperties' in b.tools[0].function.parameters, false)
    assert.deepEqual(b.tools[0].function.parameters.required, ['tarjeta'])
    assert.equal(b.parallel_tool_calls, undefined)
    assert.equal(visto[0]!.url, `${URL_DEEPSEEK}/chat/completions`)
  })

  test('reasoning_content vuelve tal cual (si falta con herramientas, DeepSeek da 400)', async () => {
    const visto: Visto[] = []
    const p = crear([g('herramienta'), g('texto')], visto)
    const u = p.aNativo(usuario('hola'), { modelo: MODELO_DS })
    const r1 = await p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS, historial: [u] }))
    const msg = JSON.parse(r1.nativo)
    assert.deepEqual(msg, {
      role: 'assistant',
      content: null,
      reasoning_content: 'Necesito leer la tarjeta.',
      tool_calls: [{ id: 'call_00_abc123', type: 'function', function: { name: 'leer_tarjeta', arguments: '{"tarjeta":"RC-12"}' } }],
    })
    await p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS, historial: [u, r1.nativo, p.aNativo(resultado('call_00_abc123', 'leer_tarjeta', 'ok'), { modelo: MODELO_DS })] }))
    const m = JSON.parse(visto[1]!.cuerpo).messages
    assert.deepEqual(m[2], msg)
    assert.deepEqual(m[3], { role: 'tool', tool_call_id: 'call_00_abc123', content: 'ok' })
  })

  test('texto con razonamiento: el razonamiento no es el texto, pero queda para reenviar', async () => {
    const p = crear([g('texto')])
    const r = await p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS }))
    assert.equal(JSON.parse(r.nativo).reasoning_content, 'El usuario pregunta por RC-12. Contesto corto.')
    assert.equal(r.texto.includes('Contesto'), false)
  })

  test('uso: aciertos y fallos de caché de DeepSeek', async () => {
    const p = crear([g('herramienta'), g('dos-herramientas')])
    assert.deepEqual((await p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS }))).uso, { entrada: 2100, salida: 52, cacheLectura: 0, cacheEscritura: 0 })
    assert.deepEqual((await p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS }))).uso, { entrada: 52, salida: 80, cacheLectura: 2048, cacheEscritura: 0 })
  })

  test('errores de DeepSeek: 402 es saldo; «insufficient_system_resource» y un error en el streaming son reintentables; 429 con espera corta', async () => {
    let p = crear([g('error-402-saldo')])
    await assert.rejects(p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS })), (e: ErrorProveedor) => e.tipo === 'saldo' && !e.reintentable)
    p = crear([g('sin-recursos')])
    await assert.rejects(p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS })), (e: ErrorProveedor) => e.tipo === 'sobrecarga' && e.reintentable)
    p = crear([g('error-en-stream')])
    await assert.rejects(p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS })), (e: ErrorProveedor) => e.tipo === 'sobrecarga' && e.reintentable)
    p = crear([g('error-400-reasoning')])
    await assert.rejects(p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS })), (e: ErrorProveedor) => e.tipo === 'pedido' && !e.reintentable)
  })

  test('un modelo sin herramientas da un error claro', async () => {
    const p = crear([g('error-400-sin-herramientas')])
    await assert.rejects(p.llamar(conUrl(p, 'https://api.groq.com/openai/v1', { modelo: 'gemma:2b' })), (e: ErrorProveedor) => {
      assert.equal(e.tipo, 'pedido')
      assert.match(e.paraLaPersona, /Este modelo no admite herramientas/)
      return true
    })
  })

  test('un servicio que no conoce «stream_options»: se reintenta sin él, una vez', async () => {
    const visto: Visto[] = []
    const p = crear([g('error-400-stream-options'), g('texto')], visto)
    const r = await p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS }))
    assert.equal(r.corte, 'fin')
    assert.equal(visto.length, 2)
    assert.ok('stream_options' in JSON.parse(visto[0]!.cuerpo))
    assert.equal('stream_options' in JSON.parse(visto[1]!.cuerpo), false)
  })

  test('JSON entero (sin streaming): se descartan los campos que solo existen en la respuesta', async () => {
    const p = crear([g('json-sin-streaming')])
    const r = await p.llamar(conUrl(p, URL_DEEPSEEK, { modelo: MODELO_DS }))
    assert.equal(r.texto, 'Hola.')
    assert.deepEqual(JSON.parse(r.nativo), { role: 'assistant', content: 'Hola.' })
    assert.equal(r.uso.salida, 3)
  })

  test('probar: lista modelos con la dirección configurada', async () => {
    const visto: Visto[] = []
    const p = crear([g('modelos')], visto)
    assert.deepEqual(await p.probar({ clave: CLAVE, urlBase: URL_DEEPSEEK }), { ok: true, modelos: ['deepseek-flash', 'deepseek-v4-pro'] })
    assert.equal(visto[0]!.url, `${URL_DEEPSEEK}/models`)
    assert.equal(visto[0]!.metodo, 'GET')
  })

  test('capacidades: Flash ve imágenes y V4 Pro no; lo desconocido, lo prudente', () => {
    assert.equal(capacidadesCompatible('deepseek-flash').imagenes, true)
    assert.equal(capacidadesCompatible('deepseek-v4-pro').imagenes, false)
    assert.deepEqual(capacidadesCompatible('lo-que-sea'), { imagenes: false, imagenesEnResultados: false, contexto: 128_000, salidaMax: 8_000 })
  })
})

// ───────────────────────── Gemini · punto compatible ─────────────────────────

const URL_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/'
const MODELO_GEM = 'gemini-4-hydrogen'

correrContratos(bancoB2({
  nombre: 'compatible · Gemini',
  carpeta: 'gemini',
  modelo: MODELO_GEM,
  crear: (t, extra) => crearCompat(t, extra),
  urlBase: URL_GEMINI,
  destino: 'https://generativelanguage.googleapis.com',
  rutaBase: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  // completion_tokens = 12 pero total_tokens − prompt_tokens = 150: el pensamiento se cobra como salida
  texto: { texto: 'RC-12 está en «Pendientes».', uso: { entrada: 1800, salida: 150, cacheLectura: 0, cacheEscritura: 0 } },
  herramienta: { id: 'abc123def456', argumentos: { tarjeta: 'RC-12' } },
  dos: ['call_a', 'call_b'],
  cortes: { 'largo-herramienta-cortada': 'argumentos-cortados' },
  errores: {
    'error-401': { grabacion: 'error-400-clave', tipo: 'clave', reintentable: false },
    // sin `retry-after` en el encabezado: la espera sale del cuerpo (retryDelay: 33 s), más larga que la de adentro → al ciclo
    'error-429': { grabacion: 'error-429-espera', tipo: 'limite', reintentable: true, esperarMs: 33_000 },
    'error-saldo': { grabacion: 'error-429-por-dia', tipo: 'saldo', reintentable: false },
    'error-529': { grabacion: 'error-503', tipo: 'sobrecarga', reintentable: true },
    'error-400': { grabacion: 'error-400-firma', tipo: 'pedido', reintentable: false },
  },
  // el límite por minuto pide 33 s: entra adentro con un tope de 60 s
  reintento429: { grabacion: 'error-429-espera', esperaEnLineaMaxMs: 60_000 },
  modelos: ['gemini-4-carbon', 'gemini-4-hydrogen'],
}))

describe('compatible · Gemini, lo propio', () => {
  const g = (caso: string) => leerGrabacion('gemini', caso)
  const crear = (cola: Grabacion[], visto: Visto[] = []) => crearCompat(transporteGrabado(cola, visto))

  test('llamadas sin «index» y con la firma de pensamiento: se reenvían enteras', async () => {
    const visto: Visto[] = []
    const p = crear([g('dos-herramientas'), g('texto')], visto)
    const u = p.aNativo(usuario('hola'), { modelo: MODELO_GEM })
    const r1 = await p.llamar(conUrl(p, URL_GEMINI, { modelo: MODELO_GEM, historial: [u] }))
    const msg = JSON.parse(r1.nativo)
    assert.equal(msg.tool_calls.length, 2)
    assert.deepEqual(msg.tool_calls[0].extra_content, { google: { thought_signature: 'CiQBjz1rXprimera-firma==' } })
    assert.equal(msg.tool_calls[1].extra_content, undefined)
    const res = p.aNativo({ rol: 'herramienta', resultados: [
      { id: 'call_a', nombre: 'leer_tarjeta', esError: false, partes: [{ tipo: 'texto', texto: 'uno' }] },
      { id: 'call_b', nombre: 'leer_tablero', esError: false, partes: [{ tipo: 'texto', texto: 'dos' }] },
    ] }, { modelo: MODELO_GEM })
    await p.llamar(conUrl(p, URL_GEMINI, { modelo: MODELO_GEM, historial: [u, r1.nativo, res] }))
    const m = JSON.parse(visto[1]!.cuerpo).messages
    assert.deepEqual(m[2], msg, 'el mensaje del asistente (con la firma) vuelve idéntico')
    assert.deepEqual(m[3], { role: 'tool', tool_call_id: 'call_a', name: 'leer_tarjeta', content: 'uno' }, 'Gemini pide el nombre en la respuesta de la herramienta')
    assert.deepEqual(m[4], { role: 'tool', tool_call_id: 'call_b', name: 'leer_tablero', content: 'dos' })
  })

  test('una llamada sin id recibe uno propio, y es el mismo en el nativo y en la llamada', async () => {
    const p = crear([g('sin-id')])
    const r = await p.llamar(conUrl(p, URL_GEMINI, { modelo: MODELO_GEM }))
    assert.match(r.llamadas[0]!.id, /^call_[0-9a-f]{8}$/)
    assert.equal(JSON.parse(r.nativo).tool_calls[0].id, r.llamadas[0]!.id)
  })

  test('el esfuerzo se manda como reasoning_effort (en Gemini sí existe) y la dirección lleva su «/openai/»', async () => {
    const visto: Visto[] = []
    const p = crear([g('texto')], visto)
    await p.llamar(conUrl(p, URL_GEMINI, { modelo: MODELO_GEM, esfuerzo: 'alto' }))
    assert.equal(JSON.parse(visto[0]!.cuerpo).reasoning_effort, 'high')
    assert.equal(visto[0]!.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
  })

  test('en un servicio que no se conoce, el esfuerzo no se manda', async () => {
    const visto: Visto[] = []
    const p = crear([g('texto')], visto)
    await p.llamar(conUrl(p, 'https://api.groq.com/openai/v1', { modelo: 'llama-x', esfuerzo: 'alto' }))
    assert.equal('reasoning_effort' in JSON.parse(visto[0]!.cuerpo), false)
  })

  test('errores de Gemini: el 400 de clave inválida, el límite por minuto con retryDelay, la cuota del día, el 503', async () => {
    let p = crear([g('error-400-clave')])
    await assert.rejects(p.llamar(conUrl(p, URL_GEMINI, { modelo: MODELO_GEM })), (e: ErrorProveedor) => {
      assert.equal(e.tipo, 'clave')
      assert.equal(rastro(e).includes(CLAVE), false)
      assert.match(e.paraLaPersona, /clave de Gemini/)
      return true
    })
    // sin `retry-after` en el encabezado: la espera sale del cuerpo (retryDelay: 33s), más larga que la de adentro → al ciclo
    p = crear([g('error-429-espera')])
    await assert.rejects(p.llamar(conUrl(p, URL_GEMINI, { modelo: MODELO_GEM })), (e: ErrorProveedor) => e.tipo === 'limite' && e.reintentable && e.esperarMs === 33_000)
    p = crear([g('error-429-por-dia')])
    await assert.rejects(p.llamar(conUrl(p, URL_GEMINI, { modelo: MODELO_GEM })), (e: ErrorProveedor) => e.tipo === 'saldo' && !e.reintentable && /cuota de hoy/.test(e.paraLaPersona))
  })

  test('probar: saca el «models/» de los nombres', async () => {
    const p = crear([g('modelos')])
    assert.deepEqual(await p.probar({ clave: CLAVE, urlBase: URL_GEMINI }), { ok: true, modelos: ['gemini-4-carbon', 'gemini-4-hydrogen'] })
  })

  test('nativo: imágenes de resultados van en un mensaje de usuario aparte (tool solo admite texto)', () => {
    const n = JSON.parse(nativoCompatible({ rol: 'herramienta', resultados: [{ id: 'c1', nombre: 'ver_diseno', esError: false, partes: [{ tipo: 'texto', texto: 'visto' }, { tipo: 'imagen', mime: 'image/png', ruta: 'a.png' }] }] }, { modelo: 'otro' }))
    assert.deepEqual(n[0], { role: 'tool', tool_call_id: 'c1', content: 'visto' })
    assert.equal(n[1].role, 'user')
    assert.equal(n[1].content[0].type, 'text')
    assert.deepEqual(n[1].content[1], { type: 'image_url', image_url: { url: 'telar-imagen:image/png;a.png' } })
    const s = JSON.parse(nativoCompatible({ rol: 'sistema', texto: 'ojo' }, { modelo: 'otro' }))
    assert.equal(s[0].role, 'user')
  })
})

// ───────────────────────── la dirección base (SSRF) ─────────────────────────

describe('dirección base · validarUrlBase', () => {
  const online = (u: string) => validarUrlBase(u, { online: true })
  const local = (u: string) => validarUrlBase(u, { online: false })

  test('online: los servicios de internet con https pasan, normalizados', () => {
    for (const [entrada, esperada] of [
      ['https://api.deepseek.com', 'https://api.deepseek.com'],
      ['https://api.deepseek.com/', 'https://api.deepseek.com'],
      ['https://generativelanguage.googleapis.com/v1beta/openai/', 'https://generativelanguage.googleapis.com/v1beta/openai'],
      ['  https://openrouter.ai/api/v1  ', 'https://openrouter.ai/api/v1'],
      ['https://API.GROQ.com/openai/v1', 'https://api.groq.com/openai/v1'],
      ['https://api.mistral.ai:8443/v1', 'https://api.mistral.ai:8443/v1'],
      ['https://8.8.8.8/v1', 'https://8.8.8.8/v1'],
    ] as const) {
      const r = online(entrada)
      assert.ok(r.ok, `${entrada}: ${r.ok ? '' : r.motivo}`)
      if (r.ok) assert.equal(r.url, esperada)
    }
  })

  test('online: se rechaza todo lo que va a la propia máquina, a una red privada o a los metadatos de la nube', () => {
    const malas = [
      'http://api.deepseek.com',                       // sin https
      'https://localhost', 'https://localhost:11434/v1', 'https://LOCALHOST./v1', 'https://api.localhost',
      'https://127.0.0.1', 'https://127.1', 'https://2130706433', 'https://0x7f.0.0.1', 'https://017700000001', 'https://0.0.0.0', 'https://0',
      'https://10.0.0.5', 'https://172.16.0.1', 'https://172.31.255.255', 'https://192.168.1.10', 'https://100.64.0.1',
      'https://169.254.169.254/latest/meta-data', 'https://169.254.169.254', 'https://100.100.100.200', 'https://metadata.google.internal',
      'https://metadata', 'https://ollama', 'https://servicio.internal', 'https://impresora.local', 'https://x.lan', 'https://x.home.arpa',
      'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[::ffff:7f00:1]', 'https://[fd00:ec2::254]', 'https://[fe80::1]', 'https://[fc00::1]', 'https://[2001:4860:4860::8888]',
      'https://224.0.0.1', 'https://255.255.255.255',
      'ftp://api.deepseek.com', 'file:///etc/passwd', 'javascript:alert(1)',
      'https://usuario:clave@api.deepseek.com', 'https://api.deepseek.com/v1?key=1', 'https://api.deepseek.com/#x',
      '', '   ', 'api.deepseek.com', 'https://', 'https://a b.com',
    ]
    for (const u of malas) assert.equal(online(u).ok, false, `online tenía que rechazar ${JSON.stringify(u)}`)
  })

  test('local: se acepta localhost y la red de la casa (Ollama, LM Studio), con http; nunca los metadatos', () => {
    for (const u of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'https://localhost:8443', 'http://192.168.1.20:11434/v1', 'http://10.0.0.7:8000', 'http://[::1]:11434/v1', 'http://host.docker.internal:11434/v1', 'http://mi-pc.local:1234/v1', 'http://ollama:11434/v1', 'https://api.deepseek.com'])
      assert.ok(local(u).ok, `local tenía que aceptar ${u}`)
    for (const u of ['http://169.254.169.254/latest', 'http://metadata.google.internal/computeMetadata', 'http://100.100.100.200', 'http://[fd00:ec2::254]', 'http://224.0.0.1', 'http://api.deepseek.com', 'http://8.8.8.8/v1', 'ftp://localhost', 'http://user:pass@localhost', 'http://localhost/?x=1'])
      assert.equal(local(u).ok, false, `local tenía que rechazar ${u}`)
  })

  test('los motivos se pueden leer (castellano, sin la clave)', () => {
    const r = online('https://10.0.0.5')
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.motivo, /red privada/)
    const h = online('http://api.deepseek.com')
    if (!h.ok) assert.match(h.motivo, /https/)
  })

  test('categoriaIp: las formas raras de escribir una IP', () => {
    assert.equal(categoriaIp('8.8.8.8'), 'publica')
    assert.equal(categoriaIp('::ffff:8.8.8.8'), 'publica')
    assert.equal(categoriaIp('::ffff:a00:1'), 'privada')
    assert.equal(categoriaIp('64:ff9b::7f00:1'), 'loopback')
    assert.equal(categoriaIp('2002:7f00:1::'), 'loopback')
    assert.equal(categoriaIp('999.1.1.1'), 'reservada')
    assert.equal(categoriaIp('api.deepseek.com'), null)
  })

  test('online también se mira a qué dirección resuelve el nombre', async () => {
    await verificarNombre('api.deepseek.com', false, async () => ['104.18.0.1', '2606:4700::6812:1'])
    for (const mala of [['10.0.0.5'], ['104.18.0.1', '127.0.0.1'], ['::1'], ['169.254.169.254'], [] as string[]])
      await assert.rejects(verificarNombre('x.ejemplo.com', false, async () => mala), (e: ErrorProveedor) => e instanceof ErrorProveedor && e.tipo === 'pedido', JSON.stringify(mala))
    await assert.rejects(verificarNombre('no-existe.ejemplo.com', false, async () => { throw new Error('ENOTFOUND') }), (e: ErrorProveedor) => e.tipo === 'red')
  })

  test('el proveedor online rechaza antes de mandar nada (y no manda nada)', async () => {
    const visto: Visto[] = []
    const t = transporteGrabado([leerGrabacion('deepseek', 'texto')], visto)
    const p = crearProveedorCompatible({ transporte: t, online: true, resolver: async (h) => (h === 'rebinding.ejemplo.com' ? ['10.0.0.9'] : ['104.18.0.1']), ...sinEspera })
    for (const u of ['http://api.deepseek.com', 'https://127.0.0.1:4440/v1', 'https://localhost', 'https://169.254.169.254/latest', 'https://rebinding.ejemplo.com/v1', undefined, ''])
      await assert.rejects(p.llamar(pedidoDe(p, { modelo: MODELO_DS, urlBase: u })), (e: ErrorProveedor) => e.tipo === 'pedido' && !e.reintentable && rastro(e).includes(CLAVE) === false, String(u))
    assert.equal(visto.length, 0, 'no tenía que salir ningún pedido')
    // y una dirección buena sí sale
    const r = await p.llamar(pedidoDe(p, { modelo: MODELO_DS, urlBase: 'https://api.deepseek.com' }))
    assert.equal(r.corte, 'fin')
    assert.equal(visto.length, 1)
    // probar() tampoco sale
    const mal = await p.probar({ clave: CLAVE, urlBase: 'https://192.168.0.1' })
    assert.equal(mal.ok, false)
    assert.equal(visto.length, 1)
  })

  test('sin clave solo se habla con algo de la casa; a un servicio de internet no se le manda un pedido sin clave', async () => {
    const visto: Visto[] = []
    const p = crearProveedorCompatible({ transporte: transporteGrabado([leerGrabacion('deepseek', 'texto'), leerGrabacion('deepseek', 'texto')], visto), online: false, ...sinEspera })
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: MODELO_DS, urlBase: 'https://api.deepseek.com', clave: '' })), (e: ErrorProveedor) => e.tipo === 'clave')
    assert.equal(visto.length, 0)
    await p.llamar(pedidoDe(p, { modelo: 'llama3.1', urlBase: 'http://localhost:11434/v1', clave: '' }))
    assert.equal(visto[0]!.headers.authorization, undefined)
  })

  test('nombreDeHost: nombres para los mensajes', () => {
    assert.equal(nombreDeHost('api.deepseek.com'), 'DeepSeek')
    assert.equal(nombreDeHost('generativelanguage.googleapis.com'), 'Gemini')
    assert.equal(nombreDeHost('openrouter.ai'), 'OpenRouter')
    assert.equal(nombreDeHost('localhost'), 'el servicio local')
    assert.equal(nombreDeHost('api.raro.com'), 'api.raro.com')
  })
})

// ───────────────────────── contra un servidor http local de mentira (red de verdad) ─────────────────────────

describe('red real contra un servidor local de mentira', () => {
  const servidores: http.Server[] = []
  after(async () => { await Promise.all(servidores.map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r(null)) }))) })

  interface Servidor { url: string; puerto: number; pedidos: { metodo: string; ruta: string; headers: http.IncomingHttpHeaders; cuerpo: string }[] }
  async function servir(puerto: number, atender: (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void): Promise<Servidor> {
    const pedidos: Servidor['pedidos'] = []
    const s = http.createServer((req, res) => {
      let cuerpo = ''
      req.on('data', (d) => (cuerpo += d))
      req.on('end', () => {
        pedidos.push({ metodo: req.method ?? '', ruta: req.url ?? '', headers: req.headers, cuerpo })
        atender(req, res, pedidos.length)
      })
    })
    servidores.push(s)
    await new Promise<void>((r) => s.listen(puerto, '127.0.0.1', r))
    return { url: `http://127.0.0.1:${puerto}`, puerto, pedidos }
  }
  const sseDe = (g: Grabacion) => (res: http.ServerResponse) => {
    res.writeHead(g.respuesta.estado, g.respuesta.headers)
    res.end(textoSse(g))
  }
  const local = () => crearProveedorCompatible({ online: false, ...sinEspera })

  test('local: habla por http real con un servidor de la casa (streaming de verdad) y la clave llega solo a él', async () => {
    const g = leerGrabacion('deepseek', 'herramienta')
    const s = await servir(4440, (_q, res) => sseDe(g)(res))
    const p = local()
    const r = await p.llamar(pedidoDe(p, { modelo: 'llama3.1', urlBase: `${s.url}/v1` }))
    assert.equal(r.corte, 'herramientas')
    assert.equal(r.llamadas[0]!.nombre, 'leer_tarjeta')
    assert.equal(s.pedidos.length, 1)
    assert.equal(s.pedidos[0]!.ruta, '/v1/chat/completions')
    assert.equal(s.pedidos[0]!.headers.authorization, `Bearer ${CLAVE}`)
    assert.equal(s.pedidos[0]!.cuerpo.includes(CLAVE), false)
  })

  test('local: probar() contra el servidor', async () => {
    const g = leerGrabacion('deepseek', 'modelos')
    const s = await servir(4441, (_q, res) => { res.writeHead(200, g.respuesta.headers); res.end(JSON.stringify(g.respuesta.cuerpo)) })
    assert.deepEqual(await local().probar({ clave: CLAVE, urlBase: s.url }), { ok: true, modelos: ['deepseek-flash', 'deepseek-v4-pro'] })
  })

  test('probar() cuando el servicio no lista modelos (404): prueba con un pedido de un token', async () => {
    const s = await servir(4442, (q, res) => {
      if (q.url?.endsWith('/models')) { res.writeHead(404, { 'content-type': 'application/json' }); return void res.end('{"error":{"message":"not found"}}') }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"choices":[{"message":{"role":"assistant","content":"h"},"finish_reason":"length"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}')
    })
    assert.equal((await local().probar({ clave: CLAVE, urlBase: s.url, modelo: 'm' })).ok, true)
    assert.equal(s.pedidos.length, 2)
    assert.equal(JSON.parse(s.pedidos[1]!.cuerpo).max_tokens, 1)
    const sin = await local().probar({ clave: CLAVE, urlBase: s.url })
    assert.equal(sin.ok, false)
  })

  test('una redirección no se sigue: el segundo servidor no recibe nada (ni la clave)', async () => {
    const destino = await servir(4443, (_q, res) => { res.writeHead(200); res.end('{}') })
    const origen = await servir(4444, (_q, res) => { res.writeHead(307, { location: `${destino.url}/robado` }); res.end() })
    const p = local()
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: 'm', urlBase: origen.url })), (e: ErrorProveedor) => {
      assert.equal(e.tipo, 'pedido')
      assert.match(e.paraLaPersona, /otra dirección/)
      assert.equal(rastro(e).includes(CLAVE), false)
      return true
    })
    assert.equal(origen.pedidos.length, 1)
    assert.equal(destino.pedidos.length, 0, 'la redirección se siguió y la clave viajó a otro lado')
  })

  test('online: una dirección local se rechaza sin tocar el servidor', async () => {
    const s = await servir(4445, (_q, res) => { res.writeHead(200); res.end('{}') })
    const p = crearProveedorCompatible({ online: true, resolver: async () => ['127.0.0.1'], ...sinEspera })
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: 'm', urlBase: s.url })), (e: ErrorProveedor) => e.tipo === 'pedido')
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: 'm', urlBase: `https://127.0.0.1:${s.puerto}` })), (e: ErrorProveedor) => e.tipo === 'pedido')
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: 'm', urlBase: `https://localhost:${s.puerto}` })), (e: ErrorProveedor) => e.tipo === 'pedido')
    assert.equal(s.pedidos.length, 0)
  })

  test('online: el transporte seguro no se conecta a una dirección privada aunque el nombre la esconda (nombre → 127.0.0.1)', async () => {
    let conexiones = 0
    const tcp = net.createServer((c) => { conexiones++; c.destroy() })
    servidores.push(tcp as unknown as http.Server)
    await new Promise<void>((r) => tcp.listen(4446, '127.0.0.1', r))
    const t = transporteSeguro()
    // `localhost` resuelve a la propia máquina: el socket no se abre
    await assert.rejects(t('https://localhost:4446/v1/chat/completions', { method: 'POST', headers: {}, body: '{}', signal: new AbortController().signal }), (e: unknown) => e instanceof ErrorProveedor && e.tipo === 'pedido')
    await assert.rejects(t('http://api.deepseek.com/v1', { method: 'POST', headers: {}, body: '{}', signal: new AbortController().signal }), (e: unknown) => e instanceof ErrorProveedor)
    assert.equal(conexiones, 0)
  })

  test('online: el transporte seguro sí conecta cuando el destino está permitido (https de verdad, con un certificado propio) y devuelve el streaming', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'telar-tls-'))
    try {
      try {
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' })
      } catch { return }                       // sin openssl en la máquina: se salta
      const cert = readFileSync(path.join(dir, 'c.pem'), 'utf8')
      const g = leerGrabacion('deepseek', 'texto')
      const visto: string[] = []
      const srv = https.createServer({ key: readFileSync(path.join(dir, 'k.pem')), cert }, (req, res) => {
        visto.push(`${req.method} ${req.url} ${req.headers.authorization}`)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const t = textoSse(g)
        res.write(t.slice(0, 100))
        setTimeout(() => res.end(t.slice(100)), 20)
      })
      servidores.push(srv as unknown as http.Server)
      await new Promise<void>((r) => srv.listen(4451, '127.0.0.1', r))
      const t = transporteSeguro({ permitidas: ['publica', 'loopback'], ca: cert })
      const res = await t('https://localhost:4451/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${CLAVE}` }, body: '{}', signal: new AbortController().signal })
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), 'text/event-stream')
      assert.equal(await res.text(), textoSse(g))
      assert.deepEqual(visto, [`POST /v1/chat/completions Bearer ${CLAVE}`])
      // y con el destino sin permitir (lo que pasa online), ni se conecta
      await assert.rejects(transporteSeguro({ ca: cert })('https://localhost:4451/x', { method: 'GET', headers: {}, signal: new AbortController().signal }), (e: unknown) => e instanceof ErrorProveedor)
      assert.equal(visto.length, 1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('el servidor caído es un error de red reintentable', async () => {
    const p = local()
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: 'm', urlBase: 'http://127.0.0.1:4459' })), (e: ErrorProveedor) => e.tipo === 'red' && e.reintentable && !rastro(e).includes(CLAVE))
  })

  test('un servidor que no manda datos: corta por tiempo; y la señal de aborto también', async () => {
    const s = await servir(4447, (_q, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders() })
    const p = crearProveedorCompatible({ online: false, ...sinEspera, ociosoMs: 150 })
    const t0 = Date.now()
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: 'm', urlBase: s.url })), (e: ErrorProveedor) => e.tipo === 'tiempo' && e.reintentable)
    assert.ok(Date.now() - t0 < 3_000)
    const ac = new AbortController()
    const p2 = crearProveedorCompatible({ online: false, ...sinEspera, ociosoMs: 30_000 })
    setTimeout(() => ac.abort(), 100)
    await assert.rejects(p2.llamar(pedidoDe(p2, { modelo: 'm', urlBase: s.url, senal: ac.signal })), (e: ErrorProveedor) => e.tipo === 'tiempo')
  })

  test('un corte de conexión a mitad del streaming es un error de red', async () => {
    const s = await servir(4448, (_q, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"Hol"}}]}\n\n'); setTimeout(() => res.destroy(), 30) })
    const p = local()
    await assert.rejects(p.llamar(pedidoDe(p, { modelo: 'm', urlBase: s.url })), (e: ErrorProveedor) => e.tipo === 'red' && e.reintentable)
  })

  test('429 con retry-after de 0 s: se reintenta adentro y sale bien', async () => {
    const g = leerGrabacion('deepseek', 'texto')
    const s = await servir(4449, (_q, res, n) => {
      if (n === 1) { res.writeHead(429, { 'retry-after': '0', 'content-type': 'application/json' }); return void res.end('{"error":{"message":"slow down","code":"rate_limit"}}') }
      sseDe(g)(res)
    })
    const p = local()
    const r = await p.llamar(pedidoDe(p, { modelo: 'm', urlBase: s.url }))
    assert.equal(r.corte, 'fin')
    assert.equal(s.pedidos.length, 2)
  })

  test('OpenAI contra un servidor local (solo para probar): streaming de Responses de verdad', async () => {
    const g = leerGrabacion('openai', 'dos-herramientas')
    const s = await servir(4450, (_q, res) => sseDe(g)(res))
    const p = crearProveedorOpenAI({ urlBase: `${s.url}/v1`, ...sinEspera })
    const r = await p.llamar(pedidoDe(p, { modelo: MODELO_GPT }))
    assert.deepEqual(r.llamadas.map((l) => l.id), ['call_leer_a', 'call_leer_b'])
    assert.equal(s.pedidos[0]!.ruta, '/v1/responses')
    assert.equal(s.pedidos[0]!.headers.authorization, `Bearer ${CLAVE}`)
  })
})

// ───────────────────────── piezas: esperas, claves, SSE ─────────────────────────

describe('piezas de http-ia', () => {
  test('duracionAMs y esperaDe', () => {
    assert.equal(duracionAMs('33s'), 33_000)
    assert.equal(duracionAMs('6m0s'), 360_000)
    assert.equal(duracionAMs('20ms'), 20)
    assert.equal(duracionAMs('1.5s'), 1_500)
    assert.equal(duracionAMs('mañana'), undefined)
    assert.equal(esperaDe(new Headers({ 'retry-after': '7' })), 7_000)
    assert.equal(esperaDe(new Headers({ 'retry-after-ms': '250' })), 250)
    assert.equal(esperaDe(new Headers({ 'retry-after': new Date(Date.now() + 5_000).toUTCString() }), Date.now())! > 3_000, true)
    assert.equal(esperaDe(new Headers({ 'x-ratelimit-reset-requests': '1s', 'x-ratelimit-reset-tokens': '6m0s' })), 360_000)
    assert.equal(esperaDe(new Headers({ 'retry-after': '99999' })), 600_000, 'acotada a 10 minutos')
    assert.equal(esperaDe(new Headers()), undefined)
  })

  test('filtrarClaves saca la clave, las de formato conocido y los Bearer', () => {
    const t = filtrarClaves(`falló con ${CLAVE} y AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMY12345 y Authorization: Bearer abcdefghijklmnop.qrstuvwxyz y gsk_abcdefghijklmnopqrstuv`, [CLAVE])
    assert.equal(/sk-prueba|AIzaSy|abcdefghijklmnop|gsk_/.test(t), false)
  })

  test('clasificarHttp: lo que no se entiende es un error de pedido, con el código y sin el texto del proveedor', () => {
    const e = clasificarHttp(418, '<html>soy una tetera con tu pedido: Qué hay en RC-12?</html>', new Headers(), { proveedor: 'X' })
    assert.equal(e.tipo, 'pedido')
    assert.equal(e.message.includes('RC-12'), false)
    assert.equal(e.paraLaPersona.includes('RC-12'), false)
    const r = clasificarHttp(302, '', new Headers({ location: 'https://evil.example.com/?k=1' }), { proveedor: 'X' })
    assert.equal(JSON.stringify([r.message, r.paraLaPersona]).includes('evil'), false)
  })

  test('leerSse: comentarios, CRLF, líneas data partidas y cierre sin línea en blanco', async () => {
    const texto = ': keep-alive\r\n\r\nevent: uno\r\ndata: {"a":\r\ndata: 1}\r\n\r\ndata: dos\n\ndata: tres'
    const res = new Response(trozos(texto, 5))
    const o = { transporte: async () => res, ociosoMs: 1_000, esperaEnLineaMaxMs: 0, reintentosEnLinea: 0, dormir: async () => {} } satisfies OpcionesHttp
    const vistos: unknown[] = []
    for await (const ev of leerSse(res, o, new AbortController().signal, { proveedor: 'X' })) vistos.push(ev)
    assert.deepEqual(vistos, [{ evento: 'uno', datos: '{"a":\n1}' }, { evento: null, datos: 'dos' }, { evento: null, datos: 'tres' }])
  })
})

// ───────────────────────── precios y preajustes (6.3) ─────────────────────────

describe('precios y preajustes', () => {
  test('los precios verificados el 25/11/2026 (si alguien los toca, esta prueba obliga a mirar la fuente)', () => {
    const p = (modelo: string) => PRECIOS_B2.find((x) => x.modelo === modelo)!
    assert.deepEqual([p('gpt-6.2-sol').entrada, p('gpt-6.2-sol').salida, p('gpt-6.2-sol').cacheLectura, p('gpt-6.2-sol').cacheEscritura], [2, 10, 0.1, 2.5])
    assert.deepEqual([p('gpt-6.2-astra').entrada, p('gpt-6.2-astra').salida], [8, 40])
    assert.deepEqual([p('gpt-6.1-terra').entrada, p('gpt-6.1-terra').salida], [1, 5])
    assert.deepEqual([p('gpt-6-luna').entrada, p('gpt-6-luna').salida, p('gpt-6-luna').cacheLectura], [0.1, 0.5, 0.01])
    assert.deepEqual(p('gpt-6.2-sol').desde, { tokensEntrada: 272_000, entrada: 4, salida: 15 })
    assert.deepEqual([p('gemini-4-hydrogen').entrada, p('gemini-4-hydrogen').salida, p('gemini-4-hydrogen').cacheLectura], [1.5, 7.5, 0.075])
    assert.deepEqual([p('gemini-4-carbon').entrada, p('gemini-4-carbon').salida], [2, 10])
    assert.deepEqual(p('gemini-4-carbon').cambia, { desde: '2026-12-01', entrada: 4, salida: 20, cacheLectura: 0.2 })
    assert.deepEqual(p('gemini-3.8-flash').cambia, { desde: '2027-01-01', entrada: 1.5, salida: 7.5, cacheLectura: 0.15 })
    assert.deepEqual([p('gemini-3.5-flash-lite').entrada, p('gemini-3.5-flash-lite').salida], [0.3, 2.5])
    assert.deepEqual([p('deepseek-flash').entrada, p('deepseek-flash').salida, p('deepseek-flash').cacheLectura], [0.15, 0.6, 0.003])
    assert.deepEqual([p('deepseek-v4-pro').entrada, p('deepseek-v4-pro').salida, p('deepseek-v4-pro').cacheLectura], [0.66, 1.98, 0.022])
    assert.deepEqual(p('deepseek-flash').franjas, [
      { dias: [1, 2, 3, 4, 5], desdeUtc: '01:00', hastaUtc: '04:00', por: 2 },
      { dias: [1, 2, 3, 4, 5], desdeUtc: '06:00', hastaUtc: '10:00', por: 2 },
    ])
  })

  test('cada precio lleva su fecha y su fuente, y los de compatible su host', () => {
    for (const p of PRECIOS_B2) {
      assert.match(p.verificado, /^\d{4}-\d{2}-\d{2}$/, p.modelo)
      assert.match(p.fuente, /^https:\/\//, p.modelo)
      assert.ok(p.entrada > 0 && p.salida > 0 && p.cacheLectura >= 0 && p.cacheEscritura >= 0, p.modelo)
      assert.ok(p.cacheLectura <= p.entrada, `${p.modelo}: leer caché no puede costar más que la entrada`)
      if (p.proveedor === 'compatible') assert.ok(p.host, p.modelo)
    }
    assert.equal(new Set(PRECIOS_B2.map((p) => `${p.proveedor}/${p.host ?? ''}/${p.modelo}`)).size, PRECIOS_B2.length)
  })

  test('cada modelo de cada preajuste tiene precio, y su dirección pasa la validación online', () => {
    assert.deepEqual(PREAJUSTES_IA.map((p) => p.id), ['gpt', 'gemini', 'deepseek', 'otro'])
    for (const pre of PREAJUSTES_IA) {
      if (pre.exigePrecios) continue
      assert.ok(pre.modeloSugerido && pre.modelos.some((m) => m.id === pre.modeloSugerido), pre.id)
      if (pre.urlBase) assert.ok(validarUrlBase(pre.urlBase, { online: true }).ok, pre.id)
      for (const m of pre.modelos) {
        const precio = precioConocido({ proveedor: pre.proveedor, modelo: m.id, urlBase: pre.urlBase })
        assert.ok(precio, `${pre.id}/${m.id} sin precio`)
        const cap = pre.proveedor === 'openai' ? crearProveedorOpenAI().capacidades(m.id) : capacidadesCompatible(m.id)
        assert.equal(cap.imagenes, m.veImagenes, `${pre.id}/${m.id}: el preajuste y las capacidades no coinciden en las imágenes`)
      }
    }
    const gem = PREAJUSTES_IA.find((p) => p.id === 'gemini')!
    assert.match(gem.aviso ?? '', /nivel gratis/)
    assert.match(gem.aviso ?? '', /mejorar/)
    const otro = PREAJUSTES_IA.find((p) => p.id === 'otro')!
    assert.equal(otro.exigePrecios, true)
    assert.equal(otro.pideUrlBase, true)
    assert.equal(otro.urlBase, null)
  })

  test('«Otro» sin precios: error tipado y el agente no se puede activar', () => {
    assert.throws(() => precioDelAgente({ proveedor: 'compatible', modelo: 'mistral-large', urlBase: 'https://api.mistral.ai/v1', precioManual: null }), (e: unknown) => {
      assert.ok(e instanceof ErrorSinPrecio)
      assert.equal((e as ErrorSinPrecio).codigo, 'sin_precio')
      assert.match((e as ErrorSinPrecio).paraLaPersona, /Escribí cuánto cuesta/)
      return true
    })
    // un modelo de OpenAI que no está en la tabla tampoco puede activarse a ciegas
    assert.throws(() => precioDelAgente({ proveedor: 'openai', modelo: 'gpt-7', precioManual: null }), ErrorSinPrecio)
    // los precios de DeepSeek no valen para otro servicio con el mismo nombre de modelo
    assert.throws(() => precioDelAgente({ proveedor: 'compatible', modelo: 'deepseek-flash', urlBase: 'https://otro.ejemplo.com/v1' }), ErrorSinPrecio)
  })

  test('con precios a mano sí; el cero vale (un modelo local es gratis); lo que no es un precio no vale', () => {
    const m = precioDelAgente({ proveedor: 'compatible', modelo: 'mistral-large', urlBase: 'https://api.mistral.ai/v1', precioManual: { entrada: 2, salida: 6, cacheLectura: 0.2 } })
    assert.deepEqual([m.entrada, m.salida, m.cacheLectura, m.cacheEscritura, m.verificado], [2, 6, 0.2, 2, 'a mano'])
    assert.equal(precioDelAgente({ proveedor: 'compatible', modelo: 'llama3.1', urlBase: 'http://localhost:11434/v1', precioManual: { entrada: 0, salida: 0, cacheLectura: 0 } }).salida, 0)
    for (const mal of [{ entrada: -1, salida: 1, cacheLectura: 0 }, { entrada: NaN, salida: 1, cacheLectura: 0 }, { entrada: 1, salida: Infinity, cacheLectura: 0 }, { entrada: 1, salida: 1, cacheLectura: 5000 }, { entrada: '1', salida: 1, cacheLectura: 0 } as never])
      assert.throws(() => precioDelAgente({ proveedor: 'compatible', modelo: 'x', urlBase: 'https://api.x.com', precioManual: mal }), ErrorSinPrecio)
  })

  test('lo conocido gana sobre lo escrito a mano, y el prefijo «models/» de Gemini no estorba', () => {
    const p = precioDelAgente({ proveedor: 'compatible', modelo: 'models/gemini-4-hydrogen', urlBase: URL_GEMINI, precioManual: { entrada: 99, salida: 99, cacheLectura: 99 } })
    assert.equal(p.entrada, 1.5)
    assert.equal(precioDelAgente({ proveedor: 'compatible', modelo: 'deepseek-flash', urlBase: 'https://api.deepseek.com/' }).host, 'api.deepseek.com')
  })
})

// ───────────────────────── de zod al formato de cada uno (9.3) ─────────────────────────

describe('herramientas: de zod al formato de cada uno', () => {
  test('el esquema de zod trae «$schema» y «additionalProperties: false» (lo que cada adaptador limpia)', () => {
    const e = herramientas[0]!.esquema as any
    assert.equal(typeof e.$schema, 'string')
    assert.equal(e.additionalProperties, false)
  })

  test('prepararFijo es determinístico (el caché depende de que sea igual todas las veces)', () => {
    const o = crearOpenAI(transporteGrabado([], []))
    const c = crearCompat(transporteGrabado([], []))
    for (const p of [o, c]) {
      const a = p.prepararFijo({ sistema: [{ texto: 'a' }], herramientas, modelo: 'm' })
      assert.equal(a, p.prepararFijo({ sistema: [{ texto: 'a' }], herramientas, modelo: 'm' }))
      assert.doesNotThrow(() => JSON.parse(a))
    }
  })

  test('sin instrucciones ni herramientas el pedido igual es válido', async () => {
    const visto: Visto[] = []
    const o = crearOpenAI(transporteGrabado([leerGrabacion('openai', 'texto')], visto))
    await o.llamar(pedidoDe(o, { modelo: MODELO_GPT, fijo: o.prepararFijo({ sistema: [], herramientas: [], modelo: MODELO_GPT }) }))
    const b = JSON.parse(visto[0]!.cuerpo)
    assert.equal('tools' in b, false)
    assert.equal(b.input[0].role, 'user')
    const c = crearCompat(transporteGrabado([leerGrabacion('deepseek', 'texto')], visto))
    await c.llamar(pedidoDe(c, { modelo: MODELO_DS, urlBase: URL_DEEPSEEK, fijo: c.prepararFijo({ sistema: [], herramientas: [], modelo: MODELO_DS }) }))
    const b2 = JSON.parse(visto[1]!.cuerpo)
    assert.equal('tools' in b2, false)
    assert.equal(b2.messages[0].role, 'user')
  })

  test('un historial dañado no se manda: error claro', async () => {
    const o = crearOpenAI(transporteGrabado([leerGrabacion('openai', 'texto')], []))
    await assert.rejects(o.llamar(pedidoDe(o, { modelo: MODELO_GPT, historial: ['esto no es json'] })), (e: ErrorProveedor) => e.tipo === 'pedido' && /dañada/.test(e.paraLaPersona))
    await assert.rejects(o.llamar(pedidoDe(o, { modelo: MODELO_GPT, fijo: '{"x":1}' })), (e: ErrorProveedor) => e.tipo === 'pedido' && /dañado/.test(e.paraLaPersona))
  })
})
