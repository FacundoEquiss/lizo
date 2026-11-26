// npm run diseno:importar -- --proyecto RC --repo /ruta/al/repo [--destino https://telarapp.vercel.app] [--con-paginas]
//                            [--solo hojas,tokens,activos,textos,paginas] [--perfil archivo.json] [--pantallas hud,recetas]
// Importa el sistema de diseño de un proyecto desde su repo (plan 5.1). Todo es de LECTURA sobre el repo de origen: lee
// archivos y, solo con --con-paginas, abre sus pantallas en un navegador sin cabeza para sacar instantáneas.
// La clave: TABLERO_CLAVE en el entorno (online) o la de la carpeta de datos local. Nunca en el chat.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { globSync } from 'node:fs'
import { esquemaPerfil, type Perfil } from '../../compartido/diseno/perfil'
import { slug } from '../../compartido/texto'
import { indiceDeUsos, leerActivos } from './activos'
import { archivosExcluidos, leerHoja, procesarHoja, type HojaLeida } from './hojas'
import { Paquete } from './paquete'
import { sacarPaginas } from './paginas'
import { subirPaquete } from './subir'
import { leerTextos } from './textos'
import { analizarTokens } from './tokens'

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const args = process.argv.slice(2)
const opcion = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const bandera = (n: string) => args.includes(`--${n}`)
const log = (m: string) => console.log(`[diseño] ${m}`)

const prefijo = (opcion('proyecto') ?? '').toUpperCase()
const repo = path.resolve(opcion('repo') ?? '.')
if (!prefijo) {
  console.error('Falta --proyecto (el prefijo, por ejemplo RC).')
  process.exit(1)
}
if (!existsSync(repo)) {
  console.error(`No existe el repo ${repo}.`)
  process.exit(1)
}
const destino = (opcion('destino') ?? `http://127.0.0.1:${process.env.TABLERO_PUERTO || 4318}`).replace(/\/+$/, '')
const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(destino)
function claveLocal(): string {
  if (process.env.TABLERO_CLAVE) return process.env.TABLERO_CLAVE
  const carpeta = process.env.TABLERO_DATOS ? path.resolve(process.env.TABLERO_DATOS) : path.join(RAIZ, '.datos')
  const archivo = path.join(carpeta, 'clave-mcp.txt')
  if (existsSync(archivo)) return readFileSync(archivo, 'utf8').trim()
  throw new Error(`No encontré la clave: poné TABLERO_CLAVE en el entorno${local ? ` (o TABLERO_DATOS con la carpeta de datos de ese Telar)` : ''}.`)
}
const clave = claveLocal()
const pasos = (opcion('solo') ?? 'hojas,tokens,activos,textos,paginas').split(',').map((s) => s.trim())
const conPaginas = bandera('con-paginas') && pasos.includes('paginas')

async function api<T>(ruta: string): Promise<T> {
  const r = await fetch(`${destino}${ruta}`, { headers: { 'x-tablero-clave': clave } })
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  return (await r.json()) as T
}

// ── 1. perfil ──
async function cargarPerfil(): Promise<{ perfil: Perfil; de: string }> {
  const archivo = opcion('perfil')
  if (archivo) return { perfil: esquemaPerfil.parse(JSON.parse(readFileSync(path.resolve(archivo), 'utf8'))), de: archivo }
  try {
    const c = await api<{ perfil: unknown }>(`/api/diseno/${prefijo}/config`)
    if (c.perfil && Object.keys(c.perfil as object).length) return { perfil: esquemaPerfil.parse(c.perfil), de: 'Telar (guardado con sincronizar_diseno)' }
  } catch {
    // sigue
  }
  const propio = path.join(RAIZ, 'scripts/diseno/perfiles', `${prefijo}.json`)
  if (existsSync(propio)) return { perfil: esquemaPerfil.parse(JSON.parse(readFileSync(propio, 'utf8'))), de: path.relative(RAIZ, propio) }
  throw new Error(`No hay perfil para ${prefijo}: pasá --perfil, guardalo con sincronizar_diseno o creá scripts/diseno/perfiles/${prefijo}.json.`)
}

const git = (...a: string[]) => {
  try {
    return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const t0 = Date.now()
const { perfil, de } = await cargarPerfil()
log(`perfil de ${perfil.nombre} (${de}) · repo ${repo} · destino ${destino}`)
const resumen = await api<{ proyecto: { id: string } }>(`/api/diseno/${prefijo}`)
const paquete = new Paquete(resumen.proyecto.id, {
  repo: path.basename(repo),
  rama: git('rev-parse', '--abbrev-ref', 'HEAD') || undefined,
  commit: git('rev-parse', 'HEAD') || undefined,
  perfil: de,
  conPaginas,
})
const tiposDelPaso: Record<string, string[]> = { hojas: ['hoja'], tokens: ['token', 'color_suelto', 'estilo_texto'], activos: ['activo', 'fuente'], textos: ['texto'], paginas: ['pieza'] }
const tipos = pasos.flatMap((p) => tiposDelPaso[p] ?? []).filter((t) => t !== 'pieza' || conPaginas)
// lo que el perfil no deja subir (material que no puede salir del proyecto): ni en las hojas, ni como activo, ni en pantallas
const excluidos = archivosExcluidos(repo, perfil.excluir)
if (perfil.excluir.length) log(`excluidos por el perfil: ${excluidos.size} archivos (${perfil.excluir.join(', ')})`)

// las páginas que crea la importación (las de pantallas quedan vacías hasta sincronizarlas con --con-paginas)
paquete.paginas.push({ nombre: 'Fundamentos', slug: 'fundamentos', tipo: 'sistema', datos: { tipos: ['token', 'estilo_texto', 'color_suelto', 'fuente', 'hoja'] }, orden: 'a0' })
if (perfil.activos.length) paquete.paginas.push({ nombre: 'Íconos', slug: 'iconos', tipo: 'sistema', datos: { tipos: ['activo'] }, orden: 'a1' })
const lienzos = [...new Set(perfil.pantallas.flatMap((p) => p.vistas.map((v) => (p.pagina === '*' ? (v === 'pc' ? 'PC' : v === 'celular' ? 'Celular' : v) : p.pagina))))]
if (perfil.recetas) lienzos.unshift('Componentes')
lienzos.forEach((nombre, i) => paquete.paginas.push({ nombre, slug: slug(nombre), tipo: 'lienzo', datos: { vacia: 'pantallas' }, orden: `a${2 + i}` }))
if (perfil.textos.length) paquete.paginas.push({ nombre: 'Textos', slug: 'textos', tipo: 'tabla', datos: { tipos: ['texto'] }, orden: `a${2 + lienzos.length}` })

// ── 2 y 3. hojas y tokens ──
const hojasConocidas = new Map<string, string>()
const leidas: HojaLeida[] = []
for (const patron of perfil.hojas)
  for (const rel of globSync(patron, { cwd: repo }).sort()) {
    if (hojasConocidas.has(rel)) continue
    let claveHoja = path.basename(rel)
    if ([...hojasConocidas.values()].includes(claveHoja)) claveHoja = rel
    hojasConocidas.set(rel, claveHoja)
    leidas.push(leerHoja(repo, rel, claveHoja))
  }
if (pasos.includes('hojas') || pasos.includes('paginas'))
  for (const h of leidas) {
    const { css, estados } = procesarHoja(repo, h, paquete, excluidos)
    const ruta = paquete.archivo(new TextEncoder().encode(css), 'css')
    const rutaEstados = paquete.archivo(new TextEncoder().encode(estados), 'css')
    paquete.item({ tipo: 'hoja', clave: h.clave, nombre: h.clave, grupo: 'Hojas', datos: { ruta, rutaEstados, reglas: h.reglas, peso: css.length, archivo: h.archivo } })
  }
log(`hojas: ${leidas.length} (${leidas.reduce((s, h) => s + h.reglas, 0)} reglas, ${Math.round(leidas.reduce((s, h) => s + h.texto.length, 0) / 1024)} KB)`)
if (pasos.includes('tokens')) {
  const t = analizarTokens(leidas, perfil, paquete)
  log(`tokens: ${t.variables} variables, ${t.colores} colores escritos a mano, ${t.sueltos} valores sin nombre (tamaños, pesos, radios, sombras, movimiento), ${t.estilos} pares de texto con contorno`)
}

// ── 4 y 5. activos, fuentes y textos ──
const usos = indiceDeUsos(repo, perfil.usos)
if (pasos.includes('activos')) {
  const a = leerActivos(repo, perfil, paquete, usos.porNombre, excluidos)
  log(`activos: ${a.activos} imágenes y ${a.fuentes} fuentes (${(a.peso / 1024 / 1024).toFixed(1)} MB)`)
}
if (pasos.includes('textos')) {
  const n = await leerTextos(repo, perfil, paquete, usos.archivos)
  log(`textos: ${n}`)
}

// ── 6. pantallas y piezas ──
if (conPaginas) {
  log('pantallas: abro el proyecto en un navegador sin cabeza (solo lectura)…')
  const r = await sacarPaginas(repo, perfil, paquete, hojasConocidas, {
    recetas: perfil.recetas ? path.resolve(RAIZ, perfil.recetas) : undefined,
    solo: opcion('pantallas')?.split(','),
    log,
    excluidos,
  })
  log(`pantallas: ${r.pantallas} instantáneas, ${r.piezas} piezas${r.fallas.length ? ` · ${r.fallas.length} no se pudieron sacar` : ''}`)
  for (const f of r.fallas) paquete.nota(`no salió: ${f}`)
} else if (pasos.includes('paginas')) log('pantallas: no (sin --con-paginas; Componentes, Celular y PC quedan con "Falta sincronizar las pantallas")')

// ── 7 y 8. paquete y subida ──
paquete.origen.informe = paquete.informe.slice(0, 200)
const carpeta = path.join(RAIZ, '.datos', 'diseno-paquete', prefijo)
paquete.escribir(carpeta)
const peso = [...paquete.archivos.values()].reduce((s, a) => s + a.bytes.byteLength, 0)
log(`paquete: ${paquete.items.length} ítems, ${paquete.paginas.length} páginas, ${paquete.marcos.length} marcos, ${paquete.archivos.size} archivos (${(peso / 1024 / 1024).toFixed(1)} MB) → ${path.relative(RAIZ, carpeta)}`)
const fin = await subirPaquete(paquete, { url: destino, prefijo, clave }, { tipos, marcos: conPaginas }, log)
const cuenta = (t: string) => paquete.items.filter((i) => i.tipo === t).length
const informe = [
  `Importación ${fin.n} de ${perfil.nombre} lista en ${((Date.now() - t0) / 1000).toFixed(0)} s.`,
  `  tokens con nombre: ${paquete.items.filter((i) => i.tipo === 'token' && !(i.datos as { suelto?: boolean }).suelto).length} · valores sin nombre: ${paquete.items.filter((i) => i.tipo === 'token' && (i.datos as { suelto?: boolean }).suelto).length} · colores sueltos: ${cuenta('color_suelto')} · estilos de texto: ${cuenta('estilo_texto')}`,
  `  activos: ${cuenta('activo')} · fuentes: ${cuenta('fuente')} · hojas: ${cuenta('hoja')} · textos: ${cuenta('texto')} · piezas: ${cuenta('pieza')} · pantallas: ${paquete.marcos.filter((m) => m.clave.startsWith('pantalla:')).length}`,
  `  cambios: ${fin.cambios}${fin.cambios ? ` (${fin.nuevos} nuevos, ${fin.cambiados} cambiados, ${fin.quitados} quitados)` : ''}`,
  ...paquete.informe.slice(0, 40).map((x) => `  · ${x}`),
  paquete.informe.length > 40 ? `  · … y ${paquete.informe.length - 40} notas más (paquete.json)` : '',
  `Miralo en ${destino}/${prefijo} (Diseño).`,
].filter(Boolean)
console.log(informe.join('\n'))
