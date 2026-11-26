// La foto del lienzo para ver_lienzo (MCP): qué área, con qué zoom y quién la saca. Vive al lado de render.ts porque usa
// su mismo Chromium (local, el Chrome de la computadora; online, la función render.func con el empaquetado).
//   · El área: un marco (con su título, que va arriba del marco), un rectángulo o todo el lienzo.
//   · El zoom: el pedido, o el que deja el lado mayor en 1600 px (nunca más de 100 %).
//   · Local se saca acá; online, la función principal (sin Chromium) se la pide a render.func por HTTP con la clave, como
//     ver_diseno (remoto.ts).
import { limites, type Rect } from '../../../compartido/geometria'
import { leerClave } from '../config'
import { ErrorDominio, type Servicio } from '../dominio/servicio'
import { fotografiarPagina, type ResultadoFotoPagina } from './render'
import { renderLocalDisponible } from './remoto'
import { urlPublica } from './urls'

/** Margen en px de pantalla alrededor del área (el mismo que usa la web: estado/foto.ts). */
const MARGEN_FOTO = 24
/** El lado mayor de la imagen si no se pide un zoom (px). */
const LADO_FOTO = 1600
/** Lo más grande que se dibuja (px por lado). */
const LADO_MAXIMO = 4000
/** Alto del título de un marco a zoom 100 % (lienzo.css, .marco__titulo) y cuánto lo agranda la web con zoom chico. */
const ALTO_TITULO = 40
const escalaTitulo = (zoom: number) => Math.min(4, Math.max(1, 0.85 / zoom))

export interface PedidoFotoLienzo {
  tableroId: string
  marco?: string
  area?: Rect
  zoom?: number
  tema: 'claro' | 'oscuro'
}

export interface FotoLienzo extends ResultadoFotoPagina {
  /** Qué se fotografió, en coordenadas del lienzo. */
  area: Rect
  zoom: number
  /** Qué es: «marco «X» (id)», «área …» o «todo el lienzo». */
  que: string
  url: string
}

/** Arma el pedido (área, zoom, ruta) y saca la foto donde se pueda. */
export async function fotoDeLienzo(s: Servicio, p: PedidoFotoLienzo): Promise<FotoLienzo> {
  const completo = await s.leerTableroCompleto(p.tableroId)
  const elementos = completo.elementos
  if (!elementos.length) throw new ErrorDominio(`El lienzo de «${completo.tablero.nombre}» está vacío: no hay nada que mirar.`, 404)
  let area: Rect
  let que: string
  let conTitulo = true
  if (p.marco) {
    const m = await s.resolverElemento(p.tableroId, p.marco)
    if (m.tipo !== 'marco') throw new ErrorDominio(`«${p.marco}» no es un marco: pasá el título o el id de un marco (los da leer_lienzo), o usá "area".`)
    area = { x: m.x, y: m.y, ancho: m.ancho, alto: m.alto }
    que = `marco «${String(m.datos.titulo ?? '') || m.id}» (${m.id})`
  } else if (p.area) {
    area = p.area
    que = `área ${area.x}, ${area.y} de ${area.ancho} × ${area.alto}`
    conTitulo = false
  } else {
    area = limites(elementos)!
    que = 'todo el lienzo'
  }
  const lado = Math.max(area.ancho, area.alto)
  const zoom = Math.round((p.zoom ?? Math.min(1, LADO_FOTO / lado)) * 1000) / 1000
  // El título de los marcos va arriba del marco: se suma su alto (agrandado con zoom chico, como en la web).
  const arriba = conTitulo ? ALTO_TITULO * escalaTitulo(zoom) : 0
  const foto: Rect = { x: area.x, y: area.y - arriba, ancho: area.ancho, alto: area.alto + arriba }
  const ancho = Math.ceil(foto.ancho * zoom + MARGEN_FOTO * 2)
  const alto = Math.ceil(foto.alto * zoom + MARGEN_FOTO * 2)
  if (Math.max(ancho, alto) > LADO_MAXIMO) {
    const posible = Math.floor(((LADO_MAXIMO - MARGEN_FOTO * 2) / Math.max(foto.ancho, foto.alto)) * 100) / 100
    throw new ErrorDominio(
      `Con zoom ${zoom} la imagen mediría ${ancho} × ${alto} px (el máximo es ${LADO_MAXIMO} por lado). Pedí zoom ${posible} o menos, o mirá un marco por vez ({ "marco": "…" }).`,
    )
  }
  const ruta = `/${encodeURIComponent(completo.proyecto.prefijo)}/${encodeURIComponent(completo.tablero.slug)}/lienzo?foto=${[foto.x, foto.y, zoom, foto.ancho, foto.alto].map((n) => Math.round(n * 100) / 100).join(',')}`
  const pedido = { ruta, ancho, alto, tema: p.tema }
  const r = renderLocalDisponible() ? await fotoLocal(pedido) : await fotoRemota(pedido)
  return { ...r, area, zoom, que, url: `${urlPublica()}/${completo.proyecto.prefijo}/${completo.tablero.slug}/lienzo` }
}

export interface PedidoInterno {
  ruta: string
  ancho: number
  alto: number
  tema: 'claro' | 'oscuro'
}

/** Con el Chromium de este proceso (la computadora, o la función render.func online). */
export async function fotoLocal(p: PedidoInterno): Promise<ResultadoFotoPagina> {
  if (!p.ruta.startsWith('/') || p.ruta.startsWith('//')) throw new ErrorDominio('La ruta de la foto tiene que ser de esta app.', 400)
  return fotografiarPagina({ ...p, base: urlPublica(), clave: leerClave() })
}

/** Online, desde la función principal: se la pide a render.func (que sí tiene Chromium). */
async function fotoRemota(p: PedidoInterno): Promise<ResultadoFotoPagina> {
  const clave = process.env.TABLERO_CLAVE
  if (!clave) throw new ErrorDominio('Falta TABLERO_CLAVE para pedirle la foto a la función de render.', 503)
  let r: Response
  try {
    r = await fetch(`${urlPublica()}/api/diseno/_/foto-lienzo-interna`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tablero-clave': clave },
      body: JSON.stringify(p),
      signal: AbortSignal.timeout(58_000),
    })
  } catch (e) {
    throw new ErrorDominio(`La función de render no contestó (${(e as Error).message}). Probá de nuevo en unos segundos: la primera vez tarda en arrancar.`, 503)
  }
  const datos = (await r.json().catch(() => null)) as (Omit<ResultadoFotoPagina, 'bytes'> & { bytes: string; error?: string }) | null
  if (!r.ok || !datos) throw new ErrorDominio(datos?.error ?? `La función de render respondió ${r.status}.`, r.status === 404 ? 503 : r.status)
  return { ...datos, bytes: new Uint8Array(Buffer.from(datos.bytes, 'base64')) }
}
