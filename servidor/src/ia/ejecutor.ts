// El ciclo de un trabajo de la IA integrada (plan 6.4 a 6.11 y 12): tomar, preparar, pedir al modelo, correr las herramientas una sola vez,
// guardar cada paso en la base, topes en tres niveles, cierre, cancelar, errores con reintentos y el filtro de direcciones.
//
// Cada punto que dice «guardar» es una escritura confirmada ANTES de seguir: el trabajo se puede cortar en cualquier momento (un proceso
// que muere, el tiempo de Vercel que se acaba) y otro lo retoma sin repetir una acción ni perder nada:
//   · el JSON exacto del proveedor se guarda y se reenvía tal cual (D11);
//   · cada llamada a una herramienta es una fila del libro `ia_llamadas`: a lo sumo una vez (D12); una que se cortó a la mitad queda
//     `incierta` y el modelo tiene que verificar leyendo;
//   · un tope nunca pierde trabajo: pasa a `pausado_tope` y sigue por donde iba cuando se sube.
//
// Dependencias de afuera (A: bóveda y código; B: proveedores y precios) entran por `configurarEjecutor(deps)`: acá no se importan, así el
// ciclo se prueba con un proveedor falso mínimo y la unión es solo cablear (ia/conectar.ts).
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { EstadoLlamada, IdProveedor, MotivoPausa, PrecioManual } from '../../../compartido/ia'
import { recortar } from '../../../compartido/texto'
import { config } from '../config'
import { esRespuestaMcp } from '../diseno/herramientas-mcp'
import { urlPublica } from '../diseno/urls'
import { barrerHechasViejas } from '../dominio/archivo-hecho'
import { efectosVacios, conTanda } from '../dominio/tanda'
import { ErrorDominio, type Servicio } from '../dominio/servicio'
import { texto as textoDeResultado } from '../mcp/servidor-mcp'
import type { ContextoCodigo, ResultadoCodigo } from './codigo'
import { conjuntoDe, direccionesDeArgs, filtrarRespuesta, hostDe, juzgar, type Conocidas } from './direcciones'
import { sistemaDe, primerMensaje } from './contexto'
import {
  CAPACIDAD_DE,
  esDelicada,
  esquemaDe,
  fraseDe,
  herramientaMcp,
  herramientasPara,
  JUEGOS,
  LIMITES,
  PALABRAS_CAPACIDAD,
  permitida,
  soloLee,
  tituloDe,
} from './herramientas-agente'
import { encadenar as encadenarReal, plazo as plazoReal } from './segundo-plano'
import { iaDe } from './servicio-ia'
import { aLlamadaResumen, actorDeAgente, mantenimiento, mesDe, PerdioElTrabajo, PROCESO, trabajosDe, type AgenteInterno, type Trabajos } from './trabajos'
import {
  ErrorProveedor,
  LIMITES_TRABAJO,
  PUNTOS_DE_FALLA,
  HERRAMIENTAS_DE_CODIGO,
  type Efectos,
  type Inversa,
  type LlamadaGuardada,
  type LlamadaHerramienta,
  type MensajeGuardado,
  type MensajeNeutro,
  type NeutroGuardado,
  type ParteUsuario,
  type Proveedor,
  type PuntoDeFalla,
  type ResultadoHerramienta,
  type TrabajoInterno,
  type Uso,
} from './tipos'

// ───────────────────────── dependencias de afuera ─────────────────────────

/** Lo que el ciclo necesita de los demás (se inyecta: `configurarEjecutor`). Los nombres son los del contrato con A y B. */
export interface DepsEjecutor {
  /** (B, proveedores/indice.ts) El adaptador de un proveedor; tira ErrorDominio si no existe o no está habilitado. */
  proveedorDe: (id: IdProveedor) => Proveedor
  /** (A, boveda.ts `abrir`) La clave en claro, solo dentro del servidor. Tira si no se puede abrir. */
  bovedaAbrir: (sellado: { cifrada: Uint8Array; version: number }, e: { propietario: string; id: string }) => string
  /**
   * (B, proveedores/precios.ts `costoDelAgente`: el precio del modelo o el manual) USD de un pedido. La única cuenta. `urlBase` es la dirección de la
   * clave (el precio de un «compatible» depende de a quién se le habla). Tira `ErrorSinPrecio` si no hay precio: el ciclo lo mira ANTES de pedirle nada al modelo.
   */
  costoUsd: (e: { proveedor: IdProveedor; modelo: string; uso: Uso; precioManual: PrecioManual | null; urlBase?: string | null; ahora?: Date }) => number
  /** (A, codigo.ts `prepararCodigo`) El contexto de código de un trabajo: repos de la cuenta, rama de la tarjeta, token y lo ya gastado de los 12 y 150 KB. */
  prepararCodigo: (s: Servicio, trabajo: { id: string; contexto: TrabajoInterno['contexto'] }) => Promise<ContextoCodigo>
  /** (A, codigo.ts `ejecutarCodigo`) Corre una de las 4 herramientas de código. Nunca tira; ya cuenta las 12 llamadas y los 150 KB, tapa claves y avisa que lo leído es dato. */
  ejecutarCodigo: (contexto: ContextoCodigo, herramienta: string, args: unknown) => Promise<ResultadoCodigo>
  /** (A, codigo.ts) Las rutas de archivo que aparecen en un texto. */
  pistasDeRutas: (texto: string) => string[]
  // Opcionales: lo usan las pruebas (y el valor de fábrica sirve en producción).
  /** Hasta cuándo puede correr esta ejecución (ms de reloj). De fábrica, `plazo()` de segundo-plano.ts. */
  plazo?: (desde: number) => number
  ahora?: () => Date
  esperar?: (ms: number) => Promise<void>
  /** Cada cuánto se mira si pidieron cancelar durante un pedido al modelo. De fábrica, 10 s. */
  cancelarCadaMs?: number
  /** Un punto de falla (15.2): de fábrica mira `TABLERO_IA_FALLA` y corta el proceso. */
  punto?: (nombre: PuntoDeFalla) => void | Promise<void>
  /** Encadenar el trabajo a otra ejecución. De fábrica, `encadenar` de segundo-plano.ts. */
  encadenar?: (cuenta: string) => Promise<void>
}

/** Un corte «de mentira» (el proceso murió): las pruebas lo tiran desde `punto` y el ciclo no lo trata como un error del trabajo. */
export class CorteSimulado extends Error {
  constructor(readonly punto: string) {
    super(`corte simulado en ${punto}`)
    this.name = 'CorteSimulado'
  }
}

let deps: DepsEjecutor | null = null

/** Conecta las dependencias (una vez al arrancar: `conectarIA`). Sin esto, los trabajos quedan en cola y nada corre. */
export function configurarEjecutor(d: DepsEjecutor | null): void {
  deps = d
}
export const ejecutorListo = (): boolean => deps !== null

const D = (): DepsEjecutor => {
  if (!deps) throw new ErrorDominio('La IA integrada todavía no está conectada (falta configurarEjecutor).', 503)
  return deps
}

async function punto(nombre: PuntoDeFalla): Promise<void> {
  const d = D()
  if (d.punto) return d.punto(nombre)
  if (process.env.VERCEL || process.env.TABLERO_IA_FALLA !== nombre) return
  const marca = path.join(config.datos, `ia-falla-${nombre}.marca`)
  if (existsSync(marca)) return
  writeFileSync(marca, 'cortado a propósito\n')
  process.exit(1)
}
export const PUNTOS_VALIDOS: readonly string[] = PUNTOS_DE_FALLA

// ───────────────────────── lo que le queda a una llamada ─────────────────────────

/** Lo que deja una llamada en el libro (`ia_llamadas`) después de pasar por permiso, confirmación y ejecución. */
export interface ResultadoLlamada {
  estado: EstadoLlamada
  motivo?: string
  resultado: ResultadoHerramienta
  efectos?: Efectos
  inversa?: Inversa | null
  imagenes?: string[]
}

const TEXTO_INCIERTA = 'No sé si esta acción llegó a hacerse: se cortó a la mitad. Verificá leyendo antes de repetirla.'
const TEXTO_LIMITE_PASOS = 'Llegaste al límite de pasos de este trabajo. Cerrá con una respuesta corta: qué hiciste y qué falta.'
const TEXTO_RECORTADO = '\n(recortado: pedí menos con los filtros de la herramienta)'

type Evaluacion =
  | { tipo: 'ejecutar' }
  | { tipo: 'esperando'; motivo: string }
  | { tipo: 'cerrada'; estado: 'denegada' | 'error'; motivo: string; texto: string }

/** Los permisos con que corre este trabajo: un agente proactivo en modo «sugiere» solo comenta (F.4). */
export function permisosEfectivos(a: Pick<AgenteInterno, 'permisos' | 'autonomia'>, t: Pick<TrabajoInterno, 'origen'>) {
  return t.origen === 'proactivo' && a.autonomia === 'sugiere' ? a.permisos.filter((c) => c === 'comentar' || c === 'codigo') : a.permisos
}

function mimeDe(ruta: string): string {
  return ruta.endsWith('.jpg') ? 'image/jpeg' : ruta.endsWith('.webp') ? 'image/webp' : ruta.endsWith('.gif') ? 'image/gif' : 'image/png'
}
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/png': 'png' }

interface EntradaLlamadas {
  s: Servicio
  agente: AgenteInterno
  trabajo: TrabajoInterno
  conocidas: Conocidas
  /** El modelo ve imágenes (el agente puede declararlo; si no, lo que diga el adaptador). */
  veImagenes: boolean
}

/**
 * Las dos mitades de una llamada: `evaluar` (permiso, argumentos, direcciones, confirmación: no toca nada) y `ejecutar` (la herramienta, dentro de
 * la tanda del trabajo, sin tirar por errores de la herramienta). El ciclo evalúa TODAS las del paso antes de correr alguna (así lo que pide permiso
 * se pide junto) y las corre en orden.
 */
function llamadasDe(e: EntradaLlamadas) {
  const { s, agente, trabajo: t } = e
  const permisos = permisosEfectivos(agente, t)
  const actor = actorDeAgente(agente, t.proveedor)
  let contextoDeCodigo: Promise<ContextoCodigo> | undefined

  const evaluar = (l: Pick<LlamadaHerramienta, 'nombre' | 'argumentos' | 'invalida'>, o: { decidida: boolean; tocadas: number }): Evaluacion => {
    const cerrada = (estado: 'denegada' | 'error', texto: string, motivo = texto): Evaluacion => ({ tipo: 'cerrada', estado, motivo, texto })
    if (l.invalida !== undefined)
      return cerrada('error', `Los argumentos de esta llamada vinieron cortados o rotos (${l.invalida}). Volvé a llamarla con los argumentos completos.`)
    const cap = CAPACIDAD_DE[l.nombre]
    if (!cap) return cerrada('error', `No existe la herramienta «${l.nombre}». Las que tenés: ${herramientasPara(t.superficie, permisos).map((d) => d.nombre).join(', ')}.`)
    if (!JUEGOS[t.superficie].includes(l.nombre))
      return cerrada('error', `La herramienta «${l.nombre}» no está disponible en este lugar. Las que tenés: ${herramientasPara(t.superficie, permisos).map((d) => d.nombre).join(', ')}.`)
    if (!permitida(l.nombre, permisos)) {
      const palabras = cap === 'leer' ? 'eso' : PALABRAS_CAPACIDAD[cap]
      const enSugiere = t.origen === 'proactivo' && agente.autonomia === 'sugiere' && agente.permisos.includes(cap as never)
      return cerrada(
        'denegada',
        enSugiere ? 'En este trabajo solo podés comentar y avisar: no cambies nada. Decíselo a la persona en tu respuesta.' : `No tenés permiso para ${palabras}. Decíselo a la persona en tu respuesta.`,
        enSugiere ? 'Solo comenta: no cambia nada.' : `Sin permiso para ${palabras}.`,
      )
    }
    const esquema = esquemaDe(l.nombre)
    const valido = esquema?.safeParse(l.argumentos ?? {})
    if (valido && !valido.success)
      return cerrada('error', `Datos inválidos: ${valido.error.issues.map((i) => `${i.path.join('.') || 'dato'}: ${i.message}`).join('; ')}`)
    // El filtro de direcciones (12.6): por acá saldría un dato si el modelo armara una dirección con datos adentro.
    const veredicto = juzgar(direccionesDeArgs(l.nombre, l.argumentos), e.conocidas)
    if (veredicto.tipo === 'rechazar') return cerrada('denegada', `Esa dirección no salió del tablero ni del pedido: ${veredicto.url}. Usá una que hayas leído en Telar o pedile la dirección a la persona.`, `Dirección que no salió del tablero ni del pedido: ${hostDe(veredicto.url)}.`)
    if (o.decidida) return { tipo: 'ejecutar' }
    if (veredicto.tipo === 'permiso') return { tipo: 'esperando', motivo: `Traer una imagen de ${hostDe(veredicto.url)}` }
    const escribe = !soloLee(l.nombre)
    if (agente.confirmar === 'siempre' && escribe) return { tipo: 'esperando', motivo: tituloDe(l.nombre, l.argumentos) }
    if (agente.confirmar === 'peligrosas') {
      const motivo = esDelicada(l.nombre, l.argumentos, { tarjetasTocadas: o.tocadas })
      if (motivo) return { tipo: 'esperando', motivo }
    }
    return { tipo: 'ejecutar' }
  }

  const ejecutar = async (l: Pick<LlamadaHerramienta, 'id' | 'nombre' | 'argumentos'>, llamadaId: string): Promise<ResultadoLlamada> => {
    const efectos = efectosVacios()
    const imagenes: string[] = []
    let esError = false
    let partes: string[] = []
    try {
      const esquema = esquemaDe(l.nombre)!
      const args = esquema.parse(l.argumentos ?? {})
      const r = await conTanda({ id: t.id, llamadaId, efectos }, async () => {
        if ((HERRAMIENTAS_DE_CODIGO as readonly string[]).includes(l.nombre)) {
          // El código lo corre `codigo.ts` (A): él cuenta las 12 llamadas y los 150 KB por trabajo. El contexto se arma una vez por corrida.
          const resultado = await D().ejecutarCodigo(await (contextoDeCodigo ??= D().prepararCodigo(s, t)), l.nombre, args)
          return { deCodigo: resultado }
        }
        return herramientaMcp(l.nombre)!.ejecutar(s, actor, args)
      })
      if (r && typeof r === 'object' && 'deCodigo' in r) {
        const rc = (r as { deCodigo: ResultadoCodigo }).deCodigo
        esError = rc.esError
        partes = [rc.texto]
      } else if (esRespuestaMcp(r)) {
        let n = 0
        for (const bloque of r.contenido) {
          if (bloque.type === 'text') partes.push(bloque.text)
          else if (bloque.type === 'image') {
            if (!e.veImagenes) {
              partes.push('(Este modelo no ve imágenes: guiate por los avisos y las medidas.)')
              continue
            }
            const ruta = `ia/${t.id}/${llamadaId}-${n++}.${EXTENSION[bloque.mimeType] ?? 'png'}`
            await s.almacen.guardar(ruta, new Uint8Array(Buffer.from(bloque.data, 'base64')), bloque.mimeType)
            imagenes.push(ruta)
          }
        }
      } else partes = [textoDeResultado(r)]
    } catch (err) {
      esError = true
      partes = [mensajeDe(err)]
    }
    let texto = partes.join('\n')
    if (texto.length > LIMITES_TRABAJO.resultadoMaxCaracteres) texto = texto.slice(0, LIMITES_TRABAJO.resultadoMaxCaracteres) + TEXTO_RECORTADO
    const partesModelo: ParteUsuario[] = [{ tipo: 'texto', texto }, ...imagenes.map((ruta) => ({ tipo: 'imagen' as const, mime: mimeDe(ruta), ruta }))]
    return {
      estado: esError ? 'error' : 'hecha',
      resultado: { id: l.id, nombre: l.nombre, esError, partes: partesModelo },
      efectos,
      inversa: null,
      imagenes,
    }
  }

  return { evaluar, ejecutar }
}

/** Lo que dice un error de una herramienta, tal cual lo diría el MCP (los de dominio y los de zod explican cómo seguir). */
function mensajeDe(err: unknown): string {
  if (err instanceof ErrorDominio) return err.message
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as { issues: unknown[] }).issues))
    return `Datos inválidos: ${(err as { issues: { path: unknown[]; message: string }[] }).issues.map((i) => `${i.path.join('.') || 'dato'}: ${i.message}`).join('; ')}`
  return err instanceof Error ? err.message : String(err)
}

/**
 * El contrato de A.3: `ejecutorAgente(s, agente, trabajo)` devuelve lo que corre UNA llamada (permiso, confirmación y ejecución, dentro de
 * la tanda). Es la unión de `evaluar` y `ejecutar`; el ciclo usa las dos mitades por separado.
 */
export function ejecutorAgente(
  s: Servicio,
  agente: AgenteInterno,
  trabajo: TrabajoInterno & { tarjetasTocadas?: number },
  extra: { conocidas?: Conocidas; veImagenes?: boolean } = {},
): (llamada: LlamadaHerramienta, e: { decidida?: boolean }) => Promise<ResultadoLlamada> {
  const conocidas = extra.conocidas ?? { confiables: new Set<string>(), vistas: new Set<string>(), esPropia: esPropiaDeTelar }
  const { evaluar, ejecutar } = llamadasDe({ s, agente, trabajo, conocidas, veImagenes: extra.veImagenes ?? true })
  return async (llamada, e) => {
    const ev = evaluar(llamada, { decidida: Boolean(e.decidida), tocadas: trabajo.tarjetasTocadas ?? 0 })
    if (ev.tipo === 'cerrada')
      return { estado: ev.estado, motivo: ev.motivo, resultado: { id: llamada.id, nombre: llamada.nombre, esError: true, partes: [{ tipo: 'texto', texto: ev.texto }] } }
    if (ev.tipo === 'esperando')
      return { estado: 'esperando', motivo: ev.motivo, resultado: { id: llamada.id, nombre: llamada.nombre, esError: false, partes: [] } }
    return ejecutar(llamada, `ll_${trabajo.id}_${llamada.id}`)
  }
}

export function esPropiaDeTelar(url: string): boolean {
  const base = urlPublica()
  return url === base || url.startsWith(`${base}/`)
}

// ───────────────────────── conocer lo que el modelo vio (para el filtro de direcciones) ─────────────────────────

/** Las direcciones del pedido y de las instrucciones del dueño (confiables) y las de todo lo leído (datos). */
function conocidasDe(msgs: MensajeGuardado[], llamadas: LlamadaGuardada[], agente: AgenteInterno, t: TrabajoInterno): Conocidas {
  const primero = msgs.find((m) => m.rol === 'usuario')
  const texto = primero && primero.neutro.rol === 'usuario' ? primero.neutro.partes.map((p) => (p.tipo === 'texto' ? p.texto : '')).join('\n') : ''
  const bloque = /<pedido\b[^>]*>([\s\S]*)<\/pedido>\s*$/.exec(texto)
  const pedido = bloque?.[1] ?? ''
  const datos = bloque ? texto.slice(0, bloque.index) : texto
  return {
    confiables: conjuntoDe(pedido, agente.instrucciones, t.pedido),
    vistas: conjuntoDe(datos, ...llamadas.map((l) => l.resultado)),
    esPropia: esPropiaDeTelar,
  }
}

// ───────────────────────── avisos a la persona ─────────────────────────

async function avisar(
  tb: Trabajos,
  t: TrabajoInterno,
  agente: Pick<AgenteInterno, 'miembroId' | 'nombre'>,
  a: { tipo: 'respuesta' | 'confirmacion' | 'tope' | 'error_ia'; titulo: string; cuerpo: string; claveUnica: string },
): Promise<void> {
  try {
    const paraId = await tb.aQuienAvisar(t)
    if (!paraId) return
    const clave = t.contexto.tarjetaClave
    await tb.ia.notificar({
      paraId,
      tipo: a.tipo,
      titulo: a.titulo,
      cuerpo: a.cuerpo,
      actor: actorDeAgente(agente, t.proveedor),
      enlace: clave ? `/${encodeURIComponent(clave.split('-')[0]!)}?tarjeta=${encodeURIComponent(clave)}` : null,
      tarjetaId: t.contexto.tarjetaId ?? null,
      trabajoId: t.id,
      mencionId: t.mencionId,
      claveUnica: a.claveUnica,
    })
  } catch (e) {
    console.error(`[tablero] ia: ${t.id} no pude avisar:`, e instanceof Error ? e.name : 'error')
  }
}

// ───────────────────────── el ciclo ─────────────────────────

const log = (t: { id: string }, que: string) => console.error(`[tablero] ia: ${t.id} ${que}`)

/** Tapa lo que tiene forma de clave antes de guardar o mostrar un texto de error (los adaptadores ya lo hacen; este es el segundo cinturón). */
export function sinClaves(texto: string, claves: string[] = []): string {
  let salida = texto
  for (const c of claves) if (c && c.length >= 6) salida = salida.split(c).join('[clave]')
  return salida.replace(/\b(sk|rk|pk|tab|key)[-_][A-Za-z0-9_-]{8,}\b/g, '[clave]').replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [clave]')
}

interface Corrida {
  raiz: Servicio
  s: Servicio
  tb: Trabajos
  desde: number
  /** Se soltó un trabajo por falta de tiempo: no tiene sentido tomar otro en esta ejecución. */
  sinTiempo?: boolean
}

async function cerrarCon(
  c: Corrida,
  t: TrabajoInterno,
  agente: AgenteInterno,
  estado: 'hecho' | 'fallado' | 'cancelado',
  motivo: string | null,
  resultado?: { texto: string; comentarioId?: string | null },
): Promise<void> {
  const cerrado = await c.tb.cerrar(t, estado, { motivo, resultado: resultado ?? null })
  if (!cerrado) return
  if (estado === 'cancelado') await c.tb.retirarMencionDe(cerrado, 'Frenaste el pedido.')
  await c.tb.publicar(estado, cerrado, agente)
  if (estado === 'fallado')
    await avisar(c.tb, cerrado, agente, { tipo: 'error_ia', titulo: `${agente.nombre} no pudo terminar`, cuerpo: motivo ?? 'Algo salió mal.', claveUnica: `error:${t.id}:${cerrado.reintentos}:${cerrado.paso}` })
  await c.raiz.bus.vaciar()
}

async function pausarPorTope(c: Corrida, t: TrabajoInterno, agente: AgenteInterno, motivo: MotivoPausa, detalle: string): Promise<void> {
  const cerrado = await c.tb.cerrar(t, 'pausado_tope', { motivo })
  if (!cerrado) return
  await c.tb.publicar('pausado', cerrado, agente)
  const mes = mesDe(deps?.ahora?.() ?? new Date())
  const clave = motivo === 'tope_agente' ? `tope100:${agente.miembroId}:${mes}` : motivo === 'tope_cuenta' ? `tope100:cuenta:${mes}` : `tope100:${motivo}:${t.id}`
  await avisar(c.tb, cerrado, agente, { tipo: 'tope', titulo: `${agente.nombre} se pausó por tope`, cuerpo: `${detalle} No se perdió nada: cuando lo subas, seguís por donde iba.`, claveUnica: clave })
  await c.raiz.bus.vaciar()
}

/** El 80 % de un tope mensual: una sola notificación por mes (la frena la clave única). */
async function avisarOchenta(c: Corrida, t: TrabajoInterno, agente: AgenteInterno): Promise<void> {
  const ajustes = await c.tb.ajustes()
  const gasto = await c.tb.gastoMes(agente.miembroId)
  const mes = mesDe(deps?.ahora?.() ?? new Date())
  if (agente.topeMesUsd > 0 && gasto.agente >= 0.8 * agente.topeMesUsd)
    await avisar(c.tb, t, agente, { tipo: 'tope', titulo: `${agente.nombre} va por el 80 % de su tope`, cuerpo: `Gastó USD ${gasto.agente.toFixed(2)} de ${agente.topeMesUsd.toFixed(2)} este mes.`, claveUnica: `tope80:${agente.miembroId}:${mes}` })
  if (ajustes.topeMesUsd > 0 && gasto.cuenta >= 0.8 * ajustes.topeMesUsd)
    await avisar(c.tb, t, agente, { tipo: 'tope', titulo: 'La IA de la cuenta va por el 80 % de su tope', cuerpo: `Se gastaron USD ${gasto.cuenta.toFixed(2)} de ${ajustes.topeMesUsd.toFixed(2)} este mes.`, claveUnica: `tope80:cuenta:${mes}` })
}

/** P4: los topes (12.2), antes de cada pedido al modelo. */
async function revisarTopes(c: Corrida, t: TrabajoInterno, agente: AgenteInterno): Promise<{ motivo: MotivoPausa; detalle: string } | null> {
  const ajustes = await c.tb.ajustes()
  if (ajustes.pausada) return { motivo: 'pausa', detalle: 'Toda la IA de esta cuenta está en pausa.' }
  const gasto = await c.tb.gastoMes(agente.miembroId)
  if (gasto.agente >= agente.topeMesUsd) return { motivo: 'tope_agente', detalle: `${agente.nombre} llegó a su tope del mes (USD ${agente.topeMesUsd.toFixed(2)}).` }
  if (gasto.cuenta >= ajustes.topeMesUsd) return { motivo: 'tope_cuenta', detalle: `La cuenta llegó a su tope de IA del mes (USD ${ajustes.topeMesUsd.toFixed(2)}).` }
  if (t.costoUsd >= t.topeUsd) return { motivo: 'tope_trabajo', detalle: `Este pedido ya gastó USD ${t.topeUsd.toFixed(2)}.` }
  return null
}

const TEXTO_FIN_VACIO = 'Listo.'

/** Los mensajes guardados como los pide el proveedor: lo fijo más el JSON exacto de cada uno, en orden. */
function historialDe(msgs: MensajeGuardado[]): string[] | null {
  const h: string[] = []
  for (const m of msgs) {
    if (m.nativo === null) return null
    h.push(m.nativo)
  }
  return h
}

/** Corre un trabajo ya tomado hasta que termine, se pause, quede poco tiempo o lo frenen (6.4). Nunca tira por el trabajo: lo cierra o lo suelta. */
async function correrTrabajo(c: Corrida, t0: TrabajoInterno): Promise<void> {
  const d = D()
  let t = t0
  const agente = await c.tb.agente(t.agenteId)
  if (!agente) {
    await c.tb.cerrar(t, 'fallado', { motivo: 'El agente ya no existe.' })
    return
  }
  try {
    if (t.cancelar) return await cerrarCon(c, t, agente, 'cancelado', 'Lo frenaste vos.')
    if (t.cortes >= LIMITES_TRABAJO.cortesMax) return await cerrarCon(c, t, agente, 'fallado', 'Se cortó tres veces. Podés reintentarlo.')
    if (t.msTrabajado >= LIMITES_TRABAJO.tiempoTotalMs) return await cerrarCon(c, t, agente, 'fallado', 'Tardó demasiado: pedilo por partes.')
    let proveedor: Proveedor
    try {
      proveedor = d.proveedorDe(t.proveedor)
    } catch (err) {
      // Un proveedor que no existe o no está habilitado acá (el falso fuera de las pruebas) no se arregla esperando: no se reintenta.
      if (err instanceof ErrorDominio) return await cerrarCon(c, t, agente, 'fallado', err.message)
      throw err
    }
    const permisos = permisosEfectivos(agente, t)

    // P1: preparar (solo la primera vez)
    if (t.fijo === null) {
      if ((await c.tb.mensajes(t.id)).length) return await cerrarCon(c, t, agente, 'fallado', 'La conversación ya no está guardada.')
      const persona = t.pedidoPor.nombre
      const fijo = proveedor.prepararFijo({
        sistema: sistemaDe({ nombre: agente.nombre, persona, origen: t.origen, superficie: t.superficie, permisos, instrucciones: agente.instrucciones, autonomia: agente.autonomia }),
        herramientas: herramientasPara(t.superficie, permisos),
        modelo: t.modelo,
      })
      const actor = actorDeAgente(agente, t.proveedor)
      const primero = await primerMensaje({
        ia: c.tb.ia,
        trabajo: t,
        permisos,
        ahora: d.ahora?.() ?? new Date(),
        pistasDeRutas: d.pistasDeRutas,
        leer: async (herramienta, args) => {
          const h = herramientaMcp(herramienta)!
          return textoDeResultado(await h.ejecutar(c.s, actor, h.esquema.parse(args)))
        },
      })
      await c.tb.guardarPreparacion(t, fijo, primero, proveedor.aNativo(primero, { modelo: t.modelo }))
      t = { ...t, fijo }
    }

    for (;;) {
      // Lo que pasó desde el último paso: ¿lo frenaron? ¿lo retomó otro?
      const fresco = await c.tb.leer(t.id)
      if (!fresco || fresco.estado !== 'en_curso' || fresco.tomadoPor !== PROCESO) return
      t = fresco
      if (t.cancelar) return await cerrarCon(c, t, agente, 'cancelado', 'Lo frenaste vos.')
      if (t.fijo === null) return await cerrarCon(c, t, agente, 'fallado', 'La conversación ya no está guardada.')

      const msgs = await c.tb.mensajes(t.id)
      const llamadas = await c.tb.llamadas(t.id)
      const ultimo = msgs[msgs.length - 1]!
      if (ultimo.rol === 'asistente') {
        const neutro = ultimo.neutro as Extract<NeutroGuardado, { rol: 'asistente' }> & { corte?: string }
        const pasoDe = msgs.filter((m) => m.rol === 'asistente').length - 1
        const delPaso = llamadas.filter((l) => l.paso === pasoDe)
        if (delPaso.length) {
          // P3 / P7: llamadas sin terminar → correrlas; todas terminadas → P8
          const pendientes = delPaso.some((l) => l.estado === 'pendiente' || l.estado === 'esperando' || l.estado === 'en_curso')
          if (pendientes) {
            const sigue = await correrLlamadas(c, t, agente, proveedor, msgs, llamadas, delPaso, pasoDe)
            if (!sigue) return
            continue
          }
          await guardarResultados(c, t, proveedor, delPaso)
          continue
        }
        // Sin llamadas: según cómo terminó el pedido
        const corte = neutro.corte ?? 'fin'
        if (corte === 'rechazo') return await cerrarCon(c, t, agente, 'fallado', 'El modelo no quiso seguir con este pedido.')
        if (corte === 'largo') {
          const nota = 'Se cortó por largo: seguí en partes más chicas.'
          if (msgs.some((m) => m.rol === 'sistema' && m.neutro.rol === 'sistema' && m.neutro.texto === nota))
            return await cerrarCon(c, t, agente, 'fallado', 'La respuesta se corta por larga: pedilo en partes más chicas.')
          const n: MensajeNeutro = { rol: 'sistema', texto: nota }
          await c.tb.agregarMensaje(t.id, 'sistema', n, proveedor.aNativo(n, { modelo: t.modelo }))
          continue
        }
        if (corte !== 'pausa') return await entregarYCerrar(c, t, agente, msgs, llamadas, neutro.texto)
        // pause_turn: se vuelve a pedir con lo mismo
      }

      // P4: topes
      const tope = await revisarTopes(c, t, agente)
      if (tope) return await pausarPorTope(c, t, agente, tope.motivo, tope.detalle)

      // P5: tiempo
      const plazo = (d.plazo ?? defaultPlazo)(c.desde)
      if (plazo - Date.now() < LIMITES[t.superficie].minLibreMs) {
        await c.tb.soltar(t, { proximoEnMs: 0 })
        c.sinTiempo = true
        await (d.encadenar ?? defaultEncadenar)(c.s.cuenta)
        return
      }
      if (t.paso > t.maxPasos) return await cerrarCon(c, t, agente, 'fallado', 'Llegó al límite de pasos sin cerrar.')

      // P6: pedir al modelo
      const resultado = await pedirAlModelo(c, t, agente, proveedor, msgs)
      if (resultado === 'salir') return
      if (resultado === 'rechazo') return await cerrarCon(c, t, agente, 'fallado', 'El modelo no quiso seguir con este pedido.')
    }
  } catch (e) {
    if (e instanceof CorteSimulado || e instanceof PerdioElTrabajo) {
      if (e instanceof CorteSimulado) throw e
      return
    }
    log(t, `error ${e instanceof Error ? e.name : 'desconocido'}`)
    // Un fallo que no es del modelo ni de una herramienta (la base, una cuenta mal armada): se suelta y se reintenta; a la tercera, fallado.
    try {
      const fresco = await c.tb.leer(t.id)
      if (!fresco || fresco.estado !== 'en_curso' || fresco.tomadoPor !== PROCESO) return
      if (fresco.reintentos >= LIMITES_TRABAJO.reintentosProveedorMs.length)
        await cerrarCon(c, fresco, agente, 'fallado', e instanceof ErrorDominio ? e.message : 'Algo salió mal por adentro. Probá de nuevo en un rato.')
      else await c.tb.soltar(fresco, { proximoEnMs: LIMITES_TRABAJO.reintentosProveedorMs[fresco.reintentos], reintentos: fresco.reintentos + 1 })
    } catch {
      // si ni eso se pudo, vence el préstamo y lo retoma otro
    }
  }
}

const defaultPlazo = (desde: number): number => plazoReal(desde)
const defaultEncadenar = (cuenta: string): Promise<void> => encadenarReal(cuenta)

// ───────────────────────── P6: pedir al modelo ─────────────────────────

/** El «uso» estimado de un pedido que se abortó sin que el proveedor informara cuánto gastó (caracteres ÷ 3). */
function usoEstimado(fijo: string, historial: string[]): Uso {
  const chars = fijo.length + historial.reduce((n, h) => n + h.length, 0)
  return { entrada: Math.ceil(chars / 3), salida: 0, cacheLectura: 0, cacheEscritura: 0 }
}

async function pedirAlModelo(c: Corrida, t: TrabajoInterno, agente: AgenteInterno, proveedor: Proveedor, msgs: MensajeGuardado[]): Promise<'sigue' | 'salir' | 'rechazo'> {
  const d = D()
  const historial = historialDe(msgs)
  if (!historial) {
    await cerrarCon(c, t, agente, 'fallado', 'La conversación ya no está guardada.')
    return 'salir'
  }
  // La clave: se abre solo para este pedido y no se guarda en ningún lado.
  const sello = agente.claveId
    ? (await c.s.db.consulta<{ cifrada: Uint8Array; version: number; url_base: string | null }>(`select cifrada, version, url_base from ia_claves where id = $1 and propietario = $2`, [agente.claveId, c.s.cuenta]))[0]
    : undefined
  if (!sello) {
    await cerrarCon(c, t, agente, 'fallado', 'El agente no tiene clave. Cargala en Configuración → IA.')
    return 'salir'
  }
  // Sin precio no hay tope que frene el gasto: se mira ANTES de pedirle nada al modelo (un agente así no se activa, pero el precio manual se pudo borrar).
  try {
    d.costoUsd({ proveedor: t.proveedor, modelo: t.modelo, uso: { entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 }, precioManual: agente.precioManual, urlBase: sello.url_base })
  } catch (err) {
    const motivo = (err as { paraLaPersona?: unknown }).paraLaPersona
    await cerrarCon(c, t, agente, 'fallado', typeof motivo === 'string' ? motivo : 'Telar no conoce el precio de este modelo: sin eso el tope de gasto no puede frenarlo.')
    return 'salir'
  }
  let clave: string
  try {
    clave = d.bovedaAbrir({ cifrada: sello.cifrada, version: Number(sello.version) }, { propietario: c.s.cuenta, id: agente.claveId! })
  } catch (err) {
    // Sin el secreto del servidor la clave no está mal: lo que falla es la configuración. No se la marca inválida.
    if ((err as { motivo?: unknown }).motivo === 'sin_secreto') {
      await cerrarCon(c, t, agente, 'fallado', (err as Error).message)
      return 'salir'
    }
    // Que no se pueda abrir no dice que la clave esté mal (puede ser un cambio de secreto ya arreglado): no se la marca inválida, que
    // dejaría trabada a toda mención nueva hasta probarla a mano. El trabajo falla con el aviso y la persona la vuelve a cargar.
    await cerrarCon(c, t, agente, 'fallado', 'La clave guardada no se pudo abrir. Volvé a cargarla en Configuración → IA.')
    return 'salir'
  }
  const renovado = await c.tb.renovar(t)
  if (!renovado) return 'salir'

  const ctrl = new AbortController()
  const cada = d.cancelarCadaMs ?? LIMITES_TRABAJO.cancelarCadaMs
  const vigilante = setInterval(() => {
    void c.tb.pedirCancelar(t.id).then((si) => si && ctrl.abort('cancelar'), () => {})
  }, cada)
  const plazo = (d.plazo ?? defaultPlazo)(c.desde)
  const reloj = Number.isFinite(plazo) ? setTimeout(() => ctrl.abort('tiempo'), Math.max(1_000, plazo - Date.now())) : null
  const inicio = Date.now()
  const caps = proveedor.capacidades(t.modelo)
  const lim = LIMITES[t.superficie]
  try {
    const r = await proveedor.llamar({
      modelo: t.modelo,
      esfuerzo: agente.esfuerzo ?? undefined,
      maxSalida: Math.min(lim.maxSalida, caps.salidaMax || lim.maxSalida),
      fijo: t.fijo!,
      historial,
      clave,
      urlBase: sello.url_base ?? undefined,
      senal: ctrl.signal,
      leerImagen: async (ruta) => {
        const a = await c.s.almacen.leer(ruta)
        if (!a) throw new ErrorDominio('La imagen ya no está guardada.', 404)
        return a.datos
      },
    })
    const ms = Date.now() - inicio
    const costo = d.costoUsd({ proveedor: t.proveedor, modelo: t.modelo, uso: r.uso, precioManual: agente.precioManual, urlBase: sello.url_base, ahora: d.ahora?.() })
    const llamadas = r.llamadas
    const haciendo = llamadas[0] ? fraseDe(llamadas[0].nombre, llamadas[0].argumentos) : 'Escribiendo la respuesta…'
    const neutro: NeutroGuardado = { rol: 'asistente', texto: r.texto, llamadas, corte: r.corte }
    const { trabajo } = await c.tb.guardarPaso(
      t,
      { paso: t.paso, respuesta: r, costoUsd: costo, estimado: false, ms },
      {
        neutro,
        llamadas: llamadas.map((l) => ({ idProveedor: l.id, herramienta: l.nombre, argumentos: l.argumentos, invalida: l.invalida })),
        proveedor: t.proveedor,
        modelo: t.modelo,
        haciendo,
        estimado: false,
      },
    )
    await punto('despues-de-guardar-asistente')
    await c.tb.publicar('paso', trabajo, agente)
    await c.raiz.bus.vaciar()
    await avisarOchenta(c, trabajo, agente)
    return r.corte === 'rechazo' && !llamadas.length ? 'rechazo' : 'sigue'
  } catch (e) {
    if (e instanceof CorteSimulado || e instanceof PerdioElTrabajo) throw e
    return await manejarErrorDelModelo(c, t, agente, e, ctrl, { fijo: t.fijo!, historial, ms: Date.now() - inicio, proveedor: t.proveedor, modelo: t.modelo, clave, urlBase: sello.url_base })
  } finally {
    clearInterval(vigilante)
    if (reloj) clearTimeout(reloj)
  }
}

async function marcarClave(c: Corrida, agente: AgenteInterno, error: string): Promise<void> {
  if (!agente.claveId) return
  await c.s.db.consulta(`update ia_claves set estado = 'invalida', error = $3, probada_en = now(), actualizado_en = now() where id = $1 and propietario = $2`, [agente.claveId, c.s.cuenta, error])
}

/** 6.11: qué hace el ciclo con cada clase de error del proveedor. */
async function manejarErrorDelModelo(
  c: Corrida,
  t: TrabajoInterno,
  agente: AgenteInterno,
  e: unknown,
  ctrl: AbortController,
  uso: { fijo: string; historial: string[]; ms: number; proveedor: IdProveedor; modelo: string; clave: string; urlBase: string | null },
): Promise<'sigue' | 'salir'> {
  const d = D()
  // Abortado: por una persona que frenó el trabajo, o porque se acabó el tiempo.
  if (ctrl.signal.aborted) {
    const u = usoEstimado(uso.fijo, uso.historial)
    const costo = d.costoUsd({ proveedor: uso.proveedor, modelo: uso.modelo, uso: u, precioManual: agente.precioManual, urlBase: uso.urlBase, ahora: d.ahora?.() })
    await c.tb.guardarUsoAbortado(t, { entrada: u.entrada, salida: u.salida, costoUsd: costo, ms: uso.ms, proveedor: uso.proveedor, modelo: uso.modelo })
    if (ctrl.signal.reason === 'cancelar') {
      await cerrarCon(c, t, agente, 'cancelado', 'Lo frenaste vos.')
      return 'salir'
    }
    e = new ErrorProveedor({ tipo: 'tiempo', reintentable: true, paraLaPersona: 'El pedido no entró en el tiempo.' })
  }
  if (!(e instanceof ErrorProveedor)) {
    log(t, `error del modelo ${e instanceof Error ? e.name : 'desconocido'}`)
    await cerrarCon(c, t, agente, 'fallado', 'Algo salió mal al hablar con el modelo.')
    return 'salir'
  }
  const texto = sinClaves(e.paraLaPersona || 'Algo salió mal al hablar con el modelo.', [uso.clave])
  log(t, `${e.tipo}${e.idPedido ? ` pedido ${e.idPedido}` : ''}`)
  const reintentos = LIMITES_TRABAJO.reintentosProveedorMs
  switch (e.tipo) {
    case 'clave':
      await marcarClave(c, agente, texto)
      await cerrarCon(c, t, agente, 'fallado', texto || 'La clave no anda. Cambiala en Configuración → IA.')
      return 'salir'
    case 'saldo': {
      const cerrado = await c.tb.cerrar(t, 'pausado_tope', { motivo: 'tope_proveedor' })
      if (cerrado) {
        await c.tb.publicar('pausado', cerrado, agente)
        await avisar(c.tb, cerrado, agente, { tipo: 'tope', titulo: `${agente.nombre} se pausó: el proveedor frenó`, cuerpo: texto, claveUnica: `tope100:proveedor:${t.id}` })
        await c.raiz.bus.vaciar()
      }
      return 'salir'
    }
    case 'limite':
      if (t.reintentos >= LIMITES_TRABAJO.reintentosLimiteMax) {
        await cerrarCon(c, t, agente, 'fallado', 'El proveedor sigue pidiendo esperar. Probá de nuevo en un rato.')
        return 'salir'
      }
      await c.tb.soltar(t, { proximoEnMs: e.esperarMs ?? 30_000, reintentos: t.reintentos + 1, haciendo: 'Esperando al proveedor…' })
      return 'salir'
    case 'sobrecarga':
    case 'red':
      if (!e.reintentable || t.reintentos >= reintentos.length) {
        await cerrarCon(c, t, agente, 'fallado', 'El proveedor no responde. Probá de nuevo en un rato.')
        return 'salir'
      }
      await c.tb.soltar(t, { proximoEnMs: e.esperarMs ?? reintentos[t.reintentos], reintentos: t.reintentos + 1, haciendo: 'Esperando al proveedor…' })
      return 'salir'
    case 'tiempo':
      if (t.reintentos >= 1) {
        await cerrarCon(c, t, agente, 'fallado', 'El pedido es muy grande para un solo paso: pedilo por partes.')
        return 'salir'
      }
      await c.tb.soltar(t, { proximoEnMs: 0, reintentos: t.reintentos + 1 })
      c.sinTiempo = true
      await (d.encadenar ?? defaultEncadenar)(c.s.cuenta)
      return 'salir'
    case 'rechazo':
      await cerrarCon(c, t, agente, 'fallado', 'El modelo no quiso seguir con este pedido.')
      return 'salir'
    default:
      await cerrarCon(c, t, agente, 'fallado', `Algo salió mal al hablar con el modelo (código ${e.idPedido ?? e.tipo}).`)
      return 'salir'
  }
}

// ───────────────────────── P7: correr las llamadas ─────────────────────────

/** Cuántas tarjetas distintas tocó ya el trabajo (crear, editar o mover), por sus efectos en el libro. */
function tarjetasTocadas(llamadas: LlamadaGuardada[]): Set<string> {
  const s = new Set<string>()
  for (const l of llamadas)
    if (l.estado === 'hecha' && (l.herramienta === 'crear_tarjeta' || l.herramienta === 'actualizar_tarjeta' || l.herramienta === 'mover_tarjeta'))
      for (const id of l.efectos?.tarjetas ?? []) s.add(id)
  return s
}

/** Devuelve false si el ciclo tiene que salir (pausó, soltó o cerró el trabajo). */
async function correrLlamadas(
  c: Corrida,
  t: TrabajoInterno,
  agente: AgenteInterno,
  proveedor: Proveedor,
  msgs: MensajeGuardado[],
  todas: LlamadaGuardada[],
  delPaso: LlamadaGuardada[],
  pasoDe: number,
): Promise<boolean> {
  const d = D()
  const caps = proveedor.capacidades(t.modelo)
  const { evaluar, ejecutar } = llamadasDe({ s: c.s, agente, trabajo: t, conocidas: conocidasDe(msgs, todas, agente, t), veImagenes: (agente.veImagenes ?? caps.imagenes) })

  // 1) lo que quedó a medias por un corte: se repite si es de lectura o idempotente; si no, queda «incierta» y el modelo verifica leyendo
  for (const l of delPaso.filter((x) => x.estado === 'en_curso')) {
    const h = herramientaMcp(l.herramienta)
    if (soloLee(l.herramienta) || h?.idempotente) await c.tb.marcarLlamada(l.id, { estado: 'pendiente' })
    else await c.tb.marcarLlamada(l.id, { estado: 'incierta', motivo: 'Se cortó a la mitad.', resultado: TEXTO_INCIERTA })
  }
  let actuales = (await c.tb.llamadas(t.id)).filter((l) => l.paso === pasoDe)

  // 2) el límite de pasos: al llegar, las llamadas vuelven con el aviso y se permite UN pedido más para cerrar
  const sinCorrer = actuales.filter((l) => l.estado === 'pendiente' || l.estado === 'esperando')
  if (pasoDe >= t.maxPasos) {
    for (const l of sinCorrer) await c.tb.marcarLlamada(l.id, { estado: 'denegada', motivo: 'Límite de pasos.', resultado: TEXTO_LIMITE_PASOS })
    await cerrarCon(c, t, agente, 'fallado', 'Llegó al límite de pasos sin cerrar. Lo que hizo quedó a la vista.')
    return false
  }
  if (pasoDe + 1 >= t.maxPasos) {
    for (const l of sinCorrer) await c.tb.marcarLlamada(l.id, { estado: 'denegada', motivo: 'Límite de pasos.', resultado: TEXTO_LIMITE_PASOS })
    return true
  }

  // 3) evaluar todas las pendientes antes de correr alguna: lo que pide permiso se pide junto
  const tocadas = tarjetasTocadas(todas)
  let nuevas = 0
  const aEsperar: { l: LlamadaGuardada; motivo: string }[] = []
  const aCorrer: LlamadaGuardada[] = []
  for (const l of actuales.filter((x) => x.estado === 'pendiente')) {
    const cuenta = tocadas.size + nuevas
    const ev = evaluar({ nombre: l.herramienta, argumentos: l.argumentos }, { decidida: Boolean(l.decididaPor), tocadas: cuenta })
    if (ev.tipo === 'cerrada') await c.tb.marcarLlamada(l.id, { estado: ev.estado, motivo: ev.motivo, resultado: ev.texto })
    else if (ev.tipo === 'esperando') aEsperar.push({ l, motivo: ev.motivo })
    else {
      aCorrer.push(l)
      if (l.herramienta === 'crear_tarjeta' || l.herramienta === 'actualizar_tarjeta' || l.herramienta === 'mover_tarjeta') nuevas++
    }
  }
  const yaEsperando = actuales.filter((l) => l.estado === 'esperando')
  if (aEsperar.length || yaEsperando.length) {
    for (const { l, motivo } of aEsperar) await c.tb.marcarLlamada(l.id, { estado: 'esperando', motivo })
    const cerrado = await c.tb.cerrar(t, 'esperando_confirmacion', { motivo: null })
    if (!cerrado) return false
    await c.tb.publicar('esperando', cerrado, agente)
    await avisar(c.tb, cerrado, agente, {
      tipo: 'confirmacion',
      titulo: `${agente.nombre} quiere tu permiso`,
      cuerpo: [...aEsperar.map((x) => x.motivo), ...yaEsperando.map((l) => l.motivo ?? tituloDe(l.herramienta, l.argumentos))].join(' · '),
      claveUnica: `confirmacion:${t.id}:${pasoDe}`,
    })
    await c.raiz.bus.vaciar()
    return false
  }

  // 4) correrlas, en orden, una sola vez cada una
  for (const l of aCorrer) {
    const fresco = await c.tb.renovar(t)
    if (!fresco) return false
    if (fresco.cancelar) {
      await cerrarCon(c, fresco, agente, 'cancelado', 'Lo frenaste vos.')
      return false
    }
    if ((d.plazo ?? defaultPlazo)(c.desde) - Date.now() < LIMITES_TRABAJO.minLibreHerramientaMs) {
      await c.tb.soltar(t, { proximoEnMs: 0 })
      c.sinTiempo = true
      await (d.encadenar ?? defaultEncadenar)(c.s.cuenta)
      return false
    }
    await c.tb.marcarLlamada(l.id, { estado: 'en_curso' })
    const r = await ejecutar({ id: l.idProveedor, nombre: l.herramienta, argumentos: l.argumentos }, l.id)
    await punto('en-medio-de-herramienta')
    await c.tb.marcarLlamada(l.id, {
      estado: r.estado,
      resultado: r.resultado.partes.map((p) => (p.tipo === 'texto' ? p.texto : '')).join('\n'),
      imagenes: r.imagenes ?? [],
      efectos: r.efectos ?? null,
      inversa: r.inversa ?? null,
    })
  }
  return true
}

/** P8: con todas las llamadas terminadas, UN mensaje con todos los resultados (armado desde el libro: sale igual aunque se haya cortado). */
async function guardarResultados(c: Corrida, t: TrabajoInterno, proveedor: Proveedor, delPaso: LlamadaGuardada[]): Promise<void> {
  await punto('despues-de-herramientas')
  const caps = proveedor.capacidades(t.modelo)
  const enMensaje = caps.imagenesEnResultados
  const resultados: ResultadoHerramienta[] = delPaso.map((l) => {
    const esError = l.estado !== 'hecha'
    const partes: ParteUsuario[] = [{ tipo: 'texto', texto: l.resultado ?? (l.estado === 'hecha' ? 'Listo.' : l.motivo ?? 'No se ejecutó.') }]
    if (enMensaje) for (const ruta of l.imagenes) partes.push({ tipo: 'imagen', mime: mimeDe(ruta), ruta })
    return { id: l.idProveedor, nombre: l.herramienta, esError, partes }
  })
  const neutro: MensajeNeutro = { rol: 'herramienta', resultados }
  const guardado: NeutroGuardado = { rol: 'herramienta', resultados: delPaso.map((l) => ({ llamadaId: l.id })) }
  await c.tb.agregarMensaje(t.id, 'herramienta', guardado, proveedor.aNativo(neutro, { modelo: t.modelo }))
  // El proveedor no admite imágenes dentro del resultado: se agrega después un mensaje de usuario con la imagen (7.4).
  if (!enMensaje)
    for (const l of delPaso)
      if (l.imagenes.length) {
        const u: MensajeNeutro = {
          rol: 'usuario',
          partes: [{ tipo: 'texto', texto: `Imagen del resultado de ${l.herramienta}` }, ...l.imagenes.map((ruta) => ({ tipo: 'imagen' as const, mime: mimeDe(ruta), ruta }))],
        }
        await c.tb.agregarMensaje(t.id, 'usuario', u, proveedor.aNativo(u, { modelo: t.modelo }))
      }
  await c.raiz.bus.vaciar()
}

// ───────────────────────── P9: entregar la respuesta y cerrar ─────────────────────────

async function entregarYCerrar(c: Corrida, t: TrabajoInterno, agente: AgenteInterno, msgs: MensajeGuardado[], llamadas: LlamadaGuardada[], textoModelo: string): Promise<void> {
  await punto('antes-de-cerrar')
  const conocidas = conocidasDe(msgs, llamadas, agente, t)
  const filtrado = filtrarRespuesta((textoModelo || '').trim() || TEXTO_FIN_VACIO, conocidas)
  let texto = filtrado.texto
  if (filtrado.quitadas.length) texto += `\n\n(Telar quitó ${filtrado.quitadas.length === 1 ? 'una dirección' : `${filtrado.quitadas.length} direcciones`} que no salió del tablero ni del pedido.)`
  if (texto.length > LIMITES_TRABAJO.respuestaMaxCaracteres) texto = texto.slice(0, LIMITES_TRABAJO.respuestaMaxCaracteres - 1).trimEnd() + '…'

  const actor = actorDeAgente(agente, t.proveedor)
  let comentarioId: string | null = null
  const clave = t.contexto.tarjetaClave
  const ctx = { actor, via: 'ia' as const }
  // La mención (y las otras del mismo texto al mismo agente: dos «@claude» en un comentario son una sola cosa para atender) queda atendida ANTES de
  // publicar: así el aviso «respondió» sale una sola vez, con la clave del trabajo.
  if (t.mencionId)
    await c.s.db.consulta(
      `update menciones set estado = 'atendida', atendida_en = now(), atendida_por = $3::jsonb, trabajo_id = coalesce(trabajo_id, $4)
        where propietario = $2 and estado = 'pendiente' and (id = $1 or (origen_tipo = $5 and origen_id = $6 and destinatario_id = $7))`,
      [t.mencionId, c.s.cuenta, JSON.stringify(actor), t.id, t.contexto.origen?.tipo ?? null, t.contexto.origen?.id ?? null, agente.miembroId],
    )
  if (t.origen !== 'pedido' && clave) {
    const id = `r_${t.id}`
    const publicar = (respuestaA: string | null) => conTanda({ id: t.id, llamadaId: null, efectos: efectosVacios() }, () => c.s.comentar(ctx, clave, texto, { id, respuestaA, trabajoId: t.id }))
    try {
      await publicar(t.contexto.respuestaA ?? null)
    } catch (e) {
      // el comentario al que respondía ya no está: se deja igual, sin hilo
      if (e instanceof ErrorDominio && e.estado === 404 && t.contexto.respuestaA) await publicar(null)
      else throw e
    }
    comentarioId = id
  }
  await punto('despues-de-responder')
  const cerrado = await c.tb.cerrar(t, 'hecho', { motivo: null, resultado: { texto, comentarioId } })
  if (!cerrado) return
  await c.tb.publicar('hecho', cerrado, agente)
  await avisar(c.tb, cerrado, agente, {
    tipo: 'respuesta',
    titulo: t.origen === 'proactivo' ? `${agente.nombre} revisó ${clave ?? 'el tablero'}` : `${agente.nombre} respondió${clave ? ` en ${clave}` : ''}`,
    cuerpo: recortar(texto.replace(/\s+/g, ' '), 140),
    claveUnica: `respuesta:${t.id}`,
  })
  await c.raiz.bus.vaciar()
}

// ───────────────────────── correr una cuenta y el cron ─────────────────────────

/** Corre los trabajos vencidos de una cuenta, hasta quedarse sin tiempo o llegar a tres. Nunca tira (salvo un corte simulado de las pruebas). */
export async function correr(raiz: Servicio, cuenta: string): Promise<void> {
  const d = deps
  if (!d) return
  const desde = Date.now()
  const s = raiz.de(cuenta)
  const tb = trabajosDe(iaDe(s))
  const c: Corrida = { raiz, s, tb, desde }
  const esperar = d.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let hechos = 0
  let esperas = 0
  try {
    while (hechos < 3 && (d.plazo ?? defaultPlazo)(desde) - Date.now() > 20_000) {
      const t = await tb.tomar()
      if (!t) {
        // ¿el próximo vence en 30 s o menos? se espera (dos veces como máximo); si no, se sale
        const falta = await tb.proximoEnMs()
        if (falta !== null && falta <= 30_000 && esperas < 2) {
          esperas++
          await esperar(falta + 50)
          continue
        }
        break
      }
      hechos++
      await correrTrabajo(c, t)
      if (c.sinTiempo) break
    }
  } catch (e) {
    if (e instanceof CorteSimulado) throw e
    console.error('[tablero] ia: falló correr:', e instanceof Error ? e.name : 'error')
  }
}

/** La hora del día (UTC) desde la que el cron arma el resumen diario: 11 UTC son las 8 de la mañana en Argentina. */
export const HORA_RESUMEN_UTC = 11

/** El cron (cada minuto): las cuentas con trabajos vencidos, el resumen diario de los agentes que lo tienen prendido y, al final, el mantenimiento. */
export async function barrer(raiz: Servicio): Promise<{ cuentas: number; limpiados: number }> {
  const d = deps
  const desde = Date.now()
  let cuentas = 0
  if (d) {
    // De sistema (no es un pedido de una cuenta): solo mira qué cuentas tienen algo para correr.
    const filas = await raiz.db.consulta<{ propietario: string }>(
      `select distinct propietario from ia_trabajos where estado in ('en_cola', 'en_curso') and proximo_en <= now() and (tomado_hasta is null or tomado_hasta < now()) limit 20`,
    )
    for (const f of filas) {
      if ((d.plazo ?? defaultPlazo)(desde) - Date.now() < 60_000) break
      cuentas++
      await correr(raiz, f.propietario)
    }
    if ((d.ahora?.() ?? new Date()).getUTCHours() >= HORA_RESUMEN_UTC) {
      const proactivas = await raiz.db.consulta<{ propietario: string }>(
        `select distinct a.propietario from ia_agentes a where a.activo and a.disparadores->'resumenDiario' is not null`,
      )
      for (const f of proactivas) {
        try {
          const creados = await iaDe(raiz.de(f.propietario)).resumenDiario()
          if (creados.length) await correr(raiz, f.propietario)
        } catch (e) {
          if (e instanceof CorteSimulado) throw e
          console.error('[tablero] ia: falló el resumen diario:', e instanceof Error ? e.name : 'error')
        }
      }
    }
  }
  // El respaldo del archivo automático de Hecho (lo normal es que se archive al abrir el tablero): a lo sumo una vez por hora.
  await barrerHechasViejas(raiz).catch((e) => {
    console.error('[tablero] falló el archivo de Hecho del barrido:', e instanceof Error ? e.message : e)
  })
  const { limpiados } = await mantenimiento(raiz.db).catch((e) => {
    console.error('[tablero] ia: falló el mantenimiento:', e instanceof Error ? e.name : 'error')
    return { limpiados: 0 }
  })
  return { cuentas, limpiados }
}

