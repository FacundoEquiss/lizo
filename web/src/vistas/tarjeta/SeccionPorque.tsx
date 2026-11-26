import { Check, CircleCheckBig, Plus, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { ESTADOS_PORQUE } from '../../../../compartido/constantes'
import { esUrl } from '../../../../compartido/enlaces'
import type { EstadoPorque, OpcionPorque, Porque, TarjetaDetalle } from '../../../../compartido/tipos'
import { api } from '../../estado/api'
import { avisarError } from '../../estado/avisos'
import { useTienda } from '../../estado/tienda'
import { CampoConMenciones } from '../../ui/CampoConMenciones'
import { TextoAuto } from '../../ui/comunes'
import { Markdown } from '../../ui/Markdown'
import { Desplegable } from '../../ui/Desplegable'
import { hace } from '../../util/fechas'

type Campo = 'motivo' | 'contexto' | 'decision' | 'consecuencias'

const CAMPOS: { id: Campo; nombre: string; ayuda: string }[] = [
  { id: 'motivo', nombre: 'Motivo', ayuda: '¿Por qué existe esta tarjeta? El problema o la oportunidad.' },
  { id: 'contexto', nombre: 'Contexto', ayuda: 'Qué se sabía, restricciones, de dónde salió.' },
  { id: 'decision', nombre: 'Decisión', ayuda: 'Qué se decidió.' },
  { id: 'consecuencias', nombre: 'Consecuencias', ayuda: 'Qué implica y qué se resigna.' },
]

async function guardar(clave: string, cambios: Partial<Porque>) {
  try {
    await api.guardarPorque(clave, cambios as Record<string, unknown>)
    await useTienda.getState().recargarDetalle()
  } catch (e) {
    avisarError(e)
  }
}

function CampoPorque({ clave, campo, valor, grande }: { clave: string; campo: (typeof CAMPOS)[number]; valor: string; grande?: boolean }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(valor)
  useEffect(() => {
    if (!editando) setTexto(valor)
  }, [valor, editando])
  const terminar = (guardarlo: boolean) => {
    setEditando(false)
    if (guardarlo && texto !== valor) guardar(clave, { [campo.id]: texto })
    else setTexto(valor)
  }
  if (!valor && !editando)
    return (
      <button className="porque__vacio" onClick={() => setEditando(true)}>
        <Plus size={13} /> {campo.nombre}
      </button>
    )
  return (
    <div className={`porque__campo${grande ? ' porque__campo--grande' : ''}`}>
      <div className="porque__etiqueta">{campo.nombre}</div>
      {editando ? (
        <CampoConMenciones
          className="campo-texto porque__editor"
          autoFocus
          value={texto}
          placeholder={campo.ayuda}
          minFilas={2}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => terminar(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              terminar(false)
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) terminar(true)
          }}
        />
      ) : (
        <div className="porque__valor" onClick={() => setEditando(true)} title="Tocá para editar">
          <Markdown texto={valor} />
        </div>
      )}
    </div>
  )
}

function Opciones({ clave, opciones }: { clave: string; opciones: OpcionPorque[] }) {
  const [lista, setLista] = useState(opciones)
  useEffect(() => setLista(opciones), [opciones])
  const guardarLista = (nueva: OpcionPorque[]) => {
    setLista(nueva)
    guardar(clave, { opciones: nueva.filter((o) => o.titulo.trim()) })
  }
  const cambiar = (i: number, c: Partial<OpcionPorque>, persistir = false) => {
    const nueva = lista.map((o, j) => (j === i ? { ...o, ...c } : o))
    if (persistir) guardarLista(nueva)
    else setLista(nueva)
  }
  return (
    <div className="porque__campo">
      <div className="porque__etiqueta">Opciones</div>
      <div className="opciones">
        <AnimatePresence initial={false}>
          {lista.map((o, i) => (
            <motion.div
              key={i}
              layout
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className={`opcion${o.elegida ? ' opcion--elegida' : ''}`}
            >
              <div className="opcion__cabecera">
                <button
                  className={`opcion__elegir${o.elegida ? ' opcion__elegir--si' : ''}`}
                  onClick={() => guardarLista(lista.map((x, j) => ({ ...x, elegida: j === i ? !x.elegida : false })))}
                  data-tip={o.elegida ? 'Es la elegida' : 'Marcar como elegida'}
                  aria-label="Elegir esta opción"
                >
                  {o.elegida ? <CircleCheckBig size={16} /> : <span className="opcion__circulo" />}
                </button>
                <input
                  className="opcion__titulo"
                  value={o.titulo}
                  placeholder="Opción…"
                  onChange={(e) => cambiar(i, { titulo: e.target.value })}
                  onBlur={() => guardarLista(lista)}
                />
                <button className="boton-icono boton-icono--chico" onClick={() => guardarLista(lista.filter((_, j) => j !== i))} aria-label="Quitar opción">
                  <X size={14} />
                </button>
              </div>
              <div className="opcion__pros-contras">
                <label>
                  <span className="opcion__signo opcion__signo--pro">+</span>
                  <TextoAuto value={o.pros ?? ''} placeholder="A favor" onChange={(e) => cambiar(i, { pros: e.target.value })} onBlur={() => guardarLista(lista)} />
                </label>
                <label>
                  <span className="opcion__signo opcion__signo--contra">−</span>
                  <TextoAuto value={o.contras ?? ''} placeholder="En contra" onChange={(e) => cambiar(i, { contras: e.target.value })} onBlur={() => guardarLista(lista)} />
                </label>
                {!o.elegida && (o.descartadaPorque || lista.some((x) => x.elegida)) && (
                  <label className="opcion__descarte">
                    <span className="opcion__signo">×</span>
                    <TextoAuto
                      value={o.descartadaPorque ?? ''}
                      placeholder="Se descartó porque…"
                      onChange={(e) => cambiar(i, { descartadaPorque: e.target.value })}
                      onBlur={() => guardarLista(lista)}
                    />
                  </label>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <button className="opcion opcion--nueva" onClick={() => setLista([...lista, { titulo: '' }])}>
          <Plus size={14} /> Opción
        </button>
      </div>
    </div>
  )
}

function Evidencias({ clave, evidencias }: { clave: string; evidencias: string[] }) {
  const [nueva, setNueva] = useState('')
  const agregar = () => {
    const v = nueva.trim()
    if (!v) return
    setNueva('')
    guardar(clave, { evidencias: [...evidencias, v] })
  }
  return (
    <div className="porque__campo">
      <div className="porque__etiqueta">Evidencias</div>
      <ul className="evidencias">
        {evidencias.map((ev, i) => (
          <li key={i} className="evidencia">
            {esUrl(ev) ? (
              <a href={ev} target="_blank" rel="noopener noreferrer">
                {ev.replace(/^https?:\/\/(www\.)?/, '')}
              </a>
            ) : (
              <span>{ev}</span>
            )}
            <button className="boton-icono boton-icono--chico" onClick={() => guardar(clave, { evidencias: evidencias.filter((_, j) => j !== i) })} aria-label="Quitar evidencia">
              <Trash2 size={13} />
            </button>
          </li>
        ))}
        <li className="evidencia evidencia--nueva">
          <input
            value={nueva}
            placeholder="Link a un PR, issue, Figma, métrica o conversación…"
            onChange={(e) => setNueva(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && agregar()}
          />
        </li>
      </ul>
    </div>
  )
}

export function EstadoPorqueChip({ estado, alCambiar }: { estado: EstadoPorque; alCambiar?: (e: EstadoPorque) => void }) {
  const actual = ESTADOS_PORQUE.find((e) => e.id === estado)!
  const chip = (p: Record<string, unknown>) => (
    <button
      {...p}
      className="estado-porque"
      style={{ background: `var(--e-${actual.color})`, color: `var(--e-${actual.color}-t)` }}
      disabled={!alCambiar}
    >
      <span className="estado-porque__punto" style={{ background: `var(--e-${actual.color}-s)` }} />
      {actual.nombre}
    </button>
  )
  if (!alCambiar) return chip({})
  return (
    <Desplegable disparador={(p) => chip(p)} lado="bottom-start" className="menu">
      {(cerrar) => (
        <div className="menu__lista">
          {ESTADOS_PORQUE.map((e) => (
            <button
              key={e.id}
              className="menu__item"
              onClick={() => {
                cerrar()
                alCambiar(e.id)
              }}
            >
              <span className="menu__icono">
                <span className="estado-porque__punto" style={{ background: `var(--e-${e.color}-s)` }} />
              </span>
              <span className="menu__texto">{e.nombre}</span>
              {e.id === estado && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </Desplegable>
  )
}

export function SeccionPorque({ tarjeta }: { tarjeta: TarjetaDetalle }) {
  const p = tarjeta.porqueCompleto
  const [abierto, setAbierto] = useState(false)
  const [conOpciones, setConOpciones] = useState(false)
  useEffect(() => setConOpciones(false), [tarjeta.id])
  if (!p && !abierto)
    return (
      <section className="porque porque--vacio">
        <div className="porque__marca">¿Por qué?</div>
        <p>
          Toda tarjeta tiene un porqué. Anotá el problema o la oportunidad, qué se sabía, qué opciones hubo y qué se decidió: así nadie
          (ni la IA) tiene que adivinarlo después.
        </p>
        <button className="boton boton--primario" onClick={() => setAbierto(true)}>
          Escribir el porqué
        </button>
      </section>
    )
  const vacio: Porque = {
    motivo: '',
    contexto: '',
    opciones: [],
    decision: '',
    consecuencias: '',
    estado: 'abierta',
    evidencias: [],
    decidieron: [],
    decididaEn: null,
    revisarEn: null,
    reemplazadaPor: null,
    actualizadoEn: new Date().toISOString(),
  }
  const datos = p ?? vacio
  return (
    <section className="porque">
      <header className="porque__cabecera">
        <span className="porque__marca">¿Por qué?</span>
        <EstadoPorqueChip estado={datos.estado} alCambiar={(estado) => guardar(tarjeta.clave, { estado })} />
        {p && <span className="porque__cuando">actualizado {hace(p.actualizadoEn)}</span>}
      </header>
      <div className="porque__grilla">
        <CampoPorque clave={tarjeta.clave} campo={CAMPOS[0]!} valor={datos.motivo} grande />
        <CampoPorque clave={tarjeta.clave} campo={CAMPOS[1]!} valor={datos.contexto} />
        {datos.opciones.length > 0 || conOpciones ? (
          <Opciones clave={tarjeta.clave} opciones={datos.opciones} />
        ) : (
          <button className="porque__vacio" onClick={() => setConOpciones(true)}>
            <Plus size={13} /> Opciones consideradas
          </button>
        )}
        <CampoPorque clave={tarjeta.clave} campo={CAMPOS[2]!} valor={datos.decision} />
        <CampoPorque clave={tarjeta.clave} campo={CAMPOS[3]!} valor={datos.consecuencias} />
        <Evidencias clave={tarjeta.clave} evidencias={datos.evidencias} />
      </div>
    </section>
  )
}
