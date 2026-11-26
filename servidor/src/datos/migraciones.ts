import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Conexion } from './conexion'

/**
 * Aplica, en orden, los .sql de supabase/migrations que todavía no se aplicaron.
 * Lleva la cuenta en la tabla tablero_migraciones (Supabase usa la suya propia,
 * supabase_migrations.schema_migrations, cuando se migra con su CLI).
 */
export async function migrar(db: Conexion, carpeta: string, log: (m: string) => void = () => {}) {
  await db.ejecutar(`
    create table if not exists tablero_migraciones (
      nombre text primary key,
      aplicada_en timestamptz not null default now()
    );
    alter table tablero_migraciones enable row level security;
  `)
  const aplicadas = new Set(
    (await db.consulta<{ nombre: string }>('select nombre from tablero_migraciones')).map((f) => f.nombre),
  )
  const archivos = readdirSync(carpeta)
    .filter((n) => n.endsWith('.sql'))
    .sort()
  for (const nombre of archivos) {
    if (aplicadas.has(nombre)) continue
    const sql = readFileSync(path.join(carpeta, nombre), 'utf8')
    await db.transaccion(async (tx) => {
      await tx.ejecutar(sql)
      await tx.consulta('insert into tablero_migraciones (nombre) values ($1)', [nombre])
    })
    log(`migración aplicada: ${nombre}`)
  }
}
