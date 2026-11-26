// OAuth de Telar: el lado del recurso (/mcp). Valida el token de acceso de cada pedido y arma el desafío 401 que le enseña
// al cliente dónde está el servidor de autorización.
// Cuentas (docs/cuentas.md): el `sub` del token es la cuenta que tocó «Permitir» (una cuenta de Telar, «t:<id>», o una del
// juego de TABLERO_USUARIOS, que es 'dueno'). /mcp corre las herramientas con el alcance de ESA cuenta, y solo mientras siga
// existiendo y activa.
import type { Context } from 'hono'
import { cuentaDeUsuario } from '../cuentas'
import type { Conexion } from '../datos/conexion'
import { usuariosPermitidos } from '../sesion'
import { emisor, oauthActivo, recursoMcp, SCOPE_BASE } from './config'
import { leerJwt } from './firmas'

export interface AccesoOAuth {
  usuario: string
  /** La cuenta con la que corren las herramientas. */
  cuenta: string
  clienteId: string
  /** El nombre del cliente («ChatGPT», «Claude»…), para firmar lo que hace. */
  nombreCliente: string
}

/** El acceso de un token válido para ESTE recurso (firma, vencimiento, emisor, audiencia y cuenta activa), o null. */
export async function validarAcceso(c: Context, token: string, db: Conexion): Promise<AccesoOAuth | null> {
  if (!oauthActivo() || !token) return null
  const carga = leerJwt(token, 'acceso')
  if (!carga) return null
  if (carga.iss !== emisor(c) || carga.aud !== recursoMcp(c)) return null
  const usuario = String(carga.sub ?? '')
  const cuenta = usuario ? await cuentaDeUsuario(db, usuario, usuariosPermitidos()) : null
  if (!cuenta) return null
  return { usuario, cuenta: cuenta.cuenta, clienteId: String(carga.cid ?? ''), nombreCliente: String(carga.cn ?? '') }
}

/** El valor de WWW-Authenticate del 401: con él ChatGPT y Claude descubren los metadatos. */
export function cabeceraDesafio(c: Context, tokenMalo: boolean): string {
  const partes = [`resource_metadata="${emisor(c)}/.well-known/oauth-protected-resource"`, `scope="${SCOPE_BASE}"`]
  if (tokenMalo) partes.push('error="invalid_token"')
  return `Bearer ${partes.join(', ')}`
}
