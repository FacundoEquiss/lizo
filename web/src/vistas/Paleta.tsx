import { Command } from 'cmdk'
import { Activity, Archive, Frame, Grid3x3, Keyboard, Layers, Map as IconoMapa, Monitor, Moon, Pencil, PenTool, Plus, PlugZap, Rows3, Search, Settings, Settings2, Shapes, SquareKanban, Sun, FolderKanban } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ResultadoBusqueda } from '../../../compartido/tipos'
import { tieneVista } from '../../../compartido/vistas'
import { api } from '../estado/api'
import { usePreferencias } from '../estado/preferencias'
import { irA, useRuta } from '../estado/ruta'
import { porOrden, useTienda } from '../estado/tienda'
import { IconoTipo, Kbd } from '../ui/comunes'
import { AvatarProyecto } from '../ui/AvatarProyecto'
import { useComandosDiseno } from './diseno/comandos'

export function Paleta() {
  const abierta = useTienda((s) => s.dialogo === 'paleta')
  const setDialogo = useTienda((s) => s.setDialogo)
  const proyectos = useTienda((s) => s.proyectos)
  const tablero = useTienda((s) => s.tablero)
  const densidad = usePreferencias((s) => s.densidad)
  const ruta = useRuta()
  const comandosDiseno = useComandosDiseno()
  const conKanban = tieneVista(tablero?.tablero, 'kanban')
  const conLienzo = tieneVista(tablero?.tablero, 'lienzo')
  const conDiseno = tieneVista(tablero?.tablero, 'diseno')
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([])
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!abierta) {
      setQ('')
      setResultados([])
    }
  }, [abierta])

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (q.trim().length < 2) {
      setResultados([])
      return
    }
    temporizador.current = setTimeout(() => {
      api
        .buscar(q, { limite: 12 })
        .then(setResultados)
        .catch(() => {})
    }, 140)
  }, [q])

  const cerrar = () => setDialogo(null)
  const hacer = (fn: () => void) => () => {
    cerrar()
    fn()
  }
  const recientes = tablero ? [...tablero.tarjetas].filter((t) => !t.archivada).sort((a, b) => (a.actualizadaEn < b.actualizadaEn ? 1 : -1)).slice(0, 6) : []
  const listaPrimera = tablero ? [...tablero.listas].sort(porOrden)[0] : null

  return (
    <AnimatePresence>
      {abierta && (
        <motion.div className="velo velo--paleta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && cerrar()}>
          <motion.div
            className="paleta"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 36 }}
          >
            <Command
              label="Paleta de comandos"
              loop
              shouldFilter={true}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cerrar()
                }
              }}
            >
              <div className="paleta__buscar">
                <Search size={18} />
                <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Buscá tarjetas (RC-12, texto, tipo:error…) o escribí un comando" />
                <Kbd atajo="Escape" suave />
              </div>
              <Command.List className="paleta__lista">
                <Command.Empty className="paleta__vacio">Nada por acá. Probá con otra palabra.</Command.Empty>
                {resultados.length > 0 && (
                  <Command.Group heading="Tarjetas">
                    {resultados.map((r) => (
                      <Command.Item
                        key={r.tarjeta.id}
                        value={`${r.tarjeta.clave} ${r.tarjeta.titulo} ${q}`}
                        onSelect={hacer(() => {
                          const p = proyectos.find((x) => x.id === r.tarjeta.proyectoId)
                          const tb = p?.tableros.find((x) => x.id === r.tarjeta.tableroId)
                          if (p && tb && tb.id !== tablero?.tablero.id) irA({ prefijo: p.prefijo, slug: tb.slug, tarjeta: r.tarjeta.clave })
                          else useTienda.getState().abrirTarjeta(r.tarjeta.clave)
                        })}
                        className="paleta__item"
                      >
                        <IconoTipo tipo={r.tarjeta.tipo} tam={18} />
                        <span className="paleta__clave">{r.tarjeta.clave}</span>
                        <span className="paleta__texto">{r.tarjeta.titulo}</span>
                        <span className="paleta__detalle">{r.listaNombre}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {q.trim().length < 2 && recientes.length > 0 && (
                  <Command.Group heading="Tocadas hace poco">
                    {recientes.map((t) => (
                      <Command.Item key={t.id} value={`${t.clave} ${t.titulo}`} onSelect={hacer(() => useTienda.getState().abrirTarjeta(t.clave))} className="paleta__item">
                        <IconoTipo tipo={t.tipo} tam={18} />
                        <span className="paleta__clave">{t.clave}</span>
                        <span className="paleta__texto">{t.titulo}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                <Command.Group heading="Acciones">
                  {listaPrimera && conKanban && (
                    <Command.Item
                      value="nueva tarjeta crear"
                      onSelect={hacer(() => {
                        irA({ vista: 'kanban' })
                        setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN' })), 80)
                      })}
                      className="paleta__item"
                    >
                      <Plus size={17} />
                      <span className="paleta__texto">Nueva tarjeta</span>
                      <Kbd atajo="N" suave />
                    </Command.Item>
                  )}
                  {/* Solo las vistas que el tablero tiene. */}
                  {conKanban && (
                    <Command.Item value="ir al kanban vista" onSelect={hacer(() => irA({ vista: 'kanban' }))} className="paleta__item">
                      <SquareKanban size={17} />
                      <span className="paleta__texto">Ir al kanban</span>
                      <Kbd atajo="G K" suave />
                    </Command.Item>
                  )}
                  {conLienzo && (
                    <Command.Item value="ir al lienzo vista canvas" onSelect={hacer(() => irA({ vista: 'lienzo' }))} className="paleta__item">
                      <Frame size={17} />
                      <span className="paleta__texto">Ir al lienzo</span>
                      <Kbd atajo="G L" suave />
                    </Command.Item>
                  )}
                  {conDiseno && (
                    <Command.Item value="ir a diseno vista figma" onSelect={hacer(() => irA({ vista: 'diseno' }))} className="paleta__item">
                      <PenTool size={17} />
                      <span className="paleta__texto">Ir a Diseño</span>
                      <Kbd atajo="G D" suave />
                    </Command.Item>
                  )}
                  {tablero && (
                    <Command.Item value="vistas del tablero sumar sacar kanban lienzo diseno" onSelect={hacer(() => useTienda.getState().abrirVistas(tablero.tablero.id))} className="paleta__item">
                      <Layers size={17} />
                      <span className="paleta__texto">Vistas de este tablero…</span>
                    </Command.Item>
                  )}
                  <Command.Item value="nuevo tablero crear diagrama diseno" onSelect={hacer(() => useTienda.getState().nuevoTablero())} className="paleta__item">
                    <Plus size={17} />
                    <span className="paleta__texto">Nuevo tablero…</span>
                  </Command.Item>
                  {conDiseno && comandosDiseno.map((c) => (
                    <Command.Item key={c.id} value={`diseno ${c.etiqueta} ${c.buscar ?? ''}`} onSelect={hacer(c.accion)} className="paleta__item">
                      <PenTool size={17} />
                      <span className="paleta__texto">{c.etiqueta}</span>
                      {c.atajo && <Kbd atajo={c.atajo} suave />}
                    </Command.Item>
                  ))}
                  {ruta.vista === 'lienzo' && (
                    <Command.Item value="minimapa mostrar ocultar" onSelect={hacer(() => useTienda.getState().alternarMinimapa())} className="paleta__item">
                      <IconoMapa size={17} />
                      <span className="paleta__texto">Mostrar u ocultar el minimapa</span>
                      <Kbd atajo="M" suave />
                    </Command.Item>
                  )}
                  {ruta.vista === 'lienzo' && (
                    <Command.Item value="grilla mostrar ocultar puntos" onSelect={hacer(() => useTienda.getState().alternarGrilla())} className="paleta__item">
                      <Grid3x3 size={17} />
                      <span className="paleta__texto">Mostrar u ocultar la grilla</span>
                      <Kbd atajo="G" suave />
                    </Command.Item>
                  )}
                  {ruta.vista === 'lienzo' && (
                    <Command.Item
                      value="configuración configuracion del lienzo fondo grilla imán iman rueda mouse trackpad"
                      onSelect={hacer(() => useTienda.getState().abrirConfiguracion('lienzo'))}
                      className="paleta__item"
                    >
                      <Settings2 size={17} />
                      <span className="paleta__texto">Configuración del lienzo</span>
                    </Command.Item>
                  )}
                  <Command.Item value="actividad historial" onSelect={hacer(() => useTienda.getState().setPanel('actividad'))} className="paleta__item">
                    <Activity size={17} />
                    <span className="paleta__texto">Ver la actividad</span>
                  </Command.Item>
                  <Command.Item value="archivadas tarjetas" onSelect={hacer(() => useTienda.getState().setPanel('archivadas'))} className="paleta__item">
                    <Archive size={17} />
                    <span className="paleta__texto">Ver tarjetas archivadas</span>
                  </Command.Item>
                  <Command.Item value="nuevo proyecto crear" onSelect={hacer(() => setDialogo('nuevo-proyecto'))} className="paleta__item">
                    <FolderKanban size={17} />
                    <span className="paleta__texto">Nuevo proyecto</span>
                  </Command.Item>
                  <Command.Item value="editar proyecto foto color nombre" onSelect={hacer(() => useTienda.getState().editarProyecto())} className="paleta__item">
                    <Pencil size={17} />
                    <span className="paleta__texto">Editar el proyecto</span>
                  </Command.Item>
                  <Command.Item value="conectar ia mcp claude chatgpt" onSelect={hacer(() => setDialogo('conectar'))} className="paleta__item">
                    <PlugZap size={17} />
                    <span className="paleta__texto">Conectar Claude o ChatGPT (MCP)</span>
                  </Command.Item>
                  <Command.Item value="atajos teclado ayuda" onSelect={hacer(() => setDialogo('atajos'))} className="paleta__item">
                    <Keyboard size={17} />
                    <span className="paleta__texto">Ver todos los atajos</span>
                    <Kbd atajo="?" suave />
                  </Command.Item>
                  <Command.Item value="configuración configuracion preferencias ajustes opciones" onSelect={hacer(() => useTienda.getState().abrirConfiguracion())} className="paleta__item">
                    <Settings size={17} />
                    <span className="paleta__texto">Configuración</span>
                    <Kbd atajo="$mod+," suave />
                  </Command.Item>
                  <Command.Item value="estilos de fábrica fabrica nota forma conector marco texto" onSelect={hacer(() => useTienda.getState().abrirConfiguracion('estilos'))} className="paleta__item">
                    <Shapes size={17} />
                    <span className="paleta__texto">Estilos de fábrica de los objetos nuevos</span>
                  </Command.Item>
                </Command.Group>
                <Command.Group heading="Tema">
                  <Command.Item value="tema claro" onSelect={hacer(() => useTienda.getState().setTema('claro'))} className="paleta__item">
                    <Sun size={17} />
                    <span className="paleta__texto">Tema claro</span>
                  </Command.Item>
                  <Command.Item value="tema oscuro" onSelect={hacer(() => useTienda.getState().setTema('oscuro'))} className="paleta__item">
                    <Moon size={17} />
                    <span className="paleta__texto">Tema oscuro</span>
                  </Command.Item>
                  <Command.Item value="tema sistema" onSelect={hacer(() => useTienda.getState().setTema('sistema'))} className="paleta__item">
                    <Monitor size={17} />
                    <span className="paleta__texto">Tema del sistema</span>
                  </Command.Item>
                  <Command.Item
                    value="densidad compacta cómoda comoda espacio"
                    onSelect={hacer(() => usePreferencias.getState().cambiar({ densidad: densidad === 'compacta' ? 'comoda' : 'compacta' }))}
                    className="paleta__item"
                  >
                    <Rows3 size={17} />
                    <span className="paleta__texto">{densidad === 'compacta' ? 'Densidad cómoda' : 'Densidad compacta'}</span>
                  </Command.Item>
                </Command.Group>
                <Command.Group heading="Tableros">
                  {proyectos.flatMap((p) =>
                    p.tableros.map((t) => (
                      <Command.Item
                        key={t.id}
                        value={`${p.nombre} ${p.prefijo} ${t.nombre}`}
                        onSelect={hacer(() => irA({ prefijo: p.prefijo, slug: t.slug, tarjeta: null }))}
                        className="paleta__item"
                      >
                        <AvatarProyecto proyecto={p} tam={20} />
                        <span className="paleta__texto">
                          {p.nombre} / {t.nombre}
                        </span>
                      </Command.Item>
                    )),
                  )}
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
