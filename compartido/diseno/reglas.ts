// Inspección de una capa: las reglas CSS que le aplican (de la que más manda a la que menos, con su archivo y línea gracias
// a --telar-origen), sus estilos calculados y su HTML. La usan la pestaña Código de la web (sobre el iframe vivo) y el
// render del servidor (leer_diseno con capa, por el protocolo de depuración).
// IMPORTANTE: `detalleDeElemento` tiene que ser autocontenida (sin nada de afuera salvo sus parámetros y lo del navegador):
// Playwright la manda como texto a la página.

export interface ReglaAplicada {
  /** "tienda.css:212" · "Este marco" · "Tokens del proyecto" · "Piezas" · "En línea" */
  origen: string
  selector: string
  declaraciones: string
  /** "@media (hover: hover)"… si la regla estaba adentro de una condición. */
  condicion?: string
  especificidad: [number, number, number]
  /** Para ::before / ::after. */
  pseudo?: string
}

export interface DetalleCapa {
  reglas: ReglaAplicada[]
  calculado: Record<string, string>
  html: string
  caja: [number, number, number, number]
  /** Expresiones originales de algunas propiedades ("font-size": "calc(var(--hu) * 19)"). */
  originales: Record<string, string>
}

export const PROPIEDADES_CALCULADAS = [
  'display', 'position', 'top', 'left', 'width', 'height', 'margin', 'padding', 'box-sizing',
  'font-family', 'font-weight', 'font-size', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space',
  'color', 'background-color', 'background-image', 'border', 'border-radius', 'box-shadow', 'opacity', 'transform',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'grid-template-rows',
  'overflow', 'z-index', '-webkit-text-stroke', 'text-shadow', 'filter', 'object-fit', 'container-type',
]

export function detalleDeElemento(el: Element, opciones: { hojas?: Record<string, string>; maxHtml?: number } = {}): DetalleCapa {
  const doc = el.ownerDocument
  const win = doc.defaultView as Window & typeof globalThis
  const cs = win.getComputedStyle(el)
  const props = [
    'display', 'position', 'top', 'left', 'width', 'height', 'margin', 'padding', 'box-sizing',
    'font-family', 'font-weight', 'font-size', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space',
    'color', 'background-color', 'background-image', 'border', 'border-radius', 'box-shadow', 'opacity', 'transform',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'grid-template-rows',
    'overflow', 'z-index', '-webkit-text-stroke', 'text-shadow', 'filter', 'object-fit', 'container-type',
  ]
  const vacio = new Set(['', 'none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)', 'visible', 'static', 'start', 'nowrap', 'stretch', 'row', 'content-box', '0px none rgb(0, 0, 0)'])
  const calculado: Record<string, string> = {}
  for (const p of props) {
    const v = cs.getPropertyValue(p).trim()
    if (v && (!vacio.has(v) || p === 'display' || p === 'position' || p === 'width' || p === 'height' || p === 'font-size' || p === 'color'))
      calculado[p] = v
  }

  // especificidad aproximada (ids, clases/atributos/pseudoclases, etiquetas)
  const especificidad = (sel: string): [number, number, number] => {
    let s = sel.replace(/:(not|is|has)\(([^()]*)\)/g, ' $2').replace(/:where\([^()]*\)/g, '')
    s = s.replace(/"[^"]*"|'[^']*'/g, '')
    const a = (s.match(/#[\w-]+/g) ?? []).length
    const b = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+(\([^)]*\))?/g) ?? []).length
    const c = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, ' ').match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length +
      (s.match(/::[\w-]+/g) ?? []).length
    return [a, b, c]
  }
  const partir = (lista: string) => {
    const r: string[] = []
    let prof = 0
    let ini = 0
    for (let i = 0; i < lista.length; i++) {
      const ch = lista[i]
      if (ch === '(' || ch === '[') prof++
      else if (ch === ')' || ch === ']') prof--
      else if (ch === ',' && prof === 0) {
        r.push(lista.slice(ini, i).trim())
        ini = i + 1
      }
    }
    r.push(lista.slice(ini).trim())
    return r.filter(Boolean)
  }
  const origenDe = (regla: CSSStyleRule, hoja: CSSStyleSheet) => {
    const o = regla.style.getPropertyValue('--telar-origen').trim().replace(/^["']|["']$/g, '')
    if (o) return o
    const nodo = hoja.ownerNode as Element | null
    const marca = nodo?.getAttribute?.('data-telar')
    if (marca === 'marco') return 'Este marco'
    if (marca === 'tokens') return 'Tokens del proyecto'
    if (marca === 'piezas') return 'Piezas'
    if (marca === 'extra') return 'Probando'
    const dh = nodo?.getAttribute?.('data-hoja')
    if (dh) return dh
    const href = hoja.href || ''
    if (href && opciones.hojas) for (const [h, n] of Object.entries(opciones.hojas)) if (href.endsWith(h)) return n
    return href ? href.split('/').pop() || 'hoja' : 'estilos del documento'
  }
  const limpiarDecl = (t: string) =>
    t
      .split(/;(?![^(]*\))/)
      .map((x) => x.trim())
      .filter((x) => x && !x.startsWith('--telar-origen'))
      .join(';\n')
  const reglas: (ReglaAplicada & { orden: number })[] = []
  let orden = 0
  const pseudos = ['::before', '::after']
  const visitar = (lista: CSSRuleList, hoja: CSSStyleSheet, condicion?: string) => {
    for (const regla of Array.from(lista)) {
      orden++
      if (regla instanceof win.CSSStyleRule) {
        for (const sel of partir(regla.selectorText)) {
          const pseudo = pseudos.find((p) => sel.includes(p))
          const base = sel.replace(/::?(before|after|placeholder|marker|selection|first-line|first-letter|backdrop)\b/g, '').trim() || '*'
          let coincide = false
          try {
            coincide = el.matches(base)
          } catch {
            coincide = false
          }
          if (!coincide) continue
          const declaraciones = limpiarDecl(regla.style.cssText)
          if (!declaraciones) break
          reglas.push({ origen: origenDe(regla, hoja), selector: sel, declaraciones, condicion, especificidad: especificidad(sel), pseudo, orden })
          break
        }
      } else if (regla instanceof win.CSSMediaRule) {
        if (win.matchMedia(regla.media.mediaText).matches) visitar(regla.cssRules, hoja, `@media ${regla.media.mediaText}`)
      } else if (regla instanceof win.CSSSupportsRule) {
        if (win.CSS.supports(regla.conditionText)) visitar(regla.cssRules, hoja, `@supports ${regla.conditionText}`)
      } else if ('cssRules' in regla && (regla as CSSGroupingRule).cssRules) {
        const nombre = (regla as CSSRule).cssText.slice(0, (regla as CSSRule).cssText.indexOf('{')).trim()
        if (!/^@(keyframes|font-face|page|property)/.test(nombre)) visitar((regla as CSSGroupingRule).cssRules, hoja, nombre)
      }
    }
  }
  for (const hoja of Array.from(doc.styleSheets)) {
    // lo que agrega Telar para dibujar (tamaño del documento, pausa de las animaciones) no es parte del diseño
    const marca = (hoja.ownerNode as Element | null)?.getAttribute?.('data-telar')
    if (marca === 'base' || marca === 'pausa') continue
    try {
      visitar(hoja.cssRules, hoja)
    } catch {
      // hoja de otro origen: no se puede leer
    }
  }
  reglas.sort((a, b) => {
    if (!!a.pseudo !== !!b.pseudo) return a.pseudo ? 1 : -1
    for (let i = 0; i < 3; i++) if (a.especificidad[i] !== b.especificidad[i]) return b.especificidad[i]! - a.especificidad[i]!
    return b.orden - a.orden
  })
  const enLinea = el.getAttribute('style')
  const salida: ReglaAplicada[] = []
  if (enLinea?.trim()) salida.push({ origen: 'En línea', selector: 'style=""', declaraciones: limpiarDecl(enLinea), especificidad: [1, 0, 0] })
  for (const r of reglas) salida.push({ origen: r.origen, selector: r.selector, declaraciones: r.declaraciones, condicion: r.condicion, especificidad: r.especificidad, pseudo: r.pseudo })

  // la expresión original de algunas propiedades (la de la regla que gana)
  const originales: Record<string, string> = {}
  const buscadas = ['font-size', 'width', 'height', 'left', 'top', 'gap', 'padding', 'margin', 'line-height', 'letter-spacing', 'border-radius', 'color', 'background-color', 'font-family']
  for (const p of buscadas) {
    for (const r of salida) {
      if (r.pseudo) continue
      const m = new RegExp(`(?:^|;\\s*)${p}\\s*:\\s*([^;]+)`, 'i').exec(r.declaraciones.replace(/\n/g, ' '))
      if (m) {
        originales[p] = m[1]!.replace(/\s*!important\s*$/, '').trim()
        break
      }
    }
  }
  const b = el.getBoundingClientRect()
  const max = opciones.maxHtml ?? 20000
  const html = el.outerHTML.length > max ? el.outerHTML.slice(0, max) + '…' : el.outerHTML
  return { reglas: salida, calculado, html, caja: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], originales }
}
