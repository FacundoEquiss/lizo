// Copia TODA la base de Telar a otra base (migración a un proyecto propio de Supabase, SRV-2). Se usa una vez y se saca.
//
// Cómo: (1) aplica las migraciones en el destino; (2) abre una foto consistente del origen (repeatable read) y una sola
// transacción en el destino; (3) vacía las tablas del destino y copia cada una en el orden de sus claves ajenas, de a pocas
// filas (los archivos, de a muy pocas); (4) acomoda las secuencias; (5) cuenta filas en los dos lados y, si algo no coincide,
// NO confirma (la transacción del destino se deshace y el destino queda como estaba).
// Es idempotente: correrla de nuevo vacía y vuelve a copiar. No toca el origen (solo lo lee).
import type { Conexion } from './conexion'
import { migrar } from './migraciones'

export interface InformeCopia {
  tablas: Record<string, { origen: number; destino: number }>
  filas: number
  bytes: number
  ms: number
}

const q = (n: string) => `"${n.replace(/"/g, '""')}"`
const PESADAS = 4 // filas por tanda en tablas con bytea (los archivos)
const NORMALES = 400

/** Ordena las tablas para que cada una vaya después de las que referencia (sus padres). Falla si hay un ciclo entre tablas distintas. */
export function ordenarPorClaves(tablas: string[], claves: { hija: string; padre: string }[]): string[] {
  const pendientes = new Map(tablas.map((t) => [t, new Set<string>()]))
  for (const { hija, padre } of claves) {
    if (hija !== padre && pendientes.has(hija) && pendientes.has(padre)) pendientes.get(hija)!.add(padre)
  }
  const orden: string[] = []
  while (pendientes.size) {
    const listas = [...pendientes].filter(([, p]) => p.size === 0).map(([t]) => t).sort()
    if (!listas.length) throw new Error(`Hay un ciclo de claves ajenas entre: ${[...pendientes.keys()].join(', ')}`)
    for (const t of listas) {
      orden.push(t)
      pendientes.delete(t)
      for (const p of pendientes.values()) p.delete(t)
    }
  }
  return orden
}

export async function copiarBase(
  origen: Conexion,
  destino: Conexion,
  opciones: { carpetaMigraciones: string; soloContar?: boolean; log?: (m: string) => void },
): Promise<InformeCopia> {
  const log = opciones.log ?? (() => {})
  const t0 = Date.now()
  await migrar(destino, opciones.carpetaMigraciones, log)

  const listar = async (db: Conexion) =>
    (
      await db.consulta<{ t: string }>(
        `select table_name as t from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' and table_name <> 'tablero_migraciones' order by 1`,
      )
    ).map((f) => f.t)
  const deOrigen = await listar(origen)
  const deDestino = await listar(destino)
  const faltan = deOrigen.filter((t) => !deDestino.includes(t))
  if (faltan.length) throw new Error(`El destino no tiene estas tablas del origen (¿faltan migraciones?): ${faltan.join(', ')}`)
  const sobran = deDestino.filter((t) => !deOrigen.includes(t))
  if (sobran.length) log(`aviso: el destino tiene tablas que el origen no (quedan vacías): ${sobran.join(', ')}`)

  const claves = await destino.consulta<{ hija: string; padre: string }>(
    `select c.conrelid::regclass::text as hija, c.confrelid::regclass::text as padre from pg_constraint c where c.contype = 'f' and c.connamespace = current_schema()::regnamespace`,
  )
  const limpiar = (n: string) => n.replace(/^"|"$/g, '').replace(/^[^.]*\./, '').replace(/^"|"$/g, '')
  const orden = ordenarPorClaves(deOrigen, claves.map((k) => ({ hija: limpiar(k.hija), padre: limpiar(k.padre) })))

  const conBytea = new Set(
    (
      await origen.consulta<{ t: string }>(
        `select distinct table_name as t from information_schema.columns where table_schema = current_schema() and data_type = 'bytea'`,
      )
    ).map((f) => f.t),
  )
  const llaves = new Map<string, string[]>()
  for (const f of await origen.consulta<{ t: string; c: string }>(
    `select i.indrelid::regclass::text as t, a.attname as c
       from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indisprimary and i.indrelid in (select c.oid from pg_class c where c.relnamespace = current_schema()::regnamespace)
      order by i.indrelid, array_position(i.indkey::int2[], a.attnum)`,
  )) {
    const t = limpiar(f.t)
    llaves.set(t, [...(llaves.get(t) ?? []), f.c])
  }

  const informe: InformeCopia = { tablas: {}, filas: 0, bytes: 0, ms: 0 }
  const contar = async (db: Conexion, t: string) => Number((await db.consulta<{ n: string }>(`select count(*) as n from ${q(t)}`))[0].n)

  if (opciones.soloContar) {
    for (const t of orden) informe.tablas[t] = { origen: await contar(origen, t), destino: await contar(destino, t) }
    informe.ms = Date.now() - t0
    return informe
  }

  await origen.transaccion(async (o) => {
    await o.ejecutar('set transaction isolation level repeatable read read only')
    await destino.transaccion(async (d) => {
      await d.ejecutar(`truncate ${orden.map(q).join(', ')} restart identity`)
      for (const t of orden) {
        const orderBy = (llaves.get(t) ?? []).map(q).join(', ') || 'ctid'
        const tanda = conBytea.has(t) ? PESADAS : NORMALES
        for (let desde = 0; ; desde += tanda) {
          const filas = await o.consulta<{ j: string }>(
            `select row_to_json(_copia)::text as j from (select * from ${q(t)} order by ${orderBy} limit ${tanda} offset ${desde}) _copia`,
          )
          if (!filas.length) break
          const json = `[${filas.map((f) => f.j).join(',')}]`
          informe.bytes += json.length
          await d.consulta(`insert into ${q(t)} select * from json_populate_recordset(null::${q(t)}, $1::json)`, [json])
          if (filas.length < tanda) break
        }
        const n = await contar(o, t)
        const m = await contar(d, t)
        informe.tablas[t] = { origen: n, destino: m }
        informe.filas += m
        if (n !== m) throw new Error(`La tabla ${t} no coincide: origen ${n}, destino ${m}. No se confirma nada.`)
        if (n) log(`copiada ${t}: ${n} filas`)
      }
      // Las secuencias siguen donde quedó el origen (si no, el próximo id repetiría uno ya usado).
      for (const f of await d.consulta<{ t: string; c: string }>(
        `select table_name as t, column_name as c from information_schema.columns where table_schema = current_schema() and column_default like 'nextval(%'`,
      )) {
        if (!orden.includes(f.t)) continue
        await d.consulta(
          `select setval(pg_get_serial_sequence($1, $2), coalesce(max(${q(f.c)}), 1), max(${q(f.c)}) is not null) from ${q(f.t)}`,
          [q(f.t), f.c],
        )
      }
    })
  })
  informe.ms = Date.now() - t0
  return informe
}
