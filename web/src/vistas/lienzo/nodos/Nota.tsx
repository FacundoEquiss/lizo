// Nota adhesiva (5.3): papel de color, texto enriquecido y letra que se acomoda sola. Con tamaño de letra manual, si el
// texto no entra, la nota crece hacia abajo (nunca corta ni muestra una barra de desplazamiento). Al arrastrarla se
// levanta y gira un poco hacia donde va (la transformación va en este div, no en el nodo de React Flow).
import type { NodeProps } from '@xyflow/react'
import { memo, useContext, useMemo, useRef, type CSSProperties } from 'react'
import { leerNota, MINIMOS, type AlineacionV } from '../../../../../compartido/lienzo'
import { textoPlano } from '../../../../../compartido/rico'
import { useTienda } from '../../../estado/tienda'
import { ContextoNivel } from '../acciones'
import { cambiarDatos } from '../seleccion'
import { useAjuste } from '../texto/ajuste'
import { CajaTexto } from '../texto/CajaTexto'
import { useEditorActivo } from '../texto/editorActivo'
import type { NodoLienzo } from '../tipos'
import { Candado, Destello, PuntosConexion, Redimensionar, Rotulo, rotuloConTexto } from './comunes'
import { ALINEACION_CSS } from './Texto'

/** Peso y espaciado de la letra de la nota (la negrita suma 150). */
const PESO_NOTA = 560
const ESPACIADO_NOTA = '-0.01em'

/** El padding: 8 % del lado menor, entre 12 y 28 px. */
export const paddingNota = (ancho: number, alto: number) => Math.round(Math.min(28, Math.max(12, Math.min(ancho, alto) * 0.08)))

export const JUSTIFICAR_V: Record<AlineacionV, CSSProperties['justifyContent']> = { arriba: 'flex-start', medio: 'center', abajo: 'flex-end' }

export const Nota = memo(function Nota({ id, data, selected, dragging, positionAbsoluteX }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  const d = leerNota(e.datos)
  const ref = useRef<HTMLDivElement>(null)
  const pad = paddingNota(e.ancho, e.alto)
  // Muy lejos (9.4): solo el papel; el texto no se lee, así que ni se arma ni se mide (salvo si se la está editando).
  const editando = useTienda((s) => s.editando === id)
  const nivel = useContext(ContextoNivel)
  const soloPapel = nivel === 'muy-lejos' && !selected && !editando

  // Mientras se escribe, la letra se acomoda con lo que hay en el editor (una vez por transacción).
  const docEditando = useEditorActivo((s) => (s.id === id ? s.doc : null))
  const doc = docEditando ?? d.rico
  // Memorizado por el documento: mientras se arrastra (un render por cuadro) no se vuelve a serializar.
  const contenido = useMemo(() => (doc ? JSON.stringify(doc) : d.texto), [doc, d.texto])
  const caracteres = useMemo(() => (docEditando ? textoPlano(docEditando).length : d.texto.length), [docEditando, d.texto])
  const auto = d.tamano === 'auto'
  const ajustado = useAjuste(
    ref,
    contenido,
    { ancho: e.ancho - 2 * pad, alto: e.alto - 2 * pad, fuente: d.fuente, interlineado: d.interlineado, peso: PESO_NOTA, espaciado: ESPACIADO_NOTA },
    auto && !soloPapel,
    caracteres,
    nivel !== '' && !editando,
  )
  const px = auto ? ajustado : (d.tamano as number)

  // Hacia dónde se la arrastra: el giro sigue al movimiento (1,2°).
  const ultimaX = useRef(positionAbsoluteX)
  const giro = useRef(0)
  if (dragging) {
    const dx = positionAbsoluteX - ultimaX.current
    if (Math.abs(dx) > 0.5) giro.current = dx > 0 ? 1 : -1
  } else giro.current = 0
  ultimaX.current = positionAbsoluteX

  const estiloCaja = useMemo(
    () =>
      ({
        fontFamily: `var(--f-${d.fuente})`,
        fontSize: px,
        lineHeight: d.interlineado,
        textAlign: ALINEACION_CSS[d.alineacion],
        ...(d.colorTexto !== 'auto' ? { color: `var(--tinta-${d.colorTexto})` } : {}),
      }) as CSSProperties,
    [d.fuente, px, d.interlineado, d.alineacion, d.colorTexto],
  )

  // La firma de quien la creó, solo si fue una IA (por MCP).
  const firma = e.creadoPor?.tipo === 'ia' ? e.creadoPor.nombre : null

  return (
    <div
      ref={ref}
      className="nodo nota"
      style={
        {
          '--papel': `var(--n-${d.color})`,
          '--giro': `${giro.current * 1.2}deg`,
          minHeight: e.alto,
          padding: pad,
          justifyContent: JUSTIFICAR_V[d.alineacionV],
        } as CSSProperties
      }
      onMouseDown={(ev) => {
        // Escribiendo, un clic en el papel (fuera del texto) no termina la edición: el cursor va al final.
        if (useTienda.getState().editando !== id || (ev.target as HTMLElement).closest('.ProseMirror')) return
        ev.preventDefault()
        useEditorActivo.getState().editor?.commands.focus('end')
      }}
    >
      {selected && !e.bloqueado && <Redimensionar id={id} min={MINIMOS.nota} altoEnDatos />}
      {!soloPapel && (
        <CajaTexto
          elemento={e}
          texto={d.texto}
          rico={d.rico}
          className="nota__caja"
          estilo={estiloCaja}
          marcador="Escribí algo…"
          alAlinear={(a) => cambiarDatos([e], { alineacion: a }, 'alinear el texto')}
        />
      )}
      {firma && !soloPapel && (
        <span className="nota__firma" aria-label={`Creada por ${firma}`}>
          ✦ {firma}
        </span>
      )}
      {e.bloqueado && <Candado />}
      <PuntosConexion />
      <Rotulo id={id} texto={rotuloConTexto('Nota', e.datos.texto, e.bloqueado)} />
      <Destello id={id} />
    </div>
  )
})
