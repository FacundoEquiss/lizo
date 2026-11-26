# 7. Cómo se prueba y se verifica

**Terminado es probado y mirado.** «Compila» no es terminado. «Lo probé en la PC» no alcanza para algo del celular. Y
siempre, al entregar, se dice qué no se probó.

## Siempre, antes de cada commit

```bash
npm run typecheck          # tsc estricto sobre servidor, web y compartido
npm run build              # vite build; mirá el peso de los trozos que tocaste
```

Si tocaste el servidor o el empaquetado: `npm run build:vercel` (arma `.vercel/output`, informa el peso de `render.func`).
No publica nada.

## Levantar un Telar de prueba

Nunca contra la `.datos/` del dueño ni contra producción. Base y puertos propios:

```bash
TABLERO_DATOS=/tmp/telar-prueba TABLERO_PUERTO=4338 TABLERO_PUERTO_WEB=4337 TABLERO_SEMILLA_DISCORD=no npm run dev
node scripts/sembrar-lienzo.mjs --url http://127.0.0.1:4338 --demo     # datos de las capturas
```

Todos los scripts de prueba **se niegan** si la dirección no es `127.0.0.1` o `localhost`. Si escribís uno nuevo, también.

## Según lo que tocaste

| Tocaste | Prueba | Qué mirar |
|---|---|---|
| MCP, servicio, `compartido/` | `node scripts/probar-mcp.mjs` (HTTP) y `--stdio` | Arma un lienzo con todo en un proyecto de prueba, lo cambia, lo lee de vuelta, prueba los **errores** y la guía, y lo archiva. Con `--dejar` queda a la vista para una captura |
| OAuth (ChatGPT, claude.ai) | `npm run oauth:probar` | Levanta su propio Telar local (`TABLERO_PUBLICO=1`) y hace el baile completo con PKCE: descubrir, registrar, autorizar, canjear, usar el MCP, refrescar, y lo que tiene que fallar (aud, vencido, firma, código reusado, verifier, redirect, refresh reusado). La clave de siempre sigue andando |
| Cuentas y aislamiento (servicio, rutas, herramientas MCP, eventos, archivos, sesión) | `npm run cuentas:probar` (~5 min; `--sin-base-vieja` salta el paso con git; `--solo-amigos` solo las invitaciones) | Registro, entrar, límites, suspender, cambiar la contraseña, topes; una base de antes de la migración queda toda de `dueno`; y B intenta **todo** sobre lo de A: cada ruta (la lista sale del código, una ruta nueva sin caso hace fallar la prueba), cada herramienta MCP por id y por nombre, eventos en vivo, búsqueda, archivos, dibujos de Diseño y OAuth. Cada intento: 401/403/404, igual que con un id que no existe, sin una palabra de la otra cuenta y sin cambiar nada. Lo que da permiso (invitar, revocar, suspender, el tope de amigos) pide la sesión del dueño: la clave del MCP, otra cuenta y un token de OAuth dan 403/401. Invitaciones por enlace: canje, doble canje y carrera (una cuenta por cada uso), vencida, revocada, inventada y alterada con la misma respuesta, límite por IP, tope, suspender, el token en claro ausente de la base y de la salida del servidor |
| Amigos e invitaciones (servicio, migración y pantalla) | `npm run amigos:probar` (PGlite en memoria, ~30 s) y `NODE_PATH=$(npm root -g) node scripts/probar-amigos-ui.cjs` (Playwright, PC y celular, claro y oscuro) | La migración repetible y sin esquema, el token solo en el enlace, canjes en carrera, tope, 20 pendientes; en pantalla: invitar, copiar, abrir el enlace sin sesión, registrarse, suspender, revocar, tope, 0 controles táctiles de menos de 44 px y consola limpia |
| Recuperar la contraseña sin correo (servicio, migración y pantallas) | `npm run recuperacion:probar` (PGlite en memoria, ~30 s), `npm run cuentas:probar -- --solo-recuperacion` (~15 s, con un Telar de verdad) y `NODE_PATH=$(npm root -g) node scripts/probar-recuperacion-ui.cjs` (Playwright, PC y celular, claro y oscuro) | Códigos de 60 bits con solo hash en la base, mismo mensaje y estado para todo lo que no sirve, carrera de seis usos del mismo código, límites por mail y por IP, enlace del dueño solo con su sesión (403 con la clave del MCP, un amigo y OAuth), un solo uso, 24 horas, cancelar y reemplazar; el dueño no ve la contraseña; ningún token ni código en claro en la base ni en la salida del servidor; en pantalla: «Guardá estos códigos» (copiar, descargar, casilla obligatoria), «Olvidé mi contraseña», «Quedan pocos», generar nuevos, el camino del dueño, 44 px y consola limpia |
| Tablas y gráficos | `npm run tabla:probar` | El modelo sin base: valores por tipo, cada operación con su deshacer, topes, pegar de Excel y CSV, gráficos desde una tabla |
| Diseño | `npm run diseno:probar-mcp` (< 60 s), `npm run diseno:probar-sanear`, `npm run diseno:ver -- --proyecto X --marco <id>` | Sanear: HTML y CSS maliciosos no pasan |
| La guía | `npm run guia -- --verificar` | Que `docs/guia-para-ias.md` no quedó vieja |
| Colores | `node scripts/contraste.mjs` | AA en los dos temas; grises del oscuro neutros |
| Íconos, manifest, PWA | `npm run pwa:verificar`, `npm run pwa:revisar` | Colores al día con `tokens.css`; lista de control de la PWA |
| Escritorio visible | `node scripts/capturas-escritorio.cjs` | 1440 × 900, claro y oscuro |
| Celular | `node scripts/capturas-movil.mjs` (`--solo=04,16`, `--dispositivos=iphone15,pixel8,iphone15h`, `--temas=claro`, `--escritorio=antes\|despues`) | Cuenta controles de menos de 44 px (meta 0). **El paso 30 falla desde antes** (campo de foto oculto en «Nuevo proyecto»): no es tuyo, pero decilo |
| Kanban: agregar tarjeta | `node scripts/sembrar-kanban.mjs` y `node scripts/probar-kanban-agregar.cjs [--capturas docs/capturas/kanban-agregar]` | Pie a la vista con 64 tarjetas, encabezado alineado, teclado, tipo/prioridad/etiquetas/motivo, error con «Reintentar», arrastrar después de usarlo, celular, consola limpia |
| La IA integrada en la web | `node scripts/probar-ia-ui.cjs --falso <servidor de mentira>` o `TELAR_IA_REAL=1` (`--capturas docs/capturas/ia-f1`; `--antes <web vieja>` para las capturas de antes) | Recorrido de la F1 en PC, iPhone 15 y Pixel 8, claro y oscuro, con el teclado de Android emulado: lista y chips de menciones, pastillas, campana +1, bandeja y hoja, «Responder» y la cita, estados (cargando, error, vacío, 404), preferencias y alias; cuenta controles táctiles de menos de 44 px y que la consola quede limpia |
| La IA integrada en la web, F2 (Configuración → IA y trabajos de los agentes) | `node scripts/probar-ia-ui-f2.cjs --web <web> [--github <url>]` (Telar local con `TABLERO_IA_FALSO=1`; `--capturas docs/capturas/ia-f2`; `--antes <web de la F1>` para las capturas de antes; `TELAR_IA_REAL=1` exige el probador de claves y el catálogo de modelos) | Carga de una clave falsa que no vuelve a verse en ningún lado, un agente creado paso a paso y cambiado, pausa y tope, «Código (GitHub)» (con el GitHub de mentira de `scripts/github-falso.mjs`), todos los estados (cargando, error, sin rutas, vacío, clave que no anda, en el tope, solo lectura), el hilo (pensando, Frenar, permiso con Permitir / No y desde la campana, pie, tope y «Subir el tope», fallo con Reintentar, mención que espera), el sondeo con `ia=1`, PC / iPhone 15 / Pixel 8 en claro y oscuro, controles táctiles de menos de 44 px y consola limpia. **El servidor deja 30 trabajos y 10 pruebas de clave por hora y por cuenta** y una combinación gasta ~12 y 2 (la de PC en claro, ~16 y ~6): se corre de a una (`--solo=pc-claro`…) con una base nueva cada vez |
| Vistas de un tablero (tipo al crear, pestañas, «Vistas…») | `npm run vistas:probar` (servicio y MCP, sin red) y `node scripts/probar-vistas-ui.cjs --web <Telar local> --solo=pc-claro` (`--capturas docs/capturas/vistas-tablero`) | Un tablero de cada tipo sin crear de más (un diagrama no trae listas, uno de Diseño tampoco ni un sistema nuevo), los viejos con las tres, errores que dicen cómo sumar la vista, sacar y devolver sin perder nada, otra cuenta 404; en pantalla: cuatro opciones con «Tablero» de fábrica y la línea de Diseño, sin pestañas con una sola vista, la dirección de una vista que falta redirige, sumar y sacar desde «⋯ → Vistas…» (con pregunta si hay contenido), la barra de abajo del celular, 44 px y consola limpia. **Una base nueva por combinación** (crea tableros con nombre fijo) |
| Hecho (archivo automático, «Ver N anteriores») | `npm run hecho:probar` (servidor, PGlite en memoria, fechas simuladas) y `node scripts/probar-kanban-hecho.cjs` + `scripts/sembrar-hecho.ts` (100 tarjetas en Hecho; instrucciones en la cabecera) | Solo se archiva lo viejo y solo en Hecho, checklist y vínculos, la opción, por cuenta, una vez por hora, avisos sin duplicar, restaurar, abrir sin migración, `leer_tablero` paginado; en pantalla: se ven 20, «Ver N anteriores» de a 20, el pie fijo, filtro sobre todas, arrastrar/agregar/atajo la dejan arriba, la opción (PC y celular, claro y oscuro), 44 px y consola limpia |
| Lienzo (rendimiento) | `node scripts/sembrar-lienzo.mjs --parecido-rc` (como el «Pendientes» de RC; o `--cantidad 1000 --conectores 300`) + `node scripts/medir-lienzo.cjs --tablero parecido-rc --corridas 3` (y `--cpu 4`) | Por nivel de zoom (vista general, lejos, de cerca): cuadros por segundo, peor cuadro y **trabajo del hilo principal por cuadro** (el número estable para comparar), antes y después |
| Consultas a la base | `npx tsx scripts/contar-consultas.ts --datos <copia de la carpeta de datos>` | Consultas y ms por pedido en las rutas calientes (abrir el tablero, leer_lienzo, armar_en_lienzo): que no aparezca un N+1 |

Playwright no es dependencia del repo: los scripts lo toman del entorno de pruebas (`NODE_PATH=$(npm root -g)` si hace
falta).

## Capturas: cómo se miran

- **Los dos temas** si cambia algo visible. **Escritorio 1440 × 900** y **celular** (iPhone 15 vertical y horizontal,
  Pixel 8) si la pieza existe en los dos.
- **Antes y después** de lo mismo, con los mismos datos. Para el Kanban, comparar contra la base (es lo que no se rompe).
- **Mirarlas de verdad**: alineación, cortes, texto que desborda, sombras, contraste, foco visible, que nada tape nada.
  Lo que se ve feo se arregla aunque no esté en el pedido, si es del mismo tema.
- Lo que se mueve no se ve en una captura fija: una tira de cuadros o un video corto (el plan de escritorio lo pedía para
  el aviso, la nota arrastrándose, el conector y «Crear y conectar»).
- Las capturas que van al repo, en `docs/capturas/` con nombre que dice qué muestran. **Nunca** las que tienen material de
  Restaurant City (`docs/capturas/diseno/rc-*` está en `.gitignore`).

## Reproducir antes de arreglar

- **Toques reales** por CDP (`Input.dispatchTouchEvent`), no clics, para cualquier cosa táctil.
- **Teclado de Android emulado:** achicar la ventana (resizes-content) mientras se escribe.
- **Red lenta y servidor lento** (como online): muchos errores aparecen solo cuando la respuesta llega mientras el usuario
  hace otra cosa.
- **La IA cambiando lo mismo** que el usuario (un `probar-mcp` en paralelo).
- **CPU × 4** para el celular de gama baja (`capturas-movil.mjs --rendimiento`).

## Medir antes de dar por hecho

Cada afirmación del informe que tenga un número sale de una medición: «40 px con 19 % y 240 %», «43–47 cps con 1.000
objetos», «~8 KB menos al arranque». Si no se midió, se dice «no medido». Los presupuestos están en
[arquitectura](06-arquitectura-y-codigo.md#rendimiento-presupuestos-medidos).

## Lo que no se puede probar acá

Un teléfono de verdad (teclados reales de Android e iOS, franja de autocompletar, háptica, «atrás» del sistema, instalar
la PWA), producción con datos reales, y cualquier cosa que gaste plata. Se dice en el informe, explícito:
«No probado en un iPhone real».

## Producción

- Lo online se prueba **después** de publicar y con permiso: abrir https://telarapp.vercel.app, `/api/salud` (versión), y
  una llamada de lectura por MCP (`listar_proyectos`). **Nada de pruebas que escriban en el proyecto RC** del dueño: si
  hace falta escribir, en un proyecto de prueba que después se archiva.
- Nunca imprimir la clave del MCP ni la respuesta de `/api/info` (la trae).
