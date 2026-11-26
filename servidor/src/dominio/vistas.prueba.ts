// Prueba de las vistas de un tablero (`npm run vistas:probar`, PGlite en memoria, sin red): cada tablero tiene un subconjunto de Kanban,
// Lienzo y Diseño (al menos una) y no se crea nada de más.
//   · el modelo de `compartido/vistas.ts`: lo que no se entiende vale las tres, sin repetidos y en orden,
//   · los tableros de antes (sin el ajuste, creados con SQL como los de la base de siempre) tienen las tres vistas,
//   · crear de cada tipo: «tablero» trae sus listas, «diagrama» y «diseno» no traen ninguna, «diseno» no crea nada de Diseño,
//   · vistas inválidas, vacías, el tipo y las vistas a la vez, listas en un tablero sin Kanban: errores que enseñan,
//   · sacar y devolver una vista no borra nada (tarjetas, objetos del lienzo), sumar Kanban a un diagrama le da sus listas una vez,
//   · no se puede dejar un tablero sin vistas, `ajustes.vistas` no entra por los ajustes, un proyecto nuevo trae un solo tablero,
//   · una cuenta no cambia las vistas del tablero de otra (404) y el evento en vivo y la actividad lo cuentan,
//   · MCP: crear_tablero (tipo y vistas, por defecto «tablero»), actualizar_tablero, leer_tablero, listar_tableros y leer_proyecto traen
//     las vistas; las herramientas de una vista que el tablero no tiene responden con el error que dice cómo sumarla.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { Actor } from '../../../compartido/tipos'
import {
  frasePorVistas,
  leerVistas,
  mensajeSinVista,
  ordenarVistas,
  problemaEnVistas,
  tieneVista,
  tipoDeVistas,
  vistaInicial,
  VISTAS,
  VISTAS_DEL_TIPO,
} from '../../../compartido/vistas'
import { crearEntorno, type Entorno } from '../ia/prueba-base'
import { buscarHerramienta } from '../mcp/herramientas'
import { ErrorDominio } from './servicio'

let e: Entorno
before(async () => {
  e = await crearEntorno()
})
after(async () => e.cerrar())

const ia: Actor = { tipo: 'ia', id: 'ia', nombre: 'Claude' }
/** Llama a una herramienta del MCP como lo hace un cliente (con el esquema que la valida). */
const mcp = async (nombre: string, args: Record<string, unknown>, s = e.s): Promise<any> => {
  const h = buscarHerramienta(nombre)!
  return h.ejecutar(s, ia, h.esquema.parse(args))
}
const falla = async (fn: () => Promise<unknown>, patron: RegExp) => assert.rejects(fn, (err: Error) => (patron.test(err.message) ? true : assert.fail(`el error decía: ${err.message}`)))
const cuenta = async (sql: string, ...p: unknown[]) => Number((await e.db.consulta<{ n: number }>(sql, p))[0]!.n)
const listasDe = (tableroId: string) => cuenta(`select count(*)::int as n from listas where tablero_id = $1`, tableroId)
const objetosDe = (tableroId: string) => cuenta(`select count(*)::int as n from elementos_lienzo where tablero_id = $1`, tableroId)

test('el modelo: sin ajuste o con basura valen las tres, en orden y sin repetidos', () => {
  assert.deepEqual(leerVistas(undefined), VISTAS)
  assert.deepEqual(leerVistas({}), VISTAS)
  assert.deepEqual(leerVistas({ vistas: [] }), VISTAS, 'una lista vacía no deja un tablero sin vistas')
  assert.deepEqual(leerVistas({ vistas: ['nada'] as any }), VISTAS)
  assert.deepEqual(leerVistas({ vistas: 'lienzo' as any }), VISTAS)
  assert.deepEqual(leerVistas({ vistas: ['lienzo', 'kanban', 'lienzo', 'raro'] as any }), ['kanban', 'lienzo'])
  assert.deepEqual(ordenarVistas(['diseno', 'kanban']), ['kanban', 'diseno'])
  assert.equal(problemaEnVistas([]), 'Un tablero necesita al menos una vista. Elegí entre: kanban, lienzo, diseno.')
  assert.match(problemaEnVistas(['kanban', 'mapa'])!, /Vista desconocida: «mapa»/)
  assert.equal(problemaEnVistas(['lienzo']), null)
  assert.equal(tipoDeVistas(['lienzo']), 'diagrama')
  assert.equal(tipoDeVistas(['kanban']), 'tablero')
  assert.equal(tipoDeVistas(['diseno']), 'diseno')
  assert.equal(tipoDeVistas(['kanban', 'lienzo']), 'completo')
  assert.equal(vistaInicial(['diseno', 'lienzo']), 'lienzo')
  assert.equal(tieneVista({ vistas: ['lienzo'] }, 'kanban'), false)
  assert.equal(tieneVista(undefined, 'kanban'), true)
  assert.equal(frasePorVistas(['kanban', 'lienzo', 'diseno']), 'Kanban, Lienzo y Diseño')
  assert.match(mensajeSinVista('Mapa', 'kanban', ['lienzo']), /no tiene la vista Kanban \(tiene: Lienzo\).*actualizar_tablero \{ "tablero": "Mapa", "vistas": \["kanban","lienzo"\] \}/)
})

test('los tableros que ya existían quedan con las tres vistas (sin el ajuste guardado), y no cambia nada de lo de hoy', async () => {
  // Como una base de antes de esta función: la fila no sabe nada de las vistas.
  await e.db.consulta(
    `insert into tableros (id, proyecto_id, nombre, slug, descripcion, orden) values ('t_viejo', $1, 'Viejo', 'viejo', '', 'a1')`,
    [e.proyecto.id],
  )
  await e.db.consulta(`insert into listas (id, tablero_id, nombre, orden, categoria) values ('l_viejo', 't_viejo', 'Por hacer', 'a0', 'por_hacer')`)
  const p = (await e.s.listarProyectos()).find((x) => x.id === e.proyecto.id)!
  const viejo = p.tableros.find((t) => t.id === 't_viejo')!
  assert.deepEqual(viejo.vistas, VISTAS)
  assert.deepEqual(viejo.ajustes, {}, 'no se tocó nada de la fila')
  assert.deepEqual(p.tableros.find((t) => t.id === e.tableroId)!.vistas, VISTAS, 'el del entorno es «completo»')
  const completo = await e.s.leerTableroCompleto('t_viejo')
  assert.deepEqual(completo.tablero.vistas, VISTAS)
  // Lo de siempre sigue andando: tarjeta en su lista, objeto en su lienzo, por MCP también.
  await e.s.crearTarjeta(e.persona, { tableroId: 't_viejo', titulo: 'En el viejo', listaId: 'l_viejo' })
  const r = await mcp('agregar_al_lienzo', { tablero: 'Viejo', proyecto: 'PR', tipo: 'nota', texto: 'Sigue andando' })
  assert.equal(r.ok, true)
  const ver = await mcp('leer_tablero', { tablero: 'Viejo', proyecto: 'PR' })
  assert.deepEqual(ver.tablero.vistas, VISTAS)
  assert.equal(ver.listas[0].tarjetas.length, 1)
})

test('crear un tablero de cada tipo: solo lo suyo, y nada de más', async () => {
  const diseniosAntes = await cuenta(`select count(*)::int as n from diseno_paginas where proyecto_id = $1`, e.proyecto.id)
  const t = await e.s.crearTablero(e.persona, { proyectoId: e.proyecto.id, nombre: 'Solo Kanban', tipo: 'tablero' })
  assert.deepEqual(t.vistas, ['kanban'])
  assert.equal(await listasDe(t.id), 3, 'trae Por hacer, En curso y Hecho')
  assert.equal(await objetosDe(t.id), 0)

  const d = await e.s.crearTablero(e.persona, { proyectoId: e.proyecto.id, nombre: 'Solo diagrama', tipo: 'diagrama' })
  assert.deepEqual(d.vistas, ['lienzo'])
  assert.equal(await listasDe(d.id), 0, 'un diagrama no crea listas del Kanban')
  assert.equal(await objetosDe(d.id), 0, 'ni nada en el lienzo')

  const s = await e.s.crearTablero(e.persona, { proyectoId: e.proyecto.id, nombre: 'Solo diseño', tipo: 'diseno' })
  assert.deepEqual(s.vistas, ['diseno'])
  assert.equal(await listasDe(s.id), 0, 'un tablero de Diseño no crea listas')
  assert.equal(await objetosDe(s.id), 0, 'ni lienzo')
  assert.equal(await cuenta(`select count(*)::int as n from diseno_paginas where proyecto_id = $1`, e.proyecto.id), diseniosAntes, 'ni un sistema de diseño nuevo: Diseño es del proyecto')

  const c = await e.s.crearTablero(e.persona, { proyectoId: e.proyecto.id, nombre: 'Completo', tipo: 'completo' })
  assert.deepEqual(c.vistas, VISTAS)
  assert.equal(await listasDe(c.id), 3)

  const dos = await e.s.crearTablero(e.persona, { proyectoId: e.proyecto.id, nombre: 'Kanban y lienzo', vistas: ['lienzo', 'kanban'] })
  assert.deepEqual(dos.vistas, ['kanban', 'lienzo'], 'las vistas se ordenan')
  assert.equal(await listasDe(dos.id), 3)

  // De fábrica, «tablero»: solo Kanban.
  const f = await e.s.crearTablero(e.persona, { proyectoId: e.proyecto.id, nombre: 'Sin decir nada' })
  assert.deepEqual(f.vistas, ['kanban'])
  const conListas = await e.s.crearTablero(e.persona, { proyectoId: e.proyecto.id, nombre: 'Con mis listas', listas: [{ nombre: 'Ideas', categoria: null }] })
  assert.equal(await listasDe(conListas.id), 1)

  // Lo guardado es lo que se lee de vuelta.
  const p = (await e.s.listarProyectos()).find((x) => x.id === e.proyecto.id)!
  assert.deepEqual(p.tableros.find((x) => x.id === d.id)!.vistas, ['lienzo'])
})

test('lo que se rechaza: vistas inválidas o vacías, tipo y vistas a la vez, listas en un tablero sin Kanban', async () => {
  const base = { proyectoId: e.proyecto.id }
  await falla(() => e.s.crearTablero(e.persona, { ...base, nombre: 'X', vistas: [] }), /al menos una vista/)
  await falla(() => e.s.crearTablero(e.persona, { ...base, nombre: 'X', vistas: ['mapa' as any] }), /Vista desconocida: «mapa»/)
  await falla(() => e.s.crearTablero(e.persona, { ...base, nombre: 'X', tipo: 'raro' as any }), /Tipo de tablero desconocido/)
  await falla(() => e.s.crearTablero(e.persona, { ...base, nombre: 'X', tipo: 'diagrama', vistas: ['kanban'] }), /`vistas` o `tipo`, no los dos/)
  await falla(
    () => e.s.crearTablero(e.persona, { ...base, nombre: 'X', tipo: 'diagrama', listas: [{ nombre: 'Ideas', categoria: null }] }),
    /no lleva listas/,
  )
  assert.equal(await cuenta(`select count(*)::int as n from tableros where nombre = 'X'`), 0, 'no quedó nada a medias')
  // Mandar tipo y las vistas que ese tipo ya implica no es un conflicto.
  const ok = await e.s.crearTablero(e.persona, { ...base, nombre: 'Redundante', tipo: 'diagrama', vistas: ['lienzo'] })
  assert.deepEqual(ok.vistas, ['lienzo'])
})

test('sacar una vista no borra nada y se recupera al sumarla; no se puede dejar un tablero sin vistas', async () => {
  const t = await e.s.crearTablero(e.persona, { proyectoId: e.proyecto.id, nombre: 'Para cambiar', tipo: 'completo' })
  const tarjeta = await e.s.crearTarjeta(e.persona, { tableroId: t.id, titulo: 'Una tarjeta' })
  const nota = await e.s.agregarAlLienzo(e.persona, t.id, { tipo: 'nota', texto: 'Una nota' })
  e.eventos.length = 0

  const sinKanban = await e.s.actualizarTablero(e.persona, t.id, { vistas: ['lienzo', 'diseno'] })
  assert.deepEqual(sinKanban.vistas, ['lienzo', 'diseno'])
  assert.equal(await cuenta(`select count(*)::int as n from tarjetas where tablero_id = $1`, t.id), 1, 'la tarjeta sigue guardada')
  assert.equal(await listasDe(t.id), 3, 'y las listas')
  const ev = e.eventos.find((x) => x.tipo === 'tablero' && x.accion === 'actualizado')!
  assert.deepEqual((ev.datos as any).vistas, ['lienzo', 'diseno'], 'el evento en vivo trae las vistas')
  const act = await e.db.consulta<{ resumen: string }>(`select resumen from actividad where tablero_id = $1 and accion = 'tablero.actualizado' order by creado_en desc limit 1`, [t.id])
  assert.match(act[0]!.resumen, /cambió las vistas del tablero «Para cambiar»: ahora tiene Lienzo y Diseño/)

  const soloDiseno = await e.s.actualizarTablero(e.persona, t.id, { vistas: ['diseno'] })
  assert.deepEqual(soloDiseno.vistas, ['diseno'])
  assert.equal(await objetosDe(t.id), 1, 'el lienzo no se borró')
  assert.equal((await e.s.elementosDe(t.id))[0]!.id, nota.id)

  // Vuelven con todo lo que tenían (sin crear listas nuevas: ya las tenía).
  const todo = await e.s.actualizarTablero(e.persona, t.id, { vistas: ['diseno', 'kanban', 'lienzo'] })
  assert.deepEqual(todo.vistas, VISTAS)
  assert.equal(await listasDe(t.id), 3)
  assert.equal(await objetosDe(t.id), 1)
  assert.equal((await e.s.leerTableroCompleto(t.id)).tarjetas[0]!.id, tarjeta.id)

  await falla(() => e.s.actualizarTablero(e.persona, t.id, { vistas: [] }), /al menos una vista/)
  await falla(() => e.s.actualizarTablero(e.persona, t.id, { vistas: ['otra' as any] }), /Vista desconocida/)
  assert.deepEqual((await e.s.leerTableroCompleto(t.id)).tablero.vistas, VISTAS, 'lo rechazado no cambió nada')

  // Repetir lo mismo no anota actividad nueva.
  const antes = await cuenta(`select count(*)::int as n from actividad where tablero_id = $1`, t.id)
  await e.s.actualizarTablero(e.persona, t.id, { vistas: VISTAS as never })
  assert.equal(await cuenta(`select count(*)::int as n from actividad where tablero_id = $1`, t.id), antes)
})

test('sumarle Kanban a un diagrama le da sus listas (una sola vez); `ajustes.vistas` no entra por los ajustes', async () => {
  const d = await e.s.crearTablero(e.persona, { proyectoId: e.proyecto.id, nombre: 'Diagrama que crece', tipo: 'diagrama' })
  assert.equal(await listasDe(d.id), 0)
  const dos = await e.s.actualizarTablero(e.persona, d.id, { vistas: ['kanban', 'lienzo'] })
  assert.deepEqual(dos.vistas, ['kanban', 'lienzo'])
  assert.equal(await listasDe(d.id), 3, 'arranca con Por hacer, En curso y Hecho')
  await e.s.actualizarTablero(e.persona, d.id, { vistas: ['lienzo'] })
  await e.s.actualizarTablero(e.persona, d.id, { vistas: ['kanban', 'lienzo'] })
  assert.equal(await listasDe(d.id), 3, 'volver a sumarlo no duplica las listas')

  const intento = await e.s.actualizarTablero(e.persona, d.id, { ajustes: { vistas: ['diseno'], lienzo: { fondo: 'liso' } } as never })
  assert.deepEqual(intento.vistas, ['kanban', 'lienzo'], 'las vistas se cambian con `vistas`, no con los ajustes')
  assert.equal(intento.ajustes.lienzo?.fondo, 'liso', 'el resto de los ajustes sí entra')
  // Cambiar solo un ajuste no toca las vistas.
  const f = await e.s.actualizarTablero(e.persona, d.id, { ajustes: { lienzo: { grilla: 48 } } })
  assert.deepEqual(f.vistas, ['kanban', 'lienzo'])
})

test('un proyecto nuevo trae un solo tablero, del tipo que se elige (de fábrica «tablero»)', async () => {
  const a = await e.s.crearProyecto(e.persona, { nombre: 'Uno', prefijo: 'UNO' })
  assert.equal(a.tableros.length, 1)
  assert.equal(a.tableros[0]!.nombre, 'Pendientes')
  assert.deepEqual(a.tableros[0]!.vistas, ['kanban'])
  assert.equal(await listasDe(a.tableros[0]!.id), 4, 'Bandeja, Por hacer, En curso y Hecho')

  const b = await e.s.crearProyecto(e.persona, { nombre: 'Dos', prefijo: 'DOS', tipo: 'diagrama' })
  assert.equal(b.tableros[0]!.nombre, 'Diagrama')
  assert.deepEqual(b.tableros[0]!.vistas, ['lienzo'])
  assert.equal(await listasDe(b.tableros[0]!.id), 0)

  const c = await e.s.crearProyecto(e.persona, { nombre: 'Tres', prefijo: 'TRES', tipo: 'diseno' })
  assert.deepEqual(c.tableros[0]!.vistas, ['diseno'])
  assert.equal(await cuenta(`select count(*)::int as n from diseno_paginas where proyecto_id = $1`, c.id), 0, 'Diseño se crea cuando se abre, no antes')
  await falla(() => e.s.crearProyecto(e.persona, { nombre: 'Cuatro', prefijo: 'CUA', tipo: 'raro' as any }), /Tipo de tablero desconocido/)
})

test('una cuenta no cambia las vistas del tablero de otra: 404 como si no existiera', async () => {
  const otra = e.raiz.de('otra')
  const t = await e.s.crearTablero(e.persona, { proyectoId: e.proyecto.id, nombre: 'De la cuenta uno', tipo: 'tablero' })
  await falla(() => otra.actualizarTablero({ actor: ia }, t.id, { vistas: ['lienzo'] }), /No existe ese tablero/)
  await falla(() => otra.crearTablero({ actor: ia }, { proyectoId: e.proyecto.id, nombre: 'Intruso', tipo: 'diagrama' }), /No existe/)
  assert.deepEqual((await e.s.leerTableroCompleto(t.id)).tablero.vistas, ['kanban'])
})

test('MCP: crear_tablero (tipo y vistas, de fábrica «tablero») y lo que devuelven las herramientas de lectura', async () => {
  const sinTipo = await mcp('crear_tablero', { proyecto: 'PR', nombre: 'MCP sin tipo' })
  assert.deepEqual(sinTipo.tablero.vistas, ['kanban'])
  assert.equal(sinTipo.tablero.tipo, 'tablero')
  assert.equal(sinTipo.lienzo, undefined, 'sin lienzo no hay link al lienzo')

  const d = await mcp('crear_tablero', { proyecto: 'PR', nombre: 'MCP diagrama', tipo: 'diagrama' })
  assert.deepEqual(d.tablero.vistas, ['lienzo'])
  assert.equal(d.tablero.tipo, 'diagrama')
  assert.match(d.mensaje, /Diagrama: Lienzo/)
  assert.match(d.tablero.url, /\/PR\/mcp-diagrama\/lienzo$/, 'el link entra directo a la vista que tiene')
  assert.match(d.lienzo, /\/lienzo$/)
  assert.equal(d.tablero.abiertas, undefined, 'las tarjetas abiertas son del Kanban')
  const v = await mcp('crear_tablero', { proyecto: 'PR', nombre: 'MCP vistas', vistas: ['lienzo', 'diseno'] })
  assert.deepEqual(v.tablero.vistas, ['lienzo', 'diseno'])
  const s = await mcp('crear_tablero', { proyecto: 'PR', nombre: 'MCP diseño', tipo: 'diseno' })
  assert.match(s.tablero.url, /\/diseno$/)

  await falla(() => mcp('crear_tablero', { proyecto: 'PR', nombre: 'Mal', tipo: 'diagrama', vistas: ['lienzo'] }), /`tipo` o `vistas`, no los dos/)
  await falla(() => mcp('crear_tablero', { proyecto: 'PR', nombre: 'Mal', tipo: 'diagrama', listas: ['Ideas'] }), /no lleva listas/)
  assert.throws(() => buscarHerramienta('crear_tablero')!.esquema.parse({ proyecto: 'PR', nombre: 'Mal', tipo: 'mapa' }), /tablero, diagrama, diseno, completo/)
  assert.throws(() => buscarHerramienta('crear_tablero')!.esquema.parse({ proyecto: 'PR', nombre: 'Mal', vistas: [] }), /al menos 1 elemento/)
  assert.throws(() => buscarHerramienta('crear_tablero')!.esquema.parse({ proyecto: 'PR', nombre: 'Mal', vistas: ['mapa'] }), /kanban, lienzo, diseno/)

  const lt = await mcp('listar_tableros', { proyecto: 'PR' })
  const delDiagrama = lt.tableros.find((t: any) => t.nombre === 'MCP diagrama')
  assert.deepEqual(delDiagrama.vistas, ['lienzo'])
  assert.equal(delDiagrama.listas, undefined)
  assert.ok(delDiagrama.lienzo, 'trae los ajustes de su lienzo')
  const delKanban = lt.tableros.find((t: any) => t.nombre === 'MCP sin tipo')
  assert.deepEqual(delKanban.listas, ['Por hacer', 'En curso', 'Hecho'])
  assert.equal(delKanban.lienzo, undefined)
  const lp = await mcp('leer_proyecto', { proyecto: 'PR' })
  assert.deepEqual(lp.tableros.find((t: any) => t.nombre === 'MCP diagrama').vistas, ['lienzo'])
  assert.equal(lp.tableros.find((t: any) => t.nombre === 'MCP diagrama').listas, undefined)
  const pr = await mcp('listar_proyectos', {})
  assert.deepEqual(pr.proyectos.find((p: any) => p.prefijo === 'PR').tableros.find((t: any) => t.nombre === 'MCP diagrama').vistas, ['lienzo'])

  // leer_tablero de un diagrama no falla: dice qué tiene y trae el resumen del lienzo (sin listas).
  const lec = await mcp('leer_tablero', { proyecto: 'PR', tablero: 'MCP diagrama' })
  assert.deepEqual(lec.tablero.vistas, ['lienzo'])
  assert.equal(lec.listas, undefined)
  assert.ok(lec.lienzo)
  assert.match(lec.aviso, /no tiene Kanban/)
  await falla(() => mcp('leer_tablero', { proyecto: 'PR', tablero: 'MCP diagrama', lista: 'Por hacer' }), /no tiene la vista Kanban/)
})

test('MCP: lo que opera una vista que el tablero no tiene responde con el error que dice cómo sumarla', async () => {
  // Kanban sin lienzo: el lienzo, las tablas y los gráficos no aplican.
  for (const [h, args] of [
    ['leer_lienzo', {}],
    ['agregar_al_lienzo', { tipo: 'nota', texto: 'hola' }],
    ['armar_en_lienzo', { objetos: [{ tipo: 'nota', texto: 'hola' }] }],
    ['crear_tabla', { titulo: 'T', columnas: [{ nombre: 'A' }] }],
  ] as const)
    await falla(() => mcp(h, { tablero: 'MCP sin tipo', proyecto: 'PR', ...args }), /no tiene la vista Lienzo \(tiene: Kanban\).*actualizar_tablero \{ "tablero": "MCP sin tipo", "vistas": \["kanban","lienzo"\] \}/)
  // Diagrama sin Kanban: tarjetas y listas no aplican.
  await falla(() => mcp('crear_tarjeta', { titulo: 'x', tablero: 'MCP diagrama', proyecto: 'PR' }), /no tiene la vista Kanban \(tiene: Lienzo\).*"vistas": \["kanban","lienzo"\]/)
  await falla(() => mcp('crear_lista', { nombre: 'x', tablero: 'MCP diagrama', proyecto: 'PR' }), /no tiene la vista Kanban/)
  // Sin nombre de tablero, toma el primero del proyecto que tenga la vista; si ninguno la tiene, dice cómo crear uno.
  const solo = await e.s.crearProyecto(e.persona, { nombre: 'Solo diagramas', prefijo: 'SD', tipo: 'diagrama' })
  await falla(() => mcp('crear_tarjeta', { titulo: 'x', proyecto: 'SD' }), /Ningún tablero de SD tiene la vista Kanban.*crear_tablero.*actualizar_tablero/)
  assert.equal(solo.tableros.length, 1)
  const nota = await mcp('agregar_al_lienzo', { proyecto: 'SD', tipo: 'nota', texto: 'Va al primero con lienzo' })
  assert.equal(nota.ok, true)
  // Y en el proyecto que tiene uno de cada uno, elige el que corresponde.
  await mcp('crear_tablero', { proyecto: 'SD', nombre: 'El kanban', tipo: 'tablero' })
  const t = await mcp('crear_tarjeta', { titulo: 'En el Kanban que hay', proyecto: 'SD' })
  assert.equal(t.ok, true)
  assert.match(t.tarjeta.lista, /Por hacer/)

  // Sumar la vista lo arregla, con el mismo texto que dio el error.
  const antes = await mcp('actualizar_tablero', { tablero: 'MCP sin tipo', proyecto: 'PR', vistas: ['kanban', 'lienzo'] })
  assert.deepEqual(antes.tablero.vistas, ['kanban', 'lienzo'])
  assert.match(antes.mensaje, /ahora tiene Kanban y Lienzo/)
  const n = await mcp('agregar_al_lienzo', { tablero: 'MCP sin tipo', proyecto: 'PR', tipo: 'nota', texto: 'Ahora sí' })
  assert.equal(n.ok, true)

  // Cambiar el fondo del lienzo o el archivo de Hecho de un tablero que no tiene esa vista también dice cómo sumarla.
  await falla(() => mcp('actualizar_tablero', { tablero: 'MCP diagrama', proyecto: 'PR', archivo_hecho_dias: 7 }), /no tiene la vista Kanban/)
  await falla(() => mcp('actualizar_tablero', { tablero: 'MCP vistas', proyecto: 'PR', fondo: 'liso', vistas: ['kanban'] }), /no tiene la vista Lienzo/)
  const dos = await mcp('actualizar_tablero', { tablero: 'MCP diagrama', proyecto: 'PR', vistas: ['kanban', 'lienzo'], archivo_hecho_dias: 7 })
  assert.equal(dos.tablero.archivo_hecho_dias, 7, 'pedir la vista y el ajuste en la misma llamada anda')
  await falla(() => mcp('actualizar_tablero', { tablero: 'MCP diagrama', proyecto: 'PR', vistas: [] }), /al menos 1 elemento/)
})

test('los tipos y sus vistas son los de la decisión de producto', () => {
  assert.deepEqual(VISTAS_DEL_TIPO.tablero, ['kanban'])
  assert.deepEqual(VISTAS_DEL_TIPO.diagrama, ['lienzo'])
  assert.deepEqual(VISTAS_DEL_TIPO.diseno, ['diseno'])
  assert.deepEqual(VISTAS_DEL_TIPO.completo, ['kanban', 'lienzo', 'diseno'])
  assert.ok(new ErrorDominio('x') instanceof Error)
})
