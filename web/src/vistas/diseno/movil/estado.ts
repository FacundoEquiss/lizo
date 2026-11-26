// Estado de Diseño en el celular: qué marco está abierto a pantalla completa, en qué modo está el visor y qué hoja se ve.
// Lo del proyecto (páginas, marcos, ítems, comentarios en vivo) sigue en la tienda de Diseño de siempre (../estado.ts),
// que el celular usa tal cual.
import { create } from 'zustand'

export type HojaDiseno =
  /** La lista de marcos de la página. */
  | { tipo: 'marcos' }
  /** Mantener apretado un marco del lienzo. */
  | { tipo: 'menu'; marco: string }
  /** Los comentarios de un marco; `hilo` lo resalta; `punto` es el lugar marcado para uno nuevo. */
  | { tipo: 'comentarios'; marco: string; hilo?: string; punto?: PuntoComentario }
  | { tipo: 'compartir'; marco: string }
  | { tipo: 'detalles'; marco: string }
  /** Un ítem del sistema ("token:color/marca/primario"). */
  | { tipo: 'item'; clave: string }
  /** Cambiar un texto de un marco propio. */
  | { tipo: 'texto'; marco: string; capa: string }
  /** Lo que se tocó en modo Inspeccionar. */
  | { tipo: 'capa'; marco: string; capa: string | null }

export interface PuntoComentario {
  x: number
  y: number
  capa: string | null
}

/** ver: mirar · comentar: el próximo toque marca el punto · textos: tocar un texto lo cambia · inspeccionar: medidas y estilos. */
export type ModoVisor = 'ver' | 'comentar' | 'textos' | 'inspeccionar'

interface EstadoDisenoMovil {
  /** Marco abierto a pantalla completa. */
  visor: string | null
  modo: ModoVisor
  hoja: HojaDiseno | null
  /** La capa resaltada en el visor (la que se está inspeccionando o editando). */
  resaltada: string | null
  /** Punto marcado para un comentario nuevo (se dibuja como un pin sin número). */
  borrador: PuntoComentario | null
  abrirVisor: (marco: string, hoja?: HojaDiseno | null) => void
  cerrarVisor: () => void
  setModo: (m: ModoVisor) => void
  abrirHoja: (h: HojaDiseno) => void
  cerrarHoja: () => void
  set: (p: Partial<EstadoDisenoMovil>) => void
}

export const useDisenoMovil = create<EstadoDisenoMovil>((set) => ({
  visor: null,
  modo: 'ver',
  hoja: null,
  resaltada: null,
  borrador: null,
  abrirVisor: (visor, hoja = null) => set({ visor, hoja, modo: 'ver', resaltada: null, borrador: null }),
  cerrarVisor: () => set({ visor: null, modo: 'ver', resaltada: null, borrador: null }),
  setModo: (modo) => set({ modo, resaltada: null, borrador: null }),
  abrirHoja: (hoja) => set({ hoja }),
  cerrarHoja: () => set({ hoja: null }),
  set: (p) => set(p),
}))
