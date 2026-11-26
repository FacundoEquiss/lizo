// Recuperar la contraseña SIN correo (docs/cuentas.md, «Recuperar la contraseña sin correo»). Telar no tiene servicio de mail, así que
// un amigo que olvida su contraseña tiene dos caminos, los dos con lo que ya hay:
//   1. Códigos de recuperación (autoservicio): al crear la cuenta se generan 8 códigos de un solo uso (XXXX-XXXX-XXXX, 60 bits cada
//      uno, en un alfabeto sin 0, 1, I ni O). Se muestran UNA vez; en la base queda solo sha256(sal + código), con una sal por código.
//      Un código vale como una contraseña: cambia la contraseña, se gasta y cierra las otras sesiones.
//   2. Restablecimiento por el dueño (asistido): un enlace de un solo uso que vence a las 24 horas (`/restablecer/<token>`, 32 bytes
//      al azar; en la base solo su sha256, como las invitaciones). El dueño NUNCA ve ni elige la contraseña: la pone el amigo.
// Reglas comunes:
//   · Todo lo que no sirve (mail inexistente, código malo, código usado, enlace inventado, vencido, usado o cancelado) contesta
//     EXACTAMENTE igual: no se cuenta qué mails existen ni por qué falló.
//   · Cada intento fallido cuenta contra un límite en la base (tabla `intentos`: por mail y por IP, por IP para los enlaces).
//   · Gastar un código o un enlace es una sola sentencia con `where usado_en is null`: dos pedidos a la vez con el mismo, gana uno.
//   · La contraseña nueva sube `version_sesion` (cierra las otras sesiones) y deja anotado «último restablecimiento».
//   · Nada de esto se loguea: ni los códigos, ni los tokens, ni las contraseñas.
// Quién puede generar un restablecimiento (solo la sesión del dueño) lo decide amigos-rutas.ts; acá no hay permisos.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { customAlphabet } from 'nanoid'
import {
  anotarIntento,
  claveCoincide,
  CUENTA_DUENO,
  hashClave,
  leerCuenta,
  MENSAJE_DEMASIADOS,
  normalizarEmail,
  olvidarIntentos,
  pasado,
  problemaConClave,
  type Cuenta,
} from './cuentas'
import type { Conexion } from './datos/conexion'
import { ErrorDominio } from './dominio/servicio'

/** Cuántos códigos de recuperación tiene una cuenta, y con cuántos o menos la pantalla avisa fuerte. */
export const CODIGOS_POR_CUENTA = 8
export const POCOS_CODIGOS = 2
/** El enlace de restablecimiento que genera el dueño vence a las 24 horas. */
export const HORAS_RESTABLECIMIENTO = 24

export const MENSAJE_RECUPERAR_MAL = 'El mail o el código de recuperación no son correctos, o ese código ya se usó.'
export const MENSAJE_ENLACE_NO_SIRVE = 'Este enlace ya no sirve. Pedile otro a quien te lo mandó.'

const idFila = customAlphabet('0123456789abcdefghijkmnpqrstuvwxyz', 12)

// ───── los códigos ─────

/** 32 símbolos (5 bits cada uno): sin 0, 1, I ni O, que se confunden al leerlos o copiarlos a mano. 12 símbolos = 60 bits. */
export const ALFABETO_CODIGOS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const LARGO_CODIGO = 12
export const FORMA_CODIGO = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/

/** Un código al azar: «K7M2-9QXA-WD4P». 256 es múltiplo de 32: `& 31` no sesga. */
export function nuevoCodigo(): string {
  const b = randomBytes(LARGO_CODIGO)
  let s = ''
  for (const x of b) s += ALFABETO_CODIGOS[x & 31]
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

/** Lo que se escribe (con o sin guiones, con espacios, en minúsculas) pasa a la forma que se guarda: solo letras y números, en mayúsculas. */
export const normalizarCodigo = (c: unknown) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const hashCodigo = (normalizado: string, sal: string) => createHash('sha256').update(`${sal}:${normalizado}`).digest('hex')
const igualesHex = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
// Con una sal y un hash que no son de nadie se hace la misma cuenta cuando el mail no existe (o tiene menos de 8 códigos).
const SAL_FALSA = randomBytes(16).toString('base64url')
const HASH_FALSO = hashCodigo('FALSO', SAL_FALSA)

/** Escribe 8 códigos nuevos de la cuenta y borra los anteriores. Tiene que correr adentro de una transacción con la fila de la cuenta trabada. */
async function reemplazarCodigos(tx: Conexion, cuenta: string): Promise<string[]> {
  await tx.consulta(`delete from codigos_recuperacion where cuenta = $1`, [cuenta])
  const codigos = new Set<string>()
  while (codigos.size < CODIGOS_POR_CUENTA) codigos.add(nuevoCodigo())
  for (const codigo of codigos) {
    const sal = randomBytes(16).toString('base64url')
    await tx.consulta(`insert into codigos_recuperacion (id, cuenta, sal, codigo_hash) values ($1, $2, $3, $4)`, [
      `c_${idFila()}`,
      cuenta,
      sal,
      hashCodigo(normalizarCodigo(codigo), sal),
    ])
  }
  return [...codigos]
}

/** Genera 8 códigos nuevos para la cuenta (los anteriores dejan de servir). Devuelve los códigos en claro: es la única vez que existen. */
export async function generarCodigos(db: Conexion, cuenta: string): Promise<string[]> {
  if (cuenta === CUENTA_DUENO) throw new ErrorDominio('La cuenta del dueño entra con la cuenta del juego: no usa códigos de recuperación.', 400)
  return db.transaccion(async (tx) => {
    const [c] = await tx.consulta(`select id from cuentas where id = $1 for update`, [cuenta])
    if (!c) throw new ErrorDominio('No existe esa cuenta.', 404)
    return reemplazarCodigos(tx, cuenta)
  })
}

export interface EstadoCodigos {
  restantes: number
  total: number
  /** Cuándo se generaron los últimos; null si la cuenta no tiene (cuentas anteriores a esta función). */
  generadosEn: string | null
}

export async function estadoCodigos(db: Conexion, cuenta: string): Promise<EstadoCodigos> {
  const [f] = await db.consulta<{ restantes: number; generados: string | null }>(
    `select count(*) filter (where usado_en is null)::int as restantes, max(creado_en) as generados from codigos_recuperacion where cuenta = $1`,
    [cuenta],
  )
  return { restantes: Number(f?.restantes ?? 0), total: CODIGOS_POR_CUENTA, generadosEn: f?.generados ? new Date(f.generados).toISOString() : null }
}

/** «Generar códigos nuevos» desde la cuenta: pide la contraseña actual (sirve el mismo límite que cambiarla) y deja los anteriores sin efecto. */
export type ResultadoCodigosNuevos = { ok: true; codigos: string[] } | { ok: false; estado: 401 | 400 | 429; error: string }
export async function generarCodigosConClave(db: Conexion, cuenta: string, clave: string): Promise<ResultadoCodigosNuevos> {
  if (await pasado(db, 'clave:cuenta', cuenta)) return { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }
  const [f] = await db.consulta(`select clave_hash from cuentas where id = $1 and clave_hash is not null`, [cuenta])
  if (!f) return { ok: false, estado: 400, error: 'Esta cuenta entra con la cuenta del juego: no usa códigos de recuperación.' }
  if (!(await claveCoincide(String(clave ?? ''), f.clave_hash))) {
    await anotarIntento(db, 'clave:cuenta', cuenta)
    return { ok: false, estado: 401, error: 'La contraseña no es esa.' }
  }
  await olvidarIntentos(db, 'clave:cuenta', cuenta)
  return { ok: true, codigos: await generarCodigos(db, cuenta) }
}

// ───── recuperar con un código ─────

export type ResultadoRecuperar =
  | { ok: true; cuenta: Cuenta; restantes: number }
  | { ok: false; estado: 400 | 401 | 403 | 429; error: string }

/**
 * «Olvidé mi contraseña»: mail + un código de recuperación + contraseña nueva. Si el código sirve: cambia la contraseña, gasta ESE código y
 * sube la versión de sesión (las otras sesiones se cierran). El mail inexistente, el código malo y el código usado dan lo mismo.
 */
export async function recuperarConCodigo(db: Conexion, d: { email: string; codigo: string; clave: string; ip: string }): Promise<ResultadoRecuperar> {
  const mail = normalizarEmail(d.email)
  if ((await pasado(db, 'recuperar:ip', d.ip)) || (mail && (await pasado(db, 'recuperar:mail', mail)))) return { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }
  // La regla de las contraseñas no depende de la cuenta (todavía no se mira): decirla no cuenta nada, y no gasta un intento.
  const problema = problemaConClave(d.clave, { email: mail })
  if (problema) return { ok: false, estado: 400, error: problema }

  const candidato = normalizarCodigo(d.codigo)
  // Siempre las dos lecturas (con una cuenta que no existe, la segunda va vacía) y siempre 8 comparaciones, en tiempo constante.
  const [cuenta] = mail ? await db.consulta(`select id, nombre, email, estado from cuentas where email = $1 and clave_hash is not null`, [mail]) : []
  const filas = await db.consulta<{ id: string; sal: string; codigo_hash: string }>(
    `select id, sal, codigo_hash from codigos_recuperacion where cuenta = $1 and usado_en is null`,
    [cuenta?.id ?? ''],
  )
  let acierto: string | null = null
  for (const f of filas) if (igualesHex(hashCodigo(candidato, f.sal), f.codigo_hash) && !acierto) acierto = f.id
  for (let i = filas.length; i < CODIGOS_POR_CUENTA; i++) igualesHex(hashCodigo(candidato, SAL_FALSA), HASH_FALSO)

  const fallo = async (): Promise<ResultadoRecuperar> => {
    await anotarIntento(db, 'recuperar:ip', d.ip)
    if (mail) await anotarIntento(db, 'recuperar:mail', mail)
    return { ok: false, estado: 401, error: MENSAJE_RECUPERAR_MAL }
  }
  if (!cuenta || !acierto) return fallo()
  // Con un código que sirve ya se puede decir lo demás: es la dueña de la cuenta. Una solicitud rechazada contesta como si no existiera
  // (no se le revela el rechazo); una pendiente SÍ puede cambiar su contraseña (la ruta no le abre la sesión: no gana acceso hasta que la aprueben).
  if (cuenta.estado === 'rechazada') return fallo()
  if (cuenta.estado !== 'activa' && cuenta.estado !== 'pendiente') return { ok: false, estado: 403, error: 'Esta cuenta está suspendida. Escribile al dueño de Telar.' }
  const mala = problemaConClave(d.clave, { email: cuenta.email ?? undefined, nombre: cuenta.nombre })
  if (mala) return { ok: false, estado: 400, error: mala }

  const claveHash = await hashClave(d.clave)
  const gastado = await db.transaccion(async (tx) => {
    // Una sola sentencia que vuelve a mirar todo: si otro pedido gastó el código (o se generaron nuevos) antes, no queda ninguna fila.
    const [g] = await tx.consulta(`update codigos_recuperacion set usado_en = now() where id = $1 and cuenta = $2 and usado_en is null returning id`, [acierto, cuenta.id])
    if (!g) return false
    await tx.consulta(
      `update cuentas set clave_hash = $2, version_sesion = version_sesion + 1, restablecida_en = now(), restablecida_por = 'codigo' where id = $1`,
      [cuenta.id, claveHash],
    )
    await tx.consulta(`update restablecimientos set cancelado_en = now() where cuenta = $1 and usado_en is null and cancelado_en is null`, [cuenta.id])
    return true
  })
  if (!gastado) return fallo()
  await olvidarIntentos(db, 'recuperar:mail', mail)
  await olvidarIntentos(db, 'entrar:mail', mail)
  const nueva = (await leerCuenta(db, cuenta.id))!
  return { ok: true, cuenta: nueva, restantes: (await estadoCodigos(db, cuenta.id)).restantes }
}

// ───── el restablecimiento del dueño ─────

export interface Restablecimiento {
  id: string
  creadoEn: string
  venceEn: string
}

const iso = (v: unknown) => new Date(v as string).toISOString()
const FORMA_TOKEN = /^[A-Za-z0-9_-]{43}$/ // 32 bytes en base64url

/** El sha256 (hex) del token: lo único que se guarda. */
export const hashTokenRestablecer = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * Genera el enlace de restablecimiento de la cuenta de un amigo (el token sale ACÁ y en ningún otro lado). Reemplaza al que hubiera
 * pendiente. No sirve para la cuenta del dueño ni para una suspendida. Quién lo pide ya lo verificó la ruta.
 */
export async function crearRestablecimiento(db: Conexion, cuenta: string, creadoPor: string): Promise<{ restablecimiento: Restablecimiento; token: string; nombre: string }> {
  if (cuenta === CUENTA_DUENO) throw new ErrorDominio('La cuenta del dueño entra con la cuenta del juego: su contraseña no se restablece acá.', 400)
  const token = randomBytes(32).toString('base64url')
  return db.transaccion(async (tx) => {
    const [c] = await tx.consulta(`select id, nombre, estado, clave_hash is not null as con_clave from cuentas where id = $1 for update`, [cuenta])
    if (!c) throw new ErrorDominio('No existe esa cuenta.', 404)
    if (!c.con_clave) throw new ErrorDominio('Esa cuenta entra con la cuenta del juego: su contraseña no se restablece acá.', 400)
    if (c.estado === 'pendiente' || c.estado === 'rechazada') throw new ErrorDominio(`${c.nombre || 'Esa cuenta'} todavía no está aprobada: es una solicitud.`, 409)
    if (c.estado !== 'activa') throw new ErrorDominio(`${c.nombre || 'Esa cuenta'} está suspendida. Reactivala primero y después restablecé su contraseña.`, 409)
    await tx.consulta(`update restablecimientos set cancelado_en = now() where cuenta = $1 and usado_en is null and cancelado_en is null`, [cuenta])
    const [f] = await tx.consulta(
      `insert into restablecimientos (id, cuenta, token_hash, creado_por, vence_en) values ($1, $2, $3, $4, now() + ($5::int * interval '1 hour'))
       returning id, creado_en, vence_en`,
      [`r_${idFila()}`, cuenta, hashTokenRestablecer(token), creadoPor, HORAS_RESTABLECIMIENTO],
    )
    return { restablecimiento: { id: f!.id as string, creadoEn: iso(f!.creado_en), venceEn: iso(f!.vence_en) }, token, nombre: c.nombre as string }
  })
}

/** Cancela el restablecimiento pendiente de la cuenta (el enlace deja de servir ya). 404 si no había ninguno. */
export async function cancelarRestablecimiento(db: Conexion, cuenta: string): Promise<void> {
  const filas = await db.consulta(
    `update restablecimientos set cancelado_en = now() where cuenta = $1 and usado_en is null and cancelado_en is null returning id`,
    [cuenta],
  )
  if (filas.length === 0) throw new ErrorDominio('Esa cuenta no tiene un restablecimiento pendiente.', 404)
}

interface FilaEnlace {
  id: string
  cuenta: string
  nombre: string
  email: string | null
  sirve: boolean
}

/** Busca el enlace por el hash del token y confirma el hash en tiempo constante. Null si no hay (o el token ni tiene la forma). */
async function buscarEnlace(db: Conexion, token: string): Promise<FilaEnlace | null> {
  if (typeof token !== 'string' || !FORMA_TOKEN.test(token)) return null
  const hash = hashTokenRestablecer(token)
  const [f] = await db.consulta(
    `select r.id, r.cuenta, r.token_hash, c.nombre, c.email,
            (r.usado_en is null and r.cancelado_en is null and r.vence_en > now() and c.estado = 'activa' and c.clave_hash is not null) as sirve
       from restablecimientos r join cuentas c on c.id = r.cuenta where r.token_hash = $1`,
    [hash],
  )
  if (!f || !igualesHex(String(f.token_hash), hash)) return null
  return { id: f.id, cuenta: f.cuenta, nombre: f.nombre ?? '', email: f.email ?? null, sirve: Boolean(f.sirve) }
}

export type ResultadoVerEnlace = { ok: true; nombre: string } | { ok: false; estado: 404 | 429; error: string }

/** La pantalla del enlace: dice a quién le toca si sirve; si no, siempre el mismo mensaje. No gasta nada. */
export async function verRestablecimiento(db: Conexion, token: string, ip: string): Promise<ResultadoVerEnlace> {
  if (await pasado(db, 'restablecer:ip', ip)) return { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }
  const f = await buscarEnlace(db, token)
  if (!f || !f.sirve) {
    await anotarIntento(db, 'restablecer:ip', ip)
    return { ok: false, estado: 404, error: MENSAJE_ENLACE_NO_SIRVE }
  }
  return { ok: true, nombre: f.nombre }
}

export type ResultadoCanjeEnlace =
  | { ok: true; cuenta: Cuenta; creadoPor: string; codigos: string[] }
  | { ok: false; estado: 400 | 404 | 429; error: string }

/**
 * Pone la contraseña nueva con el enlace: en UNA transacción gasta el enlace, cambia la contraseña (sube la versión de sesión: las otras
 * sesiones se cierran), anota el restablecimiento y deja 8 códigos de recuperación nuevos (los de antes pueden haberse perdido: no se
 * pueden dejar valiendo). El dueño no interviene en la contraseña: llega por acá, escrita por el amigo.
 */
export async function canjearRestablecimiento(db: Conexion, d: { token: string; clave: string; ip: string }): Promise<ResultadoCanjeEnlace> {
  if (await pasado(db, 'restablecer:ip', d.ip)) return { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }
  const f = await buscarEnlace(db, d.token)
  if (!f || !f.sirve) {
    await anotarIntento(db, 'restablecer:ip', d.ip)
    return { ok: false, estado: 404, error: MENSAJE_ENLACE_NO_SIRVE }
  }
  const problema = problemaConClave(d.clave, { email: f.email ?? undefined, nombre: f.nombre })
  if (problema) return { ok: false, estado: 400, error: problema }
  const claveHash = await hashClave(d.clave)
  const hash = hashTokenRestablecer(d.token)
  const r = await db.transaccion(async (tx) => {
    // Una sola sentencia que vuelve a mirar todo: si otro pedido llegó antes (o el dueño lo canceló), no queda ninguna fila.
    const [g] = await tx.consulta(
      `update restablecimientos set usado_en = now()
        where id = $1 and token_hash = $2 and usado_en is null and cancelado_en is null and vence_en > now() returning creado_por`,
      [f.id, hash],
    )
    if (!g) return null
    await tx.consulta(`select 1 from cuentas where id = $1 for update`, [f.cuenta])
    await tx.consulta(
      `update cuentas set clave_hash = $2, version_sesion = version_sesion + 1, restablecida_en = now(), restablecida_por = 'enlace' where id = $1`,
      [f.cuenta, claveHash],
    )
    await tx.consulta(`update restablecimientos set cancelado_en = now() where cuenta = $1 and usado_en is null and cancelado_en is null`, [f.cuenta])
    return { creadoPor: g.creado_por as string, codigos: await reemplazarCodigos(tx, f.cuenta) }
  })
  if (!r) {
    await anotarIntento(db, 'restablecer:ip', d.ip)
    return { ok: false, estado: 404, error: MENSAJE_ENLACE_NO_SIRVE }
  }
  if (f.email) await olvidarIntentos(db, 'entrar:mail', f.email)
  return { ok: true, cuenta: (await leerCuenta(db, f.cuenta))!, creadoPor: r.creadoPor, codigos: r.codigos }
}

// ───── lo que ve el dueño de cada amigo ─────

export interface EstadoRestablecimiento {
  /** El enlace pendiente (sin usar ni cancelar), si hay; `vencido` cuando ya pasaron las 24 horas. */
  pendiente: (Restablecimiento & { vencido: boolean }) | null
  /** El último cambio de contraseña sin la anterior: cuándo y por qué camino. */
  ultimo: { en: string; por: 'enlace' | 'codigo' } | null
}

/** Por cuenta: el restablecimiento pendiente y el último hecho. Una sola lectura de cada tabla (el listado de amigos no hace N consultas). */
export async function restablecimientosDe(db: Conexion): Promise<Map<string, EstadoRestablecimiento>> {
  const mapa = new Map<string, EstadoRestablecimiento>()
  const estado = (cuenta: string) => {
    let e = mapa.get(cuenta)
    if (!e) mapa.set(cuenta, (e = { pendiente: null, ultimo: null }))
    return e
  }
  const pendientes = await db.consulta(
    `select distinct on (cuenta) id, cuenta, creado_en, vence_en, (vence_en <= now()) as vencido
       from restablecimientos where usado_en is null and cancelado_en is null order by cuenta, creado_en desc`,
  )
  for (const f of pendientes) estado(f.cuenta).pendiente = { id: f.id, creadoEn: iso(f.creado_en), venceEn: iso(f.vence_en), vencido: Boolean(f.vencido) }
  const hechos = await db.consulta(`select id, restablecida_en, restablecida_por from cuentas where restablecida_en is not null`)
  for (const f of hechos) estado(f.id).ultimo = { en: iso(f.restablecida_en), por: f.restablecida_por === 'codigo' ? 'codigo' : 'enlace' }
  return mapa
}

/**
 * Los códigos de una cuenta que acaba de nacer. Si no se pueden generar (por ejemplo, la migración todavía no corrió) la cuenta igual
 * queda creada: devuelve null y la pantalla manda a generarlos desde Configuración → Cuenta.
 */
export async function codigosDeCuentaNueva(db: Conexion, cuenta: string): Promise<string[] | null> {
  try {
    return await generarCodigos(db, cuenta)
  } catch (e) {
    console.error('[tablero] recuperación: no pude generar los códigos de una cuenta nueva:', e instanceof Error ? e.message : 'error')
    return null
  }
}
