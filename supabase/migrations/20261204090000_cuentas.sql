-- Telar · cuentas propias (docs/cuentas.md). Cada cuenta tiene su base propia: no ve ni edita nada de otra cuenta.
-- Solo agrega (y afloja dos índices únicos que pasan a ser por cuenta); se puede correr dos veces.
-- Lo que ya existe es de la cuenta 'dueno' (la del juego, TABLERO_USUARIOS, y la clave del MCP): lo rellenan los defaults
-- de las columnas nuevas, así la versión publicada antes sigue andando con la base ya migrada (no conoce la columna y todo
-- lo que inserta queda de 'dueno').
-- Online va con `set role tablero_app; set search_path = tablero;` (README, «Online»); no nombra el esquema.
-- (verificar los nombres de las restricciones que se sueltan:
--   select conname from pg_constraint where conrelid in ('proyectos'::regclass, 'tarjetas'::regclass) and contype = 'u';)

-- ───── las cuentas ─────
create table if not exists cuentas (
  id text primary key,                                -- 'dueno' o un id corto al azar
  email text,                                         -- en minúsculas; null en 'dueno' hasta que entra
  nombre text not null default '',
  clave_hash text,                                    -- scrypt$N$r$p$sal$hash (null en 'dueno': entra con la cuenta del juego)
  estado text not null default 'activa' check (estado in ('activa', 'suspendida')),
  version_sesion integer not null default 1,          -- sube al cambiar la contraseña: las otras sesiones se cierran
  creado_en timestamptz not null default now(),
  ultimo_ingreso timestamptz
);
create unique index if not exists cuentas_email_idx on cuentas (email) where email is not null;
insert into cuentas (id, nombre) values ('dueno', 'Dueño') on conflict (id) do nothing;

-- Intentos de entrar y de registrarse (por IP y por mail): Vercel no guarda memoria entre pedidos, así que el límite vive acá.
create table if not exists intentos (
  id bigserial primary key,
  clave text not null,                                -- 'entrar:mail:<mail>', 'entrar:ip:<ip>', 'registro:ip:<ip>'
  en timestamptz not null default now()
);
create index if not exists intentos_clave_idx on intentos (clave, en);

-- ───── de quién es cada cosa (la raíz; lo demás cuelga de un proyecto) ─────
alter table proyectos add column if not exists propietario text not null default 'dueno';
create index if not exists proyectos_propietario_idx on proyectos (propietario);
alter table miembros add column if not exists propietario text not null default 'dueno';
create index if not exists miembros_propietario_idx on miembros (propietario);
alter table actividad add column if not exists propietario text not null default 'dueno';
create index if not exists actividad_propietario_idx on actividad (propietario, creado_en desc);
alter table eventos add column if not exists propietario text not null default 'dueno';
create index if not exists eventos_propietario_idx on eventos (propietario, n);
alter table archivos add column if not exists propietario text not null default 'dueno';
create index if not exists archivos_propietario_idx on archivos (propietario);

-- Relleno: las filas que ya estaban quedaron con el default ('dueno'). Por si alguna quedó vacía (no debería):
update proyectos set propietario = 'dueno' where propietario = '';
update miembros set propietario = 'dueno' where propietario = '';

-- El prefijo (RC) y la clave de la tarjeta (RC-12) dejan de ser únicos en toda la base: lo son dentro de cada cuenta.
-- Si no, crear «RC» en otra cuenta contaría que el dueño ya tiene uno.
alter table proyectos drop constraint if exists proyectos_prefijo_key;
create unique index if not exists proyectos_propietario_prefijo_idx on proyectos (propietario, prefijo);
alter table tarjetas drop constraint if exists tarjetas_clave_key;
create unique index if not exists tarjetas_proyecto_clave_idx on tarjetas (proyecto_id, clave);
create index if not exists tarjetas_clave_idx on tarjetas (clave);

alter table cuentas enable row level security;
alter table intentos enable row level security;
