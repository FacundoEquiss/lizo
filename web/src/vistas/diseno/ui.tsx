// Piezas chicas de la interfaz de Diseño (plan 8.3: Interruptor y SelectorColor no existen todavía en Telar; se hacen
// mínimas acá). Todas usan los tokens de tokens.css por variables.
import { Check, Copy, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { aHex, aRgb, normalizarColor } from '../../../../compartido/diseno/tokens'
import type { DatosToken, ItemDiseno } from '../../../../compartido/diseno/tipos'
import { avisar } from '../../estado/avisos'
import { Desplegable } from '../../ui/Desplegable'

/** Copia y avisa "Copiado". */
export async function copiar(texto: string, aviso = 'Copiado') {
  try {
    await navigator.clipboard.writeText(texto)
    avisar({ texto: aviso, tipo: 'ok', duracion: 1600 })
  } catch {
    avisar({ texto: 'No pude copiar: el navegador no dio permiso.', tipo: 'error' })
  }
}

export function Seccion({ titulo, accion, children }: { titulo: string; accion?: ReactNode; children: ReactNode }) {
  return (
    <section className="dz-isec">
      <header className="dz-isec__cab">
        <h3 className="dz-isec__titulo">{titulo}</h3>
        {accion}
      </header>
      {children}
    </section>
  )
}

/** Una fila del inspector: etiqueta de 84 px y valor. Si tiene `copia`, un clic copia el valor (destello de 600 ms). */
export function Fila({ etiqueta, copia, mono, children, ayuda }: { etiqueta: string; copia?: string; mono?: boolean; children: ReactNode; ayuda?: string }) {
  const [destello, setDestello] = useState(0)
  const contenido = (
    <span className={`dz-fila__valor${mono ? ' dz-fila__valor--mono' : ''}`} title={ayuda}>
      {children}
    </span>
  )
  return (
    <div className="dz-fila">
      <span className="dz-fila__etiqueta">{etiqueta}</span>
      {copia ? (
        <button
          type="button"
          key={destello}
          className={`dz-fila__copiar${destello ? ' dz-fila__copiar--destello' : ''}`}
          onClick={() => {
            void copiar(copia)
            setDestello(Date.now())
          }}
          title={`Copiar ${copia}`}
        >
          {contenido}
          <Copy size={12} className="dz-fila__icono-copiar" aria-hidden />
        </button>
      ) : (
        contenido
      )}
    </div>
  )
}

export function Interruptor({ valor, alCambiar, etiqueta, apagado }: { valor: boolean; alCambiar: (v: boolean) => void; etiqueta: string; apagado?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={valor}
      aria-label={etiqueta}
      disabled={apagado}
      className={`dz-interruptor${valor ? ' dz-interruptor--si' : ''}`}
      onClick={() => alCambiar(!valor)}
    >
      <span className="dz-interruptor__bola" />
    </button>
  )
}

/** Campo numérico: flechas ±1 (Mayús ±10), Enter o salir confirma, Esc vuelve. */
export function CampoNumero({
  valor,
  alCambiar,
  min,
  max,
  sufijo,
  etiqueta,
  apagado,
  paso = 1,
}: {
  valor: number
  alCambiar: (v: number) => void
  min?: number
  max?: number
  sufijo?: string
  etiqueta: string
  apagado?: boolean
  paso?: number
}) {
  const [texto, setTexto] = useState(String(redondear(valor)))
  const enfocado = useRef(false)
  useEffect(() => {
    if (!enfocado.current) setTexto(String(redondear(valor)))
  }, [valor])
  const limitar = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
  const confirmar = (t: string) => {
    const n = Number(t.replace(',', '.'))
    if (!Number.isFinite(n)) return setTexto(String(redondear(valor)))
    const v = limitar(n)
    setTexto(String(redondear(v)))
    if (v !== valor) alCambiar(v)
  }
  return (
    <label className={`dz-num${apagado ? ' dz-num--apagado' : ''}`}>
      <span className="dz-num__etiqueta">{etiqueta}</span>
      <input
        className="dz-num__campo"
        inputMode="decimal"
        value={texto}
        disabled={apagado}
        aria-label={etiqueta}
        onFocus={(e) => {
          enfocado.current = true
          e.currentTarget.select()
        }}
        onBlur={(e) => {
          enfocado.current = false
          confirmar(e.currentTarget.value)
        }}
        onChange={(e) => setTexto(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            confirmar(e.currentTarget.value)
            e.currentTarget.select()
          } else if (e.key === 'Escape') {
            setTexto(String(redondear(valor)))
            e.currentTarget.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const n = Number(texto.replace(',', '.')) || 0
            const v = limitar(n + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * paso)
            setTexto(String(redondear(v)))
            alCambiar(v)
          }
        }}
      />
      {sufijo && <span className="dz-num__sufijo">{sufijo}</span>}
    </label>
  )
}

const redondear = (n: number) => Math.round(n * 100) / 100

export function Muestra({ color, tam = 20 }: { color: string; tam?: number }) {
  return <span className="dz-muestra" style={{ width: tam, height: tam, ['--dz-muestra' as string]: color }} aria-hidden />
}

/**
 * Selector de color: los tokens del proyecto primero (se escribe `var(--x)`), después un campo hexadecimal y el selector del
 * sistema. Devuelve el valor tal cual va al CSS.
 */
export function SelectorColor({
  valor,
  alCambiar,
  tokens,
  etiqueta = 'Color',
}: {
  valor: string
  alCambiar: (v: string | null) => void
  tokens: ItemDiseno[]
  etiqueta?: string
}) {
  const colores = useMemo(
    () =>
      tokens
        .filter((t) => (t.datos as DatosToken).clase === 'color' && !(t.datos as DatosToken).suelto && (t.datos as DatosToken).css)
        .map((t) => ({ item: t, d: t.datos as DatosToken })),
    [tokens],
  )
  const [hex, setHex] = useState('')
  const [filtro, setFiltro] = useState('')
  const rgb = aRgb(valor)
  const hexActual = rgb ? aHex(rgb) : ''
  useEffect(() => setHex(hexActual), [hexActual])
  const visibles = filtro ? colores.filter((c) => (c.item.nombre + c.d.css + c.d.valor).toLowerCase().includes(filtro.toLowerCase())) : colores
  const token = /var\((--[\w-]+)\)/.exec(valor)?.[1]
  // la muestra se pinta con el valor del token (la variable no existe en la página de Telar, solo adentro del marco)
  const muestra = token ? (colores.find((c) => c.d.css === token)?.d.valor ?? valor) : valor
  return (
    <Desplegable
      lado="left-start"
      ancho={264}
      disparador={(p) => (
        <button {...p} type="button" className="dz-color-boton" aria-label={`${etiqueta}: ${valor || 'sin color'}`}>
          <Muestra color={muestra || 'transparent'} />
          <span className="dz-color-boton__texto">{token ?? (hexActual || valor || 'Sin color')}</span>
        </button>
      )}
    >
      {(cerrar) => (
        <div className="diseno">
        <div className="dz-selector-color">
          {colores.length > 0 && (
            <>
              <input className="campo dz-selector-color__buscar" placeholder="Buscar un color del proyecto…" value={filtro} onChange={(e) => setFiltro(e.currentTarget.value)} />
              <div className="dz-selector-color__tokens" role="listbox" aria-label="Colores del proyecto">
                {visibles.slice(0, 120).map(({ item, d }) => {
                  const v = `var(${d.css})`
                  return (
                    <button
                      key={item.clave}
                      type="button"
                      role="option"
                      aria-selected={valor === v}
                      className={`dz-selector-color__token${valor === v ? ' dz-selector-color__token--activo' : ''}`}
                      title={`${item.nombre} · ${d.css} · ${d.valor}`}
                      onClick={() => {
                        alCambiar(v)
                        cerrar()
                      }}
                    >
                      <Muestra color={d.valor} tam={22} />
                      {valor === v && <Check size={12} className="dz-selector-color__ok" />}
                    </button>
                  )
                })}
              </div>
            </>
          )}
          <div className="dz-selector-color__fila">
            <input
              type="color"
              className="dz-selector-color__sistema"
              value={hexActual.slice(0, 7) || '#000000'}
              onChange={(e) => alCambiar(e.currentTarget.value)}
              aria-label="Elegir con el selector del sistema"
            />
            <input
              className="campo dz-selector-color__hex"
              value={hex}
              spellCheck={false}
              aria-label="Valor hexadecimal"
              onChange={(e) => setHex(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const n = normalizarColor(hex)
                if (n) {
                  alCambiar(n)
                  cerrar()
                }
              }}
            />
            <button type="button" className="boton boton--chico boton--fantasma" onClick={() => (alCambiar(null), cerrar())}>
              Quitar
            </button>
          </div>
        </div>
        </div>
      )}
    </Desplegable>
  )
}

export function EstadoVacio({ icono, titulo, ayuda, children }: { icono: ReactNode; titulo: string; ayuda?: ReactNode; children?: ReactNode }) {
  return (
    <div className="dz-vacio">
      <span className="dz-vacio__icono">{icono}</span>
      <p className="dz-vacio__titulo">{titulo}</p>
      {ayuda && <p className="dz-vacio__ayuda">{ayuda}</p>}
      {children && <div className="dz-vacio__acciones">{children}</div>}
    </div>
  )
}

/** "Fredoka, sans-serif" → "Fredoka" */
export const primeraFamilia = (v: string) => v.split(',')[0]!.trim().replace(/^["']|["']$/g, '')

/** "rgb(56, 189, 230)" → "#38bde6" (o el valor tal cual). */
export function colorLegible(v: string): string {
  const rgb = aRgb(v)
  return rgb ? aHex(rgb) : v
}

export function ComoImportar() {
  return (
    <div className="dz-explica">
      <p>
        <Sparkles size={14} /> La importación la hace Claude, leyendo el código del proyecto.
      </p>
      <p>
        Pedile a Claude: <em>«importá el diseño de este proyecto a Telar»</em>.
      </p>
      <p>Trae los colores, las letras, los íconos, los textos y, si puede abrir la interfaz en un navegador, las pantallas.</p>
    </div>
  )
}

/** Los mensajes del servidor nombran las herramientas del MCP (son para Claude): en la web se dicen con la interfaz. */
export function paraPersonas(mensaje: string): string {
  return mensaje
    .replace(/Subila primero con subir_activo y usá la ruta que devuelve \(\/archivos\/diseno\/…\)/g, 'Subila primero en Piezas → Activos (Subir) y elegila de ahí')
    .replace(/Subila con subir_activo y usá la ruta/g, 'Subila en Piezas → Activos (Subir)')
    .replace(/las que devuelve subir_activo/g, 'las de los activos subidos')
    .replace(/subir_activo/g, 'Piezas → Activos (Subir)')
    .replace(/duplicar_marco/g, '"Hacer una copia editable"')
}
