// OAuth 2.1 de Telar: configuración común (24/11/2026).
// Telar es su propio servidor de autorización (dentro de la misma función de Vercel) para que ChatGPT y claude.ai se conecten
// al MCP. Solo existe online: en la computadora no hay cuentas, y ahí el MCP sigue con la clave.
import type { Context } from 'hono'
import { esPublico } from '../sesion'
import { secretoOAuth } from './firmas'

export const VIDA_CODIGO_S = 60
export const VIDA_ACCESO_S = 3600
export const VIDA_REFRESCO_DIAS = 30
export const VIDA_PEDIDO_S = 600
export const SCOPES = ['telar', 'offline_access'] as const
export const SCOPE_BASE = 'telar'
export const MAX_CLIENTES = 200

/** ¿Está prendido el OAuth? Solo online y con un secreto de al menos 32 caracteres. */
export const oauthActivo = () => esPublico() && secretoOAuth() !== null

const esLoopback = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'

/**
 * El «emisor» (issuer) y la base del recurso. Sale de TABLERO_URL_PUBLICA o, si no está, del origen del pedido.
 * Tiene que ser siempre el mismo entre pedidos: por eso no usa `urlPublica()` (que recuerda «el último origen visto»).
 */
export function emisor(c: Context): string {
  const fija = (process.env.TABLERO_URL_PUBLICA || '').trim().replace(/\/+$/, '')
  if (fija) return fija
  const u = new URL(c.req.url)
  // Online (Vercel) siempre es https; el http solo vale para la prueba en la propia computadora.
  const protocolo = esLoopback(u.hostname) ? u.protocol : 'https:'
  return `${protocolo}//${u.host}`
}

export const recursoMcp = (c: Context) => `${emisor(c)}/mcp`

// Redirecciones permitidas para los clientes: los conectores de ChatGPT y de Claude, y la propia computadora (Claude Code,
// MCP Inspector, las pruebas). DCR es abierto: esta lista es lo que corta el abuso.
const HOSTS_CONECTORES = new Set(['chatgpt.com', 'www.chatgpt.com', 'claude.ai', 'claude.com', 'www.claude.ai', 'www.claude.com'])

export function redireccionPermitida(uri: string): boolean {
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    return false
  }
  if (u.hash) return false
  if (u.username || u.password) return false
  if (u.protocol === 'https:' && HOSTS_CONECTORES.has(u.hostname)) return true
  if (u.protocol === 'http:' && esLoopback(u.hostname)) return true
  const extra = (process.env.TABLERO_OAUTH_REDIRECCIONES || '').split(',').map((s) => s.trim()).filter(Boolean)
  return u.protocol === 'https:' && extra.some((e) => uri === e || uri.startsWith(e.endsWith('/') ? e : `${e}/`))
}

/** Para la pantalla «Permitir»: el sitio al que se vuelve, sin camino. */
export const sitioDe = (uri: string) => {
  try {
    const u = new URL(uri)
    return u.host
  } catch {
    return ''
  }
}

/** Deja pasar solo los scopes que Telar conoce; si no pidió ninguno, el de base. */
export function scopeDe(pedido: string | undefined | null): string {
  const pedidos = (pedido ?? '').split(/\s+/).filter(Boolean)
  const validos = pedidos.filter((s) => (SCOPES as readonly string[]).includes(s))
  return validos.length ? [...new Set([SCOPE_BASE, ...validos])].join(' ') : SCOPE_BASE
}
