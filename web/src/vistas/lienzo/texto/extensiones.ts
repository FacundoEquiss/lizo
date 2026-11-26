// Extensiones de TipTap para el texto del lienzo (trozo aparte: solo se baja al editar o formatear).
import { Extension, Mark, mergeAttributes, type Editor } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { COLORES_LIENZO } from '../../../../../compartido/lienzo'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    colorTexto: {
      /** Color del texto por nombre ('rojo'): cambia con el tema. */
      ponerColor: (color: string) => ReturnType
      quitarColor: () => ReturnType
    }
    resaltado: {
      ponerResaltado: (color: string) => ReturnType
      quitarResaltado: () => ReturnType
    }
  }
}

const esColor = (v: unknown) => typeof v === 'string' && (COLORES_LIENZO as string[]).includes(v)

/** Color del texto: <span data-color="rojo">. Se guarda el nombre, no el hexadecimal. Lo ajeno (style="color") no entra. */
export const MarcaColor = Mark.create({
  name: 'color',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => (esColor(el.getAttribute('data-color')) ? el.getAttribute('data-color') : null),
        renderHTML: (a) => (a.color ? { 'data-color': a.color } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-color]', getAttrs: (el) => (esColor((el as HTMLElement).getAttribute('data-color')) ? null : false) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
  addCommands() {
    return {
      ponerColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      quitarColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

/** Resaltado: <mark data-resaltado="amarillo"> (fondo en el tono de las notas). */
export const MarcaResaltado = Mark.create({
  name: 'resaltado',
  addAttributes() {
    return {
      color: {
        default: 'amarillo',
        parseHTML: (el) => (esColor(el.getAttribute('data-resaltado')) ? el.getAttribute('data-resaltado') : 'amarillo'),
        renderHTML: (a) => ({ 'data-resaltado': a.color }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'mark[data-resaltado]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0]
  },
  addCommands() {
    return {
      ponerResaltado:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      quitarResaltado:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

export interface OpcionesTexto {
  titulos?: boolean
  marcador?: string
  /** Salir de editar (Esc o Ctrl/⌘ + Enter). */
  alSalir?: () => void
  /** Ctrl/⌘ + K: pedir el enlace. */
  alPedirEnlace?: (editor: Editor) => void
  /** Ctrl/⌘ + Mayús + L E R J: alineación del objeto entero. */
  alAlinear?: (a: 'izquierda' | 'centro' | 'derecha' | 'justificado') => void
}

export function extensiones(o: OpcionesTexto = {}) {
  const AtajosTelar = Extension.create({
    name: 'atajosTelar',
    addKeyboardShortcuts() {
      return {
        Escape: () => {
          o.alSalir?.()
          return !!o.alSalir
        },
        'Mod-Enter': () => {
          o.alSalir?.()
          return !!o.alSalir
        },
        'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
        'Mod-k': () => {
          o.alPedirEnlace?.(this.editor)
          return !!o.alPedirEnlace
        },
        'Mod-Shift-l': () => (o.alAlinear?.('izquierda'), !!o.alAlinear),
        'Mod-Shift-e': () => (o.alAlinear?.('centro'), !!o.alAlinear),
        'Mod-Shift-r': () => (o.alAlinear?.('derecha'), !!o.alAlinear),
        'Mod-Shift-j': () => (o.alAlinear?.('justificado'), !!o.alAlinear),
      }
    },
  })
  return [
    StarterKit.configure({
      heading: o.titulos ? { levels: [1, 2] } : false,
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
      code: false,
      trailingNode: false,
      dropcursor: false,
      gapcursor: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ['http', 'https', 'mailto'],
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        isAllowedUri: (url, ctx) => /^(https?:|mailto:)/i.test(url) || (!/^[a-z]+:/i.test(url) && ctx.defaultValidate(url)),
      },
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node, checked) => `${checked ? 'Desmarcar' : 'Marcar'} «${node.textContent || 'tarea vacía'}»` },
    }),
    Placeholder.configure({ placeholder: o.marcador ?? 'Escribí algo…', showOnlyWhenEditable: true }),
    // El resaltado va antes que el color: en el documento queda <mark> por fuera del <span data-color> (el color de
    // adentro se lee sobre el fondo claro del resaltado). VistaRica dibuja las marcas en el mismo orden.
    MarcaResaltado,
    MarcaColor,
    AtajosTelar,
  ]
}
