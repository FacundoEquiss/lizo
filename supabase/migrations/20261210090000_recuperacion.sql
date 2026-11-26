-- Telar · recuperar la contraseña sin correo (docs/cuentas.md, «Recuperar la contraseña sin correo»). Solo agrega; se puede correr dos veces.
-- Online va con `set role tablero_app; set search_path = tablero;` (README, «Online»); no nombra el esquema.
-- No hay servicio de mail, así que un amigo que olvida su contraseña tiene dos caminos: (1) los códigos de recuperación que se le
-- mostraron al crear su cuenta (autoservicio) y (2) un enlace de un solo uso que le genera el dueño desde Configuración → Amigos.
-- La versión publicada antes sigue andando con la base ya migrada (no conoce nada de esto); la nueva con la base sin migrar falla solo
-- en lo de recuperar (el registro y entrar no dependen de estas tablas).

-- Los códigos de recuperación: 8 por cuenta, de un solo uso. El código en claro NO se guarda nunca: solo su sha256 con una sal propia
-- de cada código (se muestran una sola vez, al generarlos). Generar códigos nuevos borra los anteriores.
create table if not exists codigos_recuperacion (
  id text primary key,
  cuenta text not null,                               -- la cuenta a la que pertenece el código
  sal text not null,                                  -- 16 bytes al azar (base64url), una por código
  codigo_hash text not null,                          -- sha256 (hex) de la sal más el código sin guiones y en mayúsculas
  creado_en timestamptz not null default now(),
  usado_en timestamptz                                -- null mientras sirve; con fecha, gastado
);
create index if not exists codigos_recuperacion_cuenta_idx on codigos_recuperacion (cuenta);

-- Los restablecimientos que genera el dueño: un enlace de un solo uso que vence a las 24 horas. El token en claro NO se guarda nunca:
-- solo su sha256 (hex), como en las invitaciones. `cancelado_en` marca el que el dueño canceló o el que quedó sin efecto porque la
-- contraseña ya se cambió por otro camino.
create table if not exists restablecimientos (
  id text primary key,
  cuenta text not null,                               -- la cuenta del amigo
  token_hash text not null,                           -- sha256 (hex) del token de 32 bytes al azar
  creado_por text not null,                           -- la cuenta que lo generó (siempre 'dueno')
  creado_en timestamptz not null default now(),
  vence_en timestamptz not null,
  usado_en timestamptz,
  cancelado_en timestamptz
);
create unique index if not exists restablecimientos_token_idx on restablecimientos (token_hash);
create index if not exists restablecimientos_cuenta_idx on restablecimientos (cuenta, creado_en desc);

-- «Último restablecimiento» de la cuenta: cuándo se cambió la contraseña sin saber la anterior y por qué camino ('enlace' o 'codigo').
alter table cuentas add column if not exists restablecida_en timestamptz;
alter table cuentas add column if not exists restablecida_por text;

alter table codigos_recuperacion enable row level security;
alter table restablecimientos enable row level security;
