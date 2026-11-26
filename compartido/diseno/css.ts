// CSS: un partidor chico (reglas y bloques @, respetando comentarios, comillas y llaves) y lo que se arma encima:
// los "pseudo-estados" (copiar :hover, :active y :focus como clases .es-hover, .es-active, .es-focus) para que una hoja de
// variantes muestre "normal · encima · apretado" lado a lado sin mouse (la técnica de Storybook).
// Corre igual en la web, el servidor y el importador.

export type BloqueCss =
  | { tipo: 'regla'; selector: string; cuerpo: string; inicio: number }
  | { tipo: 'arroba'; nombre: string; preludio: string; hijos: BloqueCss[] | null; cuerpo: string | null; inicio: number }

const AGRUPADORES = new Set(['media', 'supports', 'container', 'layer', 'document', 'scope', 'starting-style'])

/** Parte el CSS en bloques de primer nivel (y los @media, @supports… con sus hijos). */
export function partirCss(css: string): BloqueCss[] {
  const sin = quitarComentarios(css)
  return partir(sin, 0, sin.length)
}

function partir(s: string, desde: number, hasta: number): BloqueCss[] {
  const r: BloqueCss[] = []
  let i = desde
  while (i < hasta) {
    while (i < hasta && /[\s;]/.test(s[i]!)) i++
    if (i >= hasta) break
    const inicio = i
    // hasta "{" o ";" de primer nivel
    let j = i
    let q: string | null = null
    let paren = 0
    while (j < hasta) {
      const c = s[j]!
      if (q) {
        if (c === '\\') j++
        else if (c === q) q = null
      } else if (c === '"' || c === "'") q = c
      else if (c === '(') paren++
      else if (c === ')') paren = Math.max(0, paren - 1)
      else if (paren === 0 && (c === '{' || c === ';')) break
      j++
    }
    const cabeza = s.slice(i, j).trim()
    if (j >= hasta) break
    if (s[j] === ';') {
      // @import, @charset, @layer a, b;
      if (cabeza.startsWith('@')) {
        const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(cabeza)!
        r.push({ tipo: 'arroba', nombre: m[1]!.toLowerCase(), preludio: m[2]!.trim(), hijos: null, cuerpo: null, inicio })
      }
      i = j + 1
      continue
    }
    const fin = cierre(s, j, hasta)
    const dentro = s.slice(j + 1, fin)
    if (cabeza.startsWith('@')) {
      const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(cabeza)!
      const nombre = m[1]!.toLowerCase()
      if (AGRUPADORES.has(nombre)) r.push({ tipo: 'arroba', nombre, preludio: m[2]!.trim(), hijos: partir(s, j + 1, fin), cuerpo: null, inicio })
      else r.push({ tipo: 'arroba', nombre, preludio: m[2]!.trim(), hijos: null, cuerpo: dentro, inicio })
    } else r.push({ tipo: 'regla', selector: cabeza, cuerpo: dentro, inicio })
    i = fin + 1
  }
  return r
}

function cierre(s: string, abre: number, hasta: number): number {
  let prof = 0
  let q: string | null = null
  for (let k = abre; k < hasta; k++) {
    const c = s[k]!
    if (q) {
      if (c === '\\') k++
      else if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") q = c
    else if (c === '{') prof++
    else if (c === '}') {
      prof--
      if (prof === 0) return k
    }
  }
  return hasta
}

export function quitarComentarios(css: string): string {
  let r = ''
  let q: string | null = null
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!
    if (q) {
      r += c
      if (c === '\\' && i + 1 < css.length) r += css[++i]
      else if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      r += c
      continue
    }
    if (c === '/' && css[i + 1] === '*') {
      const fin = css.indexOf('*/', i + 2)
      // se reemplaza por espacios para conservar los saltos de línea (y así los números de línea)
      const trozo = css.slice(i, fin < 0 ? css.length : fin + 2)
      r += trozo.replace(/[^\n]/g, ' ')
      i = fin < 0 ? css.length : fin + 1
      continue
    }
    r += c
  }
  return r
}

export function serializarBloques(bloques: BloqueCss[], sangria = ''): string {
  let s = ''
  for (const b of bloques) {
    if (b.tipo === 'regla') s += `${sangria}${b.selector} {${b.cuerpo}}\n`
    else if (b.hijos) s += `${sangria}@${b.nombre} ${b.preludio} {\n${serializarBloques(b.hijos, sangria + '  ')}${sangria}}\n`
    else if (b.cuerpo !== null) s += `${sangria}@${b.nombre} ${b.preludio} {${b.cuerpo}}\n`
    else s += `${sangria}@${b.nombre} ${b.preludio};\n`
  }
  return s
}

/** Parte una lista de selectores por comas de primer nivel. */
export function partirSelectores(lista: string): string[] {
  const r: string[] = []
  let prof = 0
  let q: string | null = null
  let ini = 0
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i]!
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") q = c
    else if (c === '(' || c === '[') prof++
    else if (c === ')' || c === ']') prof = Math.max(0, prof - 1)
    else if (c === ',' && prof === 0) {
      r.push(lista.slice(ini, i).trim())
      ini = i + 1
    }
  }
  r.push(lista.slice(ini).trim())
  return r.filter(Boolean)
}

const ESTADO = /:(hover|active|focus-visible|focus-within|focus)\b/
const CLASE_ESTADO: Record<string, string> = {
  hover: '.es-hover',
  active: '.es-active',
  'focus-visible': '.es-focus',
  focus: '.es-focus',
  'focus-within': '.es-focus',
}

export function selectorConEstados(sel: string): string | null {
  if (!ESTADO.test(sel)) return null
  return sel.replace(/:(hover|active|focus-visible|focus-within|focus)\b/g, (_t, e: string) => CLASE_ESTADO[e]!)
}

/**
 * Copia las reglas con :hover, :active y :focus como clases (.es-hover, .es-active, .es-focus). Las que están dentro de
 * `@media (hover: hover)` salen afuera (un marco sin mouse no las aplicaría); las de otros @media quedan adentro.
 */
export function estadosDeCss(css: string): string {
  const salida = estadosDe(partirCss(css), true)
  return serializarBloques(salida)
}

function estadosDe(bloques: BloqueCss[], arriba: boolean): BloqueCss[] {
  const r: BloqueCss[] = []
  for (const b of bloques) {
    if (b.tipo === 'regla') {
      const sels = partirSelectores(b.selector)
        .map(selectorConEstados)
        .filter((x): x is string => !!x)
      if (sels.length) r.push({ ...b, selector: sels.join(', ') })
      continue
    }
    if (!b.hijos) continue
    const hijos = estadosDe(b.hijos, false)
    if (!hijos.length) continue
    const esHover = b.nombre === 'media' && /\(\s*(any-)?hover\s*:\s*hover\s*\)/.test(b.preludio) && !/\band\b|,/.test(b.preludio.replace(/\(\s*(any-)?hover\s*:\s*hover\s*\)/, ''))
    if (esHover) r.push(...hijos)
    else r.push({ ...b, hijos })
  }
  void arriba
  return r
}

/** Las declaraciones de un cuerpo de regla ("a: b; c: d") como pares, respetando paréntesis y comillas. */
export function declaraciones(cuerpo: string): [string, string, boolean][] {
  const r: [string, string, boolean][] = []
  let prof = 0
  let q: string | null = null
  let ini = 0
  const agregar = (t: string) => {
    const i = t.indexOf(':')
    if (i < 0) return
    let v = t.slice(i + 1).trim()
    const imp = /!\s*important\s*$/i.test(v)
    if (imp) v = v.replace(/!\s*important\s*$/i, '').trim()
    const k = t.slice(0, i).trim()
    if (k) r.push([k, v, imp])
  }
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i]!
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") q = c
    else if (c === '(') prof++
    else if (c === ')') prof = Math.max(0, prof - 1)
    else if (c === ';' && prof === 0) {
      agregar(cuerpo.slice(ini, i))
      ini = i + 1
    }
  }
  agregar(cuerpo.slice(ini))
  return r
}

/** Número de línea (desde 1) de una posición. */
export function lineaDe(texto: string, pos: number): number {
  let n = 1
  for (let i = 0; i < pos && i < texto.length; i++) if (texto.charCodeAt(i) === 10) n++
  return n
}
