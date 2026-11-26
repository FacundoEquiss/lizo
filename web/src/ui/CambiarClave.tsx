// Cambiar la contraseña de una cuenta de Telar (pide la actual). Al cambiarla, las otras sesiones de la cuenta se cierran y
// esta sigue. La usan Configuración → Cuenta (escritorio) y el menú del celular.
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { avisar } from '../estado/avisos'
import { cambiarClave } from '../estado/sesion'
import { Girando } from './comunes'

const MIN_CLAVE = 10

export function CambiarClave({ email }: { email: string | null }) {
  const [abierto, setAbierto] = useState(false)
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cerrar = () => {
    setAbierto(false)
    setActual('')
    setNueva('')
    setError('')
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (guardando) return
    setError('')
    if (!actual) return setError('Escribí tu contraseña actual.')
    if (nueva.length < MIN_CLAVE) return setError(`La contraseña nueva tiene que tener al menos ${MIN_CLAVE} caracteres.`)
    setGuardando(true)
    const r = await cambiarClave(actual, nueva)
    setGuardando(false)
    if (!r.ok) return setError(r.error ?? 'No se pudo cambiar la contraseña.')
    cerrar()
    avisar({ texto: 'Contraseña cambiada. Las otras sesiones de tu cuenta se cerraron.', tipo: 'ok' })
  }

  if (!abierto)
    return (
      <button type="button" className="boton boton--chico" onClick={() => setAbierto(true)}>
        <KeyRound size={14} /> Cambiar contraseña
      </button>
    )

  return (
    <form className="cambiar-clave" onSubmit={guardar} noValidate aria-busy={guardando}>
      {/* El gestor de contraseñas necesita saber de qué cuenta es la contraseña nueva. */}
      <input type="email" name="username" autoComplete="username" value={email ?? ''} readOnly hidden />
      <label className="perfil__campo">
        <span>Contraseña actual</span>
        <input
          type={ver ? 'text' : 'password'}
          name="current-password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          autoFocus
        />
      </label>
      <label className="perfil__campo">
        <span>Contraseña nueva</span>
        <input
          type={ver ? 'text' : 'password'}
          name="new-password"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          minLength={MIN_CLAVE}
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
        />
        <small className="cambiar-clave__ayuda">Al menos {MIN_CLAVE} caracteres. Una frase corta sirve.</small>
      </label>
      {error && (
        <p className="cambiar-clave__error" role="alert">
          {error}
        </p>
      )}
      <span className="perfil__botones">
        <button type="button" className="boton boton--chico boton--fantasma" onClick={() => setVer(!ver)} aria-pressed={ver}>
          {ver ? <EyeOff size={14} /> : <Eye size={14} />} {ver ? 'Ocultar' : 'Ver'}
        </button>
        <button type="button" className="boton boton--chico" onClick={cerrar} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="boton boton--chico boton--primario" disabled={guardando}>
          {guardando ? <Girando /> : 'Guardar'}
        </button>
      </span>
    </form>
  )
}
