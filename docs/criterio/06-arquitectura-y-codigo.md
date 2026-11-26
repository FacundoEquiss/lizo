# 6. Arquitectura y código

El código de Telar se lee como un texto: archivos chicos por tema, nombres en castellano que dicen lo que son, un
comentario de cabecera con el porqué, y una sola forma de hacer cada cosa.

## Estructura

```
compartido/        tipos y reglas que usan la web y el servidor (tipos.ts, lienzo.ts, rico.ts, filtro.ts, geometria.ts,
                   texto.ts, enlaces.ts, constantes.ts; tabla.ts y grafico.ts: tablas con columnas con formato y gráficos,
                   con sus operaciones; iconos.ts: el catálogo de íconos de las formas; diseno/ para la sección Diseño). Sin dependencias de navegador ni de Node.
web/               la app (React 19 + Vite)
  index.html       script en línea: tema, data-movil, data-tactil, data-instalada (antes de pintar, sin parpadeo)
  src/main.tsx     elige <App /> (escritorio) o <AppMovil /> (lazy)
  src/estado/      tienda.ts (zustand), deshacer.ts, eventos.ts (en vivo), api.ts, sesion.ts, ruta.ts, preferencias.ts, avisos.ts, ia.ts (la IA integrada: notificaciones y trabajos de los agentes)
  src/estilos/     tokens.css → base.css → app.css, kanban.css, tarjeta.css, detalle.css, lienzo.css, diseno.css; movil.css
                   y diseno-movil.css cuelgan de html[data-movil]
  src/ui/          piezas comunes (Dialogo, Desplegable, EstadoVacio, AvatarProyecto, Avisos, marcas, comunes)
  src/util/        atajos.ts (tabla única), movimiento.ts (catálogo), teclas, fechas, imagen, markdown
  src/vistas/      escritorio: kanban/, tarjeta/, lienzo/ (nodos/, conectores/, barra/, paneles/, texto/), diseno/, lateral/, configuracion/ (con ia/: Configuración → IA), ia/ (la IA integrada en la tarjeta y la campana: EntradaTrabajo, ConfirmarAcciones, PieTrabajo, PastillaTrabajo, FilaNotificacion)
  src/movil/       la capa del celular (no la importa el escritorio)
  src/pwa/         service worker (registro), instalar, color de la barra, sin conexión
  pwa/             plantilla del service worker y plugin de Vite
servidor/src/
  principal.ts     arranque local (primero toma el puerto: hace de candado para PGlite)
  servidor.ts      servidor local · vercel.ts + vercel-entrada.ts: la función online
  api.ts           Hono: /api (JSON), /api/eventos (SSE o sondeo), /archivos, /mcp (clave u OAuth), /oauth y /.well-known;
                   seguridad de origen y host
  oauth/           Telar como servidor de autorización OAuth 2.1 (config, firmas, almacén, clientes, metadatos, autorizar,
                   token, recurso, rutas): ChatGPT y claude.ai. Solo online
  sesion.ts        entrar con la cuenta del juego (Supabase Auth) y cookie firmada
  cuentas.ts       cuentas propias de Telar: registro, scrypt, límite de intentos, tope de amigos, suspender (docs/cuentas.md)
  amigos.ts        invitaciones por enlace (token solo como hash, canje en una transacción) y la lista de amigos; amigos-rutas.ts, sus rutas
  config.ts        variables TABLERO_* y rutas
  dominio/         servicio.ts: TODA la lógica que cambia datos; filas.ts; disposicion.ts (armar diagramas); lienzo.ts
  datos/           conexion.ts (capa propia), postgres.ts, pglite.ts, almacen.ts (archivos en carpeta o en la base), migraciones.ts
  mcp/             comun.ts (las reglas), herramientas.ts (orden e instrucciones), guia.ts, kanban.ts, lienzo.ts,
                   proyectos.ts, menciones.ts (leer_pendientes, atender_mencion), servidor-mcp.ts, stdio.ts
  ia/              la IA integrada: servicio-ia.ts (todo el SQL de menciones y notificaciones, `iaDe(servicio)`), menciones.ts
                   (la regla de la cantidad y lo de antes), conectar.ts (`conectarIA`, engancha los ganchos de dominio/ganchos.ts), rutas.ts
  diseno/          servicio, rutas, render (Chromium), sanear (HTML y CSS seguros), herramientas-mcp, importar
  importar/        Discord
supabase/migrations/  SQL plano de Postgres, aditivo, con RLS
scripts/           pruebas, capturas, medición, íconos, empaquetado de Vercel, guía para IAs
docs/              planes, investigación, criterio, guía, capturas, diagramas
```

## Estado en la web

- **Una tienda** (`web/src/estado/tienda.ts`, zustand) con proyectos, tablero, tarjetas, lienzo. Diseño tiene la suya
  (`vistas/diseno/estado.ts`), que se carga con la vista.
- **Todo cambio de un objeto del lienzo pasa por la tienda** para que tenga deshacer (regla 7 del plan de escritorio).
  Optimista: se aplica en la pantalla y se manda al servidor; si falla, se avisa y se vuelve.
- **Índices memorizados por referencia** (`porId`, `WeakMap`): los nodos no hacen `find` sobre todo el tablero en cada
  cambio. Una lista cambia de referencia solo cuando cambia algo de ella: **no se clonan listas sin motivo**.
- **Selectores finos** (`useTienda((s) => s.cosa)`): un componente se vuelve a dibujar solo si cambia lo que usa.
- **En vivo:** `estado/eventos.ts`. Local por SSE; online, sondeo cada 3 s a `/api/eventos/desde` (Vercel no tiene un
  proceso que viva siempre), y con la pestaña escondida no pregunta. Cada pedido lleva `x-tablero-cliente` para no
  reaplicar los propios cambios.
- **Preferencias del dispositivo** (tema, densidad, minimapa, rueda) en el navegador (`preferencias.ts`); lo que describe
  al tablero (fondo, grilla, imanes) **en el tablero**, para que la PC y el celular lo vean igual.

## Servidor

- **Una sola capa de lógica:** `servidor/src/dominio/servicio.ts`. «Todo lo que cambia algo pasa por acá: valida, guarda,
  anota la actividad (con su autor: persona, IA o importador) y publica el evento en vivo. La API web, el MCP y los
  importadores usan esta misma capa.» No se escribe SQL en una ruta ni en una herramienta MCP.
- **Errores que enseñan:** `ErrorDominio(mensaje, estado)` en castellano, dice qué pasó y cómo seguir. `api.ts` los
  convierte en `{ error }` con su código; los de zod salen como «Datos inválidos: campo: …» (mensajes en castellano
  configurados una vez en `mcp/comun.ts`, `configurarMensajes`).
- **Seguridad local:** solo `127.0.0.1` (lo pide la especificación MCP para servidores locales), `Host` y `Origin` de la
  propia computadora. **Online** (`TABLERO_PUBLICO=1`): mismo origen, y para `/api` y `/archivos` hace falta la cookie
  firmada de la sesión o la clave del MCP; `/mcp` pide la clave Bearer o un token OAuth.
- **Cuentas: cada una ve solo lo suyo** ([`docs/cuentas.md`](../cuentas.md)). Un solo middleware pone el alcance de cada
  pedido (cookie → su cuenta; clave del MCP y local → `dueno`; en `/mcp`, el token OAuth → su cuenta). El Servicio es
  siempre el de una cuenta (`servicio.de(cuenta)`; el de la raíz no consulta nada: `this.cuenta` tira error), con su bus
  (eventos marcados) y su almacén (carpeta `c/<cuenta>/`). **Todo método que recibe un id lo verifica antes de leer o
  escribir**: `propio(tipo, id)`/`propios(tipo, ids)` (un camino SQL fijo por tipo hasta el proyecto y su `propietario`) o
  un resolutor que filtra por propietario en SQL; las listas filtran en SQL (`resumenes` siempre). Lo ajeno da 404 con el
  mismo mensaje que lo que no existe. En Diseño, cada método con `pid` llama a `pidPropio`. Sin RLS (el pooler no
  sostiene variables de sesión). Una ruta o herramienta nueva suma su caso a `npm run cuentas:probar`.
- **Lo subido nunca corre código:** `/archivos` responde con `Content-Security-Policy: default-src 'none'; …; sandbox` y
  `nosniff`. Diseño dibuja HTML ajeno en `<iframe sandbox="allow-same-origin">` sin scripts y saneado en el servidor
  (`diseno/sanear.ts`, con su prueba de HTML malicioso).
- **Online en una función:** `scripts/vercel.mjs` arma la Build Output API v3: estático + `api.func` (todo el servidor;
  PGlite reemplazado por un módulo vacío) + `render.func` (Chromium, 2 GB, límite 250 MB). Región `iad1`, al lado de la
  base. La función se arma una vez por proceso y abre la base con el primer pedido (`vercel.ts`).

## MCP

Las reglas están escritas en la cabecera de [`servidor/src/mcp/comun.ts`](../../servidor/src/mcp/comun.ts) y se cumplen
en las 38+ herramientas. Una herramienta nueva **tiene** que cumplirlas:

1. **Nombre `verbo_cosa` en castellano:** `listar_`, `leer_`, `crear_`, `actualizar_`, `agregar_`, `armar_`, `mover_`,
   `archivar_`, `comentar`, `vincular`.
2. **Parámetros en `snake_case`, y lo mismo se llama igual en todas:** `proyecto`, `tablero`, `marco`, `objeto`, `tarjeta`,
   `color`. Las referencias aceptan lo que diría un humano (el prefijo `RC`, el nombre del tablero, la clave `RC-12`, el
   título de un marco o el texto de una nota) además del id. Usá los parámetros comunes (`refProyecto`, `refTablero`,
   `refTarjeta`, `colores`).
3. **Esquemas estrictos** (`z.strictObject`): un parámetro inventado es un error que dice cuáles existen. Nada se ignora
   callado (commit `1af8980`).
4. **La descripción** dice para qué sirve, qué devuelve, cuándo usar otra herramienta, y **trae un ejemplo** de llamada en
   JSON. Ejemplo real (`agregar_al_lienzo`, en `mcp/lienzo.ts`):
   `{ "tipo": "nota", "texto": "Los clientes **esperan** 30 s", "color": "rosa", "marco": "Mecánicas" }`.
5. **Respuestas compactas:** `{ ok: true, mensaje, <lo creado con su id>, url? }`; las de lectura, solo los datos (`compacta`,
   `limpio`: sin `undefined` ni campos vacíos). Lo que trae id es lo que hace falta para el paso siguiente.
6. **Errores que enseñan:** qué estuvo mal, qué valores valen, qué herramienta da el id que falta («tiene que ser uno de:
   rectangulo, elipse…; llegó «cuadrado»»).
7. **Nada se borra de verdad:** lo más fuerte es archivar una tarjeta o sacar algo del lienzo (`quitar_del_lienzo`), y se
   deshace con la misma herramienta.
8. **Anotaciones honestas:** `soloLectura` → `readOnlyHint` (ChatGPT pide confirmación para todo lo que no lo tenga),
   `destructiveHint: false`, `idempotente`.
9. **Una llamada por intención** (`armar_en_lienzo`: hasta 300 objetos y 600 conectores, todo o nada, en una transacción con inserciones en bloque; `editar_marco`: todas
   las operaciones o ninguna).
10. **Se define con `definir({...})`** en el archivo de su grupo y se suma al `ORDEN` de `mcp/herramientas.ts` (primero la
    guía, después ubicarse, leer y al final cambiar). El mismo código atiende HTTP (`createMcpHandler`, sin estado, eras
    2026 y 2025) y stdio.
11. **El autor** sale del cliente (`actorDeCliente`: «claude-code» → Claude Code, «openai-mcp» → ChatGPT) o de
    `X-Tablero-Autor` / `TABLERO_AUTOR`, y la IA queda como miembro (se le puede asignar).
12. **Lo aprendido va a la guía:** `servidor/src/mcp/guia.ts` (tema por tema) → `npm run guia` escribe
    `docs/guia-para-ias.md`. No se edita el `.md` a mano. Las instrucciones del servidor (`INSTRUCCIONES_MCP`) son cortas
    y empiezan por `leer_guia`.
13. **Se prueba con un cliente real** (`scripts/probar-mcp.mjs`, también los errores) antes de darla por hecha.

## Base y migraciones

- **Capa propia** (`datos/conexion.ts`): el mismo código corre en PGlite (local, `.datos/pg`) y en Postgres (Supabase).
- **Migraciones** en `supabase/migrations/AAAAMMDDHHMMSS_nombre.sql`: SQL plano, **aditivas**, que **se pueden correr dos
  veces** (`if not exists`, `on conflict do nothing`, consultar `pg_constraint` antes de tocar restricciones), con RLS
  activado. Local corren solas (`datos/migraciones.ts`, en una transacción, anotadas en `tablero_migraciones`). **Online
  no corren solas:** se aplican a mano como `tablero_app` (`set role tablero_app; set search_path = tablero;`), con
  permiso, antes de publicar el código que las usa, y la versión publicada tiene que seguir andando con la base ya migrada.
- **El estilo de los objetos vive en `datos` (JSON)**, no en columnas nuevas (decisión F2): sumar fuente, alineación o
  borde no pide migración. `actualizarElementos` fusiona `datos`.
- **Dos fuentes de verdad, no:** si hay `texto` y `rico`, el servidor recalcula `texto` desde `rico`.
- **Orden** con `fractional-indexing` (claves entre dos), nunca enteros que haya que renumerar.

## Rendimiento (presupuestos medidos)

Medido con `scripts/medir-lienzo.cjs` sobre `sembrar-lienzo.mjs --parecido-rc` (682 objetos, 155 conectores, 31 marcos:
como el «Pendientes» de RC), Chromium sin GPU; vale la comparación, no el número suelto. «CPU ×4» es `--cpu 4` (una
compu o un teléfono modestos). Antes = `ac74d3f`; después = rama de rendimiento del 25/11/2026.

| Qué | Presupuesto | Medido (antes → después) |
|---|---|---|
| Lienzo, vista general (zoom 0,09, todo en pantalla): mover | ≥ 50 cps | 47–51 → 51–52 cps (14–17 → 13–14 ms de hilo por cuadro); CPU ×4: 9 → 13–14 cps (107–116 → 72–77 ms) |
| Lienzo, lejos (zoom 0,2, donde se lee): mover | ≥ 55 cps | 54–55 → 57 cps; CPU ×4: 13,5–14 → 20,5–21 cps (71–74 → 48 ms por cuadro) — **pendiente en compus modestas** |
| Lienzo, de cerca (0,6): mover y zoom | 60 cps | 59–60 → 60; CPU ×4: 49–53 → 53–55 |
| Arrastrar un objeto | ≥ 55 cps | lejos 59 → 59–60 (CPU ×4: 42–43 → 48); vista general CPU ×4: 13–14 → 18–21 |
| Abrir el lienzo con la vista guardada | ≤ 1,5 s | lejos 1,6–2,1 → 1,2–1,4 s; de cerca 1,7–2,0 → 1,1–1,3 s; rendimiento-1000 de cerca 1,8 → 1,05 s |
| Lienzo con 1.000 notas y 300 conectores, vista general | ≥ 50 cps | 46–49 → 52–53 cps (antes de esta rama: 43–47, PT-16) |
| Trozo inicial (`index-*.js`) | ≤ 140 KB gzip | 185 → 132 KB gzip (markdown-it y DOMPurify fuera) |
| Kanban a la vista, teléfono emulado (CPU ×4, 4G, sin caché) | ≤ 2,5 s | 3,0–3,2 → 2,8–2,9 s |
| Online, preguntas por novedades con la app quieta | — | 1.188 → 389 por hora (cada una es una ejecución de Vercel) |
| `armar_en_lienzo` (20 objetos, 10 conectores) | — | 89 → 38 consultas (`scripts/contar-consultas.ts`) |
| Trozo del editor de texto (TipTap, `lazy`) | ≤ 130 KB gzip | — |
| Trozo de Diseño, fuera de la carga inicial | ≤ 90 KB gzip | — |
| JavaScript inicial en el teléfono | ≤ 230 KB gzip | 263 antes del plan |
| `render.func` | < 250 MB (límite de Vercel) | 89,7 MB (lo informa `build:vercel`) |

Cómo se logra (y no se rompe): `aNodo` reutiliza el nodo si el elemento es el mismo objeto (rompe el `memo` si no);
`--z` y las clases de zoom se escriben directo al DOM (sin re-render al mover); un solo editor de texto vivo y el resto con
`VistaRica` (render propio, sin `dangerouslySetInnerHTML`); nivel de detalle (`lienzo--lejos`: sin sombras; `--muy-lejos`:
sin texto); `lienzo--moviendo` sin eventos de puntero; `onlyRenderVisibleElements`; imágenes `loading="lazy"`
`decoding="async"`; atajos suscritos una vez; lo pesado con `lazy()` y precargado en `requestIdleCallback`. Y desde la
rama de rendimiento: las notas y formas fuera de la pantalla no se dibujan al abrir (puntos de conexión aproximados,
`sinDibujar` en Lienzo.tsx); las funciones que React Flow le pasa a cada objeto, con identidad fija (`useFija`); nada que
use `motion` con `layoutId` se vuelve a dibujar con el lienzo (memo); el fondo captura el mouse al mover el lienzo (sin
HitTest por movimiento); `contain: paint` solo muy lejos y nunca en lo que dibuja afuera de su caja; la letra automática
arranca de la previsión (5 pruebas en vez de 9). Probado y descartado: `will-change: transform` en el viewport (mucho
peor), `pointer-events: none` en todo al moverse (peor el peor cuadro), dibujar todo sin `onlyRenderVisibleElements`
(4 cps), medir la letra recién al soltar (salto visible), caché del alto de las formas (sin diferencia medible). Antes de
sumar una dependencia: licencia, peso gzip y si se puede hacer en pocas líneas (el resorte propio de `deslizar.ts`
ahorró 8 KB; el service worker propio, 200 paquetes).

## Accesibilidad (mínimos)

Foco visible en todo; recorrido completo con teclado; `role` y `aria-label` en barras, menús, hojas y objetos del lienzo;
diálogos con foco atrapado y devuelto; el color nunca solo (`aria-pressed`, forma, texto); contraste AA verificado por
script; 32 px de blanco en escritorio y 44 en táctil; «reducir movimiento»; zoom del navegador al 200 % sin encimarse;
atajos de una tecla apagables. Detalle en [movimiento e interacción](03-movimiento-e-interaccion.md#teclado-y-foco-escritorio).

## Nombres y comentarios

- **Todo en castellano**: variables, funciones, tipos, archivos, CSS, mensajes (`crearSesion`, `leerSesion`,
  `useSeleccionLienzo`, `.boton-icono--activo`, `EstadoVacio`). Lo que viene de afuera (React, Hono, CSS) queda como es.
  Sin mezclar «getTarjeta».
- **Nombres que dicen lo que son, en el idioma de la interfaz:** si en pantalla dice «Marco», en el código es `marco`, no
  `frame`. Lo mismo en el MCP.
- **Comentario de cabecera en cada archivo**: qué es, qué problema resuelve y por qué así, con la sección del plan
  («(5.8)», «(plan del celular, 3.4)»). Los comentarios dentro del código explican **por qué**, no qué: «La medida que ya
  tenía. Sin ella React Flow toma el nodo nuevo por "sin medir" y lo esconde…».
- **Funciones exportadas con `/** … */`** de una línea que dice qué devuelve.
- **Constantes con nombre y unidad** en vez de números sueltos: `DISTANCIA = 96` (px), `VELOCIDAD = 500` (px/s),
  `ZOOM_LEGIBLE = { min: 0.9, max: 1.4 }`.
- **TypeScript estricto** (`strict`, `verbatimModuleSyntax`, `isolatedModules`). Sin `any` salvo en el borde con
  bibliotecas, y comentado.
- **Formato:** 2 espacios, comillas simples, sin punto y coma, líneas de hasta ~130 caracteres (como el resto del repo).
  No reformatear archivos que no se tocan.

## Commits

Mirá `git log`: cada mensaje es documentación. El estilo:

- **Título en castellano, en el idioma del dueño, que dice qué cambió para quien usa la app:** «Lienzo en el celular: el
  teclado ya no se abre y se cierra solo», «Celular: la barra de abajo sin "Más"; el menú pasa a la cabecera». Prefijo
  con el área (`Lienzo:`, `Celular:`, `MCP:`, `Diseño:`, `PWA:`) o con el paquete del plan (`PT-5 · Barra contextual
  única`).
- **Cuerpo:** el problema como se vio, la causa y la decisión con su porqué, en viñetas; medidas cuando las hay («40 px de
  alto, medido con 19 % y 240 %»); qué se probó y cómo («se reprodujo con toques reales (CDP)»).
- **Un tema por commit.** Si hay dos arreglos, dos commits.
- **Al final**, las líneas de atribución que pida la sesión (por ejemplo `Co-Authored-By:` del modelo). Nunca claves.
- **Merges** con título que resume la rama: «Merge branch 'movil-arreglos-2': Menú arriba, barra de 5, …».
