// Sección "Diseños" del detalle de una tarjeta (plan 6.8): las miniaturas de los marcos vinculados (120 px de ancho,
// nombre y medidas); clic abre Diseño en ese marco. Vive en vistas/diseno/ y usa las clases de la tarjeta (adjuntos), así
// no necesita la hoja de Diseño (que solo se carga con la vista).
import { PenTool } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TarjetaDetalle } from '../../../../compartido/tipos'
import { Titulo } from '../tarjeta/Secciones'
import { apiDiseno } from './api'

type Diseno = Awaited<ReturnType<typeof apiDiseno.disenosDeTarjeta>>[number]

/** Abre Diseño en un marco (y cierra la tarjeta). */
function abrirEnDiseno(d: Diseno) {
  const partes = location.pathname.split('/').filter(Boolean)
  const tablero = partes[0]?.toUpperCase() === d.prefijo.toUpperCase() ? partes[1] : undefined
  const ruta = `/${encodeURIComponent(d.prefijo)}/${encodeURIComponent(tablero ?? '_')}/diseno/${encodeURIComponent(d.pagina)}?sel=${encodeURIComponent(d.id)}`
  history.pushState(null, '', ruta)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function SeccionDisenos({ tarjeta }: { tarjeta: TarjetaDetalle }) {
  const [lista, setLista] = useState<Diseno[]>([])
  useEffect(() => {
    let vivo = true
    apiDiseno
      .disenosDeTarjeta(tarjeta.clave)
      .then((r) => vivo && setLista(r))
      .catch(() => vivo && setLista([]))
    return () => {
      vivo = false
    }
  }, [tarjeta.clave, tarjeta.actualizadaEn])
  if (!lista.length) return null
  return (
    <section className="seccion">
      <Titulo icono={<PenTool size={15} />} texto={`Diseños · ${lista.length}`} />
      <div className="adjuntos__grilla">
        {lista.map((d) => (
          <figure key={d.id} className="adjunto" style={{ width: 120 }}>
            <button
              className="adjunto__imagen"
              onClick={() => abrirEnDiseno(d)}
              title={`Abrir «${d.nombre}» en Diseño`}
              style={{ aspectRatio: `${d.ancho} / ${d.alto}`, maxHeight: 160, cursor: 'pointer' }}
            >
              <img src={d.miniatura} alt={d.nombre} loading="lazy" style={{ objectFit: 'contain', width: '100%', height: '100%' }} />
            </button>
            <figcaption style={{ flexDirection: 'column', alignItems: 'stretch', gap: 1 }}>
              <span className="adjunto__nombre">{d.nombre}</span>
              <small style={{ color: 'var(--c-texto-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.ancho} × {d.alto} · {d.paginaNombre}
              </small>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
