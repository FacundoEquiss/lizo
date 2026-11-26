// Buscar en el lienzo, en el teléfono: la lupa de arriba del lienzo abre esta hoja (como Buscar, pero de lo que hay en el
// lienzo). En escritorio es un panel flotante arriba al centro; en el teléfono, con el teclado abierto, un panel así
// dejaba los resultados en una franja de 100 px y sin "atrás". Tocar un resultado cierra la hoja, lleva la vista hasta
// ese objeto y lo elige.
import { Frame, ImageIcon, Link2, List, PenTool, Search, Shapes, SquareKanban, StickyNote, Type, X, Table2, ChartColumn } from 'lucide-react'
import { useRef, useState, type RefObject } from 'react'
import { NOMBRES_TIPO } from '../../../../compartido/lienzo'
import type { ElementoLienzo, TipoElemento } from '../../../../compartido/tipos'
import { useTienda } from '../../estado/tienda'
import { useAccionesLienzo } from '../../vistas/lienzo/acciones'
import { useLienzo } from '../../vistas/lienzo/estado'
import { FILTROS_BUSQUEDA, useBusquedaLienzo, type FiltroBusqueda } from '../../vistas/lienzo/paneles/Buscador'
import { HojaInferior, useHoja } from '../ui/HojaInferior'

const ICONOS: Record<TipoElemento, typeof Type> = {
  nota: StickyNote,
  texto: Type,
  forma: Shapes,
  marco: Frame,
  tarjeta: SquareKanban,
  lista: List,
  imagen: ImageIcon,
  enlace: Link2,
  figma: PenTool,
  tabla: Table2,
  grafico: ChartColumn,
}

export function BuscarLienzo() {
  const abierta = useLienzo((s) => s.buscando)
  const ref = useRef<HTMLInputElement>(null)
  return (
    <HojaInferior
      abierta={abierta}
      alCerrar={() => useLienzo.getState().set({ buscando: false })}
      etiqueta="Buscar en el lienzo"
      alto="completa"
      enfocar={ref}
      className="buscar-movil buscar-lienzo"
    >
      <Contenido refCampo={ref} />
    </HojaInferior>
  )
}

function Contenido({ refCampo }: { refCampo: RefObject<HTMLInputElement | null> }) {
  const hoja = useHoja()
  const acciones = useAccionesLienzo()
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<FiltroBusqueda>('todo')
  const { resultados, hayTexto, texto } = useBusquedaLienzo(q, filtro, 40)

  const ir = (e: ElementoLienzo) =>
    hoja?.cerrarYLuego(() => {
      acciones.irA([e.id])
      acciones.seleccionar([e.id])
      useTienda.getState().destellar(e.tarjetaId ?? e.id)
    })

  return (
    <div className="buscar-movil__marco">
      <div className="buscar-movil__fijo">
        <div className="buscar-movil__fila">
          <label className="buscar-movil__campo">
            <Search size={18} aria-hidden />
            <input
              ref={refCampo}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar en el lienzo"
              aria-label="Buscar en el lienzo"
              enterKeyHint="search"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                if (resultados[0]) ir(resultados[0])
                else e.currentTarget.blur()
              }}
            />
            {q && (
              <button type="button" className="buscar-movil__borrar" onClick={() => setQ('')} aria-label="Borrar lo escrito">
                <X size={16} />
              </button>
            )}
          </label>
          <button type="button" className="buscar-movil__cancelar" onClick={() => hoja?.cerrar()}>
            Cancelar
          </button>
        </div>
        <div className="segmentado buscar-lienzo__filtros" role="radiogroup" aria-label="Qué buscar">
          {FILTROS_BUSQUEDA.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filtro === f.id}
              aria-label={f.nombre}
              className={`segmentado__opcion${filtro === f.id ? ' segmentado__opcion--activa' : ''}`}
              onClick={() => setFiltro(f.id)}
            >
              {f.corto}
            </button>
          ))}
        </div>
      </div>

      <div
        className="buscar-movil__lista"
        onTouchMove={() => {
          if (document.activeElement === refCampo.current) refCampo.current?.blur()
        }}
      >
        {!hayTexto ? (
          <p className="buscar-movil__vacio">Escribí para buscar en las notas, los textos, las tarjetas y los marcos de este lienzo.</p>
        ) : resultados.length === 0 ? (
          <p className="buscar-movil__vacio">Nada con ese texto en este lienzo.</p>
        ) : (
          resultados.map((e) => {
            const Icono = ICONOS[e.tipo]
            return (
              <button key={e.id} type="button" className="fila-tactil fila-tactil--60 buscar-movil__resultado" onClick={() => ir(e)}>
                <span className="fila-tactil__icono">
                  <Icono size={18} />
                </span>
                <span className="fila-tactil__texto">
                  <span className="fila-tactil__principal">{texto(e).replace(/\s+/g, ' ').trim() || '(vacío)'}</span>
                  <span className="fila-tactil__bajada">{NOMBRES_TIPO[e.tipo]}</span>
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
