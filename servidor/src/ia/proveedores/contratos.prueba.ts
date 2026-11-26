// Pruebas de contrato de los proveedores (docs/plan-ia-integrada.md, 15.3): el MISMO juego (`contrato.ts`) para el proveedor falso y el de Anthropic,
// contra las respuestas GRABADAS de `grabaciones/anthropic/*` (hechas a mano de la documentación: ver su README; se validan con la prueba real).
// OpenAI, DeepSeek y Gemini corren el mismo juego en `contratos-b2.prueba.ts`. Un adaptador nuevo suma su banco y no escribe más pruebas del
// contrato. En todas se busca la clave de prueba en cada respuesta, error, pedido y línea de registro. Sin red y sin gastar.
// `npm run ia:probar-contratos` (estos dos) y `npm run ia:probar-proveedores` (todos).
import assert from 'node:assert/strict'
import { after, before } from 'node:test'
import type { OpcionesAnthropic } from './anthropic'
import { type Banco, type Caso, correrContratos, type Esperado, type Montaje, sinClaveEnElRegistro, volcar } from './contrato'
import { crearProveedorFalso } from './falso'
import { armarAnthropicGrabado } from './reproducir'

/** Las claves de prueba: con la forma de las de verdad, pero inventadas. Si aparecen en cualquier salida, la prueba falla. */
export const CLAVE_ANTHROPIC = 'sk-ant-api03-CLAVE_DE_PRUEBA_9f2c71ab3d5e48b0aa17'
export const CLAVE_FALSA = 'prueba-CLAVE_DE_PRUEBA_9f2c71ab3d5e48b0aa17'
/** Una clave con un salto de línea adentro (se intentaría colar un encabezado). */
const CLAVE_CON_SALTOS = 'sk-abc\r\nx-evil: 1'

const lineasDeRegistro: string[] = []

// ───────────────────────── el banco del proveedor falso ─────────────────────────

const GUION_DE: Partial<Record<Caso, string>> = {
  texto: 'responder',
  herramienta: 'leer-y-responder',
  'dos-herramientas': 'dos-herramientas',
  reenvio: 'leer-y-responder',
  'resultado-con-imagen': 'responder',
  cache: 'responder',
  'error-401': 'error-clave',
  'error-429': 'error-429',
  'error-529': 'error-sobrecarga',
  'error-400': 'error-pedido',
  'error-saldo': 'error-saldo',
  'error-red': 'error-red',
  abortar: 'lento',
  'probar-ok': 'responder',
  'probar-401': 'responder',
  'clave-con-saltos': 'responder',
}
const ERRORES_ESPERADOS_FALSO: Partial<Record<Caso, NonNullable<Esperado['error']>>> = {
  'error-401': { tipo: 'clave', reintentable: false },
  'error-429': { tipo: 'limite', reintentable: true, esperarMs: 1000 },
  'error-529': { tipo: 'sobrecarga', reintentable: true },
  'error-400': { tipo: 'pedido', reintentable: false },
  'error-saldo': { tipo: 'saldo', reintentable: false },
  'error-red': { tipo: 'red', reintentable: true },
}

export const bancoFalso: Banco = {
  nombre: 'falso',
  clave: CLAVE_FALSA,
  montar(caso) {
    const guion = GUION_DE[caso]
    if (!guion) return null
    return {
      proveedor: crearProveedorFalso(),
      modelo: `guion:${guion}`,
      clave: caso === 'probar-401' ? 'clave-que-no-es-de-prueba' : caso === 'clave-con-saltos' ? CLAVE_CON_SALTOS : CLAVE_FALSA,
      esperado: ERRORES_ESPERADOS_FALSO[caso] ? { error: ERRORES_ESPERADOS_FALSO[caso] } : undefined,
      pedidos: () => [],
      esperas: () => [],
      diferencias: () => [],
    }
  },
}

// ───────────────────────── el banco de Anthropic, contra las grabaciones ─────────────────────────

export function montarAnthropic(caso: string, opciones: OpcionesAnthropic = {}, clave = CLAVE_ANTHROPIC): Montaje | null {
  // la clave con saltos de línea no necesita grabación: no tiene que salir ni un pedido
  const g = armarAnthropicGrabado(caso === 'clave-con-saltos' ? 'texto' : caso, caso === 'clave-con-saltos' ? CLAVE_CON_SALTOS : clave, opciones)
  if (!g) return null
  return {
    proveedor: g.proveedor,
    modelo: 'claude-opus-5-5',
    clave: caso === 'clave-con-saltos' ? CLAVE_CON_SALTOS : clave,
    esperado: caso === 'clave-con-saltos' ? undefined : g.rec.esperado,
    pedidos: () => g.capturas,
    esperas: () => g.esperas,
    diferencias: () => g.diferencias,
    destino: 'https://api.anthropic.com',
    formato: {
      primerPedido: (p) => {
        assert.equal(p.metodo, 'POST')
        assert.equal(new URL(p.url).pathname, '/v1/messages')
        assert.equal(p.cabeceras.authorization, `Bearer ${clave}`, 'la clave va solo en el encabezado authorization')
      },
      reenvio: (r1, cuerpo2) => {
        // la conversación en el formato de Messages: [usuario, asistente EXACTO, resultado de la herramienta]
        const cuerpo = JSON.parse(cuerpo2) as { messages: { role: string; content: { type: string; tool_use_id?: string }[] }[] }
        assert.deepEqual(cuerpo.messages[1], JSON.parse(r1.nativo))
        assert.equal(cuerpo.messages[2]!.role, 'user')
        assert.equal(cuerpo.messages[2]!.content[0]!.type, 'tool_result')
        assert.equal(cuerpo.messages[2]!.content[0]!.tool_use_id, r1.llamadas[0]!.id)
      },
      imagen: (cuerpoTexto, png) => {
        const cuerpo = JSON.parse(cuerpoTexto) as { messages: { content: { content: { type: string; source?: { type: string; media_type: string; data: string } }[] }[] }[] }
        const img = cuerpo.messages[2]!.content[0]!.content[1]!
        assert.equal(img.type, 'image')
        assert.deepEqual(img.source, { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') })
      },
    },
  }
}

export const bancoAnthropic: Banco = {
  nombre: 'anthropic (grabaciones)',
  clave: CLAVE_ANTHROPIC,
  montar: (caso) => montarAnthropic(caso),
}

// ───────────────────────── a correr ─────────────────────────

const consola = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }

before(() => {
  // todo lo que los adaptadores escriban al registro se junta: al final no puede haber una clave
  for (const nivel of Object.keys(consola) as (keyof typeof consola)[]) {
    console[nivel] = (...a: unknown[]) => void lineasDeRegistro.push(a.map((x) => (typeof x === 'string' ? x : volcar(x))).join(' '))
  }
})

after(() => {
  Object.assign(console, consola)
})

correrContratos(bancoFalso)
correrContratos(bancoAnthropic)

sinClaveEnElRegistro(lineasDeRegistro, [CLAVE_ANTHROPIC, CLAVE_FALSA])
