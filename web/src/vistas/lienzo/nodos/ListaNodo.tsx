import type { NodeProps } from '@xyflow/react'
import { Plus } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { MINIMOS } from '../../../../../compartido/lienzo'
import { porId, porOrden, useTienda } from '../../../estado/tienda'
import { TarjetaFrente } from '../../kanban/TarjetaFrente'
import type { NodoLienzo } from '../tipos'
import { PuntosConexion, Redimensionar, Rotulo } from './comunes'

export const ListaNodo = memo(function ListaNodo({ id, data, selected }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  const lista = useTienda((s) => (s.tablero && e.listaId ? porId(s.tablero.listas).get(e.listaId) : undefined))
  const todas = useTienda((s) => s.tablero?.tarjetas)
  const etiquetasLista = useTienda((s) => s.tablero?.etiquetas)
  const miembros = useTienda((s) => s.miembros)
  const etiquetas = etiquetasLista ? porId(etiquetasLista) : new Map()
  const tarjetas = useMemo(() => (todas ?? []).filter((t) => t.listaId === e.listaId && !t.archivada).sort(porOrden), [todas, e.listaId])
  const [nuevo, setNuevo] = useState('')
  if (!lista)
    return (
      <div className="nodo nodo-lista nodo-lista--perdida">
        Lista archivada
        <PuntosConexion />
      </div>
    )
  return (
    <div className="nodo nodo-lista">
      <Rotulo id={id} texto={`Lista del Kanban ${lista.nombre}, ${tarjetas.length === 1 ? '1 tarjeta' : `${tarjetas.length} tarjetas`}`} />
      {selected && !e.bloqueado && <Redimensionar id={id} min={MINIMOS.lista} />}
      <div className="nodo-lista__cabecera">
        <span className={`punto-categoria${lista.categoria ? ` punto-categoria--${lista.categoria}` : ''}`} />
        <span className="nodo-lista__nombre">{lista.nombre}</span>
        <span className="lista__cuenta">{tarjetas.length}</span>
      </div>
      <div className="nodo-lista__tarjetas nowheel nodrag">
        {tarjetas.map((t) => (
          <button key={t.id} className="nodo-lista__tarjeta" onClick={() => useTienda.getState().abrirTarjeta(t.clave)}>
            <TarjetaFrente tarjeta={t} etiquetas={etiquetas} miembros={miembros} compacta hecha={lista.categoria === 'hecho'} />
          </button>
        ))}
        <div className="nodo-lista__nuevo">
          <Plus size={14} />
          <input
            value={nuevo}
            placeholder="Agregar tarjeta…"
            onChange={(ev) => setNuevo(ev.target.value)}
            onKeyDown={(ev) => {
              ev.stopPropagation()
              if (ev.key === 'Enter' && nuevo.trim()) {
                useTienda.getState().crearTarjeta(lista.id, nuevo.trim())
                setNuevo('')
              }
            }}
          />
        </div>
      </div>
      <PuntosConexion />
    </div>
  )
})
