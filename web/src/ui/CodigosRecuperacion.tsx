// «Guardá estos códigos»: los 8 códigos de recuperación de una cuenta, que se ven UNA sola vez (el servidor guarda solo su hash). Sin
// correo, son la forma en que una persona recupera su cuenta si olvida la contraseña, así que la pantalla no deja seguir hasta que
// confirma que los guardó. La usan: la cuenta recién creada (Unirse.tsx y Entrar.tsx), el enlace de restablecimiento (Restablecer.tsx),
// «Olvidé mi contraseña» (Entrar.tsx) y «Generar códigos nuevos» (ui/CodigosCuenta.tsx, en Configuración y en el menú del celular).
//   · Copiar (todos juntos) y Descargar .txt: dos formas de no perderlos. El texto dice para qué sirven y que valen como una contraseña.
//   · Casilla «Ya los guardé» obligatoria antes del botón final; mientras no está marcada, cerrar la pestaña avisa que se pierden.
//   · Nada de esto va a ningún almacenamiento del navegador: los códigos viven solo en la pantalla.
import { Check, CircleAlert, Copy, Download, KeyRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { copiarTexto, descargarTexto } from '../util/portapapeles'
import { Girando } from './comunes'
import '../estilos/recuperacion.css'

/** El archivo .txt: para qué sirven, cómo se usan y los códigos. Nada más. */
export function textoDeLosCodigos(codigos: string[], email?: string | null) {
  return [
    'Telar · códigos de recuperación',
    email ? `Cuenta: ${email}` : null,
    `Generados: ${new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    '',
    'Cada código sirve UNA sola vez y vale como tu contraseña: guardá este archivo en un lugar privado y no se lo pases a nadie.',
    'Si te olvidás la contraseña: en Telar tocá «¿Olvidaste tu contraseña?» y escribí tu mail, uno de estos códigos y una contraseña nueva.',
    '',
    ...codigos,
    '',
  ]
    .filter((l) => l !== null)
    .join('\n')
}

export function CodigosRecuperacion(p: {
  codigos: string[]
  /** El mail de la cuenta, para el archivo descargado. */
  email?: string | null
  /** Los códigos de antes ya no sirven (se generaron otros). */
  nuevos?: boolean
  /** Lo que dice el botón de seguir cuando ya los guardó. */
  botonFinal: string
  alTerminar: () => void
  /** Como pantalla entera (título grande de la pantalla de entrar) o adentro de Configuración. */
  pantalla?: boolean
}) {
  const [guardados, setGuardados] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [descargado, setDescargado] = useState(false)
  const [saliendo, setSaliendo] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const texto = textoDeLosCodigos(p.codigos, p.email)

  // Mientras no confirmó que los guardó, cerrar o recargar la pestaña los pierde para siempre: el navegador avisa.
  useEffect(() => {
    if (guardados) return
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [guardados])

  async function copiar() {
    const ok = await copiarTexto(p.codigos.join('\n'), area.current)
    setCopiado(ok)
    if (ok) setTimeout(() => setCopiado(false), 2400)
  }
  function descargar() {
    descargarTexto('telar-codigos-de-recuperacion.txt', texto)
    setDescargado(true)
  }
  function seguir() {
    setSaliendo(true)
    p.alTerminar()
  }

  const Titulo = p.pantalla ? 'h1' : 'h4'
  return (
    <section className={`codigos${p.pantalla ? ' codigos--pantalla' : ''}`} aria-labelledby="codigos-titulo">
      <Titulo id="codigos-titulo" className={p.pantalla ? 'entrar__titulo' : 'codigos__titulo'}>
        {p.pantalla ? '' : <KeyRound size={15} aria-hidden />} Guardá estos códigos
      </Titulo>
      <p className={p.pantalla ? 'entrar__texto' : 'codigos__texto'}>
        Si te olvidás la contraseña, uno de estos códigos te deja entrar y poner una nueva. Cada uno sirve <b>una sola vez</b> y vale como tu
        contraseña: guardalos en un lugar privado y no se los pases a nadie.
        {p.nuevos ? ' Los códigos de antes ya no sirven.' : ''}
      </p>
      <p className="codigos__aviso" role="status">
        <CircleAlert size={15} aria-hidden /> <span>
          Es la única vez que los ves. Si los perdés, {p.pantalla ? 'generás otros desde Configuración → Cuenta.' : 'generás otros con «Generar códigos nuevos».'}
        </span>
      </p>
      <ol className="codigos__lista" aria-label="Tus códigos de recuperación">
        {p.codigos.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      {/* El mismo texto en un campo oculto: es el que se selecciona cuando el navegador no deja copiar solo. */}
      <textarea ref={area} className="codigos__copia" readOnly tabIndex={-1} aria-hidden value={p.codigos.join('\n')} />
      <div className="codigos__acciones">
        <button type="button" className="boton" onClick={copiar}>
          {copiado ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copiado ? 'Copiados' : 'Copiar'}
        </button>
        <button type="button" className="boton" onClick={descargar}>
          {descargado ? <Check size={15} aria-hidden /> : <Download size={15} aria-hidden />} Descargar .txt
        </button>
      </div>
      <label className="codigos__confirmar">
        <input type="checkbox" checked={guardados} onChange={(e) => setGuardados(e.target.checked)} disabled={saliendo} />
        <span>Ya los guardé</span>
      </label>
      <button type="button" className="boton boton--primario boton--ancho codigos__seguir" onClick={seguir} disabled={!guardados || saliendo}>
        {saliendo ? <Girando /> : p.botonFinal}
      </button>
      {!guardados && <p className="codigos__ayuda">Marcá «Ya los guardé» para seguir.</p>}
    </section>
  )
}
