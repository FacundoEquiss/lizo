// ServicioIA: todo el SQL de las tablas de la IA integrada (hoy, la F1: menciones y notificaciones). Se obtiene siempre con
// `iaDe(servicio)` sobre el Servicio DE UNA CUENTA (como `disenoDe`): `this.s.cuenta` falla en el Servicio de la raíz, y toda
// consulta lleva `propietario = cuenta`. Un id ajeno da 404 con el mismo mensaje que uno que no existe (docs/cuentas.md).
// Plan: docs/plan-ia-integrada.md, secciones 5 (menciones), 8 (notificaciones) y Anexo A.3.
import type {
  Agente,
  AjustesIA,
  ClaveIA,
  EntradaAgente,
  EntradaClave,
  EstadoIA,
  Mencion,
  NuevoPedido,
  Notificacion,
  OrigenMencion,
  PreferenciasNotificaciones,
  ResultadoDisparo,
  TipoNotificacion,
  TrabajoDetalle,
  TrabajoResumen,
  UsoIA,
} from '../../../compartido/ia'
import type { Actor, Miembro, TarjetaResumen } from '../../../compartido/tipos'
import { recortar } from '../../../compartido/texto'
import type { Conexion } from '../datos/conexion'
import type { ResultadoMenciones, TextoGuardado } from '../dominio/ganchos'
import { ErrorDominio, nuevoId, type Ctx, type Servicio } from '../dominio/servicio'
import * as agentes from './agentes'
import { aMencion, enlacesDe, levantarMencionesViejas, mencionesEsperando, procesarTextos, reintentarMencion, type InformeLevantado } from './menciones'
import { resumenDiario, revisarTarjetaNueva } from './proactivo'
import { trabajosDe } from './trabajos'

type Fila = Record<string, any>

export const TIPOS_NOTIFICACION: readonly TipoNotificacion[] = ['mencion', 'respuesta', 'confirmacion', 'tope', 'error_ia', 'asignacion', 'aviso']
const SISTEMA: Actor = { tipo: 'sistema', id: 'sistema', nombre: 'Telar' }
/** De a cuántas notificaciones se carga la bandeja. */
const PAGINA = 30

export interface NuevaNotificacion {
  paraId: string
  tipo: TipoNotificacion
  titulo: string
  cuerpo?: string
  actor?: Actor | null
  enlace?: string | null
  tarjetaId?: string | null
  trabajoId?: string | null
  mencionId?: string | null
  claveUnica?: string
}

/** Lo que hace falta de un miembro para resolver menciones. */
export interface MiembroParaMencion {
  id: string
  nombre: string
  alias: string
  tipo: 'humano' | 'ia'
  archivado: boolean
  esYo: boolean
}

const PREFERENCIAS_DE_FABRICA = (): PreferenciasNotificaciones => ({
  push: Object.fromEntries(TIPOS_NOTIFICACION.map((t) => [t, t !== 'asignacion'])) as Record<TipoNotificacion, boolean>,
  correo: Object.fromEntries(TIPOS_NOTIFICACION.map((t) => [t, false])) as Record<TipoNotificacion, boolean>,
  silencio: null,
})

function aNotificacion(f: Fila): Notificacion {
  return {
    id: f.id,
    paraId: f.para_id,
    tipo: f.tipo,
    titulo: f.titulo,
    cuerpo: f.cuerpo ?? '',
    actor: (f.actor as Actor | null) ?? null,
    enlace: f.enlace ?? null,
    trabajoId: f.trabajo_id ?? null,
    mencionId: f.mencion_id ?? null,
    leidaEn: f.leida_en ? new Date(f.leida_en).toISOString() : null,
    creadoEn: new Date(f.creado_en).toISOString(),
  }
}

/** Un ServicioIA por Servicio (se crea al primer uso; no hace falta tocar el Servicio). */
const porServicio = new WeakMap<Servicio, ServicioIA>()
export function iaDe(s: Servicio): ServicioIA {
  let ia = porServicio.get(s)
  if (!ia) {
    ia = new ServicioIA(s)
    porServicio.set(s, ia)
  }
  return ia
}

export class ServicioIA {
  readonly db: Conexion

  constructor(readonly s: Servicio) {
    this.db = s.db
  }

  /** El Servicio de la cuenta (para crear miembros y leer de las tablas de siempre). */
  get servicio(): Servicio {
    return this.s
  }

  /** La cuenta de este servicio: sin cuenta (el Servicio de la raíz) tira. */
  get cuenta(): string {
    return this.s.cuenta
  }

  // ───────────────────────── miembros y alias ─────────────────────────

  /** Les completa el alias a los miembros que no lo tienen (los de antes de la migración). Devuelve cuántos completó. */
  async asegurarAlias(): Promise<number> {
    const sin = await this.db.consulta<{ id: string; nombre: string }>(
      `select id, nombre from miembros where propietario = $1 and alias is null order by creado_en, id`,
      [this.cuenta],
    )
    let n = 0
    for (const m of sin) {
      // Si dos procesos completan a la vez, el índice único frena a uno: se prueba con el siguiente alias libre.
      for (let intento = 0; intento < 3; intento++) {
        try {
          await this.db.consulta(`update miembros set alias = $2 where id = $1 and alias is null`, [m.id, await this.s.aliasLibre(m.nombre)])
          n++
          break
        } catch (e) {
          if (intento === 2) throw e
        }
      }
    }
    return n
  }

  /** Los miembros de la cuenta con su alias (completándolo si falta), para resolver menciones. */
  async mencionables(): Promise<MiembroParaMencion[]> {
    let filas = await this.db.consulta<Fila>(`select * from miembros where propietario = $1`, [this.cuenta])
    if (filas.some((f) => !f.alias)) {
      await this.asegurarAlias()
      filas = await this.db.consulta<Fila>(`select * from miembros where propietario = $1`, [this.cuenta])
    }
    return filas.map((f) => ({ id: f.id, nombre: f.nombre, alias: f.alias ?? '', tipo: f.tipo, archivado: Boolean(f.archivado), esYo: Boolean(f.es_yo) }))
  }

  /** Un aviso de Telar (algo que hizo por su cuenta, como archivar lo viejo de Hecho) para la persona de la cuenta. Una sola vez por `claveUnica`. */
  async avisarAlYo(a: { titulo: string; cuerpo: string; enlace: string | null; claveUnica: string }): Promise<Notificacion | null> {
    const yo = await this.yoId()
    if (!yo) return null
    return this.notificar({ paraId: yo, tipo: 'aviso', titulo: a.titulo, cuerpo: a.cuerpo, actor: SISTEMA, enlace: a.enlace, claveUnica: a.claveUnica })
  }

  /** El miembro «yo» de la cuenta (a quien le llegan las notificaciones), o null si todavía no tiene. */
  private async yoId(): Promise<string | null> {
    const [f] = await this.db.consulta<{ id: string }>(`select id from miembros where propietario = $1 and es_yo order by creado_en, id limit 1`, [this.cuenta])
    return f?.id ?? null
  }

  /** El autor (id de miembro) de un comentario de esta cuenta, para «responder es mencionar». */
  async autorDeComentario(comentarioId: string): Promise<string | null> {
    const [f] = await this.db.consulta<{ autor: Actor }>(
      `select c.autor from comentarios c join tarjetas t on t.id = c.tarjeta_id join proyectos p on p.id = t.proyecto_id
        where c.id = $1 and p.propietario = $2`,
      [comentarioId, this.cuenta],
    )
    return f?.autor?.id ?? null
  }

  // ───────────────────────── menciones ─────────────────────────

  /** El gancho `textoGuardado` (ver menciones.ts). */
  procesarTextos(ctx: Ctx, textos: TextoGuardado[]): Promise<ResultadoMenciones> {
    return procesarTextos(this, ctx, textos)
  }

  /**
   * El gancho `textoBorrado`: las menciones pendientes de esos orígenes se retiran. Un comentario borrado deja de estar en el
   * texto; una nota que sale del lienzo conserva `en_texto` (si vuelve, la regla de la cantidad la restaura).
   */
  async retirarOrigenes(_ctx: Ctx, origenes: { tipo: OrigenMencion; id: string }[]): Promise<void> {
    for (const tipo of new Set(origenes.map((o) => o.tipo))) {
      const ids = origenes.filter((o) => o.tipo === tipo).map((o) => o.id)
      const retiradas = await this.db.consulta<{ id: string }>(
        `update menciones set estado = case when estado = 'pendiente' then 'retirada' else estado end,
                              en_texto = case when $3::boolean then false else en_texto end
          where propietario = $1 and origen_tipo = $2 and origen_id = any($4::text[]) and (estado = 'pendiente' or $3::boolean) returning id`,
        [this.cuenta, tipo, tipo === 'comentario', ids],
      )
      // El trabajo que esas menciones iban a atender (o la conversación sin @ de un comentario borrado) se cancela (5.7).
      await trabajosDe(this).cancelarPorOrigen(retiradas.map((r) => r.id), tipo === 'comentario' ? ids.map((id) => `conv:${id}`) : [])
    }
  }

  /** Las filas de menciones de esos orígenes (de esta cuenta). */
  async filasDeOrigenes(origenes: { tipo: OrigenMencion; id: string }[], op: { soloEnTexto?: boolean } = {}): Promise<Fila[]> {
    const salida: Fila[] = []
    for (const tipo of new Set(origenes.map((o) => o.tipo))) {
      const filas = await this.db.consulta<Fila>(
        `select * from menciones where propietario = $1 and origen_tipo = $2 and origen_id = any($3::text[]) ${op.soloEnTexto ? 'and en_texto' : ''}
          order by creado_en, ocurrencia`,
        [this.cuenta, tipo, origenes.filter((o) => o.tipo === tipo).map((o) => o.id)],
      )
      salida.push(...filas)
    }
    return salida
  }

  /** Crea una mención. Null si ya existía (el índice único: dos guardados a la vez no crean dos). */
  async insertarMencion(m: {
    origen: { tipo: OrigenMencion; id: string }
    ocurrencia: number
    destinatarioId: string
    autor: Actor
    extracto: string
    proyectoId: string | null
    tableroId: string | null
    tarjetaId: string | null
    tarjetaClave: string | null
    estado: 'pendiente' | 'atendida'
    nota: string | null
    atendidaEn?: string | null
    atendidaPor?: Actor | null
    creadoEn?: string
  }): Promise<Fila | null> {
    const atendida = m.estado === 'atendida'
    const [f] = await this.db.consulta<Fila>(
      `insert into menciones (id, propietario, origen_tipo, origen_id, ocurrencia, destinatario_id, autor, extracto, proyecto_id,
          tablero_id, tarjeta_id, tarjeta_clave, estado, atendida_en, atendida_por, nota, creado_en)
       select $1::text, $2::text, $3::text, $4::text, $5::int, mi.id, $7::jsonb, $8::text, $9::text, $10::text, $11::text, $12::text, $13::text,
              $14::timestamptz, $15::jsonb, $16::text, coalesce($17::timestamptz, now())
         from miembros mi where mi.id = $6::text and mi.propietario = $2::text
       on conflict do nothing returning *`,
      [
        `m_${nuevoId()}`,
        this.cuenta,
        m.origen.tipo,
        m.origen.id,
        m.ocurrencia,
        m.destinatarioId,
        m.autor,
        m.extracto,
        m.proyectoId,
        m.tableroId,
        m.tarjetaId,
        m.tarjetaClave,
        m.estado,
        atendida ? (m.atendidaEn ?? new Date().toISOString()) : null,
        atendida ? (m.atendidaPor ?? null) : null,
        m.nota,
        m.creadoEn ?? null,
      ],
    )
    return f ?? null
  }

  /** Las que habían quedado retiradas (la nota se sacó del lienzo) y vuelven a esperar. */
  async reponerMenciones(ids: string[]): Promise<void> {
    await this.db.consulta(`update menciones set estado = 'pendiente' where propietario = $1 and id = any($2::text[]) and estado = 'retirada'`, [this.cuenta, ids])
  }

  /** Las que ya no están escritas en el texto: dejan de contar, y las que esperaban se retiran. */
  async quitarDelTexto(ids: string[]): Promise<void> {
    await this.db.consulta(
      `update menciones set en_texto = false, estado = case when estado = 'pendiente' then 'retirada' else estado end
        where propietario = $1 and id = any($2::text[])`,
      [this.cuenta, ids],
    )
    await trabajosDe(this).cancelarPorOrigen(ids)
  }

  /**
   * Una IA comentó en una tarjeta: lo que le habían pedido ahí (menciones pendientes a ella en esa tarjeta) queda atendido, y a
   * quien se lo pidió (una persona) le llega la notificación «respondió».
   */
  async atenderPorComentario(ctx: Ctx, t: TextoGuardado): Promise<void> {
    const atendidas = await this.db.consulta<Fila>(
      `update menciones set estado = 'atendida', atendida_en = now(), atendida_por = $4
        where propietario = $1 and destinatario_id = $2 and tarjeta_id = $3 and estado = 'pendiente' returning *`,
      [this.cuenta, ctx.actor.id, t.tarjetaId, ctx.actor],
    )
    const avisados = new Set<string>()
    for (const m of atendidas) {
      const autor = m.autor as Actor
      if (autor.tipo !== 'humano' || autor.id === ctx.actor.id || avisados.has(autor.id)) continue
      avisados.add(autor.id)
      await this.notificar({
        paraId: autor.id,
        tipo: 'respuesta',
        titulo: `${ctx.actor.nombre} respondió en ${m.tarjeta_clave ?? t.tarjetaClave ?? 'una tarjeta'}`,
        cuerpo: recortar(t.texto.replace(/\s+/g, ' ').trim(), 140),
        actor: ctx.actor,
        enlace: (await enlacesDe(this, [m]))[0]!,
        tarjetaId: t.tarjetaId,
        mencionId: m.id,
        claveUnica: `respuesta:c:${t.origen.id}:${autor.id}`,
      })
    }
  }

  /**
   * Lo que le espera a un miembro (una IA que se conecta): sus menciones sin atender y las tarjetas que tiene asignadas y no están
   * en Hecho. `f.proyecto` es un id de proyecto (la herramienta MCP resuelve el prefijo o el nombre).
   */
  async pendientesDe(
    miembroId: string,
    f: { proyecto?: string; limite?: number } = {},
  ): Promise<{ menciones: (Mencion & { tarjetaTitulo: string | null; tableroNombre: string | null })[]; asignadas: TarjetaResumen[] }> {
    await this.s.propio('miembro', miembroId)
    await this.levantarSiHaceFalta()
    const limite = Math.max(1, Math.min(f.limite ?? 20, 50))
    const filas = await this.db.consulta<Fila>(
      `select m.*, t.titulo as tarjeta_titulo, tb.nombre as tablero_nombre
         from menciones m
         left join tarjetas t on t.id = m.tarjeta_id
         left join tableros tb on tb.id = m.tablero_id
        where m.propietario = $1 and m.destinatario_id = $2 and m.estado = 'pendiente' ${f.proyecto ? 'and m.proyecto_id = $4' : ''}
          and m.ocurrencia = (select min(m2.ocurrencia) from menciones m2 where m2.origen_tipo = m.origen_tipo and m2.origen_id = m.origen_id
                                 and m2.destinatario_id = m.destinatario_id and m2.estado = 'pendiente')
        order by m.creado_en desc, m.id limit $3`,
      f.proyecto ? [this.cuenta, miembroId, limite, f.proyecto] : [this.cuenta, miembroId, limite],
    )
    const enlaces = await enlacesDe(this, filas)
    const asignadas = await this.s.resumenes(
      `t.id in (select tarjeta_id from tarjeta_responsables where miembro_id = $1) and not t.archivada and t.completada_en is null
         and coalesce((select l.categoria from listas l where l.id = t.lista_id), '') <> 'hecho' ${f.proyecto ? 'and t.proyecto_id = $2' : ''}`,
      f.proyecto ? [miembroId, f.proyecto] : [miembroId],
    )
    return {
      menciones: filas.map((fila, i) => ({ ...aMencion(fila, enlaces[i]!), tarjetaTitulo: fila.tarjeta_titulo ?? null, tableroNombre: fila.tablero_nombre ?? null })),
      asignadas: asignadas.slice(0, 50),
    }
  }

  /**
   * Marca como atendida una mención a quien llama (`ctx.actor`) sin que haga falta un comentario. Idempotente: atenderla otra vez no
   * cambia nada ni avisa de nuevo. Una mención de otra cuenta o dirigida a otro miembro da 404.
   */
  async atender(ctx: Ctx, mencionId: string, nota?: string): Promise<Mencion> {
    const [f] = await this.db.consulta<Fila>(`select * from menciones where id = $1 and propietario = $2 and destinatario_id = $3`, [mencionId, this.cuenta, ctx.actor.id])
    if (!f) throw new ErrorDominio('No existe esa mención.', 404)
    let fila = f
    if (f.estado === 'pendiente') {
      // Dos «@claude» en el mismo texto son dos filas pero una sola cosa para atender: se atienden juntas.
      const juntas = await this.db.consulta<Fila>(
        `update menciones set estado = 'atendida', atendida_en = now(), atendida_por = $2, nota = $3
          where propietario = $1 and origen_tipo = $4 and origen_id = $5 and destinatario_id = $6 and estado = 'pendiente' returning *`,
        [this.cuenta, ctx.actor, nota?.trim() || null, f.origen_tipo, f.origen_id, f.destinatario_id],
      )
      const u = juntas.find((x) => x.id === mencionId) ?? juntas[0]
      if (u) {
        fila = juntas.find((x) => x.id === mencionId) ?? u
        const autor = u.autor as Actor
        if (autor.tipo === 'humano' && autor.id !== ctx.actor.id)
          await this.notificar({
            paraId: autor.id,
            tipo: 'respuesta',
            titulo: `${ctx.actor.nombre} atendió tu mención en ${u.tarjeta_clave ?? 'Telar'}`,
            cuerpo: nota?.trim() ? recortar(nota.trim(), 140) : '',
            actor: ctx.actor,
            enlace: (await enlacesDe(this, [u]))[0]!,
            tarjetaId: u.tarjeta_id,
            mencionId: u.id,
            claveUnica: `respuesta:m:${u.id}`,
          })
      } else {
        // Otra llamada se adelantó: se devuelve cómo quedó.
        const [r] = await this.db.consulta<Fila>(`select * from menciones where id = $1`, [mencionId])
        fila = r ?? f
      }
    }
    return aMencion(fila, (await enlacesDe(this, [fila]))[0]!)
  }

  // ───────────────────────── las de antes ─────────────────────────

  /**
   * Levanta las menciones que ya estaban escritas en los comentarios antes de que existiera esta función. Idempotente (la regla de
   * la cantidad: correrlo dos veces no duplica). Deja la marca de la cuenta y, si hay pendientes, un único aviso.
   */
  async levantarMencionesViejas(): Promise<InformeLevantado> {
    await this.db.consulta(`update cuentas set menciones_levantadas_en = now() where id = $1`, [this.cuenta])
    const informe = await levantarMencionesViejas(this)
    const yo = await this.yoId()
    if (yo && informe.pendientes > 0)
      await this.notificar({
        paraId: yo,
        tipo: 'mencion',
        titulo: `Encontré ${informe.pendientes} ${informe.pendientes === 1 ? 'mención pendiente' : 'menciones pendientes'} de antes`,
        cuerpo: 'Eran comentarios con @ escritos antes de que Telar los guardara. Las IA que se conecten las ven en leer_pendientes.',
        actor: SISTEMA,
        claveUnica: 'viejas',
      })
    return informe
  }

  /** La primera vez que la cuenta pide novedades o pendientes: levanta lo de antes (una sola vez; la marca está en la cuenta). */
  async levantarSiHaceFalta(): Promise<void> {
    const [f] = await this.db.consulta(`update cuentas set menciones_levantadas_en = now() where id = $1 and menciones_levantadas_en is null returning id`, [this.cuenta])
    if (!f) return
    try {
      await this.levantarMencionesViejas()
    } catch (e) {
      // Si falló, se vuelve a intentar en la próxima: la marca se saca.
      await this.db.consulta(`update cuentas set menciones_levantadas_en = null where id = $1`, [this.cuenta]).catch(() => {})
      console.error('[tablero] no pude levantar las menciones de antes:', e instanceof Error ? e.message : e)
    }
  }

  // ───────────────────────── notificaciones ─────────────────────────

  /** Crea una notificación para un miembro de la cuenta y la publica en vivo. Null si ya existía (clave única) o era para quien la causó. */
  async notificar(n: NuevaNotificacion): Promise<Notificacion | null> {
    if (n.actor && n.actor.id === n.paraId) return null
    const [f] = await this.db.consulta<Fila>(
      `insert into notificaciones (id, propietario, para_id, tipo, titulo, cuerpo, actor, enlace, tarjeta_id, trabajo_id, mencion_id, clave_unica)
       select $1::text, $2::text, mi.id, $4::text, $5::text, $6::text, $7::jsonb, $8::text, $9::text, $10::text, $11::text, $12::text
         from miembros mi where mi.id = $3::text and mi.propietario = $2::text
       on conflict do nothing returning *`,
      [
        `n_${nuevoId()}`,
        this.cuenta,
        n.paraId,
        n.tipo,
        n.titulo,
        n.cuerpo ?? '',
        n.actor ?? null,
        n.enlace ?? null,
        n.tarjetaId ?? null,
        n.trabajoId ?? null,
        n.mencionId ?? null,
        n.claveUnica ?? null,
      ],
    )
    if (!f) return null
    const notificacion = aNotificacion(f)
    this.s.bus.publicar({ tipo: 'notificacion', accion: 'nueva', actor: n.actor ?? SISTEMA, datos: notificacion })
    return notificacion
  }

  /** Lo que la web pide una sola vez al abrir: las notificaciones, los trabajos vivos, pausados o fallados de la semana y las menciones que quedaron esperando a un agente. */
  async novedades(): Promise<{ notificaciones: Notificacion[]; sinLeer: number; trabajos: TrabajoResumen[]; esperando: Mencion[] }> {
    await this.levantarSiHaceFalta()
    const yo = await this.yoId()
    if (!yo) return { notificaciones: [], sinLeer: 0, trabajos: [], esperando: [] }
    const [lista, [cuenta]] = await Promise.all([
      this.notificaciones({ limite: PAGINA }),
      this.db.consulta<{ n: number }>(`select count(*)::int as n from notificaciones where propietario = $1 and para_id = $2 and leida_en is null`, [this.cuenta, yo]),
    ])
    const [trabajos, esperando] = await Promise.all([trabajosDe(this).paraNovedades(), mencionesEsperando(this)])
    return { notificaciones: lista, sinLeer: Number(cuenta?.n ?? 0), trabajos, esperando }
  }

  /** Las notificaciones del miembro «yo», de la más nueva a la más vieja, de a 30. `antes` es el `creadoEn` de la última que se vio. */
  async notificaciones(f: { antes?: string; limite?: number } = {}): Promise<Notificacion[]> {
    const yo = await this.yoId()
    if (!yo) return []
    let antes: string | null = null
    if (f.antes) {
      const t = new Date(f.antes)
      if (Number.isNaN(t.getTime())) throw new ErrorDominio('«antes» tiene que ser una fecha (el creadoEn de la última notificación que ya tenés).')
      antes = t.toISOString()
    }
    const limite = Math.max(1, Math.min(f.limite ?? PAGINA, 100))
    const filas = await this.db.consulta<Fila>(
      `select * from notificaciones where propietario = $1 and para_id = $2 ${antes ? `and date_trunc('milliseconds', creado_en) < $4::timestamptz` : ''}
        order by creado_en desc, id desc limit $3`,
      antes ? [this.cuenta, yo, limite, antes] : [this.cuenta, yo, limite],
    )
    return filas.map(aNotificacion)
  }

  /** Marca leídas (por id, o todas) las notificaciones del miembro «yo». Un id que no es suyo da 404. Devuelve cuántas cambiaron. */
  async marcarLeidas(f: { ids?: string[]; todas?: boolean }): Promise<number> {
    const yo = await this.yoId()
    if (!yo) return 0
    if (f.todas) {
      const filas = await this.db.consulta<{ id: string }>(
        `update notificaciones set leida_en = now() where propietario = $1 and para_id = $2 and leida_en is null returning id`,
        [this.cuenta, yo],
      )
      if (filas.length) this.s.bus.publicar({ tipo: 'notificacion', accion: 'todas_leidas', actor: SISTEMA, datos: { ids: filas.map((r) => r.id), paraId: yo } })
      return filas.length
    }
    const ids = [...new Set(f.ids ?? [])]
    if (!ids.length) return 0
    const [propias] = await this.db.consulta<{ n: number }>(
      `select count(*)::int as n from notificaciones where propietario = $1 and para_id = $2 and id = any($3::text[])`,
      [this.cuenta, yo, ids],
    )
    if (Number(propias?.n ?? 0) !== ids.length) throw new ErrorDominio('No existe esa notificación.', 404)
    const filas = await this.db.consulta<{ id: string }>(
      `update notificaciones set leida_en = now() where propietario = $1 and para_id = $2 and id = any($3::text[]) and leida_en is null returning id`,
      [this.cuenta, yo, ids],
    )
    if (filas.length) this.s.bus.publicar({ tipo: 'notificacion', accion: 'leida', actor: SISTEMA, datos: { ids: filas.map((r) => r.id), paraId: yo } })
    return filas.length
  }

  // ───────────────────────── preferencias ─────────────────────────

  /** Las preferencias de notificación del miembro «yo» (con los valores de fábrica donde no eligió). */
  async preferencias(): Promise<PreferenciasNotificaciones> {
    const yo = await this.yoId()
    const fabrica = PREFERENCIAS_DE_FABRICA()
    if (!yo) return fabrica
    const [f] = await this.db.consulta<{ preferencias: Record<string, any> | string | null }>(`select preferencias from miembros where id = $1 and propietario = $2`, [yo, this.cuenta])
    const crudas = (typeof f?.preferencias === 'string' ? JSON.parse(f.preferencias) : f?.preferencias)?.notificaciones ?? {}
    return {
      push: { ...fabrica.push, ...soloBooleanos(crudas.push) },
      correo: { ...fabrica.correo, ...soloBooleanos(crudas.correo) },
      silencio: validarSilencio(crudas.silencio) ?? null,
    }
  }

  /** Guarda lo que llegue (lo demás queda como estaba). Valida: solo tipos conocidos, true o false, y el silencio como «HH:MM». */
  async guardarPreferencias(p: Partial<PreferenciasNotificaciones>): Promise<PreferenciasNotificaciones> {
    const yo = await this.yoId()
    if (!yo) throw new ErrorDominio('Esta cuenta todavía no tiene un miembro «yo».', 404)
    for (const grupo of ['push', 'correo'] as const) {
      const v = p[grupo]
      if (v === undefined) continue
      for (const [tipo, valor] of Object.entries(v ?? {})) {
        if (!TIPOS_NOTIFICACION.includes(tipo as TipoNotificacion)) throw new ErrorDominio(`«${tipo}» no es un tipo de notificación. Tipos: ${TIPOS_NOTIFICACION.join(', ')}.`)
        if (typeof valor !== 'boolean') throw new ErrorDominio(`${grupo}.${tipo} tiene que ser true o false.`)
      }
    }
    if (p.silencio !== undefined && p.silencio !== null && !validarSilencio(p.silencio))
      throw new ErrorDominio('El silencio tiene que ser { "desde": "22:00", "hasta": "08:00" } (horas HH:MM) o null.')
    const actual = await this.preferencias()
    const nuevas: PreferenciasNotificaciones = {
      push: { ...actual.push, ...(p.push ?? {}) },
      correo: { ...actual.correo, ...(p.correo ?? {}) },
      silencio: p.silencio === undefined ? actual.silencio : p.silencio,
    }
    await this.db.consulta(
      `update miembros set preferencias = jsonb_set(coalesce(preferencias, '{}'::jsonb), '{notificaciones}', $3::jsonb, true) where id = $1 and propietario = $2`,
      [yo, this.cuenta, JSON.stringify(nuevas)],
    )
    return nuevas
  }

  // ═════════════════════════════════════ F2 · contratos (tarea 2.0): firmas sin implementar ═════════════════════════════════════
  // Frontera entre los tres agentes de la F2 (plan 16.4): cada uno completa SOLO los métodos de su bloque y no cambia una firma
  // sin avisar y sin corregir el plan (Anexo A.3). Un método sin implementar tira `F2: sin implementar` (las lecturas seguras
  // devuelven vacío). Los bloques están separados a propósito: así los tres pueden editar este archivo sin pisarse.
  // Todo método verifica los ids que recibe contra `this.cuenta` (`propietario = $n`): lo ajeno da 404 como lo que no existe.

  // ───────────────────────── A · claves, agentes y ajustes (2.2, 2.16; las rutas que los cambian exigen sesión) ─────────────────────────

  /** Todo lo de Configuración → IA: agentes (con su gasto del mes y su estado), claves sin el secreto, ajustes y modelos conocidos. */
  async estado(): Promise<EstadoIA> {
    return agentes.estado(this)
  }

  /** Guarda o cambia una clave: la prueba antes, la sella en la bóveda y devuelve solo el «termina en». Una clave inválida no se guarda. */
  async guardarClave(e: EntradaClave): Promise<ClaveIA> {
    return agentes.guardarClave(this, e)
  }

  /** Vuelve a probar una clave guardada y deja el estado y la fecha de la prueba. */
  async probarClave(id: string): Promise<ClaveIA> {
    return agentes.probarClave(this, id)
  }

  /** Quita una clave; los agentes que la usaban quedan `sin_clave` (no se pierde nada más). */
  async quitarClave(id: string): Promise<void> {
    return agentes.quitarClave(this, id)
  }

  /** Crea un agente (su miembro de tipo `ia` y su configuración) o cambia uno; la clave y el miembro tienen que ser de la cuenta. */
  async guardarAgente(e: EntradaAgente, ctx?: Ctx): Promise<Agente> {
    return agentes.guardarAgente(this, e, ctx)
  }

  /** Un agente que se quita no se borra: deja de aparecer al mencionar y no dispara (5.7). */
  async archivarAgente(miembroId: string, ctx?: Ctx): Promise<void> {
    return agentes.archivarAgente(this, miembroId, ctx)
  }

  /** Cambia el tope mensual de la cuenta, «pausar toda la IA», lo de las IA de afuera y los repos de código; devuelve cómo quedó. */
  async guardarAjustes(
    a: Partial<Pick<AjustesIA, 'topeMesUsd' | 'pausada' | 'confirmarMcp' | 'externasDisparan' | 'reposCodigo'>>,
  ): Promise<AjustesIA> {
    return agentes.guardarAjustes(this, a)
  }

  /** El gasto de un mes (de fábrica, el actual, UTC): por agente y el detalle por trabajo (12.1). */
  async uso(f?: { mes?: string }): Promise<UsoIA> {
    return agentes.uso(this, f)
  }

  /** A los miembros de la cuenta les suma el resumen de su agente (`Miembro.agente`), para `GET /api/miembros`. */
  async conResumenDeAgentes(miembros: Miembro[]): Promise<Miembro[]> {
    return agentes.conResumenDeAgentes(this, miembros)
  }

  /**
   * Agente por disparo (10.4): un solo aviso que cubre todas las menciones pendientes de ese agente, no más de uno por minuto ni de 20
   * por hora. Si falla, las menciones siguen pendientes y sale una notificación `error_ia` (una sola).
   */
  async disparar(_agenteId: string): Promise<ResultadoDisparo> {
    throw new Error('F2: sin implementar')
  }

  // ───────────────────────── C · trabajos: crear, listar, cancelar, confirmar, reanudar ─────────────────────────

  /** Para una mención que quedó esperando a un agente que ahora está listo («Reintentar»): crea su trabajo. Solo con sesión (la ruta). */
  async reintentarMencion(ctx: Ctx, mencionId: string): Promise<TrabajoResumen> {
    return reintentarMencion(this, ctx, mencionId)
  }

  /** ¿Hay trabajos de esta cuenta listos para correr y sin dueño? (la red del sondeo con `ia=1`, 11.4). Una consulta indexada. */
  async hayVencidos(): Promise<boolean> {
    const filas = await this.db.consulta(
      `select 1 from ia_trabajos where propietario = $1 and estado in ('en_cola', 'en_curso') and proximo_en <= now() and (tomado_hasta is null or tomado_hasta < now()) limit 1`,
      [this.cuenta],
    )
    return filas.length > 0
  }

  /** Los trabajos de la cuenta, del más nuevo al más viejo; `vivos` = en cola o en curso (los que la pantalla mira). */
  async trabajos(f: { hilo?: string; tarjeta?: string; vivos?: boolean; limite?: number } = {}): Promise<TrabajoResumen[]> {
    return trabajosDe(this).listar(f)
  }

  /** Un trabajo con sus pasos, llamadas y tokens. Uno ajeno da 404. */
  async trabajo(id: string): Promise<TrabajoDetalle> {
    return trabajosDe(this).detalle(id)
  }

  /** Pide cancelar: en cola, esperando o pausado pasa a `cancelado` en el momento; en curso, el ciclo lo ve entre pasos (6.9). */
  async cancelar(ctx: Ctx, id: string): Promise<TrabajoResumen> {
    return trabajosDe(this).cancelar(ctx, id)
  }

  /** Decide las acciones que esperaban permiso (12.4): lo permitido se ejecuta, lo negado vuelve al modelo y el trabajo sigue. Solo con sesión. */
  async confirmar(ctx: Ctx, id: string, decisiones: { llamadaId: string; permitir: boolean }[]): Promise<TrabajoResumen> {
    return trabajosDe(this).confirmar(ctx, id, decisiones)
  }

  /** Reanuda un trabajo `pausado_tope` o `fallado` (vuelve a la cola). Solo con sesión. */
  async reanudar(ctx: Ctx, id: string): Promise<TrabajoResumen> {
    return trabajosDe(this).reanudar(ctx, id)
  }

  // ───────────────────────── C · proactividad (2.21, Anexo F.4) ─────────────────────────

  /**
   * Una tarjeta entró a una lista elegida: crea UN trabajo `proactivo` por cada agente con ese disparador (clave única por tarjeta:
   * editarla no lo repite), respetando el máximo diario y el tope. null si ningún agente corresponde o ya estaba.
   */
  async revisarTarjetaNueva(ctx: Ctx, tarjetaId: string): Promise<TrabajoResumen | null> {
    return revisarTarjetaNueva(this, ctx, tarjetaId)
  }

  /** El resumen diario (lo llama el cron): un trabajo `proactivo` por agente con ese disparador; sin disparadores, una lista vacía. */
  async resumenDiario(): Promise<TrabajoResumen[]> {
    return resumenDiario(this)
  }

  // ───────────────────────── F3 · «Pedile a…» y deshacer (firmas para que F2 y F3 no se contradigan) ─────────────────────────

  /** Crea un trabajo desde el panel «Pedile a…»: todos los ids del contexto tienen que ser de la cuenta (`propios`). Solo con sesión. */
  async crearPedido(_ctx: Ctx, _e: NuevoPedido): Promise<TrabajoResumen> {
    throw new Error('F3: sin implementar')
  }

  /** Deshace por tanda lo que hizo un trabajo, de la última llamada a la primera (7.6). */
  async deshacer(
    _ctx: Ctx,
    _id: string,
  ): Promise<{ deshechas: number; noSePudo: { llamadaId: string; titulo: string; motivo: string }[] }> {
    throw new Error('F3: sin implementar')
  }
}

function soloBooleanos(v: unknown): Record<string, boolean> {
  if (!v || typeof v !== 'object') return {}
  return Object.fromEntries(Object.entries(v).filter(([k, x]) => TIPOS_NOTIFICACION.includes(k as TipoNotificacion) && typeof x === 'boolean'))
}

function validarSilencio(v: unknown): { desde: string; hasta: string } | null {
  if (!v || typeof v !== 'object') return null
  const { desde, hasta } = v as Record<string, unknown>
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/
  return typeof desde === 'string' && typeof hasta === 'string' && hora.test(desde) && hora.test(hasta) ? { desde, hasta } : null
}
