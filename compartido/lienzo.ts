// Modelo de los objetos del lienzo: tipos de `datos` por objeto, valores de fábrica, normalizadores y tamaños.
// El estilo de cada objeto vive en `elementos_lienzo.datos` (JSON): sumar fuente, alineación o borde no pide migración
// ni rompe los objetos viejos. Los componentes nunca leen `e.datos` directo: pasan por leerNota, leerTexto, etc., que
// completan lo que falte y traducen lo de la 0.1.
import { problemaEnGrafico } from './grafico'
import { esIcono } from './iconos'
import { esDocRico, type DocRico } from './rico'
import { problemaEnTabla } from './tabla'
import type { Color, Guion, Punta, TipoElemento, Trazo } from './tipos'

export type { Guion }
export type Fuente = 'sans' | 'serif' | 'mono' | 'mano' | 'titulos'
export type Alineacion = 'izquierda' | 'centro' | 'derecha' | 'justificado'
export type AlineacionV = 'arriba' | 'medio' | 'abajo'
export type TipoForma =
  | 'rectangulo'
  | 'redondeado'
  | 'pildora'
  | 'elipse'
  | 'rombo'
  | 'triangulo'
  | 'hexagono'
  | 'paralelogramo'
  | 'cilindro'
  | 'documento'
  | 'estrella'
  | 'globo'
  | 'flecha'
export type VarianteTarjeta = 'compacta' | 'normal' | 'expandida'
export type RellenoMarco = 'tinte' | 'tenue' | 'liso'

export interface EstiloTexto {
  fuente: Fuente
  /** px a zoom 100 %; 'auto' solo en notas y formas. */
  tamano: number | 'auto'
  alineacion: Alineacion
  alineacionV: AlineacionV
  /** 1.1 | 1.3 | 1.5 | 1.8 (las notas arrancan en 1.25). */
  interlineado: number
  colorTexto: Color | 'auto'
}
export interface DatosTexto extends EstiloTexto {
  texto: string
  rico?: DocRico
  fondo: Color | null
  anchoAuto: boolean
}
export interface DatosNota extends EstiloTexto {
  texto: string
  rico?: DocRico
  color: Color
}
export interface DatosForma extends EstiloTexto {
  texto: string
  rico?: DocRico
  forma: TipoForma
  relleno: Color | 'ninguno'
  tono: 'suave' | 'fuerte'
  borde: Color | 'ninguno'
  bordeGrosor: 1 | 2 | 4
  bordeEstilo: Guion
  /** 0.1 a 1 (afecta relleno y borde, no el texto). */
  opacidad: number
  /** Un ícono del catálogo (compartido/iconos.ts), arriba o a la izquierda del texto; solo, va centrado. */
  icono: string | null
  iconoPosicion: 'arriba' | 'izquierda'
}
/** Dónde va el título de un marco: afuera, arriba del marco (de fábrica); o adentro, como un carril (izquierda) o una franja (arriba). */
export type TituloEnMarco = 'afuera' | 'izquierda' | 'arriba'
export const TITULOS_EN: TituloEnMarco[] = ['afuera', 'izquierda', 'arriba']
export interface DatosMarco {
  titulo: string
  color: Color
  relleno: RellenoMarco
  tituloEn: TituloEnMarco
  orden?: number
}
export interface DatosTarjeta {
  variante: VarianteTarjeta
}
export interface EstiloConector {
  trazo: Trazo
  puntaInicio: Punta
  puntaFin: Punta
  guion: Guion
  grosor: number
  color: Color | null
}

// ───────── catálogos ─────────

export const COLORES_LIENZO: Color[] = ['amarillo', 'naranja', 'rojo', 'rosa', 'violeta', 'azul', 'celeste', 'verde', 'lima', 'gris']

export const NOMBRES_COLOR: Record<Color, string> = {
  gris: 'Gris',
  rojo: 'Rojo',
  naranja: 'Naranja',
  amarillo: 'Amarillo',
  lima: 'Lima',
  verde: 'Verde',
  celeste: 'Celeste',
  azul: 'Azul',
  violeta: 'Violeta',
  rosa: 'Rosa',
}

export const FUENTES: { id: Fuente; nombre: string; familia: string; papel: string }[] = [
  { id: 'sans', nombre: 'Sans', familia: 'Figtree', papel: 'La de la interfaz: neutra y muy legible' },
  { id: 'serif', nombre: 'Serif', familia: 'Newsreader', papel: 'Editorial, para citas y títulos con carácter' },
  { id: 'mono', nombre: 'Mono', familia: 'Geist Mono', papel: 'Código, claves y números alineados' },
  { id: 'mano', nombre: 'Manuscrita', familia: 'Caveat', papel: 'Letra de mano, para notas informales' },
  { id: 'titulos', nombre: 'Títulos', familia: 'Bricolage Grotesque', papel: 'Grotesca con personalidad para títulos grandes' },
]

export const FORMAS: { id: TipoForma; nombre: string; uso: string }[] = [
  { id: 'rectangulo', nombre: 'Rectángulo', uso: 'Paso' },
  { id: 'redondeado', nombre: 'Rectángulo redondeado', uso: 'Paso' },
  { id: 'pildora', nombre: 'Píldora', uso: 'Inicio o fin' },
  { id: 'elipse', nombre: 'Elipse', uso: 'Estado' },
  { id: 'rombo', nombre: 'Rombo', uso: 'Decisión' },
  { id: 'triangulo', nombre: 'Triángulo', uso: 'Aviso' },
  { id: 'hexagono', nombre: 'Hexágono', uso: 'Preparación' },
  { id: 'paralelogramo', nombre: 'Paralelogramo', uso: 'Entrada o salida' },
  { id: 'cilindro', nombre: 'Cilindro', uso: 'Datos guardados' },
  { id: 'documento', nombre: 'Documento', uso: 'Documento' },
  { id: 'estrella', nombre: 'Estrella', uso: 'Destacado' },
  { id: 'globo', nombre: 'Globo de diálogo', uso: 'Comentario' },
  { id: 'flecha', nombre: 'Flecha', uso: 'Dirección' },
]

export const ALINEACIONES: Alineacion[] = ['izquierda', 'centro', 'derecha', 'justificado']
export const ALINEACIONES_V: AlineacionV[] = ['arriba', 'medio', 'abajo']
export const TAMANOS_LETRA = [12, 14, 16, 18, 21, 24, 32, 40, 52, 64, 80, 96, 128]
export const INTERLINEADOS: { valor: number; nombre: string }[] = [
  { valor: 1.1, nombre: 'Ajustado' },
  { valor: 1.3, nombre: 'Normal' },
  { valor: 1.5, nombre: 'Cómodo' },
  { valor: 1.8, nombre: 'Amplio' },
]
export const PUNTAS: { id: Punta; nombre: string }[] = [
  { id: 'ninguna', nombre: 'Ninguna' },
  { id: 'flecha', nombre: 'Flecha' },
  { id: 'flecha_abierta', nombre: 'Flecha abierta' },
  { id: 'triangulo', nombre: 'Triángulo hueco' },
  { id: 'punto', nombre: 'Punto' },
  { id: 'rombo', nombre: 'Rombo' },
  { id: 'barra', nombre: 'Barra' },
]
export const GUIONES: { id: Guion; nombre: string }[] = [
  { id: 'solido', nombre: 'Sólida' },
  { id: 'rayado', nombre: 'Rayada' },
  { id: 'punteado', nombre: 'Punteada' },
]
export const TRAZOS: { id: Trazo; nombre: string }[] = [
  { id: 'curvo', nombre: 'Curvo' },
  { id: 'ortogonal', nombre: 'En ángulo' },
  { id: 'recto', nombre: 'Recto' },
]
export const GROSORES = [1, 2, 3, 4, 6]

/** Cuánto se puede armar en una sola llamada de armar_en_lienzo (MCP). Un diagrama más grande va por secciones. */
export const MAX_OBJETOS_ARMAR = 300
export const MAX_CONECTORES_ARMAR = 600

/** Nombre de cada tipo de objeto, para el buscador, la ayuda y la actividad. */
export const NOMBRES_TIPO: Record<TipoElemento, string> = {
  nota: 'Nota',
  texto: 'Texto',
  forma: 'Forma',
  marco: 'Marco',
  tarjeta: 'Tarjeta',
  lista: 'Lista',
  imagen: 'Imagen',
  enlace: 'Enlace',
  figma: 'Figma',
  tabla: 'Tabla',
  grafico: 'Gráfico',
}

// ───────── tamaños (única fuente: la usan la web y el servidor) ─────────

/** Tamaño de fábrica de cada objeto. */
export const TAMANOS: Record<TipoElemento, { ancho: number; alto: number }> = {
  nota: { ancho: 220, alto: 220 },
  texto: { ancho: 320, alto: 64 },
  forma: { ancho: 220, alto: 150 },
  marco: { ancho: 1120, alto: 760 },
  tarjeta: { ancho: 288, alto: 132 },
  lista: { ancho: 304, alto: 520 },
  imagen: { ancho: 360, alto: 260 },
  enlace: { ancho: 340, alto: 116 },
  figma: { ancho: 560, alto: 400 },
  // El tamaño real de una tabla sale de sus columnas y filas (medidaTabla en tabla.ts); este es el de una recién creada.
  tabla: { ancho: 480, alto: 232 },
  grafico: { ancho: 480, alto: 320 },
}

/** Lo mínimo al redimensionar (5.0.4). */
export const MINIMOS: Record<TipoElemento, { ancho: number; alto: number }> = {
  nota: { ancho: 96, alto: 96 },
  texto: { ancho: 40, alto: 12 },
  forma: { ancho: 24, alto: 24 },
  marco: { ancho: 200, alto: 140 },
  tarjeta: { ancho: 220, alto: 40 },
  lista: { ancho: 260, alto: 200 },
  imagen: { ancho: 40, alto: 24 },
  enlace: { ancho: 200, alto: 80 },
  figma: { ancho: 280, alto: 200 },
  tabla: { ancho: 160, alto: 84 },
  grafico: { ancho: 240, alto: 180 },
}

export const ANCHO_TARJETA: Record<VarianteTarjeta, number> = { compacta: 260, normal: 288, expandida: 340 }
export const ANCHO_MAX_TARJETA = 560

/** Peso y espaciado que acompañan al tamaño: los títulos se leen como títulos sin tocar nada más. */
export function pesoPorTamano(px: number): { peso: number; espaciado: string; interlineadoMin: number } {
  if (px <= 17) return { peso: 500, espaciado: '0em', interlineadoMin: 0 }
  if (px <= 27) return { peso: 560, espaciado: '-0.005em', interlineadoMin: 0 }
  if (px <= 44) return { peso: 700, espaciado: '-0.02em', interlineadoMin: 0 }
  return { peso: 800, espaciado: '-0.035em', interlineadoMin: 1.05 }
}

// ───────── valores de fábrica ─────────

export interface EstilosFabrica {
  nota: Pick<DatosNota, 'color' | 'fuente' | 'tamano' | 'alineacion' | 'alineacionV' | 'interlineado' | 'colorTexto'>
  texto: Pick<DatosTexto, 'fuente' | 'tamano' | 'alineacion' | 'alineacionV' | 'interlineado' | 'colorTexto' | 'fondo' | 'anchoAuto'>
  forma: Omit<DatosForma, 'texto' | 'rico'>
  marco: Pick<DatosMarco, 'color' | 'relleno'>
  conector: EstiloConector
}

export const ESTILOS_FABRICA: EstilosFabrica = {
  nota: { color: 'amarillo', fuente: 'sans', tamano: 'auto', alineacion: 'centro', alineacionV: 'medio', interlineado: 1.25, colorTexto: 'auto' },
  texto: { fuente: 'sans', tamano: 21, alineacion: 'izquierda', alineacionV: 'arriba', interlineado: 1.3, colorTexto: 'auto', fondo: null, anchoAuto: true },
  forma: {
    forma: 'redondeado',
    relleno: 'azul',
    tono: 'suave',
    borde: 'ninguno',
    bordeGrosor: 2,
    bordeEstilo: 'solido',
    opacidad: 1,
    fuente: 'sans',
    tamano: 16,
    alineacion: 'centro',
    alineacionV: 'medio',
    interlineado: 1.3,
    colorTexto: 'auto',
    icono: null,
    iconoPosicion: 'arriba',
  },
  marco: { color: 'gris', relleno: 'tinte' },
  conector: { trazo: 'curvo', puntaInicio: 'ninguna', puntaFin: 'flecha', guion: 'solido', grosor: 2, color: null },
}

// ───────── ajustes del lienzo de un tablero (tableros.ajustes.lienzo) ─────────

export type FondoLienzo = 'puntos' | 'lineas' | 'cruces' | 'liso'
export type GrillaLienzo = 8 | 16 | 24 | 32 | 48
export interface AjustesLienzo {
  fondo: FondoLienzo
  grilla: GrillaLienzo
  /** Los objetos se acomodan a la grilla al moverlos y al cambiarles el tamaño. */
  imanGrilla: boolean
  /** Guías que alinean con los bordes y centros de otros objetos. */
  imanObjetos: boolean
}
export const FONDOS: { id: FondoLienzo; nombre: string }[] = [
  { id: 'puntos', nombre: 'Puntos' },
  { id: 'lineas', nombre: 'Líneas' },
  { id: 'cruces', nombre: 'Cruces' },
  { id: 'liso', nombre: 'Liso' },
]
export const GRILLAS: GrillaLienzo[] = [8, 16, 24, 32, 48]
export const AJUSTES_LIENZO_FABRICA: AjustesLienzo = { fondo: 'puntos', grilla: 24, imanGrilla: false, imanObjetos: true }

/** Los ajustes del lienzo de un tablero, con los de fábrica en lo que falte. */
export function leerAjustesLienzo(ajustes: { lienzo?: Partial<AjustesLienzo> } | null | undefined): AjustesLienzo {
  const a = ajustes?.lienzo ?? {}
  const f = AJUSTES_LIENZO_FABRICA
  return {
    fondo: FONDOS.some((x) => x.id === a.fondo) ? a.fondo! : f.fondo,
    grilla: GRILLAS.includes(a.grilla as GrillaLienzo) ? (a.grilla as GrillaLienzo) : f.grilla,
    imanGrilla: typeof a.imanGrilla === 'boolean' ? a.imanGrilla : f.imanGrilla,
    imanObjetos: typeof a.imanObjetos === 'boolean' ? a.imanObjetos : f.imanObjetos,
  }
}

// ───────── normalizadores ─────────

type Datos = Record<string, unknown>

const COLORES_SET = new Set<string>(COLORES_LIENZO)
export const esColor = (v: unknown): v is Color => typeof v === 'string' && COLORES_SET.has(v)
/**
 * El relleno de una forma y el fondo de un texto también pueden ser «blanco» (con --e-blanco en tokens.css). No es parte de
 * `Color` a propósito: así no hay que tocar todo lo que indexa por color (notas, marcos, etiquetas…).
 */
export const BLANCO = 'blanco' as unknown as Color
const uno = <T extends string>(v: unknown, lista: readonly T[], porDefecto: T): T =>
  typeof v === 'string' && (lista as readonly string[]).includes(v) ? (v as T) : porDefecto
const numero = (v: unknown, min: number, max: number, porDefecto: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : porDefecto
const texto = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

const IDS_FUENTE = FUENTES.map((f) => f.id)
const IDS_FORMA = FORMAS.map((f) => f.id)
const IDS_GUION = GUIONES.map((g) => g.id)

function estiloTexto(d: Datos, base: EstiloTexto, permitirAuto: boolean): EstiloTexto {
  const tamano =
    d.tamano === 'auto' && permitirAuto ? 'auto' : typeof d.tamano === 'number' ? numero(d.tamano, 8, 400, 16) : base.tamano
  return {
    fuente: uno(d.fuente, IDS_FUENTE, base.fuente),
    tamano,
    alineacion: uno(d.alineacion, ALINEACIONES, base.alineacion),
    alineacionV: uno(d.alineacionV, ALINEACIONES_V, base.alineacionV),
    interlineado: numero(d.interlineado, 0.9, 3, base.interlineado),
    colorTexto: d.colorTexto === 'auto' ? 'auto' : esColor(d.colorTexto) ? d.colorTexto : base.colorTexto,
  }
}

const rico = (d: Datos) => (esDocRico(d.rico) ? (d.rico as DocRico) : undefined)

export function leerNota(d: Datos): DatosNota {
  const f = ESTILOS_FABRICA.nota
  return { ...estiloTexto(d, f, true), texto: texto(d.texto), rico: rico(d), color: esColor(d.color) ? d.color : f.color }
}

/** Tamaños de la 0.1 (cuatro botones) → px. */
const TAMANOS_V01: Record<string, number> = { chico: 15, mediano: 21, grande: 32, titulo: 52 }

export function leerTexto(d: Datos): DatosTexto {
  const f = ESTILOS_FABRICA.texto
  const viejo = typeof d.tamano === 'string' && d.tamano in TAMANOS_V01
  const e = estiloTexto(viejo ? { ...d, tamano: TAMANOS_V01[d.tamano as string] } : d, f, false)
  return {
    ...e,
    alineacionV: 'arriba',
    texto: texto(d.texto),
    rico: rico(d),
    fondo: d.fondo === 'blanco' ? BLANCO : esColor(d.fondo) ? d.fondo : null,
    // Los textos de la 0.1 tenían ancho fijo: se respetan. Los nuevos nacen con ancho automático.
    anchoAuto: typeof d.anchoAuto === 'boolean' ? d.anchoAuto : false,
  }
}

export function leerForma(d: Datos): DatosForma {
  const f = ESTILOS_FABRICA.forma
  // 0.1: { forma: 'rectangulo' | 'elipse' | 'rombo', color }. El rectángulo de la 0.1 tenía las esquinas redondeadas.
  const viejo = d.relleno === undefined && d.borde === undefined
  let forma = uno(d.forma, IDS_FORMA, f.forma)
  if (viejo && forma === 'rectangulo') forma = 'redondeado'
  const relleno = d.relleno === 'ninguno' ? 'ninguno' : d.relleno === 'blanco' ? BLANCO : esColor(d.relleno) ? d.relleno : viejo && esColor(d.color) ? d.color : f.relleno
  return {
    ...estiloTexto(d, f, true),
    texto: texto(d.texto),
    rico: rico(d),
    forma,
    relleno,
    tono: d.tono === 'fuerte' ? 'fuerte' : 'suave',
    borde: d.borde === 'ninguno' ? 'ninguno' : esColor(d.borde) ? d.borde : f.borde,
    bordeGrosor: d.bordeGrosor === 1 || d.bordeGrosor === 4 ? d.bordeGrosor : 2,
    bordeEstilo: uno(d.bordeEstilo, IDS_GUION, f.bordeEstilo),
    opacidad: numero(d.opacidad, 0.1, 1, f.opacidad),
    icono: esIcono(d.icono) ? d.icono : null,
    iconoPosicion: d.iconoPosicion === 'izquierda' ? 'izquierda' : 'arriba',
  }
}

export function leerMarco(d: Datos): DatosMarco {
  const f = ESTILOS_FABRICA.marco
  return {
    titulo: typeof d.titulo === 'string' ? d.titulo : 'Marco',
    color: esColor(d.color) ? d.color : f.color,
    relleno: uno(d.relleno, ['tinte', 'tenue', 'liso'] as const, f.relleno),
    tituloEn: uno(d.tituloEn, TITULOS_EN, 'afuera'),
    ...(typeof d.orden === 'number' && Number.isFinite(d.orden) ? { orden: d.orden } : {}),
  }
}

export function leerTarjeta(d: Datos): DatosTarjeta {
  return { variante: uno(d.variante, ['compacta', 'normal', 'expandida'] as const, 'normal') }
}

/** Texto plano de cualquier objeto (buscador, ayudas de accesibilidad, MCP). */
export function textoDe(d: Datos): string {
  return texto(d.titulo ?? d.texto ?? d.url ?? '')
}

// ───────── validación (servidor) ─────────

/**
 * Revisa los valores conocidos de `datos` y devuelve un mensaje si alguno está fuera de su lista o rango.
 * Lo desconocido se conserva sin tocar (así un cliente nuevo no pierde lo que un servidor viejo no entiende).
 */
export function problemaEnDatos(d: Datos): string | null {
  const malColor = (v: unknown, extra: string[] = []) => v !== undefined && v !== null && !esColor(v) && !extra.includes(v as string)
  if (d.tamano !== undefined && d.tamano !== 'auto' && !(typeof d.tamano === 'string' && d.tamano in TAMANOS_V01)) {
    if (typeof d.tamano !== 'number' || !(d.tamano >= 8 && d.tamano <= 400)) return 'tamano va de 8 a 400 (o "auto").'
  }
  if (d.opacidad !== undefined && (typeof d.opacidad !== 'number' || !(d.opacidad >= 0.1 && d.opacidad <= 1)))
    return 'opacidad va de 0,1 a 1.'
  // `fuente` es la tipografía (un texto); en un gráfico es un objeto (o null) con la tabla de la que lee.
  if (typeof d.fuente === 'string' && !IDS_FUENTE.includes(d.fuente as Fuente)) return `fuente: ${IDS_FUENTE.join(', ')}.`
  if (d.alineacion !== undefined && !ALINEACIONES.includes(d.alineacion as Alineacion)) return `alineacion: ${ALINEACIONES.join(', ')}.`
  if (d.alineacionV !== undefined && !ALINEACIONES_V.includes(d.alineacionV as AlineacionV)) return `alineacionV: ${ALINEACIONES_V.join(', ')}.`
  if (d.forma !== undefined && !IDS_FORMA.includes(d.forma as TipoForma)) return `forma: ${IDS_FORMA.join(', ')}.`
  if (malColor(d.relleno, ['ninguno', 'tinte', 'tenue', 'liso', 'blanco'])) return 'relleno: un color, "blanco" o "ninguno".'
  if (malColor(d.borde, ['ninguno'])) return 'borde: un color o "ninguno".'
  if (malColor(d.color)) return `color: ${COLORES_LIENZO.join(', ')}.`
  if (malColor(d.colorTexto, ['auto'])) return 'colorTexto: un color o "auto".'
  if (malColor(d.fondo, ['blanco'])) return 'fondo: un color, "blanco" o null.'
  if (d.icono !== undefined && d.icono !== null && !esIcono(d.icono)) return 'icono: un nombre del catálogo de íconos (leer_guia, tema "diagramas") o null.'
  if (d.iconoPosicion !== undefined && d.iconoPosicion !== 'arriba' && d.iconoPosicion !== 'izquierda') return 'iconoPosicion: arriba o izquierda.'
  if (d.tituloEn !== undefined && !TITULOS_EN.includes(d.tituloEn as TituloEnMarco)) return `tituloEn: ${TITULOS_EN.join(', ')}.`
  if (d.bordeEstilo !== undefined && !IDS_GUION.includes(d.bordeEstilo as Guion)) return `bordeEstilo: ${IDS_GUION.join(', ')}.`
  if (d.interlineado !== undefined && (typeof d.interlineado !== 'number' || !(d.interlineado >= 0.9 && d.interlineado <= 3)))
    return 'interlineado va de 0,9 a 3.'
  // Tablas y gráficos: se revisan por las claves que traen (este validador no sabe de qué tipo es el objeto; `tipo` no
  // sirve para distinguirlos: los enlaces también lo tienen).
  if (d.columnas !== undefined || d.filas !== undefined || d.cabecera !== undefined) return problemaEnTabla(d)
  if (d.fuente !== undefined || d.propios !== undefined) return problemaEnGrafico(d)
  return null
}

// ───────── copiar y pegar estilo ─────────

export type Estilo = Record<string, unknown>

const CLAVES_ESTILO: Partial<Record<TipoElemento, string[]>> = {
  nota: ['color', 'fuente', 'tamano', 'alineacion', 'alineacionV', 'interlineado', 'colorTexto'],
  texto: ['fuente', 'tamano', 'alineacion', 'interlineado', 'colorTexto', 'fondo'],
  forma: ['forma', 'relleno', 'tono', 'borde', 'bordeGrosor', 'bordeEstilo', 'opacidad', 'fuente', 'tamano', 'alineacion', 'alineacionV', 'interlineado', 'colorTexto'],
  marco: ['color', 'relleno', 'tituloEn'],
  tarjeta: ['variante'],
}

/** Propiedades de estilo del objeto (no texto ni tamaño), ya normalizadas. */
export function extraerEstilo(tipo: TipoElemento, d: Datos): Estilo | null {
  const claves = CLAVES_ESTILO[tipo]
  if (!claves) return null
  const leido: Datos =
    tipo === 'nota' ? { ...leerNota(d) } : tipo === 'texto' ? { ...leerTexto(d) } : tipo === 'forma' ? { ...leerForma(d) } : tipo === 'marco' ? { ...leerMarco(d) } : { ...leerTarjeta(d) }
  const estilo: Estilo = { tipo }
  for (const k of claves) estilo[k] = leido[k]
  return estilo
}

/** Lo que el destino entiende del estilo copiado (de nota a forma: color → relleno, fuente, alineación…). */
export function estiloPara(tipoDestino: TipoElemento, estilo: Estilo): Datos {
  const origen = estilo.tipo as TipoElemento
  const claves = CLAVES_ESTILO[tipoDestino]
  if (!claves) return {}
  const salida: Datos = {}
  for (const k of claves) {
    if (!(k in estilo) || k === 'tipo') continue
    // El relleno de un marco (tinte, tenue, liso) no es el de una forma, y el fondo de un texto no es el de otro tipo.
    if (k === 'relleno' && (origen === 'marco') !== (tipoDestino === 'marco')) continue
    if (k === 'fondo' && origen !== 'texto') continue
    salida[k] = estilo[k]
  }
  // Traducciones entre tipos: el color principal de uno pasa a ser el del otro.
  const color = esColor(estilo.color) ? estilo.color : esColor(estilo.relleno) ? estilo.relleno : esColor(estilo.fondo) ? estilo.fondo : undefined
  if (color && origen !== tipoDestino) {
    if (tipoDestino === 'forma') salida.relleno = color
    if (tipoDestino === 'nota' || tipoDestino === 'marco') salida.color = color
  }
  if (tipoDestino === 'texto' && salida.tamano === 'auto') delete salida.tamano
  return salida
}
