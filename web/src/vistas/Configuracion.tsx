// Configuración (6): un solo lugar para personalizar, con Ctrl/⌘ + ,. A la izquierda las secciones; a la derecha sus
// ajustes, que se aplican al instante (no hay "Guardar"). Esc cierra, el foco queda adentro mientras está abierto y, al
// cerrar, vuelve a donde estaba. El contenido de las secciones se baja aparte la primera vez (ver configuracion/index).
import { Bell, Grid3x3, Info, Keyboard, Palette, Shapes, Sparkles, UserRound, UsersRound, X, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { lazy, Suspense, useLayoutEffect, useRef, type KeyboardEvent as EventoTecla } from 'react'
import { useSesion } from '../estado/sesion'
import { useTienda } from '../estado/tienda'
import { Girando } from '../ui/comunes'
import { MarcaSolicitudes } from '../ui/MarcaSolicitudes'
import { Dialogo } from '../ui/Dialogo'
import { CURVA, RESORTE_PILDORA } from '../util/movimiento'

export type IdSeccion = 'cuenta' | 'amigos' | 'ia' | 'notificaciones' | 'apariencia' | 'lienzo' | 'estilos' | 'atajos' | 'acerca'

export const SECCIONES: { id: IdSeccion; nombre: string; icono: LucideIcon }[] = [
  { id: 'cuenta', nombre: 'Cuenta', icono: UserRound },
  // Solo para la sesión del dueño (invitar es dar permiso): para el resto, esta sección no existe.
  { id: 'amigos', nombre: 'Amigos', icono: UsersRound },
  { id: 'ia', nombre: 'IA', icono: Sparkles },
  { id: 'notificaciones', nombre: 'Notificaciones', icono: Bell },
  { id: 'apariencia', nombre: 'Apariencia', icono: Palette },
  { id: 'lienzo', nombre: 'Lienzo', icono: Grid3x3 },
  { id: 'estilos', nombre: 'Estilos de fábrica', icono: Shapes },
  { id: 'atajos', nombre: 'Atajos', icono: Keyboard },
  { id: 'acerca', nombre: 'Acerca de', icono: Info },
]

const Contenido = lazy(() => import('./configuracion'))

/** Empieza a bajar el contenido antes de abrir (al pasar el mouse por la fila de la barra lateral). */
export const precargarConfiguracion = () => void import('./configuracion')

export function Configuracion() {
  const abierto = useTienda((s) => s.dialogo === 'configuracion')
  const pedida = useTienda((s) => s.seccionConfiguracion)
  const esDueno = useSesion((s) => s.amigos)
  const secciones = SECCIONES.filter((s) => s.id !== 'amigos' || esDueno)
  const seccion: IdSeccion = secciones.some((s) => s.id === pedida) ? (pedida as IdSeccion) : 'apariencia'
  const cerrar = () => useTienda.getState().setDialogo(null)
  const pestanas = useRef<HTMLDivElement>(null)
  const contenido = useRef<HTMLDivElement>(null)
  const actual = secciones.find((s) => s.id === seccion)!
  // Cada sección empieza desde arriba (el contenedor es el mismo para todas).
  useLayoutEffect(() => {
    if (contenido.current) contenido.current.scrollTop = 0
  }, [seccion])

  const ir = (id: IdSeccion) => useTienda.getState().abrirConfiguracion(id)
  // Flechas arriba y abajo (Inicio y Fin) entre las secciones; se elige al llegar, como en las preferencias del sistema.
  const alTecla = (e: EventoTecla<HTMLDivElement>) => {
    const i = secciones.findIndex((s) => s.id === seccion)
    const j =
      e.key === 'ArrowDown'
        ? (i + 1) % secciones.length
        : e.key === 'ArrowUp'
          ? (i - 1 + secciones.length) % secciones.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? secciones.length - 1
              : -1
    if (j < 0) return
    e.preventDefault()
    ir(secciones[j]!.id)
    requestAnimationFrame(() => pestanas.current?.querySelector<HTMLButtonElement>(`[data-seccion='${secciones[j]!.id}']`)?.focus())
  }

  return (
    <Dialogo abierto={abierto} alCerrar={cerrar} tituloId="titulo-configuracion" className="config">
      <nav className="config__nav">
        <h2 id="titulo-configuracion" className="config__titulo">
          Configuración
        </h2>
        <div ref={pestanas} className="config__secciones" role="tablist" aria-orientation="vertical" aria-label="Secciones" onKeyDown={alTecla}>
          {secciones.map((s) => {
            const activa = s.id === seccion
            const Icono = s.icono
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                id={`config-pestana-${s.id}`}
                data-seccion={s.id}
                aria-selected={activa}
                aria-controls="config-panel"
                tabIndex={activa ? 0 : -1}
                className={`config__seccion${activa ? ' config__seccion--activa' : ''}`}
                onClick={() => ir(s.id)}
              >
                {activa && <motion.span layoutId="config-indicador" className="config__indicador" transition={RESORTE_PILDORA} />}
                <Icono size={16} className="config__seccion-icono" />
                <span className="config__seccion-nombre">{s.nombre}</span>
                {s.id === 'amigos' && <MarcaSolicitudes className="config__seccion-marca" />}
              </button>
            )
          })}
        </div>
      </nav>
      <div className="config__cuerpo">
        <header className="config__cabecera">
          <h3 className="config__subtitulo">{actual.nombre}</h3>
          <button type="button" className="boton-icono" onClick={cerrar} aria-label="Cerrar la configuración">
            <X size={18} />
          </button>
        </header>
        <div ref={contenido} className="config__contenido" id="config-panel" role="tabpanel" aria-labelledby={`config-pestana-${seccion}`}>
          <Suspense
            fallback={
              <div className="config__cargando">
                <Girando tam={20} />
              </div>
            }
          >
            <motion.div key={seccion} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: CURVA }}>
              <Contenido seccion={seccion} />
            </motion.div>
          </Suspense>
        </div>
      </div>
    </Dialogo>
  )
}
