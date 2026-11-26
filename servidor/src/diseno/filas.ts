// Filas de la base (snake_case) → tipos de Diseño (camelCase).
import type {
  ComentarioDiseno,
  ImportacionDiseno,
  ItemDiseno,
  Marco,
  MarcoResumen,
  NotaDiseno,
  PaginaDiseno,
} from '../../../compartido/diseno/tipos'
import { iso } from '../dominio/filas'

type Fila = Record<string, any>
const isoSeguro = (v: unknown) => iso(v) ?? new Date(0).toISOString()
const json = <T>(v: unknown, defecto: T): T => {
  if (v == null) return defecto
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return defecto
    }
  }
  return v as T
}

const SIETE_DIAS = 7 * 24 * 3600 * 1000

export function aPagina(f: Fila): PaginaDiseno {
  return {
    id: f.id,
    proyectoId: f.proyecto_id,
    nombre: f.nombre,
    slug: f.slug,
    tipo: f.tipo,
    origen: f.origen,
    datos: json(f.datos, {}),
    orden: f.orden,
    archivada: Boolean(f.archivada),
    marcos: Number(f.n_marcos ?? 0),
  }
}

export function aMarcoResumen(f: Fila, ultimaImportacion?: { n: number; en: string | null }): MarcoResumen {
  const datos = { ...json<Record<string, unknown>>(f.datos, {}) }
  delete datos.cajas
  delete datos.estilos
  return {
    id: f.id,
    proyectoId: f.proyecto_id,
    paginaId: f.pagina_id,
    nombre: f.nombre,
    seccion: f.seccion ?? '',
    grupo: f.grupo ?? null,
    x: Number(f.x),
    y: Number(f.y),
    ancho: Number(f.ancho),
    alto: Number(f.alto),
    datos,
    origen: f.origen,
    clave: f.clave ?? null,
    hash: f.hash ?? null,
    miniatura: f.miniatura ?? null,
    revision: Number(f.revision),
    bloqueado: Boolean(f.bloqueado),
    archivado: f.archivado_en != null,
    creadoPor: json(f.creado_por, null),
    creadoEn: isoSeguro(f.creado_en),
    actualizadoEn: isoSeguro(f.actualizado_en),
    hojas: json<string[]>(f.hojas, []),
    tarjetas: Array.isArray(f.tarjetas) ? f.tarjetas.filter(Boolean) : json<string[]>(f.tarjetas, []),
    comentarios: Number(f.n_comentarios ?? 0),
    nuevo: Boolean(
      f.origen === 'importado' &&
        ultimaImportacion &&
        (datos as { importacion?: number }).importacion === ultimaImportacion.n &&
        ultimaImportacion.en &&
        Date.now() - new Date(ultimaImportacion.en).getTime() < SIETE_DIAS,
    ),
  }
}

export function aMarco(f: Fila): Marco {
  const r = aMarcoResumen(f)
  return { ...r, html: f.html ?? '', css: f.css ?? '', datos: json(f.datos, {}) }
}

export function aItem(f: Fila, ultima?: { n: number; en: string | null }): ItemDiseno {
  return {
    tipo: f.tipo,
    clave: f.clave,
    nombre: f.nombre,
    grupo: f.grupo ?? '',
    datos: json(f.datos, {}) as ItemDiseno['datos'],
    origen: f.origen,
    hash: f.hash ?? null,
    importacion: f.importacion ?? null,
    orden: f.orden,
    archivado: Boolean(f.archivado),
    actualizadoEn: isoSeguro(f.actualizado_en),
    nota: f.n_objetivo ? aNota({ objetivo: f.n_objetivo, nombre_propio: f.n_nombre_propio, uso: f.n_uso, nota: f.n_nota, estado: f.n_estado, actualizado_por: f.n_actualizado_por, actualizado_en: f.n_actualizado_en }) : null,
    nuevo: Boolean(
      f.origen === 'importado' && ultima && f.importacion === ultima.n && ultima.en && Date.now() - new Date(ultima.en).getTime() < SIETE_DIAS,
    ),
  }
}

export function aNota(f: Fila): NotaDiseno {
  return {
    objetivo: f.objetivo,
    nombrePropio: f.nombre_propio ?? null,
    uso: f.uso ?? null,
    nota: f.nota ?? null,
    estado: f.estado ?? null,
    actualizadoPor: json(f.actualizado_por, null),
    actualizadoEn: isoSeguro(f.actualizado_en),
  }
}

export function aComentario(f: Fila): ComentarioDiseno {
  return {
    id: f.id,
    objetivo: f.objetivo,
    x: f.x == null ? null : Number(f.x),
    y: f.y == null ? null : Number(f.y),
    texto: f.texto,
    respuestaA: f.respuesta_a ?? null,
    resuelto: Boolean(f.resuelto),
    autor: json(f.autor, { tipo: 'sistema', id: '?', nombre: '?' }),
    creadoEn: isoSeguro(f.creado_en),
  }
}

export function aImportacion(f: Fila): ImportacionDiseno {
  return {
    n: Number(f.n),
    estado: f.estado,
    origen: json(f.origen, {}),
    cambios: json(f.cambios, []),
    resumen: json(f.resumen, {}),
    actor: json(f.actor, null),
    creadoEn: isoSeguro(f.creado_en),
  }
}
