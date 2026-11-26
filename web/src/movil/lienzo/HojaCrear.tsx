// "+" en el lienzo, versión mínima (plan del celular, 7.7): elige la herramienta de escritorio y el aviso de arriba dice
// "Tocá el lienzo para ubicarlo". El paquete H (con el contrato N8 del lienzo de escritorio) lo cambia por crear en el
// centro de la vista, sin estado intermedio.
import { ChartColumn, Frame, ImagePlus, Square, SquareKanban, StickyNote, Table2, Type } from 'lucide-react'
import { tieneVista } from '../../../../compartido/vistas'
import type { Herramienta } from '../../estado/tienda'
import { useTienda } from '../../estado/tienda'
import { useMovil } from '../estado'
import { FilaTactil } from '../ui/FilaTactil'
import { HojaInferior } from '../ui/HojaInferior'

const OPCIONES: { id: Herramienta; nombre: string; icono: typeof StickyNote }[] = [
  { id: 'nota', nombre: 'Nota', icono: StickyNote },
  { id: 'texto', nombre: 'Texto', icono: Type },
  { id: 'tarjeta', nombre: 'Tarjeta', icono: SquareKanban },
  { id: 'forma', nombre: 'Forma', icono: Square },
  { id: 'marco', nombre: 'Marco', icono: Frame },
]

export function HojaCrear() {
  const abierta = useMovil((s) => s.hoja === 'crear')
  // Un tablero sin Kanban (un diagrama) no ofrece tarjetas.
  const conKanban = useTienda((s) => tieneVista(s.tablero?.tablero, 'kanban'))
  const cerrar = useMovil((s) => s.cerrar)
  const elegir = (h: Herramienta) => {
    useTienda.getState().setHerramienta(h)
    cerrar()
  }
  return (
    <HojaInferior abierta={abierta} alCerrar={cerrar} titulo="Agregar al lienzo">
      <div className="hoja-crear">
        {OPCIONES.filter((o) => conKanban || o.id !== 'tarjeta').map((o) => (
          <FilaTactil key={o.id} icono={<o.icono size={20} />} texto={o.nombre} alto={48} onClick={() => elegir(o.id)} />
        ))}
        {/* Tabla y gráfico se crean de una, en el centro de lo que se ve (el lienzo escucha este evento). */}
        <FilaTactil
          icono={<Table2 size={20} />}
          texto="Tabla"
          bajada="Columnas con formato, como en Excel"
          alto={56}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('tablero:crear-objeto', { detail: 'tabla' }))
            cerrar()
          }}
        />
        <FilaTactil
          icono={<ChartColumn size={20} />}
          texto="Gráfico"
          bajada="De una tabla elegida, o con datos propios"
          alto={56}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('tablero:crear-objeto', { detail: 'grafico' }))
            cerrar()
          }}
        />
        <FilaTactil
          icono={<ImagePlus size={20} />}
          texto="Imagen"
          bajada="Cámara, fotos o archivos"
          alto={56}
          onClick={() => {
            // El selector del sistema tiene que abrirse dentro del mismo toque: primero el selector, después se cierra.
            document.querySelector<HTMLInputElement>('.lienzo input[type="file"]')?.click()
            cerrar()
          }}
        />
      </div>
    </HojaInferior>
  )
}
