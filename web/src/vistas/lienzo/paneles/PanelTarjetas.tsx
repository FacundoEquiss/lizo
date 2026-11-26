// Panel "Tarjetas del Kanban" (5.6): las mismas tarjetas del tablero, para traerlas al lienzo. Lo dice arriba, siempre.
// Las que ya están llevan un alfiler (clic: ir a ella); las demás, al pasar el mouse, un "+" (o arrastrarlas). El nombre
// de cada lista también se arrastra: trae la lista entera (la columna viva).
import { GripVertical, MapPin, Plus, Search, SearchX, SquareKanban, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { normalizar } from '../../../../../compartido/texto'
import { porOrden, useTienda } from '../../../estado/tienda'
import { IconoTipo } from '../../../ui/comunes'
import { EstadoVacio } from '../../../ui/EstadoVacio'

export function PanelTarjetas({ alCerrar, alAgregar }: { alCerrar: () => void; alAgregar: (tarjetaId: string) => void }) {
  const tablero = useTienda((s) => s.tablero)!
  const [q, setQ] = useState('')
  const enLienzo = useMemo(() => new Set(tablero.elementos.filter((e) => e.tarjetaId).map((e) => e.tarjetaId!)), [tablero.elementos])
  const listas = useMemo(() => [...tablero.listas].filter((l) => !l.archivada).sort(porOrden), [tablero.listas])
  const nq = normalizar(q.trim())
  const activas = tablero.tarjetas.filter((t) => !t.archivada)
  const grupos = listas
    .map((l) => ({
      lista: l,
      tarjetas: activas.filter((t) => t.listaId === l.id && (!nq || normalizar(`${t.clave} ${t.titulo}`).includes(nq))).sort(porOrden),
    }))
    .filter((g) => g.tarjetas.length > 0)
  return (
    <motion.aside
      className="panel-tarjetas"
      aria-label="Tarjetas del Kanban"
      initial={{ x: -24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -24, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 480, damping: 40 }}
    >
      <header className="panel-tarjetas__cabecera">
        <SquareKanban size={16} />
        <b>Tarjetas del Kanban</b>
        <button className="boton-icono boton-icono--chico" onClick={alCerrar} aria-label="Cerrar">
          <X size={15} />
        </button>
      </header>
      <p className="panel-tarjetas__explicacion">
        <b>Son las mismas tarjetas del tablero.</b> Traelas al lienzo para ubicarlas en un mapa, conectarlas y agruparlas en marcos. No se copian: lo
        que cambies acá, cambia en el Kanban.
      </p>
      {activas.length > 0 && (
        <label className="panel-tarjetas__buscar">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por clave o título…" aria-label="Buscar tarjetas" />
        </label>
      )}
      <div className="panel-tarjetas__lista">
        {activas.length === 0 ? (
          <EstadoVacio className="estado-vacio--panel" icono={SquareKanban} titulo="Este tablero todavía no tiene tarjetas" ayuda="Creá una acá con D o desde el Kanban" />
        ) : grupos.length === 0 ? (
          <EstadoVacio className="estado-vacio--panel" icono={SearchX} titulo={<>Ninguna tarjeta con «{q.trim()}»</>} />
        ) : (
          grupos.map(({ lista: l, tarjetas }) => (
            <div key={l.id} className="panel-tarjetas__grupo">
              <div
                className="panel-tarjetas__lista-nombre"
                draggable
                title="Arrastrá el nombre para traer la lista entera"
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-tablero-lista', l.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
              >
                <GripVertical size={12} className="panel-tarjetas__agarre" aria-hidden />
                <span className={`punto-categoria${l.categoria ? ` punto-categoria--${l.categoria}` : ''}`} />
                {l.nombre}
                <span>{tarjetas.length}</span>
              </div>
              {tarjetas.map((t) => {
                const ya = enLienzo.has(t.id)
                return (
                  <div
                    key={t.id}
                    className={`mini-tarjeta${ya ? ' mini-tarjeta--en-lienzo' : ''}`}
                    draggable={!ya}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-tablero-tarjeta', t.id)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => ya && alAgregar(t.id)}
                    onDoubleClick={() => !ya && alAgregar(t.id)}
                    title={ya ? 'Ya está en el lienzo: hacé clic para ir' : 'Arrastrala al lienzo o hacé doble clic'}
                  >
                    <IconoTipo tipo={t.tipo} tam={14} />
                    <span className="mini-tarjeta__clave">{t.clave}</span>
                    <span className="mini-tarjeta__titulo">{t.titulo}</span>
                    {ya ? (
                      <MapPin size={13} className="mini-tarjeta__alfiler" aria-label="Ya está en el lienzo" />
                    ) : (
                      <button
                        type="button"
                        className="mini-tarjeta__agregar"
                        aria-label={`Traer ${t.clave} al lienzo`}
                        onClick={(e) => {
                          e.stopPropagation()
                          alAgregar(t.id)
                        }}
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </motion.aside>
  )
}
