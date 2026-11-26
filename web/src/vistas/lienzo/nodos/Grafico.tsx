// El gráfico en el lienzo: lee de una tabla del lienzo (cambia la tabla, cambia el gráfico) o trae sus datos. El dibujo es
// SVG propio (grafico/Dibujo.tsx). Doble clic o «Datos» en la barra abren el editor. Texto para lectores de pantalla con los
// valores. De lejos solo se ve el bloque con su título.
import type { NodeProps } from '@xyflow/react'
import { memo, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MINIMOS } from '../../../../../compartido/lienzo'
import { describirGrafico, leerGrafico, resolverGrafico } from '../../../../../compartido/grafico'
import { leerTabla } from '../../../../../compartido/tabla'
import { useTienda } from '../../../estado/tienda'
import { ContextoNivel } from '../acciones'
import { useLienzo } from '../estado'
import { DibujoGrafico } from '../grafico/Dibujo'
import type { NodoLienzo } from '../tipos'
import { Candado, Destello, PuntosConexion, Redimensionar, Rotulo } from './comunes'

export const GraficoNodo = memo(function GraficoNodo({ id, data, selected }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  const nivel = useContext(ContextoNivel)
  const g = useMemo(() => leerGrafico(e.datos), [e.datos])
  const origen = useTienda((s) => (g.fuente ? s.tablero?.elementos.find((x) => x.id === g.fuente!.tabla) : undefined))
  const tabla = useMemo(() => (origen && origen.tipo === 'tabla' ? leerTabla(origen.datos) : null), [origen?.datos])
  const r = useMemo(() => resolverGrafico(g, tabla), [g, tabla])
  const leyendaPropia = g.leyenda === 'si' || (g.leyenda === 'auto' && (r.series.length > 1 || g.tipo === 'torta' || g.tipo === 'anillo'))
  const entradas = g.tipo === 'torta' || g.tipo === 'anillo' || g.tipo === 'embudo' ? r.categorias.map((n, i) => ({ n, c: r.coloresCategoria[i] ?? 'gris' })) : r.series.map((s) => ({ n: s.nombre, c: s.color }))

  // El tamaño del área de dibujo se mide (mientras se arrastra el tamaño, el dibujo acompaña).
  const area = useRef<HTMLDivElement>(null)
  const [medida, setMedida] = useState({ ancho: Math.max(e.ancho - 24, 40), alto: Math.max(e.alto - 80, 40) })
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const medir = () => {
      const w = Math.floor(el.clientWidth)
      const h = Math.floor(el.clientHeight)
      if (w > 20 && h > 20) setMedida((m) => (m.ancho === w && m.alto === h ? m : { ancho: w, alto: h }))
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [nivel])

  const abrir = () => !e.bloqueado && useLienzo.getState().set({ graficoAbierto: id })
  const vacio = !r.categorias.length || !r.series.length
  const descripcion = describirGrafico(g, r)

  return (
    <div className={`nodo grafico-nodo${nivel ? ` grafico-nodo--${nivel}` : ''}`}>
      {selected && !e.bloqueado && <Redimensionar id={id} min={MINIMOS.grafico} esquinas />}
      {nivel === 'muy-lejos' && !selected ? (
        <div className="grafico-nodo__lejos">{g.titulo || 'Gráfico'}</div>
      ) : (
        <>
          {g.titulo && <div className="grafico-nodo__titulo">{g.titulo}</div>}
          <div className="grafico-nodo__area" ref={area}>
            {vacio ? (
              <div className="grafico-nodo__vacio">
                <p>{r.aviso ?? 'Todavía no hay datos.'}</p>
                {!e.bloqueado && (
                  <button type="button" className="boton boton--chico nodrag" onPointerDown={(ev) => ev.stopPropagation()} onClick={abrir}>
                    Elegir los datos
                  </button>
                )}
              </div>
            ) : (
              <DibujoGrafico g={g} r={r} ancho={medida.ancho} alto={medida.alto} />
            )}
          </div>
          {!vacio && r.aviso && <div className="grafico-nodo__aviso">{r.aviso}</div>}
          {!vacio && leyendaPropia && (
            <ul className="grafico-nodo__leyenda">
              {entradas.map((x) => (
                <li key={x.n}>
                  <i style={{ background: `var(--e-${x.c}-s)` }} aria-hidden />
                  {x.n}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {e.bloqueado && <Candado />}
      <PuntosConexion />
      <Rotulo id={id} texto={descripcion} />
      <Destello id={id} />
    </div>
  )
})
