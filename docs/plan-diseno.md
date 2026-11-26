# Telar «Diseño»: investigación de Figma y plan de producto, diseño e implementación

Fecha: 24/11/2026 · Autor: planificador (Fable 5.2) · Lo ejecuta otro agente (Opus 5.5) **tal cual**.
Se construye **después** de juntar la v0.2 (planes `plan-v0.2-escritorio.md` y `plan-v0.2-movil.md`).

Cómo leerlo: cada punto trae el problema, **el porqué** de la solución, el diseño con medidas, la implementación con
archivos y cómo darlo por terminado. **(decisión)** = ya está decidido, no se vuelve a discutir. **(verificar)** = el
ejecutor lo comprueba en el código antes de escribir. **(dueño)** = necesita un sí del dueño antes de hacerse.

---

## 0. Resumen

### 0.1 Qué pidió el dueño

1. (24/11, textual) *"Esto no me gusta: cómo se ve lo de interfaz, que haya texto, es muy triste. Quiero (…) la sección
   design, que emule una especie de Figma (…) en donde podamos desplegar con código los elementos que tenemos del código
   Restaurant City: los iconos, la paleta de colores, las tipografías, los textos, los pesos, el lenguaje de mobile nuevo,
   el lenguaje de PC. Todo, todo, como corresponde a una interfaz de diseño de verdad."*
2. (mismo día, ampliación) **El MCP tiene que funcionar excelente con Diseño**: Claude tiene que poder hacer por MCP todo
   lo que hace una persona (leer, crear, editar, aplicar estilos y variantes, sincronizar, comentar) **y ver lo que hizo**.
3. (mismo día, ampliación) **Diseño no es solo de Restaurant City**: también la web de Yaguar, Brain OS y las campañas
   publicitarias planificadas en el tablero. Modelo e importación genéricos por proyecto, **diseño libre** con tamaños de
   piezas publicitarias, plantillas y variantes, vínculo con tarjetas del Kanban y exportación.

### 0.2 Qué es «Diseño» en una frase

Una vista más de cada proyecto (al lado de Kanban y Lienzo) con forma de herramienta de diseño: páginas, lienzo con
marcos, capas, piezas, inspector con propiedades y código, regla para medir y exportación; donde **cada marco es HTML y
CSS de verdad** dibujado en un marco aislado, que tanto una persona como Claude (por MCP) pueden leer, crear, editar,
ver y exportar. El sistema de diseño de un proyecto se **importa de su código** (Restaurant City es el primero) y encima
se diseña libre.

### 0.3 Las 12 decisiones y su porqué

| # | Decisión | Por qué |
|---|---|---|
| D1 | **El contenido de un marco es HTML + CSS** (no un formato vectorial propio). Las "capas" son el árbol de elementos. | Es lo que pidió el dueño ("desplegar con código"), es el idioma que Claude escribe mejor y con menos errores, es lo que ya es la interfaz del juego y cualquier web (se importan sin traducir) y el navegador ya lo dibuja perfecto: no hay que escribir un motor de dibujo. Un formato vectorial propio obligaría a construir el 80 % caro de Figma antes de mostrar nada. |
| D2 | Cada marco se dibuja en un **`<iframe srcdoc>` con `sandbox="allow-same-origin"` (sin `allow-scripts`)** y una política de contenido cerrada. | Solo un iframe da un *viewport* real (844×390, 1080×1080…): el CSS del juego usa `position: fixed`, `vw`, `@media` y zonas seguras, que en un Shadow DOM no funcionan. Sin `allow-scripts` no corre ningún código; con `allow-same-origin` Telar puede leer el DOM y los estilos calculados para el inspector, la regla y la edición (probado en Chrome, sección 4.3). |
| D3 | **El juego (o el repo de cada proyecto) es la fuente de verdad de lo importado.** Lo importado se mira, se mide, se anota y se copia; no se edita. Los cambios vuelven como **tarjeta del Kanban con su porqué**, que Claude aplica en el código y después se vuelve a sincronizar. | El CSS del juego no tiene una capa de tokens (324 colores escritos a mano en 239 KB): escribir de vuelta en automático sería adivinar. Además el juego tiene reglas duras de publicación y de fidelidad a RC que tiene que pasar por el dueño. La tarjeta con porqué es justo la idea central de Telar. |
| D4 | **Modelo genérico por proyecto**: páginas, marcos, ítems del sistema (tokens, estilos de texto, activos, fuentes, hojas, piezas, textos, plantillas), comentarios y vínculos. Nada dice "Restaurant City" en las tablas ni en la interfaz. | El dueño va a tener Yaguar, Brain OS y campañas. RC es un *perfil* de importación más. |
| D5 | **Importador por perfiles con dos fuentes**: archivos de un repo (análisis estático del CSS, fuentes, imágenes y textos) y páginas (un navegador sin cabeza abre una URL local o pública y saca una **instantánea** del DOM con sus hojas de estilo). | "Desde cualquier repo o web". La interfaz del juego se arma con JavaScript contra el estado de la partida: la única forma fiel y segura de mostrarla sin correr su código en Telar es fotografiar el DOM que el código real generó y dibujarlo con su CSS real. Lo mismo sirve para una web cualquiera. |
| D6 | **Un solo armador de documentos** (`compartido/diseno/documento.ts`) que usan el iframe de la web, el render del servidor y la exportación. | Garantiza que lo que ve la persona, lo que ve Claude por MCP y lo que se exporta sea idéntico. |
| D7 | **Servicio de render en el servidor** (Chromium sin cabeza) para `ver_diseno`, miniaturas y exportar PNG/JPG. | "Que Claude vea lo que hizo" es lo que convierte al MCP en un diseñador y no en alguien que escribe a ciegas; y un PNG sacado por un navegador real es exacto. Ver 7.4 por el costo y el plan B. |
| D8 | **MCP primero: 13 herramientas, pocas y potentes**, con operaciones por lote, respuestas en texto compacto, errores que dicen qué hacer y captura incluida. Todo lo que hace una persona tiene su herramienta. | Pedido 2 del dueño. Diseñar el MCP junto con el modelo (y no después) evita herramientas débiles. |
| D9 | **v1 = ver, componer con código, ajustar y exportar.** La persona crea marcos con tamaños prefijados, usa plantillas, edita textos, colores, tipografías, imágenes y medidas desde el inspector, mueve y redimensiona capas sueltas, arma variantes y exporta. **Dibujar con el mouse como en Figma (rectángulos, pluma, auto layout a mano) es v2.** | La manipulación directa completa es lo más caro de una herramienta de diseño. Con "Claude arma, vos ajustás" el valor llega ya; lo otro se suma sin rehacer nada porque el modelo (HTML + CSS + capas con id) no cambia. |
| D10 | El lienzo usa **React Flow** (ya está en Telar) con un nodo por marco; adentro de cada marco manda una **capa de selección propia** que consulta al iframe. | Mismos gestos, mismas preferencias de rueda y mismo minimapa que el Lienzo; no se suma motor. |
| D11 | **Solo se dibuja lo visible**: miniatura primero, iframe vivo solo para marcos en pantalla con zoom suficiente, tope de 12 iframes vivos, hojas de estilo compartidas por URL con hash. | Medido: 40 iframes con 400 KB de CSS cada uno montan en 0,7 s; con el tope y las miniaturas el costo es constante aunque haya cientos de marcos. |
| D12 | El material original de RC vive **solo en la base** (`tablero.archivos`, detrás del login) y nunca en el repo de Telar ni en los archivos públicos de Vercel. | El dueño lo autorizó para uso personal; Telar es personal y entra solo él, pero lo estático de Vercel es público. |

### 0.4 Qué entra en cada versión

| | v1 (este plan) | v2 "diseñar con la mano" | v3 "estudio" |
|---|---|---|---|
| Idea | Ver, componer con código, ajustar, exportar. MCP completo. | Manipulación directa y sistema editable a fondo. | Flujos, automatización y trabajo en equipo. |
| Detalle | Sección 5 a 9 | Sección 13.1 | Sección 13.2 |

---

# Parte I — Qué hace que Figma sea Figma

Investigación con la documentación oficial y los artículos de ingeniería de Figma (fuentes al final de esta parte). Se usa
**solo lo funcional**: Telar no copia ni la marca ni el arte de Figma.

## 1. Lo esencial y lo accesorio

### 1.1 Las ocho ideas que lo definen

| # | Idea | Qué es | Por qué importa | En Telar |
|---|---|---|---|---|
| 1 | **Todo vive en un lienzo infinito, ordenado en marcos y páginas** | El archivo es un árbol: páginas → marcos (con tamaño de dispositivo) → capas. Los marcos se ven todos juntos, uno al lado del otro. | Ver el sistema entero de un vistazo y comparar pantallas lado a lado es lo que una lista de notas no da. Es exactamente la queja del dueño. | v1, entero. |
| 2 | **Tres zonas fijas: capas a la izquierda, lienzo al medio, propiedades a la derecha** | Navegación (páginas, capas, assets), el trabajo, y el inspector de lo seleccionado. Figma probó paneles flotantes en su rediseño (UI3) y **volvió a los fijos** por pedido de los usuarios. | Se aprende una vez: "lo selecciono acá, lo veo allá". Nunca hay que buscar dónde está una propiedad. | v1. Paneles fijos, sin contornos. |
| 3 | **Componentes, variantes e instancias** | Una pieza maestra con propiedades (variante, booleano, texto, cambio de instancia); las instancias la siguen y solo guardan sus diferencias. Las variantes se muestran juntas en una grilla. | Es lo que hace que sea un *sistema*: cambiás el botón una vez y cambia en todos lados; y ves todos los estados juntos. | v1: piezas con variantes y propiedades, instancias que siguen a la maestra. Editor visual de propiedades, v2. |
| 4 | **Estilos y variables con modos** | Variables (color, número, texto, booleano) en colecciones, con un valor por modo (claro/oscuro, celular/PC) y alias entre ellas; estilos de texto y de efecto. | Nombrar las decisiones ("azul de RC", no `#38bde6`) y poder cambiar un valor en un solo lugar. | v1: tokens con grupos, alias y modos; estilos de texto. Para lo importado se muestran además los valores **sin nombre** (lo que falta ordenar). |
| 5 | **Inspección: el diseño como especificación** (Dev Mode) | Al seleccionar: medidas, modelo de caja, colores, tipografía, el código (CSS, y otros), los valores se copian con un clic; con `Alt` se miden distancias a cualquier otra capa; se marcan cosas "listas para desarrollar" y se comparan versiones. | Convierte el dibujo en datos exactos. Es lo que el dueño llama "interfaz de diseño de verdad". | v1, es el corazón: como el contenido **ya es** código, el "Dev Mode" de Telar muestra el CSS real con archivo y línea, no uno generado. |
| 6 | **Auto layout y restricciones** | Los marcos acomodan a sus hijos (dirección, separación, relleno, alineación) y los hijos declaran cómo se estiran. | Los diseños se adaptan al contenido y al tamaño. | Es flexbox/grid de CSS: en v1 se **lee** en el inspector y Claude lo escribe; los controles para editarlo a mano, v2. |
| 7 | **Multijugador y enlace** | Un archivo, una URL; todos ven lo mismo en vivo; comentarios anclados; historial de versiones. Técnicamente: un servidor central, última escritura gana por propiedad, orden con índices fraccionarios. | No hay "archivo final_v3": hay un lugar. | v1: URL por marco y por capa, cambios de la IA en vivo (ya existe en Telar), comentarios anclados, revisiones por marco. Cursores de otras personas: v3 (hay un solo dueño; el "otro" es la IA). |
| 8 | **Se siente instantáneo** | Motor propio en WebGL/WebGPU; zoom hacia el cursor; nada espera; todo tiene tecla. | La fluidez es la mitad del producto. | v1: reglas de sensación de 1.3. Sin motor propio: el DOM alcanza si se dibuja solo lo visible (sección 9). |

### 1.2 Pieza por pieza: esencial, accesorio y qué hace Telar

| Pieza de Figma | ¿Esencial? | Por qué | Telar v1 |
|---|---|---|---|
| Lienzo infinito, zoom y desplazamiento | Esencial | Idea 1 | Sí |
| Páginas | Esencial | Separan temas sin perder el conjunto | Sí, por proyecto, de tres tipos (lienzo, sistema, tabla) |
| Marcos con tamaño prefijado (teléfono, escritorio, redes) | Esencial | El marco es la unidad de trabajo y de exportación | Sí, con prefijados de dispositivos y de piezas publicitarias |
| Secciones (agrupar marcos con un título) | Útil | Ordenan una página larga | Sí, como título de grupo |
| Panel de capas (árbol, ocultar, bloquear, renombrar) | Esencial | Es el mapa de lo que hay | Sí: el árbol de elementos, con nombres legibles |
| Panel de assets (componentes para arrastrar) | Esencial | Puerta de entrada al sistema | Sí ("Piezas"): buscar e insertar. Arrastrar al marco, v2 |
| Pestaña Design (posición, tamaño, relleno, trazo, efectos, texto) | Esencial | Idea 2 | Sí, leyendo estilos calculados; edición de las propiedades comunes |
| Pestaña Prototype (enlaces entre marcos, transiciones) | Accesorio hoy | Sirve para probar flujos; no para ver un sistema | No. v3. En su lugar, modo **Probar** (los estados `:hover` y `:active` reales) |
| Dev Mode / Inspect (código, medidas, copiar valores) | Esencial | Idea 5 | Sí: pestaña **Código** |
| Medir con `Alt` | Esencial | Es el gesto más usado al revisar | Sí, igual |
| Componentes, variantes, propiedades, instancias | Esencial | Idea 3 | Sí (lectura y uso; creación por MCP y "Convertir en pieza") |
| Variables, colecciones, modos, alias | Esencial | Idea 4 | Sí |
| Estilos de texto, color y efecto | Esencial | Idea 4 | Texto y color sí; efectos como tokens de sombra |
| Auto layout / restricciones | Esencial en Figma | Idea 6 | Se lee; se edita a mano en v2 |
| Tipografía (familia, peso, tamaño, interlineado, espaciado) | Esencial | Es la mitad de un sistema | Sí, con escala y especímenes |
| Exportar (PNG, JPG, SVG, PDF; 1x, 2x, 3x) | Esencial | El diseño tiene que salir | PNG, JPG y SVG; PDF en v2 |
| Comentarios anclados | Útil | Conversar sobre un punto exacto | Sí, simples (un hilo por pin) |
| Historial de versiones | Útil | Volver atrás, comparar | Revisiones por marco y registro de cada importación con sus cambios |
| Cursores en vivo, seguir a alguien | Accesorio para un solo dueño | — | v3 |
| Atajos para todo y acciones rápidas | Esencial | Idea 8 | Sí; las acciones entran en la paleta `Ctrl/⌘+K` que ya existe |
| Edición vectorial (pluma, booleanas) | Esencial en Figma, no acá | Telar no dibuja ilustraciones: arma interfaces y piezas con código e imágenes | No. SVG pegado o subido se muestra y se exporta |
| Plugins, widgets, comunidad | Accesorio | — | No: el "plugin" es Claude por MCP |
| FigJam, Slides, Sites, Make | Otro producto | — | No (el Lienzo de Telar ya cubre la pizarra) |

### 1.3 Los detalles de sensación (y cómo se copian sin copiar el arte)

1. **El zoom va hacia el cursor** y nunca pierde lo que estabas mirando. `Ctrl/⌘ + rueda` o pellizco; `Mayús+1` ve todo,
   `Mayús+2` la selección, `Mayús+0` al 100 %.
2. **Los controles miden lo mismo con cualquier zoom** (marco de selección de 1 px, manijas, etiquetas). En Telar: la
   variable `--z` de la v0.2.
3. **Pasar el mouse resalta al instante**, sin transición: la precisión no se anima. Lo que sí se anima es lo que cambia
   de lugar (paneles, encuadres).
4. **Clic selecciona el marco; doble clic entra; `Ctrl/⌘ + clic` va directo a la capa de más adentro.** `Enter` baja a
   los hijos, `Mayús+Enter` sube al padre, `Tab` pasa al hermano. `Esc` sube un nivel.
5. **Capas y lienzo son el mismo objeto**: pasar por una fila del árbol resalta la capa en el lienzo y al revés.
6. **Todo valor se copia con un clic** y avisa con un destello corto.
7. **El nombre del marco flota arriba a la izquierda**, chico, y es de donde se lo agarra.
8. **Las distancias se ven en rojo, las selecciones en azul**: dos colores con un solo significado cada uno.
9. **Minimizar la interfaz** con una tecla para quedarse solo con el lienzo.
10. **Nada bloquea**: mientras algo carga se ve su miniatura; nunca un cartel de "cargando" encima del lienzo.

### 1.4 Fuentes

- Figma, ayuda oficial: *Guide to Dev Mode* (panel de inspección, código, comparar cambios, estados "listo para desarrollar",
  recursos y exportación) — https://help.figma.com/hc/en-us/articles/15023124644247
- Figma, ayuda oficial: *Explore component properties* (variante, booleano, texto, cambio de instancia, ranura; conjuntos y
  propiedades expuestas) — https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties
- Figma, ayuda oficial: *Guide to variables* (colecciones, modos, alias, alcance) — https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma
- Figma, ayuda oficial: medir distancias con `Alt` y anotaciones — https://help.figma.com/hc/en-us/articles/22012921621015
- Figma, ayuda oficial: *Navigating UI3* (panel de navegación, panel de propiedades, minimizar) — https://help.figma.com/hc/articles/23954856027159 ;
  y el hilo oficial del foro "Fixed panels are back" (la vuelta a los paneles fijos).
- Evan Wallace (cofundador): *Building a professional design tool on the web* (motor propio en WebGL, texto y composición
  propios, zoom con el gesto del trackpad) — https://madebyevan.com/figma/building-a-professional-design-tool-on-the-web/
- Evan Wallace: *How Figma's multiplayer technology works* (árbol de objetos con propiedades, servidor central, última
  escritura gana por propiedad, índices fraccionarios) — https://madebyevan.com/figma/how-figmas-multiplayer-technology-works/
- Figma, blog: *Figma rendering: Powered by WebGPU* — https://www.figma.com/blog/figma-rendering-powered-by-webgpu/

Lo que **no** se pudo confirmar en la documentación y por eso el plan no depende de eso: la lista exacta de lenguajes del
código generado y los atajos secundarios (contornos, vista de píxeles). Los atajos de Telar son propios (sección 6.9).

---
# Parte II — El plan

## 2. Lo que hay hoy (medido)

### 2.1 Telar
- Vistas por tablero: `kanban` y `lienzo` (`web/src/estado/ruta.ts`, pestañas en `BarraSuperior.tsx`, escena en `App.tsx`).
  El Lienzo se carga con `lazy()`.
- El marco «Interfaz» del lienzo son notas de texto: describe la interfaz, no la muestra. Es la queja del dueño.
- Archivos: `Almacen` (`servidor/src/datos/almacen.ts`): carpeta en local, tabla `archivos` (bytea) online. Se sirven en
  `/archivos/*`, que online pide sesión o clave (`api.ts`, 730). Una función de Vercel atiende `/api`, `/mcp` y `/archivos`;
  lo estático (`dist/web`) es **público** y lleva `x-frame-options: DENY` (no afecta a `srcdoc`).
- Importar con clave ya existe (`/api/importar/archivo` de a un archivo y `/api/importar/discord-json`): se copia el patrón.
- MCP: 16 herramientas en `servidor/src/mcp/herramientas.ts` (arreglo `HERRAMIENTAS`), mismas para HTTP y stdio.
- Eventos en vivo: `Evento.tipo` en `compartido/tipos.ts`; online la web pregunta cada 3 s.

### 2.2 El juego como sistema de diseño (rama `ccr-ac61dbdf-s4s7ws`, solo lectura)

| Qué | Dónde | Medido |
|---|---|---|
| Hojas de estilo de la interfaz | `juego3d/ui/{ui,tienda,barrio,hud-mobile,ajustes,empleados}.css` | 6 archivos, 239 KB, ~1.700 reglas |
| Colores | escritos a mano en esas hojas | **324 hexadecimales distintos** (el blanco, 148 veces); 80 `rgba()` |
| Variables CSS declaradas | `.rcui { --rc-azul… }`, `--td-*` (tienda), `--hm-*` (HUD del celular), barrio | 88 nombres; varias repetidas entre hojas (`--rc-azul` está en `tienda.css` y en `barrio.css`) |
| Tipografías | `assets/fonts/`: Fredoka (300–700), Nunito (200–1000), Huggable (400–700) en woff2 | Pesos usados: 600, 700, 800 y 900. 51 tamaños distintos, todos como `calc(var(--unidad) * N)` |
| Unidades | `--n` y `--nv` (px nativos del escenario de RC, 760×600), `--hu`, `--tu`, `--u` (px del celular 844×390) | Dos "lenguajes": el de RC y el del celular nuevo |
| Sombras, radios, movimiento | — | 138 `box-shadow` (la "sombra dura corrida" de RC), 70 radios, 32 `@keyframes`, duraciones 60–260 ms |
| Sprites de interfaz | `assets/rc/ui/` + `indice.json` (nombre, archivo, ancho, alto, origen en el SWF, nota) | 444 archivos, 4,8 MB (220 en la raíz, 179 platos, 25 empleados, 20 quiz); 217 con ficha; 170 de 219 nombres aparecen literales en el código |
| Textos | `juego3d/ui/textos.js`, objeto `T` | ~600 claves; muchas con la clave original de RC en un comentario (`// [ToolTipStreet]`); varias son funciones |
| Piezas | `juego3d/ui/piezas.js`: `boton`, `flecha`, `botonTexto`, `rt` (texto con contorno), `campo`… | Se arman con JavaScript, no hay HTML suelto |
| Pantallas | `hud.js`, `hud-mobile.js`, `tienda.js`, `carrito.js`, `barrio.js`, `ventanas.js`… | Se arman contra el estado de la partida |
| **Arnés de prueba** | `juego3d/prueba-ui.html` | Monta la interfaz real con datos de prueba; `window.acciones` abre cada ventana; acepta `?v=<ventana>&liso&quieto&limpio` |

Conclusiones que mandan en el diseño:
1. **No hay tokens**: hay colores y medidas escritos a mano. El importador tiene que mostrar las dos cosas: lo que tiene
   nombre (variables) y lo que no (literales, con cuántas veces y dónde se usa). Ese segundo listado es además el mapa de
   lo que conviene ordenar en el juego.
2. **No hay HTML de componentes**: lo arma el código. Por eso las piezas y pantallas se sacan como **instantáneas** del
   DOM que genera el código real, usando el arnés que el juego ya tiene.
3. Las medidas están en **unidades propias** (`--n`, `--hu`…): el inspector muestra px de pantalla y la expresión original.

---

## 3. Modelo

### 3.1 Conceptos (el vocabulario de la interfaz y del MCP)

| Concepto | Qué es | Equivale en Figma a |
|---|---|---|
| **Diseño** | El espacio de diseño de un proyecto. Uno por proyecto. | Un archivo |
| **Página** | Una hoja del diseño. Tres tipos: `lienzo` (marcos), `sistema` (se dibuja sola a partir de los ítems: colores, tipografía, activos…) y `tabla` (textos). | Página; la de tipo tabla, a la tabla de variables |
| **Marco** | Rectángulo con tamaño fijo cuyo contenido es HTML + CSS. Unidad de dibujo, de render y de exportación. | Frame |
| **Sección** | Título que agrupa marcos en una página (un texto en el marco: `seccion`). | Section |
| **Capa** | Un elemento del HTML del marco. Tiene `data-id` (lo pone el servidor) y, si quiere, `data-nombre`. | Layer |
| **Ítem del sistema** | Una entrada del sistema de diseño. Tipos: `token`, `estilo_texto`, `color_suelto`, `activo`, `fuente`, `hoja`, `pieza`, `texto`, `plantilla`. | Variables, estilos, assets, componentes |
| **Pieza** | Componente reutilizable (HTML + CSS + propiedades). En un marco se usa como **instancia**. | Componente / instancia |
| **Juego de variantes** | Marcos hermanos que son la misma pieza publicitaria en otros tamaños o con otro texto (`grupo`). | — (lo más parecido: variantes) |
| **Origen** | `importado` (lo trajo el importador; se pisa en cada sincronización; no se edita) o `propio` (hecho en Telar; se edita). | — |
| **Nota** | Lo que Telar agrega sobre un ítem importado: nombre propio, uso, estado, comentario. Sobrevive a las sincronizaciones. | Descripción / anotación |

### 3.2 Qué se edita en v1 y qué solo se mira

| | Importado | Propio |
|---|---|---|
| Ver, medir, copiar valores y código, buscar, exportar | sí | sí |
| Nombre propio, uso, estado y nota | sí | sí |
| Comentar y vincular con tarjetas | sí | sí |
| "Proponer un cambio" (crea una tarjeta con el porqué) | sí | — |
| "Probar un valor" de una variable (se ve en vivo, no se guarda) | sí | — |
| **Hacer una copia editable** (duplica el marco como propio, con las mismas hojas) | sí | — |
| Cambiar contenido, estilos, tamaño, posición; crear, duplicar y archivar | no | sí |

**Por qué los cambios no vuelven solos al juego (decisión D3).** (1) No hay un token que tocar: un color vive en decenas de
reglas escritas a mano. (2) En el juego no se publica nada sin autorización del dueño y lo que se aparta de RC se consulta
antes. (3) Un cambio de diseño sin porqué es justo lo que Telar existe para evitar. El camino queda así:
**Proponer un cambio → tarjeta "Diseño: …" con el porqué, el valor de hoy, el propuesto y el enlace al ítem → Claude la toma
por MCP en una sesión del juego, lo aplica en la rama y vuelve a sincronizar → Telar muestra el valor nuevo y la tarjeta
pasa a Hecho.** La "copia editable" cubre lo otro que hace falta: diseñar una pantalla nueva del juego con su CSS real,
sin tocar el juego.

### 3.3 Datos (migración aditiva)

Archivo nuevo `supabase/migrations/20261201090000_diseno.sql`. Solo **agrega** tablas: la versión publicada sigue andando
con la base ya migrada. Local corre sola (PGlite); **online se aplica a mano** (`set role tablero_app; set search_path =
tablero;`, el SQL, y la fila en `tablero_migraciones`), **(dueño)**, antes de publicar. Idempotente (`if not exists`).

```sql
-- Telar · Diseño. Genérico por proyecto. IDs de texto (nanoid), RLS activado, orden con collate "C".

create table if not exists diseno_config (            -- una fila por proyecto, se crea al abrir Diseño por primera vez
  proyecto_id text primary key references proyectos (id) on delete cascade,
  perfil jsonb not null default '{}'::jsonb,          -- perfil de importación (5.2)
  importacion integer not null default 0,             -- número de la importación vigente
  importado_en timestamptz,
  origen jsonb,                                       -- { repo, rama, commit, url } de la última importación
  pedido_en timestamptz,                              -- "pedirle a Claude que sincronice"
  ajustes jsonb not null default '{}'::jsonb
);

create table if not exists diseno_paginas (
  id text primary key,
  proyecto_id text not null references proyectos (id) on delete cascade,
  nombre text not null,
  slug text not null,
  tipo text not null default 'lienzo' check (tipo in ('lienzo', 'sistema', 'tabla')),
  origen text not null default 'propio' check (origen in ('propio', 'importado')),
  datos jsonb not null default '{}'::jsonb,           -- sistema/tabla: { tipos: [...], filtro }; lienzo: { fondo }
  orden text collate "C" not null,
  archivada boolean not null default false,
  creado_en timestamptz not null default now(),
  unique (proyecto_id, slug)
);

create table if not exists diseno_marcos (
  id text primary key,
  proyecto_id text not null references proyectos (id) on delete cascade,
  pagina_id text not null references diseno_paginas (id) on delete cascade,
  nombre text not null,
  seccion text not null default '',
  grupo text,                                         -- juego de variantes
  x double precision not null default 0,
  y double precision not null default 0,
  ancho integer not null check (ancho between 16 and 8192),
  alto integer not null check (alto between 16 and 8192),
  html text not null default '',
  css text not null default '',
  hojas jsonb not null default '[]'::jsonb,           -- claves de ítems tipo hoja que usa, en orden
  datos jsonb not null default '{}'::jsonb,           -- { fondo, modo, prefijado, plantilla, estado, vista, escala, raizClase }
  origen text not null default 'propio' check (origen in ('propio', 'importado')),
  clave text,                                         -- estable para lo importado: "pantalla:celular/hud"
  hash text,
  miniatura text,                                     -- ruta en el almacén
  revision integer not null default 1,
  bloqueado boolean not null default false,
  archivado_en timestamptz,
  creado_por jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists diseno_marcos_pagina_idx on diseno_marcos (pagina_id) where archivado_en is null;
create unique index if not exists diseno_marcos_clave_idx on diseno_marcos (proyecto_id, clave) where clave is not null;

create table if not exists diseno_revisiones (        -- para deshacer y volver atrás: las últimas 50 por marco
  marco_id text not null references diseno_marcos (id) on delete cascade,
  n integer not null,
  html text not null, css text not null, datos jsonb not null, ancho integer not null, alto integer not null,
  actor jsonb, resumen text not null default '',
  creado_en timestamptz not null default now(),
  primary key (marco_id, n)
);

create table if not exists diseno_items (
  proyecto_id text not null references proyectos (id) on delete cascade,
  tipo text not null check (tipo in ('token','estilo_texto','color_suelto','activo','fuente','hoja','pieza','texto','plantilla')),
  clave text not null,                                -- "color/marca/primario", "btn-ok", "masPesos", "ui.css"
  nombre text not null,
  grupo text not null default '',
  datos jsonb not null default '{}'::jsonb,
  origen text not null default 'propio' check (origen in ('propio', 'importado')),
  hash text,
  importacion integer,                                -- con qué importación llegó (null = propio)
  orden text collate "C" not null default 'a0',
  archivado boolean not null default false,
  actualizado_en timestamptz not null default now(),
  primary key (proyecto_id, tipo, clave)
);
create index if not exists diseno_items_grupo_idx on diseno_items (proyecto_id, tipo, grupo);

create table if not exists diseno_notas (
  proyecto_id text not null references proyectos (id) on delete cascade,
  objetivo text not null,                             -- "item:token:--rc-azul" | "marco:<id>"
  nombre_propio text, uso text, nota text,
  estado text check (estado in ('vigente', 'revisar', 'viejo')),
  actualizado_por jsonb, actualizado_en timestamptz not null default now(),
  primary key (proyecto_id, objetivo)
);

create table if not exists diseno_comentarios (
  id text primary key,
  proyecto_id text not null references proyectos (id) on delete cascade,
  objetivo text not null,                             -- "marco:<id>" | "marco:<id>#<capa>" | "item:<tipo>:<clave>"
  x double precision, y double precision,             -- punto dentro del marco (px del marco), opcional
  texto text not null,
  respuesta_a text references diseno_comentarios (id) on delete cascade,
  resuelto boolean not null default false,
  autor jsonb not null,
  creado_en timestamptz not null default now()
);
create index if not exists diseno_comentarios_idx on diseno_comentarios (proyecto_id, objetivo);

create table if not exists diseno_vinculos (          -- una campaña = tarjetas + diseños
  proyecto_id text not null references proyectos (id) on delete cascade,
  objetivo text not null,                             -- "marco:<id>" | "pagina:<id>" | "item:<tipo>:<clave>"
  tarjeta_id text not null references tarjetas (id) on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (objetivo, tarjeta_id)
);
create index if not exists diseno_vinculos_tarjeta_idx on diseno_vinculos (tarjeta_id);

create table if not exists diseno_importaciones (     -- el historial: qué cambió en cada sincronización
  proyecto_id text not null references proyectos (id) on delete cascade,
  n integer not null,
  estado text not null default 'subiendo' check (estado in ('subiendo', 'lista', 'descartada')),
  origen jsonb not null default '{}'::jsonb,
  cambios jsonb not null default '[]'::jsonb,         -- [{ tipo, clave, que: 'nuevo'|'cambio'|'quitado', antes? }]
  resumen jsonb not null default '{}'::jsonb,
  actor jsonb, creado_en timestamptz not null default now(),
  primary key (proyecto_id, n)
);

create table if not exists diseno_paso (                -- lo que va llegando de una importación, hasta "terminar"
  proyecto_id text not null references proyectos (id) on delete cascade,
  n integer not null,
  parte integer not null,
  datos jsonb not null,
  primary key (proyecto_id, n, parte)
);

alter table diseno_paso enable row level security;
alter table diseno_config enable row level security;
alter table diseno_paginas enable row level security;
alter table diseno_marcos enable row level security;
alter table diseno_revisiones enable row level security;
alter table diseno_items enable row level security;
alter table diseno_notas enable row level security;
alter table diseno_comentarios enable row level security;
alter table diseno_vinculos enable row level security;
alter table diseno_importaciones enable row level security;
```

**Por qué así.**
- **Filas y no un JSON gigante**: buscar, anotar, comentar y comparar necesitan dirigirse a un ítem. Una fila por ítem con
  su `hash` hace que sincronizar sea "comparar hashes".
- **`html` y `css` en la base y los binarios en el almacén**: el texto se busca, se versiona y entra en una respuesta de
  la API; los binarios van por ruta con hash (`diseno/<proyecto>/<sha1-12>.<ext>`), se cachean para siempre y no se suben
  dos veces.
- **Sin tabla de "propuestas"**: una propuesta es una tarjeta del Kanban (con su porqué) vinculada al ítem. Menos
  conceptos, y la conversación queda donde ya vive.
- **Peso estimado de RC**: activos ~5 MB, miniaturas ~4 MB, instantáneas e ítems ~6 MB. Total ~15 MB dentro de la base
  del juego (Supabase gratis: 500 MB). No perjudica al juego: es otro esquema y otro usuario.

### 3.4 Forma de `datos` por tipo de ítem (`compartido/diseno/tipos.ts`)

```ts
export type TipoItem = 'token' | 'estilo_texto' | 'color_suelto' | 'activo' | 'fuente' | 'hoja' | 'pieza' | 'texto' | 'plantilla'

export interface Uso { archivo: string; linea: number; selector?: string; propiedad?: string }

export interface DatosToken {
  clase: 'color' | 'numero' | 'medida' | 'texto' | 'sombra' | 'curva' | 'duracion' | 'fuente'
  css: string                         // nombre de la variable que emite: "--color-marca-primario" (importado: el original, "--rc-azul")
  valor: string                       // "#38bde6", "12px", "0 2px 0 #0b7894"
  modos?: Record<string, string>      // { oscuro: "#8fe3fb" }
  alias?: string                      // clave de otro token
  alcance?: string                    // importado: selector donde se declara (".rcui")
  declaradoEn?: Uso[]                 // importado: puede estar declarado en más de una hoja
  usos?: Uso[]
}
export interface DatosEstiloTexto { clase: string; familia: string; peso: number; tamano: string; interlineado: string; espaciado?: string; mayusculas?: boolean; contorno?: { color: string; grosor: string } }
export interface DatosColorSuelto { valor: string; rgb: [number, number, number, number]; veces: number; usos: Uso[]; igualA?: string; cercaDe?: string }
export interface DatosActivo { ruta: string; mime: string; ancho: number; alto: number; peso: number; nota?: string; origen?: string; escala?: number; usos?: Uso[] }
export interface DatosFuente { familia: string; ruta: string; pesos: string; estilo?: string; licencia?: string }
export interface DatosHoja { ruta?: string; css?: string; reglas: number; peso: number; archivo?: string }   // importada: ruta; propia: css
export interface PropPieza { nombre: string; clase: 'variante' | 'texto' | 'booleano' | 'imagen'; valores?: string[]; defecto: string | boolean }
export interface DatosPieza { html?: string; variantes?: Record<string, string>; css: string; hojas: string[]; propiedades: PropPieza[]; ancho?: number; alto?: number; raizClase?: string }
export interface DatosTexto { valor: string; plantilla?: boolean; claveOriginal?: string; grupo?: string; archivo?: string; linea?: number; usos?: Uso[] }
export interface DatosPlantilla { html: string; css: string; hojas: string[]; ancho: number; alto: number; ranuras: { nombre: string; clase: 'texto' | 'imagen' }[] }
```

**Tokens → CSS.** `compartido/diseno/tokens.ts` genera la hoja de tokens del proyecto:
`:root { --color-marca-primario: #d2663a; … }` más un bloque `[data-modo="oscuro"] { … }` por modo, las reglas
`@font-face` de las fuentes y una clase `.t-<slug>` por estilo de texto. Esa hoja se agrega **sola** a todo marco propio.
Cambiar un token cambia todos los marcos que lo usan: es la idea 4 de Figma con cero mecanismo extra.

---

## 4. Cómo se dibuja un marco

### 4.1 El armador de documentos (decisión D6)

`compartido/diseno/documento.ts` exporta una función pura que usan la web, el render del servidor y la exportación:

```ts
export function documentoDeMarco(e: {
  marco: Pick<Marco, 'html' | 'css' | 'ancho' | 'alto' | 'hojas' | 'datos'>
  hojas: { clave: string; url?: string; css?: string }[]   // en orden
  cssTokens: string
  piezas: Record<string, DatosPieza>                       // las que usa el marco
  opciones?: { pausar?: boolean; estados?: boolean; transparente?: boolean }
}): string
```

Devuelve un documento completo:

```html
<!doctype html><html lang="es" data-modo="{datos.modo}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self'">
<style>html,body{margin:0;width:{ancho}px;height:{alto}px;overflow:hidden;background:{fondo}}</style>
<link rel="stylesheet" href="/archivos/diseno/…/ui.<hash>.css">   <!-- una por hoja importada -->
<style>/* tokens */…</style><style>/* piezas usadas */…</style><style>/* css del marco */…</style>
<style>/* si pausar */ *,*::before,*::after{animation-play-state:paused!important}</style>
</head><body class="{datos.raizClase}">{html con las instancias expandidas}</body></html>
```

- **Instancias.** En el HTML de un marco, una instancia es `<div data-pieza="boton" data-props='{"color":"verde","etiqueta":"Comprar"}'></div>`.
  `expandirPiezas()` (mismo archivo) reemplaza su contenido por el HTML de la pieza: si la pieza tiene `variantes`, elige la
  que corresponde a la propiedad de clase `variante`; si tiene `html`, reemplaza `{{nombre}}` (escapado) por el valor,
  copia cada propiedad como `data-<nombre>="valor"` en la raíz (para que el CSS de la pieza estile `[data-color="verde"]`)
  y quita los elementos con `data-si="<prop>"` cuando el booleano es falso. La instancia guarda solo sus propiedades:
  cambia la pieza y cambian todas.
- **Estados.** `opciones.estados` agrega una hoja con las reglas `:hover`, `:active` y `:focus-visible` copiadas como
  clases (`.es-hover`, `.es-active`, `.es-focus`), sacándolas de sus `@media (hover: hover)`. La arma el importador para
  las hojas importadas (`<hoja>.estados.css`) y `estadosDeCss()` en el momento para el CSS propio. Así una hoja de
  variantes muestra "normal · encima · apretado · apagado" lado a lado sin mouse. Es la técnica de los
  *pseudo-estados* de Storybook.

### 4.2 El marco en la web

Componente `MarcoVivo` (`web/src/vistas/diseno/lienzo/MarcoVivo.tsx`): un `<iframe sandbox="allow-same-origin"
srcdoc={documento}>` de exactamente `ancho × alto` px, sin borde, con `pointer-events: none` **siempre** (salvo en modo
Probar y al editar un texto). El zoom lo da el `transform` del lienzo: el iframe nunca cambia de tamaño, así que el CSS
de adentro ve siempre su *viewport* real.

**Por qué `pointer-events: none`:** un iframe se traga la rueda y el arrastre; el lienzo dejaría de moverse al pasar por
encima. Todos los gestos los recibe la capa de selección de Telar (6.4), que le pregunta al iframe qué hay debajo con
`contentDocument.elementFromPoint(x, y)`.

### 4.3 Seguridad (probado)

Se probó en Chrome 2026 con un documento de prueba neutro (no del juego), contra Telar local:

| Qué | Resultado |
|---|---|
| `<script>` dentro del `srcdoc` con `sandbox="allow-same-origin"` | **No corre** |
| Telar lee `contentDocument`, `getComputedStyle`, `getBoundingClientRect`, `elementFromPoint` y qué reglas le aplican a un elemento (`el.matches(regla.selectorText)`) | Sí |
| Imagen de otro sitio con la política de contenido del `<meta>` | **Bloqueada**; la del mismo origen carga (con la cookie de sesión) |
| `contentEditable` dentro del iframe y oyentes puestos por Telar (`input`, `click`) | Funcionan |
| `:hover` real y unidades de contenedor (`cqw`) | Funcionan |
| Origen opaco (`sandbox=""`) | Telar **no** puede leer el DOM: por eso se usa `allow-same-origin` |

Reglas:
1. **Nunca** `allow-scripts` en un marco. `allow-same-origin` sin `allow-scripts` es seguro: el peligro es la combinación.
2. El servidor **sanea** todo HTML y CSS que entra (por la API, el MCP o el importador), con `servidor/src/diseno/sanear.ts`
   sobre `parse5` (analizador de HTML conforme a la especificación, MIT, sin dependencias). Lista blanca:
   - Etiquetas: estructura y texto de HTML (`div span p h1–h6 ul ol li a img picture figure figcaption section header
     footer main nav article button label small strong em b i u s sup sub br hr table thead tbody tr td th`), campos
     inertes (`input textarea select option`, se les agrega `disabled tabindex="-1"`), y SVG en línea (`svg g path rect
     circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask use symbol
     title`; `use` solo con `href="#…"`).
   - Se quitan: `script iframe object embed link meta base form style` (el contenido de `<style>` se pasa al `css` del
     marco), todo atributo `on*`, `srcdoc`, `formaction`.
   - `src`, `href` de imagen y `url()` del CSS: solo `/archivos/…` o `data:image/…` de hasta 200 KB. `href` de `<a>` se
     guarda como `data-href` (no navega). En el CSS se rechazan `@import`, `expression(` y `javascript:`.
   - Si hay una URL de afuera, **no se quita en silencio**: se devuelve error 400 con el texto
     *"La imagen https://… es de afuera. Subila primero con subir_activo y usá la ruta que devuelve."* (un error claro le
     sirve más a un modelo que una imagen que no aparece).
3. El servidor le pone `data-id` (6 caracteres, nanoid) a todo elemento que no lo tenga y **conserva** los que ya tiene.
   Es la dirección de la capa para la interfaz y para el MCP.
4. Límite: 1,5 MB de HTML y 1 MB de CSS por marco.

### 4.4 Dónde quedan los archivos y quién los ve (decisión D12)

- Sprites, fuentes, hojas de estilo, miniaturas e imágenes subidas: **solo en el almacén** (`.datos/archivos/diseno/` en
  local; tabla `tablero.archivos` online), servidos por `/archivos/diseno/…`, que online exige la sesión del dueño
  (`TABLERO_USUARIOS`) o la clave del MCP.
- **Nunca** en el repo de Telar ni en `web/public/` (lo estático de Vercel es público). El importador escribe su paquete
  en `.datos/diseno-paquete/` (ya ignorado por `.gitignore`).
- Las fuentes Fredoka y Nunito son OFL; **Huggable no trae archivo de licencia** en el repo del juego: se trata como el
  resto del material de RC (solo detrás del login). Si algún día Telar se abre a otra gente, este material se revisa,
  igual que dice el `CLAUDE.md` del juego.
- Lo que ve Claude por MCP (`ver_diseno`) son imágenes de ese mismo material, pedidas con la clave del dueño.

---

## 5. Importar el sistema de diseño de un proyecto

### 5.1 Cómo funciona (decisión D5)

Un comando, que corre **donde está el repo** (la computadora del dueño con Claude Code, o una sesión de Claude Code en la nube):

```bash
npm run diseno:importar -- --proyecto RC --repo /ruta/al/repo [--destino https://telarapp.vercel.app] [--con-paginas] [--solo tokens,activos]
```

Pasos (`scripts/diseno/`, TypeScript con `tsx`; todo es de lectura sobre el repo de origen):

| Paso | Archivo | Qué hace | ¿Navegador? |
|---|---|---|---|
| 1 | `perfil.ts` | Lee el perfil: primero `--perfil archivo.json`; si no, el guardado en Telar (`GET /api/diseno/:proyecto/config`); si no, `scripts/diseno/perfiles/<prefijo>.json`. Lo valida con zod. | no |
| 2 | `hojas.ts` | Analiza cada hoja con `postcss`: a cada regla le agrega la declaración `--telar-origen: "ui.css:412"` (así el inspector sabe archivo y línea sin índices frágiles), reescribe los `url()` a rutas del paquete, y genera `<hoja>.estados.css`. | no |
| 3 | `tokens.ts` | Variables declaradas → `token` (nombre original, alcance, dónde se declara, usos `var(--x)`). Colores literales → `color_suelto` (valor normalizado, veces, usos con selector, propiedad y línea; `igualA` si coincide con un token; `cercaDe` si está a ΔE < 2 de otro). Tamaños de letra, pesos, familias, radios, sombras, duraciones, curvas y `@keyframes` → tokens de su clase, con cuántas veces se usan. | no |
| 4 | `activos.ts` | Recorre los patrones de imágenes: tamaño (cabecera del archivo, sin dependencias: PNG, WebP, JPG, SVG), peso, ficha del índice si hay, y **usos** (busca el nombre entre comillas en los archivos de `usos`). Fuentes: lee la familia y los pesos del perfil. | no |
| 5 | `textos.ts` | Importa el módulo de textos (`import()` del archivo) para los valores; lee el archivo como texto para sacar línea, grupo (el comentario de título anterior) y clave original (`// [Clave]`); las funciones quedan como `plantilla: true` con su código fuente. Busca usos (`T.<clave>`). También acepta JSON de traducciones. | no |
| 6 | `paginas.ts` | **Solo con `--con-paginas`.** Levanta un servidor estático en la raíz del repo (o usa la URL del perfil), abre cada pantalla con `playwright-core` + el Chrome del sistema en la vista pedida (tamaño, densidad, táctil), hace las acciones, espera a que no queden animaciones, y saca la **instantánea** (5.4) y una miniatura WebP. Corre también las **recetas** de piezas. | **sí** |
| 7 | `paquete.ts` | Arma `.datos/diseno-paquete/<proyecto>/`: `paquete.json` (ítems, páginas, marcos, origen: repo, rama, commit) y `archivos/<sha1-12>.<ext>`. | no |
| 8 | `subir.ts` | Sube a Telar con la clave (5.5). Con `--destino` va al Telar online; sin eso, al local. | no |

**Regla del juego que hay que respetar (dueño, 20/11):** en el repo del juego no se abre un navegador ni se sacan capturas
sin que el dueño lo pida. El paso 6 abre el arnés del juego en un navegador sin cabeza: **(dueño)** se le pregunta una vez
antes de la primera importación con páginas ("¿Sincronizo también las pantallas? Abro la interfaz de prueba del juego sin
mostrarla, no corro ninguna prueba"). Sin ese sí, la importación corre sin `--con-paginas` y deja cargados Fundamentos,
Íconos y Textos; Componentes, Celular y PC quedan con el estado vacío "Falta sincronizar las pantallas". Cuando el dueño
aprieta "Pedir sincronización" en Telar, ese pedido **es** la autorización para esa vez.

**Por qué instantáneas y no otra cosa.**

| Opción | A favor | En contra | Veredicto |
|---|---|---|---|
| Escribir a mano el HTML de cada pieza en Telar | Sin navegador | Es adivinar: se desvía del juego el primer día | No |
| Correr el JavaScript del juego dentro de Telar | Vivo de verdad | Código de otro proyecto corriendo en Telar con la sesión del dueño; necesita la partida, Three.js, etc. | No |
| Correr las funciones del juego en Node con un DOM simulado | Sin navegador | Solo sirve para `piezas.js`; las pantallas dependen del estado y de medidas reales (`--n` se calcula con el tamaño de la ventana) | No |
| **Instantánea del DOM que generó el código real, dibujada con su CSS real** | Fiel, liviana (HTML + CSS estáticos), segura, sirve para cualquier web | Hay que volver a sacarla cuando el código cambia (para eso está sincronizar); lo dibujado en `<canvas>` queda como imagen | **Sí** |

### 5.2 El perfil

JSON validado con zod (`compartido/diseno/perfil.ts`). Se guarda en `diseno_config.perfil` (editable por MCP). Campos:

```jsonc
{
  "nombre": "Restaurant City",
  "fuente": { "clase": "repo" },                       // "repo" (archivos + servidor estático propio) | "web" (solo URLs)
  "hojas": ["juego3d/ui/*.css"],
  "raizClase": "rcui",                                 // clase que llevan <body> o la raíz para que apliquen las hojas
  "fuentes": [
    { "familia": "Fredoka", "archivo": "assets/fonts/Fredoka.woff2", "pesos": "300 700", "licencia": "OFL" },
    { "familia": "Nunito", "archivo": "assets/fonts/Nunito.woff2", "pesos": "200 1000", "licencia": "OFL" },
    { "familia": "Huggable", "archivo": "assets/fonts/Huggable.woff2", "pesos": "400 700", "licencia": "sin archivo de licencia" }
  ],
  "activos": [
    { "grupo": "Interfaz", "patron": "assets/rc/ui/*.{png,webp}", "indice": "assets/rc/ui/indice.json#imagenes", "agruparPor": "prefijo" },
    { "grupo": "Platos", "patron": "assets/rc/ui/platos/*.webp" },
    { "grupo": "Empleados", "patron": "assets/rc/ui/empleados/*" },
    { "grupo": "Quiz", "patron": "assets/rc/ui/quiz/*" }
  ],
  "usos": ["juego3d/ui/**/*.{js,css}", "juego3d/src/**/*.js"],
  "textos": [{ "modulo": "juego3d/ui/textos.js", "exporta": "T", "patronUso": "\\bT\\.([A-Za-z_]\\w*)" }],
  "unidades": {
    "--n": "px nativos de RC (escenario 760×600), HUD", "--nv": "px nativos de RC dentro de una ventana",
    "--hu": "px del celular (844×390), HUD nuevo", "--tu": "px del celular, tienda", "--u": "px del celular, Barrio"
  },
  "vistas": {
    "celular": { "ancho": 844, "alto": 390, "densidad": 2, "tactil": true },
    "pc": { "ancho": 1366, "alto": 768, "densidad": 1, "tactil": false }
  },
  "pantallas": [
    { "pagina": "Celular", "seccion": "HUD", "nombre": "HUD del local", "clave": "hud", "vistas": ["celular"],
      "url": "juego3d/prueba-ui.html?liso&quieto&limpio&hud=mockup", "raiz": ".rcui", "esperar": ".rcui", "fondo": "#6b7d64" },
    { "pagina": "PC", "seccion": "HUD", "nombre": "HUD de RC", "clave": "hud", "vistas": ["pc"],
      "url": "juego3d/prueba-ui.html?liso&quieto&limpio", "raiz": ".rcui", "fondo": "#6b7d64" },
    { "pagina": "*", "seccion": "Ventanas", "nombre": "Recetas", "clave": "ventana-recetas", "vistas": ["celular", "pc"],
      "url": "juego3d/prueba-ui.html?liso&quieto&limpio", "acciones": [{ "evaluar": "acciones.recetas()" }, { "esperar": ".rc-ventana" }], "raiz": ".rcui" }
    // … una entrada por ventana de window.acciones: resumen, ganancias, nivel, proximo, regalo, premio, mercado, tiendaIng,
    //   empleados, buzon, carta, quiz, premios, vestidor, uniforme, configuracion, confirmar, info, generica, decorar, aviso;
    //   más Decorar (tienda, carrito, pieza en la mano), el Barrio (para vos, charla, escribir, vacío, sin conexión) y los menús del HUD del celular.
  ],
  "recetas": "scripts/diseno/perfiles/RC.recetas.mjs"
}
```

- `"pagina": "*"` con dos vistas crea el marco en **Celular** y en **PC** con la misma `clave`: el inspector ofrece "Ver en PC" / "Ver en celular".
- `acciones`: `{ "clic": selector }`, `{ "evaluar": "código" }` (corre en la página; el perfil es nuestro, no viene de
  afuera), `{ "esperar": selector | ms }`, `{ "tecla": "Escape" }`.
- **(verificar)** en el juego, antes de escribir el perfil: que `prueba-ui.html` respete `hud=mockup`; cómo se abren
  Decorar con el carrito y el Barrio desde el arnés (si no se puede, se agrega la entrada con la `url` de la maqueta
  aprobada: `juego3d/maquetas/decorar-celular/`, `juego3d/maquetas/barrio-chat/index.html`); y si el arnés carga sin red
  (trae Three.js de un CDN): si no hay red, `paginas.ts` responde ese pedido con un módulo vacío y las ventanas 3D quedan
  con su lienzo en blanco, anotadas en el informe.
- **Recetas** (`RC.recetas.mjs`): un módulo que el paso 6 corre **dentro de la página del arnés**; importa `./ui/piezas.js`
  del juego y devuelve, por pieza, sus variantes ya armadas. Formato:

```js
// Corre en el navegador, en la página del arnés. `api` trae: importar(ruta), html(elemento), montar(elemento) → para medirlo.
export default async function recetas(api) {
  const p = await api.importar('./ui/piezas.js')
  return [
    { clave: 'boton-sprite', nombre: 'Botón de sprite', grupo: 'Botones', escala: { '--nv': '1.6px' },
      variantes: { ok: p.boton('ok'), cancelar: p.boton('cancelar'), 'ok-azul': p.boton('ok-azul'), 'ok-gris': p.boton('ok-gris') },
      estados: ['normal', 'hover', 'active'] },
    { clave: 'boton-texto', nombre: 'Botón con texto', grupo: 'Botones', escala: { '--nv': '1.6px' },
      variantes: Object.fromEntries(['verde', 'azul', 'gris', 'subir', 'subir-off', 'aprender', 'aprender-off', 'comprar', 'tab', 'tab-on']
        .map((t) => [t, p.botonTexto('Aceptar', t)])), estados: ['normal', 'hover', 'active', 'apagado'] },
    { clave: 'flecha', nombre: 'Flecha', grupo: 'Botones', variantes: { /* izq, der, arriba, abajo, doble-izq, doble-der y sus grises */ } },
    { clave: 'texto-contorno', nombre: 'Texto con contorno', grupo: 'Texto', variantes: { /* rt() con los pares color/borde que usa el HUD */ } },
    // campo, tooltip (.rc-tip), aviso (.rc-aviso), cartel de cerrado, botón amarillo/azul del HUD, contador del HUD del celular,
    // botón plano de la tienda y del Barrio, chips, tarjeta del Barrio, ventana genérica.
  ]
}
```

  Cada receta produce un ítem `pieza` (con `variantes`) y un marco "hoja de variantes" en la página **Componentes**:
  filas = variantes, columnas = estados, armado con una grilla CSS dentro de **un solo iframe por pieza**.
  **Por qué un iframe por pieza y no uno por variante:** 25 iframes en vez de 200.

**Perfil para una web (Yaguar, Brain OS).** `"fuente": { "clase": "web", "base": "https://…" }` y solo `pantallas`
(`url`, `vistas`). No hay archivos: las hojas se sacan de la página (`document.styleSheets` y, para las de otro origen, el
texto pedido por el propio navegador), y de ellas salen tokens, colores sueltos y tipografías con el mismo paso 3; las
imágenes que usa la página entran como activos. Si además está el repo, se suman `hojas`, `activos` y `textos` como en RC.
La primera importación de una web la arma Claude con `sincronizar_diseno` (7.3): propone el perfil mirando el repo.

### 5.3 Qué páginas crea una importación

Las páginas importadas salen del perfil; para RC:

| Página | Tipo | Contenido |
|---|---|---|
| **Fundamentos** | sistema | Color (variables por colección; colores sueltos por familia), tipografía (familias, pesos, escala por unidad, textos con contorno), radios, sombras, movimiento, unidades y **Salud del sistema** |
| **Íconos** | sistema | Activos por grupo |
| **Componentes** | lienzo | Una hoja de variantes por pieza |
| **Celular** | lienzo | Pantallas a 844×390: HUD nuevo y sus menús, Decorar (tienda, carrito), Barrio, ventanas |
| **PC** | lienzo | Las mismas a 1366×768 |
| **Textos** | tabla | Todos los textos, agrupados |

Todo proyecto, importe o no, tiene además una página **Fundamentos** (se crea sola y muestra los ítems propios) y puede
crear las páginas de lienzo que quiera ("Campaña de verano", "Home nueva"…). Si el proyecto no tiene nada, se abre con
el estado vacío de 6.10.

### 5.4 La instantánea

En la página, después de las acciones (`scripts/diseno/instantanea.ts`, función que corre con `page.evaluate`):

1. Espera `document.fonts.ready` y a que `document.getAnimations()` no tenga animaciones finitas corriendo (tope 2 s).
2. Clona el elemento `raiz` y recorre el clon:
   - quita `script`, `link`, `noscript`, `template` y atributos `on*`;
   - cada `<canvas>` se reemplaza por un `<img>` con su contenido (`toDataURL`; si el lienzo es WebGL y sale vacío, una
     captura del elemento hecha por Playwright), con el mismo tamaño y clases;
   - `src`, `srcset`, `style="…url()"` y las variables en línea con `url()` (`--img-panel`…) pasan de la URL del servidor
     local a una marca `{{archivo:ruta/relativa}}` que `paquete.ts` cambia por la ruta con hash;
   - los `<input>` y `<textarea>` guardan su valor como atributo.
3. Guarda también el `style` y las clases de `<html>` y `<body>` (variables que el código pone ahí: zonas seguras, escala).
4. Devuelve `{ html, raizClase, estiloRaiz, ancho, alto }` y Playwright saca la miniatura (WebP, calidad 82, a 1x).

El marco resultante: `origen: 'importado'`, `clave: "pantalla:<vista>/<clave>"`, `ancho × alto` de la vista, `hojas` =
todas las del perfil, `datos: { vista, fondo, estiloRaiz, raizClase }`.

**Límite conocido y honesto:** una instantánea es de **una** vista. Los números que el código calculó para 844×390 no
valen para otro tamaño: por eso el marco importado no se redimensiona.

### 5.5 Subir a Telar y mantenerlo al día

**API de importación** (con la clave, como el importador de Discord; cada pedido pesa menos de 4 MB, el límite de Vercel):

| Ruta | Qué hace |
|---|---|
| `POST /api/diseno/:proyecto/importar/empezar` `{ origen, archivos: [{ ruta, hash, peso }] }` | Crea la importación `n` en estado `subiendo` y devuelve `{ n, faltan: [hash…] }`: solo se sube lo que no está. |
| `POST /api/diseno/:proyecto/importar/archivo` (multipart: `archivo`, `ruta`) | Guarda en el almacén como `diseno/<proyectoId>/<ruta>`. De a uno. Valida extensión (`png webp jpg jpeg gif svg woff2 css`) y que un SVG no traiga `<script>`. |
| `POST /api/diseno/:proyecto/importar/lote` `{ n, items?: […], paginas?: […], marcos?: […] }` | Sanea cada HTML y CSS y guarda el lote en `diseno_paso` (nada se ve hasta terminar). Lotes de hasta 1 MB. |
| `POST /api/diseno/:proyecto/importar/terminar` `{ n }` | En una transacción: compara por `hash` contra lo vigente, guarda la lista de `cambios`, reemplaza lo importado anterior por lo de `diseno_paso` (y lo vacía), **no toca nada propio ni las notas**, actualiza `diseno_config` y emite el evento `diseno`. Devuelve el resumen. |

**Mantenerlo al día** (por qué no hay un botón mágico): Telar online corre en Vercel y no ve el disco donde está el repo;
y las instantáneas necesitan un navegador. Entonces:

- **En Telar**: en la cabecera del panel izquierdo, una pastilla con el estado: *"Sincronizado hoy 14:32 · `abc1234` ·
  rama ccr-…"*. Al hacer clic: qué cambió en la última importación (nuevos, cambiados, quitados, cada uno lleva a su
  ítem) y el botón **"Pedir sincronización"**, que marca `pedido_en` y cambia la pastilla a *"Pedida hace 2 h"*.
- **Claude por MCP**: `sincronizar_diseno` (7.3) dice si hay un pedido pendiente y devuelve el comando exacto. Las
  instrucciones del MCP le dicen que, al terminar un cambio de interfaz en un proyecto con Diseño, corra la importación.
- **Después de sincronizar**: los ítems y marcos nuevos o cambiados llevan un punto de color durante 7 días y hay un
  filtro "Cambios de la última sincronización". Lo quitado se va, pero su nota queda guardada (si vuelve, la recupera).

---
## 6. La interfaz

Lenguaje visual: el de Telar (v0.2). **Sin contornos**: la jerarquía la dan el tono, la sombra y el espacio. Los únicos
trazos son el marco de selección, las líneas de la regla y lo que sea contenido del diseño. Tipografía Figtree; los valores
y el código en Geist Mono. Colores solo por tokens de `tokens.css`. Textos en castellano rioplatense.

### 6.1 Estructura

```
┌ barra superior de Telar (56) ─ [RC] Restaurant City / Pendientes   Kanban  Lienzo  Diseño            ● En vivo  ⌂ ⌁ ┐
├───────────────┬──────────────────────────────────────────────────────────────────────┬───────────────────────────┤
│ PANEL IZQ 248 │  LIENZO                                                              │ INSPECTOR 288             │
│ ┌───────────┐ │  ┌ migas de la selección ┐                          ┌ fondo · probar ┐│ [Diseño] [Código] [Notas] │
│ │RC Diseño ⟳│ │                                                                      │                           │
│ ├───────────┤ │     ┌─ HUD del local ────────┐   ┌─ Tienda ───────────┐              │ Medidas                   │
│ │ Capas│Piez│ │     │                        │   │                    │              │ Relleno                   │
│ ├───────────┤ │     │      844 × 390         │   │                    │              │ Tipografía                │
│ │ PÁGINAS  +│ │     └────────────────────────┘   └────────────────────┘              │ …                         │
│ │  Fundamen…│ │                                                                      │                           │
│ │ ▸Celular  │ │                                                                      │                           │
│ ├───────────┤ │                                                                      │                           │
│ │ CAPAS     │ │                ┌ ↖  ✋ │ ▢  T  ▣  ◻ │ 📏  ▶  💬 ┐         ┌ − 62 % + ⤢ ┐│                           │
│ │ ▾ HUD     │ │                └──────────────────────────────────┘         └────────────┘│                           │
└───────────────┴──────────────────────────────────────────────────────────────────────┴───────────────────────────┘
```

- **Tres columnas fijas** (CSS grid: `248px minmax(0, 1fr) 288px`), dentro de `.escena`. **Por qué fijas y no flotantes:**
  Figma probó paneles flotantes y volvió a los fijos; un panel flotante tapa justo lo que se quiere medir.
- **La barra lateral de Telar se pliega sola al entrar a Diseño** (y vuelve como estaba al salir). Por qué: con la
  lateral (248), el panel de capas (248) y el inspector (288), en una pantalla de 1440 al lienzo le quedaría el 46 %.
  El panel izquierdo de Diseño ocupa su lugar y muestra el proyecto; la tecla `[` la sigue abriendo. Se guarda aparte
  (`preferencias.diseno.lateral`, de fábrica `false`).
- Fondos: paneles `var(--c-lateral)`; lienzo `var(--c-hundido-2)` (un escalón más oscuro que los paneles en los dos
  temas, para que los marcos resalten); tarjetas y controles flotantes `var(--c-elevada)` con `var(--sombra-2)`.
- Ancho de los paneles: se arrastra el borde entre 200 y 400 px (zona de agarre de 6 px invisible; el cursor cambia).
  Se guarda en preferencias. `Ctrl/⌘ + \` esconde los dos paneles (se deslizan 220 ms `var(--curva)`); otra vez, vuelven.
- Menos de 1100 px de ancho: el panel izquierdo arranca plegado en una tira de 44 px (íconos de Páginas, Capas y Piezas
  que lo abren como capa encima del lienzo).

### 6.2 Panel izquierdo

**Cabecera (48 px, padding 12).** Avatar del proyecto (20 px, `AvatarProyecto` de la v0.2; si no existe, el sello de dos
letras), "Diseño" (14 px, peso 650) y, a la derecha, la **pastilla de sincronización** (alto 22, radio 11, 11,5 px):
punto verde + "hoy 14:32" · punto ámbar + "Pedida" · gris + "Sin importar". Clic: ventanita de 320 px con origen (repo,
rama, commit), el resumen de cambios de la última importación y el botón "Pedir sincronización".
En proyectos sin perfil la pastilla dice "Importar…" y abre la explicación de 6.10.

**Buscador (alto 32, radio 8, fondo `var(--c-hundido)`).** `Ctrl/⌘+F` o `/`. Busca en todo el diseño del proyecto: marcos,
capas (nombre y texto), tokens (nombre y valor: escribir `#38bde6` encuentra el color), activos, piezas y textos.
Resultados agrupados por tipo debajo del campo (filas de 30 px con miniatura de 20 px); `↑ ↓` y `Enter` llevan al
resultado (cambia de página si hace falta, encuadra y selecciona). Se resuelve en el servidor (`GET …/buscar`).

**Páginas.** Título "PÁGINAS" (11,5 px, mayúsculas, `var(--c-texto-3)`) y `+`. Filas de 30 px, radio 8, ícono de 14 px
según el tipo (lienzo, sistema, tabla), nombre y contador a la derecha. La activa: fondo `var(--c-hover-fuerte)` con un
indicador que se desliza (`layoutId`, resorte 500/38). Las importadas llevan el ícono de
"enlace" (10 px, `var(--c-texto-3)`) con la ayuda "Viene del código". Menú con el botón derecho
(solo propias): Renombrar (`F2`), Duplicar, Archivar. Se reordenan arrastrando (solo propias).

**Pestañas Capas | Piezas** (`Segmentado` existente, alto 30).

*Capas* (página de lienzo): árbol **secciones → marcos → capas**. Filas de 28 px; sangría de 14 px por nivel; flecha de
plegar de 12 px; ícono de 14 px por clase (marco, pieza ◆, instancia ◇, texto T, imagen, caja); nombre con elipsis.
- Nombre de una capa, en este orden: `data-nombre` · `aria-label` · en una imagen, el nombre del activo (`btn-ok`) ·
  en un texto, sus primeros 28 caracteres entre comillas · la primera clase (`.hm-arriba`) · la etiqueta.
- Pasar por una fila resalta la capa en el lienzo; pasar por una capa en el lienzo resalta la fila (fondo
  `var(--c-hover)`), sin desplazar el árbol. Clic selecciona; doble clic encuadra; `Alt + clic` en la flecha despliega todo.
- Al pasar por la fila, a la derecha: ojo (ocultar, solo propias) y candado (bloquear el marco).
- El árbol de un marco se arma **al desplegarlo** leyendo el DOM del iframe (o el HTML guardado si el marco no está vivo),
  y la lista es **virtual** (solo se dibujan las filas visibles; alto fijo, sin biblioteca). Una pantalla del juego tiene
  cientos de elementos: de fábrica se despliegan dos niveles.
- En páginas de sistema el árbol es **grupos → ítems**; en la de tabla, los grupos de textos.

*Piezas*: buscador propio y tres grupos plegables: **Piezas** (miniatura de 40 px, nombre, cantidad de variantes),
**Plantillas** y **Activos** (grilla de 56 px). Clic: muestra la pieza en el inspector con sus propiedades.
Botón "Insertar" (o `Enter`): la pone centrada en el marco propio seleccionado. Doble clic: va a su hoja de variantes.
Arrastrar al lienzo: v2.

### 6.3 Lienzo

- Motor: `ReactFlow` con `onlyRenderVisibleElements`, `minZoom 0.02`, `maxZoom 8`, `nodesConnectable={false}`,
  sin aristas. Tipos de nodo: `marco` (iframe), `marcoSistema` (dibujado por React) y `seccion` (solo el título).
  Los gestos de rueda respetan la preferencia de la v0.2 (automático, mouse, trackpad).
- **Nombre del marco**: arriba a la izquierda, a 6 px, 12 px de letra, `var(--c-texto-2)` (`var(--c-seleccion)` cuando
  está seleccionado), tamaño constante (`calc(12px / var(--z))`), con las medidas al lado en `var(--c-texto-3)`
  ("HUD del local · 844 × 390"). Los importados suman el ícono de enlace. Doble clic renombra (propios).
- **Marco**: sombra `var(--sombra-2)`, sin radio (un marco es una pantalla o una pieza: sus esquinas son las reales).
  Fondo del marco: el suyo (`datos.fondo`), independiente del tema de Telar.
- **Título de sección**: 20 px (constante hasta zoom 0,5; después escala), peso 700, a 40 px sobre su primer marco.
- **Acomodo automático**: los marcos importados y los que crea la IA sin posición se ubican por sección, en filas, con
  64 px entre marcos, 160 px entre secciones y filas de hasta 4.000 px de ancho (`compartido/diseno/acomodar.ts`,
  función pura; también la usa el servidor). Los propios se pueden mover; "Ordenar la página" los vuelve a acomodar.
- **Controles flotantes** (cajas `var(--c-elevada)`, radio 12, sombra `var(--sombra-3)`, a 12 px de los bordes):
  - abajo al centro, la **barra de herramientas** (mismo molde que la del Lienzo de la v0.2: alto 44, botones 36 × 36,
    íconos de 18 px, píldora de la activa con `layoutId`): Seleccionar `V` · Mano `H` │ Marco `F` · Texto `T` ·
    Imagen `I` · Caja `R` │ Regla `Mayús+M` · Probar `P` · Comentar `C`. En una página importada, Marco, Texto, Imagen y
    Caja se ven apagados con la ayuda "Esta página viene del código. Creá una página propia para diseñar".
  - abajo a la derecha, **zoom**: `−`, porcentaje (clic: menú con 50, 100, 200, "Ver todo `Mayús+1`", "Ver la selección
    `Mayús+2`"), `+`, y minimapa `M`.
  - arriba a la izquierda, las **migas** de la selección ("Celular › HUD del local › .hm-arriba › «¡Más pesos!»"), cada
    parte se puede tocar para subir de nivel. 12,5 px, alto 28.
  - arriba a la derecha: **fondo del lienzo** (claro, medio, oscuro: muchos sprites son blancos) y, con un marco
    seleccionado, **modo** (claro/oscuro u otros modos de los tokens) y "Ver en PC / en celular" si existe el par.
- **Marco "Marco nuevo" (`F`)**: ventanita de 300 px con los prefijados (6.7); se elige y se hace clic en el lienzo.

### 6.4 Seleccionar, resaltar y moverse entre capas

Una sola pieza: `CapaSeleccion` (`web/src/vistas/diseno/lienzo/CapaSeleccion.tsx`), dibujada **encima** del lienzo en
coordenadas de pantalla (no escala con el zoom), con `pointer-events: none`. Recibe la selección y lo que está bajo el
mouse como rectángulos ya convertidos: `pantalla = posiciónDelMarco + rectDentroDelMarco × zoom`.

- **Qué hay bajo el mouse** (`elegir.ts`): cada nodo `marco` tiene encima del iframe un `div` transparente que recibe los
  eventos. Punto local = `(clientX − rect.left) / zoom`. En un marco vivo: `iframe.contentDocument.elementFromPoint(x, y)`
  y se sube hasta el primer elemento con `data-id`. En un marco de sistema: `document.elementsFromPoint` filtrado por
  `[data-item]`. Se calcula en `pointermove` con `requestAnimationFrame` (una vez por cuadro).
- **Niveles, como Figma**: clic selecciona el **marco**; con el marco seleccionado, clic selecciona su hijo directo bajo
  el mouse; doble clic baja un nivel; `Ctrl/⌘ + clic` va directo al elemento de más adentro. `Enter` baja al primer hijo,
  `Mayús + Enter` sube al padre, `Tab` / `Mayús + Tab` pasa al hermano, `Esc` sube un nivel y al final deselecciona.
- **Resaltado al pasar**: rectángulo de 1 px `var(--c-seleccion)` al 70 %, sin relleno, **sin transición**.
- **Selección**: rectángulo de 1,5 px `var(--c-seleccion)`; etiqueta abajo al centro con las medidas ("120 × 34", 11 px
  mono, fondo `var(--c-seleccion)`, texto `var(--c-sobre-acento)`, radio 4, a 6 px). En una capa movible, 8 manijas de
  8 × 8 px blancas con borde de 1,5 px de la selección.
- Selección múltiple (`Mayús + clic`): v1 solo entre **marcos** (para mover, duplicar, exportar y vincular juntos).
- La URL guarda la selección (`?sel=<marco>.<capa>`): un enlace lleva a una capa exacta, y el MCP devuelve esos enlaces.

### 6.5 Regla (medir distancias)

- Con algo seleccionado, **mantener `Alt`** y pasar por otra capa: líneas de 1 px `var(--c-medida)` (token nuevo:
  `#e5484d` en claro, `#ff6b6f` en oscuro; **solo** se usa para medir) entre los bordes más cercanos de las dos cajas,
  con una pastilla al medio de cada línea con la distancia en px del marco (11 px mono, texto blanco, radio 4).
  - Cajas separadas: la distancia horizontal y/o vertical entre ellas, con guías punteadas que prolongan los bordes.
  - Una dentro de la otra (por ejemplo, pasar por el padre): las cuatro distancias a los bordes = el relleno.
- `Alt` sin selección: muestra el tamaño de lo que hay bajo el mouse.
- **Regla fija `Mayús+M`**: lo mismo sin mantener la tecla (para el trackpad y para el celular).
- Al lado de cada número, si el marco tiene unidades declaradas en el perfil y la escala se conoce (`--hu: 1px`), la
  equivalencia: "10 px · 10 hu". Preferencia "Unidad": píxeles / unidad del proyecto.
- Todo se calcula con `getBoundingClientRect` dentro del iframe: son los píxeles reales de ese marco.

### 6.6 Inspector

Cabecera de 48 px: tres pestañas (`Segmentado`): **Diseño** `Alt+8` · **Código** `Alt+9` · **Notas**.
Cuerpo con desplazamiento, padding 16. Secciones separadas por 20 px de aire, con título chico en mayúsculas (11,5 px,
`var(--c-texto-3)`). Sin líneas. Cada fila: etiqueta (12,5 px, `var(--c-texto-2)`, 84 px de ancho) y valor (13 px; los
números y colores en mono). **Todo valor se copia con un clic**: destello de `var(--c-acento-tinte)` de 600 ms y aviso
"Copiado" (el sistema de avisos existente).

**Sin selección:** resumen de la página (cantidad de marcos, de dónde viene, última sincronización), los cambios de la
última importación y la leyenda de teclas (clic, doble clic, `Alt`).

**Pestaña Diseño, con una capa o un marco:**

| Sección | Qué muestra | Se edita (solo propio) |
|---|---|---|
| Cabecera | Nombre, clase (marco, capa, instancia de «Botón»), origen ("Viene de `tienda.css`" / "Propio"), botones: copiar enlace, "Hacer una copia editable" (importado), duplicar, archivar | nombre |
| **Medidas** | X, Y (respecto del marco), ancho, alto; giro si tiene. Diagrama de caja: margen, borde, relleno y contenido, cuatro números por anillo | X, Y, ancho, alto (campos numéricos; flechas ±1, `Mayús` ±10); en un marco, además el prefijado |
| **Disposición** | Si es flex o grilla: dirección, separación, alineación, ajuste (en palabras: "Fila · separación 10 · centrado"). Posición (`absolute`, `relative`…) | no en v1 (v2) |
| **Relleno** | Muestra de 20 px + nombre del token si lo hay (`--rc-azul`) + valor. Degradados e imágenes de fondo con su miniatura | color: selector con los tokens del proyecto primero y un campo hexadecimal |
| **Borde** | Color, grosor, estilo, radio por esquina | color, grosor, radio |
| **Sombra** | Cada sombra con su muestra y valores | no en v1 |
| **Tipografía** (si tiene texto) | Familia, peso, tamaño (px y la expresión original: `calc(var(--hu) * 19)` → "19 hu"), interlineado, espaciado, alineación, color, contorno (`.rt`: color y grosor) y estilo de texto si coincide con uno | estilo de texto, familia (las del proyecto), peso, tamaño, interlineado, alineación, color |
| **Texto** | El contenido completo. Si coincide con un texto del proyecto: su clave (`T.masPesos`) y el enlace a la página Textos | contenido |
| **Imagen** | Miniatura, nombre del activo, tamaño natural y tamaño dibujado, peso, nota del índice | reemplazar (selector de activos o subir) |
| **Pieza** (instancia o pieza) | Propiedades: variante (segmentado o lista), booleanos (interruptor), textos | sí, en instancias propias: cambia `data-props` |
| **Opacidad y visibilidad** | Opacidad, visible | sí |
| **Tarjetas** | Las tarjetas vinculadas (clave, título, lista) y "Vincular tarjeta…" (buscador) | sí (siempre) |
| **Exportar** (marco) | Formato PNG · JPG · SVG, escala 1x · 2x · 3x, "Sin fondo", botones "Exportar" y "Adjuntar a la tarjeta" | — |

**Con un token, color suelto, activo, fuente o texto** (páginas de sistema y tabla): muestra grande, nombre y nombre
propio, valor por modo, alias, **dónde se declara** y **dónde se usa** (lista `archivo:línea · selector · propiedad`, las
primeras 30 y "ver todas"), y para lo importado el botón **"Proponer un cambio"** (abre el diálogo de tarjeta nueva de
Telar ya cargado: título "Diseño: cambiar `--rc-azul`", tipo decisión, el valor de hoy, un campo "Valor propuesto" y el
porqué vacío para completar; la tarjeta queda vinculada al ítem). En un token importado, **"Probar un valor"**: un campo
que cambia la variable en vivo en todos los marcos abiertos (`style.setProperty` sobre la raíz de cada iframe), con un
cartel "Probando: no se guarda" y "Volver"; desde ahí, "Proponer este cambio".

**Pestaña Código:**
1. **Reglas que le aplican** (`codigo/reglas.ts`): se recorren las hojas del iframe (`styleSheets` → `cssRules`, entrando
   en `@media`, `@supports` y `@container` cuando están activos en ese marco), se queda con las que cumplen
   `el.matches(selector)`, ordenadas de la que más manda a la que menos. Cada bloque: cabecera con el origen
   (`tienda.css:212`, tomado de `--telar-origen`; "Este marco" para el CSS propio; "En línea" para `style`), el selector
   y las declaraciones (sin `--telar-origen`). Botón copiar por bloque y "Copiar todo".
2. **Calculado**: las 12 propiedades que definen la capa, ya resueltas a px y colores.
3. **HTML**: la capa con sangría (hasta 200 líneas), copiar.
4. Para un token: `var(--rc-azul)`; para un activo: su ruta y, si el perfil lo declara, cómo se usa en el código; para un
   texto: `T.masPesos`.
- Resaltado de sintaxis propio y mínimo (propiedad, valor, comentario, selector; ~60 líneas, sin biblioteca), colores de
  los tokens `--e-*-t`.
- **En marcos propios el código se puede editar**: "Editar el CSS del marco" y "Editar el HTML de la capa" abren un campo
  de texto mono (alto hasta el 60 % del panel) con "Aplicar" `Ctrl/⌘+Enter` y "Cancelar". El servidor sanea; si rechaza
  algo, el mensaje aparece debajo del campo y no se pierde lo escrito. **Por qué:** "desplegar con código" también para
  la persona, y es la salida para todo lo que la v1 no edita con controles.

**Pestaña Notas:** nombre propio, uso (una línea), estado (Vigente · Revisar · Viejo, como `Segmentado`), nota (el editor
de Markdown existente) y los **comentarios** del objetivo (6.8). Lo escrito acá no lo pisa ninguna sincronización.

### 6.7 Diseñar (marcos propios)

**Prefijados** (`compartido/diseno/prefijados.ts`; **(verificar)** las medidas vigentes de cada red antes de cerrarlos):

| Grupo | Prefijados (ancho × alto) |
|---|---|
| Redes | Instagram posteo 1080 × 1080 · posteo vertical 1080 × 1350 · historia y reel 1080 × 1920 · Facebook y LinkedIn 1200 × 628 · X 1600 × 900 · miniatura de YouTube 1280 × 720 |
| Anuncios | 300 × 250 · 336 × 280 · 728 × 90 · 970 × 250 · 300 × 600 · 160 × 600 · 320 × 50 · 320 × 100 |
| Web | Escritorio 1440 × 900 · portátil 1366 × 768 · tablet 820 × 1180 · celular 390 × 844 · celular horizontal 844 × 390 · imagen para compartir 1200 × 630 |
| Presentación | 1920 × 1080 |
| Del proyecto | Las vistas del perfil y los tamaños de sus plantillas |
| A medida | ancho × alto |

**Qué puede hacer una persona en v1:**
1. **Crear un marco** vacío con un prefijado, **desde una plantilla** (se elige en Piezas → Plantillas; trae ranuras de
   texto e imagen) o como **copia editable** de uno importado.
2. **Mover y redimensionar marcos** en el lienzo (arrastrar del nombre o del cuerpo; 8 manijas; `Mayús` mantiene la
   proporción). Al redimensionar se ve la etiqueta de medidas.
3. **Insertar** con un clic dentro del marco: Texto `T`, Imagen `I` (selector de activos o subir), Caja `R`, o una pieza
   desde el panel. Se insertan como hijos directos con `position: absolute` en el punto del clic.
4. **Editar texto**: doble clic sobre un texto → se edita en el lugar (`contentEditable="plaintext-only"` dentro del
   iframe, con los eventos habilitados solo en ese marco mientras dura). `Esc` o clic afuera confirma. Probado (4.3).
5. **Mover y redimensionar capas** con el mouse y con las flechas (1 px; `Mayús` 10): **solo** las que están ubicadas en
   absoluto. En una capa que acomoda su contenedor, las manijas no aparecen y el inspector lo dice: "A esta capa la
   acomoda su contenedor. Cambiá sus medidas acá o editá el CSS". Sin imanes ni guías en v1.
6. **Cambiar propiedades** desde el inspector (tabla de 6.6). Se escriben como estilos en línea de la capa.
7. **Orden y visibilidad** desde Capas (arrastrar una fila entre hermanos; ojo).
8. **Variantes**: "Duplicar como variante" crea un marco hermano del mismo `grupo`; "Adaptar a otros tamaños…" abre los
   prefijados con casillas y crea un marco por tamaño con el mismo HTML y CSS. Las plantillas del sistema usan unidades
   de contenedor (`cqw`, `cqh`) y flex para que el contenido se acomode solo al tamaño nuevo; lo que no quede bien se
   ajusta a mano o se le pide a Claude.
9. **Guardar como plantilla** y **Convertir en pieza** (un marco o una capa): crea el ítem y reemplaza la capa por una instancia.
10. **Deshacer** `Ctrl/⌘+Z`: cada cambio guarda una revisión del marco; deshacer restaura la anterior (entra en la pila
    de `estado/deshacer.ts`). El inspector del marco tiene "Revisiones" (lista de las últimas 50 con autor y hora; clic
    la muestra, "Restaurar" la vuelve a poner).

Guardado: el cambio se aplica **primero en el DOM del iframe** (se ve al instante) y a los 250 ms sin tocar nada se manda
al servidor como operaciones (7.2). Si el servidor lo rechaza, se vuelve atrás y se avisa.

**Modo Probar (`P`)**: habilita los eventos del mouse en el marco seleccionado (borde de 2 px `var(--c-ia)` y cartel
"Probando · Esc para salir"). Sirve para ver los `:hover`, `:active` y las transiciones reales de una pantalla. No hay
JavaScript: es solo CSS. En el celular (v2) abre el marco a tamaño real en pantalla completa.

### 6.8 Comentarios y vínculos

- **Comentar `C`**: clic en un punto de un marco → ventanita de 280 px con un campo; `Ctrl/⌘+Enter` publica. Queda un
  **pin** de 22 px (círculo `var(--c-acento-solido)` con la inicial; los de la IA con `var(--c-ia)`), de tamaño constante.
  Clic en el pin: el hilo (comentario, respuestas, "Resolver"). Los resueltos se esconden (interruptor en Notas).
- Un comentario puede colgar de un marco, de una capa (`marco:<id>#<capa>`, sigue a la capa aunque se mueva) o de un ítem.
- **Vínculos con tarjetas**: desde el inspector (sección Tarjetas) y desde el MCP. En el **detalle de una tarjeta** aparece una sección nueva "Diseños" con las
  miniaturas de los marcos vinculados (120 px de ancho, nombre y medidas); clic abre Diseño en ese marco.
  **Una campaña** queda así: una tarjeta épica "Campaña de verano", sus tarjetas hijas (una por pieza o por tanda), y cada
  una con sus marcos vinculados. En la página de Diseño de la campaña, el nombre de cada marco muestra la clave de su
  tarjeta (`YG-14`) como pastilla.
- En el **Lienzo** de Telar, un enlace a Diseño pegado se ve como una tarjeta de enlace (ya existe el objeto "enlace").
  Con eso el marco «Interfaz» deja de ser texto: Claude le pone por MCP un enlace a cada página. El marco vivo embebido
  en el Lienzo es v2.

### 6.9 Atajos (solo con la vista Diseño activa; se suman a la tabla única `util/atajos.ts`)

| Tecla | Acción |
|---|---|
| `g d` | Ir a Diseño (desde Kanban; como `g k` y `g l`) |
| `V` · `H` o mantener `Espacio` | Seleccionar · mano |
| `F` · `T` · `I` · `R` | Marco nuevo · texto · imagen · caja |
| `C` · `P` · `Mayús+M` | Comentar · probar · regla fija |
| mantener `Alt` | Medir desde la selección |
| `Ctrl/⌘ + rueda`, `+`, `−` | Zoom (hacia el cursor) |
| `Mayús+1` · `Mayús+2` · `Mayús+0` | Ver todo · ver la selección · 100 % |
| `N` · `Mayús+N` | Marco siguiente · anterior (encuadra) |
| `RePág` · `AvPág` | Página anterior · siguiente |
| `Enter` · `Mayús+Enter` · `Tab` · `Mayús+Tab` | Bajar a los hijos · subir al padre · hermano siguiente · anterior |
| `Ctrl/⌘ + clic` | Seleccionar la capa de más adentro |
| `Esc` | Subir un nivel; salir de Probar, de la regla o de la edición |
| `Ctrl/⌘+F` o `/` | Buscar en el diseño |
| `Ctrl/⌘ + \` | Esconder o mostrar los paneles |
| `Alt+1` · `Alt+2` · `Alt+8` · `Alt+9` | Capas · Piezas · Diseño · Código |
| `Ctrl/⌘+D` · `Supr` | Duplicar · archivar el marco o quitar la capa (propios) |
| flechas · `Mayús` + flechas | Mover 1 px · 10 px (capas en absoluto y marcos) |
| `Ctrl/⌘+Mayús+E` | Exportar la selección |
| `Ctrl/⌘+Mayús+C` | Copiar el enlace a la selección |
| `Ctrl/⌘+Z` · `Ctrl/⌘+Mayús+Z` | Deshacer · rehacer |
| `M` | Minimapa |

Las acciones también entran en la paleta `Ctrl/⌘+K` ("Ir a Diseño", "Marco nuevo: historia de Instagram", "Exportar…",
"Pedir sincronización", y cada página por su nombre). Con "Atajos de una sola tecla" apagado (preferencia de la v0.2),
las de una tecla no corren.

### 6.10 Estados vacíos (molde de la v0.2: ícono de 28 px, título, ayuda, acción)

| Dónde | Título | Ayuda y acción |
|---|---|---|
| Proyecto sin nada | "Todavía no hay diseño en este proyecto" | "Importá el sistema de diseño de su código o empezá una página en blanco." Botones: "Página nueva" · "Cómo importar" (explica en tres líneas que lo hace Claude: "Pedile a Claude: *importá el diseño de este proyecto a Telar*") |
| Página de lienzo vacía | "Esta página está vacía" | "Creá un marco con `F` o pedile a Claude que arme uno." |
| Página importada sin pantallas | "Falta sincronizar las pantallas" | "Los colores, los íconos y los textos ya están. Para ver las pantallas hay que abrir la interfaz del proyecto en un navegador." Botón "Pedir sincronización" |
| Piezas sin resultados, capas de un marco sin capas, comentarios | una línea cada uno | — |
| Marco que no se pudo dibujar | dentro del marco, sobre su miniatura: "No se pudo dibujar" + "Ver el código" | — |

### 6.11 Movimiento

| Qué | Cómo | Duración y curva |
|---|---|---|
| Cambiar de página | fundido del lienzo y encuadre a "ver todo" | 160 ms + 420 ms `var(--curva)` |
| Resaltado al pasar, líneas de la regla, selección | aparecen al instante | 0 |
| Manijas de la selección | escala 0,6 → 1 | 90 ms |
| Miniatura → marco vivo | fundido cruzado | 120 ms |
| Paneles que se esconden o cambian de ancho | `transform` / ancho | 220 ms `var(--curva)` |
| Indicador de página y de pestaña | `layoutId` | resorte 500/38 |
| Contenido del inspector al cambiar de selección | fundido (sin mover) | 100 ms |
| Árbol: plegar y desplegar | alto + opacidad | 140 ms |
| Valor copiado | destello de fondo | 600 ms |
| Marco creado por la IA | el destello existente + escala 0,96 → 1 | 260 ms |
| Encuadres (`N`, `Mayús+1`, ir a un resultado) | `setViewport` | 420 ms |
| Pin de comentario nuevo | escala 0 → 1 | resorte 600/30 |

Reglas de la v0.2: solo `transform` y `opacity`; nada pasa de 260 ms salvo los encuadres; con "reducir movimiento", todo
es un fundido de 80 ms o nada.

### 6.12 Páginas de sistema y de tabla

**Sistema** (`PaginaSistema.tsx`): se dibuja en el mismo lienzo, con un nodo `marcoSistema` por sección, generado a
partir de los ítems (no se guarda como marco). Cada muestra lleva `data-item="<tipo>:<clave>"`. Las fuentes del proyecto
se cargan con `FontFace` bajo un nombre propio (`dz-<proyecto>-Fredoka`) para no chocar con las de Telar.

| Sección | Muestra |
|---|---|
| Color · Variables | Por colección (grupo): tarjetas de 120 × 96 (color 120 × 64 con radio 10; nombre 12 px; valor 11 px mono). Las que tienen modos, partidas en diagonal. Los alias muestran "→ nombre" |
| Color · Sueltos (importado) | Ordenados por tono y luz: fichas de 56 × 56 con la cantidad de usos en una esquina. Los que son iguales a una variable llevan su nombre; los que están "a un paso" de otro, un punto ámbar |
| Tipografía · Familias | Una tarjeta de 560 px por familia: "Aa" a 72 px, el abecedario, los números, y una fila por peso usado |
| Tipografía · Escala | Una fila por tamaño, de mayor a menor, agrupadas por unidad (lenguaje): "Restaurant City 1.234" dibujado a ese tamaño; a la izquierda "19 hu · 19 px · 7 usos" |
| Tipografía · Estilos de texto / con contorno | Cada estilo o par relleno-contorno, dibujado |
| Radios · Sombras | Cuadrados de 72 px con cada radio; tarjetas con cada sombra, ordenadas por uso |
| Movimiento | Duraciones y curvas: un punto que recorre 120 px con esa curva al pasar el mouse; los `@keyframes` con su nombre |
| Unidades | Qué es cada unidad del proyecto y cuánto vale en cada vista |
| **Salud del sistema** (importado) | Tarjetas con un número y un enlace al filtro: colores sin nombre · colores a un paso de otro · variables declaradas en más de una hoja (y cuántas con valores distintos) · activos sin uso encontrado · activos sin nota · textos sin uso |
| Activos | Por grupo: celdas de 104 × 116 (imagen contenida en 104 × 88; nombre 11 px). `loading="lazy"`, `content-visibility: auto` |

**Por qué "Salud del sistema":** convierte la vista en un instrumento, no en un póster. Es la lista de trabajo para ordenar
la interfaz del juego (y de cualquier proyecto que se importe), y cada punto se vuelve tarjeta con un clic.

**Tabla** (`PaginaTabla.tsx`): no es lienzo, es una tabla virtual a pantalla completa del centro (**por qué:** el propio
Figma muestra las variables en una tabla; 600 textos en un lienzo no se pueden leer ni ordenar). Columnas: Clave (mono,
200 px) · Texto (flexible; interruptor "Con la letra del proyecto") · Original (160) · Largo (56) · Usos (56). Filas de
36 px, grupos con cabecera pegada arriba, orden por columna, filtro por texto. Las llaves de las plantillas
(`{100}`) se resaltan. La selección abre el inspector igual que en el resto.

---
## 7. API, MCP y render

### 7.1 Servicio y reglas

`servidor/src/diseno/servicio-diseno.ts`: clase `ServicioDiseno(db, bus, almacen)` (usa los mismos `Conexion`, `BusEventos`
y `Almacen` del `Servicio`; se crea al lado y se cuelga como `servicio.diseno`). **Todo** pasa por ahí: la API y el MCP
llaman a los mismos métodos, así una persona y Claude no pueden hacer cosas distintas.

- Cada escritura: sanea, pone `data-id`, guarda la revisión anterior, sube `revision`, registra **actividad** con su autor
  ("Claude Code creó el marco «Historia · 2x1»") y emite el evento en vivo `diseno` (`accion`: `marco`, `item`, `pagina`,
  `comentario`, `importacion`; `datos`: los ids). La web vuelve a pedir solo eso.
- **Nada se borra**: marcos, páginas e ítems se archivan. Quitar una capa es editar el marco (queda la revisión).
- Lo importado no se edita (409 con el mensaje "Este marco viene del código. Hacé una copia editable con
  `duplicar_marco`.").
- Conflictos: `PATCH` de un marco lleva `revision`; si no coincide con la guardada, 409 y la web vuelve a cargar el
  marco (misma regla simple de "gana el servidor" que usa el resto de Telar).

### 7.2 API (`servidor/src/diseno/rutas.ts`, montada en `/api/diseno`)

`:p` es el prefijo o el id del proyecto.

| Ruta | Qué hace |
|---|---|
| `GET /:p` | Resumen: config (sin el perfil entero), páginas con contadores, estado de sincronización. Crea la config y la página Fundamentos si no existen. |
| `GET /:p/paginas/:pagina` | La página con sus marcos **sin** `html` ni `css` (nombre, sección, rectángulo, origen, miniatura, revisión, vínculos, cantidad de comentarios). |
| `GET /:p/marcos/:id` | El marco completo + las hojas y piezas que usa (lo necesario para `documentoDeMarco`). |
| `POST /:p/marcos` · `PATCH /:p/marcos/:id` · `POST /:p/marcos/:id/operaciones` | Crear · cambiar campos (nombre, posición, tamaño, sección, datos, html, css) · aplicar operaciones (las de `editar_marco`, 7.3). |
| `POST /:p/marcos/:id/duplicar` · `/archivar` · `/restaurar` `{ n }` | — |
| `GET /:p/marcos/:id/revisiones` | Últimas 50 (sin el HTML). |
| `GET /:p/items?tipo=&grupo=&q=&desde=&limite=` · `GET /:p/items/:tipo/:clave` | Ítems (paginado, 200 por página). |
| `PUT /:p/items/:tipo/:clave` · `POST /:p/items/:tipo/:clave/archivar` | Solo propios. |
| `GET /:p/css/tokens.css` | La hoja de tokens generada (con `ETag`). |
| `POST /:p/activos` (multipart) | Sube una imagen o fuente (hasta 4 MB; `png jpg webp gif svg woff2`); crea el ítem `activo` o `fuente`. |
| `PUT /:p/notas` `{ objetivo, … }` | Nota de un ítem o marco. |
| `GET/POST /:p/comentarios` · `PATCH /:p/comentarios/:id` | — |
| `PUT/DELETE /:p/vinculos` `{ objetivo, tarjeta }` · `GET /api/tarjetas/:clave/disenos` | — |
| `GET /:p/buscar?q=` | Busca en marcos (nombre y texto plano del HTML), ítems y notas. Devuelve hasta 40, con el enlace. |
| `GET /:p/marcos/:id/render?escala=&formato=&capa=&modo=&sin_fondo=` | PNG, JPG o SVG (7.4). Con `descargar=1` pone el nombre del archivo. |
| `PUT /:p/config` `{ perfil?, pedir? }` · `GET /:p/config` | Perfil de importación; `pedir: true` marca el pedido de sincronización. |
| `POST /:p/importar/…` | 5.5 (con la clave). |
| `GET /:p/importaciones` | Historial con los cambios. |

### 7.3 MCP: trece herramientas

Archivo `servidor/src/diseno/herramientas-mcp.ts` (exporta `HERRAMIENTAS_DISENO`; `herramientas.ts` las suma al arreglo
con una línea). Se siguen las convenciones de las que ya hay (nombres en castellano con verbo, `refProyecto`).

**Reglas de diseño para que un modelo las use bien** (valen para estas y, como pulido aparte, para las 16 existentes):

1. **Pocas y por intención**, no una por campo. Una herramienta de lectura con niveles, una de edición por lotes.
2. **Respuestas en texto compacto, no JSON anidado.** Un árbol de capas es una línea por capa. Tope de ~6.000 caracteres
   por respuesta; si hay más, termina con "… y 212 más. Pedí `desde: 200`" (nunca corta en silencio).
3. **Todo lo que se devuelve trae su id y su enlace** (`https://…/RC/pendientes/diseno/celular?sel=m_3fk.a1b2c3`), para que
   el modelo se lo pase al dueño.
4. **Los errores dicen qué hacer**: "No existe la capa `zz9`. Las capas de este marco: `a1b2c3` título, `d4e5f6` botón…".
5. **Referencias flexibles**: un marco se nombra por id o por nombre (si hay dos con el mismo nombre, el error los lista);
   una página por nombre; un proyecto por prefijo.
6. **Ver es parte de editar**: las herramientas que escriben aceptan `ver: true` y devuelven la captura en la misma llamada.
7. **Avisos de calidad** en cada escritura y en cada captura (7.4): texto cortado, capas fuera del marco, imágenes que no
   cargan, fuentes que faltan, texto de menos de 9 px a tamaño real.
8. **Idempotencia**: `definir_tokens`, `definir_pieza` y `subir_activo` pisan por clave; `crear_marco` acepta `clave`
   opcional para lo mismo. Así un modelo puede reintentar sin duplicar.
9. Cada descripción trae **un ejemplo de llamada** y dice cuándo usar otra herramienta.

| # | Herramienta | Lee/Escribe | Para qué |
|---|---|---|---|
| 1 | `leer_diseno` | L | Todo lo que se puede leer, por niveles |
| 2 | `buscar_en_diseno` | L | Encontrar algo por nombre, texto o valor |
| 3 | `ver_diseno` | L | La **imagen** de un marco o una capa, con avisos |
| 4 | `crear_marco` | E | Marco nuevo con HTML y CSS, de una plantilla o vacío |
| 5 | `editar_marco` | E | Lote de operaciones sobre un marco y sus capas |
| 6 | `duplicar_marco` | E | Copias, variantes, adaptación a tamaños, copia editable de un importado |
| 7 | `definir_tokens` | E | Crear o cambiar variables y estilos de texto |
| 8 | `definir_pieza` | E | Crear o cambiar una pieza o una plantilla |
| 9 | `subir_activo` | E | Imagen o fuente (desde una URL https, base64 o un adjunto de una tarjeta) |
| 10 | `organizar_diseno` | E | Páginas, secciones, orden, vínculos con tarjetas, notas, archivar |
| 11 | `comentar_diseno` | E | Comentar, responder, resolver |
| 12 | `exportar_diseno` | E | PNG, JPG o SVG; opcionalmente adjuntarlo a una tarjeta |
| 13 | `sincronizar_diseno` | L/E | Estado, perfil de importación y el comando para importar desde un repo o una web |


**Especificación.** Parámetros con `?` son opcionales. Todas aceptan `proyecto?` (prefijo; se puede omitir si hay uno solo).

**1. `leer_diseno`** — *"Lee el diseño de un proyecto. Sin más parámetros da el mapa: páginas, cantidad de marcos y de
ítems, y el estado de sincronización. Con `pagina` lista sus marcos. Con `marco` da su árbol de capas. Con `capa` da esa
capa a fondo (estilos calculados y las reglas CSS que le aplican). Con `sistema` lista tokens, piezas, activos, textos o
plantillas. Empezá siempre por acá."*

| Parámetro | Tipo | Qué |
|---|---|---|
| `pagina?` | texto | Nombre de la página |
| `marco?` | texto | Id o nombre del marco |
| `capa?` | texto | Id de la capa (requiere `marco`) |
| `sistema?` | `tokens` · `estilos` · `colores_sueltos` · `piezas` · `plantillas` · `activos` · `fuentes` · `textos` · `hojas` · `salud` | Qué parte del sistema |
| `grupo?`, `desde?` | texto, número | Filtrar y paginar |
| `con_codigo?` | booleano | Con `marco`: suma el HTML y el CSS completos |

Ejemplo de respuesta con `marco`:
```
Marco m_3fk «Historia · 2x1» · 1080×1920 · página Campaña de verano · propio · revisión 4 · tarjetas YG-14
Hojas: tokens del proyecto. Piezas usadas: boton.
a1b2c3 div.fondo                      0,0 1080×1920   fondo var(--color/marca/crema)
  d4e5f6 img «logo-yaguar»            80,96 220×64
  g7h8i9 h1 "2x1 en hamburguesas"     80,640 920×312  Fraunces 800 132px
  j1k2l3 p "Solo este finde"          80,980 920×58   Figtree 500 48px
  m4n5o6 ◇ boton {color: naranja, etiqueta: "Pedí ahora"}  80,1620 420×120
Avisos: ninguno.
https://telarapp.vercel.app/YG/campanas/diseno/campana-de-verano?sel=m_3fk
```
Las cajas (`x,y ancho×alto`) salen del último render; si el marco nunca se dibujó, se dibuja en el momento.

**2. `buscar_en_diseno`** — `consulta` (texto), `en?` (`marcos` · `capas` · `tokens` · `activos` · `piezas` · `textos`),
`limite?` (20). *"Busca por nombre, por texto o por valor (un color `#38bde6`, una medida). Devuelve qué es, dónde está y
su id. Usala antes de crear un token o una pieza: quizá ya existe."*

**3. `ver_diseno`** — `marco`, `capa?`, `escala?` (0,25 a 2; de fábrica la que deja el lado mayor en 1.024 px), `modo?`,
`estados?` (booleano), `sobre?` (`claro` · `oscuro` · `transparente`). Devuelve **una imagen PNG** (contenido MCP de tipo
`image`) y un texto: medidas, revisión y **avisos**. *"Mirá cómo quedó un marco. Usala después de crear o editar, y antes
de decir que algo está listo. Si hay avisos, arreglalos con `editar_marco`."* Para comparar variantes: `marcos?: [ids]`
devuelve hasta 6 en una sola imagen, en grilla, con su nombre.

**4. `crear_marco`** —

| Parámetro | Tipo | Qué |
|---|---|---|
| `pagina` | texto | Nombre; si no existe, se crea |
| `nombre` | texto | — |
| `tamano` | texto o `{ ancho, alto }` | Un prefijado (`instagram-historia`, `anuncio-300x250`, `celular-horizontal`…; la lista completa va en la descripción) o medidas |
| `html?`, `css?` | texto | El contenido. El CSS vale solo para este marco |
| `plantilla?`, `ranuras?` | texto, objeto | En vez de `html`: una plantilla y sus textos e imágenes (`{ titulo: "…", foto: "/archivos/…" }`) |
| `hojas?` | lista | Hojas importadas que usa (por ejemplo `["ui.css", "tienda.css"]` para una pantalla nueva del juego) |
| `seccion?`, `grupo?`, `fondo?`, `modo?` | texto | — |
| `tarjetas?` | lista | Claves a vincular (`["YG-14"]`) |
| `clave?` | texto | Si ya hay un marco propio con esa clave, lo reemplaza en vez de crear otro |
| `ver?` | booleano | Devolver la captura |

La descripción trae las **reglas para escribir el HTML** (son las que evitan los errores típicos):
*"HTML y CSS comunes. Sin `<script>`, sin `<link>`, sin recursos de afuera: las imágenes y fuentes se suben antes con
`subir_activo`. El marco mide exactamente `tamano` y recorta lo que se sale. Usá los tokens del proyecto como variables
(`var(--color-marca-primario)`; `leer_diseno sistema: tokens` las lista) y las clases de estilo de texto (`.t-titulo`).
Para usar una pieza: `<div data-pieza="boton" data-props='{"color":"naranja","etiqueta":"Pedí ahora"}'></div>`. Poneles
`data-nombre` a las capas importantes. Para piezas que se van a adaptar a varios tamaños, medí en `cqw`/`cqh` (el `body`
es un contenedor) y acomodá con flex. No hace falta `<html>` ni `<body>`."*

Ejemplo:
```json
{ "proyecto": "YG", "pagina": "Campaña de verano", "nombre": "Posteo · 2x1", "tamano": "instagram-posteo", "tarjetas": ["YG-14"], "ver": true,
  "html": "<div class='fondo' data-nombre='Fondo'><img data-nombre='Logo' src='/archivos/diseno/…/logo.svg'><h1 class='t-titulo'>2x1 en hamburguesas</h1><p>Solo este finde</p><div data-pieza='boton' data-props='{\"etiqueta\":\"Pedí ahora\"}'></div></div>",
  "css": ".fondo{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:3cqh;padding:8cqw;background:var(--color-marca-crema)} h1{font-size:12cqw;margin:0}" }
```

**5. `editar_marco`** — `marco`, `operaciones` (lista, se aplican en orden y **todas o ninguna**), `ver?`.

| Operación | Campos | Qué hace |
|---|---|---|
| `texto` | `capa`, `texto` | Cambia el texto de una capa |
| `estilo` | `capa`, `estilos` `{ propiedad: valor }` | Estilos en línea (`null` quita). Ej. `{ "color": "var(--color-marca-tinta)", "font-size": "10cqw" }` |
| `atributo` | `capa`, `nombre`, `valor` | `src`, `alt`, `class`, `data-nombre`, `data-props`… |
| `propiedades` | `capa`, `valores` | Cambia propiedades de una instancia de pieza |
| `reemplazar` | `capa`, `html` | Reemplaza la capa entera |
| `insertar` | `html`, y uno de `dentro` / `antes_de` / `despues_de` (id de capa; sin ninguno, al final del marco) | Agrega capas |
| `quitar` | `capa` | — |
| `mover` | `capa`, y `antes_de` / `despues_de` / `dentro` | Cambia el orden o el padre |
| `css` | `css` y `como`: `reemplazar` · `agregar` | El CSS del marco |
| `marco` | `nombre?`, `tamano?`, `fondo?`, `modo?`, `seccion?`, `grupo?`, `x?`, `y?` | Datos del marco |
| `restaurar` | `revision` | Vuelve a una revisión |

Respuesta: una línea por operación ("texto g7h8i9: «2x1 en hamburguesas» → «3x2 en hamburguesas»"), la revisión nueva, los
ids de las capas creadas, los avisos y, con `ver`, la imagen.

**6. `duplicar_marco`** — `marco`, y una de: `copias` (lista de `{ nombre?, tamano?, textos?: { capa: texto }, estilos?,
propiedades? }`), `tamanos` (lista de prefijados: una adaptación por tamaño, mismo `grupo`), o nada (una copia). `pagina?`
(a qué página; de fábrica, la misma; desde un marco importado va a una página propia y la copia es **editable**).
*"Para armar las variantes de una pieza publicitaria (otros tamaños, otros textos) o para partir de una pantalla real del
proyecto."* Devuelve los ids y, con `ver`, la grilla.

**7. `definir_tokens`** — `tokens?`: lista de `{ nombre (con barras: "color/marca/primario"), clase, valor, modos?, alias?,
uso? }`; `estilos_de_texto?`: lista de `{ nombre, familia, peso, tamano, interlineado, espaciado? }`. Pisa por nombre.
Devuelve la variable CSS de cada uno (`--color-marca-primario`) y la clase de cada estilo (`.t-titulo`). No toca lo importado.

**8. `definir_pieza`** — `nombre`, `clase?` (`pieza` · `plantilla`), `html`, `css?`, `propiedades?` (lista de `{ nombre,
clase: variante|texto|booleano|imagen, valores?, defecto }`), `desde?` (`{ marco, capa? }`: la crea a partir de algo que ya
existe y lo reemplaza por una instancia), `tamano?` (plantillas). En el HTML: `{{nombre}}` para textos, `data-si="nombre"`
para lo que depende de un booleano; las variantes llegan como `data-<nombre>="valor"` en la raíz para el CSS.
Crea además su **hoja de variantes** en la página "Piezas" (un marco con todas las combinaciones, hasta 24).

**9. `subir_activo`** — `nombre`, `grupo?`, y uno de: `url` (https público; hasta 4 MB; el servidor valida que sea imagen
o fuente y no acepta direcciones internas), `base64` + `mime` (hasta 1 MB), `adjunto` (`{ tarjeta, nombre }`: un adjunto
que ya está en Telar). Devuelve la ruta (`/archivos/diseno/…`) y las medidas. Para una fuente: `familia`, `pesos`.

**10. `organizar_diseno`** — `acciones`: lista de `{ accion, … }`:
`crear_pagina` (`nombre`) · `renombrar` (`que`, `nombre`) · `mover_marcos` (`marcos`, `pagina?`, `seccion?`) ·
`ordenar_pagina` (`pagina`) · `vincular` / `desvincular` (`que`: marco, página o ítem; `tarjeta`) · `anotar` (`que`,
`nombre_propio?`, `uso?`, `estado?`, `nota?`) · `bloquear` (`marco`, `si`) · `archivar` / `restaurar` (`que`).

**11. `comentar_diseno`** — `en` (marco, `marco#capa` o ítem), `texto`, `punto?` (`{ x, y }` en px del marco),
`responde_a?`, `resolver?` (id). Sin `texto`, lista los comentarios abiertos de `en` (o de todo el proyecto).

**12. `exportar_diseno`** — `marcos` (lista) o `grupo` o `pagina`, `formato` (`png` · `jpg` · `svg`), `escala?` (1, 2, 3),
`sin_fondo?`, `adjuntar_a?` (clave de tarjeta: los deja como adjuntos de esa tarjeta, con nombre
`<pagina>-<marco>-<ancho>x<alto>@2x.png`). Devuelve los enlaces de descarga.

**13. `sincronizar_diseno`** — sin parámetros: estado (última importación, cambios, si el dueño **pidió** sincronizar) y
el **comando exacto** para correr en el repo. Con `perfil`: guarda el perfil de importación (el modelo lo arma mirando el
repo: hojas, fuentes, imágenes, textos, pantallas; la descripción trae el esquema y los dos ejemplos de 5.2). Con
`hecho: true`: borra el pedido. *"Importar necesita leer archivos y a veces abrir un navegador: no se hace desde acá, se
hace corriendo `npm run diseno:importar` donde está el repo. Si el proyecto es el juego Restaurant City, sacar pantallas
abre su interfaz de prueba: hacelo solo si el dueño lo pidió (el campo `pedido` dice si lo hizo)."*

`INSTRUCCIONES_MCP` suma un párrafo: *"Diseño: cada proyecto tiene un espacio de diseño (páginas → marcos → capas) y un
sistema (tokens, piezas, activos, textos). Un marco es HTML + CSS. Flujo típico: `leer_diseno` → (`definir_tokens`,
`subir_activo`, `definir_pieza` si hace falta) → `crear_marco` con `ver: true` → mirar la imagen → `editar_marco` →
`duplicar_marco` para las variantes → `organizar_diseno` para vincular con tarjetas → `exportar_diseno`. Lo importado del
código no se edita: se copia o se propone el cambio en una tarjeta."*

### 7.4 Render en el servidor (decisión D7)

`servidor/src/diseno/render.ts`: `renderizar({ marco, capa?, escala, formato, modo, estados, sinFondo }) → { bytes, mime, avisos, cajas }`.

1. Arma el documento con `documentoDeMarco` (el mismo de la web).
2. Abre una página de Chromium del tamaño del marco (`deviceScaleFactor = escala`), intercepta **todos** los pedidos: los
   de `/archivos/**` los contesta directo desde el almacén (sin HTTP ni cookies); cualquier otro se aborta.
   `page.setContent(documento)`; la política de contenido del documento impide cualquier script.
3. Espera `document.fonts.ready` y las imágenes; saca la captura (`omitBackground` si `sinFondo`); con `capa`, recorta a su caja.
4. Con `page.evaluate` (corre por el protocolo de depuración, no es código de la página) junta las **cajas** de las
   capas con `data-id` y los **avisos**: capa fuera del marco (más de 2 px), texto cortado (`scrollWidth > clientWidth`
   con desborde oculto), imagen sin cargar, familia tipográfica que no está (`document.fonts.check`), texto de menos de
   9 px a tamaño real.
5. Guarda la miniatura del marco (WebP, lado mayor 640) y las cajas en `datos.cajas` (las usa `leer_diseno`).
6. **SVG**: documento SVG con un `<foreignObject>` que lleva el HTML y el CSS con imágenes y fuentes embebidas en
   `data:`. Se ve idéntico en navegadores; **no es un vector editable** en Illustrator o Figma, y la interfaz lo dice
   ("SVG para web"). Un activo que ya es SVG se exporta tal cual. El SVG de trazos editables es v2 (13.1).

**Dónde corre Chromium.**
- Local: `playwright-core` (Apache-2.0; sin descargar navegadores) con el Chrome instalado (`channel: 'chrome'` o la ruta
  en `TABLERO_CHROME`). Un solo navegador vivo, que se cierra a los 60 s sin uso.
- Online (Vercel): una **función aparte**, `render.func` (para no engordar ni enfriar la función principal), con
  `@sparticuz/chromium` (MIT; el Chromium empaquetado para funciones) y `playwright-core`. `scripts/vercel.mjs` suma esa
  función y la ruta `^/api/diseno/[^/]+/marcos/[^/]+/render` → `/render`. **(verificar)** tamaño (límite de 250 MB
  descomprimida), memoria (1.024 MB) y arranque en frío (se esperan 3 a 6 s; después, menos de 1 s por captura).
  **(dueño)** es un cambio en Vercel: no cuesta plata en el plan de hoy, pero se le avisa antes de publicarlo.
- El MCP llama a `renderizar` igual en los dos casos: en Vercel, la función principal le pide la imagen a la de render
  por HTTP interno con la clave.

**Plan B si el Chromium en Vercel no entra o tarda demasiado:** (1) la web, cuando está abierta, dibuja las miniaturas
de los marcos que cambian con la misma técnica del SVG (`foreignObject` → `canvas` → WebP) y las sube; `ver_diseno`
devuelve la última y dice de cuándo es; (2) `npm run diseno:ver -- --marco <id>` las saca con el Chrome local para
Claude Code. Exportar PNG desde la web usaría esa misma técnica. Es peor (depende de tener la app abierta), por eso es
plan B y no la decisión.

### 7.5 Cómo se prueba el MCP de punta a punta

**Prueba automática** `scripts/diseno/prueba-mcp.mjs` (`npm run diseno:probar-mcp`): levanta Telar local con una carpeta
de datos nueva, crea el proyecto "Estudio de prueba" (`EP`) con una tarjeta `EP-1` y se conecta a `/mcp` **como cualquier
cliente**, con el cliente oficial de MCP por HTTP y la clave (**(verificar)** el nombre del paquete cliente del SDK que
ya usa Telar, v2). Corre y comprueba:

| Paso | Llamada | Se comprueba |
|---|---|---|
| 1 | `leer_diseno` | Mapa vacío con la página Fundamentos |
| 2 | `definir_tokens` (5 colores, 2 estilos de texto) | Devuelve las variables; `leer_diseno sistema: tokens` las lista |
| 3 | `subir_activo` (un SVG de logo en base64) | Ruta bajo `/archivos/diseno/` |
| 4 | `definir_pieza` "boton" con variante `color` y texto `etiqueta` | Se creó su hoja de variantes |
| 5 | `crear_marco` posteo 1080 × 1080 con tokens, logo, pieza, `tarjetas: ["EP-1"]`, `ver: true` | Llega una imagen PNG de 1.024 px de lado; sin avisos |
| 6 | `crear_marco` con un `<script>` y una imagen de afuera | Error claro que nombra `subir_activo`; no se creó nada |
| 7 | `editar_marco`: cambiar el título por uno larguísimo | Aviso "texto cortado"; arreglarlo con `estilo` y volver a ver: sin avisos |
| 8 | `duplicar_marco` con `tamanos: ["instagram-historia", "anuncio-300x250", "anuncio-728x90"]` | Tres marcos del mismo grupo; `ver_diseno marcos:[…]` devuelve la grilla |
| 9 | `definir_tokens` cambiando el color primario | La captura del paso 5 cambia (comparación de píxeles: distinta) |
| 10 | `comentar_diseno` y `organizar_diseno` (anotar, mover a una sección) | Se leen de vuelta |
| 11 | `exportar_diseno` png 2x con `adjuntar_a: "EP-1"` | La tarjeta tiene 4 adjuntos de las medidas correctas (2160 × 2160…) |
| 12 | `editar_marco` sobre un marco importado de prueba | Error 409 con la indicación de `duplicar_marco` |
| 13 | `buscar_en_diseno "#"+color` y `leer_diseno marco` | Encuentra el token; el árbol trae cajas |

Al final abre la app con Playwright y saca la captura **M1** (la página "Campaña de prueba" con los cuatro marcos).
Tiene que pasar entero en menos de 60 s.

**Prueba con un modelo de verdad** (la hace el ejecutor una vez, a mano, y la deja escrita en la entrega): con Claude Code
conectado al MCP local, este pedido y nada más: *"En el proyecto EP armá una campaña de ejemplo para una hamburguesería:
una marca chica (colores y dos estilos de texto), un posteo de Instagram, su historia y un banner de 300 × 250, vinculados a
la tarjeta EP-1, y exportalos."* Se anota: cantidad de llamadas, **cantidad de errores de herramienta** (objetivo: 0 o 1
que el modelo corrige solo), si miró sus capturas, y la captura final **M2**. Si el modelo se equivoca dos veces en lo
mismo, se corrige **la descripción de la herramienta**, no el pedido.

---
## 8. Convivencia con la v0.2 y archivos

### 8.1 Carpetas propias

```
compartido/diseno/
  tipos.ts            Pagina, Marco, Item y sus datos, Comentario, Vinculo, Operacion, Perfil (zod)
  documento.ts        documentoDeMarco, expandirPiezas, estadosDeCss
  tokens.ts           hoja de tokens y de estilos de texto; nombre de token → variable CSS
  prefijados.ts       tamaños
  acomodar.ts         acomodo automático de marcos
  capas.ts            nombre e ícono de una capa; árbol compacto en texto (lo usan la web y el MCP)
servidor/src/diseno/
  servicio-diseno.ts  toda la lógica
  rutas.ts            sub-aplicación de Hono
  sanear.ts           HTML y CSS (parse5)
  operaciones.ts      aplica las operaciones de editar_marco sobre el HTML
  render.ts           Chromium
  importar.ts         empezar, archivo, lote, terminar
  herramientas-mcp.ts las trece herramientas
  vercel-render.ts    entrada de la función de render
web/src/vistas/diseno/
  Diseno.tsx          la vista (se carga con lazy); importa ../../estilos/diseno.css
  estado.ts           tienda de zustand propia: página, marcos, ítems, selección, herramienta, vivos
  api.ts              llamadas a /api/diseno
  panel-izq/          PanelIzquierdo, Paginas, Capas (árbol virtual), Piezas, Buscador, PastillaSync
  lienzo/             LienzoDiseno, MarcoNodo, MarcoVivo, MarcoSistema, Seccion, CapaSeleccion, Regla, elegir.ts,
                      vivos.ts (cola y tope de iframes), Herramientas, Zoom, Migas, MarcoNuevo, Pines
  inspector/          Inspector, secciones/*.tsx, codigo/{reglas.ts, resaltar.ts, Codigo.tsx}, Notas, Exportar
  sistema/            PaginaSistema y una pieza por sección (Colores, Tipografia, Activos, Movimiento, Salud…)
  tabla/              PaginaTabla
  editar/             texto.ts (edición en el lugar), mover.ts, propiedades.ts (control → operación), deshacer.ts
web/src/estilos/diseno.css
scripts/diseno/       importar.ts y sus pasos (5.1), perfiles/RC.json, perfiles/RC.recetas.mjs, prueba-mcp.mjs,
                      capturas.mjs, sembrar.mjs (datos de prueba), ver.mjs
supabase/migrations/20261201090000_diseno.sql
```

### 8.2 Lo compartido que se toca (y nada más)

| Archivo | Cambio | Tamaño |
|---|---|---|
| `web/src/estado/ruta.ts` | `vista: 'kanban' \| 'lienzo' \| 'diseno'`; `pagina` (cuarto tramo de la ruta) y `sel` (parámetro). `/RC/pendientes/diseno/celular?sel=m_1.a1b2c3` | ~15 líneas |
| `web/src/vistas/BarraSuperior.tsx` | Tercera pestaña "Diseño" (ícono `PenTool` de lucide, tecla `g d`) | 1 línea en el arreglo |
| `web/src/App.tsx` | `const Diseno = lazy(…)` y su rama en la escena; atajo `g d`; la clase `app--sin-lateral` también cuando la vista es Diseño y la preferencia lo pide | ~12 líneas |
| `servidor/src/api.ts` | `api.route('/diseno', rutasDiseno(estado))`; `.webp`, `.png`, `.jpg`, `.svg`, `.woff2` en la tabla de tipos **(verificar cuáles faltan)** | 2 a 6 líneas |
| `servidor/src/servidor.ts`, `vercel.ts` | Crear `ServicioDiseno` junto al `Servicio` | 2 líneas |
| `servidor/src/mcp/herramientas.ts` | `...HERRAMIENTAS_DISENO` en el arreglo y el párrafo de `INSTRUCCIONES_MCP` | 3 líneas |
| `compartido/tipos.ts` | `'diseno'` en `Evento.tipo` | 1 línea |
| `web/src/estado/eventos.ts` | Pasarle los eventos `diseno` a la tienda de Diseño | ~4 líneas |
| `web/src/vistas/tarjeta/Secciones.tsx` | Sección "Diseños" (un componente que vive en `vistas/diseno/`) | 1 importación + 1 línea |
| `web/src/vistas/Paleta.tsx`, `web/src/util/atajos.ts` | Comandos y filas de atajos | datos |
| `web/src/estilos/tokens.css` | `--c-medida` en los dos temas | 2 líneas |
| `scripts/vercel.mjs` | La función `render.func` y su ruta | ~25 líneas |
| `package.json` | Dependencias: `parse5` (MIT), `playwright-core` (Apache-2.0), `@sparticuz/chromium` (MIT). De desarrollo: `postcss` (MIT). Comandos `diseno:importar`, `diseno:probar-mcp`, `diseno:ver`, `diseno:capturas` | — |
| `README.md` | Sección "Diseño", herramientas del MCP y el paso de la migración | — |

No se tocan: `kanban.css`, `tarjeta.css`, `detalle.css`, `vistas/kanban/**`, `vistas/lienzo/**`, `web/src/movil/**`,
`index.html`. Ningún estilo de `diseno.css` sale de `.diseno` (todas las reglas empiezan con esa clase).

### 8.3 Qué reutiliza de la v0.2 y qué hace si no está

| Pieza de la v0.2 | Para qué | Si todavía no existe |
|---|---|---|
| Tema carbón y tokens nuevos (`--c-seleccion` azul, `--c-acento-solido`, `--c-sobre-acento`) | Selección, botones | `diseno.css` declara respaldos en `.diseno` (`--dz-seleccion: var(--c-seleccion, #2f6fde)`) |
| Variable `--z` (tamaño constante con el zoom) | Nombres de marco, pines | El lienzo de Diseño la escribe él mismo con `useOnViewportChange` (es un `ReactFlow` aparte: lo hace igual) |
| `estado/preferencias.ts` | Anchos de paneles, unidad, fondo del lienzo, lateral en Diseño, bajo `diseno: { … }` | Clave propia `telar.diseno` en `localStorage` |
| Molde de la barra de herramientas y de la barra contextual (cajas, medidas, `layoutId`) | Barra de herramientas y controles | Se copian las medidas de este plan (están escritas en 6.3) |
| `SelectorColor`, `Interruptor`, `Segmentado`, `Desplegable` | Inspector | `Segmentado` y `Desplegable` ya están en v0.1; los otros dos se hacen mínimos dentro de `vistas/diseno/` |
| `AvatarProyecto` | Cabecera del panel | Sello de dos letras |
| Catálogo de movimiento y `MotionConfig` | 6.11 | Las duraciones de este plan |
| `util/atajos.ts` (tabla única) | Atajos | Se agregan a `Atajos.tsx` como hoy |
| Diálogo de tarjeta nueva / `Compositor` | "Proponer un cambio" | `POST /api/tarjetas` directo con el texto armado y aviso con enlace |
| Capa del celular (`HojaInferior`, `HojaMas`) | 10 | Diseño no aparece en el teléfono (mensaje: "Diseño se usa en la computadora por ahora") |
| Rutas del service worker de la PWA | — | **Avisar al plan móvil**: `/api/diseno` y `/archivos/diseno` siguen la regla general (el service worker no toca `/api` ni `/archivos`): no hay cambio |

---

## 9. Rendimiento

Presupuesto: 60 cuadros por segundo al mover y hacer zoom con la página más pesada (Celular de RC, ~45 marcos de
844 × 390, o Íconos con 444 imágenes); menos de 1,5 s para ver la primera página; el trozo de Diseño ≤ 90 KB gzip y
fuera de la carga inicial de Telar.

| # | Regla | Detalle |
|---|---|---|
| R1 | **Miniatura primero** | Todo marco se dibuja como `<img>` de su miniatura (WebP, ~40 KB, `loading="lazy"`, `decoding="async"`). El marco se ve al instante y a cualquier zoom. |
| R2 | **Vivo solo si hace falta** | Un marco pasa a iframe cuando: está en pantalla, ocupa más de 240 px de ancho en pantalla (por debajo la miniatura alcanza) y el lienzo lleva 150 ms quieto; o está seleccionado. |
| R3 | **Tope de 12 iframes vivos** (`vivos.ts`) | Cola con prioridad (seleccionado → bajo el mouse → más cerca del centro). Al llegar al tope se apaga el que hace más tiempo no se ve. Los que salen de pantalla se apagan a los 3 s. Montaje de a 2 por cuadro libre (`requestIdleCallback`). |
| R4 | **Hojas compartidas** | Las hojas importadas van por `<link>` a una URL con hash (`immutable`): se bajan y se analizan una vez; cada iframe las reusa de la caché. Medido con hojas de 400 KB **en línea** (peor caso): 18 ms por iframe. |
| R5 | **Animaciones en pausa** | `animation-play-state: paused` en todo marco que no esté en modo Probar: 12 pantallas con animaciones infinitas no gastan nada. |
| R6 | **El lienzo no vuelve a dibujar React al moverse** | `--z` y las clases de zoom se escriben directo al DOM; `CapaSeleccion` se actualiza por `requestAnimationFrame` leyendo el *viewport*, sin estado de React. Los nodos están memorizados y solo cambian si cambia su marco. |
| R7 | **Solo lo visible** | `onlyRenderVisibleElements` para los nodos; `content-visibility: auto` y `contain-intrinsic-size` en las grillas de sistema; listas virtuales en Capas, Piezas y Textos. |
| R8 | **Datos por página** | Entrar a Diseño baja el resumen (1 pedido, < 20 KB). Cada página baja sus marcos sin HTML. El HTML de un marco se pide recién al pasar a vivo y queda en memoria (hasta 40 marcos). Los ítems, por tipo y paginados. |
| R9 | **Capas a pedido** | El árbol de un marco se arma al desplegarlo; el cálculo de "qué hay bajo el mouse" es una sola llamada por cuadro. |
| R10 | **Lejos, menos** | Con zoom < 0,12: se esconden los nombres de marco y los pines; quedan las miniaturas y los títulos de sección. |
| R11 | **Fuentes** | Las del proyecto se cargan una vez al entrar a una página que las use (`FontFace`), no al abrir Telar. |
| R12 | **Online, poca base** | `/archivos/diseno/**` responde `Cache-Control: private, max-age=31536000, immutable` (ya lo hace): una imagen se pide a la base una vez por navegador. La primera visita a Íconos son ~220 pedidos chicos: se cargan al hacerse visibles. **(verificar)** el tiempo real contra Supabase; si molesta, plan B: una hoja de sprites por grupo armada por el importador. |

Medición que entrega el ejecutor (`scripts/diseno/capturas.mjs --medir`): cuadros por segundo y peor cuadro moviendo la
página Celular y la de Íconos; cantidad máxima de iframes vivos (≤ 12); memoria después de recorrer las seis páginas;
tiempo hasta la primera página; peso del trozo.

---

## 10. En el celular

v1: **solo mirar**, y solo si la capa del celular de la v0.2 ya existe (prioridad P2, paquete PD-13). Entrada desde la
hoja "Más" → "Diseño". Selector de página arriba; el lienzo con dos dedos; un toque selecciona el marco; el inspector
(pestañas Diseño y Código) es una `HojaInferior`; regla fija con un botón. Sin edición. **Por qué tan poco:** en 6
pulgadas no se diseña; lo valioso es **ver las pantallas del celular en un celular**, y eso es el modo Probar a tamaño
real, que queda para la v2 junto con el resto del celular. Si la capa del celular no está, Diseño no aparece ahí.

---

## 11. Orden de ejecución

Esfuerzo (de agente): S ≈ 1–2 h · M ≈ medio día · L ≈ un día · XL ≈ dos días. Cada paquete termina con
`npm run typecheck`, la app andando y sus capturas.

| Paquete | Qué | Depende de | Esf. | Prioridad |
|---|---|---|---|---|
| **PD-0** | Base: migración, `compartido/diseno/*` (tipos, documento, tokens, prefijados, acomodar, capas), `sanear.ts` con sus pruebas (30 casos de HTML y CSS maliciosos: `<script>`, `onerror`, `javascript:`, `@import`, `url(http…)`, SVG con script), `ServicioDiseno` (páginas, marcos, ítems, revisiones), rutas de lectura y escritura, evento `diseno`, `scripts/diseno/sembrar.mjs` (un proyecto de prueba con 3 páginas, 12 marcos, 40 ítems) | v0.2 junta | L | P0 |
| **PD-1** | Cáscara: ruta, pestaña, vista con las tres columnas, panel izquierdo (páginas), lienzo con `MarcoNodo` (miniatura y vivo, `vivos.ts`), zoom, encuadres, nombres de marco, estados vacíos | PD-0 | L | P0 |
| **PD-2** | Selección: `elegir.ts`, `CapaSeleccion`, niveles, migas, árbol de Capas (virtual, resaltado cruzado), URL con la selección | PD-1 | L | P0 |
| **PD-3** | Inspector de lectura: pestaña Diseño (todas las secciones), pestaña Código (reglas con origen, calculado, HTML, resaltado), copiar con un clic. **Regla** (`Alt` y `Mayús+M`) | PD-2 | XL | P0 |
| **PD-4** | Render del servidor local (`render.ts`, avisos, cajas, miniaturas, SVG) y la ruta `/render`. Exportar desde el inspector | PD-0 | L | P0 |
| **PD-5** | MCP: las trece herramientas, `operaciones.ts`, instrucciones; `prueba-mcp.mjs` completa | PD-0, PD-4 | XL | P0 |
| **PD-6** | Importador, parte estática: perfil, hojas (con origen y estados), tokens, colores sueltos, tipografía, activos, fuentes, textos, paquete, subida, historial de cambios. Perfil `RC.json`. Páginas de **sistema** (Fundamentos, Íconos) y de **tabla** (Textos). Pastilla de sincronización | PD-1, PD-3 | XL | P0 |
| **PD-7** | Importador, páginas: instantáneas, recetas, hojas de variantes con estados; perfil de RC completo; páginas Componentes, Celular y PC. **(dueño)** el sí para abrir el arnés del juego | PD-6, PD-4 | XL | P0 |
| **PD-8** | Diseñar: marco nuevo con prefijados, mover y redimensionar marcos, insertar texto, imagen y caja, editar texto en el lugar, propiedades editables del inspector, orden y visibilidad, deshacer y revisiones, código editable, copia editable | PD-3 | XL | P0 |
| **PD-9** | Sistema propio: tokens y estilos de texto (crear y editar en Fundamentos), subir activos y fuentes, piezas e instancias con propiedades, plantillas, variantes y "Adaptar a otros tamaños", guardar como plantilla, convertir en pieza | PD-8 | L | P0 |
| **PD-10** | Vínculos con tarjetas (inspector y sección "Diseños" en la tarjeta), comentarios y pines, notas, "Proponer un cambio", "Probar un valor", modo Probar | PD-3 | L | P1 |
| **PD-11** | Mover y redimensionar **capas** con el mouse y las flechas; Salud del sistema; búsqueda global; comandos en la paleta | PD-8, PD-6 | L | P1 |
| **PD-12** | Render online: función `render.func` en Vercel, o el plan B de 7.4 | PD-4 | M | P1 **(dueño)** |
| **PD-13** | Celular: visor (sección 10) | capa del celular | M | P2 |
| **PD-14** | Cierre: pulido de movimiento, foco y accesibilidad (roles `tree`, `toolbar`, `tablist`; todo con teclado), rendimiento medido, README, capturas, prueba con un modelo real, importación real de RC en local, enlaces en el marco «Interfaz» del Lienzo por MCP | todo | L | P0 |

Total: 14 a 17 días de agente. **Corte si hay que recortar:** primero PD-13, después PD-11 y PD-12 (queda el plan B), después
la mitad de PD-10 (comentarios). **No se recortan** PD-5 (MCP) ni PD-7 (pantallas): son los dos pedidos del dueño.
PD-4/PD-5 y PD-1/PD-2/PD-3 no comparten archivos: con dos ejecutores van en paralelo después de PD-0.

**Orden frente a la producción (todo (dueño)):** 1) aplicar la migración online; 2) publicar Telar con Diseño;
3) correr la importación de RC contra el Telar online con la clave; 4) que el dueño lo mire.

---

## 12. Terminado cuando

### 12.1 Criterios

1. Una carpeta de datos de la v0.2 arranca con Diseño sin errores; el SQL corre dos veces seguidas sin error.
2. `npm run typecheck` limpio. Las pruebas de `sanear.ts` pasan. `npm run diseno:probar-mcp` pasa entero.
3. El Kanban y el Lienzo no cambian: las capturas del grupo A de la v0.2 son iguales antes y después.
4. Importación de RC en local (rama `ccr-ac61dbdf-s4s7ws` o la que esté vigente): el informe dice cuántos tokens,
   colores sueltos, activos, fuentes, textos, piezas y pantallas entraron, y coincide en orden de magnitud con 2.2
   (88 variables, ~320 colores, 444 activos, 3 fuentes, ~600 textos). Una segunda importación sin cambios dice "0 cambios".
5. En un marco importado del HUD del celular, al seleccionar el número de los pesos el inspector muestra Fredoka, el
   tamaño en px y en `hu`, el contorno, y en Código la regla de `hud-mobile.css` con su número de línea.
6. Con `Alt` se mide la distancia entre dos botones del HUD y coincide con el CSS (por ejemplo, la separación de 10 `hu`).
7. Ningún marco corre scripts: un marco de prueba con `<script>` guardado a la fuerza en la base no ejecuta nada y una
   imagen de afuera no se pide (se comprueba en la pestaña de red).
8. Con 45 marcos en la página, nunca hay más de 12 iframes en el DOM y el desplazamiento mantiene 60 cuadros por segundo
   (o lo medido, informado).
9. Una persona puede: crear una historia de Instagram desde una plantilla, cambiarle el título y la foto, adaptarla a
   posteo y a un banner, vincularla a una tarjeta y exportar los tres PNG a 2x. Sin tocar código.
10. Claude puede hacer lo mismo por MCP (prueba con modelo real, 7.5) con 0 o 1 errores de herramienta.
11. El material de RC no está en `git status`, ni en `dist/`, ni en `.vercel/output/static`.

### 12.2 Capturas que entrega el ejecutor

1440 × 900, escala 1, con `scripts/diseno/capturas.mjs`, en `docs/capturas/diseno/`. **(c/o)** = en claro y en oscuro.
Las de RC se sacan en local y **no se suben al repo** (llevan material original): quedan en `.datos/capturas-diseno/` y
se le muestran al dueño; al repo van solo las del proyecto de prueba.

| Id | Qué muestra |
|---|---|
| E1 | La vista entera con un marco seleccionado: tres columnas, sin contornos **(c/o)** |
| E2 | Panel izquierdo: páginas, árbol de capas desplegado, resaltado cruzado |
| E3 | Pestaña Piezas con piezas, plantillas y activos |
| E4 | Un marco al 25 %, 100 % y 400 %: selección de 1,5 px y nombre del mismo tamaño en las tres |
| E5 | Inspector, pestaña Diseño, de un texto (tipografía, relleno con nombre de token, caja) **(c/o)** |
| E6 | Inspector, pestaña Código: reglas con archivo y línea **(c/o)** |
| E7 | Regla: dos cajas separadas y una dentro de otra (relleno) |
| E8 | Proyecto sin diseño (estado vacío) y página vacía |
| E9 | Paneles escondidos (`Ctrl + \`) |
| S1 | Fundamentos · Color: variables y sueltos **(c/o)** |
| S2 | Fundamentos · Tipografía: familias, escala y textos con contorno |
| S3 | Fundamentos · Sombras, radios y movimiento |
| S4 | Salud del sistema |
| S5 | Íconos, con el fondo medio y con el oscuro |
| S6 | Textos: la tabla con un texto seleccionado |
| S7 | Pastilla de sincronización abierta con los cambios de una importación |
| R1 | Componentes de RC: hoja de variantes del botón con texto (variantes × estados) |
| R2 | Celular de RC: la página entera ("ver todo") |
| R3 | Celular de RC: el HUD nuevo seleccionado, con el inspector |
| R4 | PC de RC: la misma pantalla que R3 |
| R5 | Decorar (tienda y carrito) y el Barrio en Celular |
| D1 | Ventanita "Marco nuevo" con los prefijados |
| D2 | Un posteo propio con un texto en edición |
| D3 | Inspector con propiedades editables y el selector de color con tokens |
| D4 | Juego de variantes: una pieza en cuatro tamaños |
| D5 | Una pieza y sus instancias; cambio de la pieza reflejado (antes y después) |
| D6 | Código del marco en edición con un error de saneado mostrado |
| D7 | Comentario con su pin; tarjeta con la sección "Diseños" |
| D8 | "Proponer un cambio" desde un token importado: la tarjeta creada |
| M1 | La página armada por `prueba-mcp.mjs` |
| M2 | La campaña armada por un modelo real, y la tira de sus capturas de `ver_diseno` |
| P1 | Tabla de rendimiento (texto) y peso del trozo |

Además: una tira de 6 cuadros de miniatura → vivo, cambio de página, regla apareciendo y pin nuevo (las animaciones no se
ven en una captura); la lista de los **(verificar)** con lo que se encontró; y lo que no llegó a hacerse, con su prioridad.

---

## 13. El camino después

### 13.1 v2 — "Diseñar con la mano"

| Qué | Por qué después |
|---|---|
| Dibujar arrastrando (caja, texto, imagen, línea), arrastrar piezas desde el panel, imanes y guías, alinear y repartir, selección múltiple de capas | Es lo caro de una herramienta de diseño; la v1 ya permite ajustar todo lo que Claude arma. Se apoya en `CapaSeleccion` y en las operaciones que ya existen |
| Controles de disposición (flex y grilla: dirección, separación, relleno, alineación) y de sombras | En v1 se leen y se editan por código |
| Editor visual de piezas (propiedades, variantes, ranuras) y de modos de tokens | En v1 lo define Claude por MCP o se edita el código |
| Edición en lote de un juego de variantes (cambiar un texto en todos los tamaños) | Necesita relacionar capas entre marcos hermanos (`data-nombre`) |
| SVG de trazos editables y PDF | Convertir HTML a vectores de verdad es un proyecto en sí |
| Importar una web pública **desde Telar** (sin correr nada en una computadora), con el Chromium del servidor | Reusa el paso de páginas del importador; depende de que el render online ande bien |
| Adaptadores de tokens: Tailwind, Style Dictionary, formato DTCG | Se suman cuando haya un proyecto que los use (Yaguar, Brain OS): es un paso más del importador |
| Marco vivo embebido en el Lienzo; comparar dos importaciones lado a lado (antes y después) | — |
| Celular: Probar a tamaño real y comentar | Con la capa del celular asentada |
| Propuesta → rama: que la tarjeta lleve el cambio ya escrito (parche) | Cuando el flujo de propuestas tenga uso real |

### 13.2 v3 — "Estudio"

| Qué | Por qué |
|---|---|
| Prototipos: enlaces entre marcos, recorridos y transiciones | Probar flujos completos (del juego, de una web) |
| Generador de campañas: una tabla (texto × tamaño × foto) que produce todos los marcos de una campaña de una vez | Con plantillas y variantes maduras, es multiplicar |
| Animación y exportación a video o GIF | Piezas publicitarias en movimiento |
| Kit de marca compartido entre proyectos (Yaguar como origen de varias campañas) | Hoy cada proyecto tiene su sistema |
| Ida y vuelta con el código: un token cambiado en Telar abre un cambio en el repo; exportar un marco como componente | Necesita que los proyectos tengan una capa de tokens de verdad |
| Cursores y edición simultánea de varias personas | Hoy hay un dueño y la IA |
| Revisión automática: contraste, tamaños mínimos de toque, textos que no entran en otro idioma | Se apoya en los avisos del render |
| Puente con Figma (importar y exportar) | Solo si hace falta trabajar con alguien que lo use |

---

## 14. Riesgos

| Riesgo | Probabilidad | Cómo se cuida |
|---|---|---|
| El alcance es grande (herramienta de diseño + importador + MCP) | Alta | Prioridades y orden de corte de la sección 11; el modelo (HTML + CSS + capas con id) no cambia entre versiones, así que nada de la v1 se tira |
| Una instantánea no se ve igual que el juego (medidas calculadas por código, `canvas`, zonas seguras) | Media | El iframe mide exactamente lo mismo que la vista de captura; los `canvas` van como imagen; cada marco tiene su miniatura sacada en el momento: si el vivo y la miniatura difieren, es un error visible que se arregla en el importador |
| El arnés del juego no abre alguna pantalla (Decorar, Barrio) o necesita red | Media | Respaldo por pantalla: la maqueta aprobada (`juego3d/maquetas/`); el informe lista lo que no se pudo sacar |
| La regla del juego sobre navegadores y capturas | Segura | El paso de páginas es optativo y pide el sí del dueño; lo estático no abre nada |
| Chromium en Vercel no entra, tarda o cambia los límites | Media | Función aparte; plan B escrito (7.4); en local siempre anda |
| HTML o CSS malicioso o roto (también escrito por una IA) | Media | Tres barreras independientes: saneado en el servidor, iframe sin scripts, política de contenido. Pruebas de `sanear.ts` |
| Muchos iframes frenan el lienzo | Media | Miniaturas, tope de 12, pausa de animaciones; medido antes de cerrar |
| El modelo usa mal las herramientas | Media | Reglas de 7.3, errores con salida, prueba con modelo real y corrección de descripciones |
| `--telar-origen` en cada regla agranda las hojas (~12 %) | Baja | Va comprimido; y se puede sacar del CSS que se exporta |
| El peso en la base del juego | Baja | ~15 MB por RC; archivos por hash, sin duplicados; se informa el total después de importar |
| Diseño le quita foco a que el Kanban siga igual | Baja | Carpetas propias, CSS con prefijo, capturas del grupo A |
| Medidas de redes que cambian | Baja | Prefijados en un solo archivo, y siempre se puede "a medida" |
| Dos fuentes de verdad (juego y Telar) | Media | Regla única D3: lo importado no se edita; lo que cambia viaja por tarjeta |

---

## 15. Lo que queda afuera de la v1 (y por qué)

| Queda afuera | Por qué |
|---|---|
| Motor de dibujo propio (canvas, WebGL) | El contenido es HTML: el navegador ya lo dibuja. Con solo lo visible alcanza |
| Edición vectorial (pluma, booleanas) | Telar arma interfaces y piezas con código e imágenes; no ilustra |
| Correr JavaScript de los proyectos dentro de Telar | Seguridad: es la sesión del dueño. Los estados se muestran con clases y con Probar |
| Escribir en el repo del juego desde Telar | Decisión D3 |
| Sincronización automática al hacer `push` | Tocaría el repo del juego (GitHub Actions) y sus reglas; el pedido y el comando alcanzan |
| Prototipos, animación, video | v3 |
| Colaboración con cursores | v3 |
| Diseño completo en el celular | Sección 10 |
| Fuentes de Google u otras de afuera por URL | La política de contenido no deja pedir nada afuera (privacidad y capturas reproducibles): las fuentes se suben |
| Importar de Figma | v3; hoy los enlaces de Figma ya se embeben en el Lienzo |
| El mundo 3D del juego (muebles, personajes) | No es interfaz; `estilo/` y los modelos son otro tipo de material. Los activos de imagen sí pueden entrar sumando un patrón al perfil |

---

## 16. Qué se hizo para armar este plan y qué no

- Se leyó el código de Telar (`main`) y los dos planes de la v0.2; se corrió Telar local con datos propios y se sacaron
  capturas del Kanban y del Lienzo (el marco «Interfaz» y los demás).
- Se leyó el juego en la rama `ccr-ac61dbdf-s4s7ws` **sin correrlo ni abrirlo en un navegador**, y se midió su CSS, sus
  sprites y sus textos con un guion de lectura (los números de 2.2).
- Se probó en Chrome, con un documento neutro, todo lo que sostiene la decisión D2: iframe sin scripts, lectura del DOM
  y de los estilos, política de contenido, edición de texto en el lugar, `:hover` y unidades de contenedor; y el costo de
  40 iframes (0,7 s en total con hojas de 400 KB cada una).
- **No se probó:** la instantánea sobre el arnés del juego (regla del dueño: no abrir el juego sin pedido), Chromium en
  Vercel, ni los nombres exactos de los paquetes del SDK de MCP para el cliente de prueba. Están marcados **(verificar)**.
- Se investigó Figma con su documentación y sus artículos de ingeniería (fuentes en 1.4).
