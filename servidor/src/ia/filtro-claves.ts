// El filtro de claves de la IA integrada (plan 10.2, 12.11): tapa todo lo que tenga forma de clave o de token antes de que un
// texto llegue a una respuesta, un evento, un registro o el modelo. Lo usan la bóveda, el cliente de GitHub (el código es dato:
// puede traer secretos escritos por error) y cualquiera que arme un mensaje de error a partir de lo que dijo un servidor de afuera.
// Sin base de datos, sin red.

export const TAPADO = '[tapado]'

/** Formas conocidas de claves y tokens. Cada una se tapa entera. */
const FORMAS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI y compatibles (sk-proj-…)
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub, fine-grained
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub, clásicos y de aplicación
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\btab_[A-Za-z0-9_-]{20,}/g, // la clave del MCP de Telar
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, // claves privadas (aunque estén cortadas)
]

/** `Authorization: Bearer xxxx` y `Bearer xxxx`: se conserva la palabra y se tapa el valor. */
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi
/** `password = "xxxx"`, `api_key: 'xxxx'`: se conserva el nombre y se tapa el valor entre comillas. */
const ASIGNADA_ENTRE_COMILLAS =
  /((?:password|passwd|pwd|secret|token|api[_-]?key|apikey|auth[_-]?token|access[_-]?key|private[_-]?key|clave|contrasena|contraseña)[A-Za-z0-9_-]*["']?\s*[:=]\s*)(["'`])(?!\[tapado\]\2)([^"'`\n]{8,})\2/gi
/** Estilo `.env`: `API_KEY=xxxxxxxx` al principio de línea. */
const ASIGNADA_ENV = /^([ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*[ \t]*=[ \t]*)(?!["'`]|\[tapado\])(\S{8,})/gm

export interface Tapado {
  texto: string
  /** Cuántos valores se taparon. */
  tapados: number
}

/** Tapa lo que parece una clave. `conocidas`: textos exactos que hay que sacar (por ejemplo, la clave con la que se hizo el pedido). */
export function taparClavesContando(texto: string, conocidas: readonly string[] = []): Tapado {
  let tapados = 0
  let t = String(texto ?? '')
  for (const c of conocidas) {
    if (c && c.length >= 6 && t.includes(c)) {
      const partes = t.split(c)
      tapados += partes.length - 1
      t = partes.join(TAPADO)
    }
  }
  for (const f of FORMAS) t = t.replace(f, () => (tapados++, TAPADO))
  t = t.replace(BEARER, (_m, p: string) => (tapados++, `${p}${TAPADO}`))
  t = t.replace(ASIGNADA_ENTRE_COMILLAS, (_m, p: string, q: string) => (tapados++, `${p}${q}${TAPADO}${q}`))
  t = t.replace(ASIGNADA_ENV, (_m, p: string) => (tapados++, `${p}${TAPADO}`))
  return { texto: t, tapados }
}

/** Lo mismo, solo el texto. */
export const taparClaves = (texto: string, conocidas: readonly string[] = []): string => taparClavesContando(texto, conocidas).texto

/** ¿Parece una clave entera (una sola «palabra» larga con letras y números)? Para no dejar pasar un token suelto. */
export const pareceClave = (texto: string): boolean => taparClavesContando(texto).tapados > 0
