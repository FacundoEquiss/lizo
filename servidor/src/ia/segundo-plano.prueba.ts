// Prueba de segundo-plano.ts (tarea 2.10): en la computadora no hace nada raro (promesas que fallan no tiran, plazo infinito,
// encadenar no sale a ningún lado); «online» (VERCEL=1) el plazo cae al de 240 s y encadenar manda la clave y la cuenta firmada.
// `npm run ia:probar-segundo-plano`. Sin red de afuera: el «servidor» de la ruta interna es uno local de mentira.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { leerAlcance } from '../sesion'
import { encadenar, enSegundoPlano, marcarPorCorrer, plazo, tomarMarcadas } from './segundo-plano'

const SECRETO = 'secreto-de-prueba-del-segundo-plano-0123456789'

async function conEntorno<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const antes = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(antes)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  }
}

test('en la computadora: la promesa corre, una que falla no tira, y no hay plazo', async () => {
  await conEntorno({ VERCEL: undefined }, async () => {
    let corrio = false
    enSegundoPlano(Promise.resolve().then(() => (corrio = true)))
    enSegundoPlano(Promise.reject(new Error('falló a propósito, con una clave sk-abc123')))
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(corrio, true)
    assert.equal(plazo(), Number.POSITIVE_INFINITY)
    await encadenar('dueno') // no hace nada y no tira
  })
})

test('online sin dato de Vercel: el plazo se cuenta 240 s desde que empezó la corrida', async () => {
  await conEntorno({ VERCEL: '1' }, async () => {
    const desde = Date.now()
    assert.equal(plazo(desde), desde + 240_000)
    enSegundoPlano(Promise.reject(new Error('x'))) // sin contexto de pedido: no tira
    await new Promise((r) => setTimeout(r, 10))
  })
})

test('encadenar: un POST a la ruta interna con la clave y la cuenta firmada; si falla, no tira', async () => {
  let visto: { url?: string; metodo?: string; clave?: string; alcance?: string } = {}
  const srv = createServer((req, res) => {
    visto = { url: req.url, metodo: req.method, clave: String(req.headers['x-tablero-clave']), alcance: String(req.headers['x-tablero-alcance']) }
    res.statusCode = 202
    res.end('{}')
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  try {
    await conEntorno({ VERCEL: '1', TABLERO_CLAVE: 'clave-del-mcp-de-prueba', TABLERO_SECRETO: SECRETO, TABLERO_URL_PUBLICA: url }, async () => {
      await encadenar('cuenta-x')
      assert.equal(visto.url, '/api/ia/interno/correr')
      assert.equal(visto.metodo, 'POST')
      assert.equal(visto.clave, 'clave-del-mcp-de-prueba')
      assert.equal(leerAlcance(visto.alcance), 'cuenta-x', 'la cuenta va firmada con TABLERO_SECRETO')
    })
  } finally {
    srv.close()
  }
  // con el servidor caído no pasa nada grave (las redes lo levantan)
  await conEntorno({ VERCEL: '1', TABLERO_CLAVE: 'k', TABLERO_SECRETO: SECRETO, TABLERO_URL_PUBLICA: url }, async () => {
    await encadenar('cuenta-x')
  })
  // sin clave del MCP no hay con qué pedirlo: no hace nada
  await conEntorno({ VERCEL: '1', TABLERO_CLAVE: undefined }, async () => encadenar('cuenta-x'))
})

test('las cuentas con algo por correr se anotan una vez y se entregan una vez', () => {
  assert.deepEqual(tomarMarcadas(), [])
  marcarPorCorrer('a')
  marcarPorCorrer('b')
  marcarPorCorrer('a')
  assert.deepEqual(tomarMarcadas().sort(), ['a', 'b'])
  assert.deepEqual(tomarMarcadas(), [])
})
