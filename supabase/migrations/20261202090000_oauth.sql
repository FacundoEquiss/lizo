-- Telar · OAuth 2.1 para conectores (ChatGPT, claude.ai). Solo agrega; se puede correr dos veces.
-- Se guardan hashes (SHA-256) de los códigos y de los tokens de refresco: nunca los valores en sí.
-- Online va con `set search_path = tablero` (README, «Online»); no nombra el esquema.

create table if not exists oauth_clientes (
  id text primary key,                               -- DCR: 'cli_' + 24 al azar · CIMD: la URL https del documento
  nombre text not null default '',
  redirect_uris jsonb not null default '[]'::jsonb,
  origen text not null default 'dcr' check (origen in ('dcr', 'cimd')),
  metadatos jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now(),
  ultimo_uso timestamptz
);

create table if not exists oauth_codigos (
  codigo_hash text primary key,
  cliente_id text not null,
  usuario text not null,
  redirect_uri text not null,
  desafio text not null,                             -- code_challenge (PKCE, S256)
  recurso text not null,
  scope text not null default 'telar',
  familia text not null,
  vence timestamptz not null,
  usado_en timestamptz
);

create table if not exists oauth_refrescos (
  token_hash text primary key,
  familia text not null,
  cliente_id text not null,
  usuario text not null,
  recurso text not null,
  scope text not null default 'telar',
  creado_en timestamptz not null default now(),
  vence timestamptz not null,
  usado_en timestamptz,
  revocado_en timestamptz
);

create index if not exists oauth_refrescos_familia_idx on oauth_refrescos (familia);
create index if not exists oauth_refrescos_usuario_idx on oauth_refrescos (usuario) where revocado_en is null;

alter table oauth_clientes enable row level security;
alter table oauth_codigos enable row level security;
alter table oauth_refrescos enable row level security;
