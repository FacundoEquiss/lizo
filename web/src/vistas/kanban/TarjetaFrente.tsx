import { Clock, ListChecks, Lock, MessageSquare, Paperclip, Network } from 'lucide-react'
import { memo } from 'react'
import { ESTADOS_PORQUE } from '../../../../compartido/constantes'
import type { Etiqueta, Miembro, TarjetaResumen } from '../../../../compartido/tipos'
import { ChipEnlace, ChipEtiqueta, IconoPrioridad, IconoTipo, PilaAvatares } from '../../ui/comunes'
import { MarcaDiscord } from '../../ui/marcas'
import { fechaCorta, urgencia } from '../../util/fechas'

interface Props {
  tarjeta: TarjetaResumen
  etiquetas: Map<string, Etiqueta>
  miembros: Miembro[]
  destello?: number
  compacta?: boolean
  hecha?: boolean
}

/** El frente de una tarjeta: lo mismo en el kanban, en el lienzo y mientras se arrastra. */
export const TarjetaFrente = memo(function TarjetaFrente({ tarjeta: t, etiquetas, miembros, destello, compacta, hecha }: Props) {
  const urg = urgencia(t.fechas)
  const labels = t.etiquetas.map((id) => etiquetas.get(id)).filter(Boolean) as Etiqueta[]
  const porque = t.porque?.motivo ? ESTADOS_PORQUE.find((e) => e.id === t.porque!.estado) : null
  const checklistCompleta = t.contadores.checklistTotal > 0 && t.contadores.checklistHechos === t.contadores.checklistTotal
  const temporal = t.id.startsWith('tmp-')
  const mostrarDestello = destello && Date.now() - destello < 1600
  const portadaCompleta = t.portada?.tamano === 'completa'
  return (
    <div
      className={`tarjeta${compacta ? ' tarjeta--compacta' : ''}${hecha ? ' tarjeta--hecha' : ''}${temporal ? ' tarjeta--temporal' : ''}${
        t.archivada ? ' tarjeta--archivada' : ''
      }${portadaCompleta ? ' tarjeta--portada-completa' : ''}`}
    >
      {t.portada?.tipo === 'imagen' && !compacta && (
        <div className="tarjeta__portada">
          <img src={t.portada.valor} alt="" loading="lazy" draggable={false} />
        </div>
      )}
      {t.portada?.tipo === 'color' && (
        <div className="tarjeta__portada-color" style={{ background: `var(--e-${t.portada.valor}-s)` }} />
      )}
      <div className="tarjeta__cuerpo">
        {labels.length > 0 && (
          <div className="tarjeta__etiquetas">
            {labels.map((e) => (
              <ChipEtiqueta key={e.id} etiqueta={e} chica />
            ))}
          </div>
        )}
        <div className="tarjeta__titulo">{t.titulo}</div>
        <div className="tarjeta__pie">
          <span className="tarjeta__clave">
            <IconoTipo tipo={t.tipo} tam={15} />
            <span>{t.clave}</span>
          </span>
          <IconoPrioridad prioridad={t.prioridad} tam={15} />
          {t.fechas.vence && (
            <span className={`insignia insignia--vence insignia--${urg}`} title="Vencimiento">
              <Clock size={12} strokeWidth={2.4} />
              {fechaCorta(t.fechas.vence)}
            </span>
          )}
          {t.contadores.checklistTotal > 0 && (
            <span className={`insignia${checklistCompleta ? ' insignia--completa' : ''}`} title="Checklist">
              <ListChecks size={13} strokeWidth={2.2} />
              {t.contadores.checklistHechos}/{t.contadores.checklistTotal}
            </span>
          )}
          {t.contadores.comentarios > 0 && (
            <span className="insignia" title="Comentarios">
              <MessageSquare size={12} strokeWidth={2.2} />
              {t.contadores.comentarios}
            </span>
          )}
          {t.contadores.adjuntos > 0 && (
            <span className="insignia" title="Adjuntos">
              <Paperclip size={12} strokeWidth={2.2} />
              {t.contadores.adjuntos}
            </span>
          )}
          {t.contadores.vinculos > 0 && t.contadores.bloqueadaPor === 0 && (
            <span className="insignia" title="Vínculos con otras tarjetas">
              <Network size={12} strokeWidth={2.2} />
              {t.contadores.vinculos}
            </span>
          )}
          {t.contadores.bloqueadaPor > 0 && (
            <span className="insignia insignia--bloqueo" title="Depende de algo que no está hecho">
              <Lock size={11} strokeWidth={2.6} />
              Bloqueada
            </span>
          )}
          {porque && (
            <span className={`insignia insignia--porque insignia--porque-${porque.id}`} title={`Porqué: ${porque.nombre.toLowerCase()}`}>
              <span className="insignia__porque">¿?</span>
            </span>
          )}
          {t.discord && (
            <span className="insignia insignia--discord" title="Vino de Discord">
              <MarcaDiscord size={11} />
            </span>
          )}
          {t.enlaces.slice(0, 2).map((e) => (
            <ChipEnlace key={e.id} enlace={e} />
          ))}
          <span className="tarjeta__espacio" />
          <PilaAvatares ids={t.responsables} miembros={miembros} tam={22} />
        </div>
      </div>
      {mostrarDestello && <span key={destello} className="tarjeta__destello" aria-hidden />}
    </div>
  )
})
