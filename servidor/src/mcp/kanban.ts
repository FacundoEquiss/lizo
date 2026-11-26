// Herramientas del Kanban: leer un tablero, una tarjeta, buscar y la actividad; crear, cambiar, mover, archivar y
// comentar tarjetas; el porqué, los vínculos y las listas.
import { z } from 'zod'
import { PAGINA_HECHO, llegoAHecho, porRecienteEnHecho } from '../../../compartido/hecho'
import type { TarjetaResumen } from '../../../compartido/tipos'
import { nombreDeRama } from '../../../compartido/enlaces'
import { frasePorVistas, leerVistas, mensajeSinVista, vistaInicial } from '../../../compartido/vistas'
import { urlServidor } from '../config'
import { ErrorDominio } from '../dominio/servicio'
import { compacta, contextoDe, definir, colores, limpio, refProyecto, refTablero, refTarjeta, respuestaTarjeta, urlTablero, urlTarjeta, type Contexto } from './comun'
import { arbolDelLienzo } from './lienzo'

const tiposTarjeta = z
  .enum(['epica', 'historia', 'tarea', 'error', 'idea', 'pregunta', 'decision'])
  .describe('Tipo: epica (agrupa otras), historia, tarea, error, idea, pregunta o decision.')
const prioridades = z.enum(['urgente', 'alta', 'media', 'baja', 'ninguna']).describe('Prioridad.')

const esquemaPorque = z.strictObject({
  motivo: z.string().optional().describe('Por qué existe la tarjeta: el problema o la oportunidad (markdown).'),
  contexto: z.string().optional().describe('Qué se sabía, restricciones, de dónde salió.'),
  opciones: z
    .array(
      z.strictObject({
        titulo: z.string(),
        pros: z.string().optional(),
        contras: z.string().optional(),
        elegida: z.boolean().optional(),
        descartada_porque: z.string().optional(),
      }),
    )
    .optional()
    .describe('Opciones consideradas. Reemplaza la lista anterior completa.'),
  decision: z.string().optional().describe('Qué se decidió.'),
  consecuencias: z.string().optional().describe('Qué implica y qué se resigna.'),
  estado: z.enum(['abierta', 'propuesta', 'aceptada', 'rechazada', 'reemplazada']).optional(),
  evidencias: z
    .array(z.string())
    .optional()
    .describe('Links o referencias que lo respaldan (PR, issue, Figma, métrica, conversación). Reemplaza la lista.'),
  revisar_en: z.string().optional().describe('Fecha para volver a mirarlo (AAAA-MM-DD).'),
})

type EsquemaPorque = z.infer<typeof esquemaPorque>

function porqueDesde(p: EsquemaPorque) {
  return {
    ...(p.motivo !== undefined && { motivo: p.motivo }),
    ...(p.contexto !== undefined && { contexto: p.contexto }),
    ...(p.decision !== undefined && { decision: p.decision }),
    ...(p.consecuencias !== undefined && { consecuencias: p.consecuencias }),
    ...(p.estado !== undefined && { estado: p.estado }),
    ...(p.evidencias !== undefined && { evidencias: p.evidencias }),
    ...(p.revisar_en !== undefined && { revisarEn: p.revisar_en }),
    ...(p.opciones !== undefined && {
      opciones: p.opciones.map((o) => ({
        titulo: o.titulo,
        pros: o.pros,
        contras: o.contras,
        elegida: o.elegida,
        descartadaPorque: o.descartada_porque,
      })),
    }),
  }
}

export const HERRAMIENTAS_KANBAN = [
  definir({
    nombre: 'leer_tablero',
    titulo: 'Leer un tablero',
    descripcion:
      'Devuelve el Kanban de un tablero (y sus vistas: kanban, lienzo y/o diseno; un tablero que no tiene Kanban, como un diagrama, no trae listas): cada lista con sus tarjetas resumidas (clave, tipo, título, etiquetas, responsables, vencimiento, porqué…). De cada lista de "hecho" vienen las 20 más recientes (la que llegó último, primero) con cantidad (el total real) y ocultas (cuántas no vinieron): para ver las anteriores pedí hechas_desde: 20 (y 40…), o incluir_hechas: true para todas. Telar archiva solo lo que lleva mucho en Hecho (se restaura con archivar_tarjeta). Del lienzo trae un resumen; el lienzo entero (marcos, objetos y conectores) lo da leer_lienzo, o esta misma con incluir_lienzo: true. Ejemplo: { "proyecto": "RC", "tablero": "Pendientes" }',
    esquema: z.strictObject({
      tablero: refTablero,
      proyecto: refProyecto,
      lista: z.string().optional().describe('Si se indica, solo esa lista.'),
      incluir_hechas: z.boolean().optional().describe('true: todas las tarjetas de las listas de categoría "hecho" (de fábrica vienen las 20 más recientes de cada una).'),
      hechas_desde: z.number().int().min(0).optional().describe('De cada lista de "hecho", salteá estas tarjetas (las más recientes) y traé las que siguen: 20 trae la segunda tanda, 40 la tercera.'),
      hechas_cantidad: z.number().int().min(0).max(100).optional().describe('Cuántas tarjetas traer de cada lista de "hecho" (de fábrica 20; 0 = solo la cantidad).'),
      incluir_lienzo: z.boolean().optional().describe('Incluir el lienzo completo, como lo devuelve leer_lienzo (de fábrica, solo un resumen).'),
    }),
    soloLectura: true,
    async ejecutar(s, _a, args) {
      // Sin nombre: el primero del proyecto que tenga Kanban (si ninguno lo tiene, el primero, que de todos modos dice sus vistas).
      const tf = args.tablero
        ? await s.resolverTablero(args.tablero, args.proyecto)
        : await s.resolverTablero(undefined, args.proyecto, { vista: 'kanban' }).catch(async (e) => {
            if (!(e instanceof ErrorDominio) || e.estado !== 409) throw e
            return s.resolverTablero(undefined, args.proyecto)
          })
      const vistas = leerVistas(tf.ajustes)
      if (args.lista && !vistas.includes('kanban')) throw new ErrorDominio(mensajeSinVista(tf.nombre, 'kanban', vistas), 409)
      if (args.incluir_lienzo && !vistas.includes('lienzo')) throw new ErrorDominio(mensajeSinVista(tf.nombre, 'lienzo', vistas), 409)
      const completo = await s.leerTableroCompleto(tf.id)
      const ctx: Contexto = {
        listas: new Map(completo.listas.map((l) => [l.id, l])),
        etiquetas: new Map(completo.etiquetas.map((e) => [e.id, e])),
        miembros: new Map(completo.miembros.map((m) => [m.id, m])),
      }
      const soloLista = args.lista ? (await s.resolverLista(tf.id, args.lista)).id : null
      const listas = completo.listas
        .filter((l) => !soloLista || l.id === soloLista)
        .map((l) => {
          const todas = completo.tarjetas.filter((t) => t.listaId === l.id && !t.archivada)
          if (l.categoria !== 'hecho')
            return limpio({ nombre: l.nombre, categoria: l.categoria ?? undefined, limite: l.limite ?? undefined, cantidad: todas.length, tarjetas: todas.map((t) => compacta(t, ctx)) })
          // Hecho se acumula: las más recientes (por cuándo llegaron a Hecho), de a una tanda; el resto se pide con hechas_desde.
          const recientes = [...todas].sort(porRecienteEnHecho)
          const desde = args.incluir_hechas ? 0 : (args.hechas_desde ?? 0)
          const cuantas = args.incluir_hechas ? recientes.length : (args.hechas_cantidad ?? PAGINA_HECHO)
          const traidas = recientes.slice(desde, desde + cuantas)
          const ocultas = todas.length - traidas.length
          return limpio({
            nombre: l.nombre,
            categoria: l.categoria ?? undefined,
            limite: l.limite ?? undefined,
            cantidad: todas.length,
            ocultas: ocultas || undefined,
            tarjetas: traidas.map((t) => ({ ...compacta(t, ctx), llego_a_hecho: llegoAHecho(t).slice(0, 10) })),
            para_ver_mas: ocultas && desde + traidas.length < todas.length ? { hechas_desde: desde + traidas.length } : undefined,
          })
        })
      const marcos = completo.elementos.filter((e) => e.tipo === 'marco')
      return {
        proyecto: { prefijo: completo.proyecto.prefijo, nombre: completo.proyecto.nombre, repo_github: completo.proyecto.repoGithub ?? undefined },
        tablero: {
          id: completo.tablero.id,
          nombre: completo.tablero.nombre,
          vistas,
          url: urlTablero(completo.proyecto.prefijo, completo.tablero.slug, vistaInicial(vistas)),
        },
        // Solo lo que el tablero tiene: sin Kanban no hay listas, sin lienzo no hay resumen del lienzo.
        listas: vistas.includes('kanban') ? listas : undefined,
        lienzo: !vistas.includes('lienzo')
          ? undefined
          : args.incluir_lienzo
            ? await arbolDelLienzo(s, tf.id)
            : {
                marcos: marcos.map((m) => String(m.datos.titulo ?? '')).filter(Boolean),
                objetos: completo.elementos.length - marcos.length,
                conectores: completo.conectores.length,
                para_ver_todo: 'leer_lienzo',
              },
        aviso: vistas.includes('kanban') ? undefined : `Este tablero no tiene Kanban (tiene: ${frasePorVistas(vistas)}).${vistas.includes('lienzo') ? ' Para el lienzo completo: leer_lienzo.' : ''}`,
      }
    },
  }),

  definir({
    nombre: 'leer_tarjeta',
    titulo: 'Leer una tarjeta',
    descripcion:
      'Devuelve una tarjeta completa: descripción, porqué (motivo, contexto, opciones, decisión, consecuencias, estado, evidencias), checklists, comentarios, vínculos, enlaces, adjuntos, lo que llegó de Discord (citas y respuesta sugerida) y su actividad reciente. Ejemplo: { "tarjeta": "RC-12" }',
    esquema: z.strictObject({ tarjeta: refTarjeta }),
    soloLectura: true,
    async ejecutar(s, _a, { tarjeta }) {
      const d = await s.leerTarjeta(tarjeta)
      const ctx = await contextoDe(s, d.proyectoId, [d.tableroId])
      return {
        ...compacta(d, ctx),
        url: urlTarjeta(d.clave),
        rama_sugerida: nombreDeRama(d.clave, d.titulo),
        descripcion: d.descripcion || undefined,
        inicio: d.fechas.inicio ?? undefined,
        completada: d.fechas.completada ?? undefined,
        padre: d.padre ? `${d.padre.clave} ${d.padre.titulo}` : undefined,
        hijas: d.hijas.length ? d.hijas.map((h) => `${h.clave} ${h.titulo}`) : undefined,
        porque: d.porqueCompleto ?? undefined,
        checklists: d.checklists.length
          ? d.checklists.map((c) => ({ titulo: c.titulo, items: c.items.map((i) => `${i.hecho ? '[x]' : '[ ]'} ${i.texto}`) }))
          : undefined,
        vinculos: d.vinculos.length
          ? d.vinculos.map((v) => `${v.texto} ${v.otra.clave} «${v.otra.titulo}»${v.otra.listaNombre ? ` (${v.otra.listaNombre})` : ''}`)
          : undefined,
        enlaces: d.enlaces.length ? d.enlaces.map((e) => ({ tipo: e.tipo, titulo: e.titulo, url: e.url })) : undefined,
        adjuntos: d.adjuntos.length
          ? d.adjuntos.map((a) => ({ nombre: a.nombre, descripcion: a.descripcion || undefined, url: urlServidor() + a.url }))
          : undefined,
        discord: d.discordDatos
          ? {
              id: d.discordDatos.id,
              canal: d.discordDatos.canal,
              autores: d.discordDatos.autores,
              citas: d.discordDatos.citas.map((c) => `${c.autor}${c.fecha ? ` (${c.fecha})` : ''}: ${c.texto}`),
              respuesta_sugerida: d.discordDatos.respuestaSugerida || undefined,
              evidencia: d.discordDatos.evidencia || undefined,
            }
          : undefined,
        comentarios: d.comentarios.length
          ? d.comentarios.slice(-20).map((c) => ({ id: c.id, autor: c.autor.nombre, en: c.creadoEn, ...(c.respuestaA ? { responde_a: c.respuestaA } : {}), texto: c.cuerpo }))
          : undefined,
        actividad: d.actividad.slice(0, 10).map((a) => `${a.creadoEn.slice(0, 16).replace('T', ' ')} ${a.actor.nombre} ${a.resumen}`),
      }
    },
  }),

  definir({
    nombre: 'buscar',
    titulo: 'Buscar tarjetas',
    descripcion:
      'Busca tarjetas por texto (título, descripción, porqué, comentarios, citas de Discord) y con operadores: tipo:error, #etiqueta, @nombre o @yo, lista:"Por hacer", estado:hecho|en_curso|por_hacer, prioridad:alta, vence:semana|vencidas, tiene:pr|figma|discord|porque|adjuntos, porque:aceptada. Un "-" delante niega (por ejemplo -tipo:idea). Ejemplo: { "consulta": "mozo #interfaz -tipo:idea", "proyecto": "RC" }',
    esquema: z.strictObject({
      consulta: z.string().min(1).describe('Texto y/u operadores.'),
      proyecto: refProyecto,
      tablero: refTablero,
      limite: z.number().int().min(1).max(100).optional().describe('Máximo de resultados (por defecto 20).'),
    }),
    soloLectura: true,
    async ejecutar(s, _a, args) {
      const proyecto = args.proyecto ? await s.resolverProyecto(args.proyecto) : null
      const tablero = args.tablero ? await s.resolverTablero(args.tablero, args.proyecto) : null
      const r = await s.buscar(args.consulta, { proyectoId: proyecto?.id, tableroId: tablero?.id, limite: args.limite ?? 20 })
      const contextos = new Map<string, Contexto>()
      const salida = []
      for (const x of r) {
        let ctx = contextos.get(x.tarjeta.proyectoId)
        if (!ctx) {
          const tableros = [...new Set(r.map((y) => y.tarjeta.tableroId))]
          ctx = await contextoDe(s, x.tarjeta.proyectoId, tableros)
          contextos.set(x.tarjeta.proyectoId, ctx)
        }
        salida.push({ ...compacta(x.tarjeta, ctx), tablero: x.tableroNombre, fragmento: x.fragmento || undefined })
      }
      return { cantidad: salida.length, resultados: salida }
    },
  }),

  definir({
    nombre: 'leer_actividad',
    titulo: 'Leer la actividad',
    descripcion:
      'Lo último que pasó (quién hizo qué y cuándo), de un proyecto, un tablero o una tarjeta. Sirve para ver qué cambió desde la última vez. Ejemplo: { "proyecto": "RC", "limite": 20 }',
    esquema: z.strictObject({
      proyecto: refProyecto,
      tablero: refTablero,
      tarjeta: refTarjeta.optional(),
      limite: z.number().int().min(1).max(200).optional().describe('Por defecto 30.'),
      solo_ia: z.boolean().optional().describe('Solo lo que hicieron las IA por MCP.'),
    }),
    soloLectura: true,
    async ejecutar(s, _a, args) {
      const tarjeta = args.tarjeta ? await s.resolverTarjeta(args.tarjeta) : null
      const tablero = !tarjeta && args.tablero ? await s.resolverTablero(args.tablero, args.proyecto) : null
      const proyecto = !tarjeta && !tablero && args.proyecto ? await s.resolverProyecto(args.proyecto) : null
      const act = await s.listarActividad({
        tarjetaId: tarjeta?.id,
        tableroId: tablero?.id,
        proyectoId: proyecto?.id,
        limite: args.limite ?? 30,
        soloIA: args.solo_ia,
      })
      return {
        actividad: act.map((a) => ({
          en: a.creadoEn,
          autor: a.actor.nombre + (a.actor.cliente && a.actor.cliente !== a.actor.nombre ? ` (${a.actor.cliente})` : ''),
          que: a.resumen,
        })),
      }
    },
  }),

  definir({
    nombre: 'crear_tarjeta',
    titulo: 'Crear una tarjeta',
    descripcion:
      'Crea una tarjeta en una lista de un tablero. Las etiquetas que no existen se crean. Se le puede cargar el porqué, links (GitHub, Figma, Discord), una checklist y mostrarla además en el lienzo (dentro de un marco). Devuelve su clave (RC-123). Ejemplo: { "titulo": "El mozo tropieza con las mesas", "tipo": "error", "lista": "Por hacer", "etiquetas": ["Interfaz"], "porque": { "motivo": "Se ve torpe y rompe el ritmo." }, "en_lienzo": { "marco": "Interfaz" } }',
    esquema: z.strictObject({
      titulo: z.string().min(1).describe('Título corto y claro.'),
      proyecto: refProyecto,
      tablero: refTablero,
      lista: z.string().optional().describe('Nombre de la lista (por ejemplo "Por hacer"). Si se omite, la primera.'),
      tipo: tiposTarjeta.optional(),
      descripcion: z.string().optional().describe('Descripción en markdown.'),
      prioridad: prioridades.optional(),
      etiquetas: z.array(z.string()).optional().describe('Nombres de etiquetas.'),
      responsables: z.array(z.string()).optional().describe('Nombres de miembros (o "yo" para el dueño).'),
      vence: z.string().optional().describe('Vencimiento: AAAA-MM-DD o ISO 8601 con hora.'),
      inicio: z.string().optional().describe('Inicio: AAAA-MM-DD.'),
      estimacion: z.number().min(0).optional().describe('Puntos de estimación.'),
      padre: z.string().optional().describe('Clave de la épica o tarjeta madre.'),
      posicion: z.enum(['arriba', 'abajo']).optional().describe('Dónde queda en la lista (por defecto abajo).'),
      porque: esquemaPorque.optional().describe('El porqué de la tarjeta.'),
      enlaces: z.array(z.string()).optional().describe('Links a GitHub (issue, PR, commit, rama), Figma o Discord.'),
      checklist: z.strictObject({ titulo: z.string().optional(), items: z.array(z.string()).min(1) }).optional(),
      en_lienzo: z
        .object({ marco: z.string().optional().describe('Título del marco donde ponerla (por ejemplo "Mecánicas").') })
        .optional()
        .describe('Si se indica, la tarjeta también se muestra en el lienzo.'),
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const tf = await s.resolverTablero(a.tablero, a.proyecto, { vista: 'kanban' })
      const lista = a.lista ? await s.resolverLista(tf.id, a.lista) : null
      const ctx = { actor }
      const t = await s.crearTarjeta(ctx, {
        tableroId: tf.id,
        listaId: lista?.id,
        titulo: a.titulo,
        tipo: a.tipo,
        descripcion: a.descripcion,
        prioridad: a.prioridad,
        etiquetas: a.etiquetas,
        responsables: a.responsables,
        vence: a.vence,
        inicio: a.inicio,
        estimacion: a.estimacion,
        padre: a.padre,
        posicion: a.posicion,
        porque: a.porque ? porqueDesde(a.porque) : undefined,
        enlaces: a.enlaces,
        checklist: a.checklist,
      })
      if (a.en_lienzo) await s.agregarAlLienzo(ctx, tf.id, { tipo: 'tarjeta', tarjeta: t.clave, marco: a.en_lienzo.marco })
      return respuestaTarjeta(s, await s.resumenTarjeta(t.id), `Creé ${t.clave}.`)
    },
  }),

  definir({
    nombre: 'actualizar_tarjeta',
    titulo: 'Actualizar una tarjeta',
    descripcion:
      'Cambia campos de una tarjeta: título, descripción, tipo, prioridad, estimación, fechas, etiquetas, responsables, épica madre o si está completada. Solo se cambia lo que mandes. Para moverla de lista usá mover_tarjeta; para el porqué, registrar_porque. Ejemplo: { "tarjeta": "RC-12", "prioridad": "alta", "etiquetas_agregar": ["Cocina"], "vence": "2026-12-15" }',
    esquema: z.strictObject({
      tarjeta: refTarjeta,
      titulo: z.string().min(1).optional(),
      descripcion: z.string().optional().describe('Reemplaza la descripción completa (markdown).'),
      tipo: tiposTarjeta.optional(),
      prioridad: prioridades.optional(),
      estimacion: z.number().min(0).nullable().optional().describe('Puntos; null la quita.'),
      etiquetas_agregar: z.array(z.string()).optional(),
      etiquetas_quitar: z.array(z.string()).optional(),
      responsables_agregar: z.array(z.string()).optional(),
      responsables_quitar: z.array(z.string()).optional(),
      vence: z.string().nullable().optional().describe('AAAA-MM-DD o ISO; null lo quita.'),
      inicio: z.string().nullable().optional(),
      completada: z.boolean().optional().describe('Marca el vencimiento como cumplido (o no).'),
      padre: z.string().nullable().optional().describe('Clave de la épica madre; null la saca.'),
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const t = await s.actualizarTarjeta({ actor }, a.tarjeta, {
        titulo: a.titulo,
        descripcion: a.descripcion,
        tipo: a.tipo,
        prioridad: a.prioridad,
        estimacion: a.estimacion,
        agregarEtiquetas: a.etiquetas_agregar,
        quitarEtiquetas: a.etiquetas_quitar,
        agregarResponsables: a.responsables_agregar,
        quitarResponsables: a.responsables_quitar,
        vence: a.vence,
        inicio: a.inicio,
        completada: a.completada,
        padre: a.padre,
      })
      return respuestaTarjeta(s, t, `Actualicé ${t.clave}.`)
    },
  }),

  definir({
    nombre: 'mover_tarjeta',
    titulo: 'Mover una tarjeta',
    descripcion:
      'Mueve una tarjeta a otra lista (o la reordena en la misma). Si la lista de destino es de categoría "hecho", la tarjeta queda completada. Ejemplo: { "tarjeta": "RC-12", "lista": "En curso", "posicion": "arriba" }',
    esquema: z.strictObject({
      tarjeta: refTarjeta,
      lista: z.string().min(1).describe('Nombre de la lista de destino.'),
      tablero: z.string().optional().describe('Tablero de destino, si es otro del mismo proyecto.'),
      posicion: z
        .union([z.enum(['arriba', 'abajo']), z.number().int().min(0)])
        .optional()
        .describe('"arriba", "abajo" (por defecto) o un índice desde 0.'),
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const t = await s.resolverTarjeta(a.tarjeta)
      const tableroId = a.tablero ? (await s.resolverTablero(a.tablero, t.proyecto_id, { vista: 'kanban' })).id : t.tablero_id
      const lista = await s.resolverLista(tableroId, a.lista)
      const r = await s.moverTarjeta({ actor }, t.id, { listaId: lista.id, posicion: a.posicion })
      return respuestaTarjeta(s, r, `Moví ${r.clave} a «${lista.nombre}».`)
    },
  }),

  definir({
    nombre: 'archivar_tarjeta',
    titulo: 'Archivar una tarjeta',
    descripcion:
      'Archiva una tarjeta (sale del kanban pero no se borra; se puede restaurar). Con restaurar: true la vuelve a su lista. No existe borrar. Ejemplo: { "tarjeta": "RC-12" } · para devolverla: { "tarjeta": "RC-12", "restaurar": true }',
    esquema: z.strictObject({ tarjeta: refTarjeta, restaurar: z.boolean().optional() }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const t = await s.archivarTarjeta({ actor }, a.tarjeta, !a.restaurar)
      return respuestaTarjeta(s, t, a.restaurar ? `Restauré ${t.clave}.` : `Archivé ${t.clave}.`)
    },
  }),

  definir({
    nombre: 'comentar',
    titulo: 'Comentar una tarjeta',
    descripcion: 'Agrega un comentario (markdown) a una tarjeta. Queda firmado con tu nombre. Empezalo con un encabezado en negrita (**Revisado 24/11:**, **Respuesta para Discord** (a Ana, #general):, **Hecho 24/11:**…): el formato de cada uno está en leer_guia { "tema": "respuestas" }. Si te habían mencionado en esa tarjeta, comentar atiende la mención (queda atendida sola y la persona recibe el aviso); con responde_a contestás un comentario puntual (su id sale en leer_tarjeta). Ejemplo: { "tarjeta": "RC-12", "texto": "**Revisado 24/11:** probé con 30 clientes y anda bien. **Tamaño: chico.**" }',
    esquema: z.strictObject({
      tarjeta: refTarjeta,
      texto: z.string().min(1).describe('Comentario en markdown.'),
      responde_a: z.string().min(1).optional().describe('El id de un comentario de la MISMA tarjeta al que contestás (se ve como respuesta en el hilo).'),
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      await s.comentar({ actor }, a.tarjeta, a.texto, { respuestaA: a.responde_a })
      return respuestaTarjeta(s, await s.resumenTarjeta((await s.resolverTarjeta(a.tarjeta)).id), 'Comentario agregado.')
    },
  }),

  definir({
    nombre: 'registrar_porque',
    titulo: 'Registrar el porqué',
    descripcion:
      'Carga o actualiza EL PORQUÉ de una tarjeta, con la forma de un registro de decisión: motivo (por qué existe), contexto, opciones consideradas (con pros, contras y cuál se eligió), decisión, consecuencias, estado (abierta, propuesta, aceptada, rechazada, reemplazada) y evidencias. Solo se cambia lo que mandes. Ejemplo: { "tarjeta": "RC-12", "decision": "Mesas de a dos", "estado": "aceptada", "opciones": [ { "titulo": "Mesas de a cuatro", "descartada_porque": "No entran en el local chico" } ] }',
    esquema: esquemaPorque.extend({ tarjeta: refTarjeta }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const { tarjeta, ...resto } = a
      const t = await s.registrarPorque({ actor }, tarjeta, porqueDesde(resto))
      return respuestaTarjeta(s, t, `Porqué de ${t.clave} guardado.`)
    },
  }),

  definir({
    nombre: 'vincular',
    titulo: 'Vincular',
    descripcion:
      'Vincula una tarjeta con otra (con: clave y tipo: bloquea, depende_de, relacionada, duplica, causa o implementa) o le agrega un enlace externo (url: issue, PR, commit o rama de GitHub, archivo o frame de Figma, mensaje de Discord o cualquier link). "depende_de" es la vuelta de "bloquea". Ejemplos: { "tarjeta": "RC-12", "tipo": "bloquea", "con": "RC-15" } · { "tarjeta": "RC-12", "url": "https://github.com/usuario/repo/pull/7" }',
    esquema: z.strictObject({
      tarjeta: refTarjeta,
      tipo: z
        .enum(['bloquea', 'depende_de', 'relacionada', 'duplica', 'causa', 'implementa'])
        .optional()
        .describe('Tipo de vínculo entre tarjetas (por defecto relacionada).'),
      con: z.string().optional().describe('Clave de la otra tarjeta.'),
      url: z.string().optional().describe('Link externo (GitHub, Figma, Discord…).'),
      titulo: z.string().optional().describe('Título para el link externo.'),
      nota: z.string().optional(),
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      if (!a.con && !a.url) throw new Error('Mandá "con" (otra tarjeta) o "url" (un link externo).')
      let t: TarjetaResumen | null = null
      if (a.url) t = await s.agregarEnlace({ actor }, a.tarjeta, a.url, a.titulo)
      if (a.con) t = await s.vincular({ actor }, a.tarjeta, a.tipo ?? 'relacionada', a.con, a.nota ?? '')
      return respuestaTarjeta(s, t!, 'Vínculo guardado.')
    },
  }),

  definir({
    nombre: 'crear_lista',
    titulo: 'Crear una lista',
    descripcion:
      'Crea una lista (columna) en un tablero. La categoría opcional ata la lista a un estado: por_hacer, en_curso o hecho. Ejemplo: { "nombre": "En revisión", "categoria": "en_curso", "posicion": 2 }',
    esquema: z.strictObject({
      nombre: z.string().min(1),
      proyecto: refProyecto,
      tablero: refTablero,
      categoria: z.enum(['por_hacer', 'en_curso', 'hecho']).optional(),
      posicion: z.number().int().min(0).optional().describe('Índice desde 0 (por defecto al final).'),
    }),
    soloLectura: false,
    async ejecutar(s, actor, a) {
      const tf = await s.resolverTablero(a.tablero, a.proyecto, { vista: 'kanban' })
      const l = await s.crearLista({ actor }, { tableroId: tf.id, nombre: a.nombre, categoria: a.categoria ?? null, posicion: a.posicion })
      return { ok: true, mensaje: `Creé la lista «${l.nombre}» en «${tf.nombre}».`, lista: { id: l.id, nombre: l.nombre, categoria: l.categoria } }
    },
  }),

  definir({
    nombre: 'actualizar_lista',
    titulo: 'Cambiar una lista',
    descripcion:
      'Cambia una lista (columna) de un tablero: nombre, categoría (por_hacer, en_curso, hecho o ninguna), color, límite de tarjetas (WIP) o su lugar. Con archivada: true la saca del Kanban (con sus tarjetas adentro, que no se pierden); archivada: false la devuelve. Solo cambia lo que mandes. Ejemplo: { "lista": "En curso", "limite": 3 }',
    esquema: z.strictObject({
      lista: z.string().min(1).describe('Nombre (o id) de la lista.'),
      proyecto: refProyecto,
      tablero: refTablero,
      nombre: z.string().min(1).max(60).optional().describe('Nombre nuevo.'),
      categoria: z.enum(['por_hacer', 'en_curso', 'hecho', 'ninguna']).optional().describe('El estado que representa ("ninguna" la saca).'),
      color: z.union([colores, z.literal('ninguno')]).optional().describe('Color del punto de la lista ("ninguno" lo saca).'),
      limite: z.number().int().min(0).max(200).optional().describe('Máximo de tarjetas (WIP); 0 lo saca.'),
      posicion: z.number().int().min(0).optional().describe('Lugar entre las listas, desde 0.'),
      archivada: z.boolean().optional().describe('true la archiva; false la devuelve.'),
    }),
    soloLectura: false,
    idempotente: true,
    async ejecutar(s, actor, a) {
      const tf = await s.resolverTablero(a.tablero, a.proyecto, { vista: 'kanban' })
      const l = await s.resolverLista(tf.id, a.lista, { archivadas: true })
      const cambios = limpio({
        nombre: a.nombre,
        categoria: a.categoria === undefined ? undefined : a.categoria === 'ninguna' ? null : a.categoria,
        color: a.color === undefined ? undefined : a.color === 'ninguno' ? null : a.color,
        limite: a.limite === undefined ? undefined : a.limite === 0 ? null : a.limite,
        indice: a.posicion,
        archivada: a.archivada,
      })
      if (!Object.keys(cambios).length) throw new ErrorDominio('No mandaste nada para cambiar (nombre, categoria, color, limite, posicion o archivada).')
      const r = await s.actualizarLista({ actor }, l.id, cambios)
      return {
        ok: true,
        mensaje: a.archivada === true ? `Archivé la lista «${r.nombre}».` : a.archivada === false ? `Devolví la lista «${r.nombre}».` : `Cambié la lista «${r.nombre}».`,
        lista: limpio({ id: r.id, nombre: r.nombre, categoria: r.categoria ?? undefined, color: r.color ?? undefined, limite: r.limite ?? undefined, archivada: r.archivada || undefined }),
      }
    },
  }),
]
