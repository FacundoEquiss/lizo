// Eventos en vivo: lo que cambia la IA por MCP (o otra pestaña) aparece solo.
//   · En la computadora: SSE (/api/eventos), el servidor avisa al instante.
//   · Online (Vercel): no hay un proceso que viva siempre; la web pregunta cada 3 s qué pasó después del último evento
//     que vio (/api/eventos/desde). Con la pestaña escondida no pregunta (ahorra base y Vercel); al volver, se pone al día.
//     Si no pasa nada (ni cambios ni la persona usando la app), pregunta cada vez menos, hasta cada 10 s: cada pregunta
//     es una ejecución de Vercel, y una pestaña abierta todo el día eran ~1.200 por hora.
import type { Evento } from '../../../compartido/tipos'
import { clienteId } from './api'
import { useIA } from './ia'
import { sesionVencida, useSesion } from './sesion'
import { useTienda } from './tienda'

/** Se recarga todo (el tablero y lo de la IA): se perdió algún evento o la pestaña estuvo escondida un buen rato. */
const recargarTodo = () => {
  useTienda.getState().recargarTablero()
  void useIA.getState().cargarNovedades()
}

/** Los tipos de evento que sabe aplicar la tienda de Telar. */
const TIPOS_DE_LA_TIENDA = new Set<string>([
  'tarjeta',
  'tarjeta.detalle',
  'lista',
  'elemento',
  'conector',
  'lienzo',
  'etiqueta',
  'proyecto',
  'tablero',
  'miembro',
  'actividad',
])

/**
 * Los eventos de Diseño van a su tienda (vistas/diseno/estado.ts, que se carga con la vista), los de notificaciones y de
 * trabajos de los agentes a la de la IA (estado/ia.ts) y el resto, a la de Telar. Un tipo que esta versión de la web todavía
 * no conoce (uno futuro, con una pestaña abierta de antes de publicar) se ignora sin ruido: no es un error, y lo que importa
 * se ve al recargar.
 */
export function aplicar(e: Evento) {
  if (e.tipo === 'diseno') window.dispatchEvent(new CustomEvent('telar:diseno', { detail: e }))
  else if (e.tipo === 'notificacion' || e.tipo === 'trabajo') useIA.getState().aplicarEvento(e)
  else if (TIPOS_DE_LA_TIENDA.has(e.tipo)) useTienda.getState().aplicarEvento(e)
}

let fuente: EventSource | null = null
let caidas = 0
let sondeando = false

let novedadesPedidas = false

export function conectarEventos() {
  // Lo de la IA (la campana) se pide una sola vez al abrir Telar; después solo llegan sus eventos por este mismo canal.
  if (!novedadesPedidas) {
    novedadesPedidas = true
    void useIA.getState().cargarNovedades()
  }
  if (useSesion.getState().eventos === 'sondeo') return sondear()
  if (fuente) return
  const abrir = () => {
    fuente = new EventSource('/api/eventos')
    fuente.addEventListener('hola', () => {
      const estabaCaido = caidas > 0
      caidas = 0
      useTienda.setState({ enVivo: true })
      // Si se cortó un rato, puede haberse perdido algo: se recarga el tablero.
      if (estabaCaido) recargarTodo()
    })
    fuente.addEventListener('cambio', (m) => {
      try {
        aplicar(JSON.parse((m as MessageEvent).data) as Evento)
      } catch (e) {
        console.error('evento inválido', e)
      }
    })
    fuente.onerror = () => {
      caidas++
      useTienda.setState({ enVivo: false })
      if (fuente && fuente.readyState === EventSource.CLOSED) {
        fuente = null
        setTimeout(abrir, Math.min(1000 * caidas, 8000))
      }
    }
  }
  abrir()
}

const CADA_MS = 3000
const AFUERA_MS = 10 * 60 * 1000   // escondida más que esto: al volver se recarga el tablero entero
/** Después de un cambio o de que la persona tocó algo, se pregunta cada 3 s durante este rato. */
const ACTIVO_MS = 60 * 1000
/** Sin novedades: cada 6 s y, pasados 5 minutos, cada 10 s. */
const QUIETO_MS = 6000
const DORMIDO_MS = 10000
const DORMIDO_DESDE_MS = 5 * 60 * 1000

/** Cada cuánto preguntar, según cuánto hace que no pasa nada. */
const espera = (quieto: number) => (quieto < ACTIVO_MS ? CADA_MS : quieto < DORMIDO_DESDE_MS ? QUIETO_MS : DORMIDO_MS)

function sondear() {
  if (sondeando) return
  sondeando = true
  let n = 0
  let fallos = 0
  let reloj: ReturnType<typeof setTimeout> | null = null
  let escondidaDesde = 0
  let enCurso = false
  // La última novedad: un evento que llegó, o la persona que tocó, escribió o volvió a la pestaña.
  let novedad = Date.now()
  let proxima = 0

  async function vuelta() {
    reloj = null
    if (document.hidden || enCurso) return
    enCurso = true
    try {
      // `ia=1` solo mientras hay un trabajo de un agente vivo: el servidor levanta lo que haya quedado sin dueño (plan 11.4).
      const r = await fetch(`/api/eventos/desde?n=${n}${useIA.getState().hayTrabajosVivos() ? '&ia=1' : ''}`, { headers: { 'x-tablero-cliente': clienteId } })
      if (r.status === 401) {
        sesionVencida()
        return
      }
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const d = (await r.json()) as { n: number; eventos: Evento[]; completo: boolean }
      fallos = 0
      useTienda.setState({ enVivo: true })
      if (d.eventos.length) novedad = Date.now()
      if (n > 0 && !d.completo) recargarTodo()   // pasaron demasiadas cosas: se recarga entero
      else
        for (const e of d.eventos) {
          try {
            aplicar(e)
          } catch (err) {
            console.error('evento inválido', err)
          }
        }
      n = d.n
    } catch {
      fallos++
      if (fallos > 1) useTienda.setState({ enVivo: false })
    } finally {
      enCurso = false
    }
    programar(fallos ? Math.min(CADA_MS * (fallos + 1), 15000) : espera(Date.now() - novedad))
  }
  function programar(ms: number) {
    if (reloj) clearTimeout(reloj)
    reloj = null
    if (!document.hidden) {
      proxima = Date.now() + ms
      reloj = setTimeout(vuelta, ms)
    }
  }
  // La persona usa la app: vuelve a preguntar cada 3 s (si faltaba más para la próxima, se adelanta).
  const actividad = () => {
    novedad = Date.now()
    if (reloj && proxima - Date.now() > CADA_MS) programar(CADA_MS)
  }
  for (const tipo of ['pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(tipo, actividad, { capture: true, passive: true })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      escondidaDesde = Date.now()
      if (reloj) clearTimeout(reloj)
      reloj = null
      return
    }
    if (escondidaDesde && Date.now() - escondidaDesde > AFUERA_MS) {
      n = 0   // la próxima vuelta trae el último número; lo de antes se ve recargando
      recargarTodo()
    }
    escondidaDesde = 0
    novedad = Date.now()
    programar(0)
  })
  programar(0)
}
