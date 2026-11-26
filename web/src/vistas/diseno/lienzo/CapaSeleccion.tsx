// La capa de selección (plan 6.4 y 6.5): dibujada ENCIMA del lienzo en coordenadas de pantalla (no escala con el zoom).
// Resaltado al pasar (1 px, sin transición), selección (1,5 px) con la etiqueta de medidas, manijas en las capas ubicadas en
// absoluto y la REGLA (Alt o Mayús+M): distancias en rojo entre la selección y lo que hay bajo el mouse.
// Se actualiza por requestAnimationFrame leyendo el viewport y las cajas del iframe, sin estado de React.
import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef, type RefObject } from 'react'
import { useDiseno } from '../estado'
import { elementoDeCapa, esAbsoluta } from './elegir'

interface Caja {
  x: number
  y: number
  w: number
  h: number
  /** px del marco */
  fx: number
  fy: number
  fw: number
  fh: number
}

const MANIJAS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

export function CapaSeleccion({ contenedor }: { contenedor: RefObject<HTMLDivElement | null> }) {
  const rf = useReactFlow()
  const sel = useRef<HTMLDivElement>(null)
  const sobre = useRef<HTMLDivElement>(null)
  const etiqueta = useRef<HTMLDivElement>(null)
  const manijas = useRef<HTMLDivElement>(null)
  const regla = useRef<SVGSVGElement>(null)
  const multi = useRef<HTMLDivElement>(null)
  const unidadSel = useRef<{ clave: string; nombre: string; px: number } | null>(null)
  const arrastre = useRef<{
    tipo: string
    marco: string
    capa: string
    x0: number
    y0: number
    inicio: { left: number; top: number; width: number; height: number }
    movio: boolean
  } | null>(null)

  useEffect(() => {
    let raf = 0
    const cuadro = () => {
      raf = requestAnimationFrame(cuadro)
      const s = useDiseno.getState()
      const vp = rf.getViewport()
      const marcoRect = (id: string): Caja | null => {
        const m = s.marcos.find((x) => x.id === id)
        if (!m) return null
        return { x: m.x * vp.zoom + vp.x, y: m.y * vp.zoom + vp.y, w: m.ancho * vp.zoom, h: m.alto * vp.zoom, fx: 0, fy: 0, fw: m.ancho, fh: m.alto }
      }
      const capaRect = (marco: string, capa: string): Caja | null => {
        const m = s.marcos.find((x) => x.id === marco)
        const el = elementoDeCapa(marco, capa)
        if (!m || !el) return null
        const r = el.getBoundingClientRect()
        return { x: (m.x + r.x) * vp.zoom + vp.x, y: (m.y + r.y) * vp.zoom + vp.y, w: r.width * vp.zoom, h: r.height * vp.zoom, fx: r.x, fy: r.y, fw: r.width, fh: r.height }
      }
      const poner = (el: HTMLElement | null, c: Caja | null) => {
        if (!el) return
        if (!c) {
          el.style.display = 'none'
          return
        }
        el.style.display = 'block'
        el.style.transform = `translate(${c.x}px, ${c.y}px)`
        el.style.width = `${Math.max(0, c.w)}px`
        el.style.height = `${Math.max(0, c.h)}px`
      }
      const { seleccion } = s
      const cajaSel = seleccion.marco ? (seleccion.capa ? capaRect(seleccion.marco, seleccion.capa) : marcoRect(seleccion.marco)) : null
      const so = s.sobre
      const cajaSobre = so && !(so.marco === seleccion.marco && so.capa === seleccion.capa) ? (so.capa ? capaRect(so.marco, so.capa) : marcoRect(so.marco)) : null
      poner(sel.current, cajaSel)
      poner(sobre.current, s.editandoTexto ? null : cajaSobre)
      // varios marcos
      if (multi.current) {
        const otros = seleccion.marcos.length > 1 ? seleccion.marcos.map(marcoRect).filter(Boolean) : []
        multi.current.innerHTML = otros.map((c) => `<div class="dz-sel dz-sel--multi" style="display:block;transform:translate(${c!.x}px,${c!.y}px);width:${c!.w}px;height:${c!.h}px"></div>`).join('')
      }
      // etiqueta de medidas
      if (etiqueta.current) {
        if (cajaSel && !s.editandoTexto) {
          etiqueta.current.style.display = 'block'
          etiqueta.current.textContent = `${Math.round(cajaSel.fw)} × ${Math.round(cajaSel.fh)}`
          etiqueta.current.style.transform = `translate(${cajaSel.x + cajaSel.w / 2}px, ${cajaSel.y + cajaSel.h + 6}px) translateX(-50%)`
        } else etiqueta.current.style.display = 'none'
      }
      // manijas (capas en absoluto de un marco propio)
      if (manijas.current) {
        const m = seleccion.marco ? s.marcos.find((x) => x.id === seleccion.marco) : null
        const movible = Boolean(cajaSel && seleccion.capa && m?.origen === 'propio' && !m.bloqueado && s.herramienta === 'seleccionar' && !s.editandoTexto && esAbsoluta(seleccion.marco!, seleccion.capa))
        manijas.current.style.display = movible ? 'block' : 'none'
        if (movible && cajaSel) {
          manijas.current.style.transform = `translate(${cajaSel.x}px, ${cajaSel.y}px)`
          manijas.current.style.width = `${cajaSel.w}px`
          manijas.current.style.height = `${cajaSel.h}px`
        }
      }
      // la regla
      const svg = regla.current
      if (svg) {
        const midiendo = (s.midiendo || s.reglaFija) && !s.editandoTexto
        let contenido = ''
        if (midiendo && cajaSel && cajaSobre && so?.marco === seleccion.marco) contenido = dibujarRegla(cajaSel, cajaSobre, vp.zoom, unidadSel.current)
        else if (midiendo && !cajaSel && cajaSobre) contenido = etiquetaRegla(cajaSobre.x + cajaSobre.w / 2, cajaSobre.y - 14, `${Math.round(cajaSobre.fw)} × ${Math.round(cajaSobre.fh)}`)
        if (svg.dataset.c !== contenido) {
          svg.innerHTML = contenido
          svg.dataset.c = contenido
        }
      }
    }
    raf = requestAnimationFrame(cuadro)
    return () => cancelAnimationFrame(raf)
  }, [rf])

  // la unidad del proyecto que usa la capa elegida (para "10 px · 10 hu")
  useEffect(
    () =>
      useDiseno.subscribe((s, antes) => {
        if (s.seleccion === antes.seleccion && s.pref.unidad === antes.pref.unidad) return
        unidadSel.current = null
        if (s.pref.unidad !== 'proyecto' || !s.seleccion.marco) return
        const el = s.seleccion.capa ? elementoDeCapa(s.seleccion.marco, s.seleccion.capa) : null
        const unidades = Object.keys(s.resumen?.unidades ?? {})
        if (!el || !unidades.length) return
        const cs = el.ownerDocument.defaultView!.getComputedStyle(el)
        for (const u of unidades) {
          const px = parseFloat(cs.getPropertyValue(u))
          if (px > 0) {
            unidadSel.current = { clave: u, nombre: u.replace(/^--/, ''), px }
            break
          }
        }
      }),
    [],
  )

  // mover y redimensionar una capa en absoluto con las manijas
  const empezar = (tipo: string) => (e: React.PointerEvent) => {
    const s = useDiseno.getState()
    const { marco, capa } = s.seleccion
    if (!marco || !capa) return
    const el = elementoDeCapa(marco, capa)
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const cs = el.ownerDocument.defaultView!.getComputedStyle(el)
    arrastre.current = {
      tipo,
      marco,
      capa,
      x0: e.clientX,
      y0: e.clientY,
      inicio: { left: parseFloat(cs.left) || 0, top: parseFloat(cs.top) || 0, width: parseFloat(cs.width) || el.offsetWidth, height: parseFloat(cs.height) || el.offsetHeight },
      movio: false,
    }
  }
  const mover = (e: React.PointerEvent) => {
    const a = arrastre.current
    if (!a) return
    const z = rf.getViewport().zoom
    let dx = (e.clientX - a.x0) / z
    let dy = (e.clientY - a.y0) / z
    if (Math.abs(dx) + Math.abs(dy) > 1) a.movio = true
    const el = elementoDeCapa(a.marco, a.capa)
    if (!el) return
    const n = { ...a.inicio }
    if (a.tipo === 'mover') {
      n.left += dx
      n.top += dy
    } else {
      if (a.tipo.includes('e')) n.width = Math.max(4, a.inicio.width + dx)
      if (a.tipo.includes('s')) n.height = Math.max(4, a.inicio.height + dy)
      if (a.tipo.includes('w')) {
        dx = Math.min(dx, a.inicio.width - 4)
        n.left += dx
        n.width = a.inicio.width - dx
      }
      if (a.tipo.includes('n')) {
        dy = Math.min(dy, a.inicio.height - 4)
        n.top += dy
        n.height = a.inicio.height - dy
      }
      if (e.shiftKey && a.tipo.length === 2) n.height = (n.width * a.inicio.height) / Math.max(1, a.inicio.width)
    }
    el.style.left = `${Math.round(n.left)}px`
    el.style.top = `${Math.round(n.top)}px`
    if (a.tipo !== 'mover') {
      el.style.width = `${Math.round(n.width)}px`
      el.style.height = `${Math.round(n.height)}px`
    }
  }
  const soltar = () => {
    const a = arrastre.current
    arrastre.current = null
    if (!a?.movio) return
    const el = elementoDeCapa(a.marco, a.capa)
    if (!el) return
    const estilos: Record<string, string> = { left: el.style.left, top: el.style.top }
    if (a.tipo !== 'mover') {
      estilos.width = el.style.width
      estilos.height = el.style.height
    }
    void useDiseno.getState().editar(a.marco, [{ op: 'estilo', capa: a.capa, estilos }], { etiqueta: a.tipo === 'mover' ? 'mover la capa' : 'cambiar el tamaño de la capa' })
  }

  return (
    <div className="dz-capa-sel" aria-hidden="true">
      <div ref={sobre} className="dz-sobre" />
      <div ref={multi} />
      <div ref={sel} className="dz-sel" />
      <div ref={manijas} className="dz-manijas" onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}>
        <div className="dz-manijas__mover" onPointerDown={empezar('mover')} />
        {MANIJAS.map((m) => (
          <div key={m} className={`dz-manija dz-manija--${m}`} onPointerDown={empezar(m)} />
        ))}
      </div>
      <div ref={etiqueta} className="dz-sel__medidas" />
      <svg ref={regla} className="dz-regla" />
    </div>
  )
}

function etiquetaRegla(x: number, y: number, texto: string) {
  const w = texto.length * 6.6 + 10
  return `<g transform="translate(${x},${y})"><rect x="${-w / 2}" y="-9" width="${w}" height="18" rx="4" class="dz-regla__fondo"/><text x="0" y="4" class="dz-regla__texto">${texto}</text></g>`
}

/** Las distancias entre dos cajas (separadas: las brechas; una dentro de otra: los cuatro lados). */
function dibujarRegla(a: Caja, b: Caja, zoom: number, unidad: { nombre: string; px: number } | null): string {
  const partes: string[] = []
  const txt = (d: number) => {
    const v = Math.round(d * 10) / 10
    return unidad ? `${v} · ${Math.round((d / unidad.px) * 10) / 10} ${unidad.nombre}` : `${v}`
  }
  const linea = (x1: number, y1: number, x2: number, y2: number) => partes.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dz-regla__linea"/>`)
  const guia = (x1: number, y1: number, x2: number, y2: number) => partes.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dz-regla__guia"/>`)
  const adentro = (p: Caja, q: Caja) => p.x >= q.x - 0.5 && p.y >= q.y - 0.5 && p.x + p.w <= q.x + q.w + 0.5 && p.y + p.h <= q.y + q.h + 0.5
  partes.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" class="dz-regla__caja"/>`)
  if (adentro(a, b) || adentro(b, a)) {
    const [i, o] = adentro(a, b) ? [a, b] : [b, a]
    const cy = i.y + i.h / 2
    const cx = i.x + i.w / 2
    const lados: [number, number, number, number, number][] = [
      [o.x, cy, i.x, cy, (i.x - o.x) / zoom],
      [i.x + i.w, cy, o.x + o.w, cy, (o.x + o.w - i.x - i.w) / zoom],
      [cx, o.y, cx, i.y, (i.y - o.y) / zoom],
      [cx, i.y + i.h, cx, o.y + o.h, (o.y + o.h - i.y - i.h) / zoom],
    ]
    for (const [x1, y1, x2, y2, d] of lados) {
      if (d < 0.5) continue
      linea(x1, y1, x2, y2)
      partes.push(etiquetaRegla((x1 + x2) / 2, (y1 + y2) / 2, txt(d)))
    }
    return partes.join('')
  }
  // horizontal
  if (a.x + a.w <= b.x || b.x + b.w <= a.x) {
    const [izq, der] = a.x + a.w <= b.x ? [a, b] : [b, a]
    const top = Math.max(a.y, b.y)
    const bot = Math.min(a.y + a.h, b.y + b.h)
    const y = bot > top ? (top + bot) / 2 : a.y + a.h / 2
    linea(izq.x + izq.w, y, der.x, y)
    if (y < der.y || y > der.y + der.h) guia(der.x, y, der.x, y < der.y ? der.y : der.y + der.h)
    if (y < izq.y || y > izq.y + izq.h) guia(izq.x + izq.w, y, izq.x + izq.w, y < izq.y ? izq.y : izq.y + izq.h)
    partes.push(etiquetaRegla((izq.x + izq.w + der.x) / 2, y, txt((der.x - izq.x - izq.w) / zoom)))
  }
  // vertical
  if (a.y + a.h <= b.y || b.y + b.h <= a.y) {
    const [arr, aba] = a.y + a.h <= b.y ? [a, b] : [b, a]
    const izq = Math.max(a.x, b.x)
    const der = Math.min(a.x + a.w, b.x + b.w)
    const x = der > izq ? (izq + der) / 2 : a.x + a.w / 2
    linea(x, arr.y + arr.h, x, aba.y)
    if (x < aba.x || x > aba.x + aba.w) guia(x, aba.y, x < aba.x ? aba.x : aba.x + aba.w, aba.y)
    if (x < arr.x || x > arr.x + arr.w) guia(x, arr.y + arr.h, x < arr.x ? arr.x : arr.x + arr.w, arr.y + arr.h)
    partes.push(etiquetaRegla(x, (arr.y + arr.h + aba.y) / 2, txt((aba.y - arr.y - arr.h) / zoom)))
  }
  // se tocan o se superponen sin contenerse: las distancias entre los bordes izquierdos y superiores
  if (partes.length === 1) {
    const dx = (b.x - a.x) / zoom
    const dy = (b.y - a.y) / zoom
    if (Math.abs(dx) >= 0.5) {
      linea(a.x, b.y + b.h / 2, b.x, b.y + b.h / 2)
      partes.push(etiquetaRegla((a.x + b.x) / 2, b.y + b.h / 2, txt(Math.abs(dx))))
    }
    if (Math.abs(dy) >= 0.5) {
      linea(b.x + b.w / 2, a.y, b.x + b.w / 2, b.y)
      partes.push(etiquetaRegla(b.x + b.w / 2, (a.y + b.y) / 2, txt(Math.abs(dy))))
    }
  }
  return partes.join('')
}
