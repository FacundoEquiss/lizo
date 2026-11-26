// Amigos e invitaciones (Configuración → Amigos). Antes, para que un amigo se registrara había que cargar un código en una
// variable de Vercel y volver a publicar. Ahora el dueño genera un enlace desde la app y se lo pasa a quien quiera.
//   · El token son 32 bytes al azar (base64url). Se devuelve UNA sola vez, dentro del enlace; en la base queda solo su sha256.
//     Ni el token ni el enlace se guardan, se loguean ni vuelven en una lista.
//   · Canjear = buscar por el hash, compararlo en tiempo constante, y en UNA transacción gastar un uso y crear la cuenta: si el
//     alta falla (mail repetido, tope de amigos) no se gasta nada, y dos pedidos a la vez con una invitación de un solo uso dejan
//     una sola cuenta (la fila del dueño trabada serializa los altas; el `check (usos <= usos_max)` de la tabla es el tope duro).
//   · Una invitación que no sirve (inventada, alterada, vencida, usada o revocada) se contesta SIEMPRE igual: no se cuenta cuál.
//   · Quién invita y a quién suspende lo decide api.ts/amigos-rutas.ts (solo el dueño, solo con sesión). Acá no hay permisos.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { customAlphabet } from 'nanoid'
import {
  anotarIntento,
  crearCuenta,
  cambiarEstado,
  datosDeRegistro,
  hashClave,
  MENSAJE_DEMASIADOS,
  pasado,
  type Cuenta,
  type ResultadoCuenta,
} from './cuentas'
import { CUENTA_DUENO } from './datos/almacen'
import type { Conexion } from './datos/conexion'
import { ErrorDominio } from './dominio/servicio'

export const USOS_VALIDOS = [1, 5, 10] as const
export const VENCIMIENTOS_DIAS = [1, 7, 30] as const
/** De fábrica: un solo uso y una semana. */
export const USOS_DE_FABRICA = 1
export const VENCIMIENTO_DE_FABRICA = 7
/** Cuántas invitaciones pendientes (sin usar del todo, sin vencer y sin revocar) puede tener una cuenta a la vez. */
export const MAX_PENDIENTES = 20
export const MAX_NOTA = 60
export const MENSAJE_NO_SIRVE = 'Esta invitación ya no sirve. Pedile otra a quien te invitó.'

const idInvitacion = customAlphabet('0123456789abcdefghijkmnpqrstuvwxyz', 12)

export type EstadoInvitacion = 'pendiente' | 'usada' | 'vencida' | 'revocada'

export interface Invitacion {
  id: string
  nota: string
  estado: EstadoInvitacion
  usos: number
  usosMax: number
  venceEn: string
  creadaEn: string
  ultimoUsoEn: string | null
  revocadaEn: string | null
}

export interface Amigo {
  id: string
  nombre: string
  email: string | null
  estado: 'activa' | 'suspendida'
  desde: string
  ultimoIngreso: string | null
  proyectos: number
  archivosBytes: number
  /** La nota de la invitación con la que llegó («para Pablo»), si llegó por una; null si fue por el código de la variable. */
  invitacion: string | null
  porInvitacion: boolean
  /** Entró pidiendo su cuenta (sin enlace) y el dueño la aprobó. */
  porSolicitud: boolean
}

// El estado se calcula en la base con su reloj (no con el del proceso). Prioridad: revocada, usada, vencida, pendiente.
const ESTADO_SQL = `case when revocada_en is not null then 'revocada' when usos >= usos_max then 'usada' when vence_en <= now() then 'vencida' else 'pendiente' end`
const PENDIENTE_SQL = `revocada_en is null and vence_en > now() and usos < usos_max`
const COLUMNAS = `id, nota, usos, usos_max, vence_en, revocada_en, creada_en, ultimo_uso_en, ${ESTADO_SQL} as estado`

const iso = (v: unknown) => new Date(v as string).toISOString()
const aInvitacion = (f: Record<string, any>): Invitacion => ({
  id: f.id,
  nota: f.nota ?? '',
  estado: f.estado,
  usos: Number(f.usos),
  usosMax: Number(f.usos_max),
  venceEn: iso(f.vence_en),
  creadaEn: iso(f.creada_en),
  ultimoUsoEn: f.ultimo_uso_en ? iso(f.ultimo_uso_en) : null,
  revocadaEn: f.revocada_en ? iso(f.revocada_en) : null,
})

/** El sha256 (hex) del token: lo único que se guarda. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

// ───── crear, listar, revocar ─────

export async function crearInvitacion(
  db: Conexion,
  propietario: string,
  d: { nota?: string; usos?: number; venceDias?: number },
): Promise<{ invitacion: Invitacion; token: string }> {
  const nota = String(d.nota ?? '').trim()
  if (nota.length > MAX_NOTA) throw new ErrorDominio(`La nota puede tener hasta ${MAX_NOTA} caracteres.`)
  const usos = d.usos ?? USOS_DE_FABRICA
  const venceDias = d.venceDias ?? VENCIMIENTO_DE_FABRICA
  if (!(USOS_VALIDOS as readonly number[]).includes(usos)) throw new ErrorDominio('Los usos pueden ser 1, 5 o 10.')
  if (!(VENCIMIENTOS_DIAS as readonly number[]).includes(venceDias)) throw new ErrorDominio('La invitación puede vencer en 1, 7 o 30 días.')
  const token = randomBytes(32).toString('base64url')
  // Un solo pedido: se inserta solo si todavía hay lugar (dos a la vez no pasan los dos por la última).
  const [f] = await db.consulta(
    `insert into invitaciones (id, propietario, token_hash, nota, usos_max, vence_en)
     select $1::text, $2::text, $3::text, $4::text, $5::int, now() + ($6::int * interval '1 day')
      where (select count(*) from invitaciones where propietario = $2::text and ${PENDIENTE_SQL}) < $7::int
     returning ${COLUMNAS}`,
    [`i_${idInvitacion()}`, propietario, hashToken(token), nota, usos, venceDias, MAX_PENDIENTES],
  )
  if (!f) throw new ErrorDominio(`Ya tenés ${MAX_PENDIENTES} invitaciones pendientes. Revocá alguna o esperá a que venzan.`, 409)
  return { invitacion: aInvitacion(f), token }
}

export async function listarInvitaciones(db: Conexion, propietario: string): Promise<{ invitaciones: Invitacion[]; pendientes: number }> {
  const filas = await db.consulta(`select ${COLUMNAS} from invitaciones where propietario = $1 order by creada_en desc limit 60`, [propietario])
  const [p] = await db.consulta<{ n: number }>(`select count(*)::int as n from invitaciones where propietario = $1 and ${PENDIENTE_SQL}`, [propietario])
  return { invitaciones: filas.map(aInvitacion), pendientes: Number(p?.n ?? 0) }
}

/** Revocar: el enlace deja de servir ya. Repetirlo no cambia nada. Una invitación de otra cuenta da 404 como una que no existe. */
export async function revocarInvitacion(db: Conexion, propietario: string, id: string): Promise<Invitacion> {
  const [f] = await db.consulta(
    `update invitaciones set revocada_en = coalesce(revocada_en, now()) where id = $1 and propietario = $2 returning ${COLUMNAS}`,
    [id, propietario],
  )
  if (!f) throw new ErrorDominio('No existe esa invitación.', 404)
  return aInvitacion(f)
}

// ───── los amigos (cuentas que no son del dueño) ─────

/**
 * Las cuentas de amigos (las activas y las suspendidas; las solicitudes son aparte: solicitudes.ts) con lo justo para decidir (nada de lo
 * que tienen adentro). `usado` da los bytes de archivos de una cuenta.
 */
export async function listarAmigos(db: Conexion, usado: (cuenta: string) => Promise<number>): Promise<Amigo[]> {
  const consulta = (decidida: string) =>
    db.consulta(
      `select c.id, c.email, c.nombre, c.estado, c.creado_en, c.ultimo_ingreso, c.invitacion_id, ${decidida} as decidida_por, i.nota as invitacion_nota,
              (select count(*)::int from proyectos p where p.propietario = c.id) as proyectos
         from cuentas c left join invitaciones i on i.id = c.invitacion_id
        where c.id <> $1 and c.estado in ('activa', 'suspendida') order by c.creado_en desc`,
      [CUENTA_DUENO],
    )
  // Con la base sin la migración de las solicitudes (todavía sin `decidida_por`) la lista de amigos se ve igual, sin saber cuáles pidieron su cuenta.
  const filas = await consulta('c.decidida_por').catch((e) => {
    if ((e as { code?: string })?.code !== '42703') throw e
    return consulta('null::text')
  })
  return Promise.all(
    filas.map(async (f) => ({
      id: f.id as string,
      nombre: (f.nombre as string) ?? '',
      email: (f.email as string | null) ?? null,
      estado: f.estado as Amigo['estado'],
      desde: iso(f.creado_en),
      ultimoIngreso: f.ultimo_ingreso ? iso(f.ultimo_ingreso) : null,
      proyectos: Number(f.proyectos ?? 0),
      archivosBytes: await usado(f.id).catch(() => 0),
      invitacion: f.invitacion_id ? ((f.invitacion_nota as string) || null) : null,
      porInvitacion: Boolean(f.invitacion_id),
      porSolicitud: Boolean(f.decidida_por),
    })),
  )
}

/** Suspender o reactivar a un amigo. La cuenta del dueño no se toca; una cuenta que no existe da 404. */
export async function ponerEstadoAmigo(db: Conexion, id: string, estado: 'activa' | 'suspendida') {
  if (id === CUENTA_DUENO) throw new ErrorDominio('La cuenta del dueño no se suspende.')
  const [f] = await db.consulta<{ estado: string }>(`select estado from cuentas where id = $1`, [id])
  if (!f) throw new ErrorDominio('No existe esa cuenta.', 404)
  // Una solicitud no se «reactiva»: se aprueba (cuenta contra el tope y arma su Telar) o se rechaza.
  if (f.estado === 'pendiente' || f.estado === 'rechazada') throw new ErrorDominio('Esa cuenta es una solicitud: aprobala o rechazala desde «Solicitudes».', 409)
  await cambiarEstado(db, id, estado)
}

// ───── canjear ─────

const FORMA_TOKEN = /^[A-Za-z0-9_-]{43}$/ // 32 bytes en base64url

interface FilaInvitacion {
  id: string
  propietario: string
  nota: string
  sirve: boolean
}

/** Busca la invitación por el hash del token y confirma el hash en tiempo constante. Null si no hay (o el token ni tiene la forma). */
async function buscarPorToken(db: Conexion, token: string): Promise<FilaInvitacion | null> {
  if (typeof token !== 'string' || !FORMA_TOKEN.test(token)) return null
  const hash = hashToken(token)
  const [f] = await db.consulta(
    `select id, propietario, nota, token_hash, (${PENDIENTE_SQL}) as sirve from invitaciones where token_hash = $1`,
    [hash],
  )
  if (!f) return null
  const a = Buffer.from(String(f.token_hash))
  const b = Buffer.from(hash)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return { id: f.id, propietario: f.propietario, nota: f.nota ?? '', sirve: Boolean(f.sirve) }
}

/** El nombre de quien invita, para «Facundo te invitó a Telar»: el de su miembro «yo» y, si no, el de la cuenta. */
async function nombreDe(db: Conexion, cuenta: string): Promise<string> {
  const [m] = await db.consulta<{ nombre: string }>(`select nombre from miembros where propietario = $1 and es_yo order by creado_en limit 1`, [cuenta])
  if (m?.nombre) return m.nombre
  const [c] = await db.consulta<{ nombre: string }>(`select nombre from cuentas where id = $1`, [cuenta])
  return c?.nombre || 'Alguien'
}

export type ResultadoVer = { ok: true; invitador: string } | { ok: false; estado: 404 | 429; error: string }

/** La pantalla de «Fulano te invitó a Telar»: dice quién invita si el enlace sirve; si no, siempre el mismo mensaje. No gasta nada. */
export async function verInvitacion(db: Conexion, token: string, ip: string): Promise<ResultadoVer> {
  if (await pasado(db, 'invitacion:ip', ip)) return { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }
  const f = await buscarPorToken(db, token)
  if (!f || !f.sirve) {
    await anotarIntento(db, 'invitacion:ip', ip)
    return { ok: false, estado: 404, error: MENSAJE_NO_SIRVE }
  }
  return { ok: true, invitador: await nombreDe(db, f.propietario) }
}

export type ResultadoCanje =
  | { ok: true; cuenta: Cuenta; invitacion: { id: string; propietario: string; nota: string } }
  | { ok: false; estado: 400 | 401 | 403 | 404 | 409 | 429; error: string; tope?: true; propietario?: string }

/** Registrarse con un enlace: gasta un uso y crea la cuenta en una sola transacción. El miembro «yo» y la sesión los pone quien llama. */
export async function canjearInvitacion(
  db: Conexion,
  d: { token: string; email: string; nombre: string; clave: string; ip: string },
): Promise<ResultadoCanje> {
  if ((await pasado(db, 'invitacion:ip', d.ip)) || (await pasado(db, 'registro:ip', d.ip))) return { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }
  await anotarIntento(db, 'registro:ip', d.ip)
  const f = await buscarPorToken(db, d.token)
  if (!f || !f.sirve) {
    await anotarIntento(db, 'invitacion:ip', d.ip)
    return { ok: false, estado: 404, error: MENSAJE_NO_SIRVE }
  }
  const datos = datosDeRegistro(d)
  if ('error' in datos) return { ok: false, estado: 400, error: datos.error }
  const claveHash = await hashClave(d.clave)
  const hash = hashToken(d.token)
  const r: ResultadoCuenta = await crearCuenta(db, { ...datos, claveHash, invitacionId: f.id }, async (tx) => {
    // El uso se gasta con una sola sentencia que vuelve a mirar todo: si otro pedido llegó antes, no queda ninguna fila.
    const [g] = await tx.consulta(
      `update invitaciones set usos = usos + 1, ultimo_uso_en = now()
        where id = $1 and token_hash = $2 and ${PENDIENTE_SQL} returning id`,
      [f.id, hash],
    )
    return g ? null : { ok: false, estado: 404, error: MENSAJE_NO_SIRVE }
  })
  if (!r.ok) {
    if (r.estado === 404) await anotarIntento(db, 'invitacion:ip', d.ip)
    return { ...r, propietario: f.propietario }
  }
  return { ok: true, cuenta: r.cuenta, invitacion: { id: f.id, propietario: f.propietario, nota: f.nota } }
}
