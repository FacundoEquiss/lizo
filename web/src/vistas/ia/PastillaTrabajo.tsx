// La pastilla «Claude está trabajando…» con «Frenar» (plan 14.4 y tarea 2.15): mientras un agente de adentro tiene un trabajo en cola o
// en curso, se ve en la barra de arriba (en cualquier vista: el Kanban, el lienzo, Diseño) y la persona lo puede frenar sin
// buscar la tarjeta. Reemplaza al punto «En vivo» mientras dura. Con varios a la vez muestra el más nuevo y un «+2». Lo que dice
// el trabajo («Moviendo RC-2…») queda en el aviso del mouse y en el nombre accesible. La región en vivo que lo anuncia es
// `AnuncioDeTrabajo` (vistas/Notificaciones.tsx): la pastilla no se lee sola cada vez que cambia el paso.
// Se baja aparte (lazy): sin trabajos, ni se pide.
import { Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { esVivo } from '../../../../compartido/ia'
import { useIA } from '../../estado/ia'
import { Girando } from '../../ui/comunes'
import '../../estilos/ia-trabajo.css'
import { haciendo } from './trabajo'

/** `soloTarjeta`: solo los trabajos de esa tarjeta (el campo de comentar del celular dice qué pasa con lo que se acaba de mandar). */
export default function PastillaTrabajo({ className, soloTarjeta }: { className?: string; soloTarjeta?: string }) {
  const trabajos = useIA((s) => s.trabajos)
  const vivos = Object.values(trabajos)
    .filter((t) => esVivo(t.estado) && (!soloTarjeta || t.tarjetaClave === soloTarjeta))
    .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1))
  const [frenando, setFrenando] = useState<string | null>(null)
  const t = vivos[0]
  if (!t) return null
  const detalle = haciendo(t)
  const parando = frenando === t.id
  return (
    <span className={`pastilla-trabajo${className ? ` ${className}` : ''}`} data-trabajo={t.id} data-tip={detalle} title={detalle}>
      <span className="pastilla-trabajo__icono" aria-hidden>
        <Sparkles size={13} />
      </span>
      <span className="pastilla-trabajo__texto">{t.agenteNombre} está trabajando…</span>
      {vivos.length > 1 && (
        <span className="pastilla-trabajo__mas" aria-label={`y ${vivos.length - 1} más`}>
          +{vivos.length - 1}
        </span>
      )}
      <button
        type="button"
        className="pastilla-trabajo__frenar"
        disabled={parando}
        aria-label={`Frenar el pedido de ${t.agenteNombre}: ${detalle}`}
        onClick={async () => {
          setFrenando(t.id)
          if (!(await useIA.getState().cancelar(t.id))) setFrenando(null)
        }}
      >
        {parando ? <Girando tam={11} /> : <X size={12} aria-hidden />}
        <span>{parando ? 'Frenando…' : 'Frenar'}</span>
      </button>
    </span>
  )
}
