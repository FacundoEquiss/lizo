-- Tablero · online (24/11/2026)
--
-- Lo que necesita el tablero publicado en Vercel (muchos procesos cortos, sin disco ni memoria compartida):
--   * eventos: cada cambio queda anotado y la web pregunta "¿qué pasó después del n?" (servidor/src/eventos.ts);
--   * archivos: los adjuntos y las imágenes del lienzo van a la base (servidor/src/datos/almacen.ts).
-- En la computadora (PGlite) también se crean, aunque no se usan.

create table if not exists eventos (
  n bigserial primary key,
  datos jsonb not null,
  en timestamptz not null default now()
);
create index if not exists eventos_en_idx on eventos (en);

create table if not exists archivos (
  ruta text primary key,
  mime text not null,
  datos bytea not null,
  tamano integer not null,
  creado_en timestamptz not null default now()
);

alter table eventos enable row level security;
alter table archivos enable row level security;
