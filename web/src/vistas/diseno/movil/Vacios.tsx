// Estados vacíos de Diseño en el teléfono (el molde de la v0.2: ícono de 28 px, título, ayuda y, si hay, una acción). Lo
// que en el teléfono no se hace (armar marcos, páginas) lo dice sin vueltas y dice dónde se hace.
import { PanelsTopLeft } from 'lucide-react'
import { avisar, avisarError } from '../../../estado/avisos'
import { apiDiseno } from '../api'
import { useDiseno } from '../estado'
import { EstadoVacio } from '../ui'

export function VacioDeLienzo() {
  const pagina = useDiseno((s) => s.pagina)
  const prefijo = useDiseno((s) => s.prefijo)
  const pedido = useDiseno((s) => s.resumen?.sincronizacion.pedidoEn)
  if (!pagina) return null
  if (pagina.origen === 'importado')
    return (
      <div className="dzm-estado dzm-estado--encima">
        <EstadoVacio
          icono={<PanelsTopLeft size={28} />}
          titulo="Falta sincronizar las pantallas"
          ayuda="Los colores, los íconos y los textos ya están. Las pantallas llegan cuando Claude abre la interfaz del proyecto en un navegador."
        >
          {prefijo && (
            <button
              type="button"
              className="boton"
              disabled={!!pedido}
              onClick={() =>
                void apiDiseno
                  .config(prefijo, { pedir: true })
                  .then(() => {
                    avisar({ texto: 'Pedido: la próxima vez que Claude sincronice, trae las pantallas.', tipo: 'ok' })
                    return useDiseno.getState().recargarResumen()
                  })
                  .catch(avisarError)
              }
            >
              {pedido ? 'Sincronización pedida' : 'Pedir sincronización'}
            </button>
          )}
        </EstadoVacio>
      </div>
    )
  return (
    <div className="dzm-estado dzm-estado--encima">
      <EstadoVacio
        icono={<PanelsTopLeft size={28} />}
        titulo="Esta página está vacía"
        ayuda="Los marcos se arman en la computadora, o se los pedís a Claude. Acá aparecen solos, en vivo."
      />
    </div>
  )
}

export function VacioDeSistema() {
  return (
    <div className="dzm-estado">
      <EstadoVacio
        icono={<PanelsTopLeft size={28} />}
        titulo="Todavía no hay nada acá"
        ayuda="Cuando se importe el sistema de diseño (o Claude defina colores y letras), aparece en esta página."
      />
    </div>
  )
}
