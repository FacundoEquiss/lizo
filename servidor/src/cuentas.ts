// Cuentas propias de Telar (docs/cuentas.md): cada persona se registra con su mail, su nombre y su contraseña, y tiene su
// base propia. La cuenta 'dueno' es la de siempre (la del juego, TABLERO_USUARIOS, y la clave del MCP): no tiene contraseña
// de Telar ni topes.
//   · Hay dos maneras de crear una cuenta. Con una invitación (el enlace que el dueño genera desde Configuración → Amigos o, por
//     compatibilidad, el código de la variable TABLERO_INVITACION) la cuenta nace `activa`: pasan por `crearCuenta`, que respeta el
//     tope de cuentas de amigos. Sin invitación (la solicitud abierta, solicitudes.ts) la cuenta nace `pendiente` y no entra a nada
//     hasta que el dueño la apruebe: así nadie llena la base (que cuesta plata) ni entra sin que el dueño lo sepa.
//   · La contraseña se guarda con scrypt (node:crypto) y sal propia; nunca se registra ni se devuelve. Las comparaciones son
//     de tiempo constante, y un mail que no existe tarda lo mismo que uno con la contraseña mala (y da el mismo mensaje).
//   · Límite de intentos en la base (tabla `intentos`): Vercel no guarda memoria entre pedidos.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { customAlphabet } from 'nanoid'
import { CUENTA_DUENO } from './datos/almacen'
import type { Conexion } from './datos/conexion'

export { CUENTA_DUENO }

/** Prefijo del usuario de la cookie (y del `sub` de OAuth) de una cuenta de Telar: «t:<id>». Lo demás son cuentas del juego. */
export const PREFIJO_TELAR = 't:'
export const nuevoIdCuenta = customAlphabet('0123456789abcdefghijkmnpqrstuvwxyz', 12)

/** Topes de una cuenta nueva (cuidan el costo de la base). 'dueno' no tiene. */
export const TOPES = { proyectos: 20, objetosLienzo: 100_000, archivosMb: 200, archivoMb: 4 } as const

// scrypt: N = 2^15, r = 8, p = 1 (32 MB de memoria, ~100 ms). Alcanza para una función de Vercel y frena el probar a ciegas.
const N = 32768
const R = 8
const P = 1
const LARGO = 32
const MEMORIA = 64 * 1024 * 1024

function scrypt(clave: string, sal: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  const op: ScryptOptions = { N: n, r, p, maxmem: MEMORIA }
  return new Promise((ok, mal) => scryptCb(clave.normalize('NFC'), sal, LARGO, op, (e, d) => (e ? mal(e) : ok(d))))
}

/** El hash para guardar: «scrypt$N$r$p$sal$hash». */
export async function hashClave(clave: string): Promise<string> {
  const sal = randomBytes(16)
  const h = await scrypt(clave, sal)
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64url')}$${h.toString('base64url')}`
}

/** ¿La contraseña coincide con el hash guardado? (tiempo constante) */
export async function claveCoincide(clave: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$')
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false
  const [, n, r, p, sal, hash] = partes as [string, string, string, string, string, string]
  const esperado = Buffer.from(hash, 'base64url')
  const h = await scrypt(clave, Buffer.from(sal, 'base64url'), Number(n), Number(r), Number(p))
  return h.length === esperado.length && timingSafeEqual(h, esperado)
}

// Para un mail que no existe se hace la misma cuenta contra un hash cualquiera: tarda lo mismo que una contraseña mala.
let hashFalso: Promise<string> | null = null
const falso = () => (hashFalso ??= hashClave(randomBytes(12).toString('hex')))

// ───── reglas ─────

// Las más usadas de 10 caracteres o más (y las de acá). La regla de verdad es el largo; esto saca las obvias.
const COMUNES = new Set([
  '1234567890', '0123456789', '12345678910', '1234567891', '0987654321', '1111111111', '0000000000', '1122334455',
  'qwertyuiop', 'asdfghjkl1', 'qwerty1234', 'qwerty12345', '1q2w3e4r5t', 'q1w2e3r4t5', 'zxcvbnm123', 'abcdefghij',
  'password12', 'password123', 'password1234', 'passw0rd123', 'iloveyou12', 'contrasena', 'contraseña', 'contrasena1',
  'contraseña1', 'contrasena123', 'contraseña123', 'micontrasena', 'micontraseña', 'administrador', 'telartelar',
  'telar12345', 'telar123456', 'restaurant', 'restaurantcity', 'argentina1', 'argentina123', 'bocajuniors', 'riverplate',
  'facundo123', 'holahola12', 'holamundo1', 'superman123', 'dragonball', 'pokemon123', 'futbol1234', 'mipassword',
])

export const MIN_CLAVE = 10

/** Qué tiene de malo una contraseña nueva (o null si está bien). */
export function problemaConClave(clave: string, op: { email?: string; nombre?: string } = {}): string | null {
  if (typeof clave !== 'string' || clave.length < MIN_CLAVE) return `La contraseña tiene que tener al menos ${MIN_CLAVE} caracteres.`
  if (clave.length > 200) return 'La contraseña puede tener hasta 200 caracteres.'
  const baja = clave.toLowerCase()
  if (COMUNES.has(baja) || /^(.)\1+$/.test(clave)) return 'Esa contraseña es de las más usadas: elegí otra (una frase corta sirve).'
  if (op.email && baja === op.email.toLowerCase()) return 'La contraseña no puede ser tu mail.'
  if (op.email && baja === op.email.toLowerCase().split('@')[0]) return 'La contraseña no puede ser tu mail.'
  if (op.nombre && baja.replace(/\s/g, '') === op.nombre.toLowerCase().replace(/\s/g, '')) return 'La contraseña no puede ser tu nombre.'
  return null
}

export const normalizarEmail = (email: string) => String(email ?? '').trim().toLowerCase()
export const emailValido = (email: string) => email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

// ───── límite de intentos ─────

/** Ventana y tope de cada clase de intento. */
const LIMITES = {
  'entrar:mail': { max: 8, minutos: 15 },
  'entrar:ip': { max: 30, minutos: 15 },
  'registro:ip': { max: 8, minutos: 60 },
  // Pedir una cuenta sin invitación (solicitudes.ts): 5 por hora y por IP (cada pedido válido cuenta, salga bien o mal).
  'solicitud:ip': { max: 5, minutos: 60 },
  'clave:cuenta': { max: 8, minutos: 15 },
  // Enlaces de invitación que no sirven (inventados, alterados, vencidos…): 15 por hora y por IP, se pregunte o se canjee.
  'invitacion:ip': { max: 15, minutos: 60 },
  // Recuperar la contraseña sin correo (recuperacion.ts): un código de recuperación que no sirve (8 por mail cada 15 minutos y 30 por IP),
  // y enlaces de restablecimiento que no sirven (15 por IP por hora, se pregunte o se canjee).
  'recuperar:mail': { max: 8, minutos: 15 },
  'recuperar:ip': { max: 30, minutos: 15 },
  'restablecer:ip': { max: 15, minutos: 60 },
} as const
type ClaseIntento = keyof typeof LIMITES

const claveIntento = (clase: ClaseIntento, valor: string) =>
  `${clase}:${createHash('sha256').update(valor).digest('hex').slice(0, 32)}` // el mail o la IP no quedan en claro

export async function pasado(db: Conexion, clase: ClaseIntento, valor: string): Promise<boolean> {
  const l = LIMITES[clase]
  const [f] = await db.consulta<{ n: number }>(
    `select count(*)::int as n from intentos where clave = $1 and en > now() - ($2::int * interval '1 minute')`,
    [claveIntento(clase, valor), l.minutos],
  )
  return Number(f?.n ?? 0) >= l.max
}

export async function anotarIntento(db: Conexion, clase: ClaseIntento, valor: string) {
  await db.consulta(`insert into intentos (clave) values ($1)`, [claveIntento(clase, valor)])
  if (Math.random() < 0.02) await db.consulta(`delete from intentos where en < now() - interval '1 day'`).catch(() => {})
}

export async function olvidarIntentos(db: Conexion, clase: ClaseIntento, valor: string) {
  await db.consulta(`delete from intentos where clave = $1`, [claveIntento(clase, valor)])
}

export const MENSAJE_DEMASIADOS = 'Demasiados intentos. Esperá unos minutos y probá de nuevo.'

// ───── cuentas ─────

/**
 * El estado de una cuenta. SOLO `activa` entra (sesión, OAuth, MCP, eventos, archivos): `suspendida` la frenó el dueño, `pendiente` es una
 * solicitud que todavía espera su aprobación y `rechazada` es una que dijo que no (solicitudes.ts). Lo dice `puedeEntrar`, un solo lugar.
 */
export type EstadoCuenta = 'activa' | 'suspendida' | 'pendiente' | 'rechazada'
export const puedeEntrar = (estado: string | null | undefined) => estado === 'activa'

export interface Cuenta {
  id: string
  email: string | null
  nombre: string
  estado: EstadoCuenta
  versionSesion: number
  creadoEn: string
  ultimoIngreso: string | null
}

export const aCuenta = (f: Record<string, any>): Cuenta => ({
  id: f.id,
  email: f.email ?? null,
  nombre: f.nombre ?? '',
  estado: f.estado,
  versionSesion: Number(f.version_sesion ?? 1),
  creadoEn: new Date(f.creado_en).toISOString(),
  ultimoIngreso: f.ultimo_ingreso ? new Date(f.ultimo_ingreso).toISOString() : null,
})

export async function leerCuenta(db: Conexion, id: string): Promise<Cuenta | null> {
  const [f] = await db.consulta(`select * from cuentas where id = $1`, [id])
  return f ? aCuenta(f) : null
}

/** El usuario de la cookie de una cuenta de Telar: «t:<id>:<versión>». */
export const usuarioDeCookie = (c: Pick<Cuenta, 'id' | 'versionSesion'>) => `${PREFIJO_TELAR}${c.id}:${c.versionSesion}`
/** El usuario de OAuth (sin versión: los conectores no se desconectan al cambiar la contraseña). */
export const usuarioDeOAuth = (id: string) => `${PREFIJO_TELAR}${id}`

/**
 * De qué cuenta es un usuario (el de la cookie o el `sub` de OAuth), o null si ya no puede entrar: cuenta inexistente,
 * suspendida, pendiente de aprobación, rechazada o (en la cookie) de una versión de sesión vieja. Es EL lugar por donde pasan la web, el MCP,
 * OAuth, los eventos y los archivos: lo que no es `activa` no entra a ninguno. Las cuentas del juego de TABLERO_USUARIOS son 'dueno'.
 */
export async function cuentaDeUsuario(
  db: Conexion,
  usuario: string,
  usuariosJuego: string[],
): Promise<{ cuenta: string; oauth: string } | null> {
  if (!usuario) return null
  if (!usuario.startsWith(PREFIJO_TELAR)) return usuariosJuego.includes(usuario) ? { cuenta: CUENTA_DUENO, oauth: usuario } : null
  const [id, version] = usuario.slice(PREFIJO_TELAR.length).split(':')
  if (!id || id === CUENTA_DUENO) return null
  const c = await leerCuenta(db, id)
  if (!c || !puedeEntrar(c.estado)) return null
  if (version !== undefined && Number(version) !== c.versionSesion) return null
  // «Último ingreso» que ve el dueño: la cookie dura 30 días y no pasa por la contraseña, así que se anota como mucho una vez por hora.
  if (!c.ultimoIngreso || Date.now() - new Date(c.ultimoIngreso).getTime() > 3_600_000)
    await db.consulta(`update cuentas set ultimo_ingreso = now() where id = $1`, [c.id]).catch(() => {})
  return { cuenta: c.id, oauth: usuarioDeOAuth(c.id) }
}

export type ResultadoCuenta =
  | { ok: true; cuenta: Cuenta }
  // `tope`: no se pudo porque se llegó al tope de cuentas de amigos (quien llama avisa al dueño en la campana).
  | { ok: false; estado: 400 | 401 | 403 | 404 | 409 | 429; error: string; tope?: true }

/** El registro por el código de la variable (compatibilidad) está abierto solo si el dueño cargó TABLERO_INVITACION. */
export const registroAbierto = () => Boolean((process.env.TABLERO_INVITACION || '').trim())

function invitacionValida(codigo: string): boolean {
  const esperado = (process.env.TABLERO_INVITACION || '').trim()
  if (!esperado) return false
  const a = createHash('sha256').update(String(codigo ?? '').trim()).digest()
  const b = createHash('sha256').update(esperado).digest()
  return timingSafeEqual(a, b)
}

/** Lo que se puede decir del mail, el nombre y la contraseña antes de tocar la base (el servidor lo mira todo, la pantalla lo adelanta). */
export function datosDeRegistro(d: { email: string; nombre: string; clave: string }): { email: string; nombre: string } | { error: string } {
  const email = normalizarEmail(d.email)
  const nombre = String(d.nombre ?? '').trim()
  if (!emailValido(email)) return { error: 'Escribí un mail válido (por ejemplo nombre@gmail.com).' }
  if (!nombre) return { error: 'Escribí tu nombre.' }
  if (nombre.length > 40) return { error: 'El nombre puede tener hasta 40 caracteres.' }
  const problema = problemaConClave(d.clave, { email, nombre })
  if (problema) return { error: problema }
  return { email, nombre }
}

// ───── tope de cuentas de amigos ─────

/** Cuántas cuentas de amigos puede tener el dueño: de fábrica 15, editable de 1 a 100 (Configuración → Amigos). */
export const TOPE_AMIGOS = { fabrica: 15, min: 1, max: 100 } as const
export const MENSAJE_TOPE_AMIGOS = 'Por ahora Telar no puede abrir más cuentas. Ya le avisamos a quien te invitó.'

export async function topeAmigos(db: Conexion): Promise<number> {
  const [f] = await db.consulta<{ n: string | null }>(`select ajustes ->> 'topeAmigos' as n from cuentas where id = $1`, [CUENTA_DUENO])
  const n = Number(f?.n)
  return Number.isInteger(n) && n >= TOPE_AMIGOS.min && n <= TOPE_AMIGOS.max ? n : TOPE_AMIGOS.fabrica
}

/**
 * Las cuentas de amigos: las activas y las suspendidas (sus datos siguen en la base). Las solicitudes (`pendiente`, `rechazada`) no cuentan:
 * todavía no son amigos, y el tope se mira recién al aprobarlas.
 */
export async function contarAmigos(db: Conexion): Promise<number> {
  const [f] = await db.consulta<{ n: number }>(`select count(*)::int as n from cuentas where id <> $1 and estado in ('activa', 'suspendida')`, [CUENTA_DUENO])
  return Number(f?.n ?? 0)
}

export async function ponerTopeAmigos(db: Conexion, n: number) {
  if (!Number.isInteger(n) || n < TOPE_AMIGOS.min || n > TOPE_AMIGOS.max)
    throw new Error(`El tope tiene que ser un número entero entre ${TOPE_AMIGOS.min} y ${TOPE_AMIGOS.max}.`)
  await db.consulta(`update cuentas set ajustes = jsonb_set(ajustes, '{topeAmigos}', to_jsonb($2::int)) where id = $1`, [CUENTA_DUENO, n])
}

class CortaRegistro extends Error {
  constructor(readonly resultado: Extract<ResultadoCuenta, { ok: false }>) {
    super(resultado.error)
  }
}

/**
 * Crea la cuenta (una sola transacción). El tope de cuentas de amigos se mira con la fila del dueño trabada: dos registros a la vez
 * no pasan los dos por el último lugar. `antes` corre adentro, con ese mismo candado, y puede cortar (por ejemplo, gastar el uso de
 * una invitación): si corta o si falla el alta (el mail ya existe), no se gasta nada.
 */
export async function crearCuenta(
  db: Conexion,
  d: { email: string; nombre: string; claveHash: string; invitacionId?: string | null },
  antes?: (tx: Conexion) => Promise<Extract<ResultadoCuenta, { ok: false }> | null>,
): Promise<ResultadoCuenta> {
  // El tope se lee antes (con la base sin migrar, sin la columna `ajustes`, valen los 15 de fábrica y el registro por código sigue andando).
  const tope = await topeAmigos(db).catch(() => TOPE_AMIGOS.fabrica)
  try {
    return await db.transaccion(async (tx) => {
      await tx.consulta(`select 1 from cuentas where id = $1 for update`, [CUENTA_DUENO])
      if ((await contarAmigos(tx)) >= tope) throw new CortaRegistro({ ok: false, estado: 403, error: MENSAJE_TOPE_AMIGOS, tope: true })
      const [existe] = await tx.consulta(`select 1 from cuentas where email = $1`, [d.email])
      if (existe) throw new CortaRegistro({ ok: false, estado: 409, error: 'Ya hay una cuenta con ese mail. Entrá con tu contraseña.' })
      const corte = await antes?.(tx)
      if (corte) throw new CortaRegistro(corte)
      // Sin invitación (el código de la variable) no se nombra la columna nueva: anda también con la base sin migrar.
      const [f] = d.invitacionId
        ? await tx.consulta(
            `insert into cuentas (id, email, nombre, clave_hash, ultimo_ingreso, invitacion_id) values ($1, $2, $3, $4, now(), $5) returning *`,
            [nuevoIdCuenta(), d.email, d.nombre, d.claveHash, d.invitacionId],
          )
        : await tx.consulta(`insert into cuentas (id, email, nombre, clave_hash, ultimo_ingreso) values ($1, $2, $3, $4, now()) returning *`, [
            nuevoIdCuenta(),
            d.email,
            d.nombre,
            d.claveHash,
          ])
      return { ok: true as const, cuenta: aCuenta(f!) }
    })
  } catch (e) {
    if (e instanceof CortaRegistro) return e.resultado
    // el índice único del mail corta el segundo de dos registros simultáneos con el mismo mail; cualquier otro error es un error de verdad
    if ((e as { code?: string })?.code === '23505') return { ok: false, estado: 409, error: 'Ya hay una cuenta con ese mail. Entrá con tu contraseña.' }
    throw e
  }
}

/** Registrarse con el código de la variable TABLERO_INVITACION (compatibilidad). Crea la cuenta; su miembro «yo» lo crea quien llama. */
export async function registrar(
  db: Conexion,
  d: { email: string; nombre: string; clave: string; invitacion: string; ip: string },
): Promise<ResultadoCuenta> {
  if (!registroAbierto())
    return { ok: false, estado: 403, error: 'El registro por código no está abierto. Creá tu cuenta con «Crear cuenta»: el dueño la aprueba.' }
  if (await pasado(db, 'registro:ip', d.ip)) return { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }
  await anotarIntento(db, 'registro:ip', d.ip)
  if (!invitacionValida(d.invitacion)) return { ok: false, estado: 403, error: 'El código de invitación no es válido.' }
  const datos = datosDeRegistro(d)
  if ('error' in datos) return { ok: false, estado: 400, error: datos.error }
  return crearCuenta(db, { ...datos, claveHash: await hashClave(d.clave) })
}

/**
 * Entrar con una cuenta de Telar. `null` si el mail no es de una cuenta de Telar con contraseña o la contraseña no coincide:
 * entonces se prueba con las cuentas del juego (así el dueño siempre entra, aunque alguien registre su mail). El mensaje de
 * error lo arma quien llama, igual para los dos casos.
 */
export async function entrarTelar(db: Conexion, email: string, clave: string): Promise<{ cuenta: Cuenta } | { suspendida: true } | { pendiente: true } | null> {
  const mail = normalizarEmail(email)
  const [f] = mail ? await db.consulta(`select * from cuentas where email = $1 and clave_hash is not null`, [mail]) : []
  const ok = await claveCoincide(String(clave ?? ''), f?.clave_hash ?? (await falso()))
  if (!f || !ok) return null
  // Solo con el mail Y la contraseña correctos se dice cómo está la cuenta. Una rechazada contesta como si no existiera (no se le revela el rechazo).
  if (f.estado === 'rechazada') return null
  if (f.estado === 'pendiente') return { pendiente: true }
  if (!puedeEntrar(f.estado)) return { suspendida: true }
  await db.consulta(`update cuentas set ultimo_ingreso = now() where id = $1`, [f.id])
  return { cuenta: aCuenta(f) }
}

/** Cambiar la contraseña (pide la actual). Sube la versión de sesión: las otras sesiones de la cuenta se cierran. */
export async function cambiarClave(db: Conexion, id: string, actual: string, nueva: string): Promise<ResultadoCuenta> {
  if (await pasado(db, 'clave:cuenta', id)) return { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }
  const [f] = await db.consulta(`select * from cuentas where id = $1 and clave_hash is not null`, [id])
  if (!f) return { ok: false, estado: 400, error: 'Esta cuenta entra con la cuenta del juego: la contraseña se cambia en el juego.' }
  if (!(await claveCoincide(String(actual ?? ''), f.clave_hash))) {
    await anotarIntento(db, 'clave:cuenta', id)
    return { ok: false, estado: 401, error: 'La contraseña actual no es esa.' }
  }
  const problema = problemaConClave(nueva, { email: f.email ?? undefined, nombre: f.nombre })
  if (problema) return { ok: false, estado: 400, error: problema }
  if (await claveCoincide(nueva, f.clave_hash)) return { ok: false, estado: 400, error: 'La contraseña nueva es igual a la actual.' }
  const [g] = await db.consulta(
    `update cuentas set clave_hash = $2, version_sesion = version_sesion + 1 where id = $1 returning *`,
    [id, await hashClave(nueva)],
  )
  await olvidarIntentos(db, 'clave:cuenta', id)
  await cancelarRestablecimientos(db, id)
  return { ok: true, cuenta: aCuenta(g!) }
}

/**
 * Un restablecimiento pendiente (el enlace que generó el dueño) deja de servir cuando la contraseña ya se cambió por otro camino: si
 * no, un enlace perdido seguiría abriendo la cuenta. Es un detalle de seguridad, no puede cortar lo que se estaba haciendo (y con la
 * base sin migrar no hay tabla): se traga el error. Devuelve cuántos canceló.
 */
export async function cancelarRestablecimientos(db: Conexion, cuenta: string): Promise<number> {
  try {
    const filas = await db.consulta(
      `update restablecimientos set cancelado_en = now() where cuenta = $1 and usado_en is null and cancelado_en is null returning id`,
      [cuenta],
    )
    return filas.length
  } catch {
    return 0
  }
}

/** El dueño entró con su cuenta del juego: se anota su mail (para mostrarlo en el perfil y que nadie lo registre). */
export async function anotarIngresoDueno(db: Conexion, email: string) {
  const mail = normalizarEmail(email)
  if (!emailValido(mail)) return
  const [otra] = await db.consulta(`select id from cuentas where email = $1 and id <> $2`, [mail, CUENTA_DUENO])
  await db.consulta(`update cuentas set ultimo_ingreso = now()${otra ? '' : ', email = $2'} where id = $1`, otra ? [CUENTA_DUENO] : [CUENTA_DUENO, mail])
}

/** Cambiar el nombre de la cuenta (es el nombre del perfil: el miembro «yo» y la cuenta van juntos). */
export async function renombrarCuenta(db: Conexion, id: string, nombre: string) {
  await db.consulta(`update cuentas set nombre = $2 where id = $1`, [id, nombre])
}

/** Suspender o reactivar (lo hace el dueño a mano, por ahora: docs/cuentas.md). */
export async function cambiarEstado(db: Conexion, id: string, estado: 'activa' | 'suspendida') {
  if (id === CUENTA_DUENO) throw new Error('La cuenta del dueño no se suspende.')
  await db.consulta(`update cuentas set estado = $2 where id = $1`, [id, estado])
}
