// Estado de la interfaz del lienzo que comparten sus piezas (barra contextual, paneles, menús, la capa del celular).
// Lo que es del tablero (objetos, conectores) vive en la tienda; esto es solo lo de la pantalla: selección, qué se está
// haciendo con el mouse y qué panel está abierto. No registra pasos de deshacer.
import { create } from 'zustand'
import type { Lado } from '../../../../compartido/tipos'

export type Interaccion = 'arrastre' | 'redimension' | 'movimiento' | null

export interface ConexionPendiente {
  desdeId: string
  desdeLado: Lado | null
  /** Punto del lienzo donde se soltó (coordenadas del lienzo). */
  punto: { x: number; y: number }
  /** Lado del objeto nuevo que mira al origen. */
  ladoLlegada: Lado
}

export interface MenuContextualAbierto {
  /** Coordenadas de pantalla. */
  x: number
  y: number
  /** Sobre un objeto (o una selección) o sobre el vacío. */
  sobre: 'objeto' | 'vacio'
  /** Punto del lienzo (para "Nota acá", "Pegar acá"). */
  punto: { x: number; y: number }
}

interface EstadoLienzo {
  seleccion: { nodos: string[]; conectores: string[] }
  interaccion: Interaccion
  /** Se está arrastrando un conector desde un punto de conexión. */
  conectando: boolean
  /** Con la herramienta Conector: el objeto de origen ya elegido. */
  origenConexion: string | null
  panelTarjetas: boolean
  panelMarcos: boolean
  buscando: boolean
  /** La tabla o el gráfico que se está abriendo para editar sus datos (id del objeto). */
  tablaAbierta: string | null
  graficoAbierto: string | null
  conexionPendiente: ConexionPendiente | null
  menuContextual: MenuContextualAbierto | null
  /** Etiqueta de un conector que se está editando. */
  etiquetaEditando: string | null
  /** Imágenes subiéndose: el rectángulo del tamaño final que se ve mientras tanto (coordenadas del lienzo). */
  subidas: { id: string; x: number; y: number; ancho: number; alto: number }[]
  setSeleccion: (nodos: string[], conectores: string[]) => void
  setInteraccion: (i: Interaccion) => void
  set: (p: Partial<Omit<EstadoLienzo, 'set' | 'setSeleccion' | 'setInteraccion'>>) => void
}

const iguales = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export const useLienzo = create<EstadoLienzo>((set, get) => ({
  seleccion: { nodos: [], conectores: [] },
  interaccion: null,
  conectando: false,
  origenConexion: null,
  panelTarjetas: false,
  panelMarcos: false,
  buscando: false,
  tablaAbierta: null,
  graficoAbierto: null,
  conexionPendiente: null,
  menuContextual: null,
  etiquetaEditando: null,
  subidas: [],
  setSeleccion(nodos, conectores) {
    const s = get().seleccion
    if (iguales(s.nodos, nodos) && iguales(s.conectores, conectores)) return
    set({ seleccion: { nodos, conectores } })
  },
  setInteraccion(interaccion) {
    if (get().interaccion !== interaccion) set({ interaccion })
  },
  set: (p) => set(p),
}))
