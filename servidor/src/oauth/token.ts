// OAuth de Telar: POST /oauth/token (canjear el código y refrescar) y POST /oauth/revocar.
// Acepta application/x-www-form-urlencoded (lo exigen ChatGPT y Claude) y también JSON. Los errores son los del estándar,
// con la explicación en castellano en `error_description`.
import type { Context } from 'hono'
import { cuentaDeUsuario } from '../cuentas'
import { usuariosPermitidos } from '../sesion'
import type { AlmacenOAuth } from './almacen'
import { ErrorOAuth, resolverCliente } from './clientes'
import { emisor, VIDA_ACCESO_S } from './config'
import { ahoraS, alAzar, firmarJwt, iguales, sha256, sha256Base64Url } from './firmas'

type Params = Record<string, string>

async function leerParams(c: Context): Promise<Params> {
  const tipo = c.req.header('content-type') ?? ''
  const crudo: Record<string, unknown> = tipo.includes('application/json')
    ? await c.req.json().catch(() => ({}))
    : ((await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>)
  const p: Params = {}
  for (const [k, v] of Object.entries(crudo)) if (typeof v === 'string') p[k] = v
  return p
}

const mismoRecurso = (pedido: string | undefined, guardado: string) =>
  !pedido || pedido === guardado || pedido === `${guardado}/`

async function emitir(
  c: Context,
  almacen: AlmacenOAuth,
  d: { usuario: string; clienteId: string; recurso: string; scope: string; familia: string },
) {
  const cliente = await almacen.leerCliente(d.clienteId)
  const ahora = ahoraS()
  const acceso = firmarJwt({
    t: 'acceso',
    iss: emisor(c),
    aud: d.recurso,
    sub: d.usuario,
    iat: ahora,
    exp: ahora + VIDA_ACCESO_S,
    cid: d.clienteId,
    cn: cliente?.nombre ?? '',
    scope: d.scope,
    jti: alAzar(12),
  })
  const refresco = alAzar(40)
  await almacen.crearRefresco({
    token_hash: sha256(refresco),
    familia: d.familia,
    cliente_id: d.clienteId,
    usuario: d.usuario,
    recurso: d.recurso,
    scope: d.scope,
  })
  await almacen.tocarCliente(d.clienteId)
  return { access_token: acceso, token_type: 'Bearer', expires_in: VIDA_ACCESO_S, refresh_token: refresco, scope: d.scope }
}

export async function emitirToken(c: Context, almacen: AlmacenOAuth): Promise<Response> {
  const sinCache = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }
  try {
    const p = await leerParams(c)
    if (Math.random() < 0.02) await almacen.limpiar().catch(() => {})
    const cliente = await resolverCliente(almacen, p.client_id ?? '')

    if (p.grant_type === 'authorization_code') {
      if (!p.code || !p.code_verifier) throw new ErrorOAuth('invalid_request', 'Faltan el código o el code_verifier.')
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier)) throw new ErrorOAuth('invalid_grant', 'El code_verifier no es válido.')
      const r = await almacen.canjearCodigo(sha256(p.code))
      if (!r) throw new ErrorOAuth('invalid_grant', 'El código no es válido o ya venció. Volvé a conectar.')
      if ('reusado' in r) {
        await almacen.revocarFamilia(r.reusado) // alguien usó dos veces el mismo código: se corta lo que salió de ahí
        throw new ErrorOAuth('invalid_grant', 'Ese código ya se usó. Volvé a conectar.')
      }
      const cod = r.codigo
      if (cod.cliente_id !== cliente.id) throw new ErrorOAuth('invalid_grant', 'El código es de otra aplicación.')
      if ((p.redirect_uri ?? '') !== cod.redirect_uri) throw new ErrorOAuth('invalid_grant', 'La dirección de vuelta no coincide con la del pedido.')
      if (!mismoRecurso(p.resource, cod.recurso)) throw new ErrorOAuth('invalid_target', `El recurso tiene que ser ${cod.recurso}.`)
      if (!iguales(sha256Base64Url(p.code_verifier), cod.desafio)) throw new ErrorOAuth('invalid_grant', 'El code_verifier no coincide (PKCE).')
      if (!(await cuentaDeUsuario(almacen.db, cod.usuario, usuariosPermitidos())))
        throw new ErrorOAuth('invalid_grant', 'Esta cuenta ya no tiene acceso a Telar.')
      const t = await emitir(c, almacen, { usuario: cod.usuario, clienteId: cliente.id, recurso: cod.recurso, scope: cod.scope, familia: cod.familia })
      return c.json(t, 200, sinCache)
    }

    if (p.grant_type === 'refresh_token') {
      if (!p.refresh_token) throw new ErrorOAuth('invalid_request', 'Falta el refresh_token.')
      const r = await almacen.rotarRefresco(sha256(p.refresh_token))
      if (!r) throw new ErrorOAuth('invalid_grant', 'La conexión venció o se cortó. Volvé a conectar.')
      if (r.cliente_id !== cliente.id) throw new ErrorOAuth('invalid_grant', 'El token es de otra aplicación.')
      if (!mismoRecurso(p.resource, r.recurso)) throw new ErrorOAuth('invalid_target', `El recurso tiene que ser ${r.recurso}.`)
      if (!(await cuentaDeUsuario(almacen.db, r.usuario, usuariosPermitidos())))
        throw new ErrorOAuth('invalid_grant', 'Esta cuenta ya no tiene acceso a Telar.')
      const t = await emitir(c, almacen, { usuario: r.usuario, clienteId: r.cliente_id, recurso: r.recurso, scope: r.scope, familia: r.familia })
      return c.json(t, 200, sinCache)
    }

    throw new ErrorOAuth('unsupported_grant_type', 'Telar acepta authorization_code y refresh_token.')
  } catch (e) {
    if (e instanceof ErrorOAuth)
      return c.json({ error: e.codigo, error_description: e.message }, e.estado as 400, sinCache)
    throw e
  }
}

/** RFC 7009: revocar. Siempre contesta 200 (no se cuenta si el token existía). */
export async function revocarToken(c: Context, almacen: AlmacenOAuth): Promise<Response> {
  const p = await leerParams(c)
  if (p.token) await almacen.revocarPorRefresco(sha256(p.token)).catch(() => {})
  return c.body(null, 200, { 'Cache-Control': 'no-store' })
}
