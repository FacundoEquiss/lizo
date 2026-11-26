// Precios y modelos de OpenAI (GPT), Gemini y DeepSeek (plan 9.4, tarea 6.3), verificados el **25/11/2026** en las páginas
// oficiales (cada fila lleva su fecha y su fuente). USD por millón de tokens. Más lo que pasa con «Otro» (cualquier servicio
// compatible): sin precios a mano, el agente no se puede activar, porque el tope de gasto no podría frenarlo (9.2, 16.8).
//
// Solo los DATOS: la interfaz `PrecioModelo`, `PRECIOS` (que los suma a los de Anthropic), `costoUsd`, `precioDelAgente` y
// `ErrorSinPrecio` viven en `precios.ts`, la única cuenta del costo.
import type { PrecioModelo } from './precios'
import { capacidadesCompatible } from './compatible'
import { capacidadesOpenAI } from './openai'

const VERIFICADO = '2026-11-25'
const F_OPENAI = 'https://developers.openai.com/api/docs/pricing'
const F_GEMINI = 'https://aistudio.google.com/docs/pricing'
const F_DEEPSEEK = 'https://api-docs.deepseek.com/quick_start/pricing'

/** OpenAI, precios de contexto corto (hasta 272.000 tokens de entrada). Escribir caché (30 min) es lo que usa GPT-6 por omisión. */
const openai = (modelo: string, nombre: string, p: { e: number; s: number; cl: number; ce: number; largo: { e: number; s: number } }): PrecioModelo => ({
  proveedor: 'openai', modelo, nombre,
  entrada: p.e, salida: p.s, cacheLectura: p.cl, cacheEscritura: p.ce,
  desde: { tokensEntrada: 272_000, entrada: p.largo.e, salida: p.largo.s },
  capacidades: capacidadesOpenAI(modelo), verificado: VERIFICADO, fuente: F_OPENAI,
})

const GEMINI = 'generativelanguage.googleapis.com'
/** Gemini: el caché implícito no cobra escritura (cacheEscritura = entrada, por si algún día se informa). */
const gemini = (modelo: string, nombre: string, p: { e: number; s: number; cl: number }, cambia?: PrecioModelo['cambia']): PrecioModelo => ({
  proveedor: 'compatible', host: GEMINI, modelo, nombre,
  entrada: p.e, salida: p.s, cacheLectura: p.cl, cacheEscritura: p.e,
  ...(cambia ? { cambia } : {}),
  capacidades: capacidadesCompatible(modelo), verificado: VERIFICADO, fuente: F_GEMINI,
})

/** DeepSeek, horario normal; en pico (lunes a viernes, 01:00–04:00 y 06:00–10:00 UTC) vale el doble. */
const PICO_DEEPSEEK = [
  { dias: [1, 2, 3, 4, 5], desdeUtc: '01:00', hastaUtc: '04:00', por: 2 },
  { dias: [1, 2, 3, 4, 5], desdeUtc: '06:00', hastaUtc: '10:00', por: 2 },
]
const deepseek = (modelo: string, nombre: string, p: { e: number; s: number; cl: number }): PrecioModelo => ({
  proveedor: 'compatible', host: 'api.deepseek.com', modelo, nombre,
  entrada: p.e, salida: p.s, cacheLectura: p.cl, cacheEscritura: p.e,
  franjas: PICO_DEEPSEEK,
  capacidades: capacidadesCompatible(modelo), verificado: VERIFICADO, fuente: F_DEEPSEEK,
})

export const PRECIOS_B2: PrecioModelo[] = [
  // OpenAI (25/11/2026)
  openai('gpt-6.2-astra', 'GPT-6.2 Astra', { e: 8, s: 40, cl: 0.4, ce: 10, largo: { e: 16, s: 60 } }),
  openai('gpt-6.2-sol', 'GPT-6.2 Sol', { e: 2, s: 10, cl: 0.1, ce: 2.5, largo: { e: 4, s: 15 } }),
  openai('gpt-6.1-terra', 'GPT-6.1 Terra', { e: 1, s: 5, cl: 0.05, ce: 1.25, largo: { e: 2, s: 7.5 } }),
  openai('gpt-6-luna', 'GPT-6 Luna', { e: 0.1, s: 0.5, cl: 0.01, ce: 0.125, largo: { e: 0.2, s: 0.75 } }),
  // Gemini por el punto compatible (25/11/2026). Cambios con fecha: los de la página de precios.
  gemini('gemini-4-carbon', 'Gemini 4 Carbon', { e: 2, s: 10, cl: 0.1 }, { desde: '2026-12-01', entrada: 4, salida: 20, cacheLectura: 0.2 }),
  gemini('gemini-4-hydrogen', 'Gemini 4 Hydrogen', { e: 1.5, s: 7.5, cl: 0.075 }),
  gemini('gemini-3.8-flash', 'Gemini 3.8 Flash', { e: 0.75, s: 3.75, cl: 0.075 }, { desde: '2027-01-01', entrada: 1.5, salida: 7.5, cacheLectura: 0.15 }),
  gemini('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', { e: 0.3, s: 2.5, cl: 0.03 }),
  // DeepSeek (25/11/2026)
  deepseek('deepseek-flash', 'DeepSeek Flash', { e: 0.15, s: 0.6, cl: 0.003 }),
  deepseek('deepseek-v4-pro', 'DeepSeek V4 Pro', { e: 0.66, s: 1.98, cl: 0.022 }),
]
