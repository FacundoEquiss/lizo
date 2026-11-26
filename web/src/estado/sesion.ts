// La sesión del tablero. En la computadora siempre se está adentro; online (Vercel) hay que entrar con una cuenta de Telar
// (mail, nombre y contraseña propios: docs/cuentas.md) o con la cuenta del juego (la del dueño).
// Si la API contesta 401 con { entrar: true } (la cookie venció o se borró), vuelve la pantalla de entrar.
import { create } from 'zustand'

export interface EstadoSesion {
  revisada: boolean
  publico: boolean
  entrado: boolean
  /** Cómo llegan los cambios en vivo: SSE (computadora) o preguntando cada pocos segundos (online). */
  eventos: 'sse' | 'sondeo'
  /** Crear una cuenta está siempre abierto online (queda pendiente hasta que el dueño la apruebe); el servidor lo sigue diciendo por compatibilidad. */
  registro: boolean
  /** ¿Es la sesión del dueño? Solo él ve Configuración → Amigos (invitar y aprobar es dar permiso). */
  amigos: boolean
  /** Cuántas solicitudes de cuenta esperan la aprobación del dueño (la marca con el número del menú y de la campana; 0 para todos los demás). */
  solicitudes: number
}

export const useSesion = create<EstadoSesion>(() => ({ revisada: false, publico: false, entrado: false, eventos: 'sse', registro: false, amigos: false, solicitudes: 0 }))

/** Lo último que dijo el servidor de la sesión (para arrancar sin esperarlo en el teléfono y para cuando no contesta). */
function recordar(publico: boolean, entrado: boolean, eventos: EstadoSesion['eventos']) {
  try {
    localStorage.setItem('telar.sesion', JSON.stringify({ publico, entrado, eventos }))
  } catch {}
}

export async function revisarSesion() {
  try {
    const r = await fetch('/api/sesion', { headers: { accept: 'application/json' } })
    const d = (await r.json()) as Partial<EstadoSesion>
    const eventos = d.eventos === 'sondeo' ? 'sondeo' : 'sse'
    useSesion.setState({ revisada: true, publico: !!d.publico, entrado: !!d.entrado, eventos, registro: !!d.registro, amigos: !!d.amigos, solicitudes: Number(d.solicitudes) || 0 })
    recordar(!!d.publico, !!d.entrado, eventos)
  } catch {
    // Sin respuesta: se intenta como la última vez que contestó (la app muestra lo guardado y su aviso de "sin conexión").
    // Así, al volver la señal, una sesión vencida vuelve a la pantalla de entrar y las novedades llegan como corresponde.
    let ultima: Partial<EstadoSesion> = {}
    try {
      ultima = JSON.parse(localStorage.getItem('telar.sesion') ?? '{}') as Partial<EstadoSesion>
    } catch {}
    useSesion.setState({ revisada: true, publico: !!ultima.publico, entrado: true, eventos: ultima.eventos === 'sondeo' ? 'sondeo' : 'sse' })
  }
}

/** Vuelve a preguntar cuántas solicitudes esperan (llegó una nueva, o el dueño aprobó o rechazó una): solo cambia la marca. */
export async function actualizarSolicitudes() {
  if (!useSesion.getState().amigos) return
  try {
    const d = (await (await fetch('/api/sesion', { headers: { accept: 'application/json' } })).json()) as Partial<EstadoSesion>
    useSesion.setState({ solicitudes: Number(d.solicitudes) || 0 })
  } catch {}
}

/** La API dijo que hay que entrar de nuevo. */
export function sesionVencida() {
  if (!useSesion.getState().publico) return
  useSesion.setState({ entrado: false })
  recordar(true, false, useSesion.getState().eventos)
}

async function enviar(ruta: string, metodo: string, cuerpo?: unknown): Promise<{ ok: boolean; error?: string; estado?: number; datos?: any }> {
  try {
    const r = await fetch(ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    const d = await r.json().catch(() => ({}))
    return r.ok ? { ok: true, estado: r.status, datos: d } : { ok: false, error: d?.error || `Error ${r.status}`, estado: r.status }
  } catch {
    return { ok: false, error: 'No hay conexión. Probá de nuevo.' }
  }
}

export const entrar = (email: string, clave: string) => enviar('/api/sesion', 'POST', { email, clave })
/**
 * «Crear cuenta» (sin enlace ni código): nombre, mail y contraseña. La cuenta nace pendiente (no abre sesión): salen sus 8 códigos de recuperación
 * (una sola vez) y el nombre de quien la va a aprobar.
 */
export async function solicitarCuenta(d: { email: string; nombre: string; clave: string }): Promise<{ ok: true; codigos: string[] | null; aprobador: string } | { ok: false; error: string; estado?: number }> {
  const r = await enviar('/api/solicitudes', 'POST', d)
  return r.ok
    ? { ok: true, codigos: Array.isArray(r.datos?.codigos) ? (r.datos.codigos as string[]) : null, aprobador: String(r.datos?.aprobador ?? 'el dueño de Telar') }
    : { ok: false, error: r.error ?? 'No se pudo crear la cuenta.', estado: r.estado }
}
/** El enlace de invitación: quién invita (si el enlace sirve) o el mensaje de por qué no. */
export async function verInvitacion(token: string): Promise<{ ok: true; invitador: string } | { ok: false; error: string; estado?: number }> {
  const r = await enviar('/api/unirse/ver', 'POST', { token })
  return r.ok ? { ok: true, invitador: String(r.datos?.invitador ?? '') } : { ok: false, error: r.error ?? 'No se pudo abrir la invitación.', estado: r.estado }
}
/** Registrarse con el enlace: nombre, mail y contraseña (sin código). Si sale bien, la sesión queda abierta. */
export const unirse = (d: { token: string; email: string; nombre: string; clave: string }) => enviar('/api/unirse', 'POST', d)
export const cambiarClave = (actual: string, nueva: string) => enviar('/api/cuenta/clave', 'POST', { actual, nueva })
/** «Olvidé mi contraseña» (sin correo): mail + un código de recuperación + contraseña nueva. Si sale bien, la sesión queda abierta. */
export async function recuperarCuenta(
  d: { email: string; codigo: string; clave: string },
): Promise<{ ok: true; pendiente: false; restantes: number; pocos: boolean } | { ok: true; pendiente: true; aprobador: string } | { ok: false; error: string; estado?: number }> {
  const r = await enviar('/api/recuperar', 'POST', d)
  if (!r.ok) return { ok: false, error: r.error ?? 'No se pudo recuperar la cuenta.', estado: r.estado }
  // Una cuenta que todavía espera la aprobación del dueño cambia su contraseña, pero no abre la sesión.
  if (r.datos?.pendiente) return { ok: true, pendiente: true, aprobador: String(r.datos?.aprobador ?? 'el dueño de Telar') }
  return { ok: true, pendiente: false, restantes: Number(r.datos?.restantes ?? 0), pocos: Boolean(r.datos?.pocos) }
}
/** «Generar códigos nuevos» (Configuración → Cuenta): pide la contraseña actual; los códigos salen UNA vez y los anteriores dejan de servir. */
export async function generarCodigosNuevos(clave: string): Promise<{ ok: true; codigos: string[] } | { ok: false; error: string; estado?: number }> {
  const r = await enviar('/api/cuenta/codigos', 'POST', { clave })
  return r.ok ? { ok: true, codigos: (r.datos?.codigos as string[]) ?? [] } : { ok: false, error: r.error ?? 'No se pudieron generar los códigos.', estado: r.estado }
}
/** El enlace de restablecimiento que generó el dueño: a quién le toca (si el enlace sirve) o el mensaje de por qué no. */
export async function verRestablecimiento(token: string): Promise<{ ok: true; nombre: string } | { ok: false; error: string; estado?: number }> {
  const r = await enviar('/api/restablecer/ver', 'POST', { token })
  return r.ok ? { ok: true, nombre: String(r.datos?.nombre ?? '') } : { ok: false, error: r.error ?? 'No se pudo abrir el enlace.', estado: r.estado }
}
/** Contraseña nueva con ese enlace. Si sale bien, la sesión queda abierta y vienen 8 códigos de recuperación nuevos (una sola vez). */
export async function restablecerConEnlace(d: { token: string; clave: string }): Promise<{ ok: true; codigos: string[] | null } | { ok: false; error: string; estado?: number }> {
  const r = await enviar('/api/restablecer', 'POST', d)
  return r.ok ? { ok: true, codigos: Array.isArray(r.datos?.codigos) ? (r.datos.codigos as string[]) : null } : { ok: false, error: r.error ?? 'No se pudo cambiar la contraseña.', estado: r.estado }
}
export const entrarConCodigo = (email: string, codigo: string) => enviar('/api/sesion', 'POST', { email, codigo })
export const pedirCodigo = (email: string) => enviar('/api/sesion/codigo', 'POST', { email })
export async function salir() {
  const r = await enviar('/api/sesion', 'DELETE')
  if (r.ok) recordar(useSesion.getState().publico, false, useSesion.getState().eventos)
  return r
}
