// Tipos de la IA integrada, compartidos entre servidor y web: menciones, notificaciones, agentes, claves, trabajos.
// Son el contrato entre capas (docs/plan-ia-integrada.md, Anexo A.1): los nombres y las formas no se cambian sin
// corregir el plan. Solo tipos y dos funciones puras: sin base de datos, sin red.
import type { Preajuste } from './preajustes-ia'
import type { Actor, Color } from './tipos'

// `codigo` es la de leer el código de los repos (Anexo F.3): solo lee, no tiene inversa; funciona si la cuenta cargó su token de GitHub.
export const CAPACIDADES = ['comentar', 'tarjetas', 'lienzo', 'diseno', 'archivar', 'estructura', 'codigo'] as const
export type Capacidad = (typeof CAPACIDADES)[number]
/** Lo que trae un agente nuevo (12.3): lo que más se usa anda sin fricción; archivar, estructura, Diseño y código los prende el dueño. */
export const PERMISOS_DE_FABRICA: readonly Capacidad[] = ['comentar', 'tarjetas', 'lienzo']
/** Qué permite cada capacidad, en las palabras de la pantalla (12.3) y de «No tenés permiso para …». */
export const CAPACIDADES_TEXTO: Record<Capacidad, string> = {
  comentar: 'comentar en tarjetas y en Diseño',
  tarjetas: 'crear, editar, mover y vincular tarjetas, y escribir el porqué',
  lienzo: 'armar y cambiar cosas en el lienzo: notas, formas, conectores, tablas y gráficos',
  diseno: 'crear y editar marcos, tokens y piezas en Diseño',
  archivar: 'archivar tarjetas y sacar cosas del lienzo (se puede deshacer)',
  estructura: 'crear y cambiar proyectos, tableros y listas',
  codigo: 'leer el código de los repos de GitHub (solo lee)',
}
/** Los preajustes de la pantalla (12.3): un toque y quedan marcadas las capacidades. El de fábrica es `tarjetas_y_lienzo`. */
export const PREAJUSTES_PERMISOS: readonly { id: string; nombre: string; permisos: readonly Capacidad[] }[] = [
  { id: 'solo_comentar', nombre: 'Solo comentar', permisos: ['comentar'] },
  { id: 'tarjetas_y_lienzo', nombre: 'Tarjetas y lienzo', permisos: ['comentar', 'tarjetas', 'lienzo'] },
  { id: 'todo_menos_estructura', nombre: 'Todo menos estructura', permisos: ['comentar', 'tarjetas', 'lienzo', 'diseno', 'archivar', 'codigo'] },
  { id: 'todo', nombre: 'Todo', permisos: ['comentar', 'tarjetas', 'lienzo', 'diseno', 'archivar', 'estructura', 'codigo'] },
]
/** Topes de gasto de fábrica, en USD por mes (decidido por el dueño: 12.2). */
export const TOPE_AGENTE_DE_FABRICA_USD = 10
export const TOPE_CUENTA_DE_FABRICA_USD = 25
export type ModoConfirmar = 'nunca' | 'peligrosas' | 'siempre'
export type Superficie = 'tarjeta' | 'kanban' | 'lienzo' | 'tabla' | 'diseno'
export type OrigenMencion = 'comentario' | 'descripcion' | 'porque' | 'nota' | 'comentario_diseno'
export type EstadoMencion = 'pendiente' | 'atendida' | 'retirada'
export type EstadoTrabajo =
  | 'en_cola' | 'en_curso' | 'esperando_confirmacion' | 'pausado_tope' | 'hecho' | 'fallado' | 'cancelado'
export type MotivoPausa = 'tope_agente' | 'tope_cuenta' | 'tope_trabajo' | 'tope_proveedor' | 'pausa'
export type TipoNotificacion = 'mencion' | 'respuesta' | 'confirmacion' | 'tope' | 'error_ia' | 'asignacion' | 'aviso'
export type IdProveedor = 'anthropic' | 'openai' | 'compatible' | 'falso'
/** Lo que puede guardar la bóveda (10.2): claves de proveedores, el token de una tarea de Claude Code y el token de GitHub (F.3). */
export type TipoClave = IdProveedor | 'disparador' | 'github'
/** Por qué nació un trabajo: una mención, el panel «Pedile a…», una respuesta sin @ en la tarjeta (F.2) o un disparador proactivo (F.4). */
export type OrigenTrabajo = 'mencion' | 'pedido' | 'conversacion' | 'proactivo'
/** Qué puede hacer un agente proactivo: `sugiere` solo comenta y notifica; `actua` además mueve y cambia estados (F.4). */
export type Autonomia = 'sugiere' | 'actua'
export type EstadoAgente = 'listo' | 'sin_clave' | 'clave_invalida' | 'pausado' | 'en_tope'
export type EstadoLlamada = 'pendiente' | 'esperando' | 'en_curso' | 'hecha' | 'error' | 'denegada' | 'incierta'

/** ¿El trabajo sigue vivo (hay que mirarlo)? */
export const esVivo = (e: EstadoTrabajo): boolean => e === 'en_cola' || e === 'en_curso'
/** ¿El trabajo ya terminó (no se retoma)? */
export const esTerminal = (e: EstadoTrabajo): boolean => e === 'hecho' || e === 'fallado' || e === 'cancelado'

/** Lo que se suma a Miembro en compartido/tipos.ts: `alias`, `archivado` y `agente`. */
export interface ResumenAgente { modo: 'api' | 'disparador'; estado: EstadoAgente; modelo: string | null }

export interface Mencion {
  id: string
  origen: { tipo: OrigenMencion; id: string }
  destinatarioId: string
  autor: Actor
  extracto: string
  estado: EstadoMencion
  /** Si quedó pendiente con un agente que no puede responder ahora: por qué, en palabras simples. */
  motivo: string | null
  trabajoId: string | null
  tarjetaClave: string | null
  /** Ruta de Telar para abrirla. */
  enlace: string
  creadoEn: string
}

export interface Notificacion {
  id: string
  paraId: string
  tipo: TipoNotificacion
  titulo: string
  cuerpo: string
  actor: Actor | null
  enlace: string | null
  trabajoId: string | null
  mencionId: string | null
  leidaEn: string | null
  creadoEn: string
}

export interface PreferenciasNotificaciones {
  push: Record<TipoNotificacion, boolean>
  correo: Record<TipoNotificacion, boolean>
  silencio: { desde: string; hasta: string } | null
}

/** Lo que manda la web para guardar una clave. `clave` falta si solo se renombra o se cambia la dirección. Nunca vuelve al navegador. */
export interface EntradaClave {
  id?: string
  proveedor: TipoClave
  nombre: string
  clave?: string
  urlBase?: string | null
}

export interface ClaveIA {
  id: string
  proveedor: TipoClave
  nombre: string
  urlBase: string | null
  ultimos4: string
  estado: 'sin_probar' | 'valida' | 'invalida'
  probadaEn: string | null
  error: string | null
  /** Los agentes que la usan (ids de miembro). */
  enUso: string[]
}

/** USD por millón de tokens, para un modelo `compatible` que Telar no conoce (el dueño los escribe; sin ellos el agente no se activa). */
export interface PrecioManual { entrada: number; salida: number; cacheLectura: number }

/**
 * Los disparadores de un agente proactivo (F.4). Todo ausente o vacío = apagado: un agente es proactivo solo si el dueño lo
 * prendió. Se guarda como JSON en `ia_agentes.disparadores`.
 */
export interface Disparadores {
  /** Revisar cada tarjeta que entra a estas listas (ids de lista). Sugerida: «Bandeja (Discord)». */
  tarjetaNueva?: { listas: string[] }
  /** Un resumen corto de lo trabado y lo vencido, a la hora del cron. `tableroId`: dónde comentarlo; null = solo notificar. */
  resumenDiario?: { tableroId: string | null }
  /** Máximo de trabajos proactivos por día UTC. De fábrica `MAX_PROACTIVOS_POR_DIA`. */
  maxPorDia?: number
}
export const MAX_PROACTIVOS_POR_DIA = 20

export interface Agente {
  miembroId: string
  nombre: string
  alias: string
  color: Color
  modo: 'api' | 'disparador'
  proveedor: IdProveedor | null
  modelo: string | null
  claveId: string | null
  esfuerzo: 'bajo' | 'medio' | 'alto' | null
  instrucciones: string
  permisos: Capacidad[]
  confirmar: ModoConfirmar
  puedeMencionarIA: boolean
  topeMesUsd: number
  gastoMesUsd: number
  /** 'compatible' sin precio conocido: lo escribe el dueño. */
  precioManual: PrecioManual | null
  /** 'compatible': lo declara el dueño. null = lo que diga el catálogo de modelos. */
  veImagenes: boolean | null
  /** Solo cuenta si hay disparadores (F.4). De fábrica `sugiere`. */
  autonomia: Autonomia
  disparadores: Disparadores
  activo: boolean
  estado: EstadoAgente
}

/** Lo que manda la web para crear o cambiar un agente: lo que no venga queda como estaba (o de fábrica si es nuevo). */
export type EntradaAgente = Partial<Agente> & { miembroId?: string; nombre: string }

export interface AjustesIA {
  topeMesUsd: number
  gastoMesUsd: number
  pausada: boolean
  confirmarMcp: boolean
  externasDisparan: boolean
  /** Repos de GitHub (`dueño/repo`) que la capacidad `codigo` puede leer además de los de los proyectos de la cuenta (F.3). */
  reposCodigo: string[]
}

/** Gasto de un agente en un mes (12.1). */
export interface UsoAgenteMes {
  agenteId: string
  agenteNombre: string
  costoUsd: number
  entrada: number
  salida: number
  cacheLectura: number
  cacheEscritura: number
  /** Pedidos al modelo. */
  llamadas: number
}

/** Una fila del detalle por trabajo de la pantalla de gasto. */
export interface UsoTrabajo {
  trabajoId: string
  agenteNombre: string
  origen: OrigenTrabajo
  superficie: Superficie
  /** Dónde se pidió: «RC-104», «Pendientes»… */
  donde: string | null
  pedidoPor: string
  pasos: number
  costoUsd: number
  /** true si algún pedido de este trabajo se abortó y el costo salió de una estimación. */
  estimado: boolean
  creadoEn: string
}

/** El gasto de la cuenta en un mes calendario UTC, por agente y por trabajo (12.1). */
export interface UsoIA {
  /** '2026-11' */
  mes: string
  topeMesUsd: number
  gastoMesUsd: number
  agentes: UsoAgenteMes[]
  trabajos: UsoTrabajo[]
}

/** Lo que devuelve disparar a un agente por disparo (10.4). */
export interface ResultadoDisparo {
  disparado: boolean
  /** Si no se disparó: por qué, en palabras simples («ya disparé hace menos de un minuto», «no tiene la dirección de la tarea»). */
  motivo: string | null
  /** Cuántas menciones pendientes cubre este disparo. */
  menciones: number
}

export interface ModeloConocido {
  proveedor: IdProveedor
  modelo: string
  nombre: string
  veImagenes: boolean
  /** Estimación para la pantalla: una respuesta en una tarjeta. */
  costoRespuestaUsd: number
  aviso?: string
}

export interface EstadoIA {
  agentes: Agente[]
  claves: ClaveIA[]
  ajustes: AjustesIA
  modelos: ModeloConocido[]
  /**
   * Los preajustes de «Agregar clave» y «Nuevo agente» (GPT, Gemini, DeepSeek y «Otro»: `compartido/preajustes-ia.ts`). El servidor siempre los manda
   * (así la pantalla muestra lo mismo que valida el servidor); es opcional solo para que un servidor de mentira de la web no tenga que armarlos.
   */
  preajustes?: readonly Preajuste[]
  /** false si se entró con la clave del MCP: se ve, pero no se cambia. */
  puedeCambiar: boolean
}

export interface LlamadaResumen {
  id: string
  herramienta: string
  /** «Archivar RC-12», «Armar 12 objetos en el lienzo». */
  titulo: string
  estado: EstadoLlamada
  /** Por qué pide permiso o por qué se negó. */
  motivo: string | null
  deshecha: boolean
}

export interface TrabajoResumen {
  id: string
  agenteId: string
  agenteNombre: string
  origen: OrigenTrabajo
  superficie: Superficie
  estado: EstadoTrabajo
  /** MotivoPausa o el texto del fallo. */
  motivo: string | null
  /** «Leyendo RC-98…» */
  haciendo: string | null
  hiloId: string | null
  tableroId: string | null
  tarjetaClave: string | null
  /** El comentario al que va a responder (para ubicar la entrada en el hilo). */
  respuestaA: string | null
  /** Lo que pidió la persona, recortado a 280 caracteres. */
  pedido: string
  paso: number
  maxPasos: number
  costoUsd: number
  /** Solo en esperando_confirmacion. */
  porConfirmar?: LlamadaResumen[]
  /** Solo en hecho y con origen 'pedido': la respuesta para el panel. */
  respuesta?: string | null
  /** Lo que hizo, sacado del libro de llamadas: «Movió RC-104 a Hecho». */
  hizo: string[]
  sePuedeDeshacer: boolean
  creadoEn: string
  terminadoEn: string | null
}

export interface TrabajoDetalle extends TrabajoResumen {
  pedidoPor: Actor
  pasos: {
    paso: number
    texto: string | null
    llamadas: (LlamadaResumen & { argumentos: unknown; resultado: string | null })[]
  }[]
  tokens: { entrada: number; salida: number; cacheLectura: number; cacheEscritura: number }
}

/** Lo que manda el panel «Pedile a…». Solo ids: el servidor lee el contenido. */
export interface NuevoPedido {
  agenteId: string
  superficie: Exclude<Superficie, 'tarjeta'>
  pedido: string
  hiloId?: string
  contexto: {
    tableroId: string
    tarjetaClave?: string
    objetos?: string[]        // selección del lienzo
    tablaId?: string
    pagina?: string           // Diseño
    marcoId?: string          // Diseño
  }
}
