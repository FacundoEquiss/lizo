// Los contratos de la IA integrada F2: la frontera entre la bóveda y las pantallas (A), los proveedores (B) y el ejecutor (C).
// Solo tipos, un error tipado y los números fijos del plan: sin base de datos, sin red, sin lógica. Los nombres y las formas
// no se cambian sin avisar y sin corregir el plan (docs/plan-ia-integrada.md, Anexo A.2 y Anexo F).
//
// Los adaptadores de proveedores no conocen Telar (4.4): reciben texto y devuelven texto. Lo que viene de la base (el trabajo,
// las llamadas, el gasto) lo arma el ServicioIA y lo consume el ejecutor; los proveedores solo ven `PedidoModelo`.
import type { Actor } from '../../../compartido/tipos'
import type { Servicio } from '../dominio/servicio'
import type {
  Capacidad,
  EstadoLlamada,
  EstadoTrabajo,
  IdProveedor,
  OrigenMencion,
  OrigenTrabajo,
  Superficie,
} from '../../../compartido/ia'

// ───────────────────────── mensajes y herramientas (9.1) ─────────────────────────

export interface BloqueSistema { texto: string }
/** Una herramienta para el modelo. `esquema` es JSON Schema (z.toJSONSchema del esquema zod de la herramienta, 9.3). */
export interface DefHerramienta { nombre: string; descripcion: string; esquema: Record<string, unknown> }

export type ParteUsuario =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'imagen'; mime: string; ruta: string }       // ruta en el almacén de la cuenta, nunca los bytes

export interface LlamadaHerramienta {
  id: string                    // el id que puso el modelo
  nombre: string
  argumentos: unknown
  /** Si el JSON de los argumentos vino roto o cortado: el motivo. La llamada no se ejecuta. */
  invalida?: string
}
export interface ResultadoHerramienta { id: string; nombre: string; esError: boolean; partes: ParteUsuario[] }

export type MensajeNeutro =
  | { rol: 'usuario'; partes: ParteUsuario[] }
  | { rol: 'asistente'; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: 'herramienta'; resultados: ResultadoHerramienta[] }
  | { rol: 'sistema'; texto: string }                    // nota a mitad de la conversación

// ───────────────────────── uso y costo (12.1) ─────────────────────────

/** Tokens de un pedido. Lo que el proveedor no informe va en cero (9.1, regla 4). */
export interface Uso { entrada: number; salida: number; cacheLectura: number; cacheEscritura: number }
/** Cómo terminó el pedido: `fin` (respuesta), `herramientas` (llamó alguna), `largo` (max_tokens), `rechazo` (el modelo no quiso), `pausa` (pause_turn). */
export type Corte = 'fin' | 'herramientas' | 'largo' | 'rechazo' | 'pausa'

/** Una fila de `ia_uso`: lo que costó un pedido al modelo. `estimado`: se abortó y el proveedor no informó el uso (caracteres ÷ 3). */
export interface RegistroUso {
  trabajoId: string | null
  agenteId: string
  proveedor: IdProveedor
  modelo: string
  uso: Uso
  /** USD, de `costoUsd()` de proveedores/precios.ts: la única cuenta. */
  costoUsd: number
  estimado: boolean
  ms: number | null
}

// ───────────────────────── el proveedor (9.1) ─────────────────────────

export interface CapacidadesModelo {
  imagenes: boolean
  imagenesEnResultados: boolean
  contexto: number
  salidaMax: number
}

export interface PedidoModelo {
  modelo: string
  esfuerzo?: 'bajo' | 'medio' | 'alto'
  maxSalida: number
  /** Lo fijo del trabajo, tal como lo devolvió prepararFijo(). */
  fijo: string
  /** La conversación en nativo, en orden: cada elemento es exactamente lo guardado en ia_mensajes.nativo. */
  historial: string[]
  clave: string
  urlBase?: string
  senal: AbortSignal
  /** Para poner los bytes de las imágenes referenciadas. */
  leerImagen: (ruta: string) => Promise<Uint8Array>
}

export interface RespuestaModelo {
  corte: Corte
  texto: string
  llamadas: LlamadaHerramienta[]
  uso: Uso
  /** El mensaje del asistente tal como hay que reenviarlo. Se guarda sin tocar. */
  nativo: string
  /** El id del pedido en el proveedor, para depurar. */
  idPedido?: string
}

export type TipoErrorProveedor = 'clave' | 'saldo' | 'limite' | 'sobrecarga' | 'tiempo' | 'pedido' | 'red' | 'rechazo'

/**
 * Lo único que tira `Proveedor.llamar` (ya clasificado, 6.11). `mensaje` y `paraLaPersona` no llevan claves ni contenido del
 * pedido: los adaptadores pasan todo por el filtro de claves antes de armarlo.
 */
export class ErrorProveedor extends Error {
  tipo: TipoErrorProveedor
  reintentable: boolean
  esperarMs?: number
  /** Texto para la persona: sin claves ni contenido. */
  paraLaPersona: string
  /** El id del pedido en el proveedor, si lo hay (se registra; el contenido, nunca). */
  idPedido?: string

  constructor(e: { tipo: TipoErrorProveedor; reintentable: boolean; paraLaPersona: string; mensaje?: string; esperarMs?: number; idPedido?: string }) {
    super(e.mensaje ?? e.paraLaPersona)
    this.name = 'ErrorProveedor'
    this.tipo = e.tipo
    this.reintentable = e.reintentable
    this.esperarMs = e.esperarMs
    this.paraLaPersona = e.paraLaPersona
    this.idPedido = e.idPedido
  }
}

export interface Proveedor {
  id: IdProveedor
  prepararFijo(e: { sistema: BloqueSistema[]; herramientas: DefHerramienta[]; modelo: string }): string
  aNativo(m: MensajeNeutro, e: { modelo: string }): string
  llamar(p: PedidoModelo): Promise<RespuestaModelo>
  probar(e: { clave: string; urlBase?: string; modelo?: string }): Promise<{ ok: boolean; error?: string; modelos?: string[] }>
  capacidades(modelo: string): CapacidadesModelo
}

// `proveedorDe(id: IdProveedor): Proveedor` (tira ErrorDominio si no existe o no está habilitado) vive en proveedores/indice.ts (B).
// `PrecioModelo`, `PRECIOS` y `costoUsd(precio, uso, ahora?)` viven en proveedores/precios.ts (B).

// ───────────────────────── el trabajo y su libro (6, 13.3) ─────────────────────────

/** Los ids que tocó una llamada (o un trabajo entero): salen del bus de eventos y alimentan «deshacer por tanda» (7.6). */
export interface Efectos {
  tarjetas: string[]
  elementos: string[]
  conectores: string[]
  marcos: string[]
  otros: string[]
}

/** Lo que hay que correr para deshacer una llamada. Es un dato: se guarda en `ia_llamadas.inversa` (7.6). */
export interface Inversa {
  pasos: (
    | { herramienta: string; argumentos: Record<string, unknown> }   // una herramienta del catálogo
    | { interno: 'reponer_elementos' | 'reponer_conectores' | 'reponer_tarjeta' | 'desvincular'; datos: unknown }
  )[]
}

/**
 * Dónde se pidió, solo ids (`ia_trabajos.contexto`): el contenido se lee al empezar el trabajo, no al crearlo (5.5, 7.3).
 * Lo que sirve para ubicar la respuesta (`respuestaA`, `origen`) también va acá.
 */
export interface ContextoTrabajo {
  proyectoId?: string
  tableroId?: string
  tarjetaId?: string
  tarjetaClave?: string
  /** El comentario al que va a responder (el que mencionó, o el último del agente en una conversación sin @, F.2). */
  respuestaA?: string
  /** El texto donde estaba la mención (para contestar en el lugar correcto, 6.8). */
  origen?: { tipo: OrigenMencion; id: string }
  /** Selección del lienzo. */
  objetos?: string[]
  tablaId?: string
  /** Diseño. */
  pagina?: string
  marcoId?: string
  /** Solo en los trabajos proactivos (F.4). */
  disparador?: 'tarjeta_nueva' | 'resumen_diario'
}

/** Lo que dejó el trabajo al cerrar (`ia_trabajos.resultado`). */
export interface ResultadoTrabajo {
  texto: string
  comentarioId?: string | null
  elementoId?: string | null
}

/**
 * Una fila de `ia_trabajos` con tipos de verdad: lo que el ciclo necesita para tomar, correr, cobrar y cerrar. Los `numeric` y
 * `bigint` de Postgres llegan como texto: el que lee la fila los pasa a número y las fechas a ISO. Para la web existe
 * `TrabajoResumen` (compartido/ia.ts): éste no sale nunca del servidor (lleva `fijo` y los datos del préstamo).
 */
export interface TrabajoInterno {
  id: string
  propietario: string
  agenteId: string
  origen: OrigenTrabajo
  mencionId: string | null
  /** Un trabajo por cosa que lo dispara: 'conv:<comentario>' (F.2) o 'proactivo:<disparador>:<tarjeta>' (F.4). */
  claveUnica: string | null
  hiloId: string | null
  superficie: Superficie
  contexto: ContextoTrabajo
  pedido: string
  pedidoPor: Actor
  /** Fijados al crear: cambiar el modelo del agente vale para los trabajos nuevos (6.1). */
  proveedor: IdProveedor
  modelo: string
  estado: EstadoTrabajo
  /** `MotivoPausa` o el texto del fallo o de la cancelación. */
  motivo: string | null
  haciendo: string | null
  paso: number
  maxPasos: number
  /** Tope de costo de este trabajo, USD. */
  topeUsd: number
  /** Fallos seguidos del proveedor; vuelve a cero con cada paso que sale bien. */
  reintentos: number
  /** Veces seguidas que se le venció el préstamo; a la tercera se cierra `fallado` (6.3). */
  cortes: number
  proximoEn: string
  tomadoPor: string | null
  tomadoHasta: string | null
  /** La persona pidió cancelar: el ciclo lo ve entre pasos y cada 10 s durante un pedido. */
  cancelar: boolean
  /** Cadena de IA a IA (12.5). */
  profundidad: number
  /** Instrucciones + herramientas en el formato exacto del proveedor (`Proveedor.prepararFijo`). null hasta el paso 0 y después de la retención. */
  fijo: string | null
  resultado: ResultadoTrabajo | null
  tokensEntrada: number
  tokensSalida: number
  costoUsd: number
  msTrabajado: number
  creadoEn: string
  iniciadoEn: string | null
  terminadoEn: string | null
  actualizadoEn: string
}

/**
 * El `neutro` guardado: el de resultados no repite el contenido, apunta a `ia_llamadas.resultado` (13.3). El del asistente guarda además
 * cómo terminó el pedido (`corte`, sumado en la F2): si el trabajo se corta justo después de guardarlo, quien lo retoma sabe si había que
 * cerrar, seguir (pause_turn) o avisar que se cortó por largo.
 */
export type NeutroGuardado =
  | Exclude<MensajeNeutro, { rol: 'herramienta' | 'asistente' }>
  | (Extract<MensajeNeutro, { rol: 'asistente' }> & { corte?: Corte })
  | { rol: 'herramienta'; resultados: { llamadaId: string }[] }

/** Una fila de `ia_mensajes`: la conversación solo se agrega (D11). `nativo` es el JSON exacto del proveedor, como texto. */
export interface MensajeGuardado {
  trabajoId: string
  n: number
  rol: MensajeNeutro['rol']
  neutro: NeutroGuardado
  nativo: string | null
  creadoEn: string
}

/** Una fila de `ia_llamadas`: el libro que impide repetir una acción (6.5, D12). */
export interface LlamadaGuardada {
  id: string
  trabajoId: string
  paso: number
  orden: number
  /** El id que le puso el modelo. */
  idProveedor: string
  /** El nombre real de la herramienta. */
  herramienta: string
  argumentos: unknown
  estado: EstadoLlamada
  motivo: string | null
  decididaPor: Actor | null
  resultado: string | null
  /** Rutas en el almacén de la cuenta. */
  imagenes: string[]
  efectos: Efectos | null
  inversa: Inversa | null
  deshechaEn: string | null
  creadoEn: string
  terminadoEn: string | null
}

/** Lo que se guarda, en UNA transacción, cuando termina un pedido al modelo (P6, 6.4). */
export interface ResultadoPaso {
  /** El número del paso que termina (el trabajo pasa a `paso + 1`). */
  paso: number
  respuesta: RespuestaModelo
  costoUsd: number
  estimado: boolean
  ms: number
}

// ───────────────────────── capacidades, delicadas y límites (12.3, 12.4, 6.4, F.3) ─────────────────────────

/** Lo que exige una herramienta: leer siempre se puede; el resto, una capacidad del agente. */
export type CapacidadDe = Capacidad | 'leer'

/**
 * ¿Hace falta pedir permiso? Devuelve el motivo para mostrar («Archivar RC-12») o null (12.4). `tarjetasTocadas`: las que el mismo
 * trabajo ya creó, editó o movió (desde la 11 se pide). Va en herramientas-agente.ts (C).
 */
export type EsDelicada = (herramienta: string, argumentos: unknown, e: { tarjetasTocadas: number }) => string | null

/** Los límites de un trabajo según dónde se pidió (6.4). El agente puede bajarlos, no subirlos sin tocar el código. */
export interface LimitesSuperficie {
  /** Pedidos al modelo como máximo. */
  pasos: number
  /** Tokens de salida por pedido. */
  maxSalida: number
  /** Tiempo libre mínimo (ms) para empezar un pedido; si no, se suelta y se encadena. */
  minLibreMs: number
  /** Tope de costo del trabajo, USD. */
  topeUsd: number
}

/** Los de fábrica de 6.4. `LIMITES` de herramientas-agente.ts es esto mismo. */
export const LIMITES_DE_FABRICA: Record<Superficie, LimitesSuperficie> = {
  tarjeta: { pasos: 12, maxSalida: 4_000, minLibreMs: 60_000, topeUsd: 1 },
  kanban: { pasos: 16, maxSalida: 6_000, minLibreMs: 90_000, topeUsd: 1.5 },
  tabla: { pasos: 16, maxSalida: 12_000, minLibreMs: 120_000, topeUsd: 2 },
  lienzo: { pasos: 20, maxSalida: 16_000, minLibreMs: 150_000, topeUsd: 3 },
  diseno: { pasos: 24, maxSalida: 24_000, minLibreMs: 240_000, topeUsd: 5 },
}

/** Los números del ciclo que no dependen de la superficie (6.3, 6.4, 6.8, 6.11, 12.4). Unidades en el nombre. */
export const LIMITES_TRABAJO = {
  /** Cuántos trabajos a la vez: uno por agente y dos por cuenta (6.3). */
  porAgente: 1,
  porCuenta: 2,
  /** Cuánto vale un préstamo al tomar el trabajo; se renueva antes de cada pedido (tiempo del pedido + `holguraPrestamoMs`). */
  prestamoMs: 150_000,
  holguraPrestamoMs: 30_000,
  /** Con tres cortes seguidos, `fallado`. */
  cortesMax: 3,
  /** Si quedan menos que esto de plazo, no se arranca una herramienta: se suelta el trabajo y se encadena (P7). */
  minLibreHerramientaMs: 70_000,
  /** Tiempo total de trabajo sumado: después, `fallado` («Tardó demasiado: pedilo por partes»). */
  tiempoTotalMs: 15 * 60_000,
  /** Lo que una herramienta le devuelve al modelo, en caracteres; lo que sobra se corta. */
  resultadoMaxCaracteres: 40_000,
  /** La respuesta que se publica, en caracteres. */
  respuestaMaxCaracteres: 6_000,
  /** Esperas antes de reintentar un 5xx o 529 (después, `fallado`); y cuántas veces como máximo un 429 con espera. */
  reintentosProveedorMs: [5_000, 20_000, 60_000],
  reintentosLimiteMax: 5,
  /** Cada cuánto se mira `cancelar` durante un pedido al modelo. */
  cancelarCadaMs: 10_000,
  /** Días sin respuesta hasta cancelar: esperando confirmación y pausado por tope. */
  confirmacionVenceDias: 7,
  pausadoVenceDias: 30,
} as const

/** Las herramientas de la capacidad `codigo` (F.3): solo leen, no tienen inversa. */
export const HERRAMIENTAS_DE_CODIGO = ['codigo_ver', 'codigo_leer', 'codigo_buscar', 'codigo_cambios'] as const
export type HerramientaDeCodigo = (typeof HERRAMIENTAS_DE_CODIGO)[number]

/** Los límites de leer código por trabajo y por llamada (F.3). */
export const LIMITES_CODIGO = {
  llamadasPorTrabajo: 12,
  bytesPorTrabajo: 150 * 1024,
  bytesPorArchivo: 60 * 1024,
  lineasPorLlamada: 400,
} as const

/** Los puntos donde `TABLERO_IA_FALLA` puede cortar el proceso a propósito (15.2), para probar que un corte no repite nada. */
export const PUNTOS_DE_FALLA = ['despues-de-guardar-asistente', 'en-medio-de-herramienta', 'despues-de-herramientas', 'antes-de-cerrar', 'despues-de-responder'] as const
export type PuntoDeFalla = (typeof PUNTOS_DE_FALLA)[number]
