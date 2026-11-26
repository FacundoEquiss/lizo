// Controles flotantes del lienzo de Diseño (plan 6.3): la barra de herramientas abajo al centro, el zoom abajo a la
// derecha, las migas de la selección arriba a la izquierda y el fondo del lienzo / modo arriba a la derecha.
import { useReactFlow, useViewport } from '@xyflow/react'
import { Box, ChevronRight, Frame, Hand, Image as IconoImagen, Map as IconoMapa, MessageCircle, Minus, MousePointer2, Play, Plus, Ruler, Smartphone, Monitor, Type } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { GRUPOS_PREFIJADOS, PREFIJADOS, type Prefijado } from '../../../../../compartido/diseno/prefijados'
import { nombreCapa } from '../../../../../compartido/diseno/capas'
import { Desplegable } from '../../../ui/Desplegable'
import { Kbd } from '../../../ui/comunes'
import { apiDiseno } from '../api'
import { useDiseno, type FondoLienzo, type Herramienta } from '../estado'
import { cadenaDe, elementoDeCapa } from './elegir'

const HERRAMIENTAS: { id: Herramienta | 'regla' | 'probar'; nombre: string; tecla: string; icono: ReactNode; grupo: number; crea?: boolean }[] = [
  { id: 'seleccionar', nombre: 'Seleccionar', tecla: 'V', icono: <MousePointer2 size={18} />, grupo: 0 },
  { id: 'mano', nombre: 'Mano', tecla: 'H', icono: <Hand size={18} />, grupo: 0 },
  { id: 'marco', nombre: 'Marco nuevo', tecla: 'F', icono: <Frame size={18} />, grupo: 1, crea: true },
  { id: 'texto', nombre: 'Texto', tecla: 'T', icono: <Type size={18} />, grupo: 1, crea: true },
  { id: 'imagen', nombre: 'Imagen', tecla: 'I', icono: <IconoImagen size={18} />, grupo: 1, crea: true },
  { id: 'caja', nombre: 'Caja', tecla: 'R', icono: <Box size={18} />, grupo: 1, crea: true },
  { id: 'regla', nombre: 'Regla fija', tecla: 'Shift+M', icono: <Ruler size={18} />, grupo: 2 },
  { id: 'probar', nombre: 'Probar', tecla: 'P', icono: <Play size={18} />, grupo: 2 },
  { id: 'comentar', nombre: 'Comentar', tecla: 'C', icono: <MessageCircle size={18} />, grupo: 2 },
]

export function Herramientas({ importada, alMarcoNuevo }: { importada: boolean; alMarcoNuevo: () => void }) {
  const herramienta = useDiseno((s) => s.herramienta)
  const reglaFija = useDiseno((s) => s.reglaFija)
  const probando = useDiseno((s) => s.probando)
  const activa = (id: string) => (id === 'regla' ? reglaFija : id === 'probar' ? Boolean(probando) : herramienta === id)
  const tocar = (id: (typeof HERRAMIENTAS)[number]['id']) => {
    const s = useDiseno.getState()
    if (id === 'regla') return s.set({ reglaFija: !s.reglaFija })
    if (id === 'probar') return alternarProbar()
    if (id === 'marco') return alMarcoNuevo()
    s.setHerramienta(id)
  }
  let grupo = 0
  return (
    <div className="dz-herramientas" role="toolbar" aria-label="Herramientas de Diseño">
      {HERRAMIENTAS.map((h) => {
        const sep = h.grupo !== grupo
        grupo = h.grupo
        const apagada = h.crea && importada
        return (
          <span key={h.id} className="dz-herramientas__grupo">
            {sep && <span className="dz-herramientas__sep" />}
            <button
              className={`dz-herramienta${activa(h.id) ? ' dz-herramienta--activa' : ''}`}
              aria-pressed={activa(h.id)}
              aria-disabled={apagada}
              aria-keyshortcuts={h.tecla}
              data-tip={apagada ? 'Esta página viene del código. Creá una página propia para diseñar' : h.nombre}
              data-tip-lado="arriba"
              data-tecla={apagada ? undefined : h.tecla.replace('Shift+', 'Mayús+')}
              onClick={() => !apagada && tocar(h.id)}
            >
              {activa(h.id) && <motion.span layoutId="dz-herramienta-activa" className="dz-herramienta__fondo" transition={{ type: 'spring', stiffness: 600, damping: 38 }} />}
              <span className="dz-herramienta__icono">{h.icono}</span>
            </button>
          </span>
        )
      })}
    </div>
  )
}

export function alternarProbar() {
  const s = useDiseno.getState()
  if (s.probando) return s.set({ probando: null })
  if (s.seleccion.marco) s.set({ probando: s.seleccion.marco, herramienta: 'seleccionar' })
}

export function Zoom({ alVerTodo, alVerSeleccion, minimapa, alMinimapa }: { alVerTodo: () => void; alVerSeleccion: () => void; minimapa: boolean; alMinimapa: () => void }) {
  const { zoom } = useViewport()
  const rf = useReactFlow()
  return (
    <div className="dz-zoom">
      <button className="dz-zoom__boton" onClick={() => rf.zoomOut({ duration: 160 })} aria-label="Alejar" data-tip="Alejar" data-tip-lado="arriba" data-tecla="−">
        <Minus size={16} />
      </button>
      <Desplegable
        lado="top-end"
        ancho={220}
        disparador={(p) => (
          <button {...p} className="dz-zoom__valor" aria-label="Opciones de zoom">
            {Math.round(zoom * 100)} %
          </button>
        )}
      >
        {(cerrar) => (
          <div className="menu__lista">
            {[0.5, 1, 2].map((z) => (
              <button key={z} className="menu__item" onClick={() => (rf.zoomTo(z, { duration: 240 }), cerrar())}>
                <span className="menu__texto">{z * 100} %</span>
                {z === 1 && <Kbd atajo="Shift+0" suave />}
              </button>
            ))}
            <button className="menu__item" onClick={() => (alVerTodo(), cerrar())}>
              <span className="menu__texto">Ver todo</span>
              <Kbd atajo="Shift+1" suave />
            </button>
            <button className="menu__item" onClick={() => (alVerSeleccion(), cerrar())}>
              <span className="menu__texto">Ver la selección</span>
              <Kbd atajo="Shift+2" suave />
            </button>
          </div>
        )}
      </Desplegable>
      <button className="dz-zoom__boton" onClick={() => rf.zoomIn({ duration: 160 })} aria-label="Acercar" data-tip="Acercar" data-tip-lado="arriba" data-tecla="+">
        <Plus size={16} />
      </button>
      <span className="dz-zoom__sep" />
      <button className={`dz-zoom__boton${minimapa ? ' dz-zoom__boton--activo' : ''}`} onClick={alMinimapa} aria-label="Minimapa" data-tip="Minimapa" data-tip-lado="arriba" data-tecla="M">
        <IconoMapa size={16} />
      </button>
    </div>
  )
}

/** "Celular › HUD del local › .hm-arriba › «¡Más pesos!»": cada parte sube a ese nivel. */
export function Migas() {
  const seleccion = useDiseno((s) => s.seleccion)
  const pagina = useDiseno((s) => s.pagina)
  const marco = useDiseno((s) => s.marcos.find((m) => m.id === s.seleccion.marco))
  const [, setTic] = useState(0)
  useEffect(() => {
    const f = () => setTic((n) => n + 1)
    window.addEventListener('telar:diseno-iframe', f)
    return () => window.removeEventListener('telar:diseno-iframe', f)
  }, [])
  if (!pagina || !marco) return null
  const el = seleccion.capa ? elementoDeCapa(marco.id, seleccion.capa) : null
  const cadena = el ? cadenaDe(el) : []
  const nombre = (e: HTMLElement) =>
    nombreCapa({ etiqueta: e.tagName, attr: (n) => e.getAttribute(n), textoPropio: Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''), texto: e.textContent ?? '', hijosElemento: e.children.length })
  const visibles = cadena.length > 4 ? [cadena[0]!, null, ...cadena.slice(-2)] : cadena
  return (
    <nav className="dz-migas" aria-label="Dónde está la selección">
      <button className="dz-migas__parte" onClick={() => useDiseno.getState().seleccionar({ marco: null, capa: null })}>
        {pagina.nombre}
      </button>
      <ChevronRight size={12} className="dz-migas__sep" />
      <button className="dz-migas__parte" onClick={() => useDiseno.getState().seleccionar({ marco: marco.id, capa: null })}>
        {marco.nombre}
      </button>
      {visibles.map((c, i) => (
        <span key={c ? c.getAttribute('data-id')! : `…${i}`} className="dz-migas__tramo">
          <ChevronRight size={12} className="dz-migas__sep" />
          {c ? (
            <button className="dz-migas__parte" onClick={() => useDiseno.getState().seleccionar({ marco: marco.id, capa: c.getAttribute('data-id') })}>
              {nombre(c)}
            </button>
          ) : (
            <span className="dz-migas__parte dz-migas__parte--puntos">…</span>
          )}
        </span>
      ))}
    </nav>
  )
}

const FONDOS: { id: FondoLienzo; nombre: string }[] = [
  { id: 'claro', nombre: 'Claro' },
  { id: 'medio', nombre: 'Medio' },
  { id: 'oscuro', nombre: 'Oscuro' },
]

export function FondoYModo() {
  const fondo = useDiseno((s) => s.pref.fondo)
  const modo = useDiseno((s) => s.modo)
  const marco = useDiseno((s) => s.marcos.find((m) => m.id === s.seleccion.marco))
  const marcos = useDiseno((s) => s.marcos)
  const tokens = useDiseno((s) => s.items.token)
  const modos = useMemo(() => [...new Set((tokens ?? []).flatMap((t) => Object.keys((t.datos as { modos?: Record<string, string> }).modos ?? {})))], [tokens])
  const par = marco?.datos.par ? marcos.find((m) => m.id !== marco.id && m.datos.par === marco.datos.par) : null
  const s = useDiseno.getState
  return (
    <div className="dz-arriba-der">
      <div className="dz-fondos" role="radiogroup" aria-label="Fondo del lienzo">
        {FONDOS.map((f) => (
          <button
            key={f.id}
            role="radio"
            aria-checked={fondo === f.id}
            className={`dz-fondo dz-fondo--${f.id}${fondo === f.id ? ' dz-fondo--activo' : ''}`}
            onClick={() => s().setPref({ fondo: f.id })}
            data-tip={`Fondo ${f.nombre.toLowerCase()}`}
          />
        ))}
      </div>
      {modos.length > 0 && (
        <div className="segmentado segmentado--chico dz-modos">
          <button className={`segmentado__opcion${!modo ? ' segmentado__opcion--activa' : ''}`} onClick={() => s().set({ modo: null })}>
            Normal
          </button>
          {modos.map((m) => (
            <button key={m} className={`segmentado__opcion${modo === m ? ' segmentado__opcion--activa' : ''}`} onClick={() => s().set({ modo: m })}>
              {m}
            </button>
          ))}
        </div>
      )}
      {par && (
        <button className="boton boton--chico dz-par" onClick={() => window.dispatchEvent(new CustomEvent('telar:diseno-ir', { detail: { pagina: par.paginaId, marco: par.id } }))}>
          {par.datos.vista === 'pc' ? <Monitor size={14} /> : <Smartphone size={14} />} Ver en {par.datos.vista === 'pc' ? 'PC' : 'celular'}
        </button>
      )}
    </div>
  )
}

/** Ventanita "Marco nuevo" (F): los prefijados por grupo; se elige uno y se hace clic en el lienzo. */
export function MarcoNuevo({ alCerrar }: { alCerrar: () => void }) {
  const prefijo = useDiseno((s) => s.prefijo)
  const [delProyecto, setDelProyecto] = useState<Prefijado[]>([])
  const [ancho, setAncho] = useState(1080)
  const [alto, setAlto] = useState(1080)
  useEffect(() => {
    if (prefijo) apiDiseno.prefijados(prefijo).then((r) => setDelProyecto(r.delProyecto)).catch(() => {})
  }, [prefijo])
  const elegir = (p: { id: string; nombre: string; ancho: number; alto: number }) => {
    useDiseno.getState().set({ marcoNuevo: { prefijado: p.id, ancho: p.ancho, alto: p.alto, nombre: p.nombre }, herramienta: 'marco' })
    alCerrar()
  }
  const todos = [...PREFIJADOS, ...delProyecto]
  return (
    <motion.div className="dz-marco-nuevo" initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.14 }}>
      <div className="dz-marco-nuevo__cab">
        <b>Marco nuevo</b>
        <span>Elegí un tamaño y hacé clic en el lienzo</span>
      </div>
      <div className="dz-marco-nuevo__lista">
        {GRUPOS_PREFIJADOS.map((g) => {
          const lista = todos.filter((p) => p.grupo === g)
          if (!lista.length) return null
          return (
            <section key={g}>
              <h4>{g}</h4>
              {lista.map((p) => (
                <button key={p.id} className="dz-marco-nuevo__fila" onClick={() => elegir(p)}>
                  <span className="dz-marco-nuevo__forma" style={{ aspectRatio: `${p.ancho} / ${p.alto}`, [p.ancho >= p.alto ? 'width' : 'height' as string]: 18 }} />
                  <span className="dz-marco-nuevo__nombre">{p.nombre}</span>
                  <span className="dz-marco-nuevo__medida">
                    {p.ancho} × {p.alto}
                  </span>
                </button>
              ))}
            </section>
          )
        })}
        <section>
          <h4>A medida</h4>
          <form
            className="dz-marco-nuevo__medida-propia"
            onSubmit={(e) => {
              e.preventDefault()
              elegir({ id: 'a-medida', nombre: 'Marco', ancho: Math.max(16, Math.min(8192, ancho)), alto: Math.max(16, Math.min(8192, alto)) })
            }}
          >
            <input className="campo" type="number" min={16} max={8192} value={ancho} onChange={(e) => setAncho(Number(e.target.value))} aria-label="Ancho" />
            <span>×</span>
            <input className="campo" type="number" min={16} max={8192} value={alto} onChange={(e) => setAlto(Number(e.target.value))} aria-label="Alto" />
            <button className="boton boton--chico boton--primario">Elegir</button>
          </form>
        </section>
      </div>
    </motion.div>
  )
}
