// OAuth de Telar: firmas y hashes. Los tokens de acceso son JWT (HS256) de una hora, sin consulta a la base por pedido
// (la función de Vercel no guarda nada en memoria entre pedidos). Los códigos y los refrescos se guardan como hash.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * El secreto con el que se firman los tokens. TABLERO_OAUTH_SECRETO si existe; si no, se deriva de TABLERO_SECRETO (el de la
 * cookie), así no hace falta cargar una variable nueva en Vercel. Contra: rotar TABLERO_SECRETO también vence los tokens.
 */
export function secretoOAuth(): string | null {
  const propio = (process.env.TABLERO_OAUTH_SECRETO || '').trim()
  if (propio.length >= 32) return propio
  const base = process.env.TABLERO_SECRETO || ''
  if (base.length < 32) return null
  return createHmac('sha256', base).update('telar-oauth-v1').digest('hex')
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

export const sha256 = (t: string) => createHash('sha256').update(t).digest('hex')
export const sha256Base64Url = (t: string) => createHash('sha256').update(t).digest('base64url')
export const alAzar = (bytes = 32) => randomBytes(bytes).toString('base64url')

export function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export interface CargaJwt {
  /** Para qué es: un token de acceso o el pedido firmado que va de /oauth/autorizar a la pantalla «Permitir». */
  t: 'acceso' | 'pedido'
  iss?: string
  aud?: string
  sub?: string
  exp: number
  iat: number
  [clave: string]: unknown
}

function firmar(secreto: string, base: string) {
  return createHmac('sha256', secreto).update(base).digest('base64url')
}

export function firmarJwt(carga: CargaJwt): string {
  const secreto = secretoOAuth()
  if (!secreto) throw new Error('Falta el secreto de OAuth (TABLERO_SECRETO de 32 caracteres o más).')
  const base = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(carga)}`
  return `${base}.${firmar(secreto, base)}`
}

/** La carga de un JWT bien firmado, del tipo pedido y sin vencer; si no, null. */
export function leerJwt(token: string, tipo: CargaJwt['t']): CargaJwt | null {
  const secreto = secretoOAuth()
  if (!secreto || typeof token !== 'string') return null
  const partes = token.split('.')
  if (partes.length !== 3) return null
  const [cab, carga, sello] = partes as [string, string, string]
  try {
    const encabezado = JSON.parse(Buffer.from(cab, 'base64url').toString('utf8')) as { alg?: string }
    if (encabezado.alg !== 'HS256') return null
    if (!iguales(firmar(secreto, `${cab}.${carga}`), sello)) return null
    const datos = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as CargaJwt
    if (datos.t !== tipo) return null
    if (!(typeof datos.exp === 'number' && datos.exp * 1000 > Date.now())) return null
    return datos
  } catch {
    return null
  }
}

export const ahoraS = () => Math.floor(Date.now() / 1000)
