import { nanoid } from 'nanoid'
import type { Evento } from '../../compartido/tipos'
import type { Conexion } from './datos/conexion'
import { anotarEvento } from './dominio/tanda'

type Oyente = (e: Evento) => void

/** Lo que comparten el bus y sus vistas por cuenta: los oyentes en memoria y lo que falta anotar en la base. */
interface Nucleo {
  oyentes: Map<Oyente, string>
  pendientes: Set<Promise<unknown>>
}

/**
 * Bus de eventos: cada cambio se publica acá.
 *   · Local (un solo proceso): en memoria, y sale por SSE a la web.
 *   · Online (Vercel: muchos procesos cortos, sin memoria compartida): además se anota en la tabla `eventos`,
 *     y la web pregunta cada pocos segundos qué hay después del último que vio (/api/eventos/desde).
 * Cuentas (docs/cuentas.md): cada evento es de UNA cuenta. Publica solo la vista de una cuenta (`de(cuenta)`, la que tiene
 * el Servicio de esa cuenta), y cada oyente y cada sondeo reciben solo los de su cuenta. El bus sin cuenta no publica.
 */
export class BusEventos {
  private readonly nucleo: Nucleo

  constructor(
    private readonly db: Conexion | null = null,
    /** La cuenta de esta vista (null: el bus raíz, que no publica). */
    readonly cuenta: string | null = null,
    nucleo?: Nucleo,
  ) {
    this.nucleo = nucleo ?? { oyentes: new Map(), pendientes: new Set() }
  }

  /** La vista del bus de una cuenta: lo que publica queda marcado con esa cuenta. */
  de(cuenta: string): BusEventos {
    return new BusEventos(this.db, cuenta, this.nucleo)
  }

  /** ¿Los eventos quedan en la base (online)? */
  get persistente() {
    return this.db !== null
  }

  publicar(e: Omit<Evento, 'id' | 'en'>) {
    const cuenta = this.cuenta
    if (!cuenta) throw new Error('[tablero] evento sin cuenta: se publica desde el Servicio de una cuenta.')
    const evento: Evento = { ...e, id: nanoid(10), en: new Date().toISOString() }
    // Si lo publica un trabajo de la IA, los ids que toca quedan anotados en su tanda (para mostrar y deshacer, plan 7.6).
    anotarEvento(evento)
    for (const [o, de] of this.nucleo.oyentes) {
      if (de !== cuenta) continue
      try {
        o(evento)
      } catch {
        // un oyente roto no frena a los demás
      }
    }
    if (this.db) {
      const p = this.db
        .consulta('insert into eventos (datos, propietario) values ($1, $2)', [JSON.stringify(evento), cuenta])
        .catch((err: Error) => console.error('[tablero] no pude anotar el evento:', err.message))
      this.nucleo.pendientes.add(p)
      void p.finally(() => this.nucleo.pendientes.delete(p))
    }
  }

  /** Espera a que se anoten los eventos de este pedido (online: antes de contestar, que el proceso puede congelarse). */
  async vaciar() {
    while (this.nucleo.pendientes.size) await Promise.all([...this.nucleo.pendientes])
  }

  /**
   * Número del último evento de la cuenta. Si todavía no tiene ninguno, 1: así el primero que llegue (con n > 1) se ve.
   * (Con 0 la web volvería a pedir «el último» y se salteaba el primero.)
   */
  async ultimo(cuenta: string): Promise<number> {
    if (!this.db) return 0
    const [f] = await this.db.consulta<{ n: string | number }>('select coalesce(max(n), 1) as n from eventos where propietario = $1', [cuenta])
    return Number(f?.n ?? 1)
  }

  /** Los eventos de la cuenta después de `n`, en orden. */
  async desde(cuenta: string, n: number, limite = 300): Promise<{ n: number; evento: Evento }[]> {
    if (!this.db) return []
    const filas = await this.db.consulta<{ n: string | number; datos: Evento | string }>(
      'select n, datos from eventos where propietario = $1 and n > $2 order by n limit $3',
      [cuenta, n, limite],
    )
    return filas.map((f) => ({ n: Number(f.n), evento: typeof f.datos === 'string' ? (JSON.parse(f.datos) as Evento) : f.datos }))
  }

  /** Borra los eventos viejos (nadie los va a pedir: la web recarga si estuvo afuera más de un rato). */
  async limpiar() {
    if (this.db) await this.db.consulta(`delete from eventos where en < now() - interval '2 days'`)
  }

  /** Escucha los eventos de UNA cuenta (SSE local). */
  suscribir(cuenta: string, o: Oyente): () => void {
    this.nucleo.oyentes.set(o, cuenta)
    return () => this.nucleo.oyentes.delete(o)
  }

  get cantidad() {
    return this.nucleo.oyentes.size
  }
}
