// Búsqueda con operadores al estilo de Trello, en castellano.
//   texto libre        "horno lento"
//   tipo:error         tipo de tarjeta (tarea, error, idea, historia, epica, pregunta, decision)
//   #clientes          etiqueta (también etiqueta:"decorar/tienda")
//   @yo  @claude       responsables
//   lista:"Por hacer"  lista
//   estado:hecho       categoría de la lista (por_hacer, en_curso, hecho)
//   prioridad:alta     (o !alta)
//   vence:hoy|semana|mes|vencidas|sin
//   tiene:pr|github|figma|discord|porque|adjuntos|checklist|descripcion|portada|comentarios|vinculos
//   porque:abierta|aceptada|…
//   -operador          niega cualquier término (-tipo:idea, -#clientes, -horno)
import { normalizar } from './texto'
import type { Categoria, Etiqueta, Lista, Miembro, TarjetaResumen } from './tipos'

export interface Termino {
  negado: boolean
  campo: string | null
  valor: string
}

const ALIAS_CAMPOS: Record<string, string> = {
  tipo: 'tipo',
  type: 'tipo',
  etiqueta: 'etiqueta',
  label: 'etiqueta',
  lista: 'lista',
  list: 'lista',
  estado: 'estado',
  prioridad: 'prioridad',
  vence: 'vence',
  due: 'vence',
  tiene: 'tiene',
  has: 'tiene',
  porque: 'porque',
  responsable: 'responsable',
  miembro: 'responsable',
  clave: 'clave',
}

export function analizarConsulta(consulta: string): Termino[] {
  const terminos: Termino[] = []
  const re = /(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(consulta))) {
    const negado = m[1] === '-'
    let campo = m[2] ? ALIAS_CAMPOS[normalizar(m[2])] ?? null : null
    let valor = (m[3] ?? m[4] ?? '').trim()
    if (m[2] && !campo) valor = `${m[2]}:${valor}`
    if (!campo && valor.startsWith('#') && valor.length > 1) {
      campo = 'etiqueta'
      valor = valor.slice(1)
    } else if (!campo && valor.startsWith('@') && valor.length > 1) {
      campo = 'responsable'
      valor = valor.slice(1)
    } else if (!campo && valor.startsWith('!') && valor.length > 1) {
      campo = 'prioridad'
      valor = valor.slice(1)
    }
    if (!valor) continue
    terminos.push({ negado, campo, valor: normalizar(valor) })
  }
  return terminos
}

export interface ContextoFiltro {
  listas: Map<string, Lista>
  etiquetas: Map<string, Etiqueta>
  miembros: Map<string, Miembro>
  ahora?: Date
  /** Texto extra por tarjeta (descripción, porqué…) cuando se tiene; si no, se usa título y clave. */
  textoExtra?: (t: TarjetaResumen) => string
}

const TIPOS_ALIAS: Record<string, string> = {
  epica: 'epica',
  epicas: 'epica',
  historia: 'historia',
  historias: 'historia',
  tarea: 'tarea',
  tareas: 'tarea',
  error: 'error',
  errores: 'error',
  bug: 'error',
  idea: 'idea',
  ideas: 'idea',
  pregunta: 'pregunta',
  preguntas: 'pregunta',
  decision: 'decision',
  decisiones: 'decision',
}

function cumple(t: TarjetaResumen, term: Termino, ctx: ContextoFiltro): boolean {
  const v = term.valor
  switch (term.campo) {
    case null: {
      const base = normalizar(
        `${t.clave} ${t.titulo} ${t.etiquetas.map((id) => ctx.etiquetas.get(id)?.nombre ?? '').join(' ')} ${
          ctx.textoExtra ? ctx.textoExtra(t) : ''
        }`,
      )
      return base.includes(v)
    }
    case 'clave':
      return normalizar(t.clave) === v
    case 'tipo':
      return t.tipo === (TIPOS_ALIAS[v] ?? v)
    case 'etiqueta':
      return t.etiquetas.some((id) => {
        const e = ctx.etiquetas.get(id)
        return e ? normalizar(e.nombre).includes(v) || e.color === v : false
      })
    case 'responsable':
      if (v === 'yo' || v === 'me') return t.responsables.some((id) => ctx.miembros.get(id)?.esYo)
      if (v === 'nadie' || v === 'sin') return t.responsables.length === 0
      return t.responsables.some((id) => normalizar(ctx.miembros.get(id)?.nombre ?? '').includes(v))
    case 'lista': {
      const l = t.listaId ? ctx.listas.get(t.listaId) : undefined
      return l ? normalizar(l.nombre).includes(v) : false
    }
    case 'estado': {
      const l = t.listaId ? ctx.listas.get(t.listaId) : undefined
      const cat: Categoria | null = l?.categoria ?? null
      const alias: Record<string, Categoria> = {
        por_hacer: 'por_hacer',
        porhacer: 'por_hacer',
        pendiente: 'por_hacer',
        en_curso: 'en_curso',
        encurso: 'en_curso',
        curso: 'en_curso',
        hecho: 'hecho',
        hecha: 'hecho',
        terminado: 'hecho',
      }
      return cat !== null && cat === (alias[v] ?? v)
    }
    case 'prioridad':
      return t.prioridad === v || (v === 'sin' && t.prioridad === 'ninguna')
    case 'vence': {
      const ahora = ctx.ahora ?? new Date()
      if (v === 'sin' || v === 'nunca') return !t.fechas.vence
      if (!t.fechas.vence) return false
      const vence = new Date(t.fechas.vence)
      const completa = Boolean(t.fechas.completada)
      if (v === 'vencidas' || v === 'vencida' || v === 'atrasadas') return !completa && vence < ahora
      const dias = v === 'hoy' ? 1 : v === 'semana' ? 7 : v === 'mes' ? 31 : Number(v) || 0
      if (!dias) return false
      const limite = new Date(ahora)
      limite.setHours(23, 59, 59, 999)
      limite.setDate(limite.getDate() + dias - 1)
      return !completa && vence <= limite
    }
    case 'tiene':
      switch (v) {
        case 'pr':
          return t.enlaces.some((e) => e.tipo === 'github_pr')
        case 'github':
          return t.enlaces.some((e) => e.tipo.startsWith('github'))
        case 'figma':
          return t.enlaces.some((e) => e.tipo === 'figma')
        case 'discord':
          return t.discord || t.enlaces.some((e) => e.tipo === 'discord')
        case 'porque':
          return Boolean(t.porque?.motivo)
        case 'adjuntos':
        case 'adjunto':
          return t.contadores.adjuntos > 0
        case 'checklist':
          return t.contadores.checklistTotal > 0
        case 'descripcion':
          return t.tieneDescripcion
        case 'portada':
          return Boolean(t.portada)
        case 'comentarios':
          return t.contadores.comentarios > 0
        case 'vinculos':
          return t.contadores.vinculos > 0
        case 'bloqueo':
        case 'bloqueos':
          return t.contadores.bloqueadaPor > 0
        default:
          return false
      }
    case 'porque':
      return t.porque?.estado === v
    default:
      return true
  }
}

export function filtrarTarjetas(tarjetas: TarjetaResumen[], consulta: string, ctx: ContextoFiltro): TarjetaResumen[] {
  const terminos = analizarConsulta(consulta)
  if (terminos.length === 0) return tarjetas
  return tarjetas.filter((t) => terminos.every((term) => cumple(t, term, ctx) !== term.negado))
}

export function hayFiltro(consulta: string): boolean {
  return analizarConsulta(consulta).length > 0
}
