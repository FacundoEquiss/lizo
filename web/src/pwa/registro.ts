// Registro del service worker y versiones nuevas (plan del celular, 9.5).
//   · Solo en la versión compilada (en npm run dev no hay service worker).
//   · Se busca versión nueva al volver a la app (si pasaron 30 minutos), cada 60 minutos con la app abierta y con
//     "Buscar actualización" (una app instalada puede pasar días abierta sin navegar; el navegador solo revisa al navegar).
//   · Si la app recién se abrió (menos de 4 s y sin tocar nada), la versión nueva se activa sola y se recarga: nadie
//     perdió nada. Si ya se está usando, aparece la pastilla "Hay una versión nueva" (puede haber algo a medio escribir).
//   · Nunca recarga sola más de una vez cada 30 s (protección contra ciclos).
import { avisar } from '../estado/avisos'
import { usePwa } from './estado'

const MINUTO = 60_000
const CLAVE_RECARGA = 'telar.recargo'
let registro: ServiceWorkerRegistration | null = null
let ultimaRevision = Date.now()
const abiertaEn = Date.now()
let usada = false
let pedimosActualizar = false
let habiaControlador = false

function puedeRecargarSola() {
  try {
    const antes = Number(sessionStorage.getItem(CLAVE_RECARGA) || 0)
    if (Date.now() - antes < 30_000) return false
    sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()))
    return true
  } catch {
    return false
  }
}

/** Hay un service worker nuevo instalado y esperando. */
function hayEspera(nuevo: ServiceWorker) {
  if (!usada && Date.now() - abiertaEn < 4000 && puedeRecargarSola()) {
    pedimosActualizar = true
    nuevo.postMessage({ tipo: 'ACTIVAR' })
    return
  }
  usePwa.setState({ actualizacion: 'esperando' })
}

function vigilar(reg: ServiceWorkerRegistration) {
  if (reg.waiting && navigator.serviceWorker.controller) hayEspera(reg.waiting)
  reg.addEventListener('updatefound', () => {
    const nuevo = reg.installing
    nuevo?.addEventListener('statechange', () => {
      // Instalado con otro controlando la página: es una actualización (la primera instalación no avisa nada).
      if (nuevo.state === 'installed' && navigator.serviceWorker.controller) hayEspera(nuevo)
    })
  })
}

export async function buscarActualizacion(manual = false): Promise<void> {
  ultimaRevision = Date.now()
  if (!registro) {
    if (manual) avisar({ texto: 'Las actualizaciones se buscan solas en la app publicada.' })
    return
  }
  try {
    await registro.update()
    if (manual && !registro.installing && !registro.waiting) avisar({ texto: 'Tenés la última versión.', tipo: 'ok', duracion: 2200 })
    if (manual && registro.installing) avisar({ texto: 'Hay una versión nueva: se está bajando…', duracion: 2200 })
  } catch {
    if (manual) avisar({ texto: 'Sin conexión: no pude buscar la versión nueva.', tipo: 'error' })
  }
}

/** "Actualizar": activa la versión que espera; al tomar el control, se recarga. */
export function actualizar() {
  const espera = registro?.waiting
  if (!espera) return location.reload()
  pedimosActualizar = true
  usePwa.setState({ actualizacion: 'actualizando' })
  espera.postMessage({ tipo: 'ACTIVAR' })
}

/** La versión del service worker que controla la página (para mostrarla en el menú). */
export function versionInstalada(): Promise<string | null> {
  const sw = navigator.serviceWorker?.controller
  if (!sw) return Promise.resolve(null)
  return new Promise((ok) => {
    const canal = new MessageChannel()
    const reloj = setTimeout(() => ok(null), 1500)
    canal.port1.onmessage = (e) => {
      clearTimeout(reloj)
      ok((e.data as { version?: string } | null)?.version ?? null)
    }
    sw.postMessage({ tipo: 'VERSION' }, [canal.port2])
  })
}

export function iniciarPwa() {
  // Un archivo viejo que ya no existe (se publicó una versión nueva con la app abierta): se ofrece recargar.
  addEventListener('vite:preloadError', (e) => {
    e.preventDefault()
    usePwa.setState({ actualizacion: 'recargar', actualizacionEscondida: false })
  })
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  habiaControlador = !!navigator.serviceWorker.controller
  for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => (usada = true), { once: true, capture: true })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (pedimosActualizar) return location.reload()
    // Otra pestaña actualizó: acá se ofrece recargar (no se recarga sola: puede haber algo a medio escribir).
    if (habiaControlador) usePwa.setState({ actualizacion: 'recargar', actualizacionEscondida: false })
    habiaControlador = true
  })

  const registrar = async () => {
    try {
      registro = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      vigilar(registro)
    } catch (e) {
      console.warn('[telar] no pude registrar el service worker', e)
    }
  }
  if (document.readyState === 'complete') registrar()
  else addEventListener('load', registrar, { once: true })

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - ultimaRevision > 30 * MINUTO) buscarActualizacion()
  })
  setInterval(() => {
    if (!document.hidden) buscarActualizacion()
  }, 60 * MINUTO)
}
