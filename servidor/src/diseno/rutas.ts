// API de Diseño (plan 7.2), montada en /api/diseno. `:p` es el prefijo o el id del proyecto.
// Online, todo /api pide una sesión o la clave del MCP (api.ts); la importación pide además la clave (es solo del dueño).
// Cuentas (docs/cuentas.md): `d.servicio()` es el Servicio de la cuenta del pedido, así que `:p` solo encuentra proyectos de
// esa cuenta (los de otra dan 404) y el ServicioDiseno verifica el proyecto en cada método.
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { analizarHtml, serializarHtml, type NodoHtml } from '../../../compartido/diseno/html'
import { esquemaOperacion } from '../../../compartido/diseno/operaciones'
import { medidasDe, PREFIJADOS } from '../../../compartido/diseno/prefijados'
import { TIPOS_ITEM, type TipoItem } from '../../../compartido/diseno/tipos'
import { ErrorDominio, type Ctx, type Servicio } from '../dominio/servicio'
import { leerAlcance } from '../sesion'
import { fotoLocal } from './foto-lienzo'
import { empezarImportacion, esquemaEmpezar, esquemaLote, guardarArchivoImportado, guardarLote, terminarImportacion } from './importar'
import { componerGrilla, renderizar, type EntradaRender, type OpcionesRender } from './render'
import { renderLocalDisponible } from './remoto'
import { disenoDe, sha12, type ServicioDiseno } from './servicio-diseno'
import { recordarOrigen } from './urls'

export interface DepsRutasDiseno {
  servicio: () => Servicio
  /** El Servicio de otra cuenta: solo para el dibujo interno con la cuenta firmada (remoto.ts). */
  servicioDe: (cuenta: string) => Servicio
  ctx: (c: Context) => Promise<Ctx>
  claveValida: (c: Context) => boolean
}

const esquemaTamano = z.union([z.string(), z.object({ ancho: z.number().int(), alto: z.number().int() })])
const tipoItem = z.enum(TIPOS_ITEM as [TipoItem, ...TipoItem[]])

export function rutasDiseno(d: DepsRutasDiseno) {
  const r = new Hono()
  const sd = (): ServicioDiseno => disenoDe(d.servicio())
  const pid = async (c: Context) => (await sd().proyecto(c.req.param('p'))).id as string
  const conClave = (c: Context) => {
    if (!d.claveValida(c)) throw new ErrorDominio('Hace falta la clave del MCP (Authorization: Bearer …).', 401)
  }

  r.use('*', async (c, next) => {
    recordarOrigen(c.req.url)
    await next()
  })

  // ───── la tarjeta: sus diseños (sección "Diseños" del detalle) ─────
  r.get('/_tarjeta/:clave', async (c) => c.json(await sd().disenosDeTarjeta(c.req.param('clave'))))

  // ───── pedidos internos de la función principal a la de render (Vercel) ─────
  r.post('/:p/render-interno', async (c) => {
    conClave(c)
    if (!renderLocalDisponible()) throw new ErrorDominio('Este proceso no dibuja: el pedido tenía que llegar a la función de render.', 503)
    const { entrada, op } = (await c.req.json()) as { entrada: EntradaRender; op: OpcionesRender }
    // Los archivos del dibujo son los de la cuenta firmada (sin firma: los de la clave, 'dueno').
    const firmada = leerAlcance(c.req.header('x-tablero-alcance'))
    const almacen = firmada ? d.servicioDe(firmada).almacen : d.servicio().almacen
    const res = await renderizar(entrada, (ruta) => almacen.leer(ruta), op ?? {})
    return c.json({ ...res, bytes: res.bytes ? Buffer.from(res.bytes).toString('base64') : null })
  })
  // La foto del lienzo (ver_lienzo): la función principal le pide a esta que abra la app en Chromium y la fotografíe.
  r.post('/_/foto-lienzo-interna', async (c) => {
    conClave(c)
    if (!renderLocalDisponible()) throw new ErrorDominio('Este proceso no dibuja: el pedido tenía que llegar a la función de render.', 503)
    const p = z
      .object({ ruta: z.string().startsWith('/').max(400), ancho: z.number().int().min(1).max(4000), alto: z.number().int().min(1).max(4000), tema: z.enum(['claro', 'oscuro']) })
      .parse(await c.req.json())
    const res = await fotoLocal(p)
    return c.json({ ...res, bytes: Buffer.from(res.bytes).toString('base64') })
  })
  r.post('/:p/grilla-interna', async (c) => {
    conClave(c)
    const { imagenes } = (await c.req.json()) as { imagenes: { nombre: string; bytes: string; mime: string; ancho: number; alto: number }[] }
    const g = await componerGrilla(imagenes.map((i) => ({ ...i, bytes: new Uint8Array(Buffer.from(i.bytes, 'base64')) })))
    return c.json({ bytes: Buffer.from(g.bytes).toString('base64'), ancho: g.ancho, alto: g.alto })
  })

  // ───── resumen y páginas ─────
  r.get('/:p', async (c) => c.json(await sd().resumen(c.req.param('p'))))
  r.get('/:p/prefijados', async (c) => c.json({ prefijados: PREFIJADOS, delProyecto: await sd().prefijadosDe(await pid(c)) }))
  r.post('/:p/paginas', async (c) => {
    const b = z.object({ nombre: z.string().min(1), tipo: z.enum(['lienzo']).optional() }).parse(await c.req.json())
    return c.json(await sd().crearPagina(await d.ctx(c), await pid(c), b), 201)
  })
  r.get('/:p/paginas/:pagina', async (c) => c.json(await sd().leerPagina(await pid(c), c.req.param('pagina'))))
  r.patch('/:p/paginas/:pagina', async (c) => {
    const b = z.object({ nombre: z.string().min(1).optional(), archivada: z.boolean().optional(), orden: z.string().optional() }).parse(await c.req.json())
    return c.json(await sd().actualizarPagina(await d.ctx(c), await pid(c), c.req.param('pagina'), b))
  })
  r.post('/:p/paginas/:pagina/ordenar', async (c) => c.json({ marcos: await sd().ordenarPagina(await d.ctx(c), await pid(c), c.req.param('pagina')) }))

  // ───── marcos ─────
  r.get('/:p/marcos/:id', async (c) => {
    const p = await pid(c)
    const m = await sd().resolverMarco(p, c.req.param('id'), { conArchivados: true })
    const entrada = await sd().dibujable(p, m)
    const tarjetas = await sd().vinculosDe(p, `marco:${m.id}`)
    return c.json({ marco: m, hojas: entrada.hojas, piezas: entrada.piezas, tarjetas })
  })
  r.post('/:p/marcos', async (c) => {
    const b = z
      .object({
        pagina: z.string().min(1),
        nombre: z.string().min(1),
        tamano: esquemaTamano.optional(),
        ancho: z.number().int().optional(),
        alto: z.number().int().optional(),
        html: z.string().optional(),
        css: z.string().optional(),
        hojas: z.array(z.string()).optional(),
        seccion: z.string().optional(),
        grupo: z.string().nullable().optional(),
        datos: z.record(z.string(), z.unknown()).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        plantilla: z.string().optional(),
        ranuras: z.record(z.string(), z.string()).optional(),
        tarjetas: z.array(z.string()).optional(),
      })
      .parse(await c.req.json())
    const p = await pid(c)
    let { html, css, hojas } = b
    let ancho = b.ancho
    let alto = b.alto
    if (b.plantilla) {
      const pl = await sd().item(p, 'plantilla', b.plantilla)
      const dp = pl.datos as { html: string; css: string; hojas: string[]; ancho: number; alto: number }
      html = rellenarRanuras(dp.html, b.ranuras ?? {})
      css = dp.css
      hojas = dp.hojas
      ancho ??= dp.ancho
      alto ??= dp.alto
    }
    if (b.tamano) {
      const m = medidasDe(b.tamano, await sd().prefijadosDe(p))
      if (!m) throw new ErrorDominio(`No entiendo el tamaño «${JSON.stringify(b.tamano)}».`)
      ancho = m.ancho
      alto = m.alto
      b.datos = { ...(b.datos ?? {}), prefijado: m.prefijado ?? undefined }
    }
    if (!ancho || !alto) throw new ErrorDominio('Falta el tamaño (tamano, o ancho y alto).')
    const res = await sd().crearMarco(await d.ctx(c), p, { ...b, html, css, hojas, ancho, alto, datos: b.datos as never })
    return c.json(res, 201)
  })
  r.patch('/:p/marcos/:id', async (c) => {
    const b = z
      .object({
        nombre: z.string().min(1).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        ancho: z.number().optional(),
        alto: z.number().optional(),
        seccion: z.string().optional(),
        grupo: z.string().nullable().optional(),
        datos: z.record(z.string(), z.unknown()).optional(),
        html: z.string().optional(),
        css: z.string().optional(),
        bloqueado: z.boolean().optional(),
        revision: z.number().int().optional(),
      })
      .parse(await c.req.json())
    return c.json(await sd().actualizarMarco(await d.ctx(c), await pid(c), c.req.param('id'), b as never))
  })
  r.post('/:p/marcos/:id/operaciones', async (c) => {
    const b = z.object({ operaciones: z.array(esquemaOperacion).min(1).max(200), revision: z.number().int().optional() }).parse(await c.req.json())
    return c.json(await sd().editarMarco(await d.ctx(c), await pid(c), c.req.param('id'), b.operaciones, { revision: b.revision }))
  })
  r.post('/:p/marcos/:id/duplicar', async (c) => {
    const b = z
      .object({
        pagina: z.string().optional(),
        nombre: z.string().optional(),
        tamanos: z.array(esquemaTamano).max(12).optional(),
        seccion: z.string().optional(),
      })
      .parse(await c.req.json().catch(() => ({})))
    return c.json(await sd().duplicarMarco(await d.ctx(c), await pid(c), c.req.param('id'), b), 201)
  })
  r.post('/:p/marcos/:id/archivar', async (c) => {
    const b = z.object({ archivar: z.boolean().default(true) }).parse(await c.req.json().catch(() => ({})))
    return c.json(await sd().archivarMarco(await d.ctx(c), await pid(c), c.req.param('id'), b.archivar))
  })
  r.post('/:p/marcos/:id/restaurar', async (c) => {
    const b = z.object({ n: z.number().int().min(1) }).parse(await c.req.json())
    return c.json(await sd().editarMarco(await d.ctx(c), await pid(c), c.req.param('id'), [{ op: 'restaurar', revision: b.n }]))
  })
  r.get('/:p/marcos/:id/revisiones', async (c) => c.json(await sd().revisiones(await pid(c), c.req.param('id'))))
  r.get('/:p/marcos/:id/render', async (c) => {
    const p = await pid(c)
    const q = c.req.query()
    const formato = (['png', 'jpg', 'svg', 'webp'].includes(q.formato ?? '') ? q.formato : 'png') as 'png' | 'jpg' | 'svg' | 'webp'
    const escala = Math.min(4, Math.max(0.1, Number(q.escala) || 1))
    const res = await sd().render(p, c.req.param('id'), {
      formato,
      escala,
      capa: q.capa || undefined,
      modo: q.modo || undefined,
      sinFondo: q.sin_fondo === '1' || q.sin_fondo === 'true',
      estados: q.estados === '1',
      sobre: (q.sobre as 'claro' | 'oscuro' | undefined) || undefined,
    })
    const headers: Record<string, string> = {
      'Content-Type': res.mime,
      'Cache-Control': 'private, max-age=30',
      'X-Content-Type-Options': 'nosniff',
      'X-Telar-Avisos': encodeURIComponent(JSON.stringify(res.avisos.slice(0, 20))),
    }
    if (q.descargar) {
      const pg = await sd().resolverPagina(p, res.marco.paginaId)
      headers['Content-Disposition'] = `attachment; filename="${sd().nombreDeExporte(pg.nombre, res.marco, escala, formato)}"`
    }
    if (formato === 'svg') headers['Content-Security-Policy'] = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"
    return new Response(res.bytes as BodyInit, { headers })
  })
  r.get('/:p/marcos/:id/miniatura', async (c) => {
    const m = await sd().miniatura(await pid(c), c.req.param('id'))
    return new Response(m.datos as BodyInit, {
      headers: { 'Content-Type': m.mime, 'Cache-Control': c.req.query('r') ? 'private, max-age=31536000, immutable' : 'private, max-age=10', 'X-Content-Type-Options': 'nosniff' },
    })
  })

  // ───── ítems del sistema ─────
  r.get('/:p/items', async (c) => {
    const q = c.req.query()
    const tipo = q.tipo ? tipoItem.parse(q.tipo) : undefined
    return c.json(await sd().items(await pid(c), { tipo, grupo: q.grupo || undefined, q: q.q || undefined, desde: Number(q.desde) || 0, limite: Number(q.limite) || 200 }))
  })
  r.get('/:p/items/:tipo/:clave{.+}', async (c) => c.json(await sd().item(await pid(c), tipoItem.parse(c.req.param('tipo')), decodeURIComponent(c.req.param('clave')))))
  r.put('/:p/items/:tipo/:clave{.+}', async (c) => {
    const b = z.object({ nombre: z.string().optional(), grupo: z.string().optional(), datos: z.record(z.string(), z.unknown()) }).parse(await c.req.json())
    const res = await sd().guardarItem(await d.ctx(c), await pid(c), tipoItem.parse(c.req.param('tipo')), decodeURIComponent(c.req.param('clave')), b)
    return c.json(res)
  })
  r.post('/:p/items/archivar', async (c) => {
    const b = z.object({ tipo: tipoItem, clave: z.string(), archivar: z.boolean().default(true) }).parse(await c.req.json())
    await sd().archivarItem(await d.ctx(c), await pid(c), b.tipo, b.clave, b.archivar)
    return c.json({ ok: true })
  })
  r.post('/:p/tokens', async (c) => {
    const b = z
      .object({
        tokens: z.array(z.object({ nombre: z.string(), clase: z.string().optional(), valor: z.string(), modos: z.record(z.string(), z.string()).optional(), alias: z.string().optional(), uso: z.string().optional() })).optional(),
        estilos: z
          .array(z.object({ nombre: z.string(), familia: z.string(), peso: z.number().optional(), tamano: z.string(), interlineado: z.string().optional(), espaciado: z.string().optional(), mayusculas: z.boolean().optional(), color: z.string().optional() }))
          .optional(),
      })
      .parse(await c.req.json())
    return c.json({ lineas: await sd().definirTokens(await d.ctx(c), await pid(c), b) })
  })
  r.post('/:p/piezas', async (c) => {
    const b = z
      .object({
        nombre: z.string().min(1),
        clase: z.enum(['pieza', 'plantilla']).optional(),
        html: z.string().optional(),
        css: z.string().optional(),
        propiedades: z.array(z.object({ nombre: z.string(), clase: z.enum(['variante', 'texto', 'booleano', 'imagen']), valores: z.array(z.string()).optional(), defecto: z.union([z.string(), z.boolean()]) })).optional(),
        desde: z.object({ marco: z.string(), capa: z.string().optional() }).optional(),
        tamano: esquemaTamano.optional(),
      })
      .parse(await c.req.json())
    return c.json(await sd().definirPieza(await d.ctx(c), await pid(c), b), 201)
  })
  r.get('/:p/css/tokens.css', async (c) => {
    const css = await sd().cssTokens(await pid(c))
    // import estático: un import() de un módulo propio hace que esbuild envuelva medio servidor (zod incluido) y la función
    // de Vercel se caía al arrancar ("ZodLazy is not a constructor")
    const etag = `"${sha12(css)}"`
    if (c.req.header('if-none-match') === etag) return c.body(null, 304)
    return c.body(css, 200, { 'Content-Type': 'text/css; charset=utf-8', ETag: etag, 'Cache-Control': 'private, no-cache' })
  })
  r.post('/:p/activos', async (c) => {
    const form = await c.req.formData()
    const archivo = form.get('archivo')
    if (!(archivo instanceof File)) throw new ErrorDominio('Falta el archivo.')
    const res = await sd().subirActivo(await d.ctx(c), await pid(c), {
      nombre: String(form.get('nombre') || archivo.name || 'imagen'),
      grupo: String(form.get('grupo') || '') || undefined,
      bytes: new Uint8Array(await archivo.arrayBuffer()),
      mime: archivo.type,
      archivo: archivo.name,
      familia: String(form.get('familia') || '') || undefined,
      pesos: String(form.get('pesos') || '') || undefined,
    })
    return c.json(res, 201)
  })

  // ───── notas, comentarios, vínculos ─────
  r.get('/:p/notas', async (c) => {
    const o = c.req.queries('objetivo')
    return c.json(await sd().notas(await pid(c), o))
  })
  r.put('/:p/notas', async (c) => {
    const b = z
      .object({ objetivo: z.string(), nombrePropio: z.string().nullable().optional(), uso: z.string().nullable().optional(), nota: z.string().nullable().optional(), estado: z.enum(['vigente', 'revisar', 'viejo']).nullable().optional() })
      .parse(await c.req.json())
    return c.json(await sd().guardarNota(await d.ctx(c), await pid(c), b.objetivo, b))
  })
  r.get('/:p/comentarios', async (c) => c.json(await sd().comentarios(await pid(c), { objetivo: c.req.query('objetivo') || undefined, abiertos: c.req.query('abiertos') === '1' })))
  r.post('/:p/comentarios', async (c) => {
    const b = z.object({ en: z.string().optional(), texto: z.string().min(1), punto: z.object({ x: z.number(), y: z.number() }).optional(), respondeA: z.string().optional() }).parse(await c.req.json())
    return c.json(await sd().comentar(await d.ctx(c), await pid(c), b), 201)
  })
  r.patch('/:p/comentarios/:id', async (c) => {
    const b = z.object({ resuelto: z.boolean().optional(), texto: z.string().optional() }).parse(await c.req.json())
    return c.json(await sd().actualizarComentario(await d.ctx(c), await pid(c), c.req.param('id'), b))
  })
  r.get('/:p/vinculos', async (c) => c.json(await sd().vinculosDe(await pid(c), c.req.query('objetivo') ?? '')))
  r.put('/:p/vinculos', async (c) => {
    const b = z.object({ objetivo: z.string(), tarjeta: z.string() }).parse(await c.req.json())
    return c.json(await sd().vincular(await d.ctx(c), await pid(c), b.objetivo, b.tarjeta))
  })
  r.delete('/:p/vinculos', async (c) => {
    const b = z.object({ objetivo: z.string(), tarjeta: z.string() }).parse(await c.req.json())
    return c.json(await sd().vincular(await d.ctx(c), await pid(c), b.objetivo, b.tarjeta, { quitar: true }))
  })
  r.post('/:p/proponer', async (c) => {
    const b = z.object({ objetivo: z.string(), propuesto: z.string().optional(), porque: z.string().optional() }).parse(await c.req.json())
    return c.json(await proponerCambio(sd(), d.servicio(), await d.ctx(c), await pid(c), b), 201)
  })

  // ───── búsqueda, configuración, importación ─────
  r.get('/:p/buscar', async (c) => c.json(await sd().buscar(await pid(c), c.req.query('q') ?? '', { en: (c.req.query('en') as never) || undefined, limite: Number(c.req.query('limite')) || 40 })))
  r.get('/:p/config', async (c) => {
    const cfg = await sd().config(await pid(c))
    return c.json({ perfil: cfg.perfil, importacion: cfg.importacion, importadoEn: cfg.importado_en, origen: cfg.origen, pedidoEn: cfg.pedido_en })
  })
  r.put('/:p/config', async (c) => {
    const b = z.object({ perfil: z.unknown().optional(), pedir: z.boolean().optional(), hecho: z.boolean().optional() }).parse(await c.req.json())
    const cfg = await sd().guardarConfig(await d.ctx(c), await pid(c), b)
    return c.json({ pedidoEn: cfg.pedido_en, importacion: cfg.importacion })
  })
  r.get('/:p/importaciones', async (c) => c.json(await sd().importaciones(await pid(c))))
  r.post('/:p/importar/empezar', async (c) => {
    conClave(c)
    return c.json(await empezarImportacion(sd(), importador(c), await pid(c), esquemaEmpezar.parse(await c.req.json())))
  })
  r.post('/:p/importar/archivo', async (c) => {
    conClave(c)
    const form = await c.req.formData()
    const archivo = form.get('archivo')
    if (!(archivo instanceof File)) throw new ErrorDominio('Falta el archivo.')
    if (archivo.size > 4 * 1024 * 1024) throw new ErrorDominio('Cada archivo pesa hasta 4 MB.', 413)
    return c.json(await guardarArchivoImportado(sd(), await pid(c), String(form.get('ruta') ?? ''), new Uint8Array(await archivo.arrayBuffer())), 201)
  })
  r.post('/:p/importar/lote', async (c) => {
    conClave(c)
    return c.json(await guardarLote(sd(), await pid(c), esquemaLote.parse(await c.req.json())))
  })
  r.post('/:p/importar/terminar', async (c) => {
    conClave(c)
    const b = z.object({ n: z.number().int() }).parse(await c.req.json())
    return c.json(await terminarImportacion(sd(), importador(c), await pid(c), b.n))
  })
  return r
}

function importador(c: Context): Ctx {
  const quien = c.req.header('x-tablero-autor')
  return { actor: { tipo: 'sistema', id: 'importador-diseno', nombre: quien || 'Importador de Diseño', cliente: 'npm run diseno:importar' } }
}

/** Una plantilla con sus ranuras: {{titulo}} → texto (escapado), {{foto}} en src → ruta. */
/**
 * Las ranuras de una plantilla ({{titulo}}, {{foto}}): sobre el árbol, no sobre el texto, así cada valor queda bien escapado
 * donde cae — en un texto, en un atributo o adentro del JSON de data-props (donde unas comillas romperían las propiedades).
 */
export function rellenarRanuras(html: string, ranuras: Record<string, string>): string {
  const cambiar = (t: string) => t.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_x, n: string) => ranuras[n] ?? '')
  const raiz = analizarHtml(html)
  const bajar = (n: NodoHtml) => {
    if (n.tipo === 'tx') {
      if (n.texto.includes('{{')) n.texto = cambiar(n.texto)
      return
    }
    for (const a of n.attrs) {
      if (!a[1].includes('{{')) continue
      if (a[0] === 'data-props') {
        try {
          const props = JSON.parse(a[1]) as Record<string, unknown>
          for (const [k, v] of Object.entries(props)) if (typeof v === 'string') props[k] = cambiar(v)
          a[1] = JSON.stringify(props)
          continue
        } catch {
          // no es JSON: se reemplaza como texto
        }
      }
      a[1] = cambiar(a[1])
    }
    for (const h of n.hijos) bajar(h)
  }
  for (const h of raiz.hijos) bajar(h)
  return serializarHtml(raiz.hijos)
}

/** "Proponer un cambio": una tarjeta de decisión con el valor de hoy, el propuesto y el porqué, vinculada al ítem o marco. */
export async function proponerCambio(sd: ServicioDiseno, s: Servicio, ctx: Ctx, pid: string, b: { objetivo: string; propuesto?: string; porque?: string }) {
  const o = await sd.objetivoValido(pid, b.objetivo)
  let hoy = ''
  let titulo = `Diseño: cambiar ${o.nombre}`
  let que = o.nombre
  let url = await sd.url(pid, null, null)
  if (o.objetivo.startsWith('item:')) {
    const [, tipo, ...c] = o.objetivo.split(':')
    const it = await sd.item(pid, tipo as TipoItem, c.join(':'))
    const dd = it.datos as { valor?: string; css?: string; ruta?: string; claveOriginal?: string }
    hoy = dd.valor ?? dd.ruta ?? ''
    const nombre = dd.css || dd.claveOriginal || it.clave
    // sin comillas invertidas en el título (no es Markdown); en la descripción, como código (si no, "--" se vuelve "–")
    titulo = `Diseño: cambiar ${nombre}`
    que = `\`${nombre}\` (${({ token: 'token', color_suelto: 'color suelto', estilo_texto: 'estilo de texto', activo: 'activo', fuente: 'fuente', texto: 'texto', pieza: 'pieza', plantilla: 'plantilla', hoja: 'hoja' } as Record<string, string>)[tipo!] ?? tipo})`
    // el enlace lleva a la página que muestra el ítem, con el ítem elegido
    const pg = (await sd.paginas(pid)).find((p) => p.datos.tipos?.includes(tipo as TipoItem))
    url = await sd.url(pid, pg?.slug ?? null, `item:${tipo}:${it.clave}`)
  } else if (o.marco) url = await sd.url(pid, (await sd.resolverPagina(pid, o.marco.paginaId)).slug, o.objetivo.slice(6).replace('#', '.'))
  const tablero = await sd.tableroDe(pid)
  if (!tablero.id) throw new ErrorDominio('El proyecto no tiene tableros para la tarjeta.', 409)
  const t = await s.crearTarjeta(ctx, {
    tableroId: tablero.id,
    titulo,
    tipo: 'decision',
    descripcion: [`**Qué:** ${que}`, hoy && `**Hoy:** \`${hoy}\``, b.propuesto && `**Propuesto:** \`${b.propuesto}\``, `**Dónde:** ${url}`].filter(Boolean).join('\n\n'),
    porque: { motivo: b.porque ?? '', estado: 'propuesta' },
  })
  await sd.vincular(ctx, pid, o.objetivo, t.clave, { silencioso: true })
  return { clave: t.clave, id: t.id, titulo }
}
