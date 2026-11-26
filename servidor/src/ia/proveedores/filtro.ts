// El filtro de claves: todo texto que salga de un adaptador (errores, registros, mensajes) pasa por acá (docs/plan-ia-integrada.md,
// 4.4 y 6.11). Saca la clave que se usó en el pedido y cualquier cosa con forma de clave de proveedor. El contenido del
// pedido no se filtra: simplemente no se copia a ningún error ni registro.

/** Las formas conocidas: Anthropic (sk-ant-…), OpenAI y compatibles (sk-…, sk-proj-…), Google (AIza…), GitHub (ghp_…, github_pat_…). */
const FORMAS_DE_CLAVE = [/sk-ant-[\w-]{6,}/gi, /sk-(?:proj-)?[\w-]{16,}/gi, /AIza[\w-]{20,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_\w{20,}/g]

/** Cambia cada aparición de las claves dadas, y de lo que parezca una clave, por «[clave]». */
export function filtrarClaves(texto: string, ...claves: (string | undefined | null)[]): string {
  let t = texto
  for (const c of claves) if (c && c.length >= 6) t = t.split(c).join('[clave]')
  for (const f of FORMAS_DE_CLAVE) t = t.replace(f, '[clave]')
  return t
}
