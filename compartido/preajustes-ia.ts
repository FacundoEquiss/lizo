// Los preajustes de «Agregar clave» y «Nuevo agente» (plan 9.10 y 16.8, tarea 6.3): «GPT», «Gemini», «DeepSeek» y «Otro». Dicen
// qué proveedor y qué dirección base usa cada uno, qué modelos ofrecer y qué avisar. Son datos puros (sin red, sin Node): los usan
// la pantalla (`SeccionIA`) y el servidor. Los PRECIOS no están acá: viven en `servidor/src/ia/proveedores/precios-b2.ts`, con fecha
// y fuente (la prueba de contrato verifica que cada modelo de acá tenga el suyo).
//
// Modelos y avisos al 25/11/2026 (Anexo D del plan). Los avisos son lo que la persona tiene que saber antes de elegir.
import type { IdProveedor } from './ia'

export interface ModeloDePreajuste { id: string; nombre: string; veImagenes: boolean }

export interface Preajuste {
  id: 'gpt' | 'gemini' | 'deepseek' | 'otro'
  nombre: string
  /** El adaptador que lo atiende: GPT por Responses; los demás por Chat Completions «compatible». */
  proveedor: IdProveedor
  /** La dirección base que se precarga. null en «Otro»: la escribe la persona. */
  urlBase: string | null
  /** ¿La pantalla tiene que pedir la dirección base? */
  pideUrlBase: boolean
  modeloSugerido: string | null
  modelos: ModeloDePreajuste[]
  /** «Otro»: la persona escribe los precios (entrada, salida y caché por millón de tokens); sin ellos el agente no se activa. */
  exigePrecios: boolean
  /** Algo que la persona tiene que saber (nivel gratis de Gemini, horario pico de DeepSeek). */
  aviso?: string
}

export const PREAJUSTES_IA: readonly Preajuste[] = [
  {
    id: 'gpt',
    nombre: 'GPT',
    proveedor: 'openai',
    urlBase: null,
    pideUrlBase: false,
    modeloSugerido: 'gpt-6.2-sol',
    modelos: [
      { id: 'gpt-6.2-astra', nombre: 'GPT-6.2 Astra', veImagenes: true },
      { id: 'gpt-6.2-sol', nombre: 'GPT-6.2 Sol', veImagenes: true },
      { id: 'gpt-6.1-terra', nombre: 'GPT-6.1 Terra', veImagenes: true },
      { id: 'gpt-6-luna', nombre: 'GPT-6 Luna', veImagenes: true },
    ],
    exigePrecios: false,
  },
  {
    id: 'gemini',
    nombre: 'Gemini',
    proveedor: 'compatible',
    urlBase: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    pideUrlBase: false,
    modeloSugerido: 'gemini-4-hydrogen',
    modelos: [
      { id: 'gemini-4-carbon', nombre: 'Gemini 4 Carbon', veImagenes: true },
      { id: 'gemini-4-hydrogen', nombre: 'Gemini 4 Hydrogen', veImagenes: true },
      { id: 'gemini-3.8-flash', nombre: 'Gemini 3.8 Flash', veImagenes: true },
      { id: 'gemini-3.5-flash-lite', nombre: 'Gemini 3.5 Flash-Lite', veImagenes: true },
    ],
    exigePrecios: false,
    aviso:
      'Con el nivel gratis de Google, lo que Telar le manda (tarjetas, comentarios, lo que lea el agente) lo usa Google para mejorar ' +
      'sus productos y lo pueden leer personas. En el nivel pago, no. Para el tablero conviene el nivel pago (activá la facturación en Google AI Studio). ' +
      'El punto de entrada compatible con OpenAI de Google está en beta.',
  },
  {
    id: 'deepseek',
    nombre: 'DeepSeek',
    proveedor: 'compatible',
    urlBase: 'https://api.deepseek.com',
    pideUrlBase: false,
    modeloSugerido: 'deepseek-flash',
    modelos: [
      { id: 'deepseek-flash', nombre: 'DeepSeek Flash', veImagenes: true },
      { id: 'deepseek-v4-pro', nombre: 'DeepSeek V4 Pro', veImagenes: false },
    ],
    exigePrecios: false,
    aviso: 'En horario pico (lunes a viernes, de 01 a 04 y de 06 a 10 UTC) DeepSeek cobra el doble. Lo que le mandás se procesa en los servidores de DeepSeek.',
  },
  {
    id: 'otro',
    nombre: 'Otro (compatible con OpenAI)',
    proveedor: 'compatible',
    urlBase: null,
    pideUrlBase: true,
    modeloSugerido: null,
    modelos: [],
    exigePrecios: true,
    aviso:
      'Sirve cualquier servicio con formato de OpenAI (Groq, OpenRouter, Mistral, Together…; Ollama o LM Studio solo con Telar en tu computadora). ' +
      'Escribí la dirección base, el nombre del modelo, si ve imágenes y el precio por millón de tokens: sin precio, Telar no puede frenar el gasto y el agente no se activa. ' +
      'El modelo tiene que admitir herramientas.',
  },
]

export const preajusteDe = (id: Preajuste['id']): Preajuste => PREAJUSTES_IA.find((p) => p.id === id)!
