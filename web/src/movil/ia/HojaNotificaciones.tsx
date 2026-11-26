// Las notificaciones en el teléfono (plan de la IA integrada, 8.4 y 14.5): la misma lista que la bandeja de escritorio, en una
// hoja que sube desde abajo. «Marcar todo como leído» fijo arriba y «Preferencias» fijo abajo. Tocar una notificación cierra la
// hoja, lleva al lugar y la marca como leída. El teléfono no tiene Configuración: «Preferencias» abre una segunda hoja, encima
// de esta, con las mismas preferencias que Configuración → Notificaciones. El nombre interno de la hoja es `notificaciones`
// (no `pendientes`: ese es la cola sin conexión).
import { useState } from 'react'
import { abrirNotificacion } from '../../estado/ia'
import { SeccionNotificaciones } from '../../vistas/configuracion/SeccionNotificaciones'
import { BotonMarcarTodo, BotonPreferencias, ListaNotificaciones } from '../../vistas/Notificaciones'
import { useMovil } from '../estado'
import { HojaInferior, useHoja } from '../ui/HojaInferior'

export function HojaNotificaciones() {
  const abierta = useMovil((s) => s.hoja === 'notificaciones')
  const cerrar = useMovil((s) => s.cerrar)
  const [preferencias, setPreferencias] = useState(false)
  return (
    <HojaInferior
      abierta={abierta}
      alCerrar={cerrar}
      titulo="Notificaciones"
      className="hoja-notificaciones"
      cabecera={
        <div className="hoja-notificaciones__acciones">
          <BotonMarcarTodo className="boton boton--fantasma" />
        </div>
      }
      pie={
        <div className="hoja-notificaciones__pie">
          <BotonPreferencias className="boton boton--fantasma" alTocar={() => setPreferencias(true)} />
        </div>
      }
    >
      <Lista />
      <HojaInferior abierta={preferencias} alCerrar={() => setPreferencias(false)} titulo="Preferencias de notificaciones" alto="completa" className="hoja-preferencias">
        <div className="hoja-preferencias__cuerpo">
          <SeccionNotificaciones />
        </div>
      </HojaInferior>
    </HojaInferior>
  )
}

function Lista() {
  const hoja = useHoja()
  return <ListaNotificaciones alAbrir={(n) => hoja?.cerrarYLuego(() => abrirNotificacion(n))} />
}
