// Ayudas de los guiones de Diseño: levantar un Telar local de prueba (carpeta de datos propia, puerto propio), hablarle a
// su API y conectarse a su MCP con el cliente oficial (como cualquier cliente).
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function esperarSalud(base, ms = 40_000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${base}/api/salud`, { signal: AbortSignal.timeout(1500) })
      if (r.ok && (await r.json()).listo) return
    } catch {
      // todavía no
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Telar no arrancó en ${base}`)
}

/** Un Telar nuevo, con su propia carpeta de datos. Devuelve { base, clave, datos, cerrar }. */
export async function levantarTelar({ puerto = 4391, datos, clave = 'prueba-' + Math.random().toString(36).slice(2, 10), produccion = true, log = false } = {}) {
  const carpeta = datos ?? mkdtempSync(path.join(os.tmpdir(), 'telar-prueba-'))
  const hijo = spawn(process.execPath, [path.join(RAIZ, 'node_modules/tsx/dist/cli.mjs'), 'servidor/src/principal.ts', produccion ? '--produccion' : '--dev'], {
    cwd: RAIZ,
    env: { ...process.env, TABLERO_DATOS: carpeta, TABLERO_PUERTO: String(puerto), TABLERO_CLAVE: clave, TABLERO_SEMILLA_DISCORD: 'no', TABLERO_USUARIO: 'Facundo' },
    stdio: log ? 'inherit' : 'ignore',
  })
  const base = `http://127.0.0.1:${puerto}`
  await esperarSalud(base)
  return {
    base,
    clave,
    datos: carpeta,
    async cerrar() {
      hijo.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 300))
    },
  }
}

export function clienteApi(base, clave) {
  return async function api(metodo, ruta, cuerpo) {
    const r = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(clave ? { 'x-tablero-clave': clave } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    const texto = await r.text()
    let datos = null
    try {
      datos = JSON.parse(texto)
    } catch {
      datos = texto
    }
    if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status}: ${datos?.error ?? texto}`)
    return datos
  }
}

/** El cliente oficial de MCP (v2) por HTTP, con la clave. */
export async function conectarMcp(base, clave, autor = 'Prueba MCP') {
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')
  const cliente = new Client({ name: autor, version: '1.0.0' })
  const transporte = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${clave}`, 'x-tablero-autor': autor } },
  })
  await cliente.connect(transporte)
  return {
    cliente,
    async llamar(nombre, args = {}) {
      const r = await cliente.callTool({ name: nombre, arguments: args })
      const texto = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
      const imagenes = (r.content ?? []).filter((c) => c.type === 'image').map((c) => ({ mime: c.mimeType, bytes: Buffer.from(c.data, 'base64') }))
      return { error: Boolean(r.isError), texto, imagenes }
    },
    cerrar: () => cliente.close(),
  }
}

/** Medidas de un PNG por su cabecera. */
export function medidasPng(b) {
  if (b[0] !== 0x89 || b[1] !== 0x50) return null
  return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) }
}
