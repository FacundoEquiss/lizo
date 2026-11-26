// La cara de un proyecto (7.2): su foto; si no, su emoji sobre el color del proyecto; si no, el sello con las iniciales
// del nombre sobre un degradado del color. Se usa en la barra lateral (28), la barra superior (22), el diálogo (72), la
// paleta (20) y el celular.
import { useEffect, useState } from 'react'
import type { Proyecto } from '../../../compartido/tipos'

/** Dos letras: la primera de las dos primeras palabras, o las dos primeras de una sola. */
export function inicialesDe(nombre: string): string {
  const palabras = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!palabras.length) return '?'
  if (palabras.length === 1) return palabras[0]!.slice(0, 2).toUpperCase()
  return (palabras[0]![0]! + palabras[1]![0]!).toUpperCase()
}

export function AvatarProyecto({
  proyecto,
  tam,
  className,
}: {
  proyecto: Pick<Proyecto, 'nombre' | 'color' | 'imagen' | 'emoji'>
  tam: number
  className?: string
}) {
  // Si la foto no carga (se borró del almacén), cae al sello.
  const [rota, setRota] = useState(false)
  useEffect(() => setRota(false), [proyecto.imagen])
  const radio = Math.round(tam * 0.32)
  const base = { width: tam, height: tam, borderRadius: radio }
  if (proyecto.imagen && !rota)
    return (
      <img
        className={`avatar-proyecto avatar-proyecto--foto ${className ?? ''}`}
        src={proyecto.imagen}
        alt=""
        aria-hidden
        draggable={false}
        style={base}
        onError={() => setRota(true)}
      />
    )
  if (proyecto.emoji)
    return (
      <span
        className={`avatar-proyecto avatar-proyecto--emoji ${className ?? ''}`}
        aria-hidden
        style={{ ...base, background: `var(--e-${proyecto.color})`, fontSize: Math.round(tam * 0.58) }}
      >
        {proyecto.emoji}
      </span>
    )
  return (
    <span
      className={`avatar-proyecto avatar-proyecto--sello ${className ?? ''}`}
      aria-hidden
      style={{
        ...base,
        background: `linear-gradient(140deg, var(--e-${proyecto.color}-s), color-mix(in srgb, var(--e-${proyecto.color}-s) 78%, #000))`,
        fontSize: Math.max(9, Math.round(tam * 0.4)),
      }}
    >
      {inicialesDe(proyecto.nombre)}
    </span>
  )
}
