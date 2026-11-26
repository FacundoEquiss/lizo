// Prueba de punta a punta del MCP con el cliente oficial (@modelcontextprotocol/client), como lo usa una IA: se conecta
// a un Telar LOCAL por HTTP (/mcp, con la clave de "Conectar IA"), crea un proyecto de prueba con su tablero, arma un
// pedazo de lienzo con todo (texto con formato, notas, formas, marcos y conectores con etiqueta y estilo), lo cambia,
// lo lee de vuelta y revisa que esté todo. También prueba la guía (leer_guia, igual a docs/guia-para-ias.md) y que los
// errores digan cómo corregir.
//
//   npm run dev                                  (en otra terminal)
//   node scripts/probar-mcp.mjs                  (contra http://127.0.0.1:4337)
//   node scripts/probar-mcp.mjs --web http://127.0.0.1:4337 --dejar
//   node scripts/probar-mcp.mjs --stdio          (por `npm run mcp`, como Claude Code o Claude Desktop)
//   node scripts/probar-mcp.mjs --codigo-viejo   (contra un Telar de ANTES de las menciones: salta lo que es de la IA integrada;
//                                                 lo usa npm run cuentas:probar para sembrar una base anterior)
//
// Al terminar archiva el proyecto de prueba (queda en "Archivados", no se borra nada); con --dejar queda a la vista.
// Nunca apunta a producción: se niega si la dirección no es 127.0.0.1 o localhost.
import { readFileSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { SkillsClient } from '@modelcontextprotocol/client/ext/skills'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const WEB = opcion('web', 'http://127.0.0.1:4337')
const DEJAR = args.includes('--dejar')
const STDIO = args.includes('--stdio')
const VIEJO = args.includes('--codigo-viejo')
if (!['127.0.0.1', 'localhost'].includes(new URL(WEB).hostname)) {
  console.error('Solo contra un Telar local (127.0.0.1 o localhost).')
  process.exit(1)
}

let fallas = 0
const ok = (cond, que, detalle) => {
  if (!cond) fallas++
  console.log(`${cond ? '  ✓' : '  ✗'} ${que}${!cond && detalle !== undefined ? `\n      ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}` : ''}`)
  return cond
}

/** Una foto de 64 × 64 (un cuadrado naranja con una franja), como data URL PNG. */
function fotoDePrueba() {
  const ancho = 64
  const crudo = Buffer.alloc((ancho * 3 + 1) * ancho)
  for (let y = 0; y < ancho; y++) {
    crudo[y * (ancho * 3 + 1)] = 0
    for (let x = 0; x < ancho; x++) {
      const o = y * (ancho * 3 + 1) + 1 + x * 3
      const franja = y > 26 && y < 38
      crudo[o] = franja ? 255 : 226
      crudo[o + 1] = franja ? 240 : 122
      crudo[o + 2] = franja ? 200 : 58
    }
  }
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4)
    largo.writeUInt32BE(datos.length)
    const cuerpo = Buffer.concat([Buffer.from(tipo), datos])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(cuerpo))
    return Buffer.concat([largo, cuerpo, crc])
  }
  const cabecera = Buffer.alloc(13)
  cabecera.writeUInt32BE(ancho, 0)
  cabecera.writeUInt32BE(ancho, 4)
  cabecera.set([8, 2, 0, 0, 0], 8)
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', cabecera), trozo('IDAT', deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))])
  return `data:image/png;base64,${png.toString('base64')}`
}

const info = await fetch(`${WEB}/api/info`).then((r) => {
  if (!r.ok) throw new Error(`No pude leer ${WEB}/api/info (${r.status}). ¿Está corriendo npm run dev?`)
  return r.json()
})
const urlMcp = new URL(info.urlMcp)
if (!['127.0.0.1', 'localhost'].includes(urlMcp.hostname)) {
  console.error('El MCP de ese Telar no es local: no sigo.')
  process.exit(1)
}

/** Un cliente MCP firmado con ese autor (por HTTP, o por `npm run mcp` con --stdio). */
async function conectarComo(autor) {
  const c = new Client({ name: 'telar-prueba-mcp', version: '1.0.0' })
  await c.connect(
    STDIO
      ? // `npm run mcp` en la carpeta de Telar: le pide cada herramienta al servidor que ya corre (el de este puerto).
        new StdioClientTransport({
          command: 'npm',
          args: ['run', '--silent', 'mcp'],
          cwd: info.rutaTablero,
          env: { ...getDefaultEnvironment(), TABLERO_PUERTO: String(info.puerto), TABLERO_DATOS: info.rutaDatos, TABLERO_AUTOR: autor },
          stderr: 'ignore',
        })
      : new StreamableHTTPClientTransport(urlMcp, {
          requestInit: { headers: { authorization: `Bearer ${info.clave}`, 'x-tablero-autor': autor } },
        }),
  )
  return c
}
const cliente = await conectarComo('Prueba MCP')

/** Llama a una herramienta que contesta texto (como leer_guia) y lo devuelve. */
async function leerTexto(nombre, argumentos) {
  const r = await cliente.callTool({ name: nombre, arguments: argumentos })
  const texto = r.content?.map((c) => c.text ?? '').join('') ?? ''
  if (r.isError) throw new Error(`${nombre}: ${texto}`)
  return texto
}

/** Llama a una herramienta y devuelve el JSON de la respuesta (o el error como texto, si se pide). */
async function llamar(nombre, argumentos, { esperoError = false } = {}) {
  const r = await cliente.callTool({ name: nombre, arguments: argumentos })
  const texto = r.content?.map((c) => c.text ?? '').join('') ?? ''
  if (esperoError) {
    ok(r.isError === true, `${nombre} rechaza lo que está mal`, texto)
    return texto
  }
  if (r.isError) throw new Error(`${nombre}: ${texto}`)
  return JSON.parse(texto)
}

console.log(`\nMCP ${STDIO ? 'por stdio (npm run mcp)' : `en ${urlMcp.href}`} (${cliente.getServerVersion()?.name} ${cliente.getServerVersion()?.version})`)

// ───── 1. Las herramientas ─────
console.log('\nHerramientas')
const { tools } = await cliente.listTools()
const nombres = tools.map((t) => t.name)
for (const n of ['leer_guia', 'leer_lienzo', ...(VIEJO ? [] : ['ver_lienzo']), 'agregar_al_lienzo', 'armar_en_lienzo', 'actualizar_lienzo', 'convertir_objeto', 'crear_proyecto', 'actualizar_proyecto', 'crear_tablero', 'actualizar_tablero', 'actualizar_lista', 'quitar_del_lienzo', 'crear_tabla', 'leer_tabla', 'actualizar_tabla', 'crear_grafico', 'actualizar_grafico', ...(VIEJO ? [] : ['leer_pendientes', 'atender_mencion'])])
  ok(nombres.includes(n), `está ${n}`)
ok(nombres[0] === 'leer_guia', 'leer_guia es la primera de la lista', nombres.slice(0, 3))
ok(tools.every((t) => /^[a-z]+(_[a-z]+)*$/.test(t.name)), 'todos los nombres son verbo_cosa en minúsculas')
const sinEjemplo = tools.filter((t) => !/Ejemplo/.test(t.description ?? '')).map((t) => t.name)
ok(sinEjemplo.length === 0, 'todas traen un ejemplo en la descripción', sinEjemplo)
const abiertos = tools.filter((t) => t.inputSchema?.additionalProperties !== false).map((t) => t.name)
ok(abiertos.length === 0, 'los esquemas no aceptan parámetros inventados', abiertos)
const instrucciones = cliente.getInstructions() ?? ''
ok(/leer_lienzo/.test(instrucciones), 'las instrucciones hablan de leer_lienzo')
ok(/leer_guia/.test(instrucciones.slice(0, 400)), 'las instrucciones mandan a leer_guia de entrada')
ok(instrucciones.length <= 2000, `las instrucciones son cortas (${instrucciones.length} caracteres; los clientes recortan las largas)`)

// ───── 1b. La guía ─────
console.log('\nGuía')
const herrGuia = tools.find((t) => t.name === 'leer_guia')
ok(herrGuia?.annotations?.readOnlyHint === true && /Ejemplo: \{ "tema": "diagramas" \}/.test(herrGuia?.description ?? ''), 'leer_guia solo lee y trae su ejemplo', herrGuia?.description)
const TEMAS = ['kanban', 'lienzo', 'diagramas', 'tablas', 'diseno', 'fuentes', 'respuestas', ...(VIEJO ? [] : ['menciones'])]
const indice = await leerTexto('leer_guia', {})
ok(/Reglas de oro/.test(indice) && TEMAS.every((t) => indice.includes(`\`${t}\``)), 'leer_guia sin tema: las reglas de oro y el índice con los ocho temas')
const temas = {}
for (const t of TEMAS) temas[t] = await leerTexto('leer_guia', { tema: t })
ok(TEMAS.every((t) => temas[t].startsWith('## ') && temas[t].length > 1500), 'cada tema trae su guía', TEMAS.map((t) => `${t}: ${temas[t].length}`))
ok(/porqué/.test(temas.kanban) && /Hecho DD\/MM/.test(temas.kanban), 'kanban: el porqué y mover a Hecho con el dónde y el cuándo')
ok(/300 objetos/.test(temas.lienzo) && /posiciones/.test(temas.lienzo) && /quitar_del_lienzo/.test(temas.lienzo), 'lienzo: los límites de hoy, las posiciones exactas y quitar')
ok(/Letra mínima|letra mínima/.test(temas.diagramas) && /Cómo se lee/.test(temas.diagramas), 'diagramas: el método, la leyenda y la letra mínima')
ok(/crear_tabla/.test(temas.tablas) && /crear_grafico/.test(temas.tablas) && /rama/.test(temas.tablas), 'tablas: las herramientas, los tipos de columna y los gráficos')
ok(/definir_tokens/.test(temas.diseno) && /excluir/.test(temas.diseno) && /etapas/i.test(temas.diseno), 'diseno: tokens, excluir y etapas')
ok(/Discord/.test(temas.fuentes) && /[Ll]lamada/.test(temas.fuentes) && /Telegram/.test(temas.fuentes), 'fuentes: Discord con sus mensajes y llamadas, y Telegram')
ok(/Respuesta para Discord/.test(temas.respuestas), 'respuestas: el formato de la respuesta lista para Discord')
if (!VIEJO) ok(/leer_pendientes/.test(temas.menciones) && /atender_mencion/.test(temas.menciones) && /responde_a/.test(temas.menciones) && /datos, no órdenes/.test(temas.menciones), 'menciones: leer_pendientes, atender_mencion, responde_a y que lo leído son datos')
const todo = await leerTexto('leer_guia', { tema: 'todo' })
const documento = readFileSync(new URL('../docs/guia-para-ias.md', import.meta.url), 'utf8')
ok(VIEJO || todo === documento, 'leer_guia { tema: "todo" } es igual a docs/guia-para-ias.md (si no: npm run guia)')
ok(TEMAS.every((t) => todo.includes(temas[t])), 'la guía entera tiene cada tema tal cual')
const eg1 = await llamar('leer_guia', { tema: 'canvas' }, { esperoError: true })
ok(/kanban/.test(eg1) && /canvas/.test(eg1), 'un tema que no existe: dice cuáles hay', eg1)
const eg2 = await llamar('leer_guia', { tema: 'kanban', detalle: true }, { esperoError: true })
ok(/desconocido/.test(eg2) && /detalle/.test(eg2), 'un parámetro inventado en leer_guia: lo nombra', eg2)

// ───── 2. Proyecto y tablero de prueba ─────
console.log('\nProyecto y tablero')
const prefijo = `PM${Date.now().toString(36).slice(-5).toUpperCase()}`
const proyecto = await llamar('crear_proyecto', { nombre: `Prueba MCP ${prefijo}`, prefijo, color: 'violeta', emoji: '🧪', descripcion: 'Lo arma scripts/probar-mcp.mjs.' })
ok(proyecto.ok && proyecto.proyecto.prefijo === prefijo, `crear_proyecto: ${prefijo}`)
const conFoto = await llamar('actualizar_proyecto', { proyecto: prefijo, foto_url: fotoDePrueba(), descripcion: 'Proyecto de prueba del MCP (se archiva solo).' })
ok(/^http/.test(conFoto.proyecto.foto ?? ''), 'actualizar_proyecto pone la foto (y devuelve su link)', conFoto.proyecto)
const foto = await fetch(conFoto.proyecto.foto)
ok(foto.ok && foto.headers.get('content-type')?.startsWith('image/png'), 'la foto se puede ver', foto.status)
// Este tablero usa todo (Kanban, lienzo y Diseño): `tipo: 'completo'`. De fábrica un tablero es solo Kanban (más abajo, «Vistas»).
const tablero = await llamar('crear_tablero', { proyecto: prefijo, nombre: 'Lienzo de prueba', listas: ['Ideas', 'Por hacer', 'Hecho'], ...(VIEJO ? {} : { tipo: 'completo' }) })
ok(tablero.ok && tablero.tablero.id, 'crear_tablero con sus listas')
const T = { proyecto: prefijo, tablero: 'Lienzo de prueba' }
const ajustes = await llamar('actualizar_tablero', { ...T, fondo: 'lineas', grilla: 32 })
ok(ajustes.tablero.lienzo.fondo === 'lineas' && ajustes.tablero.lienzo.grilla === 32, 'actualizar_tablero cambia el fondo y la grilla del lienzo')

// ───── 3. Armar un diagrama con todo ─────
console.log('\nArmar')
const armado = await llamar('armar_en_lienzo', {
  ...T,
  nuevo_marco: { titulo: 'Flujo del cliente', color: 'naranja' },
  objetos: [
    { ref: 'entra', tipo: 'forma', forma: 'pildora', texto: 'Cliente **entra**', relleno: 'celeste' },
    { ref: 'mesa', tipo: 'forma', forma: 'rombo', texto: '¿Hay mesa?', relleno: 'amarillo' },
    { ref: 'sienta', tipo: 'forma', texto: 'Se sienta', relleno: 'verde', tono: 'fuerte' },
    { ref: 'datos', tipo: 'forma', forma: 'cilindro', texto: 'Reservas', borde: 'violeta', estilo_borde: 'rayado', relleno: 'ninguno' },
  ],
  conectores: [
    { desde: 'entra', hasta: 'mesa', etiqueta: 'llega' },
    { desde: 'mesa', hasta: 'sienta', etiqueta: 'sí', trazo: 'ortogonal' },
    { desde: 'mesa', hasta: 'datos', etiqueta: 'no', linea: 'punteado', color: 'rojo', punta_fin: 'flecha_abierta' },
  ],
})
ok(armado.ok && Object.keys(armado.objetos).length === 4 && armado.conectores.length === 3, 'armar_en_lienzo: 4 formas y 3 conectores en un marco nuevo', armado)
ok(armado.marco?.titulo === 'Flujo del cliente', 'el marco nuevo rodea al grupo')

const nota = await llamar('agregar_al_lienzo', {
  ...T,
  tipo: 'nota',
  marco: 'Flujo del cliente',
  color: 'rosa',
  texto: 'Para revisar:\n\n- **Tiempo** de espera\n- *Propina* según rapidez\n- [ ] Probar con 30 clientes',
})
ok(nota.ok && nota.objeto.marco === 'Flujo del cliente', 'agregar_al_lienzo: una nota en Markdown adentro del marco', nota)
const titulo = await llamar('agregar_al_lienzo', { ...T, tipo: 'texto', texto: '# Mecánicas\n\nLo que hace que el local **funcione**.', fuente: 'titulos' })
ok(titulo.ok && titulo.objeto.tipo === 'texto', 'agregar_al_lienzo: un texto con título y negrita')
const estrella = await llamar('agregar_al_lienzo', { ...T, tipo: 'forma', forma: 'estrella', texto: 'Clave', relleno: 'amarillo', tono: 'fuerte' })
const conector = await llamar('agregar_al_lienzo', { ...T, tipo: 'conector', desde: titulo.objeto.id, hasta: estrella.objeto.id, etiqueta: 'importa', trazo: 'recto', grosor: 3 })
ok(conector.ok && conector.conector.id, 'agregar_al_lienzo: un conector con etiqueta y estilo')
const ideas = await llamar('agregar_al_lienzo', { ...T, tipo: 'marco', titulo: 'Ideas', color: 'violeta', relleno_marco: 'tenue' })
ok(ideas.ok && ideas.objeto.tipo === 'marco', 'agregar_al_lienzo: un marco')

// ───── 4. Cambiar ─────
console.log('\nCambiar')
const verde = await llamar('actualizar_lienzo', { ...T, objeto: '¿Hay mesa?', relleno: 'verde', tono: 'fuerte' })
ok(verde.ok && verde.objetos[0].id === armado.objetos.mesa, 'actualizar_lienzo encuentra una forma por su texto y le cambia el relleno')
const movida = await llamar('actualizar_lienzo', { ...T, objeto: nota.objeto.id, marco: 'Ideas' })
ok(movida.objetos[0].marco === 'Ideas', 'actualizar_lienzo mueve la nota a otro marco', movida)
const lineaNueva = await llamar('actualizar_lienzo', { ...T, conector: conector.conector.id, linea: 'rayado', punta_inicio: 'punto', etiqueta: 'lo más importante' })
ok(lineaNueva.conector.linea === 'rayado' && lineaNueva.conector.etiqueta === 'lo más importante', 'actualizar_lienzo cambia el estilo y la etiqueta de un conector')
const texto = await llamar('actualizar_lienzo', { ...T, objeto: armado.objetos.sienta, texto: 'Se ~~para~~ **sienta**' })
ok(texto.ok, 'actualizar_lienzo cambia el texto (Markdown)')
const marcoAntes = (await llamar('leer_lienzo', { ...T, marco: 'Flujo del cliente' })).marcos[0]
await llamar('actualizar_lienzo', { ...T, objeto: 'Flujo del cliente', x: marcoAntes.x + 200, y: marcoAntes.y + 100 })
const marcoDespues = (await llamar('leer_lienzo', { ...T, marco: 'Flujo del cliente' })).marcos[0]
const corrida = marcoDespues.objetos.every((o) => {
  const a = marcoAntes.objetos.find((x) => x.id === o.id)
  return a && o.x === a.x + 200 && o.y === a.y + 100
})
ok(marcoDespues.x === marcoAntes.x + 200 && corrida && marcoDespues.objetos.length === 4, 'mover un marco mueve lo que tiene adentro')
const lista = await llamar('actualizar_lista', { ...T, lista: 'Ideas', limite: 5, color: 'violeta' })
ok(lista.lista.limite === 5 && lista.lista.color === 'violeta', 'actualizar_lista pone límite y color')
const tarjeta = await llamar('convertir_objeto', { ...T, objeto: estrella.objeto.id, a: 'tarjeta', lista: 'Ideas' })
ok(tarjeta.ok && new RegExp(`^${prefijo}-\\d+$`).test(tarjeta.tarjeta?.clave ?? ''), `convertir_objeto: la estrella pasa a ser la tarjeta ${tarjeta.tarjeta?.clave}`, tarjeta)

// ───── 5. Leer de vuelta ─────
console.log('\nLeer de vuelta')
const lienzo = await llamar('leer_lienzo', T)
const flujo = lienzo.marcos.find((m) => m.titulo === 'Flujo del cliente')
const marcoIdeas = lienzo.marcos.find((m) => m.titulo === 'Ideas')
ok(flujo && flujo.objetos.length === 4, 'el marco "Flujo del cliente" tiene sus 4 formas', flujo)
const mesa = flujo?.objetos.find((o) => o.id === armado.objetos.mesa)
ok(mesa?.forma === 'rombo' && mesa?.relleno === 'verde' && mesa?.tono === 'fuerte', 'el rombo se lee con el estilo que se le cambió', mesa)
ok(flujo?.objetos.find((o) => o.id === armado.objetos.entra)?.texto === 'Cliente **entra**', 'el texto vuelve en Markdown (con la negrita)')
ok(flujo?.objetos.find((o) => o.id === armado.objetos.sienta)?.texto === 'Se ~~para~~ **sienta**', 'el texto cambiado vuelve igual')
const datos = flujo?.objetos.find((o) => o.id === armado.objetos.datos)
ok(datos?.borde === 'violeta' && datos?.estilo_borde === 'rayado' && datos?.relleno === 'ninguno', 'el cilindro conserva su borde rayado', datos)
const notaLeida = marcoIdeas?.objetos.find((o) => o.id === nota.objeto.id)
ok(notaLeida?.color === 'rosa' && /- \*\*Tiempo\*\* de espera/.test(notaLeida?.texto ?? '') && /- \[ \] Probar/.test(notaLeida?.texto ?? ''), 'la nota está en "Ideas", rosa, con su lista y su tarea', notaLeida)
const textoLeido = lienzo.sueltos.find((o) => o.id === titulo.objeto.id)
ok(textoLeido?.texto?.startsWith('# Mecánicas') && textoLeido?.fuente === 'titulos', 'el texto suelto conserva el título y la fuente', textoLeido)
const etiquetas = lienzo.conectores.map((c) => c.etiqueta).filter(Boolean).sort()
ok(JSON.stringify(etiquetas) === JSON.stringify(['llega', 'lo más importante', 'no', 'sí']), 'los 4 conectores vuelven con su etiqueta', etiquetas)
const no = lienzo.conectores.find((c) => c.etiqueta === 'no')
ok(no?.linea === 'punteado' && no?.color === 'rojo' && no?.punta_fin === 'flecha_abierta' && no?.desde_texto === '¿Hay mesa?', 'el conector "no" conserva línea, color y punta, y dice de dónde sale', no)
const deTarjeta = lienzo.conectores.find((c) => c.etiqueta === 'lo más importante')
ok(deTarjeta?.hasta_texto === tarjeta.tarjeta?.clave, 'el conector pasó a la tarjeta convertida', deTarjeta)
const soloUno = await llamar('leer_lienzo', { ...T, marco: 'Ideas' })
ok(soloUno.marcos.length === 1 && soloUno.marcos[0].titulo === 'Ideas', 'leer_lienzo con "marco" lee uno solo')
const kanban = await llamar('leer_tablero', T)
ok(kanban.listas.find((l) => l.nombre === 'Ideas')?.tarjetas?.some((t) => t.clave === tarjeta.tarjeta?.clave), 'la tarjeta convertida está en el Kanban, en "Ideas"')
ok(kanban.lienzo?.para_ver_todo === 'leer_lienzo' && kanban.lienzo.marcos.includes('Flujo del cliente'), 'leer_tablero resume el lienzo (no lo repite)')

// ───── 5b. La foto (ver_lienzo) ─────
console.log('\nLa foto del lienzo')
if (!VIEJO) {
// (el código de antes de la 0.3 no tiene ver_lienzo)
/** Llama a ver_lienzo y devuelve la imagen (bytes) y el texto. */
async function verLienzo(argumentos) {
  const r = await cliente.callTool({ name: 'ver_lienzo', arguments: argumentos })
  const texto = r.content?.filter((c) => c.type === 'text').map((c) => c.text).join('') ?? ''
  if (r.isError) throw new Error(`ver_lienzo: ${texto}`)
  const img = r.content?.find((c) => c.type === 'image')
  return { texto, mime: img?.mimeType, png: img ? Buffer.from(img.data, 'base64') : null }
}
const ancho = (png) => png.readUInt32BE(16)
const herrVer = tools.find((t) => t.name === 'ver_lienzo')
ok(herrVer?.annotations?.readOnlyHint === true, 'ver_lienzo se anuncia de solo lectura')
const fotoMarco = await verLienzo({ ...T, marco: 'Flujo del cliente', tema: 'oscuro' })
ok(fotoMarco.mime === 'image/png' && fotoMarco.png?.subarray(1, 4).toString() === 'PNG', 'ver_lienzo de un marco devuelve un PNG')
ok(/marco «Flujo del cliente»/.test(fotoMarco.texto) && /tema oscuro/.test(fotoMarco.texto) && /Revisión/.test(fotoMarco.texto), 'y dice qué fotografió, con qué tema y la revisión', fotoMarco.texto)
const fotoZoom = await verLienzo({ ...T, marco: 'Flujo del cliente', zoom: 0.5 })
ok(Math.abs(ancho(fotoZoom.png) - ancho(fotoMarco.png) / 2) < 40 || /zoom 50 %/.test(fotoZoom.texto), 'con zoom 0.5 la imagen sale a la mitad', fotoZoom.texto)
const fotoTodo = await verLienzo(T)
ok(fotoTodo.png && /todo el lienzo/.test(fotoTodo.texto), 'sin marco ni área, fotografía todo el lienzo', fotoTodo.texto)
// Lo que la revisión tiene que ver: dos textos encimados, dos notas a 6 px y una nota con letra de 9 px.
const revision = await llamar('armar_en_lienzo', {
  ...T,
  nuevo_marco: { titulo: 'Para revisar', color: 'gris', relleno_marco: 'liso' },
  objetos: [
    { ref: 'a', tipo: 'texto', texto: 'Texto de arriba que se pisa', x: 0, y: 0, ancho: 360, tamano: 24 },
    { ref: 'b', tipo: 'texto', texto: 'Texto de abajo que se pisa', x: 10, y: 8, ancho: 360, tamano: 24 },
    { ref: 'c', tipo: 'nota', texto: 'Una nota', x: 0, y: 120, ancho: 200, alto: 120 },
    { ref: 'd', tipo: 'nota', texto: 'Otra nota pegada', x: 206, y: 120, ancho: 200, alto: 120 },
    { ref: 'e', tipo: 'nota', texto: 'Letra chiquita', x: 0, y: 300, ancho: 200, alto: 120, tamano: 9 },
  ],
})
const fotoRevision = await verLienzo({ ...T, marco: revision.marco.id })
ok(/se pisan/.test(fotoRevision.texto) && fotoRevision.texto.includes(revision.objetos.a), 'la revisión ve los textos que se pisan, con su id', fotoRevision.texto)
ok(/muy pegados \(6 px\)/.test(fotoRevision.texto), 'la revisión ve dos notas a 6 px', fotoRevision.texto)
ok(/letra chica/.test(fotoRevision.texto) && fotoRevision.texto.includes(revision.objetos.e), 'la revisión ve la letra de 9 px', fotoRevision.texto)
const fotoArea = await verLienzo({ ...T, area: { x: 0, y: 0, ancho: 300, alto: 200 } })
ok(fotoArea.png && /área 0, 0 de 300 × 200/.test(fotoArea.texto), 'ver_lienzo con un área', fotoArea.texto)
const ev1 = await llamar('ver_lienzo', { ...T, marco: 'Ideas', area: { x: 0, y: 0, ancho: 100, alto: 100 } }, { esperoError: true })
ok(/"marco" o "area"/.test(ev1), 'marco y área juntos: dice que es uno u otro', ev1)
const ev2 = await llamar('ver_lienzo', { ...T, marco: 'Una nota' }, { esperoError: true })
ok(/no es un marco/.test(ev2) && /area/.test(ev2), 'algo que no es un marco: lo dice y ofrece el área', ev2)
const ev3 = await llamar('ver_lienzo', { ...T, area: { x: 0, y: 0, ancho: 3000, alto: 100 }, zoom: 2 }, { esperoError: true })
ok(/máximo/.test(ev3) && /zoom \d/.test(ev3), 'un zoom demasiado grande: dice cuál sirve', ev3)
const ev4 = await llamar('ver_lienzo', { ...T, tema: 'negro' }, { esperoError: true })
ok(/claro/.test(ev4) && /oscuro/.test(ev4), 'un tema que no existe: dice cuáles hay', ev4)

}

// ───── 6. Errores que dicen cómo corregir ─────
console.log('\nErrores claros')
const e1 = await llamar('agregar_al_lienzo', { ...T, tipo: 'forma', forma: 'cuadrado' }, { esperoError: true })
ok(/rectangulo/.test(e1) && /cuadrado/.test(e1), 'una forma que no existe: dice cuáles hay', e1)
const e2 = await llamar('agregar_al_lienzo', { ...T, tipo: 'nota', texto: 'x', fill: 'rojo' }, { esperoError: true })
ok(/desconocido/.test(e2) && /fill/.test(e2), 'un parámetro inventado: lo nombra', e2)
const e3 = await llamar('agregar_al_lienzo', { ...T, tipo: 'nota', texto: 'x', tono: 'fuerte' }, { esperoError: true })
ok(/no se aplica a una nota/.test(e3) && /forma/.test(e3), 'un estilo de otro tipo: dice para qué sirve', e3)
const e4 = await llamar('actualizar_lienzo', { ...T, objeto: 'Algo que no existe' }, { esperoError: true })
ok(/No encontré/.test(e4) && /id/.test(e4), 'un objeto que no está: dice cómo nombrarlo', e4)
const antes = (await llamar('leer_lienzo', T)).resumen
const e5 = await llamar('armar_en_lienzo', { ...T, objetos: [{ ref: 'a', tipo: 'nota', texto: 'uno' }], conectores: [{ desde: 'a', hasta: 'zz' }] }, { esperoError: true })
ok(/zz/.test(e5) && /ref/.test(e5), 'un conector a una ref que no existe: la nombra', e5)
ok((await llamar('leer_lienzo', T)).resumen === antes, 'y no deja nada armado a medias')

const lista2 = await llamar('listar_proyectos', {})
const leido = lista2.proyectos.find((p) => p.prefijo === prefijo)
ok(leido && /^http/.test(leido.foto ?? '') && !leido.emoji && leido.tableros.length === 2, 'listar_proyectos muestra el proyecto con su foto (que reemplazó al emoji) y sus dos tableros', leido)

// ───── 6b. Tablas y gráficos ─────
console.log('\nTablas y gráficos')
const tabla = await llamar('crear_tabla', {
  ...T,
  titulo: 'Precios del menú',
  columnas: [
    { nombre: 'Plato', tipo: 'texto' },
    { nombre: 'Precio', tipo: 'moneda', resumen: 'suma' },
    { nombre: 'Margen', tipo: 'porcentaje' },
    { nombre: 'Estado', tipo: 'etiqueta', opciones: [{ nombre: 'Listo', color: 'verde' }] },
    { nombre: 'Rama', tipo: 'rama' },
    { nombre: 'Desde', tipo: 'fecha' },
  ],
  filas: [['Milanesa', 4200, 35, 'Listo', 'claude/milanesa', '2026-11-24'], { Plato: 'Ñoquis', Precio: 3100, Margen: 48, Estado: 'En prueba' }],
  ordenar_por: 'Precio',
  direccion: 'desc',
})
ok(tabla.ok && tabla.tabla?.filas === 2 && tabla.tabla.columnas.length === 6, 'crear_tabla arma la tabla con sus columnas y filas', tabla)
const leida = await llamar('leer_tabla', { ...T, tabla: 'Precios del menú', como: 'objetos' })
ok(leida.total === 2 && leida.filas[0].Plato === 'Milanesa' && leida.filas[0].Precio === 4200 && leida.filas[0].Desde === '2026-11-24', 'leer_tabla devuelve los valores como se guardan', leida)
ok(leida.resumen?.Precio?.suma === 7300 && /Precio/.test(leida.ordenada_por ?? ''), 'y el resumen y la vista ordenada', leida.resumen)
const cambio = await llamar('actualizar_tabla', {
  ...T,
  tabla: tabla.tabla.id,
  operaciones: [
    { op: 'agregar_filas', filas: [{ Plato: 'Flan', Precio: 1800 }] },
    { op: 'cambiar_celdas', celdas: [{ fila: leida.ids[0], columna: 'Precio', valor: 4500 }] },
    { op: 'agregar_columna', columna: { nombre: 'Carpeta', tipo: 'directorio' }, valores: ['servidor/src/mcp'] },
  ],
})
ok(cambio.ok && cambio.tabla.filas === 3 && cambio.filas_nuevas?.length === 1, 'actualizar_tabla aplica varias operaciones juntas', cambio)
const malo = await llamar('actualizar_tabla', { ...T, tabla: tabla.tabla.id, operaciones: [{ op: 'cambiar_celdas', celdas: [{ fila: 1, columna: 'Precio', valor: 'caro' }] }] }, { esperoError: true })
ok(/fila 1, columna «Precio»/.test(malo) && /número/.test(malo), 'un valor malo dice fila, columna y qué se esperaba', malo)
const sinColumna = await llamar('actualizar_tabla', { ...T, tabla: tabla.tabla.id, operaciones: [{ op: 'cambiar_celdas', celdas: [{ fila: 1, columna: 'Precios', valor: 1 }] }] }, { esperoError: true })
ok(/No hay una columna «Precios»/.test(sinColumna) && /Plato/.test(sinColumna), 'una columna que no existe: dice cuáles hay', sinColumna)
ok((await llamar('leer_tabla', { ...T, tabla: tabla.tabla.id })).total === 3, 'y lo que falló no dejó nada a medias (todo o nada)')
const g1 = await llamar('crear_grafico', { ...T, tipo: 'barras', titulo: 'Precio por plato', tabla: 'Precios del menú', categoria: 'Plato', series: ['Precio'] })
ok(g1.ok && g1.grafico?.tipo === 'barras' && !g1.aviso, 'crear_grafico desde la tabla', g1)
const g2 = await llamar('crear_grafico', { ...T, tipo: 'torta', titulo: 'Por área', datos: { categorias: ['Cocina', 'Salón'], series: [{ nombre: 'Tarjetas', valores: [12, 7] }] } })
ok(g2.ok && g2.grafico?.tipo === 'torta', 'crear_grafico con datos propios', g2)
const g3 = await llamar('crear_grafico', { ...T, tipo: 'barras', tabla: 'Precios del menú', datos: { categorias: ['a'], series: [{ nombre: 's', valores: [1] }] } }, { esperoError: true })
ok(/no van juntos/.test(g3), 'tabla y datos juntos: se rechaza', g3)
const g4 = await llamar('crear_grafico', { ...T, tipo: 'barras', tabla: 'Precios del menú', categoria: 'Plato', series: ['Estado'] }, { esperoError: true })
ok(/necesita columnas numero/.test(g4), 'una serie de texto: dice qué columnas sirven', g4)
const conGrafico = await llamar('leer_lienzo', T)
const grafs = conGrafico.sueltos.concat(conGrafico.marcos.flatMap((m) => m.objetos ?? [])).filter((o) => o.tipo === 'grafico')
const barras = grafs.find((g) => g.grafico === 'barras')
ok(barras?.categorias?.length === 3 && barras.valores?.[0]?.includes(4500), 'leer_lienzo devuelve el gráfico con sus datos ya resueltos (con el 4500 nuevo)', barras)
await llamar('actualizar_tabla', { ...T, tabla: tabla.tabla.id, operaciones: [{ op: 'cambiar_celdas', celdas: [{ fila: leida.ids[0], columna: 'Precio', valor: 9999 }] }] })
const despues = (await llamar('leer_lienzo', T)).sueltos.concat((await llamar('leer_lienzo', T)).marcos.flatMap((m) => m.objetos ?? [])).find((o) => o.tipo === 'grafico' && o.grafico === 'barras')
ok(despues?.valores?.[0]?.includes(9999), 'y si cambia la tabla, cambia el gráfico', despues)
const cambioG = await llamar('actualizar_grafico', { ...T, grafico: g1.grafico.id, tipo: 'barras_h', series: ['Precio', 'Margen'] })
ok(cambioG.ok && cambioG.grafico.tipo === 'barras_h', 'actualizar_grafico cambia el tipo y las series', cambioG)
const tam = await llamar('actualizar_lienzo', { ...T, objeto: tabla.tabla.id, ancho: 900 }, { esperoError: true })
ok(/sale de sus columnas/.test(tam), 'el tamaño de una tabla no se estira a mano', tam)

// ───── 6c. Lado de las flechas, carriles, blanco, íconos, posiciones exactas y quitar ─────
console.log('\nMejoras del lienzo')
const lados = await llamar('armar_en_lienzo', {
  ...T,
  nuevo_marco: { titulo: 'Carril de prueba', titulo_en: 'izquierda', color: 'azul' },
  tamano_letra: 28,
  objetos: [
    { ref: 'p', tipo: 'forma', texto: 'Paso', relleno: 'blanco', icono: 'cocinero', x: 0, y: 0 },
    { ref: 'q', tipo: 'forma', texto: 'Otro', relleno: 'blanco', icono: 'reloj', icono_posicion: 'izquierda', x: 400, y: 200 },
  ],
  conectores: [{ desde: 'p', hasta: 'q', lado_desde: 'abajo', lado_hasta: 'izquierda', trazo: 'ortogonal' }],
})
ok(lados.ok && lados.marco?.titulo === 'Carril de prueba', 'armar con un carril nuevo (título adentro, a la izquierda)', lados)
const carril = await llamar('leer_lienzo', { ...T, marco: 'Carril de prueba' })
const m0 = carril.marcos[0]
ok(m0.titulo_en === 'izquierda', 'leer_lienzo devuelve titulo_en', m0)
ok(m0.objetos.some((o) => o.relleno === 'blanco' && o.icono === 'cocinero') && m0.objetos.some((o) => o.icono === 'reloj' && o.icono_posicion === 'izquierda'), 'y el relleno blanco y los íconos', m0.objetos)
ok(m0.objetos.every((o) => o.tamano === 28), 'tamano_letra se aplica a lo que no trae su letra', m0.objetos.map((o) => o.tamano))
ok(carril.conectores[0]?.lado_desde === 'abajo' && carril.conectores[0]?.lado_hasta === 'izquierda', 'el conector conserva de qué lado sale y entra', carril.conectores[0])
const cLados = await llamar('actualizar_lienzo', { ...T, conector: carril.conectores[0].id, lado_desde: 'auto', lado_hasta: 'arriba' })
ok(cLados.ok, 'actualizar_lienzo cambia los lados (auto vuelve a que elija Telar)')
const icoMalo = await llamar('agregar_al_lienzo', { ...T, tipo: 'forma', icono: 'unicornio' }, { esperoError: true })
ok(/cocinero/.test(icoMalo) || /uno de/.test(icoMalo), 'un ícono inventado: el error lista los que hay', icoMalo.slice(0, 120))
const idMarco = m0.id
const exactas = await llamar('armar_en_lienzo', {
  ...T,
  marco: idMarco,
  posiciones: 'marco',
  objetos: [
    { ref: 'e1', tipo: 'nota', texto: 'exacta 1', x: 500, y: 700, ancho: 200, alto: 100 },
    { ref: 'e2', tipo: 'nota', texto: 'exacta 2', x: 900, y: 1200, ancho: 200, alto: 100 },
  ],
})
ok(exactas.ok && exactas.avisos?.some((a) => /creció/.test(a)), 'posiciones "marco": se respeta lo pedido y el marco crece avisando', exactas)
const despuesExactas = await llamar('leer_lienzo', { ...T, marco: 'Carril de prueba' })
const notaExacta = despuesExactas.marcos[0].objetos.find((o) => o.texto === 'exacta 1')
ok(notaExacta && notaExacta.x === despuesExactas.marcos[0].x + 500 && notaExacta.y === despuesExactas.marcos[0].y + 700, 'la nota quedó EXACTAMENTE a 500, 700 de la esquina del marco', notaExacta)
const sinXY = await llamar('armar_en_lienzo', { ...T, marco: idMarco, posiciones: 'marco', objetos: [{ tipo: 'nota', texto: 'sin x' }] }, { esperoError: true })
ok(/pide x e y/.test(sinXY), 'posiciones exactas sin x/y: se rechaza', sinXY)

// 300 objetos y 600 conectores de una llamada (todo o nada)
const grande = { ...T, nuevo_marco: { titulo: 'Grande' }, objetos: [], conectores: [] }
for (let i = 0; i < 300; i++) grande.objetos.push({ ref: `n${i}`, tipo: 'nota', texto: `n${i}`, ancho: 120, alto: 80, x: (i % 30) * 150, y: Math.floor(i / 30) * 120 })
for (let i = 0; i < 299; i++) grande.conectores.push({ desde: `n${i}`, hasta: `n${i + 1}` })
for (let i = 0; i < 290; i++) grande.conectores.push({ desde: `n${i}`, hasta: `n${i + 10}`, lado_desde: 'abajo' })
const t0 = Date.now()
const g300 = await llamar('armar_en_lienzo', grande)
ok(g300.ok && Object.keys(g300.objetos).length === 300 && g300.conectores.length === 589, `armar_en_lienzo con 300 objetos y 589 conectores (${Date.now() - t0} ms)`, g300.mensaje)
const demasiados = await llamar('armar_en_lienzo', { ...T, objetos: Array.from({ length: 301 }, (_, i) => ({ tipo: 'nota', texto: `${i}` })) }, { esperoError: true })
ok(/300/.test(demasiados), 'más de 300 objetos: se rechaza', demasiados.slice(0, 160))
const malConector = await llamar('armar_en_lienzo', { ...T, objetos: [{ ref: 'a', tipo: 'nota', texto: 'uno' }], conectores: [{ desde: 'a', hasta: 'zz' }] }, { esperoError: true })
ok(/zz/.test(malConector), 'y si un conector apunta a algo que no existe, no arma nada')

// quitar y restaurar
const para = await llamar('agregar_al_lienzo', { ...T, tipo: 'nota', texto: 'Para quitar' })
const quitada = await llamar('quitar_del_lienzo', { ...T, objetos: [para.objeto.id] })
ok(quitada.ok && quitada.quitados.objetos.includes(para.objeto.id), 'quitar_del_lienzo saca un objeto (no lo borra)', quitada)
// (Con más de 200 objetos leer_lienzo viene resumido: se comprueba por «quitados» y por lo que devuelve restaurar.)
const lista30 = await llamar('leer_lienzo', { ...T, quitados: true })
ok(lista30.objetos.some((o) => o.id === para.objeto.id), 'leer_lienzo con "quitados" lo lista para recuperarlo', lista30.resumen)
const vuelta = await llamar('quitar_del_lienzo', { ...T, restaurar: true, objetos: [para.objeto.id] })
ok(vuelta.ok && vuelta.objetos?.[0]?.id === para.objeto.id, 'restaurar lo devuelve al lienzo', vuelta)
ok(!(await llamar('leer_lienzo', { ...T, quitados: true })).objetos.some((o) => o.id === para.objeto.id), 'y ya no figura como quitado')
await llamar('actualizar_lienzo', { ...T, objeto: para.objeto.id, bloqueado: true })
const bloq = await llamar('quitar_del_lienzo', { ...T, objetos: [para.objeto.id] }, { esperoError: true })
ok(/bloquead/.test(bloq), 'lo bloqueado no sale', bloq)
const conTodo = await llamar('quitar_del_lienzo', { ...T, objetos: ['Grande'], con_contenido: true })
ok(conTodo.quitados.objetos.length >= 300 && conTodo.quitados.conectores.length >= 589, 'un marco con_contenido saca todo lo de adentro con sus conectores', conTodo.mensaje)

// ───── 6b. Skills sobre MCP: la guía por temas viaja con el servidor y se verifica contra su entrada ─────
console.log('\nSkills sobre MCP')
const skillsCliente = new SkillsClient(cliente)
ok(skillsCliente.supported, 'el servidor declara la extensión de skills')
const { skills: skillsLista } = await skillsCliente.list()
const nombresSkills = skillsLista.map((s) => s.frontmatter.name).sort()
ok(
  JSON.stringify(nombresSkills) === JSON.stringify(['telar', 'telar-diagramas', 'telar-diseno', 'telar-fuentes', 'telar-kanban', 'telar-lienzo', ...(VIEJO ? [] : ['telar-menciones']), 'telar-respuestas', 'telar-tablas']),
  'se listan la skill general y una por tema',
  nombresSkills,
)
ok(skillsLista.every((s) => String(s.frontmatter.description ?? '').length > 40), 'cada skill dice cuándo usarla (descripción)')
const skillLienzo = skillsLista.find((s) => s.frontmatter.name === 'telar-lienzo')
const archivoLienzo = await skillsCliente.read(skillLienzo)
const temaLienzo = await leerTexto('leer_guia', { tema: 'lienzo' })
ok(archivoLienzo.body?.trim() === temaLienzo.trim(), 'el texto de la skill es el mismo que da leer_guia (una sola fuente)')
const skillGeneral = await skillsCliente.get(skillsLista.find((s) => s.frontmatter.name === 'telar').uri)
ok(skillGeneral.skill.uri.endsWith('/SKILL.md'), 'skills/get devuelve la skill por su dirección')

// ───── 6c. Menciones: una IA de afuera (como «Claude») lee lo que le espera, lo atiende y la persona recibe el aviso ─────
if (!VIEJO) {
console.log('\nMenciones')
const claveTarjeta = tarjeta.tarjeta.clave
const web = (metodo, ruta, cuerpo) =>
  fetch(`${WEB}${ruta}`, { method: metodo, headers: { 'content-type': 'application/json', authorization: `Bearer ${info.clave}` }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
const herrPend = tools.find((t) => t.name === 'leer_pendientes')
ok(herrPend?.annotations?.readOnlyHint === true && /Ejemplo/.test(herrPend.description), 'leer_pendientes solo lee y trae su ejemplo')
const herrAt = tools.find((t) => t.name === 'atender_mencion')
ok(herrAt?.annotations?.readOnlyHint === false && herrAt?.annotations?.idempotentHint === true, 'atender_mencion escribe y es idempotente')
const claude = await conectarComo('Claude')
const llamarComo = async (cli, nombre, argumentos, { esperoError = false } = {}) => {
  const r = await cli.callTool({ name: nombre, arguments: argumentos })
  const texto = r.content?.map((c) => c.text ?? '').join('') ?? ''
  if (esperoError) return { error: r.isError === true, texto }
  if (r.isError) throw new Error(`${nombre}: ${texto}`)
  return JSON.parse(texto)
}
const cargaPrevia = await llamarComo(claude, 'leer_pendientes', { proyecto: prefijo })
ok(Array.isArray(cargaPrevia.menciones) && Array.isArray(cargaPrevia.asignadas) && typeof cargaPrevia.como_seguir === 'string', 'leer_pendientes: devuelve menciones, asignadas y cómo seguir', cargaPrevia)
const antesSinLeer = (await web('GET', '/api/novedades')).json.sinLeer
const escrito = await web('POST', `/api/tarjetas/${claveTarjeta}/comentarios`, { cuerpo: '@claude ya le respondí a Ana, ¿lo revisás?', id: `m${Date.now().toString(36)}abcd` })
ok(escrito.status === 201 && escrito.json.menciones?.[0]?.estado === 'pendiente', 'la persona comenta «@claude…» y queda una mención pendiente (por API)', escrito.json)
const pend1 = await llamarComo(claude, 'leer_pendientes', { proyecto: prefijo })
const mia = pend1.menciones.find((m) => m.tarjeta === claveTarjeta)
ok(Boolean(mia) && mia.texto.includes('@claude') && Boolean(mia.id) && /^http/.test(mia.enlace) && mia.donde === 'comentario', 'leer_pendientes (como Claude) trae la mención con su id, el texto, dónde y el enlace', pend1)
ok(!(await llamarComo(cliente, 'leer_pendientes', {})).menciones.some((m) => m.id === mia?.id), 'otra IA (Prueba MCP) no ve las menciones de Claude')
const respuesta = await llamarComo(claude, 'comentar', { tarjeta: claveTarjeta, texto: '**Revisado:** ya lo miré, está bien.' })
ok(respuesta.ok, 'Claude comenta en la tarjeta')
const pend2 = await llamarComo(claude, 'leer_pendientes', { proyecto: prefijo })
ok(!pend2.menciones.some((m) => m.id === mia?.id), 'al comentar la mención queda atendida y deja de aparecer en leer_pendientes', pend2)
const novedades = (await web('GET', '/api/novedades')).json
const aviso = novedades.notificaciones.find((n) => n.tipo === 'respuesta' && n.mencionId === mia?.id)
ok(Boolean(aviso) && /Claude respondió en/.test(aviso.titulo) && novedades.sinLeer === antesSinLeer + 1, 'la persona recibe la notificación «respuesta» (la campana suma 1)', novedades)
const marcada = await web('POST', '/api/notificaciones/leer', { ids: [aviso?.id] })
ok(marcada.status === 200 && (await web('GET', '/api/novedades')).json.sinLeer === antesSinLeer, 'marcarla leída baja el contador')
// atender_mencion: sin comentar, y dos veces no cambia nada
const otra = await web('POST', `/api/tarjetas/${claveTarjeta}/comentarios`, { cuerpo: 'Che @claude, esto ya estaba hecho, ¿no?' })
const idOtra = otra.json.menciones[0].id
const atend1 = await llamarComo(claude, 'atender_mencion', { mencion: idOtra, nota: 'Ya estaba hecho' })
ok(atend1.ok && atend1.mencion.estado === 'atendida', 'atender_mencion la marca atendida', atend1)
const sinLeerDespues = (await web('GET', '/api/novedades')).json.sinLeer
const atend2 = await llamarComo(claude, 'atender_mencion', { mencion: idOtra })
ok(atend2.ok && atend2.mencion.estado === 'atendida' && (await web('GET', '/api/novedades')).json.sinLeer === sinLeerDespues, 'atenderla otra vez no cambia nada ni avisa de nuevo', atend2)
const errMencion = await llamarComo(claude, 'atender_mencion', { mencion: 'm_noexiste' }, { esperoError: true })
ok(errMencion.error && /No existe esa mención/.test(errMencion.texto), 'una mención que no existe: error que lo dice', errMencion.texto)
const errParam = await llamarComo(claude, 'atender_mencion', { mencion: idOtra, nombre: 'x' }, { esperoError: true })
ok(errParam.error && /desconocido/.test(errParam.texto), 'un parámetro inventado en atender_mencion: lo nombra', errParam.texto)
// responde_a: contesta un comentario puntual de la misma tarjeta; uno de otra tarjeta no vale
const tarjetaLeida = await llamarComo(claude, 'leer_tarjeta', { tarjeta: claveTarjeta })
const idComentario = tarjetaLeida.comentarios?.find((c) => c.texto.includes('@claude ya le respondí'))?.id
ok(Boolean(idComentario), 'leer_tarjeta muestra el id de cada comentario')
const hilo = await llamarComo(claude, 'comentar', { tarjeta: claveTarjeta, texto: 'Contesto este comentario.', responde_a: idComentario })
ok(hilo.ok && (await llamarComo(claude, 'leer_tarjeta', { tarjeta: claveTarjeta })).comentarios.some((c) => c.responde_a === idComentario), 'comentar con responde_a queda como respuesta en el hilo')
const eR = await llamarComo(claude, 'comentar', { tarjeta: claveTarjeta, texto: 'x', responde_a: 'noexiste' }, { esperoError: true })
ok(eR.error && /No existe ese comentario/.test(eR.texto), 'responde_a con un comentario que no existe: error claro', eR.texto)
await claude.close()
}

// ───── 6b. Vistas: un tablero tiene solo lo que necesita ─────
if (!VIEJO) {
  console.log('\nVistas')
  const tg = temas
  ok(/tipo\s+`diagrama`|tipo `diagrama`/.test(tg.lienzo) && /no armes un tablero completo/.test(tg.lienzo), 'la guía del lienzo manda a crear un tablero tipo diagrama')
  ok(/tipo `diagrama`/.test(tg.diagramas) && /no armes un tablero completo/i.test(tg.diagramas), 'la guía de diagramas también')
  ok(/Qué tipo de tablero/.test(indice) && /vistas/.test(tg.kanban), 'el índice explica los tipos y el Kanban dice que es una vista')
  ok(/diagrama \(no completo\)/.test(instrucciones), 'las instrucciones del servidor dicen que un diagrama va en un tablero tipo diagrama')
  const hCrear = tools.find((t) => t.name === 'crear_tablero')
  ok(hCrear.inputSchema.properties.tipo && hCrear.inputSchema.properties.vistas, 'crear_tablero tiene `tipo` y `vistas`', Object.keys(hCrear.inputSchema.properties))
  ok(tools.find((t) => t.name === 'actualizar_tablero').inputSchema.properties.vistas, 'actualizar_tablero tiene `vistas`')

  const tk = await llamar('crear_tablero', { proyecto: prefijo, nombre: 'Solo kanban' })
  ok(JSON.stringify(tk.tablero.vistas) === '["kanban"]' && tk.tablero.tipo === 'tablero' && !tk.lienzo, 'sin `tipo`, un tablero es solo Kanban', tk)
  const dg = await llamar('crear_tablero', { proyecto: prefijo, nombre: 'Cómo funciona', tipo: 'diagrama' })
  ok(JSON.stringify(dg.tablero.vistas) === '["lienzo"]' && dg.tablero.tipo === 'diagrama' && /\/lienzo$/.test(dg.tablero.url), 'tipo "diagrama": solo lienzo, y su link entra al lienzo', dg)
  const ds = await llamar('crear_tablero', { proyecto: prefijo, nombre: 'Manual de marca', tipo: 'diseno' })
  ok(JSON.stringify(ds.tablero.vistas) === '["diseno"]' && /\/diseno$/.test(ds.tablero.url), 'tipo "diseno": solo Diseño, y su link entra a Diseño', ds)
  const vs = await llamar('crear_tablero', { proyecto: prefijo, nombre: 'Dos vistas', vistas: ['lienzo', 'kanban'] })
  ok(JSON.stringify(vs.tablero.vistas) === '["kanban","lienzo"]', 'con `vistas` (en cualquier orden)', vs)
  const eTV = await llamar('crear_tablero', { proyecto: prefijo, nombre: 'Mal', tipo: 'diagrama', vistas: ['lienzo'] }, { esperoError: true })
  ok(/tipo` o `vistas`, no los dos/.test(eTV), 'tipo y vistas a la vez: error claro', eTV)
  const eT = await llamar('crear_tablero', { proyecto: prefijo, nombre: 'Mal', tipo: 'mapa' }, { esperoError: true })
  ok(/tablero, diagrama, diseno, completo/.test(eT), 'un tipo que no existe: dice cuáles hay', eT)
  const eV = await llamar('crear_tablero', { proyecto: prefijo, nombre: 'Mal', vistas: [] }, { esperoError: true })
  ok(/al menos 1 elemento/.test(eV), 'vistas vacías: error claro', eV)
  const eL = await llamar('crear_tablero', { proyecto: prefijo, nombre: 'Mal', tipo: 'diagrama', listas: ['Ideas'] }, { esperoError: true })
  ok(/no lleva listas/.test(eL), 'listas en un diagrama: error claro', eL)

  const lt = await llamar('listar_tableros', { proyecto: prefijo })
  const ldg = lt.tableros.find((x) => x.nombre === 'Cómo funciona')
  ok(JSON.stringify(ldg.vistas) === '["lienzo"]' && !ldg.listas && ldg.lienzo, 'listar_tableros: las vistas, y solo lo que el tablero tiene', ldg)
  const lp = await llamar('leer_proyecto', { proyecto: prefijo })
  ok(JSON.stringify(lp.tableros.find((x) => x.nombre === 'Cómo funciona').vistas) === '["lienzo"]', 'leer_proyecto trae las vistas de cada tablero')
  const lpr = await llamar('listar_proyectos', {})
  ok(lpr.proyectos.find((x) => x.prefijo === prefijo).tableros.every((x) => Array.isArray(x.vistas)), 'listar_proyectos trae las vistas de cada tablero')
  const ldt = await llamar('leer_tablero', { proyecto: prefijo, tablero: 'Cómo funciona' })
  ok(JSON.stringify(ldt.tablero.vistas) === '["lienzo"]' && !ldt.listas && ldt.lienzo && /no tiene Kanban/.test(ldt.aviso), 'leer_tablero de un diagrama: sus vistas, sin listas y con el resumen del lienzo', ldt)

  // Lo de una vista que el tablero no tiene: error que dice cuál y cómo sumarla.
  const eTar = await llamar('crear_tarjeta', { proyecto: prefijo, tablero: 'Cómo funciona', titulo: 'No va acá' }, { esperoError: true })
  ok(/no tiene la vista Kanban/.test(eTar) && /actualizar_tablero/.test(eTar) && /"vistas": \["kanban","lienzo"\]/.test(eTar), 'crear_tarjeta en un diagrama: dice qué vista falta y cómo sumarla', eTar)
  const eLis = await llamar('crear_lista', { proyecto: prefijo, tablero: 'Cómo funciona', nombre: 'No va' }, { esperoError: true })
  ok(/no tiene la vista Kanban/.test(eLis), 'crear_lista en un diagrama: el mismo error')
  const eLien = await llamar('armar_en_lienzo', { proyecto: prefijo, tablero: 'Solo kanban', objetos: [{ tipo: 'nota', texto: 'no' }] }, { esperoError: true })
  ok(/no tiene la vista Lienzo \(tiene: Kanban\)/.test(eLien) && /actualizar_tablero/.test(eLien), 'armar_en_lienzo en un tablero solo Kanban: dice qué vista falta y cómo sumarla', eLien)
  const eLL = await llamar('leer_lienzo', { proyecto: prefijo, tablero: 'Solo kanban' }, { esperoError: true })
  ok(/no tiene la vista Lienzo/.test(eLL), 'leer_lienzo en un tablero solo Kanban: el mismo error')
  const eTb = await llamar('crear_tabla', { proyecto: prefijo, tablero: 'Solo kanban', titulo: 'T', columnas: [{ nombre: 'A' }] }, { esperoError: true })
  ok(/no tiene la vista Lienzo/.test(eTb), 'crear_tabla en un tablero solo Kanban: el mismo error')
  // Sin nombre de tablero: el primero que tiene la vista.
  const sinNombre = await llamar('agregar_al_lienzo', { proyecto: prefijo, tipo: 'nota', texto: 'Al primero con lienzo' })
  ok(sinNombre.ok, 'sin nombre de tablero, agregar_al_lienzo usa el primero del proyecto que tiene lienzo', sinNombre)

  // Sumar la vista (con el mismo texto que dio el error) y devolver lo que se saca.
  const suma = await llamar('actualizar_tablero', { proyecto: prefijo, tablero: 'Solo kanban', vistas: ['kanban', 'lienzo'] })
  ok(JSON.stringify(suma.tablero.vistas) === '["kanban","lienzo"]' && /ahora tiene Kanban y Lienzo/.test(suma.mensaje), 'actualizar_tablero suma el lienzo', suma)
  const ahora = await llamar('agregar_al_lienzo', { proyecto: prefijo, tablero: 'Solo kanban', tipo: 'nota', texto: 'Ahora sí' })
  ok(ahora.ok, 'y ahora el lienzo anda')
  const saca = await llamar('actualizar_tablero', { proyecto: prefijo, tablero: 'Solo kanban', vistas: ['kanban'] })
  ok(JSON.stringify(saca.tablero.vistas) === '["kanban"]' && /queda guardado/.test(saca.mensaje), 'sacar una vista: dice que lo que había queda guardado')
  const vuelve = await llamar('actualizar_tablero', { proyecto: prefijo, tablero: 'Solo kanban', vistas: ['kanban', 'lienzo'] })
  const recuperado = await llamar('leer_lienzo', { proyecto: prefijo, tablero: 'Solo kanban' })
  ok(JSON.stringify(vuelve.tablero.vistas) === '["kanban","lienzo"]' && /1 objetos|\b1 objeto/.test(recuperado.resumen), 'al sumarla otra vez, lo que había en el lienzo vuelve', recuperado.resumen)
  const eNada = await llamar('actualizar_tablero', { proyecto: prefijo, tablero: 'Solo kanban', vistas: [] }, { esperoError: true })
  ok(/al menos 1 elemento/.test(eNada), 'no se puede dejar un tablero sin vistas', eNada)
  const eFondo = await llamar('actualizar_tablero', { proyecto: prefijo, tablero: 'Cómo funciona', archivo_hecho_dias: 7 }, { esperoError: true })
  ok(/no tiene la vista Kanban/.test(eFondo), 'el archivo de Hecho de un tablero sin Kanban: error que enseña')
}

// ───── 7. Al terminar ─────
if (!DEJAR) {
  const archivado = await llamar('actualizar_proyecto', { proyecto: prefijo, archivado: true })
  ok(archivado.proyecto.archivado === true, 'el proyecto de prueba queda archivado')
} else console.log(`\nQuedó a la vista: ${lienzo.url}`)

await cliente.close()
console.log(fallas ? `\n${fallas} ${fallas === 1 ? 'cosa falló' : 'cosas fallaron'}.` : '\nTodo bien.')
process.exit(fallas ? 1 : 0)
