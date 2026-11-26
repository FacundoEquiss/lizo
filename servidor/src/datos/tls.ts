// TLS hacia la base: se VERIFICA el certificado (con la raíz pública de Supabase), así un intermediario no puede leer ni cambiar
// el tráfico. Cambios posibles con variables (todas opcionales):
//   TABLERO_DB_CA=<PEM>            suma otra raíz de confianza (otra base, o si Supabase cambia la suya)
//   TABLERO_DB_TLS=sin-verificar   vuelve al comportamiento viejo (cifra pero no verifica)
//   (sin variable)                 si el certificado no verifica, NO conecta: no hay plan B automático (un intermediario lo aprovecharía)
// En la URL, `?sslmode=disable` (Postgres local sin TLS) y `?sslmode=no-verify` se respetan.
import type { ConnectionOptions } from 'node:tls'
import { SUPABASE_RAIZ_2021 } from './supabase-ca'

export type ModoTls = 'sin-tls' | 'verificado' | 'sin-verificar'
export type TlsDeLaUrl = { url: string; ssl: false | ConnectionOptions; modo: ModoTls }

// Códigos con los que Node avisa que el certificado no se pudo verificar (no confundir con "la base no contesta").
const ERRORES_DE_CERTIFICADO = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

export function esErrorDeCertificado(e: unknown) {
  const c = (e as { code?: string } | null)?.code
  return !!c && ERRORES_DE_CERTIFICADO.has(c)
}

/** Saca de la URL los parámetros de TLS (si no, `pg` los usa y pisa lo que decidimos acá) y devuelve las opciones de TLS. */
export function tlsDeLaUrl(urlOriginal: string, env: Record<string, string | undefined> = process.env): TlsDeLaUrl {
  const modoUrl = /[?&]sslmode=([a-z-]+)/i.exec(urlOriginal)?.[1]?.toLowerCase()
  const url = urlOriginal.replace(/([?&])(sslmode|uselibpqcompat|sslrootcert)=[^&]*(&|$)/gi, (_m, a, _k, z) => (z === '&' ? a : '')).replace(/[?&]$/, '')
  if (modoUrl === 'disable') return { url, ssl: false, modo: 'sin-tls' }
  if (modoUrl === 'no-verify' || env.TABLERO_DB_TLS === 'sin-verificar') {
    return { url, ssl: { rejectUnauthorized: false }, modo: 'sin-verificar' }
  }
  const ca = [SUPABASE_RAIZ_2021, ...(env.TABLERO_DB_CA ? [env.TABLERO_DB_CA.replace(/\\n/g, '\n')] : [])]
  return { url, ssl: { ca, rejectUnauthorized: true }, modo: 'verificado' }
}
