# Conectar Telar con el chat de ChatGPT

Investigado el 24/11/2026 con la documentación de OpenAI de ese día (enlaces al final).

## Estado: hecho, probado y publicado (24/11/2026)

El plan de abajo **está implementado** en `servidor/src/oauth/`, `servidor/src/api.ts`, `web/src/vistas/Autorizar.tsx` y
`ConectarIA.tsx`, con la migración `20261202090000_oauth.sql` (aplicada online) y la prueba `npm run oauth:probar` (pasa entera).
Publicado en https://telarapp.vercel.app. **ChatGPT conectado y probado por el dueño (plan Plus): lee y escribe** (leyó Restaurant
City y creó la tarjeta RC-100). Ojo: la dirección va con `https://`; con `http://` ChatGPT dice «se rechazaron algunas opciones»
(el botón «Copiar» de Conectar IA salía con http por un error, corregido). **Falta** conectar claude.ai y probar con MCP Inspector.

Diferencias con el plan, y su porqué:

- **El secreto de los tokens se deriva de `TABLERO_SECRETO`** (HMAC con `telar-oauth-v1`); `TABLERO_OAUTH_SECRETO` solo si existe.
  Así no hay que cargar una variable nueva en Vercel. Contra: rotar el secreto de la cookie también vence los tokens.
- **El emisor sale de `TABLERO_URL_PUBLICA` o del origen del pedido** (no de `urlPublica()`, que recuerda «el último origen
  visto» y no puede cambiar entre pedidos). Conviene cargar `TABLERO_URL_PUBLICA=https://telarapp.vercel.app`.
- **La pantalla «Permitir» es una vista de la web en `/autorizar`** (no HTML del servidor): `GET /oauth/autorizar` valida todo
  y redirige a `/autorizar?pedido=<pedido firmado de 10 min>`; la decisión viaja por `/api/oauth/decidir` con la cookie (el
  control de origen y el JSON hacen de protección CSRF).
- **Un token OAuth vale solo para `/mcp`**: `/api` (que devuelve la clave en `/api/info`) y `/archivos` siguen con cookie o clave.
- **Redirecciones permitidas** (DCR es abierto): `chatgpt.com`, `claude.ai`, `claude.com`, `localhost`/`127.0.0.1`, más las de
  `TABLERO_OAUTH_REDIRECCIONES`. Tope de 200 clientes registrados.
- El nombre del cliente («ChatGPT») viaja por contexto asíncrono hasta la actividad (no por un encabezado que se pueda falsificar).
- **No se usó el middleware de autorización del SDK** (no había `node_modules` para confirmarlo): el lado del recurso es propio y corto.
- En «Conectar IA» hay una pestaña «ChatGPT y Claude (chat)» con los pasos y las conexiones, con *Desconectar*.

## En corto

ChatGPT se conecta a un servidor MCP remoto como **app** («Add custom MCP server»), por HTTPS con *streaming HTTP* (o
SSE). Para autenticar acepta **OAuth, sin autenticación o mixta**: **no acepta una clave fija en un encabezado**, que es lo
que Telar tiene hoy (`Authorization: Bearer <clave>`). Por eso hoy no se puede conectar de forma segura. Falta que Telar
sea también su propio **servidor de autorización OAuth 2.1** (con PKCE y registro de clientes) y que el login sea la
cuenta del juego, como ya pasa en la web.

## Qué exige ChatGPT (y qué tiene Telar)

| Exigencia | Detalle | Telar hoy |
|---|---|---|
| Transporte | Streaming HTTP o SSE, URL pública HTTPS | **Sí**: `https://telarapp.vercel.app/mcp` (`createMcpHandler`, sin estado, eras 2025 y 2026) |
| 401 que enseña el camino | Sin token: `401` con `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"` | **No**: responde `Bearer realm="tablero"` (`servidor/src/api.ts`, ruta `/mcp`) |
| Metadatos del recurso protegido (RFC 9728) | `/.well-known/oauth-protected-resource` con `resource` (la URL canónica del MCP) y `authorization_servers` | **No** existe |
| Metadatos del servidor de autorización (RFC 8414 u OIDC) | `issuer` (igual al de `authorization_servers`), `authorization_endpoint`, `token_endpoint`, `code_challenge_methods_supported` con `S256` (sin eso, no se conecta), `token_endpoint_auth_methods_supported`, `scopes_supported` | **No** |
| Registro del cliente | **CIMD** (preferido: `client_id_metadata_document_supported: true`; el `client_id` de ChatGPT es `https://chatgpt.com/oauth/client.json`) o **DCR** (`registration_endpoint`, RFC 7591). Si están los dos, el que arma la app elige | **No** |
| PKCE | Código de autorización con `S256` | **No** |
| `resource` (RFC 8707) | ChatGPT lo manda en la autorización y en el token; el token tiene que quedar «para» ese recurso (`aud`) | **No** |
| Redirecciones | `https://chatgpt.com/connector_platform_oauth_redirect` (si el servidor anuncia `authorization_response_iss_parameter_supported: true` y devuelve `iss` en cada respuesta) o `https://chatgpt.com/connector/oauth/{callback_id}` | **No** |
| Refresh | Pide refresh tokens (`offline_access` o equivalente): sin eso, hay que volver a entrar cada vez que vence | **No** |
| Validar cada token | Firma, `iss`, `aud`, `exp`, scopes; si falla, `401` con el `WWW-Authenticate` de arriba | **No** (hoy compara la clave) |
| Herramientas `search` y `fetch` | **No hacen falta** para una app propia: se usan todas las que expone el servidor. Solo las piden la «investigación profunda» y el «conocimiento de la empresa» | No hace falta nada |
| `readOnlyHint` | Lo respeta: sin esa marca, cada herramienta es de escritura y pide confirmación | **Sí** (`servidor-mcp.ts`, desde `soloLectura`) |
| Instrucciones del servidor | Los primeros 512 caracteres tienen que entenderse solos | Revisar: `INSTRUCCIONES_MCP` (1.689 caracteres) ya empieza por `leer_guia` |
| Herramientas que cambian | Hay que refrescar la app en ChatGPT para que vea las nuevas | Avisar al dueño después de cada publicación que cambie el MCP |
| Scopes | Los que anuncie el servidor; ChatGPT pide de fábrica `openid`, `email`, `profile` si figuran | Definir uno: `telar` (más `offline_access`) |
| Opcional | Validar el certificado mTLS de OpenAI (`mtls.prod.connectors.openai.com`); `securitySchemes` por herramienta (modo mixto) | No hace falta para empezar |

**Límites del plan (lo tiene que confirmar el dueño):** la ayuda de OpenAI dice que las apps propias con **escritura**
son para **Business y Enterprise/Edu**; en **Pro** (y según algunas fuentes **Plus**) las apps propias quedan **solo de
lectura** (buscar y leer). La guía para desarrolladores es menos clara y la propia ayuda cambió entre versiones. Además:
**solo en la web** (no en la app del celular), las acciones de escritura piden confirmación (se puede recordar por
conversación), y no se puede conectar a un servidor local sin el túnel de OpenAI. **Pregunta para el dueño:** qué plan
de ChatGPT tiene. Si es Plus o Pro, ChatGPT va a poder **leer** Telar pero quizás no escribir.

## Plan de implementación

Decisión: **Telar es su propio servidor de autorización**, dentro de la misma función de Vercel, y el login sigue siendo
la cuenta del juego por Supabase Auth (`servidor/src/sesion.ts`). Por qué no el «servidor OAuth 2.1» de Supabase Auth:
habría que activarlo en la configuración de Auth del **proyecto del juego** (regla dura: no se toca sin el dueño), sus
tokens no llevan nuestro `resource` como audiencia sin un *hook*, y la pantalla de consentimiento igual la tendríamos que
hacer nosotros. Hecho en Telar, todo queda en el esquema `tablero` y no se toca nada del juego.

Esfuerzo estimado: **M–L** (1 a 1,5 días de agente), con pruebas.

**(verificar) antes de escribir:** el SDK que ya usamos (`@modelcontextprotocol/server` 2.4) trae piezas de autorización
(el middleware `bearerAuth` y un armador de metadatos de recurso protegido, según `docs/investigacion.md`). Si encajan
con Hono, usarlas para el lado del recurso; el servidor de autorización (registrar, autorizar, token) igual es nuestro.

### Paso 1 · Base (migración aditiva)

`supabase/migrations/2026120X090000_oauth.sql`, en el esquema `tablero`, con RLS, que se pueda correr dos veces:

- `oauth_clientes`: `id`, `nombre`, `redirect_uris text[]`, `origen` (`dcr` o `cimd`), `creado_en`, `ultimo_uso`.
- `oauth_codigos`: `codigo_hash`, `cliente_id`, `usuario`, `redirect_uri`, `desafio` (PKCE), `recurso`, `scope`,
  `vence` (60 s), `usado`.
- `oauth_refrescos`: `token_hash`, `cliente_id`, `usuario`, `recurso`, `scope`, `familia`, `vence` (30 días), `usado_en`,
  `revocado`. Rotación: cada uso entrega uno nuevo; si se reusa uno viejo, se revoca la familia (`invalid_grant`).

Se guardan **hashes** (SHA-256), nunca los tokens.

### Paso 2 · Módulo `servidor/src/oauth/` (nuevo)

| Archivo | Qué hace |
|---|---|
| `metadatos.ts` | `GET /.well-known/oauth-protected-resource` (y `/.well-known/oauth-protected-resource/mcp`): `{ resource: "https://telarapp.vercel.app/mcp", authorization_servers: ["https://telarapp.vercel.app"], scopes_supported: ["telar"] }`. `GET /.well-known/oauth-authorization-server` (y `openid-configuration` si hace falta): `issuer`, `authorization_endpoint: /oauth/autorizar`, `token_endpoint: /oauth/token`, `registration_endpoint: /oauth/registrar`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true`, `scopes_supported: ["telar","offline_access"]`. La URL pública sale de `urlPublica()` (`servidor/src/diseno/urls.ts`, ya usa `TABLERO_URL_PUBLICA`) |
| `clientes.ts` | DCR (`POST /oauth/registrar`, RFC 7591: valida `redirect_uris` HTTPS, devuelve `client_id` sin secreto) y CIMD (si el `client_id` es una URL HTTPS: bajarla con tiempo límite y tope de tamaño, validar que el `client_id` del documento sea la misma URL, cachearla). Lista de redirecciones permitidas: las de ChatGPT, las de claude.ai (`https://claude.ai/api/mcp/auth_callback`) y `http://localhost`/`127.0.0.1` para Claude Code |
| `autorizar.ts` | `GET /oauth/autorizar`: valida `client_id`, `redirect_uri` exacta, `response_type=code`, `code_challenge` S256, `resource` (tiene que ser la del MCP), `state`. Si no hay sesión (cookie `tablero_sesion`, `leerSesion`), manda a entrar con la cuenta del juego y vuelve. Con sesión, muestra el **consentimiento** («ChatGPT quiere usar tu Telar: leer y cambiar tus tableros. [Permitir] [No]»). `POST` con protección CSRF (token en la cookie y en el formulario): crea el código y redirige con `code`, `state` e `iss` (también en los errores) |
| `token.ts` | `POST /oauth/token`, acepta `application/x-www-form-urlencoded` (lo exigen ChatGPT y Claude). `authorization_code`: código de un solo uso, `redirect_uri` igual, `code_verifier` contra el desafío, `resource` igual. `refresh_token`: rotación y detección de reuso. Errores del estándar (`invalid_grant`, `invalid_client`, `invalid_request`) con `error_description` en castellano |
| `tokens.ts` | Emite y valida el token de acceso: un JWT corto (1 h) firmado con HMAC-SHA256 con `TABLERO_OAUTH_SECRETO` (variable nueva, 32+ caracteres, solo en Vercel), con `iss`, `aud` (el `resource`), `sub` (el usuario del juego), `client_id`, `scope`, `exp`, `iat`, `jti`. Validar con `timingSafeEqual`, como `sesion.ts`. Sin estado: la función de Vercel no guarda nada en memoria entre pedidos |

### Paso 3 · Cambios en lo que existe

- **`servidor/src/api.ts`:**
  - Montar las rutas de `oauth/` y las de `/.well-known/…`, y sumarlas a las rutas **libres** del control de entrada.
  - `/mcp` acepta **o** la clave de siempre (Claude Code sigue igual, `.mcp.json` no cambia) **o** un token OAuth válido
    para el recurso `/mcp` y con un usuario que siga en `TABLERO_USUARIOS`. Sin ninguno: `401` con
    `WWW-Authenticate: Bearer resource_metadata="https://telarapp.vercel.app/.well-known/oauth-protected-resource", scope="telar"`.
  - El actor sale del token (`client_id` → nombre del cliente: «ChatGPT») con `actorDeCliente`, que ya reconoce
    `openai`/`chatgpt`.
  - Los pedidos de ChatGPT vienen de sus servidores (sin `Origin` de navegador): el control de origen actual no los frena;
    probarlo igual.
- **`servidor/src/sesion.ts`:** exportar lo necesario para que `autorizar.ts` use la misma cookie y la misma lista
  `TABLERO_USUARIOS`. No cambia cómo se entra.
- **`scripts/vercel.mjs`:** sumar `^/(\.well-known|oauth)(/.*)?$` a lo que va a la función `/api`. Hoy caería en
  `index.html` y ChatGPT no encontraría los metadatos.
- **`web/pwa/sw.js`:** que el service worker no atienda `/oauth` ni `/.well-known` (como hace con `/api`, `/mcp` y
  `/archivos`).
- **Pantalla de consentimiento:** o HTML chico armado por el servidor con los tokens de `tokens.css` (lo más simple y sin
  estado de la app), o una vista React (`web/src/vistas/Autorizar.tsx`) que reusa `Entrar.tsx`. Recomendado: la vista
  React, para que se vea igual que el resto, en el celular también. Textos en castellano, una sola decisión por pantalla.
- **`web/src/vistas/ConectarIA.tsx`:** sumar «ChatGPT» con la URL y los pasos para el dueño (los de abajo). Online sigue
  mostrando la clave para Claude Code.
- **`README.md`** («Usarlo desde claude.ai o ChatGPT» y «Online»), **`servidor/src/mcp/guia.ts`** si cambia algo para las
  IA, y `AGENTS.md` si hay una regla nueva.
- **Variables de Vercel:** `TABLERO_OAUTH_SECRETO` (nueva) y, si no está, `TABLERO_URL_PUBLICA=https://telarapp.vercel.app`.
  Las carga el dueño o un agente con su permiso; nunca en el repo.

De yapa: lo mismo sirve para **claude.ai** como conector personalizado (pide DCR o CIMD; redirección
`https://claude.ai/api/mcp/auth_callback`; `invalid_grant` si el refresh no vale; 10 s para descubrimiento, registro y
token).

### Paso 4 · Cómo probarlo

1. **Local, con un cliente OAuth real:** un `scripts/probar-oauth.mjs` (como `probar-mcp.mjs`, que se niega a apuntar a
   producción) que haga el baile completo contra un Telar local con `TABLERO_PUBLICO=1`: descubrir los metadatos desde el
   `401`, registrarse por DCR, autorizar con PKCE (con una cookie de prueba), cambiar el código, llamar `listar_proyectos`
   con el token, refrescar, y comprobar que fallan: token vencido, `aud` de otro recurso, código usado dos veces,
   `code_verifier` equivocado, `redirect_uri` distinta, refresh reusado (revoca la familia), usuario fuera de
   `TABLERO_USUARIOS`.
2. **El SDK oficial** (`@modelcontextprotocol/client`, ya está en las dependencias de desarrollo) trae el flujo OAuth del
   cliente con PKCE: usarlo en el script asegura que hablamos el mismo idioma que los clientes reales.
3. **MCP Inspector** contra el Telar local (modo OAuth) para mirar el flujo paso a paso.
4. `npm run typecheck`, `npm run build:vercel` y `node scripts/probar-mcp.mjs` (que la clave de siempre siga andando).
5. **Online, con permiso:** aplicar la migración como `tablero_app`, cargar la variable, publicar y conectar desde
   ChatGPT (pasos de abajo) con una lectura (`listar_proyectos`) y, si el plan lo permite, una escritura en un proyecto
   de prueba que después se archiva. Probar también Claude Code (`.mcp.json` con la clave) para ver que no se rompió.

## Lo que hace el dueño en ChatGPT (cuando esté hecho)

En la computadora, en chatgpt.com (en la app del celular no se puede):

1. Abrí **Plugins** (o **Aplicaciones**) y tocá **+** → **Add custom MCP server** («Agregar servidor MCP propio»).
   En planes de empresa puede estar en Configuración → Aplicaciones → Crear, y lo tiene que habilitar el administrador.
2. Nombre: **Telar**. Dirección: **https://telarapp.vercel.app/mcp**. Autenticación: **OAuth**.
3. Aceptá el aviso y tocá **Create** («Crear»). Después **instalala**.
4. Se abre Telar: entrá con tu cuenta (de Telar o la del juego) y tocá **Permitir**. La IA ve solo lo de esa cuenta
   (docs/cuentas.md).
5. En un chat, escribí **@Telar** y pedile algo: «leé mis pendientes de Restaurant City».
6. Cuando ChatGPT quiera cambiar algo en Telar, te va a pedir que lo apruebes. Podés decirle que lo recuerde en esa
   conversación.

Si un día cambian las herramientas de Telar, en ChatGPT hay que refrescar la app para que las vea.

## ¿Se puede conectar HOY sin programar?

**No de forma segura.** ChatGPT no deja cargar una clave fija como la que usa Claude Code. Las salidas rápidas que hay,
con sus riesgos:

| Salida | Qué es | Riesgo | Veredicto |
|---|---|---|---|
| **Sin autenticación con una dirección secreta** (por ejemplo `/mcp/<clave-larga>`) | Necesita un cambio chico en el código (unas 20 líneas en `api.ts` y la ruta en `vercel.mjs`) y publicar: **no es «sin programar»**, pero es menos de una hora | La dirección **es** la clave: queda guardada en ChatGPT y en sus registros, y quien la tenga puede leer y cambiar todo Telar (sin firma de quién fue). Se revoca cambiando la variable | Solo como puente de días, con el sí del dueño, y apagándolo al llegar el OAuth |
| **Un puente de terceros** (un servicio que recibe a ChatGPT y le pone la clave a Telar) | Sin código nuestro | Nuestra clave queda en manos de otra empresa, que ve todo lo que pasa | **No** |
| **El túnel seguro de OpenAI** (Secure MCP Tunnel) contra un Telar en la computadora del dueño | Sin cambios en Telar | Hay que dejar corriendo un programa en su computadora y se ve solo el Telar local, no el online | **No** (el dueño no es programador y no es su Telar de todos los días) |

Recomendación: **hacer el OAuth** (1 a 1,5 días) como prioridad 1. Mientras tanto, ChatGPT puede usar Telar solo a
través de lo que el dueño le copie y pegue.

## Fuentes

- [ChatGPT Developer mode (OpenAI)](https://developers.openai.com/api/docs/guides/developer-mode): transporte, opciones de
  autenticación, CIMD y DCR, `readOnlyHint`, sin `search`/`fetch`, 512 caracteres de instrucciones, refrescar la app.
- [Apps SDK, Authentication (OpenAI)](https://developers.openai.com/apps-sdk/build/auth): metadatos, PKCE S256, `resource`,
  redirecciones, `client.json`, validación de tokens, `securitySchemes`, mTLS.
- [Developer mode and full MCP connectors in ChatGPT (ayuda de OpenAI)](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt):
  planes (Business y Enterprise/Edu con escritura; Pro solo lectura), solo web, `offline_access`, túnel para servidores privados.
- [Boomi: Connect ChatGPT](https://help.boomi.com/docs/Atomsphere/Platform/Connect_chatgpt_setup) y
  [foro de OpenAI](https://community.openai.com/t/write-actions-blocked-on-custom-mcp-server-business-plan-workspace-developer-mode-unavailable-at-workspace-level/1384381):
  Plus y Pro solo lectura; reportes de escritura bloqueada.
- [Supabase OAuth 2.1 Server](https://supabase.com/docs/guides/auth/oauth-server): la alternativa descartada (toca el Auth
  del proyecto del juego).
- Especificación de autorización de MCP y requisitos de Claude: resumidos en `docs/investigacion.md` (sección del SDK y
  la autorización).
