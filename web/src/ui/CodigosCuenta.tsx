// Códigos de recuperación de la cuenta (Configuración → Cuenta en la computadora; «Mi perfil» del menú en el celular): cuántos quedan y
// «Generar códigos nuevos». Sin correo, son la forma de recuperar la cuenta si se olvida la contraseña (docs/cuentas.md).
//   · Los códigos nunca vuelven a verse: acá solo se cuenta cuántos quedan. Generar otros pide la contraseña actual, deja sin efecto los
//     anteriores y los muestra UNA vez, en «Guardá estos códigos».
//   · Con 2 o menos, un aviso fuerte; con 0, dice que solo el dueño de Telar puede ayudar.
//   · No existe para la cuenta del dueño (entra con la cuenta del juego): el servidor dice `aplica: false` y no se dibuja nada.
// Estados: cargando, error con «Reintentar», lista, pidiendo la contraseña, generando, mostrando los códigos nuevos.
import { CircleAlert, KeyRound } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../estado/api'
import { generarCodigosNuevos } from '../estado/sesion'
import { CodigosRecuperacion } from './CodigosRecuperacion'
import { Girando } from './comunes'
import '../estilos/recuperacion.css'

type Carga = { fase: 'cargando' } | { fase: 'error' } | { fase: 'no-aplica' } | { fase: 'lista'; restantes: number; total: number; pocos: boolean; generadosEn: string | null }
type Paso = { paso: 'ver' } | { paso: 'clave' } | { paso: 'mostrar'; codigos: string[] }

export function CodigosCuenta({ email, conTitulo }: { email: string | null; conTitulo?: boolean }) {
  const [carga, setCarga] = useState<Carga>({ fase: 'cargando' })
  const [paso, setPaso] = useState<Paso>({ paso: 'ver' })
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [generando, setGenerando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const d = await api.codigosDeRecuperacion()
      setCarga(d.aplica ? { fase: 'lista', restantes: d.restantes ?? 0, total: d.total ?? 8, pocos: Boolean(d.pocos), generadosEn: d.generadosEn ?? null } : { fase: 'no-aplica' })
    } catch {
      // Si ya había algo a la vista, se queda (lo último antes que un cartel).
      setCarga((c) => (c.fase === 'lista' ? c : { fase: 'error' }))
    }
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  async function generar(e: FormEvent) {
    e.preventDefault()
    if (generando) return
    setError('')
    if (!clave) return setError('Escribí tu contraseña actual.')
    setGenerando(true)
    try {
      const r = await generarCodigosNuevos(clave)
      if (!r.ok) return setError(r.error)
      setClave('')
      setPaso({ paso: 'mostrar', codigos: r.codigos })
    } finally {
      setGenerando(false)
    }
  }

  const cerrarPaso = () => {
    setPaso({ paso: 'ver' })
    setClave('')
    setError('')
  }

  if (carga.fase === 'no-aplica') return null
  const titulo = conTitulo ? (
    <p className="datos-cuenta__mail">
      <b>Códigos de recuperación</b>
    </p>
  ) : null

  if (carga.fase === 'cargando')
    return (
      <div className="codigos-cuenta">
        {titulo}
        <p className="codigos__texto" role="status" aria-busy="true">
          <Girando tam={14} /> Mirando tus códigos…
        </p>
      </div>
    )
  if (carga.fase === 'error')
    return (
      <div className="codigos-cuenta">
        {titulo}
        <p className="cambiar-clave__error" role="alert">
          No pude ver cuántos códigos te quedan. Revisá la conexión.
        </p>
        <span>
          <button
            type="button"
            className="boton boton--chico"
            onClick={() => {
              setCarga({ fase: 'cargando' })
              void cargar()
            }}
          >
            Reintentar
          </button>
        </span>
      </div>
    )

  if (paso.paso === 'mostrar')
    return (
      <div className="codigos-cuenta">
        {titulo}
        <CodigosRecuperacion
          nuevos
          codigos={paso.codigos}
          email={email}
          botonFinal="Listo"
          alTerminar={() => {
            cerrarPaso()
            void cargar()
          }}
        />
      </div>
    )

  const { restantes, total, pocos } = carga
  return (
    <div className="codigos-cuenta">
      {titulo}
      <div className="codigos-cuenta__estado">
        <span className="codigos-cuenta__numero" role="status">
          {restantes === 0 ? 'No te queda ninguno' : `Te ${restantes === 1 ? 'queda' : 'quedan'} ${restantes} de ${total}`}
        </span>
        {paso.paso === 'ver' && (
          <button type="button" className={`boton boton--chico${pocos ? ' boton--primario' : ''}`} onClick={() => setPaso({ paso: 'clave' })}>
            <KeyRound size={14} aria-hidden /> Generar códigos nuevos
          </button>
        )}
      </div>
      {pocos && paso.paso === 'ver' && (
        <p className="codigos__aviso codigos__aviso--fuerte codigos-cuenta__pocos" role="alert">
          <CircleAlert size={15} aria-hidden />
          <span>
            {restantes === 0
              ? 'Si olvidás tu contraseña, no vas a poder entrar solo: únicamente el dueño de Telar podría ayudarte. Generá códigos nuevos ahora.'
              : 'Quedan pocos. Si se acaban y olvidás tu contraseña, no vas a poder entrar solo. Generá códigos nuevos.'}
          </span>
        </p>
      )}
      {paso.paso === 'clave' && (
        <form className="cambiar-clave" onSubmit={generar} noValidate aria-busy={generando}>
          <p className="codigos__texto">Los códigos de ahora dejan de servir y te mostramos 8 nuevos. Para hacerlo, escribí tu contraseña actual.</p>
          {/* El gestor de contraseñas necesita saber de qué cuenta es esta contraseña. */}
          <input type="email" name="username" autoComplete="username" value={email ?? ''} readOnly hidden />
          <label className="perfil__campo">
            <span>Contraseña actual</span>
            <input
              type="password"
              name="current-password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              autoFocus
            />
          </label>
          {error && (
            <p className="cambiar-clave__error" role="alert">
              {error}
            </p>
          )}
          <span className="perfil__botones">
            <button type="button" className="boton boton--chico" onClick={cerrarPaso} disabled={generando}>
              Cancelar
            </button>
            <button type="submit" className="boton boton--chico boton--primario" disabled={generando}>
              {generando ? <Girando /> : 'Generar'}
            </button>
          </span>
        </form>
      )}
    </div>
  )
}
