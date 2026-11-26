// Rutas de «recuperar la contraseña sin correo», montadas en /api por api.ts (la lógica y sus porqués: recuperacion.ts).
//   De la cuenta (SESIÓN de una cuenta de Telar; la clave del MCP no alcanza para generar códigos):
//     GET  /api/cuenta/codigos                cuántos códigos de recuperación le quedan (no los códigos: esos salen una sola vez)
//     POST /api/cuenta/codigos                «Generar códigos nuevos»: pide la contraseña actual, deja sin efecto los anteriores
//   Públicas (sin sesión; con límite de intentos; el token y el código van en el cuerpo, nunca en la dirección):
//     POST /api/recuperar                     «Olvidé mi contraseña»: mail + código de recuperación + contraseña nueva
//     POST /api/restablecer/ver               el enlace que generó el dueño: a quién le toca, si sirve
//     POST /api/restablecer                   contraseña nueva con ese enlace (un solo uso, 24 horas)
// Generar el enlace de restablecimiento (solo la sesión del dueño) está en amigos-rutas.ts, con el resto de lo que da permiso.
// Todo lo que devuelve códigos va con `Cache-Control: no-store`: salen una sola vez y no se guardan en ninguna caché.
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { avisarAlDueno } from './amigos-rutas'
import { CUENTA_DUENO, usuarioDeCookie } from './cuentas'
import { ErrorDominio, type Servicio } from './dominio/servicio'
import {
  canjearRestablecimiento,
  estadoCodigos,
  generarCodigosConClave,
  POCOS_CODIGOS,
  recuperarConCodigo,
  verRestablecimiento,
} from './recuperacion'
import { esPublico } from './sesion'
import { nombreDelDueno } from './solicitudes'

export interface DepsRecuperacion {
  raiz: () => Servicio
  via: () => 'local' | 'clave' | 'sesion' | 'oauth' | undefined
  cuenta: () => string | undefined
  ip: (c: Context) => string
  ponerSesion: (c: Context, usuario: string) => void
}

const NO_STORE = { 'Cache-Control': 'no-store' }
const esquemaRecuperar = z.strictObject({ email: z.string().max(200), codigo: z.string().max(60), clave: z.string().max(400) })
const esquemaToken = z.strictObject({ token: z.string().max(200) })
const esquemaRestablecer = z.strictObject({ token: z.string().max(200), clave: z.string().max(400) })
const esquemaCodigos = z.strictObject({ clave: z.string().max(400) })

export function rutasRecuperacion(d: DepsRecuperacion) {
  const r = new Hono()
  const cuerpo = async (c: Context) => {
    const b = await c.req.json().catch(() => null)
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ErrorDominio('Mandá los datos como un objeto JSON.')
    return b
  }
  /** La cuenta de Telar de la sesión (la del dueño entra con la cuenta del juego: no usa códigos). */
  const cuentaTelar = (): string | null => {
    if (!esPublico()) return null
    const cuenta = d.cuenta()
    return d.via() === 'sesion' && cuenta && cuenta !== CUENTA_DUENO ? cuenta : null
  }

  r.get('/cuenta/codigos', async (c) => {
    const cuenta = cuentaTelar()
    if (!cuenta) return c.json({ aplica: false })
    const e = await estadoCodigos(d.raiz().db, cuenta)
    return c.json({ aplica: true, ...e, pocos: e.restantes <= POCOS_CODIGOS }, 200, NO_STORE)
  })

  r.post('/cuenta/codigos', async (c) => {
    if (!esPublico()) return c.json({ error: 'En esta computadora Telar no usa cuentas.' }, 404)
    if (d.via() !== 'sesion') throw new ErrorDominio('Esto se hace desde la app, con tu sesión: la clave del MCP no alcanza.', 403)
    const cuenta = cuentaTelar()
    if (!cuenta) return c.json({ error: 'Esta cuenta entra con la cuenta del juego: no usa códigos de recuperación.' }, 400)
    const e = esquemaCodigos.parse(await cuerpo(c))
    const x = await generarCodigosConClave(d.raiz().db, cuenta, e.clave)
    if (!x.ok) return c.json({ error: x.error }, x.estado)
    return c.json({ codigos: x.codigos, restantes: x.codigos.length }, 201, NO_STORE)
  })

  // ───── públicas ─────

  r.post('/recuperar', async (c) => {
    if (!esPublico()) return c.json({ error: 'En esta computadora Telar no usa cuentas.' }, 404)
    const e = esquemaRecuperar.parse(await cuerpo(c))
    const x = await recuperarConCodigo(d.raiz().db, { ...e, ip: d.ip(c) })
    if (!x.ok) return c.json({ error: x.error }, x.estado, NO_STORE)
    // Una solicitud que todavía espera la aprobación del dueño SÍ cambia su contraseña, pero no gana acceso: no se le abre la sesión.
    if (x.cuenta.estado === 'pendiente') return c.json({ ok: true, pendiente: true, aprobador: await nombreDelDueno(d.raiz().db) }, 200, NO_STORE)
    // Entra con la contraseña nueva; las otras sesiones de la cuenta se cerraron (subió la versión de sesión).
    d.ponerSesion(c, usuarioDeCookie(x.cuenta))
    return c.json({ ok: true, restantes: x.restantes, pocos: x.restantes <= POCOS_CODIGOS }, 200, NO_STORE)
  })

  r.post('/restablecer/ver', async (c) => {
    if (!esPublico()) return c.json({ error: 'En esta computadora Telar no usa cuentas.' }, 404)
    const e = esquemaToken.parse(await cuerpo(c))
    const v = await verRestablecimiento(d.raiz().db, e.token, d.ip(c))
    if (!v.ok) return c.json({ error: v.error }, v.estado)
    return c.json({ nombre: v.nombre })
  })

  r.post('/restablecer', async (c) => {
    if (!esPublico()) return c.json({ error: 'En esta computadora Telar no usa cuentas.' }, 404)
    const e = esquemaRestablecer.parse(await cuerpo(c))
    const raiz = d.raiz()
    const x = await canjearRestablecimiento(raiz.db, { ...e, ip: d.ip(c) })
    if (!x.ok) return c.json({ error: x.error }, x.estado, NO_STORE)
    d.ponerSesion(c, usuarioDeCookie(x.cuenta))
    // El dueño se entera en la campana (nunca sabe cuál es la contraseña: la puso el amigo).
    await avisarAlDueno(raiz, x.creadoPor, {
      titulo: `${x.cuenta.nombre} restableció su contraseña`,
      cuerpo: 'Usó el enlace que le generaste. Ya entró con su contraseña nueva y se cerraron sus otras sesiones.',
    })
    return c.json({ ok: true, codigos: x.codigos }, 200, NO_STORE)
  })

  return r
}
