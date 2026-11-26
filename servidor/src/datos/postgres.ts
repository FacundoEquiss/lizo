// Adaptador para Postgres "de verdad" (Supabase, Neon, uno local…). Se usa cuando está TABLERO_DB_URL.
//
// Online (24/11/2026): el tablero vive en el proyecto de Supabase del juego, en su propio esquema `tablero`, con su propio
// usuario de base (`tablero_app`, que solo ve ese esquema y lo tiene como search_path). Se entra por el pooler de Supabase
// (Vercel no llega a la dirección directa, que es solo IPv6). TABLERO_DB_URL puede traer varias direcciones separadas por
// espacios: se usa la primera que conecta (el pooler puede estar en aws-0 o aws-1 según el proyecto).
// Las migraciones (supabase/migrations) se aplican aparte, con ese mismo usuario como dueño (ver README, "Online").
import pg from 'pg'
import type { Conexion } from './conexion'
import { esErrorDeCertificado, tlsDeLaUrl } from './tls'

// Los números grandes (count, bigserial) llegan como texto: el resto del código ya los convierte con Number().
function envolver(cliente: pg.Pool | pg.PoolClient, pool: pg.Pool | null): Conexion {
  return {
    tipo: 'postgres',
    async consulta<T>(sql: string, parametros: unknown[] = []) {
      const r = await cliente.query(sql, parametros)
      return r.rows as T[]
    },
    async ejecutar(sql: string) {
      await cliente.query(sql)
    },
    async transaccion<T>(fn: (tx: Conexion) => Promise<T>) {
      if (!pool) return fn(envolver(cliente, null))
      const c = await pool.connect()
      try {
        await c.query('begin')
        const r = await fn(envolver(c, null))
        await c.query('commit')
        return r
      } catch (e) {
        await c.query('rollback')
        throw e
      } finally {
        c.release()
      }
    },
    async cerrar() {
      if (pool) await pool.end()
    },
  }
}

function crearPool(urlOriginal: string) {
  // Supabase exige TLS y acá se VERIFICA el certificado (ver tls.ts). En un Postgres local sin TLS: ?sslmode=disable en la URL.
  const { url, ssl, modo } = tlsDeLaUrl(urlOriginal, process.env)
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.TABLERO_DB_MAX) || 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 8_000,
    ssl,
  })
  return { pool, modo }
}

export async function abrirPostgres(urls: string): Promise<Conexion> {
  const lista = urls.split(/\s+/).filter(Boolean)
  let ultimoError: unknown = null
  for (const url of lista) {
    const { pool, modo } = crearPool(url)
    try {
      // Se prueba la conexión al arrancar (si la URL está mal, falla acá y no a mitad de camino).
      await pool.query('select 1')
      pool.on('error', (e) => console.error('[tablero] base:', e.message))
      if (modo === 'sin-verificar') console.error('[tablero] AVISO: la base se conectó SIN verificar el certificado (TABLERO_DB_TLS=sin-verificar).')
      else if (modo === 'verificado') console.log('[tablero] base conectada con el certificado verificado.')
      return envolver(pool, pool)
    } catch (e) {
      ultimoError = e
      await pool.end().catch(() => {})
      // Si el certificado no verifica, NO se baja la guardia: se corta con un mensaje claro (cómo seguir: ver tls.ts).
      if (esErrorDeCertificado(e)) {
        console.error(`[tablero] ERROR: el certificado de la base no se pudo verificar (${(e as { code?: string }).code}); no se conecta. Ver servidor/src/datos/tls.ts.`)
      }
    }
  }
  throw ultimoError ?? new Error('Falta TABLERO_DB_URL.')
}
