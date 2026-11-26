// Agregar una tarjeta desde el pie de la lista (escritorio). El pie queda SIEMPRE a la vista: la lista se desplaza por
// dentro y el pie queda abajo (Kanban.tsx), así que con 60 tarjetas no hay que bajar hasta el final para agregar.
//
// Antes el compositor era un cuadro de texto con una ayuda que se cortaba («!alta #etiqueta …») y había que saber una
// sintaxis para ponerle tipo o prioridad. Ahora es un compositor entero: título (con foco), tipo, prioridad, etiquetas
// (con crear al vuelo) y el motivo, el porqué, que toda tarjeta de Telar tiene. Todo se manda en un solo pedido al mismo
// POST de siempre, que ya aceptaba estos campos.
//
//   · Enter agrega y deja el compositor abierto para cargar otra seguida (tipo, prioridad y etiquetas quedan para la
//     siguiente: se ven en las píldoras). Ctrl/⌘+Enter agrega y cierra. Esc cierra. Mayús+Enter pasa al motivo.
//   · Se abre en la propia lista, dentro de la pantalla: el pie crece hacia arriba y las tarjetas se desplazan por encima.
//   · Si no se pudo agregar, el título no se pierde: queda a la vista con «Reintentar».
//   · La sintaxis rápida (error: … !alta #cocina @yo) sigue andando y se ve entendida en las píldoras.
import { CornerDownLeft, Plus, RotateCw, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTienda } from '../../estado/tienda'
import { Girando, Kbd, TextoAuto } from '../../ui/comunes'
import { CURVA_SALE } from '../../util/movimiento'
import { datosDeAlta, entender, hayTexto, useBorrador, type Fallida } from './alta/borrador'
import { EtiquetasElegidas, PildoraEtiquetas, PildoraPrioridad, PildoraTipo } from './alta/Pildoras'

interface Props {
  listaId: string
  listaNombre: string
  abierto: boolean
  /** Cambia cada vez que se pide abrirlo (de nuevo): si ya estaba abierto, solo vuelve el foco al título. */
  pedido: number
  alAbrir: () => void
  alCerrar: () => void
  /** Pide que la lista se desplace al final (ahí aparece la tarjeta nueva). */
  traerFinal: () => void
  /** En el celular el alta es una hoja inferior: el pie solo avisa (y no abre nada en la lista). */
  alAgregar?: (listaId: string) => void
}

export function Compositor({ listaId, listaNombre, abierto, pedido, alAbrir, alCerrar, traerFinal, alAgregar }: Props) {
  const crear = useTienda((s) => s.crearTarjeta)
  const existentes = useTienda((s) => s.tablero?.etiquetas)
  const etiquetasProyecto = useMemo(() => existentes ?? [], [existentes])
  const { b, cambiar, alternarEtiqueta, agregarNueva, quitarNueva, siguiente, vaciar } = useBorrador()
  const [fallidas, setFallidas] = useState<Fallida[]>([])
  const [enviando, setEnviando] = useState(0)
  const refTitulo = useRef<HTMLTextAreaElement>(null)
  const refMotivo = useRef<HTMLTextAreaElement>(null)
  const refPanel = useRef<HTMLDivElement>(null)
  const refB = useRef(b)
  refB.current = b
  const contador = useRef(0)
  const e = useMemo(() => entender(b, etiquetasProyecto), [b, etiquetasProyecto])
  const puede = Boolean(e.titulo)

  useEffect(() => {
    if (abierto) requestAnimationFrame(() => refTitulo.current?.focus())
  }, [abierto, pedido])

  const cerrar = () => {
    // Lo escrito no se pierde: si hay texto, queda de borrador para cuando se vuelva a abrir.
    if (!hayTexto(refB.current)) vaciar()
    alCerrar()
  }

  // Tocar afuera cierra el compositor vacío. Recién al soltar (click) y no al apretar: cerrarlo al apretar corre la lista
  // justo cuando alguien empieza a arrastrar una tarjeta.
  useEffect(() => {
    if (!abierto) return
    // El clic que lo abrió todavía está en camino cuando se registra este oyente: ese no cuenta.
    const abrio = performance.now()
    const afuera = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null
      // Lo que se sacó de la pantalla con ese mismo clic (la opción «Crear etiqueta» del selector) ya no se puede ubicar.
      if (ev.timeStamp <= abrio || !t || !t.isConnected || refPanel.current?.contains(t)) return
      if (t.closest('.flotante, .hoja-inferior__capa, .lista__boton, .dialogo, .tarjeta-abierta')) return
      if (!hayTexto(refB.current)) cerrar()
    }
    document.addEventListener('click', afuera)
    return () => document.removeEventListener('click', afuera)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  /** Manda una tarjeta. Si falla, queda en `fallidas` con su título y sus datos, para reintentar. */
  const mandar = async (datos: Fallida['datos'], cerrarSiSale: boolean) => {
    setEnviando((n) => n + 1)
    requestAnimationFrame(traerFinal)
    const r = await crear(listaId, datos.titulo, datos.extra, 'abajo')
    setEnviando((n) => n - 1)
    if (!r) {
      setFallidas((f) => [...f, { id: ++contador.current, titulo: datos.titulo, datos }])
      refTitulo.current?.focus()
      return
    }
    requestAnimationFrame(traerFinal)
    if (cerrarSiSale) cerrar()
  }

  const agregar = (cerrarDespues: boolean) => {
    const datos = datosDeAlta(e, b)
    if (!datos) return
    siguiente()
    refTitulo.current?.focus()
    void mandar(datos, cerrarDespues)
  }

  const reintentar = (f: Fallida) => {
    setFallidas((x) => x.filter((y) => y.id !== f.id))
    void mandar(f.datos, false)
  }

  const teclasTitulo = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.nativeEvent.isComposing) return
    if (ev.key === 'Enter') {
      ev.preventDefault()
      if (ev.shiftKey) refMotivo.current?.focus()
      else agregar(ev.ctrlKey || ev.metaKey)
    } else if (ev.key === 'Escape') {
      ev.preventDefault()
      cerrar()
    }
  }
  const teclasMotivo = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.nativeEvent.isComposing) return
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault()
      agregar(true)
    } else if (ev.key === 'Escape') {
      ev.preventDefault()
      cerrar()
    }
  }

  const alTitulo = () => setTimeout(() => refTitulo.current?.focus(), 30)

  if (alAgregar)
    return (
      <div className="lista__pie">
        <BotonAgregar alClick={() => alAgregar(listaId)} />
      </div>
    )

  return (
    <div className="lista__pie">
      <AnimatePresence initial={false} mode="popLayout">
        {abierto ? (
          <motion.div
            key="abierto"
            ref={refPanel}
            className="alta"
            role="group"
            aria-label={`Nueva tarjeta en ${listaNombre}`}
            style={{ transformOrigin: 'left bottom' }}
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12, ease: CURVA_SALE } }}
            transition={{ type: 'spring', stiffness: 600, damping: 38 }}
          >
            <div className="alta__campos">
              <TextoAuto
                ref={refTitulo}
                className="alta__titulo"
                value={b.titulo}
                minFilas={2}
                placeholder="Título de la tarjeta…"
                aria-label="Título de la tarjeta"
                enterKeyHint="send"
                onChange={(ev) => cambiar({ titulo: ev.target.value })}
                onKeyDown={teclasTitulo}
              />
              <TextoAuto
                ref={refMotivo}
                className="alta__motivo"
                value={b.motivo}
                minFilas={1}
                placeholder="Motivo, el porqué (opcional)"
                aria-label="Motivo de la tarjeta, el porqué (opcional)"
                onChange={(ev) => cambiar({ motivo: ev.target.value })}
                onKeyDown={teclasMotivo}
              />
            </div>
            <div className="alta__pildoras">
              <PildoraTipo valor={e.tipo} alElegir={(tipo) => cambiar({ tipo })} alCerrar={alTitulo} />
              <PildoraPrioridad valor={e.prioridad} alElegir={(prioridad) => cambiar({ prioridad })} alCerrar={alTitulo} />
              <PildoraEtiquetas
                elegidas={b.etiquetas}
                nuevas={b.nuevas}
                alAlternar={alternarEtiqueta}
                alQuitarNueva={quitarNueva}
                alCrear={(n) => agregarNueva(n, etiquetasProyecto)}
                alCerrar={alTitulo}
              />
            </div>
            <EtiquetasElegidas
              etiquetas={e.etiquetas}
              alQuitar={(x) => (x.nueva ? quitarNueva(x.nombre) : alternarEtiqueta(x.clave))}
            />
            {fallidas.length > 0 && (
              <ul className="alta__fallidas" role="alert">
                {fallidas.map((f) => (
                  <li key={f.id} className="alta__fallida">
                    <span className="alta__fallida-texto">
                      <b>No se pudo agregar</b>
                      <span title={f.titulo}>«{f.titulo}»</span>
                    </span>
                    <button type="button" className="boton boton--chico" onClick={() => reintentar(f)}>
                      <RotateCw size={13} /> Reintentar
                    </button>
                    <button
                      type="button"
                      className="boton-icono boton-icono--chico"
                      onClick={() => setFallidas((x) => x.filter((y) => y.id !== f.id))}
                      aria-label="Descartar"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="alta__pie">
              <button type="button" className="boton boton--chico boton--fantasma" onClick={cerrar} aria-keyshortcuts="Escape">
                Cerrar
              </button>
              <button
                type="button"
                className="boton boton--primario boton--chico alta__agregar"
                disabled={!puede}
                aria-busy={enviando > 0}
                onClick={() => agregar(false)}
              >
                {enviando > 0 ? <Girando tam={13} /> : null}
                Agregar <CornerDownLeft size={13} aria-hidden />
              </button>
            </div>
            <p className="alta__ayuda">
              <span>
                <Kbd atajo="Enter" suave /> agrega y sigue
              </span>
              <span>
                <Kbd atajo="$mod+Enter" suave /> agrega y cierra
              </span>
            </p>
          </motion.div>
        ) : (
          <BotonAgregar alClick={alAbrir} key="cerrado" animado />
        )}
      </AnimatePresence>
    </div>
  )
}

/** El botón de siempre de la lista: «Agregar tarjeta». */
function BotonAgregar({ alClick, animado }: { alClick: () => void; animado?: boolean }) {
  const contenido = (
    <>
      <Plus size={16} aria-hidden />
      <span>Agregar tarjeta</span>
      <span className="lista__agregar-tecla">N</span>
    </>
  )
  if (!animado)
    return (
      <button type="button" className="lista__agregar" onClick={alClick}>
        {contenido}
      </button>
    )
  return (
    <motion.button
      type="button"
      className="lista__agregar"
      onClick={alClick}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
    >
      {contenido}
    </motion.button>
  )
}
