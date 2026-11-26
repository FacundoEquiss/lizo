-- Tablero · esquema inicial
--
-- SQL plano de Postgres: corre igual en PGlite (la base local en .datos/) y en
-- Supabase (`supabase db push` o pegándolo en el editor SQL). Reglas para que
-- siga siendo compatible:
--   * nada específico de PGlite ni de Supabase;
--   * IDs de texto (nanoid) generados por la app;
--   * columnas de orden con collate "C" (índices fraccionales: orden por bytes);
--   * RLS activado en todas las tablas: el servidor entra con una conexión de
--     servicio (que no pasa por RLS) y la clave pública de Supabase no ve nada
--     hasta que se escriban políticas.

create table if not exists miembros (
  id text primary key,
  nombre text not null,
  tipo text not null default 'humano' check (tipo in ('humano', 'ia')),
  color text not null default 'naranja',
  iniciales text not null default '',
  es_yo boolean not null default false,
  creado_en timestamptz not null default now()
);

create table if not exists proyectos (
  id text primary key,
  nombre text not null,
  descripcion text not null default '',
  color text not null default 'naranja',
  prefijo text not null unique check (prefijo ~ '^[A-Z][A-Z0-9]{0,9}$'),
  repo_github text,
  siguiente_numero integer not null default 1,
  orden text collate "C" not null,
  archivado boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists tableros (
  id text primary key,
  proyecto_id text not null references proyectos (id) on delete cascade,
  nombre text not null,
  slug text not null,
  descripcion text not null default '',
  orden text collate "C" not null,
  archivado boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (proyecto_id, slug)
);

create table if not exists listas (
  id text primary key,
  tablero_id text not null references tableros (id) on delete cascade,
  nombre text not null,
  orden text collate "C" not null,
  -- Si la lista tiene categoría, mover una tarjeta ahí cambia su estado (como en Jira).
  categoria text check (categoria in ('por_hacer', 'en_curso', 'hecho')),
  color text,
  limite integer check (limite is null or limite > 0),
  archivada boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists listas_tablero_idx on listas (tablero_id, orden);

create table if not exists etiquetas (
  id text primary key,
  proyecto_id text not null references proyectos (id) on delete cascade,
  nombre text not null,
  color text not null default 'gris',
  grupo text,
  orden text collate "C" not null,
  creado_en timestamptz not null default now(),
  unique (proyecto_id, nombre)
);

create table if not exists tarjetas (
  id text primary key,
  proyecto_id text not null references proyectos (id) on delete cascade,
  tablero_id text not null references tableros (id) on delete cascade,
  lista_id text references listas (id) on delete set null,
  numero integer not null,
  clave text not null unique,
  orden text collate "C" not null,
  padre_id text references tarjetas (id) on delete set null,
  tipo text not null default 'tarea'
    check (tipo in ('epica', 'historia', 'tarea', 'error', 'idea', 'pregunta', 'decision')),
  titulo text not null,
  descripcion text not null default '',
  prioridad text not null default 'ninguna'
    check (prioridad in ('urgente', 'alta', 'media', 'baja', 'ninguna')),
  estimacion numeric,
  fecha_inicio timestamptz,
  fecha_vence timestamptz,
  vence_con_hora boolean not null default false,
  completada_en timestamptz,
  portada jsonb,
  -- Campos personalizados y datos de origen (por ejemplo, lo que trae el importador de Discord).
  campos jsonb not null default '{}'::jsonb,
  -- Referencia externa para importar sin duplicar: 'discord:DC-01'.
  ref_externa text,
  origen jsonb,
  archivada boolean not null default false,
  archivada_en timestamptz,
  es_plantilla boolean not null default false,
  -- Texto normalizado (minúsculas, sin tildes) con todo lo buscable de la tarjeta.
  busqueda text not null default '',
  -- Control de concurrencia optimista: la IA y la persona pueden editar a la vez.
  version integer not null default 1,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  unique (proyecto_id, numero)
);
create index if not exists tarjetas_lista_idx on tarjetas (tablero_id, lista_id, orden);
create index if not exists tarjetas_padre_idx on tarjetas (padre_id);
create unique index if not exists tarjetas_ref_externa_idx on tarjetas (proyecto_id, ref_externa)
  where ref_externa is not null;

create table if not exists tarjeta_etiquetas (
  tarjeta_id text not null references tarjetas (id) on delete cascade,
  etiqueta_id text not null references etiquetas (id) on delete cascade,
  primary key (tarjeta_id, etiqueta_id)
);

create table if not exists tarjeta_responsables (
  tarjeta_id text not null references tarjetas (id) on delete cascade,
  miembro_id text not null references miembros (id) on delete cascade,
  primary key (tarjeta_id, miembro_id)
);

-- EL PORQUÉ: por qué existe la tarjeta, con la forma de un registro de decisión
-- (contexto → opciones → decisión → consecuencias). Estructurado y buscable.
create table if not exists porques (
  tarjeta_id text primary key references tarjetas (id) on delete cascade,
  motivo text not null default '',
  contexto text not null default '',
  opciones jsonb not null default '[]'::jsonb,
  decision text not null default '',
  consecuencias text not null default '',
  estado text not null default 'abierta'
    check (estado in ('abierta', 'propuesta', 'aceptada', 'rechazada', 'reemplazada')),
  evidencias jsonb not null default '[]'::jsonb,
  decidieron text[] not null default '{}',
  decidida_en timestamptz,
  revisar_en timestamptz,
  reemplazada_por text references tarjetas (id) on delete set null,
  actualizado_en timestamptz not null default now()
);

create table if not exists checklists (
  id text primary key,
  tarjeta_id text not null references tarjetas (id) on delete cascade,
  titulo text not null default 'Checklist',
  orden text collate "C" not null,
  ocultar_hechos boolean not null default false,
  creado_en timestamptz not null default now()
);
create index if not exists checklists_tarjeta_idx on checklists (tarjeta_id);

create table if not exists checklist_items (
  id text primary key,
  checklist_id text not null references checklists (id) on delete cascade,
  texto text not null,
  hecho boolean not null default false,
  responsable_id text references miembros (id) on delete set null,
  vence timestamptz,
  orden text collate "C" not null,
  creado_en timestamptz not null default now()
);
create index if not exists checklist_items_idx on checklist_items (checklist_id, orden);

create table if not exists adjuntos (
  id text primary key,
  tarjeta_id text not null references tarjetas (id) on delete cascade,
  nombre text not null,
  -- Ruta dentro de .datos/archivos (o del bucket de Storage al pasar a Supabase).
  ruta text,
  url text,
  mime text,
  tamano bigint,
  descripcion text not null default '',
  es_imagen boolean not null default false,
  creado_por jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists adjuntos_tarjeta_idx on adjuntos (tarjeta_id);

create table if not exists comentarios (
  id text primary key,
  tarjeta_id text not null references tarjetas (id) on delete cascade,
  autor jsonb not null,
  cuerpo text not null,
  menciones text[] not null default '{}',
  creado_en timestamptz not null default now(),
  editado_en timestamptz
);
create index if not exists comentarios_tarjeta_idx on comentarios (tarjeta_id, creado_en);

-- Enlaces externos con chip: GitHub (issue, PR, commit, rama), Figma, Discord o web.
create table if not exists enlaces (
  id text primary key,
  tarjeta_id text not null references tarjetas (id) on delete cascade,
  tipo text not null check (tipo in (
    'github_issue', 'github_pr', 'github_commit', 'github_rama', 'github_repo', 'figma', 'discord', 'web'
  )),
  url text not null,
  titulo text not null default '',
  datos jsonb not null default '{}'::jsonb,
  creado_por jsonb,
  creado_en timestamptz not null default now(),
  unique (tarjeta_id, url)
);

-- Vínculos entre tarjetas. Se guarda una sola dirección; la vuelta se calcula
-- ("depende de" es la vuelta de "bloquea", como en Jira).
create table if not exists vinculos (
  id text primary key,
  origen_id text not null references tarjetas (id) on delete cascade,
  destino_id text not null references tarjetas (id) on delete cascade,
  tipo text not null check (tipo in ('bloquea', 'relacionada', 'duplica', 'causa', 'implementa')),
  nota text not null default '',
  creado_por jsonb,
  creado_en timestamptz not null default now(),
  unique (origen_id, destino_id, tipo),
  check (origen_id <> destino_id)
);
create index if not exists vinculos_destino_idx on vinculos (destino_id);

-- Lienzo infinito: cada objeto tiene posición y tamaño absolutos. Los de tipo
-- 'tarjeta' y 'lista' solo apuntan a la tarjeta o la lista: una tarjeta, muchas vistas.
create table if not exists elementos_lienzo (
  id text primary key,
  tablero_id text not null references tableros (id) on delete cascade,
  tipo text not null check (tipo in ('nota', 'texto', 'forma', 'marco', 'tarjeta', 'lista', 'imagen', 'enlace', 'figma')),
  x double precision not null default 0,
  y double precision not null default 0,
  ancho double precision not null default 200,
  alto double precision not null default 200,
  z integer not null default 0,
  tarjeta_id text references tarjetas (id) on delete cascade,
  lista_id text references listas (id) on delete cascade,
  datos jsonb not null default '{}'::jsonb,
  bloqueado boolean not null default false,
  -- Borrado suave: deshacer y papelera.
  eliminado_en timestamptz,
  creado_por jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists elementos_tablero_idx on elementos_lienzo (tablero_id) where eliminado_en is null;

-- Conectores (flechas) entre objetos del lienzo. Compatibles con JSON Canvas.
create table if not exists conectores (
  id text primary key,
  tablero_id text not null references tableros (id) on delete cascade,
  desde_id text not null references elementos_lienzo (id) on delete cascade,
  desde_lado text check (desde_lado in ('arriba', 'derecha', 'abajo', 'izquierda')),
  hasta_id text not null references elementos_lienzo (id) on delete cascade,
  hasta_lado text check (hasta_lado in ('arriba', 'derecha', 'abajo', 'izquierda')),
  trazo text not null default 'curvo' check (trazo in ('recto', 'ortogonal', 'curvo')),
  punta_inicio text not null default 'ninguna' check (punta_inicio in ('ninguna', 'flecha', 'punto')),
  punta_fin text not null default 'flecha' check (punta_fin in ('ninguna', 'flecha', 'punto')),
  color text,
  grosor real not null default 2,
  etiqueta text not null default '',
  eliminado_en timestamptz,
  creado_por jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists conectores_tablero_idx on conectores (tablero_id) where eliminado_en is null;

-- Actividad: registro que solo crece. Historial, auditoría de lo que hizo la IA
-- (con su autor) y base del "qué cambió". Sin claves foráneas: sobrevive al archivo.
create table if not exists actividad (
  id text primary key,
  proyecto_id text,
  tablero_id text,
  tarjeta_id text,
  tarjeta_clave text,
  actor jsonb not null,
  accion text not null,
  resumen text not null,
  detalle jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists actividad_tablero_idx on actividad (tablero_id, creado_en desc);
create index if not exists actividad_tarjeta_idx on actividad (tarjeta_id, creado_en desc);

alter table miembros enable row level security;
alter table proyectos enable row level security;
alter table tableros enable row level security;
alter table listas enable row level security;
alter table etiquetas enable row level security;
alter table tarjetas enable row level security;
alter table tarjeta_etiquetas enable row level security;
alter table tarjeta_responsables enable row level security;
alter table porques enable row level security;
alter table checklists enable row level security;
alter table checklist_items enable row level security;
alter table adjuntos enable row level security;
alter table comentarios enable row level security;
alter table enlaces enable row level security;
alter table vinculos enable row level security;
alter table elementos_lienzo enable row level security;
alter table conectores enable row level security;
alter table actividad enable row level security;
