// Tarjeta nueva desde el lienzo (D): el título y, a la derecha, la lista donde va (de fábrica, la primera "por hacer";
// no la bandeja de Discord). Tab pasa al selector; Enter crea la tarjeta y la deja en el lienzo.
import { motion } from 'motion/react'
import { useMemo, useRef, useState } from 'react'
import { porOrden, useTienda } from '../../../estado/tienda'

export function ComposerTarjeta({
  x,
  y,
  alCrear,
  alCerrar,
}: {
  x: number
  y: number
  alCrear: (titulo: string, listaId: string) => void
  alCerrar: () => void
}) {
  const listas = useTienda((s) => s.tablero?.listas)
  const ordenadas = useMemo(() => [...(listas ?? [])].filter((l) => !l.archivada).sort(porOrden), [listas])
  const [t, setT] = useState('')
  const [listaId, setListaId] = useState(() => (ordenadas.find((l) => l.categoria === 'por_hacer') ?? ordenadas[0])?.id ?? '')
  const caja = useRef<HTMLDivElement>(null)
  const crear = () => {
    if (t.trim() && listaId) alCrear(t.trim(), listaId)
  }
  const lista = ordenadas.find((l) => l.id === listaId)
  return (
    <motion.div
      ref={caja}
      className="composer-lienzo"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          crear()
        }
        if (e.key === 'Escape') alCerrar()
      }}
      // Salir del compositor (con el título vacío) lo cierra; ir del campo al selector, no.
      onBlur={(e) => {
        if (!caja.current?.contains(e.relatedTarget as Node) && !t.trim()) alCerrar()
      }}
    >
      <div className="composer-lienzo__fila">
        <input autoFocus value={t} placeholder="Título de la tarjeta nueva…" aria-label="Título de la tarjeta nueva" onChange={(e) => setT(e.target.value)} />
        <label className="composer-lienzo__lista" title="Lista donde va">
          <span className={`punto-categoria${lista?.categoria ? ` punto-categoria--${lista.categoria}` : ''}`} />
          <select value={listaId} onChange={(e) => setListaId(e.target.value)} aria-label="Lista donde va la tarjeta">
            {ordenadas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="composer-lienzo__ayuda">Enter crea la tarjeta en «{lista?.nombre ?? 'la lista'}» y la deja acá · Tab cambia la lista</span>
    </motion.div>
  )
}
