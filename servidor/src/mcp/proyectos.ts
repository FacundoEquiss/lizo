// Herramientas de proyectos y tableros: ubicarse (listar y leer), crear y cambiar (nombre, color, emoji, foto,
// descripción, repo; los ajustes del lienzo de un tablero) y archivar o devolver.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { z } from 'zod'
import { GRILLAS, leerAjustesLienzo, type AjustesLienzo } from '../../../compartido/lienzo'
import { DIAS_ARCHIVO_HECHO, leerDiasArchivoHecho } from '../../../compartido/hecho'
import type { Proyecto, TableroResumen } from '../../../compartido/tipos'
import {
  frasePorVistas,
  leerVistas,
  mensajeSinVista,
  TEXTO_TIPO,
  tipoDeVistas,
  TIPO_DE_FABRICA,
  TIPOS_TABLERO,
  VISTAS,
  VISTAS_DEL_TIPO,
  vistaInicial,
  type TipoTablero,
  type VistaTablero,
} from '../../../compartido/vistas'
import { urlServidor } from '../config'
import { ErrorDominio, nuevoId, type Servicio } from '../dominio/servicio'
import { colores, definir, limpio, refProyecto, urlTablero } from './comun'

const urlFoto = (imagen: string | null) => (imagen ? (imagen.startsWith('/') ? urlServidor() + imagen : imagen) : undefined)

/** Lo que dice una herramienta de un tablero: sus vistas (y el tipo que le corresponde) y un link que entra a la primera que tiene. */
function tableroCorto(p: { prefijo: string }, t: TableroResumen) {
  return limpio({
    id: t.id,
    nombre: t.nombre,
    descripcion: t.descripcion || undefined,
    tipo: tipoDeVistas(t.vistas),
    vistas: t.vistas,
    // Las tarjetas abiertas son del Kanban: sin Kanban no se cuentan.
    abiertas: t.vistas.includes('kanban') ? t.abiertas : undefined,
    archivado: t.archivado || undefined,
    url: urlTablero(p.prefijo, t.slug, vistaInicial(t.vistas)),
  })
}

const tipoParam = z
  .enum(TIPOS_TABLERO as unknown as [string, ...string[]])
  .describe(
    '«tablero» (solo Kanban, de fábrica), «diagrama» (solo lienzo: para diagramas, mapas y notas), «diseno» (solo la hoja de diseño del proyecto) o «completo» (las tres vistas). Es un atajo para `vistas`.',
  )
const vistasParam = z
  .array(z.enum(VISTAS as unknown as [string, ...string[]]))
  .min(1)
  .max(3)
  .describe('Qué vistas tiene el tablero: una o más de kanban, lienzo y diseno. Para un diagrama alcanza con ["lienzo"].')

function proyectoCorto(p: Proyecto, conArchivados = false) {
  return limpio({
    prefijo: p.prefijo,
    nombre: p.nombre,
    descripcion: p.descripcion || undefined,
    color: p.color,
    emoji: p.emoji ?? undefined,
    foto: urlFoto(p.imagen),
    repo_github: p.repoGithub ?? undefined,
    archivado: p.archivado || undefined,
    tableros: p.tableros.filter((t) => conArchivados || !t.archivado).map((t) => tableroCorto(p, t)),
  })
}

/** Los ajustes del lienzo con los nombres del MCP. */
function ajustesCortos(a: AjustesLienzo) {
  return { fondo: a.fondo, grilla: a.grilla, iman_grilla: a.imanGrilla, iman_objetos: a.imanObjetos }
}

/** A los cuántos días de haber llegado a Hecho Telar archiva solo una tarjeta: un número o «nunca». */
const archivoHechoCorto = (t: TableroResumen) => leerDiasArchivoHecho(t.ajustes) ?? 'nunca'

// ───────── la foto de un proyecto desde un link ─────────

const TIPOS_FOTO: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const TOPE_FOTO = 512 * 1024

/** ¿Es una dirección de la red local o de la máquina? (el servidor no va a buscar fotos ahí). */
function esPrivada(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  const v = ip.toLowerCase()
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.')
}

/**
 * Baja una foto de un link https (o la lee de una data URL): PNG, JPG, WebP o GIF de hasta 512 KB. No sigue a
 * direcciones de la red local (ni con redirecciones).
 */
async function bajarFoto(fuente: string): Promise<{ bytes: Uint8Array; tipo: string }> {
  const data = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(fuente.trim())
  if (data) {
    const tipo = data[1]!.toLowerCase()
    if (!TIPOS_FOTO[tipo]) throw new ErrorDominio('La foto tiene que ser PNG, JPG, WebP o GIF.')
    const bytes = Uint8Array.from(Buffer.from(data[2]!, 'base64'))
    if (bytes.length > TOPE_FOTO) throw new ErrorDominio('La foto pesa más de 512 KB: mandá una más chica (por ejemplo de 512 × 512).')
    return { bytes, tipo }
  }
  let url: URL
  try {
    url = new URL(fuente)
  } catch {
    throw new ErrorDominio('foto_url tiene que ser un link https://… a una imagen (o una data URL data:image/png;base64,…).')
  }
  for (let saltos = 0; saltos < 4; saltos++) {
    if (url.protocol !== 'https:') throw new ErrorDominio('La foto tiene que venir de un link https://.')
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new ErrorDominio('Ese link apunta a una dirección local: usá uno público.')
    const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((d) => d.address)
    if (!ips.length) throw new ErrorDominio(`No encontré el sitio ${host}.`)
    if (ips.some(esPrivada)) throw new ErrorDominio('Ese link apunta a una dirección local: usá uno público.')
    let r: Response
    try {
      r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'image/png,image/jpeg,image/webp,image/gif' } })
    } catch {
      throw new ErrorDominio('No pude bajar la foto (el sitio no respondió).')
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = new URL(r.headers.get('location')!, url)
      continue
    }
    if (!r.ok) throw new ErrorDominio(`No pude bajar la foto: el sitio respondió ${r.status}.`)
    const tipo = (r.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!TIPOS_FOTO[tipo]) throw new ErrorDominio(`El link no es una foto PNG, JPG, WebP o GIF (es ${tipo || 'de un tipo desconocido'}).`)
    if (Number(r.headers.get('content-length') ?? 0) > TOPE_FOTO) throw new ErrorDominio('La foto pesa más de 512 KB: buscá una versión más chica.')
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (bytes.length > TOPE_FOTO) throw new ErrorDominio('La foto pesa más de 512 KB: buscá una versión más chica.')
    return { bytes, tipo }
  }
  throw new ErrorDominio('El link de la foto redirige demasiadas veces.')
}

async function ponerFoto(s: Servicio, ctx: { actor: Parameters<Servicio['ponerImagenProyecto']>[0]['actor'] }, proyectoId: string, fuente: string) {
  const { bytes, tipo } = await bajarFoto(fuente)
  const ruta = `proyectos/${proyectoId.replace(/[^a-zA-Z0-9_-]/g, '')}-${nuevoId()}.${TIPOS_FOTO[tipo]}`
  await s.almacen.guardar(ruta, bytes, tipo)
  return s.ponerImagenProyecto(ctx, proyectoId, `/archivos/${ruta}`)
}

const fotoParam = z
  .string()
  .optional()
  .describe('Foto del proyecto: un link https:// a una imagen PNG, JPG, WebP o GIF de hasta 512 KB (también vale una data URL base64). Reemplaza al emoji.')

// ───────── las herramientas ─────────

export const HERRAMIENTAS_PROYECTOS = [
  definir({
    nombre: 'listar_proyectos',
    titulo: 'Listar proyectos',
    descripcion:
      'Lista los proyectos (por ejemplo Restaurant City, prefijo RC) con su color, emoji o foto y sus tableros (con su tipo, sus vistas —kanban, lienzo, diseno— y cuántas tarjetas abiertas tiene cada uno). Empezá por acá para ubicarte (la primera vez, después de leer_guia). Con incluir_archivados también los archivados (para devolverlos con actualizar_proyecto o actualizar_tablero). Ejemplo: {}',
    esquema: z.strictObject({
      incluir_archivados: z.boolean().optional().describe('También los proyectos y tableros archivados.'),
    }),
    soloLectura: true,
    async ejecutar(s, _a, a) {
      const proyectos = await s.listarProyectos(!!a.incluir_archivados)
      return { proyectos: proyectos.map((p) => proyectoCorto(p, !!a.incluir_archivados)) }
    },
  }),

  definir({
    nombre: 'leer_proyecto',
    titulo: 'Leer un proyecto',
    descripcion:
      'Devuelve un proyecto con sus tableros (cada uno con su tipo y sus vistas) y listas (con cuántas tarjetas hay en cada una; solo de los que tienen Kanban), sus etiquetas y los miembros a los que se les pueden asignar tarjetas. Ejemplo: { "proyecto": "RC" }',
    esquema: z.strictObject({ proyecto: refProyecto }),
    soloLectura: true,
    async ejecutar(s, _a, { proyecto }) {
      const fila = await s.resolverProyecto(proyecto)
      const p = (await s.listarProyectos()).find((x) => x.id === fila.id)!
      const conListas = []
      for (const t of p.tableros) {
        const conKanban = t.vistas.includes('kanban')
        const listas = conKanban ? await s.listarListas(t.id) : []
        const cuentas = conKanban
          ? await s.db.consulta<{ lista_id: string; n: number }>(
              `select lista_id, count(*)::int as n from tarjetas where tablero_id = $1 and not archivada group by lista_id`,
              [t.id],
            )
          : []
        conListas.push(
          limpio({
            ...tableroCorto(p, t),
            lienzo: t.vistas.includes('lienzo') ? ajustesCortos(leerAjustesLienzo(t.ajustes)) : undefined,
            archivo_hecho_dias: conKanban ? archivoHechoCorto(t) : undefined,
            listas: conKanban
              ? listas.map((l) =>
                  limpio({ nombre: l.nombre, categoria: l.categoria ?? undefined, limite: l.limite ?? undefined, tarjetas: cuentas.find((c) => c.lista_id === l.id)?.n ?? 0 }),
                )
              : undefined,
          }),
        )
      }
      const etiquetas = await s.listarEtiquetas(p.id)
      const miembros = await s.listarMiembros()
      return {
        ...proyectoCorto(p),
        tableros: conListas,
        etiquetas: etiquetas.map((e) => limpio({ nombre: e.nombre, color: e.color, grupo: e.grupo ?? undefined })),
        miembros: miembros.map((m) => limpio({ nombre: m.nombre, tipo: m.tipo, yo: m.esYo || undefined })),
      }
    },
  }),

  definir({
    nombre: 'listar_tableros',
    titulo: 'Listar tableros',
    descripcion: 'Lista los tableros de un proyecto con su tipo y sus vistas (kanban, lienzo, diseno), sus listas del Kanban y los ajustes de su lienzo (de cada uno, si tiene esa vista). Ejemplo: { "proyecto": "RC" }',
    esquema: z.strictObject({ proyecto: refProyecto }),
    soloLectura: true,
    async ejecutar(s, _a, { proyecto }) {
      const fila = await s.resolverProyecto(proyecto)
      const p = (await s.listarProyectos()).find((x) => x.id === fila.id)!
      const salida = []
      for (const t of p.tableros) {
        const conKanban = t.vistas.includes('kanban')
        const listas = conKanban ? await s.listarListas(t.id) : []
        salida.push(
          limpio({
            ...tableroCorto(p, t),
            listas: conKanban ? listas.map((l) => l.nombre) : undefined,
            lienzo: t.vistas.includes('lienzo') ? ajustesCortos(leerAjustesLienzo(t.ajustes)) : undefined,
            archivo_hecho_dias: conKanban ? archivoHechoCorto(t) : undefined,
          }),
        )
      }
      return { proyecto: p.prefijo, tableros: salida }
    },
  }),

  definir({
    nombre: 'crear_proyecto',
    titulo: 'Crear un proyecto',
    descripcion:
      'Crea un proyecto nuevo con un primer tablero: de fábrica un «tablero» (solo Kanban) llamado "Pendientes", con las listas Bandeja, Por hacer, En curso y Hecho; con `tipo` ("diagrama", "diseno" o "completo"), uno de ese tipo. El prefijo es la sigla de las claves de sus tarjetas (RC → RC-1, RC-2…): en mayúsculas, empieza con una letra, hasta 10 caracteres, y no se puede repetir. Ejemplo: { "nombre": "Hotel City", "prefijo": "HC", "color": "celeste", "emoji": "🏨" }',
    esquema: z.strictObject({
      nombre: z.string().min(1).max(60).describe('Nombre del proyecto.'),
      prefijo: z.string().min(1).max(10).describe('Sigla para las claves de las tarjetas (por ejemplo HC).'),
      color: colores.optional().describe('Color del proyecto (de fábrica, naranja).'),
      emoji: z.string().max(16).optional().describe('Un emoji para el avatar (si no hay foto).'),
      descripcion: z.string().max(280).optional().describe('De qué se trata, en una o dos líneas.'),
      repo_github: z.string().optional().describe('Repositorio de GitHub: usuario/repo.'),
      foto_url: fotoParam,
      tipo: tipoParam.optional().describe('Tipo del primer tablero (de fábrica, «tablero»: solo Kanban).'),
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const ctx = { actor }
      let p = await s.crearProyecto(ctx, { nombre: a.nombre, prefijo: a.prefijo, color: a.color, emoji: a.emoji, descripcion: a.descripcion, repoGithub: a.repo_github, tipo: a.tipo as TipoTablero | undefined })
      if (a.foto_url) p = await ponerFoto(s, ctx, p.id, a.foto_url)
      const t = p.tableros[0]
      return {
        ok: true,
        mensaje: `Creé el proyecto «${p.nombre}» (${p.prefijo}) con el tablero «${t?.nombre}» (${t ? TEXTO_TIPO[tipoDeVistas(t.vistas)].nombre : ''}).`,
        proyecto: proyectoCorto(p),
      }
    },
  }),

  definir({
    nombre: 'actualizar_proyecto',
    titulo: 'Cambiar un proyecto',
    descripcion:
      'Cambia un proyecto: nombre, descripción, color, emoji, repo de GitHub o foto (foto_url con un link https a una imagen, o quitar_foto). El prefijo no se cambia (lo usan las claves). Con archivado: true lo saca de la barra lateral sin perder nada; archivado: false lo devuelve. Solo cambia lo que mandes. Ejemplo: { "proyecto": "RC", "color": "verde", "emoji": "🍝" }',
    esquema: z.strictObject({
      proyecto: z.string().min(1).describe('Prefijo, nombre o id del proyecto (también uno archivado).'),
      nombre: z.string().min(1).max(60).optional(),
      descripcion: z.string().max(280).optional().describe('"" la borra.'),
      color: colores.optional(),
      emoji: z.string().max(16).nullable().optional().describe('Un emoji para el avatar; null lo saca (quedan las iniciales).'),
      repo_github: z.string().nullable().optional().describe('usuario/repo; null lo saca.'),
      foto_url: fotoParam,
      quitar_foto: z.boolean().optional().describe('true saca la foto (vuelve el emoji o las iniciales).'),
      archivado: z.boolean().optional().describe('true lo archiva; false lo devuelve.'),
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const ctx = { actor }
      if (a.foto_url && a.quitar_foto) throw new ErrorDominio('Mandá foto_url (para poner una) o quitar_foto (para sacarla), no las dos.')
      const fila = await s.resolverProyecto(a.proyecto, { archivados: true })
      const cambios = limpio({
        nombre: a.nombre,
        descripcion: a.descripcion,
        color: a.color,
        emoji: a.emoji,
        repoGithub: a.repo_github,
        archivado: a.archivado,
        imagen: a.quitar_foto ? (null as null) : undefined,
      })
      if (!Object.keys(cambios).length && !a.foto_url) throw new ErrorDominio('No mandaste nada para cambiar (nombre, descripcion, color, emoji, repo_github, foto_url, quitar_foto o archivado).')
      let p = Object.keys(cambios).length ? await s.actualizarProyecto(ctx, fila.id, cambios) : null
      if (a.foto_url) p = await ponerFoto(s, ctx, fila.id, a.foto_url)
      const r = p!
      return {
        ok: true,
        mensaje: a.archivado === true ? `Archivé el proyecto «${r.nombre}».` : a.archivado === false ? `Devolví el proyecto «${r.nombre}».` : `Cambié el proyecto «${r.nombre}».`,
        proyecto: proyectoCorto(r, true),
      }
    },
  }),

  definir({
    nombre: 'crear_tablero',
    titulo: 'Crear un tablero',
    descripcion:
      'Crea un tablero en un proyecto con las vistas que necesita y nada más. Con `tipo`: «tablero» (solo Kanban, de fábrica; si no mandás listas arranca con Por hacer, En curso y Hecho), «diagrama» (solo lienzo, sin listas: para un diagrama o un mapa NO armes un tablero completo), «diseno» (solo la hoja de diseño del proyecto: manual de marca, sistema, marcos; Diseño es del proyecto y no crea uno nuevo) o «completo» (las tres vistas). En vez de `tipo` podés mandar `vistas` (por ejemplo ["kanban", "lienzo"]). Se cambian después con actualizar_tablero. Ejemplos: { "proyecto": "RC", "nombre": "Lanzamiento", "listas": ["Ideas", "Por hacer", "Hecho"] } · { "proyecto": "SRV", "nombre": "Cómo funciona Telar", "tipo": "diagrama" }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      nombre: z.string().min(1).max(60),
      descripcion: z.string().max(280).optional(),
      tipo: tipoParam.optional(),
      vistas: vistasParam.optional(),
      listas: z
        .array(z.string().min(1).max(60))
        .min(1)
        .max(12)
        .optional()
        .describe('Nombres de las listas, en orden (solo si el tablero tiene Kanban). Las que se llaman como un estado (Por hacer, En curso, Hecho) quedan con esa categoría.'),
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      if (a.tipo && a.vistas) throw new ErrorDominio('Mandá `tipo` o `vistas`, no los dos (el tipo es un atajo para un conjunto de vistas).')
      const p = await s.resolverProyecto(a.proyecto)
      const categoria = (n: string) => {
        const k = n.trim().toLowerCase()
        return /^(por hacer|pendiente|to ?do)$/.test(k) ? 'por_hacer' : /^(en curso|haciendo|doing)$/.test(k) ? 'en_curso' : /^(hecho|terminado|listo|done)$/.test(k) ? 'hecho' : null
      }
      const vistas = (a.vistas as VistaTablero[] | undefined) ?? [...VISTAS_DEL_TIPO[(a.tipo as TipoTablero | undefined) ?? TIPO_DE_FABRICA]]
      if (a.listas && !vistas.includes('kanban'))
        throw new ErrorDominio(`Un tablero sin Kanban (tiene: ${frasePorVistas(vistas)}) no lleva listas: sacá "listas" o sumá la vista kanban (tipo "tablero" o "completo").`)
      const t = await s.crearTablero({ actor }, { proyectoId: p.id, nombre: a.nombre, descripcion: a.descripcion, vistas, listas: a.listas?.map((n) => ({ nombre: n, categoria: categoria(n) })) })
      return {
        ok: true,
        mensaje: `Creé el tablero «${t.nombre}» en ${p.prefijo} (${TEXTO_TIPO[tipoDeVistas(t.vistas)].nombre}: ${frasePorVistas(t.vistas)}).`,
        tablero: tableroCorto(p as { prefijo: string }, t),
        lienzo: t.vistas.includes('lienzo') ? urlTablero(p.prefijo, t.slug, 'lienzo') : undefined,
      }
    },
  }),

  definir({
    nombre: 'actualizar_tablero',
    titulo: 'Cambiar un tablero',
    descripcion:
      'Cambia un tablero: nombre, descripción, sus vistas (`vistas`: una o más de kanban, lienzo y diseno; sacar una vista no borra nada: lo que había queda guardado y vuelve al sumarla otra vez; no se puede dejar un tablero sin ninguna) y los ajustes de su lienzo (los ve todo el que lo abra): fondo (puntos, lineas, cruces o liso), grilla (8, 16, 24, 32 o 48 px), imán a la grilla e imán a los objetos. Con archivo_hecho_dias elegís a los cuántos días de haber llegado a Hecho Telar archiva solo una tarjeta (7, 14, 30 de fábrica, 60 o "nunca"): se archivan y se restauran como cualquier otra, nada se borra. Con archivado: true lo saca de la barra lateral sin perder nada (un proyecto necesita al menos un tablero activo); archivado: false lo devuelve. Solo cambia lo que mandes. Ejemplos: { "tablero": "Pendientes", "fondo": "lineas", "grilla": 48 } · { "tablero": "Cómo funciona Telar", "proyecto": "SRV", "vistas": ["lienzo"] }',
    esquema: z.strictObject({
      tablero: z.string().min(1).describe('Nombre o id del tablero (también uno archivado).'),
      proyecto: refProyecto,
      nombre: z.string().min(1).max(60).optional(),
      descripcion: z.string().max(280).optional(),
      vistas: vistasParam.optional().describe('Las vistas que tiene el tablero desde ahora (reemplaza a las de antes): por ejemplo ["lienzo"] para dejarlo solo con lienzo, o ["kanban", "lienzo"] para sumarle el lienzo.'),
      fondo: z.enum(['puntos', 'lineas', 'cruces', 'liso']).optional().describe('Fondo del lienzo.'),
      grilla: z
        .union(GRILLAS.map((g) => z.literal(g)) as unknown as [z.ZodLiteral<8>, z.ZodLiteral<16>, z.ZodLiteral<24>, z.ZodLiteral<32>, z.ZodLiteral<48>])
        .optional()
        .describe('Tamaño de la grilla en px: 8, 16, 24 (de fábrica), 32 o 48.'),
      iman_grilla: z.boolean().optional().describe('Los objetos se acomodan a la grilla al moverlos.'),
      iman_objetos: z.boolean().optional().describe('Guías que alinean con otros objetos.'),
      archivo_hecho_dias: z
        .union([z.literal('nunca'), ...DIAS_ARCHIVO_HECHO.map((d) => z.literal(d))] as unknown as [z.ZodLiteral<'nunca'>, z.ZodLiteral<7>, z.ZodLiteral<14>, z.ZodLiteral<30>, z.ZodLiteral<60>])
        .optional()
        .describe('A los cuántos días de haber llegado a Hecho se archiva sola una tarjeta: 7, 14, 30 (de fábrica), 60 o "nunca". No archiva las que tienen una checklist sin terminar ni las que bloquean a otra tarjeta abierta.'),
      archivado: z.boolean().optional().describe('true lo archiva; false lo devuelve.'),
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const tf = await s.resolverTablero(a.tablero, a.proyecto, { archivados: true })
      const lienzo = limpio({ fondo: a.fondo, grilla: a.grilla, imanGrilla: a.iman_grilla, imanObjetos: a.iman_objetos })
      // Lo del lienzo y el archivo de Hecho vale para un tablero que tiene esa vista (cuentan las vistas que se piden en esta misma llamada).
      const vistasAhora = (a.vistas as VistaTablero[] | undefined) ?? leerVistas(tf.ajustes)
      if (Object.keys(lienzo).length && !vistasAhora.includes('lienzo')) throw new ErrorDominio(mensajeSinVista(tf.nombre, 'lienzo', vistasAhora), 409)
      if (a.archivo_hecho_dias !== undefined && !vistasAhora.includes('kanban')) throw new ErrorDominio(mensajeSinVista(tf.nombre, 'kanban', vistasAhora), 409)
      const cambios = limpio({
        nombre: a.nombre,
        descripcion: a.descripcion,
        archivado: a.archivado,
        vistas: a.vistas as VistaTablero[] | undefined,
        ajustes:
          Object.keys(lienzo).length || a.archivo_hecho_dias !== undefined
            ? {
                ...(Object.keys(lienzo).length ? { lienzo } : {}),
                ...(a.archivo_hecho_dias !== undefined ? { archivoHecho: { dias: a.archivo_hecho_dias === 'nunca' ? null : a.archivo_hecho_dias } } : {}),
              }
            : undefined,
      })
      if (!Object.keys(cambios).length) throw new ErrorDominio('No mandaste nada para cambiar (nombre, descripcion, vistas, fondo, grilla, iman_grilla, iman_objetos, archivo_hecho_dias o archivado).')
      const t = await s.actualizarTablero({ actor }, tf.id, cambios)
      const p = await s.resolverProyecto(t.proyectoId, { archivados: true })
      return {
        ok: true,
        mensaje:
          a.archivado === true
            ? `Archivé el tablero «${t.nombre}».`
            : a.archivado === false
              ? `Devolví el tablero «${t.nombre}».`
              : a.vistas
                ? `Cambié el tablero «${t.nombre}»: ahora tiene ${frasePorVistas(t.vistas)}. Lo que había en una vista que sacaste queda guardado.`
                : `Cambié el tablero «${t.nombre}».`,
        tablero: limpio({
          ...tableroCorto(p as { prefijo: string }, t),
          lienzo: t.vistas.includes('lienzo') ? ajustesCortos(leerAjustesLienzo(t.ajustes)) : undefined,
          archivo_hecho_dias: t.vistas.includes('kanban') ? archivoHechoCorto(t) : undefined,
        }),
      }
    },
  }),
]
