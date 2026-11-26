// Lo que el teléfono le suma al lienzo de escritorio (contrato InterfazLienzo + capa, ver vistas/lienzo/tipos.ts). Se
// monta adentro del lienzo, así usa sus acciones; se baja junto con él (trozo aparte), nunca con el arranque.
//   · Buscar en el lienzo: hoja en vez del panel flotante (la lupa de arriba sigue siendo la misma).
//   · El aviso de la herramienta, en la franja de los botones de arriba (no tapa el lienzo que hay que tocar).
//   · Centrar: arriba a la derecha, encuadra todo lo que hay.
//   · Escribir con el teclado: lo que se escribe queda a la vista (y React Flow no lo desmonta).
import { AvisoLienzo } from './AvisoLienzo'
import { BotonCentrar } from './BotonCentrar'
import { BuscarLienzo } from './BuscarLienzo'
import { EdicionVisible } from './EdicionVisible'

export default function CapaLienzoMovil() {
  return (
    <>
      <AvisoLienzo />
      <BotonCentrar />
      <EdicionVisible />
      <BuscarLienzo />
    </>
  )
}
