// Importa los pendientes de Discord (docs/discord/pendientes-AAAA-MM.json) como tarjetas.
// Cada ítem → una tarjeta, en la lista que le toca según su estado, con etiquetas
// por área y por tipo, las citas, los adjuntos copiados, la respuesta sugerida y
// el porqué. Se puede correr varias veces: lo ya importado se actualiza, no se duplica.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pesoPrioridad } from '../../../compartido/constantes'
import { normalizar } from '../../../compartido/texto'
import type { CitaDiscord, Color, DatosDiscord, Prioridad, TipoTarjeta } from '../../../compartido/tipos'
import { ErrorDominio, type Ctx, type Servicio } from '../dominio/servicio'

export interface ItemDiscord {
  id: string
  tipo: string
  area: string
  titulo: string
  descripcion: string
  citas: string[]
  autores: string[]
  fechas: string[]
  canal: string
  adjuntos: { ruta: string; descripcion?: string }[]
  estado: string
  evidencia: string
  prioridad: string
  motivo_prioridad: string
  respuesta_sugerida: string
  relacionados: string[]
}

export interface InformeImportacion {
  archivo: string
  nuevas: number
  actualizadas: number
  adjuntos: number
  vinculos: number
  porLista: Record<string, number>
  faltantes: string[]
  claves: Record<string, string>
}

export const ACTOR_IMPORTADOR: Ctx = {
  actor: { tipo: 'sistema', id: 'importador-discord', nombre: 'Importador de Discord', cliente: 'npm run importar:discord' },
}

const LISTAS = {
  bandeja: 'Bandeja (Discord)',
  decidir: 'Por decidir',
  hacer: 'Por hacer',
  curso: 'En curso',
  hecho: 'Hecho',
} as const

/**
 * A qué lista va cada ítem. Manda el estado; para lo pendiente, el tipo decide:
 *   hecho                    → Hecho
 *   en la rama sin publicar  → En curso
 *   respondido               → pregunta: Hecho (ya se contestó) · el resto: Por decidir
 *   pendiente                → error: Por hacer · pregunta: Bandeja (falta contestar) · idea, balance, corrección: Por decidir
 *   cualquier otro           → Bandeja (Discord)
 */
export function listaPara(item: Pick<ItemDiscord, 'estado' | 'tipo'>): string {
  const estado = normalizar(item.estado ?? '')
  const tipo = normalizar(item.tipo ?? '')
  const esPregunta = tipo.startsWith('pregunta')
  if (/hecho|resuelto|publicado|listo|cerrado/.test(estado)) return LISTAS.hecho
  if (/rama|curso|haciendo|progreso/.test(estado)) return LISTAS.curso
  if (/respondid|contestad/.test(estado)) return esPregunta ? LISTAS.hecho : LISTAS.decidir
  if (/pendiente|nuevo|abierto/.test(estado) || !estado) {
    if (tipo === 'error' || tipo === 'bug') return LISTAS.hacer
    if (esPregunta) return LISTAS.bandeja
    return LISTAS.decidir
  }
  return LISTAS.bandeja
}

function tipoTarjeta(tipo: string): TipoTarjeta {
  const t = normalizar(tipo)
  if (t === 'error' || t === 'bug') return 'error'
  if (t.startsWith('pregunta')) return 'pregunta'
  if (t.startsWith('correccion')) return 'decision'
  if (t === 'decision') return 'decision'
  if (t === 'tarea') return 'tarea'
  return 'idea'
}

const NOMBRES_TIPO: Record<string, string> = {
  error: 'Error',
  idea: 'Idea',
  'pregunta-mecanica': 'Pregunta de mecánica',
  balance: 'Balance',
  'correccion-de-idea': 'Corrección de idea',
}

const AREAS: Record<string, { nombre: string; color: Color }> = {
  clientes: { nombre: 'Clientes', color: 'azul' },
  'decorar/tienda': { nombre: 'Decorar y tienda', color: 'violeta' },
  economia: { nombre: 'Economía', color: 'verde' },
  empleados: { nombre: 'Empleados', color: 'naranja' },
  barrio: { nombre: 'Barrio', color: 'rosa' },
  eventos: { nombre: 'Eventos', color: 'amarillo' },
  calle: { nombre: 'Calle', color: 'celeste' },
  interfaz: { nombre: 'Interfaz', color: 'lima' },
  visitas: { nombre: 'Visitas', color: 'rojo' },
  otra: { nombre: 'Otros', color: 'gris' },
}

function area(a: string): { nombre: string; color: Color } {
  const clave = normalizar(a.trim())
  if (AREAS[clave]) return AREAS[clave]!
  const nombre = a.trim().charAt(0).toUpperCase() + a.trim().slice(1)
  return { nombre, color: 'gris' }
}

function prioridad(p: string): Prioridad {
  const v = normalizar(p ?? '')
  if (v.startsWith('urg') || v === 'p0') return 'urgente'
  if (v.startsWith('alt') || v === 'p1') return 'alta'
  if (v.startsWith('med') || v === 'p2') return 'media'
  if (v.startsWith('baj') || v === 'p3') return 'baja'
  return 'ninguna'
}

/** "gabituss (#general, 21/11 12:21): «Buenas!…»" → { autor, canal, fecha, texto } */
export function analizarCita(cita: string): CitaDiscord {
  const m = /^(.*?) \((#[^,)]+)(?:, ([^)]*))?\): «([\s\S]*)»\s*$/.exec(cita.trim())
  if (!m) return { autor: '', canal: null, fecha: null, texto: cita.trim() }
  return { autor: m[1]!.trim(), canal: m[2]!.trim(), fecha: m[3]?.trim() ?? null, texto: m[4]!.trim() }
}

function raizRepo(desde: string): string | null {
  let dir = path.resolve(desde)
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, '.git'))) return dir
    const arriba = path.dirname(dir)
    if (arriba === dir) break
    dir = arriba
  }
  return null
}

function resolverAdjunto(ruta: string, archivoJson: string): string | null {
  if (path.isAbsolute(ruta)) return existsSync(ruta) ? ruta : null
  const dirJson = path.dirname(archivoJson)
  const candidatos = [
    path.resolve(dirJson, ruta),
    raizRepo(dirJson) ? path.resolve(raizRepo(dirJson)!, ruta) : null,
    path.resolve(process.cwd(), ruta),
    path.resolve(dirJson, path.basename(ruta)),
    path.resolve(dirJson, 'adjuntos', path.basename(ruta)),
  ].filter(Boolean) as string[]
  return candidatos.find((c) => existsSync(c)) ?? null
}

export function leerArchivoDiscord(ruta: string): ItemDiscord[] {
  if (!existsSync(ruta)) throw new ErrorDominio(`No existe el archivo ${ruta}.`, 404)
  const crudo = JSON.parse(readFileSync(ruta, 'utf8'))
  const items = Array.isArray(crudo) ? crudo : crudo.items ?? crudo.temas ?? crudo.pendientes
  if (!Array.isArray(items)) throw new ErrorDominio('El archivo no tiene una lista de temas.')
  for (const [i, it] of items.entries()) {
    if (!it || typeof it !== 'object' || !it.id || !it.titulo)
      throw new ErrorDominio(`El tema ${i + 1} no tiene id o título.`)
  }
  return items as ItemDiscord[]
}

export async function importarDiscord(
  servicio: Servicio,
  archivo: string,
  opciones: { proyecto?: string; tablero?: string; log?: (m: string) => void } = {},
): Promise<InformeImportacion> {
  const log = opciones.log ?? (() => {})
  const ruta = path.resolve(archivo)
  const items = leerArchivoDiscord(ruta)
  const proyecto = await servicio.resolverProyecto(opciones.proyecto ?? 'RC')
  const tablero = await servicio.resolverTablero(opciones.tablero ?? 'Pendientes', proyecto.id, { vista: 'kanban' })
  const ctx = ACTOR_IMPORTADOR

  // Listas de destino (si falta alguna, se crea).
  const idsListas = new Map<string, string>()
  for (const nombre of Object.values(LISTAS)) {
    try {
      idsListas.set(nombre, (await servicio.resolverLista(tablero.id, nombre)).id)
    } catch {
      const categoria = nombre === LISTAS.hacer ? 'por_hacer' : nombre === LISTAS.curso ? 'en_curso' : nombre === LISTAS.hecho ? 'hecho' : null
      idsListas.set(nombre, (await servicio.crearLista(ctx, { tableroId: tablero.id, nombre, categoria })).id)
    }
  }

  // Etiquetas por área (con color) y por tipo de Discord (neutras).
  for (const it of items) {
    const a = area(it.area ?? 'otra')
    await servicio.asegurarEtiquetas(servicio.db, proyecto.id, [a.nombre], { color: a.color, grupo: 'area' })
    const t = NOMBRES_TIPO[it.tipo] ?? it.tipo
    if (t) await servicio.asegurarEtiquetas(servicio.db, proyecto.id, [t], { color: 'gris', grupo: 'tipo' })
  }

  // Orden: por lista, después por prioridad (alta primero) y por id.
  const ordenados = [...items].sort((x, y) => {
    const px = pesoPrioridad(prioridad(x.prioridad))
    const py = pesoPrioridad(prioridad(y.prioridad))
    return py - px || x.id.localeCompare(y.id, 'es', { numeric: true })
  })

  const informe: InformeImportacion = {
    archivo: ruta,
    nuevas: 0,
    actualizadas: 0,
    adjuntos: 0,
    vinculos: 0,
    porLista: {},
    faltantes: [],
    claves: {},
  }

  for (const it of ordenados) {
    const destino = listaPara(it)
    const a = area(it.area ?? 'otra')
    const etiquetas = [a.nombre, NOMBRES_TIPO[it.tipo] ?? it.tipo].filter(Boolean)
    const discord: DatosDiscord = {
      id: it.id,
      canal: it.canal ?? '',
      autores: it.autores ?? [],
      fechas: it.fechas ?? [],
      citas: (it.citas ?? []).map(analizarCita),
      respuestaSugerida: it.respuesta_sugerida ?? '',
      tipoOriginal: it.tipo ?? '',
      area: it.area ?? '',
      estadoOriginal: it.estado ?? '',
      evidencia: it.evidencia ?? '',
    }
    const autores = it.autores ?? []
    const quienes =
      autores.length > 1 ? `${autores.slice(0, -1).join(', ')} y ${autores.at(-1)}` : (autores[0] ?? '')
    const cuando = (it.fechas ?? [])
      .map((f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }))
      .join(' y ')
    const partes: string[] = []
    if (quienes) partes.push(`${autores.length > 1 ? 'lo trajeron' : 'lo trajo'} ${quienes}`)
    if (it.canal) partes.push(`en ${it.canal}`)
    if (cuando) partes.push(`el ${cuando}`)
    const porque = {
      motivo: it.motivo_prioridad ?? '',
      contexto: `Llegó por Discord${partes.length ? ` (${partes.join(', ')})` : ''}.`,
      evidencias: it.evidencia ? [it.evidencia] : [],
      estado: (destino === LISTAS.hecho || destino === LISTAS.curso ? 'aceptada' : 'abierta') as 'aceptada' | 'abierta',
    }
    const ref = `discord:${it.id}`
    const [existente] = await servicio.db.consulta<{ id: string; clave: string }>(
      `select id, clave from tarjetas where proyecto_id = $1 and ref_externa = $2`,
      [proyecto.id, ref],
    )
    let tarjetaId: string
    if (existente) {
      await servicio.actualizarTarjeta(ctx, existente.id, {
        titulo: it.titulo,
        descripcion: it.descripcion ?? '',
        tipo: tipoTarjeta(it.tipo),
        prioridad: prioridad(it.prioridad),
        agregarEtiquetas: etiquetas,
        campos: { discord },
      })
      await servicio.registrarPorque(ctx, existente.id, porque)
      tarjetaId = existente.id
      informe.actualizadas++
      informe.claves[it.id] = existente.clave
    } else {
      const t = await servicio.crearTarjeta(ctx, {
        tableroId: tablero.id,
        listaId: idsListas.get(destino)!,
        titulo: it.titulo,
        tipo: tipoTarjeta(it.tipo),
        descripcion: it.descripcion ?? '',
        prioridad: prioridad(it.prioridad),
        etiquetas,
        campos: { discord },
        refExterna: ref,
        porque,
      })
      tarjetaId = t.id
      informe.nuevas++
      informe.claves[it.id] = t.clave
      informe.porLista[destino] = (informe.porLista[destino] ?? 0) + 1
      // Adjuntos: se copian a .datos/archivos; la primera imagen queda de portada.
      let primeraImagen = true
      for (const adj of it.adjuntos ?? []) {
        const origen = resolverAdjunto(adj.ruta, ruta)
        if (!origen) {
          informe.faltantes.push(adj.ruta)
          continue
        }
        const esImagen = /\.(png|jpe?g|gif|webp|avif)$/i.test(origen)
        await servicio.agregarAdjunto(
          ctx,
          tarjetaId,
          { nombre: path.basename(origen), rutaOrigen: origen, descripcion: adj.descripcion ?? '' },
          { silencioso: true, comoPortada: esImagen && primeraImagen },
        )
        if (esImagen) primeraImagen = false
        informe.adjuntos++
      }
    }
    log(`${informe.claves[it.id]} ← ${it.id} · ${destino}`)
  }

  // Relacionados → vínculos "se relaciona con" (una sola vez por par).
  const pares = new Set<string>()
  for (const it of items) {
    for (const rel of it.relacionados ?? []) {
      const a = informe.claves[it.id]
      const b = informe.claves[rel]
      if (!a || !b || a === b) continue
      const par = [a, b].sort().join('|')
      if (pares.has(par)) continue
      pares.add(par)
      await servicio.vincular(ctx, a, 'relacionada', b)
      informe.vinculos++
    }
  }
  return informe
}
