// Pruebas de las rutas de los trabajos y del despacho (tarea 2.13), por HTTP de verdad contra la app de Hono (sin abrir un puerto), en modo
// «online» (TABLERO_PUBLICO=1: con sesión, con la clave del MCP o sin nada) y con el proveedor falso mínimo:
//   · un trabajo arranca solo, sin que la ruta haga nada especial (el middleware lo larga después de contestar);
//   · el sondeo `GET /api/eventos/desde?ia=1` levanta lo vencido (y sin `ia=1`, no);
//   · las rutas internas (`correr`, `diagnostico`, `barrer`) rechazan todo pedido sin su secreto;
//   · lo que gasta o da permiso exige sesión (la clave del MCP da 403); frenar y leer sirven con la clave.
// `npm run ia:probar-rutas`.
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { crearApp, type Estado } from '../api'
import { firmarAlcance, crearSesion, COOKIE_SESION } from '../sesion'
import { conectarIA } from './conectar'
import { correr } from './ejecutor'
import { olvidarAgentes } from './menciones'
import { crearAgente, crearEntorno, crearFalsoDePrueba, crearTarjeta, depsDePrueba, type Entorno } from './prueba-base'
import { tomarMarcadas } from './segundo-plano'
import { iaDe } from './servicio-ia'
import { trabajosDe } from './trabajos'

const CLAVE_MCP = 'clave-del-mcp-de-prueba-rutas'
const SECRETO = 'secreto-de-prueba-de-las-rutas-0123456789-abcdef'
const CRON = 'secreto-del-cron-de-prueba'
const env: Record<string, string | undefined> = {}
let e: Entorno
let app: ReturnType<typeof crearApp>
const falso = crearFalsoDePrueba()
const lineas: string[] = []

before(async () => {
  for (const [k, v] of Object.entries({ TABLERO_PUBLICO: '1', TABLERO_SECRETO: SECRETO, TABLERO_USUARIOS: 'usuario-juego', TABLERO_DIAGNOSTICO: undefined, TABLERO_IA_DIAGNOSTICO_MS: '60', CRON_SECRET: CRON, TABLERO_URL_PUBLICA: 'http://127.0.0.1:1' })) {
    env[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  e = await crearEntorno()
  conectarIA(e.raiz, {
    red: false,
    deps: depsDePrueba(falso, { esperar: async () => {}, punto: () => {} }),
  })
  const estado: Estado = { servicio: e.raiz, listo: Promise.resolve(), clave: CLAVE_MCP, bus: e.bus }
  app = crearApp(estado, { produccion: true })
  const original = console.log
  console.log = (...a: unknown[]) => {
    lineas.push(a.map(String).join(' '))
    original(...a)
  }
})
after(async () => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  conectarIA(e.raiz, { red: false, deps: null })
  await e.cerrar()
})
beforeEach(async () => {
  falso.reiniciar()
  olvidarAgentes()
  tomarMarcadas()
  await e.db.consulta(`update ia_trabajos set estado = 'cancelado', terminado_en = now(), tomado_hasta = null where estado in ('en_cola', 'en_curso', 'esperando_confirmacion', 'pausado_tope')`)
  await e.db.consulta(`update ia_trabajos set creado_en = now() - interval '2 days' where creado_en > now() - interval '1 day'`)
  await e.db.consulta(`delete from ia_uso_mes`)
  await e.db.consulta(`delete from ia_ajustes`)
  await e.db.consulta(`delete from ia_agentes`)
  await e.db.consulta(`delete from menciones`)
})

const sesion = () => `${COOKIE_SESION}=${crearSesion('usuario-juego').valor}`
type Quien = 'sesion' | 'clave' | 'nadie'
async function pedir(quien: Quien, metodo: string, ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra }
  if (quien === 'sesion') headers.cookie = sesion()
  if (quien === 'clave') headers.authorization = `Bearer ${CLAVE_MCP}`
  if (cuerpo !== undefined) headers['content-type'] = 'application/json'
  const r = await app.request(`http://127.0.0.1${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
  const texto = await r.text()
  let json: any = null
  try {
    json = JSON.parse(texto)
  } catch {}
  return { status: r.status, json, texto }
}
const estadoDe = async (id: string) => (await e.db.consulta(`select estado from ia_trabajos where id = $1`, [id]))[0]!.estado as string
async function esperarEstado(id: string, esperado: string, ms = 5_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms && (await estadoDe(id)) !== esperado) await new Promise((r) => setTimeout(r, 25))
  assert.equal(await estadoDe(id), esperado)
}

test('un trabajo arranca solo: comentar con una mención por la ruta alcanza, sin que nada más lo largue', async () => {
  await crearAgente(e, { modelo: 'guion:responder' })
  olvidarAgentes()
  const t = await crearTarjeta(e, 'Arranca solo')
  const r = await pedir('sesion', 'POST', `/api/tarjetas/${t.clave}/comentarios`, { cuerpo: '@claude ¿ya está?', id: 'comentario-arranca-1' })
  assert.equal(r.status, 201, r.texto)
  assert.equal(r.json.trabajos.length, 1, 'la respuesta del propio pedido trae el trabajo (11.6: «Claude está pensando…»)')
  const id = r.json.trabajos[0].id
  await esperarEstado(id, 'hecho')
  assert.equal(falso.pedidos, 1)
  const lista = await pedir('sesion', 'GET', `/api/ia/trabajos?tarjeta=${t.clave}`)
  assert.equal(lista.json[0].estado, 'hecho')
  const det = await pedir('sesion', 'GET', `/api/ia/trabajos/${id}`)
  assert.equal(det.status, 200)
  assert.equal(det.json.pasos.length, 1)
  assert.equal(det.json.tokens.entrada, 1000)
})

test('T21 · con la clave del MCP: comentar mencionando a un agente deja la mención pendiente y no hay trabajo; confirmar y reanudar dan 403', async () => {
  const a = await crearAgente(e, { modelo: 'guion:archivar', permisos: ['comentar', 'tarjetas', 'archivar'] })
  olvidarAgentes()
  const t = await crearTarjeta(e, 'Con la clave')
  const r = await pedir('clave', 'POST', `/api/tarjetas/${t.clave}/comentarios`, { cuerpo: '@claude por la clave' })
  assert.equal(r.status, 201, r.texto)
  assert.equal(r.json.trabajos, undefined)
  assert.equal(r.json.menciones[0].estado, 'pendiente')
  assert.equal((await e.db.consulta(`select count(*)::int as n from ia_trabajos where contexto->>'tarjetaClave' = $1`, [t.clave]))[0]!.n, 0)
  // un trabajo que sí existe (con sesión), pausado por permiso y por tope, para confirmar y reanudar
  const ok = await pedir('sesion', 'POST', `/api/tarjetas/${t.clave}/comentarios`, { cuerpo: '@claude archivala' })
  const id = ok.json.trabajos[0].id
  await esperarEstado(id, 'esperando_confirmacion')
  const ll = (await trabajosDe(iaDe(e.s)).llamadas(id))[0]!
  const dec = { decisiones: [{ llamadaId: ll.id, permitir: true }] }
  assert.equal((await pedir('clave', 'POST', `/api/ia/trabajos/${id}/confirmar`, dec)).status, 403)
  assert.equal((await pedir('clave', 'POST', `/api/ia/trabajos/${id}/reanudar`, {})).status, 403)
  assert.equal((await pedir('clave', 'POST', `/api/ia/menciones/${r.json.menciones[0].id}/reintentar`, {})).status, 403)
  assert.equal((await pedir('nadie', 'POST', `/api/ia/trabajos/${id}/confirmar`, dec)).status, 401)
  assert.equal(await estadoDe(id), 'esperando_confirmacion', 'nada cambió')
  // la clave sí puede leer el estado y frenar
  assert.equal((await pedir('clave', 'GET', `/api/ia/trabajos/${id}`)).json.estado, 'esperando_confirmacion')
  assert.equal((await pedir('clave', 'GET', `/api/ia/trabajos?vivos=1`)).status, 200)
  // con sesión sí se permite, y el trabajo sigue y termina solo (el middleware lo larga de nuevo)
  const ya = await pedir('sesion', 'POST', `/api/ia/trabajos/${id}/confirmar`, dec)
  assert.equal(ya.status, 200, ya.texto)
  await esperarEstado(id, 'hecho')
  assert.equal((await e.s.leerTarjeta(t.clave)).archivada, true)
  void a
})

test('cancelar: con la clave del MCP alcanza; un trabajo ajeno o inexistente da 404', async () => {
  await crearAgente(e, { modelo: 'guion:responder' })
  olvidarAgentes()
  const t = await crearTarjeta(e, 'Frenar')
  const ia = iaDe(e.s)
  const tb = trabajosDe(ia)
  const agente = (await tb.agente((await e.s.asegurarMiembroIA('Claude')).id))!
  const c = await tb.crear({ agente, origen: 'mencion', superficie: 'tarjeta', contexto: { tarjetaId: t.id, tarjetaClave: t.clave }, pedido: 'x', pedidoPor: e.persona.actor, demoraMs: 3_600_000 })
  assert.equal(c.tipo, 'creado')
  const id = (c as { trabajo: { id: string } }).trabajo.id
  assert.equal((await pedir('clave', 'POST', `/api/ia/trabajos/${id}/cancelar`, {})).json.estado, 'cancelado')
  assert.equal((await pedir('sesion', 'POST', `/api/ia/trabajos/tr_no_existe/cancelar`, {})).status, 404)
  assert.equal((await pedir('sesion', 'GET', `/api/ia/trabajos/tr_no_existe`)).status, 404)
  assert.equal((await pedir('sesion', 'POST', `/api/ia/trabajos/${id}/confirmar`, { decisiones: [] })).status, 400, 'hay que decidir algo')
})

test('el sondeo con ia=1 levanta lo vencido y sin ia=1 no', async () => {
  await crearAgente(e, { modelo: 'guion:responder' })
  const t = await crearTarjeta(e, 'Red del sondeo')
  const tb = trabajosDe(iaDe(e.s))
  const agente = (await tb.agente((await e.s.asegurarMiembroIA('Claude')).id))!
  const c = await tb.crear({ agente, origen: 'mencion', superficie: 'tarjeta', contexto: { tarjetaId: t.id, tarjetaClave: t.clave }, pedido: 'x', pedidoPor: e.persona.actor })
  const id = (c as { trabajo: { id: string } }).trabajo.id
  tomarMarcadas() // como si el proceso que lo creó hubiera muerto antes de largarlo
  const sin = await pedir('sesion', 'GET', '/api/eventos/desde?n=1')
  assert.equal(sin.status, 200)
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(await estadoDe(id), 'en_cola', 'sin ia=1 nadie lo levanta')
  const con = await pedir('sesion', 'GET', '/api/eventos/desde?n=1&ia=1')
  assert.equal(con.status, 200)
  await esperarEstado(id, 'hecho')
  // y la bandera es de la cuenta del pedido: no hay nada vencido, no hace nada
  assert.equal((await pedir('sesion', 'GET', '/api/eventos/desde?n=1&ia=1')).status, 200)
})

test('las rutas internas rechazan todo pedido sin su secreto (401) y con él hacen lo suyo', async () => {
  // correr: la clave del MCP Y la cuenta firmada
  const sinNada = await pedir('nadie', 'POST', '/api/ia/interno/correr', {})
  assert.equal(sinNada.status, 401)
  assert.equal((await pedir('sesion', 'POST', '/api/ia/interno/correr', {})).status, 401, 'una sesión no alcanza')
  assert.equal((await pedir('clave', 'POST', '/api/ia/interno/correr', {})).status, 401, 'la clave sola, sin la cuenta firmada, no alcanza')
  assert.equal((await pedir('clave', 'POST', '/api/ia/interno/correr', {}, { 'x-tablero-alcance': 'a1.dueno.9999999999.firma-falsa' })).status, 401)
  assert.equal((await pedir('nadie', 'POST', '/api/ia/interno/correr', {}, { 'x-tablero-alcance': firmarAlcance('dueno') })).status, 401, 'la cuenta firmada sola, sin la clave, tampoco')
  await crearAgente(e, { modelo: 'guion:responder' })
  const t = await crearTarjeta(e, 'Encadenada')
  const tb = trabajosDe(iaDe(e.s))
  const agente = (await tb.agente((await e.s.asegurarMiembroIA('Claude')).id))!
  const c = await tb.crear({ agente, origen: 'mencion', superficie: 'tarjeta', contexto: { tarjetaId: t.id, tarjetaClave: t.clave }, pedido: 'x', pedidoPor: e.persona.actor })
  const id = (c as { trabajo: { id: string } }).trabajo.id
  tomarMarcadas()
  const ok = await pedir('clave', 'POST', '/api/ia/interno/correr', {}, { 'x-tablero-alcance': firmarAlcance('dueno') })
  assert.equal(ok.status, 202)
  await esperarEstado(id, 'hecho')

  // diagnóstico: solo con la clave; responde enseguida y deja la línea después, sin tocar datos
  assert.equal((await pedir('nadie', 'POST', '/api/ia/interno/diagnostico', {})).status, 401)
  assert.equal((await pedir('sesion', 'POST', '/api/ia/interno/diagnostico', {})).status, 401)
  const antes = lineas.filter((l) => l.includes('segundo plano ok')).length
  const d = await pedir('clave', 'POST', '/api/ia/interno/diagnostico', {})
  assert.equal(d.status, 200)
  assert.equal(lineas.filter((l) => l.includes('segundo plano ok')).length, antes, 'todavía no')
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(lineas.filter((l) => l.includes('segundo plano ok')).length, antes + 1)

  // barrer: solo con CRON_SECRET (ni la clave del MCP ni una sesión)
  assert.equal((await pedir('nadie', 'GET', '/api/ia/interno/barrer')).status, 401)
  assert.equal((await pedir('clave', 'GET', '/api/ia/interno/barrer')).status, 401)
  assert.equal((await pedir('sesion', 'GET', '/api/ia/interno/barrer')).status, 401)
  assert.equal((await pedir('nadie', 'GET', '/api/ia/interno/barrer', undefined, { authorization: 'Bearer otro-secreto' })).status, 401)
  assert.equal((await pedir('nadie', 'POST', '/api/ia/interno/barrer', {})).status, 401)
  const cron = await pedir('nadie', 'GET', '/api/ia/interno/barrer', undefined, { authorization: `Bearer ${CRON}` })
  assert.equal(cron.status, 200, cron.texto)
  assert.equal(typeof cron.json.cuentas, 'number')
  assert.equal(typeof cron.json.limpiados, 'number')
  // sin CRON_SECRET en el entorno, no hay cron: todo se rechaza
  delete process.env.CRON_SECRET
  assert.equal((await pedir('nadie', 'GET', '/api/ia/interno/barrer', undefined, { authorization: `Bearer ${CRON}` })).status, 401)
  process.env.CRON_SECRET = CRON
})

test('el cron levanta un trabajo trabado (préstamo vencido) y hace el mantenimiento', async () => {
  await crearAgente(e, { modelo: 'guion:responder' })
  const t = await crearTarjeta(e, 'Trabado')
  const tb = trabajosDe(iaDe(e.s))
  const agente = (await tb.agente((await e.s.asegurarMiembroIA('Claude')).id))!
  const c = await tb.crear({ agente, origen: 'mencion', superficie: 'tarjeta', contexto: { tarjetaId: t.id, tarjetaClave: t.clave }, pedido: 'x', pedidoPor: e.persona.actor })
  const id = (c as { trabajo: { id: string } }).trabajo.id
  tomarMarcadas()
  const tomado = await tb.tomar() // un proceso lo toma y muere
  assert.equal(tomado!.id, id)
  await e.db.consulta(`update ia_trabajos set tomado_hasta = now() - interval '1 second' where id = $1`, [id])
  const r = await pedir('nadie', 'GET', '/api/ia/interno/barrer', undefined, { authorization: `Bearer ${CRON}` })
  assert.equal(r.json.cuentas, 1)
  assert.equal(await estadoDe(id), 'hecho')
  void correr
})

test('/api/novedades trae los trabajos de la semana y lo que espera; la web los ve al abrir', async () => {
  await crearAgente(e, { modelo: 'guion:responder', sinClave: true })
  olvidarAgentes()
  const t = await crearTarjeta(e, 'Novedades')
  await pedir('sesion', 'POST', `/api/tarjetas/${t.clave}/comentarios`, { cuerpo: '@claude ¿estás?' })
  const nov = await pedir('sesion', 'GET', '/api/novedades')
  assert.equal(nov.status, 200)
  assert.equal(nov.json.esperando.length, 1)
  assert.equal(nov.json.esperando[0].motivo, 'No tiene clave.')
  assert.deepEqual(nov.json.trabajos, [])
})
