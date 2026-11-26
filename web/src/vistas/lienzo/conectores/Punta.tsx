// Puntas de los conectores dibujadas a mano (5.7.4): un trazo en el extremo, girado según el ángulo de llegada, del
// color del conector y de tamaño 6 + grosor × 2,5. Reemplazan a los <marker> de SVG (que no heredan el color: harían
// falta 140 para 7 puntas × 10 colores × 2 extremos). La línea se acorta lo que mide la punta para no asomar por detrás.
import { memo } from 'react'
import type { Punta as TipoPunta } from '../../../../../compartido/tipos'

export const largoPunta = (grosor: number) => 6 + grosor * 2.5

/** Cuánto se acorta la línea en ese extremo para terminar adentro (o en el borde) de la punta. */
export function retroceso(tipo: TipoPunta, grosor: number): number {
  const l = largoPunta(grosor)
  switch (tipo) {
    case 'flecha':
      return l * 0.62
    case 'flecha_abierta':
      return grosor * 0.6
    case 'triangulo':
      return l
    case 'punto':
      return l * 0.32
    case 'rombo':
      return l * 0.5
    default:
      return 0
  }
}

/** La forma de la punta mirando hacia +x, con el extremo en (0, 0). */
function trazado(tipo: TipoPunta, l: number): { d: string; relleno: boolean } | null {
  const a = l * 0.5
  switch (tipo) {
    case 'flecha':
      // Con la cola apenas cóncava: se lee dibujada, no de plantilla.
      return { d: `M0 0 L${-l} ${-a} Q${-l * 0.72} 0 ${-l} ${a} Z`, relleno: true }
    case 'flecha_abierta':
      return { d: `M${-l} ${-a} L0 0 L${-l} ${a}`, relleno: false }
    case 'triangulo':
      return { d: `M0 0 L${-l} ${-a} L${-l} ${a} Z`, relleno: false }
    case 'rombo':
      return { d: `M0 0 L${-l / 2} ${-l * 0.32} L${-l} 0 L${-l / 2} ${l * 0.32} Z`, relleno: true }
    case 'barra':
      return { d: `M0 ${-l * 0.42} L0 ${l * 0.42}`, relleno: false }
    default:
      return null
  }
}

export const Punta = memo(function Punta({
  tipo,
  x,
  y,
  angulo,
  grosor,
  color,
  className,
}: {
  tipo: TipoPunta
  x: number
  y: number
  /** En radianes: hacia dónde apunta. */
  angulo: number
  grosor: number
  color: string
  className?: string
}) {
  if (tipo === 'ninguna') return null
  const l = largoPunta(grosor)
  const transformacion = `translate(${x} ${y}) rotate(${(angulo * 180) / Math.PI})`
  if (tipo === 'punto') {
    const r = l * 0.32
    return <circle className={className} cx={-r} cy={0} r={r} transform={transformacion} style={{ fill: color }} />
  }
  const t = trazado(tipo, l)
  if (!t) return null
  return (
    <path
      className={className}
      d={t.d}
      transform={transformacion}
      style={
        t.relleno
          ? { fill: color, stroke: color, strokeWidth: 0.8, strokeLinejoin: 'round' }
          : { fill: 'none', stroke: color, strokeWidth: Math.max(1.2, grosor), strokeLinejoin: 'round', strokeLinecap: 'round' }
      }
    />
  )
})

/** Muestra de una punta para los menús (24 × 16, hacia la derecha). */
export function MuestraPunta({ tipo, inicio }: { tipo: TipoPunta; inicio?: boolean }) {
  const g = 1.6
  const x2 = 21 - retroceso(tipo, g)
  return (
    <svg width={26} height={16} viewBox="0 0 26 16" aria-hidden style={inicio ? { transform: 'scaleX(-1)' } : undefined}>
      <line x1={3} y1={8} x2={tipo === 'ninguna' ? 23 : x2} y2={8} stroke="currentColor" strokeWidth={g} strokeLinecap="round" />
      <Punta tipo={tipo} x={21} y={8} angulo={0} grosor={g} color="currentColor" />
    </svg>
  )
}
