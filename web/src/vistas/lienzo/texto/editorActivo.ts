// El editor de texto que está abierto (hay uno solo a la vez). Lo usan la barra contextual (para mandarle comandos y
// mostrar qué está activo) y la nota (para ajustar la letra mientras se escribe). Vive fuera del trozo de TipTap.
import type { Editor } from '@tiptap/core'
import { create } from 'zustand'
import type { DocRico } from '../../../../../compartido/rico'
import { useTienda } from '../../../estado/tienda'

interface EditorActivo {
  id: string | null
  editor: Editor | null
  /** El documento mientras se escribe (las notas ajustan la letra con esto). */
  doc: DocRico | null
  /** Cambia en cada transacción: la barra se vuelve a dibujar para mostrar qué formato está activo. */
  version: number
  /** Teclas que se escribieron antes de que el editor tuviera el foco (empezar a escribir con el objeto seleccionado). */
  pendiente: string
  /** Ctrl/⌘ + K adentro del editor: la barra abre el campo del enlace. */
  pedirEnlace: boolean
  /** false: el editor usa una barra propia (el celular) y la barra contextual no se muestra mientras se escribe. */
  barra: boolean
  set: (p: Partial<Omit<EditorActivo, 'set'>>) => void
}

export const useEditorActivo = create<EditorActivo>((set) => ({
  id: null,
  editor: null,
  doc: null,
  version: 0,
  pendiente: '',
  pedirEnlace: false,
  barra: true,
  set: (p) => set(p),
}))

/** Entra a editar un objeto; si se empezó escribiendo, esa tecla va primero. */
export function iniciarEdicion(id: string, tecla = '') {
  useEditorActivo.getState().set({ pendiente: tecla })
  useTienda.getState().setEditando(id)
}

/**
 * Le devuelve el foco al editor abierto (después de elegir algo en un menú de la barra: el menú, al cerrarse, deja el
 * foco en su botón). Va en el cuadro siguiente para ganarle a esa devolución.
 */
export function devolverAlEditor() {
  requestAnimationFrame(() => {
    const ed = useEditorActivo.getState().editor
    if (ed && !ed.isDestroyed && !ed.isFocused) ed.commands.focus()
  })
}

/** ¿El foco está en un editor de texto (o en un campo)? */
export const focoEnEditor = () => {
  const a = document.activeElement as HTMLElement | null
  return !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')
}
