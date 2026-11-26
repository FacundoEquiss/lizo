// Pruebas de las menciones a un agente de adentro (tareas 2.12, 2.20 y 2.21 del plan): una mención crea UN trabajo que contesta solo; si el
// agente no está listo, queda pendiente con el motivo; IA con IA sin bucles; conversar sin «@»; la proactividad (`guion:triage`). Los ganchos
// del Servicio están conectados de verdad (`conectarIA`), con el proveedor falso de proveedores/falso.ts. `npm run ia:probar-menciones-ia`.
// Escenarios T1, T15, T16, T19 y T21 del plan (15.5), más M5, M6 y M9 con trabajos, y los de F.2 y F.4.
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { Actor } from '../../../compartido/tipos'
import { conectarIA } from './conectar'
import { correr, CorteSimulado } from './ejecutor'
import { olvidarAgentes } from './menciones'
import { crearAgente, crearEntorno, crearFalsoDePrueba, crearTarjeta, depsDePrueba, ponerGuion, type Entorno, type OpcionesAgente } from './prueba-base'
import { iaDe } from './servicio-ia'
import { trabajosDe } from './trabajos'

let e: Entorno
const falso = crearFalsoDePrueba()

before(async () => {
  e = await crearEntorno()
  conectarIA(e.raiz, {
    red: false,
    deps: depsDePrueba(falso, { esperar: async () => {}, punto: () => {} }),
  })
})
after(async () => {
  conectarIA(e.raiz, { red: false, deps: null })
  await e.cerrar()
})
beforeEach(async () => {
  falso.reiniciar()
  olvidarAgentes()
  await e.db.consulta(`update ia_trabajos set estado = 'cancelado', terminado_en = now(), tomado_hasta = null where estado in ('en_cola', 'en_curso', 'esperando_confirmacion', 'pausado_tope')`)
  await e.db.consulta(`update ia_trabajos set creado_en = now() - interval '2 days' where creado_en > now() - interval '1 day'`)
  await e.db.consulta(`delete from ia_uso_mes`)
  await e.db.consulta(`delete from ia_ajustes`)
  await e.db.consulta(`delete from ia_agentes`)
})

const ia = () => iaDe(e.s)
const tb = () => trabajosDe(ia())
const corrida = () => correr(e.raiz, 'dueno')
const agente = (o: OpcionesAgente & { guion?: string } = {}) => crearAgente(e, { modelo: `guion:${o.guion ?? 'responder'}`, ...o })
const persona = (id = e.persona.actor.id): Actor => ({ tipo: 'humano', id, nombre: 'Facundo' })
const conClave = { get actor() { return persona() }, via: 'clave' as const }
const comentarios = (clave: string) => e.db.consulta<{ id: string; cuerpo: string; autor: Actor; respuesta_a: string | null; trabajo_id: string | null }>(`select c.* from comentarios c join tarjetas t on t.id = c.tarjeta_id where t.clave = $1 order by c.creado_en, c.id`, [clave])
const trabajosDeTarjeta = (clave: string) => e.db.consulta(`select * from ia_trabajos where contexto->>'tarjetaClave' = $1 order by creado_en, id`, [clave])
const estadoDe = async (id: string) => (await e.db.consulta(`select estado from ia_trabajos where id = $1`, [id]))[0]!.estado as string
const mencion = async (id: string) => (await e.db.consulta(`select * from menciones where id = $1`, [id]))[0]!

// ───────────────────────── T1: de la mención a la respuesta ─────────────────────────

test('T1 · una mención a un agente listo crea UN trabajo (en el mismo guardado) y contesta solo, ahí mismo', async () => {
  const a = await agente()
  const t = await crearTarjeta(e, 'Pregunta del dueño')
  const c = await e.s.comentar(e.persona, t.clave, 'Che @claude, ¿esto ya está? @claude respondeme corto')
  assert.equal(c.trabajos?.length, 1, 'el comentario vuelve con su trabajo: «Claude está pensando…»')
  assert.equal(c.trabajos![0]!.estado, 'en_cola')
  assert.equal(c.trabajos![0]!.agenteNombre, 'Claude')
  assert.equal(c.menciones?.length, 2, 'dos menciones escritas, un solo trabajo')
  assert.equal(c.aviso, undefined)
  assert.equal((await trabajosDeTarjeta(t.clave)).length, 1)
  assert.equal(c.menciones!.every((m) => m.estado === 'pendiente' && m.motivo === null), true)
  await corrida()
  const cs = await comentarios(t.clave)
  const r = cs.find((x) => x.trabajo_id === c.trabajos![0]!.id)!
  assert.equal(r.id, `r_${c.trabajos![0]!.id}`)
  assert.equal(r.respuesta_a, c.id)
  assert.equal(r.autor.id, a.miembroId)
  const ms = await e.db.consulta(`select estado from menciones where origen_id = $1`, [c.id])
  assert.deepEqual(ms.map((m) => m.estado), ['atendida', 'atendida'], 'las dos quedan atendidas con la misma respuesta')
  const noti = await e.db.consulta(`select * from notificaciones where tipo = 'respuesta' and para_id = $1`, [e.yoId])
  assert.equal(noti.length, 1, 'una sola notificación «respondió»')
})

test('guardar de nuevo el mismo texto, o corregir un typo, no crea otro trabajo; agregar otra mención sí', async () => {
  await agente()
  const g = await agente({ nombre: 'GPT', guion: 'responder' })
  const t = await crearTarjeta(e, 'Editar')
  const c = await e.s.comentar(e.persona, t.clave, '@claude mirá esto')
  assert.equal((await e.s.editarComentario(e.persona, c.id, '@claude mirá esto, por favor')).trabajos?.length ?? 0, 0)
  assert.equal((await e.s.editarComentario(e.persona, c.id, '@claude mirá esto, porfa')).trabajos?.length ?? 0, 0)
  assert.equal((await trabajosDeTarjeta(t.clave)).length, 1)
  const otra = await e.s.editarComentario(e.persona, c.id, '@claude mirá esto, porfa. @gpt vos también')
  assert.equal(otra.trabajos?.length, 1)
  assert.equal(otra.trabajos![0]!.agenteId, g.miembroId)
  assert.equal((await trabajosDeTarjeta(t.clave)).length, 2)
})

test('M5 y M6 con trabajos: sacar la mención o borrar el comentario cancela el trabajo en cola; en curso, se le pide cancelar', async () => {
  await agente()
  const t = await crearTarjeta(e, 'Retirar')
  const c1 = await e.s.comentar(e.persona, t.clave, '@claude uno')
  const tr1 = c1.trabajos![0]!
  await e.s.editarComentario(e.persona, c1.id, 'ya no hace falta')
  assert.equal(await estadoDe(tr1.id), 'cancelado')
  assert.equal((await mencion(c1.menciones![0]!.id)).estado, 'retirada')
  const c2 = await e.s.comentar(e.persona, t.clave, '@claude dos')
  await e.s.eliminarComentario(e.persona, c2.id)
  assert.equal(await estadoDe(c2.trabajos![0]!.id), 'cancelado')
  // en curso: se pide cancelar y el ciclo lo ve
  const c3 = await e.s.comentar(e.persona, t.clave, '@claude tres')
  const tomado = await tb().tomar()
  assert.equal(tomado!.id, c3.trabajos![0]!.id)
  await e.s.eliminarComentario(e.persona, c3.id)
  assert.equal((await e.db.consulta(`select cancelar from ia_trabajos where id = $1`, [tomado!.id]))[0]!.cancelar, true)
  await tb().soltar(tomado!)
  await corrida()
  assert.equal(await estadoDe(tomado!.id), 'cancelado')
  assert.equal((await comentarios(t.clave)).filter((x) => x.trabajo_id).length, 0, 'ninguna respuesta')
})

test('M9 · el porqué se guarda mientras se escribe: un solo trabajo, que arranca 15 s después del ÚLTIMO guardado', async () => {
  await agente()
  const t = await crearTarjeta(e, 'Porqué en vivo')
  const antes = Date.now()
  const r1 = await e.s.registrarPorque(e.persona, t.clave, { motivo: '@claude revisá el motivo' })
  assert.ok(r1)
  const tr = (await trabajosDeTarjeta(t.clave))
  assert.equal(tr.length, 1)
  const primero = new Date(tr[0]!.proximo_en).getTime()
  assert.ok(primero - antes > 10_000 && primero - antes < 20_000, `espera ~15 s (${primero - antes} ms)`)
  await corrida()
  assert.equal(falso.pedidos, 0, 'todavía no es la hora: se sigue escribiendo')
  await new Promise((r) => setTimeout(r, 30))
  await e.s.registrarPorque(e.persona, t.clave, { motivo: '@claude revisá el motivo, ahora más largo' })
  const dos = await trabajosDeTarjeta(t.clave)
  assert.equal(dos.length, 1, 'el segundo guardado no crea otro')
  assert.ok(new Date(dos[0]!.proximo_en).getTime() > primero, 'corrió para adelante el comienzo')
  assert.equal((await e.db.consulta(`select count(*)::int as n from menciones where tarjeta_id = $1`, [t.id]))[0]!.n, 1)
  // a la hora, corre y contesta en la tarjeta
  await e.db.consulta(`update ia_trabajos set proximo_en = now() where id = $1`, [dos[0]!.id])
  await corrida()
  assert.equal((await comentarios(t.clave)).filter((c) => c.trabajo_id).length, 1)
})

// ───────────────────────── T19: el agente no está listo ─────────────────────────

test('T19 · sin clave, apagado o con toda la IA en pausa: la mención queda pendiente con el motivo; al arreglarlo, «Reintentar» crea el trabajo', async () => {
  const sinClave = await agente({ sinClave: true })
  const t = await crearTarjeta(e, 'Sin clave')
  const c = await e.s.comentar(e.persona, t.clave, '@claude ¿estás?')
  assert.equal(c.trabajos?.length ?? 0, 0)
  assert.equal(c.menciones![0]!.estado, 'pendiente')
  assert.equal(c.menciones![0]!.motivo, 'No tiene clave.')
  assert.equal((await trabajosDeTarjeta(t.clave)).length, 0)
  // la web lo ve al abrir (novedades) con el motivo de hoy
  const nov = await ia().novedades()
  assert.equal(nov.esperando.length, 1)
  assert.equal(nov.esperando[0]!.motivo, 'No tiene clave.')
  assert.equal(nov.trabajos.length, 0)

  // el dueño le carga una clave y lo prende: ahora sí
  await crearAgente(e, { modelo: 'guion:responder' })
  olvidarAgentes()
  const mencionId = c.menciones![0]!.id
  await assert.rejects(() => ia().reintentarMencion(conClave, mencionId), (x: any) => x.estado === 403, 'con la clave del MCP no se dispara un agente')
  const r = await ia().reintentarMencion(e.persona, mencionId)
  assert.equal(r.estado, 'en_cola')
  await assert.rejects(() => ia().reintentarMencion(e.persona, mencionId), /ya tiene su trabajo/)
  await corrida()
  assert.equal((await mencion(mencionId)).estado, 'atendida')
  assert.equal((await comentarios(t.clave)).filter((x) => x.trabajo_id === r.id).length, 1)
  assert.equal((await ia().novedades()).esperando.length, 0)
  void sinClave

  // apagado
  await e.db.consulta(`update ia_agentes set activo = false`)
  const c2 = await e.s.comentar(e.persona, t.clave, '@claude otra')
  assert.equal(c2.menciones![0]!.motivo, 'Está apagado.')
  await e.db.consulta(`update ia_agentes set activo = true`)
  // toda la IA en pausa
  await e.db.consulta(`insert into ia_ajustes (propietario, pausada) values ('dueno', true) on conflict (propietario) do update set pausada = true`)
  const c3 = await e.s.comentar(e.persona, t.clave, '@claude y otra más')
  assert.equal(c3.menciones![0]!.motivo, 'Toda la IA de esta cuenta está en pausa.')
  await assert.rejects(() => ia().reintentarMencion(e.persona, c3.menciones![0]!.id), /todavía no puede responder: toda la IA/)
  // una clave rota
  await e.db.consulta(`update ia_ajustes set pausada = false`)
  await e.db.consulta(`update ia_claves set estado = 'invalida'`)
  assert.equal((await e.s.comentar(e.persona, t.clave, '@claude con la clave rota')).menciones![0]!.motivo, 'Su clave no anda.')
})

test('una IA de afuera (sin fila de agente) deja la mención pendiente, sin motivo ni trabajo: la ve con leer_pendientes', async () => {
  await e.s.asegurarMiembroIA('Codex')
  const t = await crearTarjeta(e, 'Para Codex')
  const c = await e.s.comentar(e.persona, t.clave, '@codex ¿podés mirar?')
  assert.equal(c.trabajos?.length ?? 0, 0)
  assert.equal(c.menciones![0]!.estado, 'pendiente')
  assert.equal(c.menciones![0]!.motivo, null)
  assert.equal((await ia().novedades()).esperando.length, 0, 'no es de un agente de adentro: no espera acá')
})

// ───────────────────────── T21: la clave del MCP no dispara un agente ─────────────────────────

test('T21 · un comentario que entra con la clave del MCP no dispara a un agente (queda pendiente, sin trabajo); con sesión sí', async () => {
  await agente()
  const t = await crearTarjeta(e, 'Con clave')
  const c = await e.s.comentar(conClave, t.clave, '@claude desde la clave')
  assert.equal(c.trabajos?.length ?? 0, 0)
  assert.equal(c.menciones![0]!.estado, 'pendiente')
  assert.match(c.menciones![0]!.motivo!, /Las IA de afuera no pueden pedirle cosas a tus agentes/)
  const oauth = { actor: persona(), via: 'oauth' as const }
  assert.equal((await e.s.comentar(oauth, t.clave, '@claude desde OAuth')).trabajos?.length ?? 0, 0)
  assert.equal((await trabajosDeTarjeta(t.clave)).length, 0)
  const local = { actor: persona(), via: 'local' as const }
  assert.equal((await e.s.comentar(local, t.clave, '@claude desde la computadora')).trabajos?.length, 1, 'local es una persona')
  // las IA de afuera por MCP: solo si la cuenta lo prendió
  const externa: Actor = { tipo: 'ia', id: (await e.s.asegurarMiembroIA('Codex')).id, nombre: 'Codex' }
  assert.equal((await e.s.comentar({ actor: externa }, t.clave, '@claude ayudame')).trabajos?.length ?? 0, 0)
  await e.db.consulta(`insert into ia_ajustes (propietario, externas_disparan) values ('dueno', true) on conflict (propietario) do update set externas_disparan = true`)
  const prendida = await e.s.comentar({ actor: externa }, t.clave, '@claude ahora sí, ayudame')
  assert.equal(prendida.trabajos?.length, 1)
  assert.equal((await e.db.consulta(`select profundidad from ia_trabajos where id = $1`, [prendida.trabajos![0]!.id]))[0]!.profundidad, 1)
})

// ───────────────────────── T15: IA con IA, sin bucles ─────────────────────────

test('T15 · un agente que menciona a otro: apagado no dispara nada; prendido, el segundo corre y el tercero no (profundidad 2)', async () => {
  const a = await agente({ guion: 'menciona-ia:gpt' })
  const b = await agente({ nombre: 'GPT', guion: 'menciona-ia:otro' })
  const c = await agente({ nombre: 'Otro', guion: 'responder' })
  const t = await crearTarjeta(e, 'Cadena')
  const x = await e.s.comentar(e.persona, t.clave, '@claude pedile algo a GPT')
  // apagado: la mención de Claude a GPT no dispara un trabajo nuevo
  assert.equal(x.trabajos!.length, 1, 'la persona solo mencionó a Claude')
  for (let i = 0; i < 3; i++) await corrida()
  const hijos = await e.db.consulta(`select agente_id from ia_trabajos where contexto->>'tarjetaClave' = $1 and profundidad >= 1`, [t.clave])
  assert.equal(hijos.length, 0, 'sin permiso de IA con IA, ningún trabajo hijo')
  const aGpt = await e.db.consulta(`select estado, trabajo_id from menciones where tarjeta_id = $1 and destinatario_id = $2 and autor->>'tipo' = 'ia'`, [t.id, b.miembroId])
  assert.deepEqual(aGpt.map((m) => [m.estado, m.trabajo_id]), [['pendiente', null]], 'la mención de Claude a GPT queda pendiente, sin trabajo')

  // prendido: Claude (A) → GPT (B) → Otro (C)
  await e.db.consulta(`update ia_agentes set puede_mencionar_ia = true`)
  const t2 = await crearTarjeta(e, 'Cadena prendida')
  const y = await e.s.comentar(e.persona, t2.clave, '@claude arrancá la cadena')
  assert.equal(y.trabajos!.length, 1)
  for (let i = 0; i < 4; i++) await corrida()
  const todos = await trabajosDeTarjeta(t2.clave)
  assert.deepEqual(
    todos.map((f) => [f.agente_id, f.profundidad, f.estado]),
    [
      [a.miembroId, 0, 'hecho'],
      [b.miembroId, 1, 'hecho'],
    ],
    'el segundo corre, el tercero no',
  )
  const mC = await e.db.consulta(`select estado from menciones where tarjeta_id = $1 and destinatario_id = $2`, [t2.id, c.miembroId])
  assert.equal(mC.length, 1)
  assert.equal(mC[0]!.estado, 'pendiente', 'la mención al tercero existe, sin trabajo')
  const esperandoC = (await ia().novedades()).esperando.find((m) => m.destinatarioId === c.miembroId)
  assert.match(esperandoC!.motivo!, /Ya hay dos IA encadenadas/, 'la persona ve por qué el tercero no se disparó')
  assert.equal((await e.db.consulta(`select count(*)::int as n from ia_trabajos where agente_id = $1 and contexto->>'tarjetaClave' = $2`, [c.miembroId, t2.clave]))[0]!.n, 0)
})

test('un agente no le contesta con una mención a quien se lo pidió (no es una mención nueva)', async () => {
  const a = await agente({ guion: 'menciona-ia:gpt', puedeMencionarIA: true })
  const b = await agente({ nombre: 'GPT', guion: 'menciona-ia:claude', puedeMencionarIA: true })
  const t = await crearTarjeta(e, 'Ping pong')
  await e.s.comentar(e.persona, t.clave, '@claude empezá')
  for (let i = 0; i < 5; i++) await corrida()
  const todos = await trabajosDeTarjeta(t.clave)
  assert.deepEqual(todos.map((f) => f.agente_id), [a.miembroId, b.miembroId], 'A le pide a B; B le contesta a A y eso no dispara otra vez')
})

test('IA con IA: no más de 10 por hora y nadie se dispara a sí mismo', async () => {
  const a = await agente({ guion: 'responder', puedeMencionarIA: true })
  await agente({ nombre: 'GPT', guion: 'responder', puedeMencionarIA: true })
  // diez trabajos hijos creados en la última hora
  await e.db.consulta(
    `insert into ia_trabajos (id, propietario, agente_id, origen, superficie, pedido_por, proveedor, modelo, estado, profundidad)
     select 'h' || g, 'dueno', $1, 'mencion', 'tarjeta', '{}'::jsonb, 'falso', 'guion:responder', 'hecho', 1 from generate_series(1, 10) g`,
    [a.miembroId],
  )
  const t = await crearTarjeta(e, 'Tope por hora')
  const externa: Actor = { tipo: 'ia', id: (await e.s.asegurarMiembroIA('Codex')).id, nombre: 'Codex' }
  await e.db.consulta(`insert into ia_ajustes (propietario, externas_disparan) values ('dueno', true) on conflict (propietario) do update set externas_disparan = true`)
  const c = await e.s.comentar({ actor: externa }, t.clave, '@gpt ayudame')
  assert.equal(c.trabajos?.length ?? 0, 0)
  assert.match(c.menciones![0]!.motivo!, /muchos pedidos de IA a IA/)
  // y el propio alias en un texto propio no crea nada
  const propia: Actor = { tipo: 'ia', id: a.miembroId, nombre: 'Claude' }
  assert.equal((await e.s.comentar({ actor: propia }, t.clave, 'soy @claude')).menciones?.length ?? 0, 0)
})

// ───────────────────────── T16: límites de pedidos ─────────────────────────

test('T16 · 31 menciones en una hora: la número 31 queda pendiente con el aviso', async () => {
  await agente({ topeMesUsd: 1000 })
  let ultimo: Awaited<ReturnType<typeof e.s.comentar>> | null = null
  for (let i = 1; i <= 31; i++) {
    const t = await crearTarjeta(e, `Pedido ${i}`)
    ultimo = await e.s.comentar(e.persona, t.clave, `@claude pedido ${i}`)
    if (i <= 30) assert.equal(ultimo.trabajos?.length, 1, `el ${i} se crea`)
    await corrida()
  }
  assert.equal(ultimo!.trabajos?.length ?? 0, 0)
  assert.equal(ultimo!.aviso, 'Demasiados pedidos seguidos. Esperá un rato.')
  assert.equal(ultimo!.menciones![0]!.estado, 'pendiente')
  assert.equal(ultimo!.menciones![0]!.motivo, 'Demasiados pedidos seguidos. Esperá un rato.')
  assert.equal((await e.db.consulta(`select count(*)::int as n from ia_trabajos where creado_en > now() - interval '1 hour'`))[0]!.n, 30)
})

test('no más de 20 trabajos en cola por agente', async () => {
  await agente({ topeMesUsd: 1000 })
  let rechazado = 0
  for (let i = 1; i <= 22; i++) {
    const t = await crearTarjeta(e, `En cola ${i}`)
    const c = await e.s.comentar(e.persona, t.clave, `@claude en cola ${i}`)
    if (!c.trabajos?.length) rechazado++
  }
  assert.equal(rechazado, 2)
})

// ───────────────────────── F.2: conversar sin «@» ─────────────────────────

test('F.2 · el comentario de una persona justo después de uno del agente se toma como respuesta a él: un trabajo «conversacion»', async () => {
  const a = await agente()
  const t = await crearTarjeta(e, 'Charla')
  const primero = await e.s.comentar(e.persona, t.clave, '@claude mirá esto')
  await corrida()
  const respuesta = (await comentarios(t.clave)).find((c) => c.trabajo_id === primero.trabajos![0]!.id)!
  // sin «@» ni «responder a»: sigue la charla
  const seguir = await e.s.comentar(e.persona, t.clave, 'Gracias, y ¿qué falta?')
  assert.equal(seguir.trabajos?.length, 1)
  const tr = (await trabajosDeTarjeta(t.clave)).at(-1)!
  assert.equal(tr.origen, 'conversacion')
  assert.equal(tr.clave_unica, `conv:${seguir.id}`)
  assert.equal(tr.agente_id, a.miembroId)
  assert.equal(tr.contexto.respuestaA, seguir.id)
  await corrida()
  assert.equal((await e.db.consulta(`select estado from ia_trabajos where id = $1`, [tr.id]))[0]!.estado, 'hecho')
  assert.equal((await comentarios(t.clave)).find((c) => c.id === `r_${tr.id}`)!.respuesta_a, seguir.id)
  // otro comentario seguido de la persona, antes de que el agente conteste: el anterior ya no es del agente
  const uno = await e.s.comentar(e.persona, t.clave, 'Una pregunta más')
  assert.equal(uno.trabajos?.length, 1)
  assert.equal((await e.s.comentar(e.persona, t.clave, 'Otra cosita')).trabajos?.length ?? 0, 0)
  void respuesta
})

test('F.2 · no hay conversación si menciona a otro, si responde a otro comentario, si pasaron 48 horas o si no hay agentes', async () => {
  const a = await agente()
  await agente({ nombre: 'GPT' })
  const t = await crearTarjeta(e, 'Charla 2')
  const primero = await e.s.comentar(e.persona, t.clave, '@claude hola')
  await corrida()
  // menciona a otro: es para ese otro, no para el último que habló
  const aOtro = await e.s.comentar(e.persona, t.clave, '@gpt ¿y vos?')
  assert.deepEqual(aOtro.trabajos!.map((x) => x.agenteNombre), ['GPT'])
  await corrida()
  // 48 horas: la charla venció
  const t2 = await crearTarjeta(e, 'Charla vieja')
  const m2 = await e.s.comentar(e.persona, t2.clave, '@claude hola')
  await corrida()
  await e.db.consulta(`update comentarios set creado_en = now() - interval '49 hours' where trabajo_id is not null and tarjeta_id = $1`, [t2.id])
  assert.equal((await e.s.comentar(e.persona, t2.clave, 'seguimos')).trabajos?.length ?? 0, 0)
  // la clave del MCP (no es una persona) tampoco dispara una conversación
  const t3 = await crearTarjeta(e, 'Charla con clave')
  await e.s.comentar(e.persona, t3.clave, '@claude hola')
  await corrida()
  assert.equal((await e.s.comentar(conClave, t3.clave, 'sigo desde la clave')).trabajos?.length ?? 0, 0)
  // una cuenta sin agentes: ni una consulta de más (M16 lo mide aparte) y nada se crea
  const otra = e.raiz.de('otra')
  await otra.crearMiembro({ nombre: 'Ana', esYo: true })
  const p = await otra.crearProyecto({ actor: persona() }, { nombre: 'Otra', prefijo: 'OT' })
  const tj = await otra.crearTarjeta({ actor: persona() }, { tableroId: p.tableros[0]!.id, titulo: 'x' })
  await otra.comentar({ actor: persona(), via: 'sesion' }, tj.clave, 'hola')
  assert.equal((await otra.comentar({ actor: persona(), via: 'sesion' }, tj.clave, 'chau')).trabajos?.length ?? 0, 0)
  void a
  void primero
  void m2
})

test('F.2 · una conversación con un agente que no está listo queda como mención pendiente con su motivo (no se pierde)', async () => {
  await agente()
  const t = await crearTarjeta(e, 'Charla pausada')
  await e.s.comentar(e.persona, t.clave, '@claude hola')
  await corrida()
  await e.db.consulta(`update ia_agentes set activo = false`)
  olvidarAgentes()
  const seguir = await e.s.comentar(e.persona, t.clave, 'sigo acá')
  assert.equal(seguir.trabajos?.length ?? 0, 0)
  // un agente apagado ya no es «conversacional»: no hay mención nueva
  assert.equal(seguir.menciones?.length ?? 0, 0)
})

// ───────────────────────── F.4: proactividad ─────────────────────────

const bandeja = () => e.listas['Bandeja']!

test('F.4 · tarjeta_nueva: una tarjeta que entra a la lista elegida crea UN trabajo proactivo; editarla o volver a moverla no lo repite', async () => {
  const a = await agente({ guion: 'triage', disparadores: { tarjetaNueva: { listas: [bandeja()] } } })
  olvidarAgentes()
  const sistema = { actor: { tipo: 'sistema' as const, id: 'sistema', nombre: 'Discord' } }
  const t = await e.s.crearTarjeta(sistema, { tableroId: e.tableroId, listaId: bandeja(), titulo: '¿Cómo se juega el barrio?', descripcion: 'Pregunta de Discord' })
  let trs = await trabajosDeTarjeta(t.clave)
  assert.equal(trs.length, 1)
  assert.equal(trs[0]!.origen, 'proactivo')
  assert.equal(trs[0]!.clave_unica, `proactivo:tarjeta_nueva:${t.id}:${a.miembroId}`)
  assert.equal(trs[0]!.mencion_id, null)
  await e.s.actualizarTarjeta(e.persona, t.clave, { titulo: '¿Cómo se juega el barrio? (editada)' })
  await e.s.moverTarjeta(e.persona, t.clave, { listaId: e.listas['Hecho']! })
  await e.s.moverTarjeta(e.persona, t.clave, { listaId: bandeja() })
  assert.equal((await trabajosDeTarjeta(t.clave)).length, 1, 'no se repite')
  await corrida()
  const r = (await comentarios(t.clave)).find((c) => c.trabajo_id === trs[0]!.id)!
  assert.match(r.cuerpo, /^\*\*Revisado \d{1,2}\/\d{1,2}:\*\*/)
  assert.equal(r.respuesta_a, null, 'una revisión no responde a nadie')
  const noti = await e.db.consulta(`select titulo from notificaciones where tipo = 'respuesta' and trabajo_id = $1`, [trs[0]!.id])
  assert.match(noti[0]!.titulo, /Claude revisó PR-\d+/)
  // otra lista: nada
  const otra = await e.s.crearTarjeta(sistema, { tableroId: e.tableroId, listaId: e.listas['Hecho']!, titulo: 'Ya hecha' })
  assert.equal((await trabajosDeTarjeta(otra.clave)).length, 0)
  trs = await trabajosDeTarjeta(t.clave)
})

test('F.4 · en «sugiere» el agente no mueve nada; en «actua» sí (con su capacidad); el máximo diario y el tope se respetan', async () => {
  const a = await agente({ guion: 'triage-mueve', autonomia: 'sugiere', disparadores: { tarjetaNueva: { listas: [bandeja()] } } })
  olvidarAgentes()
  const t = await e.s.crearTarjeta(e.persona, { tableroId: e.tableroId, listaId: bandeja(), titulo: 'Una para revisar' })
  await corrida()
  const [tr] = await trabajosDeTarjeta(t.clave)
  assert.equal(tr!.estado, 'hecho')
  assert.equal((await e.s.leerTarjeta(t.clave)).listaId, bandeja(), 'no la movió: solo sugiere')
  const ll = await tb().llamadas(tr!.id)
  assert.equal(ll[0]!.estado, 'denegada', 'en «sugiere» no puede cambiar nada')
  assert.match(ll[0]!.resultado!, /solo podés comentar y avisar/)
  assert.match((await comentarios(t.clave)).find((c) => c.trabajo_id === tr!.id)!.cuerpo, /No moví nada/)
  // actua: mueve
  await agente({ guion: 'triage-mueve', autonomia: 'actua', disparadores: { tarjetaNueva: { listas: [bandeja()] } }, confirmar: 'nunca' })
  olvidarAgentes()
  const t2 = await e.s.crearTarjeta(e.persona, { tableroId: e.tableroId, listaId: bandeja(), titulo: 'Otra para revisar' })
  await corrida()
  assert.equal((await e.s.leerTarjeta(t2.clave)).listaId, e.listas['Hecho'], 'con «actua» la mueve')
  // máximo diario
  await agente({ guion: 'triage', disparadores: { tarjetaNueva: { listas: [bandeja()] }, maxPorDia: 2 } })
  olvidarAgentes()
  await e.db.consulta(`update ia_trabajos set creado_en = now() - interval '2 days'`)
  const creadas = []
  for (let i = 0; i < 4; i++) creadas.push(await e.s.crearTarjeta(e.persona, { tableroId: e.tableroId, listaId: bandeja(), titulo: `Tanda ${i}` }))
  const hoy = await e.db.consulta(`select 1 from ia_trabajos where origen = 'proactivo' and creado_en > now() - interval '1 hour'`)
  assert.equal(hoy.length, 2, 'el máximo diario corta en 2')
  void a
})

test('F.4 · lo que crea un trabajo no dispara otro; un agente sin clave no revisa; sin disparadores no pasa nada', async () => {
  await agente({ guion: 'crear', disparadores: { tarjetaNueva: { listas: [bandeja()] } }, permisos: ['comentar', 'tarjetas'], confirmar: 'nunca' })
  olvidarAgentes()
  const antes = (await e.db.consulta(`select count(*)::int as n from ia_trabajos`))[0]!.n
  // una tarjeta creada dentro de una tanda (un trabajo) no dispara la revisión de otro
  const { conTanda, efectosVacios } = await import('../dominio/tanda')
  await conTanda({ id: 'tr_x', llamadaId: null, efectos: efectosVacios() }, () => e.s.crearTarjeta(e.persona, { tableroId: e.tableroId, listaId: bandeja(), titulo: 'Hija de un trabajo' }))
  assert.equal((await e.db.consulta(`select count(*)::int as n from ia_trabajos`))[0]!.n, antes)
  await e.db.consulta(`delete from ia_agentes`)
  await agente({ sinClave: true, disparadores: { tarjetaNueva: { listas: [bandeja()] } } })
  olvidarAgentes()
  const t = await e.s.crearTarjeta(e.persona, { tableroId: e.tableroId, listaId: bandeja(), titulo: 'Sin clave' })
  assert.equal((await trabajosDeTarjeta(t.clave)).length, 0)
  await e.db.consulta(`delete from ia_agentes`)
  await agente({})
  olvidarAgentes()
  const u = await e.s.crearTarjeta(e.persona, { tableroId: e.tableroId, listaId: bandeja(), titulo: 'Sin disparadores' })
  assert.equal((await trabajosDeTarjeta(u.clave)).length, 0)
})

test('F.4 · resumen_diario: un trabajo por agente y por día; llega como notificación', async () => {
  await agente({ guion: 'resumen', disparadores: { resumenDiario: { tableroId: null } } })
  olvidarAgentes()
  const creados = await ia().resumenDiario()
  assert.equal(creados.length, 1)
  assert.equal(creados[0]!.superficie, 'kanban')
  assert.equal((await ia().resumenDiario()).length, 0, 'uno por día')
  await corrida()
  const [tr] = await e.db.consulta(`select * from ia_trabajos where id = $1`, [creados[0]!.id])
  assert.equal(tr!.estado, 'hecho')
  assert.equal(tr!.resultado.texto, 'Resumen del día: nada trabado.')
  const noti = await e.db.consulta(`select * from notificaciones where trabajo_id = $1`, [creados[0]!.id])
  assert.equal(noti.length, 1)
  assert.match(noti[0]!.titulo, /Claude revisó el tablero|revisó/)
  // el tablero elegido tiene que ser de la cuenta
  await e.db.consulta(`delete from ia_agentes`)
  await agente({ guion: 'resumen', disparadores: { resumenDiario: { tableroId: 'tablero-ajeno' } } })
  olvidarAgentes()
  await e.db.consulta(`update ia_trabajos set creado_en = now() - interval '2 days', clave_unica = null`)
  assert.equal((await ia().resumenDiario()).length, 0)
  void CorteSimulado
})
