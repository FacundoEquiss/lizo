// "Hay una versión nueva" (plan del celular, 9.5). Pastilla fija, que no se cierra sola: la app no recarga sola si ya se
// está usando, porque puede haber algo a medio escribir. La "×" la esconde hasta la próxima vez que se abra la app.
// Sirve igual en la computadora (la PWA también se instala ahí): se dibuja fuera de las dos apps.
import { RefreshCw, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { usePwa } from '../estado'
import { actualizar } from '../registro'

export function AvisoActualizar() {
  const estado = usePwa((s) => s.actualizacion)
  const escondida = usePwa((s) => s.actualizacionEscondida)
  return (
    <AnimatePresence>
      {estado && !escondida && (
        <motion.div
          className="aviso-actualizar"
          role="status"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12, transition: { duration: 0.16 } }}
          transition={{ duration: 0.22, ease: [0.15, 1, 0.3, 1] }}
        >
          <RefreshCw size={17} className={estado === 'actualizando' ? 'aviso-actualizar__girando' : undefined} aria-hidden />
          <span className="aviso-actualizar__texto">{estado === 'actualizando' ? 'Actualizando…' : 'Hay una versión nueva'}</span>
          {estado !== 'actualizando' && (
            <button type="button" className="boton boton--primario aviso-actualizar__boton" onClick={estado === 'recargar' ? () => location.reload() : actualizar}>
              {estado === 'recargar' ? 'Recargar' : 'Actualizar'}
            </button>
          )}
          {estado !== 'actualizando' && (
            <button
              type="button"
              className="boton-icono boton-icono--chico"
              onClick={() => usePwa.setState({ actualizacionEscondida: true })}
              aria-label="Esconder hasta la próxima vez"
            >
              <X size={15} />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
