// La tira de páginas de Diseño en el teléfono: la misma forma que la tira de listas del Kanban (pastillas de 32 px que se
// tocan en 44, la activa con el fondo que se desliza). Saber en qué página se está y saltar a otra es un toque. La activa
// queda centrada. Cada página lleva el ícono de su tipo (lienzo, sistema, tabla) y cuántas cosas tiene.
import { Frame, Palette, Table2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { PaginaDiseno, ResumenDiseno } from '../../../../../compartido/diseno/tipos'
import { useDiseno } from '../estado'
import { irADiseno } from '../ruta'

const ICONO = { lienzo: Frame, sistema: Palette, tabla: Table2 }

/**
 * Volver a tocar Diseño en la barra de abajo (o la página activa en la tira): la página vuelve a su principio (el lienzo
 * a ver todo; el documento y la lista, arriba). El nombre es el mismo que usa la barra de abajo.
 */
export const EVENTO_INICIO = 'telar:diseno-inicio'

export function cuentaDePagina(p: PaginaDiseno, resumen: ResumenDiseno): number {
  if (p.tipo === 'lienzo') return p.marcos
  return (p.datos.tipos ?? []).reduce((n, t) => n + (resumen.conteo[t] ?? 0), 0)
}

export function TiraPaginas() {
  const resumen = useDiseno((s) => s.resumen)!
  const pagina = useDiseno((s) => s.pagina)
  const ref = useRef<HTMLDivElement>(null)
  const paginas = resumen.paginas.filter((p) => !p.archivada)

  // La activa queda centrada en la tira.
  useEffect(() => {
    const tira = ref.current
    const activa = tira?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!tira || !activa) return
    const destino = activa.offsetLeft - (tira.clientWidth - activa.offsetWidth) / 2
    tira.scrollTo({ left: Math.max(0, destino), behavior: 'smooth' })
  }, [pagina?.id])

  return (
    <nav className="dzm-tira" ref={ref} aria-label="Páginas de Diseño">
      {paginas.map((p) => {
        const Icono = ICONO[p.tipo]
        const activa = p.id === pagina?.id
        const cuenta = cuentaDePagina(p, resumen)
        const nombre = p.nombre.length > 18 ? `${p.nombre.slice(0, 17).trimEnd()}…` : p.nombre
        return (
          <button
            key={p.id}
            type="button"
            className={`dzm-tira__pagina${activa ? ' dzm-tira__pagina--activa' : ''}`}
            aria-current={activa ? 'page' : undefined}
            aria-label={`${p.nombre}${cuenta ? `, ${cuenta}` : ''}${p.origen === 'importado' ? ', viene del código' : ''}`}
            onClick={() => (activa ? window.dispatchEvent(new Event(EVENTO_INICIO)) : irADiseno({ pagina: p.slug, sel: null }))}
          >
            {activa && <motion.span layoutId="dzm-pagina-activa" className="dzm-tira__fondo" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
            <Icono size={15} className="dzm-tira__icono" aria-hidden />
            <span className="dzm-tira__nombre">{nombre}</span>
            {cuenta > 0 && <span className="dzm-tira__cuenta">{cuenta}</span>}
          </button>
        )
      })}
    </nav>
  )
}
