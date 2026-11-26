// Diseño en el teléfono: la tercera vista del tablero, al lado de Kanban y Lienzo (entra desde la barra de abajo). En la
// PC es una herramienta de diseño de tres columnas; en 6 pulgadas no se diseña, se MIRA: recorrer las páginas, mirar los
// marcos con los dedos (desplazar, pellizcar, abrir uno a pantalla completa), leer el sistema de diseño, comentar y
// compartir la imagen de un marco. Lo único que se edita es lo que entra cómodo en un teléfono: los textos de los marcos
// propios. Lo demás lo dice con gracia ("eso se arma en la computadora").
//   · Arriba, la tira de páginas (como la de listas del Kanban). Debajo, la página: lienzo (marcos), documento (sistema)
//     o lista (textos). El marco abierto, las hojas y los gestos son los del resto de la app.
//   · La página vive en la dirección (/RC/tablero/diseno/celular); "atrás" vuelve a la anterior. Un enlace a un marco
//     (?sel=m_1, el que copia la PC) lo abre a pantalla completa.
//   · Usa la misma tienda que la PC (../estado.ts): lo que hace Claude por MCP aparece en vivo.
import { PanelsTopLeft, RefreshCw, WifiOff } from 'lucide-react'
import { useEffect } from 'react'
import { avisar, avisarError } from '../../../estado/avisos'
import { useRuta } from '../../../estado/ruta'
import { useConexion } from '../../../pwa/estado'
import { Girando } from '../../../ui/comunes'
import '../../../estilos/diseno.css'
import '../../../estilos/diseno-movil.css'
import { apiDiseno } from '../api'
import { useDiseno } from '../estado'
import { irADiseno } from '../ruta'
import { EstadoVacio } from '../ui'
import { useDisenoMovil } from './estado'
import { Hojas } from './Hojas'
import { LienzoMovil } from './LienzoMovil'
import { SistemaMovil } from './SistemaMovil'
import { TablaMovil } from './TablaMovil'
import { TiraPaginas } from './TiraPaginas'
import { Visor } from './Visor'

export default function DisenoMovil() {
  // La página y el marco salen de la ruta general (siempre al día con la dirección, también cuando se llega desde la barra
  // de abajo, que navega con irA y no avisa a la ruta propia de Diseño).
  const ruta = useRuta()
  // Al cambiar de proyecto, lo del anterior no se dibuja ni un cuadro (la tienda se vacía recién en el efecto).
  const otro = useDiseno((s) => !!s.prefijo && s.prefijo !== ruta.prefijo)
  const resumen = useDiseno((s) => (otro ? null : s.resumen))
  const error = useDiseno((s) => (otro ? null : s.error))
  const pagina = useDiseno((s) => (otro ? null : s.pagina))
  const marcos = useDiseno((s) => s.marcos)
  const cargandoPagina = useDiseno((s) => s.cargandoPagina)

  // El proyecto del tablero (si ya estaba abierto, lo que cambió mientras tanto).
  useEffect(() => {
    if (!ruta.prefijo) return
    const s = useDiseno.getState()
    if (s.prefijo === ruta.prefijo && s.resumen) {
      void s.recargarResumen()
      void s.recargarPagina()
    } else void s.abrirProyecto(ruta.prefijo)
  }, [ruta.prefijo])

  // Al salir de Diseño no queda nada abierto encima.
  useEffect(() => () => useDisenoMovil.setState({ visor: null, hoja: null, modo: 'ver', resaltada: null, borrador: null }), [])

  // En vivo: lo que hace Claude (u otra pestaña) llega por telar:diseno.
  useEffect(() => {
    const f = (e: Event) => useDiseno.getState().aplicarEvento((e as CustomEvent).detail)
    window.addEventListener('telar:diseno', f)
    return () => window.removeEventListener('telar:diseno', f)
  }, [])

  // La página de la dirección; sin página, la última que se miró en este proyecto (o la primera).
  useEffect(() => {
    // (al cambiar de proyecto, hasta que llega el resumen nuevo, el que hay es del anterior)
    if (!resumen || !ruta.prefijo || resumen.proyecto.prefijo !== ruta.prefijo) return
    const visibles = resumen.paginas.filter((p) => !p.archivada)
    const buscada = ruta.pagina ? visibles.find((p) => p.slug === ruta.pagina || p.id === ruta.pagina) : null
    if (!buscada) {
      const ultima = leerUltimaPagina(ruta.prefijo)
      const destino = (!ruta.pagina && visibles.find((p) => p.slug === ultima)) || visibles[0]
      if (destino) irADiseno({ pagina: destino.slug, sel: ruta.sel }, true)
      return
    }
    guardarUltimaPagina(ruta.prefijo, buscada.slug)
    if (useDiseno.getState().pagina?.id !== buscada.id) void useDiseno.getState().abrirPagina(buscada.slug)
  }, [resumen, ruta.prefijo, ruta.pagina])

  // Un enlace a un marco (?sel=m_1 o ?sel=m_1.capa): se abre a pantalla completa y se saca de la dirección (así "atrás"
  // cierra el marco y no lo vuelve a abrir). Un enlace a un ítem (?sel=item:token:…) abre su hoja.
  useEffect(() => {
    if (!ruta.sel || !pagina || cargandoPagina) return
    // (si la dirección ya pide otra página, se espera a que esa llegue)
    if (ruta.pagina && pagina.slug !== ruta.pagina && pagina.id !== ruta.pagina) return
    const sel = ruta.sel
    if (sel.startsWith('item:')) {
      irADiseno({ pagina: pagina.slug, sel: null }, true)
      useDisenoMovil.getState().abrirHoja({ tipo: 'item', clave: sel.slice(5) })
      return
    }
    const id = sel.split('.')[0]!
    if (!marcos.some((m) => m.id === id)) return
    irADiseno({ pagina: pagina.slug, sel: null }, true)
    useDisenoMovil.getState().abrirVisor(id)
  }, [ruta.sel, pagina, cargandoPagina, marcos])

  const paginas = resumen?.paginas.filter((p) => !p.archivada) ?? []
  const sinNada = !!resumen && paginas.length === 0
  return (
    <div className="diseno dzm">
      {paginas.length > 0 && <TiraPaginas />}
      <div className="dzm__escena">
        {!resumen && !error && (
          <div className="dzm-estado">
            <Girando tam={22} />
          </div>
        )}
        {error && (!resumen || (!pagina && !cargandoPagina)) && <ErrorDeDiseno mensaje={error} />}
        {sinNada && <ProyectoSinDiseno />}
        {resumen && pagina && pagina.tipo === 'lienzo' && <LienzoMovil key={pagina.id} />}
        {resumen && pagina && pagina.tipo === 'sistema' && <SistemaMovil key={pagina.id} />}
        {resumen && pagina && pagina.tipo === 'tabla' && <TablaMovil key={pagina.id} />}
        {resumen && !pagina && !sinNada && !error && (
          <div className="dzm-estado">
            <Girando tam={22} />
          </div>
        )}
      </div>
      <Visor />
      <Hojas />
    </div>
  )
}

/** La última página que se miró en cada proyecto: volver a Diseño es volver a donde se estaba. */
const CLAVE_PAGINA = 'telar.diseno.movil.pagina.'
function leerUltimaPagina(prefijo: string): string | null {
  try {
    return localStorage.getItem(CLAVE_PAGINA + prefijo)
  } catch {
    return null
  }
}
function guardarUltimaPagina(prefijo: string, slug: string) {
  try {
    localStorage.setItem(CLAVE_PAGINA + prefijo, slug)
  } catch {}
}

function ErrorDeDiseno({ mensaje }: { mensaje: string }) {
  const enLinea = useConexion()
  const prefijo = useRuta().prefijo
  return (
    <div className="dzm-estado">
      <EstadoVacio
        icono={enLinea ? <PanelsTopLeft size={28} /> : <WifiOff size={28} />}
        titulo={enLinea ? 'No pude abrir Diseño' : 'Sin conexión'}
        ayuda={enLinea ? mensaje : 'Diseño se ve cuando vuelva la señal: las pantallas y el sistema no quedan guardados en el teléfono.'}
      >
        <button
          type="button"
          className="boton boton--primario"
          onClick={() => {
            if (!prefijo) return
            useDiseno.setState({ prefijo: null, resumen: null, error: null })
            void useDiseno.getState().abrirProyecto(prefijo)
          }}
        >
          <RefreshCw size={16} /> Reintentar
        </button>
      </EstadoVacio>
    </div>
  )
}

function ProyectoSinDiseno() {
  const prefijo = useDiseno((s) => s.prefijo)
  const pedido = useDiseno((s) => s.resumen?.sincronizacion.pedidoEn)
  const tienePerfil = useDiseno((s) => s.resumen?.sincronizacion.tienePerfil)
  return (
    <div className="dzm-estado">
      <EstadoVacio
        icono={<PanelsTopLeft size={28} />}
        titulo="Todavía no hay diseño en este proyecto"
        ayuda="Pedile a Claude que importe el sistema de diseño del código, o armá la primera página en la computadora."
      >
        {tienePerfil && prefijo && (
          <button
            type="button"
            className="boton"
            disabled={!!pedido}
            onClick={() =>
              void apiDiseno
                .config(prefijo, { pedir: true })
                .then(() => {
                  avisar({ texto: 'Pedido: la próxima vez que Claude sincronice, trae el diseño del código.', tipo: 'ok' })
                  return useDiseno.getState().recargarResumen()
                })
                .catch(avisarError)
            }
          >
            {pedido ? 'Sincronización pedida' : 'Pedir sincronización'}
          </button>
        )}
      </EstadoVacio>
    </div>
  )
}
