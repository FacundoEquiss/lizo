// Capa de acceso a datos: todo el servidor habla con esta interfaz, nunca con
// PGlite o con Postgres directamente. Para pasar a Supabase alcanza con definir
// TABLERO_DB_URL (ver postgres.ts y el README).

export interface Conexion {
  readonly tipo: 'pglite' | 'postgres'
  /** Consulta con parámetros $1, $2… Devuelve las filas. */
  consulta<T = Record<string, any>>(sql: string, parametros?: unknown[]): Promise<T[]>
  /** Corre varias sentencias sin parámetros (migraciones). */
  ejecutar(sql: string): Promise<void>
  /** Todo lo de adentro se confirma junto o no se confirma. */
  transaccion<T>(fn: (tx: Conexion) => Promise<T>): Promise<T>
  cerrar(): Promise<void>
}

export async function abrirConexion(opciones: { urlPostgres?: string; carpetaPglite: string }): Promise<Conexion> {
  if (opciones.urlPostgres) {
    const { abrirPostgres } = await import('./postgres')
    return abrirPostgres(opciones.urlPostgres)
  }
  const { abrirPglite } = await import('./pglite')
  return abrirPglite(opciones.carpetaPglite)
}
