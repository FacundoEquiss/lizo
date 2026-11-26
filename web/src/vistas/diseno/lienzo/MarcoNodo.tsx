// Un marco en el lienzo (nodo de React Flow): el nombre arriba (tamaño constante con el zoom), la miniatura primero y el
// iframe vivo encima cuando le toca (fundido cruzado de 120 ms). Los pines de comentarios van encima, de tamaño constante.
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { Link2, Lock } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import type { ComentarioDiseno, MarcoResumen } from '../../../../../compartido/diseno/tipos'
import { urlMiniatura } from '../api'
import { useDiseno } from '../estado'
import { MarcoVivo } from './MarcoVivo'
import { useVivo } from './vivos'

export interface DatosNodoMarco extends Record<string, unknown> {
  marco: MarcoResumen
  prefijo: string
  pines: ComentarioDiseno[]
}
export type NodoMarco = Node<DatosNodoMarco, 'marco'>

export const MarcoNodo = memo(function MarcoNodo({ id, data }: NodeProps<NodoMarco>) {
  const m = data.marco
  const vivo = useVivo(id)
  const completo = useDiseno((s) => s.completos[id])
  const cargarMarco = useDiseno((s) => s.cargarMarco)
  const seleccionado = useDiseno((s) => s.seleccion.marcos.includes(id))
  const soloMarco = useDiseno((s) => s.seleccion.marco === id && !s.seleccion.capa)
  const probando = useDiseno((s) => s.probando === id)
  const destello = useDiseno((s) => s.destellos[id])
  const herramienta = useDiseno((s) => s.herramienta)
  const [cargado, setCargado] = useState(false)
  const propio = m.origen === 'propio'

  useEffect(() => {
    if (vivo && !completo) void cargarMarco(id)
    if (!vivo) setCargado(false)
  }, [vivo, completo, id, cargarMarco])

  const reciente = destello && Date.now() - destello < 2500
  return (
    <div
      className={`dz-marco${seleccionado ? ' dz-marco--sel' : ''}${probando ? ' dz-marco--probando' : ''}${reciente ? ' dz-marco--destello' : ''}${m.nuevo ? ' dz-marco--nuevo' : ''}`}
      style={{ width: m.ancho, height: m.alto }}
      data-marco={id}
    >
      <div className="dz-marco__nombre" title={`${m.nombre} · ${m.ancho} × ${m.alto}`}>
        {!propio && <Link2 className="dz-marco__enlace" aria-label="Viene del código" />}
        {m.bloqueado && <Lock className="dz-marco__enlace" aria-label="Bloqueado" />}
        <span className="dz-marco__titulo">{m.nombre}</span>
        <span className="dz-marco__medidas">
          {m.ancho} × {m.alto}
        </span>
        {m.tarjetas.map((t) => (
          <span key={t} className="dz-marco__tarjeta">
            {t}
          </span>
        ))}
        {m.nuevo && <span className="dz-marco__punto" title="Cambió en la última sincronización" />}
      </div>
      <div className="dz-marco__cuerpo" style={{ background: m.datos.fondo || (propio ? '#ffffff' : undefined) }}>
        <img
          className={`dz-marco__mini${cargado ? ' dz-marco__mini--oculta' : ''}`}
          src={urlMiniatura(data.prefijo, m)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        {vivo && completo && completo.marco.revision >= m.revision && (
          <div className={`dz-marco__vivo${cargado ? ' dz-marco__vivo--listo' : ''}`}>
            <MarcoVivo completo={completo} alCargar={() => setCargado(true)} />
          </div>
        )}
      </div>
      {data.pines.map((c, i) =>
        c.x == null ? null : (
          <button
            key={c.id}
            className={`dz-pin${c.autor.tipo === 'ia' ? ' dz-pin--ia' : ''}`}
            style={{ left: c.x, top: c.y ?? 0 }}
            data-comentario={c.id}
            title={`${c.autor.nombre}: ${c.texto}`}
            onClick={(e) => {
              e.stopPropagation()
              window.dispatchEvent(new CustomEvent('telar:diseno-pin', { detail: { id: c.id, marco: id } }))
            }}
          >
            {c.autor.tipo === 'ia' ? '✦' : (c.autor.nombre[0] ?? '?').toUpperCase()}
            <span className="dz-pin__n">{i + 1}</span>
          </button>
        ),
      )}
      {propio && soloMarco && !m.bloqueado && herramienta === 'seleccionar' && (
        <NodeResizer
          minWidth={16}
          minHeight={16}
          maxWidth={8192}
          maxHeight={8192}
          lineClassName="dz-resizer-linea"
          handleClassName="dz-resizer-manija"
          onResizeEnd={(_e, p) => useDiseno.getState().redimensionarMarco(id, p.width, p.height, p.x, p.y)}
        />
      )}
    </div>
  )
})

export interface DatosNodoSeccion extends Record<string, unknown> {
  titulo: string
}
export type NodoSeccion = Node<DatosNodoSeccion, 'seccion'>

export const SeccionNodo = memo(function SeccionNodo({ data }: NodeProps<NodoSeccion>) {
  return <div className="dz-seccion">{data.titulo}</div>
})
