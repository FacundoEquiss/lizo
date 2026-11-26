// Las tarjetas por subir (plan del celular, 9.6): se abre tocando una tarjeta de la bandeja en su lista o "N por subir" en
// la franja. Las que fallaron dicen por qué y tienen Reintentar y Descartar: el texto nunca se pierde. El frente de la
// tarjeta en la lista es el mismo de escritorio, por eso las acciones viven acá y no en la tarjeta.
import { CloudOff, CloudUpload, TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { useConexion } from '../../pwa/estado'
import { descartar, reintentar, subirPendientes, useBandeja, type Pendiente } from '../../pwa/sinconexion/bandeja'
import { useTienda } from '../../estado/tienda'
import { Girando } from '../../ui/comunes'
import { useMovil } from '../estado'
import { HojaInferior } from '../ui/HojaInferior'
import { haceCuanto } from '../ui/FranjaSinConexion'

function Fila({ p, otroTablero, subiendo, enLinea }: { p: Pendiente; otroTablero: string | null; subiendo: boolean; enLinea: boolean }) {
  const fallida = p.estado === 'fallida'
  return (
    <li className={`pendiente${fallida ? ' pendiente--fallida' : ''}`}>
      <span className="pendiente__icono" aria-hidden>
        {subiendo ? <Girando tam={16} /> : fallida ? <TriangleAlert size={18} /> : enLinea ? <CloudUpload size={18} /> : <CloudOff size={18} />}
      </span>
      <div className="pendiente__cuerpo">
        <div className="pendiente__titulo">{p.titulo}</div>
        <div className="pendiente__detalle">
          {p.listaNombre ? `En «${p.listaNombre}»` : 'Sin lista'}
          {otroTablero ? ` · ${otroTablero}` : ''} · anotada {haceCuanto(p.creada)}
        </div>
        {fallida && <p className="pendiente__error">No se pudo subir: {p.error}</p>}
        <div className="pendiente__acciones">
          {fallida && (
            <button type="button" className="boton boton--chico" onClick={() => reintentar(p.id)}>
              Reintentar
            </button>
          )}
          <button type="button" className="boton boton--fantasma boton--chico" onClick={() => descartar(p.id)} disabled={subiendo}>
            Descartar
          </button>
        </div>
      </div>
    </li>
  )
}

export function HojaPendientes() {
  const abierta = useMovil((s) => s.hoja === 'pendientes')
  const cerrar = useMovil((s) => s.cerrar)
  const pendientes = useBandeja((s) => s.pendientes)
  const subiendo = useBandeja((s) => s.subiendo)
  const enLinea = useConexion()
  const tableroId = useTienda((s) => s.tablero?.tablero.id)
  const proyectos = useTienda((s) => s.proyectos)
  const nombreTablero = (id: string) => {
    for (const p of proyectos) for (const t of p.tableros) if (t.id === id) return `${p.nombre} › ${t.nombre}`
    return 'otro tablero'
  }
  const porSubir = pendientes.filter((p) => p.estado === 'pendiente').length

  // Cuando ya no queda nada (se subió todo o se descartó), la hoja se cierra sola.
  useEffect(() => {
    if (abierta && pendientes.length === 0) {
      const t = setTimeout(cerrar, 900)
      return () => clearTimeout(t)
    }
  }, [abierta, pendientes.length, cerrar])

  return (
    <HojaInferior
      abierta={abierta}
      alCerrar={cerrar}
      titulo="Por subir"
      className="hoja-pendientes"
      pie={
        enLinea && porSubir > 0 ? (
          <button type="button" className="boton boton--primario boton--ancho" onClick={() => subirPendientes()} disabled={!!subiendo}>
            {subiendo ? <Girando /> : porSubir === 1 ? 'Subir ahora' : `Subir las ${porSubir} ahora`}
          </button>
        ) : undefined
      }
    >
      <div className="hoja-pendientes__cuerpo">
        <p className="hoja-pendientes__intro">
          {pendientes.length === 0
            ? 'No queda nada por subir.'
            : enLinea
              ? 'Las anotaste sin conexión. Se suben en el orden en que las escribiste.'
              : 'Las anotaste sin conexión: se suben solas cuando vuelva la señal, en el orden en que las escribiste.'}
        </p>
        <ul className="hoja-pendientes__lista">
          {pendientes.map((p) => (
            <Fila key={p.id} p={p} otroTablero={p.tableroId !== tableroId ? nombreTablero(p.tableroId) : null} subiendo={subiendo === p.id} enLinea={enLinea} />
          ))}
        </ul>
      </div>
    </HojaInferior>
  )
}
