// Los selectores del compositor de tarjetas: tipo, prioridad y etiquetas, en píldoras que abren el mismo selector con
// búsqueda de siempre (el de la tarjeta abierta). En el celular el Desplegable ya se muestra como hoja inferior, así que
// son las mismas piezas en las dos pantallas. Al cerrarse, `alCerrar` devuelve el foco al título: seguir escribiendo.
import { ChevronDown, Tag, X } from 'lucide-react'
import { useState } from 'react'
import { PRIORIDADES, TIPOS_TARJETA } from '../../../../../compartido/constantes'
import type { Etiqueta, Prioridad, TipoTarjeta } from '../../../../../compartido/tipos'
import { useTienda } from '../../../estado/tienda'
import { ChipEtiqueta, IconoPrioridad, IconoTipo } from '../../../ui/comunes'
import { Desplegable, Selector } from '../../../ui/Desplegable'
import type { EtiquetaAlta } from './borrador'

/** Un desplegable que avisa cuando se cerró (para devolver el foco al título). */
function useCierre(alCerrar?: () => void) {
  const [abierto, setAbierto] = useState(false)
  return {
    abierto,
    alCambiar: (v: boolean) => {
      setAbierto(v)
      if (!v) alCerrar?.()
    },
  }
}

export function PildoraTipo({ valor, alElegir, alCerrar }: { valor: TipoTarjeta; alElegir: (t: TipoTarjeta) => void; alCerrar?: () => void }) {
  const c = useCierre(alCerrar)
  const tipo = TIPOS_TARJETA.find((x) => x.id === valor)!
  return (
    <Desplegable
      {...c}
      ancho={240}
      disparador={(p) => (
        <button {...p} type="button" className="pildora alta__pildora" aria-label={`Tipo de tarjeta: ${tipo.nombre}`}>
          <IconoTipo tipo={valor} tam={16} />
          <span>{tipo.nombre}</span>
          <ChevronDown size={13} aria-hidden />
        </button>
      )}
    >
      {(cerrar) => (
        <Selector
          placeholder="Tipo…"
          elegidas={[valor]}
          opciones={TIPOS_TARJETA.map((x) => ({ id: x.id, etiqueta: x.nombre, icono: <IconoTipo tipo={x.id} tam={16} />, detalle: x.descripcion }))}
          alElegir={(id) => {
            alElegir(id as TipoTarjeta)
            cerrar()
          }}
        />
      )}
    </Desplegable>
  )
}

export function PildoraPrioridad({ valor, alElegir, alCerrar }: { valor: Prioridad; alElegir: (p: Prioridad) => void; alCerrar?: () => void }) {
  const c = useCierre(alCerrar)
  const prioridad = PRIORIDADES.find((x) => x.id === valor)!
  return (
    <Desplegable
      {...c}
      ancho={220}
      disparador={(p) => (
        <button {...p} type="button" className="pildora alta__pildora" aria-label={`Prioridad: ${prioridad.nombre}`}>
          {valor === 'ninguna' ? <span className="alta__vacio">Prioridad</span> : (
            <>
              <IconoPrioridad prioridad={valor} tam={15} />
              <span>{prioridad.nombre}</span>
            </>
          )}
          <ChevronDown size={13} aria-hidden />
        </button>
      )}
    >
      {(cerrar) => (
        <Selector
          placeholder="Prioridad…"
          elegidas={[valor]}
          opciones={PRIORIDADES.map((x) => ({ id: x.id, etiqueta: x.nombre, icono: <IconoPrioridad prioridad={x.id} /> }))}
          alElegir={(id) => {
            alElegir(id as Prioridad)
            cerrar()
          }}
        />
      )}
    </Desplegable>
  )
}

export function PildoraEtiquetas({
  elegidas,
  nuevas,
  alAlternar,
  alQuitarNueva,
  alCrear,
  alCerrar,
}: {
  /** Ids de las del proyecto que están elegidas. */
  elegidas: string[]
  nuevas: string[]
  alAlternar: (id: string) => void
  alQuitarNueva: (nombre: string) => void
  alCrear: (nombre: string) => void
  alCerrar?: () => void
}) {
  const c = useCierre(alCerrar)
  const etiquetas = useTienda((s) => s.tablero?.etiquetas ?? [])
  const total = elegidas.length + nuevas.length
  return (
    <Desplegable
      {...c}
      ancho={280}
      disparador={(p) => (
        <button {...p} type="button" className="pildora alta__pildora" aria-label={total ? `Etiquetas: ${total} elegidas` : 'Etiquetas'}>
          <Tag size={14} aria-hidden />
          <span className={total ? undefined : 'alta__vacio'}>{total === 0 ? 'Etiquetas' : total === 1 ? '1 etiqueta' : `${total} etiquetas`}</span>
          <ChevronDown size={13} aria-hidden />
        </button>
      )}
    >
      {() => (
        <Selector
          multiple
          placeholder="Buscar o crear etiqueta…"
          elegidas={[...elegidas, ...nuevas.map((n) => `nueva:${n}`)]}
          opciones={[
            ...ordenadas(etiquetas).map((e) => ({
              id: e.id,
              etiqueta: e.nombre,
              icono: <span className="punto" style={{ background: `var(--e-${e.color}-s)` }} />,
              grupo: e.grupo === 'tipo' ? 'Tipo (Discord)' : e.grupo === 'area' ? 'Áreas' : 'Etiquetas',
            })),
            ...nuevas.map((n) => ({
              id: `nueva:${n}`,
              etiqueta: n,
              icono: <span className="punto" style={{ background: 'var(--e-gris-s)' }} />,
              detalle: 'nueva',
              grupo: 'Se crean al agregar',
            })),
          ]}
          alElegir={(id) => (id.startsWith('nueva:') ? alQuitarNueva(id.slice(6)) : alAlternar(id))}
          crear={{ etiqueta: (q) => `Crear etiqueta «${q}»`, alCrear }}
        />
      )}
    </Desplegable>
  )
}

const ordenadas = (etiquetas: Etiqueta[]) =>
  [...etiquetas].sort((a, b) => (a.grupo === 'tipo' ? 1 : 0) - (b.grupo === 'tipo' ? 1 : 0))

/** Las etiquetas elegidas, a la vista. Las elegidas con el selector se sacan con un toque; las del texto, editando el texto. */
export function EtiquetasElegidas({ etiquetas, alQuitar }: { etiquetas: EtiquetaAlta[]; alQuitar: (e: EtiquetaAlta) => void }) {
  if (etiquetas.length === 0) return null
  return (
    <ul className="alta__etiquetas" aria-label="Etiquetas de la tarjeta">
      {etiquetas.map((e) => (
        <li key={e.clave}>
          {e.deTexto ? (
            <span className="alta__etiqueta" title="Viene de lo que escribiste en el título (#): se saca borrándola del texto">
              <ChipEtiqueta etiqueta={{ id: e.clave, proyectoId: '', nombre: e.nueva ? `${e.nombre} · nueva` : e.nombre, color: e.color, grupo: null, orden: '' }} chica />
            </span>
          ) : (
            <button type="button" className="alta__etiqueta alta__etiqueta--quitar" onClick={() => alQuitar(e)} aria-label={`Quitar la etiqueta ${e.nombre}`}>
              <ChipEtiqueta etiqueta={{ id: e.clave, proyectoId: '', nombre: e.nueva ? `${e.nombre} · nueva` : e.nombre, color: e.color, grupo: null, orden: '' }} chica />
              <X size={11} strokeWidth={2.6} aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
