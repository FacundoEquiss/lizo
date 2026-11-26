# Telar

Lienzo infinito + Kanban con el **porqué** de cada tarjeta, manejable por IA vía MCP. Es del dueño (Facundo), para ordenar
todos sus proyectos; el primero es Restaurant City (repo `<usuario>/<repo-del-juego>`). Todo en castellano rioplatense.

## Reglas del dueño
- El dueño no es programador: respuestas cortas y concretas, un tema por vez. Nunca pedirle que corra comandos ni que pegue claves en el chat.
- Las decisiones de producto de Telar las toma Claude; se consulta solo lo que gasta plata o toca algo de otro proyecto.
- Gastos (Supabase, Vercel u otro): preguntar antes, con cotización corta.

## Dónde vive
- **Web y servidor:** proyecto `telar` de Vercel → https://telarapp.vercel.app. Se publica con
  `npm run build:vercel` y `npx vercel deploy --prebuilt --prod` (token de Vercel del entorno). No depende de GitHub.
- **Base:** desde el 26/11/2026, un proyecto de Supabase **propio de Telar**, «Lizo» (`<ID-DEL-PROYECTO-SUPABASE-DE-TELAR>`, organización «Facundo Aranda»,
  plan Free, São Paulo), con el esquema `tablero` y el usuario `tablero_app` (dueño del esquema). La app lo toma de `TABLERO_DB_URL_NUEVA`
  (manda sobre `TABLERO_DB_URL`) y verifica el certificado TLS. **El esquema `tablero` viejo, en el proyecto del juego (`<ID-DEL-PROYECTO-SUPABASE>`),
  queda intacto como respaldo hasta 30 días después de la migración: no se toca ni se borra sin el sí del dueño. Nunca tocar otros esquemas ni
  perjudicar al juego** (dueño, 24/11). Las migraciones de `supabase/migrations` se aplican a mano con `tablero_app` como dueño (ver README, "Online").
- **Entrar:** con una cuenta de Telar (mail, nombre y contraseña propios: «Crear cuenta» está siempre a la vista y la cuenta queda **pendiente**
  hasta que el dueño la aprueba en Configuración → Amigos → Solicitudes; con un enlace de invitación que el dueño genera ahí entra aprobada al
  instante; no hace falta cargar variables ni publicar, y el código de `TABLERO_INVITACION` sigue andando si existe)
  o con la cuenta del juego del dueño (Supabase Auth; solo `TABLERO_USUARIOS`). **Cada cuenta tiene su base propia**: la
  del juego y la clave del MCP son la cuenta `dueno`, con todo lo de antes. **Sin servicio de mail**, un amigo que olvida la contraseña
  la recupera con sus códigos de recuperación (los ve una sola vez al crear la cuenta) o con el enlace de un solo uso que el dueño le genera en
  Configuración → Amigos (el dueño nunca ve ni elige esa contraseña). Ver `docs/cuentas.md`.
- **Regla de código:** cada método del Servicio corre con el alcance de una cuenta (`servicio.de(cuenta)`) y verifica cada
  id que recibe (`propio`/`propios` o un resolutor filtrado); lo ajeno da 404. Si tocás el servicio, una ruta o una
  herramienta MCP, corré `npm run cuentas:probar` (y sumale el caso a una ruta nueva: si no, la prueba falla).
- **Claves:** solo en las variables de Vercel (`TABLERO_*` y `CRON_SECRET`). Nunca en el repo ni en el chat.
- **MCP para Claude Code:** `.mcp.json` → https://telarapp.vercel.app/mcp. La clave la guardó el dueño en el entorno de
  Claude Code (credencial del host telarapp.vercel.app) y la pone el proxy: no va en ningún archivo.
- **ChatGPT y claude.ai (chat):** por OAuth 2.1 (Telar es su propio servidor de autorización; el dueño toca «Permitir»). La
  clave de Claude Code sigue andando igual. Detalle en `docs/conectar-chatgpt.md`.

## Cómo está hecho
React + TypeScript + Vite (web), Hono (servidor), Postgres/PGlite (base), SDK oficial de MCP. Detalle en `README.md`
y la investigación en `docs/investigacion.md`.

## Cómo se trabaja
Las reglas duras, cómo correr y probar, el flujo y la publicación están en **`AGENTS.md`** (la entrada común para
cualquier agente: Claude, Codex, OpenCode…). El criterio largo de diseño, movimiento, código y entregas, en
`docs/criterio/`. Si algo de acá y de `AGENTS.md` no coincide, se corrigen los dos: no puede haber dos verdades.
