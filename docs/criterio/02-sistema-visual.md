# 2. Sistema visual

Fuente de verdad: [`web/src/estilos/tokens.css`](../../web/src/estilos/tokens.css). Ningún componente escribe un color,
una sombra o un radio a mano: usa un token. Si hace falta uno nuevo, se agrega ahí en los dos temas, con un comentario
del porqué, y se corre `node scripts/contraste.mjs`.

## Principio: sin contornos

> «Sin contornos: la jerarquía la dan el tono, la sombra y el espacio.» (primera línea de `tokens.css`)

Es la regla 2 del plan de escritorio. Los **únicos trazos** permitidos son: el marco de selección del lienzo, los
conectores y el borde *opcional* de una forma (que es contenido del usuario, no interfaz). Un botón, una tarjeta, un menú
o un campo no llevan `border`. Se separan con:

- **Tono:** una escalera de superficies (`--c-fondo` → `--c-fondo-2` → `--c-bandeja` → `--c-superficie` →
  `--c-elevada`, y hacia adentro `--c-hundido`, `--c-hundido-2`).
- **Sombra:** `--sombra-1` (apoyado), `--sombra-2` (flota un poco), `--sombra-3` (menús, ventanitas),
  `--sombra-arrastre` (lo que se está arrastrando), `--sombra-hoja` (diálogos y hojas). Más `--brillo` (un reflejo de
  1 px arriba en lo lleno) y `--sombra-interior` (lo hundido).
- **Espacio:** aire antes que líneas divisorias.

## Los dos temas

| | Claro: «crema, hueso, crudo» | Oscuro: «carbón neutro» |
|---|---|---|
| Fondo | `#f4efe6` | `#1a1b1d` |
| Superficie | `#fffdf9` | `#2b2c30` |
| Texto / 2 / 3 | `#29241e` / `#665d52` / `#786e62` | `#ededef` / `#b1b3ba` / `#9a9da6` |
| Acento | naranja `#d2663a` | azul acero `#8fb2f8` |
| Selección del lienzo | azul `#2f6fde` | azul `#7aa7ff` |

Por qué así (decisión F1 del plan de escritorio): el dueño vio el oscuro de la 0.1 «naranja, medio extraño». Eran tres
fuentes: grises cálidos, acento naranja y rellenos de marcos naranjas. El carbón mantiene **la misma luminosidad por
superficie** (la jerarquía del Kanban no cambia) y saca el matiz: el azul queda 2 o 3 puntos por encima del rojo
(`scripts/contraste.mjs` lo verifica: B ≥ R y B − R ≤ 6). **En oscuro el color es del contenido: la interfaz queda gris y
azul.**

Reglas:

- **Seleccionar es azul en los dos temas** (`--c-seleccion`), separado del acento: no se confunde con notas, formas o
  marcos naranjas.
- **Texto sobre botón lleno:** `--c-acento-solido` + `--c-sobre-acento` (4,6:1 en claro, 8,5:1 en oscuro). No usar
  `--c-acento` como fondo con texto blanco.
- **Contraste mínimo AA** (4,5:1 texto, 3:1 íconos grandes). `--c-texto-3` se oscureció de `#978d80` a `#786e62` por eso
  (comentario en el token).
- **Colores de contenido** con nombre, no hexadecimal: diez colores (`gris rojo naranja amarillo lima verde celeste azul
  violeta rosa`) en familias: `--e-*` etiquetas (fondo suave, `-t` texto fuerte, `-s` sólido), `--n-*` notas (pastel,
  como papel, casi iguales en los dos temas), `--m-*` marcos (tinte muy suave), `--tinta-*` texto de color. Por eso no hay
  selector hexadecimal: los nombres cambian bien entre temas y un hex no.
- **El tema cambia sin salto** (fundido de 200 ms) y el script en línea de `web/index.html` pone `data-theme` antes de
  pintar (sin parpadeo). La clave es `tablero.tema` en `localStorage`.
- `--c-ia` (violeta) marca lo que hizo una IA (y es el fondo del número de la campana, con texto `--c-sobre-ia`). Como **texto**
  sobre `--c-ia-suave` (pastillas de mención) se usa `--c-ia-texto`: `--c-ia` solo da 4,0 en claro; `scripts/contraste.mjs` lo verifica. `--c-ok` y `--c-peligro` solo para estados.
- `--c-medida` (rojo) es solo para la regla de Diseño.

## Tipografía

- **Interfaz:** Figtree Variable (`--fuente`), base **14 px / 1,45** en escritorio (`base.css`), `ss01` activado.
  **Mono:** Geist Mono Variable (`--fuente-mono`) para claves (`RC-12`), código y medidas.
- **Celular:** base 15 px; título de tarjeta 15/1,35; todo campo editable ≥ 16 px (si no, iOS agranda la página).
- **Lienzo:** cinco fuentes (`--f-sans`, `--f-serif` Newsreader, `--f-mono`, `--f-mano` Caveat, `--f-titulos`
  Bricolage Grotesque). Las tres últimas se cargan **recién cuando un objeto las usa**.
- **Escala en uso** (medida en los CSS): 11 · 11,5 · 12 · 12,5 · 13 · 13,5 · 14 · 15 · 16 · 18. Los medios píxeles
  existen a propósito (13,5 es el texto de botón; 12,5 la ayuda). No inventar 13,25.
- **Pesos variables:** 500 · 560 (botones) · 600 · 620 (títulos de estado vacío) · 650 · 700 (títulos) · 750. Figtree es
  variable: se usa el peso exacto que se ve bien, no solo 400/700.
- Ningún texto de contenido de menos de 13 px en el celular. En los diagramas del lienzo, letra mínima = ancho del
  diagrama ÷ 100 (`docs/guia-para-ias.md`, tema `diagramas`).

## Espacios, radios y densidad

- **Espacios:** múltiplos de 2 con preferencia por 4: los más usados son 2, 6, 8, 10, 12, 16 (gap y padding). Separación
  mínima entre dos blancos táctiles: 8 px.
- **Radios:** `--r-xs` 6 · `--r-s` 8 (botones, campos) · `--r-m` 12 (tarjetas, menús) · `--r-l` 16 · `--r-xl` 22 (hojas
  del celular). Un elemento adentro de otro lleva un radio menor (radio de afuera − relleno).
- **Densidad** (Configuración → Apariencia): `--d` vale 1 (cómoda, igual a la 0.1) o 0,8 (compacta), y en compacta también
  cambian `--ancho-lista` (272 → 256), `--alto-barra` (56 → 48) y `--ancho-lateral` (248 → 228). Lo nuevo que tenga
  rellenos «de interfaz» los multiplica por `var(--d)`.
- **Blanco mínimo:** `--toque` 32 px en escritorio (botones de barras y menús); el celular lo sube a 44 en `movil.css`.

## Íconos

- **lucide-react**, nada más. Tamaños en uso: 13, 14, 15 (el más común), 16, 18, 20; 24 en la barra inferior del celular;
  28 en estados vacíos. Trazo: el de fábrica (2) o 2,2 cuando el ícono es chico y tiene que pesar igual que el texto.
- El ícono **acompaña** al texto; solo en botones de ícono va solo, y entonces lleva `aria-label` y aviso (`data-tip`).
- La marca (`web/public/marca/telar.svg`, «la pasada»: una trama que cruza tres hilos y forma la T) está en `ui/marcas.tsx`
  como `MarcaTelar`. Los íconos de la PWA se **generan** desde ahí (`npm run pwa:iconos`), no se dibujan a mano.

## Botones y piezas base (`base.css`)

| Pieza | Medida | Uso |
|---|---|---|
| `.boton` | 34 px de alto, 14 de relleno, `--r-s`, fondo `--c-hundido`, 13,5 px peso 560 | Acción normal |
| `.boton--primario` | fondo `--c-acento-solido`, texto `--c-sobre-acento`, sombra de su color + `--brillo` | Una por pantalla o diálogo |
| `.boton--chico` | 28 px, 12,5 px | Barras densas |
| `.boton--fantasma` | sin fondo, texto `--c-texto-2` | Acciones secundarias |
| `.boton--peligro` | rojo solo al pasar el mouse | Archivar, sacar |
| `.boton-icono` | 32 × 32 (26 el chico); activo con `--c-acento-tinte` | Barras |
| `.lista__boton` | círculo de 28 (36 en táctil, zona de 44); el «+» lleva `--c-superficie` y `--sombra-1`, el «⋯» va liso | Encabezado de la lista del Kanban: número (24), «+» y «⋯» comparten centro |
| `.pildora` | 30 px, radio 999 | Filtros y opciones |

Antes de crear una pieza nueva, buscá si existe: `ui/comunes.tsx`, `ui/Desplegable.tsx`, `ui/Dialogo.tsx`,
`ui/EstadoVacio.tsx`, `ui/AvatarProyecto.tsx`, `vistas/lienzo/barra/piezas.tsx` y `SelectorColor.tsx`, y en el celular
`movil/ui/` (`HojaInferior`, `FilaTactil`, `HojaDesplegable`).

## Estados (todos, siempre)

Cada pieza interactiva tiene que tener resuelto cada estado. Si falta uno, no está terminada.

| Estado | Cómo se ve | Dónde está |
|---|---|---|
| **Reposo** | tono de su nivel, sin borde | — |
| **Hover** (solo con mouse) | `--c-hover` o `--c-hover-fuerte`, o el tono siguiente (`--c-hundido-2`); 120 ms | `base.css` |
| **Foco** (teclado) | `:focus-visible`: anillo de 2 px `--c-foco` a 2 px. En campos, el foco lo da el propio campo (sin anillo); en filas de menú, el fondo | `base.css` 75–86, 763 |
| **Apretado** | `scale(0.985)` y medio píxel abajo en escritorio; en táctil `scale(0.97)` + `--c-activo` en 80 ms | `base.css`, `movil.css` |
| **Activo / elegido** | fondo `--c-acento-tinte`, texto `--c-acento-fuerte`, y `aria-pressed` o `aria-current`: **el color nunca solo** | `.boton-icono--activo` |
| **Deshabilitado** | `opacity: 0.55`, cursor normal; y si se puede, un aviso de por qué | `base.css` |
| **Vacío** | molde único `EstadoVacio`: ícono 28 px `--c-texto-3`, título 14/620, ayuda 12,5 `--c-texto-2`, acción opcional. Sin dibujos ni borde. La tabla de textos está en `plan-v0.2-escritorio.md`, 9.2 | `ui/EstadoVacio.tsx` |
| **Cargando** | lo último que se tenía (instantánea) antes que un cartel; si no hay nada, «Cargando…» en el lugar del dato. El lienzo abre directo en «ver todo» desde el primer cuadro. Nada de ruedas que giran sobre la pantalla entera | `pwa/sinconexion/instantanea.ts` |
| **Error** | aviso (`estado/avisos.ts`, tipo `error`) que dice qué pasó y qué hacer, en castellano; nunca un código. El servidor ya contesta así (`ErrorDominio`) | `ui/Avisos.tsx` |
| **Sin conexión** | franja propia, se lee lo último y solo se encolan tarjetas nuevas | `movil/ui/FranjaSinConexion.tsx`, `pwa/ui/PantallaSinConexion.tsx` |
| **Hecho por la IA** | destello al aparecer (260 ms) y firma en la actividad | lienzo, actividad |

## En el celular, los mismos tokens

`movil.css` **no define colores**: usa los mismos tokens y solo cambia medidas (`--m-barra-sup` 52, `--m-barra-inf` 56,
`--m-toque` 44, `--m-margen` 16, zonas seguras). Así cuando cambia un tema, el celular lo hereda sin tocar nada. El color
de la barra del sistema y del manifest también sale de `tokens.css` (`scripts/iconos-pwa.mjs` lo verifica).
