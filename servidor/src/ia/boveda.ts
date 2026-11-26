// La bóveda de claves (plan 10.2): cifra y abre las claves de proveedores (y el token de GitHub) que cada cuenta carga en
// Configuración → IA. AES-256-GCM, con la clave de cifrado derivada (HKDF-SHA256) de un secreto del servidor, y con la cuenta y el
// id de la clave como dato autenticado: una fila copiada a otra cuenta o a otro id no se puede abrir.
//
// La clave en claro SOLO existe adentro del servidor, en el momento de usarla: nunca sale de acá en una respuesta, un evento, un
// error ni un registro (los errores de la bóveda no llevan ni la clave ni el texto cifrado).
//
//   · Secreto: `TABLERO_SECRETO_IA` (o `TABLERO_IA_SECRETO`) si existe; si no, `TABLERO_SECRETO` (el mismo de la cookie y el OAuth:
//     no hace falta una variable nueva). En la computadora, donde no hay ninguno, se genera una vez en `.datos/secreto-ia.txt`
//     con permisos 600 (como `clave-mcp.txt`). Online sin secreto no se puede guardar ninguna clave: el error lo dice.
//   · Rotación: si se cambia el secreto, el anterior va en `TABLERO_SECRETO_IA_ANTERIOR` (o `TABLERO_IA_SECRETO_ANTERIOR`). `abrir`
//     prueba con el actual y, si no puede, con el anterior; `abrirYRenovar` además devuelve la clave vuelta a cifrar con el actual.
//     Sin el anterior, la clave queda «hay que volver a cargarla»; nada más se rompe.
//   · Formato guardado (`ia_claves.cifrada`): vector (12 bytes) + etiqueta (16) + texto cifrado. `ia_claves.version` es la versión
//     del esquema de derivación (hoy 1: la información de HKDF es `claves-v1`).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { rutas } from '../config'

/** La versión del esquema de derivación con la que se cifra hoy (`ia_claves.version`). */
export const VERSION_BOVEDA = 1
const SAL = 'telar-ia-boveda'
const LARGO_VECTOR = 12
const LARGO_ETIQUETA = 16
/** Largo mínimo de un secreto del entorno (el mismo criterio que TABLERO_SECRETO). */
const MIN_SECRETO = 32

export interface Sellado {
  /** vector (12) + etiqueta (16) + texto cifrado. */
  cifrada: Uint8Array
  version: number
  /** Los últimos 4 caracteres, en claro: es lo único que se muestra («termina en …1234»). */
  ultimos4: string
}

/** Por qué no se pudo: `sin_secreto` (falta el secreto del servidor), `no_abre` (otra cuenta, otro id, otro secreto o bytes rotos), `formato`. */
export type MotivoBoveda = 'sin_secreto' | 'no_abre' | 'formato'

export class ErrorBoveda extends Error {
  constructor(
    readonly motivo: MotivoBoveda,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorBoveda'
  }
}

/** A quién pertenece la clave: va como dato autenticado (`"<propietario>:<id>"`). */
export interface Dueno {
  propietario: string
  id: string
}

// ───────────────────────── el secreto ─────────────────────────

let secretoLocal: string | null = null

function delEntorno(...nombres: string[]): string {
  for (const n of nombres) {
    const v = (process.env[n] ?? '').trim()
    if (v) return v
  }
  return ''
}

/** El secreto de la computadora: se crea una vez en `.datos/secreto-ia.txt` (permisos 600). */
function secretoDeArchivo(): string {
  if (secretoLocal) return secretoLocal
  const ruta = rutas.secretoIA
  if (existsSync(ruta)) {
    const v = readFileSync(ruta, 'utf8').trim()
    if (v.length >= MIN_SECRETO) return (secretoLocal = v)
  }
  const nuevo = randomBytes(32).toString('base64url')
  mkdirSync(path.dirname(ruta), { recursive: true })
  writeFileSync(ruta, nuevo + '\n', { mode: 0o600 })
  try {
    chmodSync(ruta, 0o600)
  } catch {
    // en sistemas sin permisos de archivo (Windows) queda como está
  }
  return (secretoLocal = nuevo)
}

/** Los secretos con los que se puede abrir hoy: el actual y, si lo hay, el anterior. */
function secretos(): { actual: string; anterior: string | null } {
  let actual = delEntorno('TABLERO_SECRETO_IA', 'TABLERO_IA_SECRETO', 'TABLERO_SECRETO')
  if (actual && actual.length < MIN_SECRETO)
    throw new ErrorBoveda('sin_secreto', `El secreto del servidor para las claves de IA es muy corto (hacen falta ${MIN_SECRETO} caracteres o más).`)
  if (!actual) {
    // Online no hay dónde guardar un archivo: sin variable no hay bóveda.
    if (process.env.TABLERO_PUBLICO === '1')
      throw new ErrorBoveda('sin_secreto', 'Falta el secreto del servidor para guardar claves de IA (TABLERO_SECRETO en las variables de Vercel).')
    actual = secretoDeArchivo()
  }
  // Con un secreto propio para la IA, lo guardado antes con el secreto general (TABLERO_SECRETO) se sigue abriendo solo: así
  // sumar TABLERO_SECRETO_IA después de haber cargado una clave no obliga a volver a pegarla.
  const anterior =
    delEntorno('TABLERO_SECRETO_IA_ANTERIOR', 'TABLERO_IA_SECRETO_ANTERIOR') ||
    (delEntorno('TABLERO_SECRETO_IA', 'TABLERO_IA_SECRETO') ? delEntorno('TABLERO_SECRETO') : '')
  return { actual, anterior: anterior && anterior !== actual ? anterior : null }
}

/** La clave de cifrado de 32 bytes de un secreto y una versión. */
function derivar(secreto: string, version: number): Buffer {
  return Buffer.from(hkdfSync('sha256', secreto, SAL, `claves-v${version}`, 32))
}

const aad = (e: Dueno) => Buffer.from(`${e.propietario}:${e.id}`, 'utf8')

function exigirDueno(e: Dueno) {
  if (!e || !e.propietario || !e.id) throw new ErrorBoveda('formato', 'Falta la cuenta o el id de la clave.')
}

// ───────────────────────── sellar y abrir ─────────────────────────

function cifrar(clave: string, e: Dueno, secreto: string): Uint8Array {
  const vector = randomBytes(LARGO_VECTOR)
  const c = createCipheriv('aes-256-gcm', derivar(secreto, VERSION_BOVEDA), vector, { authTagLength: LARGO_ETIQUETA })
  c.setAAD(aad(e))
  const texto = Buffer.concat([c.update(clave, 'utf8'), c.final()])
  return Buffer.concat([vector, c.getAuthTag(), texto])
}

function descifrar(cifrada: Uint8Array, e: Dueno, secreto: string, version: number): string | null {
  const b = Buffer.from(cifrada)
  if (b.length < LARGO_VECTOR + LARGO_ETIQUETA + 1) return null
  try {
    const d = createDecipheriv('aes-256-gcm', derivar(secreto, version), b.subarray(0, LARGO_VECTOR), { authTagLength: LARGO_ETIQUETA })
    d.setAAD(aad(e))
    d.setAuthTag(b.subarray(LARGO_VECTOR, LARGO_VECTOR + LARGO_ETIQUETA))
    return Buffer.concat([d.update(b.subarray(LARGO_VECTOR + LARGO_ETIQUETA)), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** Cifra una clave para guardarla. `e` va como dato autenticado: una fila copiada a otra cuenta o a otro id no se puede abrir. */
export function sellar(clave: string, e: Dueno): Sellado {
  exigirDueno(e)
  if (typeof clave !== 'string' || !clave) throw new ErrorBoveda('formato', 'No hay clave para guardar.')
  return { cifrada: cifrar(clave, e, secretos().actual), version: VERSION_BOVEDA, ultimos4: clave.slice(-4) }
}

const NO_ABRE = 'No se pudo abrir la clave guardada: hay que volver a cargarla.'

/**
 * Devuelve la clave en claro, solo para usarla adentro del servidor. Tira `ErrorBoveda` si no se puede abrir (otra cuenta, otro
 * id, el secreto cambió sin dejar el anterior, bytes dañados). Nunca devuelve ni imprime la clave por otro camino.
 */
export function abrir(s: { cifrada: Uint8Array; version: number }, e: Dueno): string {
  return abrirYRenovar(s, e).clave
}

/** Como `abrir`, y si hubo que usar el secreto anterior, trae la clave vuelta a cifrar con el actual (para guardarla). */
export function abrirYRenovar(
  s: { cifrada: Uint8Array; version: number },
  e: Dueno,
): { clave: string; renovada: Sellado | null } {
  exigirDueno(e)
  if (s.version !== VERSION_BOVEDA) throw new ErrorBoveda('formato', 'La clave se guardó con otro formato: hay que volver a cargarla.')
  const { actual, anterior } = secretos()
  const conActual = descifrar(s.cifrada, e, actual, s.version)
  if (conActual !== null) return { clave: conActual, renovada: null }
  if (anterior) {
    const conAnterior = descifrar(s.cifrada, e, anterior, s.version)
    if (conAnterior !== null)
      return { clave: conAnterior, renovada: { cifrada: cifrar(conAnterior, e, actual), version: VERSION_BOVEDA, ultimos4: conAnterior.slice(-4) } }
  }
  throw new ErrorBoveda('no_abre', NO_ABRE)
}

/** «termina en …1234» */
export const terminaEn = (ultimos4: string): string => (ultimos4 ? `termina en …${ultimos4}` : 'sin clave')

/** Para las pruebas: olvida el secreto de archivo que quedó en memoria. */
export function olvidarSecretoLocal(): void {
  secretoLocal = null
}
