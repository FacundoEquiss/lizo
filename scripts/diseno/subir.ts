// Paso 8: sube el paquete a Telar con la clave (plan 5.5). Cada pedido pesa menos de 4 MB (el límite de Vercel): primero
// se pregunta qué archivos faltan, se suben de a uno (solo esos), después los lotes de ítems, páginas y marcos (de hasta
// 1 MB) y al final se termina: ahí Telar compara con lo vigente y guarda los cambios.
import type { Paquete } from './paquete'

export interface Destino {
  url: string
  prefijo: string
  clave: string
  autor?: string
}

export async function subirPaquete(p: Paquete, d: Destino, alcance: { tipos: string[]; marcos: boolean }, log: (m: string) => void) {
  const base = d.url.replace(/\/+$/, '')
  const cabeceras = { 'x-tablero-clave': d.clave, 'x-tablero-autor': d.autor ?? 'Importador de Diseño' }
  const pedir = async (ruta: string, cuerpo: unknown) => {
    const r = await fetch(`${base}/api/diseno/${encodeURIComponent(d.prefijo)}${ruta}`, {
      method: 'POST',
      headers: { ...cabeceras, 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
    const t = await r.text()
    if (!r.ok) throw new Error(`${ruta}: ${r.status} ${t.slice(0, 400)}`)
    return JSON.parse(t)
  }
  const archivos = [...p.archivos].map(([ruta, a]) => ({ ruta, hash: ruta.slice(0, 12), peso: a.bytes.byteLength }))
  const { n, faltan } = (await pedir('/importar/empezar', { origen: { ...p.origen, alcance }, archivos })) as { n: number; faltan: string[] }
  const subir = archivos.filter((a) => faltan.includes(a.hash))
  log(`importación ${n}: ${archivos.length} archivos, faltan ${subir.length} (${Math.round(subir.reduce((s, a) => s + a.peso, 0) / 1024)} KB)`)
  let hechos = 0
  const cola = [...subir]
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let a = cola.shift(); a; a = cola.shift()) {
        const f = new FormData()
        f.append('ruta', a.ruta)
        f.append('archivo', new Blob([p.archivos.get(a.ruta)!.bytes]), a.ruta)
        const r = await fetch(`${base}/api/diseno/${encodeURIComponent(d.prefijo)}/importar/archivo`, { method: 'POST', headers: cabeceras, body: f })
        if (!r.ok) throw new Error(`archivo ${a.ruta}: ${r.status} ${(await r.text()).slice(0, 300)}`)
        if (++hechos % 50 === 0) log(`  ${hechos}/${subir.length} archivos`)
      }
    }),
  )
  // lotes de hasta ~1 MB
  const TOPE = 950_000
  let lote: { items: unknown[]; paginas: unknown[]; marcos: unknown[] } = { items: [], paginas: [], marcos: [] }
  let largo = 0
  let lotes = 0
  const mandar = async () => {
    if (!lote.items.length && !lote.paginas.length && !lote.marcos.length) return
    await pedir('/importar/lote', { n, ...lote })
    lotes++
    lote = { items: [], paginas: [], marcos: [] }
    largo = 0
  }
  const sumar = async (tipo: 'items' | 'paginas' | 'marcos', x: unknown) => {
    const l = JSON.stringify(x).length
    if (l > 3_500_000) throw new Error(`Un ${tipo.slice(0, -1)} pesa ${Math.round(l / 1024)} KB: no entra en un pedido.`)
    if (largo + l > TOPE) await mandar()
    lote[tipo].push(x)
    largo += l
  }
  for (const pg of p.paginas) await sumar('paginas', pg)
  for (const it of p.items) await sumar('items', it)
  for (const m of p.marcos) await sumar('marcos', m)
  await mandar()
  const fin = (await pedir('/importar/terminar', { n })) as { n: number; cambios: number; nuevos: number; cambiados: number; quitados: number; resumen: Record<string, number>; detalle: { tipo: string; clave: string; que: string }[] }
  log(`${lotes} lotes · terminado: ${fin.cambios} cambios`)
  return fin
}
