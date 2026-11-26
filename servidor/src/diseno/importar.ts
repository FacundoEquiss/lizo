// Importación del sistema de diseño de un proyecto (plan 5.5). Lo arma `npm run diseno:importar` donde está el repo y lo
// sube en cuatro pasos, con la clave (cada pedido < 4 MB, el límite de Vercel):
//   empezar → { n, faltan }   ·   archivo (de a uno, solo los que faltan)   ·   lote (ítems, páginas, marcos)   ·   terminar
// Nada se ve hasta terminar: ahí, en una transacción, se compara por hash con lo vigente, se guarda la lista de cambios y
// se reemplaza lo importado. Lo propio y las notas no se tocan. Lo que desaparece del código se archiva (si vuelve, recupera
// sus comentarios, notas y vínculos).
import { z } from 'zod'
import { acomodar } from '../../../compartido/diseno/acomodar'
import type { CambioImportacion, DatosMarco, OrigenImportacion, TipoItem } from '../../../compartido/diseno/tipos'
import { TIPOS_ITEM } from '../../../compartido/diseno/tipos'
import { mimeDeExtension } from '../../../compartido/diseno/imagen'
import { ErrorDominio, type Ctx } from '../dominio/servicio'
import { sanearCss, sanearHtml, sanearSvg } from './sanear'
import { sha12, type ServicioDiseno } from './servicio-diseno'

const j = (v: unknown) => JSON.stringify(v ?? null)

export const esquemaEmpezar = z.object({
  origen: z.record(z.string(), z.unknown()).default({}),
  archivos: z.array(z.object({ ruta: z.string(), hash: z.string(), peso: z.number().optional() })).max(20000).default([]),
})

const esquemaItem = z.object({
  tipo: z.enum(TIPOS_ITEM as [TipoItem, ...TipoItem[]]),
  clave: z.string().min(1).max(300),
  nombre: z.string().max(300),
  grupo: z.string().max(200).default(''),
  orden: z.string().max(40).optional(),
  datos: z.record(z.string(), z.unknown()),
})
const esquemaPaginaImp = z.object({
  nombre: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  tipo: z.enum(['lienzo', 'sistema', 'tabla']),
  datos: z.record(z.string(), z.unknown()).default({}),
  orden: z.string().optional(),
})
const esquemaMarcoImp = z.object({
  clave: z.string().min(1).max(200),
  pagina: z.string().min(1),
  nombre: z.string().min(1),
  seccion: z.string().default(''),
  ancho: z.number().int().min(16).max(8192),
  alto: z.number().int().min(16).max(8192),
  html: z.string(),
  css: z.string().default(''),
  hojas: z.array(z.string()).default([]),
  datos: z.record(z.string(), z.unknown()).default({}),
  miniatura: z.string().nullable().optional(),
})
export const esquemaLote = z.object({
  n: z.number().int().min(1),
  items: z.array(esquemaItem).default([]),
  paginas: z.array(esquemaPaginaImp).default([]),
  marcos: z.array(esquemaMarcoImp).default([]),
})

const RUTA_ARCHIVO = /^[a-f0-9]{12}\.(png|webp|jpg|jpeg|gif|svg|avif|woff2|woff|ttf|otf|css)$/

export async function empezarImportacion(sd: ServicioDiseno, ctx: Ctx, pid: string, d: z.infer<typeof esquemaEmpezar>) {
  await sd.asegurar(pid)
  // una importación a medio subir de antes se descarta
  await sd.db.consulta(`update diseno_importaciones set estado = 'descartada' where proyecto_id = $1 and estado = 'subiendo'`, [pid])
  const [u] = await sd.db.consulta(`select coalesce(max(n), 0)::int as n from diseno_importaciones where proyecto_id = $1`, [pid])
  const n = Number(u?.n ?? 0) + 1
  await sd.db.consulta(`delete from diseno_paso where proyecto_id = $1`, [pid])
  await sd.db.consulta(`insert into diseno_importaciones (proyecto_id, n, estado, origen, actor) values ($1, $2, 'subiendo', $3::jsonb, $4::jsonb)`, [pid, n, j(d.origen), j(ctx.actor)])
  const rutas = d.archivos.filter((a) => RUTA_ARCHIVO.test(a.ruta)).map((a) => ({ ...a, completa: `diseno/${pid}/${a.ruta}` }))
  const faltan: string[] = []
  if (sd.almacen.tipo === 'base') {
    const hay = new Set<string>()
    for (let i = 0; i < rutas.length; i += 500) {
      const filas = await sd.db.consulta(`select ruta from archivos where ruta = any($1::text[])`, [rutas.slice(i, i + 500).map((r) => r.completa)])
      for (const f of filas) hay.add(f.ruta)
    }
    for (const r of rutas) if (!hay.has(r.completa)) faltan.push(r.hash)
  } else {
    for (const r of rutas) if (!(await sd.almacen.leer(r.completa))) faltan.push(r.hash)
  }
  return { n, faltan }
}

export async function guardarArchivoImportado(sd: ServicioDiseno, pid: string, ruta: string, datos: Uint8Array) {
  if (!RUTA_ARCHIVO.test(ruta)) throw new ErrorDominio(`Ruta de archivo inválida: «${ruta}» (tiene que ser <sha1-12>.<ext>, con ext png, webp, jpg, gif, svg, woff2 o css).`)
  const hash = sha12(datos)
  if (!ruta.startsWith(hash)) throw new ErrorDominio(`El archivo no coincide con su nombre (${ruta}, y su sha1 empieza con ${hash}).`)
  const ext = ruta.split('.').pop()!
  if (ext === 'svg') sanearSvg(new TextDecoder().decode(datos))
  if (ext === 'css') sanearCss(new TextDecoder().decode(datos), { tope: 3 * 1024 * 1024, que: ruta })
  await sd.almacen.guardar(`diseno/${pid}/${ruta}`, datos, mimeDeExtension(ext))
  return { ok: true, ruta: `/archivos/diseno/${pid}/${ruta}` }
}

export async function guardarLote(sd: ServicioDiseno, pid: string, d: z.infer<typeof esquemaLote>) {
  const [imp] = await sd.db.consulta(`select estado from diseno_importaciones where proyecto_id = $1 and n = $2`, [pid, d.n])
  if (!imp || imp.estado !== 'subiendo') throw new ErrorDominio(`La importación ${d.n} no está abierta (empezala de nuevo).`, 409)
  // se sanea todo antes de guardarlo
  const marcos = d.marcos.map((m) => {
    const s = sanearHtml(m.html, { que: `el marco «${m.nombre}»` })
    return { ...m, html: s.html, css: sanearCss([m.css, s.css].filter(Boolean).join('\n'), { que: `el marco «${m.nombre}»` }) }
  })
  const items = d.items.map((it) => {
    if (it.tipo === 'pieza') {
      const p = it.datos as { html?: string; variantes?: Record<string, string>; css?: string }
      const html = p.html ? sanearHtml(p.html, { conIds: false }).html : undefined
      const variantes = p.variantes ? Object.fromEntries(Object.entries(p.variantes).map(([k, v]) => [k, sanearHtml(v, { conIds: false }).html])) : undefined
      return { ...it, datos: { ...it.datos, html, variantes, css: sanearCss(p.css ?? '') } }
    }
    if (it.tipo === 'plantilla') {
      const p = it.datos as { html?: string; css?: string }
      return { ...it, datos: { ...it.datos, html: sanearHtml(p.html ?? '').html, css: sanearCss(p.css ?? '') } }
    }
    if (it.tipo === 'hoja' && typeof (it.datos as { css?: string }).css === 'string') return { ...it, datos: { ...it.datos, css: sanearCss((it.datos as { css: string }).css) } }
    return it
  })
  const [u] = await sd.db.consulta(`select coalesce(max(parte), 0)::int as p from diseno_paso where proyecto_id = $1 and n = $2`, [pid, d.n])
  const parte = Number(u?.p ?? 0) + 1
  await sd.db.consulta(`insert into diseno_paso (proyecto_id, n, parte, datos) values ($1, $2, $3, $4::jsonb)`, [pid, d.n, parte, j({ items, paginas: d.paginas, marcos })])
  return { ok: true, parte, items: items.length, marcos: marcos.length, paginas: d.paginas.length }
}

const hashItem = (it: { nombre: string; grupo: string; datos: unknown }) => sha12(j([it.nombre, it.grupo, it.datos]))
const hashMarco = (m: { html: string; css: string; hojas: string[]; ancho: number; alto: number; datos: Record<string, unknown>; nombre: string; seccion: string }) => {
  const datos = { ...m.datos }
  delete datos.miniaturaRev
  return sha12(j([m.html, m.css, m.hojas, m.ancho, m.alto, datos, m.nombre, m.seccion]))
}

export async function terminarImportacion(sd: ServicioDiseno, ctx: Ctx, pid: string, n: number) {
  const [imp] = await sd.db.consulta(`select * from diseno_importaciones where proyecto_id = $1 and n = $2`, [pid, n])
  if (!imp || imp.estado !== 'subiendo') throw new ErrorDominio(`La importación ${n} no está abierta.`, 409)
  const partes = await sd.db.consulta(`select datos from diseno_paso where proyecto_id = $1 and n = $2 order by parte`, [pid, n])
  const items: z.infer<typeof esquemaItem>[] = []
  const paginas: z.infer<typeof esquemaPaginaImp>[] = []
  const marcos: (z.infer<typeof esquemaMarcoImp> & { css: string })[] = []
  for (const p of partes) {
    items.push(...(p.datos.items ?? []))
    paginas.push(...(p.datos.paginas ?? []))
    marcos.push(...(p.datos.marcos ?? []))
  }
  const cambios: CambioImportacion[] = []
  const resumen: Record<string, number> = {}
  // una importación parcial (--solo tokens,activos o sin --con-paginas) solo reemplaza lo que trae
  const alcance = ((imp.origen ?? {}) as { alcance?: { tipos?: string[]; marcos?: boolean } }).alcance ?? {}
  const tocaTipo = (t: string) => !alcance.tipos || alcance.tipos.includes(t)
  const tocaMarcos = alcance.marcos !== false
  await sd.db.transaccion(async (tx) => {
    // ── ítems ──
    const vigentes = await tx.consulta(`select tipo, clave, hash from diseno_items where proyecto_id = $1 and origen = 'importado'`, [pid])
    const antes = new Map(vigentes.map((v) => [`${v.tipo}:${v.clave}`, v.hash as string]))
    const propios = new Set((await tx.consulta(`select tipo, clave from diseno_items where proyecto_id = $1 and origen = 'propio'`, [pid])).map((v) => `${v.tipo}:${v.clave}`))
    const llegaron = new Set<string>()
    let orden = 0
    for (const it of items) {
      const k = `${it.tipo}:${it.clave}`
      if (llegaron.has(k) || propios.has(k)) continue
      llegaron.add(k)
      resumen[it.tipo] = (resumen[it.tipo] ?? 0) + 1
      const hash = hashItem(it)
      const previo = antes.get(k)
      const que = previo === undefined ? 'nuevo' : previo !== hash ? 'cambio' : null
      if (que) cambios.push({ tipo: it.tipo, clave: it.clave, que, nombre: it.nombre })
      const ordenItem = it.orden ?? `a${String(orden++).padStart(6, '0')}`
      if (que)
        await tx.consulta(
          `insert into diseno_items (proyecto_id, tipo, clave, nombre, grupo, datos, origen, hash, importacion, orden, archivado, actualizado_en)
           values ($1,$2,$3,$4,$5,$6::jsonb,'importado',$7,$8,$9,false,now())
           on conflict (proyecto_id, tipo, clave) do update set nombre = excluded.nombre, grupo = excluded.grupo, datos = excluded.datos, hash = excluded.hash,
             importacion = excluded.importacion, orden = excluded.orden, archivado = false, actualizado_en = now()`,
          [pid, it.tipo, it.clave, it.nombre, it.grupo, j(it.datos), hash, n, ordenItem],
        )
      else await tx.consulta(`update diseno_items set orden = $4, archivado = false where proyecto_id = $1 and tipo = $2 and clave = $3`, [pid, it.tipo, it.clave, ordenItem])
    }
    for (const [k] of antes) {
      if (llegaron.has(k)) continue
      const [tipo, ...c] = k.split(':')
      if (!tocaTipo(tipo!)) continue
      cambios.push({ tipo: tipo!, clave: c.join(':'), que: 'quitado' })
      await tx.consulta(`delete from diseno_items where proyecto_id = $1 and tipo = $2 and clave = $3 and origen = 'importado'`, [pid, tipo, c.join(':')])
    }

    // ── páginas ──
    const pgs = await tx.consulta(`select * from diseno_paginas where proyecto_id = $1`, [pid])
    const porSlug = new Map(pgs.map((p) => [p.slug as string, p]))
    const idDePagina = new Map<string, string>()
    let ordenPg = 1
    for (const p of paginas) {
      const ya = porSlug.get(p.slug)
      const ordenP = p.orden ?? `b${String(ordenPg++).padStart(3, '0')}`
      if (ya && ya.origen === 'propio') {
        // la página propia del mismo nombre (Fundamentos) suma los tipos que trae la importación
        const tipos = [...new Set([...(ya.datos?.tipos ?? []), ...((p.datos.tipos as string[]) ?? [])])]
        await tx.consulta(`update diseno_paginas set datos = datos || $2::jsonb where id = $1`, [ya.id, j({ ...p.datos, tipos })])
        idDePagina.set(p.slug, ya.id)
        continue
      }
      if (ya) {
        await tx.consulta(`update diseno_paginas set nombre = $2, tipo = $3, datos = $4::jsonb, archivada = false, orden = $5 where id = $1`, [ya.id, p.nombre, p.tipo, j(p.datos), ordenP])
        idDePagina.set(p.slug, ya.id)
      } else {
        const id = `pg_${sha12(pid + p.slug).slice(0, 8)}`
        await tx.consulta(`insert into diseno_paginas (id, proyecto_id, nombre, slug, tipo, origen, datos, orden) values ($1,$2,$3,$4,$5,'importado',$6::jsonb,$7) on conflict (id) do nothing`, [id, pid, p.nombre, p.slug, p.tipo, j(p.datos), ordenP])
        idDePagina.set(p.slug, id)
        cambios.push({ tipo: 'pagina', clave: p.slug, que: 'nuevo', nombre: p.nombre })
      }
    }
    for (const p of pgs) if (p.origen === 'importado' && !paginas.some((x) => x.slug === p.slug)) await tx.consulta(`update diseno_paginas set archivada = true where id = $1`, [p.id])

    // ── marcos ──
    const mvs = await tx.consulta(`select id, clave, hash, revision, miniatura, datos, archivado_en from diseno_marcos where proyecto_id = $1 and origen = 'importado'`, [pid])
    const porClave = new Map(mvs.map((m) => [m.clave as string, m]))
    const llegados = new Set<string>()
    // posiciones: por página y sección, en el orden en que vienen
    const porPagina = new Map<string, typeof marcos>()
    for (const m of marcos) {
      if (!porPagina.has(m.pagina)) porPagina.set(m.pagina, [])
      porPagina.get(m.pagina)!.push(m)
    }
    for (const [slugPg, lista] of porPagina) {
      const paginaId = idDePagina.get(slugPg) ?? porSlug.get(slugPg)?.id
      if (!paginaId) throw new ErrorDominio(`El marco «${lista[0]!.nombre}» va a la página «${slugPg}», que no vino en la importación.`)
      const lugares = acomodar(lista.map((m) => ({ id: m.clave, seccion: m.seccion, ancho: m.ancho, alto: m.alto })))
      for (const m of lista) {
        if (llegados.has(m.clave)) continue
        llegados.add(m.clave)
        resumen.marcos = (resumen.marcos ?? 0) + 1
        const l = lugares.get(m.clave)!
        const hash = hashMarco(m)
        const ya = porClave.get(m.clave)
        const datos: DatosMarco = { ...(m.datos as DatosMarco) }
        if (!ya) {
          const id = `m_${sha12(pid + m.clave).slice(0, 8)}`
          datos.importacion = n
          if (m.miniatura) datos.miniaturaRev = 1
          await tx.consulta(
            `insert into diseno_marcos (id, proyecto_id, pagina_id, nombre, seccion, x, y, ancho, alto, html, css, hojas, datos, origen, clave, hash, miniatura, creado_por)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,'importado',$14,$15,$16,$17::jsonb)`,
            [id, pid, paginaId, m.nombre, m.seccion, l.x, l.y, m.ancho, m.alto, m.html, m.css, j(m.hojas), j(datos), m.clave, hash, m.miniatura ?? null, j(ctx.actor)],
          )
          cambios.push({ tipo: 'marco', clave: m.clave, que: 'nuevo', nombre: m.nombre })
        } else if (ya.hash !== hash || ya.archivado_en) {
          const rev = Number(ya.revision) + 1
          datos.importacion = n
          if (m.miniatura) datos.miniaturaRev = rev
          await tx.consulta(
            `update diseno_marcos set pagina_id = $2, nombre = $3, seccion = $4, x = $5, y = $6, ancho = $7, alto = $8, html = $9, css = $10, hojas = $11::jsonb,
               datos = $12::jsonb, hash = $13, miniatura = coalesce($14, miniatura), revision = $15, archivado_en = null, actualizado_en = now() where id = $1`,
            [ya.id, paginaId, m.nombre, m.seccion, l.x, l.y, m.ancho, m.alto, m.html, m.css, j(m.hojas), j(datos), hash, m.miniatura ?? null, rev],
          )
          cambios.push({ tipo: 'marco', clave: m.clave, que: ya.archivado_en ? 'nuevo' : 'cambio', nombre: m.nombre })
        } else await tx.consulta(`update diseno_marcos set pagina_id = $2, x = $3, y = $4 where id = $1`, [ya.id, paginaId, l.x, l.y])
      }
    }
    for (const [clave, m] of porClave) {
      if (!tocaMarcos || llegados.has(clave) || m.archivado_en) continue
      await tx.consulta(`update diseno_marcos set archivado_en = now() where id = $1`, [m.id])
      cambios.push({ tipo: 'marco', clave, que: 'quitado' })
    }

    const origen = (imp.origen ?? {}) as OrigenImportacion
    await tx.consulta(`update diseno_importaciones set estado = 'lista', cambios = $3::jsonb, resumen = $4::jsonb where proyecto_id = $1 and n = $2`, [pid, n, j(cambios), j(resumen)])
    await tx.consulta(`update diseno_config set importacion = $2, importado_en = now(), origen = $3::jsonb, pedido_en = null where proyecto_id = $1`, [pid, n, j(origen)])
    await tx.consulta(`delete from diseno_paso where proyecto_id = $1 and n = $2`, [pid, n])
  })
  const partesResumen = [
    resumen.token && `${resumen.token} tokens`,
    resumen.color_suelto && `${resumen.color_suelto} colores sueltos`,
    resumen.activo && `${resumen.activo} activos`,
    resumen.fuente && `${resumen.fuente} fuentes`,
    resumen.texto && `${resumen.texto} textos`,
    resumen.pieza && `${resumen.pieza} piezas`,
    resumen.marcos && `${resumen.marcos} pantallas y hojas`,
  ].filter(Boolean)
  await sd.registrar(ctx, pid, 'diseno.importacion', `sincronizó el diseño con el código: ${partesResumen.join(', ')} (${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'})`, { n })
  sd.publicar(ctx, pid, { accion: 'importacion' })
  const cuenta = (q: string) => cambios.filter((c) => c.que === q).length
  return { n, cambios: cambios.length, nuevos: cuenta('nuevo'), cambiados: cuenta('cambio'), quitados: cuenta('quitado'), resumen, detalle: cambios.slice(0, 400) }
}
