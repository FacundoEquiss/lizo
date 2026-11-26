import {
  BookOpen,
  Bug,
  ChevronDown,
  ChevronsUp,
  CircleHelp,
  Equal,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  CircleDot,
  Lightbulb,
  Link2,
  OctagonAlert,
  Scale,
  Sparkles,
  SquareCheckBig,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { forwardRef, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'
import { TIPOS_TARJETA } from '../../../compartido/constantes'
import type { Enlace, Etiqueta, Miembro, Prioridad, TipoTarjeta } from '../../../compartido/tipos'
import { teclaLegible } from '../util/teclas'
import { MarcaDiscord, MarcaFigma, MarcaGithub } from './marcas'

export function Kbd({ atajo, suave }: { atajo: string; suave?: boolean }) {
  return (
    <span className={`kbd${suave ? ' kbd--suave' : ''}`}>
      {teclaLegible(atajo).map((t, i) => (
        <kbd key={i}>{t}</kbd>
      ))}
    </span>
  )
}

export const ICONOS_TIPO: Record<TipoTarjeta, LucideIcon> = {
  tarea: SquareCheckBig,
  error: Bug,
  idea: Lightbulb,
  historia: BookOpen,
  epica: Zap,
  pregunta: CircleHelp,
  decision: Scale,
}

export function IconoTipo({ tipo, tam = 16 }: { tipo: TipoTarjeta; tam?: number }) {
  const Icono = ICONOS_TIPO[tipo] ?? SquareCheckBig
  const color = TIPOS_TARJETA.find((t) => t.id === tipo)?.color ?? 'gris'
  return (
    <span
      className="icono-tipo"
      style={{ width: tam, height: tam, background: `var(--e-${color}-s)` }}
      title={TIPOS_TARJETA.find((t) => t.id === tipo)?.nombre}
    >
      <Icono size={Math.round(tam * 0.68)} strokeWidth={2.4} />
    </span>
  )
}

const ICONOS_PRIORIDAD: Partial<Record<Prioridad, { icono: LucideIcon; color: string; nombre: string }>> = {
  urgente: { icono: OctagonAlert, color: 'var(--e-rojo-s)', nombre: 'Urgente' },
  alta: { icono: ChevronsUp, color: 'var(--e-naranja-s)', nombre: 'Alta' },
  media: { icono: Equal, color: 'var(--e-amarillo-s)', nombre: 'Media' },
  baja: { icono: ChevronDown, color: 'var(--e-azul-s)', nombre: 'Baja' },
}

export function IconoPrioridad({ prioridad, tam = 16 }: { prioridad: Prioridad; tam?: number }) {
  const p = ICONOS_PRIORIDAD[prioridad]
  if (!p) return null
  const I = p.icono
  return (
    <span className="icono-prioridad" title={`Prioridad ${p.nombre.toLowerCase()}`} style={{ color: p.color }}>
      <I size={tam} strokeWidth={2.6} />
    </span>
  )
}

export function Avatar({ miembro, tam = 24, titulo }: { miembro?: Miembro | null; tam?: number; titulo?: string }) {
  if (!miembro)
    return (
      <span className="avatar avatar--vacio" style={{ width: tam, height: tam }}>
        ?
      </span>
    )
  const ia = miembro.tipo === 'ia'
  return (
    <span
      className={`avatar${ia ? ' avatar--ia' : ''}`}
      style={{ width: tam, height: tam, fontSize: Math.max(9, Math.round(tam * 0.42)), ['--c' as string]: `var(--e-${miembro.color}-s)` }}
      title={titulo ?? miembro.nombre}
    >
      {ia ? <Sparkles size={Math.round(tam * 0.55)} strokeWidth={2.2} /> : miembro.iniciales}
    </span>
  )
}

export function PilaAvatares({ ids, miembros, max = 3, tam = 22 }: { ids: string[]; miembros: Miembro[]; max?: number; tam?: number }) {
  const lista = ids.map((id) => miembros.find((m) => m.id === id)).filter(Boolean) as Miembro[]
  if (lista.length === 0) return null
  return (
    <span className="pila-avatares">
      {lista.slice(0, max).map((m) => (
        <Avatar key={m.id} miembro={m} tam={tam} />
      ))}
      {lista.length > max && (
        <span className="avatar avatar--mas" style={{ width: tam, height: tam }}>
          +{lista.length - max}
        </span>
      )}
    </span>
  )
}

export function ChipEtiqueta({ etiqueta, chica, onClick }: { etiqueta: Etiqueta; chica?: boolean; onClick?: () => void }) {
  return (
    <span
      className={`chip-etiqueta${chica ? ' chip-etiqueta--chica' : ''}${etiqueta.grupo === 'tipo' ? ' chip-etiqueta--neutra' : ''}`}
      style={{ background: `var(--e-${etiqueta.color})`, color: `var(--e-${etiqueta.color}-t)` }}
      onClick={onClick}
    >
      {etiqueta.grupo !== 'tipo' && <span className="chip-etiqueta__punto" style={{ background: `var(--e-${etiqueta.color}-s)` }} />}
      {etiqueta.nombre}
    </span>
  )
}

export function iconoEnlace(e: Pick<Enlace, 'tipo'>, tam = 13) {
  switch (e.tipo) {
    case 'github_pr':
      return <GitPullRequest size={tam} strokeWidth={2.2} />
    case 'github_issue':
      return <CircleDot size={tam} strokeWidth={2.2} />
    case 'github_commit':
      return <GitCommitHorizontal size={tam} strokeWidth={2.2} />
    case 'github_rama':
      return <GitBranch size={tam} strokeWidth={2.2} />
    case 'github_repo':
      return <MarcaGithub size={tam} />
    case 'figma':
      return <MarcaFigma size={tam} />
    case 'discord':
      return <MarcaDiscord size={tam - 1} style={{ color: '#5865F2' }} />
    default:
      return <Link2 size={tam} strokeWidth={2.2} />
  }
}

export function ChipEnlace({ enlace, grande }: { enlace: Enlace; grande?: boolean }) {
  const corto =
    enlace.tipo === 'github_pr' || enlace.tipo === 'github_issue'
      ? `#${enlace.datos.numero}`
      : enlace.tipo === 'github_commit'
        ? String(enlace.datos.sha ?? '').slice(0, 7)
        : enlace.tipo === 'figma'
          ? 'Figma'
          : enlace.tipo === 'discord'
            ? 'Discord'
            : enlace.titulo
  return (
    <a
      className={`chip-enlace chip-enlace--${enlace.tipo.split('_')[0]}${grande ? ' chip-enlace--grande' : ''}`}
      href={enlace.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${enlace.titulo} · ${enlace.url}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {iconoEnlace(enlace)}
      <span>{grande ? enlace.titulo : corto}</span>
    </a>
  )
}

/** Textarea que crece con el contenido. */
export const TextoAuto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minFilas?: number }>(
  function TextoAuto({ minFilas = 1, ...props }, refExterna) {
    const ref = useRef<HTMLTextAreaElement | null>(null)
    useLayoutEffect(() => {
      const el = ref.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }, [props.value])
    return (
      <textarea
        rows={minFilas}
        {...props}
        ref={(el) => {
          ref.current = el
          if (typeof refExterna === 'function') refExterna(el)
          else if (refExterna) refExterna.current = el
        }}
        onInput={(e) => {
          const el = e.currentTarget
          el.style.height = 'auto'
          el.style.height = `${el.scrollHeight}px`
          props.onInput?.(e)
        }}
      />
    )
  },
)

export function Girando({ tam = 16 }: { tam?: number }) {
  return <span className="girando" style={{ width: tam, height: tam }} />
}

/** Interruptor (sí o no) de 36 × 20, con la perilla que salta de lado. */
export function Interruptor({
  valor,
  alCambiar,
  etiqueta,
  id,
  deshabilitado,
}: {
  valor: boolean
  alCambiar: (v: boolean) => void
  etiqueta: string
  id?: string
  deshabilitado?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={valor}
      aria-label={etiqueta}
      disabled={deshabilitado}
      className={`interruptor${valor ? ' interruptor--si' : ''}`}
      onClick={() => alCambiar(!valor)}
    >
      <span className="interruptor__perilla" />
    </button>
  )
}

/** Opciones excluyentes en una píldora (Cómoda · Compacta). */
export function Segmentado<T extends string | number>({
  opciones,
  valor,
  alCambiar,
  etiqueta,
  tam,
  deshabilitado,
}: {
  opciones: { id: T; nombre: string }[]
  valor: T
  alCambiar: (v: T) => void
  etiqueta: string
  tam?: 'chico' | 'grande'
  deshabilitado?: boolean
}) {
  return (
    <div className={`segmentado${tam ? ` segmentado--${tam}` : ''}`} role="radiogroup" aria-label={etiqueta} aria-disabled={deshabilitado || undefined}>
      {opciones.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          disabled={deshabilitado}
          aria-checked={valor === o.id}
          className={`segmentado__opcion${valor === o.id ? ' segmentado__opcion--activa' : ''}`}
          onClick={() => alCambiar(o.id)}
        >
          {o.nombre}
        </button>
      ))}
    </div>
  )
}
