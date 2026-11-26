// OAuth de Telar: registro y búsqueda de clientes.
//   · DCR (RFC 7591): POST /oauth/registrar. Abierto, así que las redirecciones solo pueden ser de la lista de config.ts.
//   · CIMD (client ID metadata document): el `client_id` es una URL https que apunta a un JSON con los datos del cliente
//     (ChatGPT usa https://chatgpt.com/oauth/client.json). Se baja con tiempo límite, tope de tamaño y sin redirecciones.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { alAzar } from './firmas'
import type { AlmacenOAuth, ClienteOAuth } from './almacen'
import { MAX_CLIENTES, redireccionPermitida } from './config'

export class ErrorOAuth extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly estado = 400,
  ) {
    super(mensaje)
  }
}

const TOPE_DOCUMENTO = 64 * 1024
const REFRESCO_CIMD_MS = 24 * 3600 * 1000

function textoCorto(v: unknown, tope: number): string {
  return typeof v === 'string' ? v.trim().slice(0, tope) : ''
}

function listaDeRedirecciones(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 10) throw new ErrorOAuth('invalid_redirect_uri', 'Faltan las direcciones de vuelta (redirect_uris).')
  const uris = v.map((u) => (typeof u === 'string' ? u.trim() : ''))
  for (const u of uris) {
    if (!u || u.length > 500 || !redireccionPermitida(u))
      throw new ErrorOAuth('invalid_redirect_uri', `Esa dirección de vuelta no está permitida: ${u.slice(0, 80) || '(vacía)'}.`)
  }
  return [...new Set(uris)]
}

/** DCR: POST /oauth/registrar. Devuelve lo que pide el RFC 7591 (sin secreto: son clientes públicos con PKCE). */
export async function registrarCliente(almacen: AlmacenOAuth, cuerpo: unknown) {
  const d = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, unknown>
  const metodo = textoCorto(d.token_endpoint_auth_method, 40) || 'none'
  if (metodo !== 'none') throw new ErrorOAuth('invalid_client_metadata', 'Telar solo registra clientes públicos (token_endpoint_auth_method: none).')
  const redirect_uris = listaDeRedirecciones(d.redirect_uris)
  const nombre = textoCorto(d.client_name, 80) || 'Aplicación sin nombre'
  if ((await almacen.contarClientes()) >= MAX_CLIENTES) {
    await almacen.podarClientes()
    if ((await almacen.contarClientes()) >= MAX_CLIENTES)
      throw new ErrorOAuth('temporarily_unavailable', 'Hay demasiadas aplicaciones registradas. Probá más tarde.', 503)
  }
  const id = `cli_${alAzar(18)}`
  await almacen.guardarCliente({ id, nombre, redirect_uris, origen: 'dcr', metadatos: {} })
  return {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: nombre,
    redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'telar',
  }
}

// ───── CIMD ─────

const privada = (ip: string) => {
  if (ip === '::1' || ip === '::' || /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip)) return true
  const mapeada = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  const v4 = mapeada ? mapeada[1]! : ip
  const p = v4.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false
  const [a, b] = p as [number, number, number, number]
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

async function descargarDocumento(url: string): Promise<Record<string, unknown>> {
  const u = new URL(url)
  if (u.protocol !== 'https:' || u.port || u.username || u.password || isIP(u.hostname) || u.hostname === 'localhost' || !u.hostname.includes('.'))
    throw new ErrorOAuth('invalid_client', 'El client_id tiene que ser una dirección https pública.')
  // No bajar de direcciones internas (la función de Vercel no tiene nada ahí, pero no se confía en eso).
  const direcciones = await lookup(u.hostname, { all: true }).catch(() => [])
  if (!direcciones.length || direcciones.some((d) => privada(d.address)))
    throw new ErrorOAuth('invalid_client', 'No pude leer los datos de la aplicación (dirección no válida).')
  let r: Response
  try {
    r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } })
  } catch {
    throw new ErrorOAuth('invalid_client', 'No pude leer los datos de la aplicación (no contestó a tiempo).')
  }
  if (!r.ok) throw new ErrorOAuth('invalid_client', `No pude leer los datos de la aplicación (respondió ${r.status}).`)
  const lector = r.body?.getReader()
  if (!lector) throw new ErrorOAuth('invalid_client', 'Los datos de la aplicación vinieron vacíos.')
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    total += value.byteLength
    if (total > TOPE_DOCUMENTO) {
      await lector.cancel().catch(() => {})
      throw new ErrorOAuth('invalid_client', 'Los datos de la aplicación pesan demasiado.')
    }
    partes.push(value)
  }
  try {
    const json = JSON.parse(Buffer.concat(partes).toString('utf8')) as unknown
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('no es un objeto')
    return json as Record<string, unknown>
  } catch {
    throw new ErrorOAuth('invalid_client', 'Los datos de la aplicación no son un JSON válido.')
  }
}

/** El cliente de un `client_id`: de la base, o (si es una URL https) bajado y guardado como CIMD. */
export async function resolverCliente(almacen: AlmacenOAuth, clientId: string): Promise<ClienteOAuth> {
  if (!clientId || clientId.length > 500) throw new ErrorOAuth('invalid_client', 'Falta el client_id.', 401)
  const guardado = await almacen.leerCliente(clientId)
  const esUrl = /^https:\/\//i.test(clientId)
  const verificado = Number((guardado?.metadatos as { verificado?: number } | undefined)?.verificado) || 0
  if (guardado && (!esUrl || Date.now() - verificado < REFRESCO_CIMD_MS)) return guardado
  if (!esUrl) throw new ErrorOAuth('invalid_client', 'No conozco esa aplicación (client_id).', 401)

  let doc: Record<string, unknown>
  try {
    doc = await descargarDocumento(clientId)
  } catch (e) {
    if (guardado) return guardado // si no se pudo refrescar, vale lo que ya teníamos
    throw e
  }
  if (doc.client_id !== clientId) throw new ErrorOAuth('invalid_client', 'El client_id del documento no coincide con su dirección.', 401)
  const redirect_uris = listaDeRedirecciones(doc.redirect_uris)
  const nombre = textoCorto(doc.client_name, 80) || new URL(clientId).hostname
  await almacen.guardarCliente({ id: clientId, nombre, redirect_uris, origen: 'cimd', metadatos: { verificado: Date.now() } })
  await almacen.tocarCliente(clientId)
  return (await almacen.leerCliente(clientId))!
}
