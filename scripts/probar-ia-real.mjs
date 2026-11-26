// La prueba REAL mínima de la IA integrada (docs/plan-ia-integrada.md, 15.4): un pedido de verdad a Anthropic, con el mismo
// adaptador que usa el ciclo (servidor/src/ia/proveedores/anthropic.ts). OPCIONAL, y GASTA (centavos): la corre quien tiene
// la clave, con el sí del dueño. No va en ninguna integración automática.
//
//   node scripts/probar-ia-real.mjs --solo-contar                 cuenta los tokens de un juego de herramientas con la API: NO gasta
//   node scripts/probar-ia-real.mjs                               tres pedidos chicos: texto, una herramienta de lectura y el reenvío
//   node scripts/probar-ia-real.mjs --modelo claude-opus-5-5      con otro modelo (de fábrica, claude-haiku-5-5: menos de un centavo)
//   node scripts/probar-ia-real.mjs --grabar                      además guarda lo que la API devolvió de verdad como grabación
//   node scripts/probar-ia-real.mjs --simulado                    sin clave y sin red: el mismo recorrido contra el proveedor falso
//   npm run ia:probar-real -- --solo-contar                       (es lo mismo)
//
// LA CLAVE sale del ENTORNO de quien corre esto (ANTHROPIC_API_KEY): nunca de un archivo del repo, nunca del chat, y nunca se
// imprime (todo lo que sale pasa por el filtro de claves). Sin clave, se niega con un mensaje claro y sale sin error.
//
// TOPE DURO: USD 1 por corrida (--tope puede bajarlo, no subirlo). Antes de CADA pedido se calcula lo peor que podría costar
// (el tamaño del pedido a precio de escribir caché, más el máximo de salida; y, si fue más, lo que costó el más caro hasta
// ahora) y, si con eso se pasaría, la corrida se corta ANTES de hacerlo. El costo real de cada pedido se mide con los precios
// de servidor/src/ia/proveedores/precios.ts.
//
// Opciones: --modelo <id> · --solo-contar · --grabar · --simulado · --tope <USD> · --herramientas <archivo.json con DefHerramienta[]>
//           · --cinturon (prueba la beta drop_block) · --ayuda
//           · --url-base <http://127.0.0.1:puerto> (solo para probar este script contra un servidor local de mentira; nunca otra dirección)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { register } from 'tsx/esm/api'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const hay = (n) => args.includes(`--${n}`)
const valor = (n, defecto) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 || i === args.length - 1 || args[i + 1].startsWith('--') ? defecto : args[i + 1]
}

const TOPE_DURO_USD = 1
const MODELO_DE_FABRICA = 'claude-haiku-5-5'
const MAX_SALIDA = 2000
const CARPETA_REAL = path.join(RAIZ, 'servidor/src/ia/proveedores/grabaciones/anthropic/real')

if (hay('ayuda')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  process.exit(0)
}

register() // deja importar los .ts del servidor (el adaptador, los precios) desde este .mjs
const { crearProveedorAnthropic } = await import('../servidor/src/ia/proveedores/anthropic.ts')
const { crearProveedorFalso } = await import('../servidor/src/ia/proveedores/falso.ts')
const { costoUsd, precioDe } = await import('../servidor/src/ia/proveedores/precios.ts')
const { filtrarClaves } = await import('../servidor/src/ia/proveedores/filtro.ts')

const simulado = hay('simulado')
const soloContar = hay('solo-contar')
const grabar = hay('grabar')
const clave = simulado ? 'prueba-clave-simulada-0000' : (process.env.ANTHROPIC_API_KEY ?? process.env.TABLERO_IA_PRUEBA_ANTHROPIC ?? '').trim()
const modelo = valor('modelo', simulado ? 'guion:leer-y-responder' : MODELO_DE_FABRICA)
const urlBase = valor('url-base')

/** TODO lo que esta prueba imprime pasa por acá: sin la clave, ni nada con forma de clave. */
const decir = (s = '') => console.log(filtrarClaves(String(s), clave, process.env.ANTHROPIC_API_KEY, process.env.TABLERO_IA_PRUEBA_ANTHROPIC))
const usd = (n) => `USD ${n.toFixed(n < 0.01 ? 5 : 4)}`

// ───────────────────────── antes de empezar ─────────────────────────

if (simulado && grabar) {
  decir('--grabar guarda lo que devuelve la API de verdad: contra el proveedor falso no tiene sentido. Sacá --simulado o --grabar.')
  process.exit(1)
}
if (urlBase && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(urlBase)) {
  decir('--url-base solo acepta 127.0.0.1 o localhost (sirve para probar este script contra un servidor de mentira; la prueba real va a la API de Anthropic).')
  process.exit(1)
}
const topePedido = Number(valor('tope', String(TOPE_DURO_USD)))
if (!Number.isFinite(topePedido) || topePedido <= 0) {
  decir('--tope tiene que ser un número de dólares mayor que cero.')
  process.exit(1)
}
if (topePedido > TOPE_DURO_USD) {
  decir(`--tope no puede pasar de USD ${TOPE_DURO_USD} por corrida (es un tope duro del plan: 12.2).`)
  process.exit(1)
}
const TOPE = topePedido

if (!simulado && !clave) {
  decir('No hay clave de Anthropic en el entorno, así que no hago nada (no es un error).')
  decir('')
  decir('Esta prueba habla con la API de verdad. Solo --solo-contar es gratis; la otra gasta centavos (con Haiku 5.5, menos de uno).')
  decir('La clave la pone el dueño en el ENTORNO de quien corre esto, nunca en un archivo del repo ni en el chat:')
  decir('    ANTHROPIC_API_KEY=… node scripts/probar-ia-real.mjs --solo-contar')
  decir('Para probar el propio script sin clave y sin red: node scripts/probar-ia-real.mjs --simulado')
  process.exit(0)
}

const precio = precioDe(simulado ? 'falso' : 'anthropic', modelo)
if (!precio) {
  decir(`Telar no tiene el precio del modelo «${modelo}»: sin precio no se puede cuidar el tope. Los que conoce: claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5, claude-fable-5-2.`)
  process.exit(1)
}

// ───────────────────────── lo que se manda ─────────────────────────

const SISTEMA = [{ texto: 'Sos un agente de prueba de Telar. Respondé en castellano rioplatense, en una sola oración corta.' }]
const HERRAMIENTAS_DE_PRUEBA = [
  {
    nombre: 'leer_tarjeta',
    descripcion: 'Devuelve una tarjeta del tablero por su clave, con su título y su lista. Ejemplo: { "tarjeta": "RC-12" }',
    esquema: { type: 'object', properties: { tarjeta: { type: 'string', description: 'La clave de la tarjeta, por ejemplo RC-12.' } }, required: ['tarjeta'], additionalProperties: false },
  },
]
const TARJETA_DE_PRUEBA = { clave: 'RC-12', titulo: 'El mozo tropieza con las mesas', lista: 'Por hacer', prioridad: 'media' }

async function herramientasParaContar() {
  const archivo = valor('herramientas')
  if (archivo) return { nombre: path.basename(archivo), lista: JSON.parse(readFileSync(path.resolve(archivo), 'utf8')) }
  // sin archivo: todo el catálogo MCP de Telar tal como lo ve un modelo (el JSON Schema de cada esquema zod)
  const { z } = await import('zod')
  const { HERRAMIENTAS } = await import('../servidor/src/mcp/herramientas.ts')
  return { nombre: 'catálogo MCP completo', lista: HERRAMIENTAS.map((h) => ({ nombre: h.nombre, descripcion: h.descripcion, esquema: z.toJSONSchema(h.esquema) })) }
}

// ───────────────────────── --solo-contar: no gasta ─────────────────────────

if (soloContar) {
  const { nombre, lista } = await herramientasParaContar()
  // el tamaño siempre se mide con el formato de Anthropic (el del proveedor falso no lleva las herramientas enteras)
  const fijo = JSON.parse(crearProveedorAnthropic().prepararFijo({ sistema: SISTEMA, herramientas: lista, modelo }))
  const mensajes = [{ role: 'user', content: [{ type: 'text', text: 'Hola.' }] }]
  decir(`Contar tokens: ${lista.length} herramientas (${nombre}) con ${modelo}. ${simulado ? 'SIMULADO: estimado a 3 caracteres por token, no lo cuenta la API.' : 'Lo cuenta la API: no gasta.'}`)
  let conTodo, sinHerramientas
  if (simulado) {
    conTodo = Math.ceil(JSON.stringify({ ...fijo, messages: mensajes }).length / 3)
    sinHerramientas = Math.ceil(JSON.stringify({ system: fijo.system, messages: mensajes }).length / 3)
  } else {
    const { Anthropic } = await import('@anthropic-ai/sdk')
    const cliente = new Anthropic({ apiKey: clave, authToken: null, credentials: null, config: null, profile: null, maxRetries: 1, logLevel: 'off', openTelemetry: false, ...(urlBase ? { baseURL: urlBase } : {}) })
    try {
      conTodo = (await cliente.messages.countTokens({ model: modelo, system: fijo.system, tools: fijo.tools, messages: mensajes })).input_tokens
      sinHerramientas = (await cliente.messages.countTokens({ model: modelo, system: fijo.system, messages: mensajes })).input_tokens
    } catch (e) {
      decir(`No pude contar los tokens: http ${e?.status ?? '—'} ${e?.type ?? e?.name ?? 'error'}${e?.requestID ? ` (pedido ${e.requestID})` : ''}. Revisá la clave y el modelo.`)
      process.exit(1)
    }
  }
  const soloHerramientas = conTodo - sinHerramientas
  decir('')
  decir(`  Todo (instrucciones + herramientas + «Hola.»): ${conTodo} tokens`)
  decir(`  Sin las herramientas:                         ${sinHerramientas} tokens`)
  decir(`  Las herramientas solas:                       ${soloHerramientas} tokens (incluye las ~286 del sistema de herramientas de la API)`)
  decir(`  Escribirlas en caché (5 min) cuesta ${usd((conTodo * precio.cacheEscritura) / 1e6)}; leerlas del caché, ${usd((conTodo * precio.cacheLectura) / 1e6)} (precios de ${precio.verificado}).`)
  decir('')
  decir('Para el plan: las estimaciones de 9.7 suponen ~5.800 tokens de herramientas en el juego de «tarjeta» y ~4.700 de instrucciones.')
  process.exit(0)
}

// ───────────────────────── los tres pedidos ─────────────────────────

let fallas = 0
const verifica = (cond, que, detalle) => {
  if (!cond) fallas++
  decir(`  ${cond ? '✓' : '✗'} ${que}${!cond && detalle !== undefined ? `\n      ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle).slice(0, 400)}` : ''}`)
  return cond
}

const capturas = []
/** Lo que hay que guardar de cada intercambio con la API (solo con --grabar). */
const grabados = []
let pendientesDeLeer = []

function fetchQueGraba() {
  return async (entrada, init) => {
    const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url)
    const cuerpo = typeof init?.body === 'string' ? init.body : ''
    capturas.push({ ruta: url.pathname, cuerpo })
    const res = await fetch(entrada, init)
    if (grabar && res.body) {
      const copia = res.clone()
      pendientesDeLeer.push(
        copia.text().then((texto) => {
          const cabeceras = {}
          for (const k of ['request-id', 'retry-after']) if (res.headers.get(k)) cabeceras[k] = res.headers.get(k)
          const respuesta = { estado: res.status, cabeceras }
          if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
            respuesta.eventos = texto
              .split(/\r?\n\r?\n/)
              .map((bloque) => {
                const ev = /^event: (.*)$/m.exec(bloque)?.[1]
                const datos = /^data: (.*)$/m.exec(bloque)?.[1]
                return ev && datos ? { event: ev, data: JSON.parse(datos) } : null
              })
              .filter(Boolean)
          } else {
            respuesta.cuerpo = texto ? JSON.parse(texto) : {}
          }
          grabados.push({ pedido: { metodo: init?.method ?? 'GET', ruta: url.pathname, cuerpo: cuerpo ? JSON.parse(cuerpo) : undefined }, respuesta })
        }),
      )
    }
    return res
  }
}

const proveedor = simulado ? crearProveedorFalso() : crearProveedorAnthropic({ fetch: fetchQueGraba(), descartarPensamientoAjeno: hay('cinturon') })

let gasto = 0
let masCaro = 0
let pedidos = 0
const tiempos = []

/** Lo peor que podría costar el próximo pedido: entrada a precio de escribir caché + todo el máximo de salida; o lo más caro visto, si fue más. */
function peorCaso(fijo, historial) {
  const tokens = Math.ceil((fijo.length + historial.reduce((a, h) => a + h.length, 0)) / 3)
  const estimado = (tokens * Math.max(precio.entrada, precio.cacheEscritura) + MAX_SALIDA * precio.salida) / 1e6
  return Math.max(estimado, masCaro)
}

class CorteDeTope extends Error {}

async function pedir(titulo, fijo, historial, o = {}) {
  const peor = peorCaso(fijo, historial)
  if (gasto + peor > TOPE) {
    throw new CorteDeTope(`Corto ANTES del pedido «${titulo}»: llevo ${usd(gasto)} y este podría costar hasta ${usd(peor)}; el tope de la corrida es ${usd(TOPE)}.`)
  }
  const t = performance.now()
  const r = await proveedor.llamar({
    modelo,
    maxSalida: MAX_SALIDA,
    fijo,
    historial,
    clave,
    ...(urlBase ? { urlBase } : {}),
    senal: new AbortController().signal,
    leerImagen: async () => new Uint8Array(),
    ...o,
  })
  const ms = Math.round(performance.now() - t)
  const costo = costoUsd(precio, r.uso)
  gasto += costo
  masCaro = Math.max(masCaro, costo)
  pedidos++
  tiempos.push(ms)
  decir(`  · ${titulo}: ${ms} ms, ${r.uso.entrada} + ${r.uso.cacheEscritura} escritos + ${r.uso.cacheLectura} leídos de entrada, ${r.uso.salida} de salida → ${usd(costo)} (llevo ${usd(gasto)})`)
  if (gasto > TOPE) throw new CorteDeTope(`Me pasé del tope: llevo ${usd(gasto)} y el tope es ${usd(TOPE)}. Corto acá.`)
  return r
}

decir(`Prueba real mínima · ${simulado ? 'SIMULADA (proveedor falso, sin red)' : `Anthropic · ${precio.nombre} (${modelo})`}`)
decir(`Tope duro de la corrida: ${usd(TOPE)} · máximo de salida por pedido: ${MAX_SALIDA} · precios del ${precio.verificado}`)
decir('')

let cortada = null
const respuestas = {}
try {
  const fijoSolo = proveedor.prepararFijo({ sistema: SISTEMA, herramientas: [], modelo })
  const fijoConHerramientas = proveedor.prepararFijo({ sistema: SISTEMA, herramientas: HERRAMIENTAS_DE_PRUEBA, modelo })
  const usuario = (texto) => proveedor.aNativo({ rol: 'usuario', partes: [{ tipo: 'texto', texto }] }, { modelo })

  decir('1. Solo texto')
  respuestas.texto = await pedir('texto', fijoSolo, [usuario(simulado ? 'Sin tarjetas por acá: decime qué es Telar.' : 'Decime en una oración qué es un tablero Kanban.')])
  verifica(respuestas.texto.corte === 'fin', 'terminó con texto (corte «fin»)', respuestas.texto.corte)
  verifica(respuestas.texto.texto.trim().length > 0, 'trajo texto')
  verifica(respuestas.texto.uso.salida > 0, 'informó los tokens de salida', respuestas.texto.uso)
  verifica(typeof respuestas.texto.nativo === 'string' && JSON.parse(respuestas.texto.nativo), 'devolvió el mensaje del asistente para reenviarlo')

  decir('')
  decir('2. Una herramienta de lectura')
  const pregunta = usuario('Leé la tarjeta RC-12 con la herramienta leer_tarjeta y decime su título.')
  respuestas.herramienta = await pedir('herramienta', fijoConHerramientas, [pregunta])
  const llamo = respuestas.herramienta.llamadas.find((l) => l.nombre === 'leer_tarjeta')
  verifica(respuestas.herramienta.corte === 'herramientas', 'cortó para llamar a una herramienta', respuestas.herramienta.corte)
  verifica(Boolean(llamo), 'llamó a leer_tarjeta', respuestas.herramienta.llamadas.map((l) => l.nombre))
  verifica(!llamo?.invalida && llamo?.argumentos?.tarjeta === 'RC-12', 'con los argumentos bien: { tarjeta: "RC-12" }', llamo)

  if (llamo) {
    decir('')
    decir('3. El reenvío: el resultado vuelve al modelo con su mensaje anterior exacto')
    const resultado = proveedor.aNativo(
      { rol: 'herramienta', resultados: [{ id: llamo.id, nombre: llamo.nombre, esError: false, partes: [{ tipo: 'texto', texto: JSON.stringify(TARJETA_DE_PRUEBA) }] }] },
      { modelo },
    )
    respuestas.reenvio = await pedir('reenvío', fijoConHerramientas, [pregunta, respuestas.herramienta.nativo, resultado])
    verifica(respuestas.reenvio.corte === 'fin', 'terminó con texto', respuestas.reenvio.corte)
    verifica(/mozo/i.test(respuestas.reenvio.texto), 'la respuesta usa el título que leyó', respuestas.reenvio.texto.slice(0, 200))
    if (!simulado) {
      const ultimo = capturas[capturas.length - 1]
      verifica(Boolean(ultimo?.cuerpo.includes(respuestas.herramienta.nativo)), 'el mensaje del asistente se reenvió byte por byte (sin que la API lo rechace)')
    }
    decir(`  · caché en el reenvío: ${respuestas.reenvio.uso.cacheLectura} tokens leídos, ${respuestas.reenvio.uso.cacheEscritura} escritos ${respuestas.reenvio.uso.cacheLectura > 0 ? '(hay caché)' : '(sin caché: lo fijo puede ser menor al mínimo que se guarda)'}`)
  }
} catch (e) {
  if (e instanceof CorteDeTope) {
    cortada = e.message
    decir(`\n  ⛔ ${cortada}`)
  } else if (e?.tipo) {
    fallas++
    decir(`\n  ✗ La API falló: ${e.tipo}${e.reintentable ? ' (reintentable)' : ''}${e.esperarMs ? `, esperar ${e.esperarMs} ms` : ''}. ${e.paraLaPersona}${e.idPedido ? ` · pedido ${e.idPedido}` : ''}`)
  } else {
    fallas++
    decir(`\n  ✗ Error inesperado: ${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 300)}`)
  }
}

await Promise.all(pendientesDeLeer)

// ───────────────────────── lo que se midió ─────────────────────────

decir('')
decir('Resumen')
decir(`  Pedidos: ${pedidos} · tiempo por pedido (total, no hasta el primer token): ${tiempos.map((t) => `${t} ms`).join(', ') || '—'}`)
decir(`  Gasto medido con precios.ts: ${usd(gasto)} de ${usd(TOPE)}`)
if (respuestas.herramienta) {
  const u = respuestas.herramienta.uso
  decir(`  Tokens de lo fijo (instrucciones + 1 herramienta), primer pedido con herramientas: ${u.entrada + u.cacheEscritura + u.cacheLectura} de entrada`)
}

// ───────────────────────── --grabar ─────────────────────────

if (grabar && !cortada && grabados.length === pedidos && pedidos > 0) {
  mkdirSync(CARPETA_REAL, { recursive: true })
  const cuando = new Date().toISOString().slice(0, 10)
  const origen = `Grabada de la API real el ${cuando} con ${modelo}, por scripts/probar-ia-real.mjs --grabar. Sin la clave ni encabezados de la cuenta.`
  const esperadoDe = (r) => ({ corte: r.corte, texto: r.texto, uso: r.uso, llamadas: r.llamadas.map((l) => ({ id: l.id, nombre: l.nombre, argumentos: l.argumentos })), ...(r.idPedido ? { idPedido: r.idPedido } : {}) })
  const archivos = [
    ['real-texto', 'Solo texto contra la API real.', [grabados[0]], respuestas.texto],
    ['real-herramienta', 'Una llamada a una herramienta contra la API real.', [grabados[1]], respuestas.herramienta],
    ...(grabados[2] ? [['real-reenvio', 'Llamada a una herramienta y reenvío del mensaje del asistente contra la API real.', [grabados[1], grabados[2]], respuestas.herramienta]] : []),
  ]
  for (const [nombre, descripcion, intercambios, r] of archivos) {
    const texto = JSON.stringify({ caso: nombre, descripcion, origen, esperado: esperadoDe(r), intercambios }, null, 2) + '\n'
    // sin la clave y sin nada con forma de clave, con la cuenta tampoco: si algo se escapó, no se guarda
    if (filtrarClaves(texto, clave) !== texto) {
      decir(`  ✗ ${nombre}: la grabación llevaba algo con forma de clave; no la guardo.`)
      fallas++
      continue
    }
    writeFileSync(path.join(CARPETA_REAL, `${nombre}.json`), texto)
    decir(`  Guardé ${path.relative(RAIZ, path.join(CARPETA_REAL, `${nombre}.json`))}`)
  }
  decir('  Comparalas con las hechas a mano (grabaciones/anthropic/README.md): si difieren, se corrige el adaptador.')
} else if (grabar) {
  decir('  No grabé nada: la corrida no terminó completa.')
}

decir('')
if (cortada) decir('Terminó CORTADA por el tope: no es un fallo del adaptador, pero tampoco una corrida completa.')
else decir(fallas === 0 ? 'Todo en orden.' : `${fallas} cosa(s) no salieron como se esperaba.`)
process.exit(cortada ? 2 : fallas === 0 ? 0 : 1)
