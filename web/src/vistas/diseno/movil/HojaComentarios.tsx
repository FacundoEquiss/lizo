// Los comentarios de un marco en el teléfono: leer los hilos, responder, resolver y comentar. Un comentario puede ir a un
// punto del marco (el botón del pin marca el lugar con el próximo toque) y queda como pin numerado en el marco, igual que
// en la PC. Comentar va fijo al pie de la hoja, sobre el teclado, como en la tarjeta.
import { ArrowUp, Check, CornerDownRight, MapPin, MessageCircle, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComentarioDiseno } from '../../../../../compartido/diseno/tipos'
import { avisarError } from '../../../estado/avisos'
import { HojaInferior, useHoja } from '../../../movil/ui/HojaInferior'
import { useConexion } from '../../../pwa/estado'
import { Girando, TextoAuto } from '../../../ui/comunes'
import { Markdown } from '../../../ui/Markdown'
import { hace } from '../../../util/fechas'
import { apiDiseno } from '../api'
import { useDiseno } from '../estado'
import { EstadoVacio } from '../ui'
import { useDisenoMovil, type PuntoComentario } from './estado'
import { useHojaDe, useUltimo } from './Hojas'

export function HojaComentarios() {
  const h = useHojaDe('comentarios')
  const ultimo = useUltimo(h)
  const prefijo = useDiseno((s) => s.prefijo)
  const campo = useRef<HTMLTextAreaElement>(null)
  const [lista, setLista] = useState<ComentarioDiseno[] | null>(null)
  const [texto, setTexto] = useState('')
  const [respondiendo, setRespondiendo] = useState<ComentarioDiseno | null>(null)
  const marco = ultimo?.marco ?? null
  const punto = h?.punto ?? null

  // Los comentarios del marco (y otra vez cuando alguien comenta, también Claude por MCP).
  useEffect(() => {
    if (!h || !prefijo || !marco) return
    let vivo = true
    const cargar = () =>
      apiDiseno
        .comentarios(prefijo, `marco:${marco}`)
        .then((cs) => vivo && setLista(cs))
        .catch((e) => {
          if (!vivo) return
          setLista((l) => l ?? [])
          avisarError(e)
        })
    cargar()
    window.addEventListener('telar:diseno-comentarios', cargar)
    const enVivo = (e: Event) => {
      const d = (e as CustomEvent<{ datos?: { accion?: string; marcos?: string[] } }>).detail?.datos
      if (d?.accion === 'comentario' && (!d.marcos || d.marcos.includes(marco))) cargar()
    }
    window.addEventListener('telar:diseno', enVivo)
    return () => {
      vivo = false
      window.removeEventListener('telar:diseno-comentarios', cargar)
      window.removeEventListener('telar:diseno', enVivo)
    }
  }, [!!h, prefijo, marco])

  // Otro marco: borrón y cuenta nueva.
  useEffect(() => {
    setLista(null)
    setTexto('')
    setRespondiendo(null)
  }, [marco])

  const cerrar = () => useDisenoMovil.getState().set({ hoja: null, borrador: null })
  return (
    <HojaInferior
      abierta={!!h}
      alCerrar={cerrar}
      titulo="Comentarios"
      className="dzm-hoja dzm-hoja--comentarios"
      enfocar={punto ? campo : undefined}
      pie={
        marco && (
          <Comentar
            marco={marco}
            punto={punto}
            texto={texto}
            setTexto={setTexto}
            respondiendo={respondiendo}
            alTerminar={() => {
              setTexto('')
              setRespondiendo(null)
            }}
            alCancelarRespuesta={() => setRespondiendo(null)}
            campo={campo}
          />
        )
      }
    >
      {marco && (
        <Hilos
          lista={lista}
          hilo={h?.hilo}
          alResponder={(c) => {
            setRespondiendo(c)
            requestAnimationFrame(() => campo.current?.focus())
          }}
        />
      )}
    </HojaInferior>
  )
}

function Hilos({ lista, hilo, alResponder }: { lista: ComentarioDiseno[] | null; hilo?: string; alResponder: (c: ComentarioDiseno) => void }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const [verResueltos, setVerResueltos] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const raices = useMemo(() => (lista ?? []).filter((c) => !c.respuestaA), [lista])
  const abiertos = raices.filter((c) => !c.resuelto)
  const resueltos = raices.filter((c) => c.resuelto)
  // El número de cada pin (el mismo que se ve en el marco).
  const numeros = useMemo(() => {
    const n = new Map<string, number>()
    abiertos.filter((c) => c.x != null).forEach((c, i) => n.set(c.id, i + 1))
    return n
  }, [abiertos])

  // El hilo pedido (el pin que se tocó) queda a la vista y destella.
  useEffect(() => {
    if (!hilo || !lista) return
    const el = ref.current?.querySelector<HTMLElement>(`[data-hilo="${CSS.escape(hilo)}"]`)
    if (!el) return
    if (lista.find((c) => c.id === hilo)?.resuelto) setVerResueltos(true)
    requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }, [hilo, lista])

  if (!lista)
    return (
      <div className="dzm-estado dzm-estado--chico">
        <Girando tam={20} />
      </div>
    )
  if (!raices.length)
    return (
      <div className="dzm-estado dzm-estado--chico">
        <EstadoVacio
          icono={<MessageCircle size={28} />}
          titulo="Todavía no hay comentarios"
          ayuda={
            <>
              Escribí uno abajo, o tocá <MapPin size={14} className="dzm-en-linea" aria-label="el pin" /> para dejarlo en un punto del marco.
            </>
          }
        />
      </div>
    )
  const resolver = (c: ComentarioDiseno) =>
    apiDiseno
      .actualizarComentario(prefijo, c.id, { resuelto: !c.resuelto })
      .then(() => window.dispatchEvent(new Event('telar:diseno-comentarios')))
      .catch(avisarError)
  const unHilo = (c: ComentarioDiseno) => (
    <article key={c.id} className={`dzm-hilo${c.resuelto ? ' dzm-hilo--resuelto' : ''}${hilo === c.id ? ' dzm-hilo--elegido' : ''}`} data-hilo={c.id}>
      <Comentario c={c} numero={numeros.get(c.id)} />
      {(lista ?? [])
        .filter((r) => r.respuestaA === c.id)
        .map((r) => (
          <div key={r.id} className="dzm-hilo__respuesta">
            <CornerDownRight size={14} aria-hidden className="dzm-hilo__flecha" />
            <Comentario c={r} />
          </div>
        ))}
      <div className="dzm-hilo__acciones">
        {!c.resuelto && (
          <button type="button" className="boton boton--fantasma" onClick={() => alResponder(c)}>
            Responder
          </button>
        )}
        <button type="button" className="boton boton--fantasma" onClick={() => void resolver(c)}>
          {c.resuelto ? <RotateCcw size={16} /> : <Check size={16} />} {c.resuelto ? 'Reabrir' : 'Resolver'}
        </button>
      </div>
    </article>
  )
  return (
    <div className="dzm-hilos" ref={ref}>
      {abiertos.map(unHilo)}
      {abiertos.length === 0 && <p className="dzm-nota">No hay comentarios abiertos.</p>}
      {resueltos.length > 0 && (
        <button type="button" className="dzm-enlace" onClick={() => setVerResueltos((v) => !v)} aria-expanded={verResueltos}>
          {verResueltos ? 'Esconder los resueltos' : `Ver ${resueltos.length === 1 ? 'el resuelto' : `los ${resueltos.length} resueltos`}`}
        </button>
      )}
      {verResueltos && resueltos.map(unHilo)}
    </div>
  )
}

function Comentario({ c, numero }: { c: ComentarioDiseno; numero?: number }) {
  const capa = c.objetivo.includes('#') ? c.objetivo.split('#')[1] : null
  return (
    <div className="dzm-comentario">
      <span className={`dzm-comentario__cara${c.autor.tipo === 'ia' ? ' dzm-comentario__cara--ia' : ''}`} aria-hidden>
        {c.autor.tipo === 'ia' ? '✦' : (c.autor.nombre[0] ?? '?').toUpperCase()}
      </span>
      <div className="dzm-comentario__cuerpo">
        <p className="dzm-comentario__cab">
          <span className="dzm-comentario__autor">{c.autor.nombre}</span>
          <span className="dzm-comentario__cuando">{hace(c.creadoEn)}</span>
          {numero !== undefined && (
            <span className="dzm-comentario__pin" aria-label={`Pin ${numero} en el marco`}>
              <MapPin size={12} aria-hidden /> {numero}
            </span>
          )}
        </p>
        <Markdown texto={c.texto} className="dzm-comentario__texto" />
        {capa && !numero && <p className="dzm-comentario__capa">sobre una capa del marco</p>}
      </div>
    </div>
  )
}

function Comentar({
  marco,
  punto,
  texto,
  setTexto,
  respondiendo,
  alTerminar,
  alCancelarRespuesta,
  campo,
}: {
  marco: string
  punto: PuntoComentario | null
  texto: string
  setTexto: (t: string) => void
  respondiendo: ComentarioDiseno | null
  alTerminar: () => void
  alCancelarRespuesta: () => void
  campo: React.RefObject<HTMLTextAreaElement | null>
}) {
  const hoja = useHoja()
  const prefijo = useDiseno((s) => s.prefijo)!
  const enLinea = useConexion()
  const [enviando, setEnviando] = useState(false)
  const quitarPunto = () => useDisenoMovil.getState().set({ borrador: null, hoja: { tipo: 'comentarios', marco } })
  const enviar = async () => {
    const cuerpo = texto.trim()
    if (!cuerpo || enviando) return
    setEnviando(true)
    try {
      if (respondiendo) await apiDiseno.comentar(prefijo, { texto: cuerpo, respondeA: respondiendo.id })
      else
        await apiDiseno.comentar(prefijo, {
          en: `marco:${marco}${punto?.capa ? `#${punto.capa}` : ''}`,
          texto: cuerpo,
          punto: punto ? { x: punto.x, y: punto.y } : undefined,
        })
      alTerminar()
      if (punto) quitarPunto()
      window.dispatchEvent(new Event('telar:diseno-comentarios'))
    } catch (e) {
      avisarError(e)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <div className="dzm-comentar">
      {(respondiendo || punto) && (
        <div className="dzm-comentar__contexto">
          {respondiendo ? (
            <span>
              Respondiendo a <b>{respondiendo.autor.nombre}</b>
            </span>
          ) : (
            <span>
              <MapPin size={14} aria-hidden /> En el punto que marcaste
            </span>
          )}
          <button type="button" className="dzm-comentar__quitar" onClick={respondiendo ? alCancelarRespuesta : quitarPunto} aria-label={respondiendo ? 'No responder' : 'Quitar el punto'}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="dzm-comentar__fila">
        {!respondiendo && (
          <button
            type="button"
            className={`dzm-comentar__pin${punto ? ' dzm-comentar__pin--puesto' : ''}`}
            aria-label="Marcar un punto en el marco"
            onClick={() => hoja?.cerrarYLuego(() => useDisenoMovil.getState().set({ modo: 'comentar', borrador: null }))}
          >
            <MapPin size={20} />
          </button>
        )}
        <TextoAuto
          ref={campo}
          className="dzm-comentar__campo"
          value={texto}
          minFilas={1}
          placeholder={respondiendo ? 'Tu respuesta…' : 'Escribí un comentario…'}
          aria-label={respondiendo ? 'Respuesta' : 'Comentario'}
          onChange={(e) => setTexto(e.target.value)}
          data-sin-centrar
        />
        <button
          type="button"
          className="dzm-comentar__enviar"
          disabled={!texto.trim() || !enLinea || enviando}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void enviar()}
          aria-label={enLinea ? 'Mandar el comentario' : 'Sin conexión'}
        >
          {enviando ? <Girando tam={16} /> : <ArrowUp size={18} strokeWidth={2.6} />}
        </button>
      </div>
    </div>
  )
}
