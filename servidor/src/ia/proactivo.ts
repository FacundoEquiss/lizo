// Agentes proactivos (Anexo F.4): trabajar sin que los mencionen. Es opt-in por agente (Configuración → IA), con tope de gasto y un máximo de
// trabajos proactivos por día (de fábrica 20). Dos disparadores:
//   · `tarjeta_nueva`: cuando entra una tarjeta a las listas elegidas (sugerida: «Bandeja (Discord)») el agente hace una revisión: lee la
//     tarjeta (y el código relacionado), comenta con «Revisado DD/MM:», una recomendación y, si es una pregunta de la comunidad, una
//     «Respuesta para Discord» lista que NO se manda. Avisa con una línea («Claude revisó RC-105»).
//   · `resumen_diario` (con el cron): un resumen corto de lo trabado y lo vencido, como notificación.
// Autonomía: `sugiere` (de fábrica) solo comenta y avisa; `actua` además mueve y cambia estados con su capacidad `tarjetas` (con deshacer).
// La proactividad nunca menciona a otros agentes ni dispara otros trabajos. Un trabajo por tarjeta y por agente: editarla no lo repite.
import { MAX_PROACTIVOS_POR_DIA, type TrabajoResumen } from '../../../compartido/ia'
import type { Actor } from '../../../compartido/tipos'
import type { Ctx } from '../dominio/servicio'
import { tandaActual } from '../dominio/tanda'
import { hayAgentes } from './menciones'
import type { ServicioIA } from './servicio-ia'
import { trabajosDe, type AgenteInterno } from './trabajos'

const SISTEMA: Actor = { tipo: 'sistema', id: 'sistema', nombre: 'Telar' }

/** Lo que Telar le pide a un agente cuando entra una tarjeta (es una orden de Telar: no lleva nada de la tarjeta). */
const PEDIDO_TARJETA_NUEVA =
  'Entró una tarjeta nueva a una de las listas que dejaste para que revises. Leela (y, si tenés la capacidad de código, mirá lo que menciona). ' +
  'Contestá con: **Revisado DD/MM:** qué encontraste, con la ruta y la evidencia; una **Recomendación** (prioridad, a qué lista iría y por qué); ' +
  'y, si es una pregunta de la comunidad, una **Respuesta para Discord** lista para copiar (no la mandes). Corto y claro.'

const PEDIDO_RESUMEN =
  'Armá el resumen del día: qué está trabado, qué venció y qué conviene hacer primero. Corto: una lista de a lo sumo cinco renglones, con la clave de cada tarjeta.'

/** Cuántos trabajos proactivos creó este agente hoy (día UTC). */
async function creadosHoy(ia: ServicioIA, agenteId: string): Promise<number> {
  const [f] = await ia.db.consulta<{ n: number }>(
    `select count(*)::int as n from ia_trabajos
      where propietario = $1 and agente_id = $2 and origen = 'proactivo' and creado_en >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`,
    [ia.cuenta, agenteId],
  )
  return Number(f?.n ?? 0)
}

const maximoPorDia = (a: AgenteInterno) => (a.disparadores.maxPorDia && a.disparadores.maxPorDia > 0 ? a.disparadores.maxPorDia : MAX_PROACTIVOS_POR_DIA)

/**
 * Una tarjeta entró a una lista: crea UN trabajo `proactivo` por cada agente con ese disparador (clave única por tarjeta y agente: editarla
 * o volver a moverla no lo repite), respetando el máximo diario y los permisos. null si ningún agente corresponde o ya estaba. Sin agentes
 * proactivos en la cuenta no cuesta ninguna consulta (caché en memoria).
 */
export async function revisarTarjetaNueva(ia: ServicioIA, ctx: Ctx, tarjetaId: string): Promise<TrabajoResumen | null> {
  // Lo que hace un trabajo no dispara otro (ni una tarjeta que crea un agente).
  if (tandaActual()) return null
  if (!(await hayAgentes(ia)).proactivos) return null
  const tb = trabajosDe(ia)
  const [t] = await ia.db.consulta<{ id: string; clave: string; lista_id: string | null; proyecto_id: string; tablero_id: string; archivada: boolean }>(
    `select ta.id, ta.clave, ta.lista_id, ta.proyecto_id, ta.tablero_id, ta.archivada from tarjetas ta join proyectos p on p.id = ta.proyecto_id where ta.id = $1 and p.propietario = $2`,
    [tarjetaId, ia.cuenta],
  )
  if (!t || t.archivada || !t.lista_id) return null
  const ajustes = await tb.ajustes()
  let primero: TrabajoResumen | null = null
  for (const a of await tb.agentesProactivos()) {
    if (!a.disparadores.tarjetaNueva?.listas?.includes(t.lista_id)) continue
    if (a.miembroId === ctx.actor.id) continue
    if (tb.motivoNoListo(a, ajustes)) continue
    if ((await creadosHoy(ia, a.miembroId)) >= maximoPorDia(a)) continue
    const r = await tb.crear({
      agente: a,
      origen: 'proactivo',
      claveUnica: `proactivo:tarjeta_nueva:${t.id}:${a.miembroId}`,
      superficie: 'tarjeta',
      contexto: { proyectoId: t.proyecto_id, tableroId: t.tablero_id, tarjetaId: t.id, tarjetaClave: t.clave, disparador: 'tarjeta_nueva' },
      pedido: PEDIDO_TARJETA_NUEVA,
      pedidoPor: SISTEMA,
    })
    if (r.tipo === 'creado' && !primero) primero = await tb.resumen(r.trabajo)
  }
  return primero
}

/**
 * El resumen diario (lo llama el cron): un trabajo `proactivo` por agente con ese disparador, uno por día. Sin disparadores, una lista vacía.
 * El resumen llega como notificación (los tableros no tienen comentarios): `tableroId` dice de qué tablero leer; null, de toda la cuenta.
 */
export async function resumenDiario(ia: ServicioIA, ahora: Date = new Date()): Promise<TrabajoResumen[]> {
  if (!(await hayAgentes(ia)).proactivos) return []
  const tb = trabajosDe(ia)
  const ajustes = await tb.ajustes()
  const fecha = ahora.toISOString().slice(0, 10)
  const creados: TrabajoResumen[] = []
  for (const a of await tb.agentesProactivos()) {
    const cfg = a.disparadores.resumenDiario
    if (!cfg) continue
    if (tb.motivoNoListo(a, ajustes)) continue
    if ((await creadosHoy(ia, a.miembroId)) >= maximoPorDia(a)) continue
    let tableroId: string | undefined
    let proyectoId: string | undefined
    if (cfg.tableroId) {
      const [tb2] = await ia.db.consulta<{ id: string; proyecto_id: string }>(
        `select t.id, t.proyecto_id from tableros t join proyectos p on p.id = t.proyecto_id where t.id = $1 and p.propietario = $2`,
        [cfg.tableroId, ia.cuenta],
      )
      if (!tb2) continue
      tableroId = tb2.id
      proyectoId = tb2.proyecto_id
    }
    const r = await tb.crear({
      agente: a,
      origen: 'proactivo',
      claveUnica: `proactivo:resumen_diario:${fecha}:${a.miembroId}`,
      superficie: 'kanban',
      contexto: { proyectoId, tableroId, disparador: 'resumen_diario' },
      pedido: PEDIDO_RESUMEN,
      pedidoPor: SISTEMA,
    })
    if (r.tipo === 'creado') creados.push(await tb.resumen(r.trabajo))
  }
  return creados
}
