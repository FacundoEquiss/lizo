// OAuth de Telar: las rutas. Todas dan 404 si el OAuth no está prendido (local, o sin secreto).
//   Públicas (api.ts las monta en la raíz):   /.well-known/*, /oauth/registrar, /oauth/autorizar, /oauth/token, /oauth/revocar
//   Con una sesión (bajo /api):              /api/oauth/pedido, /api/oauth/decidir, /api/oauth/conexiones
// Cuentas (docs/cuentas.md): «Permitir» ata el código (y después el token y el refresco) a la cuenta de la sesión, y
// «Conexiones» lista y corta solo las de esa cuenta. La clave del MCP no alcanza: hace falta haber entrado.
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { Conexion } from '../datos/conexion'
import { AlmacenOAuth } from './almacen'
import { decidir, describirPedido, iniciarAutorizacion } from './autorizar'
import { ErrorOAuth, registrarCliente } from './clientes'
import { oauthActivo } from './config'
import { metadatosRecurso, metadatosServidor } from './metadatos'
import { emitirToken, revocarToken } from './token'

export interface DepsOAuth {
  /** La base (estas tablas no son de ninguna cuenta: clientes, códigos y refrescos llevan su usuario). */
  db: () => Conexion
  /** El usuario de OAuth de la sesión del pedido («t:<id>» o el de la cuenta del juego), o null sin sesión. */
  usuarioSesion?: () => string | null
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
}

/** Las rutas de /.well-known y /oauth que hablan los conectores (sin cookie). */
export function rutasOAuthPublicas(d: DepsOAuth) {
  const r = new Hono()
  const almacen = () => new AlmacenOAuth(d.db())

  // Apagado: no existe nada de esto. (El middleware va acotado a estas rutas: se monta en la raíz de la app.)
  const apagado = async (c: Context, next: () => Promise<void>) => {
    if (!oauthActivo()) return c.json({ error: 'No existe esa ruta.' }, 404)
    await next()
  }
  r.use('/.well-known/*', apagado)
  r.use('/oauth/*', apagado)
  // Los públicos y sin cookies pueden pedirse desde un navegador (MCP Inspector); el resto no.
  r.use('/.well-known/*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return c.body(null, 204, CORS)
    await next()
    for (const [k, v] of Object.entries(CORS)) c.res.headers.set(k, v)
  })
  for (const ruta of ['/oauth/registrar', '/oauth/token', '/oauth/revocar']) {
    r.use(ruta, async (c, next) => {
      if (c.req.method === 'OPTIONS') return c.body(null, 204, CORS)
      await next()
      for (const [k, v] of Object.entries(CORS)) c.res.headers.set(k, v)
    })
  }

  const cacheCorto = { 'Cache-Control': 'public, max-age=300' }
  r.get('/.well-known/oauth-protected-resource', (c) => c.json(metadatosRecurso(c), 200, cacheCorto))
  r.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json(metadatosRecurso(c), 200, cacheCorto))
  r.get('/.well-known/oauth-authorization-server', (c) => c.json(metadatosServidor(c), 200, cacheCorto))
  r.get('/.well-known/oauth-authorization-server/*', (c) => c.json(metadatosServidor(c), 200, cacheCorto))
  r.get('/.well-known/openid-configuration', (c) => c.json(metadatosServidor(c), 200, cacheCorto))

  r.post('/oauth/registrar', async (c) => {
    try {
      const cuerpo = await c.req.json().catch(() => ({}))
      return c.json(await registrarCliente(almacen(), cuerpo), 201, { 'Cache-Control': 'no-store' })
    } catch (e) {
      if (e instanceof ErrorOAuth) return c.json({ error: e.codigo, error_description: e.message }, e.estado as 400)
      throw e
    }
  })
  r.get('/oauth/autorizar', (c) => iniciarAutorizacion(c, almacen()))
  r.post('/oauth/token', (c) => emitirToken(c, almacen()))
  r.post('/oauth/revocar', (c) => revocarToken(c, almacen()))
  return r
}

/** Lo que usa la pantalla «Permitir» y «Conexiones»: pide una sesión (la clave del MCP no alcanza). */
export function rutasOAuthApi(d: DepsOAuth) {
  const r = new Hono()
  const almacen = () => new AlmacenOAuth(d.db())
  const dueno = (_c: Context) => d.usuarioSesion?.() ?? null
  const sinSesion = (c: Context) => c.json({ error: 'Entrá con tu cuenta.', entrar: true }, 401)

  r.use('*', async (c, next) => {
    if (!oauthActivo()) return c.json({ error: 'La conexión con ChatGPT y Claude no está prendida en este Telar.' }, 404)
    await next()
  })

  r.get('/pedido', async (c) => {
    if (!dueno(c)) return sinSesion(c)
    try {
      return c.json(await describirPedido(almacen(), c.req.query('pedido') ?? ''))
    } catch (e) {
      if (e instanceof ErrorOAuth) return c.json({ error: e.message }, 400)
      throw e
    }
  })

  r.post('/decidir', async (c) => {
    const usuario = dueno(c)
    if (!usuario) return sinSesion(c)
    const d = z.object({ pedido: z.string().min(10).max(4000), permitir: z.boolean() }).parse(await c.req.json())
    try {
      return c.json(await decidir(c, almacen(), usuario, d.pedido, d.permitir))
    } catch (e) {
      if (e instanceof ErrorOAuth) return c.json({ error: e.message }, 400)
      throw e
    }
  })

  r.get('/conexiones', async (c) => {
    const usuario = dueno(c)
    if (!usuario) return sinSesion(c)
    return c.json(await almacen().conexionesDe(usuario))
  })

  r.delete('/conexiones/:familia', async (c) => {
    const usuario = dueno(c)
    if (!usuario) return sinSesion(c)
    const familia = c.req.param('familia')
    if (!(await almacen().familiaEsDe(familia, usuario))) return c.json({ error: 'No encontré esa conexión.' }, 404)
    await almacen().revocarFamilia(familia)
    return c.json({ ok: true })
  })

  return r
}
