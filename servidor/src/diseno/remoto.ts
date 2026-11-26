// Online (Vercel): la función principal no lleva Chromium (no engorda ni se enfría). Cuando el MCP necesita una imagen,
// le pide el dibujo a la función render.func por HTTP, con la clave del MCP. Esa función corre el mismo renderizar() con el
// Chromium empaquetado (@sparticuz/chromium) y lee los archivos de la misma base. Ver scripts/vercel.mjs.
import type { Caja } from '../../../compartido/diseno/tipos'
import { ErrorDominio } from '../dominio/servicio'
import { firmarAlcance } from '../sesion'
import { modoRender, type EntradaRender, type OpcionesRender, type ResultadoRender } from './render'
import type { Motor } from './servicio-diseno'
import { urlPublica } from './urls'

/** ¿Este proceso puede abrir un navegador? En la computadora siempre; en Vercel, solo la función render.func. */
export function renderLocalDisponible(): boolean {
  return !process.env.VERCEL || modoRender() === 'empaquetado'
}

async function pedir<T>(ruta: string, cuerpo: unknown, cuenta?: string): Promise<T> {
  const clave = process.env.TABLERO_CLAVE
  if (!clave) throw new ErrorDominio('Falta TABLERO_CLAVE para pedirle el dibujo a la función de render.', 503)
  let r: Response
  try {
    r = await fetch(`${urlPublica()}${ruta}`, {
      method: 'POST',
      // La clave abre la puerta (y actúa como 'dueno'); la cuenta firmada dice de quién son los archivos del dibujo.
      headers: { 'content-type': 'application/json', 'x-tablero-clave': clave, ...(cuenta ? { 'x-tablero-alcance': firmarAlcance(cuenta) } : {}) },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(58_000),
    })
  } catch (e) {
    throw new ErrorDominio(`La función de render no contestó (${(e as Error).message}). Probá de nuevo en unos segundos: la primera vez tarda en arrancar.`, 503)
  }
  const texto = await r.text()
  let datos: any = null
  try {
    datos = JSON.parse(texto)
  } catch {
    datos = null
  }
  if (!r.ok) throw new ErrorDominio(datos?.error ?? `La función de render respondió ${r.status}.`, r.status === 404 ? 503 : r.status)
  return datos as T
}

interface RespuestaRender {
  bytes: string | null
  mime: string
  ancho: number
  alto: number
  avisos: string[]
  cajas: Record<string, Caja>
  estilos: Record<string, string>
  ms: number
}

export const motorRemoto: Motor = {
  async render(sd, pid, _marco, entrada: EntradaRender, op: OpcionesRender): Promise<ResultadoRender> {
    const d = await pedir<RespuestaRender>(`/api/diseno/${encodeURIComponent(pid)}/render-interno`, { entrada, op }, sd.s.cuenta)
    return { ...d, bytes: d.bytes ? new Uint8Array(Buffer.from(d.bytes, 'base64')) : null }
  },
  async grilla(imagenes) {
    const d = await pedir<{ bytes: string; ancho: number; alto: number }>(`/api/diseno/_/grilla-interna`, {
      imagenes: imagenes.map((i) => ({ ...i, bytes: Buffer.from(i.bytes).toString('base64') })),
    })
    return { bytes: new Uint8Array(Buffer.from(d.bytes, 'base64')), ancho: d.ancho, alto: d.alto }
  },
}
