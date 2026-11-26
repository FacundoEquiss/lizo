// «Claude quiere hacer esto:» (plan 12.4 y 14.4): lo delicado que un agente pidió hacer y espera que la persona permita o no. Es
// la única pieza que decide eso: la usan el hilo de la tarjeta (dentro de `EntradaTrabajo`) y la bandeja de la campana (las
// notificaciones de tipo `confirmacion` traen los botones ahí mismo, sin tener que ir a la tarjeta).
//   · «Permitir» y «No» valen para todo lo que se pide; con más de una acción, «Elegir» deja decidir una por una.
//   · Lo permitido se hace y lo negado vuelve al modelo como «La persona no permitió esta acción.»: el trabajo sigue.
//   · Los botones son botones de verdad con su nombre completo («Permitir: Archivar RC-12»); el foco no salta solo acá: la
//     región en vivo de la pastilla anuncia que hace falta permiso (14.9).
//   · Mientras se manda, los botones quedan apagados; si falla, se avisa y se puede volver a intentar.
import { Check, ShieldQuestionMark } from 'lucide-react'
import { useState } from 'react'
import type { TrabajoResumen } from '../../../../compartido/ia'
import { useIA } from '../../estado/ia'
import { Girando, Segmentado } from '../../ui/comunes'
import '../../estilos/ia-trabajo.css'

type Respuesta = 'si' | 'no'
const OPCIONES: { id: Respuesta; nombre: string }[] = [
  { id: 'si', nombre: 'Permitir' },
  { id: 'no', nombre: 'No' },
]

export function ConfirmarAcciones({ trabajo, compacto, alDecidir }: { trabajo: TrabajoResumen; compacto?: boolean; alDecidir?: () => void }) {
  const acciones = trabajo.porConfirmar ?? []
  const [eligiendo, setEligiendo] = useState(false)
  const [elegido, setElegido] = useState<Record<string, Respuesta>>({})
  const [mandando, setMandando] = useState(false)
  if (!acciones.length) return null
  const varias = acciones.length > 1
  const completo = acciones.every((a) => elegido[a.id])

  async function decidir(decisiones: { llamadaId: string; permitir: boolean }[]) {
    setMandando(true)
    // El store avisa si falla; si salió bien, el trabajo cambia de estado y esta pieza se va sola.
    const bien = await useIA.getState().confirmar(trabajo.id, decisiones)
    setMandando(false)
    if (bien) alDecidir?.()
  }
  const aTodas = (permitir: boolean) => decidir(acciones.map((a) => ({ llamadaId: a.id, permitir })))
  const nombre = varias ? `${acciones.length} acciones` : acciones[0]!.titulo

  return (
    <div className={`confirmar${compacto ? ' confirmar--compacto' : ''}`} role="group" aria-label={`${trabajo.agenteNombre} pide permiso`} aria-busy={mandando}>
      <p className="confirmar__titulo">
        <ShieldQuestionMark size={14} aria-hidden /> {trabajo.agenteNombre} quiere hacer esto:
      </p>
      <ul className="confirmar__lista">
        {acciones.map((a) => (
          <li key={a.id} className="confirmar__accion">
            <span className="confirmar__que">
              <b>{a.titulo}</b>
              {a.motivo && a.motivo !== a.titulo && <small>{a.motivo}</small>}
            </span>
            {eligiendo && (
              <Segmentado
                opciones={OPCIONES}
                valor={elegido[a.id] ?? ('' as 'si')}
                alCambiar={(v) => setElegido((e) => ({ ...e, [a.id]: v }))}
                etiqueta={`Qué hacer con: ${a.titulo}`}
                tam="chico"
                deshabilitado={mandando}
              />
            )}
          </li>
        ))}
      </ul>
      <div className="confirmar__botones">
        {eligiendo ? (
          <>
            <button
              type="button"
              className="boton boton--primario boton--chico"
              disabled={!completo || mandando}
              title={completo ? undefined : 'Elegí qué hacer con cada una'}
              onClick={() => decidir(acciones.map((a) => ({ llamadaId: a.id, permitir: elegido[a.id] === 'si' })))}
            >
              {mandando ? <Girando tam={13} /> : <Check size={14} aria-hidden />} Listo
            </button>
            <button type="button" className="boton boton--fantasma boton--chico" disabled={mandando} onClick={() => setEligiendo(false)}>
              Volver
            </button>
          </>
        ) : (
          <>
            <button type="button" className="boton boton--primario boton--chico" disabled={mandando} aria-label={`Permitir: ${nombre}`} onClick={() => aTodas(true)}>
              {mandando ? <Girando tam={13} /> : null} Permitir
            </button>
            <button type="button" className="boton boton--chico" disabled={mandando} aria-label={`No permitir: ${nombre}`} onClick={() => aTodas(false)}>
              No
            </button>
            {varias && (
              <button type="button" className="boton boton--fantasma boton--chico" disabled={mandando} onClick={() => setEligiendo(true)}>
                Elegir
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
