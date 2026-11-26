// Estado de la capa del celular: qué hoja está abierta y en qué lista está el paginado del Kanban. Lo del tablero sigue
// en la tienda de siempre (estado/tienda.ts), que el celular usa tal cual.
import { create } from 'zustand'

export type HojaMovil = null | 'tableros' | 'buscar' | 'mas' | 'filtros' | 'compositor' | 'crear' | 'instalar' | 'pendientes' | 'notificaciones' | 'ia' | 'amigos'

interface EstadoMovil {
  hoja: HojaMovil
  /** La lista que se ve en el paginado del Kanban (la marca la tira de listas). */
  listaVisible: string | null
  /** Texto con el que se abre el compositor rápido (compartir hacia Telar, accesos directos). */
  textoInicial: string
  /** Dónde se dibuja la tira de listas (debajo de la barra en vertical; dentro de ella en horizontal). */
  ranuraTira: HTMLElement | null
  abrir: (h: Exclude<HojaMovil, null>, textoInicial?: string) => void
  cerrar: () => void
}

export const useMovil = create<EstadoMovil>((set) => ({
  hoja: null,
  listaVisible: null,
  textoInicial: '',
  ranuraTira: null,
  abrir: (hoja, textoInicial = '') => set({ hoja, textoInicial }),
  cerrar: () => set({ hoja: null }),
}))
