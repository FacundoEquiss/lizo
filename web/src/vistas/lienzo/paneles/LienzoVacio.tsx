// El lienzo vacío (5.9): una tarjeta centrada que dice cómo empezar. Se va sola al crear el primer objeto.
import { MousePointerClick, PlugZap, SquareKanban } from 'lucide-react'
import { motion } from 'motion/react'
import { tieneVista } from '../../../../../compartido/vistas'
import { useTienda } from '../../../estado/tienda'
import { useLienzo } from '../estado'

export function LienzoVacio() {
  // Un diagrama (solo lienzo) no tiene tarjetas del Kanban para traer.
  const conKanban = useTienda((s) => tieneVista(s.tablero?.tablero, 'kanban'))
  return (
    <motion.div
      className="lienzo-vacio"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: [0.15, 1, 0.3, 1] }}
    >
      <b className="lienzo-vacio__titulo">Este lienzo está vacío</b>
      <ul className="lienzo-vacio__filas">
        <li>
          <span className="lienzo-vacio__icono">
            <MousePointerClick size={17} />
          </span>
          <span>Doble clic en cualquier lado para dejar una nota</span>
        </li>
        {conKanban && (
          <li>
            <span className="lienzo-vacio__icono">
              <SquareKanban size={17} />
            </span>
            <span>Traé tarjetas del Kanban para armar el mapa</span>
            <button type="button" className="boton boton--chico" onClick={() => useLienzo.getState().set({ panelTarjetas: true })}>
              Tarjetas del Kanban
            </button>
          </li>
        )}
        <li>
          <span className="lienzo-vacio__icono">
            <PlugZap size={17} />
          </span>
          <span>O pedile a tu IA que lo arme (Claude o ChatGPT, por MCP)</span>
          <button type="button" className="boton boton--chico" onClick={() => useTienda.getState().setDialogo('conectar')}>
            Conectar IA
          </button>
        </li>
      </ul>
    </motion.div>
  )
}
