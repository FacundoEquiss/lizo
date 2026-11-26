// El tipo de un tablero (compartido/vistas.ts): su ícono y la pantalla de elegirlo al crear. Un tablero tiene solo las vistas que
// necesita (Kanban, Lienzo, Diseño): «Tablero» es solo Kanban, «Diagrama» solo lienzo, «Diseño» solo la hoja de diseño y «Completo»
// las tres. Cada ícono es el de la pestaña de esa vista, así lo que se elige acá es lo que después se ve en la barra.
// Lo usan el diálogo «Nuevo tablero» y el formulario de «Nuevo proyecto» (escritorio) y la hoja del celular.
import { Frame, Layers, PenTool, SquareKanban, type LucideIcon } from 'lucide-react'
import { useRef } from 'react'
import { TEXTO_TIPO, TIPOS_TABLERO, tipoDeVistas, type TipoTablero, type VistaTablero } from '../../../compartido/vistas'

export const ICONO_VISTA: Record<VistaTablero, LucideIcon> = { kanban: SquareKanban, lienzo: Frame, diseno: PenTool }
export const ICONO_TIPO: Record<TipoTablero, LucideIcon> = { tablero: SquareKanban, diagrama: Frame, diseno: PenTool, completo: Layers }

/** El ícono del tipo de un tablero, según las vistas que tiene (con la leyenda para el lector de pantalla si se pide). */
export function IconoTablero({ vistas, tam = 14, className }: { vistas: readonly VistaTablero[] | undefined; tam?: number; className?: string }) {
  const Icono = ICONO_TIPO[tipoDeVistas(vistas ?? ['kanban', 'lienzo', 'diseno'])]
  return <Icono size={tam} className={className} aria-hidden />
}

/** Lo que dice el pie de la pantalla de elegir: Diseño es del proyecto, no del tablero (decisión de producto 3). */
export const NOTA_DISENO = 'Diseño es del proyecto: «Diseño» y «Completo» abren el sistema de diseño de este proyecto (si todavía no tiene, se crea vacío la primera vez).'

/**
 * Las cuatro opciones, con ícono y una frase. Es un grupo de radios (flechas para moverse, Enter o espacio para elegir, como en
 * el selector de tema). `compacto` las pone en una fila de cuatro, con la frase de la elegida abajo (para el formulario de proyecto).
 */
export function ElegirTipoTablero({
  valor,
  alCambiar,
  compacto,
  etiquetaId,
}: {
  valor: TipoTablero
  alCambiar: (t: TipoTablero) => void
  compacto?: boolean
  /** El id del texto que nombra el grupo (aria-labelledby). */
  etiquetaId: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const mover = (desde: number, paso: number) => {
    const i = (desde + paso + TIPOS_TABLERO.length) % TIPOS_TABLERO.length
    alCambiar(TIPOS_TABLERO[i]!)
    refs.current[i]?.focus()
  }
  return (
    <div className={`tipo-tablero${compacto ? ' tipo-tablero--compacto' : ''}`}>
      <div className="tipo-tablero__opciones" role="radiogroup" aria-labelledby={etiquetaId}>
        {TIPOS_TABLERO.map((t, i) => {
          const Icono = ICONO_TIPO[t]
          const activo = valor === t
          return (
            <button
              key={t}
              ref={(x) => {
                refs.current[i] = x
              }}
              type="button"
              role="radio"
              aria-checked={activo}
              tabIndex={activo ? 0 : -1}
              className={`tipo-tablero__opcion${activo ? ' tipo-tablero__opcion--activa' : ''}`}
              onClick={() => alCambiar(t)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  mover(i, 1)
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  mover(i, -1)
                }
              }}
            >
              <span className="tipo-tablero__icono">
                <Icono size={compacto ? 17 : 20} aria-hidden />
              </span>
              <span className="tipo-tablero__textos">
                <span className="tipo-tablero__nombre">{TEXTO_TIPO[t].nombre}</span>
                {!compacto && <span className="tipo-tablero__frase">{TEXTO_TIPO[t].frase}</span>}
              </span>
            </button>
          )
        })}
      </div>
      {compacto && (
        <p className="tipo-tablero__frase-elegida" aria-live="polite">
          {TEXTO_TIPO[valor].frase}
        </p>
      )}
      <p className="tipo-tablero__nota">{NOTA_DISENO}</p>
    </div>
  )
}
