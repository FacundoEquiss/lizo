// Aviso de la herramienta (5.1): arriba al centro, no recibe clics y no mueve nada. Dice qué hace la herramienta
// activa; al cambiar de herramienta solo cambia el texto (fundido cruzado). A los 4 s baja a 60 % de opacidad.
import { Frame, Spline, Square, SquareKanban, StickyNote, Type } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { usePreferencias } from '../../../estado/preferencias'
import { useTienda, type Herramienta } from '../../../estado/tienda'
import { esTactil } from '../../../movil/detectar'
import { useLienzo } from '../estado'

export type ClaveAviso = Herramienta | 'conector-origen'

/** Textos de escritorio. El celular los cambia por props ("Tocá…"). */
export const TEXTOS_AVISO: Partial<Record<ClaveAviso, string>> = {
  nota: 'Hacé clic para dejar la nota, o arrastrá para darle tamaño',
  texto: 'Hacé clic y escribí, o arrastrá para fijar el ancho',
  forma: 'Hacé clic o arrastrá para dibujar la forma',
  marco: 'Arrastrá para dibujar el marco',
  tarjeta: 'Hacé clic donde va la tarjeta nueva',
  conector: 'Hacé clic en el objeto de origen',
  'conector-origen': 'Ahora el destino, o un lugar vacío para crear algo ahí',
}

/** Con el dedo no hay clic: se toca. */
const TEXTOS_TACTIL: Partial<Record<ClaveAviso, string>> = {
  nota: 'Tocá donde va la nota, o arrastrá para darle tamaño',
  texto: 'Tocá donde va el texto, o arrastrá para fijar el ancho',
  forma: 'Tocá o arrastrá para dibujar la forma',
  tarjeta: 'Tocá donde va la tarjeta nueva',
  conector: 'Tocá el objeto de origen',
}

const ICONOS: Partial<Record<Herramienta, typeof Type>> = {
  nota: StickyNote,
  texto: Type,
  forma: Square,
  marco: Frame,
  tarjeta: SquareKanban,
  conector: Spline,
}

export function AvisoHerramienta({ textos, posicion = 'arriba' }: { textos?: Partial<Record<ClaveAviso, string>>; posicion?: 'arriba' | 'abajo' }) {
  const herramienta = useTienda((s) => s.herramienta)
  const conOrigen = useLienzo((s) => !!s.origenConexion)
  const activo = usePreferencias((s) => s.avisoHerramientas)
  const clave: ClaveAviso = herramienta === 'conector' && conOrigen ? 'conector-origen' : herramienta
  const texto = { ...TEXTOS_AVISO, ...(esTactil() ? TEXTOS_TACTIL : {}), ...textos }[clave] ?? null
  const Icono = ICONOS[herramienta]
  const [tenue, setTenue] = useState(false)
  useEffect(() => {
    setTenue(false)
    if (!texto) return
    const t = setTimeout(() => setTenue(true), 4000)
    return () => clearTimeout(t)
  }, [texto])
  return (
    <div className={`aviso-herramienta-lugar aviso-herramienta-lugar--${posicion}`} role="status" aria-live="polite">
      <AnimatePresence>
        {texto && activo && (
          <motion.div
            layout
            className="aviso-herramienta"
            initial={{ opacity: 0, y: posicion === 'arriba' ? -6 : 6 }}
            animate={{ opacity: tenue ? 0.6 : 1, y: 0, transition: { duration: tenue ? 0.4 : 0.16, ease: [0.15, 1, 0.3, 1] } }}
            exit={{ opacity: 0, y: posicion === 'arriba' ? -6 : 6, transition: { duration: 0.1 } }}
            transition={{ layout: { type: 'spring', stiffness: 500, damping: 40 } }}
          >
            {Icono && <Icono size={14} strokeWidth={2.2} aria-hidden />}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={texto} className="aviso-herramienta__texto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                {texto}
              </motion.span>
            </AnimatePresence>
            <kbd className="aviso-herramienta__tecla">Esc</kbd>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
