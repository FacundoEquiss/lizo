// Crear con clic o con arrastre, y el fantasma que sigue al cursor (5.1). Con una herramienta de creación activa, un
// movimiento de menos de 6 px es un clic (tamaño de fábrica) y uno mayor dibuja el objeto con ese tamaño. Eventos de
// puntero: sirve igual con mouse, lápiz o dedo. La posición del fantasma se escribe directo al estilo (sin renders).
import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { MINIMOS, TAMANOS } from '../../../../compartido/lienzo'
import type { TipoElemento } from '../../../../compartido/tipos'
import { usePreferencias } from '../../estado/preferencias'
import { useTienda, type Herramienta } from '../../estado/tienda'
import type { AccionesLienzo } from './acciones'
import { trazoForma } from './nodos/formas'
import type { AristaConector, NodoLienzo } from './tipos'

export const HERRAMIENTAS_CREACION: Herramienta[] = ['nota', 'texto', 'forma', 'marco', 'tarjeta']
export const esCreacion = (h: Herramienta) => HERRAMIENTAS_CREACION.includes(h)

/** Tamaño con el que se crea cada cosa con un clic. */
export const TAMANO_CLIC: Partial<Record<Herramienta, { ancho: number; alto: number }>> = {
  nota: TAMANOS.nota,
  forma: TAMANOS.forma,
  tarjeta: { ancho: 288, alto: 120 },
  marco: { ancho: 960, alto: 640 },
  texto: { ancho: 240, alto: 32 },
}

/** Qué herramientas muestran el fantasma bajo el cursor (Texto y Marco van con cursor en cruz). */
const CON_FANTASMA: Herramienta[] = ['nota', 'forma', 'tarjeta']

interface Arrastre {
  herramienta: Herramienta
  pid: number
  sx: number
  sy: number
  inicio: { x: number; y: number }
  dibujando: boolean
}

export interface OpcionesCrear {
  contenedor: RefObject<HTMLDivElement | null>
  fantasma: RefObject<HTMLDivElement | null>
  acciones: AccionesLienzo
  /** Con la herramienta Tarjeta: abrir el compositor en ese punto (pantalla y lienzo). */
  alTarjeta: (pantalla: { x: number; y: number }, punto: { x: number; y: number }) => void
}

/** Datos de fábrica de un objeto nuevo (preferencias.estilos). */
export function datosNuevos(tipo: TipoElemento, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const e = usePreferencias.getState().estilos
  switch (tipo) {
    case 'nota':
      return { texto: '', ...e.nota, ...extra }
    case 'texto':
      return { texto: '', ...e.texto, ...extra }
    case 'forma':
      return { texto: '', ...e.forma, ...extra }
    case 'marco':
      return { titulo: 'Marco nuevo', ...e.marco, ...extra }
    default:
      return { ...extra }
  }
}

/**
 * Crear con el teclado (9.3): con una herramienta de creación elegida, Enter pone el objeto en el centro de lo que se
 * ve, del tamaño de un clic, y entra a editarlo. La tarjeta abre su compositor ahí (`alTarjeta`).
 */
export async function crearConTeclado(acciones: AccionesLienzo, h: Herramienta, alTarjeta: (punto: { x: number; y: number }) => void) {
  const c = acciones.centro()
  if (h === 'tarjeta') return alTarjeta(c)
  const t = TAMANO_CLIC[h]
  if (!t) return
  const tipo = h as TipoElemento
  const extra = h === 'texto' ? { anchoAuto: true } : {}
  const id = await acciones.crear(tipo, c.x - t.ancho / 2, c.y - t.alto / 2, datosNuevos(tipo, extra), { ancho: t.ancho, alto: t.alto, ...(h === 'marco' ? { z: 0 } : {}) })
  despuesDeCrear(id, true)
}

/** Después de crear: queda seleccionado y en edición; la herramienta vuelve a Seleccionar salvo que esté fija. */
export function despuesDeCrear(id: string | null, editar: boolean) {
  const s = useTienda.getState()
  if (!s.herramientaFija) s.setHerramienta('seleccionar')
  if (id && editar) s.setEditando(id)
}

/**
 * Después de crear con el puntero, el navegador manda un "click" al fondo o al objeto de abajo: React Flow lo usaría
 * para soltar la edición o seleccionar lo de abajo. Se descarta ese único clic.
 */
function tragarClicSiguiente() {
  const fn = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    window.removeEventListener('click', fn, true)
  }
  window.addEventListener('click', fn, true)
  setTimeout(() => window.removeEventListener('click', fn, true), 400)
}

export function useCrearConPuntero({ contenedor, fantasma, acciones, alTarjeta }: OpcionesCrear) {
  const rf = useReactFlow<NodoLienzo, AristaConector>()
  const arrastre = useRef<Arrastre | null>(null)
  const cuadro = useRef<number | null>(null)
  const ultimo = useRef<{ x: number; y: number } | null>(null)
  const ultimoEvento = useRef<PointerEvent | null>(null)

  /** Dibuja el fantasma: el tamaño de fábrica bajo el cursor, o el rectángulo que se está arrastrando. */
  const dibujar = useCallback(() => {
    cuadro.current = null
    const el = fantasma.current
    const p = ultimo.current
    const h = useTienda.getState().herramienta
    if (!el || !p) return
    const a = arrastre.current
    if (a?.dibujando) {
      const fin = rf.screenToFlowPosition(p)
      let x = Math.min(a.inicio.x, fin.x)
      let y = Math.min(a.inicio.y, fin.y)
      let w = Math.abs(fin.x - a.inicio.x)
      let alto = Math.abs(fin.y - a.inicio.y)
      if (a.herramienta === 'texto') {
        alto = 32
        y = a.inicio.y - 16
      }
      if ((a.herramienta === 'nota' || a.herramienta === 'forma') && (ultimoEvento.current?.shiftKey ?? false)) {
        const lado = Math.max(w, alto)
        if (fin.x < a.inicio.x) x = a.inicio.x - lado
        if (fin.y < a.inicio.y) y = a.inicio.y - lado
        w = alto = lado
      }
      el.dataset.modo = 'dibujando'
      el.dataset.herramienta = a.herramienta
      el.style.clipPath = ''
      el.dataset.estilo = ''
      el.style.transform = `translate(${x}px, ${y}px)`
      el.style.width = `${w}px`
      el.style.height = `${alto}px`
      const medidas = el.firstElementChild as HTMLElement | null
      if (medidas) medidas.textContent = `${Math.round(w)} × ${Math.round(alto)}`
      return
    }
    if (!CON_FANTASMA.includes(h)) {
      el.dataset.modo = 'oculto'
      return
    }
    const t = TAMANO_CLIC[h]!
    const pos = rf.screenToFlowPosition(p)
    const estilos = usePreferencias.getState().estilos
    const f = estilos.forma
    const clave = `${estilos.nota.color}${f.forma}${f.relleno}${f.tono}`
    if (el.dataset.herramienta !== h || el.dataset.estilo !== clave) {
      el.dataset.estilo = clave
      if (h === 'nota') el.style.setProperty('--fantasma', `var(--n-${estilos.nota.color})`)
      if (h === 'forma')
        el.style.setProperty('--fantasma', f.relleno === 'ninguno' ? 'var(--c-texto-3)' : f.tono === 'fuerte' ? `var(--e-${f.relleno}-s)` : `var(--e-${f.relleno})`)
      el.style.clipPath = h === 'forma' ? `path('${trazoForma(estilos.forma.forma, t.ancho, t.alto)}')` : ''
    }
    el.dataset.modo = 'siguiendo'
    el.dataset.herramienta = h
    el.style.transform = `translate(${pos.x - t.ancho / 2}px, ${pos.y - t.alto / 2}px)`
    el.style.width = `${t.ancho}px`
    el.style.height = `${t.alto}px`
  }, [rf, fantasma])

  const pedirCuadro = useCallback(() => {
    if (cuadro.current === null) cuadro.current = requestAnimationFrame(dibujar)
  }, [dibujar])

  // El fantasma sigue al cursor por el lienzo y se esconde al salir.
  useEffect(() => {
    const el = contenedor.current
    if (!el) return
    const mover = (ev: PointerEvent) => {
      ultimo.current = { x: ev.clientX, y: ev.clientY }
      ultimoEvento.current = ev
      const fuera = (ev.target as HTMLElement).closest('.react-flow__panel, .panel-tarjetas, .buscador, .barra-ctx, .composer-lienzo, .lienzo-vacio')
      if (fuera && !arrastre.current) {
        if (fantasma.current) fantasma.current.dataset.modo = 'oculto'
        return
      }
      if (esCreacion(useTienda.getState().herramienta) || arrastre.current) pedirCuadro()
    }
    const salir = () => {
      if (!arrastre.current && fantasma.current) fantasma.current.dataset.modo = 'oculto'
    }
    el.addEventListener('pointermove', mover)
    el.addEventListener('pointerleave', salir)
    const quitar = useTienda.subscribe((s, antes) => {
      if (s.herramienta !== antes.herramienta) pedirCuadro()
    })
    return () => {
      el.removeEventListener('pointermove', mover)
      el.removeEventListener('pointerleave', salir)
      quitar()
    }
  }, [contenedor, fantasma, pedirCuadro])

  const terminar = useCallback(
    async (a: Arrastre, fin: { x: number; y: number }, shift: boolean, pantalla: { x: number; y: number }) => {
      const h = a.herramienta
      if (fantasma.current) fantasma.current.dataset.modo = 'oculto'
      if (h === 'tarjeta') {
        alTarjeta(pantalla, a.inicio)
        return
      }
      const tipo = h as TipoElemento
      const min = MINIMOS[tipo]
      if (!a.dibujando) {
        // Clic: tamaño de fábrica. Nota y forma centradas en el cursor; texto y marco con la esquina en el cursor.
        const t = TAMANO_CLIC[h]!
        const centrado = h === 'nota' || h === 'forma'
        const x = centrado ? a.inicio.x - t.ancho / 2 : a.inicio.x
        const y = centrado ? a.inicio.y - t.alto / 2 : h === 'texto' ? a.inicio.y - 16 : a.inicio.y
        const extra = h === 'texto' ? { anchoAuto: true } : {}
        const id = await acciones.crear(tipo, x, y, datosNuevos(tipo, extra), { ancho: t.ancho, alto: t.alto, ...(h === 'marco' ? { z: 0 } : {}) })
        despuesDeCrear(id, true)
        return
      }
      let x = Math.min(a.inicio.x, fin.x)
      let y = Math.min(a.inicio.y, fin.y)
      let w = Math.max(Math.abs(fin.x - a.inicio.x), min.ancho)
      let alto = Math.max(Math.abs(fin.y - a.inicio.y), min.alto)
      if (shift && (h === 'nota' || h === 'forma')) {
        const lado = Math.max(w, alto)
        if (fin.x < a.inicio.x) x = a.inicio.x - lado
        if (fin.y < a.inicio.y) y = a.inicio.y - lado
        w = alto = lado
      }
      if (h === 'texto') {
        const id = await acciones.crear('texto', x, a.inicio.y - 16, datosNuevos('texto', { anchoAuto: false }), { ancho: w, alto: 32 })
        despuesDeCrear(id, true)
        return
      }
      const id = await acciones.crear(tipo, x, y, datosNuevos(tipo), { ancho: w, alto, ...(h === 'marco' ? { z: 0 } : {}) })
      despuesDeCrear(id, true)
    },
    [acciones, alTarjeta, fantasma],
  )

  /** pointerdown en captura: con una herramienta de creación, se crea aunque se apriete sobre un objeto (como Miro). */
  const alPunteroAbajo = useCallback(
    (ev: React.PointerEvent) => {
      const h = useTienda.getState().herramienta
      if (!esCreacion(h) || ev.button !== 0) return
      const t = ev.target as HTMLElement
      if (!t.closest('.react-flow__pane, .react-flow__node, .react-flow__edge, .react-flow__edges')) return
      if (t.closest('.react-flow__panel, .punto-conexion, input, textarea, [contenteditable="true"]')) return
      ev.stopPropagation()
      ev.preventDefault()
      const s = useTienda.getState()
      if (s.editando) s.setEditando(null)
      const a: Arrastre = {
        herramienta: h,
        pid: ev.pointerId,
        sx: ev.clientX,
        sy: ev.clientY,
        inicio: rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }),
        dibujando: false,
      }
      arrastre.current = a
      const mover = (e: PointerEvent) => {
        if (e.pointerId !== a.pid) return
        ultimo.current = { x: e.clientX, y: e.clientY }
        ultimoEvento.current = e
        if (!a.dibujando && Math.hypot(e.clientX - a.sx, e.clientY - a.sy) >= 6 && h !== 'tarjeta') a.dibujando = true
        if (a.dibujando) pedirCuadro()
      }
      const soltar = (e: PointerEvent) => {
        if (e.pointerId !== a.pid) return
        limpiar()
        arrastre.current = null
        tragarClicSiguiente()
        void terminar(a, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), e.shiftKey, { x: e.clientX, y: e.clientY })
      }
      const tecla = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        limpiar()
        arrastre.current = null
        if (fantasma.current) fantasma.current.dataset.modo = 'oculto'
      }
      const limpiar = () => {
        window.removeEventListener('pointermove', mover)
        window.removeEventListener('pointerup', soltar)
        window.removeEventListener('pointercancel', soltar)
        window.removeEventListener('keydown', tecla, true)
      }
      window.addEventListener('pointermove', mover)
      window.addEventListener('pointerup', soltar)
      window.addEventListener('pointercancel', soltar)
      window.addEventListener('keydown', tecla, true)
    },
    [rf, pedirCuadro, terminar, fantasma],
  )

  return { alPunteroAbajo }
}
