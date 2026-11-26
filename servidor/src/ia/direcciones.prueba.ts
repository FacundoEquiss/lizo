// Prueba del filtro de direcciones (plan 12.6): la tabla de «pasa / pide permiso / se rechaza», dónde se carga sola una dirección y la
// respuesta final. Puro, sin base. `npm run ia:probar-direcciones`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conjuntoDe, direccionesDeArgs, extraerDirecciones, filtrarRespuesta, juzgar, type Conocidas } from './direcciones'

const c = (o: { confiables?: string[]; vistas?: string[] } = {}): Conocidas => ({
  confiables: new Set(o.confiables ?? []),
  vistas: new Set(o.vistas ?? []),
  esPropia: (u) => u.startsWith('https://telarapp.vercel.app/'),
})

test('extraer: sin la puntuación del final, sin paréntesis ni comillas, y con varias', () => {
  assert.deepEqual(extraerDirecciones('mirá https://a.com/x, y también (https://b.com/y). Listo https://c.com/z?q=1.'), [
    'https://a.com/x',
    'https://b.com/y',
    'https://c.com/z?q=1',
  ])
  assert.deepEqual(extraerDirecciones('sin links, ni www.ejemplo.com, ni ftp://x'), [])
  assert.deepEqual([...conjuntoDe('https://a.com', null, 'y https://b.com')].sort(), ['https://a.com', 'https://b.com'])
})

test('dónde se carga sola: imagen del lienzo, subir_activo y Markdown ![]; un link o un enlace no', () => {
  const lienzo = direccionesDeArgs('armar_en_lienzo', {
    objetos: [
      { tipo: 'imagen', url: 'https://x.com/a.png' },
      { tipo: 'enlace', url: 'https://x.com/pagina' },
      { tipo: 'nota', texto: 'mirá [esto](https://x.com/link) y ![foto](https://x.com/foto.png)' },
    ],
  })
  assert.deepEqual(lienzo, [
    { url: 'https://x.com/a.png', carga: true },
    { url: 'https://x.com/pagina', carga: false },
    { url: 'https://x.com/link', carga: false },
    { url: 'https://x.com/foto.png', carga: true },
  ])
  assert.deepEqual(direccionesDeArgs('subir_activo', { nombre: 'logo', url: 'https://x.com/logo.svg' }), [{ url: 'https://x.com/logo.svg', carga: true }])
  assert.deepEqual(direccionesDeArgs('vincular', { tarjeta: 'RC-1', tipo: 'pr', url: 'https://github.com/x/y/pull/1' }), [{ url: 'https://github.com/x/y/pull/1', carga: false }])
  assert.deepEqual(direccionesDeArgs('comentar', { tarjeta: 'RC-1', texto: 'sin links' }), [])
  assert.deepEqual(direccionesDeArgs('comentar', null), [])
})

test('la tabla de 12.6: Telar y el pedido pasan; lo visto en datos pasa como link y pide permiso si se carga; lo inventado se rechaza', () => {
  const k = c({ confiables: ['https://del-pedido.com/x'], vistas: ['https://de-datos.com/img.png', 'https://de-datos.com/pagina'] })
  const j = (url: string, carga: boolean) => juzgar([{ url, carga }], k)
  assert.deepEqual(j('https://telarapp.vercel.app/archivos/lienzo/a.png', true), { tipo: 'ok' })
  assert.deepEqual(j('https://del-pedido.com/x', true), { tipo: 'ok' })
  assert.deepEqual(j('https://de-datos.com/pagina', false), { tipo: 'ok' })
  assert.deepEqual(j('https://de-datos.com/img.png', true), { tipo: 'permiso', url: 'https://de-datos.com/img.png' })
  assert.deepEqual(j('https://afuera.com/?x=lo-que-leyo', false), { tipo: 'rechazar', url: 'https://afuera.com/?x=lo-que-leyo' })
  assert.deepEqual(j('https://afuera.com/?x=lo-que-leyo', true), { tipo: 'rechazar', url: 'https://afuera.com/?x=lo-que-leyo' })
  // exacta: una variante con datos pegados no es la misma dirección
  assert.equal(j('https://de-datos.com/pagina?x=secreto', false).tipo, 'rechazar')
  // lo inventado gana sobre lo que pide permiso
  assert.equal(
    juzgar(
      [
        { url: 'https://de-datos.com/img.png', carga: true },
        { url: 'https://inventada.com', carga: false },
      ],
      k,
    ).tipo,
    'rechazar',
  )
  assert.deepEqual(juzgar([], k), { tipo: 'ok' })
})

test('la respuesta final: se quita lo inventado, la imagen de datos pasa a link, lo demás queda', () => {
  const k = c({ confiables: ['https://del-pedido.com/x'], vistas: ['https://de-datos.com/img.png', 'https://de-datos.com/pagina'] })
  const r = filtrarRespuesta(
    'Listo. Mirá https://de-datos.com/pagina y https://del-pedido.com/x. ![dato](https://de-datos.com/img.png) ![mala](https://afuera.com/p.png?d=abc) y https://afuera.com/otra.',
    k,
  )
  assert.match(r.texto, /https:\/\/de-datos\.com\/pagina y https:\/\/del-pedido\.com\/x/)
  assert.match(r.texto, /\[dato\]\(https:\/\/de-datos\.com\/img\.png\)/, 'sin el «!»: no se carga sola')
  assert.doesNotMatch(r.texto, /!\[dato\]/)
  assert.doesNotMatch(r.texto, /afuera\.com/)
  assert.match(r.texto, /\(mala\)/)
  assert.match(r.texto, /\[dirección quitada\]\./, 'la puntuación del final se conserva')
  assert.deepEqual(r.quitadas.sort(), ['https://afuera.com/otra', 'https://afuera.com/p.png?d=abc'])
  assert.deepEqual(filtrarRespuesta('sin direcciones', k), { texto: 'sin direcciones', quitadas: [] })
  assert.equal(filtrarRespuesta('![propia](https://telarapp.vercel.app/archivos/x.png)', k).quitadas.length, 0)
})
