// El contenido de las secciones de Configuración. Se baja aparte la primera vez que se abre el diálogo: las miniaturas
// usan piezas del lienzo (colores, puntas, formas, fuentes) que no hacen falta para arrancar la app.
import { lazy, Suspense } from 'react'
import { Girando } from '../../ui/comunes'
import type { IdSeccion } from '../Configuracion'
import { SeccionAcercaDe } from './SeccionAcercaDe'
import { SeccionApariencia } from './SeccionApariencia'
import { SeccionAtajos } from './SeccionAtajos'
import { SeccionCuenta } from './SeccionCuenta'
import { SeccionEstilos } from './SeccionEstilos'
import { SeccionLienzo } from './SeccionLienzo'
import { SeccionNotificaciones } from './SeccionNotificaciones'

export { SeccionAcercaDe, SeccionApariencia, SeccionAtajos, SeccionCuenta, SeccionEstilos, SeccionLienzo, SeccionNotificaciones }

// La más grande (agentes, claves, gasto, formularios): se baja recién cuando se abre «IA», no con el resto de Configuración.
const SeccionIA = lazy(() => import('./SeccionIA').then((m) => ({ default: m.SeccionIA })))
// Solo la ve el dueño: tampoco se baja para nadie más.
const SeccionAmigos = lazy(() => import('./SeccionAmigos').then((m) => ({ default: m.SeccionAmigos })))

export default function ContenidoConfiguracion({ seccion }: { seccion: IdSeccion }) {
  switch (seccion) {
    case 'cuenta':
      return <SeccionCuenta />
    case 'amigos':
      return (
        <Suspense
          fallback={
            <p className="notif-config__cargando" role="status" aria-busy="true">
              <Girando tam={14} /> Cargando…
            </p>
          }
        >
          <SeccionAmigos />
        </Suspense>
      )
    case 'ia':
      return (
        <Suspense
          fallback={
            <p className="notif-config__cargando" role="status" aria-busy="true">
              <Girando tam={14} /> Cargando…
            </p>
          }
        >
          <SeccionIA />
        </Suspense>
      )
    case 'notificaciones':
      return <SeccionNotificaciones />
    case 'apariencia':
      return <SeccionApariencia />
    case 'lienzo':
      return <SeccionLienzo />
    case 'estilos':
      return <SeccionEstilos />
    case 'atajos':
      return <SeccionAtajos />
    case 'acerca':
      return <SeccionAcercaDe />
  }
}
