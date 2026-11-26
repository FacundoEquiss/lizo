#!/usr/bin/env node
// Revisa que TODAS las librerías instaladas (package-lock.json) tengan una licencia compatible con la AGPL-3.0 de Telar.
// `npm run licencias:revisar`. No baja nada de internet: lee lo que cada paquete declara en el lockfile. Sale con error si encuentra una
// licencia que no está en la lista, o un paquete sin licencia declarada (que hay que mirar a mano y, si está bien, sumar a EXCEPCIONES).
// Lo corre también el flujo de GitHub «Seguridad» en cada pull request (.github/workflows/seguridad.yml).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Compatibles con la AGPL-3.0 (permisivas, MPL-2.0, LGPL-3.0 y las fuentes con OFL). Si hace falta otra, se analiza y se suma acá.
export const PERMITIDAS = new Set([
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense', 'Zlib',
  'Python-2.0', 'PSF-2.0', 'CC-BY-4.0', 'MPL-2.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'LGPL-2.1-or-later', 'OFL-1.1',
  'AGPL-3.0-only', 'AGPL-3.0-or-later',
])
// Paquetes sin licencia declarada (o con una rara) que ya se miraron a mano: { 'nombre': 'por qué está bien' }.
export const EXCEPCIONES = {}

/** ¿Alcanza esta expresión SPDX? «A OR B»: con una permitida alcanza. «A AND B»: tienen que ser todas. */
export function expresionPermitida(expr) {
  const tokens = expr.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/)
  let i = 0
  let rota = false
  const unidad = () => {
    if (tokens[i] === undefined || tokens[i] === ')' || tokens[i] === 'AND' || tokens[i] === 'OR') {
      rota = true
      return false
    }
    if (tokens[i] === '(') {
      i++
      const v = disyuncion()
      i++ // )
      return v
    }
    return PERMITIDAS.has(tokens[i++])
  }
  const conjuncion = () => {
    let v = unidad()
    while (tokens[i] === 'AND') { i++; const w = unidad(); v = v && w }
    return v
  }
  const disyuncion = () => {
    let v = conjuncion()
    while (tokens[i] === 'OR') { i++; const w = conjuncion(); v = v || w }
    return v
  }
  const r = disyuncion()
  return !rota && i >= tokens.length && r
}

export function revisar(lock) {
  const resumen = {}
  const mal = []
  let total = 0
  for (const [clave, v] of Object.entries(lock.packages ?? {})) {
    if (!clave.startsWith('node_modules/')) continue
    total++
    const nombre = clave.replace(/^.*node_modules\//, '')
    const lic = typeof v.license === 'string' ? v.license : v.license?.type
    resumen[lic ?? '(sin licencia)'] = (resumen[lic ?? '(sin licencia)'] ?? 0) + 1
    if (EXCEPCIONES[nombre]) continue
    if (!lic) mal.push(`${nombre}: no declara licencia`)
    else if (!expresionPermitida(lic)) mal.push(`${nombre}: ${lic}${v.dev || v.devOptional ? ' (solo desarrollo)' : ''}`)
  }
  return { total, resumen, mal: [...new Set(mal)] }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = revisar(JSON.parse(readFileSync(path.join(RAIZ, 'package-lock.json'), 'utf8')))
  console.log(`Revisé ${r.total} librerías:`)
  for (const [l, n] of Object.entries(r.resumen).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${l}`)
  if (r.mal.length) {
    console.error(`\nLicencias que NO están en la lista de compatibles con la AGPL-3.0 (${r.mal.length}):`)
    for (const m of r.mal) console.error(`  - ${m}`)
    console.error('\nHay que mirar cada una: si es compatible se suma a PERMITIDAS (o a EXCEPCIONES con el motivo) en scripts/revisar-licencias.mjs.')
    process.exit(1)
  }
  console.log('\nTodas compatibles con la AGPL-3.0.')
}
