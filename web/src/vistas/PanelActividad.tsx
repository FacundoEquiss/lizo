import { ArchiveRestore, Sparkles, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { TarjetaResumen } from '../../../compartido/tipos'
import { api } from '../estado/api'
import { avisarError } from '../estado/avisos'
import { useTienda } from '../estado/tienda'
import { IconoTipo } from '../ui/comunes'
import { hace } from '../util/fechas'

export function PanelActividad() {
  const panel = useTienda((s) => s.panel)
  const actividad = useTienda((s) => s.actividad)
  const tablero = useTienda((s) => s.tablero)
  const setPanel = useTienda((s) => s.setPanel)
  const [archivadas, setArchivadas] = useState<TarjetaResumen[]>([])
  const [soloIA, setSoloIA] = useState(false)

  useEffect(() => {
    if (panel === 'archivadas' && tablero) api.archivadas(tablero.tablero.id).then(setArchivadas).catch(avisarError)
  }, [panel, tablero?.tablero.id, tablero?.tarjetas])

  const lista = soloIA ? actividad.filter((a) => a.actor.tipo === 'ia') : actividad
  return (
    <AnimatePresence>
      {panel && (
        <motion.aside
          className="panel"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 460, damping: 40 }}
        >
          <header className="panel__cabecera">
            <h2>{panel === 'actividad' ? 'Actividad' : 'Archivadas'}</h2>
            {panel === 'actividad' && (
              <button className={`pildora${soloIA ? ' pildora--activa' : ''}`} onClick={() => setSoloIA(!soloIA)}>
                <Sparkles size={13} /> Solo IA
              </button>
            )}
            <button className="boton-icono" onClick={() => setPanel(panel)} aria-label="Cerrar panel">
              <X size={17} />
            </button>
          </header>
          {panel === 'actividad' ? (
            <ol className="panel__lista actividad">
              {lista.length === 0 && <li className="panel__nada">Todavía no pasó nada.</li>}
              {lista.map((a) => (
                <li key={a.id} className={`actividad__item${a.actor.tipo === 'ia' ? ' actividad__item--ia' : ''}`}>
                  <span className={`actividad__autor actividad__autor--${a.actor.tipo}`}>
                    {a.actor.tipo === 'ia' ? <Sparkles size={12} /> : a.actor.nombre.slice(0, 1)}
                  </span>
                  <div className="actividad__cuerpo">
                    <p>
                      <b>{a.actor.nombre}</b> {a.resumen}
                    </p>
                    <span className="actividad__meta">
                      {hace(a.creadoEn)}
                      {a.actor.cliente && a.actor.cliente !== a.actor.nombre ? ` · ${a.actor.cliente}` : ''}
                      {a.tarjetaClave && (
                        <>
                          {' · '}
                          <button className="enlace" onClick={() => useTienda.getState().abrirTarjeta(a.tarjetaClave!)}>
                            {a.tarjetaClave}
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <ul className="panel__lista">
              {archivadas.length === 0 && <li className="panel__nada">No hay tarjetas archivadas.</li>}
              {archivadas.map((t) => (
                <li key={t.id} className="archivada">
                  <button className="archivada__tarjeta" onClick={() => useTienda.getState().abrirTarjeta(t.clave)}>
                    <IconoTipo tipo={t.tipo} tam={15} />
                    <span className="mono">{t.clave}</span>
                    <span className="archivada__titulo">{t.titulo}</span>
                  </button>
                  <button
                    className="boton boton--chico"
                    onClick={async () => {
                      await useTienda.getState().archivarTarjeta(t.id, false)
                      setArchivadas((x) => x.filter((y) => y.id !== t.id))
                    }}
                  >
                    <ArchiveRestore size={13} /> Restaurar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
