import type {
  AjustesTablero,
  Actividad,
  Adjunto,
  Comentario,
  Conector,
  ElementoLienzo,
  Etiqueta,
  InfoConexion,
  Lista,
  Miembro,
  Proyecto,
  ResultadoBusqueda,
  TableroCompleto,
  TableroResumen,
  TarjetaDetalle,
  TarjetaResumen,
} from '../../../compartido/tipos'
import type { OperacionTabla } from '../../../compartido/tabla'
import type { TipoTablero, VistaTablero } from '../../../compartido/vistas'
import type { Mencion, Notificacion, PreferenciasNotificaciones, TrabajoResumen } from '../../../compartido/ia'
import { sesionVencida } from './sesion'

/** Identifica esta pestaña: el servidor no nos devuelve como "novedad" lo que hicimos nosotros. */
export const clienteId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

export class ErrorApi extends Error {
  constructor(
    mensaje: string,
    readonly estado: number,
  ) {
    super(mensaje)
  }
}

export async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const esForm = cuerpo instanceof FormData
  let r: Response
  try {
    r = await fetch(ruta, {
      method: metodo,
      headers: {
        'x-tablero-cliente': clienteId,
        ...(cuerpo !== undefined && !esForm ? { 'content-type': 'application/json' } : {}),
      },
      body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
    })
  } catch {
    throw new ErrorApi('No hay conexión con el servidor del tablero.', 0)
  }
  const texto = await r.text()
  let datos: any = null
  try {
    datos = texto ? JSON.parse(texto) : null
  } catch {
    datos = null
  }
  if (r.status === 401 && datos?.entrar) sesionVencida()   // online: venció la sesión, vuelve la pantalla de entrar
  if (!r.ok) throw new ErrorApi(datos?.error ?? `Error ${r.status}`, r.status)
  return datos as T
}

const g = <T,>(ruta: string) => pedir<T>('GET', ruta)
const p = <T,>(ruta: string, cuerpo?: unknown) => pedir<T>('POST', ruta, cuerpo ?? {})
const pa = <T,>(ruta: string, cuerpo: unknown) => pedir<T>('PATCH', ruta, cuerpo)
const d = <T,>(ruta: string) => pedir<T>('DELETE', ruta)
const e = encodeURIComponent

export interface PedidoOAuth {
  /** El nombre de la aplicación que pide entrar («ChatGPT»). */
  cliente: string
  /** El sitio al que vuelve el navegador (chatgpt.com). */
  sitio: string
  /** Cuándo vence el pedido (segundos desde 1970). */
  vence: number
}
export interface ConexionOAuth {
  familia: string
  nombre: string
  desde: string
  vence: string
}
/** Mi cuenta (Configuración → Cuenta): de Telar (mail y contraseña propios), la del juego (el dueño) o local. */
export interface MiCuenta {
  id: string
  tipo: 'telar' | 'juego' | 'local'
  nombre: string
  email: string | null
  uso: {
    proyectos: number
    objetosLienzo: number
    archivosBytes: number
    topes: { proyectos: number; objetosLienzo: number; archivosMb: number } | null
  }
}

/** Configuración → Amigos (solo la sesión del dueño). El token de una invitación sale UNA sola vez, en `enlace`, al crearla. */
export type EstadoInvitacion = 'pendiente' | 'usada' | 'vencida' | 'revocada'
export interface Invitacion {
  id: string
  nota: string
  estado: EstadoInvitacion
  usos: number
  usosMax: number
  venceEn: string
  creadaEn: string
  ultimoUsoEn: string | null
  revocadaEn: string | null
}
export interface Amigo {
  id: string
  nombre: string
  email: string | null
  estado: 'activa' | 'suspendida'
  desde: string
  ultimoIngreso: string | null
  proyectos: number
  archivosBytes: number
  invitacion: string | null
  porInvitacion: boolean
  /** Pidió su cuenta desde Entrar (sin enlace) y la aprobaste. */
  porSolicitud: boolean
  /** El enlace de restablecimiento pendiente (sin el token: no se guarda) y el último cambio de contraseña sin la anterior. */
  restablecimiento: { id: string; creadoEn: string; venceEn: string; vencido: boolean } | null
  restablecida: { en: string; por: 'enlace' | 'codigo' } | null
}
/** Una solicitud de cuenta (pidió su cuenta desde Entrar): espera tu aprobación o la rechazaste. Solo lo que hace falta para decidir. */
export interface Solicitud {
  id: string
  nombre: string
  email: string | null
  estado: 'pendiente' | 'rechazada'
  desde: string
  decididaEn: string | null
  /** Cuándo queda libre el mail de una rechazada. */
  liberaEn: string | null
}
export interface Solicitudes {
  pendientes: Solicitud[]
  rechazadas: Solicitud[]
  maxSolicitudes: number
  diasRechazo: number
  diasViejas: number
}
export interface EstadoAmigos {
  solicitudes: Solicitudes
  invitaciones: Invitacion[]
  pendientes: number
  maxPendientes: number
  amigos: Amigo[]
  topeAmigos: number
  topeMin: number
  topeMax: number
}

/** Lo que la web pide una sola vez al abrir (GET /api/novedades): lo de IA del miembro «yo» de la cuenta. */
export interface Novedades {
  notificaciones: Notificacion[]
  sinLeer: number
  /** Los trabajos vivos, los que esperan permiso o están pausados y lo fallado de la última semana (F2). */
  trabajos: TrabajoResumen[]
  esperando: Mencion[]
}

export const api = {
  info: () => g<InfoConexion>('/api/info'),
  cuenta: () => g<MiCuenta>('/api/cuenta'),
  amigos: () => g<EstadoAmigos>('/api/amigos'),
  crearInvitacion: (datos: { nota?: string; usos?: number; venceDias?: number }) =>
    p<{ invitacion: Invitacion; enlace: string }>('/api/amigos/invitaciones', datos),
  revocarInvitacion: (id: string) => p<Invitacion>(`/api/amigos/invitaciones/${e(id)}/revocar`),
  aprobarSolicitud: (id: string) => p<{ ok: true; nombre: string }>(`/api/amigos/${e(id)}/aprobar`),
  rechazarSolicitud: (id: string) => p<{ ok: true; nombre: string }>(`/api/amigos/${e(id)}/rechazar`),
  reconsiderarSolicitud: (id: string) => p<{ ok: true; nombre: string }>(`/api/amigos/${e(id)}/reconsiderar`),
  /** Borra de verdad las solicitudes de más de 30 días (son cuentas sin datos). */
  borrarSolicitudesViejas: () => p<{ borradas: number }>('/api/amigos/solicitudes/limpiar'),
  estadoAmigo: (id: string, estado: 'activa' | 'suspendida') => p<{ ok: true }>(`/api/amigos/${e(id)}/estado`, { estado }),
  topeAmigos: (topeAmigos: number) => pedir<{ topeAmigos: number }>('PUT', '/api/amigos/ajustes', { topeAmigos }),
  /** El enlace (un solo uso, 24 horas) para que un amigo ponga una contraseña nueva. Sale UNA vez, acá. */
  restablecerAmigo: (id: string) =>
    p<{ restablecimiento: { id: string; creadoEn: string; venceEn: string }; nombre: string; enlace: string }>(`/api/amigos/${e(id)}/restablecer`),
  cancelarRestablecimiento: (id: string) => p<{ ok: true }>(`/api/amigos/${e(id)}/restablecer/cancelar`),
  /** Cuántos códigos de recuperación le quedan a la cuenta (no los códigos). `aplica` es false para la cuenta del dueño. */
  codigosDeRecuperacion: () => g<{ aplica: boolean; restantes?: number; total?: number; generadosEn?: string | null; pocos?: boolean }>('/api/cuenta/codigos'),
  // OAuth (ChatGPT, claude.ai): la pantalla «Permitir» y las conexiones activas
  pedidoOAuth: (pedido: string) => g<PedidoOAuth>(`/api/oauth/pedido?pedido=${e(pedido)}`),
  decidirOAuth: (pedido: string, permitir: boolean) => p<{ redirigir: string }>('/api/oauth/decidir', { pedido, permitir }),
  /** Cambia una tabla con operaciones (compartido/tabla.ts): el servidor aplica las mismas reglas que la pantalla. */
  operarTabla: (id: string, operaciones: OperacionTabla[], cambios?: Record<string, unknown>) =>
    pa<{ elemento: ElementoLienzo; avisos: string[] }>(`/api/elementos/${e(id)}/tabla`, { operaciones, cambios }),
  conexionesOAuth: () => g<ConexionOAuth[]>('/api/oauth/conexiones'),
  desconectarOAuth: (familia: string) => d<{ ok: true }>(`/api/oauth/conexiones/${e(familia)}`),
  /** Con `archivados`, también los proyectos y tableros archivados (la sección "Archivados" de la barra lateral). */
  proyectos: (opciones: { archivados?: boolean } = {}) => g<Proyecto[]>(`/api/proyectos${opciones.archivados ? '?archivados=1' : ''}`),
  /** `tipo`: qué tipo es el primer tablero (de fábrica, «tablero»: solo Kanban). */
  crearProyecto: (datos: { nombre: string; prefijo: string; color?: string; repoGithub?: string | null; descripcion?: string; emoji?: string | null; tipo?: TipoTablero }) =>
    p<Proyecto>('/api/proyectos', datos),
  actualizarProyecto: (
    id: string,
    datos: Partial<Pick<Proyecto, 'nombre' | 'color' | 'repoGithub' | 'descripcion' | 'archivado' | 'emoji'>> & { imagen?: null },
  ) => pa<Proyecto>(`/api/proyectos/${id}`, datos),
  /** La foto del proyecto (ya recortada a 256 × 256 por util/imagen.ts). */
  subirImagenProyecto: (id: string, imagen: Blob) => {
    const f = new FormData()
    f.append('archivo', imagen, `proyecto.${imagen.type.split('/')[1] ?? 'png'}`)
    return pedir<Proyecto>('POST', `/api/proyectos/${e(id)}/imagen`, f)
  },
  miembros: () => g<Miembro[]>('/api/miembros'),
  actualizarMiembro: (id: string, datos: { nombre?: string; color?: string; alias?: string }) => pa<Miembro>(`/api/miembros/${id}`, datos),
  // IA integrada, F1 (docs/plan-ia-integrada.md, 13.7): novedades, bandeja y preferencias de notificaciones.
  novedades: () => g<Novedades>('/api/novedades'),
  /** La bandeja de a tandas: las más nuevas, o las anteriores a `antes` (la fecha de la última que se tiene). */
  notificaciones: (f: { antes?: string; limite?: number } = {}) => {
    const qs = new URLSearchParams()
    if (f.antes) qs.set('antes', f.antes)
    if (f.limite) qs.set('limite', String(f.limite))
    const q = qs.toString()
    return g<Notificacion[]>(`/api/notificaciones${q ? `?${q}` : ''}`)
  },
  /** Marca como leídas las que se indican, o todas. Contesta cuántas cambiaron (o nada que importe: no se lee). */
  marcarLeidas: (f: { ids?: string[]; todas?: boolean }) => p<unknown>('/api/notificaciones/leer', f),
  preferenciasNotificaciones: () => g<PreferenciasNotificaciones>('/api/notificaciones/preferencias'),
  guardarPreferenciasNotificaciones: (cambios: Partial<PreferenciasNotificaciones>) =>
    pedir<PreferenciasNotificaciones>('PUT', '/api/notificaciones/preferencias', cambios),
  // IA integrada, F2 (plan 13.7 y 16.4): lo que hacen los botones de un trabajo. Configuración → IA y la lista de trabajos de una tarjeta
  // viven en vistas/ia/api-ia.ts (se bajan aparte: el arranque no las necesita). Lo que cambia algo pide sesión: con la clave del MCP el
  // servidor contesta 403 «Esto se cambia desde Configuración, con tu cuenta.»
  /** Un trabajo tal como está ahora (para el repaso de unos segundos después de un botón). */
  trabajo: (id: string) => g<TrabajoResumen>(`/api/ia/trabajos/${e(id)}`),
  cancelarTrabajo: (id: string) => p<TrabajoResumen>(`/api/ia/trabajos/${e(id)}/cancelar`),
  confirmarTrabajo: (id: string, decisiones: { llamadaId: string; permitir: boolean }[]) =>
    p<TrabajoResumen>(`/api/ia/trabajos/${e(id)}/confirmar`, { decisiones }),
  reanudarTrabajo: (id: string) => p<TrabajoResumen>(`/api/ia/trabajos/${e(id)}/reanudar`),
  reintentarMencion: (id: string) => p<TrabajoResumen>(`/api/ia/menciones/${e(id)}/reintentar`),
  crearEtiqueta: (proyectoId: string, datos: { nombre: string; color?: string }) =>
    p<Etiqueta>(`/api/proyectos/${proyectoId}/etiquetas`, datos),
  actualizarEtiqueta: (id: string, datos: { nombre?: string; color?: string }) => pa<Etiqueta>(`/api/etiquetas/${id}`, datos),
  eliminarEtiqueta: (id: string) => d<{ ok: true }>(`/api/etiquetas/${id}`),

  /** `tipo`: «tablero» (solo Kanban), «diagrama» (solo lienzo), «diseno» (solo Diseño) o «completo» (las tres vistas). */
  crearTablero: (proyectoId: string, nombre: string, tipo?: TipoTablero) => p<TableroResumen>('/api/tableros', { proyectoId, nombre, ...(tipo ? { tipo } : {}) }),
  tablero: (id: string) => g<TableroCompleto>(`/api/tableros/${id}`),
  actualizarTablero: (id: string, datos: { nombre?: string; descripcion?: string; archivado?: boolean; ajustes?: AjustesTablero; vistas?: VistaTablero[] }) =>
    pa<TableroResumen>(`/api/tableros/${id}`, datos),
  archivadas: (id: string) => g<TarjetaResumen[]>(`/api/tableros/${id}/archivadas`),
  actividad: (id: string, limite = 80) => g<Actividad[]>(`/api/tableros/${id}/actividad?limite=${limite}`),
  crearLista: (datos: { id?: string; tableroId: string; nombre: string; categoria?: string | null; posicion?: number }) =>
    p<Lista>('/api/listas', datos),
  actualizarLista: (id: string, datos: Partial<Pick<Lista, 'nombre' | 'categoria' | 'color' | 'limite' | 'archivada'>> & { indice?: number }) =>
    pa<Lista>(`/api/listas/${id}`, datos),

  crearTarjeta: (datos: Record<string, unknown>) => p<TarjetaResumen>('/api/tarjetas', datos),
  tarjeta: (ref: string) => g<TarjetaDetalle>(`/api/tarjetas/${e(ref)}`),
  actualizarTarjeta: (ref: string, datos: Record<string, unknown>) => pa<TarjetaResumen>(`/api/tarjetas/${e(ref)}`, datos),
  moverTarjeta: (ref: string, listaId: string, posicion: number | 'arriba' | 'abajo') =>
    p<TarjetaResumen>(`/api/tarjetas/${e(ref)}/mover`, { listaId, posicion }),
  archivarTarjeta: (ref: string, archivar = true) => p<TarjetaResumen>(`/api/tarjetas/${e(ref)}/archivar`, { archivar }),
  copiarTarjeta: (ref: string, datos: { listaId?: string; titulo?: string } = {}) =>
    p<TarjetaResumen>(`/api/tarjetas/${e(ref)}/copiar`, datos),
  guardarPorque: (ref: string, datos: Record<string, unknown>) => pedir<TarjetaResumen>('PUT', `/api/tarjetas/${e(ref)}/porque`, datos),
  /** `respondeA`: el comentario de esta tarjeta al que contesta (un hilo chato, plan de la IA integrada 5.4). */
  comentar: (ref: string, cuerpo: string, opciones: { respondeA?: string } = {}) =>
    p<Comentario & { menciones?: Mencion[] }>(`/api/tarjetas/${e(ref)}/comentarios`, opciones.respondeA ? { cuerpo, respondeA: opciones.respondeA } : { cuerpo }),
  editarComentario: (id: string, cuerpo: string) => pa<Comentario>(`/api/comentarios/${id}`, { cuerpo }),
  eliminarComentario: (id: string) => d<{ ok: true }>(`/api/comentarios/${id}`),
  crearChecklist: (ref: string, titulo: string, items: string[] = []) =>
    p<{ id: string }>(`/api/tarjetas/${e(ref)}/checklists`, { titulo, items }),
  actualizarChecklist: (id: string, datos: { titulo?: string; ocultarHechos?: boolean }) => pa(`/api/checklists/${id}`, datos),
  eliminarChecklist: (id: string) => d(`/api/checklists/${id}`),
  agregarItem: (checklistId: string, texto: string, indice?: number) => p(`/api/checklists/${checklistId}/items`, { texto, indice }),
  actualizarItem: (id: string, datos: { texto?: string; hecho?: boolean; responsableId?: string | null; vence?: string | null; indice?: number }) =>
    pa(`/api/items/${id}`, datos),
  eliminarItem: (id: string) => d(`/api/items/${id}`),
  convertirItem: (id: string) => p<TarjetaResumen>(`/api/items/${id}/convertir`),
  subirAdjunto: (ref: string, archivo: File) => {
    const f = new FormData()
    f.append('archivo', archivo)
    return pedir<Adjunto>('POST', `/api/tarjetas/${e(ref)}/adjuntos`, f)
  },
  eliminarAdjunto: (id: string) => d(`/api/adjuntos/${id}`),
  agregarEnlace: (ref: string, url: string, titulo?: string) => p<TarjetaResumen>(`/api/tarjetas/${e(ref)}/enlaces`, { url, titulo }),
  eliminarEnlace: (id: string) => d<TarjetaResumen>(`/api/enlaces/${id}`),
  vincular: (ref: string, tipo: string, con: string) => p<TarjetaResumen>(`/api/tarjetas/${e(ref)}/vinculos`, { tipo, con }),
  desvincular: (id: string) => d<TarjetaResumen>(`/api/vinculos/${id}`),

  crearElemento: (tableroId: string, datos: Partial<ElementoLienzo> & { tipo: ElementoLienzo['tipo']; x: number; y: number }) =>
    p<ElementoLienzo>(`/api/tableros/${tableroId}/elementos`, datos),
  crearElementos: (tableroId: string, elementos: Partial<ElementoLienzo>[]) =>
    p<ElementoLienzo[]>(`/api/tableros/${tableroId}/elementos`, { elementos }),
  actualizarElementos: (cambios: Partial<ElementoLienzo>[]) => pa<ElementoLienzo[]>('/api/elementos', { cambios }),
  eliminarElementos: (ids: string[]) => p<{ elementos: string[]; conectores: string[] }>('/api/elementos/eliminar', { ids }),
  convertirElemento: (id: string, a: 'tarjeta' | 'nota' | 'texto' | 'forma', listaId?: string | null) =>
    p<{ elemento: ElementoLienzo; conectores: Conector[]; tarjeta: TarjetaResumen | null; viejo: string }>('/api/elementos/convertir', { id, a, listaId }),
  restaurarElementos: (ids: string[], conectores: string[] = []) =>
    p<{ elementos: ElementoLienzo[]; conectores: Conector[] }>('/api/elementos/restaurar', { ids, conectores }),
  crearConector: (tableroId: string, datos: Partial<Conector> & { desdeId: string; hastaId: string }) =>
    p<Conector>(`/api/tableros/${tableroId}/conectores`, datos),
  actualizarConector: (id: string, datos: Partial<Conector>) => pa<Conector>(`/api/conectores/${id}`, datos),
  eliminarConectores: (ids: string[]) => p<string[]>('/api/conectores/eliminar', { ids }),
  subirArchivo: (archivo: File) => {
    const f = new FormData()
    f.append('archivo', archivo)
    return pedir<{ url: string; nombre: string }>('POST', '/api/archivos', f)
  },
  buscar: (q: string, opciones: { proyecto?: string; tablero?: string; limite?: number } = {}) => {
    const qs = new URLSearchParams({ q })
    if (opciones.proyecto) qs.set('proyecto', opciones.proyecto)
    if (opciones.tablero) qs.set('tablero', opciones.tablero)
    if (opciones.limite) qs.set('limite', String(opciones.limite))
    return g<ResultadoBusqueda[]>(`/api/buscar?${qs}`)
  },
}
