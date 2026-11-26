// Barra inferior (plan del celular, 4.1): lo de todos los días a un toque y bajo el pulgar. Lugares de igual ancho:
// Kanban y Lienzo, Agregar en el medio (el botón principal), Diseño y Buscar. Muestra solo las vistas que tiene el tablero abierto
// (compartido/vistas.ts: un diagrama solo trae el Lienzo) y Agregar solo si hay a dónde agregar (tarjetas o el lienzo). El fondo del lugar activo se desliza con el
// mismo resorte de las pestañas de escritorio (que el teléfono se sienta la misma app). En horizontal es un riel a la
// izquierda, solo con íconos.
// Lo que antes era "Más" (actividad, archivadas, conectar IA, tema, instalar…) está en el menú de la cabecera (⋮): se usa
// poco, y en la barra de abajo no se entendía para qué era.
// Volver a tocar el lugar activo: en el Kanban va a la primera lista y arriba; en el lienzo ajusta la vista; en Diseño, la
// página vuelve a su principio.
import { Frame, PenTool, Plus, Search, SquareKanban, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { tieneVista, type VistaTablero } from '../../../../compartido/vistas'
import { irA, useRuta } from '../../estado/ruta'
import { useTienda } from '../../estado/tienda'
import { useEsApaisado } from '../detectar'
import { useMovil } from '../estado'

/** Pide al Kanban del celular que vuelva a la primera lista (lo escucha KanbanMovil). */
export const EVENTO_KANBAN_INICIO = 'telar:kanban-inicio'
/** Volver a tocar Diseño: la página vuelve a verse entera (lo escucha la vista de Diseño del celular). */
export const EVENTO_DISENO_INICIO = 'telar:diseno-inicio'

/** Ajusta la vista del lienzo con su atajo (Shift+1), hasta que el lienzo exponga sus acciones (N8). */
function ajustarLienzo() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '!', code: 'Digit1', shiftKey: true, bubbles: true }))
}

function Lugar({
  icono: Icono,
  texto,
  activo,
  onClick,
  apaisado,
}: {
  icono: LucideIcon
  texto: string
  activo?: boolean
  onClick: () => void
  apaisado: boolean
}) {
  return (
    <button
      type="button"
      className={`barra-inferior__lugar${activo ? ' barra-inferior__lugar--activo' : ''}`}
      onClick={onClick}
      aria-current={activo ? 'page' : undefined}
      aria-label={apaisado ? texto : undefined}
    >
      <span className="barra-inferior__icono">
        {activo && (
          <motion.span layoutId="lugar-activo" className="barra-inferior__fondo" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />
        )}
        <Icono size={24} strokeWidth={2} aria-hidden />
      </span>
      {!apaisado && <span className="barra-inferior__texto">{texto}</span>}
    </button>
  )
}

const LUGARES: Record<VistaTablero, { icono: LucideIcon; texto: string }> = {
  kanban: { icono: SquareKanban, texto: 'Kanban' },
  lienzo: { icono: Frame, texto: 'Lienzo' },
  diseno: { icono: PenTool, texto: 'Diseño' },
}

export function BarraInferior() {
  const ruta = useRuta()
  const apaisado = useEsApaisado()
  const abrir = useMovil((s) => s.abrir)
  const tableroResumen = useTienda((s) => s.tablero?.tablero)
  const vistas = (['kanban', 'lienzo', 'diseno'] as const).filter((v) => tieneVista(tableroResumen, v))
  // Agregar: una tarjeta (Kanban) o algo al lienzo. En un tablero solo de Diseño no hay a dónde agregar.
  const puedeAgregar = ruta.vista === 'lienzo' ? tieneVista(tableroResumen, 'lienzo') : tieneVista(tableroResumen, 'kanban')
  // El botón de agregar va en el medio: después de las dos primeras vistas si hay tres, y después de la primera si hay menos.
  const aDespuesDe = vistas.length >= 3 ? 2 : 1

  const vista = (v: VistaTablero) => {
    if (ruta.vista !== v) return irA({ vista: v, tarjeta: null })
    if (v === 'kanban') window.dispatchEvent(new CustomEvent(EVENTO_KANBAN_INICIO))
    else if (v === 'diseno') window.dispatchEvent(new CustomEvent(EVENTO_DISENO_INICIO))
    else ajustarLienzo()
  }

  const agregar = (
    <div key="agregar" className="barra-inferior__lugar barra-inferior__lugar--agregar">
      <button
        type="button"
        className="barra-inferior__agregar"
        onClick={() => abrir(ruta.vista === 'lienzo' ? 'crear' : 'compositor')}
        aria-label={ruta.vista === 'lienzo' ? 'Agregar al lienzo' : 'Agregar tarjeta'}
      >
        <Plus size={26} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  )
  const lugares = vistas.flatMap((v, i) => {
    const l = LUGARES[v]
    const lugar = <Lugar key={v} icono={l.icono} texto={l.texto} activo={ruta.vista === v} onClick={() => vista(v)} apaisado={apaisado} />
    return puedeAgregar && i === aDespuesDe - 1 ? [lugar, agregar] : [lugar]
  })

  return (
    <nav className="barra-inferior" aria-label="Navegación principal" style={{ ['--n-lugares' as string]: lugares.length + 1 }}>
      {lugares}
      <Lugar icono={Search} texto="Buscar" onClick={() => abrir('buscar')} apaisado={apaisado} />
    </nav>
  )
}
