// Siembra un Kanban con muchas tarjetas para mirar las listas largas, vacías y con títulos larguísimos.
//
//   node scripts/sembrar-kanban.mjs --url http://127.0.0.1:4338 [--cantidad 64] [--proyecto RC]
//
// Se niega a apuntar a otra cosa que no sea un Telar LOCAL (127.0.0.1 o localhost): escribe en el tablero «Pendientes» del
// proyecto, así que solo se usa con una base descartable (`TABLERO_DATOS=/tmp/… npm run dev`). Crea: etiquetas, una lista
// con muchas tarjetas (la que obliga a deslizar), una con pocas, una con título largo y una vacía.
const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const URL_BASE = opcion('url', 'http://127.0.0.1:4338')
const CANTIDAD = Number(opcion('cantidad', 64))
const PREFIJO = opcion('proyecto', 'RC')
if (!['127.0.0.1', 'localhost'].includes(new URL(URL_BASE).hostname)) {
  console.error('Solo contra un Telar local (127.0.0.1 o localhost).')
  process.exit(1)
}

const api = async (ruta, metodo = 'GET', cuerpo) => {
  const r = await fetch(URL_BASE + ruta, {
    method: metodo,
    headers: cuerpo ? { 'content-type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${ruta}: ${t}`)
  return t ? JSON.parse(t) : null
}

const proyectos = await api('/api/proyectos')
const proyecto = proyectos.find((p) => p.prefijo === PREFIJO)
if (!proyecto) throw new Error(`No hay un proyecto con prefijo ${PREFIJO}.`)
const tablero = proyecto.tableros[0]
const inicial = await api(`/api/tableros/${tablero.id}`)
const lista = (nombre) => inicial.listas.find((l) => l.nombre === nombre)

const tipos = ['tarea', 'error', 'idea', 'historia', 'pregunta', 'decision']
const prioridades = ['ninguna', 'baja', 'media', 'alta', 'urgente']
const etiquetas = ['cocina', 'mesas', 'clientes', 'arte', 'sonido', 'servidor']
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

async function crear(listaId, titulo, extra = {}) {
  return api('/api/tarjetas', 'POST', { tableroId: tablero.id, listaId, titulo, ...extra })
}

const grande = lista('Por hacer')
for (let i = 0; i < CANTIDAD; i++) {
  await crear(grande.id, `${temas[i % temas.length]} (${i + 1})`, {
    tipo: tipos[i % tipos.length],
    prioridad: prioridades[i % prioridades.length],
    etiquetas: i % 3 === 0 ? [etiquetas[i % etiquetas.length]] : i % 5 === 0 ? [etiquetas[0], etiquetas[2]] : [],
  })
}
const curso = lista('En curso')
for (let i = 0; i < 4; i++) await crear(curso.id, temas[i], { tipo: tipos[i], prioridad: prioridades[i + 1], etiquetas: [etiquetas[i]] })
await crear(
  lista('Por decidir').id,
  'Decidir si el menú de la lista de espera va dentro de la pantalla principal o en una pantalla aparte, con todos los platos, los precios y las recetas que se desbloquean cada semana',
  { tipo: 'decision', prioridad: 'alta', etiquetas: ['cocina'] },
)
console.log(`Listo: ${CANTIDAD} tarjetas en «Por hacer», 4 en «En curso», 1 larga en «Por decidir»; «Hecho» y «Bandeja» vacías.`)
