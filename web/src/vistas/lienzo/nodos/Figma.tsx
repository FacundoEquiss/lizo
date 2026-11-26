import type { NodeProps } from '@xyflow/react'
import { ExternalLink, MousePointerClick } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { urlEmbebidoFigma } from '../../../../../compartido/enlaces'
import { MINIMOS } from '../../../../../compartido/lienzo'
import { MarcaFigma } from '../../../ui/marcas'
import type { NodoLienzo } from '../tipos'
import { Candado, PuntosConexion, Redimensionar, Rotulo } from './comunes'

export const Figma = memo(function Figma({ id, data, selected }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  const url = String(e.datos.url ?? '')
  const [vivo, setVivo] = useState(false)
  const [interactivo, setInteractivo] = useState(false)
  const tema = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  useEffect(() => {
    if (!selected) setInteractivo(false)
  }, [selected])
  return (
    <div className="nodo figma-nodo">
      <Rotulo id={id} texto={`Diseño de Figma: ${String(e.datos.titulo ?? 'Figma')}`} />
      {selected && !e.bloqueado && <Redimensionar id={id} min={MINIMOS.figma} />}
      <div className="figma-nodo__cabecera">
        <MarcaFigma size={15} />
        <span className="figma-nodo__titulo">{String(e.datos.titulo ?? 'Figma')}</span>
        {vivo && (
          <button className={`pildora pildora--chica nodrag${interactivo ? ' pildora--activa' : ''}`} onClick={() => setInteractivo(!interactivo)}>
            <MousePointerClick size={12} /> {interactivo ? 'Usando' : 'Usar'}
          </button>
        )}
        <a className="nodrag boton-icono boton-icono--chico" href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir en Figma">
          <ExternalLink size={14} />
        </a>
      </div>
      {vivo ? (
        <iframe
          className={`figma-nodo__marco${interactivo ? ' nodrag nowheel' : ''}`}
          style={{ pointerEvents: interactivo ? 'auto' : 'none' }}
          src={urlEmbebidoFigma(url, tema)}
          title={String(e.datos.titulo ?? 'Figma')}
          allowFullScreen
        />
      ) : (
        <button className="figma-nodo__portada nodrag" onClick={() => setVivo(true)}>
          <MarcaFigma size={44} />
          <span>Ver el diseño en vivo</span>
          <small>Necesitás tener acceso al archivo en Figma</small>
        </button>
      )}
      {e.bloqueado && <Candado />}
      <PuntosConexion />
    </div>
  )
})
