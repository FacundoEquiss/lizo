// «Fulano te invitó a Telar»: la pantalla a la que llega un amigo con el enlace /unirse/<token> que le pasó el dueño (Configuración →
// Amigos). Misma estética que Entrar, sin campo de código: nombre, mail y contraseña. Al crear la cuenta queda con la sesión abierta
// y entra a su Telar vacío (la bienvenida es la de siempre: «Creá tu primer proyecto»). Es la otra puerta de entrada (la normal es «Crear
// cuenta» en Entrar, que espera la aprobación del dueño): quien llega con un enlace del dueño queda APROBADO AL INSTANTE, sin pasar por solicitud.
//   · El token va en el cuerpo del pedido, nunca en la dirección de la API.
//   · Si el enlace no sirve, un solo mensaje: no se cuenta si venció, se usó o lo revocaron.
//   · Al crear la cuenta salen sus 8 códigos de recuperación (sin correo, son la forma de recuperarla si olvida la contraseña): se ven UNA
//     vez, en «Guardá estos códigos», y no entra hasta confirmar que los guardó (ui/CodigosRecuperacion.tsx).
//   · Si ya hay una sesión abierta en este navegador no se muestra el formulario: crear la cuenta pisaría esa sesión (y el dueño que
//     prueba su propio enlace perdería la suya). Se explica y se vuelve a Telar.
import { useEffect, useState, type FormEvent } from 'react'
import { unirse, useSesion, verInvitacion } from '../estado/sesion'
import { esTactil } from '../movil/detectar'
import { CodigosRecuperacion } from '../ui/CodigosRecuperacion'
import { Girando } from '../ui/comunes'
import { MarcaTelar } from '../ui/marcas'
import { useCampoVisible } from '../util/campoVisible'
import { CampoClave, MIN_CLAVE } from './Entrar'

type Fase = { fase: 'cargando' } | { fase: 'listo'; invitador: string } | { fase: 'no-sirve'; mensaje: string }

const tokenDeLaDireccion = () => decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] ?? '')

export default function Unirse() {
  const entrado = useSesion((s) => s.entrado)
  const [token] = useState(tokenDeLaDireccion)
  const [estado, setEstado] = useState<Fase>({ fase: 'cargando' })
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  // Los códigos de recuperación de la cuenta recién creada: se ven una sola vez, antes de entrar.
  const [codigos, setCodigos] = useState<string[] | null>(null)
  const enfocarSolo = !esTactil()
  useCampoVisible()

  useEffect(() => {
    if (entrado) return
    let vivo = true
    verInvitacion(token).then((r) => {
      if (!vivo) return
      setEstado(r.ok ? { fase: 'listo', invitador: r.invitador } : { fase: 'no-sirve', mensaje: r.error })
    })
    return () => {
      vivo = false
    }
  }, [token, entrado])

  async function alEnviar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    setError('')
    // Lo que se puede avisar antes de ir al servidor (el servidor lo vuelve a mirar todo).
    if (!nombre.trim()) return setError('Escribí tu nombre.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Escribí un mail válido (por ejemplo nombre@gmail.com).')
    if (clave.length < MIN_CLAVE) return setError(`La contraseña tiene que tener al menos ${MIN_CLAVE} caracteres.`)
    setEnviando(true)
    try {
      const r = await unirse({ token, email: email.trim(), nombre: nombre.trim(), clave })
      // Adentro: a la raíz (la dirección actual lleva el enlace; no tiene que quedar en el historial).
      if (r.ok) {
        const nuevos = r.datos?.codigos as string[] | null | undefined
        return nuevos?.length ? setCodigos(nuevos) : location.replace('/')
      }
      if (r.estado === 404) return setEstado({ fase: 'no-sirve', mensaje: r.error ?? '' })
      setError(r.error ?? 'No se pudo crear la cuenta.')
    } finally {
      setEnviando(false)
    }
  }

  const marca = (
    <div className="entrar__marca" aria-hidden="true">
      <span className="entrar__logo">
        <MarcaTelar size={44} />
      </span>
      Telar
    </div>
  )

  // La cuenta ya está creada y con la sesión abierta (por eso `entrado` puede ser cierto al volver a mirar): primero, guardar los códigos.
  if (codigos)
    return (
      <main className="entrar">
        <div className="entrar__caja">
          {marca}
          <CodigosRecuperacion pantalla codigos={codigos} email={email.trim()} botonFinal="Entrar a mi Telar" alTerminar={() => location.replace('/')} />
        </div>
      </main>
    )

  if (entrado)
    return (
      <main className="entrar">
        <div className="entrar__caja" role="group" aria-labelledby="unirse-titulo">
          {marca}
          <h1 className="entrar__titulo" id="unirse-titulo">
            Ya entraste a Telar
          </h1>
          <p className="entrar__texto">
            Este enlace es para crear una cuenta nueva y, abierto acá, pisaría tu sesión. Abrilo en otro navegador (o en una ventana de
            incógnito), o salí primero.
          </p>
          <a className="boton boton--primario boton--ancho entrar__boton" href="/">
            Ir a mi Telar
          </a>
        </div>
      </main>
    )

  return (
    <main className="entrar">
      {estado.fase === 'listo' ? (
        <form className="entrar__caja" onSubmit={alEnviar} method="post" action="/api/unirse" noValidate aria-busy={enviando} aria-labelledby="unirse-titulo">
          {marca}
          <h1 className="entrar__titulo" id="unirse-titulo">
            {estado.invitador} te invitó a Telar
          </h1>
          <p className="entrar__texto">Creá tu cuenta. Tus proyectos son solo tuyos: nadie más los ve.</p>
          <label className="entrar__campo" htmlFor="unirse-nombre">
            <span>Nombre</span>
            <input
              id="unirse-nombre"
              name="name"
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="next"
              maxLength={40}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoFocus={enfocarSolo}
              required
            />
          </label>
          <label className="entrar__campo" htmlFor="unirse-mail">
            <span>Mail</span>
            <input
              id="unirse-mail"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <CampoClave id="unirse-clave" valor={clave} cambiar={setClave} nueva ayuda={`Al menos ${MIN_CLAVE} caracteres. Una frase corta sirve.`} />
          {error && (
            <p className="entrar__error" role="alert">
              {error}
            </p>
          )}
          <button className="boton boton--primario boton--ancho entrar__boton" type="submit" disabled={enviando}>
            {enviando ? <Girando /> : 'Crear mi cuenta'}
          </button>
          <div className="entrar__otro">
            <a className="boton boton--fantasma boton--chico" href="/">
              Ya tengo cuenta: entrar
            </a>
          </div>
        </form>
      ) : (
        <div className="entrar__caja" role="group" aria-labelledby="unirse-titulo" aria-busy={estado.fase === 'cargando'}>
          {marca}
          {estado.fase === 'cargando' ? (
            <p className="entrar__texto autorizar__cargando" role="status">
              <Girando /> Abriendo tu invitación…
            </p>
          ) : (
            <>
              <h1 className="entrar__titulo" id="unirse-titulo">
                Esta invitación ya no sirve
              </h1>
              <p className="entrar__texto" role="alert">
                {/Demasiados intentos/.test(estado.mensaje) ? estado.mensaje : 'Pedile otra a quien te invitó.'}
              </p>
              <a className="boton boton--ancho entrar__boton" href="/">
                Ir a Telar
              </a>
            </>
          )}
        </div>
      )}
    </main>
  )
}
