// Formato aplicado a un objeto entero sin abrir el editor (un clic en B con una nota seleccionada): un editor de TipTap
// sin pantalla, con todo seleccionado, corre el mismo comando que se correría editando.
import { Editor, type ChainedCommands } from '@tiptap/core'
import type { DocRico } from '../../../../../compartido/rico'
import { extensiones } from './extensiones'

export function formatearDoc(doc: DocRico, comando: (c: ChainedCommands) => ChainedCommands, titulos = false): DocRico {
  const ed = new Editor({ element: null, extensions: extensiones({ titulos }), content: doc })
  comando(ed.chain().selectAll()).run()
  const r = ed.getJSON() as DocRico
  ed.destroy()
  return r
}
