-- Telar · agentes de IA (docs/plan-ia-integrada.md, fase 2). Solo agrega; se puede correr dos veces.
-- Online va con `set role tablero_app; set search_path = tablero;` (README, «Online»); no nombra el esquema.
-- La versión publicada antes sigue andando con la base ya migrada: las columnas que se suman a tablas viejas tienen valor por defecto.
-- Sin `check` en lo que va a crecer (proveedores, orígenes de un trabajo): se valida en el código y sumar un valor no pide otra migración.

-- ───── claves de proveedores, cifradas (servidor/src/ia/boveda.ts). Nunca en claro. ─────
create table if not exists ia_claves (
  id text primary key,
  propietario text not null default 'dueno',
  proveedor text not null,                            -- 'anthropic' | 'openai' | 'compatible' | 'disparador' | 'github' (F.3)
  nombre text not null,
  url_base text,                                      -- 'compatible': la dirección de la API; 'disparador': la de la tarea
  cifrada bytea not null,                             -- vector (12) + etiqueta (16) + texto cifrado
  version integer not null default 1,                 -- con qué versión del secreto maestro se cifró
  ultimos4 text not null default '',
  estado text not null default 'sin_probar' check (estado in ('sin_probar', 'valida', 'invalida')),
  probada_en timestamptz,
  error text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists ia_claves_propietario_idx on ia_claves (propietario);

-- ───── la configuración de un agente (1 a 1 con un miembro de tipo 'ia') ─────
create table if not exists ia_agentes (
  miembro_id text primary key references miembros (id) on delete cascade,
  propietario text not null default 'dueno',
  modo text not null default 'api' check (modo in ('api', 'disparador')),
  proveedor text,
  modelo text,
  clave_id text references ia_claves (id) on delete set null,
  esfuerzo text check (esfuerzo in ('bajo', 'medio', 'alto')),   -- null: el del modelo
  instrucciones text not null default '',
  permisos text[] not null default '{comentar,tarjetas,lienzo}', -- de fábrica; 'archivar', 'estructura', 'diseno' y 'codigo' los prende el dueño
  confirmar text not null default 'peligrosas' check (confirmar in ('nunca', 'peligrosas', 'siempre')),
  puede_mencionar_ia boolean not null default false,
  tope_mes_usd numeric(10, 2) not null default 10,
  precio_manual jsonb,                                -- 'compatible' sin precio conocido: USD por millón { entrada, salida, cacheLectura }
  ve_imagenes boolean,                                -- 'compatible': lo declara el dueño
  autonomia text not null default 'sugiere' check (autonomia in ('sugiere', 'actua')),   -- proactividad (F.4)
  disparadores jsonb not null default '{}'::jsonb,    -- { tarjetaNueva: { listas }, resumenDiario: { tableroId }, maxPorDia }: {} = apagado
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists ia_agentes_propietario_idx on ia_agentes (propietario);

-- ───── ajustes de IA de la cuenta ─────
create table if not exists ia_ajustes (
  propietario text primary key,
  tope_mes_usd numeric(10, 2) not null default 25,
  pausada boolean not null default false,
  confirmar_mcp boolean not null default false,       -- pedir permiso también a las IA de afuera (10.5)
  externas_disparan boolean not null default false,   -- las IA de afuera pueden pedirle a los agentes de adentro (12.5)
  repos_codigo text[] not null default '{}',          -- repos de GitHub (dueño/repo) que se pueden leer además de los de los proyectos (F.3)
  actualizado_en timestamptz not null default now()
);

-- ───── trabajos ─────
create table if not exists ia_trabajos (
  id text primary key,                                -- también es la «tanda» de lo que hizo
  propietario text not null default 'dueno',
  agente_id text not null references miembros (id) on delete cascade,
  origen text not null,                               -- 'mencion' | 'pedido' | 'conversacion' (respuesta sin @, F.2) | 'proactivo' (F.4)
  mencion_id text,                                    -- la mención que lo creó (un trabajo por mención)
  clave_unica text,                                   -- un trabajo por cosa que lo dispara: 'conv:<comentario>', 'proactivo:<disparador>:<tarjeta>'
  hilo_id text,                                       -- la charla del panel «Pedile a…»
  superficie text not null,                           -- 'tarjeta' | 'kanban' | 'lienzo' | 'tabla' | 'diseno'
  contexto jsonb not null default '{}'::jsonb,        -- solo ids: proyecto, tablero, tarjeta, objetos, marco, página
  pedido text not null default '',
  pedido_por jsonb not null,                          -- el Actor que lo pidió
  proveedor text not null,                            -- fijados al crear
  modelo text not null,
  estado text not null default 'en_cola'
    check (estado in ('en_cola', 'en_curso', 'esperando_confirmacion', 'pausado_tope', 'hecho', 'fallado', 'cancelado')),
  motivo text,                                        -- por qué está pausado, fallado o cancelado
  haciendo text,                                      -- «Leyendo RC-98…»
  paso integer not null default 0,
  max_pasos integer not null default 12,
  tope_usd numeric(10, 2) not null default 1,         -- tope de costo de este trabajo
  reintentos integer not null default 0,              -- fallos seguidos del proveedor
  cortes integer not null default 0,                  -- veces que se le venció el préstamo
  proximo_en timestamptz not null default now(),      -- no antes de (espera, reintento)
  tomado_por text,
  tomado_hasta timestamptz,                           -- préstamo: hasta cuándo es de quien lo tomó
  cancelar boolean not null default false,
  profundidad integer not null default 0,             -- cadena de IA a IA
  fijo text,                                          -- instrucciones + herramientas, en el formato exacto del proveedor
  resultado jsonb,                                    -- { texto, comentarioId, elementoId }
  tokens_entrada bigint not null default 0,
  tokens_salida bigint not null default 0,
  costo_usd numeric(12, 6) not null default 0,
  ms_trabajado integer not null default 0,
  creado_en timestamptz not null default now(),
  iniciado_en timestamptz,
  terminado_en timestamptz,
  actualizado_en timestamptz not null default now()
);
create unique index if not exists ia_trabajos_mencion_idx on ia_trabajos (mencion_id) where mencion_id is not null;
create unique index if not exists ia_trabajos_unica_idx on ia_trabajos (propietario, clave_unica) where clave_unica is not null;
-- Tomar un trabajo (6.3): lo vivo de la cuenta por orden de `proximo_en`, y «uno por agente» y «dos por cuenta» sobre lo que está en curso.
create index if not exists ia_trabajos_cola_idx on ia_trabajos (propietario, proximo_en) where estado in ('en_cola', 'en_curso');
create index if not exists ia_trabajos_curso_idx on ia_trabajos (propietario, agente_id) where estado = 'en_curso';
create index if not exists ia_trabajos_esperando_idx on ia_trabajos (actualizado_en) where estado in ('esperando_confirmacion', 'pausado_tope');
create index if not exists ia_trabajos_cuenta_idx on ia_trabajos (propietario, creado_en desc);
create index if not exists ia_trabajos_hilo_idx on ia_trabajos (hilo_id, creado_en) where hilo_id is not null;
create index if not exists ia_trabajos_limpieza_idx on ia_trabajos (terminado_en) where fijo is not null;

-- ───── la conversación con el modelo: solo se agrega ─────
create table if not exists ia_mensajes (
  trabajo_id text not null references ia_trabajos (id) on delete cascade,
  n integer not null,
  propietario text not null default 'dueno',
  rol text not null check (rol in ('usuario', 'asistente', 'herramienta', 'sistema')),
  neutro jsonb not null,                              -- la forma común, para mostrar y auditar
  nativo text,                                        -- el JSON EXACTO del proveedor. text y no jsonb: jsonb reordena las claves
  creado_en timestamptz not null default now(),
  primary key (trabajo_id, n)
);

-- ───── el libro de llamadas a herramientas (a lo sumo una vez) ─────
create table if not exists ia_llamadas (
  id text primary key,
  trabajo_id text not null references ia_trabajos (id) on delete cascade,
  propietario text not null default 'dueno',
  paso integer not null,
  orden integer not null,
  id_proveedor text not null,                         -- el id que le puso el modelo
  herramienta text not null,                          -- el nombre real (no «usar_herramienta»)
  argumentos jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'esperando', 'en_curso', 'hecha', 'error', 'denegada', 'incierta')),
  motivo text,                                        -- por qué pide permiso o por qué se negó
  decidida_por jsonb,                                 -- quién permitió o negó
  resultado text,                                     -- lo que se le devolvió al modelo
  imagenes text[] not null default '{}',              -- rutas en el almacén de la cuenta
  efectos jsonb,                                      -- ids tocados
  inversa jsonb,                                      -- cómo deshacerla (ia/inversas.ts)
  deshecha_en timestamptz,
  creado_en timestamptz not null default now(),
  terminado_en timestamptz
);
create unique index if not exists ia_llamadas_orden_idx on ia_llamadas (trabajo_id, paso, orden);

-- ───── gasto ─────
create table if not exists ia_uso (
  id text primary key,
  propietario text not null default 'dueno',
  trabajo_id text,
  agente_id text not null,
  proveedor text not null,
  modelo text not null,
  entrada integer not null default 0,
  salida integer not null default 0,
  cache_lectura integer not null default 0,
  cache_escritura integer not null default 0,
  costo_usd numeric(12, 6) not null default 0,
  estimado boolean not null default false,
  ms integer,
  creado_en timestamptz not null default now()
);
create index if not exists ia_uso_cuenta_idx on ia_uso (propietario, creado_en desc);
create index if not exists ia_uso_trabajo_idx on ia_uso (trabajo_id);

create table if not exists ia_uso_mes (
  propietario text not null,
  mes text not null,                                  -- '2026-11' (UTC)
  agente_id text not null,
  entrada bigint not null default 0,
  salida bigint not null default 0,
  cache_lectura bigint not null default 0,
  cache_escritura bigint not null default 0,
  costo_usd numeric(14, 6) not null default 0,
  llamadas integer not null default 0,
  primary key (propietario, mes, agente_id)
);

-- ───── la tanda: qué hizo cada trabajo, en la actividad ─────
alter table actividad add column if not exists tanda text;
create index if not exists actividad_tanda_idx on actividad (tanda) where tanda is not null;

alter table ia_claves enable row level security;
alter table ia_agentes enable row level security;
alter table ia_ajustes enable row level security;
alter table ia_trabajos enable row level security;
alter table ia_mensajes enable row level security;
alter table ia_llamadas enable row level security;
alter table ia_uso enable row level security;
alter table ia_uso_mes enable row level security;
