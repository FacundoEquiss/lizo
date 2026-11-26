// Marco (5.5): las "páginas" del lienzo. Relleno tinte, tenue o liso; el título va afuera, arriba a la izquierda, y se lee
// igual con cualquier zoom; se agarra por el título o por el borde (una franja invisible de 8 px de pantalla). Adentro
// se selecciona y se crea como en el lienzo. Lo que tiene adentro se mueve con él.
import type { NodeProps } from '@xyflow/react'
import { memo, useContext, useEffect, useRef, useState } from 'react'
import { leerMarco, MINIMOS } from '../../../../../compartido/lienzo'
import { ultimoPasoCreo } from '../../../estado/deshacer'
import { estaCreandose, useTienda } from '../../../estado/tienda'
import { ContextoNivel, useAccionesLienzo } from '../acciones'
import { conteoPorMarco } from '../indices'
import { useEditorActivo } from '../texto/editorActivo'
import type { NodoLienzo } from '../tipos'
import { Candado, Destello, guardarDatos, Redimensionar, Rotulo } from './comunes'

const SIN_TITULO = 'Marco sin nombre'

/** El nombre del marco; con doble clic o Enter se edita en el lugar (mismo tamaño de letra, ancho según el texto). */
function TituloMarco({ id, titulo }: { id: string; titulo: string }) {
  const editando = useTienda((s) => s.editando === id)
  const [valor, setValor] = useState(titulo)
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!editando) setValor(titulo)
  }, [titulo, editando])
  useEffect(() => {
    if (!editando) return
    // React Flow esconde un objeto recién creado hasta medirlo, y lo escondido no recibe el foco: se reintenta.
    let intentos = 0
    let cuadro = 0
    const enfocar = () => {
      const el = campo.current
      if (!el) return
      el.focus()
      if (document.activeElement !== el && intentos++ < 20) {
        cuadro = requestAnimationFrame(enfocar)
        return
      }
      el.select()
      const pendiente = useEditorActivo.getState().pendiente
      if (pendiente) {
        useEditorActivo.getState().set({ pendiente: '' })
        setValor(pendiente)
      }
    }
    enfocar()
    return () => cancelAnimationFrame(cuadro)
  }, [editando])
  const salir = () => {
    useTienda.getState().setEditando(null)
    const nuevo = valor.trim()
    if (nuevo === titulo) return
    // El primer nombre de un marco recién creado va con su creación (deshacer lo saca entero).
    if (ultimoPasoCreo(id) || estaCreandose(id)) void useTienda.getState().actualizarElementos([{ id, datos: { titulo: nuevo } }], { registrar: false })
    else guardarDatos(id, { titulo: nuevo }, 'renombrar el marco')
  }
  if (!editando)
    return (
      <span className={`marco__nombre${titulo ? '' : ' marco__nombre--vacio'}`} title={titulo || undefined}>
        {titulo || SIN_TITULO}
      </span>
    )
  return (
    <span className="marco__nombre marco__nombre--editando" data-valor={valor || SIN_TITULO}>
      <input
        ref={campo}
        className="marco__campo nodrag nopan"
        value={valor}
        size={1}
        placeholder={SIN_TITULO}
        aria-label="Nombre del marco"
        onChange={(e) => setValor(e.target.value)}
        onBlur={salir}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </span>
  )
}

export const Marco = memo(function Marco({ id, data, selected }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  const d = leerMarco(e.datos)
  const nivel = useContext(ContextoNivel)
  const acciones = useAccionesLienzo()
  // De lejos, un toque en el título lleva al marco (encuadrado); de cerca sigue seleccionando. Un arrastre no cuenta.
  const inicio = useRef<{ x: number; y: number } | null>(null)
  // Un solo cálculo para todos los marcos, memorizado por la lista de objetos (no un filtro por marco).
  const contenidos = useTienda((s) => (s.tablero ? (conteoPorMarco(s.tablero.elementos).get(id) ?? 0) : 0))
  return (
    <div
      className={`nodo marco marco--${d.relleno}${d.tituloEn !== 'afuera' ? ` marco--titulo-${d.tituloEn}` : ''}`}
      style={{ ['--marco' as string]: `var(--m-${d.color})`, ['--marco-s' as string]: `var(--e-${d.color}-s)`, ['--ancho' as string]: `${e.ancho}px`, ['--alto' as string]: `${e.alto}px` }}
    >
      {/* El borde también agarra y selecciona el marco (8 px de pantalla, por dentro). */}
      <div className="marco__borde marco__borde--n" aria-hidden />
      <div className="marco__borde marco__borde--s" aria-hidden />
      <div className="marco__borde marco__borde--o" aria-hidden />
      <div className="marco__borde marco__borde--e" aria-hidden />
      {selected && !e.bloqueado && <Redimensionar id={id} min={MINIMOS.marco} />}
      {/* El título se lee igual con cualquier zoom (como en Miro): escala inversa con --z, sin suscribirse al zoom. */}
      <div
        className="marco__titulo"
        onDoubleClick={() => !e.bloqueado && useTienda.getState().setEditando(id)}
        onPointerDown={(ev) => {
          inicio.current = { x: ev.clientX, y: ev.clientY }
        }}
        onClick={(ev) => {
          const i = inicio.current
          inicio.current = null
          if (!nivel || !i || Math.hypot(ev.clientX - i.x, ev.clientY - i.y) > 5) return
          acciones.irAMarco(id)
        }}
      >
        <span className="marco__punto" />
        <TituloMarco id={id} titulo={d.titulo} />
        {contenidos > 0 && <span className="marco__cuenta">{contenidos}</span>}
      </div>
      {contenidos === 0 && !selected && (
        <div className="marco__vacio" aria-hidden>
          <span>Arrastrá notas o tarjetas acá</span>
        </div>
      )}
      {e.bloqueado && <Candado />}
      <Rotulo id={id} texto={`Marco ${d.titulo || 'sin nombre'}, ${contenidos === 1 ? '1 objeto' : `${contenidos} objetos`}${e.bloqueado ? ' (bloqueado)' : ''}`} />
      <Destello id={id} />
    </div>
  )
})
