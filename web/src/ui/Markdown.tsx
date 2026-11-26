// Texto en Markdown (el porqué, la descripción y los comentarios de una tarjeta; las notas de Diseño). Va aparte de
// ui/comunes.tsx: markdown-it y DOMPurify pesan ~45 KB comprimidos, y comunes.tsx lo usan la pantalla de entrar y la
// de sin conexión, que van en el trozo inicial. Así los baja solo lo que muestra Markdown.
// Los `@alias` que existen entre los miembros se dibujan como pastillas (plan de la IA integrada, 14.3): al pasar el mouse
// muestran el nombre completo y, con el dedo, al tocarlas lo dicen en un aviso.
import { useMemo } from 'react'
import { avisar } from '../estado/avisos'
import { useTienda } from '../estado/tienda'
import { aHtml } from '../util/markdown'

export function Markdown({ texto, className }: { texto: string; className?: string }) {
  const miembros = useTienda((s) => s.miembros)
  const html = useMemo(() => aHtml(texto, miembros), [texto, miembros])
  return (
    <div
      className={`md ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const pastilla = (e.target as HTMLElement).closest<HTMLElement>('.md-mencion')
        if (!pastilla) return
        // Con el mouse, el nombre sale al pasar por encima (title). Con el dedo no hay «pasar por encima».
        if (matchMedia('(hover: none)').matches) avisar({ texto: pastilla.dataset.nombre ?? '', duracion: 1800 })
      }}
    />
  )
}
