# 3. Movimiento e interacción

Fuente de verdad: [`web/src/util/movimiento.ts`](../../web/src/util/movimiento.ts) (para `motion`) y los tokens
`--curva`, `--curva-sale`, `--curva-resorte`, `--t-rapido` (120), `--t-medio` (220), `--t-lento` (350) de `tokens.css`
(para CSS). **Un solo catálogo**: ninguna pieza inventa su curva. «Con una tabla única todo se mueve "igual" y se nota el
cuidado» (`plan-v0.2-escritorio.md`, 9.1).

## Reglas

1. **Nada dura más de 260 ms**, salvo los encuadres del lienzo (420 ms: ver todo, ir al marco, zoom a la selección).
2. **Lo que entra usa `CURVA`** (`cubic-bezier(0.15, 1, 0.3, 1)`, rápida al principio y suave al final) y **lo que sale
   `CURVA_SALE`** (`cubic-bezier(0.32, 0, 0.67, 0)`), y sale más rápido de lo que entró.
3. **Solo se animan `transform` y `opacity`** (y `stroke-dashoffset` en el conector que se dibuja). Nunca alto, ancho,
   `top` ni márgenes: fuerzan a recalcular el diseño en cada cuadro (en un Android de gama baja se nota).
4. **El movimiento explica, no decora.** Una ventanita crece **desde su disparador** (`origenDe(lado)`); la píldora de la
   herramienta activa **se desliza** (`layoutId`) para que el ojo siga el cambio; lo que crea la IA **destella** para que
   se vea que llegó de afuera.
5. **Resortes con nombre:** `RESORTE_HERRAMIENTA` (600/38), `RESORTE_PILDORA` (500/38), diálogos 480/36, hojas del
   celular 420/40/0,9. No sumar resortes nuevos sin motivo.

## El catálogo (tabla de 9.1, la que manda)

| Qué | Cómo | Duración y curva |
|---|---|---|
| Aparece un objeto creado acá | escala 0,9 → 1, opacidad 0 → 1 | 180 ms, `--curva-resorte` |
| Aparece un objeto creado por la IA u otra pestaña | lo mismo + destello | 260 ms |
| Se borra un objeto | escala 1 → 0,94, opacidad → 0 | 120 ms, `--curva-sale` |
| Marco de selección | al instante; las manijas, escala 0,6 → 1 | 90 ms |
| Barra contextual | opacidad y 2 px de subida; se oculta al mover | 140 ms entra, 80 sale; vuelve 120 ms después de soltar |
| Menús y ventanitas (`MENU`) | escala 0,96 → 1 + opacidad, desde su origen | 140 ms |
| Diálogos (`DIALOGO`) | escala 0,97 → 1 y 10 px de subida | resorte 480/36; salen en 120 ms |
| Aviso de herramienta | opacidad + 6 px; fundido cruzado al cambiar | 160 / 120 ms |
| Nota que se arrastra | escala 1,02, giro 1,2°, `--sombra-arrastre` | 120 ms; vuelve con resorte 500/30 |
| Conector nuevo | se dibuja de punta a punta | 220 ms |
| Encuadres (`setViewport`) | — | 420 ms |
| Plegar un proyecto | alto + opacidad (la excepción, en un elemento chico) | 200 ms |
| Cambio de tema | fundido de fondos y textos | 200 ms |

## Qué NO se anima

- Lo que el usuario está moviendo con la mano (sigue al puntero, sin retraso).
- El marco de selección (aparece al instante: se elige para hacer algo ya).
- Listas largas que aparecen (sin escalonados: frenan la lectura).
- Nada «para llamar la atención» que no responda a una acción o a un cambio que llegó de afuera.
- Al terminar de escribir en el celular, el zoom no vuelve atrás: «devolverlo marea» (`movil/lienzo/EdicionVisible.tsx`).

## «Reducir movimiento»

Lo pide el sistema (`prefers-reduced-motion`) o Configuración (`data-movimiento="reducido"`; con `"completo"` se anima
aunque el sistema pida menos). Se respeta en los tres lugares a la vez:

- **CSS:** `tokens.css` pone `--t-rapido`, `--t-medio` y `--t-lento` en 0. Por eso **las transiciones de CSS siempre usan
  esas variables**, nunca un `120ms` escrito a mano.
- **motion:** `App.tsx` envuelve todo en `<MotionConfig reducedMotion=…>`: quedan solo los fundidos.
- **JavaScript:** `movimientoReducido()` y `duracion(ms)` (devuelve 0): los encuadres del lienzo son instantáneos.
  Cualquier animación por código (por ejemplo el resorte propio de `movil/ui/deslizar.ts`) pregunta antes.

En las hojas del celular: aparecen con opacidad en 120 ms, sin deslizamiento.

## Teclado y foco (escritorio)

- **Todo se puede hacer con teclado.** El recorrido de prueba de la 0.2: crear una nota, escribirla, cambiarle el color,
  conectarla con el menú y deshacer todo, sin mouse.
- **Una tabla única de atajos:** [`web/src/util/atajos.ts`](../../web/src/util/atajos.ts). La usan la ayuda (`?`) y
  Configuración → Atajos. Si un atajo cambia en el código, cambia ahí en el mismo commit. Formato `"$mod+K"` (⌘ en Mac,
  Ctrl en el resto).
- **Atajos del lienzo:** `web/src/vistas/lienzo/atajos.ts`, suscritos **una vez** (con referencias a las funciones), no en
  cada render (era el problema E10 de la 0.1). Los de una sola tecla se pueden apagar (lector de pantalla, dictado), y
  nunca se disparan con el foco en un campo.
- **Convenciones de teclas ya tomadas:** `Ctrl/⌘+K` busca y hace todo; `Ctrl/⌘+Z` deshace (también borrados y
  archivados); `?` atajos; `Ctrl/⌘+,` Configuración; `Esc` sale un nivel (cierra el menú, después suelta la selección,
  después vuelve al lienzo); `Mayús+F10` menú contextual; `Alt+F10` va a la barra del objeto; `F2` renombra; una tecla de
  herramienta dos veces la deja fija; `Tab` recorre los objetos del lienzo en orden de lectura, marco por marco.
- **Foco visible siempre** (`:focus-visible`, anillo de 2 px). Las barras son `role="toolbar"` con foco itinerante.
- **Diálogos** con `ui/Dialogo.tsx`: foco atrapado, `Esc` cierra, el foco vuelve a donde estaba, `aria-labelledby` con el
  título.
- **Nombres para el lector de pantalla** en cada objeto del lienzo («Nota: Los clientes esperan…», «Marco Mecánicas, 8
  objetos») y en cada conector («Conector de «Cliente entra» a «¿Hay mesa?», etiqueta llega»).
- **Avisos en vivo** (`aria-live="polite"`) para el aviso de herramienta y para «Deshecho: …».

## Deshacer: parte de la interacción, no un extra

Todo cambio de un objeto pasa por la tienda (`web/src/estado/tienda.ts`) y registra un paso en
`web/src/estado/deshacer.ts` (cómo volver y cómo repetirse). Las acciones compuestas (crear un objeto y conectarlo,
convertir una nota en tarjeta) van en **un solo paso** con `enUnPaso(etiqueta, fn)`. Un texto vacío que se descarta
enseguida no deja un paso (`creo` + `olvidarCreacion`). Si agregás una acción y no se puede deshacer, no está terminada.

## Interacción del lienzo: decisiones que no se vuelven a discutir

- **Una sola barra contextual** para la selección (ver el caso completo en [componentes y flujos](05-componentes-y-flujos.md#caso-1-la-barra-contextual-única)).
- **La selección y los controles miden lo mismo con cualquier zoom**: variable CSS `--z` escrita directo al DOM
  (`scale: calc(1 / var(--z))`; borde de `calc(1.5px / var(--z))`). Un marco de 1,5 px y manijas de 9 px, siempre.
- **Crear con clic o con arrastre**, con fantasma bajo el cursor y la etiqueta de medidas.
- **Soltar un conector en el aire abre «Crear y conectar»**; soltarlo sobre cualquier parte de un objeto conecta; un clic
  en un punto de conexión crea «el siguiente paso».
- **Los puntos de conexión no parpadean**: aparecen con demora, no al instante al cruzar el lienzo (E4).
- **Encuadres que respetan la interfaz:** «ir al marco» descuenta las barras flotantes (el título nunca queda tapado: E2).
- **Imanes** al mover; mantener `Ctrl/⌘` los apaga. `Mayús` mantiene la proporción, `Alt` redimensiona desde el centro.
