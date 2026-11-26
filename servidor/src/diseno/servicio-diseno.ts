// Toda la lógica de Diseño (plan 7.1). La API y el MCP llaman a los mismos métodos: una persona y Claude no pueden hacer
// cosas distintas. Cada escritura: sanea, pone data-id, guarda la revisión anterior, sube `revision`, registra la actividad
// con su autor y publica el evento en vivo `diseno`. Nada se borra: marcos, páginas e ítems se archivan.
// Cuentas (docs/cuentas.md): un ServicioDiseno es el de UNA cuenta (sale de su Servicio). Todo método que recibe `pid` lo
// verifica primero (`pidPropio`: el proyecto tiene que ser de esta cuenta; si no, 404). El almacén y el bus son los de la
// cuenta: un marco no puede dibujar un archivo de otra cuenta.
import { createHash } from 'node:crypto'
import { customAlphabet } from 'nanoid'
import { generateKeyBetween } from 'fractional-indexing'
import { acomodar, limitesDe } from '../../../compartido/diseno/acomodar'
import { hojasNecesarias, piezasUsadas, propiedadesDe } from '../../../compartido/diseno/documento'
import { analizarHtml, attr, buscarPorId, clonar, crearElemento, quitarAttr, recorrer, serializarHtml, textoDe, ponerAttr, insertarAntes, quitarNodo } from '../../../compartido/diseno/html'
import { extensionDeMime, medidasDeImagen, mimeDeExtension, EXTENSIONES_FUENTE, EXTENSIONES_IMAGEN } from '../../../compartido/diseno/imagen'
import type { OperacionMarco } from '../../../compartido/diseno/operaciones'
import { esquemaPerfil, type Perfil } from '../../../compartido/diseno/perfil'
import { medidasDe, PREFIJADOS, type Prefijado } from '../../../compartido/diseno/prefijados'
import { aRgb, claseDeEstilo, hojaDeTokens, normalizarColor, variableDeToken } from '../../../compartido/diseno/tokens'
import type {
  Caja,
  ComentarioDiseno,
  DatosEventoDiseno,
  DatosMarco,
  DatosPieza,
  DatosPlantilla,
  ImportacionDiseno,
  ItemDiseno,
  Marco,
  MarcoResumen,
  NotaDiseno,
  Origen,
  PaginaDiseno,
  PropPieza,
  ResumenDiseno,
  TipoItem,
  TipoPagina,
} from '../../../compartido/diseno/tipos'
import { TIPOS_ITEM } from '../../../compartido/diseno/tipos'
import { normalizar, slug } from '../../../compartido/texto'
import type { Actor, Evento } from '../../../compartido/tipos'
import type { Almacen } from '../datos/almacen'
import type { Conexion } from '../datos/conexion'
import { aActividad, vistasDeFila } from '../dominio/filas'
import { ErrorDominio, nuevoId, type Ctx, type Servicio } from '../dominio/servicio'
import type { BusEventos } from '../eventos'
import { aComentario, aImportacion, aItem, aMarco, aMarcoResumen, aNota, aPagina } from './filas'
import { aplicarOperaciones, listaDeCapas, type EstadoMarco } from './operaciones'
import { renderizar, componerGrilla, type EntradaRender, type OpcionesRender, type ResultadoRender } from './render'
import { motorRemoto, renderLocalDisponible } from './remoto'
import { sanearCss, sanearHtml, sanearSvg } from './sanear'
import { urlDiseno } from './urls'
import { tandaActual } from '../dominio/tanda'

type Fila = Record<string, any>

const idMarco = customAlphabet('0123456789abcdefghijkmnpqrstuvwxyz', 8)
const idPagina = customAlphabet('0123456789abcdefghijkmnpqrstuvwxyz', 8)
export const sha12 = (d: Uint8Array | string) => createHash('sha1').update(d).digest('hex').slice(0, 12)
const j = (v: unknown) => JSON.stringify(v ?? null)

const COLS_MARCO = `m.id, m.proyecto_id, m.pagina_id, m.nombre, m.seccion, m.grupo, m.x, m.y, m.ancho, m.alto,
  (m.datos - 'cajas' - 'estilos') as datos, m.origen, m.clave, m.hash, m.miniatura, m.revision, m.bloqueado, m.archivado_en,
  m.creado_por, m.creado_en, m.actualizado_en, m.hojas,
  coalesce((select array_agg(t.clave order by t.numero) from diseno_vinculos v join tarjetas t on t.id = v.tarjeta_id
            where v.objetivo = 'marco:' || m.id), '{}') as tarjetas,
  (select count(*) from diseno_comentarios c where c.proyecto_id = m.proyecto_id and c.respuesta_a is null and not c.resuelto
     and (c.objetivo = 'marco:' || m.id or c.objetivo like 'marco:' || m.id || '#%'))::int as n_comentarios`

export interface NuevoMarco {
  pagina: string
  nombre: string
  ancho: number
  alto: number
  html?: string
  css?: string
  hojas?: string[]
  seccion?: string
  grupo?: string | null
  datos?: DatosMarco
  x?: number
  y?: number
  clave?: string | null
  tarjetas?: string[]
}

export interface ResultadoEdicion {
  marco: Marco
  lineas: string[]
  creadas: string[]
  avisos: string[]
  revisionAntes: number
}

export interface ImagenGrilla {
  nombre: string
  bytes: Uint8Array
  mime: string
  ancho: number
  alto: number
}

/** Quién dibuja: el Chromium de este proceso o, en Vercel, la función render.func (remoto.ts). */
export interface Motor {
  render(sd: ServicioDiseno, pid: string, marco: Pick<Marco, 'id'>, entrada: EntradaRender, op: OpcionesRender): Promise<ResultadoRender>
  grilla(imagenes: ImagenGrilla[]): Promise<{ bytes: Uint8Array; ancho: number; alto: number }>
}

/** Un ServicioDiseno por Servicio (se crea al primer uso; no hace falta tocar el Servicio). */
const porServicio = new WeakMap<Servicio, ServicioDiseno>()
export function disenoDe(s: Servicio): ServicioDiseno {
  let d = porServicio.get(s)
  if (!d) {
    d = new ServicioDiseno(s)
    porServicio.set(s, d)
  }
  return d
}

export const motorLocal: Motor = {
  render: (sd, _pid, _marco, entrada, op) => renderizar(entrada, (ruta) => sd.almacen.leer(ruta), op),
  grilla: (imagenes) => componerGrilla(imagenes),
}

export class ServicioDiseno {
  readonly db: Conexion
  readonly bus: BusEventos
  readonly almacen: Almacen
  motor: Motor

  constructor(readonly s: Servicio) {
    this.db = s.db
    this.bus = s.bus
    this.almacen = s.almacen
    this.motor = renderLocalDisponible() ? motorLocal : motorRemoto
  }

  // ───────────────────────── proyecto, actividad y eventos ─────────────────────────

  /** Los proyectos ya verificados (de esta cuenta). Un proyecto no cambia de dueño. */
  private readonly pidsPropios = new Set<string>()

  /** El proyecto tiene que ser de la cuenta de este Servicio (si no, 404 como si no existiera). */
  async pidPropio(pid: string): Promise<void> {
    if (this.pidsPropios.has(pid)) return
    await this.s.propio('proyecto', pid)
    this.pidsPropios.add(pid)
  }

  async proyecto(ref?: string | null): Promise<Fila> {
    const p = await this.s.resolverProyecto(ref)
    this.pidsPropios.add(p.id)
    return p
  }

  async tableroDe(pid: string): Promise<{ id: string | null; slug: string | null }> {
    await this.pidPropio(pid)
    // El primero que tiene la vista Diseño (los demás redirigen a la suya); si ninguno la tiene, el primero.
    const ts = await this.db.consulta(`select id, slug, ajustes from tableros where proyecto_id = $1 and not archivado order by orden collate "C"`, [pid])
    const t = ts.find((x) => vistasDeFila(x).includes('diseno')) ?? ts[0]
    return { id: t?.id ?? null, slug: t?.slug ?? null }
  }

  async url(pid: string, pagina?: string | null, sel?: string | null): Promise<string> {
    await this.pidPropio(pid)
    const [p] = await this.db.consulta(`select prefijo from proyectos where id = $1`, [pid])
    const t = await this.tableroDe(pid)
    return urlDiseno(p?.prefijo ?? 'X', t.slug, pagina ?? null, sel ?? null)
  }

  async registrar(ctx: Ctx, pid: string, accion: string, resumen: string, detalle?: Record<string, unknown>) {
    await this.pidPropio(pid)
    const t = await this.tableroDe(pid)
    const [f] = await this.db.consulta(
      `insert into actividad (id, proyecto_id, tablero_id, tarjeta_id, tarjeta_clave, actor, accion, resumen, detalle, propietario, tanda)
       values ($1, $2, $3, null, null, $4::jsonb, $5, $6, $7::jsonb, $8, $9) returning *`,
      [nuevoId(), pid, t.id, j(ctx.actor), accion, resumen, detalle ? j(detalle) : null, this.s.cuenta, tandaActual()?.id ?? null],
    )
    const act = aActividad(f!)
    this.bus.publicar({
      tipo: 'actividad',
      accion,
      proyectoId: pid,
      tableroId: t.id,
      tarjetaId: null,
      actor: ctx.actor,
      clienteId: ctx.clienteId ?? null,
      resumen,
      datos: act,
    })
  }

  publicar(ctx: Ctx, pid: string, datos: DatosEventoDiseno) {
    // 'diseno' entra en Evento['tipo'] con la conexión a la app (compartido/tipos.ts)
    const e = { tipo: 'diseno', accion: datos.accion, proyectoId: pid, actor: ctx.actor, clienteId: ctx.clienteId ?? null, datos }
    this.bus.publicar(e as unknown as Omit<Evento, 'id' | 'en'>)
  }

  // ───────────────────────── configuración y páginas ─────────────────────────

  /** Crea la configuración y la página Fundamentos la primera vez. */
  async asegurar(pid: string): Promise<void> {
    await this.pidPropio(pid)
    await this.db.consulta(`insert into diseno_config (proyecto_id) values ($1) on conflict (proyecto_id) do nothing`, [pid])
    const [f] = await this.db.consulta(`select id from diseno_paginas where proyecto_id = $1 and slug = 'fundamentos'`, [pid])
    if (!f)
      await this.db.consulta(
        `insert into diseno_paginas (id, proyecto_id, nombre, slug, tipo, origen, datos, orden) values ($1, $2, 'Fundamentos', 'fundamentos', 'sistema', 'propio', $3::jsonb, 'a0')
         on conflict (proyecto_id, slug) do nothing`,
        [`pg_${idPagina()}`, pid, j({ tipos: ['token', 'estilo_texto', 'color_suelto', 'fuente'] })],
      )
  }

  async config(pid: string): Promise<Fila> {
    await this.pidPropio(pid)
    await this.asegurar(pid)
    const [c] = await this.db.consulta(`select * from diseno_config where proyecto_id = $1`, [pid])
    return c!
  }

  async perfil(pid: string): Promise<Perfil | null> {
    await this.pidPropio(pid)
    const c = await this.config(pid)
    if (!c.perfil || !Object.keys(c.perfil).length) return null
    const r = esquemaPerfil.safeParse(c.perfil)
    return r.success ? r.data : null
  }

  async resumen(ref: string): Promise<ResumenDiseno> {
    const p = await this.proyecto(ref)
    const c = await this.config(p.id)
    const paginas = await this.paginas(p.id)
    const conteo = await this.db.consulta<{ tipo: TipoItem; n: number }>(
      `select tipo, count(*)::int as n from diseno_items where proyecto_id = $1 and not archivado group by tipo`,
      [p.id],
    )
    const [ultima] = await this.db.consulta(`select * from diseno_importaciones where proyecto_id = $1 and estado = 'lista' order by n desc limit 1`, [p.id])
    const perfil = await this.perfil(p.id)
    const t = await this.tableroDe(p.id)
    return {
      proyecto: { id: p.id, prefijo: p.prefijo, nombre: p.nombre, color: p.color, tablero: t.slug },
      paginas,
      conteo: Object.fromEntries(conteo.map((x) => [x.tipo, x.n])),
      sincronizacion: {
        importacion: Number(c.importacion ?? 0),
        importadoEn: c.importado_en ? new Date(c.importado_en).toISOString() : null,
        origen: c.origen ?? null,
        pedidoEn: c.pedido_en ? new Date(c.pedido_en).toISOString() : null,
        tienePerfil: Boolean(perfil),
        ultima: ultima ? aImportacion(ultima) : null,
      },
      unidades: perfil?.unidades ?? {},
      vistas: perfil?.vistas ?? {},
    }
  }

  async paginas(pid: string, conArchivadas = false): Promise<PaginaDiseno[]> {
    await this.pidPropio(pid)
    await this.asegurar(pid)
    const filas = await this.db.consulta(
      `select p.*, (select count(*) from diseno_marcos m where m.pagina_id = p.id and m.archivado_en is null)::int as n_marcos
         from diseno_paginas p where p.proyecto_id = $1 ${conArchivadas ? '' : 'and not p.archivada'} order by p.orden collate "C", p.creado_en`,
      [pid],
    )
    const paginas = filas.map(aPagina)
    // las de sistema y tabla cuentan sus ítems
    const tipos = await this.db.consulta<{ tipo: TipoItem; n: number }>(`select tipo, count(*)::int as n from diseno_items where proyecto_id = $1 and not archivado group by tipo`, [pid])
    const n = new Map(tipos.map((t) => [t.tipo, t.n]))
    for (const pg of paginas) if (pg.tipo !== 'lienzo') pg.marcos = (pg.datos.tipos ?? []).reduce((s, t) => s + (n.get(t) ?? 0), 0)
    return paginas
  }

  async resolverPagina(pid: string, ref: string, op: { crear?: boolean; ctx?: Ctx } = {}): Promise<PaginaDiseno> {
    await this.pidPropio(pid)
    const paginas = await this.paginas(pid, true)
    const r = normalizar(ref.trim())
    const hallada =
      paginas.find((p) => p.id === ref) ??
      paginas.find((p) => p.slug === ref || p.slug === slug(ref)) ??
      paginas.find((p) => normalizar(p.nombre) === r) ??
      paginas.find((p) => normalizar(p.nombre).startsWith(r))
    if (hallada) return hallada
    if (op.crear && op.ctx) return this.crearPagina(op.ctx, pid, { nombre: ref.trim() })
    throw new ErrorDominio(
      `No existe la página «${ref}». Páginas: ${paginas.filter((p) => !p.archivada).map((p) => `${p.nombre} (${p.tipo})`).join(', ') || 'ninguna'}. crear_marco la crea si no existe.`,
      404,
    )
  }

  async crearPagina(ctx: Ctx, pid: string, e: { nombre: string; tipo?: TipoPagina; origen?: Origen; datos?: PaginaDiseno['datos']; slug?: string }): Promise<PaginaDiseno> {
    await this.pidPropio(pid)
    const nombre = e.nombre.trim()
    if (!nombre) throw new ErrorDominio('La página necesita un nombre.')
    const paginas = await this.paginas(pid, true)
    let s = e.slug ?? slug(nombre)
    let k = 2
    while (paginas.some((p) => p.slug === s)) s = `${slug(nombre)}-${k++}`
    const ultima = paginas.map((p) => p.orden).sort().pop() ?? null
    const orden = generateKeyBetween(ultima, null)
    const id = `pg_${idPagina()}`
    await this.db.consulta(
      `insert into diseno_paginas (id, proyecto_id, nombre, slug, tipo, origen, datos, orden) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [id, pid, nombre, s, e.tipo ?? 'lienzo', e.origen ?? 'propio', j(e.datos ?? {}), orden],
    )
    if (e.origen !== 'importado') await this.registrar(ctx, pid, 'diseno.pagina.creada', `creó la página «${nombre}» en Diseño`)
    this.publicar(ctx, pid, { accion: 'pagina', paginaId: id })
    return (await this.resolverPagina(pid, id))!
  }

  async actualizarPagina(ctx: Ctx, pid: string, ref: string, c: { nombre?: string; archivada?: boolean; orden?: string; datos?: PaginaDiseno['datos'] }) {
    await this.pidPropio(pid)
    const pg = await this.resolverPagina(pid, ref)
    if (pg.origen === 'importado' && (c.nombre !== undefined || c.archivada !== undefined)) throw new ErrorDominio('Esta página viene del código: no se renombra ni se archiva (cambia al sincronizar).', 409)
    if (pg.slug === 'fundamentos' && c.archivada) throw new ErrorDominio('Fundamentos no se archiva: es la página del sistema del proyecto.', 409)
    await this.db.consulta(
      `update diseno_paginas set nombre = coalesce($2, nombre), archivada = coalesce($3, archivada), orden = coalesce($4, orden),
         datos = case when $5::jsonb is null then datos else datos || $5::jsonb end where id = $1`,
      [pg.id, c.nombre?.trim() || null, c.archivada ?? null, c.orden ?? null, c.datos ? j(c.datos) : null],
    )
    if (c.nombre && c.nombre !== pg.nombre) await this.registrar(ctx, pid, 'diseno.pagina.renombrada', `renombró la página «${pg.nombre}» a «${c.nombre}»`)
    if (c.archivada !== undefined) await this.registrar(ctx, pid, c.archivada ? 'diseno.pagina.archivada' : 'diseno.pagina.restaurada', `${c.archivada ? 'archivó' : 'restauró'} la página «${pg.nombre}»`)
    this.publicar(ctx, pid, { accion: 'pagina', paginaId: pg.id })
    return this.resolverPagina(pid, pg.id)
  }

  async leerPagina(pid: string, ref: string): Promise<{ pagina: PaginaDiseno; marcos: MarcoResumen[] }> {
    await this.pidPropio(pid)
    const pagina = await this.resolverPagina(pid, ref)
    const ultima = await this.ultimaImportacion(pid)
    const filas = await this.db.consulta(`select ${COLS_MARCO} from diseno_marcos m where m.pagina_id = $1 and m.archivado_en is null order by m.y, m.x`, [pagina.id])
    return { pagina, marcos: filas.map((f) => aMarcoResumen(f, ultima)) }
  }

  private async ultimaImportacion(pid: string): Promise<{ n: number; en: string | null }> {
    const [c] = await this.db.consulta(`select importacion, importado_en from diseno_config where proyecto_id = $1`, [pid])
    return { n: Number(c?.importacion ?? 0), en: c?.importado_en ? new Date(c.importado_en).toISOString() : null }
  }

  // ───────────────────────── marcos: leer ─────────────────────────

  async resolverMarco(pid: string, ref: string, op: { pagina?: string; conArchivados?: boolean } = {}): Promise<Marco> {
    await this.pidPropio(pid)
    const limpio = ref.trim()
    const [porId] = await this.db.consulta(`select m.*, ${COLS_MARCO.replace('(m.datos - \'cajas\' - \'estilos\') as datos, ', '')} from diseno_marcos m where m.proyecto_id = $1 and (m.id = $2 or m.clave = $2)`, [pid, limpio])
    if (porId && (op.conArchivados || !porId.archivado_en)) return aMarco(porId)
    const todos = await this.db.consulta(
      `select m.id, m.nombre, m.pagina_id, p.nombre as pagina from diseno_marcos m join diseno_paginas p on p.id = m.pagina_id
        where m.proyecto_id = $1 and m.archivado_en is null order by p.orden collate "C", m.y, m.x`,
      [pid],
    )
    const r = normalizar(limpio)
    let candidatos = todos.filter((m) => normalizar(m.nombre) === r)
    if (!candidatos.length) candidatos = todos.filter((m) => normalizar(m.nombre).includes(r))
    if (op.pagina) {
      const pg = await this.resolverPagina(pid, op.pagina)
      const enPagina = candidatos.filter((m) => m.pagina_id === pg.id)
      if (enPagina.length) candidatos = enPagina
    }
    if (candidatos.length === 1) return this.resolverMarco(pid, candidatos[0]!.id, op)
    if (candidatos.length > 1)
      throw new ErrorDominio(
        `Hay ${candidatos.length} marcos que se llaman «${ref}»: ${candidatos
          .slice(0, 10)
          .map((m) => `${m.id} (${m.pagina})`)
          .join(', ')}. Nombralo por su id.`,
        409,
      )
    const algunos = todos.slice(0, 12).map((m) => `${m.id} «${m.nombre}»`)
    throw new ErrorDominio(
      `No existe el marco «${ref}».${algunos.length ? ` Algunos marcos: ${algunos.join(', ')}${todos.length > 12 ? ` y ${todos.length - 12} más` : ''}.` : ' Todavía no hay marcos: creá uno con crear_marco.'}`,
      404,
    )
  }

  /** Lo que hace falta para dibujar un marco: sus hojas (con URL), los tokens y las piezas que usa. */
  async dibujable(pid: string, m: { html: string; css: string; ancho: number; alto: number; hojas: string[]; datos: DatosMarco; origen: Origen; nombre?: string }): Promise<EntradaRender> {
    await this.pidPropio(pid)
    const piezas = await this.piezasDe(pid, m.html)
    const claves = hojasNecesarias(m.hojas, piezas)
    const hojasF = claves.length
      ? await this.db.consulta(`select clave, datos from diseno_items where proyecto_id = $1 and tipo = 'hoja' and clave = any($2::text[])`, [pid, claves])
      : []
    const porClave = new Map(hojasF.map((h) => [h.clave as string, h.datos as Fila]))
    const hojas = claves.map((c) => {
      const d = porClave.get(c)
      return { clave: c, url: d?.ruta as string | undefined, urlEstados: d?.rutaEstados as string | undefined, css: d?.css as string | undefined }
    })
    return { marco: m, hojas, cssTokens: await this.cssTokens(pid), piezas }
  }

  async piezasDe(pid: string, html: string): Promise<Record<string, DatosPieza>> {
    await this.pidPropio(pid)
    const r: Record<string, DatosPieza> = {}
    let pendientes = piezasUsadas(html)
    for (let vuelta = 0; vuelta < 5 && pendientes.length; vuelta++) {
      const filas = await this.db.consulta(`select clave, datos from diseno_items where proyecto_id = $1 and tipo = 'pieza' and clave = any($2::text[])`, [pid, pendientes])
      const nuevas: string[] = []
      for (const f of filas) {
        r[f.clave] = f.datos as DatosPieza
        for (const c of piezasUsadas([f.datos.html ?? '', ...Object.values((f.datos.variantes ?? {}) as Record<string, string>)].join(''))) if (!r[c] && !nuevas.includes(c)) nuevas.push(c)
      }
      pendientes = nuevas.filter((c) => !r[c])
    }
    return r
  }

  async cssTokens(pid: string): Promise<string> {
    await this.pidPropio(pid)
    const filas = await this.db.consulta(`select * from diseno_items where proyecto_id = $1 and tipo = any($2::text[]) and not archivado order by tipo, orden collate "C", clave`, [pid, ['token', 'estilo_texto', 'fuente']])
    const items = filas.map((f) => aItem(f))
    return hojaDeTokens({
      tokens: items.filter((i) => i.tipo === 'token') as ItemDiseno<'token'>[],
      estilos: items.filter((i) => i.tipo === 'estilo_texto') as ItemDiseno<'estilo_texto'>[],
      fuentes: items.filter((i) => i.tipo === 'fuente') as ItemDiseno<'fuente'>[],
    })
  }

  async revisiones(pid: string, ref: string) {
    await this.pidPropio(pid)
    const m = await this.resolverMarco(pid, ref, { conArchivados: true })
    const filas = await this.db.consulta(`select n, actor, resumen, creado_en, ancho, alto from diseno_revisiones where marco_id = $1 order by n desc limit 50`, [m.id])
    return {
      actual: m.revision,
      revisiones: filas.map((f) => ({ n: Number(f.n), actor: f.actor as Actor | null, resumen: f.resumen as string, creadoEn: new Date(f.creado_en).toISOString(), ancho: Number(f.ancho), alto: Number(f.alto) })),
    }
  }

  // ───────────────────────── marcos: escribir ─────────────────────────

  private guardableImportado(m: Marco) {
    if (m.origen === 'importado') throw new ErrorDominio('Este marco viene del código. Hacé una copia editable con duplicar_marco (o "Hacer una copia editable") y editá la copia.', 409)
  }

  /** Lugar libre para un marco nuevo en su sección (al final de su última fila, o abajo de todo). */
  async lugarLibre(paginaId: string, seccion: string, ancho: number, alto: number, excluir: string[] = []): Promise<{ x: number; y: number }> {
    const marcos = (await this.db.consulta(`select id, x, y, ancho, alto, seccion from diseno_marcos where pagina_id = $1 and archivado_en is null`, [paginaId])).filter((m) => !excluir.includes(m.id))
    if (!marcos.length) return { x: 0, y: 0 }
    const rects = marcos.map((m) => ({ x: Number(m.x), y: Number(m.y), ancho: Number(m.ancho), alto: Number(m.alto) }))
    const choca = (x: number, y: number) => rects.some((r) => x < r.x + r.ancho + 32 && x + ancho + 32 > r.x && y < r.y + r.alto + 32 && y + alto + 32 > r.y)
    const lim = limitesDe(rects)!
    const deSeccion = marcos.filter((m) => (m.seccion ?? '') === seccion)
    if (deSeccion.length) {
      const ultimaY = Math.max(...deSeccion.map((m) => Number(m.y)))
      const fila = deSeccion.filter((m) => Math.abs(Number(m.y) - ultimaY) < 1)
      const x0 = Math.min(...deSeccion.map((m) => Number(m.x)))
      const finX = Math.max(...fila.map((m) => Number(m.x) + Number(m.ancho)))
      if (finX + 64 + ancho - x0 <= 4000 && !choca(finX + 64, ultimaY)) return { x: finX + 64, y: ultimaY }
      // fila nueva: 120 entre filas (lugar para el nombre del marco, como en acomodar)
      const y = ultimaY + Math.max(...fila.map((m) => Number(m.alto))) + 120
      if (!choca(x0, y)) return { x: x0, y }
    }
    // sección nueva: abajo de todo, con lugar para su título (200 + 40, como en acomodar)
    return { x: lim.x, y: lim.y + lim.alto + (seccion ? 240 : 120) }
  }

  async crearMarco(ctx: Ctx, pid: string, e: NuevoMarco): Promise<{ marco: Marco; avisos: string[]; reemplazado: boolean }> {
    await this.pidPropio(pid)
    const pagina = await this.resolverPagina(pid, e.pagina, { crear: true, ctx })
    if (pagina.origen === 'importado') throw new ErrorDominio(`La página «${pagina.nombre}» viene del código: los marcos nuevos van en una página propia (poné otro nombre de página y se crea).`, 409)
    if (pagina.tipo !== 'lienzo') throw new ErrorDominio(`«${pagina.nombre}» es una página de ${pagina.tipo === 'sistema' ? 'sistema (se dibuja sola con los tokens y activos)' : 'tabla'}: los marcos van en una página de lienzo.`, 400)
    if (!(e.ancho >= 16 && e.alto >= 16 && e.ancho <= 8192 && e.alto <= 8192)) throw new ErrorDominio('Un marco mide entre 16 y 8192 px de lado.', 400)
    const s = sanearHtml(e.html ?? '')
    const css = sanearCss([e.css ?? '', s.css].filter(Boolean).join('\n'))
    const hojas = await this.validarHojas(pid, e.hojas ?? [])
    const seccion = (e.seccion ?? '').trim()
    const datos: DatosMarco = { ...(e.datos ?? {}) }
    // con clave: si ya hay un marco propio con esa clave, se reemplaza (reintentar no duplica)
    if (e.clave) {
      const [ya] = await this.db.consulta(`select * from diseno_marcos where proyecto_id = $1 and clave = $2`, [pid, e.clave])
      if (ya) {
        if (ya.origen === 'importado') throw new ErrorDominio(`La clave «${e.clave}» es de un marco importado: usá otra.`, 409)
        const r = await this.guardarMarco(ctx, pid, aMarco(ya), {
          html: s.html,
          css,
          ancho: e.ancho,
          alto: e.alto,
          nombre: e.nombre,
          seccion,
          grupo: e.grupo ?? ya.grupo ?? null,
          datos: { ...(ya.datos as DatosMarco), ...datos },
          x: e.x ?? Number(ya.x),
          y: e.y ?? Number(ya.y),
        }, { hojas, pagina: pagina.id, resumen: 'reemplazado (misma clave)', archivadoNo: true })
        if (e.tarjetas?.length) for (const t of e.tarjetas) await this.vincular(ctx, pid, `marco:${r.id}`, t, { silencioso: true })
        return { marco: await this.resolverMarco(pid, r.id), avisos: s.avisos, reemplazado: true }
      }
    }
    const lugar = e.x === undefined || e.y === undefined ? await this.lugarLibre(pagina.id, seccion, e.ancho, e.alto) : { x: e.x, y: e.y }
    const id = `m_${idMarco()}`
    await this.db.consulta(
      `insert into diseno_marcos (id, proyecto_id, pagina_id, nombre, seccion, grupo, x, y, ancho, alto, html, css, hojas, datos, origen, clave, hash, creado_por)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,'propio',$15,$16,$17::jsonb)`,
      [id, pid, pagina.id, e.nombre.trim() || 'Marco', seccion, e.grupo ?? null, Math.round(lugar.x), Math.round(lugar.y), Math.round(e.ancho), Math.round(e.alto), s.html, css, j(hojas), j(datos), e.clave ?? null, sha12(s.html + css), j(ctx.actor)],
    )
    for (const t of e.tarjetas ?? []) await this.vincular(ctx, pid, `marco:${id}`, t, { silencioso: true })
    await this.registrar(ctx, pid, 'diseno.marco.creado', `creó el marco «${e.nombre}» (${e.ancho}×${e.alto}) en «${pagina.nombre}»`, { marco: id })
    this.publicar(ctx, pid, { accion: 'marco', paginaId: pagina.id, marcos: [id] })
    return { marco: await this.resolverMarco(pid, id), avisos: s.avisos, reemplazado: false }
  }

  private async validarHojas(pid: string, hojas: string[]): Promise<string[]> {
    if (!hojas.length) return []
    const filas = await this.db.consulta(`select clave from diseno_items where proyecto_id = $1 and tipo = 'hoja' and not archivado`, [pid])
    const hay = new Set(filas.map((f) => f.clave as string))
    const faltan = hojas.filter((h) => !hay.has(h))
    if (faltan.length) throw new ErrorDominio(`No existen las hojas ${faltan.map((h) => `«${h}»`).join(', ')}. Hojas del proyecto: ${[...hay].join(', ') || 'ninguna'}.`, 404)
    return [...new Set(hojas)]
  }

  /** Guarda un estado nuevo de un marco: revisión de lo anterior, revisión + 1, evento. */
  private async guardarMarco(
    ctx: Ctx,
    pid: string,
    m: Marco,
    e: EstadoMarco,
    op: { hojas?: string[]; pagina?: string; resumen: string; contenido?: boolean; archivadoNo?: boolean; silencioso?: boolean },
  ): Promise<Marco> {
    const contenido = op.contenido ?? true
    const nueva = contenido ? m.revision + 1 : m.revision
    await this.db.transaccion(async (tx) => {
      if (contenido) {
        await tx.consulta(
          `insert into diseno_revisiones (marco_id, n, html, css, datos, ancho, alto, actor, resumen) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9)
           on conflict (marco_id, n) do nothing`,
          [m.id, m.revision, m.html, m.css, j(m.datos), m.ancho, m.alto, j(ctx.actor), op.resumen.slice(0, 300)],
        )
        await tx.consulta(`delete from diseno_revisiones where marco_id = $1 and n <= $2`, [m.id, nueva - 51])
      }
      const datos = { ...e.datos }
      if (contenido) {
        delete datos.cajas
        delete datos.avisos
        delete (datos as Record<string, unknown>).estilos
      }
      await tx.consulta(
        `update diseno_marcos set html = $2, css = $3, datos = $4::jsonb, ancho = $5, alto = $6, nombre = $7, seccion = $8, grupo = $9, x = $10, y = $11,
           revision = $12, hash = $13, actualizado_en = now(), hojas = coalesce($14::jsonb, hojas), pagina_id = coalesce($15, pagina_id)
           ${op.archivadoNo ? ', archivado_en = null' : ''} where id = $1`,
        [m.id, e.html, e.css, j(datos), e.ancho, e.alto, e.nombre, e.seccion, e.grupo, Math.round(e.x), Math.round(e.y), nueva, sha12(e.html + e.css), op.hojas ? j(op.hojas) : null, op.pagina ?? null],
      )
    })
    if (!op.silencioso) this.publicar(ctx, pid, { accion: 'marco', paginaId: op.pagina ?? m.paginaId, marcos: [m.id] })
    return { ...m, ...e, revision: nueva }
  }

  /** Aplica operaciones (editar_marco y la web). Todas o ninguna. */
  async editarMarco(ctx: Ctx, pid: string, ref: string, ops: OperacionMarco[], o: { revision?: number; registrar?: boolean } = {}): Promise<ResultadoEdicion> {
    await this.pidPropio(pid)
    const m = await this.resolverMarco(pid, ref)
    this.guardableImportado(m)
    if (m.bloqueado && ops.some((x) => x.op !== 'marco')) throw new ErrorDominio(`El marco «${m.nombre}» está bloqueado. Desbloquealo (organizar_diseno: { accion: "bloquear", marco, si: false }) para editarlo.`, 409)
    if (o.revision !== undefined && o.revision !== m.revision)
      throw new ErrorDominio(`El marco cambió mientras tanto (ahora va por la revisión ${m.revision}, mandaste la ${o.revision}). Volvé a leerlo.`, 409)
    if (!ops.length) throw new ErrorDominio('Mandá al menos una operación.')
    let estado: EstadoMarco = { html: m.html, css: m.css, datos: m.datos, ancho: m.ancho, alto: m.alto, nombre: m.nombre, seccion: m.seccion, grupo: m.grupo, x: m.x, y: m.y }
    const lineas: string[] = []
    let resto = ops
    let contenido = false
    if (ops[0]!.op === 'restaurar') {
      const n = ops[0]!.revision
      if (n !== m.revision) {
        const [rev] = await this.db.consulta(`select * from diseno_revisiones where marco_id = $1 and n = $2`, [m.id, n])
        if (!rev) {
          const hay = await this.db.consulta(`select n from diseno_revisiones where marco_id = $1 order by n desc limit 12`, [m.id])
          throw new ErrorDominio(`No está la revisión ${n} de este marco. Hay: ${hay.map((h) => h.n).join(', ') || 'ninguna anterior'} (y la actual, ${m.revision}).`, 404)
        }
        estado = { ...estado, html: rev.html, css: rev.css, datos: { ...(rev.datos as DatosMarco) }, ancho: Number(rev.ancho), alto: Number(rev.alto) }
        contenido = true
        lineas.push(`restaurar: volví a la revisión ${n}`)
      } else lineas.push(`restaurar: ya está en la revisión ${n}`)
      resto = ops.slice(1)
    }
    const r = resto.length ? aplicarOperaciones(estado, resto) : { estado, lineas: [], creadas: [], avisos: [], contenido: false }
    lineas.push(...r.lineas)
    contenido ||= r.contenido
    const cambioDatos = JSON.stringify(r.estado.datos) !== JSON.stringify(m.datos)
    const cambioPos = r.estado.x !== m.x || r.estado.y !== m.y || r.estado.nombre !== m.nombre || r.estado.seccion !== m.seccion || r.estado.grupo !== m.grupo
    if (!contenido && !cambioDatos && !cambioPos) return { marco: m, lineas, creadas: [], avisos: r.avisos, revisionAntes: m.revision }
    const guardado = await this.guardarMarco(ctx, pid, m, r.estado, { resumen: lineas.join(' · ').slice(0, 300), contenido: contenido || cambioDatos })
    if (o.registrar ?? ctx.actor.tipo !== 'humano')
      await this.registrar(ctx, pid, 'diseno.marco.editado', `editó el marco «${guardado.nombre}» (${lineas.length} ${lineas.length === 1 ? 'cambio' : 'cambios'})`, { marco: m.id, revision: guardado.revision })
    return { marco: await this.resolverMarco(pid, m.id), lineas, creadas: r.creadas, avisos: r.avisos, revisionAntes: m.revision }
  }

  /** PATCH de la web: campos sueltos (nombre, posición, tamaño, sección, datos, html, css). */
  async actualizarMarco(ctx: Ctx, pid: string, ref: string, c: { nombre?: string; x?: number; y?: number; ancho?: number; alto?: number; seccion?: string; grupo?: string | null; datos?: Partial<DatosMarco>; html?: string; css?: string; bloqueado?: boolean; revision?: number }) {
    await this.pidPropio(pid)
    const m = await this.resolverMarco(pid, ref)
    if (c.bloqueado !== undefined) {
      await this.db.consulta(`update diseno_marcos set bloqueado = $2 where id = $1`, [m.id, c.bloqueado])
      this.publicar(ctx, pid, { accion: 'marco', paginaId: m.paginaId, marcos: [m.id] })
      if (Object.keys(c).length === 1) return this.resolverMarco(pid, m.id)
    }
    const ops: OperacionMarco[] = []
    if (c.html !== undefined) {
      this.guardableImportado(m)
      const s = sanearHtml(c.html, {})
      const css = c.css !== undefined ? sanearCss(c.css) : m.css
      const nuevo = { ...m, html: s.html, css: s.css ? css + '\n' + s.css : css }
      return (await this.guardarMarco(ctx, pid, m, { ...nuevo, datos: m.datos }, { resumen: 'HTML editado a mano' })) && this.resolverMarco(pid, m.id)
    }
    if (c.css !== undefined) ops.push({ op: 'css', css: c.css, como: 'reemplazar' })
    if (c.nombre !== undefined || c.x !== undefined || c.y !== undefined || c.seccion !== undefined || c.grupo !== undefined || c.ancho !== undefined || c.alto !== undefined)
      ops.push({
        op: 'marco',
        nombre: c.nombre,
        x: c.x,
        y: c.y,
        seccion: c.seccion,
        grupo: c.grupo,
        tamano: c.ancho !== undefined || c.alto !== undefined ? { ancho: Math.round(c.ancho ?? m.ancho), alto: Math.round(c.alto ?? m.alto) } : undefined,
      })
    if (m.origen === 'importado') throw new ErrorDominio('Este marco viene del código: no se mueve ni se cambia. Hacé una copia editable.', 409)
    let r = ops.length ? await this.editarMarco(ctx, pid, m.id, ops, { revision: c.revision, registrar: false }) : { marco: m }
    if (c.datos) {
      const datos = { ...r.marco.datos, ...c.datos }
      const g = await this.guardarMarco(ctx, pid, r.marco, { ...r.marco, datos }, { resumen: 'datos del marco' })
      r = { marco: g }
    }
    return this.resolverMarco(pid, r.marco.id)
  }

  async archivarMarco(ctx: Ctx, pid: string, ref: string, archivar = true) {
    await this.pidPropio(pid)
    const m = await this.resolverMarco(pid, ref, { conArchivados: true })
    if (m.origen === 'importado') throw new ErrorDominio('Este marco viene del código: se va solo si desaparece del código en la próxima sincronización.', 409)
    await this.db.consulta(`update diseno_marcos set archivado_en = ${archivar ? 'now()' : 'null'} where id = $1`, [m.id])
    await this.registrar(ctx, pid, archivar ? 'diseno.marco.archivado' : 'diseno.marco.restaurado', `${archivar ? 'archivó' : 'restauró'} el marco «${m.nombre}»`, { marco: m.id })
    this.publicar(ctx, pid, { accion: 'marco', paginaId: m.paginaId, marcos: [m.id] })
    return { ...m, archivado: archivar }
  }

  /**
   * Copias, variantes y adaptaciones. Desde un marco importado, la copia va a una página propia y es editable.
   */
  async duplicarMarco(
    ctx: Ctx,
    pid: string,
    ref: string,
    o: {
      pagina?: string
      copias?: { nombre?: string; tamano?: string | { ancho: number; alto: number }; textos?: Record<string, string>; estilos?: Record<string, Record<string, string | number | null>>; propiedades?: Record<string, Record<string, string | boolean | number | null>> }[]
      tamanos?: (string | { ancho: number; alto: number })[]
      nombre?: string
      seccion?: string
    } = {},
  ): Promise<Marco[]> {
    await this.pidPropio(pid)
    const fuente = await this.resolverMarco(pid, ref)
    let pagina: PaginaDiseno
    if (o.pagina) pagina = await this.resolverPagina(pid, o.pagina, { crear: true, ctx })
    else if (fuente.origen === 'importado') pagina = await this.resolverPagina(pid, 'Copias editables', { crear: true, ctx })
    else pagina = await this.resolverPagina(pid, fuente.paginaId)
    if (pagina.origen === 'importado' || pagina.tipo !== 'lienzo') throw new ErrorDominio(`Las copias van a una página propia de lienzo; «${pagina.nombre}» no lo es. Pasá pagina: "Copias editables" (se crea).`, 409)
    const pedidos: NonNullable<typeof o.copias> = o.copias?.length
      ? o.copias
      : o.tamanos?.length
        ? o.tamanos.map((t) => ({ tamano: t }))
        : [{ nombre: o.nombre }]
    const grupo = o.tamanos?.length || (o.copias?.length ?? 0) > 1 ? fuente.grupo ?? `g_${idMarco()}` : fuente.grupo
    if (grupo && !fuente.grupo && fuente.origen === 'propio') await this.db.consulta(`update diseno_marcos set grupo = $2 where id = $1`, [fuente.id, grupo])
    const creados: Marco[] = []
    let x = (pagina.id === fuente.paginaId ? fuente.x + fuente.ancho : 0) + 64
    const y = pagina.id === fuente.paginaId ? fuente.y : 0
    const datosBase: DatosMarco = { ...fuente.datos }
    delete datosBase.cajas
    delete datosBase.avisos
    delete datosBase.miniaturaRev
    delete datosBase.importacion
    delete (datosBase as Record<string, unknown>).estilos
    for (const pedido of pedidos) {
      const medidas = pedido.tamano ? medidasDe(pedido.tamano, this.prefijadosExtra) : { ancho: fuente.ancho, alto: fuente.alto, prefijado: fuente.datos.prefijado ?? null }
      if (!medidas) throw new ErrorDominio(`No entiendo el tamaño «${JSON.stringify(pedido.tamano)}». Prefijados: ${PREFIJADOS.map((p) => p.id).join(', ')}; o { ancho, alto }.`, 400)
      const nombre =
        pedido.nombre ??
        (pedido.tamano ? `${fuente.nombre.replace(/\s·\s\d+\s?×\s?\d+$/, '')} · ${PREFIJADOS.find((p) => p.id === medidas.prefijado)?.nombre ?? `${medidas.ancho}×${medidas.alto}`}` : fuente.origen === 'importado' ? `${fuente.nombre} (copia)` : `${fuente.nombre} (copia)`)
      const ops: OperacionMarco[] = []
      for (const [capa, texto] of Object.entries(pedido.textos ?? {})) ops.push({ op: 'texto', capa, texto })
      for (const [capa, estilos] of Object.entries(pedido.estilos ?? {})) ops.push({ op: 'estilo', capa, estilos })
      for (const [capa, valores] of Object.entries(pedido.propiedades ?? {})) ops.push({ op: 'propiedades', capa, valores })
      let estado: EstadoMarco = { html: fuente.html, css: fuente.css, datos: { ...datosBase, prefijado: medidas.prefijado ?? undefined, copiaDe: fuente.id }, ancho: medidas.ancho, alto: medidas.alto, nombre, seccion: o.seccion ?? fuente.seccion, grupo, x: 0, y: 0 }
      if (ops.length) estado = aplicarOperaciones(estado, ops).estado
      const lugarOk = pagina.id === fuente.paginaId ? { x, y } : await this.lugarLibre(pagina.id, estado.seccion, medidas.ancho, medidas.alto)
      const choca = await this.choca(pagina.id, lugarOk.x, lugarOk.y, medidas.ancho, medidas.alto)
      const lugar = choca ? await this.lugarLibre(pagina.id, estado.seccion, medidas.ancho, medidas.alto) : lugarOk
      const id = `m_${idMarco()}`
      await this.db.consulta(
        `insert into diseno_marcos (id, proyecto_id, pagina_id, nombre, seccion, grupo, x, y, ancho, alto, html, css, hojas, datos, origen, hash, creado_por)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,'propio',$15,$16::jsonb)`,
        [id, pid, pagina.id, estado.nombre, estado.seccion, grupo ?? null, Math.round(lugar.x), Math.round(lugar.y), medidas.ancho, medidas.alto, estado.html, estado.css, j(fuente.hojas), j(estado.datos), sha12(estado.html + estado.css), j(ctx.actor)],
      )
      // los vínculos con tarjetas siguen a la copia
      await this.db.consulta(
        `insert into diseno_vinculos (proyecto_id, objetivo, tarjeta_id) select proyecto_id, $2, tarjeta_id from diseno_vinculos where objetivo = $1 on conflict do nothing`,
        [`marco:${fuente.id}`, `marco:${id}`],
      )
      creados.push(await this.resolverMarco(pid, id))
      x = lugar.x + medidas.ancho + 64
    }
    await this.registrar(
      ctx,
      pid,
      'diseno.marco.duplicado',
      creados.length === 1 ? `hizo una copia de «${fuente.nombre}»${fuente.origen === 'importado' ? ' (editable)' : ''}` : `armó ${creados.length} variantes de «${fuente.nombre}»`,
      { marcos: creados.map((c) => c.id) },
    )
    this.publicar(ctx, pid, { accion: 'marco', paginaId: pagina.id, marcos: creados.map((c) => c.id) })
    return creados
  }

  private async choca(paginaId: string, x: number, y: number, ancho: number, alto: number) {
    const [f] = await this.db.consulta(
      `select 1 from diseno_marcos where pagina_id = $1 and archivado_en is null
          and x < $2::float8 + $4::float8 + 32 and x + ancho + 32 > $2::float8 and y < $3::float8 + $5::float8 + 32 and y + alto + 32 > $3::float8 limit 1`,
      [paginaId, x, y, ancho, alto],
    )
    return Boolean(f)
  }

  /** Prefijados del proyecto: las vistas del perfil y los tamaños de sus plantillas. */
  prefijadosExtra: Prefijado[] = []
  async prefijadosDe(pid: string): Promise<Prefijado[]> {
    await this.pidPropio(pid)
    const perfil = await this.perfil(pid)
    const extra: Prefijado[] = Object.entries(perfil?.vistas ?? {}).map(([k, v]) => ({ id: `vista-${k}`, nombre: `Vista ${k}`, grupo: 'Del proyecto', ancho: v.ancho, alto: v.alto }))
    const plantillas = await this.db.consulta(`select clave, nombre, datos from diseno_items where proyecto_id = $1 and tipo = 'plantilla' and not archivado`, [pid])
    for (const p of plantillas) if (p.datos?.ancho && p.datos?.alto) extra.push({ id: `plantilla-${p.clave}`, nombre: `Plantilla ${p.nombre}`, grupo: 'Del proyecto', ancho: Number(p.datos.ancho), alto: Number(p.datos.alto) })
    this.prefijadosExtra = extra
    return extra
  }

  /**
   * "Ordenar la página": vuelve a acomodar los marcos por sección, en el orden en que están. En una página importada solo
   * cambia dónde está cada marco (el contenido no se toca): es lo mismo que hace la próxima importación.
   */
  async ordenarPagina(ctx: Ctx, pid: string, ref: string) {
    await this.pidPropio(pid)
    const pg = await this.resolverPagina(pid, ref)
    const marcos = await this.db.consulta(`select id, seccion, ancho, alto from diseno_marcos where pagina_id = $1 and archivado_en is null order by y, x`, [pg.id])
    const lugares = acomodar(marcos.map((m) => ({ id: m.id, seccion: m.seccion ?? '', ancho: Number(m.ancho), alto: Number(m.alto) })))
    for (const [id, l] of lugares) await this.db.consulta(`update diseno_marcos set x = $2, y = $3 where id = $1`, [id, l.x, l.y])
    this.publicar(ctx, pid, { accion: 'marco', paginaId: pg.id, marcos: [...lugares.keys()] })
    return lugares.size
  }

  // ───────────────────────── render ─────────────────────────

  /** Dibuja un marco (o una capa). Guarda las cajas y los avisos del dibujo (los usa leer_diseno). */
  async render(pid: string, ref: string, op: OpcionesRender = {}): Promise<ResultadoRender & { marco: Marco }> {
    await this.pidPropio(pid)
    const m = await this.resolverMarco(pid, ref, { conArchivados: true })
    const entrada = await this.dibujable(pid, m)
    const r = await this.motor.render(this, pid, m, entrada, op)
    if (!op.capa && Object.keys(r.cajas).length && m.datos.cajasRev !== m.revision) {
      await this.db.consulta(`update diseno_marcos set datos = datos || $2::jsonb where id = $1 and revision = $3`, [m.id, j({ cajas: r.cajas, estilos: r.estilos, avisos: r.avisos, cajasRev: m.revision }), m.revision])
    }
    return { ...r, marco: m }
  }

  /** Cajas y estilos del último dibujo; si el marco cambió desde entonces, se mide en el momento. */
  async cajas(pid: string, m: Marco): Promise<{ cajas: Record<string, Caja>; estilos: Record<string, string>; avisos: string[] }> {
    await this.pidPropio(pid)
    const [f] = await this.db.consulta(`select datos->'cajas' as cajas, datos->'estilos' as estilos, datos->'avisos' as avisos, (datos->>'cajasRev')::int as rev from diseno_marcos where id = $1`, [m.id])
    if (f?.cajas && Number(f.rev) === m.revision) return { cajas: f.cajas, estilos: f.estilos ?? {}, avisos: f.avisos ?? [] }
    try {
      const r = await this.render(pid, m.id, { soloMedir: true })
      return { cajas: r.cajas, estilos: r.estilos, avisos: r.avisos }
    } catch {
      return { cajas: f?.cajas ?? {}, estilos: f?.estilos ?? {}, avisos: [] }
    }
  }

  /** Miniatura (WebP, lado mayor 640). Se saca una vez por revisión y queda en el almacén. */
  async miniatura(pid: string, ref: string): Promise<{ datos: Uint8Array; mime: string }> {
    await this.pidPropio(pid)
    const m = await this.resolverMarco(pid, ref, { conArchivados: true })
    if (m.miniatura && m.datos.miniaturaRev === m.revision) {
      const a = await this.almacen.leer(m.miniatura.replace(/^\/archivos\//, ''))
      if (a) return { datos: a.datos, mime: a.mime || 'image/webp' }
    }
    const r = await this.render(pid, m.id, { formato: 'webp', ladoMax: 640, calidad: 0.82 })
    const ruta = `diseno/${pid}/min/${m.id}-${m.revision}.webp`
    await this.almacen.guardar(ruta, r.bytes!, 'image/webp')
    await this.db.consulta(`update diseno_marcos set miniatura = $2, datos = datos || $3::jsonb where id = $1`, [m.id, `/archivos/${ruta}`, j({ miniaturaRev: m.revision })])
    return { datos: r.bytes!, mime: r.mime }
  }

  async grilla(pid: string, refs: string[], op: OpcionesRender = {}) {
    await this.pidPropio(pid)
    if (refs.length > 6) throw new ErrorDominio('Hasta 6 marcos por imagen.', 400)
    const imagenes = []
    const avisos: string[] = []
    for (const ref of refs) {
      const m = await this.resolverMarco(pid, ref)
      const escala = op.escala ?? Math.min(1, 720 / Math.max(m.ancho, m.alto))
      const r = await this.render(pid, m.id, { ...op, escala })
      imagenes.push({ nombre: m.nombre, bytes: r.bytes!, mime: r.mime, ancho: m.ancho, alto: m.alto })
      for (const a of r.avisos) avisos.push(`${m.nombre}: ${a}`)
    }
    const g = await this.motor.grilla(imagenes)
    return { ...g, avisos }
  }

  // ───────────────────────── ítems del sistema ─────────────────────────

  async items(pid: string, f: { tipo?: TipoItem; grupo?: string; q?: string; desde?: number; limite?: number; archivados?: boolean } = {}) {
    await this.pidPropio(pid)
    const cond = ['i.proyecto_id = $1']
    const params: unknown[] = [pid]
    if (!f.archivados) cond.push('not i.archivado')
    if (f.tipo) {
      params.push(f.tipo)
      cond.push(`i.tipo = $${params.length}`)
    }
    if (f.grupo) {
      params.push(f.grupo)
      cond.push(`i.grupo = $${params.length}`)
    }
    if (f.q?.trim()) {
      params.push(`%${normalizar(f.q.trim()).replace(/[%_\\]/g, (c) => '\\' + c)}%`)
      cond.push(`(lower(i.clave) like $${params.length} or lower(i.nombre) like $${params.length} or lower(i.datos::text) like $${params.length})`)
    }
    const limite = Math.min(Math.max(f.limite ?? 200, 1), 500)
    const desde = Math.max(0, f.desde ?? 0)
    const [{ n } = { n: 0 }] = await this.db.consulta<{ n: number }>(`select count(*)::int as n from diseno_items i where ${cond.join(' and ')}`, params)
    const filas = await this.db.consulta(
      `select i.*, n.objetivo as n_objetivo, n.nombre_propio as n_nombre_propio, n.uso as n_uso, n.nota as n_nota, n.estado as n_estado,
              n.actualizado_por as n_actualizado_por, n.actualizado_en as n_actualizado_en
         from diseno_items i left join diseno_notas n on n.proyecto_id = i.proyecto_id and n.objetivo = 'item:' || i.tipo || ':' || i.clave
        where ${cond.join(' and ')} order by i.tipo, i.grupo collate "C", i.orden collate "C", i.clave collate "C" limit ${limite} offset ${desde}`,
      params,
    )
    const ultima = await this.ultimaImportacion(pid)
    return { items: filas.map((x) => aItem(x, ultima)), total: Number(n), desde, siguiente: desde + filas.length < Number(n) ? desde + filas.length : null }
  }

  async item(pid: string, tipo: TipoItem, clave: string): Promise<ItemDiseno> {
    await this.pidPropio(pid)
    if (!TIPOS_ITEM.includes(tipo)) throw new ErrorDominio(`Tipo de ítem desconocido: ${tipo}. Tipos: ${TIPOS_ITEM.join(', ')}.`)
    const filas = await this.db.consulta(
      `select i.*, n.objetivo as n_objetivo, n.nombre_propio as n_nombre_propio, n.uso as n_uso, n.nota as n_nota, n.estado as n_estado,
              n.actualizado_por as n_actualizado_por, n.actualizado_en as n_actualizado_en
         from diseno_items i left join diseno_notas n on n.proyecto_id = i.proyecto_id and n.objetivo = 'item:' || i.tipo || ':' || i.clave
        where i.proyecto_id = $1 and i.tipo = $2 and i.clave = $3`,
      [pid, tipo, clave],
    )
    if (!filas[0]) {
      const parecidos = await this.db.consulta(`select clave from diseno_items where proyecto_id = $1 and tipo = $2 and clave ilike $3 limit 8`, [pid, tipo, `%${clave.slice(0, 12)}%`])
      throw new ErrorDominio(`No existe el ${tipo} «${clave}».${parecidos.length ? ` Parecidos: ${parecidos.map((p) => p.clave).join(', ')}.` : ''}`, 404)
    }
    return aItem(filas[0], await this.ultimaImportacion(pid))
  }

  /** Crea o cambia un ítem propio (pisa por clave). Lo importado no se toca. */
  async guardarItem(ctx: Ctx, pid: string, tipo: TipoItem, clave: string, e: { nombre?: string; grupo?: string; datos: Record<string, unknown> }, op: { silencioso?: boolean } = {}) {
    await this.pidPropio(pid)
    const [ya] = await this.db.consulta(`select origen, orden from diseno_items where proyecto_id = $1 and tipo = $2 and clave = $3`, [pid, tipo, clave])
    if (ya?.origen === 'importado')
      throw new ErrorDominio(`«${clave}» viene del código: no se cambia desde Telar. Proponé el cambio en una tarjeta (botón "Proponer un cambio") o creá uno propio con otro nombre.`, 409)
    let orden = ya?.orden as string | undefined
    if (!orden) {
      const [u] = await this.db.consulta(`select max(orden collate "C") as o from diseno_items where proyecto_id = $1 and tipo = $2`, [pid, tipo])
      orden = generateKeyBetween((u?.o as string | null) ?? null, null)
    }
    await this.db.consulta(
      `insert into diseno_items (proyecto_id, tipo, clave, nombre, grupo, datos, origen, hash, orden, archivado, actualizado_en)
       values ($1,$2,$3,$4,$5,$6::jsonb,'propio',$7,$8,false,now())
       on conflict (proyecto_id, tipo, clave) do update set nombre = excluded.nombre, grupo = excluded.grupo, datos = excluded.datos,
         hash = excluded.hash, archivado = false, actualizado_en = now()`,
      [pid, tipo, clave, e.nombre ?? clave, e.grupo ?? '', j(e.datos), sha12(j(e.datos)), orden],
    )
    if (!op.silencioso) this.publicar(ctx, pid, { accion: 'item', items: [{ tipo, clave }] })
    return { creado: !ya, clave }
  }

  async archivarItem(ctx: Ctx, pid: string, tipo: TipoItem, clave: string, archivar = true) {
    await this.pidPropio(pid)
    const it = await this.item(pid, tipo, clave)
    if (it.origen === 'importado') throw new ErrorDominio(`«${clave}» viene del código: se va solo si desaparece del código.`, 409)
    await this.db.consulta(`update diseno_items set archivado = $4, actualizado_en = now() where proyecto_id = $1 and tipo = $2 and clave = $3`, [pid, tipo, clave, archivar])
    await this.registrar(ctx, pid, 'diseno.item.archivado', `${archivar ? 'archivó' : 'restauró'} ${tipo === 'token' ? 'el token' : tipo === 'pieza' ? 'la pieza' : 'el ítem'} «${it.nombre}»`)
    this.publicar(ctx, pid, { accion: 'item', items: [{ tipo, clave }] })
  }

  /** definir_tokens: tokens y estilos de texto propios, por nombre. */
  async definirTokens(
    ctx: Ctx,
    pid: string,
    e: {
      tokens?: { nombre: string; clase?: string; valor: string; modos?: Record<string, string>; alias?: string; uso?: string; grupo?: string }[]
      estilos?: { nombre: string; familia: string; peso?: number; tamano: string; interlineado?: string; espaciado?: string; mayusculas?: boolean; color?: string; uso?: string }[]
    },
  ): Promise<string[]> {
    await this.pidPropio(pid)
    const lineas: string[] = []
    const cambios: { tipo: TipoItem; clave: string }[] = []
    for (const t of e.tokens ?? []) {
      const nombre = t.nombre.trim().replace(/^--/, '')
      if (!nombre) throw new ErrorDominio('Cada token necesita un nombre (con barras: "color/marca/primario").')
      const valor = String(t.valor ?? '').trim()
      if (!valor && !t.alias) throw new ErrorDominio(`El token «${nombre}» no tiene valor.`)
      if (/[;{}<>]/.test(valor)) throw new ErrorDominio(`El valor de «${nombre}» no puede tener ; llaves ni <>.`)
      sanearCss(`a{b:${valor}}`)
      const clase = (t.clase ?? (aRgb(valor) ? 'color' : /^-?[\d.]+(px|rem|em|%|cqw|cqh|vw|vh)$/.test(valor) ? 'medida' : /^[\d.]+m?s$/.test(valor) ? 'duracion' : /cubic-bezier|ease/.test(valor) ? 'curva' : /^-?[\d.]+$/.test(valor) ? 'numero' : 'texto')) as ItemDiseno<'token'>['datos']['clase']
      if (clase === 'color' && !aRgb(valor) && !/^(var|color-mix|rgb|hsl|oklch|oklab|lab|lch)\(/.test(valor) && !t.alias) throw new ErrorDominio(`«${valor}» no parece un color (para «${nombre}»). Usá #rrggbb, rgb() o var(--otro).`)
      if (t.alias) await this.item(pid, 'token', t.alias.replace(/^--/, '')).catch(() => {
        throw new ErrorDominio(`El alias de «${nombre}» apunta a «${t.alias}», que no existe.`, 404)
      })
      const variable = variableDeToken(nombre)
      const grupo = t.grupo ?? (nombre.includes('/') ? nombre.split('/').slice(0, -1).join('/') : clase)
      await this.guardarItem(ctx, pid, 'token', nombre, { nombre, grupo, datos: { clase, css: variable, valor, modos: t.modos, alias: t.alias?.replace(/^--/, ''), uso: t.uso } }, { silencioso: true })
      cambios.push({ tipo: 'token', clave: nombre })
      lineas.push(`${nombre} → var(${variable}) = ${t.alias ? `alias de ${t.alias}` : valor}${t.modos ? ` (modos: ${Object.entries(t.modos).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`)
    }
    for (const s of e.estilos ?? []) {
      const nombre = s.nombre.trim()
      if (!nombre) throw new ErrorDominio('Cada estilo de texto necesita un nombre.')
      const datos = { clase: claseDeEstilo(nombre), familia: s.familia, peso: s.peso ?? 400, tamano: s.tamano, interlineado: s.interlineado ?? '1.2', espaciado: s.espaciado, mayusculas: s.mayusculas, color: s.color }
      sanearCss(`a{font-size:${s.tamano};line-height:${datos.interlineado}${s.color ? ';color:' + s.color : ''}}`)
      await this.guardarItem(ctx, pid, 'estilo_texto', nombre, { nombre, grupo: 'Estilos de texto', datos }, { silencioso: true })
      cambios.push({ tipo: 'estilo_texto', clave: nombre })
      lineas.push(`estilo «${nombre}» → class="${datos.clase}" (${s.familia} ${datos.peso} ${s.tamano}/${datos.interlineado})`)
    }
    if (cambios.length) {
      await this.registrar(ctx, pid, 'diseno.tokens', `definió ${cambios.length} ${cambios.length === 1 ? 'token' : 'tokens y estilos'} en Diseño`)
      this.publicar(ctx, pid, { accion: 'item', items: cambios })
    }
    return lineas
  }

  /** definir_pieza: una pieza (componente) o una plantilla. Crea o actualiza su hoja de variantes. */
  async definirPieza(
    ctx: Ctx,
    pid: string,
    e: {
      nombre: string
      clase?: 'pieza' | 'plantilla'
      html?: string
      css?: string
      propiedades?: PropPieza[]
      desde?: { marco: string; capa?: string }
      tamano?: string | { ancho: number; alto: number }
      hojas?: string[]
      descripcion?: string
    },
  ): Promise<{ clave: string; tipo: 'pieza' | 'plantilla'; hoja?: Marco; reemplazada?: string; ranuras?: DatosPlantilla['ranuras'] }> {
    await this.pidPropio(pid)
    const clase = e.clase ?? 'pieza'
    const clave = slug(e.nombre).replace(/^tablero$/, 'pieza')
    let html = e.html ?? ''
    let css = e.css ?? ''
    let hojas = e.hojas ?? []
    let origenMarco: Marco | null = null
    if (e.desde) {
      origenMarco = await this.resolverMarco(pid, e.desde.marco)
      const raiz = analizarHtml(origenMarco.html)
      if (e.desde.capa) {
        const el = buscarPorId(raiz, e.desde.capa)
        if (!el) throw new ErrorDominio(`No existe la capa \`${e.desde.capa}\`. Capas: ${listaDeCapas(raiz)}.`, 404)
        html = serializarHtml(clonar(el))
      } else html = origenMarco.html
      css = [origenMarco.css, css].filter(Boolean).join('\n')
      hojas = [...new Set([...origenMarco.hojas, ...hojas])]
      if (clase === 'plantilla' && !e.tamano) e.tamano = { ancho: origenMarco.ancho, alto: origenMarco.alto }
    }
    if (!html.trim()) throw new ErrorDominio('La pieza necesita html (o desde: { marco, capa }).')
    const s = sanearHtml(html, { conIds: clase === 'plantilla', que: `la pieza «${e.nombre}»` })
    css = sanearCss([css, s.css].filter(Boolean).join('\n'))
    await this.validarHojas(pid, hojas)
    if (clase === 'plantilla') {
      const m = e.tamano ? medidasDe(e.tamano) : null
      if (!m) throw new ErrorDominio('Una plantilla necesita tamano (un prefijado o { ancho, alto }).')
      const ranuras: DatosPlantilla['ranuras'] = []
      for (const mm of s.html.matchAll(/(src|href)="\{\{\s*([\w-]+)\s*\}\}"/g)) if (!ranuras.some((r) => r.nombre === mm[2])) ranuras.push({ nombre: mm[2]!, clase: 'imagen' })
      for (const mm of s.html.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)) if (!ranuras.some((r) => r.nombre === mm[1])) ranuras.push({ nombre: mm[1]!, clase: 'texto' })
      await this.guardarItem(ctx, pid, 'plantilla', clave, { nombre: e.nombre, grupo: 'Plantillas', datos: { html: s.html, css, hojas, ancho: m.ancho, alto: m.alto, ranuras, descripcion: e.descripcion } })
      await this.registrar(ctx, pid, 'diseno.plantilla', `definió la plantilla «${e.nombre}» (${m.ancho}×${m.alto})`)
      return { clave, tipo: 'plantilla', ranuras }
    }
    const propiedades = (e.propiedades ?? []).map((p) => ({ ...p, nombre: p.nombre.trim() }))
    for (const p of propiedades) {
      if (!/^[\w-]{1,40}$/.test(p.nombre)) throw new ErrorDominio(`«${p.nombre}» no sirve como nombre de propiedad (letras, números, - y _).`)
      if (p.clase === 'variante' && !p.valores?.length) throw new ErrorDominio(`La propiedad de variante «${p.nombre}» necesita valores (["naranja","verde"]).`)
    }
    const datos: DatosPieza = { html: s.html, css, hojas, propiedades, descripcion: e.descripcion }
    await this.guardarItem(ctx, pid, 'pieza', clave, { nombre: e.nombre, grupo: 'Piezas propias', datos: datos as unknown as Record<string, unknown> })
    // si salió de un marco propio, la capa pasa a ser una instancia
    let reemplazada: string | undefined
    if (origenMarco && e.desde?.capa && origenMarco.origen === 'propio') {
      const raiz = analizarHtml(origenMarco.html)
      const el = buscarPorId(raiz, e.desde.capa)!
      const inst = crearElemento('div', [
        ['data-id', e.desde.capa],
        ['data-pieza', clave],
        ['data-props', '{}'],
      ])
      const estilo = attr(el, 'style')
      if (estilo && /position\s*:\s*absolute/.test(estilo)) inst.attrs.push(['style', estilo])
      insertarAntes(el, inst)
      quitarNodo(el)
      await this.guardarMarco(ctx, pid, origenMarco, { ...origenMarco, html: serializarHtml(raiz) }, { resumen: `la capa ${e.desde.capa} pasó a ser una instancia de «${clave}»` })
      reemplazada = e.desde.capa
    }
    const hoja = await this.hojaDeVariantes(ctx, pid, clave, e.nombre, datos)
    await this.registrar(ctx, pid, 'diseno.pieza', `definió la pieza «${e.nombre}» (${propiedades.length} propiedades)`)
    return { clave, tipo: 'pieza', hoja, reemplazada }
  }

  /** La hoja de variantes de una pieza propia: un marco con todas las combinaciones (hasta 24), en la página "Piezas". */
  async hojaDeVariantes(ctx: Ctx, pid: string, clave: string, nombre: string, p: DatosPieza): Promise<Marco> {
    await this.pidPropio(pid)
    const variantes = p.propiedades.filter((x) => x.clase === 'variante' && x.valores?.length)
    const booleanos = p.propiedades.filter((x) => x.clase === 'booleano')
    let combos: Record<string, string | boolean>[] = [{}]
    for (const v of variantes) combos = combos.flatMap((c) => v.valores!.map((val) => ({ ...c, [v.nombre]: val })))
    for (const b of booleanos) if (combos.length * 2 <= 24) combos = combos.flatMap((c) => [{ ...c, [b.nombre]: true }, { ...c, [b.nombre]: false }])
    combos = combos.slice(0, 24)
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(combos.length))))
    // cada celda es un contenedor de ancho fijo: las piezas medidas en cqw se ven como en un marco de ese ancho
    const W = Math.min(1600, Math.max(120, Math.round(p.ancho ?? 540)))
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    const celdas = combos
      .map((c) => {
        const et = Object.entries(c).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'de fábrica'
        return `<div class="tv-celda" data-nombre="${esc(et)}"><div class="tv-et">${esc(et)}</div><div data-pieza="${esc(clave)}" data-props="${esc(JSON.stringify(c))}"></div></div>`
      })
      .join('')
    const html = `<div class="tv" data-nombre="Variantes de ${esc(nombre)}">${celdas}</div>`
    const css = `.tv{display:grid;grid-template-columns:repeat(${cols},${W}px);gap:48px;padding:40px;align-items:start}.tv-celda{container-type:inline-size;width:${W}px}.tv-et{font:500 18px/1.3 system-ui,sans-serif;color:#786e62;margin:0 0 12px}`
    const ancho = Math.min(8192, 80 + cols * W + (cols - 1) * 48)
    const filas = Math.ceil(combos.length / cols)
    const altoEstimado = Math.min(8192, 80 + filas * (Math.max(60, p.alto ?? 120) + 34) + (filas - 1) * 48)
    const r = await this.crearMarco(ctx, pid, { pagina: 'Piezas', nombre: `${nombre} · variantes`, ancho, alto: altoEstimado, html, css, hojas: p.hojas, clave: `hoja:${clave}`, seccion: 'Piezas propias', datos: { pieza: clave, fondo: '#ffffff', raizClase: p.raizClase } })
    // el alto se ajusta al contenido real (se mide dibujándolo con mucho lugar)
    try {
      const medido = await this.motor.render(this, pid, r.marco, await this.dibujable(pid, { ...r.marco, alto: 8000 }), { soloMedir: true })
      const idTv = /<div data-id="([a-z0-9]+)" class="tv"/.exec(r.marco.html)?.[1]
      const tv = idTv ? medido.cajas[idTv] : undefined
      if (tv) {
        const h = Math.min(8192, Math.max(120, tv[1] + tv[3]))
        if (Math.abs(h - r.marco.alto) > 4) await this.guardarMarco(ctx, pid, r.marco, { ...r.marco, alto: h }, { resumen: 'alto ajustado al contenido' })
      }
    } catch {
      // sin navegador queda con el alto estimado
    }
    return this.resolverMarco(pid, r.marco.id)
  }

  /** subir_activo: una imagen o una fuente. Pisa por nombre. */
  async subirActivo(
    ctx: Ctx,
    pid: string,
    e: { nombre: string; grupo?: string; bytes: Uint8Array; mime?: string; archivo?: string; familia?: string; pesos?: string; estilo?: 'normal' | 'italic' },
  ): Promise<{ tipo: 'activo' | 'fuente'; clave: string; ruta: string; ancho?: number; alto?: number; peso: number }> {
    await this.pidPropio(pid)
    if (e.bytes.byteLength > 4 * 1024 * 1024) throw new ErrorDominio('El archivo pesa más de 4 MB. Achicalo antes de subirlo.', 413)
    if (!e.bytes.byteLength) throw new ErrorDominio('El archivo está vacío.')
    const extArchivo = (e.archivo ?? e.nombre).split('?')[0]!.split('.').pop()?.toLowerCase() ?? ''
    let ext = (e.mime && extensionDeMime(e.mime)) || extArchivo
    const medidas = medidasDeImagen(e.bytes)
    if (medidas) ext = extensionDeMime(medidas.mime) ?? ext
    const esFuente = EXTENSIONES_FUENTE.includes(ext) || Boolean(e.familia)
    if (!esFuente && !EXTENSIONES_IMAGEN.includes(ext)) throw new ErrorDominio(`Solo se suben imágenes (png, jpg, webp, gif, svg, avif) o fuentes (woff2, woff, ttf, otf). Llegó «${e.mime || ext || 'sin tipo'}».`, 415)
    if (esFuente && !EXTENSIONES_FUENTE.includes(ext)) {
      const cabeza = String.fromCharCode(...e.bytes.slice(0, 4))
      ext = cabeza === 'wOF2' ? 'woff2' : cabeza === 'wOFF' ? 'woff' : cabeza === 'OTTO' ? 'otf' : 'ttf'
    }
    if (ext === 'svg') sanearSvg(new TextDecoder().decode(e.bytes))
    if (!esFuente && !medidas) throw new ErrorDominio('No pude leer la imagen (¿está entera?).', 400)
    const hash = sha12(e.bytes)
    const ruta = `diseno/${pid}/${hash}.${ext}`
    await this.almacen.guardar(ruta, e.bytes, mimeDeExtension(ext))
    const nombre = e.nombre.trim().replace(/\.[a-z0-9]{2,5}$/i, '') || hash
    const clave = esFuente ? slug(e.familia ?? nombre) + (e.estilo === 'italic' ? '-italica' : '') : slug(nombre)
    if (esFuente) {
      const familia = (e.familia ?? nombre).trim()
      await this.guardarItem(ctx, pid, 'fuente', clave, { nombre: familia, grupo: 'Fuentes', datos: { familia, ruta: `/archivos/${ruta}`, pesos: e.pesos ?? '400', estilo: e.estilo } })
      await this.registrar(ctx, pid, 'diseno.fuente', `subió la fuente «${familia}»`)
      return { tipo: 'fuente', clave, ruta: `/archivos/${ruta}`, peso: e.bytes.byteLength }
    }
    await this.guardarItem(ctx, pid, 'activo', clave, {
      nombre,
      grupo: e.grupo ?? 'Subidas',
      datos: { ruta: `/archivos/${ruta}`, mime: medidas!.mime, ancho: medidas!.ancho, alto: medidas!.alto, peso: e.bytes.byteLength },
    })
    await this.registrar(ctx, pid, 'diseno.activo', `subió la imagen «${nombre}» (${medidas!.ancho}×${medidas!.alto})`)
    return { tipo: 'activo', clave, ruta: `/archivos/${ruta}`, ancho: medidas!.ancho, alto: medidas!.alto, peso: e.bytes.byteLength }
  }

  /** Nombre del activo para cada ruta (para nombrar capas de imagen). */
  async activosPorRuta(pid: string): Promise<Map<string, string>> {
    await this.pidPropio(pid)
    const filas = await this.db.consulta(`select nombre, datos->>'ruta' as ruta from diseno_items where proyecto_id = $1 and tipo = 'activo'`, [pid])
    return new Map(filas.filter((f) => f.ruta).map((f) => [f.ruta as string, f.nombre as string]))
  }

  // ───────────────────────── notas, comentarios y vínculos ─────────────────────────

  async objetivoValido(pid: string, objetivo: string): Promise<{ objetivo: string; nombre: string; marco?: Marco }> {
    await this.pidPropio(pid)
    const [tipo, ...resto] = objetivo.split(':')
    const valor = resto.join(':')
    if (tipo === 'marco') {
      const [ref, capa] = valor.split('#')
      const m = await this.resolverMarco(pid, ref!)
      if (capa && !buscarPorId(analizarHtml(m.html), capa)) throw new ErrorDominio(`No existe la capa \`${capa}\` en «${m.nombre}». Capas: ${listaDeCapas(analizarHtml(m.html))}.`, 404)
      return { objetivo: `marco:${m.id}${capa ? '#' + capa : ''}`, nombre: capa ? `«${m.nombre}» › ${capa}` : `«${m.nombre}»`, marco: m }
    }
    if (tipo === 'pagina') {
      const pg = await this.resolverPagina(pid, valor)
      return { objetivo: `pagina:${pg.id}`, nombre: `la página «${pg.nombre}»` }
    }
    if (tipo === 'item') {
      const [t, ...c] = valor.split(':')
      const it = await this.item(pid, t as TipoItem, c.join(':'))
      return { objetivo: `item:${it.tipo}:${it.clave}`, nombre: `«${it.nombre}»` }
    }
    // sin prefijo: un marco por id o nombre
    const m = await this.resolverMarco(pid, objetivo.split('#')[0]!)
    const capa = objetivo.split('#')[1]
    return this.objetivoValido(pid, `marco:${m.id}${capa ? '#' + capa : ''}`)
  }

  async guardarNota(ctx: Ctx, pid: string, objetivo: string, c: { nombrePropio?: string | null; uso?: string | null; nota?: string | null; estado?: NotaDiseno['estado'] }): Promise<NotaDiseno> {
    await this.pidPropio(pid)
    const o = await this.objetivoValido(pid, objetivo)
    await this.db.consulta(
      `insert into diseno_notas (proyecto_id, objetivo, nombre_propio, uso, nota, estado, actualizado_por, actualizado_en) values ($1,$2,$3,$4,$5,$6,$7::jsonb,now())
       on conflict (proyecto_id, objetivo) do update set
         nombre_propio = case when $8 then excluded.nombre_propio else diseno_notas.nombre_propio end,
         uso = case when $9 then excluded.uso else diseno_notas.uso end,
         nota = case when $10 then excluded.nota else diseno_notas.nota end,
         estado = case when $11 then excluded.estado else diseno_notas.estado end,
         actualizado_por = excluded.actualizado_por, actualizado_en = now()`,
      [pid, o.objetivo, c.nombrePropio ?? null, c.uso ?? null, c.nota ?? null, c.estado ?? null, j(ctx.actor), c.nombrePropio !== undefined, c.uso !== undefined, c.nota !== undefined, c.estado !== undefined],
    )
    const [f] = await this.db.consulta(`select * from diseno_notas where proyecto_id = $1 and objetivo = $2`, [pid, o.objetivo])
    this.publicar(ctx, pid, { accion: 'nota', marcos: o.marco ? [o.marco.id] : undefined })
    if (ctx.actor.tipo !== 'humano') await this.registrar(ctx, pid, 'diseno.nota', `anotó ${o.nombre} en Diseño`)
    return aNota(f!)
  }

  async notas(pid: string, objetivos?: string[]): Promise<NotaDiseno[]> {
    await this.pidPropio(pid)
    const filas = objetivos?.length
      ? await this.db.consulta(`select * from diseno_notas where proyecto_id = $1 and objetivo = any($2::text[])`, [pid, objetivos])
      : await this.db.consulta(`select * from diseno_notas where proyecto_id = $1`, [pid])
    return filas.map(aNota)
  }

  async comentarios(pid: string, f: { objetivo?: string; abiertos?: boolean } = {}): Promise<ComentarioDiseno[]> {
    await this.pidPropio(pid)
    const cond = ['proyecto_id = $1']
    const params: unknown[] = [pid]
    if (f.objetivo) {
      const o = await this.objetivoValido(pid, f.objetivo)
      params.push(o.objetivo, `${o.objetivo}#%`)
      cond.push(`(objetivo = $2 or objetivo like $3)`)
    }
    const filas = await this.db.consulta(`select * from diseno_comentarios where ${cond.join(' and ')} order by creado_en`, params)
    let r = filas.map(aComentario)
    if (f.abiertos) {
      const abiertos = new Set(r.filter((c) => !c.respuestaA && !c.resuelto).map((c) => c.id))
      r = r.filter((c) => abiertos.has(c.respuestaA ?? c.id))
    }
    return r
  }

  async comentar(ctx: Ctx, pid: string, e: { en?: string; texto: string; punto?: { x: number; y: number }; respondeA?: string }): Promise<ComentarioDiseno> {
    await this.pidPropio(pid)
    if (!e.texto.trim()) throw new ErrorDominio('El comentario está vacío.')
    let objetivo: string
    let nombre: string
    let marcoId: string | undefined
    if (e.respondeA) {
      const [padre] = await this.db.consulta(`select * from diseno_comentarios where id = $1 and proyecto_id = $2`, [e.respondeA, pid])
      if (!padre) throw new ErrorDominio(`No existe el comentario ${e.respondeA}.`, 404)
      objetivo = padre.objetivo
      nombre = 'un comentario'
      marcoId = objetivo.startsWith('marco:') ? objetivo.slice(6).split('#')[0] : undefined
    } else {
      if (!e.en) throw new ErrorDominio('Decí dónde va el comentario: en (un marco, "marco#capa" o "item:token:--x").')
      const o = await this.objetivoValido(pid, e.en)
      objetivo = o.objetivo
      nombre = o.nombre
      marcoId = o.marco?.id
    }
    const id = `c_${nuevoId().slice(0, 10)}`
    await this.db.consulta(
      `insert into diseno_comentarios (id, proyecto_id, objetivo, x, y, texto, respuesta_a, autor) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [id, pid, objetivo, e.punto?.x ?? null, e.punto?.y ?? null, e.texto.trim(), e.respondeA ?? null, j(ctx.actor)],
    )
    await this.registrar(ctx, pid, 'diseno.comentario', `comentó en ${nombre}: «${e.texto.trim().slice(0, 80)}»`, { comentario: id })
    this.publicar(ctx, pid, { accion: 'comentario', marcos: marcoId ? [marcoId] : undefined })
    const [f] = await this.db.consulta(`select * from diseno_comentarios where id = $1`, [id])
    return aComentario(f!)
  }

  async actualizarComentario(ctx: Ctx, pid: string, id: string, c: { resuelto?: boolean; texto?: string }) {
    await this.pidPropio(pid)
    const [f] = await this.db.consulta(`select * from diseno_comentarios where id = $1 and proyecto_id = $2`, [id, pid])
    if (!f) throw new ErrorDominio(`No existe el comentario ${id}.`, 404)
    await this.db.consulta(`update diseno_comentarios set resuelto = coalesce($2, resuelto), texto = coalesce($3, texto) where id = $1`, [id, c.resuelto ?? null, c.texto?.trim() || null])
    if (c.resuelto) await this.registrar(ctx, pid, 'diseno.comentario.resuelto', `resolvió un comentario en Diseño`)
    const marcoId = String(f.objetivo).startsWith('marco:') ? String(f.objetivo).slice(6).split('#')[0] : undefined
    this.publicar(ctx, pid, { accion: 'comentario', marcos: marcoId ? [marcoId] : undefined })
    const [g] = await this.db.consulta(`select * from diseno_comentarios where id = $1`, [id])
    return aComentario(g!)
  }

  async vincular(ctx: Ctx, pid: string, objetivo: string, tarjetaRef: string, op: { quitar?: boolean; silencioso?: boolean } = {}) {
    await this.pidPropio(pid)
    const o = await this.objetivoValido(pid, objetivo)
    const t = await this.s.resolverTarjeta(tarjetaRef)
    if (op.quitar) await this.db.consulta(`delete from diseno_vinculos where objetivo = $1 and tarjeta_id = $2`, [o.objetivo, t.id])
    else await this.db.consulta(`insert into diseno_vinculos (proyecto_id, objetivo, tarjeta_id) values ($1,$2,$3) on conflict do nothing`, [pid, o.objetivo, t.id])
    if (!op.silencioso) await this.registrar(ctx, pid, op.quitar ? 'diseno.desvinculado' : 'diseno.vinculado', `${op.quitar ? 'desvinculó' : 'vinculó'} ${o.nombre} ${op.quitar ? 'de' : 'con'} ${t.clave}`)
    this.publicar(ctx, pid, { accion: 'vinculo', marcos: o.marco ? [o.marco.id] : undefined })
    // la tarjeta se redibuja (su sección "Diseños")
    this.bus.publicar({ tipo: 'tarjeta.detalle', accion: 'disenos', proyectoId: t.proyecto_id, tableroId: t.tablero_id, tarjetaId: t.id, actor: ctx.actor, clienteId: ctx.clienteId ?? null })
    return { objetivo: o.objetivo, tarjeta: t.clave as string }
  }

  async vinculosDe(pid: string, objetivo: string) {
    await this.pidPropio(pid)
    const filas = await this.db.consulta(
      `select t.clave, t.titulo, t.tipo, l.nombre as lista, l.categoria from diseno_vinculos v join tarjetas t on t.id = v.tarjeta_id
         left join listas l on l.id = t.lista_id where v.proyecto_id = $1 and v.objetivo = $2 order by t.numero`,
      [pid, objetivo],
    )
    return filas.map((f) => ({ clave: f.clave as string, titulo: f.titulo as string, tipo: f.tipo as string, lista: (f.lista as string) ?? null, categoria: (f.categoria as string) ?? null }))
  }

  /** Los diseños vinculados a una tarjeta (sección "Diseños" del detalle). */
  async disenosDeTarjeta(ref: string) {
    const t = await this.s.resolverTarjeta(ref)
    const filas = await this.db.consulta(
      `select v.objetivo, m.id, m.nombre, m.ancho, m.alto, m.revision, m.proyecto_id, p.slug as pagina, p.nombre as pagina_nombre, m.miniatura
         from diseno_vinculos v
         left join diseno_marcos m on v.objetivo = 'marco:' || m.id and m.archivado_en is null
         left join diseno_paginas p on p.id = m.pagina_id
        where v.tarjeta_id = $1 order by m.y, m.x`,
      [t.id],
    )
    const [pr] = await this.db.consulta(`select prefijo from proyectos where id = $1`, [t.proyecto_id])
    return filas
      .filter((f) => f.id)
      .map((f) => ({
        id: f.id as string,
        nombre: f.nombre as string,
        ancho: Number(f.ancho),
        alto: Number(f.alto),
        revision: Number(f.revision),
        pagina: f.pagina as string,
        paginaNombre: f.pagina_nombre as string,
        miniatura: `/api/diseno/${pr?.prefijo ?? f.proyecto_id}/marcos/${f.id}/miniatura?r=${f.revision}`,
        prefijo: pr?.prefijo as string,
      }))
  }

  // ───────────────────────── búsqueda ─────────────────────────

  async buscar(pid: string, q: string, o: { en?: 'marcos' | 'capas' | 'tokens' | 'activos' | 'piezas' | 'textos'; limite?: number } = {}) {
    await this.pidPropio(pid)
    const consulta = q.trim()
    if (!consulta) return []
    const limite = Math.min(o.limite ?? 40, 100)
    const n = normalizar(consulta)
    const color = normalizarColor(consulta)
    const r: { tipo: string; id: string; nombre: string; detalle: string; pagina?: string; marco?: string; capa?: string; itemTipo?: TipoItem; puntaje: number }[] = []
    if (!o.en || o.en === 'marcos' || o.en === 'capas') {
      const marcos = await this.db.consulta(
        `select m.id, m.nombre, m.html, m.ancho, m.alto, p.slug as pagina, p.nombre as pagina_nombre from diseno_marcos m join diseno_paginas p on p.id = m.pagina_id
          where m.proyecto_id = $1 and m.archivado_en is null and not p.archivada`,
        [pid],
      )
      for (const m of marcos) {
        if ((!o.en || o.en === 'marcos') && normalizar(m.nombre).includes(n))
          r.push({ tipo: 'marco', id: m.id, nombre: m.nombre, detalle: `${m.ancho}×${m.alto} · ${m.pagina_nombre}`, pagina: m.pagina, marco: m.id, puntaje: normalizar(m.nombre) === n ? 100 : 50 })
        if (!o.en || o.en === 'capas') {
          if (!normalizar(m.html).includes(n) && !(color && m.html.toLowerCase().includes(color))) continue
          const raiz = analizarHtml(m.html)
          let enEste = 0
          recorrer(raiz, (el) => {
            const id = attr(el, 'data-id')
            if (!id || enEste >= 6) return
            const nombre = attr(el, 'data-nombre') ?? ''
            const propio = el.hijos.filter((h) => h.tipo === 'tx').map((h) => (h as { texto: string }).texto).join('').trim()
            if ((nombre && normalizar(nombre).includes(n)) || (propio && normalizar(propio).includes(n)) || (color && (attr(el, 'style') ?? '').toLowerCase().includes(color))) {
              enEste++
              r.push({ tipo: 'capa', id: `${m.id}.${id}`, nombre: nombre || `"${(propio || textoDe(el)).slice(0, 40)}"`, detalle: `en «${m.nombre}» · ${m.pagina_nombre}`, pagina: m.pagina, marco: m.id, capa: id, puntaje: 30 })
            }
          })
        }
      }
    }
    const tipos: TipoItem[] = !o.en ? ['token', 'estilo_texto', 'color_suelto', 'activo', 'fuente', 'pieza', 'plantilla', 'texto'] : o.en === 'tokens' ? ['token', 'estilo_texto', 'color_suelto'] : o.en === 'activos' ? ['activo', 'fuente'] : o.en === 'piezas' ? ['pieza', 'plantilla'] : o.en === 'textos' ? ['texto'] : []
    if (tipos.length) {
      const like = `%${n.replace(/[%_\\]/g, (c) => '\\' + c)}%`
      const filas = await this.db.consulta(
        `select tipo, clave, nombre, grupo, datos->>'valor' as valor, datos->>'css' as css from diseno_items
          where proyecto_id = $1 and not archivado and tipo = any($2::text[])
            and (lower(clave) like $3 or lower(nombre) like $3 or lower(coalesce(datos->>'valor','')) like $3 ${color ? `or lower(coalesce(datos->>'valor','')) = $4` : ''})
          limit 400`,
        color ? [pid, tipos, like, color] : [pid, tipos, like],
      )
      for (const f of filas) {
        const valor = (f.valor as string | null) ?? ''
        const exacto = normalizar(f.clave) === n || normalizar(f.nombre) === n || (color && normalizarColor(valor) === color)
        r.push({
          tipo: f.tipo,
          id: `${f.tipo}:${f.clave}`,
          nombre: f.nombre,
          detalle: [f.css && f.css !== f.clave ? f.css : '', valor.slice(0, 60), f.grupo].filter(Boolean).join(' · '),
          itemTipo: f.tipo,
          puntaje: exacto ? 90 : 20,
        })
      }
    }
    return r.sort((a, b) => b.puntaje - a.puntaje).slice(0, limite)
  }

  // ───────────────────────── configuración de la sincronización ─────────────────────────

  async guardarConfig(ctx: Ctx, pid: string, c: { perfil?: unknown; pedir?: boolean; hecho?: boolean }) {
    await this.pidPropio(pid)
    await this.asegurar(pid)
    if (c.perfil !== undefined) {
      const r = esquemaPerfil.safeParse(c.perfil)
      if (!r.success) throw new ErrorDominio(`El perfil no es válido: ${r.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || 'perfil'}: ${i.message}`).join('; ')}.`)
      await this.db.consulta(`update diseno_config set perfil = $2::jsonb where proyecto_id = $1`, [pid, j(r.data)])
      await this.registrar(ctx, pid, 'diseno.perfil', `guardó el perfil de importación de Diseño (${r.data.pantallas.length} pantallas)`)
    }
    if (c.pedir) {
      await this.db.consulta(`update diseno_config set pedido_en = now() where proyecto_id = $1`, [pid])
      await this.registrar(ctx, pid, 'diseno.sincronizacion.pedida', 'pidió sincronizar el diseño con el código')
    }
    if (c.hecho) await this.db.consulta(`update diseno_config set pedido_en = null where proyecto_id = $1`, [pid])
    this.publicar(ctx, pid, { accion: 'config' })
    return this.config(pid)
  }

  async importaciones(pid: string): Promise<ImportacionDiseno[]> {
    await this.pidPropio(pid)
    const filas = await this.db.consulta(`select * from diseno_importaciones where proyecto_id = $1 order by n desc limit 30`, [pid])
    return filas.map(aImportacion)
  }

  /** Para la web: el detalle de una instancia (las propiedades completadas con las de fábrica). */
  async propiedadesDeInstancia(pid: string, marco: Marco, capa: string) {
    await this.pidPropio(pid)
    const el = buscarPorId(analizarHtml(marco.html), capa)
    if (!el) throw new ErrorDominio('No existe esa capa.', 404)
    const clave = attr(el, 'data-pieza')
    if (!clave) return null
    const piezas = await this.piezasDe(pid, `<div data-pieza="${clave}"></div>`)
    return { pieza: clave, propiedades: propiedadesDe(el, piezas[clave]) }
  }

  /** Lo que se exporta: cada marco con su nombre de archivo. */
  nombreDeExporte(pagina: string, m: { nombre: string; ancho: number; alto: number }, escala: number, formato: string) {
    const base = slug(`${pagina}-${m.nombre}`).slice(0, 60)
    return `${base}-${m.ancho}x${m.alto}${escala !== 1 ? `@${escala}x` : ''}.${formato === 'jpg' ? 'jpg' : formato}`
  }

  /** Para el armado de respuestas: quita los data-id (el HTML "limpio" de un marco para el código exportado). */
  htmlSinIds(html: string) {
    const raiz = analizarHtml(html)
    recorrer(raiz, (el) => {
      quitarAttr(el, 'data-id')
    })
    return serializarHtml(raiz)
  }
}
