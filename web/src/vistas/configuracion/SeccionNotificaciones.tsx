// Configuración → Notificaciones (plan de la IA integrada, 8.3 y 14.7): una fila por tipo de aviso con su interruptor y el
// horario de «No molestar». Todo aparece siempre en la campana: esto decide qué llega además al aparato (el push llega en la
// F5; lo que se elija ya queda guardado). Se guarda al instante, como el resto de Configuración: el cambio se ve primero y si
// el servidor no lo acepta vuelve atrás y avisa. La usan también la hoja de preferencias del celular y la de escritorio.
import { CloudOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PreferenciasNotificaciones, TipoNotificacion } from '../../../../compartido/ia'
import { api, ErrorApi } from '../../estado/api'
import { avisarError } from '../../estado/avisos'
import { Girando, Interruptor } from '../../ui/comunes'
import { EstadoVacio } from '../../ui/EstadoVacio'
import { Fila, Grupo } from './piezas'

const TIPOS: { id: TipoNotificacion; nombre: string; descripcion: string }[] = [
  { id: 'mencion', nombre: 'Cuando me mencionan', descripcion: 'Alguien (o una IA) te escribió con @ en una tarjeta.' },
  { id: 'respuesta', nombre: 'Cuando una IA me responde', descripcion: 'Una IA terminó lo que le pediste o atendió tu mención.' },
  { id: 'confirmacion', nombre: 'Cuando una IA necesita permiso', descripcion: 'Quiere hacer algo delicado y espera que le digas que sí.' },
  { id: 'tope', nombre: 'Topes de gasto', descripcion: 'Una IA llegó al 80 % o al 100 % de lo que le fijaste por mes.' },
  { id: 'error_ia', nombre: 'Cuando algo falla', descripcion: 'Un pedido a una IA no se pudo terminar o una clave dejó de andar.' },
  { id: 'asignacion', nombre: 'Cuando me asignan una tarjeta', descripcion: 'Una IA (o una persona) te puso como responsable.' },
  { id: 'aviso', nombre: 'Cuando Telar ordena algo solo', descripcion: 'Por ejemplo, que archivó tarjetas viejas de Hecho. Siguen en Archivadas.' },
]

/** El horario de silencio de fábrica al prenderlo. */
const SILENCIO_DE_FABRICA = { desde: '22:00', hasta: '08:00' }

type Carga = { estado: 'cargando' } | { estado: 'error'; sinRutas: boolean } | { estado: 'lista'; prefs: PreferenciasNotificaciones }

export function SeccionNotificaciones() {
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const ultima = useRef(0)

  const cargar = useCallback(() => {
    setCarga({ estado: 'cargando' })
    api
      .preferenciasNotificaciones()
      .then((prefs) => setCarga({ estado: 'lista', prefs }))
      .catch((e) => setCarga({ estado: 'error', sinRutas: e instanceof ErrorApi && (e.estado === 404 || e.estado === 405) }))
  }, [])
  useEffect(cargar, [cargar])

  /** Guarda un cambio: se ve ya y, si el servidor no lo acepta, vuelve a como estaba. Gana siempre el último pedido. */
  async function guardar(cambios: Partial<PreferenciasNotificaciones>) {
    if (carga.estado !== 'lista') return
    const antes = carga.prefs
    const yo = ++ultima.current
    setCarga({ estado: 'lista', prefs: { ...antes, ...cambios } })
    try {
      const guardadas = await api.guardarPreferenciasNotificaciones(cambios)
      if (yo === ultima.current && guardadas?.push) setCarga({ estado: 'lista', prefs: guardadas })
    } catch (e) {
      if (yo === ultima.current) setCarga({ estado: 'lista', prefs: antes })
      avisarError(e)
    }
  }

  if (carga.estado === 'cargando')
    return (
      <p className="notif-config__cargando" role="status" aria-busy="true">
        <Girando tam={14} /> Cargando…
      </p>
    )
  if (carga.estado === 'error')
    return (
      <EstadoVacio
        icono={CloudOff}
        titulo={carga.sinRutas ? 'Las notificaciones todavía no están en este Telar' : 'No pude cargar las preferencias'}
        ayuda={carga.sinRutas ? 'Cuando se publique la versión nueva, las vas a poder elegir acá.' : 'Revisá la conexión y probá de nuevo.'}
        accion={
          carga.sinRutas ? undefined : (
            <button type="button" className="boton boton--chico" onClick={cargar}>
              Reintentar
            </button>
          )
        }
      />
    )

  const { prefs } = carga
  const silencio = prefs.silencio
  return (
    <>
      <Grupo titulo="Avisos" bajada="Todo aparece siempre en la campana. Acá elegís qué más te llega al celular o a la computadora (esos avisos llegan en una próxima versión; lo que elijas ya queda guardado).">
        {TIPOS.map((t) => (
          <Fila key={t.id} nombre={t.nombre} descripcion={t.descripcion}>
            <Interruptor valor={!!prefs.push?.[t.id]} etiqueta={t.nombre} alCambiar={(v) => guardar({ push: { ...prefs.push, [t.id]: v } })} />
          </Fila>
        ))}
      </Grupo>
      <Grupo titulo="No molestar">
        <Fila nombre="Horario de silencio" descripcion="En ese horario no te llega ningún aviso al aparato. La campana igual los junta. Es la hora de este aparato.">
          <Interruptor valor={!!silencio} etiqueta="Horario de silencio" alCambiar={(v) => guardar({ silencio: v ? SILENCIO_DE_FABRICA : null })} />
        </Fila>
        {silencio && (
          <Fila nombre="De y hasta" apilada>
            <span className="notif-config__horas">
              <label>
                <span>De</span>
                <input type="time" value={silencio.desde} onChange={(e) => e.target.value && guardar({ silencio: { ...silencio, desde: e.target.value } })} />
              </label>
              <label>
                <span>hasta</span>
                <input type="time" value={silencio.hasta} onChange={(e) => e.target.value && guardar({ silencio: { ...silencio, hasta: e.target.value } })} />
              </label>
            </span>
          </Fila>
        )}
      </Grupo>
    </>
  )
}
