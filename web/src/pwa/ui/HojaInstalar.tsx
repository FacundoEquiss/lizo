// Instalar Telar en el teléfono (plan del celular, 9.7): la invitación de una sola vez y la hoja con los pasos de iOS
// (que no tiene el cartel del sistema). En Android y en Chrome de escritorio, "Instalar" abre el cartel del sistema.
import { Copy, Share, SquarePlus, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { avisar } from '../../estado/avisos'
import { useTienda } from '../../estado/tienda'
import { useMovil } from '../../movil/estado'
import { HojaInferior } from '../../movil/ui/HojaInferior'
import { usePwa } from '../estado'
import { instalar, navegador, noAhora, tocaInvitar } from '../instalar'

/** Abre el cartel del sistema si existe; si no (iOS u otro navegador), la hoja con los pasos. */
export async function pedirInstalar(abrirPasos: () => void) {
  if (await instalar()) return
  abrirPasos()
}

/** La hoja de "Menú → Instalar Telar" y de la invitación, en la app del teléfono. */
export function HojaInstalar() {
  const abierta = useMovil((s) => s.hoja === 'instalar')
  const cerrar = useMovil((s) => s.cerrar)
  return <PasosInstalar abierta={abierta} alCerrar={cerrar} />
}

export default function PasosInstalarSuelto({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  return <PasosInstalar abierta={abierta} alCerrar={alCerrar} />
}

export function PasosInstalar({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  const cual = navegador()
  const pasos =
    cual === 'ios-dentro-de-app'
      ? null
      : cual === 'safari' || cual === 'ios-otro'
        ? [
            {
              icono: <Share size={22} />,
              texto:
                cual === 'safari' ? (
                  <>
                    Tocá <b>Compartir</b> (el cuadrado con la flecha hacia arriba, en la barra de Safari).
                  </>
                ) : (
                  <>Abrí el menú de compartir del navegador.</>
                ),
            },
            {
              icono: <SquarePlus size={22} />,
              texto: (
                <>
                  Elegí <b>Agregar a inicio</b>.
                </>
              ),
            },
            {
              icono: <Plus size={22} />,
              texto: (
                <>
                  Tocá <b>Agregar</b>.
                </>
              ),
            },
          ]
        : [
            { icono: <Share size={22} />, texto: <>Abrí el menú del navegador (los tres puntos).</> },
            {
              icono: <SquarePlus size={22} />,
              texto: (
                <>
                  Elegí <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>.
                </>
              ),
            },
          ]
  return (
    <HojaInferior abierta={abierta} alCerrar={alCerrar} titulo="Instalar Telar" className="hoja-instalar">
      <div className="hoja-instalar__cuerpo">
        <div className="hoja-instalar__marca">
          <img src="/pwa/icono-192.png" alt="" width={56} height={56} />
          <p>Se abre como una app, desde el ícono, y anda sin conexión.</p>
        </div>
        {pasos ? (
          <ol className="hoja-instalar__pasos">
            {pasos.map((p, i) => (
              <li key={i}>
                <span className="hoja-instalar__numero">{i + 1}</span>
                <span className="hoja-instalar__icono">{p.icono}</span>
                <span>{p.texto}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="hoja-instalar__otra-app">
            <p>
              Estás en el navegador de otra app. Abrí esta página en <b>Safari</b> y seguí los pasos desde ahí.
            </p>
            <button
              type="button"
              className="boton boton--primario"
              onClick={() => {
                navigator.clipboard?.writeText(location.origin + location.pathname)
                avisar({ texto: 'Link copiado', tipo: 'ok', duracion: 1600 })
              }}
            >
              <Copy size={16} /> Copiar link
            </button>
          </div>
        )}
        {(cual === 'safari' || cual === 'ios-otro' || cual === 'ios-dentro-de-app') && (
          <p className="hoja-instalar__nota">La app instalada te va a pedir entrar de nuevo: en iPhone no comparte la sesión con Safari.</p>
        )}
      </div>
    </HojaInferior>
  )
}

/** La invitación de una sola vez: tarjeta de 72 px sobre la barra inferior. */
export function InvitacionInstalar() {
  const hoja = useMovil((s) => s.hoja)
  const tarjeta = useTienda((s) => !!s.claveAbierta)
  usePwa((s) => s.instalable)
  const [visible, setVisible] = useState(false)
  const [escribiendo, setEscribiendo] = useState(false)
  useEffect(() => {
    const revisar = () => setEscribiendo(document.documentElement.hasAttribute('data-teclado'))
    const obs = new MutationObserver(revisar)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-teclado'] })
    return () => obs.disconnect()
  }, [])
  const toca = tocaInvitar()
  useEffect(() => {
    if (!toca) return setVisible(false)
    const t = setTimeout(() => setVisible(true), 1500)
    return () => clearTimeout(t)
  }, [toca])
  const mostrar = visible && toca && !hoja && !tarjeta && !escribiendo
  const ios = navegador() !== 'android'
  return (
    <AnimatePresence>
      {mostrar && (
        <motion.div
          className="invitacion-instalar"
          role="dialog"
          aria-label="Instalar Telar"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        >
          <img src="/pwa/icono-192.png" alt="" width={40} height={40} />
          <p>Instalá Telar: se abre como una app y anda sin conexión.</p>
          <div className="invitacion-instalar__botones">
            <button
              type="button"
              className="boton boton--fantasma"
              onClick={() => {
                noAhora()
                setVisible(false)
              }}
            >
              Ahora no
            </button>
            <button
              type="button"
              className="boton boton--primario"
              onClick={() => {
                noAhora()
                setVisible(false)
                pedirInstalar(() => useMovil.getState().abrir('instalar'))
              }}
            >
              {ios ? 'Cómo se instala' : 'Instalar'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
