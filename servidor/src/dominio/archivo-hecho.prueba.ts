// Prueba del archivo automático de las listas de «Hecho» y de lo que lo rodea (`npm run hecho:probar`, PGlite en memoria, sin red):
//   · archiva solo lo viejo y solo en listas de categoría «hecho» (con fechas simuladas: se manda `ahora` y se retrocede `completada_en`),
//   · respeta una checklist sin terminar y un vínculo «bloquea» contra una tarjeta que sigue abierta,
//   · «nunca», 7, 14, 30 (de fábrica, también sin ajustes guardados) y 60 días,
//   · es por cuenta: la cuenta B no archiva nada de A (ni con el id de su tablero: 404),
//   · repetirlo no duplica nada (ni actividad ni avisos) y respeta el tope de una vez por hora por tablero,
//   · la actividad lleva a «Telar» como actor, aparecen en Archivadas y se restauran con un toque (y no se vuelven a archivar),
//   · llegar a Hecho deja la tarjeta arriba, abrir el tablero lo corre solo y, sin la migración, abrir el tablero sigue andando,
//   · leer_tablero del MCP trae las 20 más recientes de Hecho, `ocultas` y la página que se pide.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PAGINA_HECHO, leerDiasArchivoHecho } from '../../../compartido/hecho'
import type { Actor } from '../../../compartido/tipos'
import { iaDe } from '../ia/servicio-ia'
import { crearEntorno, type Entorno } from '../ia/prueba-base'
import { buscarHerramienta } from '../mcp/herramientas'
import { ACTOR_TELAR, type Ctx } from './servicio'

let e: Entorno
before(async () => {
  e = await crearEntorno()
  // Lo mismo que hace `conectarIA` para el aviso de la campana.
  e.raiz.ganchos.avisoDeTelar = async (s, a) => {
    await iaDe(s).avisarAlYo(a)
  }
})
after(async () => e.cerrar())

const DIA = 86_400_000
const hace = (dias: number) => new Date(Date.now() - dias * DIA).toISOString()

/** Una tarjeta en la lista pedida, con su fecha de «llegó a Hecho» retrocedida. */
async function tarjeta(titulo: string, lista: string, dias: number | null, tableroId = e.tableroId, listas = e.listas, s = e.s, ctx: Ctx = e.persona) {
  const t = await s.crearTarjeta(ctx, { tableroId, titulo, listaId: listas[lista] })
  await e.db.consulta(`update tarjetas set completada_en = $2, actualizada_en = coalesce($2, actualizada_en) where id = $1`, [t.id, dias === null ? null : hace(dias)])
  return t
}
const archivada = async (id: string) => (await e.db.consulta<{ archivada: boolean }>(`select archivada from tarjetas where id = $1`, [id]))[0]!.archivada
const dejarSinTurno = () => e.db.consulta(`update tableros set archivo_hecho_en = null`)
const actividades = async (accion = 'tablero.archivo_hecho') => e.db.consulta<{ actor: Actor; resumen: string; detalle: any; tablero_id: string }>(`select actor, resumen, detalle, tablero_id from actividad where accion = $1 order by creado_en, id`, [accion])
const avisos = async () => e.db.consulta<{ tipo: string; titulo: string; cuerpo: string; clave_unica: string }>(`select tipo, titulo, cuerpo, clave_unica from notificaciones where tipo = 'aviso' order by creado_en`)

test('los días de la opción: sin nada guardado son 30, y «nunca» es null', () => {
  assert.equal(leerDiasArchivoHecho(undefined), 30)
  assert.equal(leerDiasArchivoHecho({}), 30)
  assert.equal(leerDiasArchivoHecho({ archivoHecho: { dias: null } }), null)
  assert.equal(leerDiasArchivoHecho({ archivoHecho: { dias: 7 } }), 7)
  assert.equal(leerDiasArchivoHecho({ archivoHecho: { dias: 5 as any } }), 30, 'un valor raro vuelve al de fábrica')
})

test('archiva solo lo viejo y solo en Hecho; firma «Telar»; avisa una vez; repetirlo no duplica nada', async () => {
  const vieja = await tarjeta('Vieja en Hecho', 'Hecho', 40)
  const justa = await tarjeta('Hace 31 días', 'Hecho', 31)
  const reciente = await tarjeta('Reciente en Hecho', 'Hecho', 5)
  const viejaEnCurso = await tarjeta('Vieja pero en curso', 'En curso', 100)
  const viejaPorHacer = await tarjeta('Vieja pero por hacer', 'Por hacer', 100)
  const viejaBandeja = await tarjeta('Vieja en la bandeja', 'Bandeja', 100)
  const sinFecha = await tarjeta('Sin fecha de completada', 'Hecho', null)
  await e.db.consulta(`update tarjetas set actualizada_en = $2 where id = $1`, [sinFecha.id, hace(50)])

  const r = await e.s.archivarHechasViejas()
  assert.equal(r.tableros, 1)
  assert.equal(r.archivadas, 3, 'la vieja, la de 31 días y la que no tiene fecha pero hace 50 días que nadie la toca')
  assert.deepEqual(r.porTablero[0]!.claves.sort(), [vieja.clave, justa.clave, sinFecha.clave].sort())
  assert.equal(await archivada(vieja.id), true)
  assert.equal(await archivada(justa.id), true)
  assert.equal(await archivada(sinFecha.id), true)
  for (const t of [reciente, viejaEnCurso, viejaPorHacer, viejaBandeja]) assert.equal(await archivada(t.id), false, `${t.titulo} no se archiva`)

  // La actividad, firmada «Telar», con lo que pasó; y aparecen en Archivadas (se restauran con un toque).
  const act = await actividades()
  assert.equal(act.length, 1)
  assert.deepEqual(act[0]!.actor, ACTOR_TELAR)
  assert.equal(act[0]!.actor.nombre, 'Telar')
  assert.match(act[0]!.resumen, /^archivó 3 tarjetas de Hecho de hace más de 30 días$/)
  assert.deepEqual(act[0]!.detalle.claves.sort(), [vieja.clave, justa.clave, sinFecha.clave].sort())
  const enArchivadas = (await e.s.listarArchivadas(e.tableroId)).map((t) => t.clave)
  for (const t of [vieja, justa, sinFecha]) assert.ok(enArchivadas.includes(t.clave))

  // Un aviso en la campana, con el texto pedido.
  const a1 = await avisos()
  assert.equal(a1.length, 1)
  assert.equal(a1[0]!.titulo, 'Telar archivó 3 tarjetas de Hecho de hace más de 30 días')
  assert.match(a1[0]!.cuerpo, /Están en Archivadas y se restauran con un toque/)

  // Repetirlo (con y sin esperar la hora) no duplica actividad ni avisos ni archiva de más.
  const otra = await e.s.archivarHechasViejas()
  assert.equal(otra.tableros, 0, 'dentro de la hora, el tablero ya corrió: no se mira de nuevo')
  const forzada = await e.s.archivarHechasViejas({ tableroId: e.tableroId, forzar: true })
  assert.equal(forzada.archivadas, 0)
  assert.equal((await actividades()).length, 1, 'sin tarjetas nuevas que archivar, no hay otra entrada en la actividad')
  assert.equal((await avisos()).length, 1)
})

test('una pasada más tarde con tarjetas nuevas: otra entrada en la actividad pero el aviso de la campana es uno solo por tablero y plazo', async () => {
  const t = await tarjeta('Se hace vieja después', 'Hecho', 45)
  const r = await e.s.archivarHechasViejas({ tableroId: e.tableroId, forzar: true })
  assert.equal(r.archivadas, 1)
  assert.equal(await archivada(t.id), true)
  assert.match((await actividades()).at(-1)!.resumen, /^archivó 1 tarjeta de Hecho de hace más de 30 días$/)
  assert.equal((await avisos()).length, 1, 'el aviso sigue siendo uno')
})

test('el tope de una vez por hora por tablero: la hora pasa y vuelve a correr; con fecha simulada se corre el corte', async () => {
  const t = await tarjeta('Reciente hoy, vieja en 40 días', 'Hecho', 2)
  await dejarSinTurno()
  assert.equal((await e.s.archivarHechasViejas()).archivadas, 0, 'hoy no es vieja')
  assert.equal((await e.s.archivarHechasViejas()).tableros, 0, 'y el tablero ya corrió hace un instante')
  // 40 días después (simulados): ya es vieja, y la hora de espera pasó.
  const futuro = new Date(Date.now() + 40 * DIA)
  const r = await e.s.archivarHechasViejas({ ahora: futuro })
  assert.equal(r.archivadas >= 1, true)
  assert.equal(await archivada(t.id), true)
  // Dentro de la misma hora simulada, no corre otra vez.
  assert.equal((await e.s.archivarHechasViejas({ ahora: new Date(futuro.getTime() + 30 * 60_000) })).tableros, 0)
  assert.equal((await e.s.archivarHechasViejas({ ahora: new Date(futuro.getTime() + 61 * 60_000) })).tableros, 1)
})

test('una checklist sin terminar o un vínculo «bloquea» contra algo abierto frenan el archivo; al resolverse, se archiva', async () => {
  const conChecklist = await tarjeta('Con checklist a medias', 'Hecho', 60)
  await e.s.crearChecklist(e.persona, conChecklist.clave, 'Pasos', ['uno', 'dos'])
  const checklistLista = await tarjeta('Con checklist completa', 'Hecho', 60)
  const cl = await e.s.crearChecklist(e.persona, checklistLista.clave, 'Pasos', ['uno'])
  const itemId = (await e.s.leerTarjeta(checklistLista.clave)).checklists[0]!.items[0]!.id
  void cl
  await e.s.actualizarItem(e.persona, itemId, { hecho: true })

  const bloqueante = await tarjeta('Bloquea a una abierta', 'Hecho', 60)
  const abierta = await tarjeta('Sigue abierta', 'En curso', 1)
  await e.s.vincular(e.persona, bloqueante.clave, 'bloquea', abierta.clave)
  const bloqueada = await tarjeta('Bloqueada por una abierta', 'Hecho', 60)
  await e.s.vincular(e.persona, abierta.clave, 'bloquea', bloqueada.clave)
  const relacionada = await tarjeta('Solo relacionada', 'Hecho', 60)
  await e.s.vincular(e.persona, relacionada.clave, 'relacionada', abierta.clave)

  const r = await e.s.archivarHechasViejas({ tableroId: e.tableroId, forzar: true })
  assert.equal(await archivada(conChecklist.id), false, 'checklist incompleta: no')
  assert.equal(await archivada(checklistLista.id), true, 'checklist completa: sí')
  assert.equal(await archivada(bloqueante.id), false, 'bloquea a una tarjeta abierta: no')
  assert.equal(await archivada(bloqueada.id), false, 'la bloquea una tarjeta abierta: no')
  assert.equal(await archivada(relacionada.id), true, 'un vínculo que no bloquea no frena')
  assert.deepEqual(r.porTablero[0]!.claves.sort(), [checklistLista.clave, relacionada.clave].sort())

  // Se resuelve: la que bloqueaba pasa a Hecho (ya no hay nada abierto) y se termina la checklist.
  await e.s.moverTarjeta(e.persona, abierta.clave, { listaId: e.listas['Hecho']! })
  await e.db.consulta(`update tarjetas set completada_en = $2 where id = $1`, [abierta.id, hace(1)])
  const items = (await e.s.leerTarjeta(conChecklist.clave)).checklists[0]!.items
  for (const i of items) await e.s.actualizarItem(e.persona, i.id, { hecho: true })
  await e.db.consulta(`update tarjetas set completada_en = $2, actualizada_en = $2 where id = any($1::text[])`, [[conChecklist.id, bloqueante.id, bloqueada.id], hace(60)])
  const r2 = await e.s.archivarHechasViejas({ tableroId: e.tableroId, forzar: true })
  assert.equal(r2.archivadas, 3)
  assert.equal(await archivada(abierta.id), false, 'la que se movió hoy no es vieja')
})

test('la opción por tablero: nunca / 7 / 14 / 60, y los tableros que ya existían (sin ajustes guardados) tienen 30', async () => {
  const t7 = await tarjeta('Hecha hace 10 días', 'Hecho', 10)
  const t20 = await tarjeta('Hecha hace 20 días', 'Hecho', 20)
  const t50 = await tarjeta('Hecha hace 50 días', 'Hecho', 50)
  const tab = (await e.s.listarProyectos())[0]!.tableros[0]!
  assert.equal(leerDiasArchivoHecho(tab.ajustes), 30, 'de fábrica: 30, aunque el tablero sea de antes')

  await e.s.actualizarTablero(e.persona, e.tableroId, { ajustes: { archivoHecho: { dias: null } } })
  assert.equal((await e.s.archivarHechasViejas({ tableroId: e.tableroId, forzar: true })).tableros, 0, 'nunca: ni mira')
  assert.equal(await archivada(t50.id), false)

  // Cambiar la opción corre el archivo ya mismo (sin esperar la hora).
  await e.s.actualizarTablero(e.persona, e.tableroId, { ajustes: { archivoHecho: { dias: 60 } } })
  assert.equal(await archivada(t50.id), false, '60 días: la de 50 sigue')
  await e.s.actualizarTablero(e.persona, e.tableroId, { ajustes: { archivoHecho: { dias: 14 } } })
  assert.equal(await archivada(t20.id), true, '14 días: la de 20 se archiva al cambiar la opción')
  assert.equal(await archivada(t50.id), true)
  assert.equal(await archivada(t7.id), false)
  await e.s.actualizarTablero(e.persona, e.tableroId, { ajustes: { archivoHecho: { dias: 7 } } })
  assert.equal(await archivada(t7.id), true, '7 días: la de 10 se archiva')
  const ultima = (await actividades()).at(-1)!
  assert.match(ultima.resumen, /de hace más de 7 días$/)
  // Un aviso por plazo distinto (30 → 14 → 7): se entiende qué plazo disparó cada uno.
  const titulos = (await avisos()).map((a) => a.titulo)
  assert.ok(titulos.some((t) => t.includes('más de 14 días')))
  assert.ok(titulos.some((t) => t.includes('más de 7 días')))
  await e.s.actualizarTablero(e.persona, e.tableroId, { ajustes: { archivoHecho: { dias: 30 } } })
})

test('es por cuenta: B no archiva nada de A, y con el id del tablero de A recibe 404', async () => {
  const b = e.raiz.de('otra')
  await b.crearMiembro({ nombre: 'Ana', esYo: true })
  const ctxB: Ctx = { actor: { tipo: 'humano', id: 'ana', nombre: 'Ana' }, via: 'sesion' }
  const pb = await b.crearProyecto(ctxB, { nombre: 'De B', prefijo: 'BB' })
  const tableroB = pb.tableros[0]!.id
  const listasB: Record<string, string> = {}
  for (const l of await b.listarListas(tableroB)) listasB[l.nombre] = l.id

  const deA = await tarjeta('De A, vieja', 'Hecho', 90)
  const deB = await tarjeta('De B, vieja', 'Hecho', 90, tableroB, listasB, b, ctxB)

  // B corre su archivo (y también el de «todos»): toca lo suyo y nada de A.
  const rB = await b.archivarHechasViejas({ forzar: true })
  assert.equal(rB.archivadas, 1)
  assert.equal(await archivada(deB.id), true)
  assert.equal(await archivada(deA.id), false, 'la de A queda como estaba')
  // Con el id del tablero de A: igual que un tablero que no existe.
  await assert.rejects(() => b.archivarHechasViejas({ tableroId: e.tableroId, forzar: true }), (x: any) => x.estado === 404 || x.status === 404 || /No existe/.test(String(x.message)))
  await assert.rejects(() => b.leerTableroCompleto(e.tableroId), (x: any) => x.estado === 404 || x.status === 404)
  assert.equal(await archivada(deA.id), false)
  // La actividad y el aviso de B son de B.
  const act = await e.db.consulta<{ propietario: string; tablero_id: string }>(`select propietario, tablero_id from actividad where accion = 'tablero.archivo_hecho' and tablero_id = $1`, [tableroB])
  assert.deepEqual(act.map((f) => f.propietario), ['otra'])
  const nB = await e.db.consulta<{ propietario: string }>(`select propietario from notificaciones where tipo = 'aviso' and clave_unica like $1`, [`archivo-hecho:${tableroB}:%`])
  assert.deepEqual(nB.map((f) => f.propietario), ['otra'])
  // Y el de A todavía la archiva a la suya.
  const rA = await e.s.archivarHechasViejas({ forzar: true })
  assert.equal(await archivada(deA.id), true)
  assert.equal(await archivada(deB.id), true)
  assert.ok(rA.porTablero.every((x) => x.tableroId === e.tableroId))
})

test('restaurar una tarjeta archivada por Telar la deja en Hecho y no se vuelve a archivar sola', async () => {
  const t = await tarjeta('Se restaura con un toque', 'Hecho', 80)
  await e.s.archivarHechasViejas({ tableroId: e.tableroId, forzar: true })
  assert.equal(await archivada(t.id), true)
  const restaurada = await e.s.archivarTarjeta(e.persona, t.clave, false)
  assert.equal(restaurada.archivada, false)
  assert.ok(new Date(restaurada.fechas.completada!).getTime() > Date.now() - 60_000, 'al restaurarla llega a Hecho ahora')
  await e.s.archivarHechasViejas({ tableroId: e.tableroId, forzar: true })
  assert.equal(await archivada(t.id), false, 'no se archiva de nuevo')
  // Si el tablero está en «nunca», restaurar no toca la fecha de completada.
  await e.s.actualizarTablero(e.persona, e.tableroId, { ajustes: { archivoHecho: { dias: null } } })
  const u = await tarjeta('Otra vieja', 'Hecho', 80)
  await e.s.archivarTarjeta(e.persona, u.clave, true)
  const back = await e.s.archivarTarjeta(e.persona, u.clave, false)
  assert.ok(new Date(back.fechas.completada!).getTime() < Date.now() - 70 * DIA)
  await e.s.actualizarTablero(e.persona, e.tableroId, { ajustes: { archivoHecho: { dias: 30 } } })
})

test('llegar a Hecho deja la tarjeta arriba (aunque ya tuviera una fecha vieja); moverla dentro de Hecho no cambia cuándo llegó', async () => {
  const x = await tarjeta('Marcada hace mucho', 'En curso', 90)
  const movida = await e.s.moverTarjeta(e.persona, x.clave, { listaId: e.listas['Hecho']! })
  assert.ok(new Date(movida.fechas.completada!).getTime() > Date.now() - 60_000, 'llega ahora, no hace 90 días')
  const fecha = movida.fechas.completada
  const dentro = await e.s.moverTarjeta(e.persona, x.clave, { listaId: e.listas['Hecho']!, posicion: 'arriba' })
  assert.equal(dentro.fechas.completada, fecha, 'reordenar dentro de Hecho no cambia la fecha')
  const afuera = await e.s.moverTarjeta(e.persona, x.clave, { listaId: e.listas['En curso']! })
  assert.equal(afuera.fechas.completada, null)
})

test('abrir el tablero corre el archivo solo (una vez por hora) y, sin la migración, abrirlo sigue andando', async () => {
  const t = await tarjeta('Se archiva al abrir', 'Hecho', 70)
  await dejarSinTurno()
  const tablero = await e.s.leerTableroCompleto(e.tableroId)
  assert.equal(await archivada(t.id), true)
  assert.ok(!tablero.tarjetas.some((x) => x.id === t.id), 'ya no viene en lo que se abre')
  // Dentro de la hora, abrir de nuevo no vuelve a mirar (una vieja nueva queda hasta que pase la hora).
  const t2 = await tarjeta('Otra, dentro de la hora', 'Hecho', 70)
  await e.s.leerTableroCompleto(e.tableroId)
  assert.equal(await archivada(t2.id), false)
  await e.db.consulta(`update tableros set archivo_hecho_en = now() - interval '2 hours'`)
  await e.s.leerTableroCompleto(e.tableroId)
  assert.equal(await archivada(t2.id), true)

  // Sin la columna (la migración todavía no se aplicó online): abrir el tablero anda igual, sin archivar.
  const t3 = await tarjeta('Sin migración', 'Hecho', 70)
  await e.db.consulta(`alter table tableros drop column archivo_hecho_en`)
  const sin = await e.s.leerTableroCompleto(e.tableroId)
  assert.ok(sin.tarjetas.some((x) => x.id === t3.id), 'sin migración no archiva, pero el tablero abre')
  await e.db.consulta(`alter table tableros add column archivo_hecho_en timestamptz`)
})

test('el barrido del cron archiva lo viejo de cada cuenta con el Servicio de cada una, y no corre más de una vez por hora', async () => {
  const { barrerHechasViejas } = await import('./archivo-hecho')
  const [fb] = await e.db.consulta<{ id: string }>(`select x.id from tableros x join proyectos p on p.id = x.proyecto_id where p.propietario = 'otra' limit 1`)
  const listasB: Record<string, string> = {}
  for (const l of await e.raiz.de('otra').listarListas(fb!.id)) listasB[l.nombre] = l.id
  const ctxB: Ctx = { actor: { tipo: 'humano', id: 'ana', nombre: 'Ana' }, via: 'sesion' }
  const deA = await tarjeta('A: la agarra el barrido', 'Hecho', 70)
  const deB = await tarjeta('B: la agarra el barrido', 'Hecho', 70, fb!.id, listasB, e.raiz.de('otra'), ctxB)
  const nueva = await tarjeta('A: reciente, no', 'Hecho', 3)
  await dejarSinTurno()
  const r = await barrerHechasViejas(e.raiz, { forzar: true })
  assert.ok(r.archivadas >= 2, 'y lo que otras pruebas dejaron viejo en Hecho')
  assert.equal(await archivada(deA.id), true)
  assert.equal(await archivada(deB.id), true)
  assert.equal(await archivada(nueva.id), false)
  const [f] = await e.db.consulta<{ propietario: string }>(`select propietario from actividad where accion = 'tablero.archivo_hecho' and tablero_id = $1 order by creado_en desc limit 1`, [fb!.id])
  assert.equal(f!.propietario, 'otra')
  // Sin forzar, dentro de la hora, no mira nada.
  const x = await tarjeta('A: otra vieja', 'Hecho', 70)
  assert.deepEqual(await barrerHechasViejas(e.raiz), { tableros: 0, archivadas: 0 })
  assert.equal(await archivada(x.id), false)
})

test('lo que corre adentro de un trabajo de la IA no se le anota a su tanda', async () => {
  const { conTanda, efectosVacios } = await import('./tanda')
  const t = await tarjeta('Vieja en una tanda', 'Hecho', 70)
  const tanda = { id: 'trabajo-x', llamadaId: null, efectos: efectosVacios() }
  await dejarSinTurno()
  await conTanda(tanda, () => e.s.leerTableroCompleto(e.tableroId))
  assert.equal(await archivada(t.id), true)
  assert.equal(tanda.efectos.tarjetas.includes(t.id), false)
  assert.equal((await actividades()).at(-1)!.resumen.startsWith('archivó'), true)
  const [f] = await e.db.consulta<{ tanda: string | null }>(`select tanda from actividad where accion = 'tablero.archivo_hecho' order by creado_en desc limit 1`)
  assert.equal(f!.tanda, null)
})

test('leer_tablero (MCP): las 20 más recientes de Hecho, `ocultas` y la página que se pide', async () => {
  const pr = await e.s.crearProyecto(e.persona, { nombre: 'Muchas hechas', prefijo: 'MH' })
  const tableroId = pr.tableros[0]!.id
  const listas: Record<string, string> = {}
  for (const l of await e.s.listarListas(tableroId)) listas[l.nombre] = l.id
  // 45 tarjetas: la 1 es la más vieja (hace 45 días... pero el tablero de acá no archiva: se pone en «nunca»).
  await e.s.actualizarTablero(e.persona, tableroId, { ajustes: { archivoHecho: { dias: null } } })
  const hechas: string[] = []
  for (let i = 1; i <= 45; i++) {
    const t = await e.s.crearTarjeta(e.persona, { tableroId, titulo: `Hecha ${i}`, listaId: listas['Hecho'] })
    await e.db.consulta(`update tarjetas set completada_en = $2 where id = $1`, [t.id, hace(46 - i)])
    hechas.push(t.clave)
  }
  await e.s.crearTarjeta(e.persona, { tableroId, titulo: 'Por hacer 1', listaId: listas['Por hacer'] })
  const h = buscarHerramienta('leer_tablero')!
  const leer = async (extra: Record<string, unknown> = {}) => {
    const r = (await h.ejecutar(e.s, { tipo: 'ia', id: 'ia', nombre: 'Claude' }, h.esquema.parse({ proyecto: 'MH', ...extra }))) as any
    return r.listas.find((l: any) => l.nombre === 'Hecho')
  }
  const l1 = await leer()
  assert.equal(l1.cantidad, 45)
  assert.equal(l1.tarjetas.length, PAGINA_HECHO)
  assert.equal(l1.ocultas, 25)
  assert.equal(l1.tarjetas[0].clave, hechas[44], 'la que llegó último, primero')
  assert.equal(l1.tarjetas[19].clave, hechas[25])
  assert.deepEqual(l1.para_ver_mas, { hechas_desde: 20 })
  const l2 = await leer({ hechas_desde: 20 })
  assert.equal(l2.tarjetas.length, 20)
  assert.equal(l2.tarjetas[0].clave, hechas[24])
  assert.equal(l2.ocultas, 25)
  const l3 = await leer({ hechas_desde: 40 })
  assert.equal(l3.tarjetas.length, 5)
  assert.equal(l3.para_ver_mas, undefined)
  const todas = await leer({ incluir_hechas: true })
  assert.equal(todas.tarjetas.length, 45)
  assert.equal(todas.ocultas, undefined)
  const soloCuenta = await leer({ hechas_cantidad: 0 })
  assert.equal(soloCuenta.tarjetas.length, 0)
  assert.equal(soloCuenta.cantidad, 45)
  assert.equal(soloCuenta.ocultas, 45)
  // Las listas que no son de Hecho vienen enteras, sin `ocultas`.
  const r = (await h.ejecutar(e.s, { tipo: 'ia', id: 'ia', nombre: 'Claude' }, h.esquema.parse({ proyecto: 'MH' }))) as any
  const ph = r.listas.find((l: any) => l.nombre === 'Por hacer')
  assert.equal(ph.tarjetas.length, 1)
  assert.equal(ph.ocultas, undefined)
})

test('actualizar_tablero (MCP) cambia el plazo y lo muestra; la opción pide un valor válido', async () => {
  const h = buscarHerramienta('actualizar_tablero')!
  const ia: Actor = { tipo: 'ia', id: 'ia', nombre: 'Claude' }
  const r = (await h.ejecutar(e.s, ia, h.esquema.parse({ tablero: e.tableroId, archivo_hecho_dias: 14 }))) as any
  assert.equal(r.tablero.archivo_hecho_dias, 14)
  const n = (await h.ejecutar(e.s, ia, h.esquema.parse({ tablero: e.tableroId, archivo_hecho_dias: 'nunca' }))) as any
  assert.equal(n.tablero.archivo_hecho_dias, 'nunca')
  assert.throws(() => h.esquema.parse({ tablero: e.tableroId, archivo_hecho_dias: 5 }))
  await h.ejecutar(e.s, ia, h.esquema.parse({ tablero: e.tableroId, archivo_hecho_dias: 30 }))
})

test('la migración es aditiva y repetible', async () => {
  const carpeta = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations')
  const sql = readFileSync(path.join(carpeta, '20261207090000_archivo_hecho.sql'), 'utf8')
  const sinComentarios = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
  assert.doesNotMatch(sinComentarios, /\btablero\b\./i, 'no nombra el esquema')
  assert.doesNotMatch(sinComentarios, /\b(create\s+schema|set\s+search_path|drop|truncate|delete\s+from|grant|revoke)\b/i)
  assert.doesNotMatch(sinComentarios, /add\s+column\s+(?!if not exists)/i)
  assert.doesNotMatch(sinComentarios, /create\s+(unique\s+)?index\s+(?!if not exists)/i)
  await e.db.ejecutar(sql)
  await e.db.ejecutar(sql)
})
