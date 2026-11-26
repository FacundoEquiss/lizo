// Configuración → Cuenta: mi perfil (nombre y color: el nombre es el de la cuenta), el mail, cambiar la contraseña (cuentas
// de Telar), lo que usa la cuenta de sus topes y cerrar sesión (online). Cada cuenta tiene su base propia (docs/cuentas.md).
import { LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type MiCuenta } from '../../estado/api'
import { avisar } from '../../estado/avisos'
import { salir, useSesion } from '../../estado/sesion'
import { borrarTodo } from '../../pwa/sinconexion/instantanea'
import { CambiarClave } from '../../ui/CambiarClave'
import { CodigosCuenta } from '../../ui/CodigosCuenta'
import { PerfilEditable } from '../../ui/PerfilEditable'
import { Fila, Grupo } from './piezas'

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`
const numero = (n: number) => n.toLocaleString('es-AR')

export function SeccionCuenta() {
  const publico = useSesion((s) => s.publico)
  const [cuenta, setCuenta] = useState<MiCuenta | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [saliendo, setSaliendo] = useState(false)
  useEffect(() => {
    if (publico) api.cuenta().then(setCuenta, () => setCuenta(null))
  }, [publico])
  async function cerrar() {
    setSaliendo(true)
    const r = await salir()
    if (!r.ok) {
      setSaliendo(false)
      return avisar({ texto: r.error ?? 'No se pudo cerrar la sesión.', tipo: 'error' })
    }
    // Lo guardado para leer sin conexión muere con la sesión (como en el celular).
    await borrarTodo()
    location.reload()
  }
  const topes = cuenta?.uso.topes
  return (
    <>
      <Grupo titulo="Mi perfil" bajada="Así te ven en las tarjetas, los comentarios y la actividad. Tu nombre es el de tu cuenta.">
        <PerfilEditable />
      </Grupo>
      {publico ? (
        <>
          <Grupo titulo="Cuenta">
            <Fila
              nombre="Mail"
              descripcion={
                cuenta?.tipo === 'juego'
                  ? 'Entrás con la cuenta del juego (Mi Restaurante). La contraseña se cambia en el juego.'
                  : 'Con este mail entrás a Telar. Tus proyectos son solo tuyos: ninguna otra cuenta los ve.'
              }
            >
              <span className="mono">{cuenta?.email ?? (cuenta ? '—' : '…')}</span>
            </Fila>
            {cuenta?.tipo === 'telar' && (
              <Fila nombre="Contraseña" descripcion="Te pide la actual. Al cambiarla se cierran tus otras sesiones." apilada>
                <CambiarClave email={cuenta.email} />
              </Fila>
            )}
            {cuenta?.tipo === 'telar' && (
              <Fila
                nombre="Códigos de recuperación"
                descripcion="Si te olvidás la contraseña, uno de estos códigos te deja entrar y poner una nueva (Telar no tiene mail para mandarte un enlace). Cada uno sirve una sola vez y vale como tu contraseña."
                apilada
              >
                <CodigosCuenta email={cuenta.email} />
              </Fila>
            )}
            {cuenta && topes && (
              <Fila
                nombre="Lo que usás"
                descripcion="Cada cuenta tiene un tope para cuidar el espacio de la base. Si llegás a uno, Telar te avisa."
                apilada
              >
                <span className="cuenta-uso">
                  {numero(cuenta.uso.proyectos)} de {topes.proyectos} proyectos · {mb(cuenta.uso.archivosBytes)} de {topes.archivosMb} MB de
                  archivos · {numero(cuenta.uso.objetosLienzo)} de {numero(topes.objetosLienzo)} objetos de lienzo
                </span>
              </Fila>
            )}
          </Grupo>
          <Grupo titulo="Sesión">
            <Fila
              nombre="Cerrar sesión"
              descripcion={confirmar ? 'Lo que está guardado en este aparato para verlo sin conexión se borra. Volvés a entrar con tu mail y tu contraseña.' : 'Salís de Telar en este aparato.'}
            >
              {confirmar ? (
                <span className="perfil__botones">
                  <button type="button" className="boton boton--chico" onClick={() => setConfirmar(false)} disabled={saliendo}>
                    Cancelar
                  </button>
                  <button type="button" className="boton boton--chico boton--primario" onClick={cerrar} disabled={saliendo}>
                    <LogOut size={14} /> Salir
                  </button>
                </span>
              ) : (
                <button type="button" className="boton boton--chico" onClick={() => setConfirmar(true)}>
                  <LogOut size={14} /> Cerrar sesión
                </button>
              )}
            </Fila>
          </Grupo>
        </>
      ) : (
        <Grupo titulo="Sesión">
          <Fila nombre="En esta computadora" descripcion="Telar local no pide cuenta. Las cuentas existen en la versión publicada (telarapp.vercel.app).">
            <span />
          </Fila>
        </Grupo>
      )}
    </>
  )
}
