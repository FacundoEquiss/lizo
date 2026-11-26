// El aviso de la herramienta en el teléfono ("Tocá donde va la nota"). El de escritorio, angosto, quedaba en tres
// renglones con un ícono diminuto y tapaba justo el lienzo que había que tocar. Este va en la franja de los botones de
// arriba del lienzo (los de la izquierda se apartan mientras tanto; el de centrar queda), así no tapa nada del lienzo:
// ícono legible dentro de un círculo, texto corto (dos renglones como mucho) y todo centrado. No recibe toques.
import { Frame, Spline, Square, SquareKanban, StickyNote, Type, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { usePreferencias } from '../../estado/preferencias'
import { useTienda, type Herramienta } from '../../estado/tienda'
import { useLienzo } from '../../vistas/lienzo/estado'

type Clave = Herramienta | 'conector-origen'

/** Cortos a propósito: entran en uno o dos renglones en un teléfono de 360 px. */
const TEXTOS: Partial<Record<Clave, string>> = {
  nota: 'Tocá donde va la nota',
  texto: 'Tocá donde va el texto',
  forma: 'Tocá donde va la forma',
  marco: 'Tocá donde va el marco',
  tarjeta: 'Tocá donde va la tarjeta',
  conector: 'Tocá el objeto de origen',
  'conector-origen': 'Ahora tocá el destino',
}

const ICONOS: Partial<Record<Herramienta, LucideIcon>> = {
  nota: StickyNote,
  texto: Type,
  forma: Square,
  marco: Frame,
  tarjeta: SquareKanban,
  conector: Spline,
}

export function AvisoLienzo() {
  const herramienta = useTienda((s) => s.herramienta)
  const conOrigen = useLienzo((s) => !!s.origenConexion)
  const activo = usePreferencias((s) => s.avisoHerramientas)
  const clave: Clave = herramienta === 'conector' && conOrigen ? 'conector-origen' : herramienta
  const texto = activo ? TEXTOS[clave] : undefined
  const Icono = ICONOS[herramienta]
  return (
    <div className="aviso-lienzo" role="status" aria-live="polite">
      <AnimatePresence>
        {texto && Icono && (
          <motion.div
            key="aviso"
            className="aviso-lienzo__pastilla"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: [0.15, 1, 0.3, 1] } }}
            exit={{ opacity: 0, y: -6, scale: 0.96, transition: { duration: 0.12 } }}
          >
            <span className="aviso-lienzo__icono" aria-hidden>
              <Icono size={18} strokeWidth={2.2} />
            </span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={texto}
                className="aviso-lienzo__texto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                {texto}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
