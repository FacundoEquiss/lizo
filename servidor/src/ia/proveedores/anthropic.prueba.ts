// Pruebas propias del adaptador de Anthropic: la forma exacta de lo que le manda a la API (lo fijo con su marca de caché, la
// conversación, los encabezados, lo que NO manda) y que no use nada del entorno de quien lo corre. Lo que es igual para todos
// los proveedores está en contratos.prueba.ts. `npm run ia:probar-contratos`. Sin red y sin gastar.
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import type { PedidoModelo } from '../tipos'
import { crearProveedorAnthropic } from './anthropic'
import { armarAnthropicGrabado } from './reproducir'

const CLAVE = 'sk-ant-api03-CLAVE_DE_PRUEBA_otra_0123456789abcdef'
const SISTEMA = [{ texto: 'Primero.' }, { texto: 'Segundo.' }]
const HERRAMIENTAS = [
  { nombre: 'a', descripcion: 'Una.', esquema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {} } },
  { nombre: 'b', descripcion: 'Otra.', esquema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } },
]

function pedido(g: { proveedor: ReturnType<typeof crearProveedorAnthropic> }, extra: Partial<PedidoModelo> = {}): PedidoModelo {
  return {
    modelo: 'claude-opus-5-5',
    maxSalida: 4096,
    fijo: g.proveedor.prepararFijo({ sistema: SISTEMA, herramientas: HERRAMIENTAS, modelo: 'claude-opus-5-5' }),
    historial: [g.proveedor.aNativo({ rol: 'usuario', partes: [{ tipo: 'texto', texto: 'Tarjeta RC-12: ¿qué falta?' }] }, { modelo: 'claude-opus-5-5' })],
    clave: CLAVE,
    senal: new AbortController().signal,
    leerImagen: async () => new Uint8Array(),
    ...extra,
  }
}

const entorno = { ...process.env }
afterEach(() => {
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_PROFILE']) {
    if (entorno[k] === undefined) delete process.env[k]
    else process.env[k] = entorno[k]
  }
})

describe('anthropic · lo fijo del trabajo', () => {
  const p = crearProveedorAnthropic()

  test('la marca de caché va al final de lo último de lo fijo: el último bloque de sistema', () => {
    const fijo = JSON.parse(p.prepararFijo({ sistema: SISTEMA, herramientas: HERRAMIENTAS, modelo: 'claude-opus-5-5' })) as { system: Record<string, unknown>[]; tools: Record<string, unknown>[] }
    assert.deepEqual(fijo.system, [{ type: 'text', text: 'Primero.' }, { type: 'text', text: 'Segundo.', cache_control: { type: 'ephemeral' } }])
    assert.ok(fijo.tools.every((t) => t.cache_control === undefined), 'las herramientas se guardan con el sistema, con una sola marca')
  })

  test('las herramientas van como { name, description, input_schema } y sin $schema', () => {
    const fijo = JSON.parse(p.prepararFijo({ sistema: SISTEMA, herramientas: HERRAMIENTAS, modelo: 'claude-opus-5-5' })) as { tools: { name: string; description: string; input_schema: Record<string, unknown> }[] }
    assert.deepEqual(fijo.tools.map((t) => t.name), ['a', 'b'])
    assert.equal(fijo.tools[0]!.description, 'Una.')
    assert.deepEqual(fijo.tools[0]!.input_schema, { type: 'object', properties: {} })
    assert.deepEqual(Object.keys(fijo.tools[1]!.input_schema).sort(), ['properties', 'required', 'type'])
  })

  test('sin instrucciones, la marca va en la última herramienta; sin nada, no hay nada', () => {
    const solo = JSON.parse(p.prepararFijo({ sistema: [], herramientas: HERRAMIENTAS, modelo: 'm' })) as { system?: unknown; tools: { cache_control?: unknown }[] }
    assert.equal(solo.system, undefined)
    assert.equal(solo.tools[0]!.cache_control, undefined)
    assert.deepEqual(solo.tools[1]!.cache_control, { type: 'ephemeral' })
    assert.deepEqual(JSON.parse(p.prepararFijo({ sistema: [], herramientas: [], modelo: 'm' })), {})
  })

  test('lo fijo es el mismo siempre (el caché depende de que no cambie un byte)', () => {
    const a = p.prepararFijo({ sistema: SISTEMA, herramientas: HERRAMIENTAS, modelo: 'claude-opus-5-5' })
    assert.equal(p.prepararFijo({ sistema: SISTEMA, herramientas: HERRAMIENTAS, modelo: 'claude-opus-5-5' }), a)
  })
})

describe('anthropic · los mensajes', () => {
  const p = crearProveedorAnthropic()
  const modelo = { modelo: 'claude-opus-5-5' }

  test('la persona: texto, y la imagen como referencia (nunca los bytes)', () => {
    const m = JSON.parse(p.aNativo({ rol: 'usuario', partes: [{ tipo: 'texto', texto: 'Mirá' }, { tipo: 'imagen', mime: 'image/png', ruta: 'c/x/a.png' }] }, modelo))
    assert.deepEqual(m, { role: 'user', content: [{ type: 'text', text: 'Mirá' }, { type: 'image', source: { type: 'telar', ruta: 'c/x/a.png', media_type: 'image/png' } }] })
  })

  test('los resultados de un mismo paso van JUNTOS en un solo mensaje, y el error se marca', () => {
    const m = JSON.parse(
      p.aNativo(
        {
          rol: 'herramienta',
          resultados: [
            { id: 'toolu_1', nombre: 'a', esError: false, partes: [{ tipo: 'texto', texto: 'uno' }] },
            { id: 'toolu_2', nombre: 'b', esError: true, partes: [{ tipo: 'texto', texto: 'falló' }] },
          ],
        },
        modelo,
      ),
    )
    assert.equal(m.role, 'user')
    assert.equal(m.content.length, 2)
    assert.deepEqual(m.content[0], { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'uno' }] })
    assert.deepEqual(m.content[1], { type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: 'falló' }], is_error: true })
  })

  test('un texto vacío no se manda (la API rechaza bloques de texto vacíos)', () => {
    const m = JSON.parse(p.aNativo({ rol: 'herramienta', resultados: [{ id: 't', nombre: 'a', esError: false, partes: [{ tipo: 'texto', texto: '' }] }] }, modelo))
    assert.deepEqual(m.content[0].content, [{ type: 'text', text: '(sin contenido)' }])
  })

  test('una nota de Telar va como texto de la persona, marcada', () => {
    const m = JSON.parse(p.aNativo({ rol: 'sistema', texto: 'No ves imágenes.' }, modelo))
    assert.equal(m.role, 'user')
    assert.match(m.content[0].text, /^\[Nota de Telar\] No ves imágenes\.$/)
  })
})

describe('anthropic · el pedido a la API', () => {
  test('la dirección, los encabezados y el cuerpo', async () => {
    const g = armarAnthropicGrabado('texto', CLAVE)!
    await g.proveedor.llamar(pedido(g))
    assert.equal(g.capturas.length, 1)
    const c = g.capturas[0]!
    assert.equal(c.url, 'https://api.anthropic.com/v1/messages')
    assert.equal(c.metodo, 'POST')
    // el SDK 1.14 manda la clave como `Authorization: Bearer` (no `x-api-key`): en ningún otro lado
    assert.equal(c.cabeceras['authorization'], `Bearer ${CLAVE}`)
    assert.equal(c.cabeceras['x-api-key'], undefined)
    assert.deepEqual(Object.entries(c.cabeceras).filter(([, v]) => v.includes(CLAVE)).map(([k]) => k), ['authorization'])
    assert.ok(c.cabeceras['anthropic-version'], 'manda la versión de la API')
    assert.equal(c.cabeceras['anthropic-beta'], undefined, 'sin beta de fábrica')
    assert.ok(!c.cuerpo.includes(CLAVE) && !c.url.includes(CLAVE))
    const b = JSON.parse(c.cuerpo) as Record<string, unknown>
    assert.equal(b.model, 'claude-opus-5-5')
    assert.equal(b.stream, true, 'siempre con streaming')
    assert.equal(b.max_tokens, 4096)
    assert.deepEqual(b.cache_control, { type: 'ephemeral' })
    // lo que no se manda: el pensamiento (en Opus 5.5 no se puede apagar y por omisión es adaptivo), herramienta forzada, muestreo
    for (const k of ['thinking', 'tool_choice', 'temperature', 'top_p', 'top_k', 'output_config', 'fallbacks', 'betas']) assert.equal(b[k], undefined, k)
    assert.deepEqual(Object.keys(b).sort(), ['cache_control', 'max_tokens', 'messages', 'model', 'stream', 'system', 'tools'])
  })

  test('el esfuerzo bajo, medio y alto van como low, medium y high', async () => {
    for (const [mio, api] of [['bajo', 'low'], ['medio', 'medium'], ['alto', 'high']] as const) {
      const g = armarAnthropicGrabado('texto', CLAVE)!
      await g.proveedor.llamar(pedido(g, { esfuerzo: mio }))
      assert.deepEqual(JSON.parse(g.capturas[0]!.cuerpo).output_config, { effort: api })
    }
  })

  test('urlBase cambia la dirección', async () => {
    const g = armarAnthropicGrabado('texto', CLAVE)!
    await g.proveedor.llamar(pedido(g, { urlBase: 'https://proxy.ejemplo.test/anthropic' }))
    assert.equal(g.capturas[0]!.url, 'https://proxy.ejemplo.test/anthropic/v1/messages')
  })

  test('no usa nada del entorno de quien lo corre: ni otra clave, ni otra dirección', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-del-entorno-NO-USAR'
    process.env.ANTHROPIC_AUTH_TOKEN = 'token-del-entorno-NO-USAR'
    process.env.ANTHROPIC_BASE_URL = 'https://otro.ejemplo.test'
    const g = armarAnthropicGrabado('texto', CLAVE)!
    await g.proveedor.llamar(pedido(g))
    const c = g.capturas[0]!
    assert.equal(c.url, 'https://api.anthropic.com/v1/messages')
    assert.equal(c.cabeceras['authorization'], `Bearer ${CLAVE}`)
    assert.ok(!JSON.stringify(c).includes('NO-USAR'))
  })

  test('el id del pedido sale del encabezado request-id', async () => {
    const g = armarAnthropicGrabado('texto', CLAVE)!
    const r = await g.proveedor.llamar(pedido(g))
    assert.equal(r.idPedido, 'req_011CTx8qK2mV4nR7sT1uW3yZ')
  })

  test('el cinturón extra (apagado de fábrica): la beta y block_binding con drop_block', async () => {
    const g = armarAnthropicGrabado('texto', CLAVE, { descartarPensamientoAjeno: true })!
    await g.proveedor.llamar(pedido(g))
    const c = g.capturas[0]!
    assert.match(c.cabeceras['anthropic-beta'] ?? '', /thinking-binding-controls-2026-08-01/)
    assert.deepEqual(JSON.parse(c.cuerpo).thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } })
  })

  test('un historial roto no llega a la API: error de pedido sin contenido', async () => {
    const g = armarAnthropicGrabado('texto', CLAVE)!
    const e = await g.proveedor.llamar(pedido(g, { historial: ['{no es json'] })).then(() => null, (x) => x)
    assert.equal(e.tipo, 'pedido')
    assert.equal(g.capturas.length, 0)
  })

  test('los reintentos propios se pueden apagar', async () => {
    const g = armarAnthropicGrabado('error-429-corto', CLAVE, { reintentosInternos: 0 })!
    const e = await g.proveedor.llamar(pedido(g)).then(() => null, (x) => x)
    assert.equal(e.tipo, 'limite')
    assert.equal(e.esperarMs, 1000)
    assert.equal(g.capturas.length, 1)
    assert.deepEqual(g.esperas, [])
  })

  test('una espera pedida más larga que el tope propio no se espera: vuelve al ciclo con esperarMs', async () => {
    const g = armarAnthropicGrabado('error-429-corto', CLAVE, { esperaInternaMaxMs: 500 })!
    const e = await g.proveedor.llamar(pedido(g)).then(() => null, (x) => x)
    assert.equal(e.esperarMs, 1000)
    assert.equal(g.capturas.length, 1)
  })

  test('abortar antes de empezar no hace ningún pedido', async () => {
    const g = armarAnthropicGrabado('texto', CLAVE)!
    const c = new AbortController()
    c.abort()
    const e = await g.proveedor.llamar(pedido(g, { senal: c.signal })).then(() => null, (x) => x)
    assert.equal(e.tipo, 'tiempo')
    assert.equal(g.capturas.length, 0)
  })
})

describe('anthropic · modelos y probar la clave', () => {
  const p = crearProveedorAnthropic()

  test('los modelos del plan, con 1 millón de contexto y 128.000 de salida; uno desconocido, conservador', () => {
    for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
      assert.deepEqual(p.capacidades(m), { imagenes: true, imagenesEnResultados: true, contexto: 1_000_000, salidaMax: 128_000 })
    }
    assert.deepEqual(p.capacidades('claude-inventado'), { imagenes: true, imagenesEnResultados: true, contexto: 200_000, salidaMax: 64_000 })
  })

  test('probarClave: lista los modelos y no gasta (es un GET)', async () => {
    const g = armarAnthropicGrabado('probar-ok', CLAVE)!
    const r = await g.proveedor.probarClave(CLAVE)
    assert.equal(r.ok, true)
    assert.equal(g.capturas[0]!.metodo, 'GET')
    assert.equal(g.capturas[0]!.cuerpo, '')
    assert.equal(g.capturas[0]!.cabeceras['authorization'], `Bearer ${CLAVE}`)
  })

  test('probarClave con un modelo que la clave no tiene: no está ok y lo dice', async () => {
    const g = armarAnthropicGrabado('probar-ok', CLAVE)!
    const r = await g.proveedor.probarClave(CLAVE, { modelo: 'claude-fable-5-2' })
    assert.equal(r.ok, false)
    assert.match(r.error ?? '', /claude-fable-5-2/)
  })

  test('probarClave con una clave mala: el mensaje del plan 10.1, sin la clave', async () => {
    const g = armarAnthropicGrabado('probar-401', CLAVE)!
    const r = await g.proveedor.probarClave(CLAVE)
    assert.deepEqual(r, { ok: false, error: 'Anthropic la rechazó: revisá que esté completa.' })
  })
})
