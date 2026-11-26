// La escena cuando no queda ningún proyecto activo (7.4): la invitación a crear uno. Los archivados siguen abajo a la
// izquierda, en la barra lateral.
import { Plus } from 'lucide-react'
import { useTienda } from '../estado/tienda'
import { MarcaTelar } from '../ui/marcas'

export function SinProyectos() {
  return (
    <div className="escena__estado">
      <div className="estado-vacio sin-proyectos">
        <MarcaTelar size={44} />
        <b>Creá tu primer proyecto</b>
        <span>Un proyecto junta tus tableros: el Kanban y el lienzo de cada uno. Lo archivado queda abajo, en la barra lateral.</span>
        <button type="button" className="boton boton--primario" onClick={() => useTienda.getState().setDialogo('nuevo-proyecto')}>
          <Plus size={16} /> Nuevo proyecto
        </button>
      </div>
    </div>
  )
}
