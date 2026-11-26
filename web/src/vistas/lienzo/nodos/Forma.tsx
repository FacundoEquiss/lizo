// Forma (5.4): las 13 se dibujan igual, un <svg> del tamaño del nodo con el trazo de formas.ts en coordenadas reales (las
// esquinas y el borde no se deforman). Relleno suave o fuerte (o ninguno), borde con color, grosor y estilo, opacidad
// (del relleno y el borde, no del texto) y una sombra leve si tiene relleno. El texto va en la zona interior de cada
// forma; si con el tamaño de letra elegido no entra, la forma crece hacia abajo (el alto guardado queda como mínimo).
import type { NodeProps } from '@xyflow/react'
import { memo, useContext, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { IdIcono } from '../../../../../compartido/iconos'
import { FORMAS, leerForma, MINIMOS, type DatosForma } from '../../../../../compartido/lienzo'
import { textoPlano } from '../../../../../compartido/rico'
import { useTienda } from '../../../estado/tienda'
import { ContextoNivel } from '../acciones'
import { cambiarDatos } from '../seleccion'
import { medirDespues, useAjuste } from '../texto/ajuste'
import { CajaTexto } from '../texto/CajaTexto'
import { useEditorActivo } from '../texto/editorActivo'
import { useFuentesCargadas, versionFuente } from '../texto/fuentes'
import type { NodoLienzo } from '../tipos'
import { Candado, Destello, PuntosConexion, Redimensionar, Rotulo, rotuloConTexto } from './comunes'
import { altoParaTexto, detalleForma, trazoForma, zonaTexto } from './formas'
import { ICONOS_LUCIDE } from './iconos'
import { JUSTIFICAR_V } from './Nota'
import { ALINEACION_CSS } from './Texto'

/** Peso de la letra de las formas (la negrita suma 150). */
const PESO_FORMA = 600
/** Los rellenos fuertes demasiado claros para letra blanca (en el tema claro llevan letra oscura). */
const CLAROS_FUERTES = new Set(['amarillo', 'lima'])
/** Una línea de 10 px tiene que entrar; si no, el texto se oculta (formas muy chicas). */
const LETRA_MINIMA = 10

/** Rayado 6 4 y punteado 1 5 con borde de 2 px (proporcionales al grosor). */
function guionBorde(estilo: string, g: number): { dasharray?: string; linecap: 'round' | 'butt' } {
  if (estilo === 'rayado') return { dasharray: `${3 * g} ${2 * g}`, linecap: 'butt' }
  if (estilo === 'punteado') return { dasharray: `${0.5 * g} ${2.5 * g}`, linecap: 'round' }
  return { linecap: 'round' }
}

/** El color de la letra: el elegido, o el que se lee sobre el relleno. */
function tintaDe(d: DatosForma): string {
  if (d.colorTexto !== 'auto') return `var(--tinta-${d.colorTexto})`
  if (d.relleno === 'ninguno') return 'var(--c-texto)'
  // Con poca opacidad el relleno fuerte se ve suave: la letra también.
  if (d.tono === 'fuerte' && d.opacidad >= 0.55 && (d.relleno as string) !== 'blanco')
    return CLAROS_FUERTES.has(d.relleno) ? 'var(--forma-sobre-fuerte-claro)' : 'var(--forma-sobre-fuerte)'
  return `var(--e-${d.relleno}-t)`
}

export const Forma = memo(function Forma({ id, data, selected }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  const d = leerForma(e.datos)
  const zonaRef = useRef<HTMLDivElement>(null)
  const editando = useTienda((s) => s.editando === id)
  // Muy lejos (9.4): solo la figura; el texto no se lee, así que ni se arma ni se mide.
  const nivel = useContext(ContextoNivel)
  const soloFigura = nivel === 'muy-lejos' && !selected && !editando
  useFuentesCargadas()

  // El alto real: el guardado, o más si el texto lo pide.
  const [necesario, setNecesario] = useState(0)
  const w = e.ancho
  const h = Math.max(e.alto, necesario)
  const z = zonaTexto(d.forma, w, h)

  // Mientras se escribe, el texto y la letra automática siguen al editor (una vez por transacción).
  const docEditando = useEditorActivo((s) => (s.id === id ? s.doc : null))
  const doc = docEditando ?? d.rico
  const contenido = useMemo(() => (doc ? JSON.stringify(doc) : d.texto), [doc, d.texto])
  const caracteres = useMemo(() => (docEditando ? textoPlano(docEditando).length : d.texto.length), [docEditando, d.texto])
  const auto = d.tamano === 'auto'
  const ajustado = useAjuste(
    zonaRef,
    contenido,
    { ancho: z.w, alto: z.h, fuente: d.fuente, interlineado: d.interlineado, peso: PESO_FORMA, espaciado: 'normal' },
    auto && !soloFigura,
    caracteres,
    nivel !== '' && !editando,
  )
  const px = auto ? ajustado : (d.tamano as number)

  // Si el texto no entra en la zona, la forma crece hasta que entre (y vuelve a su alto si se achica el texto).
  const version = versionFuente(d.fuente)
  useLayoutEffect(() => {
    if (soloFigura) return
    let vivo = true
    const medir = () => {
      const caja = zonaRef.current?.firstElementChild as HTMLElement | null
      if (!vivo || !caja) return
      const th = caja.offsetHeight
      const pedido = th > zonaTexto(d.forma, w, e.alto).h + 0.5 ? altoParaTexto(d.forma, w, th, e.alto) : 0
      if (Math.abs(pedido - necesario) > 0.5) setNecesario(pedido)
    }
    // Lejos, la letra apenas se ve: se mide en los cuadros siguientes (con mil formas, medir todas juntas frena la apertura).
    if (nivel !== '' && !editando) medirDespues(`forma:${id}`, medir)
    else medir()
    return () => {
      vivo = false
    }
    // necesario es lo que salió en este dibujo; lo demás cambia lo que mide la letra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contenido, d.forma, w, e.alto, z.w, px, d.fuente, d.interlineado, version, editando, soloFigura, nivel])

  const conRelleno = d.relleno !== 'ninguno'
  // Sin relleno ni borde la forma sería invisible: un borde gris de 2 px.
  const borde = d.borde !== 'ninguno' ? d.borde : conRelleno ? null : 'gris'
  const g = !borde ? 0 : d.borde === 'ninguno' ? 2 : d.bordeGrosor
  const guion = guionBorde(d.borde === 'ninguno' ? 'solido' : d.bordeEstilo, g)
  // El blanco es siempre blanco (su «fuerte» es el color del borde gris).
  const relleno = !conRelleno ? 'none' : d.tono === 'fuerte' && (d.relleno as string) !== 'blanco' ? `var(--e-${d.relleno}-s)` : `var(--e-${d.relleno})`
  // El trazo va adentro de la caja: medio grosor de margen para que el borde no se corte ni se salga del marco.
  const trazo = trazoForma(d.forma, Math.max(1, w - g), Math.max(1, h - g))
  const detalle = detalleForma(d.forma, Math.max(1, w - g), Math.max(1, h - g))
  const colorBorde = borde ? `var(--e-${borde}-s)` : undefined

  const tinta = tintaDe(d)
  // Ícono (compartido/iconos.ts): solo, va centrado en la forma; con texto, arriba o a la izquierda de él.
  const Icono = d.icono ? ICONOS_LUCIDE[d.icono as IdIcono] : null
  const hayTexto = caracteres > 0
  const soloIcono = !!Icono && !hayTexto && !editando
  const tamIcono = !Icono
    ? 0
    : soloIcono
      ? Math.max(16, Math.min(z.w, z.h) * 0.62)
      : d.iconoPosicion === 'izquierda'
        ? Math.max(16, Math.min(z.h * 0.5, 40))
        : Math.max(16, Math.min(z.w * 0.5, z.h * 0.45, 44))
  const lugarIcono: CSSProperties | undefined = !Icono
    ? undefined
    : soloIcono
      ? { left: z.x + (z.w - tamIcono) / 2, top: z.y + (z.h - tamIcono) / 2 }
      : d.iconoPosicion === 'izquierda'
        ? { left: z.x + 4, top: z.y + (z.h - tamIcono) / 2 }
        : { left: z.x + (z.w - tamIcono) / 2, top: z.y + 4 }
  const reservaIcono: CSSProperties | undefined =
    Icono && !soloIcono ? (d.iconoPosicion === 'izquierda' ? { paddingLeft: tamIcono + 10, boxSizing: 'border-box' } : { paddingTop: tamIcono + 8, boxSizing: 'border-box' }) : undefined
  const estiloCaja = useMemo(
    () =>
      ({
        fontFamily: `var(--f-${d.fuente})`,
        fontSize: px,
        lineHeight: d.interlineado,
        textAlign: ALINEACION_CSS[d.alineacion],
      }) as CSSProperties,
    [d.fuente, px, d.interlineado, d.alineacion],
  )
  const cabe = z.w >= LETRA_MINIMA * 1.2 && z.h >= LETRA_MINIMA * d.interlineado

  return (
    <div
      className={`nodo forma${conRelleno ? ' forma--relleno' : ''}`}
      style={{ height: h, color: tinta }}
      onMouseDown={(ev) => {
        // Escribiendo, un clic en la forma (fuera del texto) no termina la edición: el cursor va al final.
        if (!editando || (ev.target as HTMLElement).closest('.ProseMirror')) return
        ev.preventDefault()
        useEditorActivo.getState().editor?.commands.focus('end')
      }}
    >
      <svg className="forma__svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ opacity: d.opacidad }} aria-hidden>
        <g transform={g ? `translate(${g / 2} ${g / 2})` : undefined}>
          <path
            d={trazo}
            fill={relleno}
            stroke={colorBorde ?? 'none'}
            strokeWidth={g || undefined}
            strokeDasharray={guion.dasharray}
            strokeLinecap={guion.linecap}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {detalle && (
            <path
              d={detalle}
              fill="none"
              stroke={colorBorde ?? (conRelleno ? `var(--e-${d.relleno}-s)` : 'var(--e-gris-s)')}
              strokeOpacity={colorBorde ? 1 : 0.45}
              strokeWidth={g || 1.5}
              strokeDasharray={guion.dasharray}
              strokeLinecap={guion.linecap}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      </svg>
      {Icono && !soloFigura && (
        <span className="forma__icono" style={{ ...lugarIcono, width: tamIcono, height: tamIcono, color: tinta }} aria-hidden>
          <Icono size={tamIcono} strokeWidth={soloIcono ? 1.75 : 2} />
        </span>
      )}
      {!soloFigura && (
        <div
          ref={zonaRef}
          className="forma__zona"
          style={{
            left: z.x,
            top: z.y,
            width: Math.max(0, z.w),
            height: Math.max(0, z.h),
            justifyContent: JUSTIFICAR_V[d.alineacionV],
            visibility: cabe || editando ? undefined : 'hidden',
            ...reservaIcono,
          }}
        >
          <CajaTexto
            elemento={e}
            texto={d.texto}
            rico={d.rico}
            className="forma__caja"
            estilo={estiloCaja}
            marcador={editando ? 'Escribí algo…' : undefined}
            alAlinear={(a) => cambiarDatos([e], { alineacion: a }, 'alinear el texto')}
          />
        </div>
      )}
      {selected && !e.bloqueado && <Redimensionar id={id} min={MINIMOS.forma} altoEnDatos />}
      {e.bloqueado && <Candado />}
      <PuntosConexion />
      <Rotulo
        id={id}
        texto={rotuloConTexto(`Forma ${(FORMAS.find((f) => f.id === d.forma)?.nombre ?? 'forma').toLowerCase()}`, e.datos.texto, e.bloqueado)}
      />
      <Destello id={id} />
    </div>
  )
})
