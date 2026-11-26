// La barra de la nota (5.3): `[Color ▾] | [Fuente ▾] [− Auto +] | [B] [I] [U] [S] | [Alineación ▾] [Lista ▾] |
// [Tamaño ▾] | [Convertir ▾] | [⋯]`. "Convertir" sirve también para textos y formas.
import { ArrowRightLeft, Shapes, SquareKanban, StickyNote, Type } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ElementoLienzo } from '../../../../../compartido/tipos'
import { useTienda } from '../../../estado/tienda'
import { useAccionesLienzo } from '../acciones'
import { useSeleccionLienzo } from '../seleccion'
import { useEditorActivo } from '../texto/editorActivo'
import { MenuBarra, Separador, type TamBarra } from './piezas'
import { SeccionColor } from './seccionColor'
import { SeccionAlineacion, SeccionEnlace, SeccionListas, SeccionMarcas, SelectorFuente, SelectorTamano } from './seccionTexto'

/** Los tamaños rápidos de la nota (cuadradas, y una ancha). */
export const TAMANOS_NOTA: { id: string; nombre: string; ancho: number; alto: number }[] = [
  { id: 'chica', nombre: 'Chica', ancho: 160, alto: 160 },
  { id: 'mediana', nombre: 'Mediana', ancho: 220, alto: 220 },
  { id: 'grande', nombre: 'Grande', ancho: 320, alto: 320 },
  { id: 'ancha', nombre: 'Ancha', ancho: 320, alto: 160 },
]

function IconoTamano({ ancho, alto }: { ancho: number; alto: number }) {
  const k = 16 / 320
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
      <rect x={9 - (ancho * k) / 2} y={9 - (alto * k) / 2} width={ancho * k} height={alto * k} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1.6} />
    </svg>
  )
}

/** Tamaño de la nota: Chica 160, Mediana 220, Grande 320 y Ancha 320 × 160 (queda en el mismo lugar, arriba a la izquierda). */
export function SeccionTamanoNota({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const els = (elementos ?? sel.nodos).filter((e) => e.tipo === 'nota' && !e.bloqueado)
  if (!els.length) return null
  const e = els[0]!
  const actual = TAMANOS_NOTA.find((t) => t.ancho === e.ancho && t.alto === e.alto)
  return (
    <MenuBarra etiqueta="Tamaño de la nota" tam={tam} disparador={<IconoTamano ancho={e.ancho} alto={Math.min(e.alto, 320)} />} ancho={190}>
      {(cerrar) => (
        <div className="menu__lista" role="listbox" aria-label="Tamaño de la nota">
          {TAMANOS_NOTA.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={actual?.id === t.id}
              className={`menu__item${actual?.id === t.id ? ' menu__item--activo' : ''}`}
              onClick={() => {
                void useTienda.getState().actualizarElementos(
                  els.map((x) => ({ id: x.id, ancho: t.ancho, alto: t.alto })),
                  { registrar: 'tamaño de la nota' },
                )
                cerrar()
              }}
            >
              <span className="menu__icono">
                <IconoTamano ancho={t.ancho} alto={t.alto} />
              </span>
              <span className="menu__texto">{t.nombre}</span>
              <span className="menu__detalle">{t.ancho === t.alto ? t.ancho : `${t.ancho} × ${t.alto}`}</span>
            </button>
          ))}
        </div>
      )}
    </MenuBarra>
  )
}

const DESTINOS: { a: 'tarjeta' | 'nota' | 'texto' | 'forma'; nombre: string; icono: ReactNode; ayuda?: string }[] = [
  { a: 'tarjeta', nombre: 'En tarjeta del Kanban', icono: <SquareKanban size={15} />, ayuda: 'La idea pasa a ser trabajo' },
  { a: 'nota', nombre: 'En nota', icono: <StickyNote size={15} /> },
  { a: 'forma', nombre: 'En forma', icono: <Shapes size={15} /> },
  { a: 'texto', nombre: 'En texto', icono: <Type size={15} /> },
]

/** Convertir una nota, un texto o una forma en otra cosa (en el mismo lugar y con sus conectores). */
export function SeccionConvertir({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const acciones = useAccionesLienzo()
  const els = (elementos ?? sel.nodos).filter((e) => (e.tipo === 'nota' || e.tipo === 'texto' || e.tipo === 'forma') && !e.bloqueado)
  if (els.length !== 1) return null
  const e = els[0]!
  return (
    <MenuBarra etiqueta="Convertir" tam={tam} disparador={<ArrowRightLeft size={16} />} ancho={250}>
      {(cerrar) => (
        <div className="menu__lista" role="menu" aria-label="Convertir">
          <div className="menu__titulo">Convertir</div>
          {DESTINOS.filter((d) => d.a !== e.tipo).map((d) => (
            <button
              key={d.a}
              type="button"
              role="menuitem"
              className={`menu__item${d.ayuda ? ' menu__item--doble' : ''}`}
              onClick={() => {
                cerrar()
                // Si se estaba escribiendo, primero se guarda (soltar el objeto) y después se convierte.
                if (useTienda.getState().editando === e.id) useTienda.getState().setEditando(null)
                setTimeout(() => void acciones.convertir(d.a, null, e.id), 0)
              }}
            >
              <span className="menu__icono">{d.icono}</span>
              <span className="menu__texto">
                {d.nombre}
                {d.ayuda && <small>{d.ayuda}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </MenuBarra>
  )
}

/** La barra completa de la nota. El enlace aparece mientras se escribe (Ctrl/⌘ + K). */
export function SeccionNota({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const els = (elementos ?? sel.nodos).filter((e) => e.tipo === 'nota' && !e.bloqueado)
  const escribiendo = useEditorActivo((s) => !!s.id && els.some((e) => e.id === s.id))
  if (!els.length) return null
  return (
    <>
      <SeccionColor elementos={els} tam={tam} />
      <Separador />
      <SelectorFuente elementos={els} tam={tam} />
      <SelectorTamano elementos={els} tam={tam} conAuto />
      <Separador />
      <SeccionMarcas elementos={els} tam={tam} />
      <Separador />
      <SeccionAlineacion elementos={els} tam={tam} vertical />
      <SeccionListas elementos={els} tam={tam} />
      {escribiendo && <SeccionEnlace elementos={els} tam={tam} />}
      <Separador />
      <SeccionTamanoNota elementos={els} tam={tam} />
      {els.length === 1 && (
        <>
          <Separador />
          <SeccionConvertir elementos={els} tam={tam} />
        </>
      )}
    </>
  )
}
