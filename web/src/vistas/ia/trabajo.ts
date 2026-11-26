// Los textos y las cuentas de la parte de «trabajos» de la IA integrada (plan 14.4 y 14.6), puros y sin pantalla: lo que dicen el
// hilo de la tarjeta, la pastilla de arriba y las notificaciones cuando un agente piensa, pide permiso, se pausa o falla. Están
// juntos para que las tres piezas digan lo mismo con las mismas palabras (una pieza por cosa).
import type { EstadoIA, TrabajoResumen } from '../../../../compartido/ia'
import type { Miembro } from '../../../../compartido/tipos'

/** «USD 0,09»: dos decimales, coma argentina. */
export const usd = (n: number) => `USD ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** El costo del pie: «≈ USD 0,09», o «menos de USD 0,01» si es una fracción de centavo. null si no costó nada. */
export function costoLegible(n: number): string | null {
  if (!(n > 0)) return null
  return n < 0.005 ? 'menos de USD 0,01' : `≈ ${usd(n)}`
}

/** «noviembre» (el mes de los topes). */
export const mesDeHoy = (ahora = new Date()) => ahora.toLocaleDateString('es-AR', { month: 'long' })

/** Saca el punto final: los motivos del servidor son frases enteras y se meten adentro de otra. */
export const sinPunto = (t: string) => t.trim().replace(/[.\s]+$/, '')

/** Con la primera en minúscula (para seguir después de los dos puntos). */
export const enMinuscula = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t)

/** El nombre de un proveedor como lo escribe la pantalla. */
export const NOMBRE_PROVEEDOR: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', compatible: 'El proveedor', falso: 'El proveedor' }

/** ¿Es un trabajo de una tarjeta que se ve en su hilo (en curso, con permiso pendiente, pausado, fallado o cancelado hace poco)? */
export function seVeEnElHilo(t: TrabajoResumen, clave: string, hayRespuesta: boolean, ahora = Date.now()): boolean {
  if (t.tarjetaClave !== clave) return false
  if (t.estado === 'hecho') {
    // Se queda unos segundos hasta que llega su comentario (los eventos no llegan en el mismo cuadro): sin parpadeo.
    return !hayRespuesta && !!t.terminadoEn && ahora - Date.parse(t.terminadoEn) < 8000
  }
  // Un trabajo que se frenó se va solo en cuanto se recarga (14.4): acá, a los pocos segundos.
  if (t.estado === 'cancelado') return !!t.terminadoEn && ahora - Date.parse(t.terminadoEn) < 6000
  return true
}

/** Lo que está haciendo, en una línea: «Leyendo RC-98…» o «Claude está pensando…». */
export const haciendo = (t: TrabajoResumen) => t.haciendo ?? `${t.agenteNombre} está pensando…`

/** El miembro que es este agente (para su avatar). */
export const miembroDeAgente = (t: TrabajoResumen, miembros: Miembro[]) => miembros.find((m) => m.id === t.agenteId) ?? null

/**
 * Por qué se pausó un trabajo y qué se puede hacer (14.4 y 14.6). `estado` trae los topes: sin él (todavía no se pidió) el texto
 * dice lo mismo sin el número.
 */
export function textoDePausa(t: TrabajoResumen, estado: EstadoIA | null): { texto: string; tipo: 'agente' | 'cuenta' | 'trabajo' | 'proveedor' | 'pausa' } {
  const mes = mesDeHoy()
  const agente = estado?.agentes.find((a) => a.miembroId === t.agenteId)
  switch (t.motivo) {
    case 'tope_agente':
      return { tipo: 'agente', texto: `Pausado: ${t.agenteNombre} llegó a su tope${agente ? ` de ${usd(agente.topeMesUsd)}` : ''} de ${mes}. No se perdió nada.` }
    case 'tope_cuenta':
      return {
        tipo: 'cuenta',
        texto: `Pausado: llegaste al tope${estado ? ` de ${usd(estado.ajustes.topeMesUsd)}` : ''} de ${mes} para toda la IA. No se perdió nada.`,
      }
    case 'tope_trabajo':
      return { tipo: 'trabajo', texto: `Este pedido ya gastó ${usd(t.costoUsd)}. ¿Sigue?` }
    case 'tope_proveedor':
      return {
        tipo: 'proveedor',
        texto: `Pausado: ${agente?.proveedor ? NOMBRE_PROVEEDOR[agente.proveedor] : 'El proveedor'} frenó por el límite de gasto de tu cuenta. No se perdió nada.`,
      }
    default:
      return { tipo: 'pausa', texto: 'La IA está pausada. Se prende de nuevo en Configuración → IA.' }
  }
}
