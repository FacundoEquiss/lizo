// Crear cuenta con aprobación del dueño (docs/cuentas.md, «Crear cuenta con aprobación»). Quien llega a la web crea su cuenta con nombre,
// mail y contraseña, SIN enlace ni código. La cuenta nace `pendiente`: no entra a nada (ni a la API, ni al MCP, ni a OAuth, ni a los
// eventos, ni a los archivos: `cuentaDeUsuario` solo deja pasar a las `activa`) hasta que el dueño la aprueba desde Configuración → Amigos.
//   · Aprobar la pasa a `activa` (cuenta contra el tope de amigos, que sigue valiendo) y le crea su Telar vacío; rechazar la deja `rechazada`
//     (tampoco entra, y su mail queda ocupado unos días para que no haya reintentos infinitos); el dueño puede «Reconsiderar».
//   · Los miedos del dueño: hay un tope de solicitudes pendientes a la vez, un límite de pedidos por IP (tabla `intentos`) y se pueden borrar
//     las solicitudes viejas (son cuentas sin datos, así que esto sí se borra de verdad).
//   · Quién decide (solo la SESIÓN del dueño) lo pone amigos-rutas.ts. Acá no hay permisos.
import { anotarIntento, aCuenta, contarAmigos, CUENTA_DUENO, datosDeRegistro, hashClave, MENSAJE_DEMASIADOS, nuevoIdCuenta, pasado, topeAmigos, TOPE_AMIGOS, type Cuenta } from './cuentas'
import type { Conexion } from './datos/conexion'
import { ErrorDominio } from './dominio/servicio'

/** Cuántas solicitudes pueden esperar a la vez. Con más, no se aceptan nuevas hasta que el dueño responda o limpie. */
export const MAX_SOLICITUDES = 30
/** Cuántos días queda ocupado el mail de una solicitud rechazada (después, la misma persona puede volver a pedir). */
export const DIAS_RECHAZO = 7
/** Desde cuántos días una solicitud sin responder (o una rechazada) cuenta como vieja para «Borrar solicitudes viejas». */
export const DIAS_VIEJAS = 30

export const MENSAJE_SIN_LUGAR = 'Ahora no se aceptan más solicitudes. Probá más tarde.'
export const MENSAJE_MAIL_USADO = 'Ya hay una cuenta con ese mail. Entrá con tu contraseña.'

export type EstadoSolicitud = 'pendiente' | 'rechazada'

export interface Solicitud {
  id: string
  nombre: string
  email: string | null
  estado: EstadoSolicitud
  /** Cuándo la pidió. */
  desde: string
  /** Cuándo la rechazó el dueño (solo en las rechazadas). */
  decididaEn: string | null
  /** Cuándo queda libre el mail de una rechazada (solo en las rechazadas). */
  liberaEn: string | null
}

export interface EstadoSolicitudes {
  pendientes: Solicitud[]
  rechazadas: Solicitud[]
  maxSolicitudes: number
  diasRechazo: number
  diasViejas: number
}

const iso = (v: unknown) => new Date(v as string).toISOString()
const DIA_MS = 86_400_000

const aSolicitud = (f: Record<string, any>): Solicitud => {
  const decidida = f.decidida_en ? new Date(f.decidida_en) : null
  const rechazada = f.estado === 'rechazada'
  return {
    id: f.id,
    nombre: f.nombre ?? '',
    email: f.email ?? null,
    estado: rechazada ? 'rechazada' : 'pendiente',
    desde: iso(f.solicitada_en ?? f.creado_en),
    decididaEn: rechazada && decidida ? decidida.toISOString() : null,
    liberaEn: rechazada && decidida ? new Date(decidida.getTime() + DIAS_RECHAZO * DIA_MS).toISOString() : null,
  }
}

/** El nombre de quien aprueba, para «Tu cuenta espera la aprobación de Facundo»: el de su miembro «yo» y, si no, el de la cuenta. */
export async function nombreDelDueno(db: Conexion): Promise<string> {
  const [m] = await db.consulta<{ nombre: string }>(`select nombre from miembros where propietario = $1 and es_yo order by creado_en limit 1`, [CUENTA_DUENO])
  if (m?.nombre) return m.nombre
  const [c] = await db.consulta<{ nombre: string }>(`select nombre from cuentas where id = $1`, [CUENTA_DUENO])
  return c?.nombre || 'el dueño de Telar'
}

class Corta extends Error {
  constructor(readonly resultado: Extract<ResultadoSolicitud, { ok: false }>) {
    super(resultado.error)
  }
}

export type ResultadoSolicitud =
  | { ok: true; cuenta: Cuenta; aprobador: string }
  // `sinLugar`: se llegó al tope de solicitudes pendientes (quien llama avisa al dueño en la campana).
  | { ok: false; estado: 400 | 409 | 429 | 503; error: string; sinLugar?: true }

/**
 * Una cuenta que se borra de verdad: solo si es una solicitud (`pendiente` o `rechazada`) y no tiene nada adentro. Borra lo que cuelga
 * de ella (códigos de recuperación y restablecimientos). Corre adentro de una transacción. Devuelve cuántas borró.
 */
async function borrarSolicitudes(tx: Conexion, condicion: string, valores: unknown[] = []): Promise<number> {
  const filas = await tx.consulta<{ id: string }>(
    `select c.id from cuentas c
      where c.id <> '${CUENTA_DUENO}' and c.estado in ('pendiente', 'rechazada')
        and not exists (select 1 from proyectos p where p.propietario = c.id)
        and not exists (select 1 from miembros m where m.propietario = c.id)
        and (${condicion})`,
    valores,
  )
  const ids = filas.map((f) => f.id)
  if (ids.length === 0) return 0
  await tx.consulta(`delete from codigos_recuperacion where cuenta = any($1::text[])`, [ids])
  await tx.consulta(`delete from restablecimientos where cuenta = any($1::text[])`, [ids])
  await tx.consulta(`delete from cuentas where id = any($1::text[])`, [ids])
  return ids.length
}

/**
 * Pedir una cuenta (sin enlace ni código): nace `pendiente`. En UNA transacción con la fila del dueño trabada (dos pedidos a la vez no
 * pasan los dos por el último lugar): se libera el mail si era de una rechazada de hace más de `DIAS_RECHAZO` días, se mira el tope de
 * solicitudes pendientes y el mail repetido (el mismo mensaje sea de una cuenta activa, pendiente o rechazada: no se cuenta cuál) y se crea.
 */
export async function solicitarCuenta(db: Conexion, d: { email: string; nombre: string; clave: string; ip: string }): Promise<ResultadoSolicitud> {
  // Lo que se puede decir sin tocar la base ni gastar un intento (el servidor lo mira todo, la pantalla lo adelanta).
  const datos = datosDeRegistro(d)
  if ('error' in datos) return { ok: false, estado: 400, error: datos.error }
  if (await pasado(db, 'solicitud:ip', d.ip)) return { ok: false, estado: 429, error: MENSAJE_DEMASIADOS }
  await anotarIntento(db, 'solicitud:ip', d.ip)
  const claveHash = await hashClave(d.clave)
  try {
    const cuenta = await db.transaccion(async (tx) => {
      await tx.consulta(`select 1 from cuentas where id = $1 for update`, [CUENTA_DUENO])
      await borrarSolicitudes(tx, `c.estado = 'rechazada' and c.email = $1 and c.decidida_en < now() - ($2::int * interval '1 day')`, [datos.email, DIAS_RECHAZO])
      const [existe] = await tx.consulta(`select 1 from cuentas where email = $1`, [datos.email])
      if (existe) throw new Corta({ ok: false, estado: 409, error: MENSAJE_MAIL_USADO })
      const [n] = await tx.consulta<{ n: number }>(`select count(*)::int as n from cuentas where estado = 'pendiente'`)
      if (Number(n?.n ?? 0) >= MAX_SOLICITUDES) throw new Corta({ ok: false, estado: 429, error: MENSAJE_SIN_LUGAR, sinLugar: true })
      const [f] = await tx.consulta(
        `insert into cuentas (id, email, nombre, clave_hash, estado, solicitada_en) values ($1, $2, $3, $4, 'pendiente', now()) returning *`,
        [nuevoIdCuenta(), datos.email, datos.nombre, claveHash],
      )
      return aCuenta(f!)
    })
    return { ok: true, cuenta, aprobador: await nombreDelDueno(db) }
  } catch (e) {
    if (e instanceof Corta) return e.resultado
    // el índice único del mail corta el segundo de dos pedidos simultáneos con el mismo mail
    if ((e as { code?: string })?.code === '23505') return { ok: false, estado: 409, error: MENSAJE_MAIL_USADO }
    throw e
  }
}

// ───── lo que ve y decide el dueño ─────

export async function listarSolicitudes(db: Conexion): Promise<EstadoSolicitudes> {
  const filas = await db.consulta(
    `select id, nombre, email, estado, creado_en, solicitada_en, decidida_en from cuentas
      where id <> $1 and estado in ('pendiente', 'rechazada') order by coalesce(decidida_en, solicitada_en, creado_en) desc`,
    [CUENTA_DUENO],
  )
  const todas = filas.map(aSolicitud)
  return {
    // las que esperan, de la más vieja a la más nueva (se atienden en orden); las rechazadas, de la más reciente
    pendientes: todas.filter((s) => s.estado === 'pendiente').sort((a, b) => a.desde.localeCompare(b.desde)),
    rechazadas: todas.filter((s) => s.estado === 'rechazada'),
    maxSolicitudes: MAX_SOLICITUDES,
    diasRechazo: DIAS_RECHAZO,
    diasViejas: DIAS_VIEJAS,
  }
}

/** Cuántas solicitudes esperan (la marca con el número del menú y de la campana). Con la base sin migrar no hay ninguna. */
export async function contarPendientes(db: Conexion): Promise<number> {
  try {
    const [f] = await db.consulta<{ n: number }>(`select count(*)::int as n from cuentas where estado = 'pendiente' and id <> $1`, [CUENTA_DUENO])
    return Number(f?.n ?? 0)
  } catch {
    return 0
  }
}

async function decidir(
  db: Conexion,
  id: string,
  de: 'pendiente' | 'rechazada',
  a: 'activa' | 'rechazada' | 'pendiente',
  por: string,
  conTope = false,
): Promise<Cuenta> {
  if (id === CUENTA_DUENO) throw new ErrorDominio('No existe esa solicitud.', 404)
  return db.transaccion(async (tx) => {
    // El tope de amigos se mira con la fila del dueño trabada: dos aprobaciones a la vez no pasan las dos por el último lugar.
    await tx.consulta(`select 1 from cuentas where id = $1 for update`, [CUENTA_DUENO])
    const [f] = await tx.consulta(`select * from cuentas where id = $1 for update`, [id])
    if (!f) throw new ErrorDominio('No existe esa solicitud.', 404)
    if (f.estado !== de) {
      throw new ErrorDominio(
        f.estado === 'pendiente' || f.estado === 'rechazada' ? `Esa solicitud ya está ${f.estado === 'pendiente' ? 'pendiente' : 'rechazada'}.` : `${f.nombre || 'Esa cuenta'} ya no es una solicitud.`,
        409,
      )
    }
    if (conTope) {
      const tope = await topeAmigos(tx).catch(() => TOPE_AMIGOS.fabrica)
      if ((await contarAmigos(tx)) >= tope)
        throw new ErrorDominio(`Ya hay ${tope} cuentas de amigos: es el tope. Subilo en «Tope» (más abajo) y aprobá a ${f.nombre || 'esta persona'}.`, 409)
    }
    const [g] = await tx.consulta(
      a === 'pendiente'
        ? `update cuentas set estado = 'pendiente', decidida_en = null, decidida_por = null where id = $1 returning *`
        : `update cuentas set estado = $2, decidida_en = now(), decidida_por = $3 where id = $1 returning *`,
      a === 'pendiente' ? [id] : [id, a, por],
    )
    return aCuenta(g!)
  })
}

/** Aprobar: pasa a `activa` si todavía hay lugar en el tope de amigos. Quien llama le crea su Telar vacío (su miembro «yo»). */
export const aprobarSolicitud = (db: Conexion, id: string, por: string) => decidir(db, id, 'pendiente', 'activa', por, true)
/** Rechazar: queda `rechazada` (no entra; el mail queda ocupado unos días). */
export const rechazarSolicitud = (db: Conexion, id: string, por: string) => decidir(db, id, 'pendiente', 'rechazada', por)
/** Reconsiderar: una rechazada vuelve a esperar. */
export const reconsiderarSolicitud = (db: Conexion, id: string) => decidir(db, id, 'rechazada', 'pendiente', CUENTA_DUENO)

/**
 * «Borrar solicitudes viejas»: las que esperan hace más de `DIAS_VIEJAS` días y las rechazadas hace más de eso. Son cuentas sin datos, así
 * que esto SÍ se borra de verdad (lo único que Telar borra; la pantalla pide confirmar). Devuelve cuántas.
 */
export async function borrarSolicitudesViejas(db: Conexion): Promise<number> {
  return db.transaccion(async (tx) => {
    await tx.consulta(`select 1 from cuentas where id = $1 for update`, [CUENTA_DUENO])
    return borrarSolicitudes(
      tx,
      `(c.estado = 'pendiente' and coalesce(c.solicitada_en, c.creado_en) < now() - ($1::int * interval '1 day'))
        or (c.estado = 'rechazada' and coalesce(c.decidida_en, c.solicitada_en, c.creado_en) < now() - ($1::int * interval '1 day'))`,
      [DIAS_VIEJAS],
    )
  })
}
