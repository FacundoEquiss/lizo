# 4. Celular y táctil

El plan completo, con medidas y porqués, es `docs/plan-v0.2-movil.md`. Acá va lo que hay que saber para no romperlo y
para que lo nuevo se sienta igual. **Ojo:** algunos puntos del plan cambiaron después con pedidos del dueño; manda lo que
dicen los commits (al final de esta página está la lista).

## La capa del celular

- **No es «responsive»: es una capa aparte.** `web/src/movil/` (`AppMovil`) reusa el Kanban, la tarjeta y la tienda tal
  como están y reemplaza el marco: navegación, hojas, gestos y teclado. La estructura de escritorio (lateral + barra +
  paneles flotantes) no se achica: se reemplaza. Protege el Kanban de escritorio.
- **Una sola decisión de «es celular»**, antes de pintar (script en línea de `web/index.html` + `movil/detectar.ts`):
  `(max-width: 760px), ((pointer: coarse) and (max-height: 500px))`. Se guarda en `html[data-movil]` y `html[data-tactil]`.
  **Todo el CSS del celular cuelga de esos atributos** (`movil.css`): en escritorio no se mueve un píxel. Los estilos de
  escritorio **no** usan `@media (max-width…)` para el celular.
- Una tablet recibe la app de escritorio con los ajustes táctiles (`data-tactil`).
- **Rotar no desmonta nada**: cambia `useEsApaisado` (la barra de abajo pasa a riel lateral; las hojas, a panel derecho).
- **El escritorio no importa nada de `web/src/movil/`.** Si el celular necesita algo de una pieza compartida, se agrega una
  prop con valor por defecto igual al comportamiento de hoy (`Lienzo` acepta `interfaz={{ herramientas: false, … }}`;
  `BarraContextual` acepta `abajo`).

## Tamaños táctiles y zonas seguras

- **44 × 44 mínimo** (`--m-toque`), 48 en filas y menús. Separación mínima 8 px. Un botón que se ve de 32 suma un
  `::before` con `inset: -6px` para llegar a 44 sin cambiar el diseño. `scripts/capturas-movil.mjs` cuenta los que no
  cumplen: meta 0.
- **Zonas seguras:** `viewport-fit=cover` y `--sa-t/-r/-b/-l` (`env(safe-area-inset-*)`). Lo pegado abajo usa
  `max(12px, var(--sa-b))`.
- **Alto de la app:** `100dvh`, nunca `100vh` (en el navegador del teléfono deja la barra de abajo afuera).
- **Campos de 16 px o más** (`max(16px, 1em)`): con menos, Safari agranda la página al enfocar y no la devuelve.
- **Sensación de app:** sin resaltado azul al tocar, sin lupa al mantener apretado (pero el texto escrito sí se puede
  copiar), sin rebote de la página, sin zoom por doble toque, sin avisos de mouse pegados (`[data-tip]` apagado), sin
  barras de scroll en los carruseles. Tabla completa en el plan, 3.2.
- **No se usa `user-scalable=no`** en el HTML (bloquea el zoom de accesibilidad en Android); solo en iOS se agrega
  `maximum-scale=1` por script, que no bloquea el pellizco pero evita el zoom al enfocar.

## Gestos: un reparto sin ambigüedad

| Dónde | Gesto | Resultado |
|---|---|---|
| Kanban | toque | abre la tarjeta |
| Kanban | deslizar vertical / horizontal | desplaza la lista / pasa a la lista de al lado (paginado a presión, la siguiente asoma 22 px) |
| Kanban | **mantener 220 ms sin moverse más de 8 px** | la tarjeta se despega y se arrastra (menos de 180 se dispara al empezar un scroll; más de 300 se siente trabado) |
| Lienzo | un dedo | con la **flecha**: mueve objetos y, en el vacío, la vista; con la **mano**: solo mueve la vista (los objetos no reciben el dedo) |
| Lienzo | dos dedos | zoom y desplazamiento; nunca mueve un objeto |
| Lienzo | doble toque | en el vacío crea una nota; en un objeto entra a editar |
| Lienzo | **mantener 450 ms** | menú del objeto o «Crear acá» (detector propio: `contextmenu` no llega en iOS) |
| Hojas | deslizar hacia abajo (a la derecha en horizontal) | cierra (más de 96 px o más de 500 px/s); si no, vuelve con el resorte |
| Todo | «atrás» del sistema | cierra lo de más arriba (`useCierraConAtras`), nunca saca de la app |

**Todo lo que se arrastra se puede hacer sin arrastrar** (mover tarjeta con «Mover», cerrar hojas con el botón, conectar
con dos toques).

**Háptica** (`movil/haptica.ts`): toques cortos (5–10 ms) para despegar, cruzar y soltar; `[20, 40, 20]` para error. Solo
Android (iPhone no tiene vibración web: ahí la respuesta es visual). Apagable. Nunca el único aviso de algo.

## Hojas

Casi todo lo que en escritorio es un desplegable, un panel o un diálogo, en el teléfono es **una hoja que sube desde
abajo**: `movil/ui/HojaInferior.tsx`. No se hacen hojas a mano.

- Esquinas de arriba `--r-xl`, fondo `--c-elevada`, `--sombra-hoja`, velo **sin desenfoque** (el desenfoque baja a 20–30
  cuadros por segundo en gama baja). Agarre de 36 × 4. Título de 17 px peso 700.
- Abre con resorte 420/40/0,9 desde `y: 100%`; cierra en 200 ms con `--curva-sale`.
- Se cierra con el velo, el botón, «atrás», `Escape` o **deslizando desde cualquier parte** (caso 2 de
  [componentes y flujos](05-componentes-y-flujos.md#caso-2-la-hoja-que-se-cierra-desde-cualquier-parte)).
- El foco entra **a la hoja, no a un campo** (que no salte el teclado sin pedirlo) y vuelve al disparador al cerrar.
- En horizontal es un panel derecho de `min(420px, 60vw)`: con 393 px de alto, una hoja de abajo dejaría 100 px útiles.
- Las hojas se apilan (`NivelHoja`): la que se abre desde otra va encima.

## Teclado en pantalla

Dos mecanismos, porque los sistemas se portan distinto (`movil/teclado.ts`):

- **Android** (`interactive-widget=resizes-content`): el teclado **achica** la ventana; `100dvh` ya lo descuenta.
- **iOS:** el teclado **se superpone**; solo cambia el `visualViewport`. Se calcula `--teclado` y las hojas se suben eso.
- `data-teclado` se pone cuando el teclado tapa más de 120 px **o** la ventana quedó por debajo del 75 % de su alto libre
  **para ese ancho** (el teclado cambia el alto, nunca el ancho). Con teclado, la barra de abajo se esconde.
- Al enfocar un campo en una zona con scroll, se centra con aire (el navegador solo garantiza ver el cursor). Tocar fuera
  de un campo lo desenfoca (una app instalada en iOS no lo hace sola).
- Las pantallas de **Entrar y Unirse** viven fuera de la app (no cargan `movil/teclado.ts`) y el `body` no se desplaza: la pantalla se
  desplaza **sola** (`.entrar`: alto `100dvh`, `overflow-y: auto`, la caja con `margin: auto` para que centre si entra y empiece arriba si
  no; centrar con `place-items` corta el borde de arriba), deja abajo lugar para la barra del sistema y para el teclado
  (`--entrar-teclado`, que calcula `util/campoVisible.ts` con el `visualViewport`, como en iOS) y trae al centro el campo con foco. Un formulario
  de entrar nunca puede quedar más alto que la ventana sin poder bajarse. Se prueba achicando la ventana (barra del navegador y teclado) en
  `scripts/probar-solicitudes-ui.cjs`.
- Escribir en el lienzo tiene su propia pieza (`movil/lienzo/EdicionVisible.tsx`): caso 3 de
  [componentes y flujos](05-componentes-y-flujos.md#caso-3-el-teclado-que-se-abría-y-se-cerraba-solo).

## Navegación hoy (después de los arreglos del dueño)

- **Barra de abajo de cinco lugares iguales:** Kanban, Lienzo, **+** (en el medio exacto), Diseño, Buscar. Íconos de 24,
  rótulos de 11,5 en una línea. El «Más» se sacó porque el dueño no entendía para qué era (commit `7f2202f`).
- **Menú** (⋮) arriba a la derecha de la cabecera, al lado del punto de conexión, en el mismo lugar en las tres vistas:
  actividad, archivadas, conectar IA, tema, vibración, instalar, salir y «Proyectos y tableros».
- **Cambiar de proyecto o tablero:** tocando el nombre del tablero en la cabecera (`SelectorTablero`).
- **Lienzo:** la barra de lo elegido va **abajo**, en el lugar de la barra de herramientas, con las opciones desplazables
  de costado y Borrar y ⋯ fijos a la derecha. Arriba a la derecha, «Centrar». El aviso de herramienta va en la franja de
  los botones de arriba y no tapa el lienzo que se va a tocar (commit `5482596`).

## PWA y sin conexión

- Service worker **propio** (unas 200 líneas, `web/pwa/sw.js`): nunca toca `/api`, `/mcp` ni `/archivos`; avisa cuando hay
  versión nueva. Sin `vite-plugin-pwa` (traía Workbox y 200 paquetes para lo mismo).
- **Sin conexión se lee lo último** (IndexedDB, `pwa/sinconexion/`) y **solo se encolan tarjetas nuevas**: encolar
  movimientos con la IA cambiando el tablero obliga a resolver conflictos, y un merge mal hecho rompe lo que más se valora.
- Íconos, pantallas de arranque, manifest y `theme-color` se **generan** desde la marca y `tokens.css`
  (`npm run pwa:iconos`; `npm run pwa:verificar` avisa si quedaron viejos). No se editan a mano.

## Rendimiento en el teléfono (metas medidas del plan, 10.1)

Pixel 8 emulado con CPU × 4 y «4G lenta»: primera carga < 2,5 s; segunda (con service worker) < 1 s; JavaScript inicial
≤ 230 KB comprimidos; arrastrar con 150 tarjetas, percentil 90 ≤ 16,7 ms por cuadro y ninguno > 50 ms; abrir y cerrar una
hoja sin cuadros > 32 ms. Por eso: `AppMovil` con `lazy()`, sin desenfoques, sombras baratas, solo `transform`/`opacity`,
`.lista { contain: layout paint }`, minimapa apagado.

## Lo que solo se comprueba con un teléfono de verdad

El teclado real de Android e iOS, la franja de autocompletar de Chrome, la háptica, el gesto «atrás» del sistema, instalar
la PWA. Las pruebas automáticas emulan; **al entregar se dice que no se probó en un teléfono real** (está pendiente en
`docs/proxima-sesion.md`).

## Cambios posteriores al plan (mandan sobre el plan)

| Commit | Qué cambió |
|---|---|
| `40a3bff` | Las hojas se cierran deslizando desde cualquier parte (el plan decía solo desde el agarre) |
| `c3dde72` | El teclado ya no hace creer que el teléfono está acostado (alto libre por ancho) |
| `7f2202f` | Barra de abajo de cinco sin «Más»; el menú pasa a la cabecera |
| `1d3094e` | El teclado del lienzo ya no se abre y se cierra solo |
| `5482596` | Aviso de herramienta nuevo, la mano solo mueve, botón Centrar |
| `fb705c6` | Barra del lienzo que entra, borrar, soltar la selección y buscar |
| `59b9acb` | Diseño, tercera vista de la barra de abajo |
| (IA integrada, F1) | La campana vive en la cabecera (antes del punto de conexión) y abre la hoja `notificaciones`; «Preferencias» abre otra hoja encima (el celular no tiene Configuración). Al escribir `@`, las sugerencias son una fila de chips de 44 px pegada arriba del campo (`movil/ia/BarraMenciones`, que AppMovil ofrece por contexto: el escritorio no importa nada de `movil/`). «Responder» y «Respondiendo a…» están en la hoja de la tarjeta |
| (agregar tarjeta) | El pie «Agregar tarjeta» queda fijo abajo de cada lista y el «+» del encabezado abre la hoja de agregar con esa lista elegida; la hoja ya no tiene la fila de símbolos (`! # @ :`): tiene tipo, prioridad, etiquetas y motivo, y entiende lo que se escribe o dicta |
| (IA integrada, F2) | Configuración → IA en el celular es la hoja «IA» del menú ⋮ (`movil/ia/HojaIA.tsx`, de altura completa y un nivel por encima de las demás: se abre también desde la tarjeta), con la misma `SeccionIA` de la PC bajada recién al abrirse; adentro se navega a los formularios de agente y de clave sin abrir otra hoja (el pie «Guardar» queda pegado abajo). Campos de 16 px, desplegables del sistema (el celular abre su selector) y casillas de 22 px. En la tarjeta, lo del hilo (`EntradaTrabajo`, `ConfirmarAcciones`, `PieTrabajo`) es el mismo contenido que en la PC y sus botones miden 44 px; la pastilla «Claude está trabajando… Frenar» va debajo de la barra y su «Frenar» llega a 44 px con una zona de toque que sobresale de la pastilla |
| (Amigos) | Configuración → Amigos en el celular es la hoja «Amigos» del menú ⋮ (`movil/amigos/HojaAmigos.tsx`, de altura completa), solo con la sesión del dueño, con la misma `SeccionAmigos` de la PC bajada recién al abrirse. «Invitar a un amigo» no abre otro diálogo: el panel de la nota, los usos y el vencimiento (y después el enlace) aparece en el lugar. Si el navegador sabe Web Share, el enlace se comparte con el menú del sistema; si no, «Copiar enlace». El enlace `/unirse/<token>` es una pantalla aparte (como «Permitir»), con el formulario de Entrar y sin teclado que salte solo |
| (Recuperar la contraseña sin correo) | Lo que se muestra **una sola vez** (los 8 códigos de recuperación y los enlaces de invitación y de restablecimiento) es una pantalla o un panel en el lugar, nunca un diálogo que se cierra con un toque afuera: «Guardá estos códigos» (`ui/CodigosRecuperacion.tsx`) tiene «Copiar», «Descargar .txt» y una casilla «Ya los guardé» de 24 px con rótulo de 44 que habilita el botón de seguir, y cerrar la pestaña antes avisa que se pierden. «¿Olvidaste tu contraseña?» y la pantalla `/restablecer/<token>` son de la caja de Entrar (sin caja flotante, alineadas arriba, campos de 52 px y 16 px de letra, sin teclado que salte solo); el código de recuperación se escribe en monoespaciado de 16 px (14 símbolos con el espaciado del código de 6 dígitos no entran en 360 px). Los códigos de la cuenta viven en «Mi perfil» del menú ⋮ (`ui/DatosCuenta.tsx` → `ui/CodigosCuenta.tsx`) y «Restablecer contraseña» de un amigo en la hoja «Amigos» (`amigos/PanelRestablecer.tsx`, en el lugar, como «Invitar a un amigo»), con todos sus botones de 44 px |
| (Crear cuenta con aprobación) | «Crear cuenta» es el segundo botón de la caja de Entrar (siempre a la vista, 44 px): abre en la misma caja nombre, mail y contraseña (campos de 52 px y 16 px, sin teclado que salte solo, sin campo de invitación) y, al crear, «Guardá estos códigos» y la pantalla de espera («Tu cuenta espera la aprobación de …»). Para el dueño, «Solicitudes» es el primer grupo de la hoja «Amigos»: una tarjeta por solicitud con **dos botones grandes lado a lado** («Aprobar» y «Rechazar», 44 px; rechazar pide una confirmación suave en el lugar) y las rechazadas plegadas con «Reconsiderar»; un número en el ⋮ del menú y en la fila «Amigos» dice cuántas esperan, y la notificación «Pablo pidió una cuenta» de la campana abre la hoja (evento `telar:abrir-amigos`, como `telar:abrir-ia`) |
