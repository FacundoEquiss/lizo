import { Activity, Archive, Frame, PanelLeft, PenTool, Search, SquareKanban, Sparkles, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { tinykeys } from 'tinykeys'
import { esVivo } from '../../../compartido/ia'
import { hayFiltro } from '../../../compartido/filtro'
import { tieneVista } from '../../../compartido/vistas'
import { useIA } from '../estado/ia'
import { irA, useRuta } from '../estado/ruta'
import { useTienda } from '../estado/tienda'
import { AvatarProyecto } from '../ui/AvatarProyecto'
import { Kbd } from '../ui/comunes'
import { escribiendo } from '../util/teclas'
import { Campana } from './Notificaciones'

// «Claude está trabajando… Frenar»: solo mientras un agente de adentro tiene un trabajo vivo (plan 14.4); se baja aparte.
const PastillaTrabajo = lazy(() => import('./ia/PastillaTrabajo'))

const PESTANAS = [
  ['kanban', 'Kanban', SquareKanban, 'g k'],
  ['lienzo', 'Lienzo', Frame, 'g l'],
  ['diseno', 'Diseño', PenTool, 'g d'],
] as const

export function BarraSuperior() {
  const tablero = useTienda((s) => s.tablero)
  const filtro = useTienda((s) => s.filtro)
  const setFiltro = useTienda((s) => s.setFiltro)
  const enVivo = useTienda((s) => s.enVivo)
  const ia = useTienda((s) => s.iaTrabajando)
  const trabajoVivo = useIA((s) => Object.values(s.trabajos).some((t) => esVivo(t.estado)))
  const panel = useTienda((s) => s.panel)
  const setPanel = useTienda((s) => s.setPanel)
  const lateralAbierto = useTienda((s) => s.lateralAbierto)
  const alternarLateral = useTienda((s) => s.alternarLateral)
  const ruta = useRuta()
  const refFiltro = useRef<HTMLInputElement>(null)
  const [, forzar] = useState(0)

  // El aviso de "IA trabajando" se apaga solo.
  useEffect(() => {
    if (!ia) return
    const t = setTimeout(() => forzar((n) => n + 1), Math.max(0, ia.hasta - Date.now()) + 50)
    return () => clearTimeout(t)
  }, [ia])
  const iaActiva = ia && ia.hasta > Date.now()

  useEffect(
    () =>
      tinykeys(window, {
        KeyF: (e) => {
          if (escribiendo(e) || ruta.vista !== 'kanban' || useTienda.getState().claveAbierta) return
          e.preventDefault()
          refFiltro.current?.focus()
        },
        Slash: (e) => {
          if (escribiendo(e) || ruta.vista !== 'kanban') return
          e.preventDefault()
          refFiltro.current?.focus()
        },
        '$mod+KeyF': (e) => {
          if (ruta.vista !== 'kanban') return
          e.preventDefault()
          refFiltro.current?.focus()
        },
        KeyX: (e) => {
          if (escribiendo(e) || useTienda.getState().claveAbierta) return
          if (useTienda.getState().filtro) useTienda.getState().setFiltro('')
        },
        KeyQ: (e) => {
          if (escribiendo(e) || ruta.vista !== 'kanban' || useTienda.getState().claveAbierta) return
          const f = useTienda.getState().filtro
          useTienda.getState().setFiltro(f.includes('@yo') ? f.replace(/\s*@yo\b/, '').trim() : `${f} @yo`.trim())
        },
      }),
    [ruta.vista],
  )

  if (!tablero) return <header className="barra" />
  const { proyecto } = tablero
  // Solo las vistas que el tablero tiene (compartido/vistas.ts).
  const pestanas = PESTANAS.filter(([id]) => tieneVista(tablero.tablero, id))

  return (
    <header className="barra">
      <div className="barra__izq">
        {!lateralAbierto && (
          <button className="boton-icono" onClick={alternarLateral} data-tip="Mostrar barra" data-tecla="[" aria-label="Mostrar barra lateral">
            <PanelLeft size={17} />
          </button>
        )}
        <div className="miga">
          <AvatarProyecto proyecto={proyecto} tam={22} className="miga__avatar" />
          <span className="miga__proyecto">{proyecto.nombre}</span>
          <span className="miga__sep">/</span>
          <span className="miga__tablero">{tablero.tablero.nombre}</span>
        </div>
        {/* Un tablero con una sola vista no tiene pestañas: entra directo a esa vista. */}
        {pestanas.length > 1 && (
          <div className="pestanas" role="tablist">
            {pestanas.map(([id, nombre, Icono, tecla]) => (
              <button
                key={id}
                role="tab"
                aria-selected={ruta.vista === id}
                className={`pestana${ruta.vista === id ? ' pestana--activa' : ''}`}
                onClick={() => irA({ vista: id })}
                data-tip={nombre}
                data-tecla={tecla}
              >
                {ruta.vista === id && <motion.span layoutId="pestana-activa" className="pestana__fondo" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
                <Icono size={15} />
                <span>{nombre}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="barra__der">
        {ruta.vista === 'kanban' && (
          <label className={`filtro${hayFiltro(filtro) ? ' filtro--activo' : ''}`}>
            <Search size={15} />
            <input
              ref={refFiltro}
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (filtro) setFiltro('')
                  else e.currentTarget.blur()
                }
              }}
              placeholder="Filtrar…  #área  @yo  tipo:error"
              spellCheck={false}
            />
            {filtro ? (
              <button className="filtro__limpiar" onClick={() => setFiltro('')} aria-label="Limpiar filtro">
                <X size={14} />
              </button>
            ) : (
              <Kbd atajo="F" suave />
            )}
          </label>
        )}
        {trabajoVivo ? (
          <Suspense fallback={null}>
            <PastillaTrabajo />
          </Suspense>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            {iaActiva ? (
              <motion.span
                key="ia"
                className="en-vivo en-vivo--ia"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <Sparkles size={13} />
                {ia!.nombre} está trabajando
              </motion.span>
            ) : (
              <motion.span
                key="vivo"
                className={`en-vivo${enVivo ? '' : ' en-vivo--caido'}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                data-tip={enVivo ? 'Los cambios de la IA y de otras pestañas aparecen solos' : 'Reconectando…'}
              >
                <span className="en-vivo__punto" />
                {enVivo ? 'En vivo' : 'Sin conexión'}
              </motion.span>
            )}
          </AnimatePresence>
        )}
        <button
          className={`boton-icono${panel === 'archivadas' ? ' boton-icono--activo' : ''}`}
          onClick={() => setPanel('archivadas')}
          data-tip="Archivadas"
          aria-label="Tarjetas archivadas"
        >
          <Archive size={17} />
        </button>
        <Campana />
        <button
          className={`boton-icono${panel === 'actividad' ? ' boton-icono--activo' : ''}`}
          onClick={() => setPanel('actividad')}
          data-tip="Actividad"
          data-tecla="g a"
          aria-label="Actividad"
        >
          <Activity size={17} />
        </button>
      </div>
    </header>
  )
}
