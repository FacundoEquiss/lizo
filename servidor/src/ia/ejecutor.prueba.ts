// Pruebas del ciclo del trabajo (ejecutor.ts, tarea 2.11): tomar, correr, pasos guardados, libro de llamadas, topes, cierre, errores,
// filtro de direcciones, confirmación, cancelar y que un corte nunca repita una acción. Con un proveedor falso MÍNIMO propio
// (prueba-falso.ts), en una base PGlite en memoria. Cubre los escenarios T1 a T14, T18 y T20 del plan (15.5) y los topes en sus tres niveles;
// las menciones (T15, T16, T19, T21, conversación sin @, proactividad) están en menciones-ia.prueba.ts. `npm run ia:probar-ejecutor`.
//
// Lo que no prueba: la carrera de dos procesos de verdad (PGlite tiene una sola conexión) ni `waitUntil` en Vercel.
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { Actor } from '../../../compartido/tipos'
import { barrer, configurarEjecutor, correr, CorteSimulado, ejecutorAgente, sinClaves } from './ejecutor'
import { crearAgente, crearEntorno, crearFalsoDePrueba, crearTarjeta, depsDePrueba, ponerGuion, type Entorno, type OpcionesAgente } from './prueba-base'
import { ejecutarCodigo, pistasDeRutas, prepararCodigo } from './codigo'
import { costoDelAgente } from './proveedores/precios'
import { sellar } from './boveda'
// @ts-expect-error módulo de scripts (JavaScript)
import { levantarGithubFalso, REPO_FALSO, TOKEN_FALSO } from '../../../scripts/github-falso.mjs'
import { iaDe } from './servicio-ia'
import { trabajosDe, type AgenteInterno } from './trabajos'
import type { LlamadaGuardada, TrabajoInterno } from './tipos'

const CLAVE_SECRETA = 'prueba-clave-super-secreta-12345'
let e: Entorno
const falso = crearFalsoDePrueba()
let cortarEn: string | null = null
let plazoMs = Number.POSITIVE_INFINITY
let encadenados: string[] = []
const salidaDelServidor: string[] = []

/** Las dependencias del ciclo de estas pruebas: el falso, un tiempo que se maneja a mano y cortes a propósito. */
const depsComunes = () =>
  depsDePrueba(falso, {
    clave: CLAVE_SECRETA,
    cancelarCadaMs: 40,
    esperar: async () => {},
    plazo: () => plazoMs,
    encadenar: async (c) => void encadenados.push(c),
    punto: (n) => {
      if (n === cortarEn) {
        cortarEn = null
        throw new CorteSimulado(n)
      }
    },
  })

before(async () => {
  e = await crearEntorno()
  const original = console.error
  console.error = (...a: unknown[]) => {
    salidaDelServidor.push(a.map(String).join(' '))
    original(...a)
  }
  configurarEjecutor(depsComunes())
})
after(async () => {
  configurarEjecutor(null)
  await e.cerrar()
})
beforeEach(async () => {
  falso.reiniciar()
  cortarEn = null
  plazoMs = Number.POSITIVE_INFINITY
  encadenados = []
  // cada prueba arranca sin trabajos vivos ni gasto de las anteriores
  await e.db.consulta(`update ia_trabajos set estado = 'cancelado', terminado_en = now(), tomado_hasta = null where estado in ('en_cola', 'en_curso', 'esperando_confirmacion', 'pausado_tope')`)
  await e.db.consulta(`update ia_trabajos set creado_en = now() - interval '2 days' where creado_en > now() - interval '1 day'`) // los límites por hora no son de este test
  await e.db.consulta(`delete from ia_uso_mes`)
  await e.db.consulta(`delete from ia_ajustes`)
})

const ia = () => iaDe(e.s)
const tb = () => trabajosDe(ia())

/** Un agente nuevo con esa configuración (lo del guion se pone aparte). */
async function agente(o: OpcionesAgente = {}) {
  const a = await crearAgente(e, o)
  return a
}

/** Una tarjeta con un comentario de la persona que menciona al agente y el trabajo que lo atiende (como lo crearía la mención). */
async function pedir(a: { miembroId: string }, o: { guion?: string; texto?: string; titulo?: string; descripcion?: string; origen?: TrabajoInterno['origen']; demoraMs?: number } = {}) {
  if (o.guion) await ponerGuion(e, a.miembroId, o.guion)
  const tarjeta = await crearTarjeta(e, o.titulo ?? 'Tarjeta de prueba', { descripcion: o.descripcion })
  const texto = o.texto ?? '@claude ya le respondí'
  const comentario = await e.s.comentar(e.persona, tarjeta.clave, texto)
  const agenteInt = (await tb().agente(a.miembroId))!
  const mencion = await ia().insertarMencion({
    origen: { tipo: 'comentario', id: comentario.id },
    ocurrencia: 1,
    destinatarioId: a.miembroId,
    autor: e.persona.actor,
    extracto: texto,
    proyectoId: tarjeta.proyectoId,
    tableroId: tarjeta.tableroId,
    tarjetaId: tarjeta.id,
    tarjetaClave: tarjeta.clave,
    estado: 'pendiente',
    nota: null,
  })
  const r = await tb().crear({
    agente: agenteInt,
    origen: o.origen ?? 'mencion',
    mencionId: mencion!.id,
    superficie: 'tarjeta',
    contexto: { proyectoId: tarjeta.proyectoId, tableroId: tarjeta.tableroId, tarjetaId: tarjeta.id, tarjetaClave: tarjeta.clave, origen: { tipo: 'comentario', id: comentario.id }, respuestaA: comentario.id },
    pedido: texto,
    pedidoPor: e.persona.actor,
    demoraMs: o.demoraMs,
  })
  assert.equal(r.tipo, 'creado')
  return { trabajo: (r as { trabajo: TrabajoInterno }).trabajo, tarjeta, comentario, mencionId: mencion!.id }
}

const fila = async (id: string) => (await e.db.consulta(`select * from ia_trabajos where id = $1`, [id]))[0]!
const estadoDe = async (id: string) => (await fila(id)).estado as string
const llamadasDe = async (id: string): Promise<LlamadaGuardada[]> => tb().llamadas(id)
const comentariosDe = (clave: string) =>
  e.db.consulta<{ id: string; cuerpo: string; autor: Actor; respuesta_a: string | null; trabajo_id: string | null }>(
    `select c.* from comentarios c join tarjetas t on t.id = c.tarjeta_id where t.clave = $1 order by c.creado_en, c.id`,
    [clave],
  )
const eventosDeTrabajo = (id: string) => e.eventos.filter((x) => x.tipo === 'trabajo' && (x.datos as { id: string }).id === id).map((x) => x.accion)
/** Se le venció el préstamo al proceso que tenía el trabajo (murió). */
const vencer = (id: string) => e.db.consulta(`update ia_trabajos set tomado_hasta = now() - interval '1 second' where id = $1`, [id])
const adelantar = (id: string) => e.db.consulta(`update ia_trabajos set proximo_en = now() where id = $1`, [id])
const corrida = () => correr(e.raiz, 'dueno')
const notificaciones = (tipo: string) => e.db.consulta<{ titulo: string; cuerpo: string; clave_unica: string | null }>(`select * from notificaciones where tipo = $1 order by creado_en`, [tipo])

// ───────────────────────── T1 a T3: lo básico ─────────────────────────

test('T1 · responder: comentario r_<trabajo> con respuesta_a, mención atendida, notificación, uso guardado, eventos creado y hecho', async () => {
  const a = await agente({})
  const { trabajo, tarjeta, comentario, mencionId } = await pedir(a, { guion: 'responder' })
  assert.equal(await estadoDe(trabajo.id), 'en_cola')
  await corrida()
  const f = await fila(trabajo.id)
  assert.equal(f.estado, 'hecho')
  assert.equal(f.paso, 1)
  const cs = await comentariosDe(tarjeta.clave)
  const r = cs.find((c) => c.id === `r_${trabajo.id}`)!
  assert.ok(r, 'la respuesta tiene el id determinístico')
  assert.equal(r.cuerpo, 'Respuesta de prueba.')
  assert.equal(r.respuesta_a, comentario.id)
  assert.equal(r.trabajo_id, trabajo.id)
  assert.equal(r.autor.tipo, 'ia')
  assert.equal(r.autor.id, a.miembroId)
  const [m] = await e.db.consulta(`select estado, trabajo_id from menciones where id = $1`, [mencionId])
  assert.equal(m!.estado, 'atendida')
  assert.equal(m!.trabajo_id, trabajo.id)
  const ns = (await notificaciones('respuesta')).filter((n) => n.clave_unica === `respuesta:${trabajo.id}`)
  assert.equal(ns.length, 1)
  assert.match(ns[0]!.titulo, /Claude respondió en PR-\d+/)
  const usos = await e.db.consulta(`select * from ia_uso where trabajo_id = $1`, [trabajo.id])
  assert.equal(usos.length, 1)
  assert.equal(Number(usos[0]!.entrada), 1000)
  assert.ok(Math.abs(Number(f.costo_usd) - costoDelAgente({ proveedor: 'falso', modelo: 'guion:responder', uso: falso.ultimoUso! })) < 1e-9, 'el costo del trabajo es el del pedido')
  const mes = await e.db.consulta(`select costo_usd, llamadas from ia_uso_mes where agente_id = $1`, [a.miembroId])
  assert.equal(Number(mes[0]!.llamadas), 1)
  assert.deepEqual(eventosDeTrabajo(trabajo.id), ['creado', 'paso', 'hecho'])
})

test('T2 · leer-y-responder: dos pasos, una llamada hecha, la respuesta nombra el título', async () => {
  const a = await agente({})
  const { trabajo, tarjeta } = await pedir(a, { guion: 'leer-y-responder', titulo: 'Arreglar el barrio' })
  await corrida()
  const f = await fila(trabajo.id)
  assert.equal(f.estado, 'hecho')
  assert.equal(f.paso, 2)
  const ls = await llamadasDe(trabajo.id)
  assert.equal(ls.length, 1)
  assert.equal(ls[0]!.estado, 'hecha')
  assert.equal(ls[0]!.herramienta, 'leer_tarjeta')
  assert.match(ls[0]!.resultado!, /Arreglar el barrio/)
  assert.match((await comentariosDe(tarjeta.clave)).find((c) => c.id === `r_${trabajo.id}`)!.cuerpo, /Arreglar el barrio/)
  // la conversación guardada: usuario, asistente, resultados (que apuntan al libro), asistente
  const ms = await tb().mensajes(trabajo.id)
  assert.deepEqual(ms.map((m) => m.rol), ['usuario', 'asistente', 'herramienta', 'asistente'])
  assert.deepEqual(ms[2]!.neutro, { rol: 'herramienta', resultados: [{ llamadaId: ls[0]!.id }] }, 'los resultados no repiten el contenido')
  assert.ok(ms.every((m) => m.nativo !== null))
})

test('T3 · mover: la tarjeta queda en «Hecho» y la actividad lleva la tanda del trabajo, con el agente como autor', async () => {
  const a = await agente({})
  const { trabajo, tarjeta } = await pedir(a, { guion: 'mover' })
  await corrida()
  assert.equal(await estadoDe(trabajo.id), 'hecho')
  assert.equal((await e.s.leerTarjeta(tarjeta.clave)).listaId, e.listas['Hecho'])
  const act = await e.db.consulta<{ accion: string; actor: Actor }>(`select accion, actor from actividad where tanda = $1`, [trabajo.id])
  assert.ok(act.length >= 1)
  assert.ok(act.some((x) => x.accion.startsWith('tarjeta.mov')))
  assert.ok(act.every((x) => x.actor.tipo === 'ia' && x.actor.id === a.miembroId && x.actor.nombre === 'Claude'))
  const [ll] = await llamadasDe(trabajo.id)
  assert.deepEqual(ll!.efectos?.tarjetas, [tarjeta.id], 'los efectos de la llamada: la tarjeta que tocó')
  assert.deepEqual((await tb().resumen(await tb().propio(trabajo.id))).hizo, [`Movió ${tarjeta.clave} a Hecho`])
})

// ───────────────────────── T4 y T5: permisos y confirmación ─────────────────────────

test('T4 · archivar con los permisos de fábrica: llamada denegada, la tarjeta sigue ahí y el modelo se entera', async () => {
  const a = await agente({})
  const { trabajo, tarjeta } = await pedir(a, { guion: 'archivar' })
  await corrida()
  const [ll] = await llamadasDe(trabajo.id)
  assert.equal(ll!.estado, 'denegada')
  assert.match(ll!.resultado!, /^No tenés permiso para archivar tarjetas y sacar cosas del lienzo\. Decíselo a la persona en tu respuesta\.$/)
  assert.equal((await e.s.leerTarjeta(tarjeta.clave)).archivada, false)
  assert.equal(await estadoDe(trabajo.id), 'hecho')
  assert.match((await comentariosDe(tarjeta.clave)).find((c) => c.id === `r_${trabajo.id}`)!.cuerpo, /no tengo permiso/)
})

test('T5 · archivar con permiso y «solo lo delicado»: espera confirmación; Permitir archiva, No deja todo como está', async () => {
  const a = await agente({ permisos: ['comentar', 'tarjetas', 'lienzo', 'archivar'], confirmar: 'peligrosas' })
  const { trabajo, tarjeta } = await pedir(a, { guion: 'archivar' })
  await corrida()
  assert.equal(await estadoDe(trabajo.id), 'esperando_confirmacion')
  const [ll] = await llamadasDe(trabajo.id)
  assert.equal(ll!.estado, 'esperando')
  assert.equal(ll!.motivo, `Archivar ${tarjeta.clave}`)
  assert.equal((await e.s.leerTarjeta(tarjeta.clave)).archivada, false, 'todavía no hizo nada')
  const conf = (await notificaciones('confirmacion')).filter((n) => n.clave_unica?.startsWith(`confirmacion:${trabajo.id}`))
  assert.equal(conf.length, 1)
  const resumen = (await ia().trabajos({ vivos: false })).find((x) => x.id === trabajo.id)!
  assert.equal(resumen.estado, 'esperando_confirmacion')
  assert.equal(resumen.porConfirmar?.[0]?.titulo, `Archivar ${tarjeta.clave}`)
  // una persona con sesión permite
  await ia().confirmar({ ...e.persona }, trabajo.id, [{ llamadaId: ll!.id, permitir: true }])
  assert.equal(await estadoDe(trabajo.id), 'en_cola')
  await corrida()
  assert.equal(await estadoDe(trabajo.id), 'hecho')
  assert.equal((await e.s.leerTarjeta(tarjeta.clave)).archivada, true)
  assert.match((await comentariosDe(tarjeta.clave)).find((c) => c.id === `r_${trabajo.id}`)!.cuerpo, /^Archivé /)

  // en otra corrida, «No»
  const b = await pedir(a, { guion: 'archivar', texto: '@claude archivá esta también' })
  await corrida()
  const [l2] = await llamadasDe(b.trabajo.id)
  assert.equal(l2!.estado, 'esperando')
  await ia().confirmar({ ...e.persona }, b.trabajo.id, [{ llamadaId: l2!.id, permitir: false }])
  await corrida()
  assert.equal(await estadoDe(b.trabajo.id), 'hecho')
  assert.equal((await e.s.leerTarjeta(b.tarjeta.clave)).archivada, false, 'sigue ahí')
  assert.equal((await llamadasDe(b.trabajo.id))[0]!.estado, 'denegada')
  assert.match((await comentariosDe(b.tarjeta.clave)).find((c) => c.id === `r_${b.trabajo.id}`)!.cuerpo, /no me dejaste/)
})

test('confirmar y reanudar piden sesión (la clave del MCP no alcanza) y confirmar pide decidir todas las acciones', async () => {
  const a = await agente({ permisos: ['comentar', 'tarjetas', 'lienzo', 'archivar'] })
  const { trabajo } = await pedir(a, { guion: 'archivar' })
  await corrida()
  const [ll] = await llamadasDe(trabajo.id)
  const conClave = { actor: e.persona.actor, via: 'clave' as const }
  await assert.rejects(() => ia().confirmar(conClave, trabajo.id, [{ llamadaId: ll!.id, permitir: true }]), (x: any) => x.estado === 403)
  await assert.rejects(() => ia().reanudar(conClave, trabajo.id), (x: any) => x.estado === 403)
  await assert.rejects(() => ia().confirmar(e.persona, trabajo.id, []), /Falta decidir una acción/)
  await assert.rejects(() => ia().confirmar(e.persona, trabajo.id, [{ llamadaId: 'll_ajena', permitir: true }]), (x: any) => x.estado === 404)
  await assert.rejects(() => ia().reanudar(e.persona, trabajo.id), (x: any) => x.estado === 409, 'solo se reanuda lo pausado o fallado')
  // frenar sí lo puede hacer quien tiene la clave del MCP
  assert.equal((await ia().cancelar(conClave, trabajo.id)).estado, 'cancelado')
  assert.equal((await llamadasDe(trabajo.id))[0]!.estado, 'denegada', 'lo que esperaba permiso ya no espera')
})

test('el modo «siempre» pide permiso por todo lo que escribe, junto; «nunca» no pide ni lo delicado (salvo direcciones de datos)', async () => {
  const siempre = await agente({ confirmar: 'siempre' })
  const x = await pedir(siempre, { guion: 'mover' })
  await corrida()
  assert.equal(await estadoDe(x.trabajo.id), 'esperando_confirmacion')
  assert.match((await llamadasDe(x.trabajo.id))[0]!.motivo!, /^Mover .* a Hecho$/)
  await ia().cancelar(e.persona, x.trabajo.id)

  const nunca = await agente({ permisos: ['comentar', 'tarjetas', 'lienzo', 'archivar'], confirmar: 'nunca' })
  const y = await pedir(nunca, { guion: 'archivar' })
  await corrida()
  assert.equal(await estadoDe(y.trabajo.id), 'hecho', 'sin confirmación, archiva')
  assert.equal((await e.s.leerTarjeta(y.tarjeta.clave)).archivada, true)
})

test('desde la tarjeta número 11 que toca el mismo trabajo se pide permiso (Ya tocó 10 tarjetas)', async () => {
  const a = await agente({ confirmar: 'peligrosas' })
  const { trabajo, tarjeta } = await pedir(a, { guion: 'responder' })
  // 10 llamadas hechas de crear_tarjeta con su efecto, ya en el libro: la siguiente es la número 11
  const ids: string[] = []
  for (let i = 0; i < 10; i++) ids.push((await crearTarjeta(e, `Hija ${i}`)).id)
  await e.db.consulta(`update ia_trabajos set estado = 'en_curso' where id = $1`, [trabajo.id])
  await e.db.consulta(
    `insert into ia_llamadas (id, trabajo_id, propietario, paso, orden, id_proveedor, herramienta, argumentos, estado, efectos)
     select 'x' || g, $1, 'dueno', 0, g, 'c' || g, 'crear_tarjeta', '{}'::jsonb, 'hecha', jsonb_build_object('tarjetas', jsonb_build_array(($2::text[])[g + 1]))
       from generate_series(0, 9) g`,
    [trabajo.id, ids],
  )
  const llamadas = await llamadasDe(trabajo.id)
  const ag = (await tb().agente(a.miembroId))!
  const ejec = ejecutorAgente(e.s, ag, { ...(await tb().propio(trabajo.id)), tarjetasTocadas: 10 })
  const r = await ejec({ id: 'c11', nombre: 'crear_tarjeta', argumentos: { titulo: 'Número 11' } }, {})
  assert.equal(r.estado, 'esperando')
  assert.equal(r.motivo, 'Ya tocó 10 tarjetas: ¿sigue?')
  assert.equal(llamadas.length, 10)
  void tarjeta
})

// ───────────────────────── T6: el límite de pasos ─────────────────────────

test('T6 · bucle: corta en el límite de pasos, falla con lo hecho a la vista y nunca pide más de max_pasos + 1 veces', async () => {
  const a = await agente({ topeMesUsd: 100 })
  const { trabajo } = await pedir(a, { guion: 'bucle' })
  await corrida()
  const f = await fila(trabajo.id)
  assert.equal(f.estado, 'fallado')
  assert.match(f.motivo, /límite de pasos/)
  assert.equal(falso.pedidos, Number(f.max_pasos) + 1, 'max_pasos + 1 pedidos, ni uno más')
  const ls = await llamadasDe(trabajo.id)
  assert.equal(ls.filter((l) => l.estado === 'hecha').length, Number(f.max_pasos) - 1, 'las lecturas de antes del límite')
  assert.ok(ls.some((l) => l.estado === 'denegada' && /límite de pasos/.test(l.resultado ?? '')), 'al llegar, vuelve con el aviso')
  assert.equal((await notificaciones('error_ia')).filter((n) => n.clave_unica?.startsWith(`error:${trabajo.id}`)).length, 1)
})

// ───────────────────────── T7: topes ─────────────────────────

test('T7 · caro con tope de USD 1: aviso del 80 % una sola vez, pausado_tope sin perder nada, subir el tope y reanudar → hecho, misma conversación', async () => {
  const a = await agente({ topeMesUsd: 1 })
  await e.db.consulta(`delete from ia_uso_mes`)
  const { trabajo, tarjeta } = await pedir(a, { guion: 'caro' })
  await corrida()
  let f = await fila(trabajo.id)
  assert.equal(f.estado, 'pausado_tope')
  assert.equal(f.motivo, 'tope_agente')
  assert.ok(Number(f.costo_usd) >= 1)
  assert.equal(f.paso, 2, 'dos pedidos, y el tercero ya no se hizo')
  assert.equal((await notificaciones('tope')).filter((n) => n.clave_unica?.startsWith('tope80:')).length, 1, 'el 80 % se avisa una sola vez')
  assert.equal((await notificaciones('tope')).filter((n) => n.clave_unica?.startsWith('tope100:')).length, 1)
  assert.equal(falso.pedidos, 2)
  const antes = (await tb().mensajes(trabajo.id)).map((m) => m.nativo)
  // el dueño sube el tope y reanuda (con sesión)
  await e.db.consulta(`update ia_agentes set tope_mes_usd = 50 where miembro_id = $1`, [a.miembroId])
  const r = await ia().reanudar(e.persona, trabajo.id)
  assert.equal(r.estado, 'en_cola')
  await corrida()
  f = await fila(trabajo.id)
  assert.equal(f.estado, 'hecho')
  const despues = (await tb().mensajes(trabajo.id)).map((m) => m.nativo)
  assert.deepEqual(despues.slice(0, antes.length), antes, 'la conversación es la misma: lo que ya estaba no cambió')
  assert.match((await comentariosDe(tarjeta.clave)).find((c) => c.id === `r_${trabajo.id}`)!.cuerpo, /fue caro/)
})

test('el tope de la CUENTA y «pausar toda la IA» también pausan, con su motivo, y el del TRABAJO se duplica con «Seguir igual»', async () => {
  const a = await agente({ topeMesUsd: 1000 })
  // tope de la cuenta
  await e.db.consulta(`delete from ia_uso_mes`)
  await e.db.consulta(`insert into ia_ajustes (propietario, tope_mes_usd) values ('dueno', 0.5) on conflict (propietario) do update set tope_mes_usd = 0.5, pausada = false`)
  const x = await pedir(a, { guion: 'caro' })
  await corrida()
  assert.equal((await fila(x.trabajo.id)).motivo, 'tope_cuenta')
  // pausar toda la IA
  await e.db.consulta(`update ia_ajustes set tope_mes_usd = 25, pausada = true where propietario = 'dueno'`)
  const y = await pedir(a, { guion: 'responder' })
  await corrida()
  assert.equal(await estadoDe(y.trabajo.id), 'pausado_tope')
  assert.equal((await fila(y.trabajo.id)).motivo, 'pausa')
  assert.equal(falso.pedidos, 1, 'no se pidió nada mientras estaba en pausa (el único pedido fue el del trabajo caro de la cuenta)')
  await e.db.consulta(`update ia_ajustes set pausada = false where propietario = 'dueno'`)
  await e.db.consulta(`delete from ia_uso_mes`)
  await ia().reanudar(e.persona, y.trabajo.id)
  await corrida()
  assert.equal(await estadoDe(y.trabajo.id), 'hecho')
  // tope del trabajo: con tarjeta, USD 1; «caro» gasta 0.6 por pedido
  const z = await pedir(a, { guion: 'caro' })
  await corrida()
  const fz = await fila(z.trabajo.id)
  assert.equal(fz.estado, 'pausado_tope')
  assert.equal(fz.motivo, 'tope_trabajo')
  await ia().reanudar(e.persona, z.trabajo.id)
  assert.equal(Number((await fila(z.trabajo.id)).tope_usd), 2, '«Seguir igual» duplica el tope del trabajo')
  await corrida()
  assert.equal(await estadoDe(z.trabajo.id), 'hecho')
  await e.db.consulta(`delete from ia_ajustes`)
})

test('una IA con el tope en cero crea el trabajo igual y se pausa en el primer paso: no se pierde nada', async () => {
  const a = await agente({ topeMesUsd: 0 })
  await e.db.consulta(`delete from ia_uso_mes`)
  const { trabajo } = await pedir(a, { guion: 'responder' })
  await corrida()
  assert.equal(await estadoDe(trabajo.id), 'pausado_tope')
  assert.equal(falso.pedidos, 0)
  assert.equal((await tb().mensajes(trabajo.id)).length, 1, 'quedó el primer mensaje, listo para cuando se suba el tope')
})

// ───────────────────────── T8: frenar ─────────────────────────

test('T8 · frenar durante un pedido lento: cancelado en pocos segundos, sin respuesta, con el uso estimado anotado', async () => {
  const a = await agente({})
  const { trabajo, tarjeta } = await pedir(a, { guion: 'lento' })
  const corriendo = corrida()
  // esperar a que el pedido esté en vuelo
  for (let i = 0; i < 100 && falso.pedidos === 0; i++) await new Promise((r) => setTimeout(r, 20))
  assert.equal(falso.pedidos, 1)
  assert.equal(await estadoDe(trabajo.id), 'en_curso')
  const t0 = Date.now()
  const r = await ia().cancelar({ actor: e.persona.actor, via: 'clave' }, trabajo.id)
  assert.equal(r.estado, 'en_curso', 'se pidió: el ciclo lo ve')
  await corriendo
  assert.ok(Date.now() - t0 < 3_000, 'cancelado enseguida')
  assert.equal(await estadoDe(trabajo.id), 'cancelado')
  assert.equal((await comentariosDe(tarjeta.clave)).filter((c) => c.id === `r_${trabajo.id}`).length, 0, 'ninguna respuesta')
  const [u] = await e.db.consulta(`select * from ia_uso where trabajo_id = $1`, [trabajo.id])
  assert.equal(u!.estimado, true, 'lo que ya se pidió se cobra: estimado por los caracteres')
  assert.ok(Number(u!.entrada) > 0)
  assert.equal(eventosDeTrabajo(trabajo.id).at(-1), 'cancelado')
  const [m] = await e.db.consulta(`select estado from menciones where trabajo_id = $1`, [trabajo.id])
  assert.equal(m!.estado, 'retirada', 'la mención deja de esperar')
})

test('cancelar un trabajo en cola lo cancela en el momento; uno ajeno o terminado no cambia nada', async () => {
  const a = await agente({})
  const { trabajo } = await pedir(a, { guion: 'responder' })
  const r = await ia().cancelar(e.persona, trabajo.id)
  assert.equal(r.estado, 'cancelado')
  await corrida()
  assert.equal(falso.pedidos, 0)
  assert.equal((await ia().cancelar(e.persona, trabajo.id)).estado, 'cancelado', 'otra vez: igual')
})

// ───────────────────────── T9 a T11: cortes ─────────────────────────

test('T9 · corte después de guardar lo del asistente: el trabajo sigue solo, un solo comentario y cada llamada una vez', async () => {
  const a = await agente({})
  const { trabajo, tarjeta } = await pedir(a, { guion: 'leer-y-responder' })
  cortarEn = 'despues-de-guardar-asistente'
  await assert.rejects(corrida(), CorteSimulado)
  assert.equal(await estadoDe(trabajo.id), 'en_curso', 'el proceso murió con el trabajo en la mano')
  assert.equal((await llamadasDe(trabajo.id))[0]!.estado, 'pendiente', 'las llamadas quedaron guardadas, sin correr')
  await corrida()
  assert.equal(await estadoDe(trabajo.id), 'en_curso', 'mientras el préstamo no venza, nadie más lo toma')
  await vencer(trabajo.id)
  await corrida()
  const f = await fila(trabajo.id)
  assert.equal(f.estado, 'hecho')
  assert.equal(f.cortes, 0, 'el corte se cuenta y vuelve a cero con el primer paso que sale bien')
  assert.equal((await comentariosDe(tarjeta.clave)).filter((c) => c.id === `r_${trabajo.id}`).length, 1)
  const ls = await llamadasDe(trabajo.id)
  assert.equal(ls.length, 1)
  assert.equal(ls[0]!.estado, 'hecha')
  assert.equal(falso.pedidos, 2, 'el primer pedido no se repite')
})

test('T10 · corte en medio de una herramienta que escribe: queda «incierta», el modelo verifica leyendo y hay UNA tarjeta, no dos', async () => {
  const a = await agente({})
  const antes = (await e.db.consulta(`select count(*)::int as n from tarjetas where titulo = 'Tarjeta creada por el agente'`))[0]!.n
  const { trabajo } = await pedir(a, { guion: 'crear' })
  cortarEn = 'en-medio-de-herramienta'
  await assert.rejects(corrida(), CorteSimulado)
  assert.equal((await llamadasDe(trabajo.id))[0]!.estado, 'en_curso', 'se cortó con la herramienta a la mitad (la tarjeta ya estaba creada)')
  // después, con otro guion (el que verifica antes de repetir)
  await e.db.consulta(`update ia_trabajos set modelo = 'guion:verifica' where id = $1`, [trabajo.id])
  await vencer(trabajo.id)
  await corrida()
  const f = await fila(trabajo.id)
  assert.equal(f.estado, 'hecho')
  const ls = await llamadasDe(trabajo.id)
  assert.equal(ls[0]!.estado, 'incierta')
  assert.match(ls[0]!.resultado!, /No sé si esta acción llegó a hacerse/)
  assert.equal(ls[1]!.herramienta, 'buscar', 'verificó leyendo antes de repetir')
  const n = (await e.db.consulta(`select count(*)::int as n from tarjetas where titulo = 'Tarjeta creada por el agente'`))[0]!.n
  assert.equal(n - antes, 1, 'una sola tarjeta')
})

test('un corte en medio de una herramienta de solo lectura (o idempotente) se repite; no queda incierta', async () => {
  const a = await agente({})
  const { trabajo } = await pedir(a, { guion: 'leer-y-responder' })
  cortarEn = 'en-medio-de-herramienta'
  await assert.rejects(corrida(), CorteSimulado)
  await vencer(trabajo.id)
  await corrida()
  assert.equal(await estadoDe(trabajo.id), 'hecho')
  assert.equal((await llamadasDe(trabajo.id))[0]!.estado, 'hecha')
})

test('corte con todas las herramientas hechas, antes de guardar los resultados: el mensaje de resultados sale igual, desde el libro', async () => {
  const a = await agente({})
  const { trabajo } = await pedir(a, { guion: 'dos-llamadas' })
  cortarEn = 'despues-de-herramientas'
  await assert.rejects(corrida(), CorteSimulado)
  assert.deepEqual((await llamadasDe(trabajo.id)).map((l) => l.estado), ['hecha', 'hecha'])
  assert.equal((await tb().mensajes(trabajo.id)).length, 2, 'todavía no se guardó el mensaje de resultados')
  await vencer(trabajo.id)
  await corrida()
  assert.equal(await estadoDe(trabajo.id), 'hecho')
  const ms = await tb().mensajes(trabajo.id)
  assert.deepEqual(ms.map((m) => m.rol), ['usuario', 'asistente', 'herramienta', 'asistente'])
  assert.equal((ms[2]!.neutro as { resultados: unknown[] }).resultados.length, 2)
  assert.equal((await llamadasDe(trabajo.id)).filter((l) => l.estado === 'hecha').length, 2, 'ninguna se repitió')
})

test('T11 · corte después de publicar la respuesta y antes de cerrar: una sola respuesta', async () => {
  const a = await agente({})
  const { trabajo, tarjeta } = await pedir(a, { guion: 'responder' })
  cortarEn = 'despues-de-responder'
  await assert.rejects(corrida(), CorteSimulado)
  assert.equal((await comentariosDe(tarjeta.clave)).filter((c) => c.id === `r_${trabajo.id}`).length, 1, 'la respuesta ya estaba publicada')
  assert.equal(await estadoDe(trabajo.id), 'en_curso')
  await vencer(trabajo.id)
  await corrida()
  assert.equal(await estadoDe(trabajo.id), 'hecho')
  assert.equal((await comentariosDe(tarjeta.clave)).filter((c) => c.trabajo_id === trabajo.id).length, 1)
  assert.equal(falso.pedidos, 1)
})

test('corte antes de cerrar: se retoma y entrega una sola vez; tres cortes seguidos lo dejan «fallado»', async () => {
  const a = await agente({})
  const { trabajo, tarjeta } = await pedir(a, { guion: 'responder' })
  cortarEn = 'antes-de-cerrar'
  await assert.rejects(corrida(), CorteSimulado)
  await vencer(trabajo.id)
  await corrida()
  assert.equal(await estadoDe(trabajo.id), 'hecho')
  assert.equal((await comentariosDe(tarjeta.clave)).filter((c) => c.trabajo_id === trabajo.id).length, 1)

  // tres procesos que mueren seguidos con el trabajo en la mano
  const b = await pedir(a, { guion: 'responder', texto: '@claude otra' })
  for (let i = 0; i < 3; i++) {
    const t = await tb().tomar()
    assert.equal(t!.id, b.trabajo.id)
    assert.equal(t!.cortes, i, 'cada vez que se le vence el préstamo a otro, suma un corte')
    await vencer(b.trabajo.id)
  }
  await corrida()
  const f = await fila(b.trabajo.id)
  assert.equal(f.estado, 'fallado')
  assert.match(f.motivo, /Se cortó tres veces/)
  assert.equal(falso.pedidos, 1, 'no se gasta más en un trabajo que se corta siempre (solo el del primero)')
})

// ───────────────────────── T12 a T14: errores y direcciones ─────────────────────────

test('T12 · 429 con espera y sobrecarga: reintenta y termina «hecho»', async () => {
  const a = await agente({})
  const x = await pedir(a, { guion: 'error-429' })
  await corrida()
  let f = await fila(x.trabajo.id)
  assert.equal(f.estado, 'en_cola', 'volvió a la cola con la espera que pidió el proveedor')
  assert.equal(f.reintentos, 1)
  assert.equal((await ia().trabajos({ vivos: true })).find((t) => t.id === x.trabajo.id)!.haciendo, 'Esperando al proveedor…')
  for (let i = 0; i < 6 && (await estadoDe(x.trabajo.id)) !== 'hecho'; i++) {
    await adelantar(x.trabajo.id)
    await corrida()
  }
  assert.equal(await estadoDe(x.trabajo.id), 'hecho')

  const y = await pedir(a, { guion: 'error-sobrecarga', texto: '@claude con sobrecarga' })
  await corrida()
  f = await fila(y.trabajo.id)
  assert.equal(f.estado, 'en_cola')
  const espera = new Date(f.proximo_en).getTime() - Date.now()
  assert.ok(espera > 3_000 && espera <= 5_500, `a los 5 s (${espera} ms)`)
  for (let i = 0; i < 6 && (await estadoDe(y.trabajo.id)) !== 'hecho'; i++) {
    await adelantar(y.trabajo.id)
    await corrida()
  }
  assert.equal(await estadoDe(y.trabajo.id), 'hecho')
  assert.equal((await fila(y.trabajo.id)).reintentos, 0, 'un pedido que sale bien pone los reintentos en cero')
})

test('una sobrecarga que no se arregla espera 5, 20 y 60 s y después falla, con el texto para la persona', async () => {
  const a = await agente({})
  const x = await pedir(a, { guion: 'error-sobrecarga-siempre' })
  const esperas: number[] = []
  for (let i = 0; i < 6 && (await estadoDe(x.trabajo.id)) !== 'fallado'; i++) {
    await adelantar(x.trabajo.id)
    await corrida()
    const f = await fila(x.trabajo.id)
    if (f.estado === 'en_cola') esperas.push(Math.round((new Date(f.proximo_en).getTime() - Date.now()) / 1000))
  }
  const f = await fila(x.trabajo.id)
  assert.equal(f.estado, 'fallado')
  assert.equal(f.motivo, 'El proveedor no responde. Probá de nuevo en un rato.')
  assert.equal(falso.pedidos, 4, 'el pedido y tres reintentos')
  assert.deepEqual(esperas.map((n) => Math.ceil(n / 5) * 5), [5, 20, 60])
  // «Reintentar» lo vuelve a la cola
  assert.equal((await ia().reanudar(e.persona, x.trabajo.id)).estado, 'en_cola')
})

test('T13 · clave rechazada: fallado, la clave pasa a «invalida» y avisa con error_ia', async () => {
  const a = await agente({})
  const x = await pedir(a, { guion: 'error-clave' })
  await corrida()
  const f = await fila(x.trabajo.id)
  assert.equal(f.estado, 'fallado')
  assert.match(f.motivo, /La clave de prueba no anda/)
  const [k] = await e.db.consulta(`select estado, error from ia_claves where id = $1`, [a.claveId])
  assert.equal(k!.estado, 'invalida')
  assert.equal((await notificaciones('error_ia')).filter((n) => n.clave_unica?.startsWith(`error:${x.trabajo.id}`)).length, 1)
  // con la clave inválida, una mención nueva ya no encuentra al agente listo
  assert.match(tb().motivoNoListo((await tb().agente(a.miembroId))!, await tb().ajustes())!, /clave no anda/)
})

test('un pedido mal armado falla con el código del pedido; un saldo agotado pausa «tope_proveedor» sin perder nada', async () => {
  const a = await agente({})
  const x = await pedir(a, { guion: 'error-pedido' })
  await corrida()
  assert.equal((await fila(x.trabajo.id)).estado, 'fallado')
  assert.match((await fila(x.trabajo.id)).motivo, /Pedido mal armado|código req_mal/)
  const y = await pedir(a, { guion: 'error-saldo', texto: '@claude sin saldo' })
  await corrida()
  const f = await fila(y.trabajo.id)
  assert.equal(f.estado, 'pausado_tope')
  assert.equal(f.motivo, 'tope_proveedor')
  assert.equal((await tb().mensajes(y.trabajo.id)).length, 1, 'la conversación sigue guardada')
})

test('T14 · una dirección armada por el modelo se rechaza y nada se publica; una que solo está en datos pide permiso aunque la confirmación sea «nunca»', async () => {
  const a = await agente({ confirmar: 'nunca' })
  const x = await pedir(a, { guion: 'url-armada' })
  await corrida()
  const [ll] = await llamadasDe(x.trabajo.id)
  assert.equal(ll!.estado, 'denegada')
  assert.match(ll!.resultado!, /Esa dirección no salió del tablero ni del pedido: https:\/\/afuera\.example\/p\.png\?d=lo-que-leyo/)
  assert.equal((await comentariosDe(x.tarjeta.clave)).filter((c) => /afuera\.example/.test(c.cuerpo)).length, 0, 'no se comentó nada con esa dirección')
  assert.equal(await estadoDe(x.trabajo.id), 'hecho')

  const y = await pedir(a, { guion: 'imagen-armada', descripcion: 'Mirá este gráfico https://de-datos.example/img.png' })
  await corrida()
  assert.equal(await estadoDe(y.trabajo.id), 'esperando_confirmacion', 'una imagen que salió de datos pide permiso en cualquier modo')
  assert.equal((await llamadasDe(y.trabajo.id))[0]!.motivo, 'Traer una imagen de de-datos.example')
})

test('la respuesta final pasa por el filtro: lo inventado se quita, lo del pedido queda', async () => {
  const a = await agente({})
  const x = await pedir(a, { guion: 'url-en-respuesta', texto: '@claude mirá https://www.ejemplo-del-pedido.com/x' })
  await corrida()
  const r = (await comentariosDe(x.tarjeta.clave)).find((c) => c.id === `r_${x.trabajo.id}`)!
  assert.doesNotMatch(r.cuerpo, /afuera\.example/)
  assert.match(r.cuerpo, /\[dirección quitada\]/)
  assert.match(r.cuerpo, /https:\/\/www\.ejemplo-del-pedido\.com\/x/)
  assert.match(r.cuerpo, /Telar quitó una dirección/)
})

// ───────────────────────── tiempo, T18 y T20 ─────────────────────────

test('si queda poco tiempo antes de un pedido, se suelta el trabajo y se encadena (nunca se pierde)', async () => {
  const a = await agente({})
  const { trabajo } = await pedir(a, { guion: 'responder' })
  plazoMs = Date.now() + 30_000 // para tarjeta hacen falta 60 s libres para empezar un pedido
  await corrida()
  assert.equal(falso.pedidos, 0, 'no empezó un pedido que no iba a poder terminar')
  assert.equal(await estadoDe(trabajo.id), 'en_cola')
  assert.deepEqual(encadenados, ['dueno'], 'le pidió a otra ejecución que siga')
  plazoMs = Number.POSITIVE_INFINITY
  await corrida()
  assert.equal(await estadoDe(trabajo.id), 'hecho')
  assert.equal(falso.pedidos, 1)
})

test('T18 · otra cuenta no ve ni frena ni confirma ni reanuda un trabajo ajeno: 404 con el mismo mensaje', async () => {
  const a = await agente({ permisos: ['comentar', 'tarjetas', 'lienzo', 'archivar'] })
  const { trabajo } = await pedir(a, { guion: 'archivar' })
  await corrida()
  const b = iaDe(e.raiz.de('otra'))
  const persona = { actor: { tipo: 'humano' as const, id: 'otro', nombre: 'Otra' }, via: 'sesion' as const }
  const ll = (await llamadasDe(trabajo.id))[0]!
  const inexistente = await b.trabajo('tr_no_existe').catch((x) => x)
  for (const intento of [() => b.trabajo(trabajo.id), () => b.cancelar(persona, trabajo.id), () => b.confirmar(persona, trabajo.id, [{ llamadaId: ll.id, permitir: true }]), () => b.reanudar(persona, trabajo.id)]) {
    const x = await intento().catch((err) => err)
    assert.equal(x.estado, 404)
    assert.equal(x.message, inexistente.message, 'el mismo mensaje que un id que no existe')
  }
  assert.deepEqual(await b.trabajos(), [], 'no lista nada de la otra cuenta')
  assert.equal(await b.hayVencidos(), false)
  assert.equal((await e.db.consulta(`select estado from ia_llamadas where id = $1`, [ll.id]))[0]!.estado, 'esperando', 'nada cambió')
  await ia().cancelar(e.persona, trabajo.id)
})

test('T20 · dos corridas a la vez en la misma cuenta: cada trabajo se toma y se corre una sola vez', async () => {
  const a = await agente({})
  const b = await crearAgente(e, { nombre: 'GPT' })
  await ponerGuion(e, b.miembroId, 'responder')
  const x = await pedir(a, { guion: 'responder', texto: '@claude uno' })
  const y = await pedir(b, { texto: '@gpt dos' })
  const z = await pedir(a, { texto: '@claude tres' })
  await Promise.all([corrida(), corrida()])
  await corrida()
  const estados = await Promise.all([x, y, z].map((t) => estadoDe(t.trabajo.id)))
  assert.deepEqual(estados, ['hecho', 'hecho', 'hecho'])
  assert.equal(falso.pedidos, 3, 'un pedido por trabajo: ninguno se corrió dos veces')
  for (const t of [x, y, z]) assert.equal((await comentariosDe(t.tarjeta.clave)).filter((c) => c.trabajo_id === t.trabajo.id).length, 1)
})

test('«uno por agente»: dos trabajos del mismo agente salen en orden, no a la vez', async () => {
  const a = await agente({})
  const x = await pedir(a, { guion: 'responder', texto: '@claude primero' })
  const y = await pedir(a, { texto: '@claude segundo' })
  const tomado = await tb().tomar()
  assert.equal(tomado!.id, x.trabajo.id)
  assert.equal(await tb().tomar(), null, 'el mismo agente ya tiene uno en curso')
  await tb().soltar(tomado!)
  await corrida()
  assert.equal(await estadoDe(x.trabajo.id), 'hecho')
  assert.equal(await estadoDe(y.trabajo.id), 'hecho')
})

// ───────────────────────── código, secretos y cobertura de lo guardado ─────────────────────────

test('código de verdad: el ciclo usa prepararCodigo y ejecutarCodigo de codigo.ts contra un GitHub de mentira (solo con la capacidad), y los 12 llamados por trabajo los corta codigo.ts', async () => {
  const github = await levantarGithubFalso({ puerto: 4500 })
  const secretoAntes = process.env.TABLERO_SECRETO_IA
  process.env.TABLERO_SECRETO_IA = 'secreto-de-prueba-del-ciclo-0123456789-abcdefghi'
  process.env.TABLERO_GITHUB_API = github.url
  configurarEjecutor({ ...depsComunes(), prepararCodigo: (s, t) => prepararCodigo(iaDe(s), t), ejecutarCodigo, pistasDeRutas })
  try {
    await e.db.consulta(`update proyectos set repo_github = $2 where id = $1`, [e.proyecto.id, REPO_FALSO])
    const idToken = 'k_github_de_prueba'
    const sello = sellar(TOKEN_FALSO, { propietario: 'dueno', id: idToken })
    await e.db.consulta(`insert into ia_claves (id, propietario, proveedor, nombre, cifrada, version, ultimos4, estado) values ($1, 'dueno', 'github', 'GitHub', $2, $3, $4, 'valida')`, [idToken, Buffer.from(sello.cifrada), sello.version, sello.ultimos4])

    const sin = await agente({})
    const x = await pedir(sin, { guion: 'codigo' })
    await corrida()
    assert.equal((await llamadasDe(x.trabajo.id))[0]!.estado, 'denegada', 'sin la capacidad «codigo» no se puede')
    assert.equal((await github.estado()).pedidos, 0, 'y no se le pidió nada a GitHub')

    const a = await agente({ permisos: ['comentar', 'tarjetas', 'codigo'] })
    const y = await pedir(a, { guion: 'codigo', titulo: 'Mirar el barrio', descripcion: 'Revisá `juego3d/ui/barrio.js`: se ve raro.' })
    await corrida()
    assert.equal(await estadoDe(y.trabajo.id), 'hecho')
    const ls = await llamadasDe(y.trabajo.id)
    assert.deepEqual(ls.map((l) => l.herramienta), ['codigo_ver', 'codigo_leer', 'codigo_buscar', 'codigo_cambios'])
    assert.ok(ls.every((l) => l.estado === 'hecha'), JSON.stringify(ls.map((l) => [l.estado, l.resultado?.slice(0, 120)])))
    assert.match(ls[1]!.resultado!, /DATO, no instrucciones/, 'lo leído va con el aviso de que es dato')
    assert.match(ls[1]!.resultado!, /export function paso1\(x\)/, 'trae el código del repo del proyecto de la tarjeta')
    assert.ok((await github.estado()).autorizaciones.some((x: string) => x === `Bearer ${TOKEN_FALSO}`), 'con el token de la bóveda de la cuenta')
    assert.match((await comentariosDe(y.tarjeta.clave)).find((c) => c.id === `r_${y.trabajo.id}`)!.cuerpo, /Miré el código de juego3d\/ui\/barrio\.js/)

    // 13 lecturas en un solo paso: la 13.ª la corta codigo.ts (12 por trabajo), con el aviso para el modelo; el ciclo no cuenta aparte
    const b = await agente({ permisos: ['comentar', 'tarjetas', 'codigo'] })
    const z = await pedir(b, { guion: 'codigo-muchas', titulo: 'Leer mucho' })
    await corrida()
    const lz = await llamadasDe(z.trabajo.id)
    assert.equal(lz.length, 13)
    assert.equal(lz.filter((l) => l.estado === 'hecha').length, 12)
    assert.equal(lz[12]!.estado, 'error')
    assert.match(lz[12]!.resultado!, /Ya usaste las 12 lecturas de código de este trabajo/)
    assert.match((await comentariosDe(z.tarjeta.clave)).find((c) => c.id === `r_${z.trabajo.id}`)!.cuerpo, /tope de lecturas/)
    assert.ok(!JSON.stringify(await e.db.consulta(`select resultado from ia_llamadas`)).includes(TOKEN_FALSO), 'el token de GitHub no quedó en el libro')
  } finally {
    configurarEjecutor(depsComunes())
    delete process.env.TABLERO_GITHUB_API
    if (secretoAntes === undefined) delete process.env.TABLERO_SECRETO_IA
    else process.env.TABLERO_SECRETO_IA = secretoAntes
    await github.cerrar()
  }
})

test('ninguna clave, ni la que abre la bóveda, queda en una respuesta, un evento, una fila ni un registro', async () => {
  const a = await agente({})
  const x = await pedir(a, { guion: 'responder' })
  await corrida()
  const y = await pedir(a, { guion: 'error-clave', texto: '@claude con la clave mala' })
  await corrida()
  const tablas = ['ia_trabajos', 'ia_mensajes', 'ia_llamadas', 'ia_uso', 'ia_uso_mes', 'ia_claves', 'comentarios', 'notificaciones', 'actividad', 'menciones']
  for (const t of tablas) {
    const filas = await e.db.consulta(`select row_to_json(x)::text as fila from ${t} x`)
    assert.ok(!filas.some((f) => String(f.fila).includes(CLAVE_SECRETA)), `la clave apareció en ${t}`)
  }
  assert.ok(!JSON.stringify(e.eventos).includes(CLAVE_SECRETA), 'ni en los eventos')
  assert.ok(!salidaDelServidor.join('\n').includes(CLAVE_SECRETA), 'ni en los registros del servidor')
  assert.ok(!JSON.stringify(falso.vistos.map((v) => ({ ...v, clave: '' }))).includes(CLAVE_SECRETA), 'ni en nada de lo que se le manda al modelo')
  assert.ok(falso.vistos.every((v) => v.clave === CLAVE_SECRETA), 'al proveedor sí le llega, solo en el campo `clave`')
  void x
  void y
})

test('sinClaves tapa lo que tiene forma de clave y la clave exacta', () => {
  assert.equal(sinClaves('falló con sk-ant-api03-abcdefgh12345678 y Bearer abcdefghijklmnop1234', []), 'falló con [clave] y Bearer [clave]')
  assert.equal(sinClaves('la mía es prueba-clave-super-secreta-12345!', ['prueba-clave-super-secreta-12345']), 'la mía es [clave]!')
})

test('un resultado muy largo se corta a 40.000 caracteres, con el aviso; un error de la herramienta vuelve al modelo (no es un error del trabajo)', async () => {
  const a = await agente({})
  const ag = (await tb().agente(a.miembroId))!
  const { trabajo } = await pedir(a, { guion: 'responder' })
  const t = await tb().propio(trabajo.id)
  const ejec = ejecutorAgente(e.s, ag, t)
  const err = await ejec({ id: 'c1', nombre: 'leer_tarjeta', argumentos: { tarjeta: 'NO-99' } }, {})
  assert.equal(err.estado, 'error')
  assert.match(err.resultado.partes[0]!.tipo === 'texto' ? err.resultado.partes[0]!.texto : '', /No encontré la tarjeta/)
  const invalida = await ejec({ id: 'c2', nombre: 'leer_tarjeta', argumentos: { tarjeta: 'PR-1', inventado: 1 } }, {})
  assert.equal(invalida.estado, 'error')
  assert.match(invalida.resultado.partes[0]!.tipo === 'texto' ? invalida.resultado.partes[0]!.texto : '', /Datos inválidos/)
  const rota = await ejec({ id: 'c3', nombre: 'leer_tarjeta', argumentos: null, invalida: 'JSON cortado' }, {})
  assert.equal(rota.estado, 'error')
  const nueva = await ejec({ id: 'c4', nombre: 'no_existe', argumentos: {} }, {})
  assert.match(nueva.resultado.partes[0]!.tipo === 'texto' ? nueva.resultado.partes[0]!.texto : '', /No existe la herramienta «no_existe»/)
  const fuera = await ejec({ id: 'c5', nombre: 'armar_en_lienzo', argumentos: { objetos: [{ tipo: 'nota', texto: 'x' }] } }, {})
  assert.match(fuera.resultado.partes[0]!.tipo === 'texto' ? fuera.resultado.partes[0]!.texto : '', /no está disponible en este lugar/)
  await e.s.crearTarjeta(e.persona, { tableroId: e.tableroId, titulo: 'Larga', descripcion: 'x'.repeat(50_000) })
  const larga = await ejec({ id: 'c6', nombre: 'leer_tablero', argumentos: { incluir_hechas: true } }, {})
  const texto = larga.resultado.partes[0]!.tipo === 'texto' ? larga.resultado.partes[0]!.texto : ''
  assert.ok(texto.length <= 40_000 + 100)
})

test('el barrido del cron corre lo vencido de las cuentas y hace el mantenimiento: lo fijo y el JSON exacto se vacían a los 7 días', async () => {
  const a = await agente({})
  const x = await pedir(a, { guion: 'responder' })
  const informe0 = await barrer(e.raiz)
  assert.equal(informe0.cuentas, 1)
  assert.equal(await estadoDe(x.trabajo.id), 'hecho')
  await e.db.consulta(`update ia_trabajos set terminado_en = now() - interval '8 days' where id = $1`, [x.trabajo.id])
  const informe = await barrer(e.raiz)
  assert.ok(informe.limpiados >= 1)
  const f = await fila(x.trabajo.id)
  assert.equal(f.fijo, null)
  assert.ok((await tb().mensajes(x.trabajo.id)).every((m) => m.nativo === null))
  // y lo que esperaba permiso más de 7 días se cancela
  const y = await pedir(await agente({ permisos: ['comentar', 'archivar'] }), { guion: 'archivar' })
  await corrida()
  assert.equal(await estadoDe(y.trabajo.id), 'esperando_confirmacion')
  await e.db.consulta(`update ia_trabajos set actualizado_en = now() - interval '8 days' where id = $1`, [y.trabajo.id])
  await barrer(e.raiz)
  assert.equal(await estadoDe(y.trabajo.id), 'cancelado')
})

test('el trabajo ve el avance: eventos «trabajo» con la frase de lo que hace, sin contenido del pedido', async () => {
  const a = await agente({})
  const { trabajo } = await pedir(a, { guion: 'leer-y-responder' })
  e.eventos.length = 0
  await corrida()
  const pasos = e.eventos.filter((x) => x.tipo === 'trabajo' && x.accion === 'paso').map((x) => (x.datos as { haciendo: string | null }).haciendo)
  assert.ok(pasos.some((h) => h?.startsWith('Leyendo PR-')), `frases: ${pasos.join(' | ')}`)
  assert.ok(pasos.includes('Escribiendo la respuesta…'))
  void (trabajo as AgenteInterno | TrabajoInterno)
})
