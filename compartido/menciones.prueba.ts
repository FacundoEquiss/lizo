// Pruebas de las menciones (compartido/menciones.ts): los casos de la sección 5.3 del plan de la IA integrada y los
// que se le suman (acentos, puntuación pegada, código, mails y direcciones, varias por línea, mayúsculas, alias con
// guion), más cómo se resuelve a un miembro y cómo se sugiere. `npm run menciones:probar`. Sin base de datos ni red.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ALIAS_RESERVADOS,
  aliasValido,
  extraerMenciones,
  normalizarAlias,
  PATRON_ALIAS,
  resolverExacto,
  sugerir,
  type MiembroMencionable,
} from './menciones'

/** Solo los alias de lo que se extrae. */
const alias = (texto: string) => extraerMenciones(texto).map((m) => m.alias)

const miembros: MiembroMencionable[] = [
  { id: 'm1', alias: 'facundo', nombre: 'Facundo' },
  { id: 'm2', alias: 'claude', nombre: 'Claude' },
  { id: 'm3', alias: 'gpt', nombre: 'ChatGPT' },
  { id: 'm4', alias: 'jose-luis', nombre: 'José Luis' },
  { id: 'm5', alias: 'claude-opus', nombre: 'Claude Opus' },
  { id: 'm6', alias: 'viejo', nombre: 'Agente viejo', archivado: true },
]

// ───────────────────────── Los casos de la sección 5.3 ─────────────────────────

test('5.3 · @claude ya le respondí', () => {
  assert.deepEqual(alias('@claude ya le respondí'), ['claude'])
})

test('5.3 · «Gracias, @Claude.» quita el punto final y pasa a minúsculas', () => {
  assert.deepEqual(alias('Gracias, @Claude.'), ['claude'])
})

test('5.3 · @josé-luis mirá esto → jose-luis', () => {
  assert.deepEqual(alias('@josé-luis mirá esto'), ['jose-luis'])
})

test('5.3 · un mail no es una mención', () => {
  assert.deepEqual(alias('mandá a facu@ejemplo.com'), [])
})

test('5.3 · el código en línea no cuenta', () => {
  assert.deepEqual(alias('usá `@claude` en el comentario'), [])
})

test('5.3 · una dirección web no es una mención', () => {
  assert.deepEqual(alias('https://x.com/@claude'), [])
})

test('5.3 · @claude y @gpt, comparen → dos menciones', () => {
  assert.deepEqual(alias('@claude y @gpt, comparen'), ['claude', 'gpt'])
})

test('5.3 · @cl se extrae, pero no resuelve (un alias a medio escribir no dispara)', () => {
  assert.deepEqual(alias('@cl'), ['cl'])
  assert.equal(resolverExacto('cl', miembros), null)
})

// ───────────────────────── Posiciones ─────────────────────────

test('posiciones: desde el «@» hasta el final del alias, sobre el texto original', () => {
  const texto = 'Gracias, @Claude. Y @josé-luis!'
  const [a, b] = extraerMenciones(texto)
  assert.equal(texto.slice(a!.desde, a!.hasta), '@Claude')
  assert.equal(texto.slice(b!.desde, b!.hasta), '@josé-luis')
})

test('posiciones: el código tapado no corre las posiciones de lo que sigue', () => {
  const texto = '`@x` y\n```\n@y\n```\nluego @claude'
  const [m] = extraerMenciones(texto)
  assert.equal(extraerMenciones(texto).length, 1)
  assert.equal(texto.slice(m!.desde, m!.hasta), '@claude')
})

// ───────────────────────── Mayúsculas, acentos y alias con guion ─────────────────────────

test('mayúsculas: @CLAUDE y @ClAuDe son claude', () => {
  assert.deepEqual(alias('@CLAUDE y @ClAuDe'), ['claude', 'claude'])
})

test('acentos: se quitan al comparar (@Ñandú, @ÁNGEL, @Müller)', () => {
  assert.deepEqual(alias('@Ñandú @ÁNGEL @Müller'), ['nandu', 'angel', 'muller'])
})

test('acentos: también si vienen descompuestos (e + tilde suelta)', () => {
  assert.deepEqual(alias('@josé-luis'), ['jose-luis'])
})

test('alias con guion, guion bajo y punto en el medio', () => {
  assert.deepEqual(alias('@claude-opus, @gpt_5 y @dr.who'), ['claude-opus', 'gpt_5', 'dr.who'])
})

test('alias con números: @gpt5 y @4o', () => {
  assert.deepEqual(alias('@gpt5 y @4o'), ['gpt5', '4o'])
})

test('guion o punto pegado al final se recorta (@claude- y @claude..)', () => {
  assert.deepEqual(alias('hola @claude- y @gpt..'), ['claude', 'gpt'])
})

test('un guion bajo al final (énfasis en Markdown) se recorta', () => {
  assert.deepEqual(alias('_@claude_'), ['claude'])
})

// ───────────────────────── Puntuación pegada ─────────────────────────

test('puntuación pegada: , ; : ! ? ) ] } » " \' no entran en el alias', () => {
  for (const cierre of [',', ';', ':', '!', '?', ')', ']', '}', '»', '"', "'", '…', '”']) {
    assert.deepEqual(alias(`mirá @claude${cierre} gracias`), ['claude'], `con «${cierre}»`)
  }
})

test('puntuación pegada antes: ( [ { « ¿ ¡ " se aceptan', () => {
  for (const apertura of ['(', '[', '{', '«', '¿', '¡', '"', '“', '*', '**', '>']) {
    assert.deepEqual(alias(`${apertura}@claude`), ['claude'], `con «${apertura}»`)
  }
})

test('al final de la oración con signos juntos: «¿Lo ves, @claude?!»', () => {
  assert.deepEqual(alias('¿Lo ves, @claude?!'), ['claude'])
})

test('el punto seguido de una letra sigue siendo parte del alias (@claude.ya)', () => {
  assert.deepEqual(alias('hola @claude.ya'), ['claude.ya'])
})

test('un «@» solo, o seguido de un espacio, no es una mención', () => {
  assert.deepEqual(alias('nos vemos @ las 5, o @'), [])
  assert.deepEqual(alias('@'), [])
  assert.deepEqual(alias('@@'), [])
})

test('el «@» seguido de signos no es una mención (@!, @-, @.)', () => {
  assert.deepEqual(alias('@! @- @. @_'), [])
})

test('@@claude (doble arroba) no cuenta: ante la duda no se dispara', () => {
  assert.deepEqual(alias('@@claude'), [])
})

// ───────────────────────── Código ─────────────────────────

test('código en bloque: lo de adentro no cuenta, lo de afuera sí', () => {
  const t = '@claude mirá\n```ts\nconst a = "@gpt"\n```\ny @facundo'
  assert.deepEqual(alias(t), ['claude', 'facundo'])
})

test('código en bloque sin cerrar tapa hasta el final del texto', () => {
  assert.deepEqual(alias('@claude\n```\n@gpt\n@facundo'), ['claude'])
})

test('código en bloque con ~~~ y con más comillas que las del cierre', () => {
  assert.deepEqual(alias('~~~\n@gpt\n~~~\n@claude'), ['claude'])
  assert.deepEqual(alias('````\n```\n@gpt\n```\n````\n@claude'), ['claude'])
})

test('un bloque con indentación de hasta 3 espacios es un bloque', () => {
  assert.deepEqual(alias('  ```\n  @gpt\n  ```\n@claude'), ['claude'])
})

test('código en línea con varias comillas: ``@claude`` y ```@gpt```', () => {
  assert.deepEqual(alias('``@claude`` y ```@gpt``` y @facundo'), ['facundo'])
})

test('código en línea que contiene una comilla: `` a`@claude ``', () => {
  assert.deepEqual(alias('`` a`@claude `` y @gpt'), ['gpt'])
})

test('una comilla invertida sin pareja no tapa nada', () => {
  assert.deepEqual(alias('esto ` es raro @claude'), ['claude'])
})

test('el código en línea no cruza un párrafo', () => {
  assert.deepEqual(alias('abre ` acá\n\n@claude cierra ` allá'), ['claude'])
})

test('dos códigos en línea y una mención en el medio', () => {
  assert.deepEqual(alias('`a` @claude `b`'), ['claude'])
})

test('mención pegada a un código en línea', () => {
  assert.deepEqual(alias('`x`@claude'), ['claude'])
})

// ───────────────────────── Mails y direcciones ─────────────────────────

test('mails: ninguno cuenta, con puntos, signos y subdominios', () => {
  assert.deepEqual(alias('a@b.com, nombre.apellido@empresa.com.ar y x_y+z@sub.dominio.io'), [])
})

test('un mail y una mención en la misma línea: solo la mención', () => {
  assert.deepEqual(alias('escribile a facu@ejemplo.com, @claude'), ['claude'])
})

test('mail entre signos: <facu@ejemplo.com> y (facu@ejemplo.com)', () => {
  assert.deepEqual(alias('<facu@ejemplo.com> (facu@ejemplo.com)'), [])
})

test('direcciones: con esquema, con www, con ruta y con consulta', () => {
  assert.deepEqual(alias('https://x.com/@claude'), [])
  assert.deepEqual(alias('http://medium.com/@gpt/articulo?ref=@facundo'), [])
  assert.deepEqual(alias('www.ejemplo.com/@claude'), [])
  assert.deepEqual(alias('ftp://u:p@host.com/x'), [])
})

test('direcciones: sin esquema, el «/@» tampoco es una mención', () => {
  assert.deepEqual(alias('github.com/@claude y medium.com/@gpt'), [])
})

test('una dirección seguida de una mención con espacio: cuenta la mención', () => {
  assert.deepEqual(alias('mirá https://x.com/a y @claude'), ['claude'])
})

test('un link de Markdown: la dirección no cuenta, el texto del link sí', () => {
  assert.deepEqual(alias('[@claude](https://x.com/@gpt)'), ['claude'])
})

test('el «@» escapado con barra no es una mención', () => {
  assert.deepEqual(alias('\\@claude'), [])
})

// ───────────────────────── Varias por línea ─────────────────────────

test('varias por línea y por texto, en orden, con repetidas', () => {
  assert.deepEqual(alias('@claude @gpt @claude\n@facundo, @gpt.'), ['claude', 'gpt', 'claude', 'facundo', 'gpt'])
})

test('pegadas con coma sin espacio: @claude,@gpt', () => {
  assert.deepEqual(alias('@claude,@gpt'), ['claude', 'gpt'])
})

test('dos arrobas pegadas por el alias: @claude@gpt es una sola cosa rara, no dos menciones', () => {
  assert.deepEqual(alias('@claude@gpt'), ['claude'])
})

test('con saltos de línea de Windows (\\r\\n)', () => {
  assert.deepEqual(alias('@claude\r\n```\r\n@gpt\r\n```\r\n@facundo'), ['claude', 'facundo'])
})

test('con emoji pegado antes y después', () => {
  assert.deepEqual(alias('👉@claude✅ y 😀@gpt'), ['claude', 'gpt'])
})

test('un texto sin arrobas o vacío no devuelve nada', () => {
  assert.deepEqual(alias(''), [])
  assert.deepEqual(alias('hola mundo'), [])
})

// ───────────────────────── Normalizar y validar alias ─────────────────────────

test('normalizarAlias: minúsculas, sin acentos, espacios a guion', () => {
  assert.equal(normalizarAlias('Claude Opus'), 'claude-opus')
  assert.equal(normalizarAlias('José Luis'), 'jose-luis')
  assert.equal(normalizarAlias('  Ñandú   Pérez  '), 'nandu-perez')
  assert.equal(normalizarAlias('GPT-5.1'), 'gpt-5.1')
})

test('normalizarAlias: signos raros, guiones repetidos y puntas', () => {
  assert.equal(normalizarAlias('¡Hola, che!'), 'hola-che')
  assert.equal(normalizarAlias('--a  --  b--'), 'a-b')
  assert.equal(normalizarAlias('___uno'), 'uno')
})

test('normalizarAlias: se recorta a 32 y no queda terminando en guion', () => {
  const largo = normalizarAlias('a'.repeat(31) + ' ' + 'b'.repeat(10))
  assert.ok(largo.length <= 32)
  assert.ok(aliasValido(largo), largo)
  assert.equal(normalizarAlias('a'.repeat(40)).length, 32)
})

test('normalizarAlias: nunca devuelve un alias reservado, uno vacío ni uno de un solo carácter', () => {
  for (const nombre of ['', '   ', '!!!', 'Yo', 'IA', 'Telar', 'Todos', 'Equipo', 'X', '日本語']) {
    const a = normalizarAlias(nombre)
    assert.equal(a, 'miembro', `«${nombre}»`)
    assert.ok(aliasValido(a))
  }
})

test('normalizarAlias: lo que devuelve siempre es un alias válido', () => {
  for (const nombre of ['Claude', 'Mía', 'a', 'B2', '.-.', '@claude', 'Dr. Who', 'x'.repeat(100), '🙂 Carita']) {
    assert.ok(aliasValido(normalizarAlias(nombre)), nombre)
  }
})

test('aliasValido: largo, caracteres, comienzo, final y reservados', () => {
  for (const bueno of ['claude', 'gpt', 'gpt-5', 'a1', 'dr.who', 'x_y', 'jose-luis', 'a'.repeat(32)]) assert.ok(aliasValido(bueno), bueno)
  for (const malo of ['', 'a', 'a'.repeat(33), 'Claude', '-claude', '_claude', '.claude', 'claude-', 'claude.', 'josé', 'a b', 'a@b', ...ALIAS_RESERVADOS]) {
    assert.ok(!aliasValido(malo), malo)
  }
})

test('PATRON_ALIAS es el del plan', () => {
  assert.equal(PATRON_ALIAS.source, '^[a-z0-9][a-z0-9_.-]{1,31}$')
})

test('ALIAS_RESERVADOS: yo, todos, equipo, ia, telar', () => {
  assert.deepEqual([...ALIAS_RESERVADOS], ['yo', 'todos', 'equipo', 'ia', 'telar'])
})

// ───────────────────────── resolverExacto ─────────────────────────

test('resolverExacto: por alias, sin importar mayúsculas, acentos ni el «@»', () => {
  assert.equal(resolverExacto('claude', miembros)?.id, 'm2')
  assert.equal(resolverExacto('CLAUDE', miembros)?.id, 'm2')
  assert.equal(resolverExacto('@Claude', miembros)?.id, 'm2')
  assert.equal(resolverExacto('josé-luis', miembros)?.id, 'm4')
})

test('resolverExacto: por nombre normalizado cuando el alias no coincide', () => {
  assert.equal(resolverExacto('chatgpt', miembros)?.id, 'm3')
  assert.equal(resolverExacto('jose-luis', [{ id: 'z', alias: 'jl', nombre: 'José Luis' }])?.id, 'z')
})

test('resolverExacto: gana el alias sobre el nombre de otro', () => {
  const lista: MiembroMencionable[] = [
    { id: 'a', alias: 'ana', nombre: 'Claude' },
    { id: 'b', alias: 'claude', nombre: 'Bruno' },
  ]
  assert.equal(resolverExacto('claude', lista)?.id, 'b')
})

test('resolverExacto: no usa prefijos (cl, clau, claud no dan Claude)', () => {
  for (const parcial of ['cl', 'clau', 'claud', 'claude-', 'gp']) assert.equal(resolverExacto(parcial, miembros), null, parcial)
})

test('resolverExacto: el nombre de dos palabras no resuelve por una sola', () => {
  assert.equal(resolverExacto('luis', miembros), null)
  assert.equal(resolverExacto('opus', miembros), null)
  assert.equal(resolverExacto('claude-opus', miembros)?.id, 'm5')
})

test('resolverExacto: nunca un miembro archivado, ni por alias ni por nombre', () => {
  assert.equal(resolverExacto('viejo', miembros), null)
  assert.equal(resolverExacto('agente-viejo', miembros), null)
})

test('resolverExacto: los reservados no resuelven, aunque un miembro se llame así', () => {
  const lista: MiembroMencionable[] = [{ id: 'y', alias: 'yo', nombre: 'Yo' }, { id: 'i', alias: 'x1', nombre: 'IA' }]
  for (const r of ALIAS_RESERVADOS) assert.equal(resolverExacto(r, lista), null, r)
})

test('resolverExacto: ante dos coincidencias iguales no dispara a ninguno', () => {
  const lista: MiembroMencionable[] = [
    { id: 'a', alias: 'a1', nombre: 'Claude' },
    { id: 'b', alias: 'b1', nombre: 'Cláude' },
  ]
  assert.equal(resolverExacto('claude', lista), null)
})

test('resolverExacto: vacío, sin miembros y sin coincidencias dan null', () => {
  assert.equal(resolverExacto('', miembros), null)
  assert.equal(resolverExacto('@', miembros), null)
  assert.equal(resolverExacto('claude', []), null)
  assert.equal(resolverExacto('nadie', miembros), null)
})

test('de punta a punta: extraer y resolver un comentario', () => {
  const texto = 'Che @Claude, ¿podés revisar esto? cc @josé-luis y mail a x@y.com. `@gpt` no.'
  const ids = extraerMenciones(texto).map((m) => resolverExacto(m.alias, miembros)?.id)
  assert.deepEqual(ids, ['m2', 'm4'])
})

// ───────────────────────── sugerir ─────────────────────────

test('sugerir: prefijo del alias, mejor coincidencia primero', () => {
  assert.deepEqual(sugerir('cl', miembros).map((m) => m.id), ['m2', 'm5'])
  assert.deepEqual(sugerir('claude', miembros).map((m) => m.id), ['m2', 'm5'])
  assert.deepEqual(sugerir('claude-', miembros).map((m) => m.id), ['m5'])
})

test('sugerir: también por el nombre y por una palabra del nombre; sin acentos ni mayúsculas', () => {
  assert.deepEqual(sugerir('chat', miembros).map((m) => m.id), ['m3'])
  assert.deepEqual(sugerir('LUIS', miembros).map((m) => m.id), ['m4'])
  assert.deepEqual(sugerir('jos', miembros).map((m) => m.id), ['m4'])
  assert.deepEqual(sugerir('OPU', miembros).map((m) => m.id), ['m5'])
})

test('sugerir: acepta el «@» adelante', () => {
  assert.deepEqual(sugerir('@gp', miembros).map((m) => m.id), ['m3'])
})

test('sugerir: sin parcial devuelve a todos menos los archivados, por orden alfabético', () => {
  assert.deepEqual(sugerir('', miembros, 10).map((m) => m.id), ['m3', 'm2', 'm5', 'm1', 'm4'])
})

test('sugerir: nunca un archivado, respeta el límite y no inventa', () => {
  assert.deepEqual(sugerir('viejo', miembros), [])
  assert.deepEqual(sugerir('agente', miembros), [])
  assert.equal(sugerir('', miembros, 2).length, 2)
  assert.deepEqual(sugerir('', miembros, 0), [])
  assert.deepEqual(sugerir('zzz', miembros), [])
})

test('sugerir: el alias exacto va antes que los que solo empiezan igual', () => {
  const lista: MiembroMencionable[] = [
    { id: 'a', alias: 'claude-opus', nombre: 'Opus' },
    { id: 'b', alias: 'claude', nombre: 'Otro' },
  ]
  assert.equal(sugerir('claude', lista)[0]!.id, 'b')
})
