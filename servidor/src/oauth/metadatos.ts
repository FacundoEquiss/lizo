// OAuth de Telar: los metadatos que buscan los clientes (RFC 9728 y RFC 8414). Es lo primero que lee ChatGPT: sin
// `S256` en code_challenge_methods_supported no se conecta.
import type { Context } from 'hono'
import { emisor, recursoMcp, SCOPES } from './config'

/** /.well-known/oauth-protected-resource: el MCP y quién lo autoriza. */
export function metadatosRecurso(c: Context) {
  return {
    resource: recursoMcp(c),
    authorization_servers: [emisor(c)],
    scopes_supported: ['telar'],
    bearer_methods_supported: ['header'],
    resource_name: 'Telar',
  }
}

/** /.well-known/oauth-authorization-server (y openid-configuration): dónde pedir, canjear y registrarse. */
export function metadatosServidor(c: Context) {
  const base = emisor(c)
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/autorizar`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/registrar`,
    revocation_endpoint: `${base}/oauth/revocar`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [...SCOPES],
  }
}
