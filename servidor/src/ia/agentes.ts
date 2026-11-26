// Claves, agentes y ajustes de la IA integrada (plan 10.1, 10.2, 12.2, 12.3, 13.3 y Anexo A.3, tareas 2.2): lo que escribe
// Configuración → IA. Es el cuerpo de los métodos del bloque «A» de `ServicioIA` (servicio-ia.ts los delega acá para que los tres
// agentes de la F2 no se pisen). Todo corre con la cuenta del `ServicioIA` y cada consulta filtra por `propietario`: un id ajeno da
// 404 con el mismo mensaje que uno que no existe (docs/cuentas.md).
//
// La clave en claro SOLO pasa por acá camino a la bóveda (`sellar`) y a la prueba del proveedor: no vuelve en ninguna respuesta,
// evento, error ni registro. Los mensajes del proveedor se pasan por el filtro de claves antes de salir.
//
// Lo que se conecta de afuera (los pone `conectarIA` o quien junta; mientras tanto andan los de abajo):
//   · `ponerProbadorDeClaves`: la prueba barata de una clave con el proveedor (`proveedorDe(id).probar(...)`, tarea B). Sin
//     conectar, la clave se guarda «sin probar» (no se puede decir que anda).
//   · `ponerCatalogoDeModelos`: los modelos conocidos con su costo por respuesta (`PRECIOS` de proveedores/precios.ts, tarea B).
import { createHash } from 'node:crypto'
import {
  CAPACIDADES,
  PERMISOS_DE_FABRICA,
  TOPE_AGENTE_DE_FABRICA_USD,
  TOPE_CUENTA_DE_FABRICA_USD,
  type Agente,
  type AjustesIA,
  type Autonomia,
  type Capacidad,
  type ClaveIA,
  type Disparadores,
  type EntradaAgente,
  type EntradaClave,
  type EstadoAgente,
  type EstadoIA,
  type IdProveedor,
  type ModeloConocido,
  type ModoConfirmar,
  type PrecioManual,
  type ResumenAgente,
  type TipoClave,
  type UsoAgenteMes,
  type UsoIA,
  type UsoTrabajo,
} from '../../../compartido/ia'
import { aliasValido, ALIAS_RESERVADOS } from '../../../compartido/menciones'
import { PREAJUSTES_IA } from '../../../compartido/preajustes-ia'
import type { Color, Miembro } from '../../../compartido/tipos'
import { COLORES } from '../../../compartido/constantes'
import { aMiembro } from '../dominio/filas'
import { ErrorDominio, nuevoId, type Ctx } from '../dominio/servicio'
import { abrirYRenovar, ErrorBoveda, sellar } from './boveda'
import { normalizarRepo, probarTokenGithub } from './codigo'
import { taparClaves } from './filtro-claves'
import { olvidarAgentes } from './menciones'
import { validarUrlBase as validarUrlBaseDeServicio } from './proveedores/compatible'
import { falsoDisponible } from './proveedores/indice'
import { ErrorSinPrecio, precioDelAgente } from './proveedores/precios'
import type { ServicioIA } from './servicio-ia'

type Fila = Record<string, any>

// ───────────────────────── lo que se conecta de afuera ─────────────────────────

export interface PruebaDeClave {
  ok: boolean
  /** Por qué no anda, en castellano y sin la clave. */
  error?: string
  /** true: no se pudo probar (todavía no hay adaptador del proveedor, o no tiene una prueba barata): se guarda `sin_probar`. */
  sinProbar?: boolean
  modelos?: string[]
}
export type ProbadorDeClaves = (e: { proveedor: IdProveedor; clave: string; urlBase?: string }) => Promise<PruebaDeClave>
let probador: ProbadorDeClaves = async () => ({ ok: true, sinProbar: true })
/** Conecta la prueba de claves con los proveedores (B). */
export function ponerProbadorDeClaves(fn: ProbadorDeClaves): void {
  probador = fn
}
/** La prueba de una clave con el proveedor. Hasta que B la conecte devuelve «sin probar». */
export const probarConProveedor: ProbadorDeClaves = (e) => probador(e)

export type CatalogoDeModelos = () => ModeloConocido[]
let catalogo: CatalogoDeModelos = () => []
/** Conecta el catálogo de modelos y precios (B). */
export function ponerCatalogoDeModelos(fn: CatalogoDeModelos): void {
  catalogo = fn
}

// ───────────────────────── números y listas fijas ─────────────────────────

export const MAX_CLAVES = 20
export const MAX_NOMBRE_CLAVE = 60
export const MAX_NOMBRE_AGENTE = 40
export const MAX_INSTRUCCIONES = 4_000
export const MAX_MODELO = 100
export const MAX_REPOS_CODIGO = 20
export const TOPE_MIN_USD = 0.01
export const TOPE_MAX_USD = 100_000
/** Pruebas de clave por cuenta: 10 por hora (12.10). */
const PRUEBAS_POR_HORA = 10

export const TIPOS_DE_CLAVE: readonly TipoClave[] = ['anthropic', 'openai', 'compatible', 'falso', 'disparador', 'github']
const PROVEEDORES_DE_AGENTE: readonly IdProveedor[] = ['anthropic', 'openai', 'compatible', 'falso']
const CONFIRMAR: readonly ModoConfirmar[] = ['nunca', 'peligrosas', 'siempre']
const ESFUERZOS = ['bajo', 'medio', 'alto'] as const
const MODELO_DE_FABRICA: Partial<Record<IdProveedor, string>> = { anthropic: 'claude-opus-5-5' }
const COLORES_IA: Color[] = ['naranja', 'violeta', 'celeste', 'verde', 'rosa']
const SISTEMA = { tipo: 'sistema', id: 'sistema', nombre: 'Telar' } as const

const nombreDeProveedor = (p: string): string =>
  ({ anthropic: 'Anthropic', openai: 'OpenAI', compatible: 'El proveedor', falso: 'El proveedor de prueba', disparador: 'La tarea de Claude Code', github: 'GitHub' })[p] ?? 'El proveedor'

const mesActual = () => new Date().toISOString().slice(0, 7)
const redondear = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const aIso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null)

function traducirBoveda(e: unknown): never {
  if (e instanceof ErrorBoveda) throw new ErrorDominio(e.motivo === 'sin_secreto' ? e.message : 'No pude abrir la clave guardada: pegá la clave de nuevo.', e.motivo === 'sin_secreto' ? 503 : 409)
  throw e
}

// ───────────────────────── direcciones ─────────────────────────

/**
 * Una dirección base de un proveedor o de una tarea: la regla es UNA sola, la de `validarUrlBase` de proveedores/compatible.ts (la misma que
 * aplica el adaptador al hablar): online, https y nada de redes privadas, de la propia máquina ni de metadatos; en la computadora también se
 * acepta http con algo de la casa (Ollama, LM Studio). Devuelve la dirección normalizada o tira un 400 con el motivo en castellano.
 */
export function validarUrlBase(crudo: unknown, que = 'La dirección'): string {
  const texto = String(crudo ?? '').trim()
  if (!texto) throw new ErrorDominio(`${que} es obligatoria.`)
  const v = validarUrlBaseDeServicio(texto)
  if (!v.ok) throw new ErrorDominio(v.motivo)
  return v.url
}

// ───────────────────────── claves ─────────────────────────

function aClave(f: Fila, enUso: string[]): ClaveIA {
  return {
    id: f.id,
    proveedor: f.proveedor,
    nombre: f.nombre,
    urlBase: f.url_base ?? null,
    ultimos4: f.ultimos4 ?? '',
    estado: f.estado,
    probadaEn: aIso(f.probada_en),
    error: f.error ?? null,
    enUso,
  }
}

async function usosDeClaves(ia: ServicioIA): Promise<Map<string, string[]>> {
  const filas = await ia.db.consulta(
    `select a.clave_id, a.miembro_id from ia_agentes a join miembros m on m.id = a.miembro_id
     where a.propietario = $1 and m.propietario = $1 and not coalesce(m.archivado, false) and a.clave_id is not null`,
    [ia.cuenta],
  )
  const usos = new Map<string, string[]>()
  for (const f of filas) usos.set(f.clave_id, [...(usos.get(f.clave_id) ?? []), f.miembro_id])
  return usos
}

async function filaDeClave(ia: ServicioIA, id: unknown): Promise<Fila> {
  if (typeof id !== 'string' || !id) throw new ErrorDominio('No existe esa clave.', 404)
  const [f] = await ia.db.consulta(`select * from ia_claves where id = $1 and propietario = $2`, [id, ia.cuenta])
  if (!f) throw new ErrorDominio('No existe esa clave.', 404)
  return f
}

async function claveResumen(ia: ServicioIA, id: string): Promise<ClaveIA> {
  const f = await filaDeClave(ia, id)
  return aClave(f, (await usosDeClaves(ia)).get(id) ?? [])
}

/** 10 pruebas por hora y por cuenta, contadas en la tabla `intentos` (Vercel no guarda memoria entre pedidos). */
async function contarPrueba(ia: ServicioIA): Promise<void> {
  const clave = `ia-prueba:${createHash('sha256').update(ia.cuenta).digest('hex').slice(0, 32)}`
  const [f] = await ia.db.consulta<{ n: number }>(`select count(*)::int as n from intentos where clave = $1 and en > now() - interval '1 hour'`, [clave])
  if (Number(f?.n ?? 0) >= PRUEBAS_POR_HORA) throw new ErrorDominio('Probaste muchas veces. Esperá un rato.', 429)
  await ia.db.consulta(`insert into intentos (clave) values ($1)`, [clave])
}

/** Prueba una clave con su proveedor. Lo que falle de nuestro lado (la red, el proveedor caído) tira 502 y no cambia nada. */
async function probar(ia: ServicioIA, tipo: TipoClave, clave: string, urlBase: string | null): Promise<PruebaDeClave> {
  if (tipo === 'disparador') return { ok: true, sinProbar: true } // probarla sería dispararla
  await contarPrueba(ia)
  try {
    const r = tipo === 'github' ? await probarTokenGithub(clave) : await probarConProveedor({ proveedor: tipo, clave, urlBase: urlBase ?? undefined })
    return r.ok ? r : { ok: false, error: limpiarError(r.error, clave, tipo) }
  } catch {
    throw new ErrorDominio(`No pude hablar con ${nombreDeProveedor(tipo)} para probar la clave. Probá de nuevo en un rato.`, 502)
  }
}

function limpiarError(error: string | undefined, clave: string, tipo: string): string {
  const t = taparClaves(error || `${nombreDeProveedor(tipo)} no aceptó la clave: revisá que esté completa.`, [clave]).replace(/\s+/g, ' ').trim()
  return t.length > 300 ? t.slice(0, 297) + '…' : t
}

function validarClave(crudo: unknown): string {
  const clave = String(crudo ?? '').trim()
  if (clave.length < 8 || clave.length > 2_000 || /\s/.test(clave) || /[\u0000-\u001f]/.test(clave))
    throw new ErrorDominio('La clave no parece completa: pegala entera, sin espacios ni saltos de línea.')
  return clave
}

function validarNombreClave(crudo: unknown): string {
  const nombre = String(crudo ?? '').trim().replace(/\s+/g, ' ')
  if (!nombre || nombre.length > MAX_NOMBRE_CLAVE) throw new ErrorDominio(`Ponele un nombre a la clave (hasta ${MAX_NOMBRE_CLAVE} caracteres).`)
  return nombre
}

function validarTipo(crudo: unknown): TipoClave {
  if (!TIPOS_DE_CLAVE.includes(crudo as TipoClave)) {
    const comoCompatible = ['gemini', 'deepseek', 'gpt'].includes(String(crudo)) ? ' Gemini y DeepSeek se cargan como «compatible», con su dirección (la pantalla la completa sola).' : ''
    throw new ErrorDominio(`Ese proveedor no existe. Los que hay: ${TIPOS_DE_CLAVE.filter((t) => t !== 'falso').join(', ')}.${comoCompatible}`)
  }
  // El proveedor de prueba lo decide el registro (TABLERO_IA_FALSO=1 y nunca en Vercel): una sola regla
  if (crudo === 'falso' && !falsoDisponible()) throw new ErrorDominio('El proveedor de prueba no está habilitado.')
  return crudo as TipoClave
}

/** La dirección que corresponde al tipo: `compatible` y `disparador` la piden; los demás no la usan. */
function urlDelTipo(tipo: TipoClave, crudo: unknown): string | null {
  if (tipo === 'compatible') return validarUrlBase(crudo, 'La dirección de la API')
  if (tipo === 'disparador') {
    const u = validarUrlBase(crudo, 'La dirección de la tarea')
    return u
  }
  return null
}

export async function guardarClave(ia: ServicioIA, e: EntradaClave): Promise<ClaveIA> {
  if (!e || typeof e !== 'object') throw new ErrorDominio('Faltan los datos de la clave.')
  const nombre = validarNombreClave(e.nombre)
  return e.id !== undefined && e.id !== null ? cambiarClave(ia, e, nombre) : crearClave(ia, e, nombre)
}

async function crearClave(ia: ServicioIA, e: EntradaClave, nombre: string): Promise<ClaveIA> {
  const tipo = validarTipo(e.proveedor)
  const clave = validarClave(e.clave)
  const urlBase = urlDelTipo(tipo, e.urlBase)
  const [cuantas] = await ia.db.consulta<{ n: number }>(`select count(*)::int as n from ia_claves where propietario = $1`, [ia.cuenta])
  if (Number(cuantas?.n ?? 0) >= MAX_CLAVES) throw new ErrorDominio(`Ya hay ${MAX_CLAVES} claves cargadas: quitá alguna que no uses.`, 409)
  if (tipo === 'github') {
    const [otra] = await ia.db.consulta(`select id from ia_claves where propietario = $1 and proveedor = 'github'`, [ia.cuenta])
    if (otra) throw new ErrorDominio('Ya hay un token de GitHub cargado: cambialo en vez de agregar otro.', 409)
  }
  const prueba = await probar(ia, tipo, clave, urlBase)
  if (!prueba.ok) throw new ErrorDominio(prueba.error!, 400)
  const id = nuevoId()
  let sellado
  try {
    sellado = sellar(clave, { propietario: ia.cuenta, id })
  } catch (x) {
    traducirBoveda(x)
  }
  const valida = !prueba.sinProbar
  await ia.db.consulta(
    `insert into ia_claves (id, propietario, proveedor, nombre, url_base, cifrada, version, ultimos4, estado, probada_en, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${valida ? 'now()' : 'null'}, null)`,
    [id, ia.cuenta, tipo, nombre, urlBase, Buffer.from(sellado.cifrada), sellado.version, sellado.ultimos4, valida ? 'valida' : 'sin_probar'],
  )
  return claveResumen(ia, id)
}

async function cambiarClave(ia: ServicioIA, e: EntradaClave, nombre: string): Promise<ClaveIA> {
  const f = await filaDeClave(ia, e.id)
  const tipo = f.proveedor as TipoClave
  if (e.proveedor !== undefined && e.proveedor !== tipo) throw new ErrorDominio('No se puede cambiar el proveedor de una clave: cargá otra.')
  const urlBase = tipo === 'compatible' || tipo === 'disparador' ? (e.urlBase === undefined ? (f.url_base ?? null) : urlDelTipo(tipo, e.urlBase)) : null
  const cambioUrl = (urlBase ?? null) !== (f.url_base ?? null)

  // Una clave nueva (o una dirección nueva) se prueba antes de guardar: lo inválido no pisa lo que andaba.
  let nueva: string | null = null
  if (e.clave !== undefined && e.clave !== null && e.clave !== '') nueva = validarClave(e.clave)
  if (nueva || cambioUrl) {
    let clave = nueva
    if (!clave) {
      try {
        clave = abrirYRenovar({ cifrada: f.cifrada, version: f.version }, { propietario: ia.cuenta, id: f.id }).clave
      } catch (x) {
        if (x instanceof ErrorBoveda && x.motivo !== 'sin_secreto') throw new ErrorDominio('Para cambiar la dirección pegá la clave de nuevo: la guardada no se puede abrir.', 409)
        traducirBoveda(x)
      }
    }
    const prueba = await probar(ia, tipo, clave!, urlBase)
    if (!prueba.ok) throw new ErrorDominio(prueba.error!, 400)
    const valida = !prueba.sinProbar
    let sellado = null as ReturnType<typeof sellar> | null
    if (nueva) {
      try {
        sellado = sellar(nueva, { propietario: ia.cuenta, id: f.id })
      } catch (x) {
        traducirBoveda(x)
      }
    }
    await ia.db.consulta(
      `update ia_claves set nombre = $3, url_base = $4, estado = $5, probada_en = ${valida ? 'now()' : 'null'}, error = null, actualizado_en = now()
         ${sellado ? ', cifrada = $6, version = $7, ultimos4 = $8' : ''}
       where id = $1 and propietario = $2`,
      [f.id, ia.cuenta, nombre, urlBase, valida ? 'valida' : 'sin_probar', ...(sellado ? [Buffer.from(sellado.cifrada), sellado.version, sellado.ultimos4] : [])],
    )
  } else {
    await ia.db.consulta(`update ia_claves set nombre = $3, actualizado_en = now() where id = $1 and propietario = $2`, [f.id, ia.cuenta, nombre])
  }
  return claveResumen(ia, f.id)
}

export async function probarClave(ia: ServicioIA, id: string): Promise<ClaveIA> {
  const f = await filaDeClave(ia, id)
  const tipo = f.proveedor as TipoClave
  let clave: string
  try {
    const r = abrirYRenovar({ cifrada: f.cifrada, version: f.version }, { propietario: ia.cuenta, id: f.id })
    clave = r.clave
    if (r.renovada) {
      // abrió con el secreto anterior: se guarda vuelta a cifrar con el actual
      await ia.db.consulta(`update ia_claves set cifrada = $3, version = $4, ultimos4 = $5 where id = $1 and propietario = $2`, [f.id, ia.cuenta, Buffer.from(r.renovada.cifrada), r.renovada.version, r.renovada.ultimos4])
    }
  } catch (x) {
    if (x instanceof ErrorBoveda && x.motivo !== 'sin_secreto') {
      await ia.db.consulta(
        `update ia_claves set estado = 'invalida', probada_en = now(), error = $3 where id = $1 and propietario = $2`,
        [f.id, ia.cuenta, 'Hay que volver a cargarla: cambió el secreto del servidor y no se puede abrir.'],
      )
      return claveResumen(ia, f.id)
    }
    return traducirBoveda(x)
  }
  const prueba = await probar(ia, tipo, clave, f.url_base ?? null)
  if (prueba.sinProbar) {
    await ia.db.consulta(`update ia_claves set estado = 'sin_probar', probada_en = null, error = null where id = $1 and propietario = $2`, [f.id, ia.cuenta])
  } else if (prueba.ok) {
    await ia.db.consulta(`update ia_claves set estado = 'valida', probada_en = now(), error = null where id = $1 and propietario = $2`, [f.id, ia.cuenta])
  } else {
    await ia.db.consulta(`update ia_claves set estado = 'invalida', probada_en = now(), error = $3 where id = $1 and propietario = $2`, [f.id, ia.cuenta, prueba.error])
  }
  return claveResumen(ia, f.id)
}

export async function quitarClave(ia: ServicioIA, id: string): Promise<void> {
  const f = await filaDeClave(ia, id)
  // Los agentes que la usaban quedan `sin_clave` (la columna se anula sola: on delete set null).
  await ia.db.consulta(`delete from ia_claves where id = $1 and propietario = $2`, [f.id, ia.cuenta])
}

// ───────────────────────── ajustes ─────────────────────────

const AJUSTES_DE_FABRICA = (): Omit<AjustesIA, 'gastoMesUsd'> => ({
  topeMesUsd: TOPE_CUENTA_DE_FABRICA_USD,
  pausada: false,
  confirmarMcp: false,
  externasDisparan: false,
  reposCodigo: [],
})

async function leerAjustes(ia: ServicioIA): Promise<Omit<AjustesIA, 'gastoMesUsd'>> {
  const [f] = await ia.db.consulta(`select * from ia_ajustes where propietario = $1`, [ia.cuenta])
  if (!f) return AJUSTES_DE_FABRICA()
  return {
    topeMesUsd: num(f.tope_mes_usd),
    pausada: Boolean(f.pausada),
    confirmarMcp: Boolean(f.confirmar_mcp),
    externasDisparan: Boolean(f.externas_disparan),
    reposCodigo: Array.isArray(f.repos_codigo) ? f.repos_codigo : [],
  }
}

async function gastoDeLaCuenta(ia: ServicioIA, mes: string): Promise<number> {
  const [f] = await ia.db.consulta(`select coalesce(sum(costo_usd), 0) as t from ia_uso_mes where propietario = $1 and mes = $2`, [ia.cuenta, mes])
  return num(f?.t)
}

function validarTope(v: unknown, que: string): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < TOPE_MIN_USD || n > TOPE_MAX_USD)
    throw new ErrorDominio(`${que}: poné un monto en dólares entre ${TOPE_MIN_USD} y ${TOPE_MAX_USD}.`)
  return redondear(n)
}

function validarBool(v: unknown, que: string): boolean {
  if (typeof v !== 'boolean') throw new ErrorDominio(`${que}: tiene que ser sí o no.`)
  return v
}

export async function guardarAjustes(
  ia: ServicioIA,
  a: Partial<Pick<AjustesIA, 'topeMesUsd' | 'pausada' | 'confirmarMcp' | 'externasDisparan' | 'reposCodigo'>>,
): Promise<AjustesIA> {
  const actuales = await leerAjustes(ia)
  const n = { ...actuales }
  if (a.topeMesUsd !== undefined) n.topeMesUsd = validarTope(a.topeMesUsd, 'El tope de la cuenta')
  if (a.pausada !== undefined) n.pausada = validarBool(a.pausada, 'Pausar toda la IA')
  if (a.confirmarMcp !== undefined) n.confirmarMcp = validarBool(a.confirmarMcp, 'Pedir confirmación también por MCP')
  if (a.externasDisparan !== undefined) n.externasDisparan = validarBool(a.externasDisparan, 'Las IA de afuera pueden pedirle a mis agentes')
  if (a.reposCodigo !== undefined) n.reposCodigo = validarRepos(a.reposCodigo)
  await ia.db.consulta(
    `insert into ia_ajustes (propietario, tope_mes_usd, pausada, confirmar_mcp, externas_disparan, repos_codigo, actualizado_en)
     values ($1, $2, $3, $4, $5, $6::text[], now())
     on conflict (propietario) do update set tope_mes_usd = excluded.tope_mes_usd, pausada = excluded.pausada, confirmar_mcp = excluded.confirmar_mcp,
       externas_disparan = excluded.externas_disparan, repos_codigo = excluded.repos_codigo, actualizado_en = now()`,
    [ia.cuenta, n.topeMesUsd, n.pausada, n.confirmarMcp, n.externasDisparan, n.reposCodigo],
  )
  olvidarAgentes(ia.cuenta)
  return { ...n, gastoMesUsd: await gastoDeLaCuenta(ia, mesActual()) }
}

function validarRepos(v: unknown): string[] {
  if (!Array.isArray(v)) throw new ErrorDominio('Los repos de código tienen que ser una lista de «dueño/repo».')
  const repos: string[] = []
  for (const crudo of v) {
    const r = normalizarRepo(String(crudo ?? ''))
    if (!r) throw new ErrorDominio(`«${taparClaves(String(crudo).slice(0, 80))}» no es un repo de GitHub: escribilo como dueño/repo (por ejemplo <usuario>/<repo-del-juego>).`)
    if (!repos.includes(r)) repos.push(r)
  }
  if (repos.length > MAX_REPOS_CODIGO) throw new ErrorDominio(`Pueden ser hasta ${MAX_REPOS_CODIGO} repos.`)
  return repos
}

// ───────────────────────── agentes ─────────────────────────

/** Cómo está un agente hoy: pausado, en el tope, sin clave, con la clave rota o listo. */
export function estadoDeAgente(a: {
  activo: boolean
  modo: 'api' | 'disparador'
  claveId: string | null
  claveEstado: string | null
  topeMesUsd: number
  gastoMesUsd: number
}, cuenta: { pausada: boolean; topeMesUsd: number; gastoMesUsd: number }): EstadoAgente {
  if (!a.activo || cuenta.pausada) return 'pausado'
  if (a.gastoMesUsd >= a.topeMesUsd || cuenta.gastoMesUsd >= cuenta.topeMesUsd) return 'en_tope'
  if (!a.claveId) return 'sin_clave'
  if (a.claveEstado === 'invalida') return 'clave_invalida'
  return 'listo'
}

function aAgente(f: Fila, gasto: number, cuenta: { pausada: boolean; topeMesUsd: number; gastoMesUsd: number }): Agente {
  const permisos = (Array.isArray(f.permisos) ? f.permisos : []) as Capacidad[]
  const a: Agente = {
    miembroId: f.miembro_id,
    nombre: f.nombre,
    alias: f.alias ?? '',
    color: f.color as Color,
    modo: f.modo,
    proveedor: f.proveedor ?? null,
    modelo: f.modelo ?? null,
    claveId: f.clave_id ?? null,
    esfuerzo: f.esfuerzo ?? null,
    instrucciones: f.instrucciones ?? '',
    permisos: CAPACIDADES.filter((c) => permisos.includes(c)),
    confirmar: f.confirmar,
    puedeMencionarIA: Boolean(f.puede_mencionar_ia),
    topeMesUsd: num(f.tope_mes_usd),
    gastoMesUsd: gasto,
    precioManual: (f.precio_manual as PrecioManual | null) ?? null,
    veImagenes: f.ve_imagenes ?? null,
    autonomia: f.autonomia ?? 'sugiere',
    disparadores: (f.disparadores as Disparadores | null) ?? {},
    activo: Boolean(f.activo),
    estado: 'listo',
  }
  a.estado = estadoDeAgente({ ...a, claveEstado: f.clave_estado ?? null }, cuenta)
  return a
}

const SQL_AGENTES = `
  select a.*, m.nombre, m.alias, m.color, m.archivado, c.estado as clave_estado
  from ia_agentes a
  join miembros m on m.id = a.miembro_id
  left join ia_claves c on c.id = a.clave_id and c.propietario = a.propietario
  where a.propietario = $1 and m.propietario = $1`

/** Los agentes de la cuenta (sin los archivados), con su gasto del mes y su estado. */
export async function agentesDeLaCuenta(ia: ServicioIA, o: { incluirArchivados?: boolean } = {}): Promise<{ agentes: Agente[]; cuenta: AjustesIA }> {
  const mes = mesActual()
  const [filas, ajustes, gastos] = await Promise.all([
    ia.db.consulta(`${SQL_AGENTES} ${o.incluirArchivados ? '' : 'and not coalesce(m.archivado, false)'} order by m.nombre`, [ia.cuenta]),
    leerAjustes(ia),
    ia.db.consulta(`select agente_id, costo_usd from ia_uso_mes where propietario = $1 and mes = $2`, [ia.cuenta, mes]),
  ])
  const porAgente = new Map<string, number>(gastos.map((g) => [g.agente_id as string, num(g.costo_usd)]))
  const total = gastos.reduce((s, g) => s + num(g.costo_usd), 0)
  const cuenta: AjustesIA = { ...ajustes, gastoMesUsd: total }
  return { agentes: filas.map((f) => aAgente(f, porAgente.get(f.miembro_id) ?? 0, cuenta)), cuenta }
}

export async function estado(ia: ServicioIA): Promise<EstadoIA> {
  const [{ agentes, cuenta }, claves, usos] = await Promise.all([
    agentesDeLaCuenta(ia),
    ia.db.consulta(`select * from ia_claves where propietario = $1 order by creado_en, id`, [ia.cuenta]),
    usosDeClaves(ia),
  ])
  return {
    agentes,
    claves: claves.map((f) => aClave(f, usos.get(f.id) ?? [])),
    ajustes: cuenta,
    modelos: catalogo(),
    preajustes: PREAJUSTES_IA,
    puedeCambiar: true,
  }
}

/** El resumen de cada agente de la cuenta, para `GET /api/miembros`. Una sola consulta si no hay ninguno. */
export async function resumenesDeAgentes(ia: ServicioIA): Promise<Map<string, ResumenAgente>> {
  const hay = await ia.db.consulta(`select 1 from ia_agentes where propietario = $1 limit 1`, [ia.cuenta])
  const mapa = new Map<string, ResumenAgente>()
  if (!hay.length) return mapa
  const { agentes } = await agentesDeLaCuenta(ia)
  for (const a of agentes) mapa.set(a.miembroId, { modo: a.modo, estado: a.estado, modelo: a.modelo })
  return mapa
}

/** Les suma a los miembros el resumen de su agente (los que son agentes de la IA integrada). */
export async function conResumenDeAgentes(ia: ServicioIA, miembros: Miembro[]): Promise<Miembro[]> {
  if (!miembros.some((m) => m.tipo === 'ia')) return miembros
  const mapa = await resumenesDeAgentes(ia)
  if (!mapa.size) return miembros
  return miembros.map((m) => (mapa.has(m.id) ? { ...m, agente: mapa.get(m.id)! } : m))
}

// ─── validar lo que viene de la pantalla ───

function validarPermisos(v: unknown): Capacidad[] {
  if (!Array.isArray(v)) throw new ErrorDominio('Los permisos tienen que ser una lista.')
  for (const p of v) if (!CAPACIDADES.includes(p as Capacidad)) throw new ErrorDominio(`«${taparClaves(String(p).slice(0, 40))}» no es un permiso. Los que hay: ${CAPACIDADES.join(', ')}.`)
  return CAPACIDADES.filter((c) => (v as string[]).includes(c))
}

function validarPrecio(v: unknown): PrecioManual | null {
  if (v === null) return null
  const p = v as Partial<PrecioManual>
  const campo = (x: unknown, que: string) => {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 10_000) throw new ErrorDominio(`El precio de ${que} tiene que ser un número de USD por millón de tokens (de 0 a 10000).`)
    return x
  }
  if (!p || typeof p !== 'object') throw new ErrorDominio('El precio tiene que traer entrada, salida y cacheLectura.')
  return { entrada: campo(p.entrada, 'entrada'), salida: campo(p.salida, 'salida'), cacheLectura: campo(p.cacheLectura ?? 0, 'lectura de caché') }
}

async function validarDisparadores(ia: ServicioIA, v: unknown): Promise<Disparadores> {
  if (v === null || v === undefined) return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw new ErrorDominio('Los disparadores tienen que ser un objeto.')
  const d = v as Disparadores
  const salida: Disparadores = {}
  if (d.tarjetaNueva !== undefined && d.tarjetaNueva !== null) {
    const listas = d.tarjetaNueva.listas
    if (!Array.isArray(listas) || listas.some((l) => typeof l !== 'string')) throw new ErrorDominio('Elegí las listas que revisa cuando entra una tarjeta.')
    if (listas.length > 50) throw new ErrorDominio('Demasiadas listas.')
    await ia.s.propios('lista', listas)
    if (listas.length) salida.tarjetaNueva = { listas: [...new Set(listas)] }
  }
  if (d.resumenDiario !== undefined && d.resumenDiario !== null) {
    const t = d.resumenDiario.tableroId
    if (t !== null && typeof t !== 'string') throw new ErrorDominio('El tablero del resumen diario no es válido.')
    if (t) await ia.s.propio('tablero', t)
    salida.resumenDiario = { tableroId: t ?? null }
  }
  if (d.maxPorDia !== undefined) {
    if (!Number.isInteger(d.maxPorDia) || d.maxPorDia < 1 || d.maxPorDia > 200) throw new ErrorDominio('El máximo de trabajos proactivos por día va de 1 a 200.')
    salida.maxPorDia = d.maxPorDia
  }
  return salida
}

function validarNombreAgente(v: unknown): string {
  const nombre = String(v ?? '').trim().replace(/\s+/g, ' ')
  if (!nombre) throw new ErrorDominio('Ponele un nombre al agente.')
  if (nombre.length > MAX_NOMBRE_AGENTE) throw new ErrorDominio(`El nombre puede tener hasta ${MAX_NOMBRE_AGENTE} caracteres.`)
  return nombre
}

function validarAlias(v: unknown): string {
  const alias = String(v ?? '').trim().replace(/^@/, '').toLowerCase()
  if (ALIAS_RESERVADOS.includes(alias)) throw new ErrorDominio(`«${alias}» está reservado (${ALIAS_RESERVADOS.join(', ')}): elegí otro alias.`, 409)
  if (!aliasValido(alias))
    throw new ErrorDominio('El alias tiene entre 2 y 32 caracteres (letras sin acento, números, _ . -), empieza con letra o número y no termina en . _ -.')
  return alias
}

/** Los campos de un agente, ya validados (solo los que vinieron). */
interface CamposAgente {
  nombre?: string
  alias?: string
  color?: Color
  modo?: 'api' | 'disparador'
  proveedor?: IdProveedor | null
  modelo?: string | null
  claveId?: string | null
  esfuerzo?: 'bajo' | 'medio' | 'alto' | null
  instrucciones?: string
  permisos?: Capacidad[]
  confirmar?: ModoConfirmar
  puedeMencionarIA?: boolean
  topeMesUsd?: number
  precioManual?: PrecioManual | null
  veImagenes?: boolean | null
  autonomia?: Autonomia
  disparadores?: Disparadores
  activo?: boolean
}

async function validarCampos(ia: ServicioIA, e: EntradaAgente): Promise<CamposAgente> {
  const c: CamposAgente = {}
  if (e.nombre !== undefined) c.nombre = validarNombreAgente(e.nombre)
  if (e.alias !== undefined && e.alias !== null && String(e.alias).trim() !== '') c.alias = validarAlias(e.alias)
  if (e.color !== undefined) {
    if (!COLORES.some((x) => x.id === e.color)) throw new ErrorDominio('Ese color no existe.')
    c.color = e.color
  }
  if (e.modo !== undefined) {
    if (e.modo !== 'api' && e.modo !== 'disparador') throw new ErrorDominio('El modo del agente es «api» o «disparador».')
    c.modo = e.modo
  }
  if (e.proveedor !== undefined && e.proveedor !== null) {
    if (!PROVEEDORES_DE_AGENTE.includes(e.proveedor)) throw new ErrorDominio(`El proveedor tiene que ser uno de: ${PROVEEDORES_DE_AGENTE.filter((p) => p !== 'falso').join(', ')}.`)
    if (e.proveedor === 'falso' && !falsoDisponible()) throw new ErrorDominio('El proveedor de prueba no está habilitado.')
    c.proveedor = e.proveedor
  } else if (e.proveedor === null) c.proveedor = null
  if (e.modelo !== undefined && e.modelo !== null) {
    const m = String(e.modelo).trim()
    if (!m || m.length > MAX_MODELO || /\s/.test(m)) throw new ErrorDominio('Elegí un modelo (sin espacios).')
    c.modelo = m
  } else if (e.modelo === null) c.modelo = null
  if (e.claveId !== undefined) c.claveId = e.claveId === null || e.claveId === '' ? null : String(e.claveId)
  if (e.esfuerzo !== undefined) {
    if (e.esfuerzo !== null && !ESFUERZOS.includes(e.esfuerzo)) throw new ErrorDominio('El esfuerzo es bajo, medio, alto o ninguno.')
    c.esfuerzo = e.esfuerzo
  }
  if (e.instrucciones !== undefined) {
    const t = String(e.instrucciones ?? '')
    if (t.length > MAX_INSTRUCCIONES) throw new ErrorDominio(`Las instrucciones pueden tener hasta ${MAX_INSTRUCCIONES} caracteres.`)
    c.instrucciones = t
  }
  if (e.permisos !== undefined) c.permisos = validarPermisos(e.permisos)
  if (e.confirmar !== undefined) {
    if (!CONFIRMAR.includes(e.confirmar)) throw new ErrorDominio('«Pedime confirmación» es: nunca, peligrosas o siempre.')
    c.confirmar = e.confirmar
  }
  if (e.puedeMencionarIA !== undefined) c.puedeMencionarIA = validarBool(e.puedeMencionarIA, 'Puede mencionar a otras IA')
  if (e.topeMesUsd !== undefined) c.topeMesUsd = validarTope(e.topeMesUsd, 'El tope del agente')
  if (e.precioManual !== undefined) c.precioManual = validarPrecio(e.precioManual)
  if (e.veImagenes !== undefined) {
    if (e.veImagenes !== null && typeof e.veImagenes !== 'boolean') throw new ErrorDominio('«Ve imágenes» es sí, no o no se sabe.')
    c.veImagenes = e.veImagenes
  }
  if (e.autonomia !== undefined) {
    if (e.autonomia !== 'sugiere' && e.autonomia !== 'actua') throw new ErrorDominio('La autonomía es «sugiere» o «actua».')
    c.autonomia = e.autonomia
  }
  if (e.disparadores !== undefined) c.disparadores = await validarDisparadores(ia, e.disparadores)
  if (e.activo !== undefined) c.activo = validarBool(e.activo, 'Activo')
  return c
}

/** Un agente completo y coherente: el modo, el proveedor, el modelo y que la clave sea de la cuenta y del proveedor. */
async function verificarCoherencia(ia: ServicioIA, a: { modo: 'api' | 'disparador'; proveedor: IdProveedor | null; modelo: string | null; claveId: string | null }): Promise<void> {
  if (a.modo === 'api') {
    if (!a.proveedor || !a.modelo) throw new ErrorDominio('Elegí el proveedor y el modelo del agente.')
  }
  if (a.claveId) {
    const [k] = await ia.db.consulta(`select proveedor from ia_claves where id = $1 and propietario = $2`, [a.claveId, ia.cuenta])
    if (!k) throw new ErrorDominio('No existe esa clave.', 404)
    if (a.modo === 'disparador') {
      if (k.proveedor !== 'disparador') throw new ErrorDominio('Un agente por disparo usa la dirección y el token de su tarea de Claude Code.')
    } else if (k.proveedor !== a.proveedor) {
      throw new ErrorDominio(`Esa clave es de ${nombreDeProveedor(k.proveedor)} y el agente usa ${nombreDeProveedor(a.proveedor!)}: elegí otra.`)
    }
  }
}

/**
 * Sin precio no hay tope que frene el gasto: un agente de un modelo que Telar no conoce, sin el precio que escribió el dueño, no se activa
 * (9.2, 16.8). Para «compatible» el precio conocido depende de la dirección de la clave (api.deepseek.com, Gemini).
 */
async function verificarPrecio(ia: ServicioIA, a: { proveedor: IdProveedor; modelo: string; claveId: string | null; precioManual: PrecioManual | null }): Promise<void> {
  if (a.proveedor === 'falso') return
  let urlBase: string | null = null
  if (a.claveId) {
    const [k] = await ia.db.consulta(`select url_base from ia_claves where id = $1 and propietario = $2`, [a.claveId, ia.cuenta])
    urlBase = k?.url_base ?? null
  }
  try {
    precioDelAgente({ proveedor: a.proveedor, modelo: a.modelo, urlBase, precioManual: a.precioManual })
  } catch (x) {
    if (x instanceof ErrorSinPrecio) throw new ErrorDominio(x.paraLaPersona, 400)
    throw x
  }
}

function publicarMiembro(ia: ServicioIA, ctx: Ctx | undefined, f: Fila, accion: 'creado' | 'actualizado') {
  ia.s.bus.publicar({ tipo: 'miembro', accion, actor: ctx?.actor ?? SISTEMA, clienteId: ctx?.clienteId, datos: aMiembro(f) })
}

/**
 * Crea un agente o cambia uno. El agente es un miembro de la cuenta (`tipo: 'ia'`) con su configuración en `ia_agentes`. Al crear con
 * un nombre que ya tiene un miembro IA sin configuración (el «Claude» que entra por MCP), se reutiliza ese miembro: es la misma IA.
 */
export async function guardarAgente(ia: ServicioIA, e: EntradaAgente, ctx?: Ctx): Promise<Agente> {
  if (!e || typeof e !== 'object') throw new ErrorDominio('Faltan los datos del agente.')
  const c = await validarCampos(ia, e)
  const cuenta = ia.cuenta
  let miembro: Fila | undefined
  let fila: Fila | undefined
  let nuevoMiembro = false

  if (e.miembroId !== undefined && e.miembroId !== null) {
    if (typeof e.miembroId !== 'string') throw new ErrorDominio('No existe ese miembro.', 404)
    await ia.s.propio('miembro', e.miembroId)
    ;[miembro] = await ia.db.consulta(`select * from miembros where id = $1 and propietario = $2`, [e.miembroId, cuenta])
    if (!miembro) throw new ErrorDominio('No existe ese miembro.', 404)
    if (miembro.tipo !== 'ia') throw new ErrorDominio('Solo una IA puede ser agente.')
    ;[fila] = await ia.db.consulta(`select * from ia_agentes where miembro_id = $1 and propietario = $2`, [miembro.id, cuenta])
  } else {
    // Por nombre: ¿ya hay un miembro IA así? (el de MCP, o un agente archivado que vuelve)
    const nombre = c.nombre ?? validarNombreAgente(e.nombre)
    ;[miembro] = await ia.db.consulta(`select * from miembros where propietario = $1 and tipo = 'ia' and lower(nombre) = lower($2) order by coalesce(archivado, false) limit 1`, [cuenta, nombre])
    if (miembro) {
      ;[fila] = await ia.db.consulta(`select * from ia_agentes where miembro_id = $1 and propietario = $2`, [miembro.id, cuenta])
      if (fila && !miembro.archivado) throw new ErrorDominio(`Ya hay un agente que se llama «${miembro.nombre}»: elegí otro nombre o editá ese.`, 409)
    } else {
      const [otro] = await ia.db.consulta(`select nombre from miembros where propietario = $1 and lower(nombre) = lower($2)`, [cuenta, nombre])
      if (otro) throw new ErrorDominio(`Ya hay alguien que se llama «${otro.nombre}»: elegí otro nombre.`, 409)
    }
  }

  // Lo que queda: lo guardado + lo nuevo + de fábrica.
  const previo = fila ? aAgente({ ...fila, nombre: miembro?.nombre, alias: miembro?.alias, color: miembro?.color }, 0, { pausada: false, topeMesUsd: 1, gastoMesUsd: 0 }) : null
  const modo = c.modo ?? previo?.modo ?? 'api'
  const proveedor = modo === 'api' ? (c.proveedor !== undefined ? c.proveedor : (previo?.proveedor ?? null)) : null
  const modelo = modo === 'api' ? (c.modelo !== undefined ? c.modelo : (previo?.modelo ?? (proveedor ? MODELO_DE_FABRICA[proveedor] ?? null : null))) : null
  const modeloFinal = modo === 'api' && !modelo && proveedor ? (MODELO_DE_FABRICA[proveedor] ?? null) : modelo
  const claveId = c.claveId !== undefined ? c.claveId : (previo?.claveId ?? null)
  await verificarCoherencia(ia, { modo, proveedor, modelo: modeloFinal, claveId })
  const precioManualFinal = c.precioManual !== undefined ? c.precioManual : (previo?.precioManual ?? null)
  const activoFinal = c.activo ?? (miembro?.archivado ? true : (previo?.activo ?? true))
  if (modo === 'api' && activoFinal && proveedor && modeloFinal) await verificarPrecio(ia, { proveedor, modelo: modeloFinal, claveId, precioManual: precioManualFinal })

  const final = {
    modo,
    proveedor,
    modelo: modeloFinal,
    claveId,
    esfuerzo: c.esfuerzo !== undefined ? c.esfuerzo : (previo?.esfuerzo ?? null),
    instrucciones: c.instrucciones ?? previo?.instrucciones ?? '',
    permisos: c.permisos ?? previo?.permisos ?? [...PERMISOS_DE_FABRICA],
    confirmar: c.confirmar ?? previo?.confirmar ?? ('peligrosas' as ModoConfirmar),
    puedeMencionarIA: c.puedeMencionarIA ?? previo?.puedeMencionarIA ?? false,
    topeMesUsd: c.topeMesUsd ?? previo?.topeMesUsd ?? TOPE_AGENTE_DE_FABRICA_USD,
    precioManual: c.precioManual !== undefined ? c.precioManual : (previo?.precioManual ?? null),
    veImagenes: c.veImagenes !== undefined ? c.veImagenes : (previo?.veImagenes ?? null),
    autonomia: c.autonomia ?? previo?.autonomia ?? ('sugiere' as Autonomia),
    disparadores: c.disparadores ?? previo?.disparadores ?? {},
    activo: c.activo ?? (miembro?.archivado ? true : (previo?.activo ?? true)),
  }

  // El miembro: se crea, o se reutiliza y se le cambian nombre, alias y color si hace falta.
  if (!miembro) {
    const nombre = c.nombre ?? validarNombreAgente(e.nombre)
    const creado = await ia.s.crearMiembro({ nombre, tipo: 'ia', color: c.color ?? COLORES_IA[nombre.length % COLORES_IA.length]! })
    ;[miembro] = await ia.db.consulta(`select * from miembros where id = $1 and propietario = $2`, [creado.id, cuenta])
    nuevoMiembro = true
  }
  const m = miembro!
  const cambiaNombre = c.nombre !== undefined && c.nombre !== m.nombre
  const cambiaAlias = c.alias !== undefined && c.alias !== m.alias
  const cambiaColor = c.color !== undefined && c.color !== m.color
  if (cambiaNombre || cambiaAlias || cambiaColor) {
    // `actualizarMiembro` valida el alias (reservado, válido, único en la cuenta) y publica el cambio.
    const act = await ia.s.actualizarMiembro(ctx ?? { actor: SISTEMA }, m.id, { nombre: cambiaNombre ? c.nombre : undefined, alias: cambiaAlias ? c.alias : undefined, color: cambiaColor ? c.color : undefined })
    m.nombre = act.nombre
    m.alias = act.alias
    m.color = act.color
  }
  if (m.archivado && final.activo) {
    await ia.db.consulta(`update miembros set archivado = false where id = $1 and propietario = $2`, [m.id, cuenta])
    m.archivado = false
    publicarMiembro(ia, ctx, m, 'actualizado')
  } else if (nuevoMiembro) publicarMiembro(ia, ctx, m, 'creado')

  await ia.db.consulta(
    `insert into ia_agentes (miembro_id, propietario, modo, proveedor, modelo, clave_id, esfuerzo, instrucciones, permisos, confirmar,
        puede_mencionar_ia, tope_mes_usd, precio_manual, ve_imagenes, autonomia, disparadores, activo, actualizado_en)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, $11, $12, $13::jsonb, $14, $15, $16::jsonb, $17, now())
     on conflict (miembro_id) do update set modo = excluded.modo, proveedor = excluded.proveedor, modelo = excluded.modelo, clave_id = excluded.clave_id,
        esfuerzo = excluded.esfuerzo, instrucciones = excluded.instrucciones, permisos = excluded.permisos, confirmar = excluded.confirmar,
        puede_mencionar_ia = excluded.puede_mencionar_ia, tope_mes_usd = excluded.tope_mes_usd, precio_manual = excluded.precio_manual,
        ve_imagenes = excluded.ve_imagenes, autonomia = excluded.autonomia, disparadores = excluded.disparadores, activo = excluded.activo, actualizado_en = now()
     where ia_agentes.propietario = excluded.propietario`,
    [
      m.id, cuenta, final.modo, final.proveedor, final.modelo, final.claveId, final.esfuerzo, final.instrucciones, final.permisos, final.confirmar,
      final.puedeMencionarIA, final.topeMesUsd, final.precioManual ? JSON.stringify(final.precioManual) : null, final.veImagenes, final.autonomia,
      JSON.stringify(final.disparadores), final.activo,
    ],
  )
  olvidarAgentes(cuenta)
  const { agentes } = await agentesDeLaCuenta(ia)
  const a = agentes.find((x) => x.miembroId === m.id)
  if (!a) throw new ErrorDominio('No se pudo guardar el agente.', 500)
  return a
}

/** Un agente que se quita no se borra: queda archivado (no aparece al mencionar, no dispara) y vuelve con `guardarAgente({ activo: true })`. */
export async function archivarAgente(ia: ServicioIA, miembroId: string, ctx?: Ctx): Promise<void> {
  if (typeof miembroId !== 'string' || !miembroId) throw new ErrorDominio('No existe ese agente.', 404)
  const [f] = await ia.db.consulta(
    `select m.* from ia_agentes a join miembros m on m.id = a.miembro_id where a.miembro_id = $1 and a.propietario = $2 and m.propietario = $2`,
    [miembroId, ia.cuenta],
  )
  if (!f) throw new ErrorDominio('No existe ese agente.', 404)
  await ia.db.consulta(`update ia_agentes set activo = false, actualizado_en = now() where miembro_id = $1 and propietario = $2`, [miembroId, ia.cuenta])
  await ia.db.consulta(`update miembros set archivado = true where id = $1 and propietario = $2`, [miembroId, ia.cuenta])
  olvidarAgentes(ia.cuenta)
  publicarMiembro(ia, ctx, { ...f, archivado: true }, 'actualizado')
}

// ───────────────────────── gasto ─────────────────────────

function validarMes(v: unknown): string {
  const mes = v === undefined || v === null || v === '' ? mesActual() : String(v)
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mes)
  if (!m || Number(m[1]) < 2020 || Number(m[1]) > 2100) throw new ErrorDominio('El mes tiene que ser como 2026-11.')
  return mes
}

/** El gasto de un mes (UTC): por agente y el detalle de los trabajos (12.1). */
export async function uso(ia: ServicioIA, f: { mes?: string } = {}): Promise<UsoIA> {
  const mes = validarMes(f.mes)
  const desde = `${mes}-01 00:00:00+00`
  const [porAgente, trabajos, ajustes] = await Promise.all([
    ia.db.consulta(
      `select u.agente_id, coalesce(m.nombre, 'Agente') as nombre, u.entrada, u.salida, u.cache_lectura, u.cache_escritura, u.costo_usd, u.llamadas
       from ia_uso_mes u left join miembros m on m.id = u.agente_id and m.propietario = u.propietario
       where u.propietario = $1 and u.mes = $2 order by u.costo_usd desc, m.nombre`,
      [ia.cuenta, mes],
    ),
    ia.db.consulta(
      `select t.id, t.origen, t.superficie, t.paso, t.costo_usd, t.creado_en, t.pedido_por, t.contexto,
          coalesce(m.nombre, 'Agente') as agente,
          exists (select 1 from ia_uso u where u.trabajo_id = t.id and u.propietario = t.propietario and u.estimado) as estimado,
          coalesce(t.contexto->>'tarjetaClave',
            (select tb.nombre from tableros tb join proyectos p on p.id = tb.proyecto_id where tb.id = t.contexto->>'tableroId' and p.propietario = t.propietario)) as donde
       from ia_trabajos t left join miembros m on m.id = t.agente_id and m.propietario = t.propietario
       where t.propietario = $1 and t.creado_en >= $2::timestamptz and t.creado_en < ($2::timestamptz + interval '1 month')
       order by t.creado_en desc limit 200`,
      [ia.cuenta, desde],
    ),
    leerAjustes(ia),
  ])
  const agentes: UsoAgenteMes[] = porAgente.map((u) => ({
    agenteId: u.agente_id,
    agenteNombre: u.nombre,
    costoUsd: num(u.costo_usd),
    entrada: num(u.entrada),
    salida: num(u.salida),
    cacheLectura: num(u.cache_lectura),
    cacheEscritura: num(u.cache_escritura),
    llamadas: num(u.llamadas),
  }))
  const detalle: UsoTrabajo[] = trabajos.map((t) => ({
    trabajoId: t.id,
    agenteNombre: t.agente,
    origen: t.origen,
    superficie: t.superficie,
    donde: t.donde ?? null,
    pedidoPor: (t.pedido_por as { nombre?: string } | null)?.nombre ?? '',
    pasos: num(t.paso),
    costoUsd: num(t.costo_usd),
    estimado: Boolean(t.estimado),
    creadoEn: new Date(t.creado_en).toISOString(),
  }))
  return { mes, topeMesUsd: ajustes.topeMesUsd, gastoMesUsd: agentes.reduce((s, a) => s + a.costoUsd, 0), agentes, trabajos: detalle }
}
