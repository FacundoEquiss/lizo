-- Telar · archivo automático de las listas de «Hecho». Solo agrega; se puede correr dos veces.
-- Online va con `set role tablero_app; set search_path = tablero;` (README, «Online»); no nombra el esquema.
-- No crea tablas: `tableros` y `tarjetas` ya tienen seguridad por fila y su dueño (`propietario`, vía el proyecto).
-- La opción en sí (a los cuántos días) vive en `tableros.ajustes -> 'archivoHecho'`: sin valor, valen los 30 días de fábrica.
-- La versión publicada antes sigue andando con la base ya migrada, y la nueva sigue andando (sin archivar solas) con la base
-- sin migrar: el archivo automático nunca rompe abrir el tablero.

-- Cuándo corrió por última vez el archivo automático de este tablero: tope de una vez por hora, sin importar cuántas
-- pestañas, dispositivos o instancias lo abran a la vez (el primero que lo toma, lo corre).
alter table tableros add column if not exists archivo_hecho_en timestamptz;

-- Para encontrar rápido, en un tablero, lo que llegó a Hecho hace mucho (y sigue sin archivar).
create index if not exists tarjetas_hecho_viejas_idx on tarjetas (tablero_id, completada_en)
  where not archivada and completada_en is not null;
