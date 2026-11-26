// Pruebas de precios.ts: la cuenta del costo (docs/plan-ia-integrada.md, 9.4 y 12.1) con los casos del plan, el escalón de
// Haiku, la franja horaria, el cambio con fecha y que cada fila lleve su fecha y su fuente. `npm run ia:probar-precios`.
// Sin base de datos ni red.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Uso } from '../tipos'
import { costoUsd, PRECIOS, precioDe, type PrecioModelo } from './precios'

const uso = (u: Partial<Uso>): Uso => ({ entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0, ...u })
const precio = (modelo: string) => {
  const p = precioDe('anthropic', modelo)
  assert.ok(p, `falta el precio de ${modelo}`)
  return p
}

test('9.7 · Opus 5.5, respuesta simple con caché frío: USD 0,0715', () => {
  // 10.500 tokens escritos en caché a 5 + 2.500 de entrada a 4 + 450 de salida a 20
  const c = costoUsd(precio('claude-opus-5-5'), uso({ cacheEscritura: 10_500, entrada: 2_500, salida: 450 }))
  assert.equal(c, 0.0715)
})

test('9.7 · Opus 5.5 con el caché ya caliente: USD 0,0211 (el plan dice «baja a 0,021»)', () => {
  const c = costoUsd(precio('claude-opus-5-5'), uso({ cacheLectura: 10_500, entrada: 2_500, salida: 450 }))
  assert.equal(c, 0.0211)
})

test('Sonnet 5.5: caché leído a 0,10 y escrito a 2,50', () => {
  const c = costoUsd(precio('claude-sonnet-5-5'), uso({ cacheLectura: 1_000_000, cacheEscritura: 1_000_000, entrada: 1_000_000, salida: 1_000_000 }))
  assert.equal(c, 0.1 + 2.5 + 2 + 10)
})

test('Fable 5.2: 8 de entrada, 40 de salida, caché 0,20 / 10', () => {
  const c = costoUsd(precio('claude-fable-5-2'), uso({ entrada: 1_000_000, salida: 1_000_000, cacheLectura: 1_000_000, cacheEscritura: 1_000_000 }))
  assert.equal(c, 8 + 40 + 0.2 + 10)
})

test('Haiku 5.5: hasta 100.000 tokens de entrada, precio chico', () => {
  const c = costoUsd(precio('claude-haiku-5-5'), uso({ entrada: 100_000, salida: 1_000_000 }))
  assert.equal(c, 0.01 + 0.5)
})

test('Haiku 5.5: más de 100.000 tokens de entrada, precio grande; el caché también cuenta para el tamaño', () => {
  const sin = costoUsd(precio('claude-haiku-5-5'), uso({ entrada: 100_001, salida: 1_000_000 }))
  assert.equal(sin, 2.5500005)
  // 40.000 normales + 70.000 leídos del caché = 110.000 > 100.000: todo el pedido va al precio grande (lectura 0,05)
  const con = costoUsd(precio('claude-haiku-5-5'), uso({ entrada: 40_000, cacheLectura: 70_000, salida: 0 }))
  assert.equal(con, (40_000 * 0.5 + 70_000 * 0.05) / 1e6)
  // el tamaño justo en el límite todavía es el chico
  assert.equal(costoUsd(precio('claude-haiku-5-5'), uso({ entrada: 30_000, cacheLectura: 70_000 })), (30_000 * 0.1 + 70_000 * 0.01) / 1e6)
})

test('un pedido sin tokens cuesta cero', () => {
  for (const p of PRECIOS) assert.equal(costoUsd(p, uso({})), 0)
})

test('el proveedor falso: 200.000 de entrada y 20.000 de salida cuestan USD 0,30, para cualquier guion', () => {
  const p = precioDe('falso', 'guion:caro')
  assert.ok(p)
  assert.equal(costoUsd(p, uso({ entrada: 200_000, salida: 20_000 })), 0.3)
  assert.equal(precioDe('falso', 'guion:responder'), p)
  assert.equal(precioDe('falso', 'otra-cosa'), undefined)
})

test('un modelo que Telar no conoce no tiene precio', () => {
  assert.equal(precioDe('anthropic', 'claude-inventado'), undefined)
  assert.equal(precioDe('anthropic', 'guion:responder'), undefined)
})

test('franja horaria: el doble en horario pico (UTC), con salto de medianoche', () => {
  const base: PrecioModelo = { ...precio('claude-opus-5-5'), proveedor: 'compatible', entrada: 1, salida: 0, cacheLectura: 0, cacheEscritura: 0 }
  const p: PrecioModelo = {
    ...base,
    franjas: [
      { dias: [1, 2, 3, 4, 5], desdeUtc: '06:00', hastaUtc: '10:00', por: 2 },
      { dias: [1, 2, 3, 4, 5], desdeUtc: '23:00', hastaUtc: '02:00', por: 3 },
    ],
  }
  const u = uso({ entrada: 1_000_000 })
  assert.equal(costoUsd(p, u, new Date('2026-11-25T08:00:00Z')), 2) // miércoles, pico
  assert.equal(costoUsd(p, u, new Date('2026-11-25T10:00:00Z')), 1) // el borde de afuera es normal
  assert.equal(costoUsd(p, u, new Date('2026-11-28T08:00:00Z')), 1) // sábado
  assert.equal(costoUsd(p, u, new Date('2026-11-25T23:30:00Z')), 3) // antes de medianoche
  assert.equal(costoUsd(p, u, new Date('2026-11-26T01:30:00Z')), 3) // después de medianoche
})

test('cambio con fecha: desde ese día valen los precios nuevos y el caché escala', () => {
  const p: PrecioModelo = { ...precio('claude-opus-5-5'), proveedor: 'compatible', entrada: 2, salida: 10, cacheLectura: 0.1, cacheEscritura: 0, cambia: { desde: '2026-12-01', entrada: 4, salida: 20 } }
  const u = uso({ entrada: 1_000_000, salida: 1_000_000, cacheLectura: 1_000_000 })
  assert.equal(costoUsd(p, u, new Date('2026-11-30T23:59:59Z')), 2 + 10 + 0.1)
  assert.equal(costoUsd(p, u, new Date('2026-12-01T00:00:00Z')), 4 + 20 + 0.2)
})

test('cada fila lleva su fecha, su fuente y capacidades coherentes', () => {
  for (const p of PRECIOS) {
    assert.match(p.verificado, /^\d{4}-\d{2}-\d{2}$/, `${p.modelo}: verificado`)
    assert.ok(p.fuente.length > 5, `${p.modelo}: fuente`)
    assert.ok(p.entrada > 0 && p.salida > 0, `${p.modelo}: precios`)
    assert.ok(p.capacidades.contexto >= p.capacidades.salidaMax, `${p.modelo}: contexto`)
  }
  // los modelos de Anthropic de fábrica del plan (9.4) están y son los que la documentación oficial lista
  for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) assert.ok(precioDe('anthropic', id), id)
})
