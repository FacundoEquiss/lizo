// Menú contextual del lienzo (5.8): botón derecho (si el puntero casi no se movió: arrastrar con el derecho mueve el
// lienzo) o Mayús + F10. Sobre un objeto o una selección: cortar, copiar, pegar, duplicar, estilo, capas, bloquear,
// convertir y borrar. Sobre el vacío: pegar acá, crear acá, seleccionar todo, ver todo y la configuración del lienzo.
// Las mismas acciones que la barra y los atajos, con las teclas a la derecha.
import { autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift, size, useDismiss, useFloating, useInteractions, useRole } from '@floating-ui/react'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BoxSelect,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Fullscreen,
  Lock,
  Scissors,
  Settings2,
  Shapes,
  Spline,
  SquareKanban,
  StickyNote,
  Trash2,
  Type,
  Unlock,
  Paintbrush,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useLayoutEffect, useMemo, type KeyboardEvent as EventoTecla, type ReactNode } from 'react'
import { usePreferencias } from '../../../estado/preferencias'
import { tieneVista } from '../../../../../compartido/vistas'
import { useTienda } from '../../../estado/tienda'
import { Kbd } from '../../../ui/comunes'
import { useAccionesLienzo } from '../acciones'
import { useLienzo, type MenuContextualAbierto } from '../estado'
import { escribirEnSistema } from '../portapapeles'
import { useSeleccionLienzo } from '../seleccion'
import { MENU, origenDe } from '../../../util/movimiento'

interface Item {
  id: string
  etiqueta: string
  icono: ReactNode
  atajo?: string
  peligro?: boolean
  separador?: boolean
  titulo?: string
  hacer: () => void
}

export interface PropsMenuContextual {
  menu: MenuContextualAbierto
  /** Pegar en un punto del lienzo (la memoria o, si no hay, el portapapeles del sistema). */
  alPegar: (punto: { x: number; y: number }) => void
  /** Crear algo en un punto del lienzo. */
  alCrear: (que: 'nota' | 'texto' | 'tarjeta', punto: { x: number; y: number }) => void
}

export function MenuContextual({ menu, alPegar, alCrear }: PropsMenuContextual) {
  const acciones = useAccionesLienzo()
  const sel = useSeleccionLienzo()
  const hayEstilo = usePreferencias((s) => !!s.portapapelesEstilo)
  // Un tablero sin Kanban (un diagrama) no ofrece tarjetas.
  const conKanban = useTienda((s) => tieneVista(s.tablero?.tablero, 'kanban'))
  const cerrar = () => useLienzo.getState().set({ menuContextual: null })
  const { refs, floatingStyles, context, placement } = useFloating({
    open: true,
    onOpenChange: (v) => !v && cerrar(),
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    // Si no entra abajo, se da vuelta; si tampoco, se corre (en los dos ejes) y, en una ventana muy baja, se achica.
    middleware: [
      offset(2),
      flip({ padding: 12 }),
      shift({ padding: 12, crossAxis: true }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(160, availableHeight)}px`
        },
      }),
    ],
  })
  // Se abre en el punto del clic (un elemento virtual de tamaño cero).
  useLayoutEffect(() => {
    refs.setPositionReference({ getBoundingClientRect: () => new DOMRect(menu.x, menu.y, 0, 0) })
  }, [refs, menu.x, menu.y])
  const { getFloatingProps } = useInteractions([useDismiss(context), useRole(context, { role: 'menu' })])

  const items: Item[] = useMemo(() => {
    const punto = menu.punto
    if (menu.sobre === 'vacio')
      return [
        { id: 'pegar', etiqueta: 'Pegar acá', icono: <ClipboardPaste size={15} />, atajo: '$mod+V', hacer: () => alPegar(punto) },
        { id: 'nota', etiqueta: 'Nota acá', icono: <StickyNote size={15} />, atajo: 'N', separador: true, hacer: () => alCrear('nota', punto) },
        { id: 'texto', etiqueta: 'Texto acá', icono: <Type size={15} />, atajo: 'T', hacer: () => alCrear('texto', punto) },
        ...(conKanban
          ? [{ id: 'tarjeta', etiqueta: 'Tarjeta nueva acá', icono: <SquareKanban size={15} />, atajo: 'D', hacer: () => alCrear('tarjeta', punto) }]
          : []),
        {
          id: 'todo',
          etiqueta: 'Seleccionar todo',
          icono: <BoxSelect size={15} />,
          atajo: '$mod+A',
          separador: true,
          hacer: () => acciones.seleccionar((useTienda.getState().tablero?.elementos ?? []).filter((e) => !e.bloqueado).map((e) => e.id)),
        },
        { id: 'ver-todo', etiqueta: 'Ver todo', icono: <Fullscreen size={15} />, atajo: 'Shift+1', hacer: () => acciones.verTodo() },
        {
          id: 'config',
          etiqueta: 'Configuración del lienzo',
          icono: <Settings2 size={15} />,
          atajo: '$mod+,',
          separador: true,
          hacer: () => useTienda.getState().abrirConfiguracion('lienzo'),
        },
      ]
    const bloqueados = sel.nodos.length > 0 && sel.nodos.every((e) => e.bloqueado)
    const uno = sel.nodos.length === 1 && !sel.conectores.length ? sel.nodos[0]! : null
    const convertibles =
      uno && !uno.bloqueado && (uno.tipo === 'nota' || uno.tipo === 'texto' || uno.tipo === 'forma')
        ? (
            [
              ['tarjeta', 'En tarjeta del Kanban', <SquareKanban key="t" size={15} />],
              ['nota', 'En nota', <StickyNote key="n" size={15} />],
              ['forma', 'En forma', <Shapes key="f" size={15} />],
              ['texto', 'En texto', <Type key="x" size={15} />],
            ] as const
          ).filter(([a]) => a !== uno.tipo && (conKanban || a !== 'tarjeta'))
        : []
    const conObjetos = sel.nodos.length > 0
    return [
      ...(conObjetos
        ? [
            {
              id: 'cortar',
              etiqueta: 'Cortar',
              icono: <Scissors size={15} />,
              atajo: '$mod+X',
              hacer: () => {
                const r = acciones.cortar()
                if (r) void escribirEnSistema(r)
              },
            },
            {
              id: 'copiar',
              etiqueta: 'Copiar',
              icono: <Copy size={15} />,
              atajo: '$mod+C',
              hacer: () => {
                const r = acciones.copiar()
                if (r) void escribirEnSistema(r)
              },
            },
          ]
        : []),
      { id: 'pegar', etiqueta: 'Pegar', icono: <ClipboardPaste size={15} />, atajo: '$mod+V', hacer: () => alPegar(punto) },
      ...(conObjetos ? [{ id: 'duplicar', etiqueta: 'Duplicar', icono: <CopyPlus size={15} />, atajo: '$mod+D', hacer: () => acciones.duplicar(null, null) }] : []),
      // Conectar con algo nuevo sin arrastrar (el camino con teclado hasta "Crear y conectar").
      ...(uno
        ? [
            {
              id: 'conectar',
              etiqueta: 'Crear y conectar…',
              icono: <Spline size={15} />,
              hacer: () => window.dispatchEvent(new CustomEvent('tablero:crear-y-conectar', { detail: { id: uno.id } })),
            },
          ]
        : []),
      ...(conObjetos
        ? [
            { id: 'copiar-estilo', etiqueta: 'Copiar estilo', icono: <Paintbrush size={15} />, atajo: '$mod+Alt+C', separador: true, hacer: () => acciones.copiarEstilo() },
            ...(hayEstilo
              ? [{ id: 'pegar-estilo', etiqueta: 'Pegar estilo', icono: <ClipboardPaste size={15} />, atajo: '$mod+Alt+V', hacer: () => acciones.pegarEstilo() }]
              : []),
            { id: 'frente', etiqueta: 'Traer al frente', icono: <ArrowUpToLine size={15} />, atajo: 'PageUp', separador: true, hacer: () => acciones.apilar('frente') },
            { id: 'subir', etiqueta: 'Subir una capa', icono: <ChevronUp size={15} />, atajo: '$mod+]', hacer: () => acciones.apilar('subir') },
            { id: 'bajar', etiqueta: 'Bajar una capa', icono: <ChevronDown size={15} />, atajo: '$mod+[', hacer: () => acciones.apilar('bajar') },
            { id: 'fondo', etiqueta: 'Mandar al fondo', icono: <ArrowDownToLine size={15} />, atajo: 'PageDown', hacer: () => acciones.apilar('fondo') },
            {
              id: 'bloquear',
              etiqueta: bloqueados ? 'Desbloquear' : 'Bloquear',
              icono: bloqueados ? <Unlock size={15} /> : <Lock size={15} />,
              atajo: '$mod+Shift+L',
              separador: true,
              hacer: () => acciones.bloquear(),
            },
          ]
        : []),
      ...convertibles.map(([a, etiqueta, icono], i) => ({
        id: `convertir-${a}`,
        etiqueta,
        icono,
        separador: i === 0,
        titulo: i === 0 ? 'Convertir' : undefined,
        hacer: () => void acciones.convertir(a, null, uno!.id),
      })),
      { id: 'borrar', etiqueta: 'Borrar', icono: <Trash2 size={15} />, atajo: 'Delete', peligro: true, separador: true, hacer: () => acciones.borrar() },
    ]
  }, [menu, sel, hayEstilo, conKanban, acciones, alPegar, alCrear])

  // Flechas arriba y abajo entre las filas (Inicio y Fin, a los extremos).
  const alTecla = (e: EventoTecla<HTMLDivElement>) => {
    const botones = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.menu__item')]
    const i = botones.indexOf(document.activeElement as HTMLButtonElement)
    const j =
      e.key === 'ArrowDown' ? (i + 1) % botones.length : e.key === 'ArrowUp' ? (i - 1 + botones.length) % botones.length : e.key === 'Home' ? 0 : e.key === 'End' ? botones.length - 1 : -2
    if (j === -2) return
    e.preventDefault()
    botones[j]?.focus()
  }

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={0} returnFocus={false}>
        <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 90 }} {...getFloatingProps()}>
          <motion.div className="flotante menu menu-contextual" style={{ transformOrigin: origenDe(placement) }} {...MENU} onContextMenu={(e) => e.preventDefault()}>
            <div className="menu__lista" role="menu" aria-label={menu.sobre === 'vacio' ? 'Lienzo' : 'Objeto'} onKeyDown={alTecla}>
              {items.map((it) => (
                <div key={it.id}>
                  {it.separador && <div className="menu__separador" />}
                  {it.titulo && <div className="menu__titulo">{it.titulo}</div>}
                  <button
                    type="button"
                    role="menuitem"
                    className={`menu__item${it.peligro ? ' menu__item--peligro' : ''}`}
                    onClick={() => {
                      cerrar()
                      it.hacer()
                    }}
                  >
                    <span className="menu__icono">{it.icono}</span>
                    <span className="menu__texto">{it.etiqueta}</span>
                    {it.atajo && <Kbd atajo={it.atajo} suave />}
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  )
}
