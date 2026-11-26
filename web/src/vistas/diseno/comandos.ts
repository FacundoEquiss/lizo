// Comandos de Diseño para la paleta (Ctrl/⌘+K, plan 6.9): la vista los publica mientras está abierta (cada página por su
// nombre, "Marco nuevo: historia de Instagram", "Exportar…", "Pedir sincronización") y la paleta los muestra. Módulo
// chiquito y sin dependencias: la paleta lo usa sin cargar el resto de Diseño.
import { useSyncExternalStore } from 'react'

export interface ComandoDiseno {
  id: string
  etiqueta: string
  /** Palabras extra para la búsqueda. */
  buscar?: string
  atajo?: string
  accion: () => void
}

let lista: ComandoDiseno[] = []
const oyentes = new Set<() => void>()

export function publicarComandosDiseno(c: ComandoDiseno[]) {
  lista = c
  for (const o of oyentes) o()
}

export function useComandosDiseno(): ComandoDiseno[] {
  return useSyncExternalStore(
    (cb) => {
      oyentes.add(cb)
      return () => {
        oyentes.delete(cb)
      }
    },
    () => lista,
  )
}
