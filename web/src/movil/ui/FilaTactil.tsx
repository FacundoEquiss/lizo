// Fila de 56 px para listas táctiles (menú, selector de tablero, buscador): ícono, texto, detalle y flecha.
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Proyecto } from '../../../../compartido/tipos'

interface Props {
  icono?: ReactNode
  texto: ReactNode
  bajada?: ReactNode
  detalle?: ReactNode
  flecha?: boolean
  peligro?: boolean
  alto?: 48 | 56 | 60
  onClick?: () => void
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

export function FilaTactil({ icono, texto, bajada, detalle, flecha, peligro, alto = 56, onClick, className, disabled, ...resto }: Props) {
  return (
    <button
      type="button"
      className={`fila-tactil fila-tactil--${alto}${peligro ? ' fila-tactil--peligro' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={resto['aria-label']}
    >
      {icono && <span className="fila-tactil__icono">{icono}</span>}
      <span className="fila-tactil__texto">
        <span className="fila-tactil__principal">{texto}</span>
        {bajada && <span className="fila-tactil__bajada">{bajada}</span>}
      </span>
      {detalle && <span className="fila-tactil__detalle">{detalle}</span>}
      {flecha && <ChevronRight size={18} className="fila-tactil__flecha" aria-hidden />}
    </button>
  )
}

/**
 * Sello del proyecto (dos letras sobre su color), como en escritorio. Cuando el plan de escritorio sume AvatarProyecto
 * (foto, emoji o iniciales: N10) se reemplaza por ese, con las mismas propiedades.
 */
export function SelloProyecto({ proyecto, tam = 32 }: { proyecto: Pick<Proyecto, 'prefijo' | 'color' | 'nombre'>; tam?: number }) {
  return (
    <span
      className="sello-movil"
      // Fondo suave y letra del mismo color (como las etiquetas): 4,5:1 en los dos temas; blanco sobre el color fuerte no llega.
      style={{
        width: tam,
        height: tam,
        fontSize: Math.round(tam * 0.4),
        borderRadius: Math.round(tam * 0.3),
        background: `var(--e-${proyecto.color})`,
        color: `var(--e-${proyecto.color}-t)`,
      }}
      aria-hidden
    >
      {proyecto.prefijo.slice(0, 2)}
    </span>
  )
}
