// Las menciones `@alias` vistas desde la interfaz (plan de la IA integrada, 14.3): detectar cuándo se está escribiendo una,
// qué va a pasar con cada miembro al mencionarlo y dónde cae el cursor dentro de un campo. Lo de resolver y sugerir es de
// compartido/menciones.ts (lo mismo que usa el servidor para disparar). Sin React, sin red.
import type { Miembro } from '../../../compartido/tipos'

/** El `@…` que se está escribiendo: desde el «@» hasta el final de lo que lo acompaña; `parcial` es lo tipeado hasta el cursor. */
export interface DisparoMencion {
  desde: number
  hasta: number
  parcial: string
}

const CARACTER_DE_ALIAS = /[\p{L}\p{N}\p{M}_.-]/u

/**
 * ¿Se está escribiendo una mención en la posición `cursor`? Hay que estar pegado a un `@` que está al principio del texto o
 * después de un espacio o un salto de línea (en un mail, `a@b`, no se sugiere nada). `hasta` llega al final de la palabra
 * aunque el cursor esté en el medio, así elegir una opción reemplaza el alias entero.
 */
export function disparoDeMencion(texto: string, cursor: number): DisparoMencion | null {
  if (cursor < 1 || cursor > texto.length) return null
  let i = cursor
  while (i > 0 && CARACTER_DE_ALIAS.test(texto[i - 1]!)) i--
  if (texto[i - 1] !== '@') return null
  const antes = texto[i - 2]
  if (antes !== undefined && !/\s/.test(antes)) return null
  let hasta = cursor
  while (hasta < texto.length && CARACTER_DE_ALIAS.test(texto[hasta]!)) hasta++
  return { desde: i - 1, hasta, parcial: texto.slice(i, cursor) }
}

/** Lo que va a pasar al mencionar a alguien: el texto de la opción y si es un problema (sin clave, pausado). */
export interface Efecto {
  texto: string
  problema: boolean
}

/** Qué va a pasar si se menciona a este miembro (textos de 14.6). */
export function efectoDeMencionar(m: Miembro): Efecto {
  if (m.esYo) return { texto: 'sos vos', problema: false }
  if (m.tipo === 'humano') return { texto: 'le avisa', problema: false }
  const a = m.agente
  if (!a) return { texto: 'le llega cuando se conecta', problema: false }
  if (a.estado === 'sin_clave' || a.estado === 'clave_invalida') return { texto: 'sin clave: no puede responder', problema: true }
  if (a.estado === 'pausado') return { texto: 'pausado', problema: true }
  if (a.estado === 'en_tope') return { texto: 'en su tope del mes', problema: true }
  return { texto: a.modo === 'api' ? 'responde sola' : 'le llega cuando se conecta', problema: false }
}

const PROPIEDADES_DEL_TEXTO = [
  'boxSizing',
  'width',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariantLigatures',
  'fontFeatureSettings',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'tabSize',
  'wordSpacing',
] as const

/**
 * Dónde está, en la ventana, el carácter `indice` de un campo de texto: se copia el texto hasta ahí a un espejo invisible
 * con el mismo estilo y se mide una marca. Para pegar la lista de menciones al `@` y no al borde del campo.
 */
export function rectDeCaracter(campo: HTMLTextAreaElement | HTMLInputElement, indice: number): DOMRect {
  const estilo = getComputedStyle(campo)
  const espejo = document.createElement('div')
  for (const p of PROPIEDADES_DEL_TEXTO) espejo.style[p] = estilo[p]
  Object.assign(espejo.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' })
  espejo.textContent = campo.value.slice(0, indice)
  const marca = document.createElement('span')
  marca.textContent = campo.value.slice(indice, indice + 1) || '.'
  espejo.append(marca)
  document.body.append(espejo)
  const caja = campo.getBoundingClientRect()
  const x = caja.left + parseFloat(estilo.borderLeftWidth) + marca.offsetLeft - campo.scrollLeft
  const y = caja.top + parseFloat(estilo.borderTopWidth) + marca.offsetTop - campo.scrollTop
  const alto = marca.offsetHeight
  espejo.remove()
  return new DOMRect(x, y, 1, alto)
}
