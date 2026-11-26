// SOLO LOCAL · Servidor de mentira de la IA integrada (F1) para desarrollar y probar la web sin esperar al servidor real.
//
// Hace de intermediario delante de un Telar local de verdad (PGlite, datos descartables): todo lo que ya existe pasa tal
// cual, y lo que sumará la F1 (plan de la IA integrada, 13.7) lo contesta ESTE script con los tipos de compartido/ia.ts:
//   GET  /api/novedades · GET /api/notificaciones?antes=&limite= · POST /api/notificaciones/leer
//   GET  /api/notificaciones/preferencias · PUT /api/notificaciones/preferencias
//   GET  /api/miembros y /api/tableros/:id (miembros con `alias`; más Claude, GPT, Gemini y Ana si no están)
//   PATCH /api/miembros/:id con `alias` (válido, no reservado, único) · POST /api/tarjetas/:ref/comentarios con `respondeA`
//   GET  /api/tarjetas/:ref (los comentarios vuelven con `respuestaA`)
// y deja mandar notificaciones en vivo por el canal de eventos (/api/eventos, SSE) con unos controles propios:
//   POST /__falso/notificar  { tipo?, titulo, cuerpo?, enlace?, actor?, leida? }   → nueva notificación + evento en vivo
//   POST /__falso/semilla    { cantidad }                                            → suma notificaciones viejas (paginado)
//   POST /__falso/modo       { novedades?: 'ok'|'error'|'404', latenciaMs?, vacia?, notificaciones?: 'ok'|'error', leer?: 'ok'|'error', preferencias?: 'ok'|'error' }
//   POST /__falso/reiniciar  → vuelve a la semilla de fábrica
//
// Cómo se usa (Telar de verdad en :4338, este servidor en :4348, la web apuntando a este):
//   TABLERO_DATOS=/tmp/telar-ia TABLERO_PUERTO=4338 TABLERO_PUERTO_WEB=4337 TABLERO_SEMILLA_DISCORD=no npm run dev:servidor
//   npx tsx scripts/ia-servidor-falso.ts --real http://127.0.0.1:4338 --puerto 4348
//   TABLERO_PUERTO=4348 TABLERO_PUERTO_WEB=4337 npm run dev:web
// Se niega si alguna dirección no es 127.0.0.1 o localhost. No guarda nada: todo vive en memoria. No va a producción.
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Notificacion, PreferenciasNotificaciones, TipoNotificacion } from '../compartido/ia'
import { ALIAS_RESERVADOS, aliasValido, normalizarAlias } from '../compartido/menciones'
import type { Actor, Evento, Miembro } from '../compartido/tipos'

const args = process.argv.slice(2)
const opcion = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]!
}
const REAL = new URL(opcion('real', 'http://127.0.0.1:4338'))
const PUERTO = Number(opcion('puerto', '4348'))
for (const h of [REAL.hostname]) {
  if (!['127.0.0.1', 'localhost'].includes(h)) {
    console.error('SOLO LOCAL: el Telar de atrás tiene que ser 127.0.0.1 o localhost.')
    process.exit(1)
  }
}

const TIPOS: TipoNotificacion[] = ['mencion', 'respuesta', 'confirmacion', 'tope', 'error_ia', 'asignacion', 'aviso']
const PREFERENCIAS_DE_FABRICA = (): PreferenciasNotificaciones => ({
  push: { mencion: true, respuesta: true, confirmacion: true, tope: true, error_ia: true, asignacion: false },
  correo: { mencion: false, respuesta: false, confirmacion: false, tope: false, error_ia: false, asignacion: false },
  silencio: null,
})

// ───────────────────────── Estado en memoria ─────────────────────────
let secuencia = 0
let notificaciones: Notificacion[] = []
let preferencias = PREFERENCIAS_DE_FABRICA()
const aliasElegido = new Map<string, string>()
const respuestas = new Map<string, string>()
const modo = { novedades: 'ok', notificaciones: 'ok', leer: 'ok', preferencias: 'ok', latenciaMs: 0, vacia: false }
const oyentes = new Set<ServerResponse>()
let miYoId = ''

const actorIA = (nombre: string, cliente: string): Actor => ({ tipo: 'ia', nombre, cliente }) as Actor
const hace = (min: number) => new Date(Date.now() - min * 60000).toISOString()

function nueva(n: Partial<Notificacion> & { titulo: string; tipo: TipoNotificacion }, minutos = 0): Notificacion {
  const id = `falso_n${++secuencia}`
  return {
    id,
    paraId: miYoId || 'falso_yo',
    cuerpo: '',
    actor: null,
    enlace: null,
    trabajoId: null,
    mencionId: null,
    leidaEn: null,
    creadoEn: hace(minutos),
    ...n,
  }
}

function semilla() {
  secuencia = 0
  preferencias = PREFERENCIAS_DE_FABRICA()
  aliasElegido.clear()
  respuestas.clear()
  Object.assign(modo, { novedades: 'ok', notificaciones: 'ok', leer: 'ok', preferencias: 'ok', latenciaMs: 0, vacia: false })
  notificaciones = [
    nueva({ tipo: 'mencion', titulo: 'Claude te mencionó en RC-1', cuerpo: '@facundo mirá este caso del mozo que no se mueve', actor: actorIA('Claude', 'claude-code'), enlace: '/RC/pendientes?tarjeta=RC-1' }, 4),
    nueva({ tipo: 'respuesta', titulo: 'Claude respondió en RC-2', cuerpo: 'Revisé lo que pediste: con 30 clientes anda bien y no se traba la cola de la cocina.', actor: actorIA('Claude', 'claude-code'), enlace: '/RC/pendientes?tarjeta=RC-2' }, 35),
    nueva({ tipo: 'asignacion', titulo: 'Claude te asignó RC-3', cuerpo: 'Mesas de a dos en el local chico', actor: actorIA('Claude', 'claude-code'), enlace: '/RC/pendientes?tarjeta=RC-3', leidaEn: hace(60) }, 200),
    nueva({ tipo: 'error_ia', titulo: 'Gemini no pudo terminar', cuerpo: 'La clave dejó de andar. Cargá una nueva en Configuración → IA.', actor: actorIA('Gemini', 'gemini'), leidaEn: hace(400) }, 900),
  ]
}

function empujar(e: Evento) {
  const datos = `event: cambio\ndata: ${JSON.stringify(e)}\n\n`
  for (const r of oyentes) r.write(datos)
}

function eventoNotificacion(n: Notificacion): Evento {
  return { tipo: 'notificacion', accion: 'nueva', datos: n, actor: n.actor ?? actorIA('Claude', 'claude-code'), creadoEn: new Date().toISOString() } as unknown as Evento
}

// ───────────────────────── Miembros con alias ─────────────────────────
function conAlias(miembros: Miembro[]): Miembro[] {
  const lista = [...miembros]
  const hay = (re: RegExp) => lista.some((m) => re.test(m.nombre))
  if (!hay(/^claude$/i)) lista.push({ id: 'falso_claude', nombre: 'Claude', tipo: 'ia', color: 'violeta', iniciales: 'CL', esYo: false })
  if (!hay(/^gpt$/i)) lista.push({ id: 'falso_gpt', nombre: 'GPT', tipo: 'ia', color: 'verde', iniciales: 'GP', esYo: false })
  if (!hay(/^gemini$/i))
    lista.push({ id: 'falso_gemini', nombre: 'Gemini', tipo: 'ia', color: 'celeste', iniciales: 'GE', esYo: false, agente: { modo: 'api', estado: 'listo', modelo: 'gemini-falso' } })
  if (!hay(/^ana$/i)) lista.push({ id: 'falso_ana', nombre: 'Ana', tipo: 'humano', color: 'rosa', iniciales: 'AN', esYo: false })
  if (!hay(/^ia sin clave$/i))
    lista.push({ id: 'falso_sinclave', nombre: 'Sin clave', tipo: 'ia', color: 'naranja', iniciales: 'SC', esYo: false, agente: { modo: 'api', estado: 'sin_clave', modelo: null } })
  const usados = new Set<string>()
  const resultado = lista.map((m) => {
    let alias = aliasElegido.get(m.id) ?? (m.alias || normalizarAlias(m.nombre))
    if (!aliasElegido.has(m.id)) {
      const base = alias
      for (let n = 2; usados.has(alias); n++) alias = `${base}${n}`
    }
    usados.add(alias)
    return { ...m, alias, archivado: m.archivado ?? false }
  })
  const yo = resultado.find((m) => m.esYo)
  if (yo) {
    miYoId = yo.id
    for (const n of notificaciones) if (n.paraId === 'falso_yo') n.paraId = yo.id
  }
  return resultado
}

// ───────────────────────── Utilidades de http ─────────────────────────
const leerCuerpo = (req: IncomingMessage) =>
  new Promise<Buffer>((ok) => {
    const trozos: Buffer[] = []
    req.on('data', (t) => trozos.push(t))
    req.on('end', () => ok(Buffer.concat(trozos)))
  })
const json = (res: ServerResponse, estado: number, datos: unknown) => {
  res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(datos))
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Le pasa el pedido al Telar de verdad y devuelve su respuesta entera (para los que hay que retocar). */
function alReal(req: IncomingMessage, cuerpo: Buffer, ruta = req.url!, metodo = req.method): Promise<{ estado: number; cuerpo: Buffer; cabeceras: IncomingMessage['headers'] }> {
  return new Promise((ok, mal) => {
    // Sin compresión (se lee el JSON) y con el largo del cuerpo que de verdad se manda (a veces se retoca).
    const cabeceras = { ...req.headers, host: `${REAL.hostname}:${REAL.port}`, 'accept-encoding': 'identity', 'content-length': String(cuerpo.length) }
    if (!cuerpo.length) delete (cabeceras as Record<string, unknown>)['content-length']
    const r = request(
      { host: REAL.hostname, port: REAL.port, method: metodo, path: ruta, headers: cabeceras },
      (resp) => {
        const trozos: Buffer[] = []
        resp.on('data', (t) => trozos.push(t))
        resp.on('end', () => ok({ estado: resp.statusCode ?? 502, cuerpo: Buffer.concat(trozos), cabeceras: resp.headers }))
      },
    )
    r.on('error', mal)
    r.end(cuerpo)
  })
}

/** Los miembros del Telar de verdad, ya con alias y con los de mentira (también deja anotado cuál soy yo). */
const miembrosDe = (req: IncomingMessage): Promise<Miembro[]> =>
  alReal(req, Buffer.alloc(0), '/api/miembros', 'GET').then((r) => conAlias(JSON.parse(r.cuerpo.toString('utf8')) as Miembro[]))

/** Pasa el pedido tal cual (con flujo: sirve para el SSE y los archivos). */
function pasar(req: IncomingMessage, res: ServerResponse, cuerpo: Buffer) {
  const r = request(
    { host: REAL.hostname, port: REAL.port, method: req.method, path: req.url, headers: { ...req.headers, host: `${REAL.hostname}:${REAL.port}` } },
    (resp) => {
      res.writeHead(resp.statusCode ?? 502, resp.headers)
      resp.pipe(res)
    },
  )
  r.on('error', () => {
    if (!res.headersSent) json(res, 502, { error: 'El Telar de atrás no contesta.' })
    else res.end()
  })
  req.on('close', () => r.destroy())
  r.end(cuerpo)
}

async function retocarJson(req: IncomingMessage, res: ServerResponse, cuerpo: Buffer, retoque: (datos: any) => unknown, ruta?: string) {
  const r = await alReal(req, cuerpo, ruta)
  const cab = { ...r.cabeceras }
  delete cab['content-length']
  delete cab['content-encoding']
  delete cab['transfer-encoding']
  if (r.estado >= 300) {
    res.writeHead(r.estado, cab)
    return res.end(r.cuerpo)
  }
  const datos = retoque(JSON.parse(r.cuerpo.toString('utf8')))
  res.writeHead(r.estado, { ...cab, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(datos))
}

// ───────────────────────── Las rutas ─────────────────────────
async function atender(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, 'http://falso')
  const ruta = url.pathname
  const metodo = req.method ?? 'GET'
  const cuerpoCrudo = await leerCuerpo(req)
  const cuerpo = () => (cuerpoCrudo.length ? JSON.parse(cuerpoCrudo.toString('utf8')) : {})

  // Controles propios
  if (ruta.startsWith('/__falso/')) {
    const c = cuerpo()
    if (ruta === '/__falso/notificar') {
      if (!miYoId) await miembrosDe(req)
      const n = nueva(
        { tipo: c.tipo ?? 'respuesta', titulo: c.titulo ?? 'Claude respondió en RC-1', cuerpo: c.cuerpo ?? '', enlace: c.enlace ?? null, actor: c.actor ?? actorIA('Claude', 'claude-code'), leidaEn: c.leida ? new Date().toISOString() : null },
        0,
      )
      notificaciones.unshift(n)
      empujar(eventoNotificacion(n))
      return json(res, 200, n)
    }
    if (ruta === '/__falso/semilla') {
      const cantidad = Number(c.cantidad ?? 40)
      for (let i = 0; i < cantidad; i++) {
        const tipo = TIPOS[i % TIPOS.length]!
        notificaciones.push(nueva({ tipo, titulo: `Notificación vieja ${i + 1} (${tipo})`, cuerpo: 'Texto de relleno para probar el paginado de la bandeja.', actor: actorIA('Claude', 'claude-code'), leidaEn: hace(1) }, 1500 + i * 30))
      }
      notificaciones.sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1))
      return json(res, 200, { total: notificaciones.length })
    }
    if (ruta === '/__falso/modo') {
      Object.assign(modo, c)
      return json(res, 200, modo)
    }
    if (ruta === '/__falso/reiniciar') {
      semilla()
      return json(res, 200, { ok: true })
    }
    if (ruta === '/__falso/estado') return json(res, 200, { notificaciones, preferencias, modo, aliasElegido: [...aliasElegido], respuestas: [...respuestas] })
    return json(res, 404, { error: 'No existe ese control.' })
  }

  if (!ruta.startsWith('/api/')) return pasar(req, res, cuerpoCrudo)

  // Novedades y notificaciones
  if (ruta === '/api/novedades' && metodo === 'GET') {
    if (modo.latenciaMs) await espera(modo.latenciaMs)
    if (modo.novedades === 'error') return json(res, 500, { error: 'Falló el servidor de mentira.' })
    if (modo.novedades === '404') return json(res, 404, { error: 'No existe' })
    const lista = modo.vacia ? [] : notificaciones
    return json(res, 200, { notificaciones: lista.slice(0, 30), sinLeer: lista.filter((n) => !n.leidaEn).length, trabajos: [], esperando: [] })
  }
  if (ruta === '/api/notificaciones' && metodo === 'GET') {
    if (modo.notificaciones === 'error') return json(res, 500, { error: 'No se pudieron traer más.' })
    if (modo.latenciaMs) await espera(Math.min(modo.latenciaMs, 600))
    const antes = url.searchParams.get('antes')
    const limite = Number(url.searchParams.get('limite')) || 30
    const lista = antes ? notificaciones.filter((n) => n.creadoEn < antes) : notificaciones
    return json(res, 200, lista.slice(0, limite))
  }
  if (ruta === '/api/notificaciones/leer' && metodo === 'POST') {
    if (modo.leer === 'error') return json(res, 500, { error: 'No pude marcarla como leída.' })
    const c = cuerpo() as { ids?: string[]; todas?: boolean }
    const ahora = new Date().toISOString()
    let marcadas = 0
    for (const n of notificaciones) if (!n.leidaEn && (c.todas || c.ids?.includes(n.id))) (n.leidaEn = ahora), marcadas++
    return json(res, 200, { marcadas })
  }
  if (ruta === '/api/notificaciones/preferencias') {
    if (modo.preferencias === 'error') return json(res, 500, { error: 'No pude guardar las preferencias.' })
    if (metodo === 'GET') return json(res, 200, preferencias)
    if (metodo === 'PUT') {
      const c = cuerpo() as Partial<PreferenciasNotificaciones>
      preferencias = { ...preferencias, ...c, push: { ...preferencias.push, ...(c.push ?? {}) }, correo: { ...preferencias.correo, ...(c.correo ?? {}) } }
      return json(res, 200, preferencias)
    }
  }

  // Miembros con alias
  if (ruta === '/api/miembros' && metodo === 'GET') return retocarJson(req, res, cuerpoCrudo, (m: Miembro[]) => conAlias(m))
  if (/^\/api\/tableros\/[^/]+$/.test(ruta) && metodo === 'GET')
    return retocarJson(req, res, cuerpoCrudo, (t: { miembros?: Miembro[] }) => (t.miembros ? { ...t, miembros: conAlias(t.miembros) } : t))
  const mMiembro = /^\/api\/miembros\/([^/]+)$/.exec(ruta)
  if (mMiembro && metodo === 'PATCH') {
    const c = cuerpo() as { alias?: string; nombre?: string; color?: string }
    const id = decodeURIComponent(mMiembro[1]!)
    if (c.alias !== undefined) {
      const alias = String(c.alias).trim().toLowerCase()
      if (ALIAS_RESERVADOS.includes(alias)) return json(res, 409, { error: `«${alias}» es un nombre reservado de Telar: elegí otro alias.` })
      if (!aliasValido(alias)) return json(res, 400, { error: 'El alias tiene entre 2 y 32 letras minúsculas, números, punto, guion o guion bajo, y empieza con una letra o un número.' })
      const lista = await miembrosDe(req)
      const otro = lista.find((m) => m.id !== id && m.alias === alias)
      if (otro) return json(res, 409, { error: `Ese alias ya lo usa ${otro.nombre}: elegí otro.` })
      aliasElegido.set(id, alias)
    }
    const resto = { ...c }
    delete resto.alias
    if (!Object.keys(resto).length) {
      const lista = await miembrosDe(req)
      return json(res, 200, lista.find((m) => m.id === id))
    }
    return retocarJson(req, res, Buffer.from(JSON.stringify(resto)), (m: Miembro) => conAlias([m])[0])
  }

  // Comentarios que responden a otro, y la tarjeta con su `respuestaA`
  if (/^\/api\/tarjetas\/[^/]+\/comentarios$/.test(ruta) && metodo === 'POST') {
    const c = cuerpo() as { cuerpo: string; respondeA?: string }
    return retocarJson(req, res, Buffer.from(JSON.stringify({ cuerpo: c.cuerpo })), (com: { id: string }) => {
      if (c.respondeA) respuestas.set(com.id, c.respondeA)
      return { ...com, respuestaA: c.respondeA ?? null }
    })
  }
  if (/^\/api\/tarjetas\/[^/]+$/.test(ruta) && metodo === 'GET')
    return retocarJson(req, res, cuerpoCrudo, (t: { comentarios?: { id: string }[] }) =>
      t.comentarios ? { ...t, comentarios: t.comentarios.map((c) => ({ ...c, respuestaA: respuestas.get(c.id) ?? null })) } : t,
    )

  return pasar(req, res, cuerpoCrudo)
}

// El canal de eventos: se le pasa el del Telar de verdad y se le suman los eventos propios.
function eventos(req: IncomingMessage, res: ServerResponse) {
  const r = request(
    { host: REAL.hostname, port: REAL.port, method: 'GET', path: '/api/eventos', headers: { ...req.headers, host: `${REAL.hostname}:${REAL.port}` } },
    (resp) => {
      res.writeHead(resp.statusCode ?? 200, resp.headers)
      oyentes.add(res)
      resp.pipe(res)
    },
  )
  r.on('error', () => res.end())
  req.on('close', () => {
    oyentes.delete(res)
    r.destroy()
  })
  r.end()
}

semilla()
createServer((req, res) => {
  if (req.url?.startsWith('/api/eventos') && !req.url.startsWith('/api/eventos/desde')) return eventos(req, res)
  atender(req, res).catch((e) => {
    console.error('Error en el servidor de mentira:', e)
    if (!res.headersSent) json(res, 500, { error: String((e as Error).message) })
    else res.end()
  })
}).listen(PUERTO, '127.0.0.1', () => {
  console.log(`SOLO LOCAL · Servidor de mentira de la IA (F1) en http://127.0.0.1:${PUERTO}, delante de ${REAL.origin}`)
  console.log('Controles: POST /__falso/{notificar,semilla,modo,reiniciar} · GET /__falso/estado')
})
