// Paso 5: los textos de la interfaz. Se importa el módulo de textos para tener los valores; se lee el archivo como texto
// para sacar la línea, el grupo (el comentario de título de arriba) y la clave original (`// [Clave]`); las funciones quedan
// como plantilla con su código. Los usos se buscan con el patrón del perfil (T.<clave>). También acepta JSON.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Perfil } from '../../compartido/diseno/perfil'
import type { Uso } from '../../compartido/diseno/tipos'
import type { Paquete } from './paquete'

export async function leerTextos(repo: string, perfil: Perfil, paquete: Paquete, archivosUsos: { ruta: string; lineas: string[] }[]): Promise<number> {
  let total = 0
  let orden = 0
  for (const t of perfil.textos) {
    let valores: Record<string, unknown> = {}
    let fuente = ''
    let archivo = ''
    if (t.modulo) {
      archivo = t.modulo
      fuente = readFileSync(path.join(repo, t.modulo), 'utf8')
      try {
        const mod = (await import(pathToFileURL(path.join(repo, t.modulo)).href)) as Record<string, unknown>
        valores = (mod[t.exporta] ?? mod.default ?? {}) as Record<string, unknown>
      } catch (e) {
        paquete.nota(`textos: no pude importar ${t.modulo} (${(e as Error).message.split('\n')[0]}); se leen del archivo`)
        for (const m of fuente.matchAll(/^\s*([A-Za-z_]\w*)\s*:\s*(['"`])((?:\\.|(?!\2).)*)\2/gm)) valores[m[1]!] = m[3]
      }
    } else if (t.json) {
      archivo = t.json
      fuente = readFileSync(path.join(repo, t.json), 'utf8')
      const plano = (o: Record<string, unknown>, pre = ''): Record<string, unknown> =>
        Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? Object.entries(plano(v as Record<string, unknown>, `${pre}${k}.`)) : [[`${pre}${k}`, v]])))
      valores = plano(JSON.parse(fuente))
    }
    // línea, grupo y clave original de cada clave
    const info = new Map<string, { linea: number; grupo: string; original?: string }>()
    let grupo = 'Generales'
    fuente.split('\n').forEach((l, i) => {
      const titulo = /^\s*\/\/\s*(.+?)\s*$/.exec(l)
      if (titulo && !/^\s*\w+\s*:/.test(l)) {
        grupo = titulo[1]!.replace(/\s*\[.*?\]\s*/g, ' ').replace(/[:.]+$/, '').trim().slice(0, 60) || grupo
        return
      }
      const m = /^\s*([A-Za-z_]\w*)\s*:/.exec(l)
      if (m && !info.has(m[1]!)) info.set(m[1]!, { linea: i + 1, grupo, original: /\/\/\s*\[([^\]]+)\]/.exec(l)?.[1] })
    })
    const patron = t.patronUso ? new RegExp(t.patronUso, 'g') : null
    const usos = new Map<string, Uso[]>()
    if (patron)
      for (const a of archivosUsos)
        a.lineas.forEach((l, i) => {
          for (const m of l.matchAll(patron)) {
            const lista = usos.get(m[1]!) ?? []
            if (lista.length < 30) lista.push({ archivo: a.ruta, linea: i + 1 })
            usos.set(m[1]!, lista)
          }
        })
    for (const [clave, v] of Object.entries(valores)) {
      const esFuncion = typeof v === 'function'
      if (!esFuncion && typeof v !== 'string') continue
      const datos = info.get(clave)
      total++
      paquete.item({
        tipo: 'texto',
        clave,
        nombre: clave,
        grupo: datos?.grupo ?? 'Generales',
        orden: `a${String(orden++).padStart(6, '0')}`,
        datos: {
          valor: esFuncion ? (v as (...a: unknown[]) => unknown).toString().slice(0, 600) : (v as string),
          plantilla: esFuncion || undefined,
          claveOriginal: datos?.original,
          grupo: datos?.grupo,
          archivo,
          linea: datos?.linea,
          usos: patron ? usos.get(clave) ?? [] : undefined,
        },
      })
    }
  }
  return total
}
