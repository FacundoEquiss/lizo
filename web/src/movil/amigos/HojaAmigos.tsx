// Configuración → Amigos en el teléfono: el teléfono no tiene Configuración, así que la misma sección que ve la PC (`SeccionAmigos`) vive
// en una hoja de altura completa que se abre desde «Amigos» del menú (⋮), y solo para la sesión del dueño. Mismo camino que la hoja «IA».
import { lazy, Suspense, useEffect } from 'react'
import { Girando } from '../../ui/comunes'
import { useMovil } from '../estado'
import { HojaInferior, NivelHoja } from '../ui/HojaInferior'

// Se baja recién cuando se abre la hoja (el teléfono no la necesita para arrancar).
const SeccionAmigos = lazy(() => import('../../vistas/configuracion/SeccionAmigos').then((m) => ({ default: m.SeccionAmigos })))

export function HojaAmigos() {
  const abierta = useMovil((s) => s.hoja === 'amigos')
  const cerrar = useMovil((s) => s.cerrar)
  // Una notificación («Pablo pidió una cuenta») la abre con un evento: la tienda del teléfono no la importa el escritorio.
  useEffect(() => {
    const abrir = () => useMovil.getState().abrir('amigos')
    window.addEventListener('telar:abrir-amigos', abrir)
    return () => window.removeEventListener('telar:abrir-amigos', abrir)
  }, [])
  return (
    <NivelHoja.Provider value={1}>
      <HojaInferior abierta={abierta} alCerrar={cerrar} titulo="Amigos" alto="completa" className="hoja-amigos">
        <div className="hoja-amigos__cuerpo">
          <Suspense
            fallback={
              <p className="notif-config__cargando" role="status" aria-busy="true">
                <Girando tam={14} /> Cargando…
              </p>
            }
          >
            {abierta && <SeccionAmigos />}
          </Suspense>
        </div>
      </HojaInferior>
    </NivelHoja.Provider>
  )
}
