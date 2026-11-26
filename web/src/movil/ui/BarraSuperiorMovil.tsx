// Barra superior del teléfono (plan del celular, 4.1): el sello y el nombre del tablero abren el selector de proyectos y
// tableros; a la derecha, la acción de la vista (filtrar en el Kanban), el punto de estado (en vivo, sin conexión, la IA
// trabajando) y el menú (⋮: proyectos, actividad, archivadas, conectar IA, tema, instalar…). El punto y el menú quedan
// siempre en el mismo lugar, en cualquier vista. Cuando la IA trabaja aparece además una pastilla debajo de la barra: verla
// mover tarjetas en vivo es parte de lo que hace especial a Telar. En horizontal mide 40 px y la tira de listas entra en
// la misma fila.
import { Bell, BellRing, ChevronDown, EllipsisVertical, ListFilter, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { hayFiltro } from '../../../../compartido/filtro'
import { esVivo } from '../../../../compartido/ia'
import { avisar } from '../../estado/avisos'
import { useIA } from '../../estado/ia'
import { useRuta } from '../../estado/ruta'
import { useTienda } from '../../estado/tienda'
import { useConexion } from '../../pwa/estado'
import { AnuncioDeTrabajo, nombreDeCampana, NumeroDeCampana } from '../../vistas/Notificaciones'
import { useEsApaisado } from '../detectar'
import { useMovil } from '../estado'
import { SelloProyecto } from './FilaTactil'
import { MarcaSolicitudes } from '../../ui/MarcaSolicitudes'

// «Claude está trabajando… Frenar»: solo mientras un agente de adentro tiene un trabajo vivo (plan 14.4); se baja aparte.
const PastillaTrabajo = lazy(() => import('../../vistas/ia/PastillaTrabajo'))

export function BarraSuperiorMovil() {
  const tablero = useTienda((s) => s.tablero)
  const enVivo = useTienda((s) => s.enVivo)
  const ia = useTienda((s) => s.iaTrabajando)
  const trabajoVivo = useIA((s) => Object.values(s.trabajos).some((t) => esVivo(t.estado)))
  const filtro = useTienda((s) => s.filtro)
  const enLinea = useConexion()
  const sinLeer = useIA((s) => s.sinLeer)
  const hayCampana = useIA((s) => s.estado !== 'no_disponible')
  const ruta = useRuta()
  const apaisado = useEsApaisado()
  const abrir = useMovil((s) => s.abrir)
  const [, forzar] = useState(0)

  // La pastilla de "IA trabajando" se apaga sola.
  useEffect(() => {
    if (!ia) return
    const t = setTimeout(() => forzar((n) => n + 1), Math.max(0, ia.hasta - Date.now()) + 50)
    return () => clearTimeout(t)
  }, [ia])
  const iaActiva = !!ia && ia.hasta > Date.now()
  const estado = !enLinea ? 'caido' : iaActiva ? 'ia' : enVivo ? 'vivo' : 'caido'
  const textoEstado = !enLinea
    ? 'Sin conexión'
    : iaActiva
      ? `${ia!.nombre} está trabajando`
      : enVivo
        ? 'En vivo: lo que hace la IA aparece solo'
        : 'Reconectando…'
  const conFiltro = hayFiltro(filtro)

  return (
    <header className="barra-movil">
      <button
        type="button"
        className="barra-movil__titulo"
        onClick={() => abrir('tableros')}
        aria-haspopup="dialog"
        aria-label={tablero ? `${tablero.proyecto.nombre}, ${tablero.tablero.nombre}. Cambiar de tablero` : 'Elegir tablero'}
      >
        {tablero && <SelloProyecto proyecto={tablero.proyecto} tam={apaisado ? 28 : 32} />}
        <span className="barra-movil__nombre">{tablero?.tablero.nombre ?? 'Telar'}</span>
        <ChevronDown size={16} className="barra-movil__flecha" aria-hidden />
      </button>
      {apaisado && ruta.vista === 'kanban' && <div className="barra-movil__ranura" ref={(el) => useMovil.setState({ ranuraTira: el })} />}
      <span className="barra-movil__espacio" />
      {ruta.vista === 'kanban' && (
        <button
          type="button"
          className={`boton-icono barra-movil__accion${conFiltro ? ' barra-movil__accion--activa' : ''}`}
          onClick={() => abrir('filtros')}
          aria-label={conFiltro ? 'Filtrar (hay un filtro puesto)' : 'Filtrar'}
        >
          <ListFilter size={20} />
          {conFiltro && <span className="barra-movil__marca" aria-hidden />}
        </button>
      )}
      {hayCampana && (
        <button
          type="button"
          className="boton-icono barra-movil__accion campana"
          onClick={() => abrir('notificaciones')}
          aria-haspopup="dialog"
          aria-label={nombreDeCampana(sinLeer)}
        >
          {sinLeer > 0 ? <BellRing size={20} /> : <Bell size={20} />}
          <NumeroDeCampana sinLeer={sinLeer} />
        </button>
      )}
      <button
        type="button"
        className={`barra-movil__estado barra-movil__estado--${estado}`}
        onClick={() => avisar({ texto: textoEstado, tipo: iaActiva ? 'ia' : 'info', duracion: 2000 })}
        aria-label={textoEstado}
      >
        <span className="barra-movil__punto" aria-hidden />
      </button>
      <button
        type="button"
        className="boton-icono barra-movil__menu"
        onClick={() => abrir('mas')}
        aria-haspopup="dialog"
        aria-label="Menú: proyectos, actividad, conectar IA, tema y más"
      >
        <EllipsisVertical size={22} />
        {/* Cuántas solicitudes de cuenta esperan (solo para el dueño): el menú dice dónde están. */}
        <MarcaSolicitudes pegada />
      </button>
      <AnuncioDeTrabajo />
      {trabajoVivo && (
        <Suspense fallback={null}>
          <PastillaTrabajo className="barra-movil__ia barra-movil__ia--trabajo" />
        </Suspense>
      )}
      <AnimatePresence>
        {iaActiva && !trabajoVivo && (
          <motion.div
            className="barra-movil__ia"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.18 }}
            role="status"
          >
            <Sparkles size={14} />
            {ia!.nombre} está trabajando
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
