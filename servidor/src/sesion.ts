// Entrar al tablero online (24/11/2026): con la MISMA cuenta del juego (Supabase Auth del proyecto del juego), y solo las
// cuentas que estén en TABLERO_USUARIOS (ids de usuario separados por comas: hoy, la del dueño), que son la cuenta 'dueno'.
// Desde las cuentas propias (docs/cuentas.md) la cookie también lleva cuentas de Telar: el usuario es «t:<id>:<versión>»
// (cuentas.ts). Acá solo se firma y se lee; si la cuenta sigue activa lo mira cuentaDeUsuario() en cada pedido.
// El servidor habla con Supabase (la web nunca ve el token de Supabase) y deja una cookie propia, firmada, que vale 30 días.
//   TABLERO_SUPABASE_URL / TABLERO_SUPABASE_ANON  el proyecto del juego (la clave anon es pública: la usa el juego)
//   TABLERO_SECRETO                                para firmar la cookie (solo en Vercel)
import { createHmac, timingSafeEqual } from 'node:crypto'

export const COOKIE_SESION = 'tablero_sesion'
const DIAS = 30

const configSesion = () => ({
  url: (process.env.TABLERO_SUPABASE_URL || '').replace(/\/+$/, ''),
  anon: process.env.TABLERO_SUPABASE_ANON || '',
  secreto: process.env.TABLERO_SECRETO || '',
  usuarios: (process.env.TABLERO_USUARIOS || '').split(',').map((s) => s.trim()).filter(Boolean),
})

/** ¿El tablero está publicado (hay que entrar con cuenta)? */
export const esPublico = () => process.env.TABLERO_PUBLICO === '1'

/** Los ids de usuario (cuentas del juego) que pueden entrar: TABLERO_USUARIOS. Lo usa también el OAuth del MCP. */
export const usuariosPermitidos = (): string[] => configSesion().usuarios

function firma(secreto: string, base: string) {
  return createHmac('sha256', secreto).update(base).digest('base64url')
}

/** El valor de la cookie para este usuario. */
export function crearSesion(usuario: string): { valor: string; maxAge: number } {
  const { secreto } = configSesion()
  if (secreto.length < 32) throw new Error('Falta TABLERO_SECRETO (32 caracteres o más).')
  const exp = Math.floor(Date.now() / 1000) + DIAS * 86400
  const base = `v1.${usuario}.${exp}`
  return { valor: `${base}.${firma(secreto, base)}`, maxAge: DIAS * 86400 }
}

/** El usuario de una cookie válida (firma buena, sin vencer y, si es del juego, todavía en la lista), o null. */
export function leerSesion(valor: string | undefined | null): string | null {
  const { secreto, usuarios } = configSesion()
  if (!valor || secreto.length < 32) return null
  const partes = valor.split('.')
  if (partes.length !== 4 || partes[0] !== 'v1') return null
  const [, usuario, exp, sello] = partes as [string, string, string, string]
  const esperado = firma(secreto, `v1.${usuario}.${exp}`)
  const a = Buffer.from(esperado), b = Buffer.from(sello)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (!(Number(exp) * 1000 > Date.now())) return null
  if (usuario.startsWith('t:')) return usuario
  return usuarios.includes(usuario) ? usuario : null
}

export type ResultadoEntrar = { ok: true; usuario: string } | { ok: false; estado: 400 | 401 | 403 | 429 | 502; error: string }

async function auth(ruta: string, cuerpo: unknown): Promise<{ ok: boolean; estado: number; datos: any }> {
  const { url, anon } = configSesion()
  if (!url || !anon) return { ok: false, estado: 502, datos: { msg: 'Falta configurar Supabase en el servidor.' } }
  try {
    const r = await fetch(`${url}/auth/v1/${ruta}`, {
      method: 'POST',
      headers: { apikey: anon, 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(10_000),
    })
    const datos = await r.json().catch(() => ({}))
    return { ok: r.ok, estado: r.status, datos }
  } catch {
    return { ok: false, estado: 502, datos: {} }
  }
}

function conUsuario(r: { ok: boolean; estado: number; datos: any }, sinExito: string): ResultadoEntrar {
  if (r.estado === 429) return { ok: false, estado: 429, error: 'Demasiados intentos. Esperá un rato y probá de nuevo.' }
  if (r.estado >= 500 || r.estado === 0) return { ok: false, estado: 502, error: 'No pude hablar con las cuentas del juego. Probá de nuevo.' }
  const id: string | undefined = r.datos?.user?.id
  if (!r.ok || !id) return { ok: false, estado: 401, error: sinExito }
  if (!configSesion().usuarios.includes(id))
    return { ok: false, estado: 403, error: 'Esa cuenta del juego no tiene acceso a Telar. Creá una cuenta de Telar con «Crear cuenta».' }
  return { ok: true, usuario: id }
}

/** ¿Hay cuentas del juego configuradas (Supabase)? Sin eso, solo entran las cuentas de Telar. */
export const juegoConfigurado = () => Boolean(configSesion().url && configSesion().anon)

/** Mail y contraseña del juego. */
export async function entrarConClave(email: string, clave: string): Promise<ResultadoEntrar> {
  if (!email || !clave) return { ok: false, estado: 400, error: 'Escribí tu mail y tu contraseña.' }
  return conUsuario(await auth('token?grant_type=password', { email, password: clave }), 'Mail o contraseña incorrectos.')
}

/** Manda un código al mail (solo si la cuenta ya existe: no crea cuentas). */
export async function pedirCodigo(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!email) return { ok: false, error: 'Escribí tu mail.' }
  const r = await auth('otp', { email, create_user: false })
  if (r.estado === 429) return { ok: false, error: 'Ya te mandé un código hace poco. Esperá un minuto.' }
  // Si la cuenta no existe, igual se contesta que sí (no se cuenta qué mails tienen cuenta).
  return { ok: true }
}

/** El código que llegó por mail. */
export async function entrarConCodigo(email: string, codigo: string): Promise<ResultadoEntrar> {
  const token = String(codigo || '').replace(/\s/g, '')
  if (!email || !token) return { ok: false, estado: 400, error: 'Escribí el código que te llegó.' }
  return conUsuario(await auth('verify', { type: 'email', email, token }), 'El código no es válido o ya venció.')
}

// La función principal le pide dibujos a la de render (Vercel) con la clave del MCP, que actúa como 'dueno'. Para dibujar el
// marco de otra cuenta (con SUS archivos) le manda además la cuenta firmada con TABLERO_SECRETO (que la clave no alcanza
// para falsificar): así ni la clave del MCP lee archivos de otra cuenta por este camino.
const VIDA_ALCANCE_S = 120

/** La cuenta firmada para un pedido interno (vale 2 minutos). */
export function firmarAlcance(cuenta: string): string {
  const { secreto } = configSesion()
  if (secreto.length < 32) throw new Error('Falta TABLERO_SECRETO (32 caracteres o más).')
  const base = `a1.${cuenta}.${Math.floor(Date.now() / 1000) + VIDA_ALCANCE_S}`
  return `${base}.${firma(secreto, base)}`
}

/** La cuenta de un pedido interno bien firmado y sin vencer, o null. */
export function leerAlcance(valor: string | undefined | null): string | null {
  const { secreto } = configSesion()
  if (!valor || secreto.length < 32) return null
  const partes = valor.split('.')
  if (partes.length !== 4 || partes[0] !== 'a1') return null
  const [, cuenta, exp, sello] = partes as [string, string, string, string]
  const a = Buffer.from(firma(secreto, `a1.${cuenta}.${exp}`)), b = Buffer.from(sello)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return Number(exp) * 1000 > Date.now() ? cuenta : null
}
