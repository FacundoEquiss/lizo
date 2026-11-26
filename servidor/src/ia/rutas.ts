// Rutas de la IA integrada (plan, 13.7), montadas en /api: novedades, notificaciones y sus preferencias, y levantar las
// menciones de antes. Cada una corre con el Servicio de la cuenta del pedido (`d.servicio()`), así que solo ve y toca lo suyo:
// las notificaciones son del miembro «yo» de esa cuenta y un id ajeno da 404 como uno que no existe.
import { timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { ErrorDominio, type Ctx, type Servicio } from '../dominio/servicio'
import { rutasClavesIA } from './rutas-claves'
import { leerAlcance } from '../sesion'
import { barrer, correr } from './ejecutor'
import { enSegundoPlano } from './segundo-plano'
import { iaDe, TIPOS_NOTIFICACION } from './servicio-ia'

export interface DepsRutasIA {
  servicio: () => Servicio
  /** El Servicio sin cuenta: solo para las rutas internas (correr y el cron), que eligen la cuenta por su cuenta. */
  raiz: () => Servicio
  ctx: (c: Context) => Promise<Ctx>
  /** Cómo llegó el pedido: lo que dispara cosas pide 'sesion' o 'local' (nunca la clave del MCP). */
  via: () => 'local' | 'clave' | 'sesion' | 'oauth' | undefined
  /** ¿El pedido trae la clave del MCP (Authorization: Bearer o x-tablero-clave)? */
  claveValida: (c: Context) => boolean
}

/** Compara dos textos en tiempo constante (una clave no se adivina por cuánto tarda en rechazarse). */
function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** ¿El pedido es del cron de Vercel (`Authorization: Bearer <CRON_SECRET>`)? Sin CRON_SECRET en el entorno, ninguno lo es. */
export function esDelCron(c: Context): boolean {
  const secreto = process.env.CRON_SECRET
  if (!secreto) return false
  const auth = c.req.header('authorization') ?? ''
  return auth.toLowerCase().startsWith('bearer ') && iguales(auth.slice(7).trim(), secreto)
}

const sinPermiso = (c: Context) => c.json({ error: 'No tenés permiso para esto.' }, 401)

const tipoNotificacion = z.enum(TIPOS_NOTIFICACION as [string, ...string[]])
const porTipo = z.partialRecord(tipoNotificacion, z.boolean())
const esquemaPreferencias = z.strictObject({
  push: porTipo.optional(),
  correo: porTipo.optional(),
  silencio: z.strictObject({ desde: z.string(), hasta: z.string() }).nullable().optional(),
})

export function rutasIA(d: DepsRutasIA) {
  const r = new Hono()
  const ia = () => iaDe(d.servicio())
  const conSesion = () => {
    const via = d.via()
    if (via !== 'sesion' && via !== 'local') throw new ErrorDominio('Esto se hace desde la app, con tu sesión: la clave del MCP no alcanza.', 403)
  }

  // Lo que la web pide una sola vez al abrir: las últimas notificaciones y cuántas no leyó (y, desde la F2, los trabajos vivos).
  r.get('/novedades', async (c) => c.json(await ia().novedades()))

  r.get('/notificaciones', async (c) => c.json(await ia().notificaciones({ antes: c.req.query('antes') || undefined, limite: Number(c.req.query('limite')) || undefined })))
  r.post('/notificaciones/leer', async (c) => {
    const cuerpo = z.strictObject({ ids: z.array(z.string()).max(200).optional(), todas: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})))
    if (!cuerpo.todas && !cuerpo.ids?.length) throw new ErrorDominio('Mandá "ids" (las que leíste) o "todas": true.')
    return c.json({ leidas: await ia().marcarLeidas(cuerpo) })
  })
  r.get('/notificaciones/preferencias', async (c) => c.json(await ia().preferencias()))
  r.put('/notificaciones/preferencias', async (c) => c.json(await ia().guardarPreferencias(esquemaPreferencias.parse(await c.req.json()) as any)))

  // Vuelve a levantar las menciones que estaban escritas antes de que existiera la función (idempotente; solo con sesión).
  r.post('/ia/menciones/levantar', async (c) => {
    conSesion()
    await d.ctx(c)
    return c.json(await ia().levantarMencionesViejas())
  })

  // Configuración → IA: estado, claves, agentes, ajustes y gasto (rutas-claves.ts; lo que cambia algo pide sesión).
  r.route('/', rutasClavesIA(d))
  // ───────────────────────── C · trabajos de los agentes (F2) ─────────────────────────
  // Lo que ve la pantalla (y el MCP, para leer y frenar) sale del Servicio de la cuenta del pedido: un id ajeno da 404. Lo que gasta o da
  // permiso (confirmar, reanudar, reintentar) exige sesión: la clave del MCP no alcanza (10.2).

  r.get('/ia/trabajos', async (c) =>
    c.json(
      await ia().trabajos({
        hilo: c.req.query('hilo') || undefined,
        tarjeta: c.req.query('tarjeta') || undefined,
        vivos: c.req.query('vivos') === '1',
        limite: Number(c.req.query('limite')) || undefined,
      }),
    ),
  )
  r.get('/ia/trabajos/:id', async (c) => c.json(await ia().trabajo(c.req.param('id'))))
  r.post('/ia/trabajos/:id/cancelar', async (c) => c.json(await ia().cancelar(await d.ctx(c), c.req.param('id'))))
  r.post('/ia/trabajos/:id/confirmar', async (c) => {
    conSesion()
    const cuerpo = z
      .strictObject({ decisiones: z.array(z.strictObject({ llamadaId: z.string().min(1), permitir: z.boolean() })).min(1).max(100) })
      .parse(await c.req.json().catch(() => ({})))
    return c.json(await ia().confirmar(await d.ctx(c), c.req.param('id'), cuerpo.decisiones))
  })
  r.post('/ia/trabajos/:id/reanudar', async (c) => {
    conSesion()
    return c.json(await ia().reanudar(await d.ctx(c), c.req.param('id')))
  })
  r.post('/ia/menciones/:id/reintentar', async (c) => {
    conSesion()
    return c.json(await ia().reintentarMencion(await d.ctx(c), c.req.param('id')))
  })

  // ───────────────────────── C · rutas internas (11.3 y 11.4) ─────────────────────────
  // No son de la web: las llaman Telar mismo (encadenar), Vercel (el cron) y quien publica (el diagnóstico). Sin su secreto, 401.

  // Sigue con los trabajos de una cuenta en una ejecución nueva (con su propio reloj de 300 s). La clave abre la puerta; la cuenta va firmada.
  r.post('/ia/interno/correr', async (c) => {
    if (!d.claveValida(c)) return sinPermiso(c)
    const cuenta = leerAlcance(c.req.header('x-tablero-alcance'))
    if (!cuenta) return sinPermiso(c)
    enSegundoPlano(correr(d.raiz(), cuenta))
    return c.json({ aceptado: true }, 202)
  })

  // ¿Anda de verdad el segundo plano en Vercel? Responde al instante y 20 segundos después deja una línea en el registro. No toca datos.
  r.post('/ia/interno/diagnostico', async (c) => {
    if (!d.claveValida(c)) return sinPermiso(c)
    const ms = Number(process.env.TABLERO_IA_DIAGNOSTICO_MS) || 20_000
    enSegundoPlano(new Promise<void>((ok) => setTimeout(ok, ms)).then(() => console.log('[tablero] ia: segundo plano ok')))
    return c.json({ ok: true, esperaMs: ms })
  })

  // El cron (cada minuto en Pro): lo vencido de las cuentas, el resumen diario y el mantenimiento. Solo con CRON_SECRET.
  const cron = async (c: Context) => {
    if (!esDelCron(c)) return sinPermiso(c)
    return c.json(await barrer(d.raiz()))
  }
  r.get('/ia/interno/barrer', cron)
  r.post('/ia/interno/barrer', cron)

  return r
}
