// OAuth de Telar: el paso de «autorizar».
//   1. GET /oauth/autorizar (lo abre el conector): valida todo y manda a la pantalla «Permitir» de la web (/autorizar?pedido=…)
//      con un pedido firmado de 10 minutos. Nunca se muestra ni se redirige a una redirect_uri sin validar.
//   2. La web llama a /api/oauth/pedido (qué se está pidiendo) y /api/oauth/decidir (Permitir o No) con la cookie del dueño.
//   3. `decidir` crea el código de un solo uso y devuelve la dirección a la que vuelve el navegador (code, state, iss).
import type { Context } from 'hono'
import type { AlmacenOAuth } from './almacen'
import { ErrorOAuth, resolverCliente } from './clientes'
import { emisor, recursoMcp, scopeDe, sitioDe, VIDA_PEDIDO_S } from './config'
import { ahoraS, alAzar, firmarJwt, leerJwt, sha256 } from './firmas'

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Cuando el cliente o la redirección no valen no se redirige a ningún lado: se explica en una página. */
export function paginaError(mensaje: string): Response {
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telar</title><body style="font:16px system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 24px;color:#2b2620;background:#f4efe6">
<h1 style="font-size:22px">No se pudo conectar</h1><p>${escapar(mensaje)}</p><p style="color:#6b6258;font-size:14px">Volvé a la aplicación y probá de nuevo.</p></body></html>`
  return new Response(html, {
    status: 400,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' },
  })
}

function volver(c: Context, uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v)
  u.searchParams.set('iss', emisor(c))
  return u.toString()
}

interface Pedido {
  cid: string
  ru: string
  ch: string
  rec: string
  sc: string
  st?: string
}

export async function iniciarAutorizacion(c: Context, almacen: AlmacenOAuth): Promise<Response> {
  const q = (k: string) => c.req.query(k) ?? ''
  let cliente
  try {
    cliente = await resolverCliente(almacen, q('client_id'))
  } catch (e) {
    return paginaError(e instanceof ErrorOAuth ? e.message : 'No pude validar la aplicación.')
  }
  const uris = cliente.redirect_uris
  const redirect = q('redirect_uri') || (uris.length === 1 ? uris[0]! : '')
  if (!redirect || !uris.includes(redirect)) return paginaError('La dirección de vuelta de la aplicación no es la que registró.')

  const estado = q('state') || undefined
  const error = (codigo: string, descripcion: string) =>
    c.redirect(volver(c, redirect, { error: codigo, error_description: descripcion, state: estado }), 302)

  if (q('response_type') !== 'code') return error('unsupported_response_type', 'Telar solo entrega códigos (response_type=code).')
  const desafio = q('code_challenge')
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(desafio) || q('code_challenge_method') !== 'S256')
    return error('invalid_request', 'Hace falta PKCE con code_challenge_method=S256.')
  const recurso = recursoMcp(c)
  if (q('resource') && q('resource') !== recurso && q('resource') !== `${recurso}/`)
    return error('invalid_target', `El recurso tiene que ser ${recurso}.`)

  const ahora = ahoraS()
  const pedido = firmarJwt({
    t: 'pedido',
    iat: ahora,
    exp: ahora + VIDA_PEDIDO_S,
    cid: cliente.id,
    ru: redirect,
    ch: desafio,
    rec: recurso,
    sc: scopeDe(q('scope')),
    ...(estado ? { st: estado.slice(0, 500) } : {}),
  })
  return c.redirect(`/autorizar?pedido=${encodeURIComponent(pedido)}`, 302)
}

function leerPedido(token: string): Pedido & { exp: number } {
  const p = leerJwt(token, 'pedido') as unknown as (Pedido & { exp: number }) | null
  if (!p) throw new ErrorOAuth('invalid_request', 'Este pedido venció. Volvé a la aplicación y probá de nuevo.')
  return p
}

/** Lo que muestra la pantalla «Permitir». */
export async function describirPedido(almacen: AlmacenOAuth, token: string) {
  const p = leerPedido(token)
  const cliente = await almacen.leerCliente(p.cid)
  if (!cliente) throw new ErrorOAuth('invalid_client', 'No conozco esa aplicación.')
  return { cliente: cliente.nombre, sitio: sitioDe(p.ru), vence: p.exp }
}

/** El dueño tocó Permitir o No permitir: devuelve la dirección a la que vuelve el navegador. */
export async function decidir(c: Context, almacen: AlmacenOAuth, usuario: string, token: string, permitir: boolean) {
  const p = leerPedido(token)
  const cliente = await almacen.leerCliente(p.cid)
  if (!cliente || !cliente.redirect_uris.includes(p.ru)) throw new ErrorOAuth('invalid_client', 'No conozco esa aplicación.')
  if (!permitir) return { redirigir: volver(c, p.ru, { error: 'access_denied', error_description: 'El dueño no permitió la conexión.', state: p.st }) }
  const codigo = alAzar(32)
  await almacen.crearCodigo({
    codigo_hash: sha256(codigo),
    cliente_id: p.cid,
    usuario,
    redirect_uri: p.ru,
    desafio: p.ch,
    recurso: p.rec,
    scope: p.sc,
    familia: alAzar(12),
  })
  return { redirigir: volver(c, p.ru, { code: codigo, state: p.st }) }
}
