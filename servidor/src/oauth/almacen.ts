// OAuth de Telar: todo el SQL vive acá (las rutas no escriben consultas). Esquema `tablero`, tablas de la migración
// 20261202090000_oauth.sql. Se guardan hashes, nunca los códigos ni los tokens.
import type { Conexion } from '../datos/conexion'
import { VIDA_CODIGO_S, VIDA_REFRESCO_DIAS } from './config'

export interface ClienteOAuth {
  id: string
  nombre: string
  redirect_uris: string[]
  origen: 'dcr' | 'cimd'
  metadatos: Record<string, unknown>
  creado_en: string
  ultimo_uso: string | null
}

export interface CodigoOAuth {
  codigo_hash: string
  cliente_id: string
  usuario: string
  redirect_uri: string
  desafio: string
  recurso: string
  scope: string
  familia: string
}

export interface RefrescoOAuth {
  token_hash: string
  familia: string
  cliente_id: string
  usuario: string
  recurso: string
  scope: string
}

export interface ConexionOAuth {
  familia: string
  cliente_id: string
  nombre: string
  desde: string
  vence: string
}

const enSegundos = (s: number) => new Date(Date.now() + s * 1000).toISOString()
const enDias = (d: number) => enSegundos(d * 86400)

export class AlmacenOAuth {
  constructor(readonly db: Conexion) {}

  // ───── clientes ─────
  async guardarCliente(c: Pick<ClienteOAuth, 'id' | 'nombre' | 'redirect_uris' | 'origen' | 'metadatos'>): Promise<void> {
    await this.db.consulta(
      `insert into oauth_clientes (id, nombre, redirect_uris, origen, metadatos)
       values ($1, $2, $3::jsonb, $4, $5::jsonb)
       on conflict (id) do update set nombre = excluded.nombre, redirect_uris = excluded.redirect_uris, metadatos = excluded.metadatos`,
      [c.id, c.nombre, JSON.stringify(c.redirect_uris), c.origen, JSON.stringify(c.metadatos)],
    )
  }

  async leerCliente(id: string): Promise<ClienteOAuth | null> {
    const f = await this.db.consulta<ClienteOAuth>(
      'select id, nombre, redirect_uris, origen, metadatos, creado_en, ultimo_uso from oauth_clientes where id = $1',
      [id],
    )
    return f[0] ?? null
  }

  async tocarCliente(id: string): Promise<void> {
    await this.db.consulta('update oauth_clientes set ultimo_uso = now() where id = $1', [id])
  }

  async contarClientes(): Promise<number> {
    const f = await this.db.consulta<{ n: string | number }>('select count(*) as n from oauth_clientes')
    return Number(f[0]?.n ?? 0)
  }

  /** Saca los registros (DCR) que nunca se usaron y tienen más de 30 días: libera lugar bajo el tope. */
  async podarClientes(): Promise<void> {
    await this.db.consulta(
      `delete from oauth_clientes
        where origen = 'dcr' and ultimo_uso is null and creado_en < now() - interval '30 days'`,
    )
  }

  // ───── códigos de autorización (un solo uso) ─────
  async crearCodigo(c: CodigoOAuth): Promise<void> {
    await this.db.consulta(
      `insert into oauth_codigos (codigo_hash, cliente_id, usuario, redirect_uri, desafio, recurso, scope, familia, vence)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)`,
      [c.codigo_hash, c.cliente_id, c.usuario, c.redirect_uri, c.desafio, c.recurso, c.scope, c.familia, enSegundos(VIDA_CODIGO_S)],
    )
  }

  /**
   * Canjea un código: se marca como usado en el mismo paso que se lee, así dos pedidos a la vez no lo usan los dos.
   * Si ya estaba usado, devuelve la familia para revocar lo que se hubiera emitido con él.
   */
  async canjearCodigo(hash: string): Promise<{ codigo: CodigoOAuth } | { reusado: string } | null> {
    const f = await this.db.consulta<CodigoOAuth>(
      `update oauth_codigos set usado_en = now()
        where codigo_hash = $1 and usado_en is null and vence > now()
        returning codigo_hash, cliente_id, usuario, redirect_uri, desafio, recurso, scope, familia`,
      [hash],
    )
    if (f[0]) return { codigo: f[0] }
    const previo = await this.db.consulta<{ familia: string; usado_en: string | null }>(
      'select familia, usado_en from oauth_codigos where codigo_hash = $1',
      [hash],
    )
    return previo[0]?.usado_en ? { reusado: previo[0].familia } : null
  }

  // ───── tokens de refresco (rotan en cada uso) ─────
  async crearRefresco(r: RefrescoOAuth): Promise<void> {
    await this.db.consulta(
      `insert into oauth_refrescos (token_hash, familia, cliente_id, usuario, recurso, scope, vence)
       values ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
      [r.token_hash, r.familia, r.cliente_id, r.usuario, r.recurso, r.scope, enDias(VIDA_REFRESCO_DIAS)],
    )
  }

  /** Usa un refresco (queda marcado). Si ya estaba usado, se revoca toda la familia: alguien lo copió. */
  async rotarRefresco(hash: string): Promise<RefrescoOAuth | null> {
    const f = await this.db.consulta<RefrescoOAuth>(
      `update oauth_refrescos set usado_en = now()
        where token_hash = $1 and usado_en is null and revocado_en is null and vence > now()
        returning token_hash, familia, cliente_id, usuario, recurso, scope`,
      [hash],
    )
    if (f[0]) return f[0]
    const previo = await this.db.consulta<{ familia: string; usado_en: string | null }>(
      'select familia, usado_en from oauth_refrescos where token_hash = $1',
      [hash],
    )
    if (previo[0]?.usado_en) await this.revocarFamilia(previo[0].familia)
    return null
  }

  async revocarFamilia(familia: string): Promise<void> {
    await this.db.consulta('update oauth_refrescos set revocado_en = now() where familia = $1 and revocado_en is null', [familia])
  }

  /** RFC 7009: revocar por el token de refresco (la familia entera). */
  async revocarPorRefresco(hash: string): Promise<void> {
    const f = await this.db.consulta<{ familia: string }>('select familia from oauth_refrescos where token_hash = $1', [hash])
    if (f[0]) await this.revocarFamilia(f[0].familia)
  }

  /** Las aplicaciones conectadas de un usuario (una por familia), para «Conexiones» en Conectar IA. */
  async conexionesDe(usuario: string): Promise<ConexionOAuth[]> {
    return this.db.consulta<ConexionOAuth>(
      `select r.familia, r.cliente_id, coalesce(nullif(c.nombre, ''), r.cliente_id) as nombre,
              min(r.creado_en) as desde, max(r.vence) as vence
         from oauth_refrescos r left join oauth_clientes c on c.id = r.cliente_id
        where r.usuario = $1 and r.vence > now()
          and not exists (select 1 from oauth_refrescos x where x.familia = r.familia and x.revocado_en is not null)
        group by r.familia, r.cliente_id, c.nombre
        order by min(r.creado_en) desc`,
      [usuario],
    )
  }

  async familiaEsDe(familia: string, usuario: string): Promise<boolean> {
    const f = await this.db.consulta('select 1 from oauth_refrescos where familia = $1 and usuario = $2 limit 1', [familia, usuario])
    return f.length > 0
  }

  /** Limpieza barata: códigos vencidos y refrescos de más de 60 días. */
  async limpiar(): Promise<void> {
    await this.db.consulta(`delete from oauth_codigos where vence < now() - interval '1 day'`)
    await this.db.consulta(`delete from oauth_refrescos where vence < now() - interval '30 days'`)
  }
}
