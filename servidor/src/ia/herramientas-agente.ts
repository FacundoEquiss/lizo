// Qué puede hacer un agente de adentro con el catálogo de herramientas del MCP (plan 6.6, 7.2, 12.3, 12.4 y Anexo B):
//   · la capacidad que exige cada herramienta (leer siempre se puede; el resto, una capacidad del agente),
//   · el juego de herramientas de cada superficie (el modelo no recibe las 45: menos tokens, mejores elecciones),
//   · qué acciones son delicadas y piden permiso,
//   · los límites de cada superficie y las frases que ve la persona («Moviendo RC-104…», «Mover RC-104 a Hecho»),
//   · las 4 herramientas de la capacidad `codigo` (F.3): solo leen y llaman a `ejecutarCodigo` (de ia/codigo.ts, inyectada).
//
// Es la única puerta de las herramientas para la IA: una prueba (herramientas-agente.prueba.ts) recorre `HERRAMIENTAS` y falla si
// alguna no tiene capacidad, así una herramienta nueva no entra sin decidir qué permiso pide.
import { z } from 'zod'
import { CAPACIDADES, type Capacidad, type Superficie } from '../../../compartido/ia'
import { buscarHerramienta, HERRAMIENTAS, type Herramienta } from '../mcp/herramientas'
import { DESCRIPCIONES_CODIGO, ESQUEMAS_CODIGO, fraseDeCodigo, tituloDeCodigo } from './codigo'
import { LIMITES_DE_FABRICA, type CapacidadDe, type DefHerramienta, type EsDelicada, type HerramientaDeCodigo, HERRAMIENTAS_DE_CODIGO } from './tipos'

// ───────────────────────── capacidades ─────────────────────────

const POR_CAPACIDAD: Record<CapacidadDe, string[]> = {
  leer: [
    'leer_guia', 'listar_proyectos', 'leer_proyecto', 'listar_tableros', 'leer_tablero', 'leer_lienzo', 'leer_tabla', 'leer_tarjeta', 'buscar',
    'leer_actividad', 'leer_pendientes', 'leer_diseno', 'buscar_en_diseno', 'ver_diseno', 'ver_lienzo',
  ],
  comentar: ['comentar', 'comentar_diseno', 'atender_mencion'],
  tarjetas: ['crear_tarjeta', 'actualizar_tarjeta', 'mover_tarjeta', 'registrar_porque', 'vincular'],
  lienzo: [
    'agregar_al_lienzo', 'armar_en_lienzo', 'actualizar_lienzo', 'convertir_objeto', 'crear_tabla', 'actualizar_tabla', 'crear_grafico', 'actualizar_grafico',
  ],
  diseno: [
    'crear_marco', 'editar_marco', 'duplicar_marco', 'organizar_diseno', 'definir_pieza', 'definir_tokens', 'subir_activo', 'exportar_diseno', 'sincronizar_diseno',
  ],
  archivar: ['archivar_tarjeta', 'quitar_del_lienzo'],
  estructura: ['crear_proyecto', 'actualizar_proyecto', 'crear_tablero', 'actualizar_tablero', 'crear_lista', 'actualizar_lista'],
  codigo: [...HERRAMIENTAS_DE_CODIGO],
}

/** La capacidad que exige cada herramienta del catálogo (las 47 del MCP y las 4 de código). `'leer'` = siempre permitida. */
export const CAPACIDAD_DE: Record<string, CapacidadDe> = Object.fromEntries(
  Object.entries(POR_CAPACIDAD).flatMap(([cap, nombres]) => nombres.map((n) => [n, cap as CapacidadDe])),
)

/** Cómo se dice cada capacidad en una frase («No tenés permiso para …»). */
export const PALABRAS_CAPACIDAD: Record<Capacidad, string> = {
  comentar: 'comentar en tarjetas y en Diseño',
  tarjetas: 'crear, editar, mover y vincular tarjetas, y escribir el porqué',
  lienzo: 'armar y cambiar cosas en el lienzo: notas, formas, conectores, tablas y gráficos',
  diseno: 'crear y editar marcos, tokens y piezas en Diseño',
  archivar: 'archivar tarjetas y sacar cosas del lienzo',
  estructura: 'crear y cambiar proyectos, tableros y listas',
  codigo: 'leer el código de los repos',
}

/** ¿Esta herramienta no cambia nada? (las de leer y las de código) */
export const soloLee = (herramienta: string): boolean => CAPACIDAD_DE[herramienta] === 'leer' || CAPACIDAD_DE[herramienta] === 'codigo'

// ───────────────────────── juegos por superficie (7.2) ─────────────────────────

const KANBAN = [
  'listar_proyectos', 'leer_proyecto', 'listar_tableros', 'leer_tablero', 'leer_tarjeta', 'buscar', 'leer_actividad', 'leer_guia',
  'crear_tarjeta', 'actualizar_tarjeta', 'mover_tarjeta', 'archivar_tarjeta', 'comentar', 'registrar_porque', 'vincular',
  ...HERRAMIENTAS_DE_CODIGO,
]

/** Las herramientas que ve el modelo en cada superficie (antes de filtrar por los permisos del agente). */
export const JUEGOS: Record<Superficie, string[]> = {
  tarjeta: KANBAN,
  kanban: KANBAN,
  lienzo: ['leer_lienzo', 'ver_lienzo', 'armar_en_lienzo', 'agregar_al_lienzo', 'actualizar_lienzo', 'quitar_del_lienzo', 'convertir_objeto', 'leer_tablero', 'leer_tarjeta', 'buscar', 'leer_guia'],
  tabla: ['leer_lienzo', 'leer_tabla', 'crear_tabla', 'actualizar_tabla', 'crear_grafico', 'actualizar_grafico', 'leer_guia'],
  diseno: [
    'leer_diseno', 'buscar_en_diseno', 'ver_diseno', 'crear_marco', 'editar_marco', 'duplicar_marco', 'organizar_diseno', 'definir_pieza', 'definir_tokens',
    'subir_activo', 'exportar_diseno', 'sincronizar_diseno', 'comentar_diseno', 'leer_guia',
  ],
}

/** Los límites de cada superficie (6.4): pasos, salida máxima por pedido, tiempo libre mínimo para empezar un pedido y tope de costo. */
export const LIMITES = LIMITES_DE_FABRICA

// ───────────────────────── las herramientas de código (F.3) ─────────────────────────

/**
 * Las 4 herramientas de la capacidad `codigo`: no están en el MCP, corren por `ejecutarCodigo`. Su definición (esquema y descripción) es UNA sola,
 * la de `codigo.ts`, que es quien las implementa: lo que ve el modelo es exactamente lo que acepta el código.
 */
export const HERRAMIENTAS_CODIGO: Record<HerramientaDeCodigo, { titulo: string; descripcion: string; esquema: z.ZodObject }> = Object.fromEntries(
  HERRAMIENTAS_DE_CODIGO.map((n) => [n, { titulo: DESCRIPCIONES_CODIGO[n].titulo, descripcion: DESCRIPCIONES_CODIGO[n].descripcion, esquema: ESQUEMAS_CODIGO[n] }]),
) as unknown as Record<HerramientaDeCodigo, { titulo: string; descripcion: string; esquema: z.ZodObject }>

// ───────────────────────── el catálogo para un modelo ─────────────────────────

const jsonEsquemas = new Map<string, Record<string, unknown>>()
function esquemaJson(nombre: string, esquema: z.ZodObject): Record<string, unknown> {
  let j = jsonEsquemas.get(nombre)
  if (!j) {
    j = z.toJSONSchema(esquema) as Record<string, unknown>
    delete j.$schema
    jsonEsquemas.set(nombre, j)
  }
  return j
}

/** La definición de una herramienta tal como la ve el modelo (la del MCP, sin reescribir nada), o null si no existe. */
export function defDe(nombre: string): DefHerramienta | null {
  const c = HERRAMIENTAS_CODIGO[nombre as HerramientaDeCodigo]
  if (c) return { nombre, descripcion: c.descripcion, esquema: esquemaJson(nombre, c.esquema) }
  const h = buscarHerramienta(nombre)
  return h ? { nombre, descripcion: h.descripcion, esquema: esquemaJson(nombre, h.esquema) } : null
}

/** El esquema zod con que se validan los argumentos de una herramienta (la del MCP o una de código). */
export function esquemaDe(nombre: string): z.ZodObject | null {
  return HERRAMIENTAS_CODIGO[nombre as HerramientaDeCodigo]?.esquema ?? buscarHerramienta(nombre)?.esquema ?? null
}

/** Una herramienta del MCP, o null si es una de código o no existe. */
export const herramientaMcp = (nombre: string): Herramienta | null => buscarHerramienta(nombre) ?? null

/** ¿Las puede usar un agente con estos permisos? (leer siempre; el resto, con su capacidad) */
export function permitida(herramienta: string, permisos: readonly Capacidad[]): boolean {
  const cap = CAPACIDAD_DE[herramienta]
  if (!cap) return false
  return cap === 'leer' || permisos.includes(cap)
}

/** El juego de la superficie, sin lo que el agente no tiene permitido (sin `archivar` no ve `archivar_tarjeta` ni `quitar_del_lienzo`). */
export function herramientasPara(superficie: Superficie, permisos: Capacidad[]): DefHerramienta[] {
  const salida: DefHerramienta[] = []
  for (const nombre of JUEGOS[superficie]) {
    if (!permitida(nombre, permisos)) continue
    const d = defDe(nombre)
    if (d) salida.push(d)
  }
  return salida
}

// ───────────────────────── lo delicado (12.4) ─────────────────────────

const cuantos = (v: unknown): number => (Array.isArray(v) ? v.length : 0)
const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * ¿Hace falta pedir permiso? Devuelve el motivo para mostrar («Archivar RC-12») o null. `tarjetasTocadas`: las que el mismo trabajo ya
 * creó, editó o movió: desde la número 11 se pide. (La dirección web armada con datos leídos se mira en el ejecutor: necesita lo leído.)
 */
export const esDelicada: EsDelicada = (herramienta, argumentos, e) => {
  const a = (argumentos && typeof argumentos === 'object' ? argumentos : {}) as Record<string, any>
  switch (herramienta) {
    case 'archivar_tarjeta':
      return a.restaurar ? null : `Archivar ${texto(a.tarjeta) || 'una tarjeta'}`
    case 'quitar_del_lienzo': {
      if (a.restaurar) return null
      const n = cuantos(a.objetos) + cuantos(a.conectores)
      if (a.con_contenido || n > 5) return `Sacar ${n > 5 ? `${n} objetos` : 'un marco con lo que tiene adentro'} del lienzo`
      return null
    }
    case 'crear_proyecto':
      return `Crear el proyecto «${texto(a.nombre)}»`
    case 'crear_tablero':
      return `Crear el tablero «${texto(a.nombre)}»`
    case 'crear_lista':
      return `Crear la lista «${texto(a.nombre)}»`
    case 'actualizar_proyecto':
      return `Cambiar el proyecto ${texto(a.proyecto) || ''}`.trim()
    case 'actualizar_tablero':
      return `Cambiar el tablero ${texto(a.tablero) || ''}`.trim()
    case 'actualizar_lista':
      return `Cambiar la lista ${texto(a.lista) || texto(a.nombre) || ''}`.trim()
    case 'definir_tokens':
    case 'sincronizar_diseno':
      return 'Cambiar los colores del sistema de diseño'
    case 'actualizar_lienzo': {
      const n = cuantos(a.objetos)
      return n > 25 ? `Cambiar ${n} objetos de una vez` : null
    }
    case 'actualizar_tabla': {
      const ops: any[] = Array.isArray(a.operaciones) ? a.operaciones : []
      if (ops.some((o) => o?.op === 'quitar_columna')) return 'Borrar una columna de la tabla'
      const filas = ops.reduce((n, o) => n + (o?.op === 'quitar_filas' ? cuantos(o.filas) : 0), 0)
      if (filas > 10) return `Borrar ${filas} filas de la tabla`
      if (ops.some((o) => o?.op === 'reemplazar_filas')) return 'Reemplazar todas las filas de la tabla'
      return null
    }
    case 'crear_tarjeta':
    case 'actualizar_tarjeta':
    case 'mover_tarjeta':
      return e.tarjetasTocadas >= 10 ? `Ya tocó ${e.tarjetasTocadas} tarjetas: ¿sigue?` : null
    default:
      return null
  }
}

// ───────────────────────── frases y títulos ─────────────────────────

const clave = (a: any) => texto(a?.tarjeta) || 'la tarjeta'
const cuantosObjetos = (a: any) => cuantos(a?.objetos) || 1

interface Frases {
  /** «Leyendo RC-98…» (lo que está haciendo). */
  frase: (a: any) => string
  /** «Mover RC-104 a Hecho» (para pedir permiso y listar). */
  titulo: (a: any) => string
  /** «Movió RC-104 a Hecho» (lo que hizo). */
  hecho: (a: any) => string
}

const f = (frase: (a: any) => string, titulo: (a: any) => string, hecho: (a: any) => string): Frases => ({ frase, titulo, hecho })
const fija = (frase: string, titulo: string, hecho: string): Frases => f(() => frase, () => titulo, () => hecho)

const FRASES: Record<string, Frases> = {
  leer_guia: fija('Leyendo la guía…', 'Leer la guía', 'Leyó la guía'),
  listar_proyectos: fija('Mirando los proyectos…', 'Ver los proyectos', 'Miró los proyectos'),
  leer_proyecto: fija('Leyendo el proyecto…', 'Leer el proyecto', 'Leyó el proyecto'),
  listar_tableros: fija('Mirando los tableros…', 'Ver los tableros', 'Miró los tableros'),
  leer_tablero: fija('Leyendo el tablero…', 'Leer el tablero', 'Leyó el tablero'),
  leer_lienzo: fija('Mirando el lienzo…', 'Leer el lienzo', 'Miró el lienzo'),
  leer_tabla: fija('Leyendo la tabla…', 'Leer la tabla', 'Leyó la tabla'),
  leer_tarjeta: f((a) => `Leyendo ${clave(a)}…`, (a) => `Leer ${clave(a)}`, (a) => `Leyó ${clave(a)}`),
  buscar: f((a) => `Buscando «${texto(a?.consulta).slice(0, 40)}»…`, (a) => `Buscar «${texto(a?.consulta).slice(0, 40)}»`, (a) => `Buscó «${texto(a?.consulta).slice(0, 40)}»`),
  leer_actividad: fija('Mirando la actividad…', 'Leer la actividad', 'Miró la actividad'),
  leer_pendientes: fija('Mirando lo pendiente…', 'Leer lo pendiente', 'Miró lo pendiente'),
  leer_diseno: fija('Mirando el diseño…', 'Leer el diseño', 'Miró el diseño'),
  buscar_en_diseno: fija('Buscando en el diseño…', 'Buscar en el diseño', 'Buscó en el diseño'),
  ver_diseno: fija('Mirando el diseño…', 'Ver el diseño', 'Miró el diseño'),
  ver_lienzo: fija('Mirando el lienzo…', 'Ver el lienzo', 'Miró el lienzo'),
  comentar: f((a) => `Comentando en ${clave(a)}…`, (a) => `Comentar en ${clave(a)}`, (a) => `Comentó en ${clave(a)}`),
  comentar_diseno: fija('Comentando en el diseño…', 'Comentar en el diseño', 'Comentó en el diseño'),
  atender_mencion: fija('Atendiendo una mención…', 'Atender una mención', 'Atendió una mención'),
  crear_tarjeta: f(
    (a) => `Creando «${texto(a?.titulo).slice(0, 40)}»…`,
    (a) => `Crear la tarjeta «${texto(a?.titulo).slice(0, 60)}»`,
    (a) => `Creó la tarjeta «${texto(a?.titulo).slice(0, 60)}»`,
  ),
  actualizar_tarjeta: f((a) => `Editando ${clave(a)}…`, (a) => `Editar ${clave(a)}`, (a) => `Editó ${clave(a)}`),
  mover_tarjeta: f(
    (a) => `Moviendo ${clave(a)}…`,
    (a) => `Mover ${clave(a)} a ${texto(a?.lista) || 'otra lista'}`,
    (a) => `Movió ${clave(a)} a ${texto(a?.lista) || 'otra lista'}`,
  ),
  registrar_porque: f((a) => `Escribiendo el porqué de ${clave(a)}…`, (a) => `Escribir el porqué de ${clave(a)}`, (a) => `Escribió el porqué de ${clave(a)}`),
  vincular: f((a) => `Vinculando ${clave(a)}…`, (a) => `Vincular ${clave(a)}`, (a) => `Vinculó ${clave(a)}`),
  archivar_tarjeta: f(
    (a) => `${a?.restaurar ? 'Restaurando' : 'Archivando'} ${clave(a)}…`,
    (a) => `${a?.restaurar ? 'Restaurar' : 'Archivar'} ${clave(a)}`,
    (a) => `${a?.restaurar ? 'Restauró' : 'Archivó'} ${clave(a)}`,
  ),
  quitar_del_lienzo: f(
    (a) => `${a?.restaurar ? 'Restaurando' : 'Sacando'} cosas del lienzo…`,
    (a) => `${a?.restaurar ? 'Restaurar' : 'Sacar'} ${cuantos(a?.objetos) + cuantos(a?.conectores) || 'unos'} objetos del lienzo`,
    (a) => `${a?.restaurar ? 'Restauró' : 'Sacó'} ${cuantos(a?.objetos) + cuantos(a?.conectores) || 'unos'} objetos del lienzo`,
  ),
  agregar_al_lienzo: fija('Agregando al lienzo…', 'Agregar un objeto al lienzo', 'Agregó un objeto al lienzo'),
  armar_en_lienzo: f(
    (a) => `Armando ${cuantosObjetos(a)} objetos en el lienzo…`,
    (a) => `Armar ${cuantosObjetos(a)} objetos en el lienzo`,
    (a) => `Armó ${cuantosObjetos(a)} objetos en el lienzo`,
  ),
  actualizar_lienzo: f(
    (a) => `Cambiando ${cuantos(a?.objetos) || 'un'} objetos del lienzo…`,
    (a) => `Cambiar ${cuantos(a?.objetos) || 'un'} objetos del lienzo`,
    (a) => `Cambió ${cuantos(a?.objetos) || 'un'} objetos del lienzo`,
  ),
  convertir_objeto: fija('Convirtiendo un objeto…', 'Convertir un objeto', 'Convirtió un objeto'),
  crear_tabla: f((a) => `Armando la tabla «${texto(a?.titulo).slice(0, 40)}»…`, (a) => `Crear la tabla «${texto(a?.titulo).slice(0, 60)}»`, (a) => `Creó la tabla «${texto(a?.titulo).slice(0, 60)}»`),
  actualizar_tabla: fija('Cambiando la tabla…', 'Cambiar la tabla', 'Cambió la tabla'),
  crear_grafico: fija('Armando el gráfico…', 'Crear un gráfico', 'Creó un gráfico'),
  actualizar_grafico: fija('Cambiando el gráfico…', 'Cambiar el gráfico', 'Cambió el gráfico'),
  crear_marco: f((a) => `Dibujando el marco «${texto(a?.nombre).slice(0, 40)}»…`, (a) => `Crear el marco «${texto(a?.nombre).slice(0, 60)}»`, (a) => `Creó el marco «${texto(a?.nombre).slice(0, 60)}»`),
  editar_marco: fija('Ajustando el marco…', 'Editar un marco', 'Editó un marco'),
  duplicar_marco: fija('Duplicando el marco…', 'Duplicar un marco', 'Duplicó un marco'),
  organizar_diseno: fija('Ordenando el diseño…', 'Ordenar el diseño', 'Ordenó el diseño'),
  definir_pieza: fija('Definiendo una pieza…', 'Definir una pieza', 'Definió una pieza'),
  definir_tokens: fija('Cambiando los colores del sistema…', 'Cambiar los colores del sistema de diseño', 'Cambió los colores del sistema de diseño'),
  subir_activo: f((a) => `Subiendo ${texto(a?.nombre).slice(0, 40) || 'un activo'}…`, (a) => `Subir ${texto(a?.nombre) || 'un activo'}`, (a) => `Subió ${texto(a?.nombre) || 'un activo'}`),
  exportar_diseno: fija('Exportando el diseño…', 'Exportar el diseño', 'Exportó el diseño'),
  sincronizar_diseno: fija('Sincronizando el diseño…', 'Sincronizar el diseño con el código', 'Sincronizó el diseño con el código'),
  crear_proyecto: f((a) => `Creando el proyecto «${texto(a?.nombre)}»…`, (a) => `Crear el proyecto «${texto(a?.nombre)}»`, (a) => `Creó el proyecto «${texto(a?.nombre)}»`),
  actualizar_proyecto: fija('Cambiando el proyecto…', 'Cambiar el proyecto', 'Cambió el proyecto'),
  crear_tablero: f((a) => `Creando el tablero «${texto(a?.nombre)}»…`, (a) => `Crear el tablero «${texto(a?.nombre)}»`, (a) => `Creó el tablero «${texto(a?.nombre)}»`),
  actualizar_tablero: fija('Cambiando el tablero…', 'Cambiar el tablero', 'Cambió el tablero'),
  crear_lista: f((a) => `Creando la lista «${texto(a?.nombre)}»…`, (a) => `Crear la lista «${texto(a?.nombre)}»`, (a) => `Creó la lista «${texto(a?.nombre)}»`),
  actualizar_lista: fija('Cambiando la lista…', 'Cambiar la lista', 'Cambió la lista'),
  codigo_ver: f((a) => fraseDeCodigo('codigo_ver', a), (a) => tituloDeCodigo('codigo_ver', a), (a) => `Miró ${texto(a?.ruta) ? `la carpeta ${texto(a?.ruta)}` : 'las carpetas del código'}`),
  codigo_leer: f((a) => fraseDeCodigo('codigo_leer', a), (a) => tituloDeCodigo('codigo_leer', a), (a) => `Leyó ${texto(a?.ruta) || 'un archivo'}`),
  codigo_buscar: f((a) => fraseDeCodigo('codigo_buscar', a), (a) => tituloDeCodigo('codigo_buscar', a), () => 'Buscó en el código'),
  codigo_cambios: f((a) => fraseDeCodigo('codigo_cambios', a), (a) => tituloDeCodigo('codigo_cambios', a), () => 'Miró los cambios del código'),
}

/** Lo que está haciendo, en gerundio y armado por Telar (no por el modelo): «Moviendo RC-104…». */
export function fraseDe(herramienta: string, argumentos: unknown): string {
  return FRASES[herramienta]?.frase(argumentos) ?? `Usando ${herramienta}…`
}

/** Para pedir permiso y listar lo que pasó: «Mover RC-104 a Hecho». */
export function tituloDe(herramienta: string, argumentos: unknown): string {
  return FRASES[herramienta]?.titulo(argumentos) ?? herramienta
}

/** Lo que hizo, en pasado, para la línea de debajo de la respuesta: «Movió RC-104 a Hecho». */
export function hechoDe(herramienta: string, argumentos: unknown): string {
  return FRASES[herramienta]?.hecho(argumentos) ?? `Usó ${herramienta}`
}

/** Todas las herramientas que conoce el agente (las del MCP y las de código), para la prueba de cobertura. */
export function nombresDelCatalogo(): string[] {
  return [...HERRAMIENTAS.map((h) => h.nombre), ...HERRAMIENTAS_DE_CODIGO]
}

/** Las capacidades que existen (para recorrerlas en la prueba). */
export const TODAS_LAS_CAPACIDADES = CAPACIDADES
