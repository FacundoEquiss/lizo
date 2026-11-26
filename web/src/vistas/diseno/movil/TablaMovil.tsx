// Una página de tabla (Textos) en el teléfono: la tabla de cinco columnas de la PC pasa a una lista de renglones de dos
// líneas (el texto y su clave), por grupo, con el buscador fijo arriba. Un toque abre la ficha del texto.
import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DatosTexto, ItemDiseno } from '../../../../../compartido/diseno/tipos'
import { Girando } from '../../../ui/comunes'
import { SIN_ITEMS, useDiseno } from '../estado'
import { resaltarLlaves } from '../inspector/Item'
import { usarFuentesDelProyecto } from '../sistema/PaginaSistema'
import { EstadoVacio } from '../ui'
import { useDisenoMovil } from './estado'
import { EVENTO_INICIO } from './TiraPaginas'

export function TablaMovil() {
  const items = useDiseno((s) => (s.items.texto ?? SIN_ITEMS) as ItemDiseno<'texto'>[])
  const cargando = useDiseno((s) => s.cargandoItems.texto)
  const fuentes = useDiseno((s) => (s.items.fuente ?? SIN_ITEMS) as ItemDiseno<'fuente'>[])
  const prefijo = useDiseno((s) => s.prefijo)!
  const mapa = usarFuentesDelProyecto(fuentes, useDiseno.getState().resumen?.proyecto.id ?? prefijo)
  const [filtro, setFiltro] = useState('')
  const [conLetra, setConLetra] = useState(() => localStorage.getItem('telar.diseno.tabla.letra') === 'si')
  const ref = useRef<HTMLDivElement>(null)
  const letra = fuentes[0] ? mapa.get(fuentes[0].datos.familia) : undefined

  useEffect(() => {
    void useDiseno.getState().cargarItems('texto')
    void useDiseno.getState().cargarItems('fuente')
  }, [])
  useEffect(() => {
    const f = () => ref.current?.scrollTo({ top: 0, behavior: 'smooth' })
    window.addEventListener(EVENTO_INICIO, f)
    return () => window.removeEventListener(EVENTO_INICIO, f)
  }, [])

  const grupos = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    const lista = items.filter((i) => !i.archivado && (!t || `${i.clave} ${i.datos.valor} ${i.datos.claveOriginal ?? ''}`.toLowerCase().includes(t)))
    const m = new Map<string, ItemDiseno<'texto'>[]>()
    for (const i of lista) {
      const g = i.grupo || i.datos.grupo || 'Textos'
      if (!m.has(g)) m.set(g, [])
      m.get(g)!.push(i)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([g, l]) => [g, l.sort((a, b) => a.clave.localeCompare(b.clave, 'es'))] as const)
  }, [items, filtro])
  const total = grupos.reduce((n, [, l]) => n + l.length, 0)

  if (!items.length)
    return cargando !== false ? (
      <div className="dzm-estado">
        <Girando tam={22} />
      </div>
    ) : (
      <div className="dzm-estado">
        <EstadoVacio icono={<Search size={28} />} titulo="Todavía no hay textos" ayuda="Llegan con la importación del sistema de diseño del proyecto." />
      </div>
    )

  return (
    <div className="dzm-tabla" ref={ref}>
      <div className="dzm-tabla__barra">
        <label className="dzm-buscar">
          <Search size={18} aria-hidden />
          <input
            value={filtro}
            placeholder={`Buscar en ${items.length} textos`}
            aria-label="Buscar en los textos"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => setFiltro(e.currentTarget.value)}
          />
          {filtro && (
            <button type="button" className="dzm-buscar__limpiar" onClick={() => setFiltro('')} aria-label="Borrar la búsqueda">
              <X size={18} />
            </button>
          )}
        </label>
        {letra && (
          <button
            type="button"
            className={`dzm-tabla__letra${conLetra ? ' dzm-tabla__letra--activa' : ''}`}
            aria-pressed={conLetra}
            aria-label="Con la letra del proyecto"
            style={{ fontFamily: `"${letra}", var(--fuente)` }}
            onClick={() => {
              setConLetra(!conLetra)
              localStorage.setItem('telar.diseno.tabla.letra', conLetra ? 'no' : 'si')
            }}
          >
            Aa
          </button>
        )}
      </div>
      {filtro && <p className="dzm-tabla__cuenta">{total === 0 ? `Nada con «${filtro}».` : `${total} ${total === 1 ? 'texto' : 'textos'}`}</p>}
      {grupos.map(([g, lista]) => (
        <section key={g} className="dzm-tabla__grupo">
          <h3 className="dzm-tabla__titulo">
            {g} <span>{lista.length}</span>
          </h3>
          {lista.map((t) => {
            const d: DatosTexto = t.datos
            return (
              <button
                key={t.clave}
                type="button"
                className="dzm-tabla__fila"
                onClick={() => useDisenoMovil.getState().abrirHoja({ tipo: 'item', clave: `texto:${t.clave}` })}
              >
                <span className="dzm-tabla__texto" style={conLetra && letra ? { fontFamily: `"${letra}", var(--fuente)` } : undefined}>
                  {resaltarLlaves(d.valor)}
                </span>
                <span className="dzm-tabla__clave">
                  {d.claveOriginal ?? t.clave}
                  {d.usos ? ` · ${d.usos.length} ${d.usos.length === 1 ? 'uso' : 'usos'}` : ''}
                </span>
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}
