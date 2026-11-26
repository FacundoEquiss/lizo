// La marca con el número de solicitudes de cuenta que esperan la aprobación del dueño: en Configuración → Amigos, en el botón Configuración de
// la barra lateral y en el menú del celular (⋮ y la fila «Amigos»). Solo la sesión del dueño tiene número (`useSesion.solicitudes`; para
// todos los demás es 0 y no se dibuja nada). La campana suma su propia notificación («Pablo pidió una cuenta»).
import { useSesion } from '../estado/sesion'
import '../estilos/config-amigos.css'

export const textoSolicitudes = (n: number) => (n === 1 ? '1 solicitud espera tu respuesta' : `${n} solicitudes esperan tu respuesta`)

/** El número solo (hasta «9+»), para ponerlo sobre un ícono o al lado de un texto. */
export function MarcaSolicitudes({ className = '', pegada = false }: { className?: string; pegada?: boolean }) {
  const n = useSesion((s) => (s.amigos ? s.solicitudes : 0))
  if (n <= 0) return null
  return (
    <span className={`marca-solicitudes${pegada ? ' marca-solicitudes--pegada' : ''}${className ? ` ${className}` : ''}`} role="img" aria-label={textoSolicitudes(n)}>
      {n > 9 ? '9+' : n}
    </span>
  )
}
