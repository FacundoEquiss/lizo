// En el teléfono, todos los desplegables de escritorio (menús, selectores de la tarjeta, del Kanban y del lienzo) se
// muestran como hoja inferior con filas de 48 px (plan del celular, 6.4 y N5). AppMovil la pasa por PresentacionFlotante.
import { useLayoutEffect, useRef, useState } from 'react'
import type { PropsPresentacion } from '../../ui/Desplegable'
import { FechasRapidas } from '../tarjeta/FechasRapidas'
import { HojaInferior } from './HojaInferior'

export function HojaDesplegable({ abierta, alCerrar, clase, children }: PropsPresentacion) {
  const ref = useRef<HTMLDivElement>(null)
  const [fechas, setFechas] = useState(false)
  // El selector de fechas de la tarjeta suma botones rápidos arriba del calendario (Hoy, Mañana, El viernes…).
  useLayoutEffect(() => {
    if (abierta) setFechas(!!ref.current?.querySelector('.fechas'))
  }, [abierta, children])
  return (
    <HojaInferior abierta={abierta} alCerrar={alCerrar} etiqueta="Opciones" className={`hoja-desplegable${clase ? ` hoja-desplegable--${clase}` : ''}`}>
      <div ref={ref} className="hoja-desplegable__cuerpo">
        {fechas && <FechasRapidas alElegir={alCerrar} />}
        {children}
      </div>
    </HojaInferior>
  )
}
