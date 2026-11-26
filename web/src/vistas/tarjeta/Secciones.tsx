import {
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  ImageIcon,
  ListChecks,
  MessageSquare,
  Network,
  Paperclip,
  Plus,
  Reply,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIAS, VINCULOS } from '../../../../compartido/constantes'
import { urlEmbebidoFigma } from '../../../../compartido/enlaces'
import type { Actividad, Comentario, Miembro, ResultadoBusqueda, TarjetaDetalle } from '../../../../compartido/tipos'
import { api } from '../../estado/api'
import { apiIA } from '../ia/api-ia'
import { avisar, avisarError } from '../../estado/avisos'
import { useIA, useRespondiendo } from '../../estado/ia'
import { useTienda } from '../../estado/tienda'
import { CampoConMenciones } from '../../ui/CampoConMenciones'
import { Avatar, ChipEnlace, IconoTipo, iconoEnlace, TextoAuto } from '../../ui/comunes'
import { Markdown } from '../../ui/Markdown'
import { Desplegable, Selector } from '../../ui/Desplegable'
import { MarcaDiscord } from '../../ui/marcas'
import { hace } from '../../util/fechas'
import { EntradaTrabajo } from '../ia/EntradaTrabajo'
import { EsperandoMencion } from '../ia/EsperandoMencion'
import { PieTrabajo } from '../ia/PieTrabajo'
import { seVeEnElHilo } from '../ia/trabajo'

const recargar = () => useTienda.getState().recargarDetalle()

async function hacer(fn: () => Promise<unknown>) {
  try {
    await fn()
    await recargar()
  } catch (e) {
    avisarError(e)
  }
}

export function Titulo({ icono, texto, extra }: { icono: React.ReactNode; texto: string; extra?: React.ReactNode }) {
  return (
    <div className="seccion__titulo">
      <span className="seccion__icono">{icono}</span>
      <h3>{texto}</h3>
      {extra && <div className="seccion__extra">{extra}</div>}
    </div>
  )
}

// ───────── Desde Discord ─────────

export function SeccionDiscord({ tarjeta }: { tarjeta: TarjetaDetalle }) {
  const d = tarjeta.discordDatos
  const [todas, setTodas] = useState(false)
  if (!d) return null
  const citas = todas ? d.citas : d.citas.slice(0, 4)
  return (
    <section className="seccion discord">
      <Titulo
        icono={<MarcaDiscord size={14} style={{ color: '#5865F2' }} />}
        texto="Desde Discord"
        extra={
          <span className="discord__meta">
            {d.canal} · {d.id}
          </span>
        }
      />
      <div className="discord__citas">
        {citas.map((c, i) => {
          const dueno = /\(due[ñn]o\)/i.test(c.autor)
          return (
            <div key={i} className={`cita${dueno ? ' cita--dueno' : ''}`}>
              <span className="cita__avatar">{(c.autor || '?').replace(/\(.*\)/, '').trim().slice(0, 1).toUpperCase()}</span>
              <div className="cita__cuerpo">
                <div className="cita__cabecera">
                  <b>{c.autor.replace(/\s*\(due[ñn]o\)/i, '') || 'Alguien'}</b>
                  {dueno && <span className="cita__rol">dueño</span>}
                  {c.canal && <span className="cita__canal">{c.canal}</span>}
                  {c.fecha && <span className="cita__fecha">{c.fecha}</span>}
                </div>
                <p>{c.texto}</p>
              </div>
            </div>
          )
        })}
        {d.citas.length > 4 && (
          <button className="boton boton--fantasma boton--chico" onClick={() => setTodas(!todas)}>
            {todas ? 'Ver menos' : `Ver las ${d.citas.length} citas`}
          </button>
        )}
      </div>
      {d.respuestaSugerida && (
        <div className="respuesta">
          <div className="respuesta__cabecera">
            <span>Respuesta sugerida para Discord</span>
            <button
              className="boton boton--chico"
              onClick={() => {
                navigator.clipboard.writeText(d.respuestaSugerida)
                avisar({ texto: 'Respuesta copiada', tipo: 'ok', duracion: 1800 })
              }}
            >
              <Copy size={13} /> Copiar
            </button>
          </div>
          <p>{d.respuestaSugerida}</p>
        </div>
      )}
    </section>
  )
}

// ───────── Checklists ─────────

export function SeccionChecklists({ tarjeta }: { tarjeta: TarjetaDetalle }) {
  if (tarjeta.checklists.length === 0) return null
  return (
    <>
      {tarjeta.checklists.map((c) => (
        <ChecklistVista key={c.id} checklist={c} miembros={useTienda.getState().miembros} />
      ))}
    </>
  )
}

function ChecklistVista({ checklist: c, miembros: _m }: { checklist: TarjetaDetalle['checklists'][number]; miembros: Miembro[] }) {
  const [nuevo, setNuevo] = useState('')
  const [titulo, setTitulo] = useState(c.titulo)
  const [editandoItem, setEditandoItem] = useState<string | null>(null)
  const [textoItem, setTextoItem] = useState('')
  const [hechosLocales, setHechosLocales] = useState<Record<string, boolean>>({})
  useEffect(() => setTitulo(c.titulo), [c.titulo])
  useEffect(() => setHechosLocales({}), [c.items])
  const hecho = (id: string, base: boolean) => hechosLocales[id] ?? base
  const total = c.items.length
  const hechos = c.items.filter((i) => hecho(i.id, i.hecho)).length
  const pct = total ? Math.round((hechos / total) * 100) : 0
  const items = c.ocultarHechos ? c.items.filter((i) => !hecho(i.id, i.hecho)) : c.items
  const agregar = () => {
    const t = nuevo.trim()
    if (!t) return
    setNuevo('')
    hacer(() => api.agregarItem(c.id, t))
  }
  return (
    <section className="seccion checklist">
      <div className="seccion__titulo">
        <span className="seccion__icono">
          <ListChecks size={15} />
        </span>
        <input
          className="checklist__titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={() => titulo.trim() && titulo !== c.titulo && hacer(() => api.actualizarChecklist(c.id, { titulo: titulo.trim() }))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <div className="seccion__extra">
          {hechos > 0 && (
            <button className="boton boton--fantasma boton--chico" onClick={() => hacer(() => api.actualizarChecklist(c.id, { ocultarHechos: !c.ocultarHechos }))}>
              {c.ocultarHechos ? <Eye size={13} /> : <EyeOff size={13} />}
              {c.ocultarHechos ? `Mostrar hechos (${hechos})` : 'Ocultar hechos'}
            </button>
          )}
          <button className="boton-icono boton-icono--chico" onClick={() => hacer(() => api.eliminarChecklist(c.id))} data-tip="Quitar checklist" aria-label="Quitar checklist">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="progreso">
        <span className="progreso__pct">{pct}%</span>
        <div className="progreso__barra">
          <motion.div className={`progreso__relleno${pct === 100 ? ' progreso__relleno--completo' : ''}`} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 260, damping: 30 }} />
        </div>
      </div>
      <ul className="checklist__items">
        <AnimatePresence initial={false}>
          {items.map((it) => {
            const h = hecho(it.id, it.hecho)
            return (
              <motion.li
                key={it.id}
                layout="position"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className={`item${h ? ' item--hecho' : ''}`}
              >
                <button
                  className={`casilla${h ? ' casilla--si' : ''}`}
                  onClick={() => {
                    setHechosLocales((x) => ({ ...x, [it.id]: !h }))
                    hacer(() => api.actualizarItem(it.id, { hecho: !h }))
                  }}
                  aria-label={h ? 'Desmarcar' : 'Marcar como hecho'}
                >
                  {h && <Check size={12} strokeWidth={3.2} />}
                </button>
                {editandoItem === it.id ? (
                  <input
                    className="item__editor"
                    autoFocus
                    value={textoItem}
                    onChange={(e) => setTextoItem(e.target.value)}
                    onBlur={() => {
                      setEditandoItem(null)
                      if (textoItem.trim() && textoItem !== it.texto) hacer(() => api.actualizarItem(it.id, { texto: textoItem.trim() }))
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setEditandoItem(null)
                      }
                    }}
                  />
                ) : (
                  <span
                    className="item__texto"
                    onClick={() => {
                      setEditandoItem(it.id)
                      setTextoItem(it.texto)
                    }}
                  >
                    {it.texto}
                  </span>
                )}
                <span className="item__acciones">
                  <button
                    className="boton-icono boton-icono--chico"
                    onClick={() =>
                      hacer(async () => {
                        const t = await api.convertirItem(it.id)
                        useTienda.getState().ponerTarjeta(t)
                        avisar({ texto: `El ítem ahora es ${t.clave}`, tipo: 'ok' })
                      })
                    }
                    data-tip="Convertir en tarjeta"
                    aria-label="Convertir en tarjeta"
                  >
                    <SquareArrowOutUpRight size={13} />
                  </button>
                  <button className="boton-icono boton-icono--chico" onClick={() => hacer(() => api.eliminarItem(it.id))} data-tip="Borrar ítem" aria-label="Borrar ítem">
                    <X size={14} />
                  </button>
                </span>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
      <div className="checklist__nuevo">
        <Plus size={14} />
        <TextoAuto
          value={nuevo}
          placeholder="Agregar ítem (pegá varias líneas para crear varios)"
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              agregar()
            }
          }}
        />
      </div>
    </section>
  )
}

// ───────── Adjuntos ─────────

export function SeccionAdjuntos({ tarjeta, alSubir }: { tarjeta: TarjetaDetalle; alSubir: () => void }) {
  const [visor, setVisor] = useState<string | null>(null)
  if (tarjeta.adjuntos.length === 0) return null
  const imagenes = tarjeta.adjuntos.filter((a) => a.esImagen)
  const otros = tarjeta.adjuntos.filter((a) => !a.esImagen)
  return (
    <section className="seccion">
      <Titulo
        icono={<Paperclip size={15} />}
        texto={`Adjuntos · ${tarjeta.adjuntos.length}`}
        extra={
          <button className="boton boton--chico" onClick={alSubir}>
            <Upload size={13} /> Subir
          </button>
        }
      />
      {imagenes.length > 0 && (
        <div className="adjuntos__grilla">
          {imagenes.map((a) => {
            const esPortada = tarjeta.portada?.tipo === 'imagen' && tarjeta.portada.valor === a.url
            return (
              <figure key={a.id} className="adjunto">
                <button className="adjunto__imagen" onClick={() => setVisor(a.url)}>
                  <img src={a.url} alt={a.descripcion || a.nombre} loading="lazy" />
                </button>
                <figcaption>
                  <span className="adjunto__nombre" title={a.nombre}>
                    {a.descripcion || a.nombre}
                  </span>
                  <span className="adjunto__acciones">
                    <button
                      className={`boton-icono boton-icono--chico${esPortada ? ' boton-icono--activo' : ''}`}
                      data-tip={esPortada ? 'Quitar de portada' : 'Usar de portada'}
                      onClick={() =>
                        useTienda
                          .getState()
                          .actualizarTarjeta(tarjeta.id, { portada: esPortada ? null : { tipo: 'imagen', valor: a.url, tamano: 'arriba' } })
                      }
                      aria-label="Portada"
                    >
                      <ImageIcon size={13} />
                    </button>
                    <button className="boton-icono boton-icono--chico" data-tip="Quitar adjunto" onClick={() => hacer(() => api.eliminarAdjunto(a.id))} aria-label="Quitar adjunto">
                      <Trash2 size={13} />
                    </button>
                  </span>
                </figcaption>
              </figure>
            )
          })}
        </div>
      )}
      {otros.length > 0 && (
        <ul className="adjuntos__lista">
          {otros.map((a) => (
            <li key={a.id}>
              <span className="adjuntos__ext">{a.nombre.split('.').pop()?.toUpperCase().slice(0, 4)}</span>
              <a href={a.url} target="_blank" rel="noopener noreferrer">
                {a.nombre}
              </a>
              <span className="adjuntos__peso">{a.tamano ? `${Math.max(1, Math.round(a.tamano / 1024))} KB` : ''}</span>
              <button className="boton-icono boton-icono--chico" onClick={() => hacer(() => api.eliminarAdjunto(a.id))} aria-label="Quitar adjunto">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <AnimatePresence>
        {visor && (
          <motion.div className="visor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setVisor(null)}>
            <motion.img src={visor} alt="" initial={{ scale: 0.94 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

// ───────── Enlaces externos (GitHub, Figma, Discord) ─────────

export function SeccionEnlaces({ tarjeta }: { tarjeta: TarjetaDetalle }) {
  const [url, setUrl] = useState('')
  const [figmaAbierto, setFigmaAbierto] = useState<string | null>(null)
  const tema = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  const agregar = () => {
    const u = url.trim()
    if (!u) return
    setUrl('')
    hacer(async () => useTienda.getState().ponerTarjeta(await api.agregarEnlace(tarjeta.clave, u)))
  }
  return (
    <div className="enlaces">
      {tarjeta.enlaces.map((e) => (
        <div key={e.id} className="enlace-fila">
          <ChipEnlace enlace={e} grande />
          {e.tipo === 'figma' && (
            <button className="boton boton--chico boton--fantasma" onClick={() => setFigmaAbierto(figmaAbierto === e.id ? null : e.id)}>
              {figmaAbierto === e.id ? 'Ocultar' : 'Ver acá'}
            </button>
          )}
          <button
            className="boton-icono boton-icono--chico enlace-fila__quitar"
            onClick={() => hacer(async () => useTienda.getState().ponerTarjeta(await api.eliminarEnlace(e.id)))}
            aria-label="Quitar enlace"
          >
            <X size={13} />
          </button>
          {figmaAbierto === e.id && (
            <iframe className="figma-embebido" src={urlEmbebidoFigma(e.url, tema)} title={e.titulo} allowFullScreen loading="lazy" />
          )}
        </div>
      ))}
      <input
        className="campo enlaces__nuevo"
        value={url}
        placeholder="Pegá un link de GitHub, Figma o Discord…"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && agregar()}
        onPaste={(e) => {
          const t = e.clipboardData.getData('text')
          if (/^https?:\/\//.test(t.trim())) {
            e.preventDefault()
            setUrl('')
            hacer(async () => useTienda.getState().ponerTarjeta(await api.agregarEnlace(tarjeta.clave, t.trim())))
          }
        }}
      />
    </div>
  )
}

// ───────── Vínculos entre tarjetas ─────────

export function SeccionVinculos({ tarjeta }: { tarjeta: TarjetaDetalle }) {
  const grupos = useMemo(() => {
    const g = new Map<string, TarjetaDetalle['vinculos']>()
    for (const v of tarjeta.vinculos) g.set(v.texto, [...(g.get(v.texto) ?? []), v])
    return [...g.entries()]
  }, [tarjeta.vinculos])
  return (
    <section className="seccion">
      <Titulo icono={<Network size={15} />} texto="Vínculos" extra={<NuevoVinculo tarjeta={tarjeta} />} />
      {grupos.length === 0 ? (
        <p className="seccion__nada">Sin vínculos. Marcá de qué depende, qué bloquea o con qué se relaciona.</p>
      ) : (
        grupos.map(([texto, vs]) => (
          <div key={texto} className="vinculos__grupo">
            <div className="vinculos__texto">{texto}</div>
            {vs.map((v) => {
              const cat = CATEGORIAS.find((c) => c.id === v.otra.categoria)
              return (
                <div key={v.id} className={`vinculo${v.otra.archivada ? ' vinculo--archivada' : ''}`}>
                  <button className="vinculo__tarjeta" onClick={() => useTienda.getState().abrirTarjeta(v.otra.clave)}>
                    <IconoTipo tipo={v.otra.tipo} tam={15} />
                    <span className="vinculo__clave">{v.otra.clave}</span>
                    <span className="vinculo__titulo">{v.otra.titulo}</span>
                    {v.otra.listaNombre && (
                      <span className={`vinculo__lista${cat ? ` vinculo__lista--${cat.id}` : ''}`}>{v.otra.listaNombre}</span>
                    )}
                  </button>
                  <button className="boton-icono boton-icono--chico" onClick={() => hacer(() => api.desvincular(v.id))} aria-label="Quitar vínculo">
                    <X size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        ))
      )}
    </section>
  )
}

function NuevoVinculo({ tarjeta }: { tarjeta: TarjetaDetalle }) {
  const [tipo, setTipo] = useState<string>('relacionada')
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([])
  const tablero = useTienda((s) => s.tablero)
  const opciones = [
    { id: 'depende_de', nombre: 'Depende de' },
    { id: 'bloquea', nombre: 'Bloquea a' },
    { id: 'relacionada', nombre: 'Se relaciona' },
    { id: 'duplica', nombre: 'Duplica a' },
    { id: 'causa', nombre: 'Causa' },
    { id: 'implementa', nombre: 'Implementa' },
  ]
  const locales = (tablero?.tarjetas ?? []).filter((t) => t.id !== tarjeta.id && !t.archivada)
  const lista = resultados.length ? resultados.map((r) => r.tarjeta) : locales
  return (
    <Desplegable
      lado="bottom-end"
      ancho={420}
      disparador={(p) => (
        <button {...p} className="boton boton--chico">
          <Plus size={13} /> Vincular
        </button>
      )}
    >
      {(cerrar) => (
        <div className="nuevo-vinculo">
          <div className="segmentado">
            {opciones.map((o) => (
              <button key={o.id} className={`segmentado__opcion${tipo === o.id ? ' segmentado__opcion--activa' : ''}`} onClick={() => setTipo(o.id)}>
                {o.nombre}
              </button>
            ))}
          </div>
          <BuscadorTarjetas
            opciones={lista}
            alBuscar={(q) => (q.length > 1 ? api.buscar(q, { limite: 20 }).then(setResultados).catch(() => {}) : setResultados([]))}
            alElegir={(clave) => {
              cerrar()
              hacer(() => api.vincular(tarjeta.clave, tipo, clave))
            }}
          />
          <p className="nuevo-vinculo__ayuda">{VINCULOS.find((v) => v.id === (tipo === 'depende_de' ? 'bloquea' : tipo))?.[tipo === 'depende_de' ? 'vuelta' : 'ida']}…</p>
        </div>
      )}
    </Desplegable>
  )
}

function BuscadorTarjetas({
  opciones,
  alElegir,
  alBuscar,
}: {
  opciones: { id: string; clave: string; titulo: string; tipo: TarjetaDetalle['tipo'] }[]
  alElegir: (clave: string) => void
  alBuscar: (q: string) => void
}) {
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  return (
    <div
      onInput={(e) => {
        const q = (e.target as HTMLInputElement).value
        if (temporizador.current) clearTimeout(temporizador.current)
        temporizador.current = setTimeout(() => alBuscar(q), 180)
      }}
    >
      <Selector
        placeholder="Buscar tarjeta por clave o título…"
        elegidas={[]}
        opciones={opciones.slice(0, 60).map((t) => ({
          id: t.clave,
          etiqueta: t.titulo,
          buscar: t.clave,
          icono: <IconoTipo tipo={t.tipo} tam={15} />,
          detalle: <span className="mono">{t.clave}</span>,
        }))}
        alElegir={alElegir}
      />
    </div>
  )
}

// ───────── Comentarios y actividad ─────────

/** La línea de arriba de un comentario que responde a otro (14.4): «↪ a Facundo: “@claude ya le respondí…”». Un clic resalta el original. */
function CitaDeRespuesta({ original }: { original: Comentario | null }) {
  const resaltar = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!original) return
    const lista = e.currentTarget.closest('ol')
    const el = lista?.querySelector<HTMLElement>(`[data-comentario="${original.id}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('comentario--resaltado')
    setTimeout(() => el.classList.remove('comentario--resaltado'), 1400)
  }
  if (!original) return <div className="comentario__cita comentario__cita--perdida">↪ a un comentario que ya no está</div>
  // Sin los símbolos de Markdown (**negrita**, `código`, [links](…)): la cita es una línea de texto corrido.
  const resumen = original.cuerpo
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-\s]+/gm, '')
    .replace(/[*`~]+|(^|\s)_+|_+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return (
    <button type="button" className="comentario__cita" onClick={resaltar} aria-label={`Respuesta a ${original.autor.nombre}: ${resumen.slice(0, 80)}. Ir al comentario`}>
      <span aria-hidden>↪</span> a {original.autor.nombre}: «{resumen.length > 70 ? `${resumen.slice(0, 70)}…` : resumen}»
    </button>
  )
}

export function SeccionComentarios({ tarjeta }: { tarjeta: TarjetaDetalle }) {
  const [texto, setTexto] = useState('')
  const [conActividad, setConActividad] = useState(true)
  const miembros = useTienda((s) => s.miembros)
  const campo = useRef<HTMLTextAreaElement>(null)
  // «Respondiendo a…»: vale solo para esta tarjeta y mientras ese comentario siga ahí.
  const respondiendo = useRespondiendo((s) => s.a)
  const pedidoDeFoco = useRespondiendo((s) => s.foco)
  const aQuien = respondiendo && respondiendo.tarjeta === tarjeta.clave && tarjeta.comentarios.some((c) => c.id === respondiendo.comentarioId) ? respondiendo : null
  useEffect(() => {
    if (pedidoDeFoco) campo.current?.focus()
  }, [pedidoDeFoco])
  const enviar = () => {
    const t = texto.trim()
    if (!t) return
    setTexto('')
    useRespondiendo.getState().dejar()
    hacer(async () => {
      const c = await api.comentar(tarjeta.clave, t, aQuien ? { respondeA: aQuien.comentarioId } : undefined)
      // Si mencionó a un agente que no puede responder ahora, el servidor lo dice con su motivo y se ve acá con «Reintentar».
      if (c.menciones?.length) useIA.getState().sumarEsperando(c.menciones)
    })
  }

  // Los agentes de adentro (IA integrada, F2): lo que están haciendo en esta tarjeta, lo que quedó esperando y el pie de lo que
  // hicieron. Los trabajos llegan por los eventos en vivo; los de antes, con un pedido por tarjeta la primera vez que se ve.
  const trabajos = useIA((s) => s.trabajos)
  const esperando = useIA((s) => s.esperando)
  const pedidos = useRef(new Set<string>())
  const [, repintar] = useState(0)
  const sinTrabajo = tarjeta.comentarios.filter((c) => c.trabajoId && !trabajos[c.trabajoId]).length
  useEffect(() => {
    if (!sinTrabajo || pedidos.current.has(tarjeta.clave)) return
    pedidos.current.add(tarjeta.clave)
    apiIA.trabajos({ tarjeta: tarjeta.clave }).then((ts) => useIA.getState().guardarTrabajos(ts), () => {})
  }, [tarjeta.clave, sinTrabajo])
  const conRespuesta = (id: string) => tarjeta.comentarios.some((c) => c.trabajoId === id)
  const trabajando = Object.values(trabajos).filter((t) => seVeEnElHilo(t, tarjeta.clave, conRespuesta(t.id)))
  // Una mención a un agente que se archivó no espera nada: no se muestra (nunca va a responder).
  const esperandoAca = esperando.filter((m) => m.tarjetaClave === tarjeta.clave && !miembros.find((x) => x.id === m.destinatarioId)?.archivado)
  // Lo que termina (o se frena) se queda unos segundos en pantalla: se vuelve a dibujar cuando se le acaba el tiempo.
  useEffect(() => {
    const fin = trabajando.filter((t) => t.terminadoEn).map((t) => Date.parse(t.terminadoEn!) + (t.estado === 'hecho' ? 8000 : 6000))
    if (!fin.length) return
    const id = setTimeout(() => repintar((n) => n + 1), Math.max(50, Math.min(...fin) - Date.now() + 50))
    return () => clearTimeout(id)
  })

  type Entrada =
    | { tipo: 'comentario'; c: Comentario; en: string }
    | { tipo: 'actividad'; a: Actividad; en: string }
    | { tipo: 'trabajo'; t: (typeof trabajando)[number]; en: string }
    | { tipo: 'espera'; m: (typeof esperandoAca)[number]; en: string }
  const entradas: Entrada[] = [
    ...trabajando.map((t) => ({ tipo: 'trabajo' as const, t, en: t.creadoEn })),
    ...esperandoAca.map((m) => ({ tipo: 'espera' as const, m, en: m.creadoEn })),
    ...tarjeta.comentarios.map((c) => ({ tipo: 'comentario' as const, c, en: c.creadoEn })),
    ...(conActividad ? tarjeta.actividad.filter((a) => a.accion !== 'comentario.creado').map((a) => ({ tipo: 'actividad' as const, a, en: a.creadoEn })) : []),
  ].sort((x, y) => (x.en < y.en ? 1 : -1))
  const yo = miembros.find((m) => m.esYo)
  const miembroDe = (actorId: string, nombre: string, tipo: string): Miembro | null =>
    miembros.find((m) => m.id === actorId) ??
    miembros.find((m) => m.nombre === nombre) ??
    (tipo === 'sistema' ? { id: 'sistema', nombre, tipo: 'humano', color: 'gris', iniciales: nombre.slice(0, 1), esYo: false } : null)
  return (
    <section className="seccion">
      <Titulo
        icono={<MessageSquare size={15} />}
        texto="Comentarios y actividad"
        extra={
          <button className="boton boton--fantasma boton--chico" onClick={() => setConActividad(!conActividad)}>
            {conActividad ? 'Ocultar actividad' : 'Mostrar actividad'}
          </button>
        }
      />
      <div className="comentar">
        <Avatar miembro={yo} tam={30} />
        <div className="comentar__caja">
          {aQuien && (
            <div className="comentar__respondiendo">
              <Reply size={13} aria-hidden />
              <span>Respondiendo a {aQuien.autor}</span>
              <button type="button" className="boton-icono boton-icono--chico" onClick={() => useRespondiendo.getState().dejar()} aria-label={`Dejar de responder a ${aQuien.autor}`}>
                <X size={12} />
              </button>
            </div>
          )}
          <CampoConMenciones
            ref={campo}
            value={texto}
            minFilas={1}
            placeholder="Escribí un comentario… Con @ mencionás a una persona o a una IA"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                enviar()
              }
            }}
          />
          {texto.trim() && (
            <div className="comentar__pie">
              <span className="comentar__ayuda">⌘/Ctrl + Enter</span>
              <button className="boton boton--primario boton--chico" onClick={enviar}>
                Comentar
              </button>
            </div>
          )}
        </div>
      </div>
      <ol className="linea-tiempo">
        {entradas.map((e) =>
          e.tipo === 'trabajo' ? (
            <EntradaTrabajo key={`trabajo-${e.t.id}`} trabajo={e.t} />
          ) : e.tipo === 'espera' ? (
            <EsperandoMencion key={`espera-${e.m.id}`} mencion={e.m} />
          ) : e.tipo === 'comentario' ? (
            <li key={e.c.id} data-comentario={e.c.id} className={`comentario${e.c.autor.tipo === 'ia' ? ' comentario--ia' : ''}`}>
              <Avatar miembro={miembroDe(e.c.autor.id, e.c.autor.nombre, e.c.autor.tipo)} tam={30} titulo={e.c.autor.cliente ?? e.c.autor.nombre} />
              <div className="comentario__cuerpo">
                <div className="comentario__cabecera">
                  <b>{e.c.autor.nombre}</b>
                  {e.c.autor.tipo === 'ia' && (
                    <span className="marca-ia">
                      <Sparkles size={10} /> {e.c.autor.cliente ?? 'IA'}
                    </span>
                  )}
                  <span className="comentario__cuando">{hace(e.c.creadoEn)}</span>
                  <button
                    type="button"
                    className="comentario__responder"
                    onClick={() => useRespondiendo.getState().responder({ tarjeta: tarjeta.clave, comentarioId: e.c.id, autor: e.c.autor.nombre })}
                    aria-label={`Responder a ${e.c.autor.nombre}`}
                  >
                    <Reply size={12} aria-hidden /> Responder
                  </button>
                  {e.c.autor.tipo === 'humano' && (
                    <button className="boton-icono boton-icono--chico comentario__borrar" onClick={() => hacer(() => api.eliminarComentario(e.c.id))} aria-label="Borrar comentario">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {e.c.respuestaA && <CitaDeRespuesta original={tarjeta.comentarios.find((c) => c.id === e.c.respuestaA) ?? null} />}
                <div className="comentario__texto">
                  <Markdown texto={e.c.cuerpo} />
                </div>
                {e.c.trabajoId && trabajos[e.c.trabajoId] && <PieTrabajo trabajo={trabajos[e.c.trabajoId]!} />}
              </div>
            </li>
          ) : (
            <li key={e.a.id} className={`evento${e.a.actor.tipo === 'ia' ? ' evento--ia' : ''}`}>
              <span className="evento__punto">{e.a.actor.tipo === 'ia' ? <Sparkles size={11} /> : null}</span>
              <span className="evento__texto">
                <b>{e.a.actor.nombre}</b> {e.a.resumen}
                {e.a.actor.cliente && e.a.actor.tipo === 'ia' && <span className="evento__cliente"> · {e.a.actor.cliente}</span>}
              </span>
              <span className="evento__cuando">{hace(e.a.creadoEn)}</span>
            </li>
          ),
        )}
      </ol>
    </section>
  )
}

export { ArrowUpRight, iconoEnlace }
