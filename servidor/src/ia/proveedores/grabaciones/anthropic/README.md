# Grabaciones del adaptador de Anthropic

**Estas grabaciones están HECHAS A MANO, a partir de la documentación oficial de la API de Messages** (formato de los
eventos de streaming y de los errores, verificada el 25/11/2026), **y hay que validarlas con la prueba real.** No son
respuestas que haya devuelto la API de verdad: quien las escribió no tenía una clave. Sirven para que las pruebas de
contrato (`../../contratos.prueba.ts`) corran sin red y sin gastar, pero **hasta que alguien las compare con la API real
no prueban que el adaptador funcione contra Anthropic**, solo que cumple lo que la documentación dice.

## Cómo se validan

Con una clave del entorno (la pone el dueño, nunca en un archivo ni en el chat):

```bash
ANTHROPIC_API_KEY=… node scripts/probar-ia-real.mjs --solo-contar      # no gasta
ANTHROPIC_API_KEY=… node scripts/probar-ia-real.mjs --modelo claude-haiku-5-5 --grabar
```

`--grabar` guarda lo que la API devolvió de verdad en `real/` (sin la clave y sin ids de cuenta ni de organización).
Después se compara con estas: si una real difiere de la hecha a mano (un campo que no está, un evento que no se
contempló), se corrige el adaptador y se reemplaza la grabación, y este archivo deja de decir «a mano» para ese caso.

## Formato

Un archivo por caso (`<caso>.json`):

```jsonc
{
  "caso": "reenvio",
  "descripcion": "…",
  "origen": "Hecha a mano de la documentación …",
  "esperado": { … },          // lo que el adaptador tiene que devolver (corte, texto, llamadas, uso) o el error (tipo, reintentable, esperarMs)
  "intercambios": [           // los pedidos que se esperan, en orden, y lo que contesta la API a cada uno
    {
      "pedido": { "metodo": "POST", "ruta": "/v1/messages", "cuerpo": { … } },   // el cuerpo es un SUBCONJUNTO: lo que tiene que estar
      "respuesta": { "estado": 200, "cabeceras": { … }, "eventos": [ { "event": "message_start", "data": { … } }, … ] }
      //            o { "estado": 429, "cabeceras": { "retry-after": "30" }, "cuerpo": { … } }
      //            o { "red": true }   (no hay conexión)
    }
  ]
}
```

`{{CLAVE}}` dentro de una grabación se reemplaza por la clave de prueba al cargarla (el caso `error-401-eco` comprueba que
una clave repetida por la API tampoco sale en ningún error).

## Casos

| Archivo | Qué cubre |
|---|---|
| `texto` | solo texto, con un bloque de pensamiento omitido, `end_turn` |
| `herramienta` | una llamada a herramienta; el uso final completo viene en `message_delta` |
| `dos-herramientas` | dos `tool_use` en un mismo paso |
| `reenvio` | dos pedidos: el segundo reenvía el mensaje del asistente (con pensamiento y firma) byte por byte |
| `resultado-con-imagen` | un `tool_result` con una imagen en base64 |
| `cache` | uso que escribe y lee caché |
| `largo`, `largo-herramienta-cortada` | corte por `max_tokens`, también en medio de los argumentos de una herramienta |
| `json-roto` | argumentos de herramienta con JSON roto |
| `rechazo`, `pausa` | `refusal` (con `stop_details`) y `pause_turn` |
| `error-401`, `error-401-eco`, `error-403` | clave rechazada (y una respuesta que repite la clave) |
| `error-429`, `error-429-corto` | límite con espera larga (se devuelve) y corta (se reintenta una vez) |
| `error-529`, `error-500`, `error-en-el-flujo` | sobrecarga y fallos del proveedor, también a mitad del flujo |
| `error-400`, `error-404-modelo` | pedido mal armado, modelo que no existe |
| `error-saldo`, `error-limite-gasto` | sin crédito y límite de gasto de la Console (400) |
| `error-flujo-cortado`, `error-red` | la conexión se corta antes de `message_stop`, o no hay conexión |
| `probar-ok`, `probar-401` | `GET /v1/models` con una clave buena y una mala |

Lo que **no** está grabado y se valida solo con la prueba real: el streaming con bloques `server_tool_use` o de citas (Telar
no los usa), imágenes enormes, el comportamiento exacto del control de historial ante un reenvío distinto, y la beta
`thinking-binding-controls-2026-08-01`.
