import { Search, SearchX, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NOMBRES_TIPO, textoDe } from '../../../../../compartido/lienzo'
import { normalizar } from '../../../../../compartido/texto'
import type { ElementoLienzo, TarjetaResumen } from '../../../../../compartido/tipos'
import { porId, useTienda } from '../../../estado/tienda'
import { EstadoVacio } from '../../../ui/EstadoVacio'

export type FiltroBusqueda = 'todo' | 'nota' | 'tarjeta' | 'marco'

export const FILTROS_BUSQUEDA: { id: FiltroBusqueda; nombre: string; corto: string }[] = [
  { id: 'todo', nombre: 'Todo', corto: 'Todo' },
  { id: 'nota', nombre: 'Notas y textos', corto: 'Notas' },
  { id: 'tarjeta', nombre: 'Tarjetas', corto: 'Tarjetas' },
  { id: 'marco', nombre: 'Marcos', corto: 'Marcos' },
]

/**
 * Buscar en el lienzo (lo usan este panel de escritorio y la hoja del celular): lo que coincide con el texto, del tipo
 * elegido ("Notas y textos" también trae las formas), hasta `limite` resultados.
 */
export function useBusquedaLienzo(q: string, filtro: FiltroBusqueda, limite = 12) {
  const tablero = useTienda((s) => s.tablero)
  const nq = normalizar(q.trim())
  const resultados = useMemo(() => {
    if (!nq || !tablero) return []
    const tarjetas = porId(tablero.tarjetas)
    return tablero.elementos
      .filter((e) => (filtro === 'todo' || e.tipo === filtro || (filtro === 'nota' && (e.tipo === 'texto' || e.tipo === 'forma'))) && normalizar(textoElemento(e, tarjetas)).includes(nq))
      .slice(0, limite)
  }, [nq, filtro, limite, tablero?.elementos, tablero?.tarjetas])
  const tarjetas = useMemo(() => porId(tablero?.tarjetas ?? []), [tablero?.tarjetas])
  return { resultados, hayTexto: !!nq, texto: (e: ElementoLienzo) => textoElemento(e, tarjetas) }
}

/** El texto con el que se busca un objeto: el suyo, o la clave y el título de su tarjeta del Kanban. */
export function textoElemento(e: ElementoLienzo, tarjetas: Map<string, TarjetaResumen>) {
  if (e.tarjetaId) {
    const t = tarjetas.get(e.tarjetaId)
    return t ? `${t.clave} ${t.titulo}` : ''
  }
  return textoDe(e.datos)
}

export function Buscador({ alCerrar, alIr }: { alCerrar: () => void; alIr: (e: ElementoLienzo) => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const [tipo, setTipo] = useState<FiltroBusqueda>('todo')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  const { resultados, hayTexto, texto } = useBusquedaLienzo(q, tipo)
  return (
    // Centrado con `translate` (no con transform): motion anima la entrada con transform y lo pisaba, y el panel quedaba
    // corrido medio ancho a la derecha (en una ventana angosta, afuera).
    <motion.div className="buscador" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ type: 'spring', stiffness: 500, damping: 36 }}>
      <div className="buscador__fila">
        <Search size={16} />
        <input
          ref={ref}
          value={q}
          placeholder="Buscar en el lienzo…"
          aria-label="Buscar en el lienzo"
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value)
            setI(0)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') alCerrar()
            if (e.key === 'ArrowDown') setI((x) => Math.min(x + 1, resultados.length - 1))
            if (e.key === 'ArrowUp') setI((x) => Math.max(x - 1, 0))
            if (e.key === 'Enter' && resultados[i]) alIr(resultados[i]!)
          }}
        />
        <span className="buscador__cuenta">{hayTexto ? `${resultados.length}` : ''}</span>
        <button className="boton-icono boton-icono--chico" onClick={alCerrar} aria-label="Cerrar búsqueda">
          <X size={15} />
        </button>
      </div>
      <div className="segmentado segmentado--chico">
        {FILTROS_BUSQUEDA.map(({ id, nombre }) => (
          <button key={id} className={`segmentado__opcion${tipo === id ? ' segmentado__opcion--activa' : ''}`} onClick={() => setTipo(id)}>
            {nombre}
          </button>
        ))}
      </div>
      {hayTexto && resultados.length === 0 && <EstadoVacio chico icono={SearchX} titulo="Nada con ese texto en este lienzo" />}
      {resultados.length > 0 && (
        <ul className="buscador__resultados">
          {resultados.map((e, j) => (
            <li key={e.id}>
              <button className={`buscador__resultado${j === i ? ' buscador__resultado--activo' : ''}`} onMouseEnter={() => setI(j)} onClick={() => alIr(e)}>
                <span className="buscador__tipo">{NOMBRES_TIPO[e.tipo]}</span>
                <span className="buscador__texto">{texto(e) || '(vacío)'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  )
}
