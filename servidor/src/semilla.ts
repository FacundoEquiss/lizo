// Contenido inicial: se crea una sola vez, cuando la base está vacía.
import type { Color } from '../../compartido/tipos'
import type { Ctx, Servicio } from './dominio/servicio'

export const ACTOR_SEMILLA: Ctx = { actor: { tipo: 'sistema', id: 'tablero', nombre: 'Tablero' } }

export async function sembrar(servicio: Servicio, log: (m: string) => void): Promise<{ tableroId: string } | null> {
  const [{ n } = { n: 0 }] = await servicio.db.consulta<{ n: number }>(`select count(*)::int as n from proyectos`)
  if (n > 0) return null

  await servicio.crearMiembro({ nombre: process.env.TABLERO_USUARIO || 'Facundo', tipo: 'humano', color: 'naranja', esYo: true })
  await servicio.asegurarMiembroIA('Claude')

  const proyecto = await servicio.crearProyecto(ACTOR_SEMILLA, {
    nombre: 'Restaurant City',
    prefijo: 'RC',
    color: 'naranja',
    repoGithub: '<usuario>/<repo-del-juego>',
    descripcion: 'Recrear Restaurant City (Playfish, 2009) lo más fiel posible.',
    conTablero: false,
  })
  const tablero = await servicio.crearTablero(ACTOR_SEMILLA, {
    proyectoId: proyecto.id,
    nombre: 'Pendientes',
    descripcion: 'Lo que llega de Discord y lo que falta hacer.',
    // El de la semilla es el tablero grande del dueño (Kanban y el «Mapa del juego» en el lienzo): las tres vistas.
    tipo: 'completo',
    listas: [
      { nombre: 'Bandeja (Discord)', categoria: null },
      { nombre: 'Por decidir', categoria: null },
      { nombre: 'Por hacer', categoria: 'por_hacer' },
      { nombre: 'En curso', categoria: 'en_curso' },
      { nombre: 'Hecho', categoria: 'hecho' },
    ],
  })

  // Marcos vacíos del lienzo, en dos filas.
  const marcos: [string, Color][] = [
    ['Mecánicas', 'naranja'],
    ['Flujos', 'azul'],
    ['Interfaz', 'violeta'],
    ['Economía y balance', 'verde'],
    ['Porqués', 'amarillo'],
  ]
  const ancho = 1120
  const alto = 760
  const sep = 160
  for (const [i, [titulo, color]] of marcos.entries()) {
    const col = i % 3
    const fila = Math.floor(i / 3)
    await servicio.crearElemento(
      ACTOR_SEMILLA,
      tablero.id,
      { tipo: 'marco', x: col * (ancho + sep), y: fila * (alto + sep), ancho, alto, z: 0, datos: { titulo, color } },
      { registrar: false },
    )
  }
  log('contenido inicial creado: proyecto Restaurant City (RC), tablero Pendientes')
  return { tableroId: tablero.id }
}
