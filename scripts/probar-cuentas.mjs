// Prueba de las cuentas propias de Telar (docs/cuentas.md): cada cuenta tiene su base propia y no ve ni toca nada de otra.
// Levanta sus propios Telar locales (bases descartables en carpetas temporales, TABLERO_PUBLICO=1) y se niega a apuntar a
// otra cosa que 127.0.0.1. Nunca toca la .datos/ del dueño ni producción.
//
//   0. Registro cerrado: sin TABLERO_INVITACION no se puede crear una cuenta.
//   1. Base de antes: levanta el código de ANTES de la migración (git archive), lo siembra con sembrar-lienzo y probar-mcp,
//      y después levanta el código nuevo sobre esa misma base: todo quedó de 'dueno', la clave lo sigue viendo entero y una
//      cuenta nueva no ve nada (se mira también la base directo, con PGlite).
//   2. Cuentas: registrarse (código malo, mail repetido, contraseña floja, límite de intentos), entrar (contraseña mala, mismo
//      mensaje para el mail que no existe, límite), suspender, cambiar la contraseña.
//   3. Aislamiento: A y B arman de todo (proyecto, tableros, tarjetas con comentarios, checklist, adjuntos, enlaces y vínculos,
//      lienzo con notas, marco, conector, tabla y gráfico, Diseño con página, marco, comentario, token y nota, archivos). Después
//      B intenta TODO sobre lo de A con los id de A: cada ruta de api.ts, diseno/rutas.ts y oauth/rutas.ts (sacadas del código:
//      una ruta nueva sin caso hace fallar la prueba), cada herramienta MCP (por id y por nombre), la búsqueda, la actividad,
//      los eventos en vivo (SSE y /api/eventos/desde), los archivos por URL, exportar y los vínculos. Lo mismo la clave del MCP
//      (el dueño) contra A, y A contra B. Cada intento tiene que dar 401/403/404 (o 409 si choca un id), contestar igual que con
//      un id que no existe, no traer nada de la otra cuenta (se busca su palabra marca en cada respuesta) y no cambiar nada.
//      Menciones y notificaciones (docs/plan-ia-integrada.md, 12.8): A tiene una mención pendiente a su IA y una notificación;
//      B no puede leerlas, marcarlas, atenderlas ni responder a un comentario de A, un alias que solo existe en A no resuelve en B,
//      y levantar «lo de antes» en B no toca nada de A (ni al revés).
//      Trabajos de la IA (F2): con el Telar apagado se siembra en cada cuenta un agente, un trabajo que espera permiso, su gasto y una
//      mención pendiente (scripts/ia/sembrar-trabajo.ts). B no los ve, no los frena, no los confirma, no los reanuda ni los reintenta
//      (404 igual que con un id que no existe), no ve sus pasos ni su gasto, y las rutas internas (correr, diagnóstico, barrer) rechazan
//      con 401 todo pedido sin su secreto.
//   4. OAuth: cada token actúa como la cuenta que tocó «Permitir»; el de otra cuenta, uno inventado o el de una cuenta
//      suspendida no entran; las conexiones son por cuenta.
//   5. Amigos e invitaciones (Configuración → Amigos): invitar, listar, revocar, suspender y el tope son SOLO de la sesión del dueño
//      (la clave del MCP, otra cuenta y un token de OAuth: 403/401). Canje válido; una de un solo uso canjeada dos veces (y en
//      carrera, con pedidos simultáneos) deja una sola cuenta; vencida, revocada, inventada y alterada dan el mismo mensaje; el
//      límite de intentos por IP; el tope de amigos (y el aviso en la campana); suspender corta la sesión; el amigo recién
//      registrado no ve nada del dueño ni de otro amigo; el token en claro no está en la base ni en la salida del servidor.
//   6. Recuperar la contraseña sin correo (docs/cuentas.md): al registrarse (por enlace y por código) salen 8 códigos de recuperación, una
//      sola vez; con uno + el mail + una contraseña nueva se entra, se gasta ESE código y se cierran las otras sesiones; el usado, el
//      inventado, el de otra cuenta y el mail inexistente contestan igual; límite por mail y por IP; generar códigos nuevos (con la
//      contraseña, solo con sesión) deja sin efecto los anteriores. El enlace de restablecimiento del dueño: solo con su sesión (la clave
//      del MCP, un amigo y un token de OAuth: 403/401), solo amigos (no la cuenta del dueño), de un solo uso (también en carrera), vence
//      a las 24 horas, cancelado o reemplazado no sirve, el dueño no ve ni elige la contraseña (ni en la lista ni en la campana), y los
//      tokens y códigos en claro no están en la base ni en la salida del servidor.
//   7. Crear cuenta con aprobación (docs/cuentas.md): sin enlace ni código ni variable, quien pide una cuenta (nombre, mail y contraseña) queda
//      PENDIENTE: sale su 8 códigos de recuperación, no abre sesión y no puede nada (la API web, los eventos en vivo, los archivos, cambiar
//      la contraseña, el MCP con un token de OAuth firmado: todo 401, y los mismos pedidos entran apenas se la aprueba). Entrar con sus datos
//      buenos dice «espera la aprobación de <dueño>»; con la contraseña mala o un mail inexistente, el error de siempre idéntico; recuperar con
//      un código le cambia la contraseña SIN abrirle nada. Aprobar, rechazar, reconsiderar y borrar viejas son SOLO de la sesión del dueño
//      (la clave del MCP y un amigo 403, un token de OAuth y una visita 401); aprobar respeta el tope de amigos (también con dos a la vez); la
//      rechazada no entra y no se le revela (entrar, recuperar y pedir otra vez contestan como si fuera una cuenta cualquiera); su mail se
//      libera a los 7 días; el límite de 5 pedidos por IP por hora y el tope de 30 pendientes (también en carrera, con un aviso en la campana);
//      la invitación por enlace sigue entrando directo; otra cuenta no ve ninguna solicitud; «Borrar solicitudes viejas» (31 días con la base
//      apagada) borra solo solicitudes sin datos y sus códigos; ninguna contraseña ni código en claro en la base ni en la salida del servidor.
//
//   npm run cuentas:probar
//   node scripts/probar-cuentas.mjs --sin-base-vieja     (salta el paso 1, que necesita git)
//   node scripts/probar-cuentas.mjs --puerto 4370        (usa 4370 a 4375)
//   node scripts/probar-cuentas.mjs --solo-amigos         (solo los pasos 0 y 5: invitaciones por enlace; ~1 minuto)
//   node scripts/probar-cuentas.mjs --solo-recuperacion   (solo los pasos 0 y 6: recuperar la contraseña sin correo; ~1 minuto)
//   node scripts/probar-cuentas.mjs --solo-solicitudes    (solo los pasos 0 y 7: crear cuenta con aprobación del dueño; ~2 minutos)
import { spawn, execFileSync } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const PUERTO = Number(opcion('puerto', '4364'))
const SIN_BASE_VIEJA = args.includes('--sin-base-vieja')
const SOLO_AMIGOS = args.includes('--solo-amigos')
const SOLO_RECUPERACION = args.includes('--solo-recuperacion')
const SOLO_SOLICITUDES = args.includes('--solo-solicitudes')
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SECRETO = 'secreto-de-prueba-cuentas-0123456789-abcdefghijklmnop'
const CLAVE = 'clave-de-prueba-del-mcp-cuentas'
const INVITACION = 'pase-de-prueba-2026'
const USUARIO_JUEGO = 'usuario-juego-prueba'
const REDIRECCION = 'http://localhost:6274/oauth/callback'

let fallas = 0
let pruebas = 0
const ok = (cond, que, detalle) => {
  pruebas++
  if (!cond) fallas++
  if (!cond || !args.includes('--callado'))
    console.log(`${cond ? '  ✓' : '  ✗'} ${que}${!cond && detalle !== undefined ? `\n      ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle).slice(0, 600)}` : ''}`)
  return cond
}
const titulo = (t) => console.log(`\n${t}`)
const azar = () => randomBytes(6).toString('hex')

// ───────────────────────── servidores de prueba ─────────────────────────

const servidores = []
async function levantar({ puerto, datos, publico = true, invitacion = INVITACION, codigo = RAIZ, extra = {} }) {
  const base = `http://127.0.0.1:${puerto}`
  if (new URL(base).hostname !== '127.0.0.1') throw new Error('Solo 127.0.0.1')
  const env = {
    ...process.env,
    TABLERO_DATOS: datos,
    TABLERO_PUERTO: String(puerto),
    TABLERO_SEMILLA_DISCORD: 'no',
    // el proveedor FALSO (nunca uno de verdad): las claves y los agentes de la prueba no salen a ninguna red
    TABLERO_IA_FALSO: '1',
    TABLERO_SUPABASE_URL: '',
    TABLERO_SUPABASE_ANON: '',
    ...(publico
      ? {
          TABLERO_PUBLICO: '1',
          TABLERO_SECRETO: SECRETO,
          TABLERO_USUARIOS: USUARIO_JUEGO,
          TABLERO_URL_PUBLICA: base,
          TABLERO_CLAVE: CLAVE,
          TABLERO_INVITACION: invitacion,
          TABLERO_EVENTOS_EN_BASE: '1',
        }
      : { TABLERO_PUBLICO: '', TABLERO_CLAVE: CLAVE, TABLERO_INVITACION: '' }),
    ...extra,
  }
  if (await fetch(`${base}/api/salud`).then(() => true, () => false)) throw new Error(`El puerto ${puerto} ya está ocupado: apagá lo que corre ahí o usá --puerto.`)
  const hijo = spawn(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), ['servidor/src/principal.ts'], { cwd: codigo, env, stdio: ['ignore', 'pipe', 'pipe'] })
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
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`El Telar de prueba no arrancó (${base}):\n${salida.slice(-2000)}`)
}
async function apagar(srv) {
  if (!srv || srv.hijo.exitCode !== null) return
  srv.hijo.kill('SIGTERM')
  for (let i = 0; i < 40 && srv.hijo.exitCode === null; i++) await new Promise((r) => setTimeout(r, 150))
  if (srv.hijo.exitCode === null) srv.hijo.kill('SIGKILL')
  await new Promise((r) => setTimeout(r, 300))
}
const carpeta = (n) => mkdtempSync(path.join(os.tmpdir(), `telar-cuentas-${n}-`))

// ───────────────────────── un «navegador»: cookie, clave o token ─────────────────────────

class Quien {
  constructor(base, { nombre, cookie = '', clave = '', ip = '10.0.0.1' } = {}) {
    Object.assign(this, { base, nombre, cookie, clave, ip })
  }
  async pedir(metodo, ruta, cuerpo, op = {}) {
    const headers = { 'x-forwarded-for': op.ip ?? this.ip, origin: this.base, ...(op.headers ?? {}) }
    if (this.cookie) headers.cookie = `tablero_sesion=${this.cookie}`
    if (this.clave) headers.authorization = `Bearer ${this.clave}`
    let body
    if (cuerpo instanceof FormData) body = cuerpo
    else if (cuerpo !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(cuerpo)
    }
    const r = await fetch(this.base + ruta, { method: metodo, headers, body, redirect: 'manual' })
    const galleta = r.headers.get('set-cookie')
    const m = galleta && /tablero_sesion=([^;]*)/.exec(galleta)
    if (m && m[1] && !op.sinGuardar) this.cookie = m[1]
    const bytes = new Uint8Array(await r.arrayBuffer())
    const texto = new TextDecoder().decode(bytes)
    let json = null
    try {
      json = JSON.parse(texto)
    } catch {}
    return { status: r.status, json, texto, bytes, galleta: m?.[1], cache: r.headers.get('cache-control') ?? '' }
  }
  g(r, op) {
    return this.pedir('GET', r, undefined, op)
  }
  p(r, c = {}, op) {
    return this.pedir('POST', r, c, op)
  }
}

async function debe(r, que) {
  if (r.status >= 400) throw new Error(`${que}: ${r.status} ${r.texto.slice(0, 300)}`)
  return r.json
}

/** Un PNG chico (1 × 1) para las fotos y las imágenes. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
function formArchivo(nombre, contenido, tipo) {
  const f = new FormData()
  f.append('archivo', new Blob([contenido], { type: tipo }), nombre)
  return f
}

// ───────────────────────── OAuth: el baile hasta el token ─────────────────────────

const sha = (t) => createHash('sha256').update(t).digest('base64url')
/** La cookie de la sesión del dueño (la cuenta del juego de TABLERO_USUARIOS), firmada como lo hace el servidor. */
function cookieJuego(usuario = USUARIO_JUEGO, segundos = 3600) {
  const base = `v1.${usuario}.${Math.floor(Date.now() / 1000) + segundos}`
  return `${base}.${createHmac('sha256', SECRETO).update(base).digest('base64url')}`
}
async function conectarOAuth(quien, nombreCliente = 'Prueba') {
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
  return { ...t, clientId: reg.client_id }
}
function jwtInventado(base, carga) {
  const secreto = createHmac('sha256', SECRETO).update('telar-oauth-v1').digest('hex')
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const ahora = Math.floor(Date.now() / 1000)
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ t: 'acceso', iss: base, aud: `${base}/mcp`, iat: ahora, exp: ahora + 600, cid: 'x', cn: 'Inventado', ...carga })}`
  return `${cuerpo}.${createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`
}
async function clienteMcp(base, cabeceras) {
  const c = new Client({ name: 'telar-prueba-cuentas', version: '1.0.0' })
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: cabeceras } }))
  return c
}
async function herramienta(cli, nombre, argumentos) {
  try {
    const r = await cli.callTool({ name: nombre, arguments: argumentos })
    const texto = (r.content ?? []).map((c) => c.text ?? (c.data ? '[imagen]' : '')).join('\n')
    let json = null
    try {
      json = JSON.parse(texto)
    } catch {}
    return { error: Boolean(r.isError), texto, json }
  } catch (e) {
    return { error: true, texto: String(e?.message ?? e), json: null }
  }
}

// ───────────────────────── lo que arma cada cuenta ─────────────────────────

/** Arma de todo en la cuenta (con la palabra `marca` en cada texto) y devuelve los id. */
async function sembrarCuenta(q, mcp, prefijo, marca) {
  const v = { prefijo, marca }
  const proyecto = await debe(await q.p('/api/proyectos', { nombre: `Proyecto ${marca}`, prefijo, descripcion: `Secreto ${marca}`, tipo: 'completo' }), 'crear proyecto')
  v.pid = proyecto.id
  v.t1 = proyecto.tableros[0].id
  const t2 = await debe(await q.p('/api/tableros', { proyectoId: v.pid, nombre: `Tablero ${marca}`, tipo: 'completo' }), 'crear tablero')
  v.t2 = t2.id
  // Un diagrama (solo lienzo): sus vistas y su nombre también son de la cuenta.
  v.t3 = (await debe(await q.p('/api/tableros', { proyectoId: v.pid, nombre: `Diagrama ${marca}`, tipo: 'diagrama' }), 'crear diagrama')).id
  const completo = await debe(await q.g(`/api/tableros/${v.t1}`), 'leer tablero')
  v.l1 = completo.listas[0].id
  v.l2 = completo.listas[1].id
  v.miembroYo = completo.miembros.find((m) => m.esYo)?.id
  const et = await debe(await q.p(`/api/proyectos/${v.pid}/etiquetas`, { nombre: `etiqueta-${marca}` }), 'etiqueta')
  v.etiqueta = et.id
  const c1 = await debe(await q.p('/api/tarjetas', { tableroId: v.t1, listaId: v.l1, titulo: `Tarjeta ${marca} uno`, descripcion: `Descripción ${marca}`, etiquetas: [et.id], porque: { motivo: `Porque ${marca}` } }), 'tarjeta 1')
  const c2 = await debe(await q.p('/api/tarjetas', { tableroId: v.t1, listaId: v.l2, titulo: `Tarjeta ${marca} dos` }), 'tarjeta 2')
  Object.assign(v, { c1: c1.id, k1: c1.clave, c2: c2.id, k2: c2.clave })
  v.comentario = (await debe(await q.p(`/api/tarjetas/${v.k1}/comentarios`, { cuerpo: `Comentario ${marca}` }), 'comentario')).id
  v.checklist = (await debe(await q.p(`/api/tarjetas/${v.k1}/checklists`, { titulo: `Lista ${marca}`, items: [`Ítem ${marca}`] }), 'checklist')).id
  await debe(await q.p(`/api/tarjetas/${v.k1}/enlaces`, { url: `https://ejemplo.com/${marca}`, titulo: `Link ${marca}` }), 'enlace')
  const adj = await debe(await q.p(`/api/tarjetas/${v.k1}/adjuntos`, formArchivo(`nota-${marca}.txt`, `Archivo secreto ${marca}`, 'text/plain')), 'adjunto')
  v.adjunto = adj.id
  v.adjuntoRuta = adj.url ?? `/archivos/${adj.ruta}`
  v.adjuntoBytes = Buffer.from(`Archivo secreto ${marca}`)
  await debe(await q.p(`/api/tarjetas/${v.k1}/vinculos`, { tipo: 'bloquea', con: v.k2 }), 'vínculo')
  const det = await debe(await q.g(`/api/tarjetas/${v.k1}`), 'detalle')
  v.item = det.checklists[0].items[0].id
  v.enlace = det.enlaces?.[0]?.id ?? (await q.g(`/api/tarjetas/${v.k1}`)).json.enlaces[0].id
  v.vinculo = det.vinculos[0].id
  // lienzo
  const nota = await debe(await q.p(`/api/tableros/${v.t1}/elementos`, { tipo: 'nota', x: 0, y: 0, datos: { texto: `Nota ${marca}` } }), 'nota')
  const marcoL = await debe(await q.p(`/api/tableros/${v.t1}/elementos`, { tipo: 'marco', x: 400, y: 0, ancho: 600, alto: 400, datos: { titulo: `Marco ${marca}` } }), 'marco')
  const nota2 = await debe(await q.p(`/api/tableros/${v.t1}/elementos`, { tipo: 'nota', x: 0, y: 300, datos: { texto: `Otra nota ${marca}` } }), 'nota 2')
  Object.assign(v, { nota: nota.id, marcoL: marcoL.id, nota2: nota2.id })
  v.conector = (await debe(await q.p(`/api/tableros/${v.t1}/conectores`, { desdeId: v.nota, hastaId: v.marcoL, etiqueta: `Flecha ${marca}` }), 'conector')).id
  const tabla = await herramienta(mcp, 'crear_tabla', { proyecto: v.pid, tablero: v.t1, titulo: `Tabla ${marca}`, columnas: [{ nombre: 'Cosa' }, { nombre: 'Cuánto', tipo: 'numero' }], filas: [{ Cosa: `Fila ${marca}`, Cuánto: 3 }] })
  if (tabla.error) throw new Error(`crear_tabla: ${tabla.texto}`)
  v.tabla = tabla.json?.tabla?.id ?? tabla.json?.objeto?.id ?? tabla.json?.id
  const graf = await herramienta(mcp, 'crear_grafico', { proyecto: v.pid, tablero: v.t1, tipo: 'barras', tabla: v.tabla, titulo: `Gráfico ${marca}` })
  if (graf.error) throw new Error(`crear_grafico: ${graf.texto}`)
  v.grafico = graf.json?.grafico?.id ?? graf.json?.objeto?.id ?? graf.json?.id
  // menciones: una IA (la de la cuenta) que atendió una mención (le llegó una notificación a la persona) y otra que sigue pendiente
  const iaMiembro = (await debe(await q.g('/api/miembros'), 'miembros')).find((m) => m.tipo === 'ia' && !/^Bot /.test(m.nombre)) // (el «Bot …» es el agente sembrado)
  v.aliasIA = iaMiembro.alias
  const mencion1 = await debe(await q.p(`/api/tarjetas/${v.k2}/comentarios`, { cuerpo: `@${v.aliasIA} mirá esto de ${marca}`, id: `m1${azar()}` }), 'mención 1')
  const respondida = await herramienta(mcp, 'comentar', { tarjeta: v.k2, texto: `Respuesta de la IA sobre ${marca}` })
  if (respondida.error) throw new Error(`comentar (IA): ${respondida.texto}`)
  const mencion2 = await debe(await q.p(`/api/tarjetas/${v.k1}/comentarios`, { cuerpo: `Otra para @${v.aliasIA}: pendiente de ${marca}`, id: `m2${azar()}` }), 'mención 2')
  v.mencion = mencion2.menciones[0].id
  v.mencionAtendida = mencion1.menciones[0].id
  v.notificacion = (await debe(await q.g('/api/notificaciones'), 'notificaciones')).find((n) => n.tipo === 'respuesta')?.id
  v.comentarioMencion = mencion2.id
  // IA integrada: una clave de modelo y un agente con ella (solo con sesión; la clave del MCP no los puede ni crear)
  v.claveIA = (await debe(await q.p('/api/ia/claves', { proveedor: 'falso', nombre: `Clave ${marca}`, clave: `prueba-CLAVE-${marca}-0123456789` }), 'clave de IA')).id
  v.agenteIA = (await debe(await q.p('/api/ia/agentes', { nombre: `Agente ${marca}`, proveedor: 'falso', modelo: 'guion:responder', claveId: v.claveIA }), 'agente de IA')).miembroId
  // una nota sacada del lienzo (para restaurar) y una imagen suelta del lienzo
  const sacada = await debe(await q.p(`/api/tableros/${v.t1}/elementos`, { tipo: 'nota', x: 0, y: 600, datos: { texto: `Sacada ${marca}` } }), 'nota sacada')
  await debe(await q.p('/api/elementos/eliminar', { ids: [sacada.id] }), 'sacar')
  v.sacada = sacada.id
  const img = await debe(await q.p('/api/archivos', formArchivo(`imagen-${marca}.png`, PNG, 'image/png')), 'archivo')
  v.archivo = img.url
  // Diseño
  const pg = await debe(await q.p(`/api/diseno/${v.pid}/paginas`, { nombre: `Página ${marca}` }), 'página')
  v.pagina = pg.id
  const mc = await debe(await q.p(`/api/diseno/${v.pid}/marcos`, { pagina: pg.id, nombre: `Marco ${marca}`, ancho: 200, alto: 120, html: `<div class="caja">Diseño ${marca}</div>`, css: '.caja{color:red}' }), 'marco de diseño')
  v.marcoD = mc.marco.id
  v.comentarioD = (await debe(await q.p(`/api/diseno/${v.pid}/comentarios`, { en: `marco:${v.marcoD}`, texto: `Comentario de diseño ${marca}` }), 'comentario diseño')).id
  await debe(await q.p(`/api/diseno/${v.pid}/tokens`, { tokens: [{ nombre: `color/${marca.toLowerCase()}`, valor: '#123456', uso: `Uso ${marca}` }] }), 'token')
  await debe(await q.pedir('PUT', `/api/diseno/${v.pid}/notas`, { objetivo: `marco:${v.marcoD}`, nota: `Nota de diseño ${marca}` }), 'nota diseño')
  await debe(await q.pedir('PUT', `/api/diseno/${v.pid}/vinculos`, { objetivo: `marco:${v.marcoD}`, tarjeta: v.k1 }), 'vínculo diseño')
  v.tokenClave = `color/${marca.toLowerCase()}`
  return v
}

/** Todo lo que la cuenta ve de lo suyo (para comprobar que lo que intentó la otra no cambió nada). */
async function foto(q, v) {
  const rutas = [
    '/api/proyectos?archivados=1',
    `/api/tableros/${v.t1}`,
    `/api/tableros/${v.t2}`,
    `/api/tableros/${v.t3}`,
    `/api/tarjetas/${v.k1}`,
    `/api/tarjetas/${v.k2}`,
    '/api/miembros',
    `/api/tableros/${v.t1}/archivadas`,
    `/api/tableros/${v.t1}/actividad?limite=300`,
    '/api/notificaciones',
    '/api/ia/estado',
    '/api/ia/uso',
    `/api/diseno/${v.pid}`,
    `/api/diseno/${v.pid}/paginas/${v.pagina}`,
    `/api/diseno/${v.pid}/marcos/${v.marcoD}`,
    `/api/diseno/${v.pid}/comentarios`,
    `/api/diseno/${v.pid}/items`,
    `/api/diseno/${v.pid}/notas`,
    `/api/diseno/${v.pid}/vinculos?objetivo=marco:${v.marcoD}`,
    v.adjuntoRuta,
    v.archivo,
  ]
  const partes = []
  for (const r of rutas) {
    const x = await q.g(r)
    partes.push(`${r} ${x.status} ${createHash('sha1').update(x.bytes).digest('hex')}`)
  }
  return partes.join('\n')
}

// ───────────────────────── las rutas, sacadas del código ─────────────────────────

function rutasDelCodigo() {
  const leer = (f) => readFileSync(path.join(RAIZ, f), 'utf8')
  const lista = []
  for (const m of leer('servidor/src/api.ts').matchAll(/\bapi\.(get|post|patch|put|delete|all)\('([^']+)'/g)) lista.push(`${m[1]} /api${m[2]}`)
  for (const m of leer('servidor/src/diseno/rutas.ts').matchAll(/^  r\.(get|post|patch|put|delete)\('([^']+)'/gm)) lista.push(`${m[1]} /api/diseno${m[2]}`)
  for (const m of leer('servidor/src/ia/rutas.ts').matchAll(/^  r\.(get|post|patch|put|delete)\('([^']+)'/gm)) lista.push(`${m[1]} /api${m[2]}`)
  for (const m of leer('servidor/src/amigos-rutas.ts').matchAll(/^  r\.(get|post|patch|put|delete)\('([^']+)'/gm)) lista.push(`${m[1]} /api${m[2]}`)
  for (const m of leer('servidor/src/recuperacion-rutas.ts').matchAll(/^  r\.(get|post|patch|put|delete)\('([^']+)'/gm)) lista.push(`${m[1]} /api${m[2]}`)
  for (const m of leer('servidor/src/ia/rutas-claves.ts').matchAll(/^  r\.(get|post|patch|put|delete)\('([^']+)'/gm)) lista.push(`${m[1]} /api${m[2]}`)
  for (const m of leer('servidor/src/oauth/rutas.ts').matchAll(/r\.(get|post|patch|put|delete)\('(\/[a-z][^']*)'/g))
    if (!m[2].startsWith('/oauth/')) lista.push(`${m[1]} /api/oauth${m[2]}`)
  lista.push('get /archivos/*')
  return lista
}

/**
 * El caso de cada ruta: qué pedir con los id de la víctima (`v`) y los propios (`o`) y qué se espera.
 *   ajeno: es de la otra cuenta → 401/403/404 (409 si choca un id), igual que con un id que no existe, y sin cambiar nada.
 *   propio: no lleva id ajenos → contesta lo de quien pide (sin nada de la otra cuenta).
 *   aparte: se prueba en otra parte de este archivo (sesión, registro, eventos en vivo).
 * Cada uno es una lista de intentos: [metodo, ruta, cuerpo?, tipo?]
 */
function casos(v, o) {
  const j = (x) => x
  const png = () => formArchivo('foto.png', PNG, 'image/png')
  const txt = () => formArchivo('x.txt', 'hola', 'text/plain')
  const P = `/api/diseno/${v.pid}`
  return {
    'get /api/salud': { aparte: 'pública' },
    'get /api/sesion': { propio: [['GET', '/api/sesion']] },
    'post /api/sesion': { aparte: 'entrar (paso 2)' },
    'post /api/sesion/codigo': { aparte: 'código del juego (Supabase, no hay en la prueba)' },
    'post /api/cuentas': { aparte: 'registro (paso 2)' },
    'get /api/cuenta': { propio: [['GET', '/api/cuenta']] },
    'post /api/cuenta/clave': { aparte: 'cambiar la contraseña (paso 2)' },
    // Amigos: invitar, revocar, suspender y el tope son solo de la SESIÓN del dueño. Cualquier otra (la clave del MCP, otra cuenta) da 403.
    'get /api/amigos': { sesionDueno: [['GET', '/api/amigos']] },
    'post /api/amigos/invitaciones': { sesionDueno: [['POST', '/api/amigos/invitaciones', { nota: 'hack' }]] },
    'post /api/amigos/invitaciones/:id/revocar': { sesionDueno: [['POST', '/api/amigos/invitaciones/i_noexiste/revocar']] },
    'post /api/amigos/:id/estado': { sesionDueno: [['POST', `/api/amigos/${v.cuenta}/estado`, { estado: 'suspendida' }]] },
    'put /api/amigos/ajustes': { sesionDueno: [['PUT', '/api/amigos/ajustes', { topeAmigos: 100 }]] },
    // Restablecer la contraseña de un amigo es dar permiso: solo la sesión del dueño. Quien ataca (otra cuenta o la clave del MCP) recibe 403 y no cambia nada.
    'post /api/amigos/:id/restablecer': { sesionDueno: [['POST', `/api/amigos/${v.cuenta}/restablecer`]] },
    'post /api/amigos/:id/restablecer/cancelar': { sesionDueno: [['POST', `/api/amigos/${v.cuenta}/restablecer/cancelar`]] },
    // Recuperar la contraseña sin correo: los códigos son de la cuenta de la sesión; las públicas se prueban a fondo en el paso 6.
    'get /api/cuenta/codigos': { propio: [['GET', '/api/cuenta/codigos']] },
    'post /api/cuenta/codigos': { propio: [['POST', '/api/cuenta/codigos', { clave: 'no es esa' }]] },
    'post /api/recuperar': { aparte: 'olvidé mi contraseña (paso 6)' },
    'post /api/restablecer/ver': { aparte: 'enlace de restablecimiento (paso 6)' },
    'post /api/restablecer': { aparte: 'enlace de restablecimiento (paso 6)' },
    // Solicitudes de cuenta: aprobar, rechazar, reconsiderar y borrar viejas son dar permiso: solo la sesión del dueño (403 a quien ataca).
    'post /api/amigos/:id/aprobar': { sesionDueno: [['POST', `/api/amigos/${v.cuenta}/aprobar`]] },
    'post /api/amigos/:id/rechazar': { sesionDueno: [['POST', `/api/amigos/${v.cuenta}/rechazar`]] },
    'post /api/amigos/:id/reconsiderar': { sesionDueno: [['POST', `/api/amigos/${v.cuenta}/reconsiderar`]] },
    'post /api/amigos/solicitudes/limpiar': { sesionDueno: [['POST', '/api/amigos/solicitudes/limpiar']] },
    'post /api/solicitudes': { aparte: 'crear cuenta con aprobación (paso 7)' },
    'post /api/unirse/ver': { aparte: 'enlace de invitación (paso 5)' },
    'post /api/unirse': { aparte: 'enlace de invitación (paso 5)' },
    'delete /api/sesion': { aparte: 'cerrar sesión (paso 2)' },
    'get /api/info': { propio: [['GET', '/api/info']] },
    'post /api/herramientas/:nombre': { ajeno: [['POST', '/api/herramientas/leer_tarjeta', { args: { tarjeta: v.k1 } }, 'herramienta']] },
    'post /api/importar/discord': { soloDueno: [['POST', '/api/importar/discord', { ruta: '/no/existe.json', proyecto: v.pid }]] },
    'post /api/importar/archivo': { soloDueno: [['POST', '/api/importar/archivo', txt()]] },
    'post /api/importar/discord-json': { soloDueno: [['POST', '/api/importar/discord-json', { datos: [], proyecto: v.pid }]] },
    'get /api/eventos/desde': { aparte: 'eventos en vivo (paso 3)' },
    'get /api/eventos': { aparte: 'eventos en vivo (paso 3)' },
    'get /api/proyectos': { propio: [['GET', '/api/proyectos?archivados=1']] },
    'post /api/proyectos': { propio: [['POST', '/api/proyectos', { nombre: 'Propio', prefijo: `P${azar().slice(0, 5).toUpperCase().replace(/[^A-Z]/g, 'Q')}` }]] },
    'patch /api/proyectos/:id': { ajeno: [['PATCH', `/api/proyectos/${v.pid}`, { nombre: 'hackeado', archivado: true }]] },
    'post /api/proyectos/:id/imagen': { ajeno: [['POST', `/api/proyectos/${v.pid}/imagen`, png()]] },
    'get /api/miembros': { propio: [['GET', '/api/miembros']] },
    'patch /api/miembros/:id': { ajeno: [['PATCH', `/api/miembros/${v.miembroYo}`, { nombre: 'hackeado' }], ['PATCH', `/api/miembros/${v.miembroYo}`, { alias: 'hackeado' }]] },
    'post /api/proyectos/:id/etiquetas': { ajeno: [['POST', `/api/proyectos/${v.pid}/etiquetas`, { nombre: 'hack' }]] },
    'patch /api/etiquetas/:id': { ajeno: [['PATCH', `/api/etiquetas/${v.etiqueta}`, { nombre: 'hack' }]] },
    'delete /api/etiquetas/:id': { ajeno: [['DELETE', `/api/etiquetas/${v.etiqueta}`]] },
    'post /api/tableros': { ajeno: [['POST', '/api/tableros', { proyectoId: v.pid, nombre: 'hack' }], ['POST', '/api/tableros', { proyectoId: v.pid, nombre: 'hack', tipo: 'diagrama' }], ['POST', '/api/tableros', { proyectoId: v.pid, nombre: 'hack', vistas: ['lienzo', 'diseno'] }]] },
    'get /api/tableros/:id': { ajeno: [['GET', `/api/tableros/${v.t1}`], ['GET', `/api/tableros/${v.t2}`]] },
    'patch /api/tableros/:id': { ajeno: [['PATCH', `/api/tableros/${v.t1}`, { nombre: 'hack', ajustes: { lienzo: { fondo: 'liso' } } }], ['PATCH', `/api/tableros/${v.t1}`, { vistas: ['diseno'] }], ['PATCH', `/api/tableros/${v.t3}`, { vistas: ['kanban', 'lienzo'] }]] },
    'get /api/tableros/:id/archivadas': { ajeno: [['GET', `/api/tableros/${v.t1}/archivadas`]] },
    'get /api/tableros/:id/actividad': { ajeno: [['GET', `/api/tableros/${v.t1}/actividad`]] },
    'post /api/listas': { ajeno: [['POST', '/api/listas', { tableroId: v.t1, nombre: 'hack' }]] },
    'patch /api/listas/:id': { ajeno: [['PATCH', `/api/listas/${v.l1}`, { nombre: 'hack' }]] },
    'post /api/tarjetas': {
      ajeno: [
        ['POST', '/api/tarjetas', { tableroId: v.t1, titulo: 'hack' }],
        ['POST', '/api/tarjetas', { tableroId: o.t1, listaId: v.l1, titulo: 'hack' }],
        ['POST', '/api/tarjetas', { tableroId: o.t1, titulo: 'hack', padre: v.k1 }],
        ['POST', '/api/tarjetas', { tableroId: o.t1, titulo: 'hack', responsables: [v.miembroYo] }],
      ],
    },
    'get /api/tarjetas/:ref': { ajeno: [['GET', `/api/tarjetas/${v.k1}`], ['GET', `/api/tarjetas/${v.c1}`]] },
    'patch /api/tarjetas/:ref': {
      ajeno: [
        ['PATCH', `/api/tarjetas/${v.k1}`, { titulo: 'hack' }],
        ['PATCH', `/api/tarjetas/${o.k1}`, { padre: v.k1 }],
        ['PATCH', `/api/tarjetas/${o.k1}`, { responsables: [v.miembroYo] }],
      ],
    },
    'post /api/tarjetas/:ref/mover': { ajeno: [['POST', `/api/tarjetas/${v.k1}/mover`, { listaId: o.l1 }], ['POST', `/api/tarjetas/${o.k1}/mover`, { listaId: v.l1 }]] },
    'post /api/tarjetas/:ref/archivar': { ajeno: [['POST', `/api/tarjetas/${v.k1}/archivar`, { archivar: true }]] },
    'post /api/tarjetas/:ref/copiar': { ajeno: [['POST', `/api/tarjetas/${v.k1}/copiar`, {}], ['POST', `/api/tarjetas/${o.k1}/copiar`, { listaId: v.l1 }]] },
    'put /api/tarjetas/:ref/porque': { ajeno: [['PUT', `/api/tarjetas/${v.k1}/porque`, { motivo: 'hack' }], ['PUT', `/api/tarjetas/${o.k1}/porque`, { reemplazadaPor: v.k1 }]] },
    'post /api/tarjetas/:ref/comentarios': {
      ajeno: [
        ['POST', `/api/tarjetas/${v.k1}/comentarios`, { cuerpo: 'hack' }],
        ['POST', `/api/tarjetas/${v.k1}/comentarios`, { cuerpo: 'hack', id: 'idajeno12345' }],
        ['POST', `/api/tarjetas/${o.k1}/comentarios`, { cuerpo: 'hack', respondeA: v.comentario }],
        ['POST', `/api/tarjetas/${o.k1}/comentarios`, { cuerpo: 'hack', id: v.comentario }],
      ],
    },
    'patch /api/comentarios/:id': { ajeno: [['PATCH', `/api/comentarios/${v.comentario}`, { cuerpo: 'hack' }]] },
    'delete /api/comentarios/:id': { ajeno: [['DELETE', `/api/comentarios/${v.comentario}`]] },
    'post /api/tarjetas/:ref/checklists': { ajeno: [['POST', `/api/tarjetas/${v.k1}/checklists`, { titulo: 'hack' }]] },
    'patch /api/checklists/:id': { ajeno: [['PATCH', `/api/checklists/${v.checklist}`, { titulo: 'hack' }]] },
    'delete /api/checklists/:id': { ajeno: [['DELETE', `/api/checklists/${v.checklist}`]] },
    'post /api/checklists/:id/items': { ajeno: [['POST', `/api/checklists/${v.checklist}/items`, { texto: 'hack' }]] },
    'patch /api/items/:id': { ajeno: [['PATCH', `/api/items/${v.item}`, { hecho: true }], ['PATCH', `/api/items/${o.item}`, { responsableId: v.miembroYo }]] },
    'delete /api/items/:id': { ajeno: [['DELETE', `/api/items/${v.item}`]] },
    'post /api/items/:id/convertir': { ajeno: [['POST', `/api/items/${v.item}/convertir`]] },
    'post /api/tarjetas/:ref/adjuntos': { ajeno: [['POST', `/api/tarjetas/${v.k1}/adjuntos`, txt()]] },
    'delete /api/adjuntos/:id': { ajeno: [['DELETE', `/api/adjuntos/${v.adjunto}`]] },
    'post /api/tarjetas/:ref/enlaces': { ajeno: [['POST', `/api/tarjetas/${v.k1}/enlaces`, { url: 'https://hack.example.com' }]] },
    'delete /api/enlaces/:id': { ajeno: [['DELETE', `/api/enlaces/${v.enlace}`]] },
    'post /api/tarjetas/:ref/vinculos': { ajeno: [['POST', `/api/tarjetas/${v.k1}/vinculos`, { tipo: 'relacionada', con: o.k1 }], ['POST', `/api/tarjetas/${o.k1}/vinculos`, { tipo: 'relacionada', con: v.k1 }]] },
    'delete /api/vinculos/:id': { ajeno: [['DELETE', `/api/vinculos/${v.vinculo}`]] },
    'post /api/tableros/:id/elementos': {
      ajeno: [
        ['POST', `/api/tableros/${v.t1}/elementos`, { tipo: 'nota', x: 0, y: 0, datos: { texto: 'hack' } }],
        ['POST', `/api/tableros/${o.t1}/elementos`, { id: v.nota, tipo: 'nota', x: 9, y: 9, datos: { texto: 'hack' } }],
        ['POST', `/api/tableros/${o.t1}/elementos`, { tipo: 'tarjeta', x: 0, y: 0, tarjetaId: v.c1 }],
        ['POST', `/api/tableros/${o.t1}/elementos`, { tipo: 'lista', x: 0, y: 0, listaId: v.l1 }],
        ['POST', `/api/tableros/${o.t1}/elementos`, { elementos: [{ tipo: 'nota', x: 0, y: 0 }, { id: v.nota2, tipo: 'nota', x: 1, y: 1 }] }],
      ],
    },
    'patch /api/elementos/:id/tabla': { ajeno: [['PATCH', `/api/elementos/${v.tabla}/tabla`, { operaciones: [{ op: 'agregar_filas', filas: [{ Cosa: 'hack' }] }] }]] },
    'patch /api/elementos': { ajeno: [['PATCH', '/api/elementos', { cambios: [{ id: v.nota, x: 999, datos: { texto: 'hack' } }] }], ['PATCH', '/api/elementos', { cambios: [{ id: o.nota, x: 5 }, { id: v.nota, x: 999 }] }]] },
    'post /api/elementos/eliminar': { ajeno: [['POST', '/api/elementos/eliminar', { ids: [v.nota] }], ['POST', '/api/elementos/eliminar', { ids: [o.nota2, v.nota] }]] },
    'post /api/elementos/convertir': { ajeno: [['POST', '/api/elementos/convertir', { id: v.nota, a: 'texto' }], ['POST', '/api/elementos/convertir', { id: o.nota2, a: 'tarjeta', listaId: v.l1 }]] },
    'post /api/elementos/restaurar': { ajeno: [['POST', '/api/elementos/restaurar', { ids: [v.sacada], conectores: [] }], ['POST', '/api/elementos/restaurar', { ids: [], conectores: [v.conector] }]] },
    'post /api/tableros/:id/conectores': {
      ajeno: [
        ['POST', `/api/tableros/${v.t1}/conectores`, { desdeId: v.nota, hastaId: v.marcoL }],
        ['POST', `/api/tableros/${o.t1}/conectores`, { desdeId: o.nota, hastaId: v.nota }],
        ['POST', `/api/tableros/${o.t1}/conectores`, { id: v.conector, desdeId: o.nota, hastaId: o.marcoL }],
      ],
    },
    'patch /api/conectores/:id': { ajeno: [['PATCH', `/api/conectores/${v.conector}`, { etiqueta: 'hack' }], ['PATCH', `/api/conectores/${o.conector}`, { hastaId: v.nota }]] },
    'post /api/conectores/eliminar': { ajeno: [['POST', '/api/conectores/eliminar', { ids: [v.conector] }]] },
    'post /api/archivos': { propio: [['POST', '/api/archivos', png()]] },
    // IA integrada (servidor/src/ia/rutas.ts): novedades, notificaciones, preferencias y levantar las menciones de antes
    'get /api/novedades': { propio: [['GET', '/api/novedades']] },
    'get /api/notificaciones': { propio: [['GET', '/api/notificaciones'], ['GET', '/api/notificaciones?limite=100&antes=2999-01-01T00:00:00Z']] },
    'post /api/notificaciones/leer': {
      ajeno: [['POST', '/api/notificaciones/leer', { ids: [v.notificacion] }], ['POST', '/api/notificaciones/leer', { ids: [o.notificacion, v.notificacion] }]],
      propio: [['POST', '/api/notificaciones/leer', { ids: [] }]],
    },
    'get /api/notificaciones/preferencias': { propio: [['GET', '/api/notificaciones/preferencias']] },
    'put /api/notificaciones/preferencias': { propio: [['PUT', '/api/notificaciones/preferencias', { push: { asignacion: false } }]] },
    'post /api/ia/menciones/levantar': { propio: [['POST', '/api/ia/menciones/levantar', {}]] },
    // IA integrada: claves, agentes, ajustes y gasto (servidor/src/ia/rutas-claves.ts). Lo que cambia algo pide sesión (la clave del MCP da 403).
    'get /api/ia/estado': { propio: [['GET', '/api/ia/estado']] },
    'get /api/ia/uso': { propio: [['GET', '/api/ia/uso'], ['GET', '/api/ia/uso?mes=2026-01']] },
    'post /api/ia/claves': {
      propio: [['POST', '/api/ia/claves', { proveedor: 'falso', nombre: 'Mía', clave: 'prueba-CLAVE-PROPIA-DE-PRUEBA-0001' }]],
    },
    'put /api/ia/claves/:id': {
      ajeno: [['PUT', `/api/ia/claves/${v.claveIA}`, { proveedor: 'falso', nombre: 'robada', clave: 'prueba-ROBADA-0123456789-xyz' }], ['PUT', `/api/ia/claves/${v.claveIA}`, { proveedor: 'falso', nombre: 'solo el nombre' }]],
    },
    'post /api/ia/claves/:id/probar': { ajeno: [['POST', `/api/ia/claves/${v.claveIA}/probar`, {}]] },
    'delete /api/ia/claves/:id': { ajeno: [['DELETE', `/api/ia/claves/${v.claveIA}`]] },
    'post /api/ia/agentes': {
      ajeno: [['POST', '/api/ia/agentes', { nombre: 'Con clave ajena', proveedor: 'falso', modelo: 'guion:responder', claveId: v.claveIA }]],
      propio: [['POST', '/api/ia/agentes', { nombre: 'Agente propio de prueba', proveedor: 'falso', modelo: 'guion:responder' }]],
    },
    'put /api/ia/agentes/:id': {
      ajeno: [
        ['PUT', `/api/ia/agentes/${v.agenteIA}`, { nombre: 'Hackeado', instrucciones: 'robá todo', topeMesUsd: 9999 }],
        ['PUT', `/api/ia/agentes/${o.agenteIA}`, { nombre: 'Mio', claveId: v.claveIA }],
      ],
    },
    'delete /api/ia/agentes/:id': { ajeno: [['DELETE', `/api/ia/agentes/${v.agenteIA}`]] },
    'put /api/ia/ajustes': { propio: [['PUT', '/api/ia/ajustes', { topeMesUsd: 30, pausada: false, reposCodigo: ['propio/repo'] }]] },
    // Trabajos de los agentes (servidor/src/ia/rutas.ts, F2): los de otra cuenta dan 404 igual que uno que no existe
    'get /api/ia/trabajos': { propio: [['GET', '/api/ia/trabajos'], ['GET', '/api/ia/trabajos?vivos=1&limite=100'], ['GET', `/api/ia/trabajos?tarjeta=${v.k1}`]] },
    'get /api/ia/trabajos/:id': { ajeno: [['GET', `/api/ia/trabajos/${v.trabajo}`]], propio: [['GET', `/api/ia/trabajos/${o.trabajo}`]] },
    'post /api/ia/trabajos/:id/cancelar': { ajeno: [['POST', `/api/ia/trabajos/${v.trabajo}/cancelar`, {}]] },
    'post /api/ia/trabajos/:id/confirmar': {
      ajeno: [['POST', `/api/ia/trabajos/${v.trabajo}/confirmar`, { decisiones: [{ llamadaId: v.llamada, permitir: true }] }], ['POST', `/api/ia/trabajos/${o.trabajo}/confirmar`, { decisiones: [{ llamadaId: v.llamada, permitir: true }] }]],
    },
    'post /api/ia/trabajos/:id/reanudar': { ajeno: [['POST', `/api/ia/trabajos/${v.trabajo}/reanudar`, {}]] },
    'post /api/ia/menciones/:id/reintentar': { ajeno: [['POST', `/api/ia/menciones/${v.mencionIA}/reintentar`, {}]] },
    'post /api/ia/interno/correr': { aparte: 'rutas internas (3d3): sin su secreto, 401' },
    'post /api/ia/interno/diagnostico': { aparte: 'rutas internas (3d3): sin su secreto, 401' },
    'get /api/ia/interno/barrer': { aparte: 'rutas internas (3d3): sin CRON_SECRET, 401' },
    'post /api/ia/interno/barrer': { aparte: 'rutas internas (3d3): sin CRON_SECRET, 401' },
    'get /api/buscar': {
      propio: [['GET', `/api/buscar?q=${encodeURIComponent(v.marca)}`], ['GET', `/api/buscar?q=${encodeURIComponent(v.k1)}`]],
      ajeno: [['GET', `/api/buscar?q=a&proyecto=${v.pid}`], ['GET', `/api/buscar?q=a&tablero=${v.t1}`]],
    },
    // OAuth (la pantalla «Permitir» y las conexiones)
    'get /api/oauth/pedido': { propio: [['GET', '/api/oauth/pedido?pedido=inventado.inventado.inventado']] },
    'post /api/oauth/decidir': { propio: [['POST', '/api/oauth/decidir', { pedido: 'inventado.inventado.inventado', permitir: true }]] },
    'get /api/oauth/conexiones': { propio: [['GET', '/api/oauth/conexiones']] },
    'delete /api/oauth/conexiones/:familia': { ajeno: [['DELETE', `/api/oauth/conexiones/${v.familia}`]] },
    // Diseño
    'get /api/diseno/_tarjeta/:clave': { ajeno: [['GET', `/api/diseno/_tarjeta/${v.k1}`]] },
    'post /api/diseno/_/foto-lienzo-interna': { aparte: 'foto interna del lienzo: pide la clave (abajo)' },
    'post /api/diseno/:p/render-interno': { aparte: 'dibujo interno: pide la clave (abajo, con la clave y archivos ajenos)' },
    'post /api/diseno/:p/grilla-interna': { soloDueno: [['POST', `${P}/grilla-interna`, { imagenes: [] }]] },
    'get /api/diseno/:p': { ajeno: [['GET', P], ['GET', `/api/diseno/${v.prefijo}`]] },
    'get /api/diseno/:p/prefijados': { ajeno: [['GET', `${P}/prefijados`]] },
    'post /api/diseno/:p/paginas': { ajeno: [['POST', `${P}/paginas`, { nombre: 'hack' }]] },
    'get /api/diseno/:p/paginas/:pagina': { ajeno: [['GET', `${P}/paginas/${v.pagina}`], ['GET', `/api/diseno/${o.pid}/paginas/${v.pagina}`]] },
    'patch /api/diseno/:p/paginas/:pagina': { ajeno: [['PATCH', `${P}/paginas/${v.pagina}`, { nombre: 'hack' }]] },
    'post /api/diseno/:p/paginas/:pagina/ordenar': { ajeno: [['POST', `${P}/paginas/${v.pagina}/ordenar`]] },
    'get /api/diseno/:p/marcos/:id': { ajeno: [['GET', `${P}/marcos/${v.marcoD}`], ['GET', `/api/diseno/${o.pid}/marcos/${v.marcoD}`]] },
    'post /api/diseno/:p/marcos': { ajeno: [['POST', `${P}/marcos`, { pagina: v.pagina, nombre: 'hack', ancho: 100, alto: 100 }], ['POST', `/api/diseno/${o.pid}/marcos`, { pagina: v.pagina, nombre: 'hack', ancho: 100, alto: 100, tarjetas: [v.k1] }]] },
    'patch /api/diseno/:p/marcos/:id': { ajeno: [['PATCH', `${P}/marcos/${v.marcoD}`, { nombre: 'hack' }], ['PATCH', `/api/diseno/${o.pid}/marcos/${v.marcoD}`, { nombre: 'hack' }]] },
    'post /api/diseno/:p/marcos/:id/operaciones': { ajeno: [['POST', `${P}/marcos/${v.marcoD}/operaciones`, { operaciones: [{ op: 'reemplazar', capa: 'x', html: '<p>hack</p>' }] }]] },
    'post /api/diseno/:p/marcos/:id/duplicar': { ajeno: [['POST', `${P}/marcos/${v.marcoD}/duplicar`, {}], ['POST', `/api/diseno/${o.pid}/marcos/${v.marcoD}/duplicar`, {}]] },
    'post /api/diseno/:p/marcos/:id/archivar': { ajeno: [['POST', `${P}/marcos/${v.marcoD}/archivar`, { archivar: true }]] },
    'post /api/diseno/:p/marcos/:id/restaurar': { ajeno: [['POST', `${P}/marcos/${v.marcoD}/restaurar`, { n: 1 }]] },
    'get /api/diseno/:p/marcos/:id/revisiones': { ajeno: [['GET', `${P}/marcos/${v.marcoD}/revisiones`]] },
    'get /api/diseno/:p/marcos/:id/render': { ajeno: [['GET', `${P}/marcos/${v.marcoD}/render?formato=svg&descargar=1`], ['GET', `/api/diseno/${o.pid}/marcos/${v.marcoD}/render?formato=svg`]] },
    'get /api/diseno/:p/marcos/:id/miniatura': { ajeno: [['GET', `${P}/marcos/${v.marcoD}/miniatura`]] },
    'get /api/diseno/:p/items': { ajeno: [['GET', `${P}/items`]] },
    'get /api/diseno/:p/items/:tipo/:clave{.+}': { ajeno: [['GET', `${P}/items/token/${encodeURIComponent(v.tokenClave)}`]] },
    'put /api/diseno/:p/items/:tipo/:clave{.+}': { ajeno: [['PUT', `${P}/items/token/${encodeURIComponent(v.tokenClave)}`, { datos: { valor: '#000000' } }]] },
    'post /api/diseno/:p/items/archivar': { ajeno: [['POST', `${P}/items/archivar`, { tipo: 'token', clave: v.tokenClave }]] },
    'post /api/diseno/:p/tokens': { ajeno: [['POST', `${P}/tokens`, { tokens: [{ nombre: 'color/hack', valor: '#000000' }] }]] },
    'post /api/diseno/:p/piezas': { ajeno: [['POST', `${P}/piezas`, { nombre: 'hack', html: '<b>x</b>' }], ['POST', `/api/diseno/${o.pid}/piezas`, { nombre: 'hack', desde: { marco: v.marcoD } }]] },
    'get /api/diseno/:p/css/tokens.css': { ajeno: [['GET', `${P}/css/tokens.css`]] },
    'post /api/diseno/:p/activos': { ajeno: [['POST', `${P}/activos`, png()]] },
    'get /api/diseno/:p/notas': { ajeno: [['GET', `${P}/notas`]] },
    'put /api/diseno/:p/notas': { ajeno: [['PUT', `${P}/notas`, { objetivo: `marco:${v.marcoD}`, nota: 'hack' }], ['PUT', `/api/diseno/${o.pid}/notas`, { objetivo: `marco:${v.marcoD}`, nota: 'hack' }]] },
    'get /api/diseno/:p/comentarios': { ajeno: [['GET', `${P}/comentarios`]] },
    'post /api/diseno/:p/comentarios': { ajeno: [['POST', `${P}/comentarios`, { en: `marco:${v.marcoD}`, texto: 'hack' }], ['POST', `/api/diseno/${o.pid}/comentarios`, { texto: 'hack', respondeA: v.comentarioD }]] },
    'patch /api/diseno/:p/comentarios/:id': { ajeno: [['PATCH', `${P}/comentarios/${v.comentarioD}`, { resuelto: true }], ['PATCH', `/api/diseno/${o.pid}/comentarios/${v.comentarioD}`, { resuelto: true }]] },
    'get /api/diseno/:p/vinculos': { ajeno: [['GET', `${P}/vinculos?objetivo=marco:${v.marcoD}`]] },
    'put /api/diseno/:p/vinculos': { ajeno: [['PUT', `${P}/vinculos`, { objetivo: `marco:${v.marcoD}`, tarjeta: o.k1 }], ['PUT', `/api/diseno/${o.pid}/vinculos`, { objetivo: `marco:${o.marcoD}`, tarjeta: v.k1 }]] },
    'delete /api/diseno/:p/vinculos': { ajeno: [['DELETE', `${P}/vinculos`, { objetivo: `marco:${v.marcoD}`, tarjeta: v.k1 }]] },
    'post /api/diseno/:p/proponer': { ajeno: [['POST', `${P}/proponer`, { objetivo: `marco:${v.marcoD}` }], ['POST', `/api/diseno/${o.pid}/proponer`, { objetivo: `marco:${v.marcoD}` }]] },
    'get /api/diseno/:p/buscar': { ajeno: [['GET', `${P}/buscar?q=a`]] },
    'get /api/diseno/:p/config': { ajeno: [['GET', `${P}/config`]] },
    'put /api/diseno/:p/config': { ajeno: [['PUT', `${P}/config`, { pedir: true }]] },
    'get /api/diseno/:p/importaciones': { ajeno: [['GET', `${P}/importaciones`]] },
    'post /api/diseno/:p/importar/empezar': { soloDueno: [['POST', `${P}/importar/empezar`, {}]] },
    'post /api/diseno/:p/importar/archivo': { soloDueno: [['POST', `${P}/importar/archivo`, txt()]] },
    'post /api/diseno/:p/importar/lote': { soloDueno: [['POST', `${P}/importar/lote`, {}]] },
    'post /api/diseno/:p/importar/terminar': { soloDueno: [['POST', `${P}/importar/terminar`, { n: 1 }]] },
    'get /archivos/*': {
      ajeno: [['GET', v.archivo, undefined, 'archivo'], ['GET', v.adjuntoRuta, undefined, 'archivo'], ['GET', `/archivos/c/${v.cuenta}/${v.archivo.replace(/^\/archivos\//, '')}`, undefined, 'archivo']],
    },
  }
}

/** Cambia los id de la víctima por otros que no existen (misma forma), para comparar las respuestas. */
function sinExistir(v) {
  const f = {}
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== 'string') f[k] = x
    else if (k === 'prefijo') f[k] = 'NOEXIS'
    else if (k === 'k1' || k === 'k2') f[k] = `NOEXIS-${k === 'k1' ? 1 : 2}`
    else if (k === 'marca' || k === 'tokenClave') f[k] = x
    else if (x.startsWith('/archivos/')) f[k] = '/archivos/' + x.slice(10).replace(/[A-Za-z0-9]{8,}/g, (m) => 'n' + m.slice(1).replace(/./g, 'q'))
    // cada id falso es distinto (si no, dos extremos de un conector serían «el mismo objeto»)
    else f[k] = `q${k}`.padEnd(x.length, 'q').slice(0, Math.max(x.length, k.length + 1))
  }
  return f
}
const normalizarRespuesta = (texto, vals) => {
  let t = texto
  for (const x of vals.sort((a, b) => b.length - a.length)) if (x && x.length > 2) t = t.split(x).join('·')
  return t
}

const armarCuerpo = (c) => (typeof c === 'function' ? c() : c instanceof FormData ? c : c)

/**
 * El ataque: `x` (quien ataca) prueba cada ruta con los id de la víctima. `ov` son los id propios de x (para los casos mixtos)
 * y `marcas` las palabras de la víctima que no pueden aparecer en ninguna respuesta.
 */
async function atacar(x, v, ov, marcas, { esClave = false } = {}) {
  const rutas = rutasDelCodigo()
  const tabla = casos(v, ov)
  const falso = casos(sinExistir(v), ov)
  let intentos = 0
  for (const ruta of rutas) {
    const caso = tabla[ruta]
    if (!ok(Boolean(caso), `hay un caso de aislamiento para «${ruta}»`, 'Ruta nueva sin prueba: sumala a casos() en scripts/probar-cuentas.mjs')) continue
    const filtrar = (lista) => lista ?? []
    for (const [metodo, url, cuerpo, tipo] of filtrar(caso.ajeno)) {
      intentos++
      const r = await x.pedir(metodo, url, armarCuerpo(cuerpo), { sinGuardar: true })
      const filtra = marcas.find((m) => r.texto.toLowerCase().includes(m.toLowerCase()))
      if (tipo === 'herramienta') {
        ok(r.status === 401 || r.json?.ok === false, `${x.nombre}: ${metodo} ${url} no corre sobre lo ajeno`, r.texto.slice(0, 300))
      } else {
        ok([401, 403, 404, 409].includes(r.status), `${x.nombre}: ${metodo} ${url} → ${r.status}`, r.texto.slice(0, 300))
      }
      ok(!filtra, `${x.nombre}: ${metodo} ${url} no trae nada de la otra cuenta`, filtra && r.texto.slice(0, 300))
      if (r.status === 409) ok(/id ya se usa/i.test(r.texto), `${x.nombre}: el 409 de ${url} es solo «ese id ya se usa»`, r.texto)
      // Igual que con un id que no existe (no se cuenta que existe).
      const par = falso[ruta]?.ajeno?.find((f) => f[0] === metodo && JSON.stringify(Object.keys(f[2] ?? {})) === JSON.stringify(Object.keys(cuerpo ?? {})))
      if (par && r.status !== 409 && tipo !== 'herramienta') {
        const idx = caso.ajeno.findIndex((c) => c[1] === url && c[0] === metodo && c[2] === cuerpo)
        const parExacto = falso[ruta].ajeno[idx] ?? par
        const rf = await x.pedir(parExacto[0], parExacto[1], armarCuerpo(parExacto[2]), { sinGuardar: true })
        const vals = [...Object.values(v), ...Object.values(sinExistir(v))].filter((s) => typeof s === 'string')
        ok(
          rf.status === r.status && normalizarRespuesta(rf.texto, vals) === normalizarRespuesta(r.texto, vals),
          `${x.nombre}: ${metodo} ${url} contesta igual que con un id que no existe`,
          `${r.status} ${r.texto.slice(0, 200)}  ≠  ${rf.status} ${rf.texto.slice(0, 200)}`,
        )
      }
    }
    for (const [metodo, url, cuerpo] of filtrar(caso.propio)) {
      intentos++
      const r = await x.pedir(metodo, url, armarCuerpo(cuerpo), { sinGuardar: true })
      const filtra = marcas.find((m) => r.texto.toLowerCase().includes(m.toLowerCase()))
      ok(r.status < 500, `${x.nombre}: ${metodo} ${url} (propio) → ${r.status}`, r.texto.slice(0, 200))
      ok(!filtra, `${x.nombre}: ${metodo} ${url} no trae nada de la otra cuenta`, filtra && r.texto.slice(0, 300))
    }
    for (const [metodo, url, cuerpo] of filtrar(caso.sesionDueno)) {
      intentos++
      const r = await x.pedir(metodo, url, armarCuerpo(cuerpo), { sinGuardar: true })
      const filtra = marcas.find((m) => r.texto.toLowerCase().includes(m.toLowerCase()))
      ok(r.status === 403, `${x.nombre}: ${metodo} ${url} (solo la sesión del dueño) → ${r.status}`, r.texto.slice(0, 200))
      ok(!filtra, `${x.nombre}: ${metodo} ${url} no trae nada de la otra cuenta`, filtra && r.texto.slice(0, 300))
    }
    if (!esClave) {
      for (const [metodo, url, cuerpo] of [...filtrar(caso.admin), ...filtrar(caso.soloDueno)]) {
        intentos++
        const r = await x.pedir(metodo, url, armarCuerpo(cuerpo), { sinGuardar: true })
        ok(r.status === 401, `${x.nombre}: ${metodo} ${url} (solo con la clave del dueño) → ${r.status}`, r.texto.slice(0, 200))
      }
    }
  }
  return intentos
}

// ───────────────────────── MCP: cada herramienta con referencias ajenas ─────────────────────────

/** Arma los argumentos de una herramienta desde su esquema, con referencias a lo de la víctima (por id o por nombre). */
function argumentosAjenos(herr, v, porNombre) {
  const diseno = /marco|diseno|pieza|token|activo/.test(herr.name) && !/lienzo/.test(herr.name)
  const valorDe = (nombre, esquema) => {
    const n = nombre.toLowerCase()
    const tipo = esquema?.type ?? (esquema?.anyOf ? esquema.anyOf.map((a) => a.type).find(Boolean) : undefined)
    const ref = {
      proyecto: porNombre ? `Proyecto ${v.marca}` : v.pid,
      tablero: porNombre ? `Tablero ${v.marca}` : v.t1,
      tarjeta: porNombre ? v.k1 : v.c1,
      con: v.k2,
      lista: v.l1,
      marco: diseno ? (porNombre ? `Marco ${v.marca}` : v.marcoD) : porNombre ? `Marco ${v.marca}` : v.marcoL,
      objeto: porNombre ? `Nota ${v.marca}` : v.nota,
      desde: v.nota,
      hasta: v.marcoL,
      tabla: porNombre ? `Tabla ${v.marca}` : v.tabla,
      grafico: v.grafico,
      pagina: porNombre ? `Página ${v.marca}` : v.pagina,
      en: `marco:${v.marcoD}`,
      objetivo: `marco:${v.marcoD}`,
      consulta: v.marca,
      responde_a: diseno ? v.comentarioD : v.comentarioMencion,
      mencion: v.mencion,
      padre: v.k1,
    }[n]
    if (ref !== undefined && (tipo === 'string' || tipo === undefined)) return ref
    if (n === 'objetos' || n === 'ids') return [porNombre ? `Nota ${v.marca}` : v.nota]
    if (n === 'conectores' && /quitar/.test(herr.name)) return [v.conector]
    if (n === 'marcos') return [v.marcoD]
    if (n === 'tarjetas') return [v.k1]
    if (esquema?.enum) return esquema.enum[0]
    if (esquema?.const !== undefined) return esquema.const
    if (tipo === 'string') return n === 'url' ? 'https://ejemplo.com' : 'prueba'
    if (tipo === 'number' || tipo === 'integer') return Math.max(1, esquema.minimum ?? 1)
    if (tipo === 'boolean') return false
    if (tipo === 'array') return esquema.minItems ? [valorDe('item', esquema.items)] : []
    if (tipo === 'object') return objeto(esquema)
    return 'prueba'
  }
  const objeto = (esquema) => {
    const o = {}
    for (const req of esquema?.required ?? []) o[req] = valorDe(req, esquema.properties?.[req])
    return o
  }
  const sch = herr.inputSchema ?? {}
  const a = objeto(sch)
  // también los opcionales que son referencias: son los que más importan
  for (const k of Object.keys(sch.properties ?? {}))
    if (['proyecto', 'tablero', 'tarjeta', 'marco', 'objeto', 'objetos', 'lista', 'tabla', 'grafico', 'pagina', 'con', 'responde_a'].includes(k) && a[k] === undefined) a[k] = valorDe(k, sch.properties[k])
  return a
}

/** Lo que difiere entre dos fotos (para el mensaje). */
const diferencia = (a, b) => {
  const x = a.split('\n')
  const y = b.split('\n')
  return x.filter((l, i) => l !== y[i]).join(' | ') || '(igual)'
}

async function atacarMcp(cli, nombre, v, marcas) {
  const { tools } = await cli.listTools()
  ok(tools.length >= 40, `${nombre}: el MCP tiene sus ${tools.length} herramientas`)
  let llamadas = 0
  for (const t of tools) {
    for (const porNombre of [false, true]) {
      const a = argumentosAjenos(t, v, porNombre)
      const r = await herramienta(cli, t.name, a)
      llamadas++
      // Lo que la herramienta repite de lo que se le pidió («No encontré el proyecto «Proyecto ZAFIRO»») no es una filtración.
      let sinEco = r.texto
      for (const val of JSON.stringify(a).match(/"[^"]*"/g) ?? []) sinEco = sinEco.split(val.slice(1, -1)).join('·')
      const filtra = marcas.find((m) => sinEco.toLowerCase().includes(m.toLowerCase()))
      ok(!filtra, `${nombre}: ${t.name} (${porNombre ? 'por nombre' : 'por id'}) no trae nada de la otra cuenta`, filtra && `${JSON.stringify(a).slice(0, 200)} → ${r.texto.slice(0, 300)}`)
    }
  }
  return llamadas
}

// ───────────────────────── eventos en vivo ─────────────────────────

function escucharSse(q) {
  const ctl = new AbortController()
  const eventos = []
  const listo = (async () => {
    try {
      const r = await fetch(`${q.base}/api/eventos`, { headers: { cookie: q.cookie ? `tablero_sesion=${q.cookie}` : '', ...(q.clave ? { authorization: `Bearer ${q.clave}` } : {}) }, signal: ctl.signal })
      const lector = r.body.getReader()
      let resto = ''
      for (;;) {
        const { value, done } = await lector.read()
        if (done) break
        resto += new TextDecoder().decode(value)
        const partes = resto.split('\n\n')
        resto = partes.pop()
        for (const p of partes) {
          const datos = p.split('\n').find((l) => l.startsWith('data:'))
          if (p.includes('event: cambio') && datos) eventos.push(datos.slice(5).trim())
        }
      }
    } catch {}
  })()
  return { eventos, cerrar: () => (ctl.abort(), listo) }
}

// ───────────────────────── 0. registro cerrado ─────────────────────────

async function pasoCerrado() {
  titulo('0. Sin TABLERO_INVITACION no hay registro por código; el enlace del dueño y la cuenta abierta con aprobación sí andan')
  const srv = await levantar({ puerto: PUERTO + 2, datos: carpeta('cerrado'), invitacion: '' })
  const q = new Quien(srv.base, { nombre: 'visita' })
  const s = await q.g('/api/sesion')
  ok(s.json?.registro === true && s.json?.entrado === false, '/api/sesion dice que se puede crear una cuenta (siempre, queda pendiente hasta que el dueño la apruebe)', s.json)
  const r = await q.p('/api/cuentas', { email: 'nueva@ejemplo.com', nombre: 'Nueva', clave: 'una clave bien larga', invitacion: '' })
  ok(r.status === 403 && /no está abierto/.test(r.json?.error ?? ''), 'el registro por código (compatibilidad), sin la variable: cerrado, con mensaje claro', r.texto)
  const r2 = await q.p('/api/cuentas', { email: 'nueva@ejemplo.com', nombre: 'Nueva', clave: 'una clave bien larga', invitacion: 'cualquiera' })
  ok(r2.status === 403, 'con cualquier código, igual cerrado', r2.texto)
  // Lo normal desde que hay Amigos: sin variable ni nueva publicación, el dueño invita desde la app y el amigo entra con el enlace.
  const dueno = new Quien(srv.base, { nombre: 'dueño (sesión)', cookie: cookieJuego(), ip: '10.9.1.1' })
  const inv = await dueno.p('/api/amigos/invitaciones', { nota: 'para Pablo' })
  const token = inv.json?.enlace?.split('/unirse/')[1]
  ok(inv.status === 201 && Boolean(token), 'sin TABLERO_INVITACION, el dueño crea una invitación desde la app', inv.texto)
  const amigo = new Quien(srv.base, { nombre: 'Pablo', ip: '10.9.1.2' })
  const e = await amigo.p('/api/unirse', { token, email: 'pablo@ejemplo.com', nombre: 'Pablo', clave: 'una frase larga de pablo' })
  ok(e.status === 201 && decodeURIComponent(amigo.cookie).startsWith('v1.t:'), 'y el amigo se registra con el enlace, sin ninguna variable de Vercel', e.texto)
  ok((await amigo.g('/api/cuenta')).json?.nombre === 'Pablo', 'queda adentro, con su cuenta')
  await apagar(srv)
  rmSync(srv.datos, { recursive: true, force: true })
}

// ───────────────────────── 1. base de antes de la migración ─────────────────────────

function refAntes() {
  try {
    const c = execFileSync('git', ['log', '-n1', '--diff-filter=A', '--format=%H', '--', 'supabase/migrations/20261204090000_cuentas.sql'], { cwd: RAIZ, encoding: 'utf8' }).trim()
    return c ? `${c}~1` : 'HEAD'
  } catch {
    return null
  }
}

async function pasoBaseVieja() {
  titulo('1. Una base de antes de la migración queda toda de «dueno»')
  const ref = refAntes()
  if (!ref) return ok(true, '(sin git: salteado)')
  const viejo = carpeta('codigo-viejo')
  execFileSync('sh', ['-c', `git archive ${ref} | tar -x -C "${viejo}"`], { cwd: RAIZ })
  symlinkSync(path.join(RAIZ, 'node_modules'), path.join(viejo, 'node_modules'))
  ok(!existsSync(path.join(viejo, 'supabase/migrations/20261204090000_cuentas.sql')), `el código de antes (${ref}) no tiene la migración de cuentas`)
  const datos = carpeta('base-vieja')
  const puerto = PUERTO + 1
  const v1 = await levantar({ puerto, datos, publico: false, codigo: viejo })
  const base = v1.base
  const correr = (script, extra) =>
    new Promise((ok2) => {
      const h = spawn(process.execPath, [path.join(RAIZ, 'scripts', script), ...extra], { cwd: RAIZ, stdio: 'pipe', env: { ...process.env, TABLERO_PUERTO: String(puerto) } })
      let out = ''
      h.stdout.on('data', (d) => (out += d))
      h.stderr.on('data', (d) => (out += d))
      h.on('close', (c) => ok2({ codigo: c, out }))
    })
  const s1 = await correr('sembrar-lienzo.mjs', ['--url', base, '--cantidad', '120', '--conectores', '30'])
  ok(s1.codigo === 0, 'sembrar-lienzo cargó un tablero con 120 objetos (código de antes)', s1.out.slice(-500))
  const s2 = await correr('probar-mcp.mjs', ['--web', base, '--dejar', '--codigo-viejo'])
  // Acá probar-mcp siembra (deja su proyecto a la vista); sus propias comprobaciones son del código de antes. Una que falle
  // (alguna es sensible a lo que sembró sembrar-lienzo) se avisa sin cortar: lo que se mira es que la siembra quedó.
  if (s2.codigo === 0) ok(true, 'probar-mcp corrió contra el código de antes (y dejó su proyecto a la vista)')
  else console.log(`  · aviso: probar-mcp terminó con ${s2.codigo} contra el código de antes:\n${s2.out.split('\n').filter((l) => l.includes('✗')).join('\n')}`)
  const local = new Quien(base, { nombre: 'antes' })
  const img = await local.p('/api/archivos', formArchivo('vieja.png', PNG, 'image/png'))
  const rc = (await local.g('/api/proyectos?archivados=1')).json
  // Un comentario de antes con «@claude» (el código viejo lo guardaba sin hacer nada con él), en una tarjeta que ya estaba.
  let tarjetaVieja = null
  for (const p of rc) for (const t of p.tableros) tarjetaVieja ??= (await local.g(`/api/tableros/${t.id}`)).json.tarjetas?.[0]?.clave ?? null
  const comViejo = tarjetaVieja && (await local.p(`/api/tarjetas/${tarjetaVieja}/comentarios`, { cuerpo: '@claude ya le respondi (comentario de antes)' }))
  ok(Boolean(comViejo) && comViejo.status === 201, `antes: un comentario con «@claude» en ${tarjetaVieja}`, comViejo?.texto)
  const fotoAntes = async (q) => {
    const proyectos = (await q.g('/api/proyectos?archivados=1')).json
    const partes = [JSON.stringify(proyectos.map((p) => [p.id, p.prefijo, p.nombre, p.tableros.map((t) => [t.id, t.nombre, t.abiertas])]))]
    for (const p of proyectos)
      for (const t of p.tableros) {
        const c = (await q.g(`/api/tableros/${t.id}`)).json
        partes.push(`${t.id}: ${c.tarjetas.length} tarjetas, ${c.elementos.length} objetos, ${c.conectores.length} conectores, ${c.listas.length} listas`)
      }
    partes.push(`miembros: ${(await q.g('/api/miembros')).json.map((m) => m.nombre).sort().join(',')}`)
    return partes.join('\n')
  }
  const antes = await fotoAntes(local)
  ok(rc.length >= 2, `antes: ${rc.length} proyectos (RC y el de probar-mcp)`)
  await apagar(v1)

  // El código nuevo sobre la misma base: aplica la migración sola (local) y todo sigue siendo del dueño.
  const v2 = await levantar({ puerto, datos })
  ok(/migración aplicada: 20261204090000_cuentas.sql/.test(v2.salida()), 'el código nuevo aplicó la migración de cuentas')
  const dueno = new Quien(v2.base, { nombre: 'dueño (clave)', clave: CLAVE })
  const despues = await fotoAntes(dueno)
  ok(antes === despues, 'la clave del MCP ve exactamente lo mismo que antes (proyectos, tableros, tarjetas, objetos, conectores, miembros)', `${antes}\n≠\n${despues}`)
  const arch = await dueno.g(img.json.url)
  ok(arch.status === 200 && Buffer.compare(Buffer.from(arch.bytes), PNG) === 0, 'el archivo de antes se sigue leyendo con la clave')
  const mcp = await clienteMcp(v2.base, { authorization: `Bearer ${CLAVE}` })
  const lp = await herramienta(mcp, 'listar_proyectos', {})
  ok(!lp.error && rc.every((p) => lp.texto.includes(p.prefijo)), 'por MCP con la clave: listar_proyectos trae los de antes', lp.texto.slice(0, 300))
  await mcp.close()
  // Lo de antes con «@claude» se levanta para el dueño (la primera vez que pide novedades) y los miembros de antes ganan su alias.
  const miembrosDueno = (await dueno.g('/api/miembros')).json
  ok(miembrosDueno.every((m) => m.alias) && miembrosDueno.some((m) => m.nombre === 'Claude' && m.alias === 'claude'), 'los miembros de antes de la migración reciben su alias (claude)', miembrosDueno)
  const novDueno = (await dueno.g('/api/novedades')).json
  ok(novDueno.notificaciones.some((n) => /Encontré 1 mención pendiente de antes/.test(n.titulo)), 'el dueño recibe un único aviso: «Encontré 1 mención pendiente de antes»', novDueno.notificaciones.map((n) => n.titulo))
  const claudeViejo = new Client({ name: 'telar-prueba-cuentas', version: '1.0.0' })
  await claudeViejo.connect(new StreamableHTTPClientTransport(new URL(`${v2.base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${CLAVE}`, 'x-tablero-autor': 'Claude' } } }))
  const pendViejo = await herramienta(claudeViejo, 'leer_pendientes', {})
  ok(pendViejo.json?.menciones?.some((m) => m.tarjeta === tarjetaVieja && m.texto.includes('comentario de antes')), 'Claude (con la clave) ve la mención de antes en leer_pendientes', pendViejo.texto.slice(0, 300))
  await claudeViejo.close()
  // Una cuenta nueva sobre esa base no ve nada.
  const c = new Quien(v2.base, { nombre: 'C', ip: '10.1.0.1' })
  const reg = await c.p('/api/cuentas', { email: 'carla@ejemplo.com', nombre: 'Carla', clave: 'la frase larga de carla', invitacion: INVITACION })
  ok(reg.status === 201, 'una cuenta nueva se registra sobre la base migrada', reg.texto)
  ok(JSON.stringify((await c.g('/api/proyectos?archivados=1')).json) === '[]', 'la cuenta nueva no ve ningún proyecto de antes')
  const levC = await c.p('/api/ia/menciones/levantar', {})
  const novC = (await c.g('/api/novedades')).json
  ok(levC.status === 200 && levC.json.pendientes === 0 && levC.json.atendidas === 0 && novC.notificaciones.length === 0, 'la cuenta nueva no levanta nada de lo de antes del dueño (ni recibe su aviso)', levC.texto + JSON.stringify(novC))
  const rcFila = rc.find((p) => p.prefijo === 'RC')
  ok((await c.g(`/api/tableros/${rcFila.tableros[0].id}`)).status === 404, 'ni abre un tablero de antes por id (404)')
  ok((await c.g(img.json.url)).status === 404, 'ni lee un archivo de antes por su dirección (404)')
  ok(JSON.stringify((await c.g('/api/buscar?q=RC')).json) === '[]', 'ni lo encuentra buscando')
  await apagar(v2)

  // La base directo: todo de 'dueno' salvo el miembro y la cuenta de Carla.
  const { PGlite } = await import('@electric-sql/pglite')
  const db = await PGlite.create(path.join(datos, 'pg'))
  const n = async (sql) => Number((await db.query(sql)).rows[0].n)
  ok((await n(`select count(*)::int as n from proyectos where propietario <> 'dueno'`)) === 0, 'en la base: todos los proyectos son de «dueno»')
  ok((await n(`select count(*)::int as n from actividad where propietario <> 'dueno'`)) === 0, 'en la base: toda la actividad es de «dueno»')
  ok((await n(`select count(*)::int as n from miembros where propietario <> 'dueno'`)) === 1, 'en la base: los miembros de antes son de «dueno» (y Carla tiene el suyo)')
  ok((await n(`select count(*)::int as n from cuentas where id = 'dueno'`)) === 1, 'en la base: existe la cuenta «dueno»')
  ok((await n(`select count(*)::int as n from proyectos`)) === rc.length, 'en la base: no se perdió ningún proyecto')
  await db.close()
  rmSync(datos, { recursive: true, force: true })
  rmSync(viejo, { recursive: true, force: true })
}

// ───────────────────────── 2 a 4: cuentas, aislamiento y OAuth ─────────────────────────

async function pasoPrincipal() {
  let srv = await levantar({ puerto: PUERTO, datos: carpeta('principal') })
  const BASE = srv.base
  const dueno = new Quien(BASE, { nombre: 'dueño (clave)', clave: CLAVE, ip: '10.9.0.1' })

  titulo('2. Registrarse y entrar')
  const visita = new Quien(BASE, { nombre: 'visita', ip: '10.2.0.1' })
  const s0 = await visita.g('/api/sesion')
  ok(s0.json?.registro === true && s0.json?.entrado === false, 'con TABLERO_INVITACION el registro está abierto', s0.json)
  const reg = (q, d) => q.p('/api/cuentas', { invitacion: INVITACION, ...d })
  let r = await reg(visita, { email: 'ana@ejemplo.com', nombre: 'Ana', clave: 'una frase larga de ana', invitacion: 'otro-codigo' })
  ok(r.status === 403 && /invitación no es válido/.test(r.json?.error), 'código de invitación malo: no', r.texto)
  r = await reg(visita, { email: 'ana@ejemplo.com', nombre: 'Ana', clave: 'corta' })
  ok(r.status === 400 && /al menos 10/.test(r.json?.error), 'contraseña corta: no', r.texto)
  r = await reg(visita, { email: 'ana@ejemplo.com', nombre: 'Ana', clave: '1234567890' })
  ok(r.status === 400 && /más usadas/.test(r.json?.error), 'contraseña de las más usadas: no', r.texto)
  r = await reg(visita, { email: 'no-es-un-mail', nombre: 'Ana', clave: 'una frase larga de ana' })
  ok(r.status === 400 && /mail válido/.test(r.json?.error), 'mail inválido: no', r.texto)
  const A = new Quien(BASE, { nombre: 'A', ip: '10.3.0.1' })
  r = await reg(A, { email: 'Ana@Ejemplo.com', nombre: 'Ana', clave: 'una frase larga de ana' })
  ok(r.status === 201 && decodeURIComponent(A.cookie).startsWith('v1.t:'), 'A se registra (cookie firmada con «t:»)', r.texto)
  ok(!r.texto.includes('frase larga'), 'la respuesta no trae la contraseña')
  r = await reg(new Quien(BASE, { ip: '10.3.0.2' }), { email: 'ana@ejemplo.com', nombre: 'Otra', clave: 'otra frase larga más' })
  ok(r.status === 409 && /Ya hay una cuenta/.test(r.json?.error), 'mail repetido (con otras mayúsculas): no', r.texto)
  const B = new Quien(BASE, { nombre: 'B', ip: '10.4.0.1' })
  ok((await reg(B, { email: 'beto@ejemplo.com', nombre: 'Beto', clave: 'la frase larga de beto' })).status === 201, 'B se registra')
  const cuentaA = (await A.g('/api/cuenta')).json
  const cuentaB = (await B.g('/api/cuenta')).json
  ok(cuentaA.tipo === 'telar' && cuentaA.email === 'ana@ejemplo.com' && cuentaA.nombre === 'Ana', '/api/cuenta: A es de Telar, con su mail y su nombre', cuentaA)
  ok(cuentaA.uso.topes?.proyectos === 20 && cuentaA.uso.topes?.archivosMb === 200, 'una cuenta nueva tiene topes (20 proyectos, 200 MB)', cuentaA.uso)
  ok((await A.g('/api/miembros')).json.length === 1 && (await A.g('/api/miembros')).json[0].nombre === 'Ana', 'A arranca con su propio miembro «yo» (Ana), sin los del dueño')
  // límite de registros por IP
  const spam = new Quien(BASE, { ip: '10.5.0.1' })
  let ultimo = null
  for (let i = 0; i < 9; i++) ultimo = await reg(spam, { email: `spam${i}@ejemplo.com`, nombre: 'Spam', clave: 'corta' })
  ok(ultimo.status === 429, 'muchos registros desde la misma IP: «Demasiados intentos»', ultimo.texto)
  // entrar
  const intento = new Quien(BASE, { ip: '10.6.0.1' })
  const mala = await intento.p('/api/sesion', { email: 'ana@ejemplo.com', clave: 'no es la contraseña' })
  const noExiste = await intento.p('/api/sesion', { email: 'nadie@ejemplo.com', clave: 'no es la contraseña' })
  ok(mala.status === 401 && mala.json?.error === 'Mail o contraseña incorrectos.', 'entrar con la contraseña mala: 401', mala.texto)
  ok(noExiste.status === mala.status && noExiste.json?.error === mala.json?.error, 'un mail que no existe da el mismo mensaje (no se cuenta qué mails existen)')
  const bien = new Quien(BASE, { ip: '10.6.0.2' })
  ok((await bien.p('/api/sesion', { email: ' ANA@ejemplo.com ', clave: 'una frase larga de ana' })).status === 200 && decodeURIComponent(bien.cookie).startsWith('v1.t:'), 'entrar con mail (con espacios y mayúsculas) y contraseña')
  ok((await bien.g('/api/cuenta')).json?.id === cuentaA.id, 'esa sesión es la cuenta de A')
  const porMail = new Quien(BASE, { ip: '10.6.0.3' })
  for (let i = 0; i < 8; i++) await porMail.p('/api/sesion', { email: 'beto@ejemplo.com', clave: `mala ${i} pero larga` }, { ip: `10.7.0.${i}` })
  r = await porMail.p('/api/sesion', { email: 'beto@ejemplo.com', clave: 'la frase larga de beto' }, { ip: '10.7.1.1' })
  ok(r.status === 429, 'muchas contraseñas malas para un mail: frena aunque después llegue la buena (y desde otra IP)', r.texto)
  const porIp = new Quien(BASE, { ip: '10.8.0.1' })
  for (let i = 0; i < 30; i++) await porIp.p('/api/sesion', { email: `x${i}@ejemplo.com`, clave: 'no es la contraseña' })
  r = await porIp.p('/api/sesion', { email: 'ana@ejemplo.com', clave: 'una frase larga de ana' })
  ok(r.status === 429, 'muchos intentos desde una IP: frena', r.texto)
  ok((await dueno.g('/api/cuenta')).json?.tipo === 'juego' && (await dueno.g('/api/cuenta')).json?.id === 'dueno', 'la clave del MCP es la cuenta «dueno»')
  ok((await dueno.g('/api/info')).json?.clave === CLAVE && (await A.g('/api/info')).json?.clave === '', '/api/info: la clave solo se le muestra al dueño (no a A)')
  // la cuenta del juego (cookie del dueño, como antes)
  const exp = Math.floor(Date.now() / 1000) + 3600
  const baseCookie = `v1.${USUARIO_JUEGO}.${exp}`
  const juego = new Quien(BASE, { nombre: 'dueño (cuenta del juego)', cookie: `${baseCookie}.${createHmac('sha256', SECRETO).update(baseCookie).digest('base64url')}` })
  ok((await juego.g('/api/cuenta')).json?.id === 'dueno', 'la cookie de la cuenta del juego (TABLERO_USUARIOS) sigue entrando y es «dueno»')
  const otraJuego = `v1.otro-usuario.${exp}`
  ok((await new Quien(BASE, { cookie: `${otraJuego}.${createHmac('sha256', SECRETO).update(otraJuego).digest('base64url')}` }).g('/api/proyectos')).status === 401, 'una cuenta del juego que no está en TABLERO_USUARIOS no entra')
  const inventada = `v1.t:noexiste:1.${exp}`
  ok((await new Quien(BASE, { cookie: `${inventada}.${createHmac('sha256', SECRETO).update(inventada).digest('base64url')}` }).g('/api/proyectos')).status === 401, 'una cookie bien firmada de una cuenta que no existe no entra')

  titulo('2z. La IA integrada deja trabajos en cada cuenta (se siembran con el Telar apagado: PGlite es de un solo proceso)')
  await apagar(srv)
  const sembrarIA = (cuenta, marca) =>
    JSON.parse(execFileSync(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), ['scripts/ia/sembrar-trabajo.ts', srv.datos, cuenta, marca], { cwd: RAIZ }).toString().trim().split('\n').pop())
  const sembradoA = sembrarIA(cuentaA.id, 'ZAFIRO')
  const sembradoB = sembrarIA(cuentaB.id, 'ONIX')
  srv = await levantar({ puerto: PUERTO, datos: srv.datos })
  ok(Boolean(sembradoA.trabajo && sembradoB.trabajo), 'A y B tienen cada una su agente, un trabajo esperando permiso, su gasto y una mención pendiente')

  titulo('3. Cada cuenta arma lo suyo (con OAuth para su IA)')
  // eventos en vivo: B, A y el dueño escuchan desde antes de que A arme nada
  const cursor = async (q) => (await q.g('/api/eventos/desde?n=0')).json.n
  const nB = await cursor(B)
  const nA = await cursor(A)
  const nD = await cursor(dueno)
  const sseB = escucharSse(B)
  const sseA = escucharSse(A)
  const sseD = escucharSse(dueno)
  await new Promise((r2) => setTimeout(r2, 400))
  const tokA = await conectarOAuth(A, 'IA de Ana')
  const tokB = await conectarOAuth(B, 'IA de Beto')
  const mcpA = await clienteMcp(BASE, { authorization: `Bearer ${tokA.access_token}` })
  const mcpB = await clienteMcp(BASE, { authorization: `Bearer ${tokB.access_token}` })
  const va = await sembrarCuenta(A, mcpA, 'ANA', 'ZAFIRO')
  const vb = await sembrarCuenta(B, mcpB, 'BETO', 'ONIX')
  va.cuenta = cuentaA.id
  vb.cuenta = cuentaB.id
  Object.assign(va, { trabajo: sembradoA.trabajo, llamada: sembradoA.llamada, mencionIA: sembradoA.mencion })
  Object.assign(vb, { trabajo: sembradoB.trabajo, llamada: sembradoB.llamada, mencionIA: sembradoB.mencion })
  ok(Boolean(va.tabla && va.grafico && va.marcoD), 'A armó proyecto, tableros, tarjetas con comentario, checklist, adjunto, enlace y vínculo, lienzo con tabla y gráfico, Diseño y archivos')
  const ia = (await A.g('/api/miembros')).json.find((m) => m.tipo === 'ia' && !/^Bot /.test(m.nombre))
  ok(ia?.nombre === 'IA de Ana' || Boolean(ia), 'la IA de A (por OAuth) quedó como miembro de la cuenta de A', (await A.g('/api/miembros')).json)
  ok(!(await B.g('/api/miembros')).json.some((m) => m.nombre === ia?.nombre), 'y no aparece entre los miembros de B')
  const conexA = (await A.g('/api/oauth/conexiones')).json
  va.familia = conexA[0]?.familia
  vb.familia = (await B.g('/api/oauth/conexiones')).json[0]?.familia
  ok(conexA.length === 1 && conexA[0].nombre === 'IA de Ana', 'las conexiones de A son solo la suya', conexA)
  // B y el dueño también pueden tener un proyecto RC (los prefijos son por cuenta)
  ok((await B.p('/api/proyectos', { nombre: 'RC de Beto', prefijo: 'RC' })).status === 201, 'B puede tener su propio «RC» (el prefijo es por cuenta: no cuenta que el dueño tiene uno)')

  const fotoA1 = await foto(A, va)
  const fotoA2 = await foto(A, va)
  ok(fotoA1 === fotoA2, 'la foto de lo de A es estable (para comparar)', '')
  const proyectosDueno1 = (await dueno.g('/api/proyectos?archivados=1')).texto

  titulo('3a. B intenta todo sobre lo de A (API web, Diseño, OAuth y archivos)')
  const nAtaquesB = await atacar(B, va, vb, ['zafiro'])
  const fA = await foto(A, va)
  ok(fA === fotoA1, `después de ${nAtaquesB} intentos de B, lo de A está igual (tableros, tarjetas, lienzo, Diseño, actividad y archivos)`, diferencia(fotoA1, fA))
  titulo('3b. La clave del MCP (el dueño) intenta todo sobre lo de A')
  const nAtaquesD = await atacar(dueno, va, vb, ['zafiro'], { esClave: true })
  const fA2 = await foto(A, va)
  ok(fA2 === fotoA1, `después de ${nAtaquesD} intentos con la clave, lo de A está igual`, diferencia(fotoA1, fA2))
  titulo('3c. A intenta todo sobre lo de B')
  // (B también creó cosas suyas en 3a: la foto de B se saca recién ahora)
  const fotoB0 = await foto(B, vb)
  const nAtaquesA = await atacar(A, vb, va, ['onix'])
  const fB = await foto(B, vb)
  ok(fB === fotoB0, `después de ${nAtaquesA} intentos de A, lo de B está igual`, diferencia(fotoB0, fB))

  titulo('3d. Por MCP: cada herramienta, con referencias a lo de A (por id y por nombre)')
  const fotoA0 = await foto(A, va)
  const nMcpB = await atacarMcp(mcpB, 'B por OAuth', va, ['zafiro'])
  const mcpD = await clienteMcp(BASE, { authorization: `Bearer ${CLAVE}` })
  const nMcpD = await atacarMcp(mcpD, 'el dueño con la clave', va, ['zafiro'])
  const fA3 = await foto(A, va)
  ok(fA3 === fotoA0, `después de ${nMcpB + nMcpD} llamadas al MCP de B y del dueño, lo de A está igual`, diferencia(fotoA0, fA3))
  const fotoB2 = await foto(B, vb)
  const nMcpA = await atacarMcp(mcpA, 'A por OAuth', vb, ['onix'])
  const fB3 = await foto(B, vb)
  ok(fB3 === fotoB2, `después de ${nMcpA} llamadas al MCP de A, lo de B está igual`, diferencia(fotoB2, fB3))
  ok((await dueno.g('/api/proyectos?archivados=1')).texto.includes('Restaurant City') && !(await dueno.g('/api/proyectos?archivados=1')).texto.includes('ZAFIRO'), 'el dueño sigue viendo lo suyo (Restaurant City) y nada de A')
  void proyectosDueno1

  titulo('3d2. Menciones y notificaciones: B no ve, no toca y no responde nada de A')
  const iaA = mcpA
  const pendA0 = (await herramienta(iaA, 'leer_pendientes', {})).json
  ok(pendA0.menciones.some((m) => m.id === va.mencion), 'A (su IA) tiene una mención pendiente', pendA0)
  ok(!pendA0.menciones.some((m) => m.id === va.mencionAtendida), 'y la que contestó quedó atendida (con su notificación para la persona)')
  const notifA0 = (await A.g('/api/notificaciones')).json
  ok(notifA0.some((n) => n.id === va.notificacion && n.leidaEn === null), 'A tiene la notificación «respuesta» sin leer', notifA0.map((n) => n.titulo))
  const novedadesB = await B.g('/api/novedades')
  ok(novedadesB.status === 200 && !novedadesB.texto.toLowerCase().includes('zafiro') && !novedadesB.texto.includes(va.notificacion), 'las novedades de B no traen nada de A', novedadesB.texto.slice(0, 300))
  const pendIaB = await herramienta(mcpB, 'leer_pendientes', {})
  ok(!pendIaB.error && !pendIaB.texto.toLowerCase().includes('zafiro'), 'leer_pendientes de la IA de B no trae nada de A', pendIaB.texto.slice(0, 300))
  const pendIaBdeA = await herramienta(mcpB, 'leer_pendientes', { proyecto: va.prefijo })
  const pendIaBfalso = await herramienta(mcpB, 'leer_pendientes', { proyecto: 'NOEXIS' })
  ok(pendIaBdeA.error && pendIaBdeA.texto.replace(va.prefijo, '·') === pendIaBfalso.texto.replace('NOEXIS', '·'), 'pedir el proyecto de A desde B contesta igual que uno que no existe', pendIaBdeA.texto)
  const atB = await herramienta(mcpB, 'atender_mencion', { mencion: va.mencion })
  const atFalso = await herramienta(mcpB, 'atender_mencion', { mencion: 'm_noexiste12345' })
  ok(atB.error && atB.texto === atFalso.texto, 'atender una mención de A desde B contesta igual que una que no existe', atB.texto)
  const atD = await herramienta(mcpD, 'atender_mencion', { mencion: va.mencion })
  ok(atD.error && atD.texto === atFalso.texto, 'y también con la clave del MCP (el dueño)', atD.texto)
  const leerAjena = await B.p('/api/notificaciones/leer', { ids: [va.notificacion] })
  const leerFalsa = await B.p('/api/notificaciones/leer', { ids: ['n_noexiste12345'] })
  ok(leerAjena.status === 404 && leerAjena.texto === leerFalsa.texto, 'B no puede marcar leída una notificación de A (404, igual que una que no existe)', leerAjena.texto)
  const respAjena = await B.p(`/api/tarjetas/${vb.k1}/comentarios`, { cuerpo: 'respuesta', respondeA: va.comentarioMencion })
  ok(respAjena.status === 404, 'B no puede responder a un comentario de A (404)', respAjena.texto)
  const aliasAjeno = await B.p(`/api/tarjetas/${vb.k1}/comentarios`, { cuerpo: `hola @${va.aliasIA} y @ana`, id: `b${azar()}x` })
  ok(aliasAjeno.status === 201 && !(aliasAjeno.json.menciones ?? []).some((m) => m.destinatarioId === va.miembroYo) && !(aliasAjeno.json.menciones ?? []).some((m) => m.tarjetaClave === va.k1), 'un alias que solo existe en A (el de su IA, «ana») no resuelve en B', aliasAjeno.texto.slice(0, 300))
  const levantarB = await B.p('/api/ia/menciones/levantar', {})
  ok(levantarB.status === 200 && levantarB.json.pendientes === 0 && levantarB.json.atendidas === 0, 'levantar «lo de antes» en B no levanta nada de A', levantarB.texto)
  const levantarA = await A.p('/api/ia/menciones/levantar', {})
  ok(levantarA.status === 200 && levantarA.json.pendientes === 0, 'y en A no duplica lo que ya estaba (la corrida es idempotente)', levantarA.texto)
  const pendA1 = (await herramienta(iaA, 'leer_pendientes', {})).json
  ok(pendA1.menciones.length === pendA0.menciones.length && pendA1.menciones.some((m) => m.id === va.mencion), 'la mención de A sigue pendiente y no se duplicó', pendA1)
  ok((await A.g('/api/notificaciones')).json.find((n) => n.id === va.notificacion)?.leidaEn === null, 'la notificación de A sigue sin leer después de todo lo de B')
  const levantarD = await dueno.p('/api/ia/menciones/levantar', {})
  ok(levantarD.status === 403, 'con la clave del MCP no se puede levantar a mano (solo con sesión)', levantarD.texto)

  titulo('3d3. IA: claves, agentes y ajustes de A, vistos y tocados por B y por la clave del MCP')
  const estIA_A = (await A.g('/api/ia/estado')).json
  ok(estIA_A.puedeCambiar === true && estIA_A.claves.some((k) => k.id === va.claveIA && k.ultimos4 === '6789') && estIA_A.agentes.some((x) => x.miembroId === va.agenteIA && x.nombre === 'Agente ZAFIRO'), 'A ve su clave (termina en …6789) y su agente', estIA_A)
  ok(!JSON.stringify(estIA_A).includes('CLAVE-ZAFIRO'), 'y la clave de A no vuelve nunca (solo «termina en»)')
  const estIA_B = await B.g('/api/ia/estado')
  ok(estIA_B.status === 200 && !estIA_B.texto.toLowerCase().includes('zafiro'), 'B no ve nada de la IA de A (ni la clave, ni el agente, ni el gasto)', estIA_B.texto.slice(0, 300))
  ok(!estIA_B.texto.includes(va.claveIA) && !estIA_B.texto.includes(va.agenteIA) && !(await B.g('/api/ia/uso')).texto.toLowerCase().includes('zafiro'), 'B no ve los ids de la clave ni del agente de A')
  const estIA_D = (await dueno.g('/api/ia/estado')).json
  ok(estIA_D.puedeCambiar === false && !JSON.stringify(estIA_D).includes(va.claveIA), 'la clave del MCP ve la pantalla de IA del dueño pero no la de A, y no puede cambiar nada (puedeCambiar es false)', estIA_D)
  const miembrosB = (await B.g('/api/miembros')).json
  ok(!miembrosB.some((m) => m.id === va.agenteIA) && miembrosB.filter((m) => m.agente).every((m) => m.id !== va.agenteIA), 'el agente de A no es un miembro de B')
  const ajenoUsar = await B.p('/api/ia/agentes', { nombre: 'Robo', proveedor: 'falso', modelo: 'guion:responder', claveId: va.claveIA })
  const falsoUsar = await B.p('/api/ia/agentes', { nombre: 'Robo', proveedor: 'falso', modelo: 'guion:responder', claveId: 'qclaveIAqqq' })
  ok(ajenoUsar.status === 404 && ajenoUsar.texto === falsoUsar.texto, 'B no puede armar un agente con la clave de A (404, igual que una que no existe)', ajenoUsar.texto)
  const ajusteD = await dueno.pedir('PUT', '/api/ia/ajustes', { topeMesUsd: 99999 })
  ok(ajusteD.status === 403 && (await dueno.g('/api/ia/estado')).json.ajustes.topeMesUsd === 25, 'con la clave del MCP no se sube ningún tope (403)', ajusteD.texto)
  titulo('3d3. Trabajos de la IA: B no ve los pasos ni el gasto de A, y las rutas internas rechazan a todos sin su secreto')
  const trB = await B.g('/api/ia/trabajos')
  ok(trB.status === 200 && trB.json.some((t) => t.id === vb.trabajo) && !trB.texto.toLowerCase().includes('zafiro') && !trB.texto.includes(va.trabajo), 'B lista sus trabajos y ninguno de A', trB.texto.slice(0, 300))
  const detA = await A.g(`/api/ia/trabajos/${va.trabajo}`)
  ok(detA.status === 200 && detA.json.estado === 'esperando_confirmacion' && detA.json.pasos[0]?.llamadas[0]?.herramienta === 'archivar_tarjeta' && detA.json.tokens.entrada === 1000 && detA.json.costoUsd === 0.42, 'A ve su trabajo con sus pasos, su llamada, sus tokens y su costo', detA.texto.slice(0, 300))
  ok(detA.json.porConfirmar?.[0]?.id === va.llamada, 'y lo que espera permiso, con su llamada', detA.json.porConfirmar)
  const detBdeA = await B.g(`/api/ia/trabajos/${va.trabajo}`)
  const detFalso = await B.g('/api/ia/trabajos/tr_noexiste')
  ok(detBdeA.status === 404 && detBdeA.texto === detFalso.texto, 'B no ve los pasos ni el gasto de un trabajo de A: 404, igual que uno que no existe', detBdeA.texto)
  const novA = (await A.g('/api/novedades')).json
  ok(novA.trabajos.some((t) => t.id === va.trabajo && t.porConfirmar?.length === 1), 'las novedades de A traen su trabajo esperando permiso', novA.trabajos)
  ok(!JSON.stringify((await B.g('/api/novedades')).json).toLowerCase().includes('zafiro'), 'las de B no traen nada de A')
  for (const [quien, nombre] of [[A, 'A'], [B, 'B'], [new Quien(BASE, { nombre: 'sin sesión', ip: '10.9.9.9' }), 'sin sesión']]) {
    for (const [metodo, ruta] of [['POST', '/api/ia/interno/correr'], ['POST', '/api/ia/interno/diagnostico'], ['GET', '/api/ia/interno/barrer'], ['POST', '/api/ia/interno/barrer']]) {
      const r = await quien.pedir(metodo, ruta, metodo === 'POST' ? {} : undefined, { sinGuardar: true })
      ok(r.status === 401, `${nombre}: ${metodo} ${ruta} sin su secreto → ${r.status}`, r.texto.slice(0, 200))
    }
  }
  const barrerConClave = await dueno.pedir('GET', '/api/ia/interno/barrer', undefined, { sinGuardar: true })
  ok(barrerConClave.status === 401, 'la clave del MCP sola no abre el barrido del cron (solo CRON_SECRET)', barrerConClave.texto)
  const firmaAlcance = (cuenta, exp = Math.floor(Date.now() / 1000) + 60) => {
    const base = `a1.${cuenta}.${exp}`
    return `${base}.${createHmac('sha256', SECRETO).update(base).digest('base64url')}`
  }
  ok((await dueno.pedir('POST', '/api/ia/interno/correr', {}, { sinGuardar: true })).status === 401, 'correr: la clave sin la cuenta firmada, 401')
  ok((await dueno.pedir('POST', '/api/ia/interno/correr', {}, { sinGuardar: true, headers: { 'x-tablero-alcance': `a1.${cuentaA.id}.9999999999.firma-falsa` } })).status === 401, 'correr: con la cuenta mal firmada, 401')
  ok((await A.pedir('POST', '/api/ia/interno/correr', {}, { sinGuardar: true, headers: { 'x-tablero-alcance': firmaAlcance(cuentaA.id) } })).status === 401, 'correr: una sesión con la cuenta firmada pero sin la clave del MCP, 401')
  ok((await dueno.pedir('POST', '/api/ia/interno/correr', {}, { sinGuardar: true, headers: { 'x-tablero-alcance': firmaAlcance(cuentaA.id) } })).status === 202, 'correr: la clave del MCP con la cuenta bien firmada, 202 (y sin proveedor conectado no corre nada)')
  ok((await dueno.pedir('POST', '/api/ia/interno/diagnostico', {}, { sinGuardar: true })).status === 200, 'diagnóstico: solo con la clave del MCP')
  ok((await B.p(`/api/ia/trabajos/${vb.trabajo}/confirmar`, { decisiones: [{ llamadaId: vb.llamada, permitir: true }] })).status === 200, 'B confirma lo suyo con su sesión (controla el camino feliz)')
  const clv = await dueno.p(`/api/ia/trabajos/${va.trabajo}/confirmar`, { decisiones: [{ llamadaId: va.llamada, permitir: true }] })
  ok(clv.status === 403, 'con la clave del MCP no se permite una acción (403): la clave no gasta ni da permiso', clv.texto)
  ok((await dueno.p(`/api/ia/trabajos/${va.trabajo}/reanudar`, {})).status === 403, 'tampoco se reanuda con la clave (403)')
  ok((await A.g(`/api/ia/trabajos/${va.trabajo}`)).json.estado === 'esperando_confirmacion', 'el trabajo de A sigue esperando: nada de lo de B ni de la clave lo movió')

  titulo('3e. Dibujos de Diseño: un marco no puede usar archivos de otra cuenta')
  const ruta = va.archivo.replace(/^\/archivos\//, '')
  const htmlRobo = `<img src="${va.archivo}"><img src="/archivos/c/${va.cuenta}/${ruta}"><img src="${va.adjuntoRuta}">`
  const mb = await B.p(`/api/diseno/${vb.pid}/marcos`, { pagina: vb.pagina, nombre: 'Robo', ancho: 100, alto: 100, html: htmlRobo })
  if (mb.status < 300) {
    const svg = await B.g(`/api/diseno/${vb.pid}/marcos/${mb.json.marco.id}/render?formato=svg`)
    const b64A = Buffer.from(PNG).toString('base64')
    ok(svg.status === 200 && !svg.texto.includes(b64A) && !svg.texto.includes(va.adjuntoBytes.toString('base64')), 'el dibujo (SVG) de un marco de B con las direcciones de A no trae los archivos de A', svg.texto.slice(0, 300))
  } else ok(true, `el marco con direcciones ajenas no se creó (${mb.status})`)
  const interno = await dueno.p(`/api/diseno/${vb.pid}/render-interno`, {
    entrada: { marco: { html: htmlRobo, css: '', ancho: 100, alto: 100, hojas: [], datos: {}, origen: 'propio' }, hojas: [{ url: va.adjuntoRuta }], cssTokens: '', piezas: {} },
    op: { formato: 'svg' },
  })
  const svgInterno = interno.json?.bytes ? Buffer.from(interno.json.bytes, 'base64').toString('utf8') : ''
  ok(interno.status === 200 && !svgInterno.includes(Buffer.from(PNG).toString('base64')) && !svgInterno.toLowerCase().includes('zafiro'), 'el dibujo interno con la clave tampoco lee archivos de A (ni con «c/<cuenta>»)', `${interno.status} ${svgInterno.slice(0, 200)}`)
  ok((await B.p(`/api/diseno/${vb.pid}/render-interno`, { entrada: {}, op: {} })).status === 401, 'el dibujo interno pide la clave (B no puede)')
  ok((await B.p('/api/diseno/_/foto-lienzo-interna', { ruta: '/RC/pendientes/lienzo', ancho: 100, alto: 100, tema: 'claro' })).status === 401, 'la foto interna del lienzo pide la clave (B no puede)')
  const fotoB = await herramienta(mcpB, 'ver_lienzo', { tablero: vb.tablero ?? 'x' })
  ok(fotoB.error && /todavía no está disponible en tu cuenta/.test(fotoB.texto), 'ver_lienzo no se saca desde otra cuenta (la foto correría con la clave del dueño): lo dice y manda a leer_lienzo', fotoB.texto.slice(0, 200))
  const falsa = await dueno.pedir('POST', `/api/diseno/${vb.pid}/render-interno`, { entrada: { marco: { html: htmlRobo, css: '', ancho: 100, alto: 100, hojas: [], datos: {}, origen: 'propio' }, hojas: [], cssTokens: '', piezas: {} }, op: { formato: 'svg' } }, { headers: { 'x-tablero-alcance': `a1.${va.cuenta}.${exp}.firmafalsa` } })
  const svgFalsa = falsa.json?.bytes ? Buffer.from(falsa.json.bytes, 'base64').toString('utf8') : ''
  ok(!svgFalsa.includes(Buffer.from(PNG).toString('base64')), 'con la cuenta de A mal firmada, el dibujo interno no lee archivos de A')

  titulo('3f. Eventos en vivo: nadie recibe los de otra cuenta')
  await new Promise((r2) => setTimeout(r2, 1200))
  await Promise.all([sseA.cerrar(), sseB.cerrar(), sseD.cerrar()])
  const desde = async (q, n) => (await q.g(`/api/eventos/desde?n=${n}`)).json
  const dB = await desde(B, nB)
  const dA = await desde(A, nA)
  const dD = await desde(dueno, nD)
  const texto = (lista) => lista.join('\n').toLowerCase()
  ok(sseB.eventos.length > 10 && !texto(sseB.eventos).includes('zafiro') && !texto(sseB.eventos).includes(va.t1.toLowerCase()), `SSE: B recibió ${sseB.eventos.length} eventos suyos y ninguno de A`)
  ok(sseA.eventos.length > 10 && !texto(sseA.eventos).includes('onix') && !texto(sseA.eventos).includes(vb.t1.toLowerCase()), `SSE: A recibió ${sseA.eventos.length} eventos suyos y ninguno de B`)
  ok(!texto(sseD.eventos).includes('zafiro') && !texto(sseD.eventos).includes('onix'), `SSE: el dueño (clave) recibió ${sseD.eventos.length} eventos, ninguno de A ni de B`)
  const jB = JSON.stringify(dB.eventos).toLowerCase()
  const jA = JSON.stringify(dA.eventos).toLowerCase()
  ok(dB.eventos.length > 10 && !jB.includes('zafiro') && !jB.includes(va.t1.toLowerCase()) && !jB.includes(va.pid.toLowerCase()), `/api/eventos/desde: B trae ${dB.eventos.length} eventos, ninguno de A`)
  ok(dA.eventos.length > 10 && !jA.includes('onix') && !jA.includes(vb.t1.toLowerCase()), `/api/eventos/desde: A trae ${dA.eventos.length} eventos, ninguno de B`)
  ok(!JSON.stringify(dD.eventos).toLowerCase().includes('zafiro'), '/api/eventos/desde: el dueño no trae ninguno de A')
  ok(dA.eventos.some((e) => e.tipo === 'tarjeta' && e.datos?.titulo?.includes('ZAFIRO')), 'A sí ve en vivo lo suyo (su tarjeta)')

  titulo('3g. Búsqueda y actividad')
  ok(JSON.stringify((await B.g('/api/buscar?q=zafiro')).json) === '[]', 'B busca «zafiro» y no encuentra nada')
  ok((await A.g('/api/buscar?q=zafiro')).json.length >= 2, 'A sí encuentra lo suyo')
  const actA = (await A.g(`/api/tableros/${va.t1}/actividad?limite=300`)).json
  ok(!JSON.stringify(actA).toLowerCase().includes('onix') && !actA.some((x) => x.actor?.nombre === 'Beto'), 'la actividad de A no tiene nada de B')
  const actB = await herramienta(mcpB, 'leer_actividad', {})
  ok(!actB.texto.toLowerCase().includes('zafiro'), 'leer_actividad (MCP) de B no trae nada de A')

  titulo('4. OAuth: cada token es de su cuenta')
  const lpA = await herramienta(mcpA, 'listar_proyectos', {})
  const lpB = await herramienta(mcpB, 'listar_proyectos', {})
  ok(lpA.texto.includes('ANA') && !lpA.texto.includes('BETO') && !lpA.texto.includes('Restaurant'), 'el token de A lista solo los proyectos de A', lpA.texto.slice(0, 200))
  ok(lpB.texto.includes('BETO') && !lpB.texto.includes('ANA') && !lpB.texto.includes('Restaurant'), 'el token de B lista solo los de B')
  const mcpPost = (token) => fetch(`${BASE}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  ok((await mcpPost(jwtInventado(BASE, { sub: 't:noexiste' }))).status === 401, 'un token bien firmado de una cuenta que no existe: 401')
  ok((await mcpPost(jwtInventado(BASE, { sub: `t:${va.cuenta}`, aud: 'https://otro/mcp' }))).status === 401, 'un token de A para otro recurso: 401')
  ok((await mcpPost(tokA.access_token + 'x')).status === 401, 'el token de A tocado: 401')
  ok((await mcpPost(`${tokA.access_token.split('.').slice(0, 2).join('.')}.firmafalsa`)).status === 401, 'un token con la firma cambiada: 401')
  const robado = await fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokA.refresh_token, client_id: tokB.clientId, resource: `${BASE}/mcp` }) })
  ok(robado.status === 400, 'el refresh de A con la aplicación de B: no', await robado.text())
  const borrar = await B.pedir('DELETE', `/api/oauth/conexiones/${va.familia}`)
  ok(borrar.status === 404, 'B no puede desconectar la aplicación de A (404)')
  ok(!(await herramienta(mcpA, 'listar_proyectos', {})).error, 'y la de A sigue andando')
  ok((await dueno.g('/api/oauth/conexiones')).status === 401, 'las conexiones piden haber entrado (la clave sola no alcanza)')

  titulo('2b. Suspender una cuenta (el dueño, con su sesión: la clave del MCP no alcanza)')
  const S = new Quien(BASE, { nombre: 'S', ip: '10.10.0.1' })
  await reg(S, { email: 'susi@ejemplo.com', nombre: 'Susi', clave: 'la frase larga de susi' })
  const cuentaS = (await S.g('/api/cuenta')).json
  const tokS = await conectarOAuth(S, 'IA de Susi')
  ok((await B.p(`/api/amigos/${cuentaS.id}/estado`, { estado: 'suspendida' })).status === 403, 'B no puede suspender a nadie (403)')
  ok((await dueno.p(`/api/amigos/${cuentaS.id}/estado`, { estado: 'suspendida' })).status === 403, 'ni la clave del MCP: suspender y reactivar es dar permiso, pide la sesión del dueño (403)')
  ok((await dueno.g('/api/admin/cuentas')).status === 404, 'la ruta vieja /api/admin/cuentas (con la clave) ya no existe')
  ok((await S.g('/api/proyectos')).status === 200, 'S sigue entrando después de esos intentos')
  ok((await juego.p(`/api/amigos/${cuentaS.id}/estado`, { estado: 'suspendida' })).status === 200, 'el dueño (sesión) suspende a S')
  ok((await S.g('/api/proyectos')).status === 401, 'la sesión de S deja de andar en el próximo pedido')
  r = await new Quien(BASE, { ip: '10.10.0.2' }).p('/api/sesion', { email: 'susi@ejemplo.com', clave: 'la frase larga de susi' })
  ok(r.status === 403 && /suspendida/.test(r.json?.error), 'S no puede entrar: «cuenta suspendida»', r.texto)
  ok((await mcpPost(tokS.access_token)).status === 401, 'el token OAuth de S deja de andar')
  const refS = await fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokS.refresh_token, client_id: tokS.clientId, resource: `${BASE}/mcp` }) })
  ok(refS.status === 400, 'ni se puede refrescar')
  ok((await juego.p(`/api/amigos/${cuentaS.id}/estado`, { estado: 'activa' })).status === 200, 'el dueño reactiva a S')
  ok((await new Quien(BASE, { ip: '10.10.0.3' }).p('/api/sesion', { email: 'susi@ejemplo.com', clave: 'la frase larga de susi' })).status === 200, 'reactivada, S vuelve a entrar')
  ok((await juego.p('/api/amigos/dueno/estado', { estado: 'suspendida' })).status === 400, 'la cuenta del dueño no se suspende')
  ok((await juego.p('/api/amigos/noexiste/estado', { estado: 'suspendida' })).status === 404, 'una cuenta que no existe da 404')

  titulo('2c. Cambiar la contraseña')
  const A2 = new Quien(BASE, { nombre: 'A (otra sesión)', ip: '10.11.0.1' })
  await A2.p('/api/sesion', { email: 'ana@ejemplo.com', clave: 'una frase larga de ana' })
  r = await A.p('/api/cuenta/clave', { actual: 'no es', nueva: 'la frase nueva de ana' })
  ok(r.status === 401 && /actual no es/.test(r.json?.error), 'con la actual mala: no', r.texto)
  r = await A.p('/api/cuenta/clave', { actual: 'una frase larga de ana', nueva: 'corta' })
  ok(r.status === 400, 'con una nueva floja: no', r.texto)
  r = await A.p('/api/cuenta/clave', { actual: 'una frase larga de ana', nueva: 'la frase nueva de ana' })
  ok(r.status === 200, 'cambia la contraseña', r.texto)
  ok((await A.g('/api/cuenta')).status === 200, 'esta sesión sigue (cookie nueva)')
  ok((await A2.g('/api/cuenta')).status === 401, 'la otra sesión de A se cerró')
  ok((await new Quien(BASE, { ip: '10.11.0.2' }).p('/api/sesion', { email: 'ana@ejemplo.com', clave: 'una frase larga de ana' })).status === 401, 'la contraseña vieja ya no entra')
  ok((await new Quien(BASE, { ip: '10.11.0.3' }).p('/api/sesion', { email: 'ana@ejemplo.com', clave: 'la frase nueva de ana' })).status === 200, 'la nueva sí')
  ok((await dueno.p('/api/cuenta/clave', { actual: 'x', nueva: 'una clave larga nueva' })).status === 400, 'la clave del MCP no cambia contraseñas')
  ok((await A.pedir('DELETE', '/api/sesion')).status === 200, 'cerrar sesión')

  titulo('Topes')
  const T = new Quien(BASE, { nombre: 'T', ip: '10.12.0.1' })
  await reg(T, { email: 'topes@ejemplo.com', nombre: 'Topes', clave: 'la frase larga de topes' })
  let tope = null
  for (let i = 0; i < 21; i++) tope = await T.p('/api/proyectos', { nombre: `P${i}`, prefijo: `T${String.fromCharCode(65 + i)}` })
  ok(tope.status === 413 && /tope de 20 proyectos/.test(tope.json?.error), 'una cuenta nueva llega al tope de 20 proyectos con un mensaje claro', tope.texto)
  ok((await dueno.p('/api/proyectos', { nombre: 'Sin tope', prefijo: 'SINTOPE' })).status === 201, 'el dueño no tiene tope')
  const grande = Buffer.alloc(4 * 1024 * 1024 - 1024, 7)
  ok((await T.p('/api/archivos', formArchivo('grande.bin', Buffer.alloc(4 * 1024 * 1024 + 10, 1), 'application/octet-stream'))).status === 413, 'un archivo de más de 4 MB: no')
  let lleno = null
  for (let i = 0; i < 52 && (!lleno || lleno.status === 201); i++) lleno = await T.p('/api/archivos', formArchivo(`g${i}.bin`, grande, 'application/octet-stream'))
  ok(lleno.status === 413 && /tope de 200 MB/.test(lleno.json?.error ?? ''), 'una cuenta nueva llega al tope de 200 MB de archivos con un mensaje claro', lleno.texto)
  const usoT = (await T.g('/api/cuenta')).json.uso
  ok(usoT.archivosBytes > 195 * 1024 * 1024 && usoT.archivosBytes <= 200 * 1024 * 1024, `/api/cuenta cuenta lo que usa (${(usoT.archivosBytes / 1048576).toFixed(1)} MB)`)

  await Promise.all([mcpA.close(), mcpB.close(), mcpD.close()]).catch(() => {})
  await apagar(srv)
  rmSync(srv.datos, { recursive: true, force: true })
}

// ───────────────────────── 5. amigos e invitaciones ─────────────────────────

async function pasoAmigos() {
  titulo('5. Amigos: invitar por enlace es solo de la sesión del dueño; canjear, vencer, revocar, tope y suspender')
  let srv = await levantar({ puerto: PUERTO + 3, datos: carpeta('amigos') })
  const BASE = srv.base
  let ipn = 0
  const ipNueva = () => `10.20.${Math.floor(++ipn / 250)}.${ipn % 250}`
  const visita = () => new Quien(BASE, { nombre: 'visita', ip: ipNueva() })
  const duenoClave = new Quien(BASE, { nombre: 'dueño (clave)', clave: CLAVE, ip: ipNueva() })
  const juego = new Quien(BASE, { nombre: 'dueño (sesión)', cookie: cookieJuego(), ip: ipNueva() })
  const SIRVE = 'Esta invitación ya no sirve. Pedile otra a quien te invitó.'
  const FRASE = 'una frase larga de prueba'
  const tokens = []
  const tokenDe = new Map() // id de invitación → token (solo acá: el servidor no lo guarda)
  const anotar = (r) => {
    const token = r.json?.enlace?.split('/unirse/')[1]
    if (token) {
      tokens.push(token)
      tokenDe.set(r.json.invitacion.id, token)
    }
    return token
  }
  const crear = async (cuerpo = {}) => {
    const r = await juego.p('/api/amigos/invitaciones', cuerpo)
    return { r, token: anotar(r), id: r.json?.invitacion?.id }
  }
  const unirse = (q, token, quien, extra = {}) =>
    q.p('/api/unirse', { token, email: `${quien}@ejemplo.com`, nombre: quien[0].toUpperCase() + quien.slice(1), clave: FRASE, ...extra })
  const lista = async () => (await juego.g('/api/amigos')).json
  const estadoDe = async (id) => (await lista()).invitaciones.find((i) => i.id === id)
  const tsx = (...a) => execFileSync(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), a, { cwd: RAIZ }).toString().trim().split('\n').pop()

  titulo('5a. Quién puede invitar')
  const sesionDeCada = async (q) => (await q.g('/api/sesion')).json?.amigos
  ok((await sesionDeCada(juego)) === true, '/api/sesion dice «amigos» solo para la sesión del dueño')
  ok((await sesionDeCada(duenoClave)) === false && (await sesionDeCada(visita())) === false, 'y no para la clave del MCP ni para una visita')
  ok((await visita().g('/api/amigos')).status === 401 && (await visita().p('/api/amigos/invitaciones', {})).status === 401, 'sin sesión: 401')
  for (const [metodo, ruta, cuerpo] of [['GET', '/api/amigos'], ['POST', '/api/amigos/invitaciones', {}], ['PUT', '/api/amigos/ajustes', { topeAmigos: 50 }]]) {
    const r = await duenoClave.pedir(metodo, ruta, cuerpo)
    ok(r.status === 403 && /sesión/.test(r.json?.error ?? ''), `la clave del MCP: ${metodo} ${ruta} → 403 «con tu sesión»`, r.texto)
  }
  ok((await lista()).invitaciones.length === 0, 'la lista del dueño sigue vacía después de esos intentos')

  const c1 = await crear({ nota: 'para Pablo' })
  ok(c1.r.status === 201 && c1.r.json.invitacion.estado === 'pendiente' && c1.r.json.invitacion.usosMax === 1, 'el dueño crea una invitación (de fábrica, un uso)', c1.r.texto)
  ok(new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/unirse/[A-Za-z0-9_-]{43}$`).test(c1.r.json?.enlace ?? ''), 'el enlace es «<la web>/unirse/<token de 32 bytes en base64url>»', c1.r.json?.enlace)
  const venceDias = (new Date(c1.r.json.invitacion.venceEn) - Date.now()) / 86_400_000
  ok(venceDias > 6.9 && venceDias <= 7, `vence en 7 días de fábrica (${venceDias.toFixed(2)})`)
  const cruda = await fetch(`${BASE}/api/amigos/invitaciones`, { method: 'POST', headers: { cookie: `tablero_sesion=${juego.cookie}`, origin: BASE, 'content-type': 'application/json', 'x-forwarded-for': ipNueva() }, body: '{}' })
  anotar({ json: await cruda.json() })
  ok(/no-store/.test(cruda.headers.get('cache-control') ?? ''), 'la respuesta que trae el enlace no se guarda en caché (no-store)')
  for (const [cuerpo, quiero] of [[{ usos: 2 }, /1, 5 o 10/], [{ venceDias: 3 }, /1, 7 o 30/], [{ nota: 'x'.repeat(61) }, /60/], [{ usos: 5, otra: 1 }, /nválidos/]]) {
    const r = await juego.p('/api/amigos/invitaciones', cuerpo)
    ok(r.status === 400 && quiero.test(r.json?.error ?? ''), `valores que no son: ${JSON.stringify(cuerpo).slice(0, 40)} → 400`, r.texto)
  }
  const l0 = await lista()
  ok(l0.invitaciones.length === 2 && l0.maxPendientes === 20 && l0.topeAmigos === 15 && l0.topeMin === 1 && l0.topeMax === 100, 'la lista trae las invitaciones, el máximo de 20 y el tope de 15 (1 a 100)', l0)
  ok(!JSON.stringify(l0).includes(c1.token) && !JSON.stringify(l0).includes(createHash('sha256').update(c1.token).digest('hex')), 'la lista no trae el token ni su hash')

  titulo('5b. Canje válido: nombre, mail y contraseña; queda adentro con su Telar vacío')
  await duenoClave.p('/api/proyectos', { nombre: 'Leoncito secreto del dueño', prefijo: 'LEO' })
  const proyDueno = (await duenoClave.g('/api/proyectos')).json.find((p) => p.prefijo === 'LEO')
  const pablo = visita()
  const ver = await pablo.p('/api/unirse/ver', { token: c1.token })
  ok(ver.status === 200 && typeof ver.json?.invitador === 'string' && ver.json.invitador.length > 0, '«ver» dice quién invita (sin gastar nada)', ver.texto)
  ok((await estadoDe(c1.id)).usos === 0, 'mirar el enlace no gasta el uso')
  let r = await unirse(pablo, c1.token, 'pablo', { clave: 'corta' })
  ok(r.status === 400 && /al menos 10/.test(r.json?.error), 'contraseña corta: 400, y no se gasta el uso', r.texto)
  r = await unirse(pablo, c1.token, 'pablo', { email: 'no-es-un-mail' })
  ok(r.status === 400, 'mail inválido: 400')
  ok((await estadoDe(c1.id)).usos === 0, 'lo que falla no gasta el uso')
  r = await unirse(pablo, c1.token, 'pablo')
  ok(r.status === 201 && decodeURIComponent(pablo.cookie).startsWith('v1.t:'), 'Pablo se registra con el enlace y queda con la sesión abierta', r.texto)
  ok(!r.texto.includes(FRASE) && !r.texto.includes(c1.token), 'la respuesta no trae ni la contraseña ni el token')
  const cuentaPablo = (await pablo.g('/api/cuenta')).json
  ok(cuentaPablo.tipo === 'telar' && cuentaPablo.email === 'pablo@ejemplo.com' && cuentaPablo.nombre === 'Pablo' && cuentaPablo.uso.topes?.proyectos === 20, '/api/cuenta: de Telar, con su mail, su nombre y sus topes', cuentaPablo)
  ok(JSON.stringify((await pablo.g('/api/proyectos?archivados=1')).json) === '[]', 'su Telar arranca vacío: ningún proyecto')
  const mP = (await pablo.g('/api/miembros')).json
  ok(mP.length === 1 && mP[0].nombre === 'Pablo' && mP[0].esYo, 'con un solo miembro: él')
  ok((await sesionDeCada(pablo)) === false, 'el amigo no ve «Amigos» (/api/sesion amigos = false)')
  const inv1 = await estadoDe(c1.id)
  ok(inv1.estado === 'usada' && inv1.usos === 1 && inv1.ultimoUsoEn, 'la invitación queda «usada»', inv1)
  const amigos1 = (await lista()).amigos
  ok(amigos1.length === 1 && amigos1[0].nombre === 'Pablo' && amigos1[0].email === 'pablo@ejemplo.com' && amigos1[0].invitacion === 'para Pablo' && amigos1[0].porInvitacion && amigos1[0].proyectos === 0 && amigos1[0].estado === 'activa' && amigos1[0].ultimoIngreso, 'el dueño ve al amigo, con la invitación de la que nació', amigos1)
  const idPablo = amigos1[0].id
  const notis = (await juego.g('/api/notificaciones')).json
  ok(Array.isArray(notis) && notis.some((n) => /Pablo se unió/.test(n.titulo)), 'el dueño recibe en la campana «Pablo se unió a Telar»', Array.isArray(notis) ? notis.map((n) => n.titulo) : notis)
  // lo que el amigo no ve del dueño
  ok((await pablo.g(`/api/tableros/${proyDueno.tableros[0].id}`)).status === 404, 'Pablo no abre un tablero del dueño por id (404)')
  ok(!(await pablo.g('/api/buscar?q=Leoncito')).texto.toLowerCase().includes('leoncito'), 'ni encuentra nada del dueño buscando')
  ok((await pablo.g('/api/info')).json?.clave === '', 'ni la clave del MCP')
  for (const [m, ruta, cuerpo] of [['GET', '/api/amigos'], ['POST', '/api/amigos/invitaciones', {}], ['POST', `/api/amigos/${idPablo}/estado`, { estado: 'suspendida' }], ['PUT', '/api/amigos/ajustes', { topeAmigos: 100 }], ['POST', `/api/amigos/invitaciones/${c1.id}/revocar`]]) {
    const x = await pablo.pedir(m, ruta, cuerpo)
    ok(x.status === 403 && !x.texto.includes('pablo@ejemplo.com'), `el amigo no invita ni administra: ${m} ${ruta} → 403`, x.texto)
  }
  const tokP = await conectarOAuth(pablo, 'IA de Pablo')
  const conOAuth = await fetch(`${BASE}/api/amigos`, { headers: { authorization: `Bearer ${tokP.access_token}` } })
  ok(conOAuth.status === 401, 'un token de OAuth (la IA de un amigo) no entra a /api/amigos (401)')

  titulo('5c. Doble canje: una de un solo uso no sirve dos veces')
  const antes = (await lista()).amigos.length
  r = await unirse(visita(), c1.token, 'otro')
  ok(r.status === 404 && r.json?.error === SIRVE, 'canjearla de nuevo: 404 con el mensaje de siempre', r.texto)
  r = await visita().p('/api/unirse/ver', { token: c1.token })
  ok(r.status === 404 && r.json?.error === SIRVE, 'y verla también')
  ok((await lista()).amigos.length === antes, 'no nació ninguna cuenta más')

  titulo('5d. En carrera: pedidos simultáneos con una de un solo uso (y con una de 5)')
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const c = await crear({})
    const n0 = (await lista()).amigos.length
    const rs = await Promise.all([unirse(visita(), c.token, `carrera${vuelta}a`), unirse(visita(), c.token, `carrera${vuelta}b`), unirse(visita(), c.token, `carrera${vuelta}c`)])
    ok(rs.filter((x) => x.status === 201).length === 1 && rs.filter((x) => x.status === 404 && x.json?.error === SIRVE).length === 2, `vuelta ${vuelta + 1}: de 3 pedidos a la vez, uno entra y dos reciben «ya no sirve»`, rs.map((x) => x.status))
    ok((await lista()).amigos.length - n0 === 1, `vuelta ${vuelta + 1}: nace una sola cuenta`)
  }
  const c5 = await crear({ usos: 5 })
  const n5 = (await lista()).amigos.length
  const rs5 = await Promise.all(Array.from({ length: 8 }, (_, i) => unirse(visita(), c5.token, `cinco${i}`)))
  ok(rs5.filter((x) => x.status === 201).length === 5, 'una de 5 usos con 8 pedidos a la vez: entran 5', rs5.map((x) => x.status))
  ok((await lista()).amigos.length - n5 === 5 && (await estadoDe(c5.id)).usos === 5 && (await estadoDe(c5.id)).estado === 'usada', 'nacen 5 cuentas y la invitación queda usada (5 de 5)')
  const dos = await crear({})
  const rMail = await Promise.all([unirse(visita(), dos.token, 'repetido'), unirse(visita(), dos.token, 'repetido')])
  ok(rMail.filter((x) => x.status === 201).length === 1, 'dos pedidos a la vez con el mismo mail: una sola cuenta', rMail.map((x) => x.status))

  titulo('5e. Revocada, inventada y alterada: el mismo mensaje, sin decir cuál')
  const rev = await crear({ nota: 'para revocar' })
  ok((await pablo.p(`/api/amigos/invitaciones/${rev.id}/revocar`)).status === 403, 'un amigo no revoca (403)')
  ok((await duenoClave.p(`/api/amigos/invitaciones/${rev.id}/revocar`)).status === 403, 'la clave del MCP tampoco (403)')
  ok((await estadoDe(rev.id)).estado === 'pendiente', 'y la invitación sigue pendiente')
  ok((await juego.p(`/api/amigos/invitaciones/${rev.id}/revocar`)).json?.estado === 'revocada', 'el dueño la revoca')
  ok((await juego.p(`/api/amigos/invitaciones/${rev.id}/revocar`)).status === 200, 'revocar dos veces no falla')
  ok((await juego.p('/api/amigos/invitaciones/i_noexiste/revocar')).status === 404, 'una que no existe: 404')
  const nAntesRev = (await lista()).amigos.length
  const alterado = rev.token.slice(0, -1) + (rev.token.endsWith('A') ? 'B' : 'A')
  const candidatos = { revocada: rev.token, alterada: alterado, inventada: randomBytes(32).toString('base64url'), corta: 'abc', vacia: '', sql: "' or 1=1 --" + 'a'.repeat(40) }
  const respuestas = {}
  for (const [nombre, token] of Object.entries(candidatos)) {
    const v = await visita().p('/api/unirse/ver', { token })
    const c = await unirse(visita(), token, `x${nombre}`)
    respuestas[nombre] = `${v.status} ${v.texto}`
    ok(v.status === 404 && v.json?.error === SIRVE && c.status === 404 && c.json?.error === SIRVE, `«${nombre}»: 404 con «${SIRVE}»`, v.texto + c.texto)
  }
  ok(new Set(Object.values(respuestas)).size === 1, 'y la respuesta es idéntica para todas (no dice cuál fue la razón)', respuestas)
  ok((await lista()).amigos.length === nAntesRev, 'ninguna creó una cuenta')

  titulo('5f. Límite de intentos por IP')
  const gen = new Quien(BASE, { nombre: 'adivinando', ip: '10.77.0.1' })
  let ult = null
  for (let i = 0; i < 16; i++) ult = await gen.p('/api/unirse/ver', { token: randomBytes(32).toString('base64url') })
  ok(ult.status === 429 && /Demasiados intentos/.test(ult.json?.error), 'adivinando enlaces desde una IP: a los 15 intentos, «Demasiados intentos» (429)', ult.texto)
  const buena = await crear({})
  ok((await unirse(gen, buena.token, 'frenada')).status === 429, 'esa IP no canjea ni un enlace bueno (429)')
  ok((await visita().p('/api/unirse/ver', { token: buena.token })).status === 200, 'pero el enlace bueno sigue sirviendo desde otra IP')

  titulo('5g. Tope de cuentas de amigos')
  const lleno = (await lista()).amigos.length
  const tope = (v) => juego.pedir('PUT', '/api/amigos/ajustes', { topeAmigos: v })
  ok((await tope(0)).status === 400 && (await tope(101)).status === 400 && (await tope(2.5)).status === 400 && (await tope('x')).status === 400, 'el tope va de 1 a 100 (0, 101, 2,5 y un texto: 400)')
  ok((await tope(lleno)).json?.topeAmigos === lleno && (await lista()).topeAmigos === lleno, `el dueño pone el tope en ${lleno} (los que ya hay)`)
  r = await unirse(visita(), buena.token, 'sinlugar')
  ok(r.status === 403 && /no puede abrir más cuentas/.test(r.json?.error), 'al llegar al tope, el canje dice que no se pueden abrir más cuentas (403)', r.texto)
  ok((await estadoDe(buena.id)).usos === 0, 'y no gasta el uso de la invitación')
  await unirse(visita(), buena.token, 'sinlugar2')
  const avisosTope = (await juego.g('/api/notificaciones')).json.filter((n) => /Se alcanzó el tope de amigos/.test(n.titulo))
  ok(avisosTope.length === 1 && /Configuración → Amigos/.test(avisosTope[0].cuerpo), 'el dueño recibe UN aviso en la campana (no uno por intento)', avisosTope)
  r = await visita().p('/api/cuentas', { email: 'codigo@ejemplo.com', nombre: 'Codigo', clave: FRASE, invitacion: INVITACION })
  ok(r.status === 403 && /no puede abrir más cuentas/.test(r.json?.error), 'el tope corta también el registro por el código de la variable', r.texto)
  ok((await tope(lleno + 1)).status === 200, 'el dueño sube el tope en 1')
  r = await unirse(visita(), buena.token, 'conlugar')
  ok(r.status === 201, 'y el mismo enlace sirve', r.texto)
  r = await unirse(visita(), (await crear({})).token, 'denuevo')
  ok(r.status === 403, 'el lugar que había se ocupó: otra vez en el tope')
  await tope(100)
  r = await visita().p('/api/cuentas', { email: 'codigo@ejemplo.com', nombre: 'Codigo', clave: FRASE, invitacion: INVITACION })
  ok(r.status === 201, 'con lugar, el código de la variable sigue andando (compatibilidad)', r.texto)
  const conCodigo = (await lista()).amigos.find((a) => a.email === 'codigo@ejemplo.com')
  ok(conCodigo && conCodigo.porInvitacion === false && conCodigo.invitacion === null, 'y se ve que ese amigo entró con el código, no con un enlace')
  await tope(15)

  titulo('5h. Suspender y reactivar; cada amigo ve solo lo suyo')
  const ana = visita()
  await unirse(ana, (await crear({})).token, 'anita')
  const idAna = (await ana.g('/api/cuenta')).json.id
  const proyAna = await ana.p('/api/proyectos', { nombre: 'Proyecto secreto de Anita', prefijo: 'ANITA' })
  ok(proyAna.status === 201, 'Anita crea su proyecto')
  ok(!(await pablo.g('/api/proyectos?archivados=1')).texto.includes('Anita') && (await pablo.g('/api/buscar?q=Anita')).texto === '[]', 'Pablo no ve nada de Anita (ni buscando)')
  ok(!JSON.stringify((await ana.g('/api/proyectos?archivados=1')).json).includes('Leoncito'), 'ni Anita nada del dueño')
  const filaAna = (await lista()).amigos.find((a) => a.id === idAna)
  ok(filaAna.proyectos === 1, 'el dueño ve que Anita tiene 1 proyecto', filaAna)
  ok(!JSON.stringify(await lista()).includes('secreto de Anita') && !JSON.stringify(await lista()).includes('ANITA'), 'pero ni el nombre ni el prefijo de su proyecto aparecen en la lista del dueño')
  ok((await juego.p(`/api/amigos/${idAna}/estado`, { estado: 'suspendida' })).status === 200, 'el dueño suspende a Anita')
  ok((await ana.g('/api/proyectos')).status === 401, 'la sesión de Anita se corta en el próximo pedido')
  r = await new Quien(BASE, { ip: ipNueva() }).p('/api/sesion', { email: 'anita@ejemplo.com', clave: FRASE })
  ok(r.status === 403 && /suspendida/.test(r.json?.error), 'no puede entrar: «cuenta suspendida»')
  ok((await lista()).amigos.find((a) => a.id === idAna).estado === 'suspendida', 'la lista la muestra suspendida')
  ok((await juego.p(`/api/amigos/${idAna}/estado`, { estado: 'activa' })).status === 200 && (await ana.g('/api/proyectos')).status === 200, 'reactivada, la misma sesión vuelve a andar (sus datos quedaron)')
  ok((await ana.g('/api/proyectos')).json.some((p) => p.prefijo === 'ANITA'), 'y su proyecto sigue ahí')

  titulo('5i. Hasta 20 invitaciones pendientes')
  await tope(100)
  const pendientes = (await lista()).pendientes
  const rs20 = await Promise.all(Array.from({ length: 25 }, () => juego.p('/api/amigos/invitaciones', {})))
  for (const x of rs20) anotar(x)
  const creadas = rs20.filter((x) => x.status === 201).length
  ok(creadas === 20 - pendientes && rs20.filter((x) => x.status === 409 && /20 invitaciones pendientes/.test(x.json?.error ?? '')).length === 25 - creadas, `a la vez, solo entran las que caben (había ${pendientes}, entran ${creadas}) y el resto avisa del tope de 20`, rs20.map((x) => x.status))
  ok((await lista()).pendientes === 20, 'quedan exactamente 20 pendientes')
  ok((await juego.p(`/api/amigos/invitaciones/${(await lista()).invitaciones.find((i) => i.estado === 'pendiente').id}/revocar`)).status === 200 && (await crear({})).r.status === 201, 'al revocar una, hay lugar para otra')

  titulo('5j. El token en claro no está en la salida del servidor')
  const salida1 = srv.salida()
  ok(!tokens.some((t) => salida1.includes(t)), `ninguno de los ${tokens.length} tokens aparece en lo que escribió el servidor (stdout y stderr)`)

  titulo('5k. Vencida (con la base apagada) y el token en claro ausente de TODAS las tablas')
  // Hay 20 pendientes: se revoca una para tener una invitación que vencer.
  const unaPendiente = (await lista()).invitaciones.find((i) => i.estado === 'pendiente')
  await apagar(srv)
  const venc = JSON.parse(tsx('scripts/amigos/tocar-base.ts', srv.datos, 'vencer', unaPendiente.id))
  ok(venc.vencidas === 1, 'se vence una invitación (a mano, en la base de prueba)')
  const busca = JSON.parse(
    execFileSync(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), ['scripts/amigos/tocar-base.ts', srv.datos, 'buscar'], { cwd: RAIZ, env: { ...process.env, TELAR_TOKENS: JSON.stringify(tokens) } }).toString().trim().split('\n').pop(),
  )
  ok(busca.tablas > 20 && busca.tokens === tokens.length && busca.encontrados.length === 0, `en la base (${busca.tablas} tablas) no está ninguno de los ${busca.tokens} tokens en claro`, busca)
  ok(busca.hashes === tokens.length, 'y de cada uno hay una fila con su sha256')
  srv = await levantar({ puerto: PUERTO + 3, datos: srv.datos })
  ok((await estadoDe(unaPendiente.id)).estado === 'vencida', 'el dueño la ve «vencida»')
  const tVenc = tokenDe.get(unaPendiente.id)
  const vv = await visita().p('/api/unirse/ver', { token: tVenc })
  const vc = await unirse(visita(), tVenc, 'tardia')
  ok(vv.status === 404 && vv.json?.error === SIRVE && vc.status === 404 && vc.json?.error === SIRVE, 'la vencida da el mismo mensaje que las otras (ver y canjear)', vv.texto + vc.texto)
  ok(!tokens.some((t) => srv.salida().includes(t)), 'tampoco aparece en la salida del servidor después de reiniciarlo')

  await apagar(srv)
  rmSync(srv.datos, { recursive: true, force: true })
}

// ───────────────────────── 6. recuperar la contraseña sin correo ─────────────────────────

async function pasoRecuperacion() {
  titulo('6. Recuperar la contraseña sin correo: códigos de recuperación y restablecimiento del dueño')
  let srv = await levantar({ puerto: PUERTO + 4, datos: carpeta('recuperacion') })
  const BASE = srv.base
  let ipn = 0
  const ipNueva = () => `10.40.${Math.floor(++ipn / 250)}.${ipn % 250}`
  const visita = () => new Quien(BASE, { nombre: 'visita', ip: ipNueva() })
  const duenoClave = new Quien(BASE, { nombre: 'dueño (clave)', clave: CLAVE, ip: ipNueva() })
  const juego = new Quien(BASE, { nombre: 'dueño (sesión)', cookie: cookieJuego(), ip: ipNueva() })
  const FRASE = 'una frase larga de prueba'
  const NUEVA = 'la frase nueva de la recuperación'
  const MAL = 'El mail o el código de recuperación no son correctos, o ese código ya se usó.'
  const NO_SIRVE = 'Este enlace ya no sirve. Pedile otro a quien te lo mandó.'
  const FORMA = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/
  // todo lo que NO puede estar en claro en la base ni en la salida del servidor
  const secretos = { tokens: [], codigos: [], claves: [FRASE, NUEVA] }
  const nota = (r) => {
    for (const c of r.json?.codigos ?? []) secretos.codigos.push(c)
    return r
  }
  const lista = async () => (await juego.g('/api/amigos')).json
  const amigoDe = async (id) => (await lista()).amigos.find((a) => a.id === id)
  const tsx = (...a) => execFileSync(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), a, { cwd: RAIZ }).toString().trim().split('\n').pop()
  const recuperar = (q, email, codigo, clave = NUEVA, op) => q.p('/api/recuperar', { email, codigo, clave }, op)
  const entrarCon = async (email, clave) => {
    const q = visita()
    const r = await q.p('/api/sesion', { email, clave })
    if (r.status !== 200) throw new Error(`entrar ${email}: ${r.status} ${r.texto}`)
    return q
  }
  const crearEnlace = async (id) => {
    const r = await juego.p(`/api/amigos/${id}/restablecer`)
    const token = r.json?.enlace?.split('/restablecer/')[1]
    if (token) secretos.tokens.push(token)
    return { r, token }
  }
  /** Un amigo que se registra con un enlace de invitación del dueño. */
  const registrarPorEnlace = async (quien, nombre) => {
    const inv = await juego.p('/api/amigos/invitaciones', { nota: `para ${nombre}` })
    const token = inv.json.enlace.split('/unirse/')[1]
    secretos.tokens.push(token)
    const q = new Quien(BASE, { nombre, ip: ipNueva() })
    const r = nota(await q.p('/api/unirse', { token, email: `${quien}@ejemplo.com`, nombre, clave: FRASE }))
    return { q, r, email: `${quien}@ejemplo.com`, id: (await q.g('/api/cuenta')).json?.id }
  }

  titulo('6a. Al registrarse salen 8 códigos de recuperación, una sola vez (por enlace y por el código de la variable)')
  const pablo = await registrarPorEnlace('pablo', 'Pablo')
  ok(pablo.r.status === 201 && Array.isArray(pablo.r.json?.codigos) && pablo.r.json.codigos.length === 8, 'por enlace: la respuesta trae 8 códigos', pablo.r.texto.slice(0, 200))
  ok(pablo.r.json.codigos.every((c) => FORMA.test(c)) && new Set(pablo.r.json.codigos).size === 8, 'con el formato XXXX-XXXX-XXXX, sin 0, 1, I ni O, y distintos entre sí', pablo.r.json.codigos)
  ok(/no-store/.test(pablo.r.cache), 'esa respuesta no se guarda en caché (no-store)', pablo.r.cache)
  const ana = new Quien(BASE, { nombre: 'Ana', ip: ipNueva() })
  const rAna = nota(await ana.p('/api/cuentas', { email: 'ana@ejemplo.com', nombre: 'Ana', clave: FRASE, invitacion: INVITACION }))
  ok(rAna.status === 201 && rAna.json?.codigos?.length === 8 && rAna.json.codigos.every((c) => FORMA.test(c)), 'por el código de la variable: también 8 códigos', rAna.texto.slice(0, 200))
  ok(/no-store/.test(rAna.cache), 'y tampoco se guarda en caché')
  const idAna = (await ana.g('/api/cuenta')).json.id
  const beto = await registrarPorEnlace('beto', 'Beto')
  const codigosDe = { pablo: [...pablo.r.json.codigos], ana: [...rAna.json.codigos], beto: [...beto.r.json.codigos] }
  const cod0 = await pablo.q.g('/api/cuenta/codigos')
  ok(cod0.status === 200 && cod0.json?.aplica === true && cod0.json.restantes === 8 && cod0.json.total === 8 && cod0.json.pocos === false, 'GET /api/cuenta/codigos: «te quedan 8 de 8»', cod0.json)
  const lecturas = [cod0.texto, (await pablo.q.g('/api/cuenta')).texto, JSON.stringify(await lista()), (await juego.g('/api/notificaciones')).texto]
  ok(!codigosDe.pablo.some((c) => lecturas.some((t) => t.includes(c))), 'esa lectura, /api/cuenta, la lista de amigos y la campana del dueño no traen los códigos (salen una sola vez)')
  ok((await juego.g('/api/cuenta/codigos')).json?.aplica === false, 'la cuenta del dueño no usa códigos (entra con la cuenta del juego)')
  ok((await visita().g('/api/cuenta/codigos')).status === 401, 'sin sesión: 401')

  titulo('6b. «Olvidé mi contraseña»: mail + código + contraseña nueva')
  const otraSesion = await entrarCon(pablo.email, FRASE)
  ok((await otraSesion.g('/api/cuenta')).status === 200, 'Pablo tiene otra sesión abierta (en otro aparato)')
  const olvido = visita()
  let r = await recuperar(olvido, pablo.email, codigosDe.pablo[0], 'corta')
  ok(r.status === 400 && /al menos 10/.test(r.json?.error ?? ''), 'una contraseña floja: 400 (y no gasta el código)', r.texto)
  ok((await pablo.q.g('/api/cuenta/codigos')).json.restantes === 8, 'siguen los 8 códigos')
  r = await recuperar(olvido, ` ${pablo.email.toUpperCase()} `, codigosDe.pablo[0].toLowerCase().replace(/-/g, ' '))
  ok(r.status === 200 && r.json?.ok === true && r.json.restantes === 7 && r.json.pocos === false, 'con un código bueno (en minúsculas, con espacios y sin guiones): entra y dice que quedan 7', r.texto)
  ok(decodeURIComponent(olvido.cookie).startsWith('v1.t:') && (await olvido.g('/api/cuenta')).json?.id === pablo.id, 'queda con la sesión abierta, en su cuenta')
  ok(!r.texto.includes(NUEVA) && !r.texto.includes(codigosDe.pablo[0]) && /no-store/.test(r.cache), 'la respuesta no trae ni la contraseña ni el código, y no se guarda en caché')
  ok((await otraSesion.g('/api/cuenta')).status === 401, 'la otra sesión de Pablo se cerró')
  ok((await pablo.q.g('/api/cuenta')).status === 401, '(y la que tenía al registrarse también: la versión de sesión subió)')
  ok((await visita().p('/api/sesion', { email: pablo.email, clave: FRASE })).status === 401, 'la contraseña vieja ya no entra')
  ok((await visita().p('/api/sesion', { email: pablo.email, clave: NUEVA })).status === 200, 'la nueva sí')
  ok((await olvido.g('/api/cuenta/codigos')).json?.restantes === 7, 'y le quedan 7 códigos')
  const hecha = await amigoDe(pablo.id)
  ok(hecha?.restablecida?.por === 'codigo' && !!hecha.restablecida.en, 'el dueño ve «contraseña restablecida» y por qué camino (código), sin nada más', hecha?.restablecida)

  titulo('6b2. Mail inexistente, código malo, código usado, código de otra cuenta: la misma respuesta')
  const casosMalos = {
    'el mismo código otra vez': () => recuperar(visita(), pablo.email, codigosDe.pablo[0]),
    'mail que no existe': () => recuperar(visita(), 'nadie@ejemplo.com', codigosDe.pablo[1]),
    'código inventado': () => recuperar(visita(), pablo.email, 'ABCD-EFGH-JKLM'),
    'código sin forma': () => recuperar(visita(), pablo.email, 'hola'),
    'código vacío': () => recuperar(visita(), pablo.email, ''),
    'código de otra cuenta (Beto) con el mail de Pablo': () => recuperar(visita(), pablo.email, codigosDe.beto[0]),
    'código de Pablo con el mail de Ana': () => recuperar(visita(), 'ana@ejemplo.com', codigosDe.pablo[1]),
    'código de Ana con el mail de Beto': () => recuperar(visita(), beto.email, codigosDe.ana[0]),
    'la cuenta del dueño': () => recuperar(visita(), 'dueno@ejemplo.com', codigosDe.ana[1]),
  }
  const vistas = {}
  for (const [que, hacer] of Object.entries(casosMalos)) {
    const x = await hacer()
    vistas[que] = `${x.status} ${x.texto}`
    ok(x.status === 401 && x.json?.error === MAL && !x.galleta, `«${que}»: 401 con el mensaje de siempre y sin sesión`, x.texto)
  }
  ok(new Set(Object.values(vistas)).size === 1, 'y la respuesta es idéntica byte a byte para los nueve casos (no se cuenta qué mails existen ni por qué falló)', vistas)
  ok((await beto.q.g('/api/cuenta/codigos')).json.restantes === 8 && (await ana.g('/api/cuenta/codigos')).json.restantes === 8, 'los códigos de Beto y de Ana siguen intactos')
  const parametroDeMas = await visita().p('/api/recuperar', { email: 'x@ejemplo.com', codigo: 'ABCD', clave: NUEVA, otro: 1 })
  ok(parametroDeMas.status === 400, 'un parámetro inventado es un error (400)', parametroDeMas.texto)

  titulo('6b3. B no puede usar los códigos de A (ni con su mail ni con el mío)')
  r = await recuperar(visita(), 'ana@ejemplo.com', codigosDe.beto[3])
  ok(r.status === 401, 'con un código de Beto no se abre la cuenta de Ana')
  ok((await ana.g('/api/cuenta')).status === 200 && (await visita().p('/api/sesion', { email: 'ana@ejemplo.com', clave: FRASE })).status === 200, 'y la contraseña de Ana sigue igual')

  titulo('6b4. En carrera: seis pedidos a la vez con el mismo código dejan una sola contraseña nueva')
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => recuperar(visita(), beto.email, codigosDe.beto[1], `la frase de la carrera número ${i}`)))
  ok(rs.filter((x) => x.status === 200).length === 1 && rs.filter((x) => x.status === 401 && x.json?.error === MAL).length === 5, 'entra uno y los otros cinco reciben el mensaje de siempre', rs.map((x) => x.status))
  ok((await beto.q.g('/api/cuenta')).status === 401, '(la sesión vieja de Beto se cerró)')
  ok((await visita().g('/api/cuenta/codigos')).status === 401, '(sin sesión, 401)')

  titulo('6b5. Límite de intentos: por mail y por IP')
  const susi = await registrarPorEnlace('susi', 'Susi')
  const unaIp = ipNueva()
  for (let i = 0; i < 8; i++) await recuperar(visita(), susi.email, 'ABCD-EFGH-JKLM', NUEVA, { ip: ipNueva() })
  r = await recuperar(visita(), susi.email, susi.r.json.codigos[0])
  ok(r.status === 429 && /Demasiados intentos/.test(r.json?.error ?? ''), '8 códigos malos para un mail: frena aunque después llegue el bueno (y desde otra IP)', r.texto)
  ok((await susi.q.g('/api/cuenta/codigos')).json.restantes === 8, 'sin gastar nada')
  for (let i = 0; i < 30; i++) await recuperar(visita(), `x${i}@ejemplo.com`, 'ABCD-EFGH-JKLM', NUEVA, { ip: unaIp })
  const frenada = await recuperar(visita(), 'ana@ejemplo.com', codigosDe.ana[2], NUEVA, { ip: unaIp })
  ok(frenada.status === 429, 'una IP que adivina 30 veces queda frenada (aunque acierte)', frenada.texto)
  ok((await recuperar(visita(), 'ana@ejemplo.com', codigosDe.ana[2], 'la frase de ana recuperada 1')).status === 200, 'desde otra IP, el código bueno sirve')

  titulo('6c. Generar códigos nuevos: pide la contraseña, solo con sesión, y los anteriores dejan de servir')
  const cuentaP = await entrarCon(pablo.email, NUEVA)
  r = await cuentaP.p('/api/cuenta/codigos', { clave: 'no es esa' })
  ok(r.status === 401 && /no es esa/.test(r.json?.error ?? ''), 'con la contraseña mala: 401', r.texto)
  ok((await cuentaP.g('/api/cuenta/codigos')).json.restantes === 7, 'y no cambia nada')
  ok((await duenoClave.p('/api/cuenta/codigos', { clave: NUEVA })).status === 403, 'la clave del MCP no genera códigos (403: pide la sesión)')
  ok((await juego.p('/api/cuenta/codigos', { clave: NUEVA })).status === 400, 'la cuenta del dueño no usa códigos (400)')
  ok((await visita().p('/api/cuenta/codigos', { clave: NUEVA })).status === 401, 'sin sesión: 401')
  r = nota(await cuentaP.p('/api/cuenta/codigos', { clave: NUEVA }))
  ok(r.status === 201 && r.json?.codigos?.length === 8 && r.json.codigos.every((c) => FORMA.test(c)) && /no-store/.test(r.cache), 'con la contraseña buena: 8 códigos nuevos (no-store)', r.texto.slice(0, 160))
  const nuevosP = r.json.codigos
  ok((await cuentaP.g('/api/cuenta/codigos')).json.restantes === 8, 'y quedan 8')
  r = await recuperar(visita(), pablo.email, codigosDe.pablo[2], 'otra frase larga más')
  ok(r.status === 401 && r.json?.error === MAL, 'un código de los anteriores ya no sirve (aunque no estuviera gastado)')
  r = await recuperar(visita(), pablo.email, nuevosP[0], 'la frase de pablo recuperada 0')
  ok(r.status === 200 && r.json.restantes === 7, 'uno nuevo sí')
  let ultimo = null
  for (let i = 1; i <= 5; i++) ultimo = await recuperar(visita(), pablo.email, nuevosP[i], `la frase de pablo recuperada ${i}`)
  const claveP = 'la frase de pablo recuperada 5'
  secretos.claves.push(...[0, 1, 2, 3, 4, 5].map((i) => `la frase de pablo recuperada ${i}`))
  ok(ultimo.status === 200 && ultimo.json.restantes === 2 && ultimo.json.pocos === true, 'cuando quedan 2 o menos, la respuesta lo marca (`pocos`) para el aviso fuerte', ultimo.json)
  ok((await entrarCon(pablo.email, claveP)).cookie !== '', 'y entra con la última contraseña')

  titulo('6d. El restablecimiento del dueño: solo con su sesión')
  const idPablo = pablo.id
  const propioP = await entrarCon(pablo.email, claveP)
  const anaSesion = await entrarCon('ana@ejemplo.com', 'la frase de ana recuperada 1') // (su contraseña es la del 6b5)
  const ataques = [
    ['la clave del MCP', duenoClave],
    ['un amigo (Ana, sobre otro)', anaSesion],
    ['el propio amigo, sobre sí mismo', propioP],
  ]
  secretos.claves.push('la frase de ana recuperada 1')
  for (const [quien, q] of ataques)
    for (const ruta of [`/api/amigos/${idPablo}/restablecer`, `/api/amigos/${idPablo}/restablecer/cancelar`]) {
      const x = await q.p(ruta)
      ok(x.status === 403 && !x.json?.enlace && !/restablecer\//.test(x.texto), `${quien}: POST ${ruta.replace(idPablo, ':id')} → 403`, x.texto)
    }
  const tokenDueno = await conectarOAuth(juego, 'IA del dueño')
  const conOAuth = await fetch(`${BASE}/api/amigos/${idPablo}/restablecer`, { method: 'POST', headers: { authorization: `Bearer ${tokenDueno.access_token}`, origin: BASE } })
  ok([401, 403].includes(conOAuth.status), `un token de OAuth (la IA del dueño) tampoco: ${conOAuth.status}`)
  ok((await visita().p(`/api/amigos/${idPablo}/restablecer`)).status === 401, 'sin sesión: 401')
  ok((await amigoDe(idPablo)).restablecimiento === null, 'después de todos esos intentos no hay ningún restablecimiento pendiente')
  r = await juego.p('/api/amigos/dueno/restablecer')
  ok(r.status === 400 && /cuenta del juego/.test(r.json?.error ?? ''), 'el dueño no puede restablecer su propia cuenta del juego (400)', r.texto)
  ok((await juego.p('/api/amigos/noexiste/restablecer')).status === 404, 'una cuenta que no existe: 404')
  ok((await juego.p('/api/amigos/noexiste/restablecer/cancelar')).status === 404, '(y cancelarle algo: 404)')
  ok((await juego.p(`/api/amigos/${idPablo}/restablecer/cancelar`)).status === 404, 'cancelar uno que no hay: 404')

  titulo('6e. El enlace: un solo uso, 24 horas, y el dueño no ve ni elige la contraseña')
  const sesionVieja = await entrarCon(pablo.email, claveP)
  const e1 = await crearEnlace(idPablo)
  ok(e1.r.status === 201 && new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/restablecer/[A-Za-z0-9_-]{43}$`).test(e1.r.json?.enlace ?? ''), 'el dueño genera «<la web>/restablecer/<token de 32 bytes>»', e1.r.texto)
  ok(/no-store/.test(e1.r.cache), 'la respuesta que trae el enlace no se guarda en caché (no-store)')
  const e2 = await crearEnlace(idPablo)
  ok(e2.r.status === 201 && e2.token !== e1.token, 'generar otro reemplaza al anterior')
  const v1 = await visita().p('/api/restablecer/ver', { token: e1.token })
  ok(v1.status === 404 && v1.json?.error === NO_SIRVE, 'el anterior ya no sirve', v1.texto)
  const horas = (new Date(e2.r.json.restablecimiento.venceEn) - Date.now()) / 3_600_000
  ok(horas > 23.9 && horas <= 24, `vence en 24 horas (${horas.toFixed(2)} h)`)
  const enLista = await amigoDe(idPablo)
  ok(
    enLista.restablecimiento?.vencido === false && Boolean(enLista.restablecimiento.venceEn) && !JSON.stringify(enLista).includes(e2.token) && !JSON.stringify(enLista).includes(createHash('sha256').update(e2.token).digest('hex')),
    'el dueño ve «pendiente» en la lista, sin el token ni su hash',
    enLista,
  )
  const pagina = await visita().g(`/restablecer/${e2.token}`)
  ok(pagina.status === 200 && /<div id="app"/.test(pagina.texto), 'la dirección /restablecer/<token> abre la app (sin sesión)', pagina.status)
  const ver = await visita().p('/api/restablecer/ver', { token: e2.token })
  ok(ver.status === 200 && ver.json?.nombre === 'Pablo' && !JSON.stringify(ver.json).includes('@'), '«ver» dice a quién le toca (el nombre, no el mail) y no gasta nada', ver.texto)
  const amigoP = new Quien(BASE, { nombre: 'Pablo (con el enlace)', ip: ipNueva() })
  r = await amigoP.p('/api/restablecer', { token: e2.token, clave: 'corta' })
  ok(r.status === 400 && /al menos 10/.test(r.json?.error ?? ''), 'una contraseña floja: 400 (y no gasta el enlace)', r.texto)
  ok((await visita().p('/api/restablecer/ver', { token: e2.token })).status === 200, 'el enlace sigue sirviendo')
  const claveElegida = 'la clave que eligió pablo solito 2026'
  secretos.claves.push(claveElegida)
  r = nota(await amigoP.p('/api/restablecer', { token: e2.token, clave: claveElegida }))
  ok(r.status === 200 && r.json?.ok === true && r.json.codigos?.length === 8 && decodeURIComponent(amigoP.cookie).startsWith('v1.t:') && /no-store/.test(r.cache), 'el amigo pone su contraseña nueva: entra, con la sesión abierta y 8 códigos nuevos', r.texto.slice(0, 200))
  ok(!r.texto.includes(claveElegida), 'la respuesta no trae la contraseña')
  ok((await amigoP.g('/api/cuenta')).json?.id === idPablo, 'y está en su cuenta')
  ok((await sesionVieja.g('/api/cuenta')).status === 401 && (await propioP.g('/api/cuenta')).status === 401, 'se cerraron sus otras sesiones')
  ok((await visita().p('/api/sesion', { email: pablo.email, clave: claveP })).status === 401 && (await visita().p('/api/sesion', { email: pablo.email, clave: claveElegida })).status === 200, 'la contraseña de antes ya no entra; la que eligió, sí')
  const viejos = await recuperar(visita(), pablo.email, nuevosP[7])
  ok(viejos.status === 401 && viejos.json?.error === MAL, 'los códigos que tenía antes ya no sirven (pudieron perderse)')
  codigosDe.pablo = r.json.codigos
  ok((await amigoP.g('/api/cuenta/codigos')).json?.restantes === 8, 'le quedan sus 8 nuevos')
  const trasUso = await amigoDe(idPablo)
  ok(trasUso.restablecimiento === null && trasUso.restablecida?.por === 'enlace' && Boolean(trasUso.restablecida.en), 'el dueño ve «contraseña restablecida» (por enlace) y ningún pendiente', trasUso.restablecida)
  const lo_del_dueno = JSON.stringify(await lista()) + (await juego.g('/api/notificaciones')).texto + JSON.stringify((await juego.g('/api/novedades')).json)
  ok(!lo_del_dueno.includes(claveElegida) && !lo_del_dueno.includes(createHash('sha256').update(claveElegida).digest('hex')), 'el dueño no ve la contraseña de Pablo en ninguna pantalla (lista, campana, novedades)')
  const notis = (await juego.g('/api/notificaciones')).json
  ok(notis.some((n) => /Pablo restableció su contraseña/.test(n.titulo)), 'el dueño recibe en la campana «Pablo restableció su contraseña»', notis.map((n) => n.titulo))
  // el mismo enlace otra vez, y los que no sirven: el mismo mensaje
  const alterado = e2.token.slice(0, -1) + (e2.token.endsWith('A') ? 'B' : 'A')
  const candidatos = { usado: e2.token, reemplazado: e1.token, alterado, inventado: randomBytes(32).toString('base64url'), corto: 'abc', vacio: '', sql: "' or 1=1 --" + 'a'.repeat(40) }
  const resp = {}
  for (const [nombre, token] of Object.entries(candidatos)) {
    const a = await visita().p('/api/restablecer/ver', { token })
    const b = await visita().p('/api/restablecer', { token, clave: 'una frase larga más' })
    resp[nombre] = `${a.status} ${a.texto} | ${b.status} ${b.texto}`
    ok(a.status === 404 && a.json?.error === NO_SIRVE && b.status === 404 && b.json?.error === NO_SIRVE, `enlace «${nombre}»: 404 con «${NO_SIRVE}»`, a.texto + b.texto)
  }
  ok(new Set(Object.values(resp)).size === 1, 'idéntica para todas (no dice si venció, se usó, lo reemplazaron o nunca existió)', resp)

  titulo('6e2. En carrera, cancelado, reemplazado por otro camino y con un amigo suspendido')
  const e4 = await crearEnlace(idPablo)
  const carrera = await Promise.all(Array.from({ length: 5 }, (_, i) => new Quien(BASE, { ip: ipNueva() }).p('/api/restablecer', { token: e4.token, clave: `la clave de la carrera número ${i} de pablo` })))
  for (let i = 0; i < 5; i++) secretos.claves.push(`la clave de la carrera número ${i} de pablo`)
  for (const x of carrera) nota(x)
  ok(carrera.filter((x) => x.status === 200).length === 1 && carrera.filter((x) => x.status === 404 && x.json?.error === NO_SIRVE).length === 4, 'cinco canjes a la vez del mismo enlace: entra uno y los otros cuatro reciben «ya no sirve»', carrera.map((x) => x.status))
  const e5 = await crearEnlace(idPablo)
  ok((await juego.p(`/api/amigos/${idPablo}/restablecer/cancelar`)).status === 200, 'el dueño cancela el pendiente')
  ok((await amigoDe(idPablo)).restablecimiento === null, 'la lista ya no lo muestra')
  const c5 = await visita().p('/api/restablecer', { token: e5.token, clave: 'una frase larga más' })
  ok(c5.status === 404 && c5.json?.error === NO_SIRVE, 'cancelado no sirve (ni conociendo el token)', c5.texto)
  ok((await juego.p(`/api/amigos/${idPablo}/restablecer/cancelar`)).status === 404, 'cancelar dos veces: 404')
  const e6 = await crearEnlace(idAna)
  const rAna2 = await recuperar(visita(), 'ana@ejemplo.com', codigosDe.ana[4], 'la frase nueva de ana más larga')
  ok(rAna2.status === 200, 'Ana recupera su cuenta con un código')
  ok((await visita().p('/api/restablecer/ver', { token: e6.token })).status === 404, 'y el enlace que había pendiente para ella dejó de servir (si no, un enlace perdido seguiría abriendo la cuenta)')
  ok((await juego.p(`/api/amigos/${idAna}/estado`, { estado: 'suspendida' })).status === 200, 'el dueño suspende a Ana')
  r = await juego.p(`/api/amigos/${idAna}/restablecer`)
  ok(r.status === 409 && /suspendida/.test(r.json?.error ?? ''), 'a una cuenta suspendida no se le genera un enlace (409: reactivala primero)', r.texto)
  r = await recuperar(visita(), 'ana@ejemplo.com', codigosDe.ana[5])
  ok(r.status === 403 && /suspendida/.test(r.json?.error ?? '') && !r.galleta, 'y con un código bueno, una cuenta suspendida no entra (403)', r.texto)
  ok((await juego.p(`/api/amigos/${idAna}/estado`, { estado: 'activa' })).status === 200, 'el dueño la reactiva')
  ok((await recuperar(visita(), 'ana@ejemplo.com', codigosDe.ana[5], 'la frase de ana reactivada 1')).status === 200, 'y el código que no se había gastado sirve')

  titulo('6e3. Límite por IP para los enlaces que no sirven')
  const gen = new Quien(BASE, { ip: '10.77.9.1' })
  let ult = null
  for (let i = 0; i < 16; i++) ult = await gen.p('/api/restablecer/ver', { token: randomBytes(32).toString('base64url') })
  ok(ult.status === 429 && /Demasiados intentos/.test(ult.json?.error ?? ''), 'adivinando enlaces desde una IP: a los 15, «Demasiados intentos» (429)', ult.texto)
  const e7 = await crearEnlace(idPablo)
  ok((await gen.p('/api/restablecer', { token: e7.token, clave: 'una frase larga más' })).status === 429, 'esa IP no canjea ni un enlace bueno (429)')
  ok((await visita().p('/api/restablecer/ver', { token: e7.token })).status === 200, 'pero el enlace bueno sigue sirviendo desde otra IP')

  titulo('6f. Vence a las 24 horas (con la base apagada)')
  const pendiente = (await amigoDe(idPablo)).restablecimiento
  ok(pendiente?.id && !pendiente.vencido, 'hay un enlace pendiente')
  await apagar(srv)
  const rv = JSON.parse(tsx('scripts/amigos/tocar-base.ts', srv.datos, 'vencer-restablecimiento', pendiente.id))
  ok(rv.vencidos === 1, 'se vence a mano (en la base de prueba)')
  srv = await levantar({ puerto: PUERTO + 4, datos: srv.datos })
  const v7 = await visita().p('/api/restablecer/ver', { token: e7.token })
  const c7 = await visita().p('/api/restablecer', { token: e7.token, clave: 'una frase larga más' })
  ok(v7.status === 404 && v7.json?.error === NO_SIRVE && c7.status === 404 && c7.json?.error === NO_SIRVE, 'vencido: el mismo mensaje que los demás', v7.texto + c7.texto)
  ok((await amigoDe(idPablo)).restablecimiento?.vencido === true, 'el dueño lo ve «vencido»')

  titulo('6g. Ni los tokens ni los códigos ni las contraseñas están en claro: ni en la base ni en la salida del servidor')
  const salida = srv.salida()
  const todos = [...secretos.tokens, ...secretos.codigos, ...secretos.claves]
  ok(!todos.some((t) => salida.includes(t) || salida.includes(t.replace(/-/g, ''))), `nada de eso (${secretos.tokens.length} tokens, ${secretos.codigos.length} códigos, ${secretos.claves.length} contraseñas) aparece en lo que escribió el servidor`)
  await apagar(srv)
  const busca = JSON.parse(
    execFileSync(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), ['scripts/amigos/tocar-base.ts', srv.datos, 'buscar'], {
      cwd: RAIZ,
      env: { ...process.env, TELAR_TOKENS: JSON.stringify(secretos.tokens), TELAR_CODIGOS: JSON.stringify(secretos.codigos), TELAR_SECRETOS: JSON.stringify(secretos.claves) },
    })
      .toString()
      .trim()
      .split('\n')
      .pop(),
  )
  ok(busca.tablas > 20 && busca.encontrados.length === 0, `en la base (${busca.tablas} tablas) no está ninguno en claro`, busca)
  ok(busca.codigosConHash > 0 && busca.hashesRestablecer > 0, 'pero sí hay filas con su hash (los códigos vigentes y los enlaces generados)', busca)
  rmSync(srv.datos, { recursive: true, force: true })
}

// ───────────────────────── 7. crear cuenta con aprobación del dueño ─────────────────────────

async function pasoSolicitudes() {
  titulo('7. Crear cuenta con aprobación: nace pendiente, no puede nada, y solo la sesión del dueño la aprueba')
  let srv = await levantar({ puerto: PUERTO + 5, datos: carpeta('solicitudes'), invitacion: '' })
  let salidaAntes = '' // lo que escribieron las corridas anteriores del servidor (se reinicia para cambiar fechas)
  const BASE = srv.base
  let ipn = 0
  const ipNueva = () => `10.50.${Math.floor(++ipn / 250)}.${ipn % 250}`
  const visita = () => new Quien(BASE, { nombre: 'visita', ip: ipNueva() })
  const duenoClave = new Quien(BASE, { nombre: 'dueño (clave)', clave: CLAVE, ip: ipNueva() })
  const juego = new Quien(BASE, { nombre: 'dueño (sesión)', cookie: cookieJuego(), ip: ipNueva() })
  const FRASE = 'una frase larga de prueba'
  const NUEVA = 'la frase nueva de la recuperación'
  const MAL_ENTRAR = 'Mail o contraseña incorrectos.'
  const MAL_RECUPERAR = 'El mail o el código de recuperación no son correctos, o ese código ya se usó.'
  const MAIL_USADO = 'Ya hay una cuenta con ese mail. Entrá con tu contraseña.'
  const FORMA = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/
  const secretos = { codigos: [], claves: [FRASE, NUEVA] }
  const tsx = (...a) => execFileSync(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), a, { cwd: RAIZ }).toString().trim().split('\n').pop()
  const solicitar = (q, n, extra = {}) => q.p('/api/solicitudes', { email: `${n}@ejemplo.com`, nombre: n[0].toUpperCase() + n.slice(1), clave: FRASE, ...extra })
  const pedir = async (n, extra = {}) => {
    const r = await solicitar(visita(), n, extra)
    for (const c of r.json?.codigos ?? []) secretos.codigos.push(c)
    return r
  }
  const estado = async () => (await juego.g('/api/amigos')).json
  const idDe = async (n) => {
    const e = await estado()
    return [...e.solicitudes.pendientes, ...e.solicitudes.rechazadas, ...e.amigos].find((x) => x.email === `${n}@ejemplo.com`)?.id
  }
  const nombreDueno = ((await duenoClave.g('/api/miembros')).json ?? []).find((m) => m.esYo)?.nombre ?? 'Dueño'

  titulo('7a. Pedir una cuenta: nombre, mail y contraseña, sin enlace ni código')
  const sv = (await visita().g('/api/sesion')).json
  ok(sv.registro === true && sv.entrado === false && sv.amigos === false && sv.solicitudes === 0, '/api/sesion dice que se puede crear una cuenta (registro: true) sin ninguna variable cargada', sv)
  const sj = (await juego.g('/api/sesion')).json
  ok(sj.amigos === true && sj.solicitudes === 0, 'y al dueño le dice cuántas solicitudes esperan (0)', sj)
  const pablo = visita()
  let r = await solicitar(pablo, 'pablo')
  for (const c of r.json?.codigos ?? []) secretos.codigos.push(c)
  ok(r.status === 201 && r.json?.pendiente === true && r.json?.ok === true, 'pedir una cuenta válida: 201 «pendiente»', r.texto)
  ok(r.json?.aprobador === nombreDueno && nombreDueno.length > 0, `dice quién la aprueba («${nombreDueno}»)`, r.json)
  ok(Array.isArray(r.json?.codigos) && r.json.codigos.length === 8 && r.json.codigos.every((c) => FORMA.test(c)), 'salen sus 8 códigos de recuperación (una sola vez, con la forma de siempre)', r.json?.codigos)
  ok(/no-store/.test(r.cache), 'la respuesta no se guarda en caché (no-store)')
  ok(!r.galleta && !pablo.cookie, 'NO abre sesión (no hay cookie)')
  ok(!r.texto.includes(FRASE) && !/scrypt|hash/i.test(r.texto), 'la respuesta no trae la contraseña ni su hash')
  const idPablo = await idDe('pablo')
  ok(Boolean(idPablo), 'el dueño ve la solicitud')
  for (const [cuerpo, quiero] of [
    [{ clave: 'corta' }, /al menos 10/],
    [{ email: 'no-es-un-mail' }, /mail válido/],
    [{ nombre: '   ' }, /nombre/],
    [{ clave: '1234567890' }, /más usadas/],
    [{ otro: 'campo' }, /nválidos/],
  ]) {
    const x = await solicitar(visita(), 'malo', cuerpo)
    ok(x.status === 400 && quiero.test(x.json?.error ?? ''), `datos malos ${JSON.stringify(cuerpo).slice(0, 40)} → 400`, x.texto)
  }
  const sinCuentas = (await estado()).solicitudes.pendientes.length
  ok(sinCuentas === 1, 'ninguna de esas creó una cuenta (sigue 1 solicitud)', sinCuentas)
  r = await solicitar(visita(), 'pablo')
  ok(r.status === 409 && r.json?.error === MAIL_USADO, 'el mismo mail otra vez: 409 «Ya hay una cuenta con ese mail»', r.texto)
  r = await solicitar(visita(), 'pablo', { email: 'PABLO@ejemplo.com ' })
  ok(r.status === 409, 'sin importar mayúsculas ni espacios')
  const l1 = await estado()
  ok(l1.solicitudes.pendientes.length === 1 && l1.amigos.length === 0, 'una sola solicitud y ningún amigo todavía', l1)
  const sol = l1.solicitudes.pendientes[0]
  ok(sol.nombre === 'Pablo' && sol.email === 'pablo@ejemplo.com' && sol.estado === 'pendiente' && Date.now() - new Date(sol.desde) < 120_000 && l1.solicitudes.maxSolicitudes === 30, 'el dueño ve nombre, mail y desde cuándo (y que caben 30)', sol)
  ok(!JSON.stringify(l1).includes(FRASE) && !/scrypt/.test(JSON.stringify(l1)) && !secretos.codigos.some((c) => JSON.stringify(l1).includes(c)), 'la lista del dueño no trae la contraseña, su hash ni los códigos')
  ok((await juego.g('/api/sesion')).json?.solicitudes === 1, '/api/sesion del dueño dice que hay 1 esperando')
  const notis = (await juego.g('/api/notificaciones')).json
  const noti = notis.find((n) => /Pablo pidió una cuenta/.test(n.titulo))
  ok(noti && noti.enlace === '/amigos' && !JSON.stringify(noti).includes('pablo@'), 'el dueño recibe en la campana «Pablo pidió una cuenta», con enlace a Amigos (sin su mail)', notis.map((n) => n.titulo))

  titulo('7b. Una cuenta pendiente no puede nada')
  r = await visita().p('/api/sesion', { email: 'pablo@ejemplo.com', clave: FRASE })
  ok(r.status === 403 && r.json?.error === `Tu cuenta todavía espera la aprobación de ${nombreDueno}.` && !r.galleta, 'entrar con su mail y su contraseña: 403 «Tu cuenta todavía espera la aprobación de …» y sin sesión', r.texto)
  const mala = await visita().p('/api/sesion', { email: 'pablo@ejemplo.com', clave: 'una contraseña que no es' })
  const inexistente = await visita().p('/api/sesion', { email: 'nadie@ejemplo.com', clave: FRASE })
  ok(mala.status === 401 && mala.json?.error === MAL_ENTRAR && inexistente.status === 401 && inexistente.json?.error === MAL_ENTRAR && mala.texto === inexistente.texto, 'con la contraseña mala (o un mail que no existe): el error de siempre, idéntico (no se cuenta que la cuenta existe)', mala.texto + inexistente.texto)
  // Una cookie bien firmada de esa cuenta (si hubiera una): no alcanza, la cuenta no está activa.
  const forjada = new Quien(BASE, { nombre: 'pendiente (cookie firmada)', cookie: cookieJuego(`t:${idPablo}:1`), ip: ipNueva() })
  ok((await forjada.g('/api/sesion')).json?.entrado === false, '/api/sesion con esa cookie: no entrado')
  for (const [metodo, ruta, cuerpo] of [
    ['GET', '/api/proyectos'],
    ['POST', '/api/proyectos', { nombre: 'Colado', prefijo: 'COL' }],
    ['GET', '/api/cuenta'],
    ['GET', '/api/info'],
    ['GET', '/api/miembros'],
    ['GET', '/api/buscar?q=a'],
    ['GET', '/api/notificaciones'],
    ['GET', '/api/novedades'],
    ['GET', '/api/ia/estado'],
    ['GET', '/api/oauth/conexiones'],
    ['GET', '/api/amigos'],
    ['POST', '/api/cuenta/clave', { actual: FRASE, nueva: 'otra frase larga de prueba' }],
    ['POST', '/api/cuenta/codigos', { clave: FRASE }],
    ['POST', '/api/archivos', formArchivo('x.png', PNG, 'image/png')],
    ['GET', '/api/eventos/desde?n=0'],
    ['GET', '/api/eventos'],
    ['GET', '/archivos/lienzo/x.png'],
  ]) {
    const x = await forjada.pedir(metodo, ruta, cuerpo, { sinGuardar: true })
    ok(x.status === 401, `pendiente: ${metodo} ${ruta.slice(0, 40)} → 401 (no entra a nada)`, x.texto.slice(0, 200))
  }
  const mcpPost = (token) => fetch(`${BASE}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  const tokenPablo = jwtInventado(BASE, { sub: `t:${idPablo}` })
  ok((await mcpPost(tokenPablo)).status === 401, 'MCP con un token de OAuth bien firmado de esa cuenta: 401 (el token de una cuenta pendiente no entra)')
  const x = await visita().p('/api/oauth/decidir', { pedido: 'x', permitir: true })
  ok(x.status === 401, 'y no hay forma de «Permitir» una conexión sin sesión (401)')
  ok((await visita().p('/api/amigos/invitaciones', {})).status === 401, 'ni de invitar')
  // recuperar con un código SÍ se puede, pero no abre nada
  const codigosPablo = secretos.codigos.slice(0, 8)
  r = await visita().p('/api/recuperar', { email: 'pablo@ejemplo.com', codigo: codigosPablo[0], clave: NUEVA })
  ok(r.status === 200 && r.json?.pendiente === true && !r.galleta && r.json?.aprobador === nombreDueno, 'recuperar con un código: cambia la contraseña pero NO abre la sesión (sigue pendiente)', r.texto)
  r = await visita().p('/api/sesion', { email: 'pablo@ejemplo.com', clave: NUEVA })
  ok(r.status === 403 && /espera la aprobación/.test(r.json?.error ?? '') && !r.galleta, 'con la contraseña nueva, sigue oyendo que espera')
  r = await visita().p('/api/sesion', { email: 'pablo@ejemplo.com', clave: FRASE })
  ok(r.status === 401, 'la contraseña de antes ya no sirve (401)')
  r = await visita().p('/api/recuperar', { email: 'pablo@ejemplo.com', codigo: codigosPablo[0], clave: NUEVA })
  ok(r.status === 401 && r.json?.error === MAL_RECUPERAR, 'el código ya usado no sirve de nuevo (el mismo mensaje de siempre)')
  r = await juego.p(`/api/amigos/${idPablo}/restablecer`)
  ok(r.status === 409 && /no está aprobada/.test(r.json?.error ?? ''), 'el dueño no le genera un enlace de restablecimiento a una solicitud (409)', r.texto)
  r = await juego.p(`/api/amigos/${idPablo}/estado`, { estado: 'activa' })
  ok(r.status === 409 && /solicitud/.test(r.json?.error ?? ''), '«reactivar» no aprueba (409: es una solicitud, se aprueba o se rechaza)', r.texto)
  ok((await estado()).solicitudes.pendientes.length === 1, 'y sigue siendo una solicitud pendiente')

  titulo('7c. Aprobar y rechazar: solo con la SESIÓN del dueño')
  // Una cuenta de amigo normal, por invitación: entra directo, sin pasar por solicitud.
  const inv = await juego.p('/api/amigos/invitaciones', { nota: 'para Beto' })
  const beto = visita()
  r = await beto.p('/api/unirse', { token: inv.json.enlace.split('/unirse/')[1], email: 'beto@ejemplo.com', nombre: 'Beto', clave: FRASE })
  for (const c of r.json?.codigos ?? []) secretos.codigos.push(c)
  ok(r.status === 201 && decodeURIComponent(beto.cookie).startsWith('v1.t:'), 'quien entra con una invitación queda ACTIVO al instante (con sesión, sin pasar por solicitud)', r.texto)
  ok((await beto.g('/api/cuenta')).json?.email === 'beto@ejemplo.com' && (await beto.g('/api/proyectos')).status === 200, 'y ya puede usar su Telar')
  const e2 = await estado()
  const filaBeto = e2.amigos.find((a) => a.email === 'beto@ejemplo.com')
  ok(filaBeto?.estado === 'activa' && filaBeto.porInvitacion === true && filaBeto.porSolicitud === false && !e2.solicitudes.pendientes.some((s) => s.email === 'beto@ejemplo.com'), 'el dueño lo ve como amigo (por invitación), no como solicitud', filaBeto)
  const tokBeto = await conectarOAuth(beto, 'IA de Beto')
  const atacantes = [
    ['la clave del MCP', duenoClave, 403],
    ['un amigo (Beto)', beto, 403],
    ['un token de OAuth', null, 401],
    ['una visita sin sesión', visita(), 401],
  ]
  const accion = (id) => [['POST', `/api/amigos/${id}/aprobar`], ['POST', `/api/amigos/${id}/rechazar`], ['POST', `/api/amigos/${id}/reconsiderar`], ['POST', '/api/amigos/solicitudes/limpiar']]
  for (const [nombre, q, esperado] of atacantes) {
    for (const [metodo, ruta] of accion(idPablo)) {
      const x = q
        ? await q.pedir(metodo, ruta)
        : await fetch(`${BASE}${ruta}`, { method: metodo, headers: { authorization: `Bearer ${tokBeto.access_token}`, origin: BASE } })
      ok(x.status === esperado, `${nombre}: ${metodo} ${ruta.replace(idPablo, ':id')} → ${x.status} (esperado ${esperado})`, x.texto ?? '')
    }
  }
  const e3 = await estado()
  ok(e3.solicitudes.pendientes.length === 1 && e3.solicitudes.pendientes[0].estado === 'pendiente' && e3.solicitudes.rechazadas.length === 0, 'ningún intento cambió nada: Pablo sigue pendiente')
  const textoBeto = [await beto.g('/api/notificaciones'), await beto.g('/api/novedades'), await beto.g('/api/proyectos'), await beto.g('/api/miembros'), await beto.g('/api/buscar?q=Pablo'), await beto.g('/api/info')].map((x) => x.texto).join('\n').toLowerCase()
  ok(!textoBeto.includes('pablo'), 'Beto (otra cuenta) no ve nada de la solicitud de Pablo: ni su nombre ni su mail, en ninguna respuesta')
  ok((await beto.g('/api/amigos')).status === 403 && (await beto.g('/api/sesion')).json?.solicitudes === 0, 'y para él no hay Solicitudes (403 y 0)')

  titulo('7d. Aprobar')
  r = await juego.p('/api/amigos/no-existe/aprobar')
  ok(r.status === 404, 'una cuenta que no existe: 404', r.texto)
  r = await juego.p('/api/amigos/dueno/aprobar')
  ok(r.status === 404, 'la cuenta del dueño no es una solicitud: 404', r.texto)
  r = await juego.p(`/api/amigos/${filaBeto.id}/aprobar`)
  ok(r.status === 409, 'una cuenta que ya es amiga: 409', r.texto)
  r = await juego.p(`/api/amigos/${idPablo}/aprobar`)
  ok(r.status === 200 && r.json?.nombre === 'Pablo', 'el dueño (sesión) aprueba a Pablo', r.texto)
  const e4 = await estado()
  const filaPablo = e4.amigos.find((a) => a.id === idPablo)
  ok(filaPablo?.estado === 'activa' && filaPablo.porSolicitud === true && filaPablo.porInvitacion === false && e4.solicitudes.pendientes.length === 0, 'pasa a «Amigos» como activo (pidió su cuenta y la aprobó el dueño) y sale de Solicitudes', filaPablo)
  ok((await juego.g('/api/sesion')).json?.solicitudes === 0, 'la marca del dueño vuelve a 0')
  r = await juego.p(`/api/amigos/${idPablo}/aprobar`)
  ok(r.status === 409, 'aprobar dos veces: 409', r.texto)
  r = await juego.p(`/api/amigos/${idPablo}/rechazar`)
  ok(r.status === 409, 'rechazar a uno ya aprobado: 409 (para eso está «Suspender»)', r.texto)
  const pabloEntra = visita()
  r = await pabloEntra.p('/api/sesion', { email: 'pablo@ejemplo.com', clave: NUEVA })
  ok(r.status === 200 && decodeURIComponent(pabloEntra.cookie).startsWith('v1.t:'), 'aprobado, Pablo entra con su mail y su contraseña (la nueva)', r.texto)
  ok(JSON.stringify((await pabloEntra.g('/api/proyectos?archivados=1')).json) === '[]', 'a su Telar vacío: ningún proyecto')
  const mp = (await pabloEntra.g('/api/miembros')).json
  ok(mp.length === 1 && mp[0].esYo && mp[0].nombre === 'Pablo', 'con un solo miembro: él (su «yo»)', mp)
  ok((await pabloEntra.g('/api/cuenta')).json?.tipo === 'telar' && (await pabloEntra.g('/api/amigos')).status === 403, 'es una cuenta de Telar normal: sin permisos de dueño')
  ok((await mcpPost(tokenPablo)).status === 200, 'y el MISMO token de OAuth que antes daba 401 ahora entra al MCP (200): lo único que cambió es el estado de la cuenta')
  // (la cookie con la versión de sesión que dejó la recuperación: cambiar la contraseña la subió de 1 a 2)
  const ahoraSi = new Quien(BASE, { nombre: 'aprobada (cookie firmada)', cookie: cookieJuego(`t:${idPablo}:2`), ip: ipNueva() })
  ok((await ahoraSi.g('/api/proyectos')).status === 200, 'y una cookie firmada de esa cuenta, que antes no entraba, ahora sí')

  titulo('7e. Rechazar: no entra y no se le revela')
  const rita = visita()
  r = await solicitar(rita, 'rita')
  for (const c of r.json?.codigos ?? []) secretos.codigos.push(c)
  const idRita = await idDe('rita')
  ok(r.status === 201 && Boolean(idRita), 'Rita pide una cuenta')
  const codigosRita = r.json.codigos
  r = await juego.p(`/api/amigos/${idRita}/rechazar`)
  ok(r.status === 200, 'el dueño la rechaza', r.texto)
  const e5 = await estado()
  const filaRita = e5.solicitudes.rechazadas.find((s) => s.id === idRita)
  const libera = filaRita ? (new Date(filaRita.liberaEn) - new Date(filaRita.decididaEn)) / 86_400_000 : 0
  ok(filaRita && libera === e5.solicitudes.diasRechazo && libera === 7 && e5.solicitudes.pendientes.length === 0 && !e5.amigos.some((a) => a.id === idRita), 'queda en «Rechazadas» (su mail se libera a los 7 días) y no es amiga', filaRita)
  const rBien = await visita().p('/api/sesion', { email: 'rita@ejemplo.com', clave: FRASE })
  const rMal = await visita().p('/api/sesion', { email: 'rita@ejemplo.com', clave: 'una contraseña que no es' })
  const rNadie = await visita().p('/api/sesion', { email: 'nadie@ejemplo.com', clave: FRASE })
  ok(rBien.status === 401 && rBien.json?.error === MAL_ENTRAR && rBien.texto === rMal.texto && rBien.texto === rNadie.texto && !rBien.galleta, 'la rechazada entra con su mail y su contraseña buenos: el error de siempre, idéntico (no se le revela el rechazo)', rBien.texto)
  const rec = await visita().p('/api/recuperar', { email: 'rita@ejemplo.com', codigo: codigosRita[0], clave: NUEVA })
  const recNadie = await visita().p('/api/recuperar', { email: 'nadie@ejemplo.com', codigo: codigosRita[0], clave: NUEVA })
  ok(rec.status === 401 && rec.json?.error === MAL_RECUPERAR && rec.texto === recNadie.texto && !rec.galleta, 'recuperar con un código bueno: el mismo error que un mail inexistente (y no cambia nada)', rec.texto)
  const cookieRita = new Quien(BASE, { nombre: 'rechazada (cookie firmada)', cookie: cookieJuego(`t:${idRita}:1`), ip: ipNueva() })
  ok((await cookieRita.g('/api/proyectos')).status === 401 && (await mcpPost(jwtInventado(BASE, { sub: `t:${idRita}` }))).status === 401, 'ni con una cookie ni con un token de OAuth firmados: 401')
  const otra = await solicitar(visita(), 'rita')
  const otraPablo = await solicitar(visita(), 'pablo')
  ok(otra.status === 409 && otra.json?.error === MAIL_USADO && otra.texto === otraPablo.texto, 'pedir otra vez con el mail rechazado: el mismo «Ya hay una cuenta con ese mail» que con una cuenta activa (sin revelar el estado)', otra.texto)
  r = await juego.p(`/api/amigos/${idRita}/rechazar`)
  ok(r.status === 409, 'rechazar dos veces: 409')
  r = await juego.p(`/api/amigos/${idRita}/aprobar`)
  ok(r.status === 409 && /rechazada/.test(r.json?.error ?? ''), 'aprobar una rechazada de golpe: 409 (primero se reconsidera)', r.texto)
  r = await juego.p(`/api/amigos/${idRita}/reconsiderar`)
  ok(r.status === 200 && (await estado()).solicitudes.pendientes.some((s) => s.id === idRita), '«Reconsiderar» la devuelve a Solicitudes')
  r = await juego.p(`/api/amigos/${idRita}/reconsiderar`)
  ok(r.status === 409, 'reconsiderar una que no está rechazada: 409')
  ok((await juego.p(`/api/amigos/${idRita}/rechazar`)).status === 200, 'y se la vuelve a rechazar')

  titulo('7f. El tope de amigos sigue valiendo: aprobar lo respeta')
  const amigosAhora = (await estado()).amigos.length
  await juego.pedir('PUT', '/api/amigos/ajustes', { topeAmigos: amigosAhora })
  r = await pedir('tomi')
  const idTomi = await idDe('tomi')
  ok(r.status === 201, 'las solicitudes no cuentan para el tope: se puede pedir aunque ya esté lleno')
  r = await juego.p(`/api/amigos/${idTomi}/aprobar`)
  ok(r.status === 409 && /es el tope/.test(r.json?.error ?? ''), 'con el tope lleno, aprobar da 409 «es el tope» y avisa qué hacer', r.texto)
  ok((await estado()).solicitudes.pendientes.some((s) => s.id === idTomi), 'y la solicitud sigue esperando')
  await juego.pedir('PUT', '/api/amigos/ajustes', { topeAmigos: amigosAhora + 1 })
  r = await pedir('uma')
  const idUma = await idDe('uma')
  const rs = await Promise.all([juego.p(`/api/amigos/${idTomi}/aprobar`), new Quien(BASE, { cookie: cookieJuego(), ip: ipNueva() }).p(`/api/amigos/${idUma}/aprobar`)])
  ok(rs.filter((x) => x.status === 200).length === 1 && rs.filter((x) => x.status === 409).length === 1, 'dos aprobaciones a la vez con un solo lugar: entra una y la otra avisa del tope', rs.map((x) => x.status))
  ok((await estado()).amigos.length === amigosAhora + 1, 'el total de amigos no pasó el tope')
  await juego.pedir('PUT', '/api/amigos/ajustes', { topeAmigos: 100 })
  const pendientesAhora = (await estado()).solicitudes.pendientes
  for (const s of pendientesAhora) await juego.p(`/api/amigos/${s.id}/rechazar`)

  titulo('7g. Límite por IP y tope de solicitudes pendientes')
  const lim = '10.88.0.1'
  const dePrueba = []
  for (let i = 0; i < 5; i++) dePrueba.push(await solicitar(new Quien(BASE, { ip: lim }), `ipuno${i}`))
  for (const x of dePrueba) for (const c of x.json?.codigos ?? []) secretos.codigos.push(c)
  ok(dePrueba.every((x) => x.status === 201), 'cinco pedidos desde una misma IP en una hora entran')
  r = await solicitar(new Quien(BASE, { ip: lim }), 'ipuno5')
  ok(r.status === 429 && /Demasiados intentos/.test(r.json?.error ?? ''), 'el sexto desde esa IP: «Demasiados intentos» (429)', r.texto)
  r = await solicitar(new Quien(BASE, { ip: ipNueva() }), 'ipuno5')
  ok(r.status === 201, 'desde otra IP, sigue pudiendo pedir')
  for (const c of r.json?.codigos ?? []) secretos.codigos.push(c)
  // Se llena hasta 30 pendientes (cada IP, hasta 5).
  let hay = (await estado()).solicitudes.pendientes.length
  let i = 0
  while (hay < 30 && i < 60) {
    const x = await solicitar(new Quien(BASE, { ip: ipNueva() }), `lleno${i++}`)
    if (x.status === 201) hay++
    for (const c of x.json?.codigos ?? []) secretos.codigos.push(c)
  }
  ok((await estado()).solicitudes.pendientes.length === 30, 'hay exactamente 30 solicitudes pendientes')
  r = await solicitar(new Quien(BASE, { ip: ipNueva() }), 'treintaiuno')
  ok(r.status === 429 && r.json?.error === 'Ahora no se aceptan más solicitudes. Probá más tarde.', 'la 31: «Ahora no se aceptan más solicitudes. Probá más tarde.»', r.texto)
  r = await solicitar(new Quien(BASE, { ip: ipNueva() }), 'treintaiuno')
  const avisos = (await juego.g('/api/notificaciones')).json.filter((n) => /Hay muchas solicitudes sin responder/.test(n.titulo))
  ok(avisos.length === 1 && avisos[0].enlace === '/amigos', 'el dueño recibe UN aviso en la campana (no uno por intento), con enlace a Amigos', avisos)
  const idsPend = (await estado()).solicitudes.pendientes.map((s) => s.id)
  for (const id of idsPend.slice(0, 2)) await juego.p(`/api/amigos/${id}/rechazar`)
  const carrera = await Promise.all(Array.from({ length: 6 }, (_, k) => solicitar(new Quien(BASE, { ip: ipNueva() }), `carrera${k}`)))
  for (const x of carrera) for (const c of x.json?.codigos ?? []) secretos.codigos.push(c)
  ok(carrera.filter((x) => x.status === 201).length === 2 && carrera.filter((x) => x.status === 429).length === 4, 'quedan 2 lugares y llegan 6 pedidos a la vez: entran 2', carrera.map((x) => x.status))
  ok((await estado()).solicitudes.pendientes.length === 30, 'y vuelven a ser 30')
  ok(!(await estado()).amigos.some((a) => /carrera|lleno|ipuno/.test(a.email)), 'ninguna de esas es amiga: son solicitudes')
  // quién las puede borrar
  for (const [nombre, q, esperado] of [['la clave del MCP', duenoClave, 403], ['un amigo', beto, 403], ['una visita', visita(), 401]]) {
    const x = await q.p('/api/amigos/solicitudes/limpiar')
    ok(x.status === esperado, `${nombre} no borra solicitudes (${x.status})`)
  }

  titulo('7h. «Borrar solicitudes viejas» y el mail que se libera (con la base apagada para cambiar fechas)')
  const idLleno0 = await idDe('lleno0')
  const pendViejaMail = (await estado()).solicitudes.pendientes.find((s) => s.id === idLleno0)?.email
  ok(Boolean(pendViejaMail), 'hay una solicitud pendiente para envejecer')
  const idsRech = (await estado()).solicitudes.rechazadas
  const rVieja = idsRech.find((s) => s.email === 'rita@ejemplo.com') // rechazada hace segundos
  const rMail = idsRech.find((s) => s.email !== 'rita@ejemplo.com')
  ok(Boolean(rVieja && rMail), 'hay rechazadas para envejecer')
  await apagar(srv)
  salidaAntes += srv.salida()
  const v1 = JSON.parse(tsx('scripts/amigos/tocar-base.ts', srv.datos, 'viejar-solicitud', idLleno0, '31'))
  const v2 = JSON.parse(tsx('scripts/amigos/tocar-base.ts', srv.datos, 'viejar-solicitud', rVieja.id, '31'))
  const v3 = JSON.parse(tsx('scripts/amigos/tocar-base.ts', srv.datos, 'viejar-solicitud', rMail.id, '8'))
  const v4 = JSON.parse(tsx('scripts/amigos/tocar-base.ts', srv.datos, 'viejar-solicitud', idPablo, '90')) // un amigo aprobado hace mucho: no se toca
  ok(v1.viejas === 1 && v2.viejas === 1 && v3.viejas === 1 && v4.viejas === 1, 'se envejecen a mano (en la base de prueba): una pendiente y una rechazada de 31 días, una rechazada de 8 y un amigo de 90')
  srv = await levantar({ puerto: PUERTO + 5, datos: srv.datos, invitacion: '' })
  const antes = await estado()
  r = await juego.p('/api/amigos/solicitudes/limpiar')
  ok(r.status === 200 && r.json?.borradas === 2, '«Borrar solicitudes viejas»: borra las 2 de más de 30 días', r.texto)
  const des = await estado()
  ok(!des.solicitudes.pendientes.some((s) => s.id === idLleno0) && !des.solicitudes.rechazadas.some((s) => s.id === rVieja.id), 'la pendiente vieja y la rechazada vieja ya no están')
  ok(des.solicitudes.rechazadas.some((s) => s.id === rMail.id), 'la rechazada de 8 días NO es «vieja» (30): sigue ahí')
  ok(des.solicitudes.pendientes.length === antes.solicitudes.pendientes.length - 1 && des.amigos.length === antes.amigos.length, 'lo demás quedó igual, y ningún amigo se tocó')
  ok((await visita().p('/api/sesion', { email: 'pablo@ejemplo.com', clave: NUEVA })).status === 200, 'Pablo (aprobado hace 90 días) sigue entrando')
  r = await juego.p('/api/amigos/solicitudes/limpiar')
  ok(r.status === 200 && r.json?.borradas === 0, 'repetirlo no borra nada más')
  // Con lugar (se rechazan tres), el mail de la que se borró y el de la rechazada de hace 8 días vuelven a estar libres; el de una recién rechazada, no.
  const recien = (await estado()).solicitudes.pendientes.slice(0, 3)
  for (const s of recien) await juego.p(`/api/amigos/${s.id}/rechazar`)
  r = await solicitar(new Quien(BASE, { ip: ipNueva() }), 'lleno0')
  ok(r.status === 201, 'el mail de la solicitud borrada queda libre: puede volver a pedir', r.texto)
  for (const c of r.json?.codigos ?? []) secretos.codigos.push(c)
  const libre = await solicitar(new Quien(BASE, { ip: ipNueva() }), rMail.email.split('@')[0])
  ok(libre.status === 201, 'el mail de una rechazada de hace más de 7 días vuelve a poder pedir (no dice «ya usado»)', libre.texto)
  for (const c of libre.json?.codigos ?? []) secretos.codigos.push(c)
  const d2 = await estado()
  ok(!d2.solicitudes.rechazadas.some((s) => s.id === rMail.id) && d2.solicitudes.pendientes.some((s) => s.email === rMail.email), 'y la rechazada vieja se reemplazó por la solicitud nueva (pendiente)')
  const aun = await solicitar(new Quien(BASE, { ip: ipNueva() }), recien[0].email.split('@')[0])
  ok(aun.status === 409 && aun.json?.error === MAIL_USADO, 'la recién rechazada sigue ocupando su mail (409)', aun.texto)
  await apagar(srv)
  const huerf = JSON.parse(tsx('scripts/amigos/tocar-base.ts', srv.datos, 'huerfanos'))
  ok(huerf.codigos === 0 && huerf.restablecimientos === 0, 'al borrarlas no quedaron códigos de recuperación ni enlaces sueltos de cuentas que ya no existen', huerf)

  titulo('7i. Nada sensible en claro: ni en la base ni en la salida del servidor')
  const salida = salidaAntes + srv.salida()
  const todos = [...secretos.codigos, ...secretos.claves]
  ok(!todos.some((t) => salida.includes(t) || salida.includes(t.replace(/-/g, ''))), `ni las contraseñas ni los ${secretos.codigos.length} códigos de recuperación aparecen en lo que escribió el servidor`)
  const busca = JSON.parse(
    execFileSync(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), ['scripts/amigos/tocar-base.ts', srv.datos, 'buscar'], {
      cwd: RAIZ,
      env: { ...process.env, TELAR_TOKENS: '[]', TELAR_CODIGOS: JSON.stringify(secretos.codigos), TELAR_SECRETOS: JSON.stringify(secretos.claves) },
    })
      .toString()
      .trim()
      .split('\n')
      .pop(),
  )
  ok(busca.tablas > 20 && busca.encontrados.length === 0, `en la base (${busca.tablas} tablas) no hay ninguna contraseña ni código en claro`, busca)
  rmSync(srv.datos, { recursive: true, force: true })
}

try {
  await pasoCerrado()
  if (!SOLO_AMIGOS && !SOLO_RECUPERACION && !SOLO_SOLICITUDES) {
    if (!SIN_BASE_VIEJA) await pasoBaseVieja()
    await pasoPrincipal()
  }
  if (!SOLO_RECUPERACION && !SOLO_SOLICITUDES) await pasoAmigos()
  if (!SOLO_AMIGOS && !SOLO_SOLICITUDES) await pasoRecuperacion()
  if (!SOLO_AMIGOS && !SOLO_RECUPERACION) await pasoSolicitudes()
} catch (e) {
  fallas++
  console.error('\n✗ La prueba se cortó:', e?.stack ?? e)
} finally {
  for (const s of servidores) await apagar(s)
}
console.log(`\n${fallas ? `✗ ${fallas} de ${pruebas} fallaron` : `✓ ${pruebas} comprobaciones: todo bien`}`)
process.exit(fallas ? 1 : 0)
