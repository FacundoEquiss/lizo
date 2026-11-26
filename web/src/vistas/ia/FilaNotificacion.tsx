// Una notificación en la bandeja de la campana (PC) y en su hoja (celular): la misma fila para los dos (plan de la IA integrada,
// 8.4 y 14.5). Ícono del tipo (violeta si viene de una IA), el título en una línea, el cuerpo en una línea, hace cuánto y un
// punto si no se leyó. Tocarla lleva al lugar y la marca como leída. Una pieza por cosa: nada de variantes sueltas.
//   · Las de permiso (`confirmacion`) traen los botones «Permitir · No» ahí mismo, sin ir a la tarjeta (plan 14.5): la pieza es la
//     misma `ConfirmarAcciones` del hilo, que se baja recién cuando hay una para decidir. Decidir la marca como leída.
//   · Un fallo (`error_ia`) va en rojo de texto; los topes y los permisos, en el violeta de lo que es de una IA.
import { Archive, AtSign, Gauge, MessageSquareText, ShieldQuestionMark, TriangleAlert, UserPlus, type LucideIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { Notificacion, TipoNotificacion } from '../../../../compartido/ia'
import { ENLACE_AMIGOS, useIA } from '../../estado/ia'
import { hace } from '../../util/fechas'

const ConfirmarAcciones = lazy(() => import('./ConfirmarAcciones').then((m) => ({ default: m.ConfirmarAcciones })))

const ICONOS: Record<TipoNotificacion, LucideIcon> = {
  mencion: AtSign,
  respuesta: MessageSquareText,
  confirmacion: ShieldQuestionMark,
  tope: Gauge,
  error_ia: TriangleAlert,
  asignacion: UserPlus,
  aviso: Archive,
}

export function FilaNotificacion({ n, alAbrir }: { n: Notificacion; alAbrir: (n: Notificacion) => void }) {
  // Las de Amigos («Pablo pidió una cuenta») llevan a Configuración → Amigos: su ícono es el de sumar a alguien.
  const Icono = n.enlace === ENLACE_AMIGOS ? UserPlus : (ICONOS[n.tipo] ?? AtSign)
  const error = n.tipo === 'error_ia'
  const deIA = !error && (n.actor?.tipo === 'ia' || n.tipo === 'tope' || n.tipo === 'confirmacion')
  const sinLeer = !n.leidaEn
  const trabajo = useIA((s) => (n.tipo === 'confirmacion' && n.trabajoId ? s.trabajos[n.trabajoId] : undefined))
  const pide = trabajo?.estado === 'esperando_confirmacion'
  return (
    <>
      <button type="button" className={`fila-notif${sinLeer ? ' fila-notif--sin-leer' : ''}`} onClick={() => alAbrir(n)}>
        <span className={`fila-notif__icono${deIA ? ' fila-notif__icono--ia' : ''}${error ? ' fila-notif__icono--error' : ''}`} aria-hidden>
          <Icono size={16} strokeWidth={2.2} />
        </span>
        <span className="fila-notif__texto">
          <span className="fila-notif__titulo">
            {sinLeer && <span className="solo-lectores">Sin leer. </span>}
            {n.titulo}
          </span>
          {n.cuerpo && <span className="fila-notif__cuerpo">{n.cuerpo}</span>}
        </span>
        <span className="fila-notif__meta">
          <span className="fila-notif__cuando">{hace(n.creadoEn)}</span>
          {sinLeer && <span className="fila-notif__punto" aria-hidden />}
        </span>
      </button>
      {pide && (
        <Suspense fallback={null}>
          <ConfirmarAcciones trabajo={trabajo!} compacto alDecidir={() => void useIA.getState().marcarLeidas([n.id])} />
        </Suspense>
      )}
    </>
  )
}
