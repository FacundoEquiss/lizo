// «Solicitudes» (Configuración → Amigos, arriba de todo): las personas que crearon su cuenta desde Entrar, sin enlace, y esperan que el dueño las
// apruebe. Hasta entonces no entran a nada. Por cada una: nombre, mail, desde cuándo y dos botones grandes, «Aprobar» y «Rechazar».
//   · Aprobar la pasa a amigo (cuenta contra el tope de amigos: si ya se llegó, lo dice ahí mismo y no aprueba) y le arma su Telar vacío.
//   · Rechazar pide una confirmación suave («no entra y su mail queda ocupado unos días»); una rechazada se puede «Reconsiderar».
//   · «Borrar solicitudes viejas» (más de 30 días) borra de verdad: son cuentas que nunca entraron, sin nada adentro. Pide confirmar.
// La usan el diálogo de Configuración (PC) y la hoja «Amigos» del teléfono (SeccionAmigos). Anda igual con el dedo: botones de 44 px.
import { Check, ClockAlert, Trash2, UserCheck, UserX } from 'lucide-react'
import { useState } from 'react'
import { api, type Solicitud, type Solicitudes } from '../../../estado/api'
import { avisar, avisarError } from '../../../estado/avisos'
import { actualizarSolicitudes } from '../../../estado/sesion'
import { Girando } from '../../../ui/comunes'
import { EstadoVacio } from '../../../ui/EstadoVacio'
import { fechaCorta, hace } from '../../../util/fechas'

const DIA = 86_400_000

/** Las solicitudes de más de `diasViejas` días (sin responder o rechazadas): las que borra «Borrar solicitudes viejas». */
export function solicitudesViejas(s: Solicitudes, ahora = Date.now()): number {
  const corte = ahora - s.diasViejas * DIA
  return s.pendientes.filter((x) => new Date(x.desde).getTime() < corte).length + s.rechazadas.filter((x) => new Date(x.decididaEn ?? x.desde).getTime() < corte).length
}

export function PanelSolicitudes({ solicitudes, alCambiar }: { solicitudes: Solicitudes; alCambiar: () => Promise<void> }) {
  const [borrando, setBorrando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const viejas = solicitudesViejas(solicitudes)
  const hay = solicitudes.pendientes.length + solicitudes.rechazadas.length > 0

  async function borrarViejas() {
    setBorrando(true)
    try {
      const { borradas } = await api.borrarSolicitudesViejas()
      avisar({ texto: borradas === 1 ? 'Borré 1 solicitud vieja.' : `Borré ${borradas} solicitudes viejas.`, tipo: 'ok', duracion: 3000 })
      setConfirmando(false)
      await alCambiar()
      void actualizarSolicitudes()
    } catch (e) {
      avisarError(e)
    } finally {
      setBorrando(false)
    }
  }

  return (
    <>
      {solicitudes.pendientes.length === 0 ? (
        <EstadoVacio chico icono={Check} titulo="No hay solicitudes esperando" ayuda="Cuando alguien cree su cuenta desde Entrar, aparece acá y te llega un aviso en la campana." />
      ) : (
        <ul className="amigos-lista" aria-label="Solicitudes que esperan tu respuesta">
          {solicitudes.pendientes.map((s) => (
            <FilaSolicitud key={s.id} solicitud={s} alCambiar={alCambiar} />
          ))}
        </ul>
      )}

      {solicitudes.rechazadas.length > 0 && (
        <details className="amigos-rechazadas">
          <summary>
            Rechazadas ({solicitudes.rechazadas.length})
          </summary>
          <ul className="amigos-lista" aria-label="Solicitudes rechazadas">
            {solicitudes.rechazadas.map((s) => (
              <FilaRechazada key={s.id} solicitud={s} alCambiar={alCambiar} />
            ))}
          </ul>
        </details>
      )}

      {hay && (
        <div className="amigos-limpiar">
          {!confirmando ? (
            <button type="button" className="boton boton--chico boton--fantasma" onClick={() => setConfirmando(true)} disabled={viejas === 0}>
              <Trash2 size={14} aria-hidden /> Borrar solicitudes viejas
            </button>
          ) : (
            <div className="amigos-confirmar" role="alert">
              <p>
                Se {viejas === 1 ? 'borra' : 'borran'} de verdad {viejas === 1 ? '1 solicitud' : `${viejas} solicitudes`} de más de {solicitudes.diasViejas} días (las que
                nadie respondió y las rechazadas). Son cuentas que nunca entraron y no tienen nada adentro, así que no se puede deshacer.
              </p>
              <div className="amigos-botones">
                <button type="button" className="boton boton--chico" onClick={() => setConfirmando(false)} disabled={borrando}>
                  Cancelar
                </button>
                <button type="button" className="boton boton--chico boton--primario" onClick={borrarViejas} disabled={borrando}>
                  {borrando ? <Girando tam={13} /> : 'Borrar'}
                </button>
              </div>
            </div>
          )}
          {viejas === 0 && !confirmando && <span className="amigos-nota">No hay solicitudes de más de {solicitudes.diasViejas} días.</span>}
        </div>
      )}
    </>
  )
}

function FilaSolicitud({ solicitud: s, alCambiar }: { solicitud: Solicitud; alCambiar: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState<'aprobar' | 'rechazar' | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState('')

  async function aprobar() {
    setError('')
    setOcupado('aprobar')
    try {
      await api.aprobarSolicitud(s.id)
      avisar({ texto: `${s.nombre} ya puede entrar con su mail y su contraseña.`, tipo: 'ok', duracion: 3600 })
      await alCambiar()
      void actualizarSolicitudes()
    } catch (e) {
      // El tope de amigos, sobre todo: se dice ahí mismo, junto a la solicitud (no se aprueba y sigue esperando).
      setError(e instanceof Error ? e.message : 'No se pudo aprobar.')
      setOcupado(null)
    }
  }
  async function rechazar() {
    setError('')
    setOcupado('rechazar')
    try {
      await api.rechazarSolicitud(s.id)
      avisar({ texto: `Rechazaste a ${s.nombre}. No puede entrar.`, tipo: 'ok', duracion: 3200 })
      await alCambiar()
      void actualizarSolicitudes()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo rechazar.')
      setOcupado(null)
    }
  }

  return (
    <li className="amigos-fila amigos-fila--solicitud">
      <span className="amigos-fila__texto">
        <span className="amigos-fila__titulo">
          <b>{s.nombre || 'Sin nombre'}</b>
          <small className="mono">{s.email ?? 'sin mail'}</small>
        </span>
        <span className="amigos-fila__detalle">Pidió su cuenta {hace(s.desde)} · {fechaCorta(s.desde)}</span>
      </span>
      <span className="amigos-pildora amigos-pildora--espera">
        <ClockAlert size={12} aria-hidden /> Espera
      </span>
      <div className="amigos-fila__decidir">
        <button type="button" className="boton boton--primario amigos-decidir" onClick={aprobar} disabled={ocupado !== null} aria-label={`Aprobar a ${s.nombre}`}>
          {ocupado === 'aprobar' ? <Girando tam={14} /> : <UserCheck size={16} aria-hidden />} Aprobar
        </button>
        <button type="button" className="boton amigos-decidir" onClick={() => setConfirmando(!confirmando)} disabled={ocupado !== null} aria-expanded={confirmando} aria-label={`Rechazar a ${s.nombre}`}>
          <UserX size={16} aria-hidden /> Rechazar
        </button>
      </div>
      {confirmando && (
        <div className="amigos-confirmar" role="alert">
          <p>
            Si rechazás a {s.nombre}, no puede entrar y su mail queda ocupado unos días (para que no vuelva a pedir en el acto). Podés reconsiderarlo desde
            «Rechazadas».
          </p>
          <div className="amigos-botones">
            <button type="button" className="boton boton--chico" onClick={() => setConfirmando(false)} disabled={ocupado !== null}>
              Cancelar
            </button>
            <button type="button" className="boton boton--chico boton--primario" onClick={rechazar} disabled={ocupado !== null}>
              {ocupado === 'rechazar' ? <Girando tam={13} /> : `Rechazar a ${s.nombre}`}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="amigos-error amigos-fila__error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

function FilaRechazada({ solicitud: s, alCambiar }: { solicitud: Solicitud; alCambiar: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false)
  async function reconsiderar() {
    setOcupado(true)
    try {
      await api.reconsiderarSolicitud(s.id)
      avisar({ texto: `${s.nombre} vuelve a esperar tu respuesta.`, tipo: 'ok', duracion: 3000 })
      await alCambiar()
      void actualizarSolicitudes()
    } catch (e) {
      avisarError(e)
      setOcupado(false)
    }
  }
  return (
    <li className="amigos-fila amigos-fila--quieta">
      <span className="amigos-fila__texto">
        <span className="amigos-fila__titulo">
          <b>{s.nombre || 'Sin nombre'}</b>
          <small className="mono">{s.email ?? 'sin mail'}</small>
        </span>
        <span className="amigos-fila__detalle">
          Rechazada {hace(s.decididaEn ?? s.desde)}
          {s.liberaEn ? ` · su mail queda ocupado hasta el ${fechaCorta(s.liberaEn)}` : ''}
        </span>
      </span>
      <span className="amigos-pildora amigos-pildora--suspendida">Rechazada</span>
      <button type="button" className="boton boton--chico" onClick={reconsiderar} disabled={ocupado} aria-label={`Reconsiderar a ${s.nombre}`}>
        {ocupado ? <Girando tam={13} /> : 'Reconsiderar'}
      </button>
    </li>
  )
}
