// Herramientas de tablas y gráficos del lienzo: crear_tabla, leer_tabla, actualizar_tabla, crear_grafico y actualizar_grafico.
// Una tabla es un objeto del lienzo con columnas que tienen formato (número, moneda, fecha, rama de git…); un gráfico se arma
// solo desde una tabla (o con datos propios). Las reglas de verdad están en compartido/tabla.ts y compartido/grafico.ts: acá
// solo se traducen los parámetros (snake_case) y se arma la respuesta.
import { z } from 'zod'
import { leerGrafico, resolverGrafico, TIPOS_GRAFICO, type TipoGrafico } from '../../../compartido/grafico'
import {
  filasOrdenadas,
  leerTabla,
  resumir,
  TIPOS_COLUMNA,
  type ColumnaTabla,
  type EntradaColumna,
  type OperacionTabla,
  type Resumen,
  type TipoColumna,
} from '../../../compartido/tabla'
import type { ElementoLienzo } from '../../../compartido/tipos'
import { articuloTipo, ErrorDominio, type CambiosGrafico, type Servicio } from '../dominio/servicio'
import { colores, definir, limpio, refProyecto, refTablero, tableroDe } from './comun'

// ───────── parámetros ─────────

const IDS_TIPO = TIPOS_COLUMNA.map((t) => t.id) as [TipoColumna, ...TipoColumna[]]
const IDS_GRAFICO = TIPOS_GRAFICO.map((t) => t.id) as [TipoGrafico, ...TipoGrafico[]]
const RESUMENES = ['ninguno', 'suma', 'promedio', 'minimo', 'maximo', 'contar', 'llenas'] as const

const campoColumna = {
  tipo: z
    .enum(IDS_TIPO)
    .describe(
      'Formato de la columna: texto, numero (1234.5), moneda (4200), porcentaje (35 es 35 %), fecha (2026-11-24), duracion (minutos: 90, o "1h30"), casilla (true/false), etiqueta (pastilla de color: estado, categoría), link (https://…), email, telefono, ubicacion (lugar, abre el mapa), rama (rama de git), directorio (carpeta del repo), tarjeta (clave de Telar, RC-12) o color.',
    ),
  ancho: z.number().int().min(60).max(640).optional().describe('Ancho de la columna en px (de fábrica, según el tipo).'),
  alineacion: z.enum(['izquierda', 'centro', 'derecha']).optional().describe('Alineación (los números van a la derecha de fábrica).'),
  decimales: z.number().int().min(0).max(6).optional().describe('Número, moneda o porcentaje: cuántos decimales se ven.'),
  moneda: z.string().min(1).max(4).optional().describe('Moneda: ARS (de fábrica, "$"), USD, EUR, BRL o un símbolo de hasta 4 caracteres.'),
  con_hora: z.boolean().optional().describe('Fecha: guarda también la hora (2026-11-24 18:30).'),
  opciones: z
    .array(z.strictObject({ nombre: z.string().min(1).max(40), color: colores.optional() }))
    .max(40)
    .optional()
    .describe('Etiqueta: las opciones con su color. Un valor nuevo se suma solo como opción.'),
  resumen: z.enum(RESUMENES).optional().describe('Pie de la columna: suma, promedio, minimo, maximo, contar, llenas (cuántas celdas tienen algo) o ninguno.'),
}

const columnaEntrada = z.strictObject({ nombre: z.string().min(1).max(80).describe('Título de la columna.'), ...campoColumna, tipo: campoColumna.tipo.optional() })
const filaEntrada = z
  .union([z.array(z.unknown()), z.record(z.string(), z.unknown())])
  .describe('Una fila: una lista de valores en el orden de las columnas, o un objeto { "Nombre de columna": valor }. Vacío = null o "".')
const refFila = z.union([z.string(), z.number()]).describe('Fila: su id (lo da leer_tabla) o su número tal como se ve (1 = la primera).')

function columnaDesde(c: z.infer<typeof columnaEntrada>): EntradaColumna {
  return limpio({
    nombre: c.nombre,
    tipo: c.tipo,
    ancho: c.ancho,
    alineacion: c.alineacion,
    decimales: c.decimales,
    moneda: c.moneda,
    conHora: c.con_hora,
    opciones: c.opciones?.map((o) => limpio({ nombre: o.nombre, color: o.color })),
    resumen: c.resumen as Resumen | undefined,
  }) as EntradaColumna
}

const cambiosColumna = z.strictObject({ nombre: z.string().min(1).max(80).optional(), ...campoColumna, tipo: campoColumna.tipo.optional() })

const esquemaOperacion = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('agregar_filas'),
    filas: z.array(filaEntrada).min(1).max(500),
    en: z.number().int().min(1).optional().describe('Posición donde van (1 = arriba). De fábrica, al final.'),
  }),
  z.strictObject({
    op: z.literal('cambiar_celdas'),
    celdas: z.array(z.strictObject({ fila: refFila, columna: z.string().min(1).describe('Nombre o id de la columna.'), valor: z.unknown() })).min(1).max(1000),
  }),
  z.strictObject({ op: z.literal('quitar_filas'), filas: z.array(refFila).min(1).max(500) }),
  z.strictObject({ op: z.literal('mover_fila'), fila: refFila, a: z.number().int().min(1).describe('Posición de destino (1 = arriba).') }),
  z.strictObject({ op: z.literal('reemplazar_filas'), filas: z.array(filaEntrada).max(500).describe('Todas las filas nuevas (las de antes se van).') }),
  z.strictObject({
    op: z.literal('agregar_columna'),
    columna: columnaEntrada,
    en: z.number().int().min(1).optional().describe('Posición (1 = la primera). De fábrica, al final.'),
    valores: z.array(z.unknown()).max(500).optional().describe('Un valor por fila existente, en el orden en que se ven.'),
  }),
  z.strictObject({
    op: z.literal('cambiar_columna'),
    columna: z.string().min(1).describe('Nombre o id de la columna.'),
    cambios: cambiosColumna,
    forzar: z.boolean().optional().describe('Al cambiar el tipo, si hay valores que no encajan: true los deja vacíos (si no, es un error que dice cuáles).'),
  }),
  z.strictObject({ op: z.literal('quitar_columna'), columna: z.string().min(1) }),
  z.strictObject({
    op: z.literal('ordenar'),
    columna: z.string().nullable().describe('Columna por la que se ordena la vista; null saca el orden.'),
    direccion: z.enum(['asc', 'desc']).optional(),
  }),
])

function operacionDesde(o: z.infer<typeof esquemaOperacion>): OperacionTabla {
  switch (o.op) {
    case 'agregar_columna':
      return { op: 'agregar_columna', columna: columnaDesde(o.columna), en: o.en, valores: o.valores }
    case 'cambiar_columna': {
      const { con_hora, nombre, ...resto } = o.cambios
      return {
        op: 'cambiar_columna',
        columna: o.columna,
        forzar: o.forzar,
        cambios: limpio({ ...columnaDesde({ nombre: nombre ?? '', ...resto, con_hora } as z.infer<typeof columnaEntrada>), nombre }) as Partial<EntradaColumna>,
      }
    }
    case 'cambiar_celdas':
      return { op: 'cambiar_celdas', celdas: o.celdas.map((c) => ({ fila: c.fila, columna: c.columna, valor: c.valor })) }
    default:
      return o as OperacionTabla
  }
}

const estiloTabla = {
  color: colores.optional().describe('Color de la tabla (cabecera y detalles). De fábrica, azul.'),
  cabecera: z.enum(['tinte', 'fuerte', 'lisa']).optional().describe('Cabecera: tinte (de fábrica), fuerte (color pleno) o lisa.'),
  rayas: z.boolean().optional().describe('Filas con rayas alternadas (de fábrica, sí).'),
  numeros_fila: z.boolean().optional().describe('Columna con el número de cada fila.'),
}

// ───────── respuestas ─────────

const columnasCortas = (cols: ColumnaTabla[]) => cols.map((c) => limpio({ id: c.id, nombre: c.nombre, tipo: c.tipo, moneda: c.tipo === 'moneda' ? c.moneda : undefined }))
const rectDe = (e: ElementoLienzo) => ({ x: Math.round(e.x), y: Math.round(e.y), ancho: Math.round(e.ancho), alto: Math.round(e.alto) })

async function tablaDe(s: Servicio, tableroId: string, ref: string): Promise<ElementoLienzo> {
  const e = await s.resolverElemento(tableroId, ref)
  if (e.tipo !== 'tabla') throw new ErrorDominio(`«${ref}» no es una tabla (es ${articuloTipo(e.tipo)}). Las tablas del lienzo las lista leer_lienzo (tipo "tabla").`)
  return e
}
async function graficoDe(s: Servicio, tableroId: string, ref: string): Promise<ElementoLienzo> {
  const e = await s.resolverElemento(tableroId, ref)
  if (e.tipo !== 'grafico') throw new ErrorDominio(`«${ref}» no es un gráfico (es ${articuloTipo(e.tipo)}).`)
  return e
}

const datosGrafico = z
  .strictObject({
    categorias: z.array(z.string().max(80)).min(1).max(60),
    series: z
      .array(z.strictObject({ nombre: z.string().min(1).max(60), valores: z.array(z.number().nullable()).max(60), color: colores.optional() }))
      .min(1)
      .max(8),
  })
  .describe('Datos propios: { categorias: ["Cocina", "Salón"], series: [{ nombre: "Tarjetas", valores: [12, 7] }] }. No va junto con "tabla".')

const paramsGrafico = {
  titulo: z.string().max(120).optional().describe('Título del gráfico.'),
  tabla: z.string().optional().describe('De dónde salen los datos: título o id de una tabla del lienzo. El gráfico se actualiza solo cuando cambia la tabla.'),
  categoria: z.string().optional().describe('Con "tabla": columna de categorías (el eje). De fábrica, la primera que no es un número.'),
  series: z.array(z.string()).max(8).optional().describe('Con "tabla": columnas numéricas a dibujar (numero, moneda, porcentaje o duracion). De fábrica, hasta 3.'),
  agrupar: z.enum(['suma', 'promedio', 'contar']).optional().describe('Con "tabla": si una categoría se repite, suma (de fábrica), promedia o cuenta filas (sirve sin series: «cuántas tarjetas por estado»).'),
  datos: datosGrafico.optional(),
  apilado: z.boolean().optional().describe('Barras o área con varias series: apiladas.'),
  leyenda: z.enum(['auto', 'si', 'no']).optional().describe('Leyenda: auto (solo si hay varias series), si o no.'),
  valores: z.boolean().optional().describe('Mostrar el valor sobre cada barra, punto o porción (de fábrica, sí).'),
  colores: z.array(colores).max(8).optional().describe('Color de cada serie, en orden. De fábrica: azul, naranja, verde, violeta, rosa…'),
}

function cambiosGrafico(a: Record<string, unknown>): CambiosGrafico {
  return limpio({
    tipo: a.tipo as TipoGrafico | undefined,
    titulo: a.titulo as string | undefined,
    tabla: a.tabla as string | undefined,
    categoria: a.categoria as string | undefined,
    series: a.series as string[] | undefined,
    agrupar: a.agrupar as CambiosGrafico['agrupar'],
    datos: a.datos as CambiosGrafico['datos'],
    apilado: a.apilado as boolean | undefined,
    leyenda: a.leyenda as CambiosGrafico['leyenda'],
    valores: a.valores as boolean | undefined,
    colores: a.colores as CambiosGrafico['colores'],
  })
}

export const HERRAMIENTAS_TABLAS = [
  definir({
    nombre: 'crear_tabla',
    titulo: 'Crear una tabla en el lienzo',
    descripcion:
      'Crea una tabla de verdad (tipo Excel) en el lienzo: columnas con formato y filas. Tipos de columna: texto, numero, moneda, porcentaje, fecha, duracion, casilla, etiqueta, link, email, telefono, ubicacion, rama (de git), directorio, tarjeta (RC-12) y color. Los valores se validan (un error dice fila, columna y qué se esperaba); la fecha va como 2026-11-24, el porcentaje como 35 (es 35 %), la duración en minutos. "ordenar_por" deja la vista ordenada sin mover los datos y "resumen" en una columna pone su suma o promedio al pie. Hasta 30 columnas y 500 filas; en el lienzo se dibujan las primeras 60. Sin x/y busca lugar solo (adentro del "marco" pedido). Para cambiarla después, actualizar_tabla; para un gráfico de sus datos, crear_grafico. Ejemplo: { "titulo": "Precios del menú", "marco": "Economía", "columnas": [ { "nombre": "Plato", "tipo": "texto" }, { "nombre": "Precio", "tipo": "moneda", "resumen": "suma" }, { "nombre": "Margen", "tipo": "porcentaje" }, { "nombre": "Estado", "tipo": "etiqueta", "opciones": [ { "nombre": "Listo", "color": "verde" } ] } ], "filas": [ ["Milanesa", 4200, 35, "Listo"], ["Ñoquis", 3100, 48, "Listo"] ], "ordenar_por": "Precio", "direccion": "desc" }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      tablero: refTablero,
      titulo: z.string().max(120).optional().describe('Título de la tabla (se ve arriba).'),
      columnas: z.array(columnaEntrada).min(1).max(30),
      filas: z.array(filaEntrada).max(500).optional(),
      ordenar_por: z.string().optional().describe('Nombre de la columna por la que se ordena la vista.'),
      direccion: z.enum(['asc', 'desc']).optional(),
      marco: z.string().optional().describe('Título o id del marco donde ponerla.'),
      x: z.number().optional().describe('Posición (con y): si no se manda, busca lugar solo.'),
      y: z.number().optional(),
      bloqueado: z.boolean().optional(),
      ...estiloTabla,
    }),
    soloLectura: false,
    idempotente: false,
    async ejecutar(s, actor, a) {
      const tf = await tableroDe(s, a)
      const { elemento, avisos } = await s.crearTabla(
        { actor },
        tf.id,
        limpio({
          titulo: a.titulo,
          columnas: a.columnas.map(columnaDesde),
          filas: a.filas,
          orden: a.ordenar_por ? { columna: a.ordenar_por, direccion: a.direccion } : undefined,
          color: a.color,
          cabecera: a.cabecera,
          rayas: a.rayas,
          numerosFila: a.numeros_fila,
          marco: a.marco,
          x: a.x,
          y: a.y,
          bloqueado: a.bloqueado,
        }),
      )
      const t = leerTabla(elemento.datos)
      return limpio({
        ok: true,
        mensaje: `Creé la tabla «${t.titulo || 'sin título'}» con ${t.columnas.length} columnas y ${t.filas.length} filas.`,
        tabla: { id: elemento.id, titulo: t.titulo, columnas: columnasCortas(t.columnas), filas: t.filas.length, ...rectDe(elemento) },
        avisos: avisos.length ? avisos : undefined,
        url: tf.url,
      })
    },
  }),

  definir({
    nombre: 'leer_tabla',
    titulo: 'Leer una tabla del lienzo',
    descripcion:
      'Devuelve una tabla del lienzo con sus datos: las columnas (id, nombre y tipo), las filas en el orden en que se ven (con la vista ordenada, si la hay) y el resumen de las columnas que lo tienen. Los valores vienen como se guardan (fecha 2026-11-24, porcentaje 35, duración en minutos, casilla true/false). "ids" son los id de las filas devueltas, para cambiarlas con actualizar_tabla. Con "desde" y "cantidad" se pagina (hasta 500). "como": "matriz" (de fábrica, compacto) u "objetos" (cada fila con los nombres de columna). Ejemplo: { "tabla": "Precios del menú", "como": "objetos" }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      tablero: refTablero,
      tabla: z.string().min(1).describe('Título o id de la tabla (leer_lienzo los da).'),
      desde: z.number().int().min(1).optional().describe('Primera fila a devolver (1 = la primera). De fábrica, 1.'),
      cantidad: z.number().int().min(1).max(500).optional().describe('Cuántas filas (de fábrica, 200).'),
      como: z.enum(['matriz', 'objetos']).optional(),
    }),
    soloLectura: true,
    async ejecutar(s, _a, a) {
      const tf = await tableroDe(s, a)
      const e = await tablaDe(s, tf.id, a.tabla)
      const t = leerTabla(e.datos)
      const orden = filasOrdenadas(t)
      const desde = (a.desde ?? 1) - 1
      const trozo = orden.slice(desde, desde + (a.cantidad ?? 200))
      const resumen: Record<string, Record<string, number | null>> = {}
      for (const c of t.columnas) if (c.resumen && c.resumen !== 'ninguno') resumen[c.nombre] = { [c.resumen]: resumir(c, t.filas) }
      const columna = t.orden ? t.columnas.find((c) => c.id === t.orden!.columna) : undefined
      return limpio({
        id: e.id,
        titulo: t.titulo || undefined,
        columnas: t.columnas.map((c) => limpio({ id: c.id, nombre: c.nombre, tipo: c.tipo, moneda: c.tipo === 'moneda' ? c.moneda : undefined, opciones: c.opciones?.map((o) => o.nombre), resumen: c.resumen })),
        ordenada_por: columna ? `${columna.nombre} (${t.orden!.direccion})` : undefined,
        total: t.filas.length,
        desde: desde + 1,
        ids: trozo.map((f) => f.id),
        filas:
          a.como === 'objetos'
            ? trozo.map((f) => Object.fromEntries(t.columnas.map((c) => [c.nombre, f.celdas[c.id] ?? null])))
            : trozo.map((f) => t.columnas.map((c) => f.celdas[c.id] ?? null)),
        resumen: Object.keys(resumen).length ? resumen : undefined,
        ...rectDe(e),
        url: tf.url,
      })
    },
  }),

  definir({
    nombre: 'actualizar_tabla',
    titulo: 'Cambiar una tabla del lienzo',
    descripcion:
      'Cambia una tabla con una lista de operaciones, todo o nada (si una falla, no se guarda ninguna): agregar_filas, cambiar_celdas (por id de fila o número, y columna por nombre), quitar_filas, mover_fila, reemplazar_filas, agregar_columna, cambiar_columna (nombre, tipo, formato, ancho, resumen; al cambiar el tipo se convierten los valores), quitar_columna y ordenar. Las filas se nombran por su id (leer_tabla los da) o por su número tal como se ve. También cambia título y estilo. Hasta 50 operaciones por llamada. Devuelve los id de las filas nuevas. Ejemplo: { "tabla": "Precios del menú", "operaciones": [ { "op": "agregar_filas", "filas": [ { "Plato": "Flan", "Precio": 1800 } ] }, { "op": "cambiar_celdas", "celdas": [ { "fila": 1, "columna": "Precio", "valor": 4500 } ] }, { "op": "ordenar", "columna": "Precio", "direccion": "desc" } ] }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      tablero: refTablero,
      tabla: z.string().min(1).describe('Título o id de la tabla.'),
      titulo: z.string().max(120).optional(),
      operaciones: z.array(esquemaOperacion).max(50).optional(),
      ...estiloTabla,
    }),
    soloLectura: false,
    idempotente: false,
    async ejecutar(s, actor, a) {
      const tf = await tableroDe(s, a)
      const e = await tablaDe(s, tf.id, a.tabla)
      if (!a.operaciones?.length && a.titulo === undefined && a.color === undefined && a.cabecera === undefined && a.rayas === undefined && a.numeros_fila === undefined)
        throw new ErrorDominio('No hay nada para cambiar: pasá "operaciones" o el título o el estilo.')
      const antes = new Set(leerTabla(e.datos).filas.map((f) => f.id))
      const r = await s.operarTabla({ actor }, e.id, (a.operaciones ?? []).map(operacionDesde), {
        estricto: true,
        cambios: limpio({ titulo: a.titulo, color: a.color, cabecera: a.cabecera, rayas: a.rayas, numerosFila: a.numeros_fila }),
      })
      const t = leerTabla(r.elemento.datos)
      const nuevas = t.filas.filter((f) => !antes.has(f.id)).map((f) => f.id)
      return limpio({
        ok: true,
        mensaje: `Listo: la tabla «${t.titulo || 'sin título'}» tiene ${t.filas.length} filas y ${t.columnas.length} columnas.`,
        tabla: { id: e.id, filas: t.filas.length, columnas: columnasCortas(t.columnas), ...rectDe(r.elemento) },
        filas_nuevas: nuevas.length ? nuevas : undefined,
        avisos: r.avisos.length ? r.avisos : undefined,
        url: tf.url,
      })
    },
  }),

  definir({
    nombre: 'crear_grafico',
    titulo: 'Crear un gráfico en el lienzo',
    descripcion:
      'Crea un gráfico en el lienzo: barras, barras_h (horizontales), lineas, area, torta, anillo o embudo. Se arma SOLO desde una tabla del lienzo ("tabla": cambia la tabla y el gráfico se actualiza) o con datos propios ("datos"); las dos formas no van juntas. Con tabla, elegí la columna de categorías ("categoria") y las numéricas ("series"); si una categoría se repite se suma (o "agrupar": "promedio" o "contar": sin series cuenta filas, por ejemplo tarjetas por estado). Sin categoria ni series elige solo. Qué tipo usar: barras para comparar, lineas/area para evolución en el tiempo, torta/anillo para partes de un total (pocas categorías; lo que sobra de 8 va a «Otros»), embudo para pasos. Sin x/y se pone al lado de su tabla (o en el "marco" pedido). Devuelve el id y, si falta algo, un aviso. Ejemplos: { "tipo": "barras", "titulo": "Precio por plato", "tabla": "Precios del menú", "categoria": "Plato", "series": ["Precio"] } · { "tipo": "torta", "titulo": "Pendientes por área", "datos": { "categorias": ["Cocina", "Salón"], "series": [ { "nombre": "Tarjetas", "valores": [12, 7] } ] } }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      tablero: refTablero,
      tipo: z.enum(IDS_GRAFICO).describe('barras, barras_h, lineas, area, torta, anillo o embudo.'),
      marco: z.string().optional().describe('Título o id del marco donde ponerlo.'),
      x: z.number().optional(),
      y: z.number().optional(),
      ancho: z.number().min(240).max(4000).optional().describe('De fábrica, 480.'),
      alto: z.number().min(180).max(4000).optional().describe('De fábrica, 320.'),
      bloqueado: z.boolean().optional(),
      ...paramsGrafico,
    }),
    soloLectura: false,
    idempotente: false,
    async ejecutar(s, actor, a) {
      const tf = await tableroDe(s, a)
      const { elemento, resuelto } = await s.crearGrafico(
        { actor },
        tf.id,
        limpio({ ...cambiosGrafico(a), tipo: a.tipo as TipoGrafico, marco: a.marco, x: a.x, y: a.y, ancho: a.ancho, alto: a.alto, bloqueado: a.bloqueado }),
      )
      const g = leerGrafico(elemento.datos)
      return limpio({
        ok: true,
        mensaje: `Creé el gráfico «${g.titulo || g.tipo}» (${resuelto.categorias.length} categorías, ${resuelto.series.length} ${resuelto.series.length === 1 ? 'serie' : 'series'}).`,
        grafico: { id: elemento.id, tipo: g.tipo, ...rectDe(elemento) },
        lee_de: g.fuente ? g.fuente.tabla : undefined,
        aviso: resuelto.aviso,
        url: tf.url,
      })
    },
  }),

  definir({
    nombre: 'actualizar_grafico',
    titulo: 'Cambiar un gráfico del lienzo',
    descripcion:
      'Cambia un gráfico: su tipo, la tabla o las columnas de las que lee, sus datos propios, el título o el estilo. Lo que no pasás queda como estaba. Para moverlo o cambiarle el tamaño, actualizar_lienzo. Para ver lo que dibuja ahora, leer_lienzo (devuelve sus datos ya resueltos). Ejemplo: { "grafico": "Precio por plato", "tipo": "barras_h", "series": ["Precio", "Margen"] }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      tablero: refTablero,
      grafico: z.string().min(1).describe('Título o id del gráfico (leer_lienzo los da).'),
      tipo: z.enum(IDS_GRAFICO).optional(),
      ...paramsGrafico,
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const tf = await tableroDe(s, a)
      const e = await graficoDe(s, tf.id, a.grafico)
      const { elemento, resuelto } = await s.actualizarGrafico({ actor }, e.id, cambiosGrafico(a))
      const g = leerGrafico(elemento.datos)
      return limpio({
        ok: true,
        mensaje: `Cambié el gráfico «${g.titulo || g.tipo}».`,
        grafico: { id: elemento.id, tipo: g.tipo, ...rectDe(elemento) },
        aviso: resuelto.aviso,
        url: tf.url,
      })
    },
  }),
]

/** Para leer_lienzo: lo que dibuja un gráfico, en datos (hasta 30 categorías). */
export function graficoLeido(e: ElementoLienzo, tabla: ElementoLienzo | undefined) {
  const g = leerGrafico(e.datos)
  const t = tabla && tabla.tipo === 'tabla' ? leerTabla(tabla.datos) : null
  const r = resolverGrafico(g, t)
  return limpio({
    grafico: g.tipo,
    titulo: g.titulo || undefined,
    lee_de: g.fuente ? (t?.titulo || g.fuente.tabla) : undefined,
    categoria: g.fuente && t ? t.columnas.find((c) => c.id === g.fuente!.categoria)?.nombre : undefined,
    series: r.series.map((s) => s.nombre),
    categorias: r.categorias.slice(0, 30),
    valores: r.series.map((s) => s.valores.slice(0, 30)),
    aviso: r.aviso,
  })
}

/** Para leer_lienzo: una tabla en una línea (título, columnas con su tipo y cuántas filas). Los datos, con leer_tabla. */
export function tablaLeida(e: ElementoLienzo) {
  const t = leerTabla(e.datos)
  return limpio({
    titulo: t.titulo || undefined,
    columnas: t.columnas.map((c) => `${c.nombre} (${c.tipo})`),
    filas: t.filas.length,
    leer_con: 'leer_tabla',
  })
}
