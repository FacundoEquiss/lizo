# Cuentas propias de Telar

Pedido del dueño: «cada cuenta tiene su base propia, no ve ni edita ningún otro proyecto de otra cuenta y se registra con
su correo, su nombre y su contraseña propio».

## Cómo funciona (en corto)

- **Crear cuenta, abierta con aprobación del dueño** (decisión del dueño, diciembre): en la pantalla de Entrar, «Crear cuenta» está siempre a la
  vista y pide nombre, mail y contraseña (10 caracteres o más), **sin enlace ni código**. La cuenta nace `pendiente`: no entra a nada (ni a la
  API, ni al MCP, ni a OAuth, ni a los eventos, ni a los archivos) hasta que el dueño la aprueba en Configuración → Amigos → Solicitudes; se
  muestran sus 8 códigos de recuperación y «Tu cuenta espera la aprobación de <dueño>». Ver «Crear cuenta con aprobación» abajo.
- **Crear cuenta, por invitación** (desde diciembre): el dueño genera un **enlace** desde Configuración → Amigos
  (`https://<la web>/unirse/<token>`), se lo pasa a su amigo y listo: sin cargar variables ni volver a publicar. La pantalla del
  enlace dice «<dueño> te invitó a Telar» y pide nombre, mail y contraseña (10 caracteres o más, sin las más usadas); al crear la
  cuenta el amigo queda con la sesión abierta y entra a su Telar vacío. **Quien entra con una invitación queda aprobado al instante** (cuenta `activa`,
  sin pasar por solicitud: el enlace ya es la aprobación del dueño). Ver «Amigos e invitaciones» abajo.
- **Por código (compatibilidad):** si el dueño dejó cargada la variable `TABLERO_INVITACION`, `POST /api/cuentas` con ese código crea la cuenta
  activa, como antes (la pantalla de Entrar ya no tiene ese campo). Ya no hace falta cargarla: se puede borrar.
- Así nadie llena la base (que cuesta plata) ni entra sin que el dueño lo sepa: una solicitud no entra a nada hasta que la aprueba, hay un tope de
  30 solicitudes a la vez, un límite de pedidos por IP y un tope de cuentas de amigos que se mira al aprobar.
- **Entrar**: el mismo formulario para las dos clases de cuenta. Primero se busca una cuenta de Telar con ese mail; si no
  hay (o la contraseña no es la suya) se prueba, como siempre, con las cuentas del juego de `TABLERO_USUARIOS`. Así el
  dueño entra aunque alguien registre su mail. El código por mail sigue solo para la cuenta del juego.
- **La cuenta `dueno`** es la de siempre: la del juego (`TABLERO_USUARIOS`) y la clave del MCP (`TABLERO_CLAVE`, la de
  Claude Code y `.mcp.json`). Todo lo que existía antes es suyo (la migración lo rellena). No tiene topes.
- **Cada cuenta nueva** arranca vacía, con su propio miembro «yo» (el nombre del registro). Las IA que escriben por su
  conexión OAuth quedan como miembros de ESA cuenta.
- **Sesión**: la cookie firmada de 30 días de siempre. El usuario es `t:<id>:<versión>` para las cuentas de Telar (el de
  las cuentas del juego no cambió: las sesiones abiertas siguen andando). En cada pedido se mira que la cuenta exista, esté
  activa (`puedeEntrar`: solo `activa`; ni `suspendida`, ni `pendiente`, ni `rechazada`) y que la versión de sesión sea la vigente.
- **Perfil** (Configuración → Cuenta; en el celular, Menú → Mi perfil): el nombre es el de la cuenta, se ve el mail,
  «Cambiar contraseña» (pide la actual; cierra las otras sesiones), los **códigos de recuperación** (cuántos quedan y «Generar
  códigos nuevos») y lo que usa de sus topes.
- **Si se olvida la contraseña** (no hay servicio de mail): dos caminos sin correo. (1) Con uno de los 8 códigos de recuperación que se
  mostraron al crear la cuenta: «¿Olvidaste tu contraseña?» en Entrar. (2) Con un enlace de un solo uso que le genera el dueño desde
  Configuración → Amigos → «Restablecer contraseña». Ver «Recuperar la contraseña sin correo» abajo. La cuenta del dueño no cambia: entra
  con la cuenta del juego (código por mail del juego).
- **Conectar una IA**: ChatGPT, claude.ai o Claude Code con «Permitir» (OAuth). El token queda atado a la cuenta que
  permitió y el MCP corre con el alcance de esa cuenta. La clave del MCP se le muestra solo al dueño (le daría todo lo
  suyo a cualquiera).
- **Local** (sin `TABLERO_PUBLICO`): todo sigue como antes, una sola persona, sin login: todo es de `dueno`.

## Seguridad de las contraseñas

- scrypt de `node:crypto` (N = 2^15, r = 8, p = 1; 32 MB, ~100 ms) con sal propia de 16 bytes: `scrypt$N$r$p$sal$hash`.
- La contraseña nunca se registra, nunca se devuelve y nunca va a un log. Comparaciones de tiempo constante
  (`timingSafeEqual`); un mail que no existe hace la misma cuenta contra un hash cualquiera (tarda lo mismo).
- El mismo mensaje para «mail inexistente» y «contraseña mala» («Mail o contraseña incorrectos.»).
- Límite de intentos en la tabla `intentos` (Vercel no guarda memoria entre pedidos), con el mail y la IP guardados como
  hash: entrar, 8 fallidos por mail y 30 por IP cada 15 minutos; registrarse (por código o por enlace), 8 por IP por hora; pedir una cuenta sin enlace (`solicitud:ip`), 5 por IP por hora (cada pedido válido cuenta); enlaces de
  invitación que no sirven, 15 por IP por hora (se pregunte o se canjee); cambiar la contraseña, 8 por cuenta cada 15 minutos; códigos de
  recuperación que no sirven, 8 por mail cada 15 minutos y 30 por IP cada 15 minutos; enlaces de restablecimiento que no sirven, 15 por IP por
  hora. Pasado el límite: «Demasiados intentos. Esperá unos minutos y probá de nuevo.» (429).
- Registrarse (o pedir una cuenta) con un mail que ya existe dice «Ya hay una cuenta con ese mail» (no hay forma de evitarlo sin verificar el
  mail por correo; está detrás del límite por IP). Es el mismo mensaje sea la cuenta activa, pendiente o rechazada: no se cuenta cuál.

## Cómo se aísla (la decisión de arquitectura)

1. **Propiedad en la raíz**: `proyectos.propietario`; también `miembros`, `actividad`, `eventos` y `archivos` (lo que no
   cuelga de un proyecto). Todo lo demás llega a su cuenta por su proyecto.
2. **El alcance lo pone un solo lugar**: el middleware de alcance de `api.ts` (cookie → la cuenta de la sesión; clave del
   MCP → `dueno`; local → `dueno`) y, en `/mcp`, el token OAuth (→ la cuenta que lo permitió). Va por `AsyncLocalStorage`:
   el cliente no lo puede falsificar.
3. **El Servicio es SIEMPRE el de una cuenta**: `servicio.de(cuenta)`. El de la raíz no tiene cuenta y cualquier consulta
   con dueño tira error (`this.cuenta`). En `api.ts`, `servicio()` sin alcance da 401. No hay forma de consultar sin saber
   de quién es el pedido. (La tarea pedía la cuenta en el `Ctx`; la pusimos en el Servicio porque muchas lecturas no reciben
   `Ctx`: así no queda ninguna sin chequeo.)
4. **Todo id se verifica antes de leer o escribir**: `propio(tipo, id)` / `propios(tipo, ids)` siguen un camino SQL fijo
   por tipo hasta el proyecto y su `propietario` (`CAMINO_PROPIO` en `servicio.ts`), o un resolutor que filtra por
   propietario en SQL (`resolverProyecto`, `resolverTablero`, `resolverTarjeta`, `tableroPropio`, `tarjetaDeChecklist`).
   `resolverTablero(ref, proyecto, { vista })` (las vistas de un tablero, `compartido/vistas.ts`) filtra por propietario igual y además
   exige que el tablero tenga esa vista: el error que da nombra solo el tablero que la persona ya nombró.
   `resumenes()` (todas las listas de tarjetas) agrega el filtro siempre. Lo ajeno da **404 con el mismo mensaje** que lo
   que no existe.
5. **El bus de eventos y el almacén también son de la cuenta**: lo que publica el Servicio sale marcado con su cuenta y
   SSE y `/api/eventos/desde` entregan solo los de la cuenta del pedido; los archivos de una cuenta nueva van a
   `c/<cuenta>/…` con las mismas rutas y direcciones de siempre (`/archivos/lienzo/x.png`): la misma dirección en otra
   cuenta es otro archivo (404). `dueno` sigue en la raíz (nada se movió) y no puede leer `c/…`.
6. **Diseño**: cada método del ServicioDiseno que recibe `pid` lo verifica primero (`pidPropio`). Un marco solo puede
   dibujar archivos de su cuenta: el render lee del almacén de la cuenta y el dibujo interno de Vercel (`render-interno`)
   lleva la cuenta firmada con `TABLERO_SECRETO` (la clave del MCP sola no alcanza para firmarla).
7. **Sin RLS de Postgres** (el pooler de Supabase en modo transacción no sostiene variables de sesión).
8. **Lo que choca con un id ajeno**: los «deshacer» del lienzo recrean un objeto o un conector por su id; solo reviven uno
   del mismo tablero (antes, mandar el id de un objeto ajeno pisaba sus datos). Un id usado en otro lado da 409 «Ese id ya
   se usa: creá el objeto sin id.» (no cuenta de quién es).

## Inventario de puntos de entrada y su chequeo

Leyenda: **alcance** = el pedido corre con el Servicio de su cuenta (nadie consulta sin él). **propio(x)** = verificación
explícita del id con el camino a su proyecto. **resolutor** = búsqueda por id o nombre filtrada por propietario en SQL.
**clave** = solo con la clave del MCP (= `dueno`). Todo lo de esta lista lo recorre `npm run cuentas:probar` (la lista de
rutas sale del código: una ruta nueva sin caso hace fallar la prueba).

### API web (`servidor/src/api.ts` y, para recuperar la contraseña, `servidor/src/recuperacion-rutas.ts`)

| Ruta | Chequeo |
|---|---|
| `GET /api/salud` | pública (sin datos) |
| `GET /api/sesion` | pública; dice si hay sesión, `registro` (online siempre `true`: crear una cuenta está abierto; queda por compatibilidad), si es la sesión del dueño (`amigos`: solo ahí se muestra Configuración → Amigos) y, solo para esa sesión, cuántas solicitudes esperan (`solicitudes`: la marca con el número) |
| `POST /api/sesion` | entrar: límite por mail e IP; cuenta de Telar y después la del juego. Solo con mail y contraseña CORRECTOS: una cuenta `pendiente` oye 403 «Tu cuenta todavía espera la aprobación de <dueño>»; una `suspendida`, 403 «suspendida»; una `rechazada`, mal mail o mala contraseña, lo mismo de siempre (401 «Mail o contraseña incorrectos.», idéntico) |
| `POST /api/sesion/codigo` | código por mail del juego (Supabase, como antes) |
| `POST /api/solicitudes` | pública; pedir una cuenta SIN enlace ni código: nombre, mail y contraseña; límite de 5 por IP por hora y tope de 30 pendientes (más: 429 «Ahora no se aceptan más solicitudes. Probá más tarde.» y aviso en la campana, uno por día); la cuenta nace `pendiente` (no abre sesión); devuelve sus 8 códigos de recuperación (una sola vez, `no-store`) y el nombre de quien aprueba; avisa en la campana del dueño «<nombre> pidió una cuenta» (enlace a Amigos). Mail repetido (activa, pendiente o rechazada): el mismo 409 |
| `POST /api/cuentas` | registrarse con el código de `TABLERO_INVITACION` (compatibilidad): límite por IP, tope de amigos; crea la cuenta y su «yo» y devuelve sus 8 códigos de recuperación (`codigos`, una sola vez, `no-store`; `null` si no se pudieron generar) |
| `GET /api/cuenta` | alcance (la propia) |
| `POST /api/cuenta/clave` | alcance; solo sesión de una cuenta de Telar; pide la actual; deja sin efecto un restablecimiento pendiente |
| `GET /api/cuenta/codigos` | alcance; cuántos códigos de recuperación le quedan a la cuenta de la sesión (nunca los códigos); la clave del MCP y la cuenta del dueño reciben `{ aplica: false }` |
| `POST /api/cuenta/codigos` | **solo sesión** de una cuenta de Telar (la clave del MCP: 403; la cuenta del dueño: 400); pide la contraseña actual (mismo límite que cambiarla); deja sin efecto los anteriores y devuelve los 8 nuevos una sola vez (`no-store`) |
| `POST /api/recuperar` | pública; mail + código de recuperación + contraseña nueva; límite por mail (8 cada 15 min) y por IP (30 cada 15 min); mail inexistente, código malo, usado, de otra cuenta, la cuenta del dueño o **una solicitud rechazada** contestan **igual** (401); gasta ese código, sube la versión de sesión y deja la sesión abierta; a una cuenta `pendiente` le cambia la contraseña pero **no le abre la sesión** (`{ pendiente: true }`) |
| `POST /api/restablecer/ver`, `POST /api/restablecer` | públicas; el token (32 bytes) va en el cuerpo; el enlace sirve una vez, vence a las 24 h, no sirve si está cancelado o la cuenta está suspendida; todo lo que no sirve contesta el mismo 404; límite de 15 enlaces que no sirven por hora y por IP. `restablecer` pone la contraseña nueva (la elige quien abre el enlace), cierra las otras sesiones, deja 8 códigos nuevos y avisa al dueño en la campana |
| `DELETE /api/sesion` | borra la cookie |
| `GET /api/info` | alcance; la clave del MCP solo si la cuenta es `dueno` |
| `POST /api/herramientas/:nombre` | clave (puente de `npm run mcp`) → `dueno` |
| `POST /api/importar/discord`, `/importar/archivo`, `/importar/discord-json` | clave → `dueno` (el importador es solo del dueño) |
| `GET /api/eventos/desde`, `GET /api/eventos` | alcance; solo los eventos de la cuenta |
| `GET /api/proyectos` | alcance; `listarProyectos` filtra por propietario |
| `POST /api/proyectos` | alcance; prefijo único por cuenta; tope de 20 |
| `PATCH /api/proyectos/:id` | propio(proyecto) |
| `POST /api/proyectos/:id/imagen` | propio(proyecto) antes de guardar; archivo en la carpeta de la cuenta |
| `GET /api/miembros` | alcance; filtra por propietario; completa el alias de los miembros que no lo tengan (los de antes de la migración); a los que son agentes de la IA les suma `agente` (modo, estado y modelo: `iaDe(servicio).conResumenDeAgentes`, todo por `propietario`) |
| `PATCH /api/miembros/:id` | propio(miembro); si es «yo», cambia también el nombre de la cuenta; el alias tiene que ser válido, no reservado y único en la cuenta (409) |
| `POST /api/proyectos/:id/etiquetas` | propio(proyecto) |
| `PATCH /api/etiquetas/:id`, `DELETE /api/etiquetas/:id` | propio(etiqueta) |
| `POST /api/tableros` | propio(proyecto); `tipo`/`vistas` solo describen el tablero nuevo (del proyecto propio) |
| `GET /api/tableros/:id` | tableroPropio |
| `PATCH /api/tableros/:id` | tableroPropio; `vistas` también (otra cuenta: 404 y nada cambia) |
| `GET /api/tableros/:id/archivadas` | propio(tablero) + `resumenes` filtrado |
| `GET /api/tableros/:id/actividad` | propio(tablero) + actividad por propietario |
| `POST /api/listas` | tableroPropio |
| `PATCH /api/listas/:id` | propio(lista) |
| `POST /api/tarjetas` | tableroPropio; la lista tiene que ser de ese tablero; padre por resolutor; responsables entre los miembros de la cuenta |
| `GET /api/tarjetas/:ref` | resolutor (id o clave, filtrado) |
| `PATCH /api/tarjetas/:ref` | resolutor; padre por resolutor; responsables de la cuenta |
| `POST /api/tarjetas/:ref/mover` | resolutor + propio(lista destino) |
| `POST /api/tarjetas/:ref/archivar` | resolutor |
| `POST /api/tarjetas/:ref/copiar` | resolutor; lista destino del mismo tablero |
| `PUT /api/tarjetas/:ref/porque` | resolutor; «reemplazada por» por resolutor |
| `POST /api/tarjetas/:ref/comentarios` | resolutor; `id` propio (repetirlo devuelve el comentario que estaba; si es de otra tarjeta o cuenta, 409); `respondeA` tiene que ser un comentario de esa tarjeta (si no, 404); las menciones se resuelven solo entre los miembros de la cuenta |
| `PATCH /api/comentarios/:id`, `DELETE /api/comentarios/:id` | propio(comentario) |
| `POST /api/tarjetas/:ref/checklists` | resolutor |
| `PATCH /api/checklists/:id`, `DELETE /api/checklists/:id`, `POST /api/checklists/:id/items` | tarjetaDeChecklist (filtrada) |
| `PATCH /api/items/:id` | propio(item); el responsable, propio(miembro) |
| `DELETE /api/items/:id`, `POST /api/items/:id/convertir` | propio(item) |
| `POST /api/tarjetas/:ref/adjuntos` | resolutor; archivo en la carpeta de la cuenta; tope de 200 MB |
| `DELETE /api/adjuntos/:id` | propio(adjunto) |
| `POST /api/tarjetas/:ref/enlaces` | resolutor |
| `DELETE /api/enlaces/:id` | propio(enlace) |
| `POST /api/tarjetas/:ref/vinculos` | resolutor en las dos tarjetas |
| `DELETE /api/vinculos/:id` | propio(vinculo) |
| `POST /api/tableros/:id/elementos` | tableroPropio; tarjeta y lista de ese tablero; un id ya usado, solo del mismo tablero; tope de objetos |
| `PATCH /api/elementos/:id/tabla` | propio(elemento) |
| `PATCH /api/elementos` | propios(elemento) (todos o ninguno) |
| `POST /api/elementos/eliminar` | propios(elemento) |
| `POST /api/elementos/convertir` | propio(elemento); la lista, del mismo tablero |
| `POST /api/elementos/restaurar` | propios(elemento) y propios(conector) |
| `POST /api/tableros/:id/conectores` | tableroPropio; los extremos, de ese tablero; un id ya usado, solo del mismo tablero |
| `PATCH /api/conectores/:id` | propio(conector); extremos nuevos del mismo tablero |
| `POST /api/conectores/eliminar` | propios(conector) |
| `POST /api/archivos` | alcance; carpeta de la cuenta; 4 MB por archivo y tope de 200 MB |
| `GET /api/buscar` | alcance; `resumenes` filtrado; `proyecto`/`tablero` ajenos → propio (404) |
| `GET /archivos/*` | almacén de la cuenta (otra carpeta: 404); `dueno` no lee `c/…` |
| `ALL /mcp` | clave → `dueno`; OAuth → la cuenta del token (existente y activa) |

### Amigos e invitaciones (`servidor/src/amigos-rutas.ts` y `amigos.ts`, montado en `/api`)

Lo que da permiso (invitar, revocar, suspender, reactivar, el tope) pide la **SESIÓN del dueño** (`dueno` entrando por la web, no la
clave del MCP ni un token de OAuth ni otra cuenta): con la clave del MCP o con la sesión de un amigo da 403, sin sesión 401. Lo único que
el dueño ve de un amigo es lo que decide a quién dejar entrar (mail, nombre, fechas, cuántos proyectos y cuánto espacio): nada de lo que
tiene adentro. Corren con `raiz().db` y `raiz().de(cuenta).almacen.usado('')` solo para sumar bytes.

| Ruta | Chequeo |
|---|---|
| `GET /api/amigos` | sesión del dueño; solicitudes (pendientes y rechazadas: nombre, mail, fechas, nada más), invitaciones (nunca el token ni su hash), amigos con cuenta y topes en una sola lectura; de cada amigo, si tiene un restablecimiento pendiente (sin token ni hash) y cuándo y por qué camino se le cambió la contraseña la última vez |
| `POST /api/amigos/invitaciones` | sesión del dueño; nota (hasta 60), 1/5/10 usos, vence en 1/7/30 días (de fábrica 1 uso y 7 días); hasta 20 pendientes (una sola sentencia: también si llegan juntas). Devuelve `enlace` UNA vez (`Cache-Control: no-store`) |
| `POST /api/amigos/invitaciones/:id/revocar` | sesión del dueño; `propietario` en SQL (404 si no existe o es de otra cuenta); repetirla no cambia nada |
| `POST /api/amigos/:id/estado` | sesión del dueño; suspende o reactiva a un amigo (la sesión, el token de OAuth y su refresco se cortan en el próximo pedido); la cuenta del dueño no se toca (400), una inexistente da 404 |
| `PUT /api/amigos/ajustes` | sesión del dueño; el tope de cuentas de amigos, entero de 1 a 100 (de fábrica 15) |
| `POST /api/amigos/:id/restablecer` | **sesión del dueño** (la clave del MCP, OAuth y un amigo: 403/401); genera el enlace de restablecimiento de un amigo (un solo uso, 24 h; reemplaza al pendiente). 404 si la cuenta no existe, 400 si es la del dueño (o no tiene contraseña de Telar), 409 si está suspendida. Devuelve `enlace` UNA vez (`Cache-Control: no-store`) |
| `POST /api/amigos/:id/restablecer/cancelar` | sesión del dueño; el enlace pendiente deja de servir (404 si no había) |
| `POST /api/amigos/:id/aprobar` | **sesión del dueño** (la clave del MCP y un amigo: 403; OAuth y sin sesión: 401); `pendiente` → `activa` en una transacción con la fila del dueño trabada: cuenta contra el tope de amigos (las solicitudes no cuentan; con el tope lleno 409 «es el tope», sin aprobar); le crea su miembro «yo». 404 si no existe (o es la del dueño), 409 si ya no es una solicitud pendiente (una rechazada se «reconsidera» primero) |
| `POST /api/amigos/:id/rechazar` | sesión del dueño; `pendiente` → `rechazada` (no entra; su mail queda ocupado 7 días); 404/409 como la anterior |
| `POST /api/amigos/:id/reconsiderar` | sesión del dueño; `rechazada` → `pendiente`; 404/409 como la anterior |
| `POST /api/amigos/solicitudes/limpiar` | sesión del dueño; borra DE VERDAD las solicitudes de más de 30 días (pendientes sin responder y rechazadas), solo cuentas sin proyectos ni miembros, con sus códigos de recuperación y enlaces; devuelve cuántas. Es lo único que Telar borra de verdad |
| `POST /api/unirse/ver` | pública; el token va en el cuerpo. Dice quién invita si el enlace sirve; si no, siempre el mismo 404. Límite de 15 enlaces que no sirven por hora y por IP |
| `POST /api/unirse` | pública; canje + alta en UNA transacción (ver abajo; la cuenta nace `activa`: aprobada al instante); nombre, mail y contraseña con las reglas de siempre. Deja la sesión abierta y devuelve sus 8 códigos de recuperación (`codigos`, una sola vez, `no-store`) |

### Novedades, notificaciones y menciones (`servidor/src/ia/rutas.ts`, montado en `/api`)

Corren con el Servicio de la cuenta del pedido (`iaDe(servicio)`): toda consulta lleva `propietario = cuenta`. Las
notificaciones son del miembro «yo» de la cuenta; un id ajeno da 404 con el mismo mensaje que uno que no existe.

| Ruta | Chequeo |
|---|---|
| `GET /api/novedades` | alcance; las notificaciones y las no leídas del miembro «yo» de la cuenta; la primera vez que la cuenta la pide levanta las menciones que ya estaban escritas (marca en `cuentas.menciones_levantadas_en`) |
| `GET /api/notificaciones` | alcance; `propietario` y `para_id` (el «yo» de la cuenta) |
| `POST /api/notificaciones/leer` | `propietario` y `para_id`; todos los ids tienen que ser de ese miembro (si no, 404 y no marca ninguno) |
| `GET /api/notificaciones/preferencias`, `PUT /api/notificaciones/preferencias` | el miembro «yo» de la cuenta; solo tipos conocidos, true o false |
| `POST /api/ia/menciones/levantar` | alcance; solo con sesión (o local): la clave del MCP da 403; recorre únicamente los comentarios de la cuenta |
| `GET /api/ia/trabajos`, `GET /api/ia/trabajos/:id` | alcance + `propietario` en SQL: la lista es de la cuenta; el detalle (pasos, llamadas, tokens y costo) de un trabajo ajeno da 404 como uno que no existe |
| `POST /api/ia/trabajos/:id/cancelar` | `propietario`; sirve también con la clave del MCP (frenar no gasta) |
| `POST /api/ia/trabajos/:id/confirmar`, `POST /api/ia/trabajos/:id/reanudar`, `POST /api/ia/menciones/:id/reintentar` | solo con sesión (la clave del MCP y OAuth dan 403: gastan o dan permiso); `propietario`; las llamadas tienen que ser de ese trabajo |
| `POST /api/ia/interno/correr` | la clave del MCP + la cuenta firmada con `TABLERO_SECRETO` (vale 2 minutos); sin las dos, 401. Corre los trabajos de esa cuenta |
| `POST /api/ia/interno/diagnostico` | la clave del MCP; sin ella, 401. No lee ni escribe datos |
| `GET`/`POST /api/ia/interno/barrer` | `CRON_SECRET` (tiempo constante); sin la variable o con otro valor, 401. Sin sesión (va en `RUTAS_LIBRES`) |

### Claves, agentes, ajustes y gasto de la IA (`servidor/src/ia/rutas-claves.ts`, montado en `/api`)

Corren con `iaDe(servicio)` (la cuenta del pedido): toda consulta de `ia_claves`, `ia_agentes`, `ia_ajustes`, `ia_uso_mes` e `ia_trabajos`
lleva `propietario = cuenta`, y un id ajeno da 404 con el mismo mensaje que uno que no existe. **Lo que cambia algo pide sesión (o
local): con la clave del MCP da 403 «Esto se cambia desde Configuración, con tu cuenta.»**, así una IA de afuera no puede subirse el
tope ni cambiar una clave. La clave de un proveedor **nunca** vuelve (solo `ultimos4`); en la base va cifrada con la cuenta y el id
como dato autenticado (`ia/boveda.ts`). Detalle de cada ruta (cuerpo, respuesta, errores) en `docs/plan-ia-integrada.md`, 16.4.

| Ruta | Chequeo |
|---|---|
| `GET /api/ia/estado` | alcance; agentes, claves (sin el secreto), ajustes y modelos de la cuenta; `puedeCambiar` es false con la clave del MCP. Los `modelos` (con su costo estimado) y los `preajustes` (GPT, Gemini, DeepSeek, Otro) son datos del servidor iguales para todas las cuentas: no leen la base |
| `GET /api/ia/uso?mes=2026-11` | alcance; el gasto de un mes (UTC) de la cuenta: `ia_uso_mes` por `propietario`, los trabajos por `propietario` y su dónde por proyecto de la cuenta |
| `POST /api/ia/claves` | sesión; la clave se prueba antes de guardarse (una inválida no se guarda) y se sella con la cuenta y el id; 10 pruebas por hora y por cuenta; hasta 20 claves; una de GitHub por cuenta |
| `PUT /api/ia/claves/:id` | sesión; `propietario` (404 si es ajena); el proveedor no se cambia; una clave o dirección nueva se prueba antes de pisar |
| `POST /api/ia/claves/:id/probar` | sesión; `propietario`; abre la clave de ESTA cuenta (la fila de otra cuenta no se abre) |
| `DELETE /api/ia/claves/:id` | sesión; `propietario`; los agentes que la usaban quedan `sin_clave` |
| `POST /api/ia/agentes` | sesión; el miembro y la clave tienen que ser de la cuenta (`propio('miembro')` y `propietario` en la clave, 404 si no); listas y tablero de los disparadores por `propios`/`propio`; la clave tiene que ser del proveedor del agente |
| `PUT /api/ia/agentes/:id` | sesión; `propio('miembro')` y fila de `ia_agentes` con `propietario`; lo demás, como al crear |
| `DELETE /api/ia/agentes/:id` | sesión; fila de `ia_agentes` con `propietario` (se archiva el miembro, no se borra) |
| `PUT /api/ia/ajustes` | sesión; la fila es de la cuenta (`propietario` es la clave primaria) |

### OAuth (`servidor/src/oauth/rutas.ts`)

| Ruta | Chequeo |
|---|---|
| `/.well-known/*`, `POST /oauth/registrar`, `GET /oauth/autorizar`, `POST /oauth/token`, `POST /oauth/revocar` | públicas (estándar). El canje y el refresco piden que la cuenta del código o del refresco exista y esté activa |
| `GET /api/oauth/pedido` | sesión (la clave no alcanza) |
| `POST /api/oauth/decidir` | sesión; el código queda con el usuario de la sesión (`t:<id>` o el del juego) |
| `GET /api/oauth/conexiones` | sesión; solo las de esa cuenta |
| `DELETE /api/oauth/conexiones/:familia` | sesión; la familia tiene que ser de esa cuenta (si no, 404) |

### Diseño (`servidor/src/diseno/rutas.ts`, montado en `/api/diseno`)

`:p` se resuelve con `proyecto()` → `resolverProyecto` filtrado (un proyecto ajeno da 404), y cada método del
ServicioDiseno con `pid` lo vuelve a verificar (`pidPropio`).

| Ruta | Chequeo |
|---|---|
| `GET /_tarjeta/:clave` | resolutor de tarjeta |
| `POST /:p/render-interno` | clave; los archivos, de la cuenta firmada (o `dueno`) |
| `POST /:p/grilla-interna` | clave (solo compone imágenes que le mandan) |
| `GET /:p`, `GET /:p/prefijados` | resolutor + pidPropio |
| `POST /:p/paginas`, `GET`/`PATCH /:p/paginas/:pagina`, `POST /:p/paginas/:pagina/ordenar` | pidPropio; página del proyecto |
| `GET`/`PATCH /:p/marcos/:id`, `POST /:p/marcos`, `…/operaciones`, `…/duplicar`, `…/archivar`, `…/restaurar`, `…/revisiones`, `…/render`, `…/miniatura` | pidPropio; marco del proyecto (`resolverMarco` filtra por `proyecto_id`); las tarjetas, por resolutor |
| `GET /:p/items`, `GET`/`PUT /:p/items/:tipo/:clave`, `POST /:p/items/archivar`, `POST /:p/tokens`, `POST /:p/piezas`, `GET /:p/css/tokens.css`, `POST /:p/activos` | pidPropio; activos en la carpeta de la cuenta |
| `GET`/`PUT /:p/notas`, `GET`/`POST /:p/comentarios`, `PATCH /:p/comentarios/:id`, `GET`/`PUT`/`DELETE /:p/vinculos`, `POST /:p/proponer` | pidPropio; el objetivo, del proyecto; la tarjeta, por resolutor; el comentario, del proyecto |
| `GET /:p/buscar`, `GET`/`PUT /:p/config`, `GET /:p/importaciones` | pidPropio |
| `POST /:p/importar/empezar`, `/archivo`, `/lote`, `/terminar` | clave → `dueno` |

### MCP (`/mcp` y `npm run mcp`)

Todas las herramientas corren con `ejecutorLocal(servicio())`: el Servicio de la cuenta del token OAuth (o `dueno` con la
clave o por stdio). Las referencias (`proyecto`, `tablero`, `tarjeta`, `lista`, `marco`, `objeto`, `tabla`, `grafico`,
`pagina`) pasan por los resolutores filtrados; los ids sueltos, por `propio`. La IA queda como miembro de esa cuenta
(`asegurarMiembroIA` filtra e inserta con la cuenta).

| Grupo | Herramientas | Chequeo |
|---|---|---|
| Guía | `leer_guia` | sin datos |
| Proyectos | `listar_proyectos`, `leer_proyecto`, `listar_tableros`, `crear_proyecto`, `actualizar_proyecto`, `crear_tablero`, `actualizar_tablero` | listas filtradas; resolutor de proyecto y tablero; propio(proyecto); foto en la carpeta de la cuenta |
| Kanban | `leer_tablero`, `leer_tarjeta`, `buscar`, `leer_actividad`, `crear_tarjeta`, `actualizar_tarjeta`, `mover_tarjeta`, `archivar_tarjeta`, `comentar`, `registrar_porque`, `vincular`, `crear_lista`, `actualizar_lista` | resolutores de tablero, lista y tarjeta; actividad y búsqueda por propietario; `comentar { responde_a }`: el comentario tiene que ser de esa tarjeta |
| Menciones | `leer_pendientes`, `atender_mencion` | solo las menciones dirigidas al miembro del actor, de su cuenta (`propietario` y `destinatario_id`); `proyecto` por resolutor; una mención ajena o de otro miembro da 404 como una que no existe |
| Lienzo | `leer_lienzo`, `agregar_al_lienzo`, `armar_en_lienzo`, `actualizar_lienzo`, `quitar_del_lienzo`, `convertir_objeto` | tablero por resolutor; `elementosDe`/`resolverElemento` con propio(tablero); propios(elemento) y (conector); tope de objetos |
| Tablas | `crear_tabla`, `leer_tabla`, `actualizar_tabla`, `crear_grafico`, `actualizar_grafico` | ídem lienzo; propio(elemento) |
| Diseño | `leer_diseno`, `buscar_en_diseno`, `ver_diseno`, `crear_marco`, `editar_marco`, `duplicar_marco`, `definir_tokens`, `definir_pieza`, `subir_activo`, `organizar_diseno`, `comentar_diseno`, `exportar_diseno`, `sincronizar_diseno` | `ctxProyecto` → resolutor de proyecto; pidPropio en cada método; render con el almacén de la cuenta |

### Métodos públicos del Servicio (`servidor/src/dominio/servicio.ts`)

Todos usan `this.cuenta` (sin cuenta, error).

| Método | Chequeo |
|---|---|
| `listarProyectos`, `listarMiembros`, `uso` | filtro por propietario en SQL |
| `listarEtiquetas` | propio(proyecto) |
| `listarListas`, `listarArchivadas`, `elementosDe`, `quitadosDe`, `restaurarEnLienzo` | propio(tablero) |
| `resumenes`, `resumenTarjeta` | filtro por propietario siempre |
| `leerTableroCompleto`, `crearLista`, `crearTarjeta`, `actualizarTablero`, `crearElemento`, `crearConector` | tableroPropio |
| `leerTarjeta`, `actualizarTarjeta`, `moverTarjeta`, `archivarTarjeta`, `copiarTarjeta`, `registrarPorque`, `comentar`, `crearChecklist`, `agregarAdjunto`, `agregarEnlace`, `vincular` | resolverTarjeta (filtrado) |
| `archivarHechasViejas` (y el barrido del cron, `dominio/archivo-hecho.ts`) | sin `tableroId` recorre solo los tableros de su cuenta (`propietario`); con `tableroId`, tableroPropio (404 si es ajeno); el barrido solo decide a quién le toca y llama a `raiz.de(propietario)`: el archivado, la actividad y el aviso son de esa cuenta |
| `listarActividad`, `buscar` | propietario + propio de los filtros |
| `resolverProyecto`, `resolverTablero`, `resolverLista`, `resolverTarjeta`, `resolverElemento` | filtrados (resolverLista y resolverElemento, con propio(tablero)) |
| `asegurarMiembroIA`, `crearMiembro`, `aliasLibre` | filtran e insertan con la cuenta (el alias es único por cuenta) |
| `actualizarMiembro` | propio(miembro); alias único en la cuenta |
| `comentar`, `editarComentario`, `eliminarComentario` (ganchos) | además de lo de arriba, el gancho de menciones corre con el Servicio de esa cuenta (`servicio.ganchos` se comparte, pero cada llamada trae su `Servicio`) |
| `asegurarEtiquetas`, `crearEtiqueta`, `crearTablero` | propio(proyecto) |
| `actualizarEtiqueta`, `eliminarEtiqueta` | propio(etiqueta) |
| `crearProyecto` | prefijo por cuenta; tope |
| `actualizarProyecto`, `ponerImagenProyecto` | propio(proyecto) |
| `actualizarLista` | propio(lista) |
| `editarComentario`, `eliminarComentario` | propio(comentario) |
| `actualizarChecklist`, `eliminarChecklist`, `agregarItem` | tarjetaDeChecklist (filtrada) |
| `actualizarItem`, `eliminarItem`, `convertirItemEnTarjeta` | propio(item) (+ propio(miembro) del responsable) |
| `eliminarAdjunto` / `eliminarEnlace` / `desvincular` | propio(adjunto) / propio(enlace) / propio(vinculo) |
| `actualizarElementos`, `eliminarElementos` | propios(elemento) |
| `restaurarElementos` | propios(elemento), propios(conector) |
| `operarTabla`, `actualizarGrafico`, `convertirElemento` | propio(elemento) |
| `crearTabla`, `crearGrafico`, `agregarAlLienzo`, `armarEnLienzo`, `quitarDelLienzo`, `apilarEnLienzo`, `conectarEnLienzo`, `lugarEnLienzo` | `elementosDe`/`crearElemento` (propio(tablero) / tableroPropio) |
| `actualizarConector`, `eliminarConectores` | propio(conector) / propios(conector) |
| `propio`, `propios`, `de`, `cuenta`, `esDueno` | el mecanismo |

### ServicioIA (`servidor/src/ia/servicio-ia.ts`)

`iaDe(servicio)` sobre el Servicio de una cuenta (`this.cuenta` falla en el de la raíz). Todas las tablas nuevas llevan
`propietario` y cada consulta lo filtra; los inserts de menciones y notificaciones salen de `select … from miembros where
propietario = cuenta` (un miembro ajeno no inserta nada).

| Método | Chequeo |
|---|---|
| `asegurarAlias`, `mencionables` | miembros de la cuenta |
| `procesarTextos`, `retirarOrigenes`, `filasDeOrigenes`, `insertarMencion`, `reponerMenciones`, `quitarDelTexto`, `atenderPorComentario` | `propietario`; el destinatario tiene que ser miembro de la cuenta |
| `pendientesDe(miembroId)` | propio(miembro); `propietario` y `destinatario_id`; las tarjetas asignadas, por `resumenes` (filtrado) |
| `atender(ctx, id)` | `propietario` y `destinatario_id = ctx.actor.id`; si no, 404 |
| `notificar`, `novedades`, `notificaciones`, `marcarLeidas`, `preferencias`, `guardarPreferencias` | `propietario` y `para_id` = el «yo» de la cuenta |
| `levantarMencionesViejas`, `levantarSiHaceFalta` | comentarios de las tarjetas de proyectos de la cuenta; miembros IA creados en la cuenta |
| `estado`, `uso`, `conResumenDeAgentes` | todo por `propietario`; los miembros, por `miembros.propietario` |
| `guardarClave`, `probarClave`, `quitarClave` | `propietario` en cada consulta (`filaDeClave`); `sellar`/`abrir` atan la clave a `cuenta:id` (una fila copiada a otra cuenta no se abre); el filtro de claves tapa lo que diga el proveedor |
| `guardarAgente`, `archivarAgente` | `propio('miembro')`; la clave por `propietario`; `propios('lista')` y `propio('tablero')` en los disparadores; el miembro IA se busca solo entre los de la cuenta |
| `guardarAjustes` | `propietario` (clave primaria de `ia_ajustes`); los repos se normalizan a `dueño/repo` |
| `prepararCodigo`, `usoCodigoDelTrabajo`, `ejecutarCodigo` (`ia/codigo.ts`) | repos solo de `proyectos.propietario = cuenta` más los de los ajustes de la cuenta; la tarjeta por `leerTarjeta` (resolutor filtrado); el token, el de la cuenta (`ia_claves` por `propietario`); lo gastado, del libro de ESE trabajo y cuenta; otro repo da «no es de esta cuenta»; solo GET a GitHub |

## Topes de una cuenta nueva

20 proyectos (cuentan los archivados), 200 MB de archivos en total (4 MB por archivo, el tope de Vercel) y 100.000
objetos de lienzo (cuentan los sacados del lienzo, que se pueden restaurar). Pasarse da un mensaje claro (413). `dueno`,
sin topes. Configuración → Cuenta muestra lo que usa.

## Crear cuenta con aprobación

Pedido del dueño: «Pide enlace de invitación… ¿No dijimos que era correo y contraseña? ¿De dónde saco el enlace?» y «van a ser mis amigos siempre porque yo les
voy a dar acceso; algún miedo tiene que haber». Decisión: **cuenta abierta con aprobación del dueño** (código: `servidor/src/solicitudes.ts`, rutas en
`amigos-rutas.ts`, migración `20261211090000_solicitudes.sql`).

- **Pedir la cuenta** (Entrar → «Crear cuenta»): nombre, mail y contraseña (mínimo 10, la regla de siempre). Nace `pendiente`, sin sesión. Salen sus 8 códigos de
  recuperación («Guardá estos códigos») y «Listo. Tu cuenta espera la aprobación de {dueño}. Cuando la apruebe, entrás con tu mail y tu contraseña.»
- **Los cuatro estados** (`cuentas.estado`): `activa` (la única que entra), `suspendida` (el dueño la frenó), `pendiente` (espera) y `rechazada`. **Todo
  pasa por `cuentaDeUsuario`/`puedeEntrar`** (`cuentas.ts`): la cookie de la web, los eventos en vivo, los archivos, el token de OAuth (también al canjear
  y refrescar) y el MCP. Una cuenta que no es `activa` no entra a ninguno, con una cookie o un token bien firmados. `solicitudes.prueba.ts` lo prueba por cada
  estado y trae un **barrido**: si aparece un archivo nuevo del servidor que mire `'activa'`, la prueba falla hasta que se lo revise y se lo sume a la lista.
- **Si intenta entrar** mientras espera: con mail y contraseña correctos, «Tu cuenta todavía espera la aprobación de {dueño}.» (403); con la contraseña mala o un
  mail inexistente, el error de siempre. **Si el dueño la rechaza**: el mismo error de siempre, idéntico al de una contraseña mala (no se revela el rechazo; tampoco
  al recuperar con un código ni al pedir de nuevo con ese mail).
- **Recuperar con un código** mientras espera: SÍ cambia la contraseña (los códigos se mostraron al pedirla), pero **no abre la sesión** (`{ pendiente: true }`).
  El dueño no le genera enlaces de restablecimiento ni la «reactiva» (409): una solicitud se aprueba o se rechaza.
- **Aprobar** (solo la **SESIÓN del dueño**; la clave del MCP y un amigo 403, OAuth y sin sesión 401): `pendiente` → `activa`, contando contra el tope de amigos
  (las solicitudes NO cuentan para el tope; se mira recién al aprobar y, con el tope lleno, la solicitud sigue esperando y la pantalla dice «es el tope: subilo»).
  Dos aprobaciones a la vez con un solo lugar dejan una. Le crea su Telar vacío (su miembro «yo»): la próxima vez que entre con su mail y su contraseña lo encuentra.
- **Rechazar**: queda `rechazada` (no entra); su **mail queda ocupado 7 días** (no hay reintentos infinitos). Pasado ese tiempo, al volver a pedir con ese mail la
  rechazada vieja se borra y se crea la solicitud nueva. **Reconsiderar** la devuelve a pendiente. Un amigo ya aprobado se suspende como siempre.
- **Los miedos del dueño**, en una línea cada uno en la pantalla de Amigos: nadie entra sin su aprobación; como mucho 30 solicitudes pendientes a la vez (más:
  «Ahora no se aceptan más solicitudes. Probá más tarde.», 429, y un aviso en la campana, uno por día; las rechazadas no ocupan lugar); límite de 5 pedidos por IP por
  hora (la tabla `intentos`, con la IP guardada como hash); el mismo mensaje de «mail ya usado» sea la cuenta activa, pendiente o rechazada; **«Borrar solicitudes
  viejas»** (más de 30 días, con confirmación) borra de verdad (son cuentas que nunca entraron y no tienen nada adentro: la consulta exige que no tengan proyectos ni
  miembros) junto con sus códigos de recuperación y enlaces.
- **El dueño se entera**: una notificación en la campana por cada solicitud («Pablo pidió una cuenta», enlace a Amigos) y un número en la marca del botón
  Configuración, de la sección Amigos y del menú ⋮ del celular (`/api/sesion` lo trae solo para su sesión). En Configuración → Amigos, «Solicitudes» es lo primero:
  nombre, mail, desde cuándo y dos botones grandes («Aprobar», «Rechazar» con confirmación suave); las rechazadas, plegadas, con «Reconsiderar».
- **Las invitaciones por enlace siguen** (Configuración → Amigos → «Invitar a un amigo») y **quien entra con una queda aprobado al instante**, sin pasar por
  solicitud: el enlace ya es el permiso del dueño. La pantalla de invitar lo dice.
- **Ya no hace falta ninguna variable** (`TABLERO_INVITACION` sigue andando para quien la tenga cargada). **Migración antes de publicar**: sin aplicarla, la base no acepta el
  estado `pendiente` y «Crear cuenta» da error (README, «Online»).
- **Lo que no hace**: no verifica el mail (no hay servicio de mail: ver «Lo que queda para después»), así que el dueño aprueba por el nombre y el mail que ve; y
  una solicitud que nunca se responde queda pendiente hasta que se borre (30 días) o se responda.

## Amigos e invitaciones (cómo funciona)

El dueño no carga variables ni vuelve a publicar cada vez que un amigo quiere entrar: lo hace desde Configuración → Amigos (en el
celular, Menú ⋮ → Amigos; solo aparece con la sesión del dueño).

- **Invitar:** «Invitar a un amigo» → nota opcional («para Pablo», solo la ve el dueño), cuántas personas pueden usarla (1, 5 o 10) y cuándo
  vence (1, 7 o 30 días; de fábrica 1 persona y 7 días: un clic crea). Muestra el enlace UNA sola vez, con «Copiar enlace» y, si el
  navegador lo permite, «Compartir». Si se pierde, se revoca y se crea otra.
- **El token:** 32 bytes al azar (base64url) dentro del enlace. En la base (`invitaciones`) queda solo su sha256; el token en claro nunca se
  guarda, se registra ni vuelve en una lista. `cuentas:probar` lo busca en todas las tablas y en la salida del servidor.
- **Canjear:** buscar por el hash, comparar en tiempo constante y, en UNA transacción con la fila del dueño trabada, gastar un uso y crear
  la cuenta (la tabla además exige `usos <= usos_max`): dos pedidos a la vez con una invitación de un solo uso dejan una sola cuenta, y un
  mail repetido o el tope no gastan el uso. La cuenta queda atada a su invitación (`cuentas.invitacion_id`, para mostrar «vino con…»).
- **Un solo mensaje:** inventada, alterada, vencida, usada o revocada contestan exactamente igual («Esta invitación ya no sirve. Pedile otra
  a quien te invitó.»): no se cuenta cuál fue la razón. Quince enlaces que no sirven desde una IP en una hora la frenan (429).
- **Topes:** hasta 20 invitaciones pendientes a la vez; **tope de cuentas de amigos** (de fábrica 15, editable de 1 a 100 en la misma
  pantalla; las suspendidas cuentan, sus datos siguen en la base) que corta también el registro por código. Al llegar, el canje dice
  «Por ahora Telar no puede abrir más cuentas» y el dueño recibe un aviso en la campana (uno por día). Cada cuenta tiene su tope de espacio
  (200 MB) y de proyectos (20).
- **Suspender / reactivar:** botón en la fila de cada amigo, con el texto de qué pasa (no puede entrar, ni con sus IA conectadas; sus
  proyectos y datos quedan; se deshace con «Reactivar»). Corta la sesión en el próximo pedido.
- **Revocar:** el enlace deja de servir ya.
- **Lo que ve el dueño de un amigo:** nombre, mail, desde cuándo, último ingreso (se anota una vez por hora), cantidad de proyectos, espacio
  usado, de qué invitación vino y su estado. Nada de lo que tiene adentro.
- **Si el enlace se abre en un navegador con sesión** (por ejemplo el dueño probando el suyo) no se muestra el formulario: dice «Ya
  entraste a Telar», porque crear la cuenta pisaría esa sesión.
- **Los miedos del dueño, en la pantalla, una línea cada uno:** cada amigo ve solo lo suyo; el enlace sirve las veces que elijas y vence solo;
  se puede revocar y suspender; hay tope de cuentas y de espacio; la IA de cada amigo usa su propia clave (nada del dueño se comparte).
- **Dónde no se puede:** en la computadora (sin `TABLERO_PUBLICO`) no hay cuentas y las rutas dan 404.

## Recuperar la contraseña sin correo

Pedido del dueño: «Si un amigo olvida su contraseña ¿no se puede usar más esa cuenta? No tiene sentido. O yo le puedo actualizar la
contraseña, o él tiene que tener una forma de recuperarla sin Resend (no hay servicio de mail).» Decisión: **dos caminos sin correo** (código:
`servidor/src/recuperacion.ts`, rutas en `recuperacion-rutas.ts` y `amigos-rutas.ts`, migración `20261210090000_recuperacion.sql`).

### 1. Códigos de recuperación (autoservicio)

- **Al crear la cuenta** (por enlace o por el código de la variable) se generan **8 códigos** de un solo uso (`K7M2-9QXA-WD4P`: 12 símbolos de un
  alfabeto de 32 sin `0`, `1`, `I` ni `O`, o sea **60 bits cada uno**). Salen en la respuesta del registro, UNA vez (`no-store`), y la pantalla
  «Guardá estos códigos» no deja seguir hasta marcar «Ya los guardé» (con «Copiar» y «Descargar .txt»; cerrar la pestaña antes avisa que se
  pierden). Dice para qué sirven y que valen como una contraseña. Si por algo no se pudieron generar (por ejemplo, la migración todavía no
  corrió) la cuenta igual queda creada y los genera desde Configuración → Cuenta.
- **En la base** quedan solo `sha256(sal + código)` con una sal de 16 bytes por código (`codigos_recuperacion`); el código en claro no se guarda,
  no se registra y no vuelve en ninguna lista. `cuentas:probar` y `recuperacion:probar` lo buscan en todas las tablas y en la salida del servidor.
- **«¿Olvidaste tu contraseña?»** (Entrar, PC y celular): mail + un código + contraseña nueva (mínimo 10, la regla de siempre). Si sirve: cambia la
  contraseña, **gasta ese código**, **cierra todas las demás sesiones** (sube `version_sesion`), anota «último restablecimiento» (por código), deja
  la sesión abierta y muestra cuántos códigos quedan: con 2 o menos, un aviso fuerte y «Generar códigos nuevos» ahí mismo.
- **Mismo mensaje y mismo estado** (401) para mail inexistente, código malo, código usado, código de otra cuenta y la cuenta del dueño («El mail o el
  código de recuperación no son correctos, o ese código ya se usó.»): no se cuenta qué mails existen. Siempre las dos lecturas y ocho comparaciones
  en tiempo constante. Una contraseña floja se dice antes de mirar nada (no depende de la cuenta) y no gasta el código; una cuenta suspendida solo lo
  oye con un código bueno (403) y tampoco lo gasta.
- **Límite de intentos** (tabla `intentos`): 8 fallidos por mail cada 15 minutos y 30 por IP; pasado el límite frena aunque llegue el código bueno.
- **Carrera:** gastar un código es una sola sentencia con `where usado_en is null`: dos usos a la vez del mismo código dejan uno (probado con seis).
- **Configuración → Cuenta** (en el celular, Menú → Mi perfil): «Te quedan 6 de 8» y «Generar códigos nuevos»: pide la contraseña actual, solo con
  sesión (la clave del MCP: 403; la cuenta del dueño no usa códigos), borra los anteriores y muestra los nuevos una sola vez. Con 2 o menos, aviso fuerte;
  con 0, dice que solo el dueño de Telar podría ayudar. Las cuentas que ya existían sin códigos los generan desde ahí.

### 2. Restablecimiento por el dueño (asistido)

- **Configuración → Amigos → «Restablecer contraseña»** en la fila de cada amigo (en el celular, en la hoja «Amigos»): genera un **enlace de un solo
  uso que vence a las 24 horas** (`https://<la web>/restablecer/<token>`; 32 bytes al azar, en la base solo su sha256, igual que las invitaciones).
  Sale una vez, con «Copiar enlace» y «Compartir» (Web Share, si el navegador sabe), para que el dueño se lo mande por WhatsApp. Crear otro reemplaza al
  pendiente; la fila muestra «Enlace para restablecer pendiente · vence …» (o «vencido») con «Cancelar enlace».
- **El dueño NUNCA ve ni elige la contraseña del amigo**, y la pantalla lo dice: la escribe el amigo al abrir el enlace («Hola, Pablo: poné tu contraseña
  nueva»). No hay ningún camino de la API para que el dueño la fije.
- **Solo la sesión del `dueno`** puede generarlo o cancelarlo (la clave del MCP, un token de OAuth y la cuenta de un amigo: 403/401: es dar permiso, regla 8
  de `AGENTS.md`). Solo para cuentas de amigos con contraseña de Telar: la del dueño da 400 (entra con la cuenta del juego), una inexistente 404 y una
  suspendida 409 («reactivala primero»). No hay herramienta de MCP para esto.
- **Al usarlo:** la contraseña nueva, **otras sesiones cerradas**, anotado «último restablecimiento» (por enlace) en la cuenta del amigo (el dueño lo ve en la
  fila, con el camino y sin nada más), **8 códigos de recuperación nuevos** (los de antes pueden haberse perdido: dejan de servir) y un aviso en la campana del
  dueño («Pablo restableció su contraseña»).
- **Honestidad del enlace:** inventado, alterado, vencido, usado, cancelado, reemplazado, o de una cuenta suspendida: **el mismo 404** («Este enlace ya no
  sirve»), y 15 enlaces que no sirven desde una IP en una hora la frenan. Cambiar la contraseña por otro camino (la propia, o un código) deja sin efecto el
  enlace pendiente: un enlace perdido no seguiría abriendo la cuenta. Cinco canjes a la vez del mismo enlace dejan uno solo.
- Si el enlace se abre en un navegador con sesión, no se muestra el formulario («Ya entraste a Telar»): cambiar la contraseña pisaría esa sesión (y el dueño que
  prueba su propio enlace perdería la suya).

### Lo que NO hace (a propósito)

- Los **tokens de OAuth** (ChatGPT, claude.ai) no se cortan al cambiar la contraseña por ninguno de los tres caminos (cambiarla, código, enlace), como ya pasaba:
  los conectores se revocan desde «Conectar IA». Si un amigo cree que alguien más entró, el dueño puede suspenderlo (eso sí los corta).
- Quien sepa el mail de un amigo puede gastarle los 8 intentos por mail de «¿Olvidaste tu contraseña?» (y los de entrar) durante 15 minutos: lo frena, no lo abre
  (el mismo límite que ya tenía entrar). El código bueno recién después de esa espera.
- No hay «recibir el código por mail»: sin servicio de mail es imposible. Cuando se contrate Resend (abajo), se suma como **tercer camino** y estos dos siguen.
- La cuenta del dueño no usa nada de esto: entra con la cuenta del juego (Supabase Auth, código por mail del juego), que no cambia.

## Para el dueño (operación)

- **Alguien pide una cuenta:** te llega «<nombre> pidió una cuenta» a la campana y un número en Configuración → Amigos. Ahí, «Solicitudes»: «Aprobar» (entra con
  su mail y su contraseña a su Telar vacío) o «Rechazar» (no entra; podés «Reconsiderar»). Si no la conocés, rechazala o dejala: no entra a nada. Cada tanto,
  «Borrar solicitudes viejas».
- **Invitar a un amigo:** Configuración → Amigos → «Invitar a un amigo». Nada más: no hace falta cargar `TABLERO_INVITACION` ni publicar. Quien abre el enlace entra
  aprobado al instante. (La variable sigue funcionando si está cargada, por compatibilidad; se puede borrar.)
- **Un amigo olvidó su contraseña:** primero que pruebe «¿Olvidaste tu contraseña?» con uno de sus códigos de recuperación (los guardó al crear la cuenta). Si no los
  tiene: Configuración → Amigos → «Restablecer contraseña» en su fila → «Crear enlace» → «Copiar enlace» o «Compartir» y se lo mandás por WhatsApp. El enlace sirve
  una vez y vence a las 24 horas; si se perdió, «Cancelar enlace» y creás otro. Vos no ves ni elegís su contraseña.
- **Suspender o reactivar una cuenta:** en la misma pantalla. (Antes lo hacía Claude con la clave del MCP por `/api/admin/cuentas`: esa ruta ya no
  existe, porque suspender y reactivar es dar permiso y eso pide la sesión del dueño.)
- **Migración:** `supabase/migrations/20261204090000_cuentas.sql`, para Amigos `supabase/migrations/20261208090000_invitaciones.sql` , para recuperar la
  contraseña sin correo, `supabase/migrations/20261210090000_recuperacion.sql` y, para crear cuenta con aprobación,
  `supabase/migrations/20261211090000_solicitudes.sql`: aplicarlas ANTES de publicar (README, «Online»).

## Lo que queda para después

- **Mail de verificación y «recibir el código por mail»** — **pregunta para el dueño: gasto.** Hoy no hay servicio de mail
  contratado: una cuenta de Telar que olvida su contraseña la recupera con sus códigos de recuperación o con el enlace del dueño («Recuperar la
  contraseña sin correo», arriba). Con un servicio de mail se sumaría «recibir el código por mail» como tercer camino (y verificar el mail al
  registrarse). Propuesta: **Resend** (el más simple de
  integrar): plan gratis de 3.000 mails por mes (100 por día), Pro USD 20/mes por 50.000; necesita un dominio propio
  verificado para mandar a cualquiera (telarapp.vercel.app no sirve; un dominio .com sale unos USD 10–15 por año).
  Alternativas: Postmark (desde USD 15/mes) o Amazon SES (USD 0,10 cada 1.000, con más trabajo de configuración). No se usa
  el mail de Supabase Auth: es la configuración del juego y no se toca. Precios a confirmar al contratar.
- **Claves de MCP personales** (para Claude Code sin OAuth, por cuenta), con su lista y su «revocar».
- **Proyectos compartidos entre cuentas** (permisos: ver, editar), hoy `miembros` es por cuenta y no se comparte nada.
- **Borrar una cuenta** (archivar, por la regla de nada se borra; y exportar lo suyo antes).
- **Detalle conocido**: el número de evento de `/api/eventos/desde` es una secuencia de toda la base; sus saltos dejan
  adivinar cuánta actividad hay en total (no qué ni de quién).
- **Detalle conocido**: «Ya hay una cuenta con ese mail» confirma que ese mail tiene cuenta (inevitable sin verificar por
  correo; queda detrás del límite por IP, y dice lo mismo sea la cuenta activa, pendiente o rechazada). Como «Crear cuenta» ya no pide un enlace,
  cualquiera puede probar si un mail tiene cuenta (5 pedidos por hora y por IP).
- **Detalle conocido**: el token va en la dirección del enlace (`/unirse/<token>`), así que el proveedor de hosting lo ve en sus registros
  de pedidos (Telar no lo registra, y el enlace sirve una vez y vence). Si molestara, se pasa a un fragmento (`#`), que no viaja al servidor.

## Cómo se prueba

`npm run cuentas:probar` (unos 5 minutos; `--sin-base-vieja` salta el paso con git; `--solo-amigos` corre solo los pasos 0 y 5, las invitaciones,
en ~1 minuto; `--solo-recuperacion` corre solo los pasos 0 y 6, recuperar la contraseña sin correo, en ~15 segundos; `--solo-solicitudes` corre solo los pasos 0 y 7,
crear cuenta con aprobación, en ~2 minutos): ver la cabecera de
`scripts/probar-cuentas.mjs`. `npm run recuperacion:probar` (el servicio de recuperación y la migración, en PGlite en memoria, sin red) y
`NODE_PATH=$(npm root -g) node scripts/probar-recuperacion-ui.cjs` (Playwright: PC y celular, claro y oscuro; capturas en
`docs/capturas/recuperacion/`). `npm run solicitudes:probar` (crear cuenta con aprobación: el servicio y la migración, en PGlite en memoria, sin red) y
`NODE_PATH=$(npm root -g) node scripts/probar-solicitudes-ui.cjs` (Playwright: PC y celular con la barra del navegador y el teclado emulados, claro y oscuro; capturas en
`docs/capturas/solicitudes/`). `npm run amigos:probar` (el servicio de invitaciones y la migración, en PGlite
en memoria, sin red) y `NODE_PATH=$(npm root -g) node scripts/probar-amigos-ui.cjs` (Playwright: PC y celular, claro y oscuro; capturas en
`docs/capturas/amigos/`). También `npm run oauth:probar` (el OAuth con una cuenta de Telar), `npm run ia:probar-agentes` y
`ia:probar-boveda` (claves y agentes de una cuenta que otra no ve ni abre), `ia:probar-produccion` (el cableado de verdad online) y
`npm run ia:probar` (T17 y T18 de punta a punta, con dos cuentas).

## Trabajos de los agentes de la IA (F2)

- **Todo lleva `propietario`:** `ia_trabajos`, `ia_mensajes`, `ia_llamadas`, `ia_uso`, `ia_uso_mes`, `ia_agentes`, `ia_claves` e
  `ia_ajustes`. `Trabajos` (`servidor/src/ia/trabajos.ts`) nace del ServicioIA de UNA cuenta y cada consulta filtra por esa cuenta.
- **El ciclo corre cada trabajo con `raiz.de(trabajo.propietario)`:** sus herramientas ven lo mismo que vería esa cuenta por MCP.
  La tanda (`dominio/tanda.ts`) va por el contexto asíncrono: solo se anota lo que hizo ESA llamada.
- **El cron y el mantenimiento** son de sistema: eligen las cuentas con trabajos vencidos y corren cada una con su propio Servicio;
  la limpieza no lee contenido.
- **`npm run cuentas:probar`** siembra (con el Telar apagado, `scripts/ia/sembrar-trabajo.ts`) un agente, un trabajo que espera
  permiso, su gasto y una mención pendiente en cada cuenta, y comprueba que otra cuenta ni los ve, ni los frena, ni los confirma,
  ni los reanuda, ni los reintenta (404 con el mismo mensaje que un id inexistente), que no ve sus pasos ni su gasto, y que las
  rutas internas rechazan con 401 a todos sin su secreto.
- **El cableado (`servidor/src/ia/cableado.ts`) no guarda nada de una cuenta entre pedidos:** `proveedorDe` devuelve adaptadores sin estado de
  cuenta (la clave llega por pedido, abierta con `abrir({ cifrada, version }, { propietario, id })`, que ata la clave a la cuenta y al id); el
  costo se calcula con la dirección de la clave de ESA cuenta y el precio que escribió su dueño (`agente.precioManual`); `prepararCodigo`
  arma un contexto por corrida con los repos y el token de la cuenta del trabajo (su caché de ETag muere con la corrida). El proveedor falso
  lleva una cuenta de errores en memoria por contenido del pedido (no por cuenta) y solo existe con `TABLERO_IA_FALSO=1` fuera de Vercel.
- **Sin el secreto del servidor** (`TABLERO_SECRETO_IA` o `TABLERO_SECRETO`): guardar, cambiar o probar una clave da 503 con el motivo (no 500),
  el estado se sigue viendo y un trabajo falla con ese motivo sin marcar la clave como inválida (`ia:probar-produccion` lo prueba).
