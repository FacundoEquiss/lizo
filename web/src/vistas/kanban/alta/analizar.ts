// La sintaxis rápida de siempre para agregar una tarjeta (error: el horno se traba !alta #cocina @yo). Sigue andando
// al escribir el título (y al dictarlo en el celular), pero ya no hace falta saberla: el compositor tiene sus propios
// selectores de tipo, prioridad y etiquetas, y muestra lo que entendió del texto.
import type { Prioridad, TipoTarjeta } from '../../../../../compartido/tipos'

const TIPOS: Record<string, TipoTarjeta> = {
  tarea: 'tarea',
  error: 'error',
  bug: 'error',
  idea: 'idea',
  historia: 'historia',
  epica: 'epica',
  épica: 'epica',
  pregunta: 'pregunta',
  decision: 'decision',
  decisión: 'decision',
}
const PRIORIDADES: Record<string, Prioridad> = { urgente: 'urgente', alta: 'alta', media: 'media', baja: 'baja' }

/** "error: el horno se traba !alta #cocina @yo" → título, tipo, prioridad, etiquetas y responsables. */
export function analizarRapido(texto: string) {
  let titulo = texto.trim()
  let tipo: TipoTarjeta | undefined
  let prioridad: Prioridad | undefined
  const etiquetas: string[] = []
  const responsables: string[] = []
  const prefijo = /^(tarea|error|bug|idea|historia|[ée]pica|pregunta|decisi[oó]n):\s*/i.exec(titulo)
  if (prefijo) {
    tipo = TIPOS[prefijo[1]!.toLowerCase()]
    titulo = titulo.slice(prefijo[0].length)
  }
  titulo = titulo
    .replace(/(^|\s)!(urgente|alta|media|baja)\b/gi, (_m, esp, p) => {
      prioridad = PRIORIDADES[p.toLowerCase()]
      return esp
    })
    .replace(/(^|\s)#([\p{L}\d/_-]+)/gu, (_m, esp, e) => {
      etiquetas.push(e)
      return esp
    })
    .replace(/(^|\s)@([\p{L}\d._-]+)/gu, (_m, esp, r) => {
      responsables.push(r)
      return esp
    })
    .replace(/\s+/g, ' ')
    .trim()
  return { titulo, tipo, prioridad, etiquetas, responsables }
}
