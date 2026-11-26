// La parte de la ruta que es de Diseño: /RC/<tablero>/diseno/<página>?sel=<marco>.<capa> (o ?sel=item:token:--rc-azul).
// La lee del `location` (así no depende de la forma de Ruta) y, al cambiarla, avisa con `popstate` para que la ruta general
// (estado/ruta.ts) se entere.
import { useSyncExternalStore } from 'react'

export interface RutaDiseno {
  pagina: string | null
  sel: string | null
}

function leer(): RutaDiseno {
  const partes = location.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const qs = new URLSearchParams(location.search)
  return { pagina: partes[2] === 'diseno' ? (partes[3] ?? null) : null, sel: qs.get('sel') }
}

let actual = leer()
const oyentes = new Set<() => void>()
window.addEventListener('popstate', () => {
  const n = leer()
  if (n.pagina === actual.pagina && n.sel === actual.sel) return
  actual = n
  for (const o of oyentes) o()
})

export function useRutaDiseno(): RutaDiseno {
  return useSyncExternalStore(
    (cb) => {
      oyentes.add(cb)
      return () => oyentes.delete(cb)
    },
    () => actual,
  )
}

export const rutaDiseno = () => actual

/** Cambia la página o la selección. La selección se reemplaza (no llena el historial); la página se apila. */
export function irADiseno(r: Partial<RutaDiseno>, reemplazar = false) {
  const partes = location.pathname.split('/').filter(Boolean)
  if (partes.length < 2) return
  const pagina = r.pagina !== undefined ? r.pagina : actual.pagina
  const cambiaPagina = pagina !== actual.pagina
  const sel = r.sel !== undefined ? r.sel : cambiaPagina ? null : actual.sel
  const qs = new URLSearchParams(location.search)
  if (sel) qs.set('sel', sel)
  else qs.delete('sel')
  const busqueda = qs.toString()
  const ruta = `/${partes[0]}/${partes[1]}/diseno${pagina ? '/' + encodeURIComponent(pagina) : ''}${busqueda ? '?' + busqueda : ''}`
  if (ruta === location.pathname + location.search) return
  if (reemplazar || !cambiaPagina) history.replaceState(null, '', ruta)
  else history.pushState(null, '', ruta)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Enlace absoluto a una selección (el que copia "Copiar enlace" y el que devuelve el MCP). */
export function enlaceA(pagina: string | null, sel: string | null): string {
  const partes = location.pathname.split('/').filter(Boolean)
  return `${location.origin}/${partes[0] ?? ''}/${partes[1] ?? ''}/diseno${pagina ? '/' + encodeURIComponent(pagina) : ''}${sel ? '?sel=' + encodeURIComponent(sel) : ''}`
}
