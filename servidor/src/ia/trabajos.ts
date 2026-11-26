// La base de los trabajos de la IA integrada (plan 6, 12 y Anexo A.3, bloque «C» del ServicioIA): crear, tomar, guardar cada paso,
// el libro de llamadas, los topes, cerrar, cancelar, confirmar, reanudar y el mantenimiento. Todo el SQL de `ia_trabajos`,
// `ia_mensajes`, `ia_llamadas`, `ia_uso` e `ia_uso_mes` vive acá; el ciclo (`ejecutor.ts`) solo decide qué guardar y cuándo.
//
// Regla de cuentas (docs/cuentas.md): `Trabajos` nace de un ServicioIA de UNA cuenta y toda consulta lleva `propietario = cuenta`;
// un id ajeno da 404 con el mismo mensaje que uno que no existe. (El mantenimiento del cron es la excepción de sistema: limpia
// todas las cuentas con sentencias que no leen contenido, como `BusEventos.limpiar`.)
import type { Actor } from '../../../compartido/tipos'
import type {
  Autonomia,
  Capacidad,
  Disparadores,
  EstadoLlamada,
  EstadoTrabajo,
  IdProveedor,
  LlamadaResumen,
  ModoConfirmar,
  MotivoPausa,
  OrigenTrabajo,
  PrecioManual,
  Superficie,
  TrabajoDetalle,
  TrabajoResumen,
} from '../../../compartido/ia'
import { esTerminal } from '../../../compartido/ia'
import { recortar } from '../../../compartido/texto'
import type { Conexion } from '../datos/conexion'
import { ErrorDominio, nuevoId, type Ctx } from '../dominio/servicio'
import { hechoDe, LIMITES, tituloDe } from './herramientas-agente'
import { marcarPorCorrer } from './segundo-plano'
import type { ServicioIA } from './servicio-ia'
import {
  LIMITES_TRABAJO,
  type ContextoTrabajo,
  type Efectos,
  type Inversa,
  type LlamadaGuardada,
  type MensajeGuardado,
  type MensajeNeutro,
  type NeutroGuardado,
  type ResultadoPaso,
  type ResultadoTrabajo,
  type TrabajoInterno,
} from './tipos'

type Fila = Record<string, any>

/** Este proceso (para «tomado_por»): sirve para depurar y para que un proceso no escriba sobre un trabajo que ya no es suyo. */
export const PROCESO = `p_${nuevoId()}`

const numero = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const iso = (v: unknown): string => new Date(v as string).toISOString()
const isoONull = (v: unknown): string | null => (v ? iso(v) : null)
const json = <T>(v: unknown, vacio: T): T => (typeof v === 'string' ? (JSON.parse(v) as T) : ((v as T) ?? vacio))

// ───────────────────────── filas → tipos ─────────────────────────

export function aTrabajo(f: Fila): TrabajoInterno {
  return {
    id: f.id,
    propietario: f.propietario,
    agenteId: f.agente_id,
    origen: f.origen,
    mencionId: f.mencion_id ?? null,
    claveUnica: f.clave_unica ?? null,
    hiloId: f.hilo_id ?? null,
    superficie: f.superficie,
    contexto: json<ContextoTrabajo>(f.contexto, {}),
    pedido: f.pedido ?? '',
    pedidoPor: json<Actor>(f.pedido_por, { tipo: 'sistema', id: 'sistema', nombre: 'Telar' }),
    proveedor: f.proveedor,
    modelo: f.modelo,
    estado: f.estado,
    motivo: f.motivo ?? null,
    haciendo: f.haciendo ?? null,
    paso: numero(f.paso),
    maxPasos: numero(f.max_pasos),
    topeUsd: numero(f.tope_usd),
    reintentos: numero(f.reintentos),
    cortes: numero(f.cortes),
    proximoEn: iso(f.proximo_en),
    tomadoPor: f.tomado_por ?? null,
    tomadoHasta: isoONull(f.tomado_hasta),
    cancelar: Boolean(f.cancelar),
    profundidad: numero(f.profundidad),
    fijo: f.fijo ?? null,
    resultado: f.resultado ? json<ResultadoTrabajo>(f.resultado, null as never) : null,
    tokensEntrada: numero(f.tokens_entrada),
    tokensSalida: numero(f.tokens_salida),
    costoUsd: numero(f.costo_usd),
    msTrabajado: numero(f.ms_trabajado),
    creadoEn: iso(f.creado_en),
    iniciadoEn: isoONull(f.iniciado_en),
    terminadoEn: isoONull(f.terminado_en),
    actualizadoEn: iso(f.actualizado_en),
  }
}

export function aLlamada(f: Fila): LlamadaGuardada {
  return {
    id: f.id,
    trabajoId: f.trabajo_id,
    paso: numero(f.paso),
    orden: numero(f.orden),
    idProveedor: f.id_proveedor,
    herramienta: f.herramienta,
    argumentos: json<unknown>(f.argumentos, {}),
    estado: f.estado,
    motivo: f.motivo ?? null,
    decididaPor: f.decidida_por ? json<Actor>(f.decidida_por, null as never) : null,
    resultado: f.resultado ?? null,
    imagenes: (f.imagenes as string[] | null) ?? [],
    efectos: f.efectos ? json<Efectos>(f.efectos, null as never) : null,
    inversa: f.inversa ? json<Inversa>(f.inversa, null as never) : null,
    deshechaEn: isoONull(f.deshecha_en),
    creadoEn: iso(f.creado_en),
    terminadoEn: isoONull(f.terminado_en),
  }
}

export function aMensaje(f: Fila): MensajeGuardado {
  return {
    trabajoId: f.trabajo_id,
    n: numero(f.n),
    rol: f.rol,
    neutro: json<NeutroGuardado>(f.neutro, null as never),
    nativo: f.nativo ?? null,
    creadoEn: iso(f.creado_en),
  }
}

// ───────────────────────── el agente tal como lo necesita el ciclo ─────────────────────────

/** La configuración de un agente (`ia_agentes` + su miembro + el estado de su clave), con tipos de verdad. Solo del servidor. */
export interface AgenteInterno {
  miembroId: string
  nombre: string
  alias: string
  archivado: boolean
  modo: 'api' | 'disparador'
  proveedor: IdProveedor | null
  modelo: string | null
  claveId: string | null
  claveEstado: 'sin_probar' | 'valida' | 'invalida' | null
  esfuerzo: 'bajo' | 'medio' | 'alto' | null
  instrucciones: string
  permisos: Capacidad[]
  confirmar: ModoConfirmar
  puedeMencionarIA: boolean
  topeMesUsd: number
  precioManual: PrecioManual | null
  veImagenes: boolean | null
  autonomia: Autonomia
  disparadores: Disparadores
  activo: boolean
}

export interface AjustesInternos {
  topeMesUsd: number
  pausada: boolean
  confirmarMcp: boolean
  externasDisparan: boolean
}

const AJUSTES_DE_FABRICA: AjustesInternos = { topeMesUsd: 25, pausada: false, confirmarMcp: false, externasDisparan: false }

/** El actor con que firma un agente lo que hace (6.6). */
export const actorDeAgente = (a: Pick<AgenteInterno, 'miembroId' | 'nombre'>, proveedor: string): Actor => ({
  tipo: 'ia',
  id: a.miembroId,
  nombre: a.nombre,
  cliente: `Telar · ${proveedor}`,
})

/** El mes calendario UTC: '2026-11'. */
export const mesDe = (d: Date = new Date()): string => d.toISOString().slice(0, 7)

export interface NuevoTrabajo {
  agente: AgenteInterno
  origen: OrigenTrabajo
  mencionId?: string | null
  claveUnica?: string | null
  hiloId?: string | null
  superficie: Superficie
  contexto: ContextoTrabajo
  pedido: string
  pedidoPor: Actor
  profundidad?: number
  /** Esperar antes de empezar (ms): el porqué y las notas se guardan mientras se escribe. */
  demoraMs?: number
}

export type CreadoONo = { tipo: 'creado' | 'existente'; trabajo: TrabajoInterno } | { tipo: 'rechazado'; motivo: string }

/** Una cuenta no puede crear trabajos sin límite (12.10): ni por hora, ni por día, ni más de 20 en cola por agente. */
export const LIMITES_CREACION = { porHora: 30, porDia: 200, colaPorAgente: 20 } as const
export const AVISO_DEMASIADOS = 'Demasiados pedidos seguidos. Esperá un rato.'

export class PerdioElTrabajo extends Error {
  constructor() {
    super('Este proceso ya no tiene el trabajo (se le venció el préstamo, o lo cancelaron).')
    this.name = 'PerdioElTrabajo'
  }
}

export class Trabajos {
  constructor(readonly ia: ServicioIA) {}

  get db(): Conexion {
    return this.ia.db
  }
  get cuenta(): string {
    return this.ia.cuenta
  }

  // ───────────────────────── agentes y ajustes ─────────────────────────

  /** La configuración de un agente de ESTA cuenta, o null si ese miembro no es un agente (una IA de afuera). */
  async agente(miembroId: string): Promise<AgenteInterno | null> {
    const [f] = await this.db.consulta<Fila>(
      `select a.*, m.nombre, m.alias, m.archivado, k.estado as clave_estado
         from ia_agentes a join miembros m on m.id = a.miembro_id and m.propietario = a.propietario
         left join ia_claves k on k.id = a.clave_id and k.propietario = a.propietario
        where a.miembro_id = $1 and a.propietario = $2`,
      [miembroId, this.cuenta],
    )
    if (!f) return null
    return {
      miembroId: f.miembro_id,
      nombre: f.nombre,
      alias: f.alias ?? '',
      archivado: Boolean(f.archivado),
      modo: f.modo,
      proveedor: f.proveedor ?? null,
      modelo: f.modelo ?? null,
      claveId: f.clave_id ?? null,
      claveEstado: f.clave_id ? (f.clave_estado ?? null) : null,
      esfuerzo: f.esfuerzo ?? null,
      instrucciones: f.instrucciones ?? '',
      permisos: ((f.permisos as string[] | null) ?? []) as Capacidad[],
      confirmar: f.confirmar,
      puedeMencionarIA: Boolean(f.puede_mencionar_ia),
      topeMesUsd: numero(f.tope_mes_usd),
      precioManual: f.precio_manual ? json<PrecioManual>(f.precio_manual, null as never) : null,
      veImagenes: f.ve_imagenes ?? null,
      autonomia: f.autonomia ?? 'sugiere',
      disparadores: json<Disparadores>(f.disparadores, {}),
      activo: Boolean(f.activo),
    }
  }

  /** Los agentes de la cuenta que tienen algún disparador proactivo prendido (F.4). */
  async agentesProactivos(): Promise<AgenteInterno[]> {
    const filas = await this.db.consulta<{ miembro_id: string }>(
      `select a.miembro_id from ia_agentes a join miembros m on m.id = a.miembro_id
        where a.propietario = $1 and a.modo = 'api' and a.activo and not m.archivado and a.disparadores <> '{}'::jsonb order by m.creado_en, m.id`,
      [this.cuenta],
    )
    const salida: AgenteInterno[] = []
    for (const f of filas) {
      const a = await this.agente(f.miembro_id)
      if (a) salida.push(a)
    }
    return salida
  }

  async ajustes(): Promise<AjustesInternos> {
    const [f] = await this.db.consulta<Fila>(`select * from ia_ajustes where propietario = $1`, [this.cuenta])
    if (!f) return AJUSTES_DE_FABRICA
    return { topeMesUsd: numero(f.tope_mes_usd), pausada: Boolean(f.pausada), confirmarMcp: Boolean(f.confirmar_mcp), externasDisparan: Boolean(f.externas_disparan) }
  }

  /**
   * Por qué un agente no puede tomar un trabajo ahora (en palabras simples), o null si está listo. null también para una IA de afuera
   * y para un agente por disparo: lo suyo no pasa por acá. El tope de gasto NO lo deja afuera: el trabajo se crea y el ciclo lo pausa
   * en su primer paso (12.2: «no se pierde nada»).
   */
  motivoNoListo(a: AgenteInterno | null, ajustes: AjustesInternos): string | null {
    if (!a || a.modo !== 'api') return null
    if (a.archivado) return 'Está archivado.'
    if (!a.activo) return 'Está apagado.'
    if (ajustes.pausada) return 'Toda la IA de esta cuenta está en pausa.'
    if (!a.claveId || !a.claveEstado) return 'No tiene clave.'
    if (a.claveEstado === 'invalida') return 'Su clave no anda.'
    if (!a.proveedor || !a.modelo) return 'No tiene modelo elegido.'
    return null
  }

  // ───────────────────────── crear ─────────────────────────

  /**
   * Crea el trabajo de una mención, una respuesta sin @ o un disparador proactivo. Un trabajo por cosa que lo dispara: el índice único
   * de `mencion_id` y de `(propietario, clave_unica)` frena al segundo (devuelve el que ya estaba). Con los límites de 12.10 llenos,
   * no se crea y se devuelve el aviso (la mención queda pendiente).
   */
  async crear(e: NuevoTrabajo): Promise<CreadoONo> {
    const a = e.agente
    if (e.mencionId || e.claveUnica) {
      const [ya] = await this.db.consulta<Fila>(
        `select * from ia_trabajos where propietario = $1 and ((mencion_id is not null and mencion_id = $2) or (clave_unica is not null and clave_unica = $3))`,
        [this.cuenta, e.mencionId ?? null, e.claveUnica ?? null],
      )
      if (ya) return { tipo: 'existente', trabajo: aTrabajo(ya) }
    }
    const [conteo] = await this.db.consulta<{ hora: number; dia: number }>(
      `select count(*) filter (where creado_en > now() - interval '1 hour')::int as hora, count(*)::int as dia
         from ia_trabajos where propietario = $1 and creado_en > now() - interval '1 day'`,
      [this.cuenta],
    )
    if (numero(conteo?.hora) >= LIMITES_CREACION.porHora || numero(conteo?.dia) >= LIMITES_CREACION.porDia) return { tipo: 'rechazado', motivo: AVISO_DEMASIADOS }
    const [cola] = await this.db.consulta<{ n: number }>(
      `select count(*)::int as n from ia_trabajos where propietario = $1 and agente_id = $2 and estado = 'en_cola'`,
      [this.cuenta, a.miembroId],
    )
    if (numero(cola?.n) >= LIMITES_CREACION.colaPorAgente) return { tipo: 'rechazado', motivo: AVISO_DEMASIADOS }

    const lim = LIMITES[e.superficie]
    const id = `tr_${nuevoId()}`
    const [f] = await this.db.consulta<Fila>(
      `insert into ia_trabajos (id, propietario, agente_id, origen, mencion_id, clave_unica, hilo_id, superficie, contexto, pedido, pedido_por,
                                proveedor, modelo, max_pasos, tope_usd, profundidad, proximo_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13, $14, $15, $16, now() + ($17 || ' milliseconds')::interval)
       on conflict do nothing returning *`,
      [
        id,
        this.cuenta,
        a.miembroId,
        e.origen,
        e.mencionId ?? null,
        e.claveUnica ?? null,
        e.hiloId ?? null,
        e.superficie,
        JSON.stringify(e.contexto),
        recortar(e.pedido, 280),
        JSON.stringify(e.pedidoPor),
        a.proveedor ?? 'falso',
        a.modelo ?? '',
        lim.pasos,
        lim.topeUsd,
        e.profundidad ?? 0,
        String(Math.max(0, Math.round(e.demoraMs ?? 0))),
      ],
    )
    if (!f) {
      // Otro proceso lo creó a la vez: se devuelve ese.
      const [ya] = await this.db.consulta<Fila>(
        `select * from ia_trabajos where propietario = $1 and ((mencion_id is not null and mencion_id = $2) or (clave_unica is not null and clave_unica = $3))`,
        [this.cuenta, e.mencionId ?? null, e.claveUnica ?? null],
      )
      if (!ya) return { tipo: 'rechazado', motivo: AVISO_DEMASIADOS }
      return { tipo: 'existente', trabajo: aTrabajo(ya) }
    }
    const t = aTrabajo(f)
    if (e.mencionId) await this.db.consulta(`update menciones set trabajo_id = $3, nota = null where id = $1 and propietario = $2 and estado = 'pendiente'`, [e.mencionId, this.cuenta, t.id])
    marcarPorCorrer(this.cuenta)
    await this.publicar('creado', t, a)
    return { tipo: 'creado', trabajo: t }
  }

  // ───────────────────────── tomar y renovar ─────────────────────────

  /** Toma UN trabajo de esta cuenta (6.3): uno por agente, dos por cuenta, con un candado de transacción por cuenta y préstamo con vencimiento. */
  async tomar(proceso: string = PROCESO): Promise<TrabajoInterno | null> {
    return this.db.transaccion(async (tx) => {
      const [l] = await tx.consulta<{ libre: boolean }>(`select pg_try_advisory_xact_lock(hashtext('ia:' || $1)) as libre`, [this.cuenta])
      if (!l?.libre) return null
      const [f] = await tx.consulta<Fila>(
        `with candidato as (
           select t.id
           from ia_trabajos t
           where t.propietario = $1
             and t.estado in ('en_cola', 'en_curso')
             and t.proximo_en <= now()
             and (t.tomado_hasta is null or t.tomado_hasta < now())
             and not exists (
               select 1 from ia_trabajos o
               where o.propietario = $1 and o.agente_id = t.agente_id and o.id <> t.id
                 and o.estado = 'en_curso' and o.tomado_hasta >= now())
             and (select count(*) from ia_trabajos o
                  where o.propietario = $1 and o.estado = 'en_curso' and o.tomado_hasta >= now()) < ${LIMITES_TRABAJO.porCuenta}
           order by t.proximo_en
           for update of t skip locked
           limit 1
         )
         update ia_trabajos t
         set estado = 'en_curso', tomado_por = $2, tomado_hasta = now() + ($3 || ' milliseconds')::interval,
             cortes = t.cortes + (case when t.estado = 'en_curso' then 1 else 0 end),
             iniciado_en = coalesce(t.iniciado_en, now()), actualizado_en = now()
         from candidato
         where t.id = candidato.id
         returning t.*`,
        [this.cuenta, proceso, String(LIMITES_TRABAJO.prestamoMs)],
      )
      return f ? aTrabajo(f) : null
    })
  }

  /** ¿Cuánto falta para que venza el próximo trabajo en cola de esta cuenta (ms)? null si no hay ninguno que se pueda tomar pronto. */
  async proximoEnMs(): Promise<number | null> {
    const [f] = await this.db.consulta<{ ms: number | null }>(
      `select (extract(epoch from (min(greatest(proximo_en, coalesce(tomado_hasta, proximo_en))) - now())) * 1000)::float8 as ms
         from ia_trabajos where propietario = $1 and estado in ('en_cola', 'en_curso')`,
      [this.cuenta],
    )
    return f?.ms === null || f?.ms === undefined ? null : Math.max(0, Number(f.ms))
  }

  /** Renueva el préstamo antes de un pedido o una herramienta. Devuelve el trabajo, o null si ya no es de este proceso (se perdió o se canceló). */
  async renovar(t: Pick<TrabajoInterno, 'id'>, proceso: string = PROCESO, ms: number = LIMITES_TRABAJO.prestamoMs): Promise<TrabajoInterno | null> {
    const [f] = await this.db.consulta<Fila>(
      `update ia_trabajos set tomado_hasta = now() + ($4 || ' milliseconds')::interval, actualizado_en = now()
        where id = $1 and propietario = $2 and tomado_por = $3 and estado = 'en_curso' returning *`,
      [t.id, this.cuenta, proceso, String(ms)],
    )
    return f ? aTrabajo(f) : null
  }

  /** El trabajo tal como está ahora (de esta cuenta), o null. */
  async leer(id: string): Promise<TrabajoInterno | null> {
    const [f] = await this.db.consulta<Fila>(`select * from ia_trabajos where id = $1 and propietario = $2`, [id, this.cuenta])
    return f ? aTrabajo(f) : null
  }

  /** Lo mismo, o 404 con el mismo mensaje que un id que no existe. */
  async propio(id: string): Promise<TrabajoInterno> {
    const t = await this.leer(id)
    if (!t) throw new ErrorDominio('No existe ese trabajo.', 404)
    return t
  }

  async pedirCancelar(id: string): Promise<boolean> {
    const [f] = await this.db.consulta(`select cancelar from ia_trabajos where id = $1 and propietario = $2`, [id, this.cuenta])
    return Boolean(f?.cancelar)
  }

  // ───────────────────────── la conversación y el libro ─────────────────────────

  async mensajes(trabajoId: string): Promise<MensajeGuardado[]> {
    return (await this.db.consulta<Fila>(`select * from ia_mensajes where trabajo_id = $1 and propietario = $2 order by n`, [trabajoId, this.cuenta])).map(aMensaje)
  }

  async llamadas(trabajoId: string): Promise<LlamadaGuardada[]> {
    return (await this.db.consulta<Fila>(`select * from ia_llamadas where trabajo_id = $1 and propietario = $2 order by paso, orden`, [trabajoId, this.cuenta])).map(aLlamada)
  }

  /** Agrega un mensaje (solo se agrega, D11). `n` es el siguiente: dos procesos a la vez chocan con la clave y uno falla. */
  async agregarMensaje(trabajoId: string, rol: MensajeGuardado['rol'], neutro: NeutroGuardado | MensajeNeutro, nativo: string | null, db: Conexion = this.db): Promise<number> {
    const [f] = await db.consulta<{ n: number }>(
      `insert into ia_mensajes (trabajo_id, n, propietario, rol, neutro, nativo)
       select $1, coalesce(max(n), 0) + 1, $2, $3, $4::jsonb, $5 from ia_mensajes where trabajo_id = $1 returning n`,
      [trabajoId, this.cuenta, rol, JSON.stringify(neutro), nativo],
    )
    return numero(f!.n)
  }

  /** P1: lo fijo del trabajo y el primer mensaje, en una transacción (6.4). */
  async guardarPreparacion(t: TrabajoInterno, fijo: string, neutro: MensajeNeutro, nativo: string, proceso: string = PROCESO): Promise<void> {
    await this.db.transaccion(async (tx) => {
      const filas = await tx.consulta(`update ia_trabajos set fijo = $3, actualizado_en = now() where id = $1 and propietario = $2 and tomado_por = $4 and estado = 'en_curso' returning id`, [t.id, this.cuenta, fijo, proceso])
      if (!filas.length) throw new PerdioElTrabajo()
      await this.agregarMensaje(t.id, 'usuario', neutro, nativo, tx)
    })
  }

  /**
   * P6: lo que se guarda, en UNA transacción, cuando termina un pedido al modelo: el mensaje del asistente (con su JSON exacto), una fila de
   * `ia_llamadas` por cada llamada, una de `ia_uso`, la suma de `ia_uso_mes` y, en el trabajo, paso + 1, tokens y costo. Las llamadas con
   * argumentos rotos se guardan ya en `error` (nunca se ejecutan).
   */
  async guardarPaso(
    t: TrabajoInterno,
    r: ResultadoPaso,
    e: {
      proceso?: string
      neutro: NeutroGuardado
      llamadas: { idProveedor: string; herramienta: string; argumentos: unknown; invalida?: string }[]
      proveedor: IdProveedor
      modelo: string
      haciendo: string | null
      estimado: boolean
    },
  ): Promise<{ trabajo: TrabajoInterno; llamadas: LlamadaGuardada[] }> {
    const u = r.respuesta.uso
    return this.db.transaccion(async (tx) => {
      const [f] = await tx.consulta<Fila>(
        `update ia_trabajos set paso = paso + 1, tokens_entrada = tokens_entrada + $4, tokens_salida = tokens_salida + $5,
                                costo_usd = costo_usd + $6, ms_trabajado = ms_trabajado + $7, reintentos = 0, cortes = 0, haciendo = $8, actualizado_en = now()
          where id = $1 and propietario = $2 and tomado_por = $3 and estado = 'en_curso' and paso = $9 returning *`,
        [t.id, this.cuenta, e.proceso ?? PROCESO, u.entrada + u.cacheLectura + u.cacheEscritura, u.salida, r.costoUsd, Math.round(r.ms), e.haciendo, r.paso],
      )
      if (!f) throw new PerdioElTrabajo()
      await this.agregarMensaje(t.id, 'asistente', e.neutro, r.respuesta.nativo, tx)
      const guardadas: LlamadaGuardada[] = []
      for (const [orden, l] of e.llamadas.entries()) {
        const rota = l.invalida !== undefined
        const [g] = await tx.consulta<Fila>(
          `insert into ia_llamadas (id, trabajo_id, propietario, paso, orden, id_proveedor, herramienta, argumentos, estado, resultado, terminado_en)
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11) returning *`,
          [
            `ll_${nuevoId()}`,
            t.id,
            this.cuenta,
            r.paso,
            orden,
            l.idProveedor,
            l.herramienta,
            JSON.stringify(rota ? {} : (l.argumentos ?? {})),
            rota ? 'error' : 'pendiente',
            rota ? `Los argumentos de esta llamada vinieron cortados o rotos (${l.invalida}). Volvé a llamarla con los argumentos completos.` : null,
            rota ? new Date().toISOString() : null,
          ],
        )
        guardadas.push(aLlamada(g!))
      }
      await tx.consulta(
        `insert into ia_uso (id, propietario, trabajo_id, agente_id, proveedor, modelo, entrada, salida, cache_lectura, cache_escritura, costo_usd, estimado, ms)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [`u_${nuevoId()}`, this.cuenta, t.id, t.agenteId, e.proveedor, e.modelo, u.entrada, u.salida, u.cacheLectura, u.cacheEscritura, r.costoUsd, e.estimado, Math.round(r.ms)],
      )
      await tx.consulta(
        `insert into ia_uso_mes (propietario, mes, agente_id, entrada, salida, cache_lectura, cache_escritura, costo_usd, llamadas)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 1)
         on conflict (propietario, mes, agente_id) do update set
           entrada = ia_uso_mes.entrada + excluded.entrada, salida = ia_uso_mes.salida + excluded.salida,
           cache_lectura = ia_uso_mes.cache_lectura + excluded.cache_lectura, cache_escritura = ia_uso_mes.cache_escritura + excluded.cache_escritura,
           costo_usd = ia_uso_mes.costo_usd + excluded.costo_usd, llamadas = ia_uso_mes.llamadas + 1`,
        [this.cuenta, mesDe(), t.agenteId, u.entrada, u.salida, u.cacheLectura, u.cacheEscritura, r.costoUsd],
      )
      return { trabajo: aTrabajo(f), llamadas: guardadas }
    })
  }

  /** Un pedido abortado cuyo uso no informó el proveedor: se anota igual (la estimación), sin pasar de paso. */
  async guardarUsoAbortado(t: TrabajoInterno, u: { entrada: number; salida: number; costoUsd: number; ms: number; proveedor: IdProveedor; modelo: string }): Promise<void> {
    await this.db.transaccion(async (tx) => {
      await tx.consulta(`update ia_trabajos set tokens_entrada = tokens_entrada + $3, tokens_salida = tokens_salida + $4, costo_usd = costo_usd + $5, ms_trabajado = ms_trabajado + $6 where id = $1 and propietario = $2`, [
        t.id, this.cuenta, u.entrada, u.salida, u.costoUsd, Math.round(u.ms),
      ])
      await tx.consulta(
        `insert into ia_uso (id, propietario, trabajo_id, agente_id, proveedor, modelo, entrada, salida, costo_usd, estimado, ms) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)`,
        [`u_${nuevoId()}`, this.cuenta, t.id, t.agenteId, u.proveedor, u.modelo, u.entrada, u.salida, u.costoUsd, Math.round(u.ms)],
      )
      await tx.consulta(
        `insert into ia_uso_mes (propietario, mes, agente_id, entrada, salida, costo_usd, llamadas) values ($1, $2, $3, $4, $5, $6, 1)
         on conflict (propietario, mes, agente_id) do update set entrada = ia_uso_mes.entrada + excluded.entrada, salida = ia_uso_mes.salida + excluded.salida,
           costo_usd = ia_uso_mes.costo_usd + excluded.costo_usd, llamadas = ia_uso_mes.llamadas + 1`,
        [this.cuenta, mesDe(), t.agenteId, u.entrada, u.salida, u.costoUsd],
      )
    })
  }

  /** Cambia una llamada del libro. Una llamada que termina (hecha, error, denegada, incierta) anota cuándo. */
  async marcarLlamada(
    id: string,
    c: { estado?: EstadoLlamada; motivo?: string | null; resultado?: string | null; imagenes?: string[]; efectos?: Efectos | null; inversa?: Inversa | null; decididaPor?: Actor | null },
  ): Promise<LlamadaGuardada> {
    const sets: string[] = []
    const p: unknown[] = [id, this.cuenta]
    const poner = (col: string, v: unknown, cast = '') => {
      p.push(v)
      sets.push(`${col} = $${p.length}${cast}`)
    }
    if (c.estado !== undefined) {
      poner('estado', c.estado)
      if (c.estado === 'hecha' || c.estado === 'error' || c.estado === 'denegada' || c.estado === 'incierta') sets.push('terminado_en = now()')
    }
    if (c.motivo !== undefined) poner('motivo', c.motivo)
    if (c.resultado !== undefined) poner('resultado', c.resultado)
    if (c.imagenes !== undefined) poner('imagenes', c.imagenes, '::text[]')
    if (c.efectos !== undefined) poner('efectos', c.efectos ? JSON.stringify(c.efectos) : null, '::jsonb')
    if (c.inversa !== undefined) poner('inversa', c.inversa ? JSON.stringify(c.inversa) : null, '::jsonb')
    if (c.decididaPor !== undefined) poner('decidida_por', c.decididaPor ? JSON.stringify(c.decididaPor) : null, '::jsonb')
    const [f] = await this.db.consulta<Fila>(`update ia_llamadas set ${sets.join(', ')} where id = $1 and propietario = $2 returning *`, p)
    if (!f) throw new ErrorDominio('No existe esa llamada.', 404)
    return aLlamada(f)
  }

  // ───────────────────────── topes ─────────────────────────

  /** Lo gastado este mes (UTC) por el agente y por toda la cuenta. */
  async gastoMes(agenteId: string): Promise<{ agente: number; cuenta: number }> {
    const [f] = await this.db.consulta<{ agente: string; cuenta: string }>(
      `select coalesce(sum(costo_usd) filter (where agente_id = $2), 0) as agente, coalesce(sum(costo_usd), 0) as cuenta
         from ia_uso_mes where propietario = $1 and mes = $3`,
      [this.cuenta, agenteId, mesDe()],
    )
    return { agente: numero(f?.agente), cuenta: numero(f?.cuenta) }
  }

  // ───────────────────────── estados ─────────────────────────

  /** Suelta el trabajo (queda poco tiempo, reintento, corte): vuelve a la cola, listo en `proximoEnMs`. */
  async soltar(t: Pick<TrabajoInterno, 'id'>, c: { proximoEnMs?: number; reintentos?: number; haciendo?: string | null; proceso?: string } = {}): Promise<TrabajoInterno | null> {
    const [f] = await this.db.consulta<Fila>(
      `update ia_trabajos set estado = 'en_cola', tomado_por = null, tomado_hasta = null, proximo_en = now() + ($4 || ' milliseconds')::interval,
                              reintentos = coalesce($5, reintentos), haciendo = $6, actualizado_en = now()
        where id = $1 and propietario = $2 and tomado_por = $3 and estado = 'en_curso' returning *`,
      [t.id, this.cuenta, c.proceso ?? PROCESO, String(Math.max(0, Math.round(c.proximoEnMs ?? 0))), c.reintentos ?? null, c.haciendo ?? null],
    )
    if (f) marcarPorCorrer(this.cuenta)
    return f ? aTrabajo(f) : null
  }

  /**
   * Cambia el estado de un trabajo que corre este proceso: hecho, fallado, cancelado, pausado_tope o esperando_confirmacion. Los terminales
   * anotan `terminado_en`. Devuelve null si ya no era de este proceso (otro lo retomó, o lo cancelaron desde afuera).
   */
  async cerrar(
    t: Pick<TrabajoInterno, 'id'>,
    estado: Exclude<EstadoTrabajo, 'en_cola' | 'en_curso'>,
    c: { motivo?: string | null; resultado?: ResultadoTrabajo | null; proceso?: string } = {},
  ): Promise<TrabajoInterno | null> {
    const [f] = await this.db.consulta<Fila>(
      `update ia_trabajos set estado = $4, motivo = $5, resultado = coalesce($6::jsonb, resultado),
                              terminado_en = case when $4 in ('hecho', 'fallado', 'cancelado') then now() else null end,
                              tomado_por = null, tomado_hasta = null, haciendo = null, actualizado_en = now()
        where id = $1 and propietario = $2 and tomado_por = $3 and estado = 'en_curso' returning *`,
      [t.id, this.cuenta, c.proceso ?? PROCESO, estado, c.motivo ?? null, c.resultado ? JSON.stringify(c.resultado) : null],
    )
    return f ? aTrabajo(f) : null
  }

  // ───────────────────────── mostrar: resúmenes y detalle ─────────────────────────

  /** Los trabajos como los ve la web (con el nombre del agente, lo que hizo y lo que espera permiso). */
  async resumenes(ts: TrabajoInterno[]): Promise<TrabajoResumen[]> {
    if (!ts.length) return []
    const ids = ts.map((t) => t.id)
    const nombres = new Map(
      (await this.db.consulta<{ id: string; nombre: string }>(`select id, nombre from miembros where id = any($1::text[]) and propietario = $2`, [ts.map((t) => t.agenteId), this.cuenta])).map((f) => [f.id, f.nombre]),
    )
    const llamadas = new Map<string, LlamadaGuardada[]>()
    for (const l of (await this.db.consulta<Fila>(`select * from ia_llamadas where trabajo_id = any($1::text[]) and propietario = $2 order by paso, orden`, [ids, this.cuenta])).map(aLlamada)) {
      const lista = llamadas.get(l.trabajoId) ?? []
      lista.push(l)
      llamadas.set(l.trabajoId, lista)
    }
    return ts.map((t) => {
      const ls = llamadas.get(t.id) ?? []
      const resumen: TrabajoResumen = {
        id: t.id,
        agenteId: t.agenteId,
        agenteNombre: nombres.get(t.agenteId) ?? 'IA',
        origen: t.origen,
        superficie: t.superficie,
        estado: t.estado,
        motivo: t.motivo,
        haciendo: t.haciendo,
        hiloId: t.hiloId,
        tableroId: t.contexto.tableroId ?? null,
        tarjetaClave: t.contexto.tarjetaClave ?? null,
        respuestaA: t.contexto.respuestaA ?? null,
        pedido: recortar(t.pedido, 280),
        paso: t.paso,
        maxPasos: t.maxPasos,
        costoUsd: t.costoUsd,
        hizo: ls.filter((l) => l.estado === 'hecha' && !/^(leer_|listar_|buscar|ver_|codigo_)/.test(l.herramienta)).map((l) => hechoDe(l.herramienta, l.argumentos)),
        sePuedeDeshacer: false,
        creadoEn: t.creadoEn,
        terminadoEn: t.terminadoEn,
      }
      if (t.estado === 'esperando_confirmacion')
        resumen.porConfirmar = ls.filter((l) => l.estado === 'esperando').map((l) => aLlamadaResumen(l))
      if (t.estado === 'hecho' && t.origen === 'pedido') resumen.respuesta = t.resultado?.texto ?? null
      return resumen
    })
  }

  async resumen(t: TrabajoInterno): Promise<TrabajoResumen> {
    return (await this.resumenes([t]))[0]!
  }

  /** Publica el evento `trabajo` (6.10) en el bus de la cuenta. */
  async publicar(accion: 'creado' | 'paso' | 'esperando' | 'pausado' | 'hecho' | 'fallado' | 'cancelado', t: TrabajoInterno, a?: Pick<AgenteInterno, 'miembroId' | 'nombre'> | null): Promise<void> {
    try {
      const datos = await this.resumen(t)
      const actor: Actor = a ? actorDeAgente(a, t.proveedor) : { tipo: 'ia', id: t.agenteId, nombre: datos.agenteNombre, cliente: `Telar · ${t.proveedor}` }
      this.ia.s.bus.publicar({ tipo: 'trabajo', accion, proyectoId: t.contexto.proyectoId ?? null, tableroId: t.contexto.tableroId ?? null, tarjetaId: t.contexto.tarjetaId ?? null, actor, datos })
    } catch (e) {
      console.error(`[tablero] ia: ${t.id} no pude publicar el avance:`, e instanceof Error ? e.name : 'error')
    }
  }

  /** Los trabajos de la cuenta, del más nuevo al más viejo. */
  async listar(f: { hilo?: string; tarjeta?: string; vivos?: boolean; limite?: number } = {}): Promise<TrabajoResumen[]> {
    const donde: string[] = ['propietario = $1']
    const p: unknown[] = [this.cuenta]
    if (f.hilo) donde.push(`hilo_id = $${p.push(f.hilo)}`)
    if (f.tarjeta) donde.push(`(contexto->>'tarjetaClave' = $${p.push(f.tarjeta)} or contexto->>'tarjetaId' = $${p.length})`)
    if (f.vivos) donde.push(`estado in ('en_cola', 'en_curso')`)
    const limite = Math.max(1, Math.min(f.limite ?? 30, 100))
    const filas = await this.db.consulta<Fila>(`select * from ia_trabajos where ${donde.join(' and ')} order by creado_en desc, id desc limit ${limite}`, p)
    return this.resumenes(filas.map(aTrabajo))
  }

  /** Lo que muestra Telar al abrir (11.5): los trabajos vivos, pausados o con permiso pendiente, y lo fallado de los últimos 7 días. */
  async paraNovedades(): Promise<TrabajoResumen[]> {
    const filas = await this.db.consulta<Fila>(
      `select * from ia_trabajos where propietario = $1
          and (estado in ('en_cola', 'en_curso', 'esperando_confirmacion', 'pausado_tope') or (estado = 'fallado' and terminado_en > now() - interval '7 days'))
        order by creado_en desc, id desc limit 50`,
      [this.cuenta],
    )
    return this.resumenes(filas.map(aTrabajo))
  }

  async detalle(id: string): Promise<TrabajoDetalle> {
    const t = await this.propio(id)
    const [resumen] = await this.resumenes([t])
    const llamadas = await this.llamadas(id)
    const mensajes = await this.mensajes(id)
    const asistentes = mensajes.filter((m) => m.rol === 'asistente')
    const pasos = new Map<number, TrabajoDetalle['pasos'][number]>()
    for (const [i, m] of asistentes.entries()) {
      const n = m.neutro as Extract<NeutroGuardado, { rol: 'asistente' }>
      pasos.set(i, { paso: i, texto: n.texto || null, llamadas: [] })
    }
    for (const l of llamadas) {
      const p = pasos.get(l.paso) ?? { paso: l.paso, texto: null, llamadas: [] }
      p.llamadas.push({ ...aLlamadaResumen(l), argumentos: l.argumentos, resultado: l.resultado })
      pasos.set(l.paso, p)
    }
    const [tk] = await this.db.consulta<Fila>(
      `select coalesce(sum(entrada),0) as e, coalesce(sum(salida),0) as s, coalesce(sum(cache_lectura),0) as cl, coalesce(sum(cache_escritura),0) as ce from ia_uso where trabajo_id = $1 and propietario = $2`,
      [id, this.cuenta],
    )
    return {
      ...resumen!,
      pedidoPor: t.pedidoPor,
      pasos: [...pasos.values()].sort((a, b) => a.paso - b.paso),
      tokens: { entrada: numero(tk?.e), salida: numero(tk?.s), cacheLectura: numero(tk?.cl), cacheEscritura: numero(tk?.ce) },
    }
  }

  // ───────────────────────── lo que hace la persona: cancelar, confirmar, reanudar ─────────────────────────

  /** El miembro a quien se le avisa (6.8): quien pidió, si es una persona; si no, el «yo» de la cuenta. */
  async aQuienAvisar(t: TrabajoInterno): Promise<string | null> {
    if (t.pedidoPor.tipo === 'humano') {
      const [f] = await this.db.consulta(`select 1 from miembros where id = $1 and propietario = $2`, [t.pedidoPor.id, this.cuenta])
      if (f) return t.pedidoPor.id
    }
    const [yo] = await this.db.consulta<{ id: string }>(`select id from miembros where propietario = $1 and es_yo order by creado_en, id limit 1`, [this.cuenta])
    return yo?.id ?? null
  }

  /** Frena un trabajo: en cola, esperando o pausado pasa a `cancelado` al instante; en curso, se pide y lo ve el ciclo (6.9). */
  async cancelar(_ctx: Ctx, id: string): Promise<TrabajoResumen> {
    const t = await this.propio(id)
    if (esTerminal(t.estado)) return this.resumen(t)
    if (t.estado === 'en_curso') {
      const [f] = await this.db.consulta<Fila>(`update ia_trabajos set cancelar = true, actualizado_en = now() where id = $1 and propietario = $2 and estado = 'en_curso' returning *`, [id, this.cuenta])
      return this.resumen(f ? aTrabajo(f) : t)
    }
    const [f] = await this.db.consulta<Fila>(
      `update ia_trabajos set estado = 'cancelado', cancelar = true, motivo = 'Lo frenaste vos.', terminado_en = now(), tomado_por = null, tomado_hasta = null, haciendo = null, actualizado_en = now()
        where id = $1 and propietario = $2 and estado in ('en_cola', 'esperando_confirmacion', 'pausado_tope') returning *`,
      [id, this.cuenta],
    )
    if (!f) return this.resumen(await this.propio(id))
    await this.db.consulta(`update ia_llamadas set estado = 'denegada', motivo = 'Se frenó el pedido.', terminado_en = now() where trabajo_id = $1 and propietario = $2 and estado in ('pendiente', 'esperando')`, [id, this.cuenta])
    await this.retirarMencionDe(aTrabajo(f), 'Frenaste el pedido.')
    const cerrado = aTrabajo(f)
    await this.publicar('cancelado', cerrado)
    return this.resumen(cerrado)
  }

  /** El porqué y las notas se guardan mientras se escribe (5.5): un guardado nuevo corre para adelante el comienzo del trabajo que sigue en cola. */
  async postergar(mencionIds: string[], ms = 15_000): Promise<void> {
    if (!mencionIds.length) return
    await this.db.consulta(
      `update ia_trabajos set proximo_en = now() + ($3 || ' milliseconds')::interval where propietario = $1 and mencion_id = any($2::text[]) and estado = 'en_cola'`,
      [this.cuenta, mencionIds, String(ms)],
    )
  }

  /**
   * Una mención que se retira (se borró el comentario, se sacó la «@» del texto) o una conversación que ya no está: su trabajo en cola, esperando
   * permiso o pausado se cancela; a uno en curso se le pide cancelar (5.4 y 5.7). Lo que ya hizo queda.
   */
  async cancelarPorOrigen(mencionIds: string[], clavesUnicas: string[] = []): Promise<void> {
    if (!mencionIds.length && !clavesUnicas.length) return
    const filas = await this.db.consulta<Fila>(
      `update ia_trabajos set estado = 'cancelado', cancelar = true, motivo = 'Ya no está lo que lo pidió.', terminado_en = now(), tomado_por = null, tomado_hasta = null, haciendo = null, actualizado_en = now()
        where propietario = $1 and (mencion_id = any($2::text[]) or clave_unica = any($3::text[])) and estado in ('en_cola', 'esperando_confirmacion', 'pausado_tope') returning *`,
      [this.cuenta, mencionIds, clavesUnicas],
    )
    for (const f of filas) {
      await this.db.consulta(`update ia_llamadas set estado = 'denegada', motivo = 'Se frenó el pedido.', terminado_en = now() where trabajo_id = $1 and propietario = $2 and estado in ('pendiente', 'esperando')`, [f.id, this.cuenta])
      await this.publicar('cancelado', aTrabajo(f))
    }
    await this.db.consulta(
      `update ia_trabajos set cancelar = true, actualizado_en = now() where propietario = $1 and (mencion_id = any($2::text[]) or clave_unica = any($3::text[])) and estado = 'en_curso'`,
      [this.cuenta, mencionIds, clavesUnicas],
    )
  }

  /** La mención de un trabajo que ya no va a responder (lo frenaron, se cancelaron): deja de esperar. */
  async retirarMencionDe(t: TrabajoInterno, nota: string): Promise<void> {
    if (!t.mencionId) return
    await this.db.consulta(`update menciones set estado = 'retirada', nota = $3 where id = $1 and propietario = $2 and estado = 'pendiente'`, [t.mencionId, this.cuenta, nota])
  }

  /**
   * Decide las acciones que pedían permiso (12.4). Solo con sesión (lo que gasta o da permiso no lo hace la clave del MCP). Todas las que
   * esperaban tienen que decidirse; lo permitido se ejecuta cuando el ciclo retoma el trabajo, lo negado le vuelve al modelo.
   */
  async confirmar(ctx: Ctx, id: string, decisiones: { llamadaId: string; permitir: boolean }[]): Promise<TrabajoResumen> {
    exigirSesion(ctx)
    const t = await this.propio(id)
    if (t.estado !== 'esperando_confirmacion') throw new ErrorDominio('Este trabajo no está esperando permiso.', 409)
    const esperando = (await this.llamadas(id)).filter((l) => l.estado === 'esperando')
    const por = new Map(decisiones.map((d) => [d.llamadaId, d.permitir]))
    for (const d of decisiones) if (!esperando.some((l) => l.id === d.llamadaId)) throw new ErrorDominio('No existe esa acción en este trabajo.', 404)
    const sinDecidir = esperando.filter((l) => !por.has(l.id))
    if (sinDecidir.length) throw new ErrorDominio(`Falta decidir ${sinDecidir.length === 1 ? 'una acción' : `${sinDecidir.length} acciones`}: «Permitir» o «No» para cada una.`, 400)
    let cerrado: TrabajoInterno | null = null
    await this.db.transaccion(async (tx) => {
      for (const l of esperando) {
        if (por.get(l.id)) await tx.consulta(`update ia_llamadas set estado = 'pendiente', decidida_por = $3::jsonb where id = $1 and propietario = $2 and estado = 'esperando'`, [l.id, this.cuenta, JSON.stringify(ctx.actor)])
        else
          await tx.consulta(
            `update ia_llamadas set estado = 'denegada', motivo = 'La persona no permitió esta acción.', resultado = 'La persona no permitió esta acción.', decidida_por = $3::jsonb, terminado_en = now()
              where id = $1 and propietario = $2 and estado = 'esperando'`,
            [l.id, this.cuenta, JSON.stringify(ctx.actor)],
          )
      }
      const [f] = await tx.consulta<Fila>(
        `update ia_trabajos set estado = 'en_cola', motivo = null, proximo_en = now(), tomado_por = null, tomado_hasta = null, actualizado_en = now()
          where id = $1 and propietario = $2 and estado = 'esperando_confirmacion' returning *`,
        [id, this.cuenta],
      )
      if (!f) throw new ErrorDominio('Este trabajo no está esperando permiso.', 409)
      cerrado = aTrabajo(f)
    })
    // Primero se avisa el estado «en cola» y recién después se larga el trabajo: si fallara al toque, el «fallado» no se pisa con un «en cola» viejo.
    await this.publicar('paso', cerrado!)
    marcarPorCorrer(this.cuenta)
    return this.resumen(cerrado!)
  }

  /** Reanuda un trabajo `pausado_tope` o `fallado` (vuelve a la cola). Solo con sesión. «Seguir igual» en un tope de trabajo duplica ese tope. */
  async reanudar(ctx: Ctx, id: string): Promise<TrabajoResumen> {
    exigirSesion(ctx)
    const t = await this.propio(id)
    if (t.estado !== 'pausado_tope' && t.estado !== 'fallado') throw new ErrorDominio('Solo se reanuda un trabajo pausado por tope o fallado.', 409)
    // «Seguir igual»: si el trabajo ya pasó SU tope (por sí solo o junto con otro), se lo duplica; si no, sigue con el que tiene.
    const nuevoTope = t.estado === 'pausado_tope' && t.costoUsd >= t.topeUsd ? (t.costoUsd >= t.topeUsd * 2 ? t.costoUsd + t.topeUsd : t.topeUsd * 2) : t.topeUsd
    const [f] = await this.db.consulta<Fila>(
      `update ia_trabajos set estado = 'en_cola', motivo = null, reintentos = 0, cortes = 0, cancelar = false, proximo_en = now(), terminado_en = null,
                              tope_usd = $3, tomado_por = null, tomado_hasta = null, actualizado_en = now()
        where id = $1 and propietario = $2 and estado in ('pausado_tope', 'fallado') returning *`,
      [id, this.cuenta, nuevoTope],
    )
    if (!f) throw new ErrorDominio('Solo se reanuda un trabajo pausado por tope o fallado.', 409)
    const nuevo = aTrabajo(f)
    await this.publicar('paso', nuevo)
    marcarPorCorrer(this.cuenta)
    return this.resumen(nuevo)
  }

  /** Los motivos de pausa con que el ciclo deja un trabajo (para las notificaciones). */
  static textoDePausa(motivo: MotivoPausa, c: { topeUsd?: number } = {}): string {
    switch (motivo) {
      case 'tope_agente':
        return 'Este agente llegó a su tope del mes.'
      case 'tope_cuenta':
        return 'La cuenta llegó a su tope de IA del mes.'
      case 'tope_trabajo':
        return `Este pedido ya gastó USD ${c.topeUsd ?? ''}`.trim()
      case 'tope_proveedor':
        return 'El proveedor frenó por gasto.'
      case 'pausa':
        return 'Toda la IA de esta cuenta está en pausa.'
    }
  }

  // ───────────────────────── mantenimiento (13.6): lo corre el cron, de todas las cuentas ─────────────────────────
}

export function aLlamadaResumen(l: LlamadaGuardada): LlamadaResumen {
  return { id: l.id, herramienta: l.herramienta, titulo: tituloDe(l.herramienta, l.argumentos), estado: l.estado, motivo: l.motivo, deshecha: Boolean(l.deshechaEn) }
}

/** Lo que gasta o da permiso exige sesión: la clave del MCP (o un token de OAuth) lee el estado y frena un trabajo, nada más (10.2). */
export function exigirSesion(ctx: Ctx): void {
  if (ctx.via !== 'sesion' && ctx.via !== 'local') throw new ErrorDominio('Esto se hace desde la app, con tu sesión: la clave del MCP no alcanza.', 403)
}

const porServicio = new WeakMap<ServicioIA, Trabajos>()
export function trabajosDe(ia: ServicioIA): Trabajos {
  let t = porServicio.get(ia)
  if (!t) porServicio.set(ia, (t = new Trabajos(ia)))
  return t
}

// ───────────────────────── mantenimiento global (cron) ─────────────────────────

export interface InformeMantenimiento {
  limpiados: number
}

/**
 * La retención de 13.6, guiada por datos: cada sentencia corre solo si una pregunta barata (`limit 1`) dice que hay algo para limpiar.
 * No lee contenido: pone en null lo fijo y el JSON exacto después de 7 días, borra los mensajes legibles a los 30, cancela lo que
 * esperaba permiso más de 7 días o estaba pausado por tope más de 30, y borra las notificaciones viejas.
 */
export async function mantenimiento(db: Conexion): Promise<InformeMantenimiento> {
  let limpiados = 0
  const hay = async (sql: string) => (await db.consulta(`${sql} limit 1`)).length > 0
  const plazos = LIMITES_TRABAJO
  if (await hay(`select 1 from ia_trabajos where fijo is not null and terminado_en is not null and terminado_en < now() - interval '7 days'`)) {
    limpiados += (await db.consulta(`update ia_trabajos set fijo = null where fijo is not null and terminado_en is not null and terminado_en < now() - interval '7 days' returning id`)).length
    await db.consulta(`update ia_mensajes set nativo = null where nativo is not null and trabajo_id in (select id from ia_trabajos where terminado_en is not null and terminado_en < now() - interval '7 days')`)
  }
  if (await hay(`select 1 from ia_trabajos where terminado_en is not null and terminado_en < now() - interval '30 days'`)) {
    limpiados += (await db.consulta(`delete from ia_mensajes where trabajo_id in (select id from ia_trabajos where terminado_en is not null and terminado_en < now() - interval '30 days') returning n`)).length
    await db.consulta(`update ia_llamadas set argumentos = '{}'::jsonb, resultado = null, inversa = null where resultado is not null and trabajo_id in (select id from ia_trabajos where terminado_en is not null and terminado_en < now() - interval '30 days')`)
  }
  for (const [estado, dias, motivo] of [
    ['esperando_confirmacion', plazos.confirmacionVenceDias, 'Nadie decidió en 7 días: se canceló.'],
    ['pausado_tope', plazos.pausadoVenceDias, 'Estuvo 30 días pausado por tope: se canceló.'],
  ] as const) {
    if (await hay(`select 1 from ia_trabajos where estado = '${estado}' and actualizado_en < now() - interval '${dias} days'`)) {
      const canceladas = await db.consulta<{ id: string }>(
        `update ia_trabajos set estado = 'cancelado', motivo = $1, terminado_en = now(), haciendo = null where estado = '${estado}' and actualizado_en < now() - interval '${dias} days' returning id`,
        [motivo],
      )
      limpiados += canceladas.length
    }
  }
  if (await hay(`select 1 from notificaciones where (leida_en is not null and creado_en < now() - interval '60 days') or creado_en < now() - interval '180 days'`)) {
    limpiados += (await db.consulta(`delete from notificaciones where (leida_en is not null and creado_en < now() - interval '60 days') or creado_en < now() - interval '180 days' returning id`)).length
  }
  return { limpiados }
}
