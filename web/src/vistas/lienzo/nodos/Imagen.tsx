import type { NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { leerMarco, MINIMOS } from '../../../../../compartido/lienzo'
import { useTienda } from '../../../estado/tienda'
import { duenosDe } from '../indices'
import type { NodoLienzo } from '../tipos'
import { Candado, Destello, PuntosConexion, Redimensionar, Rotulo } from './comunes'

export const Imagen = memo(function Imagen({ id, data, selected }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  // Sobre un marco liso (una hoja) la imagen va plana, sin sombra.
  const plana = useTienda((s) => {
    if (!s.tablero) return false
    const dueno = duenosDe(s.tablero.elementos).get(id)
    const marco = dueno ? s.tablero.elementos.find((x) => x.id === dueno) : undefined
    return !!marco && leerMarco(marco.datos).relleno === 'liso'
  })
  return (
    <div className={`nodo imagen${plana ? ' imagen--plana' : ''}`}>
      {selected && !e.bloqueado && <Redimensionar id={id} min={MINIMOS.imagen} lados="ninguno" proporcion />}
      <img src={String(e.datos.url ?? '')} alt={String(e.datos.titulo ?? '')} draggable={false} loading="lazy" decoding="async" />
      {e.bloqueado && <Candado />}
      <PuntosConexion />
      <Rotulo id={id} texto={`Imagen${e.datos.titulo ? `: ${String(e.datos.titulo)}` : ''}`} />
      <Destello id={id} />
    </div>
  )
})
