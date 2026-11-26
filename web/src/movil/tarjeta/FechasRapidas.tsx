// Botones rápidos de vencimiento para la tarjeta abierta (plan del celular, 6.4): Hoy, Mañana, El viernes, En una semana y
// Sin fecha, de 44 px, arriba del calendario de siempre. Se guardan al tocar (como el resto de los selectores).
import { useTienda } from '../../estado/tienda'
import { aInputFecha, desdeInputs } from '../../util/fechas'

function enDias(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return desdeInputs(aInputFecha(d.toISOString()))
}

function elViernes() {
  const hoy = new Date().getDay() // 0 domingo … 5 viernes
  const faltan = (5 - hoy + 7) % 7 || 7
  return enDias(faltan)
}

export function FechasRapidas({ alElegir }: { alElegir: () => void }) {
  const detalle = useTienda((s) => s.detalle)
  if (!detalle) return null
  const poner = (vence: string | null) => {
    alElegir()
    useTienda.getState().actualizarTarjeta(detalle.id, vence ? { vence, conHora: false } : { vence: null, inicio: null, conHora: false })
  }
  const opciones: [string, () => string | null][] = [
    ['Hoy', () => enDias(0)],
    ['Mañana', () => enDias(1)],
    ['El viernes', elViernes],
    ['En una semana', () => enDias(7)],
  ]
  return (
    <div className="fechas-rapidas" role="group" aria-label="Vencimiento rápido">
      {opciones.map(([nombre, calcular]) => (
        <button key={nombre} type="button" className="pildora fechas-rapidas__opcion" onClick={() => poner(calcular())}>
          {nombre}
        </button>
      ))}
      {detalle.fechas.vence && (
        <button type="button" className="pildora fechas-rapidas__opcion fechas-rapidas__opcion--quitar" onClick={() => poner(null)}>
          Sin fecha
        </button>
      )}
    </div>
  )
}
