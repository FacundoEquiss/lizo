// `npm run mcp`: el MCP por stdio, para Claude Code y Claude Desktop.
// Si ya hay un tablero corriendo (npm run dev), le pide a ese que corra cada
// herramienta, así los cambios aparecen en vivo en la pantalla. Si no hay
// ninguno, levanta el servidor acá mismo (con la web en vivo en el mismo puerto).
import './silenciar'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import type { Actor } from '../../../compartido/tipos'
import { ejecutorLocal } from '../api'
import { leerClave, urlServidor } from '../config'
import { CUENTA_DUENO } from '../datos/almacen'
import { hayTablero, iniciarServidor, PuertoOcupado, type ServidorEnMarcha } from '../servidor'
import { crearServidorMcp, type Ejecutor } from './servidor-mcp'

const autorFijo = process.env.TABLERO_AUTOR || null
const clave = leerClave()
let propio: ServidorEnMarcha | null = null
let local: Ejecutor | null = null

const log = (m: string) => console.error(`[tablero mcp] ${m}`)

async function remoto(nombre: string, args: unknown, actor: Actor): Promise<unknown> {
  const r = await fetch(`${urlServidor()}/api/herramientas/${encodeURIComponent(nombre)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${clave}` },
    body: JSON.stringify({ args, actor }),
    signal: AbortSignal.timeout(60_000),
  })
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; resultado?: unknown; error?: string }
  if (!r.ok || !j.ok) throw new Error(j.error || `El servidor respondió ${r.status}.`)
  return j.resultado
}

async function tomarServidor() {
  if (local || (await hayTablero())) return
  try {
    propio = await iniciarServidor({ log })
    local = ejecutorLocal(propio.servicio.de(CUENTA_DUENO))
  } catch (e) {
    if (!(e instanceof PuertoOcupado)) throw e
  }
}

const esDeConexion = (e: unknown) =>
  e instanceof TypeError || /ECONNREFUSED|fetch failed|socket hang up/i.test(String((e as Error)?.message ?? e))

const ejecutar: Ejecutor = async (nombre, args, actor) => {
  if (local) return local(nombre, args, actor)
  try {
    return await remoto(nombre, args, actor)
  } catch (e) {
    if (!esDeConexion(e)) throw e
    // El servidor de `npm run dev` se cerró (o se está reiniciando): espero un poco y, si no vuelve, lo levanto yo.
    for (let i = 0; i < 6 && !(await hayTablero()); i++) await new Promise((r) => setTimeout(r, 500))
    await tomarServidor()
    const ahora = local as Ejecutor | null
    if (ahora) return ahora(nombre, args, actor)
    return remoto(nombre, args, actor)
  }
}

async function cerrar() {
  await propio?.cerrar().catch(() => {})
  process.exit(0)
}

await tomarServidor()
log(local ? `servidor propio en ${urlServidor()}` : `uso el tablero que ya corre en ${urlServidor()}`)

serveStdio(() => crearServidorMcp({ ejecutor: ejecutar, autorFijo }), {
  onerror: (e) => log(`error: ${e.message}`),
})

process.stdin.on('end', cerrar)
process.stdin.on('close', cerrar)
process.on('SIGINT', cerrar)
process.on('SIGTERM', cerrar)
