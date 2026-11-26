import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, Info, Sparkles, X } from 'lucide-react'
import { useAvisos } from '../estado/avisos'

export function Avisos() {
  const { avisos, quitar } = useAvisos()
  return (
    <div className="avisos" aria-live="polite">
      <AnimatePresence initial={false}>
        {avisos.map((a) => (
          <motion.div
            key={a.id}
            layout
            className={`aviso aviso--${a.tipo}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 36 }}
          >
            <span className="aviso__icono">
              {a.tipo === 'ia' ? (
                <Sparkles size={15} />
              ) : a.tipo === 'error' ? (
                <CircleAlert size={15} />
              ) : a.tipo === 'ok' ? (
                <CircleCheck size={15} />
              ) : (
                <Info size={15} />
              )}
            </span>
            <span className="aviso__texto">{a.texto}</span>
            {a.accion && (
              <button
                className="aviso__accion"
                onClick={() => {
                  a.accion!.fn()
                  quitar(a.id)
                }}
              >
                {a.accion.etiqueta}
              </button>
            )}
            <button className="aviso__cerrar" onClick={() => quitar(a.id)} aria-label="Cerrar aviso">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
