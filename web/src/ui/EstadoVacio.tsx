// Los estados vacíos (9.2), todos con el mismo molde: ícono de 28 px, una línea de título, una de ayuda y, si hay algo
// para hacer, un botón. Sin dibujos ni borde. `chico` es para adentro de un menú o de un buscador.
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EstadoVacio({
  icono: Icono,
  titulo,
  ayuda,
  accion,
  chico,
  className,
}: {
  icono?: LucideIcon
  titulo: ReactNode
  ayuda?: ReactNode
  accion?: ReactNode
  chico?: boolean
  className?: string
}) {
  return (
    <div className={`estado-vacio${chico ? ' estado-vacio--chico' : ''}${className ? ` ${className}` : ''}`} role="status">
      {Icono && <Icono size={chico ? 22 : 28} aria-hidden />}
      <b>{titulo}</b>
      {ayuda && <span>{ayuda}</span>}
      {accion}
    </div>
  )
}
