// Prueba de las invitaciones (servidor/src/amigos.ts y la migración 20261208090000_invitaciones.sql) en PGlite en memoria, con el
// mismo mecanismo de migraciones que usa el servidor: `npm run amigos:probar`. Sin red ni disco.
//   · La migración es aditiva, repetible, no nombra el esquema y deja la tabla con seguridad por fila y el tope duro de usos.
//   · El token (32 bytes) solo existe en lo que devuelve crear: en la base queda su sha256, en ninguna lista vuelve.
//   · Canjear: una invitación de un solo uso con dos pedidos a la vez deja UNA cuenta; una de N usos, N; el mail repetido y el tope
//     de amigos no gastan el uso; vencida, revocada, usada, inventada y alterada dan el mismo mensaje; el límite por IP frena.
//   · Hasta 20 pendientes a la vez (también si llegan juntas); los usos y los vencimientos son los permitidos.
// Lo que no prueba (lo hace scripts/probar-cuentas.mjs, con un Telar de verdad): sesión, rutas, 403 a la clave del MCP y a otras cuentas.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  canjearInvitacion,
  crearInvitacion,
  hashToken,
  listarAmigos,
  listarInvitaciones,
  MAX_PENDIENTES,
  MENSAJE_NO_SIRVE,
  ponerEstadoAmigo,
  revocarInvitacion,
  verInvitacion,
} from './amigos'
import { contarAmigos, MENSAJE_TOPE_AMIGOS, ponerTopeAmigos, registrar, topeAmigos } from './cuentas'
import type { Conexion } from './datos/conexion'
import { migrar } from './datos/migraciones'
import { abrirPgliteEnMemoria } from './datos/pglite'

const CARPETA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations')
const NOMBRE = '20261208090000_invitaciones.sql'
const SQL = readFileSync(path.join(CARPETA, NOMBRE), 'utf8')
const sinComentarios = SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const CLAVE = 'una frase larga de prueba'

async function base(): Promise<Conexion> {
  const db = await abrirPgliteEnMemoria()
  await migrar(db, CARPETA)
  return db
}
let ipN = 0
const ip = () => `10.1.${Math.floor(++ipN / 250)}.${ipN % 250}`
const datos = (token: string, n: string, extra: Record<string, string> = {}) => ({
  token,
  email: `${n}@ejemplo.com`,
  nombre: n[0]!.toUpperCase() + n.slice(1),
  clave: CLAVE,
  ip: ip(),
  ...extra,
})
async function falla(codigo: string, fn: () => Promise<unknown>) {
  await assert.rejects(fn, (e: any) => e?.code === codigo, `tenía que fallar con ${codigo}`)
}
async function dueno(db: Conexion) {
  await db.consulta(`insert into miembros (id, nombre, tipo, es_yo, propietario) values ('yo-dueno', 'Facundo', 'humano', true, 'dueno') on conflict do nothing`)
}

test('la migración es aditiva, repetible y deja la tabla blindada', async () => {
  assert.doesNotMatch(sinComentarios, /\btablero\b/i, 'no puede nombrar el esquema `tablero`')
  assert.doesNotMatch(sinComentarios, /\b(create\s+schema|set\s+search_path|drop|truncate|delete\s+from|grant|revoke)\b/i)
  assert.doesNotMatch(sinComentarios, /\balter\s+table\s+\w+\s+(drop|rename|alter)\b/i)
  assert.doesNotMatch(sinComentarios, /create\s+(unique\s+)?index\s+(?!if not exists)/i)
  assert.doesNotMatch(sinComentarios, /create\s+table\s+(?!if not exists)/i)
  assert.doesNotMatch(sinComentarios, /add\s+column\s+(?!if not exists)/i)
  const db = await base()
  await db.ejecutar(SQL) // dos veces: no falla
  await db.ejecutar(SQL)
  const [rls] = await db.consulta<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'invitaciones'`)
  assert.equal(rls?.relrowsecurity, true, 'seguridad por fila activada')
  const cols = (await db.consulta<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'cuentas'`)).map((c) => c.column_name)
  assert.ok(cols.includes('invitacion_id') && cols.includes('ajustes'))
  // el tope duro: ni a mano se gastan más usos que los de la invitación
  await db.consulta(`insert into invitaciones (id, propietario, token_hash, usos_max, vence_en) values ('i1', 'dueno', 'h1', 1, now() + interval '1 day')`)
  await falla('23514', () => db.consulta(`update invitaciones set usos = 2 where id = 'i1'`))
  await falla('23514', () => db.consulta(`insert into invitaciones (id, propietario, token_hash, nota, vence_en) values ('i2', 'dueno', 'h2', ${"'" + 'x'.repeat(61) + "'"}, now())`))
  await falla('23505', () => db.consulta(`insert into invitaciones (id, propietario, token_hash, vence_en) values ('i3', 'dueno', 'h1', now())`))
})

test('el token solo existe al crear: en la base queda su hash y en ninguna lista vuelve', async () => {
  const db = await base()
  const { invitacion, token } = await crearInvitacion(db, 'dueno', { nota: 'para Pablo' })
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, '32 bytes en base64url')
  assert.equal(invitacion.estado, 'pendiente')
  assert.equal(invitacion.usosMax, 1)
  assert.equal(invitacion.nota, 'para Pablo')
  const dias = (new Date(invitacion.venceEn).getTime() - Date.now()) / 86_400_000
  assert.ok(dias > 6.99 && dias < 7.01, `vence a los 7 días de fábrica (${dias})`)
  const filas = await db.consulta(`select * from invitaciones`)
  assert.equal(filas[0]!.token_hash, hashToken(token))
  assert.notEqual(filas[0]!.token_hash, token)
  // buscado en TODO el texto de la base (cada columna de cada tabla), el token en claro no está
  for (const t of (await db.consulta<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)).map((f) => f.tablename)) {
    const vol = JSON.stringify(await db.consulta(`select * from "${t}"`))
    assert.ok(!vol.includes(token), `el token en claro no está en la tabla ${t}`)
  }
  const lista = await listarInvitaciones(db, 'dueno')
  assert.ok(!JSON.stringify(lista).includes(token) && !JSON.stringify(lista).includes(hashToken(token)), 'la lista no trae ni el token ni su hash')
  assert.equal(lista.invitaciones[0]!.id, invitacion.id)
})

test('los usos y los vencimientos son los permitidos; la nota, de hasta 60', async () => {
  const db = await base()
  await assert.rejects(() => crearInvitacion(db, 'dueno', { usos: 2 }), /1, 5 o 10/)
  await assert.rejects(() => crearInvitacion(db, 'dueno', { venceDias: 3 }), /1, 7 o 30/)
  await assert.rejects(() => crearInvitacion(db, 'dueno', { nota: 'x'.repeat(61) }), /hasta 60/)
  for (const usos of [1, 5, 10]) assert.equal((await crearInvitacion(db, 'dueno', { usos })).invitacion.usosMax, usos)
  const { invitacion } = await crearInvitacion(db, 'dueno', { venceDias: 1, nota: '  ' })
  assert.equal(invitacion.nota, '')
  assert.ok(new Date(invitacion.venceEn).getTime() - Date.now() < 86_400_000 + 5000)
})

test('hasta 20 pendientes a la vez, también si las piden juntas; revocar o vencer libera lugar', async () => {
  const db = await base()
  const tandas = await Promise.allSettled(Array.from({ length: MAX_PENDIENTES + 5 }, () => crearInvitacion(db, 'dueno', {})))
  assert.equal(tandas.filter((t) => t.status === 'fulfilled').length, MAX_PENDIENTES)
  const rechazadas = tandas.filter((t): t is PromiseRejectedResult => t.status === 'rejected')
  assert.equal(rechazadas.length, 5)
  assert.match(String(rechazadas[0]!.reason.message), /20 invitaciones pendientes/)
  const { invitaciones, pendientes } = await listarInvitaciones(db, 'dueno')
  assert.equal(pendientes, MAX_PENDIENTES)
  await revocarInvitacion(db, 'dueno', invitaciones[0]!.id)
  assert.equal((await listarInvitaciones(db, 'dueno')).pendientes, MAX_PENDIENTES - 1)
  await crearInvitacion(db, 'dueno', {}) // hay lugar de nuevo
  await db.consulta(`update invitaciones set vence_en = now() - interval '1 minute' where id = $1`, [invitaciones[1]!.id])
  await crearInvitacion(db, 'dueno', {}) // una vencida tampoco cuenta
  await assert.rejects(() => crearInvitacion(db, 'dueno', {}), /pendientes/)
  // las de otra cuenta no cuentan ni se revocan desde acá (404 como una que no existe)
  await crearInvitacion(db, 'otra', {})
  await assert.rejects(() => revocarInvitacion(db, 'otra', invitaciones[2]!.id), /No existe esa invitación/)
  assert.equal((await listarInvitaciones(db, 'otra')).invitaciones.length, 1)
})

test('canjear: crea la cuenta, gasta el uso y la deja atada a su invitación', async () => {
  const db = await base()
  await dueno(db)
  const { invitacion, token } = await crearInvitacion(db, 'dueno', { nota: 'para Pablo' })
  const v = await verInvitacion(db, token, ip())
  assert.deepEqual(v, { ok: true, invitador: 'Facundo' })
  assert.equal((await listarInvitaciones(db, 'dueno')).invitaciones[0]!.usos, 0, 'mirar el enlace no gasta nada')
  const r = await canjearInvitacion(db, datos(token, 'pablo'))
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.cuenta.email, 'pablo@ejemplo.com')
  assert.equal(r.invitacion.nota, 'para Pablo')
  const [c] = await db.consulta(`select invitacion_id, clave_hash from cuentas where id = $1`, [r.cuenta.id])
  assert.equal(c!.invitacion_id, invitacion.id)
  assert.match(String(c!.clave_hash), /^scrypt\$/)
  const [inv] = (await listarInvitaciones(db, 'dueno')).invitaciones
  assert.equal(inv!.estado, 'usada')
  assert.equal(inv!.usos, 1)
  assert.ok(inv!.ultimoUsoEn)
  // los amigos con su origen
  const amigos = await listarAmigos(db, async () => 123)
  assert.equal(amigos.length, 1)
  assert.deepEqual({ ...amigos[0]!, id: '', desde: '', ultimoIngreso: null }, {
    id: '', nombre: 'Pablo', email: 'pablo@ejemplo.com', estado: 'activa', desde: '', ultimoIngreso: null,
    proyectos: 0, archivosBytes: 123, invitacion: 'para Pablo', porInvitacion: true, porSolicitud: false,
  })
})

test('una de un solo uso con dos pedidos a la vez deja una sola cuenta (y N usos, N cuentas)', async () => {
  const db = await base()
  await dueno(db)
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const { token } = await crearInvitacion(db, 'dueno', { usos: 1 })
    const antes = await contarAmigos(db)
    const rs = await Promise.all([canjearInvitacion(db, datos(token, `a${vuelta}`)), canjearInvitacion(db, datos(token, `b${vuelta}`))])
    assert.equal(rs.filter((r) => r.ok).length, 1, 'una sola entra')
    const perdedora = rs.find((r) => !r.ok)!
    assert.ok(!perdedora.ok && perdedora.estado === 404 && perdedora.error === MENSAJE_NO_SIRVE)
    assert.equal((await contarAmigos(db)) - antes, 1, 'nace una sola cuenta')
  }
  const { token, invitacion } = await crearInvitacion(db, 'dueno', { usos: 5 })
  const antes = await contarAmigos(db)
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => canjearInvitacion(db, datos(token, `m${i}`))))
  assert.equal(rs.filter((r) => r.ok).length, 5)
  assert.equal((await contarAmigos(db)) - antes, 5)
  const [f] = await db.consulta(`select usos from invitaciones where id = $1`, [invitacion.id])
  assert.equal(Number(f!.usos), 5)
  assert.equal((await db.consulta(`select 1 from cuentas where invitacion_id = $1`, [invitacion.id])).length, 5, 'cada cuenta nacida quedó atada a la invitación')
})

test('lo que falla no gasta el uso: mail repetido, datos malos y tope de amigos', async () => {
  const db = await base()
  await dueno(db)
  const { token } = await crearInvitacion(db, 'dueno', { usos: 1 })
  const uno = await canjearInvitacion(db, datos((await crearInvitacion(db, 'dueno', {})).token, 'ana'))
  assert.ok(uno.ok)
  const repetido = await canjearInvitacion(db, datos(token, 'ana'))
  assert.ok(!repetido.ok && repetido.estado === 409 && /Ya hay una cuenta/.test(repetido.error))
  const malo = await canjearInvitacion(db, datos(token, 'beto', { clave: 'corta' }))
  assert.ok(!malo.ok && malo.estado === 400 && /al menos 10/.test(malo.error))
  const sinMail = await canjearInvitacion(db, datos(token, 'beto', { email: 'no-es-un-mail' }))
  assert.ok(!sinMail.ok && sinMail.estado === 400)
  assert.equal((await listarInvitaciones(db, 'dueno')).invitaciones.find((i) => i.estado === 'pendiente' && i.usos === 0)?.usos, 0)
  // tope de amigos: con 1 de tope y 1 amigo, el canje dice que se alcanzó y no gasta el uso
  assert.equal(await topeAmigos(db), 15)
  await ponerTopeAmigos(db, 1)
  assert.equal(await topeAmigos(db), 1)
  const tope = await canjearInvitacion(db, datos(token, 'carla'))
  assert.ok(!tope.ok && tope.estado === 403 && tope.tope === true && tope.error === MENSAJE_TOPE_AMIGOS && tope.propietario === 'dueno')
  const [f] = await db.consulta(`select usos from invitaciones where token_hash = $1`, [hashToken(token)])
  assert.equal(Number(f!.usos), 0, 'el uso no se gastó')
  await ponerTopeAmigos(db, 2)
  assert.ok((await canjearInvitacion(db, datos(token, 'carla'))).ok, 'subiendo el tope, el mismo enlace sirve')
  await assert.rejects(() => ponerTopeAmigos(db, 0), /entre 1 y 100/)
  await assert.rejects(() => ponerTopeAmigos(db, 101), /entre 1 y 100/)
  await assert.rejects(() => ponerTopeAmigos(db, 2.5), /entre 1 y 100/)
})

test('el tope de amigos también corta el registro por el código de la variable, y dos registros a la vez no pasan los dos por el último lugar', async () => {
  const db = await base()
  await dueno(db)
  process.env.TABLERO_INVITACION = 'pase'
  try {
    await ponerTopeAmigos(db, 1)
    const cod = (n: string) => ({ email: `${n}@ejemplo.com`, nombre: n, clave: CLAVE, invitacion: 'pase', ip: ip() })
    const rs = await Promise.all([registrar(db, cod('uno')), registrar(db, cod('dos'))])
    assert.equal(rs.filter((r) => r.ok).length, 1)
    const perdedora = rs.find((r) => !r.ok)!
    assert.ok(!perdedora.ok && perdedora.tope === true)
    const { token } = await crearInvitacion(db, 'dueno', {})
    const c = await canjearInvitacion(db, datos(token, 'tres'))
    assert.ok(!c.ok && c.tope === true)
    assert.equal(await contarAmigos(db), 1)
  } finally {
    delete process.env.TABLERO_INVITACION
  }
})

test('vencida, revocada, usada, inventada y alterada dan el mismo mensaje (y sin cambiar nada)', async () => {
  const db = await base()
  await dueno(db)
  const buena = await crearInvitacion(db, 'dueno', {})
  const vencida = await crearInvitacion(db, 'dueno', {})
  await db.consulta(`update invitaciones set vence_en = now() - interval '1 second' where id = $1`, [vencida.invitacion.id])
  const revocada = await crearInvitacion(db, 'dueno', {})
  await revocarInvitacion(db, 'dueno', revocada.invitacion.id)
  const usada = await crearInvitacion(db, 'dueno', {})
  assert.ok((await canjearInvitacion(db, datos(usada.token, 'usuaria'))).ok)
  const alterado = buena.token.slice(0, -1) + (buena.token.endsWith('A') ? 'B' : 'A')
  const casos: [string, string][] = [
    ['vencida', vencida.token],
    ['revocada', revocada.token],
    ['usada', usada.token],
    ['alterada', alterado],
    ['inventada', 'x'.repeat(43)],
    ['corta', 'abc'],
    ['vacía', ''],
    ['con caracteres raros', "' or 1=1 --" + 'a'.repeat(40)],
  ]
  const antes = await contarAmigos(db)
  for (const [nombre, token] of casos) {
    const v = await verInvitacion(db, token, ip())
    assert.deepEqual(v, { ok: false, estado: 404, error: MENSAJE_NO_SIRVE }, `ver: ${nombre}`)
    const c = await canjearInvitacion(db, datos(token, `x${nombre.length}${Math.random().toString(36).slice(2, 6)}`))
    assert.ok(!c.ok && c.estado === 404 && c.error === MENSAJE_NO_SIRVE, `canjear: ${nombre}`)
  }
  assert.equal(await contarAmigos(db), antes, 'no nació ninguna cuenta')
  // la buena sigue sirviendo después de todo eso
  assert.ok((await canjearInvitacion(db, datos(buena.token, 'buena'))).ok)
  // y el mensaje no cuenta cuál fue la razón
  assert.ok(!/venc|revoc|usad/i.test(MENSAJE_NO_SIRVE))
})

test('el límite de intentos por IP frena los enlaces que no sirven (sin frenar al que llega con uno bueno desde otra IP)', async () => {
  const db = await base()
  await dueno(db)
  const mala = '0'.repeat(43)
  const IP = '203.0.113.9'
  for (let i = 0; i < 15; i++) {
    const v = await verInvitacion(db, mala, IP)
    assert.ok(!v.ok && v.estado === 404, `intento ${i + 1}`)
  }
  const frenado = await verInvitacion(db, mala, IP)
  assert.ok(!frenado.ok && frenado.estado === 429 && /Demasiados intentos/.test(frenado.error))
  const { token } = await crearInvitacion(db, 'dueno', {})
  const tambien = await canjearInvitacion(db, datos(token, 'bloqueada', { ip: IP }))
  assert.ok(!tambien.ok && tambien.estado === 429, 'con esa IP ni el canje de un enlace bueno pasa')
  assert.ok((await canjearInvitacion(db, datos(token, 'otraip', { ip: '203.0.113.10' }))).ok, 'desde otra IP, sí')
  const [{ n }] = await db.consulta<{ n: number }>(`select count(*)::int as n from intentos where clave like 'invitacion:ip:%'`)
  assert.ok(n >= 15)
  assert.ok(!(await db.consulta<{ clave: string }>(`select clave from intentos`)).some((f) => f.clave.includes(IP)), 'la IP no queda en claro')
})

test('suspender y reactivar a un amigo; la cuenta del dueño no se toca; una que no existe da 404', async () => {
  const db = await base()
  await dueno(db)
  const { token } = await crearInvitacion(db, 'dueno', {})
  const r = await canjearInvitacion(db, datos(token, 'susi'))
  assert.ok(r.ok)
  if (!r.ok) return
  await ponerEstadoAmigo(db, r.cuenta.id, 'suspendida')
  assert.equal((await listarAmigos(db, async () => 0))[0]!.estado, 'suspendida')
  assert.equal(await contarAmigos(db), 1, 'una suspendida sigue contando para el tope (sus datos siguen)')
  await ponerEstadoAmigo(db, r.cuenta.id, 'activa')
  assert.equal((await listarAmigos(db, async () => 0))[0]!.estado, 'activa')
  await assert.rejects(() => ponerEstadoAmigo(db, 'dueno', 'suspendida'), /no se suspende/)
  await assert.rejects(() => ponerEstadoAmigo(db, 'no-existe', 'suspendida'), /No existe esa cuenta/)
})
