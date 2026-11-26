# El criterio de Telar

Esto es para cualquier agente (Claude, Codex, OpenCode con DeepSeek o GLM, ChatGPT, Grok…) que vaya a diseñar o programar
Telar. La meta: que el dueño **no note la diferencia** entre una sesión y otra. Lo que hay acá no es una guía de estilo
genérica: sale del código y de las decisiones que ya están en los commits y en los planes, con los archivos donde se ve.

La entrada corta y las reglas duras están en [`AGENTS.md`](../../AGENTS.md). Leela primero.

## Cómo se lee

| # | Documento | Para qué |
|---|---|---|
| 1 | [Producto y criterio](01-producto.md) | Para quién es Telar, cómo se decide y cómo se habla con el dueño |
| 2 | [Sistema visual](02-sistema-visual.md) | Tokens, temas, letra, espacios, radios, sombras, íconos, densidad y estados |
| 3 | [Movimiento e interacción](03-movimiento-e-interaccion.md) | Duraciones, curvas, qué se anima, «reducir movimiento», teclado y foco |
| 4 | [Celular y táctil](04-celular-y-tactil.md) | Gestos, hojas, teclado en pantalla, zonas seguras, tamaños táctiles |
| 5 | [Componentes y flujos nuevos](05-componentes-y-flujos.md) | El método paso a paso, con tres casos reales contados en detalle |
| 6 | [Arquitectura y código](06-arquitectura-y-codigo.md) | Estructura, estado, servidor, MCP, base, rendimiento, accesibilidad, nombres, commits |
| 7 | [Pruebas y verificación](07-pruebas.md) | Typecheck, build, pruebas del MCP, capturas, medir antes de dar por hecho |
| 8 | [Agentes en paralelo y entregas](08-agentes-y-entregas.md) | Worktrees, briefs, informe corto, qué no se probó |
| 9 | [Lista de chequeo](09-lista-de-chequeo.md) | Antes de cada commit y de cada publicación |

Si tenés poco tiempo: 1, 5 y 9. Si vas a tocar la interfaz: 2, 3 y 4 también. Si vas a tocar el servidor o el MCP: 6 y 7.

## La idea en cinco líneas

1. **El porqué primero.** Cada decisión tiene un motivo escrito (en el código, en el commit, en el plan). Si no lo podés
   escribir en una línea, todavía no entendiste el problema.
2. **Medir, no suponer.** Los planes están llenos de números medidos (px, ms, KB, cuadros por segundo). Se mide el antes
   y el después.
3. **Una sola pieza para cada cosa.** Una barra contextual, un catálogo de movimiento, un molde de estado vacío, un
   `definir()` para el MCP, una tabla de atajos. Nada de variantes sueltas.
4. **Pensado para el dueño:** no es programador, usa la PC y el celular, y lo que más valora (el Kanban) no se rompe.
5. **Terminado es probado.** Nunca «listo» sin pruebas, y siempre decir qué no se probó.

## Mantener esto al día

Si una decisión nueva cambia lo que dice un documento de acá, se cambia el documento en el mismo commit. Si algo de acá
contradice al código, manda el código y se corrige el documento (y se avisa en el informe).
