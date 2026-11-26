// Prueba de la copia de base (SRV-2). `npm run copia:probar`. Sin red: dos bases PGlite en memoria. El origen tiene lo de un
// entorno de pruebas real (proyecto, tarjetas, cuentas, IA…) más archivos binarios y eventos; se copia al destino vacío y se compara.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { copiarBase, ordenarPorClaves } from './copiar-base'
import { migrar } from './migraciones'
import { abrirPgliteEnMemoria } from './pglite'
import { crearEntorno, crearTarjeta } from '../ia/prueba-base'

const MIGRACIONES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations')

test('el orden respeta las claves ajenas y avisa de un ciclo', () => {
  assert.deepEqual(
    ordenarPorClaves(['c', 'b', 'a'], [{ hija: 'c', padre: 'b' }, { hija: 'b', padre: 'a' }]),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(ordenarPorClaves(['a'], [{ hija: 'a', padre: 'a' }]), ['a'], 'una tabla que se referencia a sí misma no es ciclo')
  assert.throws(() => ordenarPorClaves(['a', 'b'], [{ hija: 'a', padre: 'b' }, { hija: 'b', padre: 'a' }]), /ciclo/)
})

test('copia todo: mismas filas, binarios idénticos, secuencias al día y se puede repetir', async () => {
  const e = await crearEntorno()
  const destino = await abrirPgliteEnMemoria()
  try {
    await crearTarjeta(e, 'Una tarjeta con ñ, “comillas” y emoji 🧵')
    await crearTarjeta(e, 'Otra')
    // Binarios de verdad (con todos los bytes) y más de una tanda, para probar el corte de a pocas filas.
    const binarios: Record<string, Buffer> = {}
    for (let i = 0; i < 11; i++) {
      const datos = Buffer.from(Array.from({ length: 70_000 }, (_, k) => (k * 7 + i) % 256))
      binarios[`prueba/${i}.bin`] = datos
      await e.db.consulta('insert into archivos (ruta, mime, datos, tamano) values ($1, $2, $3, $4)', [`prueba/${i}.bin`, 'application/octet-stream', datos, datos.length])
    }
    const antesEventos = Number((await e.db.consulta<{ n: string }>('select coalesce(max(n), 0) as n from eventos'))[0].n)

    const informe = await copiarBase(e.db, destino, { carpetaMigraciones: MIGRACIONES })
    assert.ok(informe.filas > 20, 'tenía que copiar filas')
    for (const [t, v] of Object.entries(informe.tablas)) assert.equal(v.origen, v.destino, `tabla ${t}`)
    assert.equal(informe.tablas.archivos.destino, 11)

    // Binarios idénticos, byte a byte.
    for (const [ruta, datos] of Object.entries(binarios)) {
      const [f] = await destino.consulta<{ datos: Buffer }>('select datos from archivos where ruta = $1', [ruta])
      assert.equal(createHash('sha256').update(f.datos).digest('hex'), createHash('sha256').update(datos).digest('hex'), ruta)
    }
    // Textos y fechas intactos.
    const a = await e.db.consulta('select id, titulo, creada_en from tarjetas order by id')
    const b = await destino.consulta('select id, titulo, creada_en from tarjetas order by id')
    assert.deepEqual(b, a)
    assert.ok(b.some((t: any) => t.titulo.includes('🧵')))
    // Las secuencias siguen donde estaban: el próximo evento no repite un número.
    const [nuevo] = await destino.consulta<{ n: string }>(`insert into eventos (datos) values ('{}'::jsonb) returning n`)
    assert.ok(Number(nuevo.n) > antesEventos, 'la secuencia de eventos tenía que seguir de donde quedó')
    await destino.consulta('delete from eventos where n = $1', [nuevo.n])

    // Repetirla da lo mismo (vacía y vuelve a copiar), y «solo contar» no toca nada.
    const otra = await copiarBase(e.db, destino, { carpetaMigraciones: MIGRACIONES })
    assert.deepEqual(otra.tablas, informe.tablas)
    const contado = await copiarBase(e.db, destino, { carpetaMigraciones: MIGRACIONES, soloContar: true })
    assert.deepEqual(contado.tablas, informe.tablas)
  } finally {
    await e.cerrar()
    await destino.cerrar()
  }
})

test('si una tabla no coincide, no se confirma nada y el destino queda como estaba', async () => {
  const e = await crearEntorno()
  const destino = await abrirPgliteEnMemoria()
  try {
    await migrar(destino, MIGRACIONES)
    await destino.consulta(`insert into archivos (ruta, mime, datos, tamano) values ('previa', 'x/y', $1, 1)`, [Buffer.from([1])])
    // Un origen con una tabla que el destino no tiene: se corta ANTES de tocar nada.
    await e.db.ejecutar('create table extra_solo_origen (id int primary key)')
    await assert.rejects(copiarBase(e.db, destino, { carpetaMigraciones: MIGRACIONES }), /extra_solo_origen/)
    assert.equal(Number((await destino.consulta<{ n: string }>('select count(*) as n from archivos'))[0].n), 1, 'lo que había en el destino sigue ahí')
  } finally {
    await e.cerrar()
    await destino.cerrar()
  }
})
