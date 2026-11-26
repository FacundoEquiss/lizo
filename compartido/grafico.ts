// Gráficos del lienzo (Telar 0.3): barras, líneas, área, torta, anillo y embudo. Se arman solos desde una tabla del lienzo
// (`fuente`: cambia la tabla y cambia el gráfico) o con datos propios (`propios`). Los datos viven en
// `elementos_lienzo.datos` con `v: 1`; los componentes pasan por `leerGrafico` y `resolverGrafico`.
// Sin dependencias del navegador ni de Node.
import {
  COLORES_TABLA,
  esNumerica,
  formatearCelda,
  type ColumnaTabla,
  type DatosTabla,
  type ValorCelda,
} from './tabla'
import type { Color } from './tipos'

export type TipoGrafico = 'barras' | 'barras_h' | 'lineas' | 'area' | 'torta' | 'anillo' | 'embudo'
export type Agrupar = 'suma' | 'promedio' | 'contar'

export const TIPOS_GRAFICO: { id: TipoGrafico; nombre: string; uso: string }[] = [
  { id: 'barras', nombre: 'Barras', uso: 'Comparar valores entre categorías' },
  { id: 'barras_h', nombre: 'Barras horizontales', uso: 'Comparar con nombres largos o muchas categorías' },
  { id: 'lineas', nombre: 'Líneas', uso: 'Cómo cambia algo en el tiempo' },
  { id: 'area', nombre: 'Área', uso: 'Lo mismo que líneas, para acumulados' },
  { id: 'torta', nombre: 'Torta', uso: 'Qué parte del total es cada cosa (pocas categorías)' },
  { id: 'anillo', nombre: 'Anillo', uso: 'Como la torta, con el total en el centro' },
  { id: 'embudo', nombre: 'Embudo', uso: 'Pasos en los que se va perdiendo gente' },
]
const IDS_GRAFICO = new Set<string>(TIPOS_GRAFICO.map((t) => t.id))
export const esTipoGrafico = (v: unknown): v is TipoGrafico => typeof v === 'string' && IDS_GRAFICO.has(v)

/** Los colores de serie, en un orden fijo (el mismo en la web y en lo que lee la IA). */
export const COLORES_SERIE: Color[] = ['azul', 'naranja', 'verde', 'violeta', 'rosa', 'celeste', 'amarillo', 'rojo', 'lima', 'gris']
export const LIMITES_GRAFICO = { categorias: 60, series: 8, porcionesTorta: 8 }

export interface FuenteGrafico {
  /** El id del objeto «tabla» del lienzo. */
  tabla: string
  /** El id de la columna de categorías. */
  categoria: string
  /** Los ids de las columnas numéricas. Vacío con `agrupar: 'contar'`: cuenta filas por categoría. */
  series: string[]
  agrupar: Agrupar
}
export interface SerieGrafico {
  nombre: string
  valores: (number | null)[]
  color?: Color
}
export interface PropiosGrafico {
  categorias: string[]
  series: SerieGrafico[]
}
export interface DatosGrafico {
  v: 1
  titulo: string
  tipo: TipoGrafico
  fuente: FuenteGrafico | null
  propios: PropiosGrafico | null
  apilado: boolean
  leyenda: 'auto' | 'si' | 'no'
  valores: boolean
  /** Colores de las series (en orden); lo que falte sale de COLORES_SERIE. */
  colores: Color[]
}

const COLORES_SET = new Set<string>(COLORES_TABLA)
const esColor = (v: unknown): v is Color => typeof v === 'string' && COLORES_SET.has(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function leerGrafico(d: Record<string, unknown>): DatosGrafico {
  const f = (d.fuente && typeof d.fuente === 'object' ? d.fuente : null) as Record<string, unknown> | null
  const fuente: FuenteGrafico | null =
    f && typeof f.tabla === 'string' && typeof f.categoria === 'string'
      ? {
          tabla: f.tabla,
          categoria: f.categoria,
          series: (Array.isArray(f.series) ? f.series : []).filter((s): s is string => typeof s === 'string').slice(0, LIMITES_GRAFICO.series),
          agrupar: f.agrupar === 'promedio' || f.agrupar === 'contar' ? f.agrupar : 'suma',
        }
      : null
  const p = (d.propios && typeof d.propios === 'object' ? d.propios : null) as Record<string, unknown> | null
  const categorias = p && Array.isArray(p.categorias) ? p.categorias.slice(0, LIMITES_GRAFICO.categorias).map((c) => String(c ?? '').slice(0, 80)) : []
  const propios: PropiosGrafico | null = p
    ? {
        categorias,
        series: (Array.isArray(p.series) ? p.series : []).slice(0, LIMITES_GRAFICO.series).map((s, i) => {
          const x = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
          const valores = Array.isArray(x.valores) ? x.valores : []
          return {
            nombre: typeof x.nombre === 'string' && x.nombre.trim() ? x.nombre.trim().slice(0, 60) : `Serie ${i + 1}`,
            valores: categorias.map((_, j) => num(valores[j])),
            ...(esColor(x.color) ? { color: x.color } : {}),
          }
        }),
      }
    : null
  return {
    v: 1,
    titulo: typeof d.titulo === 'string' ? d.titulo.slice(0, 120) : '',
    tipo: esTipoGrafico(d.tipo) ? d.tipo : 'barras',
    fuente,
    propios: fuente ? null : propios,
    apilado: d.apilado === true,
    leyenda: d.leyenda === 'si' || d.leyenda === 'no' ? d.leyenda : 'auto',
    valores: typeof d.valores === 'boolean' ? d.valores : true,
    colores: (Array.isArray(d.colores) ? d.colores : []).filter(esColor).slice(0, LIMITES_GRAFICO.series),
  }
}

/** Para el validador del servidor: un mensaje si algo conocido está mal, o null. */
export function problemaEnGrafico(d: Record<string, unknown>): string | null {
  if (d.tipo !== undefined && !esTipoGrafico(d.tipo)) return `tipo de gráfico: ${TIPOS_GRAFICO.map((t) => t.id).join(', ')}.`
  if (d.leyenda !== undefined && !['auto', 'si', 'no'].includes(d.leyenda as string)) return 'leyenda: auto, si o no.'
  const p = d.propios as Record<string, unknown> | null | undefined
  if (p && typeof p === 'object') {
    if (!Array.isArray(p.categorias) || p.categorias.length > LIMITES_GRAFICO.categorias) return `propios.categorias: hasta ${LIMITES_GRAFICO.categorias}.`
    if (!Array.isArray(p.series) || p.series.length > LIMITES_GRAFICO.series) return `propios.series: hasta ${LIMITES_GRAFICO.series}.`
  }
  return null
}

export interface GraficoResuelto {
  categorias: string[]
  series: { nombre: string; color: Color; valores: (number | null)[] }[]
  /** Colores por categoría (torta, anillo, embudo y barras de una sola serie con etiquetas de color). */
  coloresCategoria: Color[]
  /** Las categorías vienen de una columna de etiquetas con color: las barras de una sola serie las usan. */
  coloresPorCategoria: boolean
  /** La columna de la primera serie: da el formato de los números (moneda, porcentaje…). null con datos propios. */
  formato: ColumnaTabla | null
  /** Qué falta o qué pasa, en castellano: «La tabla ya no está en el lienzo». */
  aviso?: string
}

const textoCategoria = (col: ColumnaTabla, v: ValorCelda | undefined) => {
  if (v === null || v === undefined || v === '') return '(vacío)'
  return col.tipo === 'casilla' ? (v ? 'Sí' : 'No') : formatearCelda(col, v) || String(v)
}

/** Lo que dibuja el gráfico: categorías y series ya agrupadas, con color, y un aviso si algo no se puede. */
export function resolverGrafico(g: DatosGrafico, tabla: DatosTabla | null): GraficoResuelto {
  const colorSerie = (i: number): Color => g.colores[i] ?? COLORES_SERIE[i % COLORES_SERIE.length]!
  let r: GraficoResuelto = { categorias: [], series: [], coloresCategoria: [], coloresPorCategoria: false, formato: null }

  if (g.fuente) {
    if (!tabla) return { ...r, aviso: 'La tabla de este gráfico ya no está en el lienzo.' }
    const cat = tabla.columnas.find((c) => c.id === g.fuente!.categoria)
    if (!cat) return { ...r, aviso: 'La columna de categorías ya no existe en la tabla: elegí otra en «Datos».' }
    const cols = g.fuente.series.map((id) => tabla.columnas.find((c) => c.id === id)).filter((c): c is ColumnaTabla => !!c && esNumerica(c.tipo))
    const contar = g.fuente.agrupar === 'contar'
    if (!cols.length && !contar) return { ...r, aviso: 'No hay columnas con números para dibujar: elegí una en «Datos» o agrupá contando filas.' }

    // Agrupar por categoría (en el orden en que aparecen)
    const claves: string[] = []
    const grupos = new Map<string, { filas: number; sumas: number[]; cuentas: number[] }>()
    const nSeries = contar ? 1 : cols.length
    for (const f of tabla.filas) {
      const k = textoCategoria(cat, f.celdas[cat.id])
      let gr = grupos.get(k)
      if (!gr) {
        gr = { filas: 0, sumas: Array(nSeries).fill(0), cuentas: Array(nSeries).fill(0) }
        grupos.set(k, gr)
        claves.push(k)
      }
      gr.filas++
      if (!contar)
        cols.forEach((c, i) => {
          const v = f.celdas[c.id]
          if (typeof v === 'number') {
            gr!.sumas[i]! += v
            gr!.cuentas[i]! += 1
          }
        })
    }
    const sobran = claves.length > LIMITES_GRAFICO.categorias
    const usadas = claves.slice(0, LIMITES_GRAFICO.categorias)
    const valorDe = (k: string, i: number): number | null => {
      const gr = grupos.get(k)!
      if (contar) return gr.filas
      if (!gr.cuentas[i]) return null
      return g.fuente!.agrupar === 'promedio' ? gr.sumas[i]! / gr.cuentas[i]! : gr.sumas[i]!
    }
    r = {
      categorias: usadas,
      series: Array.from({ length: nSeries }, (_, i) => ({
        nombre: contar ? 'Cantidad' : cols[i]!.nombre,
        color: colorSerie(i),
        valores: usadas.map((k) => valorDe(k, i)),
      })),
      coloresCategoria: usadas.map((k, i) => {
        const op = cat.tipo === 'etiqueta' ? cat.opciones?.find((o) => o.nombre === k) : undefined
        return op?.color ?? colorSerie(i)
      }),
      coloresPorCategoria: cat.tipo === 'etiqueta' && !!cat.opciones?.length,
      formato: contar ? null : cols[0] ?? null,
      ...(sobran ? { aviso: `Se dibujan las primeras ${LIMITES_GRAFICO.categorias} categorías de ${claves.length}.` } : {}),
    }
  } else if (g.propios) {
    r = {
      categorias: g.propios.categorias,
      series: g.propios.series.map((s, i) => ({ nombre: s.nombre, color: s.color ?? colorSerie(i), valores: s.valores })),
      coloresCategoria: g.propios.categorias.map((_, i) => colorSerie(i)),
      coloresPorCategoria: false,
      formato: null,
    }
    if (!r.categorias.length || !r.series.length) r.aviso = 'Todavía no hay datos: tocá «Datos» para cargarlos.'
  } else {
    r.aviso = 'Elegí de dónde salen los datos.'
  }

  // Torta, anillo y embudo muestran una sola serie, y lo que sobra de la torta va a «Otros».
  if ((g.tipo === 'torta' || g.tipo === 'anillo') && r.series[0] && r.categorias.length > LIMITES_GRAFICO.porcionesTorta) {
    const orden = r.categorias.map((_, i) => i).sort((a, b) => (r.series[0]!.valores[b] ?? 0) - (r.series[0]!.valores[a] ?? 0))
    const quedan = orden.slice(0, LIMITES_GRAFICO.porcionesTorta - 1).sort((a, b) => a - b)
    const resto = orden.slice(LIMITES_GRAFICO.porcionesTorta - 1)
    const otros = resto.reduce((s, i) => s + (r.series[0]!.valores[i] ?? 0), 0)
    r = {
      ...r,
      categorias: [...quedan.map((i) => r.categorias[i]!), 'Otros'],
      coloresCategoria: [...quedan.map((i) => r.coloresCategoria[i]!), 'gris'],
      series: [{ ...r.series[0]!, valores: [...quedan.map((i) => r.series[0]!.valores[i] ?? null), otros] }],
    }
  }
  return r
}

/** Qué dibujar «sin pensar»: la primera columna que no es número como categorías y hasta tres columnas numéricas. */
export function fuenteSugerida(t: DatosTabla, idTabla: string): FuenteGrafico | null {
  const categoria = t.columnas.find((c) => !esNumerica(c.tipo)) ?? t.columnas[0]
  if (!categoria) return null
  const numericas = t.columnas.filter((c) => c.id !== categoria.id && esNumerica(c.tipo))
  const series = numericas.slice(0, 3).map((c) => c.id)
  return { tabla: idTabla, categoria: categoria.id, series, agrupar: series.length ? 'suma' : 'contar' }
}

/** Texto para lectores de pantalla y para la IA: «Barras: Precio por plato. Milanesa 4200, Ñoquis 3100». */
export function describirGrafico(g: DatosGrafico, r: GraficoResuelto): string {
  const tipo = TIPOS_GRAFICO.find((t) => t.id === g.tipo)?.nombre ?? g.tipo
  if (r.aviso && !r.categorias.length) return `${tipo}${g.titulo ? `: ${g.titulo}` : ''}. ${r.aviso}`
  const fmt = (n: number | null) => (n === null ? 'sin dato' : r.formato ? formatearCelda(r.formato, n) : String(Math.round(n * 100) / 100))
  const partes = r.categorias.slice(0, 12).map((c, i) => `${c} ${r.series.map((s) => fmt(s.valores[i] ?? null)).join(' / ')}`)
  const mas = r.categorias.length > 12 ? ` y ${r.categorias.length - 12} más` : ''
  const series = r.series.length > 1 ? ` (${r.series.map((s) => s.nombre).join(' / ')})` : ''
  return `${tipo}${g.titulo ? `: ${g.titulo}` : ''}${series}. ${partes.join(', ')}${mas}.`
}
