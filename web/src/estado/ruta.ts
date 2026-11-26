// Rutas: /RC → primer tablero · /RC/pendientes → kanban · /RC/pendientes/lienzo → lienzo · ?tarjeta=RC-12 abre la tarjeta.
// Diseño: /RC/pendientes/diseno/<página>?sel=<marco>.<capa>
import { useSyncExternalStore } from 'react'

export interface Ruta {
  prefijo: string | null
  slug: string | null
  vista: 'kanban' | 'lienzo' | 'diseno'
  tarjeta: string | null
  pagina: string | null
  sel: string | null
}

export function leerRuta(): Ruta {
  const partes = location.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const qs = new URLSearchParams(location.search)
  return {
    prefijo: partes[0]?.toUpperCase() ?? null,
    slug: partes[1] ?? null,
    vista: partes[2] === 'lienzo' ? 'lienzo' : partes[2] === 'diseno' ? 'diseno' : 'kanban',
    tarjeta: qs.get('tarjeta'),
    pagina: partes[2] === 'diseno' ? (partes[3] ?? null) : null,
    sel: partes[2] === 'diseno' ? qs.get('sel') : null,
  }
}

let actual = leerRuta()
const oyentes = new Set<() => void>()
function avisar() {
  actual = leerRuta()
  for (const o of oyentes) o()
}
window.addEventListener('popstate', avisar)

export function irA(r: Partial<Ruta>, reemplazar = false) {
  const nueva = { ...actual, ...r }
  if (nueva.vista !== 'diseno' || (r.vista === 'diseno' && actual.vista !== 'diseno')) {
    nueva.pagina = r.pagina ?? null
    nueva.sel = r.sel ?? null
  }
  let ruta = '/'
  if (nueva.prefijo) ruta += encodeURIComponent(nueva.prefijo)
  if (nueva.prefijo && nueva.slug) ruta += '/' + encodeURIComponent(nueva.slug)
  if (nueva.prefijo && nueva.slug && nueva.vista === 'lienzo') ruta += '/lienzo'
  if (nueva.prefijo && nueva.slug && nueva.vista === 'diseno') ruta += '/diseno' + (nueva.pagina ? '/' + encodeURIComponent(nueva.pagina) : '')
  const qs = new URLSearchParams()
  if (nueva.vista === 'diseno' && nueva.sel) qs.set('sel', nueva.sel)
  if (nueva.tarjeta) qs.set('tarjeta', nueva.tarjeta)
  if (qs.size) ruta += `?${qs}`
  if (ruta === location.pathname + location.search) return
  if (reemplazar) history.replaceState(null, '', ruta)
  else history.pushState(null, '', ruta)
  avisar()
}

export function useRuta(): Ruta {
  return useSyncExternalStore(
    (cb) => {
      oyentes.add(cb)
      return () => oyentes.delete(cb)
    },
    () => actual,
  )
}

export const rutaActual = () => actual
