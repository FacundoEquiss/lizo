// Tipos que comparten el servidor, la web y el MCP.
// Fechas: siempre texto ISO 8601 (UTC). IDs: nanoid.
import type { ResumenAgente } from './ia'
import type { VistaTablero } from './vistas'

export type TipoTarjeta = 'epica' | 'historia' | 'tarea' | 'error' | 'idea' | 'pregunta' | 'decision'
export type Prioridad = 'urgente' | 'alta' | 'media' | 'baja' | 'ninguna'
export type Categoria = 'por_hacer' | 'en_curso' | 'hecho'
export type Color =
  | 'gris'
  | 'rojo'
  | 'naranja'
  | 'amarillo'
  | 'lima'
  | 'verde'
  | 'celeste'
  | 'azul'
  | 'violeta'
  | 'rosa'
export type EstadoPorque = 'abierta' | 'propuesta' | 'aceptada' | 'rechazada' | 'reemplazada'
export type TipoVinculo = 'bloquea' | 'relacionada' | 'duplica' | 'causa' | 'implementa'
export type TipoEnlace =
  | 'github_issue'
  | 'github_pr'
  | 'github_commit'
  | 'github_rama'
  | 'github_repo'
  | 'figma'
  | 'discord'
  | 'web'
export type TipoElemento =
  | 'nota'
  | 'texto'
  | 'forma'
  | 'marco'
  | 'tarjeta'
  | 'lista'
  | 'imagen'
  | 'enlace'
  | 'figma'
  | 'tabla'
  | 'grafico'
export type Trazo = 'recto' | 'ortogonal' | 'curvo'
export type Punta = 'ninguna' | 'flecha' | 'flecha_abierta' | 'triangulo' | 'punto' | 'rombo' | 'barra'
export type Guion = 'solido' | 'rayado' | 'punteado'
export type Lado = 'arriba' | 'derecha' | 'abajo' | 'izquierda'

/** Quién hizo algo: una persona, una IA (por MCP) o el sistema (importadores). */
export interface Actor {
  tipo: 'humano' | 'ia' | 'sistema'
  id: string
  nombre: string
  /** Cliente concreto: "Claude Code", "Claude Desktop", "ChatGPT", "Importador de Discord"… */
  cliente?: string
}

export interface Miembro {
  id: string
  nombre: string
  tipo: 'humano' | 'ia'
  color: Color
  iniciales: string
  esYo: boolean
  /** Cómo se lo menciona (`@claude`). Único por cuenta (compartido/menciones.ts). Falta en un miembro viejo hasta que se le completa. */
  alias?: string
  /** Un miembro que se quita no se borra: deja de aparecer al mencionar y no dispara. */
  archivado?: boolean
  /** Si es un agente de la IA integrada: cómo responde y en qué estado está. */
  agente?: ResumenAgente
}

/** Lo que describe al tablero (se ve igual en todos los dispositivos). Lo del dispositivo va en el navegador. */
export interface AjustesTablero {
  lienzo?: {
    fondo?: 'puntos' | 'lineas' | 'cruces' | 'liso'
    grilla?: 8 | 16 | 24 | 32 | 48
    imanGrilla?: boolean
    imanObjetos?: boolean
  }
  /**
   * Archivo automático de las listas de «Hecho» (compartido/hecho.ts): a los cuántos días de haber llegado a Hecho Telar archiva
   * solo una tarjeta. `null` = nunca. Si no está, valen los de fábrica (30), también en los tableros que ya existían.
   */
  archivoHecho?: { dias: 7 | 14 | 30 | 60 | null }
  /**
   * Las vistas que tiene el tablero (compartido/vistas.ts). Si no está (los tableros que ya existían), tiene las tres. Se cambia con
   * `vistas` al actualizar el tablero (la API lo valida), no con `ajustes`.
   */
  vistas?: VistaTablero[]
}

export interface TableroResumen {
  id: string
  proyectoId: string
  nombre: string
  slug: string
  descripcion: string
  orden: string
  archivado: boolean
  ajustes: AjustesTablero
  /** Las vistas que tiene (al menos una): el Kanban, el lienzo y/o Diseño. Los tableros de antes tienen las tres. */
  vistas: VistaTablero[]
  /** Tarjetas sin archivar del tablero. */
  abiertas: number
}

export interface Proyecto {
  id: string
  nombre: string
  descripcion: string
  color: Color
  prefijo: string
  repoGithub: string | null
  /** Foto del proyecto (ruta en /archivos) o null. */
  imagen: string | null
  /** Emoji del proyecto (si no hay foto) o null. */
  emoji: string | null
  archivado: boolean
  creadoEn: string
  tableros: TableroResumen[]
}

export interface Lista {
  id: string
  tableroId: string
  nombre: string
  orden: string
  categoria: Categoria | null
  color: Color | null
  limite: number | null
  archivada: boolean
}

export interface Etiqueta {
  id: string
  proyectoId: string
  nombre: string
  color: Color
  grupo: string | null
  orden: string
}

export interface Portada {
  tipo: 'color' | 'imagen'
  /** Nombre de color o URL de la imagen. */
  valor: string
  tamano: 'arriba' | 'completa'
}

export interface Enlace {
  id: string
  tipo: TipoEnlace
  url: string
  titulo: string
  datos: Record<string, unknown>
}

export interface Fechas {
  inicio: string | null
  vence: string | null
  conHora: boolean
  completada: string | null
}

export interface TarjetaResumen {
  id: string
  clave: string
  numero: number
  proyectoId: string
  tableroId: string
  listaId: string | null
  orden: string
  padreId: string | null
  tipo: TipoTarjeta
  titulo: string
  prioridad: Prioridad
  estimacion: number | null
  etiquetas: string[]
  responsables: string[]
  fechas: Fechas
  portada: Portada | null
  contadores: {
    comentarios: number
    adjuntos: number
    checklistHechos: number
    checklistTotal: number
    vinculos: number
    bloqueadaPor: number
    hijas: number
  }
  enlaces: Enlace[]
  porque: { estado: EstadoPorque; motivo: string } | null
  tieneDescripcion: boolean
  discord: boolean
  archivada: boolean
  version: number
  creadaEn: string
  actualizadaEn: string
  origen: Actor | null
}

export interface OpcionPorque {
  titulo: string
  pros?: string
  contras?: string
  elegida?: boolean
  descartadaPorque?: string
}

export interface Porque {
  motivo: string
  contexto: string
  opciones: OpcionPorque[]
  decision: string
  consecuencias: string
  estado: EstadoPorque
  evidencias: string[]
  decidieron: string[]
  decididaEn: string | null
  revisarEn: string | null
  reemplazadaPor: string | null
  actualizadoEn: string
}

export interface ChecklistItem {
  id: string
  texto: string
  hecho: boolean
  responsableId: string | null
  vence: string | null
  orden: string
}

export interface Checklist {
  id: string
  titulo: string
  orden: string
  ocultarHechos: boolean
  items: ChecklistItem[]
}

export interface Adjunto {
  id: string
  nombre: string
  url: string
  mime: string | null
  tamano: number | null
  descripcion: string
  esImagen: boolean
  creadoPor: Actor | null
  creadoEn: string
}

export interface Comentario {
  id: string
  tarjetaId: string
  autor: Actor
  cuerpo: string
  creadoEn: string
  editadoEn: string | null
  /** El comentario al que responde (un hilo chato). */
  respuestaA?: string | null
  /** El trabajo de un agente que lo escribió (la respuesta a una mención). */
  trabajoId?: string | null
}

export interface VinculoVista {
  id: string
  tipo: TipoVinculo
  /** 'ida' si esta tarjeta es el origen; 'vuelta' si es el destino. */
  direccion: 'ida' | 'vuelta'
  /** Texto legible desde esta tarjeta: "bloquea", "depende de", "duplica", "es duplicada por"… */
  texto: string
  nota: string
  otra: {
    id: string
    clave: string
    titulo: string
    tipo: TipoTarjeta
    listaNombre: string | null
    categoria: Categoria | null
    archivada: boolean
  }
}

export interface CitaDiscord {
  autor: string
  canal: string | null
  fecha: string | null
  texto: string
}

export interface DatosDiscord {
  id: string
  canal: string
  autores: string[]
  fechas: string[]
  citas: CitaDiscord[]
  respuestaSugerida: string
  tipoOriginal: string
  area: string
  estadoOriginal: string
  evidencia: string
}

export interface Actividad {
  id: string
  proyectoId: string | null
  tableroId: string | null
  tarjetaId: string | null
  tarjetaClave: string | null
  actor: Actor
  accion: string
  resumen: string
  detalle: Record<string, unknown> | null
  creadoEn: string
}

export interface TarjetaDetalle extends TarjetaResumen {
  descripcion: string
  campos: Record<string, unknown>
  porqueCompleto: Porque | null
  checklists: Checklist[]
  adjuntos: Adjunto[]
  comentarios: Comentario[]
  vinculos: VinculoVista[]
  actividad: Actividad[]
  discordDatos: DatosDiscord | null
  listaNombre: string | null
  categoria: Categoria | null
  padre: { id: string; clave: string; titulo: string; tipo: TipoTarjeta } | null
  hijas: { id: string; clave: string; titulo: string; tipo: TipoTarjeta; categoria: Categoria | null }[]
  repoGithub: string | null
  enLienzo: string[]
}

export interface ElementoLienzo {
  id: string
  tableroId: string
  tipo: TipoElemento
  x: number
  y: number
  ancho: number
  alto: number
  z: number
  tarjetaId: string | null
  listaId: string | null
  datos: Record<string, unknown>
  bloqueado: boolean
  actualizadoEn: string
  /** Quién lo creó (una persona, una IA por MCP o el sistema). */
  creadoPor: Actor | null
}

export interface Conector {
  id: string
  tableroId: string
  desdeId: string
  desdeLado: Lado | null
  hastaId: string
  hastaLado: Lado | null
  trazo: Trazo
  puntaInicio: Punta
  puntaFin: Punta
  guion: Guion
  color: Color | null
  grosor: number
  etiqueta: string
}

export interface TableroCompleto {
  proyecto: Omit<Proyecto, 'tableros'>
  tablero: TableroResumen
  listas: Lista[]
  tarjetas: TarjetaResumen[]
  etiquetas: Etiqueta[]
  miembros: Miembro[]
  elementos: ElementoLienzo[]
  conectores: Conector[]
}

export interface ResultadoBusqueda {
  tarjeta: TarjetaResumen
  tableroNombre: string
  listaNombre: string | null
  fragmento: string
}

/** Evento en vivo (SSE) que manda el servidor cada vez que algo cambia. */
export interface Evento {
  id: string
  tipo:
    | 'tarjeta'
    | 'tarjeta.detalle'
    | 'lista'
    | 'elemento'
    | 'conector'
    /** Varios objetos y conectores de una vez (armar_en_lienzo): `accion: 'lote'`, `datos: { elementos, conectores }`. */
    | 'lienzo'
    | 'etiqueta'
    | 'proyecto'
    | 'tablero'
    | 'miembro'
    | 'actividad'
    | 'diseno'
    /** Avance de un trabajo de un agente de la IA integrada. */
    | 'trabajo'
    /** Una notificación nueva para un miembro. */
    | 'notificacion'
  accion: string
  proyectoId?: string | null
  tableroId?: string | null
  tarjetaId?: string | null
  actor: Actor
  clienteId?: string | null
  resumen?: string
  datos?: unknown
  en: string
}

export interface InfoConexion {
  version: string
  puerto: number
  urlMcp: string
  clave: string
  rutaTablero: string
  baseDeDatos: 'pglite' | 'postgres'
  rutaDatos: string
}
