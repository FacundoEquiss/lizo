> **Nombre de trabajo: Lizo.** El código, la interfaz y los documentos todavía dicen «Telar»: el nombre se está cerrando (consulta de marcas en curso).

# Telar

Lienzo infinito (como Miro) + kanban (como Trello, con lo útil de Jira) para ordenar todos los proyectos. Cada tarjeta tiene su **porqué**, se enlaza a GitHub, Figma y Discord, y la IA (Claude, ChatGPT, Cursor) la maneja por **MCP**: lo que hace aparece en vivo en la pantalla y queda en la actividad con su nombre.

## Para agentes que programan Telar

Cualquier modelo (Claude, Codex, OpenCode con DeepSeek o GLM, ChatGPT, Grok…) empieza por [`AGENTS.md`](AGENTS.md): reglas
duras, cómo correr y probar, cómo publicar y el flujo de trabajo. El criterio de diseño, movimiento, código y entregas,
con ejemplos del repo, está en [`docs/criterio/`](docs/criterio/README.md).

## La IA en Telar

La IA entra por MCP o corre adentro como **agente de una cuenta**: con la clave de esa cuenta, con las mismas herramientas
del MCP, con tope de gasto, con permisos y con su nombre en la actividad. Telar no trae IA propia ni clave propia. Una sola
puerta (el catálogo de herramientas) y nada escondido. Plan completo (menciones `@claude`, agentes por API, campana de
notificaciones): [`docs/plan-ia-integrada.md`](docs/plan-ia-integrada.md).

**Hoy (fase 1, menciones y pendientes por MCP):** escribir `@claude` (o el alias de cualquier miembro: `@facundo`) en un
comentario, en la descripción o el porqué de una tarjeta, o en una nota del lienzo deja una **mención pendiente**. Una IA
conectada por MCP la ve con `leer_pendientes`, la atiende comentando en la tarjeta (queda atendida sola y la persona
recibe el aviso «respondió» en la campana) o con `atender_mencion`. Una mención a una persona le llega como notificación.
Los comentarios con `@claude`
que ya estaban escritos antes se levantan solos, una sola vez por cuenta, la primera vez que se piden las novedades
(`GET /api/novedades`) o `leer_pendientes`; se puede repetir a mano con `POST /api/ia/menciones/levantar` (solo con sesión)
o, contra un Telar local, con `node scripts/levantar-menciones.mjs`. Se prueba con `npm run ia:probar`.

**Fase 2, los agentes de adentro (el ciclo de los trabajos):** una mención a un **agente** (un miembro IA con su clave, su modelo,
sus permisos y sus topes, en Configuración → IA) crea UN **trabajo** que contesta solo, ahí mismo, con su nombre en la actividad:

- **Cómo corre** (`servidor/src/ia/`): `menciones.ts` crea el trabajo; `despacho.ts` lo larga en segundo plano después de contestar
  el pedido (online `waitUntil` con `maxDuration` 300; en la computadora, un temporizador del proceso); `ejecutor.ts` es el ciclo
  paso a paso: toma el trabajo (candado por cuenta, uno por agente y dos por cuenta), arma las instrucciones y el contexto
  (`contexto.ts`), pide al modelo (`proveedores/`), corre las herramientas del MCP (`herramientas-agente.ts`: la capacidad que pide
  cada una, lo delicado, el juego de cada superficie) y guarda cada paso en la base (`trabajos.ts`: `ia_trabajos`,
  `ia_mensajes`, `ia_llamadas`, `ia_uso`). Lo que hace queda con la **tanda** del trabajo en la actividad.
- **Nunca repite una acción ni pierde trabajo:** cada llamada a una herramienta se anota antes y después; si el proceso se corta,
  otro retoma (a lo sumo una vez cada herramienta; una cortada a la mitad queda «incierta» y el modelo verifica leyendo). Los
  **topes** (por trabajo, por agente y por cuenta, por mes) pausan el trabajo («pausado por tope») sin perder nada: se reanuda
  desde el mismo punto.
- **Lo que lee es dato, no orden:** instrucciones fijas contra la inyección, direcciones web armadas por el modelo se rechazan
  (`direcciones.ts`), lo delicado pide permiso, y confirmar, reanudar y reintentar piden **sesión** (la clave del MCP no gasta ni
  da permiso; sí lee y frena). Una IA no le dispara a otra salvo que se prenda (profundidad 2, 10 por hora).
- **Conversar sin `@`:** el comentario de una persona justo después de uno de un agente (hasta 48 h) se toma como respuesta a él.
- **Proactividad (apagada de fábrica):** un agente puede revisar solo cada tarjeta que entra a una lista elegida (`tarjeta_nueva`) o
  armar un resumen diario; en `sugiere` solo comenta, en `actua` también mueve.
- **Red para lo trabado:** el sondeo existente con `ia=1`, el cron de Vercel (`/api/ia/interno/barrer`, cada minuto) y el
  temporizador local. Rutas internas (`correr`, `diagnostico`, `barrer`): sin su secreto, 401.

**Claves, agentes y proveedores (Configuración → IA):** el dueño carga la clave de un proveedor (Anthropic, OpenAI, o un servicio «compatible»:
Gemini, DeepSeek o cualquier otro con formato de OpenAI), crea un agente (nombre, modelo, permisos, «pedime confirmación» y su tope de USD
por mes; 10 de fábrica, 25 por cuenta) y menciona `@el-alias` en una tarjeta. Las claves se guardan **cifradas** (`ia/boveda.ts`, AES-256-GCM
atada a la cuenta y al id de la clave) y nunca vuelven en una respuesta, un evento ni un registro. Cada proveedor es un adaptador que cumple
`Proveedor` (`proveedores/`: `anthropic.ts` con el SDK oficial, `openai.ts` por la API Responses, `compatible.ts` por Chat Completions con la
dirección base validada contra redes privadas y metadatos, y `falso.ts`, solo de pruebas). Sin **precio** conocido (`proveedores/precios.ts`, cada
fila con su fecha y su fuente) un agente no se activa, porque el tope no podría frenarlo; con un modelo que Telar no conoce, el dueño escribe el
precio a mano. Con la capacidad `codigo` el agente lee los repos de la cuenta con un token de GitHub de **solo lectura** (`ia/codigo.ts`: 12
llamadas y 150 KB por trabajo). Todo lo que cambia claves, agentes o topes exige sesión: la clave del MCP lee y frena, nada más.
Primeros pasos para el dueño: [`docs/ia-primeros-pasos.md`](docs/ia-primeros-pasos.md).

El único lugar donde se juntan el ciclo, la bóveda, los proveedores, los precios y el código es `servidor/src/ia/cableado.ts`.

Cómo se prueba (todas con un proveedor falso, sin red y sin gastar): `npm run ia:probar-tanda`, `ia:probar-herramientas`,
`ia:probar-contexto`, `ia:probar-direcciones`, `ia:probar-segundo-plano`, `ia:probar-ejecutor` (el ciclo: T1 a T14, T18, T20, cortes
simulados, topes), `ia:probar-menciones-ia` (T1, T15, T16, T19, T21, conversación y proactividad), `ia:probar-rutas` (por HTTP) y,
de punta a punta con procesos de verdad (incluidos los cortes con `TABLERO_IA_FALLA`), `npm run ia:probar` (T1 a T21 con el
proveedor falso, `TABLERO_IA_FALSO=1`). Además: `ia:probar-boveda`, `ia:probar-agentes`, `ia:probar-codigo`, `ia:probar-proveedores` (el MISMO
juego de contrato para el falso, Anthropic, OpenAI, DeepSeek y Gemini contra sus grabaciones) y `ia:probar-produccion` (el cableado de verdad,
online, sin falso). Las pruebas reales (gastan) están aparte: `npm run ia:probar-real -- --solo-contar` (gratis) y `ia:probar-real`
(tope duro de USD 1). No se probó: la carrera de dos procesos sobre un Postgres real ni `waitUntil` en Vercel
(se verifica al publicar con `POST /api/ia/interno/diagnostico`).

## Usarlo

```bash
npm install
npm run dev
```

Abrí **http://localhost:4317**. La primera vez se crea el proyecto **Restaurant City** (clave `RC`) con el tablero **Pendientes** (Bandeja (Discord), Por decidir, Por hacer, En curso, Hecho), los marcos vacíos del lienzo (Mecánicas, Flujos, Interfaz, Economía y balance, Porqués) y, si está `../docs/discord/pendientes-2026-11.json`, se importan esos pendientes.

- **Kanban**: arrastrá tarjetas y listas; `N` crea una tarjeta en la lista bajo el mouse (`error: el horno se traba !alta #Interfaz @yo` ya carga tipo, prioridad, etiqueta y responsable). Con el mouse sobre una tarjeta: `Enter` abre, `C` archiva, `M` te asigna, `,` `.` la mueven de lista. `F` filtra con operadores (`tipo:error`, `#clientes`, `@yo`, `vence:semana`, `tiene:pr`, `-tipo:idea`).
- **Lienzo**: la barra de herramientas de abajo, o `V` `H` `N` `T` `S` `F` `L` `D` `I` (seleccionar, mano, nota, texto, forma, marco, conector, tarjeta nueva, imagen; `R` y `O` son rectángulo y elipse). Clic crea; arrastrar crea del tamaño que quieras; la tecla dos veces deja la herramienta fija; con el teclado, `Enter` crea en el centro de la vista. Doble clic crea una nota.
  - **Texto con formato** en textos, notas y formas: cinco fuentes, `Ctrl/⌘+B` `I` `U`, listas, títulos, alineación y links. Las notas achican la letra para que entre todo.
  - **13 formas**, con relleno, borde y opacidad. **Marcos** que agrupan (`Ctrl/⌘+G` arma uno con la selección) y se recorren con `,` y `.`.
  - **Conectores**: tirá una línea desde el punto de un objeto y soltala en el aire para crear lo que sigue (nota, texto, forma, tarjeta), o sobre otro objeto para unirlos. Se reenganchan arrastrando un extremo; trazo, puntas y grosor desde su barra.
  - **Tarjetas del Kanban**: arrastralas desde el panel **Tarjetas**, en tres tamaños, con su porqué. Una nota se convierte en tarjeta desde su menú.
  - Al elegir algo aparece su barra encima; el botón derecho (o `Mayús+F10`) abre el menú del objeto. `Ctrl/⌘+C` `X` `V` copian, cortan y pegan (también entre tableros), `Ctrl/⌘+Alt+C` y `V` copian el estilo, `Alt+A` `D` `W` `S` `H` `V` alinean y `Ctrl/⌘+]` `[` cambian la capa. `Tab` recorre los objetos con el teclado.
  - Pegá links (Figma se embebe), imágenes o texto. `Shift+1` ve todo, `Shift+2` hace zoom a la selección, `M` minimapa, `G` grilla.
- **Proyectos y tableros**, en la barra lateral: el botón `⋯` de cada uno edita (nombre, clave, color, emoji o foto) y archiva; `F2` renombra el tablero. Lo archivado queda abajo, en **Archivados**, y se restaura de ahí.
- **Un tablero tiene solo las vistas que necesita** (Kanban, Lienzo y Diseño; al menos una). Al crearlo (**Nuevo tablero**, o el primer tablero de un proyecto nuevo) se elige el tipo: **Tablero** (solo Kanban, de fábrica), **Diagrama** (solo lienzo), **Diseño** (solo la hoja de diseño del proyecto: Diseño es del proyecto, el tablero es la entrada) o **Completo** (las tres). Un tablero de una sola vista no tiene pestañas (abre directo), y la dirección de una vista que no tiene lleva a la que sí. El `⋯` del tablero → **Vistas…** suma o saca una vista (sacar una con contenido pregunta y no borra nada: queda guardada y vuelve al sumarla). Los tableros que ya existían tienen las tres. Se guarda en `tableros.ajustes.vistas` (sin migración); `compartido/vistas.ts`.
- **Configuración** (`Ctrl/⌘+,` o abajo a la izquierda): tema, densidad y movimiento; el fondo, la grilla y los imanes del lienzo; el estilo con que nace cada objeto; todos los atajos, y Acerca de.
- **En todos lados**: `Ctrl/⌘+K` busca y hace todo, `Ctrl/⌘+Z` deshace (también borrados y archivados), `?` muestra todos los atajos.
- Nada se borra de verdad: las tarjetas se **archivan** (botón de arriba a la derecha para verlas y restaurarlas).

Los datos quedan en `.datos/` (Postgres en un archivo, con PGlite; no se sube al repo). Los adjuntos, en `.datos/archivos/`.

### Importar pendientes de Discord

```bash
npm run importar:discord -- ../docs/discord/pendientes-2026-11.json
```

Cada tema va a la lista que le toca por su estado (hecho → Hecho, en la rama → En curso, respondido → Por decidir o Hecho si era una pregunta, pendiente → Por hacer si es un error, Bandeja si es una pregunta, Por decidir si es idea o balance), con etiquetas por área y por tipo, las citas, los adjuntos copiados, la respuesta sugerida (con botón para copiarla) y el porqué. Se puede correr de nuevo: actualiza, no duplica.

## Conectar la IA (MCP)

La clave y los bloques listos con tu ruta están en la app: **Conectar IA** (abajo a la izquierda). A mano:

**Claude Code** (una vez, en una terminal):

```bash
claude mcp add telar --scope user -e TABLERO_AUTOR="Claude Code" -- npm run --silent --prefix /RUTA/A/telar mcp
```

**Claude Desktop** (Configuración → Desarrollador → Editar configuración, y reiniciar Claude):

```json
{
  "mcpServers": {
    "telar": {
      "command": "npm",
      "args": ["run", "--silent", "--prefix", "/RUTA/A/telar", "mcp"],
      "env": { "TABLERO_AUTOR": "Claude Desktop" }
    }
  }
}
```

En Windows: `"command": "cmd"` y `"args": ["/c", "npm", "run", "--silent", "--prefix", "C:\\RUTA\\A\\telar", "mcp"]`.

`npm run mcp` habla por stdio. Si la app está abierta (`npm run dev`), le pide a ese servidor cada cambio y se ve en vivo; si no, levanta el servidor solo y la app queda en **http://localhost:4318**. También hay MCP por HTTP en `http://127.0.0.1:4318/mcp` con la clave como `Authorization: Bearer …` (solo en esta computadora; atiende a clientes de la especificación 2026-07-28 y de 2025). Si un cliente no dice quién es, mandá el encabezado `X-Tablero-Autor: Cursor` (o el nombre que sea) para que la actividad lo firme bien.

Herramientas (26), todas con el mismo estilo: nombre `verbo_cosa`, los mismos parámetros para lo mismo, una descripción
con un ejemplo, errores que dicen cómo corregir y respuestas cortas con los id que hacen falta para el paso siguiente.

- **La guía:** `leer_guia` (cómo usar bien todo lo demás, por temas; ver [Usar Telar con una IA](#usar-telar-con-una-ia)).
- **Ubicarse:** `listar_proyectos`, `leer_proyecto`, `listar_tableros`, `leer_tablero` (el Kanban), `leer_lienzo` (el
  lienzo como árbol: marcos con sus objetos, texto en Markdown, estilos y conectores), `ver_lienzo` (la foto de un marco,
  un área o todo el lienzo, como lo ve una persona, con una revisión de textos que se pisan, aire y letra chica), `leer_tarjeta`, `buscar`,
  `leer_actividad`.
- **Kanban:** `crear_tarjeta`, `actualizar_tarjeta`, `mover_tarjeta`, `archivar_tarjeta`, `comentar`, `registrar_porque`,
  `vincular` (entre tarjetas: bloquea, depende_de, relacionada, duplica…; o links de GitHub, Figma y Discord),
  `crear_lista` y `actualizar_lista`.
- **Lienzo:** `agregar_al_lienzo` (nota, texto, forma de las 13, marco, tarjeta, lista, imagen, link, Figma o conector,
  con texto en Markdown y estilo), `armar_en_lienzo` (varios objetos de una vez, ordenados como diagrama de flujo, fila,
  columna o grilla, con sus conectores y su marco), `actualizar_lienzo` (texto, estilo, lugar, marco, capa; conectores)
  y `convertir_objeto` (nota, texto, forma o tarjeta).
- **Proyectos y tableros:** `crear_proyecto`, `actualizar_proyecto` (también la foto, desde un link), `crear_tablero` y
  `actualizar_tablero` (también el fondo y la grilla del lienzo). Un tablero tiene `vistas` (`kanban`, `lienzo`, `diseno`):
  `crear_tablero` y `crear_proyecto` aceptan `tipo` (`tablero`, de fábrica; `diagrama`; `diseno`; `completo`) o `vistas`, y
  `actualizar_tablero { vistas }` las cambia. Los tableros las devuelven (`listar_proyectos`, `leer_proyecto`,
  `listar_tableros`, `leer_tablero`) y las herramientas de una vista que el tablero no tiene dicen cuál falta y cómo sumarla.
  Para un diagrama, un tablero tipo `diagrama`: no uno completo.

No hay herramienta para borrar: lo más fuerte es archivar, y se deshace con la misma herramienta. La prueba de punta a
punta con el cliente MCP oficial está en `scripts/probar-mcp.mjs` (`node scripts/probar-mcp.mjs`, con `npm run dev`
corriendo; `--stdio` para probar por `npm run mcp`): arma un pedazo de lienzo con todo en un proyecto de prueba, lo lee
de vuelta y lo archiva; también prueba los tipos de tablero y los errores de una vista que falta. Las vistas, sin red:
`npm run vistas:probar`; en pantalla (PC y celular, claro y oscuro): `scripts/probar-vistas-ui.cjs`.

## Usar Telar con una IA

Cualquier IA conectada por MCP (Claude, ChatGPT, Cursor u otra) puede usarlo con la misma profundidad: lo aprendido
armando el «Mapa del juego», la paleta de RC y las tarjetas de Discord está escrito para ellas.

- **Skills sobre MCP (Claude y Claude Code):** la misma guía viaja como skills junto a las herramientas (extensión
  `io.modelcontextprotocol/skills`, SEP-2640): una general (`telar`) y una por tema (`telar-kanban`, `telar-lienzo`,
  `telar-diagramas`, `telar-tablas`, `telar-diseno`, `telar-fuentes`, `telar-respuestas`, `telar-menciones`). El cliente lee solo la
  descripción de cada una y carga el texto cuando el pedido toca ese tema, así la IA no depende de acordarse de llamar a
  `leer_guia` (que sigue para ChatGPT y los clientes que todavía no leen skills). Salen de `servidor/src/mcp/guia.ts`
  (`SKILLS_GUIA`) y se publican desde `servidor/src/mcp/skills.ts`; se prueban con `node scripts/probar-mcp.mjs`.
- **La guía, por MCP:** `leer_guia` es la primera herramienta de la lista. Sin tema da las reglas de oro y el índice; con
  tema, el detalle: `kanban`, `lienzo`, `diagramas`, `diseno`, `fuentes` (Discord con sus mensajes y llamadas; Telegram y
  otras, con la misma idea), `respuestas` y `menciones` (lo que te espera cuando alguien te escribe con `@`: `leer_pendientes`,
  `atender_mencion`, cuándo no contestar). Es lo más portable: no todos los clientes leen las instrucciones del servidor,
  pero todos ven las herramientas.
- **La misma guía, para leer o enlazar:** [`docs/guia-para-ias.md`](docs/guia-para-ias.md). Sale de
  `servidor/src/mcp/guia.ts` con `npm run guia` (no se edita a mano; `npm run guia -- --verificar` avisa si quedó vieja).
- **Claude Code:** la skill [`.claude/skills/telar`](.claude/skills/telar/SKILL.md) se carga sola en este repo. Para
  tenerla en cualquier proyecto, copiá esa carpeta a `~/.claude/skills/`. También se puede subir como skill propia en
  claude.ai o Claude Desktop (la carpeta, en un .zip).
- **ChatGPT u otras:** sumá a sus instrucciones «Usá Telar por MCP. Antes de empezar llamá a leer_guia y, antes de cada
  tarea, a leer_guia con su tema.». Para conectar ChatGPT o el chat de claude.ai online, ver
  [Usarlo desde claude.ai o ChatGPT](#usarlo-desde-claudeai-o-chatgpt) y [`docs/conectar-chatgpt.md`](docs/conectar-chatgpt.md).

## Diseño

La tercera vista de cada tablero (**Diseño**, `g d`), al lado de Kanban y Lienzo: un espacio tipo Figma por proyecto, con
el sistema de diseño importado de su código y diseños propios (campañas, piezas de redes, pantallas nuevas). El plan
completo, con el porqué de cada decisión, está en `docs/plan-diseno.md`.

- **Páginas.** De sistema (Fundamentos: colores, tipografía, radios, sombras, movimiento y la salud del sistema; Íconos),
  de tabla (Textos) y de lienzo (Componentes, Celular, PC o las propias). Cada marco es HTML y CSS dibujado en un
  `<iframe>` sin scripts: se inspecciona como en Figma (capas, medidas, reglas CSS con su archivo y línea, la regla con
  `Alt`) y los propios se editan (texto en el lugar, inspector, código).
- **En el celular** (`web/src/vistas/diseno/movil/`): Diseño es la tercera vista de la barra de abajo, al lado de Kanban
  y Lienzo. Se recorren las páginas (tira de arriba), se miran los marcos con los dedos y se abre uno a pantalla completa
  (pellizcar, doble toque, deslizar al anterior o al siguiente), se lee el sistema como un documento, se comenta (también
  en un punto del marco), se inspecciona, se comparte la imagen y se cambian los textos de los marcos propios y los
  tokens propios. Lo que no entra en un teléfono avisa que se hace en la computadora.
- **Importar** el sistema de un proyecto (lo hace Claude con un perfil, solo lectura sobre el repo):
  `npm run diseno:importar -- --proyecto RC --repo /ruta/al/juego [--con-paginas]`. Las pantallas (`--con-paginas`) se
  sacan abriendo la interfaz del proyecto en un navegador sin cabeza. El perfil del juego: `scripts/diseno/perfiles/RC.json`.
  El material de Restaurant City va a la base (detrás del login): nunca al repo ni a lo estático.
- **MCP** (las mismas herramientas de arriba, más trece): `leer_diseno`, `buscar_en_diseno`, `ver_diseno` (la imagen del
  marco, con avisos de calidad), `crear_marco`, `editar_marco`, `duplicar_marco` (copias y adaptaciones a otros
  tamaños), `definir_tokens`, `definir_pieza`, `subir_activo`, `organizar_diseno`, `comentar_diseno`, `exportar_diseno`
  (PNG, JPG o SVG; los deja como adjuntos de una tarjeta) y `sincronizar_diseno`.
- **Render:** en la computadora con el Chrome instalado (`TABLERO_CHROME` si no lo encuentra). Online, una función aparte
  de Vercel (`render.func`, ~90 MB con `@sparticuz/chromium`) que arma `npm run build:vercel`; la principal le pide las
  imágenes por HTTP con la clave del MCP.
- **Base:** la migración `supabase/migrations/20261201090000_diseno.sql` (aditiva). Online se aplica a mano como las demás.
- **Pruebas y capturas:** `npm run diseno:probar-mcp` (el MCP de punta a punta con un cliente real, en menos de 60 s),
  `npm run diseno:probar-sanear` (HTML y CSS maliciosos), `npm run diseno:capturas` (con la app abierta; las de RC salen
  con el prefijo `rc-` y no se suben) y `npm run diseno:ver -- --proyecto RC --marco <id>` (un marco a PNG, sin abrir la app).

## Usarlo desde claude.ai o ChatGPT

Telar online (https://telarapp.vercel.app/mcp) es su propio servidor de autorización **OAuth 2.1** (PKCE S256, registro de
clientes por DCR y CIMD, `resource`, refresh con rotación). La clave de siempre (`Authorization: Bearer <clave>`, la de
Claude Code y `.mcp.json`) **sigue andando igual**: `/mcp` acepta la clave o un token OAuth.

- **ChatGPT** (en la computadora, en chatgpt.com; en la app del celular no se puede): Plugins → **+** → *Add custom MCP
  server*. Nombre **Telar**, dirección `https://telarapp.vercel.app/mcp`, autenticación **OAuth**. Se abre Telar: entrá con
  tu cuenta y tocá **Permitir** (la IA ve solo lo de esa cuenta). Probado con el plan **Plus** (24/11/2026): lee y también escribe (creó una tarjeta). La
  dirección tiene que ser `https://` (con `http://` ChatGPT rechaza la configuración). Si cambian las herramientas, refrescá la app en ChatGPT.
- **claude.ai:** Configuración → Conectores → *Agregar conector personalizado*, misma dirección; mismo «Permitir».
- Lo conectado se ve y se corta en la app, en **Conectar IA → ChatGPT y Claude (chat)** (*Desconectar*).
- Cómo funciona: `/.well-known/oauth-protected-resource` y `/.well-known/oauth-authorization-server` (metadatos),
  `/oauth/registrar`, `/oauth/autorizar` (valida y manda a la pantalla `/autorizar`), `/oauth/token` y `/oauth/revocar`. El
  token de acceso es un JWT de 1 h que vale **solo para `/mcp`**; los códigos y los refrescos se guardan como hash
  (tablas `oauth_*` del esquema `tablero`). El secreto sale de `TABLERO_SECRETO` (o de `TABLERO_OAUTH_SECRETO` si existe).
  Redirecciones permitidas: `chatgpt.com`, `claude.ai`, `claude.com` y `localhost`; más con `TABLERO_OAUTH_REDIRECCIONES`.
- Probarlo: `npm run oauth:probar` (levanta su propio Telar local y hace el baile completo con PKCE y los casos que tienen
  que fallar). Detalle y decisiones: [`docs/conectar-chatgpt.md`](docs/conectar-chatgpt.md).

## Online (24/11/2026)

Publicado en **https://telarapp.vercel.app** (proyecto `telar` de Vercel, equipo del dueño). Se entra con una **cuenta de
Telar** (mail, nombre y contraseña propios: «Crear cuenta» está siempre a la vista y la cuenta queda **pendiente** hasta que el dueño
la aprueba en Configuración → Amigos → Solicitudes; con un enlace de invitación del dueño entra aprobada al instante) o con la **cuenta
del juego** del dueño (mail y contraseña, o un código por mail; solo las de `TABLERO_USUARIOS`). **Cada cuenta tiene su base propia**: no ve
nada de otra cuenta. La cuenta del juego y la clave del MCP son la cuenta `dueno`, con todo lo de antes. Detalle, inventario
de qué se chequea en cada ruta y herramienta, y lo que queda (mail para recuperar la contraseña): [`docs/cuentas.md`](docs/cuentas.md).

- **Base:** el proyecto de Supabase del juego, en su propio esquema `tablero` (21 tablas). Gratis: no suma un proyecto.
  Entra con su propio usuario de base, `tablero_app`, dueño del esquema, que no ve nada del juego. Las migraciones de
  `supabase/migrations` NO corren solas online: se aplican con ese usuario como dueño (`set role tablero_app;
  set search_path = tablero;` y el SQL), y se anotan en `tablero.tablero_migraciones`.
- **Pasar a la 0.2:** antes de publicarla, aplicar su migración en el editor SQL de Supabase. Solo agrega (la foto y el
  emoji del proyecto, los ajustes del tablero y más estilos de conector) y se puede correr dos veces sin error; la 0.1
  publicada sigue andando con la base ya migrada:

  ```sql
  set role tablero_app;
  set search_path = tablero;
  -- acá, el contenido de supabase/migrations/20261125090000_v0_2.sql
  insert into tablero_migraciones (nombre) values ('20261125090000_v0_2.sql') on conflict do nothing;
  ```
- **Servidor:** una sola función de Node en Vercel (`servidor/src/vercel-entrada.ts`) que atiende `/api`, `/mcp` y
  `/archivos`. Los archivos van a la base (`tablero.archivos`), los eventos en vivo se anotan en `tablero.eventos` y la
  web pregunta cada 3 s (con la pestaña escondida no pregunta).
- **Variables en Vercel** (nunca en el repo): `TABLERO_PUBLICO=1`, `TABLERO_DB_URL` (el pooler de Supabase con el
  usuario `tablero_app`; puede llevar varias direcciones separadas por espacio), `TABLERO_SECRETO` (firma la cookie),
  `TABLERO_CLAVE` (clave del MCP), `TABLERO_SUPABASE_URL` y `TABLERO_SUPABASE_ANON` (las cuentas del juego; la clave
  anon es pública) y `TABLERO_USUARIOS`. **Ya no hace falta ninguna variable para que alguien cree su cuenta**: crea la suya desde Entrar
  (queda pendiente hasta que el dueño la aprueba en Configuración → Amigos) o el dueño le pasa un enlace de invitación que genera desde la app.
  `TABLERO_INVITACION` sigue funcionando si está cargada (el registro por código de antes, compatibilidad) y se puede borrar.
- **IA integrada, fase 2 (agentes que contestan solos):** aplicar ANTES de publicar `supabase/migrations/20261206090000_ia.sql`
  (claves, agentes, ajustes, trabajos, mensajes, llamadas y gasto; la columna `tanda` de la actividad; solo agrega y se puede
  correr dos veces), con el mismo bloque `set role tablero_app; set search_path = tablero;` y anotándola en
  `tablero_migraciones`. Variables nuevas en Vercel: **`CRON_SECRET`** (un valor al azar que no se muestra en ningún lado: Vercel lo
  manda solo al cron `/api/ia/interno/barrer`, que corre cada minuto —hace falta el plan Pro—; sin la variable no hay cron y la
  ruta rechaza todo) y, opcional, **`TABLERO_SECRETO_IA`** (el secreto con que se cifran las claves de los proveedores; si no está,
  sale de `TABLERO_SECRETO`; al cambiarlo se deja el anterior en `TABLERO_SECRETO_IA_ANTERIOR`). `api.func` pasa a 300 s de
  duración (`render.func` queda en 60). Antes de que el dueño cargue su clave, llamar una vez a
  `POST /api/ia/interno/diagnostico` con la clave del MCP y mirar en el registro de Vercel la línea
  `[tablero] ia: segundo plano ok` (20 s después): si no aparece, `waitUntil` no anda y se vuelve a la versión anterior.
  Resumen de la F2 online, **en este orden**: (1) aplicar la migración `20261206090000_ia.sql`; (2) crear `CRON_SECRET` (y, si se quiere
  separar el cifrado de las claves, `TABLERO_SECRETO_IA`; si no, usa `TABLERO_SECRETO`); (3) publicar; (4) verificar `/api/salud`, que el cron
  figure en el proyecto y el diagnóstico de arriba; (5) recién ahí el dueño carga su clave en Configuración → IA
  ([`docs/ia-primeros-pasos.md`](docs/ia-primeros-pasos.md)). **`TABLERO_IA_FALSO` no existe online**: el proveedor falso es de pruebas y se
  niega a andar si el proceso corre en Vercel (aunque la variable esté puesta); un agente «falso» que quedara en la base falla enseguida.
  Sin `TABLERO_SECRETO_IA` ni `TABLERO_SECRETO`, guardar o probar una clave da 503 con el motivo y los trabajos fallan sin marcar la clave como
  inválida. Medido (25/11/2026): `api.func` pesa 5,2 MB sin comprimir (antes de la IA integrada, 2,75 MB) y el arranque en frío del módulo
  sube de ~167 ms a ~230 ms (mediana); el SDK de Anthropic se carga con `import()` recién al primer pedido a Anthropic y suma ~14 ms.
- **Archivo automático de Hecho:** aplicar ANTES de publicar `supabase/migrations/20261207090000_archivo_hecho.sql` (agrega la columna
  `tableros.archivo_hecho_en` y un índice; solo agrega y se puede correr dos veces), con el mismo bloque `set role tablero_app; set
  search_path = tablero;` y anotándola en `tablero_migraciones`. No tiene variables nuevas. Si se publica sin aplicarla, todo anda igual
  pero Telar no archiva solo (abrir el tablero no falla). La primera vez que se abra un tablero, Telar archiva lo que lleve más de 30
  días en Hecho (lo de siempre, restaurable) y avisa una vez en la campana.
- **Publicar un cambio:** `npm run build:vercel` (arma `.vercel/output` con la Build Output API) y
  `npx vercel deploy --prebuilt --prod` con el token de Vercel del entorno. No depende de `main`: el juego no se toca.
- **Importar desde esta computadora:** los adjuntos de a uno a `/api/importar/archivo` y después el JSON a
  `/api/importar/discord-json`, con la clave del MCP. Así se cargaron los 69 pendientes de Discord.
- **OAuth** (ChatGPT y claude.ai): ver arriba. Necesita la migración `20261202090000_oauth.sql` (tres tablas nuevas; solo
  agrega) y, opcional, `TABLERO_URL_PUBLICA=https://telarapp.vercel.app` para fijar el emisor. `/oauth` y `/.well-known` van
  a la misma función de Vercel.
- **Pasar a la 0.3 (tablas y gráficos):** aplicar ANTES de publicar `supabase/migrations/20261203090000_tablas_graficos.sql`
  (solo amplía la lista de tipos de objeto del lienzo; se puede correr dos veces), con el mismo bloque `set role tablero_app;
  set search_path = tablero;` y anotándola en `tablero_migraciones`.
- **Cuentas propias:** aplicar ANTES de publicar `supabase/migrations/20261204090000_cuentas.sql` (tablas `cuentas` e
  `intentos`, la columna `propietario` con default `'dueno'` en proyectos, miembros, actividad, eventos y archivos, y el
  prefijo y la clave de tarjeta únicos por cuenta; se puede correr dos veces, y la versión publicada sigue andando con la
  base migrada), con el mismo bloque `set role tablero_app; set search_path = tablero;` y anotándola en
  `tablero_migraciones`. Después, para sumar amigos, el dueño los invita desde Configuración → Amigos (ya no hace falta
  `TABLERO_INVITACION`). Probar antes con `npm run cuentas:probar` (local).
- **Crear cuenta con aprobación del dueño (solicitudes):** aplicar ANTES de publicar `supabase/migrations/20261211090000_solicitudes.sql`
  (amplía el `check` de `cuentas.estado` de `activa | suspendida` a `activa | suspendida | pendiente | rechazada`, soltándolo por su nombre
  `cuentas_estado_check` y volviéndolo a crear, y suma `solicitada_en`, `decidida_en` y `decidida_por`; solo agrega, se puede correr dos
  veces y la versión publicada antes sigue andando con la base migrada), con el mismo bloque `set role tablero_app; set search_path = tablero;`
  y anotándola en `tablero_migraciones`. **Sin variables nuevas ni gasto.** Si se publica sin aplicarla, «Crear cuenta» da error (la base no
  acepta el estado `pendiente`) y Amigos se ve sin Solicitudes; por eso va antes. Probar antes con `npm run solicitudes:probar` y
  `npm run cuentas:probar -- --solo-solicitudes` (local).
- **Amigos (invitaciones por enlace):** aplicar ANTES de publicar `supabase/migrations/20261208090000_invitaciones.sql` (la tabla
  `invitaciones` con seguridad por fila y, en `cuentas`, las columnas `invitacion_id` y `ajustes`; solo agrega y se puede correr dos veces),
  con el mismo bloque `set role tablero_app; set search_path = tablero;` y anotándola en `tablero_migraciones`. Sin variables nuevas ni
  gasto. Si se publica sin aplicarla, Configuración → Amigos y los enlaces dan error (el registro por el código de la variable sigue
  andando); por eso va antes. Se puede probar antes con `npm run amigos:probar` y `npm run cuentas:probar -- --solo-amigos` (local).
- **Recuperar la contraseña sin correo (códigos de recuperación y restablecimiento por el dueño):** aplicar ANTES de publicar
  `supabase/migrations/20261210090000_recuperacion.sql` (las tablas `codigos_recuperacion` y `restablecimientos` con seguridad por fila y, en
  `cuentas`, las columnas `restablecida_en` y `restablecida_por`; solo agrega, se puede correr dos veces y la versión publicada antes sigue
  andando con la base migrada), con el mismo bloque `set role tablero_app; set search_path = tablero;` y anotándola en `tablero_migraciones`.
  Sin variables nuevas ni gasto: no hay servicio de mail, así que una cuenta de Telar que olvida su contraseña la recupera con uno de sus 8
  códigos de recuperación (los ve una sola vez al crear la cuenta) o con el enlace que le genera el dueño en Configuración → Amigos →
  «Restablecer contraseña». Si se publica sin aplicarla, esas dos cosas dan error y las cuentas nuevas se crean igual, sin códigos (los
  generan desde Configuración → Cuenta una vez migrada); por eso va antes. Probar antes con `npm run recuperacion:probar` y
  `npm run cuentas:probar -- --solo-recuperacion` (local). **Cuando se contrate un servicio de mail (Resend, ver `docs/cuentas.md`, «Lo que
  queda para después»), se suma «recibir el código por mail» como tercer camino; estos dos siguen sirviendo.**
- **Menciones y notificaciones (IA integrada, fase 1):** aplicar ANTES de publicar
  `supabase/migrations/20261205090000_menciones.sql` (alias, archivado y preferencias en `miembros`; `respuesta_a` y
  `trabajo_id` en `comentarios`; las tablas `menciones` y `notificaciones`; la marca `menciones_levantadas_en` en `cuentas`;
  solo agrega, se puede correr dos veces y la versión publicada antes sigue andando con la base migrada), con el mismo
  bloque `set role tablero_app; set search_path = tablero;` y anotándola en `tablero_migraciones`. No hay variables
  nuevas ni gasto. Probar antes con `npm run ia:probar` y `npm run cuentas:probar` (local).

## Pasarlo a Supabase

La app habla con la base por una capa propia (`servidor/src/datos/conexion.ts`); el adaptador de Postgres ya está hecho (`servidor/src/datos/postgres.ts`).

1. Crear el proyecto en Supabase y correr `supabase/migrations/*.sql` (con `supabase db push` o en el editor SQL). Son SQL plano de Postgres, con RLS activado.
2. Poner la cadena de conexión del *Session pooler* en la variable `TABLERO_DB_URL` del servidor (nunca en el repo) y arrancar: usa Postgres en vez de PGlite. Todo lo demás queda igual.
3. Pendiente para después: los adjuntos a Supabase Storage y los eventos en vivo con Supabase Realtime si hay más de un servidor.

## Cómo está hecho

React + TypeScript + Vite, React Flow 13 (lienzo), TipTap 3 (texto con formato), dnd-kit (kanban), Motion, zustand, cmdk y tinykeys en `web/`; Node + Hono con eventos en vivo por SSE y el SDK oficial de MCP v2 (`@modelcontextprotocol/server`) en `servidor/`; tipos y reglas compartidas en `compartido/`. La investigación de producto está en `docs/investigacion.md`.

Variables de la IA integrada (opcionales; las de Vercel están arriba): `TABLERO_SECRETO_IA` (y `TABLERO_SECRETO_IA_ANTERIOR` al rotarla; en la
computadora, sin ellas, el secreto se crea solo en `.datos/secreto-ia.txt`), `CRON_SECRET` (Vercel, para el cron), `TABLERO_IA_FALSO=1` (**solo en
la computadora**: el proveedor falso de las pruebas; nunca en Vercel), `TABLERO_IA_FALSO_ESPERA_MS` y `TABLERO_IA_FALSO_RETRASO_MS` (solo para las
pruebas del falso), `TABLERO_GITHUB_API` (solo para probar la lectura de código contra un GitHub de mentira), `TABLERO_IA_FALLA=<punto>` (corta el proceso a propósito en `despues-de-guardar-asistente`, `en-medio-de-herramienta`,
`despues-de-herramientas`, `antes-de-cerrar` o `despues-de-responder`, una vez, para probar que un corte no repite nada).

La conexión a la base **verifica el certificado** (con la raíz pública de Supabase, incluida en `servidor/src/datos/supabase-ca.ts`). Para otra base con otro certificado, `TABLERO_DB_CA` suma una raíz (PEM); si el certificado no verifica, **no conecta** (no hay plan B); `TABLERO_DB_TLS=sin-verificar` cifra sin verificar, solo como excepción.

Variables opcionales: `TABLERO_PUERTO` (4318), `TABLERO_PUERTO_WEB` (4317), `TABLERO_DATOS`, `TABLERO_DB_URL`, `TABLERO_CLAVE`, `TABLERO_USUARIO` (tu nombre en la app), `TABLERO_SEMILLA_DISCORD` (`no` para no importar nada la primera vez).

## Licencia

Copyright (C) 2026 FacundoEquiss

GNU Affero General Public License v3.0 (AGPL-3.0). Ver [`LICENSE`](LICENSE).
