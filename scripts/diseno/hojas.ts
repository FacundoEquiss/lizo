// Paso 2: las hojas de estilo. A cada regla se le agrega `--telar-origen: "ui.css:412"` (así el inspector sabe archivo y
// línea sin índices frágiles), los url() pasan a rutas del paquete y se arma <hoja>.estados.css (los :hover, :active y
// :focus copiados como clases). Todo es de lectura sobre el repo de origen.
import { existsSync, globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postcss, { type Root } from 'postcss'
import { estadosDeCss } from '../../compartido/diseno/css'
import type { Paquete } from './paquete'

/** Las rutas absolutas de los archivos que el perfil no deja subir (perfil.excluir: globs dentro del repo). */
export function archivosExcluidos(repo: string, patrones: string[]): Set<string> {
  return new Set(patrones.flatMap((p) => globSync(p, { cwd: repo })).map((rel) => path.resolve(repo, rel)))
}

export interface HojaLeida {
  clave: string
  /** Ruta dentro del repo ("juego3d/ui/ui.css"). */
  archivo: string
  /** El árbol original (con posiciones), para el análisis de tokens. */
  raiz: Root
  texto: string
  reglas: number
}

const EXTENSIONES = new Set(['png', 'webp', 'jpg', 'jpeg', 'gif', 'svg', 'avif', 'woff2', 'woff', 'ttf', 'otf'])

export function leerHoja(repo: string, archivo: string, clave: string): HojaLeida {
  const texto = readFileSync(path.join(repo, archivo), 'utf8')
  const raiz = postcss.parse(texto, { from: undefined })
  let reglas = 0
  raiz.walkRules(() => {
    reglas++
  })
  return { clave, archivo, raiz, texto, reglas }
}

/** Una URL de una hoja → ruta del paquete (o null si no se puede). `excluidos`: rutas absolutas que el perfil no deja subir. */
export function resolverUrl(repo: string, desdeArchivo: string, url: string, paquete: Paquete, motivo: string, excluidos?: Set<string>): string | null {
  const u = url.trim().replace(/^['"]|['"]$/g, '')
  if (!u || u.startsWith('data:') || u.startsWith('#')) return u
  if (/^(https?:)?\/\//i.test(u)) {
    paquete.nota(`${motivo}: url de afuera (${u}) → se quita`)
    return null
  }
  const limpia = u.split(/[?#]/)[0]!
  const abs = path.resolve(path.dirname(path.join(repo, desdeArchivo)), decodeURIComponent(limpia))
  if (!abs.startsWith(path.resolve(repo) + path.sep) || !existsSync(abs)) {
    paquete.nota(`${motivo}: no existe ${u} → se quita`)
    return null
  }
  if (excluidos?.has(abs)) {
    paquete.nota(`${motivo}: ${u} está excluido por el perfil → se quita`)
    return null
  }
  const ext = path.extname(abs).slice(1).toLowerCase()
  if (!EXTENSIONES.has(ext)) {
    paquete.nota(`${motivo}: ${u} no es imagen ni fuente → se quita`)
    return null
  }
  return paquete.archivo(new Uint8Array(readFileSync(abs)), ext)
}

/** La hoja lista para subir: con su origen por regla, url() del paquete y su hoja de estados. */
export function procesarHoja(repo: string, h: HojaLeida, paquete: Paquete, excluidos?: Set<string>): { css: string; estados: string } {
  const raiz = h.raiz.clone()
  const nombre = path.basename(h.archivo)
  raiz.walkRules((regla) => {
    // las reglas de @keyframes (0%, from…) no llevan origen
    if (regla.parent?.type === 'atrule' && /keyframes/i.test((regla.parent as { name: string }).name)) return
    const linea = regla.source?.start?.line ?? 0
    regla.append({ prop: '--telar-origen', value: `"${nombre}:${linea}"` })
  })
  raiz.walkAtRules('font-face', (af) => {
    // en @font-face, si hay woff2 se queda solo ese (los .ttf de respaldo pesan y no hacen falta)
    af.walkDecls('src', (d) => {
      const partes = d.value.split(/,(?![^(]*\))/)
      const woff2 = partes.filter((p) => /woff2/i.test(p))
      if (woff2.length && woff2.length < partes.length) d.value = woff2.join(',')
    })
  })
  raiz.walkDecls((d) => {
    if (!/url\(/i.test(d.value)) return
    const linea = d.source?.start?.line ?? 0
    d.value = d.value.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_t, _q, u: string) => {
      const r = resolverUrl(repo, h.archivo, u, paquete, `${nombre}:${linea}`, excluidos)
      return r === null ? 'url("")' : `url("${r}")`
    })
    // un url("") que quedó en un src de fuente o en un fondo: se limpia para que el CSS siga válido
    if (/url\(""\)/.test(d.value) && (d.prop === 'src' || /^background(-image)?$/.test(d.prop))) d.value = d.value.replace(/url\(""\)\s*(format\([^)]*\))?/g, 'none')
  })
  const css = raiz.toString()
  return { css, estados: estadosDeCss(css) }
}
