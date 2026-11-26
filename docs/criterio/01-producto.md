# 1. Producto y criterio

## Para quién es

Telar es **de una persona**: el dueño (Facundo). Lo usa para ordenar sus proyectos (el primero, Restaurant City; vienen
Yaguar, Brain OS, campañas). No es un producto de equipo ni de mercado: no hay colaboración en vivo entre humanos, no hay
roles, no hay planes. El «otro» que trabaja en el tablero es **la IA**, por MCP, y el dueño lo ve en vivo.

Consecuencias que ya están en el código y en los planes:

- **El dueño no es programador.** Todo lo que ve está en castellano rioplatense («hacé clic», «arrastrá», «elegí»), sin
  jerga («Sacar del lienzo», no «Delete node»). Nunca se le pide que corra comandos ni que pegue claves.
- **Usa la PC y el celular** (y la PWA instalada). Lo que se hace en una pantalla tiene que verse igual en la otra (por eso
  el fondo y la grilla del lienzo se guardan en el tablero y no en el navegador: `plan-v0.2-escritorio.md`, decisión F9).
- **La IA es un usuario de primera.** Todo lo que hace una persona tiene su herramienta MCP (`plan-diseno.md`, D8), y lo
  que hace la IA queda firmado en la actividad y aparece con un destello.
- **La IA entra por MCP o corre adentro como agente de una cuenta:** con la clave de esa cuenta, con las mismas
  herramientas del MCP, con tope de gasto, con permisos y con su nombre en la actividad. Telar no trae IA propia ni clave
  propia: una sola puerta (el catálogo de herramientas) y nada escondido. Plan y porqué:
  [`plan-ia-integrada.md`](../plan-ia-integrada.md) (decisión D1).
- **Nada se borra de verdad.** Se archiva, y se deshace. El dueño tiene que poder probar sin miedo.

## Lo que distingue a Telar

1. **El porqué de cada tarjeta** (motivo, contexto, opciones, decisión, consecuencias, evidencias). Es la idea central: en
   el celular sube arriba en la tarjeta (`plan-v0.2-movil.md`, decisión 5); en el lienzo, la tarjeta expandida lo muestra
   (`plan-v0.2-escritorio.md`, F8); en Diseño, un cambio vuelve como tarjeta con su porqué (`plan-diseno.md`, D3).
2. **El Kanban que al dueño le encantó.** Es lo que no se rompe: en la 0.2 la regla 1 del plan de escritorio prohibía tocar
   `kanban.css`, `tarjeta.css`, `detalle.css`, `vistas/kanban/**` y `vistas/tarjeta/**` salvo cambios nombrados línea por
   línea, con capturas de base antes y comparación al final (grupo A de capturas).
3. **El MCP pensado para que un modelo acierte a la primera** (sección 6 de [arquitectura](06-arquitectura-y-codigo.md#mcp)).

## Cómo se decide

Las decisiones de producto **las toma el agente**. Al dueño se le consulta solo lo que **gasta plata** o **toca otro
proyecto** (el juego, su base, su Discord). No se le pregunta «¿preferís A o B?» sobre un botón: se decide con este
criterio y se le muestra el resultado.

El método que usan los planes (imitalo):

1. **Diagnóstico con lo que dijo el dueño, textual, al lado de lo que se ve y de dónde está en el código.** Ver la tabla
   D1–D11 de `plan-v0.2-escritorio.md` («Me usaste como un naranja, medio extraño» → tres fuentes de naranja en
   `tokens.css`) o la D1–D15 de `plan-v0.2-movil.md`, con medidas («`.lateral` = 248 px de 393»).
2. **Decisiones numeradas con su porqué** en una tabla (F1–F11, las 10 del celular, D1–D12 de Diseño). Lo decidido no se
   vuelve a discutir; lo que hay que comprobar en el código se marca **(verificar)**.
3. **Comparar opciones con datos** cuando la decisión pesa (TipTap contra Lexical contra propio: licencia, peso gzip,
   madurez, teclados, mantenimiento; `plan-v0.2-escritorio.md`, 2.2). Elegir y decir qué se resigna.
4. **Prioridad y esfuerzo** (P0/P1/P2; S/M/L/XL) y un orden de corte: si no se llega, se corta de abajo hacia arriba.
5. **Lo que queda afuera, y por qué** (sección 14 del plan de escritorio, 15 del celular y de Diseño). Decir «no» con
   motivo es parte del diseño: «Colores libres (selector hexadecimal): los 10 colores con sus tonos cambian bien entre
   claro y oscuro; un hexadecimal no».
6. **Terminado cuando:** criterios verificables y capturas con nombre (B1–B38, C1–C13…).

Preguntas que se hace el agente antes de decidir:

- ¿Qué vio el dueño, en qué dispositivo, y qué esperaba ver?
- ¿Cómo lo resuelven Miro, FigJam, Trello, Linear o Figma? (`docs/investigacion.md` ya tiene mucho). Copiar el gesto que
  la gente ya conoce, no el arte.
- ¿Rompe algo que el dueño aprobó (Kanban, marca, tema)?
- ¿Sirve igual en el celular y por MCP?
- ¿Es la versión más simple que resuelve todo el problema? ¿Qué dejo afuera a propósito?

## Cómo se habla con el dueño

- **Corto y concreto.** Lo justo: qué cambió en sus palabras, qué tiene que mirar, qué falta. Nada de informes largos.
- **Un tema por vez.** Si hay tres cosas para decirle, se dicen en orden de importancia y en líneas separadas.
- **Castellano rioplatense** (vos, tenés, mirá). Sin anglicismos que se puedan evitar («subir», no «pushear»; «publicar»,
  no «deployar»).
- **Sin pedirle trabajo técnico.** No «corré `npm run dev`»: se le da el link o la captura.
- **Preguntar solo lo que es suyo:** plata (con cotización corta: qué, cuánto, cuánto queda), otro proyecto, o un gusto
  que no se puede inferir (y aun así, con una propuesta concreta para que diga sí o no).
- **Contar lo que no se probó.** Siempre.

Ejemplo de informe bien hecho (forma, no contenido):

> Arreglé el teclado del lienzo en el celular: ya no se cierra solo al escribir una nota.
> Probado en Chrome de Android emulado (toques reales). No probado en un iPhone de verdad.
> Para mirar: agregá una nota abajo del todo del lienzo y escribí.

## Proyectos y contenido del dueño

- El proyecto RC es contenido del dueño: el «Mapa del juego» y la paleta de Diseño se hicieron **por etapas, con su sí en
  cada paso** (`docs/proxima-sesion.md`).
- **Nunca** arte original de Restaurant City en el repo ni en lo estático (perfil de importación con `excluir`, regla de
  `.gitignore` para `docs/capturas/diseno/rc-*`).
- Lo que llega de Discord se convierte en tarjetas con la respuesta lista, pero **nada sale de Telar sin el sí del dueño**.
