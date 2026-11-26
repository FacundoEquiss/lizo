// Rutas de Configuración → Amigos y del registro por enlace, montadas en /api por api.ts.
//   Del dueño (SESIÓN de la cuenta `dueno`; la clave del MCP, otra cuenta o un token de OAuth no alcanzan, 403/401):
//     GET  /api/amigos                              invitaciones (sin tokens), amigos con cuenta y topes: una sola lectura
//     POST /api/amigos/invitaciones                 crea una; el enlace con el token vuelve ACÁ y nunca más
//     POST /api/amigos/invitaciones/:id/revocar     el enlace deja de servir
//     POST /api/amigos/:id/estado                   suspender o reactivar a un amigo
//     PUT  /api/amigos/ajustes                      el tope de cuentas de amigos (1 a 100)
//     POST /api/amigos/:id/restablecer              el enlace (un solo uso, 24 horas) para que un amigo ponga una contraseña nueva
//     POST /api/amigos/:id/restablecer/cancelar     el enlace pendiente deja de servir
//     POST /api/amigos/:id/aprobar                  aprueba una solicitud de cuenta (cuenta contra el tope de amigos) y le arma su Telar vacío
//     POST /api/amigos/:id/rechazar                 rechaza una solicitud (no entra; su mail queda ocupado unos días)
//     POST /api/amigos/:id/reconsiderar             una rechazada vuelve a esperar
//     POST /api/amigos/solicitudes/limpiar          borra las solicitudes viejas (más de 30 días; son cuentas sin datos)
//   Públicas (sin sesión; con límite de intentos por IP; el token va en el cuerpo, nunca en la dirección):
//     POST /api/unirse/ver                          «Fulano te invitó a Telar»: dice quién invita si el enlace sirve
//     POST /api/unirse                              registrarse con el enlace: crea la cuenta ACTIVA y deja la sesión abierta
//     POST /api/solicitudes                         pedir una cuenta sin enlace: nace `pendiente` (no entra a nada hasta que el dueño la apruebe)
// Por qué solo el dueño y solo con sesión: invitar y reactivar a alguien es dar permiso (docs/cuentas.md, AGENTS.md regla 8).
// Lo único que el dueño ve de sus amigos es lo que decide a quién dejar entrar: mail, nombre, fechas, cuántos proyectos y cuánto
// espacio usan. Nada de lo que tienen adentro.
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  canjearInvitacion,
  crearInvitacion,
  listarAmigos,
  listarInvitaciones,
  MAX_PENDIENTES,
  ponerEstadoAmigo,
  revocarInvitacion,
  verInvitacion,
} from './amigos'
import { CUENTA_DUENO, ponerTopeAmigos, topeAmigos, TOPE_AMIGOS, usuarioDeCookie } from './cuentas'
import { ErrorDominio, type Servicio } from './dominio/servicio'
import { iaDe } from './ia/servicio-ia'
import { cancelarRestablecimiento, codigosDeCuentaNueva, crearRestablecimiento, restablecimientosDe, type EstadoRestablecimiento } from './recuperacion'
import { esPublico } from './sesion'
import {
  aprobarSolicitud,
  DIAS_RECHAZO,
  DIAS_VIEJAS,
  MAX_SOLICITUDES,
  borrarSolicitudesViejas,
  listarSolicitudes,
  rechazarSolicitud,
  reconsiderarSolicitud,
  solicitarCuenta,
  type EstadoSolicitudes,
} from './solicitudes'

export interface DepsAmigos {
  /** El Servicio de la cuenta del pedido (401 si no hay alcance). */
  servicio: () => Servicio
  /** El Servicio sin cuenta: la base y el paso a la cuenta de cada amigo. */
  raiz: () => Servicio
  via: () => 'local' | 'clave' | 'sesion' | 'oauth' | undefined
  ip: (c: Context) => string
  /** El enlace que se le pasa a un amigo: https://<la web>/unirse/<token> (o /restablecer/<token>). */
  enlace: (c: Context, token: string, ruta?: 'unirse' | 'restablecer') => string
  /** Deja la cookie de sesión de esa cuenta. */
  ponerSesion: (c: Context, usuario: string) => void
}

const MENSAJE_SESION = 'Esto se hace desde la app, con tu sesión: la clave del MCP no alcanza.'

const esquemaCrear = z.strictObject({
  nota: z.string().max(200).optional(),
  usos: z.number().int().optional(),
  venceDias: z.number().int().optional(),
})
const esquemaEstado = z.strictObject({ estado: z.enum(['activa', 'suspendida']) })
const esquemaAjustes = z.strictObject({ topeAmigos: z.number().int() })
const esquemaVer = z.strictObject({ token: z.string().max(200) })
const esquemaSolicitar = z.strictObject({
  email: z.string().max(200),
  nombre: z.string().max(200),
  clave: z.string().max(400),
})
const esquemaUnirse = z.strictObject({
  token: z.string().max(200),
  email: z.string().max(200),
  nombre: z.string().max(200),
  clave: z.string().max(400),
})

/** Un aviso en la campana de quien invitó (el dueño). Nunca corta lo que se estaba haciendo. */
export async function avisarAlDueno(raiz: Servicio, propietario: string, a: { titulo: string; cuerpo: string; claveUnica?: string; enlace?: string }) {
  try {
    const s = raiz.de(propietario)
    const yo = (await s.listarMiembros()).find((m) => m.esYo)
    if (yo) await iaDe(s).notificar({ paraId: yo.id, tipo: 'aviso', titulo: a.titulo, cuerpo: a.cuerpo, claveUnica: a.claveUnica, enlace: a.enlace })
  } catch (e) {
    console.error('[tablero] amigos: no pude avisar en la campana:', e instanceof Error ? e.message : e)
  }
}

/** Alguien quiso entrar y ya no hay lugar: el dueño lo ve en la campana (una vez por día y por valor del tope). */
export async function avisarTope(raiz: Servicio, propietario: string) {
  const tope = await topeAmigos(raiz.db)
  await avisarAlDueno(raiz, propietario, {
    titulo: 'Se alcanzó el tope de amigos',
    cuerpo: `Alguien quiso entrar con un enlace tuyo, pero ya hay ${tope} cuentas de amigos. Subí el tope en Configuración → Amigos si querés dejarlo pasar.`,
    enlace: '/amigos',
    claveUnica: `tope_amigos:${tope}:${new Date().toISOString().slice(0, 10)}`,
  })
}

/** Ya hay tantas solicitudes esperando que no entran más: el dueño lo ve en la campana (una vez por día). */
export async function avisarSinLugar(raiz: Servicio) {
  await avisarAlDueno(raiz, CUENTA_DUENO, {
    titulo: 'Hay muchas solicitudes sin responder',
    cuerpo: `Ya esperan ${MAX_SOLICITUDES}: no entran más hasta que apruebes, rechaces o borres las viejas en Configuración → Amigos.`,
    enlace: '/amigos',
    claveUnica: `solicitudes_llenas:${new Date().toISOString().slice(0, 10)}`,
  })
}

/** El Telar vacío de una cuenta recién aprobada: su miembro «yo» (el nombre del pedido). No hace nada si ya lo tiene. */
export async function armarTelar(raiz: Servicio, cuenta: { id: string; nombre: string }) {
  const s = raiz.de(cuenta.id)
  if (!(await s.listarMiembros()).some((m) => m.esYo)) await s.crearMiembro({ nombre: cuenta.nombre, tipo: 'humano', color: 'naranja', esYo: true })
}

export function rutasAmigos(d: DepsAmigos) {
  const r = new Hono()

  /** Solo el dueño, solo con sesión (y solo online: en la computadora no hay cuentas). */
  const dueno = () => {
    if (!esPublico()) throw new ErrorDominio('En esta computadora Telar no usa cuentas.', 404)
    if (d.via() !== 'sesion') throw new ErrorDominio(MENSAJE_SESION, 403)
    const s = d.servicio()
    if (!s.esDueno) throw new ErrorDominio('Solo el dueño de Telar invita a los amigos.', 403)
    return s
  }
  const cuerpo = async (c: Context) => {
    const b = await c.req.json().catch(() => null)
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ErrorDominio('Mandá los datos como un objeto JSON.')
    return b
  }

  r.get('/amigos', async (c) => {
    const s = dueno()
    const db = d.raiz().db
    const [{ invitaciones, pendientes }, amigos, tope, restablecimientos, solicitudes] = await Promise.all([
      listarInvitaciones(db, s.cuenta),
      listarAmigos(db, (cuenta) => d.raiz().de(cuenta).almacen.usado('')),
      topeAmigos(db),
      // Con la base sin migrar no hay tabla de restablecimientos: la lista de amigos se ve igual.
      restablecimientosDe(db).catch(() => new Map<string, EstadoRestablecimiento>()),
      // Con la base sin migrar (todavía sin `solicitada_en`) no hay solicitudes: el resto se ve igual.
      listarSolicitudes(db).catch((): EstadoSolicitudes => ({ pendientes: [], rechazadas: [], maxSolicitudes: MAX_SOLICITUDES, diasRechazo: DIAS_RECHAZO, diasViejas: DIAS_VIEJAS })),
    ])
    return c.json({
      invitaciones,
      pendientes,
      maxPendientes: MAX_PENDIENTES,
      // Por amigo: el enlace de restablecimiento pendiente (sin el token: no se guarda) y cuándo se le cambió la contraseña por última vez.
      amigos: amigos.map((a) => ({ ...a, restablecimiento: restablecimientos.get(a.id)?.pendiente ?? null, restablecida: restablecimientos.get(a.id)?.ultimo ?? null })),
      topeAmigos: tope,
      topeMin: TOPE_AMIGOS.min,
      topeMax: TOPE_AMIGOS.max,
      solicitudes,
    })
  })

  r.post('/amigos/invitaciones', async (c) => {
    const s = dueno()
    const e = esquemaCrear.parse(await cuerpo(c))
    const { invitacion, token } = await crearInvitacion(d.raiz().db, s.cuenta, e)
    // El enlace con el token sale en esta respuesta y en ninguna otra: no se guarda, no se registra y no se guarda en caché.
    return c.json({ invitacion, enlace: d.enlace(c, token) }, 201, { 'Cache-Control': 'no-store' })
  })

  r.post('/amigos/invitaciones/:id/revocar', async (c) => {
    const s = dueno()
    return c.json(await revocarInvitacion(d.raiz().db, s.cuenta, c.req.param('id')))
  })

  r.post('/amigos/:id/estado', async (c) => {
    dueno()
    const e = esquemaEstado.parse(await cuerpo(c))
    await ponerEstadoAmigo(d.raiz().db, c.req.param('id'), e.estado)
    return c.json({ ok: true })
  })

  r.put('/amigos/ajustes', async (c) => {
    dueno()
    const e = esquemaAjustes.parse(await cuerpo(c))
    if (e.topeAmigos < TOPE_AMIGOS.min || e.topeAmigos > TOPE_AMIGOS.max)
      throw new ErrorDominio(`El tope tiene que estar entre ${TOPE_AMIGOS.min} y ${TOPE_AMIGOS.max}.`)
    await ponerTopeAmigos(d.raiz().db, e.topeAmigos)
    return c.json({ topeAmigos: e.topeAmigos })
  })

  // Las solicitudes de cuenta (solicitudes.ts): aprobar es dar permiso, así que solo la sesión del dueño (la clave del MCP, OAuth y otra cuenta
  // dan 403/401). Decidir una solicitud que ya se decidió da 409; un id que no es de una solicitud, 404 o 409 sin tocar nada.
  r.post('/amigos/solicitudes/limpiar', async (c) => {
    dueno()
    const borradas = await borrarSolicitudesViejas(d.raiz().db)
    return c.json({ borradas })
  })

  r.post('/amigos/:id/aprobar', async (c) => {
    const s = dueno()
    const raiz = d.raiz()
    const cuenta = await aprobarSolicitud(raiz.db, c.req.param('id'), s.cuenta)
    // Su Telar propio arranca vacío, con su miembro «yo»; la próxima vez que entre con su mail y su contraseña, lo encuentra.
    await armarTelar(raiz, cuenta)
    return c.json({ ok: true, nombre: cuenta.nombre })
  })

  r.post('/amigos/:id/rechazar', async (c) => {
    const s = dueno()
    const cuenta = await rechazarSolicitud(d.raiz().db, c.req.param('id'), s.cuenta)
    return c.json({ ok: true, nombre: cuenta.nombre })
  })

  r.post('/amigos/:id/reconsiderar', async (c) => {
    dueno()
    const cuenta = await reconsiderarSolicitud(d.raiz().db, c.req.param('id'))
    return c.json({ ok: true, nombre: cuenta.nombre })
  })

  // Restablecer la contraseña de un amigo (sin correo): el dueño genera un enlace de un solo uso que vence a las 24 horas y se lo manda
  // por donde quiera. NUNCA ve ni elige la contraseña: la pone el amigo al abrirlo (recuperacion.ts). Es dar permiso: solo la sesión del
  // dueño; la clave del MCP, un token de OAuth y otra cuenta dan 403/401. La cuenta del dueño no se restablece (entra con la del juego).
  r.post('/amigos/:id/restablecer', async (c) => {
    const s = dueno()
    const x = await crearRestablecimiento(d.raiz().db, c.req.param('id'), s.cuenta)
    // Como las invitaciones: el enlace con el token sale en esta respuesta y en ninguna otra, y no se guarda en caché.
    return c.json({ restablecimiento: x.restablecimiento, nombre: x.nombre, enlace: d.enlace(c, x.token, 'restablecer') }, 201, { 'Cache-Control': 'no-store' })
  })

  r.post('/amigos/:id/restablecer/cancelar', async (c) => {
    dueno()
    await cancelarRestablecimiento(d.raiz().db, c.req.param('id'))
    return c.json({ ok: true })
  })

  // ───── públicas: el enlace que le llega al amigo ─────

  r.post('/unirse/ver', async (c) => {
    if (!esPublico()) return c.json({ error: 'En esta computadora Telar no usa cuentas.' }, 404)
    const e = esquemaVer.parse(await cuerpo(c))
    const v = await verInvitacion(d.raiz().db, e.token, d.ip(c))
    if (!v.ok) return c.json({ error: v.error }, v.estado)
    return c.json({ invitador: v.invitador })
  })

  r.post('/unirse', async (c) => {
    if (!esPublico()) return c.json({ error: 'En esta computadora Telar no usa cuentas.' }, 404)
    const e = esquemaUnirse.parse(await cuerpo(c))
    const raiz = d.raiz()
    const x = await canjearInvitacion(raiz.db, { ...e, ip: d.ip(c) })
    if (!x.ok) {
      // Se llegó al tope: el amigo lo sabe y el dueño lo ve en la campana (una vez por día).
      if (x.tope && x.propietario) await avisarTope(raiz, x.propietario)
      return c.json({ error: x.error }, x.estado)
    }
    // Su Telar propio arranca vacío, con su miembro «yo» (el nombre del registro): es el autor de lo que haga.
    await raiz.de(x.cuenta.id).crearMiembro({ nombre: x.cuenta.nombre, tipo: 'humano', color: 'naranja', esYo: true })
    d.ponerSesion(c, usuarioDeCookie(x.cuenta))
    // Sus 8 códigos de recuperación: salen en esta respuesta y en ninguna otra (null si no se pudieron generar: los genera desde Configuración).
    const codigos = await codigosDeCuentaNueva(raiz.db, x.cuenta.id)
    await avisarAlDueno(raiz, x.invitacion.propietario, {
      titulo: `${x.cuenta.nombre} se unió a Telar`,
      cuerpo: x.invitacion.nota ? `Entró con tu invitación «${x.invitacion.nota}».` : 'Entró con un enlace tuyo.',
    })
    return c.json({ ok: true, codigos }, 201, { 'Cache-Control': 'no-store' })
  })

  // Pedir una cuenta SIN enlace ni código: nombre, mail y contraseña. Nace `pendiente` (no entra a nada, ni abre sesión) hasta que el dueño la apruebe.
  // Salen sus 8 códigos de recuperación (una sola vez; no hay correo) y el nombre de quien aprueba, para decírselo. Con el mismo mensaje de «mail ya
  // usado» sea de una cuenta activa, pendiente o rechazada. Límite por IP y tope de solicitudes pendientes (con aviso en la campana del dueño).
  r.post('/solicitudes', async (c) => {
    if (!esPublico()) return c.json({ error: 'En esta computadora Telar no usa cuentas.' }, 404)
    const e = esquemaSolicitar.parse(await cuerpo(c))
    const raiz = d.raiz()
    const x = await solicitarCuenta(raiz.db, { ...e, ip: d.ip(c) })
    if (!x.ok) {
      if (x.sinLugar) await avisarSinLugar(raiz)
      return c.json({ error: x.error }, x.estado)
    }
    const codigos = await codigosDeCuentaNueva(raiz.db, x.cuenta.id)
    await avisarAlDueno(raiz, CUENTA_DUENO, {
      titulo: `${x.cuenta.nombre} pidió una cuenta`,
      cuerpo: 'Tocá para aprobarla o rechazarla en Configuración → Amigos.',
      enlace: '/amigos',
      claveUnica: `solicitud:${x.cuenta.id}`,
    })
    return c.json({ ok: true, pendiente: true, aprobador: x.aprobador, codigos }, 201, { 'Cache-Control': 'no-store' })
  })

  return r
}
