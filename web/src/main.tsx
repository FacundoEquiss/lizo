import '@fontsource-variable/figtree'
import '@fontsource-variable/geist-mono'
import '@xyflow/react/dist/style.css'
import './estilos/tokens.css'
import './estilos/base.css'
import './estilos/app.css'
import './estilos/kanban.css'
import './estilos/tarjeta.css'
import './estilos/detalle.css'
import './estilos/lienzo.css'
import './estilos/tabla.css'
import './estilos/entrar.css'
import './estilos/movil.css'
import './estilos/pwa.css'
import './estilos/ia.css'
import './estilos/notificaciones.css'
import './estilos/vistas.css'
import { StrictMode, Suspense, lazy, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './estado/foto'
import { aplicarTema, useTienda } from './estado/tienda'
import { revisarSesion, useSesion } from './estado/sesion'
import { esInstalada, esMovil, useEsMovil } from './movil/detectar'
import { iniciarColorBarra } from './pwa/color-barra'
import { iniciarInstalar } from './pwa/instalar'
import { iniciarPwa } from './pwa/registro'
import { iniciarSinConexion } from './pwa/sinconexion/instantanea'
import { AvisoActualizar } from './pwa/ui/AvisoActualizar'
import { PantallaSinConexion } from './pwa/ui/PantallaSinConexion'
import { Entrar } from './vistas/Entrar'

// «Permitir» (OAuth de ChatGPT y Claude): una pantalla aparte, no la app. Va en su propio trozo.
const Autorizar = lazy(() => import('./vistas/Autorizar'))
const esAutorizar = location.pathname === '/autorizar'
// «Fulano te invitó a Telar»: el enlace que el dueño genera desde Configuración → Amigos. También es una pantalla aparte.
const Unirse = lazy(() => import('./vistas/Unirse'))
const esUnirse = location.pathname.startsWith('/unirse/')
// «Poné tu contraseña nueva»: el enlace que el dueño le genera a un amigo que olvidó la suya (Configuración → Amigos). Pantalla aparte.
const Restablecer = lazy(() => import('./vistas/Restablecer'))
const esRestablecer = location.pathname.startsWith('/restablecer/')

aplicarTema(useTienda.getState().tema)
// En el teléfono (o con la app instalada), si la última vez había sesión, se arranca ya: lo guardado se ve al instante y
// la revisión de la sesión lo confirma o lo corrige un momento después (plan del celular, 9.6 y 10.1).
if (esMovil() || esInstalada()) {
  try {
    const u = JSON.parse(localStorage.getItem('telar.sesion') ?? 'null') as { publico?: boolean; entrado?: boolean; eventos?: string } | null
    if (u?.entrado) useSesion.setState({ revisada: true, publico: !!u.publico, entrado: true, eventos: u.eventos === 'sondeo' ? 'sondeo' : 'sse' })
  } catch {}
}
iniciarColorBarra()
iniciarInstalar()
iniciarPwa()
iniciarSinConexion()

// La app de escritorio y la del celular van en trozos aparte: cada dispositivo baja solo la suya (plan del celular, N1).
// La que toca se empieza a bajar ya, mientras se revisa la sesión.
const cargarApp = () => import('./App').then((m) => ({ default: m.App }))
const cargarAppMovil = () => import('./movil/AppMovil')
const App = lazy(cargarApp)
const AppMovil = lazy(cargarAppMovil)
;(esAutorizar || esUnirse || esRestablecer ? Promise.resolve() : esMovil() ? cargarAppMovil() : cargarApp()).catch(() => {})

// Online hay que entrar con una cuenta (de Telar o la del juego) antes de ver el tablero (en la computadora, directo).
function Raiz() {
  const { revisada, publico, entrado } = useSesion()
  const movil = useEsMovil()
  useEffect(() => {
    revisarSesion()
  }, [])
  if (!revisada) return null
  if (esAutorizar && (!publico || entrado))
    return (
      <Suspense fallback={null}>
        <Autorizar />
      </Suspense>
    )
  // Sin cuentas (en la computadora) no hay a quién invitar: se abre la app de siempre.
  if (esUnirse && publico)
    return (
      <Suspense fallback={null}>
        <Unirse />
      </Suspense>
    )
  if (esRestablecer && publico)
    return (
      <Suspense fallback={null}>
        <Restablecer />
      </Suspense>
    )
  return (
    <>
      {publico && !entrado ? <Entrar /> : <Suspense fallback={null}>{movil ? <AppMovil /> : <App />}</Suspense>}
      <PantallaSinConexion />
      <AvisoActualizar />
    </>
  )
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <Raiz />
  </StrictMode>,
)
