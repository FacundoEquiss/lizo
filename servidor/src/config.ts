import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUERTO_POR_DEFECTO } from '../../compartido/constantes'

/** Carpeta raíz de la app (donde está package.json). */
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const config = {
  puerto: Number(process.env.TABLERO_PUERTO) || PUERTO_POR_DEFECTO,
  /** Solo se escucha en la propia computadora (lo pide la especificación MCP para servidores locales). */
  host: process.env.TABLERO_HOST || '127.0.0.1',
  datos: path.resolve(process.env.TABLERO_DATOS || path.join(RAIZ, '.datos')),
  /** Si está, se usa Postgres (por ejemplo Supabase) en vez de PGlite. Ver servidor/src/datos/postgres.ts. */
  urlBaseDeDatos: process.env.TABLERO_DB_URL || '',
  migraciones: path.join(RAIZ, 'supabase', 'migrations'),
  web: path.join(RAIZ, 'dist', 'web'),
  /** Origen permitido extra (cuando se publique detrás de un dominio). */
  origenesExtra: (process.env.TABLERO_ORIGENES || '').split(',').map((s) => s.trim()).filter(Boolean),
  /** Archivo de Discord que se importa solo la primera vez, si existe (se puede apagar con TABLERO_SEMILLA_DISCORD=no). */
  semillaDiscord:
    process.env.TABLERO_SEMILLA_DISCORD ?? path.resolve(RAIZ, '..', 'docs', 'discord', 'pendientes-2026-11.json'),
}

export const rutas = {
  pg: path.join(config.datos, 'pg'),
  archivos: path.join(config.datos, 'archivos'),
  clave: path.join(config.datos, 'clave-mcp.txt'),
  /** El secreto con el que se cifran las claves de IA cuando no hay variable de entorno (solo en la computadora; permisos 600). */
  secretoIA: path.join(config.datos, 'secreto-ia.txt'),
}

export function asegurarCarpetas() {
  mkdirSync(rutas.archivos, { recursive: true })
}

/**
 * Clave simple para el MCP por HTTP (y para el puente stdio → servidor).
 * Se genera sola la primera vez y queda en .datos/clave-mcp.txt. Se puede
 * fijar con TABLERO_CLAVE. Cuando se publique, esto se reemplaza por OAuth.
 */
export function leerClave(): string {
  if (process.env.TABLERO_CLAVE) return process.env.TABLERO_CLAVE
  if (existsSync(rutas.clave)) return readFileSync(rutas.clave, 'utf8').trim()
  mkdirSync(config.datos, { recursive: true })
  const clave = 'tab_' + randomBytes(18).toString('base64url')
  writeFileSync(rutas.clave, clave + '\n', { mode: 0o600 })
  return clave
}

export const urlServidor = () => `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.puerto}`
