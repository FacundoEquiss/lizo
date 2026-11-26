import { useReactFlow, useViewportStore } from '@xyflow/react'
import { Grid3x3, Map as IconoMapa, Maximize, Minus, Plus, Settings2 } from 'lucide-react'
import { memo } from 'react'
import { useTienda } from '../../../estado/tienda'
import { Kbd } from '../../../ui/comunes'
import { Desplegable } from '../../../ui/Desplegable'
import { precargarConfiguracion } from '../../Configuracion'
import { duracion } from '../../../util/movimiento'
import { useAccionesLienzo } from '../acciones'

/** Zoom, ver todo, minimapa, grilla y ajustes. Con memo: no depende de nada del lienzo que se vuelve a dibujar. */
export const Controles = memo(function Controles() {
  const rf = useReactFlow()
  const acciones = useAccionesLienzo()
  // El control de zoom es lo único del lienzo que se suscribe al zoom (el resto usa --z). Solo al porcentaje: con
  // useViewport se volvía a dibujar (con su desplegable) en cada cuadro de un paneo, aunque el zoom no cambiara.
  const porciento = useViewportStore((s) => Math.round(s.transform[2] * 100))
  const minimapa = useTienda((s) => s.minimapa)
  const grilla = useTienda((s) => s.grilla)
  return (
    <div className="controles">
      <button className="control" onClick={() => rf.zoomOut({ duration: duracion(200) })} data-tip="Alejar" data-tecla="$mod+-" aria-label="Alejar">
        <Minus size={16} />
      </button>
      <Desplegable
        lado="bottom-end"
        className="menu"
        disparador={(p) => (
          <button {...p} className="control control--zoom" aria-label="Zoom">
            {porciento}%
          </button>
        )}
      >
        {(cerrar) => (
          <div className="menu__lista">
            {(
              [
                ['Ver todo', 'Shift+1', () => acciones.verTodo()],
                ['Zoom a la selección', 'Shift+2', () => acciones.zoomSeleccion()],
                ['100 %', '$mod+0', () => rf.zoomTo(1, { duration: duracion(260) })],
                ['50 %', '', () => rf.zoomTo(0.5, { duration: duracion(260) })],
                ['200 %', '', () => rf.zoomTo(2, { duration: duracion(260) })],
              ] as const
            ).map(([t, k, f]) => (
              <button
                key={t}
                className="menu__item"
                onClick={() => {
                  cerrar()
                  f()
                }}
              >
                <span className="menu__texto">{t}</span>
                {k && <Kbd atajo={k} suave />}
              </button>
            ))}
          </div>
        )}
      </Desplegable>
      <button className="control" onClick={() => rf.zoomIn({ duration: duracion(200) })} data-tip="Acercar" data-tecla="$mod+=" aria-label="Acercar">
        <Plus size={16} />
      </button>
      <span className="controles__sep" />
      <button className="control" onClick={() => acciones.verTodo()} data-tip="Ver todo" data-tecla="Shift+1" aria-label="Ver todo">
        <Maximize size={15} />
      </button>
      <button className={`control${minimapa ? ' control--activo' : ''}`} onClick={() => useTienda.getState().alternarMinimapa()} data-tip="Minimapa" data-tecla="M" aria-label="Minimapa">
        <IconoMapa size={15} />
      </button>
      <button className={`control${grilla ? ' control--activo' : ''}`} onClick={() => useTienda.getState().alternarGrilla()} data-tip="Grilla" data-tecla="G" aria-label="Grilla">
        <Grid3x3 size={15} />
      </button>
      <button
        className="control"
        onClick={() => useTienda.getState().abrirConfiguracion('lienzo')}
        onPointerEnter={precargarConfiguracion}
        data-tip="Configuración del lienzo"
        data-tecla="$mod+,"
        aria-label="Configuración del lienzo"
      >
        <Settings2 size={15} />
      </button>
    </div>
  )
})
