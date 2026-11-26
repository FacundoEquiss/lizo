// Lo que el inspector sabe de una capa sale del DOM vivo de su marco (iframe sin scripts, mismo origen): reglas que le
// aplican, estilos calculados y HTML (compartido/diseno/reglas.ts). Se vuelve a leer cuando el iframe se dibuja de nuevo,
// cuando cambia la revisión del marco y cuando el inspector mismo cambia algo (refrescar).
import { useCallback, useEffect, useState } from 'react'
import { detalleDeElemento, type DetalleCapa } from '../../../../../compartido/diseno/reglas'
import { useDiseno } from '../estado'
import { documentoDe, elementoDeCapa } from '../lienzo/elegir'

export interface DetalleVivo {
  detalle: DetalleCapa
  el: HTMLElement
  /** Posición y tamaño respecto del marco. */
  caja: { x: number; y: number; ancho: number; alto: number }
  cs: CSSStyleDeclaration
}

export function useDetalle(marco: string | null, capa: string | null): { vivo: DetalleVivo | null; refrescar: () => void } {
  const revision = useDiseno((s) => (marco ? s.completos[marco]?.marco.revision : undefined))
  const probarValor = useDiseno((s) => s.probarValor)
  const [v, setV] = useState(0)
  const [vivo, setVivo] = useState<DetalleVivo | null>(null)
  const refrescar = useCallback(() => setV((x) => x + 1), [])

  useEffect(() => {
    if (!marco) return
    const f = (e: Event) => {
      if ((e as CustomEvent<string>).detail === marco) setV((x) => x + 1)
    }
    window.addEventListener('telar:diseno-iframe', f)
    return () => window.removeEventListener('telar:diseno-iframe', f)
  }, [marco])

  useEffect(() => {
    if (!marco) return setVivo(null)
    const doc = documentoDe(marco)
    const el = capa ? elementoDeCapa(marco, capa) : (doc?.body ?? null)
    if (!el || !doc?.body) return setVivo(null)
    try {
      const detalle = detalleDeElemento(el, { maxHtml: 24000 })
      const r = el.getBoundingClientRect()
      setVivo({ detalle, el, caja: { x: Math.round(r.x), y: Math.round(r.y), ancho: Math.round(r.width), alto: Math.round(r.height) }, cs: el.ownerDocument.defaultView!.getComputedStyle(el) })
    } catch {
      setVivo(null)
    }
  }, [marco, capa, revision, v, probarValor])

  // si el marco todavía no estaba vivo, se reintenta un par de veces
  useEffect(() => {
    if (vivo || !marco) return
    const t = setInterval(() => setV((x) => x + 1), 400)
    const fin = setTimeout(() => clearInterval(t), 5000)
    return () => {
      clearInterval(t)
      clearTimeout(fin)
    }
  }, [vivo, marco])

  return { vivo, refrescar }
}
