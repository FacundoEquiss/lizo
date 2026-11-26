// Las 13 herramientas MCP de Diseño (plan 7.3). Pocas y por intención; respuestas en texto compacto (una línea por cosa,
// con su id y su enlace); errores que dicen qué hacer; las que escriben aceptan `ver: true` y devuelven la imagen en la
// misma llamada, con los avisos de calidad. herramientas.ts las suma a HERRAMIENTAS con una línea.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { z } from 'zod'
import { arbolCompacto, arbolDeHtml, aplanar } from '../../../compartido/diseno/capas'
import { analizarHtml, buscarPorId } from '../../../compartido/diseno/html'
import { esquemaOperacion } from '../../../compartido/diseno/operaciones'
import { esquemaPerfil } from '../../../compartido/diseno/perfil'
import { LISTA_PREFIJADOS, medidasDe } from '../../../compartido/diseno/prefijados'
import { claseDeEstilo, normalizarColor, variableDeToken } from '../../../compartido/diseno/tokens'
import type { DatosActivo, DatosColorSuelto, DatosFuente, DatosHoja, DatosPieza, DatosPlantilla, DatosTexto, DatosToken, ItemDiseno, Marco, TipoItem } from '../../../compartido/diseno/tipos'
import type { Actor } from '../../../compartido/tipos'
import { ErrorDominio, type Servicio } from '../dominio/servicio'
import type { Herramienta } from '../mcp/herramientas'
import { rellenarRanuras } from './rutas'
import { disenoDe, type ServicioDiseno } from './servicio-diseno'
import { urlPublica } from './urls'

// ───────── respuesta con imagen (servidor-mcp.ts la pasa tal cual) ─────────

export const MARCA_MCP = '__telarMcp'
export type ContenidoMcp = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export interface RespuestaMcp {
  [MARCA_MCP]: true
  contenido: ContenidoMcp[]
}
export const esRespuestaMcp = (r: unknown): r is RespuestaMcp => !!r && typeof r === 'object' && (r as Record<string, unknown>)[MARCA_MCP] === true

/** Una respuesta del MCP con imágenes (primero) y su texto. La usan ver_diseno y ver_lienzo. */
export function conImagenes(texto: string, imagenes: { bytes: Uint8Array; mime: string }[]): RespuestaMcp {
  return {
    [MARCA_MCP]: true,
    contenido: [...imagenes.map((i) => ({ type: 'image' as const, data: Buffer.from(i.bytes).toString('base64'), mimeType: i.mime })), { type: 'text' as const, text: texto }],
  }
}

function definir<S extends z.ZodObject>(h: {
  nombre: string
  titulo: string
  descripcion: string
  esquema: S
  soloLectura: boolean
  idempotente?: boolean
  ejecutar: (s: Servicio, actor: Actor, args: z.infer<S>) => Promise<unknown>
}): Herramienta {
  return h as unknown as Herramienta
}

// ───────── piezas de los esquemas ─────────

const proyecto = z.string().optional().describe('Prefijo del proyecto (RC, YG…). Si hay uno solo, se puede omitir.')
const refMarco = z.string().min(1).describe('Id del marco (m_…) o su nombre exacto.')
const tamano = z
  .union([z.string(), z.strictObject({ ancho: z.number().int().min(16).max(8192), alto: z.number().int().min(16).max(8192) })])
  .describe(`Un prefijado o { ancho, alto }. Prefijados: ${LISTA_PREFIJADOS}.`)
const ver = z.boolean().optional().describe('true: devuelve además la imagen del resultado (con sus avisos). Usalo siempre que crees o cambies algo visible.')

const SEP = '\n'
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const recortar = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

async function ctxProyecto(s: Servicio, ref?: string) {
  const sd = disenoDe(s)
  const p = await sd.proyecto(ref)
  return { sd, pid: p.id as string, prefijo: p.prefijo as string, nombre: p.nombre as string }
}

function lineaMarco(m: Marco | ReturnType<typeof Object>, extra = ''): string {
  const x = m as Marco
  const partes = [`${x.id} «${x.nombre}» · ${x.ancho}×${x.alto}`]
  if (x.seccion) partes.push(`sección ${x.seccion}`)
  if (x.grupo) partes.push(`grupo ${x.grupo}`)
  partes.push(x.origen === 'importado' ? 'importado (solo lectura)' : 'propio')
  partes.push(`rev ${x.revision}`)
  if (x.tarjetas?.length) partes.push(`tarjetas ${x.tarjetas.join(', ')}`)
  if (x.comentarios) partes.push(`${x.comentarios} comentario${x.comentarios === 1 ? '' : 's'}`)
  if (x.bloqueado) partes.push('bloqueado')
  return partes.join(' · ') + extra
}

const escalaParaVer = (m: { ancho: number; alto: number }, pedida?: number) => pedida ?? Math.min(2, 1024 / Math.max(m.ancho, m.alto))

async function verMarco(sd: ServicioDiseno, pid: string, m: Marco, o: { escala?: number; capa?: string; modo?: string; estados?: boolean; sobre?: 'claro' | 'oscuro' | 'transparente' } = {}) {
  const escala = escalaParaVer(m, o.escala)
  let r = await sd.render(pid, m.id, { formato: 'png', escala, capa: o.capa, modo: o.modo, estados: o.estados, sobre: o.sobre ?? 'claro' })
  // una captura muy pesada va en JPEG (los modelos reciben igual de bien una JPEG de calidad alta)
  if ((r.bytes?.byteLength ?? 0) > 1_500_000 && !o.capa) r = await sd.render(pid, m.id, { formato: 'jpg', calidad: 0.88, escala, modo: o.modo, estados: o.estados, sobre: o.sobre ?? 'claro' })
  return r
}

const textoAvisos = (avisos: string[]) => (avisos.length ? `Avisos (${avisos.length}):${SEP}${avisos.map((a) => `- ${a}`).join(SEP)}` : 'Avisos: ninguno.')

/** Colores con nombre del proyecto: "#d2663a" → "--color-marca-primario". */
async function nombresDeColores(sd: ServicioDiseno, pid: string): Promise<Map<string, string>> {
  const { items } = await sd.items(pid, { tipo: 'token', limite: 500 })
  const m = new Map<string, string>()
  for (const t of items as ItemDiseno<'token'>[]) {
    const d = t.datos
    if (d.suelto || d.clase !== 'color') continue
    const hex = normalizarColor(d.valor)
    if (hex && !m.has(hex)) m.set(hex, d.css || variableDeToken(t.clave))
  }
  return m
}

function estiloConToken(estilo: string | undefined, colores: Map<string, string>): string | undefined {
  if (!estilo) return estilo
  return estilo.replace(/#[0-9a-f]{6}([0-9a-f]{2})?\b/gi, (hex) => {
    const n = colores.get(hex.toLowerCase())
    return n ? `${hex} (${n})` : hex
  })
}

async function arbolDeMarco(sd: ServicioDiseno, pid: string, m: Marco, desde = 0) {
  const [activos, piezas, medida, colores] = await Promise.all([sd.activosPorRuta(pid), sd.piezasDe(pid, m.html), sd.cajas(pid, m), nombresDeColores(sd, pid)])
  const nodos = arbolDeHtml(m.html, { activos, piezas })
  const estilos = Object.fromEntries(Object.entries(medida.estilos).map(([k, v]) => [k, estiloConToken(v, colores) ?? '']))
  return { ...arbolCompacto(nodos, { cajas: medida.cajas, estilos, desde, tope: 6000 }), avisos: medida.avisos, piezas: Object.keys(piezas) }
}

// ───────── las herramientas ─────────

export const HERRAMIENTAS_DISENO: Herramienta[] = [
  definir({
    nombre: 'leer_diseno',
    titulo: 'Leer el diseño',
    descripcion:
      'Lee el espacio de Diseño de un proyecto (páginas → marcos → capas, y su sistema: tokens, estilos de texto, piezas, activos, fuentes, textos). ' +
      'Empezá siempre por acá (el cómo, en leer_guia { "tema": "diseno" }). Sin más parámetros da el mapa: páginas, cantidad de marcos e ítems y el estado de la sincronización con el código. ' +
      'Con `pagina` lista sus marcos. Con `marco` da su árbol de capas (una línea por capa: id, etiqueta, nombre o texto, caja x,y ancho×alto y estilo). ' +
      'Con `marco` + `capa` da esa capa a fondo: las reglas CSS que le aplican (con archivo y línea), los estilos calculados y su HTML. ' +
      'Con `sistema` lista una parte del sistema: tokens, estilos, colores_sueltos, piezas, plantillas, activos, fuentes, textos, hojas o salud. ' +
      'Ejemplos: { "proyecto": "RC" } · { "pagina": "Celular" } · { "marco": "m_3fkq2a9b" } · { "marco": "m_3fkq2a9b", "capa": "a1b2c3" } · { "sistema": "tokens" }. ' +
      'Para ver cómo se ve un marco usá ver_diseno; para encontrar algo por texto o valor, buscar_en_diseno.',
    esquema: z.strictObject({
      proyecto,
      pagina: z.string().optional().describe('Nombre de la página (Fundamentos, Celular, "Campaña de verano"…).'),
      marco: z.string().optional().describe('Id o nombre del marco.'),
      capa: z.string().optional().describe('Id de la capa (data-id). Requiere marco.'),
      sistema: z.enum(['tokens', 'estilos', 'colores_sueltos', 'piezas', 'plantillas', 'activos', 'fuentes', 'textos', 'hojas', 'salud']).optional(),
      grupo: z.string().optional().describe('Con sistema: solo ese grupo.'),
      desde: z.number().int().min(0).optional().describe('Para paginar (las respuestas largas terminan diciendo desde dónde seguir).'),
      con_codigo: z.boolean().optional().describe('Con marco: suma el HTML y el CSS completos del marco.'),
    }),
    soloLectura: true,
    async ejecutar(s, _a, a) {
      const { sd, pid, prefijo, nombre } = await ctxProyecto(s, a.proyecto)
      if (a.capa && !a.marco) throw new ErrorDominio('Para leer una capa mandá también el marco: { "marco": "m_…", "capa": "a1b2c3" }.')
      if (a.marco && a.capa) {
        const m = await sd.resolverMarco(pid, a.marco)
        if (!buscarPorId(analizarHtml(m.html), a.capa)) {
          const nodos = aplanar(arbolDeHtml(m.html)).slice(0, 14).map((n) => `\`${n.id}\` ${n.nombre}`)
          throw new ErrorDominio(`No existe la capa \`${a.capa}\` en «${m.nombre}». Capas: ${nodos.join(', ')}${nodos.length >= 14 ? '…' : ''}.`, 404)
        }
        const r = await sd.render(pid, m.id, { soloMedir: true, detalle: a.capa })
        const d = r.detalle
        if (!d) throw new ErrorDominio(`La capa \`${a.capa}\` no se dibujó (¿está oculta?).`, 404)
        const pg = await sd.resolverPagina(pid, m.paginaId)
        const lineas = [
          `Capa ${a.capa} de ${m.id} «${m.nombre}» · caja ${d.caja[0]},${d.caja[1]} ${d.caja[2]}×${d.caja[3]}`,
          '',
          'Calculado:',
          ...Object.entries(d.calculado).map(([k, v]) => `  ${k}: ${recortar(v, 160)}${d.originales[k] && d.originales[k] !== v ? `   (en el código: ${recortar(d.originales[k]!, 80)})` : ''}`),
          '',
          `Reglas que le aplican (de la que más manda a la que menos): ${d.reglas.length}`,
          ...d.reglas.slice(0, 14).flatMap((x) => [`  ${x.origen}${x.condicion ? ` · ${x.condicion}` : ''} · ${x.selector}${x.pseudo ? ` (${x.pseudo})` : ''}`, ...x.declaraciones.split('\n').slice(0, 16).map((l) => `      ${recortar(l, 140)}`)]),
          d.reglas.length > 14 ? `  … y ${d.reglas.length - 14} reglas más` : '',
          '',
          'HTML:',
          recortar(d.html, 3000),
          '',
          await sd.url(pid, pg.slug, `${m.id}.${a.capa}`),
        ]
        return lineas.filter((l) => l !== undefined).join(SEP)
      }
      if (a.marco) {
        const m = await sd.resolverMarco(pid, a.marco, { pagina: a.pagina })
        const pg = await sd.resolverPagina(pid, m.paginaId)
        const arbol = await arbolDeMarco(sd, pid, m, a.desde ?? 0)
        const lineas = [
          `Marco ${lineaMarco(m)} · página ${pg.nombre}`,
          `Hojas: ${m.hojas.length ? m.hojas.join(', ') + ' + ' : ''}tokens del proyecto. Piezas usadas: ${arbol.piezas.join(', ') || 'ninguna'}.`,
          `Capas (${arbol.total}):`,
          arbol.texto || '(vacío: el marco no tiene capas)',
          textoAvisos(arbol.avisos),
        ]
        if (a.con_codigo) {
          lineas.push('', 'HTML:', recortar(m.html, 60000), '', 'CSS del marco:', m.css || '(sin CSS propio)')
        } else if (m.origen === 'propio') lineas.push('(con_codigo: true trae el HTML y el CSS completos)')
        lineas.push(await sd.url(pid, pg.slug, m.id))
        return lineas.join(SEP)
      }
      if (a.pagina) {
        const { pagina, marcos } = await sd.leerPagina(pid, a.pagina)
        const url = await sd.url(pid, pagina.slug)
        if (pagina.tipo !== 'lienzo') {
          const tipos = pagina.datos.tipos ?? []
          return [`Página ${pagina.nombre} · ${pagina.tipo === 'sistema' ? 'sistema (se dibuja sola con los ítems)' : 'tabla'} · ${pagina.origen} · tipos: ${tipos.join(', ')} · ${pagina.marcos} ítems`, `Leé sus ítems con leer_diseno sistema: ${tipos.map((t) => ({ token: 'tokens', estilo_texto: 'estilos', color_suelto: 'colores_sueltos', activo: 'activos', fuente: 'fuentes', texto: 'textos', pieza: 'piezas', plantilla: 'plantillas', hoja: 'hojas' })[t]).filter(Boolean).join(' | ')}.`, url].join(SEP)
        }
        const desde = a.desde ?? 0
        const lineas = [`Página ${pagina.nombre} · lienzo · ${pagina.origen === 'importado' ? 'viene del código (solo lectura: copiá con duplicar_marco)' : 'propia'} · ${marcos.length} marcos`]
        let seccion: string | null = null
        let largo = 0
        let i = desde
        for (; i < marcos.length; i++) {
          const m = marcos[i]!
          const l = (m.seccion !== seccion ? `${m.seccion ? `── ${m.seccion} ──` : '── (sin sección) ──'}${SEP}` : '') + `  ${lineaMarco(m as unknown as Marco)}`
          if (largo + l.length > 5800 && i > desde) break
          seccion = m.seccion
          lineas.push(l)
          largo += l.length
        }
        if (i < marcos.length) lineas.push(`… y ${marcos.length - i} más. Pedí \`desde: ${i}\``)
        if (!marcos.length) lineas.push(pagina.origen === 'importado' ? 'Falta sincronizar las pantallas (sincronizar_diseno).' : 'Vacía: creá un marco con crear_marco.')
        lineas.push(url)
        return lineas.join(SEP)
      }
      if (a.sistema) return leerSistema(sd, pid, a.sistema, a.grupo, a.desde ?? 0)
      // el mapa
      const r = await sd.resumen(pid)
      const c = r.conteo
      const sinc = r.sincronizacion
      const lineas = [
        `Diseño de ${nombre} (${prefijo})`,
        'Páginas:',
        ...r.paginas.map((p) => `  ${p.nombre} · ${p.tipo} · ${p.origen === 'importado' ? 'del código' : 'propia'} · ${p.marcos} ${p.tipo === 'lienzo' ? 'marcos' : 'ítems'}`),
        `Sistema: ${[c.token && `${c.token} tokens`, c.estilo_texto && `${c.estilo_texto} estilos de texto`, c.color_suelto && `${c.color_suelto} colores sueltos`, c.fuente && `${c.fuente} fuentes`, c.activo && `${c.activo} activos`, c.pieza && `${c.pieza} piezas`, c.plantilla && `${c.plantilla} plantillas`, c.texto && `${c.texto} textos`, c.hoja && `${c.hoja} hojas`].filter(Boolean).join(', ') || 'vacío (definí tokens con definir_tokens)'}`,
        sinc.importacion
          ? `Sincronizado: importación ${sinc.importacion} del ${sinc.importadoEn?.slice(0, 16).replace('T', ' ')}${sinc.origen?.commit ? ` · ${sinc.origen.rama ?? ''} ${sinc.origen.commit.slice(0, 7)}` : ''}${sinc.ultima ? ` · ${sinc.ultima.cambios.length} cambios` : ''}`
          : sinc.tienePerfil
            ? 'Todavía no se importó del código (tiene perfil: sincronizar_diseno da el comando).'
            : 'Sin importar del código (es un diseño propio, o falta armar el perfil con sincronizar_diseno).',
        sinc.pedidoEn ? `El dueño pidió sincronizar el ${sinc.pedidoEn.slice(0, 16).replace('T', ' ')}: ver sincronizar_diseno.` : '',
        'Siguiente: leer_diseno con pagina, o sistema: tokens.',
        await sd.url(pid),
      ]
      return lineas.filter(Boolean).join(SEP)
    },
  }),

  definir({
    nombre: 'buscar_en_diseno',
    titulo: 'Buscar en el diseño',
    descripcion:
      'Busca en el diseño de un proyecto por nombre, por texto o por valor: marcos, capas (nombre o texto), tokens (un color "#38bde6", una medida), estilos de texto, activos, piezas, plantillas y textos. ' +
      'Devuelve qué es, dónde está, su id y su enlace. Usala antes de crear un token o una pieza: quizá ya existe. Ejemplo: { "consulta": "#38bde6" } · { "consulta": "Más pesos", "en": "textos" }.',
    esquema: z.strictObject({
      proyecto,
      consulta: z.string().min(1),
      en: z.enum(['marcos', 'capas', 'tokens', 'activos', 'piezas', 'textos']).optional(),
      limite: z.number().int().min(1).max(100).optional().describe('Por defecto 20.'),
    }),
    soloLectura: true,
    async ejecutar(s, _a, a) {
      const { sd, pid } = await ctxProyecto(s, a.proyecto)
      const r = await sd.buscar(pid, a.consulta, { en: a.en, limite: a.limite ?? 20 })
      if (!r.length) return `Nada con «${a.consulta}»${a.en ? ` en ${a.en}` : ''}.`
      const lineas = [`${r.length} resultado${r.length === 1 ? '' : 's'} para «${a.consulta}»:`]
      for (const x of r) {
        const url = x.marco ? await sd.url(pid, x.pagina, x.capa ? `${x.marco}.${x.capa}` : x.marco) : ''
        lineas.push(`  ${x.tipo} · ${x.id} · ${recortar(x.nombre, 60)}${x.detalle ? ` · ${recortar(x.detalle, 90)}` : ''}${url ? ` · ${url}` : ''}`)
      }
      return lineas.join(SEP)
    },
  }),

  definir({
    nombre: 'ver_diseno',
    titulo: 'Ver un marco',
    descripcion:
      'Devuelve la IMAGEN de un marco (o de una capa), dibujada por un navegador real con el mismo HTML y CSS que ve el dueño, más sus medidas, la revisión y los AVISOS de calidad (texto cortado, capas fuera del marco, imágenes que no cargan, fuentes que faltan, texto de menos de 9 px). ' +
      'Usala después de crear o editar, y antes de decir que algo está listo. Si hay avisos, arreglalos con editar_marco y volvé a mirar. ' +
      'Para comparar variantes: `marcos` con hasta 6 ids devuelve una sola imagen en grilla con sus nombres. ' +
      'Ejemplo: { "marco": "m_3fkq2a9b" } · { "marcos": ["m_a", "m_b", "m_c"] } · { "marco": "m_3fkq2a9b", "capa": "g7h8i9", "escala": 2 }.',
    esquema: z.strictObject({
      proyecto,
      marco: z.string().optional().describe('Id o nombre del marco.'),
      marcos: z.array(z.string()).max(6).optional().describe('Hasta 6 marcos en una grilla.'),
      capa: z.string().optional().describe('Solo esa capa (recorta a su caja).'),
      escala: z.number().min(0.25).max(2).optional().describe('px de imagen por px de marco. De fábrica, la que deja el lado mayor en 1024 px (hasta 2x).'),
      modo: z.string().optional().describe('Modo de los tokens (por ejemplo "oscuro").'),
      estados: z.boolean().optional().describe('Muestra los estados :hover/:active pintados como clases (.es-hover).'),
      sobre: z.enum(['claro', 'oscuro', 'transparente']).optional().describe('Fondo detrás de un marco transparente (los sprites blancos se ven mejor sobre oscuro).'),
    }),
    soloLectura: true,
    async ejecutar(s, _a, a) {
      const { sd, pid } = await ctxProyecto(s, a.proyecto)
      if (a.marcos?.length) {
        const g = await sd.grilla(pid, a.marcos, { modo: a.modo, estados: a.estados, sobre: a.sobre })
        const marcos = await Promise.all(a.marcos.map((x) => sd.resolverMarco(pid, x)))
        return conImagenes([`${marcos.length} marcos en grilla (${g.ancho}×${g.alto}):`, ...marcos.map((m) => `  ${lineaMarco(m)}`), textoAvisos(g.avisos)].join(SEP), [{ bytes: g.bytes, mime: 'image/png' }])
      }
      if (!a.marco) throw new ErrorDominio('Decí qué marco: { "marco": "m_…" } (o "marcos": [...] para una grilla).')
      const m = await sd.resolverMarco(pid, a.marco)
      const r = await verMarco(sd, pid, m, { escala: a.escala, capa: a.capa, modo: a.modo, estados: a.estados, sobre: a.sobre })
      const pg = await sd.resolverPagina(pid, m.paginaId)
      const texto = [`${lineaMarco(m)} · imagen ${r.ancho}×${r.alto}${a.capa ? ` (capa ${a.capa})` : ''} · dibujado en ${r.ms} ms`, textoAvisos(r.avisos), await sd.url(pid, pg.slug, a.capa ? `${m.id}.${a.capa}` : m.id)].join(SEP)
      return conImagenes(texto, [{ bytes: r.bytes!, mime: r.mime }])
    },
  }),

  definir({
    nombre: 'crear_marco',
    titulo: 'Crear un marco',
    descripcion:
      'Crea un marco (una pantalla o una pieza publicitaria) con HTML y CSS, en una página de lienzo (si la página no existe, se crea). ' +
      'Reglas para el HTML: HTML y CSS comunes. Sin <script>, sin <link>, sin recursos de afuera: las imágenes y fuentes se suben antes con subir_activo y se usan con la ruta que devuelve (/archivos/diseno/…). ' +
      'El marco mide exactamente `tamano` y recorta lo que se sale. Usá los tokens del proyecto como variables (var(--color-marca-primario); leer_diseno sistema: tokens las lista) y las clases de estilo de texto (.t-titulo). ' +
      'Para usar una pieza: <div data-pieza="boton" data-props=\'{"color":"naranja","etiqueta":"Pedí ahora"}\'></div>. Poneles data-nombre a las capas importantes. ' +
      'Para piezas que se van a adaptar a varios tamaños, medí en cqw/cqh (el body es un contenedor) y acomodá con flex. No hace falta <html> ni <body>. ' +
      'En vez de html podés partir de una plantilla con sus ranuras. Con `clave`, si ya hay un marco propio con esa clave lo reemplaza (reintentar no duplica). ' +
      'Ejemplo: { "proyecto": "YG", "pagina": "Campaña de verano", "nombre": "Posteo · 2x1", "tamano": "instagram-posteo", "tarjetas": ["YG-14"], "ver": true, ' +
      '"html": "<div class=\'fondo\' data-nombre=\'Fondo\'><h1 class=\'t-titulo\'>2x1 en hamburguesas</h1><p>Solo este finde</p></div>", ' +
      '"css": ".fondo{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:3cqh;padding:8cqw;background:var(--color-marca-crema)} h1{font-size:12cqw;margin:0}" }. ' +
      'Para cambiar un marco que ya existe usá editar_marco; para variantes y otros tamaños, duplicar_marco.',
    esquema: z.strictObject({
      proyecto,
      pagina: z.string().min(1).describe('Nombre de la página (si no existe, se crea).'),
      nombre: z.string().min(1),
      tamano,
      html: z.string().optional().describe('El contenido (el <body>, sin <html>).'),
      css: z.string().optional().describe('CSS de este marco.'),
      plantilla: z.string().optional().describe('En vez de html: la clave de una plantilla (leer_diseno sistema: plantillas).'),
      ranuras: z.record(z.string(), z.string()).optional().describe('Textos e imágenes de la plantilla: { "titulo": "…", "foto": "/archivos/…" }.'),
      hojas: z.array(z.string()).optional().describe('Hojas importadas que usa (por ejemplo ["ui.css", "tienda.css"] para una pantalla nueva del juego).'),
      seccion: z.string().optional(),
      grupo: z.string().optional().describe('Juego de variantes (marcos hermanos de la misma pieza).'),
      fondo: z.string().optional().describe('Color de fondo del marco (de fábrica blanco).'),
      modo: z.string().optional().describe('Modo de los tokens (oscuro…).'),
      tarjetas: z.array(z.string()).optional().describe('Claves de tarjetas a vincular (["YG-14"]).'),
      clave: z.string().optional().describe('Clave estable: si ya existe un marco propio con esta clave, se reemplaza.'),
      ver,
    }),
    soloLectura: false,
    idempotente: false,
    async ejecutar(s, actor, a) {
      const { sd, pid } = await ctxProyecto(s, a.proyecto)
      const m = medidasDe(a.tamano, await sd.prefijadosDe(pid))
      if (!m) throw new ErrorDominio(`No entiendo el tamaño «${JSON.stringify(a.tamano)}». Prefijados: ${LISTA_PREFIJADOS}. O { "ancho": 1080, "alto": 1080 }.`)
      let html = a.html ?? ''
      let css = a.css ?? ''
      let hojas = a.hojas
      let faltan: string[] = []
      if (a.plantilla) {
        const pl = await sd.item(pid, 'plantilla', a.plantilla)
        const d = pl.datos as DatosPlantilla
        faltan = d.ranuras.filter((r) => a.ranuras?.[r.nombre] === undefined).map((r) => r.nombre)
        html = rellenarRanuras(d.html, a.ranuras ?? {})
        css = [d.css, css].filter(Boolean).join('\n')
        hojas = [...new Set([...(d.hojas ?? []), ...(hojas ?? [])])]
      } else if (!html.trim()) throw new ErrorDominio('Falta el contenido: mandá html (y css), o plantilla con sus ranuras.')
      const r = await sd.crearMarco({ actor }, pid, {
        pagina: a.pagina,
        nombre: a.nombre,
        ancho: m.ancho,
        alto: m.alto,
        html,
        css,
        hojas,
        seccion: a.seccion,
        grupo: a.grupo ?? null,
        datos: { prefijado: m.prefijado ?? undefined, fondo: a.fondo, modo: a.modo, plantilla: a.plantilla },
        clave: a.clave,
        tarjetas: a.tarjetas,
      })
      const marco = r.marco
      const pg = await sd.resolverPagina(pid, marco.paginaId)
      const capas = aplanar(arbolDeHtml(marco.html, { activos: await sd.activosPorRuta(pid) }))
      const encabezado = [
        `${r.reemplazado ? 'Reemplacé' : 'Creé'} ${lineaMarco(marco)} en «${pg.nombre}».`,
        `Capas (${capas.length}): ${capas.slice(0, 20).map((c) => `${c.id} ${c.clase === 'instancia' ? '◇ ' + c.pieza : c.nombre}`).join(', ')}${capas.length > 20 ? '…' : ''}`,
        ...r.avisos.map((x) => `Saneado: ${x}`),
        faltan.length ? `Ranuras sin completar (quedaron vacías): ${faltan.join(', ')}.` : '',
      ].filter(Boolean)
      if (a.ver) {
        const img = await verMarco(sd, pid, marco)
        return conImagenes([...encabezado, textoAvisos(img.avisos), await sd.url(pid, pg.slug, marco.id)].join(SEP), [{ bytes: img.bytes!, mime: img.mime }])
      }
      const medida = await sd.render(pid, marco.id, { soloMedir: true }).catch(() => null)
      return [...encabezado, medida ? textoAvisos(medida.avisos) : '', 'Miralo con ver_diseno (o mandá ver: true).', await sd.url(pid, pg.slug, marco.id)].filter(Boolean).join(SEP)
    },
  }),

  definir({
    nombre: 'editar_marco',
    titulo: 'Editar un marco',
    descripcion:
      'Aplica una lista de operaciones a un marco propio, en orden y TODAS O NINGUNA (si una falla, no se guarda nada). Cada capa se nombra por su id (data-id) de leer_diseno. Operaciones (campo "op"): ' +
      'texto {capa, texto} · estilo {capa, estilos: {propiedad: valor|null}} (estilos en línea; null quita) · atributo {capa, nombre, valor|null} (src, alt, class, data-nombre…) · ' +
      'propiedades {capa, valores} (de una instancia de pieza) · reemplazar {capa, html} · insertar {html, dentro|antes_de|despues_de} (sin destino: al final del marco) · quitar {capa} · ' +
      'mover {capa, dentro|antes_de|despues_de} · css {css, como: "agregar"|"reemplazar"} (el CSS del marco) · marco {nombre?, tamano?, fondo?, modo?, seccion?, grupo?, x?, y?} · restaurar {revision} (va primera). ' +
      'Ejemplo: { "marco": "m_3fkq2a9b", "ver": true, "operaciones": [{ "op": "texto", "capa": "g7h8i9", "texto": "3x2 en hamburguesas" }, { "op": "estilo", "capa": "g7h8i9", "estilos": { "font-size": "10cqw" } }] }. ' +
      'Lo importado del código no se edita: hacé una copia con duplicar_marco. Devuelve una línea por operación, la revisión nueva, los ids de las capas creadas y los avisos.',
    esquema: z.strictObject({
      proyecto,
      marco: refMarco,
      operaciones: z.array(esquemaOperacion).min(1).max(100),
      revision: z.number().int().optional().describe('Si la mandás y el marco cambió desde entonces, no se aplica (409).'),
      ver,
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const { sd, pid } = await ctxProyecto(s, a.proyecto)
      const r = await sd.editarMarco({ actor }, pid, a.marco, a.operaciones, { revision: a.revision, registrar: true })
      const pg = await sd.resolverPagina(pid, r.marco.paginaId)
      const lineas = [`${r.marco.id} «${r.marco.nombre}»: revisión ${r.revisionAntes} → ${r.marco.revision}`, ...r.lineas.map((l) => `  ${l}`)]
      if (r.creadas.length) lineas.push(`Capas nuevas: ${r.creadas.join(', ')}`)
      for (const x of r.avisos) lineas.push(`Saneado: ${x}`)
      if (a.ver) {
        const img = await verMarco(sd, pid, r.marco)
        lineas.push(textoAvisos(img.avisos), await sd.url(pid, pg.slug, r.marco.id))
        return conImagenes(lineas.join(SEP), [{ bytes: img.bytes!, mime: img.mime }])
      }
      const medida = await sd.render(pid, r.marco.id, { soloMedir: true }).catch(() => null)
      if (medida) lineas.push(textoAvisos(medida.avisos))
      lineas.push(await sd.url(pid, pg.slug, r.marco.id))
      return lineas.join(SEP)
    },
  }),

  definir({
    nombre: 'duplicar_marco',
    titulo: 'Duplicar un marco',
    descripcion:
      'Copias, variantes y adaptaciones de un marco. Para armar las variantes de una pieza publicitaria (otros tamaños, otros textos) o para partir de una pantalla real del proyecto. ' +
      'Con `tamanos` hace una adaptación por tamaño (mismo HTML y CSS, mismo grupo): { "marco": "m_a", "tamanos": ["instagram-historia", "anuncio-300x250"] }. ' +
      'Con `copias` hace una por elemento, cada una con sus cambios: [{ "nombre": "…", "tamano": "…", "textos": { "g7h8i9": "Otro título" }, "estilos": { "a1b2c3": { "background": "#000" } }, "propiedades": { "m4n5o6": { "color": "verde" } } }]. ' +
      'Sin ninguno, una copia. Desde un marco IMPORTADO la copia va a una página propia ("Copias editables" o la que digas) y es editable: así se diseña una pantalla nueva del juego con su CSS real. ' +
      'Después mirá todas juntas con ver_diseno { "marcos": [...] }; lo que no quede bien en un tamaño se ajusta con editar_marco. ' +
      'Ejemplo: { "proyecto": "RC", "marco": "m_a", "tamanos": ["instagram-historia", "anuncio-300x250"] }',
    esquema: z.strictObject({
      proyecto,
      marco: refMarco,
      tamanos: z.array(tamano).max(12).optional(),
      copias: z
        .array(
          z.strictObject({
            nombre: z.string().optional(),
            tamano: tamano.optional(),
            textos: z.record(z.string(), z.string()).optional().describe('{ capa: texto }'),
            estilos: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).optional().describe('{ capa: { propiedad: valor } }'),
            propiedades: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.null()]))).optional().describe('{ capa: { propiedad: valor } }'),
          }),
        )
        .max(12)
        .optional(),
      pagina: z.string().optional().describe('A qué página (de fábrica la misma; desde un importado, "Copias editables").'),
      nombre: z.string().optional().describe('Nombre de la copia (si es una sola).'),
      seccion: z.string().optional(),
      ver,
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const { sd, pid } = await ctxProyecto(s, a.proyecto)
      const creados = await sd.duplicarMarco({ actor }, pid, a.marco, { tamanos: a.tamanos, copias: a.copias, pagina: a.pagina, nombre: a.nombre, seccion: a.seccion })
      const pg = await sd.resolverPagina(pid, creados[0]!.paginaId)
      const lineas = [`Creé ${creados.length} marco${creados.length === 1 ? '' : 's'} en «${pg.nombre}»:`, ...creados.map((m) => `  ${lineaMarco(m)}`)]
      if (a.ver) {
        if (creados.length === 1) {
          const img = await verMarco(sd, pid, creados[0]!)
          lineas.push(textoAvisos(img.avisos), await sd.url(pid, pg.slug, creados[0]!.id))
          return conImagenes(lineas.join(SEP), [{ bytes: img.bytes!, mime: img.mime }])
        }
        const g = await sd.grilla(pid, creados.slice(0, 6).map((m) => m.id))
        lineas.push(textoAvisos(g.avisos), await sd.url(pid, pg.slug))
        return conImagenes(lineas.join(SEP), [{ bytes: g.bytes, mime: 'image/png' }])
      }
      lineas.push(`Miralos juntos: ver_diseno { "marcos": ${JSON.stringify(creados.slice(0, 6).map((m) => m.id))} }`, await sd.url(pid, pg.slug))
      return lineas.join(SEP)
    },
  }),

  definir({
    nombre: 'definir_tokens',
    titulo: 'Definir tokens',
    descripcion:
      'Crea o cambia tokens (variables) y estilos de texto PROPIOS del proyecto. Pisa por nombre: se puede repetir sin duplicar. Los nombres van con barras ("color/marca/primario") y se usan como variable CSS (var(--color-marca-primario)); ' +
      'cada estilo de texto da una clase (.t-titulo). Cambiar un token cambia todos los marcos que lo usan. Lo importado del código no se toca desde acá. ' +
      'Ejemplo: { "tokens": [{ "nombre": "color/marca/primario", "valor": "#d2663a" }, { "nombre": "color/marca/crema", "valor": "#fbf3e4" }, { "nombre": "espacio/m", "valor": "24px" }], ' +
      '"estilos_de_texto": [{ "nombre": "Título", "familia": "Fraunces", "peso": 800, "tamano": "96px", "interlineado": "1.05" }] }. ' +
      'Antes de crear uno, buscá si ya existe con buscar_en_diseno (por ejemplo por su valor).',
    esquema: z.strictObject({
      proyecto,
      tokens: z
        .array(
          z.strictObject({
            nombre: z.string().min(1).describe('Con barras: "color/marca/primario".'),
            clase: z.enum(['color', 'numero', 'medida', 'texto', 'sombra', 'curva', 'duracion', 'fuente', 'radio']).optional().describe('Se deduce del valor si no se manda.'),
            valor: z.string().describe('"#d2663a", "24px", "0 2px 8px rgba(0,0,0,.2)"…'),
            modos: z.record(z.string(), z.string()).optional().describe('Valor por modo: { "oscuro": "#ea8a58" }.'),
            alias: z.string().optional().describe('Nombre de otro token: este vale lo mismo.'),
            uso: z.string().optional().describe('Para qué se usa (una línea).'),
          }),
        )
        .optional(),
      estilos_de_texto: z
        .array(
          z.strictObject({
            nombre: z.string().min(1),
            familia: z.string().min(1).describe('Una familia del proyecto (leer_diseno sistema: fuentes) o de sistema.'),
            peso: z.number().int().min(100).max(1000).optional(),
            tamano: z.string().describe('"48px", "6cqw", "clamp(…)"'),
            interlineado: z.string().optional(),
            espaciado: z.string().optional(),
            mayusculas: z.boolean().optional(),
            color: z.string().optional(),
          }),
        )
        .optional(),
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      if (!a.tokens?.length && !a.estilos_de_texto?.length) throw new ErrorDominio('Mandá tokens y/o estilos_de_texto.')
      const { sd, pid } = await ctxProyecto(s, a.proyecto)
      const lineas = await sd.definirTokens({ actor }, pid, { tokens: a.tokens, estilos: a.estilos_de_texto })
      return [`Listo (${lineas.length}):`, ...lineas.map((l) => `  ${l}`), 'Usalos en el CSS de los marcos: var(--…) y class="t-…".'].join(SEP)
    },
  }),

  definir({
    nombre: 'definir_pieza',
    titulo: 'Definir una pieza o plantilla',
    descripcion:
      'Crea o cambia una PIEZA (componente reutilizable: cambiás la pieza y cambian todas sus instancias) o una PLANTILLA (un marco de partida con ranuras). Pisa por nombre. ' +
      'En el html: {{nombre}} para los textos (y en src para las imágenes); data-si="nombre" en lo que depende de un booleano (data-si="!nombre" al revés). ' +
      'Las propiedades llegan como data-<nombre>="valor" en el elemento de la instancia: estilá las variantes con [data-color="naranja"] .boton { … } o [data-pieza="boton"][data-color="verde"]. ' +
      'Una pieza crea además su hoja de variantes (un marco con todas las combinaciones, hasta 24) en la página "Piezas". ' +
      'Con `desde` la crea a partir de una capa que ya existe y reemplaza esa capa por una instancia. Una plantilla necesita tamano; sus ranuras salen de los {{…}}. ' +
      'Ejemplo: { "nombre": "boton", "html": "<a class=\'boton\'><span>{{etiqueta}}</span></a>", "css": ".boton{display:inline-flex;padding:2cqw 4cqw;border-radius:999px;background:var(--color-marca-primario);color:#fff;font:700 4cqw/1 Figtree} [data-color=\'verde\'] .boton{background:#3f8f4f}", ' +
      '"propiedades": [{ "nombre": "color", "clase": "variante", "valores": ["naranja", "verde"], "defecto": "naranja" }, { "nombre": "etiqueta", "clase": "texto", "defecto": "Pedí ahora" }] }. ' +
      'Se usa en un marco con <div data-pieza="boton" data-props=\'{"color":"verde","etiqueta":"Comprar"}\'></div>.',
    esquema: z.strictObject({
      proyecto,
      nombre: z.string().min(1).describe('Nombre (su clave sale de acá: "Botón principal" → boton-principal).'),
      clase: z.enum(['pieza', 'plantilla']).optional().describe('De fábrica pieza.'),
      html: z.string().optional(),
      css: z.string().optional(),
      propiedades: z
        .array(
          z.strictObject({
            nombre: z.string().min(1),
            clase: z.enum(['variante', 'texto', 'booleano', 'imagen']),
            valores: z.array(z.string()).optional().describe('Para variante: los valores posibles.'),
            defecto: z.union([z.string(), z.boolean()]),
          }),
        )
        .optional(),
      desde: z.strictObject({ marco: z.string(), capa: z.string().optional() }).optional().describe('Crearla a partir de algo que ya existe.'),
      tamano: tamano.optional().describe('Plantillas: su tamaño.'),
      hojas: z.array(z.string()).optional(),
      descripcion: z.string().optional(),
      ver,
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const { sd, pid } = await ctxProyecto(s, a.proyecto)
      const r = await sd.definirPieza({ actor }, pid, { nombre: a.nombre, clase: a.clase, html: a.html, css: a.css, propiedades: a.propiedades, desde: a.desde, tamano: a.tamano, hojas: a.hojas, descripcion: a.descripcion })
      if (r.tipo === 'plantilla') {
        return [
          `Plantilla «${a.nombre}» (clave ${r.clave}) lista. Ranuras: ${r.ranuras?.map((x) => `${x.nombre} (${x.clase})`).join(', ') || 'ninguna'}.`,
          `Usala: crear_marco { "plantilla": "${r.clave}", "ranuras": { ${(r.ranuras ?? []).map((x) => `"${x.nombre}": "…"`).join(', ')} }, … }`,
        ].join(SEP)
      }
      const props = (a.propiedades ?? []).map((p) => `${p.nombre} (${p.clase}${p.valores ? `: ${p.valores.join('|')}` : ''}, de fábrica ${JSON.stringify(p.defecto)})`)
      const ejemplo = Object.fromEntries((a.propiedades ?? []).map((p) => [p.nombre, p.defecto]))
      const lineas = [
        `Pieza «${a.nombre}» (clave ${r.clave}) lista. Propiedades: ${props.join(', ') || 'ninguna'}.`,
        `Instancia: <div data-pieza="${r.clave}" data-props='${JSON.stringify(ejemplo)}'></div>`,
        r.reemplazada ? `La capa ${r.reemplazada} del marco pasó a ser una instancia.` : '',
        r.hoja ? `Hoja de variantes: ${lineaMarco(r.hoja)}` : '',
      ].filter(Boolean)
      if (a.ver && r.hoja) {
        const img = await verMarco(sd, pid, r.hoja)
        lineas.push(textoAvisos(img.avisos), await sd.url(pid, 'piezas', r.hoja.id))
        return conImagenes(lineas.join(SEP), [{ bytes: img.bytes!, mime: img.mime }])
      }
      if (r.hoja) lineas.push(await sd.url(pid, 'piezas', r.hoja.id))
      return lineas.join(SEP)
    },
  }),

  definir({
    nombre: 'subir_activo',
    titulo: 'Subir una imagen o una fuente',
    descripcion:
      'Sube una imagen (png, jpg, webp, gif, svg, avif) o una fuente (woff2, woff, ttf, otf) al proyecto y devuelve su ruta (/archivos/diseno/…) para usar en los marcos (src="…" o url(…) en el CSS). Pisa por nombre. ' +
      'Una de tres fuentes: `url` (https pública, hasta 4 MB), `base64` + `mime` (hasta 1 MB), o `adjunto` (un adjunto que ya está en una tarjeta: { "tarjeta": "YG-3", "nombre": "logo.svg" }). ' +
      'Para una fuente mandá `familia` y `pesos` ("400 800" si es variable): queda disponible como font-family en todos los marcos. ' +
      'Ejemplo: { "nombre": "logo", "base64": "PHN2ZyB4bWxucz0i…", "mime": "image/svg+xml" } · { "nombre": "Fraunces", "url": "https://…/Fraunces.woff2", "familia": "Fraunces", "pesos": "400 900" }.',
    esquema: z.strictObject({
      proyecto,
      nombre: z.string().min(1),
      grupo: z.string().optional().describe('Grupo en la página Íconos (de fábrica "Subidas").'),
      url: z.string().optional(),
      base64: z.string().optional(),
      mime: z.string().optional(),
      adjunto: z.strictObject({ tarjeta: z.string(), nombre: z.string() }).optional(),
      familia: z.string().optional().describe('Fuentes: la familia ("Fraunces").'),
      pesos: z.string().optional().describe('Fuentes: "400", "400 800"…'),
      estilo: z.enum(['normal', 'italic']).optional(),
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const { sd, pid } = await ctxProyecto(s, a.proyecto)
      const fuentes = [a.url, a.base64, a.adjunto].filter(Boolean).length
      if (fuentes !== 1) throw new ErrorDominio('Mandá una (y solo una) de: url, base64 (+ mime) o adjunto { tarjeta, nombre }.')
      let bytes: Uint8Array
      let mime = a.mime ?? ''
      let archivo = a.nombre
      if (a.base64) {
        const limpio = a.base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
        bytes = new Uint8Array(Buffer.from(limpio, 'base64'))
        if (bytes.byteLength > 1024 * 1024) throw new ErrorDominio('En base64 se suben hasta 1 MB. Para más, usá url o un adjunto.', 413)
        if (!mime && a.base64.startsWith('data:')) mime = a.base64.slice(5, a.base64.indexOf(';'))
      } else if (a.url) {
        const r = await bajar(a.url)
        bytes = r.bytes
        mime = mime || r.mime
        archivo = new URL(a.url).pathname.split('/').pop() || a.nombre
      } else {
        const t = await s.leerTarjeta(a.adjunto!.tarjeta)
        const adj = t.adjuntos.find((x) => x.nombre === a.adjunto!.nombre) ?? t.adjuntos.find((x) => x.nombre.toLowerCase().includes(a.adjunto!.nombre.toLowerCase()))
        if (!adj) throw new ErrorDominio(`La tarjeta ${t.clave} no tiene un adjunto «${a.adjunto!.nombre}». Tiene: ${t.adjuntos.map((x) => x.nombre).join(', ') || 'ninguno'}.`, 404)
        const datos = await s.almacen.leer(adj.url.replace(/^\/archivos\//, ''))
        if (!datos) throw new ErrorDominio('No encontré el archivo de ese adjunto.', 404)
        bytes = datos.datos
        mime = mime || adj.mime || datos.mime
        archivo = adj.nombre
      }
      const r = await sd.subirActivo({ actor }, pid, { nombre: a.nombre, grupo: a.grupo, bytes, mime, archivo, familia: a.familia, pesos: a.pesos, estilo: a.estilo })
      if (r.tipo === 'fuente')
        return `Fuente «${a.familia ?? a.nombre}» lista (${kb(r.peso)}): ${r.ruta}. Usala con font-family: "${a.familia ?? a.nombre}" (o en un estilo de texto con definir_tokens).`
      return `Imagen «${r.clave}» lista: ${r.ruta} · ${r.ancho}×${r.alto} · ${kb(r.peso)}. Usala con <img src="${r.ruta}"> o background: url(${r.ruta}).`
    },
  }),

  definir({
    nombre: 'organizar_diseno',
    titulo: 'Organizar el diseño',
    descripcion:
      'Ordena el diseño con una lista de acciones (campo "accion"): crear_pagina {nombre} · renombrar {que, nombre} · mover_marcos {marcos, pagina?, seccion?} · ordenar_pagina {pagina} · ' +
      'vincular / desvincular {que, tarjeta} (una campaña = tarjetas + diseños) · anotar {que, nombre_propio?, uso?, estado? (vigente|revisar|viejo), nota?} · bloquear {marco, si} · archivar / restaurar {que}. ' +
      '`que` es un marco (id o nombre), "pagina:Nombre" o un ítem "item:token:color/marca/primario". Nada se borra: archivar es reversible. ' +
      'Ejemplo: { "acciones": [{ "accion": "vincular", "que": "m_3fkq2a9b", "tarjeta": "YG-14" }, { "accion": "mover_marcos", "marcos": ["m_3fkq2a9b"], "seccion": "Lanzamiento" }] }.',
    esquema: z.strictObject({
      proyecto,
      acciones: z
        .array(
          z.discriminatedUnion('accion', [
            z.strictObject({ accion: z.literal('crear_pagina'), nombre: z.string().min(1) }),
            z.strictObject({ accion: z.literal('renombrar'), que: z.string(), nombre: z.string().min(1) }),
            z.strictObject({ accion: z.literal('mover_marcos'), marcos: z.array(z.string()).min(1), pagina: z.string().optional(), seccion: z.string().optional() }),
            z.strictObject({ accion: z.literal('ordenar_pagina'), pagina: z.string() }),
            z.strictObject({ accion: z.literal('vincular'), que: z.string(), tarjeta: z.string() }),
            z.strictObject({ accion: z.literal('desvincular'), que: z.string(), tarjeta: z.string() }),
            z.strictObject({
              accion: z.literal('anotar'),
              que: z.string(),
              nombre_propio: z.string().nullable().optional(),
              uso: z.string().nullable().optional(),
              estado: z.enum(['vigente', 'revisar', 'viejo']).nullable().optional(),
              nota: z.string().nullable().optional(),
            }),
            z.strictObject({ accion: z.literal('bloquear'), marco: z.string(), si: z.boolean() }),
            z.strictObject({ accion: z.literal('archivar'), que: z.string() }),
            z.strictObject({ accion: z.literal('restaurar'), que: z.string() }),
          ]),
        )
        .min(1)
        .max(50),
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const { sd, pid } = await ctxProyecto(s, a.proyecto)
      const ctx = { actor }
      const lineas: string[] = []
      const esPagina = (q: string) => q.startsWith('pagina:')
      const esItem = (q: string) => q.startsWith('item:')
      for (const x of a.acciones) {
        switch (x.accion) {
          case 'crear_pagina': {
            const pg = await sd.crearPagina(ctx, pid, { nombre: x.nombre })
            lineas.push(`página «${pg.nombre}» creada · ${await sd.url(pid, pg.slug)}`)
            break
          }
          case 'renombrar': {
            if (esPagina(x.que)) {
              const pg = await sd.actualizarPagina(ctx, pid, x.que.slice(7), { nombre: x.nombre })
              lineas.push(`página renombrada a «${pg.nombre}»`)
            } else {
              const r = await sd.editarMarco(ctx, pid, x.que, [{ op: 'marco', nombre: x.nombre }], { registrar: true })
              lineas.push(`marco ${r.marco.id} renombrado a «${r.marco.nombre}»`)
            }
            break
          }
          case 'mover_marcos': {
            const destino = x.pagina ? await sd.resolverPagina(pid, x.pagina, { crear: true, ctx }) : null
            for (const ref of x.marcos) {
              const m = await sd.resolverMarco(pid, ref)
              if (m.origen === 'importado') throw new ErrorDominio(`«${m.nombre}» viene del código: no se mueve (copialo con duplicar_marco).`, 409)
              const seccion = x.seccion ?? m.seccion
              const pagina = destino?.id ?? m.paginaId
              const lugar = await sd.lugarLibre(pagina, seccion, m.ancho, m.alto, [m.id])
              await sd.db.consulta(`update diseno_marcos set pagina_id = $2, seccion = $3, x = $4, y = $5, actualizado_en = now() where id = $1`, [m.id, pagina, seccion, lugar.x, lugar.y])
              sd.publicar(ctx, pid, { accion: 'marco', paginaId: pagina, marcos: [m.id] })
              lineas.push(`${m.id} «${m.nombre}» → ${destino ? `página «${destino.nombre}»` : 'misma página'}${x.seccion !== undefined ? `, sección «${seccion}»` : ''}`)
            }
            break
          }
          case 'ordenar_pagina': {
            const n = await sd.ordenarPagina(ctx, pid, x.pagina)
            lineas.push(`página «${x.pagina}» ordenada (${n} marcos)`)
            break
          }
          case 'vincular':
          case 'desvincular': {
            const r = await sd.vincular(ctx, pid, x.que, x.tarjeta, { quitar: x.accion === 'desvincular' })
            lineas.push(`${x.accion === 'vincular' ? 'vinculado' : 'desvinculado'}: ${r.objetivo} ${x.accion === 'vincular' ? '↔' : '✕'} ${r.tarjeta}`)
            break
          }
          case 'anotar': {
            const n = await sd.guardarNota(ctx, pid, x.que, { nombrePropio: x.nombre_propio, uso: x.uso, estado: x.estado, nota: x.nota })
            lineas.push(`nota de ${n.objetivo}: ${[n.nombrePropio && `nombre «${n.nombrePropio}»`, n.uso && `uso «${n.uso}»`, n.estado, n.nota && 'con nota'].filter(Boolean).join(', ')}`)
            break
          }
          case 'bloquear': {
            const m = await sd.actualizarMarco(ctx, pid, x.marco, { bloqueado: x.si })
            lineas.push(`${m.id} «${m.nombre}» ${x.si ? 'bloqueado' : 'desbloqueado'}`)
            break
          }
          case 'archivar':
          case 'restaurar': {
            const archivar = x.accion === 'archivar'
            if (esPagina(x.que)) {
              const pg = await sd.actualizarPagina(ctx, pid, x.que.slice(7), { archivada: archivar })
              lineas.push(`página «${pg.nombre}» ${archivar ? 'archivada' : 'restaurada'}`)
            } else if (esItem(x.que)) {
              const [, tipo, ...c] = x.que.split(':')
              await sd.archivarItem(ctx, pid, tipo as TipoItem, c.join(':'), archivar)
              lineas.push(`${tipo} «${c.join(':')}» ${archivar ? 'archivado' : 'restaurado'}`)
            } else {
              const m = await sd.archivarMarco(ctx, pid, x.que, archivar)
              lineas.push(`marco ${m.id} «${m.nombre}» ${archivar ? 'archivado' : 'restaurado'}`)
            }
            break
          }
        }
      }
      return [`Listo (${lineas.length}):`, ...lineas.map((l) => `  ${l}`)].join(SEP)
    },
  }),

  definir({
    nombre: 'comentar_diseno',
    titulo: 'Comentar en el diseño',
    descripcion:
      'Comenta en un marco, en una capa ("m_3fkq2a9b#g7h8i9", el comentario sigue a la capa aunque se mueva) o en un ítem ("item:token:color/marca/primario"); responde un hilo o lo resuelve. ' +
      'Sin texto, lista los comentarios abiertos de `en` (o de todo el proyecto). ' +
      'Ejemplo: { "en": "m_3fkq2a9b#g7h8i9", "texto": "¿Probamos el título más corto?", "punto": { "x": 120, "y": 640 } } · { "responde_a": "c_1a2b3c4d5e", "texto": "Listo" } · { "resolver": "c_1a2b3c4d5e" }.',
    esquema: z.strictObject({
      proyecto,
      en: z.string().optional(),
      texto: z.string().optional(),
      punto: z.strictObject({ x: z.number(), y: z.number() }).optional().describe('Punto dentro del marco (px del marco) donde va el pin.'),
      responde_a: z.string().optional(),
      resolver: z.string().optional().describe('Id del comentario a resolver.'),
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const { sd, pid } = await ctxProyecto(s, a.proyecto)
      const ctx = { actor }
      if (a.resolver) {
        const c = await sd.actualizarComentario(ctx, pid, a.resolver, { resuelto: true })
        return `Comentario ${c.id} resuelto.`
      }
      if (a.texto) {
        const c = await sd.comentar(ctx, pid, { en: a.en, texto: a.texto, punto: a.punto, respondeA: a.responde_a })
        return `Comentario ${c.id} en ${c.objetivo}${c.x != null ? ` (punto ${Math.round(c.x)},${Math.round(c.y ?? 0)})` : ''}${c.respuestaA ? ` (respuesta a ${c.respuestaA})` : ''}.`
      }
      const lista = await sd.comentarios(pid, { objetivo: a.en, abiertos: true })
      if (!lista.length) return a.en ? `No hay comentarios abiertos en ${a.en}.` : 'No hay comentarios abiertos en el diseño.'
      return [`Comentarios abiertos (${lista.length}):`, ...lista.map((c) => `  ${c.id}${c.respuestaA ? ` ↳ ${c.respuestaA}` : ''} · ${c.objetivo} · ${c.autor.nombre} · ${c.creadoEn.slice(0, 16).replace('T', ' ')}: ${recortar(c.texto, 160)}`)].join(SEP)
    },
  }),

  definir({
    nombre: 'exportar_diseno',
    titulo: 'Exportar marcos',
    descripcion:
      'Exporta marcos en PNG, JPG o SVG (para web: se ve igual en un navegador; no es un vector editable). Elegí `marcos` (ids o nombres), un `grupo` (juego de variantes) o una `pagina`. ' +
      'Con `adjuntar_a` (clave de una tarjeta) los deja como adjuntos de esa tarjeta con nombre <pagina>-<marco>-<ancho>x<alto>@2x.png. Devuelve los enlaces de descarga. ' +
      'Ejemplo: { "grupo": "g_ab12cd34", "formato": "png", "escala": 2, "adjuntar_a": "YG-14" }.',
    esquema: z.strictObject({
      proyecto,
      marcos: z.array(z.string()).max(40).optional(),
      grupo: z.string().optional(),
      pagina: z.string().optional(),
      formato: z.enum(['png', 'jpg', 'svg']).default('png'),
      escala: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('1, 2 o 3 (de fábrica 1).'),
      sin_fondo: z.boolean().optional().describe('PNG con transparencia (sin el fondo del marco).'),
      adjuntar_a: z.string().optional().describe('Clave de la tarjeta donde dejarlos como adjuntos.'),
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const { sd, pid, prefijo } = await ctxProyecto(s, a.proyecto)
      let marcos: Marco[] = []
      if (a.marcos?.length) marcos = await Promise.all(a.marcos.map((x) => sd.resolverMarco(pid, x)))
      else if (a.grupo) {
        const filas = await sd.db.consulta(`select id from diseno_marcos where proyecto_id = $1 and grupo = $2 and archivado_en is null order by x, y`, [pid, a.grupo])
        if (!filas.length) throw new ErrorDominio(`No hay marcos en el grupo «${a.grupo}».`, 404)
        marcos = await Promise.all(filas.map((f) => sd.resolverMarco(pid, f.id)))
      } else if (a.pagina) {
        const { marcos: ms } = await sd.leerPagina(pid, a.pagina)
        marcos = await Promise.all(ms.slice(0, 40).map((m) => sd.resolverMarco(pid, m.id)))
      } else throw new ErrorDominio('Decí qué exportar: marcos, grupo o pagina.')
      const escala = a.escala ?? 1
      const lineas: string[] = []
      for (const m of marcos) {
        const pg = await sd.resolverPagina(pid, m.paginaId)
        const nombreArchivo = sd.nombreDeExporte(pg.nombre, m, escala, a.formato)
        const link = `${urlPublica()}/api/diseno/${prefijo}/marcos/${m.id}/render?formato=${a.formato}&escala=${escala}${a.sin_fondo ? '&sin_fondo=1' : ''}&descargar=1`
        if (a.adjuntar_a) {
          const r = await sd.render(pid, m.id, { formato: a.formato, escala, sinFondo: a.sin_fondo })
          await s.agregarAdjunto({ actor }, a.adjuntar_a, { nombre: nombreArchivo, datos: r.bytes!, mime: r.mime, descripcion: `Exportado de Diseño: «${m.nombre}» (rev ${m.revision})` })
          lineas.push(`  ${nombreArchivo} · ${a.formato === 'svg' ? `${m.ancho}×${m.alto}` : `${r.ancho}×${r.alto}`} · ${kb(r.bytes!.byteLength)} · adjuntado a ${a.adjuntar_a.toUpperCase()} · ${link}`)
        } else lineas.push(`  ${nombreArchivo} · ${Math.round(m.ancho * escala)}×${Math.round(m.alto * escala)} · ${link}`)
      }
      if (a.adjuntar_a) await sd.registrar({ actor }, pid, 'diseno.exportado', `exportó ${marcos.length} marco${marcos.length === 1 ? '' : 's'} y los adjuntó a ${a.adjuntar_a.toUpperCase()}`)
      return [`${marcos.length} marco${marcos.length === 1 ? '' : 's'} en ${a.formato.toUpperCase()} a ${escala}x${a.formato === 'svg' ? ' (SVG para web)' : ''}:`, ...lineas].join(SEP)
    },
  }),

  definir({
    nombre: 'sincronizar_diseno',
    titulo: 'Sincronizar el diseño con el código',
    descripcion:
      'Estado de la sincronización del sistema de diseño con el código del proyecto (última importación, cambios, si el dueño PIDIÓ sincronizar) y el COMANDO exacto para importar. ' +
      'Importar necesita leer archivos y a veces abrir un navegador: no se hace desde acá, se hace corriendo `npm run diseno:importar` en la carpeta de Telar, apuntando al repo del proyecto. ' +
      'Si el proyecto es el juego Restaurant City, sacar pantallas (--con-paginas) abre su interfaz de prueba en un navegador sin cabeza: hacelo solo si el dueño lo pidió (el campo "pedido" dice si lo hizo). ' +
      'Con `perfil` guarda el perfil de importación (lo armás mirando el repo: hojas, fuentes, imágenes, textos, pantallas). Con `hecho: true` borra el pedido después de importar. ' +
      'Esquema del perfil: { nombre, fuente: { clase: "repo" } | { clase: "web", base }, hojas: [globs css], raizClase?, fuentes: [{ familia, archivo, pesos, licencia? }], activos: [{ grupo, patron, indice?, agruparPor? }], ' +
      'excluir?: [globs del repo que nunca se suben: el material de terceros, como "assets/rc/**"], ' +
      'usos: [globs donde buscar usos], textos: [{ modulo, exporta, patronUso } | { json }], unidades: { "--hu": "qué es" }, vistas: { celular: { ancho, alto, densidad, tactil } }, ' +
      'pantallas: [{ pagina ("Celular" | "PC" | "*"), seccion, nombre, clave, vistas, url, acciones?: [{ clic } | { evaluar } | { esperar } | { tecla }], raiz?, esperar?, fondo? }], recetas? }. ' +
      'Para una web (Yaguar, Brain OS): fuente { clase: "web", base: "https://…" } y solo pantallas con sus url. ' +
      'Ejemplo: { "proyecto": "RC" }',
    esquema: z.strictObject({
      proyecto,
      perfil: z.unknown().optional().describe('El perfil de importación (ver el esquema en la descripción).'),
      hecho: z.boolean().optional().describe('Borra el pedido de sincronización.'),
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const { sd, pid, prefijo, nombre } = await ctxProyecto(s, a.proyecto)
      const lineas: string[] = []
      if (a.perfil !== undefined) {
        const r = esquemaPerfil.safeParse(a.perfil)
        if (!r.success) throw new ErrorDominio(`El perfil no es válido: ${r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'perfil'}: ${i.message}`).join('; ')}.`)
        await sd.guardarConfig({ actor }, pid, { perfil: r.data })
        lineas.push(`Perfil guardado: ${r.data.hojas.length} patrones de hojas, ${r.data.activos.length} de activos, ${r.data.fuentes.length} fuentes, ${r.data.pantallas.length} pantallas.`)
      }
      if (a.hecho) {
        await sd.guardarConfig({ actor }, pid, { hecho: true })
        lineas.push('Pedido de sincronización borrado.')
      }
      const r = await sd.resumen(pid)
      const sinc = r.sincronizacion
      const perfil = await sd.perfil(pid)
      lineas.push(
        `${nombre} (${prefijo}) · ${sinc.importacion ? `última importación: ${sinc.importacion}, ${sinc.importadoEn?.slice(0, 16).replace('T', ' ')}${sinc.origen?.repo ? ` desde ${sinc.origen.repo}` : ''}${sinc.origen?.rama ? ` (rama ${sinc.origen.rama}${sinc.origen.commit ? `, ${sinc.origen.commit.slice(0, 7)}` : ''})` : ''}` : 'nunca se importó'}`,
        `pedido: ${sinc.pedidoEn ? `sí, el ${sinc.pedidoEn.slice(0, 16).replace('T', ' ')} (el dueño lo pidió: esa es la autorización para esta vez)` : 'no'}`,
        `perfil: ${perfil ? `sí (${perfil.pantallas.length} pantallas, ${perfil.recetas ? 'con recetas de piezas' : 'sin recetas'})` : 'no (armalo mirando el repo y guardalo con perfil)'}`,
      )
      if (sinc.ultima?.cambios.length) {
        const c = sinc.ultima.cambios
        lineas.push(`cambios de la última: ${c.filter((x) => x.que === 'nuevo').length} nuevos, ${c.filter((x) => x.que === 'cambio').length} cambiados, ${c.filter((x) => x.que === 'quitado').length} quitados`)
      }
      const destino = urlPublica().startsWith('http://127.0.0.1') || urlPublica().startsWith('http://localhost') ? '' : ` --destino ${urlPublica()}`
      lineas.push(
        '',
        'Para importar (en la carpeta de Telar, donde esté el repo del proyecto):',
        `  npm run diseno:importar -- --proyecto ${prefijo} --repo <carpeta del repo>${destino}${sinc.pedidoEn ? ' --con-paginas' : ''}`,
        destino ? '  (con TABLERO_CLAVE=<la clave del MCP> en el entorno; nunca en el chat)' : '',
        '  --con-paginas saca además las pantallas y las piezas abriendo el proyecto en un navegador sin cabeza (solo con el pedido del dueño).',
        '  Al terminar: sincronizar_diseno { "hecho": true }.',
      )
      return lineas.filter((l) => l !== '').join(SEP)
    },
  }),
]

/** Lo que se suma a INSTRUCCIONES_MCP (corto: el detalle está en leer_guia { tema: "diseno" }). */
export const INSTRUCCIONES_DISENO = `- Diseño: páginas → marcos (HTML + CSS que dibuja un navegador) → capas, y un sistema (tokens con nombre y uso, estilos de texto, piezas, activos). leer_diseno → definir_tokens, subir_activo o definir_pieza → crear_marco con ver: true → arreglá los avisos con editar_marco → duplicar_marco para variantes y tamaños. Lo importado del código no se edita (se copia). Antes de decir que está listo, miralo con ver_diseno. Nunca subas material de terceros.`

// ───────── el sistema, en texto ─────────

async function leerSistema(sd: ServicioDiseno, pid: string, parte: string, grupo: string | undefined, desde: number): Promise<string> {
  if (parte === 'salud') return textoSalud(sd, pid)
  const tipo: TipoItem = (
    { tokens: 'token', estilos: 'estilo_texto', colores_sueltos: 'color_suelto', piezas: 'pieza', plantillas: 'plantilla', activos: 'activo', fuentes: 'fuente', textos: 'texto', hojas: 'hoja' } as Record<string, TipoItem>
  )[parte]!
  const r = await sd.items(pid, { tipo, grupo, desde, limite: 400 })
  if (!r.total) {
    const vacio: Record<string, string> = {
      token: 'Sin tokens. Definilos con definir_tokens (colores, medidas, sombras…).',
      estilo_texto: 'Sin estilos de texto. Definilos con definir_tokens (estilos_de_texto).',
      pieza: 'Sin piezas. Definí una con definir_pieza.',
      plantilla: 'Sin plantillas. Definí una con definir_pieza clase: "plantilla".',
      activo: 'Sin imágenes. Subilas con subir_activo.',
      fuente: 'Sin fuentes propias: los marcos usan las de sistema. Subí una con subir_activo (familia, pesos).',
    }
    return vacio[tipo] ?? `No hay ${parte}.`
  }
  const lineas: string[] = [`${parte} (${r.total}${grupo ? `, grupo ${grupo}` : ''}):`]
  let largo = 0
  let grupoActual: string | null = null
  let i = 0
  for (const it of r.items) {
    let l = ''
    const imp = it.origen === 'importado'
    switch (tipo) {
      case 'token': {
        const d = it.datos as DatosToken
        if (d.suelto) l = `${d.clase} ${d.valor} · ${d.veces ?? d.usos?.length ?? 0} usos${d.unidad ? ` · ${d.unidad}` : ''} · sin nombre`
        else l = `${it.clave}  ${imp ? d.css : `var(${d.css || variableDeToken(it.clave)})`}  ${d.alias ? `→ ${d.alias}` : d.valor}${d.modos ? ` · modos ${Object.entries(d.modos).map(([k, v]) => `${k}: ${v}`).join(', ')}` : ''}${imp ? ` · del código${d.alcance ? ` (${d.alcance})` : ''}, ${d.usos?.length ?? 0} usos${(d.declaradoEn?.length ?? 0) > 1 ? `, declarada en ${d.declaradoEn!.length} hojas` : ''}` : ''}${d.uso ? ` · ${d.uso}` : ''}`
        break
      }
      case 'estilo_texto': {
        const d = it.datos as ItemDiseno<'estilo_texto'>['datos']
        l = `${it.nombre}  ${imp ? '' : `.${claseDeEstilo(it.clave)}  `}${d.familia} ${d.peso} ${d.tamano}/${d.interlineado}${d.contorno ? ` · contorno ${d.contorno.color} ${d.contorno.grosor}` : ''}${d.color ? ` · ${d.color}` : ''}${imp ? ` · del código${d.veces ? `, ${d.veces} usos` : ''}` : ''}`
        break
      }
      case 'color_suelto': {
        const d = it.datos as DatosColorSuelto
        l = `${d.valor}  ${d.veces} usos${d.igualA ? ` · = ${d.igualA}` : ''}${d.cercaDe ? ` · a un paso de ${d.cercaDe}` : ''}${d.usos[0] ? ` · ej. ${d.usos[0].archivo}:${d.usos[0].linea}` : ''}`
        break
      }
      case 'pieza': {
        const d = it.datos as DatosPieza
        const props = d.propiedades.map((p) => `${p.nombre} (${p.clase === 'variante' ? (p.valores ?? []).join('|') : p.clase})`).join(', ')
        const ejemplo = Object.fromEntries(d.propiedades.map((p) => [p.nombre, p.defecto]))
        l = `${it.clave} ◆ ${it.nombre}${imp ? ' · del código' : ''}${d.variantes ? ` · ${Object.keys(d.variantes).length} variantes` : ''}${props ? ` · ${props}` : ''}${d.hojas.length ? ` · hojas ${d.hojas.join(', ')}` : ''} · <div data-pieza="${it.clave}" data-props='${JSON.stringify(ejemplo)}'></div>`
        break
      }
      case 'plantilla': {
        const d = it.datos as DatosPlantilla
        l = `${it.clave} · ${it.nombre} · ${d.ancho}×${d.alto} · ranuras: ${d.ranuras.map((x) => `${x.nombre} (${x.clase})`).join(', ') || 'ninguna'}`
        break
      }
      case 'activo': {
        const d = it.datos as DatosActivo
        l = `${it.clave}  ${d.ruta}  ${d.ancho}×${d.alto} · ${kb(d.peso)}${d.nota ? ` · ${recortar(d.nota, 50)}` : ''}${imp ? ` · ${d.usos?.length ?? 0} usos` : ''}`
        break
      }
      case 'fuente': {
        const d = it.datos as DatosFuente
        l = `${d.familia} · pesos ${d.pesos}${d.estilo === 'italic' ? ' · itálica' : ''} · font-family: "${d.familia}"${d.licencia ? ` · ${d.licencia}` : ''}`
        break
      }
      case 'texto': {
        const d = it.datos as DatosTexto
        l = `${it.clave}  "${recortar(d.valor, 90)}"${d.claveOriginal ? ` [${d.claveOriginal}]` : ''}${d.plantilla ? ' (con datos)' : ''}${d.usos ? ` · ${d.usos.length} usos` : ''}`
        break
      }
      case 'hoja': {
        const d = it.datos as DatosHoja
        l = `${it.clave} · ${d.reglas} reglas · ${kb(d.peso)}${d.archivo ? ` · ${d.archivo}` : ''}${d.ruta ? ` · ${d.ruta}` : ''}`
        break
      }
    }
    const cabecera = it.grupo !== grupoActual ? `── ${it.grupo || 'sin grupo'} ──${SEP}` : ''
    if (largo + l.length + cabecera.length > 5800 && i > 0) break
    grupoActual = it.grupo
    lineas.push(cabecera + `  ${l}`)
    largo += l.length + cabecera.length
    i++
  }
  const siguiente = desde + i
  if (siguiente < r.total) lineas.push(`… y ${r.total - siguiente} más. Pedí \`desde: ${siguiente}\``)
  return lineas.join(SEP)
}

export async function salud(sd: ServicioDiseno, pid: string) {
  const [colores, tokens, activos, textos] = await Promise.all(
    (['color_suelto', 'token', 'activo', 'texto'] as TipoItem[]).map((t) => sd.items(pid, { tipo: t, limite: 500 }).then(async (r) => {
      const todos = [...r.items]
      let sig = r.siguiente
      while (sig !== null) {
        const mas = await sd.items(pid, { tipo: t, limite: 500, desde: sig })
        todos.push(...mas.items)
        sig = mas.siguiente
      }
      return todos
    })),
  )
  const imp = <T extends ItemDiseno>(x: T[]) => x.filter((i) => i.origen === 'importado')
  const sinNombre = imp(colores!).filter((c) => !(c.datos as DatosColorSuelto).igualA)
  const aUnPaso = imp(colores!).filter((c) => (c.datos as DatosColorSuelto).cercaDe)
  const repetidas = imp(tokens!).filter((t) => ((t.datos as DatosToken).declaradoEn?.length ?? 0) > 1)
  const distintas = repetidas.filter((t) => new Set((t.datos as DatosToken).declaradoEn!.map((d) => d.valor)).size > 1)
  const activosSinUso = imp(activos!).filter((a) => !((a.datos as DatosActivo).usos?.length))
  const activosSinNota = imp(activos!).filter((a) => !(a.datos as DatosActivo).nota && !a.nota?.nota)
  const textosSinUso = imp(textos!).filter((t) => (t.datos as DatosTexto).usos && !(t.datos as DatosTexto).usos!.length)
  return { sinNombre, aUnPaso, repetidas, distintas, activosSinUso, activosSinNota, textosSinUso, total: { colores: colores!.length, tokens: tokens!.length, activos: activos!.length, textos: textos!.length } }
}

async function textoSalud(sd: ServicioDiseno, pid: string) {
  const s = await salud(sd, pid)
  const ej = (x: ItemDiseno[], n = 6) => x.slice(0, n).map((i) => i.clave).join(', ') + (x.length > n ? '…' : '')
  return [
    'Salud del sistema (lo que conviene ordenar en el código):',
    `  colores sin nombre: ${s.sinNombre.length}${s.sinNombre.length ? ` (${ej(s.sinNombre)})` : ''}`,
    `  colores a un paso de otro (ΔE < 2): ${s.aUnPaso.length}${s.aUnPaso.length ? ` (${s.aUnPaso.slice(0, 6).map((c) => `${c.clave}≈${(c.datos as DatosColorSuelto).cercaDe}`).join(', ')})` : ''}`,
    `  variables declaradas en más de una hoja: ${s.repetidas.length} (${s.distintas.length} con valores distintos${s.distintas.length ? `: ${ej(s.distintas)}` : ''})`,
    `  activos sin uso encontrado: ${s.activosSinUso.length}${s.activosSinUso.length ? ` (${ej(s.activosSinUso)})` : ''}`,
    `  activos sin nota: ${s.activosSinNota.length}`,
    `  textos sin uso: ${s.textosSinUso.length}${s.textosSinUso.length ? ` (${ej(s.textosSinUso)})` : ''}`,
    'Cada punto se puede volver tarjeta: proponé el cambio con una tarjeta del Kanban (crear_tarjeta) con su porqué.',
  ].join(SEP)
}

// ───────── bajar una imagen de una URL pública (sin direcciones internas) ─────────

function ipPrivada(ip: string): boolean {
  if (ip.includes(':')) {
    const b = ip.toLowerCase()
    return b === '::1' || b === '::' || b.startsWith('fc') || b.startsWith('fd') || b.startsWith('fe80') || b.startsWith('::ffff:127.') || b.startsWith('::ffff:10.') || b.startsWith('::ffff:192.168.')
  }
  const [a, b] = ip.split('.').map(Number) as [number, number]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

async function bajar(url: string, tope = 4 * 1024 * 1024): Promise<{ bytes: Uint8Array; mime: string }> {
  let actual: URL
  try {
    actual = new URL(url)
  } catch {
    throw new ErrorDominio(`«${url}» no es una URL.`)
  }
  for (let salto = 0; salto < 4; salto++) {
    if (actual.protocol !== 'https:') throw new ErrorDominio('Solo se bajan imágenes por https.')
    const host = actual.hostname.replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new ErrorDominio('No se bajan cosas de direcciones internas.')
    const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((x) => x.address)
    if (!ips.length) throw new ErrorDominio(`No encontré ${host}.`)
    if (ips.some(ipPrivada)) throw new ErrorDominio('No se bajan cosas de direcciones internas.')
    const r = await fetch(actual, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Telar-Diseno/1.0', accept: 'image/*,font/*,*/*;q=0.5' } }).catch((e) => {
      throw new ErrorDominio(`No pude bajar ${actual.href}: ${(e as Error).message}`)
    })
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      actual = new URL(r.headers.get('location')!, actual)
      continue
    }
    if (!r.ok) throw new ErrorDominio(`${actual.href} respondió ${r.status}.`)
    if (Number(r.headers.get('content-length') || 0) > tope) throw new ErrorDominio('Pesa más de 4 MB.', 413)
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (bytes.byteLength > tope) throw new ErrorDominio('Pesa más de 4 MB.', 413)
    return { bytes, mime: (r.headers.get('content-type') ?? '').split(';')[0]!.trim() }
  }
  throw new ErrorDominio('Demasiadas redirecciones.')
}
