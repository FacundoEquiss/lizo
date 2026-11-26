// Cómo se dibuja una celda según el tipo de su columna (número, moneda, fecha, link, rama de git…). La usan la tabla del
// lienzo (solo lectura) y el editor. El formato (es-AR, «24 nov 2026», «1 h 30 min») sale de compartido/tabla.ts.
import { Check, Folder, GitBranch, Mail, MapPin, Phone, Square } from 'lucide-react'
import {
  direccionLink,
  dominioDe,
  formatearCelda,
  urlMapa,
  type ColumnaTabla,
  type ValorCelda,
} from '../../../../../compartido/tabla'
import { NOMBRES_COLOR } from '../../../../../compartido/lienzo'

/** Los links de adentro de una celda se abren sin arrastrar ni seleccionar el objeto. */
const ABRIR = { target: '_blank', rel: 'noopener noreferrer', className: 'nodrag celda__link', onPointerDown: (e: React.PointerEvent) => e.stopPropagation() } as const

export function Celda({ col, valor, tamanoIcono = 13 }: { col: ColumnaTabla; valor: ValorCelda | undefined; tamanoIcono?: number }) {
  const v = valor ?? null
  const vacio = v === null || v === ''
  if (col.tipo === 'casilla')
    return (
      <span className={`celda__casilla${v === true ? ' celda__casilla--si' : ''}`} role="img" aria-label={v === true ? 'Sí' : 'No'}>
        {v === true ? <Check size={tamanoIcono + 1} strokeWidth={3} /> : <Square size={tamanoIcono + 1} strokeWidth={1.5} />}
      </span>
    )
  if (vacio) return null
  const texto = formatearCelda(col, v)
  switch (col.tipo) {
    case 'etiqueta': {
      const op = col.opciones?.find((o) => o.nombre === v)
      return (
        <span className="celda__pastilla" style={{ background: `var(--e-${op?.color ?? 'gris'})`, color: `var(--e-${op?.color ?? 'gris'}-t)` }}>
          {texto}
        </span>
      )
    }
    case 'color':
      return (
        <span className="celda__color">
          <i style={{ background: `var(--n-${String(v)})` }} aria-hidden />
          {NOMBRES_COLOR[v as keyof typeof NOMBRES_COLOR] ?? texto}
        </span>
      )
    case 'link':
      return (
        <a href={direccionLink(String(v))} {...ABRIR} title={String(v)}>
          {dominioDe(String(v))}
        </a>
      )
    case 'email':
      return (
        <a href={`mailto:${String(v)}`} {...ABRIR}>
          <Mail size={tamanoIcono} aria-hidden /> {texto}
        </a>
      )
    case 'telefono':
      return (
        <a href={`tel:${String(v).replace(/[^\d+]/g, '')}`} {...ABRIR}>
          <Phone size={tamanoIcono} aria-hidden /> {texto}
        </a>
      )
    case 'ubicacion':
      return (
        <a href={urlMapa(String(v))} {...ABRIR} title="Abrir en el mapa">
          <MapPin size={tamanoIcono} aria-hidden /> {texto}
        </a>
      )
    case 'rama':
      return (
        <span className="celda__codigo">
          <GitBranch size={tamanoIcono} aria-hidden /> {texto}
        </span>
      )
    case 'directorio':
      return (
        <span className="celda__codigo">
          <Folder size={tamanoIcono} aria-hidden /> {texto}
        </span>
      )
    case 'tarjeta': {
      const prefijo = String(v).split('-')[0]
      return (
        <a href={`/${prefijo}?tarjeta=${encodeURIComponent(String(v))}`} {...ABRIR} title="Abrir la tarjeta">
          <span className="celda__pastilla celda__pastilla--clave">{texto}</span>
        </a>
      )
    }
    case 'porcentaje': {
      const n = typeof v === 'number' ? Math.max(0, Math.min(100, v)) : 0
      return (
        <span className="celda__porcentaje">
          <i style={{ width: `${n}%` }} aria-hidden />
          <span>{texto}</span>
        </span>
      )
    }
    default:
      return <>{texto}</>
  }
}

/** Los números (y fechas y duraciones) se alinean a la derecha de fábrica; el resto, a la izquierda. */
export function alineacionDe(col: ColumnaTabla): 'izquierda' | 'centro' | 'derecha' {
  if (col.alineacion) return col.alineacion
  if (col.tipo === 'casilla') return 'centro'
  return col.tipo === 'numero' || col.tipo === 'moneda' || col.tipo === 'porcentaje' || col.tipo === 'duracion' ? 'derecha' : 'izquierda'
}
