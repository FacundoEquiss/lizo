# 5. Cómo pensar un componente o un flujo nuevo

Lo que distingue el trabajo en Telar no es la cantidad de código sino la profundidad del razonamiento antes de escribirlo.
Este es el método, paso a paso, y tres casos reales contados con el detalle con que se resolvieron.

## El método

1. **Escuchar el problema como lo dijo el dueño** y anotarlo textual. «La barra sube», «no entiendo qué son las tarjetas»,
   «el teclado se cierra solo». La frase del dueño es el criterio de aceptación.
2. **Reproducirlo y medirlo** en el dispositivo que corresponde (escritorio 1440 × 900, iPhone 15 393 × 852, Pixel 8 412 ×
   915, horizontal). Anotar números: px, ms, cantidad de objetos, cuadros por segundo. Si no se reproduce, no se arregla:
   se busca cómo reproducirlo (toques reales por CDP, ventana que se achica como en Android, servidor lento como online).
3. **Encontrar la causa en el código** con archivo y línea. Muchas veces hay más de una: buscá todas antes de arreglar
   (el oscuro naranja tenía tres; el teclado que se cerraba tenía dos y una tercera que afeaba).
4. **Mirar cómo lo resuelve lo que la gente ya conoce** (Miro, FigJam, Trello, Linear, Figma, apps nativas de iOS y
   Android). Copiar el gesto y la convención, no el arte.
5. **Decidir una sola pieza** que resuelva el caso y sus parientes. Antes de crear un componente, buscar si ya existe
   (`ui/`, `movil/ui/`, `vistas/lienzo/barra/`). Si dos lugares necesitan lo mismo, se hace una pieza con props, no dos
   copias.
6. **Diseñar con medidas y estados**: tamaños, separaciones, tokens, los nueve estados (ver
   [sistema visual](02-sistema-visual.md#estados-todos-siempre)), el movimiento del catálogo, teclado, lector de pantalla,
   táctil, tema claro y oscuro, «reducir movimiento», densidad, zoom del navegador al 200 %.
7. **Casos límite por escrito antes de programar**: vacío, uno, mil; texto larguísimo; sin conexión; la IA cambiando lo
   mismo al mismo tiempo; el objeto pegado al borde; rotar el teléfono; teclado abierto.
8. **Implementar en el lugar correcto** (la tienda para el estado, `compartido/` para lo que usan web y servidor, el
   servicio para lo que cambia datos) y **con deshacer**.
9. **Probar como lo usaría el dueño**, mirar las capturas en los dos temas y en el celular, medir el después.
10. **Escribir el porqué** en el comentario de arriba del archivo y en el commit.

Los comentarios de cabecera de los archivos de Telar son el resultado del paso 10: leé el de
`web/src/movil/lienzo/EdicionVisible.tsx`, `web/src/movil/ui/deslizar.ts` o `web/src/vistas/lienzo/barra/BarraContextual.tsx`
y fijate que cuentan **el problema, la decisión y por qué**, no qué hace cada línea.

---

## Caso 1: la barra contextual única

**Archivos:** `web/src/vistas/lienzo/barra/BarraContextual.tsx`, `barra/secciones.tsx`, `barra/MenuMas.tsx`,
`barra/SelectorColor.tsx`, `seleccion.ts`. Commit `051d702` (PT-5). Plan de escritorio 5.8 y decisión F5.

**Lo que se vio (0.1):** cada nodo traía su propia barra, con contenidos y posiciones distintas; la del conector quedaba
**tapada por los objetos** (z-index); con varios objetos aparecían 11 botones en fila; las barras **escalaban con el zoom**
(al 300 % eran enormes).

**El razonamiento:**

- Una barra por nodo es la causa común de los cuatro problemas: no se puede arreglar el z-index, la escala y la
  consistencia nodo por nodo. **Una sola barra, dibujada una vez por el lienzo según la selección**, se aprende una vez,
  sirve para la multiselección, y el celular puede mostrar las mismas secciones en otra forma.
- **Coordenadas de pantalla, encima de todo** (portal, z-index 30): así mide lo mismo con cualquier zoom (40 px de alto,
  medido al 19 % y al 240 %) y nada la tapa.
- **Posición predecible:** centrada sobre el rectángulo de la selección (que incluye el título del marco y la etiqueta del
  conector) a 12 px; si arriba no entra, debajo; si el objeto es más grande que la pantalla, fija arriba al centro. En un
  conector va pegada a su etiqueta o al medio de la línea.
- **No molesta mientras se trabaja:** se esconde al arrastrar, redimensionar o mover el lienzo (también en encuadres y
  zoom con teclado) y vuelve 120 ms después. No aparece con una herramienta de crear activa.
- **Mismo orden siempre:** las secciones salen de una sola lista según el tipo; varios del mismo tipo muestran la barra de
  ese tipo con la cantidad adelante; mezcla, una barra de «varios» con Alinear. El menú ⋯ es **igual para todos** (copiar
  y pegar estilo, duplicar, capas, bloquear, borrar).
- **Secciones sueltas** (`secciones.tsx`), sin la caja flotante y con `tam="grande"`: así el celular arma su barra de abajo
  con las mismas piezas (`ContenidoBarra` con `acoplada`), sin duplicar nada.
- **Teclado:** `role="toolbar"`, foco itinerante, `Esc` vuelve al objeto, `Alt+F10` entra. Todo lo de la barra está
  también en el menú contextual.
- **Deshacer:** los cambios van por `cambiarDatos()`, un paso de deshacer por cambio; con «recordar el último estilo», lo
  elegido queda de fábrica para el próximo objeto.
- **Se borró lo viejo** en el mismo cambio (las barras de cada nodo, la de varios y el `EdgeToolbar`). Una pieza nueva no
  convive con la vieja.

**La lección:** cuando varios síntomas comparten forma, buscá la decisión de estructura que los produce y cambiala una vez.

---

## Caso 2: la hoja que se cierra desde cualquier parte

**Archivos:** `web/src/movil/ui/deslizar.ts`, usado por `movil/ui/HojaInferior.tsx` y `movil/tarjeta/HojaTarjeta.tsx`.
Commit `40a3bff`.

**Lo que se vio:** las hojas del celular solo se cerraban arrastrando la barrita de arriba (el plan lo había decidido así
para que un scroll hacia arriba no cerrara la hoja). En las apps nativas se cierran desde cualquier parte, y el dueño
esperaba eso.

**El razonamiento:** el conflicto real es entre **dos gestos que empiezan igual** (dedo hacia abajo): desplazar el
contenido o cerrar la hoja. Se resolvió como lo hace iOS:

- **Se decide con el primer movimiento** (los primeros 3 px). Hacia arriba, de costado, o si lo que está bajo el dedo
  todavía se puede desplazar hacia atrás (`scrollTop > 0` en algún ancestro con scroll): el gesto es del navegador y no se
  toca. Hacia abajo y con todo arriba de todo: es de la hoja, y recién ahí se cancela el scroll.
- **Dónde NO arranca:** campos de texto (seleccionar, mover el cursor), lo que maneja su propio gesto (`touch-action:
  none`: el agarre, deslizadores, superficies con pellizco), lo que se arrastra para ordenar, y `[data-sin-deslizar]` (la
  salida de emergencia para casos nuevos).
- **Mismos umbrales que el agarre:** más de 96 px o más de 500 px/s cierra; si no, vuelve con el mismo resorte. En
  horizontal (panel derecho), lo mismo hacia la derecha.
- **Después de arrastrar no llega el clic** al botón donde empezó el dedo (`tragarClic`, 350 ms en fase de captura).
- **Eventos táctiles** (no de puntero) porque solo ellos dejan cancelar el scroll; el mouse sigue arrastrando desde el
  agarre.
- **Peso:** la vuelta es un resorte propio de 15 líneas (`volverACero`) en vez del `animate()` de motion, que sumaba
  ~8 KB al arranque del teléfono. Cada KB del arranque en el celular cuenta (meta ≤ 230 KB).
- **Misma API** para `HojaInferior`: nadie que usa una hoja tuvo que cambiar nada.

**La lección:** un gesto nuevo se diseña como una tabla de «quién se queda con el dedo» y se prueba contra todo lo que
puede estar debajo (listas, campos, deslizadores, cosas ordenables).

---

## Caso 3: el teclado que se abría y se cerraba solo

**Archivos:** `web/src/vistas/lienzo/Lienzo.tsx` (`aNodo`), `web/src/movil/lienzo/EdicionVisible.tsx`,
`web/src/vistas/lienzo/texto/ajuste.ts`, `movil.css`. Commit `1d3094e`. Y su pariente `c3dde72` (`movil/detectar.ts`,
`movil/teclado.ts`, `web/index.html`).

**Lo que se vio:** al agregar una nota, un texto o una tarjeta en el lienzo desde el teléfono, el teclado se abría y se
cerraba enseguida, y no se podía escribir. Pasaba sobre todo online.

**Cómo se encontró:** se reprodujo con **toques reales por CDP** y la ventana achicándose como en Android. «Sobre todo
online» fue la pista: el servidor tarda, y la respuesta llega mientras se escribe. Salieron **dos causas y una tercera**:

1. **El nodo perdía su medida.** Mientras se escribe, el objeto cambia (termina la animación de «recién creado» a los
   300 ms, el servidor contesta que lo guardó, la IA lo toca) y el lienzo armaba el nodo de React Flow de nuevo **sin**
   `measured`. React Flow lo toma por «sin medir» y lo esconde un cuadro (`visibility: hidden`); Chrome le saca el foco a
   un texto escondido y el teclado se cierra. Arreglo: `aNodo` conserva `previo.measured` (si el tamaño cambió, React Flow
   lo vuelve a medir igual). Arregló además un parpadeo en la PC.
2. **El objeto quedaba debajo del teclado y se desmontaba.** El teclado de Android achica la ventana; React Flow dibuja
   solo lo visible (`onlyRenderVisibleElements`) y desmontaba el objeto que quedaba abajo: editor destruido, foco perdido,
   teclado cerrado, nota vacía. Arreglo: **`EdicionVisible`**, pieza de la capa del celular. Al entrar a escribir, lleva la
   vista (220 ms) para que el objeto quede en la parte que el teclado no va a tapar, con letra legible (zoom de 0,9 a 1,4).
   Y **en el mismo evento `resize` del teclado, antes de que React Flow mida el lienzo nuevo**, si el objeto quedó afuera,
   lo reacomoda sin animación: así nunca sale de lo que React Flow dibuja. Al terminar, el zoom no vuelve (marea).
3. **La letra de la nota salía al máximo** y la nota crecía hacia abajo: la copia del texto que se mide era editable, y la
   regla táctil de «16 px en los campos» le fijaba la letra. Arreglo: `ajuste.ts` mide una copia no editable.

El pariente (`c3dde72`): con el teclado y la franja de autocompletar, un teléfono de 360 px quedaba con 340 de alto (más
ancho que alto) y la app creía que estaba **acostado** (riel lateral, hojas de costado). Arreglo: contar el alto **sin
teclado** para cada ancho (el teclado cambia el alto, nunca el ancho).

**La lección:** en el celular, lo que se escribe es frágil: cualquier cosa que desmonte, esconda o mueva el elemento con
foco cierra el teclado. Probá con red lenta, con la IA cambiando el objeto y con el objeto en la mitad de abajo.

---

## Plantilla para un componente nuevo

Copiala al plan o al cuerpo del commit y completala:

```
Problema (palabras del dueño):
Dónde se ve (dispositivo, medida):
Causa en el código (archivo:línea):
Cómo lo resuelven otros:
Decisión (una pieza) y por qué:
Medidas y tokens:
Estados: reposo · hover · foco · apretado · activo · deshabilitado · vacío · cargando · error
Movimiento (del catálogo):
Teclado y lector:
Celular (táctil, hoja, teclado, horizontal):
MCP (¿lo puede hacer la IA? ¿con qué herramienta?):
Casos límite:
Deshacer:
Terminado cuando (capturas, números):
Queda afuera (y por qué):
```

## Un flujo nuevo, además

- **Que la IA pueda hacerlo igual** (herramienta MCP con el mismo modelo de datos) y que se vea en vivo cuando lo hace.
- **Que se entienda sin explicación**: los nombres dicen de dónde viene cada cosa («Tarjetas del Kanban», no «Tarjetas»;
  decisión F8). Si hace falta explicar, la explicación va en la interfaz, en una línea.
- **Un paso menos** siempre que se pueda: en el celular, crear en el centro de la vista (sin elegir herramienta y después
  tocar) porque «dos pasos con un estado invisible en el medio es justo lo que confunde».
- **Reversible:** deshacer o archivar, nunca borrar.
- **Lo que se muestra una sola vez** (códigos de recuperación, el enlace de una invitación o de un restablecimiento) se guarda en el servidor solo como hash,
  sale en la respuesta que lo crea con `Cache-Control: no-store`, y la pantalla lo dice («es la única vez que lo ves»), ofrece copiarlo y bajarlo y no deja
  seguir sin confirmar. Si se pierde, se genera otro: nunca se «vuelve a mostrar».


---

## Caso 4: agregar una tarjeta (pie fijo, encabezado y compositor)

**Archivos:** `web/src/vistas/kanban/Compositor.tsx`, `kanban/alta/` (`borrador.ts`, `Pildoras.tsx`, `analizar.ts`),
`Kanban.tsx` (`ListaKanban`), `kanban.css`, y en el celular `movil/kanban/ComposerRapido.tsx` y `KanbanMovil.tsx`.

**Lo que se vio (frase del dueño):** «si querés agregar una tenés que deslizar hasta abajo de todo», «la barra del título
está desbalanceada entre el título, el número y los tres puntitos», «me sale "alta etiqueta" y después no se lee más nada.
Agregar es muy pobre».

**Causas:** el botón y el compositor vivían *dentro* del contenedor que se desplaza (con 64 tarjetas, a 6.400 px); el
encabezado mezclaba una píldora de 22 px, un botón de 26 con 50 % de opacidad y ningún atajo a la vista; la ayuda
(`!alta #etiqueta @yo error:`) era una sintaxis que había que saber, en una sola línea que se cortaba.

**Decisiones:**

- **El pie queda fuera de lo que se desplaza** (`.lista__pie`, `flex: 0 0 auto`): «Agregar tarjeta» siempre a la vista. Ojo:
  con `flex-shrink` en el pie, una lista de 64 tarjetas lo aplasta a cero (se reparte en proporción al tamaño).
- **Encabezado:** título, número, «+» y «⋯» comparten centro; los dos botones son círculos del mismo tamaño (28 en escritorio,
  36 con zona de 44 en táctil); el título es lo único que cede (puntos suspensivos). El ancho de la lista no cambia.
- **El compositor es un formulario entero, no un cuadro con ayuda:** título (foco), motivo (el porqué), tipo, prioridad y
  etiquetas (con crear al vuelo). La sintaxis rápida sigue andando y **se ve entendida** en las píldoras: lo que se ve es lo
  que se crea. Lo elegido con las píldoras gana sobre el texto. Una sola pieza de datos (`alta/borrador.ts`) para PC y celular.
- **Dónde se abre:** en la PC, en la propia lista (el pie crece hacia arriba y las tarjetas se desplazan; entra siempre en
  pantalla). En el celular, la hoja inferior de siempre (un compositor al pie quedaría bajo el teclado de iOS): el pie y el
  «+» de la lista abren la hoja con esa lista elegida (`Kanban` recibe `alAgregar`; el escritorio no importa nada del celular).
- **Teclado:** `Enter` agrega y deja abierto (tipo, prioridad y etiquetas quedan para la siguiente), `Ctrl/⌘+Enter` agrega y
  cierra, `Mayús+Enter` pasa al motivo, `Esc` cierra y deja lo escrito de borrador. Tocar afuera cierra solo si está vacío, y
  **al soltar (click), no al apretar**: cerrarlo al apretar corre la lista justo cuando alguien empieza a arrastrar.
- **Errores:** si no se pudo agregar, el título queda a la vista con «Reintentar»; no se pierde nada.

**Trampas que aparecieron:** (1) el clic que abre el compositor llega al oyente de «tocar afuera» que se registra en ese
mismo clic: se ignora lo anterior a `abrio`; (2) la opción «Crear etiqueta» desaparece del DOM con su propio clic, así que
«¿fue adentro?» no se puede preguntar con `closest`: si el elemento ya no está conectado, no cuenta como afuera.

**La lección:** si un botón tiene que estar siempre a la mano, no puede vivir dentro de lo que se desplaza.

## Caso 5: Hecho que se acumula («Ver N anteriores» y el archivo automático)

**Archivos:** `compartido/hecho.ts` (lo que comparten web, servidor y MCP), `web/src/vistas/kanban/Kanban.tsx` (`ListaKanban`),
`kanban/ArchivoHecho.tsx` (la opción), `servidor/src/dominio/servicio.ts` (`archivarHechasViejas`), `archivo-hecho.ts` (el barrido
del cron) y `supabase/migrations/20261207090000_archivo_hecho.sql`.

**Lo que se vio (frase del dueño):** «En Hecho se acumula todo lo listo; ¿qué pasa cuando haya 100 tarjetas listas?».

**Decisiones:**

- **Una lista de categoría `hecho` se ordena por cuándo llegó cada tarjeta** (`fechas.completada`; si no hay, `actualizadaEn`), la
  última arriba, y muestra 20 (`PAGINA_HECHO`). «Ver N anteriores» suma de a 20 en el lugar, con N = las que faltan. Es de lo que se
  desplaza: el pie «Agregar tarjeta» sigue fijo. El contador del encabezado dice el total real; con un filtro se filtra sobre
  todas y se muestran las primeras 20 que coinciden (`coinciden/total`).
- **Al llegar a Hecho desde otra lista, la tarjeta queda arriba** (el servidor pone `completada = ahora`; la tienda lo repite al
  instante). Dentro de Hecho no se reordena a mano (`strategy` sin movimiento; el soltar dentro de la misma lista no cambia nada).
  El «+»/«Agregar tarjeta» también la deja arriba (la lista sube al principio, no al final).
- **El archivo automático usa el archivado de siempre** (reversible, «nada se borra»): 7 / 14 / 30 / 60 días o nunca, de fábrica
  30 para todos los tableros (sin ajuste guardado valen los 30: no hace falta migrar datos). Se guarda en
  `tableros.ajustes.archivoHecho.dias`, se cambia en el menú del tablero, en el «⋯» de la lista de Hecho o, en el celular, en las
  opciones del tablero. Lo firma «Telar» (actor `sistema`), una entrada en la actividad por pasada y **un solo aviso en la
  campana por tablero y plazo** (tipo `aviso`).
- **Qué no archiva nunca:** lo que no está en una lista de Hecho, lo que tiene una checklist sin terminar y lo que tiene un
  vínculo «bloquea» (en cualquier sentido) con una tarjeta que sigue abierta. Restaurar una vieja la deja en Hecho «ahora»: no se
  vuelve a archivar sola.
- **Cuándo corre:** perezoso al abrir el tablero (`leerTableroCompleto`), a lo sumo una vez por hora por tablero (un UPDATE de
  `archivo_hecho_en` toma el turno), y de respaldo en el cron. Nunca rompe abrir el tablero: si falla (por ejemplo, la migración
  todavía no está aplicada online), se sigue sin archivar. Siempre fuera de la tanda de un trabajo de la IA.
- **MCP:** `leer_tablero` trae las 20 más recientes de cada Hecho con `cantidad` y `ocultas`; `hechas_desde`, `hechas_cantidad` e
  `incluir_hechas` piden más.

**La lección:** una lista que solo crece necesita un orden con sentido, un tope a lo que muestra y un destino reversible para lo
viejo; y que lo que Telar hace solo se vea firmado.

## Caso 6: crear un tablero (el tipo y las vistas)

**Archivos:** `compartido/vistas.ts` (el modelo), `servidor/src/dominio/servicio.ts` (`crearTablero`, `actualizarTablero`,
`resolverTablero({ vista })`), `servidor/src/mcp/proyectos.ts`, `web/src/ui/TipoTablero.tsx` (`ElegirTipoTablero`, `IconoTablero`),
`web/src/vistas/DialogoProyecto.tsx` (Nuevo tablero), `vistas/lateral/PanelVistas.tsx` y `FilaTablero.tsx`, `BarraSuperior.tsx`,
`movil/ui/BarraInferior.tsx`, `movil/navegacion/SelectorTablero.tsx`, `estilos/vistas.css`.

**Lo que se vio (frase del dueño):** «No me gusta que se crean paneles al pedo solo para hacer diagramas… creaste un espacio
solo para el diagrama y la parte de Kanban y la de Diseño quedaron vacías. Que se creen secciones específicas: solo diseño,
solo diagrama, solo tablero Kanban, o los tres juntos, según la necesidad».

**Causa:** todo tablero nacía con las tres vistas (pestañas, listas y hoja de Diseño) aunque se usara una.

**Decisiones:**

- **Un tablero tiene `vistas`** (subconjunto de `kanban`, `lienzo`, `diseno`, al menos una) en `tableros.ajustes.vistas`: sin
  migración, y sin el ajuste son las tres (los tableros de antes no cambian). Una sola función lee y valida (`leerVistas`,
  `problemaEnVistas`) para la web, el servidor y el MCP.
- **Cuatro tipos con ícono y una frase** al crear: **Tablero** (solo Kanban, de fábrica), **Diagrama** (solo lienzo), **Diseño**
  (solo la hoja de diseño) y **Completo**. Cada ícono es el de la pestaña de esa vista. Una línea dice que Diseño es del proyecto
  (un tablero «Diseño» es la entrada a esa hoja y no crea un sistema nuevo; se arma vacío al abrirlo la primera vez). La misma
  pieza sirve en el diálogo (PC), en la hoja (celular) y, compacta, en «Nuevo proyecto» (el primer tablero).
- **No se crea nada de más:** las listas solo si hay Kanban; un diagrama ni listas ni tarjetas; uno de Diseño ni listas ni lienzo ni
  un sistema nuevo. Sumar Kanban a un tablero que nunca tuvo listas le da Por hacer, En curso y Hecho (una vez).
- **La interfaz muestra solo lo que el tablero tiene:** con una vista no hay pestañas; en el celular la barra de abajo trae solo esas
  vistas (y «+» solo si hay a dónde agregar); la dirección de una vista que falta redirige a la primera que hay; el lienzo de un
  diagrama no ofrece tarjetas del Kanban; la paleta y los atajos `G K/L/D` tampoco.
- **Cambiar de opinión sin riesgo:** `⋯` → **Vistas…** (tres interruptores; siempre queda una). Sacar una vista con contenido
  pregunta ahí mismo y dice cuánto hay; **nada se borra**: queda guardado y vuelve al sumarla.
- **MCP:** `tipo` o `vistas` al crear (de fábrica «tablero»), `vistas` al cambiar; las lecturas las devuelven; lo de una vista que
  falta da un error que dice cuál y el `actualizar_tablero` que la suma; sin nombre de tablero se toma el primero que tiene la vista.

**Trampas que aparecieron:** (1) dos hojas del celular una dentro de la otra: cerrar las dos y navegar a la vez hace que el
`history.back()` de la segunda se coma la navegación; se cierran en orden con `cerrarYLuego` anidado. (2) «Diseño» aparece también
en la frase de «Completo»: las pruebas buscan la opción por su nombre exacto. (3) Los guiones de prueba que arman un proyecto para
usar el lienzo ahora piden `tipo: 'completo'` (de fábrica un tablero es solo Kanban).

**La lección:** si algo se crea siempre «por las dudas», se vuelve ruido: que cada cosa nazca de lo que la persona pidió, y que
quitarla sea reversible.
