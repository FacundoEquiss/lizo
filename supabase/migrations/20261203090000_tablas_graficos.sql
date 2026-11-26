-- Telar 0.3: el lienzo acepta tablas y gráficos. Solo amplía la lista de tipos de objeto; los datos de cada uno van en
-- elementos_lienzo.datos (JSON), así que no hay tablas nuevas. Se puede correr dos veces.
-- La versión publicada antes sigue andando con la base ya migrada (la lista solo crece).
-- Online va con `set search_path = tablero` y, ANTES de publicar el código nuevo (si no, crear una tabla daría error).
-- (verificar el nombre: select conname from pg_constraint where conrelid = 'elementos_lienzo'::regclass and contype = 'c';)
alter table elementos_lienzo drop constraint if exists elementos_lienzo_tipo_check;
alter table elementos_lienzo add constraint elementos_lienzo_tipo_check
  check (tipo in ('nota', 'texto', 'forma', 'marco', 'tarjeta', 'lista', 'imagen', 'enlace', 'figma', 'tabla', 'grafico'));
