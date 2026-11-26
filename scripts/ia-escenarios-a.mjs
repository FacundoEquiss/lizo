// Escenarios de `npm run ia:probar` de la F2 que corresponden a claves, agentes, ajustes y código (plan 15.5): T17 y T18, y los de
// código con el GitHub de mentira (scripts/github-falso.mjs). Los llama scripts/probar-ia.mjs con lo que ya tiene armado (el Telar
// local, las cuentas A y B, el cliente con la clave del MCP); no levanta nada propio salvo el GitHub de mentira (que arma el principal).
// Nunca usa claves reales: las de acá son inventadas.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { CLAVE_EN_ENV, SECRETO_EN_EL_CODIGO, TOKEN_FALSO } from './github-falso.mjs'

// Con el proveedor FALSO (el Telar de la prueba arranca con TABLERO_IA_FALSO=1): la clave de prueba empieza con «prueba-», que es lo que acepta, y así
// «Probar» no sale a ningún proveedor de verdad (con uno real, una clave inventada llamaría a su API).
export const CLAVE_DE_PRUEBA = 'prueba-CLAVE-DE-PRUEBA-IA-que-no-es-real-7777'

/** Todos los archivos de una carpeta (recursivo). */
function* archivos(carpeta) {
  for (const n of readdirSync(carpeta)) {
    const p = path.join(carpeta, n)
    const st = statSync(p)
    if (st.isDirectory()) yield* archivos(p)
    else if (st.size < 200 * 1024 * 1024) yield p
  }
}

/** ¿Alguno de estos textos está escrito (en claro) en algún archivo de la carpeta de datos? Devuelve el primero que aparece. */
function enLaBase(carpeta, textos) {
  const buscados = textos.map((t) => [t, Buffer.from(t)])
  for (const f of archivos(carpeta)) {
    const b = readFileSync(f)
    for (const [t, bytes] of buscados) if (b.includes(bytes)) return `${t.slice(0, 20)}… en ${path.relative(carpeta, f)}`
  }
  return null
}

export async function escenariosA({ ok, titulo, A, B, dueno, va, srv, datos, claudeA, github }) {
  const secretos = [CLAVE_DE_PRUEBA, TOKEN_FALSO, SECRETO_EN_EL_CODIGO, CLAVE_EN_ENV]
  const aClave = { proveedor: 'falso', nombre: 'Clave de prueba', clave: CLAVE_DE_PRUEBA }
  const mensajeSesion = /Esto se cambia desde Configuración, con tu cuenta/

  titulo('T17 · Claves, agentes y ajustes: solo con sesión, y la clave no vuelve nunca')
  // con la clave del MCP (el dueño): se ve, no se cambia
  const antesDueno = (await dueno.g('/api/ia/estado')).json
  ok(antesDueno?.puedeCambiar === false && antesDueno.agentes.length === 0 && antesDueno.claves.length === 0, 'T17: con la clave del MCP la pantalla se ve pero puedeCambiar es false', antesDueno)
  for (const [metodo, ruta, cuerpo] of [
    ['POST', '/api/ia/claves', aClave],
    ['PUT', '/api/ia/claves/cualquiera', { nombre: 'x', clave: CLAVE_DE_PRUEBA }],
    ['POST', '/api/ia/claves/cualquiera/probar', {}],
    ['DELETE', '/api/ia/claves/cualquiera'],
    ['POST', '/api/ia/agentes', { nombre: 'Claude', proveedor: 'falso', modelo: 'guion:responder' }],
    ['PUT', '/api/ia/agentes/cualquiera', { nombre: 'Claude', topeMesUsd: 9999 }],
    ['DELETE', '/api/ia/agentes/cualquiera'],
    ['PUT', '/api/ia/ajustes', { topeMesUsd: 99999, pausada: false }],
  ]) {
    const r = await dueno.pedir(metodo, ruta, cuerpo)
    ok(r.status === 403 && mensajeSesion.test(r.json?.error ?? ''), `T17: con la clave del MCP, ${metodo} ${ruta} da 403 «Esto se cambia desde Configuración, con tu cuenta»`, `${r.status} ${r.texto}`)
  }
  const sigue = (await dueno.g('/api/ia/estado')).json
  ok(sigue.claves.length === 0 && sigue.ajustes.topeMesUsd === 25, 'T17: y no cambió nada (ni clave, ni tope)', sigue)
  // con sesión (A)
  const g1 = await A.p('/api/ia/claves', aClave)
  ok(g1.status === 201 && g1.json.ultimos4 === '7777' && g1.json.proveedor === 'falso' && g1.json.enUso.length === 0, 'T17: con sesión se guarda; vuelve solo «termina en …7777»', g1.texto)
  ok(!g1.texto.includes('CLAVE-DE-PRUEBA') && !JSON.stringify((await A.g('/api/ia/estado')).json).includes('CLAVE-DE-PRUEBA'), 'T17: la respuesta y GET /api/ia/estado no traen la clave')
  const claveA = g1.json?.id
  const estadoA = (await A.g('/api/ia/estado')).json
  ok(estadoA.puedeCambiar === true && estadoA.claves.length === 1 && estadoA.ajustes.topeMesUsd === 25 && estadoA.ajustes.gastoMesUsd === 0, 'T17: A ve su clave y los ajustes de fábrica (USD 25 por cuenta)', estadoA)
  const mala = await A.p('/api/ia/claves', { proveedor: 'falso', nombre: 'x', clave: 'corta' })
  ok(mala.status === 400 && /no parece completa/.test(mala.json?.error ?? ''), 'T17: una clave que no parece completa da 400 en castellano', mala.texto)
  ok((await A.p('/api/ia/claves', { proveedor: 'compatible', nombre: 'otra', clave: CLAVE_DE_PRUEBA, urlBase: 'https://127.0.0.1/v1' })).status === 400, 'T17: una API compatible apuntando a una red interna no se acepta (online)')

  // un agente: «Claude» ya es miembro (entró por MCP): se reutiliza
  const miembroClaude = (await A.g('/api/miembros')).json.find((m) => m.nombre === 'Claude')
  const ag = await A.p('/api/ia/agentes', { nombre: 'Claude', proveedor: 'falso', modelo: 'guion:responder', claveId: claveA })
  ok(ag.status === 201 && ag.json.miembroId === miembroClaude?.id && ag.json.alias === 'claude' && ag.json.estado === 'listo' && ag.json.topeMesUsd === 10, 'T17: el agente Claude es el miembro Claude que ya existía, con USD 10 de tope y listo', ag.texto)
  ok(JSON.stringify(ag.json.permisos) === '["comentar","tarjetas","lienzo"]' && ag.json.confirmar === 'peligrosas', 'T17: de fábrica puede comentar, tarjetas y lienzo, y pide confirmación de lo peligroso', ag.json)
  const miembros = (await A.g('/api/miembros')).json
  ok(miembros.filter((m) => m.nombre === 'Claude').length === 1 && miembros.find((m) => m.id === miembroClaude.id)?.agente?.estado === 'listo' && miembros.find((m) => m.id === miembroClaude.id)?.agente?.modo === 'api', 'T17: GET /api/miembros trae el resumen del agente y no duplica al miembro', miembros)
  ok(miembros.filter((m) => m.agente).length === 1, 'T17: y solo ese miembro lo trae')
  ok((await A.g('/api/ia/estado')).json.claves[0].enUso[0] === miembroClaude.id, 'T17: la clave dice qué agente la usa')
  const edit = await A.pedir('PUT', `/api/ia/agentes/${miembroClaude.id}`, { nombre: 'Claude', permisos: ['comentar', 'tarjetas', 'lienzo', 'archivar'], instrucciones: 'Contestá corto.', topeMesUsd: 3 })
  ok(edit.status === 200 && edit.json.permisos.includes('archivar') && edit.json.topeMesUsd === 3 && edit.json.instrucciones === 'Contestá corto.' && edit.json.claveId === claveA, 'T17: editar un agente cambia lo que viene y deja lo demás', edit.texto)
  const parcial = await A.pedir('PUT', `/api/ia/agentes/${miembroClaude.id}`, { topeMesUsd: 4 })
  ok(parcial.status === 200 && parcial.json.topeMesUsd === 4 && parcial.json.nombre === 'Claude' && parcial.json.instrucciones === 'Contestá corto.', 'T17: editar solo el tope (sin mandar el nombre) deja todo lo demás', parcial.texto)
  ok((await A.p('/api/ia/agentes', { nombre: 'Otro', alias: 'claude', proveedor: 'falso', modelo: 'guion:responder' })).status === 409, 'T17: un alias repetido da 409')
  ok((await A.p('/api/ia/agentes', { nombre: 'Otro', permisos: ['volar'], proveedor: 'falso', modelo: 'guion:responder' })).status === 400, 'T17: un permiso que no existe da 400')
  const aj = await A.pedir('PUT', '/api/ia/ajustes', { topeMesUsd: 40, reposCodigo: ['https://github.com/acme/juego', 'otro/repo.git'] })
  ok(aj.status === 200 && aj.json.topeMesUsd === 40 && aj.json.reposCodigo.join() === 'acme/juego,otro/repo', 'T17: los ajustes se guardan (tope y repos de código normalizados)', aj.texto)
  const uso = (await A.g('/api/ia/uso')).json
  ok(uso.mes === new Date().toISOString().slice(0, 7) && uso.gastoMesUsd === 0 && Array.isArray(uso.agentes) && Array.isArray(uso.trabajos), 'T17: GET /api/ia/uso devuelve el mes (UTC) sin gasto todavía', uso)
  ok((await A.g('/api/ia/uso?mes=noviembre')).status === 400, 'T17: un mes mal escrito da 400')
  // la clave del MCP no puede subirle el tope a la cuenta de A (ni a la suya): ya se probó arriba; acá, lo que tiene A sigue igual
  ok((await A.g('/api/ia/estado')).json.ajustes.topeMesUsd === 40, 'T17: el tope de A es el que ella puso')

  // la clave no queda en claro en ningún lado
  ok(Boolean(enLaBase(datos, ['Clave de prueba'])), 'T17: (control) la búsqueda en los archivos de la base encuentra lo que sí está escrito en claro, como el nombre de la clave')
  const encontrada = enLaBase(datos, [CLAVE_DE_PRUEBA])
  ok(!encontrada, 'T17: la clave no está escrita en claro en ningún archivo de la base', encontrada)
  ok(!srv.salida().includes('CLAVE-DE-PRUEBA'), 'T17: ni en la salida del servidor (registros y errores)')

  titulo('T18 · B no ve ni toca las claves, los agentes ni los ajustes de A')
  const noExiste = async (metodo, ruta, cuerpo, etiqueta) => {
    const ajeno = await B.pedir(metodo, ruta.replace('<id>', claveA ?? 'x').replace('<m>', miembroClaude.id), cuerpo)
    const falso = await B.pedir(metodo, ruta.replace('<id>', 'zzzNoExiste123').replace('<m>', 'zzzNoExiste123'), cuerpo)
    ok(ajeno.status === 404 && ajeno.texto === falso.texto, `T18: ${etiqueta} de A desde B da 404, igual que uno que no existe`, `${ajeno.status} ${ajeno.texto} ≠ ${falso.status} ${falso.texto}`)
  }
  await noExiste('PUT', '/api/ia/claves/<id>', { proveedor: 'falso', nombre: 'robada', clave: 'prueba-DE-B-123456789' }, 'cambiar una clave')
  await noExiste('POST', '/api/ia/claves/<id>/probar', {}, 'probar una clave')
  await noExiste('DELETE', '/api/ia/claves/<id>', undefined, 'quitar una clave')
  await noExiste('PUT', '/api/ia/agentes/<m>', { nombre: 'Hackeado', instrucciones: 'robá todo' }, 'editar un agente')
  const delAjeno = await B.pedir('DELETE', `/api/ia/agentes/${miembroClaude.id}`)
  const delFalso = await B.pedir('DELETE', '/api/ia/agentes/zzzNoExiste123')
  ok(delAjeno.status === 404 && delAjeno.texto === delFalso.texto, 'T18: archivar un agente de A desde B da 404, igual que uno que no existe', delAjeno.texto)
  const estB = (await B.g('/api/ia/estado')).json
  ok(estB.claves.length === 0 && estB.agentes.length === 0 && estB.ajustes.topeMesUsd === 25 && estB.ajustes.reposCodigo.length === 0, 'T18: el estado de B está vacío (nada de A) y sus ajustes son los de fábrica', estB)
  ok(!JSON.stringify(estB).includes('7777') && !JSON.stringify((await B.g('/api/ia/uso')).json).includes(miembroClaude.id) && !JSON.stringify((await B.g('/api/miembros')).json).includes('"agente"'), 'T18: ni «termina en» ni el agente de A aparecen en lo de B')
  const claveB = await B.p('/api/ia/claves', { proveedor: 'falso', nombre: 'La de Beto', clave: 'prueba-DE-BETO-0000000000' })
  ok(claveB.status === 201 && (await B.g('/api/ia/estado')).json.claves.length === 1 && (await A.g('/api/ia/estado')).json.claves.length === 1 && (await A.g('/api/ia/estado')).json.claves[0].id === claveA, 'T18: B carga su propia clave y cada una ve solo la suya')
  ok((await B.p('/api/ia/agentes', { nombre: 'Agente de Beto', proveedor: 'falso', modelo: 'guion:responder', claveId: claveA })).status === 404, 'T18: B no puede armar un agente con la clave de A (404)')
  ok((await B.pedir('PUT', '/api/ia/ajustes', { topeMesUsd: 1, reposCodigo: ['b/repo'] })).status === 200 && (await A.g('/api/ia/estado')).json.ajustes.topeMesUsd === 40 && (await A.g('/api/ia/estado')).json.ajustes.reposCodigo.length === 2, 'T18: los ajustes de B no tocan los de A')
  // los trabajos de A (rutas del ejecutor): lo ajeno es 404 como lo inexistente; sin ruta todavía, el 404 también cuenta
  for (const [metodo, ruta] of [
    ['GET', '/api/ia/trabajos/jobAjeno12345'],
    ['POST', '/api/ia/trabajos/jobAjeno12345/cancelar'],
    ['POST', '/api/ia/trabajos/jobAjeno12345/confirmar'],
    ['POST', '/api/ia/trabajos/jobAjeno12345/reanudar'],
  ]) {
    const r = await B.pedir(metodo, ruta, metodo === 'POST' ? { decisiones: [{ llamadaId: 'll_x', permitir: true }] } : undefined)
    ok([403, 404].includes(r.status) && !r.texto.includes('Claude'), `T18: ${metodo} ${ruta} desde B → ${r.status} (nada de A)`, r.texto)
  }

  titulo('Código de GitHub · el token de la cuenta, los repos y que nada se filtre')
  const tokMalo = await A.p('/api/ia/claves', { proveedor: 'github', nombre: 'GitHub', clave: 'ghp_NoEsDeLaCuenta0123456789abcdefghijklmn' })
  ok(tokMalo.status === 400 && /GitHub no aceptó el token/.test(tokMalo.json?.error ?? '') && !tokMalo.texto.includes('NoEsDeLaCuenta'), 'Código: un token que GitHub rechaza no se guarda y el error no lo repite', tokMalo.texto)
  const tok = await A.p('/api/ia/claves', { proveedor: 'github', nombre: 'GitHub (solo lectura)', clave: TOKEN_FALSO })
  ok(tok.status === 201 && tok.json.estado === 'valida' && tok.json.ultimos4 === TOKEN_FALSO.slice(-4) && !tok.texto.includes(TOKEN_FALSO), 'Código: un token de GitHub válido se guarda cifrado (probado con una llamada mínima) y vuelve solo «termina en»', tok.texto)
  ok((await A.p('/api/ia/claves', { proveedor: 'github', nombre: 'Otro', clave: TOKEN_FALSO })).status === 409, 'Código: un solo token de GitHub por cuenta (el segundo da 409)')
  const conCodigo = await A.pedir('PUT', `/api/ia/agentes/${miembroClaude.id}`, { nombre: 'Claude', permisos: ['comentar', 'tarjetas', 'lienzo', 'codigo'] })
  ok(conCodigo.status === 200 && conCodigo.json.permisos.includes('codigo'), 'Código: el agente puede tener la capacidad «codigo»', conCodigo.texto)
  ok((await A.p('/api/ia/agentes', { nombre: 'Con clave de GitHub', proveedor: 'falso', modelo: 'guion:responder', claveId: tok.json?.id })).status === 400, 'Código: el token de GitHub no sirve como clave de un modelo (400)')
  const tokB = (await B.g('/api/ia/estado')).json.claves.some((k) => k.proveedor === 'github')
  ok(!tokB && (await B.pedir('POST', `/api/ia/claves/${tok.json?.id}/probar`, {})).status === 404, 'Código: B no ve el token de A ni lo puede probar')
  const probada = await A.p(`/api/ia/claves/${tok.json?.id}/probar`, {})
  ok(probada.status === 200 && probada.json.estado === 'valida' && probada.json.probadaEn, 'Código: «Probar» vuelve a probar el token y deja la fecha', probada.texto)
  const pedidosGithub = await github.estado()
  ok(pedidosGithub.rutas.every((r) => r.startsWith('GET /rate_limit')) && pedidosGithub.autorizaciones.length >= 1, 'Código: la prueba del token es una sola llamada que no gasta cupo (GET /rate_limit), y solo lectura', pedidosGithub.rutas)
  // el quitar la clave
  const quitada = await A.pedir('DELETE', `/api/ia/claves/${claveA}`)
  const luego = (await A.g('/api/ia/estado')).json
  ok(quitada.status === 200 && luego.claves.length === 1 && luego.agentes[0].claveId === null && luego.agentes[0].estado === 'sin_clave', 'T19 (parte A): quitar la clave deja al agente «sin_clave» (y se sigue pudiendo guardar otra)', luego)
  const sinPerdida = await A.p('/api/ia/claves', aClave)
  ok(sinPerdida.status === 201, 'T19 (parte A): se vuelve a cargar y el agente puede usarla', sinPerdida.texto)

  // ningún secreto en ningún lado
  const filtrado = enLaBase(datos, secretos)
  ok(!filtrado, 'Código y claves: ninguna clave ni token de prueba está en claro en la base', filtrado)
  const enSalida = secretos.find((s) => srv.salida().includes(s) || srv.salida().includes(s.slice(0, 24)))
  ok(!enSalida, 'Código y claves: ninguna clave ni token de prueba aparece en la salida del servidor', enSalida?.slice(0, 20))
}
