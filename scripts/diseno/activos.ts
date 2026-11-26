// Paso 4: imágenes y fuentes. Tamaño por la cabecera del archivo (sin dependencias), peso, la ficha del índice si hay, y
// los usos: se busca el nombre entre comillas (o el archivo) en los archivos de `usos` del perfil.
import { globSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { medidasDeImagen, mimeDeExtension } from '../../compartido/diseno/imagen'
import type { Perfil } from '../../compartido/diseno/perfil'
import type { Uso } from '../../compartido/diseno/tipos'
import type { Paquete } from './paquete'

/** Índice de palabras de los archivos de usos: "btn-ok" → dónde aparece entre comillas (o como archivo). */
export function indiceDeUsos(repo: string, patrones: string[]): { porNombre: Map<string, Uso[]>; archivos: { ruta: string; lineas: string[] }[] } {
  const porNombre = new Map<string, Uso[]>()
  const archivos: { ruta: string; lineas: string[] }[] = []
  const vistos = new Set<string>()
  for (const patron of patrones)
    for (const rel of globSync(patron, { cwd: repo })) {
      if (vistos.has(rel)) continue
      vistos.add(rel)
      let texto: string
      try {
        if (statSync(path.join(repo, rel)).size > 2_000_000) continue
        texto = readFileSync(path.join(repo, rel), 'utf8')
      } catch {
        continue
      }
      const lineas = texto.split('\n')
      archivos.push({ ruta: rel, lineas })
      lineas.forEach((l, i) => {
        const nombres = new Set<string>()
        for (const m of l.matchAll(/(['"`])([\w./-]{2,80})\1/g)) {
          const v = m[2]!
          nombres.add(v)
          nombres.add(v.replace(/\.(png|webp|jpe?g|gif|svg)$/i, ''))
          nombres.add(path.basename(v).replace(/\.(png|webp|jpe?g|gif|svg)$/i, ''))
        }
        for (const m of l.matchAll(/([\w-]+)\.(png|webp|jpe?g|gif|svg)\b/gi)) nombres.add(m[1]!)
        for (const n of nombres) {
          const u = porNombre.get(n) ?? []
          if (u.length < 40) u.push({ archivo: rel, linea: i + 1 })
          porNombre.set(n, u)
        }
      })
    }
  return { porNombre, archivos }
}

/** El prefijo fijo de un patrón ("assets/rc/ui/platos/*.webp" → "assets/rc/ui/platos/"). */
const baseDe = (patron: string) => patron.slice(0, patron.search(/[*?{[]/) < 0 ? patron.length : patron.search(/[*?{[]/)).replace(/[^/]*$/, '')

function prefijoComun(bases: string[]): string {
  if (!bases.length) return ''
  let p = bases[0]!
  for (const b of bases) while (!b.startsWith(p)) p = p.slice(0, p.slice(0, -1).lastIndexOf('/') + 1)
  return p
}

export function leerActivos(
  repo: string,
  perfil: Perfil,
  paquete: Paquete,
  usos: Map<string, Uso[]>,
  excluidos: Set<string> = new Set(),
): { activos: number; fuentes: number; peso: number } {
  const raiz = prefijoComun(perfil.activos.map((a) => baseDe(a.patron)))
  let activos = 0
  let peso = 0
  let fuera = 0
  const vistos = new Set<string>()
  for (const entrada of perfil.activos) {
    let fichas: Record<string, { archivo?: string; w?: number; h?: number; origen?: string; nota?: string }> = {}
    if (entrada.indice) {
      const [archivoIndice, clave] = entrada.indice.split('#')
      try {
        const j = JSON.parse(readFileSync(path.join(repo, archivoIndice!), 'utf8'))
        const dentro = clave ? j[clave] : j
        for (const [nombre, f] of Object.entries(dentro ?? {})) fichas[nombre] = f as (typeof fichas)[string]
      } catch {
        paquete.nota(`no pude leer el índice ${entrada.indice}`)
        fichas = {}
      }
    }
    const porArchivo = new Map(Object.entries(fichas).map(([n, f]) => [f.archivo ?? n, { ...f, nombre: n }]))
    const archivos = globSync(entrada.patron, { cwd: repo }).sort()
    // grupos por prefijo (b-, btn-, flecha-…): solo los que tienen al menos 3
    const prefijos = new Map<string, number>()
    if (entrada.agruparPor === 'prefijo') for (const a of archivos) prefijos.set(path.basename(a).split('-')[0]!, (prefijos.get(path.basename(a).split('-')[0]!) ?? 0) + 1)
    for (const rel of archivos) {
      if (vistos.has(rel)) continue
      vistos.add(rel)
      if (excluidos.has(path.resolve(repo, rel))) {
        fuera++
        continue
      }
      const ext = path.extname(rel).slice(1).toLowerCase()
      if (!['png', 'webp', 'jpg', 'jpeg', 'gif', 'svg', 'avif'].includes(ext)) continue
      const bytes = new Uint8Array(readFileSync(path.join(repo, rel)))
      const m = medidasDeImagen(bytes)
      if (!m) {
        paquete.nota(`activo ${rel}: no es una imagen que se pueda leer`)
        continue
      }
      const clave = rel.startsWith(raiz) ? rel.slice(raiz.length).replace(/\.[a-z0-9]+$/i, '') : rel.replace(/\.[a-z0-9]+$/i, '')
      const base = path.basename(rel).replace(/\.[a-z0-9]+$/i, '')
      const ficha = porArchivo.get(path.basename(rel)) ?? porArchivo.get(rel.slice(raiz.length))
      const pre = base.split('-')[0]!
      const grupo = entrada.agruparPor === 'prefijo' && base.includes('-') && (prefijos.get(pre) ?? 0) >= 3 ? `${entrada.grupo} · ${pre}-` : entrada.agruparPor === 'carpeta' ? `${entrada.grupo} · ${path.dirname(rel).split('/').pop()}` : entrada.grupo
      const usosDe = [...(usos.get(clave) ?? []), ...(clave !== base ? usos.get(base) ?? [] : [])].filter((u, i, a) => a.findIndex((x) => x.archivo === u.archivo && x.linea === u.linea) === i)
      const ruta = paquete.archivo(bytes, ext)
      peso += bytes.byteLength
      activos++
      paquete.item({
        tipo: 'activo',
        clave,
        nombre: ficha?.nombre && ficha.nombre !== base ? ficha.nombre : base,
        grupo,
        datos: {
          ruta,
          mime: m.mime || mimeDeExtension(ext),
          ancho: m.ancho,
          alto: m.alto,
          peso: bytes.byteLength,
          nota: ficha?.nota,
          origen: ficha?.origen,
          usos: usosDe.slice(0, 30),
          archivo: rel,
        },
      })
    }
  }
  if (fuera) paquete.nota(`activos: ${fuera} imágenes excluidas por el perfil (no se suben)`)
  let fuentes = 0
  for (const f of perfil.fuentes) {
    if (excluidos.has(path.resolve(repo, f.archivo))) {
      paquete.nota(`fuente ${f.familia}: ${f.archivo} está excluida por el perfil → no se sube`)
      continue
    }
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(path.join(repo, f.archivo)))
    } catch {
      paquete.nota(`fuente ${f.familia}: no está ${f.archivo}`)
      continue
    }
    const ext = path.extname(f.archivo).slice(1).toLowerCase()
    const ruta = paquete.archivo(bytes, ext)
    peso += bytes.byteLength
    fuentes++
    paquete.item({
      tipo: 'fuente',
      clave: f.familia.toLowerCase().replace(/[^a-z0-9]+/g, '-') + (f.estilo === 'italic' ? '-italica' : ''),
      nombre: f.familia,
      grupo: 'Fuentes',
      datos: { familia: f.familia, ruta, pesos: f.pesos, estilo: f.estilo, licencia: f.licencia, archivo: f.archivo },
    })
  }
  return { activos, fuentes, peso }
}
