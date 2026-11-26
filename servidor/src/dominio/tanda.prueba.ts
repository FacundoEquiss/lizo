// Prueba de la tanda (plan 7.6, tarea 2.7): lo que hace una llamada dentro de `conTanda` queda marcado en la actividad (`tanda`) y
// los ids que toca se anotan en sus efectos, sin mezclarse con lo que hace otra persona al mismo tiempo. `npm run ia:probar-tanda`.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { buscarHerramienta } from '../mcp/herramientas'
import { crearEntorno, crearTarjeta, type Entorno } from '../ia/prueba-base'
import { conTanda, efectosVacios, tandaActual, type Tanda } from './tanda'

let e: Entorno
before(async () => {
  e = await crearEntorno()
})
after(async () => e.cerrar())

const nueva = (id: string): Tanda => ({ id, llamadaId: null, efectos: efectosVacios() })
const tandasDe = async (clave: string) =>
  (await e.db.consulta<{ tanda: string | null; accion: string }>(`select tanda, accion from actividad where tarjeta_clave = $1 order by creado_en, id`, [clave])).map((f) => f.tanda)

test('fuera de una tanda no hay tanda: la actividad queda con tanda null', async () => {
  assert.equal(tandaActual(), undefined)
  const t = await crearTarjeta(e, 'Sin tanda')
  assert.deepEqual(await tandasDe(t.clave), [null])
})

test('dentro de una tanda: la actividad lleva su id y los efectos juntan las tarjetas tocadas', async () => {
  const t = await crearTarjeta(e, 'Con tanda')
  const tanda = nueva('trabajo-1')
  await conTanda(tanda, async () => {
    assert.equal(tandaActual(), tanda)
    await e.s.moverTarjeta({ actor: { tipo: 'ia', id: 'ia', nombre: 'Claude' } }, t.clave, { listaId: e.listas['Hecho']! })
  })
  assert.equal(tandaActual(), undefined, 'al salir, la tanda se va')
  assert.ok((await tandasDe(t.clave)).includes('trabajo-1'))
  assert.deepEqual(tanda.efectos.tarjetas, [t.id])
  assert.equal(tanda.efectos.elementos.length, 0)
})

test('dos tandas a la vez en la misma cuenta no se mezclan (contexto asíncrono)', async () => {
  const a = await crearTarjeta(e, 'De A')
  const b = await crearTarjeta(e, 'De B')
  const ta = nueva('trabajo-a')
  const tb = nueva('trabajo-b')
  const ia = { actor: { tipo: 'ia' as const, id: 'ia', nombre: 'Claude' } }
  await Promise.all([
    conTanda(ta, () => e.s.comentar(ia, a.clave, 'hola a')),
    conTanda(tb, () => e.s.comentar(ia, b.clave, 'hola b')),
    // alguien que no está en ninguna tanda, tocando a la vez
    e.s.comentar(e.persona, a.clave, 'una persona comentando'),
  ])
  assert.deepEqual(ta.efectos.tarjetas, [a.id])
  assert.deepEqual(tb.efectos.tarjetas, [b.id])
  const deA = await e.db.consulta<{ tanda: string | null; actor: any }>(`select tanda, actor from actividad where tarjeta_clave = $1 and accion = 'comentario.creado'`, [a.clave])
  assert.equal(deA.find((f) => f.actor.tipo === 'humano')!.tanda, null, 'lo de la persona no entra en la tanda')
  assert.equal(deA.find((f) => f.actor.tipo === 'ia')!.tanda, 'trabajo-a')
})

test('armar_en_lienzo: los objetos y conectores creados quedan en los efectos', async () => {
  const h = buscarHerramienta('armar_en_lienzo')!
  const tanda = nueva('trabajo-lienzo')
  const r = await conTanda(tanda, () =>
    h.ejecutar(
      e.s,
      { tipo: 'ia', id: 'ia', nombre: 'Claude' },
      h.esquema.parse({
        proyecto: 'PR',
        objetos: [
          { ref: 'a', tipo: 'nota', texto: 'Uno' },
          { ref: 'b', tipo: 'nota', texto: 'Dos' },
        ],
        conectores: [{ desde: 'a', hasta: 'b' }],
      }),
    ),
  )
  assert.ok(r)
  assert.equal(tanda.efectos.elementos.length, 2)
  assert.equal(tanda.efectos.conectores.length, 1)
  const act = await e.db.consulta<{ tanda: string | null }>(`select tanda from actividad where tanda = 'trabajo-lienzo'`)
  assert.ok(act.length >= 1, 'la actividad de armar quedó marcada')
})
