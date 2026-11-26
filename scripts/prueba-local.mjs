// Piezas comunes de las pruebas locales del celular y de la PWA (scripts/capturas-movil.mjs y scripts/revisar-pwa.mjs):
//   · levantar la app con una base propia y descartable (nunca la del dueño ni la de producción);
//   · sembrarla con unas 20 tarjetas de prueba (una con porqué completo, checklist, adjunto y comentarios);
//   · cargar Playwright, que no es dependencia del repo (existe en el entorno de pruebas).
import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync, crc32 } from 'node:zlib'

export const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

/** Playwright del proyecto si algún día se instala; si no, el global del entorno. */
export async function importarPlaywright() {
  try {
    return await import('playwright')
  } catch {
    const global = execSync('npm root -g', { encoding: 'utf8' }).trim()
    const ruta = path.join(global, 'playwright', 'index.mjs')
    if (!existsSync(ruta)) throw new Error('No encontré Playwright (ni en el proyecto ni global).')
    return await import(pathToFileURL(ruta).href)
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function esperarSalud(url, tope = 90_000) {
  const hasta = Date.now() + tope
  while (Date.now() < hasta) {
    try {
      const r = await fetch(`${url}/api/salud`, { signal: AbortSignal.timeout(2000) })
      if (r.ok) {
        const d = await r.json()
        if (d.listo) return
      }
    } catch {}
    await esperar(400)
  }
  throw new Error(`La app no respondió en ${url}`)
}

/**
 * Levanta la app con una base nueva en `datos` (se borra antes). modo 'dev' = npm run dev (Vite + servidor);
 * 'produccion' = npm start (sirve dist/web; hay que compilar antes). Devuelve la URL de la web y cómo pararla.
 */
export async function levantar({ modo = 'dev', datos, puerto = 4418, puertoWeb = 4417, semilla = null, log = false } = {}) {
  if (!datos) throw new Error('Falta la carpeta de datos de prueba.')
  rmSync(datos, { recursive: true, force: true })
  if (semilla && existsSync(semilla)) cpSync(semilla, datos, { recursive: true })
  mkdirSync(datos, { recursive: true })
  const env = {
    ...process.env,
    TABLERO_DATOS: datos,
    TABLERO_PUERTO: String(puerto),
    TABLERO_PUERTO_WEB: String(puertoWeb),
    TABLERO_SEMILLA_DISCORD: 'no',
    // Nombre de prueba: las capturas nunca llevan datos del dueño.
    TABLERO_USUARIO: 'Ana',
  }
  delete env.TABLERO_DB_URL
  delete env.TABLERO_PUBLICO
  const args = modo === 'dev' ? ['run', 'dev'] : ['start']
  const hijo = spawn('npm', args, { cwd: RAIZ, env, detached: true, stdio: log ? 'inherit' : 'ignore' })
  const url = modo === 'dev' ? `http://127.0.0.1:${puertoWeb}` : `http://127.0.0.1:${puerto}`
  const parar = async () => {
    try {
      process.kill(-hijo.pid, 'SIGTERM')
    } catch {}
    for (let i = 0; i < 40; i++) {
      try {
        process.kill(-hijo.pid, 0)
      } catch {
        return
      }
      await esperar(150)
    }
    try {
      process.kill(-hijo.pid, 'SIGKILL')
    } catch {}
  }
  try {
    await esperarSalud(url)
  } catch (e) {
    await parar()
    throw e
  }
  return { url, parar }
}

// ───────── API ─────────

export function clienteApi(base) {
  const pedir = async (metodo, ruta, cuerpo, cabeceras = {}) => {
    const esForm = cuerpo instanceof FormData
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(cuerpo !== undefined && !esForm ? { 'content-type': 'application/json' } : {}), ...cabeceras },
      body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
    })
    const texto = await r.text()
    const datos = texto ? JSON.parse(texto) : null
    if (!r.ok) throw new Error(`${metodo} ${ruta}: ${r.status} ${datos?.error ?? texto}`)
    return datos
  }
  return {
    get: (r) => pedir('GET', r),
    post: (r, c = {}, h) => pedir('POST', r, c, h),
    put: (r, c) => pedir('PUT', r, c),
    patch: (r, c) => pedir('PATCH', r, c),
  }
}

// ───────── PNG chico sin dependencias (para el adjunto de prueba) ─────────

function png(ancho, alto, pixel) {
  const filas = Buffer.alloc((ancho * 3 + 1) * alto)
  for (let y = 0; y < alto; y++) {
    const o = y * (ancho * 3 + 1)
    filas[o] = 0
    for (let x = 0; x < ancho; x++) {
      const [r, g, b] = pixel(x, y)
      filas[o + 1 + x * 3] = r
      filas[o + 2 + x * 3] = g
      filas[o + 3 + x * 3] = b
    }
  }
  const bloque = (tipo, datos) => {
    const largo = Buffer.alloc(4)
    largo.writeUInt32BE(datos.length)
    const td = Buffer.concat([Buffer.from(tipo), datos])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([largo, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(ancho, 0)
  ihdr.writeUInt32BE(alto, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(filas)),
    bloque('IEND', Buffer.alloc(0)),
  ])
}

/** Un "boceto" de 640×360: degradado cálido con tres franjas que parecen mesas. */
function boceto() {
  return png(640, 360, (x, y) => {
    const t = y / 360
    let r = 246 - t * 40
    let g = 214 - t * 60
    let b = 170 - t * 70
    const mesa = (cx, cy) => (x - cx) ** 2 / 3200 + (y - cy) ** 2 / 900 < 1
    if (mesa(150, 210) || mesa(330, 240) || mesa(500, 200)) {
      r = 150
      g = 92
      b = 52
    }
    if (y > 300) {
      r -= 30
      g -= 30
      b -= 20
    }
    return [Math.max(0, r | 0), Math.max(0, g | 0), Math.max(0, b | 0)]
  })
}

// ───────── Semilla ─────────

const hoy = () => {
  const d = new Date()
  d.setHours(18, 0, 0, 0)
  return d
}
const enDias = (n) => {
  const d = hoy()
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

const TARJETAS = [
  // Bandeja (Discord)
  { lista: 0, titulo: '¿Los mozos pueden llevar dos platos a la vez?', tipo: 'pregunta', etiquetas: ['Clientes'] },
  { lista: 0, titulo: 'Música distinta de noche y de día', tipo: 'idea', etiquetas: ['Sonido'] },
  { lista: 0, titulo: 'El horno se traba si se cocinan dos platos seguidos', tipo: 'error', prioridad: 'alta', etiquetas: ['Cocina'], responsables: ['yo'], vence: 1 },
  // Por decidir
  { lista: 1, titulo: 'Precio de las hamburguesas: 12 o 15 pesos', tipo: 'decision', prioridad: 'media', etiquetas: ['Economía'], responsables: ['yo', 'Claude'], completa: true },
  { lista: 1, titulo: 'Mesas para cuatro en la vereda', tipo: 'idea', etiquetas: ['Decoración'] },
  { lista: 1, titulo: '¿Cuántos clientes entran por hora al principio?', tipo: 'pregunta', etiquetas: ['Economía'] },
  // Por hacer
  { lista: 2, titulo: 'Animación del cocinero al servir', tipo: 'tarea', etiquetas: ['Cocina'], responsables: ['Claude'] },
  { lista: 2, titulo: 'La puerta se superpone con la ventana en el local de 12×12', tipo: 'error', prioridad: 'urgente', etiquetas: ['Interfaz'], vence: -2 },
  { lista: 2, titulo: 'Como jugador quiero ver el menú del día', tipo: 'historia', etiquetas: ['Clientes'] },
  { lista: 2, titulo: 'Sonido de caja registradora al cobrar', tipo: 'tarea', prioridad: 'media', etiquetas: ['Sonido'] },
  { lista: 2, titulo: 'Revisar los textos del tutorial', tipo: 'tarea', prioridad: 'baja', etiquetas: ['Interfaz'] },
  { lista: 2, titulo: 'Clientes VIP con propina doble', tipo: 'idea', etiquetas: ['Economía'] },
  // En curso
  { lista: 3, titulo: 'Hoja de modelo del mozo (frente y espalda)', tipo: 'tarea', etiquetas: ['Interfaz'], responsables: ['yo'], vence: 0 },
  { lista: 3, titulo: 'El pollo sale crudo en la receta de pastas', tipo: 'error', prioridad: 'alta', etiquetas: ['Cocina'], responsables: ['Claude'] },
  { lista: 3, titulo: 'Primera versión jugable', tipo: 'epica' },
  // Hecho
  { lista: 4, titulo: 'Grilla del local de 12×12', tipo: 'tarea' },
  { lista: 4, titulo: 'Paleta de colores del salón', tipo: 'tarea', etiquetas: ['Decoración'] },
  { lista: 4, titulo: 'Como jugador quiero mover las mesas', tipo: 'historia' },
  { lista: 4, titulo: 'Fuentes Fredoka y Nunito', tipo: 'tarea', etiquetas: ['Interfaz'] },
  { lista: 4, titulo: 'Los clientes atravesaban las paredes', tipo: 'error' },
]

const ETIQUETAS = [
  ['Interfaz', 'violeta'],
  ['Cocina', 'naranja'],
  ['Clientes', 'azul'],
  ['Economía', 'verde'],
  ['Sonido', 'celeste'],
  ['Decoración', 'rosa'],
]

const PORQUE = {
  motivo: 'Con 12 pesos la hamburguesa deja menos ganancia que la sopa, y el jugador no tiene motivo para cocinarla.',
  contexto: 'En Restaurant City los platos de carne pagaban más que los vegetarianos. Hoy la sopa cuesta 10 y se cocina en la mitad de tiempo.',
  opciones: [
    { titulo: '12 pesos', pros: 'Más barata: entran más clientes', contras: 'Gana menos que la sopa', descartadaPorque: 'No compensa el tiempo de cocción' },
    { titulo: '15 pesos', pros: 'Paga el tiempo de cocción', contras: 'Los clientes nuevos la piden menos', elegida: true },
    { titulo: 'Precio según la hora', pros: 'Se siente vivo', contras: 'Difícil de entender al principio', descartadaPorque: 'Lo dejamos para más adelante' },
  ],
  decision: 'Queda en 15 pesos desde el nivel 3. Antes del nivel 3 no se puede cocinar.',
  consecuencias: 'Hay que subir la propina de la sopa para que no quede atrás. Revisar en dos semanas con los números del tutorial.',
  estado: 'aceptada',
  evidencias: ['https://github.com/ejemplo/restaurante/issues/42'],
}

/** Crea el contenido de prueba (una sola vez: si ya está, no hace nada). Devuelve las claves útiles. */
export async function sembrar(base) {
  const api = clienteApi(base)
  const proyectos = await api.get('/api/proyectos')
  const rc = proyectos.find((p) => p.prefijo === 'RC')
  if (!rc) throw new Error('No está el proyecto RC de la semilla del servidor.')
  const tableroId = rc.tableros[0].id
  let tablero = await api.get(`/api/tableros/${tableroId}`)
  const ya = tablero.tarjetas.find((t) => t.titulo === TARJETAS[2].titulo)
  if (ya) return { tableroId, prefijo: rc.prefijo, slug: rc.tableros[0].slug, decision: tablero.tarjetas.find((t) => t.tipo === 'decision')?.clave }

  for (const [nombre, color] of ETIQUETAS) await api.post(`/api/proyectos/${rc.id}/etiquetas`, { nombre, color })
  const listas = [...tablero.listas].sort((a, b) => (a.orden < b.orden ? -1 : 1))
  let decision = null
  for (const t of TARJETAS) {
    const r = await api.post('/api/tarjetas', {
      tableroId,
      listaId: listas[t.lista].id,
      titulo: t.titulo,
      tipo: t.tipo,
      prioridad: t.prioridad,
      etiquetas: t.etiquetas,
      responsables: t.responsables,
      vence: t.vence === undefined ? undefined : enDias(t.vence),
      porque: t.completa ? PORQUE : undefined,
    })
    if (t.completa) decision = r
  }
  if (decision) {
    const ref = decision.clave
    await api.patch(`/api/tarjetas/${ref}`, {
      descripcion:
        'Hay que fijar el **precio de la hamburguesa** antes de cerrar la economía del nivel 3.\n\n- Comparar con la sopa y el pollo\n- Mirar cuánto tarda cada plato\n- Probarlo en el tutorial',
      estimacion: 3,
    })
    const { id: checklistId } = await api.post(`/api/tarjetas/${ref}/checklists`, {
      titulo: 'Antes de decidir',
      items: ['Tiempos de cocción de cada plato', 'Precio de la sopa y del pollo', 'Probar con tres jugadores'],
    })
    const detalle = await api.get(`/api/tarjetas/${ref}`)
    const item = detalle.checklists.find((c) => c.id === checklistId)?.items[0]
    if (item) await api.patch(`/api/items/${item.id}`, { hecho: true })
    const form = new FormData()
    form.append('archivo', new Blob([boceto()], { type: 'image/png' }), 'boceto-salon.png')
    await api.post(`/api/tarjetas/${ref}/adjuntos`, form)
    await api.post(`/api/tarjetas/${ref}/comentarios`, { cuerpo: 'Probé las dos en el tutorial: a 15 se entiende mejor que la carne paga más.' })
    // Un comentario de la IA, por el puente del MCP (queda firmado como Claude).
    const info = await api.get('/api/info')
    await api.post(
      '/api/herramientas/comentar',
      { args: { tarjeta: ref, texto: 'Revisé los tiempos: la hamburguesa tarda 40 s y la sopa 20 s. Con 15 pesos rinden parecido por minuto.' }, actor: { tipo: 'ia', id: 'ia:claude', nombre: 'Claude', cliente: 'Claude Code' } },
      { 'x-tablero-clave': info.clave },
    ).catch(() => {})
  }

  // Lienzo: unas notas y la decisión dentro del primer marco (Mecánicas), con un conector.
  tablero = await api.get(`/api/tableros/${tableroId}`)
  const marco = tablero.elementos.filter((e) => e.tipo === 'marco').sort((a, b) => a.y - b.y || a.x - b.x)[0]
  if (marco) {
    const notas = [
      { texto: 'Turnos de 3 minutos', color: 'amarillo', x: 80, y: 120 },
      { texto: 'Propinas según la espera', color: 'rosa', x: 360, y: 120 },
      { texto: 'El cocinero no puede tener más de 3 platos', color: 'celeste', x: 640, y: 120 },
    ]
    const creadas = []
    for (const n of notas)
      creadas.push(
        await api.post(`/api/tableros/${tableroId}/elementos`, {
          tipo: 'nota',
          x: marco.x + n.x,
          y: marco.y + n.y,
          ancho: 220,
          alto: 220,
          datos: { texto: n.texto, color: n.color },
        }),
      )
    if (decision)
      await api.post(`/api/tableros/${tableroId}/elementos`, { tipo: 'tarjeta', x: marco.x + 80, y: marco.y + 420, ancho: 288, alto: 132, tarjetaId: decision.id })
    await api.post(`/api/tableros/${tableroId}/conectores`, { desdeId: creadas[0].id, hastaId: creadas[1].id })
  }
  return { tableroId, prefijo: rc.prefijo, slug: rc.tableros[0].slug, decision: decision?.clave }
}
