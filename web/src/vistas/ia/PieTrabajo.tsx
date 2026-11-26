// El pie de un comentario que salió de un trabajo de un agente (plan 14.4): qué hizo, en palabras llanas, y cuánto costó.
//   «Movió RC-104 a Hecho · Comentó en RC-98»  ·  ≈ USD 0,09
// Sin «Deshacer»: eso llega con la F3 (deshacer por tanda). Sin cambios, dice «Solo respondió». El costo va en el tono más
// apagado y es una estimación del servidor (el gasto exacto está en Configuración → IA).
import { Sparkles } from 'lucide-react'
import type { TrabajoResumen } from '../../../../compartido/ia'
import '../../estilos/ia-trabajo.css'
import { costoLegible } from './trabajo'

export function PieTrabajo({ trabajo: t }: { trabajo: TrabajoResumen }) {
  const costo = costoLegible(t.costoUsd)
  return (
    <p className="pie-trabajo" data-trabajo={t.id}>
      <Sparkles size={11} aria-hidden />
      <span className="pie-trabajo__hizo">{t.hizo.length ? t.hizo.join(' · ') : 'Solo respondió'}</span>
      {costo && (
        <span className="pie-trabajo__costo" title={`${t.paso} ${t.paso === 1 ? 'paso' : 'pasos'} de trabajo`}>
          {costo}
        </span>
      )}
    </p>
  )
}
