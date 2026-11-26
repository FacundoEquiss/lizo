// Un marco "vivo": un <iframe srcdoc> sin scripts (sandbox="allow-same-origin", nunca allow-scripts) del tamaño exacto del
// marco. El zoom lo da el lienzo: el iframe nunca cambia de tamaño, así el CSS de adentro ve siempre su viewport real.
// pointer-events: none siempre (salvo en modo Probar o editando un texto): los gestos los recibe la capa de selección.
import { memo, useEffect, useMemo, useRef } from 'react'
import { documentoDeMarco } from '../../../../../compartido/diseno/documento'
import type { MarcoCompleto } from '../api'
import { useDiseno } from '../estado'
import { iframes } from './vivos'

export const MarcoVivo = memo(function MarcoVivo({ completo, alCargar }: { completo: MarcoCompleto; alCargar?: () => void }) {
  const { marco } = completo
  const cssTokens = useDiseno((s) => s.cssTokens)
  const modo = useDiseno((s) => s.modo)
  const probando = useDiseno((s) => s.probando === marco.id)
  const editando = useDiseno((s) => s.editandoTexto?.marco === marco.id)
  const aplicada = useDiseno((s) => s.aplicada[marco.id])
  const version = useDiseno((s) => s.version)
  const probarValor = useDiseno((s) => s.probarValor)
  const ref = useRef<HTMLIFrameElement>(null)
  const ultimo = useRef<{ doc: string; rev: number } | null>(null)

  const doc = useMemo(() => {
    // un cambio hecho acá ya está en el DOM: no se vuelve a armar el documento (no parpadea)
    if (ultimo.current && aplicada === marco.revision && ultimo.current.rev !== marco.revision) {
      ultimo.current = { doc: ultimo.current.doc, rev: marco.revision }
      return ultimo.current.doc
    }
    const d = documentoDeMarco({
      marco,
      hojas: completo.hojas,
      cssTokens,
      piezas: completo.piezas,
      opciones: { pausar: !probando, modo: modo ?? undefined },
    })
    ultimo.current = { doc: d, rev: marco.revision }
    return d
    // version: fuerza volver a armar después de un error
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marco, completo.hojas, completo.piezas, cssTokens, probando, modo, version])

  // "Probar un valor": cambia la variable en vivo (no se guarda)
  useEffect(() => {
    const d = ref.current?.contentDocument
    if (!d?.documentElement) return
    if (probarValor) d.documentElement.style.setProperty(probarValor.variable, probarValor.valor)
    return () => {
      if (probarValor) d.documentElement?.style.removeProperty(probarValor.variable)
    }
  }, [probarValor, doc])

  useEffect(() => {
    const f = ref.current
    if (!f) return
    iframes.set(marco.id, f)
    return () => {
      if (iframes.get(marco.id) === f) iframes.delete(marco.id)
    }
  }, [marco.id])

  return (
    <iframe
      ref={ref}
      className={`dz-iframe${probando || editando ? ' dz-iframe--activo' : ''}`}
      title={marco.nombre}
      sandbox="allow-same-origin"
      srcDoc={doc}
      width={marco.ancho}
      height={marco.alto}
      tabIndex={-1}
      onLoad={() => {
        const f = ref.current
        if (f) iframes.set(marco.id, f)
        const d = f?.contentDocument
        if (d && probarValor) d.documentElement.style.setProperty(probarValor.variable, probarValor.valor)
        window.dispatchEvent(new CustomEvent('telar:diseno-iframe', { detail: marco.id }))
        alCargar?.()
      }}
    />
  )
})
