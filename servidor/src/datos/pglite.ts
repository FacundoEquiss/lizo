import { mkdirSync } from 'node:fs'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import type { Conexion } from './conexion'

type Consultable = Pick<PGlite, 'query' | 'exec'> | Transaction

function envolver(db: Consultable, raiz: PGlite | null): Conexion {
  return {
    tipo: 'pglite',
    async consulta<T>(sql: string, parametros: unknown[] = []) {
      const r = await db.query<T>(sql, parametros as never[])
      return r.rows
    },
    async ejecutar(sql: string) {
      await db.exec(sql)
    },
    async transaccion<T>(fn: (tx: Conexion) => Promise<T>) {
      // Dentro de una transacción de PGlite no se anidan transacciones: se reusa.
      if (!raiz) return fn(envolver(db, null))
      return raiz.transaction((tx) => fn(envolver(tx, null)))
    },
    async cerrar() {
      if (raiz) await raiz.close()
    },
  }
}

/**
 * Postgres completo en WebAssembly, guardado en una carpeta (.datos/pg).
 * Un solo proceso puede abrirla a la vez: por eso el servidor toma el puerto
 * antes de abrirla (el puerto hace de candado; ver principal.ts).
 */
export async function abrirPglite(carpeta: string): Promise<Conexion> {
  mkdirSync(carpeta, { recursive: true })
  const db = await PGlite.create(carpeta)
  return envolver(db, db)
}

/** Una base descartable en memoria, para probar migraciones sin tocar disco (servidor/src/ia/migracion.prueba.ts). */
export async function abrirPgliteEnMemoria(): Promise<Conexion> {
  const db = await PGlite.create()
  return envolver(db, db)
}
