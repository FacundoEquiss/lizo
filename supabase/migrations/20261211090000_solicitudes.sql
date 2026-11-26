-- Telar · crear cuenta con aprobación del dueño (docs/cuentas.md, «Crear cuenta con aprobación»). Se puede correr dos veces.
-- Online va con `set role tablero_app; set search_path = tablero;` (README, «Online»); no nombra el esquema.
-- Quien llega a la web crea su cuenta con nombre, mail y contraseña, sin enlace ni código: la cuenta nace `pendiente` (no entra a nada,
-- ni a la API, ni al MCP, ni a OAuth, ni a los archivos) hasta que el dueño la aprueba desde Configuración → Amigos. Si la rechaza queda
-- `rechazada` (tampoco entra; el mail queda ocupado unos días). Quien llega con una invitación del dueño sigue entrando directo (`activa`).
-- La versión publicada antes sigue andando con la base ya migrada (no conoce nada de esto); la nueva con la base sin migrar falla solo al
-- pedir una cuenta o al mirar las solicitudes (entrar, invitar y todo lo demás no dependen de esto).

-- `cuentas.estado` era `check (estado in ('activa', 'suspendida'))`, escrito en la columna y sin nombre: Postgres le puso
-- `cuentas_estado_check` (tabla_columna_check; se verifica en servidor/src/solicitudes.prueba.ts con las migraciones anteriores).
-- Se suelta por ese nombre y se vuelve a crear con los cuatro estados; correrlo dos veces suelta y vuelve a crear la misma.
alter table cuentas drop constraint if exists cuentas_estado_check;
alter table cuentas add constraint cuentas_estado_check check (estado in ('activa', 'suspendida', 'pendiente', 'rechazada'));

-- Cuándo pidió la cuenta, cuándo la decidió el dueño y quién (siempre 'dueno'). Sin fecha de pedido (las cuentas de antes), vale `creado_en`.
alter table cuentas add column if not exists solicitada_en timestamptz;
alter table cuentas add column if not exists decidida_en timestamptz;
alter table cuentas add column if not exists decidida_por text;

-- Para contar las solicitudes (pocas) sin recorrer todas las cuentas.
create index if not exists cuentas_solicitud_idx on cuentas (estado, solicitada_en) where estado in ('pendiente', 'rechazada');
