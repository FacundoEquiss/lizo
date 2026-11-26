// La tarjeta en el teléfono (plan del celular, 6): hoja a pantalla completa que sube desde abajo. La tarjeta de Telar es
// larga (descripción, porqué con opciones, checklists, adjuntos, vínculos, comentarios): a media altura obligaría a
// deslizar dentro de una ventana chica. Usa el contenido de la tarjeta de escritorio tal cual (N6); el orden del celular
// (propiedades arriba, el porqué a continuación de la descripción) lo arma movil.css.
//   · Se cierra con la flecha de arriba, con "atrás" (vive en la dirección) o deslizando hacia abajo: desde la cabecera
//     siempre, y desde el contenido cuando ya está arriba de todo (movil/ui/deslizar.ts).
//   · Comentar queda fijo al pie, sobre el teclado; los campos que se guardan al salir tienen una barra con Cancelar y
//     Guardar pegada al teclado.
//   · En horizontal: dos columnas (contenido y propiedades), cada una con su scroll.
import { FloatingFocusManager, FloatingNode, FloatingTree, useFloating, useFloatingNodeId } from '@floating-ui/react'
import { ArrowUp, ChevronDown, Reply, WifiOff, X } from 'lucide-react'
import { AnimatePresence, motion, useDragControls, useMotionValue, useReducedMotion, type PanInfo } from 'motion/react'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { esVivo } from '../../../../compartido/ia'
import type { TarjetaDetalle } from '../../../../compartido/tipos'
import { api } from '../../estado/api'
import { avisarError } from '../../estado/avisos'
import { useIA, useRespondiendo } from '../../estado/ia'
import { useTienda } from '../../estado/tienda'
import { ponerColorBarra } from '../../pwa/color-barra'
import { useConexion } from '../../pwa/estado'
import { CampoConMenciones } from '../../ui/CampoConMenciones'
import { Avatar, Girando } from '../../ui/comunes'
import { ContenidoTarjeta } from '../../vistas/tarjeta/DetalleTarjeta'
import { useEsApaisado } from '../detectar'
import { useDeslizarParaCerrar } from '../ui/deslizar'
import { NivelHoja } from '../ui/HojaInferior'

// «Claude está pensando… Frenar» arriba del campo: se baja recién cuando hay un trabajo vivo en esta tarjeta (plan 14.4).
const PastillaTrabajo = lazy(() => import('../../vistas/ia/PastillaTrabajo'))

const RESORTE = { type: 'spring' as const, stiffness: 420, damping: 40, mass: 0.9 }

export function HojaTarjeta({ abiertaAlArrancar }: { abiertaAlArrancar: boolean }) {
  return (
    <FloatingTree>
      <Hoja abiertaAlArrancar={abiertaAlArrancar} />
    </FloatingTree>
  )
}

function Hoja({ abiertaAlArrancar }: { abiertaAlArrancar: boolean }) {
  const clave = useTienda((s) => s.claveAbierta)
  const detalle = useTienda((s) => s.detalle)
  const reducido = useReducedMotion()
  const controles = useDragControls()
  const nodeId = useFloatingNodeId()
  const refHoja = useRef<HTMLDivElement | null>(null)
  const sinAnimar = useRef(abiertaAlArrancar)
  const cerrar = () => useTienda.getState().cerrarTarjeta()
  const { refs, context } = useFloating({ nodeId, open: !!clave, onOpenChange: (v) => !v && cerrar() })
  const t = detalle && clave && (detalle.clave === clave || detalle.id === clave) ? detalle : null
  // El desplazamiento de la hoja: lo mueven el arrastre de la cabecera (motion) y el deslizar desde el contenido.
  const y = useMotionValue(0)
  useDeslizarParaCerrar({ hoja: refHoja, eje: 'y', valor: y, activo: !!clave && !reducido, alCerrar: cerrar, resorte: RESORTE })

  // Mientras está abierta, la barra del sistema toma el color de la hoja.
  useEffect(() => {
    if (!clave) return
    return ponerColorBarra('--c-superficie')
  }, [!!clave])

  // Solo la primera, si la app arrancó con ?tarjeta=: aparece ya abierta, sin animación.
  useEffect(() => {
    if (clave) return
    sinAnimar.current = false
  }, [clave])

  useEffect(() => {
    if (!clave) return
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = e.target as HTMLElement
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable) return
      if (document.querySelector('.hoja-inferior__capa')) return
      cerrar()
    }
    addEventListener('keydown', alTeclear)
    return () => removeEventListener('keydown', alTeclear)
  }, [clave])

  const alSoltar = (_e: unknown, info: PanInfo) => {
    if (info.offset.y > 96 || info.velocity.y > 500) cerrar()
  }

  return createPortal(
    <FloatingNode id={nodeId}>
      <AnimatePresence>
        {clave && (
          <NivelHoja.Provider value={1}>
            <FloatingFocusManager context={context} modal initialFocus={refHoja} returnFocus>
              <motion.div
                ref={(el) => {
                  refHoja.current = el
                  refs.setFloating(el)
                }}
                className="hoja hoja-movil"
                style={{ y }}
                role="dialog"
                aria-modal="true"
                aria-label={t ? `${t.clave}: ${t.titulo}` : 'Tarjeta'}
                tabIndex={-1}
                initial={sinAnimar.current ? false : reducido ? { opacity: 0 } : { y: '100%' }}
                animate={reducido ? { opacity: 1 } : { y: 0 }}
                exit={reducido ? { opacity: 0, transition: { duration: 0.12 } } : { y: '100%', transition: { duration: 0.2, ease: [0.32, 0, 0.67, 0] } }}
                transition={RESORTE}
                drag={reducido ? false : 'y'}
                dragControls={controles}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.04, bottom: 0.9 }}
                dragMomentum={false}
                onDragEnd={alSoltar}
                onPointerDownCapture={(e) => {
                  // Se arrastra desde la cabecera (no desde el contenido, que se desplaza; ni desde sus botones).
                  const el = e.target as HTMLElement
                  if (el.closest('.hoja__cabecera') && !el.closest('button, a, input, textarea')) controles.start(e)
                }}
              >
                <button type="button" className="hoja-movil__cerrar" onClick={cerrar} aria-label="Cerrar la tarjeta">
                  <ChevronDown size={24} />
                </button>
                {t ? (
                  <>
                    <Contenido t={t} />
                    <ComentarMovil t={t} />
                    <BarraEdicion />
                  </>
                ) : (
                  <div className="hoja__cargando">
                    <Girando tam={22} />
                  </div>
                )}
              </motion.div>
            </FloatingFocusManager>
          </NivelHoja.Provider>
        )}
      </AnimatePresence>
    </FloatingNode>,
    document.body,
  )
}

/** El contenido de escritorio, más lo que el celular necesita alrededor: conservar el scroll al girar y avisar sin red. */
function Contenido({ t }: { t: TarjetaDetalle }) {
  const apaisado = useEsApaisado()
  const enLinea = useConexion()
  const ref = useRef<HTMLDivElement>(null)
  const proporcion = useRef(0)
  const sinDetalle = (t.campos as { __sinConexion?: boolean } | undefined)?.__sinConexion

  // Al girar se conserva la posición relativa del scroll (el diseño cambia: una columna o dos).
  const zona = () => {
    const raiz = ref.current
    if (!raiz) return null
    return (apaisado ? raiz.querySelector<HTMLElement>('.hoja__principal') : raiz.querySelector<HTMLElement>('.hoja__marco')) ?? null
  }
  useEffect(() => {
    const raiz = ref.current
    if (!raiz) return
    const alDesplazar = (e: Event) => {
      const el = e.target as HTMLElement
      if (!el.classList.contains('hoja__marco') && !el.classList.contains('hoja__principal')) return
      const max = el.scrollHeight - el.clientHeight
      proporcion.current = max > 0 ? el.scrollTop / max : 0
    }
    raiz.addEventListener('scroll', alDesplazar, true)
    return () => raiz.removeEventListener('scroll', alDesplazar, true)
  }, [])
  useLayoutEffect(() => {
    const el = zona()
    if (el) el.scrollTop = proporcion.current * (el.scrollHeight - el.clientHeight)
  }, [apaisado])

  return (
    <div ref={ref} className={`hoja-movil__contenido${sinDetalle ? ' hoja-movil__contenido--minima' : ''}`}>
      {(sinDetalle || !enLinea) && (
        <p className="hoja-movil__aviso" role="status">
          <WifiOff size={15} />
          {sinDetalle ? 'El detalle se ve con conexión.' : 'Sin conexión: lo que escribas no se guarda.'}
        </p>
      )}
      <ContenidoTarjeta t={t} />
    </div>
  )
}

/** Comentar fijo al pie de la hoja (48 px), sobre la zona segura y sobre el teclado. Si no se puede mandar, el texto queda. */
function ComentarMovil({ t }: { t: TarjetaDetalle }) {
  const miembros = useTienda((s) => s.miembros)
  const enLinea = useConexion()
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const campo = useRef<HTMLTextAreaElement>(null)
  const yo = miembros.find((m) => m.esYo)
  // «Responder» (en cada comentario) pone la tarjeta y el comentario acá; vale solo si el comentario sigue en esta tarjeta.
  const respondiendo = useRespondiendo((s) => s.a)
  const pedidoDeFoco = useRespondiendo((s) => s.foco)
  const aQuien = respondiendo && respondiendo.tarjeta === t.clave && t.comentarios.some((c) => c.id === respondiendo.comentarioId) ? respondiendo : null
  const trabajando = useIA((s) => Object.values(s.trabajos).some((x) => esVivo(x.estado) && x.tarjetaClave === t.clave))
  useEffect(() => setTexto(''), [t.id])
  useEffect(() => {
    if (pedidoDeFoco) campo.current?.focus()
  }, [pedidoDeFoco])
  const enviar = async () => {
    const cuerpo = texto.trim()
    if (!cuerpo || enviando) return
    setEnviando(true)
    try {
      const c = await api.comentar(t.clave, cuerpo, aQuien ? { respondeA: aQuien.comentarioId } : undefined)
      // Si mencionó a un agente que no puede responder ahora, el servidor dice por qué y el hilo lo muestra con «Reintentar».
      if (c.menciones?.length) useIA.getState().sumarEsperando(c.menciones)
      setTexto('')
      useRespondiendo.getState().dejar()
      await useTienda.getState().recargarDetalle()
    } catch (e) {
      avisarError(e)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <div className="comentar-movil" data-conserva-foco data-ancla-menciones>
      {trabajando && (
        <Suspense fallback={null}>
          <PastillaTrabajo className="comentar-movil__trabajando" soloTarjeta={t.clave} />
        </Suspense>
      )}
      {aQuien && (
        <div className="comentar-movil__respondiendo">
          <Reply size={14} aria-hidden />
          <span>Respondiendo a {aQuien.autor}</span>
          <button type="button" className="boton-icono" onClick={() => useRespondiendo.getState().dejar()} aria-label={`Dejar de responder a ${aQuien.autor}`}>
            <X size={16} />
          </button>
        </div>
      )}
      <Avatar miembro={yo} tam={28} />
      <CampoConMenciones
        ref={campo}
        className="comentar-movil__campo"
        value={texto}
        minFilas={1}
        placeholder="Escribí un comentario… Con @ mencionás"
        aria-label="Comentario"
        onChange={(e) => setTexto(e.target.value)}
        data-sin-centrar
      />
      {texto.trim() && (
        <button
          type="button"
          className="comentar-movil__enviar"
          disabled={!enLinea || enviando}
          onMouseDown={(e) => e.preventDefault()}
          onClick={enviar}
          aria-label={enLinea ? 'Mandar el comentario' : 'Sin conexión'}
        >
          {enLinea ? enviando ? <Girando tam={16} /> : <ArrowUp size={18} strokeWidth={2.6} /> : <span>Sin conexión</span>}
        </button>
      )}
    </div>
  )
}

/**
 * Barra pegada al teclado mientras se edita un campo que se guarda al salir (título, porqué, checklist, opciones): en un
 * texto largo el botón de guardar quedaría fuera de la pantalla y habría que cerrar el teclado para encontrarlo.
 * Cancelar vuelve el campo a como estaba antes de tocarlo; Guardar lo deja (al salir se guarda, como en escritorio).
 */
function BarraEdicion() {
  const [campo, setCampo] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null)
  // Sin conexión no se puede guardar: el botón lo dice apagado (y el aviso de arriba, que lo escrito no se guarda).
  const enLinea = useConexion()
  const original = useRef('')
  useEffect(() => {
    const entra = (e: FocusEvent) => {
      const el = e.target as HTMLElement
      if (!(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'search', 'url', ''].includes(el.type)))) return
      if (!el.closest('.hoja-movil .hoja__marco') || el.closest('.editor-md, .comentar-movil, .hoja-inferior__capa')) return
      original.current = el.value
      setCampo(el)
    }
    const sale = (e: FocusEvent) => {
      const siguiente = e.relatedTarget as HTMLElement | null
      if (siguiente?.closest('.barra-edicion')) return
      setCampo(null)
    }
    document.addEventListener('focusin', entra)
    document.addEventListener('focusout', sale)
    return () => {
      document.removeEventListener('focusin', entra)
      document.removeEventListener('focusout', sale)
    }
  }, [])
  // Al aparecer la barra, el campo se acomoda por encima de ella (el navegador lo trajo a la vista sin contarla).
  useEffect(() => {
    if (!campo) return
    const id = requestAnimationFrame(() => campo.scrollIntoView({ block: 'nearest' }))
    return () => cancelAnimationFrame(id)
  }, [campo])
  if (!campo) return null
  const cancelar = () => {
    // Se devuelve el valor de antes con el setter nativo (así React se entera) y se cierra como con Escape.
    const proto = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(campo, original.current)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
    campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    if (campo.isConnected) campo.blur()
    setCampo(null)
  }
  return (
    <div className="barra-edicion" role="toolbar" aria-label="Edición">
      <button type="button" className="boton boton--fantasma" onMouseDown={(e) => e.preventDefault()} onClick={cancelar}>
        Cancelar
      </button>
      <button
        type="button"
        className="boton boton--primario"
        disabled={!enLinea}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          // Los que se confirman con Enter (ítem nuevo de checklist, evidencia, título) y después, al salir, el resto.
          campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
          if (campo.isConnected) campo.blur()
          setCampo(null)
        }}
      >
        {enLinea ? 'Guardar' : 'Sin conexión'}
      </button>
    </div>
  )
}
