-- Telar · invitaciones desde adentro de la app (docs/cuentas.md, «Amigos»). Solo agrega; se puede correr dos veces.
-- Online va con `set role tablero_app; set search_path = tablero;` (README, «Online»); no nombra el esquema.
-- Antes, para que un amigo se registrara había que cargar un código en una variable de Vercel (`TABLERO_INVITACION`) y volver a
-- publicar. Ahora el dueño genera un enlace de un solo uso desde Configuración → Amigos. El registro por código sigue andando.
-- La versión publicada antes sigue andando con la base ya migrada (no conoce nada de esto); la nueva con la base sin migrar
-- falla solo en lo de Amigos, y el registro por código de la variable no se toca.

-- Cada invitación: un enlace con su token. El token en claro NO se guarda nunca: solo su sha256 (hex). Se muestra una sola vez,
-- al crearla, dentro del enlace.
create table if not exists invitaciones (
  id text primary key,
  propietario text not null,                          -- la cuenta que invita (hoy, siempre 'dueno')
  token_hash text not null,                           -- sha256 (hex) del token de 32 bytes al azar
  nota text not null default '' check (char_length(nota) <= 60),      -- «para Pablo» (solo la ve quien invita)
  usos_max integer not null default 1 check (usos_max between 1 and 100),
  usos integer not null default 0 check (usos >= 0),
  vence_en timestamptz not null,
  revocada_en timestamptz,
  creada_en timestamptz not null default now(),
  ultimo_uso_en timestamptz,
  -- El tope duro: aunque lleguen dos pedidos a la vez, la base nunca deja gastar más usos que los que tiene la invitación.
  check (usos <= usos_max)
);
create unique index if not exists invitaciones_token_idx on invitaciones (token_hash);
create index if not exists invitaciones_propietario_idx on invitaciones (propietario, creada_en desc);

-- De qué invitación nació cada cuenta (null: las de siempre y las del código de la variable) y los ajustes de la cuenta
-- (el tope de cuentas de amigos del dueño vive en `ajustes -> 'topeAmigos'`; sin valor, valen 15).
alter table cuentas add column if not exists invitacion_id text;
alter table cuentas add column if not exists ajustes jsonb not null default '{}'::jsonb;
create index if not exists cuentas_invitacion_idx on cuentas (invitacion_id) where invitacion_id is not null;

alter table invitaciones enable row level security;
