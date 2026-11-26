# 8. Agentes en paralelo y entregas

## Trabajar en paralelo sin pisarse

Telar se hizo con varios agentes a la vez (la 0.2 de escritorio, la del celular y Diseño fueron en paralelo). Lo que
funcionó:

- **Un worktree por agente**, desde `main` actualizada:
  ```bash
  git -C /ruta/a/telar worktree add ../telar-<tema> -b <tema> main
  ```
  (o en `.claude/worktrees/`, que está en `.gitignore`). Cada agente trabaja **solo** en su carpeta.
- **Puertos y datos propios** por agente (`TABLERO_DATOS=/tmp/telar-<tema> TABLERO_PUERTO=… TABLERO_PUERTO_WEB=…`): PGlite
  no admite dos procesos sobre la misma base, y el puerto hace de candado.
- **Dueños de archivos claros.** El contrato entre el plan de escritorio y el del celular (sección 11 del de escritorio,
  12 del celular) decía quién era dueño de qué: el celular de `web/src/movil/**`, `movil.css`, la PWA e `index.html`; el
  escritorio de todo lo demás. Lo compartido se pide como **prop nueva con valor por defecto igual a lo de hoy**. Diseño
  vivió en carpetas propias y nombró exactamente lo compartido que tocaba (plan de Diseño, 8.2).
- **Lo que tocan los dos** (`tienda.ts`, `compartido/tipos.ts`) se prepara primero en un paquete común (PT-0) y después
  cada uno agrega sin reescribir.
- **Nadie publica desde un agente en paralelo, ni hace push si no se lo pidieron.** Publica quien junta, después de
  mezclar y probar todo junto.
- **Al terminar, no queda nada corriendo** (servidores de prueba, navegadores, `watch`): se cierran.

## El brief (cómo se le encarga algo a otro agente)

Un buen brief para un agente de Telar tiene, en este orden:

1. **El contexto mínimo:** repo, rama de partida, nombre del worktree y de la rama nueva, qué no tocar.
2. **Qué leer antes:** `AGENTS.md`, la parte de `docs/criterio/` que aplica, el plan o el commit relacionado.
3. **El problema en palabras del dueño** (textual) y dónde se ve.
4. **Qué entregar y cuándo está terminado** (criterios verificables, capturas con nombre, números a medir).
5. **Límites:** qué archivos son suyos, qué no se publica, qué gasta plata (no), qué toca otro proyecto (no).
6. **Cómo entregar:** commits en su rama con el estilo de la casa y un informe corto.

Los planes de la 0.2 son el ejemplo grande: «Este plan lo ejecuta otro agente **tal cual**. Cada punto trae: el problema,
el porqué de la solución, el diseño con medidas, la implementación con archivos, y cómo darlo por terminado.»

## Cómo se entrega

**Informe corto**, para que el que junta (o el dueño) lo lea en un minuto:

1. **Qué cambió**, en una o tres líneas, en palabras de quien usa la app.
2. **Archivos y commits** (rama, hashes).
3. **Qué se probó y cómo** (comandos, dispositivos, números medidos).
4. **Qué NO se probó** (siempre hay algo: el teléfono real, producción, un caso raro).
5. **Qué falta o qué encontraste** fuera del pedido (como pendiente, no arreglado de paso si es otro tema).

Reglas:

- **Nunca decir «listo», «anda» o «arreglado» sin la prueba que lo muestra.** «Debería andar» no es una entrega.
- **No esconder lo que falló.** Si una prueba falla desde antes (el paso 30 de `capturas-movil.mjs`), se dice.
- **Al dueño, todavía más corto**: qué cambió para él, qué mirar y dónde (link), qué falta. Sin comandos ni jerga.
- Si quedó algo para la próxima sesión, va en `docs/proxima-sesion.md`.

## Cuando algo no se puede hacer

Decirlo con el motivo y la alternativa, sin inventar. Si hace falta algo del dueño (plata, permiso, otro proyecto), se le
pregunta con una propuesta concreta y una cotización corta; mientras tanto se avanza con lo demás.
