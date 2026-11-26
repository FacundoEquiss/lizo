// Objeto Texto (5.2): solo el texto, sin caja ni sombra. Con ancho automático crece hacia la derecha mientras se
// escribe; arrastrar un lado lo pasa a ancho fijo (corta solo) y un doble clic en el lado lo devuelve a automático.
// El alto lo da siempre el contenido. Las esquinas escalan la letra.
import type { NodeProps } from '@xyflow/react'
import { memo, useMemo, type CSSProperties } from 'react'
import { leerTexto, MINIMOS, pesoPorTamano, type Alineacion } from '../../../../../compartido/lienzo'
import { docVacio } from '../../../../../compartido/rico'
import { useTienda } from '../../../estado/tienda'
import { cambiarDatos } from '../seleccion'
import { CajaTexto } from '../texto/CajaTexto'
import type { NodoLienzo } from '../tipos'
import { Candado, Destello, PuntosConexion, Redimensionar, Rotulo, rotuloConTexto } from './comunes'

/** Más de esto, el texto pasa a ancho fijo de 480 px (un pegado larguísimo no hace una sola línea kilométrica). */
const LARGO_PARA_FIJO = 5000
const ANCHO_LARGO = 480

export const ALINEACION_CSS: Record<Alineacion, CSSProperties['textAlign']> = {
  izquierda: 'left',
  centro: 'center',
  derecha: 'right',
  justificado: 'justify',
}

export const Texto = memo(function Texto({ id, data, selected }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  const d = leerTexto(e.datos)
  const tam = typeof d.tamano === 'number' ? d.tamano : 21
  const estilo = useMemo(() => {
    const p = pesoPorTamano(tam)
    return {
      fontFamily: `var(--f-${d.fuente})`,
      fontSize: tam,
      '--peso': p.peso,
      letterSpacing: p.espaciado,
      lineHeight: Math.max(d.interlineado, p.interlineadoMin),
      textAlign: ALINEACION_CSS[d.alineacion],
      ...(d.colorTexto !== 'auto' ? { color: `var(--tinta-${d.colorTexto})` } : {}),
      ...(d.fondo ? { background: `var(--e-${d.fondo})` } : {}),
    } as CSSProperties
  }, [tam, d.fuente, d.interlineado, d.alineacion, d.colorTexto, d.fondo])

  return (
    <div className={`nodo texto${d.anchoAuto ? ' texto--auto' : ''}${d.fondo ? ' texto--fondo' : ''}`}>
      {selected && !e.bloqueado && (
        <Redimensionar
          id={id}
          min={MINIMOS.texto}
          lados="horizontales"
          altoAuto
          escalar={(f) => ({ tamano: Math.max(8, Math.min(400, Math.round(tam * f))) })}
          alArrastrarLado={() => ({ anchoAuto: false })}
          alDobleClicLado={
            d.anchoAuto ? undefined : () => void useTienda.getState().actualizarElementos([{ id, datos: { anchoAuto: true } }], { registrar: 'ancho automático' })
          }
        />
      )}
      <CajaTexto
        elemento={e}
        texto={d.texto}
        rico={d.rico}
        className="texto__caja"
        estilo={estilo}
        permitirTitulos
        marcador="Escribí algo…"
        alCambiar={(_doc, plano) => {
          if (plano.length > LARGO_PARA_FIJO && leerTexto(useTienda.getState().tablero?.elementos.find((x) => x.id === id)?.datos ?? {}).anchoAuto)
            void useTienda.getState().actualizarElementos([{ id, ancho: ANCHO_LARGO, datos: { anchoAuto: false } }], { registrar: false })
        }}
        alTerminar={(doc, plano, nodo) => {
          // Un texto vacío no deja basura invisible: se descarta (y no queda nada para deshacer).
          if (docVacio(doc)) return { borrar: true }
          // Las medidas reales, en el mismo paso: alinear, enganchar y los conectores usan la caja verdadera.
          const largo = plano.length > LARGO_PARA_FIJO && d.anchoAuto
          return {
            ...(largo ? { datos: { anchoAuto: false } } : {}),
            objeto: nodo ? { ancho: largo ? ANCHO_LARGO : nodo.offsetWidth, alto: nodo.offsetHeight } : undefined,
          }
        }}
        alAlinear={(a) => cambiarDatos([e], { alineacion: a }, 'alinear el texto')}
      />
      {e.bloqueado && <Candado />}
      <PuntosConexion />
      <Rotulo id={id} texto={rotuloConTexto('Texto', e.datos.texto, e.bloqueado)} />
      <Destello id={id} />
    </div>
  )
})
