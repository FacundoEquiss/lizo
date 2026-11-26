// Los proveedores como los ve la persona en Configuración → IA (plan 9.10, 14.7 y 16.8): «Anthropic (Claude)», «GPT», «Gemini»,
// «DeepSeek» y «Otro compatible con OpenAI». Por debajo son tres adaptadores (`anthropic`, `openai`, `compatible`) y, para Gemini
// y DeepSeek, una dirección base precargada: eso lo dice `compartido/preajustes-ia.ts`; acá solo se le suma lo que es de la
// pantalla (el enlace a la consola donde se genera la clave, cómo se llama la clave y qué modelos ofrecer cuando el servidor
// todavía no trae el catálogo).
import type { IdProveedor, ModeloConocido } from '../../../../../compartido/ia'
import { PREAJUSTES_IA } from '../../../../../compartido/preajustes-ia'

export type IdOpcion = 'anthropic' | 'gpt' | 'gemini' | 'deepseek' | 'otro'

export interface OpcionProveedor {
  id: IdOpcion
  nombre: string
  /** El nombre de la clave que se propone («Anthropic»). */
  nombreClave: string
  proveedor: IdProveedor
  urlBase: string | null
  pideUrlBase: boolean
  exigePrecios: boolean
  /** Donde se genera la clave (la oficial del proveedor). null en «Otro». */
  consola: { nombre: string; url: string } | null
  aviso?: string
  modeloSugerido: string | null
  /** Los modelos que se ofrecen si el servidor no trae el catálogo. */
  modelos: { id: string; nombre: string; veImagenes: boolean }[]
}

const CONSOLAS: Record<IdOpcion, { nombre: string; url: string } | null> = {
  anthropic: { nombre: 'la consola de Anthropic', url: 'https://console.anthropic.com/settings/keys' },
  gpt: { nombre: 'la plataforma de OpenAI', url: 'https://platform.openai.com/api-keys' },
  gemini: { nombre: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' },
  deepseek: { nombre: 'la plataforma de DeepSeek', url: 'https://platform.deepseek.com/api_keys' },
  otro: null,
}

export const OPCIONES_PROVEEDOR: readonly OpcionProveedor[] = [
  {
    id: 'anthropic',
    nombre: 'Claude (Anthropic)',
    nombreClave: 'Anthropic',
    proveedor: 'anthropic',
    urlBase: null,
    pideUrlBase: false,
    exigePrecios: false,
    consola: CONSOLAS.anthropic,
    modeloSugerido: 'claude-opus-5-5',
    modelos: [],
  },
  ...PREAJUSTES_IA.map(
    (p): OpcionProveedor => ({
      id: p.id === 'gpt' ? 'gpt' : p.id,
      nombre: p.id === 'gpt' ? 'GPT (OpenAI)' : p.id === 'otro' ? 'Otro compatible con OpenAI' : p.nombre,
      nombreClave: p.id === 'otro' ? 'Otro' : p.nombre,
      proveedor: p.proveedor,
      urlBase: p.urlBase,
      pideUrlBase: p.pideUrlBase,
      exigePrecios: p.exigePrecios,
      consola: CONSOLAS[p.id],
      aviso: p.aviso,
      modeloSugerido: p.modeloSugerido,
      modelos: p.modelos,
    }),
  ),
]

export const opcionPorId = (id: IdOpcion): OpcionProveedor => OPCIONES_PROVEEDOR.find((o) => o.id === id)!

/** Qué opción es una clave o un agente según su proveedor y su dirección base (Gemini y DeepSeek son «compatible» con la suya). */
export function opcionDe(proveedor: string | null | undefined, urlBase: string | null | undefined): OpcionProveedor {
  if (proveedor === 'anthropic') return opcionPorId('anthropic')
  if (proveedor === 'openai') return opcionPorId('gpt')
  const por = OPCIONES_PROVEEDOR.find((o) => o.proveedor === 'compatible' && o.urlBase && urlBase && urlBase.startsWith(o.urlBase.replace(/\/+$/, '')))
  return por ?? opcionPorId('otro')
}

/** Los modelos de una opción: los del catálogo del servidor (con su costo por respuesta) o, si no hay, los de los preajustes. */
export function modelosDe(o: OpcionProveedor, catalogo: readonly ModeloConocido[]): { id: string; nombre: string; veImagenes: boolean; costo?: number; aviso?: string }[] {
  const conocidos = catalogo.filter((m) => m.proveedor === o.proveedor)
  const delServidor = conocidos.filter((m) => (o.proveedor === 'compatible' ? o.modelos.some((x) => x.id === m.modelo) : true))
  if (delServidor.length)
    return delServidor.map((m) => ({ id: m.modelo, nombre: m.nombre, veImagenes: m.veImagenes, costo: m.costoRespuestaUsd, aviso: m.aviso }))
  return o.modelos
}
