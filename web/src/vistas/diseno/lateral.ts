// La barra lateral de Telar se pliega sola en Diseño (plan 6.1): con la lateral, el panel de capas y el inspector, al lienzo
// le quedaría menos de la mitad de una pantalla de 1440. La tecla [ la sigue abriendo; lo que se elija en Diseño se guarda
// aparte (de fábrica, plegada) y al salir la lateral vuelve como estaba. Módulo chiquito: lo usa App.tsx sin cargar Diseño.
const CLAVE = 'telar.diseno.lateral'

export function lateralEnDiseno(): boolean {
  try {
    return localStorage.getItem(CLAVE) === 'si'
  } catch {
    return false
  }
}

export function guardarLateralEnDiseno(abierta: boolean) {
  try {
    localStorage.setItem(CLAVE, abierta ? 'si' : 'no')
  } catch {
    // sin almacenamiento: no se recuerda
  }
}
