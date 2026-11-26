// Centrar el lienzo en el teléfono: un toque encuadra todo lo que hay, con aire alrededor, sin pellizcar para buscarlo.
// Va arriba a la derecha, en la misma fila y con la misma forma que los botones de la izquierda (Tarjetas, Marcos,
// Buscar). Reemplaza a los controles de escritorio, que en el teléfono solo dejaban un botón de configuración sin hoja.
import { Panel } from '@xyflow/react'
import { Focus } from 'lucide-react'
import { useTienda } from '../../estado/tienda'
import { useAccionesLienzo } from '../../vistas/lienzo/acciones'
import { vibrar } from '../haptica'

export function BotonCentrar() {
  const acciones = useAccionesLienzo()
  const vacio = useTienda((s) => !s.tablero?.elementos.length)
  return (
    <Panel position="top-right" className="panel-lienzo panel-lienzo--centrar">
      <button
        type="button"
        className="boton-flotante"
        disabled={vacio}
        onClick={() => {
          vibrar('toque')
          acciones.verTodo()
        }}
        aria-label="Centrar: ver todo lo que hay en el lienzo"
      >
        <Focus size={20} strokeWidth={2} aria-hidden />
      </button>
    </Panel>
  )
}
