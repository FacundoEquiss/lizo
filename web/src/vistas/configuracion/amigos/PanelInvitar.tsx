// «Invitar a un amigo» (Configuración → Amigos): una nota, cuántas personas pueden usar el enlace y cuándo vence, con los valores de
// fábrica ya puestos (1 persona, 7 días): un solo clic crea. Después muestra el enlace, que se ve SOLO ahora: se copia, se comparte
// (si el navegador sabe) o, si se perdió, se revoca la invitación y se crea otra. No es un diálogo aparte: se abre en el lugar, así
// anda igual en la PC y en la hoja del celular (como los formularios de Configuración → IA).
import { Check, Copy, Link2, Share2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type Invitacion } from '../../../estado/api'
import { avisar } from '../../../estado/avisos'
import { Girando, Segmentado } from '../../../ui/comunes'
import { copiarTexto } from '../../../util/portapapeles'

const USOS = [
  { id: 1, nombre: '1 persona' },
  { id: 5, nombre: '5 personas' },
  { id: 10, nombre: '10 personas' },
]
const VENCE = [
  { id: 1, nombre: '1 día' },
  { id: 7, nombre: '7 días' },
  { id: 30, nombre: '30 días' },
]
const MAX_NOTA = 60

export { copiarTexto }

export function PanelInvitar({ alCrear, alCerrar }: { alCrear: (i: Invitacion) => void; alCerrar: () => void }) {
  const [nota, setNota] = useState('')
  const [usos, setUsos] = useState(1)
  const [venceDias, setVenceDias] = useState(7)
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState('')
  const [creada, setCreada] = useState<{ invitacion: Invitacion; enlace: string } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const campoEnlace = useRef<HTMLInputElement>(null)
  const raiz = useRef<HTMLDivElement & HTMLFormElement>(null)
  const puedeCompartir = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    raiz.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [creada])

  async function crear(e: FormEvent) {
    e.preventDefault()
    if (creando) return
    setError('')
    setCreando(true)
    try {
      const r = await api.crearInvitacion({ nota: nota.trim() || undefined, usos, venceDias })
      setCreada(r)
      alCrear(r.invitacion)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la invitación.')
    } finally {
      setCreando(false)
    }
  }

  async function copiar() {
    if (!creada) return
    const ok = await copiarTexto(creada.enlace, campoEnlace.current)
    setCopiado(ok)
    avisar(ok ? { texto: 'Enlace copiado', tipo: 'ok', duracion: 2200 } : { texto: 'No pude copiarlo solo: mantené apretado el enlace y copialo.', tipo: 'error' })
    if (ok) setTimeout(() => setCopiado(false), 2400)
  }

  async function compartir() {
    if (!creada) return
    try {
      await navigator.share({ title: 'Invitación a Telar', text: 'Te invito a Telar', url: creada.enlace })
    } catch {
      // cerrar la hoja de compartir no es un error
    }
  }

  if (creada)
    return (
      <div ref={raiz} className="amigos-panel" role="group" aria-label="Tu enlace de invitación">
        <p className="amigos-panel__titulo">
          <Link2 size={15} aria-hidden /> Enlace listo
        </p>
        <input
          ref={campoEnlace}
          className="campo amigos-enlace"
          readOnly
          value={creada.enlace}
          aria-label="Enlace de invitación"
          onFocus={(e) => e.currentTarget.select()}
        />
        <p className="amigos-panel__aviso" role="status">
          El enlace se muestra solo ahora. Si lo perdés, revocá esta invitación y creá otra.
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
    <form ref={raiz} className="amigos-panel" onSubmit={crear} aria-label="Invitar a un amigo">
      <label className="campo-etiquetado" htmlFor="amigos-nota">
        Nota (opcional)
        <input
          id="amigos-nota"
          className="campo"
          type="text"
          maxLength={MAX_NOTA}
          placeholder="Para quién es: «para Pablo»"
          autoComplete="off"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />
        <small>Solo la ves vos, para acordarte a quién se la diste.</small>
      </label>
      <div className="amigos-opcion">
        <span id="amigos-usos">Cuántas personas pueden abrir este enlace</span>
        <Segmentado opciones={USOS} valor={usos} alCambiar={setUsos} etiqueta="Cuántas personas pueden abrir este enlace" />
      </div>
      <div className="amigos-opcion">
        <span id="amigos-vence">El enlace deja de servir en</span>
        <Segmentado opciones={VENCE} valor={venceDias} alCambiar={setVenceDias} etiqueta="El enlace deja de servir en" />
      </div>
      <p className="amigos-aclaracion">
        Lo que vence es solo el enlace, si tu amigo no lo abre a tiempo. Su cuenta, una vez creada, es suya y no vence.
      </p>
      {error && (
        <p className="amigos-error" role="alert">
          {error}
        </p>
      )}
      <div className="amigos-botones">
        <button type="submit" className="boton boton--primario" disabled={creando}>
          {creando ? <Girando /> : <Link2 size={15} aria-hidden />} Crear enlace
        </button>
        <button type="button" className="boton boton--fantasma" onClick={alCerrar} disabled={creando}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
