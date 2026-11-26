// Prueba de punta a punta del OAuth 2.1 de Telar (ChatGPT y claude.ai), como lo haría un conector real:
//   descubrir los metadatos desde el 401 de /mcp → registrarse (DCR) → autorizar con PKCE (con la cookie del dueño) →
//   canjear el código → llamar al MCP con el token (cliente oficial) → refrescar → y comprobar todo lo que TIENE que fallar.
// Cuentas (docs/cuentas.md): una cuenta de Telar también conecta su IA; el token actúa como ESA cuenta (no ve lo del dueño),
// y las conexiones son de cada cuenta. (El aislamiento completo, ruta por ruta, lo prueba npm run cuentas:probar.)
// Levanta su propio Telar local (base descartable en una carpeta temporal, puerto 4348, TABLERO_PUBLICO=1), así no toca
// nada del dueño. Se niega si la dirección no es 127.0.0.1 o localhost.
//
//   node scripts/probar-oauth.mjs
//   node scripts/probar-oauth.mjs --puerto 4349
//   node scripts/probar-oauth.mjs --externo http://127.0.0.1:4348    (contra un Telar local que ya corre con esas variables)
import { spawn } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const PUERTO = Number(opcion('puerto', '4348'))
const EXTERNO = opcion('externo', '')
const BASE = EXTERNO || `http://127.0.0.1:${PUERTO}`
if (!['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname)) {
  console.error('Solo contra un Telar local (127.0.0.1 o localhost).')
  process.exit(1)
}

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SECRETO = 'secreto-de-prueba-0123456789-abcdefghijklmnopqrstuvwxyz'
const USUARIO = 'usuario-prueba'
const CLAVE = 'clave-de-prueba-del-mcp'
const REDIRECCION = 'http://localhost:6274/oauth/callback'

let fallas = 0
const ok = (cond, que, detalle) => {
  if (!cond) fallas++
  console.log(`${cond ? '  ✓' : '  ✗'} ${que}${!cond && detalle !== undefined ? `\n      ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}` : ''}`)
  return cond
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const sha = (t) => createHash('sha256').update(t).digest('base64url')

// La cookie del dueño, firmada como lo hace servidor/src/sesion.ts
function cookie(usuario = USUARIO) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const base = `v1.${usuario}.${exp}`
  return `tablero_sesion=${base}.${createHmac('sha256', SECRETO).update(base).digest('base64url')}`
}

// Un JWT firmado con el mismo secreto derivado que usa el servidor (para probar audiencia, vencimiento y usuario).
function jwtFalso(carga) {
  const secreto = createHmac('sha256', SECRETO).update('telar-oauth-v1').digest('hex')
  const base = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(carga)}`
  return `${base}.${createHmac('sha256', secreto).update(base).digest('base64url')}`
}

let servidor = null
async function levantar() {
  if (EXTERNO) return
  const datos = mkdtempSync(path.join(os.tmpdir(), 'telar-oauth-'))
  // Si ya hay algo en el puerto (otra prueba que quedó prendida), se avisa: si no, se probaría contra ese.
  if (await fetch(`${BASE}/api/salud`).then(() => true, () => false)) throw new Error(`El puerto ${PUERTO} ya está ocupado: apagá lo que corre ahí o usá --puerto.`)
  // tsx directo (no npx): así el SIGTERM de apagar() le llega al servidor y no queda prendido.
  servidor = spawn(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), ['servidor/src/principal.ts', '--produccion'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      TABLERO_DATOS: datos,
      TABLERO_PUERTO: String(PUERTO),
      TABLERO_PUBLICO: '1',
      TABLERO_SECRETO: SECRETO,
      TABLERO_USUARIOS: USUARIO,
      TABLERO_URL_PUBLICA: BASE,
      TABLERO_CLAVE: CLAVE,
      TABLERO_INVITACION: 'pase-oauth',
      TABLERO_SEMILLA_DISCORD: 'no',
    },
    stdio: 'ignore',
  })
  servidor.carpeta = datos
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/salud`)
      if (r.ok && (await r.json()).listo) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('El Telar de prueba no arrancó en 60 segundos.')
}
async function apagar() {
  if (!servidor) return
  servidor.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  rmSync(servidor.carpeta, { recursive: true, force: true })
}

const form = (o) => new URLSearchParams(o).toString()
const post = (ruta, cuerpo, extra = {}) =>
  fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...extra },
    body: form(cuerpo),
  })

/** Hace el baile hasta tener el código: devuelve { code, verifier, clientId, redirigir }. */
async function autorizar(clientId, { verifier = randomBytes(32).toString('base64url'), redirect = REDIRECCION, recurso = `${BASE}/mcp`, permitir = true } = {}) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    code_challenge: sha(verifier),
    code_challenge_method: 'S256',
    resource: recurso,
    scope: 'telar offline_access',
    state: 'estado-123',
  })
  const r = await fetch(`${BASE}/oauth/autorizar?${q}`, { redirect: 'manual' })
  return { respuesta: r, verifier, location: r.headers.get('location') ?? '' }
}

async function decidir(pedido, permitir = true, galleta = cookie()) {
  const r = await fetch(`${BASE}/api/oauth/decidir`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: galleta },
    body: JSON.stringify({ pedido, permitir }),
  })
  return { estado: r.status, cuerpo: await r.json().catch(() => ({})) }
}

async function conectado(token) {
  const c = new Client({ name: 'openai-mcp', version: '1.0.0' })
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
  return c
}

try {
  await levantar()
  console.log(`\nOAuth de Telar contra ${BASE}\n`)

  console.log('Descubrir')
  const sin = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  const desafio = sin.headers.get('www-authenticate') ?? ''
  ok(sin.status === 401 && /resource_metadata="[^"]+oauth-protected-resource"/.test(desafio), '/mcp sin nada: 401 con resource_metadata', desafio)
  const recurso = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json()
  ok(recurso.resource === `${BASE}/mcp` && recurso.authorization_servers?.[0] === BASE, 'metadatos del recurso (resource y authorization_servers)', recurso)
  const srv = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()
  ok(srv.issuer === BASE && srv.code_challenge_methods_supported?.includes('S256'), 'metadatos del servidor: issuer igual y S256', srv)
  ok(srv.client_id_metadata_document_supported === true && srv.authorization_response_iss_parameter_supported === true && !!srv.registration_endpoint, 'CIMD, iss y registro anunciados')
  const oidc = await (await fetch(`${BASE}/.well-known/openid-configuration`)).json()
  ok(oidc.issuer === srv.issuer, 'openid-configuration devuelve lo mismo')
  const preflight = await fetch(`${BASE}/.well-known/oauth-protected-resource`, { method: 'OPTIONS', headers: { origin: 'http://localhost:6274' } })
  ok(preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === '*', 'CORS abierto en los metadatos (MCP Inspector)')

  console.log('Registrar (DCR)')
  const malo = await fetch(`${BASE}/oauth/registrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Malo', redirect_uris: ['https://malo.example.com/cb'] }) })
  ok(malo.status === 400 && (await malo.json()).error === 'invalid_redirect_uri', 'una redirección fuera de la lista se rechaza')
  const reg = await fetch(`${BASE}/oauth/registrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT de prueba', redirect_uris: [REDIRECCION, 'https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'none' }) })
  const cliente = await reg.json()
  ok(reg.status === 201 && /^cli_/.test(cliente.client_id) && !cliente.client_secret, 'DCR: client_id sin secreto', cliente)

  console.log('Autorizar con PKCE')
  const a = await autorizar(cliente.client_id)
  ok(a.respuesta.status === 302 && a.location.startsWith('/autorizar?pedido='), '/oauth/autorizar manda a la pantalla «Permitir»', a.location)
  const pedido = new URL(a.location, BASE).searchParams.get('pedido')
  const sinCookie = await fetch(`${BASE}/api/oauth/pedido?pedido=${encodeURIComponent(pedido)}`)
  ok(sinCookie.status === 401, 'el pedido sin la cookie del dueño da 401')
  const conClave = await fetch(`${BASE}/api/oauth/pedido?pedido=${encodeURIComponent(pedido)}`, { headers: { authorization: `Bearer ${CLAVE}` } })
  ok(conClave.status === 401, 'la clave del MCP no alcanza para el pedido (hace falta la cookie)')
  const verPedido = await (await fetch(`${BASE}/api/oauth/pedido?pedido=${encodeURIComponent(pedido)}`, { headers: { cookie: cookie() } })).json()
  ok(verPedido.cliente === 'ChatGPT de prueba' && verPedido.sitio === 'localhost:6274', 'la pantalla sabe quién pide y a dónde vuelve', verPedido)
  const sinDecidir = await fetch(`${BASE}/api/oauth/decidir`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pedido, permitir: true }) })
  ok(sinDecidir.status === 401, 'decidir sin la cookie da 401')
  const dec = await decidir(pedido)
  const vuelta = new URL(dec.cuerpo.redirigir)
  const codigo = vuelta.searchParams.get('code')
  ok(dec.estado === 200 && vuelta.origin + vuelta.pathname === REDIRECCION && vuelta.searchParams.get('state') === 'estado-123' && vuelta.searchParams.get('iss') === BASE && !!codigo, 'permitir vuelve con code, state e iss', dec)
  const no = await decidir(new URL((await autorizar(cliente.client_id)).location, BASE).searchParams.get('pedido'), false)
  ok(new URL(no.cuerpo.redirigir).searchParams.get('error') === 'access_denied', 'No permitir vuelve con access_denied')

  console.log('Errores al autorizar')
  const sinS256 = await fetch(`${BASE}/oauth/autorizar?${new URLSearchParams({ client_id: cliente.client_id, redirect_uri: REDIRECCION, response_type: 'code', code_challenge: sha('x'), code_challenge_method: 'plain' })}`, { redirect: 'manual' })
  ok(sinS256.status === 302 && new URL(sinS256.headers.get('location')).searchParams.get('error') === 'invalid_request', 'sin S256 se rechaza (vuelve con error)')
  const otraUri = await autorizar(cliente.client_id, { redirect: 'http://localhost:9999/otro' })
  ok(otraUri.respuesta.status === 400, 'una redirect_uri distinta de la registrada NO redirige: página de error')
  const otroRecurso = await autorizar(cliente.client_id, { recurso: 'https://otro.example.com/mcp' })
  ok(new URL(otroRecurso.location, BASE).searchParams.get('error') === 'invalid_target', 'un resource que no es el MCP se rechaza')
  const sinCliente = await autorizar('cli_que_no_existe')
  ok(sinCliente.respuesta.status === 400, 'un client_id desconocido da página de error')

  console.log('Canjear el código')
  const mal = await post('/oauth/token', { grant_type: 'authorization_code', client_id: cliente.client_id, code: codigo, redirect_uri: REDIRECCION, code_verifier: randomBytes(32).toString('base64url') })
  ok(mal.status === 400 && (await mal.json()).error === 'invalid_grant', 'un code_verifier equivocado falla (y quema el código)')
  // De nuevo, ahora bien:
  const b = await autorizar(cliente.client_id)
  const codigo2 = new URL((await decidir(new URL(b.location, BASE).searchParams.get('pedido'))).cuerpo.redirigir).searchParams.get('code')
  const otraRedir = await post('/oauth/token', { grant_type: 'authorization_code', client_id: cliente.client_id, code: codigo2, redirect_uri: 'http://localhost:1/x', code_verifier: b.verifier })
  ok(otraRedir.status === 400, 'una redirect_uri distinta en el canje falla')
  const c = await autorizar(cliente.client_id)
  const codigo3 = new URL((await decidir(new URL(c.location, BASE).searchParams.get('pedido'))).cuerpo.redirigir).searchParams.get('code')
  const cuerpoToken = { grant_type: 'authorization_code', client_id: cliente.client_id, code: codigo3, redirect_uri: REDIRECCION, code_verifier: c.verifier, resource: `${BASE}/mcp` }
  const canje = await post('/oauth/token', cuerpoToken)
  const tokens = await canje.json()
  ok(canje.status === 200 && tokens.token_type === 'Bearer' && tokens.expires_in === 3600 && !!tokens.access_token && !!tokens.refresh_token, 'el canje correcto devuelve acceso y refresco', { ...tokens, access_token: '…', refresh_token: '…' })
  ok(canje.headers.get('cache-control') === 'no-store', 'la respuesta del token es no-store')
  const reuso = await post('/oauth/token', cuerpoToken)
  ok(reuso.status === 400 && (await reuso.json()).error === 'invalid_grant', 'el código usado dos veces falla')
  const sinAcceso = await fetch(`${BASE}/api/oauth/conexiones`, { headers: { cookie: cookie() } })
  ok((await sinAcceso.json()).length === 0, 'reusar un código revoca lo que salió de él (no queda la conexión)')

  console.log('Usar el MCP con el token')
  // Un canje limpio para el resto
  const d = await autorizar(cliente.client_id)
  const codigo4 = new URL((await decidir(new URL(d.location, BASE).searchParams.get('pedido'))).cuerpo.redirigir).searchParams.get('code')
  const t1 = await (await post('/oauth/token', { grant_type: 'authorization_code', client_id: cliente.client_id, code: codigo4, redirect_uri: REDIRECCION, code_verifier: d.verifier })).json()
  const mcp = await conectado(t1.access_token)
  const lista = await mcp.callTool({ name: 'listar_proyectos', arguments: {} })
  ok(!lista.isError, 'listar_proyectos con el token OAuth (cliente oficial)')
  await mcp.close()
  const claveOk = new Client({ name: 'claude-code', version: '1.0.0' })
  await claveOk.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${CLAVE}` } } }))
  ok(!(await claveOk.callTool({ name: 'listar_proyectos', arguments: {} })).isError, 'la clave de siempre (Claude Code) sigue andando')
  await claveOk.close()
  const info = await fetch(`${BASE}/api/info`, { headers: { authorization: `Bearer ${t1.access_token}` } })
  ok(info.status === 401, '/api/info con un token OAuth da 401 (el token solo vale para /mcp)')
  const arch = await fetch(`${BASE}/archivos/lienzo/x`, { headers: { authorization: `Bearer ${t1.access_token}` } })
  ok(arch.status === 401, '/archivos con un token OAuth da 401')

  console.log('Tokens que NO valen')
  const ahora = Math.floor(Date.now() / 1000)
  const base = { t: 'acceso', iss: BASE, aud: `${BASE}/mcp`, sub: USUARIO, cid: cliente.client_id, cn: 'X', scope: 'telar', iat: ahora, exp: ahora + 600, jti: 'j' }
  const llamar = (token) => fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: '{}' })
  const bueno = await llamar(jwtFalso(base))
  ok(bueno.status !== 401, 'control: un JWT bien armado con el secreto sí pasa')
  ok((await llamar(jwtFalso({ ...base, aud: 'https://otro.example.com/mcp' }))).status === 401, 'aud de otro recurso: 401')
  ok((await llamar(jwtFalso({ ...base, iss: 'https://otro.example.com' }))).status === 401, 'iss de otro emisor: 401')
  ok((await llamar(jwtFalso({ ...base, exp: ahora - 10 }))).status === 401, 'token vencido: 401')
  ok((await llamar(jwtFalso({ ...base, sub: 'otro-usuario' }))).status === 401, 'usuario fuera de TABLERO_USUARIOS: 401')
  ok((await llamar(jwtFalso({ ...base, t: 'pedido' }))).status === 401, 'un pedido firmado no sirve como token de acceso: 401')
  ok((await llamar(t1.access_token.slice(0, -3) + 'abc')).status === 401, 'firma cambiada: 401')
  const r401 = await llamar('basura')
  ok(r401.status === 401 && /error="invalid_token"/.test(r401.headers.get('www-authenticate') ?? ''), 'token malo: 401 con error="invalid_token"')

  console.log('Refrescar')
  const refId = (rf) => post('/oauth/token', { grant_type: 'refresh_token', client_id: cliente.client_id, refresh_token: rf })
  const r1 = await refId(t1.refresh_token)
  const t2 = await r1.json()
  ok(r1.status === 200 && !!t2.access_token && !!t2.refresh_token && t2.refresh_token !== t1.refresh_token, 'refrescar entrega acceso y un refresco nuevo (rota)')
  const viejo = await refId(t1.refresh_token)
  ok(viejo.status === 400 && (await viejo.json()).error === 'invalid_grant', 'el refresco viejo (reusado) falla')
  const familia = await refId(t2.refresh_token)
  ok(familia.status === 400, 'y por haberlo reusado se revocó toda la familia (el nuevo también falla)')
  const otroCliente = await post('/oauth/token', { grant_type: 'refresh_token', client_id: 'cli_que_no_existe', refresh_token: 'x' })
  ok(otroCliente.status === 401, 'refrescar con un client_id desconocido da 401')

  console.log('Conexiones y desconectar')
  const e = await autorizar(cliente.client_id)
  const codigo5 = new URL((await decidir(new URL(e.location, BASE).searchParams.get('pedido'))).cuerpo.redirigir).searchParams.get('code')
  const t3 = await (await post('/oauth/token', { grant_type: 'authorization_code', client_id: cliente.client_id, code: codigo5, redirect_uri: REDIRECCION, code_verifier: e.verifier })).json()
  const lc = await (await fetch(`${BASE}/api/oauth/conexiones`, { headers: { cookie: cookie() } })).json()
  ok(lc.length === 1 && lc[0].nombre === 'ChatGPT de prueba', 'aparece en las conexiones', lc)
  const desc = await fetch(`${BASE}/api/oauth/conexiones/${encodeURIComponent(lc[0].familia)}`, { method: 'DELETE', headers: { cookie: cookie() } })
  ok(desc.status === 200, 'desconectar anda')
  ok((await refId(t3.refresh_token)).status === 400, 'después de desconectar el refresco ya no sirve')
  const rev = await post('/oauth/revocar', { token: t3.refresh_token })
  ok(rev.status === 200, 'revocar contesta 200')

  console.log('Cuentas de Telar')
  const registro = await fetch(`${BASE}/api/cuentas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: 'ia@ejemplo.com', nombre: 'Ida', clave: 'la frase larga de ida', invitacion: 'pase-oauth' }),
  })
  const galletaTelar = (/tablero_sesion=([^;]*)/.exec(registro.headers.get('set-cookie') ?? '') ?? [])[1]
  ok(registro.status === 201 && !!galletaTelar, 'una cuenta de Telar se registra', await registro.text())
  const cTelar = `tablero_sesion=${galletaTelar}`
  await fetch(`${BASE}/api/proyectos`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cTelar, origin: BASE }, body: JSON.stringify({ nombre: 'De Ida', prefijo: 'IDA' }) })
  const f = await autorizar(cliente.client_id)
  const codigo6 = new URL((await decidir(new URL(f.location, BASE).searchParams.get('pedido'), true, cTelar)).cuerpo.redirigir).searchParams.get('code')
  const t4 = await (await post('/oauth/token', { grant_type: 'authorization_code', client_id: cliente.client_id, code: codigo6, redirect_uri: REDIRECCION, code_verifier: f.verifier })).json()
  const sub = JSON.parse(Buffer.from(t4.access_token.split('.')[1], 'base64url').toString()).sub
  ok(/^t:[a-z0-9]+$/.test(sub), 'el token de la cuenta de Telar lleva su cuenta («t:…») en sub', sub)
  const mcpIda = await conectado(t4.access_token)
  const deIda = (await mcpIda.callTool({ name: 'listar_proyectos', arguments: {} })).content.map((x) => x.text).join('')
  ok(deIda.includes('IDA') && !deIda.includes('RC'), 'por MCP, el token de la cuenta de Telar ve solo sus proyectos (no el RC del dueño)', deIda.slice(0, 200))
  await mcpIda.close()
  const conexionesIda = await (await fetch(`${BASE}/api/oauth/conexiones`, { headers: { cookie: cTelar } })).json()
  const conexionesDueno = await (await fetch(`${BASE}/api/oauth/conexiones`, { headers: { cookie: cookie() } })).json()
  ok(conexionesIda.length === 1 && !conexionesDueno.some((x) => x.familia === conexionesIda[0].familia), 'las conexiones son de cada cuenta')
  const g = await autorizar(cliente.client_id)
  const codigo7 = new URL((await decidir(new URL(g.location, BASE).searchParams.get('pedido'))).cuerpo.redirigir).searchParams.get('code')
  await post('/oauth/token', { grant_type: 'authorization_code', client_id: cliente.client_id, code: codigo7, redirect_uri: REDIRECCION, code_verifier: g.verifier })
  const famDueno = (await (await fetch(`${BASE}/api/oauth/conexiones`, { headers: { cookie: cookie() } })).json())[0]?.familia
  const ajena = await fetch(`${BASE}/api/oauth/conexiones/${encodeURIComponent(famDueno)}`, { method: 'DELETE', headers: { cookie: cTelar, origin: BASE } })
  ok(ajena.status === 404, 'una cuenta no puede desconectar la aplicación de otra (404)')
  ok((await llamar(jwtFalso({ ...base, sub: 't:noexiste' }))).status === 401, 'un token de una cuenta de Telar que no existe: 401')
} catch (e) {
  fallas++
  console.error('\nLa prueba se cortó:', e)
} finally {
  await apagar()
}

console.log(fallas ? `\n✗ ${fallas} cosas fallaron` : '\n✓ Todo bien')
process.exit(fallas ? 1 : 0)
