// Prueba de la revisión de licencias: `npm run licencias:probar`. Sin red.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expresionPermitida, revisar } from './revisar-licencias.mjs'

test('expresiones SPDX', () => {
  assert.equal(expresionPermitida('MIT'), true)
  assert.equal(expresionPermitida('(MIT OR GPL-2.0-only)'), true, 'con una permitida alcanza')
  assert.equal(expresionPermitida('(MPL-2.0 OR Apache-2.0)'), true)
  assert.equal(expresionPermitida('Apache-2.0 AND LGPL-3.0-or-later AND MIT'), true)
  assert.equal(expresionPermitida('MIT AND GPL-2.0-only'), false, 'con AND tienen que ser todas')
  assert.equal(expresionPermitida('GPL-2.0-only'), false, 'GPL-2.0-only no es compatible con la AGPL-3.0')
  assert.equal(expresionPermitida('SSPL-1.0'), false)
  assert.equal(expresionPermitida('CC-BY-NC-4.0'), false)
  assert.equal(expresionPermitida('((MIT OR ISC) AND BSD-3-Clause)'), true)
  assert.equal(expresionPermitida('MIT OR'), false, 'expresión rota')
})

test('revisa un lockfile: detecta lo incompatible y lo que no declara licencia', () => {
  const lock = {
    packages: {
      '': { name: 'app' },
      'node_modules/bien': { license: 'MIT' },
      'node_modules/a/node_modules/anidada': { license: 'ISC', dev: true },
      'node_modules/mala': { license: 'SSPL-1.0' },
      'node_modules/sin': {},
      'node_modules/objeto': { license: { type: 'MIT' } },
    },
  }
  const r = revisar(lock)
  assert.equal(r.total, 5)
  assert.deepEqual(r.mal.sort(), ['mala: SSPL-1.0', 'sin: no declara licencia'])
})
