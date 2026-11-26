// «Poné tu contraseña nueva»: la pantalla a la que llega un amigo con el enlace /restablecer/<token> que le mandó el dueño (Configuración →
// Amigos → «Restablecer contraseña»), cuando olvidó la contraseña y no tiene sus códigos de recuperación. Misma estética que Unirse.
//   · El dueño NUNCA ve ni elige la contraseña: la escribe acá quien abre el enlace. La pantalla lo dice.
//   · El enlace sirve una vez y vence a las 24 horas; si no sirve, un solo mensaje (no se cuenta si venció, se usó o lo cancelaron).
//   · El token va en el cuerpo del pedido, nunca en la dirección de la API.
//   · Al terminar queda con la sesión abierta, se cierran sus otras sesiones y salen 8 códigos de recuperación nuevos (los de antes dejan de
//     servir: pudieron perderse): «Guardá estos códigos» antes de entrar.
//   · Si ya hay una sesión abierta en este navegador no se muestra el formulario: cambiar la contraseña pisaría esa sesión (y el dueño que
//     prueba un enlace suyo perdería la suya).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { restablecerConEnlace, useSesion, verRestablecimiento } from '../estado/sesion'
import { esTactil } from '../movil/detectar'
import { CodigosRecuperacion } from '../ui/CodigosRecuperacion'
import { Girando } from '../ui/comunes'
import { MarcaTelar } from '../ui/marcas'
import { CampoClave, MIN_CLAVE } from './Entrar'

type Fase = { fase: 'cargando' } | { fase: 'listo'; nombre: string } | { fase: 'no-sirve'; mensaje: string }

const tokenDeLaDireccion = () => decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] ?? '')

export default function Restablecer() {
  const entrado = useSesion((s) => s.entrado)
  const [token] = useState(tokenDeLaDireccion)
  const [estado, setEstado] = useState<Fase>({ fase: 'cargando' })
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [codigos, setCodigos] = useState<string[] | null>(null)
  const refClave = useRef<HTMLInputElement>(null)
  // En el teléfono el teclado no se abre solo: taparía medio formulario antes de verlo.
  const enfocarSolo = !esTactil()
  useEffect(() => {
    if (estado.fase === 'listo' && enfocarSolo) refClave.current?.focus()
  }, [estado.fase, enfocarSolo])

  useEffect(() => {
    if (entrado) return
    let vivo = true
    verRestablecimiento(token).then((r) => {
      if (!vivo) return
      setEstado(r.ok ? { fase: 'listo', nombre: r.nombre } : { fase: 'no-sirve', mensaje: r.error })
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
    if (clave.length < MIN_CLAVE) return setError(`La contraseña tiene que tener al menos ${MIN_CLAVE} caracteres.`)
    setEnviando(true)
    try {
      const r = await restablecerConEnlace({ token, clave })
      if (r.ok) return r.codigos?.length ? setCodigos(r.codigos) : location.replace('/')
      if (r.estado === 404) return setEstado({ fase: 'no-sirve', mensaje: r.error })
      setError(r.error)
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

  // La contraseña ya cambió y la sesión quedó abierta: primero, guardar los códigos nuevos (una sola vez).
  if (codigos)
    return (
      <main className="entrar">
        <div className="entrar__caja">
          {marca}
          <CodigosRecuperacion pantalla nuevos codigos={codigos} botonFinal="Entrar a mi Telar" alTerminar={() => location.replace('/')} />
        </div>
      </main>
    )

  if (entrado)
    return (
      <main className="entrar">
        <div className="entrar__caja" role="group" aria-labelledby="restablecer-titulo">
          {marca}
          <h1 className="entrar__titulo" id="restablecer-titulo">
            Ya entraste a Telar
          </h1>
          <p className="entrar__texto">
            Este enlace es para cambiar la contraseña de otra cuenta y, abierto acá, pisaría tu sesión. Abrilo en otro navegador (o en una
            ventana de incógnito), o salí primero.
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
        <form className="entrar__caja" onSubmit={alEnviar} method="post" action="/api/restablecer" noValidate aria-busy={enviando} aria-labelledby="restablecer-titulo">
          {marca}
          <h1 className="entrar__titulo" id="restablecer-titulo">
            {estado.nombre ? `Hola, ${estado.nombre}` : 'Hola'}: poné tu contraseña nueva
          </h1>
          <p className="entrar__texto">
            El dueño de Telar te mandó este enlace para que elijas una contraseña nueva. La escribís vos: él no la ve ni la elige. El enlace sirve una
            sola vez.
          </p>
          <CampoClave
            id="restablecer-clave"
            valor={clave}
            cambiar={setClave}
            nueva
            etiqueta="Contraseña nueva"
            ayuda={`Al menos ${MIN_CLAVE} caracteres. Una frase corta sirve.`}
            refInput={refClave}
          />
          {error && (
            <p className="entrar__error" role="alert">
              {error}
            </p>
          )}
          <button className="boton boton--primario boton--ancho entrar__boton" type="submit" disabled={enviando}>
            {enviando ? <Girando /> : 'Guardar y entrar'}
          </button>
          <div className="entrar__otro">
            <a className="boton boton--fantasma boton--chico" href="/">
              Mejor entro con mi contraseña
            </a>
          </div>
        </form>
      ) : (
        <div className="entrar__caja" role="group" aria-labelledby="restablecer-titulo" aria-busy={estado.fase === 'cargando'}>
          {marca}
          {estado.fase === 'cargando' ? (
            <p className="entrar__texto autorizar__cargando" role="status">
              <Girando /> Abriendo tu enlace…
            </p>
          ) : (
            <>
              <h1 className="entrar__titulo" id="restablecer-titulo">
                Este enlace ya no sirve
              </h1>
              <p className="entrar__texto" role="alert">
                {/Demasiados intentos/.test(estado.mensaje) ? estado.mensaje : 'Sirve una sola vez y vence a las 24 horas. Pedile otro a quien te lo mandó.'}
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
