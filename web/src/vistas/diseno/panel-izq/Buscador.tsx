// Buscador de Diseño (plan 6.2): marcos, capas (nombre y texto), tokens (nombre y valor: "#38bde6" encuentra el color),
// activos, piezas y textos. Se resuelve en el servidor. ↑ ↓ y Enter llevan al resultado (cambia de página si hace falta).
import { Box, Frame, Image as IconoImagen, Palette, Puzzle, Search, Type, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Girando } from '../../../ui/comunes'
import { apiDiseno, type ResultadoBusquedaDiseno } from '../api'
import { useDiseno } from '../estado'
import { irADiseno } from '../ruta'

const GRUPOS: [string, string[]][] = [
  ['Marcos', ['marco']],
  ['Capas', ['capa']],
  ['Tokens y colores', ['token', 'estilo_texto', 'color_suelto']],
  ['Activos y fuentes', ['activo', 'fuente']],
  ['Piezas y plantillas', ['pieza', 'plantilla']],
  ['Textos', ['texto']],
]

const COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i

function icono(r: ResultadoBusquedaDiseno): ReactNode {
  const c = COLOR.exec(r.detalle)?.[0]
  if ((r.tipo === 'token' || r.tipo === 'color_suelto') && c) return <span className="dz-buscador__muestra" style={{ background: c }} />
  if (r.tipo === 'marco') return <Frame size={14} />
  if (r.tipo === 'capa') return <Box size={14} />
  if (r.tipo === 'activo') return <IconoImagen size={14} />
  if (r.tipo === 'pieza' || r.tipo === 'plantilla') return <Puzzle size={14} />
  if (r.tipo === 'texto' || r.tipo === 'estilo_texto' || r.tipo === 'fuente') return <Type size={14} />
  return <Palette size={14} />
}

/** Lleva a un resultado: la página que lo muestra, encuadre y selección. */
export function irAResultado(r: ResultadoBusquedaDiseno) {
  const s = useDiseno.getState()
  if (r.marco) {
    const sel = r.capa ? `${r.marco}.${r.capa}` : r.marco
    if (r.pagina && r.pagina !== s.pagina?.slug) return irADiseno({ pagina: r.pagina, sel })
    s.seleccionar({ marco: r.marco, capa: r.capa ?? null })
    window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar', { detail: { marco: r.marco, capa: r.capa } }))
    return
  }
  if (r.itemTipo) {
    const item = r.id
    if (r.itemTipo === 'pieza' || r.itemTipo === 'plantilla') {
      s.setPref({ pestanaIzq: 'piezas' })
      s.seleccionar({ item })
      return
    }
    const paginas = s.resumen?.paginas.filter((p) => !p.archivada) ?? []
    const pg = paginas.find((p) => p.id === s.pagina?.id && p.datos.tipos?.includes(r.itemTipo!)) ?? paginas.find((p) => p.datos.tipos?.includes(r.itemTipo!))
    if (pg && pg.id !== s.pagina?.id) return irADiseno({ pagina: pg.slug, sel: `item:${item}` })
    s.seleccionar({ item })
    window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar-item', { detail: { item } }))
  }
}

export function Buscador() {
  const prefijo = useDiseno((s) => s.prefijo)!
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ResultadoBusquedaDiseno[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [activo, setActivo] = useState(0)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const f = () => {
      campo.current?.focus()
      campo.current?.select()
    }
    window.addEventListener('telar:diseno-buscar', f)
    return () => window.removeEventListener('telar:diseno-buscar', f)
  }, [])

  useEffect(() => {
    const t = q.trim()
    if (!t) {
      setResultados(null)
      return
    }
    let vivo = true
    setCargando(true)
    const reloj = setTimeout(() => {
      apiDiseno
        .buscar(prefijo, t)
        .then((r) => {
          if (!vivo) return
          setResultados(r)
          setActivo(0)
        })
        .catch(() => vivo && setResultados([]))
        .finally(() => vivo && setCargando(false))
    }, 160)
    return () => {
      vivo = false
      clearTimeout(reloj)
    }
  }, [q, prefijo])

  const agrupados = useMemo(() => {
    if (!resultados) return []
    return GRUPOS.map(([titulo, tipos]) => ({ titulo, lista: resultados.filter((r) => tipos.includes(r.tipo)) })).filter((g) => g.lista.length)
  }, [resultados])
  const plano = useMemo(() => agrupados.flatMap((g) => g.lista), [agrupados])

  const elegir = (r: ResultadoBusquedaDiseno) => {
    irAResultado(r)
    campo.current?.blur()
  }

  return (
    <div className="dz-buscador">
      <label className="dz-buscador__campo">
        <Search size={14} className="dz-buscador__lupa" aria-hidden />
        <input
          ref={campo}
          value={q}
          placeholder="Buscar en el diseño"
          aria-label="Buscar en el diseño"
          aria-keyshortcuts="Control+F /"
          spellCheck={false}
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActivo((a) => Math.min(plano.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActivo((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              const r = plano[activo]
              if (r) elegir(r)
            } else if (e.key === 'Escape') {
              if (q) setQ('')
              else e.currentTarget.blur()
              e.stopPropagation()
            }
          }}
        />
        {cargando ? <Girando tam={12} /> : q && (
          <button className="dz-buscador__limpiar" onClick={() => setQ('')} aria-label="Limpiar la búsqueda">
            <X size={12} />
          </button>
        )}
      </label>
      {resultados && (
        <div className="dz-buscador__resultados" role="listbox" aria-label="Resultados">
          {plano.length === 0 && !cargando && <p className="dz-buscador__vacio">Nada con «{q.trim()}».</p>}
          {agrupados.map((g) => (
            <div key={g.titulo} className="dz-buscador__grupo">
              <p className="dz-buscador__titulo">{g.titulo}</p>
              {g.lista.map((r) => {
                const i = plano.indexOf(r)
                return (
                  <button
                    key={r.id}
                    role="option"
                    aria-selected={i === activo}
                    className={`dz-buscador__fila${i === activo ? ' dz-buscador__fila--activa' : ''}`}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => elegir(r)}
                  >
                    <span className="dz-buscador__icono">{icono(r)}</span>
                    <span className="dz-buscador__nombre">{r.nombre}</span>
                    <span className="dz-buscador__detalle">{r.detalle}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
