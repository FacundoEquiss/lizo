// Prueba de la IA integrada (docs/plan-ia-integrada.md, 15.5): hoy, la F1 (menciones, campana y pendientes por MCP), escenarios
// M1 a M16 más el levantado de las menciones que ya estaban escritas antes (V1 a V6). Levanta su PROPIO Telar local (base
// descartable en una carpeta temporal, TABLERO_PUBLICO=1 para tener varias cuentas), registra a Ana (A), Beto (B) y Carla (C),
// y se niega a apuntar a otra cosa que 127.0.0.1. Nunca toca la .datos/ del dueño ni producción. No gasta nada: no hay
// proveedores de IA: en la F2 los trabajos (T1 a T21) corren contra un Telar local nuevo con el proveedor FALSO (TABLERO_IA_FALSO=1).
//
//   npm run ia:probar
//   node scripts/probar-ia.mjs --puerto 4367      (usa solo ese puerto)
//   node scripts/probar-ia.mjs --callado          (muestra solo lo que falla)
import { execFileSync, spawn } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { escenariosA } from './ia-escenarios-a.mjs'
import { levantarGithubFalso } from './github-falso.mjs'

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const PUERTO = Number(opcion('puerto', '4367'))
/** El GitHub de mentira de los escenarios de código (claves.md / ia-escenarios-a.mjs). */
const PUERTO_GITHUB = Number(opcion('puerto-github', String(PUERTO + 1)))
let github = null
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SECRETO = 'secreto-de-prueba-ia-0123456789-abcdefghijklmnopqrstu'
const CLAVE = 'clave-de-prueba-del-mcp-ia'
const INVITACION = 'pase-de-prueba-ia'
const REDIRECCION = 'http://localhost:6274/oauth/callback'

let fallas = 0
let pruebas = 0
const ok = (cond, que, detalle) => {
  pruebas++
  if (!cond) fallas++
  if (!cond || !args.includes('--callado'))
    console.log(`${cond ? '  ✓' : '  ✗'} ${que}${!cond && detalle !== undefined ? `\n      ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle).slice(0, 700)}` : ''}`)
  return cond
}
const titulo = (t) => console.log(`\n${t}`)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const unico = () => randomBytes(6).toString('hex')

// ───────────────────────── el Telar de prueba ─────────────────────────

const servidores = []
async function levantar(datos, { puerto = PUERTO, extra = {} } = {}) {
  const base = `http://127.0.0.1:${puerto}`
  const env = {
    ...process.env,
    TABLERO_DATOS: datos,
    TABLERO_PUERTO: String(puerto),
    TABLERO_SEMILLA_DISCORD: 'no',
    TABLERO_SUPABASE_URL: '',
    TABLERO_SUPABASE_ANON: '',
    TABLERO_PUBLICO: '1',
    TABLERO_SECRETO: SECRETO,
    TABLERO_USUARIOS: 'usuario-juego-prueba',
    TABLERO_URL_PUBLICA: base,
    TABLERO_CLAVE: CLAVE,
    TABLERO_INVITACION: INVITACION,
    TABLERO_EVENTOS_EN_BASE: '1',
    TABLERO_GITHUB_API: github?.url ?? '',
    ...extra,
  }
  if (await fetch(`${base}/api/salud`).then(() => true, () => false)) throw new Error(`El puerto ${puerto} ya está ocupado: apagá lo que corre ahí o usá --puerto.`)
  const hijo = spawn(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), ['servidor/src/principal.ts'], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let salida = ''
  hijo.stdout.on('data', (d) => (salida += d))
  hijo.stderr.on('data', (d) => (salida += d))
  const srv = { hijo, base, datos, salida: () => salida }
  servidores.push(srv)
  for (let i = 0; i < 160; i++) {
    try {
      const r = await fetch(`${base}/api/salud`)
      if (r.ok && (await r.json()).listo) return srv
    } catch {}
    if (hijo.exitCode !== null) break
    await esperar(500)
  }
  throw new Error(`El Telar de prueba no arrancó (${base}):\n${salida.slice(-2000)}`)
}
async function apagar(srv) {
  if (!srv || srv.hijo.exitCode !== null) return
  srv.hijo.kill('SIGTERM')
  for (let i = 0; i < 40 && srv.hijo.exitCode === null; i++) await esperar(150)
  if (srv.hijo.exitCode === null) srv.hijo.kill('SIGKILL')
  await esperar(300)
}

// ───────────────────────── un «navegador» y un cliente MCP ─────────────────────────

class Quien {
  constructor(base, { nombre, cookie = '', clave = '', ip = '10.0.0.1' } = {}) {
    Object.assign(this, { base, nombre, cookie, clave, ip })
  }
  async pedir(metodo, ruta, cuerpo) {
    const headers = { 'x-forwarded-for': this.ip, origin: this.base }
    if (this.cookie) headers.cookie = `tablero_sesion=${this.cookie}`
    if (this.clave) headers.authorization = `Bearer ${this.clave}`
    let body
    if (cuerpo !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(cuerpo)
    }
    const r = await fetch(this.base + ruta, { method: metodo, headers, body, redirect: 'manual' })
    const galleta = r.headers.get('set-cookie')
    const m = galleta && /tablero_sesion=([^;]*)/.exec(galleta)
    if (m && m[1]) this.cookie = m[1]
    const texto = await r.text()
    let json = null
    try {
      json = JSON.parse(texto)
    } catch {}
    return { status: r.status, json, texto }
  }
  g(r) {
    return this.pedir('GET', r)
  }
  p(r, c = {}) {
    return this.pedir('POST', r, c)
  }
}
async function debe(r, que) {
  if (r.status >= 400) throw new Error(`${que}: ${r.status} ${r.texto.slice(0, 300)}`)
  return r.json
}

const sha = (t) => createHash('sha256').update(t).digest('base64url')
/** Conecta una IA por OAuth como la cuenta de `quien` (el nombre de la aplicación es el de la IA: «Claude», «ChatGPT»). */
async function conectarOAuth(quien, nombreCliente) {
  const reg = await fetch(`${quien.base}/oauth/registrar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: nombreCliente, redirect_uris: [REDIRECCION], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  }).then((r) => r.json())
  const verifier = randomBytes(32).toString('base64url')
  const q = new URLSearchParams({ client_id: reg.client_id, redirect_uri: REDIRECCION, response_type: 'code', code_challenge: sha(verifier), code_challenge_method: 'S256', resource: `${quien.base}/mcp`, scope: 'telar offline_access', state: 'e1' })
  const r = await fetch(`${quien.base}/oauth/autorizar?${q}`, { redirect: 'manual' })
  const pedido = new URL(r.headers.get('location'), quien.base).searchParams.get('pedido')
  const d = await quien.p('/api/oauth/decidir', { pedido, permitir: true })
  if (!d.json?.redirigir) throw new Error(`decidir: ${d.status} ${d.texto}`)
  const code = new URL(d.json.redirigir).searchParams.get('code')
  const t = await fetch(`${quien.base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECCION, resource: `${quien.base}/mcp` }),
  }).then((x) => x.json())
  if (!t.access_token) throw new Error(`token: ${JSON.stringify(t)}`)
  const c = new Client({ name: 'telar-prueba-ia', version: '1.0.0' })
  await c.connect(new StreamableHTTPClientTransport(new URL(`${quien.base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${t.access_token}` } } }))
  return c
}
async function herramienta(cli, nombre, argumentos) {
  try {
    const r = await cli.callTool({ name: nombre, arguments: argumentos })
    const texto = (r.content ?? []).map((c) => c.text ?? '').join('\n')
    let json = null
    try {
      json = JSON.parse(texto)
    } catch {}
    return { error: Boolean(r.isError), texto, json }
  } catch (e) {
    return { error: true, texto: String(e?.message ?? e), json: null }
  }
}
/** Las menciones que le esperan a una IA (por leer_pendientes). */
const pendientes = async (cli, argumentos = {}) => (await herramienta(cli, 'leer_pendientes', argumentos)).json?.menciones ?? []

/** Comenta como persona (con un id propio, como la web). */
const comentar = (q, ref, cuerpo, extra = {}) => q.p(`/api/tarjetas/${ref}/comentarios`, { cuerpo, id: `c${unico()}`, ...extra })

async function registrar(q, email, nombre) {
  const r = await q.p('/api/cuentas', { email, nombre, clave: `la frase larga de ${nombre.toLowerCase()}`, invitacion: INVITACION })
  if (r.status !== 201) throw new Error(`registrar ${nombre}: ${r.status} ${r.texto}`)
}

/** Un proyecto con su tablero y tres tarjetas. */
async function armarProyecto(q, prefijo, marca) {
  const p = await debe(await q.p('/api/proyectos', { nombre: `Proyecto ${marca}`, prefijo, tipo: 'completo' }), 'crear proyecto')
  const t = p.tableros[0].id
  const tarjetas = []
  for (const n of ['uno', 'dos', 'tres']) tarjetas.push(await debe(await q.p('/api/tarjetas', { tableroId: t, titulo: `Tarjeta ${marca} ${n}` }), 'crear tarjeta'))
  return { prefijo, proyecto: p.id, tablero: t, k: tarjetas.map((x) => x.clave), id: tarjetas.map((x) => x.id) }
}


// ───────────────────────── Trabajos de los agentes (T1 a T21) ─────────────────────────
// Un Telar local NUEVO, con el proveedor falso (TABLERO_IA_FALSO=1) y los agentes sembrados en su base descartable (scripts/ia/base.ts: con
// el Telar apagado, PGlite es de un solo proceso). Las acciones van por HTTP como las haría la web; lo que no se ve por la API se mira al
// final, con el Telar apagado, directo en la base. Los cortes (T9 a T11) matan de verdad el proceso con TABLERO_IA_FALLA y lo vuelven a levantar.

const tsx = path.join(RAIZ, 'node_modules', '.bin', 'tsx')
// (la base la abre con el mismo secreto que el Telar de la prueba: las claves de los agentes se sellan con la bóveda de verdad)
const base = (...a) => JSON.parse(execFileSync(tsx, ['scripts/ia/base.ts', ...a], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, TABLERO_SECRETO: SECRETO, TABLERO_PUBLICO: '1' } }).trim().split('\n').pop())
const sql = (carpeta, consulta, ...parametros) => base('sql', carpeta, consulta, ...parametros)
const sondear = async (fn, ms = 20_000, cada = 150) => {
  const t0 = Date.now()
  let ultimo
  while (Date.now() - t0 < ms) {
    ultimo = await fn()
    if (ultimo) return ultimo
    await esperar(cada)
  }
  return ultimo
}

async function faseTrabajos() {
  titulo('Trabajos de los agentes (T1 a T21), con el proveedor falso')
  const datosT = mkdtempSync(path.join(os.tmpdir(), 'telar-ia-trab-'))
  const puertoT = PUERTO + 2 // el GitHub de mentira ocupa PUERTO + 1
  const env = (extra = {}) => ({ puerto: puertoT, extra: { TABLERO_IA_FALSO: '1', TABLERO_IA_FALSO_ESPERA_MS: '1500', ...extra } })
  const firmaAlcance = (cuenta) => {
    const exp = Math.floor(Date.now() / 1000) + 60
    const b = `a1.${cuenta}.${exp}`
    return `${b}.${createHmac('sha256', SECRETO).update(b).digest('base64url')}`
  }
  let s = await levantar(datosT, env())
  const BASET = s.base
  const T = new Quien(BASET, { nombre: 'T (Tomás)', ip: '10.3.1.1' })
  const U = new Quien(BASET, { nombre: 'U (Úrsula)', ip: '10.4.1.1' })
  const dueno = new Quien(BASET, { nombre: 'dueño (clave)', clave: CLAVE, ip: '10.9.1.1' })
  await registrar(T, 'tomas@ejemplo.com', 'Tomas')
  await registrar(U, 'ursula@ejemplo.com', 'Ursula')
  const cuentaT = (await T.g('/api/cuenta')).json.id
  const cuentaU = (await U.g('/api/cuenta')).json.id
  const vt = await armarProyecto(T, 'TOMAS', 'JADE')
  const tabT = (await T.g(`/api/tableros/${vt.tablero}`)).json
  const bandeja = tabT.listas.find((l) => /bandeja/i.test(l.nombre))
  const hecho = tabT.listas.find((l) => l.categoria === 'hecho')
  ok(Boolean(bandeja && hecho), 'el tablero de Tomás tiene «Bandeja» y una lista «Hecho»', tabT.listas?.map((l) => l.nombre))
  // la lista que mira el agente proactivo es otra: así las tarjetas de los demás escenarios (que caen en la primera lista) no se revisan solas
  const revision = await debe(await T.p('/api/listas', { tableroId: vt.tablero, nombre: 'Revisión' }), 'crear la lista Revisión')
  await armarProyecto(U, 'URSU', 'OPALO')

  // el dueño (clave del MCP): su cuenta tiene su propio agente, para T21
  const proyectosD = (await dueno.g('/api/proyectos')).json
  const tableroD = proyectosD[0]?.tableros?.[0]?.id
  await apagar(s)
  const A = (nombre, guion, extra = {}) => ({ nombre, guion, ...extra })
  const agentes = base(
    'agentes',
    datosT,
    cuentaT,
    JSON.stringify([
      A('Ag Responder', 'responder'),
      A('Ag Leer', 'leer-y-responder'),
      A('Ag Mover', 'mover', { confirmar: 'nunca' }),
      A('Ag Archivar', 'archivar'),
      A('Ag Archivo Ok', 'archivar', { permisos: ['comentar', 'tarjetas', 'lienzo', 'archivar'], confirmar: 'peligrosas' }),
      A('Ag Bucle', 'bucle', { topeMesUsd: 100 }),
      A('Ag Caro', 'caro', { topeMesUsd: 1 }),
      A('Ag Lento', 'lento'),
      A('Ag Crear', 'crear', { confirmar: 'nunca' }),
      A('Ag Sobrecarga', 'error-sobrecarga'),
      A('Ag Clave', 'error-clave'),
      A('Ag Url', 'url-armada', { confirmar: 'nunca' }),
      A('Ag Uno', 'menciona-ia:ag-dos', { puedeMencionarIA: true }),
      A('Ag Dos', 'menciona-ia:ag-tres', { puedeMencionarIA: true }),
      A('Ag Tres', 'responder'),
      A('Ag Cerrado', 'menciona-ia:ag-tres'),
      A('Ag Sin Clave', 'responder', { sinClave: true }),
      A('Ag Triage', 'triage', { disparadores: { tarjetaNueva: { listas: [revision.id] } } }),
    ]),
  )
  const agentesU = base('agentes', datosT, cuentaU, JSON.stringify([A('Ag Rapido', 'responder', { topeMesUsd: 1000 })]))
  const agentesD = base('agentes', datosT, 'dueno', JSON.stringify([A('Ag Dueno', 'archivar', { permisos: ['comentar', 'tarjetas', 'archivar'] })]))
  s = await levantar(datosT, env())

  /** Una tarjeta nueva de Tomás y un comentario que menciona al agente: devuelve lo que contestó la ruta. */
  const pedir = async (agente, texto = 'ya le respondí', quien = T, tarjeta = null, opcion = {}) => {
    const t = tarjeta ?? (await debe(await quien.p('/api/tarjetas', { tableroId: vt.tablero, titulo: `Pedido para ${agente}`, ...opcion }), 'crear tarjeta'))
    const alias = agentes[agente]?.alias ?? agentesU[agente]?.alias ?? agentesD[agente]?.alias
    const r = await comentar(quien, t.clave, `@${alias} ${texto}`)
    return { tarjeta: t, r, trabajo: r.json?.trabajos?.[0] }
  }
  const trabajo = async (id, q = T) => (await q.g(`/api/ia/trabajos/${id}`)).json
  const esperarEstado = async (id, estados, ms = 20_000, q = T) => sondear(async () => (estados.includes((await trabajo(id, q))?.estado) ? await trabajo(id, q) : null), ms)
  const respuestas = async (clave, q = T) => ((await q.g(`/api/tarjetas/${clave}`)).json?.comentarios ?? []).filter((c) => c.autor?.tipo === 'ia')

  // ── T1: una mención contesta sola ──
  const t1 = await pedir('Ag Responder')
  ok(t1.r.status === 201 && t1.trabajo?.estado === 'en_cola' && t1.r.json.trabajos.length === 1, 'T1: el comentario con la mención vuelve con su trabajo («Claude está pensando…»)', t1.r.texto.slice(0, 300))
  const e1 = await esperarEstado(t1.trabajo.id, ['hecho', 'fallado'])
  ok(e1?.estado === 'hecho' && e1.pasos.length === 1, 'T1: sin que nada más lo largue, el trabajo termina solo', e1)
  const resp1 = (await respuestas(t1.tarjeta.clave))[0]
  ok(resp1?.id === `r_${t1.trabajo.id}` && resp1.cuerpo === 'Respuesta de prueba.' && resp1.respuestaA === t1.r.json.id && resp1.trabajoId === t1.trabajo.id, 'T1: la respuesta es el comentario r_<trabajo>, en el hilo, con su trabajo', resp1)
  const notiT = (await T.g('/api/notificaciones')).json
  ok(notiT.some((n) => n.tipo === 'respuesta' && n.trabajoId === t1.trabajo.id), 'T1: la persona recibe «respondió»', notiT.map((n) => n.titulo))
  const ev1 = (await T.g('/api/eventos/desde?n=1')).json.eventos.filter((e) => e.tipo === 'trabajo' && e.datos?.id === t1.trabajo.id).map((e) => e.accion)
  ok(ev1[0] === 'creado' && ev1.at(-1) === 'hecho', 'T1: los eventos «trabajo» (creado … hecho) salen por el canal de siempre', ev1)

  // ── T2 y T3 ──
  const t2 = await pedir('Ag Leer')
  const e2 = await esperarEstado(t2.trabajo.id, ['hecho', 'fallado'])
  ok(e2?.estado === 'hecho' && e2.pasos.length === 2 && e2.pasos[0].llamadas[0]?.estado === 'hecha' && /Pedido para Ag Leer/.test((await respuestas(t2.tarjeta.clave))[0]?.cuerpo ?? ''), 'T2: dos pasos, una llamada hecha, y la respuesta nombra el título', e2)
  const t3 = await pedir('Ag Mover')
  const e3 = await esperarEstado(t3.trabajo.id, ['hecho', 'fallado'])
  const tarjeta3 = (await T.g(`/api/tarjetas/${t3.tarjeta.clave}`)).json
  ok(e3?.estado === 'hecho' && tarjeta3.listaId === hecho.id, 'T3: la tarjeta quedó en «Hecho»', tarjeta3.listaId)
  ok(e3.hizo?.[0] === `Movió ${t3.tarjeta.clave} a Hecho`, 'T3: lo que de verdad pasó sale del libro: «Movió … a Hecho»', e3.hizo)

  // ── T4 y T5: permisos y confirmación ──
  const t4 = await pedir('Ag Archivar')
  const e4 = await esperarEstado(t4.trabajo.id, ['hecho', 'fallado'])
  ok(e4?.estado === 'hecho' && e4.pasos[0].llamadas[0].estado === 'denegada' && (await T.g(`/api/tarjetas/${t4.tarjeta.clave}`)).json.archivada === false, 'T4: archivar con los permisos de fábrica: llamada denegada y la tarjeta sigue ahí', e4)
  const t5 = await pedir('Ag Archivo Ok')
  const e5 = await esperarEstado(t5.trabajo.id, ['esperando_confirmacion', 'hecho', 'fallado'])
  ok(e5?.estado === 'esperando_confirmacion' && e5.porConfirmar?.[0]?.titulo === `Archivar ${t5.tarjeta.clave}`, 'T5: con permiso y «solo lo delicado»: espera confirmación', e5)
  ok((await T.g('/api/notificaciones')).json.some((n) => n.tipo === 'confirmacion' && n.trabajoId === t5.trabajo.id), 'T5: y avisa con una notificación de confirmación')
  ok((await T.g(`/api/tarjetas/${t5.tarjeta.clave}`)).json.archivada === false, 'T5: todavía no archivó nada')
  const ok5 = await T.p(`/api/ia/trabajos/${t5.trabajo.id}/confirmar`, { decisiones: [{ llamadaId: e5.porConfirmar[0].id, permitir: true }] })
  ok(ok5.status === 200, 'T5: Permitir (con sesión)', ok5.texto)
  ok((await esperarEstado(t5.trabajo.id, ['hecho', 'fallado']))?.estado === 'hecho' && (await T.g(`/api/tarjetas/${t5.tarjeta.clave}`)).json.archivada === true, 'T5: Permitir → archivada y el trabajo termina solo')
  const t5b = await pedir('Ag Archivo Ok', 'otra para archivar')
  const e5b = await esperarEstado(t5b.trabajo.id, ['esperando_confirmacion'])
  await T.p(`/api/ia/trabajos/${t5b.trabajo.id}/confirmar`, { decisiones: [{ llamadaId: e5b.porConfirmar[0].id, permitir: false }] })
  ok((await esperarEstado(t5b.trabajo.id, ['hecho']))?.estado === 'hecho' && (await T.g(`/api/tarjetas/${t5b.tarjeta.clave}`)).json.archivada === false && /no me dejaste/.test((await respuestas(t5b.tarjeta.clave))[0]?.cuerpo ?? ''), 'T5: No → sigue ahí y la respuesta lo dice')

  // ── T6: el bucle ──
  const t6 = await pedir('Ag Bucle')
  const e6 = await esperarEstado(t6.trabajo.id, ['fallado', 'hecho'], 40_000)
  ok(e6?.estado === 'fallado' && /límite de pasos/.test(e6.motivo ?? '') && e6.paso <= 13, 'T6: el bucle corta en el límite de pasos (fallado, nunca más de max_pasos + 1 pedidos)', e6 && { estado: e6.estado, paso: e6.paso, motivo: e6.motivo })

  // ── T7: el tope ──
  const t7 = await pedir('Ag Caro')
  const e7 = await esperarEstado(t7.trabajo.id, ['pausado_tope', 'hecho', 'fallado'])
  ok(e7?.estado === 'pausado_tope' && e7.motivo === 'tope_agente', 'T7: «caro» con tope de USD 1: pausado por tope (no se pierde nada)', e7 && { estado: e7.estado, motivo: e7.motivo, costo: e7.costoUsd })
  const nT7 = (await T.g('/api/notificaciones')).json.filter((n) => n.tipo === 'tope')
  ok(nT7.filter((n) => /80 %/.test(n.titulo)).length === 1, 'T7: el aviso del 80 % sale una sola vez', nT7.map((n) => n.titulo))

  // ── T8: frenar durante un pedido lento ──
  const t8 = await pedir('Ag Lento')
  await sondear(async () => (await trabajo(t8.trabajo.id))?.estado === 'en_curso', 8_000)
  const t0 = Date.now()
  const c8 = await T.p(`/api/ia/trabajos/${t8.trabajo.id}/cancelar`, {})
  const e8 = await esperarEstado(t8.trabajo.id, ['cancelado', 'hecho', 'fallado'], 15_000)
  ok(c8.status === 200 && e8?.estado === 'cancelado' && Date.now() - t0 < 12_000, 'T8: frenar durante un pedido lento: «cancelado» en menos de 12 s', { c8: c8.status, estado: e8?.estado, ms: Date.now() - t0 })
  ok((await respuestas(t8.tarjeta.clave)).length === 0, 'T8: ninguna respuesta')

  // ── T12 a T14 ──
  const t12 = await pedir('Ag Sobrecarga')
  const e12 = await esperarEstado(t12.trabajo.id, ['hecho', 'fallado'], 40_000)
  ok(e12?.estado === 'hecho', 'T12: una sobrecarga se reintenta (a los 5 s) y termina «hecho»', e12 && { estado: e12.estado, motivo: e12.motivo })
  const t13 = await pedir('Ag Clave')
  const e13 = await esperarEstado(t13.trabajo.id, ['fallado', 'hecho'])
  ok(e13?.estado === 'fallado' && /La clave de prueba no anda/.test(e13.motivo ?? ''), 'T13: clave rechazada: fallado, con el texto para la persona', e13 && { estado: e13.estado, motivo: e13.motivo })
  ok((await T.g('/api/notificaciones')).json.some((n) => n.tipo === 'error_ia' && n.trabajoId === t13.trabajo.id), 'T13: avisa con error_ia')
  const t14 = await pedir('Ag Url')
  const e14 = await esperarEstado(t14.trabajo.id, ['hecho', 'fallado'])
  ok(e14?.estado === 'hecho' && e14.pasos[0].llamadas[0].estado === 'denegada' && /no salió del tablero ni del pedido/.test(e14.pasos[0].llamadas[0].resultado ?? ''), 'T14: una dirección armada por el modelo vuelve con el error de dirección', e14?.pasos?.[0])
  ok(!JSON.stringify((await T.g(`/api/tarjetas/${t14.tarjeta.clave}`)).json).includes('afuera.example'), 'T14: y nada con esa dirección quedó en la tarjeta')

  // ── T15: IA con IA ──
  const t15a = await pedir('Ag Cerrado')
  await esperarEstado(t15a.trabajo.id, ['hecho'])
  ok((await T.g(`/api/ia/trabajos?tarjeta=${t15a.tarjeta.clave}`)).json.length === 1, 'T15: con «puede mencionar a otra IA» apagado, la mención de un agente a otro no crea ningún trabajo')
  const t15 = await pedir('Ag Uno')
  await esperarEstado(t15.trabajo.id, ['hecho'])
  const cadena = await sondear(async () => {
    const l = (await T.g(`/api/ia/trabajos?tarjeta=${t15.tarjeta.clave}`)).json
    return l.length >= 2 && l.every((x) => ['hecho', 'fallado'].includes(x.estado)) ? l : null
  }, 30_000)
  await esperar(1_500)
  const cadenaFinal = (await T.g(`/api/ia/trabajos?tarjeta=${t15.tarjeta.clave}`)).json
  ok(cadenaFinal.length === 2 && cadenaFinal.every((x) => x.estado === 'hecho'), 'T15: prendido, el segundo corre y el tercero no (profundidad 2)', cadenaFinal.map((x) => [x.agenteNombre, x.estado]))
  void cadena

  // ── F.2: conversar sin «@» ──
  const conv = await comentar(T, t1.tarjeta.clave, 'Gracias, ¿y qué falta?')
  ok(conv.status === 201 && conv.json.trabajos?.length === 1, 'F.2: el comentario justo después de uno del agente, sin «@», se toma como respuesta a él', conv.texto.slice(0, 300))
  const eConv = await esperarEstado(conv.json.trabajos[0].id, ['hecho', 'fallado'])
  ok(eConv?.estado === 'hecho' && eConv.origen === 'conversacion', 'F.2: el trabajo es de origen «conversacion» y contesta', eConv && { estado: eConv.estado, origen: eConv.origen })
  // (que dos comentarios seguidos de la persona no disparan al segundo se prueba en proceso, donde el trabajo no corre solo en el medio:
  //  acá el agente contesta en milésimas y el siguiente comentario ya es «justo después de uno suyo»)

  // ── F.4: proactividad ──
  const nueva = await debe(await T.p('/api/tarjetas', { tableroId: vt.tablero, listaId: revision.id, titulo: '¿Cómo se juega el barrio?' }), 'tarjeta de la lista a revisar')
  const proactivo = await sondear(async () => (await T.g(`/api/ia/trabajos?tarjeta=${nueva.clave}`)).json[0], 10_000)
  ok(proactivo?.origen === 'proactivo' && proactivo.agenteNombre === 'Ag Triage', 'F.4: una tarjeta que entra a la lista elegida crea UN trabajo proactivo', proactivo)
  const eP = await esperarEstado(proactivo.id, ['hecho', 'fallado'])
  ok(eP?.estado === 'hecho' && /^\*\*Revisado/.test((await respuestas(nueva.clave))[0]?.cuerpo ?? ''), 'F.4: comenta con «Revisado DD/MM:» y una recomendación', await respuestas(nueva.clave))
  await T.pedir('PATCH', `/api/tarjetas/${nueva.clave}`, { titulo: '¿Cómo se juega el barrio? (editada)' })
  await esperar(500)
  ok((await T.g(`/api/ia/trabajos?tarjeta=${nueva.clave}`)).json.length === 1, 'F.4: editar la tarjeta no repite la revisión')
  ok((await T.g(`/api/tarjetas/${nueva.clave}`)).json.listaId === revision.id, 'F.4: en «sugiere» no movió nada de lista')

  // ── T19: un agente sin clave deja la mención pendiente con el motivo ──
  const t19 = await pedir('Ag Sin Clave')
  const m19 = t19.r.json.menciones?.[0]
  ok(t19.r.status === 201 && !t19.trabajo && m19?.estado === 'pendiente' && m19.motivo === 'No tiene clave.', 'T19: sin clave, la mención queda pendiente con el motivo («No tiene clave.»)', t19.r.texto.slice(0, 300))
  const nov19 = (await T.g('/api/novedades')).json
  ok(nov19.esperando.some((m) => m.id === m19.id && m.motivo === 'No tiene clave.'), 'T19: y al abrir Telar se ve entre lo que espera (con «Reintentar»)', nov19.esperando)
  ok((await T.p(`/api/ia/menciones/${m19.id}/reintentar`, {})).status === 409, 'T19: «Reintentar» antes de arreglarlo dice por qué no se puede (409)')

  // ── T18: otra cuenta no ve, frena, confirma ni reanuda un trabajo ajeno ──
  const falso18 = await U.g('/api/ia/trabajos/tr_noexiste')
  for (const [metodo, ruta, cuerpo] of [
    ['GET', `/api/ia/trabajos/${t5b.trabajo.id}`],
    ['POST', `/api/ia/trabajos/${t7.trabajo.id}/cancelar`, {}],
    ['POST', `/api/ia/trabajos/${t7.trabajo.id}/confirmar`, { decisiones: [{ llamadaId: 'll_x', permitir: true }] }],
    ['POST', `/api/ia/trabajos/${t7.trabajo.id}/reanudar`, {}],
    ['POST', `/api/ia/menciones/${m19.id}/reintentar`, {}],
  ]) {
    const r = await U.pedir(metodo, ruta, cuerpo)
    ok(r.status === 404 && (metodo !== 'GET' || r.texto === falso18.texto), `T18: Úrsula: ${metodo} ${ruta.replace(/tr_\w+|m_\w+/g, '…')} → 404`, r.texto)
  }
  ok(!(await U.g('/api/ia/trabajos')).texto.includes('Pedido para'), 'T18: la lista de trabajos de Úrsula no trae nada de Tomás')
  ok((await trabajo(t7.trabajo.id))?.estado === 'pausado_tope', 'T18: el trabajo de Tomás sigue como estaba')

  // ── T20: dos «correr» a la vez ──
  const tres = await Promise.all([pedir('Ag Responder', 'uno'), pedir('Ag Leer', 'dos'), pedir('Ag Mover', 'tres')])
  await Promise.all([1, 2].map(() => dueno.pedir('POST', '/api/ia/interno/correr', {}, { headers: { 'x-tablero-alcance': firmaAlcance(cuentaT) }, sinGuardar: true })))
  const finales = await Promise.all(tres.map((x) => esperarEstado(x.trabajo.id, ['hecho', 'fallado'])))
  ok(finales.every((f) => f?.estado === 'hecho'), 'T20: tres menciones y dos «correr» a la vez: los tres terminan', finales.map((f) => f?.estado))

  // ── T16 (en la cuenta de Úrsula): 31 menciones en una hora ──
  const vu = (await U.g('/api/proyectos')).json[0]
  const tabU = vu.tableros[0].id
  let ultimo = null
  for (let i = 1; i <= 31; i++) {
    const tj = await debe(await U.p('/api/tarjetas', { tableroId: tabU, titulo: `Rápido ${i}` }), 'tarjeta')
    ultimo = await comentar(U, tj.clave, `@${agentesU['Ag Rapido'].alias} pedido ${i}`)
    if (i <= 30) await sondear(async () => ['hecho', 'fallado'].includes((await trabajo(ultimo.json.trabajos?.[0]?.id, U))?.estado), 15_000)
  }
  ok(!ultimo.json.trabajos?.length && ultimo.json.aviso === 'Demasiados pedidos seguidos. Esperá un rato.' && ultimo.json.menciones?.[0]?.estado === 'pendiente', 'T16: la mención número 31 de la hora queda pendiente, con el aviso', ultimo.texto.slice(0, 300))

  // ── T21: con la clave del MCP no se dispara un agente ──
  ok(Boolean(tableroD), 'T21: el dueño tiene un tablero', proyectosD)
  const tarjetaD = await debe(await dueno.p('/api/tarjetas', { tableroId: tableroD, titulo: 'Tarjeta del dueño para T21' }), 'tarjeta del dueño')
  const porClave = await comentar(dueno, tarjetaD.clave, `@${agentesD['Ag Dueno'].alias} por la clave`)
  ok(porClave.status === 201 && !porClave.json.trabajos?.length && porClave.json.menciones?.[0]?.estado === 'pendiente', 'T21: comentar por /api con la clave del MCP mencionando a un agente: la mención queda pendiente y no hay trabajo', porClave.texto.slice(0, 300))
  const exp = Math.floor(Date.now() / 1000) + 3600
  const baseCookie = `v1.usuario-juego-prueba.${exp}`
  const juego = new Quien(BASET, { nombre: 'dueño (cuenta del juego)', cookie: `${baseCookie}.${createHmac('sha256', SECRETO).update(baseCookie).digest('base64url')}`, ip: '10.9.1.2' })
  const porSesion = await comentar(juego, tarjetaD.clave, `@${agentesD['Ag Dueno'].alias} ahora por la sesión`)
  const tD = porSesion.json.trabajos?.[0]
  ok(porSesion.status === 201 && Boolean(tD), 'T21: con la sesión del dueño sí se crea el trabajo', porSesion.texto.slice(0, 300))
  const eD = await esperarEstado(tD.id, ['esperando_confirmacion', 'hecho', 'fallado'], 20_000, juego)
  ok(eD?.estado === 'esperando_confirmacion', 'T21: (el trabajo archiva: pide permiso)', eD && { estado: eD.estado })
  const c403 = await dueno.p(`/api/ia/trabajos/${tD.id}/confirmar`, { decisiones: [{ llamadaId: eD.porConfirmar[0].id, permitir: true }] })
  const r403 = await dueno.p(`/api/ia/trabajos/${tD.id}/reanudar`, {})
  ok(c403.status === 403 && r403.status === 403, 'T21: confirmar y reanudar con la clave del MCP dan 403', { c: c403.status, r: r403.status })
  ok((await dueno.p(`/api/ia/trabajos/${tD.id}/cancelar`, {})).status === 200, 'T21: frenar sí se puede con la clave del MCP')

  // ── los cortes de verdad (T9 a T11) y T19 resuelto ──
  const cortar = async (punto, agenteNombre, texto) => {
    await apagar(s)
    s = await levantar(datosT, env({ TABLERO_IA_FALLA: punto }))
    const p = await pedir(agenteNombre, texto)
    const murio = await sondear(async () => s.hijo.exitCode !== null, 15_000)
    return { p, murio, salida: s.salida() }
  }
  const reanudarDespues = async (arreglos = []) => {
    // el proceso se cortó con el trabajo en la mano: se le vence el préstamo (si no, habría que esperar 150 s) y se vuelve a levantar
    sql(datosT, `update ia_trabajos set tomado_hasta = now() - interval '1 second' where estado = 'en_curso'`)
    for (const [q, ...par] of arreglos) sql(datosT, q, ...par)
    s = await levantar(datosT, env())
  }
  const c9 = await cortar('despues-de-guardar-asistente', 'Ag Leer', 'corte 9')
  ok(c9.murio && s.hijo.exitCode === 1, 'T9: el proceso murió de verdad después de guardar lo del asistente', s.hijo.exitCode)
  // de paso, T19: mientras está apagado, el dueño le carga una clave al agente que no tenía
  const claveNueva = `k_${unico()}`
  base('clave', datosT, cuentaT, claveNueva)
  await reanudarDespues([[`update ia_agentes set clave_id = $1 where miembro_id = $2`, claveNueva, agentes['Ag Sin Clave'].id]])
  const e9 = await esperarEstado(c9.p.trabajo.id, ['hecho', 'fallado'], 30_000)
  ok(e9?.estado === 'hecho' && (await respuestas(c9.p.tarjeta.clave)).length === 1, 'T9: el trabajo sigue solo y hay un solo comentario de respuesta', e9 && { estado: e9.estado })
  ok(e9.pasos[0].llamadas.length === 1 && e9.pasos[0].llamadas[0].estado === 'hecha', 'T9: cada llamada, una vez', e9.pasos)
  const r19 = await T.p(`/api/ia/menciones/${m19.id}/reintentar`, {})
  ok(r19.status === 200 && r19.json.estado === 'en_cola', 'T19: arreglado el agente, «Reintentar» crea el trabajo', r19.texto)
  ok((await esperarEstado(r19.json.id, ['hecho']))?.estado === 'hecho', 'T19: y contesta')

  const c10 = await cortar('en-medio-de-herramienta', 'Ag Crear', 'corte 10')
  ok(c10.murio, 'T10: el proceso murió en medio de una herramienta que escribe')
  await reanudarDespues([[`update ia_trabajos set modelo = 'guion:verifica' where estado = 'en_curso'`]])
  const e10 = await esperarEstado(c10.p.trabajo.id, ['hecho', 'fallado'], 30_000)
  ok(e10?.estado === 'hecho' && e10.pasos[0].llamadas[0].estado === 'incierta', 'T10: la llamada queda «incierta» y el modelo verifica leyendo', e10?.pasos)
  const creadas = (await T.g(`/api/buscar?q=${encodeURIComponent('Tarjeta creada por el agente')}`)).json.filter((x) => x.tarjeta?.titulo === 'Tarjeta creada por el agente')
  ok(creadas.length === 1, 'T10: UNA tarjeta creada, no dos', creadas.length)

  const c11 = await cortar('despues-de-responder', 'Ag Responder', 'corte 11')
  ok(c11.murio, 'T11: el proceso murió justo después de publicar la respuesta')
  await reanudarDespues()
  const e11 = await esperarEstado(c11.p.trabajo.id, ['hecho', 'fallado'], 30_000)
  ok(e11?.estado === 'hecho' && (await respuestas(c11.p.tarjeta.clave)).length === 1, 'T11: una sola respuesta', await respuestas(c11.p.tarjeta.clave))

  // ── la base, con el Telar apagado ──
  await apagar(s)
  const uno = (consulta, ...p) => sql(datosT, consulta, ...p)[0]
  ok(uno(`select count(*)::int as n from ia_uso where trabajo_id = $1`, t1.trabajo.id).n === 1, 'T1: una fila en ia_uso')
  ok(uno(`select estado from menciones where id = $1`, t1.r.json.menciones[0].id).estado === 'atendida', 'T1: la mención quedó atendida')
  ok(uno(`select count(*)::int as n from actividad where tanda = $1 and actor->>'tipo' = 'ia'`, t3.trabajo.id).n >= 1, 'T3: la actividad lleva la tanda = el id del trabajo, firmada por el agente')
  const claveDelAgente = uno(`select clave_id from ia_agentes where miembro_id = $1`, agentes['Ag Clave'].id).clave_id
  ok(uno(`select estado from ia_claves where id = $1`, claveDelAgente).estado === 'invalida', 'T13: la clave quedó «invalida»')
  ok(uno(`select count(*)::int as n from notificaciones where tipo = 'tope' and titulo like '%80 %'`).n === 1, 'T7: una sola notificación del 80 %')
  const copias = 'ia_trabajos ia_mensajes ia_llamadas ia_uso ia_uso_mes ia_claves comentarios notificaciones actividad menciones eventos'.split(' ')
  let filtradas = 0
  for (const tabla of copias) filtradas += uno(`select count(*)::int as n from ${tabla} x where row_to_json(x)::text like '%prueba-clave%'`).n
  ok(filtradas === 0, 'la clave que abre la bóveda no está en ninguna fila de la base (trabajos, mensajes, llamadas, uso, comentarios, notificaciones, actividad, eventos)', filtradas)
  ok(!servidores.some((x) => x.salida().includes('prueba-clave')), 'ni en la salida del servidor')
  rmSync(datosT, { recursive: true, force: true })
}

// ───────────────────────── el principal ─────────────────────────

const datos = mkdtempSync(path.join(os.tmpdir(), 'telar-ia-'))
let srv = null
try {
  github = await levantarGithubFalso({ puerto: PUERTO_GITHUB })
  // con el proveedor falso (TABLERO_IA_FALSO=1): «Probar» una clave de prueba no sale a ningún proveedor de verdad
  srv = await levantar(datos, { extra: { TABLERO_IA_FALSO: '1' } })
  const BASE = srv.base
  const dueno = new Quien(BASE, { nombre: 'dueño (clave)', clave: CLAVE, ip: '10.9.0.1' })
  const A = new Quien(BASE, { nombre: 'A', ip: '10.3.0.1' })
  const B = new Quien(BASE, { nombre: 'B', ip: '10.4.0.1' })
  const C = new Quien(BASE, { nombre: 'C', ip: '10.5.0.1' })
  await registrar(A, 'ana@ejemplo.com', 'Ana')
  await registrar(B, 'beto@ejemplo.com', 'Beto')
  await registrar(C, 'carla@ejemplo.com', 'Carla')

  const va = await armarProyecto(A, 'ANA', 'ZAFIRO')
  const vb = await armarProyecto(B, 'BETO', 'ONIX')
  const claudeA = await conectarOAuth(A, 'Claude')
  const gptA = await conectarOAuth(A, 'ChatGPT')
  const claudeB = await conectarOAuth(B, 'Claude')
  for (const cli of [claudeA, gptA, claudeB]) await herramienta(cli, 'listar_proyectos', {})
  const miembrosA = (await A.g('/api/miembros')).json
  const yoA = miembrosA.find((m) => m.esYo)
  const mClaude = miembrosA.find((m) => m.nombre === 'Claude')
  const mGpt = miembrosA.find((m) => m.nombre === 'ChatGPT')

  titulo('Los miembros tienen alias')
  ok(yoA?.alias === 'ana' && mClaude?.alias === 'claude' && mGpt?.alias === 'chatgpt', 'Ana, Claude y ChatGPT nacen con su alias (ana, claude, chatgpt)', miembrosA)
  const cambio = await A.pedir('PATCH', `/api/miembros/${mGpt.id}`, { alias: 'gpt' })
  ok(cambio.status === 200 && cambio.json.alias === 'gpt', 'se puede cambiar el alias (chatgpt → gpt)', cambio.texto)
  ok((await A.pedir('PATCH', `/api/miembros/${mGpt.id}`, { alias: 'claude' })).status === 409, 'un alias repetido da 409')
  ok((await A.pedir('PATCH', `/api/miembros/${mGpt.id}`, { alias: 'yo' })).status === 409, 'un alias reservado (yo) da 409')
  ok((await A.pedir('PATCH', `/api/miembros/${mGpt.id}`, { alias: 'a' })).status === 400, 'un alias demasiado corto da 400')
  ok((await B.g('/api/miembros')).json.every((m) => m.alias) && (await B.g('/api/miembros')).json.find((m) => m.nombre === 'Claude')?.alias === 'claude', 'cada cuenta tiene sus alias (el «claude» de B es de B)')
  const tarjetaAsig = await A.p('/api/tarjetas', { tableroId: va.tablero, titulo: 'Asignada por alias', responsables: ['@claude'] })
  ok(tarjetaAsig.status === 201 && tarjetaAsig.json.responsables?.includes(mClaude.id), '«Agregar tarjeta» con @claude asigna a Claude (el alias exacto), y @yo sigue andando', tarjetaAsig.texto)
  ok((await A.p('/api/tarjetas', { tableroId: va.tablero, titulo: 'Con @yo', responsables: ['@yo'] })).json.responsables?.includes(yoA.id), '@yo sigue asignando a la persona')

  const [k1, k2, k3] = va.k
  const sinLeerA = async () => (await A.g('/api/novedades')).json.sinLeer

  titulo('Menciones (M1 a M16)')
  // M1
  const idM1 = `c${unico()}`
  const m1 = await A.p(`/api/tarjetas/${k1}/comentarios`, { cuerpo: '@claude ya le respondí', id: idM1 })
  ok(m1.status === 201 && m1.json.menciones?.length === 1 && m1.json.menciones[0].estado === 'pendiente' && m1.json.menciones[0].destinatarioId === mClaude.id, 'M1: comentar «@claude ya le respondí» deja una mención pendiente a Claude (el comentario vuelve con ella)', m1.texto)
  ok(m1.json.menciones?.[0]?.origen?.tipo === 'comentario' && m1.json.menciones[0].tarjetaClave === k1 && m1.json.menciones[0].enlace === `/ANA?tarjeta=${k1}` && m1.json.menciones[0].autor.id === yoA.id, 'M1: la mención sabe de dónde viene, quién la escribió y a dónde lleva', m1.json?.menciones)
  ok((await sinLeerA()) === 0, 'M1: ninguna notificación para A (nadie se avisa a sí mismo)')
  ok((await pendientes(claudeA)).length === 1, 'M1: Claude la ve en leer_pendientes')
  // M2
  const m2 = await A.p(`/api/tarjetas/${k1}/comentarios`, { cuerpo: '@claude ya le respondí', id: idM1 })
  ok(m2.status === 201 && m2.json.id === idM1 && m2.json.menciones?.length === 1 && m2.json.menciones[0].id === m1.json.menciones[0].id, 'M2: el mismo POST con el mismo id devuelve el mismo comentario y la misma mención', m2.texto)
  const det1 = (await A.g(`/api/tarjetas/${k1}`)).json
  ok(det1.comentarios.filter((c) => c.id === idM1).length === 1 && det1.comentarios.length === 1, 'M2: queda un solo comentario')
  ok((await pendientes(claudeA)).length === 1, 'M2: y una sola mención')
  const otraTarjeta = await A.p(`/api/tarjetas/${k2}/comentarios`, { cuerpo: 'repito el id', id: idM1 })
  ok(otraTarjeta.status === 409, 'M2: ese id en otra tarjeta da 409 (no pisa el comentario de la primera)', otraTarjeta.texto)
  // M3
  const m3 = await A.pedir('PATCH', `/api/comentarios/${idM1}`, { cuerpo: '@claude ya le respondi' })
  ok(m3.status === 200 && m3.json.menciones?.length === 1 && m3.json.menciones[0].id === m1.json.menciones[0].id, 'M3: corregir un typo no crea ninguna fila nueva', m3.texto)
  ok((await pendientes(claudeA)).length === 1, 'M3: sigue una sola pendiente')
  // M4
  const m4 = await A.pedir('PATCH', `/api/comentarios/${idM1}`, { cuerpo: '@claude ya le respondi, y @gpt mirá esto' })
  ok(m4.status === 200 && m4.json.menciones?.length === 2, 'M4: agregar «@gpt» suma una mención', m4.texto)
  const aGpt = m4.json.menciones?.find((m) => m.destinatarioId === mGpt.id)
  ok(Boolean(aGpt) && aGpt.estado === 'pendiente' && m4.json.menciones.find((m) => m.destinatarioId === mClaude.id)?.id === m1.json.menciones[0].id, 'M4: la nueva es solo a GPT y la de Claude es la misma de antes')
  ok((await pendientes(claudeA)).length === 1 && (await pendientes(gptA)).length === 1, 'M4: Claude sigue con una y GPT tiene una')
  // M5
  const m5 = await A.pedir('PATCH', `/api/comentarios/${idM1}`, { cuerpo: 'ya le respondi, y @gpt mirá esto' })
  ok(m5.status === 200 && m5.json.menciones?.length === 1 && m5.json.menciones[0].destinatarioId === mGpt.id, 'M5: sacar «@claude» antes de que se atienda retira esa mención', m5.texto)
  ok((await pendientes(claudeA)).length === 0, 'M5: Claude ya no la tiene pendiente')
  const retirada = await herramienta(claudeA, 'atender_mencion', { mencion: m1.json.menciones[0].id })
  ok(retirada.json?.mencion?.estado === 'retirada', 'M5: la mención quedó «retirada» (atenderla no la revive)', retirada.texto)
  // M6
  const m6 = await A.pedir('DELETE', `/api/comentarios/${idM1}`)
  ok(m6.status === 200 && (await pendientes(gptA)).length === 0, 'M6: borrar el comentario retira sus menciones pendientes')
  ok((await herramienta(gptA, 'atender_mencion', { mencion: aGpt.id })).json?.mencion?.estado === 'retirada', 'M6: la de GPT quedó «retirada»')
  // M7
  const antes7 = (await pendientes(claudeA)).length
  const m7 = await comentar(A, k1, 'a medio escribir @cl, un mail a@b.com y código `@claude`, o https://x.com/@claude, y yo mismo @ana\n\n```\n@claude\n```')
  ok(m7.status === 201 && !m7.json.menciones && (await pendientes(claudeA)).length === antes7 && (await sinLeerA()) === 0, 'M7: «@cl», «a@b.com», código y direcciones no mencionan a nadie (tampoco uno mismo)', m7.texto)
  // M8
  const m8 = await A.pedir('PATCH', `/api/tarjetas/${k2}`, { descripcion: '@claude revisá esta descripción' })
  const p8 = (await pendientes(claudeA)).find((m) => m.tarjeta === k2)
  ok(m8.status === 200 && p8?.donde === 'descripción de la tarjeta', 'M8: guardar una descripción con «@claude» crea una mención de origen «descripcion»', p8)
  await A.pedir('PATCH', `/api/tarjetas/${k2}`, { descripcion: '@claude revisá esta descripción, por favor' })
  ok((await pendientes(claudeA)).filter((m) => m.tarjeta === k2).length === 1, 'M8: editar la descripción sin agregar menciones no crea otra')
  // M9
  const porque = (motivo) => A.pedir('PUT', `/api/tarjetas/${k3}/porque`, { motivo })
  await porque('Esto sale de lo que dijo @claude')
  await porque('Esto sale de lo que dijo @claude, otra vez')
  const p9 = (await pendientes(claudeA)).filter((m) => m.tarjeta === k3)
  ok(p9.length === 1 && p9[0].donde === 'porqué de la tarjeta', 'M9: dos guardados seguidos del porqué con «@claude» dejan una sola mención', p9)
  // M10
  const cursor = (await A.g('/api/eventos/desde?n=0')).json.n
  const nota10 = await herramienta(claudeA, 'armar_en_lienzo', { proyecto: va.prefijo, objetos: [{ ref: 'n', tipo: 'nota', texto: 'Mirá esto, @ana: quedó armado' }] })
  const nov10 = (await A.g('/api/novedades')).json
  const n10 = nov10.notificaciones.find((n) => n.tipo === 'mencion')
  ok(!nota10.error && Boolean(n10) && /Claude te mencionó en una nota del lienzo/.test(n10.titulo) && n10.actor?.nombre === 'Claude' && n10.leidaEn === null && nov10.sinLeer === 1, 'M10: una IA arma una nota con «@ana» y A recibe la notificación «mencion»', nov10)
  ok(n10?.enlace?.startsWith('/ANA/') && n10.enlace.endsWith('/lienzo') && n10.cuerpo.includes('@ana'), 'M10: la notificación lleva a su lugar (la ruta del lienzo) y al texto de la mención', n10)
  const vivo10 = (await A.g(`/api/eventos/desde?n=${cursor}`)).json.eventos
  ok(vivo10.some((e) => e.tipo === 'notificacion' && e.accion === 'nueva' && e.datos?.paraId === yoA.id), 'M10: la notificación sale por los eventos en vivo (tipo «notificacion», accion «nueva»)')
  ok((await pendientes(claudeA)).length >= 2 && !(await pendientes(claudeA)).some((m) => m.donde === 'nota del lienzo'), 'M10: lo de una persona no queda como pendiente de nadie (era para Ana)')
  // quitar la nota y restaurarla no repite el aviso
  const objNota = Object.values(nota10.json?.objetos ?? {})[0]
  if (objNota) {
    await herramienta(claudeA, 'quitar_del_lienzo', { proyecto: va.prefijo, objetos: [objNota] })
    await herramienta(claudeA, 'quitar_del_lienzo', { proyecto: va.prefijo, restaurar: true, objetos: [objNota] })
  }
  ok((await sinLeerA()) === 1, 'M10: sacar la nota del lienzo y restaurarla no repite la notificación')
  // M11: el importador (actor «sistema»)
  const claudeDueno = new Client({ name: 'telar-prueba-ia', version: '1.0.0' })
  await claudeDueno.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${CLAVE}`, 'x-tablero-autor': 'Claude' } } }))
  await herramienta(claudeDueno, 'listar_proyectos', {})
  const item = { id: 'IA-01', tipo: 'idea', area: 'otra', titulo: 'Tema importado', descripcion: 'Que lo mire @claude', citas: [], autores: [], fechas: [], canal: '#x', adjuntos: [], estado: 'pendiente', evidencia: '', prioridad: '', motivo_prioridad: '', respuesta_sugerida: '', relacionados: [] }
  const imp = await dueno.p('/api/importar/discord-json', { datos: [item], proyecto: 'RC' })
  ok(imp.status === 200 && imp.json.nuevas === 1, 'M11: el importador de Discord (actor «sistema») crea una tarjeta con «@claude» en el texto', imp.texto)
  ok((await pendientes(claudeDueno)).length === 0, 'M11: y no deja ninguna mención')
  // M12: responder es mencionar
  const rClaude = await herramienta(claudeA, 'comentar', { tarjeta: k2, texto: '**Revisado:** hay que ajustar la altura.' })
  const detK2 = (await A.g(`/api/tarjetas/${k2}`)).json
  const deClaude = detK2.comentarios.find((c) => c.autor.nombre === 'Claude')
  const m12 = await comentar(A, k2, 'Gracias, probalo con 12 px', { respondeA: deClaude.id })
  ok(rClaude.json?.ok && m12.status === 201 && m12.json.respuestaA === deClaude.id && m12.json.menciones?.length === 1 && m12.json.menciones[0].destinatarioId === mClaude.id, 'M12: responder a un comentario de una IA, sin «@», es mencionarla (y el comentario es una respuesta)', m12.texto)
  ok((await pendientes(claudeA)).some((m) => m.tarjeta === k2 && m.texto.includes('12 px')), 'M12: Claude lo ve en leer_pendientes')
  ok((await comentar(A, k2, 'x', { respondeA: 'noexiste' })).status === 404, 'M12: responder a un comentario que no existe da 404')
  ok((await comentar(A, k1, 'x', { respondeA: deClaude.id })).status === 404, 'M12: ni a un comentario de otra tarjeta (404)')
  const aPersona = await comentar(A, k2, 'Y yo respondo al mío', { respondeA: m12.json.id })
  ok(aPersona.status === 201 && !aPersona.json.menciones, 'M12: responder a un comentario de una persona no menciona a nadie')
  // M13: el camino completo por MCP, como «Claude»
  const idsAntes = new Set((await pendientes(claudeA)).map((m) => m.id))
  const m13 = await comentar(A, k3, '@claude ¿podés revisar esto?')
  const pend13 = (await pendientes(claudeA)).find((m) => !idsAntes.has(m.id) && m.tarjeta === k3)
  ok(Boolean(pend13) && pend13.de === 'Ana' && pend13.texto.includes('podés revisar'), 'M13: leer_pendientes (Claude) trae la mención nueva con quién la escribió', pend13)
  const sinLeer0 = await sinLeerA()
  const resp13 = await herramienta(claudeA, 'comentar', { tarjeta: k3, texto: '**Revisado:** está bien.' })
  const quedan13 = await pendientes(claudeA)
  ok(resp13.json?.ok && !quedan13.some((m) => m.tarjeta === k3), 'M13: al comentar en la tarjeta, sus menciones quedan atendidas (la segunda lectura no las trae)', quedan13)
  ok(quedan13.some((m) => m.tarjeta === k2), 'M13: las de otras tarjetas siguen pendientes')
  const nov13 = (await A.g('/api/novedades')).json
  const n13 = nov13.notificaciones.find((n) => n.tipo === 'respuesta' && n.titulo === `Claude respondió en ${k3}`)
  ok(Boolean(n13) && n13.titulo === `Claude respondió en ${k3}` && n13.cuerpo.startsWith('**Revisado:**') && n13.enlace === `/ANA?tarjeta=${k3}` && nov13.sinLeer === sinLeer0 + 1, 'M13: A recibe la notificación «respuesta»', nov13.notificaciones.slice(0, 2))
  // M14
  const idsM14 = new Set((await pendientes(claudeA)).map((m) => m.id))
  const m14 = await comentar(A, k1, 'Che @claude, esto ya estaba hecho, ¿no?')
  const id14 = m14.json.menciones[0].id
  ok(idsM14.has(id14) === false, 'M14: (una mención nueva para atender sin comentar)')
  const sinLeer14 = await sinLeerA()
  const at1 = await herramienta(claudeA, 'atender_mencion', { mencion: id14, nota: 'Ya estaba hecho' })
  const sinLeer14b = await sinLeerA()
  const at2 = await herramienta(claudeA, 'atender_mencion', { mencion: id14, nota: 'otra nota' })
  ok(at1.json?.mencion?.estado === 'atendida' && at2.json?.mencion?.estado === 'atendida', 'M14: atender_mencion la deja atendida, y dos veces es lo mismo', [at1.texto, at2.texto])
  ok(sinLeer14b === sinLeer14 + 1 && (await sinLeerA()) === sinLeer14b, 'M14: atenderla una sola vez avisa una sola vez (la segunda no cambia nada)')
  ok(!(await pendientes(claudeA)).some((m) => m.id === id14), 'M14: ya no figura en leer_pendientes')
  const dosEnUno = await comentar(A, k1, '@claude uno y @claude dos en el mismo comentario')
  const pendDos = (await pendientes(claudeA)).filter((m) => m.tarjeta === k1)
  ok(dosEnUno.json.menciones?.length === 2 && pendDos.length === 1, 'M14: dos «@claude» en el mismo comentario son dos filas pero una sola cosa para atender', dosEnUno.json?.menciones)
  await herramienta(claudeA, 'atender_mencion', { mencion: pendDos[0].id })
  ok((await pendientes(claudeA)).filter((m) => m.tarjeta === k1).length === 0, 'M14: atenderla las atiende a las dos')

  // M15: B no ve ni toca nada de A
  titulo('Aislamiento (M15): Beto no ve ni toca nada de Ana')
  const novB = (await B.g('/api/novedades')).json
  ok(novB.notificaciones.length === 0 && novB.sinLeer === 0 && !JSON.stringify(novB).includes('ZAFIRO'), 'M15: las novedades de B no traen nada de A', novB)
  const notifA = (await A.g('/api/notificaciones')).json
  ok(notifA.length >= 3, 'M15: (A tiene sus notificaciones)', notifA.length)
  ok((await B.g('/api/notificaciones')).json.length === 0, 'M15: /api/notificaciones de B está vacío')
  const miembrosB = (await B.g('/api/miembros')).json
  ok(!JSON.stringify(miembrosB).includes('Ana') && !miembrosB.some((m) => m.id === yoA.id || m.id === mClaude.id), 'M15: los miembros de B no incluyen a los de A')
  const pendB = await herramienta(claudeB, 'leer_pendientes', {})
  ok(!pendB.error && pendB.json.menciones.length === 0 && !pendB.texto.includes('ZAFIRO'), 'M15: leer_pendientes del Claude de B no trae nada de A', pendB.texto)
  const pendAsB = await herramienta(claudeB, 'leer_pendientes', { proyecto: va.prefijo })
  ok(pendAsB.error && /No encontré el proyecto/.test(pendAsB.texto), 'M15: ni pidiendo el proyecto de A (404)', pendAsB.texto)
  const robo = await herramienta(claudeB, 'atender_mencion', { mencion: m14.json.menciones[0].id })
  const noExiste = await herramienta(claudeB, 'atender_mencion', { mencion: 'm_noexiste12345' })
  ok(robo.error && /No existe esa mención/.test(robo.texto) && robo.texto === noExiste.texto, 'M15: atender una mención de A desde B da el mismo error que una que no existe', robo.texto)
  const leerAjena = await B.p('/api/notificaciones/leer', { ids: [n13.id] })
  const leerFalsa = await B.p('/api/notificaciones/leer', { ids: ['n_noexiste12345'] })
  ok(leerAjena.status === 404 && leerAjena.texto === leerFalsa.texto, 'M15: marcar leída una notificación de A desde B: 404, igual que una que no existe', leerAjena.texto)
  ok((await A.g('/api/notificaciones')).json.find((n) => n.id === n13.id)?.leidaEn === null, 'M15: y la de A sigue sin leer')
  const respAjena = await B.p(`/api/tarjetas/${vb.k[0]}/comentarios`, { cuerpo: 'x', respondeA: deClaude.id })
  ok(respAjena.status === 404, 'M15: responder desde B a un comentario de A: 404')
  const idAjeno = await B.p(`/api/tarjetas/${vb.k[0]}/comentarios`, { cuerpo: 'x', id: idM1 })
  ok(idAjeno.status === 201, 'M15: usar de id el de un comentario ya borrado de A no pisa nada (B crea el suyo)')
  const mB = await comentar(B, vb.k[0], '@claude mirá, es de Beto')
  ok(mB.json.menciones?.length === 1 && mB.json.menciones[0].destinatarioId !== mClaude.id, 'M15: «@claude» de B es el Claude de B, no el de A')
  ok((await pendientes(claudeB)).length === 1 && !(await pendientes(claudeA)).some((m) => m.texto.includes('es de Beto')), 'M15: y Claude de A no la ve')
  ok((await B.g('/api/novedades')).json.sinLeer === 0, 'M15: B no recibe nada por lo de A')
  ok((await dueno.p('/api/notificaciones/leer', { ids: [n13.id] })).status === 404, 'M15: la clave del MCP (el dueño) tampoco puede tocar una notificación de A')

  // M16
  titulo('Costo (M16)')
  const cuentaConsultas = await new Promise((resolver) => {
    const h = spawn(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), ['scripts/probar-ia-consultas.ts'], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] })
    let salida = ''
    h.stdout.on('data', (d) => (salida += d))
    h.stderr.on('data', (d) => (salida += d))
    h.on('close', () => resolver(salida))
  })
  const medidas = (() => {
    try {
      return JSON.parse(/RESULTADO (.*)/.exec(cuentaConsultas)?.[1] ?? '')
    } catch {
      return null
    }
  })()
  ok(Boolean(medidas) && medidas.sinGanchos === medidas.conGanchos, `M16: comentar sin «@» cuesta lo mismo con la IA conectada que sin ella (${medidas?.sinGanchos} y ${medidas?.conGanchos} consultas)`, cuentaConsultas.slice(-600))
  ok(Boolean(medidas) && medidas.conArroba > medidas.conGanchos && medidas.conArroba - medidas.conGanchos <= 6, `M16: con «@» suma unas pocas (${medidas?.conArroba})`, medidas)

  // Preferencias y paginación de la bandeja
  titulo('Notificaciones: preferencias, leídas y bandeja')
  const pref0 = (await A.g('/api/notificaciones/preferencias')).json
  ok(pref0.push.mencion === true && pref0.push.asignacion === false && pref0.correo.mencion === false && pref0.silencio === null, 'las preferencias de fábrica: push todo salvo asignaciones, correo apagado, sin silencio', pref0)
  const pref1 = await A.pedir('PUT', '/api/notificaciones/preferencias', { push: { mencion: false }, silencio: { desde: '22:00', hasta: '08:00' } })
  ok(pref1.status === 200 && pref1.json.push.mencion === false && pref1.json.push.respuesta === true && pref1.json.silencio?.desde === '22:00', 'guardar preferencias cambia lo que llega y deja lo demás', pref1.texto)
  ok(JSON.stringify((await A.g('/api/notificaciones/preferencias')).json) === JSON.stringify(pref1.json), 'y quedan guardadas')
  ok((await A.pedir('PUT', '/api/notificaciones/preferencias', { push: { inventado: true } })).status === 400, 'un tipo que no existe: 400')
  ok((await A.pedir('PUT', '/api/notificaciones/preferencias', { silencio: { desde: '25:00', hasta: '08:00' } })).status === 400, 'una hora imposible: 400')
  ok((await B.g('/api/notificaciones/preferencias')).json.push.mencion === true, 'las preferencias de B no cambiaron')
  const pag1 = (await A.g('/api/notificaciones?limite=2')).json
  const pag2 = (await A.g(`/api/notificaciones?limite=2&antes=${encodeURIComponent(pag1[1].creadoEn)}`)).json
  ok(pag1.length === 2 && pag2.length >= 1 && !pag2.some((n) => pag1.some((x) => x.id === n.id)), 'la bandeja se pide de a poco con «antes» (sin repetir)')
  const sinLeer = (await A.g('/api/novedades')).json.sinLeer
  const unaLeida = await A.p('/api/notificaciones/leer', { ids: [n13.id] })
  ok(unaLeida.json.leidas === 1 && (await A.g('/api/novedades')).json.sinLeer === sinLeer - 1, 'marcar una leída baja el contador en 1')
  const eventosLeer = (await A.p('/api/notificaciones/leer', { todas: true })).json
  ok(eventosLeer.leidas === sinLeer - 1 && (await A.g('/api/novedades')).json.sinLeer === 0, 'marcar todo como leído deja el contador en 0')
  ok((await A.p('/api/notificaciones/leer', { todas: true })).json.leidas === 0, 'y repetirlo no cambia nada')
  ok((await A.p('/api/notificaciones/leer', {})).status === 400, 'sin ids ni «todas»: 400')

  // ───────────────────────── V: las menciones que ya estaban escritas ─────────────────────────
  titulo('Las menciones de antes (V1 a V6)')
  const vc = await armarProyecto(C, 'CARLA', 'RUBI')
  const [kc1, kc2, kc3] = vc.k
  const claudeC = await conectarOAuth(C, 'Claude')
  await herramienta(claudeC, 'listar_proyectos', {})
  const miembrosC = (await C.g('/api/miembros')).json
  const yoC = miembrosC.find((m) => m.esYo)
  const mClaudeC = miembrosC.find((m) => m.nombre === 'Claude')
  const comentariosViejos = [
    { id: 'viejo000001', tarjeta: vc.id[0], autor: { tipo: 'humano', id: yoC.id, nombre: 'Carla' }, cuerpo: '@claude ya le respondi', hace: 50 },
    { id: 'viejo000002', tarjeta: vc.id[1], autor: { tipo: 'humano', id: yoC.id, nombre: 'Carla' }, cuerpo: '@claude revisá esto', hace: 40 },
    { id: 'viejo000003', tarjeta: vc.id[1], autor: { tipo: 'ia', id: mClaudeC.id, nombre: 'Claude' }, cuerpo: '**Revisado:** ya está.', hace: 30 },
    { id: 'viejo000004', tarjeta: vc.id[2], autor: { tipo: 'humano', id: yoC.id, nombre: 'Carla' }, cuerpo: 'che @codex mirá, y @gpt también', hace: 20 },
    { id: 'viejo000005', tarjeta: vc.id[2], autor: { tipo: 'humano', id: yoC.id, nombre: 'Carla' }, cuerpo: 'escribime a carla@ejemplo.com o usá `@claude` así', hace: 15 },
    { id: 'viejo000006', tarjeta: vc.id[2], autor: { tipo: 'humano', id: yoC.id, nombre: 'Carla' }, cuerpo: '@claude uno y @claude dos', hace: 10 },
  ]
  const insertarViejos = async (lista, { reponerMarca }) => {
    await apagar(srv)
    const { PGlite } = await import('@electric-sql/pglite')
    const db = await PGlite.create(path.join(datos, 'pg'))
    for (const c of lista)
      await db.query(`insert into comentarios (id, tarjeta_id, autor, cuerpo, creado_en) values ($1, $2, $3::jsonb, $4, now() - ($5 || ' minutes')::interval)`, [c.id, c.tarjeta, JSON.stringify(c.autor), c.cuerpo, String(c.hace)])
    if (reponerMarca) await db.query(`update cuentas set menciones_levantadas_en = null where id = (select id from cuentas where email = 'carla@ejemplo.com')`)
    await db.close()
    srv = await levantar(datos, { extra: { TABLERO_IA_FALSO: '1' } })
  }
  await insertarViejos(comentariosViejos, { reponerMarca: true })
  // A y C tuvieron que volver a entrar: sus cookies siguen valiendo (firmadas), pero los tokens OAuth también (la base es la misma).
  const nov0 = (await C.g('/api/novedades')).json
  ok(nov0.notificaciones.length === 1 && /Encontré 4 menciones pendientes de antes/.test(nov0.notificaciones[0].titulo) && nov0.sinLeer === 1, 'V1: la primera vez que se piden las novedades se levantan las de antes, con un único aviso («Encontré 4 menciones pendientes de antes»)', nov0)
  const pC = await pendientes(claudeC)
  const claveDe = (p) => `${p.tarjeta}:${p.texto}`
  ok(pC.some((p) => p.tarjeta === kc1 && p.texto.includes('ya le respondi')), 'V2: «@claude ya le respondi» (sin respuesta posterior de Claude) queda pendiente', pC.map(claveDe))
  ok(!pC.some((p) => p.tarjeta === kc2), 'V3: si Claude comentó DESPUÉS en esa tarjeta, la mención queda atendida', pC.map(claveDe))
  ok(pC.filter((p) => p.tarjeta === kc3 && p.texto.includes('@claude uno')).length === 1, 'V4: dos «@claude» en un mismo comentario viejo: una sola cosa para atender')
  ok(!pC.some((p) => p.texto.includes('carla@ejemplo.com') || p.texto.includes('usá `@claude`')), 'V4: lo que está en código o es un mail no se levanta')
  const miembrosC2 = (await C.g('/api/miembros')).json
  ok(miembrosC2.some((m) => m.nombre === 'Codex' && m.alias === 'codex' && m.tipo === 'ia') && miembrosC2.some((m) => m.nombre === 'ChatGPT' && m.tipo === 'ia'), 'V5: una IA conocida mencionada que todavía no era miembro (@codex, @gpt) se crea para que la mención no se pierda', miembrosC2.map((m) => m.nombre))
  const mCodex = miembrosC2.find((m) => m.nombre === 'Codex')
  const codexC = await conectarOAuth(C, 'Codex')
  ok((await pendientes(codexC)).length === 1 && (await pendientes(codexC))[0].tarjeta === kc3, 'V5: Codex ve su mención cuando se conecta', await pendientes(codexC))
  ok(Boolean(mCodex), 'V5: (Codex existe como miembro)')
  const nov1 = (await C.g('/api/novedades')).json
  ok(nov1.notificaciones.length === 1 && nov1.sinLeer === 1, 'V1: por las menciones viejas no hay notificaciones sueltas (solo el aviso)', nov1)
  const total1 = pC.length
  const otra = await C.p('/api/ia/menciones/levantar', {})
  ok(otra.status === 200 && otra.json.pendientes === 0 && otra.json.atendidas === 0, 'V6: repetirlo a mano no duplica nada', otra.texto)
  ok((await pendientes(claudeC)).length === total1 && (await C.g('/api/novedades')).json.notificaciones.length === 1, 'V6: dos corridas dan lo mismo (las pendientes y el aviso)')
  ok((await dueno.p('/api/ia/menciones/levantar', {})).status === 403, 'V6: con la clave del MCP no se puede levantar a mano (solo con sesión): 403')
  ok((await B.p('/api/ia/menciones/levantar', {})).json?.pendientes === 0 && (await pendientes(claudeB)).length === 1, 'V6: Beto lo corre en su cuenta y no levanta nada de Carla (ni de Ana)')
  // Una vez por cuenta: un comentario viejo nuevo no se levanta con las novedades, sí a mano.
  await insertarViejos([{ id: 'viejo000007', tarjeta: vc.id[0], autor: { tipo: 'humano', id: yoC.id, nombre: 'Carla' }, cuerpo: '@claude otra de antes', hace: 5 }], { reponerMarca: false })
  await C.g('/api/novedades')
  ok((await pendientes(claudeC)).length === total1, 'V6: la marca de la cuenta evita levantar de nuevo con las novedades')
  const manual = await C.p('/api/ia/menciones/levantar', {})
  ok(manual.json?.pendientes === 1 && (await pendientes(claudeC)).length === total1 + 1, 'V6: a mano sí levanta lo que faltaba (una pendiente más)', manual.texto)
  ok((await C.g('/api/novedades')).json.notificaciones.length === 1, 'V6: y el aviso es uno solo')

  // Claves, agentes, ajustes y código (T17, T18 y lo de GitHub): al final, para que el agente «Claude» de A no cambie las menciones de arriba.
  await escenariosA({ ok, titulo, A, B, dueno, va, vb, srv, datos, claudeA, github })

  await Promise.all([claudeA, gptA, claudeB, claudeDueno, claudeC, codexC].map((c) => c.close().catch(() => {})))
  await apagar(srv)
  await faseTrabajos()
} catch (e) {
  fallas++
  console.error('\n✗ La prueba se cortó:', e?.stack ?? e)
} finally {
  for (const s of servidores) await apagar(s)
  await github?.cerrar()
  rmSync(datos, { recursive: true, force: true })
}
console.log(`\n${fallas ? `✗ ${fallas} de ${pruebas} fallaron` : `✓ ${pruebas} comprobaciones: todo bien`}`)
process.exit(fallas ? 1 : 0)
