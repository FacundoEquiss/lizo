-- Telar · menciones y notificaciones (docs/plan-ia-integrada.md, fase 1). Solo agrega; se puede correr dos veces.
-- Online va con `set role tablero_app; set search_path = tablero;` (README, «Online»); no nombra el esquema.
-- La versión publicada antes sigue andando con la base ya migrada: las columnas nuevas tienen valor por defecto o aceptan null.

-- ───── miembros: alias para mencionar, archivar en vez de borrar, preferencias ─────
alter table miembros add column if not exists alias text;                       -- 'claude', 'facu'; único por cuenta
alter table miembros add column if not exists archivado boolean not null default false;
alter table miembros add column if not exists preferencias jsonb not null default '{}'::jsonb;
alter table miembros add column if not exists cuenta_vinculada text;            -- equipos: la cuenta de esa persona (hoy null)
create unique index if not exists miembros_alias_idx on miembros (propietario, alias) where alias is not null;

-- ───── comentarios: hilos chatos y de qué trabajo salió una respuesta ─────
alter table comentarios add column if not exists respuesta_a text references comentarios (id) on delete set null;
alter table comentarios add column if not exists trabajo_id text;

-- ───── menciones ─────
create table if not exists menciones (
  id text primary key,
  propietario text not null default 'dueno',
  origen_tipo text not null,                          -- 'comentario' | 'descripcion' | 'porque' | 'nota' | 'comentario_diseno'
  origen_id text not null,                            -- id del comentario, de la tarjeta, del elemento o del comentario de Diseño
  ocurrencia integer not null default 1,              -- la primera, la segunda… mención a ese miembro en ese texto
  en_texto boolean not null default true,             -- false: ya no está escrita (se borró del texto)
  destinatario_id text not null references miembros (id) on delete cascade,
  autor jsonb not null,                               -- el Actor que la escribió
  extracto text not null default '',                  -- hasta 280 caracteres alrededor
  proyecto_id text,
  tablero_id text,
  tarjeta_id text,
  tarjeta_clave text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'atendida', 'retirada')),
  trabajo_id text,                                    -- el trabajo que la atiende (agente de adentro)
  atendida_en timestamptz,
  atendida_por jsonb,
  nota text,                                          -- la de atender_mencion
  creado_en timestamptz not null default now()
);
create unique index if not exists menciones_unica_idx on menciones (origen_tipo, origen_id, destinatario_id, ocurrencia);
create index if not exists menciones_pendientes_idx on menciones (propietario, destinatario_id, creado_en desc) where estado = 'pendiente';
create index if not exists menciones_tarjeta_idx on menciones (tarjeta_id, destinatario_id) where estado = 'pendiente';

-- ───── notificaciones (van a un miembro, no a la cuenta: así sirven para equipos) ─────
create table if not exists notificaciones (
  id text primary key,
  propietario text not null default 'dueno',
  para_id text not null references miembros (id) on delete cascade,
  tipo text not null,                                 -- 'mencion' | 'respuesta' | 'confirmacion' | 'tope' | 'error_ia' | 'asignacion'
  titulo text not null,
  cuerpo text not null default '',
  actor jsonb,
  enlace text,                                        -- una ruta de Telar, nunca una dirección de afuera
  proyecto_id text,
  tarjeta_id text,
  trabajo_id text,
  mencion_id text,
  clave_unica text,                                   -- para no repetir: 'respuesta:<trabajo>', 'tope80:<agente>:<mes>'
  leida_en timestamptz,
  creado_en timestamptz not null default now()
);
create unique index if not exists notificaciones_unica_idx on notificaciones (propietario, clave_unica) where clave_unica is not null;
create index if not exists notificaciones_bandeja_idx on notificaciones (propietario, para_id, creado_en desc);
create index if not exists notificaciones_sin_leer_idx on notificaciones (propietario, para_id) where leida_en is null;

alter table menciones enable row level security;
alter table notificaciones enable row level security;

-- ───── menciones de antes: se levantan una sola vez por cuenta (la marca vive en la cuenta) ─────
-- Los comentarios con «@claude» escritos antes de esta función se vuelven menciones pendientes la primera vez que la
-- cuenta pide sus novedades o sus pendientes (ServicioIA.levantarMencionesViejas). null = todavía no se levantaron.
alter table cuentas add column if not exists menciones_levantadas_en timestamptz;
