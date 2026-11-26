// «Restablecer contraseña» de un amigo (Configuración → Amigos): para el amigo que olvidó la suya y no tiene sus códigos de recuperación (no hay
// servicio de mail). El dueño genera un enlace de un solo uso que vence a las 24 horas y se lo manda por WhatsApp; el amigo lo abre y
// escribe SU contraseña nueva. La pantalla lo dice sin vueltas: el dueño NUNCA ve ni elige la contraseña del amigo.
//   · Se abre en el lugar, como «Invitar a un amigo» (PanelInvitar): anda igual en la PC y en la hoja «Amigos» del celular.
//   · El enlace se muestra UNA vez (la lista nunca tiene tokens): Copiar enlace, Compartir (si el navegador sabe) o, si se perdió,
//     «Cancelar enlace» y crear otro. Crear uno nuevo reemplaza al anterior.
// Estados: confirmando, creando, enlace listo, error.
import { Check, Copy, Link2, ShieldCheck, Share2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type Amigo } from '../../../estado/api'
import { avisar } from '../../../estado/avisos'
import { Girando } from '../../../ui/comunes'
import { copiarTexto } from '../../../util/portapapeles'

export function PanelRestablecer({ amigo, alCambiar, alCerrar }: { amigo: Amigo; alCambiar: () => void; alCerrar: () => void }) {
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState('')
  const [creado, setCreado] = useState<{ enlace: string } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const campoEnlace = useRef<HTMLInputElement>(null)
  const raiz = useRef<HTMLDivElement>(null)
  const puedeCompartir = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const suspendida = amigo.estado === 'suspendida'

  useEffect(() => {
    raiz.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [creado])

  async function crear() {
    if (creando) return
    setError('')
    setCreando(true)
    try {
      const r = await api.restablecerAmigo(amigo.id)
      setCreado({ enlace: r.enlace })
      alCambiar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el enlace.')
    } finally {
      setCreando(false)
    }
  }

  async function copiar() {
    if (!creado) return
    const ok = await copiarTexto(creado.enlace, campoEnlace.current)
    setCopiado(ok)
    avisar(ok ? { texto: 'Enlace copiado', tipo: 'ok', duracion: 2200 } : { texto: 'No pude copiarlo solo: mantené apretado el enlace y copialo.', tipo: 'error' })
    if (ok) setTimeout(() => setCopiado(false), 2400)
  }

  async function compartir() {
    if (!creado) return
    try {
      await navigator.share({
        title: 'Tu contraseña nueva de Telar',
        text: `Hola ${amigo.nombre}, con este enlace ponés una contraseña nueva en Telar (sirve una sola vez y vence en 24 horas):`,
        url: creado.enlace,
      })
    } catch {
      // cerrar la hoja de compartir no es un error
    }
  }

  if (creado)
    return (
      <div ref={raiz} className="amigos-restablecer" role="group" aria-label={`Enlace para que ${amigo.nombre} restablezca su contraseña`}>
        <p className="amigos-panel__titulo">
          <Link2 size={15} aria-hidden /> Enlace listo para {amigo.nombre}
        </p>
        <input ref={campoEnlace} className="campo amigos-enlace" readOnly value={creado.enlace} aria-label="Enlace para restablecer la contraseña" onFocus={(e) => e.currentTarget.select()} />
        <p className="amigos-panel__aviso" role="status">
          El enlace se muestra solo ahora. Sirve una sola vez y vence en 24 horas. Si lo perdés, cancelalo y creá otro.
        </p>
        <div className="amigos-botones">
          <button type="button" className="boton boton--primario" onClick={copiar}>
            {copiado ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copiado ? 'Copiado' : 'Copiar enlace'}
          </button>
          {puedeCompartir && (
            <button type="button" className="boton" onClick={compartir}>
              <Share2 size={15} aria-hidden /> Compartir
            </button>
          )}
          <button type="button" className="boton boton--fantasma" onClick={alCerrar}>
            Listo
          </button>
        </div>
      </div>
    )

  return (
    <div ref={raiz} className="amigos-restablecer" role="group" aria-label={`Restablecer la contraseña de ${amigo.nombre}`}>
      <p className="amigos-restablecer__honesto">
        <ShieldCheck size={14} aria-hidden />
        <span>Vos no ves ni elegís la contraseña de {amigo.nombre}: la escribe él cuando abre el enlace.</span>
      </p>
      <p>
        Creo un enlace que sirve una sola vez y vence en 24 horas. Mandáselo por WhatsApp. Cuando lo use, se cierran sus otras sesiones y vas a ver
        el aviso en la campana.
        {amigo.restablecimiento ? ' Como ya hay uno pendiente, este lo reemplaza.' : ''}
      </p>
      {suspendida && <p className="amigos-error">{amigo.nombre} está suspendido: reactivalo primero y después restablecé su contraseña.</p>}
      {error && (
        <p className="amigos-error" role="alert">
          {error}
        </p>
      )}
      <div className="amigos-botones">
        <button type="button" className="boton" onClick={alCerrar} disabled={creando}>
          Cancelar
        </button>
        <button type="button" className="boton boton--primario" onClick={crear} disabled={creando || suspendida}>
          {creando ? <Girando tam={13} /> : <Link2 size={15} aria-hidden />} Crear enlace
        </button>
      </div>
    </div>
  )
}
