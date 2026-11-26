// Pantalla para entrar al Telar online: con una cuenta de Telar (mail y contraseña propios) o con la cuenta del juego (la del
// dueño: mail y contraseña, o un código por mail). «Crear cuenta» está SIEMPRE a la vista, en la misma caja: nombre, mail y contraseña,
// sin enlace ni código (docs/cuentas.md, «Crear cuenta con aprobación»). La cuenta nace pendiente: salen sus 8 códigos de recuperación
// («Guardá estos códigos») y después «Tu cuenta espera la aprobación de <dueño>»; no entra hasta que el dueño la apruebe, y si prueba entrar
// antes (con su mail y su contraseña) se lo dice. El enlace de invitación (Unirse.tsx) sigue existiendo y deja la cuenta aprobada al instante.
// «¿Olvidaste tu contraseña?» (sin correo: Telar no tiene servicio de mail): mail + uno de los códigos de recuperación que se mostraron al
// crear la cuenta + contraseña nueva. Entra, avisa cuántos códigos quedan (con un aviso fuerte si son 2 o menos) y ofrece generar otros;
// si la cuenta todavía espera la aprobación, cambia la contraseña pero no entra.
// La pantalla se desplaza sola (entrar.css) y el campo con foco queda a la vista con el teclado abierto (util/campoVisible.ts).
// En el teléfono (plan del celular, 8): sin teclado que salte solo, campos que el gestor de contraseñas reconoce
// (username/current-password al entrar, username/new-password al crear), y el paso del código guardado 10 minutos (en una
// app instalada en iOS, ir al mail a buscar el código puede recargar la app).
import { CircleAlert, Clock, Eye, EyeOff } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { entrar, entrarConCodigo, generarCodigosNuevos, pedirCodigo, recuperarCuenta, solicitarCuenta } from '../estado/sesion'
import { esInstalada, esMovil, esTactil } from '../movil/detectar'
import { instalar } from '../pwa/instalar'
import { CodigosRecuperacion } from '../ui/CodigosRecuperacion'
import { Girando } from '../ui/comunes'
import { MarcaTelar } from '../ui/marcas'
import { useCampoVisible } from '../util/campoVisible'

// Los pasos para instalar en el teléfono se bajan solo si se piden.
const PasosInstalar = lazy(() => import('../pwa/ui/HojaInstalar'))

const PASO_CODIGO = 'telar.entrar'
const ESPERA_REENVIO = 60
/** Lo mismo que pide el servidor (cuentas.ts): el largo es la regla que importa. */
export const MIN_CLAVE = 10

function pasoGuardado(): { email: string; enviado: number } | null {
  try {
    const d = JSON.parse(localStorage.getItem(PASO_CODIGO) ?? 'null') as { email: string; hasta: number; enviado?: number } | null
    if (!d || !d.email || d.hasta < Date.now()) return null
    return { email: d.email, enviado: d.enviado ?? d.hasta - 10 * 60_000 }
  } catch {
    return null
  }
}

function guardarPaso(email: string | null) {
  try {
    if (email) localStorage.setItem(PASO_CODIGO, JSON.stringify({ email, enviado: Date.now(), hasta: Date.now() + 10 * 60_000 }))
    else localStorage.removeItem(PASO_CODIGO)
  } catch {}
}

type Modo = 'clave' | 'codigo' | 'codigo-enviado' | 'crear' | 'olvide'

/** El campo de la contraseña con el botón de verla (en el teléfono se escribe a ciegas y con errores). */
export function CampoClave(p: {
  id: string
  valor: string
  cambiar: (v: string) => void
  nueva?: boolean
  refInput?: React.Ref<HTMLInputElement>
  ayuda?: string
  /** El rótulo del campo («Contraseña» de fábrica; «Contraseña nueva» al recuperar la cuenta). */
  etiqueta?: string
}) {
  const [ver, setVer] = useState(false)
  return (
    <label className="entrar__campo" htmlFor={p.id}>
      <span>{p.etiqueta ?? 'Contraseña'}</span>
      <span className="entrar__clave">
        <input
          ref={p.refInput}
          id={p.id}
          name={p.nueva ? 'new-password' : 'password'}
          type={ver ? 'text' : 'password'}
          autoComplete={p.nueva ? 'new-password' : 'current-password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={p.nueva ? 'next' : 'go'}
          minLength={p.nueva ? MIN_CLAVE : undefined}
          aria-describedby={p.ayuda ? `${p.id}-ayuda` : undefined}
          value={p.valor}
          onChange={(e) => p.cambiar(e.target.value)}
          required
        />
        <button
          type="button"
          className="entrar__ver"
          onClick={() => setVer(!ver)}
          aria-label={ver ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
          aria-pressed={ver}
        >
          {ver ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {p.ayuda && (
        <small className="entrar__ayuda" id={`${p.id}-ayuda`}>
          {p.ayuda}
        </small>
      )}
    </label>
  )
}

export function Entrar() {
  const guardado = useRef(pasoGuardado()).current
  useCampoVisible()
  const [email, setEmail] = useState(guardado?.email ?? '')
  const [clave, setClave] = useState('')
  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [modo, setModo] = useState<Modo>(guardado ? 'codigo-enviado' : 'clave')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviadoEn, setEnviadoEn] = useState(guardado?.enviado ?? 0)
  const [ahora, setAhora] = useState(Date.now())
  const [pasosInstalar, setPasosInstalar] = useState(false)
  // «¿Olvidaste tu contraseña?»: el código de recuperación, y lo que se ve cuando ya entró.
  const [codigoRecuperacion, setCodigoRecuperacion] = useState('')
  const [recuperada, setRecuperada] = useState<{ restantes: number; pocos: boolean } | null>(null)
  // La cuenta recién pedida (o con la contraseña recuperada mientras espera): todavía no entra, espera la aprobación del dueño.
  const [esperando, setEsperando] = useState<{ aprobador: string; recuperada: boolean } | null>(null)
  // Los códigos que hay que guardar antes de seguir (cuenta recién pedida o códigos nuevos): salen una sola vez. `aprobador` solo en la cuenta recién pedida.
  const [codigosNuevos, setCodigosNuevos] = useState<{ codigos: string[]; nuevos: boolean; aprobador?: string } | null>(null)
  const [generando, setGenerando] = useState(false)
  const refClave = useRef<HTMLInputElement>(null)
  const refCodigo = useRef<HTMLInputElement>(null)
  // En el teléfono el teclado no se abre solo: taparía medio formulario antes de verlo.
  const enfocarSolo = !esTactil()

  // Cuenta regresiva para reenviar el código (el servidor rechaza pedidos antes del minuto).
  const faltan = Math.max(0, ESPERA_REENVIO - Math.floor((ahora - enviadoEn) / 1000))
  useEffect(() => {
    if (modo !== 'codigo-enviado' || faltan === 0) return
    const t = setTimeout(() => setAhora(Date.now()), 1000)
    return () => clearTimeout(t)
  }, [modo, faltan, ahora])

  // Al volver del mail con el código todavía vacío, el campo toma el foco: es el único paso posible.
  useEffect(() => {
    if (modo !== 'codigo-enviado') return
    const volver = () => {
      if (!document.hidden && !refCodigo.current?.value) refCodigo.current?.focus()
    }
    document.addEventListener('visibilitychange', volver)
    return () => document.removeEventListener('visibilitychange', volver)
  }, [modo])

  async function alEnviar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    setError('')
    setAviso('')
    if (modo === 'crear') {
      // Lo que se puede avisar antes de ir al servidor (el servidor lo vuelve a mirar todo).
      if (!nombre.trim()) return setError('Escribí tu nombre.')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Escribí un mail válido (por ejemplo nombre@gmail.com).')
      if (clave.length < MIN_CLAVE) return setError(`La contraseña tiene que tener al menos ${MIN_CLAVE} caracteres.`)
    }
    if (modo === 'olvide') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Escribí tu mail (el de tu cuenta de Telar).')
      if (!codigoRecuperacion.trim()) return setError('Escribí uno de tus códigos de recuperación.')
      if (clave.length < MIN_CLAVE) return setError(`La contraseña nueva tiene que tener al menos ${MIN_CLAVE} caracteres.`)
    }
    setEnviando(true)
    try {
      if (modo === 'clave') {
        const r = await entrar(email.trim(), clave)
        if (r.ok) return location.reload()
        setError(r.error ?? 'No se pudo entrar.')
      } else if (modo === 'crear') {
        const r = await solicitarCuenta({ email: email.trim(), nombre: nombre.trim(), clave })
        if (r.ok) {
          // La cuenta quedó pedida (no abre sesión): primero los códigos de recuperación (una sola vez) y después el aviso de que espera.
          if (r.codigos?.length) return setCodigosNuevos({ codigos: r.codigos, nuevos: false, aprobador: r.aprobador })
          return setEsperando({ aprobador: r.aprobador, recuperada: false })
        }
        setError(r.error)
      } else if (modo === 'olvide') {
        const r = await recuperarCuenta({ email: email.trim(), codigo: codigoRecuperacion.trim(), clave })
        if (r.ok && r.pendiente) return setEsperando({ aprobador: r.aprobador, recuperada: true })
        if (r.ok) return setRecuperada({ restantes: r.restantes, pocos: r.pocos })
        setError(r.error)
      } else if (modo === 'codigo') {
        const r = await pedirCodigo(email.trim())
        if (!r.ok) return setError(r.error ?? 'No se pudo mandar el código.')
        guardarPaso(email.trim())
        setEnviadoEn(Date.now())
        setAhora(Date.now())
        setModo('codigo-enviado')
        setAviso('Si el mail tiene cuenta en el juego, te llega un código en un ratito.')
      } else {
        const r = await entrarConCodigo(email.trim(), codigo)
        if (r.ok) {
          guardarPaso(null)
          return location.reload()
        }
        setError(r.error ?? 'No se pudo entrar.')
      }
    } finally {
      setEnviando(false)
    }
  }

  async function reenviar() {
    if (faltan > 0 || enviando) return
    setError('')
    const r = await pedirCodigo(email.trim())
    if (!r.ok) return setError(r.error ?? 'No se pudo mandar el código.')
    guardarPaso(email.trim())
    setEnviadoEn(Date.now())
    setAhora(Date.now())
    setAviso('Te mandamos otro código.')
  }

  /** «Generar códigos nuevos» al terminar de recuperar la cuenta: la contraseña recién escrita sirve para pedirlos. */
  async function generarOtros() {
    if (generando) return
    setError('')
    setGenerando(true)
    try {
      const r = await generarCodigosNuevos(clave)
      if (r.ok) return setCodigosNuevos({ codigos: r.codigos, nuevos: true })
      setError(r.error)
    } finally {
      setGenerando(false)
    }
  }

  const cambiar = (m: Modo) => {
    guardarPaso(null)
    setModo(m)
    setCodigo('')
    setCodigoRecuperacion('')
    setClave('')
    setError('')
    setAviso('')
  }

  const titulo = modo === 'crear' ? 'Creá tu cuenta' : modo === 'clave' ? 'Entrá a Telar' : modo === 'olvide' ? 'Recuperá tu cuenta' : 'Entrá con tu cuenta del juego'
  const texto =
    modo === 'crear'
      ? 'Tu cuenta tiene sus propios proyectos: nadie más los ve. Antes de entrar, el dueño de Telar la tiene que aprobar.'
      : modo === 'olvide'
        ? 'Escribí tu mail, uno de los códigos de recuperación que guardaste al crear tu cuenta y la contraseña nueva que quieras usar.'
        : modo === 'clave'
          ? 'Con tu cuenta de Telar, o con el mail y la contraseña de la cuenta del juego.'
          : modo === 'codigo-enviado'
            ? `Te mandamos un código a ${email.trim()}.`
            : 'Solo para la cuenta del juego: te mandamos un código a su mail.'
  /** Volver a «Entrar» con el mail ya escrito (después de pedir la cuenta o de ver que espera). */
  const volverAEntrar = () => {
    setEsperando(null)
    setCodigosNuevos(null)
    cambiar('clave')
  }

  const marca = (
    <div className="entrar__marca" aria-hidden="true">
      <span className="entrar__logo">
        <MarcaTelar size={44} />
      </span>
      Telar
    </div>
  )

  // Los códigos de recuperación: se ven una sola vez y no se sigue hasta confirmar que se guardaron.
  if (codigosNuevos)
    return (
      <main className="entrar">
        <div className="entrar__caja">
          {marca}
          <CodigosRecuperacion
            pantalla
            codigos={codigosNuevos.codigos}
            nuevos={codigosNuevos.nuevos}
            email={email.trim()}
            botonFinal={codigosNuevos.aprobador ? 'Seguir' : 'Entrar a Telar'}
            // Una cuenta recién pedida todavía no entra: sigue el aviso de que espera. Con códigos nuevos (ya adentro), se recarga.
            alTerminar={() => {
              const aprobador = codigosNuevos.aprobador
              if (!aprobador) return location.reload()
              setCodigosNuevos(null)
              setEsperando({ aprobador, recuperada: false })
            }}
          />
        </div>
      </main>
    )

  // La cuenta espera la aprobación del dueño (recién pedida, o con la contraseña cambiada con un código): todavía no entra.
  if (esperando)
    return (
      <main className="entrar">
        <div className="entrar__caja espera" role="group" aria-labelledby="espera-titulo">
          {marca}
          <span className="espera__icono" aria-hidden>
            <Clock size={22} />
          </span>
          <h1 className="entrar__titulo" id="espera-titulo">
            Listo
          </h1>
          <p className="entrar__texto espera__texto" role="status">
            {esperando.recuperada ? 'Cambiamos tu contraseña. ' : ''}
            Tu cuenta espera la aprobación de <b>{esperando.aprobador}</b>. Cuando la apruebe, entrás con tu mail y tu contraseña.
          </p>
          <button type="button" className="boton boton--primario boton--ancho entrar__boton" onClick={volverAEntrar}>
            Ir a Entrar
          </button>
        </div>
      </main>
    )

  // Ya recuperó la cuenta (la sesión está abierta): cuántos códigos le quedan y, si son pocos, un aviso fuerte.
  if (recuperada)
    return (
      <main className="entrar">
        <div className="entrar__caja recuperada" role="group" aria-labelledby="recuperada-titulo">
          {marca}
          <h1 className="entrar__titulo" id="recuperada-titulo">
            Listo, ya entraste
          </h1>
          <p className="entrar__texto">Tu contraseña nueva ya funciona y cerramos tus otras sesiones.</p>
          <p className="recuperada__cuenta" role="status">
            {recuperada.restantes === 0 ? (
              <>
                <b>No te queda ningún</b> código de recuperación.
              </>
            ) : (
              <>
                Te {recuperada.restantes === 1 ? 'queda' : 'quedan'} <b>{recuperada.restantes}</b> {recuperada.restantes === 1 ? 'código' : 'códigos'} de recuperación.
              </>
            )}
          </p>
          {recuperada.pocos && (
            <p className="codigos__aviso codigos__aviso--fuerte" role="alert">
              <CircleAlert size={15} aria-hidden />
              <span>
                {recuperada.restantes === 0 ? 'Si volvés a olvidar la contraseña, no vas a poder entrar solo.' : 'Quedan pocos: si se acaban y olvidás la contraseña, no vas a poder entrar solo.'}{' '}
                Generá códigos nuevos ahora.
              </span>
            </p>
          )}
          {error && (
            <p className="entrar__error" role="alert">
              {error}
            </p>
          )}
          <div className="recuperada__acciones">
            <button
              type="button"
              className={`boton boton--ancho entrar__boton${recuperada.pocos ? ' boton--primario' : ''}`}
              onClick={generarOtros}
              disabled={generando}
              aria-busy={generando}
            >
              {generando ? <Girando /> : 'Generar códigos nuevos'}
            </button>
            <button type="button" className={`boton boton--ancho entrar__boton${recuperada.pocos ? ' boton--fantasma' : ' boton--primario'}`} onClick={() => location.reload()} disabled={generando}>
              Seguir a Telar
            </button>
          </div>
        </div>
      </main>
    )

  return (
    <main className="entrar">
      <form
        className="entrar__caja"
        onSubmit={alEnviar}
        method="post"
        action={modo === 'crear' ? '/api/solicitudes' : modo === 'olvide' ? '/api/recuperar' : '/api/sesion'}
        noValidate
        aria-busy={enviando}
      >
        {marca}
        <h1 className="entrar__titulo">{titulo}</h1>
        <p className="entrar__texto">{texto}</p>

        {modo === 'crear' && (
          <label className="entrar__campo" htmlFor="crear-nombre">
            <span>Nombre</span>
            <input
              id="crear-nombre"
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
        )}

        {modo !== 'codigo-enviado' && (
          <label className="entrar__campo" htmlFor="entrar-mail">
            <span>Mail</span>
            <input
              id="entrar-mail"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint={modo === 'codigo' ? 'send' : 'next'}
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && modo === 'clave') {
                  e.preventDefault()
                  refClave.current?.focus()
                }
              }}
              autoFocus={enfocarSolo && modo !== 'crear'}
              required
            />
          </label>
        )}

        {modo === 'clave' && <CampoClave id="entrar-clave" valor={clave} cambiar={setClave} refInput={refClave} />}
        {modo === 'olvide' && (
          <>
            <label className="entrar__campo" htmlFor="olvide-codigo">
              <span>Código de recuperación</span>
              <input
                id="olvide-codigo"
                name="recovery-code"
                className="entrar__codigo-recuperacion"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                placeholder="XXXX-XXXX-XXXX"
                maxLength={40}
                aria-describedby="olvide-codigo-ayuda"
                value={codigoRecuperacion}
                onChange={(e) => setCodigoRecuperacion(e.target.value)}
                required
              />
              <small className="entrar__ayuda" id="olvide-codigo-ayuda">
                Cada código sirve una sola vez. Lo guardaste cuando creaste tu cuenta.
              </small>
            </label>
            <CampoClave id="olvide-clave" valor={clave} cambiar={setClave} nueva etiqueta="Contraseña nueva" ayuda={`Al menos ${MIN_CLAVE} caracteres. Una frase corta sirve.`} />
          </>
        )}
        {modo === 'crear' && <CampoClave id="crear-clave" valor={clave} cambiar={setClave} nueva ayuda={`Al menos ${MIN_CLAVE} caracteres. Una frase corta sirve.`} />}
        {modo === 'codigo-enviado' && (
          <label className="entrar__campo" htmlFor="entrar-codigo">
            <span>Código</span>
            <input
              ref={refCodigo}
              id="entrar-codigo"
              name="codigo"
              className="entrar__codigo"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              enterKeyHint="go"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/[\s-]/g, ''))}
              autoFocus={enfocarSolo}
              required
            />
          </label>
        )}

        {error && (
          <p className="entrar__error" role="alert">
            {error}
          </p>
        )}
        {aviso && !error && <p className="entrar__aviso">{aviso}</p>}

        <button className="boton boton--primario boton--ancho entrar__boton" type="submit" disabled={enviando}>
          {enviando ? <Girando /> : modo === 'codigo' ? 'Mandarme un código' : modo === 'crear' ? 'Crear cuenta' : modo === 'olvide' ? 'Cambiar contraseña y entrar' : 'Entrar'}
        </button>

        {modo === 'codigo-enviado' && (
          <div className="entrar__codigo-acciones">
            <button type="button" className="boton boton--fantasma boton--chico" onClick={reenviar} disabled={faltan > 0}>
              {faltan > 0 ? `Reenviar en 0:${String(faltan).padStart(2, '0')}` : 'Reenviar'}
            </button>
            <button type="button" className="boton boton--fantasma boton--chico" onClick={() => cambiar('codigo')}>
              Usar otro mail
            </button>
          </div>
        )}

        <div className="entrar__otro">
          {modo === 'clave' ? (
            <>
              <button type="button" className="boton boton--fantasma boton--chico" onClick={() => cambiar('olvide')}>
                ¿Olvidaste tu contraseña?
              </button>
              <button type="button" className="boton boton--chico entrar__crear" onClick={() => cambiar('crear')}>
                Crear cuenta
              </button>
              <button type="button" className="boton boton--fantasma boton--chico" onClick={() => cambiar('codigo')}>
                Cuenta del juego: entrar con un código por mail
              </button>
              <p className="entrar__invitacion">¿Te pasaron un enlace de invitación? Abrilo y entrás directo.</p>
            </>
          ) : (
            <button type="button" className="boton boton--fantasma boton--chico" onClick={() => cambiar('clave')}>
              {modo === 'crear' ? 'Ya tengo cuenta: entrar' : modo === 'olvide' ? 'Volver a entrar' : 'Entrar con mail y contraseña'}
            </button>
          )}
        </div>
        {modo === 'olvide' && (
          <p className="entrar__ayuda-extra">¿No encontrás tus códigos? Pedile al dueño de Telar que te mande un enlace para restablecer tu contraseña.</p>
        )}
        {esMovil() && !esInstalada() && (
          <button
            type="button"
            className="entrar__instalar"
            onClick={async () => {
              if (!(await instalar())) setPasosInstalar(true)
            }}
          >
            Instalar Telar en el celular
          </button>
        )}
      </form>
      {pasosInstalar && (
        <Suspense fallback={null}>
          <PasosInstalar abierta={pasosInstalar} alCerrar={() => setPasosInstalar(false)} />
        </Suspense>
      )}
    </main>
  )
}
