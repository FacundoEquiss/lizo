import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  ChevronDown,
  Copy,
  Ellipsis,
  FileText,
  Frame,
  GitBranch,
  Hash,
  Link2,
  ListChecks,
  Paperclip,
  Plus,
  Tag,
  Upload,
  UserRound,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CATEGORIAS, COLORES, PRIORIDADES, TIPOS_TARJETA } from '../../../../compartido/constantes'
import { nombreDeRama } from '../../../../compartido/enlaces'
import type { Color, TarjetaDetalle } from '../../../../compartido/tipos'
import { api } from '../../estado/api'
import { avisar, avisarError } from '../../estado/avisos'
import { irA } from '../../estado/ruta'
import { porOrden, useTienda } from '../../estado/tienda'
import { Avatar, ChipEtiqueta, Girando, IconoPrioridad, IconoTipo, Kbd, TextoAuto } from '../../ui/comunes'
import { CampoConMenciones } from '../../ui/CampoConMenciones'
import { Markdown } from '../../ui/Markdown'
import { Desplegable, Menu, Selector } from '../../ui/Desplegable'
import { aInputFecha, aInputHora, desdeInputs, fechaCorta, hace, urgencia } from '../../util/fechas'
import { SeccionPorque } from './SeccionPorque'
import { SeccionAdjuntos, SeccionChecklists, SeccionComentarios, SeccionDiscord, SeccionEnlaces, SeccionVinculos, Titulo } from './Secciones'
import { SeccionDisenos } from '../diseno/TarjetaDisenos'

export function DetalleTarjeta() {
  const clave = useTienda((s) => s.claveAbierta)
  const detalle = useTienda((s) => s.detalle)
  const origen = useTienda((s) => s.origenApertura)
  const cerrar = useTienda((s) => s.cerrarTarjeta)

  useEffect(() => {
    if (!clave) return
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        const t = e.target as HTMLElement
        if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return
        cerrar()
      }
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [clave, cerrar])

  // La hoja "sale" desde la tarjeta que se tocó.
  const desde = useMemo(() => {
    if (!origen) return { opacity: 0, scale: 0.97, y: 14 }
    const cx = origen.x + origen.ancho / 2 - window.innerWidth / 2
    const cy = origen.y + origen.alto / 2 - window.innerHeight / 2
    return { opacity: 0, scale: 0.6, x: cx * 0.6, y: cy * 0.6 }
  }, [origen])

  const t = detalle && (detalle.clave === clave || detalle.id === clave) ? detalle : null

  return (
    <AnimatePresence>
      {clave && (
        <motion.div
          key="velo"
          className="velo"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cerrar()
          }}
        >
          <motion.article
            className="hoja"
            role="dialog"
            aria-label={t ? `${t.clave} ${t.titulo}` : 'Tarjeta'}
            initial={desde}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10, transition: { duration: 0.16, ease: [0.32, 0, 0.67, 0] } }}
            transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.9 }}
          >
            {t ? <Contenido t={t} /> : <div className="hoja__cargando"><Girando tam={22} /></div>}
          </motion.article>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Contenido({ t }: { t: TarjetaDetalle }) {
  const tablero = useTienda((s) => s.tablero)
  const cerrar = useTienda((s) => s.cerrarTarjeta)
  const [arrastrandoArchivo, setArrastrandoArchivo] = useState(false)
  const [subiendo, setSubiendo] = useState(0)
  const refArchivo = useRef<HTMLInputElement>(null)

  const subir = async (archivos: FileList | File[]) => {
    const lista = [...archivos]
    if (!lista.length) return
    setSubiendo((n) => n + lista.length)
    for (const a of lista) {
      try {
        await api.subirAdjunto(t.clave, a)
      } catch (e) {
        avisarError(e)
      } finally {
        setSubiendo((n) => n - 1)
      }
    }
    useTienda.getState().recargarDetalle()
  }

  const crearChecklist = async () => {
    try {
      await api.crearChecklist(t.clave, 'Checklist')
      await useTienda.getState().recargarDetalle()
    } catch (e) {
      avisarError(e)
    }
  }

  return (
    <div
      className={`hoja__marco${arrastrandoArchivo ? ' hoja__marco--soltar' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setArrastrandoArchivo(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setArrastrandoArchivo(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setArrastrandoArchivo(false)
        subir(e.dataTransfer.files)
      }}
    >
      <input ref={refArchivo} type="file" multiple hidden onChange={(e) => e.target.files && subir(e.target.files)} />
      {t.portada?.tipo === 'imagen' && (
        <div className="hoja__portada">
          <img src={t.portada.valor} alt="" />
        </div>
      )}
      {t.portada?.tipo === 'color' && <div className="hoja__portada hoja__portada--color" style={{ background: `var(--e-${t.portada.valor}-s)` }} />}
      <header className="hoja__cabecera">
        <SelectorTipo t={t} />
        <button
          className="hoja__clave"
          onClick={() => {
            navigator.clipboard.writeText(t.clave)
            avisar({ texto: `${t.clave} copiada`, tipo: 'ok', duracion: 1500 })
          }}
          data-tip="Copiar clave"
        >
          {t.clave}
        </button>
        <span className="hoja__en">en</span>
        <SelectorLista t={t} />
        {t.archivada && <span className="hoja__archivada">Archivada</span>}
        <span className="hoja__espacio" />
        <Menu
          disparador={(p) => (
            <button {...p} className="boton-icono" aria-label="Más acciones">
              <Ellipsis size={18} />
            </button>
          )}
          items={[
            {
              id: 'link',
              etiqueta: 'Copiar link',
              icono: <Link2 size={15} />,
              alElegir: () => {
                navigator.clipboard.writeText(`${location.origin}${location.pathname}?tarjeta=${t.clave}`)
                avisar({ texto: 'Link copiado', tipo: 'ok', duracion: 1500 })
              },
            },
            {
              id: 'rama',
              etiqueta: 'Copiar nombre de rama',
              icono: <GitBranch size={15} />,
              atajo: '$mod+Shift+.',
              alElegir: () => copiarRama(t),
            },
            {
              id: 'lienzo',
              etiqueta: t.enLienzo.length ? 'Ver en el lienzo' : 'Mostrar en el lienzo',
              icono: <Frame size={15} />,
              alElegir: () => mostrarEnLienzo(t),
            },
            {
              id: 'copiar',
              etiqueta: 'Duplicar tarjeta',
              icono: <Copy size={15} />,
              alElegir: async () => {
                try {
                  const c = await api.copiarTarjeta(t.clave)
                  useTienda.getState().ponerTarjeta(c)
                  avisar({ texto: `Copiada como ${c.clave}`, tipo: 'ok', accion: { etiqueta: 'Abrir', fn: () => useTienda.getState().abrirTarjeta(c.clave) } })
                } catch (e) {
                  avisarError(e)
                }
              },
            },
            t.archivada
              ? { id: 'restaurar', etiqueta: 'Restaurar', icono: <ArchiveRestore size={15} />, separador: true, alElegir: () => useTienda.getState().archivarTarjeta(t.id, false) }
              : { id: 'archivar', etiqueta: 'Archivar', icono: <Archive size={15} />, atajo: 'C', peligro: true, separador: true, alElegir: () => useTienda.getState().archivarTarjeta(t.id) },
          ]}
        />
        <button className="boton-icono" onClick={cerrar} aria-label="Cerrar" data-tip="Cerrar" data-tecla="Esc">
          <X size={18} />
        </button>
      </header>

      <div className="hoja__cuerpo">
        <div className="hoja__principal">
          <TituloEditable t={t} />
          <div className="hoja__agregar">
            <SelectorEtiquetas t={t} compacto />
            <SelectorResponsables t={t} compacto />
            <SelectorFechas t={t} compacto />
            <button className="pildora" onClick={crearChecklist}>
              <ListChecks size={14} /> Checklist
            </button>
            <button className="pildora" onClick={() => refArchivo.current?.click()}>
              <Paperclip size={14} /> Adjunto
            </button>
            {subiendo > 0 && (
              <span className="pildora pildora--estado">
                <Girando tam={12} /> Subiendo {subiendo}…
              </span>
            )}
          </div>

          <Descripcion t={t} />
          <SeccionPorque tarjeta={t} />
          <SeccionDiscord tarjeta={t} />
          <SeccionChecklists tarjeta={t} />
          <SeccionAdjuntos tarjeta={t} alSubir={() => refArchivo.current?.click()} />
          <SeccionDisenos tarjeta={t} />
          <SeccionVinculos tarjeta={t} />
          <SeccionComentarios tarjeta={t} />
        </div>

        <aside className="hoja__lateral">
          <Propiedad nombre="Prioridad">
            <SelectorPrioridad t={t} />
          </Propiedad>
          <Propiedad nombre="Responsables">
            <SelectorResponsables t={t} />
          </Propiedad>
          <Propiedad nombre="Etiquetas">
            <SelectorEtiquetas t={t} />
          </Propiedad>
          <Propiedad nombre="Fechas">
            <SelectorFechas t={t} />
          </Propiedad>
          <Propiedad nombre="Estimación">
            <Estimacion t={t} />
          </Propiedad>
          <Propiedad nombre="Épica">
            <SelectorEpica t={t} />
          </Propiedad>
          {/* Lo que en el celular va al final de la tarjeta (N6): en escritorio este envoltorio no existe para el diseño. */}
          <div className="hoja__lateral-extra" style={{ display: 'contents' }}>
          <Propiedad nombre="Enlaces">
            <SeccionEnlaces tarjeta={t} />
          </Propiedad>
          {t.repoGithub && (
            <Propiedad nombre="GitHub">
              <button className="rama" onClick={() => copiarRama(t)} data-tip="Copiar nombre de rama" data-tecla="$mod+Shift+.">
                <GitBranch size={14} />
                <span className="mono">{nombreDeRama(t.clave, t.titulo)}</span>
                <Copy size={13} />
              </button>
              <p className="propiedad__ayuda">
                Poné <b className="mono">{t.clave}</b> en la rama, el commit o el título del PR en <span className="mono">{t.repoGithub}</span>.
              </p>
            </Propiedad>
          )}
          <Propiedad nombre="Portada">
            <SelectorPortada t={t} />
          </Propiedad>
          <div className="hoja__origen">
            {t.origen && (
              <span>
                Creada por <b>{t.origen.nombre}</b> {hace(t.creadaEn)}
              </span>
            )}
            <span>Actualizada {hace(t.actualizadaEn)}</span>
            {tablero && t.tableroId !== tablero.tablero.id && <span>De otro tablero</span>}
          </div>
          </div>
          <button className="boton boton--fantasma boton--ancho" onClick={() => mostrarEnLienzo(t)}>
            <Frame size={14} /> {t.enLienzo.length ? 'Ver en el lienzo' : 'Mostrar en el lienzo'}
          </button>
          {!t.archivada ? (
            <button className="boton boton--fantasma boton--ancho boton--peligro" onClick={() => useTienda.getState().archivarTarjeta(t.id)}>
              <Archive size={14} /> Archivar <Kbd atajo="C" suave />
            </button>
          ) : (
            <button className="boton boton--ancho" onClick={() => useTienda.getState().archivarTarjeta(t.id, false)}>
              <ArchiveRestore size={14} /> Restaurar
            </button>
          )}
        </aside>
      </div>
      <AnimatePresence>
        {arrastrandoArchivo && (
          <motion.div className="hoja__soltar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Upload size={22} /> Soltá para adjuntar a {t.clave}
          </motion.div>
        )}
      </AnimatePresence>
      <AtajosHoja t={t} />
    </div>
  )
}

/** El contenido de la tarjeta, para la hoja a pantalla completa del celular (N6). */
export { Contenido as ContenidoTarjeta }

function AtajosHoja({ t }: { t: TarjetaDetalle }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '.' || e.key === '>')) {
        e.preventDefault()
        copiarRama(t)
      }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [t])
  return null
}

function copiarRama(t: TarjetaDetalle) {
  const rama = nombreDeRama(t.clave, t.titulo)
  navigator.clipboard.writeText(rama)
  avisar({ texto: `Rama copiada: ${rama}`, tipo: 'ok', duracion: 2200 })
}

async function mostrarEnLienzo(t: TarjetaDetalle) {
  const s = useTienda.getState()
  if (!t.enLienzo.length && s.tablero) {
    const els = s.tablero.elementos
    const marcoPorques = t.tipo === 'decision' ? els.find((e) => e.tipo === 'marco' && /porqu/i.test(String(e.datos.titulo))) : null
    const x = marcoPorques ? marcoPorques.x + 40 : Math.max(0, ...els.map((e) => e.x + e.ancho)) + 120
    const y = marcoPorques ? marcoPorques.y + 72 : 0
    await s.crearElemento({ tipo: 'tarjeta', x, y, ancho: 288, alto: 132, tarjetaId: t.id })
  }
  s.cerrarTarjeta()
  irA({ vista: 'lienzo', tarjeta: null })
  setTimeout(() => window.dispatchEvent(new CustomEvent('tablero:enfocar-tarjeta', { detail: t.id })), 350)
}

function Propiedad({ nombre, children }: { nombre: string; children: ReactNode }) {
  return (
    <div className="propiedad">
      <div className="propiedad__nombre">{nombre}</div>
      <div className="propiedad__valor">{children}</div>
    </div>
  )
}

function TituloEditable({ t }: { t: TarjetaDetalle }) {
  const [texto, setTexto] = useState(t.titulo)
  const [foco, setFoco] = useState(false)
  useEffect(() => {
    if (!foco) setTexto(t.titulo)
  }, [t.titulo, foco])
  const guardar = () => {
    const v = texto.replace(/\s+/g, ' ').trim()
    if (v && v !== t.titulo) useTienda.getState().actualizarTarjeta(t.id, { titulo: v }, { titulo: v })
    else setTexto(t.titulo)
  }
  return (
    <TextoAuto
      className="hoja__titulo"
      value={texto}
      onFocus={() => setFoco(true)}
      onChange={(e) => setTexto(e.target.value.replace(/\n/g, ''))}
      onBlur={() => {
        setFoco(false)
        guardar()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          setTexto(t.titulo)
          e.currentTarget.blur()
          e.preventDefault()
        }
      }}
      aria-label="Título"
    />
  )
}

function Descripcion({ t }: { t: TarjetaDetalle }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(t.descripcion)
  useEffect(() => {
    if (!editando) setTexto(t.descripcion)
  }, [t.descripcion, editando])
  const guardar = () => {
    setEditando(false)
    if (texto !== t.descripcion) useTienda.getState().actualizarTarjeta(t.id, { descripcion: texto })
  }
  return (
    <section className="seccion">
      <Titulo
        icono={<FileText size={15} />}
        texto="Descripción"
        extra={
          t.descripcion && !editando ? (
            <button className="boton boton--fantasma boton--chico" onClick={() => setEditando(true)}>
              Editar
            </button>
          ) : null
        }
      />
      {editando ? (
        <div className="editor-md">
          <CampoConMenciones
            className="campo-texto"
            autoFocus
            minFilas={4}
            value={texto}
            placeholder="Contá de qué se trata. Markdown: **negrita**, listas con -, `código`, links…"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) guardar()
              if (e.key === 'Escape') {
                e.stopPropagation()
                setTexto(t.descripcion)
                setEditando(false)
              }
            }}
          />
          <div className="editor-md__pie">
            <button className="boton boton--primario boton--chico" onClick={guardar}>
              Guardar
            </button>
            <button
              className="boton boton--chico"
              onClick={() => {
                setTexto(t.descripcion)
                setEditando(false)
              }}
            >
              Cancelar
            </button>
            <span className="editor-md__ayuda">
              <Kbd atajo="$mod+Enter" suave /> guarda · Esc cancela
            </span>
          </div>
        </div>
      ) : t.descripcion ? (
        <div className="descripcion" onDoubleClick={() => setEditando(true)}>
          <Markdown
            texto={t.descripcion}
          />
        </div>
      ) : (
        <button className="descripcion--vacia" onClick={() => setEditando(true)}>
          Agregá una descripción más detallada…
        </button>
      )}
    </section>
  )
}

function SelectorTipo({ t }: { t: TarjetaDetalle }) {
  const tipo = TIPOS_TARJETA.find((x) => x.id === t.tipo)!
  return (
    <Desplegable
      ancho={240}
      disparador={(p) => (
        <button {...p} className="selector-chip">
          <IconoTipo tipo={t.tipo} tam={18} />
          <span>{tipo.nombre}</span>
          <ChevronDown size={14} />
        </button>
      )}
    >
      {(cerrar) => (
        <Selector
          placeholder="Tipo…"
          elegidas={[t.tipo]}
          opciones={TIPOS_TARJETA.map((x) => ({ id: x.id, etiqueta: x.nombre, icono: <IconoTipo tipo={x.id} tam={16} />, detalle: x.descripcion }))}
          alElegir={(id) => {
            cerrar()
            useTienda.getState().actualizarTarjeta(t.id, { tipo: id }, { tipo: id as TarjetaDetalle['tipo'] })
          }}
        />
      )}
    </Desplegable>
  )
}

function SelectorLista({ t }: { t: TarjetaDetalle }) {
  const tablero = useTienda((s) => s.tablero)
  const listas = [...(tablero?.listas ?? [])].sort(porOrden)
  const actual = listas.find((l) => l.id === t.listaId)
  const cat = CATEGORIAS.find((c) => c.id === actual?.categoria)
  return (
    <Desplegable
      ancho={260}
      disparador={(p) => (
        <button {...p} className={`selector-chip selector-chip--lista${cat ? ` selector-chip--${cat.id}` : ''}`}>
          <span className={`punto-categoria${cat ? ` punto-categoria--${cat.id}` : ''}`} />
          <span>{actual?.nombre ?? t.listaNombre ?? 'Sin lista'}</span>
          <ChevronDown size={14} />
        </button>
      )}
    >
      {(cerrar) => (
        <Selector
          placeholder="Mover a…"
          elegidas={t.listaId ? [t.listaId] : []}
          opciones={listas.map((l) => ({
            id: l.id,
            etiqueta: l.nombre,
            icono: <span className={`punto-categoria${l.categoria ? ` punto-categoria--${l.categoria}` : ''}`} />,
            detalle: l.categoria ? CATEGORIAS.find((c) => c.id === l.categoria)?.nombre : undefined,
          }))}
          alElegir={(id) => {
            cerrar()
            if (id === t.listaId) return
            const n = tablero?.tarjetas.filter((x) => x.listaId === id && !x.archivada).length ?? 0
            useTienda.getState().moverTarjeta(t.id, id, n)
            setTimeout(() => useTienda.getState().recargarDetalle(), 300)
          }}
        />
      )}
    </Desplegable>
  )
}

function SelectorPrioridad({ t }: { t: TarjetaDetalle }) {
  const p = PRIORIDADES.find((x) => x.id === t.prioridad)!
  return (
    <Desplegable
      ancho={220}
      disparador={(props) => (
        <button {...props} className="valor-boton">
          {t.prioridad === 'ninguna' ? <span className="valor-boton__vacio">Sin prioridad</span> : (
            <>
              <IconoPrioridad prioridad={t.prioridad} />
              <span>{p.nombre}</span>
            </>
          )}
        </button>
      )}
    >
      {(cerrar) => (
        <Selector
          placeholder="Prioridad…"
          elegidas={[t.prioridad]}
          opciones={PRIORIDADES.map((x) => ({ id: x.id, etiqueta: x.nombre, icono: <IconoPrioridad prioridad={x.id} /> }))}
          alElegir={(id) => {
            cerrar()
            useTienda.getState().actualizarTarjeta(t.id, { prioridad: id }, { prioridad: id as TarjetaDetalle['prioridad'] })
          }}
        />
      )}
    </Desplegable>
  )
}

function SelectorResponsables({ t, compacto }: { t: TarjetaDetalle; compacto?: boolean }) {
  const miembros = useTienda((s) => s.miembros)
  const elegidos = t.responsables
  const alternar = (id: string) => {
    const nuevos = elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]
    useTienda.getState().actualizarTarjeta(t.id, { responsables: nuevos }, { responsables: nuevos })
  }
  return (
    <Desplegable
      ancho={260}
      disparador={(p) =>
        compacto ? (
          <button {...p} className="pildora">
            <Users size={14} /> Responsables
          </button>
        ) : (
          <button {...p} className="valor-boton">
            {elegidos.length === 0 ? (
              <span className="valor-boton__vacio">
                <UserRound size={14} /> Nadie
              </span>
            ) : (
              <span className="responsables">
                {elegidos.map((id) => {
                  const m = miembros.find((x) => x.id === id)
                  return (
                    <span key={id} className="responsable">
                      <Avatar miembro={m} tam={22} />
                      {m?.nombre}
                    </span>
                  )
                })}
              </span>
            )}
          </button>
        )
      }
    >
      {() => (
        <Selector
          multiple
          placeholder="Personas e IA…"
          elegidas={elegidos}
          opciones={miembros.map((m) => ({
            id: m.id,
            etiqueta: m.esYo ? `${m.nombre} (vos)` : m.nombre,
            icono: <Avatar miembro={m} tam={20} />,
            detalle: m.tipo === 'ia' ? 'IA' : undefined,
            grupo: m.tipo === 'ia' ? 'IA por MCP' : 'Personas',
          }))}
          alElegir={alternar}
        />
      )}
    </Desplegable>
  )
}

function SelectorEtiquetas({ t, compacto }: { t: TarjetaDetalle; compacto?: boolean }) {
  const tablero = useTienda((s) => s.tablero)
  const etiquetas = tablero?.etiquetas ?? []
  const elegidas = t.etiquetas
  const alternar = (id: string) => {
    const nuevas = elegidas.includes(id) ? elegidas.filter((x) => x !== id) : [...elegidas, id]
    useTienda.getState().actualizarTarjeta(t.id, { etiquetas: nuevas }, { etiquetas: nuevas })
  }
  const crear = async (nombre: string) => {
    try {
      const paleta: Color[] = ['azul', 'verde', 'violeta', 'naranja', 'celeste', 'rosa', 'lima', 'amarillo', 'rojo']
      const e = await api.crearEtiqueta(t.proyectoId, { nombre, color: paleta[etiquetas.length % paleta.length] })
      useTienda.setState((s) => (s.tablero ? { tablero: { ...s.tablero, etiquetas: [...s.tablero.etiquetas.filter((x) => x.id !== e.id), e] } } : {}))
      alternar(e.id)
    } catch (err) {
      avisarError(err)
    }
  }
  const lista = elegidas.map((id) => etiquetas.find((e) => e.id === id)).filter(Boolean)
  return (
    <Desplegable
      ancho={280}
      disparador={(p) =>
        compacto ? (
          <button {...p} className="pildora">
            <Tag size={14} /> Etiquetas
          </button>
        ) : (
          <button {...p} className="valor-boton valor-boton--etiquetas">
            {lista.length === 0 ? (
              <span className="valor-boton__vacio">
                <Hash size={14} /> Sin etiquetas
              </span>
            ) : (
              lista.map((e) => <ChipEtiqueta key={e!.id} etiqueta={e!} />)
            )}
            <Plus size={14} className="valor-boton__mas" />
          </button>
        )
      }
    >
      {() => (
        <Selector
          multiple
          placeholder="Buscar o crear etiqueta…"
          elegidas={elegidas}
          opciones={[...etiquetas]
            .sort((a, b) => (a.grupo === 'tipo' ? 1 : 0) - (b.grupo === 'tipo' ? 1 : 0))
            .map((e) => ({
              id: e.id,
              etiqueta: e.nombre,
              icono: <span className="punto" style={{ background: `var(--e-${e.color}-s)` }} />,
              grupo: e.grupo === 'tipo' ? 'Tipo (Discord)' : e.grupo === 'area' ? 'Áreas' : 'Etiquetas',
            }))}
          alElegir={alternar}
          crear={{ etiqueta: (q) => `Crear etiqueta «${q}»`, alCrear: crear }}
        />
      )}
    </Desplegable>
  )
}

function SelectorFechas({ t, compacto }: { t: TarjetaDetalle; compacto?: boolean }) {
  const urg = urgencia(t.fechas)
  const [vence, setVence] = useState(aInputFecha(t.fechas.vence))
  const [hora, setHora] = useState(t.fechas.conHora ? aInputHora(t.fechas.vence) : '')
  const [inicio, setInicio] = useState(aInputFecha(t.fechas.inicio))
  useEffect(() => {
    setVence(aInputFecha(t.fechas.vence))
    setHora(t.fechas.conHora ? aInputHora(t.fechas.vence) : '')
    setInicio(aInputFecha(t.fechas.inicio))
  }, [t.fechas])
  const guardar = (cambios: Record<string, unknown>) => useTienda.getState().actualizarTarjeta(t.id, cambios)
  return (
    <Desplegable
      ancho={300}
      disparador={(p) =>
        compacto ? (
          <button {...p} className="pildora">
            <CalendarClock size={14} /> Fechas
          </button>
        ) : (
          <button {...p} className="valor-boton">
            {t.fechas.vence ? (
              <span className={`insignia insignia--vence insignia--${urg} insignia--grande`}>
                {t.fechas.completada && <Check size={13} />}
                Vence {fechaCorta(t.fechas.vence, t.fechas.conHora)}
              </span>
            ) : (
              <span className="valor-boton__vacio">
                <CalendarClock size={14} /> Sin fechas
              </span>
            )}
            {t.fechas.inicio && <span className="valor-boton__secundario">desde {fechaCorta(t.fechas.inicio)}</span>}
          </button>
        )
      }
    >
      {(cerrar) => (
        <div className="fechas">
          <label className="fechas__fila">
            <span>Inicio</span>
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </label>
          <label className="fechas__fila">
            <span>Vence</span>
            <input type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </label>
          {t.fechas.vence && (
            <label className="fechas__cumplida">
              <input type="checkbox" checked={Boolean(t.fechas.completada)} onChange={(e) => guardar({ completada: e.target.checked })} />
              Cumplida
            </label>
          )}
          <div className="fechas__pie">
            <button
              className="boton boton--primario boton--chico"
              onClick={() => {
                cerrar()
                guardar({ inicio: desdeInputs(inicio), vence: desdeInputs(vence, hora || undefined), conHora: Boolean(hora) })
              }}
            >
              Guardar
            </button>
            {(t.fechas.vence || t.fechas.inicio) && (
              <button
                className="boton boton--chico"
                onClick={() => {
                  cerrar()
                  guardar({ inicio: null, vence: null, conHora: false })
                }}
              >
                Quitar fechas
              </button>
            )}
          </div>
        </div>
      )}
    </Desplegable>
  )
}

function Estimacion({ t }: { t: TarjetaDetalle }) {
  const opciones = [1, 2, 3, 5, 8, 13]
  return (
    <div className="estimacion">
      {opciones.map((n) => (
        <button
          key={n}
          className={`estimacion__punto${t.estimacion === n ? ' estimacion__punto--activo' : ''}`}
          onClick={() => useTienda.getState().actualizarTarjeta(t.id, { estimacion: t.estimacion === n ? null : n }, { estimacion: t.estimacion === n ? null : n })}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

function SelectorEpica({ t }: { t: TarjetaDetalle }) {
  const tablero = useTienda((s) => s.tablero)
  const epicas = (tablero?.tarjetas ?? []).filter((x) => x.tipo === 'epica' && x.id !== t.id && !x.archivada)
  return (
    <Desplegable
      ancho={300}
      disparador={(p) => (
        <button {...p} className="valor-boton">
          {t.padre ? (
            <>
              <IconoTipo tipo={t.padre.tipo} tam={15} />
              <span className="mono">{t.padre.clave}</span>
              <span className="valor-boton__titulo">{t.padre.titulo}</span>
            </>
          ) : (
            <span className="valor-boton__vacio">
              <Zap size={14} /> Ninguna
            </span>
          )}
        </button>
      )}
    >
      {(cerrar) => (
        <Selector
          placeholder={epicas.length ? 'Buscar épica…' : 'No hay épicas todavía'}
          elegidas={t.padreId ? [t.padreId] : []}
          vacio="Creá una tarjeta de tipo Épica para agrupar"
          opciones={[
            ...(t.padreId ? [{ id: '__ninguna', etiqueta: 'Sacar de la épica' }] : []),
            ...epicas.map((e) => ({ id: e.id, etiqueta: e.titulo, buscar: e.clave, icono: <IconoTipo tipo="epica" tam={15} />, detalle: <span className="mono">{e.clave}</span> })),
          ]}
          alElegir={(id) => {
            cerrar()
            useTienda.getState().actualizarTarjeta(t.id, { padre: id === '__ninguna' ? null : id })
          }}
        />
      )}
    </Desplegable>
  )
}

function SelectorPortada({ t }: { t: TarjetaDetalle }) {
  return (
    <div className="portadas">
      {COLORES.map((c) => (
        <button
          key={c.id}
          className={`portadas__color${t.portada?.tipo === 'color' && t.portada.valor === c.id ? ' portadas__color--activa' : ''}`}
          style={{ background: `var(--e-${c.id}-s)` }}
          onClick={() => useTienda.getState().actualizarTarjeta(t.id, { portada: { tipo: 'color', valor: c.id, tamano: 'arriba' } })}
          aria-label={`Portada ${c.nombre}`}
          data-tip={c.nombre}
        />
      ))}
      {t.portada && (
        <button className="boton boton--chico boton--fantasma" onClick={() => useTienda.getState().actualizarTarjeta(t.id, { portada: null })}>
          Quitar
        </button>
      )}
    </div>
  )
}
