// Herramientas del lienzo: leer_lienzo, ver_lienzo (la foto), agregar_al_lienzo, armar_en_lienzo, actualizar_lienzo y convertir_objeto.
// El texto va y vuelve en Markdown; el estilo, con los mismos nombres al escribir y al leer (lo que devuelve
// leer_lienzo se puede copiar tal cual en agregar o actualizar).
import { z } from 'zod'
import { centroDentro, contenidoDe, marcoDe, ordenarMarcos } from '../../../compartido/geometria'
import { IDS_ICONO } from '../../../compartido/iconos'
import { ESTILOS_FABRICA, FORMAS, leerForma, leerMarco, leerNota, leerTarjeta, leerTexto, MAX_CONECTORES_ARMAR, MAX_OBJETOS_ARMAR, TITULOS_EN, type TipoForma } from '../../../compartido/lienzo'
import { esDocRico, markdownDesdeDoc, textoPlano } from '../../../compartido/rico'
import { docDesdeMarkdown } from '../../../compartido/rico-markdown'
import type { Color, Conector, ElementoLienzo, Lado, Punta, TipoElemento } from '../../../compartido/tipos'
import { conImagenes } from '../diseno/herramientas-mcp'
import { fotoDeLienzo } from '../diseno/foto-lienzo'
import { articuloTipo, ErrorDominio, type EstiloConectorEntrada, type NuevoObjetoLienzo, type Servicio } from '../dominio/servicio'
import { colores, COLORES, definir, limpio, refProyecto, refTablero, tableroDe, urlTablero, urlTarjeta } from './comun'
import { graficoLeido, tablaLeida } from './tablas'

// ───────── parámetros de estilo (los mismos en agregar, armar y actualizar) ─────────

const IDS_FORMA = FORMAS.map((f) => f.id) as [TipoForma, ...TipoForma[]]
const puntas = z.enum(['ninguna', 'flecha', 'flecha_abierta', 'triangulo', 'punto', 'rombo', 'barra'])
const conNinguno = z.union([colores, z.literal('ninguno')])
const conBlanco = z.union([colores, z.literal('ninguno'), z.literal('blanco')])

const paramsEstilo = {
  color: conNinguno
    .optional()
    .describe('Nota: color del papel (de fábrica, amarillo). Marco: su color. Forma: lo mismo que "relleno". Conector: color de la línea ("ninguno" vuelve al de fábrica).'),
  fuente: z
    .enum(['sans', 'serif', 'mono', 'mano', 'titulos'])
    .optional()
    .describe('Letra (nota, texto o forma): sans (la de la app, de fábrica), serif (editorial), mono (código), mano (manuscrita) o titulos (grotesca para títulos).'),
  tamano: z
    .union([z.number().min(8).max(400), z.literal('auto')])
    .optional()
    .describe('Tamaño de la letra en px a zoom 100 % (8 a 400; un texto sale en 21). "auto" (notas y formas, de fábrica en las notas) ajusta la letra al objeto.'),
  alineacion: z.enum(['izquierda', 'centro', 'derecha', 'justificado']).optional().describe('Alineación del texto.'),
  alineacion_vertical: z.enum(['arriba', 'medio', 'abajo']).optional().describe('Nota o forma: dónde va el texto a lo alto.'),
  color_texto: z.union([colores, z.literal('auto')]).optional().describe('Color de la letra; "auto" (de fábrica) elige la que se lee sobre el fondo.'),
  fondo: conBlanco.optional().describe('Texto: color de fondo (como un resaltado de bloque), "blanco" o "ninguno".'),
  forma: z
    .enum(IDS_FORMA)
    .optional()
    .describe(
      'Forma: rectangulo, redondeado (de fábrica), pildora (inicio o fin), elipse (estado), rombo (decisión), triangulo (aviso), hexagono (preparación), paralelogramo (entrada o salida), cilindro (datos), documento, estrella, globo (comentario) o flecha.',
    ),
  relleno: conBlanco.optional().describe('Forma: color del relleno (de fábrica, azul), "blanco" (con borde gris, como una hoja) o "ninguno".'),
  icono: z
    .enum([...IDS_ICONO, 'ninguno'])
    .optional()
    .describe('Forma: un ícono del catálogo (persona, cubiertos, moneda, reloj, candado, estrella, base_de_datos, rama…; la lista completa está en leer_guia, tema "diagramas"). Una forma con ícono y sin texto, relleno ni borde es un ícono solo. "ninguno" lo saca.'),
  icono_posicion: z.enum(['arriba', 'izquierda']).optional().describe('Forma: el ícono arriba del texto (de fábrica) o a su izquierda.'),
  tono: z.enum(['suave', 'fuerte']).optional().describe('Forma: relleno suave (pastel, de fábrica) o fuerte (saturado, con letra clara).'),
  borde: conNinguno.optional().describe('Forma: color del borde o "ninguno" (de fábrica).'),
  grosor_borde: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional().describe('Forma: borde de 1, 2 o 4 px.'),
  estilo_borde: z.enum(['solido', 'rayado', 'punteado']).optional().describe('Forma: borde sólido, rayado o punteado.'),
  opacidad: z.number().min(0.1).max(1).optional().describe('Forma: 0.1 a 1 (afecta relleno y borde, no el texto).'),
  variante: z.enum(['compacta', 'normal', 'expandida']).optional().describe('Tarjeta: compacta (solo el título), normal o expandida (con el porqué).'),
  relleno_marco: z.enum(['tinte', 'tenue', 'liso']).optional().describe('Marco: tinte (su color, de fábrica), tenue (casi transparente) o liso (como una hoja).'),
  titulo_en: z
    .enum(TITULOS_EN)
    .optional()
    .describe('Marco: dónde va el título. "afuera" (de fábrica, arriba del marco), "izquierda" (un carril: el título adentro, a la izquierda, en vertical, como un andarivel) o "arriba" (una franja adentro).'),
}

const LADO = z.enum(['arriba', 'derecha', 'abajo', 'izquierda', 'auto'])

const paramsConector = {
  trazo: z.enum(['curvo', 'ortogonal', 'recto']).optional().describe('Conector: curvo (de fábrica), ortogonal (en ángulo) o recto.'),
  punta_inicio: puntas.optional().describe('Conector: punta del comienzo (de fábrica, ninguna): ninguna, flecha, flecha_abierta, triangulo, punto, rombo o barra.'),
  punta_fin: puntas.optional().describe('Conector: punta del final (de fábrica, flecha).'),
  linea: z.enum(['solido', 'rayado', 'punteado']).optional().describe('Conector: línea sólida (de fábrica), rayada o punteada.'),
  grosor: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6)]).optional().describe('Conector: 1, 2 (de fábrica), 3, 4 o 6 px.'),
  etiqueta: z.string().max(80).optional().describe('Conector: texto sobre la línea ("sí", "después"…). En actualizar, "" la saca.'),
  lado_desde: LADO.optional().describe('Conector: de qué lado del objeto de origen sale la flecha (arriba, derecha, abajo o izquierda). "auto" (de fábrica) lo elige Telar según dónde está el otro objeto.'),
  lado_hasta: LADO.optional().describe('Conector: de qué lado del objeto de destino entra la flecha. "auto" (de fábrica) lo elige Telar.'),
}

const TEXTO_MD =
  'Markdown: **negrita**, *cursiva*, ~~tachado~~, <u>subrayado</u>, [link](https://…), listas ("- ", "1. ", "- [ ] " para tareas) y, en los textos, títulos ("# " y "## "). Un renglón nuevo es un renglón nuevo.'

const TIPOS_OBJETO = ['nota', 'texto', 'forma', 'marco', 'tarjeta', 'lista', 'imagen', 'enlace', 'figma'] as const

/** Qué parámetro de estilo va a qué clave de `datos`, y a qué tipos se aplica. */
const CLAVES_ESTILO: Record<string, { clave: string; tipos: TipoElemento[] }> = {
  color: { clave: 'color', tipos: ['nota', 'marco', 'forma'] },
  fuente: { clave: 'fuente', tipos: ['nota', 'texto', 'forma'] },
  tamano: { clave: 'tamano', tipos: ['nota', 'texto', 'forma'] },
  alineacion: { clave: 'alineacion', tipos: ['nota', 'texto', 'forma'] },
  alineacion_vertical: { clave: 'alineacionV', tipos: ['nota', 'forma'] },
  color_texto: { clave: 'colorTexto', tipos: ['nota', 'texto', 'forma'] },
  fondo: { clave: 'fondo', tipos: ['texto'] },
  forma: { clave: 'forma', tipos: ['forma'] },
  relleno: { clave: 'relleno', tipos: ['forma'] },
  tono: { clave: 'tono', tipos: ['forma'] },
  borde: { clave: 'borde', tipos: ['forma'] },
  grosor_borde: { clave: 'bordeGrosor', tipos: ['forma'] },
  estilo_borde: { clave: 'bordeEstilo', tipos: ['forma'] },
  opacidad: { clave: 'opacidad', tipos: ['forma'] },
  variante: { clave: 'variante', tipos: ['tarjeta'] },
  relleno_marco: { clave: 'relleno', tipos: ['marco'] },
  titulo_en: { clave: 'tituloEn', tipos: ['marco'] },
  icono: { clave: 'icono', tipos: ['forma'] },
  icono_posicion: { clave: 'iconoPosicion', tipos: ['forma'] },
}
const CLAVES_CONECTOR = ['trazo', 'punta_inicio', 'punta_fin', 'linea', 'grosor', 'etiqueta', 'lado_desde', 'lado_hasta', 'desde', 'hasta'] as const

const listaTipos = (ts: TipoElemento[]) => ts.map((t) => articuloTipo(t)).join(', ').replace(/, ([^,]*)$/, ' o $1')

/** Lo que probablemente se quiso decir, cuando un estilo no corresponde al tipo. */
const PISTAS: Record<string, Partial<Record<TipoElemento, string>>> = {
  color: { texto: 'En un texto, el color de la letra es color_texto (y el de fondo, fondo).', tarjeta: 'Una tarjeta toma el color de sus etiquetas (cambialas con actualizar_tarjeta).' },
  relleno: { nota: 'En una nota, el color del papel es color.', marco: 'En un marco, el relleno es relleno_marco (tinte, tenue o liso) y el color es color.' },
  relleno_marco: { forma: 'En una forma, el relleno es relleno (un color o "ninguno").' },
  fondo: { nota: 'En una nota, el color del papel es color.', forma: 'En una forma, el color de adentro es relleno.' },
  forma: { nota: 'Para que una nota sea una forma, usá convertir_objeto.', texto: 'Para que un texto sea una forma, usá convertir_objeto.' },
}

/** Los parámetros de estilo de un objeto → `datos`, con un error claro si alguno no corresponde a su tipo. */
function estiloDesde(tipo: TipoElemento, a: Record<string, unknown>): Record<string, unknown> {
  const datos: Record<string, unknown> = {}
  for (const [param, { clave, tipos }] of Object.entries(CLAVES_ESTILO)) {
    const v = a[param]
    if (v === undefined) continue
    if (!tipos.includes(tipo))
      throw new ErrorDominio(`«${param}» no se aplica a ${articuloTipo(tipo)}: sirve para ${listaTipos(tipos)}. ${PISTAS[param]?.[tipo] ?? 'Sacalo de la llamada.'}`)
    if (param === 'tamano' && v === 'auto' && tipo === 'texto') throw new ErrorDominio('tamano "auto" es para notas y formas; en un texto va un número (8 a 400).')
    if (param === 'color' && v === 'ninguno')
      throw new ErrorDominio(tipo === 'forma' ? 'Para una forma sin relleno usá relleno: "ninguno".' : `${articuloTipo(tipo)} necesita un color: ${COLORES.join(', ')}.`)
    // En una forma, "color" es el relleno.
    datos[tipo === 'forma' && param === 'color' ? 'relleno' : clave] = (param === 'fondo' || param === 'icono') && v === 'ninguno' ? null : v
  }
  return datos
}

function estiloConectorDesde(a: Record<string, unknown>): EstiloConectorEntrada & { etiqueta?: string } {
  return limpio({
    trazo: a.trazo as EstiloConectorEntrada['trazo'],
    puntaInicio: a.punta_inicio as Punta | undefined,
    puntaFin: a.punta_fin as Punta | undefined,
    guion: a.linea as EstiloConectorEntrada['guion'],
    grosor: a.grosor as number | undefined,
    color: a.color === undefined ? undefined : a.color === 'ninguno' ? null : (a.color as Color),
    etiqueta: a.etiqueta as string | undefined,
    // «auto» (o no decir nada) deja que Telar elija el lado según dónde está el otro objeto.
    desdeLado: a.lado_desde === undefined ? undefined : a.lado_desde === 'auto' ? null : (a.lado_desde as Lado),
    hastaLado: a.lado_hasta === undefined ? undefined : a.lado_hasta === 'auto' ? null : (a.lado_hasta as Lado),
  })
}

// ───────── lectura: el lienzo como árbol ─────────

const corto = (t: string, n = 48) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

/** El texto de un objeto como lo ve la IA: Markdown si es enriquecido, el plano si no. */
function textoDe(e: ElementoLienzo): string | undefined {
  if (esDocRico(e.datos.rico)) return markdownDesdeDoc(e.datos.rico) || undefined
  return typeof e.datos.texto === 'string' && e.datos.texto ? e.datos.texto : undefined
}

/** Cómo se llama un objeto en una línea (para los extremos de un conector). */
function nombreCorto(e: ElementoLienzo | undefined, claves: Map<string, string>): string {
  if (!e) return '?'
  if (e.tipo === 'marco') return `marco «${corto(String(e.datos.titulo ?? ''), 40)}»`
  if (e.tarjetaId) return claves.get(e.tarjetaId) ?? 'tarjeta'
  const plano = esDocRico(e.datos.rico) ? textoPlano(e.datos.rico) : String(e.datos.texto ?? e.datos.titulo ?? '')
  return corto(plano.split('\n')[0] ?? '', 40) || articuloTipo(e.tipo)
}

/** El estilo de un objeto con los nombres de los parámetros, sin lo que está de fábrica. */
function estiloLeido(e: ElementoLienzo): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  const si = (cond: boolean, k: string, v: unknown) => cond && (r[k] = v)
  if (e.tipo === 'nota') {
    const d = leerNota(e.datos)
    const f = ESTILOS_FABRICA.nota
    r.color = d.color
    si(d.fuente !== f.fuente, 'fuente', d.fuente)
    si(d.tamano !== f.tamano, 'tamano', d.tamano)
    si(d.alineacion !== f.alineacion, 'alineacion', d.alineacion)
    si(d.alineacionV !== f.alineacionV, 'alineacion_vertical', d.alineacionV)
    si(d.colorTexto !== f.colorTexto, 'color_texto', d.colorTexto)
  } else if (e.tipo === 'texto') {
    const d = leerTexto(e.datos)
    const f = ESTILOS_FABRICA.texto
    si(d.fuente !== f.fuente, 'fuente', d.fuente)
    si(d.tamano !== f.tamano, 'tamano', d.tamano)
    si(d.alineacion !== f.alineacion, 'alineacion', d.alineacion)
    si(d.colorTexto !== f.colorTexto, 'color_texto', d.colorTexto)
    si(!!d.fondo, 'fondo', d.fondo)
  } else if (e.tipo === 'forma') {
    const d = leerForma(e.datos)
    const f = ESTILOS_FABRICA.forma
    r.forma = d.forma
    r.relleno = d.relleno
    si(d.tono !== f.tono, 'tono', d.tono)
    si(d.borde !== 'ninguno', 'borde', d.borde)
    si(d.borde !== 'ninguno' && d.bordeGrosor !== f.bordeGrosor, 'grosor_borde', d.bordeGrosor)
    si(d.borde !== 'ninguno' && d.bordeEstilo !== f.bordeEstilo, 'estilo_borde', d.bordeEstilo)
    si(d.opacidad !== f.opacidad, 'opacidad', d.opacidad)
    si(d.fuente !== f.fuente, 'fuente', d.fuente)
    si(d.tamano !== f.tamano, 'tamano', d.tamano)
    si(d.alineacion !== f.alineacion, 'alineacion', d.alineacion)
    si(d.alineacionV !== f.alineacionV, 'alineacion_vertical', d.alineacionV)
    si(d.colorTexto !== f.colorTexto, 'color_texto', d.colorTexto)
    si(!!d.icono, 'icono', d.icono)
    si(!!d.icono && d.iconoPosicion !== 'arriba', 'icono_posicion', d.iconoPosicion)
  } else if (e.tipo === 'marco') {
    const d = leerMarco(e.datos)
    r.color = d.color
    si(d.relleno !== 'tinte', 'relleno_marco', d.relleno)
    si(d.tituloEn !== 'afuera', 'titulo_en', d.tituloEn)
  } else if (e.tipo === 'tarjeta') {
    const d = leerTarjeta(e.datos)
    si(d.variante !== 'normal', 'variante', d.variante)
  }
  return r
}

function estiloConectorLeido(c: Conector): Record<string, unknown> {
  return limpio({
    trazo: c.trazo !== 'curvo' ? c.trazo : undefined,
    punta_inicio: c.puntaInicio !== 'ninguna' ? c.puntaInicio : undefined,
    punta_fin: c.puntaFin !== 'flecha' ? c.puntaFin : undefined,
    linea: c.guion !== 'solido' ? c.guion : undefined,
    color: c.color ?? undefined,
    grosor: c.grosor !== 2 ? c.grosor : undefined,
    lado_desde: c.desdeLado ?? undefined,
    lado_hasta: c.hastaLado ?? undefined,
  })
}

const rect = (e: ElementoLienzo) => ({ x: Math.round(e.x), y: Math.round(e.y), ancho: Math.round(e.ancho), alto: Math.round(e.alto) })

/** Con más de esto (y sin pedir un marco), los marcos vienen con la cuenta y no con su contenido. */
const MUCHOS = 200

/**
 * El lienzo de un tablero como árbol: los marcos en el orden en que se recorren (con lo que tienen adentro), lo que está
 * suelto y los conectores con los nombres de sus extremos. Lo usan leer_lienzo y leer_tablero.
 */
export async function arbolDelLienzo(s: Servicio, tableroId: string, marcoRef?: string) {
  const completo = await s.leerTableroCompleto(tableroId)
  const els = completo.elementos
  const claves = new Map(completo.tarjetas.map((t) => [t.id, t.clave]))
  const tarjetas = new Map(completo.tarjetas.map((t) => [t.id, t]))
  const listas = new Map(completo.listas.map((l) => [l.id, l.nombre]))
  const marcos = ordenarMarcos(els.filter((e) => e.tipo === 'marco'))
  const objeto = (e: ElementoLienzo) => {
    const t = e.tarjetaId ? tarjetas.get(e.tarjetaId) : undefined
    return limpio({
      id: e.id,
      tipo: e.tipo,
      texto: e.tipo === 'nota' || e.tipo === 'texto' || e.tipo === 'forma' ? textoDe(e) : undefined,
      clave: t?.clave,
      titulo: t ? t.titulo : e.tipo === 'enlace' || e.tipo === 'figma' || e.tipo === 'imagen' ? (e.datos.titulo as string | undefined) || undefined : undefined,
      lista: t?.listaId ? listas.get(t.listaId) : e.listaId ? listas.get(e.listaId) : undefined,
      url: typeof e.datos.url === 'string' ? e.datos.url : undefined,
      ...rect(e),
      ...estiloLeido(e),
      bloqueado: e.bloqueado || undefined,
      ...(e.tipo === 'tabla' ? tablaLeida(e) : e.tipo === 'grafico' ? graficoLeido(e, els.find((x) => x.id === (e.datos.fuente as { tabla?: string } | null)?.tabla)) : {}),
    })
  }
  let elegido: ElementoLienzo | null = null
  if (marcoRef) {
    const r = await s.resolverElemento(tableroId, marcoRef)
    if (r.tipo !== 'marco') throw new ErrorDominio(`«${marcoRef}» no es un marco (es ${articuloTipo(r.tipo)}): pasá el título o el id de un marco.`)
    elegido = els.find((e) => e.id === r.id) ?? r
  }
  const visibles = elegido ? [elegido, ...contenidoDe(els, elegido)] : els
  const marcosVisibles = marcos.filter((m) => visibles.includes(m))
  const resumido = !elegido && els.length > MUCHOS
  const salidaMarcos = marcosVisibles.map((m) => {
    const padre = marcoDe(m, marcos)
    const adentro = visibles.filter((e) => e.tipo !== 'marco' && marcoDe(e, marcos)?.id === m.id)
    return limpio({
      id: m.id,
      titulo: String(m.datos.titulo ?? '') || undefined,
      ...rect(m),
      ...estiloLeido(m),
      dentro_de: padre && visibles.includes(padre) ? padre.id : undefined,
      bloqueado: m.bloqueado || undefined,
      objetos: resumido ? adentro.length : adentro.map(objeto),
    })
  })
  const sueltos = elegido ? [] : visibles.filter((e) => e.tipo !== 'marco' && !marcoDe(e, marcos))
  const ids = new Set(visibles.map((e) => e.id))
  const porId = new Map(els.map((e) => [e.id, e]))
  const conectores = completo.conectores
    .filter((c) => ids.has(c.desdeId) || ids.has(c.hastaId))
    .map((c) =>
      limpio({
        id: c.id,
        desde: c.desdeId,
        hasta: c.hastaId,
        desde_texto: nombreCorto(porId.get(c.desdeId), claves),
        hasta_texto: nombreCorto(porId.get(c.hastaId), claves),
        etiqueta: c.etiqueta || undefined,
        ...estiloConectorLeido(c),
      }),
    )
  return limpio({
    tablero: { id: completo.tablero.id, nombre: completo.tablero.nombre, proyecto: completo.proyecto.prefijo },
    url: urlTablero(completo.proyecto.prefijo, completo.tablero.slug, 'lienzo'),
    resumen: `${marcos.length} ${marcos.length === 1 ? 'marco' : 'marcos'}, ${els.length - marcos.length} objetos y ${completo.conectores.length} conectores`,
    nota: resumido ? `Hay muchos objetos: pedí un marco con «marco» (título o id) para ver lo que tiene adentro.` : undefined,
    marcos: salidaMarcos,
    sueltos: elegido ? undefined : resumido ? sueltos.length : sueltos.map(objeto),
    conectores: resumido ? conectores.length : conectores,
  })
}

// ───────── las herramientas ─────────

/** Lo que se devuelve de un objeto creado o cambiado: lo justo para el paso siguiente. */
function objetoCorto(e: ElementoLienzo, marcos?: ElementoLienzo[]) {
  const m = marcos ? marcoDe(e, marcos) : null
  return limpio({ id: e.id, tipo: e.tipo, ...rect(e), marco: m ? String(m.datos.titulo ?? '') || m.id : undefined })
}


const esquemaObjeto = {
  texto: z.string().max(20000).optional().describe(`Nota, texto o forma: el texto, en ${TEXTO_MD}`),
  titulo: z.string().max(200).optional().describe('Marco: su título. Link, imagen o Figma: el título que se muestra.'),
  tarjeta: z.string().optional().describe('Tipo "tarjeta": la clave de una tarjeta de este tablero (por ejemplo RC-12).'),
  lista: z.string().optional().describe('Tipo "lista": el nombre de una lista del Kanban de este tablero.'),
  url: z.string().optional().describe('Tipo "imagen", "enlace" o "figma": el link (https://…).'),
  ancho: z.number().min(24).max(20000).optional().describe('Ancho en px (si no, el de fábrica o el que pide el texto).'),
  alto: z.number().min(24).max(20000).optional(),
  bloqueado: z.boolean().optional().describe('Bloqueado: no se mueve ni se edita por error.'),
  ...paramsEstilo,
}

function nuevoDesde(tipo: (typeof TIPOS_OBJETO)[number], a: Record<string, unknown>): NuevoObjetoLienzo {
  if (a.texto !== undefined && !['nota', 'texto', 'forma'].includes(tipo))
    throw new ErrorDominio(tipo === 'marco' ? 'Un marco no lleva "texto": su nombre va en "titulo".' : `${articuloTipo(tipo)} no lleva "texto".`)
  if (tipo === 'marco' && a.titulo === undefined) a.titulo = 'Marco'
  return limpio({
    tipo,
    texto: a.texto as string | undefined,
    titulo: a.titulo as string | undefined,
    tarjeta: a.tarjeta as string | undefined,
    lista: a.lista as string | undefined,
    url: a.url as string | undefined,
    ancho: a.ancho as number | undefined,
    alto: a.alto as number | undefined,
    bloqueado: a.bloqueado as boolean | undefined,
    estilo: estiloDesde(tipo, a),
  })
}

export const HERRAMIENTAS_LIENZO = [
  definir({
    nombre: 'leer_lienzo',
    titulo: 'Leer el lienzo',
    descripcion:
      'Devuelve el lienzo de un tablero como árbol: los marcos en el orden en que se recorren, cada uno con sus objetos (id, tipo, texto en Markdown, clave si es una tarjeta, posición, tamaño y estilo, con los mismos nombres que se usan para escribir), lo que está suelto y los conectores (con el texto de sus dos extremos). Usalo antes de agregar a un marco o de cambiar algo: los id que devuelve sirven para todo. Con "marco" lee uno solo. Ejemplo: { "tablero": "Pendientes", "marco": "Mecánicas" }',
    esquema: z.strictObject({
      tablero: refTablero,
      proyecto: refProyecto,
      marco: z.string().optional().describe('Título o id de un marco: devuelve solo ese marco, lo que tiene adentro y sus conectores.'),
      quitados: z.boolean().optional().describe('true: en vez del lienzo, lo que se sacó en los últimos 30 días (con su id, para devolverlo con quitar_del_lienzo { "restaurar": true }).'),
    }),
    soloLectura: true,
    async ejecutar(s, _a, a) {
      const tf = await s.resolverTablero(a.tablero, a.proyecto, { vista: 'lienzo' })
      if (a.quitados) {
        const q = await s.quitadosDe(tf.id)
        const claves = new Map<string, string>()
        return {
          resumen: `${q.objetos.length} objetos y ${q.conectores.length} conectores sacados en los últimos 30 días`,
          objetos: q.objetos.map((e) => limpio({ id: e.id, tipo: e.tipo, texto: nombreCorto(e, claves), ...rect(e) })),
          conectores: q.conectores.map((c) => limpio({ id: c.id, desde: c.desdeId, hasta: c.hastaId, etiqueta: c.etiqueta || undefined })),
          para_devolverlos: 'quitar_del_lienzo { "restaurar": true, "objetos": [ids], "conectores": [ids] }',
        }
      }
      return arbolDelLienzo(s, tf.id, a.marco)
    },
  }),

  definir({
    nombre: 'ver_lienzo',
    titulo: 'Ver el lienzo',
    descripcion:
      'Devuelve una FOTO (PNG) del lienzo tal como lo ve una persona en la app: un marco (con su título), un área o todo el lienzo, en tema claro u oscuro, ' +
      'más una REVISIÓN de lo que se nota a simple vista: textos que se pisan, objetos muy pegados (menos de 12 px) o pegados al borde de su marco (menos de 16 px), formas que crecieron porque su texto no entra, objetos que se salen de su marco y letra chica (menos de 12 px a zoom 100 %). ' +
      'Usala SIEMPRE después de armar o cambiar algo en el lienzo, y antes de decir que está listo: arreglá lo que diga la revisión con actualizar_lienzo y volvé a mirar. ' +
      'De fábrica el zoom deja el lado mayor en 1600 px (nunca más de 100 %): para leer la letra, mirá un marco por vez; todo el lienzo sirve para ver la disposición. ' +
      'Los id que nombra la revisión son los de leer_lienzo. Ejemplo: { "tablero": "Mini juegos", "marco": "🍳 Kitchen Rush", "tema": "oscuro" } · { "tablero": "Pendientes", "area": { "x": 0, "y": 0, "ancho": 1200, "alto": 800 } }.',
    esquema: z.strictObject({
      tablero: refTablero,
      proyecto: refProyecto,
      marco: z.string().min(1).optional().describe('Título o id de un marco: la foto es ese marco con su título.'),
      area: z
        .strictObject({ x: z.number(), y: z.number(), ancho: z.number().min(10).max(40000), alto: z.number().min(10).max(40000) })
        .optional()
        .describe('Un rectángulo del lienzo (las mismas coordenadas de leer_lienzo). Sin marco ni área, la foto es todo el lienzo.'),
      tema: z.enum(['claro', 'oscuro']).optional().describe('Tema de la app (de fábrica, claro). El dueño suele usar el oscuro: mirá los dos si cambiaste colores.'),
      zoom: z.number().min(0.05).max(2).optional().describe('Zoom de la foto (1 = 100 %). De fábrica, el que deja el lado mayor en 1600 px, hasta 1.'),
    }),
    soloLectura: true,
    async ejecutar(s, _a, a) {
      if (a.marco && a.area) throw new ErrorDominio('Pasá "marco" o "area", no los dos: { "marco": "Mecánicas" } o { "area": { "x": 0, "y": 0, "ancho": 1200, "alto": 800 } }.')
      // La foto se saca abriendo la app en Chromium con la clave del MCP, que entra como la cuenta del dueño: para otra cuenta
      // abriría un lienzo del dueño si el prefijo y el nombre del tablero coinciden. Hasta que la foto corra con la sesión de
      // cada cuenta, es solo del dueño (docs/cuentas.md).
      if (!s.esDueno) throw new ErrorDominio('ver_lienzo todavía no está disponible en tu cuenta: usá leer_lienzo.', 403)
      const tf = await s.resolverTablero(a.tablero, a.proyecto, { vista: 'lienzo' })
      const f = await fotoDeLienzo(s, { tableroId: tf.id, marco: a.marco, area: a.area, zoom: a.zoom, tema: a.tema ?? 'claro' })
      const revision = f.avisos.length
        ? [`Revisión (${f.avisos.length}): arreglá con actualizar_lienzo y volvé a mirar.`, ...f.avisos.map((x) => `  - ${x}`)]
        : ['Revisión: sin textos que se pisen, objetos pegados ni letra chica.']
      const texto = [
        `Foto · ${f.que} en «${tf.nombre}» · ${f.objetos} objetos · zoom ${Math.round(f.zoom * 100)} % · imagen ${f.ancho} × ${f.alto} · tema ${a.tema ?? 'claro'} · ${f.ms} ms`,
        f.zoom < 0.5 ? 'Con este zoom la letra se ve chica: para leerla, mirá un marco por vez.' : '',
        ...revision,
        f.url,
      ].filter(Boolean)
      return conImagenes(texto.join('\n'), [{ bytes: f.bytes, mime: f.mime }])
    },
  }),

  definir({
    nombre: 'agregar_al_lienzo',
    titulo: 'Agregar al lienzo',
    descripcion:
      'Agrega UNA cosa al lienzo de un tablero: nota, texto, forma (13 formas), marco, una tarjeta del Kanban (por su clave), una lista del Kanban, una imagen, un link o un diseño de Figma; o un conector entre dos objetos. Sin x/y busca lugar solo: adentro del "marco" pedido (si no entra, el marco crece) o al costado de lo que hay. El texto va en Markdown. Los objetos se nombran por id, por la clave de su tarjeta, por el texto de una nota o por el título de un marco. Para varios objetos conectados, mejor armar_en_lienzo. Devuelve el id de lo creado. Ejemplos: { "tipo": "nota", "texto": "Los clientes **esperan** 30 s", "color": "rosa", "marco": "Mecánicas" } · { "tipo": "forma", "forma": "rombo", "texto": "¿Hay mesa?", "relleno": "amarillo" } · { "tipo": "conector", "desde": "Cliente entra", "hasta": "¿Hay mesa?", "etiqueta": "llega", "trazo": "ortogonal" }',
    esquema: z.strictObject({
      tipo: z.enum([...TIPOS_OBJETO, 'conector']).describe('Qué agregar.'),
      proyecto: refProyecto,
      tablero: refTablero,
      marco: z.string().optional().describe('Título o id del marco donde ponerlo (por ejemplo "Mecánicas").'),
      x: z.number().optional().describe('Posición (con y): si no se manda, busca lugar solo.'),
      y: z.number().optional(),
      ...esquemaObjeto,
      desde: z.string().optional().describe('Conector: objeto de origen (id, clave de tarjeta, texto de nota o título de marco).'),
      hasta: z.string().optional().describe('Conector: objeto de destino.'),
      ...paramsConector,
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const tf = await tableroDe(s, a)
      const ctx = { actor }
      if (a.tipo === 'conector') {
        if (!a.desde || !a.hasta) throw new ErrorDominio('Para un conector hacen falta "desde" y "hasta" (id, clave de tarjeta, texto de una nota o título de un marco).')
        const sobra = Object.keys(CLAVES_ESTILO).filter((k) => k !== 'color' && (a as Record<string, unknown>)[k] !== undefined)
        if (sobra.length) throw new ErrorDominio(`Un conector no lleva ${sobra.join(', ')}: sus estilos son trazo, punta_inicio, punta_fin, linea, color y grosor.`)
        const c = await s.conectarEnLienzo(ctx, tf.id, a.desde, a.hasta, estiloConectorDesde(a))
        const els = await s.elementosDe(tf.id)
        const claves = new Map<string, string>()
        const desde = els.find((e) => e.id === c.desdeId)
        const hasta = els.find((e) => e.id === c.hastaId)
        return {
          ok: true,
          mensaje: `Conecté ${nombreCorto(desde, claves)} con ${nombreCorto(hasta, claves)}.`,
          conector: { id: c.id, desde: c.desdeId, hasta: c.hastaId },
          url: tf.url,
        }
      }
      const sobra = CLAVES_CONECTOR.filter((k) => (a as Record<string, unknown>)[k] !== undefined)
      if (sobra.length) throw new ErrorDominio(`${sobra.join(', ')} ${sobra.length === 1 ? 'es' : 'son'} de los conectores; para ${articuloTipo(a.tipo)} sacalo.`)
      const nuevo = nuevoDesde(a.tipo, a)
      const e = await s.agregarAlLienzo(ctx, tf.id, { ...nuevo, marco: a.marco, x: a.x, y: a.y })
      const marcos = (await s.elementosDe(tf.id)).filter((m) => m.tipo === 'marco')
      const o = objetoCorto(e, marcos)
      return { ok: true, mensaje: `Agregué ${articuloTipo(e.tipo)}${o.marco ? ` en «${o.marco}»` : ''}.`, objeto: o, url: tf.url }
    },
  }),

  definir({
    nombre: 'armar_en_lienzo',
    titulo: 'Armar en el lienzo',
    descripcion:
      'Arma de una vez varios objetos del lienzo, ordenados (como diagrama de flujo, en fila, en columna o en grilla) y conectados entre sí: un diagrama de flujo, un mapa de ideas, un tablero de notas. Cada objeto lleva una "ref" corta que inventás ("a", "inicio"…) y los conectores se refieren a esas refs (o a algo que ya está en el lienzo). Puede ir adentro de un marco que existe ("marco"), de uno nuevo que los rodea ("nuevo_marco") o suelto al costado de lo que hay. Los objetos aceptan lo mismo que en agregar_al_lienzo (texto en Markdown y estilo). Devuelve el id de cada ref. Hasta 300 objetos y 600 conectores por llamada; un diagrama más grande va por secciones (leé antes leer_guia { "tema": "diagramas" }). Para poner cada objeto en una posición exacta adentro de un marco que ya tiene cosas, usá "posiciones": "marco" con x/y en cada objeto. Ejemplo: { "nuevo_marco": { "titulo": "Flujo del cliente" }, "objetos": [ { "ref": "a", "tipo": "forma", "forma": "pildora", "texto": "Entra" }, { "ref": "b", "tipo": "forma", "forma": "rombo", "texto": "¿Hay mesa?", "relleno": "amarillo" }, { "ref": "c", "tipo": "forma", "texto": "Se sienta", "relleno": "verde" } ], "conectores": [ { "desde": "a", "hasta": "b" }, { "desde": "b", "hasta": "c", "etiqueta": "sí" } ] }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      tablero: refTablero,
      objetos: z
        .array(
          z.strictObject({
            ref: z.string().min(1).max(40).optional().describe('Nombre corto para los conectores (si falta: "1", "2"… en orden).'),
            tipo: z.enum(TIPOS_OBJETO),
            x: z.number().optional().describe('Posición relativa al grupo (con y). Si todos la traen se respeta; si no, manda la disposición.'),
            y: z.number().optional(),
            ...esquemaObjeto,
          }),
        )
        .min(1)
        .max(MAX_OBJETOS_ARMAR)
        .describe('Los objetos, en el orden en que se ubican.'),
      conectores: z
        .array(
          z.strictObject({
            desde: z.string().min(1).describe('Ref de este pedido (o id, clave o texto de algo que ya está en el lienzo).'),
            hasta: z.string().min(1),
            color: colores.optional().describe('Color de la línea (de fábrica, gris).'),
            ...paramsConector,
          }),
        )
        .max(MAX_CONECTORES_ARMAR)
        .optional(),
      marco: z.string().optional().describe('Título o id de un marco que ya existe: todo va adentro (si no entra, el marco crece).'),
      nuevo_marco: z
        .strictObject({
          titulo: z.string().min(1).max(200),
          color: colores.optional(),
          relleno_marco: z.enum(['tinte', 'tenue', 'liso']).optional(),
          titulo_en: z.enum(TITULOS_EN).optional().describe('"izquierda" hace un carril (título adentro, a la izquierda); "arriba", una franja.'),
        })
        .optional()
        .describe('Un marco nuevo a la medida, alrededor de todo.'),
      posiciones: z
        .enum(['grupo', 'marco', 'lienzo'])
        .optional()
        .describe(
          'Cómo se leen x e y de los objetos. "grupo" (de fábrica): relativas al grupo, que se ubica en un lugar libre. "marco": desde la esquina de arriba a la izquierda del "marco" (obligatorio): quedan EXACTAMENTE ahí, sin buscar lugar ni correr nada de lo que ya hay; si algo se sale, el marco crece. "lienzo": absolutas (las mismas que devuelve leer_lienzo). En "marco" y "lienzo" todos los objetos llevan x e y.',
        ),
      tamano_letra: z.number().min(8).max(400).optional().describe('Tamaño de letra (px a zoom 100 %) para las notas, textos y formas de esta llamada que no traigan el suyo. En un diagrama que se va a mirar en una pantalla de PC, 24 a 32.'),
      disposicion: z
        .enum(['flujo', 'fila', 'columna', 'grilla'])
        .optional()
        .describe(
          'flujo (de fábrica si hay conectores): de izquierda a derecha siguiendo los conectores, con las ramas una abajo de la otra; fila (en el orden de la lista); columna (de arriba abajo); grilla (de fábrica sin conectores).',
        ),
      columnas: z.number().int().min(1).max(12).optional().describe('Grilla: cuántas columnas (si no, las que den un cuadrado).'),
      separacion: z.number().min(16).max(600).optional().describe('Espacio entre objetos en px (de fábrica, 80).'),
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const tf = await tableroDe(s, a)
      const objetos = a.objetos.map((o, i) => {
        const sobra = (['desde', 'hasta'] as const).filter((k) => (o as Record<string, unknown>)[k] !== undefined)
        if (sobra.length) throw new ErrorDominio(`objetos[${i}]: los conectores van aparte, en "conectores".`)
        const conLetra = a.tamano_letra !== undefined && (o.tipo === 'nota' || o.tipo === 'texto' || o.tipo === 'forma') && (o as Record<string, unknown>).tamano === undefined
        return { ...nuevoDesde(o.tipo, conLetra ? { ...o, tamano: a.tamano_letra } : o), ref: o.ref, x: o.x, y: o.y }
      })
      const r = await s.armarEnLienzo({ actor }, tf.id, {
        objetos,
        conectores: a.conectores?.map((c) => {
          const { etiqueta, ...estilo } = estiloConectorDesde(c)
          return { desde: c.desde, hasta: c.hasta, etiqueta, estilo }
        }),
        marco: a.marco,
        nuevoMarco: a.nuevo_marco
          ? { titulo: a.nuevo_marco.titulo, color: a.nuevo_marco.color, relleno: a.nuevo_marco.relleno_marco, tituloEn: a.nuevo_marco.titulo_en }
          : undefined,
        posiciones: a.posiciones,
        disposicion: a.disposicion,
        columnas: a.columnas,
        separacion: a.separacion,
      })
      const titulo = r.marco ? String(r.marco.datos.titulo ?? '') : ''
      const n = r.objetos.length
      return {
        ok: true,
        mensaje: `Armé ${n === 1 ? 'un objeto' : `${n} objetos`}${r.conectores.length ? ` y ${r.conectores.length === 1 ? 'un conector' : `${r.conectores.length} conectores`}` : ''}${titulo ? ` en «${titulo}»` : ''}.`,
        marco: r.marco ? { id: r.marco.id, titulo, ...rect(r.marco) } : undefined,
        objetos: Object.fromEntries(r.objetos.map((o) => [o.ref, o.elemento.id])),
        conectores: r.conectores.map((c) => c.id),
        avisos: r.avisos.length ? r.avisos : undefined,
        url: tf.url,
      }
    },
  }),

  definir({
    nombre: 'actualizar_lienzo',
    titulo: 'Cambiar algo del lienzo',
    descripcion:
      'Cambia objetos o un conector del lienzo; solo cambia lo que mandes. Para objetos: "objeto" (uno) u "objetos" (varios, el mismo cambio a todos) por id, clave de tarjeta, texto de nota o título de marco, y cualquiera de: texto (Markdown), titulo, estilo (los mismos parámetros de agregar_al_lienzo), x, y, ancho, alto, marco (lo mueve adentro de ese marco buscando lugar; "ninguno" lo saca), capa (frente o fondo) y bloqueado. Mover un marco mueve lo que tiene adentro. Para un conector: "conector" (su id, de leer_lienzo) y trazo, puntas, linea, color, grosor, etiqueta, lado_desde/lado_hasta (arriba, derecha, abajo, izquierda o auto: de qué lado sale y entra la flecha) o desde/hasta (lo engancha a otro objeto). No borra nada (para sacar algo del lienzo, quitar_del_lienzo). Ejemplos: { "objeto": "¿Hay mesa?", "relleno": "verde", "tono": "fuerte" } · { "objetos": ["RC-3", "RC-5"], "marco": "Interfaz" } · { "conector": "k3J…", "linea": "punteado", "etiqueta": "a veces", "lado_desde": "abajo", "lado_hasta": "izquierda" }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      tablero: refTablero,
      objeto: z.string().optional().describe('El objeto a cambiar (id, clave de tarjeta, texto de nota o título de marco).'),
      objetos: z.array(z.string().min(1)).min(1).max(100).optional().describe('Varios objetos: el mismo cambio a todos.'),
      conector: z.string().optional().describe('El id de un conector (lo da leer_lienzo o agregar_al_lienzo).'),
      x: z.number().optional(),
      y: z.number().optional(),
      marco: z.string().optional().describe('Mover adentro de este marco (título o id); "ninguno" lo saca afuera.'),
      capa: z.enum(['frente', 'fondo']).optional().describe('Traer al frente o mandar al fondo (los marcos siempre quedan abajo).'),
      ...esquemaObjeto,
      desde: z.string().optional().describe('Conector: enganchar el comienzo a otro objeto.'),
      hasta: z.string().optional().describe('Conector: enganchar el final a otro objeto.'),
      ...paramsConector,
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const tf = await tableroDe(s, a)
      const ctx = { actor }
      const cuantos = [a.objeto !== undefined, a.objetos !== undefined, a.conector !== undefined].filter(Boolean).length
      if (cuantos !== 1) throw new ErrorDominio('Mandá una sola de estas: "objeto" (uno), "objetos" (varios) o "conector" (el id de un conector).')
      const args = a as Record<string, unknown>

      if (a.conector) {
        const conectores = (await s.leerTableroCompleto(tf.id)).conectores
        const c = conectores.find((x) => x.id === a.conector)
        if (!c) throw new ErrorDominio(`No hay un conector con id «${a.conector}» en este lienzo. Los id están en leer_lienzo (lista "conectores").`, 404)
        const deObjeto = [...Object.keys(CLAVES_ESTILO).filter((k) => k !== 'color'), 'texto', 'titulo', 'x', 'y', 'ancho', 'alto', 'marco', 'capa', 'bloqueado', 'tarjeta', 'lista', 'url'].filter(
          (k) => args[k] !== undefined,
        )
        if (deObjeto.length) throw new ErrorDominio(`${deObjeto.join(', ')} no se aplica${deObjeto.length > 1 ? 'n' : ''} a un conector (sus campos: trazo, punta_inicio, punta_fin, linea, color, grosor, etiqueta, desde y hasta).`)
        const cambios: Parameters<Servicio['actualizarConector']>[2] = { ...estiloConectorDesde(a) }
        if (a.desde) cambios.desdeId = (await s.resolverElemento(tf.id, a.desde)).id
        if (a.hasta) cambios.hastaId = (await s.resolverElemento(tf.id, a.hasta)).id
        if ((cambios.desdeId ?? c.desdeId) === (cambios.hastaId ?? c.hastaId)) throw new ErrorDominio('Un conector necesita dos objetos distintos.')
        // Al cambiar el extremo, el lado vuelve a «auto» salvo que se pida uno.
        if (cambios.desdeId && cambios.desdeLado === undefined) cambios.desdeLado = null
        if (cambios.hastaId && cambios.hastaLado === undefined) cambios.hastaLado = null
        if (!Object.keys(cambios).length) throw new ErrorDominio('No mandaste nada para cambiar del conector.')
        const nuevo = await s.actualizarConector(ctx, c.id, cambios)
        return { ok: true, mensaje: 'Cambié el conector.', conector: { id: nuevo.id, desde: nuevo.desdeId, hasta: nuevo.hastaId, ...estiloConectorLeido(nuevo), etiqueta: nuevo.etiqueta || undefined } }
      }

      const deConector = CLAVES_CONECTOR.filter((k) => args[k] !== undefined)
      if (deConector.length) throw new ErrorDominio(`${deConector.join(', ')} ${deConector.length === 1 ? 'es' : 'son'} de los conectores: para cambiar uno mandá "conector" con su id.`)
      if (a.tarjeta !== undefined || a.lista !== undefined || a.url !== undefined)
        throw new ErrorDominio('"tarjeta", "lista" y "url" se eligen al agregar; para mostrar otra cosa, agregá un objeto nuevo.')
      const refs = a.objetos ?? [a.objeto!]
      let elementos = await s.elementosDe(tf.id)
      const objetivos: ElementoLienzo[] = []
      for (const r of refs) {
        const e = await s.resolverElemento(tf.id, r)
        if (!objetivos.some((o) => o.id === e.id)) objetivos.push(e)
      }
      if (objetivos.length > 1 && (a.x !== undefined || a.y !== undefined))
        throw new ErrorDominio('x/y son para un objeto solo; para varios usá "marco" (los acomoda adentro) o cambiá de a uno.')
      const cambios: Parameters<Servicio['actualizarElementos']>[1] = []
      for (const e of objetivos) {
        const datos: Record<string, unknown> = estiloDesde(e.tipo, args)
        if (a.texto !== undefined) {
          if (!['nota', 'texto', 'forma'].includes(e.tipo))
            throw new ErrorDominio(
              e.tipo === 'marco'
                ? 'El nombre de un marco va en "titulo".'
                : e.tipo === 'tarjeta'
                  ? 'El texto de una tarjeta es su título: cambialo con actualizar_tarjeta (por su clave).'
                  : `${articuloTipo(e.tipo)} no tiene texto para cambiar.`,
            )
          datos.rico = docDesdeMarkdown(a.texto)
        }
        if (a.titulo !== undefined) {
          if (e.tipo === 'tabla' || e.tipo === 'grafico')
            throw new ErrorDominio(`El título de ${articuloTipo(e.tipo)} se cambia con ${e.tipo === 'tabla' ? 'actualizar_tabla' : 'actualizar_grafico'} (parámetro "titulo").`)
          if (!['marco', 'enlace', 'figma', 'imagen'].includes(e.tipo)) throw new ErrorDominio(`${articuloTipo(e.tipo)} no tiene título: su texto va en "texto".`)
          datos.titulo = a.titulo
        }
        if (e.tipo === 'tabla' && (a.ancho !== undefined || a.alto !== undefined))
          throw new ErrorDominio('El tamaño de una tabla sale de sus columnas y filas: cambiá el ancho de una columna con actualizar_tabla (operación cambiar_columna, "ancho").')
        if (e.tipo === 'texto' && a.ancho !== undefined) datos.anchoAuto = false
        if (e.bloqueado && a.bloqueado !== false && (Object.keys(datos).length || a.x !== undefined || a.y !== undefined || a.ancho !== undefined || a.alto !== undefined || a.marco))
          throw new ErrorDominio(`${articuloTipo(e.tipo)} «${nombreCorto(e, new Map())}» está bloqueado: mandá bloqueado: false para poder cambiarlo.`)
        // x e y se ponen abajo (al mover un marco, lo de adentro va con él).
        cambios.push(limpio({ id: e.id, ancho: a.ancho, alto: a.alto, bloqueado: a.bloqueado, datos: Object.keys(datos).length ? datos : undefined }))
      }
      // Lo de adentro de un marco que se mueve, se mueve con él.
      const mover = (e: ElementoLienzo, x: number, y: number) => {
        const dx = x - e.x
        const dy = y - e.y
        if (!dx && !dy) return
        const c = cambios.find((x) => x.id === e.id)!
        c.x = x
        c.y = y
        if (e.tipo === 'marco')
          for (const h of contenidoDe(elementos, e)) {
            if (cambios.some((x) => x.id === h.id)) continue
            cambios.push({ id: h.id, x: h.x + dx, y: h.y + dy })
          }
      }
      if (a.marco !== undefined) {
        if (a.marco === 'ninguno') {
          for (const e of objetivos) {
            const marcos = elementos.filter((m) => m.tipo === 'marco')
            if (!marcoDe(e, marcos)) continue
            const otros = elementos.filter((x) => x.id !== e.id && !(e.tipo === 'marco' && contenidoDe(elementos, e).includes(x)))
            const lugar = await s.lugarEnLienzo(ctx, tf.id, { ancho: e.ancho, alto: e.alto }, null, otros)
            mover(e, lugar.x, lugar.y)
          }
        } else {
          for (const e of objetivos) {
            const destino = await s.resolverElemento(tf.id, a.marco)
            if (destino.id === e.id) throw new ErrorDominio('Un marco no puede ir adentro de sí mismo.')
            if (destino.tipo === 'marco' && centroDentro(e, destino) && marcoDe(e, elementos.filter((m) => m.tipo === 'marco'))?.id === destino.id) continue
            const otros = elementos.filter((x) => x.id !== e.id && !(e.tipo === 'marco' && contenidoDe(elementos, e).includes(x)))
            const lugar = await s.lugarEnLienzo(ctx, tf.id, { ancho: e.ancho, alto: e.alto }, a.marco, otros)
            mover(e, lugar.x, lugar.y)
            // Lo que ya se ubicó ocupa lugar para el siguiente.
            elementos = elementos.map((x) => (x.id === e.id ? { ...x, x: lugar.x, y: lugar.y } : x))
          }
        }
      } else if (objetivos.length === 1 && (a.x !== undefined || a.y !== undefined)) {
        const e = objetivos[0]!
        mover(e, a.x ?? e.x, a.y ?? e.y)
      }
      const reales = cambios.filter((c) => Object.keys(c).length > 1)
      if (!reales.length && !a.capa) throw new ErrorDominio('No mandaste nada para cambiar (texto, estilo, posición, tamaño, marco, capa o bloqueado).')
      if (reales.length) await s.actualizarElementos(ctx, reales)
      if (a.capa) await s.apilarEnLienzo(ctx, tf.id, objetivos.map((o) => o.id), a.capa)
      const ahora = await s.elementosDe(tf.id)
      const marcos = ahora.filter((m) => m.tipo === 'marco')
      const salida = objetivos.map((o) => ahora.find((x) => x.id === o.id)!).map((e) => objetoCorto(e, marcos))
      return {
        ok: true,
        mensaje: objetivos.length === 1 ? `Cambié ${articuloTipo(objetivos[0]!.tipo)}.` : `Cambié ${objetivos.length} objetos.`,
        objetos: salida,
      }
    },
  }),

  definir({
    nombre: 'quitar_del_lienzo',
    titulo: 'Sacar algo del lienzo (o devolverlo)',
    descripcion:
      'Saca objetos y conectores del lienzo. NO los borra de verdad: quedan guardados 30 días y vuelven con "restaurar": true y los mismos id (o los que da leer_lienzo con "quitados": true). Los objetos se nombran como en actualizar_lienzo (id, clave de tarjeta, texto de nota, título de marco); los conectores, por id. Un marco sale solo (lo que tiene adentro se queda, suelto) salvo con "con_contenido": true, que saca también todo lo de adentro. Una tarjeta o una lista que se saca del lienzo sigue en el Kanban. Lo bloqueado no sale (desbloquealo antes). Hasta 100 objetos y 200 conectores por llamada; todo o nada. Devuelve los id de lo sacado: guardalos si querés deshacerlo. Ejemplos: { "objetos": ["Nota vieja", "RC-5"] } · { "objetos": ["Sección vieja"], "con_contenido": true } · { "restaurar": true, "objetos": ["k3J…"], "conectores": ["m9Q…"] }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      tablero: refTablero,
      objetos: z.array(z.string().min(1)).min(1).max(100).optional().describe('Los objetos a sacar (o a devolver, con "restaurar").'),
      conectores: z.array(z.string().min(1)).min(1).max(200).optional().describe('Los conectores a sacar (o a devolver), por id.'),
      con_contenido: z.boolean().optional().describe('Con un marco: sacar también todo lo que tiene adentro.'),
      restaurar: z.boolean().optional().describe('true: devolver al lienzo lo que se sacó. "objetos" y "conectores" son entonces los id de lo sacado.'),
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const tf = await tableroDe(s, a)
      if (a.restaurar) {
        if (a.con_contenido) throw new ErrorDominio('"con_contenido" es para sacar; al restaurar, listá los id de todo lo que quieras devolver.')
        const r = await s.restaurarEnLienzo({ actor }, tf.id, { objetos: a.objetos, conectores: a.conectores })
        return {
          ok: true,
          mensaje: `Devolví ${r.objetos.length} ${r.objetos.length === 1 ? 'objeto' : 'objetos'}${r.conectores.length ? ` y ${r.conectores.length} ${r.conectores.length === 1 ? 'conector' : 'conectores'}` : ''} al lienzo.`,
          objetos: r.objetos.map((e) => limpio({ id: e.id, tipo: e.tipo, ...rect(e) })),
          conectores: r.conectores.map((c) => c.id),
          url: tf.url,
        }
      }
      if (!a.objetos?.length && !a.conectores?.length) throw new ErrorDominio('Mandá "objetos" y/o "conectores" para sacar del lienzo.')
      const r = await s.quitarDelLienzo({ actor }, tf.id, { objetos: a.objetos, conectores: a.conectores, conContenido: a.con_contenido })
      const aparte = r.objetos.filter((e) => e.tipo === 'tarjeta' || e.tipo === 'lista').length
      return {
        ok: true,
        mensaje: `Saqué ${r.objetos.length} ${r.objetos.length === 1 ? 'objeto' : 'objetos'}${r.conectores.length ? ` y ${r.conectores.length} ${r.conectores.length === 1 ? 'conector' : 'conectores'}` : ''} del lienzo. No se borraron: vuelven con "restaurar": true y estos id.${aparte ? ' Las tarjetas y listas siguen en el Kanban.' : ''}`,
        quitados: { objetos: r.objetos.map((e) => e.id), conectores: r.conectores },
        url: tf.url,
      }
    },
  }),

  definir({
    nombre: 'convertir_objeto',
    titulo: 'Convertir un objeto del lienzo',
    descripcion:
      'Convierte una nota, un texto o una forma en otra de esas cosas, o en una tarjeta del Kanban (la primera línea es el título; el resto, la descripción). Queda en el mismo lugar y con sus conectores; el objeto viejo se reemplaza (su id cambia: usá el que devuelve). Ejemplo: { "objeto": "Combo del día", "a": "tarjeta", "lista": "Por hacer" }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      tablero: refTablero,
      objeto: z.string().min(1).describe('La nota, el texto o la forma (id, texto o, si es una forma, su texto).'),
      a: z.enum(['tarjeta', 'nota', 'forma', 'texto']).describe('En qué convertirlo.'),
      lista: z.string().optional().describe('Si es "tarjeta": la lista del Kanban (si no, la primera "por hacer").'),
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const tf = await tableroDe(s, a)
      const e = await s.resolverElemento(tf.id, a.objeto)
      if (a.lista && a.a !== 'tarjeta') throw new ErrorDominio('"lista" es solo para convertir en tarjeta.')
      const lista = a.lista ? await s.resolverLista(tf.id, a.lista) : null
      const r = await s.convertirElemento({ actor }, e.id, a.a, lista?.id ?? null)
      return limpio({
        ok: true,
        mensaje: r.tarjeta ? `Convertí ${articuloTipo(e.tipo)} en la tarjeta ${r.tarjeta.clave}.` : `Convertí ${articuloTipo(e.tipo)} en ${articuloTipo(r.elemento.tipo)}.`,
        objeto: objetoCorto(r.elemento),
        tarjeta: r.tarjeta ? { clave: r.tarjeta.clave, titulo: r.tarjeta.titulo, url: urlTarjeta(r.tarjeta.clave) } : undefined,
        conectores: r.conectores.length || undefined,
      })
    },
  }),
]
