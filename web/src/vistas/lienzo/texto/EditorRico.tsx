// El editor de texto enriquecido (TipTap 3). Hay uno solo vivo a la vez, montado en el objeto que se está editando,
// en la MISMA caja y con las mismas clases que la vista (VistaRica): al entrar a editar el texto no se mueve.
// Se carga con lazy() (trozo aparte): ni el Kanban ni la carga inicial del lienzo lo bajan.
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, type CSSProperties } from 'react'
import { docDesdeTexto, textoPlano, type DocRico } from '../../../../../compartido/rico'
import { useTienda } from '../../../estado/tienda'
import { useEditorActivo } from './editorActivo'
import { extensiones } from './extensiones'

export interface PropsEditorRico {
  id: string
  doc: DocRico | undefined
  /** El texto plano, si el objeto todavía no tiene documento (los de la 0.1). */
  texto: string
  /** Títulos 1 y 2 (solo el objeto Texto). */
  permitirTitulos?: boolean
  marcador?: string
  className?: string
  estilo?: CSSProperties
  /** false: no se muestra la barra contextual mientras se escribe (el celular pone una propia con las mismas secciones). */
  barra?: boolean
  /** En cada cambio del documento (el texto plano incluido). */
  alCambiar?: (doc: DocRico, texto: string) => void
  /** Al terminar de editar (Esc, Ctrl/⌘ + Enter, clic afuera): el documento final y su texto plano. */
  alSalir: (doc: DocRico, texto: string) => void
  /** Ctrl/⌘ + Mayús + L E R J. */
  alAlinear?: (a: 'izquierda' | 'centro' | 'derecha' | 'justificado') => void
}

/** Se sale de editar soltando el objeto: el editor se desmonta y ahí se guarda. */
const salir = () => useTienda.getState().setEditando(null)

export default function EditorRico({ id, doc, texto, permitirTitulos, marcador, className, estilo, barra = true, alCambiar, alSalir, alAlinear }: PropsEditorRico) {
  const alSalirRef = useRef(alSalir)
  alSalirRef.current = alSalir
  const alCambiarRef = useRef(alCambiar)
  alCambiarRef.current = alCambiar
  const alAlinearRef = useRef(alAlinear)
  alAlinearRef.current = alAlinear
  const barraRef = useRef(barra)
  barraRef.current = barra
  const inicial = useRef(doc ?? docDesdeTexto(texto))
  const ultimo = useRef<DocRico>(inicial.current)
  const vivo = useRef(false)

  const editor = useEditor({
    extensions: extensiones({
      titulos: permitirTitulos,
      marcador,
      alSalir: salir,
      alPedirEnlace: () => useEditorActivo.getState().set({ pedirEnlace: true }),
      alAlinear: (a) => alAlinearRef.current?.(a),
    }),
    content: inicial.current,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'rico', spellcheck: 'true', 'aria-label': 'Texto', 'aria-multiline': 'true', role: 'textbox' },
      // Adentro del texto, Ctrl/⌘ + K es "enlace" (no la paleta de comandos) y Esc solo termina de escribir (no cierra
      // paneles): esas teclas no siguen hasta los atajos generales de la app.
      handleKeyDown: (_vista, e) => {
        if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k')) e.stopPropagation()
        return false
      },
    },
    onTransaction: ({ editor: ed, transaction }) => {
      const a = useEditorActivo.getState()
      if (transaction.docChanged) {
        ultimo.current = ed.getJSON() as DocRico
        alCambiarRef.current?.(ultimo.current, textoPlano(ultimo.current))
      }
      a.set({ version: a.version + 1, ...(transaction.docChanged ? { doc: ultimo.current } : {}) })
    },
    onBlur: ({ event }) => {
      // Ir a la barra contextual o a uno de sus menús no es salir.
      const destino = event.relatedTarget as HTMLElement | null
      if (destino?.closest('.barra-ctx, .flotante, .pedir-enlace')) return
      salir()
    },
  })

  // Mientras está montado, es el editor activo (la barra le manda comandos).
  useEffect(() => {
    if (!editor) return
    vivo.current = true
    useEditorActivo.getState().set({ id, editor, doc: editor.getJSON() as DocRico, barra: barraRef.current })
    let terminado = false
    const terminar = (final: DocRico) => {
      if (terminado) return
      terminado = true
      alSalirRef.current(final, textoPlano(final))
    }
    // Se guarda en el momento en que se suelta el objeto (Esc, clic afuera, otra herramienta…): la tienda avisa antes
    // de que React vuelva a dibujar, así la caja todavía muestra el texto final (se mide bien) y la vista aparece ya
    // con el documento nuevo (no parpadea el viejo).
    const desuscribir = useTienda.subscribe((s, previo) => {
      if (previo.editando === id && s.editando !== id) terminar(editor.isDestroyed ? ultimo.current : (editor.getJSON() as DocRico))
    })
    // El foco al final. React Flow esconde un objeto recién creado hasta medirlo, y lo escondido no recibe el foco:
    // se reintenta unos cuadros. Si se empezó a escribir con el objeto seleccionado, esas teclas van primero.
    let intentos = 0
    let cuadro = 0
    const enfocar = () => {
      if (editor.isDestroyed) return
      editor.commands.focus('end')
      if (!editor.view.hasFocus() && intentos++ < 20) {
        cuadro = requestAnimationFrame(enfocar)
        return
      }
      const pendiente = useEditorActivo.getState().pendiente
      if (pendiente) {
        useEditorActivo.getState().set({ pendiente: '' })
        editor.commands.insertContent(pendiente)
      }
    }
    cuadro = requestAnimationFrame(enfocar)
    return () => {
      cancelAnimationFrame(cuadro)
      desuscribir()
      vivo.current = false
      const limpiar = () => {
        if (useEditorActivo.getState().id === id) useEditorActivo.getState().set({ id: null, editor: null, doc: null, pedirEnlace: false, pendiente: '', barra: true })
      }
      if (terminado) return limpiar()
      // Se desmontó sin soltar el objeto: o es el desmontaje de prueba de StrictMode (vuelve a montar enseguida y no
      // hay nada que hacer) o se fue el lienzo (o el objeto) con el texto abierto: entonces se guarda igual.
      const final = editor.isDestroyed ? ultimo.current : (editor.getJSON() as DocRico)
      queueMicrotask(() => {
        if (vivo.current) return
        limpiar()
        terminar(final)
        if (useTienda.getState().editando === id) useTienda.getState().setEditando(null)
      })
    }
  }, [editor, id])

  return <EditorContent editor={editor} className={className} style={estilo} />
}
