// Pruebas del modelo de tablas y gráficos (compartido/tabla.ts y grafico.ts): valores por tipo, cada operación con su
// deshacer, topes, pegar desde Excel y CSV, y los gráficos desde una tabla. `npm run tabla:probar`. Sin base de datos ni red.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fuenteSugerida, leerGrafico, resolverGrafico } from './grafico'
import {
  aplicarOperaciones,
  armarTabla,
  esGrilla,
  filasOrdenadas,
  formatearCelda,
  LIMITES_TABLA,
  leerTabla,
  medidaTabla,
  normalizarCelda,
  resumir,
  tablaATexto,
  tablaDesdeTexto,
  type ColumnaTabla,
  type DatosTabla,
} from './tabla'

const col = (tipo: ColumnaTabla['tipo'], extra: Partial<ColumnaTabla> = {}): ColumnaTabla => ({ id: 'c', nombre: 'Col', tipo, ancho: 100, ...extra })
const valor = (c: ColumnaTabla, crudo: unknown) => {
  const r = normalizarCelda(c, crudo)
  assert.ok(!('error' in r), `no debería fallar: ${JSON.stringify(r)}`)
  return (r as { valor: unknown }).valor
}
const error = (c: ColumnaTabla, crudo: unknown) => {
  const r = normalizarCelda(c, crudo)
  assert.ok('error' in r, `tendría que fallar con ${JSON.stringify(crudo)}`)
  return (r as { error: string }).error
}

function menu(): DatosTabla {
  return armarTabla({
    titulo: 'Precios del menú',
    columnas: [
      { nombre: 'Plato', tipo: 'texto' },
      { nombre: 'Precio', tipo: 'moneda', resumen: 'suma' },
      { nombre: 'Margen', tipo: 'porcentaje' },
      { nombre: 'Estado', tipo: 'etiqueta', opciones: [{ nombre: 'Listo', color: 'verde' }] },
    ],
    filas: [['Milanesa', 4200, 35, 'Listo'], ['Ñoquis', 3100, 48, 'Listo'], { Plato: 'Flan', Precio: 1800, Estado: 'En prueba' }],
  }).tabla
}

test('1 · números en formato argentino y en el de afuera', () => {
  const n = col('numero')
  assert.equal(valor(n, '1.234,50'), 1234.5)
  assert.equal(valor(n, '1,234.50'), 1234.5)
  assert.equal(valor(n, '12.5'), 12.5)
  assert.equal(valor(n, '1.234'), 1234)
  assert.equal(valor(n, '-7'), -7)
  assert.equal(valor(col('moneda'), '$ 4.200'), 4200)
  assert.equal(valor(col('porcentaje'), '35 %'), 35)
})

test('2 · un número malo dice qué se esperaba, con un ejemplo', () => assert.match(error(col('numero'), 'caro'), /no es un número \(ejemplo: 1200/))

test('3 · fechas: ISO, dd/mm/aaaa y con hora; las imposibles se rechazan', () => {
  assert.equal(valor(col('fecha'), '2026-11-24'), '2026-11-24')
  assert.equal(valor(col('fecha'), '24/11/2026'), '2026-11-24')
  assert.equal(valor(col('fecha', { conHora: true }), '2026-11-24 18:30'), '2026-11-24T18:30')
  assert.match(error(col('fecha'), '31/02/2026'), /fecha/)
})

test('4 · duración en minutos desde varios formatos', () => {
  const d = col('duracion')
  assert.equal(valor(d, 90), 90)
  assert.equal(valor(d, '1h30'), 90)
  assert.equal(valor(d, '1:30'), 90)
  assert.equal(valor(d, '45m'), 45)
  assert.equal(formatearCelda(d, 90), '1 h 30 min')
})

test('5 · casilla, link, mail, teléfono, rama, tarjeta y color', () => {
  assert.equal(valor(col('casilla'), 'sí'), true)
  assert.equal(valor(col('casilla'), 'no'), false)
  assert.equal(valor(col('link'), 'https://telarapp.vercel.app'), 'https://telarapp.vercel.app')
  assert.match(error(col('link'), 'esto no es un link'), /link/)
  assert.match(error(col('email'), 'hola'), /mail/)
  assert.equal(valor(col('telefono'), '+54 11 5555-1234'), '+54 11 5555-1234')
  assert.equal(valor(col('rama'), 'claude/tablas'), 'claude/tablas')
  assert.match(error(col('rama'), 'una rama con espacios'), /rama/)
  assert.equal(valor(col('tarjeta'), 'rc-12'), 'RC-12')
  assert.equal(valor(col('color'), 'Verde'), 'verde')
})

test('6 · el formato es es-AR (miles con punto, coma decimal)', () => {
  assert.equal(formatearCelda(col('numero'), 1234.5), '1.234,5')
  assert.equal(formatearCelda(col('moneda'), 4200), '$ 4.200')
  assert.equal(formatearCelda(col('moneda', { moneda: 'USD' }), 12.5), 'US$ 12,50')
  assert.equal(formatearCelda(col('porcentaje'), 35), '35 %')
  assert.equal(formatearCelda(col('fecha'), '2026-11-24'), '24 nov 2026')
})

test('7 · crear: filas como listas y como objetos, y una etiqueta nueva suma su opción', () => {
  const t = menu()
  assert.equal(t.filas.length, 3)
  const estado = t.columnas.find((c) => c.nombre === 'Estado')!
  assert.deepEqual(estado.opciones!.map((o) => o.nombre), ['Listo', 'En prueba'])
  assert.notEqual(estado.opciones![1]!.color, 'verde')
})

test('8 · un valor malo en modo estricto dice fila, columna y qué se esperaba', () => {
  assert.throws(
    () => aplicarOperaciones(menu(), [{ op: 'cambiar_celdas', celdas: [{ fila: 2, columna: 'Precio', valor: 'caro' }] }], { estricto: true }),
    /fila 2, columna «Precio»: «caro» no es un número/,
  )
})

test('9 · sin modo estricto, lo que no encaja queda vacío y avisa', () => {
  const r = aplicarOperaciones(menu(), [{ op: 'cambiar_celdas', celdas: [{ fila: 1, columna: 'Precio', valor: 'caro' }] }])
  assert.equal(r.avisos.length, 1)
  assert.equal(r.tabla.filas[0]!.celdas[r.tabla.columnas[1]!.id], undefined)
})

test('10 · cada operación se deshace con su inversa (la tabla vuelve igual)', () => {
  const t = menu()
  const ops = [
    { op: 'agregar_filas', filas: [['Helado', 900, 20, 'Listo']] },
    { op: 'cambiar_celdas', celdas: [{ fila: 1, columna: 'Precio', valor: 5000 }] },
    { op: 'mover_fila', fila: 2, a: 1 },
    { op: 'agregar_columna', columna: { nombre: 'Rama', tipo: 'rama' } },
    { op: 'cambiar_columna', columna: 'Plato', cambios: { nombre: 'Nombre' } },
    { op: 'ordenar', columna: 'Precio', direccion: 'desc' },
    { op: 'quitar_filas', filas: [1] },
    { op: 'quitar_columna', columna: 'Margen' },
  ] as const
  for (const op of ops) {
    const r = aplicarOperaciones(t, [op as never])
    assert.notDeepEqual(r.tabla, t, `${op.op} tenía que cambiar algo`)
    assert.deepEqual(aplicarOperaciones(r.tabla, r.inversas).tabla, t, `${op.op} no se deshizo`)
  }
})

test('11 · ordenar es una vista: los datos no se mueven y los vacíos van al final', () => {
  const t = aplicarOperaciones(menu(), [{ op: 'ordenar', columna: 'Margen', direccion: 'desc' }]).tabla
  assert.deepEqual(t.filas.map((f) => f.celdas[t.columnas[0]!.id]), ['Milanesa', 'Ñoquis', 'Flan'])
  assert.deepEqual(filasOrdenadas(t).map((f) => f.celdas[t.columnas[0]!.id]), ['Ñoquis', 'Milanesa', 'Flan'])
})

test('12 · cambiar el tipo convierte los valores y, si alguno no encaja, pide forzar', () => {
  const t = menu()
  assert.throws(() => aplicarOperaciones(t, [{ op: 'cambiar_columna', columna: 'Plato', cambios: { tipo: 'numero' } }]), /forzar: true/)
  const r = aplicarOperaciones(t, [{ op: 'cambiar_columna', columna: 'Plato', cambios: { tipo: 'numero' }, forzar: true }])
  assert.equal(r.avisos.length, 1)
  assert.equal(r.tabla.columnas[0]!.tipo, 'numero')
})

test('13 · topes: 500 filas y 30 columnas', () => {
  const t = menu()
  assert.throws(() => aplicarOperaciones(t, [{ op: 'agregar_filas', filas: Array.from({ length: LIMITES_TABLA.filas }, () => ['x']) }]), /500 filas/)
  assert.throws(
    () => armarTabla({ columnas: Array.from({ length: 31 }, (_, i) => ({ nombre: `C${i}` })) }),
    /30 columnas/,
  )
})

test('14 · el resumen y la medida de la tabla', () => {
  const t = menu()
  assert.equal(resumir(t.columnas[1]!, t.filas), 9100)
  const m = medidaTabla(t)
  assert.ok(m.ancho >= 400 && m.alto >= 44 + 40 + 3 * 36 + 36, JSON.stringify(m))
})

test('15 · ids pedidos por la web (para que pantalla y servidor coincidan)', () => {
  const r = aplicarOperaciones(menu(), [{ op: 'agregar_filas', filas: [[]], ids: ['f_web1'] }, { op: 'agregar_columna', columna: { nombre: 'N' }, id: 'c_web1' }])
  assert.equal(r.tabla.filas.at(-1)!.id, 'f_web1')
  assert.equal(r.tabla.columnas.at(-1)!.id, 'c_web1')
})

test('16 · pegar de Excel (TSV) y de CSV con comillas', () => {
  const tsv = 'Plato\tPrecio\tMargen\nMilanesa\t$ 4.200\t35 %\nÑoquis\t$ 3.100\t48 %'
  assert.ok(esGrilla(tsv))
  const t = tablaDesdeTexto(tsv)!
  assert.deepEqual(t.columnas.map((c) => c.tipo), ['texto', 'moneda', 'porcentaje'])
  assert.equal(t.filas[0]!.celdas[t.columnas[1]!.id], 4200)
  const csv = 'Nombre;Nota\n"Pérez, Ana";"dice ""hola"""\n'
  const c = tablaDesdeTexto(csv)!
  assert.equal(c.filas[0]!.celdas[c.columnas[0]!.id], 'Pérez, Ana')
  assert.equal(c.filas[0]!.celdas[c.columnas[1]!.id], 'dice "hola"')
  assert.equal(esGrilla('una sola línea'), false)
})

test('17 · copiar para Excel (TSV con coma decimal) y CSV', () => {
  const t = menu()
  const tsv = tablaATexto(t, 'tsv').split('\n')
  assert.equal(tsv[0], 'Plato\tPrecio\tMargen\tEstado')
  assert.equal(tsv[1], 'Milanesa\t4200\t35\tListo')
  assert.match(tablaATexto(t, 'csv'), /^Plato,Precio,Margen,Estado\n/)
})

test('18 · leerTabla nunca falla con datos rotos', () => {
  assert.equal(leerTabla({}).columnas.length, 1)
  assert.equal(leerTabla({ columnas: 'mal', filas: 7 }).filas.length, 0)
})

test('19 · gráfico desde una tabla: agrupa, cuenta y usa los colores de las etiquetas', () => {
  const t = menu()
  const sug = fuenteSugerida(t, 'tabla1')!
  assert.equal(t.columnas.find((c) => c.id === sug.categoria)!.nombre, 'Plato')
  assert.equal(sug.series.length, 2)
  const porEstado = resolverGrafico(
    leerGrafico({ tipo: 'barras', fuente: { tabla: 'tabla1', categoria: t.columnas[3]!.id, series: [], agrupar: 'contar' } }),
    t,
  )
  assert.deepEqual(porEstado.categorias, ['Listo', 'En prueba'])
  assert.deepEqual(porEstado.series[0]!.valores, [2, 1])
  assert.equal(porEstado.coloresPorCategoria, true)
  const suma = resolverGrafico(leerGrafico({ tipo: 'barras', fuente: { tabla: 'tabla1', categoria: t.columnas[3]!.id, series: [t.columnas[1]!.id], agrupar: 'suma' } }), t)
  assert.deepEqual(suma.series[0]!.valores, [7300, 1800])
})

test('20 · gráfico: torta con «Otros», datos propios y avisos', () => {
  const muchas = leerGrafico({ tipo: 'torta', propios: { categorias: Array.from({ length: 12 }, (_, i) => `C${i}`), series: [{ nombre: 'S', valores: Array.from({ length: 12 }, (_, i) => 12 - i) }] } })
  const r = resolverGrafico(muchas, null)
  assert.equal(r.categorias.length, 8)
  assert.equal(r.categorias.at(-1), 'Otros')
  assert.equal(r.series[0]!.valores.reduce((s, v) => s! + (v ?? 0), 0), 78)
  assert.match(resolverGrafico(leerGrafico({ tipo: 'barras', fuente: { tabla: 'x', categoria: 'c', series: [], agrupar: 'suma' } }), null).aviso!, /ya no está en el lienzo/)
  assert.match(resolverGrafico(leerGrafico({ tipo: 'barras' }), null).aviso!, /datos/i)
})
