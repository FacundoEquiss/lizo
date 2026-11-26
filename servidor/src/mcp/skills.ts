// «Skills over MCP» (extensión io.modelcontextprotocol/skills, SEP-2640): Telar publica sus skills junto a las herramientas.
// El cliente (Claude, Claude Code) lista solo el nombre y la descripción y carga el texto cuando el pedido toca el tema, así
// una IA aprende a usar Telar bien sin tener que acordarse de llamar a leer_guia. Salen de la misma guía (guia.ts): una sola
// fuente. leer_guia sigue ahí para los clientes que todavía no leen skills (ChatGPT y otros).
import { memorySkillFiles, SkillsExtension, type SkillCatalog } from '@modelcontextprotocol/server/ext/skills'
import { SKILLS_GUIA } from './guia'

/** El archivo SKILL.md de una skill: frontmatter con nombre y descripción (JSON es YAML válido) y el texto de la guía. */
function archivoSkill(nombre: string, descripcion: string, texto: string): string {
  return `---\nname: ${nombre}\ndescription: ${JSON.stringify(descripcion)}\n---\n\n${texto.trimStart()}`
}

let catalogo: Promise<SkillCatalog> | null = null

/** El catálogo, armado una sola vez por proceso (el contenido es el mismo para todas las cuentas: es la guía de uso). */
export function catalogoSkills(): Promise<SkillCatalog> {
  catalogo ??= SkillsExtension.load(
    memorySkillFiles(Object.fromEntries(SKILLS_GUIA.map((s) => [`${s.nombre}/SKILL.md`, archivoSkill(s.nombre, s.descripcion, s.texto())]))),
    // La guía cambia solo con una publicación nueva: que el cliente la guarde una hora y la comparta.
    { cacheHint: { ttlMs: 3_600_000, cacheScope: 'public' }, strict: true },
  )
  return catalogo
}
