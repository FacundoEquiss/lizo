// Cambiar un texto de un marco propio desde el teléfono (lo único del diseño que entra cómodo en 6 pulgadas). El texto
// en el lugar de la PC (escribir adentro del marco) acá sería escribir en letra de 4 px: se escribe en una hoja, con
// letra de 16, y el cambio se ve en el marco al guardar. Viaja como la operación `texto` (nunca HTML) y se deshace.
import { useEffect, useRef, useState } from 'react'
import { avisar } from '../../../estado/avisos'
import { deshacer } from '../../../estado/deshacer'
import { HojaInferior } from '../../../movil/ui/HojaInferior'
import { useConexion } from '../../../pwa/estado'
import { TextoAuto } from '../../../ui/comunes'
import { useDiseno } from '../estado'
import { useDisenoMovil } from './estado'
import { useHojaDe, useUltimo } from './Hojas'
import { capaDelVisor } from './Visor'

const limpio = (t: string) => t.replace(/ /g, ' ')

export function HojaTexto() {
  const h = useHojaDe('texto')
  const ultimo = useUltimo(h)
  const enLinea = useConexion()
  const campo = useRef<HTMLTextAreaElement>(null)
  const [valor, setValor] = useState('')
  const [original, setOriginal] = useState('')
  const [nombre, setNombre] = useState('Texto')

  useEffect(() => {
    if (!h) return
    const el = capaDelVisor(h.capa)
    const t = limpio(el?.textContent ?? '')
    setValor(t)
    setOriginal(t)
    setNombre(el?.getAttribute('data-nombre') || 'el texto')
  }, [h?.marco, h?.capa])

  const cerrar = () => useDisenoMovil.getState().set({ hoja: null, resaltada: null })
  const guardar = async () => {
    if (!ultimo) return
    const { marco, capa } = ultimo
    const texto = valor
    cerrar()
    if (texto === original) return
    if (!texto.trim()) return avisar({ texto: 'Un texto no puede quedar vacío: si sobra, se saca en la computadora.' })
    // Se ve al instante en el marco; el servidor lo guarda y el marco se vuelve a dibujar con lo guardado.
    const el = capaDelVisor(capa)
    if (el) el.textContent = texto
    const r = await useDiseno.getState().editar(marco, [{ op: 'texto', capa, texto }], { etiqueta: 'cambiar el texto', enDom: false })
    if (r) avisar({ texto: 'Texto cambiado', tipo: 'ok', accion: { etiqueta: 'Deshacer', fn: () => void deshacer() } })
  }

  return (
    <HojaInferior
      abierta={!!h}
      alCerrar={cerrar}
      titulo={`Cambiar ${nombre === 'el texto' ? nombre : `«${nombre}»`}`}
      className="dzm-hoja dzm-hoja--texto"
      enfocar={campo}
      pie={
        <>
          <button type="button" className="boton dzm-boton-grande" onMouseDown={(e) => e.preventDefault()} onClick={cerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className="boton boton--primario dzm-boton-grande"
            disabled={!enLinea || valor === original}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void guardar()}
          >
            {enLinea ? 'Guardar' : 'Sin conexión'}
          </button>
        </>
      }
    >
      <div className="dzm-texto">
        <TextoAuto
          ref={campo}
          className="dzm-texto__campo"
          value={valor}
          minFilas={2}
          aria-label="Texto nuevo"
          onChange={(e) => setValor(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        <p className="dzm-nota">Cambia solo las palabras: la letra, el color y el tamaño quedan como están.</p>
      </div>
    </HojaInferior>
  )
}
