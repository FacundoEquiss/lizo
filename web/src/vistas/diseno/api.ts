// Llamadas a /api/diseno (servidor/src/diseno/rutas.ts).
import type { HojaParaDocumento } from '../../../../compartido/diseno/documento'
import type { OperacionMarco } from '../../../../compartido/diseno/operaciones'
import type { Prefijado } from '../../../../compartido/diseno/prefijados'
import type {
  ComentarioDiseno,
  DatosPieza,
  ImportacionDiseno,
  ItemDiseno,
  Marco,
  MarcoResumen,
  NotaDiseno,
  PaginaDiseno,
  ResumenDiseno,
  TipoItem,
} from '../../../../compartido/diseno/tipos'
import { clienteId, ErrorApi } from '../../estado/api'
import { sesionVencida } from '../../estado/sesion'

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const esForm = cuerpo instanceof FormData
  let r: Response
  try {
    r = await fetch(`/api/diseno${ruta}`, {
      method: metodo,
      headers: { 'x-tablero-cliente': clienteId, ...(cuerpo !== undefined && !esForm ? { 'content-type': 'application/json' } : {}) },
      body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
    })
  } catch {
    throw new ErrorApi('No hay conexión con el servidor de Telar.', 0)
  }
  const texto = await r.text()
  let datos: any = null
  try {
    datos = texto ? JSON.parse(texto) : null
  } catch {
    datos = texto
  }
  if (r.status === 401 && datos?.entrar) sesionVencida()
  if (!r.ok) throw new ErrorApi(datos?.error ?? `Error ${r.status}`, r.status)
  return datos as T
}

const e = encodeURIComponent

export interface MarcoCompleto {
  marco: Marco
  hojas: HojaParaDocumento[]
  piezas: Record<string, DatosPieza>
  tarjetas: VinculoTarjeta[]
}
export interface VinculoTarjeta {
  clave: string
  titulo: string
  tipo: string
  lista: string | null
  categoria: string | null
}
export interface ResultadoEdicion {
  marco: Marco
  lineas: string[]
  creadas: string[]
  avisos: string[]
  revisionAntes: number
}
export interface ResultadoBusquedaDiseno {
  tipo: string
  id: string
  nombre: string
  detalle: string
  pagina?: string
  marco?: string
  capa?: string
  itemTipo?: TipoItem
}

export const apiDiseno = {
  resumen: (p: string) => pedir<ResumenDiseno>('GET', `/${e(p)}`),
  pagina: (p: string, pagina: string) => pedir<{ pagina: PaginaDiseno; marcos: MarcoResumen[] }>('GET', `/${e(p)}/paginas/${e(pagina)}`),
  crearPagina: (p: string, nombre: string) => pedir<PaginaDiseno>('POST', `/${e(p)}/paginas`, { nombre }),
  actualizarPagina: (p: string, pagina: string, datos: { nombre?: string; archivada?: boolean; orden?: string }) => pedir<PaginaDiseno>('PATCH', `/${e(p)}/paginas/${e(pagina)}`, datos),
  ordenarPagina: (p: string, pagina: string) => pedir<{ marcos: number }>('POST', `/${e(p)}/paginas/${e(pagina)}/ordenar`, {}),
  marco: (p: string, id: string) => pedir<MarcoCompleto>('GET', `/${e(p)}/marcos/${e(id)}`),
  crearMarco: (p: string, datos: Record<string, unknown>) => pedir<{ marco: Marco; avisos: string[] }>('POST', `/${e(p)}/marcos`, datos),
  actualizarMarco: (p: string, id: string, datos: Record<string, unknown>) => pedir<Marco>('PATCH', `/${e(p)}/marcos/${e(id)}`, datos),
  operaciones: (p: string, id: string, operaciones: OperacionMarco[], revision?: number) =>
    pedir<ResultadoEdicion>('POST', `/${e(p)}/marcos/${e(id)}/operaciones`, { operaciones, revision }),
  duplicar: (p: string, id: string, datos: { pagina?: string; tamanos?: (string | { ancho: number; alto: number })[]; nombre?: string } = {}) =>
    pedir<Marco[]>('POST', `/${e(p)}/marcos/${e(id)}/duplicar`, datos),
  archivarMarco: (p: string, id: string, archivar = true) => pedir<Marco>('POST', `/${e(p)}/marcos/${e(id)}/archivar`, { archivar }),
  restaurar: (p: string, id: string, n: number) => pedir<ResultadoEdicion>('POST', `/${e(p)}/marcos/${e(id)}/restaurar`, { n }),
  revisiones: (p: string, id: string) =>
    pedir<{ actual: number; revisiones: { n: number; actor: { nombre: string } | null; resumen: string; creadoEn: string; ancho: number; alto: number }[] }>('GET', `/${e(p)}/marcos/${e(id)}/revisiones`),
  items: (p: string, f: { tipo?: TipoItem; grupo?: string; q?: string; desde?: number; limite?: number } = {}) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') qs.set(k, String(v))
    return pedir<{ items: ItemDiseno[]; total: number; siguiente: number | null }>('GET', `/${e(p)}/items?${qs}`)
  },
  item: (p: string, tipo: TipoItem, clave: string) => pedir<ItemDiseno>('GET', `/${e(p)}/items/${tipo}/${e(clave)}`),
  guardarItem: (p: string, tipo: TipoItem, clave: string, datos: { nombre?: string; grupo?: string; datos: Record<string, unknown> }) =>
    pedir<{ creado: boolean }>('PUT', `/${e(p)}/items/${tipo}/${e(clave)}`, datos),
  archivarItem: (p: string, tipo: TipoItem, clave: string, archivar = true) => pedir<{ ok: true }>('POST', `/${e(p)}/items/archivar`, { tipo, clave, archivar }),
  definirTokens: (p: string, datos: { tokens?: unknown[]; estilos?: unknown[] }) => pedir<{ lineas: string[] }>('POST', `/${e(p)}/tokens`, datos),
  definirPieza: (p: string, datos: Record<string, unknown>) => pedir<{ clave: string; tipo: string }>('POST', `/${e(p)}/piezas`, datos),
  cssTokens: async (p: string) => {
    const r = await fetch(`/api/diseno/${e(p)}/css/tokens.css`, { headers: { 'x-tablero-cliente': clienteId } })
    return r.ok ? r.text() : ''
  },
  subirActivo: (p: string, archivo: File, extra: { nombre?: string; grupo?: string; familia?: string; pesos?: string } = {}) => {
    const f = new FormData()
    f.append('archivo', archivo)
    for (const [k, v] of Object.entries(extra)) if (v) f.append(k, v)
    return pedir<{ tipo: string; clave: string; ruta: string; ancho?: number; alto?: number }>('POST', `/${e(p)}/activos`, f)
  },
  notas: (p: string, objetivos: string[]) => pedir<NotaDiseno[]>('GET', `/${e(p)}/notas?${objetivos.map((o) => `objetivo=${e(o)}`).join('&')}`),
  guardarNota: (p: string, datos: { objetivo: string; nombrePropio?: string | null; uso?: string | null; nota?: string | null; estado?: NotaDiseno['estado'] }) =>
    pedir<NotaDiseno>('PUT', `/${e(p)}/notas`, datos),
  comentarios: (p: string, objetivo?: string) => pedir<ComentarioDiseno[]>('GET', `/${e(p)}/comentarios${objetivo ? `?objetivo=${e(objetivo)}` : ''}`),
  comentar: (p: string, datos: { en?: string; texto: string; punto?: { x: number; y: number }; respondeA?: string }) => pedir<ComentarioDiseno>('POST', `/${e(p)}/comentarios`, datos),
  actualizarComentario: (p: string, id: string, datos: { resuelto?: boolean; texto?: string }) => pedir<ComentarioDiseno>('PATCH', `/${e(p)}/comentarios/${e(id)}`, datos),
  vinculos: (p: string, objetivo: string) => pedir<VinculoTarjeta[]>('GET', `/${e(p)}/vinculos?objetivo=${e(objetivo)}`),
  vincular: (p: string, objetivo: string, tarjeta: string) => pedir<{ objetivo: string; tarjeta: string }>('PUT', `/${e(p)}/vinculos`, { objetivo, tarjeta }),
  desvincular: (p: string, objetivo: string, tarjeta: string) => pedir<{ objetivo: string; tarjeta: string }>('DELETE', `/${e(p)}/vinculos`, { objetivo, tarjeta }),
  proponer: (p: string, datos: { objetivo: string; propuesto?: string; porque?: string }) => pedir<{ clave: string; titulo: string }>('POST', `/${e(p)}/proponer`, datos),
  buscar: (p: string, q: string) => pedir<ResultadoBusquedaDiseno[]>('GET', `/${e(p)}/buscar?q=${e(q)}`),
  config: (p: string, datos: { pedir?: boolean; hecho?: boolean }) => pedir<{ pedidoEn: string | null }>('PUT', `/${e(p)}/config`, datos),
  importaciones: (p: string) => pedir<ImportacionDiseno[]>('GET', `/${e(p)}/importaciones`),
  prefijados: (p: string) => pedir<{ prefijados: Prefijado[]; delProyecto: Prefijado[] }>('GET', `/${e(p)}/prefijados`),
  disenosDeTarjeta: (clave: string) =>
    pedir<{ id: string; nombre: string; ancho: number; alto: number; revision: number; pagina: string; paginaNombre: string; miniatura: string; prefijo: string }[]>(
      'GET',
      `/_tarjeta/${e(clave)}`,
    ),
}

export const urlMiniatura = (prefijo: string, m: { id: string; revision: number }) => `/api/diseno/${e(prefijo)}/marcos/${e(m.id)}/miniatura?r=${m.revision}`
export const urlRender = (prefijo: string, id: string, o: { formato?: string; escala?: number; sinFondo?: boolean; descargar?: boolean } = {}) =>
  `/api/diseno/${e(prefijo)}/marcos/${e(id)}/render?formato=${o.formato ?? 'png'}&escala=${o.escala ?? 1}${o.sinFondo ? '&sin_fondo=1' : ''}${o.descargar ? '&descargar=1' : ''}`
