// Siembra un tablero con muchas tarjetas en «Hecho» (para mirar el «Ver N anteriores» y el archivo automático), con fechas de
// «llegó a Hecho» repartidas hacia atrás. Escribe directo en la base PGlite de una carpeta de datos DESCARTABLE, con el servidor
// APAGADO (PGlite la abre un solo proceso a la vez):
//
//   TABLERO_DATOS=/tmp/telar-hecho TABLERO_PUERTO=4600 TABLERO_PUERTO_WEB=4601 TABLERO_SEMILLA_DISCORD=no npm run dev   # una vez, para que arme la base; después, apagarlo
//   npx tsx scripts/sembrar-hecho.ts --datos /tmp/telar-hecho [--modo recientes|viejas] [--cantidad 100]
//   (y volver a levantar el servidor)
//
//   recientes (de fábrica): N tarjetas en Hecho, todas de los últimos 28 días: ninguna se archiva sola con los 30 días de fábrica.
//   viejas:                 N tarjetas: el 60 % de hace 31 a 120 días (las junta el archivo automático) y el resto recientes, más
//                           dos viejas que NO se archivan (checklist sin terminar, bloquea a una tarjeta abierta).
//
// Se niega si la carpeta de datos es la del dueño (`.datos/` del repo) o si hay una URL de base online configurada.
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { almacenCarpeta } from '../servidor/src/datos/almacen'
import { migrar } from '../servidor/src/datos/migraciones'
import { abrirPglite } from '../servidor/src/datos/pglite'
import { Servicio } from '../servidor/src/dominio/servicio'
import { BusEventos } from '../servidor/src/eventos'
import { sembrar } from '../servidor/src/semilla'

const args = process.argv.slice(2)
const opcion = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]!
}
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const datos = path.resolve(opcion('datos', ''))
const modo = opcion('modo', 'recientes')
const cantidad = Number(opcion('cantidad', '100'))
if (!opcion('datos', '')) {
  console.error('Falta --datos <carpeta descartable>.')
  process.exit(1)
}
if (datos === path.join(RAIZ, '.datos') || datos.startsWith(path.join(RAIZ, '.datos') + path.sep)) {
  console.error('Esa es la carpeta de datos del dueño: solo una descartable.')
  process.exit(1)
}
if (process.env.TABLERO_DB_URL) {
  console.error('Hay una base online configurada: este script es solo para la base local descartable.')
  process.exit(1)
}

const DIA = 86_400_000
const hace = (dias: number, horas = 0) => new Date(Date.now() - dias * DIA - horas * 3_600_000).toISOString()
const temas = [
  'Que el horno no se trabe al cocinar dos platos',
  'Ajustar el precio de las propinas',
  'Animación de entrada del cliente',
  'Revisar el balance de monedas',
  'Mostrar el tiempo de espera arriba de la mesa',
  'Sonido al terminar una receta',
  'Guardar el avance en la nube',
  'Tutorial de los primeros cinco minutos',
]
const tipos = ['tarea', 'error', 'idea', 'historia', 'decision'] as const
const prioridades = ['ninguna', 'baja', 'media', 'alta', 'urgente'] as const

mkdirSync(datos, { recursive: true })
const db = await abrirPglite(path.join(datos, 'pg'))
try {
  await migrar(db, path.join(RAIZ, 'supabase', 'migrations'))
  const servicio = new Servicio(db, new BusEventos(), almacenCarpeta(path.join(datos, 'archivos')))
  const s = servicio.de('dueno')
  await sembrar(s, () => {})
  const [proyecto] = (await s.listarProyectos()).filter((p) => p.prefijo === 'RC')
  if (!proyecto) throw new Error('No hay un proyecto RC (¿arrancó el servidor una vez para armar la base?).')
  const tablero = proyecto.tableros[0]!
  const listas = Object.fromEntries((await s.listarListas(tablero.id)).map((l) => [l.nombre, l.id]))
  const hecho = listas['Hecho']!
  const ctx = { actor: { tipo: 'humano' as const, id: 'yo', nombre: 'Facundo' }, via: 'local' as const }
  if (existsSync(path.join(datos, 'pg')) === false) throw new Error('no se creó la base')

  const claves: string[] = []
  for (let i = 0; i < cantidad; i++) {
    const viejas = modo === 'viejas' && i < Math.round(cantidad * 0.6)
    const dias = viejas ? 31 + ((i * 7) % 90) : modo === 'viejas' ? (i * 3) % 28 : (i * 0.28) % 28
    const t = await s.crearTarjeta(ctx, {
      tableroId: tablero.id,
      listaId: hecho,
      titulo: `${temas[i % temas.length]} (${i + 1})`,
      tipo: tipos[i % tipos.length],
      prioridad: prioridades[i % prioridades.length],
    })
    await db.consulta(`update tarjetas set completada_en = $2, actualizada_en = $2 where id = $1`, [t.id, hace(dias, i % 24)])
    claves.push(t.clave)
  }

  if (modo === 'viejas') {
    // Dos que son viejas pero Telar no archiva: una checklist sin terminar y una que bloquea a otra tarjeta abierta.
    const conChecklist = await s.crearTarjeta(ctx, { tableroId: tablero.id, listaId: hecho, titulo: 'Vieja, con la checklist sin terminar' })
    await s.crearChecklist(ctx, conChecklist.clave, 'Pasos', ['Uno', 'Dos'])
    const bloquea = await s.crearTarjeta(ctx, { tableroId: tablero.id, listaId: hecho, titulo: 'Vieja, pero bloquea a una que sigue abierta' })
    const abierta = await s.crearTarjeta(ctx, { tableroId: tablero.id, listaId: listas['En curso'], titulo: 'Sigue abierta' })
    await s.vincular(ctx, bloquea.clave, 'bloquea', abierta.clave)
    for (const t of [conChecklist, bloquea]) await db.consulta(`update tarjetas set completada_en = $2, actualizada_en = $2 where id = $1`, [t.id, hace(75)])
  }
  console.log(`Listo: ${claves.length} tarjetas en Hecho de «${tablero.nombre}» (${proyecto.prefijo}), modo ${modo}.`)
} finally {
  await db.cerrar()
}
