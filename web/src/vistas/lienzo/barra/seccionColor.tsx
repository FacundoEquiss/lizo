// Color del objeto: notas (--n), marcos (--e-s), relleno de formas (--e).
import { leerForma, leerMarco, leerNota } from '../../../../../compartido/lienzo'
import type { ElementoLienzo } from '../../../../../compartido/tipos'
import { cambiarDatos, useSeleccionLienzo } from '../seleccion'
import { MenuBarra, Muestra, type TamBarra } from './piezas'
import { SelectorColor } from './SelectorColor'

/** Color del objeto: notas (--n), marcos (--e-s), relleno de formas (--e). */
export function SeccionColor({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const els = (elementos ?? sel.nodos).filter((e) => !e.bloqueado)
  const tipo = els[0]?.tipo
  if (!els.length || !els.every((e) => e.tipo === tipo) || !['nota', 'marco', 'forma'].includes(tipo!)) return null
  const variable = tipo === 'nota' ? '--n' : tipo === 'marco' ? '--e-s' : '--e'
  const clave = tipo === 'forma' ? 'relleno' : 'color'
  const actual =
    tipo === 'nota' ? leerNota(els[0]!.datos).color : tipo === 'marco' ? leerMarco(els[0]!.datos).color : leerForma(els[0]!.datos).relleno
  const etiqueta = tipo === 'forma' ? 'Relleno' : 'Color'
  return (
    <MenuBarra etiqueta={etiqueta} tam={tam} disparador={<Muestra color={actual} variable={variable} />}>
      {(cerrar) => (
        <SelectorColor
          valor={actual}
          variable={variable}
          conNinguno={tipo === 'forma' ? 'Sin relleno' : undefined}
          tam={tam}
          alElegir={(c) => {
            cambiarDatos(els, { [clave]: c }, tipo === 'forma' ? 'cambiar relleno' : 'cambiar color')
            cerrar()
          }}
        />
      )}
    </MenuBarra>
  )
}
