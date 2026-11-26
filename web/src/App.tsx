import { useEffect, lazy, Suspense } from 'react'
import { MotionConfig } from 'motion/react'
import { tinykeys } from 'tinykeys'
import { conectarEventos } from './estado/eventos'
import { deshacer, rehacer } from './estado/deshacer'
import { usePreferencias } from './estado/preferencias'
import { irA, rutaActual, useRuta } from './estado/ruta'
import { tieneVista, vistaInicial } from '../../compartido/vistas'
import { useTienda } from './estado/tienda'
import { escribiendo } from './util/teclas'
import { Avisos } from './ui/Avisos'
import { Girando } from './ui/comunes'
import { BarraLateral } from './vistas/BarraLateral'
import { BarraSuperior } from './vistas/BarraSuperior'
import { Kanban } from './vistas/kanban/Kanban'
import { Paleta } from './vistas/Paleta'
import { Atajos } from './vistas/Atajos'
import { ConectarIA } from './vistas/ConectarIA'
import { PanelActividad } from './vistas/PanelActividad'
import { DialogoProyecto } from './vistas/DialogoProyecto'
import { SinProyectos } from './vistas/SinProyectos'
import { PanelVistas } from './vistas/lateral/PanelVistas'
import { Configuracion } from './vistas/Configuracion'
import { alFallarInicio } from './pwa/sinconexion/instantanea'
import { guardarLateralEnDiseno, lateralEnDiseno } from './vistas/diseno/lateral'

// El panel «Vistas» abierto desde la paleta (la barra lateral lo abre desde su propio menú).
function VistasDelTablero() {
  const id = useTienda((s) => s.vistasDe)
  if (!id) return null
  return <PanelVistas tableroId={id} abierto alCerrar={() => useTienda.getState().abrirVistas(null)} />
}

const Lienzo = lazy(() => import('./vistas/lienzo/Lienzo'))
const Diseno = lazy(() => import('./vistas/diseno/Diseno'))
// La tarjeta abierta va en un trozo aparte (con markdown-it y DOMPurify, ~45 KB comprimidos): el Kanban se ve sin
// esperarla, y se baja en el primer momento libre, antes de que se toque una tarjeta.
const cargarDetalle = () => import('./vistas/tarjeta/DetalleTarjeta')
const DetalleTarjeta = lazy(() => cargarDetalle().then((m) => ({ default: m.DetalleTarjeta })))

// "Movimiento" de Configuración: como el sistema, reducido o completo (las animaciones de motion; el CSS lee
// data-movimiento en <html>).
export function App() {
  const movimiento = usePreferencias((s) => s.movimiento)
  return (
    <MotionConfig reducedMotion={movimiento === 'reducido' ? 'always' : movimiento === 'completo' ? 'never' : 'user'}>
      <Interfaz />
    </MotionConfig>
  )
}

function Interfaz() {
  const ruta = useRuta()
  const listo = useTienda((s) => s.listo)
  const proyectos = useTienda((s) => s.proyectos)
  const tablero = useTienda((s) => s.tablero)
  const cargando = useTienda((s) => s.cargandoTablero)
  const error = useTienda((s) => s.errorTablero)
  const lateralAbierto = useTienda((s) => s.lateralAbierto)

  useEffect(() => {
    useTienda
      .getState()
      .cargarInicio()
      .catch(alFallarInicio)
    conectarEventos()
    const precargar = () => void cargarDetalle()
    if ('requestIdleCallback' in window) requestIdleCallback(precargar, { timeout: 3000 })
    else setTimeout(precargar, 1500)
  }, [])

  // Ruta → proyecto y tablero.
  useEffect(() => {
    if (!listo || proyectos.length === 0) return
    const proyecto = proyectos.find((p) => p.prefijo === ruta.prefijo) ?? (ruta.prefijo ? null : proyectos[0])
    if (!proyecto) {
      irA({ prefijo: proyectos[0]!.prefijo, slug: null, tarjeta: ruta.tarjeta }, true)
      return
    }
    const t = proyecto.tableros.find((x) => x.slug === ruta.slug) ?? proyecto.tableros[0]
    if (!t) return
    if (ruta.prefijo !== proyecto.prefijo || ruta.slug !== t.slug) {
      irA({ prefijo: proyecto.prefijo, slug: t.slug }, true)
      return
    }
    // La vista de la dirección no está en este tablero (un diagrama no tiene Kanban): entra por la primera que tiene.
    if (!tieneVista(t, ruta.vista)) {
      irA({ vista: vistaInicial(t.vistas) }, true)
      return
    }
    if (useTienda.getState().tablero?.tablero.id !== t.id) useTienda.getState().abrirTablero(t.id)
  }, [listo, proyectos, ruta.prefijo, ruta.slug, ruta.tarjeta, ruta.vista])

  // ?tarjeta=RC-12 ↔ tarjeta abierta
  useEffect(() => {
    const s = useTienda.getState()
    // (Cerrada, vuelve a abrirse aunque `detalle` todavía guarde esa misma tarjeta: lo que llega de una notificación o de «adelante».)
    if (ruta.tarjeta && ruta.tarjeta !== s.claveAbierta && !(s.claveAbierta && s.detalle?.clave === ruta.tarjeta)) s.abrirTarjeta(ruta.tarjeta)
    if (!ruta.tarjeta && s.claveAbierta) s.cerrarTarjeta()
  }, [ruta.tarjeta])
  useEffect(
    () =>
      useTienda.subscribe((s, antes) => {
        if (s.claveAbierta !== antes.claveAbierta) {
          const clave = s.claveAbierta ?? null
          if (clave && clave.endsWith('…')) return
          irA({ tarjeta: clave })
        }
      }),
    [],
  )

  // Diseño pliega la lateral (plan-diseno 6.1): adentro manda su preferencia; al salir, la lateral vuelve como estaba.
  useEffect(() => {
    if (ruta.vista !== 'diseno') return
    const antes = useTienda.getState().lateralAbierto
    const guardada = localStorage.getItem('tablero.lateral')
    useTienda.setState({ lateralAbierto: lateralEnDiseno() })
    const quitar = useTienda.subscribe((s, a) => s.lateralAbierto !== a.lateralAbierto && guardarLateralEnDiseno(s.lateralAbierto))
    return () => {
      quitar()
      if (guardada === null) localStorage.removeItem('tablero.lateral')
      else localStorage.setItem('tablero.lateral', guardada)
      useTienda.setState({ lateralAbierto: antes })
    }
  }, [ruta.vista])

  // Atajos globales.
  useEffect(() => {
    const quitar = tinykeys(
      window,
      {
        Escape: () => {
          const s = useTienda.getState()
          if (s.dialogo && s.dialogo !== 'paleta') s.setDialogo(null)
          else if (s.panel && !s.claveAbierta) s.setPanel(s.panel)
        },
        '$mod+KeyK': (e) => {
          e.preventDefault()
          const s = useTienda.getState()
          s.setDialogo(s.dialogo === 'paleta' ? null : 'paleta')
        },
        '$mod+Comma': (e) => {
          e.preventDefault()
          const s = useTienda.getState()
          if (s.dialogo === 'configuracion') s.setDialogo(null)
          else s.abrirConfiguracion()
        },
        'Shift+?': (e) => {
          if (escribiendo(e)) return
          e.preventDefault()
          useTienda.getState().setDialogo('atajos')
        },
        '$mod+KeyZ': (e) => {
          if (escribiendo(e)) return
          e.preventDefault()
          deshacer()
        },
        '$mod+Shift+KeyZ': (e) => {
          if (escribiendo(e)) return
          e.preventDefault()
          rehacer()
        },
        '$mod+KeyY': (e) => {
          if (escribiendo(e)) return
          e.preventDefault()
          rehacer()
        },
        BracketLeft: (e) => {
          if (escribiendo(e)) return
          useTienda.getState().alternarLateral()
        },
        // En el lienzo la G es la grilla (como en Miro): ahí las vistas se cambian con las pestañas o Ctrl+K.
        'g k': (e) => {
          if (escribiendo(e) || rutaActual().vista === 'lienzo' || !tieneVista(useTienda.getState().tablero?.tablero, 'kanban')) return
          irA({ vista: 'kanban' })
        },
        'g l': (e) => {
          if (escribiendo(e) || rutaActual().vista === 'lienzo' || !tieneVista(useTienda.getState().tablero?.tablero, 'lienzo')) return
          irA({ vista: 'lienzo' })
        },
        'g d': (e) => {
          if (escribiendo(e) || rutaActual().vista === 'lienzo' || !tieneVista(useTienda.getState().tablero?.tablero, 'diseno')) return
          irA({ vista: 'diseno' })
        },
        'g a': (e) => {
          if (escribiendo(e) || rutaActual().vista === 'lienzo') return
          useTienda.getState().setPanel('actividad')
        },
      },
      { ignore: () => false },
    )
    return quitar
  }, [])

  return (
    <div className={`app${lateralAbierto ? '' : ' app--sin-lateral'}`}>
      <BarraLateral />
      <main className="principal">
        <BarraSuperior />
        <div className="escena">
          {!tablero && (cargando || !listo) && (
            <div className="escena__estado">
              <Girando tam={22} />
            </div>
          )}
          {error && !tablero && <div className="escena__estado">No pude abrir el tablero: {error}</div>}
          {listo && proyectos.length === 0 && !tablero && <SinProyectos />}
          {tablero &&
            (ruta.vista === 'lienzo' || ruta.vista === 'diseno' ? (
              <Suspense
                fallback={
                  <div className="escena__estado">
                    <Girando tam={22} />
                  </div>
                }
              >
                {ruta.vista === 'lienzo' ? <Lienzo /> : <Diseno />}
              </Suspense>
            ) : (
              <Kanban />
            ))}
        </div>
      </main>
      <PanelActividad />
      <Suspense fallback={null}>
        <DetalleTarjeta />
      </Suspense>
      <Paleta />
      <Atajos />
      <ConectarIA />
      <DialogoProyecto />
      <VistasDelTablero />
      <Configuracion />
      <Avisos />
    </div>
  )
}
