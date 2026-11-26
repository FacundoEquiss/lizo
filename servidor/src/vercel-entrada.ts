// Función de Vercel (Build Output API, ver scripts/vercel.mjs): recibe los pedidos de /api, /mcp y /archivos.
import { getRequestListener } from '@hono/node-server'
import { crearAppOnline } from './vercel'

export default getRequestListener(crearAppOnline().fetch)
