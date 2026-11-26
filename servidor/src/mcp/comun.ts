// Piezas comunes de las herramientas MCP. Toda herramienta (también las de la sección Diseño que viene) sigue estas
// reglas, para que un modelo aprenda una vez y acierte en todas:
//  - Nombre: verbo_cosa en castellano (listar_, leer_, crear_, actualizar_, agregar_, armar_, mover_, archivar_…).
//  - Parámetros en snake_case, y lo mismo se llama igual en todas: proyecto, tablero, marco, objeto, tarjeta, color…
//    Las referencias aceptan lo que un humano diría: el prefijo o el nombre del proyecto, el nombre del tablero, la
//    clave de una tarjeta (RC-12), el título de un marco o el texto de una nota (además del id).
//  - La descripción dice para qué sirve y qué devuelve, y trae un ejemplo corto de llamada.
//  - Los esquemas son estrictos: un parámetro que no existe es un error que dice cuáles hay (nada se ignora callado).
//  - Respuestas compactas: { ok: true, mensaje, <lo creado o cambiado, con su id>, url? }; las de lectura, los datos.
//    Lo que trae id es lo que hace falta para el paso siguiente.
//  - Los errores dicen qué estuvo mal y cómo seguir (qué valores valen, qué herramienta da el id que falta).
//  - Nada se borra de verdad: lo más fuerte es archivar una tarjeta o sacar algo del lienzo (quitar_del_lienzo), y las dos cosas
//    se deshacen con la misma herramienta.
import { z } from 'zod'
import type { Actor, Etiqueta, Lista, Miembro, TarjetaResumen } from '../../../compartido/tipos'
import type { VistaTablero } from '../../../compartido/vistas'
import { urlPublica } from '../diseno/urls'
import type { Servicio } from '../dominio/servicio'

export interface Herramienta {
  nombre: string
  titulo: string
  descripcion: string
  esquema: z.ZodObject
  soloLectura: boolean
  idempotente?: boolean
  ejecutar: (s: Servicio, actor: Actor, args: any) => Promise<unknown>
}

export function definir<S extends z.ZodObject>(h: {
  nombre: string
  titulo: string
  descripcion: string
  esquema: S
  soloLectura: boolean
  idempotente?: boolean
  ejecutar: (s: Servicio, actor: Actor, args: z.infer<S>) => Promise<unknown>
}): Herramienta {
  return h as Herramienta
}

// ───────── errores de validación en castellano, con lo que vale ─────────

const nombreTipo: Record<string, string> = {
  string: 'un texto',
  number: 'un número',
  int: 'un número entero',
  boolean: 'true o false',
  array: 'una lista',
  object: 'un objeto',
  null: 'null',
}

const queLlego = (v: unknown) =>
  v === undefined ? 'nada' : v === null ? 'null' : Array.isArray(v) ? 'una lista' : typeof v === 'string' ? `«${v.length > 40 ? v.slice(0, 40) + '…' : v}»` : JSON.stringify(v)

let configurado = false

/**
 * Los mensajes de zod en castellano y diciendo qué vale ("tiene que ser uno de: …, llegó «cuadrado»"). Los ve el
 * modelo cuando se equivoca en un parámetro (el SDK los antepone con "Input validation error"). Vale para todo el
 * proceso: la API web también responde en castellano.
 */
export function configurarMensajes() {
  if (configurado) return
  configurado = true
  z.config({
    customError: (iss) => {
      switch (iss.code) {
        case 'invalid_type':
          if (iss.input === undefined) return 'falta (es obligatorio)'
          return `tiene que ser ${nombreTipo[iss.expected] ?? iss.expected}; llegó ${queLlego(iss.input)}`
        case 'invalid_value':
          return `tiene que ser ${iss.values.length === 1 ? JSON.stringify(iss.values[0]) : `uno de: ${iss.values.map((v) => String(v)).join(', ')}`}; llegó ${queLlego(iss.input)}`
        case 'too_small':
          if (iss.origin === 'string') return Number(iss.minimum) <= 1 ? 'no puede estar vacío' : `tiene que tener al menos ${iss.minimum} caracteres`
          if (iss.origin === 'array') return `tiene que tener al menos ${iss.minimum} ${Number(iss.minimum) === 1 ? 'elemento' : 'elementos'}`
          return `tiene que ser ${iss.inclusive ? 'mayor o igual a' : 'mayor que'} ${iss.minimum}; llegó ${queLlego(iss.input)}`
        case 'too_big':
          if (iss.origin === 'string') return `puede tener hasta ${iss.maximum} caracteres`
          if (iss.origin === 'array') return `puede tener hasta ${iss.maximum} elementos`
          return `tiene que ser ${iss.inclusive ? 'menor o igual a' : 'menor que'} ${iss.maximum}; llegó ${queLlego(iss.input)}`
        case 'unrecognized_keys':
          return `${iss.keys.length === 1 ? 'parámetro desconocido' : 'parámetros desconocidos'}: ${iss.keys.join(', ')} (mirá la descripción de la herramienta: ahí están los que existen)`
        case 'invalid_union':
          return `no tiene una forma válida; llegó ${queLlego(iss.input)}`
        case 'invalid_format':
          return `no tiene el formato esperado (${iss.format}); llegó ${queLlego(iss.input)}`
        default:
          return undefined
      }
    },
  })
}

// ───────── parámetros que se repiten ─────────

export const COLORES = ['gris', 'rojo', 'naranja', 'amarillo', 'lima', 'verde', 'celeste', 'azul', 'violeta', 'rosa'] as const
export const colores = z.enum(COLORES).describe('Color.')
export const refTarjeta = z.string().min(1).describe('Clave de la tarjeta, por ejemplo RC-12.')
export const refProyecto = z
  .string()
  .optional()
  .describe('Prefijo o nombre del proyecto (por ejemplo RC). Si hay un solo proyecto se puede omitir.')
export const refTablero = z.string().optional().describe('Nombre del tablero. Si se omite, el primero del proyecto.')

// ───────── respuestas compactas ─────────

export interface Contexto {
  listas: Map<string, Lista>
  etiquetas: Map<string, Etiqueta>
  miembros: Map<string, Miembro>
}

export async function contextoDe(s: Servicio, proyectoId: string, tableroIds: string[]): Promise<Contexto> {
  const listas = new Map<string, Lista>()
  for (const id of tableroIds) for (const l of await s.listarListas(id, true)) listas.set(l.id, l)
  return {
    listas,
    etiquetas: new Map((await s.listarEtiquetas(proyectoId)).map((e) => [e.id, e])),
    miembros: new Map((await s.listarMiembros()).map((m) => [m.id, m])),
  }
}

export function urlTarjeta(clave: string) {
  const [prefijo] = clave.split('-')
  return `${urlPublica()}/${prefijo}?tarjeta=${clave}`
}

/** El link a un tablero (al Kanban, al lienzo o a Diseño). */
export function urlTablero(prefijo: string, slug: string, vista: VistaTablero = 'kanban') {
  return `${urlPublica()}/${prefijo}/${slug}${vista === 'lienzo' ? '/lienzo' : vista === 'diseno' ? '/diseno' : ''}`
}

export function compacta(t: TarjetaResumen, ctx: Contexto) {
  const lista = t.listaId ? ctx.listas.get(t.listaId) : undefined
  const r: Record<string, unknown> = { clave: t.clave, tipo: t.tipo, titulo: t.titulo }
  if (lista) r.lista = lista.nombre
  if (t.prioridad !== 'ninguna') r.prioridad = t.prioridad
  if (t.etiquetas.length) r.etiquetas = t.etiquetas.map((id) => ctx.etiquetas.get(id)?.nombre).filter(Boolean)
  if (t.responsables.length) r.responsables = t.responsables.map((id) => ctx.miembros.get(id)?.nombre).filter(Boolean)
  if (t.fechas.vence) r.vence = t.fechas.vence.slice(0, 10)
  if (t.estimacion != null) r.puntos = t.estimacion
  if (t.porque) r.porque = t.porque.estado
  if (t.contadores.checklistTotal) r.checklist = `${t.contadores.checklistHechos}/${t.contadores.checklistTotal}`
  if (t.contadores.comentarios) r.comentarios = t.contadores.comentarios
  if (t.contadores.bloqueadaPor) r.bloqueada_por = t.contadores.bloqueadaPor
  if (t.enlaces.length) r.enlaces = t.enlaces.map((e) => `${e.tipo}: ${e.titulo}`)
  if (t.discord) r.de_discord = true
  if (t.archivada) r.archivada = true
  return r
}

export async function respuestaTarjeta(s: Servicio, t: TarjetaResumen, mensaje: string) {
  const ctx = await contextoDe(s, t.proyectoId, [t.tableroId])
  return { ok: true, mensaje, tarjeta: { ...compacta(t, ctx), url: urlTarjeta(t.clave) } }
}

/** Saca las claves sin valor (las respuestas no llevan "undefined" ni campos vacíos). */
export function limpio<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

/**
 * El tablero de una llamada (por nombre, o el primero del proyecto que tenga lienzo) con el link a su lienzo. Si el tablero que se
 * nombra no tiene lienzo, el error dice qué tiene y cómo sumarlo (las herramientas del lienzo, las tablas y los gráficos pasan por acá).
 */
export async function tableroDe(s: Servicio, a: { tablero?: string; proyecto?: string }) {
  const tf = await s.resolverTablero(a.tablero, a.proyecto, { vista: 'lienzo' })
  const p = await s.resolverProyecto(tf.proyecto_id, { archivados: true })
  return { id: tf.id as string, nombre: tf.nombre as string, url: urlTablero(p.prefijo, tf.slug, 'lienzo') }
}
