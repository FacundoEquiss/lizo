// La barra de la forma (5.4): `[Forma ▾] | [Relleno ▾] [Borde ▾] [Opacidad ▾] | [Fuente ▾] [− 16 +] [B] [I] [U] [S] |
// [Color de texto ▾] [Alineación ▾] | [⋯]`. Con varias formas elegidas, cada cambio va a todas en un solo paso, y el
// estilo usado queda de fábrica para la próxima forma (si "Recordar el último estilo" está prendido).
import { Blend, Shapes } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ICONOS, type IdIcono } from '../../../../../compartido/iconos'
import { FORMAS, GUIONES, leerForma, type TipoForma } from '../../../../../compartido/lienzo'
import type { Color, ElementoLienzo, Guion } from '../../../../../compartido/tipos'
import { usePreferencias } from '../../../estado/preferencias'
import { useTienda } from '../../../estado/tienda'
import { ICONOS_LUCIDE } from '../nodos/iconos'
import { MiniForma } from '../paneles/Herramientas'
import { cambiarDatos, useSeleccionLienzo } from '../seleccion'
import { useEditorActivo } from '../texto/editorActivo'
import { MenuBarra, Muestra, Separador, type TamBarra } from './piezas'
import { SeccionAlineacion, SeccionColorTexto, SeccionEnlace, SeccionMarcas, SelectorFuente, SelectorTamano } from './seccionTexto'
import { SelectorColor } from './SelectorColor'

const GROSORES_BORDE = [1, 2, 4] as const

function useFormas(elementos?: ElementoLienzo[]) {
  const sel = useSeleccionLienzo()
  return (elementos ?? sel.nodos).filter((e) => e.tipo === 'forma' && !e.bloqueado)
}

/** Las 13 formas en una grilla de 5 columnas. Cambiar de forma conserva el texto, el estilo, el tamaño y los conectores. */
export function SelectorForma({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useFormas(elementos)
  if (!els.length) return null
  const actual = leerForma(els[0]!.datos).forma
  return (
    <MenuBarra etiqueta="Forma" tam={tam} disparador={<MiniForma forma={actual} tam={18} />}>
      {(cerrar) => (
        <div className="grilla-formas" role="listbox" aria-label="Forma">
          {FORMAS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="option"
              aria-selected={actual === f.id}
              className={`grilla-formas__boton${actual === f.id ? ' grilla-formas__boton--activa' : ''}`}
              onClick={() => {
                cambiarForma(els, f.id)
                cerrar()
              }}
              aria-label={`${f.nombre}: ${f.uso}`}
              data-tip={`${f.nombre} · ${f.uso}`}
            >
              <MiniForma forma={f.id} tam={24} />
            </button>
          ))}
        </div>
      )}
    </MenuBarra>
  )
}

function cambiarForma(els: ElementoLienzo[], forma: TipoForma) {
  // Se escribe también el relleno actual: así el objeto deja de leerse como de la 0.1 (que no tenía relleno guardado).
  void useTienda.getState().actualizarElementos(
    els.map((e) => ({ id: e.id, datos: { forma, relleno: leerForma(e.datos).relleno } })),
    { registrar: 'cambiar forma' },
  )
  usePreferencias.getState().recordar('forma', { forma })
}

/** Dos o tres opciones excluyentes, en una píldora (Suave / Fuerte). */
function Conmutador<T extends string | number>({
  opciones,
  valor,
  alCambiar,
  etiqueta,
}: {
  opciones: { id: T; nombre: string; contenido?: ReactNode }[]
  valor: T
  alCambiar: (v: T) => void
  etiqueta: string
}) {
  return (
    <div className="conmutador" role="radiogroup" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={valor === o.id}
          aria-label={o.contenido ? o.nombre : undefined}
          data-tip={o.contenido ? o.nombre : undefined}
          className={`conmutador__opcion${valor === o.id ? ' conmutador__opcion--activa' : ''}`}
          onClick={() => alCambiar(o.id)}
        >
          {o.contenido ?? o.nombre}
        </button>
      ))}
    </div>
  )
}

/** Relleno: los 10 colores o ninguno, en tono suave o fuerte. */
export function SeccionRelleno({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useFormas(elementos)
  if (!els.length) return null
  const d = leerForma(els[0]!.datos)
  const variable = d.tono === 'fuerte' ? '--e-s' : '--e'
  return (
    <MenuBarra etiqueta="Relleno" tam={tam} disparador={<Muestra color={d.relleno} variable={variable} />}>
      {(cerrar) => (
        <SelectorColor
          valor={d.relleno}
          variable={variable}
          conNinguno="Sin relleno"
          conBlanco={{
            activo: (d.relleno as string) === 'blanco',
            alElegir: () => {
              cambiarDatos(els, { relleno: 'blanco' }, 'relleno blanco')
              cerrar()
            },
          }}
          tam={tam}
          alElegir={(c) => {
            cambiarDatos(els, { relleno: c }, c === 'ninguno' ? 'sacar el relleno' : 'cambiar el relleno')
            cerrar()
          }}
          extra={
            <Conmutador
              etiqueta="Tono"
              valor={d.tono}
              opciones={[
                { id: 'suave', nombre: 'Suave' },
                { id: 'fuerte', nombre: 'Fuerte' },
              ]}
              alCambiar={(t) => cambiarDatos(els, { tono: t, ...(d.relleno === 'ninguno' ? { relleno: 'azul' } : {}) }, 'cambiar el tono')}
            />
          }
        />
      )}
    </MenuBarra>
  )
}

/** La línea de muestra de un grosor o un estilo de borde. */
function LineaBorde({ grosor, estilo }: { grosor: number; estilo: Guion }) {
  const dash = estilo === 'rayado' ? `${3 * grosor} ${2 * grosor}` : estilo === 'punteado' ? `${0.5 * grosor} ${2.5 * grosor}` : undefined
  return (
    <svg width={30} height={12} viewBox="0 0 30 12" aria-hidden>
      <line x1={3} y1={6} x2={27} y2={6} stroke="currentColor" strokeWidth={grosor} strokeDasharray={dash} strokeLinecap={estilo === 'punteado' ? 'round' : 'butt'} />
    </svg>
  )
}

/** El dibujo del botón de borde: un cuadrado con el color, el grosor y el estilo del borde. */
function IconoBorde({ color, grosor, estilo }: { color: Color | 'ninguno'; grosor: number; estilo: Guion }) {
  const g = Math.min(grosor, 3)
  const dash = estilo === 'rayado' ? `${2.5 * g} ${1.6 * g}` : estilo === 'punteado' ? `${0.4 * g} ${2 * g}` : undefined
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden className="icono-borde">
      <rect
        x={2.5}
        y={2.5}
        width={13}
        height={13}
        rx={3.5}
        fill="none"
        stroke={color === 'ninguno' ? 'currentColor' : `var(--e-${color}-s)`}
        strokeOpacity={color === 'ninguno' ? 0.35 : 1}
        strokeWidth={color === 'ninguno' ? 1.5 : g}
        strokeDasharray={color === 'ninguno' ? '2 2' : dash}
        strokeLinecap={estilo === 'punteado' ? 'round' : 'butt'}
      />
    </svg>
  )
}

/** Borde: color (o ninguno), grosor 1, 2 o 4 y estilo sólido, rayado o punteado. */
export function SeccionBorde({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useFormas(elementos)
  if (!els.length) return null
  const d = leerForma(els[0]!.datos)
  // Elegir grosor o estilo sin borde pone un borde gris (si no, no se vería el cambio).
  const conColor = d.borde === 'ninguno' ? { borde: 'gris' } : {}
  return (
    <MenuBarra etiqueta="Borde" tam={tam} disparador={<IconoBorde color={d.borde} grosor={d.bordeGrosor} estilo={d.bordeEstilo} />}>
      {(cerrar) => (
        <SelectorColor
          valor={d.borde}
          variable="--e-s"
          conNinguno="Sin borde"
          tam={tam}
          alElegir={(c) => {
            cambiarDatos(els, { borde: c }, c === 'ninguno' ? 'sacar el borde' : 'cambiar el borde')
            cerrar()
          }}
          extra={
            <div className="opciones-borde">
              <Conmutador
                etiqueta="Grosor"
                valor={d.bordeGrosor}
                opciones={GROSORES_BORDE.map((g) => ({ id: g, nombre: `${g} px`, contenido: <LineaBorde grosor={g} estilo="solido" /> }))}
                alCambiar={(g) => cambiarDatos(els, { bordeGrosor: g, ...conColor }, 'grosor del borde')}
              />
              <Conmutador
                etiqueta="Estilo"
                valor={d.bordeEstilo}
                opciones={GUIONES.map((g) => ({ id: g.id, nombre: g.nombre, contenido: <LineaBorde grosor={2} estilo={g.id} /> }))}
                alCambiar={(g) => cambiarDatos(els, { bordeEstilo: g, ...conColor }, 'estilo del borde')}
              />
            </div>
          }
        />
      )}
    </MenuBarra>
  )
}

/**
 * El deslizador de la opacidad (10 a 100 %). Mientras se mueve, el cambio es solo en pantalla (una vez por cuadro);
 * al soltar se guarda en un paso, que al deshacer vuelve a la opacidad de antes de tocarlo.
 */
function DeslizadorOpacidad({ els }: { els: ElementoLienzo[] }) {
  const [valor, setValor] = useState(() => Math.round(leerForma(els[0]!.datos).opacidad * 100))
  const ultimo = useRef(valor)
  const originales = useRef<Map<string, number> | null>(null)
  const cuadro = useRef(0)
  const ids = els.map((e) => e.id)
  const empezar = () => {
    if (!originales.current) originales.current = new Map(els.map((e) => [e.id, leerForma(e.datos).opacidad]))
  }
  const terminar = () => {
    const antes = originales.current
    if (!antes) return
    originales.current = null
    cancelAnimationFrame(cuadro.current)
    const tienda = useTienda.getState()
    // Primero vuelve lo de antes (sin guardar) y después va el cambio: así "deshacer" vuelve a donde estaba.
    void tienda.actualizarElementos(
      ids.map((id) => ({ id, datos: { opacidad: antes.get(id) } })),
      { local: true },
    )
    const actuales = (tienda.tablero?.elementos ?? []).filter((e) => antes.has(e.id))
    if ([...antes.values()].every((o) => Math.round(o * 100) === ultimo.current)) return
    cambiarDatos(actuales, { opacidad: ultimo.current / 100 }, 'cambiar la opacidad')
  }
  // Si el menú se cierra en medio (Esc, clic afuera), lo movido se guarda igual.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => terminar(), [])
  return (
    <div className="deslizador">
      <input
        type="range"
        className="deslizador__control"
        min={10}
        max={100}
        step={1}
        value={valor}
        aria-label="Opacidad"
        aria-valuetext={`${valor} %`}
        onPointerDown={empezar}
        onChange={(ev) => {
          const v = Number(ev.target.value)
          empezar()
          setValor(v)
          ultimo.current = v
          cancelAnimationFrame(cuadro.current)
          cuadro.current = requestAnimationFrame(
            () => void useTienda.getState().actualizarElementos(
              ids.map((id) => ({ id, datos: { opacidad: v / 100 } })),
              { local: true },
            ),
          )
        }}
        onPointerUp={terminar}
        onKeyUp={terminar}
        onBlur={terminar}
        style={{ ['--valor' as string]: `${((valor - 10) / 90) * 100}%` }}
      />
      <span className="deslizador__valor">{valor} %</span>
    </div>
  )
}

/** Opacidad del relleno y el borde (el texto queda entero). */
export function SeccionOpacidad({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useFormas(elementos)
  if (!els.length) return null
  const o = Math.round(leerForma(els[0]!.datos).opacidad * 100)
  return (
    <MenuBarra etiqueta={`Opacidad: ${o} %`} tam={tam} disparador={<Blend size={16} />} ancho={236}>
      {() => <DeslizadorOpacidad els={els} />}
    </MenuBarra>
  )
}

/** El ícono de la forma: una grilla con los del catálogo, por grupo, y «Sin ícono». Cambia en un solo paso para todas las elegidas. */
export function SeccionIcono({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useFormas(elementos)
  const [filtro, setFiltro] = useState('')
  if (!els.length) return null
  const d = leerForma(els[0]!.datos)
  const Actual = d.icono ? ICONOS_LUCIDE[d.icono as IdIcono] : null
  const q = filtro.trim().toLowerCase()
  const lista = ICONOS.filter((i) => !q || i.nombre.toLowerCase().includes(q) || i.id.includes(q) || i.grupo.toLowerCase().includes(q))
  return (
    <MenuBarra etiqueta="Ícono" tam={tam} disparador={Actual ? <Actual size={16} /> : <Shapes size={16} />} ancho={300}>
      {(cerrar) => (
        <div className="selector-icono" role="group" aria-label="Ícono">
          <input className="selector-icono__buscar" placeholder="Buscar un ícono…" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar un ícono" />
          <div className="selector-icono__acciones">
            <button type="button" className="boton boton--chico" disabled={!d.icono} onClick={() => (cambiarDatos(els, { icono: null }, 'sacar el ícono'), cerrar())}>
              Sin ícono
            </button>
            {d.icono && (
              <button
                type="button"
                className="boton boton--chico"
                onClick={() => cambiarDatos(els, { iconoPosicion: d.iconoPosicion === 'arriba' ? 'izquierda' : 'arriba' }, 'posición del ícono')}
              >
                {d.iconoPosicion === 'arriba' ? 'Pasarlo a la izquierda' : 'Pasarlo arriba'}
              </button>
            )}
          </div>
          <div className="selector-icono__grilla" role="listbox" aria-label="Íconos">
            {lista.map((i) => {
              const C = ICONOS_LUCIDE[i.id]
              return (
                <button
                  key={i.id}
                  type="button"
                  role="option"
                  aria-selected={d.icono === i.id}
                  aria-label={i.nombre}
                  data-tip={`${i.nombre} · ${i.grupo}`}
                  className={`selector-icono__boton${d.icono === i.id ? ' selector-icono__boton--activo' : ''}`}
                  onClick={() => (cambiarDatos(els, { icono: i.id }, 'poner un ícono'), cerrar())}
                >
                  <C size={18} />
                </button>
              )
            })}
            {!lista.length && <p className="selector-icono__vacio">No hay íconos con «{filtro}».</p>}
          </div>
        </div>
      )}
    </MenuBarra>
  )
}

/** La barra completa de la forma. El enlace aparece mientras se escribe (Ctrl/⌘ + K). */
export function SeccionForma({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useFormas(elementos)
  const escribiendo = useEditorActivo((s) => !!s.id && els.some((e) => e.id === s.id))
  if (!els.length) return null
  return (
    <>
      <SelectorForma elementos={els} tam={tam} />
      <Separador />
      <SeccionRelleno elementos={els} tam={tam} />
      <SeccionIcono elementos={els} tam={tam} />
      <SeccionBorde elementos={els} tam={tam} />
      <SeccionOpacidad elementos={els} tam={tam} />
      <Separador />
      <SelectorFuente elementos={els} tam={tam} />
      <SelectorTamano elementos={els} tam={tam} conAuto />
      <Separador />
      <SeccionMarcas elementos={els} tam={tam} />
      <Separador />
      <SeccionColorTexto elementos={els} tam={tam} />
      <SeccionAlineacion elementos={els} tam={tam} vertical />
      {escribiendo && <SeccionEnlace elementos={els} tam={tam} />}
    </>
  )
}
