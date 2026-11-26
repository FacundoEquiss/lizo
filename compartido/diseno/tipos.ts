// Telar · Diseño: tipos que comparten el servidor, la web, el MCP y el importador (docs/plan-diseno.md, sección 3).
// Nada dice "Restaurant City": RC es un perfil de importación más.
import type { Actor } from '../tipos'

export type Origen = 'propio' | 'importado'
export type TipoPagina = 'lienzo' | 'sistema' | 'tabla'
export type TipoItem = 'token' | 'estilo_texto' | 'color_suelto' | 'activo' | 'fuente' | 'hoja' | 'pieza' | 'texto' | 'plantilla'
export const TIPOS_ITEM: TipoItem[] = ['token', 'estilo_texto', 'color_suelto', 'activo', 'fuente', 'hoja', 'pieza', 'texto', 'plantilla']

/** Dónde aparece algo en el código de origen. */
export interface Uso {
  archivo: string
  linea: number
  selector?: string
  propiedad?: string
}

export type ClaseToken = 'color' | 'numero' | 'medida' | 'texto' | 'sombra' | 'curva' | 'duracion' | 'fuente' | 'radio' | 'peso' | 'animacion'

export interface DatosToken {
  clase: ClaseToken
  /** Variable que emite: "--color-marca-primario" (importado: la original, "--rc-azul"; sin nombre: vacío). */
  css: string
  /** "#38bde6", "12px", "0 2px 0 #0b7894" */
  valor: string
  /** { oscuro: "#8fe3fb" } */
  modos?: Record<string, string>
  /** Clave de otro token. */
  alias?: string
  /** Importado: selector donde se declara (".rcui"). */
  alcance?: string
  /** Importado: puede estar declarado en más de una hoja (y con valores distintos). */
  declaradoEn?: (Uso & { valor?: string })[]
  usos?: Uso[]
  veces?: number
  /** Importado sin nombre (un tamaño de letra, un radio…): true. */
  suelto?: boolean
  /** Equivalencia en la unidad del proyecto ("19 hu"). */
  unidad?: string
  uso?: string
}

export interface DatosEstiloTexto {
  clase: string
  familia: string
  peso: number
  tamano: string
  interlineado: string
  espaciado?: string
  mayusculas?: boolean
  color?: string
  contorno?: { color: string; grosor: string }
  veces?: number
  usos?: Uso[]
}

export interface DatosColorSuelto {
  valor: string
  rgb: [number, number, number, number]
  veces: number
  usos: Uso[]
  /** Clave del token con el mismo valor. */
  igualA?: string
  /** Clave de otro color a menos de ΔE 2. */
  cercaDe?: string
  familia?: string
}

export interface DatosActivo {
  ruta: string
  mime: string
  ancho: number
  alto: number
  peso: number
  nota?: string
  origen?: string
  escala?: number
  usos?: Uso[]
  archivo?: string
}

export interface DatosFuente {
  familia: string
  ruta: string
  pesos: string
  estilo?: string
  licencia?: string
  archivo?: string
}

/** Importada: ruta (y rutaEstados); propia: css. */
export interface DatosHoja {
  ruta?: string
  rutaEstados?: string
  css?: string
  reglas: number
  peso: number
  archivo?: string
}

export type ClasePropPieza = 'variante' | 'texto' | 'booleano' | 'imagen'
export interface PropPieza {
  nombre: string
  clase: ClasePropPieza
  valores?: string[]
  defecto: string | boolean
}

export interface DatosPieza {
  html?: string
  variantes?: Record<string, string>
  css: string
  hojas: string[]
  propiedades: PropPieza[]
  ancho?: number
  alto?: number
  raizClase?: string
  /** Variables de escala que necesita (RC: { "--nv": "1.6px" }). */
  escala?: Record<string, string>
  /** Estados que se muestran en su hoja de variantes. */
  estados?: string[]
  descripcion?: string
}

export interface DatosTexto {
  valor: string
  plantilla?: boolean
  claveOriginal?: string
  grupo?: string
  archivo?: string
  linea?: number
  usos?: Uso[]
}

export interface DatosPlantilla {
  html: string
  css: string
  hojas: string[]
  ancho: number
  alto: number
  ranuras: { nombre: string; clase: 'texto' | 'imagen' }[]
  descripcion?: string
}

export interface MapaDatosItem {
  token: DatosToken
  estilo_texto: DatosEstiloTexto
  color_suelto: DatosColorSuelto
  activo: DatosActivo
  fuente: DatosFuente
  hoja: DatosHoja
  pieza: DatosPieza
  texto: DatosTexto
  plantilla: DatosPlantilla
}

export interface NotaDiseno {
  objetivo: string
  nombrePropio: string | null
  uso: string | null
  nota: string | null
  estado: 'vigente' | 'revisar' | 'viejo' | null
  actualizadoPor: Actor | null
  actualizadoEn: string
}

export interface ItemDiseno<T extends TipoItem = TipoItem> {
  tipo: T
  clave: string
  nombre: string
  grupo: string
  datos: MapaDatosItem[T]
  origen: Origen
  hash: string | null
  importacion: number | null
  orden: string
  archivado: boolean
  actualizadoEn: string
  nota?: NotaDiseno | null
  /** Llegó o cambió en la última sincronización (hace menos de 7 días). */
  nuevo?: boolean
}

export interface PaginaDiseno {
  id: string
  proyectoId: string
  nombre: string
  slug: string
  tipo: TipoPagina
  origen: Origen
  datos: { tipos?: TipoItem[]; secciones?: string[]; fondo?: string; vacia?: string }
  orden: string
  archivada: boolean
  marcos: number
}

/** Rectángulo de una capa dentro del marco: x, y, ancho, alto (px del marco). */
export type Caja = [number, number, number, number]

export interface DatosMarco {
  fondo?: string
  modo?: string
  prefijado?: string
  plantilla?: string
  estado?: string
  /** Vista de una pantalla importada ("celular", "pc"). */
  vista?: string
  /** Variables de escala para la raíz ({ "--nv": "1.6px" }). */
  escala?: Record<string, string>
  /** Clase que necesita <body> para que apliquen las hojas ("rcui"). */
  raizClase?: string
  /** Clases y estilos en línea de <html> y <body> en la página original (zonas seguras, escala). */
  estiloRaiz?: { html?: { clase?: string; estilo?: string }; body?: { clase?: string; estilo?: string } }
  /** Cajas del último dibujo, por data-id. */
  cajas?: Record<string, Caja>
  cajasRev?: number
  avisos?: string[]
  miniaturaRev?: number
  /** Hoja de variantes: clave de la pieza. */
  pieza?: string
  /** Pantalla importada: clave sin la vista, para "Ver en PC / en celular". */
  par?: string
  /** Lo que no se pudo sacar al importar. */
  nota?: string
  /** Copia editable o variante: de qué marco salió. */
  copiaDe?: string
  /** Importado: con qué importación llegó o cambió. */
  importacion?: number
}

export interface MarcoResumen {
  id: string
  proyectoId: string
  paginaId: string
  nombre: string
  seccion: string
  grupo: string | null
  x: number
  y: number
  ancho: number
  alto: number
  datos: Omit<DatosMarco, 'cajas'>
  origen: Origen
  clave: string | null
  hash: string | null
  miniatura: string | null
  revision: number
  bloqueado: boolean
  archivado: boolean
  creadoPor: Actor | null
  creadoEn: string
  actualizadoEn: string
  hojas: string[]
  /** Claves de las tarjetas vinculadas. */
  tarjetas: string[]
  comentarios: number
  nuevo?: boolean
}

export interface Marco extends Omit<MarcoResumen, 'datos'> {
  html: string
  css: string
  datos: DatosMarco
}

/** Lo que necesita el armador de documentos para dibujar un marco. */
export interface MarcoParaDibujar {
  marco: Marco
  hojas: { clave: string; url?: string; urlEstados?: string; css?: string }[]
  cssTokens: string
  piezas: Record<string, DatosPieza>
}

export interface ComentarioDiseno {
  id: string
  objetivo: string
  x: number | null
  y: number | null
  texto: string
  respuestaA: string | null
  resuelto: boolean
  autor: Actor
  creadoEn: string
}

export interface CambioImportacion {
  tipo: string
  clave: string
  que: 'nuevo' | 'cambio' | 'quitado'
  nombre?: string
}

export interface ImportacionDiseno {
  n: number
  estado: 'subiendo' | 'lista' | 'descartada'
  origen: OrigenImportacion
  cambios: CambioImportacion[]
  resumen: Record<string, number>
  actor: Actor | null
  creadoEn: string
}

export interface OrigenImportacion {
  repo?: string
  rama?: string
  commit?: string
  url?: string
  perfil?: string
  conPaginas?: boolean
  informe?: string[]
}

export interface ResumenDiseno {
  proyecto: { id: string; prefijo: string; nombre: string; color: string; tablero: string | null }
  paginas: PaginaDiseno[]
  conteo: Partial<Record<TipoItem, number>>
  sincronizacion: {
    importacion: number
    importadoEn: string | null
    origen: OrigenImportacion | null
    pedidoEn: string | null
    tienePerfil: boolean
    ultima: ImportacionDiseno | null
  }
  /** Ítems con unidades del perfil, para la regla ("10 px · 10 hu"). */
  unidades: Record<string, string>
  vistas: Record<string, { ancho: number; alto: number; densidad?: number; tactil?: boolean }>
}

/** Evento en vivo de Diseño (tipo 'diseno' en compartido/tipos.ts). */
export interface DatosEventoDiseno {
  accion: 'marco' | 'item' | 'pagina' | 'comentario' | 'importacion' | 'nota' | 'vinculo' | 'config'
  paginaId?: string | null
  marcos?: string[]
  items?: { tipo: TipoItem; clave: string }[]
}

export const AVISOS_TIPO = ['fuera', 'cortado', 'imagen', 'fuente', 'chico'] as const
