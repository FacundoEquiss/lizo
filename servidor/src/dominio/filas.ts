// Conversión de filas de la base (snake_case) a los tipos de la app (camelCase).
import type {
  Actividad,
  Actor,
  Adjunto,
  Checklist,
  ChecklistItem,
  Color,
  Comentario,
  Conector,
  ElementoLienzo,
  Enlace,
  Etiqueta,
  Lista,
  Miembro,
  Porque,
  Proyecto,
  TableroResumen,
  TarjetaResumen,
} from '../../../compartido/tipos'
import { leerVistas, type VistaTablero } from '../../../compartido/vistas'

type Fila = Record<string, any>

export const iso = (v: unknown): string | null => {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const isoSeguro = (v: unknown) => iso(v) ?? new Date(0).toISOString()

export function aMiembro(f: Fila): Miembro {
  return {
    id: f.id,
    nombre: f.nombre,
    tipo: f.tipo,
    color: f.color as Color,
    iniciales: f.iniciales,
    esYo: Boolean(f.es_yo),
    // Un miembro de antes de la migración no tiene alias hasta que ServicioIA.asegurarAlias se lo completa.
    ...(f.alias ? { alias: f.alias as string } : {}),
    ...(f.archivado ? { archivado: true } : {}),
  }
}

/** Los ajustes de una fila de tablero (la base puede devolverlos como texto o ya como objeto). */
export function ajustesDeFila(f: Fila): Record<string, any> {
  return (typeof f.ajustes === 'string' ? JSON.parse(f.ajustes) : f.ajustes) ?? {}
}

/** Las vistas de una fila de tablero (los tableros de antes, sin el ajuste, tienen las tres). */
export const vistasDeFila = (f: Fila): VistaTablero[] => leerVistas(ajustesDeFila(f))

export function aTablero(f: Fila): TableroResumen {
  const ajustes = ajustesDeFila(f)
  return {
    id: f.id,
    proyectoId: f.proyecto_id,
    nombre: f.nombre,
    slug: f.slug,
    descripcion: f.descripcion,
    orden: f.orden,
    archivado: Boolean(f.archivado),
    ajustes,
    vistas: leerVistas(ajustes),
    abiertas: Number(f.abiertas ?? 0),
  }
}

export function aProyecto(f: Fila, tableros: TableroResumen[] = []): Proyecto {
  return {
    id: f.id,
    nombre: f.nombre,
    descripcion: f.descripcion,
    color: f.color,
    prefijo: f.prefijo,
    repoGithub: f.repo_github ?? null,
    imagen: f.imagen ?? null,
    emoji: f.emoji ?? null,
    archivado: Boolean(f.archivado),
    creadoEn: isoSeguro(f.creado_en),
    tableros,
  }
}

export function aLista(f: Fila): Lista {
  return {
    id: f.id,
    tableroId: f.tablero_id,
    nombre: f.nombre,
    orden: f.orden,
    categoria: f.categoria ?? null,
    color: f.color ?? null,
    limite: f.limite ?? null,
    archivada: Boolean(f.archivada),
  }
}

export function aEtiqueta(f: Fila): Etiqueta {
  return {
    id: f.id,
    proyectoId: f.proyecto_id,
    nombre: f.nombre,
    color: f.color,
    grupo: f.grupo ?? null,
    orden: f.orden,
  }
}

export function aEnlace(f: Fila): Enlace {
  return { id: f.id, tipo: f.tipo, url: f.url, titulo: f.titulo, datos: f.datos ?? {} }
}

/** Fila de la consulta de resumen (ver SQL_RESUMEN en servicio.ts). */
export function aTarjetaResumen(f: Fila): TarjetaResumen {
  const enlaces = (typeof f.enlaces_json === 'string' ? JSON.parse(f.enlaces_json) : f.enlaces_json) ?? []
  return {
    id: f.id,
    clave: f.clave,
    numero: f.numero,
    proyectoId: f.proyecto_id,
    tableroId: f.tablero_id,
    listaId: f.lista_id ?? null,
    orden: f.orden,
    padreId: f.padre_id ?? null,
    tipo: f.tipo,
    titulo: f.titulo,
    prioridad: f.prioridad,
    estimacion: f.estimacion == null ? null : Number(f.estimacion),
    etiquetas: f.etiquetas ?? [],
    responsables: f.responsables ?? [],
    fechas: {
      inicio: iso(f.fecha_inicio),
      vence: iso(f.fecha_vence),
      conHora: Boolean(f.vence_con_hora),
      completada: iso(f.completada_en),
    },
    portada: f.portada ?? null,
    contadores: {
      comentarios: Number(f.n_comentarios ?? 0),
      adjuntos: Number(f.n_adjuntos ?? 0),
      checklistHechos: Number(f.n_items_hechos ?? 0),
      checklistTotal: Number(f.n_items ?? 0),
      vinculos: Number(f.n_vinculos ?? 0),
      bloqueadaPor: Number(f.n_bloqueos ?? 0),
      hijas: Number(f.n_hijas ?? 0),
    },
    enlaces: enlaces.map(aEnlace),
    porque: f.porque_estado ? { estado: f.porque_estado, motivo: f.porque_motivo ?? '' } : null,
    tieneDescripcion: Boolean(f.descripcion && String(f.descripcion).trim()),
    discord: Boolean(f.ref_externa && String(f.ref_externa).startsWith('discord:')),
    archivada: Boolean(f.archivada),
    version: f.version,
    creadaEn: isoSeguro(f.creada_en),
    actualizadaEn: isoSeguro(f.actualizada_en),
    origen: (f.origen as Actor) ?? null,
  }
}

export function aPorque(f: Fila): Porque {
  return {
    motivo: f.motivo ?? '',
    contexto: f.contexto ?? '',
    opciones: f.opciones ?? [],
    decision: f.decision ?? '',
    consecuencias: f.consecuencias ?? '',
    estado: f.estado ?? 'abierta',
    evidencias: f.evidencias ?? [],
    decidieron: f.decidieron ?? [],
    decididaEn: iso(f.decidida_en),
    revisarEn: iso(f.revisar_en),
    reemplazadaPor: f.reemplazada_por ?? null,
    actualizadoEn: isoSeguro(f.actualizado_en),
  }
}

export function aItem(f: Fila): ChecklistItem {
  return {
    id: f.id,
    texto: f.texto,
    hecho: Boolean(f.hecho),
    responsableId: f.responsable_id ?? null,
    vence: iso(f.vence),
    orden: f.orden,
  }
}

export function aChecklist(f: Fila, items: ChecklistItem[]): Checklist {
  return { id: f.id, titulo: f.titulo, orden: f.orden, ocultarHechos: Boolean(f.ocultar_hechos), items }
}

export function aAdjunto(f: Fila): Adjunto {
  return {
    id: f.id,
    nombre: f.nombre,
    url: f.url || (f.ruta ? `/archivos/${f.ruta}` : ''),
    mime: f.mime ?? null,
    tamano: f.tamano == null ? null : Number(f.tamano),
    descripcion: f.descripcion ?? '',
    esImagen: Boolean(f.es_imagen),
    creadoPor: f.creado_por ?? null,
    creadoEn: isoSeguro(f.creado_en),
  }
}

export function aComentario(f: Fila): Comentario {
  return {
    id: f.id,
    tarjetaId: f.tarjeta_id,
    autor: f.autor,
    cuerpo: f.cuerpo,
    creadoEn: isoSeguro(f.creado_en),
    editadoEn: iso(f.editado_en),
    ...(f.respuesta_a ? { respuestaA: f.respuesta_a as string } : {}),
    ...(f.trabajo_id ? { trabajoId: f.trabajo_id as string } : {}),
  }
}

export function aActividad(f: Fila): Actividad {
  return {
    id: f.id,
    proyectoId: f.proyecto_id ?? null,
    tableroId: f.tablero_id ?? null,
    tarjetaId: f.tarjeta_id ?? null,
    tarjetaClave: f.tarjeta_clave ?? null,
    actor: f.actor,
    accion: f.accion,
    resumen: f.resumen,
    detalle: f.detalle ?? null,
    creadoEn: isoSeguro(f.creado_en),
  }
}

export function aElemento(f: Fila): ElementoLienzo {
  return {
    id: f.id,
    tableroId: f.tablero_id,
    tipo: f.tipo,
    x: Number(f.x),
    y: Number(f.y),
    ancho: Number(f.ancho),
    alto: Number(f.alto),
    z: Number(f.z),
    tarjetaId: f.tarjeta_id ?? null,
    listaId: f.lista_id ?? null,
    datos: f.datos ?? {},
    bloqueado: Boolean(f.bloqueado),
    actualizadoEn: isoSeguro(f.actualizado_en),
    creadoPor: (f.creado_por as Actor) ?? null,
  }
}

export function aConector(f: Fila): Conector {
  return {
    id: f.id,
    tableroId: f.tablero_id,
    desdeId: f.desde_id,
    desdeLado: f.desde_lado ?? null,
    hastaId: f.hasta_id,
    hastaLado: f.hasta_lado ?? null,
    trazo: f.trazo,
    puntaInicio: f.punta_inicio,
    puntaFin: f.punta_fin,
    guion: f.guion ?? 'solido',
    color: f.color ?? null,
    grosor: Number(f.grosor),
    etiqueta: f.etiqueta ?? '',
  }
}
