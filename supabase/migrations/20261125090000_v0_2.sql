-- Telar 0.2: foto y emoji del proyecto, ajustes del tablero, más estilos de conector.
--
-- Solo agrega: la 0.1 publicada sigue funcionando con la base ya migrada, así que online se aplica ANTES de publicar
-- la 0.2. Se puede correr dos veces seguidas sin error. El estilo de los objetos del lienzo (fuente, alineación,
-- borde…) no pide columnas: va en elementos_lienzo.datos.

alter table proyectos add column if not exists imagen text;
alter table proyectos add column if not exists emoji text;

alter table tableros add column if not exists ajustes jsonb not null default '{}'::jsonb;

alter table conectores add column if not exists guion text not null default 'solido';
alter table conectores drop constraint if exists conectores_guion_check;
alter table conectores add constraint conectores_guion_check check (guion in ('solido', 'rayado', 'punteado'));

alter table conectores drop constraint if exists conectores_punta_inicio_check;
alter table conectores add constraint conectores_punta_inicio_check
  check (punta_inicio in ('ninguna', 'flecha', 'flecha_abierta', 'triangulo', 'punto', 'rombo', 'barra'));
alter table conectores drop constraint if exists conectores_punta_fin_check;
alter table conectores add constraint conectores_punta_fin_check
  check (punta_fin in ('ninguna', 'flecha', 'flecha_abierta', 'triangulo', 'punto', 'rombo', 'barra'));
