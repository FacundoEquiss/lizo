// Atajos del lienzo: una sola tabla y una sola suscripción a tinykeys (con referencias a las funciones del momento),
// en vez de volver a suscribirse en cada render.
import { useEffect, useRef } from 'react'
import { tinykeys } from 'tinykeys'
import { tieneVista } from '../../../../compartido/vistas'
import { usePreferencias } from '../../estado/preferencias'
import { useTienda, type Herramienta } from '../../estado/tienda'
import { escribiendo } from '../../util/teclas'
import type { AccionesLienzo } from './acciones'
import { useLienzo } from './estado'
import { esCreacion } from './crear'
import { focoEnEditor, iniciarEdicion, useEditorActivo } from './texto/editorActivo'

/** Objetos que se editan escribiendo: con uno solo seleccionado, una tecla imprimible entra a editarlo. */
const TIPOS_CON_TEXTO = new Set(['texto', 'nota', 'forma'])

/** Una tecla que escribe un carácter (AltGr incluido: @ o # en teclados en español). */
function imprimible(e: KeyboardEvent) {
  if (e.key.length !== 1 || e.isComposing) return false
  const altGr = e.getModifierState?.('AltGraph')
  if (e.metaKey) return false
  if ((e.ctrlKey || e.altKey) && !altGr) return false
  return true
}

export interface ManejadoresAtajos {
  acciones: AccionesLienzo
  herramienta: (h: Herramienta) => void
  imagen: () => void
  escape: () => void
  editar: () => void
  buscar: () => void
  zoom: (como: 'mas' | 'menos' | 'cien') => void
  /** El menú contextual de la selección (o del lienzo, sin selección): Mayús + F10 o la tecla de menú. */
  menu: () => void
  /** Con una herramienta de creación: crear en el centro de la vista (Enter, con el foco en el lienzo). */
  crearAca: () => void
}

/** ¿El foco está en un botón, un link o una opción de menú? Ahí Enter es de ese control (lo aprieta), no del lienzo. */
function enControl() {
  const a = document.activeElement as HTMLElement | null
  if (!a || a === document.body || a.classList.contains('react-flow') || a.closest('.react-flow__node')) return false
  return a.tagName === 'BUTTON' || a.tagName === 'A' || /^(menuitem|option|tab|switch|radio|checkbox|button)/.test(a.getAttribute('role') ?? '')
}

/** ¿El foco está en el lienzo mismo o en uno de sus objetos? */
function focoEnLienzo() {
  const a = document.activeElement as HTMLElement | null
  return !!a && (a.classList.contains('react-flow') || !!a.closest('.react-flow__node'))
}

/** ¿Se puede usar un atajo del lienzo? (no se está escribiendo, ni hay una tarjeta o un diálogo abiertos). */
export function libre(e: KeyboardEvent) {
  const s = useTienda.getState()
  return !escribiendo(e) && !s.claveAbierta && !s.dialogo && !s.editando
}

export function useAtajosLienzo(manejadores: ManejadoresAtajos) {
  const ref = useRef(manejadores)
  ref.current = manejadores
  useEffect(() => {
    const m = () => ref.current
    // Atajos de una sola tecla: se pueden apagar en Configuración (lector de pantalla, dictado).
    const unaTecla = (fn: (e: KeyboardEvent) => void) => (e: KeyboardEvent) => {
      if (!libre(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (!usePreferencias.getState().atajosDeUnaTecla) return
      fn(e)
    }
    const conSeleccion = (fn: () => void) => (e: KeyboardEvent) => {
      if (!libre(e) || m().acciones.seleccion().nodos.length === 0) return
      e.preventDefault()
      fn()
    }
    const herr = (h: Herramienta) => unaTecla(() => m().herramienta(h))

    // Empezar a escribir con un texto, una nota o una forma seleccionados entra a editarlos, y esa tecla va primero
    // (antes que los atajos de una tecla: va en captura). Y lo que se escriba en el instante en que el editor todavía
    // no tiene el foco se guarda para él, en vez de perderse o disparar un atajo.
    const escribir = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !imprimible(e)) return
      const s = useTienda.getState()
      if (s.editando) {
        if (!focoEnEditor() && !escribiendo(e)) {
          e.preventDefault()
          e.stopPropagation()
          const a = useEditorActivo.getState()
          a.set({ pendiente: a.pendiente + e.key })
        }
        return
      }
      // La barra espaciadora queda para mover el lienzo (mantenerla y arrastrar); Mayús + 1 y Mayús + 2, para encuadrar.
      if (e.key === ' ' || (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2')) || !libre(e)) return
      const { nodos, aristas } = m().acciones.seleccion()
      // Un conector solo: lo que se escribe va a su etiqueta.
      if (!nodos.length && aristas.length === 1) {
        e.preventDefault()
        e.stopPropagation()
        useEditorActivo.getState().set({ pendiente: e.key })
        useLienzo.getState().set({ etiquetaEditando: aristas[0]!.id })
        return
      }
      const n = nodos.length === 1 ? nodos[0]! : null
      if (!n || !TIPOS_CON_TEXTO.has(n.data.elemento.tipo) || n.data.elemento.bloqueado) return
      e.preventDefault()
      e.stopPropagation()
      iniciarEdicion(n.id, e.key)
    }
    window.addEventListener('keydown', escribir, true)
    const quitarAtajos = tinykeys(window, {
      KeyV: herr('seleccionar'),
      KeyH: herr('mano'),
      KeyN: herr('nota'),
      KeyT: herr('texto'),
      KeyS: herr('forma'),
      KeyF: herr('marco'),
      KeyL: herr('conector'),
      // «Tarjeta nueva del Kanban» solo en un tablero que tiene Kanban.
      KeyD: unaTecla(() => tieneVista(useTienda.getState().tablero?.tablero, 'kanban') && m().herramienta('tarjeta')),
      KeyI: unaTecla(() => m().imagen()),
      // Forma directa: R rectángulo, O elipse.
      KeyR: unaTecla(() => {
        usePreferencias.getState().cambiarEstilo('forma', { forma: 'rectangulo' })
        m().herramienta('forma')
      }),
      KeyO: unaTecla(() => {
        usePreferencias.getState().cambiarEstilo('forma', { forma: 'elipse' })
        m().herramienta('forma')
      }),
      Escape: (e) => {
        if (escribiendo(e)) return
        m().escape()
        // Con el foco en un objeto, Esc lo devuelve al lienzo (de ahí, Tab vuelve a recorrer).
        if ((document.activeElement as HTMLElement | null)?.closest('.react-flow__node')) document.querySelector<HTMLElement>('.lienzo .react-flow')?.focus()
      },
      // Tab y Mayús + Tab recorren los objetos en orden de lectura cuando el foco está en el lienzo (9.3); en las puntas
      // no se frena: el foco sigue a lo que viene después (o antes) en la página.
      Tab: (e) => {
        if (!libre(e) || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !focoEnLienzo()) return
        if (m().acciones.recorrer(1)) e.preventDefault()
      },
      'Shift+Tab': (e) => {
        if (!libre(e) || !focoEnLienzo()) return
        if (m().acciones.recorrer(-1)) e.preventDefault()
      },
      Enter: (e) => {
        if (!libre(e) || enControl()) return
        // Con una herramienta de creación elegida y el foco en el lienzo, Enter crea en el centro de lo que se ve.
        if (esCreacion(useTienda.getState().herramienta) && focoEnLienzo()) {
          e.preventDefault()
          m().crearAca()
          return
        }
        const { nodos, aristas } = m().acciones.seleccion()
        // Con un conector solo, Enter edita su etiqueta.
        if (!nodos.length && aristas.length === 1) {
          e.preventDefault()
          useLienzo.getState().set({ etiquetaEditando: aristas[0]!.id })
          return
        }
        if (nodos.length !== 1) return
        e.preventDefault()
        m().editar()
      },
      // Alt + F10 (la convención de las barras de herramientas): el foco va a la barra del objeto elegido; Esc vuelve.
      'Alt+F10': (e) => {
        if (!libre(e)) return
        const boton = document.querySelector<HTMLElement>('.barra-ctx button:not([disabled])')
        if (!boton) return
        e.preventDefault()
        boton.focus()
      },
      // F2: renombrar, como en el sistema (el título del marco elegido o la etiqueta del conector).
      F2: (e) => {
        if (!libre(e)) return
        const { nodos, aristas } = m().acciones.seleccion()
        if (!nodos.length && aristas.length === 1) {
          e.preventDefault()
          useLienzo.getState().set({ etiquetaEditando: aristas[0]!.id })
          return
        }
        if (nodos.length !== 1 || nodos[0]!.data.elemento.tipo !== 'marco' || nodos[0]!.data.elemento.bloqueado) return
        e.preventDefault()
        m().editar()
      },
      Backspace: (e) => {
        if (!libre(e)) return
        const s = m().acciones.seleccion()
        if (!s.nodos.length && !s.aristas.length) return
        e.preventDefault()
        m().acciones.borrar()
      },
      Delete: (e) => {
        if (!libre(e)) return
        m().acciones.borrar()
      },
      '$mod+KeyD': (e) => {
        if (!libre(e)) return
        e.preventDefault()
        m().acciones.duplicar(null, null)
      },
      'Alt+ArrowRight': conSeleccion(() => m().acciones.duplicar(1, 0)),
      'Alt+ArrowLeft': conSeleccion(() => m().acciones.duplicar(-1, 0)),
      'Alt+ArrowDown': conSeleccion(() => m().acciones.duplicar(0, 1)),
      'Alt+ArrowUp': conSeleccion(() => m().acciones.duplicar(0, -1)),
      ArrowRight: conSeleccion(() => m().acciones.mover(1, 0)),
      ArrowLeft: conSeleccion(() => m().acciones.mover(-1, 0)),
      ArrowDown: conSeleccion(() => m().acciones.mover(0, 1)),
      ArrowUp: conSeleccion(() => m().acciones.mover(0, -1)),
      'Shift+ArrowRight': conSeleccion(() => m().acciones.mover(10, 0)),
      'Shift+ArrowLeft': conSeleccion(() => m().acciones.mover(-10, 0)),
      'Shift+ArrowDown': conSeleccion(() => m().acciones.mover(0, 10)),
      'Shift+ArrowUp': conSeleccion(() => m().acciones.mover(0, -10)),
      '$mod+KeyA': (e) => {
        if (!libre(e)) return
        e.preventDefault()
        m().acciones.seleccionar((useTienda.getState().tablero?.elementos ?? []).filter((x) => !x.bloqueado).map((x) => x.id))
      },
      '$mod+Shift+KeyL': (e) => {
        if (!libre(e)) return
        e.preventDefault()
        m().acciones.bloquear()
      },
      '$mod+Alt+KeyC': conSeleccion(() => m().acciones.copiarEstilo()),
      '$mod+Alt+KeyV': conSeleccion(() => m().acciones.pegarEstilo()),
      'Alt+KeyA': conSeleccion(() => m().acciones.alinear('izq')),
      'Alt+KeyD': conSeleccion(() => m().acciones.alinear('der')),
      'Alt+KeyW': conSeleccion(() => m().acciones.alinear('arriba')),
      'Alt+KeyS': conSeleccion(() => m().acciones.alinear('abajo')),
      'Alt+KeyH': conSeleccion(() => m().acciones.alinear('centroH')),
      'Alt+KeyV': conSeleccion(() => m().acciones.alinear('medio')),
      PageUp: conSeleccion(() => m().acciones.apilar('frente')),
      PageDown: conSeleccion(() => m().acciones.apilar('fondo')),
      '$mod+BracketRight': conSeleccion(() => m().acciones.apilar('subir')),
      '$mod+BracketLeft': conSeleccion(() => m().acciones.apilar('bajar')),
      'Shift+!': (e) => libre(e) && m().acciones.verTodo(),
      'Shift+Digit1': (e) => libre(e) && m().acciones.verTodo(),
      'Alt+Digit1': (e) => libre(e) && (e.preventDefault(), m().acciones.verTodo()),
      'Shift+Digit2': (e) => libre(e) && m().acciones.zoomSeleccion(),
      'Shift+@': (e) => libre(e) && m().acciones.zoomSeleccion(),
      'Alt+Digit2': (e) => libre(e) && (e.preventDefault(), m().acciones.zoomSeleccion()),
      '$mod+Digit0': (e) => {
        e.preventDefault()
        m().zoom('cien')
      },
      '$mod+Equal': (e) => {
        e.preventDefault()
        m().zoom('mas')
      },
      '$mod+Minus': (e) => {
        e.preventDefault()
        m().zoom('menos')
      },
      'Shift+F10': (e) => {
        if (!libre(e)) return
        e.preventDefault()
        m().menu()
      },
      ContextMenu: (e) => {
        if (!libre(e)) return
        e.preventDefault()
        m().menu()
      },
      KeyM: unaTecla(() => useTienda.getState().alternarMinimapa()),
      KeyG: unaTecla(() => useTienda.getState().alternarGrilla()),
      // Marcos: . el siguiente y , el anterior (en el Kanban mueven tarjetas; acá están libres).
      Period: unaTecla(() => m().acciones.marcoSiguiente(1)),
      Comma: unaTecla(() => m().acciones.marcoSiguiente(-1)),
      '$mod+KeyG': (e) => {
        if (!libre(e) || !m().acciones.seleccion().nodos.length) return
        e.preventDefault()
        void m().acciones.agruparEnMarco()
      },
      '$mod+KeyF': (e) => {
        if (useTienda.getState().claveAbierta) return
        e.preventDefault()
        m().buscar()
      },
    })
    return () => {
      quitarAtajos()
      window.removeEventListener('keydown', escribir, true)
    }
  }, [])
}
