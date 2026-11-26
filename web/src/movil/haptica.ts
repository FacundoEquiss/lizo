// Vibración corta para confirmar gestos (plan del celular, 3.6). Solo existe en Android: en iPhone la web no tiene API de
// vibración y la respuesta es visual (la tarjeta se agranda al despegarse). Nunca es el único aviso de algo.
export type Vibracion = 'toque' | 'agarre' | 'cruce' | 'suelta' | 'menu' | 'cambio' | 'error'

const PATRONES: Record<Vibracion, number | number[]> = {
  toque: 5, // marcar un ítem
  agarre: 10, // la tarjeta se despega
  cruce: 5, // la tarjeta pasa a otra lista
  suelta: 8, // soltar
  menu: 8, // menú por mantener apretado
  cambio: 8, // algo se creó o cambió (tarjeta creada)
  error: [20, 40, 20], // no se pudo guardar
}

const CLAVE = 'telar.vibracion'

export const vibracionDisponible = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

export function vibracionEncendida(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== 'no'
  } catch {
    return true
  }
}

export function setVibracion(encendida: boolean) {
  try {
    localStorage.setItem(CLAVE, encendida ? 'si' : 'no')
  } catch {}
}

export function vibrar(tipo: Vibracion) {
  if (!vibracionDisponible() || !vibracionEncendida()) return
  try {
    navigator.vibrate(PATRONES[tipo])
  } catch {}
}
