// Tienda chica de la PWA (plan del celular, 2.2): versión nueva esperando, si se puede instalar, si hay conexión y desde
// cuándo es lo que se está viendo sin conexión. Vive fuera de movil/ porque la PWA también se instala en la computadora.
import { create } from 'zustand'

export type EstadoActualizacion = null | 'esperando' | 'actualizando' | 'recargar'

interface EstadoPwa {
  /** Hay una versión nueva lista: 'esperando' (pastilla), 'actualizando' (se tocó), 'recargar' (otra pestaña actualizó). */
  actualizacion: EstadoActualizacion
  /** Se escondió la pastilla de versión nueva hasta la próxima vez que se abra la app. */
  actualizacionEscondida: boolean
  /** Chrome y Edge ofrecen instalar (beforeinstallprompt). En iOS no existe: se muestran los pasos. */
  instalable: boolean
  instalada: boolean
  enLinea: boolean
  /** Si se está viendo lo guardado sin conexión: desde cuándo es (ISO). */
  instantanea: string | null
  /** No pudo arrancar: sin red y sin nada guardado ("Telar necesita conexión la primera vez") u otro error. */
  falloInicio: null | { sinRed: boolean; mensaje: string }
}

export const usePwa = create<EstadoPwa>(() => ({
  actualizacion: null,
  actualizacionEscondida: false,
  instalable: false,
  instalada: false,
  enLinea: typeof navigator === 'undefined' ? true : navigator.onLine,
  instantanea: null,
  falloInicio: null,
}))

if (typeof window !== 'undefined') {
  addEventListener('online', () => usePwa.setState({ enLinea: true }))
  addEventListener('offline', () => usePwa.setState({ enLinea: false }))
}

export const useConexion = () => usePwa((s) => s.enLinea)

// Para las capturas de verificación (scripts/capturas-movil.mjs, la pastilla de versión nueva): solo en npm run dev; en la
// versión compilada esta línea no existe.
if (import.meta.env.DEV && typeof window !== 'undefined') Object.assign(window, { __telarPwa: usePwa })
