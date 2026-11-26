// Páginas (plan 6.2): filas de 30 px con el ícono del tipo, el nombre y la cuenta. La activa con un indicador que se desliza.
// Las importadas llevan el ícono de enlace ("Viene del código"). Las propias: menú con el botón derecho (Renombrar F2,
// Duplicar, Archivar) y se reordenan arrastrando.
import { generateKeyBetween } from 'fractional-indexing'
import { Archive, Copy, Frame, Link2, Palette, Pencil, Plus, Table2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PaginaDiseno } from '../../../../../compartido/diseno/tipos'
import { avisar, avisarError } from '../../../estado/avisos'
import { apiDiseno } from '../api'
import { useDiseno } from '../estado'
import { irADiseno } from '../ruta'

const ICONO = { lienzo: Frame, sistema: Palette, tabla: Table2 }

export function Paginas() {
  const resumen = useDiseno((s) => s.resumen)
  const pagina = useDiseno((s) => s.pagina)
  const prefijo = useDiseno((s) => s.prefijo)!
  const [renombrando, setRenombrando] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  if (!resumen) return null
  const paginas = resumen.paginas.filter((p) => !p.archivada)
  const cuenta = (p: PaginaDiseno) => {
    if (p.tipo === 'lienzo') return p.marcos
    return (p.datos.tipos ?? []).reduce((n, t) => n + (resumen.conteo[t] ?? 0), 0)
  }

  const nueva = async () => {
    try {
      const propias = paginas.filter((p) => p.origen === 'propio').length
      const p = await apiDiseno.crearPagina(prefijo, `Página ${propias + 1}`)
      await useDiseno.getState().recargarResumen()
      irADiseno({ pagina: p.slug })
      setRenombrando(p.id)
    } catch (e) {
      avisarError(e)
    }
  }

  const duplicar = async (p: PaginaDiseno) => {
    try {
      const copia = await apiDiseno.crearPagina(prefijo, `${p.nombre} (copia)`)
      const { marcos } = await apiDiseno.pagina(prefijo, p.id)
      for (const m of marcos) await apiDiseno.duplicar(prefijo, m.id, { pagina: copia.id, nombre: m.nombre })
      await useDiseno.getState().recargarResumen()
      irADiseno({ pagina: copia.slug })
    } catch (e) {
      avisarError(e)
    }
  }

  const archivar = async (p: PaginaDiseno) => {
    try {
      await apiDiseno.actualizarPagina(prefijo, p.id, { archivada: true })
      await useDiseno.getState().recargarResumen()
      if (pagina?.id === p.id) irADiseno({ pagina: paginas.find((x) => x.id !== p.id)?.slug ?? null })
      avisar({
        texto: `Archivé la página «${p.nombre}».`,
        accion: {
          etiqueta: 'Deshacer',
          fn: () =>
            void apiDiseno
              .actualizarPagina(prefijo, p.id, { archivada: false })
              .then(() => useDiseno.getState().recargarResumen())
              .catch(avisarError),
        },
      })
    } catch (e) {
      avisarError(e)
    }
  }

  const soltar = async (destino: PaginaDiseno) => {
    const id = arrastrando
    setArrastrando(null)
    setSobre(null)
    if (!id || id === destino.id) return
    const i = paginas.findIndex((p) => p.id === destino.id)
    const desde = paginas.findIndex((p) => p.id === id)
    // va antes del destino si viene de abajo, después si viene de arriba
    const antes = desde > i ? paginas[i - 1]?.orden ?? null : destino.orden
    const despues = desde > i ? destino.orden : paginas[i + 1]?.orden ?? null
    try {
      await apiDiseno.actualizarPagina(prefijo, id, { orden: generateKeyBetween(antes, despues) })
      await useDiseno.getState().recargarResumen()
    } catch (e) {
      avisarError(e)
    }
  }

  const delMenu = menu ? paginas.find((p) => p.id === menu.id) : null
  return (
    <nav className="dz-paginas" aria-label="Páginas">
      <header className="dz-izq__seccion">
        <span>Páginas</span>
        <button className="boton-icono boton-icono--chico" onClick={nueva} aria-label="Página nueva" data-tip="Página nueva">
          <Plus size={14} />
        </button>
      </header>
      <ul className="dz-paginas__lista">
        {paginas.map((p) => {
          const Icono = ICONO[p.tipo]
          const activa = p.id === pagina?.id
          const propia = p.origen === 'propio'
          return (
            <li
              key={p.id}
              className={`dz-pagina${activa ? ' dz-pagina--activa' : ''}${sobre === p.id ? ' dz-pagina--destino' : ''}`}
              draggable={propia && renombrando !== p.id}
              onDragStart={(e) => {
                setArrastrando(p.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (!arrastrando || !propia) return
                e.preventDefault()
                setSobre(p.id)
              }}
              onDragLeave={() => setSobre((s) => (s === p.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault()
                void soltar(p)
              }}
              onDragEnd={() => {
                setArrastrando(null)
                setSobre(null)
              }}
            >
              {activa && <motion.span layoutId="dz-pagina-activa" className="dz-pagina__fondo" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              {renombrando === p.id ? (
                <Renombrar
                  inicial={p.nombre}
                  alTerminar={async (nombre) => {
                    setRenombrando(null)
                    if (!nombre || nombre === p.nombre) return
                    try {
                      await apiDiseno.actualizarPagina(prefijo, p.id, { nombre })
                      await useDiseno.getState().recargarResumen()
                    } catch (e) {
                      avisarError(e)
                    }
                  }}
                />
              ) : (
                <button
                  className="dz-pagina__boton"
                  aria-current={activa ? 'page' : undefined}
                  onClick={() => irADiseno({ pagina: p.slug })}
                  onDoubleClick={() => propia && setRenombrando(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2' && propia) setRenombrando(p.id)
                  }}
                  onContextMenu={(e) => {
                    if (!propia) return
                    e.preventDefault()
                    setMenu({ id: p.id, x: e.clientX, y: e.clientY })
                  }}
                >
                  <Icono size={14} className="dz-pagina__icono" aria-hidden />
                  <span className="dz-pagina__nombre">{p.nombre}</span>
                  {!propia && <Link2 size={10} className="dz-pagina__enlace" aria-label="Viene del código" data-tip="Viene del código" />}
                  <span className="dz-pagina__cuenta">{cuenta(p) || ''}</span>
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {menu && delMenu && (
        <MenuContextual x={menu.x} y={menu.y} alCerrar={() => setMenu(null)}>
          <button className="menu__item" onClick={() => (setMenu(null), setRenombrando(delMenu.id))}>
            <span className="menu__icono">
              <Pencil size={14} />
            </span>
            <span className="menu__texto">Renombrar</span>
            <span className="menu__detalle">F2</span>
          </button>
          <button className="menu__item" onClick={() => (setMenu(null), void duplicar(delMenu))}>
            <span className="menu__icono">
              <Copy size={14} />
            </span>
            <span className="menu__texto">Duplicar</span>
          </button>
          <button className="menu__item menu__item--peligro" onClick={() => (setMenu(null), void archivar(delMenu))}>
            <span className="menu__icono">
              <Archive size={14} />
            </span>
            <span className="menu__texto">Archivar</span>
          </button>
        </MenuContextual>
      )}
    </nav>
  )
}

function Renombrar({ inicial, alTerminar }: { inicial: string; alTerminar: (nombre: string | null) => void }) {
  const [v, setV] = useState(inicial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="dz-pagina__campo"
      value={v}
      aria-label="Nombre de la página"
      onChange={(e) => setV(e.currentTarget.value)}
      onBlur={() => alTerminar(v.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') alTerminar(v.trim() || null)
        if (e.key === 'Escape') alTerminar(null)
      }}
    />
  )
}

/** Menú con el botón derecho, en la posición del mouse. Se cierra con Esc o tocando afuera. */
export function MenuContextual({ x, y, alCerrar, children }: { x: number; y: number; alCerrar: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const afuera = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) alCerrar()
    }
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && alCerrar()
    window.addEventListener('pointerdown', afuera, true)
    window.addEventListener('keydown', tecla, true)
    return () => {
      window.removeEventListener('pointerdown', afuera, true)
      window.removeEventListener('keydown', tecla, true)
    }
  }, [alCerrar])
  return createPortal(
    <div className="diseno">
      <div ref={ref} className="flotante menu dz-menu-contextual" style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 160) }} role="menu">
        <div className="menu__lista">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
