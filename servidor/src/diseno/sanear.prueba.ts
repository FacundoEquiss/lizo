// Pruebas del saneado (plan PD-0): 30+ casos de HTML, CSS y SVG maliciosos o rotos. `npm run diseno:probar-sanear`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analizarHtml, serializarHtml } from '../../../compartido/diseno/html'
import { expandirPiezas } from '../../../compartido/diseno/documento'
import { sanearCss, sanearHtml, sanearSvg, validarUrl } from './sanear'

const falla = (fn: () => unknown, parte: RegExp) => assert.throws(fn, (e: Error) => parte.test(e.message))
const svgB64 = (s: string) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64')

test('1 · <script> se rechaza con un mensaje claro', () => falla(() => sanearHtml('<p>hola</p><script>alert(1)</script>'), /no pueden tener <script>/))
test('2 · onerror en una imagen se saca y avisa', () => {
  const r = sanearHtml('<img src="/archivos/a.png" onerror="alert(1)">')
  assert.doesNotMatch(r.html, /onerror/)
  assert.ok(r.avisos.some((a) => /eventos/.test(a)))
})
test('3 · onclick en un div se saca', () => assert.doesNotMatch(sanearHtml('<div onclick="x()">a</div>').html, /onclick/i))
test('4 · <a href="javascript:"> no deja nada que navegue', () => {
  const r = sanearHtml('<a href="javascript:alert(1)">x</a>')
  assert.doesNotMatch(r.html, /javascript|href/i)
})
test('5 · <a href> externo queda como data-href (no navega)', () => {
  const r = sanearHtml('<a href="https://ejemplo.com">x</a>')
  assert.match(r.html, /data-href="https:\/\/ejemplo.com"/)
  assert.doesNotMatch(r.html, / href=/)
})
test('6 · <iframe> se va', () => assert.doesNotMatch(sanearHtml('<iframe src="https://malo.com"></iframe><p>a</p>').html, /iframe/))
test('7 · <object> se va', () => assert.doesNotMatch(sanearHtml('<object data="https://malo.com/x.swf"></object>').html, /object/))
test('8 · <embed> se va', () => assert.doesNotMatch(sanearHtml('<embed src="https://malo.com/x">').html, /embed/))
test('9 · <link> se va', () => assert.doesNotMatch(sanearHtml('<link rel="stylesheet" href="https://malo.com/x.css"><p>a</p>').html, /link/))
test('10 · <meta refresh> se va', () => assert.doesNotMatch(sanearHtml('<meta http-equiv="refresh" content="0;url=https://malo.com">').html, /meta/))
test('11 · <base> se va', () => assert.doesNotMatch(sanearHtml('<base href="https://malo.com/"><p>a</p>').html, /base/))
test('12 · <form action> queda como div y los campos inertes', () => {
  const r = sanearHtml('<form action="https://malo.com"><input name="a" value="x"></form>')
  assert.doesNotMatch(r.html, /form|action/)
  assert.match(r.html, /<input[^>]* disabled[^>]* tabindex="-1"/)
})
test('13 · @import en un <style> se rechaza', () => falla(() => sanearHtml('<style>@import url(https://malo.com/a.css);</style>'), /@import/))
test('14 · url() de afuera en un <style> se rechaza nombrando subir_activo', () =>
  falla(() => sanearHtml('<style>.a{background:url(https://malo.com/x.png)}</style>'), /subir_activo/))
test('15 · url() de afuera en un estilo en línea se rechaza', () =>
  falla(() => sanearHtml('<div style="background:url(http://malo.com/x.png)">a</div>'), /de afuera/))
test('16 · expression() se rechaza', () => falla(() => sanearHtml('<div style="width:expression(alert(1))"></div>'), /expression/))
test('17 · behavior: se rechaza', () => falla(() => sanearCss('.a{behavior:url(x.htc)}'), /behavior/))
test('18 · <script> dentro de un SVG se rechaza', () => falla(() => sanearHtml('<svg><script>alert(1)</script></svg>'), /<script>/))
test('19 · onload en un SVG se saca', () => {
  const r = sanearHtml('<svg onload="alert(1)" viewBox="0 0 10 10"><circle r="5"></circle></svg>')
  assert.doesNotMatch(r.html, /onload/)
  assert.match(r.html, /viewBox="0 0 10 10"/)
})
test('20 · <use> que apunta afuera pierde el href', () => {
  const r = sanearHtml('<svg><use href="https://malo.com/s.svg#x"></use></svg>')
  assert.doesNotMatch(r.html, /malo/)
})
test('21 · <image> de SVG con imagen de afuera se rechaza', () => falla(() => sanearHtml('<svg><image href="https://malo.com/x.png"></image></svg>'), /de afuera/))
test('22 · data:image/svg+xml con script se rechaza', () =>
  falla(() => sanearHtml(`<img src="${svgB64('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')}">`), /código/))
test('23 · data:text/html se rechaza', () => falla(() => sanearHtml('<img src="data:text/html,<b>x</b>">'), /no sirve/))
test('24 · srcdoc se saca', () => assert.doesNotMatch(sanearHtml('<div srcdoc="&lt;script&gt;">a</div>').html, /srcdoc/))
test('25 · formaction se saca', () => assert.doesNotMatch(sanearHtml('<button formaction="javascript:x()">a</button>').html, /formaction/))
test('26 · una imagen de Telar queda, con su data-id', () => {
  const r = sanearHtml('<img src="/archivos/diseno/p/abc.png" alt="logo">')
  assert.match(r.html, /^<img data-id="[a-z0-9]{6}" src="\/archivos\/diseno\/p\/abc.png" alt="logo">$/)
})
test('27 · los data-id existentes se conservan', () => assert.match(sanearHtml('<div data-id="abc123">a</div>').html, /data-id="abc123"/))
test('28 · un data-id repetido se cambia', () => {
  const r = sanearHtml('<div data-id="abc123">a</div><div data-id="abc123">b</div>')
  const ids = [...r.html.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1])
  assert.equal(new Set(ids).size, 2)
})
test('29 · un campo queda inerte', () => assert.match(sanearHtml('<input value="hola">').html, /disabled[^>]*tabindex="-1"/))
test('30 · el contenido de una instancia se descarta (lo pone su pieza)', () => {
  const r = sanearHtml(`<div data-pieza="boton" data-props='{"a":1}'><span>x</span></div>`)
  assert.doesNotMatch(r.html, /<span/)
  assert.match(r.html, /data-props="\{&quot;a&quot;:1\}"/)
})
test('31 · data-props que no es JSON se rechaza explicando el formato', () => falla(() => sanearHtml(`<div data-pieza="b" data-props='{mal'></div>`), /JSON/))
test('32 · <noscript> se va con todo', () => assert.equal(sanearHtml('<noscript><img src=x onerror=alert(1)></noscript>').html, ''))
test('33 · mXSS con <math> se va', () => assert.doesNotMatch(sanearHtml('<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>').html, /onerror|math/))
test('34 · "<<script>" se rechaza', () => falla(() => sanearHtml('<<script>script>alert(1)</script>'), /<script>/))
test('35 · CSS que intenta cerrar el <style> se rechaza', () => falla(() => sanearCss('a{}</style><img src=x onerror=1>'), /<style>/))
test('36 · el texto escapado queda escapado', () => assert.equal(sanearHtml('<p>&lt;script&gt;</p>', { conIds: false }).html, '<p>&lt;script&gt;</p>'))
test('37 · el <style> del HTML pasa al CSS del marco', () => {
  const r = sanearHtml('<style>.t{color:red}</style><p class="t">a</p>')
  assert.equal(r.css, '.t{color:red}')
  assert.doesNotMatch(r.html, /style/)
})
test('38 · SVG subido con evento se rechaza', () => falla(() => sanearSvg('<svg onload="x()"></svg>'), /eventos/))
test('39 · SVG subido que pide un recurso se rechaza', () => falla(() => sanearSvg('<svg><image href="https://malo.com/a.png"/></svg>'), /autocontenido/))
test('40 · validarUrl acepta /archivos y data:image chica, rechaza ../', () => {
  assert.equal(validarUrl('/archivos/diseno/p/a.png'), '/archivos/diseno/p/a.png')
  assert.ok(validarUrl('data:image/png;base64,iVBORw0KGgo='))
  falla(() => validarUrl('/archivos/../clave-mcp.txt'), /no sirve/)
})
test('41 · ida y vuelta: el HTML saneado se vuelve a leer igual', () => {
  const r = sanearHtml('<div class="a" style="color: red"><h1>Título &amp; "más"</h1><svg viewBox="0 0 2 2"><linearGradient id="g"><stop offset="0"></stop></linearGradient><path d="M0 0"></path></svg><br><img src="/archivos/x.png"></div>')
  assert.equal(serializarHtml(analizarHtml(r.html)), r.html)
  assert.match(r.html, /linearGradient/)
})
test('42 · expandirPiezas: variante, texto, booleano y data-*', () => {
  const html = `<div data-id="a1" data-pieza="boton" data-props='{"color":"verde","etiqueta":"Comprar <ya>","icono":false}'></div>`
  const salida = expandirPiezas(html, {
    boton: {
      html: '<button class="b"><i data-si="icono">*</i><span>{{etiqueta}}</span></button>',
      css: '',
      hojas: [],
      propiedades: [
        { nombre: 'color', clase: 'variante', valores: ['verde', 'azul'], defecto: 'azul' },
        { nombre: 'etiqueta', clase: 'texto', defecto: 'Aceptar' },
        { nombre: 'icono', clase: 'booleano', defecto: true },
      ],
    },
  })
  assert.match(salida, /data-color="verde"/)
  assert.match(salida, /<span>Comprar &lt;ya&gt;<\/span>/)
  assert.doesNotMatch(salida, /<i>/)
})
