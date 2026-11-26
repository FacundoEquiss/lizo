// Prueba de crear cuenta con aprobación (servidor/src/solicitudes.ts y la migración 20261211090000_solicitudes.sql) en PGlite en memoria, con el
// mismo mecanismo de migraciones que usa el servidor: `npm run solicitudes:probar`. Sin red ni disco.
//   · La migración es aditiva, repetible, no nombra el esquema; la restricción de `cuentas.estado` se suelta por su nombre real (verificado
//     con las migraciones anteriores) y vuelve con los cuatro estados; un estado inventado sigue sin pasar.
//   · Pedir una cuenta: nace `pendiente`, con la contraseña solo como hash; datos malos no gastan intento; el mail repetido contesta IGUAL sea
//     de una cuenta activa, pendiente o rechazada; límite por IP; tope de 30 pendientes (también con pedidos a la vez).
//   · Una cuenta que no es `activa` no entra: la sesión, OAuth y todo lo que pasa por `cuentaDeUsuario` la rechazan igual que a una
//     suspendida; entrar con la contraseña buena dice «espera» solo si está pendiente (la rechazada contesta como si no existiera).
//   · Aprobar respeta el tope de amigos (las solicitudes no cuentan, también con aprobaciones a la vez); rechazar; reconsiderar; el mail de una
//     rechazada se libera pasados 7 días; «Borrar solicitudes viejas» borra solo solicitudes viejas y sin datos, con lo que cuelga de ellas.
//   · Recuperar con código: una pendiente cambia su contraseña SIN ganar acceso; una rechazada contesta igual que un mail inexistente.
//   · Barrido: todo lugar del servidor que mira el estado `activa` está en la lista conocida (uno nuevo obliga a revisar si deja pasar a las
//     solicitudes).
// Lo que no prueba (lo hace scripts/probar-cuentas.mjs con un Telar de verdad): rutas, sesión, 403 a la clave del MCP y a otras cuentas.
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { listarAmigos, ponerEstadoAmigo } from './amigos'
import {
  contarAmigos,
  crearCuenta,
  cuentaDeUsuario,
  entrarTelar,
  hashClave,
  leerCuenta,
  MENSAJE_DEMASIADOS,
  ponerTopeAmigos,
  puedeEntrar,
  usuarioDeCookie,
  usuarioDeOAuth,
} from './cuentas'
import type { Conexion } from './datos/conexion'
import { migrar } from './datos/migraciones'
import { abrirPgliteEnMemoria } from './datos/pglite'
import { crearRestablecimiento, generarCodigos, MENSAJE_RECUPERAR_MAL, recuperarConCodigo } from './recuperacion'
import {
  aprobarSolicitud,
  borrarSolicitudesViejas,
  contarPendientes,
  DIAS_RECHAZO,
  DIAS_VIEJAS,
  listarSolicitudes,
  MAX_SOLICITUDES,
  MENSAJE_MAIL_USADO,
  MENSAJE_SIN_LUGAR,
  nombreDelDueno,
  rechazarSolicitud,
  reconsiderarSolicitud,
  solicitarCuenta,
} from './solicitudes'

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CARPETA = path.join(RAIZ, 'supabase', 'migrations')
const NOMBRE = '20261211090000_solicitudes.sql'
const SQL = readFileSync(path.join(CARPETA, NOMBRE), 'utf8')
const sinComentarios = SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const CLAVE = 'una frase larga de prueba'
const NUEVA = 'la frase nueva de la prueba'

async function base(): Promise<Conexion> {
  const db = await abrirPgliteEnMemoria()
  await migrar(db, CARPETA)
  return db
}
let ipN = 0
const ip = () => `10.3.${Math.floor(++ipN / 250)}.${ipN % 250}`
const datos = (n: string, extra: Record<string, string> = {}) => ({ email: `${n}@ejemplo.com`, nombre: n[0]!.toUpperCase() + n.slice(1), clave: CLAVE, ip: ip(), ...extra })
async function pedir(db: Conexion, n: string, extra: Record<string, string> = {}) {
  const r = await solicitarCuenta(db, datos(n, extra))
  assert.ok(r.ok, `se pide la cuenta de ${n}: ${JSON.stringify(r)}`)
  return r.cuenta
}
/** Una cuenta de amigo activa, como la que crea un enlace de invitación. */
async function activa(db: Conexion, n: string) {
  const r = await crearCuenta(db, { email: `${n}@ejemplo.com`, nombre: n, claveHash: await hashClave(CLAVE) })
  assert.ok(r.ok)
  return r.cuenta
}
const estadoDe = async (db: Conexion, id: string) => (await leerCuenta(db, id))?.estado
/** Todo el texto de todas las tablas, para buscar lo que no tiene que estar. */
async function textoDeLaBase(db: Conexion) {
  const partes: string[] = []
  for (const t of (await db.consulta<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)).map((f) => f.tablename))
    partes.push(JSON.stringify(await db.consulta(`select * from "${t}"`)))
  return partes.join('\n')
}

test('la migración es aditiva, repetible, y la restricción de estado se suelta por su nombre real', async () => {
  assert.doesNotMatch(sinComentarios, /\btablero\b/i, 'no puede nombrar el esquema `tablero`')
  assert.doesNotMatch(sinComentarios, /\b(create\s+schema|set\s+search_path|truncate|delete\s+from|grant|revoke|drop\s+(table|column|schema|index))\b/i)
  // Lo único que suelta es esa restricción, por su nombre y con `if exists`.
  assert.deepEqual([...sinComentarios.matchAll(/\bdrop\s+constraint\s+(if\s+exists\s+)?(\w+)/gi)].map((m) => [m[1]?.trim(), m[2]]), [['if exists', 'cuentas_estado_check']])
  assert.doesNotMatch(sinComentarios, /add\s+column\s+(?!if not exists)/i)
  assert.doesNotMatch(sinComentarios, /create\s+(unique\s+)?index\s+(?!if not exists)/i)

  // El nombre de verdad, en una base con SOLO las migraciones anteriores: es la restricción de la columna `estado`, con dos estados.
  const antes = mkdtempSync(path.join(os.tmpdir(), 'telar-solicitudes-'))
  try {
    for (const f of readdirSync(CARPETA).filter((n) => n.endsWith('.sql') && n < NOMBRE)) cpSync(path.join(CARPETA, f), path.join(antes, f))
    const vieja = await abrirPgliteEnMemoria()
    await migrar(vieja, antes)
    const cs = await vieja.consulta<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'cuentas'::regclass and contype = 'c'`,
    )
    assert.deepEqual(cs.map((c) => c.conname), ['cuentas_estado_check'], 'la única restricción check de cuentas se llama cuentas_estado_check')
    assert.match(cs[0]!.def, /activa/)
    assert.match(cs[0]!.def, /suspendida/)
    assert.doesNotMatch(cs[0]!.def, /pendiente/)
    // Con una cuenta de antes: la migración no la toca.
    await vieja.consulta(`insert into cuentas (id, email, nombre, estado) values ('vieja', 'vieja@ejemplo.com', 'Vieja', 'suspendida')`)
    await vieja.ejecutar(SQL)
    assert.equal((await vieja.consulta(`select estado from cuentas where id = 'vieja'`))[0]!.estado, 'suspendida')
  } finally {
    rmSync(antes, { recursive: true, force: true })
  }

  const db = await base()
  await db.ejecutar(SQL) // dos veces más: no falla
  await db.ejecutar(SQL)
  const cs = await db.consulta<{ conname: string; def: string }>(`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'cuentas'::regclass and contype = 'c'`)
  assert.equal(cs.length, 1, 'después de correrla tres veces sigue habiendo una sola restricción')
  for (const e of ['activa', 'suspendida', 'pendiente', 'rechazada']) assert.match(cs[0]!.def, new RegExp(e))
  for (const e of ['activa', 'suspendida', 'pendiente', 'rechazada']) {
    await db.consulta(`insert into cuentas (id, email, nombre, estado) values ($1, $2, 'x', $3)`, [`e-${e}`, `${e}@x.com`, e])
  }
  await assert.rejects(() => db.consulta(`insert into cuentas (id, email, nombre, estado) values ('mala', 'mala@x.com', 'x', 'borrada')`), (e: any) => e?.code === '23514', 'un estado inventado no pasa')
  const cols = (await db.consulta<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'cuentas'`)).map((c) => c.column_name)
  for (const c of ['solicitada_en', 'decidida_en', 'decidida_por']) assert.ok(cols.includes(c), `columna ${c}`)
})

test('pedir una cuenta: nace pendiente, con la contraseña solo como hash, y no entra', async () => {
  const db = await base()
  const c = await pedir(db, 'pablo')
  assert.equal(c.estado, 'pendiente')
  assert.equal((await db.consulta(`select solicitada_en, decidida_en from cuentas where id = $1`, [c.id]))[0]!.decidida_en, null)
  assert.ok((await db.consulta(`select solicitada_en from cuentas where id = $1`, [c.id]))[0]!.solicitada_en, 'anota cuándo la pidió')
  const [f] = await db.consulta<{ clave_hash: string }>(`select clave_hash from cuentas where id = $1`, [c.id])
  assert.match(f!.clave_hash, /^scrypt\$/)
  assert.ok(!(await textoDeLaBase(db)).includes(CLAVE), 'la contraseña en claro no está en ninguna tabla')
  assert.equal(await contarPendientes(db), 1)
  assert.equal((await solicitarCuenta(db, datos('ana'))).ok, true)
  assert.equal(await contarPendientes(db), 2)
  const l = await listarSolicitudes(db)
  assert.deepEqual(l.pendientes.map((s) => s.nombre), ['Pablo', 'Ana'], 'las que esperan, en orden de llegada')
  assert.equal(l.maxSolicitudes, MAX_SOLICITUDES)
  // no cuentan como amigos ni salen en la lista de amigos
  assert.equal(await contarAmigos(db), 0)
  assert.deepEqual(await listarAmigos(db, async () => 0), [])
  assert.equal(await nombreDelDueno(db), 'Dueño', 'sin su «yo», el nombre de la cuenta del dueño')
  await db.consulta(`insert into miembros (id, nombre, tipo, es_yo, propietario) values ('yo-dueno', 'Facundo', 'humano', true, 'dueno')`)
  assert.equal(await nombreDelDueno(db), 'Facundo')
  assert.equal((await solicitarCuenta(db, datos('luis'))).ok && (await solicitarCuenta(db, datos('luis2'))).ok, true)
  const r = await solicitarCuenta(db, datos('nuevo'))
  assert.ok(r.ok && r.aprobador === 'Facundo', 'devuelve el nombre de quien aprueba (para decírselo)')
})

test('datos malos dan 400 y no gastan intento; el límite por IP frena a la sexta', async () => {
  const db = await base()
  const mismo = '10.99.0.1'
  for (const [extra, quiero] of [
    [{ clave: 'corta' }, /al menos 10/],
    [{ email: 'no-es-un-mail' }, /mail válido/],
    [{ nombre: '   ' }, /nombre/],
    [{ nombre: 'x'.repeat(41) }, /40/],
    [{ clave: '1234567890' }, /más usadas/],
  ] as const) {
    const r = await solicitarCuenta(db, datos('malo', { ip: mismo, ...extra }))
    assert.ok(!r.ok && r.estado === 400 && quiero.test(r.error), JSON.stringify(extra))
  }
  assert.equal((await db.consulta(`select count(*)::int as n from intentos`))[0]!.n, 0, 'lo que falla antes de crear no gasta intentos')
  for (let i = 0; i < 5; i++) assert.ok((await solicitarCuenta(db, datos(`ip${i}`, { ip: mismo }))).ok, `pedido ${i + 1} de la misma IP`)
  const r = await solicitarCuenta(db, datos('ip5', { ip: mismo }))
  assert.ok(!r.ok && r.estado === 429 && r.error === MENSAJE_DEMASIADOS, 'el sexto pedido de la misma IP: demasiados intentos')
  assert.ok((await solicitarCuenta(db, datos('ip5'))).ok, 'otra IP sigue pudiendo')
  assert.equal(await estadoDe(db, (await db.consulta<{ id: string }>(`select id from cuentas where email = 'ip5@ejemplo.com'`))[0]!.id), 'pendiente')
  // la IP no queda en claro en `intentos`
  assert.ok(!JSON.stringify(await db.consulta(`select * from intentos`)).includes(mismo))
})

test('el mail repetido contesta igual sea de una cuenta activa, pendiente o rechazada (y en carrera)', async () => {
  const db = await base()
  await activa(db, 'activa')
  const pend = await pedir(db, 'pendiente')
  const rech = await pedir(db, 'rechazada')
  await rechazarSolicitud(db, rech.id, 'dueno')
  const respuestas = []
  for (const n of ['activa', 'pendiente', 'rechazada']) {
    const r = await solicitarCuenta(db, datos(n))
    assert.ok(!r.ok && r.estado === 409 && r.error === MENSAJE_MAIL_USADO, n)
    respuestas.push(JSON.stringify(r))
  }
  assert.equal(new Set(respuestas).size, 1, 'la respuesta es idéntica para los tres')
  assert.ok(!(await solicitarCuenta(db, datos('pendiente', { email: 'PENDIENTE@ejemplo.com ' }))).ok, 'sin importar mayúsculas ni espacios')
  assert.equal(pend.estado, 'pendiente')
  const rs = await Promise.all([solicitarCuenta(db, datos('carrera')), solicitarCuenta(db, datos('carrera')), solicitarCuenta(db, datos('carrera'))])
  assert.equal(rs.filter((r) => r.ok).length, 1, 'tres pedidos a la vez con el mismo mail: una sola cuenta')
  assert.equal(rs.filter((r) => !r.ok && r.estado === 409 && r.error === MENSAJE_MAIL_USADO).length, 2)
})

test('el tope de 30 pendientes: la 31 no entra, también con pedidos a la vez; al responder hay lugar de nuevo', async () => {
  const db = await base()
  const ids: string[] = []
  for (let i = 0; i < MAX_SOLICITUDES - 5; i++) ids.push((await pedir(db, `p${i}`)).id)
  const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => solicitarCuenta(db, datos(`c${i}`))))
  assert.equal(rs.filter((r) => r.ok).length, 5, 'a la vez, entran solo las que caben')
  const llenas = rs.filter((r) => !r.ok)
  assert.ok(llenas.every((r) => !r.ok && r.estado === 429 && r.error === MENSAJE_SIN_LUGAR && r.sinLugar), 'el resto: «ahora no se aceptan más solicitudes» (y avisa al dueño)')
  assert.equal(await contarPendientes(db), MAX_SOLICITUDES, 'quedan exactamente 30')
  const otra = await solicitarCuenta(db, datos('treintaiuno'))
  assert.ok(!otra.ok && otra.sinLugar)
  // un mail repetido sigue diciendo «ya usado» (no depende del tope)
  const repetido = await solicitarCuenta(db, datos('p0'))
  assert.ok(!repetido.ok && repetido.error === MENSAJE_MAIL_USADO)
  // las rechazadas no ocupan lugar
  await rechazarSolicitud(db, ids[0]!, 'dueno')
  assert.ok((await solicitarCuenta(db, datos('treintaiuno'))).ok, 'al rechazar una, hay lugar')
})

test('una cuenta que no es activa no entra: pendiente, rechazada y suspendida, por la cookie y por OAuth', async () => {
  const db = await base()
  const usuariosJuego = ['usuario-juego']
  const a = await activa(db, 'ana')
  const p = await pedir(db, 'pablo')
  const r = await pedir(db, 'rita')
  await rechazarSolicitud(db, r.id, 'dueno')
  const s = await activa(db, 'sofi')
  await ponerEstadoAmigo(db, s.id, 'suspendida')
  assert.equal(puedeEntrar('activa'), true)
  for (const e of ['pendiente', 'rechazada', 'suspendida', '', 'otra', null, undefined]) assert.equal(puedeEntrar(e), false, `${e} no entra`)
  assert.ok(await cuentaDeUsuario(db, usuarioDeCookie(a), usuariosJuego), 'la activa sí')
  assert.ok(await cuentaDeUsuario(db, usuarioDeOAuth(a.id), usuariosJuego), 'la activa sí, por OAuth')
  for (const [nombre, c] of [['pendiente', p], ['rechazada', r], ['suspendida', s]] as const) {
    assert.equal(await cuentaDeUsuario(db, usuarioDeCookie(c), usuariosJuego), null, `${nombre}: la cookie no entra`)
    assert.equal(await cuentaDeUsuario(db, usuarioDeOAuth(c.id), usuariosJuego), null, `${nombre}: el token de OAuth no entra`)
    assert.equal(await cuentaDeUsuario(db, `t:${c.id}`, usuariosJuego), null, `${nombre}: ni sin versión`)
  }
  // aprobada, entra con la MISMA cookie que ya tenía
  await aprobarSolicitud(db, p.id, 'dueno')
  assert.ok(await cuentaDeUsuario(db, usuarioDeCookie(p), usuariosJuego), 'aprobada, entra')
  // y vuelve a cerrarse si la vuelven a rechazar a mano (por ejemplo, un error)
  await db.consulta(`update cuentas set estado = 'pendiente' where id = $1`, [p.id])
  assert.equal(await cuentaDeUsuario(db, usuarioDeCookie(p), usuariosJuego), null, 'si vuelve a pendiente, se cierra en el próximo pedido')
})

test('entrar: la pendiente con sus datos buenos oye «espera»; la rechazada y las credenciales malas, lo de siempre', async () => {
  const db = await base()
  const p = await pedir(db, 'pablo')
  const r = await pedir(db, 'rita')
  await rechazarSolicitud(db, r.id, 'dueno')
  const a = await activa(db, 'ana')
  assert.deepEqual(await entrarTelar(db, 'pablo@ejemplo.com', CLAVE), { pendiente: true })
  assert.equal(await entrarTelar(db, 'pablo@ejemplo.com', 'otra contraseña mala'), null, 'contraseña mala: lo de siempre (no dice que existe)')
  assert.equal(await entrarTelar(db, 'nadie@ejemplo.com', CLAVE), null, 'mail inexistente: lo de siempre')
  assert.equal(await entrarTelar(db, 'rita@ejemplo.com', CLAVE), null, 'rechazada con la contraseña buena: lo de siempre (no se revela el rechazo)')
  assert.equal(await entrarTelar(db, 'rita@ejemplo.com', 'otra contraseña mala'), null)
  const dentro = await entrarTelar(db, 'ana@ejemplo.com', CLAVE)
  assert.ok(dentro && 'cuenta' in dentro && dentro.cuenta.id === a.id)
  assert.equal((await leerCuenta(db, p.id))!.ultimoIngreso, null, 'la pendiente que intenta entrar no queda con «último ingreso»')
  await aprobarSolicitud(db, p.id, 'dueno')
  const aprobada = await entrarTelar(db, 'pablo@ejemplo.com', CLAVE)
  assert.ok(aprobada && 'cuenta' in aprobada && aprobada.cuenta.id === p.id, 'aprobada, entra con su mail y su contraseña')
})

test('aprobar, rechazar y reconsiderar: estados, 404 y 409, y quedan anotados', async () => {
  const db = await base()
  const p = await pedir(db, 'pablo')
  await assert.rejects(() => aprobarSolicitud(db, 'no-existe', 'dueno'), (e: any) => e.estado === 404)
  await assert.rejects(() => aprobarSolicitud(db, 'dueno', 'dueno'), (e: any) => e.estado === 404, 'la cuenta del dueño no es una solicitud')
  const ok = await aprobarSolicitud(db, p.id, 'dueno')
  assert.equal(ok.estado, 'activa')
  const [f] = await db.consulta(`select decidida_en, decidida_por from cuentas where id = $1`, [p.id])
  assert.ok(f!.decidida_en && f!.decidida_por === 'dueno')
  await assert.rejects(() => aprobarSolicitud(db, p.id, 'dueno'), (e: any) => e.estado === 409, 'aprobar dos veces: 409')
  await assert.rejects(() => rechazarSolicitud(db, p.id, 'dueno'), (e: any) => e.estado === 409, 'una activa no se rechaza por acá')
  await assert.rejects(() => reconsiderarSolicitud(db, p.id), (e: any) => e.estado === 409)
  assert.equal(await estadoDe(db, p.id), 'activa', 'y quedó como estaba')
  // una suspendida tampoco es una solicitud
  await ponerEstadoAmigo(db, p.id, 'suspendida')
  await assert.rejects(() => aprobarSolicitud(db, p.id, 'dueno'), (e: any) => e.estado === 409)

  const q = await pedir(db, 'quique')
  const rech = await rechazarSolicitud(db, q.id, 'dueno')
  assert.equal(rech.estado, 'rechazada')
  await assert.rejects(() => aprobarSolicitud(db, q.id, 'dueno'), (e: any) => e.estado === 409 && /rechazada/.test(e.message), 'una rechazada no se aprueba de golpe: primero se reconsidera')
  await assert.rejects(() => rechazarSolicitud(db, q.id, 'dueno'), (e: any) => e.estado === 409)
  const l = await listarSolicitudes(db)
  assert.deepEqual(l.rechazadas.map((s) => s.nombre), ['Quique'])
  assert.ok(l.rechazadas[0]!.liberaEn && new Date(l.rechazadas[0]!.liberaEn!).getTime() - new Date(l.rechazadas[0]!.decididaEn!).getTime() === DIAS_RECHAZO * 86_400_000, 'dice cuándo se libera su mail')
  assert.equal((await reconsiderarSolicitud(db, q.id)).estado, 'pendiente')
  assert.equal((await db.consulta(`select decidida_en from cuentas where id = $1`, [q.id]))[0]!.decidida_en, null)
  assert.equal((await aprobarSolicitud(db, q.id, 'dueno')).estado, 'activa', 'reconsiderada, se puede aprobar')
})

test('aprobar respeta el tope de amigos: las solicitudes no cuentan y, con aprobaciones a la vez, no se pasa', async () => {
  const db = await base()
  await ponerTopeAmigos(db, 3)
  const ps = []
  for (let i = 0; i < 6; i++) ps.push(await pedir(db, `s${i}`))
  assert.equal(await contarAmigos(db), 0, 'seis solicitudes y cero amigos')
  assert.equal((await aprobarSolicitud(db, ps[0]!.id, 'dueno')).estado, 'activa')
  assert.equal(await contarAmigos(db), 1)
  const rs = await Promise.allSettled(ps.slice(1).map((c) => aprobarSolicitud(db, c.id, 'dueno')))
  assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 2, 'a la vez, entran solo las que caben (tope 3)')
  const malas = rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  assert.ok(malas.length === 3 && malas.every((r) => r.reason?.estado === 409 && /tope/.test(r.reason.message)), 'el resto avisa del tope')
  assert.equal(await contarAmigos(db), 3)
  assert.equal((await db.consulta(`select count(*)::int as n from cuentas where estado = 'pendiente'`))[0]!.n, 3, 'las que no entraron siguen pendientes')
  // suspendidas cuentan (sus datos siguen)
  const [primera] = await listarAmigos(db, async () => 0)
  await ponerEstadoAmigo(db, primera!.id, 'suspendida')
  const pendiente = (await listarSolicitudes(db)).pendientes[0]!
  await assert.rejects(() => aprobarSolicitud(db, pendiente.id, 'dueno'), (e: any) => e.estado === 409 && /tope/.test(e.message), 'con una suspendida, el lugar sigue ocupado')
  await ponerTopeAmigos(db, 4)
  assert.equal((await aprobarSolicitud(db, pendiente.id, 'dueno')).estado, 'activa', 'al subir el tope, se puede')
})

test('una solicitud no se «reactiva» ni se le restablece la contraseña como a un amigo', async () => {
  const db = await base()
  const p = await pedir(db, 'pablo')
  await assert.rejects(() => ponerEstadoAmigo(db, p.id, 'activa'), (e: any) => e.estado === 409 && /solicitud/.test(e.message))
  await assert.rejects(() => crearRestablecimiento(db, p.id, 'dueno'), (e: any) => e.estado === 409 && /todavía no está aprobada/.test(e.message))
  assert.equal(await estadoDe(db, p.id), 'pendiente')
  const r = await pedir(db, 'rita')
  await rechazarSolicitud(db, r.id, 'dueno')
  await assert.rejects(() => crearRestablecimiento(db, r.id, 'dueno'), (e: any) => e.estado === 409)
  await assert.rejects(() => ponerEstadoAmigo(db, r.id, 'suspendida'), (e: any) => e.estado === 409)
})

test('el mail de una rechazada se libera pasados los días de espera, no antes', async () => {
  const db = await base()
  const r = await pedir(db, 'rita')
  await generarCodigos(db, r.id)
  await rechazarSolicitud(db, r.id, 'dueno')
  assert.ok(!(await solicitarCuenta(db, datos('rita'))).ok, 'recién rechazada: el mail sigue ocupado')
  await db.consulta(`update cuentas set decidida_en = now() - interval '${DIAS_RECHAZO - 1} days' where id = $1`, [r.id])
  assert.ok(!(await solicitarCuenta(db, datos('rita'))).ok, 'a los 6 días, todavía ocupado')
  await db.consulta(`update cuentas set decidida_en = now() - interval '${DIAS_RECHAZO + 1} days' where id = $1`, [r.id])
  const otra = await solicitarCuenta(db, datos('rita', { nombre: 'Rita de nuevo' }))
  assert.ok(otra.ok && otra.cuenta.id !== r.id && otra.cuenta.estado === 'pendiente', 'pasados los días, puede volver a pedir')
  assert.equal(await leerCuenta(db, r.id), null, 'y la rechazada de antes se borró (era una cuenta sin datos)')
  assert.equal((await db.consulta(`select count(*)::int as n from codigos_recuperacion where cuenta = $1`, [r.id]))[0]!.n, 0, 'con sus códigos de recuperación')
})

test('«Borrar solicitudes viejas»: solo solicitudes de más de 30 días y sin datos; con lo que cuelga de ellas', async () => {
  const db = await base()
  const vieja = await pedir(db, 'vieja')
  const reciente = await pedir(db, 'reciente')
  const rechVieja = await pedir(db, 'rechvieja')
  const rechReciente = await pedir(db, 'rechreciente')
  const aprobada = await pedir(db, 'aprobada')
  const conDatos = await pedir(db, 'condatos')
  for (const c of [vieja, reciente, rechVieja, rechReciente, aprobada, conDatos]) await generarCodigos(db, c.id)
  await rechazarSolicitud(db, rechVieja.id, 'dueno')
  await rechazarSolicitud(db, rechReciente.id, 'dueno')
  await aprobarSolicitud(db, aprobada.id, 'dueno')
  // pasan 31 días para tres de ellas y para la aprobada (esa no se toca: es un amigo)
  const viejo = `now() - interval '${DIAS_VIEJAS + 1} days'`
  await db.consulta(`update cuentas set solicitada_en = ${viejo} where id in ($1, $2, $3, $4)`, [vieja.id, rechVieja.id, aprobada.id, conDatos.id])
  await db.consulta(`update cuentas set decidida_en = ${viejo} where id in ($1, $2)`, [rechVieja.id, aprobada.id])
  // «condatos» tiene un proyecto (no debería: una solicitud no puede crear nada): por si acaso, no se borra
  await db.consulta(`insert into proyectos (id, nombre, prefijo, orden, propietario) values ('pr1', 'Algo', 'ALG', 'a', $1)`, [conDatos.id])
  assert.equal(await borrarSolicitudesViejas(db), 2, 'borra la pendiente vieja y la rechazada vieja')
  assert.equal(await leerCuenta(db, vieja.id), null)
  assert.equal(await leerCuenta(db, rechVieja.id), null)
  assert.equal(await estadoDe(db, reciente.id), 'pendiente')
  assert.equal(await estadoDe(db, rechReciente.id), 'rechazada')
  assert.equal(await estadoDe(db, aprobada.id), 'activa', 'una cuenta aprobada nunca se borra')
  assert.equal(await estadoDe(db, conDatos.id), 'pendiente', 'una cuenta con datos tampoco')
  assert.equal((await db.consulta(`select count(*)::int as n from codigos_recuperacion where cuenta in ($1, $2)`, [vieja.id, rechVieja.id]))[0]!.n, 0, 'sus códigos se borraron con ellas')
  assert.equal((await db.consulta(`select count(*)::int as n from codigos_recuperacion where cuenta = $1`, [reciente.id]))[0]!.n, 8, 'los de las otras, no')
  assert.equal(await borrarSolicitudesViejas(db), 0, 'repetirlo no borra nada más')
  assert.equal((await db.consulta(`select count(*)::int as n from cuentas where id = 'dueno'`))[0]!.n, 1, 'la cuenta del dueño ni se mira')
})

test('recuperar con un código: la pendiente cambia su contraseña sin ganar acceso; la rechazada contesta como un mail inexistente', async () => {
  const db = await base()
  const p = await pedir(db, 'pablo')
  const codigosP = await generarCodigos(db, p.id)
  const r = await pedir(db, 'rita')
  const codigosR = await generarCodigos(db, r.id)
  const a = await activa(db, 'ana')
  const codigosA = await generarCodigos(db, a.id)
  const x = await recuperarConCodigo(db, { email: 'pablo@ejemplo.com', codigo: codigosP[0]!, clave: NUEVA, ip: ip() })
  assert.ok(x.ok && x.cuenta.estado === 'pendiente', 'recupera, pero la cuenta sigue pendiente (la ruta no le abre la sesión)')
  assert.equal(await estadoDe(db, p.id), 'pendiente')
  assert.deepEqual(await entrarTelar(db, 'pablo@ejemplo.com', NUEVA), { pendiente: true }, 'con la contraseña nueva, sigue esperando')
  assert.equal(await entrarTelar(db, 'pablo@ejemplo.com', CLAVE), null, 'la vieja ya no sirve')
  assert.equal(await cuentaDeUsuario(db, usuarioDeCookie((await leerCuenta(db, p.id))!), []), null, 'ni la sesión nueva entra')
  await rechazarSolicitud(db, r.id, 'dueno')
  const y = await recuperarConCodigo(db, { email: 'rita@ejemplo.com', codigo: codigosR[0]!, clave: NUEVA, ip: ip() })
  const inexistente = await recuperarConCodigo(db, { email: 'nadie@ejemplo.com', codigo: codigosR[0]!, clave: NUEVA, ip: ip() })
  assert.deepEqual(y, inexistente, 'rechazada con un código bueno = mail inexistente (no se revela el rechazo)')
  assert.ok(!y.ok && y.estado === 401 && y.error === MENSAJE_RECUPERAR_MAL)
  assert.equal((await db.consulta(`select count(*)::int as n from codigos_recuperacion where cuenta = $1 and usado_en is null`, [r.id]))[0]!.n, 8, 'y no gasta el código')
  assert.equal(await entrarTelar(db, 'rita@ejemplo.com', CLAVE), null, 'su contraseña no cambió')
  // una cuenta activa sigue igual que siempre
  const z = await recuperarConCodigo(db, { email: 'ana@ejemplo.com', codigo: codigosA[0]!, clave: NUEVA, ip: ip() })
  assert.ok(z.ok && z.cuenta.estado === 'activa')
})

test('el barrido: todo lugar del servidor que mira el estado «activa» está en la lista conocida', () => {
  // Cada archivo de servidor/src (sin las pruebas) que nombra el estado 'activa'. Si aparece uno nuevo, esta prueba falla: hay que mirar si
  // deja pasar a una solicitud `pendiente` o `rechazada` (y sumarlo acá con por qué está bien). Lo que decide quién entra es `puedeEntrar`.
  const CONOCIDOS: Record<string, string> = {
    'cuentas.ts': 'puedeEntrar y cuentaDeUsuario (sesión, OAuth, MCP, eventos, archivos), entrarTelar, el tipo EstadoCuenta y cambiarEstado',
    'amigos.ts': 'ponerEstadoAmigo (solo entre activa y suspendida) y la lista de amigos (activa o suspendida)',
    'amigos-rutas.ts': 'el esquema de «suspender / reactivar» (activa | suspendida)',
    'solicitudes.ts': 'aprobar: pendiente → activa (cuenta contra el tope)',
    'recuperacion.ts': 'recuperar con código (pendiente cambia la contraseña sin sesión; rechazada = no existe), crear y abrir un enlace de restablecimiento (solo activas)',
  }
  const encontrados: string[] = []
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = path.join(dir, nombre)
      if (statSync(ruta).isDirectory()) recorrer(ruta)
      else if (nombre.endsWith('.ts') && !nombre.endsWith('.prueba.ts') && /['"`]activa['"`]/.test(readFileSync(ruta, 'utf8'))) encontrados.push(path.relative(path.join(RAIZ, 'servidor', 'src'), ruta))
    }
  }
  recorrer(path.join(RAIZ, 'servidor', 'src'))
  assert.deepEqual(encontrados.sort(), Object.keys(CONOCIDOS).sort(), 'un lugar nuevo que mira «activa» tiene que revisarse (y sumarse a CONOCIDOS)')
  // Y en la web y el MCP nadie mira el estado de la cuenta por su cuenta: todo pasa por cuentaDeUsuario.
  for (const [archivo, patron] of [
    ['oauth/recurso.ts', /cuentaDeUsuario\(/],
    ['oauth/token.ts', /cuentaDeUsuario\(/],
    ['api.ts', /cuentaDeUsuario\(/],
  ] as const)
    assert.match(readFileSync(path.join(RAIZ, 'servidor', 'src', archivo), 'utf8'), patron, `${archivo} usa cuentaDeUsuario`)
})

test('con la base SIN la migración (publicar antes de aplicarla): amigos, entrar y la lista se ven igual; solo pedir una cuenta falla', async () => {
  const antes = mkdtempSync(path.join(os.tmpdir(), 'telar-solicitudes-sin-'))
  try {
    for (const f of readdirSync(CARPETA).filter((n) => n.endsWith('.sql') && n < NOMBRE)) cpSync(path.join(CARPETA, f), path.join(antes, f))
    const db = await abrirPgliteEnMemoria()
    await migrar(db, antes)
    const a = await activa(db, 'ana')
    const lista = await listarAmigos(db, async () => 0)
    assert.equal(lista.length, 1, 'la lista de amigos se ve (sin saber cuáles pidieron su cuenta)')
    assert.equal(lista[0]!.porSolicitud, false)
    assert.equal(await contarPendientes(db), 0, 'la marca del menú da 0 en vez de romper')
    await assert.rejects(() => listarSolicitudes(db), 'las solicitudes sí fallan (el resto de Amigos lo tolera)')
    assert.ok(await cuentaDeUsuario(db, usuarioDeCookie(a), []), 'una cuenta activa sigue entrando')
    const dentro = await entrarTelar(db, 'ana@ejemplo.com', CLAVE)
    assert.ok(dentro && 'cuenta' in dentro)
    await assert.rejects(() => solicitarCuenta(db, datos('pablo')), 'pedir una cuenta falla: la base todavía no acepta «pendiente»')
    assert.equal(await contarAmigos(db), 1)
  } finally {
    rmSync(antes, { recursive: true, force: true })
  }
})
