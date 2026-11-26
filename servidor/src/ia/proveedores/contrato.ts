// El juego de contrato de los proveedores (docs/plan-ia-integrada.md, 15.3): UNA sola forma para cualquier adaptador. No es una prueba por sí
// solo: lo importan `contratos.prueba.ts` (el falso y Anthropic) y `contratos-b2.prueba.ts` (OpenAI, DeepSeek y Gemini), cada uno con sus
// «bancos». Un banco sabe armar cada caso para su proveedor (con su transporte de grabaciones o su guion); el juego (`correrContratos`) hace
// siempre las mismas preguntas: respuesta de solo texto, una herramienta, dos en un paso, reenvío exacto del mensaje del asistente,
// resultado con imagen, uso con caché, cada tipo de error (401, 429 con y sin espera, 5xx, 400, sin saldo, corte por largo, rechazo),
// argumentos de herramienta cortados o rotos, la clave con saltos de línea, abortar y probar la clave.
//
// En TODAS las pruebas se busca la clave de prueba en cada respuesta, error (con sus propiedades y su `stack`), pedido capturado y línea de
// registro: no puede aparecer en ninguna. Un adaptador nuevo suma su banco (en su archivo de prueba, llamando a `correrContratos`) y no escribe
// más pruebas del contrato. Sin red y sin gastar.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ErrorProveedor, type PedidoModelo, type Proveedor, type RespuestaModelo } from '../tipos'
import type { Esperado, PedidoCapturado } from './reproducir'

export type { Esperado, PedidoCapturado }

export type Caso =
  | 'texto' | 'herramienta' | 'dos-herramientas' | 'reenvio' | 'resultado-con-imagen' | 'cache'
  | 'largo' | 'largo-herramienta-cortada' | 'json-roto' | 'rechazo' | 'pausa'
  | 'error-401' | 'error-401-eco' | 'error-429' | 'error-429-corto' | 'error-529' | 'error-500' | 'error-400'
  | 'error-saldo' | 'error-limite-gasto' | 'error-flujo-cortado' | 'error-red' | 'abortar' | 'clave-con-saltos' | 'probar-ok' | 'probar-401'

export const CASOS: Caso[] = [
  'texto', 'herramienta', 'dos-herramientas', 'reenvio', 'resultado-con-imagen', 'cache',
  'largo', 'largo-herramienta-cortada', 'json-roto', 'rechazo', 'pausa',
  'error-401', 'error-401-eco', 'error-429', 'error-429-corto', 'error-529', 'error-500', 'error-400',
  'error-saldo', 'error-limite-gasto', 'error-flujo-cortado', 'error-red', 'abortar', 'clave-con-saltos', 'probar-ok', 'probar-401',
]

export interface Montaje {
  proveedor: Proveedor
  modelo: string
  clave: string
  esperado?: Esperado
  /** Lo que hizo el adaptador hacia afuera (vacío si el banco no lo ve). */
  pedidos: () => PedidoCapturado[]
  esperas: () => number[]
  /** Diferencias entre lo que mandó el adaptador y lo que la grabación esperaba. */
  diferencias: () => string[]
  /** La dirección base del servicio (si el adaptador la necesita en el pedido: «compatible»). */
  urlBase?: string
  /** El origen al que tiene que ir TODO lo que manda el adaptador (nada de la clave ni del pedido va a otro lado). */
  destino?: string
  /** Lo propio del formato de ese proveedor (la forma exacta del pedido), solo si el banco ve los pedidos. */
  formato?: {
    /** Se llama con el primer pedido de un caso de respuesta de solo texto (método, dirección, dónde va la clave). */
    primerPedido?: (p: PedidoCapturado) => void
    /** Se llama con el cuerpo del segundo pedido de un reenvío y lo que devolvió el primero. */
    reenvio?: (r1: RespuestaModelo, cuerpo2: string) => void
    /** Se llama con el cuerpo del pedido que lleva el resultado con imagen y los bytes de la imagen. */
    imagen?: (cuerpo: string, png: Uint8Array) => void
  }
}

export interface Banco {
  nombre: string
  clave: string
  /** null: este banco no cubre el caso. */
  montar(caso: Caso): Montaje | null
}

// ───────────────────────── el juego de pruebas ─────────────────────────

export const SISTEMA = [{ texto: 'Sos un agente de Telar. Respondé en castellano rioplatense, corto y concreto.' }]
export const HERRAMIENTAS = [
  {
    nombre: 'leer_tarjeta',
    descripcion: 'Devuelve una tarjeta completa. Ejemplo: { "tarjeta": "RC-12" }',
    esquema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { tarjeta: { type: 'string' } }, required: ['tarjeta'], additionalProperties: false },
  },
  {
    nombre: 'leer_tablero',
    descripcion: 'Devuelve el tablero con sus listas.',
    esquema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {}, additionalProperties: false },
  },
]
export const PREGUNTA = 'Tarjeta RC-12: ¿qué falta?'
const ID_HERRAMIENTA = 'toolu_01A09q90qw90lq917835lq9'
/** Un PNG de 1×1: los bytes que devuelve `leerImagen`. */
export const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))

function pedidoBase(m: Montaje, historialExtra: string[] = [], senal: AbortSignal = new AbortController().signal): PedidoModelo {
  const fijo = m.proveedor.prepararFijo({ sistema: SISTEMA, herramientas: HERRAMIENTAS, modelo: m.modelo })
  const historial = [m.proveedor.aNativo({ rol: 'usuario', partes: [{ tipo: 'texto', texto: PREGUNTA }] }, { modelo: m.modelo }), ...historialExtra]
  return { modelo: m.modelo, maxSalida: 4096, fijo, historial, clave: m.clave, senal, leerImagen: async () => PNG, ...(m.urlBase ? { urlBase: m.urlBase } : {}) }
}

/** Todo lo que el adaptador devolvió o tiró, como texto, para buscarle la clave. */
export function volcar(x: unknown): string {
  if (x instanceof Error) {
    const props: Record<string, unknown> = {}
    for (const k of Object.getOwnPropertyNames(x)) props[k] = (x as unknown as Record<string, unknown>)[k]
    return JSON.stringify(props)
  }
  return JSON.stringify(x)
}

function validarRespuesta(r: RespuestaModelo, m: Montaje): void {
  assert.ok(['fin', 'herramientas', 'largo', 'rechazo', 'pausa'].includes(r.corte), `corte desconocido: ${r.corte}`)
  assert.equal(typeof r.texto, 'string')
  assert.ok(Array.isArray(r.llamadas))
  for (const l of r.llamadas) {
    assert.ok(l.id && typeof l.id === 'string', 'cada llamada trae el id del modelo')
    assert.ok(l.nombre && typeof l.nombre === 'string', 'cada llamada trae su nombre')
  }
  for (const k of ['entrada', 'salida', 'cacheLectura', 'cacheEscritura'] as const) {
    assert.ok(Number.isFinite(r.uso[k]) && r.uso[k] >= 0, `uso.${k} es un número ≥ 0`)
  }
  assert.equal(typeof r.nativo, 'string')
  assert.doesNotThrow(() => JSON.parse(r.nativo), 'el nativo es JSON')
  if (r.corte === 'herramientas') assert.ok(r.llamadas.length > 0, 'corte herramientas: trae las llamadas')
  const e = m.esperado
  if (e?.corte) assert.equal(r.corte, e.corte)
  if (e?.texto !== undefined) assert.equal(r.texto, e.texto)
  if (e?.uso) assert.deepEqual(r.uso, e.uso)
  if (e?.idPedido) assert.equal(r.idPedido, e.idPedido)
  if (e?.llamadas) {
    assert.equal(r.llamadas.length, e.llamadas.length)
    e.llamadas.forEach((x, i) => {
      assert.equal(r.llamadas[i]!.id, x.id)
      assert.equal(r.llamadas[i]!.nombre, x.nombre)
      assert.deepEqual(r.llamadas[i]!.argumentos, x.argumentos)
      assert.equal(typeof r.llamadas[i]!.invalida === 'string', Boolean(x.invalida), `llamada ${i}: invalida`)
    })
  }
}

function sinClave(m: Montaje, ...cosas: unknown[]): void {
  for (const c of cosas) assert.ok(!volcar(c).includes(m.clave), 'la clave de prueba apareció en una salida')
  for (const p of m.pedidos()) {
    assert.ok(!p.url.includes(m.clave), 'la clave no va en la dirección')
    assert.ok(!p.cuerpo.includes(m.clave), 'la clave no va en el cuerpo del pedido')
    if (m.destino) assert.ok(p.url.startsWith(m.destino), `todo va a la dirección configurada (${m.destino}), y fue a ${p.url}`)
  }
}

function validarError(e: unknown, m: Montaje): ErrorProveedor {
  assert.ok(e instanceof ErrorProveedor, `se esperaba un ErrorProveedor y llegó: ${String(e)}`)
  assert.ok(['clave', 'saldo', 'limite', 'sobrecarga', 'tiempo', 'pedido', 'red', 'rechazo'].includes(e.tipo))
  assert.equal(typeof e.reintentable, 'boolean')
  assert.ok(e.paraLaPersona.length > 5, 'trae un texto para la persona')
  assert.ok(e.esperarMs === undefined || (Number.isFinite(e.esperarMs) && e.esperarMs >= 0))
  assert.equal((e as { cause?: unknown }).cause, undefined, 'no arrastra el error del SDK (llevaría la respuesta y los datos del pedido)')
  sinClave(m, e)
  assert.ok(!volcar(e).includes(PREGUNTA), 'el contenido del pedido no se cuela en el error')
  const x = m.esperado?.error
  if (x) {
    assert.equal(e.tipo, x.tipo)
    assert.equal(e.reintentable, x.reintentable)
    if (x.esperarMs !== undefined) assert.equal(e.esperarMs, x.esperarMs)
  }
  return e
}

function cerrarCaso(m: Montaje): void {
  assert.deepEqual(m.diferencias(), [], 'el pedido no era el que la grabación esperaba')
  const x = m.esperado
  if (x?.pedidos !== undefined && m.pedidos().length) assert.equal(m.pedidos().length, x.pedidos, 'cuántos pedidos hizo')
  if (x?.esperas) assert.deepEqual(m.esperas(), x.esperas, 'cuánto esperó antes de reintentar')
}

/** Lo que va pegado en el cuerpo del pedido siguiente: el nativo, sin los corchetes si es una lista (OpenAI guarda una lista de ítems). */
const pegado = (nativo: string): string => (nativo.startsWith('[') ? nativo.slice(1, -1) : nativo)

export function correrContratos(banco: Banco): void {
  describe(`contrato · ${banco.nombre}`, () => {
    for (const caso of CASOS) {
      test(caso, async (t) => {
        const m = banco.montar(caso)
        if (!m) return t.skip('este banco no cubre el caso')
        const senal = new AbortController().signal

        if (caso === 'probar-ok' || caso === 'probar-401') {
          const r = await m.proveedor.probar({ clave: m.clave, ...(m.urlBase ? { urlBase: m.urlBase } : {}) })
          sinClave(m, r)
          assert.equal(typeof r.ok, 'boolean')
          if (caso === 'probar-ok') {
            assert.equal(r.ok, true)
            assert.ok(Array.isArray(r.modelos) && r.modelos.length > 0 && r.modelos.every((x) => typeof x === 'string'))
            if (m.esperado?.probar?.modelos) assert.deepEqual(r.modelos, m.esperado.probar.modelos)
          } else {
            assert.equal(r.ok, false)
            assert.ok(r.error && r.error.length > 5, 'dice por qué')
          }
          return cerrarCaso(m)
        }

        if (caso === 'clave-con-saltos') {
          // una clave con saltos de línea o letras raras no sale: se corta antes de armar nada
          const e = await m.proveedor.llamar(pedidoBase(m)).then(
            () => assert.fail('tendría que haber rechazado la clave'),
            (x) => x,
          )
          const err = validarError(e, m)
          assert.equal(err.tipo, 'clave')
          assert.equal(err.reintentable, false)
          assert.equal(m.pedidos().length, 0, 'no se mandó nada')
          return
        }

        if (caso === 'abortar') {
          const c = new AbortController()
          const promesa = m.proveedor.llamar(pedidoBase(m, [], c.signal))
          setTimeout(() => c.abort(), 30)
          const e = await promesa.then(
            () => assert.fail('tendría que haber fallado al abortar'),
            (x) => x,
          )
          const err = validarError(e, m)
          assert.equal(err.tipo, 'tiempo', 'abortar sale como «tiempo»: quien aborta sabe por qué')
          return
        }

        if (caso === 'reenvio') {
          const primero = pedidoBase(m)
          const r1 = await m.proveedor.llamar(primero)
          validarRespuesta(r1, m)
          sinClave(m, r1)
          assert.equal(r1.corte, 'herramientas')
          const resultado = m.proveedor.aNativo(
            { rol: 'herramienta', resultados: [{ id: r1.llamadas[0]!.id, nombre: r1.llamadas[0]!.nombre, esError: false, partes: [{ tipo: 'texto', texto: '{"clave":"RC-12","titulo":"El mozo tropieza"}' }] }] },
            { modelo: m.modelo },
          )
          const r2 = await m.proveedor.llamar({ ...primero, historial: [...primero.historial, r1.nativo, resultado] })
          sinClave(m, r2)
          assert.equal(r2.corte, 'fin')
          assert.ok(r2.texto.length > 0)
          const pedidos = m.pedidos()
          if (pedidos.length) {
            // el cuerpo del segundo pedido contiene, byte por byte, lo que devolvió el primero y el resultado de la herramienta, en ese orden
            const cuerpo2 = pedidos[pedidos.length - 1]!.cuerpo
            assert.doesNotThrow(() => JSON.parse(cuerpo2), 'el cuerpo es JSON')
            const a = cuerpo2.indexOf(pegado(r1.nativo))
            const b = cuerpo2.indexOf(pegado(resultado))
            assert.ok(a >= 0, 'el mensaje del asistente se reenvía EXACTO')
            assert.ok(b >= 0, 'el resultado de la herramienta va como se guardó')
            assert.ok(a < b, 'el orden de la conversación no cambia')
            m.formato?.reenvio?.(r1, cuerpo2)
          }
          if (m.esperado?.segundo) {
            assert.equal(r2.corte, m.esperado.segundo.corte)
            assert.equal(r2.texto, m.esperado.segundo.texto)
            assert.deepEqual(r2.uso, m.esperado.segundo.uso)
          }
          return cerrarCaso(m)
        }

        if (caso === 'resultado-con-imagen') {
          const idLlamada = ID_HERRAMIENTA
          const delAsistente = m.proveedor.aNativo({ rol: 'asistente', texto: '', llamadas: [{ id: idLlamada, nombre: 'leer_tarjeta', argumentos: { tarjeta: 'RC-12' } }] }, { modelo: m.modelo })
          const resultado = m.proveedor.aNativo(
            { rol: 'herramienta', resultados: [{ id: idLlamada, nombre: 'leer_tarjeta', esError: false, partes: [{ tipo: 'texto', texto: 'Así se ve el marco.' }, { tipo: 'imagen', mime: 'image/png', ruta: 'c/prueba/captura.png' }] }] },
            { modelo: m.modelo },
          )
          assert.ok(!resultado.includes(Buffer.from(PNG).toString('base64')) && !resultado.includes(PNG.toString()), 'lo guardado no lleva los bytes de la imagen')
          const rutas: string[] = []
          const base = pedidoBase(m, [delAsistente, resultado])
          const r = await m.proveedor.llamar({ ...base, leerImagen: async (ruta) => (rutas.push(ruta), PNG) })
          validarRespuesta(r, m)
          sinClave(m, r)
          const pedidos = m.pedidos()
          if (pedidos.length) {
            assert.deepEqual(rutas, ['c/prueba/captura.png'], 'pidió los bytes de la imagen una vez')
            const cuerpo = pedidos[0]!.cuerpo
            assert.doesNotThrow(() => JSON.parse(cuerpo), 'el cuerpo es JSON')
            assert.ok(cuerpo.includes(Buffer.from(PNG).toString('base64')), 'los bytes de la imagen van en el pedido')
            assert.ok(!cuerpo.includes('telar-imagen:'), 'no queda ninguna referencia sin resolver')
            m.formato?.imagen?.(cuerpo, PNG)
          }
          return cerrarCaso(m)
        }

        if (m.esperado?.error) {
          const e = await m.proveedor.llamar(pedidoBase(m, [], senal)).then(
            (r) => assert.fail(`tendría que haber fallado y devolvió ${r.corte}`),
            (x) => x,
          )
          validarError(e, m)
          return cerrarCaso(m)
        }

        // el resto devuelve una respuesta
        const r = await m.proveedor.llamar(pedidoBase(m, [], senal))
        validarRespuesta(r, m)
        sinClave(m, r)
        if (caso === 'texto' && m.pedidos().length) m.formato?.primerPedido?.(m.pedidos()[0]!)
        if (caso === 'cache') assert.ok(r.uso.cacheLectura + r.uso.cacheEscritura > 0, 'el uso trae el caché')
        if (caso === 'dos-herramientas') assert.equal(r.llamadas.length, 2)
        if (caso === 'herramienta') assert.equal(r.llamadas.length, 1)
        if (caso === 'largo') assert.equal(r.corte, 'largo')
        if (caso === 'rechazo') assert.equal(r.corte, 'rechazo')
        if (caso === 'pausa') assert.equal(r.corte, 'pausa')
        if (caso === 'error-429-corto') {
          const ps = m.pedidos()
          if (ps.length) {
            assert.equal(ps.length, 2, 'reintentó una vez, adentro')
            assert.equal(ps[0]!.cuerpo, ps[1]!.cuerpo, 'el reintento manda lo mismo')
          }
        }
        if (caso === 'json-roto' || caso === 'largo-herramienta-cortada') {
          assert.equal(r.llamadas.length, 1)
          assert.equal(typeof r.llamadas[0]!.invalida, 'string', 'la llamada con argumentos rotos o cortados queda invalida')
          assert.match(r.llamadas[0]!.invalida ?? '', /cortados o rotos|rotos|cortados/)
          // lo reenviable sigue siendo un objeto: el nativo guarda los argumentos como un objeto, aunque sea vacío
          assert.ok(!JSON.parse(r.nativo).content?.some?.((b: { type: string; input?: unknown }) => b.type === 'tool_use' && (typeof b.input !== 'object' || b.input === null)))
        }
        cerrarCaso(m)
      })
    }
  })
}

/** Una clave de prueba escrita en una línea de registro: el último test de cada archivo de contratos. */
export function sinClaveEnElRegistro(lineas: string[], claves: string[]): void {
  describe('contrato · ninguna clave en el registro', () => {
    test('después de todo, ninguna línea de registro lleva una clave de prueba', () => {
      for (const l of lineas) for (const c of claves) assert.ok(!l.includes(c), `una línea del registro lleva la clave: ${l.slice(0, 80)}`)
    })
  })
}
