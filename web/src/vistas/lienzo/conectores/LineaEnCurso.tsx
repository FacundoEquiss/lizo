// La línea que queda dibujada mientras está abierto el menú "Crear y conectar" (5.7.1): del objeto de origen al punto
// donde se soltó, con el estilo de fábrica del conector. Si se cancela, se desvanece en 120 ms.
import { useInternalNode } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { usePreferencias } from '../../../estado/preferencias'
import type { ConexionPendiente } from '../estado'
import type { NodoLienzo } from '../tipos'
import { colorConector, geometria, patronLinea } from './Arista'
import { Punta } from './Punta'
import { cajaDe } from './rutas'

function Linea({ pendiente, saliendo }: { pendiente: ConexionPendiente; saliendo?: boolean }) {
  const n = useInternalNode<NodoLienzo>(pendiente.desdeId)
  const estilo = usePreferencias((s) => s.estilos.conector)
  if (!n) return null
  const c = { ...estilo, desdeLado: pendiente.desdeLado, hastaLado: null }
  const g = geometria(c, cajaDe(n), { punto: pendiente.punto })
  const color = colorConector(estilo)
  const patron = patronLinea(estilo.guion, estilo.grosor)
  return (
    <svg className={`linea-en-curso${saliendo ? ' linea-en-curso--saliendo' : ''}`} aria-hidden>
      <path d={g.ruta} style={{ stroke: color, strokeWidth: estilo.grosor, strokeDasharray: patron.dasharray, strokeLinecap: patron.linecap, fill: 'none' }} />
      <Punta tipo={estilo.puntaInicio} x={g.pa.x} y={g.pa.y} angulo={g.anguloInicio} grosor={estilo.grosor} color={color} />
      <Punta tipo={estilo.puntaFin} x={g.pb.x} y={g.pb.y} angulo={g.anguloFin} grosor={estilo.grosor} color={color} />
    </svg>
  )
}

/** Va dentro de ViewportPortal (coordenadas del lienzo). `cancelada`: se desvanece; si no, desaparece en el acto. */
export function LineaEnCurso({ pendiente, cancelada }: { pendiente: ConexionPendiente | null; cancelada: boolean }) {
  const [saliendo, setSaliendo] = useState<ConexionPendiente | null>(null)
  const [ultima, setUltima] = useState<ConexionPendiente | null>(null)
  useEffect(() => {
    if (pendiente) {
      setUltima(pendiente)
      setSaliendo(null)
      return
    }
    if (ultima && cancelada) {
      setSaliendo(ultima)
      const t = setTimeout(() => setSaliendo(null), 120)
      setUltima(null)
      return () => clearTimeout(t)
    }
    setUltima(null)
    // ultima es el estado anterior: no es dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendiente, cancelada])
  if (pendiente) return <Linea pendiente={pendiente} />
  if (saliendo) return <Linea pendiente={saliendo} saliendo />
  return null
}
