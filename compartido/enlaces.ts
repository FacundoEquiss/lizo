import type { TipoEnlace } from './tipos'

export interface EnlaceAnalizado {
  tipo: TipoEnlace
  titulo: string
  datos: Record<string, unknown>
}

/** Reconoce links de GitHub, Figma y Discord; el resto queda como "web". */
export function analizarEnlace(urlTexto: string): EnlaceAnalizado {
  let url: URL
  try {
    url = new URL(urlTexto.trim())
  } catch {
    return { tipo: 'web', titulo: urlTexto.trim(), datos: {} }
  }
  const host = url.hostname.replace(/^www\./, '')
  const partes = url.pathname.split('/').filter(Boolean)

  if (host === 'github.com' && partes.length >= 2) {
    const repo = `${partes[0]}/${partes[1]}`
    const [, , seccion, valor, ...resto] = partes
    if (seccion === 'pull' && valor) {
      return { tipo: 'github_pr', titulo: `PR #${valor}`, datos: { repo, numero: Number(valor) } }
    }
    if (seccion === 'issues' && valor) {
      return { tipo: 'github_issue', titulo: `Issue #${valor}`, datos: { repo, numero: Number(valor) } }
    }
    if (seccion === 'commit' && valor) {
      return { tipo: 'github_commit', titulo: valor.slice(0, 7), datos: { repo, sha: valor } }
    }
    if (seccion === 'tree' && valor) {
      const rama = [valor, ...resto].join('/')
      return { tipo: 'github_rama', titulo: rama, datos: { repo, rama } }
    }
    if (seccion === 'blob' && valor) {
      const archivo = resto.join('/')
      return { tipo: 'web', titulo: archivo || repo, datos: { repo, rama: valor, archivo, github: true } }
    }
    return { tipo: 'github_repo', titulo: repo, datos: { repo } }
  }

  if (host === 'figma.com' || host.endsWith('.figma.com')) {
    const clase = partes[0] // design | file | board | proto | slides | deck | make
    const clave = partes[1]
    const nombre = partes[2] ? decodeURIComponent(partes[2]).replace(/-/g, ' ') : 'Figma'
    const nodo = url.searchParams.get('node-id')
    return {
      tipo: 'figma',
      titulo: nombre,
      datos: {
        clase,
        fileKey: clave,
        nodeId: nodo,
        embedUrl: urlEmbebidoFigma(url.toString()),
      },
    }
  }

  if (host === 'discord.com' || host === 'discordapp.com') {
    if (partes[0] === 'channels') {
      const [, servidor, canal, mensaje] = partes
      return {
        tipo: 'discord',
        titulo: mensaje ? 'Mensaje de Discord' : 'Canal de Discord',
        datos: { servidor, canal, mensaje: mensaje ?? null },
      }
    }
    return { tipo: 'discord', titulo: 'Discord', datos: {} }
  }

  const titulo = host + (url.pathname !== '/' ? url.pathname : '')
  return { tipo: 'web', titulo: titulo.length > 60 ? titulo.slice(0, 57) + '…' : titulo, datos: { host } }
}

/**
 * Convierte un link de Figma en el link para embeberlo en un iframe
 * (https://developers.figma.com/docs/embeds/embed-figma-file/): se cambia
 * `www` por `embed` y se agrega `embed-host`.
 */
export function urlEmbebidoFigma(urlTexto: string, tema: 'light' | 'dark' | 'system' = 'system'): string {
  try {
    const url = new URL(urlTexto)
    url.hostname = 'embed.figma.com'
    url.searchParams.set('embed-host', 'tablero')
    url.searchParams.set('theme', tema)
    url.searchParams.set('footer', 'false')
    return url.toString()
  } catch {
    return urlTexto
  }
}

export function esUrl(texto: string): boolean {
  return /^https?:\/\/\S+$/i.test(texto.trim())
}

/** Nombre de rama al estilo Jira/Linear: "RC-12-que-los-clientes-no-se-vayan". */
export function nombreDeRama(clave: string, titulo: string): string {
  const base = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 7)
    .join('-')
  return base ? `${clave}-${base}` : clave
}
