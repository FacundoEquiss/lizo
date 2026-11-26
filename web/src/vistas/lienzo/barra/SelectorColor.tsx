// Grilla de los 10 colores (5 × 2). La muestra elegida lleva doble anillo; cada una tiene nombre (no solo color).
import { Ban, Wand2 } from 'lucide-react'
import { useRef, type KeyboardEvent as EventoTecla, type ReactNode } from 'react'
import { COLORES_LIENZO, NOMBRES_COLOR } from '../../../../../compartido/lienzo'
import type { Color } from '../../../../../compartido/tipos'
import { colorCss, type VariableColor } from './piezas'

export interface PropsSelectorColor {
  valor: Color | 'ninguno' | 'auto' | null
  alElegir: (c: Color | 'ninguno' | 'auto') => void
  /** Qué tono mostrar: notas (--n), suave (--e), fuerte (--e-s) o la tinta del texto (--tinta). */
  variable: VariableColor
  /** Texto de la opción "ninguno" (si se ofrece). */
  conNinguno?: string
  /** Texto de la opción "automático" (si se ofrece). */
  conAuto?: string
  /** La opción «Blanco» (relleno de formas y fondo de textos): aparte de los diez colores. */
  conBlanco?: { activo: boolean; alElegir: () => void }
  extra?: ReactNode
  tam?: 'normal' | 'grande'
}

export function SelectorColor({ valor, alElegir, variable, conNinguno, conAuto, conBlanco, extra, tam = 'normal' }: PropsSelectorColor) {
  const ref = useRef<HTMLDivElement>(null)
  const alTecla = (e: EventoTecla<HTMLDivElement>) => {
    const botones = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.selector-color__muestra') ?? [])]
    const i = botones.indexOf(document.activeElement as HTMLButtonElement)
    if (i === -1) return
    const salto = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 }[e.key]
    if (!salto) return
    e.preventDefault()
    e.stopPropagation()
    botones[Math.min(botones.length - 1, Math.max(0, i + salto))]?.focus()
  }
  return (
    <div className={`selector-color selector-color--${tam}`} onKeyDown={alTecla}>
      {(conAuto || conNinguno || conBlanco) && (
        <div className="selector-color__especiales">
          {conAuto && (
            <button className={`selector-color__especial${valor === 'auto' ? ' selector-color__especial--activo' : ''}`} onClick={() => alElegir('auto')} aria-pressed={valor === 'auto'}>
              <Wand2 size={14} /> {conAuto}
            </button>
          )}
          {conBlanco && (
            <button className={`selector-color__especial${conBlanco.activo ? ' selector-color__especial--activo' : ''}`} onClick={conBlanco.alElegir} aria-pressed={conBlanco.activo}>
              <span className="selector-color__blanco" aria-hidden /> Blanco
            </button>
          )}
          {conNinguno && (
            <button className={`selector-color__especial${valor === 'ninguno' ? ' selector-color__especial--activo' : ''}`} onClick={() => alElegir('ninguno')} aria-pressed={valor === 'ninguno'}>
              <Ban size={14} /> {conNinguno}
            </button>
          )}
        </div>
      )}
      <div ref={ref} className="selector-color__grilla" role="listbox" aria-label="Color">
        {COLORES_LIENZO.map((c) => (
          <button
            key={c}
            role="option"
            aria-selected={valor === c}
            aria-label={NOMBRES_COLOR[c]}
            data-tip={NOMBRES_COLOR[c]}
            className={`selector-color__muestra${valor === c ? ' selector-color__muestra--activa' : ''}`}
            style={{ background: colorCss(variable, c) }}
            onClick={() => alElegir(c)}
          />
        ))}
      </div>
      {extra}
    </div>
  )
}
