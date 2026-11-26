// "Archivados (2)" al final de la barra lateral (7.1): plegada; abierta, los proyectos y tableros archivados, apagados,
// con "Restaurar" al pasar el mouse.
import { ChevronRight, RotateCcw } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { Proyecto } from '../../../../compartido/tipos'
import { api } from '../../estado/api'
import { useTienda } from '../../estado/tienda'
import { AvatarProyecto } from '../../ui/AvatarProyecto'
import { movimientoReducido } from '../../util/movimiento'

export function Archivados() {
  const proyectos = useTienda((s) => s.proyectos)
  const [todos, setTodos] = useState<Proyecto[] | null>(null)
  const [abierto, setAbierto] = useState(false)
  // Se vuelve a pedir cuando cambian los proyectos (archivar o restaurar algo).
  useEffect(() => {
    let vigente = true
    api
      .proyectos({ archivados: true })
      .then((r) => vigente && setTodos(r))
      .catch(() => {})
    return () => {
      vigente = false
    }
  }, [proyectos])
  if (!todos) return null
  const proyectosArchivados = todos.filter((p) => p.archivado)
  const tablerosArchivados = todos.filter((p) => !p.archivado).flatMap((p) => p.tableros.filter((t) => t.archivado).map((t) => ({ p, t })))
  const n = proyectosArchivados.length + tablerosArchivados.length
  if (!n) return null
  return (
    <div className="archivados">
      <button type="button" className="archivados__titulo" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
        <ChevronRight size={14} className={`archivados__flecha${abierto ? ' archivados__flecha--abierta' : ''}`} />
        Archivados ({n})
      </button>
      <AnimatePresence initial={false}>
        {abierto && (
          <motion.div
            className="archivados__lista"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: movimientoReducido() ? 0 : 0.2, ease: [0.15, 1, 0.3, 1] }}
          >
            {proyectosArchivados.map((p) => (
              <div key={p.id} className="archivados__fila">
                <AvatarProyecto proyecto={p} tam={20} />
                <span className="archivados__nombre" title={p.nombre}>
                  {p.nombre}
                </span>
                <button type="button" className="archivados__restaurar" onClick={() => void useTienda.getState().archivarProyecto(p.id, false)}>
                  <RotateCcw size={13} /> Restaurar
                </button>
              </div>
            ))}
            {tablerosArchivados.map(({ p, t }) => (
              <div key={t.id} className="archivados__fila">
                <span className="archivados__tablero" style={{ background: `var(--e-${p.color}-s)` }} />
                <span className="archivados__nombre" title={`${t.nombre} · ${p.nombre}`}>
                  {t.nombre} <small>· {p.nombre}</small>
                </span>
                <button type="button" className="archivados__restaurar" onClick={() => void useTienda.getState().archivarTablero(t.id, false)}>
                  <RotateCcw size={13} /> Restaurar
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
