// Las piezas chicas de Configuración → IA que se repiten: la pastilla de estado de un agente o de una clave, la barra fina de gasto
// contra el tope, el campo de la clave (donde se pega, y solo ahí), el desplegable nativo y el aviso de «esto se cambia desde tu
// cuenta». Una pieza por cosa: las usan la lista, los formularios y el gasto.
import { Check, ChevronDown, CircleAlert, Gauge, KeyRound, Pause, TriangleAlert } from 'lucide-react'
import { createContext, useContext, useId, type ReactNode, type SelectHTMLAttributes } from 'react'
import type { Agente, ClaveIA, EstadoIA } from '../../../../../compartido/ia'
import type { BorradorAgente } from './borrador'
import type { IdOpcion } from './proveedores'

/** A dónde se puede ir dentro de la sección (el celular y el diálogo la muestran igual: no hay un segundo diálogo). */
export type Vista =
  | { tipo: 'inicio' }
  | { tipo: 'agente'; id: string | 'nuevo'; borrador?: BorradorAgente }
  | { tipo: 'clave'; id: string | 'nueva'; opcion?: IdOpcion; volver?: { id: string | 'nuevo'; borrador: BorradorAgente } }

export interface ContextoConfigIA {
  ia: EstadoIA
  /** false si se entró con la clave del MCP: se ve, pero no se cambia. */
  puede: boolean
  /** Vuelve a pedir el estado (después de cambiar algo que toca a varios: quitar una clave, archivar un agente…). */
  recargar: () => Promise<void>
  ir: (v: Vista) => void
}

export const ContextoIA = createContext<ContextoConfigIA | null>(null)
export const useConfigIA = () => useContext(ContextoIA)!

/** El texto que acompaña a todo lo que está apagado por no haber entrado con la cuenta (14.7). */
export const SOLO_CON_CUENTA = 'Esto se cambia desde tu cuenta.'

export function AvisoSoloLectura() {
  return (
    <p className="ia-aviso ia-aviso--lectura" role="status">
      <KeyRound size={14} aria-hidden /> {SOLO_CON_CUENTA} Con la clave del MCP se mira, pero no se cambia.
    </p>
  )
}

// ───────── Pastillas de estado ─────────

const ESTADO_AGENTE: Record<Agente['estado'], { texto: string; tono: 'ok' | 'aviso' | 'malo' | 'neutro'; icono: typeof Check }> = {
  listo: { texto: 'Listo', tono: 'ok', icono: Check },
  sin_clave: { texto: 'Sin clave', tono: 'aviso', icono: KeyRound },
  clave_invalida: { texto: 'La clave no anda', tono: 'malo', icono: TriangleAlert },
  pausado: { texto: 'Pausado', tono: 'neutro', icono: Pause },
  en_tope: { texto: 'En el tope', tono: 'aviso', icono: Gauge },
}

export function PildoraEstado({ estado }: { estado: Agente['estado'] }) {
  const e = ESTADO_AGENTE[estado]
  const Icono = e.icono
  return (
    <span className={`ia-pildora ia-pildora--${e.tono}`}>
      <Icono size={12} strokeWidth={2.6} aria-hidden /> {e.texto}
    </span>
  )
}

export function PildoraClave({ clave }: { clave: ClaveIA }) {
  const [texto, tono, Icono] =
    clave.estado === 'valida'
      ? (['Anda', 'ok', Check] as const)
      : clave.estado === 'invalida'
        ? (['No anda', 'malo', TriangleAlert] as const)
        : (['Sin probar', 'neutro', CircleAlert] as const)
  return (
    <span className={`ia-pildora ia-pildora--${tono}`}>
      <Icono size={12} strokeWidth={2.6} aria-hidden /> {texto}
    </span>
  )
}

// ───────── La barra de gasto ─────────

/** «USD 3,20»: lo que gasta la IA se escribe con centavos. */
export const dolares = (n: number) => `USD ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Gasto del mes contra el tope: una barra fina y, siempre, el número y el porcentaje en texto (el color nunca solo). Pasa a amarillo
 * al 80 % (cuando Telar avisa) y a rojo al 100 % (cuando frena).
 */
export function BarraGasto({ gasto, tope, etiqueta }: { gasto: number; tope: number; etiqueta: string }) {
  const pct = tope > 0 ? Math.min(100, Math.round((gasto / tope) * 100)) : 0
  const nivel = tope > 0 && gasto >= tope ? 'tope' : tope > 0 && gasto >= tope * 0.8 ? 'aviso' : 'normal'
  return (
    <div className="ia-gasto" data-nivel={nivel}>
      <div className="ia-gasto__barra" role="img" aria-label={`${etiqueta}: ${dolares(gasto)} de ${dolares(tope)} (${pct} %)`}>
        <span style={{ width: `${Math.max(gasto > 0 ? 2 : 0, pct)}%` }} />
      </div>
      <span className="ia-gasto__texto">
        {dolares(gasto)} de {dolares(tope)}
        {nivel === 'aviso' && ' · va por el 80 %'}
        {nivel === 'tope' && ' · en el tope'}
      </span>
    </div>
  )
}

// ───────── Campos ─────────

/** Un campo con su etiqueta arriba, su ayuda abajo y su error (el mismo molde de «Mi perfil»). */
export function Campo({ etiqueta, ayuda, error, children, id }: { etiqueta: string; ayuda?: ReactNode; error?: string; children: (props: { id: string; 'aria-describedby': string; 'aria-invalid'?: true }) => ReactNode; id?: string }) {
  const auto = useId()
  const campo = id ?? auto
  return (
    <div className="perfil__campo ia-campo">
      <label htmlFor={campo}>{etiqueta}</label>
      {children({ id: campo, 'aria-describedby': `${campo}-ayuda`, ...(error ? { 'aria-invalid': true as const } : {}) })}
      {(error || ayuda) && (
        <span id={`${campo}-ayuda`} className={`perfil__ayuda${error ? ' perfil__ayuda--error' : ''}`} role={error ? 'alert' : undefined}>
          {error || ayuda}
        </span>
      )}
    </div>
  )
}

/** El desplegable del sistema (en el celular abre el selector del teléfono), con la flecha de Telar. */
export function SelectNativo(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="ia-select">
      <select {...props} />
      <ChevronDown size={15} aria-hidden />
    </span>
  )
}

/**
 * El campo donde se pega una clave. Es de contraseña (no se ve en pantalla, ni mientras se escribe), sin autocompletar ni corrector,
 * y NO se le pide al navegador que la recuerde. La clave se pega solo acá: nunca por el chat (regla 1) y nunca vuelve a mostrarse.
 */
export function CampoClave({ valor, alCambiar, deshabilitado, id, placeholder, ...resto }: { valor: string; alCambiar: (v: string) => void; deshabilitado?: boolean; id: string; placeholder?: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) {
  return (
    <input
      {...resto}
      id={id}
      type="password"
      name="telar-clave-api"
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      data-form-type="other"
      value={valor}
      placeholder={placeholder ?? 'Pegá la clave acá'}
      disabled={deshabilitado}
      onChange={(e) => alCambiar(e.target.value.replace(/\s+/g, ''))}
    />
  )
}
