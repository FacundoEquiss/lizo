// Carga datos de prueba en un Telar LOCAL, por la API. Nunca apunta a producción: si la URL no es de esta
// computadora (127.0.0.1 o localhost), se niega.
//
//   node scripts/sembrar-lienzo.mjs --demo                         datos de las capturas (sección 15 del plan)
//   node scripts/sembrar-lienzo.mjs --cantidad 1000 --conectores 300   tablero de rendimiento con N objetos
//   node scripts/sembrar-lienzo.mjs --parecido-rc                  tablero «Parecido RC»: como el «Pendientes» de Restaurant City
//
// --parecido-rc arma el lienzo como lo arma una IA, por el MCP (armar_en_lienzo, un marco por llamada): 31 marcos con ~21
// objetos cada uno (formas con texto enriquecido de varios renglones, notas, tarjetas del Kanban y títulos) y ~5
// conectores por marco, casi todos ortogonales y algunos con etiqueta. En total ~650 objetos y ~155 conectores, como el
// tablero real (640+ objetos, 145 conectores, 31 marcos). Los textos son inventados: no hay nada del juego.
//
// Opciones: --url http://127.0.0.1:4338 (si no, TABLERO_PUERTO o 4318) · --tablero "Nombre" (rendimiento).

const args = process.argv.slice(2)
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`)
  return i === -1 ? porDefecto : args[i + 1]
}
const url = opcion('url', `http://127.0.0.1:${process.env.TABLERO_PUERTO || 4318}`)
const host = new URL(url).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`No: ${url} no es de esta computadora. Este script solo carga datos de prueba en un Telar local.`)
  process.exit(1)
}

async function pedir(metodo, ruta, cuerpo) {
  const r = await fetch(url + ruta, {
    method: metodo,
    headers: cuerpo === undefined ? {} : { 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  const datos = texto ? JSON.parse(texto) : null
  if (!r.ok) throw new Error(`${metodo} ${ruta}: ${datos?.error ?? r.status}`)
  return datos
}
const g = (ruta) => pedir('GET', ruta)
const p = (ruta, cuerpo = {}) => pedir('POST', ruta, cuerpo)
const pa = (ruta, cuerpo) => pedir('PATCH', ruta, cuerpo)

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try {
      const s = await g('/api/salud')
      if (s.listo) return
    } catch {
      // todavía no
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No responde ${url}`)
}

async function proyectoRC() {
  const proyectos = await g('/api/proyectos')
  const rc = proyectos.find((x) => x.prefijo === 'RC')
  if (!rc) throw new Error('No está el proyecto RC (¿la base no se sembró?).')
  return rc
}

async function demo() {
  const rc = await proyectoRC()
  const pendientes = rc.tableros.find((t) => t.slug === 'pendientes') ?? rc.tableros[0]
  const t = await g(`/api/tableros/${pendientes.id}`)
  if (t.tarjetas.length > 0) {
    console.log('El tablero ya tiene tarjetas: no cargo nada (borrá la carpeta de datos para empezar de cero).')
    return
  }
  const lista = (nombre) => t.listas.find((l) => l.nombre.startsWith(nombre)).id
  const crear = (d) => p('/api/tarjetas', { tableroId: pendientes.id, ...d })
  const en = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10)

  const horno = await crear({
    listaId: lista('Por hacer'),
    titulo: 'El horno se traba al cocinar dos platos a la vez',
    tipo: 'error',
    prioridad: 'alta',
    etiquetas: ['Cocina'],
    descripcion: 'Pasa con la sopa y las pastas juntas: el segundo plato no arranca.',
  })
  const mozo = await crear({
    listaId: lista('En curso'),
    titulo: 'Animación del mozo llevando la bandeja',
    tipo: 'historia',
    prioridad: 'media',
    etiquetas: ['Interfaz', 'Personajes'],
    responsables: ['Facundo'],
    porque: {
      motivo: 'En Restaurant City el mozo camina con la bandeja en alto: sin eso el local se siente vacío.',
      estado: 'aceptada',
    },
  })
  await crear({
    listaId: lista('Por decidir'),
    titulo: '¿Cuánto cobra el cocinero por hora?',
    tipo: 'pregunta',
    etiquetas: ['Economía'],
    porque: { motivo: 'Define cuánto tarda en recuperarse la inversión de un local nuevo.', estado: 'abierta' },
  })
  const recetas = await crear({
    listaId: lista('Por hacer'),
    titulo: 'Recetas de pastas y sopas del menú',
    tipo: 'tarea',
    prioridad: 'media',
    etiquetas: ['Cocina'],
    vence: en(3),
  })
  await p(`/api/tarjetas/${recetas.clave}/checklists`, {
    titulo: 'Recetas',
    items: ['Fideos con tuco', 'Sopa de verduras', 'Ñoquis', 'Lasaña'],
  })
  await crear({ listaId: lista('Bandeja'), titulo: 'Mesa para dos al lado de la ventana', tipo: 'idea', etiquetas: ['Clientes'] })
  await crear({ listaId: lista('Hecho'), titulo: 'Fachada con el nombre del local', tipo: 'tarea', etiquetas: ['Interfaz'] })

  await p('/api/tableros', { proyectoId: rc.id, nombre: 'Lanzamiento', tipo: 'completo' })

  // Lienzo: dentro de «Mecánicas» (0, 0, 1120 × 760) tres notas, dos textos, tres formas y dos conectores.
  const elem = (d) => p(`/api/tableros/${pendientes.id}/elementos`, d)
  await elem({ tipo: 'nota', x: 70, y: 70, ancho: 220, alto: 220, datos: { texto: 'Los clientes esperan 30 segundos antes de irse', color: 'amarillo' } })
  await elem({ tipo: 'nota', x: 320, y: 70, ancho: 220, alto: 220, datos: { texto: 'Propina según lo rápido que comen', color: 'rosa' } })
  await elem({ tipo: 'nota', x: 570, y: 70, ancho: 220, alto: 220, datos: { texto: 'Combo del día', color: 'celeste' } })
  await elem({ tipo: 'texto', x: 70, y: 330, ancho: 420, alto: 50, datos: { texto: 'Flujo del cliente', tamano: 'grande' } })
  await elem({ tipo: 'texto', x: 70, y: 384, ancho: 520, alto: 34, datos: { texto: 'Entra, se sienta, pide, come y paga.', tamano: 'mediano' } })
  const entra = await elem({ tipo: 'forma', x: 70, y: 470, ancho: 220, alto: 120, datos: { texto: 'Cliente entra', forma: 'rectangulo', color: 'azul' } })
  const hayMesa = await elem({ tipo: 'forma', x: 400, y: 450, ancho: 200, alto: 160, datos: { texto: '¿Hay mesa?', forma: 'rombo', color: 'amarillo' } })
  const sienta = await elem({ tipo: 'forma', x: 720, y: 470, ancho: 220, alto: 120, datos: { texto: 'Se sienta', forma: 'elipse', color: 'verde' } })
  await p(`/api/tableros/${pendientes.id}/conectores`, { desdeId: entra.id, hastaId: hayMesa.id })
  await p(`/api/tableros/${pendientes.id}/conectores`, { desdeId: hayMesa.id, hastaId: sienta.id, etiqueta: 'sí' })
  // Dos tarjetas del Kanban: una en «Flujos» (1280, 0) y otra en «Interfaz» (2560, 0).
  await elem({ tipo: 'tarjeta', x: 1360, y: 90, ancho: 288, alto: 132, tarjetaId: mozo.id })
  await elem({ tipo: 'tarjeta', x: 2640, y: 90, ancho: 288, alto: 132, tarjetaId: horno.id })

  await p('/api/proyectos', { nombre: 'Hotel City', prefijo: 'HC', color: 'celeste', descripcion: 'El hotel, después del restaurante.', tipo: 'completo' })
  console.log(`Listo: 6 tarjetas, 2 tableros en RC, 10 objetos y 2 conectores en «Mecánicas», y el proyecto Hotel City.`)
}

async function rendimiento(cantidad, conectores) {
  const rc = await proyectoRC()
  const nombre = opcion('tablero', `Rendimiento ${cantidad}`)
  const tb = rc.tableros.find((t) => t.nombre === nombre) ?? (await p('/api/tableros', { proyectoId: rc.id, nombre, tipo: 'completo' }))
  const t = await g(`/api/tableros/${tb.id}`)
  if (t.elementos.length > 0) {
    console.log(`«${nombre}» ya tiene ${t.elementos.length} objetos: no cargo más.`)
    return tb
  }
  const colores = ['amarillo', 'naranja', 'rosa', 'violeta', 'azul', 'celeste', 'verde', 'lima', 'gris', 'rojo']
  const formas = ['rectangulo', 'elipse', 'rombo']
  const columnas = Math.ceil(Math.sqrt(cantidad))
  const elementos = []
  for (let i = 0; i < cantidad; i++) {
    const col = i % columnas
    const fila = Math.floor(i / columnas)
    const x = col * 300
    const y = fila * 300
    const tipo = i % 10 < 6 ? 'nota' : i % 10 < 8 ? 'forma' : 'texto'
    const color = colores[i % colores.length]
    if (tipo === 'nota') elementos.push({ tipo, x, y, ancho: 220, alto: 220, datos: { texto: `Nota ${i + 1}: ${'idea '.repeat(1 + (i % 9))}`, color } })
    else if (tipo === 'forma') elementos.push({ tipo, x, y: y + 40, ancho: 220, alto: 140, datos: { texto: `Paso ${i + 1}`, forma: formas[i % 3], color } })
    else elementos.push({ tipo, x, y: y + 80, ancho: 260, alto: 34, datos: { texto: `Texto ${i + 1}`, tamano: 'mediano' } })
  }
  const creados = []
  for (let i = 0; i < elementos.length; i += 100) creados.push(...(await p(`/api/tableros/${tb.id}/elementos`, { elementos: elementos.slice(i, i + 100) })))
  for (let i = 0; i < Math.min(conectores, creados.length - 1); i++) {
    const a = creados[i]
    const b = creados[(i + 1) % creados.length]
    await p(`/api/tableros/${tb.id}/conectores`, { desdeId: a.id, hastaId: b.id })
  }
  console.log(`Listo: «${nombre}» con ${creados.length} objetos y ${Math.min(conectores, creados.length - 1)} conectores (slug ${tb.slug}).`)
  return tb
}

const TEMAS = ['Cocina', 'Salón', 'Clientes', 'Economía', 'Personajes', 'Interfaz', 'Tienda', 'Misiones', 'Sonido', 'Eventos', 'Amigos']
const VERBOS = ['Revisar', 'Agregar', 'Arreglar', 'Probar', 'Medir', 'Decidir', 'Dibujar', 'Ajustar']
const COSAS = ['el horno', 'la caja', 'las mesas', 'el menú', 'la propina', 'el mozo', 'la cola', 'los combos', 'la decoración', 'el pedido']
const COLORES_RC = ['amarillo', 'naranja', 'rosa', 'violeta', 'azul', 'celeste', 'verde', 'lima', 'gris', 'rojo']
const FORMAS_RC = ['redondeado', 'redondeado', 'rectangulo', 'rombo', 'pildora', 'hexagono', 'documento', 'cilindro']

/** Texto en Markdown de 2 a 5 renglones, con negrita y a veces una lista (como los que escribe una IA en RC). */
function textoRico(i) {
  const tema = TEMAS[i % TEMAS.length]
  const cosa = COSAS[(i * 7) % COSAS.length]
  const verbo = VERBOS[(i * 3) % VERBOS.length]
  const renglones = [`**${verbo} ${cosa}**`, `${tema}: hoy tarda ${10 + (i % 50)} s y debería tardar menos.`]
  if (i % 3 === 0) renglones.push(`- ${COSAS[(i + 1) % COSAS.length]}`, `- ${COSAS[(i + 2) % COSAS.length]}`)
  if (i % 4 === 1) renglones.push(`*Depende de* ${COSAS[(i + 3) % COSAS.length]} y de la versión ${1 + (i % 4)}.`)
  return renglones.join('\n')
}

async function parecidoRC() {
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')
  const rc = await proyectoRC()
  const nombre = opcion('tablero', 'Parecido RC')
  const tb = rc.tableros.find((t) => t.nombre === nombre) ?? (await p('/api/tableros', { proyectoId: rc.id, nombre, tipo: 'completo' }))
  const t = await g(`/api/tableros/${tb.id}`)
  if (t.elementos.length > 0) {
    console.log(`«${nombre}» ya tiene ${t.elementos.length} objetos: no cargo más.`)
    return tb
  }
  const MARCOS = Number(opcion('marcos', 31))
  // Las tarjetas del Kanban (dos por marco), en las listas del tablero.
  const listas = t.listas.filter((l) => l.categoria !== 'hecho')
  const tipos = ['tarea', 'error', 'idea', 'historia', 'pregunta']
  const claves = []
  for (let i = 0; i < MARCOS * 2; i++) {
    const tj = await p('/api/tarjetas', {
      tableroId: tb.id,
      listaId: listas[i % listas.length].id,
      titulo: `${VERBOS[i % VERBOS.length]} ${COSAS[(i * 3) % COSAS.length]} (${TEMAS[i % TEMAS.length]})`,
      tipo: tipos[i % tipos.length],
      prioridad: ['alta', 'media', 'baja'][i % 3],
      etiquetas: [TEMAS[i % TEMAS.length]],
      ...(i % 2 ? { porque: { motivo: 'Sin esto el local se siente vacío y la gente se va antes.', estado: 'aceptada' } } : {}),
    })
    claves.push(tj.clave)
  }
  const info = await g('/api/info')
  const urlMcp = new URL(info.urlMcp)
  if (!['127.0.0.1', 'localhost'].includes(urlMcp.hostname)) throw new Error('El MCP de ese Telar no es local: no sigo.')
  const cliente = new Client({ name: 'telar-sembrar', version: '1.0.0' })
  await cliente.connect(new StreamableHTTPClientTransport(urlMcp, { requestInit: { headers: { authorization: `Bearer ${info.clave}`, 'x-tablero-autor': 'Semilla' } } }))
  let objetos = 0
  let conectores = 0
  let n = 0
  for (let m = 0; m < MARCOS; m++) {
    const lista = []
    for (let k = 0; k < 21; k++) {
      const i = n++
      const ref = `o${k}`
      if (k === 0) lista.push({ ref, tipo: 'texto', texto: `# ${TEMAS[m % TEMAS.length]} ${m + 1}` })
      else if (k === 20) lista.push({ ref, tipo: 'texto', texto: `Notas sueltas de **${TEMAS[(m + 1) % TEMAS.length]}**, para ver la semana que viene.` })
      else if (k % 10 === 4 || k % 10 === 9) lista.push({ ref, tipo: 'tarjeta', tarjeta: claves[(m * 2 + (k > 10 ? 1 : 0)) % claves.length] })
      else if (k % 3 === 0) lista.push({ ref, tipo: 'nota', texto: textoRico(i), color: COLORES_RC[i % COLORES_RC.length] })
      else
        lista.push({
          ref,
          tipo: 'forma',
          forma: FORMAS_RC[i % FORMAS_RC.length],
          texto: textoRico(i),
          relleno: COLORES_RC[(i * 3) % COLORES_RC.length],
          ...(i % 5 === 0 ? { borde: COLORES_RC[(i * 3) % COLORES_RC.length] } : {}),
        })
    }
    const cs = []
    for (const [a, b, etiqueta] of [[1, 2], [2, 3, 'sí'], [5, 6], [6, 7], [11, 12, 'después']]) {
      cs.push({ desde: `o${a}`, hasta: `o${b}`, trazo: a === 6 ? 'curvo' : 'ortogonal', ...(etiqueta ? { etiqueta } : {}) })
    }
    const r = await cliente.callTool({
      name: 'armar_en_lienzo',
      arguments: {
        proyecto: 'RC',
        tablero: tb.id,
        objetos: lista,
        conectores: cs,
        disposicion: 'grilla',
        columnas: 5,
        nuevo_marco: { titulo: `${TEMAS[m % TEMAS.length]} · parte ${m + 1}`, color: COLORES_RC[m % COLORES_RC.length] },
      },
    })
    const texto = r.content?.map((c) => c.text ?? '').join('') ?? ''
    if (r.isError) throw new Error(`armar_en_lienzo: ${texto}`)
    objetos += lista.length
    conectores += cs.length
  }
  await cliente.close()
  // armar_en_lienzo pone cada marco nuevo al costado del anterior (una fila de 60.000 px): se acomodan en una grilla de
  // 6 columnas, como un tablero que se usa, con lo de adentro de cada marco.
  const armado = await g(`/api/tableros/${tb.id}`)
  const marcos = armado.elementos.filter((e) => e.tipo === 'marco').sort((a, b) => a.x - b.x)
  const cambios = []
  marcos.forEach((m, i) => {
    const dx = (i % 6) * 2100 - m.x
    const dy = Math.floor(i / 6) * 1700 - m.y
    for (const e of armado.elementos) {
      const cx = e.x + e.ancho / 2
      const cy = e.y + e.alto / 2
      if (e === m || (e.tipo !== 'marco' && cx >= m.x && cx <= m.x + m.ancho && cy >= m.y && cy <= m.y + m.alto))
        cambios.push({ id: e.id, x: e.x + dx, y: e.y + dy })
    }
  })
  for (let i = 0; i < cambios.length; i += 200) await pa('/api/elementos', { cambios: cambios.slice(i, i + 200) })
  console.log(`Listo: «${nombre}» con ${MARCOS} marcos, ${objetos} objetos y ${conectores} conectores (slug ${tb.slug}).`)
  return tb
}

await esperarServidor()
if (args.includes('--demo')) await demo()
if (args.includes('--parecido-rc')) await parecidoRC()
const cantidad = Number(opcion('cantidad', 0))
if (cantidad > 0) await rendimiento(cantidad, Number(opcion('conectores', Math.round(cantidad * 0.3))))
