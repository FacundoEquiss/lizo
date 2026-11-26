// Producción segura (plan 16.4, tarea de integración): lo que tiene que pasar en un Telar ONLINE (TABLERO_PUBLICO=1) sin TABLERO_IA_FALSO, con el
// cableado de verdad de `conectarIA` (los proveedores, los precios y la bóveda reales; lo único de mentira es que no se sale a ninguna red):
//
//   · no hay proveedor falso por ningún camino (ni por el registro, ni por una clave, ni por un agente), y en Vercel tampoco con la variable;
//   · un agente sin clave queda «sin_clave» y la mención queda pendiente con el motivo; no se crea ningún trabajo;
//   · un trabajo de un agente «falso» que quedó en la base falla enseguida y claro: no corre nada y no se reintenta;
//   · sin TABLERO_SECRETO_IA ni TABLERO_SECRETO las rutas de claves dan 503 (no 500), el estado se sigue viendo y un trabajo no marca la clave inválida;
//   · el precio: un modelo que Telar no conoce no tiene costo y el ciclo no le pide nada antes de saberlo; con el precio a mano sí.
//
// Sin red: nada de esto habla con un proveedor. `npm run ia:probar-produccion`.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

const datos = mkdtempSync(path.join(tmpdir(), 'telar-produccion-'))
const SECRETO = 'secreto-de-prueba-produccion-0123456789-abcdefghijklmnop'
const guardadas: Record<string, string | undefined> = {}
for (const [k, v] of Object.entries({
  TABLERO_DATOS: datos,
  TABLERO_PUBLICO: '1',
  TABLERO_SECRETO_IA: SECRETO,
  TABLERO_SECRETO: undefined,
  TABLERO_IA_FALSO: undefined,
  VERCEL: undefined,
  VERCEL_ENV: undefined,
})) {
  guardadas[k] = process.env[k]
  if (v === undefined) delete process.env[k]
  else process.env[k] = v
}
after(() => rmSync(datos, { recursive: true, force: true }))

const { Hono } = await import('hono')
const { ErrorDominio } = await import('../dominio/servicio')
const { conectarIA } = await import('./conectar')
const { correr, ejecutorListo } = await import('./ejecutor')
const { olvidarAgentes } = await import('./menciones')
const { crearAgente, crearEntorno, crearTarjeta } = await import('./prueba-base')
const { falsoDisponible, proveedorDe, proveedoresDisponibles } = await import('./proveedores/indice')
const { rutasIA } = await import('./rutas')
const { iaDe } = await import('./servicio-ia')
const { depsDeProduccion } = await import('./cableado')
const { ErrorSinPrecio } = await import('./proveedores/precios')
type Entorno = Awaited<ReturnType<typeof crearEntorno>>

let e: Entorno
let app: InstanceType<typeof Hono>

before(async () => {
  e = await crearEntorno()
  // el cableado de producción, tal cual (sin deps de prueba): el proveedor es el del registro, la bóveda la real
  conectarIA(e.raiz, { red: false })
  app = new Hono()
  app.onError((err, c) => {
    // el mismo manejo de errores que `crearApp`: lo de dominio lleva su estado; lo demás, 500
    if (err instanceof ErrorDominio) return c.json({ error: err.message }, err.estado as 400)
    return c.json({ error: 'Algo salió mal en el servidor.' }, 500)
  })
  app.route('/api', rutasIA({ servicio: () => e.s, raiz: () => e.raiz, ctx: async () => e.persona, via: () => 'sesion', claveValida: () => false }))
})
after(async () => {
  conectarIA(e.raiz, { red: false, deps: null })
  for (const [k, v] of Object.entries(guardadas)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await e.cerrar()
})
beforeEach(async () => {
  process.env.TABLERO_SECRETO_IA = SECRETO
  olvidarAgentes()
  await e.db.consulta(`update ia_trabajos set estado = 'cancelado', terminado_en = now(), tomado_hasta = null where estado in ('en_cola', 'en_curso', 'esperando_confirmacion', 'pausado_tope')`)
  await e.db.consulta(`delete from ia_uso_mes`)
  await e.db.consulta(`delete from ia_ajustes`)
  await e.db.consulta(`delete from menciones`)
  await e.db.consulta(`delete from ia_agentes`)
  await e.db.consulta(`delete from ia_claves`)
})

async function pedir(metodo: string, ruta: string, cuerpo?: unknown) {
  const r = await app.request(`http://127.0.0.1${ruta}`, {
    method: metodo,
    headers: cuerpo === undefined ? {} : { 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  let json: any = null
  try {
    json = JSON.parse(texto)
  } catch {}
  return { status: r.status, json, texto }
}

test('el cableado de verdad está puesto y el proveedor falso no existe online', async () => {
  assert.equal(ejecutorListo(), true, 'conectarIA deja el ciclo conectado con las dependencias de producción')
  assert.deepEqual(proveedoresDisponibles(), ['anthropic', 'openai', 'compatible'])
  assert.throws(() => proveedorDe('falso'), (x) => x instanceof ErrorDominio && /solo para pruebas/.test(x.message))
  // ni con la variable puesta, si es Vercel
  assert.equal(falsoDisponible({ TABLERO_PUBLICO: '1', TABLERO_IA_FALSO: '1', VERCEL: '1' }), false)
  assert.equal(falsoDisponible({ TABLERO_PUBLICO: '1', TABLERO_IA_FALSO: '1', VERCEL_ENV: 'production' }), false)
  assert.equal(falsoDisponible({ TABLERO_PUBLICO: '1' }), false, 'sin la variable, tampoco')
})

test('no se puede cargar una clave «falso» ni crear un agente «falso», ni el catálogo de modelos lo ofrece', async () => {
  const k = await pedir('POST', '/api/ia/claves', { proveedor: 'falso', nombre: 'Falsa', clave: 'prueba-1234567890' })
  assert.equal(k.status, 400)
  assert.match(k.json.error, /no está habilitado/)
  const a = await pedir('POST', '/api/ia/agentes', { nombre: 'Falso', proveedor: 'falso', modelo: 'guion:responder' })
  assert.equal(a.status, 400)
  assert.match(a.json.error, /no está habilitado/)
  // y ni con TABLERO_IA_FALSO=1 puesta de más, si el proceso corre en Vercel
  process.env.TABLERO_IA_FALSO = '1'
  process.env.VERCEL = '1'
  try {
    const enVercel = await pedir('POST', '/api/ia/claves', { proveedor: 'falso', nombre: 'Falsa', clave: 'prueba-1234567890' })
    assert.equal(enVercel.status, 400)
    assert.match(enVercel.json.error, /no está habilitado/)
  } finally {
    delete process.env.TABLERO_IA_FALSO
    delete process.env.VERCEL
  }
  const est = await pedir('GET', '/api/ia/estado')
  assert.equal(est.status, 200)
  assert.ok(est.json.modelos.some((m: { modelo: string }) => m.modelo === 'claude-opus-5-5'), 'el catálogo trae los modelos de verdad, con su costo')
  assert.ok(est.json.modelos.every((m: { proveedor: string; costoRespuestaUsd: number }) => m.proveedor !== 'falso' && m.costoRespuestaUsd > 0))
  assert.deepEqual(est.json.preajustes.map((p: { id: string }) => p.id), ['gpt', 'gemini', 'deepseek', 'otro'], 'los preajustes de la pantalla salen del estado')
  assert.equal(est.json.puedeCambiar, true)
})

test('un agente sin clave queda «sin_clave» y la mención queda pendiente con el motivo, sin trabajo', async () => {
  const ag = await pedir('POST', '/api/ia/agentes', { nombre: 'Claude', proveedor: 'anthropic', modelo: 'claude-opus-5-5' })
  assert.equal(ag.status, 201, ag.texto)
  assert.equal(ag.json.estado, 'sin_clave')
  assert.equal(ag.json.topeMesUsd, 10, 'de fábrica, USD 10 por agente')
  olvidarAgentes()
  const t = await crearTarjeta(e, 'Sin clave')
  const c = await e.s.comentar(e.persona, t.clave, '@claude ¿estás?')
  assert.equal(c.trabajos?.length ?? 0, 0, 'ningún trabajo')
  assert.equal(c.menciones![0]!.estado, 'pendiente')
  assert.equal(c.menciones![0]!.motivo, 'No tiene clave.')
  assert.equal((await e.db.consulta(`select count(*)::int as n from ia_trabajos`))[0]!.n, 0)
})

test('un agente «falso» que quedó en la base no corre: el trabajo falla enseguida con el motivo, sin reintentos ni llamadas', async () => {
  const a = await crearAgente(e, { modelo: 'guion:responder' }) // proveedor «falso», clave de mentira: como si alguien lo hubiera puesto a mano en la base
  olvidarAgentes()
  const t = await crearTarjeta(e, 'Falso online')
  const c = await e.s.comentar(e.persona, t.clave, '@claude hola')
  const trabajo = c.trabajos?.[0]
  assert.ok(trabajo, 'la mención crea el trabajo (el agente parece listo)')
  await correr(e.raiz, 'dueno')
  const [f] = await e.db.consulta(`select estado, motivo, reintentos, paso from ia_trabajos where id = $1`, [trabajo!.id])
  assert.equal(f!.estado, 'fallado')
  assert.match(f!.motivo, /solo para pruebas/)
  assert.equal(Number(f!.reintentos), 0, 'no se reintenta: no se arregla esperando')
  assert.equal((await e.db.consulta(`select count(*)::int as n from ia_uso`))[0]!.n, 0, 'no se gastó nada')
  void a
})

test('sin TABLERO_SECRETO_IA ni TABLERO_SECRETO, las claves dan 503 (no 500); el estado se ve y un trabajo no marca la clave como inválida', async () => {
  // una clave guardada con el secreto de hoy…
  const k = await pedir('POST', '/api/ia/claves', { proveedor: 'disparador', nombre: 'Tarea', clave: 'token-de-la-tarea-0123456789', urlBase: 'https://tarea.ejemplo.com/disparar' })
  assert.equal(k.status, 201, k.texto)
  const idClave = k.json.id as string
  // …y el servidor arranca sin secreto
  delete process.env.TABLERO_SECRETO_IA
  delete process.env.TABLERO_SECRETO
  const nueva = await pedir('POST', '/api/ia/claves', { proveedor: 'disparador', nombre: 'Otra', clave: 'otro-token-0123456789', urlBase: 'https://tarea.ejemplo.com/otra' })
  assert.equal(nueva.status, 503, nueva.texto)
  assert.match(nueva.json.error, /Falta el secreto del servidor/)
  const cambiar = await pedir('PUT', `/api/ia/claves/${idClave}`, { nombre: 'Tarea', clave: 'token-nuevo-0123456789' })
  assert.equal(cambiar.status, 503, cambiar.texto)
  const probar = await pedir('POST', `/api/ia/claves/${idClave}/probar`, {})
  assert.equal(probar.status, 503, probar.texto)
  assert.ok(!JSON.stringify([nueva.json, cambiar.json, probar.json]).includes('token-'), 'el mensaje no repite ninguna clave')
  // lo que no necesita el secreto sigue andando
  const est = await pedir('GET', '/api/ia/estado')
  assert.equal(est.status, 200)
  assert.equal(est.json.claves.length, 1, 'la clave de antes no se perdió')
  assert.ok((await pedir('GET', '/api/ia/uso')).status === 200)
  assert.equal((await pedir('PUT', '/api/ia/ajustes', { topeMesUsd: 12 })).status, 200)
  assert.equal((await pedir('POST', '/api/ia/agentes', { nombre: 'Agente', proveedor: 'anthropic', modelo: 'claude-haiku-5-5' })).status, 201)
})

test('sin secreto un trabajo falla con el motivo y NO marca la clave inválida (no está mal la clave: falta la configuración)', async () => {
  const a = await crearAgente(e, { proveedor: 'anthropic', modelo: 'claude-opus-5-5' })
  olvidarAgentes()
  const t = await crearTarjeta(e, 'Sin secreto')
  const c = await e.s.comentar(e.persona, t.clave, '@claude hola')
  assert.ok(c.trabajos?.[0], 'el agente parece listo: hay un trabajo')
  delete process.env.TABLERO_SECRETO_IA
  await correr(e.raiz, 'dueno')
  const [f] = await e.db.consulta(`select estado, motivo from ia_trabajos where id = $1`, [c.trabajos![0]!.id])
  assert.equal(f!.estado, 'fallado')
  assert.match(f!.motivo, /Falta el secreto del servidor/)
  assert.equal((await e.db.consulta(`select estado from ia_claves where id = $1`, [a.claveId]))[0]!.estado, 'valida', 'la clave sigue válida')
})

test('el precio: sin precio el costo no se puede calcular (error tipado) y el ciclo no le pide nada al modelo; con el precio a mano sí', async () => {
  const d = depsDeProduccion()
  const uso = { entrada: 2_500, salida: 450, cacheLectura: 0, cacheEscritura: 10_500 }
  assert.equal(d.costoUsd({ proveedor: 'anthropic', modelo: 'claude-opus-5-5', uso, precioManual: null }), 0.0715, 'el caso del plan (9.7)')
  assert.throws(() => d.costoUsd({ proveedor: 'compatible', modelo: 'modelo-raro', uso, precioManual: null, urlBase: 'https://api.groq.com/openai/v1' }), (x) => x instanceof ErrorSinPrecio && /no conoce el precio/.test(x.paraLaPersona))
  assert.equal(d.costoUsd({ proveedor: 'compatible', modelo: 'modelo-raro', uso, precioManual: { entrada: 1, salida: 2, cacheLectura: 0.1 }, urlBase: 'https://api.groq.com/openai/v1' }), (2_500 * 1 + 450 * 2 + 10_500 * 1) / 1e6)
  assert.equal(d.costoUsd({ proveedor: 'compatible', modelo: 'deepseek-flash', uso, precioManual: null, urlBase: 'https://api.deepseek.com' }) > 0, true, 'el modelo de DeepSeek tiene su precio por la dirección de la clave')

  // un agente que quedó sin precio (se le borró el manual): el trabajo falla antes de pedir nada
  const a = await crearAgente(e, { proveedor: 'compatible', modelo: 'modelo-raro' })
  await e.db.consulta(`update ia_claves set url_base = 'https://api.groq.com/openai/v1' where id = $1`, [a.claveId])
  olvidarAgentes()
  const t = await crearTarjeta(e, 'Sin precio')
  const c = await e.s.comentar(e.persona, t.clave, '@claude hola')
  assert.ok(c.trabajos?.[0])
  await correr(e.raiz, 'dueno')
  const [f] = await e.db.consulta(`select estado, motivo from ia_trabajos where id = $1`, [c.trabajos![0]!.id])
  assert.equal(f!.estado, 'fallado')
  assert.match(f!.motivo, /Telar no conoce el precio de «modelo-raro»/)
  assert.equal((await e.db.consulta(`select count(*)::int as n from ia_uso`))[0]!.n, 0)
  void iaDe
})
