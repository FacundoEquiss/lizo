// Lo que el teléfono no necesita para mostrar el tablero (plan del celular, 10.1): la tarjeta a pantalla completa, las
// hojas (buscar, tableros, menú, filtros, compositor, pendientes, crear, instalar) y los paneles y diálogos de escritorio.
// AppMovil los baja aparte: apenas se pinta el tablero, en un momento libre, o en cuanto se pide alguno (lo que llegue
// primero). Así el arranque interpreta menos JavaScript y lo que crezca en la tarjeta (el texto enriquecido de escritorio,
// por ejemplo) no lo atrasa. El service worker los guarda igual que al resto: sin red también están.
import { ConectarIA } from '../vistas/ConectarIA'
import { DialogoProyecto } from '../vistas/DialogoProyecto'
import { PanelActividad } from '../vistas/PanelActividad'
import { HojaInstalar, InvitacionInstalar } from '../pwa/ui/HojaInstalar'
import { ComposerRapido } from './kanban/ComposerRapido'
import { HojaFiltros } from './kanban/HojaFiltros'
import { HojaPendientes } from './kanban/HojaPendientes'
import { HojaCrear } from './lienzo/HojaCrear'
import { HojaAmigos } from './amigos/HojaAmigos'
import { HojaIA } from './ia/HojaIA'
import { HojaNotificaciones } from './ia/HojaNotificaciones'
import { Buscar } from './navegacion/Buscar'
import { HojaMas } from './navegacion/HojaMas'
import { SelectorTablero } from './navegacion/SelectorTablero'
import { HojaTarjeta } from './tarjeta/HojaTarjeta'

export default function Diferidas({ tarjetaAlArrancar }: { tarjetaAlArrancar: boolean }) {
  return (
    <>
      <SelectorTablero />
      <Buscar />
      <HojaMas />
      <HojaCrear />
      <ComposerRapido />
      <HojaFiltros />
      <HojaPendientes />
      <HojaNotificaciones />
      <HojaIA />
      <HojaAmigos />
      <HojaInstalar />
      <InvitacionInstalar />
      <PanelActividad />
      <ConectarIA />
      <DialogoProyecto />
      <HojaTarjeta abiertaAlArrancar={tarjetaAlArrancar} />
    </>
  )
}
