// Menciones `@alias`: cómo se escriben, cómo se extraen de un texto y cómo se resuelven a un miembro.
// Lo usan el servidor (para disparar: `resolverExacto`) y la web (para sugerir al escribir: `sugerir`).
// Es texto plano o Markdown, sin nodos ni ids incrustados (plan-ia-integrada.md, D4 y 5.3). Sin base ni red.
import { normalizar } from './texto'

/** Una mención encontrada en un texto. */
export interface MencionTexto {
  /** El alias tal como se resolvió para comparar: minúsculas, sin acentos, sin el punto o guion final. */
  alias: string
  /** Posición en el texto original (desde el «@» hasta el final del alias). */
  desde: number
  hasta: number
}

/** Lo mínimo de un miembro para resolver y mostrar menciones. */
export interface MiembroMencionable {
  id: string
  alias: string
  nombre: string
  archivado?: boolean
}

/** Nombres que no puede tener ningún miembro: `@yo` es «yo mismo» y `@todos`/`@equipo` quedan para equipos. */
export const ALIAS_RESERVADOS: readonly string[] = ['yo', 'todos', 'equipo', 'ia', 'telar']

/** `[a-z0-9][a-z0-9_.-]{1,31}`: entre 2 y 32 caracteres, empieza con letra o número. */
export const PATRON_ALIAS = /^[a-z0-9][a-z0-9_.-]{1,31}$/

const ALIAS_DE_RESPALDO = 'miembro'
const LARGO_MAXIMO = 32

/** Lo que no se puede dejar al final de un alias: es puntuación que se pegó a la mención («Gracias, @claude.»). */
const PUNTUACION_FINAL = /[._-]+$/

/**
 * El alias que sale de un nombre, o '' si no sirve (vacío, muy corto o reservado).
 * Minúsculas, sin acentos, lo que no es `a-z0-9_.-` pasa a guion, y empieza y termina con letra o número.
 */
function aliasDeNombre(nombre: string): string {
  const base = normalizar(nombre)
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, LARGO_MAXIMO)
    .replace(PUNTUACION_FINAL, '')
  return base.length >= 2 && !ALIAS_RESERVADOS.includes(base) ? base : ''
}

/** «Claude Opus» → «claude-opus». Nunca devuelve un alias reservado ni vacío (cae en «miembro»). */
export function normalizarAlias(nombre: string): string {
  return aliasDeNombre(nombre) || ALIAS_DE_RESPALDO
}

/**
 * ¿Sirve como alias de un miembro? Cumple `PATRON_ALIAS`, no es reservado y no termina en `.`, `-` o `_`
 * (el extractor siempre recorta esos finales, así que un alias así nunca se podría mencionar).
 */
export function aliasValido(alias: string): boolean {
  return PATRON_ALIAS.test(alias) && !ALIAS_RESERVADOS.includes(alias) && !PUNTUACION_FINAL.test(alias)
}

// ───────────────────────── Qué no cuenta: código y direcciones ─────────────────────────

/** Tapa con espacios (sin tocar los saltos de línea ni el largo) lo que está entre `desde` y `hasta`. */
function tapar(letras: string[], desde: number, hasta: number): void {
  for (let i = desde; i < hasta && i < letras.length; i++) if (letras[i] !== '\n') letras[i] = ' '
}

/** Los bloques ```…``` y ~~~…~~~ (abren y cierran al comienzo de una línea; si no cierran, llegan hasta el final). */
function taparBloques(texto: string, letras: string[]): void {
  const apertura = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/
  const cierre = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/
  let abierto: { marca: string; desde: number } | null = null
  let inicio = 0
  for (const linea of texto.split('\n')) {
    const fin = inicio + linea.length
    if (!abierto) {
      const m = apertura.exec(linea)
      // Una línea como «```@claude```» no abre un bloque: es código en línea (el aviso lleva comillas invertidas).
      if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) abierto = { marca: m[1]!, desde: inicio }
    } else {
      const m = cierre.exec(linea)
      if (m && m[1]![0] === abierto.marca[0] && m[1]!.length >= abierto.marca.length) {
        tapar(letras, abierto.desde, fin)
        abierto = null
      }
    }
    inicio = fin + 1
  }
  if (abierto) tapar(letras, abierto.desde, texto.length)
}

/** El código `en línea`: una tanda de N comillas invertidas cierra con otra tanda de exactamente N, sin cruzar un párrafo. */
function taparCodigoEnLinea(texto: string, letras: string[]): void {
  let i = 0
  while (i < texto.length) {
    if (texto[i] !== '`') {
      i++
      continue
    }
    let n = 0
    while (texto[i + n] === '`') n++
    const finParrafo = (() => {
      const m = /\n[ \t]*\n/.exec(texto.slice(i + n))
      return m ? i + n + m.index : texto.length
    })()
    let j = i + n
    let cierre = -1
    while (j < finParrafo) {
      if (texto[j] !== '`') {
        j++
        continue
      }
      let k = 0
      while (texto[j + k] === '`') k++
      if (k === n) {
        cierre = j + k
        break
      }
      j += k
    }
    if (cierre === -1) {
      i += n
    } else {
      tapar(letras, i, cierre)
      i = cierre
    }
  }
}

/** Direcciones web: con esquema (`https://…`) o que empiezan con `www.`. Una mención pegada adentro no es una mención. */
function taparDirecciones(letras: string[]): void {
  const texto = letras.join('')
  const direccion = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'`]+/gi
  for (let m = direccion.exec(texto); m; m = direccion.exec(texto)) tapar(letras, m.index, m.index + m[0].length)
}

/** El texto con el código y las direcciones tapados con espacios: mismo largo, así las posiciones valen para el original. */
function sinCodigoNiDirecciones(texto: string): string {
  const letras = texto.split('')
  taparBloques(texto, letras)
  taparCodigoEnLinea(letras.join(''), letras)
  taparDirecciones(letras)
  return letras.join('')
}

// ───────────────────────── Extraer ─────────────────────────

/** Si el `@` viene después de esto, no es una mención: es un mail (a@b.com), una dirección (/@x) o un escape (\@). */
const NO_ANTES_DEL_ARROBA = /[\p{L}\p{N}\p{M}@./\\+%=&#$]/u
/** Lo que puede tener un alias mientras se escribe: letras (con acentos), números, `_`, `.` y `-`. */
const CUERPO_ALIAS = /@([\p{L}\p{N}\p{M}_.-]+)/gu

/**
 * Las menciones de un texto en Markdown o texto plano, en orden.
 * No cuenta: lo que está dentro de `código` o de un bloque ```…```, los mails (a@b.com), ni las direcciones web.
 * Extrae también un alias a medio escribir (`@cl`): quién lo resuelve es `resolverExacto`, y ahí `cl` no dispara nada.
 */
export function extraerMenciones(texto: string): MencionTexto[] {
  if (!texto.includes('@')) return []
  const limpio = sinCodigoNiDirecciones(texto)
  const encontradas: MencionTexto[] = []
  CUERPO_ALIAS.lastIndex = 0
  for (let m = CUERPO_ALIAS.exec(limpio); m; m = CUERPO_ALIAS.exec(limpio)) {
    const desde = m.index
    if (desde > 0 && NO_ANTES_DEL_ARROBA.test(caracterAntes(limpio, desde))) continue
    const cuerpo = m[1]!.replace(PUNTUACION_FINAL, '')
    if (!cuerpo) continue
    encontradas.push({ alias: normalizar(cuerpo), desde, hasta: desde + 1 + cuerpo.length })
  }
  return encontradas
}

/** El carácter (entero, no la mitad de un par sustituto) que está justo antes de `indice`. */
function caracterAntes(texto: string, indice: number): string {
  return Array.from(texto.slice(Math.max(0, indice - 2), indice)).at(-1) ?? ''
}

// ───────────────────────── Resolver ─────────────────────────

const sinArroba = (texto: string) => normalizar(texto.trim()).replace(/^@+/, '')

/**
 * Para DISPARAR (servidor): solo alias exacto o nombre normalizado exacto, y nunca un miembro archivado.
 * Gana el alias; el nombre se mira solo si ningún alias coincide. Si dos miembros coinciden por igual, no hay respuesta
 * (null): ante la duda no se dispara. Los alias reservados (`yo`, `todos`…) y los alias a medio escribir dan null.
 */
export function resolverExacto(alias: string, miembros: readonly MiembroMencionable[]): MiembroMencionable | null {
  const buscado = sinArroba(alias)
  if (!buscado || ALIAS_RESERVADOS.includes(buscado)) return null
  const vivos = miembros.filter((m) => !m.archivado)
  const unico = (coinciden: MiembroMencionable[]) => (coinciden.length === 1 ? coinciden[0]! : null)
  const porAlias = vivos.filter((m) => normalizar(m.alias) === buscado)
  if (porAlias.length > 0) return unico(porAlias)
  return unico(vivos.filter((m) => aliasDeNombre(m.nombre) === buscado))
}

/**
 * Para SUGERIR (autocompletado): prefijo del alias o del nombre (o de una palabra del nombre), de la mejor coincidencia
 * a la peor. Un miembro archivado no se sugiere. Con `parcial` vacío devuelve a todos, por orden alfabético.
 */
export function sugerir(parcial: string, miembros: readonly MiembroMencionable[], limite = 6): MiembroMencionable[] {
  const p = sinArroba(parcial)
  const puntuados: { m: MiembroMencionable; puntos: number }[] = []
  for (const m of miembros) {
    if (m.archivado) continue
    const alias = normalizar(m.alias)
    const nombre = normalizar(m.nombre).trim()
    let puntos: number
    if (!p) puntos = 4
    else if (alias === p) puntos = 0
    else if (alias.startsWith(p)) puntos = 1
    else if (nombre.startsWith(p)) puntos = 2
    else if (nombre.split(/[\s._-]+/).some((palabra) => palabra.startsWith(p))) puntos = 3
    else continue
    puntuados.push({ m, puntos })
  }
  puntuados.sort(
    (a, b) =>
      a.puntos - b.puntos ||
      (p ? a.m.alias.length - b.m.alias.length : 0) ||
      a.m.nombre.localeCompare(b.m.nombre, 'es') ||
      a.m.id.localeCompare(b.m.id),
  )
  return puntuados.slice(0, Math.max(0, limite)).map((x) => x.m)
}
