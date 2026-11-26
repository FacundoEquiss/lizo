// Configuración → Amigos (solo la sesión del dueño): las SOLICITUDES de cuenta (quien crea su cuenta desde Entrar espera acá tu aprobación),
// invitar por enlace (quien entra con un enlace queda aprobado al instante), ver las invitaciones y los amigos con cuenta, suspender o
// reactivar y poner el tope de cuentas. La usan el diálogo de Configuración (PC) y la hoja «Amigos» del menú del teléfono
// (movil/amigos/HojaAmigos.tsx), igual que IA y Notificaciones.
//   · Una sola lectura (`GET /api/amigos`); lo que se hace después vuelve a leer. Estados: cargando, error con «Reintentar»,
//     «Todavía no invitaste a nadie» y «solo del dueño» (otra cuenta que llegue acá).
//   · El enlace de una invitación se muestra UNA vez, al crearla (PanelInvitar): la lista nunca tiene tokens.
//   · «Restablecer contraseña» (sin correo): genera un enlace de un solo uso, 24 horas, para el amigo que olvidó la suya. El dueño nunca ve ni
//     elige esa contraseña. Un pendiente se ve en la fila y se cancela (amigos/PanelRestablecer.tsx).
//   · Los miedos del dueño, en una línea cada uno, arriba: es lo primero que quiere saber antes de darle acceso a alguien.
import { CircleAlert, KeyRound, Link2, ShieldCheck, UserPlus, UsersRound } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, ErrorApi, type Amigo, type EstadoAmigos, type Invitacion } from '../../estado/api'
import { avisar, avisarError } from '../../estado/avisos'
import { Girando } from '../../ui/comunes'
import { EstadoVacio } from '../../ui/EstadoVacio'
import { fechaCorta, hace } from '../../util/fechas'
import '../../estilos/config-amigos.css'
import { PanelInvitar } from './amigos/PanelInvitar'
import { PanelRestablecer } from './amigos/PanelRestablecer'
import { PanelSolicitudes } from './amigos/PanelSolicitudes'
import { actualizarSolicitudes } from '../../estado/sesion'
import { Fila, Grupo } from './piezas'

type Carga = 'cargando' | 'lista' | 'error' | 'no_dueno'

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
/** «0 de 5 usos», «1 de 1 uso». */
const usosDe = (usos: number, max: number) => `${usos} de ${max} ${max === 1 ? 'uso' : 'usos'}`

// Los miedos del dueño, una línea cada uno.
const TRANQUILIDAD = [
  'Nadie entra sin tu aprobación: una cuenta pendiente no puede nada (ni la web, ni la IA conectada, ni los archivos).',
  'Esperan como mucho 30 solicitudes a la vez, y hay un límite de pedidos por conexión: si se llena, te aviso en la campana.',
  'Si rechazás a alguien, no entra y su mail queda ocupado unos días. Podés reconsiderarlo, y borrar las solicitudes viejas.',
  'Cada amigo ve solo lo suyo: nada de tus proyectos ni de los de otros.',
  'Cada enlace de invitación sirve las veces que elijas y vence solo. Quien entra con uno queda aprobado al instante.',
  'Podés revocar un enlace o suspender a un amigo cuando quieras. Sus datos quedan.',
  'Hay un tope de cuentas, y cada cuenta tiene su tope de espacio (200 MB).',
  'La IA de cada amigo usa su propia clave: nada tuyo se comparte.',
]

const ESTADO_INVITACION: Record<Invitacion['estado'], string> = { pendiente: 'Pendiente', usada: 'Usada', vencida: 'Vencida', revocada: 'Revocada' }

export function SeccionAmigos() {
  const [datos, setDatos] = useState<EstadoAmigos | null>(null)
  const [carga, setCarga] = useState<Carga>('cargando')
  const [invitando, setInvitando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.amigos())
      setCarga('lista')
    } catch (e) {
      // Si ya había algo a la vista, se queda (lo último antes que un cartel).
      setCarga((c) => (c === 'lista' ? c : e instanceof ErrorApi && (e.estado === 403 || e.estado === 404) ? 'no_dueno' : 'error'))
    }
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])
  // Al ver la lista, la marca del menú se pone al día con lo que hay de verdad.
  const esperando = datos?.solicitudes.pendientes.length
  useEffect(() => {
    if (esperando !== undefined) void actualizarSolicitudes()
  }, [esperando])

  if (!datos && carga === 'cargando')
    return (
      <div className="amigos-esqueleto" role="status" aria-busy="true" aria-label="Cargando los amigos">
        {[0, 1, 2].map((i) => (
          <span key={i} />
        ))}
      </div>
    )
  if (!datos)
    return carga === 'no_dueno' ? (
      <EstadoVacio icono={ShieldCheck} titulo="Esto es solo del dueño de Telar" ayuda="Invitar a alguien se hace con la cuenta del dueño." />
    ) : (
      <EstadoVacio
        icono={CircleAlert}
        titulo="No pude cargar a tus amigos"
        ayuda="Revisá la conexión y probá de nuevo."
        accion={
          <button
            type="button"
            className="boton boton--chico"
            onClick={() => {
              setCarga('cargando')
              void cargar()
            }}
          >
            Reintentar
          </button>
        }
      />
    )

  const sinNadie = datos.invitaciones.length === 0 && datos.amigos.length === 0
  return (
    <div className="amigos-seccion">
      <Grupo
        titulo={`Solicitudes${datos.solicitudes.pendientes.length ? ` (${datos.solicitudes.pendientes.length})` : ''}`}
        bajada="Quien crea su cuenta desde Entrar espera acá tu respuesta. Hasta que la apruebes no entra a nada."
      >
        <PanelSolicitudes solicitudes={datos.solicitudes} alCambiar={cargar} />
      </Grupo>

      <Grupo
        titulo="Invitar"
        bajada="Creá un enlace y pasáselo a quien quieras. Quien lo abre queda aprobado al instante, sin pasar por Solicitudes: se crea su cuenta y entra a su Telar vacío."
      >
        {invitando ? (
          <PanelInvitar
            alCrear={() => void cargar()}
            alCerrar={() => {
              setInvitando(false)
              void cargar()
            }}
          />
        ) : (
          <div className="amigos-botones">
            <button type="button" className="boton boton--primario" onClick={() => setInvitando(true)}>
              <UserPlus size={15} aria-hidden /> Invitar a un amigo
            </button>
            <span className="amigos-nota">
              {datos.pendientes} de {datos.maxPendientes} invitaciones pendientes
            </span>
          </div>
        )}
        <ul className="amigos-tranquilidad" aria-label="Lo que tenés que saber">
          {TRANQUILIDAD.map((t) => (
            <li key={t}>
              <ShieldCheck size={14} aria-hidden /> {t}
            </li>
          ))}
        </ul>
      </Grupo>

      <Grupo titulo="Invitaciones" bajada="El enlace no se vuelve a mostrar: acá solo ves en qué estado está cada una.">
        {sinNadie ? (
          <EstadoVacio chico icono={Link2} titulo="Todavía no invitaste a nadie" ayuda="Tocá «Invitar a un amigo» y pasale el enlace." />
        ) : datos.invitaciones.length === 0 ? (
          <p className="amigos-nota">No hay invitaciones: los amigos de abajo entraron con el código de siempre.</p>
        ) : (
          <ul className="amigos-lista">
            {datos.invitaciones.map((i) => (
              <FilaInvitacion key={i.id} invitacion={i} alCambiar={cargar} />
            ))}
          </ul>
        )}
      </Grupo>

      <Grupo titulo="Amigos con cuenta" bajada="Lo que ves de cada uno es solo lo que hace falta para decidir a quién dejás entrar: nada de lo que tienen adentro.">
        {datos.amigos.length === 0 ? (
          <EstadoVacio chico icono={UsersRound} titulo="Todavía no se sumó nadie" ayuda="Cuando alguien abra tu enlace o apruebes su solicitud, aparece acá." />
        ) : (
          <ul className="amigos-lista">
            {datos.amigos.map((a) => (
              <FilaAmigo key={a.id} amigo={a} alCambiar={cargar} />
            ))}
          </ul>
        )}
      </Grupo>

      <Grupo titulo="Tope">
        <TopeAmigos datos={datos} alCambiar={cargar} />
      </Grupo>
    </div>
  )
}

function FilaInvitacion({ invitacion: i, alCambiar }: { invitacion: Invitacion; alCambiar: () => Promise<void> }) {
  const [revocando, setRevocando] = useState(false)
  async function revocar() {
    setRevocando(true)
    try {
      await api.revocarInvitacion(i.id)
      avisar({ texto: 'Invitación revocada: el enlace ya no sirve.', tipo: 'ok', duracion: 3000 })
      await alCambiar()
    } catch (e) {
      avisarError(e)
      setRevocando(false)
    }
  }
  const detalle =
    i.estado === 'pendiente'
      ? `${usosDe(i.usos, i.usosMax)} · vence ${hace(i.venceEn)}`
      : i.estado === 'revocada'
        ? `Revocada ${hace(i.revocadaEn ?? i.creadaEn)} · ${usosDe(i.usos, i.usosMax)}`
        : i.estado === 'vencida'
          ? `Venció ${hace(i.venceEn)} · ${usosDe(i.usos, i.usosMax)}`
          : `${usosDe(i.usos, i.usosMax)} · última vez ${hace(i.ultimoUsoEn ?? i.creadaEn)}`
  return (
    <li className={`amigos-fila${i.estado !== 'pendiente' ? ' amigos-fila--quieta' : ''}`}>
      <span className="amigos-fila__texto">
        <span className="amigos-fila__titulo">
          <b>{i.nota || 'Sin nota'}</b>
          <small>creada {fechaCorta(i.creadaEn)}</small>
        </span>
        <span className="amigos-fila__detalle">{detalle}</span>
      </span>
      <span className={`amigos-pildora amigos-pildora--${i.estado}`}>{ESTADO_INVITACION[i.estado]}</span>
      {i.estado === 'pendiente' && (
        <button type="button" className="boton boton--chico boton--fantasma" onClick={revocar} disabled={revocando} aria-label={`Revocar la invitación ${i.nota || 'sin nota'}`}>
          {revocando ? <Girando tam={13} /> : 'Revocar'}
        </button>
      )}
    </li>
  )
}

const CAMINO_RESTABLECIDA: Record<'enlace' | 'codigo', string> = { enlace: 'con tu enlace', codigo: 'con un código de recuperación' }

function FilaAmigo({ amigo: a, alCambiar }: { amigo: Amigo; alCambiar: () => Promise<void> }) {
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [restableciendo, setRestableciendo] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const suspendida = a.estado === 'suspendida'
  async function cambiar(estado: 'activa' | 'suspendida') {
    setOcupado(true)
    try {
      await api.estadoAmigo(a.id, estado)
      avisar({ texto: estado === 'suspendida' ? `${a.nombre} quedó suspendido: ya no puede entrar.` : `${a.nombre} puede entrar de nuevo.`, tipo: 'ok', duracion: 3200 })
      setConfirmando(false)
      await alCambiar()
    } catch (e) {
      avisarError(e)
    } finally {
      setOcupado(false)
    }
  }
  async function cancelarEnlace() {
    setCancelando(true)
    try {
      await api.cancelarRestablecimiento(a.id)
      avisar({ texto: 'Enlace cancelado: ya no sirve.', tipo: 'ok', duracion: 3000 })
      await alCambiar()
    } catch (e) {
      avisarError(e)
    } finally {
      setCancelando(false)
    }
  }
  return (
    <li className={`amigos-fila amigos-fila--amigo${suspendida ? ' amigos-fila--quieta' : ''}`}>
      <span className="amigos-fila__texto">
        <span className="amigos-fila__titulo">
          <b>{a.nombre || 'Sin nombre'}</b>
          <small className="mono">{a.email ?? 'sin mail'}</small>
        </span>
        <span className="amigos-fila__detalle">
          Desde {fechaCorta(a.desde)} · {a.ultimoIngreso ? `último ingreso ${hace(a.ultimoIngreso)}` : 'todavía no volvió a entrar'}
        </span>
        <span className="amigos-fila__detalle">
          {plural(a.proyectos, 'proyecto', 'proyectos')} · {mb(a.archivosBytes)} de 200 MB
          {a.porInvitacion ? (a.invitacion ? ` · vino con «${a.invitacion}»` : ' · vino por invitación') : a.porSolicitud ? ' · pidió su cuenta y la aprobaste' : ' · entró con el código'}
        </span>
        {a.restablecida && (
          <span className="amigos-fila__detalle">
            Contraseña restablecida {hace(a.restablecida.en)} ({CAMINO_RESTABLECIDA[a.restablecida.por]})
          </span>
        )}
      </span>
      <span className={`amigos-pildora amigos-pildora--${suspendida ? 'suspendida' : 'activa'}`}>{suspendida ? 'Suspendido' : 'Activo'}</span>
      {suspendida ? (
        <button type="button" className="boton boton--chico" onClick={() => cambiar('activa')} disabled={ocupado} aria-label={`Reactivar a ${a.nombre}`}>
          {ocupado ? <Girando tam={13} /> : 'Reactivar'}
        </button>
      ) : (
        <button type="button" className="boton boton--chico boton--fantasma" onClick={() => setConfirmando(!confirmando)} aria-expanded={confirmando} aria-label={`Suspender a ${a.nombre}`}>
          Suspender
        </button>
      )}
      {/* Restablecer la contraseña: para el amigo que la olvidó y no tiene sus códigos. El enlace lo ve solo el dueño, una vez. */}
      <div className="amigos-fila__pendiente amigos-fila__acciones">
        {a.restablecimiento ? (
          <>
            <KeyRound size={14} aria-hidden />
            <span>
              {a.restablecimiento.vencido ? 'Enlace para restablecer vencido' : 'Enlace para restablecer pendiente'} · {a.restablecimiento.vencido ? 'venció' : 'vence'}{' '}
              {hace(a.restablecimiento.venceEn)}
            </span>
            <button type="button" className="boton boton--chico boton--fantasma" onClick={cancelarEnlace} disabled={cancelando} aria-label={`Cancelar el enlace para restablecer la contraseña de ${a.nombre}`}>
              {cancelando ? <Girando tam={13} /> : 'Cancelar enlace'}
            </button>
          </>
        ) : null}
        {!restableciendo && (
          <button
            type="button"
            className="boton boton--chico boton--fantasma"
            onClick={() => setRestableciendo(true)}
            aria-expanded={restableciendo}
            aria-label={`Restablecer la contraseña de ${a.nombre}`}
          >
            <KeyRound size={14} aria-hidden /> Restablecer contraseña
          </button>
        )}
      </div>
      {restableciendo && (
        <PanelRestablecer
          amigo={a}
          alCambiar={() => void alCambiar()}
          alCerrar={() => {
            setRestableciendo(false)
            void alCambiar()
          }}
        />
      )}
      {confirmando && (
        <div className="amigos-confirmar" role="alert">
          <p>
            Si suspendés a {a.nombre}, no puede entrar a Telar (tampoco con sus IA conectadas) hasta que lo reactives. Sus proyectos y sus datos quedan
            guardados: no se borra nada.
          </p>
          <div className="amigos-botones">
            <button type="button" className="boton boton--chico" onClick={() => setConfirmando(false)} disabled={ocupado}>
              Cancelar
            </button>
            <button type="button" className="boton boton--chico boton--primario" onClick={() => cambiar('suspendida')} disabled={ocupado}>
              {ocupado ? <Girando tam={13} /> : `Suspender a ${a.nombre}`}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function TopeAmigos({ datos, alCambiar }: { datos: EstadoAmigos; alCambiar: () => Promise<void> }) {
  const [valor, setValor] = useState(String(datos.topeAmigos))
  const [guardando, setGuardando] = useState(false)
  useEffect(() => setValor(String(datos.topeAmigos)), [datos.topeAmigos])
  const n = Number(valor)
  const valido = Number.isInteger(n) && n >= datos.topeMin && n <= datos.topeMax
  const cambio = valido && n !== datos.topeAmigos
  async function guardar() {
    if (!cambio || guardando) return
    setGuardando(true)
    try {
      await api.topeAmigos(n)
      avisar({ texto: `Tope de amigos: ${n}.`, tipo: 'ok', duracion: 2600 })
      await alCambiar()
    } catch (e) {
      avisarError(e)
    } finally {
      setGuardando(false)
    }
  }
  const lleno = datos.amigos.length >= datos.topeAmigos
  return (
    <Fila
      nombre="Cuentas de amigos"
      descripcion={
        <>
          Hay {datos.amigos.length} de {datos.topeAmigos}. {lleno ? 'Llegaste al tope: nadie más puede entrar hasta que lo subas.' : 'Al llegar, nadie más puede entrar y te aviso en la campana.'}{' '}
          Podés poner de {datos.topeMin} a {datos.topeMax}.
        </>
      }
    >
      <span className="amigos-tope">
        <input
          className="campo amigos-tope__campo"
          type="number"
          inputMode="numeric"
          min={datos.topeMin}
          max={datos.topeMax}
          step={1}
          value={valor}
          aria-label="Tope de cuentas de amigos"
          aria-invalid={!valido}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void guardar()}
        />
        <button type="button" className="boton boton--chico" onClick={guardar} disabled={!cambio || guardando}>
          {guardando ? <Girando tam={13} /> : 'Guardar'}
        </button>
      </span>
    </Fila>
  )
}
