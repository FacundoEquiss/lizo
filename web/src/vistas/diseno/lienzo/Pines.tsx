// Comentar (C): la ventanita para escribir el comentario en el punto donde se hizo clic. Ctrl/⌘ + Enter publica.
import { motion } from 'motion/react'
import { useState } from 'react'
import { TextoAuto } from '../../../ui/comunes'

export function ComposerComentario({ x, y, alPublicar, alCerrar }: { x: number; y: number; alPublicar: (texto: string) => void; alCerrar: () => void }) {
  const [texto, setTexto] = useState('')
  return (
    <motion.div
      className="dz-composer"
      style={{ left: x + 14, top: y - 10 }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      onClick={(e) => e.stopPropagation()}
    >
      <TextoAuto
        autoFocus
        minFilas={2}
        className="campo-texto"
        placeholder="Escribí un comentario…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') alCerrar()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && texto.trim()) alPublicar(texto.trim())
        }}
      />
      <div className="dz-composer__pie">
        <button className="boton boton--chico boton--fantasma" onClick={alCerrar}>
          Cancelar
        </button>
        <button className="boton boton--chico boton--primario" disabled={!texto.trim()} onClick={() => alPublicar(texto.trim())}>
          Comentar
        </button>
      </div>
    </motion.div>
  )
}
