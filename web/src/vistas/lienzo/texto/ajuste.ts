// Tamaño automático de la letra (notas, y formas con "automático"): el más grande, entre 10 y 64 px, con el que todo el
// texto entra en la caja sin cortar ninguna palabra. Búsqueda en pasos de 0,5 px sobre un medidor oculto con el
// mismo ancho, fuente e interlineado (una copia del texto tal como está en pantalla, con sus listas y negritas).
// El resultado va a una caché: no se guarda en la base porque es derivado.
import { useLayoutEffect, useState, type RefObject } from 'react'
import type { Fuente } from '../../../../../compartido/lienzo'
import { useFuentesCargadas, versionFuente } from './fuentes'

export const AJUSTE_MIN = 10
export const AJUSTE_MAX = 64
const MAX_CACHE = 2000

const cache = new Map<string, number>()

function guardar(clave: string, px: number) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!)
  cache.set(clave, px)
}

let medidor: HTMLDivElement | null = null
function caja(): HTMLDivElement {
  if (!medidor || !medidor.isConnected) {
    medidor = document.createElement('div')
    medidor.className = 'medidor-texto'
    medidor.setAttribute('aria-hidden', 'true')
    medidor.appendChild(document.createElement('div'))
    document.body.appendChild(medidor)
  }
  return medidor.firstChild as HTMLDivElement
}

export interface MedidasAjuste {
  /** El espacio para el texto (sin el padding). */
  ancho: number
  alto: number
  fuente: Fuente
  interlineado: number
  /** Peso base y espaciado de la letra (la negrita suma sobre el peso). */
  peso: number
  espaciado: string
}

/**
 * Mide el tamaño que entra, copiando el texto de `rico` (el .rico de la vista o del editor). `desde` es el tamaño con el
 * que se empieza a buscar (la aproximación, o el que tenía antes de cambiar el texto).
 */
export function medirAjuste(rico: HTMLElement, m: MedidasAjuste, desde: number = AJUSTE_MIN): number {
  const c = caja()
  // scrollWidth y scrollHeight vienen redondeados: con un píxel de margen, una palabra que mide 142,4 px no "entra" en
  // 142 (y en la nota, que sí corta palabras, se partiría).
  const ancho = Math.max(1, m.ancho - 1)
  const alto = Math.max(1, m.alto - 1)
  c.style.width = `${ancho}px`
  c.style.fontFamily = `var(--f-${m.fuente})`
  c.style.lineHeight = String(m.interlineado)
  c.style.letterSpacing = m.espaciado
  c.style.setProperty('--peso', String(m.peso))
  c.style.fontWeight = String(m.peso)
  // La copia no es editable: escribiendo, `rico` es el editor (contenteditable), y en pantallas táctiles la regla de
  // "ningún campo con letra de menos de 16 px" (movil.css) le fijaba la letra a la copia: todo "entraba" y la nota salía
  // siempre con la letra máxima (crecía hacia abajo mientras se escribía).
  const copia = rico.cloneNode(true) as HTMLElement
  copia.removeAttribute('contenteditable')
  c.replaceChildren(copia)

  // En medios píxeles: el más grande que se sabe que entra (`bajo`) y el más chico que se sabe que no (`tope`). Cada
  // prueba fuerza un layout del medidor: antes era una búsqueda binaria entre 10 y 64 px (9 pruebas por caja); ahora se
  // arranca de `desde`, se corrige con lo que midió y se busca alrededor (5 pruebas en promedio, medido en 1.092 cajas
  // con el mismo resultado que la búsqueda binaria). Da lo mismo: el más grande que entra.
  const MIN = AJUSTE_MIN * 2
  const MAX = AJUSTE_MAX * 2
  let bajo = MIN - 1
  let tope = MAX + 1
  const probar = (medios: number) => {
    c.style.fontSize = `${medios / 2}px`
    const h = c.scrollHeight
    const w = c.scrollWidth
    if (h <= alto && w <= ancho) bajo = Math.max(bajo, medios)
    else tope = Math.min(tope, medios)
    return { h, w }
  }
  const inicio = Math.min(MAX, Math.max(MIN, Math.round(desde * 2)))
  const { h, w } = probar(inicio)
  // El alto del texto crece más o menos con el cuadrado de la letra (renglones más altos y más renglones); una palabra
  // que no entra a lo ancho, en proporción.
  const factor = Math.min(Math.sqrt(alto / Math.max(1, h)), ancho / Math.max(1, w))
  const prevision = Math.min(MAX, Math.max(MIN, Math.floor(inicio * factor)))
  if (prevision > bajo && prevision < tope) probar(prevision)
  // Alrededor: hacia arriba o hacia abajo con pasos que se duplican hasta encerrar el tamaño, y después a la mitad.
  let paso = 1
  while (tope - bajo > 1) {
    if (tope > MAX) probar(Math.min(MAX, bajo + paso))
    else if (bajo < MIN) probar(Math.max(MIN, tope - paso))
    else probar((bajo + tope) >> 1)
    paso *= 2
  }
  c.replaceChildren()
  return bajo < MIN ? AJUSTE_MIN : bajo / 2
}

/** Una primera aproximación (antes de medir), por la cantidad de letras: evita un salto grande en el primer cuadro. */
export function estimarAjuste(caracteres: number, ancho: number, alto: number): number {
  const area = Math.max(1, ancho * alto)
  const px = Math.sqrt(area / Math.max(1, caracteres) / 0.62)
  return Math.max(AJUSTE_MIN, Math.min(AJUSTE_MAX, Math.round(px * 2) / 2, ancho / 4))
}

// ───────── medir de a poco (9.4) ─────────
// Medir es caro (cada paso de la búsqueda fuerza un layout): con mil notas en pantalla, medirlas todas al abrir el
// lienzo lo hacía tardar segundos. Lejos (zoom < 0,3, donde la letra apenas se ve) las cajas salen con la aproximación y
// se miden en los cuadros siguientes, unos milisegundos por cuadro; de cerca se mide en el momento, como siempre.

const pendientes = new Map<string, () => void>()
let programado = false

function trabajar() {
  const inicio = performance.now()
  for (const [clave, medir] of pendientes) {
    pendientes.delete(clave)
    medir()
    if (performance.now() - inicio > 6) break
  }
  programado = pendientes.size > 0
  if (programado) requestAnimationFrame(trabajar)
}

/** Mide en los cuadros siguientes (unos milisegundos por cuadro). La clave reemplaza un pedido anterior igual. */
export function medirDespues(clave: string, medir: () => void) {
  pendientes.set(clave, medir)
  if (!programado) {
    programado = true
    requestAnimationFrame(trabajar)
  }
}

/**
 * El tamaño automático de una caja de texto. `clave` describe el contenido (el documento) y `ref` es la caja en
 * pantalla, de donde se copia el texto para medir. Se vuelve a medir cuando cambia el contenido, el espacio, la fuente
 * o el interlineado (o cuando termina de cargar la fuente). Con `activo` en falso no mide (tamaño manual).
 */
export function useAjuste(
  ref: RefObject<HTMLElement | null>,
  contenido: string,
  m: MedidasAjuste,
  activo: boolean,
  caracteres: number,
  /** Lejos: medir en los cuadros siguientes (el componente lo sabe por ContextoNivel). */
  diferir = false,
): number {
  // Cuando termina de cargar una fuente, lo que la usa se vuelve a medir (cambia la clave).
  useFuentesCargadas()
  const clave = `${m.fuente}:${versionFuente(m.fuente)}|${Math.round(m.ancho)}x${Math.round(m.alto)}|${m.interlineado}|${contenido}`
  const [medido, setMedido] = useState<{ clave: string; px: number } | null>(null)
  const enCache = cache.get(clave)
  const usado = enCache ?? (medido?.clave === clave ? medido.px : estimarAjuste(caracteres, m.ancho, m.alto))
  useLayoutEffect(() => {
    if (!activo) return
    // Varias cajas con el mismo contenido se dibujan juntas antes de que la primera mida: las demás toman de la caché
    // lo que midió la primera (y se vuelven a dibujar si habían salido con la aproximación).
    const px = cache.get(clave)
    if (px !== undefined) {
      if (px !== usado) setMedido({ clave, px })
      return
    }
    let vivo = true
    const medir = () => {
      if (!vivo) return
      let r = cache.get(clave)
      if (r === undefined) {
        const rico = ref.current?.querySelector<HTMLElement>('.rico')
        if (!rico) return
        r = medirAjuste(rico, m, usado)
        guardar(clave, r)
      }
      if (r !== usado) setMedido({ clave, px: r })
    }
    if (diferir) medirDespues(`${clave}#${Math.random()}`, medir)
    else medir()
    return () => {
      vivo = false
    }
    // m se resume en la clave; usado es lo que salió en este dibujo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, activo, usado])
  if (!activo) return AJUSTE_MIN
  return usado
}

/** Cuántas cajas esperan su medida (la foto del lienzo espera a que no quede ninguna). */
export const medicionesPendientes = () => pendientes.size
