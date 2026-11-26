// Prueba de la migración de la F2 (supabase/migrations/20261206090000_ia.sql) en PGlite en memoria, con el mismo mecanismo que
// usa el servidor (datos/migraciones.ts): arranca en limpio, corre dos veces sin error, corre sobre una base con las migraciones
// anteriores y con datos, todas las tablas nuevas tienen seguridad por fila y `propietario`, y la consulta de tomar un trabajo
// (plan 6.3) respeta «uno por agente», «dos por cuenta» y el préstamo vencido. `npm run ia:probar-migracion`. Sin red ni disco.
//
// Lo que no prueba: la carrera de dos procesos a la vez (PGlite tiene una sola conexión; eso se prueba en la F2 contra un
// Postgres descartable, si el entorno tiene uno) y aplicarla online como `tablero_app` (se verifica al publicar).
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { Conexion } from '../datos/conexion'
import { migrar } from '../datos/migraciones'
import { abrirPgliteEnMemoria } from '../datos/pglite'

const CARPETA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations')
const NOMBRE = '20261206090000_ia.sql'
const SQL = readFileSync(path.join(CARPETA, NOMBRE), 'utf8')
const TABLAS = ['ia_claves', 'ia_agentes', 'ia_ajustes', 'ia_trabajos', 'ia_mensajes', 'ia_llamadas', 'ia_uso', 'ia_uso_mes']

const temporales: string[] = []
after(() => temporales.forEach((t) => rmSync(t, { recursive: true, force: true })))

/** Una base nueva con todas las migraciones (las anteriores y la de la F2). */
async function baseCompleta(): Promise<Conexion> {
  const db = await abrirPgliteEnMemoria()
  await migrar(db, CARPETA)
  return db
}

/** El SQL sin comentarios, para mirar lo que de verdad ejecuta. */
const sinComentarios = SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

/** Falla con este código de Postgres (23505 = clave repetida, 23514 = no cumple un check, 23503 = id que no existe). */
async function falla(codigo: string, fn: () => Promise<unknown>) {
  await assert.rejects(fn, (e: any) => e?.code === codigo, `tenía que fallar con ${codigo}`)
}

async function miembro(db: Conexion, id: string, propietario = 'dueno') {
  await db.consulta(`insert into miembros (id, nombre, tipo, propietario) values ($1, $1, 'ia', $2)`, [id, propietario])
}

async function trabajo(db: Conexion, id: string, o: { agente: string; propietario?: string; proximo?: string; estado?: string; mencion?: string | null; unica?: string | null }) {
  await db.consulta(
    `insert into ia_trabajos (id, propietario, agente_id, origen, mencion_id, clave_unica, superficie, pedido_por, proveedor, modelo, estado, proximo_en)
     values ($1, $2, $3, 'mencion', $4, $5, 'tarjeta', '{"tipo":"humano","id":"yo","nombre":"Yo"}'::jsonb, 'falso', 'falso-1', $6, now() + ($7 || ' seconds')::interval)`,
    [id, o.propietario ?? 'dueno', o.agente, o.mencion ?? null, o.unica ?? null, o.estado ?? 'en_cola', o.proximo ?? '-10'],
  )
}

test('la migración no nombra el esquema, no borra nada y es aditiva', () => {
  assert.doesNotMatch(sinComentarios, /\btablero\b/i, 'no puede nombrar el esquema `tablero`')
  assert.doesNotMatch(sinComentarios, /\b(create\s+schema|set\s+search_path|drop|truncate|delete\s+from|grant|revoke)\b/i)
  assert.doesNotMatch(sinComentarios, /\balter\s+table\s+\w+\s+(drop|rename|alter)\b/i)
  // Toda sentencia es repetible: tablas e índices con `if not exists`, columnas con `add column if not exists`.
  assert.doesNotMatch(sinComentarios, /create\s+(unique\s+)?index\s+(?!if not exists)/i)
  assert.doesNotMatch(sinComentarios, /create\s+table\s+(?!if not exists)/i)
  assert.doesNotMatch(sinComentarios, /add\s+column\s+(?!if not exists)/i)
})

test('arranca en limpio: las tablas existen, con seguridad por fila y con `propietario`', async () => {
  const db = await baseCompleta()
  for (const t of TABLAS) {
    const [f] = await db.consulta<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where relname = $1 and relkind = 'r' and relnamespace = (select oid from pg_namespace where nspname = current_schema())`, [t])
    assert.ok(f, `falta la tabla ${t}`)
    assert.equal(f.rls, true, `${t} tiene que tener seguridad por fila`)
    const [p] = await db.consulta<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = 'propietario'`, [t])
    assert.equal(p!.n, 1, `${t} tiene que tener propietario`)
  }
  const [a] = await db.consulta<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_schema = current_schema() and table_name = 'actividad' and column_name = 'tanda'`)
  assert.equal(a!.n, 1, 'falta actividad.tanda')
  const [m] = await db.consulta<{ n: number }>(`select count(*)::int as n from tablero_migraciones where nombre = $1`, [NOMBRE])
  assert.equal(m!.n, 1, 'la migración tiene que quedar anotada')
  await db.cerrar()
})

test('corre dos veces sin error y sin cambiar nada', async () => {
  const db = await baseCompleta()
  await miembro(db, 'a1')
  await db.consulta(`insert into ia_agentes (miembro_id) values ('a1')`)
  const antes = await db.consulta(`select * from ia_agentes`)
  // El SQL tal cual, otra vez (como si alguien lo aplicara a mano online dos veces)…
  await db.ejecutar(SQL)
  await db.ejecutar(SQL)
  // …y el mecanismo del servidor: ya está anotada, no la vuelve a correr.
  await migrar(db, CARPETA)
  assert.deepEqual(await db.consulta(`select * from ia_agentes`), antes)
  const [n] = await db.consulta<{ n: number }>(`select count(*)::int as n from tablero_migraciones where nombre = $1`, [NOMBRE])
  assert.equal(n!.n, 1)
  await db.cerrar()
})

test('corre sobre una base con las migraciones anteriores y con datos, y no los toca', async () => {
  const anteriores = mkdtempSync(path.join(tmpdir(), 'telar-mig-'))
  temporales.push(anteriores)
  for (const n of readdirSync(CARPETA).filter((x) => x.endsWith('.sql') && x < NOMBRE)) cpSync(path.join(CARPETA, n), path.join(anteriores, n))
  const db = await abrirPgliteEnMemoria()
  await migrar(db, anteriores)
  const [antes] = await db.consulta<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname = current_schema() and tablename like 'ia\\_%'`)
  assert.equal(antes!.n, 0, 'la base de antes no tiene tablas de IA')

  await miembro(db, 'claude')
  await db.consulta(`insert into actividad (id, actor, accion, resumen) values ('x1', '{"tipo":"humano","id":"yo","nombre":"Yo"}'::jsonb, 'prueba', 'algo de antes')`)
  const miembrosAntes = await db.consulta(`select * from miembros order by id`)

  await migrar(db, CARPETA)
  assert.deepEqual(await db.consulta(`select * from miembros order by id`), miembrosAntes)
  const [act] = await db.consulta<{ resumen: string; tanda: string | null }>(`select resumen, tanda from actividad where id = 'x1'`)
  assert.equal(act!.resumen, 'algo de antes')
  assert.equal(act!.tanda, null, 'lo de antes queda sin tanda')
  // La versión publicada antes escribe en `actividad` sin saber de la columna nueva: tiene que seguir andando.
  await db.consulta(`insert into actividad (id, actor, accion, resumen) values ('x2', '{"tipo":"ia","id":"claude","nombre":"Claude"}'::jsonb, 'prueba', 'sin tanda')`)
  await db.cerrar()
})

test('un agente nuevo trae los valores de fábrica del plan (permisos, topes, confirmación, sin proactividad)', async () => {
  const db = await baseCompleta()
  await miembro(db, 'a1')
  await db.consulta(`insert into ia_agentes (miembro_id) values ('a1')`)
  const [a] = await db.consulta<Record<string, any>>(`select * from ia_agentes where miembro_id = 'a1'`)
  assert.equal(a!.propietario, 'dueno')
  assert.equal(a!.modo, 'api')
  assert.deepEqual(a!.permisos, ['comentar', 'tarjetas', 'lienzo'])
  assert.equal(a!.confirmar, 'peligrosas')
  assert.equal(a!.puede_mencionar_ia, false)
  assert.equal(Number(a!.tope_mes_usd), 10)
  assert.equal(a!.autonomia, 'sugiere')
  assert.deepEqual(a!.disparadores, {})
  assert.equal(a!.activo, true)
  await db.consulta(`insert into ia_ajustes (propietario) values ('dueno')`)
  const [j] = await db.consulta<Record<string, any>>(`select * from ia_ajustes`)
  assert.equal(Number(j!.tope_mes_usd), 25)
  assert.equal(j!.pausada, false)
  assert.equal(j!.externas_disparan, false)
  assert.deepEqual(j!.repos_codigo, [])
  await falla('23514', () => db.consulta(`update ia_agentes set autonomia = 'siempre' where miembro_id = 'a1'`))
  await falla('23514', () => db.consulta(`update ia_agentes set confirmar = 'a veces' where miembro_id = 'a1'`))
  await db.cerrar()
})

test('restricciones: un trabajo por mención, por clave única de la cuenta, un orden por paso; el origen y el proveedor son libres', async () => {
  const db = await baseCompleta()
  await miembro(db, 'a1')
  await trabajo(db, 't1', { agente: 'a1', mencion: 'm1', unica: 'conv:c1' })
  await falla('23505', () => trabajo(db, 't2', { agente: 'a1', mencion: 'm1' }))
  await falla('23505', () => trabajo(db, 't3', { agente: 'a1', unica: 'conv:c1' }))
  await trabajo(db, 't4', { agente: 'a1', unica: 'conv:c1', propietario: 'otra' }) // la clave es por cuenta
  await trabajo(db, 't5', { agente: 'a1' })
  await trabajo(db, 't6', { agente: 'a1' }) // sin mención ni clave: sin límite
  await db.consulta(`update ia_trabajos set origen = 'proactivo' where id = 't5'`)
  await falla('23514', () => db.consulta(`update ia_trabajos set estado = 'dormido' where id = 't5'`))
  await falla('23503', () => trabajo(db, 't7', { agente: 'no-existe' }))

  const llamada = (id: string, paso: number, orden: number) =>
    db.consulta(`insert into ia_llamadas (id, trabajo_id, paso, orden, id_proveedor, herramienta) values ($1, 't1', $2, $3, 'toolu_1', 'leer_tarjeta')`, [id, paso, orden])
  await llamada('l1', 1, 0)
  await llamada('l2', 1, 1)
  await llamada('l3', 2, 0)
  await falla('23505', () => llamada('l4', 1, 0))
  await falla('23514', () => db.consulta(`update ia_llamadas set estado = 'rota' where id = 'l1'`))

  await db.consulta(`insert into ia_mensajes (trabajo_id, n, rol, neutro, nativo) values ('t1', 1, 'usuario', '{}'::jsonb, '{"b":1,"a":2}')`)
  const [m] = await db.consulta<{ nativo: string }>(`select nativo from ia_mensajes where trabajo_id = 't1'`)
  assert.equal(m!.nativo, '{"b":1,"a":2}', 'el JSON exacto no se reordena (por eso es text y no jsonb)')
  await falla('23505', () => db.consulta(`insert into ia_mensajes (trabajo_id, n, rol, neutro) values ('t1', 1, 'asistente', '{}'::jsonb)`))

  // La suma mensual (12.1): un solo insert que suma si la fila ya existe.
  const sumar = (costo: number) =>
    db.consulta(
      `insert into ia_uso_mes (propietario, mes, agente_id, entrada, salida, costo_usd, llamadas) values ('dueno', '2026-11', 'a1', 100, 50, $1, 1)
       on conflict (propietario, mes, agente_id) do update set entrada = ia_uso_mes.entrada + excluded.entrada,
         salida = ia_uso_mes.salida + excluded.salida, costo_usd = ia_uso_mes.costo_usd + excluded.costo_usd, llamadas = ia_uso_mes.llamadas + excluded.llamadas`,
      [costo],
    )
  await sumar(0.25)
  await sumar(0.5)
  const [u] = await db.consulta<Record<string, any>>(`select * from ia_uso_mes`)
  assert.equal(Number(u!.costo_usd), 0.75)
  assert.equal(Number(u!.entrada), 200)
  assert.equal(u!.llamadas, 2)

  // Borrar el trabajo se lleva su conversación y su libro.
  await db.consulta(`delete from ia_trabajos where id = 't1'`)
  assert.equal((await db.consulta(`select 1 from ia_mensajes`)).length, 0)
  assert.equal((await db.consulta(`select 1 from ia_llamadas`)).length, 0)
  await db.cerrar()
})

/** La consulta de tomar un trabajo, tal cual el plan (6.3). Devuelve el trabajo tomado o null. */
async function tomar(db: Conexion, cuenta: string, proceso = 'p1'): Promise<Record<string, any> | null> {
  return db.transaccion(async (tx) => {
    const [l] = await tx.consulta<{ libre: boolean }>(`select pg_try_advisory_xact_lock(hashtext('ia:' || $1)) as libre`, [cuenta])
    if (!l!.libre) return null
    const [t] = await tx.consulta(
      `with candidato as (
         select t.id
         from ia_trabajos t
         where t.propietario = $1
           and t.estado in ('en_cola', 'en_curso')
           and t.proximo_en <= now()
           and (t.tomado_hasta is null or t.tomado_hasta < now())
           and not exists (
             select 1 from ia_trabajos o
             where o.propietario = $1 and o.agente_id = t.agente_id and o.id <> t.id
               and o.estado = 'en_curso' and o.tomado_hasta >= now())
           and (select count(*) from ia_trabajos o
                where o.propietario = $1 and o.estado = 'en_curso' and o.tomado_hasta >= now()) < 2
         order by t.proximo_en
         for update of t skip locked
         limit 1
       )
       update ia_trabajos t
       set estado = 'en_curso', tomado_por = $2, tomado_hasta = now() + interval '150 seconds',
           cortes = t.cortes + (case when t.estado = 'en_curso' then 1 else 0 end),
           iniciado_en = coalesce(t.iniciado_en, now()), actualizado_en = now()
       from candidato
       where t.id = candidato.id
       returning t.*`,
      [cuenta, proceso],
    )
    return t ?? null
  })
}

test('tomar un trabajo: uno por agente, dos por cuenta, otra cuenta aparte, el futuro no, el préstamo vencido se retoma', async () => {
  const db = await baseCompleta()
  for (const m of ['a1', 'a2', 'a3']) await miembro(db, m)
  await miembro(db, 'b1', 'otra')
  await trabajo(db, 'T1', { agente: 'a1', proximo: '-40' })
  await trabajo(db, 'T2', { agente: 'a1', proximo: '-30' }) // el mismo agente que T1
  await trabajo(db, 'T3', { agente: 'a2', proximo: '-20' })
  await trabajo(db, 'T4', { agente: 'a3', proximo: '-10' })
  await trabajo(db, 'T5', { agente: 'a3', proximo: '+3600' }) // todavía no es la hora
  await trabajo(db, 'B1', { agente: 'b1', propietario: 'otra', proximo: '-50' })

  assert.equal((await tomar(db, 'dueno'))!.id, 'T1', 'el más viejo')
  assert.equal((await db.consulta(`select estado from ia_trabajos where id = 'T1'`))[0]!.estado, 'en_curso')
  assert.equal((await tomar(db, 'dueno'))!.id, 'T3', 'T2 espera: su agente ya tiene uno en curso')
  assert.equal(await tomar(db, 'dueno'), null, 'dos por cuenta: no hay un tercero aunque T4 esté listo')
  assert.equal((await tomar(db, 'otra'))!.id, 'B1', 'otra cuenta tiene su propio cupo y no ve lo ajeno')
  assert.equal((await db.consulta(`select estado from ia_trabajos where id = 'T4'`))[0]!.estado, 'en_cola')

  // T3 termina: se libera un lugar. T2 sigue esperando a T1 (mismo agente); entra T4. T5 es del futuro.
  await db.consulta(`update ia_trabajos set estado = 'hecho', terminado_en = now() where id = 'T3'`)
  assert.equal((await tomar(db, 'dueno', 'p2'))!.id, 'T4')
  await db.consulta(`update ia_trabajos set estado = 'hecho', terminado_en = now() where id = 'T4'`)
  assert.equal(await tomar(db, 'dueno'), null, 'T2 sigue esperando a T1; T5 es del futuro')

  // Al proceso que tenía T1 se le murió el préstamo: otro lo retoma y suma un corte.
  await db.consulta(`update ia_trabajos set tomado_hasta = now() - interval '1 second' where id = 'T1'`)
  const t1 = await tomar(db, 'dueno', 'p3')
  assert.equal(t1!.id, 'T1')
  assert.equal(t1!.cortes, 1)
  assert.equal(t1!.tomado_por, 'p3')
  assert.equal((await db.consulta(`select cortes from ia_trabajos where id = 'T2'`))[0]!.cortes, 0)

  // Con préstamo vigente, nadie más lo toma.
  assert.equal(await tomar(db, 'dueno'), null)
  await db.cerrar()
})

test('tomar un trabajo usa los índices parciales (no recorre la tabla cuando hay mucha historia)', async () => {
  const db = await baseCompleta()
  await miembro(db, 'a1')
  // Mucha historia terminada de la cuenta y de otras, y un solo trabajo vivo.
  await db.ejecutar(`
    insert into ia_trabajos (id, propietario, agente_id, origen, superficie, pedido_por, proveedor, modelo, estado)
    select 'h' || g, case when g % 3 = 0 then 'dueno' else 'otra' || (g % 7) end, 'a1', 'mencion', 'tarjeta', '{}'::jsonb, 'falso', 'f', 'hecho'
    from generate_series(1, 3000) g;
    analyze ia_trabajos;`)
  await trabajo(db, 'vivo', { agente: 'a1' })
  await db.ejecutar(`analyze ia_trabajos`)
  const plan = (
    await db.consulta<{ 'QUERY PLAN': string }>(
      `explain select t.id from ia_trabajos t where t.propietario = 'dueno' and t.estado in ('en_cola', 'en_curso') and t.proximo_en <= now() order by t.proximo_en limit 1`,
    )
  ).map((f) => f['QUERY PLAN']).join('\n')
  assert.match(plan, /ia_trabajos_cola_idx/, `el plan tiene que usar el índice de la cola:\n${plan}`)
  assert.doesNotMatch(plan, /Seq Scan/i, `no tiene que recorrer la tabla:\n${plan}`)
  // «Uno por agente»: lo que está en curso de ese agente sale del índice parcial de lo en curso.
  const enCurso = (
    await db.consulta<{ 'QUERY PLAN': string }>(`explain select 1 from ia_trabajos o where o.propietario = 'dueno' and o.agente_id = 'a1' and o.estado = 'en_curso' and o.tomado_hasta >= now()`)
  ).map((f) => f['QUERY PLAN']).join('\n')
  assert.match(enCurso, /ia_trabajos_curso_idx/, `lo en curso de un agente tiene que usar su índice:\n${enCurso}`)
  await db.cerrar()
})
