# 9. Lista de chequeo

Copiala y marcala. Si algo no aplica, tiene que ser porque de verdad no aplica.

## Antes de cada commit

**Problema y decisión**
- [ ] Entiendo el problema como lo dijo el dueño y lo reproduje (o sé por qué no hace falta).
- [ ] Encontré la causa (todas las causas) en el código, con archivo y línea.
- [ ] Usé o extendí una pieza existente; no dejé una pieza vieja conviviendo con la nueva.

**Interfaz** (si se ve)
- [ ] Solo tokens de `tokens.css` (color, sombra, radio, curva, duración). Ningún hexadecimal ni `120ms` suelto.
- [ ] Sin contornos de interfaz.
- [ ] Los nueve estados: reposo, hover, foco, apretado, activo, deshabilitado, vacío, cargando, error.
- [ ] Claro y oscuro. Contraste AA (`node scripts/contraste.mjs` si toqué colores).
- [ ] Movimiento del catálogo (`util/movimiento.ts`), solo `transform` y `opacity`, ≤ 260 ms (encuadres 420).
- [ ] «Reducir movimiento» respetado (CSS con `--t-*`, motion con `MotionConfig`, JS con `movimientoReducido()`).
- [ ] Teclado: se llega, se usa y se sale; foco visible; `Esc` sale un nivel; atajos en `util/atajos.ts`.
- [ ] Lector de pantalla: `role`, `aria-label`, `aria-pressed`/`aria-current`; el color nunca solo.
- [ ] Blancos de 32 px (escritorio) y 44 (táctil), con 8 px entre ellos.
- [ ] Textos en castellano rioplatense, cortos, que dicen de dónde viene cada cosa.
- [ ] Celular: funciona con el dedo, con el teclado en pantalla abierto, acostado y en las zonas seguras; o avisa que se
      hace en la computadora.
- [ ] El Kanban de escritorio no cambió (si toqué algo compartido, lo comparé con capturas).

**Datos y lógica**
- [ ] Los cambios pasan por la tienda (web) y por `servicio.ts` (servidor), con actividad y evento en vivo.
- [ ] Se puede deshacer; lo compuesto va en `enUnPaso`.
- [ ] Nada se borra de verdad: se archiva o se saca del lienzo, y se deshace.
- [ ] Si hay migración: aditiva, se puede correr dos veces, con RLS; la versión publicada sigue andando con la base migrada.
- [ ] Si la IA puede hacerlo: hay herramienta MCP con las reglas de `mcp/comun.ts` (nombre, esquema estricto, ejemplo,
      errores que enseñan, `readOnlyHint` honesto) y la guía está al día (`npm run guia`).

**Código**
- [ ] Nombres en castellano que dicen lo que son; comentario de cabecera con el porqué; constantes con nombre y unidad.
- [ ] TypeScript estricto, sin `any` nuevo sin explicar. No reformateé archivos que no toqué.
- [ ] Dependencia nueva: justificada por licencia y peso (o no hay).
- [ ] Ningún archivo con claves, `.env`, datos del dueño ni material de Restaurant City.

**Pruebas**
- [ ] `npm run typecheck` sin errores.
- [ ] `npm run build` sin errores (y `build:vercel` si toqué servidor o empaquetado); pesos dentro del presupuesto.
- [ ] Las pruebas que tocan (`probar-mcp`, `diseno:probar-mcp`, `guia --verificar`, capturas, medición).
- [ ] Miré las capturas.

**Commit**
- [ ] Un tema. Título en castellano que dice qué cambió para quien usa la app, con su área.
- [ ] Cuerpo con problema, causa, decisión y porqué, medidas y cómo se probó.
- [ ] Las líneas de atribución que pide la sesión.

## Antes de cada publicación

- [ ] La publicación la pidió la tarea o la autorizó el dueño **ahora** (y no soy un agente en paralelo).
- [ ] Todo mezclado en `main` y probado junto (typecheck, build, `probar-mcp`, capturas de lo que cambió).
- [ ] Si hay migración nueva: aplicada online **antes**, como `tablero_app`, solo en el esquema `tablero`, anotada en
      `tablero.tablero_migraciones`, con permiso.
- [ ] Variables nuevas de Vercel: cargadas por el dueño o con su permiso; nunca en el repo.
- [ ] `npm run build:vercel` y `npx vercel deploy --prebuilt --prod`.
- [ ] Después: la web abre, `/api/salud` dice la versión nueva, una lectura por MCP anda. Sin pruebas que escriban en RC.
- [ ] Si cambiaron herramientas MCP: avisar que en ChatGPT hay que refrescar la app para que las vea.
- [ ] Informe al dueño: qué cambió para él, qué mirar, qué no se probó.
- [ ] `docs/proxima-sesion.md` al día si quedó algo pendiente.
- [ ] No queda nada mío corriendo.
