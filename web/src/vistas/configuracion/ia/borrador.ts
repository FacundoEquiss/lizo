// El formulario de un agente mientras se llena (todo como texto, para escribir libre) y cómo se convierte de y a lo que habla el
// servidor (`Agente` / `EntradaAgente`). Vive aparte para que, si hay que ir a cargar una clave nueva a mitad de camino, lo
// escrito se guarde y se vuelva a donde se estaba (el borrador viaja en la vista).
import { MAX_PROACTIVOS_POR_DIA, TOPE_AGENTE_DE_FABRICA_USD, PERMISOS_DE_FABRICA, type Agente, type Autonomia, type Capacidad, type ClaveIA, type EntradaAgente, type ModoConfirmar } from '../../../../../compartido/ia'
import type { Color } from '../../../../../compartido/tipos'
import { aliasValido, ALIAS_RESERVADOS, normalizarAlias } from '../../../../../compartido/menciones'
import { opcionDe, opcionPorId, type IdOpcion } from './proveedores'

export interface BorradorAgente {
  nombre: string
  alias: string
  /** Si la persona tocó el alias a mano: mientras no, sigue al nombre. */
  aliasTocado: boolean
  color: Color
  opcion: IdOpcion
  claveId: string | null
  modelo: string
  /** El modelo se escribe a mano (un modelo de «Otro» o uno que el catálogo no conoce). */
  modeloAMano: boolean
  veImagenes: 'si' | 'no' | 'catalogo'
  precioEntrada: string
  precioSalida: string
  precioCache: string
  instrucciones: string
  permisos: Capacidad[]
  confirmar: ModoConfirmar
  topeMesUsd: string
  puedeMencionarIA: boolean
  activo: boolean
  autonomia: Autonomia
  tarjetaNueva: boolean
  listas: string[]
  maxPorDia: string
  resumenDiario: boolean
}

export const borradorNuevo = (): BorradorAgente => ({
  nombre: '',
  alias: '',
  aliasTocado: false,
  color: 'violeta',
  opcion: 'anthropic',
  claveId: null,
  modelo: opcionPorId('anthropic').modeloSugerido ?? '',
  modeloAMano: false,
  veImagenes: 'catalogo',
  precioEntrada: '',
  precioSalida: '',
  precioCache: '',
  instrucciones: '',
  permisos: [...PERMISOS_DE_FABRICA],
  confirmar: 'peligrosas',
  topeMesUsd: String(TOPE_AGENTE_DE_FABRICA_USD),
  puedeMencionarIA: false,
  activo: true,
  autonomia: 'sugiere',
  tarjetaNueva: false,
  listas: [],
  maxPorDia: String(MAX_PROACTIVOS_POR_DIA),
  resumenDiario: false,
})

const num = (n: number | undefined | null) => (n === undefined || n === null ? '' : String(n).replace('.', ','))
/** Un número escrito a la argentina («0,5» o «0.5»); NaN si no es un número. */
export const aNumero = (t: string) => (t.trim() === '' ? NaN : Number(t.trim().replace(',', '.')))

export function borradorDe(a: Agente, claves: readonly ClaveIA[]): BorradorAgente {
  const clave = claves.find((c) => c.id === a.claveId)
  const opcion = opcionDe(a.proveedor, clave?.urlBase)
  return {
    nombre: a.nombre,
    alias: a.alias,
    aliasTocado: true,
    color: a.color,
    opcion: opcion.id,
    claveId: a.claveId,
    modelo: a.modelo ?? '',
    modeloAMano: false,
    veImagenes: a.veImagenes === null ? 'catalogo' : a.veImagenes ? 'si' : 'no',
    precioEntrada: num(a.precioManual?.entrada),
    precioSalida: num(a.precioManual?.salida),
    precioCache: num(a.precioManual?.cacheLectura),
    instrucciones: a.instrucciones,
    permisos: [...a.permisos],
    confirmar: a.confirmar,
    topeMesUsd: num(a.topeMesUsd),
    puedeMencionarIA: a.puedeMencionarIA,
    activo: a.activo,
    autonomia: a.autonomia,
    tarjetaNueva: !!a.disparadores.tarjetaNueva,
    listas: a.disparadores.tarjetaNueva?.listas ?? [],
    maxPorDia: String(a.disparadores.maxPorDia ?? MAX_PROACTIVOS_POR_DIA),
    resumenDiario: !!a.disparadores.resumenDiario,
  }
}

/** Lo que está mal en el formulario, por campo (vacío si está bien). Los mismos límites que revisa el servidor. */
export function errores(b: BorradorAgente, existentes: { miembroId?: string; alias: string; nombre: string }[], propio?: string): Partial<Record<'nombre' | 'alias' | 'tope' | 'modelo' | 'precio' | 'listas', string>> {
  const e: Partial<Record<'nombre' | 'alias' | 'tope' | 'modelo' | 'precio' | 'listas', string>> = {}
  if (!b.nombre.trim()) e.nombre = 'Poneles un nombre.'
  else if (b.nombre.trim().length > 40) e.nombre = 'El nombre llega a 40 letras.'
  else if (existentes.some((x) => x.miembroId !== propio && x.nombre.toLowerCase() === b.nombre.trim().toLowerCase())) e.nombre = 'Ya hay alguien con ese nombre.'
  const alias = aliasDe(b)
  if (ALIAS_RESERVADOS.includes(alias)) e.alias = `«${alias}» es un nombre reservado de Telar: elegí otro.`
  else if (!aliasValido(alias)) e.alias = 'Usá entre 2 y 32 letras minúsculas, números, punto, guion o guion bajo, y empezá con una letra o un número.'
  else if (existentes.some((x) => x.miembroId !== propio && x.alias === alias)) e.alias = `@${alias} ya lo usa otra persona o IA.`
  const tope = aNumero(b.topeMesUsd)
  if (!(tope >= 0.01 && tope <= 100000)) e.tope = 'El tope va de USD 0,01 a USD 100.000.'
  if (!b.modelo.trim() || /\s/.test(b.modelo.trim())) e.modelo = 'Elegí el modelo (sin espacios).'
  if (opcionPorId(b.opcion).exigePrecios) {
    const [en, sa] = [aNumero(b.precioEntrada), aNumero(b.precioSalida)]
    if (!(en >= 0) || !(sa >= 0)) e.precio = 'Sin el precio por millón de tokens, Telar no puede frenar el gasto y el agente no se activa.'
  }
  if (b.tarjetaNueva && b.listas.length === 0) e.listas = 'Elegí al menos una lista para que revise las tarjetas nuevas.'
  return e
}

/** El alias que va a quedar: el escrito o, si la persona no lo tocó, el que sale del nombre. */
export const aliasDe = (b: BorradorAgente) => (b.aliasTocado ? b.alias.trim().toLowerCase().replace(/^@/, '') : normalizarAlias(b.nombre))

export function aEntrada(b: BorradorAgente, miembroId?: string): EntradaAgente {
  const o = opcionPorId(b.opcion)
  const e: EntradaAgente = {
    ...(miembroId ? { miembroId } : {}),
    nombre: b.nombre.trim(),
    alias: aliasDe(b),
    color: b.color,
    modo: 'api',
    proveedor: o.proveedor,
    modelo: b.modelo.trim(),
    claveId: b.claveId,
    instrucciones: b.instrucciones.trim(),
    permisos: b.permisos,
    confirmar: b.confirmar,
    puedeMencionarIA: b.puedeMencionarIA,
    topeMesUsd: aNumero(b.topeMesUsd),
    activo: b.activo,
    autonomia: b.autonomia,
    disparadores: {
      ...(b.tarjetaNueva ? { tarjetaNueva: { listas: b.listas } } : {}),
      ...(b.resumenDiario ? { resumenDiario: { tableroId: null } } : {}),
      ...(b.tarjetaNueva || b.resumenDiario ? { maxPorDia: Math.max(1, Math.round(aNumero(b.maxPorDia)) || MAX_PROACTIVOS_POR_DIA) } : {}),
    },
  }
  if (o.exigePrecios) {
    e.precioManual = { entrada: aNumero(b.precioEntrada), salida: aNumero(b.precioSalida), cacheLectura: Number.isFinite(aNumero(b.precioCache)) ? aNumero(b.precioCache) : 0 }
    e.veImagenes = b.veImagenes === 'si'
  } else {
    e.precioManual = null
    e.veImagenes = null
  }
  return e
}
