// El menú (plan del celular, 4.4; antes "Más", en la barra de abajo): reemplaza al pie de la barra lateral y a los botones
// de la derecha de la barra superior de escritorio. Se abre con el ⋮ de la cabecera, al lado del punto de conexión. No
// aparece "Atajos": son de teclado.
import { Activity, Archive, Download, FolderKanban, LogOut, Monitor, Moon, Palette, PlugZap, RefreshCw, Sparkles, Sun, UserRound, UsersRound, Vibrate } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { VERSION } from '../../../../compartido/constantes'
import { salir, useSesion } from '../../estado/sesion'
import { avisar } from '../../estado/avisos'
import { usePwa } from '../../pwa/estado'
import { borrarTodo } from '../../pwa/sinconexion/instantanea'
import { buscarActualizacion, versionInstalada } from '../../pwa/registro'
import { pedirInstalar } from '../../pwa/ui/HojaInstalar'
import { useTienda, type Tema } from '../../estado/tienda'
import { setVibracion, vibracionDisponible, vibracionEncendida, vibrar } from '../haptica'
import { useMovil } from '../estado'
import { DatosCuenta } from '../../ui/DatosCuenta'
import { PerfilEditable } from '../../ui/PerfilEditable'
import { MarcaSolicitudes } from '../../ui/MarcaSolicitudes'
import { FilaTactil } from '../ui/FilaTactil'
import { HojaInferior, useHoja } from '../ui/HojaInferior'

const TEMAS: { id: Tema; nombre: string; icono: typeof Sun }[] = [
  { id: 'claro', nombre: 'Claro', icono: Sun },
  { id: 'oscuro', nombre: 'Oscuro', icono: Moon },
  { id: 'sistema', nombre: 'Sistema', icono: Monitor },
]

export function HojaMas() {
  const abierta = useMovil((s) => s.hoja === 'mas')
  const cerrar = useMovil((s) => s.cerrar)
  return (
    <HojaInferior abierta={abierta} alCerrar={cerrar} titulo="Menú" className="hoja-mas">
      <ContenidoMas />
    </HojaInferior>
  )
}

function ContenidoMas() {
  const hoja = useHoja()
  const info = useTienda((s) => s.info)
  const tablero = useTienda((s) => s.tablero)
  const tema = useTienda((s) => s.tema)
  const setTema = useTienda((s) => s.setTema)
  const publico = useSesion((s) => s.publico)
  const esDueno = useSesion((s) => s.amigos)
  const [vibra, setVibra] = useState(vibracionEncendida)
  const [confirmarSalida, setConfirmarSalida] = useState(false)
  const [verPerfil, setVerPerfil] = useState(false)
  const instalada = usePwa((s) => s.instalada)
  const [version, setVersion] = useState<string | null>(null)
  const ir = (fn: () => void) => hoja?.cerrarYLuego(fn)
  useEffect(() => {
    versionInstalada().then(setVersion)
  }, [])

  return (
    <div className="hoja-mas__cuerpo">
      <FilaTactil
        icono={<FolderKanban size={20} />}
        texto="Proyectos y tableros"
        bajada={tablero ? `${tablero.proyecto.nombre} · ${tablero.tablero.nombre}` : undefined}
        flecha
        onClick={() => ir(() => useMovil.getState().abrir('tableros'))}
      />
      <FilaTactil icono={<Activity size={20} />} texto="Actividad" flecha onClick={() => ir(() => useTienda.setState({ panel: 'actividad' }))} />
      <FilaTactil icono={<Archive size={20} />} texto="Archivadas" flecha onClick={() => ir(() => useTienda.setState({ panel: 'archivadas' }))} />
      <FilaTactil
        icono={<Sparkles size={20} />}
        texto="IA"
        bajada="Claves, agentes, topes de gasto y gasto del mes"
        flecha
        onClick={() => ir(() => useMovil.getState().abrir('ia'))}
      />
      {esDueno && (
        <FilaTactil
          icono={<UsersRound size={20} />}
          texto="Amigos"
          bajada="Solicitudes, invitaciones por enlace y tope"
          detalle={<MarcaSolicitudes />}
          flecha
          onClick={() => ir(() => useMovil.getState().abrir('amigos'))}
        />
      )}
      <FilaTactil
        icono={<PlugZap size={20} />}
        texto="Conectar IA"
        detalle={<span className={`punto-estado${info ? ' punto-estado--ok' : ''}`} aria-label={info ? 'Conectada' : 'Sin datos'} />}
        flecha
        onClick={() => ir(() => useTienda.getState().setDialogo('conectar'))}
      />

      <div className="fila-tactil fila-tactil--56 hoja-mas__tema">
        <span className="fila-tactil__icono">
          <Palette size={20} />
        </span>
        <span className="fila-tactil__texto">
          <span className="fila-tactil__principal">Tema</span>
        </span>
        <div className="hoja-mas__temas" role="radiogroup" aria-label="Tema">
          {TEMAS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={tema === t.id}
              aria-label={t.nombre}
              className={`hoja-mas__opcion-tema${tema === t.id ? ' hoja-mas__opcion-tema--activa' : ''}`}
              onClick={() => setTema(t.id)}
            >
              {tema === t.id && (
                <motion.span layoutId="tema-movil" className="hoja-mas__fondo-tema" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />
              )}
              <t.icono size={18} />
            </button>
          ))}
        </div>
      </div>

      {vibracionDisponible() && (
        <button
          type="button"
          role="switch"
          aria-checked={vibra}
          className="fila-tactil fila-tactil--56"
          onClick={() => {
            setVibracion(!vibra)
            setVibra(!vibra)
            if (!vibra) vibrar('toque')
          }}
        >
          <span className="fila-tactil__icono">
            <Vibrate size={20} />
          </span>
          <span className="fila-tactil__texto">
            <span className="fila-tactil__principal">Vibración</span>
          </span>
          <span className={`interruptor${vibra ? ' interruptor--si' : ''}`} aria-hidden />
        </button>
      )}

      {!instalada && (
        <FilaTactil
          icono={<Download size={20} />}
          texto="Instalar Telar"
          bajada="Se abre como una app y anda sin conexión"
          flecha
          onClick={() => pedirInstalar(() => ir(() => useMovil.getState().abrir('instalar')))}
        />
      )}

      <FilaTactil icono={<UserRound size={20} />} texto="Mi perfil" bajada={publico ? 'Tu nombre, tu color y tu contraseña' : 'Tu nombre y tu color'} flecha onClick={() => setVerPerfil(!verPerfil)} />
      {verPerfil && (
        <div className="hoja-mas__perfil">
          <PerfilEditable />
          {publico && <DatosCuenta />}
        </div>
      )}

      {publico &&
        (confirmarSalida ? (
          <div className="hoja-mas__confirmar" role="alert">
            <p>¿Salir de Telar? Lo que está guardado en este teléfono para verlo sin conexión se borra.</p>
            <div className="hoja-mas__confirmar-botones">
              <button type="button" className="boton" onClick={() => setConfirmarSalida(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="boton boton--primario"
                onClick={async () => {
                  const r = await salir()
                  if (!r.ok) return avisar({ texto: r.error ?? 'No se pudo salir', tipo: 'error' })
                  // Lo guardado para leer sin conexión (y la bandeja) muere con la sesión.
                  await borrarTodo()
                  location.reload()
                }}
              >
                Salir
              </button>
            </div>
          </div>
        ) : (
          <FilaTactil icono={<LogOut size={20} />} texto="Salir" peligro onClick={() => setConfirmarSalida(true)} />
        ))}

      <div className="hoja-mas__pie">
        <span>
          Telar {VERSION}
          {version ? ` · ${version}` : ''}
        </span>
        <button type="button" className="boton boton--fantasma boton--chico" onClick={() => buscarActualizacion(true)}>
          <RefreshCw size={14} /> Buscar actualización
        </button>
      </div>
    </div>
  )
}
