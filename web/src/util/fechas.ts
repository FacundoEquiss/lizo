import type { Fechas } from '../../../compartido/tipos'

const corta = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' })
const conAnio = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
const hora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' })

export function fechaCorta(iso: string, conHora = false): string {
  const d = new Date(iso)
  const base = (d.getFullYear() === new Date().getFullYear() ? corta : conAnio).format(d).replace('.', '')
  return conHora ? `${base}, ${hora.format(d)}` : base
}

/** Colores del vencimiento, como Trello: gris, amarillo (<24 h), rojo (vencida hace <24 h), rosa (vencida hace más), verde (cumplida). */
export type Urgencia = 'normal' | 'pronto' | 'vencida' | 'muy-vencida' | 'cumplida'

export function urgencia(f: Fechas, ahora = Date.now()): Urgencia | null {
  if (!f.vence) return null
  if (f.completada) return 'cumplida'
  const diff = new Date(f.vence).getTime() - ahora
  const dia = 24 * 3600 * 1000
  if (diff < -dia) return 'muy-vencida'
  if (diff < 0) return 'vencida'
  if (diff < dia) return 'pronto'
  return 'normal'
}

const rtf = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' })

export function hace(iso: string, ahora = Date.now()): string {
  const s = Math.round((new Date(iso).getTime() - ahora) / 1000)
  const abs = Math.abs(s)
  if (abs < 45) return 'recién'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day')
  return fechaCorta(iso)
}

/** Para <input type="date">: AAAA-MM-DD en hora local. */
export function aInputFecha(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function aInputHora(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function desdeInputs(fecha: string, horaTexto?: string): string | null {
  if (!fecha) return null
  const d = new Date(`${fecha}T${horaTexto || '12:00'}:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
