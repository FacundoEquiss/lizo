// Preferencias de ESTE dispositivo (densidad, movimiento, estilos de fábrica, avisos ya vistos…), guardadas en el
// navegador bajo `telar.preferencias`. Lo que describe al tablero (fondo, grilla, imanes) va en el tablero
// (tableros.ajustes), así se ve igual en la PC y en el celular.
//
// Las claves viejas no se mudan: `tablero.tema`, `tablero.lateral`, `tablero.minimapa`, `tablero.grilla`,
// `tablero.rueda` y `tablero.vista.<id>` siguen como estaban (index.html lee `tablero.tema` antes de pintar).
import { create } from 'zustand'
import { ESTILOS_FABRICA, esColor, type Estilo, type EstilosFabrica } from '../../../compartido/lienzo'

export type Densidad = 'comoda' | 'compacta'
export type Movimiento = 'sistema' | 'reducido' | 'completo'
export type ModoRueda = 'auto' | 'mouse' | 'trackpad'

export interface Preferencias {
  v: 1
  densidad: Densidad
  movimiento: Movimiento
  /** El cartel de arriba que dice qué hace cada herramienta. */
  avisoHerramientas: boolean
  /** V, N, T…: se pueden apagar para lector de pantalla o dictado. */
  atajosDeUnaTecla: boolean
  /** Cada objeto nuevo sale como el último que se tocó. */
  recordarEstilo: boolean
  estilos: EstilosFabrica
  /** Avisos que ya se mostraron una vez (por ejemplo, la primera tarjeta traída al lienzo). */
  vistos: Record<string, boolean>
  portapapelesEstilo: Estilo | null
  /** Proyectos plegados en la barra lateral (ids). */
  proyectosPlegados: string[]
  /** Lugar para que el celular guarde lo suyo sin pisar nada. */
  movil?: Record<string, unknown>
}

interface Acciones {
  cambiar: (p: Partial<Omit<Preferencias, 'v'>>) => void
  /** Cambia el estilo de fábrica de un tipo (lo usa la Configuración y, con "recordar", cada cambio de estilo). */
  cambiarEstilo: <K extends keyof EstilosFabrica>(tipo: K, cambios: Partial<EstilosFabrica[K]>) => void
  /** Con "Recordar el último estilo" prendido, lo que se elige en un objeto queda de fábrica para el próximo. */
  recordar: <K extends keyof EstilosFabrica>(tipo: K, cambios: Partial<EstilosFabrica[K]>) => void
  volverAFabrica: () => void
  marcarVisto: (clave: string) => void
  /** La rueda del mouse (clave vieja `tablero.rueda`). */
  rueda: ModoRueda
  setRueda: (m: ModoRueda) => void
}

const CLAVE = 'telar.preferencias'

const DE_FABRICA: Preferencias = {
  v: 1,
  densidad: 'comoda',
  movimiento: 'sistema',
  avisoHerramientas: true,
  atajosDeUnaTecla: true,
  recordarEstilo: true,
  estilos: ESTILOS_FABRICA,
  vistos: {},
  portapapelesEstilo: null,
  proyectosPlegados: [],
}

function leer(): Preferencias {
  let guardado: Partial<Preferencias> | null = null
  try {
    guardado = JSON.parse(localStorage.getItem(CLAVE) ?? 'null')
  } catch {
    guardado = null
  }
  const p: Preferencias = { ...DE_FABRICA, ...(guardado?.v === 1 ? guardado : {}), v: 1 }
  p.estilos = {
    nota: { ...ESTILOS_FABRICA.nota, ...p.estilos?.nota },
    texto: { ...ESTILOS_FABRICA.texto, ...p.estilos?.texto },
    forma: { ...ESTILOS_FABRICA.forma, ...p.estilos?.forma },
    marco: { ...ESTILOS_FABRICA.marco, ...p.estilos?.marco },
    conector: { ...ESTILOS_FABRICA.conector, ...p.estilos?.conector },
  }
  // La 0.1 guardaba el último color de nota suelto: se lee una vez para sembrar el de fábrica.
  if (!guardado) {
    const viejo = localStorage.getItem('tablero.colorNota')
    if (esColor(viejo)) p.estilos.nota = { ...p.estilos.nota, color: viejo }
  }
  return p
}

function guardar(p: Preferencias) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(p))
  } catch {
    // sin lugar o sin permiso: queda solo en memoria
  }
}

/** Atributos de <html> que dependen de las preferencias (densidad y movimiento). */
export function aplicarPreferencias(p: Pick<Preferencias, 'densidad' | 'movimiento'>) {
  const html = document.documentElement
  if (p.densidad === 'compacta') html.dataset.densidad = 'compacta'
  else delete html.dataset.densidad
  if (p.movimiento === 'sistema') delete html.dataset.movimiento
  else html.dataset.movimiento = p.movimiento
}

const soloDatos = (s: Preferencias & Acciones): Preferencias => {
  const { cambiar: _c, cambiarEstilo: _ce, recordar: _r, volverAFabrica: _v, marcarVisto: _m, rueda: _ru, setRueda: _sr, ...datos } = s
  return datos
}

export const usePreferencias = create<Preferencias & Acciones>((set, get) => ({
  ...leer(),
  rueda: (localStorage.getItem('tablero.rueda') as ModoRueda | null) ?? 'auto',

  cambiar(cambios) {
    set(cambios)
    guardar(soloDatos(get()))
    if ('densidad' in cambios || 'movimiento' in cambios) aplicarPreferencias(get())
  },
  cambiarEstilo(tipo, cambios) {
    const estilos = { ...get().estilos, [tipo]: { ...get().estilos[tipo], ...cambios } }
    set({ estilos })
    guardar(soloDatos(get()))
  },
  recordar(tipo, cambios) {
    if (!get().recordarEstilo) return
    // La opacidad es de ese objeto (un fondo tenue, algo a medio hacer): la forma siguiente no sale transparente.
    // El ícono y el título adentro del marco también son de ese objeto: no se «recuerdan» para los nuevos.
    const { opacidad: _o, icono: _i, iconoPosicion: _p, tituloEn: _t, ...resto } = cambios as Record<string, unknown>
    if (!Object.keys(resto).length) return
    get().cambiarEstilo(tipo, resto as typeof cambios)
  },
  volverAFabrica() {
    set({ estilos: ESTILOS_FABRICA })
    guardar(soloDatos(get()))
  },
  marcarVisto(clave) {
    if (get().vistos[clave]) return
    set({ vistos: { ...get().vistos, [clave]: true } })
    guardar(soloDatos(get()))
  },
  setRueda(rueda) {
    localStorage.setItem('tablero.rueda', rueda)
    set({ rueda })
  },
}))

aplicarPreferencias(usePreferencias.getState())
