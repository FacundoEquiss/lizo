// Enlaces que devuelve Diseño (al MCP y a la actividad): llevan a una página y, si se quiere, a una capa exacta.
//   /RC/pendientes/diseno/celular?sel=m_3fk.a1b2c3
// Online, la dirección pública sale de TABLERO_URL_PUBLICA, de la del último pedido que llegó o de las variables de Vercel.
import { urlServidor } from '../config'

let ultimoOrigen: string | null = null

/** Lo llama la ruta de Diseño y el MCP en cada pedido: así los enlaces usan el dominio por el que entraron. */
export function recordarOrigen(url: string) {
  try {
    const u = new URL(url)
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && u.protocol === 'https:') ultimoOrigen = u.origin
  } catch {
    // nada
  }
}

export function urlPublica(): string {
  if (process.env.TABLERO_URL_PUBLICA) return process.env.TABLERO_URL_PUBLICA.replace(/\/+$/, '')
  if (ultimoOrigen) return ultimoOrigen
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return urlServidor()
}

export function urlDiseno(prefijo: string, tablero: string | null, pagina?: string | null, sel?: string | null): string {
  let u = `${urlPublica()}/${encodeURIComponent(prefijo)}`
  u += `/${encodeURIComponent(tablero || 'tablero')}/diseno`
  if (pagina) u += `/${encodeURIComponent(pagina)}`
  if (sel) u += `?sel=${encodeURIComponent(sel)}`
  return u
}

export const urlArchivo = (ruta: string) => (ruta.startsWith('/') ? `${urlPublica()}${ruta}` : ruta)
