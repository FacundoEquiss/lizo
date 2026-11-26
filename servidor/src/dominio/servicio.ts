// Lógica del tablero. Todo lo que cambia algo pasa por acá: valida, guarda,
// anota la actividad (con su autor: persona, IA o importador) y publica el
// evento en vivo. La API web, el MCP y los importadores usan esta misma capa.
//
// Cuentas (docs/cuentas.md): un Servicio es SIEMPRE el de una cuenta (`servicio.de(cuenta)`). El de la raíz no tiene cuenta y
// cualquier consulta con dueño falla (`this.cuenta` tira error): no hay forma de leer o escribir sin alcance. Todo método que
// recibe un id lo verifica antes de leer o escribir (`propio`/`propios`, o un resolutor que filtra por propietario en SQL), y
// lo de otra cuenta da 404 con el mismo mensaje que lo que no existe. El bus y el almacén del Servicio también son los de la
// cuenta: los eventos salen marcados con ella y los archivos van a su carpeta.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { customAlphabet } from 'nanoid'
import { nombrePrioridad, nombreTipo, textoVinculo } from '../../../compartido/constantes'
import { analizarEnlace } from '../../../compartido/enlaces'
import {
  leerGrafico,
  problemaEnGrafico,
  resolverGrafico,
  fuenteSugerida,
  type Agrupar,
  type DatosGrafico,
  type GraficoResuelto,
  type TipoGrafico,
} from '../../../compartido/grafico'
import {
  aplicarOperaciones,
  armarTabla,
  columnaDe,
  ErrorTabla,
  esNumerica,
  leerTabla,
  medidaTabla,
  type DatosTabla,
  type EntradaColumna,
  type EntradaFila,
  type OperacionTabla,
} from '../../../compartido/tabla'
import { filtrarTarjetas, analizarConsulta } from '../../../compartido/filtro'
import { leerDiasArchivoHecho, type DiasArchivoHecho } from '../../../compartido/hecho'
import { iniciales, normalizar, recortar, sinMarkdown, slug } from '../../../compartido/texto'
import {
  frasePorVistas,
  mensajeSinVista,
  NOMBRE_VISTA,
  ordenarVistas,
  problemaEnVistas,
  TEXTO_TIPO,
  tipoDeVistas,
  TIPO_DE_FABRICA,
  TIPOS_TABLERO,
  VISTAS_DEL_TIPO,
  type TipoTablero,
  type VistaTablero,
} from '../../../compartido/vistas'
import { almacenDe, CUENTA_DUENO, type Almacen } from '../datos/almacen'
import type {
  Actividad,
  Actor,
  Categoria,
  Color,
  Comentario,
  Conector,
  DatosDiscord,
  ElementoLienzo,
  Etiqueta,
  Guion,
  Lado,
  Lista,
  Miembro,
  OpcionPorque,
  Portada,
  Prioridad,
  Proyecto,
  Punta,
  ResultadoBusqueda,
  TableroCompleto,
  TableroResumen,
  TarjetaDetalle,
  TarjetaResumen,
  TipoElemento,
  TipoTarjeta,
  TipoVinculo,
  Trazo,
} from '../../../compartido/tipos'
import type { Conexion } from '../datos/conexion'
import type { BusEventos } from '../eventos'
import {
  aActividad,
  aAdjunto,
  aChecklist,
  aComentario,
  aConector,
  aElemento,
  aEtiqueta,
  aItem,
  aLista,
  aMiembro,
  aPorque,
  aProyecto,
  aTablero,
  aTarjetaResumen,
  ajustesDeFila,
  iso,
  vistasDeFila,
} from './filas'
import { buscarLugar, contenidoDe as contenidoDeMarco, interiorMarco, limites, marcoDe, TAMANOS, type Rect } from './lienzo'
import { disponer, disponerFlujo, medidaTexto, type Disposicion } from './disposicion'
import {
  ANCHO_MAX_TARJETA,
  ANCHO_TARJETA,
  ESTILOS_FABRICA,
  MAX_CONECTORES_ARMAR,
  MAX_OBJETOS_ARMAR,
  leerForma,
  leerNota,
  leerTexto,
  pesoPorTamano,
  problemaEnDatos,
  type RellenoMarco,
} from '../../../compartido/lienzo'
import { esDocRico, textoPlano } from '../../../compartido/rico'
import { docDesdeMarkdown } from '../../../compartido/rico-markdown'
import type { Mencion, OrigenMencion, TrabajoResumen } from '../../../compartido/ia'
import { aliasValido, ALIAS_RESERVADOS, extraerMenciones, normalizarAlias } from '../../../compartido/menciones'
import type { GanchosServicio, ResultadoMenciones, TextoGuardado } from './ganchos'
import { sinTanda, tandaActual } from './tanda'

/**
 * Normaliza los datos de un objeto del lienzo antes de guardarlos: valida los estilos (un cliente no guarda basura) y
 * mantiene juntos el texto enriquecido y el plano. Si llega `rico`, el texto plano se recalcula de él; si llega solo
 * `texto` (un cliente viejo, el MCP), manda el texto y `rico` se borra para no dejar dos versiones distintas.
 */
function normalizarDatos(datos: Record<string, unknown> | undefined, op: { cambio?: boolean } = {}): Record<string, unknown> | undefined {
  if (!datos) return datos
  const problema = problemaEnDatos(datos)
  if (problema) throw new ErrorDominio(`Dato inválido: ${problema}`)
  const d = { ...datos }
  if (d.rico !== undefined && d.rico !== null) {
    if (!esDocRico(d.rico)) throw new ErrorDominio('rico tiene que ser un documento de TipTap ({ "type": "doc", "content": [...] }) o null.')
    d.texto = textoPlano(d.rico)
  } else if (op.cambio && d.texto !== undefined && d.rico === undefined) d.rico = null
  return d
}

/** Lo que se puede pedir de un gráfico (al crearlo o cambiarlo). `tabla` y `datos` no van juntos. */
export interface CambiosGrafico {
  tipo?: TipoGrafico
  titulo?: string
  /** Una tabla del lienzo: su id o su título. */
  tabla?: string
  /** Columna de categorías (nombre o id). */
  categoria?: string
  /** Columnas numéricas (nombres o ids). */
  series?: string[]
  agrupar?: Agrupar
  datos?: { categorias: string[]; series: { nombre: string; valores: (number | null)[]; color?: Color }[] }
  apilado?: boolean
  leyenda?: 'auto' | 'si' | 'no'
  valores?: boolean
  colores?: Color[]
}

/** Un objeto nuevo del lienzo como lo pide el MCP: el texto en Markdown y el estilo con las claves de `datos`. */
export interface NuevoObjetoLienzo {
  tipo: TipoElemento
  /** Markdown (salvo `markdown: false`). */
  texto?: string
  markdown?: boolean
  titulo?: string
  tarjeta?: string
  lista?: string
  url?: string
  ancho?: number
  alto?: number
  bloqueado?: boolean
  /** fuente, tamano, alineacion, alineacionV, interlineado, colorTexto, fondo, color, forma, relleno, tono, borde,
   *  bordeGrosor, bordeEstilo, opacidad, variante: lo que corresponda al tipo. */
  estilo?: Record<string, unknown>
}

interface ObjetoArmado {
  datos: Record<string, unknown>
  ancho: number
  alto: number
  tarjetaId: string | null
  listaId: string | null
  /** La tarjeta ya estaba en el lienzo: no se crea otra. */
  existente?: ElementoLienzo
}

export interface EstiloConectorEntrada {
  trazo?: Trazo
  puntaInicio?: Punta
  puntaFin?: Punta
  guion?: Guion
  color?: Color | null
  grosor?: number
  /** De qué lado del objeto sale / entra la flecha; null (o sin decir) lo elige Telar según dónde está el otro objeto. */
  desdeLado?: Lado | null
  hastaLado?: Lado | null
}

/** "una nota", "un marco"… para los mensajes. */
export function articuloTipo(t: TipoElemento): string {
  const n: Record<TipoElemento, string> = {
    nota: 'una nota',
    texto: 'un texto',
    forma: 'una forma',
    marco: 'un marco',
    tarjeta: 'una tarjeta',
    lista: 'una lista',
    imagen: 'una imagen',
    enlace: 'un link',
    figma: 'un diseño de Figma',
    tabla: 'una tabla',
    grafico: 'un gráfico',
  }
  return n[t] ?? 'un objeto'
}

export const nuevoId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 14)

export class ErrorDominio extends Error {
  constructor(
    mensaje: string,
    readonly estado = 400,
  ) {
    super(mensaje)
  }
}

/** Quién pide el cambio y desde qué pestaña (para no rebotarle sus propios eventos). */
export interface Ctx {
  actor: Actor
  clienteId?: string | null
  /**
   * Cómo llegó el pedido (lo pone el alcance de api.ts). Solo `sesion` y `local` son «lo escribió una persona»: con la clave
   * del MCP por /api el actor figura como el dueño, pero no es él (docs/plan-ia-integrada.md, 5.6). Opcional: lo que no lo
   * mira no cambia. Las herramientas del MCP no lo ponen: su actor ya es una IA.
   */
  via?: 'local' | 'sesion' | 'clave' | 'oauth' | 'ia'
}

const TIPOS: TipoTarjeta[] = ['epica', 'historia', 'tarea', 'error', 'idea', 'pregunta', 'decision']
const PRIORIDADES: Prioridad[] = ['urgente', 'alta', 'media', 'baja', 'ninguna']

export interface NuevaTarjeta {
  tableroId: string
  listaId?: string | null
  titulo: string
  tipo?: TipoTarjeta
  descripcion?: string
  prioridad?: Prioridad
  estimacion?: number | null
  etiquetas?: string[] // ids o nombres (los nombres que no existen se crean)
  responsables?: string[] // ids o nombres
  inicio?: string | null
  vence?: string | null
  conHora?: boolean
  padre?: string | null
  posicion?: 'arriba' | 'abajo' | number
  portada?: Portada | null
  campos?: Record<string, unknown>
  refExterna?: string | null
  porque?: Partial<PorqueEntrada>
  enlaces?: string[]
  checklist?: { titulo?: string; items: string[] }
}

export interface CambiosTarjeta {
  titulo?: string
  descripcion?: string
  tipo?: TipoTarjeta
  prioridad?: Prioridad
  estimacion?: number | null
  etiquetas?: string[]
  agregarEtiquetas?: string[]
  quitarEtiquetas?: string[]
  responsables?: string[]
  agregarResponsables?: string[]
  quitarResponsables?: string[]
  inicio?: string | null
  vence?: string | null
  conHora?: boolean
  completada?: boolean
  portada?: Portada | null
  padre?: string | null
  campos?: Record<string, unknown>
  version?: number
}

export interface PorqueEntrada {
  motivo: string
  contexto: string
  opciones: OpcionPorque[]
  decision: string
  consecuencias: string
  estado: 'abierta' | 'propuesta' | 'aceptada' | 'rechazada' | 'reemplazada'
  evidencias: string[]
  decidieron: string[]
  decididaEn: string | null
  revisarEn: string | null
  reemplazadaPor: string | null
}

// Resumen de tarjeta con todos sus contadores, en una consulta.
const SQL_RESUMEN = `
  select t.*,
    coalesce((select array_agg(te.etiqueta_id order by e.orden) from tarjeta_etiquetas te
              join etiquetas e on e.id = te.etiqueta_id where te.tarjeta_id = t.id), '{}') as etiquetas,
    coalesce((select array_agg(tr.miembro_id) from tarjeta_responsables tr where tr.tarjeta_id = t.id), '{}') as responsables,
    (select count(*) from comentarios c where c.tarjeta_id = t.id)::int as n_comentarios,
    (select count(*) from adjuntos a where a.tarjeta_id = t.id)::int as n_adjuntos,
    (select count(*) from checklist_items i join checklists c on c.id = i.checklist_id where c.tarjeta_id = t.id)::int as n_items,
    (select count(*) from checklist_items i join checklists c on c.id = i.checklist_id
       where c.tarjeta_id = t.id and i.hecho)::int as n_items_hechos,
    (select count(*) from vinculos v where v.origen_id = t.id or v.destino_id = t.id)::int as n_vinculos,
    (select count(*) from vinculos v join tarjetas o on o.id = v.origen_id
       left join listas lo on lo.id = o.lista_id
       where v.destino_id = t.id and v.tipo = 'bloquea' and not o.archivada
         and coalesce(lo.categoria, '') <> 'hecho')::int as n_bloqueos,
    (select count(*) from tarjetas h where h.padre_id = t.id and not h.archivada)::int as n_hijas,
    (select coalesce(json_agg(json_build_object('id', e.id, 'tipo', e.tipo, 'url', e.url, 'titulo', e.titulo, 'datos', e.datos)
       order by e.creado_en), '[]'::json) from enlaces e where e.tarjeta_id = t.id) as enlaces_json,
    p.estado as porque_estado, p.motivo as porque_motivo
  from tarjetas t
  left join porques p on p.tarjeta_id = t.id`

type Fila = Record<string, any>

function fechaEntrada(v: string | null | undefined): string | null {
  if (v == null || v === '') return null
  // "2026-12-01" (sin hora) → mediodía local, para que no cambie de día por la zona horaria.
  const solo = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v
  const d = new Date(solo)
  if (Number.isNaN(d.getTime())) throw new ErrorDominio(`No entiendo la fecha «${v}». Usá AAAA-MM-DD o ISO 8601.`)
  return d.toISOString()
}

function claveEntre(antes: string | null, despues: string | null): string {
  if (antes && despues && antes >= despues) return generateKeyBetween(antes, null)
  return generateKeyBetween(antes, despues)
}

function fraseDeLista(nombre: string | null | undefined) {
  return nombre ? `«${nombre}»` : 'ninguna lista'
}

/** Las cosas con dueño que llegan por id, y cómo se llega a la cuenta dueña (siempre por su proyecto, salvo los miembros). */
export type TipoPropio =
  | 'proyecto'
  | 'tablero'
  | 'lista'
  | 'tarjeta'
  | 'etiqueta'
  | 'comentario'
  | 'checklist'
  | 'item'
  | 'adjunto'
  | 'enlace'
  | 'vinculo'
  | 'elemento'
  | 'conector'
  | 'miembro'

const CAMINO_PROPIO: Record<TipoPropio, string> = {
  proyecto: `proyectos x where x.propietario = $2`,
  tablero: `tableros x join proyectos p on p.id = x.proyecto_id where p.propietario = $2`,
  lista: `listas x join tableros t on t.id = x.tablero_id join proyectos p on p.id = t.proyecto_id where p.propietario = $2`,
  tarjeta: `tarjetas x join proyectos p on p.id = x.proyecto_id where p.propietario = $2`,
  etiqueta: `etiquetas x join proyectos p on p.id = x.proyecto_id where p.propietario = $2`,
  comentario: `comentarios x join tarjetas t on t.id = x.tarjeta_id join proyectos p on p.id = t.proyecto_id where p.propietario = $2`,
  checklist: `checklists x join tarjetas t on t.id = x.tarjeta_id join proyectos p on p.id = t.proyecto_id where p.propietario = $2`,
  item: `checklist_items x join checklists c on c.id = x.checklist_id join tarjetas t on t.id = c.tarjeta_id
         join proyectos p on p.id = t.proyecto_id where p.propietario = $2`,
  adjunto: `adjuntos x join tarjetas t on t.id = x.tarjeta_id join proyectos p on p.id = t.proyecto_id where p.propietario = $2`,
  enlace: `enlaces x join tarjetas t on t.id = x.tarjeta_id join proyectos p on p.id = t.proyecto_id where p.propietario = $2`,
  vinculo: `vinculos x join tarjetas t on t.id = x.origen_id join proyectos p on p.id = t.proyecto_id where p.propietario = $2`,
  elemento: `elementos_lienzo x join tableros t on t.id = x.tablero_id join proyectos p on p.id = t.proyecto_id where p.propietario = $2`,
  conector: `conectores x join tableros t on t.id = x.tablero_id join proyectos p on p.id = t.proyecto_id where p.propietario = $2`,
  miembro: `miembros x where x.propietario = $2`,
}

/** El mensaje de lo que no existe (o es de otra cuenta: es el mismo, para no contar que existe). */
const NO_EXISTE: Record<TipoPropio, string> = {
  proyecto: 'No existe ese proyecto.',
  tablero: 'No existe ese tablero.',
  lista: 'No existe esa lista.',
  tarjeta: 'No existe esa tarjeta.',
  etiqueta: 'No existe esa etiqueta.',
  comentario: 'No existe ese comentario.',
  checklist: 'No existe esa checklist.',
  item: 'No existe ese ítem.',
  adjunto: 'No existe ese adjunto.',
  enlace: 'No existe ese enlace.',
  vinculo: 'No existe ese vínculo.',
  elemento: 'Ese objeto no está en el lienzo.',
  conector: 'No existe ese conector.',
  miembro: 'No existe ese miembro.',
}

/** Todo lo que se escribe en un porqué (motivo, contexto, decisión, consecuencias y las opciones): el texto donde se menciona. */
function textoDelPorque(p: Partial<Pick<PorqueEntrada, 'motivo' | 'contexto' | 'decision' | 'consecuencias' | 'opciones'>>): string {
  const opciones = (p.opciones ?? []).flatMap((o) => [o.titulo, o.pros, o.contras, o.descartadaPorque])
  return [p.motivo, p.contexto, p.decision, p.consecuencias, ...opciones].filter(Boolean).join('\n')
}

/** El texto de un objeto del lienzo donde se puede mencionar (nota, texto o forma): `datos.texto` o, si no, el texto plano del rico. */
function textoDeDatos(datos: Record<string, unknown> | null | undefined): string {
  if (!datos) return ''
  if (typeof datos.texto === 'string') return datos.texto
  return esDocRico(datos.rico) ? textoPlano(datos.rico) : ''
}

/** Lo que el gancho devuelve, sin los arreglos vacíos (el comentario no se llena de campos que no dicen nada). */
function limpiarExtra(r: ResultadoMenciones): { menciones?: Mencion[]; trabajos?: TrabajoResumen[]; aviso?: string } {
  return {
    ...(r.menciones.length ? { menciones: r.menciones } : {}),
    ...(r.trabajos.length ? { trabajos: r.trabajos } : {}),
    ...(r.aviso ? { aviso: r.aviso } : {}),
  }
}

/** Topes de una cuenta nueva (la de siempre, 'dueno', no tiene). Ver cuentas.ts. */
const TOPE_PROYECTOS = 20

/** Las listas con las que arranca el Kanban de un tablero nuevo (o el que suma la vista Kanban sin tener listas). */
const LISTAS_DE_FABRICA: { nombre: string; categoria: Categoria | null }[] = [
  { nombre: 'Por hacer', categoria: 'por_hacer' },
  { nombre: 'En curso', categoria: 'en_curso' },
  { nombre: 'Hecho', categoria: 'hecho' },
]
const TOPE_OBJETOS_LIENZO = 100_000

/** Lo que Telar hace por su cuenta (archivar lo viejo de Hecho) lo firma «Telar», un actor del sistema. */
export const ACTOR_TELAR: Actor = { tipo: 'sistema', id: 'telar', nombre: 'Telar' }
/** Cada tablero corre su archivo automático, a lo sumo, una vez por hora. */
const HORA_MS = 60 * 60 * 1000
/** Lo máximo que archiva el archivo automático en una pasada de un tablero (lo que quede se archiva en la próxima). */
const TOPE_ARCHIVO_HECHO = 500

let avisoArchivoPerezoso = false

export interface ResultadoArchivoHecho {
  /** Tableros que se miraron de verdad (los que no estaban en su hora de espera o tienen «nunca» no cuentan). */
  tableros: number
  archivadas: number
  porTablero: { tableroId: string; dias: number; archivadas: number; claves: string[] }[]
}

export class Servicio {
  /** Los Servicios de cada cuenta (se crean una vez por proceso). Solo los tiene el de la raíz. */
  private readonly vistas = new Map<string, Servicio>()

  constructor(
    readonly db: Conexion,
    readonly bus: BusEventos,
    /** Dónde quedan los archivos: una carpeta (local) o la base (online). Ver datos/almacen.ts. */
    readonly almacen: Almacen,
    /** La cuenta de este Servicio; null en el de la raíz (que no consulta nada con dueño). */
    private readonly _cuenta: string | null = null,
    /** Por dónde la IA se entera de lo que se guarda (ganchos.ts). Lo comparten el Servicio raíz y los de cada cuenta. */
    readonly ganchos: GanchosServicio = {},
  ) {}

  /** El Servicio de una cuenta: todo lo que lee y escribe es de ella (su bus, su carpeta de archivos, sus proyectos). */
  de(cuenta: string): Servicio {
    if (this._cuenta) throw new Error('[tablero] Este Servicio ya es de una cuenta.')
    if (!cuenta) throw new Error('[tablero] Falta la cuenta.')
    let s = this.vistas.get(cuenta)
    if (!s) {
      s = new Servicio(this.db, this.bus.de(cuenta), almacenDe(this.almacen, cuenta), cuenta, this.ganchos)
      this.vistas.set(cuenta, s)
    }
    return s
  }

  /** La cuenta de este Servicio. Sin cuenta, error: no hay forma de consultar algo con dueño sin alcance. */
  get cuenta(): string {
    if (!this._cuenta) throw new Error('[tablero] Servicio sin cuenta: usá servicio.de(cuenta).')
    return this._cuenta
  }

  /** ¿Es la cuenta de siempre (sin topes, la única que importa de Discord)? */
  get esDueno(): boolean {
    return this.cuenta === CUENTA_DUENO
  }

  /** Verifica que todos esos ids sean de esta cuenta (si alguno no existe o es de otra, 404 con el mismo mensaje). */
  async propios(tipo: TipoPropio, ids: string[], db: Conexion = this.db): Promise<void> {
    if (ids.some((i) => typeof i !== 'string')) throw new ErrorDominio(NO_EXISTE[tipo], 404)
    const unicos = [...new Set(ids)]
    if (!unicos.length) return
    const [f] = await db.consulta<{ n: number }>(
      `select count(distinct x.id)::int as n from ${CAMINO_PROPIO[tipo]} and x.id = any($1::text[])`,
      [unicos, this.cuenta],
    )
    if (Number(f?.n ?? 0) !== unicos.length) throw new ErrorDominio(NO_EXISTE[tipo], 404)
  }

  /** Verifica que el id sea de esta cuenta (404 si no existe o es de otra). */
  async propio(tipo: TipoPropio, id: string, db: Conexion = this.db): Promise<void> {
    await this.propios(tipo, [id], db)
  }

  /** La fila del tablero si es de esta cuenta (si no, 404). */
  private async tableroPropio(id: string, db: Conexion = this.db): Promise<Fila> {
    const [f] = await db.consulta(
      `select x.* from tableros x join proyectos p on p.id = x.proyecto_id where x.id = $1 and p.propietario = $2`,
      [id, this.cuenta],
    )
    if (!f) throw new ErrorDominio(NO_EXISTE.tablero, 404)
    return f
  }

  /** Corta si una cuenta nueva ya llegó a su tope de objetos de lienzo (cuentan también los sacados: se pueden restaurar). */
  private async topeObjetos(nuevos: number, db: Conexion = this.db) {
    if (this.esDueno || nuevos <= 0) return
    const [f] = await db.consulta<{ n: number }>(
      `select count(*)::int as n from elementos_lienzo e join tableros t on t.id = e.tablero_id join proyectos p on p.id = t.proyecto_id
        where p.propietario = $1`,
      [this.cuenta],
    )
    if (Number(f?.n ?? 0) + nuevos > TOPE_OBJETOS_LIENZO)
      throw new ErrorDominio(
        `Llegaste al tope de ${TOPE_OBJETOS_LIENZO.toLocaleString('es-AR')} objetos de lienzo de tu cuenta (cuentan también los que sacaste, que se pueden restaurar). Armá lo nuevo en menos objetos (una tabla en vez de muchas formas).`,
        413,
      )
  }

  /** Lo que usa la cuenta de sus topes (para Configuración → Cuenta). */
  async uso(): Promise<{ proyectos: number; objetosLienzo: number; archivosBytes: number; topes: { proyectos: number; objetosLienzo: number; archivosMb: number } | null }> {
    const [p] = await this.db.consulta<{ n: number }>(`select count(*)::int as n from proyectos where propietario = $1`, [this.cuenta])
    const [e] = await this.db.consulta<{ n: number }>(
      `select count(*)::int as n from elementos_lienzo e join tableros t on t.id = e.tablero_id join proyectos p on p.id = t.proyecto_id
        where p.propietario = $1`,
      [this.cuenta],
    )
    return {
      proyectos: Number(p?.n ?? 0),
      objetosLienzo: Number(e?.n ?? 0),
      archivosBytes: await this.almacen.usado(''),
      topes: this.esDueno ? null : { proyectos: TOPE_PROYECTOS, objetosLienzo: TOPE_OBJETOS_LIENZO, archivosMb: 200 },
    }
  }

  // ───────────────────────── lectura ─────────────────────────

  async listarProyectos(incluirArchivados = false): Promise<Proyecto[]> {
    const proyectos = await this.db.consulta(
      `select * from proyectos where propietario = $1 ${incluirArchivados ? '' : 'and not archivado'} order by orden collate "C", creado_en`,
      [this.cuenta],
    )
    // Cada tablero trae cuántas tarjetas abiertas tiene (para la barra lateral y el MCP). Con los archivados, también
    // los tableros archivados (de los proyectos activos y de los archivados), para la sección "Archivados".
    const tableros = await this.db.consulta(
      `select t.*, (select count(*)::int from tarjetas x where x.tablero_id = t.id and not x.archivada) as abiertas
         from tableros t join proyectos p on p.id = t.proyecto_id
        where p.propietario = $1 ${incluirArchivados ? '' : 'and not t.archivado'} order by t.orden collate "C", t.creado_en`,
      [this.cuenta],
    )
    return proyectos.map((p) =>
      aProyecto(
        p,
        tableros.filter((t) => t.proyecto_id === p.id).map(aTablero),
      ),
    )
  }

  async listarMiembros(): Promise<Miembro[]> {
    const filas = await this.db.consulta(`select * from miembros where propietario = $1 order by es_yo desc, tipo, nombre`, [this.cuenta])
    return filas.map(aMiembro)
  }

  async listarEtiquetas(proyectoId: string): Promise<Etiqueta[]> {
    await this.propio('proyecto', proyectoId)
    const filas = await this.db.consulta(`select * from etiquetas where proyecto_id = $1 order by orden collate "C"`, [
      proyectoId,
    ])
    return filas.map(aEtiqueta)
  }

  async listarListas(tableroId: string, incluirArchivadas = false): Promise<Lista[]> {
    await this.propio('tablero', tableroId)
    const filas = await this.db.consulta(
      `select * from listas where tablero_id = $1 ${incluirArchivadas ? '' : 'and not archivada'} order by orden collate "C", creado_en`,
      [tableroId],
    )
    return filas.map(aLista)
  }

  /** Resúmenes de tarjetas: SIEMPRE solo las de esta cuenta (el filtro va acá, no en quien llama). */
  async resumenes(donde: string, parametros: unknown[], orden = 't.orden collate "C", t.id'): Promise<TarjetaResumen[]> {
    const n = parametros.length + 1
    const filas = await this.db.consulta(
      `${SQL_RESUMEN} where (${donde}) and t.proyecto_id in (select id from proyectos where propietario = $${n}) order by ${orden}`,
      [...parametros, this.cuenta],
    )
    return filas.map(aTarjetaResumen)
  }

  async resumenTarjeta(id: string): Promise<TarjetaResumen> {
    const [r] = await this.resumenes('t.id = $1', [id])
    if (!r) throw new ErrorDominio('No existe esa tarjeta.', 404)
    return r
  }

  async leerTableroCompleto(tableroId: string): Promise<TableroCompleto> {
    const tf = await this.tableroPropio(tableroId)
    await this.archivoPerezoso(tf)
    const [pf] = await this.db.consulta(`select * from proyectos where id = $1`, [tf.proyecto_id])
    const [listas, etiquetas, miembros, elementosF, conectoresF] = await Promise.all([
      this.listarListas(tableroId),
      this.listarEtiquetas(tf.proyecto_id),
      this.listarMiembros(),
      this.db.consulta(`select * from elementos_lienzo where tablero_id = $1 and eliminado_en is null order by z, creado_en`, [
        tableroId,
      ]),
      this.db.consulta(`select * from conectores where tablero_id = $1 and eliminado_en is null order by creado_en`, [
        tableroId,
      ]),
    ])
    // Tarjetas del tablero sin archivar, más las archivadas que siguen en el lienzo.
    const tarjetas = await this.resumenes(
      `t.tablero_id = $1 and (not t.archivada or t.id in (
         select tarjeta_id from elementos_lienzo where tablero_id = $1 and eliminado_en is null and tarjeta_id is not null))`,
      [tableroId],
    )
    const { tableros: _t, ...proyecto } = aProyecto(pf!)
    return {
      proyecto,
      tablero: { ...aTablero(tf), abiertas: tarjetas.filter((t) => !t.archivada).length },
      listas,
      tarjetas,
      etiquetas,
      miembros,
      elementos: elementosF.map(aElemento),
      conectores: conectoresF.map(aConector),
    }
  }

  async leerTarjeta(ref: string): Promise<TarjetaDetalle> {
    const base = await this.resolverTarjeta(ref)
    const resumen = await this.resumenTarjeta(base.id)
    const [porqueF] = await this.db.consulta(`select * from porques where tarjeta_id = $1`, [base.id])
    const checklistsF = await this.db.consulta(`select * from checklists where tarjeta_id = $1 order by orden collate "C"`, [
      base.id,
    ])
    const itemsF = checklistsF.length
      ? await this.db.consulta(
          `select * from checklist_items where checklist_id = any($1::text[]) order by orden collate "C", creado_en`,
          [checklistsF.map((c) => c.id)],
        )
      : []
    const adjuntosF = await this.db.consulta(`select * from adjuntos where tarjeta_id = $1 order by creado_en`, [base.id])
    const comentariosF = await this.db.consulta(`select * from comentarios where tarjeta_id = $1 order by creado_en`, [
      base.id,
    ])
    const vinculosF = await this.db.consulta(
      `select v.*, o.id as o_id, o.clave as o_clave, o.titulo as o_titulo, o.tipo as o_tipo, o.archivada as o_archivada,
              l.nombre as o_lista, l.categoria as o_categoria
         from vinculos v
         join tarjetas o on o.id = case when v.origen_id = $1 then v.destino_id else v.origen_id end
         left join listas l on l.id = o.lista_id
        where v.origen_id = $1 or v.destino_id = $1
        order by v.creado_en`,
      [base.id],
    )
    const actividadF = await this.db.consulta(
      `select * from actividad where tarjeta_id = $1 order by creado_en desc limit 60`,
      [base.id],
    )
    const [listaF] = base.lista_id ? await this.db.consulta(`select * from listas where id = $1`, [base.lista_id]) : []
    const [padreF] = base.padre_id
      ? await this.db.consulta(`select id, clave, titulo, tipo from tarjetas where id = $1`, [base.padre_id])
      : []
    const hijasF = await this.db.consulta(
      `select t.id, t.clave, t.titulo, t.tipo, l.categoria from tarjetas t left join listas l on l.id = t.lista_id
        where t.padre_id = $1 and not t.archivada order by t.numero`,
      [base.id],
    )
    const [proyectoF] = await this.db.consulta(`select repo_github from proyectos where id = $1`, [base.proyecto_id])
    const enLienzoF = await this.db.consulta(
      `select id from elementos_lienzo where tarjeta_id = $1 and eliminado_en is null`,
      [base.id],
    )
    const campos = (base.campos ?? {}) as Record<string, unknown>
    return {
      ...resumen,
      descripcion: base.descripcion,
      campos,
      porqueCompleto: porqueF ? aPorque(porqueF) : null,
      checklists: checklistsF.map((c) =>
        aChecklist(
          c,
          itemsF.filter((i) => i.checklist_id === c.id).map(aItem),
        ),
      ),
      adjuntos: adjuntosF.map(aAdjunto),
      comentarios: comentariosF.map(aComentario),
      vinculos: vinculosF.map((v) => {
        const direccion = v.origen_id === base.id ? 'ida' : 'vuelta'
        return {
          id: v.id,
          tipo: v.tipo as TipoVinculo,
          direccion,
          texto: textoVinculo(v.tipo, direccion),
          nota: v.nota ?? '',
          otra: {
            id: v.o_id,
            clave: v.o_clave,
            titulo: v.o_titulo,
            tipo: v.o_tipo,
            listaNombre: v.o_lista ?? null,
            categoria: v.o_categoria ?? null,
            archivada: Boolean(v.o_archivada),
          },
        }
      }),
      actividad: actividadF.map(aActividad),
      discordDatos: (campos.discord as DatosDiscord | undefined) ?? null,
      listaNombre: listaF?.nombre ?? null,
      categoria: listaF?.categoria ?? null,
      padre: padreF ? { id: padreF.id, clave: padreF.clave, titulo: padreF.titulo, tipo: padreF.tipo } : null,
      hijas: hijasF.map((h) => ({ id: h.id, clave: h.clave, titulo: h.titulo, tipo: h.tipo, categoria: h.categoria ?? null })),
      repoGithub: proyectoF?.repo_github ?? null,
      enLienzo: enLienzoF.map((e) => e.id),
    }
  }

  async listarActividad(filtro: {
    proyectoId?: string
    tableroId?: string
    tarjetaId?: string
    limite?: number
    soloIA?: boolean
  }): Promise<Actividad[]> {
    // Pedir la actividad de algo de otra cuenta da 404 (no una lista vacía: no se cuenta que existe).
    if (filtro.proyectoId) await this.propio('proyecto', filtro.proyectoId)
    if (filtro.tableroId) await this.propio('tablero', filtro.tableroId)
    if (filtro.tarjetaId) await this.propio('tarjeta', filtro.tarjetaId)
    const condiciones: string[] = ['propietario = $1']
    const params: unknown[] = [this.cuenta]
    if (filtro.proyectoId) {
      params.push(filtro.proyectoId)
      condiciones.push(`proyecto_id = $${params.length}`)
    }
    if (filtro.tableroId) {
      params.push(filtro.tableroId)
      condiciones.push(`tablero_id = $${params.length}`)
    }
    if (filtro.tarjetaId) {
      params.push(filtro.tarjetaId)
      condiciones.push(`tarjeta_id = $${params.length}`)
    }
    if (filtro.soloIA) condiciones.push(`actor->>'tipo' = 'ia'`)
    params.push(Math.min(Math.max(filtro.limite ?? 50, 1), 300))
    const filas = await this.db.consulta(
      `select * from actividad where ${condiciones.join(' and ')}
        order by creado_en desc limit $${params.length}`,
      params,
    )
    return filas.map(aActividad)
  }

  async buscar(
    consulta: string,
    opciones: { proyectoId?: string; tableroId?: string; limite?: number; incluirArchivadas?: boolean } = {},
  ): Promise<ResultadoBusqueda[]> {
    if (opciones.proyectoId) await this.propio('proyecto', opciones.proyectoId)
    if (opciones.tableroId) await this.propio('tablero', opciones.tableroId)
    const terminos = analizarConsulta(consulta)
    const libres = terminos.filter((t) => !t.campo && !t.negado).map((t) => t.valor)
    const condiciones: string[] = []
    const params: unknown[] = []
    if (!opciones.incluirArchivadas && !terminos.some((t) => t.campo === 'estado' && t.valor === 'archivada'))
      condiciones.push('not t.archivada')
    if (opciones.proyectoId) {
      params.push(opciones.proyectoId)
      condiciones.push(`t.proyecto_id = $${params.length}`)
    }
    if (opciones.tableroId) {
      params.push(opciones.tableroId)
      condiciones.push(`t.tablero_id = $${params.length}`)
    }
    for (const palabra of libres) {
      params.push(`%${palabra.replace(/[%_\\]/g, (c) => '\\' + c)}%`)
      condiciones.push(`t.busqueda like $${params.length}`)
    }
    const candidatas = await this.resumenes(
      condiciones.length ? condiciones.join(' and ') : 'true',
      params,
      't.actualizada_en desc',
    )
    if (candidatas.length === 0) return []
    // Contexto para los operadores (listas, etiquetas, miembros de lo que apareció).
    const tablerosIds = [...new Set(candidatas.map((t) => t.tableroId))]
    const proyectosIds = [...new Set(candidatas.map((t) => t.proyectoId))]
    const [listasF, etiquetasF, miembros, tablerosF, textosF] = await Promise.all([
      this.db.consulta(`select * from listas where tablero_id = any($1::text[])`, [tablerosIds]),
      this.db.consulta(`select * from etiquetas where proyecto_id = any($1::text[])`, [proyectosIds]),
      this.listarMiembros(),
      this.db.consulta(`select id, nombre from tableros where id = any($1::text[])`, [tablerosIds]),
      this.db.consulta(`select id, busqueda, descripcion from tarjetas where id = any($1::text[])`, [
        candidatas.map((t) => t.id),
      ]),
    ])
    const textos = new Map(textosF.map((f) => [f.id as string, f]))
    const listas = new Map(listasF.map((f) => [f.id as string, aLista(f)]))
    const filtradas = filtrarTarjetas(candidatas, consulta, {
      listas,
      etiquetas: new Map(etiquetasF.map((f) => [f.id as string, aEtiqueta(f)])),
      miembros: new Map(miembros.map((m) => [m.id, m])),
      textoExtra: (t) => textos.get(t.id)?.busqueda ?? '',
    })
    const nombreTablero = new Map(tablerosF.map((f) => [f.id as string, f.nombre as string]))
    const consultaNorm = normalizar(consulta.trim())
    const puntaje = (t: TarjetaResumen) => {
      let p = 0
      if (normalizar(t.clave) === consultaNorm) p += 100
      const titulo = normalizar(t.titulo)
      for (const l of libres) if (titulo.includes(l)) p += 10
      return p
    }
    filtradas.sort((a, b) => puntaje(b) - puntaje(a))
    return filtradas.slice(0, Math.min(opciones.limite ?? 30, 200)).map((t) => {
      const desc = sinMarkdown(String(textos.get(t.id)?.descripcion ?? ''))
      let fragmento = recortar(desc, 160)
      const primera = libres[0]
      if (primera) {
        const i = normalizar(desc).indexOf(primera)
        if (i > 60) fragmento = '…' + recortar(desc.slice(i - 50), 160)
      }
      return {
        tarjeta: t,
        tableroNombre: nombreTablero.get(t.tableroId) ?? '',
        listaNombre: t.listaId ? listas.get(t.listaId)?.nombre ?? null : null,
        fragmento,
      }
    })
  }

  // ───────────────────────── resolutores (aceptan nombres, claves o ids) ─────────────────────────

  /** Por id, prefijo o nombre. Con `archivados`, también los archivados (para restaurarlos). */
  async resolverProyecto(ref?: string | null, op: { archivados?: boolean } = {}): Promise<Fila> {
    const proyectos = await this.db.consulta(
      `select * from proyectos where propietario = $1 ${op.archivados ? '' : 'and not archivado'} order by archivado, orden collate "C"`,
      [this.cuenta],
    )
    if (!ref) {
      if (proyectos.length === 1) return proyectos[0]!
      if (proyectos.length === 0) throw new ErrorDominio('Todavía no hay proyectos.', 404)
      throw new ErrorDominio(
        `Hay varios proyectos; decime cuál: ${proyectos.map((p) => `${p.prefijo} (${p.nombre})`).join(', ')}.`,
      )
    }
    const r = normalizar(ref.trim())
    const encontrado =
      proyectos.find((p) => p.id === ref) ??
      proyectos.find((p) => normalizar(p.prefijo) === r) ??
      proyectos.find((p) => normalizar(p.nombre) === r) ??
      proyectos.find((p) => normalizar(p.nombre).includes(r))
    if (!encontrado)
      throw new ErrorDominio(
        `No encontré el proyecto «${ref}». Proyectos: ${proyectos.map((p) => `${p.prefijo} (${p.nombre})`).join(', ') || 'ninguno'}.`,
        404,
      )
    return encontrado
  }

  /**
   * Por id, slug o nombre (del proyecto indicado, o de todos). Con `archivados`, también los archivados. Con `vista`, el tablero
   * tiene que tener esa vista (Kanban, Lienzo o Diseño): si se lo nombró y no la tiene, el error dice qué tiene y cómo sumarla; si
   * no se lo nombró, se toma el primero del proyecto que sí la tiene.
   */
  async resolverTablero(ref?: string | null, proyectoRef?: string | null, op: { archivados?: boolean; vista?: VistaTablero } = {}): Promise<Fila> {
    const { vista, ...resto } = op
    if (!vista) return this.buscarTablero(ref, proyectoRef, resto)
    if (!ref) {
      const p = await this.resolverProyecto(proyectoRef, resto)
      const tableros = await this.db.consulta(
        `select * from tableros where proyecto_id = $1 ${resto.archivados ? '' : 'and not archivado'} order by archivado, orden collate "C"`,
        [p.id],
      )
      if (!tableros.length) throw new ErrorDominio(`El proyecto ${p.prefijo} no tiene tableros.`, 404)
      const conVista = tableros.find((t) => vistasDeFila(t).includes(vista))
      if (conVista) return conVista
      throw new ErrorDominio(
        `Ningún tablero de ${p.prefijo} tiene la vista ${NOMBRE_VISTA[vista]}. Creá uno con crear_tablero { "proyecto": "${p.prefijo}", "nombre": "…", "vistas": ["${vista}"] } ` +
          `o sumásela a uno que ya está con actualizar_tablero { "tablero": "${tableros[0]!.nombre}", "vistas": ${JSON.stringify(ordenarVistas([...vistasDeFila(tableros[0]!), vista]))} }.`,
        409,
      )
    }
    const t = await this.buscarTablero(ref, proyectoRef, resto)
    const tiene = vistasDeFila(t)
    if (!tiene.includes(vista)) throw new ErrorDominio(mensajeSinVista(t.nombre, vista, tiene), 409)
    return t
  }

  private async buscarTablero(ref: string | null | undefined, proyectoRef: string | null | undefined, op: { archivados?: boolean }): Promise<Fila> {
    if (ref) {
      const [porId] = await this.db.consulta(
        `select x.* from tableros x join proyectos p on p.id = x.proyecto_id where x.id = $1 and p.propietario = $2`,
        [ref, this.cuenta],
      )
      if (porId) return porId
    }
    const activos = op.archivados ? '' : 'and not archivado'
    let tableros: Fila[]
    if (proyectoRef || !ref) {
      const p = await this.resolverProyecto(proyectoRef, op)
      tableros = await this.db.consulta(
        `select * from tableros where proyecto_id = $1 ${activos} order by archivado, orden collate "C"`,
        [p.id],
      )
      if (!ref) {
        const primero = tableros.find((t) => !t.archivado)
        if (!primero) throw new ErrorDominio(`El proyecto ${p.prefijo} no tiene tableros.`, 404)
        return primero
      }
    } else {
      tableros = await this.db.consulta(
        `select x.* from tableros x join proyectos p on p.id = x.proyecto_id where p.propietario = $1 ${op.archivados ? '' : 'and not x.archivado'}
          order by x.archivado, x.orden collate "C"`,
        [this.cuenta],
      )
    }
    const r = normalizar(ref.trim())
    const candidatos = [
      ...tableros.filter((t) => t.slug === slug(ref) || normalizar(t.nombre) === r),
      ...tableros.filter((t) => normalizar(t.nombre).includes(r)),
    ]
    if (!candidatos[0])
      throw new ErrorDominio(
        `No encontré el tablero «${ref}». Tableros: ${tableros.map((t) => t.nombre).join(', ') || 'ninguno'}.`,
        404,
      )
    return candidatos[0]
  }

  async resolverLista(tableroId: string, ref: string, op: { archivadas?: boolean } = {}): Promise<Fila> {
    await this.propio('tablero', tableroId)
    const listas = await this.db.consulta(
      `select * from listas where tablero_id = $1 ${op.archivadas ? '' : 'and not archivada'} order by archivada, orden collate "C"`,
      [tableroId],
    )
    const r = normalizar(ref.trim())
    const encontrada =
      listas.find((l) => l.id === ref) ??
      listas.find((l) => normalizar(l.nombre) === r) ??
      listas.find((l) => normalizar(l.nombre).startsWith(r)) ??
      listas.find((l) => normalizar(l.nombre).includes(r)) ??
      listas.find((l) => l.categoria && l.categoria === r.replace(/\s+/g, '_'))
    if (!encontrada)
      throw new ErrorDominio(
        `No encontré la lista «${ref}». Listas de este tablero: ${listas.map((l) => l.nombre).join(', ')}.`,
        404,
      )
    return encontrada
  }

  async resolverTarjeta(ref: string, db: Conexion = this.db): Promise<Fila> {
    const limpio = ref.trim().replace(/^#/, '')
    const [f] = await db.consulta(
      `select t.* from tarjetas t join proyectos p on p.id = t.proyecto_id where (t.id = $1 or t.clave = $2) and p.propietario = $3`,
      [limpio, limpio.toUpperCase(), this.cuenta],
    )
    if (!f) throw new ErrorDominio(`No encontré la tarjeta «${ref}». Usá su clave (por ejemplo RC-12).`, 404)
    return f
  }

  // ───────────────────────── ganchos de la IA (ganchos.ts) ─────────────────────────

  /**
   * Le avisa a la IA que se guardaron textos (menciones). Se llama DESPUÉS de confirmar la escritura. Nunca tira: reintenta una
   * vez y, si vuelve a fallar, devuelve un `aviso` (guardar de nuevo corre la regla de la cantidad y crea lo que faltó).
   * Sin ganchos conectados devuelve null y no hace nada.
   */
  private async avisarTextos(ctx: Ctx, textos: TextoGuardado[]): Promise<ResultadoMenciones | null> {
    const gancho = this.ganchos.textoGuardado
    if (!gancho || !textos.length) return null
    for (let intento = 0; intento < 2; intento++) {
      try {
        return await gancho(this, ctx, textos)
      } catch (e) {
        if (intento) console.error('[tablero] no pude procesar las menciones:', e instanceof Error ? e.message : e)
      }
    }
    const alias = textos.flatMap((t) => extraerMenciones(t.texto))[0]?.alias
    return {
      menciones: [],
      trabajos: [],
      aviso: `Se guardó, pero no pude avisarle a ${alias ? `@${alias}` : 'quien mencionaste'}. Editalo y guardalo de nuevo.`,
    }
  }

  /** Le avisa a la IA que una tarjeta entró a una lista (disparador proactivo `tarjeta_nueva`). Nunca tira; sin ganchos no hace nada. */
  private async avisarTarjetaEnLista(ctx: Ctx, tarjetaId: string, listaId: string | null): Promise<void> {
    const gancho = this.ganchos.tarjetaEnLista
    if (!gancho || !listaId) return
    try {
      await gancho(this, ctx, { tarjetaId, listaId })
    } catch (e) {
      console.error('[tablero] no pude avisarle a la IA de la tarjeta nueva:', e instanceof Error ? e.message : e)
    }
  }

  /** Le avisa a la IA que se borraron o sacaron los textos de esos orígenes. Nunca tira. */
  private async avisarBorrados(ctx: Ctx, origenes: { tipo: OrigenMencion; id: string }[]): Promise<void> {
    const gancho = this.ganchos.textoBorrado
    if (!gancho || !origenes.length) return
    try {
      await gancho(this, ctx, origenes)
    } catch (e) {
      console.error('[tablero] no pude retirar las menciones:', e instanceof Error ? e.message : e)
    }
  }

  /** Los textos de objetos del lienzo que se acaban de guardar, listos para el gancho. */
  private textosDeElementos(elementos: ElementoLienzo[], op: { soloConArroba?: boolean } = {}): TextoGuardado[] {
    return elementos
      .map((e) => ({ e, texto: textoDeDatos(e.datos) }))
      .filter(({ texto }) => !op.soloConArroba || texto.includes('@'))
      .map(({ e, texto }) => ({
        origen: { tipo: 'nota' as const, id: e.id },
        texto,
        proyectoId: null,
        tableroId: e.tableroId,
        tarjetaId: null,
        tarjetaClave: null,
        enVivo: true,
      }))
  }

  // ───────────────────────── actividad y eventos ─────────────────────────

  private async registrar(
    db: Conexion,
    ctx: Ctx,
    a: {
      accion: string
      resumen: string
      proyectoId?: string | null
      tableroId?: string | null
      tarjetaId?: string | null
      tarjetaClave?: string | null
      detalle?: Record<string, unknown> | null
    },
  ): Promise<Actividad> {
    const id = nuevoId()
    const [f] = await db.consulta(
      `insert into actividad (id, proyecto_id, tablero_id, tarjeta_id, tarjeta_clave, actor, accion, resumen, detalle, propietario, tanda)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [
        id,
        a.proyectoId ?? null,
        a.tableroId ?? null,
        a.tarjetaId ?? null,
        a.tarjetaClave ?? null,
        ctx.actor,
        a.accion,
        a.resumen,
        a.detalle ?? null,
        this.cuenta,
        // Lo que hace un trabajo de la IA lleva su id (la tanda: dominio/tanda.ts); lo demás, null.
        tandaActual()?.id ?? null,
      ],
    )
    return aActividad(f!)
  }

  private publicarActividad(ctx: Ctx, act: Actividad) {
    this.bus.publicar({
      tipo: 'actividad',
      accion: act.accion,
      proyectoId: act.proyectoId,
      tableroId: act.tableroId,
      tarjetaId: act.tarjetaId,
      actor: ctx.actor,
      clienteId: ctx.clienteId ?? null,
      resumen: act.resumen,
      datos: act,
    })
  }

  /** Publica la tarjeta actualizada (y su actividad) para que la web la redibuje sola. */
  private async emitirTarjeta(ctx: Ctx, id: string, accion: string, act?: Actividad | null) {
    const resumen = await this.resumenTarjeta(id)
    this.bus.publicar({
      tipo: 'tarjeta',
      accion,
      proyectoId: resumen.proyectoId,
      tableroId: resumen.tableroId,
      tarjetaId: id,
      actor: ctx.actor,
      clienteId: ctx.clienteId ?? null,
      resumen: act?.resumen,
      datos: resumen,
    })
    if (act) this.publicarActividad(ctx, act)
    return resumen
  }

  /** Recalcula el texto normalizado con todo lo buscable de la tarjeta. */
  private async refrescarBusqueda(db: Conexion, tarjetaId: string) {
    const [f] = await db.consulta(
      `select t.clave, t.titulo, t.descripcion, t.campos,
              p.motivo, p.contexto, p.decision, p.consecuencias, p.opciones, p.evidencias,
              (select string_agg(e.nombre, ' ') from tarjeta_etiquetas te join etiquetas e on e.id = te.etiqueta_id
                where te.tarjeta_id = t.id) as etiquetas,
              (select string_agg(c.cuerpo, ' ') from comentarios c where c.tarjeta_id = t.id) as comentarios,
              (select string_agg(i.texto, ' ') from checklist_items i join checklists c on c.id = i.checklist_id
                where c.tarjeta_id = t.id) as items,
              (select string_agg(en.url || ' ' || en.titulo, ' ') from enlaces en where en.tarjeta_id = t.id) as enlaces
         from tarjetas t left join porques p on p.tarjeta_id = t.id where t.id = $1`,
      [tarjetaId],
    )
    if (!f) return
    const discord = (f.campos?.discord ?? null) as DatosDiscord | null
    const partes = [
      f.clave,
      f.titulo,
      f.descripcion,
      f.motivo,
      f.contexto,
      f.decision,
      f.consecuencias,
      ...(Array.isArray(f.opciones) ? f.opciones.map((o: OpcionPorque) => `${o.titulo} ${o.pros ?? ''} ${o.contras ?? ''}`) : []),
      ...(Array.isArray(f.evidencias) ? f.evidencias : []),
      f.etiquetas,
      f.comentarios,
      f.items,
      f.enlaces,
      discord ? `${discord.citas.map((c) => `${c.autor} ${c.texto}`).join(' ')} ${discord.respuestaSugerida} ${discord.autores.join(' ')} ${discord.canal} ${discord.evidencia}` : '',
    ]
    await db.consulta(`update tarjetas set busqueda = $2 where id = $1`, [
      tarjetaId,
      normalizar(partes.filter(Boolean).join(' \n ')),
    ])
  }

  private async tocarTarjeta(db: Conexion, tarjetaId: string) {
    await db.consulta(`update tarjetas set actualizada_en = now(), version = version + 1 where id = $1`, [tarjetaId])
  }

  // ───────────────────────── miembros y etiquetas ─────────────────────────

  /** Un alias para mencionar que está libre en esta cuenta: el del nombre y, si choca, con un 2, 3… (plan de la IA, 5.1). */
  async aliasLibre(nombre: string, db: Conexion = this.db): Promise<string> {
    const usados = new Set(
      (await db.consulta<{ alias: string }>(`select alias from miembros where propietario = $1 and alias is not null`, [this.cuenta])).map((f) => f.alias),
    )
    const base = normalizarAlias(nombre)
    if (!usados.has(base)) return base
    for (let n = 2; ; n++) {
      const sufijo = String(n)
      const candidato = base.slice(0, 32 - sufijo.length).replace(/[._-]+$/, '') + sufijo
      if (!usados.has(candidato)) return candidato
    }
  }

  /** Las IA que actúan por MCP aparecen como miembros (se les pueden asignar tarjetas). */
  async asegurarMiembroIA(nombre: string): Promise<Miembro> {
    const [f] = await this.db.consulta(`select * from miembros where tipo = 'ia' and lower(nombre) = lower($1) and propietario = $2`, [
      nombre,
      this.cuenta,
    ])
    if (f) return aMiembro(f)
    const colores: Color[] = ['naranja', 'violeta', 'celeste', 'verde', 'rosa']
    const [n] = await this.db.consulta(
      `insert into miembros (id, nombre, tipo, color, iniciales, propietario, alias) values ($1, $2, 'ia', $3, $4, $5, $6) returning *`,
      [nuevoId(), nombre, colores[nombre.length % colores.length], iniciales(nombre), this.cuenta, await this.aliasLibre(nombre)],
    )
    const m = aMiembro(n!)
    this.bus.publicar({ tipo: 'miembro', accion: 'creado', actor: { tipo: 'sistema', id: 'sistema', nombre: 'Tablero' }, datos: m })
    return m
  }

  async crearMiembro(datos: { nombre: string; tipo?: 'humano' | 'ia'; color?: Color; esYo?: boolean }): Promise<Miembro> {
    const [f] = await this.db.consulta(
      `insert into miembros (id, nombre, tipo, color, iniciales, es_yo, propietario, alias) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [nuevoId(), datos.nombre, datos.tipo ?? 'humano', datos.color ?? 'naranja', iniciales(datos.nombre), datos.esYo ?? false, this.cuenta, await this.aliasLibre(datos.nombre)],
    )
    return aMiembro(f!)
  }

  async actualizarMiembro(ctx: Ctx, id: string, cambios: { nombre?: string; color?: Color; alias?: string }): Promise<Miembro> {
    await this.propio('miembro', id)
    if (cambios.nombre !== undefined && !cambios.nombre.trim()) throw new ErrorDominio('El nombre no puede quedar vacío.')
    if (cambios.nombre && cambios.nombre.trim().length > 40) throw new ErrorDominio('El nombre puede tener hasta 40 caracteres.')
    let alias: string | null = null
    if (cambios.alias !== undefined) {
      alias = cambios.alias.trim().replace(/^@/, '').toLowerCase()
      if (ALIAS_RESERVADOS.includes(alias)) throw new ErrorDominio(`«${alias}» está reservado (${ALIAS_RESERVADOS.join(', ')}): elegí otro alias.`, 409)
      if (!aliasValido(alias))
        throw new ErrorDominio('El alias tiene entre 2 y 32 caracteres (letras sin acento, números, _ . -), empieza con letra o número y no termina en . _ -.')
      const [otro] = await this.db.consulta(`select nombre from miembros where propietario = $1 and alias = $2 and id <> $3`, [this.cuenta, alias, id])
      if (otro) throw new ErrorDominio(`El alias «${alias}» ya lo usa ${otro.nombre}: elegí otro.`, 409)
    }
    const [f] = await this.db.consulta(
      `update miembros set nombre = coalesce($2, nombre), color = coalesce($3, color),
         iniciales = case when $2::text is null then iniciales else $4 end, alias = coalesce($5, alias)
       where id = $1 returning *`,
      [id, cambios.nombre ?? null, cambios.color ?? null, cambios.nombre ? iniciales(cambios.nombre) : null, alias],
    )
    if (!f) throw new ErrorDominio('No existe ese miembro.', 404)
    const m = aMiembro(f)
    // El nombre del perfil es el de la cuenta: van juntos.
    if (m.esYo && cambios.nombre) await this.db.consulta(`update cuentas set nombre = $2 where id = $1`, [this.cuenta, m.nombre])
    this.bus.publicar({ tipo: 'miembro', accion: 'actualizado', actor: ctx.actor, clienteId: ctx.clienteId, datos: m })
    return m
  }

  private async idsDeMiembros(db: Conexion, refs: string[]): Promise<string[]> {
    if (refs.length === 0) return []
    const miembros = (await db.consulta(`select * from miembros where propietario = $1`, [this.cuenta])).map(aMiembro)
    return refs.map((ref) => {
      const r = normalizar(ref.trim().replace(/^@/, ''))
      const m =
        miembros.find((x) => x.id === ref) ??
        (r === 'yo' ? miembros.find((x) => x.esYo) : undefined) ??
        miembros.find((x) => x.alias === r && !x.archivado) ??
        miembros.find((x) => normalizar(x.nombre) === r) ??
        miembros.find((x) => normalizar(x.nombre).startsWith(r))
      if (!m)
        throw new ErrorDominio(
          `No encontré a «${ref}». Miembros: ${miembros.map((x) => x.nombre).join(', ')}.`,
          404,
        )
      return m.id
    })
  }

  /** Acepta ids o nombres; los nombres que no existen se crean como etiquetas nuevas. */
  async asegurarEtiquetas(
    db: Conexion,
    proyectoId: string,
    refs: string[],
    opciones: { color?: Color; grupo?: string | null } = {},
  ): Promise<string[]> {
    await this.propio('proyecto', proyectoId, db)
    const ids: string[] = []
    for (const ref of refs) {
      const limpio = ref.trim().replace(/^#/, '')
      if (!limpio) continue
      const existentes = await db.consulta(`select * from etiquetas where proyecto_id = $1`, [proyectoId])
      const r = normalizar(limpio)
      const e = existentes.find((x) => x.id === limpio) ?? existentes.find((x) => normalizar(x.nombre) === r)
      if (e) {
        ids.push(e.id)
        continue
      }
      const ultimo = existentes.map((x) => x.orden as string).sort().at(-1) ?? null
      const paleta: Color[] = ['azul', 'verde', 'violeta', 'naranja', 'celeste', 'rosa', 'lima', 'amarillo', 'rojo']
      const color = opciones.color ?? paleta[existentes.length % paleta.length]!
      const [n] = await db.consulta(
        `insert into etiquetas (id, proyecto_id, nombre, color, grupo, orden) values ($1, $2, $3, $4, $5, $6) returning *`,
        [nuevoId(), proyectoId, limpio, color, opciones.grupo ?? null, claveEntre(ultimo, null)],
      )
      ids.push(n!.id)
      this.bus.publicar({
        tipo: 'etiqueta',
        accion: 'creada',
        proyectoId,
        actor: { tipo: 'sistema', id: 'sistema', nombre: 'Tablero' },
        datos: aEtiqueta(n!),
      })
    }
    return [...new Set(ids)]
  }

  async crearEtiqueta(ctx: Ctx, datos: { proyectoId: string; nombre: string; color?: Color; grupo?: string | null }) {
    await this.propio('proyecto', datos.proyectoId)
    const [id] = await this.asegurarEtiquetas(this.db, datos.proyectoId, [datos.nombre], {
      color: datos.color,
      grupo: datos.grupo,
    })
    const [f] = await this.db.consulta(`select * from etiquetas where id = $1`, [id])
    return aEtiqueta(f!)
  }

  async actualizarEtiqueta(ctx: Ctx, id: string, cambios: { nombre?: string; color?: Color }) {
    await this.propio('etiqueta', id)
    const [f] = await this.db.consulta(
      `update etiquetas set nombre = coalesce($2, nombre), color = coalesce($3, color) where id = $1 returning *`,
      [id, cambios.nombre?.trim() || null, cambios.color ?? null],
    )
    if (!f) throw new ErrorDominio('No existe esa etiqueta.', 404)
    const e = aEtiqueta(f)
    this.bus.publicar({ tipo: 'etiqueta', accion: 'actualizada', proyectoId: e.proyectoId, actor: ctx.actor, clienteId: ctx.clienteId, datos: e })
    return e
  }

  async eliminarEtiqueta(ctx: Ctx, id: string) {
    await this.propio('etiqueta', id)
    const [f] = await this.db.consulta(`delete from etiquetas where id = $1 returning *`, [id])
    if (!f) throw new ErrorDominio('No existe esa etiqueta.', 404)
    this.bus.publicar({ tipo: 'etiqueta', accion: 'eliminada', proyectoId: f.proyecto_id, actor: ctx.actor, clienteId: ctx.clienteId, datos: { id } })
  }

  // ───────────────────────── proyectos, tableros y listas ─────────────────────────

  async crearProyecto(
    ctx: Ctx,
    datos: {
      nombre: string
      prefijo: string
      color?: Color
      repoGithub?: string | null
      descripcion?: string
      emoji?: string | null
      conTablero?: boolean
      /** Qué tipo es el primer tablero (de fábrica, «tablero»: solo Kanban). */
      tipo?: TipoTablero
    },
  ): Promise<Proyecto> {
    const prefijo = datos.prefijo.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9]{0,9}$/.test(prefijo))
      throw new ErrorDominio('El prefijo va en mayúsculas, empieza con una letra y tiene hasta 10 caracteres (por ejemplo RC).')
    if (!datos.nombre.trim()) throw new ErrorDominio('El proyecto necesita un nombre.')
    if (datos.nombre.trim().length > 60) throw new ErrorDominio('El nombre puede tener hasta 60 caracteres.')
    const repo = datos.repoGithub?.trim() || null
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ErrorDominio('El repo tiene que ser usuario/repo (por ejemplo: facundo/telar).')
    const emoji = datos.emoji?.trim() || null
    if (emoji && [...emoji].length > 8) throw new ErrorDominio('El emoji es uno solo.')
    const [existe] = await this.db.consulta(`select id from proyectos where prefijo = $1 and propietario = $2`, [prefijo, this.cuenta])
    if (existe) throw new ErrorDominio(`Ya hay un proyecto con el prefijo ${prefijo}.`, 409)
    if (!this.esDueno) {
      const [n] = await this.db.consulta<{ n: number }>(`select count(*)::int as n from proyectos where propietario = $1`, [this.cuenta])
      if (Number(n?.n ?? 0) >= TOPE_PROYECTOS)
        throw new ErrorDominio(`Llegaste al tope de ${TOPE_PROYECTOS} proyectos de tu cuenta (cuentan también los archivados). Usá tableros dentro de un proyecto que ya tengas.`, 413)
    }
    const id = nuevoId()
    await this.db.transaccion(async (tx) => {
      const [ultimo] = await tx.consulta<{ orden: string }>(
        `select orden from proyectos where propietario = $1 order by orden collate "C" desc limit 1`,
        [this.cuenta],
      )
      await tx.consulta(
        `insert into proyectos (id, nombre, descripcion, color, prefijo, repo_github, orden, emoji, propietario) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, datos.nombre.trim(), datos.descripcion ?? '', datos.color ?? 'naranja', prefijo, repo, claveEntre(ultimo?.orden ?? null, null), emoji, this.cuenta],
      )
    })
    if (datos.conTablero !== false) {
      const tipo = datos.tipo ?? TIPO_DE_FABRICA
      if (!TIPOS_TABLERO.includes(tipo)) throw new ErrorDominio(`Tipo de tablero desconocido: «${tipo}». Los tipos son: ${TIPOS_TABLERO.join(', ')}.`)
      await this.crearTablero(ctx, {
        proyectoId: id,
        nombre: tipo === 'diagrama' ? 'Diagrama' : tipo === 'diseno' ? 'Diseño' : 'Pendientes',
        tipo,
        // Solo el que tiene Kanban lleva listas (una Bandeja para lo que llega sin ordenar, más las tres de siempre).
        listas: VISTAS_DEL_TIPO[tipo].includes('kanban')
          ? [
              { nombre: 'Bandeja', categoria: null },
              { nombre: 'Por hacer', categoria: 'por_hacer' },
              { nombre: 'En curso', categoria: 'en_curso' },
              { nombre: 'Hecho', categoria: 'hecho' },
            ]
          : undefined,
      })
    }
    const act = await this.registrar(this.db, ctx, {
      accion: 'proyecto.creado',
      resumen: `creó el proyecto «${datos.nombre.trim()}» (${prefijo})`,
      proyectoId: id,
    })
    const proyecto = (await this.listarProyectos()).find((p) => p.id === id)!
    this.bus.publicar({ tipo: 'proyecto', accion: 'creado', proyectoId: id, actor: ctx.actor, clienteId: ctx.clienteId, datos: proyecto })
    this.publicarActividad(ctx, act)
    return proyecto
  }

  async actualizarProyecto(
    ctx: Ctx,
    id: string,
    cambios: {
      nombre?: string
      color?: Color
      repoGithub?: string | null
      descripcion?: string
      archivado?: boolean
      emoji?: string | null
      /** Solo null (quitar la foto): se pone con ponerImagenProyecto. */
      imagen?: null
    },
  ): Promise<Proyecto> {
    await this.propio('proyecto', id)
    const [antes] = await this.db.consulta(`select * from proyectos where id = $1`, [id])
    if (!antes) throw new ErrorDominio('No existe ese proyecto.', 404)
    if (cambios.nombre !== undefined && !cambios.nombre.trim()) throw new ErrorDominio('El proyecto necesita un nombre.')
    if (cambios.nombre && cambios.nombre.trim().length > 60) throw new ErrorDominio('El nombre puede tener hasta 60 caracteres.')
    if (cambios.descripcion && cambios.descripcion.length > 280) throw new ErrorDominio('La descripción puede tener hasta 280 caracteres.')
    const repo = cambios.repoGithub?.trim() || null
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ErrorDominio('El repo tiene que ser usuario/repo (por ejemplo: facundo/telar).')
    const emoji = cambios.emoji?.trim() || null
    if (emoji && [...emoji].length > 8) throw new ErrorDominio('El emoji es uno solo.')
    const [f] = await this.db.consulta(
      `update proyectos set
         nombre = coalesce($2, nombre),
         color = coalesce($3, color),
         repo_github = case when $4::boolean then $5 else repo_github end,
         descripcion = coalesce($6, descripcion),
         archivado = coalesce($7, archivado),
         emoji = case when $8::boolean then $9 else emoji end,
         imagen = case when $10::boolean then null else imagen end,
         actualizado_en = now()
       where id = $1 returning *`,
      [
        id,
        cambios.nombre?.trim() || null,
        cambios.color ?? null,
        cambios.repoGithub !== undefined,
        repo,
        cambios.descripcion ?? null,
        cambios.archivado ?? null,
        cambios.emoji !== undefined,
        emoji,
        cambios.imagen === null,
      ],
    )
    if (!f) throw new ErrorDominio('No existe ese proyecto.', 404)
    if (cambios.imagen === null) await this.borrarFotoVieja(antes.imagen)
    const resumen =
      cambios.archivado === true && !antes.archivado
        ? `archivó el proyecto «${f.nombre}»`
        : cambios.archivado === false && antes.archivado
          ? `restauró el proyecto «${f.nombre}»`
          : cambios.nombre && cambios.nombre.trim() !== antes.nombre
            ? `cambió el nombre del proyecto a «${f.nombre}»`
            : `editó el proyecto «${f.nombre}»`
    const act = await this.registrar(this.db, ctx, { accion: 'proyecto.actualizado', resumen, proyectoId: id })
    this.publicarActividad(ctx, act)
    const proyecto = (await this.listarProyectos(true)).find((p) => p.id === id)!
    this.bus.publicar({ tipo: 'proyecto', accion: 'actualizado', proyectoId: id, actor: ctx.actor, clienteId: ctx.clienteId, datos: proyecto })
    return proyecto
  }

  /** La foto anterior del proyecto ya no la usa nadie: online ocupa lugar en la base. */
  private async borrarFotoVieja(ruta: string | null) {
    if (!ruta?.startsWith('/archivos/proyectos/')) return
    try {
      await this.almacen.borrar(ruta.slice('/archivos/'.length))
    } catch {
      // Si no se pudo borrar, queda huérfana: no es motivo para fallar el cambio.
    }
  }

  /** Pone la foto del proyecto (ya guardada en el almacén). */
  async ponerImagenProyecto(ctx: Ctx, id: string, ruta: string): Promise<Proyecto> {
    await this.propio('proyecto', id)
    const [antes] = await this.db.consulta<{ imagen: string | null }>(`select imagen from proyectos where id = $1`, [id])
    // La foto reemplaza al emoji: así "Usar las iniciales" y el orden foto → emoji → sello no se pisan.
    const [f] = await this.db.consulta(`update proyectos set imagen = $2, emoji = null, actualizado_en = now() where id = $1 returning *`, [id, ruta])
    if (!f) throw new ErrorDominio('No existe ese proyecto.', 404)
    if (antes?.imagen !== ruta) await this.borrarFotoVieja(antes?.imagen ?? null)
    const act = await this.registrar(this.db, ctx, { accion: 'proyecto.actualizado', resumen: `cambió la foto del proyecto «${f.nombre}»`, proyectoId: id })
    this.publicarActividad(ctx, act)
    const proyecto = (await this.listarProyectos(true)).find((p) => p.id === id)!
    this.bus.publicar({ tipo: 'proyecto', accion: 'actualizado', proyectoId: id, actor: ctx.actor, clienteId: ctx.clienteId, datos: proyecto })
    return proyecto
  }

  async crearTablero(
    ctx: Ctx,
    datos: {
      proyectoId: string
      nombre: string
      descripcion?: string
      listas?: { nombre: string; categoria: Categoria | null }[]
      /** Las vistas que tiene (al menos una). O el `tipo`, que es un atajo (de fábrica, «tablero»: solo Kanban). */
      vistas?: VistaTablero[]
      tipo?: TipoTablero
    },
  ): Promise<TableroResumen> {
    await this.propio('proyecto', datos.proyectoId)
    if (!datos.nombre?.trim()) throw new ErrorDominio('El tablero necesita un nombre.')
    if (datos.tipo !== undefined && !TIPOS_TABLERO.includes(datos.tipo))
      throw new ErrorDominio(`Tipo de tablero desconocido: «${datos.tipo}». Los tipos son: ${TIPOS_TABLERO.join(', ')}.`)
    if (datos.vistas !== undefined) {
      const mal = problemaEnVistas(datos.vistas)
      if (mal) throw new ErrorDominio(mal)
    }
    if (datos.vistas && datos.tipo && ordenarVistas(datos.vistas).join() !== VISTAS_DEL_TIPO[datos.tipo].join())
      throw new ErrorDominio('Mandá `vistas` o `tipo`, no los dos (el tipo es un atajo para un conjunto de vistas).')
    // «Lo que no se crea de más»: cada vista trae lo suyo, y solo si el tablero la tiene (las listas, solo con Kanban).
    const vistas = ordenarVistas(datos.vistas ?? VISTAS_DEL_TIPO[datos.tipo ?? TIPO_DE_FABRICA])
    if (datos.listas?.length && !vistas.includes('kanban'))
      throw new ErrorDominio(`Un tablero sin Kanban (tiene: ${frasePorVistas(vistas)}) no lleva listas. Sacá las listas o sumá la vista kanban.`)
    const id = nuevoId()
    await this.db.transaccion(async (tx) => {
      const existentes = await tx.consulta(`select slug, orden from tableros where proyecto_id = $1`, [datos.proyectoId])
      let s = slug(datos.nombre)
      let n = 2
      const base = s
      while (existentes.some((t) => t.slug === s)) s = `${base}-${n++}`
      const ultimo = existentes.map((t) => t.orden as string).sort().at(-1) ?? null
      await tx.consulta(
        `insert into tableros (id, proyecto_id, nombre, slug, descripcion, orden, ajustes) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [id, datos.proyectoId, datos.nombre.trim(), s, datos.descripcion ?? '', claveEntre(ultimo, null), JSON.stringify({ vistas })],
      )
      const listas = vistas.includes('kanban') ? (datos.listas ?? LISTAS_DE_FABRICA) : []
      const claves = generateNKeysBetween(null, null, listas.length)
      for (const [i, l] of listas.entries()) {
        await tx.consulta(`insert into listas (id, tablero_id, nombre, orden, categoria) values ($1, $2, $3, $4, $5)`, [
          nuevoId(),
          id,
          l.nombre,
          claves[i],
          l.categoria,
        ])
      }
    })
    const [f] = await this.db.consulta(`select * from tableros where id = $1`, [id])
    const tablero = aTablero(f!)
    const act = await this.registrar(this.db, ctx, {
      accion: 'tablero.creado',
      resumen: `creó el tablero «${tablero.nombre}» (${TEXTO_TIPO[tipoDeVistas(vistas)].nombre}${vistas.length > 1 && vistas.length < 3 ? `: ${frasePorVistas(vistas)}` : ''})`,
      proyectoId: datos.proyectoId,
      tableroId: id,
    })
    this.bus.publicar({ tipo: 'tablero', accion: 'creado', proyectoId: datos.proyectoId, tableroId: id, actor: ctx.actor, clienteId: ctx.clienteId, datos: tablero })
    this.publicarActividad(ctx, act)
    return tablero
  }

  async actualizarTablero(
    ctx: Ctx,
    id: string,
    cambios: { nombre?: string; descripcion?: string; archivado?: boolean; ajustes?: Record<string, unknown>; vistas?: VistaTablero[] },
  ) {
    const antes = await this.tableroPropio(id)
    if (cambios.nombre !== undefined && !cambios.nombre.trim()) throw new ErrorDominio('El tablero necesita un nombre.')
    if (cambios.vistas !== undefined) {
      const mal = problemaEnVistas(cambios.vistas)
      if (mal) throw new ErrorDominio(mal)
    }
    // Un proyecto necesita al menos un tablero activo.
    if (cambios.archivado === true && !antes.archivado) {
      const [n] = await this.db.consulta<{ n: number }>(
        `select count(*)::int as n from tableros where proyecto_id = $1 and not archivado and id <> $2`,
        [antes.proyecto_id, id],
      )
      if (!n?.n) throw new ErrorDominio('Un proyecto necesita al menos un tablero: no se puede archivar el último.', 409)
    }
    // Los ajustes se fusionan con lo guardado (y, adentro de "lienzo", clave por clave). Las vistas no entran por acá: van en `vistas`.
    const vistasAntes = vistasDeFila(antes)
    const vistasAhora = cambios.vistas ? ordenarVistas(cambios.vistas) : vistasAntes
    const cambiaVistas = vistasAhora.join() !== vistasAntes.join()
    let ajustes: Record<string, unknown> | null = null
    if (cambios.ajustes || cambios.vistas) {
      const previos = ajustesDeFila(antes)
      const { vistas: _ignoradas, ...pedidos } = (cambios.ajustes ?? {}) as Record<string, unknown>
      const nuevos: Record<string, unknown> = { ...previos, ...pedidos }
      if (pedidos.lienzo && typeof pedidos.lienzo === 'object') nuevos.lienzo = { ...(previos.lienzo ?? {}), ...(pedidos.lienzo as object) }
      if (cambios.vistas) nuevos.vistas = vistasAhora
      ajustes = nuevos
    }
    // Sumar el Kanban a un tablero que nunca tuvo listas: arranca con las tres de siempre (si ya tenía, se reactivan tal cual).
    if (cambiaVistas && vistasAhora.includes('kanban') && !vistasAntes.includes('kanban')) {
      const [l] = await this.db.consulta<{ n: number }>(`select count(*)::int as n from listas where tablero_id = $1`, [id])
      if (!l?.n) {
        const claves = generateNKeysBetween(null, null, LISTAS_DE_FABRICA.length)
        for (const [i, x] of LISTAS_DE_FABRICA.entries())
          await this.db.consulta(`insert into listas (id, tablero_id, nombre, orden, categoria) values ($1, $2, $3, $4, $5)`, [nuevoId(), id, x.nombre, claves[i], x.categoria])
      }
    }
    // El slug no cambia al renombrar: los enlaces guardados, el MCP y los marcadores siguen andando.
    const [f] = await this.db.consulta(
      `update tableros set nombre = coalesce($2, nombre), descripcion = coalesce($3, descripcion),
         archivado = coalesce($4, archivado), ajustes = coalesce($5::jsonb, ajustes), actualizado_en = now()
       where id = $1 returning *, (select count(*)::int from tarjetas x where x.tablero_id = tableros.id and not x.archivada) as abiertas`,
      [id, cambios.nombre?.trim() || null, cambios.descripcion ?? null, cambios.archivado ?? null, ajustes ? JSON.stringify(ajustes) : null],
    )
    if (!f) throw new ErrorDominio('No existe ese tablero.', 404)
    const tablero = aTablero(f)
    // Cambiar el plazo del archivo automático lo corre ya mismo (sin esperar la hora ni que alguien abra el tablero).
    if (cambios.ajustes && 'archivoHecho' in cambios.ajustes && !f.archivado) await this.archivoPerezoso(f, true)
    const resumen =
      cambios.archivado === true && !antes.archivado
        ? `archivó el tablero «${tablero.nombre}»`
        : cambios.archivado === false && antes.archivado
          ? `restauró el tablero «${tablero.nombre}»`
          : cambios.nombre && cambios.nombre.trim() !== antes.nombre
            ? `cambió el nombre del tablero «${antes.nombre}» a «${tablero.nombre}»`
            : cambiaVistas
              ? `cambió las vistas del tablero «${tablero.nombre}»: ahora tiene ${frasePorVistas(vistasAhora)}`
              : null
    if (resumen) {
      const act = await this.registrar(this.db, ctx, { accion: 'tablero.actualizado', resumen, proyectoId: tablero.proyectoId, tableroId: id })
      this.publicarActividad(ctx, act)
    }
    this.bus.publicar({ tipo: 'tablero', accion: 'actualizado', proyectoId: tablero.proyectoId, tableroId: id, actor: ctx.actor, clienteId: ctx.clienteId, datos: tablero })
    return tablero
  }

  async crearLista(
    ctx: Ctx,
    datos: { tableroId: string; nombre: string; categoria?: Categoria | null; posicion?: number | 'final' | 'inicio'; id?: string },
  ): Promise<Lista> {
    const nombre = datos.nombre.trim()
    if (!nombre) throw new ErrorDominio('La lista necesita un nombre.')
    const tf = await this.tableroPropio(datos.tableroId)
    const listas = await this.listarListas(datos.tableroId)
    const indice =
      datos.posicion === 'inicio' ? 0 : typeof datos.posicion === 'number' ? Math.max(0, Math.min(datos.posicion, listas.length)) : listas.length
    const orden = claveEntre(listas[indice - 1]?.orden ?? null, listas[indice]?.orden ?? null)
    const id = datos.id ?? nuevoId()
    const [f] = await this.db.consulta(
      `insert into listas (id, tablero_id, nombre, orden, categoria) values ($1, $2, $3, $4, $5) returning *`,
      [id, datos.tableroId, nombre, orden, datos.categoria ?? null],
    )
    const lista = aLista(f!)
    const act = await this.registrar(this.db, ctx, {
      accion: 'lista.creada',
      resumen: `creó la lista «${nombre}»`,
      proyectoId: tf.proyecto_id,
      tableroId: datos.tableroId,
    })
    this.bus.publicar({ tipo: 'lista', accion: 'creada', proyectoId: tf.proyecto_id, tableroId: datos.tableroId, actor: ctx.actor, clienteId: ctx.clienteId, resumen: act.resumen, datos: lista })
    this.publicarActividad(ctx, act)
    return lista
  }

  async actualizarLista(
    ctx: Ctx,
    id: string,
    cambios: { nombre?: string; categoria?: Categoria | null; color?: Color | null; limite?: number | null; archivada?: boolean; indice?: number },
  ): Promise<Lista> {
    await this.propio('lista', id)
    const [antes] = await this.db.consulta(`select l.*, t.proyecto_id from listas l join tableros t on t.id = l.tablero_id where l.id = $1`, [id])
    if (!antes) throw new ErrorDominio('No existe esa lista.', 404)
    let orden: string = antes.orden
    if (cambios.indice !== undefined) {
      const otras = (await this.listarListas(antes.tablero_id)).filter((l) => l.id !== id)
      const i = Math.max(0, Math.min(cambios.indice, otras.length))
      orden = claveEntre(otras[i - 1]?.orden ?? null, otras[i]?.orden ?? null)
    }
    const [f] = await this.db.consulta(
      `update listas set
         nombre = coalesce($2, nombre),
         categoria = case when $3::boolean then $4 else categoria end,
         color = case when $5::boolean then $6 else color end,
         limite = case when $7::boolean then $8::int else limite end,
         archivada = coalesce($9, archivada),
         orden = $10,
         actualizado_en = now()
       where id = $1 returning *`,
      [
        id,
        cambios.nombre?.trim() || null,
        cambios.categoria !== undefined,
        cambios.categoria ?? null,
        cambios.color !== undefined,
        cambios.color ?? null,
        cambios.limite !== undefined,
        cambios.limite ?? null,
        cambios.archivada ?? null,
        orden,
      ],
    )
    const lista = aLista(f!)
    let resumen = `actualizó la lista «${lista.nombre}»`
    if (cambios.nombre && cambios.nombre.trim() !== antes.nombre) resumen = `renombró la lista «${antes.nombre}» a «${lista.nombre}»`
    if (cambios.archivada === true) resumen = `archivó la lista «${lista.nombre}»`
    if (cambios.archivada === false) resumen = `restauró la lista «${lista.nombre}»`
    if (cambios.indice !== undefined && Object.keys(cambios).length === 1) resumen = `movió la lista «${lista.nombre}»`
    const act = await this.registrar(this.db, ctx, {
      accion: 'lista.actualizada',
      resumen,
      proyectoId: antes.proyecto_id,
      tableroId: antes.tablero_id,
    })
    this.bus.publicar({ tipo: 'lista', accion: 'actualizada', proyectoId: antes.proyecto_id, tableroId: antes.tablero_id, actor: ctx.actor, clienteId: ctx.clienteId, resumen, datos: lista })
    this.publicarActividad(ctx, act)
    return lista
  }

  // ───────────────────────── tarjetas ─────────────────────────

  async crearTarjeta(ctx: Ctx, d: NuevaTarjeta): Promise<TarjetaResumen> {
    const titulo = d.titulo?.trim()
    if (!titulo) throw new ErrorDominio('La tarjeta necesita un título.')
    if (d.tipo && !TIPOS.includes(d.tipo)) throw new ErrorDominio(`Tipo desconocido: ${d.tipo}. Tipos: ${TIPOS.join(', ')}.`)
    if (d.prioridad && !PRIORIDADES.includes(d.prioridad))
      throw new ErrorDominio(`Prioridad desconocida: ${d.prioridad}. Prioridades: ${PRIORIDADES.join(', ')}.`)
    const tf = await this.tableroPropio(d.tableroId)
    let listaId = d.listaId ?? null
    if (listaId === null && d.listaId === undefined) {
      const [primera] = await this.db.consulta(
        `select id from listas where tablero_id = $1 and not archivada order by orden collate "C" limit 1`,
        [d.tableroId],
      )
      listaId = primera?.id ?? null
    }
    let listaNombre: string | null = null
    let categoria: Categoria | null = null
    if (listaId) {
      const [lf] = await this.db.consulta(`select * from listas where id = $1 and tablero_id = $2`, [listaId, d.tableroId])
      if (!lf) throw new ErrorDominio('Esa lista no es de este tablero.', 404)
      listaNombre = lf.nombre
      categoria = lf.categoria ?? null
    }
    const id = nuevoId()
    let clave = ''
    let textoPorque = ''
    await this.db.transaccion(async (tx) => {
      const [num] = await tx.consulta<{ numero: number; prefijo: string }>(
        `update proyectos set siguiente_numero = siguiente_numero + 1 where id = $1
         returning siguiente_numero - 1 as numero, prefijo`,
        [tf.proyecto_id],
      )
      clave = `${num!.prefijo}-${num!.numero}`
      const hermanas = await tx.consulta<{ orden: string }>(
        `select orden from tarjetas where tablero_id = $1 and lista_id is not distinct from $2 and not archivada
          order by orden collate "C"`,
        [d.tableroId, listaId],
      )
      const ordenes = hermanas.map((h) => h.orden)
      const indice =
        d.posicion === 'arriba' ? 0 : typeof d.posicion === 'number' ? Math.max(0, Math.min(d.posicion, ordenes.length)) : ordenes.length
      const orden = claveEntre(ordenes[indice - 1] ?? null, ordenes[indice] ?? null)
      let padreId: string | null = null
      if (d.padre) padreId = (await this.resolverTarjeta(d.padre, tx)).id
      await tx.consulta(
        `insert into tarjetas (id, proyecto_id, tablero_id, lista_id, numero, clave, orden, padre_id, tipo, titulo, descripcion,
            prioridad, estimacion, fecha_inicio, fecha_vence, vence_con_hora, completada_en, portada, campos, ref_externa, origen)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          id,
          tf.proyecto_id,
          d.tableroId,
          listaId,
          num!.numero,
          clave,
          orden,
          padreId,
          d.tipo ?? 'tarea',
          titulo,
          d.descripcion ?? '',
          d.prioridad ?? 'ninguna',
          d.estimacion ?? null,
          fechaEntrada(d.inicio),
          fechaEntrada(d.vence),
          d.conHora ?? false,
          categoria === 'hecho' ? new Date().toISOString() : null,
          d.portada ?? null,
          d.campos ?? {},
          d.refExterna ?? null,
          ctx.actor,
        ],
      )
      if (d.etiquetas?.length) {
        const ids = await this.asegurarEtiquetas(tx, tf.proyecto_id, d.etiquetas)
        for (const eid of ids)
          await tx.consulta(`insert into tarjeta_etiquetas values ($1, $2) on conflict do nothing`, [id, eid])
      }
      if (d.responsables?.length) {
        const ids = await this.idsDeMiembros(tx, d.responsables)
        for (const mid of ids)
          await tx.consulta(`insert into tarjeta_responsables values ($1, $2) on conflict do nothing`, [id, mid])
      }
      if (d.porque) textoPorque = await this.guardarPorque(tx, id, d.porque)
      if (d.enlaces?.length) for (const url of d.enlaces) await this.insertarEnlace(tx, ctx, id, url)
      if (d.checklist?.items?.length) {
        const cid = nuevoId()
        await tx.consulta(`insert into checklists (id, tarjeta_id, titulo, orden) values ($1, $2, $3, $4)`, [
          cid,
          id,
          d.checklist.titulo?.trim() || 'Checklist',
          claveEntre(null, null),
        ])
        const claves = generateNKeysBetween(null, null, d.checklist.items.length)
        for (const [i, texto] of d.checklist.items.entries())
          await tx.consulta(`insert into checklist_items (id, checklist_id, texto, orden) values ($1, $2, $3, $4)`, [
            nuevoId(),
            cid,
            texto,
            claves[i],
          ])
      }
      await this.refrescarBusqueda(tx, id)
    })
    const act = await this.registrar(this.db, ctx, {
      accion: 'tarjeta.creada',
      resumen: `creó ${clave} «${recortar(titulo, 80)}»${listaNombre ? ` en ${fraseDeLista(listaNombre)}` : ''}`,
      proyectoId: tf.proyecto_id,
      tableroId: d.tableroId,
      tarjetaId: id,
      tarjetaClave: clave,
    })
    const creada = await this.emitirTarjeta(ctx, id, 'creada', act)
    // Menciones en la descripción o en el porqué de una tarjeta nueva (sin «@» no se llama a nadie).
    const nuevos: TextoGuardado[] = []
    const base = { proyectoId: tf.proyecto_id as string, tableroId: d.tableroId, tarjetaId: id, tarjetaClave: clave, enVivo: false }
    if (d.descripcion?.includes('@')) nuevos.push({ ...base, origen: { tipo: 'descripcion', id }, texto: d.descripcion })
    if (textoPorque.includes('@')) nuevos.push({ ...base, origen: { tipo: 'porque', id }, texto: textoPorque, enVivo: true })
    await this.avisarTextos(ctx, nuevos)
    await this.avisarTarjetaEnLista(ctx, id, listaId)
    return creada
  }

  async actualizarTarjeta(ctx: Ctx, ref: string, c: CambiosTarjeta): Promise<TarjetaResumen> {
    const t = await this.resolverTarjeta(ref)
    if (c.version !== undefined && c.version !== t.version)
      throw new ErrorDominio('La tarjeta cambió mientras la editabas. Volvé a abrirla para ver lo último.', 409)
    if (c.tipo && !TIPOS.includes(c.tipo)) throw new ErrorDominio(`Tipo desconocido: ${c.tipo}. Tipos: ${TIPOS.join(', ')}.`)
    if (c.prioridad && !PRIORIDADES.includes(c.prioridad))
      throw new ErrorDominio(`Prioridad desconocida: ${c.prioridad}. Prioridades: ${PRIORIDADES.join(', ')}.`)
    if (c.titulo !== undefined && !c.titulo.trim()) throw new ErrorDominio('El título no puede quedar vacío.')
    const cambios: string[] = []
    await this.db.transaccion(async (tx) => {
      const sets: string[] = []
      const params: unknown[] = [t.id]
      const poner = (col: string, valor: unknown) => {
        params.push(valor)
        sets.push(`${col} = $${params.length}`)
      }
      if (c.titulo !== undefined && c.titulo.trim() !== t.titulo) {
        poner('titulo', c.titulo.trim())
        cambios.push(`cambió el título de ${t.clave} a «${recortar(c.titulo.trim(), 80)}»`)
      }
      if (c.descripcion !== undefined && c.descripcion !== t.descripcion) {
        poner('descripcion', c.descripcion)
        cambios.push(`editó la descripción de ${t.clave}`)
      }
      if (c.tipo !== undefined && c.tipo !== t.tipo) {
        poner('tipo', c.tipo)
        cambios.push(`cambió el tipo de ${t.clave} a ${nombreTipo(c.tipo)}`)
      }
      if (c.prioridad !== undefined && c.prioridad !== t.prioridad) {
        poner('prioridad', c.prioridad)
        cambios.push(`cambió la prioridad de ${t.clave} a ${nombrePrioridad(c.prioridad)}`)
      }
      if (c.estimacion !== undefined) {
        poner('estimacion', c.estimacion)
        cambios.push(c.estimacion == null ? `quitó la estimación de ${t.clave}` : `estimó ${t.clave} en ${c.estimacion} puntos`)
      }
      if (c.inicio !== undefined) {
        poner('fecha_inicio', fechaEntrada(c.inicio))
        cambios.push(`cambió el inicio de ${t.clave}`)
      }
      if (c.vence !== undefined) {
        poner('fecha_vence', fechaEntrada(c.vence))
        cambios.push(c.vence ? `cambió el vencimiento de ${t.clave}` : `quitó el vencimiento de ${t.clave}`)
      }
      if (c.conHora !== undefined) poner('vence_con_hora', c.conHora)
      if (c.completada !== undefined) {
        poner('completada_en', c.completada ? new Date().toISOString() : null)
        cambios.push(c.completada ? `marcó ${t.clave} como completada` : `marcó ${t.clave} como sin completar`)
      }
      if (c.portada !== undefined) {
        poner('portada', c.portada)
        cambios.push(c.portada ? `cambió la portada de ${t.clave}` : `quitó la portada de ${t.clave}`)
      }
      if (c.padre !== undefined) {
        const padreId = c.padre ? (await this.resolverTarjeta(c.padre, tx)).id : null
        if (padreId === t.id) throw new ErrorDominio('Una tarjeta no puede ser su propia madre.')
        poner('padre_id', padreId)
        cambios.push(padreId ? `puso a ${t.clave} dentro de otra tarjeta` : `sacó a ${t.clave} de su épica`)
      }
      if (c.campos !== undefined) {
        poner('campos', { ...(t.campos ?? {}), ...c.campos })
      }
      if (sets.length) {
        await tx.consulta(
          `update tarjetas set ${sets.join(', ')}, actualizada_en = now(), version = version + 1 where id = $1`,
          params,
        )
      }
      // Etiquetas
      if (c.etiquetas !== undefined || c.agregarEtiquetas?.length || c.quitarEtiquetas?.length) {
        if (c.etiquetas !== undefined) {
          const ids = await this.asegurarEtiquetas(tx, t.proyecto_id, c.etiquetas)
          await tx.consulta(`delete from tarjeta_etiquetas where tarjeta_id = $1`, [t.id])
          for (const eid of ids) await tx.consulta(`insert into tarjeta_etiquetas values ($1, $2) on conflict do nothing`, [t.id, eid])
        }
        if (c.agregarEtiquetas?.length) {
          const ids = await this.asegurarEtiquetas(tx, t.proyecto_id, c.agregarEtiquetas)
          for (const eid of ids) await tx.consulta(`insert into tarjeta_etiquetas values ($1, $2) on conflict do nothing`, [t.id, eid])
        }
        if (c.quitarEtiquetas?.length) {
          const todas = await tx.consulta(`select * from etiquetas where proyecto_id = $1`, [t.proyecto_id])
          const ids = c.quitarEtiquetas
            .map((r) => todas.find((e) => e.id === r || normalizar(e.nombre) === normalizar(r.replace(/^#/, '')))?.id)
            .filter(Boolean)
          if (ids.length)
            await tx.consulta(`delete from tarjeta_etiquetas where tarjeta_id = $1 and etiqueta_id = any($2::text[])`, [t.id, ids])
        }
        cambios.push(`cambió las etiquetas de ${t.clave}`)
        if (!sets.length) await this.tocarTarjeta(tx, t.id)
      }
      // Responsables
      if (c.responsables !== undefined || c.agregarResponsables?.length || c.quitarResponsables?.length) {
        if (c.responsables !== undefined) {
          const ids = await this.idsDeMiembros(tx, c.responsables)
          await tx.consulta(`delete from tarjeta_responsables where tarjeta_id = $1`, [t.id])
          for (const mid of ids) await tx.consulta(`insert into tarjeta_responsables values ($1, $2) on conflict do nothing`, [t.id, mid])
        }
        if (c.agregarResponsables?.length) {
          const ids = await this.idsDeMiembros(tx, c.agregarResponsables)
          for (const mid of ids) await tx.consulta(`insert into tarjeta_responsables values ($1, $2) on conflict do nothing`, [t.id, mid])
        }
        if (c.quitarResponsables?.length) {
          const ids = await this.idsDeMiembros(tx, c.quitarResponsables)
          await tx.consulta(`delete from tarjeta_responsables where tarjeta_id = $1 and miembro_id = any($2::text[])`, [t.id, ids])
        }
        cambios.push(`cambió los responsables de ${t.clave}`)
        if (!sets.length) await this.tocarTarjeta(tx, t.id)
      }
      await this.refrescarBusqueda(tx, t.id)
    })
    const descripcionCambio = c.descripcion !== undefined && c.descripcion !== t.descripcion
    if (cambios.length === 0) return this.resumenTarjeta(t.id)
    const act = await this.registrar(this.db, ctx, {
      accion: 'tarjeta.actualizada',
      resumen: cambios.length === 1 ? cambios[0]! : `editó ${t.clave} (${cambios.length} cambios)`,
      proyectoId: t.proyecto_id,
      tableroId: t.tablero_id,
      tarjetaId: t.id,
      tarjetaClave: t.clave,
      detalle: { cambios },
    })
    const resumenActualizada = await this.emitirTarjeta(ctx, t.id, 'actualizada', act)
    // Menciones en la descripción: corre la regla de la cantidad solo si la descripción cambió.
    if (descripcionCambio)
      await this.avisarTextos(ctx, [
        { origen: { tipo: 'descripcion', id: t.id }, texto: c.descripcion ?? '', proyectoId: t.proyecto_id, tableroId: t.tablero_id, tarjetaId: t.id, tarjetaClave: t.clave, enVivo: false },
      ])
    return resumenActualizada
  }

  /**
   * Mueve una tarjeta a una lista (del mismo u otro tablero del proyecto) y a una posición.
   * Si la lista tiene categoría "hecho", la tarjeta queda completada; si sale de ahí, deja de estarlo.
   */
  async moverTarjeta(
    ctx: Ctx,
    ref: string,
    destino: { listaId: string; tableroId?: string; posicion?: 'arriba' | 'abajo' | number },
  ): Promise<TarjetaResumen> {
    const t = await this.resolverTarjeta(ref)
    await this.propio('lista', destino.listaId)
    const [lf] = await this.db.consulta(
      `select l.*, tb.proyecto_id from listas l join tableros tb on tb.id = l.tablero_id where l.id = $1`,
      [destino.listaId],
    )
    if (!lf) throw new ErrorDominio('No existe esa lista.', 404)
    if (lf.proyecto_id !== t.proyecto_id) throw new ErrorDominio('Solo se puede mover dentro del mismo proyecto.')
    const [origenF] = t.lista_id ? await this.db.consulta(`select * from listas where id = $1`, [t.lista_id]) : []
    await this.db.transaccion(async (tx) => {
      const hermanas = await tx.consulta<{ orden: string }>(
        `select orden from tarjetas where lista_id = $1 and id <> $2 and not archivada order by orden collate "C", id`,
        [lf.id, t.id],
      )
      const ordenes = hermanas.map((h) => h.orden)
      const p = destino.posicion ?? 'abajo'
      const indice = p === 'arriba' ? 0 : p === 'abajo' ? ordenes.length : Math.max(0, Math.min(p, ordenes.length))
      let orden = claveEntre(ordenes[indice - 1] ?? null, ordenes[indice] ?? null)
      if (ordenes.includes(orden)) {
        // Empate raro (dos clientes a la vez): se renumera la lista entera.
        const todas = await tx.consulta<{ id: string }>(
          `select id from tarjetas where lista_id = $1 and id <> $2 and not archivada order by orden collate "C", id`,
          [lf.id, t.id],
        )
        const nuevas = generateNKeysBetween(null, null, todas.length + 1)
        const ids = todas.map((x) => x.id)
        ids.splice(indice, 0, t.id)
        for (const [i, id] of ids.entries()) if (id !== t.id) await tx.consulta(`update tarjetas set orden = $2 where id = $1`, [id, nuevas[i]])
        orden = nuevas[indice]!
      }
      // Llegar a una lista de Hecho desde otra cosa es «llegó a Hecho ahora» (queda arriba de todo, aunque ya tuviera una fecha de
      // completada de antes); moverla dentro de Hecho no cambia cuándo llegó. Salir de Hecho la deja sin completar.
      const completada =
        lf.categoria === 'hecho'
          ? origenF?.categoria === 'hecho' && t.completada_en
            ? iso(t.completada_en)
            : new Date().toISOString()
          : origenF?.categoria === 'hecho'
            ? null
            : iso(t.completada_en)
      await tx.consulta(
        `update tarjetas set lista_id = $2, tablero_id = $3, orden = $4, completada_en = $5,
           actualizada_en = now(), version = version + 1 where id = $1`,
        [t.id, lf.id, lf.tablero_id, orden, completada],
      )
    })
    const mismaLista = origenF?.id === lf.id
    const resumen = mismaLista
      ? `reordenó ${t.clave} en ${fraseDeLista(lf.nombre)}`
      : `movió ${t.clave} de ${fraseDeLista(origenF?.nombre)} a ${fraseDeLista(lf.nombre)}`
    const act = await this.registrar(this.db, ctx, {
      accion: 'tarjeta.movida',
      resumen,
      proyectoId: t.proyecto_id,
      tableroId: lf.tablero_id,
      tarjetaId: t.id,
      tarjetaClave: t.clave,
      detalle: { desde: origenF?.id ?? null, hacia: lf.id },
    })
    if (lf.tablero_id !== t.tablero_id) {
      // Avisar al tablero de origen que la tarjeta se fue.
      this.bus.publicar({ tipo: 'tarjeta', accion: 'salio', tableroId: t.tablero_id, tarjetaId: t.id, actor: ctx.actor, clienteId: ctx.clienteId, datos: { id: t.id } })
    }
    const movida = await this.emitirTarjeta(ctx, t.id, 'movida', act)
    if (!mismaLista) await this.avisarTarjetaEnLista(ctx, t.id, lf.id)
    return movida
  }

  async archivarTarjeta(ctx: Ctx, ref: string, archivar = true): Promise<TarjetaResumen> {
    const t = await this.resolverTarjeta(ref)
    if (Boolean(t.archivada) === archivar) return this.resumenTarjeta(t.id)
    let orden: string = t.orden
    if (!archivar && t.lista_id) {
      const [ultima] = await this.db.consulta<{ orden: string }>(
        `select orden from tarjetas where lista_id = $1 and not archivada order by orden collate "C" desc limit 1`,
        [t.lista_id],
      )
      if (ultima && ultima.orden >= orden) orden = claveEntre(ultima.orden, null)
    }
    // Una tarjeta que vuelve a una lista de Hecho siendo más vieja que el plazo del archivo automático la archivaría Telar otra vez
    // al toque: al restaurarla llega a Hecho «ahora» (lo que se restaura con un toque se queda).
    let llegoAhora: string | null = null
    if (!archivar && t.lista_id && t.completada_en) {
      const [lf] = await this.db.consulta(
        `select l.categoria, tb.ajustes from listas l join tableros tb on tb.id = l.tablero_id where l.id = $1`,
        [t.lista_id],
      )
      const dias = lf?.categoria === 'hecho' ? leerDiasArchivoHecho(typeof lf.ajustes === 'string' ? JSON.parse(lf.ajustes) : lf.ajustes) : null
      if (dias !== null && Date.now() - new Date(t.completada_en).getTime() > dias * 86_400_000) llegoAhora = new Date().toISOString()
    }
    await this.db.consulta(
      `update tarjetas set archivada = $2, archivada_en = $3, orden = $4, completada_en = coalesce($5::timestamptz, completada_en),
         actualizada_en = now(), version = version + 1 where id = $1`,
      [t.id, archivar, archivar ? new Date().toISOString() : null, orden, llegoAhora],
    )
    const act = await this.registrar(this.db, ctx, {
      accion: archivar ? 'tarjeta.archivada' : 'tarjeta.restaurada',
      resumen: archivar ? `archivó ${t.clave}` : `restauró ${t.clave}`,
      proyectoId: t.proyecto_id,
      tableroId: t.tablero_id,
      tarjetaId: t.id,
      tarjetaClave: t.clave,
    })
    return this.emitirTarjeta(ctx, t.id, archivar ? 'archivada' : 'restaurada', act)
  }

  /**
   * El archivo automático de Hecho: archiva (reversible, como cualquier archivada) las tarjetas de las listas de categoría
   * «hecho» que llegaron a Hecho hace más de los días que eligió cada tablero (30 de fábrica; «nunca» lo apaga).
   * No toca: tarjetas fuera de una lista de Hecho, con una checklist sin terminar ni con un vínculo «bloquea» contra una tarjeta que
   * sigue abierta (en ningún sentido). Lo firma «Telar»: una entrada en la actividad por tablero y pasada, y un solo aviso en la campana
   * por tablero y plazo.
   *
   * Sin `tableroId` recorre los tableros de ESTA cuenta (nunca los de otra). Cada tablero se corre, a lo sumo, una vez por hora
   * (`archivo_hecho_en`, que se toma con un solo UPDATE: dos pestañas o dos instancias a la vez no lo corren dos veces);
   * `forzar` se salta la espera (al cambiar la opción). `ahora` es solo para las pruebas (fechas simuladas).
   */
  async archivarHechasViejas(op: { tableroId?: string; ahora?: Date; forzar?: boolean } = {}): Promise<ResultadoArchivoHecho> {
    const filas = op.tableroId
      ? [await this.tableroPropio(op.tableroId)]
      : await this.db.consulta(
          `select x.* from tableros x join proyectos p on p.id = x.proyecto_id
            where p.propietario = $1 and not x.archivado and not p.archivado order by x.creado_en, x.id`,
          [this.cuenta],
        )
    const total: ResultadoArchivoHecho = { tableros: 0, archivadas: 0, porTablero: [] }
    for (const f of filas) {
      const r = await sinTanda(() => this.archivarHechasViejasDe(f, op))
      if (!r) continue
      total.tableros++
      total.archivadas += r.archivadas
      if (r.archivadas) total.porTablero.push(r)
    }
    return total
  }

  /** `archivarHechasViejas` para un tablero ya leído. Null si no le tocaba (opción en «nunca» o todavía en su hora de espera). */
  private async archivarHechasViejasDe(
    f: Fila,
    op: { ahora?: Date; forzar?: boolean },
  ): Promise<{ tableroId: string; dias: number; archivadas: number; claves: string[] } | null> {
    const dias = leerDiasArchivoHecho(typeof f.ajustes === 'string' ? JSON.parse(f.ajustes) : f.ajustes)
    if (dias === null) return null
    const ahora = op.ahora ?? new Date()
    // Se toma el turno antes de mirar nada: con una sola sentencia, el primero que llega corre y los demás siguen de largo.
    const [turno] = await this.db.consulta(
      `update tableros set archivo_hecho_en = $2::timestamptz
        where id = $1 and ($4::boolean or archivo_hecho_en is null or archivo_hecho_en <= $3::timestamptz) returning id`,
      [f.id, ahora.toISOString(), new Date(ahora.getTime() - HORA_MS).toISOString(), Boolean(op.forzar)],
    )
    if (!turno) return null
    const corte = new Date(ahora.getTime() - dias * 86_400_000).toISOString()
    const archivadas = await this.db.consulta<{ id: string; clave: string }>(
      `with viejas as (
         select t.id from tarjetas t join listas l on l.id = t.lista_id
          where t.tablero_id = $1 and not t.archivada and l.categoria = 'hecho' and not l.archivada
            and coalesce(t.completada_en, t.actualizada_en) < $2::timestamptz
            and not exists (select 1 from checklists c join checklist_items i on i.checklist_id = c.id where c.tarjeta_id = t.id and not i.hecho)
            and not exists (
              select 1 from vinculos v
                join tarjetas o on o.id = case when v.origen_id = t.id then v.destino_id else v.origen_id end
                left join listas lo on lo.id = o.lista_id
               where v.tipo = 'bloquea' and (v.origen_id = t.id or v.destino_id = t.id)
                 and not o.archivada and coalesce(lo.categoria, '') <> 'hecho')
          order by coalesce(t.completada_en, t.actualizada_en), t.id limit $4
       )
       update tarjetas t set archivada = true, archivada_en = $3::timestamptz, actualizada_en = now(), version = t.version + 1
         from viejas where t.id = viejas.id returning t.id, t.clave`,
      [f.id, corte, ahora.toISOString(), TOPE_ARCHIVO_HECHO],
    )
    const claves = archivadas.map((a) => a.clave).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    if (!archivadas.length) return { tableroId: f.id, dias, archivadas: 0, claves }

    const ctx: Ctx = { actor: ACTOR_TELAR }
    const plural = archivadas.length === 1 ? '1 tarjeta' : `${archivadas.length} tarjetas`
    const act = await this.registrar(this.db, ctx, {
      accion: 'tablero.archivo_hecho',
      resumen: `archivó ${plural} de Hecho de hace más de ${dias} días`,
      proyectoId: f.proyecto_id,
      tableroId: f.id,
      detalle: { dias, cantidad: archivadas.length, claves: claves.slice(0, 100) },
    })
    // Las pestañas abiertas las sacan del Kanban solas (una consulta para todas, no una por tarjeta).
    for (const r of await this.resumenes('t.id = any($1::text[])', [archivadas.map((a) => a.id)])) {
      this.bus.publicar({ tipo: 'tarjeta', accion: 'archivada', proyectoId: r.proyectoId, tableroId: r.tableroId, tarjetaId: r.id, actor: ACTOR_TELAR, clienteId: null, datos: r })
    }
    this.publicarActividad(ctx, act)
    await this.avisarArchivoHecho(f, dias, archivadas.length)
    return { tableroId: f.id, dias, archivadas: archivadas.length, claves }
  }

  /** El aviso de la campana: una vez por tablero y plazo (las pasadas siguientes quedan en la actividad, sin repetir el aviso). Nunca tira. */
  private async avisarArchivoHecho(f: Fila, dias: number, cantidad: number): Promise<void> {
    const gancho = this.ganchos.avisoDeTelar
    if (!gancho) return
    try {
      const [p] = await this.db.consulta(`select prefijo from proyectos where id = $1`, [f.proyecto_id])
      await gancho(this, {
        titulo: `Telar archivó ${cantidad === 1 ? '1 tarjeta' : `${cantidad} tarjetas`} de Hecho de hace más de ${dias} días`,
        cuerpo: `En «${f.nombre}». Están en Archivadas y se restauran con un toque.`,
        enlace: p ? `/${p.prefijo}/${f.slug}` : null,
        claveUnica: `archivo-hecho:${f.id}:${dias}`,
      })
    } catch (e) {
      console.error('[tablero] no pude avisar del archivo de Hecho:', e instanceof Error ? e.message : e)
    }
  }

  /** El archivo automático al abrir el tablero: tope de una vez por hora, y si falla (por ejemplo, la migración todavía no se aplicó) abrir el tablero sigue andando. */
  private async archivoPerezoso(f: Fila, forzar = false): Promise<void> {
    try {
      await sinTanda(() => this.archivarHechasViejasDe(f, { forzar }))
    } catch (e) {
      if (!avisoArchivoPerezoso) {
        avisoArchivoPerezoso = true
        console.error('[tablero] no pude archivar lo viejo de Hecho (sigo sin eso):', e instanceof Error ? e.message : e)
      }
    }
  }

  async listarArchivadas(tableroId: string): Promise<TarjetaResumen[]> {
    await this.propio('tablero', tableroId)
    return this.resumenes('t.tablero_id = $1 and t.archivada', [tableroId], 't.archivada_en desc nulls last')
  }

  async copiarTarjeta(ctx: Ctx, ref: string, destino: { listaId?: string; titulo?: string } = {}): Promise<TarjetaResumen> {
    const d = await this.leerTarjeta(ref)
    const copia = await this.crearTarjeta(ctx, {
      tableroId: d.tableroId,
      listaId: destino.listaId ?? d.listaId,
      titulo: destino.titulo ?? `${d.titulo} (copia)`,
      tipo: d.tipo,
      descripcion: d.descripcion,
      prioridad: d.prioridad,
      estimacion: d.estimacion,
      etiquetas: d.etiquetas,
      responsables: d.responsables,
      inicio: d.fechas.inicio,
      vence: d.fechas.vence,
      conHora: d.fechas.conHora,
      portada: d.portada,
      porque: d.porqueCompleto ?? undefined,
      posicion: typeof destino.listaId === 'string' ? 'abajo' : undefined,
    })
    for (const c of d.checklists)
      await this.crearChecklist(ctx, copia.id, c.titulo, c.items.map((i) => i.texto), { silencioso: true })
    return this.emitirTarjeta(ctx, copia.id, 'actualizada')
  }

  // ───────────────────────── el porqué ─────────────────────────

  /** Guarda el porqué (lo que no llega queda como estaba) y devuelve el texto que quedó, para las menciones. */
  private async guardarPorque(db: Conexion, tarjetaId: string, p: Partial<PorqueEntrada>): Promise<string> {
    const [actual] = await db.consulta(`select * from porques where tarjeta_id = $1`, [tarjetaId])
    const base = actual ? aPorque(actual) : null
    const estados = ['abierta', 'propuesta', 'aceptada', 'rechazada', 'reemplazada']
    if (p.estado && !estados.includes(p.estado)) throw new ErrorDominio(`Estado del porqué desconocido: ${p.estado}. Estados: ${estados.join(', ')}.`)
    let reemplazadaPor = p.reemplazadaPor !== undefined ? p.reemplazadaPor : base?.reemplazadaPor ?? null
    if (reemplazadaPor) reemplazadaPor = (await this.resolverTarjeta(reemplazadaPor, db)).id
    const estado = p.estado ?? base?.estado ?? 'abierta'
    const decididaEn =
      p.decididaEn !== undefined
        ? fechaEntrada(p.decididaEn)
        : estado === 'aceptada' && base?.estado !== 'aceptada'
          ? new Date().toISOString()
          : base?.decididaEn ?? null
    await db.consulta(
      `insert into porques (tarjeta_id, motivo, contexto, opciones, decision, consecuencias, estado, evidencias,
          decidieron, decidida_en, revisar_en, reemplazada_por, actualizado_en)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       on conflict (tarjeta_id) do update set motivo = excluded.motivo, contexto = excluded.contexto,
          opciones = excluded.opciones, decision = excluded.decision, consecuencias = excluded.consecuencias,
          estado = excluded.estado, evidencias = excluded.evidencias, decidieron = excluded.decidieron,
          decidida_en = excluded.decidida_en, revisar_en = excluded.revisar_en,
          reemplazada_por = excluded.reemplazada_por, actualizado_en = now()`,
      [
        tarjetaId,
        p.motivo ?? base?.motivo ?? '',
        p.contexto ?? base?.contexto ?? '',
        JSON.stringify(p.opciones ?? base?.opciones ?? []),
        p.decision ?? base?.decision ?? '',
        p.consecuencias ?? base?.consecuencias ?? '',
        estado,
        JSON.stringify(p.evidencias ?? base?.evidencias ?? []),
        p.decidieron ?? base?.decidieron ?? [],
        decididaEn,
        p.revisarEn !== undefined ? fechaEntrada(p.revisarEn) : base?.revisarEn ?? null,
        reemplazadaPor,
      ],
    )
    return textoDelPorque({
      motivo: p.motivo ?? base?.motivo,
      contexto: p.contexto ?? base?.contexto,
      decision: p.decision ?? base?.decision,
      consecuencias: p.consecuencias ?? base?.consecuencias,
      opciones: p.opciones ?? base?.opciones,
    })
  }

  async registrarPorque(ctx: Ctx, ref: string, p: Partial<PorqueEntrada>): Promise<TarjetaResumen> {
    const t = await this.resolverTarjeta(ref)
    const [antes] = await this.db.consulta(`select estado from porques where tarjeta_id = $1`, [t.id])
    const textoGuardado = await this.db.transaccion(async (tx) => {
      const texto = await this.guardarPorque(tx, t.id, p)
      await this.tocarTarjeta(tx, t.id)
      await this.refrescarBusqueda(tx, t.id)
      return texto
    })
    const resumen =
      p.estado && p.estado !== antes?.estado
        ? `marcó el porqué de ${t.clave} como ${p.estado}`
        : antes
          ? `actualizó el porqué de ${t.clave}`
          : `registró el porqué de ${t.clave}`
    const act = await this.registrar(this.db, ctx, {
      accion: 'porque.registrado',
      resumen,
      proyectoId: t.proyecto_id,
      tableroId: t.tablero_id,
      tarjetaId: t.id,
      tarjetaClave: t.clave,
    })
    const resumenTarjeta = await this.emitirTarjeta(ctx, t.id, 'porque', act)
    // Menciones: solo si se tocó algún campo de texto del porqué (cambiar el estado no las vuelve a mirar).
    if (['motivo', 'contexto', 'decision', 'consecuencias', 'opciones'].some((k) => k in p))
      await this.avisarTextos(ctx, [
        { origen: { tipo: 'porque', id: t.id }, texto: textoGuardado, proyectoId: t.proyecto_id, tableroId: t.tablero_id, tarjetaId: t.id, tarjetaClave: t.clave, enVivo: true },
      ])
    return resumenTarjeta
  }

  // ───────────────────────── comentarios ─────────────────────────

  /**
   * Un comentario nuevo. `op.id` lo pone quien llama (la web, para que un reintento de red no cree dos): si ya existe, se
   * devuelve el que estaba (si es de otra tarjeta o de otra cuenta, 409). `op.respuestaA` es otro comentario de la MISMA tarjeta.
   * Con los ganchos conectados, las menciones se procesan después de guardar: el resultado vuelve en `menciones`, `trabajos` y `aviso`.
   */
  async comentar(
    ctx: Ctx,
    ref: string,
    cuerpo: string,
    op: { id?: string; respuestaA?: string | null; trabajoId?: string | null } = {},
  ): Promise<Comentario & { menciones?: Mencion[]; trabajos?: TrabajoResumen[]; aviso?: string }> {
    const texto = cuerpo.trim()
    if (!texto) throw new ErrorDominio('El comentario está vacío.')
    const t = await this.resolverTarjeta(ref)
    if (op.respuestaA) {
      const [r] = await this.db.consulta(`select 1 from comentarios where id = $1 and tarjeta_id = $2`, [op.respuestaA, t.id])
      if (!r) throw new ErrorDominio('No existe ese comentario en esta tarjeta.', 404)
    }
    const menciones = [...texto.matchAll(/@([\p{L}\d_.-]+)/gu)].map((m) => m[1]!)
    const id = op.id ?? nuevoId()
    let nuevo = true
    await this.db.transaccion(async (tx) => {
      const puesto = await tx.consulta(
        `insert into comentarios (id, tarjeta_id, autor, cuerpo, menciones, respuesta_a, trabajo_id) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do nothing returning id`,
        [id, t.id, ctx.actor, texto, menciones, op.respuestaA ?? null, op.trabajoId ?? null],
      )
      if (!puesto.length) {
        nuevo = false
        return
      }
      await this.tocarTarjeta(tx, t.id)
      await this.refrescarBusqueda(tx, t.id)
    })
    if (!nuevo) {
      // Ese id ya estaba: si es de esta tarjeta es un reintento (se devuelve el comentario que quedó); si no, es de otra cosa.
      const [ex] = await this.db.consulta(`select tarjeta_id from comentarios where id = $1`, [id])
      if (ex?.tarjeta_id !== t.id) throw new ErrorDominio('Ese id ya se usa: mandá el comentario sin id.', 409)
    } else {
      const act = await this.registrar(this.db, ctx, {
        accion: 'comentario.creado',
        resumen: `comentó en ${t.clave}: «${recortar(texto, 90)}»`,
        proyectoId: t.proyecto_id,
        tableroId: t.tablero_id,
        tarjetaId: t.id,
        tarjetaClave: t.clave,
      })
      await this.emitirTarjeta(ctx, t.id, 'comentario', act)
    }
    // Menciones. Un comentario de una persona sin «@» ni respuesta no cuesta ninguna consulta de más (el gancho mira primero un caché en
    // memoria de «¿esta cuenta tiene agentes?», para la conversación sin «@» del Anexo F.2); el de una IA sí mira (una) si estaba
    // atendiendo una mención pendiente.
    const extra =
      texto.includes('@') || op.respuestaA || ctx.actor.tipo === 'ia' || ctx.actor.tipo === 'humano'
        ? await this.avisarTextos(ctx, [
            { origen: { tipo: 'comentario', id }, texto, proyectoId: t.proyecto_id, tableroId: t.tablero_id, tarjetaId: t.id, tarjetaClave: t.clave, respuestaA: op.respuestaA ?? null, enVivo: false, nuevo },
          ])
        : null
    const [f] = await this.db.consulta(`select * from comentarios where id = $1`, [id])
    return { ...aComentario(f!), ...(extra ? limpiarExtra(extra) : {}) }
  }

  async editarComentario(ctx: Ctx, id: string, cuerpo: string): Promise<Comentario & { menciones?: Mencion[]; trabajos?: TrabajoResumen[]; aviso?: string }> {
    await this.propio('comentario', id)
    if (!cuerpo.trim()) throw new ErrorDominio('El comentario está vacío.')
    const [c] = await this.db.consulta(
      `update comentarios set cuerpo = $2, editado_en = now() where id = $1 returning *`,
      [id, cuerpo.trim()],
    )
    if (!c) throw new ErrorDominio('No existe ese comentario.', 404)
    await this.refrescarBusqueda(this.db, c.tarjeta_id)
    await this.emitirTarjeta(ctx, c.tarjeta_id, 'comentario')
    // Corre la regla de la cantidad: lo nuevo dispara, lo que se sacó del texto se retira. El resto de los datos (clave, tablero)
    // los completa la IA solo si crea una mención.
    const extra = await this.avisarTextos(ctx, [
      { origen: { tipo: 'comentario', id }, texto: c.cuerpo, proyectoId: null, tableroId: null, tarjetaId: c.tarjeta_id, tarjetaClave: null, respuestaA: c.respuesta_a ?? null, enVivo: false, nuevo: false },
    ])
    return { ...aComentario(c), ...(extra ? limpiarExtra(extra) : {}) }
  }

  async eliminarComentario(ctx: Ctx, id: string) {
    await this.propio('comentario', id)
    const [c] = await this.db.consulta(`delete from comentarios where id = $1 returning *`, [id])
    if (!c) throw new ErrorDominio('No existe ese comentario.', 404)
    await this.refrescarBusqueda(this.db, c.tarjeta_id)
    await this.emitirTarjeta(ctx, c.tarjeta_id, 'comentario')
    await this.avisarBorrados(ctx, [{ tipo: 'comentario', id }])
  }

  // ───────────────────────── checklists ─────────────────────────

  async crearChecklist(ctx: Ctx, ref: string, titulo: string, items: string[] = [], op: { silencioso?: boolean } = {}) {
    const t = await this.resolverTarjeta(ref)
    const id = nuevoId()
    await this.db.transaccion(async (tx) => {
      const [ultima] = await tx.consulta<{ orden: string }>(
        `select orden from checklists where tarjeta_id = $1 order by orden collate "C" desc limit 1`,
        [t.id],
      )
      await tx.consulta(`insert into checklists (id, tarjeta_id, titulo, orden) values ($1, $2, $3, $4)`, [
        id,
        t.id,
        titulo.trim() || 'Checklist',
        claveEntre(ultima?.orden ?? null, null),
      ])
      const claves = items.length ? generateNKeysBetween(null, null, items.length) : []
      for (const [i, texto] of items.entries())
        await tx.consulta(`insert into checklist_items (id, checklist_id, texto, orden) values ($1, $2, $3, $4)`, [
          nuevoId(),
          id,
          texto,
          claves[i],
        ])
      await this.tocarTarjeta(tx, t.id)
      await this.refrescarBusqueda(tx, t.id)
    })
    if (!op.silencioso) {
      const act = await this.registrar(this.db, ctx, {
        accion: 'checklist.creada',
        resumen: `agregó la checklist «${titulo.trim() || 'Checklist'}» a ${t.clave}`,
        proyectoId: t.proyecto_id,
        tableroId: t.tablero_id,
        tarjetaId: t.id,
        tarjetaClave: t.clave,
      })
      await this.emitirTarjeta(ctx, t.id, 'checklist', act)
    }
    return id
  }

  private async tarjetaDeChecklist(checklistId: string): Promise<Fila> {
    const [f] = await this.db.consulta(
      `select t.* from tarjetas t join checklists c on c.tarjeta_id = t.id join proyectos p on p.id = t.proyecto_id
        where c.id = $1 and p.propietario = $2`,
      [checklistId, this.cuenta],
    )
    if (!f) throw new ErrorDominio('No existe esa checklist.', 404)
    return f
  }

  async actualizarChecklist(ctx: Ctx, id: string, cambios: { titulo?: string; ocultarHechos?: boolean }) {
    const t = await this.tarjetaDeChecklist(id)
    await this.db.consulta(
      `update checklists set titulo = coalesce($2, titulo), ocultar_hechos = coalesce($3, ocultar_hechos) where id = $1`,
      [id, cambios.titulo?.trim() || null, cambios.ocultarHechos ?? null],
    )
    await this.tocarTarjeta(this.db, t.id)
    await this.emitirTarjeta(ctx, t.id, 'checklist')
  }

  async eliminarChecklist(ctx: Ctx, id: string) {
    const t = await this.tarjetaDeChecklist(id)
    const [c] = await this.db.consulta(`delete from checklists where id = $1 returning titulo`, [id])
    await this.tocarTarjeta(this.db, t.id)
    await this.refrescarBusqueda(this.db, t.id)
    const act = await this.registrar(this.db, ctx, {
      accion: 'checklist.eliminada',
      resumen: `quitó la checklist «${c?.titulo}» de ${t.clave}`,
      proyectoId: t.proyecto_id,
      tableroId: t.tablero_id,
      tarjetaId: t.id,
      tarjetaClave: t.clave,
    })
    await this.emitirTarjeta(ctx, t.id, 'checklist', act)
  }

  async agregarItem(ctx: Ctx, checklistId: string, texto: string, indice?: number) {
    const t = await this.tarjetaDeChecklist(checklistId)
    const lineas = texto
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lineas.length === 0) throw new ErrorDominio('El ítem está vacío.')
    const items = await this.db.consulta<{ orden: string }>(
      `select orden from checklist_items where checklist_id = $1 order by orden collate "C"`,
      [checklistId],
    )
    const i = indice === undefined ? items.length : Math.max(0, Math.min(indice, items.length))
    const claves = generateNKeysBetween(items[i - 1]?.orden ?? null, items[i]?.orden ?? null, lineas.length)
    // Pegar varias líneas crea varios ítems, como en Trello.
    for (const [k, l] of lineas.entries())
      await this.db.consulta(`insert into checklist_items (id, checklist_id, texto, orden) values ($1, $2, $3, $4)`, [
        nuevoId(),
        checklistId,
        l,
        claves[k],
      ])
    await this.tocarTarjeta(this.db, t.id)
    await this.refrescarBusqueda(this.db, t.id)
    await this.emitirTarjeta(ctx, t.id, 'checklist')
  }

  async actualizarItem(
    ctx: Ctx,
    itemId: string,
    cambios: { texto?: string; hecho?: boolean; responsableId?: string | null; vence?: string | null; indice?: number },
  ) {
    await this.propio('item', itemId)
    if (cambios.responsableId) await this.propio('miembro', cambios.responsableId)
    const [it] = await this.db.consulta(`select * from checklist_items where id = $1`, [itemId])
    if (!it) throw new ErrorDominio('No existe ese ítem.', 404)
    const t = await this.tarjetaDeChecklist(it.checklist_id)
    let orden: string = it.orden
    if (cambios.indice !== undefined) {
      const otros = await this.db.consulta<{ orden: string }>(
        `select orden from checklist_items where checklist_id = $1 and id <> $2 order by orden collate "C"`,
        [it.checklist_id, itemId],
      )
      const i = Math.max(0, Math.min(cambios.indice, otros.length))
      orden = claveEntre(otros[i - 1]?.orden ?? null, otros[i]?.orden ?? null)
    }
    await this.db.consulta(
      `update checklist_items set texto = coalesce($2, texto), hecho = coalesce($3, hecho),
         responsable_id = case when $4::boolean then $5 else responsable_id end,
         vence = case when $6::boolean then $7::timestamptz else vence end, orden = $8
       where id = $1`,
      [
        itemId,
        cambios.texto?.trim() || null,
        cambios.hecho ?? null,
        cambios.responsableId !== undefined,
        cambios.responsableId ?? null,
        cambios.vence !== undefined,
        fechaEntrada(cambios.vence ?? null),
        orden,
      ],
    )
    await this.tocarTarjeta(this.db, t.id)
    if (cambios.texto) await this.refrescarBusqueda(this.db, t.id)
    let act: Actividad | null = null
    if (cambios.hecho !== undefined)
      act = await this.registrar(this.db, ctx, {
        accion: 'checklist.item',
        resumen: `${cambios.hecho ? 'completó' : 'desmarcó'} «${recortar(it.texto, 60)}» en ${t.clave}`,
        proyectoId: t.proyecto_id,
        tableroId: t.tablero_id,
        tarjetaId: t.id,
        tarjetaClave: t.clave,
      })
    await this.emitirTarjeta(ctx, t.id, 'checklist', act)
  }

  async eliminarItem(ctx: Ctx, itemId: string) {
    await this.propio('item', itemId)
    const [it] = await this.db.consulta(`delete from checklist_items where id = $1 returning *`, [itemId])
    if (!it) throw new ErrorDominio('No existe ese ítem.', 404)
    const t = await this.tarjetaDeChecklist(it.checklist_id)
    await this.tocarTarjeta(this.db, t.id)
    await this.refrescarBusqueda(this.db, t.id)
    await this.emitirTarjeta(ctx, t.id, 'checklist')
  }

  /** Un ítem de checklist se vuelve tarjeta (hija de la original), con su fecha y su responsable. */
  async convertirItemEnTarjeta(ctx: Ctx, itemId: string): Promise<TarjetaResumen> {
    await this.propio('item', itemId)
    const [it] = await this.db.consulta(`select * from checklist_items where id = $1`, [itemId])
    if (!it) throw new ErrorDominio('No existe ese ítem.', 404)
    const t = await this.tarjetaDeChecklist(it.checklist_id)
    const nueva = await this.crearTarjeta(ctx, {
      tableroId: t.tablero_id,
      listaId: t.lista_id,
      titulo: it.texto,
      tipo: 'tarea',
      padre: t.id,
      vence: iso(it.vence),
      responsables: it.responsable_id ? [it.responsable_id] : [],
    })
    await this.db.consulta(`delete from checklist_items where id = $1`, [itemId])
    await this.tocarTarjeta(this.db, t.id)
    await this.emitirTarjeta(ctx, t.id, 'checklist')
    return nueva
  }

  // ───────────────────────── adjuntos ─────────────────────────

  private nombreSeguro(nombre: string) {
    const limpio = nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+/, '')
      .slice(-80)
    return limpio || 'archivo'
  }

  async agregarAdjunto(
    ctx: Ctx,
    ref: string,
    archivo: { nombre: string; datos?: Uint8Array; rutaOrigen?: string; mime?: string | null; descripcion?: string },
    op: { silencioso?: boolean; comoPortada?: boolean } = {},
  ) {
    const t = await this.resolverTarjeta(ref)
    const id = nuevoId()
    const datos = archivo.datos ?? (archivo.rutaOrigen ? new Uint8Array(readFileSync(archivo.rutaOrigen)) : null)
    if (!datos) throw new ErrorDominio('Falta el contenido del archivo.')
    const nombreArchivo = `${id}-${this.nombreSeguro(archivo.nombre)}`
    const ext = path.extname(archivo.nombre).toLowerCase()
    const mime = archivo.mime || MIMES[ext] || 'application/octet-stream'
    const esImagen = mime.startsWith('image/')
    const ruta = `${t.id}/${nombreArchivo}`
    await this.almacen.guardar(ruta, datos, mime)
    const tamano = datos.byteLength
    await this.db.consulta(
      `insert into adjuntos (id, tarjeta_id, nombre, ruta, mime, tamano, descripcion, es_imagen, creado_por)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, t.id, archivo.nombre, ruta, mime, tamano, archivo.descripcion ?? '', esImagen, ctx.actor],
    )
    if (esImagen && (op.comoPortada || (!t.portada && !op.silencioso))) {
      await this.db.consulta(`update tarjetas set portada = $2 where id = $1`, [
        t.id,
        { tipo: 'imagen', valor: `/archivos/${ruta}`, tamano: 'arriba' } satisfies Portada,
      ])
    }
    await this.tocarTarjeta(this.db, t.id)
    let act: Actividad | null = null
    if (!op.silencioso)
      act = await this.registrar(this.db, ctx, {
        accion: 'adjunto.creado',
        resumen: `adjuntó «${archivo.nombre}» a ${t.clave}`,
        proyectoId: t.proyecto_id,
        tableroId: t.tablero_id,
        tarjetaId: t.id,
        tarjetaClave: t.clave,
      })
    await this.emitirTarjeta(ctx, t.id, 'adjunto', act)
    const [f] = await this.db.consulta(`select * from adjuntos where id = $1`, [id])
    return aAdjunto(f!)
  }

  async eliminarAdjunto(ctx: Ctx, id: string) {
    await this.propio('adjunto', id)
    const [a] = await this.db.consulta(`delete from adjuntos where id = $1 returning *`, [id])
    if (!a) throw new ErrorDominio('No existe ese adjunto.', 404)
    // El archivo queda en disco (papelera implícita); se limpia aparte.
    const [t] = await this.db.consulta(`select * from tarjetas where id = $1`, [a.tarjeta_id])
    if (t?.portada?.valor === `/archivos/${a.ruta}`) await this.db.consulta(`update tarjetas set portada = null where id = $1`, [t.id])
    await this.tocarTarjeta(this.db, a.tarjeta_id)
    const act = await this.registrar(this.db, ctx, {
      accion: 'adjunto.eliminado',
      resumen: `quitó el adjunto «${a.nombre}» de ${t?.clave}`,
      proyectoId: t?.proyecto_id,
      tableroId: t?.tablero_id,
      tarjetaId: a.tarjeta_id,
      tarjetaClave: t?.clave,
    })
    await this.emitirTarjeta(ctx, a.tarjeta_id, 'adjunto', act)
  }

  // ───────────────────────── enlaces externos y vínculos ─────────────────────────

  private async insertarEnlace(db: Conexion, ctx: Ctx, tarjetaId: string, url: string, titulo?: string) {
    const limpio = url.trim()
    if (!/^https?:\/\//i.test(limpio)) throw new ErrorDominio(`«${url}» no parece un link (tiene que empezar con http).`)
    const a = analizarEnlace(limpio)
    await db.consulta(
      `insert into enlaces (id, tarjeta_id, tipo, url, titulo, datos, creado_por) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (tarjeta_id, url) do update set titulo = excluded.titulo`,
      [nuevoId(), tarjetaId, a.tipo, limpio, titulo?.trim() || a.titulo, a.datos, ctx.actor],
    )
    return a
  }

  async agregarEnlace(ctx: Ctx, ref: string, url: string, titulo?: string) {
    const t = await this.resolverTarjeta(ref)
    let analizado: ReturnType<typeof analizarEnlace> | null = null
    await this.db.transaccion(async (tx) => {
      analizado = await this.insertarEnlace(tx, ctx, t.id, url, titulo)
      await this.tocarTarjeta(tx, t.id)
      await this.refrescarBusqueda(tx, t.id)
    })
    const nombres: Record<string, string> = {
      github_issue: 'un issue de GitHub',
      github_pr: 'un PR de GitHub',
      github_commit: 'un commit',
      github_rama: 'una rama',
      github_repo: 'un repo de GitHub',
      figma: 'un diseño de Figma',
      discord: 'un mensaje de Discord',
      web: 'un link',
    }
    const act = await this.registrar(this.db, ctx, {
      accion: 'enlace.creado',
      resumen: `enlazó ${nombres[analizado!.tipo] ?? 'un link'} a ${t.clave}`,
      proyectoId: t.proyecto_id,
      tableroId: t.tablero_id,
      tarjetaId: t.id,
      tarjetaClave: t.clave,
      detalle: { url },
    })
    return this.emitirTarjeta(ctx, t.id, 'enlace', act)
  }

  async eliminarEnlace(ctx: Ctx, id: string) {
    await this.propio('enlace', id)
    const [e] = await this.db.consulta(`delete from enlaces where id = $1 returning *`, [id])
    if (!e) throw new ErrorDominio('No existe ese enlace.', 404)
    await this.tocarTarjeta(this.db, e.tarjeta_id)
    await this.refrescarBusqueda(this.db, e.tarjeta_id)
    return this.emitirTarjeta(ctx, e.tarjeta_id, 'enlace')
  }

  /**
   * Vincula dos tarjetas. "depende_de" se guarda como "bloquea" al revés: es el
   * mismo vínculo visto desde la otra punta.
   */
  async vincular(
    ctx: Ctx,
    ref: string,
    tipo: TipoVinculo | 'depende_de',
    conRef: string,
    nota = '',
  ): Promise<TarjetaResumen> {
    const a = await this.resolverTarjeta(ref)
    const b = await this.resolverTarjeta(conRef)
    if (a.id === b.id) throw new ErrorDominio('Una tarjeta no se puede vincular consigo misma.')
    const tiposValidos = ['bloquea', 'depende_de', 'relacionada', 'duplica', 'causa', 'implementa']
    if (!tiposValidos.includes(tipo)) throw new ErrorDominio(`Tipo de vínculo desconocido: ${tipo}. Tipos: ${tiposValidos.join(', ')}.`)
    const [origen, destino, t] = tipo === 'depende_de' ? [b, a, 'bloquea' as const] : [a, b, tipo]
    if (t === 'relacionada') {
      const [existe] = await this.db.consulta(
        `select id from vinculos where tipo = 'relacionada' and ((origen_id = $1 and destino_id = $2) or (origen_id = $2 and destino_id = $1))`,
        [a.id, b.id],
      )
      if (existe) return this.resumenTarjeta(a.id)
    }
    await this.db.consulta(
      `insert into vinculos (id, origen_id, destino_id, tipo, nota, creado_por) values ($1,$2,$3,$4,$5,$6)
       on conflict (origen_id, destino_id, tipo) do update set nota = excluded.nota`,
      [nuevoId(), origen.id, destino.id, t, nota, ctx.actor],
    )
    await this.tocarTarjeta(this.db, a.id)
    await this.tocarTarjeta(this.db, b.id)
    const texto = tipo === 'depende_de' ? 'depende de' : textoVinculo(t, 'ida')
    const act = await this.registrar(this.db, ctx, {
      accion: 'vinculo.creado',
      resumen: `vinculó ${a.clave} ${texto} ${b.clave}`,
      proyectoId: a.proyecto_id,
      tableroId: a.tablero_id,
      tarjetaId: a.id,
      tarjetaClave: a.clave,
    })
    await this.emitirTarjeta(ctx, b.id, 'vinculo')
    return this.emitirTarjeta(ctx, a.id, 'vinculo', act)
  }

  async desvincular(ctx: Ctx, id: string) {
    await this.propio('vinculo', id)
    const [v] = await this.db.consulta(`delete from vinculos where id = $1 returning *`, [id])
    if (!v) throw new ErrorDominio('No existe ese vínculo.', 404)
    await this.tocarTarjeta(this.db, v.origen_id)
    await this.tocarTarjeta(this.db, v.destino_id)
    await this.emitirTarjeta(ctx, v.destino_id, 'vinculo')
    return this.emitirTarjeta(ctx, v.origen_id, 'vinculo')
  }

  // ───────────────────────── lienzo ─────────────────────────

  private async emitirElemento(ctx: Ctx, accion: string, e: ElementoLienzo | { id: string; tableroId: string }, resumen?: string) {
    this.bus.publicar({ tipo: 'elemento', accion, tableroId: e.tableroId, actor: ctx.actor, clienteId: ctx.clienteId, resumen, datos: e })
  }

  async elementosDe(tableroId: string): Promise<ElementoLienzo[]> {
    await this.propio('tablero', tableroId)
    const filas = await this.db.consulta(
      `select * from elementos_lienzo where tablero_id = $1 and eliminado_en is null order by z, creado_en`,
      [tableroId],
    )
    return filas.map(aElemento)
  }

  async crearElemento(
    ctx: Ctx,
    tableroId: string,
    d: {
      id?: string
      tipo: TipoElemento
      x: number
      y: number
      ancho?: number
      alto?: number
      z?: number
      tarjetaId?: string | null
      listaId?: string | null
      datos?: Record<string, unknown>
      bloqueado?: boolean
    },
    op: { registrar?: boolean } = {},
  ): Promise<ElementoLienzo> {
    const tf = await this.tableroPropio(tableroId)
    // Lo que muestra (una tarjeta, una lista) tiene que ser de este tablero; un id ya usado, de este tablero (deshacer).
    if (d.tarjetaId) {
      const [t] = await this.db.consulta(`select 1 from tarjetas where id = $1 and tablero_id = $2`, [d.tarjetaId, tableroId])
      if (!t) throw new ErrorDominio('Esa tarjeta no es de este tablero.', 404)
    }
    if (d.listaId) {
      const [l] = await this.db.consulta(`select 1 from listas where id = $1 and tablero_id = $2`, [d.listaId, tableroId])
      if (!l) throw new ErrorDominio('Esa lista no es de este tablero.', 404)
    }
    let yaEstaba = false
    if (d.id) {
      const [e] = await this.db.consulta<{ tablero_id: string }>(`select tablero_id from elementos_lienzo where id = $1`, [d.id])
      if (e && e.tablero_id !== tableroId) throw new ErrorDominio('Ese id ya se usa: creá el objeto sin id.', 409)
      yaEstaba = Boolean(e)
    }
    if (!yaEstaba) await this.topeObjetos(1)
    const tam = TAMANOS[d.tipo]
    if (!tam) throw new ErrorDominio(`Tipo de elemento desconocido: ${d.tipo}.`)
    if (d.tipo === 'tarjeta' && !d.tarjetaId) throw new ErrorDominio('Falta la tarjeta para mostrar en el lienzo.')
    d = { ...d, datos: normalizarDatos(d.datos) }
    let z = d.z
    if (z === undefined) {
      const [m] = await this.db.consulta<{ z: number | null }>(
        `select max(z) as z from elementos_lienzo where tablero_id = $1 and eliminado_en is null`,
        [tableroId],
      )
      z = d.tipo === 'marco' ? 0 : Math.max(Number(m?.z ?? 0), 0) + 1
    }
    const id = d.id ?? nuevoId()
    const [f] = await this.db.consulta(
      `insert into elementos_lienzo (id, tablero_id, tipo, x, y, ancho, alto, z, tarjeta_id, lista_id, datos, creado_por, bloqueado)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (id) do update set eliminado_en = null, x = excluded.x, y = excluded.y, datos = excluded.datos,
         ancho = excluded.ancho, alto = excluded.alto, z = excluded.z, bloqueado = excluded.bloqueado,
         actualizado_en = now()
       where elementos_lienzo.tablero_id = excluded.tablero_id
       returning *`,
      [
        id,
        tableroId,
        d.tipo,
        Math.round(d.x),
        Math.round(d.y),
        Math.round(d.ancho ?? tam.ancho),
        Math.round(d.alto ?? tam.alto),
        z,
        d.tarjetaId ?? null,
        d.listaId ?? null,
        d.datos ?? {},
        ctx.actor,
        d.bloqueado ?? false,
      ],
    )
    if (!f) throw new ErrorDominio('Ese id ya se usa: creá el objeto sin id.', 409)
    const e = aElemento(f)
    let resumen: string | undefined
    if (op.registrar !== false && ctx.actor.tipo !== 'humano') {
      const nombres: Record<string, string> = {
        nota: 'una nota',
        texto: 'un texto',
        forma: 'una forma',
        marco: 'un marco',
        tarjeta: 'una tarjeta',
        lista: 'una lista',
        imagen: 'una imagen',
        enlace: 'un link',
        figma: 'un diseño de Figma',
        tabla: 'una tabla',
        grafico: 'un gráfico',
      }
      const act = await this.registrar(this.db, ctx, {
        accion: 'lienzo.agregado',
        resumen: `agregó ${nombres[d.tipo]} al lienzo${typeof d.datos?.texto === 'string' && d.datos.texto ? `: «${recortar(String(d.datos.texto), 60)}»` : ''}`,
        proyectoId: tf.proyecto_id,
        tableroId,
      })
      resumen = act.resumen
      this.publicarActividad(ctx, act)
    }
    await this.emitirElemento(ctx, 'creado', e, resumen)
    if (e.tarjetaId) await this.emitirTarjeta(ctx, e.tarjetaId, 'actualizada')
    await this.avisarTextos(ctx, this.textosDeElementos([e], { soloConArroba: true }).map((t) => ({ ...t, proyectoId: tf.proyecto_id as string })))
    return e
  }

  async actualizarElementos(
    ctx: Ctx,
    cambios: {
      id: string
      x?: number
      y?: number
      ancho?: number
      alto?: number
      z?: number
      datos?: Record<string, unknown>
      bloqueado?: boolean
    }[],
  ): Promise<ElementoLienzo[]> {
    await this.propios('elemento', cambios.map((c) => c.id))
    const salida: ElementoLienzo[] = []
    cambios = cambios.map((c) => (c.datos ? { ...c, datos: normalizarDatos(c.datos, { cambio: true }) } : c))
    await this.db.transaccion(async (tx) => {
      for (const c of cambios) {
        const [f] = await tx.consulta(
          `update elementos_lienzo set
             x = coalesce($2, x), y = coalesce($3, y), ancho = coalesce($4, ancho), alto = coalesce($5, alto),
             z = coalesce($6, z), datos = case when $7::jsonb is null then datos else datos || $7::jsonb end,
             bloqueado = coalesce($8, bloqueado), actualizado_en = now()
           where id = $1 and eliminado_en is null returning *`,
          [
            c.id,
            c.x ?? null,
            c.y ?? null,
            c.ancho ?? null,
            c.alto ?? null,
            c.z ?? null,
            c.datos ? JSON.stringify(c.datos) : null,
            c.bloqueado ?? null,
          ],
        )
        if (f) salida.push(aElemento(f))
      }
    })
    for (const e of salida) await this.emitirElemento(ctx, 'actualizado', e)
    // Menciones: solo de los objetos cuyo cambio trae texto (mover o cambiar el color no mira nada).
    const conTexto = new Set(cambios.filter((c) => c.datos && ('texto' in c.datos || 'rico' in c.datos)).map((c) => c.id))
    await this.avisarTextos(ctx, this.textosDeElementos(salida.filter((e) => conTexto.has(e.id))))
    return salida
  }


  // ───── tablas y gráficos del lienzo (compartido/tabla.ts y compartido/grafico.ts) ─────

  /** Los errores de las reglas de tablas (ErrorTabla) son errores de dominio: le llegan a la IA con el mensaje tal cual. */
  private convertirErrorTabla<T>(fn: () => T): T {
    try {
      return fn()
    } catch (e) {
      if (e instanceof ErrorTabla) throw new ErrorDominio(e.message)
      throw e
    }
  }

  private async proyectoDeTablero(tableroId: string): Promise<string | null> {
    const [t] = await this.db.consulta<{ proyecto_id: string }>(`select proyecto_id from tableros where id = $1`, [tableroId])
    return t?.proyecto_id ?? null
  }

  private async anotarLienzo(ctx: Ctx, e: ElementoLienzo, accion: string, resumen: string): Promise<string | undefined> {
    if (ctx.actor.tipo === 'humano') return undefined
    const act = await this.registrar(this.db, ctx, { accion, resumen, proyectoId: await this.proyectoDeTablero(e.tableroId), tableroId: e.tableroId })
    this.publicarActividad(ctx, act)
    return act.resumen
  }

  /** Una tabla nueva en el lienzo. Con `x` e `y` se pone ahí; si no, en un lugar libre (dentro de `marco` si se pide). */
  async crearTabla(
    ctx: Ctx,
    tableroId: string,
    p: {
      titulo?: string
      columnas: EntradaColumna[]
      filas?: EntradaFila[]
      orden?: { columna: string; direccion?: 'asc' | 'desc' } | null
      color?: Color
      cabecera?: DatosTabla['cabecera']
      rayas?: boolean
      numerosFila?: boolean
      marco?: string | null
      x?: number
      y?: number
      bloqueado?: boolean
    },
  ): Promise<{ elemento: ElementoLienzo; avisos: string[] }> {
    const { tabla, avisos } = this.convertirErrorTabla(() => armarTabla({ ...p, estricto: true }))
    const medida = medidaTabla(tabla)
    const lugar =
      typeof p.x === 'number' && typeof p.y === 'number'
        ? { x: p.x, y: p.y }
        : await this.lugarEnLienzo(ctx, tableroId, medida, p.marco)
    const elemento = await this.crearElemento(
      ctx,
      tableroId,
      { tipo: 'tabla', x: lugar.x, y: lugar.y, ancho: medida.ancho, alto: medida.alto, datos: tabla as unknown as Record<string, unknown>, bloqueado: p.bloqueado },
      { registrar: false },
    )
    await this.anotarLienzo(ctx, elemento, 'lienzo.tabla', `creó la tabla «${tabla.titulo || 'sin título'}» (${tabla.filas.length} filas, ${tabla.columnas.length} columnas)`)
    return { elemento, avisos }
  }

  /**
   * Cambia una tabla con operaciones (agregar filas, cambiar celdas, columnas, orden…). Todo o nada: si una falla no se
   * guarda ninguna. `estricto` (el MCP) corta con un mensaje claro ante un valor que no encaja; la web, no (lo deja vacío).
   */
  async operarTabla(
    ctx: Ctx,
    id: string,
    ops: OperacionTabla[],
    opciones: {
      estricto?: boolean
      cambios?: { titulo?: string; color?: Color; cabecera?: DatosTabla['cabecera']; rayas?: boolean; numerosFila?: boolean }
    } = {},
  ): Promise<{ elemento: ElementoLienzo; avisos: string[] }> {
    await this.propio('elemento', id)
    let avisos: string[] = []
    let antes = 0
    const elemento = await this.db.transaccion(async (tx) => {
      const [f] = await tx.consulta(
        `select * from elementos_lienzo where id = $1 and eliminado_en is null${this.db.tipo === 'postgres' ? ' for update' : ''}`,
        [id],
      )
      if (!f || f.tipo !== 'tabla') throw new ErrorDominio('Esa tabla no está en el lienzo.', 404)
      if (f.bloqueado) throw new ErrorDominio('La tabla está bloqueada: desbloqueala primero (actualizar_lienzo con bloqueado: false).')
      let t = leerTabla(f.datos as Record<string, unknown>)
      antes = t.filas.length
      if (opciones.cambios) t = leerTabla({ ...t, ...opciones.cambios } as unknown as Record<string, unknown>)
      const r = this.convertirErrorTabla(() => aplicarOperaciones(t, ops, { estricto: opciones.estricto }))
      avisos = r.avisos
      const m = medidaTabla(r.tabla)
      const [g] = await tx.consulta(
        `update elementos_lienzo set datos = $2::jsonb, ancho = $3, alto = $4, actualizado_en = now() where id = $1 returning *`,
        [id, JSON.stringify(r.tabla), m.ancho, m.alto],
      )
      return aElemento(g!)
    })
    const t = leerTabla(elemento.datos)
    const cuanto = t.filas.length - antes
    const detalle = cuanto > 0 ? `${cuanto} filas nuevas` : cuanto < 0 ? `${-cuanto} filas menos` : `${ops.length} cambios`
    const resumen = await this.anotarLienzo(ctx, elemento, 'lienzo.tabla', `cambió la tabla «${t.titulo || 'sin título'}»: ${detalle}`)
    await this.emitirElemento(ctx, 'actualizado', elemento, resumen)
    return { elemento, avisos }
  }

  /** Los datos de un gráfico a partir de lo que pidió la IA (o la web), sobre los que ya tenía. Valida la tabla y las columnas. */
  private async datosDeGrafico(
    tableroId: string,
    p: CambiosGrafico,
    base: DatosGrafico | null,
  ): Promise<{ datos: DatosGrafico; resuelto: GraficoResuelto }> {
    if (p.tabla !== undefined && p.datos !== undefined) throw new ErrorDominio('tabla y datos no van juntos: o el gráfico lee de una tabla del lienzo, o trae sus propios datos.')
    let g: DatosGrafico = base ? leerGrafico(base as unknown as Record<string, unknown>) : leerGrafico({})
    g = {
      ...g,
      titulo: p.titulo ?? g.titulo,
      tipo: p.tipo ?? g.tipo,
      apilado: p.apilado ?? g.apilado,
      leyenda: p.leyenda ?? g.leyenda,
      valores: p.valores ?? g.valores,
      colores: p.colores ?? g.colores,
    }
    const malo = problemaEnGrafico(g as unknown as Record<string, unknown>)
    if (malo) throw new ErrorDominio(`Dato inválido: ${malo}`)

    let tabla: DatosTabla | null = null
    if (p.datos !== undefined) {
      const propios = leerGrafico({ propios: p.datos }).propios
      if (!propios || !propios.categorias.length || !propios.series.length) throw new ErrorDominio('datos: hacen falta categorias y al menos una serie con valores.')
      g = { ...g, fuente: null, propios }
    } else if (p.tabla !== undefined || p.categoria !== undefined || p.series !== undefined || p.agrupar !== undefined || (!g.fuente && !g.propios)) {
      const elementos = await this.elementosDe(tableroId)
      const refTabla = p.tabla ?? (g.fuente ? g.fuente.tabla : undefined)
      if (!refTabla) throw new ErrorDominio('Falta de dónde salen los datos: pasá tabla (una tabla del lienzo) o datos (categorias y series).')
      const el = elementos.find((x) => x.id === refTabla) ?? (await this.resolverElemento(tableroId, refTabla))
      if (el.tipo !== 'tabla') throw new ErrorDominio(`«${refTabla}» no es una tabla (es ${articuloTipo(el.tipo)}). Un gráfico lee de una tabla del lienzo: creala con crear_tabla.`)
      tabla = leerTabla(el.datos)
      const sug = fuenteSugerida(tabla, el.id)
      const mismaTabla = g.fuente?.tabla === el.id
      const categoria = this.convertirErrorTabla(() => (p.categoria !== undefined ? columnaDe(tabla!, p.categoria).id : mismaTabla ? g.fuente!.categoria : sug?.categoria ?? tabla!.columnas[0]!.id))
      const columnasSerie = p.series !== undefined ? this.convertirErrorTabla(() => p.series!.map((r) => columnaDe(tabla!, r))) : null
      let series = columnasSerie ? columnasSerie.map((c) => c.id) : mismaTabla ? g.fuente!.series : sug?.series ?? []
      // Si se piden series y no se dice cómo agrupar, se suma (aunque antes el gráfico contara filas).
      let agrupar: Agrupar = p.agrupar ?? (p.series?.length ? 'suma' : mismaTabla ? g.fuente!.agrupar : sug?.agrupar ?? 'contar')
      if (agrupar === 'contar') series = []
      else if (!series.length) {
        if (p.agrupar === undefined) agrupar = 'contar'
        else throw new ErrorDominio(`Para ${agrupar === 'suma' ? 'sumar' : 'promediar'} hace falta al menos una serie (una columna numérica de «${el.datos.titulo ?? 'la tabla'}»).`)
      }
      for (const id of series) {
        const col = tabla.columnas.find((c) => c.id === id)
        if (col && !esNumerica(col.tipo))
          throw new ErrorDominio(`La serie «${col.nombre}» es de ${col.tipo}: un gráfico necesita columnas numero, moneda, porcentaje o duracion (o agrupar: "contar" para contar filas por categoría).`)
      }
      g = { ...g, fuente: { tabla: el.id, categoria, series: series.slice(0, 8), agrupar }, propios: null }
    } else if (g.fuente) {
      const el = (await this.elementosDe(tableroId)).find((x) => x.id === g.fuente!.tabla)
      tabla = el && el.tipo === 'tabla' ? leerTabla(el.datos) : null
    }
    return { datos: g, resuelto: resolverGrafico(g, tabla) }
  }

  /** Un gráfico nuevo: lee de una tabla del lienzo (`tabla`) o trae sus propios datos (`datos`). */
  async crearGrafico(
    ctx: Ctx,
    tableroId: string,
    p: CambiosGrafico & { tipo: TipoGrafico; marco?: string | null; x?: number; y?: number; ancho?: number; alto?: number; bloqueado?: boolean },
  ): Promise<{ elemento: ElementoLienzo; resuelto: GraficoResuelto }> {
    const { datos, resuelto } = await this.datosDeGrafico(tableroId, p, null)
    const tam = { ancho: p.ancho ?? TAMANOS.grafico.ancho, alto: p.alto ?? TAMANOS.grafico.alto }
    let lugar: { x: number; y: number }
    if (typeof p.x === 'number' && typeof p.y === 'number') lugar = { x: p.x, y: p.y }
    else if (!p.marco && datos.fuente) {
      // Sin marco ni posición: al lado de la tabla de la que lee.
      const t = (await this.elementosDe(tableroId)).find((x) => x.id === datos.fuente!.tabla)
      lugar = t ? { x: t.x + t.ancho + 48, y: t.y } : await this.lugarEnLienzo(ctx, tableroId, tam, null)
    } else lugar = await this.lugarEnLienzo(ctx, tableroId, tam, p.marco)
    const elemento = await this.crearElemento(
      ctx,
      tableroId,
      { tipo: 'grafico', x: lugar.x, y: lugar.y, ancho: tam.ancho, alto: tam.alto, datos: datos as unknown as Record<string, unknown>, bloqueado: p.bloqueado },
      { registrar: false },
    )
    await this.anotarLienzo(ctx, elemento, 'lienzo.grafico', `creó el gráfico «${datos.titulo || 'sin título'}»`)
    return { elemento, resuelto }
  }

  /** Cambia un gráfico (tipo, datos, estilo). Lo que no se pasa queda como estaba. */
  async actualizarGrafico(ctx: Ctx, id: string, p: CambiosGrafico): Promise<{ elemento: ElementoLienzo; resuelto: GraficoResuelto }> {
    await this.propio('elemento', id)
    const [f] = await this.db.consulta(`select * from elementos_lienzo where id = $1 and eliminado_en is null`, [id])
    if (!f || f.tipo !== 'grafico') throw new ErrorDominio('Ese gráfico no está en el lienzo.', 404)
    if (f.bloqueado) throw new ErrorDominio('El gráfico está bloqueado: desbloquealo primero (actualizar_lienzo con bloqueado: false).')
    const { datos, resuelto } = await this.datosDeGrafico(f.tablero_id as string, p, leerGrafico(f.datos as Record<string, unknown>))
    const [g] = await this.db.consulta(`update elementos_lienzo set datos = $2::jsonb, actualizado_en = now() where id = $1 returning *`, [id, JSON.stringify(datos)])
    const elemento = aElemento(g!)
    const resumen = await this.anotarLienzo(ctx, elemento, 'lienzo.grafico', `cambió el gráfico «${datos.titulo || 'sin título'}»`)
    await this.emitirElemento(ctx, 'actualizado', elemento, resumen)
    return { elemento, resuelto }
  }

  /** Borrado suave: se puede deshacer. Los conectores que tocaban esos elementos también se van. */
  async eliminarElementos(ctx: Ctx, ids: string[]) {
    if (ids.length === 0) return { elementos: [], conectores: [] }
    await this.propios('elemento', ids)
    const elementos = await this.db.consulta(
      `update elementos_lienzo set eliminado_en = now() where id = any($1::text[]) and eliminado_en is null returning *`,
      [ids],
    )
    const conectores = await this.db.consulta(
      `update conectores set eliminado_en = now()
        where (desde_id = any($1::text[]) or hasta_id = any($1::text[])) and eliminado_en is null returning *`,
      [ids],
    )
    for (const e of elementos) await this.emitirElemento(ctx, 'eliminado', { id: e.id, tableroId: e.tablero_id })
    for (const c of conectores)
      this.bus.publicar({ tipo: 'conector', accion: 'eliminado', tableroId: c.tablero_id, actor: ctx.actor, clienteId: ctx.clienteId, datos: { id: c.id, tableroId: c.tablero_id } })
    for (const e of elementos) if (e.tarjeta_id) await this.emitirTarjeta(ctx, e.tarjeta_id, 'actualizada')
    await this.avisarBorrados(ctx, elementos.filter((e) => ['nota', 'texto', 'forma'].includes(e.tipo)).map((e) => ({ tipo: 'nota' as const, id: e.id as string })))
    return { elementos: elementos.map((e) => e.id as string), conectores: conectores.map((c) => c.id as string) }
  }

  async restaurarElementos(ctx: Ctx, ids: string[], conectoresIds: string[] = []) {
    await this.propios('elemento', ids)
    await this.propios('conector', conectoresIds)
    const elementos = await this.db.consulta(
      `update elementos_lienzo set eliminado_en = null, actualizado_en = now() where id = any($1::text[]) returning *`,
      [ids],
    )
    const conectores = conectoresIds.length
      ? await this.db.consulta(
          `update conectores set eliminado_en = null, actualizado_en = now() where id = any($1::text[]) returning *`,
          [conectoresIds],
        )
      : []
    for (const e of elementos) await this.emitirElemento(ctx, 'creado', aElemento(e))
    for (const c of conectores)
      this.bus.publicar({ tipo: 'conector', accion: 'creado', tableroId: c.tablero_id, actor: ctx.actor, clienteId: ctx.clienteId, datos: aConector(c) })
    // Una nota que vuelve: la cantidad de menciones no cambió, así que lo ya atendido no dispara y lo que quedó retirado sin atender vuelve a pendiente.
    await this.avisarTextos(ctx, this.textosDeElementos(elementos.map(aElemento), { soloConArroba: true }))
    return { elementos: elementos.map(aElemento), conectores: conectores.map(aConector) }
  }

  /**
   * Convierte una nota, un texto o una forma en otra cosa (otra de esas tres, o una tarjeta del Kanban): crea el objeto
   * nuevo en el mismo lugar, le pasa los conectores y borra (suave) el viejo, en una transacción. Con `a: 'tarjeta'`
   * primero crea la tarjeta (título: la primera línea, hasta 120 caracteres; el resto, la descripción) en la lista
   * pedida o en la primera "por hacer".
   */
  async convertirElemento(
    ctx: Ctx,
    id: string,
    a: 'tarjeta' | 'nota' | 'texto' | 'forma',
    listaId?: string | null,
  ): Promise<{ elemento: ElementoLienzo; conectores: Conector[]; tarjeta: TarjetaResumen | null; viejo: string }> {
    await this.propio('elemento', id)
    const [f] = await this.db.consulta(`select * from elementos_lienzo where id = $1 and eliminado_en is null`, [id])
    if (!f) throw new ErrorDominio('Ese objeto ya no está en el lienzo.', 404)
    const viejo = aElemento(f)
    if (listaId) {
      const [l] = await this.db.consulta(`select 1 from listas where id = $1 and tablero_id = $2`, [listaId, viejo.tableroId])
      if (!l) throw new ErrorDominio('Esa lista no es de este tablero.', 404)
    }
    if (viejo.tipo !== 'nota' && viejo.tipo !== 'texto' && viejo.tipo !== 'forma')
      throw new ErrorDominio('Solo se convierten notas, textos y formas.')
    if (viejo.tipo === a) throw new ErrorDominio(`Ya es ${a === 'nota' ? 'una nota' : a === 'texto' ? 'un texto' : 'una forma'}.`)
    const plano = typeof viejo.datos.texto === 'string' ? viejo.datos.texto : ''
    const rico = esDocRico(viejo.datos.rico) ? viejo.datos.rico : undefined
    const estilo = viejo.tipo === 'nota' ? leerNota(viejo.datos) : viejo.tipo === 'forma' ? leerForma(viejo.datos) : leerTexto(viejo.datos)
    const colorDe = viejo.tipo === 'nota' ? leerNota(viejo.datos).color : viejo.tipo === 'forma' ? leerForma(viejo.datos).relleno : leerTexto(viejo.datos).fondo
    const comun = {
      texto: plano,
      ...(rico ? { rico } : {}),
      fuente: estilo.fuente,
      alineacion: estilo.alineacion,
      colorTexto: estilo.colorTexto,
    }

    let tarjeta: TarjetaResumen | null = null
    let nuevo: { tipo: TipoElemento; ancho: number; alto: number; datos: Record<string, unknown>; tarjetaId?: string }
    if (a === 'tarjeta') {
      // La primera línea con algo (sin la marca de lista) es el título; lo que sobra, la descripción.
      const lineas = plano.split('\n').map((l) => l.replace(/^\s*(?:[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+\.\s+)/, ''))
      const i = lineas.findIndex((l) => l.trim())
      if (i === -1) throw new ErrorDominio('Está vacía: escribile algo antes de convertirla en tarjeta.')
      const primera = lineas[i]!.trim()
      const titulo = primera.length > 120 ? `${primera.slice(0, 119).trimEnd()}…` : primera
      const descripcion = [primera.length > 120 ? `…${primera.slice(119)}` : '', ...lineas.slice(i + 1)].join('\n').trim()
      let lista = listaId ?? null
      if (!lista) {
        const [l] = await this.db.consulta<{ id: string }>(
          `select id from listas where tablero_id = $1 and not archivada
            order by (categoria = 'por_hacer') desc nulls last, orden collate "C" limit 1`,
          [viejo.tableroId],
        )
        lista = l?.id ?? null
      }
      tarjeta = await this.crearTarjeta(ctx, { tableroId: viejo.tableroId, listaId: lista, titulo, descripcion })
      // Del ancho de lo que era (entre 220 y 560, lo que admite una tarjeta): el lugar queda igual de ordenado.
      nuevo = {
        tipo: 'tarjeta',
        ancho: Math.round(Math.max(220, Math.min(ANCHO_MAX_TARJETA, viejo.ancho || ANCHO_TARJETA.normal))),
        alto: TAMANOS.tarjeta.alto,
        datos: {},
        tarjetaId: tarjeta.id,
      }
    } else if (a === 'nota') {
      const lado = Math.round(Math.min(480, Math.max(160, viejo.tipo === 'texto' ? viejo.ancho : Math.max(viejo.ancho, viejo.alto))))
      nuevo = {
        tipo: 'nota',
        ancho: viejo.tipo === 'forma' ? viejo.ancho : lado,
        alto: viejo.tipo === 'forma' ? viejo.alto : lado,
        datos: {
          ...comun,
          color: colorDe && colorDe !== 'ninguno' ? colorDe : ESTILOS_FABRICA.nota.color,
          tamano: 'auto',
          alineacionV: viejo.tipo === 'forma' ? estilo.alineacionV : 'medio',
          interlineado: viejo.tipo === 'texto' ? ESTILOS_FABRICA.nota.interlineado : estilo.interlineado,
        },
      }
    } else if (a === 'forma') {
      nuevo = {
        tipo: 'forma',
        ancho: viejo.ancho,
        alto: viejo.tipo === 'texto' ? Math.max(80, viejo.alto + 24) : viejo.alto,
        datos: {
          ...comun,
          forma: ESTILOS_FABRICA.forma.forma,
          relleno: colorDe && colorDe !== 'ninguno' ? colorDe : ESTILOS_FABRICA.forma.relleno,
          tamano: estilo.tamano,
          alineacionV: viejo.tipo === 'texto' ? 'medio' : estilo.alineacionV,
          interlineado: estilo.interlineado,
        },
      }
    } else {
      // A texto: con el mismo ancho (fijo), y la letra en un número (el automático de la nota pasa a 21).
      nuevo = {
        tipo: 'texto',
        ancho: viejo.ancho,
        alto: viejo.alto,
        datos: {
          ...comun,
          tamano: typeof estilo.tamano === 'number' ? estilo.tamano : ESTILOS_FABRICA.texto.tamano,
          interlineado: estilo.interlineado,
          anchoAuto: false,
          fondo: null,
        },
      }
    }

    const nuevoIdElemento = nuevoId()
    let elemento!: ElementoLienzo
    let conectores: Conector[] = []
    try {
      await this.db.transaccion(async (tx) => {
        const [fn] = await tx.consulta(
          `insert into elementos_lienzo (id, tablero_id, tipo, x, y, ancho, alto, z, tarjeta_id, lista_id, datos, creado_por, bloqueado)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,null,$10,$11,false) returning *`,
          [
            nuevoIdElemento,
            viejo.tableroId,
            nuevo.tipo,
            viejo.x,
            viejo.y,
            Math.round(nuevo.ancho),
            Math.round(nuevo.alto),
            viejo.z,
            nuevo.tarjetaId ?? null,
            normalizarDatos(nuevo.datos) ?? {},
            ctx.actor,
          ],
        )
        elemento = aElemento(fn!)
        const cs = await tx.consulta(
          `update conectores set
             desde_id = case when desde_id = $1 then $2 else desde_id end,
             hasta_id = case when hasta_id = $1 then $2 else hasta_id end,
             actualizado_en = now()
           where (desde_id = $1 or hasta_id = $1) and eliminado_en is null returning *`,
          [id, nuevoIdElemento],
        )
        conectores = cs.map(aConector)
        await tx.consulta(`update elementos_lienzo set eliminado_en = now() where id = $1`, [id])
      })
    } catch (e) {
      // Si no se pudo convertir, la tarjeta recién creada no queda suelta en el Kanban.
      if (tarjeta) await this.archivarTarjeta(ctx, tarjeta.id, true).catch(() => {})
      throw e
    }
    await this.emitirElemento(ctx, 'eliminado', { id, tableroId: viejo.tableroId })
    await this.emitirElemento(ctx, 'creado', elemento)
    for (const c of conectores)
      this.bus.publicar({ tipo: 'conector', accion: 'actualizado', tableroId: c.tableroId, actor: ctx.actor, clienteId: ctx.clienteId, datos: c })
    if (tarjeta) tarjeta = await this.emitirTarjeta(ctx, tarjeta.id, 'actualizada')
    return { elemento, conectores, tarjeta, viejo: id }
  }

  async crearConector(
    ctx: Ctx,
    tableroId: string,
    d: {
      id?: string
      desdeId: string
      hastaId: string
      desdeLado?: Lado | null
      hastaLado?: Lado | null
      trazo?: Trazo
      puntaInicio?: Punta
      puntaFin?: Punta
      guion?: Guion
      color?: Color | null
      grosor?: number
      etiqueta?: string
    },
    op: { registrar?: boolean } = {},
  ): Promise<Conector> {
    if (d.desdeId === d.hastaId) throw new ErrorDominio('Un conector necesita dos objetos distintos.')
    await this.tableroPropio(tableroId)
    if (d.id) {
      const [e] = await this.db.consulta<{ tablero_id: string }>(`select tablero_id from conectores where id = $1`, [d.id])
      if (e && e.tablero_id !== tableroId) throw new ErrorDominio('Ese id ya se usa: creá el conector sin id.', 409)
    }
    const extremos = await this.db.consulta(
      `select id from elementos_lienzo where id = any($1::text[]) and tablero_id = $2 and eliminado_en is null`,
      [[d.desdeId, d.hastaId], tableroId],
    )
    if (extremos.length < 2) throw new ErrorDominio('Los dos extremos del conector tienen que estar en el lienzo de este tablero.', 404)
    const [f] = await this.db.consulta(
      `insert into conectores (id, tablero_id, desde_id, desde_lado, hasta_id, hasta_lado, trazo, punta_inicio, punta_fin,
          color, grosor, etiqueta, creado_por, guion)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (id) do update set eliminado_en = null, actualizado_en = now()
       where conectores.tablero_id = excluded.tablero_id
       returning *`,
      [
        d.id ?? nuevoId(),
        tableroId,
        d.desdeId,
        d.desdeLado ?? null,
        d.hastaId,
        d.hastaLado ?? null,
        d.trazo ?? 'curvo',
        d.puntaInicio ?? 'ninguna',
        d.puntaFin ?? 'flecha',
        d.color ?? null,
        d.grosor ?? 2,
        d.etiqueta ?? '',
        ctx.actor,
        d.guion ?? 'solido',
      ],
    )
    if (!f) throw new ErrorDominio('Ese id ya se usa: creá el conector sin id.', 409)
    const c = aConector(f)
    let resumen: string | undefined
    if (op.registrar !== false && ctx.actor.tipo !== 'humano') {
      const [tf] = await this.db.consulta(`select proyecto_id from tableros where id = $1`, [tableroId])
      const act = await this.registrar(this.db, ctx, {
        accion: 'lienzo.conectado',
        resumen: `conectó dos objetos del lienzo${c.etiqueta ? ` («${recortar(c.etiqueta, 40)}»)` : ''}`,
        proyectoId: tf?.proyecto_id,
        tableroId,
      })
      resumen = act.resumen
      this.publicarActividad(ctx, act)
    }
    this.bus.publicar({ tipo: 'conector', accion: 'creado', tableroId, actor: ctx.actor, clienteId: ctx.clienteId, resumen, datos: c })
    return c
  }

  async actualizarConector(
    ctx: Ctx,
    id: string,
    cambios: Partial<
      Pick<Conector, 'trazo' | 'puntaInicio' | 'puntaFin' | 'guion' | 'color' | 'grosor' | 'etiqueta' | 'desdeLado' | 'hastaLado' | 'desdeId' | 'hastaId'>
    >,
  ): Promise<Conector> {
    await this.propio('conector', id)
    if (cambios.desdeId || cambios.hastaId) {
      const [c] = await this.db.consulta<{ tablero_id: string }>(`select tablero_id from conectores where id = $1`, [id])
      const extremos = [cambios.desdeId, cambios.hastaId].filter((x): x is string => Boolean(x))
      const [n] = await this.db.consulta<{ n: number }>(
        `select count(*)::int as n from elementos_lienzo where id = any($1::text[]) and tablero_id = $2 and eliminado_en is null`,
        [extremos, c!.tablero_id],
      )
      if (Number(n?.n ?? 0) !== new Set(extremos).size) throw new ErrorDominio('Los dos extremos del conector tienen que estar en el lienzo de este tablero.', 404)
    }
    const [f] = await this.db.consulta(
      `update conectores set trazo = coalesce($2, trazo), punta_inicio = coalesce($3, punta_inicio),
         punta_fin = coalesce($4, punta_fin), color = case when $5::boolean then $6 else color end,
         grosor = coalesce($7, grosor), etiqueta = coalesce($8, etiqueta),
         desde_lado = case when $9::boolean then $10 else desde_lado end,
         hasta_lado = case when $11::boolean then $12 else hasta_lado end,
         desde_id = coalesce($13, desde_id), hasta_id = coalesce($14, hasta_id),
         guion = coalesce($15, guion),
         actualizado_en = now()
       where id = $1 returning *`,
      [
        id,
        cambios.trazo ?? null,
        cambios.puntaInicio ?? null,
        cambios.puntaFin ?? null,
        cambios.color !== undefined,
        cambios.color ?? null,
        cambios.grosor ?? null,
        cambios.etiqueta ?? null,
        cambios.desdeLado !== undefined,
        cambios.desdeLado ?? null,
        cambios.hastaLado !== undefined,
        cambios.hastaLado ?? null,
        cambios.desdeId ?? null,
        cambios.hastaId ?? null,
        cambios.guion ?? null,
      ],
    )
    if (!f) throw new ErrorDominio('No existe ese conector.', 404)
    const c = aConector(f)
    this.bus.publicar({ tipo: 'conector', accion: 'actualizado', tableroId: c.tableroId, actor: ctx.actor, clienteId: ctx.clienteId, datos: c })
    return c
  }

  async eliminarConectores(ctx: Ctx, ids: string[]) {
    await this.propios('conector', ids)
    const filas = await this.db.consulta(
      `update conectores set eliminado_en = now() where id = any($1::text[]) and eliminado_en is null returning *`,
      [ids],
    )
    for (const c of filas)
      this.bus.publicar({ tipo: 'conector', accion: 'eliminado', tableroId: c.tablero_id, actor: ctx.actor, clienteId: ctx.clienteId, datos: { id: c.id, tableroId: c.tablero_id } })
    return filas.map((c) => c.id as string)
  }

  /** Busca un objeto del lienzo por id, por clave de tarjeta o por el texto de una nota o el título de un marco. */
  async resolverElemento(tableroId: string, ref: string): Promise<ElementoLienzo> {
    const elementos = await this.elementosDe(tableroId)
    const porId = elementos.find((e) => e.id === ref)
    if (porId) return porId
    if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(ref.trim())) {
      const t = await this.resolverTarjeta(ref)
      const e = elementos.find((x) => x.tarjetaId === t.id)
      if (e) return e
      throw new ErrorDominio(`La tarjeta ${t.clave} no está en el lienzo. Agregala primero con tipo "tarjeta".`, 404)
    }
    const r = normalizar(ref.trim())
    const texto = (e: ElementoLienzo) => normalizar(String(e.datos.titulo ?? e.datos.texto ?? ''))
    const exactos = elementos.filter((x) => texto(x) === r)
    const candidatos = exactos.length ? exactos : r ? elementos.filter((x) => texto(x).startsWith(r)) : []
    if (!candidatos.length)
      throw new ErrorDominio(
        `No encontré «${ref}» en el lienzo. Nombralo por su id (los da leer_lienzo), por la clave de su tarjeta (RC-12), por el texto de una nota o por el título de un marco.`,
        404,
      )
    // Dos objetos con el mismo texto: mejor preguntar que cambiar el que no era.
    if (candidatos.length > 1) {
      const marcos = elementos.filter((m) => m.tipo === 'marco')
      const cuales = candidatos.slice(0, 5).map((x) => {
        const m = x.tipo === 'marco' ? null : marcoDe(x, marcos)
        return `${x.id} (${articuloTipo(x.tipo)}${m ? ` en «${String(m.datos.titulo ?? '')}»` : ''})`
      })
      throw new ErrorDominio(`Hay ${candidatos.length} objetos que dicen «${ref}»: ${cuales.join(', ')}. Usá el id del que querés.`, 409)
    }
    return candidatos[0]!
  }

  /**
   * Un lugar libre para algo de ese tamaño: adentro de un marco (por id o título; si está lleno, el marco crece hacia
   * abajo) o, sin marco, a la derecha de lo que ya hay. Lo usan agregar y armar en el lienzo (MCP).
   */
  async lugarEnLienzo(
    ctx: Ctx,
    tableroId: string,
    tam: { ancho: number; alto: number },
    marcoRef?: string | null,
    elementos?: ElementoLienzo[],
  ): Promise<{ x: number; y: number; marco: ElementoLienzo | null }> {
    const todos = elementos ?? (await this.elementosDe(tableroId))
    if (marcoRef) {
      const marco = await this.resolverElemento(tableroId, marcoRef)
      if (marco.tipo !== 'marco') throw new ErrorDominio(`«${marcoRef}» no es un marco (es ${articuloTipo(marco.tipo)}). Pasá el título o el id de un marco.`)
      const interior = interiorMarco(marco)
      const ocupados = todos.filter((e) => e.id !== marco.id && marcoDe(e, [marco]))
      let lugar = buscarLugar(interior, tam, ocupados)
      if (!lugar) {
        // El marco está lleno (o lo nuevo no entra a lo ancho): crece hacia abajo y, si hace falta, a lo ancho.
        const abajo = limites(ocupados)
        const nuevoY = (abajo ? abajo.y + abajo.alto : interior.y) + 28
        lugar = { x: interior.x, y: nuevoY }
        const alto = nuevoY + tam.alto + 40 - marco.y
        const ancho = interior.x + tam.ancho + 40 - marco.x
        await this.actualizarElementos(ctx, [{ id: marco.id, alto: Math.max(marco.alto, alto), ancho: Math.max(marco.ancho, ancho) }])
      }
      return { ...lugar, marco }
    }
    const caja = limites(todos)
    const area = caja
      ? { x: caja.x + caja.ancho + 120, y: caja.y, ancho: Math.max(tam.ancho * 3 + 120, 900), alto: 40000 }
      : { x: 0, y: 0, ancho: Math.max(2400, tam.ancho + 40), alto: 40000 }
    return { ...(buscarLugar(area, tam, todos) ?? { x: area.x, y: area.y }), marco: null }
  }

  /**
   * Los datos y el tamaño de un objeto nuevo del MCP: el texto llega en Markdown (se guarda enriquecido y en plano),
   * el estilo en las claves de `datos` (fuente, tamano, forma, relleno…), y el tamaño se estima si no se pide.
   */
  private async armarObjeto(
    tableroId: string,
    p: NuevoObjetoLienzo,
    elementos: ElementoLienzo[],
  ): Promise<ObjetoArmado> {
    const tam = { ...TAMANOS[p.tipo] }
    const estilo = { ...(p.estilo ?? {}) }
    const datos: Record<string, unknown> = {}
    let tarjetaId: string | null = null
    let listaId: string | null = null
    const conTexto = p.tipo === 'nota' || p.tipo === 'texto' || p.tipo === 'forma'
    if (conTexto) {
      const md = p.texto ?? ''
      // El texto es Markdown: negrita, cursiva, tachado, <u>subrayado</u>, enlaces, listas, tareas y títulos (# y ##).
      if (p.markdown === false) datos.texto = md
      else datos.rico = docDesdeMarkdown(md)
      // Con listas, el texto va a la izquierda (centradas, las viñetas quedan desparejas), salvo que se pida otra cosa.
      const conListas = ((datos.rico as { content?: { type: string }[] } | undefined)?.content ?? []).some((b) => /List$/.test(b.type))
      if (conListas && p.tipo !== 'texto' && estilo.alineacion === undefined) estilo.alineacion = 'izquierda'
    }
    switch (p.tipo) {
      case 'nota':
        datos.color = estilo.color ?? ESTILOS_FABRICA.nota.color
        break
      case 'texto': {
        const px = typeof estilo.tamano === 'number' ? estilo.tamano : ESTILOS_FABRICA.texto.tamano
        const inter = Math.max(typeof estilo.interlineado === 'number' ? estilo.interlineado : 1.3, pesoPorTamano(Number(px)).interlineadoMin)
        const plano = datos.rico ? textoPlano(datos.rico as never) : String(datos.texto ?? '')
        const largo = Math.max(...plano.split('\n').map((r) => r.length))
        // Un renglón largo en ancho automático sería una sola línea kilométrica: pasa a ancho fijo y corta solo.
        const fijo = p.ancho !== undefined || largo > 48
        const ancho = p.ancho ?? (fijo ? 480 : undefined)
        const m = medidaTexto(plano, Number(px), inter, ancho)
        tam.ancho = ancho ?? Math.max(60, m.ancho)
        tam.alto = Math.max(TAMANOS.texto.alto * (Number(px) / 21) * 0.6, m.alto)
        datos.anchoAuto = !fijo
        break
      }
      case 'forma': {
        datos.forma = estilo.forma ?? ESTILOS_FABRICA.forma.forma
        datos.relleno = estilo.relleno ?? estilo.color ?? ESTILOS_FABRICA.forma.relleno
        delete estilo.color
        // Si el texto no entra en el alto de fábrica, la forma sale más alta (la web la ajusta al dibujarla).
        const plano = datos.rico ? textoPlano(datos.rico as never) : String(datos.texto ?? '')
        const px = typeof estilo.tamano === 'number' ? estilo.tamano : 16
        const m = medidaTexto(plano, px, 1.3, (p.ancho ?? tam.ancho) * 0.7)
        if (!p.alto && m.alto > tam.alto * 0.62) tam.alto = Math.ceil(m.alto / 0.62)
        break
      }
      case 'marco':
        datos.titulo = p.titulo ?? p.texto ?? 'Marco'
        datos.color = estilo.color ?? ESTILOS_FABRICA.marco.color
        break
      case 'tarjeta': {
        if (!p.tarjeta) throw new ErrorDominio('Para poner una tarjeta en el lienzo hace falta su clave (por ejemplo RC-12) en "tarjeta".')
        const t = await this.resolverTarjeta(p.tarjeta)
        if (t.tablero_id !== tableroId) throw new ErrorDominio(`${t.clave} es de otro tablero: solo se pueden poner tarjetas del mismo tablero.`)
        const ya = elementos.find((e) => e.tarjetaId === t.id)
        if (ya) return { datos: {}, ancho: ya.ancho, alto: ya.alto, tarjetaId: t.id, listaId: null, existente: ya }
        tarjetaId = t.id
        const variante = (estilo.variante as keyof typeof ANCHO_TARJETA | undefined) ?? 'normal'
        tam.ancho = ANCHO_TARJETA[variante]
        // El alto real depende de la portada y de las etiquetas: se estima para no encimar.
        const [n] = await this.db.consulta<{ n: number }>(`select count(*)::int as n from tarjeta_etiquetas where tarjeta_id = $1`, [t.id])
        tam.alto =
          (variante === 'compacta' ? 56 : (t.portada?.tipo === 'imagen' ? 250 : t.portada ? 128 : 120) + ((n?.n ?? 0) > 0 ? 26 : 0)) +
          (String(t.titulo).length > 60 ? 20 : 0) +
          (variante === 'expandida' ? 90 : 0)
        break
      }
      case 'lista': {
        if (!p.lista) throw new ErrorDominio('Para poner una lista del Kanban en el lienzo hace falta su nombre en "lista".')
        const l = await this.resolverLista(tableroId, p.lista)
        if (elementos.some((e) => e.listaId === l.id)) throw new ErrorDominio(`La lista «${l.nombre}» ya está en el lienzo.`, 409)
        listaId = l.id
        break
      }
      case 'enlace':
      case 'figma':
      case 'imagen':
        if (!p.url) throw new ErrorDominio(`Para ${p.tipo === 'imagen' ? 'una imagen' : p.tipo === 'figma' ? 'un diseño de Figma' : 'un link'} hace falta "url".`)
        if (!/^https?:\/\//i.test(p.url)) throw new ErrorDominio('El link tiene que empezar con https:// (o http://).')
        datos.url = p.url
        datos.titulo = p.titulo ?? analizarEnlace(p.url).titulo
        break
    }
    // El resto del estilo va tal cual (normalizarDatos lo valida al guardar).
    for (const [k, v] of Object.entries(estilo)) if (v !== undefined && !(k in datos) && k !== 'color') datos[k] = v
    if (p.tipo === 'marco' && estilo.relleno) datos.relleno = estilo.relleno as RellenoMarco
    if (p.ancho) tam.ancho = p.ancho
    if (p.alto) tam.alto = p.alto
    return { datos, ancho: Math.round(tam.ancho), alto: Math.round(tam.alto), tarjetaId, listaId }
  }

  /**
   * Agrega algo al lienzo buscando lugar solo: adentro de un marco (por nombre) o a la derecha de lo que ya hay.
   * Es lo que usa el MCP (y crear_tarjeta con "en_lienzo").
   */
  async agregarAlLienzo(ctx: Ctx, tableroId: string, p: NuevoObjetoLienzo & { marco?: string; x?: number; y?: number; bloqueado?: boolean }): Promise<ElementoLienzo> {
    const elementos = await this.elementosDe(tableroId)
    const o = await this.armarObjeto(tableroId, p, elementos)
    if (o.existente) return o.existente
    let { x, y } = p
    if (x === undefined || y === undefined) {
      const lugar = await this.lugarEnLienzo(ctx, tableroId, { ancho: o.ancho, alto: o.alto }, p.marco, elementos)
      x = x ?? lugar.x
      y = y ?? lugar.y
    }
    return this.crearElemento(ctx, tableroId, {
      tipo: p.tipo,
      x,
      y,
      ancho: o.ancho,
      alto: o.alto,
      tarjetaId: o.tarjetaId,
      listaId: o.listaId,
      datos: o.datos,
      bloqueado: p.bloqueado,
    })
  }

  /**
   * Arma varios objetos de una vez (hasta MAX_OBJETOS_ARMAR), ordenados en fila, columna, grilla o flujo, con sus conectores
   * (que se refieren a ellos por `ref` o a lo que ya está en el lienzo), adentro de un marco que ya existe, de uno nuevo que los
   * rodea o sueltos. Con `posiciones: 'marco'` o `'lienzo'` cada objeto va EXACTAMENTE donde se pidió (relativo a la esquina del
   * marco, o absoluto) sin buscar lugar ni correr nada: el marco crece si hace falta y se avisa de lo que quedó encimado.
   * Todo o nada (una transacción, dos inserciones en bloque) y un solo evento en vivo y una sola entrada en la actividad.
   */
  async armarEnLienzo(
    ctx: Ctx,
    tableroId: string,
    plan: {
      objetos: (NuevoObjetoLienzo & { ref?: string; x?: number; y?: number })[]
      conectores?: { desde: string; hasta: string; etiqueta?: string; estilo?: EstiloConectorEntrada }[]
      marco?: string
      nuevoMarco?: { titulo: string; color?: Color; relleno?: RellenoMarco; tituloEn?: string }
      posiciones?: 'grupo' | 'marco' | 'lienzo'
      disposicion?: Disposicion
      separacion?: number
      columnas?: number
    },
  ): Promise<{ marco: ElementoLienzo | null; objetos: { ref: string; elemento: ElementoLienzo }[]; conectores: Conector[]; avisos: string[] }> {
    if (plan.marco && plan.nuevoMarco) throw new ErrorDominio('Mandá "marco" (uno que ya existe) o "nuevo_marco" (uno que se crea alrededor), no los dos.')
    if (plan.objetos.length > MAX_OBJETOS_ARMAR) throw new ErrorDominio(`Hasta ${MAX_OBJETOS_ARMAR} objetos por llamada: un diagrama más grande va por secciones.`)
    if ((plan.conectores?.length ?? 0) > MAX_CONECTORES_ARMAR) throw new ErrorDominio(`Hasta ${MAX_CONECTORES_ARMAR} conectores por llamada.`)
    const modo = plan.posiciones ?? 'grupo'
    const exacto = modo !== 'grupo'
    if (modo === 'marco' && !plan.marco) throw new ErrorDominio('posiciones: "marco" necesita "marco" (el título o id del marco): las x/y se miden desde su esquina de arriba a la izquierda.')
    if (exacto && plan.nuevoMarco) throw new ErrorDominio(`posiciones: "${modo}" no va con "nuevo_marco" (el marco nuevo se arma a la medida del grupo). Usá "marco" o creá el marco antes.`)
    const refs = new Set<string>()
    for (const [i, o] of plan.objetos.entries()) {
      const ref = o.ref ?? String(i + 1)
      if (refs.has(ref)) throw new ErrorDominio(`La ref «${ref}» está repetida: cada objeto necesita la suya.`)
      refs.add(ref)
      if (exacto && (o.x === undefined || o.y === undefined))
        throw new ErrorDominio(`posiciones: "${modo}" pide x e y en cada objeto (falta en «${ref}»). No armé nada.`)
    }
    const elementos = await this.elementosDe(tableroId)
    const armados: ObjetoArmado[] = []
    for (const o of plan.objetos) armados.push(await this.armarObjeto(tableroId, o, elementos))
    // Los extremos que no son de este pedido tienen que existir antes de crear nada (si no, quedaría a medias).
    const deAntes = new Map<string, ElementoLienzo>()
    for (const c of plan.conectores ?? [])
      for (const r of [c.desde, c.hasta]) {
        if (refs.has(r) || deAntes.has(r)) continue
        const e = await this.resolverElemento(tableroId, r).catch(() => {
          throw new ErrorDominio(`El conector va a «${r}», que no es una ref de este pedido (${[...refs].slice(0, 12).join(', ')}${refs.size > 12 ? '…' : ''}) ni algo del lienzo. No armé nada.`, 404)
        })
        deAntes.set(r, e)
      }
    for (const [i, c] of (plan.conectores ?? []).entries())
      if (c.desde === c.hasta) throw new ErrorDominio(`conectores[${i}]: un conector necesita dos objetos distintos. No armé nada.`)

    const avisos: string[] = []
    let marco: ElementoLienzo | null = null
    let pos: { x: number; y: number }[]
    let origen: { x: number; y: number }
    let marcoNuevo: { id: string; x: number; y: number; ancho: number; alto: number; datos: Record<string, unknown> } | null = null

    if (exacto) {
      if (plan.marco) {
        marco = await this.resolverElemento(tableroId, plan.marco)
        if (marco.tipo !== 'marco') throw new ErrorDominio(`«${plan.marco}» no es un marco (es ${articuloTipo(marco.tipo)}). Pasá el título o el id de un marco.`)
      }
      // En «marco», x e y se miden desde la esquina de arriba a la izquierda del marco; en «lienzo», son las de leer_lienzo.
      origen = modo === 'marco' ? { x: marco!.x, y: marco!.y } : { x: 0, y: 0 }
      pos = plan.objetos.map((o) => ({ x: o.x!, y: o.y! }))
      const rects = plan.objetos.map((_, i) => ({ x: origen.x + pos[i]!.x, y: origen.y + pos[i]!.y, ancho: armados[i]!.ancho, alto: armados[i]!.alto }))
      if (marco) {
        // Si algo se sale del marco, el marco crece (hacia la derecha y abajo, nunca se mueve nada).
        const caja = limites(rects)!
        const ancho = Math.max(marco.ancho, caja.x + caja.ancho + 40 - marco.x)
        const alto = Math.max(marco.alto, caja.y + caja.alto + 40 - marco.y)
        if (ancho > marco.ancho || alto > marco.alto) {
          await this.actualizarElementos(ctx, [{ id: marco.id, ancho, alto }])
          avisos.push(`El marco «${String(marco.datos.titulo ?? '')}» creció para que entre todo (${Math.round(ancho)} × ${Math.round(alto)}).`)
          marco = { ...marco, ancho, alto }
        }
        const quedan = elementos.filter((e) => e.id !== marco!.id && e.tipo !== 'marco' && marcoDe(e, [marco!]))
        const encimados = rects.filter((r) => quedan.some((e) => r.x < e.x + e.ancho && r.x + r.ancho > e.x && r.y < e.y + e.alto && r.y + r.alto > e.y)).length
        if (encimados) avisos.push(`${encimados} objetos quedaron encimados a otros que ya estaban en el marco (se respetaron las posiciones pedidas).`)
      }
    } else {
      const sep = plan.separacion ?? 80
      // Con x/y en todos, se respetan (relativos al grupo); si no, la disposición elegida.
      const propias = plan.objetos.every((o) => o.x !== undefined && o.y !== undefined)
      if (propias) {
        const x0 = Math.min(...plan.objetos.map((o) => o.x!))
        const y0 = Math.min(...plan.objetos.map((o) => o.y!))
        pos = plan.objetos.map((o) => ({ x: o.x! - x0, y: o.y! - y0 }))
      } else {
        const indice = new Map(plan.objetos.map((o, i) => [o.ref ?? String(i + 1), i]))
        const aristas = (plan.conectores ?? [])
          .map((c) => [indice.get(c.desde) ?? -1, indice.get(c.hasta) ?? -1] as [number, number])
          .filter(([a, b]) => a >= 0 && b >= 0)
        const como = plan.disposicion ?? (aristas.length ? 'flujo' : 'grilla')
        pos = como === 'flujo' ? disponerFlujo(armados, aristas, sep) : disponer(armados, como, sep, plan.columnas)
      }
      const caja = limites(armados.map((a, i) => ({ x: pos[i]!.x, y: pos[i]!.y, ancho: a.ancho, alto: a.alto }))) ?? { x: 0, y: 0, ancho: 0, alto: 0 }
      if (plan.nuevoMarco) {
        // El marco nuevo rodea al grupo con el mismo aire que deja interiorMarco (40 por lado).
        const enBanda = plan.nuevoMarco.tituloEn === 'izquierda' ? 56 : 0
        const tamMarco = { ancho: Math.max(caja.ancho + 80 + enBanda, 400), alto: Math.max(caja.alto + 80, 240) }
        const lugar = await this.lugarEnLienzo(ctx, tableroId, tamMarco, null, elementos)
        marcoNuevo = {
          id: nuevoId(),
          x: lugar.x,
          y: lugar.y,
          ancho: tamMarco.ancho,
          alto: tamMarco.alto,
          datos: {
            titulo: plan.nuevoMarco.titulo,
            color: plan.nuevoMarco.color ?? ESTILOS_FABRICA.marco.color,
            relleno: plan.nuevoMarco.relleno ?? 'tinte',
            ...(plan.nuevoMarco.tituloEn ? { tituloEn: plan.nuevoMarco.tituloEn } : {}),
          },
        }
        origen = { x: lugar.x + 40 + enBanda + Math.max(0, (tamMarco.ancho - 80 - enBanda - caja.ancho) / 2), y: lugar.y + 40 }
      } else {
        const lugar = await this.lugarEnLienzo(ctx, tableroId, { ancho: caja.ancho, alto: caja.alto }, plan.marco, elementos)
        marco = lugar.marco
        origen = lugar
      }
    }

    // Todo adentro de una transacción y en bloque: un INSERT para los objetos y otro para los conectores.
    const nuevosIds = armados.map((a) => (a.existente ? a.existente.id : nuevoId()))
    await this.topeObjetos(armados.filter((a) => !a.existente).length + (marcoNuevo ? 1 : 0))
    const resultado = await this.db.transaccion(async (tx) => {
      const [m] = await tx.consulta<{ z: number | null }>(`select max(z) as z from elementos_lienzo where tablero_id = $1 and eliminado_en is null`, [tableroId])
      let z = Math.max(Number(m?.z ?? 0), 0)
      const filas: unknown[][] = []
      if (marcoNuevo) filas.push([marcoNuevo.id, tableroId, 'marco', Math.round(marcoNuevo.x), Math.round(marcoNuevo.y), Math.round(marcoNuevo.ancho), Math.round(marcoNuevo.alto), 0, null, null, normalizarDatos(marcoNuevo.datos) ?? {}, ctx.actor, false])
      plan.objetos.forEach((o, i) => {
        const a = armados[i]!
        if (a.existente) return
        filas.push([
          nuevosIds[i],
          tableroId,
          o.tipo,
          Math.round(origen.x + pos[i]!.x),
          Math.round(origen.y + pos[i]!.y),
          Math.round(a.ancho),
          Math.round(a.alto),
          o.tipo === 'marco' ? 0 : ++z,
          a.tarjetaId,
          a.listaId,
          normalizarDatos(a.datos) ?? {},
          ctx.actor,
          o.bloqueado ?? false,
        ])
      })
      const COL = 13
      const creadosEl = filas.length
        ? await tx.consulta(
            `insert into elementos_lienzo (id, tablero_id, tipo, x, y, ancho, alto, z, tarjeta_id, lista_id, datos, creado_por, bloqueado)
             values ${filas.map((_, r) => `(${Array.from({ length: COL }, (_, c) => `$${r * COL + c + 1}`).join(',')})`).join(',')}
             returning *`,
            filas.flat(),
          )
        : []
      const idPorRef = new Map<string, string>(plan.objetos.map((o, i) => [o.ref ?? String(i + 1), nuevosIds[i]!]))
      const filasCo: unknown[][] = []
      for (const c of plan.conectores ?? []) {
        const desde = idPorRef.get(c.desde) ?? deAntes.get(c.desde)!.id
        const hasta = idPorRef.get(c.hasta) ?? deAntes.get(c.hasta)!.id
        const e = c.estilo ?? {}
        filasCo.push([nuevoId(), tableroId, desde, e.desdeLado ?? null, hasta, e.hastaLado ?? null, e.trazo ?? 'curvo', e.puntaInicio ?? 'ninguna', e.puntaFin ?? 'flecha', e.color ?? null, e.grosor ?? 2, c.etiqueta ?? '', ctx.actor, e.guion ?? 'solido'])
      }
      const COC = 14
      const creadosCo = filasCo.length
        ? await tx.consulta(
            `insert into conectores (id, tablero_id, desde_id, desde_lado, hasta_id, hasta_lado, trazo, punta_inicio, punta_fin, color, grosor, etiqueta, creado_por, guion)
             values ${filasCo.map((_, r) => `(${Array.from({ length: COC }, (_, c) => `$${r * COC + c + 1}`).join(',')})`).join(',')}
             returning *`,
            filasCo.flat(),
          )
        : []
      return { creadosEl: creadosEl.map(aElemento), creadosCo: creadosCo.map(aConector) }
    })

    const porId = new Map(resultado.creadosEl.map((e) => [e.id, e]))
    const creados = plan.objetos.map((o, i) => ({ ref: o.ref ?? String(i + 1), elemento: armados[i]!.existente ?? porId.get(nuevosIds[i]!)! }))
    if (marcoNuevo) marco = porId.get(marcoNuevo.id) ?? null
    const nuevos = resultado.creadosEl.length - (marcoNuevo ? 1 : 0)
    const conectores = resultado.creadosCo

    // Una sola entrada en la actividad y un solo evento en vivo para todo lo armado.
    let resumen: string | undefined
    if (ctx.actor.tipo !== 'humano') {
      const [tf] = await this.db.consulta(`select proyecto_id from tableros where id = $1`, [tableroId])
      const act = await this.registrar(this.db, ctx, {
        accion: 'lienzo.agregado',
        resumen: `armó en el lienzo ${nuevos === 1 ? 'un objeto' : `${nuevos} objetos`}${conectores.length ? ` y ${conectores.length === 1 ? 'un conector' : `${conectores.length} conectores`}` : ''}${marco ? ` en «${String(marco.datos.titulo ?? 'un marco')}»` : ''}`,
        proyectoId: tf?.proyecto_id,
        tableroId,
      })
      resumen = act.resumen
      this.publicarActividad(ctx, act)
    }
    this.bus.publicar({ tipo: 'lienzo', accion: 'lote', tableroId, actor: ctx.actor, clienteId: ctx.clienteId, resumen, datos: { elementos: resultado.creadosEl, conectores } })
    for (const e of resultado.creadosEl) if (e.tarjetaId) await this.emitirTarjeta(ctx, e.tarjetaId, 'actualizada')
    // Menciones de todo lo armado, en una sola llamada al gancho (solo los objetos que traen «@»).
    await this.avisarTextos(ctx, this.textosDeElementos(resultado.creadosEl, { soloConArroba: true }))
    return { marco, objetos: creados, conectores, avisos }
  }

  /**
   * Saca objetos (y conectores) del lienzo: NO borra nada de verdad. Quedan guardados 30 días con su fecha y vuelven con
   * restaurarEnLienzo (es lo mismo que «Sacar del lienzo» de la web y su deshacer). Una tarjeta o una lista sigue en el Kanban.
   * Un marco sale solo (lo que tiene adentro se queda) salvo con `conContenido`. Lo bloqueado no sale.
   */
  async quitarDelLienzo(
    ctx: Ctx,
    tableroId: string,
    p: { objetos?: string[]; conectores?: string[]; conContenido?: boolean },
  ): Promise<{ objetos: ElementoLienzo[]; conectores: string[] }> {
    const todos = await this.elementosDe(tableroId)
    const elegidos = new Map<string, ElementoLienzo>()
    for (const r of p.objetos ?? []) {
      const e = await this.resolverElemento(tableroId, r)
      elegidos.set(e.id, e)
      if (p.conContenido && e.tipo === 'marco') for (const h of contenidoDeMarco(todos, e)) elegidos.set(h.id, h)
    }
    const bloqueados = [...elegidos.values()].filter((e) => e.bloqueado)
    if (bloqueados.length)
      throw new ErrorDominio(
        `${bloqueados.length === 1 ? 'Está bloqueado' : 'Están bloqueados'}: ${bloqueados.slice(0, 5).map((e) => `${articuloTipo(e.tipo)} (${e.id})`).join(', ')}. Desbloqueá con actualizar_lienzo { "bloqueado": false } y repetí. No saqué nada.`,
      )
    const idsConectores: string[] = []
    if (p.conectores?.length) {
      const propios = await this.db.consulta<{ id: string }>(`select id from conectores where id = any($1::text[]) and tablero_id = $2 and eliminado_en is null`, [p.conectores, tableroId])
      const hallados = new Set(propios.map((c) => c.id))
      const faltan = p.conectores.filter((id) => !hallados.has(id))
      if (faltan.length) throw new ErrorDominio(`No hay conectores con id ${faltan.slice(0, 5).map((x) => `«${x}»`).join(', ')} en este lienzo (los id están en leer_lienzo). No saqué nada.`, 404)
      idsConectores.push(...hallados)
    }
    if (!elegidos.size && !idsConectores.length) throw new ErrorDominio('No dijiste qué sacar: mandá "objetos" y/o "conectores".')
    const r = await this.eliminarElementos(ctx, [...elegidos.keys()])
    const sueltos = idsConectores.filter((id) => !r.conectores.includes(id))
    const porSeparado = sueltos.length ? await this.eliminarConectores(ctx, sueltos) : []
    const conectoresQuitados = [...r.conectores, ...porSeparado]
    if (ctx.actor.tipo !== 'humano') {
      const [tf] = await this.db.consulta(`select proyecto_id from tableros where id = $1`, [tableroId])
      const act = await this.registrar(this.db, ctx, {
        accion: 'lienzo.quitado',
        resumen: `sacó del lienzo ${elegidos.size === 1 ? 'un objeto' : `${elegidos.size} objetos`}${conectoresQuitados.length ? ` y ${conectoresQuitados.length === 1 ? 'un conector' : `${conectoresQuitados.length} conectores`}` : ''} (se pueden restaurar)`,
        proyectoId: tf?.proyecto_id,
        tableroId,
        detalle: { elementos: [...elegidos.keys()], conectores: conectoresQuitados },
      })
      this.publicarActividad(ctx, act)
    }
    return { objetos: [...elegidos.values()], conectores: conectoresQuitados }
  }

  /** Vuelve al lienzo lo que se sacó (por sus id). Solo lo de este tablero y solo lo que estaba sacado. */
  async restaurarEnLienzo(ctx: Ctx, tableroId: string, p: { objetos?: string[]; conectores?: string[] }): Promise<{ objetos: ElementoLienzo[]; conectores: Conector[] }> {
    await this.propio('tablero', tableroId)
    const ids = p.objetos?.length
      ? (await this.db.consulta<{ id: string }>(`select id from elementos_lienzo where id = any($1::text[]) and tablero_id = $2 and eliminado_en is not null`, [p.objetos, tableroId])).map((f) => f.id)
      : []
    const idsCo = p.conectores?.length
      ? (await this.db.consulta<{ id: string }>(`select id from conectores where id = any($1::text[]) and tablero_id = $2 and eliminado_en is not null`, [p.conectores, tableroId])).map((f) => f.id)
      : []
    const pedidos = (p.objetos?.length ?? 0) + (p.conectores?.length ?? 0)
    if (!ids.length && !idsCo.length)
      throw new ErrorDominio(pedidos ? 'Esos id no están sacados de este lienzo (o ya volvieron). Los que se sacaron los lista leer_lienzo con "quitados": true.' : 'No dijiste qué restaurar: mandá los id de "objetos" y/o "conectores".', 404)
    const r = await this.restaurarElementos(ctx, ids, idsCo)
    if (ctx.actor.tipo !== 'humano') {
      const [tf] = await this.db.consulta(`select proyecto_id from tableros where id = $1`, [tableroId])
      const act = await this.registrar(this.db, ctx, {
        accion: 'lienzo.restaurado',
        resumen: `devolvió al lienzo ${r.elementos.length === 1 ? 'un objeto' : `${r.elementos.length} objetos`}${r.conectores.length ? ` y ${r.conectores.length === 1 ? 'un conector' : `${r.conectores.length} conectores`}` : ''}`,
        proyectoId: tf?.proyecto_id,
        tableroId,
      })
      this.publicarActividad(ctx, act)
    }
    return { objetos: r.elementos, conectores: r.conectores }
  }

  /** Lo que se sacó del lienzo en los últimos días (para recuperar algo sin tener los id a mano). */
  async quitadosDe(tableroId: string, dias = 30): Promise<{ objetos: ElementoLienzo[]; conectores: Conector[] }> {
    await this.propio('tablero', tableroId)
    const els = await this.db.consulta(`select * from elementos_lienzo where tablero_id = $1 and eliminado_en > now() - ($2 || ' days')::interval order by eliminado_en desc limit 300`, [tableroId, String(dias)])
    const cos = await this.db.consulta(`select * from conectores where tablero_id = $1 and eliminado_en > now() - ($2 || ' days')::interval order by eliminado_en desc limit 600`, [tableroId, String(dias)])
    return { objetos: els.map(aElemento), conectores: cos.map(aConector) }
  }

  /** Trae al frente o manda al fondo (como el menú del lienzo: los marcos siempre quedan abajo). */
  async apilarEnLienzo(ctx: Ctx, tableroId: string, ids: string[], como: 'frente' | 'fondo'): Promise<void> {
    const els = (await this.elementosDe(tableroId)).filter((e) => e.tipo !== 'marco')
    const elegidos = els.filter((e) => ids.includes(e.id)).sort((a, b) => a.z - b.z)
    if (!elegidos.length) return
    const resto = els.filter((e) => !ids.includes(e.id))
    const max = Math.max(0, ...els.map((e) => e.z))
    const cambios =
      como === 'frente'
        ? elegidos.map((e, i) => ({ id: e.id, z: max + 1 + i }))
        : [...elegidos.map((e, i) => ({ id: e.id, z: 1 + i })), ...resto.map((e) => ({ id: e.id, z: Math.max(1, e.z) + elegidos.length }))]
    await this.actualizarElementos(ctx, cambios)
  }

  async conectarEnLienzo(ctx: Ctx, tableroId: string, desde: string, hasta: string, op: { etiqueta?: string } & EstiloConectorEntrada): Promise<Conector> {
    const a = await this.resolverElemento(tableroId, desde)
    const b = await this.resolverElemento(tableroId, hasta)
    return this.crearConector(ctx, tableroId, { desdeId: a.id, hastaId: b.id, ...op })
  }
}

const MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.zip': 'application/zip',
}

export function mimeDe(nombre: string): string {
  return MIMES[path.extname(nombre).toLowerCase()] ?? 'application/octet-stream'
}

