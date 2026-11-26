// Prueba de recuperar la contraseña sin correo (servidor/src/recuperacion.ts y la migración 20261210090000_recuperacion.sql) en PGlite en
// memoria, con el mismo mecanismo de migraciones que usa el servidor: `npm run recuperacion:probar`. Sin red ni disco.
//   · La migración es aditiva, repetible, no nombra el esquema y deja las tablas con seguridad por fila.
//   · Los códigos: formato XXXX-XXXX-XXXX, 60 bits, sin 0, 1, I ni O, bien repartidos; 8 por cuenta; en la base solo queda sha256(sal +
//     código) y el código en claro no está en NINGUNA tabla.
//   · Usar un código cambia la contraseña, se gasta, sube la versión de sesión; el usado, el inventado, el de otra cuenta y el mail que no
//     existe contestan EXACTAMENTE igual; dos usos a la vez del mismo código: gana uno; el límite por mail y por IP frena.
//   · Generar códigos nuevos deja sin efecto los anteriores.
//   · El enlace del dueño: de un solo uso (también en carrera), vence a las 24 horas, cancelado no sirve, uno nuevo reemplaza al anterior,
//     solo para cuentas de amigos con contraseña; cambiar la contraseña por otro camino lo deja sin efecto; el token en claro no está en la base.
// Lo que no prueba (lo hace scripts/probar-cuentas.mjs con un Telar de verdad): sesión, rutas, 403 a la clave del MCP y a otras cuentas.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cambiarClave, claveCoincide, crearCuenta, hashClave, leerCuenta, MENSAJE_DEMASIADOS } from './cuentas'
import type { Conexion } from './datos/conexion'
import { migrar } from './datos/migraciones'
import { abrirPgliteEnMemoria } from './datos/pglite'
import {
  ALFABETO_CODIGOS,
  canjearRestablecimiento,
  cancelarRestablecimiento,
  CODIGOS_POR_CUENTA,
  crearRestablecimiento,
  estadoCodigos,
  FORMA_CODIGO,
  generarCodigos,
  generarCodigosConClave,
  hashTokenRestablecer,
  MENSAJE_ENLACE_NO_SIRVE,
  MENSAJE_RECUPERAR_MAL,
  normalizarCodigo,
  nuevoCodigo,
  recuperarConCodigo,
  restablecimientosDe,
  verRestablecimiento,
} from './recuperacion'

const CARPETA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations')
const NOMBRE = '20261210090000_recuperacion.sql'
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
const ip = () => `10.2.${Math.floor(++ipN / 250)}.${ipN % 250}`
const claveHashDePrueba = hashClave(CLAVE) // una sola vez: scrypt es lento
/** Una cuenta de amigo con sus 8 códigos. */
async function amigo(db: Conexion, n: string) {
  const r = await crearCuenta(db, { email: `${n}@ejemplo.com`, nombre: n[0]!.toUpperCase() + n.slice(1), claveHash: await claveHashDePrueba })
  assert.ok(r.ok, 'se crea la cuenta')
  const codigos = await generarCodigos(db, r.cuenta.id)
  return { id: r.cuenta.id, email: `${n}@ejemplo.com`, codigos }
}
const recuperar = (db: Conexion, email: string, codigo: string, clave = NUEVA, ipPedido = ip()) => recuperarConCodigo(db, { email, codigo, clave, ip: ipPedido })
/** Todo el texto de todas las tablas de la base, para buscar lo que no tiene que estar. */
async function textoDeLaBase(db: Conexion) {
  const partes: string[] = []
  for (const t of (await db.consulta<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)).map((f) => f.tablename))
    partes.push(JSON.stringify(await db.consulta(`select * from "${t}"`)))
  return partes.join('\n')
}

test('la migración es aditiva, repetible y deja las tablas blindadas', async () => {
  assert.doesNotMatch(sinComentarios, /\btablero\b/i, 'no puede nombrar el esquema `tablero`')
  assert.doesNotMatch(sinComentarios, /\b(create\s+schema|set\s+search_path|drop|truncate|delete\s+from|grant|revoke)\b/i)
  assert.doesNotMatch(sinComentarios, /\balter\s+table\s+\w+\s+(drop|rename|alter)\b/i)
  assert.doesNotMatch(sinComentarios, /create\s+(unique\s+)?index\s+(?!if not exists)/i)
  assert.doesNotMatch(sinComentarios, /create\s+table\s+(?!if not exists)/i)
  assert.doesNotMatch(sinComentarios, /add\s+column\s+(?!if not exists)/i)
  const db = await base()
  await db.ejecutar(SQL) // dos veces más: no falla
  await db.ejecutar(SQL)
  for (const t of ['codigos_recuperacion', 'restablecimientos']) {
    const [rls] = await db.consulta<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = $1`, [t])
    assert.equal(rls?.relrowsecurity, true, `seguridad por fila activada en ${t}`)
  }
  const cols = (await db.consulta<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'cuentas'`)).map((c) => c.column_name)
  assert.ok(cols.includes('restablecida_en') && cols.includes('restablecida_por'))
})

test('los códigos: formato, 60 bits, sin símbolos confusos y bien repartidos', () => {
  assert.equal(ALFABETO_CODIGOS.length, 32)
  assert.equal(new Set(ALFABETO_CODIGOS).size, 32)
  assert.ok(!/[01IO]/.test(ALFABETO_CODIGOS), 'sin 0, 1, I ni O')
  assert.equal(Math.log2(32 ** 12), 60, '12 símbolos de 5 bits = 60 bits')
  const cuenta: Record<string, number> = {}
  const vistos = new Set<string>()
  const N = 20_000
  for (let i = 0; i < N; i++) {
    const c = nuevoCodigo()
    assert.match(c, FORMA_CODIGO)
    vistos.add(c)
    for (const x of c.replace(/-/g, '')) cuenta[x] = (cuenta[x] ?? 0) + 1
  }
  assert.equal(vistos.size, N, 'ni uno repetido en 20.000')
  const esperado = (N * 12) / 32
  for (const x of ALFABETO_CODIGOS) assert.ok(Math.abs((cuenta[x] ?? 0) - esperado) < esperado * 0.1, `«${x}» sale ${cuenta[x]} veces (se esperan ~${esperado})`)
  assert.equal(Object.keys(cuenta).length, 32)
  assert.equal(normalizarCodigo(' k7m2-9qxa wd4p '), 'K7M29QXAWD4P', 'se aceptan minúsculas, espacios y sin guiones')
})

test('generar: 8 códigos por cuenta; en la base solo su hash con una sal por código, y en claro no está en ninguna tabla', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  assert.equal(a.codigos.length, CODIGOS_POR_CUENTA)
  assert.equal(new Set(a.codigos).size, CODIGOS_POR_CUENTA)
  assert.deepEqual(await estadoCodigos(db, a.id), { restantes: 8, total: 8, generadosEn: (await estadoCodigos(db, a.id)).generadosEn })
  const filas = await db.consulta<{ sal: string; codigo_hash: string }>(`select sal, codigo_hash from codigos_recuperacion where cuenta = $1`, [a.id])
  assert.equal(filas.length, 8)
  assert.equal(new Set(filas.map((f) => f.sal)).size, 8, 'una sal distinta por código')
  const hashes = new Set(filas.map((f) => f.codigo_hash))
  for (const c of a.codigos) {
    const norm = normalizarCodigo(c)
    assert.ok(filas.some((f) => f.codigo_hash === createHash('sha256').update(`${f.sal}:${norm}`).digest('hex')), 'hay una fila con sha256(sal:código)')
    assert.ok(!hashes.has(createHash('sha256').update(norm).digest('hex')), 'ni un sha256 sin sal')
  }
  const todo = await textoDeLaBase(db)
  for (const c of a.codigos) assert.ok(!todo.includes(c) && !todo.includes(normalizarCodigo(c)), `el código ${c.slice(0, 4)}… en claro no está en ninguna tabla`)
  await assert.rejects(() => generarCodigos(db, 'dueno'), /no usa códigos/)
  await assert.rejects(() => generarCodigos(db, 'noexiste'), /No existe/)
})

test('usar un código: cambia la contraseña, se gasta, cierra las otras sesiones y deja anotado el restablecimiento', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  const antes = (await leerCuenta(db, a.id))!
  const r = await recuperar(db, a.email, a.codigos[0]!)
  assert.ok(r.ok, JSON.stringify(r))
  assert.equal(r.restantes, 7)
  assert.equal(r.cuenta.versionSesion, antes.versionSesion + 1, 'sube la versión de sesión: las otras sesiones se cierran')
  const [f] = await db.consulta(`select clave_hash, restablecida_por, restablecida_en from cuentas where id = $1`, [a.id])
  assert.ok(await claveCoincide(NUEVA, f!.clave_hash), 'la contraseña nueva entra')
  assert.ok(!(await claveCoincide(CLAVE, f!.clave_hash)), 'la vieja ya no')
  assert.equal(f!.restablecida_por, 'codigo')
  assert.ok(f!.restablecida_en)
  assert.equal((await estadoCodigos(db, a.id)).restantes, 7)
  // el mismo código, otra vez: no sirve; los demás siguen sirviendo
  const otra = await recuperar(db, a.email, a.codigos[0]!, 'otra frase larga todavía')
  assert.deepEqual(otra, { ok: false, estado: 401, error: MENSAJE_RECUPERAR_MAL })
  const [g] = await db.consulta(`select clave_hash from cuentas where id = $1`, [a.id])
  assert.ok(await claveCoincide(NUEVA, g!.clave_hash), 'y la contraseña no cambió')
  // minúsculas, espacios y sin guiones
  const suelto = a.codigos[1]!.toLowerCase().replace(/-/g, ' ')
  assert.ok((await recuperar(db, ` ${a.email.toUpperCase()} `, suelto, 'una tercera frase larga')).ok, 'el mail y el código se aceptan como los escribe la gente')
  assert.equal((await estadoCodigos(db, a.id)).restantes, 6)
})

test('mail inexistente, código malo, código usado y código de otra cuenta contestan exactamente igual', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  const b = await amigo(db, 'beto')
  assert.ok((await recuperar(db, a.email, a.codigos[0]!)).ok)
  const casos = {
    'mail que no existe': await recuperar(db, 'nadie@ejemplo.com', a.codigos[1]!),
    'código inventado': await recuperar(db, a.email, nuevoCodigo()),
    'código ya usado': await recuperar(db, a.email, a.codigos[0]!),
    'código de otra cuenta': await recuperar(db, a.email, b.codigos[0]!),
    'mail de otra con mi código': await recuperar(db, b.email, a.codigos[2]!),
    'código vacío': await recuperar(db, a.email, ''),
    'mail vacío': await recuperar(db, '', a.codigos[2]!),
    'el dueño': await recuperar(db, 'dueno@ejemplo.com', a.codigos[2]!),
  }
  const esperado = JSON.stringify({ ok: false, estado: 401, error: MENSAJE_RECUPERAR_MAL })
  for (const [que, r] of Object.entries(casos)) assert.equal(JSON.stringify(r), esperado, `«${que}» contesta lo mismo`)
  // y los códigos de A y de B siguen intactos
  assert.equal((await estadoCodigos(db, a.id)).restantes, 7)
  assert.equal((await estadoCodigos(db, b.id)).restantes, 8)
  // la contraseña floja se dice antes (no depende de la cuenta ni gasta el código)
  const floja = await recuperar(db, b.email, b.codigos[0]!, 'corta')
  assert.ok(!floja.ok && floja.estado === 400 && /al menos 10/.test(floja.error))
  assert.equal((await estadoCodigos(db, b.id)).restantes, 8, 'una contraseña floja no gasta el código')
  const floja2 = await recuperar(db, 'nadie@ejemplo.com', nuevoCodigo(), 'corta')
  assert.deepEqual(floja2, floja, 'la contraseña floja da lo mismo con mail inexistente y con uno que existe')
})

test('dos usos a la vez del mismo código: gana uno solo', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const codigo = a.codigos[vuelta]!
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => recuperar(db, a.email, codigo, `frase de la carrera ${vuelta} numero ${i}`)))
    assert.equal(rs.filter((r) => r.ok).length, 1, `vuelta ${vuelta + 1}: de 6 pedidos a la vez, uno solo entra`)
    assert.equal(rs.filter((r) => !r.ok && r.estado === 401).length, 5, 'y los otros reciben lo mismo de siempre')
  }
  assert.equal((await estadoCodigos(db, a.id)).restantes, 5)
})

test('el límite de intentos frena por mail y por IP, aunque después llegue el código bueno', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  for (let i = 0; i < 8; i++) assert.equal((await recuperar(db, a.email, nuevoCodigo(), NUEVA, ip())).ok, false)
  const bueno = await recuperar(db, a.email, a.codigos[0]!, NUEVA, ip())
  assert.deepEqual(bueno, { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }, 'después de 8 fallidos por mail, frena (también desde otra IP)')
  assert.equal((await estadoCodigos(db, a.id)).restantes, 8, 'sin gastar nada')
  // por IP: muchos mails distintos desde la misma IP
  const misma = ip()
  for (let i = 0; i < 30; i++) await recuperar(db, `x${i}@ejemplo.com`, nuevoCodigo(), NUEVA, misma)
  const b = await amigo(db, 'beto')
  assert.deepEqual(await recuperar(db, b.email, b.codigos[0]!, NUEVA, misma), { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }, 'una IP que adivina 30 veces queda frenada')
  assert.ok((await recuperar(db, b.email, b.codigos[0]!, NUEVA, ip())).ok, 'desde otra IP, el código bueno sirve')
})

test('generar códigos nuevos deja sin efecto los anteriores; pide la contraseña actual', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  assert.ok((await recuperar(db, a.email, a.codigos[0]!)).ok)
  const mala = await generarCodigosConClave(db, a.id, 'no es esa')
  assert.deepEqual(mala, { ok: false, estado: 401, error: 'La contraseña no es esa.' })
  assert.equal((await estadoCodigos(db, a.id)).restantes, 7, 'con la contraseña mala no cambia nada')
  const nuevos = await generarCodigosConClave(db, a.id, NUEVA)
  assert.ok(nuevos.ok)
  assert.equal(nuevos.codigos.length, 8)
  assert.equal((await estadoCodigos(db, a.id)).restantes, 8)
  assert.equal((await db.consulta(`select 1 from codigos_recuperacion where cuenta = $1`, [a.id])).length, 8, 'los 7 viejos se borraron: quedan solo los 8 nuevos')
  assert.deepEqual(await recuperar(db, a.email, a.codigos[3]!, 'una frase larga más'), { ok: false, estado: 401, error: MENSAJE_RECUPERAR_MAL }, 'un código viejo ya no sirve')
  assert.ok((await recuperar(db, a.email, nuevos.codigos[0]!, 'una frase larga más')).ok, 'uno nuevo sí')
  // dos «generar» a la vez no dejan 16
  await Promise.all([generarCodigos(db, a.id), generarCodigos(db, a.id)])
  assert.equal((await db.consulta(`select 1 from codigos_recuperacion where cuenta = $1`, [a.id])).length, 8)
  // la mala contraseña repetida frena
  for (let i = 0; i < 8; i++) await generarCodigosConClave(db, a.id, 'no es esa')
  assert.deepEqual(await generarCodigosConClave(db, a.id, 'una frase larga más'), { ok: false, estado: 429, error: MENSAJE_DEMASIADOS })
  const dueno = await generarCodigosConClave(db, 'dueno', 'x')
  assert.ok(!dueno.ok && dueno.estado === 400)
})

test('el restablecimiento del dueño: un solo uso (también en carrera), 24 horas, cancelar, reemplazar', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  const { restablecimiento, token, nombre } = await crearRestablecimiento(db, a.id, 'dueno')
  assert.equal(nombre, 'Ana')
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, '32 bytes en base64url')
  const horas = (new Date(restablecimiento.venceEn).getTime() - Date.now()) / 3_600_000
  assert.ok(horas > 23.99 && horas <= 24, `vence en 24 horas (${horas})`)
  const [fila] = await db.consulta(`select * from restablecimientos where id = $1`, [restablecimiento.id])
  assert.equal(fila!.token_hash, hashTokenRestablecer(token))
  assert.notEqual(fila!.token_hash, token)
  const todo = await textoDeLaBase(db)
  assert.ok(!todo.includes(token), 'el token en claro no está en ninguna tabla')
  assert.deepEqual(await verRestablecimiento(db, token, ip()), { ok: true, nombre: 'Ana' }, 'ver no gasta nada')
  // en carrera: de 5 pedidos a la vez, entra uno
  const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => canjearRestablecimiento(db, { token, clave: `la frase de la carrera numero ${i}`, ip: ip() })))
  assert.equal(rs.filter((r) => r.ok).length, 1, 'uno solo entra')
  assert.equal(rs.filter((r) => !r.ok && r.estado === 404 && r.error === MENSAJE_ENLACE_NO_SIRVE).length, 4)
  const ganador = rs.find((r) => r.ok)
  assert.ok(ganador && ganador.ok)
  assert.equal(ganador.creadoPor, 'dueno')
  assert.equal(ganador.codigos.length, 8, 'deja 8 códigos nuevos (los de antes pueden haberse perdido)')
  assert.equal((await estadoCodigos(db, a.id)).restantes, 8)
  assert.deepEqual(await recuperar(db, a.email, a.codigos[0]!, 'una frase larga más'), { ok: false, estado: 401, error: MENSAJE_RECUPERAR_MAL }, 'los códigos de antes ya no sirven')
  const cuenta = (await leerCuenta(db, a.id))!
  assert.equal(cuenta.versionSesion, 2, 'cerró las otras sesiones')
  const [c] = await db.consulta(`select restablecida_por from cuentas where id = $1`, [a.id])
  assert.equal(c!.restablecida_por, 'enlace')
  // ya usado
  assert.deepEqual(await canjearRestablecimiento(db, { token, clave: 'una frase larga más', ip: ip() }), { ok: false, estado: 404, error: MENSAJE_ENLACE_NO_SIRVE })
  assert.deepEqual(await verRestablecimiento(db, token, ip()), { ok: false, estado: 404, error: MENSAJE_ENLACE_NO_SIRVE })

  // reemplazar: el segundo cancela al primero
  const uno = await crearRestablecimiento(db, a.id, 'dueno')
  const dos = await crearRestablecimiento(db, a.id, 'dueno')
  assert.equal((await verRestablecimiento(db, uno.token, ip())).ok, false, 'el primero ya no sirve')
  assert.equal((await verRestablecimiento(db, dos.token, ip())).ok, true)
  const estado = (await restablecimientosDe(db)).get(a.id)
  assert.equal(estado?.pendiente?.id, dos.restablecimiento.id)
  assert.equal(estado?.pendiente?.vencido, false)
  assert.equal(estado?.ultimo?.por, 'enlace')
  // cancelar
  await cancelarRestablecimiento(db, a.id)
  assert.equal((await verRestablecimiento(db, dos.token, ip())).ok, false, 'cancelado no sirve')
  assert.equal((await restablecimientosDe(db)).get(a.id)?.pendiente, null)
  await assert.rejects(() => cancelarRestablecimiento(db, a.id), /no tiene un restablecimiento pendiente/)
  // y no se puede canjear aunque se conozca el token
  assert.deepEqual(await canjearRestablecimiento(db, { token: dos.token, clave: 'una frase larga más', ip: ip() }), { ok: false, estado: 404, error: MENSAJE_ENLACE_NO_SIRVE })
})

test('el enlace vence a las 24 horas y todo lo que no sirve contesta igual', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  const vencido = await crearRestablecimiento(db, a.id, 'dueno')
  await db.consulta(`update restablecimientos set vence_en = now() - interval '1 minute' where id = $1`, [vencido.restablecimiento.id])
  const estado = (await restablecimientosDe(db)).get(a.id)
  assert.equal(estado?.pendiente?.vencido, true, 'el dueño lo ve «vencido»')
  const inventado = nuevoCodigoToken()
  const alterado = vencido.token.slice(0, -1) + (vencido.token.endsWith('A') ? 'B' : 'A')
  const respuestas = new Set<string>()
  for (const token of [vencido.token, inventado, alterado, 'abc', '', "' or 1=1 --" + 'a'.repeat(40)]) {
    respuestas.add(JSON.stringify(await verRestablecimiento(db, token, ip())))
    respuestas.add(JSON.stringify(await canjearRestablecimiento(db, { token, clave: 'una frase larga más', ip: ip() })))
  }
  assert.deepEqual([...respuestas], [JSON.stringify({ ok: false, estado: 404, error: MENSAJE_ENLACE_NO_SIRVE })], 'la misma respuesta para todas')
  const [c] = await db.consulta(`select version_sesion from cuentas where id = $1`, [a.id])
  assert.equal(c!.version_sesion, 1, 'nada cambió')
  // el límite por IP
  const gen = ip()
  let ultimo: unknown
  for (let i = 0; i < 16; i++) ultimo = await verRestablecimiento(db, nuevoCodigoToken(), gen)
  assert.deepEqual(ultimo, { ok: false, estado: 429, error: MENSAJE_DEMASIADOS })
})
const nuevoCodigoToken = () => createHash('sha256').update(String(Math.random())).digest('base64url')

test('el restablecimiento es solo para amigos con contraseña: no para el dueño, ni una cuenta que no existe ni una suspendida', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  await assert.rejects(() => crearRestablecimiento(db, 'dueno', 'dueno'), /entra con la cuenta del juego/)
  await assert.rejects(() => crearRestablecimiento(db, 'noexiste', 'dueno'), (e: any) => e.estado === 404)
  await db.consulta(`insert into cuentas (id, nombre) values ('dueno2', 'Sin clave') on conflict do nothing`)
  await assert.rejects(() => crearRestablecimiento(db, 'dueno2', 'dueno'), /entra con la cuenta del juego/)
  const { token } = await crearRestablecimiento(db, a.id, 'dueno')
  await db.consulta(`update cuentas set estado = 'suspendida' where id = $1`, [a.id])
  await assert.rejects(() => crearRestablecimiento(db, a.id, 'dueno'), (e: any) => e.estado === 409 && /suspendida/.test(e.message))
  assert.equal((await verRestablecimiento(db, token, ip())).ok, false, 'el enlace de una cuenta suspendida no sirve')
  const susp = await recuperar(db, a.email, a.codigos[0]!)
  assert.ok(!susp.ok && susp.estado === 403 && /suspendida/.test(susp.error), 'con un código bueno, una cuenta suspendida lo oye')
  assert.equal((await estadoCodigos(db, a.id)).restantes, 8, 'y el código no se gasta')
})

test('cambiar la contraseña o usar un código deja sin efecto el enlace pendiente', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  const uno = await crearRestablecimiento(db, a.id, 'dueno')
  const r = await cambiarClave(db, a.id, CLAVE, NUEVA)
  assert.ok(r.ok)
  assert.equal((await verRestablecimiento(db, uno.token, ip())).ok, false, 'cambiarla desde la cuenta cancela el enlace pendiente')
  const dos = await crearRestablecimiento(db, a.id, 'dueno')
  assert.ok((await recuperar(db, a.email, a.codigos[0]!, 'otra frase larga más')).ok)
  assert.equal((await verRestablecimiento(db, dos.token, ip())).ok, false, 'y usar un código también')
})

test('tokens, códigos y contraseñas en claro no están en ninguna tabla después de todo eso', async () => {
  const db = await base()
  const a = await amigo(db, 'ana')
  const e = await crearRestablecimiento(db, a.id, 'dueno')
  const c = await canjearRestablecimiento(db, { token: e.token, clave: 'una clave nueva única 9981', ip: ip() })
  assert.ok(c.ok)
  const todo = await textoDeLaBase(db)
  for (const sec of [e.token, ...a.codigos, ...c.codigos, 'una clave nueva única 9981'].flatMap((s) => [s, normalizarCodigo(s)]))
    if (sec.length > 8) assert.ok(!todo.includes(sec), `«${sec.slice(0, 4)}…» no está en la base`)
})
