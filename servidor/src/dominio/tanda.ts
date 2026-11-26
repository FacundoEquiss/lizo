// La tanda de un trabajo de la IA integrada (plan 7.6): todo lo que hizo un trabajo se marca con su id en la actividad
// (`actividad.tanda`) y los ids que tocó se anotan por llamada (`ia_llamadas.efectos`), para mostrarlo y, en la F3, deshacerlo.
//
// Va por el contexto asíncrono (como el alcance de una cuenta en api.ts): solo se anota lo que hizo ESA llamada, aunque otra
// persona esté tocando la misma cuenta al mismo tiempo. Lo importan el Servicio (al registrar la actividad) y el bus de eventos
// (al publicar), y por eso no importa nada de `ia/`: los tipos viven en `ia/tipos.ts` y acá entran con `import type`.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Evento } from '../../../compartido/tipos'
import type { Efectos } from '../ia/tipos'

export interface Tanda {
  /** El id del trabajo. */
  id: string
  /** La llamada a una herramienta que está corriendo (null fuera de una llamada). */
  llamadaId: string | null
  efectos: Efectos
}

const almacen = new AsyncLocalStorage<Tanda>()

/** La tanda del trabajo que está corriendo en este contexto asíncrono, o undefined. */
export function tandaActual(): Tanda | undefined {
  return almacen.getStore()
}

/** Corre `fn` dentro de la tanda: lo que publique el bus y lo que registre la actividad queda marcado. */
export function conTanda<T>(tanda: Tanda, fn: () => Promise<T>): Promise<T> {
  return almacen.run(tanda, fn)
}

/** Corre `fn` fuera de toda tanda: lo que hace Telar por su cuenta (archivar lo viejo) no se le anota a un trabajo de la IA que casualmente lo disparó. */
export function sinTanda<T>(fn: () => Promise<T>): Promise<T> {
  return almacen.exit(fn)
}

/** Efectos vacíos (una tanda nueva, o una llamada nueva dentro de ella). */
export function efectosVacios(): Efectos {
  return { tarjetas: [], elementos: [], conectores: [], marcos: [], otros: [] }
}

const sumar = (lista: string[], id: unknown) => {
  if (typeof id === 'string' && id && !lista.includes(id)) lista.push(id)
}

/**
 * Anota en la tanda en curso (si hay) los ids que trae un evento del bus: tarjeta, elemento, conector, marco. Lo llama
 * `BusEventos.publicar`. Los eventos que no son de contenido (actividad, notificación, trabajo) no cuentan.
 */
export function anotarEvento(e: Pick<Evento, 'tipo' | 'accion' | 'tarjetaId' | 'proyectoId' | 'tableroId' | 'datos'>): void {
  const tanda = almacen.getStore()
  if (!tanda) return
  const ef = tanda.efectos
  const datos = (e.datos ?? {}) as Record<string, any>
  switch (e.tipo) {
    case 'tarjeta':
    case 'tarjeta.detalle':
      sumar(ef.tarjetas, e.tarjetaId ?? datos.id)
      break
    case 'elemento':
      sumar(ef.elementos, datos.id)
      break
    case 'conector':
      sumar(ef.conectores, datos.id)
      break
    case 'lienzo':
      for (const el of Array.isArray(datos.elementos) ? datos.elementos : []) sumar(ef.elementos, el?.id)
      for (const co of Array.isArray(datos.conectores) ? datos.conectores : []) sumar(ef.conectores, co?.id)
      break
    case 'diseno':
      for (const m of Array.isArray(datos.marcos) ? datos.marcos : []) sumar(ef.marcos, typeof m === 'string' ? m : m?.id)
      sumar(ef.marcos, datos.marco)
      break
    case 'lista':
    case 'tablero':
    case 'proyecto':
    case 'etiqueta':
      sumar(ef.otros, `${e.tipo}:${datos.id ?? e.tableroId ?? e.proyectoId ?? ''}`)
      break
    default:
      break
  }
}
