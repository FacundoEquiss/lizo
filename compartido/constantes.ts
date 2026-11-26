import type {
  Categoria,
  Color,
  EstadoPorque,
  Prioridad,
  TipoTarjeta,
  TipoVinculo,
} from './tipos'

export const TIPOS_TARJETA: { id: TipoTarjeta; nombre: string; color: Color; descripcion: string }[] = [
  { id: 'tarea', nombre: 'Tarea', color: 'azul', descripcion: 'Algo que hay que hacer' },
  { id: 'error', nombre: 'Error', color: 'rojo', descripcion: 'Algo que está roto' },
  { id: 'idea', nombre: 'Idea', color: 'amarillo', descripcion: 'Una propuesta para pensar' },
  { id: 'historia', nombre: 'Historia', color: 'verde', descripcion: 'Una parte con valor para quien juega o usa' },
  { id: 'epica', nombre: 'Épica', color: 'violeta', descripcion: 'Agrupa tarjetas de una iniciativa grande' },
  { id: 'pregunta', nombre: 'Pregunta', color: 'celeste', descripcion: 'Algo que hay que averiguar o responder' },
  { id: 'decision', nombre: 'Decisión', color: 'naranja', descripcion: 'Una decisión con su porqué' },
]

export const PRIORIDADES: { id: Prioridad; nombre: string; peso: number }[] = [
  { id: 'urgente', nombre: 'Urgente', peso: 4 },
  { id: 'alta', nombre: 'Alta', peso: 3 },
  { id: 'media', nombre: 'Media', peso: 2 },
  { id: 'baja', nombre: 'Baja', peso: 1 },
  { id: 'ninguna', nombre: 'Sin prioridad', peso: 0 },
]

export const CATEGORIAS: { id: Categoria; nombre: string; color: Color }[] = [
  { id: 'por_hacer', nombre: 'Por hacer', color: 'gris' },
  { id: 'en_curso', nombre: 'En curso', color: 'azul' },
  { id: 'hecho', nombre: 'Hecho', color: 'verde' },
]

export const COLORES: { id: Color; nombre: string }[] = [
  { id: 'verde', nombre: 'Verde' },
  { id: 'amarillo', nombre: 'Amarillo' },
  { id: 'naranja', nombre: 'Naranja' },
  { id: 'rojo', nombre: 'Rojo' },
  { id: 'violeta', nombre: 'Violeta' },
  { id: 'azul', nombre: 'Azul' },
  { id: 'celeste', nombre: 'Celeste' },
  { id: 'lima', nombre: 'Lima' },
  { id: 'rosa', nombre: 'Rosa' },
  { id: 'gris', nombre: 'Gris' },
]

export const ESTADOS_PORQUE: { id: EstadoPorque; nombre: string; color: Color }[] = [
  { id: 'abierta', nombre: 'Abierta', color: 'gris' },
  { id: 'propuesta', nombre: 'Propuesta', color: 'amarillo' },
  { id: 'aceptada', nombre: 'Aceptada', color: 'verde' },
  { id: 'rechazada', nombre: 'Rechazada', color: 'rojo' },
  { id: 'reemplazada', nombre: 'Reemplazada', color: 'violeta' },
]

/** Texto de cada vínculo visto desde el origen (ida) y desde el destino (vuelta). */
export const VINCULOS: { id: TipoVinculo; ida: string; vuelta: string }[] = [
  { id: 'bloquea', ida: 'bloquea a', vuelta: 'depende de' },
  { id: 'relacionada', ida: 'se relaciona con', vuelta: 'se relaciona con' },
  { id: 'duplica', ida: 'duplica a', vuelta: 'está duplicada por' },
  { id: 'causa', ida: 'causa', vuelta: 'es causada por' },
  { id: 'implementa', ida: 'implementa', vuelta: 'es implementada por' },
]

export const COLORES_NOTA: Color[] = ['amarillo', 'naranja', 'rojo', 'rosa', 'violeta', 'azul', 'celeste', 'verde', 'lima', 'gris']

export function nombreTipo(t: TipoTarjeta): string {
  return TIPOS_TARJETA.find((x) => x.id === t)?.nombre ?? t
}

export function nombrePrioridad(p: Prioridad): string {
  return PRIORIDADES.find((x) => x.id === p)?.nombre ?? p
}

export function pesoPrioridad(p: Prioridad): number {
  return PRIORIDADES.find((x) => x.id === p)?.peso ?? 0
}

export function textoVinculo(tipo: TipoVinculo, direccion: 'ida' | 'vuelta'): string {
  const v = VINCULOS.find((x) => x.id === tipo)
  if (!v) return tipo
  return direccion === 'ida' ? v.ida : v.vuelta
}

export const VERSION = '0.3.0'
export const PUERTO_POR_DEFECTO = 4318
export const PUERTO_WEB_DEV = 4317
