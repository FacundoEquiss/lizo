// Raíz de Telar en el teléfono (plan del celular, 2 y 4.1). Reusa la tienda, el Kanban, la tarjeta y los diálogos de
// escritorio; cambia el marco: barra superior, escena, barra inferior y hojas. No registra atajos de teclado salvo Escape.
//   · Las barras son parte de la columna (no position: fixed): la escena mide exactamente lo que queda.
//   · Guarda la última ruta: una app instalada siempre abre en start_url y tiene que volver a donde se estaba.
//   · "Atrás" cierra lo que está encima: hojas, paneles, diálogos y la tarjeta (que vive en la dirección).
import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { tinykeys } from 'tinykeys'
import { tieneVista, vistaInicial } from '../../../compartido/vistas'
import { conectarEventos } from '../estado/eventos'
import { irA, rutaActual, useRuta, type Ruta } from '../estado/ruta'
import { useTienda } from '../estado/tienda'
import { Avisos } from '../ui/Avisos'
import { PresentacionMenciones } from '../ui/CampoConMenciones'
import { Girando } from '../ui/comunes'
import { PresentacionFlotante } from '../ui/Desplegable'
import { useConexion, usePwa } from '../pwa/estado'
import { reintentarInicio } from '../pwa/sinconexion/instantanea'
import type { InterfazLienzo } from '../vistas/lienzo/tipos'
import { SinProyectos } from '../vistas/SinProyectos'
import { useEsApaisado } from './detectar'
import { useMovil } from './estado'
import { useCierraConAtras } from './historial'
import { KanbanMovil } from './kanban/KanbanMovil'
import { prepararVistaLienzo } from './lienzo/vistaInicial'
import { iniciarTeclado } from './teclado'
import { BarraInferior } from './ui/BarraInferior'
import { BarraSuperiorMovil } from './ui/BarraSuperiorMovil'
import { BarraMenciones } from './ia/BarraMenciones'
import { FranjaSinConexion } from './ui/FranjaSinConexion'
import { HojaDesplegable } from './ui/HojaDesplegable'

const Lienzo = lazy(() => import('../vistas/lienzo/Lienzo'))
// Lo que el teléfono le suma al lienzo (buscar, el aviso de la herramienta, centrar, escribir con el teclado): se baja con
// él, nunca con el arranque.
const CapaLienzoMovil = lazy(() => import('./lienzo/CapaLienzoMovil'))
/** Las piezas de escritorio del lienzo que el teléfono cambia por las suyas (contrato InterfazLienzo). */
const INTERFAZ_LIENZO: InterfazLienzo = {
  // Buscar en el lienzo va en una hoja (CapaLienzoMovil).
  buscador: false,
  // La barra de lo elegido va abajo, en el lugar de la de herramientas, con Borrar y ⋯ siempre a la vista.
  barraContextualAbajo: true,
  // El aviso de la herramienta va en la franja de los botones de arriba (CapaLienzoMovil): el de escritorio tapaba el lienzo.
  aviso: false,
  // Los controles de escritorio (zoom, minimapa, configuración) no entraban: arriba a la derecha va Centrar.
  controles: false,
}
const DisenoMovil = lazy(() => import('../vistas/diseno/movil/DisenoMovil'))
// La tarjeta, las hojas y los diálogos se bajan aparte (10.1): ver Diferidas.tsx.
const cargarDiferidas = () => import('./Diferidas')
const Diferidas = lazy(cargarDiferidas)

const CLAVE_RUTA = 'telar.ultima-ruta'

interface Arranque {
  accion: string | null
  compartido: string
}

/**
 * Lo que llega en la dirección al abrir: ?desde=instalada (la app instalada abre siempre en start_url), ?accion= (accesos
 * directos del ícono) y lo compartido hacia Telar (?titulo=&texto=&link=). Se lee una vez y se saca de la dirección.
 */
function leerArranque(): Arranque {
  const qs = new URLSearchParams(location.search)
  const accion = qs.get('accion')
  const compartido = [qs.get('titulo'), qs.get('texto'), qs.get('link')]
    .map((x) => x?.trim())
    .filter((x, i, todos): x is string => !!x && todos.indexOf(x) === i)
    .join(' ')
  const extra = ['desde', 'accion', 'titulo', 'texto', 'link'].some((k) => qs.has(k))
  let destino: Partial<Ruta> | null = null
  if (location.pathname === '/' || location.pathname === '') {
    try {
      const guardada = localStorage.getItem(CLAVE_RUTA)
      const partes = guardada?.split('/').filter(Boolean).map(decodeURIComponent) ?? []
      if (partes.length >= 2)
        destino = {
          prefijo: partes[0]!,
          slug: partes[1]!,
          vista: partes[2] === 'lienzo' ? 'lienzo' : partes[2] === 'diseno' ? 'diseno' : 'kanban',
          pagina: partes[2] === 'diseno' ? (partes[3] ?? null) : null,
        }
    } catch {}
  }
  if (accion === 'lienzo') destino = { ...(destino ?? {}), vista: 'lienzo' }
  if (destino || extra) irA({ ...rutaActual(), ...(destino ?? {}) }, true)
  return { accion, compartido }
}

const conTarjetaAlArrancar = !!rutaActual().tarjeta
const arranque = leerArranque()

/**
 * Si un trozo aparte no se puede bajar (por ejemplo, se publicó una versión nueva con la app abierta). El lienzo lo dice
 * en su lugar; las piezas diferidas (sin lugar propio) ofrecen recargar con la pastilla de versión nueva.
 */
class ErrorDeCarga extends Component<{ children: ReactNode; que?: string }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() {
    return { error: true }
  }
  componentDidCatch() {
    if (!this.props.que) usePwa.setState({ actualizacion: 'recargar', actualizacionEscondida: false })
  }
  render() {
    if (!this.state.error) return this.props.children
    if (!this.props.que) return null
    return (
      <div className="escena__estado escena__estado--error">
        <p>No pude abrir {this.props.que}: puede haber una versión nueva de Telar.</p>
        <button type="button" className="boton boton--primario" onClick={() => location.reload()}>
          Recargar
        </button>
      </div>
    )
  }
}

function PrepararLienzo() {
  const tablero = useTienda((s) => s.tablero)!
  const ref = useRef<HTMLDivElement>(null)
  const [medido, setMedido] = useState(false)
  useLayoutEffect(() => {
    const r = ref.current?.parentElement?.getBoundingClientRect()
    if (r) prepararVistaLienzo(tablero, { ancho: r.width, alto: r.height })
    setMedido(true)
  }, [tablero.tablero.id])
  return (
    <>
      <div ref={ref} hidden />
      {medido && (
        <Lienzo
          interfaz={INTERFAZ_LIENZO}
          capa={
            <Suspense fallback={null}>
              <CapaLienzoMovil />
            </Suspense>
          }
        />
      )}
    </>
  )
}

export default function AppMovil() {
  const ruta = useRuta()
  const apaisado = useEsApaisado()
  const listo = useTienda((s) => s.listo)
  const proyectos = useTienda((s) => s.proyectos)
  const tablero = useTienda((s) => s.tablero)
  const cargando = useTienda((s) => s.cargandoTablero)
  const error = useTienda((s) => s.errorTablero)
  const panel = useTienda((s) => s.panel)
  const dialogo = useTienda((s) => s.dialogo)
  const enLinea = useConexion()
  const pendiente = useRef<Arranque | null>(arranque.accion || arranque.compartido ? arranque : null)
  const hoja = useMovil((s) => s.hoja)
  const claveAbierta = useTienda((s) => s.claveAbierta)
  const [diferidas, setDiferidas] = useState(conTarjetaAlArrancar || !!pendiente.current)
  const pedidas = diferidas || hoja !== null || claveAbierta !== null || panel !== null || dialogo !== null

  useEffect(() => {
    iniciarTeclado()
    // Sin red y sin nada guardado: PantallaSinConexion, que reintenta sola (nunca recarga en ciclo).
    reintentarInicio()
    conectarEventos()
  }, [])

  // Las piezas diferidas se montan en cuanto se pide una; si no, apenas se pinta el tablero, en un momento libre.
  useEffect(() => {
    if (pedidas) {
      if (!diferidas) setDiferidas(true)
      return
    }
    if (!tablero) return
    const libre = (fn: () => void) =>
      'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 6000 }) : (setTimeout(fn, 1500) as unknown as number)
    let id = 0
    const bajar = () => {
      // Nunca a mitad de un arrastre: interpretar y montar las piezas cuesta cuadros justo cuando más se notan.
      if (document.body.classList.contains('arrastrando')) {
        id = libre(bajar)
        return
      }
      cargarDiferidas()
        .then(() => setDiferidas(true))
        .catch(() => {})
    }
    id = libre(bajar)
    return () => ('cancelIdleCallback' in window ? cancelIdleCallback(id) : clearTimeout(id))
  }, [pedidas, diferidas, !!tablero])

  // Ruta → proyecto y tablero (como en escritorio).
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

  // La última ruta, para volver ahí al abrir la app.
  useEffect(() => {
    if (!ruta.prefijo || !ruta.slug || !tablero) return
    try {
      const vista = ruta.vista === 'kanban' ? '' : `/${ruta.vista}${ruta.vista === 'diseno' && ruta.pagina ? `/${encodeURIComponent(ruta.pagina)}` : ''}`
      localStorage.setItem(CLAVE_RUTA, `/${encodeURIComponent(ruta.prefijo)}/${encodeURIComponent(ruta.slug)}${vista}`)
    } catch {}
  }, [ruta.prefijo, ruta.slug, ruta.vista, ruta.pagina, tablero?.tablero.id])

  // Accesos directos y "compartir hacia Telar": cuando el tablero está listo.
  useEffect(() => {
    const p = pendiente.current
    if (!p || !tablero) return
    pendiente.current = null
    if (p.compartido) useMovil.getState().abrir('compositor', p.compartido)
    else if (p.accion === 'nueva') useMovil.getState().abrir('compositor')
    else if (p.accion === 'buscar') useMovil.getState().abrir('buscar')
  }, [tablero])

  // ?tarjeta=RC-12 → tarjeta abierta.
  useEffect(() => {
    const s = useTienda.getState()
    // (Si ya está abierta con otra forma de la clave, no se reabre; cerrada, sí: por ejemplo, al ir "adelante".)
    if (ruta.tarjeta && ruta.tarjeta !== s.claveAbierta && !(s.claveAbierta && s.detalle?.clave === ruta.tarjeta)) s.abrirTarjeta(ruta.tarjeta)
    if (!ruta.tarjeta && s.claveAbierta) s.cerrarTarjeta()
  }, [ruta.tarjeta])

  // Tarjeta abierta → dirección. Al cerrarla desde la interfaz se vuelve atrás lo que abrió (como cerrar una ventana):
  // así "atrás" no la vuelve a abrir y lo que estaba debajo (por ejemplo, el buscador) sigue ahí.
  useEffect(
    () =>
      useTienda.subscribe((s, antes) => {
        if (s.claveAbierta === antes.claveAbierta) return
        const clave = s.claveAbierta
        if (clave) {
          if (clave.endsWith('…')) return
          const habiaTarjeta = !!rutaActual().tarjeta
          const n = (history.state as { tarjetas?: number } | null)?.tarjetas ?? 0
          const antesUrl = location.href
          irA({ tarjeta: clave })
          if (location.href !== antesUrl) history.replaceState({ tarjetas: habiaTarjeta ? n + 1 : 1 }, '')
          return
        }
        const cerrada = antes.claveAbierta
        setTimeout(() => {
          if (!cerrada || rutaActual().tarjeta !== cerrada) return
          const n = (history.state as { tarjetas?: number } | null)?.tarjetas
          if (n) history.go(-n)
          else irA({ tarjeta: null }, true)
        }, 0)
      }),
    [],
  )

  // Los paneles y diálogos de escritorio (Actividad, Archivadas, Conectar IA, Nuevo proyecto) también cierran con "atrás".
  useCierraConAtras(panel !== null, () => useTienda.setState({ panel: null }))
  useCierraConAtras(dialogo !== null, () => useTienda.getState().setDialogo(null))

  useEffect(
    () =>
      tinykeys(window, {
        Escape: () => {
          const s = useTienda.getState()
          if (s.dialogo) s.setDialogo(null)
          else if (s.panel && !s.claveAbierta) useTienda.setState({ panel: null })
        },
      }),
    [],
  )

  return (
    <PresentacionFlotante.Provider value={HojaDesplegable}>
      <PresentacionMenciones.Provider value={BarraMenciones}>
      <div className={`app-movil app-movil--${ruta.vista}${apaisado ? ' app-movil--apaisado' : ''}`}>
        <BarraSuperiorMovil />
        <FranjaSinConexion />
        {/* El lugar de la tira está desde el principio (vacío mientras carga): así el tablero no salta 44 px al llegar. */}
        {!apaisado && ruta.vista === 'kanban' && <div className="ranura-tira" ref={(el) => useMovil.setState({ ranuraTira: el })} />}
        <main className="escena-movil">
          {!tablero && (cargando || !listo) && (
            <div className="escena__estado">
              <Girando tam={22} />
            </div>
          )}
          {/* Una cuenta nueva (o sin proyectos activos): la misma invitación a crear el primero que en la computadora. */}
          {listo && proyectos.length === 0 && !tablero && !cargando && <SinProyectos />}
          {error && !tablero && (
            <div className="escena__estado">
              {enLinea ? `No pude abrir el tablero: ${error}` : 'Este tablero no quedó guardado en el teléfono: se ve cuando vuelva la señal.'}
            </div>
          )}
          {tablero && (
            <div className="escena-movil__vista" key={`${tablero.tablero.id}-${ruta.vista}`}>
              {ruta.vista === 'lienzo' ? (
                <ErrorDeCarga que="el lienzo">
                  <Suspense
                    fallback={
                      <div className="escena__estado">
                        <Girando tam={22} />
                      </div>
                    }
                  >
                    <PrepararLienzo />
                  </Suspense>
                </ErrorDeCarga>
              ) : ruta.vista === 'diseno' ? (
                <ErrorDeCarga que="Diseño">
                  <Suspense
                    fallback={
                      <div className="escena__estado">
                        <Girando tam={22} />
                      </div>
                    }
                  >
                    <DisenoMovil />
                  </Suspense>
                </ErrorDeCarga>
              ) : (
                <KanbanMovil />
              )}
            </div>
          )}
        </main>
        <BarraInferior />
        {pedidas && (
          <ErrorDeCarga>
            <Suspense fallback={null}>
              <Diferidas tarjetaAlArrancar={conTarjetaAlArrancar} />
            </Suspense>
          </ErrorDeCarga>
        )}
        <Avisos />
      </div>
      </PresentacionMenciones.Provider>
    </PresentacionFlotante.Provider>
  )
}
