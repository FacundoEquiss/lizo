// Un marco a pantalla completa en el teléfono, como el visor de fotos del sistema: el marco ajustado entre las dos barras,
// pellizcar para acercar (hasta ver los píxeles), desplazar con un dedo cuando está acercado, doble toque para acercar o
// volver, deslizar a los costados para pasar al marco anterior o al siguiente de la página y deslizar hacia abajo para
// cerrar. Un toque esconde o muestra las barras. "Atrás" lo cierra.
//   · El marco es el de siempre: un iframe sin scripts del tamaño exacto del marco (su CSS ve su pantalla real), escalado
//     por fuera. Mientras llega, su miniatura. Los gestos los recibe una capa propia: el iframe nunca recibe el dedo.
//   · Abajo: Comentarios (con los pines en el marco), Textos (solo en los marcos propios: tocar un texto lo cambia),
//     Inspeccionar (tocar algo muestra sus medidas, sus letras, sus colores y sus reglas CSS) y Compartir la imagen.
//     Arriba a la derecha, los detalles del marco.
import { ArrowLeft, ChevronLeft, ChevronRight, Info, MessageCircle, ScanSearch, Share2, Type, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ComentarioDiseno, MarcoResumen } from '../../../../../compartido/diseno/tipos'
import { avisar } from '../../../estado/avisos'
import { vibrar } from '../../../movil/haptica'
import { useCierraConAtras } from '../../../movil/historial'
import { ponerColorBarra } from '../../../pwa/color-barra'
import { apiDiseno, urlMiniatura } from '../api'
import { esPropio, useDiseno } from '../estado'
import { esTexto } from '../lienzo/elegir'
import { MarcoVivo } from '../lienzo/MarcoVivo'
import { useDisenoMovil, type ModoVisor } from './estado'
import { enOrden } from './util'

interface Vista {
  x: number
  y: number
  s: number
}

/** El documento del marco abierto (para leer y cambiar sus capas). */
export function documentoDelVisor(): Document | null {
  try {
    return document.querySelector<HTMLIFrameElement>('.dzm-visor__cuerpo iframe')?.contentDocument ?? null
  } catch {
    return null
  }
}

export function capaDelVisor(capa: string): HTMLElement | null {
  const d = documentoDelVisor()
  if (!d) return null
  try {
    return d.querySelector<HTMLElement>(`[data-id="${CSS.escape(capa)}"]`)
  } catch {
    return null
  }
}

export function Visor() {
  const id = useDisenoMovil((s) => s.visor)
  return createPortal(<AnimatePresence>{id && <VisorAbierto key="visor" id={id} />}</AnimatePresence>, document.body)
}

const CLAVE_PISTA = 'telar.diseno.visor.pista'

const MODOS: Record<Exclude<ModoVisor, 'ver'>, { texto: string; listo: string }> = {
  comentar: { texto: 'Tocá donde va el comentario', listo: 'Cancelar' },
  textos: { texto: 'Tocá un texto para cambiarlo', listo: 'Listo' },
  inspeccionar: { texto: 'Tocá algo para ver sus medidas', listo: 'Listo' },
}

function VisorAbierto({ id }: { id: string }) {
  const marcos = useDiseno((s) => s.marcos)
  const prefijo = useDiseno((s) => s.prefijo)!
  const completo = useDiseno((s) => s.completos[id])
  const modo = useDisenoMovil((s) => s.modo)
  const resaltada = useDisenoMovil((s) => s.resaltada)
  const borrador = useDisenoMovil((s) => s.borrador)
  const hojaAbierta = useDisenoMovil((s) => s.hoja?.tipo ?? null)
  const hilo = useDisenoMovil((s) => (s.hoja?.tipo === 'comentarios' ? (s.hoja.hilo ?? null) : null))
  const reducido = useReducedMotion()
  const orden = useMemo(() => enOrden(marcos), [marcos])
  const i = orden.findIndex((m) => m.id === id)
  const m: MarcoResumen | null = orden[i] ?? null
  const anterior = i > 0 ? orden[i - 1]! : null
  const siguiente = i >= 0 && i < orden.length - 1 ? orden[i + 1]! : null
  const [interfaz, setInterfaz] = useState(true)
  const [cargado, setCargado] = useState(false)
  const [comentarios, setComentarios] = useState<ComentarioDiseno[]>([])
  const [textos, setTextos] = useState<{ capa: string; x: number; y: number; ancho: number; alto: number }[]>([])
  const [caja, setCaja] = useState<{ x: number; y: number; ancho: number; alto: number } | null>(null)
  const raiz = useRef<HTMLDivElement>(null)
  const superficie = useRef<HTMLDivElement>(null)
  const escenario = useRef<HTMLDivElement>(null)
  const fondo = useRef<HTMLDivElement>(null)
  const cab = useRef<HTMLElement>(null)
  const pie = useRef<HTMLElement>(null)
  const vista = useRef<Vista>({ x: 0, y: 0, s: 1 })
  const entrada = useRef(0)
  const cerrar = useCallback(() => useDisenoMovil.getState().cerrarVisor(), [])
  useCierraConAtras(true, cerrar)

  // La barra del sistema toma el color del fondo del visor; el foco entra y vuelve al cerrar.
  useEffect(() => ponerColorBarra('--c-hundido-2'), [])
  // La primera vez, cómo se pasa de un marco a otro (las flechas de los costados taparían el marco: no se ven).
  useEffect(() => {
    if (orden.length < 2) return
    try {
      if (localStorage.getItem(CLAVE_PISTA)) return
      localStorage.setItem(CLAVE_PISTA, '1')
    } catch {
      return
    }
    avisar({ texto: 'Deslizá a los costados para pasar al marco anterior o al siguiente.', duracion: 4200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    raiz.current?.focus({ preventScroll: true })
    return () => antes?.focus?.({ preventScroll: true })
  }, [])

  // El marco ya no está en la página (lo archivaron mientras se miraba): se cierra y se avisa.
  useEffect(() => {
    if (m || !marcos.length) return
    avisar({ texto: 'Ese marco ya no está en esta página.' })
    cerrar()
  }, [m, marcos.length, cerrar])

  // El marco completo (y los vecinos, para pasar de uno a otro sin esperar).
  useEffect(() => {
    const s = useDiseno.getState()
    void s.cargarMarco(id).then(() => {
      if (siguiente) void s.cargarMarco(siguiente.id)
      if (anterior) void s.cargarMarco(anterior.id)
    })
    setCargado(false)
    setTextos([])
    setCaja(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Sus comentarios (los pines y el número del botón).
  useEffect(() => {
    let vivo = true
    const cargar = () =>
      apiDiseno
        .comentarios(prefijo, `marco:${id}`)
        .then((cs) => vivo && setComentarios(cs))
        .catch(() => {})
    cargar()
    window.addEventListener('telar:diseno-comentarios', cargar)
    return () => {
      vivo = false
      window.removeEventListener('telar:diseno-comentarios', cargar)
    }
  }, [prefijo, id, m?.comentarios])

  // ── medidas y transformaciones ──
  const medidas = useCallback(() => {
    const r = superficie.current?.getBoundingClientRect()
    return {
      w: r?.width ?? innerWidth,
      h: r?.height ?? innerHeight,
      arriba: cab.current?.offsetHeight ?? 56,
      abajo: pie.current?.offsetHeight ?? 72,
    }
  }, [])

  const ajuste = useCallback(
    (mm: MarcoResumen | null = m): Vista => {
      if (!mm) return { x: 0, y: 0, s: 1 }
      const c = medidas()
      const margen = 12
      const aw = Math.max(40, c.w - margen * 2)
      const ah = Math.max(40, c.h - c.arriba - c.abajo - margen * 2)
      const s = Math.min(2, aw / mm.ancho, ah / mm.alto)
      return { s, x: (c.w - mm.ancho * s) / 2, y: c.arriba + margen + (ah - mm.alto * s) / 2 }
    },
    [m, medidas],
  )
  const maxEscala = useCallback(() => Math.max(ajuste().s * 4, 3), [ajuste])

  const aplicar = useCallback(
    (v: Vista, animar = false) => {
      vista.current = v
      const el = escenario.current
      if (!el) return
      el.style.transition = animar && !reducido ? 'transform 280ms cubic-bezier(0.15, 1, 0.3, 1)' : 'none'
      el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})`
      el.style.setProperty('--zs', String(v.s))
    },
    [reducido],
  )

  /** Dentro de los bordes: lo que mide menos que la zona se centra; lo que mide más no deja más de 24 px de aire. */
  const limitar = useCallback(
    (v: Vista): Vista => {
      if (!m) return v
      const c = medidas()
      const w = m.ancho * v.s
      const h = m.alto * v.s
      const aire = 24
      const arriba = c.arriba
      const abajo = c.h - c.abajo
      const x = w <= c.w ? (c.w - w) / 2 : Math.min(aire, Math.max(c.w - w - aire, v.x))
      const y = h <= abajo - arriba ? arriba + (abajo - arriba - h) / 2 : Math.min(arriba + aire, Math.max(abajo - h - aire, v.y))
      return { ...v, x, y }
    },
    [m, medidas],
  )

  // Marco nuevo (al abrir o al pasar a otro): ajustado; si viene de deslizar, entra desde el costado.
  useLayoutEffect(() => {
    if (!m) return
    const a = ajuste(m)
    if (entrada.current && !reducido) {
      const c = medidas()
      aplicar({ ...a, x: a.x + entrada.current * c.w * 0.4 })
      requestAnimationFrame(() => aplicar(a, true))
    } else aplicar(a)
    entrada.current = 0
    if (fondo.current) fondo.current.style.opacity = '1'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.id, m?.ancho, m?.alto])

  // Al girar el teléfono, se vuelve a ajustar.
  useEffect(() => {
    const f = () => aplicar(ajuste())
    addEventListener('resize', f)
    return () => removeEventListener('resize', f)
  }, [aplicar, ajuste])

  // Pasar a otro marco de la página.
  const ir = useCallback(
    (paso: 1 | -1) => {
      const destino = paso === 1 ? siguiente : anterior
      if (!destino) return aplicar(ajuste(), true)
      const c = medidas()
      aplicar({ ...vista.current, x: vista.current.x - paso * c.w }, true)
      vibrar('toque')
      setTimeout(
        () => {
          entrada.current = paso
          const modoActual = useDisenoMovil.getState().modo
          useDisenoMovil.getState().set({
            visor: destino.id,
            resaltada: null,
            borrador: null,
            modo: modoActual === 'textos' && !esPropio(destino) ? 'ver' : modoActual === 'comentar' ? 'ver' : modoActual,
          })
        },
        reducido ? 0 : 150,
      )
    },
    [siguiente, anterior, aplicar, ajuste, medidas, reducido],
  )

  // ── lo que hay en un punto del marco ──
  const enMarco = (clientX: number, clientY: number) => {
    const v = vista.current
    const r = superficie.current?.getBoundingClientRect()
    const fx = (clientX - (r?.left ?? 0) - v.x) / v.s
    const fy = (clientY - (r?.top ?? 0) - v.y) / v.s
    const dentro = !!m && fx >= 0 && fy >= 0 && fx <= m.ancho && fy <= m.alto
    return { fx, fy, dentro }
  }
  const elementoEn = (fx: number, fy: number): HTMLElement | null => {
    const d = documentoDelVisor()
    if (!d) return null
    let el = d.elementFromPoint(fx, fy) as HTMLElement | null
    while (el && el !== d.body && !el.hasAttribute('data-id')) el = el.parentElement
    return el && el !== d.body && el.hasAttribute('data-id') ? el : null
  }
  const cajaDe = (el: HTMLElement) => {
    const b = el.getBoundingClientRect()
    return { x: b.x, y: b.y, ancho: b.width, alto: b.height }
  }

  // Los textos que se pueden cambiar (modo Textos), con su lugar en el marco.
  const leerTextos = useCallback(() => {
    const d = documentoDelVisor()
    if (!d) return setTextos([])
    const lista: typeof textos = []
    for (const el of Array.from(d.querySelectorAll<HTMLElement>('[data-id]'))) {
      if (!esTexto(el)) continue
      const b = el.getBoundingClientRect()
      if (b.width < 1 || b.height < 1) continue
      lista.push({ capa: el.getAttribute('data-id')!, x: b.x, y: b.y, ancho: b.width, alto: b.height })
    }
    setTextos(lista)
  }, [])
  useEffect(() => {
    if (modo === 'textos' && cargado) leerTextos()
    else setTextos([])
  }, [modo, cargado, leerTextos, completo?.marco.revision])

  // La capa resaltada (la que se inspecciona o se edita).
  useEffect(() => {
    if (!resaltada || !cargado) return setCaja(null)
    const el = documentoDelVisor()?.querySelector<HTMLElement>(`[data-id="${CSS.escape(resaltada)}"]`)
    setCaja(el ? cajaDe(el) : null)
  }, [resaltada, cargado, completo?.marco.revision])

  // Con una hoja abierta abajo, lo que se está mirando (la capa que se inspecciona o se edita, el punto del comentario
  // nuevo) sube a la parte de arriba de la pantalla, que la hoja no tapa. Al cerrarla, el marco vuelve a su lugar.
  const apartado = useRef(false)
  useEffect(() => {
    if (!m) return
    // y y alto en px del marco; `sobre`: px de pantalla de más arriba (el pin se dibuja encima de su punto)
    const pin = hilo ? comentarios.find((c) => c.id === hilo && c.y != null) : null
    const foco =
      hojaAbierta === 'comentarios' && borrador
        ? { y: borrador.y, alto: 0, sobre: 36 }
        : hojaAbierta === 'comentarios' && pin
          ? { y: pin.y ?? 0, alto: 0, sobre: 36 }
          : (hojaAbierta === 'capa' || hojaAbierta === 'texto') && caja
            ? { y: caja.y, alto: caja.alto, sobre: 0 }
            : null
    if (!foco) {
      if (apartado.current) {
        apartado.current = false
        aplicar(limitar(vista.current), true)
      }
      return
    }
    const c = medidas()
    const v = vista.current
    const arriba = v.y + foco.y * v.s - foco.sobre
    const abajo = v.y + (foco.y + foco.alto) * v.s
    const banda = c.h * 0.34
    if (arriba >= c.arriba + 8 && abajo <= banda) return
    apartado.current = true
    aplicar({ ...v, y: v.y + (c.arriba + 16 - arriba) }, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hojaAbierta, borrador, caja, hilo, comentarios, m?.id])

  const accionDeModo = (clientX: number, clientY: number) => {
    const st = useDisenoMovil.getState()
    const { fx, fy, dentro } = enMarco(clientX, clientY)
    if (!m) return
    if (st.modo === 'comentar') {
      if (!dentro) return avisar({ texto: 'Tocá adentro del marco.', duracion: 2000 })
      const capa = elementoEn(fx, fy)?.getAttribute('data-id') ?? null
      const punto = { x: Math.round(fx), y: Math.round(fy), capa }
      vibrar('toque')
      st.set({ modo: 'ver', borrador: punto, hoja: { tipo: 'comentarios', marco: m.id, punto } })
      return
    }
    if (!dentro) return
    const el = elementoEn(fx, fy)
    if (st.modo === 'textos') {
      let t: HTMLElement | null = el
      while (t && !esTexto(t)) t = t.parentElement?.closest<HTMLElement>('[data-id]') ?? null
      if (!t) return avisar({ texto: 'Ahí no hay un texto: tocá uno de los marcados.', duracion: 2200 })
      const capa = t.getAttribute('data-id')!
      st.set({ resaltada: capa, hoja: { tipo: 'texto', marco: m.id, capa } })
      return
    }
    if (st.modo === 'inspeccionar') {
      const capa = el?.getAttribute('data-id') ?? null
      st.set({ resaltada: capa, hoja: { tipo: 'capa', marco: m.id, capa } })
    }
  }

  // ── gestos ──
  const punteros = useRef(new Map<number, { x: number; y: number }>())
  const gesto = useRef<{
    tipo: 'nada' | 'pan' | 'pinch' | 'deslizar' | 'bajar'
    x0: number
    y0: number
    v0: Vista
    d0: number
    m0: { x: number; y: number }
    movido: boolean
    muestras: { x: number; y: number; t: number }[]
  } | null>(null)
  const ultimoToque = useRef<{ x: number; y: number; t: number } | null>(null)
  const relojToque = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Un toque se atiende en el click (no al levantar el dedo): si se atendiera antes, la hoja que abre aparecería debajo
   * del dedo y el click que el navegador manda después del toque caería en su velo y la cerraría. Si el click no llega,
   * se atiende igual a los 350 ms.
   */
  const toquePendiente = useRef<{ x: number; y: number; reloj: ReturnType<typeof setTimeout> } | null>(null)
  const atenderToque = (x: number, y: number) => {
    const t = toquePendiente.current
    if (!t) return
    clearTimeout(t.reloj)
    toquePendiente.current = null
    toque(x, y)
  }

  const conGoma = (v: Vista): Vista => {
    const l = limitar(v)
    return { ...v, x: l.x + (v.x - l.x) * 0.35, y: l.y + (v.y - l.y) * 0.35 }
  }

  const dobleToque = (x: number, y: number) => {
    const a = ajuste()
    const v = vista.current
    if (v.s > a.s * 1.05) return aplicar(a, true)
    const s = Math.min(maxEscala(), Math.max(a.s * 2.5, Math.min(1, a.s * 4)))
    aplicar(limitar({ s, x: x - (x - v.x) * (s / v.s), y: y - (y - v.y) * (s / v.s) }), true)
  }

  const toque = (x: number, y: number) => {
    if (useDisenoMovil.getState().modo !== 'ver') return accionDeModo(x, y)
    const ahora = performance.now()
    const u = ultimoToque.current
    if (relojToque.current) clearTimeout(relojToque.current)
    if (u && ahora - u.t < 300 && Math.hypot(x - u.x, y - u.y) < 30) {
      ultimoToque.current = null
      dobleToque(x, y)
      return
    }
    ultimoToque.current = { x, y, t: ahora }
    relojToque.current = setTimeout(() => {
      ultimoToque.current = null
      setInterfaz((v) => !v)
    }, 300)
  }

  const asentar = (inercia?: { vx: number; vy: number }) => {
    const a = ajuste()
    const v = vista.current
    if (v.s < a.s * 1.001) return aplicar(a, true)
    const s = Math.min(maxEscala(), v.s)
    let nv = s === v.s ? v : { s, x: v.x + (v.x - medidas().w / 2) * (s / v.s - 1), y: v.y + (v.y - medidas().h / 2) * (s / v.s - 1) }
    if (inercia) nv = { ...nv, x: nv.x + inercia.vx * 140, y: nv.y + inercia.vy * 140 }
    aplicar(limitar(nv), true)
  }

  const alBajar = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    superficie.current?.setPointerCapture(e.pointerId)
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const v = { ...vista.current }
    if (punteros.current.size === 1) {
      gesto.current = { tipo: 'nada', x0: e.clientX, y0: e.clientY, v0: v, d0: 0, m0: { x: 0, y: 0 }, movido: false, muestras: [{ x: e.clientX, y: e.clientY, t: performance.now() }] }
    } else if (punteros.current.size === 2) {
      const [a, b] = [...punteros.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
      if (gesto.current?.tipo === 'deslizar' || gesto.current?.tipo === 'bajar') aplicar(ajuste())
      gesto.current = {
        tipo: 'pinch',
        x0: 0,
        y0: 0,
        v0: { ...vista.current },
        d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        movido: true,
        muestras: [],
      }
      if (fondo.current) fondo.current.style.opacity = '1'
    }
  }

  const alMover = (e: React.PointerEvent) => {
    if (!punteros.current.has(e.pointerId)) return
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesto.current
    if (!g) return
    if (g.tipo === 'pinch') {
      if (punteros.current.size < 2) return
      const [a, b] = [...punteros.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const centro = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const min = ajuste().s * 0.6
      const max = maxEscala() * 1.25
      const s = Math.min(max, Math.max(min, g.v0.s * (d / g.d0)))
      const k = s / g.v0.s
      aplicar({ s, x: centro.x - (g.m0.x - g.v0.x) * k, y: centro.y - (g.m0.y - g.v0.y) * k })
      return
    }
    if (punteros.current.size !== 1) return
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    g.muestras.push({ x: e.clientX, y: e.clientY, t: performance.now() })
    if (g.muestras.length > 6) g.muestras.shift()
    if (!g.movido) {
      if (Math.hypot(dx, dy) < 8) return
      g.movido = true
      const ajustado = vista.current.s <= ajuste().s * 1.02
      if (!ajustado) g.tipo = 'pan'
      else if (Math.abs(dx) > Math.abs(dy)) g.tipo = 'deslizar'
      else g.tipo = dy > 0 ? 'bajar' : 'pan'
    }
    if (g.tipo === 'pan') aplicar(conGoma({ ...g.v0, x: g.v0.x + dx, y: g.v0.y + dy }))
    else if (g.tipo === 'deslizar') {
      const hay = dx < 0 ? !!siguiente : !!anterior
      aplicar({ ...g.v0, x: g.v0.x + (hay ? dx : dx * 0.3) })
    } else if (g.tipo === 'bajar') {
      // Baja con el dedo y se achica un poco, desde su centro (como una foto que se suelta).
      const y = Math.max(0, dy)
      const s = g.v0.s * (1 - Math.min(0.15, y / 2000))
      const ancho = m ? m.ancho : 0
      aplicar({ s, x: g.v0.x + (ancho * (g.v0.s - s)) / 2 + dx * 0.3, y: g.v0.y + y })
      if (fondo.current) fondo.current.style.opacity = String(1 - Math.min(0.7, y / 420))
    }
  }

  const velocidad = (g: NonNullable<typeof gesto.current>) => {
    const ms = g.muestras
    if (ms.length < 2) return { vx: 0, vy: 0 }
    const a = ms[0]!
    const b = ms[ms.length - 1]!
    const dt = Math.max(1, b.t - a.t)
    if (performance.now() - b.t > 90) return { vx: 0, vy: 0 }
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt }
  }

  const alSoltar = (e: React.PointerEvent) => {
    if (!punteros.current.has(e.pointerId)) return
    punteros.current.delete(e.pointerId)
    const g = gesto.current
    if (!g) return
    if (g.tipo === 'pinch') {
      if (punteros.current.size === 1) {
        const [p] = [...punteros.current.values()] as [{ x: number; y: number }]
        gesto.current = { tipo: 'pan', x0: p.x, y0: p.y, v0: { ...vista.current }, d0: 0, m0: { x: 0, y: 0 }, movido: true, muestras: [] }
        return
      }
      if (punteros.current.size === 0) {
        gesto.current = null
        asentar()
      }
      return
    }
    if (punteros.current.size > 0) return
    gesto.current = null
    if (!g.movido) {
      const x = e.clientX
      const y = e.clientY
      if (toquePendiente.current) clearTimeout(toquePendiente.current.reloj)
      toquePendiente.current = { x, y, reloj: setTimeout(() => atenderToque(x, y), 350) }
      return
    }
    const vel = velocidad(g)
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    if (g.tipo === 'pan') return asentar(vel)
    if (g.tipo === 'deslizar') {
      const lejos = Math.abs(dx) > medidas().w * 0.22 || Math.abs(vel.vx) > 0.5
      if (lejos && dx < 0 && siguiente) return ir(1)
      if (lejos && dx > 0 && anterior) return ir(-1)
      return aplicar(ajuste(), true)
    }
    if (g.tipo === 'bajar') {
      if (dy > 120 || vel.vy > 0.7) return cerrar()
      aplicar(ajuste(), true)
      if (fondo.current) fondo.current.style.opacity = '1'
    }
  }

  const alCancelar = (e: React.PointerEvent) => {
    punteros.current.delete(e.pointerId)
    if (punteros.current.size === 0 && gesto.current) {
      gesto.current = null
      asentar()
      if (fondo.current) fondo.current.style.opacity = '1'
    }
  }

  // Rueda (y pellizco del panel táctil de una computadora angosta): acerca en el punto del mouse.
  useEffect(() => {
    const el = superficie.current
    if (!el) return
    const rueda = (e: WheelEvent) => {
      e.preventDefault()
      const v = vista.current
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))
      const s = Math.min(maxEscala(), Math.max(ajuste().s, v.s * k))
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      aplicar(limitar({ s, x: x - (x - v.x) * (s / v.s), y: y - (y - v.y) * (s / v.s) }))
    }
    el.addEventListener('wheel', rueda, { passive: false })
    return () => el.removeEventListener('wheel', rueda)
  }, [aplicar, ajuste, limitar, maxEscala])

  // Teclado (también en el teléfono con teclado físico): flechas para pasar, Escape para salir del modo o cerrar.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.defaultPrevented || useDisenoMovil.getState().hoja) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable]')) return
      if (e.key === 'ArrowRight') ir(1)
      else if (e.key === 'ArrowLeft') ir(-1)
      else if (e.key === 'Escape') {
        if (useDisenoMovil.getState().modo !== 'ver') useDisenoMovil.getState().setModo('ver')
        else cerrar()
      } else return
      e.preventDefault()
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [ir, cerrar])

  if (!m) return null
  const propio = esPropio(m)
  const hilos = comentarios.filter((c) => !c.respuestaA && !c.resuelto)
  const pines = hilos.filter((c) => c.x != null)
  const abrirHoja = useDisenoMovil.getState().abrirHoja
  const setModo = useDisenoMovil.getState().setModo
  const listo = completo && completo.marco.revision >= m.revision
  // Con una hoja abierta, el cartel del modo se aparta: la hoja ya dice qué se está mirando (y taparía la capa).
  const cartel = modo !== 'ver' && !hojaAbierta ? MODOS[modo] : null

  return (
    <motion.div
      ref={raiz}
      className={`dzm-visor${interfaz ? '' : ' dzm-visor--limpio'} dzm-visor--${modo}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${m.nombre}, ${m.ancho} × ${m.alto}`}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: reducido ? 0.12 : 0.18 } }}
      exit={{ opacity: 0, transition: { duration: reducido ? 0.12 : 0.16 } }}
    >
      <div className="dzm-visor__fondo" ref={fondo} aria-hidden />
      <div
        className="dzm-visor__superficie"
        ref={superficie}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alCancelar}
        onClick={(e) => atenderToque(e.clientX, e.clientY)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="dzm-visor__escenario" ref={escenario} style={{ width: m.ancho, height: m.alto }}>
          <div className="dzm-visor__cuerpo" style={{ background: m.datos.fondo || (propio ? '#ffffff' : undefined) }}>
            <img
              className={`dzm-visor__mini${cargado ? ' dzm-visor__mini--oculta' : ''}`}
              src={urlMiniatura(prefijo, m)}
              alt=""
              decoding="async"
              draggable={false}
            />
            {listo && (
              <div className={`dzm-visor__vivo${cargado ? ' dzm-visor__vivo--listo' : ''}`} key={m.id}>
                <MarcoVivo completo={completo} alCargar={() => setCargado(true)} />
              </div>
            )}
          </div>
          <div className="dzm-visor__capa">
            {modo === 'textos' &&
              textos.map((t) => (
                <span
                  key={t.capa}
                  className={`dzm-visor__texto${resaltada === t.capa ? ' dzm-visor__texto--activo' : ''}`}
                  style={{ left: t.x, top: t.y, width: t.ancho, height: t.alto }}
                />
              ))}
            {caja && modo !== 'textos' && <span className="dzm-visor__resaltado" style={{ left: caja.x, top: caja.y, width: caja.ancho, height: caja.alto }} />}
            {pines.map((c, n) => (
              <button
                key={c.id}
                type="button"
                className={`dzm-pin${c.autor.tipo === 'ia' ? ' dzm-pin--ia' : ''}`}
                style={{ left: c.x ?? 0, top: c.y ?? 0 }}
                aria-label={`Comentario de ${c.autor.nombre}: ${c.texto}`}
                onClick={() => abrirHoja({ tipo: 'comentarios', marco: m.id, hilo: c.id })}
              >
                <span className="dzm-pin__cara">{c.autor.tipo === 'ia' ? '✦' : (c.autor.nombre[0] ?? '?').toUpperCase()}</span>
                <span className="dzm-pin__n">{n + 1}</span>
              </button>
            ))}
            {borrador && (
              <span className="dzm-pin dzm-pin--borrador" style={{ left: borrador.x, top: borrador.y }} aria-hidden>
                <span className="dzm-pin__cara">+</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <header className="dzm-visor__cab" ref={cab}>
        <button type="button" className="dzm-visor__boton" onClick={cerrar} aria-label="Volver">
          <ArrowLeft size={22} />
        </button>
        <div className="dzm-visor__titulo">
          <span className="dzm-visor__nombre">{m.nombre}</span>
          <span className="dzm-visor__medidas">
            {m.ancho} × {m.alto}
            {orden.length > 1 ? ` · ${i + 1} de ${orden.length}` : ''}
            {propio ? '' : ' · del código'}
          </span>
        </div>
        <button type="button" className="dzm-visor__boton" onClick={() => abrirHoja({ tipo: 'detalles', marco: m.id })} aria-label="Detalles del marco">
          <Info size={22} />
        </button>
      </header>

      <AnimatePresence>
        {cartel && (
          <motion.div
            className="dzm-visor__cartel"
            role="status"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
            transition={{ duration: 0.16 }}
          >
            <span>{cartel.texto}</span>
            <button type="button" onClick={() => setModo('ver')}>
              {cartel.listo === 'Cancelar' ? <X size={16} /> : null}
              {cartel.listo}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {anterior && (
        <button type="button" className="dzm-visor__lado dzm-visor__lado--izq" onClick={() => ir(-1)} aria-label={`Anterior: ${anterior.nombre}`}>
          <ChevronLeft size={22} />
        </button>
      )}
      {siguiente && (
        <button type="button" className="dzm-visor__lado dzm-visor__lado--der" onClick={() => ir(1)} aria-label={`Siguiente: ${siguiente.nombre}`}>
          <ChevronRight size={22} />
        </button>
      )}

      <footer className="dzm-visor__pie" ref={pie}>
        <BotonPie
          icono={<MessageCircle size={22} />}
          texto="Comentarios"
          cuenta={hilos.length}
          activo={modo === 'comentar'}
          onClick={() => abrirHoja({ tipo: 'comentarios', marco: m.id })}
        />
        {propio && !m.bloqueado && (
          <BotonPie icono={<Type size={22} />} texto="Textos" activo={modo === 'textos'} onClick={() => setModo(modo === 'textos' ? 'ver' : 'textos')} />
        )}
        <BotonPie
          icono={<ScanSearch size={22} />}
          texto="Inspeccionar"
          activo={modo === 'inspeccionar'}
          onClick={() => setModo(modo === 'inspeccionar' ? 'ver' : 'inspeccionar')}
        />
        <BotonPie icono={<Share2 size={22} />} texto="Compartir" onClick={() => abrirHoja({ tipo: 'compartir', marco: m.id })} />
      </footer>
    </motion.div>
  )
}

function BotonPie({ icono, texto, cuenta, activo, onClick }: { icono: React.ReactNode; texto: string; cuenta?: number; activo?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`dzm-visor__accion${activo ? ' dzm-visor__accion--activa' : ''}`} onClick={onClick} aria-pressed={activo ?? undefined}>
      <span className="dzm-visor__accion-icono">
        {icono}
        {!!cuenta && <span className="dzm-visor__cuenta">{cuenta}</span>}
      </span>
      <span className="dzm-visor__accion-texto">{texto}</span>
    </button>
  )
}
