// Verifica el contraste (WCAG 2.1) de los pares de colores del tema claro y del oscuro, leyendo web/src/estilos/tokens.css,
// y que los grises de superficie del oscuro sean neutros con un punto de frío (B ≥ R y B − R ≤ 6).
//
//   node scripts/contraste.mjs          tabla y resumen; sale con error si algo no cumple
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../web/src/estilos/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function bloque(selector) {
  const i = css.indexOf(selector)
  if (i === -1) throw new Error(`No encontré ${selector}`)
  const abre = css.indexOf('{', i)
  const cierra = css.indexOf('\n}', abre)
  const valores = {}
  for (const m of css.slice(abre + 1, cierra).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) valores[m[1]] = m[2].trim()
  return valores
}

const claro = bloque(":root,\n[data-theme='light']")
const oscuro = { ...claro, ...bloque("[data-theme='dark'] {") }

const hex = (v) => {
  const m = /^#([0-9a-f]{6})$/i.exec(v ?? '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const lineal = (c) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminancia = ([r, g, b]) => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b)
const relacion = (a, b) => {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

function color(tema, nombre) {
  let v = tema[nombre]
  for (let i = 0; i < 4 && v && v.startsWith('var('); i++) v = tema[v.slice(4, -1).trim()]
  const c = hex(v)
  if (!c) throw new Error(`${nombre} no es un hexadecimal (${v})`)
  return c
}

const pares = [
  // [tema, texto, fondos, mínimo, nota]
  ['oscuro', '--c-texto', ['--c-fondo', '--c-superficie', '--c-elevada'], 4.5],
  ['oscuro', '--c-texto-2', ['--c-fondo', '--c-superficie', '--c-elevada'], 4.5],
  ['oscuro', '--c-texto-3', ['--c-fondo', '--c-bandeja', '--c-superficie', '--c-elevada'], 4.5],
  ['oscuro', '--c-acento', ['--c-fondo', '--c-superficie', '--c-elevada'], 4.5],
  ['oscuro', '--c-sobre-acento', ['--c-acento-solido'], 4.5],
  ['oscuro', '--c-ok', ['--c-superficie'], 4.5],
  ['oscuro', '--c-peligro', ['--c-superficie'], 4.5],
  ['oscuro', '--c-ia', ['--c-superficie'], 4.5],
  ['oscuro', '--c-ia-texto', ['--c-ia-suave', '--c-elevada', '--c-superficie'], 4.5, 'pastillas de mención (plan de la IA integrada, 14.1)'],
  ['oscuro', '--c-sobre-ia', ['--c-ia'], 4.5, 'el número de la campana'],
  ['oscuro', '--e-rojo-t', ['--c-elevada'], 4.5, 'lo que no va a andar al mencionar (sin clave, pausado)'],
  ['oscuro', '--n-texto', ['--n-amarillo', '--n-violeta', '--n-gris'], 4.5],
  ['oscuro', '--c-seleccion', ['--c-fondo'], 3, 'marco de selección (no es texto: pide 3)'],
  ['oscuro', '--e-rojo-t', ['--e-rojo'], 4.5, 'fallos de la IA: avisos, pastillas y el ícono de la campana (F2)'],
  ['oscuro', '--e-amarillo-t', ['--e-amarillo'], 4.5, 'avisos y pastillas «Sin clave» / «En el tope» (F2)'],
  ['oscuro', '--c-texto-2', ['--c-hundido', '--c-hundido-2', '--c-ia-suave'], 4.5, 'detalles de Configuración → IA y del hilo con agentes (F2)'],
  ['oscuro', '--e-amarillo-t', ['--c-hundido-2'], 3, 'la barra de gasto al 80 % (no es texto: pide 3)'],
  ['oscuro', '--c-peligro', ['--c-hundido-2'], 3, 'la barra de gasto en el tope (no es texto: pide 3)'],
  ['oscuro', '--c-ok', ['--c-hundido'], 3, 'el tilde de «Listo» (no es texto: pide 3)'],
  ['claro', '--c-texto', ['--c-fondo', '--c-superficie'], 4.5],
  ['claro', '--c-texto-2', ['--c-fondo', '--c-superficie'], 4.5],
  ['claro', '--c-texto-3', ['--c-superficie'], 4.5],
  ['claro', '--c-texto-3', ['--c-fondo', '--c-bandeja', '--c-lateral'], 3.8, 'excepción conocida (3.5, 3,9–4,4): solo datos secundarios'],
  ['claro', '--c-sobre-acento', ['--c-acento-solido'], 4.5],
  ['claro', '--c-ia-texto', ['--c-ia-suave', '--c-elevada', '--c-superficie'], 4.5, 'pastillas de mención (plan de la IA integrada, 14.1)'],
  ['claro', '--c-ia', ['--c-superficie'], 3, 'íconos y marcas de IA (no es texto: pide 3)'],
  ['claro', '--c-sobre-ia', ['--c-ia'], 4.5, 'el número de la campana'],
  ['claro', '--e-rojo-t', ['--c-elevada'], 4.5, 'lo que no va a andar al mencionar (sin clave, pausado)'],
  ['claro', '--c-seleccion', ['--c-fondo'], 3, 'marco de selección (no es texto: pide 3)'],
  ['claro', '--e-rojo-t', ['--e-rojo'], 4.5, 'fallos de la IA: avisos, pastillas y el ícono de la campana (F2)'],
  ['claro', '--e-amarillo-t', ['--e-amarillo'], 4.5, 'avisos y pastillas «Sin clave» / «En el tope» (F2)'],
  ['claro', '--c-texto-2', ['--c-hundido', '--c-hundido-2', '--c-ia-suave'], 4.5, 'detalles de Configuración → IA y del hilo con agentes (F2)'],
  ['claro', '--e-amarillo-t', ['--c-hundido-2'], 3, 'la barra de gasto al 80 % (no es texto: pide 3)'],
  ['claro', '--c-peligro', ['--c-hundido-2'], 3, 'la barra de gasto en el tope (no es texto: pide 3)'],
  ['claro', '--c-ok', ['--c-hundido'], 3, 'el tilde de «Listo» (no es texto: pide 3)'],
  ['claro', '--n-texto', ['--n-amarillo', '--n-violeta'], 4.5],
]

let fallas = 0
console.log('Contraste (WCAG 2.1)\n')
for (const [nombreTema, texto, fondos, minimo, nota] of pares) {
  const tema = nombreTema === 'oscuro' ? oscuro : claro
  const valores = fondos.map((f) => relacion(color(tema, texto), color(tema, f)))
  const mal = valores.some((v) => v < minimo)
  if (mal) fallas++
  console.log(
    `${mal ? '✗' : '✓'} ${nombreTema.padEnd(6)} ${texto.padEnd(16)} sobre ${fondos.join(' / ').padEnd(52)} ${valores
      .map((v) => v.toFixed(1).replace('.', ','))
      .join(' / ')}  (mín. ${String(minimo).replace('.', ',')})${nota ? ` · ${nota}` : ''}`,
  )
}

// Grises de superficie del oscuro: neutros con un punto de frío (nunca cálidos).
const superficies = [
  '--c-fondo', '--c-fondo-2', '--c-lateral', '--c-bandeja', '--c-superficie', '--c-superficie-2', '--c-elevada',
  '--c-hundido', '--c-hundido-2', '--e-gris', '--m-gris', '--c-texto-inv',
]
// Textos y detalles finos (puntos de la grilla): con un poco más de azul se leen fríos; basta con que no sean cálidos.
const textos = ['--c-texto', '--c-texto-2', '--c-texto-3', '--e-gris-t', '--e-gris-s', '--n-gris', '--puntos']
console.log('\nGrises del oscuro (B ≥ R; en superficies además B − R ≤ 6)\n')
for (const n of [...superficies, ...textos]) {
  const [r, , b] = color(oscuro, n)
  const esSuperficie = superficies.includes(n)
  const ok = b >= r && (!esSuperficie || b - r <= 6)
  if (!ok) fallas++
  console.log(`${ok ? '✓' : '✗'} ${n.padEnd(18)} ${oscuro[n].padEnd(9)} R ${r}  B ${b}  (B − R = ${b - r})${esSuperficie ? '' : ' · texto o detalle'}`)
}

console.log(fallas ? `\n${fallas} sin cumplir.` : '\nTodo cumple.')
process.exit(fallas ? 1 : 0)
