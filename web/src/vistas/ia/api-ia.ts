// Los pedidos de Configuración → IA y de la lista de trabajos de una tarjeta (plan 13.7 y 16.4). Van aparte de `estado/api.ts` porque
// esa se baja con el arranque y esto solo hace falta cuando se abre Configuración → IA o una tarjeta con la respuesta de un agente.
// Lo que cambia algo pide sesión: con la clave del MCP el servidor contesta 403 «Esto se cambia desde Configuración, con tu cuenta.»; los
// errores vuelven siempre como `ErrorApi` con el texto del servidor en castellano. La clave de un proveedor nunca vuelve en una respuesta.
import type { AjustesIA, Agente, ClaveIA, EntradaAgente, EntradaClave, EstadoIA, TrabajoResumen, UsoIA } from '../../../../compartido/ia'
import { pedir } from '../../estado/api'

const e = encodeURIComponent

export const apiIA = {
  estado: () => pedir<EstadoIA>('GET', '/api/ia/estado'),
  uso: (mes?: string) => pedir<UsoIA>('GET', `/api/ia/uso${mes ? `?mes=${e(mes)}` : ''}`),
  /** Sin `id` crea; con `id` cambia (sin `clave`, solo el nombre o la dirección). La clave se prueba antes de guardarse. */
  guardarClave: (c: EntradaClave) =>
    c.id
      ? pedir<ClaveIA>('PUT', `/api/ia/claves/${e(c.id)}`, { nombre: c.nombre, clave: c.clave, urlBase: c.urlBase })
      : pedir<ClaveIA>('POST', '/api/ia/claves', c),
  probarClave: (id: string) => pedir<ClaveIA>('POST', `/api/ia/claves/${e(id)}/probar`, {}),
  quitarClave: (id: string) => pedir<{ ok: true }>('DELETE', `/api/ia/claves/${e(id)}`),
  /** Con `miembroId` cambia el agente; sin él, lo crea. Lo que no se manda queda como estaba. */
  guardarAgente: (a: Partial<EntradaAgente>) =>
    a.miembroId ? pedir<Agente>('PUT', `/api/ia/agentes/${e(a.miembroId)}`, a) : pedir<Agente>('POST', '/api/ia/agentes', a),
  archivarAgente: (id: string) => pedir<{ ok: true }>('DELETE', `/api/ia/agentes/${e(id)}`),
  guardarAjustes: (a: Partial<Pick<AjustesIA, 'topeMesUsd' | 'pausada' | 'confirmarMcp' | 'externasDisparan' | 'reposCodigo'>>) =>
    pedir<AjustesIA>('PUT', '/api/ia/ajustes', a),
  /** Los trabajos de una tarjeta (para el pie de lo que hizo cada agente), de una charla o los vivos. */
  trabajos: (f: { tarjeta?: string; hilo?: string; vivos?: boolean; limite?: number } = {}) => {
    const qs = new URLSearchParams()
    if (f.tarjeta) qs.set('tarjeta', f.tarjeta)
    if (f.hilo) qs.set('hilo', f.hilo)
    if (f.vivos) qs.set('vivos', '1')
    if (f.limite) qs.set('limite', String(f.limite))
    const q = qs.toString()
    return pedir<TrabajoResumen[]>('GET', `/api/ia/trabajos${q ? `?${q}` : ''}`)
  },
}
