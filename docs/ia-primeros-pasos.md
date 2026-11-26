# La IA dentro de Telar: primeros pasos

Para el dueño. Con esto, `@claude` en una tarjeta le contesta solo, ahí mismo, con su nombre en la actividad, con tope de gasto y
con permisos. Nada gasta hasta que cargás una clave tuya. **La clave la pegás en Telar (Configuración → IA), nunca en un chat.**

Los nombres de los botones pueden cambiar un poco; el camino es siempre Configuración → IA.

## 1. Cargar la clave de Anthropic

1. Sacá una clave de API en la consola de Anthropic (console.anthropic.com → API keys). Es distinta de tu suscripción de Claude: la
   API se paga aparte, por uso.
2. Recomendado: en esa misma consola poné un **límite de gasto mensual** (por ejemplo USD 30). Es el segundo cinturón, por afuera de
   Telar.
3. En Telar: Configuración → IA → **Claves** → agregar → proveedor **Anthropic**, un nombre («Anthropic») y la clave.
4. Telar la **prueba antes de guardarla**: si la rechaza, no guarda nada y te dice por qué. Si anda, queda «termina en …1234» y se
   guarda cifrada (la clave no vuelve a mostrarse en ninguna pantalla, evento ni registro).

## 2. Crear el agente «Claude»

Configuración → IA → **Agentes** → agregar agente:

- **Nombre:** Claude (si ya existe un «Claude» que entra por MCP, es el mismo: no se duplica y conserva su `@claude`).
- **Proveedor y modelo:** Anthropic, **Claude Opus 5.5** (`claude-opus-5-5`). Una respuesta simple cuesta unos USD 0,07.
- **Clave:** la que cargaste.
- **Qué puede hacer:** de fábrica puede comentar, trabajar con tarjetas y con el lienzo. Archivar, el sistema de diseño y leer código
  los prendés vos. «Pedime confirmación» viene en «solo lo delicado» (archivar, sacar cosas del lienzo, tocar muchas tarjetas, traer una imagen de afuera).
- **Topes:** **USD 10 por mes para el agente** y **USD 25 por mes para toda la cuenta** (son los de fábrica; se cambian en
  Configuración → IA → Gasto).

Si el modelo no figura en la lista de Telar, pide que escribas su precio por millón de tokens: sin precio el tope no podría frenar el
gasto y el agente no se activa.

## 3. Opcional: que lea el código (GitHub, solo lectura)

1. En GitHub: Settings → Developer settings → Fine-grained personal access tokens → crear uno que vea **solo el repo** que quieras
   (por ejemplo `<usuario>/<repo-del-juego>`) con el permiso **Contents: Read-only**. Nada más: Telar nunca escribe en un repo.
2. En Telar: Configuración → IA → **Código (GitHub)** → pegar el token (se prueba con una llamada mínima de lectura) y escribir los
   repos permitidos como `dueño/repo`. Los repos de tus proyectos ya cuentan.
3. En el agente, prendé el permiso **Código**. Así, un `@claude` que nombra `juego3d/ui/barrio.js` lee ese archivo (hasta 12 lecturas y 150 KB
   por pedido; los archivos de claves y `.env` no se leen nunca).

## 4. Probar con una mención

1. Abrí una tarjeta cualquiera y comentá: `@claude ¿qué falta para cerrar esto?`
2. Enseguida aparece «Claude está pensando…» y, en unos segundos, su respuesta como un comentario de la tarjeta, con su nombre.
3. Lo que hizo (comentó, movió, creó) queda en la actividad firmado por él, y en el pie de la respuesta ves el costo.
4. Configuración → IA → Gasto muestra lo que va del mes por agente.

Si algo delicado pide permiso, te llega un aviso en la campana: **Permitir** o **No**. Con la clave del MCP no se puede permitir
nada (a propósito): hace falta tu sesión.

## 5. Cómo pausar todo

- **Un pedido en marcha:** «Frenar» en la respuesta (también anda con la clave del MCP).
- **Un agente:** apagarlo en Configuración → IA → Agentes. No se borra.
- **Toda la IA de la cuenta:** Configuración → IA → Gasto → **Pausar toda la IA**. Las menciones nuevas esperan sin perderse.
- **Por tope:** al 80 % te avisa una vez; al 100 % los pedidos quedan «pausados por tope» sin perder nada. Subís el tope y los
  **reanudás** vos (no se reanudan solos, ni al cambiar de mes).

## 6. El cron (para que nada se trabe)

Un pedido que se corta (se reinició el servidor, se cayó la red) lo retoma solo, sin repetir lo que ya hizo. Eso lo cubre un cron de
Vercel que corre cada minuto. Necesita una variable en Vercel, `CRON_SECRET`, con un valor al azar que nadie ve (Claude la crea, vos no
tenés que correr nada) y el plan Pro de Vercel para correr cada minuto. Sin ella todo anda igual, pero un pedido trabado espera a que
vuelvas a abrir Telar para retomarse.

## 7. Si algo falla

| Qué ves | Qué pasó | Qué hacer |
|---|---|---|
| «No tiene clave» al mencionar | El agente no tiene una clave elegida | Elegila en el agente; después **Reintentar** en la mención pendiente |
| «Su clave no anda» | Anthropic rechazó la clave (vencida, borrada o sin saldo) | Probala en Claves o cargá otra; **Reintentar** |
| «Pausado por tope» | Llegó a un tope (del pedido, del agente o de la cuenta) | Subí el tope si querés y **Reanudar** |
| «Telar no conoce el precio de …» | Un modelo que no está en la lista | Escribí el precio a mano en el agente (si es local y gratis, poné 0) |
| «Falta el secreto del servidor» | No está `TABLERO_SECRETO_IA` ni `TABLERO_SECRETO` en Vercel | Se lo avisás a Claude: lo carga en Vercel |
| El pedido se corta o tarda | Sobrecarga del proveedor: se reintenta solo a los 5, 20 y 60 segundos | Esperá; si falla, queda «fallado» con el motivo y podés reintentar |
| «Esa dirección no salió del tablero ni del pedido» | El modelo armó una dirección con datos adentro: Telar la frenó | Nada: es la protección funcionando |
| Comentaste con `@claude` con la clave del MCP y no pasó nada | A propósito: lo que gasta exige tu sesión | Comentá desde la app, entrando con tu cuenta |

## 8. Las pruebas con la clave de verdad (las corre Claude, con tu OK)

Solo después de publicar y con tu permiso, porque gastan (centavos). La clave la guardás vos en el entorno de Claude Code, no en el chat:

1. `node scripts/probar-ia-real.mjs --solo-contar`: **gratis**. Cuenta los tokens reales de lo que Telar le manda al modelo y deja
   anotado el número en el plan (Anexo C).
2. `node scripts/probar-ia-real.mjs`: tres pedidos chicos con Haiku (menos de un centavo), **con tope duro de USD 1**: si la cuenta
   dice que se pasaría, se corta antes de pedir.
3. `npm run ia:probar-codigo-real -- --repo dueño/repo`: lee un repo con un token de solo lectura. No gasta IA.

Sin clave en el entorno, estos scripts no hacen nada y lo dicen. `npm run ia:probar-real-simulado` hace el mismo recorrido sin clave y
sin red.
