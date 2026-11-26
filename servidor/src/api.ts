// API HTTP: JSON para la web, eventos en vivo (SSE), archivos y el MCP en /mcp.
// Cuentas (docs/cuentas.md): cada pedido tiene su ALCANCE (de qué cuenta es), que lo pone UN solo lugar: el middleware de
// alcance (cookie de sesión, clave del MCP o, en /mcp, el token OAuth). `servicio()` devuelve el Servicio de esa cuenta y,
// sin alcance, falla: ninguna ruta puede leer o escribir sin saber de quién es el pedido.
import { AsyncLocalStorage } from 'node:async_hooks'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { PUERTO_WEB_DEV, VERSION } from '../../compartido/constantes'
import type { Actor, InfoConexion } from '../../compartido/tipos'
import { TIPOS_TABLERO, VISTAS, type TipoTablero, type VistaTablero } from '../../compartido/vistas'
import { config, RAIZ, urlServidor } from './config'
import {
  anotarIngresoDueno,
  anotarIntento,
  cambiarClave,
  CUENTA_DUENO,
  cuentaDeUsuario,
  entrarTelar,
  leerCuenta,
  MENSAJE_DEMASIADOS,
  normalizarEmail,
  olvidarIntentos,
  pasado,
  registrar,
  usuarioDeCookie,
} from './cuentas'
import { contarPendientes, nombreDelDueno } from './solicitudes'
import { avisarTope, rutasAmigos } from './amigos-rutas'
import { codigosDeCuentaNueva } from './recuperacion'
import { rutasRecuperacion } from './recuperacion-rutas'
import { ErrorAlmacen } from './datos/almacen'
import { ErrorDominio, mimeDe, nuevoId, type Ctx, type Servicio } from './dominio/servicio'
import type { BusEventos } from './eventos'
import { importarDiscord } from './importar/discord-logica'
import { buscarHerramienta } from './mcp/herramientas'
import { crearServidorMcp, type Ejecutor } from './mcp/servidor-mcp'
import { rutasDiseno } from './diseno/rutas'
import { despacharIA } from './ia/despacho'
import { iaDe } from './ia/servicio-ia'
import { rutasIA } from './ia/rutas'
import { marcarPorCorrer } from './ia/segundo-plano'
import type { OperacionTabla } from '../../compartido/tabla'
import { emisor, oauthActivo } from './oauth/config'
import { cabeceraDesafio, validarAcceso } from './oauth/recurso'
import { rutasOAuthApi, rutasOAuthPublicas } from './oauth/rutas'
import {
  COOKIE_SESION,
  crearSesion,
  entrarConClave,
  entrarConCodigo,
  esPublico,
  juegoConfigurado,
  leerSesion,
  pedirCodigo,
  usuariosPermitidos,
} from './sesion'

export interface Estado {
  servicio: Servicio | null
  listo: Promise<void>
  clave: string
  bus: BusEventos
}

/** Corre una herramienta MCP en este proceso. Las IA quedan como miembros (se les puede asignar). */
export function ejecutorLocal(servicio: Servicio): Ejecutor {
  return async (nombre, args, actor) => {
    const h = buscarHerramienta(nombre)
    if (!h) throw new ErrorDominio(`No existe la herramienta ${nombre}.`, 404)
    let quien: Actor = actor
    if (actor.tipo === 'ia') {
      const m = await servicio.asegurarMiembroIA(actor.nombre)
      quien = { ...actor, id: m.id }
    }
    const validos = h.esquema.parse(args ?? {})
    return h.ejecutar(servicio, quien, validos)
  }
}

/** De quién es el pedido y cómo llegó. */
interface Alcance {
  cuenta: string
  via: 'local' | 'clave' | 'sesion' | 'oauth'
  /** El usuario de OAuth de la sesión («t:<id>» o el de la cuenta del juego): para «Permitir» y «Conexiones». */
  usuario: string | null
  /** Con OAuth, el nombre de la aplicación que se autorizó («ChatGPT»): firma lo que hace. */
  cliente?: string
}
// Va por el contexto asíncrono (no por un encabezado): el cliente no lo puede falsificar, y cualquier código que corre
// durante el pedido (las herramientas del MCP, Diseño) ve la misma cuenta.
const alcancePedido = new AsyncLocalStorage<Alcance>()

/** La IP de quien pide (Vercel la pone en x-forwarded-for; en la computadora, la del encabezado o «local»). */
function ipDe(c: Context): string {
  return (c.req.header('x-vercel-forwarded-for') || c.req.header('x-forwarded-for') || 'local').split(',')[0]!.trim().slice(0, 64)
}

const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
// Vercel no acepta pedidos de más de 4,5 MB: online, 4 MB por archivo
const TOPE_SUBIDA = () => (esPublico() ? 4 : 50) * 1024 * 1024

function origenPermitido(origen: string): boolean {
  try {
    const u = new URL(origen)
    if (HOSTS_LOCALES.has(u.hostname)) return true
    return config.origenesExtra.includes(u.origin)
  } catch {
    return false
  }
}

function hostPermitido(host: string | undefined): boolean {
  if (!host) return true
  const nombre = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!
  if (HOSTS_LOCALES.has(nombre)) return true
  return config.origenesExtra.some((o) => {
    try {
      return new URL(o).host === host
    } catch {
      return false
    }
  })
}

function servirArchivo(
  c: Context,
  raiz: string,
  relativa: string,
  cache = 'public, max-age=31536000, immutable',
  subido = false,
) {
  let rel: string
  try {
    rel = decodeURIComponent(relativa)
  } catch {
    return c.text('Ruta inválida', 400)
  }
  const destino = path.resolve(raiz, '.' + path.sep + rel)
  if (!destino.startsWith(path.resolve(raiz) + path.sep)) return c.text('No', 403)
  if (!existsSync(destino) || !statSync(destino).isFile()) return null
  const st = statSync(destino)
  const cuerpo = Readable.toWeb(createReadStream(destino)) as ReadableStream
  const headers: Record<string, string> = {
    'Content-Type': mimeDe(destino) === 'application/octet-stream' ? tipoWeb(destino) : mimeDe(destino),
    'Content-Length': String(st.size),
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  }
  // Lo que sube la gente (o llega de Discord) nunca corre código en la página.
  if (subido) headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"
  return new Response(cuerpo, { headers })
}

function tipoWeb(ruta: string): string {
  const ext = path.extname(ruta).toLowerCase()
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ico': 'image/x-icon',
      '.map': 'application/json',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
    }[ext] ?? 'application/octet-stream'
  )
}

export function crearApp(estado: Estado, opciones: { produccion: boolean; desarrollo?: boolean }) {
  const app = new Hono()
  /** El miembro «yo» de cada cuenta (el autor de lo que se hace desde la web). */
  const actoresYo = new Map<string, Actor>()

  /** El Servicio sin cuenta (solo para la base: sesiones, OAuth). */
  const raiz = () => {
    if (!estado.servicio) throw new ErrorDominio('El tablero todavía está arrancando.', 503)
    return estado.servicio
  }
  /** El Servicio de la cuenta del pedido. Sin alcance, 401: no hay forma de consultar sin saber de quién es el pedido. */
  const servicio = () => {
    const a = alcancePedido.getStore()
    if (!a) throw new ErrorDominio('Entrá con tu cuenta.', 401)
    return raiz().de(a.cuenta)
  }
  const ctxWeb = async (c: Context): Promise<Ctx> => {
    const s = servicio()
    let actor = actoresYo.get(s.cuenta)
    if (!actor) {
      const yo = (await s.listarMiembros()).find((m) => m.esYo)
      actor = { tipo: 'humano', id: yo?.id ?? 'yo', nombre: yo?.nombre ?? 'Vos' }
      if (yo) actoresYo.set(s.cuenta, actor)
    }
    return { actor, clienteId: c.req.header('x-tablero-cliente') ?? null, via: alcancePedido.getStore()?.via }
  }
  const claveValida = (c: Context) => {
    const auth = c.req.header('authorization') ?? ''
    const directa = c.req.header('x-tablero-clave') ?? ''
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
    return (token && token === estado.clave) || (directa && directa === estado.clave)
  }

  app.onError((e, c) => {
    if (e instanceof ErrorDominio || e instanceof ErrorAlmacen) return c.json({ error: e.message }, e.estado as 400)
    if (e instanceof z.ZodError) {
      const msj = e.issues.map((i) => `${i.path.join('.') || 'dato'}: ${i.message}`).join('; ')
      return c.json({ error: `Datos inválidos: ${msj}` }, 400)
    }
    console.error('[tablero] error:', e)
    return c.json({ error: 'Algo salió mal en el servidor.' }, 500)
  })

  // Lo que se anotó en la base durante el pedido (eventos en vivo, online) queda guardado antes de contestar. Y los trabajos de la IA que
  // nacieron en este pedido (una mención, un reintento) arrancan en segundo plano: ninguna ruta tiene que acordarse de largarlos (plan 11.2).
  app.use('*', async (_c, next) => {
    await next()
    await estado.bus.vaciar()
    despacharIA(estado.servicio)
  })

  // Seguridad local: solo la propia computadora (Host) y la propia app (Origin).
  // Online (TABLERO_PUBLICO=1): Vercel atiende solo sus dominios; lo que llega de otra página no pasa, y hay que entrar
  // con una cuenta (cookie) o mandar la clave del MCP (que es la cuenta 'dueno').
  /** El alcance del pedido: local, todo es de 'dueno'; online, la clave es 'dueno' y la cookie, la cuenta que entró. */
  const alcanceDe = async (c: Context): Promise<Alcance | null> => {
    if (!esPublico()) return { cuenta: CUENTA_DUENO, via: 'local', usuario: null }
    if (claveValida(c)) return { cuenta: CUENTA_DUENO, via: 'clave', usuario: null }
    const usuario = leerSesion(getCookie(c, COOKIE_SESION))
    if (!usuario) return null
    const r = await cuentaDeUsuario(raiz().db, usuario, usuariosPermitidos())
    return r ? { cuenta: r.cuenta, via: 'sesion', usuario: r.oauth } : null
  }
  // `/api/ia/interno/barrer` es del cron de Vercel: no trae sesión, trae `CRON_SECRET` (la ruta lo verifica y rechaza todo lo demás).
  const RUTAS_LIBRES = new Set(['/api/salud', '/api/sesion', '/api/sesion/codigo', '/api/cuentas', '/api/unirse', '/api/unirse/ver', '/api/solicitudes', '/api/recuperar', '/api/restablecer', '/api/restablecer/ver', '/api/ia/interno/barrer'])
  app.use('*', async (c, next) => {
    const origen = c.req.header('origin')
    if (esPublico()) {
      let mismo = false
      try {
        mismo = !!origen && new URL(origen).host === new URL(c.req.url).host
      } catch {
        mismo = false
      }
      const ruta = c.req.path
      // Los metadatos y el registro/canje de OAuth son públicos y sin cookies: los usan conectores (también desde un navegador,
      // como MCP Inspector), así que no se les mira el origen.
      if (ruta.startsWith('/.well-known/') || ruta === '/oauth/registrar' || ruta === '/oauth/token' || ruta === '/oauth/revocar') return next()
      if (origen && !mismo && !origenPermitido(origen)) return c.json({ error: 'Origen no permitido' }, 403)
      return next()
    }
    if (!hostPermitido(c.req.header('host'))) return c.text('Host no permitido', 403)
    if (origen && !origenPermitido(origen)) return c.json({ error: 'Origen no permitido' }, 403)
    await next()
  })

  // El alcance de /api y /archivos (el de /mcp lo pone su ruta, que también acepta OAuth). Un solo lugar.
  app.use('*', async (c, next) => {
    const ruta = c.req.path
    if (!ruta.startsWith('/api/') && !ruta.startsWith('/archivos/')) return next()
    if (ruta === '/api/salud') return next()
    await estado.listo
    const a = await alcanceDe(c)
    if (!a) {
      if (RUTAS_LIBRES.has(ruta)) return next()
      return c.json({ error: 'Entrá con tu cuenta.', entrar: true }, 401)
    }
    return alcancePedido.run(a, () => next())
  })

  // Las rutas esperan a que la base esté lista (el puerto se toma antes de abrirla).
  app.use('/api/*', async (c, next) => {
    await estado.listo
    await next()
  })
  app.use('/mcp', async (c, next) => {
    await estado.listo
    await next()
  })
  app.use('/oauth/*', async (c, next) => {
    await estado.listo
    await next()
  })
  app.use('/archivos/*', async (c, next) => {
    await estado.listo
    await next()
  })

  // ───── MCP por HTTP (Streamable HTTP, sin estado, atiende la era 2026 y la 2025) ─────
  const mcp = createMcpHandler(
    ({ requestInfo }) =>
      crearServidorMcp({
        ejecutor: ejecutorLocal(servicio()),
        autorFijo: requestInfo?.headers.get('x-tablero-autor'),
        // Con OAuth el nombre sale del cliente que se autorizó («ChatGPT»), no de lo que diga el pedido.
        agenteHttp: alcancePedido.getStore()?.cliente || requestInfo?.headers.get('user-agent'),
      }),
    { onerror: (e) => console.error('[tablero] mcp:', e.message) },
  )
  app.all('/mcp', async (c) => {
    // La clave de siempre (Claude Code, .mcp.json) sigue andando igual: es la cuenta 'dueno'.
    if (claveValida(c)) return alcancePedido.run({ cuenta: CUENTA_DUENO, via: 'clave', usuario: null }, () => mcp.fetch(c.req.raw))
    // Un token OAuth (ChatGPT, claude.ai): solo vale para /mcp y para este recurso, y corre con la cuenta que lo permitió.
    if (oauthActivo()) {
      const auth = c.req.header('authorization') ?? ''
      const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
      const acceso = token ? await validarAcceso(c, token, raiz().db) : null
      if (acceso)
        return alcancePedido.run({ cuenta: acceso.cuenta, via: 'oauth', usuario: acceso.usuario, cliente: acceso.nombreCliente || 'MCP' }, () =>
          mcp.fetch(c.req.raw),
        )
      // Sin ninguno: el 401 enseña dónde están los metadatos para que el cliente arme el OAuth solo.
      return c.json({ error: 'Hace falta conectar la aplicación (OAuth) o mandar la clave del tablero.' }, 401, {
        'WWW-Authenticate': cabeceraDesafio(c, Boolean(token)),
      })
    }
    return c.json(
      { error: 'Falta la clave del tablero: mandala como "Authorization: Bearer <clave>". Está en la app, en Conectar IA.' },
      401,
      { 'WWW-Authenticate': 'Bearer realm="tablero"' },
    )
  })

  const api = new Hono()

  api.get('/salud', (c) => c.json({ app: 'tablero', version: VERSION, listo: Boolean(estado.servicio) }))

  // ───── entrar (online: con una cuenta de Telar o la del juego; local: siempre adentro) ─────
  api.get('/sesion', async (c) => {
    // ¿Es la sesión del dueño? (Configuración → Amigos solo aparece para él: invitar y aprobar es dar permiso, y eso pide sesión.)
    const esDuenoConSesion = esPublico() && alcancePedido.getStore()?.via === 'sesion' && alcancePedido.getStore()?.cuenta === CUENTA_DUENO
    return c.json({
      publico: esPublico(),
      entrado: !esPublico() || Boolean(alcancePedido.getStore()),
      eventos: estado.bus.persistente ? 'sondeo' : 'sse',
      // Crear una cuenta está siempre abierto online (queda pendiente hasta que el dueño la apruebe). Sigue en la respuesta por compatibilidad.
      registro: esPublico(),
      amigos: esDuenoConSesion,
      // Cuántas solicitudes de cuenta esperan (solo para el dueño: la marca con el número del menú y de la campana).
      solicitudes: esDuenoConSesion ? await contarPendientes(raiz().db) : 0,
    })
  })
  const ponerSesion = (c: Context, usuario: string) => {
    const sesion = crearSesion(usuario)
    setCookie(c, COOKIE_SESION, sesion.valor, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: sesion.maxAge })
  }
  const MAL_ENTRAR = 'Mail o contraseña incorrectos.'
  // Entrar: primero una cuenta de Telar con ese mail; si no hay (o la contraseña no es la suya), las cuentas del juego como
  // siempre (así el dueño entra aunque alguien registre su mail). El mismo mensaje si el mail no existe o la contraseña es
  // mala, y un límite de intentos por mail y por IP.
  api.post('/sesion', async (c) => {
    if (!esPublico()) return c.json({ ok: true })
    const d = z
      .object({ email: z.string().trim().max(200), clave: z.string().max(200).optional(), codigo: z.string().max(20).optional() })
      .parse(await c.req.json())
    const db = raiz().db
    const ip = ipDe(c)
    const mail = normalizarEmail(d.email)
    if ((await pasado(db, 'entrar:ip', ip)) || (mail && (await pasado(db, 'entrar:mail', mail)))) return c.json({ error: MENSAJE_DEMASIADOS }, 429)
    const fallo = async (error: string, estadoHttp: 400 | 401 | 403 | 429 | 502) => {
      if (estadoHttp === 401) {
        await anotarIntento(db, 'entrar:ip', ip)
        if (mail) await anotarIntento(db, 'entrar:mail', mail)
      }
      return c.json({ error }, estadoHttp)
    }
    if (!d.codigo) {
      if (!mail || !d.clave) return c.json({ error: 'Escribí tu mail y tu contraseña.' }, 400)
      const t = await entrarTelar(db, mail, d.clave)
      if (t && 'suspendida' in t) return c.json({ error: 'Esta cuenta está suspendida. Escribile al dueño de Telar.' }, 403)
      // Solo con el mail y la contraseña CORRECTOS se dice que la cuenta espera (a quien falla se le contesta el error de siempre).
      if (t && 'pendiente' in t) return c.json({ error: `Tu cuenta todavía espera la aprobación de ${await nombreDelDueno(db)}.`, pendiente: true }, 403)
      if (t) {
        await olvidarIntentos(db, 'entrar:mail', mail)
        ponerSesion(c, usuarioDeCookie(t.cuenta))
        return c.json({ ok: true })
      }
      if (!juegoConfigurado()) return fallo(MAL_ENTRAR, 401)
    }
    const r = d.codigo ? await entrarConCodigo(d.email, d.codigo) : await entrarConClave(d.email, d.clave ?? '')
    if (!r.ok) return fallo(r.estado === 401 ? (d.codigo ? r.error : MAL_ENTRAR) : r.error, r.estado)
    await olvidarIntentos(db, 'entrar:mail', mail)
    await anotarIngresoDueno(db, d.email).catch(() => {})
    ponerSesion(c, r.usuario)
    return c.json({ ok: true })
  })
  api.post('/sesion/codigo', async (c) => {
    const d = z.object({ email: z.string().trim().max(200) }).parse(await c.req.json())
    const r = await pedirCodigo(d.email)
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 429)
  })
  // Crear cuenta con el código de la variable TABLERO_INVITACION (compatibilidad; sin ella, cerrado). Lo normal es el enlace: /api/unirse.
  api.post('/cuentas', async (c) => {
    if (!esPublico()) return c.json({ error: 'En esta computadora Telar no usa cuentas.' }, 404)
    const d = z
      .object({ email: z.string().max(200), nombre: z.string().max(200), clave: z.string().max(400), invitacion: z.string().max(200).default('') })
      .parse(await c.req.json())
    const r = await registrar(raiz().db, { ...d, ip: ipDe(c) })
    if (!r.ok) {
      if (r.tope) await avisarTope(raiz(), CUENTA_DUENO)
      return c.json({ error: r.error }, r.estado)
    }
    // Su base propia arranca con su miembro «yo» (el nombre del registro): es el autor de lo que haga.
    await raiz().de(r.cuenta.id).crearMiembro({ nombre: r.cuenta.nombre, tipo: 'humano', color: 'naranja', esYo: true })
    ponerSesion(c, usuarioDeCookie(r.cuenta))
    // Sus 8 códigos de recuperación (docs/cuentas.md): salen en esta respuesta y en ninguna otra (null si no se pudieron generar).
    const codigos = await codigosDeCuentaNueva(raiz().db, r.cuenta.id)
    return c.json({ ok: true, codigos }, 201, { 'Cache-Control': 'no-store' })
  })
  // Mi cuenta: nombre, mail y cuánto usa de sus topes.
  api.get('/cuenta', async (c) => {
    const a = alcancePedido.getStore()!
    const s = servicio()
    const cuenta = await leerCuenta(raiz().db, a.cuenta)
    const yo = (await s.listarMiembros()).find((m) => m.esYo)
    return c.json({
      id: a.cuenta,
      tipo: a.via === 'local' ? 'local' : a.cuenta === CUENTA_DUENO ? 'juego' : 'telar',
      nombre: yo?.nombre ?? cuenta?.nombre ?? '',
      email: cuenta?.email ?? null,
      uso: await s.uso(),
    })
  })
  // Cambiar la contraseña: pide la actual. Las otras sesiones de la cuenta se cierran; esta sigue (cookie nueva).
  api.post('/cuenta/clave', async (c) => {
    const a = alcancePedido.getStore()!
    if (a.via !== 'sesion' || a.cuenta === CUENTA_DUENO)
      return c.json({ error: 'Esta cuenta entra con la cuenta del juego: la contraseña se cambia en el juego.' }, 400)
    const d = z.object({ actual: z.string().max(400), nueva: z.string().max(400) }).parse(await c.req.json())
    const r = await cambiarClave(raiz().db, a.cuenta, d.actual, d.nueva)
    if (!r.ok) return c.json({ error: r.error }, r.estado)
    ponerSesion(c, usuarioDeCookie(r.cuenta))
    return c.json({ ok: true })
  })
  api.delete('/sesion', (c) => {
    deleteCookie(c, COOKIE_SESION, { path: '/', secure: true })
    return c.json({ ok: true })
  })

  api.get('/info', (c) => {
    // La clave del MCP es la de la cuenta 'dueno': a otra cuenta no se le muestra (le daría todo lo del dueño). Las cuentas
    // nuevas conectan su IA por OAuth (docs/conectar-chatgpt.md).
    const esDueno = alcancePedido.getStore()?.cuenta === CUENTA_DUENO
    const info: InfoConexion = {
      version: VERSION,
      puerto: config.puerto,
      // Online la dirección es https (el protocolo interno de Vercel es http): sale del emisor de OAuth.
      urlMcp: `${esPublico() ? emisor(c) : urlServidor()}/mcp`,
      clave: esDueno ? estado.clave : '',
      rutaTablero: esPublico() ? '' : RAIZ,
      baseDeDatos: servicio().db.tipo,
      rutaDatos: esPublico() ? 'Supabase (esquema tablero)' : config.datos,
    }
    return c.json(info)
  })

  // Puente para `npm run mcp` cuando ya hay un servidor corriendo: la herramienta corre acá.
  api.post('/herramientas/:nombre', async (c) => {
    if (!claveValida(c)) return c.json({ error: 'Clave inválida.' }, 401)
    const cuerpo = (await c.req.json()) as { args?: unknown; actor?: Actor }
    const actor: Actor =
      cuerpo.actor && cuerpo.actor.tipo === 'ia'
        ? { tipo: 'ia', id: String(cuerpo.actor.id), nombre: String(cuerpo.actor.nombre), cliente: cuerpo.actor.cliente }
        : { tipo: 'ia', id: 'ia:ia', nombre: 'IA' }
    try {
      const r = await ejecutorLocal(servicio())(c.req.param('nombre'), cuerpo.args ?? {}, actor)
      return c.json({ ok: true, resultado: r })
    } catch (e) {
      if (e instanceof z.ZodError) throw e
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200)
    }
  })

  // El importador de Discord es solo del dueño (pide la clave del MCP, que es la cuenta 'dueno').
  api.post('/importar/discord', async (c) => {
    if (!claveValida(c)) return c.json({ error: 'Clave inválida.' }, 401)
    const { ruta, proyecto, tablero } = z
      .object({ ruta: z.string(), proyecto: z.string().optional(), tablero: z.string().optional() })
      .parse(await c.req.json())
    const informe = await importarDiscord(servicio(), ruta, { proyecto, tablero })
    return c.json(informe)
  })

  // Importar desde otra computadora (online): primero cada adjunto (de a uno), después el JSON de los temas.
  api.post('/importar/archivo', async (c) => {
    if (!claveValida(c)) return c.json({ error: 'Clave inválida.' }, 401)
    const form = await c.req.formData()
    const archivo = form.get('archivo')
    if (!(archivo instanceof File)) throw new ErrorDominio('Falta el archivo.')
    const nombre = path.basename(archivo.name || '')
    if (!/^[a-zA-Z0-9._-]+$/.test(nombre)) throw new ErrorDominio('Nombre de archivo inválido.')
    await servicio().almacen.guardar(`importar/${nombre}`, new Uint8Array(await archivo.arrayBuffer()), archivo.type || mimeDe(nombre))
    return c.json({ ok: true, nombre }, 201)
  })
  api.post('/importar/discord-json', async (c) => {
    if (!claveValida(c)) return c.json({ error: 'Clave inválida.' }, 401)
    const d = z.object({ datos: z.unknown(), proyecto: z.string().optional(), tablero: z.string().optional() }).parse(await c.req.json())
    const crudo = d.datos as any
    const items: any[] = Array.isArray(crudo) ? crudo : crudo?.items ?? crudo?.temas ?? crudo?.pendientes ?? []
    const nombres = [
      ...new Set(
        items.flatMap((it) => (Array.isArray(it?.adjuntos) ? it.adjuntos : [])).map((a: any) => path.basename(String(a?.ruta ?? ''))),
      ),
    ].filter((n) => /^[a-zA-Z0-9._-]+$/.test(n))
    const carpeta = mkdtempSync(path.join(os.tmpdir(), 'tablero-importar-'))
    try {
      for (const n of nombres) {
        const a = await servicio().almacen.leer(`importar/${n}`)
        if (a) writeFileSync(path.join(carpeta, n), a.datos)
      }
      const json = path.join(carpeta, 'pendientes.json')
      writeFileSync(json, JSON.stringify(d.datos))
      const informe = await importarDiscord(servicio(), json, { proyecto: d.proyecto, tablero: d.tablero })
      for (const n of nombres) await servicio().almacen.borrar(`importar/${n}`)
      return c.json(informe)
    } finally {
      rmSync(carpeta, { recursive: true, force: true })
    }
  })

  // ───── eventos en vivo ─────
  // Online: la web pregunta cada pocos segundos qué pasó después del último que vio.
  // Cada cuenta ve solo sus eventos (los marca el bus de su Servicio).
  api.get('/eventos/desde', async (c) => {
    const cuenta = servicio().cuenta
    const n = Number(c.req.query('n'))
    // `ia=1`: la web tiene un trabajo de un agente a la vista. Es la red de seguridad (11.4): si quedó algo vencido y sin dueño, se levanta.
    // Una consulta indexada, solo en ese caso; el despacho de siempre lo larga en segundo plano después de contestar.
    if (c.req.query('ia') === '1' && (await iaDe(servicio()).hayVencidos())) marcarPorCorrer(cuenta)
    if (!(n > 0)) return c.json({ n: await estado.bus.ultimo(cuenta), eventos: [], completo: true })
    const filas = await estado.bus.desde(cuenta, n)
    if (Math.random() < 0.02) await estado.bus.limpiar().catch(() => {})
    return c.json({ n: filas.length ? filas[filas.length - 1]!.n : n, eventos: filas.map((f) => f.evento), completo: filas.length < 300 })
  })
  api.get('/eventos', (c) => {
    const cuenta = servicio().cuenta
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'hola', data: JSON.stringify({ version: VERSION }) })
      const pendientes: string[] = []
      let despertar: (() => void) | null = null
      const fuera = estado.bus.suscribir(cuenta, (e) => {
        pendientes.push(JSON.stringify(e))
        despertar?.()
      })
      let vivo = true
      stream.onAbort(() => {
        vivo = false
        fuera()
        despertar?.()
      })
      while (vivo) {
        if (pendientes.length === 0) {
          await new Promise<void>((r) => {
            despertar = r
            setTimeout(r, 20000)
          })
          despertar = null
          if (pendientes.length === 0 && vivo) {
            await stream.writeSSE({ event: 'latido', data: String(Date.now()) })
            continue
          }
        }
        while (pendientes.length && vivo) await stream.writeSSE({ event: 'cambio', data: pendientes.shift()! })
      }
    })
  })

  // ───── proyectos, miembros, etiquetas ─────
  // Sin ?archivados=1 no vienen proyectos ni tableros archivados.
  api.get('/proyectos', async (c) => c.json(await servicio().listarProyectos(c.req.query('archivados') === '1')))
  api.post('/proyectos', async (c) => {
    const d = z
      .object({
        nombre: z.string().min(1),
        prefijo: z.string().min(1),
        color: z.string().optional(),
        repoGithub: z.string().nullable().optional(),
        descripcion: z.string().max(280).optional(),
        emoji: z.string().max(16).nullable().optional(),
        // Qué tipo es el primer tablero (de fábrica, «tablero»: solo Kanban).
        tipo: z.enum(TIPOS_TABLERO as [TipoTablero, ...TipoTablero[]]).optional(),
      })
      .parse(await c.req.json())
    return c.json(await servicio().crearProyecto(await ctxWeb(c), d as any), 201)
  })
  api.patch('/proyectos/:id', async (c) => {
    const d = z
      .object({
        nombre: z.string().optional(),
        color: z.string().optional(),
        repoGithub: z.string().nullable().optional(),
        descripcion: z.string().max(280).optional(),
        archivado: z.boolean().optional(),
        emoji: z.string().max(16).nullable().optional(),
        imagen: z.null().optional(),
      })
      .parse(await c.req.json())
    return c.json(await servicio().actualizarProyecto(await ctxWeb(c), c.req.param('id'), d as any))
  })
  // La foto del proyecto: el navegador ya la recortó a 256 × 256. Solo imágenes de mapa de bits (no SVG: puede traer
  // código y se sirve desde el mismo dominio). El nombre lleva un nanoid para que no quede la vieja en caché.
  api.post('/proyectos/:id/imagen', async (c) => {
    const form = await c.req.formData()
    const archivo = form.get('archivo')
    if (!(archivo instanceof File)) throw new ErrorDominio('Falta el archivo.')
    const tipos: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
    const ext = tipos[archivo.type]
    if (!ext) throw new ErrorDominio('La foto tiene que ser PNG, JPG, WebP o GIF.', 415)
    if (archivo.size > 512 * 1024) throw new ErrorDominio('La foto pesa más de 512 KB.', 413)
    const id = c.req.param('id')
    await servicio().propio('proyecto', id)
    const ruta = `proyectos/${id.replace(/[^a-zA-Z0-9_-]/g, '')}-${nuevoId()}.${ext}`
    await servicio().almacen.guardar(ruta, new Uint8Array(await archivo.arrayBuffer()), archivo.type)
    return c.json(await servicio().ponerImagenProyecto(await ctxWeb(c), id, `/archivos/${ruta}`))
  })
  api.get('/miembros', async (c) => {
    const s = servicio()
    let miembros = await s.listarMiembros()
    // Los de antes de la migración no tienen alias: se les completa una sola vez (un update por miembro).
    if (miembros.some((m) => !m.alias)) {
      await iaDe(s).asegurarAlias()
      miembros = await s.listarMiembros()
    }
    // Los que son agentes de la IA integrada llevan el resumen de su agente (modo, estado, modelo).
    return c.json(await iaDe(s).conResumenDeAgentes(miembros))
  })
  api.patch('/miembros/:id', async (c) => {
    const d = z.object({ nombre: z.string().optional(), color: z.string().optional(), alias: z.string().optional() }).parse(await c.req.json())
    actoresYo.delete(servicio().cuenta)
    return c.json(await servicio().actualizarMiembro(await ctxWeb(c), c.req.param('id'), d as any))
  })
  api.post('/proyectos/:id/etiquetas', async (c) => {
    const d = z.object({ nombre: z.string().min(1), color: z.string().optional(), grupo: z.string().nullable().optional() }).parse(await c.req.json())
    return c.json(await servicio().crearEtiqueta(await ctxWeb(c), { proyectoId: c.req.param('id'), ...d } as any), 201)
  })
  api.patch('/etiquetas/:id', async (c) => {
    const d = z.object({ nombre: z.string().optional(), color: z.string().optional() }).parse(await c.req.json())
    return c.json(await servicio().actualizarEtiqueta(await ctxWeb(c), c.req.param('id'), d as any))
  })
  api.delete('/etiquetas/:id', async (c) => {
    await servicio().eliminarEtiqueta(await ctxWeb(c), c.req.param('id'))
    return c.json({ ok: true })
  })

  // ───── tableros y listas ─────
  api.post('/tableros', async (c) => {
    // `tipo` es un atajo para un conjunto de `vistas` (compartido/vistas.ts); de fábrica, «tablero» (solo Kanban).
    const d = z
      .object({
        proyectoId: z.string(),
        nombre: z.string().min(1),
        descripcion: z.string().optional(),
        tipo: z.enum(TIPOS_TABLERO as [TipoTablero, ...TipoTablero[]]).optional(),
        vistas: z.array(z.enum(VISTAS as [VistaTablero, ...VistaTablero[]])).min(1).optional(),
      })
      .parse(await c.req.json())
    return c.json(await servicio().crearTablero(await ctxWeb(c), d), 201)
  })
  api.get('/tableros/:id', async (c) => c.json(await servicio().leerTableroCompleto(c.req.param('id'))))
  api.patch('/tableros/:id', async (c) => {
    const d = z
      .object({
        nombre: z.string().optional(),
        descripcion: z.string().optional(),
        archivado: z.boolean().optional(),
        vistas: z.array(z.enum(VISTAS as [VistaTablero, ...VistaTablero[]])).min(1).optional(),
        ajustes: z
          .object({
            lienzo: z
              .object({
                fondo: z.enum(['puntos', 'lineas', 'cruces', 'liso']).optional(),
                grilla: z.union([z.literal(8), z.literal(16), z.literal(24), z.literal(32), z.literal(48)]).optional(),
                imanGrilla: z.boolean().optional(),
                imanObjetos: z.boolean().optional(),
              })
              .optional(),
            archivoHecho: z.object({ dias: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(60), z.null()]) }).optional(),
          })
          .optional(),
      })
      .parse(await c.req.json())
    return c.json(await servicio().actualizarTablero(await ctxWeb(c), c.req.param('id'), d))
  })
  api.get('/tableros/:id/archivadas', async (c) => c.json(await servicio().listarArchivadas(c.req.param('id'))))
  api.get('/tableros/:id/actividad', async (c) =>
    c.json(await servicio().listarActividad({ tableroId: c.req.param('id'), limite: Number(c.req.query('limite')) || 80 })),
  )
  api.post('/listas', async (c) => {
    const d = z
      .object({
        id: z.string().optional(),
        tableroId: z.string(),
        nombre: z.string().min(1),
        categoria: z.enum(['por_hacer', 'en_curso', 'hecho']).nullable().optional(),
        posicion: z.number().int().optional(),
      })
      .parse(await c.req.json())
    return c.json(await servicio().crearLista(await ctxWeb(c), d), 201)
  })
  api.patch('/listas/:id', async (c) => {
    const d = z
      .object({
        nombre: z.string().optional(),
        categoria: z.enum(['por_hacer', 'en_curso', 'hecho']).nullable().optional(),
        color: z.string().nullable().optional(),
        limite: z.number().int().positive().nullable().optional(),
        archivada: z.boolean().optional(),
        indice: z.number().int().min(0).optional(),
      })
      .parse(await c.req.json())
    return c.json(await servicio().actualizarLista(await ctxWeb(c), c.req.param('id'), d as any))
  })

  // ───── tarjetas ─────
  const esquemaPorque = z.object({
    motivo: z.string().optional(),
    contexto: z.string().optional(),
    opciones: z
      .array(
        z.object({
          titulo: z.string(),
          pros: z.string().optional(),
          contras: z.string().optional(),
          elegida: z.boolean().optional(),
          descartadaPorque: z.string().optional(),
        }),
      )
      .optional(),
    decision: z.string().optional(),
    consecuencias: z.string().optional(),
    estado: z.enum(['abierta', 'propuesta', 'aceptada', 'rechazada', 'reemplazada']).optional(),
    evidencias: z.array(z.string()).optional(),
    decidieron: z.array(z.string()).optional(),
    revisarEn: z.string().nullable().optional(),
    reemplazadaPor: z.string().nullable().optional(),
  })
  api.post('/tarjetas', async (c) => {
    const d = z
      .object({
        tableroId: z.string(),
        listaId: z.string().nullable().optional(),
        titulo: z.string().min(1),
        tipo: z.string().optional(),
        descripcion: z.string().optional(),
        prioridad: z.string().optional(),
        etiquetas: z.array(z.string()).optional(),
        responsables: z.array(z.string()).optional(),
        vence: z.string().nullable().optional(),
        inicio: z.string().nullable().optional(),
        estimacion: z.number().nullable().optional(),
        padre: z.string().nullable().optional(),
        posicion: z.union([z.enum(['arriba', 'abajo']), z.number().int()]).optional(),
        porque: esquemaPorque.optional(),
      })
      .parse(await c.req.json())
    return c.json(await servicio().crearTarjeta(await ctxWeb(c), d as any), 201)
  })
  api.get('/tarjetas/:ref', async (c) => c.json(await servicio().leerTarjeta(c.req.param('ref'))))
  api.patch('/tarjetas/:ref', async (c) => {
    const d = z
      .object({
        titulo: z.string().optional(),
        descripcion: z.string().optional(),
        tipo: z.string().optional(),
        prioridad: z.string().optional(),
        estimacion: z.number().nullable().optional(),
        etiquetas: z.array(z.string()).optional(),
        agregarEtiquetas: z.array(z.string()).optional(),
        quitarEtiquetas: z.array(z.string()).optional(),
        responsables: z.array(z.string()).optional(),
        inicio: z.string().nullable().optional(),
        vence: z.string().nullable().optional(),
        conHora: z.boolean().optional(),
        completada: z.boolean().optional(),
        portada: z
          .object({ tipo: z.enum(['color', 'imagen']), valor: z.string(), tamano: z.enum(['arriba', 'completa']) })
          .nullable()
          .optional(),
        padre: z.string().nullable().optional(),
        version: z.number().int().optional(),
      })
      .parse(await c.req.json())
    return c.json(await servicio().actualizarTarjeta(await ctxWeb(c), c.req.param('ref'), d as any))
  })
  api.post('/tarjetas/:ref/mover', async (c) => {
    const d = z
      .object({ listaId: z.string(), posicion: z.union([z.enum(['arriba', 'abajo']), z.number().int().min(0)]).optional() })
      .parse(await c.req.json())
    return c.json(await servicio().moverTarjeta(await ctxWeb(c), c.req.param('ref'), d))
  })
  api.post('/tarjetas/:ref/archivar', async (c) => {
    const d = z.object({ archivar: z.boolean().default(true) }).parse(await c.req.json().catch(() => ({})))
    return c.json(await servicio().archivarTarjeta(await ctxWeb(c), c.req.param('ref'), d.archivar))
  })
  api.post('/tarjetas/:ref/copiar', async (c) => {
    const d = z.object({ listaId: z.string().optional(), titulo: z.string().optional() }).parse(await c.req.json().catch(() => ({})))
    return c.json(await servicio().copiarTarjeta(await ctxWeb(c), c.req.param('ref'), d), 201)
  })
  api.put('/tarjetas/:ref/porque', async (c) => {
    const d = esquemaPorque.parse(await c.req.json())
    return c.json(await servicio().registrarPorque(await ctxWeb(c), c.req.param('ref'), d as any))
  })
  api.post('/tarjetas/:ref/comentarios', async (c) => {
    // `id` lo pone el navegador (así un reintento de red no crea dos) y `respondeA` es otro comentario de la misma tarjeta.
    const d = z
      .object({ cuerpo: z.string().min(1), id: z.string().regex(/^[A-Za-z0-9_-]{8,32}$/, 'tiene que tener entre 8 y 32 letras, números, _ o -').optional(), respondeA: z.string().nullable().optional() })
      .parse(await c.req.json())
    return c.json(await servicio().comentar(await ctxWeb(c), c.req.param('ref'), d.cuerpo, { id: d.id, respuestaA: d.respondeA }), 201)
  })
  api.patch('/comentarios/:id', async (c) => {
    const d = z.object({ cuerpo: z.string().min(1) }).parse(await c.req.json())
    return c.json(await servicio().editarComentario(await ctxWeb(c), c.req.param('id'), d.cuerpo))
  })
  api.delete('/comentarios/:id', async (c) => {
    await servicio().eliminarComentario(await ctxWeb(c), c.req.param('id'))
    return c.json({ ok: true })
  })
  api.post('/tarjetas/:ref/checklists', async (c) => {
    const d = z.object({ titulo: z.string().default('Checklist'), items: z.array(z.string()).optional() }).parse(await c.req.json())
    const id = await servicio().crearChecklist(await ctxWeb(c), c.req.param('ref'), d.titulo, d.items ?? [])
    return c.json({ id }, 201)
  })
  api.patch('/checklists/:id', async (c) => {
    const d = z.object({ titulo: z.string().optional(), ocultarHechos: z.boolean().optional() }).parse(await c.req.json())
    await servicio().actualizarChecklist(await ctxWeb(c), c.req.param('id'), d)
    return c.json({ ok: true })
  })
  api.delete('/checklists/:id', async (c) => {
    await servicio().eliminarChecklist(await ctxWeb(c), c.req.param('id'))
    return c.json({ ok: true })
  })
  api.post('/checklists/:id/items', async (c) => {
    const d = z.object({ texto: z.string().min(1), indice: z.number().int().min(0).optional() }).parse(await c.req.json())
    await servicio().agregarItem(await ctxWeb(c), c.req.param('id'), d.texto, d.indice)
    return c.json({ ok: true }, 201)
  })
  api.patch('/items/:id', async (c) => {
    const d = z
      .object({
        texto: z.string().optional(),
        hecho: z.boolean().optional(),
        responsableId: z.string().nullable().optional(),
        vence: z.string().nullable().optional(),
        indice: z.number().int().min(0).optional(),
      })
      .parse(await c.req.json())
    await servicio().actualizarItem(await ctxWeb(c), c.req.param('id'), d)
    return c.json({ ok: true })
  })
  api.delete('/items/:id', async (c) => {
    await servicio().eliminarItem(await ctxWeb(c), c.req.param('id'))
    return c.json({ ok: true })
  })
  api.post('/items/:id/convertir', async (c) => c.json(await servicio().convertirItemEnTarjeta(await ctxWeb(c), c.req.param('id')), 201))

  api.post('/tarjetas/:ref/adjuntos', async (c) => {
    const form = await c.req.formData()
    const archivo = form.get('archivo')
    if (!(archivo instanceof File)) throw new ErrorDominio('Falta el archivo.')
    if (archivo.size > TOPE_SUBIDA()) throw new ErrorDominio(`El archivo pesa más de ${TOPE_SUBIDA() / 1024 / 1024} MB.`, 413)
    const datos = new Uint8Array(await archivo.arrayBuffer())
    const adj = await servicio().agregarAdjunto(await ctxWeb(c), c.req.param('ref'), {
      nombre: archivo.name || 'archivo',
      datos,
      mime: archivo.type || null,
      descripcion: String(form.get('descripcion') ?? ''),
    })
    return c.json(adj, 201)
  })
  api.delete('/adjuntos/:id', async (c) => {
    await servicio().eliminarAdjunto(await ctxWeb(c), c.req.param('id'))
    return c.json({ ok: true })
  })
  api.post('/tarjetas/:ref/enlaces', async (c) => {
    const d = z.object({ url: z.string().min(1), titulo: z.string().optional() }).parse(await c.req.json())
    return c.json(await servicio().agregarEnlace(await ctxWeb(c), c.req.param('ref'), d.url, d.titulo), 201)
  })
  api.delete('/enlaces/:id', async (c) => c.json(await servicio().eliminarEnlace(await ctxWeb(c), c.req.param('id'))))
  api.post('/tarjetas/:ref/vinculos', async (c) => {
    const d = z
      .object({
        tipo: z.enum(['bloquea', 'depende_de', 'relacionada', 'duplica', 'causa', 'implementa']),
        con: z.string().min(1),
        nota: z.string().optional(),
      })
      .parse(await c.req.json())
    return c.json(await servicio().vincular(await ctxWeb(c), c.req.param('ref'), d.tipo, d.con, d.nota), 201)
  })
  api.delete('/vinculos/:id', async (c) => c.json(await servicio().desvincular(await ctxWeb(c), c.req.param('id'))))

  // ───── lienzo ─────
  const esquemaElemento = z.object({
    id: z.string().optional(),
    tipo: z.enum(['nota', 'texto', 'forma', 'marco', 'tarjeta', 'lista', 'imagen', 'enlace', 'figma', 'tabla', 'grafico']),
    x: z.number(),
    y: z.number(),
    ancho: z.number().positive().optional(),
    alto: z.number().positive().optional(),
    z: z.number().int().optional(),
    tarjetaId: z.string().nullable().optional(),
    listaId: z.string().nullable().optional(),
    datos: z.record(z.string(), z.unknown()).optional(),
  })
  api.post('/tableros/:id/elementos', async (c) => {
    const cuerpo = await c.req.json()
    if (Array.isArray(cuerpo?.elementos)) {
      const ctx = await ctxWeb(c)
      const creados = []
      for (const e of cuerpo.elementos) creados.push(await servicio().crearElemento(ctx, c.req.param('id'), esquemaElemento.parse(e)))
      return c.json(creados, 201)
    }
    return c.json(await servicio().crearElemento(await ctxWeb(c), c.req.param('id'), esquemaElemento.parse(cuerpo)), 201)
  })
  // Tablas: se cambian con operaciones (compartido/tabla.ts), las mismas que usa el MCP. La web las manda sin «estricto»:
  // al pegar desde Excel, lo que no encaja queda vacío y vuelve un aviso.
  api.patch('/elementos/:id/tabla', async (c) => {
    const d = z
      .object({
        operaciones: z.array(z.looseObject({ op: z.string() })).max(100),
        cambios: z
          .object({
            titulo: z.string().max(120).optional(),
            color: z.string().optional(),
            cabecera: z.enum(['tinte', 'fuerte', 'lisa']).optional(),
            rayas: z.boolean().optional(),
            numerosFila: z.boolean().optional(),
          })
          .optional(),
      })
      .parse(await c.req.json())
    return c.json(
      await servicio().operarTabla(await ctxWeb(c), c.req.param('id'), d.operaciones as unknown as OperacionTabla[], {
        cambios: d.cambios as any,
      }),
    )
  })
  api.patch('/elementos', async (c) => {
    const d = z
      .object({
        cambios: z.array(
          z.object({
            id: z.string(),
            x: z.number().optional(),
            y: z.number().optional(),
            ancho: z.number().positive().optional(),
            alto: z.number().positive().optional(),
            z: z.number().int().optional(),
            datos: z.record(z.string(), z.unknown()).optional(),
            bloqueado: z.boolean().optional(),
          }),
        ),
      })
      .parse(await c.req.json())
    return c.json(await servicio().actualizarElementos(await ctxWeb(c), d.cambios))
  })
  api.post('/elementos/eliminar', async (c) => {
    const d = z.object({ ids: z.array(z.string()) }).parse(await c.req.json())
    return c.json(await servicio().eliminarElementos(await ctxWeb(c), d.ids))
  })
  // Convertir una nota, un texto o una forma en otra de esas cosas o en una tarjeta del Kanban (un solo paso).
  api.post('/elementos/convertir', async (c) => {
    const d = z
      .object({ id: z.string(), a: z.enum(['tarjeta', 'nota', 'texto', 'forma']), listaId: z.string().nullable().optional() })
      .parse(await c.req.json())
    return c.json(await servicio().convertirElemento(await ctxWeb(c), d.id, d.a, d.listaId ?? null), 201)
  })
  api.post('/elementos/restaurar', async (c) => {
    const d = z.object({ ids: z.array(z.string()), conectores: z.array(z.string()).optional() }).parse(await c.req.json())
    return c.json(await servicio().restaurarElementos(await ctxWeb(c), d.ids, d.conectores ?? []))
  })
  const esquemaConector = z.object({
    id: z.string().optional(),
    desdeId: z.string(),
    hastaId: z.string(),
    desdeLado: z.enum(['arriba', 'derecha', 'abajo', 'izquierda']).nullable().optional(),
    hastaLado: z.enum(['arriba', 'derecha', 'abajo', 'izquierda']).nullable().optional(),
    trazo: z.enum(['recto', 'ortogonal', 'curvo']).optional(),
    puntaInicio: z.enum(['ninguna', 'flecha', 'flecha_abierta', 'triangulo', 'punto', 'rombo', 'barra']).optional(),
    puntaFin: z.enum(['ninguna', 'flecha', 'flecha_abierta', 'triangulo', 'punto', 'rombo', 'barra']).optional(),
    guion: z.enum(['solido', 'rayado', 'punteado']).optional(),
    color: z.string().nullable().optional(),
    grosor: z.number().positive().optional(),
    etiqueta: z.string().optional(),
  })
  api.post('/tableros/:id/conectores', async (c) => {
    const d = esquemaConector.parse(await c.req.json())
    return c.json(await servicio().crearConector(await ctxWeb(c), c.req.param('id'), d as any), 201)
  })
  api.patch('/conectores/:id', async (c) => {
    const d = esquemaConector.partial().parse(await c.req.json())
    return c.json(await servicio().actualizarConector(await ctxWeb(c), c.req.param('id'), d as any))
  })
  api.post('/conectores/eliminar', async (c) => {
    const d = z.object({ ids: z.array(z.string()) }).parse(await c.req.json())
    return c.json(await servicio().eliminarConectores(await ctxWeb(c), d.ids))
  })
  // Imágenes sueltas para el lienzo (pegar o soltar una imagen).
  api.post('/archivos', async (c) => {
    const form = await c.req.formData()
    const archivo = form.get('archivo')
    if (!(archivo instanceof File)) throw new ErrorDominio('Falta el archivo.')
    if (archivo.size > TOPE_SUBIDA()) throw new ErrorDominio(`El archivo pesa más de ${TOPE_SUBIDA() / 1024 / 1024} MB.`, 413)
    const nombre = `${nuevoId()}-${(archivo.name || 'imagen').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-60)}`
    await servicio().almacen.guardar(`lienzo/${nombre}`, new Uint8Array(await archivo.arrayBuffer()), archivo.type || mimeDe(nombre))
    return c.json({ url: `/archivos/lienzo/${nombre}`, nombre: archivo.name }, 201)
  })

  // ───── OAuth: la pantalla «Permitir» y las conexiones (servidor/src/oauth/rutas.ts) ─────
  api.route(
    '/oauth',
    rutasOAuthApi({ db: () => raiz().db, usuarioSesion: () => (alcancePedido.getStore()?.via === 'sesion' ? alcancePedido.getStore()!.usuario : null) }),
  )

  // ───── amigos: invitaciones por enlace y suspender (servidor/src/amigos-rutas.ts) ─────
  api.route(
    '/',
    rutasAmigos({
      servicio,
      raiz,
      via: () => alcancePedido.getStore()?.via,
      ip: ipDe,
      enlace: (c, token, ruta = 'unirse') => `${emisor(c)}/${ruta}/${token}`,
      ponerSesion,
    }),
  )

  // ───── recuperar la contraseña sin correo: códigos de recuperación y restablecimiento (servidor/src/recuperacion-rutas.ts) ─────
  api.route(
    '/',
    rutasRecuperacion({
      raiz,
      via: () => alcancePedido.getStore()?.via,
      cuenta: () => alcancePedido.getStore()?.cuenta,
      ip: ipDe,
      ponerSesion,
    }),
  )

  // ───── novedades, notificaciones y menciones (servidor/src/ia/rutas.ts) ─────
  api.route('/', rutasIA({ servicio, raiz, ctx: ctxWeb, via: () => alcancePedido.getStore()?.via, claveValida: (c) => Boolean(claveValida(c)) }))

  // ───── Diseño (servidor/src/diseno/rutas.ts) ─────
  api.route(
    '/diseno',
    rutasDiseno({ servicio, servicioDe: (cuenta) => raiz().de(cuenta), ctx: ctxWeb, claveValida: (c) => Boolean(claveValida(c)) }),
  )

  // ───── búsqueda ─────
  api.get('/buscar', async (c) => {
    const q = c.req.query('q') ?? ''
    if (!q.trim()) return c.json([])
    return c.json(
      await servicio().buscar(q, {
        proyectoId: c.req.query('proyecto') || undefined,
        tableroId: c.req.query('tablero') || undefined,
        limite: Number(c.req.query('limite')) || 30,
      }),
    )
  })

  // Validación de tipos de contenido para escrituras (obliga a un preflight CORS desde otros sitios).
  app.use('/api/*', async (c, next) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.req.method)) {
      const tipo = c.req.header('content-type') ?? ''
      const vacio = !c.req.header('content-length') || c.req.header('content-length') === '0'
      if (!vacio && !tipo.includes('application/json') && !tipo.includes('multipart/form-data'))
        return c.json({ error: 'Tipo de contenido no permitido.' }, 415)
    }
    await next()
  })
  app.route('/api', api)
  // ───── OAuth para ChatGPT y claude.ai: metadatos, registro, autorizar y token ─────
  app.route('/', rutasOAuthPublicas({ db: () => raiz().db }))
  app.all('/api/*', (c) => c.json({ error: 'No existe esa ruta de la API.' }, 404))

  // ───── archivos subidos ─────
  app.get('/archivos/*', async (c) => {
    let a: Awaited<ReturnType<Servicio['almacen']['leer']>>
    let rel = ''
    // El almacén es el de la cuenta del pedido: la misma dirección de otra cuenta da 404 (es otra carpeta).
    try {
      rel = decodeURIComponent(c.req.path.replace(/^\/archivos\//, ''))
      a = await servicio().almacen.leer(rel)
    } catch (e) {
      if (e instanceof ErrorDominio) throw e
      return c.text('Ruta inválida', 400)
    }
    if (!a) return c.text('No encontrado', 404)
    const mime = a.mime || (mimeDe(rel) === 'application/octet-stream' ? tipoWeb(rel) : mimeDe(rel))
    return new Response(a.datos as BodyInit, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(a.datos.byteLength),
        'Cache-Control': esPublico() ? 'private, max-age=31536000, immutable' : 'public, max-age=31536000, immutable',
        // La misma dirección es otro archivo en otra cuenta (cada cuenta tiene su carpeta): el caché la separa por sesión.
        ...(esPublico() ? { Vary: 'Cookie, Authorization' } : {}),
        'X-Content-Type-Options': 'nosniff',
        // Lo que sube la gente (o llega de Discord) nunca corre código en la página.
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    })
  })

  // ───── la web ─────
  if (opciones.desarrollo) {
    // Con npm run dev la web la sirve Vite: los links (por ejemplo los que devuelve el MCP) se mandan para allá.
    app.get('*', (c) => {
      const url = new URL(c.req.url)
      return c.redirect(`http://127.0.0.1:${Number(process.env.TABLERO_PUERTO_WEB) || PUERTO_WEB_DEV}${url.pathname}${url.search}`, 302)
    })
  } else {
    // Si no, la web compilada (npm run build; npm install ya la compila una vez).
    app.get('*', (c) => {
      const rel = c.req.path === '/' ? 'index.html' : c.req.path.slice(1)
      const archivo = rel.includes('.') ? servirArchivo(c, config.web, rel, rel.startsWith('assets/') ? undefined : 'no-cache') : null
      if (archivo) return archivo
      // Lo que no existe de la web compilada da 404, como en Vercel (no index.html con 200).
      if (/^(assets|pwa|marca)\//.test(rel)) return c.text('No encontrado', 404)
      if (!existsSync(path.join(config.web, 'index.html')))
        return c.html(
          '<!doctype html><meta charset="utf-8"><title>Tablero</title><body style="font:16px system-ui;padding:40px;background:#f4efe6;color:#2b2620"><h1>Tablero</h1><p>Falta compilar la web: corré <code>npm run build</code> (o usá <code>npm run dev</code>).</p>',
          503,
        )
      return servirArchivo(c, config.web, 'index.html', 'no-cache')!
    })
  }

  return app
}
