// El menú "⋯" de la barra contextual: igual para todos los objetos (5.8).
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, ClipboardPaste, Copy, CopyPlus, Lock, MoreHorizontal, Trash2, Unlock } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePreferencias } from '../../../estado/preferencias'
import { Menu, type ItemMenu } from '../../../ui/Desplegable'
import { useAccionesLienzo } from '../acciones'
import { useSeleccionLienzo } from '../seleccion'

export interface ItemExtra {
  id: string
  etiqueta: string
  icono?: ReactNode
  atajo?: string
  peligro?: boolean
  alElegir: () => void
}

export function MenuMas({ extra = [], tam = 'normal' }: { extra?: ItemExtra[]; tam?: 'normal' | 'grande' }) {
  const acciones = useAccionesLienzo()
  const sel = useSeleccionLienzo()
  const hayEstilo = usePreferencias((s) => !!s.portapapelesEstilo)
  const bloqueados = sel.nodos.length > 0 && sel.nodos.every((e) => e.bloqueado)
  const soloConectores = sel.nodos.length === 0
  const items: ItemMenu[] = soloConectores
    ? [{ id: 'borrar', etiqueta: 'Borrar', icono: <Trash2 size={15} />, atajo: 'Delete', peligro: true, alElegir: () => acciones.borrar() }]
    : [
        { id: 'copiar-estilo', etiqueta: 'Copiar estilo', icono: <Copy size={15} />, atajo: '$mod+Alt+C', alElegir: () => acciones.copiarEstilo() },
        ...(hayEstilo
          ? [{ id: 'pegar-estilo', etiqueta: 'Pegar estilo', icono: <ClipboardPaste size={15} />, atajo: '$mod+Alt+V', alElegir: () => acciones.pegarEstilo() }]
          : []),
        { id: 'duplicar', etiqueta: 'Duplicar', icono: <CopyPlus size={15} />, atajo: '$mod+D', separador: true, alElegir: () => acciones.duplicar(null, null) },
        { id: 'frente', etiqueta: 'Traer al frente', icono: <ArrowUpToLine size={15} />, atajo: 'PageUp', separador: true, alElegir: () => acciones.apilar('frente') },
        { id: 'subir', etiqueta: 'Subir una capa', icono: <ChevronUp size={15} />, atajo: '$mod+]', alElegir: () => acciones.apilar('subir') },
        { id: 'bajar', etiqueta: 'Bajar una capa', icono: <ChevronDown size={15} />, atajo: '$mod+[', alElegir: () => acciones.apilar('bajar') },
        { id: 'fondo', etiqueta: 'Mandar al fondo', icono: <ArrowDownToLine size={15} />, atajo: 'PageDown', alElegir: () => acciones.apilar('fondo') },
        {
          id: 'bloquear',
          etiqueta: bloqueados ? 'Desbloquear' : 'Bloquear',
          icono: bloqueados ? <Unlock size={15} /> : <Lock size={15} />,
          atajo: '$mod+Shift+L',
          separador: true,
          alElegir: () => acciones.bloquear(),
        },
        ...extra.map((x, i) => ({ ...x, separador: i === 0 })),
        { id: 'borrar', etiqueta: 'Borrar', icono: <Trash2 size={15} />, atajo: 'Delete', peligro: true, separador: true, alElegir: () => acciones.borrar() },
      ]
  return (
    <Menu
      items={items}
      lado="bottom-end"
      disparador={(p) => (
        <button {...p} className={`barra-ctx__boton${tam === 'grande' ? ' barra-ctx__boton--grande' : ''}`} aria-label="Más opciones" data-tip="Más">
          <MoreHorizontal size={16} />
        </button>
      )}
    />
  )
}
