// Prueba de herramientas-agente.ts (tarea 2.8): toda herramienta del catálogo tiene capacidad (una herramienta nueva no entra sin decidir
// qué permiso pide), los juegos por superficie, lo delicado, las frases y las 4 herramientas de código. `npm run ia:probar-herramientas`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAPACIDADES, type Capacidad, type Superficie } from '../../../compartido/ia'
import { HERRAMIENTAS } from '../mcp/herramientas'
import {
  CAPACIDAD_DE,
  defDe,
  esDelicada,
  esquemaDe,
  fraseDe,
  hechoDe,
  herramientasPara,
  JUEGOS,
  LIMITES,
  nombresDelCatalogo,
  permitida,
  soloLee,
  tituloDe,
} from './herramientas-agente'
import { HERRAMIENTAS_DE_CODIGO, LIMITES_DE_FABRICA } from './tipos'

const SUPERFICIES = Object.keys(JUEGOS) as Superficie[]

test('toda herramienta del catálogo tiene una capacidad, y no sobra ninguna', () => {
  for (const h of HERRAMIENTAS) assert.ok(CAPACIDAD_DE[h.nombre], `a «${h.nombre}» le falta la capacidad (herramientas-agente.ts)`)
  const nombres = new Set(nombresDelCatalogo())
  for (const n of Object.keys(CAPACIDAD_DE)) assert.ok(nombres.has(n), `«${n}» tiene capacidad pero no existe en el catálogo`)
  for (const cap of Object.values(CAPACIDAD_DE)) assert.ok(cap === 'leer' || (CAPACIDADES as readonly string[]).includes(cap), `capacidad desconocida: ${cap}`)
})

test('las que leen son de «leer» y las que escriben piden una capacidad', () => {
  for (const h of HERRAMIENTAS) {
    if (h.soloLectura) assert.equal(CAPACIDAD_DE[h.nombre], 'leer', `«${h.nombre}» solo lee: tendría que ser de «leer»`)
    else assert.notEqual(CAPACIDAD_DE[h.nombre], 'leer', `«${h.nombre}» escribe: no puede ser de «leer»`)
  }
})

test('las 4 herramientas de código son de la capacidad «codigo», solo leen, y tienen esquema y definición', () => {
  assert.equal(HERRAMIENTAS_DE_CODIGO.length, 4)
  for (const n of HERRAMIENTAS_DE_CODIGO) {
    assert.equal(CAPACIDAD_DE[n], 'codigo')
    assert.ok(soloLee(n))
    assert.ok(!HERRAMIENTAS.some((h) => h.nombre === n), 'no son del MCP')
    const d = defDe(n)!
    assert.ok(/Ejemplos?:/.test(d.descripcion), `«${n}» trae un ejemplo`)
    assert.equal(d.esquema.additionalProperties, false)
    assert.ok(esquemaDe(n))
  }
  const leer = esquemaDe('codigo_leer')!
  assert.equal(leer.safeParse({ ruta: 'a/b.js', desde: 1, hasta: 50 }).success, true)
  assert.equal(leer.safeParse({}).success, false, 'ruta es obligatoria')
  assert.equal(leer.safeParse({ ruta: 'a', cosa: 1 }).success, false, 'esquema estricto')
})

test('los juegos nombran solo herramientas que existen y entran en un presupuesto razonable', () => {
  const existen = new Set(nombresDelCatalogo())
  for (const s of SUPERFICIES) for (const n of JUEGOS[s]) assert.ok(existen.has(n), `${s}: «${n}» no existe`)
  const tamano = (s: Superficie) => JSON.stringify(herramientasPara(s, [...CAPACIDADES])).length
  // Plan 7.2 (medido): tarjeta ~17.400 caracteres; se deja margen para las 4 de código.
  assert.ok(tamano('tarjeta') < 24_000, `el juego de tarjeta pesa ${tamano('tarjeta')}`)
  assert.ok(herramientasPara('tarjeta', ['comentar']).some((d) => d.nombre === 'leer_tarjeta'), 'leer siempre está')
})

test('un permiso que falta saca la herramienta del juego (y no se puede llamar)', () => {
  const sin = (p: Capacidad[]) => herramientasPara('tarjeta', p).map((d) => d.nombre)
  assert.ok(!sin(['comentar', 'tarjetas']).includes('archivar_tarjeta'), 'sin «archivar» no ve archivar_tarjeta')
  assert.ok(sin(['comentar', 'tarjetas', 'archivar']).includes('archivar_tarjeta'))
  assert.ok(!sin(['tarjetas']).includes('comentar'))
  assert.ok(!sin(['comentar']).includes('crear_tarjeta'))
  assert.ok(!sin(['comentar', 'tarjetas']).some((n) => n.startsWith('codigo_')), 'sin «codigo» no ve las de código')
  assert.equal(sin(['comentar', 'codigo']).filter((n) => n.startsWith('codigo_')).length, 4)
  assert.equal(permitida('archivar_tarjeta', ['comentar']), false)
  assert.equal(permitida('leer_tarjeta', []), true)
  assert.equal(permitida('inventada', ['comentar']), false)
  // el juego de la tarjeta no trae estructura ni lienzo ni diseño
  for (const n of JUEGOS.tarjeta) assert.ok(!['estructura', 'lienzo', 'diseno'].includes(CAPACIDAD_DE[n] as string), `${n} no va en el juego de tarjeta`)
})

test('cada superficie tiene sus límites de fábrica (6.4)', () => {
  assert.equal(LIMITES, LIMITES_DE_FABRICA)
  assert.deepEqual(LIMITES.tarjeta, { pasos: 12, maxSalida: 4_000, minLibreMs: 60_000, topeUsd: 1 })
  assert.equal(LIMITES.diseno.pasos, 24)
  assert.equal(LIMITES.lienzo.topeUsd, 3)
})

test('lo delicado pide permiso con el motivo para mostrar (12.4)', () => {
  const e = { tarjetasTocadas: 0 }
  assert.equal(esDelicada('archivar_tarjeta', { tarjeta: 'RC-12' }, e), 'Archivar RC-12')
  assert.equal(esDelicada('archivar_tarjeta', { tarjeta: 'RC-12', restaurar: true }, e), null, 'restaurar no es delicado')
  assert.equal(esDelicada('quitar_del_lienzo', { objetos: ['a', 'b'] }, e), null)
  assert.equal(esDelicada('quitar_del_lienzo', { objetos: ['1', '2', '3', '4', '5', '6'] }, e), 'Sacar 6 objetos del lienzo')
  assert.ok(esDelicada('quitar_del_lienzo', { objetos: ['m'], con_contenido: true }, e))
  assert.equal(esDelicada('quitar_del_lienzo', { objetos: ['1', '2', '3', '4', '5', '6'], restaurar: true }, e), null)
  assert.match(esDelicada('crear_tablero', { nombre: 'Ideas' }, e)!, /Crear el tablero «Ideas»/)
  assert.ok(esDelicada('crear_proyecto', { nombre: 'X', prefijo: 'XX' }, e))
  assert.ok(esDelicada('actualizar_lista', { lista: 'Hecho', nombre: 'Listo' }, e))
  assert.equal(esDelicada('definir_tokens', {}, e), 'Cambiar los colores del sistema de diseño')
  assert.ok(esDelicada('sincronizar_diseno', {}, e))
  assert.equal(esDelicada('actualizar_lienzo', { objetos: Array.from({ length: 26 }, (_, i) => `o${i}`) }, e), 'Cambiar 26 objetos de una vez')
  assert.equal(esDelicada('actualizar_lienzo', { objetos: Array.from({ length: 25 }, (_, i) => `o${i}`) }, e), null)
  assert.ok(esDelicada('actualizar_tabla', { operaciones: [{ op: 'quitar_columna', columna: 'a' }] }, e))
  assert.ok(esDelicada('actualizar_tabla', { operaciones: [{ op: 'quitar_filas', filas: Array.from({ length: 11 }, (_, i) => i + 1) }] }, e))
  assert.equal(esDelicada('actualizar_tabla', { operaciones: [{ op: 'quitar_filas', filas: [1, 2] }, { op: 'agregar_filas', filas: [] }] }, e), null)
  // la tarjeta número 11 del trabajo
  for (const h of ['crear_tarjeta', 'actualizar_tarjeta', 'mover_tarjeta']) {
    assert.equal(esDelicada(h, { tarjeta: 'RC-1' }, { tarjetasTocadas: 9 }), null)
    assert.match(esDelicada(h, { tarjeta: 'RC-1' }, { tarjetasTocadas: 10 })!, /Ya tocó 10 tarjetas/)
  }
  // lo común no es delicado
  for (const h of ['comentar', 'leer_tarjeta', 'registrar_porque', 'vincular', 'armar_en_lienzo', 'crear_tabla', 'codigo_leer'])
    assert.equal(esDelicada(h, { tarjeta: 'RC-1' }, { tarjetasTocadas: 99 }), null, h)
})

test('las frases y los títulos dicen qué pasa, para toda herramienta', () => {
  assert.equal(fraseDe('leer_tarjeta', { tarjeta: 'RC-98' }), 'Leyendo RC-98…')
  assert.equal(fraseDe('mover_tarjeta', { tarjeta: 'RC-104', lista: 'Hecho' }), 'Moviendo RC-104…')
  assert.equal(fraseDe('armar_en_lienzo', { objetos: new Array(12).fill({}) }), 'Armando 12 objetos en el lienzo…')
  assert.equal(fraseDe('ver_diseno', {}), 'Mirando el diseño…')
  assert.equal(tituloDe('mover_tarjeta', { tarjeta: 'RC-104', lista: 'Hecho' }), 'Mover RC-104 a Hecho')
  assert.equal(tituloDe('archivar_tarjeta', { tarjeta: 'RC-12' }), 'Archivar RC-12')
  assert.equal(hechoDe('mover_tarjeta', { tarjeta: 'RC-104', lista: 'Hecho' }), 'Movió RC-104 a Hecho')
  assert.equal(hechoDe('comentar', { tarjeta: 'RC-98', texto: 'x' }), 'Comentó en RC-98')
  for (const n of nombresDelCatalogo())
    for (const args of [{}, undefined, null, { tarjeta: 'RC-1', lista: 'Hecho', objetos: [1], titulo: 't', nombre: 'n' }]) {
      assert.match(fraseDe(n, args), /…$/, n)
      assert.ok(tituloDe(n, args).length > 3, n)
      assert.ok(hechoDe(n, args).length > 3, n)
    }
  assert.equal(fraseDe('inventada', {}), 'Usando inventada…')
})
