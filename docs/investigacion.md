# Investigación de producto: lienzo infinito + kanban + lo útil de Jira

Fecha: 24/11/2026 · Para: `tablero/` (v1)

**Cómo se hizo.** Se priorizó la documentación oficial: centros de ayuda de Miro, Trello y Jira, guías de diseño de Atlassian, la especificación MCP, la documentación de Claude y de OpenAI, los repositorios de cada biblioteca y el registro de npm. Los foros se usan solo como apoyo y se aclara cuando algo sale de ahí. Lo que no quedó confirmado en una fuente oficial dice **(a verificar)**.

- `help.miro.com` bloquea la descarga automática (403). De esas páginas se usó el extracto del buscador. Las de `miro.com` y `developers.miro.com` se leyeron completas.
- Las versiones de las bibliotecas salen del registro de npm al 24/11/2026.

## Resumen

1. **Miro** se siente rápido por tres cosas:
   - se crea sin diálogos: una tecla por herramienta, y Alt+arrastrar duplica;
   - la navegación se adapta sola al mouse o al trackpad;
   - el dibujo corre en canvas, no en el DOM.

   El kanban de Miro es un objeto más del lienzo, con columnas y carriles. Sus tarjetas se pueden convertir en ítems de Jira.
2. **Trello** gana por la tarjeta: título, descripción en markdown, etiquetas, miembros, fechas con colores de urgencia, checklists con progreso, adjuntos y portada, comentarios, campos personalizados, espejo y plantillas. El arrastre usa Pragmatic drag and drop, y Trello es la excepción que inclina la tarjeta 4°.
3. **Jira** suma lo que a Trello le falta para software:
   - la jerarquía épica → historia/tarea/error → subtarea;
   - prioridades, estimación y sprints;
   - estados agrupados en 3 categorías;
   - vínculos con dirección (bloquea / está bloqueado por);
   - el enlace a GitHub por clave (`ABC-123`) en ramas, commits y PR.
4. **Bibliotecas:**
   - React Flow (MIT, v13 de nov-2026) es la base más directa para un lienzo de tarjetas HTML.
   - tldraw exige una clave de licencia en producción. Es gratis solo para uso no comercial aprobado y con marca de agua; el uso comercial se paga.
   - dnd-kit (MIT) da un arrastre animado y estilable.
   - Motion (MIT) resuelve las animaciones de layout.
5. **MCP:**
   - La especificación vigente es la 2026-07-28: sin estado y sin sesiones.
   - El SDK de TypeScript v2 atiende a la vez a los clientes nuevos y a los de 2025. Hace falta: Claude documenta las versiones de 2025 y ChatGPT todavía acepta SSE.
   - La autorización es OAuth 2.1, con metadatos de recurso protegido, PKCE y CIMD o DCR.

---

## 1. Miro

### 1.1 Objetos del lienzo

| Objeto | Qué hace y detalles útiles | Fuente |
|---|---|---|
| Nota adhesiva | Color, tamaño y etiquetas (tags), que se cambian en lote seleccionando varias. Texto con tamaño, alineación, negrita, cursiva y subrayado, nada más. Con "dimensiones" todas miden igual. "Cluster" las agrupa solas por etiqueta, color, autor, palabra clave o sentimiento. | [Sticky notes](https://help.miro.com/hc/articles/360017572054), [miro.com/online-sticky-notes](https://miro.com/online-sticky-notes/) |
| Formas | Más de 2.500 formas de diagramación, con capas, paquetes de formas propios y un "modo foco" que oculta la interfaz. Los paquetes especializados (BPMN, AWS) son solo de planes pagos. Se puede insertar un paso en medio de un conector existente. Una nota se convierte en forma (o al revés) sin perder contenido ni conexiones. | [How we built Diagramming](https://miro.com/blog/how-we-built-diagramming/), ayuda de Miro ([1](https://help.miro.com/hc/articles/4403634496402), [2](https://help.miro.com/hc/articles/25275263961874)) |
| Texto | Campo de texto enriquecido. | [Board items](https://developers.miro.com/docs/board-items) |
| Marco (frame) | Contenedor que agrupa contenido. Sirve para exportar a PDF, para indexar y para ordenar la presentación. El panel de marcos se ve en miniaturas o en lista, permite ocultar marcos y se reordena arrastrando (el botón "Re-organize Frames" se quitó en nov-2025). | [Board items](https://developers.miro.com/docs/board-items), [Frames](https://help.miro.com/hc/articles/360018261813), [foro](https://community.miro.com/ask-the-community-45/organize-frames-action-missing-from-frames-list-panel-26866) |
| Conector / flecha | Recto, ortogonal o curvo. Puntas, grosor y color desde el menú contextual; la punta crece con el grosor. Shift deja la línea horizontal, vertical o diagonal. Ctrl/Cmd mientras se mueve desactiva el enganche a objetos. Dibuja "saltos" donde dos líneas se cruzan (solo en rectas y ortogonales). Lleva etiqueta de texto, pero sin cambiar fuente. La queja más común es que se enganchan de más. | [Connection lines](https://help.miro.com/hc/articles/360017730733), [foro](https://community.miro.com/ask-the-community-45/arrows-getting-attached-to-object-by-default-5184) |
| Tarjeta (card) | Tarea asignable a una persona (se crea con la tecla D). Al convertirla en ítem de Jira se pierden las etiquetas y la fecha de inicio, y hay que volver a cargar el asignado. | [Board items](https://developers.miro.com/docs/board-items), [Jira cards FAQ](https://help.miro.com/hc/en-us/articles/33772179950482-Jira-cards-in-Tables-and-Timelines-FAQ), [Jira Cards](https://miro.com/marketplace/jira/) |
| App card | Tarjeta estructurada que se sincroniza con otra herramienta (Trello, Monday, Asana, Jira). | [Board items](https://developers.miro.com/docs/board-items) |
| Tabla (Miro Tables) | Campos personalizados; registros que se crean arrastrando tarjetas; un campo "últimas novedades" que guarda autor y fecha solos; campos Persona/Asignado y Estimación/Número; vista de línea de tiempo. Se sincroniza con Jira en título, descripción, fecha de fin, asignado y estado (los dos últimos en beta). | [Tables](https://help.miro.com/hc/articles/22760922335506), [Jira en Tables](https://help.miro.com/hc/en-us/articles/33772179950482-Jira-cards-in-Tables-and-Timelines-FAQ) |
| Mapa mental | El auto-layout viene prendido y se apaga desde el nodo padre ("Layout nodes" ordena a mano). Una rama colapsada con "−" muestra cuántos nodos esconde. Enter crea un nodo a la derecha y Tab uno abajo **(a verificar: es un reporte del foro)**. | [Mind map](https://help.miro.com/hc/articles/360017730753), [foro](https://community.miro.com/ask-the-community-45/mindmap-keyboard-navigation-8610) |
| Kanban (widget) | Tablero dentro del lienzo: tarjetas; columnas que se crean, editan, borran y ocultan; carriles (swimlanes) agrupados por un campo; agrupar, ordenar y filtrar. Personas y puntos se asignan arrastrando avatares o fichas a la columna. Hay además un widget "Columns" más simple, cuyas tarjetas no se pueden bloquear ni agrupar. | [Kanban](https://help.miro.com/hc/articles/29188841316114), [Columns](https://help.miro.com/hc/articles/360022846473) |
| Imagen, vista previa, embebido y otros | Imagen por arrastre o por URL. Vista previa de enlaces con datos Open Graph. Embebidos vía Embedly. También hay bloque de código, documento, emoji, mockup, trazo de lápiz y mapa de historias de usuario (USM). | [Board items](https://developers.miro.com/docs/board-items) |
| Figma | Un archivo, frame o sección se muestra como iframe en vivo o como marcador, con OAuth contra Figma. Quien mira tiene que iniciar sesión en el iframe, y el embebido no se edita. La alternativa es una imagen estática que ve todo el tablero. | [Figma en Miro](https://help.miro.com/hc/articles/38052540876178) |

### 1.2 Navegación

- **Mover el lienzo:** Espacio+arrastrar, la mano (H) o las flechas. Las flechas mueven los objetos si hay algo seleccionado. ([atajos oficiales](https://miro.com/shortcuts/))
- **Zoom:**
  - Cmd/Ctrl + "+" y "−".
  - Cmd/Ctrl+0 vuelve al 100 %.
  - Alt/Opt+1 ajusta todo a la pantalla.
  - Alt/Opt+2 hace zoom a la selección. ([atajos oficiales](https://miro.com/shortcuts/))
- **Modos de entrada:**
  - Auto (el de fábrica), Mouse (la rueda hace zoom) o Trackpad (la rueda desplaza, Shift+rueda va de costado y Ctrl+rueda hace zoom).
  - Se guarda por usuario y por navegador, y se cambia con clic derecho → "Mouse o trackpad".
  - En pantalla táctil funciona siempre igual.
  - Queja del foro: en laptops táctiles el modo Auto cambia solo. ([Navegación](https://help.miro.com/hc/articles/360017731053), [foro](https://community.miro.com/ask-the-community-45/i-m-randomly-going-from-zooming-to-scrolling-with-my-mouse-wheel-what-s-going-on-19067))
- **Minimapa y grilla:** M muestra el minimapa y G la grilla. ([atajos oficiales](https://miro.com/shortcuts/))
- **Ir a un marco:** desde el panel de marcos. Antes, el doble clic centraba el marco y lo ajustaba a la pantalla; un reporte del foro de feb-2026 dice que ya no lo ajusta. ([Frames](https://help.miro.com/hc/articles/360018261813))
- **Teclado:**
  - Tab y Shift+Tab recorren los objetos de arriba-izquierda a abajo-derecha.
  - Cmd/Ctrl+flechas pasan al objeto vecino.
  - Cmd/Ctrl+Shift+↑/↓ entran y salen de un contenedor, como un marco.
  - Enter edita y Esc sale.
  - Los atajos de una sola tecla se pueden apagar por accesibilidad. ([atajos oficiales](https://miro.com/shortcuts/), [Navegación por teclado](https://help.miro.com/hc/articles/11997028019858-Keyboard-navigation-while-working-on-boards))

### 1.3 Selección, orden y alineación

- **Selección múltiple:** Cmd/Ctrl+clic, recuadro arrastrando sobre el vacío, o Cmd/Ctrl+A. No se encontró documentación oficial de un lazo en Miro **(a verificar)**.
- **Agrupar y bloquear:**
  - Cmd/Ctrl+G agrupa y Cmd/Ctrl+Shift+G desagrupa.
  - Cmd/Ctrl+Shift+L bloquea y desbloquea.
  - Cmd/Ctrl+Shift+P pone un "bloqueo protegido", más estricto.
- **Orden de apilado:** PgUp manda al frente y PgDn al fondo. ([atajos oficiales](https://miro.com/shortcuts/))
- **Alinear y distribuir:**
  - Izquierda, derecha, arriba, abajo y los dos centros.
  - Por defecto se alinea respecto de la selección. Para alinear contra un marco, se selecciona primero el marco.
  - "Distribuir" deja el espaciado parejo. ([guía de terceros](https://supademo.com/blog/guides/how-to-align-objects-in-miro))
- **Enganche ("snapping"):** engancha a otros objetos. Según el foro, no engancha a la grilla salvo con la grilla de puntos **(a verificar)**. ([foro](https://community.miro.com/wish-list-32/snap-to-grid-205?postid=935))

### 1.4 Edición rápida: atajos oficiales

| Acción | Mac | Windows |
|---|---|---|
| Seleccionar / mano | V / H | V / H |
| Texto, nota, forma, rectángulo, óvalo | T, N, S, R, O | T, N, S, R, O |
| Conector, tarjeta, lápiz, goma | L, D, P, E | L, D, P, E |
| Comentario, marco, minimapa | C, F, M | C, F, M |
| Paleta de comandos | Cmd+K | Ctrl+K |
| Duplicar | Cmd+D · Opt+arrastrar · Opt+flechas (en esa dirección) | Ctrl+D · Alt+arrastrar · Alt+flechas |
| Editar / salir | Return / Esc | Enter / Esc |
| Deshacer / rehacer | Cmd+Z / Cmd+Shift+Z | Ctrl+Z / Ctrl+Shift+Z |
| Buscar | Cmd+F | Ctrl+F |
| Ver todos los atajos | F1 o "?" → Keyboard shortcuts | ídem |

Fuente: [miro.com/shortcuts](https://miro.com/shortcuts/) y [Shortcuts and hotkeys](https://help.miro.com/hc/articles/360017731033).

### 1.5 Plantillas

Miro tiene una galería de plantillas: oficiales y de la comunidad (Miroverse). Hay kanban, marco Kanban, retros, mapas de usuario, etc., y se insertan como grupos de objetos editables. La plantilla de Kanban arma columnas con tarjetas. ([Kanban template](https://miro.com/templates/kanban/), [Kanban framework](https://miro.com/templates/kanban-framework/))

### 1.6 Comentarios y menciones

- **Mencionar:**
  - `@persona` o `@grupo` en un comentario.
  - `@Space` o `@team` avisa a todo un espacio o equipo.
- **Seguir un hilo:** con la campana del hilo.
- **Resolver:** un interruptor oculta el hilo del tablero. Los resueltos vuelven a verse con "Show resolved comments" o desde el panel de comentarios.
- **Panel de comentarios:** junta comentarios y menciones; se abre desde el ícono de Actividad.

Fuente: [Comments](https://help.miro.com/hc/articles/360017730873).

### 1.7 Presentación por marcos

- Se arranca con **Present**, arriba a la derecha.
- El orden de la presentación (y del PDF exportado) es el del panel de marcos.
- Sin salir de la presentación, "Go to canvas" muestra el lienzo y "Go to slide" vuelve a las diapositivas.
- Miro anunció mejoras para marzo-abril de 2026.
- En el foro piden saltar a un marco solo con el teclado.

Fuentes: [Presentation mode](https://help.miro.com/hc/articles/34307373858450-Presentation-mode), [foro](https://community.miro.com/ask-the-community-45/jumping-to-specific-frame-in-presentation-mode-with-keyboard-input-only-10828).

### 1.8 Colaboración en vivo

- **Cursores con nombre** de cada participante. En el foro piden ver solo el del presentador y tener un puntero láser. ([foro](https://community.miro.com/ideas/only-view-cursor-of-person-i-am-following-1377))
- **Seguir a alguien, "Bring to me" y "Bring everyone to me":**
  - Los participantes siguen tu vista hasta que mueven el cursor, hacen zoom o hacen clic.
  - Los invitados como editores pueden usarlo; visitantes, comentaristas y lectores solo pueden seguir.
  - Existe "Stop following", según un aviso de 2023. ([Attention management](https://help.miro.com/hc/articles/360013358479), [foro](https://community.miro.com/ideas/stop-people-from-following-you-after-you-brought-them-to-you-3801))
- **Herramientas de facilitación:**
  - Modo privado: las notas creadas mientras dura quedan ocultas hasta que se revelan, y cada uno puede revelar las suyas.
  - Votación: Miro anunció sesiones de hasta 9 días **(a verificar)**.
  - Temporizador visible para todos, en la barra de colaboración. ([Timer](https://help.miro.com/hc/articles/360017730933), [foro modo privado](https://community.miro.com/ideas/private-mode-for-contributors-2716/index2.html), [votación](https://community.miro.com/product-news-31/easily-involve-teams-in-decision-making-with-our-improved-voting-6161))

### 1.9 Historial

- Las versiones del tablero se guardan solas.
- Se recuperan en Board → History → Versions, y la versión se restaura como un tablero aparte.
- Según el foro, se guardan hasta 90 días.
- Los objetos borrados hace poco se recuperan desde Actividad → Restore.

Fuentes: [anuncio](https://community.miro.com/product-news-31/board-history-now-available-on-team-business-consultant-enterprise-and-education-plans-5294), [foro 90 días](https://community.miro.com/ask-the-community-45/restoration-of-miro-version-older-than-90-days-26121).

### 1.10 Búsqueda

- Cmd/Ctrl+F abre "Find" dentro del tablero, con filtro por tipo de objeto.
- No reemplaza texto.
- Según el foro, sin filtro a veces no muestra la lista de resultados.
- La búsqueda del inicio, entre tableros, es otra: filtra por dueño y espacio.

Fuentes: [Find](https://help.miro.com/hc/articles/360018109534), [Search in Miro](https://help.miro.com/hc/en-us/articles/360012140959-Search-in-Miro).

### 1.11 Qué hace que se sienta fluido (Miro y pizarras parecidas)

1. **Crear sin fricción.**
   - Una tecla por herramienta, sin diálogos.
   - Alt+arrastrar duplica.
   - Enter edita y Esc sale.
   - Cmd+K abre la paleta de comandos. ([atajos oficiales](https://miro.com/shortcuts/))
2. **Dibujar fuera del DOM.**
   - Miro dibuja en canvas e hizo su propio texto sobre canvas porque las soluciones existentes eran lentas. ([Miro Engineering](https://medium.com/miro-engineering/how-we-learned-to-draw-text-on-html5-canvas-9f5613e64f5))
   - MURAL pasó del DOM a un motor de canvas propio y mejoró un 80 % los cuadros por encima de 30 fps. ([MURAL](https://dev.to/mural/performant-paintings-building-a-canvas-render-engine-4506))
3. **Presupuesto por cuadro (las pizarras de Confluence, de Atlassian).**
   - Ciclo `requestAnimationFrame` en tres fases (captura, actualización, dibujo) a 60 o 120 fps.
   - WebGL2 con instancing: 1.000 rectángulos en 1 sola llamada de dibujo.
   - Se redibuja solo lo que cambió y se evita generar basura en cada cuadro.
   - Solo se procesa lo visible: el lienzo se divide en un mapa disperso de mosaicos de 2048×2048.
   - Una máquina de estados distingue clic de arrastre con un umbral de unos 5 px.
   - Los shaders se compilan recién cuando hacen falta: el arranque bajó de ~3 s a ≤0,5 s.
   - Meta: ≥60 fps con 5.000 elementos y 50 colaboradores. Arrastrar cuesta ~2,5 ms por cuadro y hacer zoom ~2 ms.
   - Con 50.000 elementos, el zoom y el paneo tomaron 9,5 ms por cuadro con DOM+React contra 2,9 ms con WebGL puro (mediana).

   Fuente: [Rendering like butter](https://www.atlassian.com/blog/atlassian-engineering/rendering-like-butter-a-confluence-whiteboards-story).
4. **Navegar como espera el dispositivo:** el modo automático detecta mouse o trackpad (ver 1.2).

---

## 2. Trello

### 2.1 Estructura y novedades

- **Jerarquía:** espacio de trabajo → tableros → listas → tarjetas.
- **"Nuevo Trello" (2025):**
  - **Inbox**, para capturar tareas desde Slack, Teams o un correo a `inbox@app.trello.com`. La IA extrae fechas y prioridades. Está en todos los planes.
  - **Planner**, que se conecta con Google Calendar (Outlook después). Las tarjetas se arrastran desde el Inbox o desde los tableros al calendario. Es de Standard para arriba. ([New Trello](https://www.atlassian.com/blog/announcements/new-trello-is-here))
- **Nuevo dorso de tarjeta (2025):**
  - Un menú "Agregar" debajo del título, con accesos rápidos a etiquetas, fechas, checklist y miembros.
  - Un menú de Acciones arriba a la derecha: copiar, mover, espejar…
  - Una barra inferior con Power-Ups, botones de automatización y el panel de comentarios y actividad.
  - En el foro se quejan de que ahora hacen falta más clics. ([New card back](https://support.atlassian.com/trello/docs/new-card-back/), [foro](https://community.atlassian.com/forums/Trello-questions/Feedback-on-Card-Back-Redesign-Loss-of-efficiency-and/qaq-p/3262304))

### 2.2 Anatomía completa de una tarjeta

| Elemento | Detalle | Plan | Fuente |
|---|---|---|---|
| Título | Se edita con `t` sobre la tarjeta. | Todos | [Atajos](https://support.atlassian.com/trello/docs/keyboard-shortcuts-in-trello/) |
| Descripción | Barra de herramientas, atajos y casi todo markdown: negrita `**`, cursiva, tachado, links, títulos H1 a H6 y bloques de código con tres comillas invertidas. En los comentarios no hay títulos. En los ítems de checklist hay negrita, cursiva, tachado, código y links. | Todos | [Formato de texto](https://support.atlassian.com/trello/docs/how-to-format-your-text-in-trello/) |
| Etiquetas | De color, con nombre opcional. `l` abre el menú; en modo etiquetas, `1`…`0` ponen verde, amarillo, naranja, rojo, violeta, azul, celeste, lima, rosa y negro. `;` muestra u oculta los nombres. | Todos | [Cheatsheet](https://maketecheasier.com/cheatsheet/trello-keyboard-shortcuts-cheatsheet/) |
| Miembros | `m` agrega o quita miembros y `Espacio` te asigna o desasigna. | Todos | ídem |
| Fechas | Inicio, vencimiento con hora, recordatorio y recurrencia. Hace falta un recordatorio para recibir el aviso; las tarjetas archivadas no avisan. Al completar una recurrente, salta a la próxima fecha y vuelve a "sin hacer". **Colores del badge:** gris (falta más de 24 h), amarillo (menos de 24 h), rojo (recién vencida, durante 24 h), rosa claro (vencida hace más de 24 h) y verde (completada). Se completa con el círculo de la izquierda; `d` abre el selector. | Todos | [Fechas](https://support.atlassian.com/trello/docs/adding-dates-to-cards/) |
| Checklists | Varias por tarjeta, y se pueden copiar de otra. Pegar varias líneas crea varios ítems, y la IA puede generarlos. Tienen barra de progreso (verde al 100 %) y se pueden ocultar los marcados. Los ítems se arrastran a otra checklist de la misma tarjeta. Un ítem se convierte en tarjeta y conserva su fecha y su asignado. **Ítems con persona y fecha:** solo con checklists avanzadas (Premium). Borrar no se puede deshacer. | Básico: todos | [Checklists](https://support.atlassian.com/trello/docs/adding-checklists-to-cards/) |
| Adjuntos y portada | Archivos y links. Portada con imagen o con uno de 10 colores, arriba del título o cubriendo toda la tarjeta. Hay portadas generadas con IA en Standard y Premium. | Todos | [Portada](https://support.atlassian.com/trello/docs/what-is-a-card-cover), [blog](https://www.atlassian.com/blog/trello/card-covers-and-colors) |
| Comentarios y actividad | Panel aparte en el dorso nuevo. `@` menciona y `#` autocompleta etiquetas. | Todos | [Nuevo dorso](https://support.atlassian.com/trello/docs/new-card-back/) |
| Campos personalizados | Casilla, fecha, lista desplegable, número y texto. El tipo no se cambia después de creado. Hasta 50 por tablero, 50 opciones por lista y títulos de 25 caracteres. Se pueden mostrar en el frente, se filtran por valor y se exportan en JSON/CSV. | Standard o superior | [Custom Fields](https://support.atlassian.com/trello/docs/using-custom-fields/) |
| Ubicación | Dirección de la tarjeta, que se ve en la vista Mapa (Google Maps). | Premium | [Map view](https://support.atlassian.com/trello/docs/map-view) |
| Tarjeta espejo / tarjeta enlace | Ver la tabla de abajo. | Espejo: pago | [Mirror](https://support.atlassian.com/trello/docs/mirroring-cards/) |
| Plantilla de tarjeta | "Make template". El título, la descripción y los campos personalizados pasan siempre; checklists, miembros, adjuntos, etiquetas y stickers se eligen al crear. | Todos | [blog](https://www.atlassian.com/blog/trello/trello-card-templates) |
| Votos | Power-Up Voting (`v` vota); la versión avanzada permite votar opciones. | Todos | [Voting](https://support.atlassian.com/trello/docs/using-the-voting-power-up/) |
| Archivar | `c` sobre la tarjeta. Archivar no es borrar, y el deshacer (`z`) no recupera borrados. | Todos | [Atajos](https://support.atlassian.com/trello/docs/keyboard-shortcuts-in-trello/) |
| Mover, copiar, espejar | Desde el menú de Acciones. | Todos | [Nuevo dorso](https://support.atlassian.com/trello/docs/new-card-back/) |
| Seguir (watch) | `s`. Avisa de comentarios, cambios de fecha, vencimientos cercanos, movimientos y archivado. También se puede seguir una lista o un tablero entero. | Todos | [Watch](https://support.atlassian.com/trello/docs/watching-cards-lists-and-boards/) |

**Espejo y enlace** ([Mirror cards](https://support.atlassian.com/trello/docs/mirroring-cards/)):

| | Tarjeta enlace | Tarjeta espejo |
|---|---|---|
| Plan | Gratis | Solo espacios de trabajo pagos |
| Qué muestra | Un resumen con el link | La tarjeta original completa, editable desde ahí |
| Al abrirla | Te lleva al tablero original | Se abre sin salir del tablero actual |
| Cómo se crea | Pegando la URL de la tarjeta como título | Acción "Mirror", pegando la URL o con una automatización |
| Límites | — | Power-Ups, botones de tarjeta y borrar solo desde el original. Archivar el original no archiva los espejos: muestran un aviso. Hace falta acceso al tablero original. |

### 2.3 Vistas

- **Tablero:** gratis.
- **Las demás** (Premium o Enterprise):
  - **Tabla:** tipo planilla, se ordena y se filtra.
  - **Calendario:** arrastrar una tarjeta cambia su fecha.
  - **Línea de tiempo:** ordena por inicio y vencimiento.
  - **Panel (dashboard):** gráficos por fechas, asignados y tarjetas por lista.
  - **Mapa.**
- Tabla y calendario existen también a nivel de espacio de trabajo, cruzando tableros.

Fuentes: [Views](https://trello.com/views), [tabla y selector](https://www.atlassian.com/blog/trello/new-views-switcher-and-table-view), [vistas de espacio](https://www.atlassian.com/blog/trello/trello-workspace-views-dashcards).

### 2.4 Filtros y búsqueda

- **En el tablero:** `f` filtra, `q` muestra tus tarjetas y `x` limpia los filtros.
- **Búsqueda global**, con operadores ([Search](https://support.atlassian.com/trello/docs/searching-for-cards-all-boards/)):

| Operador | Busca |
|---|---|
| `@nombre`, `member:`, `@me` | Tarjetas de un miembro o tuyas |
| `#etiqueta`, `label:"FIX IT"` | Por etiqueta (nombre o color) |
| `board:`, `list:` | Por tablero o lista |
| `has:attachments`, `has:description`, `has:cover`, `has:members` | Tarjetas que tienen ese dato |
| `due:day/week/month/overdue/N`, `due:complete`, `due:incomplete` | Por vencimiento |
| `created:N`, `edited:N` | Creadas o editadas en los últimos N días |
| `name:`, `description:`, `checklist:`, `comment:` | Texto en esa parte de la tarjeta |
| `is:open`, `is:starred`, `sort:created/due/edited` | Estado y orden |
| `-operador` | Niega cualquier operador (`-has:members`) |

### 2.5 Automatización (ex Butler)

- **Tipos:**
  - **Reglas:** reaccionan a cambios, como "si una tarjeta entra en Hecho, marcar la fecha como completa".
  - **Botones de tarjeta**, en el dorso.
  - **Botones de tablero**, que actúan sobre muchas tarjetas.
  - **Comandos de calendario**, cada día o cada semana.
  - **Comandos por fecha de vencimiento**, como "7 días antes, poner una etiqueta". Corren a medianoche si no se fija una hora. ([Automation overview](https://support.atlassian.com/trello/docs/automation-overview/))
- **Cuotas:** cada disparo consume una ejecución más las operaciones de sus acciones, de una cuota mensual del espacio de trabajo. Una página vieja hablaba de 20 operaciones por ejecución y 20+20 botones **(a verificar)**. ([Cuotas](https://support.atlassian.com/trello/docs/butler-quotas-and-limits/))
- **Una automatización puede crear tarjetas espejo.** ([Mirror](https://support.atlassian.com/trello/docs/mirroring-cards/))

### 2.6 Power-Up de GitHub

- Se le asocian uno o varios repositorios al tablero.
- Desde la tarjeta se adjunta una rama, un commit, un issue o un PR.
- El PR muestra en el frente si pasó los checks, sus etiquetas, el autor, si se mergeó, el asignado y la cantidad de comentarios.
- Hay un error abierto en el que el botón de adjuntar no responde ([TRELLO-1224](https://jira.atlassian.com/browse/TRELLO-1224)).

Fuentes: [GitHub Power-Up](https://support.atlassian.com/trello/docs/using-the-github-power-up), [blog](https://www.atlassian.com/blog/trello/github-and-trello-integrate-your-commits).

### 2.7 Atajos de teclado

| Tecla | Acción | Fuente |
|---|---|---|
| `b` · `/` | Cambiar de tablero · buscar | oficial · cheatsheet |
| `j`/`↓` · `k`/`↑` · `←` `→` | Tarjeta de abajo / de arriba / de al lado | oficial |
| `Enter` · `e` · `t` | Abrir la tarjeta · edición rápida · editar el título | cheatsheet · oficial |
| `n` | Nueva tarjeta debajo de la que está bajo el cursor | oficial |
| `c` | Archivar | oficial |
| `d` · `l` · `m` · `-` | Fechas · etiquetas · miembros · checklist | cheatsheet |
| `Espacio` · `s` · `v` | Asignarme · seguir · votar | cheatsheet |
| `,` · `.` · `<` · `>` | Mover al fondo de la lista izquierda o derecha · al principio de la lista izquierda o derecha **(a verificar)** | cheatsheet |
| `f` · `q` · `x` | Filtro · mis tarjetas · limpiar filtros | oficial · cheatsheet |
| `w` · `;` | Menú del tablero · nombres de etiquetas | cheatsheet |
| `@` · `#` · `^` | Mencionar · etiqueta · posición (autocompletan) | cheatsheet |
| Cmd/Ctrl+C/X/V | Copiar, cortar o pegar una tarjeta | cheatsheet |
| Cmd/Ctrl+Enter · Esc | Guardar texto · cancelar | cheatsheet |
| `z` · Shift+`z` · `r` | Deshacer · rehacer · repetir la última acción | oficial |
| Shift+rueda | Desplazar el tablero de costado | oficial |
| Shift+`?` | Ver todos los atajos | oficial |

Fuentes: oficial = [Keyboard shortcuts in Trello](https://support.atlassian.com/trello/docs/keyboard-shortcuts-in-trello/); cheatsheet = [Make Tech Easier](https://maketecheasier.com/cheatsheet/trello-keyboard-shortcuts-cheatsheet/).

### 2.8 Cómo se comporta el arrastre

Trello, Jira y Confluence usan **Pragmatic drag and drop**. La guía de diseño de Atlassian fija estos valores ([Design guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines)):

- **Antes de arrastrar:**
  - Cursor `grab` y cambio de fondo al pasar por encima.
  - Las tarjetas y las columnas se arrastran desde cualquier punto, sin asa obligatoria.
  - Si el elemento tiene partes interactivas, se arrastra solo desde el asa, con un área táctil de 24×24 px.
- **Vista previa:**
  - En las tarjetas arranca desde el punto de agarre, sin desplazamiento.
  - **No se rota, salvo en Trello, que inclina 4°.**
  - Mide como máximo 280×280 px y muestra hasta 3 datos.
  - Con varias tarjetas, se apilan con un contador.
- **Original:** queda en su lugar con opacidad 0,4.
- **Indicador de destino al reordenar:**
  - Línea de 2 px con un círculo de 8 px en la punta, centrada en el hueco entre tarjetas.
  - En una lista vacía no hay línea.
- **Pasar a otra lista:** se resalta el fondo de la lista de destino en 350 ms con `cubic-bezier(0.15, 1, 0.3, 1)`, solo si se puede soltar ahí.
- **Al soltar:**
  - La pantalla se actualiza enseguida y se guarda en segundo plano (actualización optimista).
  - La tarjeta movida destella durante 700 ms.
- **Desplazamiento automático** ([auto-scroll](https://atlassian.design/components/pragmatic-drag-and-drop/optional-packages/auto-scroll/about)):
  - Acelera cuanto más tiempo pasás sobre el borde y cuanto más cerca del borde estás.
  - Llega a la velocidad máxima antes de tocar el borde.
  - Se normaliza a 60 fps.
  - Primero desplaza el contenedor de adentro y después los de afuera (una sola área por eje y por cuadro).
- **Accesibilidad:** todo lo que se hace arrastrando también se puede hacer desde el menú "…" o el asa: mover arriba, abajo o a otra lista.
- **Filosofía:** Atlassian dejó react-beautiful-dnd porque comunicaba el lugar con movimiento y obligaba a esperar a que terminaran las animaciones. Pragmatic usa líneas y colores **sin animaciones** para sentirse más rápido. La vista previa nativa no deja controlar la opacidad (~0,95) ni la sombra. ([The journey of Pragmatic drag and drop](https://www.atlassian.com/blog/design/designed-for-delight-built-for-performance))
- **Entre tableros:** una tarjeta pasa a otro tablero con "Mover". En el Trello nuevo también se arrastra entre el Inbox, los tableros y el Planner. ([New Trello](https://www.atlassian.com/blog/announcements/new-trello-is-here))

---

## 3. Jira: lo útil para desarrollo

Jira Cloud cambió los nombres: hoy dice "work items", "work types" y "spaces" donde antes decía issues, issue types y projects.

### 3.1 Tipos de ítem y jerarquía

| Tipo | Nivel | Para qué | Fuente |
|---|---|---|---|
| Épica | Superior | Agrupa historias, tareas y errores de una iniciativa grande | [Work types](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/) |
| Historia | Estándar | La unidad más chica de trabajo con valor | ídem |
| Tarea | Estándar | Trabajo que hay que hacer | ídem |
| Error (bug) | Estándar | Algo que impide o rompe una función | ídem |
| Subtarea | Hija | Lo necesario para completar un ítem estándar | ídem |

### 3.2 Prioridad, estados y resoluciones

- **Prioridades de fábrica:** Highest, High, Medium, Low, Lowest.
- **Resoluciones:**
  - Done (hecho).
  - Won't do (no se hará).
  - Duplicate (duplicado).
  - Cannot reproduce (no se pudo reproducir).
- **Categorías de estado:** cada estado, aunque sea propio, cae en una de tres: **Por hacer (gris)**, **En curso (azul)** o **Hecho (verde)**. Esos colores no se cambian. JQL filtra por `statusCategory`.

Fuentes: [Statuses, priorities and resolutions](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-statuses-priorities-and-resolutions/), [Workflow status](https://support.atlassian.com/jira-cloud-administration/docs/what-is-a-workflow-status/).

### 3.3 Estimación

- **Puntos de historia**, con escala de Fibonacci y estimación "a ciegas" (planning poker): un 5 es más o menos el doble de complejo que un 3. Atlassian los prefiere a las horas porque buscan una velocidad confiable, no precisión. ([Fibonacci story points](https://www.atlassian.com/agile/project-management/fibonacci-story-points))
- **Estimación original** en horas o días. Jira cuenta 8 h por día: 3d 4h son 28 h. ([Estimating](https://confluence.atlassian.com/jirasoftware/estimating-an-issue-1688898714.html), [KB](https://confluence.atlassian.com/jirakb/understand-how-the-original-estimate-field-value-is-calculated-when-viewing-the-data-export-in-jira-cloud-1384449760.html))
- Cada tablero elige su métrica de estimación: puntos u horas. En los espacios gestionados por el equipo también se puede no estimar y contar ítems.

### 3.4 Sprints

- **Duración:** un mes o menos. El objetivo del sprint es "el único objetivo" de ese sprint. ([Scrum Guide](https://scrumguides.org/scrum-guide.html))
- **Al completar un sprint en Jira:**
  - Lo que quedó abierto va al backlog, a un sprint futuro o a uno nuevo.
  - Solo cuenta como hecho lo que está en la columna de más a la derecha.
  - Las subtareas tienen que estar hechas. ([Complete a sprint](https://support.atlassian.com/jira-software-cloud/docs/complete-a-sprint/))

### 3.5 Vínculos entre ítems

- **Los cuatro de fábrica**, cada uno con texto de ida y de vuelta:

| Vínculo (ida) | Vuelta | Uso |
|---|---|---|
| bloquea | está bloqueado por | Dependencia con orden. Es el único que, según el foro, tiene efecto práctico. |
| clona | es clonado por | Copia que se trabaja aparte |
| duplica | es duplicado por | Se consolida en el original |
| se relaciona con | se relaciona con | Relación general, sin efecto |

- **En Cloud hay más**, como "causa / es causado por". Los administradores los crean, renombran o borran.
- "Depende de" es la vuelta de "bloquea": no hace falta un tipo aparte.

Fuentes: [Link work items](https://support.atlassian.com/jira-software-cloud/docs/link-issues), [Configuring issue linking](https://confluence.atlassian.com/adminjiraserver0817/configuring-issue-linking-1071816835.html), [foro](https://community.atlassian.com/t5/Jira-questions/Need-definition-for-Link-Issue-types/qaq-p/1738147).

### 3.6 Integración con GitHub

- **Por clave, en mayúsculas** (`JRA-123`; en minúscula puede no enlazar). ([Reference work items](https://support.atlassian.com/jira-software-cloud/docs/reference-issues-in-your-development-work/))
  - **Rama:** `git checkout -b JRA-123-<nombre>`. También se crea desde el ítem con "Create branch", que pone la clave sola.
  - **Commit:** la clave al principio del mensaje, `"JRA-123 <mensaje>"`.
  - **PR:** la clave en el título o en la rama de origen.
  - **Panel "Development" del ítem:** cuenta PR, ramas y commits. Los builds y despliegues se enlazan si vienen de una herramienta de CI conectada.
  - **Tablero:** las tarjetas muestran íconos de desarrollo, solo si el tablero tiene menos de 100 ítems.
- **Smart commits** ([Smart Commits](https://support.atlassian.com/jira-software-cloud/docs/process-issues-with-smart-commits/)):
  - `JRA-34 #comment texto`.
  - `JRA-34 #time 1w 2d 4h 30m`.
  - Transición por la primera palabra del nombre: `#close`, `#start-review`.
  - Varios comandos y varias claves por línea.
  - El email del commit tiene que coincidir con un solo usuario de Jira.
  - Reescribir el historial puede repetir los comandos.
- **Automatización por eventos de Git:** rama creada, commit, PR creado, mergeado o rechazado, builds y despliegues. Sirve, por ejemplo, para pasar a "En curso" al crear la rama. ([Automation with GitHub](https://confluence.atlassian.com/automation112/use-automation-with-github-1688902111.html))

### 3.7 Referencia extra: la integración de Linear con GitHub

Es más cómoda que la de Jira y conviene copiarla ([Linear GitHub](https://linear.app/docs/github)):

- **Copiar el nombre de rama** con Cmd/Ctrl+Shift+`.`. Puede mover el ítem a "empezado" al copiarlo.
- **Palabras mágicas** en el título o la descripción del PR, o en el commit:
  - Que cierran: `Fixes`, `Closes`, `Resolves`, `Completes`, `Implements`.
  - Que solo enlazan: `Ref`, `Part of`, `Towards`.
  - Que relacionan sin mover el estado: `Relates to`.
  - `skip` o `ignore` delante de un ID evitan el enlace.
- **Transiciones automáticas** configurables por equipo: PR en borrador, abierto, con revisión pedida, listo para mergear o mergeado.
  - De fábrica: PR abierto → En curso, mergeado → Hecho.
  - Con varios PR, el estado cambia recién con el último.
- **Sincronización de GitHub Issues**, de una o de dos vías.

---

## 4. Bibliotecas abiertas y licencias

### 4.1 Lienzo

| Opción | Licencia | Versión (npm) | Para qué encaja | En contra |
|---|---|---|---|---|
| **React Flow** (`@xyflow/react`) | **MIT**. Según el sitio, "open source MIT para siempre". | 13.0.3 (la 13.0.0 salió el 16/11/2026) | Lienzo de nodos HTML/React: cada nota, tarjeta o lista es un componente con su texto, checklists y botones. Trae minimapa, controles, fondo de puntos o líneas, viewport, nodos padre (sirven como marcos) y aristas a medida. | Dibuja en el DOM: con miles de nodos hay que medir. No trae lápiz libre. Los ejemplos avanzados están en React Flow Pro (pago, desde USD 169/mes); la biblioteca sigue libre. |
| **tldraw** | Licencia propia ("tldraw license") | 5.6.2 | El SDK de pizarra más completo: formas, flechas que se enganchan, marcos, multijugador con `@tldraw/sync`. | **En producción exige una clave:** sin clave, a los 5 s deja de dibujar el editor. La licencia "hobby" es no comercial, mantiene la marca de agua "made with tldraw" y se aprueba a criterio de tldraw. La comercial es anual y con precio a consultar. Hay una prueba de 100 días. |
| **Excalidraw** (`@excalidraw/excalidraw`) | MIT | 0.18.1 | Pizarra con estilo a mano alzada, flechas enganchadas con etiqueta, exportación a PNG y SVG. | La colaboración en vivo no viene en el paquete (solo en excalidraw.com). El estilo "dibujado" va contra la consigna. Sigue en 0.x. |
| **Motor propio** con Konva, PixiJS o Fabric | MIT | konva 10.11 · pixi.js 8.23 · fabric 7.4 | El mayor rendimiento posible (canvas o WebGL) y control total. | Hay que construir selección, edición de texto y accesibilidad. Atlassian y MURAL lo hicieron con equipos dedicados (ver 1.11). |

Fuentes: [xyflow](https://github.com/xyflow/xyflow), [React Flow 13](https://reactflow.dev/whats-new), [React Flow Pro](https://reactflow.dev/pro), [licencia tldraw](https://github.com/tldraw/tldraw/blob/main/LICENSE.md), [clave de tldraw](https://tldraw.dev/sdk-features/license-key), [precios tldraw](https://tldraw.dev/pricing), [Excalidraw](https://github.com/excalidraw/excalidraw).

**React Flow 13** ([novedades](https://reactflow.dev/whats-new)):

- **Mejoras:**
  - El estado interno se dividió en stores más chicos con suscripciones finas.
  - La biblioteca se compila con React Compiler.
  - Hooks nuevos: `useNode`, `useEdge` y `useEqualSelector`.
  - El modo de color sigue al sistema por defecto.
  - Los estilos van en `@layer xyflow`, fácil de sobreescribir con los temas crema y carbón.
- **Cambios que rompen:**
  - React 18 como mínimo.
  - `useStore` se reemplaza por stores separados.
  - `paneDragThreshold` arranca en 1.
  - `fitView` deja un margen del 5 %.
- **Conviene arrancar directo en v13.**

**Formato abierto para el lienzo: JSON Canvas 1.0**, de Obsidian ([especificación](https://jsoncanvas.org/spec/1.0/)):

- **Nodos** `text` (markdown), `file`, `link` y `group`, con `x`, `y`, `width`, `height` y `color` (hexadecimal o un preset del 1 al 6).
- **Aristas** con `fromNode`, `fromSide`, `fromEnd`, `toNode`, `toSide`, `toEnd`, `color` y `label`.
- **Orden:** el orden de la lista es el orden de apilado.
- **Uso:** sirve como formato para exportar e importar, y para mostrarle el lienzo a la IA.

### 4.2 Arrastre

| Opción | Licencia | Versión | Cómo funciona | A favor | En contra |
|---|---|---|---|---|---|
| **dnd-kit nuevo** (`@dnd-kit/react` sobre `@dnd-kit/dom`) | MIT | 0.5.3 (activo, oct-2026) | Eventos de puntero propios: puntero, mouse, táctil y teclado | La "copia flotante" que sigue al cursor se estila entera (inclinación, sombra, escala). Reordenamiento con animación, colisiones a medida, accesibilidad (ARIA y anuncios), listas virtualizadas. Adaptadores para React, Vue, Svelte y Solid. | Todavía 0.x: la API puede cambiar |
| **dnd-kit clásico** (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0) | MIT | Sin versiones nuevas desde dic-2024 | ídem | Muy probado y con mucha documentación | Congelado |
| **Pragmatic drag and drop** (`@atlaskit/pragmatic-drag-and-drop`) | Apache-2.0 | 4.0.0 (nov-2026) | El arrastre nativo de HTML5 | Núcleo de ~4,7 kB. Lo usan Trello, Jira y Confluence. Sirve con cualquier framework, soporta virtualización y trae paquetes para auto-scroll, zonas de soltado e indicador. Recibe archivos arrastrados desde el sistema. | La vista previa nativa no deja controlar la opacidad ni la sombra, y no se anima. Por diseño, "sin animaciones". |
| react-beautiful-dnd | Apache-2.0 | 13.1.1 | — | — | **Deprecado** en npm ([aviso](https://github.com/atlassian/react-beautiful-dnd/issues/2672)) |

Fuentes: [dnd-kit](https://github.com/clauderic/dnd-kit), [Pragmatic drag and drop](https://github.com/atlassian/pragmatic-drag-and-drop), [guía de diseño](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines).

### 4.3 Animación

**Motion** (antes Framer Motion): `motion` 14.14, se importa desde `motion/react`, licencia **MIT** ([repo](https://github.com/motiondivision/motion), [layout animations](https://motion.dev/docs/react-layout-animations)).

- **Prop `layout`:** anima tamaño y posición cuando cambian por un re-render, usando `transform` y no `width` ni `height`. Corrige solos `borderRadius` y `boxShadow` para que no se deformen.
- **`layoutId`:** un elemento nuevo con el mismo ID "vuela" desde el anterior. Sirve para que la tarjeta se abra desde su lugar en la lista.
- **`AnimatePresence`:** anima la salida antes de desmontar.
- **`LayoutGroup`:** coordina a varios componentes.
- **Resortes:** con `mass: "auto"`, según el tamaño del elemento.
- **Límites:** no funciona con `display: inline` ni con SVG. Las barras de scroll pueden disparar animaciones; se evita con `scrollbar-gutter: stable`.
- **Motion+** es pago y opcional: ejemplos y algunas API premium. La biblioteca sigue MIT.

### 4.4 Otras piezas útiles (todas verificadas en npm)

| Necesidad | Biblioteca | Licencia |
|---|---|---|
| Paleta de comandos (Cmd+K) | `cmdk` 1.1 | MIT |
| Atajos de teclado | `tinykeys` 4.0 | MIT |
| Estado de la interfaz | `zustand` 5.1 | MIT |
| Menús y popovers | `@floating-ui/react` 0.27 | MIT |
| Markdown: mostrar | `markdown-it` 15 o `marked` 18, y siempre `dompurify` 3.5 para limpiar el HTML | MIT · MPL-2.0 o Apache-2.0 |
| Markdown: editar | `@codemirror/view` 6 (texto) o `@tiptap/react` 3 (WYSIWYG) | MIT |
| Orden de tarjetas sin renumerar | `fractional-indexing` 4 | CC0-1.0 |
| IDs | `nanoid` 6 | MIT |
| Validación (también para MCP) | `zod` 4 | MIT |
| Layout automático (mapas, flujos) | `@dagrejs/dagre` 3 (`elkjs` es EPL-2.0 o GPL-3.0: evitar) | MIT |
| Lápiz libre | `perfect-freehand` 1.2 | MIT |
| Tiempo real y colaboración | `yjs` 13, `@hocuspocus/server` 4, `y-websocket` 3, `loro-crdt` 1.19, `@automerge/automerge` 3 | MIT |
| Backend con tiempo real | `@supabase/supabase-js` 2 (el dueño ya usa Supabase) | MIT |
| GitHub App y webhooks | `@octokit/app` 16, `@octokit/webhooks` 14 | MIT |

Para GitHub conviene una **GitHub App**, no una OAuth App ([GitHub Apps vs OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)):

- tiene permisos finos;
- el usuario elige a qué repositorios accede;
- usa tokens de vida corta;
- los webhooks son centrales;
- puede actuar sin un usuario presente.

**Figma** ([embed de archivos](https://developers.figma.com/docs/embeds/embed-figma-file/)):

- Se cambia `www` por `embed` en la URL del archivo: `https://embed.figma.com/{design|board|proto|slides|deck}/:file_key`.
- Parámetros:
  - `embed-host` (obligatorio);
  - `node-id` para mostrar un frame;
  - `theme=light|dark|system`;
  - `footer`, `viewport-controls`, `page-selector` y `mode=dev`.
- En el iframe solo `src` es obligatorio.
- Para los prototipos hay una API de mensajes (postMessage).

### 4.5 Servidor MCP

**Estado del protocolo.** La especificación vigente es la **2026-07-28** ([spec](https://modelcontextprotocol.io/specification/latest)):

- **Mensajes:** JSON-RPC 2.0, con pedidos "autocontenidos". Cada uno lleva en `_meta` la versión del protocolo y las capacidades del cliente, y ya no hay handshake `initialize`.
- **Servidor:** ofrece herramientas (tools), recursos (resources) y prompts.
- **Cliente:** puede ofrecer elicitación (pedirle datos al usuario). Lo que el servidor necesita del cliente (elicitación, sampling, roots) viaja dentro de los resultados.
- **Extensiones opcionales:**
  - Tasks, para tareas largas.
  - **MCP Apps**, para interfaz interactiva dentro del chat.
  - Skills.

**Transportes** ([transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)):

- **stdio:**
  - El cliente lanza el servidor como subproceso.
  - JSON-RPC en una línea por mensaje.
  - Las credenciales salen del entorno, no de OAuth.
  - Es para usarlo en la propia computadora (por ejemplo, desde Claude Code).
- **Streamable HTTP**, para servidores remotos:
  - Un solo endpoint (`/mcp`) que recibe un POST por mensaje.
  - Responde con JSON o con un flujo SSE propio de ese pedido.
  - Headers obligatorios: `MCP-Protocol-Version`, `Mcp-Method` y `Mcp-Name` (este en tools, resources y prompts), y tienen que coincidir con el cuerpo.
  - Validar el header `Origin` (si no vale, 403) y, en local, escuchar solo en 127.0.0.1.
  - **En esta versión ya no hay sesiones** (`Mcp-Session-Id`), ni GET, ni pedidos iniciados por el servidor.
    - Lo que el servidor necesita del cliente viaja dentro del resultado (MRTR).
    - Los avisos de cambios llegan por `subscriptions/listen`.
- **HTTP+SSE de 2024:** deprecado, no usar en servidores nuevos.

**SDK de TypeScript** ([repo](https://github.com/modelcontextprotocol/typescript-sdk), [docs v2](https://ts.sdk.modelcontextprotocol.io/v2), [soporte de 2026-07-28](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.md)):

- **v2 (estable):** `@modelcontextprotocol/server` y `@modelcontextprotocol/client` 2.4.0.
  - Código nuevo con Apache-2.0; el existente sigue MIT.
  - Herramientas con `server.registerTool(nombre, { description, inputSchema }, handler)`, con esquemas zod v4 u otro compatible.
  - Adaptadores para Express, Hono, Fastify y runtimes web estándar.
  - Middleware de autorización: `bearerAuth` y un router de metadatos.
- **v1:** `@modelcontextprotocol/sdk` 1.32.2 (MIT), con parches por al menos 6 meses desde el 27/07/2026.
- **Clave para la compatibilidad:**
  - `createMcpHandler(factory)` atiende por HTTP a los clientes de 2026-07-28 **y** a los de 2025 (`legacy: 'stateless'`, que viene de fábrica).
  - `serveStdio(...)` atiende a las dos eras.
  - Un `McpServer` armado a mano habla, por defecto, solo el protocolo de 2025.
  - El estado de cada conversación ya no vive en una sesión: va en `requestState`, un dato opaco que conviene sellar.

**Autorización (para HTTP)** ([authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)):

- **Roles:** el servidor MCP es un *resource server* de OAuth 2.1.
- **Inicio del flujo:** sin token responde **401** con `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`. Esos metadatos de recurso protegido (RFC 9728) son obligatorios.
- **Descubrimiento:** el servidor de autorización publica sus metadatos con RFC 8414 u OpenID Connect Discovery.
- **Registro del cliente**, en este orden de preferencia:
  1. **Client ID Metadata Documents (CIMD)**, recomendado.
  2. Pre-registro.
  3. **Dynamic Client Registration (DCR)**, deprecado pero todavía aceptado.
- **Seguridad del flujo:**
  - PKCE S256.
  - El parámetro `resource` (RFC 8707) con la URL canónica del servidor.
  - Validar el `iss` de la respuesta (RFC 9207).
- **Tokens:**
  - El servidor valida que el token se emitió para él (audiencia) y nunca acepta ni reenvía tokens de otro.
  - Nada de tokens en la URL.
  - Los scopes se indican en el `WWW-Authenticate`; si faltan permisos, 403 con `insufficient_scope` y el cliente pide más ("step-up").
  - Refresh tokens con `offline_access`.

**Conectarlo a Claude** ([construir para Claude](https://claude.com/docs/connectors/building), [autenticación](https://claude.com/docs/connectors/building/authentication), [ayuda](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)):

- **Cómo se agrega:**
  - En claude.ai y Desktop: "Personalizar → Conectores → Agregar conector personalizado" con la URL. En el plan gratis, un solo conector propio.
  - En Desktop, los servidores remotos no se cargan desde `claude_desktop_config.json`.
  - En Claude Code, por línea de comandos (`claude mcp add --transport http <nombre> <url>`; ver el [quickstart](https://code.claude.com/docs/en/mcp-quickstart)).
- **Transporte:** Streamable HTTP, y todavía acepta HTTP+SSE.
- **Autorización:** Claude sigue las especificaciones de autorización 2025-03-26, 2025-06-18 y 2025-11-25.
- **Tipos de autenticación:**
  - OAuth con DCR o con CIMD (Claude usa CIMD solo si el servidor de autorización anuncia `client_id_metadata_document_supported` y `none` en `token_endpoint_auth_methods_supported`).
  - Credenciales guardadas por Anthropic.
  - Encabezado fijo con una clave (beta).
  - Sin autenticación.
- **Redirecciones:**
  - `https://claude.ai/api/mcp/auth_callback` para las apps alojadas.
  - Claude Code usa `http://localhost/callback` y `http://127.0.0.1/callback` en cualquier puerto.
- **Exigencias del cliente de Claude:**
  - El 401 es obligatorio: no lee `WWW-Authenticate` en un 200.
  - Usa solo el primer `authorization_servers`.
  - Les da 10 s a los endpoints de descubrimiento, registro y token, y 30 s al refresh.
  - `/token` tiene que aceptar `application/x-www-form-urlencoded`.
  - Si el refresh token ya no vale, responder `invalid_grant`.
  - Hay que rotar los refresh tokens de los clientes públicos (DCR y CIMD).
- **Tráfico:** el de Anthropic sale de `160.79.104.0/21`.
- **Límites:**
  - En claude.ai y Desktop: ~150.000 caracteres por resultado y 240 s por llamada.
  - En Claude Code: 25.000 tokens por resultado.
  - **Claude no soporta suscripciones a recursos ni sampling.**
  - Las MCP Apps sí funcionan.

**Conectarlo a ChatGPT** ([developer mode](https://developers.openai.com/api/docs/guides/developer-mode), [ayuda](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt)):

- **Cómo se agrega:** en la web, página de Plugins → "+" → "Add custom MCP server", con la URL o un túnel seguro. Después hay que instalarlo.
- **Transporte:** SSE y streaming HTTP.
- **Autenticación:**
  - OAuth, ninguna o mixta: en la mixta, el inicio y la lista de herramientas van sin autenticación y cada herramienta declara la suya.
  - En OAuth usa CIMD (`none` o `private_key_jwt`) o DCR.
  - Pide refresh tokens y `offline_access`; sin eso se pierde el acceso al vencer.
- **Escritura:** las acciones de escritura piden confirmación salvo que la herramienta tenga `readOnlyHint`.
- **Planes:** según el centro de ayuda, Business y Enterprise/Edu, y lo activan los administradores **(a verificar para planes personales)**.
- **Cambios:** si cambian las herramientas después de publicar, hay que recrear la app.

**Seguridad (de la especificación):**

- Consentimiento explícito antes de exponer datos y antes de invocar herramientas.
- Las herramientas son ejecución de código.
- Las anotaciones de un servidor no confiable no se creen.
- Ojo con la inyección de instrucciones en el contenido que lee la IA. ([spec](https://modelcontextprotocol.io/specification/latest))

---

## 5. Recomendación para la v1

**La idea en una frase:** cada tablero es un lienzo infinito con listas kanban adentro. **La tarjeta es el objeto central** y puede estar a la vez en una lista y en el lienzo, como un espejo de Trello pero dentro del mismo tablero. Todo se maneja con el teclado, el arrastre es animado, hay enlaces a GitHub y Figma, y un servidor MCP permite que Claude o ChatGPT lean y escriban, con cada cambio visible en vivo.

### 5.1 Copiar sí o sí

**Lienzo (Miro):**

- **Navegación:**
  - Espacio+arrastrar o la mano para mover.
  - Rueda o trackpad con detección automática y modos fijos para elegir.
  - Pinza para el zoom.
  - Ajustar todo (Alt+1), zoom a la selección (Alt+2) y 100 % (Cmd+0).
  - Minimapa (M) y grilla de puntos (G).
- **Selección:**
  - Recuadro, Cmd/Shift+clic y Cmd+A.
  - Agrupar y bloquear.
  - Alinear y distribuir.
  - Guías de alineación que enganchan a otros objetos.
  - Traer al frente y mandar al fondo.
- **Creación:**
  - Una tecla por herramienta: V, H, N, T, S, L, F, D.
  - Duplicar con Cmd+D, Alt+arrastrar y Alt+flechas.
  - Enter edita y Esc sale.
  - Cmd+K abre la paleta de comandos.
  - Deshacer y rehacer de verdad, incluidos los borrados.
- **Objetos de la v1:**
  - nota;
  - texto;
  - formas básicas (rectángulo, elipse, rombo);
  - marco con lista de marcos para "ir a";
  - conector recto, ortogonal o curvo, pegado a un lado, con puntas y etiqueta;
  - imagen;
  - link con vista previa;
  - embebido de Figma;
  - **tarjeta**;
  - **lista kanban como objeto del lienzo**, como el widget de Miro.
- **Búsqueda:** Cmd+F dentro del tablero, con filtro por tipo.

**Kanban y tarjeta (Trello):**

- **Arrastre con los valores de Atlassian:**
  - Inclinación de 4°, sombra y vista previa desde el punto de agarre.
  - Lugar de destino visible: hueco animado o línea de 2 px.
  - Resaltado de la lista de destino en 350 ms.
  - Desplazamiento automático que acelera.
  - Actualización optimista y destello al soltar.
  - Mover también desde el menú y con el teclado (`,` `.` `<` `>`).
  - Crear en línea con `n` y Enter, sin modales.
- **Tarjeta completa:**
  - título y descripción en markdown;
  - etiquetas de color con nombre;
  - responsables;
  - inicio y vencimiento con hora, con **los mismos colores de urgencia**;
  - checklists con progreso, ítems con responsable y fecha, y "convertir ítem en tarjeta";
  - adjuntos y links;
  - portada de color o imagen;
  - comentarios con @menciones;
  - registro de actividad;
  - archivar (nunca borrar directo);
  - mover y copiar;
  - plantillas de tarjeta.
- **Filtros:** `f`, `q` y `x`, y búsqueda con operadores al estilo de Trello: `@yo`, `#etiqueta`, `lista:`, `vence:semana`, `tiene:pr`, `tipo:error` y `-` para negar.

**Desarrollo (Jira y Linear):**

- **Tipo de tarjeta:** idea, tarea, historia, error, épica, decisión o subtarea. Las épicas son padres.
- **Prioridad** con 4 niveles (urgente, alta, media, baja) más "sin prioridad"; Jira trae 5, pero alcanza con menos. Estimación opcional en puntos.
- **Estados con 3 categorías** (por hacer, en curso, hecho). Cada lista se puede atar a una categoría.
- **Vínculos con dirección:** bloquea / depende de, duplica, relacionada, causa e implementa.
- **Clave legible por tablero** (`TAB-123`): letras mayúsculas, guion y número, como Jira.
- **GitHub con una GitHub App y webhooks:**
  - La clave en la rama, el commit o el título del PR enlaza.
  - Las palabras mágicas de Linear (`Fixes TAB-123` cierra, `Refs TAB-123` solo enlaza).
  - Transiciones configurables: PR abierto → En revisión, mergeado a la rama principal → Hecho.
  - Botón "copiar nombre de rama" (Cmd+Shift+.).
  - El estado del PR y de sus checks se ve en el frente de la tarjeta.

**IA (MCP):**

- **Servidor HTTP** con el SDK v2 y `createMcpHandler`, que atiende a las dos eras.
- **OAuth** con metadatos de recurso protegido, PKCE, CIMD y DCR.
- **stdio** para desarrollo local.
- **Cada cambio de la IA:**
  - se ve en vivo en la pantalla, porque hay sincronización en vivo del servidor a la interfaz desde el día uno;
  - queda en la actividad con su origen ("Claude", "ChatGPT").
- **Herramientas sugeridas.** Todas reciben y devuelven datos estructurados (el lienzo en formato tipo JSON Canvas).

| Herramienta | Anotaciones |
|---|---|
| `buscar_tarjetas`, `leer_tablero`, `leer_tarjeta`, `leer_lienzo`, `listar_decisiones` | `readOnlyHint: true` |
| `crear_tarjeta`, `actualizar_tarjeta`, `mover_tarjeta`, `comentar`, `vincular_tarjetas`, `registrar_decision`, `crear_elemento_lienzo`, `conectar_elementos` | Escritura, confirmada por el cliente |
| `archivar_tarjeta` | Reversible. No hay borrado definitivo por MCP. |

**Atajos, resolviendo los choques entre Miro y Trello por contexto:**

- Lo que tiene el cursor encima o está seleccionado manda.
  - Sin nada, valen las teclas de Miro: N nota, T texto, D tarjeta nueva, C comentario.
  - Sobre una tarjeta, valen las de Trello: T título, D fechas, C archivar (con un aviso para deshacer), M miembros, L etiquetas, E edición rápida.
- **Espacio queda para mover el lienzo:** "asignarme" pasa al menú de miembros (M), con "yo" primero.
- `?` muestra todos los atajos.

**Interfaz:**

- **Sin contornos:** la jerarquía la dan el fondo, la sombra y el espacio, nunca un borde.
- **Foco visible:** anillo de foco para el teclado.
- **Temas:** crema/hueso y carbón como variables CSS (los estilos de React Flow van en `@layer xyflow`).
- **Animaciones:**
  - Solo `transform` y `opacity`.
  - Cortas (≤350 ms) e interrumpibles.
  - Abrir la tarjeta "desde su lugar" con `layoutId`.
- **Arrastre:** umbral de ~5 px para distinguir clic de arrastre.

### 5.2 Dejar para después

- **Colaboración multiusuario en vivo:**
  - cursores con nombre;
  - seguir a alguien y "traer a todos";
  - modo privado, votación y temporizador.

  Para eso: Yjs + Hocuspocus, o presencia de Supabase Realtime.
- **Presentación por marcos** y exportar a PDF o imagen.
- **Lienzo avanzado:** mapas mentales con auto-layout, packs de formas y capas, lápiz libre y tablas tipo Miro Tables.
- **Vistas:** calendario, línea de tiempo, panel con gráficos y mapa. La vista tabla puede ir en una v1.5.
- **Automatizaciones tipo Butler:** reglas, botones y comandos programados, salvo las transiciones por GitHub que ya van en la v1.
- **Planificación:** sprints con velocidad y burndown (el campo `sprintId` ya queda en el modelo).
- **Extras de la tarjeta:**
  - campos personalizados (el modelo los soporta, falta la interfaz);
  - espejos entre tableros;
  - votos, ubicación, fechas recurrentes y recordatorios por correo o push.
- **GitHub avanzado:** smart commits (`#comentario`, `#tiempo`) y sincronización de dos vías con GitHub Issues.
- **IA dentro del chat:** MCP Apps (el tablero dibujado dentro de Claude o ChatGPT).
- **IA dentro de la app:** generar checklists, agrupar notas como el "Cluster" de Miro.
- **Historial:** versiones completas del tablero (snapshots). La v1 tiene actividad, deshacer y papelera.
- **Táctil:** uso completo en pantalla táctil y en celular.

### 5.3 Qué NO hacer

1. **No usar tldraw como base sin pagar.** Sin clave deja de dibujar en producción, y la versión gratis lleva marca de agua y necesita aprobación.
2. **No escribir un motor WebGL propio en la v1.** Arrancar con React Flow, renderizar solo lo visible y medir. Pasar a canvas o WebGL recién si hay miles de objetos por tablero (Atlassian lo hizo con un equipo dedicado).
3. **No usar react-beautiful-dnd** (está deprecado).
4. **No mezclar dos arrastres en el mismo elemento.** React Flow arrastra los objetos del lienzo; dentro de una lista kanban, las tarjetas se arrastran con dnd-kit y la lista lleva las clases `nodrag` y `nowheel`. Probar temprano el caso más difícil: llevar una tarjeta de una lista al lienzo y al revés, con zoom.
5. **No usar animaciones que obliguen a esperar.** Es la razón por la que Atlassian dejó react-beautiful-dnd.
6. **No usar modales para crear ni bordes para separar** (la consigna pide "sin contornos").
7. **No guardar el "porqué" como texto suelto en la descripción.** Va en un campo estructurado y buscable.
8. **No crear "depende de" y "bloquea" como tipos distintos:** son el mismo vínculo visto desde cada lado, como en Jira.
9. **En MCP, no:**
   - usar HTTP+SSE viejo;
   - poner tokens en la URL;
   - aceptar tokens emitidos para otro recurso;
   - ofrecer solo DCR;
   - depender de suscripciones a recursos o de sampling (Claude no los soporta);
   - exponer borrado definitivo.
10. **No copiar los muros de planes pagos de Trello:** vistas, campos y espejos son parte de la app.
11. **No subir claves al repo:** la clave privada de la GitHub App y los secretos de OAuth viven en el servidor (Vercel o Supabase).

### 5.4 Modelo de datos sugerido para la tarjeta

Suma lo mejor de Trello (contenido y fechas), lo mejor de Jira (tipo, estado, prioridad, estimación, vínculos, GitHub) y un campo nuevo, **`porque`**, inspirado en los registros de decisiones (contexto → opciones → decisión → consecuencias).

```ts
type ID = string;        // nanoid
type Fecha = string;     // ISO 8601
type Markdown = string;

interface Tarjeta {
  id: ID;
  clave: string;                 // "TAB-123": legible, para ramas, commits y PR
  tableroId: ID;
  listaId: ID | null;            // columna kanban (null si vive solo en el lienzo)
  orden: string;                 // índice fraccional dentro de la lista
  padreId?: ID;                  // épica o tarjeta padre

  tipo: 'idea' | 'tarea' | 'historia' | 'error' | 'epica' | 'decision' | 'subtarea';
  titulo: string;
  descripcion: Markdown;
  estadoId: ID;                  // el estado pertenece a una categoría: por_hacer | en_curso | hecho
  prioridad: 'urgente' | 'alta' | 'media' | 'baja' | 'ninguna';
  estimacion?: { puntos?: number; horas?: number };

  etiquetas: ID[];               // definidas en el tablero: nombre + color
  responsables: ID[];
  observadores: ID[];            // "watch"
  fechas: {
    inicio?: Fecha;
    vence?: Fecha;
    conHora?: boolean;
    recordatorio?: 'ninguno' | '0m' | '5m' | '15m' | '1h' | '1d' | '2d';
    completada?: Fecha;          // si está, el badge va en verde
  };
  checklists: Checklist[];
  adjuntos: Adjunto[];
  portada?: { tipo: 'color' | 'imagen'; valor: string; tamano: 'arriba' | 'completa' };
  campos: Record<ID, string | number | boolean>;  // campos personalizados del tablero (texto, número, casilla, fecha o id de opción)

  vinculos: Vinculo[];           // se guarda una dirección; la vuelta se calcula
  porque?: Porque;               // EL CAMPO NUEVO
  github: { ramas: RefGit[]; commits: RefGit[]; prs: RefPR[]; issues: RefGit[] };
  figma: { fileKey: string; nodeId?: string; url: string; embedUrl: string }[];
  sprintId?: ID;

  archivada: boolean;
  esPlantilla: boolean;
  origen: { tipo: 'humano' | 'ia' | 'automatizacion' | 'github'; actorId: ID; cliente?: string }; // "Claude", "ChatGPT"
  creadaEn: Fecha;
  actualizadaEn: Fecha;
  version: number;               // control de concurrencia optimista (la IA y la persona editan a la vez)
}

interface Porque {
  motivo: Markdown;              // por qué existe: el problema o la oportunidad
  contexto?: Markdown;           // qué se sabía, restricciones
  opciones?: { titulo: string; pros?: string; contras?: string; elegida?: boolean; descartadaPorque?: string }[];
  decision?: Markdown;           // qué se decidió
  consecuencias?: Markdown;      // qué implica, qué se resigna
  estado: 'abierta' | 'propuesta' | 'aceptada' | 'rechazada' | 'reemplazada';
  decidieron?: ID[];
  decididaEn?: Fecha;
  reemplazadaPor?: ID;           // tarjeta-decisión que la reemplaza
  evidencias?: string[];         // links: PR, issue, Figma, métrica, conversación
  revisarEn?: Fecha;             // cuándo volver a mirarla
}

interface Vinculo {
  tipo: 'bloquea' | 'duplica' | 'relacionada' | 'causa' | 'implementa' | 'reemplaza' | 'clona';
  destinoId: ID;                 // vuelta: bloqueada por / depende de, duplicada por, causada por…
  nota?: string;
}

interface Checklist {
  id: ID; titulo: string; ocultarHechos: boolean;
  items: { id: ID; texto: Markdown; hecho: boolean; responsableId?: ID; vence?: Fecha; orden: string }[];
}

interface Adjunto {
  id: ID; tipo: 'archivo' | 'enlace' | 'figma' | 'github';
  url: string; nombre: string; mime?: string; tamano?: number; miniatura?: string;
  creadoPor: ID; creadoEn: Fecha;
}

interface RefGit { repo: string; ref: string; url: string; autor?: string; en: Fecha }   // rama, sha o número de issue
interface RefPR extends RefGit {
  numero: number;
  estado: 'borrador' | 'abierto' | 'mergeado' | 'cerrado';
  checks?: 'ok' | 'fallan' | 'corriendo';
  cierra: boolean;               // "Fixes TAB-123" (true) o "Refs TAB-123" (false)
}
```

**Alrededor de la tarjeta:**

- **`Comentario`:** `{ id, tarjetaId, autorId, cuerpo: Markdown, menciones: ID[], respuestaA?, resuelto, creadoEn, editadoEn }`.
- **`Actividad`:** registro que solo crece. Es a la vez el historial, el deshacer entre sesiones y la auditoría de la IA: `{ id, tableroId, tarjetaId?, actor: { tipo, id, cliente? }, accion, antes?, despues?, en }`.
- **`ElementoLienzo`:**
  - `{ id, tableroId, tipo: 'nota'|'texto'|'forma'|'marco'|'imagen'|'enlace'|'embebido'|'tarjeta'|'lista', x, y, ancho, alto, rotacion, z: string, marcoId?, grupoId?, bloqueado, estilo, datos }`.
  - Los de tipo `tarjeta` y `lista` solo apuntan a `tarjetaId` o `listaId`: **una tarjeta, muchas vistas**.
- **`Conector`:** `{ id, desde: { elementoId, lado? }, hasta: { elementoId, lado? }, puntaInicio, puntaFin, trazo: 'recto'|'ortogonal'|'curvo', color, grosor, etiqueta? }`. Es compatible con JSON Canvas, así que se puede exportar e importar.
- **`Lista`:** `{ id, tableroId, nombre, orden, categoria?: 'por_hacer'|'en_curso'|'hecho' }`. Si tiene categoría, mover una tarjeta ahí le cambia el estado. Es lo que hace el puente entre Trello y Jira.
- **`Tablero`:** `{ id, nombre, prefijoClave: 'TAB', etiquetas, estados, campos (≤50, como Trello), miembros, repos: (repositorios de la GitHub App), reglasGithub: [{ evento: 'pr_abierto'|'pr_mergeado'|…, listaDestinoId }] }`.

### 5.5 Bibliotecas recomendadas

| Necesidad | Elegida | Licencia | Por qué |
|---|---|---|---|
| Lienzo infinito | **`@xyflow/react` 13** (React Flow) | MIT | Nodos que son componentes React (tarjetas ricas), minimapa, controles, fondo, marcos como nodos padre. La v13 es más rápida. |
| Arrastre de tarjetas y listas | **`@dnd-kit/react` 0.5** (fijar la versión; si molesta, volver a `@dnd-kit/core` 6.3 + `@dnd-kit/sortable` 10) | MIT | Copia flotante estilable (4°, sombra), reordenamiento animado, teclado, táctil, accesibilidad |
| Archivos desde la computadora | Eventos nativos de HTML5 (o Pragmatic si hace falta) | — / Apache-2.0 | No justifica una segunda biblioteca en la v1 |
| Animaciones | **`motion` 14** (`motion/react`) | MIT | `layout`, `layoutId`, `AnimatePresence`, resortes |
| Paleta, atajos, estado, menús | `cmdk`, `tinykeys`, `zustand`, `@floating-ui/react` | MIT | Livianas y probadas |
| Markdown | `markdown-it` + `dompurify` (y `@tiptap/react` si se quiere WYSIWYG) | MIT · MPL-2.0 o Apache-2.0 | Seguro, porque limpia el HTML |
| Orden e IDs | `fractional-indexing`, `nanoid` | CC0-1.0 · MIT | Mover sin renumerar |
| Datos y tiempo real | Postgres con Realtime (`@supabase/supabase-js`, que el dueño ya usa) | MIT | Para ver los cambios de la IA en vivo. La colaboración completa (Yjs, MIT) queda para después. |
| Servidor MCP | **`@modelcontextprotocol/server` 2.4** + `zod` 4 | Apache-2.0 (código nuevo) / MIT | `createMcpHandler` atiende a las dos eras; stdio y HTTP |
| GitHub | GitHub App + `@octokit/app`, `@octokit/webhooks` | MIT | Permisos finos, tokens cortos, webhooks centrales |
| Figma | iframe `embed.figma.com` con `embed-host` | — | Para mostrarlo no hace falta API ni token, pero quien mira necesita acceso al archivo en Figma. La miniatura por API va después. |
| Descartadas | tldraw (licencia), react-beautiful-dnd (deprecado), Excalidraw (estilo y sin colaboración en el paquete), elkjs (EPL-2.0 o GPL-3.0) | — | — |
