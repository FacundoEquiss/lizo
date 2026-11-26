# Grabaciones de los adaptadores (B2: OpenAI, DeepSeek, Gemini)

**Hechas a mano de la documentación oficial, a validar con la prueba real.** No hay ninguna respuesta real acá: no se llamó
a ninguna API (no hay claves). Cada archivo trae su `fuente` (la página oficial de donde sale la forma) y su `descripcion`.

- `openai/`: la API **Responses** (streaming de eventos `response.output_item.done`, `response.completed` / `incomplete` /
  `failed`, ítems `reasoning` con `encrypted_content`, `function_call` con `call_id`, uso con `cached_tokens` y
  `cache_write_tokens`). Fuentes: `developers.openai.com/api/docs/guides/{function-calling,migrate-to-responses,prompt-caching}`.
- `deepseek/`: Chat Completions de DeepSeek (`reasoning_content`, `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`,
  `finish_reason: insufficient_system_resource`, error 402). Fuentes: `api-docs.deepseek.com/guides/{thinking_mode,tool_calls}`.
- `gemini/`: el punto compatible con OpenAI de Google (`/v1beta/openai/`): llamadas **sin `index`**, firma de pensamiento en
  `extra_content.google.thought_signature`, errores en lista con `RESOURCE_EXHAUSTED` y `retryDelay`. Fuente:
  `aistudio.google.com/docs/openai` y `/docs/api-errors`.

Lo que **no** está confirmado por la documentación y se armó por conocimiento del comportamiento de esos servicios (hay que
confirmarlo con la prueba real, `scripts/probar-ia-real.mjs`, tarea 6.5 del plan):

1. el nombre exacto del campo de la firma de pensamiento de Gemini en el formato compatible (`extra_content.google.thought_signature`);
2. que Gemini mande las llamadas sin `index`, y que `completion_tokens` no incluya el pensamiento;
3. el texto de los errores (la clasificación mira códigos y estados, no frases, salvo «no admite herramientas» y «stream_options»);
4. los eventos de streaming de Responses: la documentación nombra `response.output_item.done` y `response.completed`; la forma de
   `response.incomplete` y de `response.failed` se tomó del esquema de la respuesta (`status`, `incomplete_details.reason`, `error`);
5. que `cache_write_tokens` venga dentro de `input_tokens_details` también con `store: false`.

El marcador `${CLAVE}` de algunos errores (los 401) lo reemplaza la prueba por la clave de prueba: así se verifica que, aunque el
proveedor repita la clave en su mensaje, no aparece en ningún error ni registro.

Para regenerarlas a mano, editar los JSON. Cuando se hagan con una clave real (`--grabar`), se reemplazan y se borra este aviso.
