import { McpServer } from '@modelcontextprotocol/server'
import { VERSION } from '../../../compartido/constantes'
import type { Actor } from '../../../compartido/tipos'
import { HERRAMIENTAS, INSTRUCCIONES_MCP } from './herramientas'
import { esRespuestaMcp } from '../diseno/herramientas-mcp'
import { catalogoSkills } from './skills'

/** Corre una herramienta: en este mismo proceso o pidiéndosela al servidor (puente stdio). */
export type Ejecutor = (nombre: string, args: unknown, actor: Actor) => Promise<unknown>

/** Nombre lindo para lo que dice el cliente MCP de sí mismo ("claude-code", "openai-mcp"…). */
export function actorDeCliente(nombreCliente: string | undefined, autorFijo?: string | null): Actor {
  // Un User-Agent genérico (node, undici, python, curl…) no dice quién es: queda como "IA".
  const generico = /^(node|undici|python|axios|curl|go-http|okhttp|fetch|mozilla)\b/i.test((nombreCliente ?? '').trim())
  const crudo = (autorFijo || (generico ? '' : nombreCliente) || '').trim()
  const n = crudo.toLowerCase()
  let nombre = 'IA'
  let cliente = crudo || 'MCP'
  if (n.includes('claude')) {
    nombre = 'Claude'
    if (n.includes('code')) cliente = 'Claude Code'
    else if (n.includes('desktop')) cliente = 'Claude Desktop'
    else if (n.includes('ai') || n === 'claude') cliente = 'Claude'
  } else if (n.includes('openai') || n.includes('chatgpt') || n.includes('gpt')) {
    nombre = 'ChatGPT'
    cliente = 'ChatGPT'
  } else if (n.includes('cursor')) {
    nombre = 'Cursor'
    cliente = 'Cursor'
  } else if (n.includes('codex')) {
    nombre = 'Codex'
    cliente = 'Codex'
  } else if (crudo) {
    nombre = crudo.length > 24 ? crudo.slice(0, 24) : crudo
  }
  if (autorFijo && !['claude', 'chatgpt', 'cursor', 'codex'].some((k) => n.includes(k))) nombre = autorFijo
  return { tipo: 'ia', id: `ia:${nombre.toLowerCase()}`, nombre, cliente }
}

/** El resultado de una herramienta como texto (lo que ve un cliente MCP; el agente de adentro ve lo mismo). */
export function texto(resultado: unknown): string {
  if (typeof resultado === 'string') return resultado
  return JSON.stringify(resultado, (_k, v) => (v === undefined ? undefined : v), 1)
}

/**
 * Arma un servidor MCP con todas las herramientas. Se llama una vez por pedido
 * (HTTP sin estado) o por conexión (stdio), como pide el SDK v2.
 */
export async function crearServidorMcp(opciones: {
  ejecutor: Ejecutor
  /** Autor fijo (TABLERO_AUTOR en stdio, o el encabezado X-Tablero-Autor en HTTP). */
  autorFijo?: string | null
  /** Para HTTP: el User-Agent, por si el cliente no manda su nombre. */
  agenteHttp?: string | null
}): Promise<McpServer> {
  const servidor = new McpServer(
    { name: 'telar', title: 'Telar', version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCCIONES_MCP },
  )
  for (const h of HERRAMIENTAS) {
    servidor.registerTool(
      h.nombre,
      {
        title: h.titulo,
        description: h.descripcion,
        inputSchema: h.esquema,
        annotations: {
          title: h.titulo,
          readOnlyHint: h.soloLectura,
          destructiveHint: false,
          idempotentHint: h.idempotente ?? h.soloLectura,
          openWorldHint: false,
        },
      },
      async (args: unknown, ctx: any) => {
        const sobre = ctx?.mcpReq?.envelope as Record<string, any> | undefined
        const deSobre = sobre?.['io.modelcontextprotocol/clientInfo']?.name as string | undefined
        const deSesion = servidor.server.getClientVersion?.()?.name
        const actor = actorDeCliente(deSobre ?? deSesion ?? opciones.agenteHttp ?? undefined, opciones.autorFijo)
        try {
          const r = await opciones.ejecutor(h.nombre, args ?? {}, actor)
          // Diseño: respuestas con imagen (ver_diseno y las que escriben con ver: true)
          if (esRespuestaMcp(r)) return { content: r.contenido }
          return { content: [{ type: 'text' as const, text: texto(r) }] }
        } catch (e) {
          const mensaje = e instanceof Error ? e.message : String(e)
          return { isError: true, content: [{ type: 'text' as const, text: mensaje }] }
        }
      },
    )
  }
  // Las skills (la guía por temas) viajan con el servidor: el cliente las lista y carga solo cuando hacen falta.
  ;(await catalogoSkills()).attach(servidor)
  return servidor
}
