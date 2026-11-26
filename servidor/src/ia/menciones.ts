// De un texto guardado a filas de `menciones`, notificaciones y (desde la F2) trabajos: la «regla de la cantidad» del plan de
// la IA integrada (5.4) y el levantado de las menciones que ya estaban escritas antes de que existiera esta función.
//
// La regla: para cada texto guardado (el «origen») y cada miembro mencionado se compara cuántas menciones hay AHORA con cuántas
// había ANOTADAS (filas con `en_texto = true`). Si crecieron, se crean las que faltan; si son las mismas, no pasa nada (editar un
// typo no responde de nuevo); si bajaron, las más nuevas se retiran. Una mención a un agente de adentro (con clave, prendido y con permiso
// de quien la escribe) crea UN trabajo que contesta solo (F2, plan 6); si no está listo, o quien la escribe no puede dispararlo, la mención
// queda `pendiente` con su motivo y no se pierde (una IA de afuera la atiende por MCP: leer_pendientes, atender_mencion o comentando).
// También acá: la conversación sin «@» (Anexo F.2): el comentario de una persona justo después de uno de un agente es para ese agente.
import type { Mencion, OrigenMencion, TrabajoResumen } from '../../../compartido/ia'
import { extraerMenciones, resolverExacto, type MiembroMencionable } from '../../../compartido/menciones'
import { normalizar, recortar } from '../../../compartido/texto'
import type { Actor } from '../../../compartido/tipos'
import type { ResultadoMenciones, TextoGuardado } from '../dominio/ganchos'
import { ErrorDominio, nuevoId, type Ctx } from '../dominio/servicio'
import { tandaActual } from '../dominio/tanda'
import type { ServicioIA } from './servicio-ia'
import { AVISO_DEMASIADOS, exigirSesion, trabajosDe, type AgenteInterno, type AjustesInternos, type Trabajos } from './trabajos'

type Fila = Record<string, any>

/** Cuántas letras de la frase se guardan alrededor de la mención. */
const LARGO_EXTRACTO = 280

/** Quién escribió: una persona, una IA (por MCP, o la clave del MCP por /api) o el sistema (importadores, semilla). */
export function quienEscribio(ctx: Ctx): 'persona' | 'ia' | 'sistema' {
  if (ctx.actor.tipo === 'sistema') return 'sistema'
  if (ctx.actor.tipo === 'ia') return 'ia'
  // Con la clave del MCP por /api el actor figura como el dueño pero no es él: se trata como una IA de afuera (plan, 5.6).
  return ctx.via === 'clave' || ctx.via === 'oauth' || ctx.via === 'ia' ? 'ia' : 'persona'
}

/** La frase alrededor de la mención número `n` (0 = la primera) de ese miembro; sin menciones escritas (una respuesta), el principio. */
function extractoDe(texto: string, posiciones: number[], n: number): string {
  const desde = posiciones[Math.min(n, posiciones.length - 1)]
  if (desde === undefined) return recortar(texto.replace(/\s+/g, ' ').trim(), LARGO_EXTRACTO)
  const ventana = texto.slice(Math.max(0, desde - 100), desde + 180).replace(/\s+/g, ' ').trim()
  return recortar(ventana, LARGO_EXTRACTO)
}

/** Lo que dice la mención de un origen, para los títulos de las notificaciones. */
function dondeDe(tipo: OrigenMencion, clave: string | null): string {
  if (clave) return clave
  return tipo === 'nota' ? 'una nota del lienzo' : tipo === 'comentario_diseno' ? 'un comentario de Diseño' : 'Telar'
}

/** La ruta de Telar donde está lo mencionado (nunca una dirección de afuera). */
export async function enlaceDe(ia: ServicioIA, f: Fila): Promise<string> {
  return (await enlacesDe(ia, [f]))[0]!
}

/** Las rutas de varias menciones juntas (una sola consulta para las que no cuelgan de una tarjeta). */
export async function enlacesDe(ia: ServicioIA, filas: Fila[]): Promise<string[]> {
  const tableros = [...new Set(filas.filter((f) => !f.tarjeta_clave && f.tablero_id).map((f) => f.tablero_id as string))]
  const rutas = new Map<string, string>()
  if (tableros.length) {
    const encontrados = await ia.db.consulta<{ id: string; slug: string; prefijo: string }>(
      `select t.id, t.slug, p.prefijo from tableros t join proyectos p on p.id = t.proyecto_id where t.id = any($1::text[]) and p.propietario = $2`,
      [tableros, ia.cuenta],
    )
    for (const t of encontrados) rutas.set(t.id, `/${encodeURIComponent(t.prefijo)}/${encodeURIComponent(t.slug)}/lienzo`)
  }
  return filas.map((f) => {
    if (f.tarjeta_clave) return `/${encodeURIComponent(String(f.tarjeta_clave).split('-')[0]!)}?tarjeta=${encodeURIComponent(f.tarjeta_clave)}`
    return (f.tablero_id && rutas.get(f.tablero_id)) || '/'
  })
}

/** Una fila de `menciones` como la ve la web y el MCP. */
export function aMencion(f: Fila, enlace: string): Mencion {
  return {
    id: f.id,
    origen: { tipo: f.origen_tipo, id: f.origen_id },
    destinatarioId: f.destinatario_id,
    autor: f.autor as Actor,
    extracto: f.extracto ?? '',
    estado: f.estado,
    // Una mención pendiente que no pudo crear su trabajo guarda el porqué en su nota (sin clave, apagado, límite de IA con IA…).
    motivo: f.estado === 'pendiente' && f.nota ? f.nota : null,
    trabajoId: f.trabajo_id ?? null,
    tarjetaClave: f.tarjeta_clave ?? null,
    enlace,
    creadoEn: new Date(f.creado_en).toISOString(),
  }
}

/** Completa lo que falte de un texto (clave, proyecto, tablero) leyendo la tarjeta o el tablero: solo cuando se crea una mención. */
async function completar(ia: ServicioIA, t: TextoGuardado): Promise<TextoGuardado> {
  if (t.tarjetaId && (!t.tarjetaClave || !t.proyectoId || !t.tableroId)) {
    const [f] = await ia.db.consulta<{ clave: string; proyecto_id: string; tablero_id: string }>(
      `select t.clave, t.proyecto_id, t.tablero_id from tarjetas t join proyectos p on p.id = t.proyecto_id where t.id = $1 and p.propietario = $2`,
      [t.tarjetaId, ia.cuenta],
    )
    if (f) return { ...t, tarjetaClave: f.clave, proyectoId: f.proyecto_id, tableroId: f.tablero_id }
  } else if (!t.tarjetaId && t.tableroId && !t.proyectoId) {
    const [f] = await ia.db.consulta<{ proyecto_id: string }>(
      `select t.proyecto_id from tableros t join proyectos p on p.id = t.proyecto_id where t.id = $1 and p.propietario = $2`,
      [t.tableroId, ia.cuenta],
    )
    if (f) return { ...t, proyectoId: f.proyecto_id }
  }
  return t
}

/** Los textos que dicen cuántas veces se menciona a cada miembro (sin contar a quien escribe). */
function contarMenciones(texto: string, mencionables: MiembroMencionable[], propioId: string) {
  const cuentas = new Map<string, number>()
  const posiciones = new Map<string, number[]>()
  for (const m of extraerMenciones(texto)) {
    const mb = resolverExacto(m.alias, mencionables)
    if (!mb || mb.id === propioId) continue
    cuentas.set(mb.id, (cuentas.get(mb.id) ?? 0) + 1)
    posiciones.set(mb.id, [...(posiciones.get(mb.id) ?? []), m.desde])
  }
  return { cuentas, posiciones }
}

// ───────────────────────── trabajos de las menciones (F2) ─────────────────────────

/** Cuántos segundos espera el trabajo de un texto que se guarda mientras se escribe (el porqué, las notas): se corre con cada guardado. */
const ESPERA_EN_VIVO_MS = 15_000
/** Una IA no responde un pedido de otra IA en una tarjeta donde acaba de contestar (12.5). */
const ESPERA_ENTRE_RESPUESTAS_S = 60
const MAX_IA_A_IA_POR_HORA = 10
/** Hasta qué profundidad se encadena IA con IA: persona → A (0) → B (1); B no dispara a nadie (12.5). */
const PROFUNDIDAD_MAXIMA = 1
/** La conversación sin «@» sigue hasta 48 horas después del último comentario del agente (F.2). */
const CONVERSACION_VENCE_HORAS = 48
/** Los orígenes donde un agente contesta con un comentario en la tarjeta (las notas del lienzo y Diseño llegan con la F3 y la F4). */
const ORIGENES_CON_TARJETA: readonly OrigenMencion[] = ['comentario', 'descripcion', 'porque']

/** Por qué un agente no puede tomar el pedido, en palabras simples, o null si está listo. null también si no es un agente de adentro. */
export async function motivoDeEspera(ia: ServicioIA, agenteId: string): Promise<string | null> {
  const tb = trabajosDe(ia)
  return tb.motivoNoListo(await tb.agente(agenteId), await tb.ajustes())
}

// El caché de «¿esta cuenta tiene agentes de adentro?»: comentar sin «@» no puede costar una consulta más (M16), así que la respuesta se
// recuerda unos segundos. Lo olvida quien guarda un agente (`olvidarAgentes`); si no, vence solo.
const VIDA_CACHE_AGENTES_MS = 30_000
const cacheAgentes = new Map<string, { hasta: number; hay: { conversacion: boolean; proactivos: boolean } }>()

/** Olvida el caché de agentes de una cuenta (o de todas): lo llama quien crea, apaga o cambia un agente, y las pruebas. */
export function olvidarAgentes(cuenta?: string): void {
  if (cuenta) cacheAgentes.delete(cuenta)
  else cacheAgentes.clear()
}

/** ¿Tiene esta cuenta agentes de adentro prendidos (para conversar) y con disparadores proactivos? Una consulta cada 30 segundos como mucho. */
export async function hayAgentes(ia: ServicioIA): Promise<{ conversacion: boolean; proactivos: boolean }> {
  const c = cacheAgentes.get(ia.cuenta)
  if (c && c.hasta > Date.now()) return c.hay
  const [f] = await ia.db.consulta<{ api: boolean; proactivos: boolean }>(
    `select coalesce(bool_or(modo = 'api' and activo), false) as api, coalesce(bool_or(modo = 'api' and activo and disparadores <> '{}'::jsonb), false) as proactivos
       from ia_agentes where propietario = $1`,
    [ia.cuenta],
  )
  const hay = { conversacion: Boolean(f?.api), proactivos: Boolean(f?.proactivos) }
  cacheAgentes.set(ia.cuenta, { hasta: Date.now() + VIDA_CACHE_AGENTES_MS, hay })
  return hay
}

/** El agente con quien sigue una conversación sin «@»: el autor del comentario anterior, si es una IA y fue hace menos de 48 horas. */
async function agenteDeLaConversacion(ia: ServicioIA, t: TextoGuardado): Promise<string | null> {
  const [previo] = await ia.db.consulta<{ autor: Actor; creado_en: string }>(
    `select c.autor, c.creado_en from comentarios c where c.tarjeta_id = $1 and c.id <> $2 order by c.creado_en desc, c.id desc limit 1`,
    [t.tarjetaId, t.origen.id],
  )
  if (!previo || previo.autor?.tipo !== 'ia') return null
  if (Date.now() - new Date(previo.creado_en).getTime() > CONVERSACION_VENCE_HORAS * 3_600_000) return null
  return previo.autor.id
}

interface DecisionIA {
  motivo?: string
  /** No se crea y no hace falta decir por qué (es la respuesta a quien pidió). */
  callar?: boolean
  profundidad: number
}

/**
 * Las reglas de IA con IA (12.5 y 5.6) para una mención escrita por una IA. Si hay una tanda en curso la escribió un agente de adentro
 * corriendo un trabajo (se mira ese trabajo); si no, una IA de afuera por MCP (o la clave del MCP por /api), que solo dispara si la cuenta lo prendió.
 */
async function reglaDeIAaIA(ia: ServicioIA, tb: Trabajos, destino: AgenteInterno, ajustes: AjustesInternos, fila: Fila): Promise<DecisionIA> {
  const tanda = tandaActual()
  let profundidad = 1
  if (tanda) {
    const padre = await tb.leer(tanda.id)
    const escritor = padre ? await tb.agente(padre.agenteId) : null
    if (!padre || !escritor) return { profundidad, motivo: 'No se pudo saber qué trabajo lo escribió.' }
    if (padre.origen === 'proactivo') return { profundidad, motivo: 'Una revisión por su cuenta nunca le pide nada a otra IA.' }
    if (!escritor.puedeMencionarIA) return { profundidad, motivo: `${escritor.nombre} no puede pedirle cosas a otra IA (se prende en Configuración → IA).` }
    if (padre.pedidoPor.id === destino.miembroId) return { profundidad, callar: true }
    profundidad = padre.profundidad + 1
    if (profundidad > PROFUNDIDAD_MAXIMA) return { profundidad, motivo: 'Ya hay dos IA encadenadas: una tercera no se dispara sola.' }
  } else if (!ajustes.externasDisparan) {
    return { profundidad, motivo: 'Las IA de afuera no pueden pedirle cosas a tus agentes (se prende en Configuración → IA).' }
  }
  const [reciente] = await ia.db.consulta(
    `select 1 from comentarios c where c.tarjeta_id = $1 and c.autor->>'id' = $2 and c.creado_en > now() - ($3 || ' seconds')::interval limit 1`,
    [fila.tarjeta_id, destino.miembroId, String(ESPERA_ENTRE_RESPUESTAS_S)],
  )
  if (reciente) return { profundidad, motivo: `${destino.nombre} contestó hace menos de un minuto en esta tarjeta: esperá un poco para no entrar en un bucle.` }
  const [horas] = await ia.db.consulta<{ n: number }>(
    `select count(*)::int as n from ia_trabajos where propietario = $1 and profundidad >= 1 and creado_en > now() - interval '1 hour'`,
    [ia.cuenta],
  )
  if (Number(horas?.n ?? 0) >= MAX_IA_A_IA_POR_HORA) return { profundidad, motivo: 'Hubo muchos pedidos de IA a IA en esta hora: esperá un rato.' }
  return { profundidad }
}

/**
 * Crea el trabajo de cada mención nueva a un agente de adentro (un trabajo por texto y por agente: dos «@claude» en el mismo comentario son
 * uno solo). Si el agente no está listo, o quien escribió no puede dispararlo, no se crea y la mención queda `pendiente` con su motivo.
 */
async function trabajosDeLasMenciones(
  ia: ServicioIA,
  ctx: Ctx,
  quien: 'persona' | 'ia',
  creadas: { fila: Fila; texto: TextoGuardado }[],
  porId: Map<string, MiembroParaMencion>,
  implicitas: Map<string, 'conversacion'>,
): Promise<{ trabajos: TrabajoResumen[]; motivos: Map<string, string>; aviso?: string }> {
  const tb = trabajosDe(ia)
  const trabajos: TrabajoResumen[] = []
  const motivos = new Map<string, string>()
  let aviso: string | undefined
  const vistos = new Set<string>()
  let ajustes: AjustesInternos | null = null
  for (const { fila, texto } of creadas) {
    if (porId.get(fila.destinatario_id)?.tipo !== 'ia') continue
    if (!ORIGENES_CON_TARJETA.includes(fila.origen_tipo) || !fila.tarjeta_id) continue
    const grupo = `${fila.origen_tipo}:${fila.origen_id}:${fila.destinatario_id}`
    if (vistos.has(grupo)) continue
    vistos.add(grupo)
    const agente = await tb.agente(fila.destinatario_id)
    if (!agente || agente.modo !== 'api') continue // una IA de afuera o por disparo: queda pendiente para ella
    ajustes ??= await tb.ajustes()
    let profundidad = 0
    if (quien === 'ia') {
      const d = await reglaDeIAaIA(ia, tb, agente, ajustes, fila)
      if (d.motivo) await esperarCon(ia, motivos, fila.id, d.motivo)
      if (d.motivo || d.callar) continue
      profundidad = d.profundidad
    }
    const noListo = tb.motivoNoListo(agente, ajustes)
    if (noListo) {
      await esperarCon(ia, motivos, fila.id, noListo)
      continue
    }
    const conversacion = implicitas.get(grupo) === 'conversacion'
    const r = await tb.crear({
      agente,
      origen: conversacion ? 'conversacion' : 'mencion',
      mencionId: fila.id,
      claveUnica: conversacion ? `conv:${fila.origen_id}` : null,
      superficie: 'tarjeta',
      contexto: {
        proyectoId: fila.proyecto_id ?? texto.proyectoId ?? undefined,
        tableroId: fila.tablero_id ?? texto.tableroId ?? undefined,
        tarjetaId: fila.tarjeta_id,
        tarjetaClave: fila.tarjeta_clave ?? texto.tarjetaClave ?? undefined,
        origen: { tipo: fila.origen_tipo, id: fila.origen_id },
        respuestaA: fila.origen_tipo === 'comentario' ? fila.origen_id : undefined,
      },
      pedido: fila.extracto,
      pedidoPor: ctx.actor,
      profundidad,
      demoraMs: texto.enVivo ? ESPERA_EN_VIVO_MS : 0,
    })
    if (r.tipo === 'rechazado') {
      aviso = r.motivo
      await esperarCon(ia, motivos, fila.id, r.motivo)
      continue
    }
    trabajos.push(await tb.resumen(r.trabajo))
  }
  return { trabajos, motivos, aviso }
}

type MiembroParaMencion = Awaited<ReturnType<ServicioIA['mencionables']>>[number]

/** La mención queda pendiente: el motivo se anota (en su `nota`, que en una pendiente está libre) para que la persona lo vea después. */
async function esperarCon(ia: ServicioIA, motivos: Map<string, string>, mencionId: string, motivo: string): Promise<void> {
  motivos.set(mencionId, motivo)
  await ia.db.consulta(`update menciones set nota = $3 where id = $1 and propietario = $2 and estado = 'pendiente'`, [mencionId, ia.cuenta, motivo])
}

/**
 * El gancho `textoGuardado`: aplica la regla de la cantidad a cada texto, crea las menciones nuevas (y avisa a las personas),
 * retira las que se sacaron del texto, crea el trabajo de cada mención a un agente de adentro y, si quien escribe es una IA que
 * comenta en una tarjeta, atiende lo que le habían pedido ahí.
 */
export async function procesarTextos(ia: ServicioIA, ctx: Ctx, textos: TextoGuardado[]): Promise<ResultadoMenciones> {
  const vacio: ResultadoMenciones = { menciones: [], trabajos: [] }
  const quien = quienEscribio(ctx)
  if (quien === 'sistema' || !textos.length) return vacio

  const hayArroba = textos.some((t) => t.texto.includes('@') || t.respuestaA)
  // Una conversación sin «@» (F.2): un comentario nuevo de una persona, sin «@» ni respuesta. Solo se mira si la cuenta tiene agentes (caché).
  const posibleConversacion =
    quien === 'persona' && textos.some((t) => t.nuevo && t.origen.tipo === 'comentario' && t.tarjetaId && !t.texto.includes('@') && !t.respuestaA)
  const conversa = posibleConversacion && (await hayAgentes(ia)).conversacion
  // Un comentario recién creado no tiene filas todavía: solo se buscan las de un texto que ya existía (una edición, un reintento).
  const viejos = textos.filter((t) => !t.nuevo)
  const existentes = viejos.length ? await ia.filasDeOrigenes(viejos.map((t) => t.origen)) : []
  const atiende = ctx.actor.tipo === 'ia' && textos.some((t) => t.nuevo && t.origen.tipo === 'comentario' && t.tarjetaId)
  // Un comentario común (sin «@», sin respuesta, sin conversación posible): no hay nada que mirar ni que devolver, ni una consulta de más (M16).
  if (!hayArroba && !existentes.length && !conversa && !atiende) return vacio
  const motivos = new Map<string, string>()
  const trabajos: TrabajoResumen[] = []
  let aviso: string | undefined

  if (hayArroba || existentes.length || conversa) {
    const miembros = await ia.mencionables()
    const mencionables: MiembroMencionable[] = miembros.map((m) => ({ id: m.id, alias: m.alias, nombre: m.nombre, archivado: m.archivado }))
    const porId = new Map(miembros.map((m) => [m.id, m]))
    const creadas: { fila: Fila; texto: TextoGuardado }[] = []
    const implicitas = new Map<string, 'conversacion'>()
    const tb = trabajosDe(ia)

    for (const original of textos) {
      const propias = existentes.filter((f) => f.origen_tipo === original.origen.tipo && f.origen_id === original.origen.id)
      const { cuentas, posiciones } = contarMenciones(original.texto, mencionables, ctx.actor.id)
      // Responder es mencionar: una persona que contesta un comentario de una IA le habla a esa IA aunque no escriba «@».
      if (original.respuestaA && quien === 'persona' && original.origen.tipo === 'comentario') {
        const autorId = await ia.autorDeComentario(original.respuestaA)
        const ml = autorId ? porId.get(autorId) : undefined
        if (ml && ml.tipo === 'ia' && !ml.archivado && ml.id !== ctx.actor.id) cuentas.set(ml.id, (cuentas.get(ml.id) ?? 0) + 1)
      }
      // Conversar sin «@»: el comentario que viene justo después de uno de un agente, sin mencionar a nadie, es para ese agente.
      if (conversa && cuentas.size === 0 && !original.respuestaA && original.nuevo && original.origen.tipo === 'comentario' && original.tarjetaId && !original.texto.includes('@')) {
        const id = await agenteDeLaConversacion(ia, original)
        const ml = id ? porId.get(id) : undefined
        if (ml && ml.tipo === 'ia' && !ml.archivado && ml.id !== ctx.actor.id) {
          cuentas.set(ml.id, 1)
          implicitas.set(`${original.origen.tipo}:${original.origen.id}:${ml.id}`, 'conversacion')
        }
      }
      const miembrosDelTexto = new Set([...cuentas.keys(), ...propias.map((f) => f.destinatario_id as string)])
      for (const miembroId of miembrosDelTexto) {
        const filas = propias.filter((f) => f.destinatario_id === miembroId).sort((a, b) => a.ocurrencia - b.ocurrencia)
        const anotadas = filas.filter((f) => f.en_texto)
        const ahora = cuentas.get(miembroId) ?? 0
        if (ahora > anotadas.length) {
          const base = await completar(ia, original)
          const destino = porId.get(miembroId)
          let ocurrencia = Math.max(0, ...filas.map((f) => f.ocurrencia as number))
          for (let n = anotadas.length; n < ahora; n++) {
            const esIA = destino?.tipo === 'ia'
            const fila = await ia.insertarMencion({
              origen: original.origen,
              ocurrencia: ++ocurrencia,
              destinatarioId: miembroId,
              autor: ctx.actor,
              extracto: extractoDe(original.texto, posiciones.get(miembroId) ?? [], n),
              proyectoId: base.proyectoId,
              tableroId: base.tableroId,
              tarjetaId: base.tarjetaId,
              tarjetaClave: base.tarjetaClave,
              // A una persona se le avisa con la campana y ya no hay nada más que hacer: queda anotada como atendida.
              estado: esIA ? 'pendiente' : 'atendida',
              nota: esIA ? null : 'Se le avisó por la campana.',
            })
            if (fila) creadas.push({ fila, texto: base })
          }
        } else if (ahora === anotadas.length) {
          // La cantidad no cambió. Si el origen se había sacado (una nota) y volvió, lo que quedó retirado sin atender vuelve.
          const aRestaurar = anotadas.filter((f) => f.estado === 'retirada').map((f) => f.id as string)
          if (aRestaurar.length) await ia.reponerMenciones(aRestaurar)
          // El porqué y las notas se guardan mientras se escribe: el trabajo que sigue en cola espera al último guardado.
          if (original.enVivo) await tb.postergar(anotadas.map((f) => f.id as string), ESPERA_EN_VIVO_MS)
        } else {
          // Hay menos que antes: se retiran las más nuevas (las que ya se atendieron quedan atendidas).
          const sobran = anotadas.slice(ahora).map((f) => f.id as string)
          await ia.quitarDelTexto(sobran)
        }
      }
    }

    // A cada persona mencionada, una notificación por texto (las repetidas las frena la clave única).
    const avisadas = new Set<string>()
    for (const { fila, texto } of creadas) {
      const destino = porId.get(fila.destinatario_id)
      if (!destino || destino.tipo !== 'humano') continue
      const clave = `${fila.origen_tipo}:${fila.origen_id}:${fila.destinatario_id}`
      if (avisadas.has(clave)) continue
      avisadas.add(clave)
      await ia.notificar({
        paraId: destino.id,
        tipo: 'mencion',
        titulo: `${ctx.actor.nombre} te mencionó en ${dondeDe(fila.origen_tipo, fila.tarjeta_clave)}`,
        cuerpo: fila.extracto,
        actor: ctx.actor,
        enlace: await enlaceDe(ia, fila),
        tarjetaId: texto.tarjetaId,
        mencionId: fila.id,
        claveUnica: `mencion:${fila.id}`,
      })
    }

    // Las menciones a un agente de adentro crean su trabajo (si pueden); si no, quedan pendientes con su motivo.
    if (creadas.length) {
      const r = await trabajosDeLasMenciones(ia, ctx, quien, creadas, porId, implicitas)
      trabajos.push(...r.trabajos)
      aviso = r.aviso
      for (const [id, m] of r.motivos) motivos.set(id, m)
    }
  }

  // Una IA que comenta en una tarjeta atiende lo que le habían pedido ahí (y se le avisa a quien se lo pidió).
  if (atiende) {
    const t = textos.find((x) => x.nuevo && x.origen.tipo === 'comentario' && x.tarjetaId)!
    await ia.atenderPorComentario(ctx, t)
  }

  const enTexto = await ia.filasDeOrigenes(textos.map((t) => t.origen), { soloEnTexto: true })
  if (!enTexto.length && !trabajos.length) return aviso ? { ...vacio, aviso } : vacio
  const enlaces = await enlacesDe(ia, enTexto)
  return {
    menciones: enTexto.map((f, i) => ({ ...aMencion(f, enlaces[i]!), motivo: motivos.get(f.id) ?? null })),
    trabajos,
    ...(aviso ? { aviso } : {}),
  }
}

// ───────────────────────── «Reintentar» una mención que esperaba ─────────────────────────

/**
 * Una mención que quedó esperando a un agente que ahora está listo: crea su trabajo. Solo con sesión (gasta). Si el agente sigue sin poder,
 * dice por qué (409); una mención que ya tiene su trabajo se reanuda con el trabajo, no acá.
 */
export async function reintentarMencion(ia: ServicioIA, ctx: Ctx, mencionId: string): Promise<TrabajoResumen> {
  exigirSesion(ctx)
  const tb = trabajosDe(ia)
  const [f] = await ia.db.consulta<Fila>(`select * from menciones where id = $1 and propietario = $2`, [mencionId, ia.cuenta])
  if (!f) throw new ErrorDominio('No existe esa mención.', 404)
  if (f.estado !== 'pendiente') throw new ErrorDominio('Esa mención ya no está esperando.', 409)
  if (!ORIGENES_CON_TARJETA.includes(f.origen_tipo) || !f.tarjeta_id)
    throw new ErrorDominio('Esa mención es de un lugar donde los agentes todavía no contestan solos (el lienzo y Diseño llegan después).', 409)
  const agente = await tb.agente(f.destinatario_id)
  if (!agente || agente.modo !== 'api') throw new ErrorDominio('Esa mención es para una IA que no contesta desde acá: la ve cuando se conecta.', 409)
  const motivo = tb.motivoNoListo(agente, await tb.ajustes())
  if (motivo) throw new ErrorDominio(`${agente.nombre} todavía no puede responder: ${motivo.charAt(0).toLowerCase()}${motivo.slice(1)}`, 409)
  const [ya] = await ia.db.consulta<Fila>(`select id from ia_trabajos where mencion_id = $1 and propietario = $2`, [mencionId, ia.cuenta])
  if (ya) throw new ErrorDominio('Esa mención ya tiene su trabajo: reanudalo desde ahí.', 409)
  const r = await tb.crear({
    agente,
    origen: 'mencion',
    mencionId,
    superficie: 'tarjeta',
    contexto: {
      proyectoId: f.proyecto_id ?? undefined,
      tableroId: f.tablero_id ?? undefined,
      tarjetaId: f.tarjeta_id,
      tarjetaClave: f.tarjeta_clave ?? undefined,
      origen: { tipo: f.origen_tipo, id: f.origen_id },
      respuestaA: f.origen_tipo === 'comentario' ? f.origen_id : undefined,
    },
    pedido: f.extracto,
    pedidoPor: (f.autor as Actor).tipo === 'humano' ? (f.autor as Actor) : ctx.actor,
  })
  if (r.tipo === 'rechazado') throw new ErrorDominio(r.motivo, 429)
  return tb.resumen(r.trabajo)
}

/** Las menciones que esperan a un agente de adentro y no tienen trabajo, con el motivo de hoy (lo que muestra el hilo con «Reintentar»). */
export async function mencionesEsperando(ia: ServicioIA): Promise<Mencion[]> {
  const tb = trabajosDe(ia)
  const filas = await ia.db.consulta<Fila>(
    `select m.* from menciones m join ia_agentes a on a.miembro_id = m.destinatario_id and a.propietario = m.propietario and a.modo = 'api'
      where m.propietario = $1 and m.estado = 'pendiente' and m.en_texto and m.trabajo_id is null and m.origen_tipo in ('comentario', 'descripcion', 'porque')
      order by m.creado_en desc limit 50`,
    [ia.cuenta],
  )
  if (!filas.length) return []
  const ajustes = await tb.ajustes()
  const agentes = new Map<string, AgenteInterno | null>()
  for (const id of new Set(filas.map((f) => f.destinatario_id as string))) agentes.set(id, await tb.agente(id))
  const enlaces = await enlacesDe(ia, filas)
  return filas.map((f, i) => ({
    ...aMencion(f, enlaces[i]!),
    motivo: tb.motivoNoListo(agentes.get(f.destinatario_id) ?? null, ajustes) ?? f.nota ?? AVISO_DEMASIADOS,
  }))
}

// ───────────────────────── levantar las menciones de antes ─────────────────────────

/** Los alias de IA conocidas: si un comentario viejo los menciona y todavía no hay ese miembro, se crea para que la mención no se pierda. */
const IA_CONOCIDAS: Record<string, string> = {
  claude: 'Claude',
  gpt: 'ChatGPT',
  chatgpt: 'ChatGPT',
  codex: 'Codex',
  cursor: 'Cursor',
}

export interface InformeLevantado {
  /** Menciones creadas que siguen esperando a una IA. */
  pendientes: number
  /** Menciones creadas que ya estaban atendidas (la IA comentó después en la tarjeta) o eran para una persona. */
  atendidas: number
  /** Miembros IA que hubo que crear porque el comentario mencionaba a una IA conocida que todavía no estaba. */
  miembrosCreados: string[]
}

/**
 * Recorre los comentarios de la cuenta y crea las menciones que les falten (la misma regla de la cantidad: correrlo dos veces no
 * duplica nada). Una mención a una IA que comentó DESPUÉS en esa tarjeta queda atendida; las demás, pendientes. No avisa por la
 * campana cada mención vieja: solo deja un aviso («Encontré N menciones pendientes de antes»).
 */
export async function levantarMencionesViejas(ia: ServicioIA): Promise<InformeLevantado> {
  const informe: InformeLevantado = { pendientes: 0, atendidas: 0, miembrosCreados: [] }
  const comentarios = await ia.db.consulta<Fila>(
    `select c.id, c.cuerpo, c.autor, c.creado_en, c.tarjeta_id, t.clave, t.proyecto_id, t.tablero_id
       from comentarios c join tarjetas t on t.id = c.tarjeta_id join proyectos p on p.id = t.proyecto_id
      where p.propietario = $1 and c.cuerpo like '%@%' order by c.creado_en, c.id`,
    [ia.cuenta],
  )
  if (!comentarios.length) return informe
  let miembros = await ia.mencionables()

  // Una IA conocida que se menciona pero todavía no es miembro de la cuenta: se crea (igual que cuando se conecta por MCP).
  const faltantes = new Set<string>()
  for (const c of comentarios)
    for (const m of extraerMenciones(c.cuerpo)) {
      const nombre = IA_CONOCIDAS[m.alias]
      if (nombre && !resolverExacto(m.alias, miembros)) faltantes.add(nombre)
    }
  for (const nombre of faltantes) {
    const existe = miembros.find((m) => m.tipo === 'ia' && !m.archivado && normalizar(m.nombre) === normalizar(nombre))
    if (!existe) {
      await ia.servicio.asegurarMiembroIA(nombre)
      informe.miembrosCreados.push(nombre)
    }
  }
  if (faltantes.size) miembros = await ia.mencionables()
  const mencionables: MiembroMencionable[] = miembros.map((m) => ({ id: m.id, alias: m.alias, nombre: m.nombre, archivado: m.archivado }))
  const porId = new Map(miembros.map((m) => [m.id, m]))
  // El alias de una IA conocida que no coincide con el de su miembro («@gpt» y el miembro ChatGPT) se resuelve por el nombre.
  const resolver = (alias: string): MiembroMencionable | null => {
    const directo = resolverExacto(alias, mencionables)
    if (directo) return directo
    const nombre = IA_CONOCIDAS[alias]
    return nombre ? (mencionables.find((m) => !m.archivado && porId.get(m.id)?.tipo === 'ia' && normalizar(m.nombre) === normalizar(nombre)) ?? null) : null
  }

  const ids = comentarios.map((c) => c.id as string)
  const existentes = await ia.filasDeOrigenes(ids.map((id) => ({ tipo: 'comentario' as const, id })))
  // Lo que las IA comentaron, por tarjeta, para saber si ya respondieron después.
  const tarjetas = [...new Set(comentarios.map((c) => c.tarjeta_id as string))]
  const deIA = await ia.db.consulta<Fila>(
    `select c.tarjeta_id, c.creado_en, c.autor from comentarios c where c.tarjeta_id = any($1::text[]) and c.autor->>'tipo' = 'ia'`,
    [tarjetas],
  )

  const contadas = new Set<string>()
  for (const c of comentarios) {
    const autor = c.autor as Actor
    if (autor?.tipo === 'sistema') continue
    const cuentas = new Map<string, number>()
    const posiciones = new Map<string, number[]>()
    for (const m of extraerMenciones(c.cuerpo)) {
      const mb = resolver(m.alias)
      if (!mb || mb.id === autor?.id) continue
      cuentas.set(mb.id, (cuentas.get(mb.id) ?? 0) + 1)
      posiciones.set(mb.id, [...(posiciones.get(mb.id) ?? []), m.desde])
    }
    for (const [miembroId, ahora] of cuentas) {
      const filas = existentes.filter((f) => f.origen_id === c.id && f.destinatario_id === miembroId)
      const anotadas = filas.filter((f) => f.en_texto).length
      if (ahora <= anotadas) continue
      const destino = porId.get(miembroId)!
      let ocurrencia = Math.max(0, ...filas.map((f) => f.ocurrencia as number))
      for (let n = anotadas; n < ahora; n++) {
        const despues =
          destino.tipo === 'ia'
            ? deIA.find(
                (r) =>
                  r.tarjeta_id === c.tarjeta_id &&
                  new Date(r.creado_en).getTime() > new Date(c.creado_en).getTime() &&
                  ((r.autor as Actor).id === miembroId || normalizar((r.autor as Actor).nombre ?? '') === normalizar(destino.nombre)),
              )
            : undefined
        const pendiente = destino.tipo === 'ia' && !despues
        const fila = await ia.insertarMencion({
          origen: { tipo: 'comentario', id: c.id },
          ocurrencia: ++ocurrencia,
          destinatarioId: miembroId,
          autor,
          extracto: extractoDe(c.cuerpo, posiciones.get(miembroId) ?? [], n),
          proyectoId: c.proyecto_id,
          tableroId: c.tablero_id,
          tarjetaId: c.tarjeta_id,
          tarjetaClave: c.clave,
          estado: pendiente ? 'pendiente' : 'atendida',
          nota: pendiente ? null : destino.tipo === 'ia' ? 'La IA ya comentó después en esa tarjeta.' : 'Se le avisó por la campana.',
          atendidaEn: pendiente ? null : despues ? new Date(despues.creado_en).toISOString() : new Date(c.creado_en).toISOString(),
          atendidaPor: despues ? (despues.autor as Actor) : null,
          creadoEn: new Date(c.creado_en).toISOString(),
        })
        if (!fila) continue
        // Se cuenta por comentario y miembro (dos «@claude» en el mismo texto son una sola cosa para atender).
        const clave = `${c.id}:${miembroId}`
        if (contadas.has(clave)) continue
        contadas.add(clave)
        if (pendiente) informe.pendientes++
        else informe.atendidas++
      }
    }
  }
  return informe
}
