// Instalar Telar (plan del celular, 9.7).
//   · Android y Chrome/Edge de escritorio: se atrapa beforeinstallprompt y se muestra el cartel del sistema cuando la
//     persona toca "Instalar" (Chrome exige que venga de un toque).
//   · iOS no tiene ese evento: se muestran los pasos (Compartir → Agregar a inicio → Agregar), según el navegador.
//   · Una invitación, una sola vez: en la segunda visita o a los 3 minutos de la primera, nunca con una hoja abierta ni
//     escribiendo. "Ahora no" la guarda 30 días. Un cartel antes de usar la app se cierra por reflejo.
import { avisar } from '../estado/avisos'
import { esInstalada, esIOS } from '../movil/detectar'
import { usePwa } from './estado'

interface EventoInstalar extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const VISTO = 'telar.instalar.visto'
const VISITAS = 'telar.visitas'
const TREINTA_DIAS = 30 * 24 * 3600 * 1000
let evento: EventoInstalar | null = null

export type Navegador = 'android' | 'safari' | 'ios-otro' | 'ios-dentro-de-app' | 'otro'

/** Qué navegador es, para explicar cómo instalar. */
export function navegador(): Navegador {
  const ua = navigator.userAgent
  if (esIOS()) {
    if (/FBAN|FBAV|Instagram|Line\/|Discord|Twitter|WhatsApp|GSA\//.test(ua)) return 'ios-dentro-de-app'
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 'ios-otro'
    return 'safari'
  }
  if (evento) return 'android'
  return 'otro'
}

export const puedeInstalar = () => !esInstalada() && (!!evento || esIOS())

/** El cartel del sistema (Android, Chrome, Edge). En iOS devuelve false: hay que mostrar los pasos. */
export async function instalar(): Promise<boolean> {
  if (!evento) return false
  const e = evento
  await e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') {
    evento = null
    usePwa.setState({ instalable: false })
  }
  return true
}

/** ¿Toca mostrar la invitación? */
export function tocaInvitar(): boolean {
  if (!puedeInstalar()) return false
  try {
    const visto = Number(localStorage.getItem(VISTO) || 0)
    if (Date.now() - visto < TREINTA_DIAS) return false
    return Number(localStorage.getItem(VISITAS) || 0) >= 2
  } catch {
    return false
  }
}

export function noAhora() {
  try {
    localStorage.setItem(VISTO, String(Date.now()))
  } catch {}
}

export function iniciarInstalar() {
  try {
    localStorage.setItem(VISITAS, String(Number(localStorage.getItem(VISITAS) || 0) + 1))
  } catch {}
  usePwa.setState({ instalada: esInstalada(), instalable: esIOS() && !esInstalada() })
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    evento = e as EventoInstalar
    usePwa.setState({ instalable: true })
  })
  addEventListener('appinstalled', () => {
    evento = null
    usePwa.setState({ instalable: false, instalada: true })
    avisar({ texto: 'Telar quedó instalada', tipo: 'ok' })
  })
  // A los 3 minutos de uso de la primera visita también se invita (si nunca se dijo "Ahora no").
  setTimeout(() => {
    try {
      if (Number(localStorage.getItem(VISITAS) || 0) < 2) localStorage.setItem(VISITAS, '2')
    } catch {}
    usePwa.setState({})
  }, 3 * 60_000)
}
