// Los precios de los modelos y la única cuenta del costo (docs/plan-ia-integrada.md, 9.4 y 12.1).
//
// Cada fila lleva su fecha y su fuente: el precio de un modelo cambia, y sin saber de cuándo es no se puede confiar en el
// tope de gasto. Todo es USD por millón de tokens. `costoUsd` es la ÚNICA cuenta: el ciclo, la pantalla de gasto y la
// prueba real la usan igual (ninguno vuelve a multiplicar tokens por su cuenta).
//
// Cómo se suma un modelo (9.10): una fila acá con su `verificado` y su `fuente`, y actualizar la tabla de 9.4 del plan.
import type { IdProveedor, ModeloConocido, PrecioManual } from '../../../../compartido/ia'
import type { CapacidadesModelo, Uso } from '../tipos'
import { capacidadesCompatible } from './compatible'
import { capacidadesOpenAI } from './openai'
import { PRECIOS_B2 } from './precios-b2'

export interface PrecioModelo {
  proveedor: IdProveedor
  /** Para 'compatible': el dominio de la dirección base al que aplica (api.deepseek.com). */
  host?: string
  modelo: string
  nombre: string
  /** USD por millón de tokens. `cacheEscritura` es la de 5 minutos (la única que usa Telar). */
  entrada: number
  salida: number
  cacheLectura: number
  cacheEscritura: number
  /**
   * Otro precio a partir de cierto tamaño de pedido (Haiku 5.5: más de 100.000 tokens). El tamaño cuenta TODA la entrada del
   * pedido: lo normal, lo leído del caché y lo escrito en el caché. Si no trae `cacheLectura` / `cacheEscritura`, escalan
   * igual que la entrada.
   */
  desde?: { tokensEntrada: number; entrada: number; salida: number; cacheLectura?: number; cacheEscritura?: number }
  /** Multiplicador por franja horaria UTC (DeepSeek en horario pico). `dias`: 0 = domingo … 6 = sábado. */
  franjas?: { dias: number[]; desdeUtc: string; hastaUtc: string; por: number }[]
  /** Precio que cambia en una fecha (Gemini): desde ese día (UTC) valen estos. Sin `cacheLectura`, el caché escala igual que la entrada. */
  cambia?: { desde: string; entrada: number; salida: number; cacheLectura?: number }
  capacidades: CapacidadesModelo
  /** Cuándo se miró la fuente: AAAA-MM-DD. */
  verificado: string
  /** La página oficial donde se leyó. */
  fuente: string
}

// ───────────────────────── Anthropic (verificado el 25/11/2026) ─────────────────────────
// Contra la página de precios y la de modelos de la documentación oficial (Anexo D del plan). Los IDs son los de la API,
// sin fecha. Opus 5.5 y Sonnet 5.5 cobran el caché leído a 0,05 veces la entrada (no 0,1). El pensamiento va incluido en
// los tokens de salida.
const FUENTE_PRECIOS_ANTHROPIC = 'https://platform.claude.com/docs/en/about-claude/pricing'
const VERIFICADO_ANTHROPIC = '2026-11-25'
const CAPACIDADES_CLAUDE: CapacidadesModelo = { imagenes: true, imagenesEnResultados: true, contexto: 1_000_000, salidaMax: 128_000 }

export const PRECIOS_ANTHROPIC: PrecioModelo[] = [
  {
    proveedor: 'anthropic',
    modelo: 'claude-fable-5-2',
    nombre: 'Claude Fable 5.2',
    entrada: 8,
    salida: 40,
    cacheLectura: 0.2,
    cacheEscritura: 10,
    capacidades: CAPACIDADES_CLAUDE,
    verificado: VERIFICADO_ANTHROPIC,
    fuente: FUENTE_PRECIOS_ANTHROPIC,
  },
  {
    proveedor: 'anthropic',
    modelo: 'claude-opus-5-5',
    nombre: 'Claude Opus 5.5',
    entrada: 4,
    salida: 20,
    cacheLectura: 0.2,
    cacheEscritura: 5,
    capacidades: CAPACIDADES_CLAUDE,
    verificado: VERIFICADO_ANTHROPIC,
    fuente: FUENTE_PRECIOS_ANTHROPIC,
  },
  {
    proveedor: 'anthropic',
    modelo: 'claude-sonnet-5-5',
    nombre: 'Claude Sonnet 5.5',
    entrada: 2,
    salida: 10,
    cacheLectura: 0.1,
    cacheEscritura: 2.5,
    capacidades: CAPACIDADES_CLAUDE,
    verificado: VERIFICADO_ANTHROPIC,
    fuente: FUENTE_PRECIOS_ANTHROPIC,
  },
  {
    proveedor: 'anthropic',
    modelo: 'claude-haiku-5-5',
    nombre: 'Claude Haiku 5.5',
    entrada: 0.1,
    salida: 0.5,
    cacheLectura: 0.01,
    cacheEscritura: 0.125,
    // Más de 100.000 tokens de entrada en UN pedido (contando lo leído y lo escrito en caché): 0,50 / 2,50, caché 0,05 / 0,625.
    desde: { tokensEntrada: 100_000, entrada: 0.5, salida: 2.5, cacheLectura: 0.05, cacheEscritura: 0.625 },
    capacidades: CAPACIDADES_CLAUDE,
    verificado: VERIFICADO_ANTHROPIC,
    fuente: FUENTE_PRECIOS_ANTHROPIC,
  },
]

// ───────────────────────── el proveedor falso ─────────────────────────
// Precios de mentira, redondos, para que los topes se prueben con cuentas fáciles: un pedido de 200.000 tokens de entrada y
// 20.000 de salida cuesta USD 0,30. Sirve para cualquier modelo `guion:<nombre>` (ver `precioDe`).
export const PRECIOS_FALSO: PrecioModelo[] = [
  {
    proveedor: 'falso',
    modelo: 'guion:*',
    nombre: 'Proveedor falso (guiones de prueba)',
    entrada: 1,
    salida: 5,
    cacheLectura: 0.1,
    cacheEscritura: 1.25,
    capacidades: { imagenes: true, imagenesEnResultados: true, contexto: 1_000_000, salidaMax: 128_000 },
    verificado: '2026-11-25',
    fuente: 'docs/plan-ia-integrada.md, 15.2',
  },
]

// ───────────────────────── todos juntos ─────────────────────────
// OpenAI (GPT), Gemini y DeepSeek viven en precios-b2.ts (cada fila con SU fecha y SU fuente) y se suman acá: una sola lista, una sola
// interfaz `PrecioModelo` y una sola cuenta (`costoUsd`).
export { PRECIOS_B2 }
export const PRECIOS: PrecioModelo[] = [...PRECIOS_ANTHROPIC, ...PRECIOS_B2, ...PRECIOS_FALSO]

/**
 * El precio de un modelo, o undefined si Telar no lo conoce (un agente con un modelo sin precio no se activa: el tope no
 * podría frenarlo). `host` es solo para 'compatible'. Los modelos del proveedor falso son todos `guion:<nombre>`.
 */
export function precioDe(proveedor: IdProveedor, modelo: string, host?: string): PrecioModelo | undefined {
  const buscado = proveedor === 'falso' && modelo.startsWith('guion:') ? 'guion:*' : modelo
  return PRECIOS.find((p) => p.proveedor === proveedor && p.modelo === buscado && (p.host === undefined || p.host === host))
}

const aMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function multiplicadorDeFranja(p: PrecioModelo, ahora: Date): number {
  for (const f of p.franjas ?? []) {
    if (!f.dias.includes(ahora.getUTCDay())) continue
    const min = ahora.getUTCHours() * 60 + ahora.getUTCMinutes()
    const d = aMinutos(f.desdeUtc)
    const h = aMinutos(f.hastaUtc)
    const dentro = d <= h ? min >= d && min < h : min >= d || min < h
    if (dentro) return f.por
  }
  return 1
}

/**
 * Lo que costó un pedido, en USD, con el precio vigente en `ahora` (cambio con fecha, escalón por tamaño y franja horaria).
 * Es la única cuenta (12.1). Redondea a nueve decimales para no arrastrar ruido de coma flotante.
 */
export function costoUsd(p: PrecioModelo, uso: Uso, ahora: Date = new Date()): number {
  let { entrada, salida, cacheLectura, cacheEscritura } = p
  if (p.cambia && ahora.getTime() >= Date.parse(`${p.cambia.desde}T00:00:00Z`)) {
    const k = p.cambia.entrada / p.entrada
    entrada = p.cambia.entrada
    salida = p.cambia.salida
    cacheLectura = p.cambia.cacheLectura ?? cacheLectura * k
    cacheEscritura *= k
  }
  const tamano = uso.entrada + uso.cacheLectura + uso.cacheEscritura
  if (p.desde && tamano > p.desde.tokensEntrada) {
    const k = p.desde.entrada / entrada
    cacheLectura = p.desde.cacheLectura ?? cacheLectura * k
    cacheEscritura = p.desde.cacheEscritura ?? cacheEscritura * k
    entrada = p.desde.entrada
    salida = p.desde.salida
  }
  const bruto = (uso.entrada * entrada + uso.salida * salida + uso.cacheLectura * cacheLectura + uso.cacheEscritura * cacheEscritura) / 1_000_000
  return Math.round(bruto * multiplicadorDeFranja(p, ahora) * 1e9) / 1e9
}

// ───────────────────────── el precio de un agente ─────────────────────────

/** El host de una dirección base, o null si no es una dirección. */
const hostDe = (urlBase?: string | null): string | null => {
  try {
    return urlBase ? new URL(urlBase).hostname.toLowerCase().replace(/\.$/, '') : null
  } catch {
    return null
  }
}
const idModelo = (m: string) => m.trim().replace(/^models\//i, '')

/** El precio que Telar conoce para ese modelo, o null. Para 'compatible' se mira también el host de la dirección base. */
export function precioConocido(e: { proveedor: IdProveedor; modelo: string; urlBase?: string | null }, lista: readonly PrecioModelo[] = PRECIOS): PrecioModelo | null {
  const m = idModelo(e.modelo)
  const host = hostDe(e.urlBase)
  const buscado = e.proveedor === 'falso' && m.startsWith('guion:') ? 'guion:*' : m
  return lista.find((p) => p.proveedor === e.proveedor && p.modelo === buscado && (p.host === undefined || p.host === host)) ?? null
}

/**
 * Sin precio no hay tope que frene el gasto: el agente no se puede activar. La pantalla traduce `codigo` y muestra `paraLaPersona`
 * (no es un `ErrorProveedor`: no viene del proveedor y no cabe en sus tipos; el contrato compartido no se tocó).
 */
export class ErrorSinPrecio extends Error {
  readonly codigo = 'sin_precio' as const
  readonly paraLaPersona: string
  constructor(public readonly modelo: string, motivo: 'falta' | 'invalido' = 'falta') {
    const m = modelo ? `«${modelo}»` : 'este modelo'
    const texto = motivo === 'falta'
      ? `Telar no conoce el precio de ${m}. Escribí cuánto cuesta por millón de tokens (entrada, salida y entrada en caché): sin eso el tope de gasto no puede frenarlo y el agente no se puede activar. Si es un modelo local y gratis, poné 0.`
      : `Los precios de ${m} no son válidos: tienen que ser números de 0 a 1.000 dólares por millón de tokens.`
    super(texto)
    this.name = 'ErrorSinPrecio'
    this.paraLaPersona = texto
  }
}

const precioValido = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000

/**
 * El precio con el que se cobra a un agente: el que Telar conoce o, para lo que no conoce, el que escribió el dueño. Tira
 * `ErrorSinPrecio` si no hay ninguno (o si los que escribió no sirven). El cero es válido (un modelo local no cuesta).
 */
export function precioDelAgente(
  e: { proveedor: IdProveedor; modelo: string; urlBase?: string | null; precioManual?: PrecioManual | null },
  lista: readonly PrecioModelo[] = PRECIOS,
): PrecioModelo {
  const m = idModelo(e.modelo)
  const conocido = precioConocido(e, lista)
  if (conocido) return conocido
  const pm = e.precioManual
  if (!pm) throw new ErrorSinPrecio(m)
  if (!precioValido(pm.entrada) || !precioValido(pm.salida) || !precioValido(pm.cacheLectura)) throw new ErrorSinPrecio(m, 'invalido')
  return {
    proveedor: e.proveedor, host: hostDe(e.urlBase) ?? undefined, modelo: m, nombre: m,
    entrada: pm.entrada, salida: pm.salida, cacheLectura: pm.cacheLectura, cacheEscritura: pm.entrada,
    capacidades: e.proveedor === 'openai' ? capacidadesOpenAI(m) : capacidadesCompatible(m),
    verificado: 'a mano', fuente: 'precio escrito por el dueño',
  }
}

/**
 * Lo que costó un pedido de un agente, en USD: el precio de su modelo (o el que escribió el dueño) y la cuenta de `costoUsd`.
 * Tira `ErrorSinPrecio` si no hay precio de ninguno de los dos: es lo que usa el ciclo (cableado.ts).
 */
export function costoDelAgente(
  e: { proveedor: IdProveedor; modelo: string; urlBase?: string | null; precioManual?: PrecioManual | null; uso: Uso; ahora?: Date },
): number {
  return costoUsd(precioDelAgente(e), e.uso, e.ahora)
}

// ───────────────────────── el catálogo para la pantalla ─────────────────────────

/** Una respuesta simple en una tarjeta (9.7): lo fijo (10.500 tokens) escrito en el caché, 2.500 de contexto y 450 de salida. */
const RESPUESTA_SIMPLE: Uso = { entrada: 2_500, salida: 450, cacheLectura: 0, cacheEscritura: 10_500 }

/**
 * Los modelos que Telar conoce, con lo que cuesta una respuesta simple (estimado, caché frío), para Configuración → IA. Sin el falso.
 * Es lo que se conecta con `ponerCatalogoDeModelos` (cableado.ts).
 */
export function catalogoDeModelos(ahora: Date = new Date()): ModeloConocido[] {
  return PRECIOS.filter((p) => p.proveedor !== 'falso').map((p) => {
    const avisos: string[] = []
    if (p.franjas?.length) avisos.push('En horario pico cuesta más.')
    if (p.cambia && Date.parse(`${p.cambia.desde}T00:00:00Z`) > ahora.getTime()) avisos.push(`El precio sube desde el ${p.cambia.desde.split('-').reverse().join('/')}.`)
    return {
      proveedor: p.proveedor,
      modelo: p.modelo,
      nombre: p.nombre,
      veImagenes: p.capacidades.imagenes,
      costoRespuestaUsd: Math.round(costoUsd(p, RESPUESTA_SIMPLE, ahora) * 1000) / 1000,
      ...(avisos.length ? { aviso: avisos.join(' ') } : {}),
    }
  })
}
