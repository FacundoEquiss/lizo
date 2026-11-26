// Paso 3: lo que tiene nombre y lo que no. Variables declaradas → token (nombre original, alcance, dónde se declara y dónde
// se usa). Colores escritos a mano → color_suelto (valor normalizado, veces, usos, igual a un token, a un paso de otro).
// Tamaños de letra, pesos, familias, radios, sombras, duraciones, curvas y @keyframes → tokens "sueltos" de su clase.
// Pares de relleno y contorno de los textos con borde → estilo_texto.
import path from 'node:path'
import type { Declaration, Node as NodoPostcss } from 'postcss'
import { aRgb, deltaE, familiaDeColor, normalizarColor } from '../../compartido/diseno/tokens'
import type { ClaseToken, Uso } from '../../compartido/diseno/tipos'
import type { Perfil } from '../../compartido/diseno/perfil'
import type { HojaLeida } from './hojas'
import type { Paquete } from './paquete'

const MAX_USOS = 40
const COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\([^()]*\)/g
const NOMBRADOS = /(?:^|[\s,(])(white|black)(?=$|[\s,)])/gi

function selectorDe(n: NodoPostcss): string {
  let p = n.parent as (NodoPostcss & { selector?: string; name?: string; params?: string }) | undefined
  while (p) {
    if (p.type === 'rule') return p.selector ?? ''
    if (p.type === 'atrule') return `@${p.name} ${p.params ?? ''}`.trim()
    p = p.parent as typeof p
  }
  return ''
}

function enKeyframes(n: NodoPostcss): string | null {
  let p = n.parent as (NodoPostcss & { name?: string; params?: string }) | undefined
  while (p) {
    if (p.type === 'atrule' && /keyframes/i.test(p.name ?? '')) return p.params ?? ''
    p = p.parent as typeof p
  }
  return null
}

function claseDeValor(v: string): ClaseToken {
  if (aRgb(v)) return 'color'
  if (/^-?[\d.]+(px|rem|em|%|vw|vh|cqw|cqh)$/.test(v) || /^calc\(/.test(v)) return 'medida'
  if (/^[\d.]+m?s$/.test(v)) return 'duracion'
  if (/cubic-bezier|^ease|^linear|^steps/.test(v)) return 'curva'
  if (/^-?[\d.]+$/.test(v)) return 'numero'
  if (/\d+px\s+[\d-]+px/.test(v) && /(#|rgb)/.test(v)) return 'sombra'
  return 'texto'
}

/** "calc(var(--hu) * 19)" → "19 hu" (si --hu es una unidad del perfil). */
function enUnidad(valor: string, unidades: string[]): string | undefined {
  const m = /^calc\(\s*var\((--[\w-]+)\)\s*\*\s*([\d.]+)\s*\)$/.exec(valor.trim()) ?? /^calc\(\s*([\d.]+)\s*\*\s*var\((--[\w-]+)\)\s*\)$/.exec(valor.trim())
  if (!m) return undefined
  const [v, n] = m[1]!.startsWith('--') ? [m[1]!, m[2]!] : [m[2]!, m[1]!]
  if (!unidades.includes(v)) return undefined
  return `${n.replace('.', ',')} ${v.replace(/^--/, '')}`
}

export interface ResultadoTokens {
  variables: number
  colores: number
  sueltos: number
  estilos: number
}

export function analizarTokens(hojas: HojaLeida[], perfil: Perfil, paquete: Paquete): ResultadoTokens {
  const unidades = Object.keys(perfil.unidades ?? {})
  const variables = new Map<string, { declaradoEn: (Uso & { valor: string })[]; alcances: Set<string>; valor: string }>()
  const usosVar = new Map<string, Uso[]>()
  const colores = new Map<string, { valor: string; veces: number; usos: Uso[] }>()
  const sueltos = new Map<string, { clase: ClaseToken; propiedad: string; valor: string; grupo: string; veces: number; usos: Uso[] }>()
  const keyframes = new Map<string, { texto: string; usos: Uso[]; archivo: string; linea: number }>()
  const contornos = new Map<string, { c: string; b: string; g?: string; tamano?: string; veces: number; usos: Uso[] }>()

  const suelto = (clase: ClaseToken, propiedad: string, valor: string, grupo: string, uso: Uso) => {
    const v = valor.replace(/\s+/g, ' ').trim()
    if (!v || /^(inherit|initial|unset|none|normal|0|0px|auto)$/.test(v)) return
    const k = `${propiedad}:${v}`
    let s = sueltos.get(k)
    if (!s) sueltos.set(k, (s = { clase, propiedad, valor: v, grupo, veces: 0, usos: [] }))
    s.veces++
    if (s.usos.length < MAX_USOS) s.usos.push(uso)
  }

  for (const h of hojas) {
    const archivo = path.basename(h.archivo)
    h.raiz.walkAtRules(/keyframes$/i, (a) => {
      const linea = a.source?.start?.line ?? 0
      if (!keyframes.has(a.params)) keyframes.set(a.params, { texto: a.toString().slice(0, 900), usos: [], archivo, linea })
    })
    h.raiz.walkDecls((d: Declaration) => {
      const linea = d.source?.start?.line ?? 0
      const selector = selectorDe(d)
      const uso: Uso = { archivo, linea, selector, propiedad: d.prop }
      const kf = enKeyframes(d)
      // variables declaradas
      if (d.prop.startsWith('--')) {
        let v = variables.get(d.prop)
        if (!v) variables.set(d.prop, (v = { declaradoEn: [], alcances: new Set(), valor: d.value.trim() }))
        v.declaradoEn.push({ ...uso, valor: d.value.trim() })
        v.alcances.add(selector)
      }
      // usos de variables
      for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        const lista = usosVar.get(m[1]!) ?? []
        if (lista.length < MAX_USOS * 3) lista.push(uso)
        usosVar.set(m[1]!, lista)
      }
      // colores escritos a mano (también los de las declaraciones de variables: se marcan "igual a")
      const valorSinUrl = d.value.replace(/url\([^)]*\)/g, '')
      for (const m of [...valorSinUrl.matchAll(COLOR), ...valorSinUrl.matchAll(NOMBRADOS)]) {
        const crudo = (m[1] ?? m[0]).trim()
        const n = normalizarColor(crudo)
        if (!n) continue
        let c = colores.get(n)
        if (!c) colores.set(n, (c = { valor: n, veces: 0, usos: [] }))
        c.veces++
        if (c.usos.length < MAX_USOS) c.usos.push(uso)
      }
      if (kf) return
      // valores sin nombre de tipografía, forma y movimiento
      const p = d.prop.toLowerCase()
      if (p === 'font-size') suelto('medida', p, d.value, 'Tipografía · tamaños', uso)
      else if (p === 'font-weight') suelto('peso', p, d.value, 'Tipografía · pesos', uso)
      else if (p === 'font-family') suelto('fuente', p, d.value, 'Tipografía · familias', uso)
      else if (p === 'font') {
        const m = /^(?:(italic|normal)\s+)?(\d{3}|bold|normal)?\s*([^/\s]+)(?:\/[^\s]+)?\s+(.+)$/.exec(d.value.trim())
        if (m?.[2]) suelto('peso', 'font-weight', m[2], 'Tipografía · pesos', uso)
        if (m?.[3]) suelto('medida', 'font-size', m[3], 'Tipografía · tamaños', uso)
        if (m?.[4]) suelto('fuente', 'font-family', m[4], 'Tipografía · familias', uso)
      } else if (/^border(-\w+)*-radius$/.test(p)) suelto('radio', 'border-radius', d.value, 'Radios', uso)
      else if (p === 'box-shadow' || p === 'text-shadow') suelto('sombra', p, d.value, 'Sombras', uso)
      else if (/^(transition|animation)(-duration)?$/.test(p) || /-delay$/.test(p)) {
        for (const m of d.value.matchAll(/(?:^|[\s,])(-?[\d.]+m?s)\b/g)) suelto('duracion', 'duración', m[1]!, 'Movimiento · duraciones', uso)
        for (const m of d.value.matchAll(/cubic-bezier\([^)]*\)|steps\([^)]*\)|\b(ease-in-out|ease-in|ease-out|ease|linear)\b/g)) suelto('curva', 'curva', m[0], 'Movimiento · curvas', uso)
        if (p.startsWith('animation') && !p.endsWith('duration') && !p.endsWith('delay'))
          for (const nombre of d.value.split(/[\s,]+/)) {
            const k = keyframes.get(nombre)
            if (k && k.usos.length < MAX_USOS) k.usos.push(uso)
          }
      } else if (/-timing-function$/.test(p)) suelto('curva', 'curva', d.value, 'Movimiento · curvas', uso)
    })
    // texto con contorno (relleno --c y borde --b en la misma regla, como el .rt del juego)
    h.raiz.walkRules((r) => {
      let c: string | undefined
      let b: string | undefined
      let g: string | undefined
      let tamano: string | undefined
      r.each((n) => {
        if (n.type !== 'decl') return
        if (n.prop === '--c') c = n.value.trim()
        else if (n.prop === '--b') b = n.value.trim()
        else if (n.prop === '--g') g = n.value.trim()
        else if (n.prop === 'font-size') tamano = n.value.trim()
      })
      if (!c || !b || !aRgb(c) || !aRgb(b)) return
      const k = `${normalizarColor(c)}|${normalizarColor(b)}`
      let x = contornos.get(k)
      if (!x) contornos.set(k, (x = { c: normalizarColor(c)!, b: normalizarColor(b)!, g, tamano, veces: 0, usos: [] }))
      x.veces++
      if (x.usos.length < MAX_USOS) x.usos.push({ archivo, linea: r.source?.start?.line ?? 0, selector: r.selector })
    })
  }

  // ── tokens con nombre ──
  const porValor = new Map<string, string>()
  let orden = 0
  const ordenar = () => `a${String(orden++).padStart(6, '0')}`
  for (const [nombre, v] of [...variables].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (nombre === '--telar-origen') continue
    const clase = claseDeValor(v.valor)
    const hex = clase === 'color' ? normalizarColor(v.valor) : null
    if (hex && !porValor.has(hex)) porValor.set(hex, nombre)
    const alcance = [...v.alcances].join(', ')
    const valores = new Set(v.declaradoEn.map((x) => x.valor))
    const grupo = clase === 'color' ? `Variables · ${alcance.length > 40 ? alcance.slice(0, 40) + '…' : alcance}` : clase === 'medida' || clase === 'numero' ? 'Variables · medidas' : 'Variables · otras'
    paquete.item({
      tipo: 'token',
      clave: nombre,
      nombre,
      grupo,
      orden: ordenar(),
      datos: {
        clase,
        css: nombre,
        valor: v.valor,
        alcance,
        declaradoEn: v.declaradoEn.slice(0, MAX_USOS),
        usos: (usosVar.get(nombre) ?? []).slice(0, MAX_USOS),
        veces: (usosVar.get(nombre) ?? []).length,
        ...(valores.size > 1 ? { nota: `Declarada con ${valores.size} valores distintos` } : {}),
      },
    })
  }

  // ── colores sueltos ──
  const lista = [...colores.values()]
  const rgb = new Map(lista.map((c) => [c.valor, aRgb(c.valor)!]))
  for (const c of lista.sort((a, b) => b.veces - a.veces)) {
    let cerca: { valor: string; d: number; veces: number } | null = null
    for (const o of lista) {
      if (o.valor === c.valor) continue
      const d = deltaE(rgb.get(c.valor)!, rgb.get(o.valor)!)
      if (d < 2 && (!cerca || d < cerca.d || (d === cerca.d && o.veces > cerca.veces))) cerca = { valor: o.valor, d, veces: o.veces }
    }
    paquete.item({
      tipo: 'color_suelto',
      clave: c.valor,
      nombre: c.valor,
      grupo: familiaDeColor(rgb.get(c.valor)!),
      orden: ordenar(),
      datos: { valor: c.valor, rgb: rgb.get(c.valor)!, veces: c.veces, usos: c.usos, igualA: porValor.get(c.valor), cercaDe: cerca?.valor, familia: familiaDeColor(rgb.get(c.valor)!) },
    })
  }

  // ── sueltos de tipografía, forma y movimiento ──
  for (const s of [...sueltos.values()].sort((a, b) => b.veces - a.veces)) {
    paquete.item({
      tipo: 'token',
      clave: `${s.propiedad}:${s.valor}`,
      nombre: s.valor,
      grupo: s.grupo,
      orden: ordenar(),
      datos: { clase: s.clase, css: '', valor: s.valor, suelto: true, veces: s.veces, usos: s.usos, unidad: enUnidad(s.valor, unidades) },
    })
  }
  for (const [nombre, k] of keyframes) {
    paquete.item({
      tipo: 'token',
      clave: `@keyframes:${nombre}`,
      nombre,
      grupo: 'Movimiento · animaciones',
      orden: ordenar(),
      datos: { clase: 'animacion', css: '', valor: k.texto, suelto: true, veces: k.usos.length, usos: k.usos, declaradoEn: [{ archivo: k.archivo, linea: k.linea, valor: nombre }] },
    })
  }

  // ── texto con contorno ──
  for (const x of [...contornos.values()].sort((a, b) => b.veces - a.veces)) {
    paquete.item({
      tipo: 'estilo_texto',
      clave: `contorno:${x.c}|${x.b}`,
      nombre: `${x.c} con borde ${x.b}`,
      grupo: 'Texto con contorno',
      orden: ordenar(),
      datos: { clase: 'rt', familia: 'Fredoka', peso: 700, tamano: x.tamano ?? '', interlineado: '1', color: x.c, contorno: { color: x.b, grosor: x.g ?? '' }, veces: x.veces, usos: x.usos },
    })
  }
  return { variables: variables.size, colores: colores.size, sueltos: sueltos.size + keyframes.size, estilos: contornos.size }
}
