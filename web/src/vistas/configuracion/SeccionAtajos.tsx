// Configuración → Atajos: la tabla completa (la misma que el diálogo de la tecla ?), con un buscador arriba. Solo
// lectura: en la 0.2 las teclas no se reasignan.
import { Search, SearchX, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Kbd } from '../../ui/comunes'
import { ATAJOS } from '../../util/atajos'
import { teclaLegible } from '../../util/teclas'
import { EstadoVacio } from '../../ui/EstadoVacio'

/** Sin mayúsculas ni tildes: "busqueda" encuentra "Búsqueda". */
const normal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

export function SeccionAtajos() {
  const [q, setQ] = useState('')
  const grupos = useMemo(() => {
    const palabras = normal(q).split(/\s+/).filter(Boolean)
    if (!palabras.length) return ATAJOS
    return ATAJOS.map((g) => ({
      ...g,
      atajos: g.atajos.filter(([tecla, que]) => {
        const texto = normal(`${que} ${g.titulo} ${teclaLegible(tecla).join(' ')} ${tecla}`)
        return palabras.every((p) => texto.includes(p))
      }),
    })).filter((g) => g.atajos.length)
  }, [q])
  return (
    <div className="config-atajos">
      <label className="config-atajos__buscar">
        <Search size={15} aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Esc con texto borra la búsqueda; sin texto, cierra la Configuración como siempre.
            if (e.key === 'Escape' && q) {
              e.stopPropagation()
              e.nativeEvent.stopImmediatePropagation()
              setQ('')
            }
          }}
          placeholder="Buscar un atajo: copiar, marco, Ctrl G…"
          aria-label="Buscar un atajo"
          spellCheck={false}
        />
        {q && (
          <button type="button" className="boton-icono boton-icono--chico" onClick={() => setQ('')} aria-label="Borrar la búsqueda">
            <X size={14} />
          </button>
        )}
      </label>
      {grupos.length === 0 && (
        <EstadoVacio icono={SearchX} titulo={<>Ningún atajo con «{q.trim()}»</>} ayuda="Probá con otra palabra o con la tecla (por ejemplo, «Ctrl D»)." />
      )}
      {grupos.map((g) => (
        <section key={g.titulo} className="config-atajos__grupo">
          <h3 className="config-grupo__titulo">{g.titulo}</h3>
          {g.atajos.map(([tecla, que]) => (
            <div key={tecla + que} className="config-atajos__fila">
              <span>{que}</span>
              <Kbd atajo={tecla} />
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
