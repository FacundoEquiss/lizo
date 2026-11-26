// Inspector · pestaña Notas (plan 6.6 y 6.8): nombre propio, uso, estado (Vigente · Revisar · Viejo), nota en Markdown y
// los comentarios del objetivo. Lo escrito acá no lo pisa ninguna sincronización.
import { Check, CornerDownRight, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ComentarioDiseno, NotaDiseno } from '../../../../../compartido/diseno/tipos'
import { avisarError } from '../../../estado/avisos'
import { TextoAuto } from '../../../ui/comunes'
import { Markdown } from '../../../ui/Markdown'
import { hace } from '../../../util/fechas'
import { apiDiseno } from '../api'
import { useDiseno } from '../estado'
import { Interruptor, Seccion } from '../ui'

const ESTADOS = [
  ['vigente', 'Vigente'],
  ['revisar', 'Revisar'],
  ['viejo', 'Viejo'],
] as const

export function Notas({ objetivo }: { objetivo: string }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const [nota, setNota] = useState<NotaDiseno | null>(null)
  const [cargada, setCargada] = useState(false)
  const [editandoNota, setEditandoNota] = useState(false)
  const [borrador, setBorrador] = useState('')
  useEffect(() => {
    let vivo = true
    setCargada(false)
    apiDiseno
      .notas(prefijo, [objetivo])
      .then((ns) => {
        if (!vivo) return
        setNota(ns[0] ?? null)
        setCargada(true)
      })
      .catch(() => vivo && setCargada(true))
    return () => {
      vivo = false
    }
  }, [prefijo, objetivo])

  const guardar = async (c: Partial<Pick<NotaDiseno, 'nombrePropio' | 'uso' | 'nota' | 'estado'>>) => {
    try {
      const n = await apiDiseno.guardarNota(prefijo, { objetivo, ...c })
      setNota(n)
    } catch (e) {
      avisarError(e)
    }
  }

  if (!cargada) return null
  return (
    <>
      <Seccion titulo="Notas">
        <label className="dz-campo-etiquetado">
          <span>Nombre propio</span>
          <input
            className="campo"
            defaultValue={nota?.nombrePropio ?? ''}
            placeholder="Cómo le dicen en el equipo"
            onBlur={(e) => e.currentTarget.value !== (nota?.nombrePropio ?? '') && void guardar({ nombrePropio: e.currentTarget.value || null })}
          />
        </label>
        <label className="dz-campo-etiquetado">
          <span>Uso</span>
          <input className="campo" defaultValue={nota?.uso ?? ''} placeholder="Para qué se usa, en una línea" onBlur={(e) => e.currentTarget.value !== (nota?.uso ?? '') && void guardar({ uso: e.currentTarget.value || null })} />
        </label>
        <div className="dz-campo-etiquetado">
          <span>Estado</span>
          <div className="segmentado segmentado--chico">
            {ESTADOS.map(([id, nombre]) => (
              <button key={id} className={`segmentado__opcion${nota?.estado === id ? ' segmentado__opcion--activa' : ''}`} onClick={() => void guardar({ estado: nota?.estado === id ? null : id })}>
                {nombre}
              </button>
            ))}
          </div>
        </div>
        <div className="dz-campo-etiquetado">
          <span>Nota</span>
          {editandoNota ? (
            <TextoAuto
              className="campo-texto"
              minFilas={3}
              autoFocus
              value={borrador}
              onChange={(e) => setBorrador(e.currentTarget.value)}
              onBlur={() => {
                setEditandoNota(false)
                if (borrador !== (nota?.nota ?? '')) void guardar({ nota: borrador || null })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditandoNota(false)
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
              }}
            />
          ) : (
            <button
              className="dz-nota"
              onClick={() => {
                setBorrador(nota?.nota ?? '')
                setEditandoNota(true)
              }}
            >
              {nota?.nota ? <Markdown texto={nota.nota} /> : <span className="dz-nota__vacia">Escribir una nota…</span>}
            </button>
          )}
        </div>
        {nota?.actualizadoPor && (
          <p className="dz-inota">
            {nota.actualizadoPor.nombre} · {hace(nota.actualizadoEn)}
          </p>
        )}
      </Seccion>
      <Comentarios objetivo={objetivo} />
    </>
  )
}

export function Comentarios({ objetivo }: { objetivo: string }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const resueltos = useDiseno((s) => s.pref.resueltos)
  const [lista, setLista] = useState<ComentarioDiseno[]>([])
  const [texto, setTexto] = useState('')
  const [respondiendo, setRespondiendo] = useState<string | null>(null)
  const [v, setV] = useState(0)
  useEffect(() => {
    let vivo = true
    apiDiseno
      .comentarios(prefijo, objetivo)
      .then((r) => vivo && setLista(r))
      .catch(() => {})
    const f = () => setV((x) => x + 1)
    window.addEventListener('telar:diseno-comentarios', f)
    return () => {
      vivo = false
      window.removeEventListener('telar:diseno-comentarios', f)
    }
  }, [prefijo, objetivo, v])
  const raices = lista.filter((c) => !c.respuestaA && (resueltos || !c.resuelto))
  const publicar = async (respondeA?: string) => {
    if (!texto.trim()) return
    try {
      await apiDiseno.comentar(prefijo, respondeA ? { texto, respondeA } : { en: objetivo, texto })
      setTexto('')
      setRespondiendo(null)
      window.dispatchEvent(new Event('telar:diseno-comentarios'))
    } catch (e) {
      avisarError(e)
    }
  }
  return (
    <Seccion
      titulo="Comentarios"
      accion={
        <label className="dz-resueltos">
          <span>Resueltos</span>
          <Interruptor etiqueta="Mostrar los resueltos" valor={resueltos} alCambiar={(r) => useDiseno.getState().setPref({ resueltos: r })} />
        </label>
      }
    >
      {raices.length === 0 && <p className="dz-inota">Sin comentarios. Con la herramienta Comentar (C) se deja uno en un punto del marco.</p>}
      {raices.map((c) => (
        <div key={c.id} className={`dz-hilo${c.resuelto ? ' dz-hilo--resuelto' : ''}`} data-comentario={c.id}>
          <Comentario c={c} />
          {lista
            .filter((r) => r.respuestaA === c.id)
            .map((r) => (
              <div key={r.id} className="dz-hilo__respuesta">
                <CornerDownRight size={12} aria-hidden />
                <Comentario c={r} />
              </div>
            ))}
          <div className="dz-hilo__acciones">
            <button className="boton boton--chico boton--fantasma" onClick={() => setRespondiendo(respondiendo === c.id ? null : c.id)}>
              Responder
            </button>
            <button
              className="boton boton--chico boton--fantasma"
              onClick={() =>
                apiDiseno
                  .actualizarComentario(prefijo, c.id, { resuelto: !c.resuelto })
                  .then(() => window.dispatchEvent(new Event('telar:diseno-comentarios')))
                  .catch(avisarError)
              }
            >
              {c.resuelto ? <RotateCcw size={12} /> : <Check size={12} />} {c.resuelto ? 'Reabrir' : 'Resolver'}
            </button>
          </div>
          {respondiendo === c.id && <Campo texto={texto} setTexto={setTexto} alPublicar={() => void publicar(c.id)} placeholder="Responder…" />}
        </div>
      ))}
      {!respondiendo && <Campo texto={texto} setTexto={setTexto} alPublicar={() => void publicar()} placeholder="Comentar…" />}
    </Seccion>
  )
}

function Comentario({ c }: { c: ComentarioDiseno }) {
  return (
    <div className="dz-comentario">
      <p className="dz-comentario__cab">
        <span className={`dz-comentario__autor${c.autor.tipo === 'ia' ? ' dz-comentario__autor--ia' : ''}`}>{c.autor.nombre}</span>
        <span className="dz-comentario__cuando">{hace(c.creadoEn)}</span>
      </p>
      <Markdown texto={c.texto} className="dz-comentario__texto" />
    </div>
  )
}

function Campo({ texto, setTexto, alPublicar, placeholder }: { texto: string; setTexto: (t: string) => void; alPublicar: () => void; placeholder: string }) {
  return (
    <div className="dz-comentar">
      <TextoAuto
        className="campo-texto"
        minFilas={1}
        value={texto}
        placeholder={placeholder}
        onChange={(e) => setTexto(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            alPublicar()
          }
        }}
      />
      {texto.trim() && (
        <button className="boton boton--primario boton--chico" onClick={alPublicar} data-tecla="$mod+Enter">
          Publicar
        </button>
      )}
    </div>
  )
}
