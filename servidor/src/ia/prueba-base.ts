// Entorno común de las pruebas del servidor de la IA (ejecutor.prueba.ts, tanda.prueba.ts, …): una base PGlite en memoria con
// todas las migraciones, un Servicio con dos cuentas (`dueno` y `otra`), un proyecto con tablero y tarjetas, y atajos para armar
// agentes (miembros IA con su fila de `ia_agentes` y una clave). Sin red y sin disco. No es código de producción.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Actor, Proyecto, TarjetaResumen } from '../../../compartido/tipos'
import type { Capacidad, IdProveedor } from '../../../compartido/ia'
import { almacenCarpeta } from '../datos/almacen'
import type { Conexion } from '../datos/conexion'
import { migrar } from '../datos/migraciones'
import { abrirPgliteEnMemoria } from '../datos/pglite'
import { Servicio, nuevoId, type Ctx } from '../dominio/servicio'
import { BusEventos } from '../eventos'
import type { Evento } from '../../../compartido/tipos'
import type { DepsEjecutor } from './ejecutor'
import { crearProveedorFalso, type OpcionesFalso, type ProveedorFalso } from './proveedores/falso'
import { costoDelAgente } from './proveedores/precios'
import type { PedidoModelo, Uso } from './tipos'

const MIGRACIONES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations')

export const PERSONA: Actor = { tipo: 'humano', id: 'yo', nombre: 'Yo' }

export interface Entorno {
  db: Conexion
  raiz: Servicio
  /** El Servicio de la cuenta `dueno`. */
  s: Servicio
  bus: BusEventos
  eventos: Evento[]
  carpeta: string
  /** El contexto de una persona con sesión (puede disparar agentes). */
  persona: Ctx
  proyecto: Proyecto
  tableroId: string
  listas: Record<string, string>
  yoId: string
  cerrar: () => Promise<void>
}

export async function crearEntorno(): Promise<Entorno> {
  const db = await abrirPgliteEnMemoria()
  await migrar(db, MIGRACIONES)
  const carpeta = mkdtempSync(path.join(tmpdir(), 'telar-ia-prueba-'))
  const bus = new BusEventos()
  const raiz = new Servicio(db, bus, almacenCarpeta(path.join(carpeta, 'archivos')))
  const s = raiz.de('dueno')
  const eventos: Evento[] = []
  bus.suscribir('dueno', (e) => eventos.push(e))
  const yo = await s.crearMiembro({ nombre: 'Facundo', esYo: true })
  const persona: Ctx = { actor: { tipo: 'humano', id: yo.id, nombre: yo.nombre }, via: 'sesion' }
  const proyecto = await s.crearProyecto(persona, { nombre: 'Prueba', prefijo: 'PR', tipo: 'completo' })
  const tableroId = proyecto.tableros[0]!.id
  const listas: Record<string, string> = {}
  for (const l of await s.listarListas(tableroId)) listas[l.nombre] = l.id
  return {
    db,
    raiz,
    s,
    bus,
    eventos,
    carpeta,
    persona,
    proyecto,
    tableroId,
    listas,
    yoId: yo.id,
    async cerrar() {
      await db.cerrar()
      rmSync(carpeta, { recursive: true, force: true })
    },
  }
}

export interface OpcionesAgente {
  nombre?: string
  proveedor?: IdProveedor
  modelo?: string
  permisos?: Capacidad[]
  confirmar?: 'nunca' | 'peligrosas' | 'siempre'
  topeMesUsd?: number
  puedeMencionarIA?: boolean
  activo?: boolean
  autonomia?: 'sugiere' | 'actua'
  disparadores?: Record<string, unknown>
  sinClave?: boolean
  claveEstado?: 'sin_probar' | 'valida' | 'invalida'
  instrucciones?: string
}

/** Un agente listo para trabajar: su miembro IA, una clave (cifrada de mentira: los tests inyectan la bóveda) y su configuración. */
export async function crearAgente(e: Entorno, o: OpcionesAgente = {}, cuenta = 'dueno'): Promise<{ miembroId: string; nombre: string; alias: string; claveId: string | null }> {
  const s = e.raiz.de(cuenta)
  const nombre = o.nombre ?? 'Claude'
  const m = await s.asegurarMiembroIA(nombre)
  const claveId = o.sinClave ? null : `k_${nuevoId()}`
  if (claveId)
    await e.db.consulta(
      `insert into ia_claves (id, propietario, proveedor, nombre, cifrada, version, ultimos4, estado) values ($1, $2, $3, $4, $5, 1, 'ba-1', $6)`,
      [claveId, cuenta, o.proveedor ?? 'falso', 'Clave de prueba', Buffer.from('prueba-sellada'), o.claveEstado ?? 'valida'],
    )
  await e.db.consulta(
    `insert into ia_agentes (miembro_id, propietario, modo, proveedor, modelo, clave_id, permisos, confirmar, puede_mencionar_ia, tope_mes_usd, activo, autonomia, disparadores, instrucciones)
     values ($1, $2, 'api', $3, $4, $5, $6::text[], $7, $8, $9, $10, $11, $12::jsonb, $13)
     on conflict (miembro_id) do update set clave_id = excluded.clave_id, proveedor = excluded.proveedor, modelo = excluded.modelo, permisos = excluded.permisos,
       confirmar = excluded.confirmar, puede_mencionar_ia = excluded.puede_mencionar_ia, tope_mes_usd = excluded.tope_mes_usd, activo = excluded.activo,
       autonomia = excluded.autonomia, disparadores = excluded.disparadores, instrucciones = excluded.instrucciones`,
    [
      m.id,
      cuenta,
      o.proveedor ?? 'falso',
      o.modelo ?? 'guion:responder',
      claveId,
      o.permisos ?? ['comentar', 'tarjetas', 'lienzo'],
      o.confirmar ?? 'peligrosas',
      o.puedeMencionarIA ?? false,
      o.topeMesUsd ?? 10,
      o.activo ?? true,
      o.autonomia ?? 'sugiere',
      JSON.stringify(o.disparadores ?? {}),
      o.instrucciones ?? '',
    ],
  )
  return { miembroId: m.id, nombre, alias: m.alias ?? '', claveId }
}

/** Cambia el guion del agente (en el proveedor falso, el «modelo» elige el guion). */
export async function ponerGuion(e: Entorno, miembroId: string, guion: string) {
  await e.db.consulta(`update ia_agentes set modelo = $2 where miembro_id = $1`, [miembroId, `guion:${guion}`])
}

export async function crearTarjeta(e: Entorno, titulo: string, extra: { listaId?: string; descripcion?: string } = {}): Promise<TarjetaResumen> {
  return e.s.crearTarjeta(e.persona, { tableroId: e.tableroId, titulo, listaId: extra.listaId, descripcion: extra.descripcion })
}

// ───────────────────────── el proveedor falso, para las pruebas del ciclo ─────────────────────────

/** El proveedor falso de verdad (proveedores/falso.ts) más lo que las pruebas del ciclo necesitan mirar: cuántos pedidos recibió y qué se le mandó. */
export interface FalsoDePrueba extends ProveedorFalso {
  /** Cuántos pedidos recibió (cuenta desde que arranca el pedido, no cuando termina). */
  pedidos: number
  /** Los pedidos que recibió (para mirar lo que se le mandó). */
  vistos: PedidoModelo[]
  /** El uso informado por el último pedido que contestó. */
  ultimoUso: Uso | null
}

export function crearFalsoDePrueba(op: OpcionesFalso = {}): FalsoDePrueba {
  const base = crearProveedorFalso(op)
  const f: FalsoDePrueba = {
    ...base,
    pedidos: 0,
    vistos: [],
    ultimoUso: null,
    async llamar(p) {
      f.pedidos++
      f.vistos.push(p)
      const r = await base.llamar(p)
      f.ultimoUso = r.uso
      return r
    },
    reiniciar() {
      base.reiniciar()
      f.pedidos = 0
      f.vistos = []
      f.ultimoUso = null
    },
  }
  return f
}

/**
 * Las dependencias del ciclo para una prueba: el proveedor falso, la clave que abre la bóveda (de mentira), el costo con los precios REALES de
 * proveedores/precios.ts (los del falso) y el código de mentira (las pruebas que lo necesitan ponen el de verdad contra un GitHub falso).
 */
export function depsDePrueba(falso: FalsoDePrueba, extra: Partial<DepsEjecutor> & { clave?: string } = {}): DepsEjecutor {
  const { clave, ...resto } = extra
  return {
    proveedorDe: () => falso,
    bovedaAbrir: () => clave ?? 'prueba-clave',
    costoUsd: (e) => costoDelAgente(e),
    prepararCodigo: async () => ({ repoPorDefecto: null, permitidos: new Map(), ramasDeLaTarjeta: [], token: async () => null, uso: { llamadas: 0, bytes: 0 }, cache: new Map(), refPorRepo: new Map() }),
    ejecutarCodigo: async (_ctx, h, a) => ({ texto: `[código de mentira] ${h} ${JSON.stringify(a)}`, esError: false, bytes: 0 }),
    pistasDeRutas: () => [],
    ...resto,
  }
}
