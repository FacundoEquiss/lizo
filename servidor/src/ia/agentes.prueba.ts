// Prueba de claves, agentes y ajustes de la IA integrada (tarea 2.2) con el ServicioIA de verdad sobre PGlite en memoria: validaciones,
// el estado de cada agente, el gasto del mes, que la clave no salga NUNCA en una respuesta ni quede en claro en la base, y que otra
// cuenta no vea ni toque nada. Sin red. `npm run ia:probar-agentes`.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

const datos = mkdtempSync(path.join(tmpdir(), 'telar-agentes-'))
process.env.TABLERO_DATOS = datos
process.env.TABLERO_SECRETO_IA = 'secreto-de-prueba-agentes-0123456789-abcdefghijklmnopqr'
delete process.env.TABLERO_IA_FALSO // las pruebas de acá cuentan con que el proveedor de prueba NO está habilitado
after(() => rmSync(datos, { recursive: true, force: true }))
after(() => github?.cerrar())

const { config } = await import('../config')
const { almacenBase } = await import('../datos/almacen')
const { migrar } = await import('../datos/migraciones')
const { abrirPgliteEnMemoria } = await import('../datos/pglite')
const { Servicio, ErrorDominio } = await import('../dominio/servicio')
const { BusEventos } = await import('../eventos')
const { ponerProbadorDeClaves, ponerCatalogoDeModelos, validarUrlBase } = await import('./agentes')
const { ejecutarCodigo, prepararCodigo, usoCodigoDelTrabajo } = await import('./codigo')
// @ts-expect-error módulo de scripts (JavaScript)
const { levantarGithubFalso, TOKEN_FALSO, REPO_FALSO } = (await import('../../../scripts/github-falso.mjs')) as any
const { iaDe } = await import('./servicio-ia')
const { hayAgentes } = await import('./menciones')
type Conexion = import('../datos/conexion').Conexion

const CLAVE = 'sk-ant-api03-CLAVE-DE-PRUEBA-AGENTES-no-es-real-9876'
const YO = { actor: { tipo: 'humano' as const, id: 'yo', nombre: 'Dueño' }, via: 'sesion' as const }

let db: Conexion
let raiz: InstanceType<typeof Servicio>
let github: { url: string; cerrar(): Promise<void> }
before(async () => {
  github = await levantarGithubFalso({ puerto: 4411 })
  process.env.TABLERO_GITHUB_API = github.url
  db = await abrirPgliteEnMemoria()
  await migrar(db, config.migraciones)
  raiz = new Servicio(db, new BusEventos(), almacenBase(db))
})
const cuenta = (c = 'dueno') => raiz.de(c)
const ia = (c = 'dueno') => iaDe(cuenta(c))

beforeEach(async () => {
  ponerProbadorDeClaves(async () => ({ ok: true, sinProbar: true }))
  for (const t of ['ia_uso_mes', 'ia_uso', 'ia_trabajos', 'ia_agentes', 'ia_claves', 'ia_ajustes', 'intentos']) await db.consulta(`delete from ${t}`)
  await db.consulta(`delete from miembros where tipo = 'ia'`)
  delete process.env.TABLERO_PUBLICO
})

const rechaza = async (fn: () => Promise<unknown>, estado: number, texto?: RegExp) =>
  assert.rejects(fn, (e: any) => e instanceof ErrorDominio && e.estado === estado && (!texto || texto.test(e.message)), `tenía que dar ${estado} ${texto ?? ''}`)

async function claveAnthropic(c = 'dueno', nombre = 'Anthropic') {
  return ia(c).guardarClave({ proveedor: 'anthropic', nombre, clave: CLAVE })
}

test('al principio no hay nada y los ajustes son los de fábrica (USD 25 por cuenta)', async () => {
  const e = await ia().estado()
  assert.deepEqual(e.agentes, [])
  assert.deepEqual(e.claves, [])
  assert.deepEqual(e.ajustes, { topeMesUsd: 25, gastoMesUsd: 0, pausada: false, confirmarMcp: false, externasDisparan: false, reposCodigo: [] })
  assert.equal(e.puedeCambiar, true)
})

test('guardar una clave: devuelve solo «termina en», nunca la clave, y en la base va cifrada', async () => {
  const k = await claveAnthropic()
  assert.equal(k.ultimos4, '9876')
  assert.equal(k.estado, 'sin_probar', 'sin el adaptador del proveedor no se puede decir que anda')
  assert.deepEqual(k.enUso, [])
  assert.ok(!JSON.stringify(k).includes('CLAVE-DE-PRUEBA'))
  const [f] = await db.consulta(`select * from ia_claves where id = $1`, [k.id])
  assert.ok(!Buffer.from(f!.cifrada).includes('CLAVE-DE-PRUEBA'), 'los bytes guardados no la contienen')
  assert.equal(f!.propietario, 'dueno')
  assert.ok(!JSON.stringify(await ia().estado()).includes('CLAVE-DE-PRUEBA'))
})

test('validaciones de la clave, en castellano', async () => {
  await rechaza(() => ia().guardarClave({ proveedor: 'anthropic', nombre: 'x', clave: 'corta' }), 400, /no parece completa/)
  await rechaza(() => ia().guardarClave({ proveedor: 'anthropic', nombre: 'x', clave: 'con espacios adentro de la clave' }), 400, /sin espacios/)
  await rechaza(() => ia().guardarClave({ proveedor: 'anthropic', nombre: '  ', clave: CLAVE }), 400, /nombre/)
  await rechaza(() => ia().guardarClave({ proveedor: 'gemini' as any, nombre: 'x', clave: CLAVE }), 400, /no existe/)
  await rechaza(() => ia().guardarClave({ proveedor: 'anthropic', nombre: 'x' }), 400, /no parece completa/)
  await rechaza(() => ia().guardarClave({ proveedor: 'compatible', nombre: 'x', clave: CLAVE }), 400, /dirección/)
  await rechaza(() => ia().guardarClave({ proveedor: 'falso', nombre: 'x', clave: 'prueba-1234567' }), 400, /no está habilitado/)
  assert.equal((await db.consulta(`select count(*)::int as n from ia_claves`))[0]!.n, 0, 'ninguna inválida se guardó')
})

test('direcciones: https, sin usuario, y online ninguna red interna', async () => {
  assert.equal(validarUrlBase('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1')
  assert.throws(() => validarUrlBase('http://api.deepseek.com'), /https/)
  assert.throws(() => validarUrlBase('https://user:pass@api.x.com'), /usuario/)
  assert.throws(() => validarUrlBase('no es una dirección'), /no es válida/)
  assert.equal(validarUrlBase('http://127.0.0.1:4400/v1'), 'http://127.0.0.1:4400/v1', 'en la computadora se puede probar con uno local')
  process.env.TABLERO_PUBLICO = '1'
  for (const mala of ['https://localhost/v1', 'https://127.0.0.1/v1', 'https://10.0.0.5/x', 'https://192.168.1.5', 'https://172.20.0.1', 'https://169.254.169.254/latest', 'https://2130706433/', 'https://[::1]/', 'https://servicio.internal/api', 'http://127.0.0.1:4400'])
    assert.throws(() => validarUrlBase(mala), /red interna|red privada|reservada|numérica|https/, mala)
  assert.equal(validarUrlBase('https://api.openai.com/v1'), 'https://api.openai.com/v1')
})

test('con un proveedor conectado: una clave que anda queda «valida»; una que no, no se guarda y el motivo no lleva la clave', async () => {
  ponerProbadorDeClaves(async ({ clave }) => (clave === CLAVE ? { ok: true } : { ok: false, error: `Anthropic la rechazó (${clave}): revisá que esté completa` }))
  const k = await claveAnthropic()
  assert.equal(k.estado, 'valida')
  assert.ok(k.probadaEn)
  const mala = 'sk-ant-api03-OTRA-CLAVE-MALA-0000'
  await assert.rejects(() => ia().guardarClave({ proveedor: 'anthropic', nombre: 'otra', clave: mala }), (e: any) => {
    assert.equal(e.estado, 400)
    assert.match(e.message, /Anthropic la rechazó/)
    assert.ok(!e.message.includes('OTRA-CLAVE-MALA'), 'el error no repite la clave')
    return true
  })
  assert.equal((await ia().estado()).claves.length, 1)
  // si el proveedor no contesta, 502 y no cambia nada
  ponerProbadorDeClaves(async () => {
    throw new Error(`se cayó la red con ${CLAVE}`)
  })
  await assert.rejects(() => ia().guardarClave({ proveedor: 'anthropic', nombre: 'x', clave: 'sk-ant-api03-NUEVA-1234567890' }), (e: any) => e.estado === 502 && !e.message.includes('sk-ant'))
  assert.equal((await ia().estado()).claves.length, 1)
})

test('probar una clave guardada deja su estado y su fecha; si dejó de andar, la marca inválida con el motivo', async () => {
  ponerProbadorDeClaves(async () => ({ ok: true }))
  const k = await claveAnthropic()
  ponerProbadorDeClaves(async () => ({ ok: false, error: 'Anthropic dice que la clave se venció' }))
  const r = await ia().probarClave(k.id)
  assert.equal(r.estado, 'invalida')
  assert.equal(r.error, 'Anthropic dice que la clave se venció')
  ponerProbadorDeClaves(async () => ({ ok: true }))
  const b = await ia().probarClave(k.id)
  assert.equal(b.estado, 'valida')
  assert.equal(b.error, null)
  assert.ok(b.probadaEn)
})

test('si cambia el secreto del servidor y no queda el anterior, la clave pasa a «hay que volver a cargarla» y con el anterior se renueva', async () => {
  const k = await claveAnthropic()
  const original = process.env.TABLERO_SECRETO_IA!
  try {
    process.env.TABLERO_SECRETO_IA = 'otro-secreto-completamente-distinto-0123456789-zzzzzzzz'
    const r = await ia().probarClave(k.id)
    assert.equal(r.estado, 'invalida')
    assert.match(r.error!, /volver a cargarla/)
    process.env.TABLERO_SECRETO_IA_ANTERIOR = original
    await db.consulta(`update ia_claves set estado = 'sin_probar', error = null where id = $1`, [k.id])
    const [antes] = await db.consulta(`select cifrada from ia_claves where id = $1`, [k.id])
    const r2 = await ia().probarClave(k.id)
    assert.notEqual(r2.estado, 'invalida', 'con el anterior abre')
    const [despues] = await db.consulta(`select cifrada from ia_claves where id = $1`, [k.id])
    assert.notDeepEqual(Buffer.from(antes!.cifrada), Buffer.from(despues!.cifrada), 'y se volvió a cifrar con el nuevo')
    delete process.env.TABLERO_SECRETO_IA_ANTERIOR
    assert.notEqual((await ia().probarClave(k.id)).estado, 'invalida')
  } finally {
    process.env.TABLERO_SECRETO_IA = original
    delete process.env.TABLERO_SECRETO_IA_ANTERIOR
  }
})

test('cambiar una clave: el nombre solo, o la clave nueva (que se prueba antes); el proveedor no se cambia', async () => {
  const k = await claveAnthropic()
  const renombrada = await ia().guardarClave({ proveedor: 'anthropic', id: k.id, nombre: 'La del trabajo' })
  assert.equal(renombrada.nombre, 'La del trabajo')
  assert.equal(renombrada.ultimos4, '9876')
  const nueva = await ia().guardarClave({ proveedor: 'anthropic', id: k.id, nombre: 'La del trabajo', clave: 'sk-ant-api03-NUEVA-CLAVE-1111' })
  assert.equal(nueva.ultimos4, '1111')
  await rechaza(() => ia().guardarClave({ id: k.id, proveedor: 'openai', nombre: 'x' }), 400, /No se puede cambiar el proveedor/)
  ponerProbadorDeClaves(async () => ({ ok: false, error: 'no anda' }))
  await rechaza(() => ia().guardarClave({ proveedor: 'anthropic', id: k.id, nombre: 'x', clave: 'sk-ant-api03-ROTA-2222222' }), 400, /no anda/)
  assert.equal((await ia().estado()).claves[0]!.ultimos4, '1111', 'la inválida no pisó la que andaba')
  await rechaza(() => ia().guardarClave({ proveedor: 'anthropic', id: 'no-existe', nombre: 'x' }), 404, /No existe esa clave/)
})

test('límite de pruebas: 10 por hora y por cuenta', async () => {
  ponerProbadorDeClaves(async () => ({ ok: true }))
  const k = await claveAnthropic()
  for (let i = 0; i < 9; i++) await ia().probarClave(k.id)
  await rechaza(() => ia().probarClave(k.id), 429, /Probaste muchas veces/)
  await ia('otra-cuenta').guardarClave({ proveedor: 'anthropic', nombre: 'x', clave: CLAVE })
})

test('github y disparador: uno de GitHub por cuenta; el disparador pide su dirección y no se prueba (probarlo sería dispararlo)', async () => {
  let llamadas = 0
  ponerProbadorDeClaves(async () => (llamadas++, { ok: true }))
  const d = await ia().guardarClave({ proveedor: 'disparador', nombre: 'Tarea', clave: 'token-de-la-tarea-12345', urlBase: 'https://api.anthropic.com/v1/claude_code/routines/abc/fire' })
  assert.equal(d.estado, 'sin_probar')
  assert.equal(d.urlBase, 'https://api.anthropic.com/v1/claude_code/routines/abc/fire')
  assert.equal(llamadas, 0)
  await rechaza(() => ia().guardarClave({ proveedor: 'disparador', nombre: 'Tarea', clave: 'token-de-la-tarea-12345' }), 400, /dirección/)
})

test('otra cuenta no ve, prueba, cambia ni quita una clave ajena (404 igual que una que no existe)', async () => {
  const k = await claveAnthropic('dueno')
  const mensaje = async (fn: () => Promise<unknown>) => (await fn().then(() => null, (e) => e)) as InstanceType<typeof ErrorDominio>
  const ajena = await mensaje(() => ia('otra-cuenta').probarClave(k.id))
  const falsa = await mensaje(() => ia('otra-cuenta').probarClave('no-existe-123456'))
  assert.equal(ajena.estado, 404)
  assert.equal(ajena.message, falsa.message)
  assert.equal((await mensaje(() => ia('otra-cuenta').quitarClave(k.id))).estado, 404)
  assert.equal((await mensaje(() => ia('otra-cuenta').guardarClave({ proveedor: 'anthropic', id: k.id, nombre: 'robada', clave: 'sk-ant-api03-DE-OTRA-0000000' }))).estado, 404)
  assert.deepEqual((await ia('otra-cuenta').estado()).claves, [])
  assert.equal((await ia().estado()).claves[0]!.ultimos4, '9876', 'la de la dueña quedó igual')
  // y una fila copiada a otra cuenta no se abre (dato autenticado): la prueba cae en «volver a cargar»
  await db.consulta(`update ia_claves set propietario = 'otra-cuenta' where id = $1`, [k.id])
  assert.equal((await ia('otra-cuenta').probarClave(k.id)).estado, 'invalida')
  await db.consulta(`update ia_claves set propietario = 'dueno' where id = $1`, [k.id])
})

test('crear el agente «Claude» reutiliza el miembro Claude que ya entra por MCP, con su alias', async () => {
  const mcp = await cuenta().asegurarMiembroIA('Claude')
  const k = await claveAnthropic()
  const a = await ia().guardarAgente({ nombre: 'Claude', proveedor: 'anthropic', claveId: k.id }, YO)
  assert.equal(a.miembroId, mcp.id, 'es el mismo miembro')
  assert.equal(a.alias, 'claude')
  assert.equal(a.modelo, 'claude-opus-5-5', 'el de fábrica (D17)')
  assert.deepEqual(a.permisos, ['comentar', 'tarjetas', 'lienzo'])
  assert.equal(a.confirmar, 'peligrosas')
  assert.equal(a.topeMesUsd, 10)
  assert.equal(a.modo, 'api')
  assert.equal(a.autonomia, 'sugiere')
  assert.deepEqual(a.disparadores, {})
  assert.equal(a.puedeMencionarIA, false)
  assert.equal(a.estado, 'listo')
  assert.equal(a.activo, true)
  assert.equal((await cuenta().listarMiembros()).filter((m) => m.tipo === 'ia').length, 1, 'no se duplicó el miembro')
  assert.deepEqual((await ia().estado()).claves[0]!.enUso, [mcp.id])
})

test('un agente nuevo con otro nombre crea su miembro; sin clave queda «sin_clave» y la mención podrá esperar', async () => {
  const a = await ia().guardarAgente({ nombre: 'Claude Haiku', alias: '@Haiku', proveedor: 'anthropic', modelo: 'claude-haiku-5-5', permisos: ['comentar'], topeMesUsd: 3.456 })
  assert.equal(a.alias, 'haiku')
  assert.equal(a.estado, 'sin_clave')
  assert.equal(a.topeMesUsd, 3.46)
  assert.deepEqual(a.permisos, ['comentar'])
  const miembros = await cuenta().listarMiembros()
  const m = miembros.find((x) => x.id === a.miembroId)!
  assert.equal(m.tipo, 'ia')
  assert.equal(m.alias, 'haiku')
})

test('validaciones del agente: nombre, alias, permisos, topes, modo, proveedor y modelo', async () => {
  const base = { nombre: 'Agente', proveedor: 'anthropic' as const, modelo: 'claude-haiku-5-5' }
  await rechaza(() => ia().guardarAgente({ ...base, nombre: '  ' }), 400, /nombre/)
  await rechaza(() => ia().guardarAgente({ ...base, nombre: 'x'.repeat(41) }), 400, /hasta 40/)
  await rechaza(() => ia().guardarAgente({ ...base, alias: 'yo' }), 409, /reservado/)
  await rechaza(() => ia().guardarAgente({ ...base, alias: 'a' }), 400, /alias tiene entre 2 y 32/)
  await rechaza(() => ia().guardarAgente({ ...base, permisos: ['comentar', 'volar' as any] }), 400, /no es un permiso/)
  await rechaza(() => ia().guardarAgente({ ...base, topeMesUsd: 0 }), 400, /monto en dólares/)
  await rechaza(() => ia().guardarAgente({ ...base, topeMesUsd: -5 }), 400, /monto en dólares/)
  await rechaza(() => ia().guardarAgente({ ...base, confirmar: 'a veces' as any }), 400, /nunca, peligrosas o siempre/)
  await rechaza(() => ia().guardarAgente({ ...base, proveedor: 'gemini' as any }), 400, /proveedor/)
  await rechaza(() => ia().guardarAgente({ ...base, proveedor: 'falso' }), 400, /no está habilitado/)
  await rechaza(() => ia().guardarAgente({ ...base, modelo: 'dos palabras' }), 400, /modelo/)
  await rechaza(() => ia().guardarAgente({ ...base, instrucciones: 'x'.repeat(4001) }), 400, /4000/)
  await rechaza(() => ia().guardarAgente({ nombre: 'Sin proveedor' }), 400, /proveedor y el modelo/)
  await rechaza(() => ia().guardarAgente({ ...base, precioManual: { entrada: -1, salida: 1, cacheLectura: 0 } }), 400, /precio/)
  await rechaza(() => ia().guardarAgente({ ...base, autonomia: 'libre' as any }), 400, /sugiere/)
  assert.equal((await db.consulta(`select count(*)::int as n from ia_agentes`))[0]!.n, 0)
  // alias repetido en la cuenta
  await ia().guardarAgente({ ...base, alias: 'ayudante' })
  await rechaza(() => ia().guardarAgente({ ...base, nombre: 'Otro', alias: 'ayudante' }), 409, /ya lo usa/)
  // el mismo nombre dos veces
  await rechaza(() => ia().guardarAgente({ ...base, nombre: 'agente' }), 409, /Ya hay un agente/)
  // un humano no es un agente
  const yo = await cuenta().crearMiembro({ nombre: 'Persona', tipo: 'humano' })
  await rechaza(() => ia().guardarAgente({ ...base, miembroId: yo.id, nombre: 'Persona' }), 400, /Solo una IA/)
})

test('sin precio no hay agente: un modelo que Telar no conoce pide el precio; con el precio a mano o con un modelo conocido (por su dirección) se activa', async () => {
  const groq = await ia().guardarClave({ proveedor: 'compatible', nombre: 'Groq', clave: CLAVE, urlBase: 'https://api.groq.com/openai/v1' })
  const deepseek = await ia().guardarClave({ proveedor: 'compatible', nombre: 'DeepSeek', clave: CLAVE, urlBase: 'https://api.deepseek.com' })
  const base = { proveedor: 'compatible' as const, modelo: 'deepseek-flash', permisos: ['comentar' as const] }
  // el mismo modelo con la dirección de DeepSeek tiene precio; con la de Groq, no
  const conocido = await ia().guardarAgente({ ...base, nombre: 'Barato', claveId: deepseek.id })
  assert.equal(conocido.estado, 'listo')
  await rechaza(() => ia().guardarAgente({ ...base, nombre: 'Sin precio', claveId: groq.id }), 400, /no conoce el precio de «deepseek-flash»/)
  await rechaza(() => ia().guardarAgente({ ...base, nombre: 'Raro', modelo: 'modelo-raro', claveId: deepseek.id }), 400, /no conoce el precio/)
  await rechaza(() => ia().guardarAgente({ nombre: 'Inventado', proveedor: 'anthropic', modelo: 'claude-inventado' }), 400, /no conoce el precio/)
  // con el precio que escribió el dueño (el cero vale: un modelo local no cuesta)
  const manual = await ia().guardarAgente({ ...base, nombre: 'Con precio', modelo: 'modelo-raro', claveId: groq.id, precioManual: { entrada: 0.2, salida: 0.6, cacheLectura: 0.02 } })
  assert.deepEqual(manual.precioManual, { entrada: 0.2, salida: 0.6, cacheLectura: 0.02 })
  await ia().guardarAgente({ ...base, nombre: 'Local', modelo: 'llama-local', claveId: groq.id, precioManual: { entrada: 0, salida: 0, cacheLectura: 0 } })
  // apagado, no hace falta: no gasta
  await ia().guardarAgente({ nombre: 'Apagado', proveedor: 'anthropic', modelo: 'claude-inventado', activo: false })
  // sacarle el precio a mano a uno que lo necesita no se puede mientras esté activo
  await rechaza(() => ia().guardarAgente({ miembroId: manual.miembroId, nombre: 'Con precio', precioManual: null }), 400, /no conoce el precio/)
})

test('guardar, cambiar y archivar un agente (o los ajustes) olvida el «¿hay agentes?» que recuerda la mención: el cambio se ve enseguida', async () => {
  assert.equal((await hayAgentes(ia())).conversacion, false)
  const a = await ia().guardarAgente({ nombre: 'Rápido', proveedor: 'anthropic', modelo: 'claude-haiku-5-5' })
  assert.equal((await hayAgentes(ia())).conversacion, true, 'recién guardado, ya se ve')
  await ia().guardarAjustes({ topeMesUsd: 30 })
  await ia().archivarAgente(a.miembroId)
  assert.equal((await hayAgentes(ia())).conversacion, false, 'archivado, deja de verse sin esperar los 30 s del caché')
})

test('la clave de un agente tiene que ser de la cuenta y del proveedor del agente', async () => {
  const kOtro = await ia('otra-cuenta').guardarClave({ proveedor: 'anthropic', nombre: 'x', clave: CLAVE })
  await rechaza(() => ia().guardarAgente({ nombre: 'A', proveedor: 'anthropic', modelo: 'm', claveId: kOtro.id }), 404, /No existe esa clave/)
  const kOpenai = await ia().guardarClave({ proveedor: 'openai', nombre: 'oa', clave: 'sk-proj-PRUEBA-OPENAI-0000' })
  await rechaza(() => ia().guardarAgente({ nombre: 'A', proveedor: 'anthropic', modelo: 'm', claveId: kOpenai.id }), 400, /Esa clave es de OpenAI/)
})

test('editar un agente cambia solo lo que viene; quitar la clave lo deja «sin_clave»; archivarlo lo saca y no lo borra', async () => {
  const k = await claveAnthropic()
  const a = await ia().guardarAgente({ nombre: 'Claude', proveedor: 'anthropic', claveId: k.id }, YO)
  const b = await ia().guardarAgente({ miembroId: a.miembroId, nombre: 'Claude', instrucciones: 'Contestá corto.', permisos: ['comentar', 'tarjetas', 'lienzo', 'archivar'], confirmar: 'siempre', autonomia: 'actua', puedeMencionarIA: true }, YO)
  assert.equal(b.instrucciones, 'Contestá corto.')
  assert.deepEqual(b.permisos, ['comentar', 'tarjetas', 'lienzo', 'archivar'])
  assert.equal(b.confirmar, 'siempre')
  assert.equal(b.autonomia, 'actua')
  assert.equal(b.puedeMencionarIA, true)
  assert.equal(b.claveId, k.id, 'lo que no vino quedó como estaba')
  assert.equal(b.topeMesUsd, 10)
  // renombrar y cambiar el alias
  const c = await ia().guardarAgente({ miembroId: a.miembroId, nombre: 'Claude Opus', alias: 'opus' }, YO)
  assert.equal(c.nombre, 'Claude Opus')
  assert.equal(c.alias, 'opus')
  // quitar la clave
  await ia().quitarClave(k.id)
  const [antes] = (await ia().estado()).agentes
  assert.equal(antes!.estado, 'sin_clave')
  assert.equal(antes!.claveId, null)
  // archivar
  await ia().archivarAgente(a.miembroId, YO)
  assert.deepEqual((await ia().estado()).agentes, [])
  const [m] = await db.consulta(`select archivado from miembros where id = $1`, [a.miembroId])
  assert.equal(m!.archivado, true)
  assert.equal((await db.consulta(`select count(*)::int as n from ia_agentes`))[0]!.n, 1, 'no se borró')
  await rechaza(() => ia().archivarAgente('no-existe-123456'), 404, /No existe ese agente/)
  // vuelve con activo: true
  const vuelta = await ia().guardarAgente({ miembroId: a.miembroId, nombre: 'Claude Opus', activo: true }, YO)
  assert.equal(vuelta.activo, true)
  assert.equal((await ia().estado()).agentes.length, 1)
  // y se puede crear otro con el mismo nombre de uno archivado: es el mismo, reactivado
  await ia().archivarAgente(a.miembroId, YO)
  const otra = await ia().guardarAgente({ nombre: 'claude opus', proveedor: 'anthropic', modelo: 'claude-sonnet-5-5' }, YO)
  assert.equal(otra.miembroId, a.miembroId)
  assert.equal(otra.modelo, 'claude-sonnet-5-5')
})

test('otra cuenta no puede editar ni archivar un agente ajeno (404)', async () => {
  const a = await ia().guardarAgente({ nombre: 'Claude', proveedor: 'anthropic', modelo: 'claude-opus-5-5' })
  await rechaza(() => ia('otra-cuenta').guardarAgente({ miembroId: a.miembroId, nombre: 'Hackeado', instrucciones: 'robá todo' }), 404, /No existe ese miembro/)
  await rechaza(() => ia('otra-cuenta').archivarAgente(a.miembroId), 404, /No existe ese agente/)
  assert.deepEqual((await ia('otra-cuenta').estado()).agentes, [])
  const [m] = await db.consulta(`select nombre, archivado from miembros where id = $1`, [a.miembroId])
  assert.equal(m!.nombre, 'Claude')
  assert.ok(!m!.archivado)
  const [ag] = await db.consulta(`select instrucciones from ia_agentes where miembro_id = $1`, [a.miembroId])
  assert.equal(ag!.instrucciones, '')
})

test('los disparadores: las listas y el tablero tienen que ser de la cuenta; el máximo diario va de 1 a 200', async () => {
  const p = await cuenta().crearProyecto(YO, { nombre: 'Proyecto de prueba', prefijo: 'PP' })
  const tablero = p.tableros![0]!
  const [lista] = await cuenta().listarListas(tablero.id)
  const q = await cuenta('otra-cuenta').crearProyecto(YO, { nombre: 'Ajeno', prefijo: 'AJ' })
  const [listaAjena] = await cuenta('otra-cuenta').listarListas(q.tableros![0]!.id)
  const base = { nombre: 'Proactivo', proveedor: 'anthropic' as const, modelo: 'claude-haiku-5-5' }
  const a = await ia().guardarAgente({ ...base, disparadores: { tarjetaNueva: { listas: [lista!.id, lista!.id] }, resumenDiario: { tableroId: tablero.id }, maxPorDia: 5 } })
  assert.deepEqual(a.disparadores, { tarjetaNueva: { listas: [lista!.id] }, resumenDiario: { tableroId: tablero.id }, maxPorDia: 5 })
  await rechaza(() => ia().guardarAgente({ ...base, miembroId: a.miembroId, disparadores: { tarjetaNueva: { listas: [listaAjena!.id] } } }), 404)
  await rechaza(() => ia().guardarAgente({ ...base, miembroId: a.miembroId, disparadores: { resumenDiario: { tableroId: q.tableros![0]!.id } } }), 404)
  await rechaza(() => ia().guardarAgente({ ...base, miembroId: a.miembroId, disparadores: { maxPorDia: 0 } }), 400, /1 a 200/)
  const apagado = await ia().guardarAgente({ ...base, miembroId: a.miembroId, disparadores: {} })
  assert.deepEqual(apagado.disparadores, {})
})

test('ajustes: tope de la cuenta, pausa, opciones de IA de afuera y repos de código (normalizados)', async () => {
  const a = await ia().guardarAjustes({ topeMesUsd: 40, pausada: true, confirmarMcp: true, externasDisparan: true, reposCodigo: ['https://github.com/<usuario>/<repo-del-juego>', '<usuario>/<repo-del-juego>', 'otro/repo.git'] })
  assert.deepEqual(a, { topeMesUsd: 40, gastoMesUsd: 0, pausada: true, confirmarMcp: true, externasDisparan: true, reposCodigo: ['<usuario>/<repo-del-juego>', 'otro/repo'] })
  const b = await ia().guardarAjustes({ pausada: false })
  assert.equal(b.topeMesUsd, 40, 'lo que no vino quedó')
  assert.deepEqual(b.reposCodigo, ['<usuario>/<repo-del-juego>', 'otro/repo'])
  await rechaza(() => ia().guardarAjustes({ topeMesUsd: 0 }), 400, /monto en dólares/)
  await rechaza(() => ia().guardarAjustes({ pausada: 'si' as any }), 400, /sí o no/)
  await rechaza(() => ia().guardarAjustes({ reposCodigo: ['no es un repo'] }), 400, /dueño\/repo/)
  await rechaza(() => ia().guardarAjustes({ reposCodigo: Array.from({ length: 21 }, (_, i) => `a/r${i}`) }), 400, /hasta 20/)
  assert.deepEqual((await ia('otra-cuenta').estado()).ajustes.reposCodigo, [], 'los de otra cuenta no se ven')
  assert.equal((await ia('otra-cuenta').estado()).ajustes.topeMesUsd, 25)
})

test('el estado de un agente: pausado, en el tope (el suyo o el de la cuenta), sin clave, con la clave rota y listo', async () => {
  const k = await claveAnthropic()
  const a = await ia().guardarAgente({ nombre: 'Claude', proveedor: 'anthropic', claveId: k.id, topeMesUsd: 5 })
  const estado = async () => (await ia().estado()).agentes[0]!
  assert.equal((await estado()).estado, 'listo')
  const mes = new Date().toISOString().slice(0, 7)
  await db.consulta(`insert into ia_uso_mes (propietario, mes, agente_id, entrada, salida, costo_usd, llamadas) values ('dueno', $1, $2, 1000, 500, 4.5, 3)`, [mes, a.miembroId])
  assert.equal((await estado()).gastoMesUsd, 4.5)
  assert.equal((await estado()).estado, 'listo', 'por debajo del tope')
  assert.equal((await ia().estado()).ajustes.gastoMesUsd, 4.5)
  await ia().guardarAgente({ miembroId: a.miembroId, nombre: 'Claude', topeMesUsd: 4.5 })
  assert.equal((await estado()).estado, 'en_tope', 'llegó al tope del agente')
  await ia().guardarAgente({ miembroId: a.miembroId, nombre: 'Claude', topeMesUsd: 50 })
  assert.equal((await estado()).estado, 'listo')
  await ia().guardarAjustes({ topeMesUsd: 4 })
  assert.equal((await estado()).estado, 'en_tope', 'llegó al tope de la cuenta')
  await ia().guardarAjustes({ topeMesUsd: 25 })
  await db.consulta(`update ia_claves set estado = 'invalida' where id = $1`, [k.id])
  assert.equal((await estado()).estado, 'clave_invalida')
  await db.consulta(`update ia_claves set estado = 'valida' where id = $1`, [k.id])
  await ia().guardarAjustes({ pausada: true })
  assert.equal((await estado()).estado, 'pausado', 'toda la IA en pausa')
  await ia().guardarAjustes({ pausada: false })
  await ia().guardarAgente({ miembroId: a.miembroId, nombre: 'Claude', activo: false })
  assert.equal((await estado()).estado, 'pausado', 'el agente apagado')
  // el resumen que lleva cada miembro en GET /api/miembros
  const miembros = await ia().conResumenDeAgentes(await cuenta().listarMiembros())
  assert.deepEqual(miembros.find((m) => m.id === a.miembroId)!.agente, { modo: 'api', estado: 'pausado', modelo: 'claude-opus-5-5' })
  assert.equal(miembros.filter((m) => m.agente).length, 1)
})

test('el gasto de un mes: por agente y el detalle por trabajo con dónde, quién y si se estimó', async () => {
  const a = await ia().guardarAgente({ nombre: 'Claude', proveedor: 'anthropic', modelo: 'claude-opus-5-5' })
  const hoy = new Date().toISOString().slice(0, 7)
  const viejo = '2026-01'
  await db.consulta(`insert into ia_uso_mes (propietario, mes, agente_id, entrada, salida, cache_lectura, cache_escritura, costo_usd, llamadas) values ('dueno', $1, $2, 100, 50, 10, 5, 1.25, 2), ('dueno', $3, $2, 1, 1, 0, 0, 9, 1)`, [hoy, a.miembroId, viejo])
  await db.consulta(
    `insert into ia_trabajos (id, propietario, agente_id, origen, superficie, contexto, pedido, pedido_por, proveedor, modelo, estado, paso, costo_usd)
     values ('t1', 'dueno', $1, 'mencion', 'tarjeta', '{"tarjetaClave":"RC-104"}'::jsonb, 'hola', '{"tipo":"humano","id":"yo","nombre":"Facu"}'::jsonb, 'anthropic', 'claude-opus-5-5', 'hecho', 3, 1.25),
            ('t2', 'otra-cuenta', $1, 'mencion', 'tarjeta', '{}'::jsonb, 'ajeno', '{"tipo":"humano","id":"x","nombre":"Beto"}'::jsonb, 'anthropic', 'm', 'hecho', 1, 7)`,
    [a.miembroId],
  )
  await db.consulta(`insert into ia_uso (id, propietario, trabajo_id, agente_id, proveedor, modelo, estimado, costo_usd) values ('u1', 'dueno', 't1', $1, 'anthropic', 'claude-opus-5-5', true, 1.25)`, [a.miembroId])
  const u = await ia().uso()
  assert.equal(u.mes, hoy)
  assert.equal(u.gastoMesUsd, 1.25)
  assert.equal(u.topeMesUsd, 25)
  assert.equal(u.agentes.length, 1)
  assert.deepEqual({ ...u.agentes[0]! }, { agenteId: a.miembroId, agenteNombre: 'Claude', costoUsd: 1.25, entrada: 100, salida: 50, cacheLectura: 10, cacheEscritura: 5, llamadas: 2 })
  assert.equal(u.trabajos.length, 1, 'solo los de esta cuenta')
  assert.deepEqual({ ...u.trabajos[0]!, creadoEn: '' }, { trabajoId: 't1', agenteNombre: 'Claude', origen: 'mencion', superficie: 'tarjeta', donde: 'RC-104', pedidoPor: 'Facu', pasos: 3, costoUsd: 1.25, estimado: true, creadoEn: '' })
  assert.equal((await ia().uso({ mes: viejo })).gastoMesUsd, 9)
  assert.equal((await ia().uso({ mes: '2025-05' })).agentes.length, 0)
  await rechaza(() => ia().uso({ mes: 'noviembre' }), 400, /2026-11/)
  assert.equal((await ia('otra-cuenta').uso()).gastoMesUsd, 0)
})

test('el catálogo de modelos lo pone quien conecta los proveedores', async () => {
  assert.deepEqual((await ia().estado()).modelos, [])
  ponerCatalogoDeModelos(() => [{ proveedor: 'anthropic', modelo: 'claude-opus-5-5', nombre: 'Claude Opus 5.5', veImagenes: true, costoRespuestaUsd: 0.05 }])
  assert.equal((await ia().estado()).modelos[0]!.modelo, 'claude-opus-5-5')
  ponerCatalogoDeModelos(() => [])
})

test('nada en claro: ninguna fila, respuesta ni mensaje de error trae la clave de prueba', async () => {
  await claveAnthropic()
  const a = await ia().guardarAgente({ nombre: 'Claude', proveedor: 'anthropic' })
  const todo = JSON.stringify([
    await ia().estado(),
    await ia().uso(),
    await db.consulta(`select id, proveedor, nombre, ultimos4, estado, error from ia_claves`),
    await db.consulta(`select * from ia_agentes`),
    await db.consulta(`select * from miembros`),
    await db.consulta(`select * from actividad`),
    a,
  ])
  assert.ok(!todo.includes('CLAVE-DE-PRUEBA'))
})

// ───────────────────────── el código de GitHub con la base ─────────────────────────

test('el token de GitHub se prueba con GitHub (el de mentira), se guarda cifrado y es uno por cuenta', async () => {
  await rechaza(() => ia().guardarClave({ proveedor: 'github', nombre: 'GitHub', clave: 'ghp_NoEsDeLaCuenta0123456789abcdefghijklmn' }), 400, /no aceptó el token/)
  assert.deepEqual((await ia().estado()).claves, [], 'el inválido no se guarda')
  const k = await ia().guardarClave({ proveedor: 'github', nombre: 'GitHub', clave: TOKEN_FALSO })
  assert.equal(k.estado, 'valida')
  assert.equal(k.ultimos4, TOKEN_FALSO.slice(-4))
  assert.ok(!JSON.stringify(k).includes(TOKEN_FALSO))
  await rechaza(() => ia().guardarClave({ proveedor: 'github', nombre: 'Otro', clave: TOKEN_FALSO }), 409, /Ya hay un token de GitHub/)
  await ia('otra-cuenta').guardarClave({ proveedor: 'github', nombre: 'GitHub', clave: TOKEN_FALSO })
  // un agente no puede usar el token de GitHub como clave de modelo
  await rechaza(() => ia().guardarAgente({ nombre: 'A', proveedor: 'anthropic', modelo: 'm', claveId: k.id }), 400, /Esa clave es de GitHub/)
})

test('prepararCodigo: los repos de los proyectos y de los ajustes, la rama de la tarjeta, el token de la bóveda y lo ya gastado', async () => {
  await ia().guardarClave({ proveedor: 'github', nombre: 'GitHub', clave: TOKEN_FALSO })
  const p = await cuenta().crearProyecto(YO, { nombre: 'Juego', prefijo: 'RC', repoGithub: REPO_FALSO })
  const tablero = p.tableros![0]!
  const t = await cuenta().crearTarjeta(YO, { tableroId: tablero.id, titulo: 'Arreglar el barrio' })
  await cuenta().agregarEnlace(YO, t.clave, `https://github.com/${REPO_FALSO}/tree/RC-12-barrio-nuevo`)
  await ia().guardarAjustes({ reposCodigo: ['otro/repo'] })
  const ajeno = await cuenta('otra-cuenta').crearProyecto(YO, { nombre: 'Ajeno', prefijo: 'AK', repoGithub: 'ajeno/secreto' })
  void ajeno

  const agente = await ia().guardarAgente({ nombre: 'Claude', proveedor: 'anthropic', modelo: 'claude-opus-5-5', permisos: ['comentar', 'codigo'] })
  await db.consulta(
    `insert into ia_trabajos (id, propietario, agente_id, origen, superficie, contexto, pedido, pedido_por, proveedor, modelo, estado)
     values ('tc1', 'dueno', $1, 'mencion', 'tarjeta', $2::jsonb, 'mirá el código', '{"tipo":"humano","id":"yo","nombre":"Facu"}'::jsonb, 'anthropic', 'm', 'en_curso')`,
    [agente.miembroId, JSON.stringify({ tarjetaClave: t.clave, proyectoId: p.id })],
  )
  const llamada = (id: string, estado: string, herramienta: string, resultado: string | null, orden: number) =>
    db.consulta(`insert into ia_llamadas (id, trabajo_id, propietario, paso, orden, id_proveedor, herramienta, estado, resultado) values ($1, 'tc1', 'dueno', 0, $2, $1, $3, $4, $5)`, [id, orden, herramienta, estado, resultado])
  await llamada('l1', 'hecha', 'codigo_leer', 'x'.repeat(1000), 0)
  await llamada('l2', 'error', 'codigo_ver', 'ñ'.repeat(10), 1)
  await llamada('l3', 'en_curso', 'codigo_leer', null, 2)
  await llamada('l4', 'hecha', 'leer_tarjeta', 'y'.repeat(5000), 3)
  assert.deepEqual(await usoCodigoDelTrabajo(ia(), 'tc1'), { llamadas: 2, bytes: 1020 }, 'cuenta las de código ya terminadas (la que está en curso, no)')
  assert.deepEqual(await usoCodigoDelTrabajo(ia('otra-cuenta'), 'tc1'), { llamadas: 0, bytes: 0 }, 'el trabajo de otra cuenta no se cuenta')

  const ctx = await prepararCodigo(ia(), { id: 'tc1', contexto: { tarjetaClave: t.clave, proyectoId: p.id } })
  assert.equal(ctx.repoPorDefecto, REPO_FALSO)
  assert.deepEqual([...ctx.permitidos.values()].sort(), [REPO_FALSO, 'otro/repo'].sort())
  assert.ok(!ctx.permitidos.has('ajeno/secreto'), 'los repos de otra cuenta no')
  assert.equal(ctx.ramasDeLaTarjeta[0], 'RC-12-barrio-nuevo', 'primero la rama de sus enlaces')
  assert.ok(ctx.ramasDeLaTarjeta.some((r) => /^rc-\d+/i.test(r)), 'y la sugerida')
  assert.deepEqual(ctx.uso, { llamadas: 2, bytes: 1020 })
  assert.equal(await ctx.token(), TOKEN_FALSO, 'abre el token de la bóveda de ESTA cuenta')

  const r = await ejecutarCodigo(ctx, 'codigo_ver', { ruta: 'juego3d' })
  assert.equal(r.esError, false, r.texto)
  assert.match(r.texto, /rama RC-12-barrio-nuevo \(la rama de la tarjeta\)/)
  assert.equal(ctx.uso.llamadas, 3)
  assert.ok(!r.texto.includes(TOKEN_FALSO))

  // otra cuenta: sus repos y su token, nada de los de la primera
  await ia('otra-cuenta').guardarClave({ proveedor: 'github', nombre: 'GitHub', clave: TOKEN_FALSO })
  const otra = await prepararCodigo(ia('otra-cuenta'), { id: 'tc1', contexto: {} })
  assert.deepEqual([...otra.permitidos.values()], ['ajeno/secreto'])
  assert.equal(otra.repoPorDefecto, null)
  const noPuede = await ejecutarCodigo(otra, 'codigo_ver', { repo: REPO_FALSO })
  assert.equal(noPuede.esError, true)
  assert.match(noPuede.texto, /no es de esta cuenta\. Los que puedo leer: ajeno\/secreto/)

  // sin token cargado
  await ia().quitarClave((await ia().estado()).claves.find((k) => k.proveedor === 'github')!.id)
  const sinToken = await prepararCodigo(ia(), { id: 'tc1', contexto: { tarjetaClave: t.clave } })
  assert.equal(await sinToken.token(), null)
  assert.match((await ejecutarCodigo(sinToken, 'codigo_ver', {})).texto, /No hay un token de GitHub cargado/)
})

test('una fila de la bóveda movida a otra cuenta no se abre: el código dice que no hay token', async () => {
  const k = await ia().guardarClave({ proveedor: 'github', nombre: 'GitHub', clave: TOKEN_FALSO })
  await db.consulta(`update ia_claves set propietario = 'otra-cuenta' where id = $1`, [k.id])
  const ctx = await prepararCodigo(ia('otra-cuenta'), { id: 'x', contexto: {} })
  assert.equal(await ctx.token(), null)
})
