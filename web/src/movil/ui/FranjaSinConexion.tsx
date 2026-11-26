// La franja de "sin conexión" (plan del celular, 9.6): 32 px bajo la barra superior, "Sin conexión · viendo lo de hace
// 2 h". Entra bajando en 220 ms; al volver la señal dice "Conectado" 1,5 s y se va. Si hay tarjetas anotadas sin
// conexión, toda la franja abre la hoja de las que faltan subir.
import { ChevronRight, CloudOff, Wifi } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useConexion, usePwa } from '../../pwa/estado'
import { useBandeja } from '../../pwa/sinconexion/bandeja'
import { useMovil } from '../estado'

/** "recién", "hace 5 min", "hace 2 h", "ayer", "hace 3 días" (cortos: la franja tiene 32 px y comparte el ancho). */
export function haceCuanto(iso: string, ahora = Date.now()) {
  const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}

export function FranjaSinConexion() {
  const enLinea = useConexion()
  const desde = usePwa((s) => s.instantanea)
  const porSubir = useBandeja((s) => s.pendientes.length)
  const quieto = useReducedMotion()
  const [conectado, setConectado] = useState(false)
  const antes = useRef(enLinea)
  const [, setAhora] = useState(0)

  // Al volver la señal: "Conectado" un momento y se va.
  useEffect(() => {
    const venia = antes.current
    antes.current = enLinea
    if (!enLinea || venia) return
    setConectado(true)
    const t = setTimeout(() => setConectado(false), 1500)
    return () => clearTimeout(t)
  }, [enLinea])

  // "hace 5 min" se mantiene al día.
  useEffect(() => {
    if (enLinea || !desde) return
    const t = setInterval(() => setAhora(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [enLinea, desde])

  const visible = !enLinea || conectado
  const contenido = (
    <>
      {enLinea ? <Wifi size={15} aria-hidden /> : <CloudOff size={15} aria-hidden />}
      <span className="franja-conexion__texto">
        {enLinea ? 'Conectado' : `Sin conexión${desde ? ` · viendo lo de ${haceCuanto(desde)}` : ''}`}
      </span>
    </>
  )
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="franja"
          className={`franja-conexion${enLinea ? ' franja-conexion--ok' : ''}`}
          role="status"
          // Solo transform y opacidad (10.1): el lugar se hace de una vez y la franja baja desde abajo de la barra.
          initial={{ y: '-100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={quieto ? { duration: 0 } : { duration: 0.22, ease: [0.15, 1, 0.3, 1] }}
        >
          {/* Con tarjetas por subir, toda la franja (a lo ancho) abre la hoja: un botón de 22 px no se acierta con el pulgar. */}
          {!enLinea && porSubir > 0 ? (
            <button type="button" className="franja-conexion__dentro" onClick={() => useMovil.getState().abrir('pendientes')}>
              {contenido}
              <span className="franja-conexion__pendientes">
                {porSubir} por subir <ChevronRight size={14} aria-hidden />
              </span>
            </button>
          ) : (
            <div className="franja-conexion__dentro">{contenido}</div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
