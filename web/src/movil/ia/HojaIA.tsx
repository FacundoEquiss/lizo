// Configuración → IA en el teléfono (plan 14.7, tarea 2.3): el teléfono no tiene Configuración, así que la misma sección que ve la PC
// (`SeccionIA`) vive en una hoja de altura completa, que se abre desde «IA» del menú (⋮) o desde un aviso («Configurar», un tope, una
// clave que dejó de andar). Es el mismo camino que ya tomaron las preferencias de las notificaciones (HojaNotificaciones).
//   · Va un nivel por encima del resto de las hojas: se abre también desde la tarjeta (el «Configurar» de una mención que quedó
//     esperando) y tiene que quedar a la vista, no abajo.
//   · «Conectar IA» es otro diálogo: la hoja se cierra antes de abrirlo.
import { lazy, Suspense, useEffect } from 'react'
import { Girando } from '../../ui/comunes'
import { useMovil } from '../estado'
import { HojaInferior, NivelHoja } from '../ui/HojaInferior'

// La sección es grande: se baja recién cuando se abre la hoja (el teléfono no la necesita para arrancar).
const SeccionIA = lazy(() => import('../../vistas/configuracion/SeccionIA').then((m) => ({ default: m.SeccionIA })))

export function HojaIA() {
  const abierta = useMovil((s) => s.hoja === 'ia')
  const cerrar = useMovil((s) => s.cerrar)
  // Un aviso de cualquier lado («Configurar», un tope) pide abrirla con un evento: la tienda del teléfono no la importa el escritorio.
  useEffect(() => {
    const abrir = () => useMovil.getState().abrir('ia')
    window.addEventListener('telar:abrir-ia', abrir)
    return () => window.removeEventListener('telar:abrir-ia', abrir)
  }, [])
  return (
    <NivelHoja.Provider value={1}>
      <HojaInferior abierta={abierta} alCerrar={cerrar} titulo="IA" alto="completa" className="hoja-ia">
        <div className="hoja-ia__cuerpo">
          <Suspense
            fallback={
              <p className="notif-config__cargando" role="status" aria-busy="true">
                <Girando tam={14} /> Cargando…
              </p>
            }
          >
            <SeccionIA alIrAConectar={cerrar} />
          </Suspense>
        </div>
      </HojaInferior>
    </NivelHoja.Provider>
  )
}
