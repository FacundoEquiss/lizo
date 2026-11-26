import type { NodeProps } from '@xyflow/react'
import { ExternalLink } from 'lucide-react'
import { memo, useMemo } from 'react'
import { analizarEnlace } from '../../../../../compartido/enlaces'
import { MINIMOS } from '../../../../../compartido/lienzo'
import { iconoEnlace } from '../../../ui/comunes'
import type { NodoLienzo } from '../tipos'
import { Candado, Destello, PuntosConexion, Redimensionar, Rotulo } from './comunes'

export const Enlace = memo(function Enlace({ id, data, selected }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  const url = String(e.datos.url ?? '')
  const a = useMemo(() => analizarEnlace(url), [url])
  let host = url
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    // dejamos el texto como está
  }
  return (
    <div className={`nodo enlace-nodo enlace-nodo--${a.tipo.split('_')[0]}`}>
      {selected && !e.bloqueado && <Redimensionar id={id} min={MINIMOS.enlace} />}
      <span className="enlace-nodo__icono">{iconoEnlace(a, 20)}</span>
      <div className="enlace-nodo__texto">
        <b>{String(e.datos.titulo || a.titulo)}</b>
        <span>{host}</span>
      </div>
      <a className="enlace-nodo__abrir nodrag" href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir link">
        <ExternalLink size={15} />
      </a>
      {e.bloqueado && <Candado />}
      <PuntosConexion />
      <Rotulo id={id} texto={`Link: ${String(e.datos.titulo ?? e.datos.url ?? '')}`} />
      <Destello id={id} />
    </div>
  )
})
