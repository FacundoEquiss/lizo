// La foto del lienzo (ver_lienzo, MCP), del lado de la web. Con `?foto=…` (estado/foto.ts) el lienzo se abre en el área
// pedida, sin barras y con todo el detalle (el nivel de detalle no esconde el texto aunque el zoom sea chico), y avisa
// cuándo terminó de dibujar: <html data-foto-lista>. Recién ahí el servidor saca la captura y lee la revisión
// (window.__telarFoto): lo que una persona notaría a simple vista en un diagrama recién armado.
//   · textos que se pisan (la letra de dos objetos ocupa el mismo lugar),
//   · objetos muy pegados (menos de 12 px entre dos con texto; las celdas de una tabla no cuentan) o pegados al borde de
//     su marco (menos de 16 px),
//   · el título de una sección que tapa algo cuando se aleja (crece para leerse: se revisa con zoom 25 %),
//   · formas que crecieron porque su texto no entra, objetos que se salen de su marco, y letra chica (menos de 12 px a zoom 100 %: en la PC se lee mal).
import type { ReactFlowInstance } from '@xyflow/react'
import { marcoDe, type Rect } from '../../../../compartido/geometria'
import type { ElementoLienzo } from '../../../../compartido/tipos'
import { FOTO } from '../../estado/foto'
import { useTienda } from '../../estado/tienda'
import { medicionesPendientes } from './texto/ajuste'
import type { AristaConector, NodoLienzo } from './tipos'

/** Separación mínima entre dos objetos con texto (px a zoom 100 %). */
const SEPARACION_MINIMA = 12
/** Lo que separa dos celdas de una tabla (px): menos que esto, alineadas, es a propósito. */
const CELDA = 4
/** Aire mínimo entre un objeto y el borde de su marco (px a zoom 100 %). */
const AIRE_MARCO = 16
/** Letra mínima que se lee bien en la PC a zoom 100 % (px). */
const LETRA_MINIMA = 12
/** Cuántos cuadros seguidos sin cambios hacen falta para dar la foto por lista. */
const CUADROS_QUIETOS = 12
/** Tope de espera: pasado esto se da por lista igual (y se avisa). */
const ESPERA_MAXIMA = 15_000 // ms
/** Lo mínimo antes de mirar si quedó quieto (que llegue el primer dibujo con los datos). */
const ESPERA_MINIMA = 300 // ms
const MAX_AVISOS = 24
/** El zoom con que se mira un diagrama entero en una pantalla chica: ahí se revisa el título de las secciones. */
const ZOOM_LEJOS = 0.25
/** Cuánto agranda la web el título de un marco con cada zoom (lienzo.css, --escala-titulo). */
const escalaTitulo = (zoom: number) => Math.min(4, Math.max(1, 0.85 / zoom))

type Revision = { avisos: string[]; objetos: number }
declare global {
  interface Window {
    __telarFoto?: Revision
  }
}

const recorte = (t: string) => {
  const s = t.replace(/\s+/g, ' ').trim()
  return s.length > 40 ? `${s.slice(0, 39)}…` : s
}

/** El nombre con que se reconoce un objeto en un aviso: su texto (o su tipo) y su id. */
function nombre(e: ElementoLienzo, texto: string): string {
  const t = recorte(texto || String(e.datos.titulo ?? ''))
  return `${t ? `«${t}»` : e.tipo} (${e.id})`
}

const separacion = (a: Rect, b: Rect) => {
  const dx = Math.max(b.x - (a.x + a.ancho), a.x - (b.x + b.ancho), 0)
  const dy = Math.max(b.y - (a.y + a.alto), a.y - (b.y + b.alto), 0)
  // Solo cuenta si están enfrentados (uno al lado del otro o uno arriba del otro), no en diagonal.
  if (dx > 0 && dy > 0) return Infinity
  return Math.max(dx, dy)
}
/** Dos celdas de una tabla: pegadas a propósito (a lo sumo CELDA px), del mismo alto en una fila o del mismo ancho en una columna. */
const alineados = (a: Rect, b: Rect) =>
  (Math.abs(a.y - b.y) <= 1 && Math.abs(a.alto - b.alto) <= 1) || (Math.abs(a.x - b.x) <= 1 && Math.abs(a.ancho - b.ancho) <= 1)
const solapan = (a: Rect, b: Rect, tol = 2) =>
  a.x + tol < b.x + b.ancho && b.x + tol < a.x + a.ancho && a.y + tol < b.y + b.alto && b.y + tol < a.y + a.alto

/** Lo que una persona notaría a simple vista en el área de la foto. */
export function revisarFoto(rf: ReactFlowInstance<NodoLienzo, AristaConector>): Revision {
  const pedido = FOTO!
  const area: Rect = { x: pedido.x, y: pedido.y, ancho: pedido.ancho, alto: pedido.alto }
  const elementos = useTienda.getState().tablero?.elementos ?? []
  const marcos = elementos.filter((e) => e.tipo === 'marco')
  const { zoom } = rf.getViewport()
  const aLienzo = (r: DOMRect): Rect => {
    const p = rf.screenToFlowPosition({ x: r.left, y: r.top }, { snapToGrid: false })
    return { x: p.x, y: p.y, ancho: r.width / zoom, alto: r.height / zoom }
  }
  // De lo más grave a lo menos: así, si hay muchos, se ve primero lo que más importa.
  const avisos: Record<'pisan' | 'titulos' | 'fuera' | 'pegados' | 'borde' | 'letra', string[]> = {
    pisan: [],
    titulos: [],
    fuera: [],
    pegados: [],
    borde: [],
    letra: [],
  }
  const objetos: { e: ElementoLienzo; caja: Rect; texto: string; letra: Rect | null; conCaja: boolean }[] = []
  const titulos: { e: ElementoLienzo; rect: Rect; alto: number }[] = []
  for (const e of elementos) {
    const el = document.querySelector<HTMLElement>(`.lienzo .react-flow__node[data-id="${CSS.escape(e.id)}"]`)
    // La caja real (una forma crece si el texto no entra); si no está dibujado, la guardada.
    let caja = el ? aLienzo(el.getBoundingClientRect()) : { x: e.x, y: e.y, ancho: e.ancho, alto: e.alto }
    if (e.tipo === 'marco') {
      // Una sección (un marco adentro de otro): su título va arriba y crece al alejar (lienzo.css, .marco__titulo). Se
      // revisa como se ve con el diagrama entero en una pantalla chica (ZOOM_LEJOS): lo que tape ahí, se tapa.
      const t = el?.querySelector('.marco__titulo')
      if (!t || !marcoDe(e, marcos)) continue
      const r = aLienzo(t.getBoundingClientRect())
      const factor = escalaTitulo(ZOOM_LEJOS) / escalaTitulo(zoom)
      const alto = r.alto * factor
      const rect = { x: e.x, y: e.y - alto, ancho: Math.min(e.ancho, r.ancho * factor), alto }
      if (solapan(rect, area, 0)) titulos.push({ e, rect, alto: Math.round(alto) })
      continue
    }
    if (!solapan(caja, area, 0)) continue
    // Una forma crece hacia abajo si su texto no entra (Forma.tsx): en un diagrama planeado, eso encima lo de abajo.
    const textoForma = el?.querySelector<HTMLElement>('.rico')?.innerText.trim() ?? ''
    if (e.tipo === 'forma' && textoForma && caja.alto > e.alto + 2)
      avisos.fuera.push(`el texto no entra en ${nombre(e, textoForma)}: la forma creció de ${e.alto} a ${Math.round(caja.alto)} px de alto (agrandala, achicá la letra o acortá el texto)`)
    const rico = el?.querySelector<HTMLElement>('.rico')
    const texto = rico?.innerText ?? String(e.datos.texto ?? '')
    let letra: Rect | null = null
    if (rico && texto.trim()) {
      // La caja de la letra de verdad (no la de la zona de texto): un rango sobre el contenido.
      const rango = document.createRange()
      rango.selectNodeContents(rico)
      const r = rango.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) letra = aLienzo(r)
      const px = parseFloat(getComputedStyle(rico).fontSize)
      if (px && px < LETRA_MINIMA) avisos.letra.push(`letra chica en ${nombre(e, texto)}: ${Math.round(px * 10) / 10} px a zoom 100 % (en la PC se lee mal; usá 14 o más)`)
    }
    // Un texto suelto no tiene caja a la vista: dos textos a 10 px (un título y su bajada) se leen bien.
    objetos.push({ e, caja, texto, letra, conCaja: e.tipo !== 'texto' })
  }

  for (let i = 0; i < objetos.length; i++) {
    const a = objetos[i]!
    for (let j = i + 1; j < objetos.length; j++) {
      const b = objetos[j]!
      if (a.letra && b.letra && solapan(a.letra, b.letra)) {
        avisos.pisan.push(`textos que se pisan: ${nombre(a.e, a.texto)} y ${nombre(b.e, b.texto)}`)
        continue
      }
      if (!(a.conCaja || b.conCaja) || !a.texto.trim() || !b.texto.trim() || solapan(a.caja, b.caja, 0)) continue
      const d = separacion(a.caja, b.caja)
      if (d >= SEPARACION_MINIMA || (d <= CELDA && alineados(a.caja, b.caja))) continue
      avisos.pegados.push(`muy pegados (${Math.round(d)} px): ${nombre(a.e, a.texto)} y ${nombre(b.e, b.texto)}; dejá ${SEPARACION_MINIMA * 2} px o más`)
    }
    for (const t of titulos) {
      if (marcoDe({ ...a.caja, id: a.e.id, tipo: a.e.tipo }, marcos)?.id === t.e.id) continue
      const d = solapan(a.caja, t.rect, 0) ? 0 : separacion(a.caja, t.rect)
      if (d >= SEPARACION_MINIMA) continue
      avisos.titulos.push(
        `${nombre(a.e, a.texto)} ${d ? `queda a ${Math.round(d)} px del` : 'tapa el'} título de la sección «${recorte(String(t.e.datos.titulo ?? ''))}» al ver el diagrama entero (el título crece al alejar: ${t.alto} px de alto con zoom ${ZOOM_LEJOS * 100} %); dejá ${t.alto + SEPARACION_MINIMA * 2} px libres arriba de la sección`,
      )
    }
    const m = marcoDe({ ...a.caja, id: a.e.id, tipo: a.e.tipo }, marcos)
    if (!m) continue
    const fuera = [a.caja.x < m.x, a.caja.y < m.y, a.caja.x + a.caja.ancho > m.x + m.ancho, a.caja.y + a.caja.alto > m.y + m.alto]
    const titulo = recorte(String(m.datos.titulo ?? '')) || m.id
    if (fuera.some(Boolean)) {
      avisos.fuera.push(`${nombre(a.e, a.texto)} se sale del marco «${titulo}»: agrandá el marco o movelo adentro`)
      continue
    }
    const aire = Math.min(a.caja.x - m.x, a.caja.y - m.y, m.x + m.ancho - (a.caja.x + a.caja.ancho), m.y + m.alto - (a.caja.y + a.caja.alto))
    if (aire < AIRE_MARCO) avisos.borde.push(`pegado al borde del marco «${titulo}» (${Math.round(aire)} px): ${nombre(a.e, a.texto)}; dejá 24 px o más`)
  }
  // Una sección debajo de otra: su título no puede tapar a la de arriba.
  for (const t of titulos)
    for (const o of titulos) {
      if (o === t || !solapan({ ...o.e }, t.rect, 0) || marcoDe(t.e, marcos)?.id === o.e.id) continue
      avisos.titulos.push(`el título de la sección «${recorte(String(t.e.datos.titulo ?? ''))}» tapa la sección «${recorte(String(o.e.datos.titulo ?? ''))}» al ver el diagrama entero (${t.alto} px de alto con zoom ${ZOOM_LEJOS * 100} %): separalas ${t.alto + SEPARACION_MINIMA * 2} px`)
    }
  const unicos = [...new Set(Object.values(avisos).flat())]
  const salida = unicos.slice(0, MAX_AVISOS)
  if (unicos.length > MAX_AVISOS) salida.push(`… y ${unicos.length - MAX_AVISOS} avisos más: arreglá estos y volvé a mirar`)
  return { avisos: salida, objetos: objetos.length }
}

/**
 * Espera a que el lienzo termine de dibujar (fuentes cargadas, cajas medidas, imágenes bajadas y nada cambiando durante
 * unos cuadros) y marca <html data-foto-lista> con la revisión en window.__telarFoto.
 */
export function esperarFoto(rf: ReactFlowInstance<NodoLienzo, AristaConector>): () => void {
  let vivo = true
  let quietos = 0
  let firma = ''
  const inicio = performance.now()
  const terminar = (tarde: boolean) => {
    const r = revisarFoto(rf)
    if (tarde) r.avisos.unshift('la foto salió antes de que el lienzo terminara de dibujar: probá de nuevo')
    window.__telarFoto = r
    document.documentElement.dataset.fotoLista = 'si'
  }
  const paso = () => {
    if (!vivo) return
    const nodos = document.querySelectorAll('.lienzo .react-flow__node')
    // React Flow deja ocultos los nodos que todavía no midió (solo están en el DOM los que se ven).
    const sinMedir = [...nodos].filter((n) => (n as HTMLElement).style.visibility === 'hidden').length
    const imagenes = [...document.images].filter((i) => !i.complete).length
    const ahora = `${nodos.length}|${sinMedir}|${imagenes}|${medicionesPendientes()}|${document.fonts.status}`
    const listo = performance.now() - inicio > ESPERA_MINIMA && sinMedir === 0 && imagenes === 0 && medicionesPendientes() === 0 && document.fonts.status === 'loaded'
    quietos = listo && ahora === firma ? quietos + 1 : 0
    firma = ahora
    if (quietos >= CUADROS_QUIETOS) return terminar(false)
    if (performance.now() - inicio > ESPERA_MAXIMA) return terminar(true)
    requestAnimationFrame(paso)
  }
  requestAnimationFrame(paso)
  return () => {
    vivo = false
  }
}
