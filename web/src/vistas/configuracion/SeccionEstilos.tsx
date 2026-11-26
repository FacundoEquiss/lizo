// Configuración → Estilos de fábrica (de este dispositivo). Con "Recordar el último estilo" prendido, cada objeto nuevo
// sale como el último que se tocó; apagado, valen siempre los de esta pantalla. Una fila por tipo, con una miniatura en
// vivo dibujada con los mismos colores y trazos del lienzo.
import { ChevronDown, Minus, RotateCcw, Spline, Waypoints } from 'lucide-react'
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import {
  ESTILOS_FABRICA,
  FORMAS,
  FUENTES,
  GROSORES,
  GUIONES,
  NOMBRES_COLOR,
  PUNTAS,
  TAMANOS_LETRA,
  TRAZOS,
  type EstilosFabrica,
  type Fuente,
  type RellenoMarco,
  type TipoForma,
} from '../../../../compartido/lienzo'
import type { Color, Guion, Punta as TipoPunta, Trazo } from '../../../../compartido/tipos'
import { usePreferencias } from '../../estado/preferencias'
import { Interruptor } from '../../ui/comunes'
import { Desplegable } from '../../ui/Desplegable'
import { colorCss, type VariableColor } from '../lienzo/barra/piezas'
import { SelectorColor } from '../lienzo/barra/SelectorColor'
import { MuestraPunta, Punta, retroceso } from '../lienzo/conectores/Punta'
import { detalleForma, trazoForma } from '../lienzo/nodos/formas'
import { cargarFuente, cargarTodas } from '../lienzo/texto/fuentes'
import { Fila, Grupo } from './piezas'

type Tipo = keyof EstilosFabrica

const RELLENOS_MARCO: { id: RellenoMarco; nombre: string }[] = [
  { id: 'tinte', nombre: 'Tinte' },
  { id: 'tenue', nombre: 'Tenue' },
  { id: 'liso', nombre: 'Liso' },
]

const ICONOS_TRAZO: Record<Trazo, ReactNode> = {
  curvo: <Spline size={15} />,
  ortogonal: <Waypoints size={15} />,
  recto: <Minus size={15} style={{ rotate: '-35deg' }} />,
}

const nombreFuente = (f: Fuente) => FUENTES.find((x) => x.id === f)?.nombre ?? 'Sans'
const nombreColor = (c: Color | 'ninguno' | 'auto' | null, ninguno = 'Ninguno') => (!c || c === 'ninguno' ? ninguno : c === 'auto' ? 'Automático' : NOMBRES_COLOR[c])

/** El mismo patrón de guiones que los conectores del lienzo (`patronLinea`), sin traer el lienzo entero. */
function guiones(guion: Guion, grosor: number): { dasharray?: string; linecap: 'round' | 'butt' } {
  if (guion === 'rayado') return { dasharray: `${4 * grosor} ${3 * grosor}`, linecap: 'butt' }
  if (guion === 'punteado') return { dasharray: `${0.5 * grosor} ${3 * grosor}`, linecap: 'round' }
  return { linecap: 'round' }
}

const iguales = (a: EstilosFabrica, b: EstilosFabrica) =>
  (Object.keys(b) as Tipo[]).every((t) => Object.entries(b[t]).every(([k, v]) => (a[t] as Record<string, unknown>)[k] === v))

// ───────── controles ─────────

/** Un ajuste chico de la fila: "Fuente Sans ▾"; abre su menú abajo. */
function Opcion({
  que,
  texto,
  muestra,
  ancho,
  alAbrir,
  enfocarInicial,
  children,
}: {
  que: string
  texto: string
  muestra?: ReactNode
  ancho?: number
  alAbrir?: () => void
  enfocarInicial?: number
  children: (cerrar: () => void) => ReactNode
}) {
  return (
    <Desplegable
      lado="bottom-start"
      ancho={ancho}
      className="menu-barra"
      enfocarInicial={enfocarInicial}
      disparador={(p) => (
        <button
          {...p}
          type="button"
          className="estilo-opcion"
          aria-label={`${que}: ${texto}`}
          onPointerEnter={alAbrir}
          onFocus={alAbrir}
        >
          <span className="estilo-opcion__que">{que}</span>
          {muestra}
          <span className="estilo-opcion__valor">{texto}</span>
          <ChevronDown size={12} className="estilo-opcion__flecha" />
        </button>
      )}
    >
      {children}
    </Desplegable>
  )
}

/** Una lista de opciones de un menú, con la elegida marcada. */
function Lista<T extends string | number>({
  etiqueta,
  opciones,
  valor,
  alElegir,
  cerrar,
}: {
  etiqueta: string
  opciones: { id: T; nombre: string; icono?: ReactNode; estilo?: CSSProperties }[]
  valor: T
  alElegir: (v: T) => void
  cerrar: () => void
}) {
  return (
    <div className="menu__lista" role="listbox" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="option"
          aria-selected={valor === o.id}
          className={`menu__item${valor === o.id ? ' menu__item--activo' : ''}`}
          style={o.estilo}
          onClick={() => {
            alElegir(o.id)
            cerrar()
          }}
        >
          {o.icono && <span className="menu__icono menu__icono--ancho">{o.icono}</span>}
          <span className="menu__texto">{o.nombre}</span>
        </button>
      ))}
    </div>
  )
}

function MuestraColor({ color, variable }: { color: Color | 'ninguno' | 'auto' | null; variable: VariableColor }) {
  // Automático: la tinta de siempre (oscura en claro, clara en oscuro); ninguno: tachado.
  if (color === 'auto') return <span className="estilo-opcion__muestra" style={{ background: 'var(--c-texto)' }} aria-hidden />
  if (!color || color === 'ninguno') return <span className="estilo-opcion__muestra estilo-opcion__muestra--vacia" aria-hidden />
  return <span className="estilo-opcion__muestra" style={{ background: colorCss(variable, color) }} aria-hidden />
}

function OpcionColor({
  que,
  valor,
  variable,
  alElegir,
  conNinguno,
  conAuto,
}: {
  que: string
  valor: Color | 'ninguno' | 'auto' | null
  variable: VariableColor
  alElegir: (c: Color | 'ninguno' | 'auto') => void
  conNinguno?: string
  conAuto?: string
}) {
  return (
    <Opcion que={que} texto={nombreColor(valor, conNinguno)} muestra={<MuestraColor color={valor} variable={variable} />}>
      {(cerrar) => (
        <SelectorColor
          valor={valor}
          variable={variable}
          conNinguno={conNinguno}
          conAuto={conAuto}
          alElegir={(c) => {
            alElegir(c)
            cerrar()
          }}
        />
      )}
    </Opcion>
  )
}

function OpcionFuente({ valor, alElegir }: { valor: Fuente; alElegir: (f: Fuente) => void }) {
  return (
    <Opcion
      que="Fuente"
      texto={nombreFuente(valor)}
      ancho={200}
      alAbrir={() => void cargarTodas()}
      enfocarInicial={Math.max(0, FUENTES.findIndex((f) => f.id === valor))}
    >
      {(cerrar) => (
        <Lista<Fuente>
          etiqueta="Fuente"
          valor={valor}
          alElegir={alElegir}
          cerrar={cerrar}
          opciones={FUENTES.map((f) => ({ id: f.id, nombre: f.nombre, estilo: { fontFamily: `var(--f-${f.id})`, fontSize: f.id === 'mano' ? 17 : undefined } }))}
        />
      )}
    </Opcion>
  )
}

// ───────── miniaturas (lo que sale al crear) ─────────

function MiniNota({ e }: { e: EstilosFabrica['nota'] }) {
  return (
    <span className="estilo-mini" aria-hidden>
      <span className="estilo-mini__nota" style={{ background: `var(--n-${e.color})`, fontFamily: `var(--f-${e.fuente})` }}>
        Aa
      </span>
    </span>
  )
}

function MiniTexto({ e }: { e: EstilosFabrica['texto'] }) {
  // A la mitad de su tamaño real (el de 128 no entraría): se ve la diferencia entre uno chico y un título.
  const px = Math.round(Math.min(40, Math.max(10, (e.tamano === 'auto' ? 21 : e.tamano) * 0.62)))
  return (
    <span className="estilo-mini" aria-hidden>
      <span
        className="estilo-mini__texto"
        style={{
          fontFamily: `var(--f-${e.fuente})`,
          fontSize: px,
          color: e.colorTexto === 'auto' ? 'var(--c-texto)' : `var(--tinta-${e.colorTexto})`,
          fontWeight: px >= 18 ? 700 : 560,
        }}
      >
        Texto
      </span>
    </span>
  )
}

function MiniForma({ e }: { e: EstilosFabrica['forma'] }) {
  const w = 76
  const h = 48
  const conRelleno = e.relleno !== 'ninguno'
  // Las mismas reglas que la forma del lienzo: sin relleno ni borde lleva un borde gris de 2.
  const borde = e.borde !== 'ninguno' ? e.borde : conRelleno ? null : 'gris'
  const g = !borde ? 0 : e.borde === 'ninguno' ? 2 : e.bordeGrosor
  const p = guiones(e.borde === 'ninguno' ? 'solido' : e.bordeEstilo, Math.max(1, g))
  const relleno = !conRelleno ? 'none' : e.tono === 'fuerte' ? `var(--e-${e.relleno}-s)` : `var(--e-${e.relleno})`
  const colorBorde = borde ? `var(--e-${borde}-s)` : 'none'
  const detalle = detalleForma(e.forma, w - g, h - g)
  return (
    <span className="estilo-mini" aria-hidden>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={conRelleno ? 'estilo-mini__forma estilo-mini__forma--relleno' : 'estilo-mini__forma'}>
        <g transform={g ? `translate(${g / 2} ${g / 2})` : undefined}>
          <path d={trazoForma(e.forma, w - g, h - g)} fill={relleno} stroke={colorBorde} strokeWidth={g || undefined} strokeDasharray={p.dasharray} strokeLinecap={p.linecap} strokeLinejoin="round" />
          {detalle && <path d={detalle} fill="none" stroke={borde ? colorBorde : `var(--e-${conRelleno ? e.relleno : 'gris'}-s)`} strokeOpacity={borde ? 1 : 0.45} strokeWidth={g || 1.5} />}
        </g>
      </svg>
    </span>
  )
}

function MiniConector({ e }: { e: EstilosFabrica['conector'] }) {
  // Dos cajitas a distinta altura (así se ve la curva o el codo) y el conector entre las dos.
  const a = { x: 30, y: 20 }
  const b = { x: 90, y: 50 }
  const r = e.puntaFin === 'ninguna' ? 0 : retroceso(e.puntaFin, e.grosor)
  let d: string
  let angulo = 0
  if (e.trazo === 'recto') {
    angulo = Math.atan2(b.y - a.y, b.x - a.x)
    d = `M${a.x} ${a.y} L${b.x - Math.cos(angulo) * r} ${b.y - Math.sin(angulo) * r}`
  } else if (e.trazo === 'ortogonal') d = `M${a.x} ${a.y} H${(a.x + b.x) / 2} V${b.y} H${b.x - r}`
  else d = `M${a.x} ${a.y} C${a.x + 30} ${a.y} ${b.x - 30} ${b.y} ${b.x - r} ${b.y}`
  const p = guiones(e.guion, e.grosor)
  return (
    <span className="estilo-mini" aria-hidden>
      <svg width={120} height={70} viewBox="0 0 120 70" className="estilo-mini__conector">
        <rect x={6} y={10} width={24} height={20} rx={5} className="estilo-mini__caja" />
        <rect x={90} y={40} width={24} height={20} rx={5} className="estilo-mini__caja" />
        <path d={d} fill="none" stroke="var(--c-texto-3)" strokeWidth={e.grosor} strokeDasharray={p.dasharray} strokeLinecap={p.linecap} strokeLinejoin="round" />
        <Punta tipo={e.puntaFin} x={b.x} y={b.y} angulo={angulo} grosor={e.grosor} color="var(--c-texto-3)" />
      </svg>
    </span>
  )
}

function MiniMarco({ e }: { e: EstilosFabrica['marco'] }) {
  return (
    <span className="estilo-mini" aria-hidden>
      <span className="estilo-mini__marco" style={{ ['--marco' as string]: `var(--m-${e.color})`, ['--marco-s' as string]: `var(--e-${e.color}-s)` }}>
        <span className="estilo-mini__marco-titulo">
          <span className="estilo-mini__marco-punto" />
          Marco
        </span>
        <span className={`estilo-mini__marco-area estilo-mini__marco-area--${e.relleno}`} />
      </span>
    </span>
  )
}

// ───────── la sección ─────────

function FilaEstilo({ nombre, mini, children }: { nombre: string; mini: ReactNode; children: ReactNode }) {
  return (
    <div className="estilo-fila">
      <div className="estilo-fila__izq">
        <span className="config-fila__nombre">{nombre}</span>
        <div className="estilo-fila__opciones">{children}</div>
      </div>
      {mini}
    </div>
  )
}

export function SeccionEstilos() {
  const recordar = usePreferencias((s) => s.recordarEstilo)
  const estilos = usePreferencias((s) => s.estilos)
  const { cambiar, cambiarEstilo } = usePreferencias.getState()
  const { nota, texto, forma, conector, marco } = estilos
  const deFabrica = iguales(estilos, ESTILOS_FABRICA)

  // Las miniaturas se dibujan en su letra: se bajan las que se están usando.
  useEffect(() => {
    void cargarFuente(nota.fuente)
    void cargarFuente(texto.fuente)
  }, [nota.fuente, texto.fuente])

  return (
    <>
      <Grupo>
        <Fila
          nombre="Recordar el último estilo que usé"
          descripcion={
            recordar
              ? 'Cada objeto nuevo sale como el último que tocaste. Lo que elijas acá vale hasta que cambies el estilo de un objeto.'
              : 'Los objetos nuevos salen siempre con los estilos de abajo.'
          }
        >
          <Interruptor etiqueta="Recordar el último estilo que usé" valor={recordar} alCambiar={(v) => cambiar({ recordarEstilo: v })} />
        </Fila>
      </Grupo>
      <Grupo titulo="Cómo salen los objetos nuevos">
        <FilaEstilo nombre="Nota" mini={<MiniNota e={nota} />}>
          <OpcionColor que="Color" valor={nota.color} variable="--n" alElegir={(c) => cambiarEstilo('nota', { color: c as Color })} />
          <OpcionFuente valor={nota.fuente} alElegir={(f) => cambiarEstilo('nota', { fuente: f })} />
        </FilaEstilo>

        <FilaEstilo nombre="Texto" mini={<MiniTexto e={texto} />}>
          <OpcionFuente valor={texto.fuente} alElegir={(f) => cambiarEstilo('texto', { fuente: f })} />
          <Opcion que="Tamaño" texto={String(texto.tamano === 'auto' ? 21 : texto.tamano)} ancho={120} enfocarInicial={Math.max(0, TAMANOS_LETRA.indexOf(texto.tamano as number))}>
            {(cerrar) => (
              <Lista<number>
                etiqueta="Tamaño"
                valor={texto.tamano === 'auto' ? 21 : texto.tamano}
                alElegir={(t) => cambiarEstilo('texto', { tamano: t })}
                cerrar={cerrar}
                opciones={TAMANOS_LETRA.map((t) => ({ id: t, nombre: String(t) }))}
              />
            )}
          </Opcion>
          <OpcionColor
            que="Color"
            valor={texto.colorTexto}
            variable="--tinta"
            conAuto="Automático"
            alElegir={(c) => cambiarEstilo('texto', { colorTexto: c === 'ninguno' ? 'auto' : c })}
          />
        </FilaEstilo>

        <FilaEstilo nombre="Forma" mini={<MiniForma e={forma} />}>
          <Opcion que="Forma" texto={FORMAS.find((f) => f.id === forma.forma)?.nombre ?? 'Forma'} ancho={230} enfocarInicial={Math.max(0, FORMAS.findIndex((f) => f.id === forma.forma))}>
            {(cerrar) => (
              <Lista<TipoForma>
                etiqueta="Forma"
                valor={forma.forma}
                alElegir={(f) => cambiarEstilo('forma', { forma: f })}
                cerrar={cerrar}
                opciones={FORMAS.map((f) => ({
                  id: f.id,
                  nombre: f.nombre,
                  icono: (
                    <svg width={24} height={18} viewBox="-1 -1 26 20" className="mini-forma-svg" aria-hidden>
                      <path d={trazoForma(f.id, 24, 17)} />
                    </svg>
                  ),
                }))}
              />
            )}
          </Opcion>
          <OpcionColor
            que="Relleno"
            valor={forma.relleno}
            variable={forma.tono === 'fuerte' ? '--e-s' : '--e'}
            conNinguno="Sin relleno"
            alElegir={(c) => cambiarEstilo('forma', { relleno: c === 'auto' ? 'ninguno' : c })}
          />
          <Opcion que="Tono" texto={forma.tono === 'fuerte' ? 'Fuerte' : 'Suave'} ancho={150}>
            {(cerrar) => (
              <Lista<'suave' | 'fuerte'>
                etiqueta="Tono del relleno"
                valor={forma.tono}
                alElegir={(t) => cambiarEstilo('forma', { tono: t })}
                cerrar={cerrar}
                opciones={[
                  { id: 'suave', nombre: 'Suave' },
                  { id: 'fuerte', nombre: 'Fuerte' },
                ]}
              />
            )}
          </Opcion>
          <OpcionColor
            que="Borde"
            valor={forma.borde}
            variable="--e-s"
            conNinguno="Sin borde"
            alElegir={(c) => cambiarEstilo('forma', { borde: c === 'auto' ? 'ninguno' : c })}
          />
        </FilaEstilo>

        <FilaEstilo nombre="Conector" mini={<MiniConector e={conector} />}>
          <Opcion que="Trazo" texto={TRAZOS.find((t) => t.id === conector.trazo)?.nombre ?? ''} ancho={170}>
            {(cerrar) => (
              <Lista<Trazo>
                etiqueta="Trazo"
                valor={conector.trazo}
                alElegir={(t) => cambiarEstilo('conector', { trazo: t })}
                cerrar={cerrar}
                opciones={TRAZOS.map((t) => ({ id: t.id, nombre: t.nombre, icono: ICONOS_TRAZO[t.id] }))}
              />
            )}
          </Opcion>
          <Opcion que="Punta" texto={PUNTAS.find((p) => p.id === conector.puntaFin)?.nombre ?? ''} ancho={200}>
            {(cerrar) => (
              <Lista<TipoPunta>
                etiqueta="Punta del final"
                valor={conector.puntaFin}
                alElegir={(p) => cambiarEstilo('conector', { puntaFin: p })}
                cerrar={cerrar}
                opciones={PUNTAS.map((p) => ({ id: p.id, nombre: p.nombre, icono: <MuestraPunta tipo={p.id} /> }))}
              />
            )}
          </Opcion>
          <Opcion que="Línea" texto={GUIONES.find((g) => g.id === conector.guion)?.nombre ?? ''} ancho={170}>
            {(cerrar) => (
              <Lista<Guion>
                etiqueta="Línea"
                valor={conector.guion}
                alElegir={(g) => cambiarEstilo('conector', { guion: g })}
                cerrar={cerrar}
                opciones={GUIONES.map((g) => ({ id: g.id, nombre: g.nombre, icono: <MuestraGuion guion={g.id} grosor={2} /> }))}
              />
            )}
          </Opcion>
          <Opcion que="Grosor" texto={String(conector.grosor)} ancho={150}>
            {(cerrar) => (
              <Lista<number>
                etiqueta="Grosor"
                valor={conector.grosor}
                alElegir={(g) => cambiarEstilo('conector', { grosor: g })}
                cerrar={cerrar}
                opciones={GROSORES.map((g) => ({ id: g, nombre: String(g), icono: <MuestraGuion guion="solido" grosor={g} /> }))}
              />
            )}
          </Opcion>
        </FilaEstilo>

        <FilaEstilo nombre="Marco" mini={<MiniMarco e={marco} />}>
          <OpcionColor que="Color" valor={marco.color} variable="--e-s" alElegir={(c) => cambiarEstilo('marco', { color: c as Color })} />
          <Opcion que="Relleno" texto={RELLENOS_MARCO.find((r) => r.id === marco.relleno)?.nombre ?? ''} ancho={150}>
            {(cerrar) => (
              <Lista<RellenoMarco>
                etiqueta="Relleno del marco"
                valor={marco.relleno}
                alElegir={(r) => cambiarEstilo('marco', { relleno: r })}
                cerrar={cerrar}
                opciones={RELLENOS_MARCO}
              />
            )}
          </Opcion>
        </FilaEstilo>
      </Grupo>
      <div className="config-pie">
        <button type="button" className="boton boton--chico" disabled={deFabrica} onClick={() => usePreferencias.getState().volverAFabrica()}>
          <RotateCcw size={13} /> Volver a los de fábrica
        </button>
      </div>
    </>
  )
}

function MuestraGuion({ guion, grosor }: { guion: Guion; grosor: number }) {
  const p = guiones(guion, grosor)
  return (
    <svg width={34} height={12} viewBox="0 0 34 12" aria-hidden>
      <line x1={3} y1={6} x2={31} y2={6} stroke="currentColor" strokeWidth={grosor} strokeDasharray={p.dasharray} strokeLinecap={p.linecap} />
    </svg>
  )
}
