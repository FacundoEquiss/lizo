// Prueba de la bóveda de claves y del filtro que tapa claves (plan 10.2, tarea 2.1). `npm run ia:probar-boveda`. Sin base ni red:
// cifra y abre en memoria, y para el secreto de la computadora usa una carpeta temporal.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, beforeEach, test } from 'node:test'

// La carpeta de datos se fija ANTES de cargar `config` (rutas.secretoIA sale de ahí).
const datos = mkdtempSync(path.join(tmpdir(), 'telar-boveda-'))
process.env.TABLERO_DATOS = datos
after(() => rmSync(datos, { recursive: true, force: true }))

const { abrir, abrirYRenovar, ErrorBoveda, olvidarSecretoLocal, sellar, terminaEn, VERSION_BOVEDA } = await import('./boveda')
const { taparClaves, taparClavesContando, TAPADO } = await import('./filtro-claves')
const { rutas } = await import('../config')

const SECRETO_1 = 'secreto-uno-de-prueba-0123456789-abcdefghijklmnop'
const SECRETO_2 = 'secreto-dos-de-prueba-9876543210-zyxwvutsrqponmlk'
const CLAVE = 'sk-ant-api03-CLAVE-DE-PRUEBA-que-no-es-real-1234'
const A = { propietario: 'cuenta-a', id: 'clave-1' }

const VARIABLES = ['TABLERO_SECRETO_IA', 'TABLERO_IA_SECRETO', 'TABLERO_SECRETO', 'TABLERO_SECRETO_IA_ANTERIOR', 'TABLERO_IA_SECRETO_ANTERIOR', 'TABLERO_PUBLICO']
beforeEach(() => {
  for (const v of VARIABLES) delete process.env[v]
  olvidarSecretoLocal()
  process.env.TABLERO_SECRETO_IA = SECRETO_1
})

test('ida y vuelta: abre lo que selló, y muestra solo «termina en …»', () => {
  const s = sellar(CLAVE, A)
  assert.equal(s.version, VERSION_BOVEDA)
  assert.equal(s.ultimos4, '1234')
  assert.equal(terminaEn(s.ultimos4), 'termina en …1234')
  assert.equal(abrir(s, A), CLAVE)
})

test('lo guardado (vector + etiqueta + texto) no contiene la clave, ni parte de ella, ni en base64', () => {
  const s = sellar(CLAVE, A)
  assert.equal(s.cifrada.length, 12 + 16 + Buffer.byteLength(CLAVE))
  const bytes = Buffer.from(s.cifrada)
  for (const trozo of [CLAVE, CLAVE.slice(0, 16), 'CLAVE-DE-PRUEBA']) {
    assert.ok(!bytes.includes(trozo), `no tiene que haber «${trozo}» en claro`)
    assert.ok(!bytes.toString('base64').includes(Buffer.from(trozo).toString('base64').replace(/=+$/, '')))
  }
})

test('cada sellado usa un vector distinto: la misma clave da bytes distintos', () => {
  const a = Buffer.from(sellar(CLAVE, A).cifrada)
  const b = Buffer.from(sellar(CLAVE, A).cifrada)
  assert.notDeepEqual(a, b)
  assert.notDeepEqual(a.subarray(0, 12), b.subarray(0, 12))
})

test('otra cuenta u otro id no la abre (la cuenta y el id van como dato autenticado)', () => {
  const s = sellar(CLAVE, A)
  for (const otro of [
    { propietario: 'cuenta-b', id: 'clave-1' },
    { propietario: 'cuenta-a', id: 'clave-2' },
    { propietario: 'cuenta-a:clave', id: '1' }, // que «a:clave» + «1» no se confunda con «a» + «clave:1»
  ]) {
    assert.throws(() => abrir(s, otro), (e: any) => e instanceof ErrorBoveda && e.motivo === 'no_abre')
  }
  assert.equal(abrir(s, A), CLAVE, 'y la de su dueño sigue abriendo')
})

test('bytes dañados, cortados o de otra versión no se abren, y el error no lleva la clave ni los bytes', () => {
  const s = sellar(CLAVE, A)
  const roto = Buffer.from(s.cifrada)
  roto[roto.length - 1] ^= 1
  const cortado = Buffer.from(s.cifrada).subarray(0, 20)
  for (const x of [roto, cortado, Buffer.alloc(0)]) {
    try {
      abrir({ cifrada: x, version: s.version }, A)
      assert.fail('tenía que fallar')
    } catch (e: any) {
      assert.ok(e instanceof ErrorBoveda && e.motivo === 'no_abre')
      assert.ok(!e.message.includes(CLAVE) && (!x.length || !e.message.includes(x.toString('base64'))))
    }
  }
  assert.throws(() => abrir({ cifrada: s.cifrada, version: 2 }, A), (e: any) => e.motivo === 'formato')
})

test('rotación: con el secreto anterior se abre y se vuelve a cifrar con el nuevo; sin él, hay que volver a cargarla', () => {
  const s = sellar(CLAVE, A)
  process.env.TABLERO_SECRETO_IA = SECRETO_2
  assert.throws(() => abrir(s, A), (e: any) => e.motivo === 'no_abre', 'sin el anterior no abre')
  process.env.TABLERO_SECRETO_IA_ANTERIOR = SECRETO_1
  assert.equal(abrir(s, A), CLAVE, 'con el anterior abre')
  const r = abrirYRenovar(s, A)
  assert.equal(r.clave, CLAVE)
  assert.ok(r.renovada && r.renovada.ultimos4 === '1234')
  // la renovada abre con SOLO el secreto nuevo
  delete process.env.TABLERO_SECRETO_IA_ANTERIOR
  assert.equal(abrir(r.renovada!, A), CLAVE)
  // y la vieja ya no
  assert.throws(() => abrir(s, A), (e: any) => e.motivo === 'no_abre')
  // lo que ya está con el actual no se renueva
  assert.equal(abrirYRenovar(r.renovada!, A).renovada, null)
})

test('de dónde sale el secreto: TABLERO_SECRETO_IA, después TABLERO_IA_SECRETO, después TABLERO_SECRETO', () => {
  // Lo nuevo se sella con el secreto propio de la IA; el general solo sirve para abrir lo guardado antes (ver la prueba de abajo).
  process.env.TABLERO_SECRETO = SECRETO_1
  process.env.TABLERO_SECRETO_IA = SECRETO_2
  const conPropio = sellar(CLAVE, A)
  delete process.env.TABLERO_SECRETO_IA
  assert.throws(() => abrir(conPropio, A), (e: any) => e.motivo === 'no_abre', 'sellado con TABLERO_SECRETO_IA: solo se abre con él')
  process.env.TABLERO_IA_SECRETO = SECRETO_2
  assert.equal(abrir(conPropio, A), CLAVE, 'el nombre del plan también vale')
  delete process.env.TABLERO_IA_SECRETO
  const conGeneral = sellar(CLAVE, A)
  assert.equal(abrir(conGeneral, A), CLAVE, 'sin las específicas se usa TABLERO_SECRETO')
})

test('una clave guardada con el secreto general se sigue abriendo cuando se suma el secreto propio de la IA', () => {
  // Pasó de verdad: se cargó la clave con TABLERO_SECRETO y después se agregó TABLERO_SECRETO_IA.
  delete process.env.TABLERO_SECRETO_IA
  process.env.TABLERO_SECRETO = SECRETO_1
  const s = sellar(CLAVE, A)
  process.env.TABLERO_SECRETO_IA = SECRETO_2
  assert.equal(abrir(s, A), CLAVE)
  const r = abrirYRenovar(s, A)
  assert.ok(r.renovada, 'queda vuelta a cifrar con el secreto nuevo')
  delete process.env.TABLERO_SECRETO
  assert.equal(abrir(r.renovada!, A), CLAVE, 'y la renovada ya no depende del secreto general')
})

test('un secreto corto no se acepta', () => {
  process.env.TABLERO_SECRETO_IA = 'corto'
  assert.throws(() => sellar(CLAVE, A), (e: any) => e instanceof ErrorBoveda && e.motivo === 'sin_secreto')
})

test('online sin secreto no hay bóveda; en la computadora se crea .datos/secreto-ia.txt con permisos 600', () => {
  delete process.env.TABLERO_SECRETO_IA
  process.env.TABLERO_PUBLICO = '1'
  assert.throws(() => sellar(CLAVE, A), (e: any) => e.motivo === 'sin_secreto' && /TABLERO_SECRETO/.test(e.message))
  delete process.env.TABLERO_PUBLICO
  assert.ok(!existsSync(rutas.secretoIA))
  const s = sellar(CLAVE, A)
  assert.ok(existsSync(rutas.secretoIA), 'se generó el secreto de la computadora')
  if (process.platform !== 'win32') assert.equal(statSync(rutas.secretoIA).mode & 0o777, 0o600)
  const guardado = readFileSync(rutas.secretoIA, 'utf8').trim()
  assert.ok(guardado.length >= 32)
  // se reutiliza (otro proceso, otra memoria): sigue abriendo
  olvidarSecretoLocal()
  assert.equal(abrir(s, A), CLAVE)
  assert.ok(!Buffer.from(s.cifrada).includes(guardado))
})

test('sin cuenta o sin id no sella', () => {
  assert.throws(() => sellar(CLAVE, { propietario: '', id: 'x' }), ErrorBoveda)
  assert.throws(() => sellar('', A), ErrorBoveda)
})

// ───────────────────────── el filtro de claves ─────────────────────────

test('el filtro tapa las formas conocidas de claves y conserva el resto del texto', () => {
  const casos: [string, string][] = [
    ['la clave es sk-ant-api03-abcdefghijklmnop1234 ok', 'la clave es [tapado] ok'],
    ['openai sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX fin', 'openai [tapado] fin'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789 y listo', 'token [tapado] y listo'],
    ['github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz0123456789ABCD', '[tapado]'],
    ['AKIAABCDEFGHIJKLMNOP', '[tapado]'],
    ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123', 'Authorization: Bearer [tapado]'],
    ['la del MCP: tab_abcdefghijklmnopqrstuvwx', 'la del MCP: [tapado]'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop fin', 'jwt [tapado] fin'],
    ['const password = "hunter2hunter2";', 'const password = "[tapado]";'],
    ["api_key: 'abcdefgh12345678'", "api_key: '[tapado]'"],
    ['DB_PASSWORD=supersecreta123\nOTRA=cosa', 'DB_PASSWORD=[tapado]\nOTRA=cosa'],
  ]
  for (const [entrada, salida] of casos) assert.equal(taparClaves(entrada), salida, entrada)
  const pem = 'antes\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----\ndespués'
  assert.equal(taparClaves(pem), 'antes\n[tapado]\ndespués')
  assert.equal(taparClaves('-----BEGIN PRIVATE KEY-----\nMIIEv...cortada'), '[tapado]', 'una clave privada cortada también')
})

test('el filtro no toca texto común ni código sin secretos', () => {
  for (const t of ['hola mundo', 'const x = 12 * 3', 'sk-corta', 'tab_corta', 'el token de acceso se vence', 'password: string', 'const clave = leerClave()']) {
    assert.equal(taparClaves(t), t)
  }
})

test('el filtro saca las claves «conocidas» aunque no tengan forma, y cuenta lo que tapó', () => {
  const r = taparClavesContando('error con la clave zzz-clave-rara-999 y de nuevo zzz-clave-rara-999', ['zzz-clave-rara-999'])
  assert.equal(r.texto, `error con la clave ${TAPADO} y de nuevo ${TAPADO}`)
  assert.equal(r.tapados, 2)
  assert.equal(taparClaves('corta abc', ['abc']), 'corta abc', 'las muy cortas no se usan para reemplazar (taparían palabras comunes)')
})
