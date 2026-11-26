// Función de render de Vercel (render.func, ver scripts/vercel.mjs): la misma app online, pero este proceso sí abre un
// navegador — el Chromium empaquetado para funciones (@sparticuz/chromium) con playwright-core. Le llegan:
//   · /api/diseno/<p>/marcos/<id>/render      (exportar desde la web: la sesión de siempre)
//   · /api/diseno/<p>/render-interno y /api/diseno/_/grilla-interna   (la función principal, con la clave del MCP)
// Así la función principal no lleva Chromium: no engorda ni tarda más en arrancar.
import { getRequestListener } from '@hono/node-server'
import { crearAppOnline } from '../vercel'
import { configurarRender } from './render'

configurarRender({ chromium: 'empaquetado' })

export default getRequestListener(crearAppOnline().fetch)
