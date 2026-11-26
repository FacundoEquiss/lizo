// Tablas del lienzo (Telar 0.3): columnas con formato (número, moneda, fecha, rama de git…), filas, orden y resumen.
// Los datos viven en `elementos_lienzo.datos` (JSON) con `v: 1`; los componentes nunca los leen directo: pasan por
// `leerTabla`, que completa lo que falte. Todo se cambia con OPERACIONES (`aplicarOperaciones`): la usan la web (con
// deshacer) y el MCP (todo o nada), así que las dos hacen exactamente lo mismo.
// Sin dependencias del navegador ni de Node: corre igual en los dos lados.
import type { Color } from './tipos'

export type TipoColumna =
  | 'texto'
  | 'numero'
  | 'moneda'
  | 'porcentaje'
  | 'fecha'
  | 'duracion'
  | 'casilla'
  | 'etiqueta'
  | 'link'
  | 'email'
  | 'telefono'
  | 'ubicacion'
  | 'rama'
  | 'directorio'
  | 'tarjeta'
  | 'color'
export type ValorCelda = string | number | boolean | null
export type Resumen = 'ninguno' | 'suma' | 'promedio' | 'minimo' | 'maximo' | 'contar' | 'llenas'
export type Alineacion3 = 'izquierda' | 'centro' | 'derecha'

/** Los diez colores del lienzo, en el orden de siempre (copia de COLORES_LIENZO: este archivo no depende de lienzo.ts). */
export const COLORES_TABLA: Color[] = ['amarillo', 'naranja', 'rojo', 'rosa', 'violeta', 'azul', 'celeste', 'verde', 'lima', 'gris']
const COLORES_SET = new Set<string>(COLORES_TABLA)
const esColor = (v: unknown): v is Color => typeof v === 'string' && COLORES_SET.has(v)

export const TIPOS_COLUMNA: { id: TipoColumna; nombre: string; ejemplo: string }[] = [
  { id: 'texto', nombre: 'Texto', ejemplo: 'Milanesa' },
  { id: 'numero', nombre: 'Número', ejemplo: '1234.5' },
  { id: 'moneda', nombre: 'Moneda', ejemplo: '4200' },
  { id: 'porcentaje', nombre: 'Porcentaje', ejemplo: '35 (es 35 %)' },
  { id: 'fecha', nombre: 'Fecha', ejemplo: '2026-11-24' },
  { id: 'duracion', nombre: 'Duración', ejemplo: '90 (minutos) o 1h30' },
  { id: 'casilla', nombre: 'Casilla', ejemplo: 'true' },
  { id: 'etiqueta', nombre: 'Etiqueta', ejemplo: 'Listo' },
  { id: 'link', nombre: 'Link', ejemplo: 'https://telarapp.vercel.app' },
  { id: 'email', nombre: 'Email', ejemplo: 'hola@ejemplo.com' },
  { id: 'telefono', nombre: 'Teléfono', ejemplo: '+54 11 5555-1234' },
  { id: 'ubicacion', nombre: 'Ubicación', ejemplo: 'Obelisco, Buenos Aires' },
  { id: 'rama', nombre: 'Rama de git', ejemplo: 'claude/tablas' },
  { id: 'directorio', nombre: 'Directorio', ejemplo: 'servidor/src/mcp' },
  { id: 'tarjeta', nombre: 'Tarjeta de Telar', ejemplo: 'RC-12' },
  { id: 'color', nombre: 'Color', ejemplo: 'verde' },
]
const IDS_TIPO = new Set<string>(TIPOS_COLUMNA.map((t) => t.id))
export const esTipoColumna = (v: unknown): v is TipoColumna => typeof v === 'string' && IDS_TIPO.has(v)
export const NOMBRE_TIPO_COLUMNA = (t: TipoColumna) => TIPOS_COLUMNA.find((x) => x.id === t)?.nombre ?? t
const NUMERICOS = new Set<TipoColumna>(['numero', 'moneda', 'porcentaje', 'duracion'])
export const esNumerica = (t: TipoColumna) => NUMERICOS.has(t)

export const RESUMENES: Resumen[] = ['ninguno', 'suma', 'promedio', 'minimo', 'maximo', 'contar', 'llenas']
export const NOMBRE_RESUMEN: Record<Resumen, string> = {
  ninguno: 'Sin resumen',
  suma: 'Suma',
  promedio: 'Promedio',
  minimo: 'Mínimo',
  maximo: 'Máximo',
  contar: 'Contar',
  llenas: 'Llenas',
}

export interface OpcionEtiqueta {
  nombre: string
  color: Color
}
export interface ColumnaTabla {
  id: string
  nombre: string
  tipo: TipoColumna
  /** px, 60 a 640 */
  ancho: number
  alineacion?: Alineacion3
  decimales?: number
  moneda?: string
  conHora?: boolean
  opciones?: OpcionEtiqueta[]
  resumen?: Resumen
}
export interface FilaTabla {
  id: string
  /** Por id de columna. Lo que falta es vacío. */
  celdas: Record<string, ValorCelda>
}
export interface OrdenTabla {
  columna: string
  direccion: 'asc' | 'desc'
}
export interface DatosTabla {
  v: 1
  titulo: string
  columnas: ColumnaTabla[]
  filas: FilaTabla[]
  orden: OrdenTabla | null
  color: Color
  cabecera: 'tinte' | 'fuerte' | 'lisa'
  rayas: boolean
  numerosFila: boolean
}

export const LIMITES_TABLA = { columnas: 30, filas: 500, celda: 2000, filasEnLienzo: 60, ancho: [60, 640] as const }
/** Alturas (px) de cada parte: la tabla del lienzo y su medida salen de acá. */
export const MEDIDAS_TABLA = { titulo: 44, cabecera: 40, fila: 36, resumen: 36, numeros: 44, mas: 32 }
export const ANCHO_COLUMNA: Record<TipoColumna, number> = {
  texto: 200,
  numero: 110,
  moneda: 130,
  porcentaje: 110,
  fecha: 130,
  duracion: 110,
  casilla: 80,
  etiqueta: 130,
  link: 190,
  email: 200,
  telefono: 150,
  ubicacion: 190,
  rama: 190,
  directorio: 200,
  tarjeta: 150,
  color: 120,
}

export type EntradaColumna = {
  nombre: string
  tipo?: TipoColumna
  ancho?: number
  alineacion?: Alineacion3
  decimales?: number
  moneda?: string
  conHora?: boolean
  opciones?: { nombre: string; color?: Color }[]
  resumen?: Resumen
}
/** Una fila: lista de valores en el orden de las columnas, o un objeto por nombre (o id) de columna. */
export type EntradaFila = unknown[] | Record<string, unknown>
export type RefFila = string | number
export type OperacionTabla =
  | { op: 'agregar_filas'; filas: EntradaFila[]; en?: number; ids?: string[] }
  | { op: 'cambiar_celdas'; celdas: { fila: RefFila; columna: string; valor: unknown }[] }
  | { op: 'quitar_filas'; filas: RefFila[] }
  | { op: 'mover_fila'; fila: RefFila; a: number }
  | { op: 'reemplazar_filas'; filas: EntradaFila[]; ids?: string[] }
  | { op: 'agregar_columna'; columna: EntradaColumna; en?: number; valores?: unknown[]; id?: string }
  | { op: 'cambiar_columna'; columna: string; cambios: Partial<EntradaColumna>; forzar?: boolean }
  | { op: 'quitar_columna'; columna: string }
  | { op: 'ordenar'; columna: string | null; direccion?: 'asc' | 'desc' }
  /** Solo interna (deshacer): vuelve la tabla entera a como estaba. No se ofrece por MCP. */
  | { op: 'restaurar'; tabla: DatosTabla }

// ───────── ids ─────────

const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789'
export function idCorto(prefijo: string, largo = 5): string {
  let s = ''
  for (let i = 0; i < largo; i++) s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
  return `${prefijo}_${s}`
}

// ───────── lectura ─────────

const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const entero = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def

function leerColumna(c: unknown, i: number, usados: Set<string>): ColumnaTabla {
  const d = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
  const tipo = esTipoColumna(d.tipo) ? d.tipo : 'texto'
  let id = typeof d.id === 'string' && /^[\w-]{1,24}$/.test(d.id) ? d.id : idCorto('c')
  while (usados.has(id)) id = idCorto('c')
  usados.add(id)
  const col: ColumnaTabla = {
    id,
    nombre: typeof d.nombre === 'string' && d.nombre.trim() ? d.nombre.trim().slice(0, 80) : `Columna ${i + 1}`,
    tipo,
    ancho: entero(d.ancho, LIMITES_TABLA.ancho[0], LIMITES_TABLA.ancho[1], ANCHO_COLUMNA[tipo]),
  }
  if (d.alineacion === 'izquierda' || d.alineacion === 'centro' || d.alineacion === 'derecha') col.alineacion = d.alineacion
  if (typeof d.decimales === 'number') col.decimales = entero(d.decimales, 0, 6, 0)
  if (typeof d.moneda === 'string' && d.moneda.trim()) col.moneda = d.moneda.trim().slice(0, 4)
  if (d.conHora === true) col.conHora = true
  if (Array.isArray(d.opciones)) {
    col.opciones = d.opciones
      .map((o) => {
        const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
        return typeof x.nombre === 'string' && x.nombre.trim()
          ? { nombre: x.nombre.trim().slice(0, 40), color: esColor(x.color) ? x.color : ('gris' as Color) }
          : null
      })
      .filter((o): o is OpcionEtiqueta => o !== null)
      .slice(0, 40)
  }
  if (RESUMENES.includes(d.resumen as Resumen) && d.resumen !== 'ninguno') col.resumen = d.resumen as Resumen
  return col
}

/** La tabla de un `datos` cualquiera, con todo completo y dentro de los topes. Nunca falla. */
export function leerTabla(d: Record<string, unknown>): DatosTabla {
  const usados = new Set<string>()
  let columnas = (Array.isArray(d.columnas) ? d.columnas : []).slice(0, LIMITES_TABLA.columnas).map((c, i) => leerColumna(c, i, usados))
  if (!columnas.length) columnas = [leerColumna({ nombre: 'Columna 1' }, 0, usados)]
  const ids = new Set(columnas.map((c) => c.id))
  const idsFila = new Set<string>()
  const filas: FilaTabla[] = (Array.isArray(d.filas) ? d.filas : []).slice(0, LIMITES_TABLA.filas).map((f) => {
    const x = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
    let id = typeof x.id === 'string' && /^[\w-]{1,24}$/.test(x.id) ? x.id : idCorto('f')
    while (idsFila.has(id)) id = idCorto('f')
    idsFila.add(id)
    const celdas: Record<string, ValorCelda> = {}
    const crudas = (x.celdas && typeof x.celdas === 'object' ? x.celdas : {}) as Record<string, unknown>
    for (const [k, v] of Object.entries(crudas)) {
      if (!ids.has(k)) continue
      if (typeof v === 'string') celdas[k] = v.slice(0, LIMITES_TABLA.celda)
      else if (typeof v === 'number' && Number.isFinite(v)) celdas[k] = v
      else if (typeof v === 'boolean') celdas[k] = v
    }
    return { id, celdas }
  })
  const o = (d.orden && typeof d.orden === 'object' ? d.orden : null) as Record<string, unknown> | null
  const orden: OrdenTabla | null =
    o && typeof o.columna === 'string' && ids.has(o.columna) ? { columna: o.columna, direccion: o.direccion === 'desc' ? 'desc' : 'asc' } : null
  return {
    v: 1,
    titulo: typeof d.titulo === 'string' ? d.titulo.slice(0, 120) : '',
    columnas,
    filas,
    orden,
    color: esColor(d.color) ? d.color : 'azul',
    cabecera: d.cabecera === 'fuerte' || d.cabecera === 'lisa' ? d.cabecera : 'tinte',
    rayas: typeof d.rayas === 'boolean' ? d.rayas : true,
    numerosFila: typeof d.numerosFila === 'boolean' ? d.numerosFila : false,
  }
}

/** Para el validador del servidor: un mensaje si algo conocido está mal, o null. Lo desconocido se conserva. */
export function problemaEnTabla(d: Record<string, unknown>): string | null {
  if (d.columnas !== undefined) {
    if (!Array.isArray(d.columnas) || d.columnas.length < 1 || d.columnas.length > LIMITES_TABLA.columnas)
      return `columnas: una lista de 1 a ${LIMITES_TABLA.columnas}.`
    for (const c of d.columnas as Record<string, unknown>[]) {
      if (!c || typeof c !== 'object' || (c.tipo !== undefined && !esTipoColumna(c.tipo)))
        return `columnas[].tipo: ${TIPOS_COLUMNA.map((t) => t.id).join(', ')}.`
    }
  }
  if (d.filas !== undefined && (!Array.isArray(d.filas) || d.filas.length > LIMITES_TABLA.filas)) return `filas: hasta ${LIMITES_TABLA.filas}.`
  if (d.cabecera !== undefined && !['tinte', 'fuerte', 'lisa'].includes(d.cabecera as string)) return 'cabecera: tinte, fuerte o lisa.'
  if (d.color !== undefined && !esColor(d.color)) return `color: ${COLORES_TABLA.join(', ')}.`
  return null
}

// ───────── valores de celda ─────────

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const SIMBOLOS: Record<string, string> = { ARS: '$', USD: 'US$', EUR: '€', BRL: 'R$' }

export function simboloMoneda(col: ColumnaTabla): string {
  const m = (col.moneda ?? 'ARS').trim()
  return SIMBOLOS[m.toUpperCase()] ?? m
}

/** «1.234,50», «1,234.50», «$ 4.200», «35 %», «-12» → número; si no es un número, null. */
export function aNumero(crudo: unknown): number | null {
  if (typeof crudo === 'number') return Number.isFinite(crudo) ? crudo : null
  if (typeof crudo !== 'string') return null
  let s = crudo.replace(/[\s\u00a0\u202f$€%]|US|R\$|ARS|USD|EUR|BRL/gi, '')
  if (!s || !/^[+-]?[\d.,]+$/.test(s)) return null
  const neg = s.startsWith('-')
  s = s.replace(/^[+-]/, '')
  const punto = s.lastIndexOf('.')
  const coma = s.lastIndexOf(',')
  if (punto >= 0 && coma >= 0) {
    // Los dos: el que aparece último es el decimal.
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (coma >= 0) {
    s = (s.match(/,/g) ?? []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '')
  } else if (punto >= 0) {
    // «1.234» o «12.345.678» es miles (como se escribe en Argentina); «12.5» es decimal.
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

const dosDigitos = (n: number) => String(n).padStart(2, '0')
function fechaValida(a: number, m: number, d: number) {
  const f = new Date(Date.UTC(a, m - 1, d))
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d
}

/** «2026-11-24», «24/11/2026», «24-11-26», con hora opcional («2026-11-24 18:30») → «2026-11-24» o «2026-11-24T18:30». */
export function aFecha(crudo: unknown, conHora: boolean): string | null {
  if (typeof crudo !== 'string') return null
  const s = crudo.trim()
  let a: number, m: number, d: number
  let hh = 0, mm = 0
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/)
  if (r) {
    a = +r[1]!; m = +r[2]!; d = +r[3]!
    hh = r[4] ? +r[4] : 0; mm = r[5] ? +r[5] : 0
  } else {
    r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[T\s]+(\d{1,2}):(\d{2}))?$/)
    if (!r) return null
    d = +r[1]!; m = +r[2]!; a = +r[3]!
    if (r[3]!.length === 2) a += 2000
    hh = r[4] ? +r[4] : 0; mm = r[5] ? +r[5] : 0
  }
  if (!fechaValida(a, m, d) || hh > 23 || mm > 59) return null
  const dia = `${a}-${dosDigitos(m)}-${dosDigitos(d)}`
  return conHora ? `${dia}T${dosDigitos(hh)}:${dosDigitos(mm)}` : dia
}

/** «90», «1h30», «1:30», «1 h 30 min», «45m», «2h» → minutos. */
export function aDuracion(crudo: unknown): number | null {
  if (typeof crudo === 'number') return Number.isFinite(crudo) && crudo >= 0 ? crudo : null
  if (typeof crudo !== 'string') return null
  const s = crudo.trim().toLowerCase()
  if (/^\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'))
  let r = s.match(/^(\d+):(\d{1,2})$/)
  if (r) return +r[1]! * 60 + +r[2]!
  r = s.match(/^(?:(\d+)\s*(?:h|hs|hora|horas))?\s*(?:(\d+)\s*(?:m|min|mins|minutos?)?)?$/)
  if (r && (r[1] || r[2])) return (r[1] ? +r[1] * 60 : 0) + (r[2] ? +r[2] : 0)
  return null
}

const SI = new Set(['true', 'si', 'sí', 'x', '1', 'yes', 'ok', 'listo', 'hecho', '✓', '✔'])
const NO = new Set(['false', 'no', '0', '', '-'])

/**
 * Lleva lo que escribió una persona o una IA al valor guardado de esa columna. `{ error }` dice qué se esperaba (con un
 * ejemplo), para que la IA aprenda del mensaje. Vacío es siempre válido y queda en null.
 */
export function normalizarCelda(col: ColumnaTabla, crudo: unknown): { valor: ValorCelda } | { error: string } {
  if (crudo === null || crudo === undefined || (typeof crudo === 'string' && crudo.trim() === '')) return { valor: null }
  const malo = (esperado: string) => ({ error: `«${String(crudo).slice(0, 40)}» no es ${esperado}` })
  const cadena = () => String(crudo).trim().slice(0, LIMITES_TABLA.celda)
  switch (col.tipo) {
    case 'texto':
    case 'directorio':
      return { valor: cadena() }
    case 'ubicacion':
      return { valor: cadena() }
    case 'numero':
    case 'moneda':
    case 'porcentaje': {
      const n = aNumero(crudo)
      if (n === null) return malo(col.tipo === 'porcentaje' ? 'un porcentaje (ejemplo: 35 o "35 %")' : 'un número (ejemplo: 1200 o 1200.5)')
      return { valor: n }
    }
    case 'duracion': {
      const n = aDuracion(crudo)
      if (n === null) return malo('una duración (ejemplo: 90, "1h30" o "1:30")')
      return { valor: Math.round(n) }
    }
    case 'fecha': {
      const f = aFecha(crudo, !!col.conHora)
      if (f === null) return malo('una fecha (ejemplo: 2026-11-24 o 24/11/2026)')
      return { valor: f }
    }
    case 'casilla': {
      if (typeof crudo === 'boolean') return { valor: crudo }
      const s = String(crudo).trim().toLowerCase()
      if (SI.has(s)) return { valor: true }
      if (NO.has(s)) return { valor: false }
      return malo('verdadero o falso (ejemplo: true, false, "sí" o "no")')
    }
    case 'etiqueta': {
      const s = cadena().slice(0, 40)
      const op = col.opciones?.find((o) => sinTildes(o.nombre) === sinTildes(s))
      return { valor: op ? op.nombre : s }
    }
    case 'link': {
      const s = cadena()
      if (/^https?:\/\/\S+$/i.test(s)) return { valor: s }
      if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return { valor: s }
      return malo('un link (ejemplo: https://telarapp.vercel.app)')
    }
    case 'email': {
      const s = cadena()
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { valor: s } : malo('un mail (ejemplo: hola@ejemplo.com)')
    }
    case 'telefono': {
      const s = cadena()
      return /^[+\d][\d\s().-]{4,}$/.test(s) && (s.match(/\d/g) ?? []).length >= 6 ? { valor: s } : malo('un teléfono (ejemplo: +54 11 5555-1234)')
    }
    case 'rama': {
      const s = cadena()
      return /^[^\s~^:?*[\\]+$/.test(s) ? { valor: s } : malo('una rama de git, sin espacios (ejemplo: claude/tablas)')
    }
    case 'tarjeta': {
      const s = cadena().toUpperCase()
      return /^[A-Z]{1,6}-\d{1,6}$/.test(s) ? { valor: s } : malo('la clave de una tarjeta de Telar (ejemplo: RC-12)')
    }
    case 'color': {
      const s = sinTildes(cadena())
      return esColor(s) ? { valor: s } : malo(`un color (${COLORES_TABLA.join(', ')})`)
    }
  }
}

const decimalesDe = (col: ColumnaTabla, def: number) => (typeof col.decimales === 'number' ? col.decimales : def)
function numeroLindo(n: number, decimales: number | null): string {
  const f = new Intl.NumberFormat('es-AR', decimales === null ? { maximumFractionDigits: 6 } : { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  return f.format(n)
}

/** La fecha como se lee: «24 nov 2026» (y «24 nov 2026 18:30» con hora). */
export function fechaLinda(iso: string): string {
  const r = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/)
  if (!r) return iso
  const base = `${+r[3]!} ${MESES[+r[2]! - 1] ?? ''} ${r[1]}`
  return r[4] ? `${base} ${r[4]}:${r[5]}` : base
}

export function duracionLinda(min: number): string {
  const total = Math.round(min)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h && m) return `${h} h ${m} min`
  return h ? `${h} h` : `${m} min`
}

/** Cómo se ve una celda (texto plano; la web lo vuelve pastilla, casilla o link). */
export function formatearCelda(col: ColumnaTabla, valor: ValorCelda): string {
  if (valor === null || valor === undefined || valor === '') return ''
  switch (col.tipo) {
    case 'numero':
      return typeof valor === 'number' ? numeroLindo(valor, typeof col.decimales === 'number' ? col.decimales : null) : String(valor)
    case 'moneda':
      return typeof valor === 'number' ? `${simboloMoneda(col)} ${numeroLindo(valor, decimalesDe(col, Number.isInteger(valor) ? 0 : 2))}` : String(valor)
    case 'porcentaje':
      return typeof valor === 'number' ? `${numeroLindo(valor, typeof col.decimales === 'number' ? col.decimales : null)} %` : String(valor)
    case 'fecha':
      return typeof valor === 'string' ? fechaLinda(valor) : String(valor)
    case 'duracion':
      return typeof valor === 'number' ? duracionLinda(valor) : String(valor)
    case 'casilla':
      return valor === true ? '✓' : ''
    default:
      return String(valor)
  }
}

/** El texto del link con su dirección completa (a «telarapp.vercel.app» le falta el https). */
export const direccionLink = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`)
export const dominioDe = (v: string) => {
  try {
    return new URL(direccionLink(v)).hostname.replace(/^www\./, '')
  } catch {
    return v
  }
}
/** Un enlace de mapas para una ubicación (solo un link: nada se manda solo). */
export const urlMapa = (lugar: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lugar)}`

// ───────── orden y resumen ─────────

function comparar(col: ColumnaTabla, a: ValorCelda, b: ValorCelda): number {
  const vacioA = a === null || a === undefined || a === ''
  const vacioB = b === null || b === undefined || b === ''
  if (vacioA || vacioB) return vacioA === vacioB ? 0 : vacioA ? 1 : -1 // los vacíos siempre al final
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const sa = String(a), sb = String(b)
  if (col.tipo === 'etiqueta' && col.opciones?.length) {
    const ia = col.opciones.findIndex((o) => o.nombre === sa)
    const ib = col.opciones.findIndex((o) => o.nombre === sb)
    if (ia !== -1 && ib !== -1 && ia !== ib) return ia - ib
  }
  return sa.localeCompare(sb, 'es', { sensitivity: 'base', numeric: true })
}

/** Las filas en el orden que se ve (la vista guardada de `orden`; los vacíos van al final). */
export function filasOrdenadas(t: DatosTabla): FilaTabla[] {
  if (!t.orden) return t.filas
  const col = t.columnas.find((c) => c.id === t.orden!.columna)
  if (!col) return t.filas
  const signo = t.orden.direccion === 'desc' ? -1 : 1
  return t.filas
    .map((f, i) => ({ f, i }))
    .sort((x, y) => {
      const a = x.f.celdas[col.id] ?? null
      const b = y.f.celdas[col.id] ?? null
      const vacio = (v: ValorCelda) => v === null || v === ''
      if (vacio(a) || vacio(b)) return comparar(col, a, b) || x.i - y.i
      return signo * comparar(col, a, b) || x.i - y.i
    })
    .map((x) => x.f)
}

/** El valor del resumen de una columna, o null si no hay (o no se puede). */
export function resumir(col: ColumnaTabla, filas: FilaTabla[]): number | null {
  const r = col.resumen
  if (!r || r === 'ninguno') return null
  const valores = filas.map((f) => f.celdas[col.id]).filter((v) => v !== null && v !== undefined && v !== '')
  if (r === 'llenas') return valores.length
  if (r === 'contar') return col.tipo === 'casilla' ? valores.filter((v) => v === true).length : filas.length
  const nums = valores.filter((v): v is number => typeof v === 'number')
  if (!nums.length) return null
  if (r === 'suma') return nums.reduce((s, n) => s + n, 0)
  if (r === 'promedio') return nums.reduce((s, n) => s + n, 0) / nums.length
  if (r === 'minimo') return Math.min(...nums)
  return Math.max(...nums)
}

/** El resumen escrito («Suma: $ 3.400»), o '' si no hay. */
export function resumenLindo(col: ColumnaTabla, filas: FilaTabla[]): string {
  const v = resumir(col, filas)
  if (v === null || !col.resumen) return ''
  const esConteo = col.resumen === 'contar' || col.resumen === 'llenas'
  const visible = esConteo ? numeroLindo(v, 0) : formatearCelda({ ...col, tipo: col.tipo === 'duracion' || col.tipo === 'moneda' || col.tipo === 'porcentaje' ? col.tipo : 'numero' }, v)
  return `${NOMBRE_RESUMEN[col.resumen]}: ${visible}`
}

/** Tamaño de la tabla en el lienzo: sale de sus columnas y filas (no se estira a mano). */
export function medidaTabla(t: DatosTabla): { ancho: number; alto: number } {
  const M = MEDIDAS_TABLA
  const ancho = (t.numerosFila ? M.numeros : 0) + t.columnas.reduce((s, c) => s + c.ancho, 0)
  const visibles = Math.min(t.filas.length, LIMITES_TABLA.filasEnLienzo)
  const hayResumen = t.columnas.some((c) => c.resumen && c.resumen !== 'ninguno')
  const alto =
    (t.titulo ? M.titulo : 0) +
    M.cabecera +
    Math.max(visibles, 1) * M.fila +
    (t.filas.length > visibles ? M.mas : 0) +
    (hayResumen ? M.resumen : 0)
  return { ancho: Math.round(ancho), alto: Math.round(alto) }
}

// ───────── operaciones ─────────

const clon = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export class ErrorTabla extends Error {}

function colorDeOpcion(col: ColumnaTabla): Color {
  const usados = new Set((col.opciones ?? []).map((o) => o.color))
  return COLORES_TABLA.find((c) => c !== 'gris' && !usados.has(c)) ?? COLORES_TABLA[(col.opciones?.length ?? 0) % COLORES_TABLA.length]!
}

/** Si el valor de una etiqueta es nuevo, se suma como opción (con el próximo color libre). */
function asegurarOpcion(col: ColumnaTabla, valor: ValorCelda) {
  if (col.tipo !== 'etiqueta' || typeof valor !== 'string' || !valor) return
  col.opciones ??= []
  if (!col.opciones.some((o) => o.nombre === valor)) col.opciones.push({ nombre: valor, color: colorDeOpcion(col) })
}

function buscarColumna(t: DatosTabla, ref: string): ColumnaTabla {
  const porId = t.columnas.find((c) => c.id === ref)
  if (porId) return porId
  const n = sinTildes(String(ref))
  const exacta = t.columnas.filter((c) => sinTildes(c.nombre) === n)
  if (exacta.length === 1) return exacta[0]!
  if (exacta.length > 1) throw new ErrorTabla(`Hay más de una columna «${ref}»: usá su id (${exacta.map((c) => c.id).join(' o ')}).`)
  throw new ErrorTabla(`No hay una columna «${ref}» en la tabla: tiene ${t.columnas.map((c) => `«${c.nombre}»`).join(', ')}.`)
}

/** Una columna por id o por nombre (sin mayúsculas ni tildes). Si no hay, el error dice cuáles hay. */
export const columnaDe = (t: DatosTabla, ref: string): ColumnaTabla => buscarColumna(t, ref)

function buscarFila(t: DatosTabla, ref: RefFila): FilaTabla {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    const n = Number(ref)
    const visibles = filasOrdenadas(t)
    const f = visibles[n - 1]
    if (!f) throw new ErrorTabla(`No hay fila ${n}: la tabla tiene ${t.filas.length}.`)
    return f
  }
  const f = t.filas.find((x) => x.id === ref)
  if (!f) throw new ErrorTabla(`No hay una fila con id «${ref}».`)
  return f
}

function entradaAColumna(e: EntradaColumna, t: DatosTabla, base?: ColumnaTabla): ColumnaTabla {
  const usados = new Set(t.columnas.map((c) => c.id))
  const tipo = e.tipo ?? base?.tipo ?? 'texto'
  if (e.tipo !== undefined && !esTipoColumna(e.tipo)) throw new ErrorTabla(`Tipo de columna «${e.tipo}»: ${TIPOS_COLUMNA.map((x) => x.id).join(', ')}.`)
  const bruto: Record<string, unknown> = { ...(base ?? {}), ...e, tipo }
  if (!base) delete bruto.id
  else bruto.id = base.id
  if (e.tipo && base && e.tipo !== base.tipo && e.ancho === undefined) bruto.ancho = ANCHO_COLUMNA[tipo]
  if (e.opciones) {
    // Las opciones sin color reciben el próximo libre, así las pastillas se distinguen sin que nadie elija.
    const vistos: Color[] = e.opciones.map((o) => o.color).filter((c): c is Color => esColor(c))
    bruto.opciones = e.opciones.map((o) => {
      if (esColor(o.color)) return o
      const libre = COLORES_TABLA.find((c) => c !== 'gris' && !vistos.includes(c)) ?? 'gris'
      vistos.push(libre)
      return { ...o, color: libre }
    })
  }
  const col = leerColumna(bruto, t.columnas.length, base ? new Set([...usados].filter((x) => x !== base.id)) : usados)
  return col
}

function filaDesdeEntrada(t: DatosTabla, entrada: EntradaFila, numero: number, estricto: boolean, avisos: string[], idPedido?: string): FilaTabla {
  const celdas: Record<string, ValorCelda> = {}
  const poner = (col: ColumnaTabla, crudo: unknown) => {
    const r = normalizarCelda(col, crudo)
    if ('error' in r) {
      if (estricto) throw new ErrorTabla(`fila ${numero}, columna «${col.nombre}»: ${r.error}.`)
      avisos.push(`fila ${numero}, columna «${col.nombre}»: ${r.error}; quedó vacía.`)
      return
    }
    if (r.valor !== null) {
      asegurarOpcion(col, r.valor)
      celdas[col.id] = r.valor
    }
  }
  if (Array.isArray(entrada)) {
    if (entrada.length > t.columnas.length)
      throw new ErrorTabla(`fila ${numero}: trae ${entrada.length} valores y la tabla tiene ${t.columnas.length} columnas (${t.columnas.map((c) => `«${c.nombre}»`).join(', ')}).`)
    entrada.forEach((v, i) => poner(t.columnas[i]!, v))
  } else if (entrada && typeof entrada === 'object') {
    for (const [k, v] of Object.entries(entrada)) poner(buscarColumna(t, k), v)
  } else {
    throw new ErrorTabla(`fila ${numero}: tiene que ser una lista de valores o un objeto por nombre de columna.`)
  }
  const usado = (id: string) => t.filas.some((f) => f.id === id)
  return { id: idPedido && /^[\w-]{1,24}$/.test(idPedido) && !usado(idPedido) ? idPedido : idCorto('f'), celdas }
}

function verificarTopes(t: DatosTabla) {
  if (t.filas.length > LIMITES_TABLA.filas) throw new ErrorTabla(`Una tabla del lienzo admite hasta ${LIMITES_TABLA.filas} filas (con esto quedarían ${t.filas.length}).`)
  if (t.columnas.length > LIMITES_TABLA.columnas) throw new ErrorTabla(`Una tabla admite hasta ${LIMITES_TABLA.columnas} columnas.`)
  if (t.columnas.length < 1) throw new ErrorTabla('Una tabla necesita al menos una columna.')
}

/**
 * Aplica operaciones en orden y devuelve la tabla nueva, cómo deshacerlo (`inversas`: una sola `restaurar` con la tabla de
 * antes) y avisos. Con `estricto` (el MCP) el primer valor que no encaja corta todo con un mensaje que dice fila, columna y
 * qué se esperaba; sin `estricto` (la web, al pegar desde Excel) lo que no encaja queda vacío y se avisa.
 */
export function aplicarOperaciones(
  inicial: DatosTabla,
  ops: OperacionTabla[],
  opciones: { estricto?: boolean } = {},
): { tabla: DatosTabla; inversas: OperacionTabla[]; avisos: string[] } {
  const estricto = opciones.estricto ?? false
  const antes = clon(inicial)
  const t = clon(inicial)
  const avisos: string[] = []

  for (const op of ops) {
    switch (op.op) {
      case 'restaurar':
        return { tabla: leerTabla(clon(op.tabla) as unknown as Record<string, unknown>), inversas: [{ op: 'restaurar', tabla: antes }], avisos }

      case 'agregar_filas': {
        const nuevas = op.filas.map((f, i) => filaDesdeEntrada(t, f, t.filas.length + i + 1, estricto, avisos, op.ids?.[i]))
        const en = op.en === undefined ? t.filas.length : Math.min(Math.max(Math.round(op.en) - 1, 0), t.filas.length)
        t.filas.splice(en, 0, ...nuevas)
        break
      }
      case 'cambiar_celdas': {
        for (const c of op.celdas) {
          const col = buscarColumna(t, c.columna)
          const fila = buscarFila(t, c.fila)
          const r = normalizarCelda(col, c.valor)
          const numero = t.filas.indexOf(fila) + 1
          if ('error' in r) {
            if (estricto) throw new ErrorTabla(`fila ${numero}, columna «${col.nombre}»: ${r.error}.`)
            avisos.push(`fila ${numero}, columna «${col.nombre}»: ${r.error}; quedó vacía.`)
            delete fila.celdas[col.id]
            continue
          }
          if (r.valor === null) delete fila.celdas[col.id]
          else {
            asegurarOpcion(col, r.valor)
            fila.celdas[col.id] = r.valor
          }
        }
        break
      }
      case 'quitar_filas': {
        const ids = new Set(op.filas.map((r) => buscarFila(t, r).id))
        t.filas = t.filas.filter((f) => !ids.has(f.id))
        break
      }
      case 'mover_fila': {
        const fila = buscarFila(t, op.fila)
        t.filas = t.filas.filter((f) => f.id !== fila.id)
        t.filas.splice(Math.min(Math.max(Math.round(op.a) - 1, 0), t.filas.length), 0, fila)
        break
      }
      case 'reemplazar_filas': {
        t.filas = []
        t.filas = op.filas.map((f, i) => filaDesdeEntrada(t, f, i + 1, estricto, avisos, op.ids?.[i]))
        break
      }
      case 'agregar_columna': {
        const col = entradaAColumna(op.columna, t)
        if (op.id && /^[\w-]{1,24}$/.test(op.id) && !t.columnas.some((c) => c.id === op.id)) col.id = op.id
        const en = op.en === undefined ? t.columnas.length : Math.min(Math.max(Math.round(op.en) - 1, 0), t.columnas.length)
        t.columnas.splice(en, 0, col)
        if (op.valores) {
          op.valores.slice(0, t.filas.length).forEach((v, i) => {
            const r = normalizarCelda(col, v)
            if ('error' in r) {
              if (estricto) throw new ErrorTabla(`fila ${i + 1}, columna «${col.nombre}»: ${r.error}.`)
              avisos.push(`fila ${i + 1}, columna «${col.nombre}»: ${r.error}; quedó vacía.`)
            } else if (r.valor !== null) {
              asegurarOpcion(col, r.valor)
              t.filas[i]!.celdas[col.id] = r.valor
            }
          })
        }
        break
      }
      case 'cambiar_columna': {
        const vieja = buscarColumna(t, op.columna)
        const nueva = entradaAColumna({ ...op.cambios, nombre: op.cambios.nombre ?? vieja.nombre }, t, vieja)
        if (op.cambios.tipo && op.cambios.tipo !== vieja.tipo) {
          const fallos: string[] = []
          t.filas.forEach((f, i) => {
            const actual = f.celdas[vieja.id]
            if (actual === undefined || actual === null || actual === '') return
            const r = normalizarCelda(nueva, actual)
            if ('error' in r) {
              fallos.push(`fila ${i + 1}: ${r.error}`)
              delete f.celdas[vieja.id]
            } else if (r.valor !== null) {
              asegurarOpcion(nueva, r.valor)
              f.celdas[vieja.id] = r.valor
            } else delete f.celdas[vieja.id]
          })
          if (fallos.length && !op.forzar)
            throw new ErrorTabla(
              `Pasar «${vieja.nombre}» a ${NOMBRE_TIPO_COLUMNA(nueva.tipo)} deja ${fallos.length} valores que no encajan (${fallos.slice(0, 3).join('; ')}${fallos.length > 3 ? '…' : ''}). Si no importa perderlos, repetí con forzar: true.`,
            )
          if (fallos.length) avisos.push(`«${vieja.nombre}»: ${fallos.length} valores no encajaron y quedaron vacíos.`)
        }
        t.columnas[t.columnas.indexOf(vieja)] = nueva
        break
      }
      case 'quitar_columna': {
        const col = buscarColumna(t, op.columna)
        if (t.columnas.length <= 1) throw new ErrorTabla('No se puede quitar la única columna de la tabla.')
        t.columnas = t.columnas.filter((c) => c.id !== col.id)
        for (const f of t.filas) delete f.celdas[col.id]
        if (t.orden?.columna === col.id) t.orden = null
        break
      }
      case 'ordenar': {
        t.orden = op.columna === null ? null : { columna: buscarColumna(t, op.columna).id, direccion: op.direccion === 'desc' ? 'desc' : 'asc' }
        break
      }
      default:
        throw new ErrorTabla(`Operación desconocida: ${(op as { op?: string }).op}.`)
    }
    verificarTopes(t)
  }
  return { tabla: t, inversas: [{ op: 'restaurar', tabla: antes }], avisos }
}

// ───────── pegar y copiar (Excel, Sheets, CSV) ─────────

/** Parte un texto en filas y celdas: TSV (lo que copia Excel) o CSV (con comillas, coma o punto y coma). */
export function partirGrilla(texto: string): string[][] {
  const limpio = texto.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (!limpio) return []
  const primera = limpio.split('\n')[0]!
  const sep = primera.includes('\t') ? '\t' : (primera.match(/;/g) ?? []).length >= (primera.match(/,/g) ?? []).length && primera.includes(';') ? ';' : ','
  const filas: string[][] = []
  let fila: string[] = []
  let celda = ''
  let comillas = false
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i]!
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') {
        celda += '"'
        i++
      } else if (ch === '"') comillas = false
      else celda += ch
    } else if (ch === '"' && celda === '') comillas = true
    else if (ch === sep) {
      fila.push(celda)
      celda = ''
    } else if (ch === '\n') {
      fila.push(celda)
      filas.push(fila)
      fila = []
      celda = ''
    } else celda += ch
  }
  fila.push(celda)
  filas.push(fila)
  return filas
}

/** ¿Parece una grilla (2 o más columnas y 2 o más filas)? Para decidir si un pegado se vuelve tabla. */
export function esGrilla(texto: string): boolean {
  const g = partirGrilla(texto)
  return g.length >= 2 && g.every((f) => f.length >= 2) && g.length <= LIMITES_TABLA.filas + 1
}

function adivinarTipo(valores: string[]): { tipo: TipoColumna; moneda?: string } {
  const llenos = valores.map((v) => v.trim()).filter(Boolean)
  if (!llenos.length) return { tipo: 'texto' }
  const todos = (f: (v: string) => boolean) => llenos.every(f)
  if (todos((v) => /^(true|false|sí|si|no|x)$/i.test(v))) return { tipo: 'casilla' }
  if (todos((v) => /%$/.test(v) && aNumero(v) !== null)) return { tipo: 'porcentaje' }
  if (todos((v) => /^(\$|US\$|€|R\$)/.test(v) && aNumero(v) !== null))
    return { tipo: 'moneda', moneda: llenos[0]!.startsWith('US$') ? 'USD' : llenos[0]!.startsWith('€') ? 'EUR' : llenos[0]!.startsWith('R$') ? 'BRL' : 'ARS' }
  if (todos((v) => aFecha(v, false) !== null)) return { tipo: 'fecha' }
  if (todos((v) => aNumero(v) !== null)) return { tipo: 'numero' }
  if (todos((v) => /^https?:\/\/\S+$/i.test(v))) return { tipo: 'link' }
  if (todos((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return { tipo: 'email' }
  if (todos((v) => /^[A-Z]{1,6}-\d{1,6}$/.test(v))) return { tipo: 'tarjeta' }
  return { tipo: 'texto' }
}

/** Una tabla a partir de texto pegado: la primera fila son los títulos y los tipos se adivinan. null si no parece una tabla. */
export function tablaDesdeTexto(texto: string): Pick<DatosTabla, 'columnas' | 'filas'> | null {
  const g = partirGrilla(texto)
  if (g.length < 2) return null
  const ancho = Math.min(Math.max(...g.map((f) => f.length)), LIMITES_TABLA.columnas)
  if (ancho < 2) return null
  const cuerpo = g.slice(1, LIMITES_TABLA.filas + 1)
  const usados = new Set<string>()
  const columnas = Array.from({ length: ancho }, (_, i) => {
    const adiv = adivinarTipo(cuerpo.map((f) => f[i] ?? ''))
    const col = leerColumna({ nombre: (g[0]![i] ?? '').trim() || `Columna ${i + 1}`, tipo: adiv.tipo, ...(adiv.moneda ? { moneda: adiv.moneda } : {}) }, i, usados)
    if (adiv.tipo === 'moneda' && adiv.moneda === 'ARS') delete col.moneda
    return col
  })
  const filas = cuerpo.map((f) => {
    const celdas: Record<string, ValorCelda> = {}
    columnas.forEach((col, i) => {
      const r = normalizarCelda(col, f[i] ?? '')
      if (!('error' in r) && r.valor !== null) {
        asegurarOpcion(col, r.valor)
        celdas[col.id] = r.valor
      } else if ('error' in r && (f[i] ?? '').trim()) celdas[col.id] = (f[i] ?? '').trim().slice(0, LIMITES_TABLA.celda)
    })
    return { id: idCorto('f'), celdas }
  })
  return { columnas, filas }
}

/** La tabla como texto para pegar en Excel (tsv) o guardar (csv). Sigue el orden que se ve. */
export function tablaATexto(t: DatosTabla, formato: 'tsv' | 'csv'): string {
  const sep = formato === 'tsv' ? '\t' : ','
  const celda = (col: ColumnaTabla, v: ValorCelda): string => {
    let s = ''
    if (v === null || v === undefined) s = ''
    else if (typeof v === 'number') s = formato === 'tsv' ? String(v).replace('.', ',') : String(v)
    else if (typeof v === 'boolean') s = v ? 'sí' : 'no'
    else s = String(v)
    if (formato === 'csv' && /[",\n;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
    if (formato === 'tsv') s = s.replace(/[\t\n]/g, ' ')
    return s
  }
  const cabecera = t.columnas.map((c) => celda(c, c.nombre)).join(sep)
  const filas = filasOrdenadas(t).map((f) => t.columnas.map((c) => celda(c, f.celdas[c.id] ?? null)).join(sep))
  return [cabecera, ...filas].join('\n')
}

/** Una tabla nueva de cero (para crearla): columnas y filas de entrada, con las mismas reglas que las operaciones. */
export function armarTabla(p: {
  titulo?: string
  columnas: EntradaColumna[]
  filas?: EntradaFila[]
  orden?: { columna: string; direccion?: 'asc' | 'desc' } | null
  color?: Color
  cabecera?: DatosTabla['cabecera']
  rayas?: boolean
  numerosFila?: boolean
  estricto?: boolean
}): { tabla: DatosTabla; avisos: string[] } {
  if (!p.columnas.length) throw new ErrorTabla('Una tabla necesita al menos una columna.')
  if (p.columnas.length > LIMITES_TABLA.columnas) throw new ErrorTabla(`Una tabla admite hasta ${LIMITES_TABLA.columnas} columnas.`)
  const vacia = leerTabla({ titulo: p.titulo ?? '', columnas: [], filas: [] })
  vacia.columnas = []
  const base: DatosTabla = { ...vacia, color: p.color ?? vacia.color, cabecera: p.cabecera ?? vacia.cabecera, rayas: p.rayas ?? vacia.rayas, numerosFila: p.numerosFila ?? vacia.numerosFila }
  for (const c of p.columnas) base.columnas.push(entradaAColumna(c, base))
  const ops: OperacionTabla[] = []
  if (p.filas?.length) ops.push({ op: 'agregar_filas', filas: p.filas })
  if (p.orden) ops.push({ op: 'ordenar', columna: p.orden.columna, direccion: p.orden.direccion })
  const r = aplicarOperaciones(base, ops, { estricto: p.estricto ?? true })
  return { tabla: r.tabla, avisos: r.avisos }
}
