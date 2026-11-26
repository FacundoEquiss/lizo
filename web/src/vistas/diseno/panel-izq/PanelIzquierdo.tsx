// Panel izquierdo de Diseño (plan 6.2): cabecera con el proyecto y la sincronización, buscador, páginas y las pestañas
// Capas | Piezas.
import { X } from 'lucide-react'
import { useDiseno } from '../estado'
import { Buscador } from './Buscador'
import { Capas } from './Capas'
import { Paginas } from './Paginas'
import { PastillaSync } from './PastillaSync'
import { Piezas } from './Piezas'

export function PanelIzquierdo({ alCerrar }: { alCerrar?: () => void }) {
  const resumen = useDiseno((s) => s.resumen)
  const pestana = useDiseno((s) => s.pref.pestanaIzq)
  const pagina = useDiseno((s) => s.pagina)
  const proyecto = resumen?.proyecto
  return (
    <aside className="dz-izq" aria-label="Páginas y capas">
      <header className="dz-izq__cab">
        <span className="dz-sello" style={{ background: proyecto ? `var(--e-${proyecto.color}-s, var(--c-texto-3))` : 'var(--c-texto-3)' }} aria-hidden>
          {(proyecto?.prefijo ?? '··').slice(0, 2)}
        </span>
        <span className="dz-izq__titulo">Diseño</span>
        {resumen && <PastillaSync />}
        {alCerrar && (
          <button className="boton-icono boton-icono--chico" onClick={alCerrar} aria-label="Cerrar el panel">
            <X size={14} />
          </button>
        )}
      </header>
      <Buscador />
      <Paginas />
      <div className="dz-izq__pestanas" role="tablist" aria-label="Capas o piezas">
        <div className="segmentado segmentado--chico dz-izq__segmentado">
          {(
            [
              ['capas', 'Capas', 'Alt+1'],
              ['piezas', 'Piezas', 'Alt+2'],
            ] as const
          ).map(([id, nombre, tecla]) => (
            <button
              key={id}
              role="tab"
              aria-selected={pestana === id}
              aria-keyshortcuts={tecla}
              className={`segmentado__opcion${pestana === id ? ' segmentado__opcion--activa' : ''}`}
              onClick={() => useDiseno.getState().setPref({ pestanaIzq: id })}
            >
              {nombre}
            </button>
          ))}
        </div>
      </div>
      <div className="dz-izq__lista">{pestana === 'capas' ? pagina ? <Capas key={pagina.id} /> : null : <Piezas />}</div>
    </aside>
  )
}
