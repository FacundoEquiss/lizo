import { create } from 'zustand'
import type { Actor } from '../../../compartido/tipos'

export interface Aviso {
  id: number
  texto: string
  tipo: 'info' | 'error' | 'ia' | 'ok'
  actor?: Actor
  accion?: { etiqueta: string; fn: () => void }
  duracion: number
}

interface EstadoAvisos {
  avisos: Aviso[]
  avisar: (a: Partial<Aviso> & { texto: string }) => number
  quitar: (id: number) => void
}

let siguiente = 1

export const useAvisos = create<EstadoAvisos>((set, get) => ({
  avisos: [],
  avisar: (a) => {
    const id = siguiente++
    const aviso: Aviso = { tipo: 'info', duracion: a.accion ? 6500 : 4200, ...a, id }
    set({ avisos: [...get().avisos.slice(-3), aviso] })
    if (aviso.duracion > 0) setTimeout(() => get().quitar(id), aviso.duracion)
    return id
  },
  quitar: (id) => set({ avisos: get().avisos.filter((x) => x.id !== id) }),
}))

export const avisar = (a: Partial<Aviso> & { texto: string }) => useAvisos.getState().avisar(a)
export const avisarError = (e: unknown) =>
  avisar({ texto: e instanceof Error ? e.message : String(e), tipo: 'error', duracion: 6000 })
