// Exportar y compartir la imagen de un marco desde el teléfono. La imagen la dibuja el servidor (el mismo render que usan
// la PC y el MCP: lo que se comparte es idéntico a lo que se ve). En Android, Chrome comparte archivos con la hoja del
// sistema (WhatsApp, Drive, Fotos…); si no se puede, se descarga.
//   · La imagen se prepara ANTES de tocar "Compartir": el navegador solo deja abrir la hoja del sistema durante el toque, y
//     esperar al render (medio segundo en local, unos segundos online) lo vencería.
import { clienteId } from '../../../estado/api'
import { sesionVencida } from '../../../estado/sesion'
import { urlRender } from '../api'

export type Formato = 'png' | 'jpg'

export interface MarcoParaExportar {
  id: string
  nombre: string
  ancho: number
  alto: number
}

/** "Posteo · 2x1" a 2x → "posteo-2x1-2160x2160.png" */
export function nombreArchivo(m: MarcoParaExportar, formato: Formato, escala: number): string {
  const base =
    m.nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w-]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'marco'
  return `${base}-${Math.round(m.ancho * escala)}x${Math.round(m.alto * escala)}.${formato}`
}

/** Escala de fábrica: 2x para piezas chicas (pantallas del celular, posteos), 1x para lo que ya es grande. */
export const escalaDeFabrica = (m: MarcoParaExportar) => (Math.max(m.ancho, m.alto) <= 1100 ? 2 : 1)

export async function armarImagen(prefijo: string, m: MarcoParaExportar, formato: Formato, escala: number, senal?: AbortSignal): Promise<File> {
  let r: Response
  try {
    r = await fetch(urlRender(prefijo, m.id, { formato, escala }), { headers: { 'x-tablero-cliente': clienteId }, signal: senal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error('No hay conexión con el servidor de Telar.')
  }
  if (!r.ok) {
    let mensaje = ''
    try {
      const d = (await r.json()) as { error?: string; entrar?: boolean }
      if (r.status === 401 && d.entrar) sesionVencida()
      mensaje = d.error ?? ''
    } catch {
      // sin cuerpo legible
    }
    throw new Error(mensaje || `No pude armar la imagen (error ${r.status}).`)
  }
  const blob = await r.blob()
  return new File([blob], nombreArchivo(m, formato, escala), { type: blob.type || (formato === 'jpg' ? 'image/jpeg' : 'image/png') })
}

export function puedeCompartir(archivo: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [archivo] })
  } catch {
    return false
  }
}

/** Abre la hoja de compartir del sistema. 'cancelado' si la persona la cerró sin elegir. */
export async function compartirArchivo(archivo: File, titulo: string): Promise<'ok' | 'cancelado'> {
  try {
    await navigator.share({ files: [archivo], title: titulo })
    return 'ok'
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelado'
    throw e
  }
}

export function descargarArchivo(archivo: File) {
  const url = URL.createObjectURL(archivo)
  const a = document.createElement('a')
  a.href = url
  a.download = archivo.name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Copia un texto (el enlace a un marco). Devuelve si pudo. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
