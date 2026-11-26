import { Keyboard, Monitor, Moon, PanelLeftClose, Plus, Search, Settings, Sun, PlugZap } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { usePreferencias } from '../estado/preferencias'
import { useTienda, type Tema } from '../estado/tienda'
import { Avatar, Kbd } from '../ui/comunes'
import { MarcaTelar } from '../ui/marcas'
import { RESORTE_PILDORA } from '../util/movimiento'
import { precargarConfiguracion } from './Configuracion'
import { Archivados } from './lateral/Archivados'
import { TarjetaProyecto } from './lateral/TarjetaProyecto'
import { EstadoVacio } from '../ui/EstadoVacio'
import { MarcaSolicitudes } from '../ui/MarcaSolicitudes'

export function BarraLateral() {
  const proyectos = useTienda((s) => s.proyectos)
  const tablero = useTienda((s) => s.tablero)
  const tema = useTienda((s) => s.tema)
  const setTema = useTienda((s) => s.setTema)
  const setDialogo = useTienda((s) => s.setDialogo)
  const alternar = useTienda((s) => s.alternarLateral)
  const info = useTienda((s) => s.info)
  const yo = useTienda((s) => s.miembros.find((m) => m.esYo))
  const plegados = usePreferencias((s) => s.proyectosPlegados)
  const [desplegados, setDesplegados] = useState<ReadonlySet<string>>(new Set())

  const temas: { id: Tema; icono: typeof Sun; nombre: string }[] = [
    { id: 'claro', icono: Sun, nombre: 'Claro' },
    { id: 'oscuro', icono: Moon, nombre: 'Oscuro' },
    { id: 'sistema', icono: Monitor, nombre: 'Sistema' },
  ]

  return (
    <aside className="lateral">
      <div className="lateral__cabecera">
        <div className="marca">
          <span className="marca__logo" aria-hidden>
            <MarcaTelar size={24} />
          </span>
          <span className="marca__nombre">Telar</span>
        </div>
        <button className="boton-icono" onClick={alternar} data-tip="Ocultar barra" data-tecla="[" aria-label="Ocultar barra lateral">
          <PanelLeftClose size={17} />
        </button>
      </div>

      <button className="lateral__buscar" onClick={() => setDialogo('paleta')}>
        <Search size={15} />
        <span>Buscar o hacer algo…</span>
        <Kbd atajo="$mod+K" suave />
      </button>

      <nav className="lateral__nav">
        <div className="lateral__titulo">
          <span>Proyectos</span>
          <button className="boton-icono boton-icono--chico" onClick={() => setDialogo('nuevo-proyecto')} data-tip="Nuevo proyecto" aria-label="Nuevo proyecto">
            <Plus size={15} />
          </button>
        </div>
        {/* La invitación grande a crear uno está en la escena (SinProyectos): acá, el mismo molde en chico. */}
        {proyectos.length === 0 && <EstadoVacio chico className="lateral__vacio" titulo="Todavía no hay proyectos" ayuda="Creá el primero con el + de arriba" />}
        {proyectos.map((p) => {
          // El activo se abre solo (salvo que se lo haya plegado); los demás, solo si se los desplegó.
          const activo = tablero?.proyecto.id === p.id
          const abierto = activo ? !plegados.includes(p.id) : desplegados.has(p.id)
          return (
            <TarjetaProyecto
              key={p.id}
              proyecto={p}
              abierto={abierto}
              alPlegar={() => {
                if (activo) {
                  const lista = abierto ? [...plegados, p.id] : plegados.filter((x) => x !== p.id)
                  usePreferencias.getState().cambiar({ proyectosPlegados: lista })
                } else {
                  const d = new Set(desplegados)
                  if (abierto) d.delete(p.id)
                  else d.add(p.id)
                  setDesplegados(d)
                }
              }}
            />
          )
        })}
        <Archivados />
      </nav>

      <div className="lateral__pie">
        <button
          className="lateral__accion"
          onClick={() => useTienda.getState().abrirConfiguracion('cuenta')}
          onPointerEnter={precargarConfiguracion}
          onFocus={precargarConfiguracion}
          data-tip="Mi perfil y cerrar sesión"
        >
          <Avatar miembro={yo} tam={18} />
          <span>{yo?.nombre ?? 'Mi cuenta'}</span>
        </button>
        <button className="lateral__accion" onClick={() => setDialogo('conectar')}>
          <PlugZap size={16} />
          <span>Conectar IA</span>
          <span className={`punto-estado${info ? ' punto-estado--ok' : ''}`} />
        </button>
        <button
          className="lateral__accion"
          onClick={() => useTienda.getState().abrirConfiguracion()}
          onPointerEnter={precargarConfiguracion}
          onFocus={precargarConfiguracion}
        >
          <Settings size={16} />
          <span>Configuración</span>
          <MarcaSolicitudes />
          <Kbd atajo="$mod+," suave />
        </button>
        <button className="lateral__accion" onClick={() => setDialogo('atajos')}>
          <Keyboard size={16} />
          <span>Atajos</span>
          <Kbd atajo="?" suave />
        </button>
        <div className="selector-tema" role="radiogroup" aria-label="Tema">
          {temas.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={tema === t.id}
              className={`selector-tema__opcion${tema === t.id ? ' selector-tema__opcion--activa' : ''}`}
              onClick={() => setTema(t.id)}
              data-tip={t.nombre}
            >
              {tema === t.id && <motion.span layoutId="tema-activo" className="selector-tema__fondo" transition={RESORTE_PILDORA} />}
              <t.icono size={15} />
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
