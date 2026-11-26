// Piezas de la barra contextual: botón, botón con menú, separador y muestra de color. Las usan todas las secciones.
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Color } from '../../../../../compartido/tipos'
import { Desplegable } from '../../../ui/Desplegable'

export type TamBarra = 'normal' | 'grande'

/** Tono de una muestra: notas (--n), suave (--e), fuerte (--e-s) o tinta del texto (--tinta). */
export type VariableColor = '--n' | '--e' | '--e-s' | '--tinta'

export const colorCss = (variable: VariableColor, c: Color) => (variable === '--e-s' ? `var(--e-${c}-s)` : `var(${variable}-${c})`)

export function BotonBarra({
  icono,
  etiqueta,
  activo,
  onClick,
  atajo,
  texto,
  tam = 'normal',
  peligro,
  deshabilitado,
}: {
  icono?: ReactNode
  etiqueta: string
  activo?: boolean
  onClick: () => void
  atajo?: string
  texto?: ReactNode
  tam?: TamBarra
  peligro?: boolean
  deshabilitado?: boolean
}) {
  return (
    <button
      type="button"
      className={`barra-ctx__boton${texto ? ' barra-ctx__boton--texto' : ''}${activo ? ' barra-ctx__boton--activo' : ''}${tam === 'grande' ? ' barra-ctx__boton--grande' : ''}${peligro ? ' barra-ctx__boton--peligro' : ''}`}
      onClick={onClick}
      // No le saca el foco al editor de texto (se puede dar formato mientras se escribe).
      onMouseDown={(e) => e.preventDefault()}
      aria-label={etiqueta}
      aria-pressed={activo === undefined ? undefined : activo}
      aria-disabled={deshabilitado || undefined}
      disabled={deshabilitado}
      data-tip={etiqueta}
      data-tecla={atajo}
    >
      {icono}
      {texto}
    </button>
  )
}

/** Botón de la barra que abre un menú (hacia abajo de la barra, con 8 px de separación). */
export function MenuBarra({
  etiqueta,
  disparador,
  children,
  ancho,
  tam = 'normal',
  className,
  activo,
}: {
  etiqueta: string
  disparador: ReactNode
  children: (cerrar: () => void) => ReactNode
  ancho?: number
  tam?: TamBarra
  className?: string
  activo?: boolean
}) {
  return (
    <Desplegable
      lado="bottom"
      separacion={8}
      ancho={ancho}
      className={`menu-barra ${className ?? ''}`}
      disparador={(p) => (
        <button
          {...p}
          type="button"
          className={`barra-ctx__boton barra-ctx__boton--menu${activo ? ' barra-ctx__boton--activo' : ''}${tam === 'grande' ? ' barra-ctx__boton--grande' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          aria-label={etiqueta}
          data-tip={etiqueta}
        >
          {disparador}
          <ChevronDown size={12} className="barra-ctx__flecha" />
        </button>
      )}
    >
      {(cerrar) => children(cerrar)}
    </Desplegable>
  )
}

export function Separador() {
  return <span className="barra-ctx__sep" aria-hidden />
}

export function Muestra({ color, variable }: { color: Color | 'ninguno' | 'auto' | null; variable: VariableColor }) {
  if (!color || color === 'ninguno' || color === 'auto') return <span className="barra-ctx__muestra barra-ctx__muestra--vacia" />
  return <span className="barra-ctx__muestra" style={{ background: colorCss(variable, color) }} />
}
