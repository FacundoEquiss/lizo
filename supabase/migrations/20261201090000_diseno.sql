-- Telar · Diseño (docs/plan-diseno.md, 3.3). Genérico por proyecto: páginas → marcos (HTML + CSS) → capas, y el sistema
-- de diseño (tokens, estilos de texto, colores sueltos, activos, fuentes, hojas, piezas, textos, plantillas).
-- Solo AGREGA tablas: la versión publicada sigue andando con la base ya migrada. Idempotente (if not exists).
-- Local (PGlite) corre sola al arrancar. Online se aplica a mano con el dueño del esquema (README, "Online"):
--   set role tablero_app; set search_path = tablero;  <este archivo>;
--   insert into tablero_migraciones (nombre) values ('20261201090000_diseno.sql');
-- IDs de texto (nanoid), RLS activado, orden con collate "C".

create table if not exists diseno_config (            -- una fila por proyecto, se crea al abrir Diseño por primera vez
  proyecto_id text primary key references proyectos (id) on delete cascade,
  perfil jsonb not null default '{}'::jsonb,          -- perfil de importación (plan 5.2)
  importacion integer not null default 0,             -- número de la importación vigente
  importado_en timestamptz,
  origen jsonb,                                       -- { repo, rama, commit, url } de la última importación
  pedido_en timestamptz,                              -- "pedirle a Claude que sincronice"
  ajustes jsonb not null default '{}'::jsonb
);

create table if not exists diseno_paginas (
  id text primary key,
  proyecto_id text not null references proyectos (id) on delete cascade,
  nombre text not null,
  slug text not null,
  tipo text not null default 'lienzo' check (tipo in ('lienzo', 'sistema', 'tabla')),
  origen text not null default 'propio' check (origen in ('propio', 'importado')),
  datos jsonb not null default '{}'::jsonb,           -- sistema/tabla: { tipos: [...], filtro }; lienzo: { fondo }
  orden text collate "C" not null,
  archivada boolean not null default false,
  creado_en timestamptz not null default now(),
  unique (proyecto_id, slug)
);

create table if not exists diseno_marcos (
  id text primary key,
  proyecto_id text not null references proyectos (id) on delete cascade,
  pagina_id text not null references diseno_paginas (id) on delete cascade,
  nombre text not null,
  seccion text not null default '',
  grupo text,                                         -- juego de variantes
  x double precision not null default 0,
  y double precision not null default 0,
  ancho integer not null check (ancho between 16 and 8192),
  alto integer not null check (alto between 16 and 8192),
  html text not null default '',
  css text not null default '',
  hojas jsonb not null default '[]'::jsonb,           -- claves de ítems tipo hoja que usa, en orden
  datos jsonb not null default '{}'::jsonb,           -- { fondo, modo, prefijado, plantilla, estado, vista, escala, raizClase, cajas… }
  origen text not null default 'propio' check (origen in ('propio', 'importado')),
  clave text,                                         -- estable para lo importado: "pantalla:celular/hud"
  hash text,
  miniatura text,                                     -- ruta en el almacén
  revision integer not null default 1,
  bloqueado boolean not null default false,
  archivado_en timestamptz,
  creado_por jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists diseno_marcos_pagina_idx on diseno_marcos (pagina_id) where archivado_en is null;
create unique index if not exists diseno_marcos_clave_idx on diseno_marcos (proyecto_id, clave) where clave is not null;

create table if not exists diseno_revisiones (        -- para deshacer y volver atrás: las últimas 50 por marco
  marco_id text not null references diseno_marcos (id) on delete cascade,
  n integer not null,
  html text not null, css text not null, datos jsonb not null, ancho integer not null, alto integer not null,
  actor jsonb, resumen text not null default '',
  creado_en timestamptz not null default now(),
  primary key (marco_id, n)
);

create table if not exists diseno_items (
  proyecto_id text not null references proyectos (id) on delete cascade,
  tipo text not null check (tipo in ('token','estilo_texto','color_suelto','activo','fuente','hoja','pieza','texto','plantilla')),
  clave text not null,                                -- "color/marca/primario", "btn-ok", "masPesos", "ui.css"
  nombre text not null,
  grupo text not null default '',
  datos jsonb not null default '{}'::jsonb,
  origen text not null default 'propio' check (origen in ('propio', 'importado')),
  hash text,
  importacion integer,                                -- con qué importación llegó (null = propio)
  orden text collate "C" not null default 'a0',
  archivado boolean not null default false,
  actualizado_en timestamptz not null default now(),
  primary key (proyecto_id, tipo, clave)
);
create index if not exists diseno_items_grupo_idx on diseno_items (proyecto_id, tipo, grupo);

create table if not exists diseno_notas (
  proyecto_id text not null references proyectos (id) on delete cascade,
  objetivo text not null,                             -- "item:token:--rc-azul" | "marco:<id>"
  nombre_propio text, uso text, nota text,
  estado text check (estado in ('vigente', 'revisar', 'viejo')),
  actualizado_por jsonb, actualizado_en timestamptz not null default now(),
  primary key (proyecto_id, objetivo)
);

create table if not exists diseno_comentarios (
  id text primary key,
  proyecto_id text not null references proyectos (id) on delete cascade,
  objetivo text not null,                             -- "marco:<id>" | "marco:<id>#<capa>" | "item:<tipo>:<clave>"
  x double precision, y double precision,             -- punto dentro del marco (px del marco), opcional
  texto text not null,
  respuesta_a text references diseno_comentarios (id) on delete cascade,
  resuelto boolean not null default false,
  autor jsonb not null,
  creado_en timestamptz not null default now()
);
create index if not exists diseno_comentarios_idx on diseno_comentarios (proyecto_id, objetivo);

create table if not exists diseno_vinculos (          -- una campaña = tarjetas + diseños
  proyecto_id text not null references proyectos (id) on delete cascade,
  objetivo text not null,                             -- "marco:<id>" | "pagina:<id>" | "item:<tipo>:<clave>"
  tarjeta_id text not null references tarjetas (id) on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (objetivo, tarjeta_id)
);
create index if not exists diseno_vinculos_tarjeta_idx on diseno_vinculos (tarjeta_id);

create table if not exists diseno_importaciones (     -- el historial: qué cambió en cada sincronización
  proyecto_id text not null references proyectos (id) on delete cascade,
  n integer not null,
  estado text not null default 'subiendo' check (estado in ('subiendo', 'lista', 'descartada')),
  origen jsonb not null default '{}'::jsonb,
  cambios jsonb not null default '[]'::jsonb,         -- [{ tipo, clave, que: 'nuevo'|'cambio'|'quitado', antes? }]
  resumen jsonb not null default '{}'::jsonb,
  actor jsonb, creado_en timestamptz not null default now(),
  primary key (proyecto_id, n)
);

create table if not exists diseno_paso (              -- lo que va llegando de una importación, hasta "terminar"
  proyecto_id text not null references proyectos (id) on delete cascade,
  n integer not null,
  parte integer not null,
  datos jsonb not null,
  primary key (proyecto_id, n, parte)
);

alter table diseno_paso enable row level security;
alter table diseno_config enable row level security;
alter table diseno_paginas enable row level security;
alter table diseno_marcos enable row level security;
alter table diseno_revisiones enable row level security;
alter table diseno_items enable row level security;
alter table diseno_notas enable row level security;
alter table diseno_comentarios enable row level security;
alter table diseno_vinculos enable row level security;
alter table diseno_importaciones enable row level security;
