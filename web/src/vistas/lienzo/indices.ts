// Cálculos sobre todos los objetos del tablero, hechos una sola vez por cada versión de la lista (la lista cambia de
// referencia solo cuando cambia algo): cuántos objetos tiene cada marco y quién es el dueño de cada objeto.
import { marcoDe, ordenarMarcos } from '../../../../compartido/geometria'
import type { ElementoLienzo } from '../../../../compartido/tipos'

const cacheConteo = new WeakMap<readonly ElementoLienzo[], Map<string, number>>()
const cacheDuenos = new WeakMap<readonly ElementoLienzo[], Map<string, string>>()

/** Marco dueño de cada objeto (el más chico que contiene su centro). */
export function duenosDe(elementos: readonly ElementoLienzo[]): Map<string, string> {
  let m = cacheDuenos.get(elementos)
  if (m) return m
  m = new Map()
  const marcos = elementos.filter((e) => e.tipo === 'marco')
  if (marcos.length)
    for (const e of elementos) {
      const marco = marcoDe(e, marcos)
      if (marco) m.set(e.id, marco.id)
    }
  cacheDuenos.set(elementos, m)
  return m
}

/** Cuántos objetos (que no son marcos) tiene cada marco. */
export function conteoPorMarco(elementos: readonly ElementoLienzo[]): Map<string, number> {
  let m = cacheConteo.get(elementos)
  if (m) return m
  m = new Map()
  const duenos = duenosDe(elementos)
  for (const e of elementos) {
    if (e.tipo === 'marco') continue
    const d = duenos.get(e.id)
    if (d) m.set(d, (m.get(d) ?? 0) + 1)
  }
  cacheConteo.set(elementos, m)
  return m
}

const cacheOrden = new WeakMap<readonly ElementoLienzo[], ElementoLienzo[]>()

/**
 * Los marcos en orden (5.5): primero los que tienen un orden puesto a mano (en el panel), y después el de lectura: por
 * filas de arriba abajo y, dentro de una fila, de izquierda a derecha. Dos marcos están en la misma fila si sus centros
 * verticales difieren menos que la mitad del alto del más bajo.
 */
export function ordenDeMarcos(elementos: readonly ElementoLienzo[]): ElementoLienzo[] {
  let r = cacheOrden.get(elementos)
  if (r) return r
  r = ordenarMarcos(elementos.filter((e) => e.tipo === 'marco'))
  cacheOrden.set(elementos, r)
  return r
}

/** Lo que está adentro de un marco: lo que tiene el centro adentro (marcos más chicos incluidos, con lo suyo). */
export function contenidoDeMarco(elementos: readonly ElementoLienzo[], marco: ElementoLienzo, medida?: (e: ElementoLienzo) => { ancho: number; alto: number }) {
  return elementos.filter((e) => {
    if (e.id === marco.id) return false
    const m = medida?.(e) ?? e
    const cx = e.x + m.ancho / 2
    const cy = e.y + m.alto / 2
    if (cx <= marco.x || cx >= marco.x + marco.ancho || cy <= marco.y || cy >= marco.y + marco.alto) return false
    return !(e.tipo === 'marco' && e.ancho * e.alto >= marco.ancho * marco.alto)
  })
}

const cacheLectura = new WeakMap<readonly ElementoLienzo[], ElementoLienzo[]>()

/**
 * El orden en que se recorren los objetos con Tab (9.3): marco por marco (en el orden de los marcos), cada uno seguido
 * de lo que tiene adentro, y al final lo que está suelto. Adentro, por renglones de arriba abajo y de izquierda a derecha
 * (dos objetos van en el mismo renglón si sus centros difieren menos que la mitad del más bajo).
 */
export function ordenDeLectura(elementos: readonly ElementoLienzo[]): ElementoLienzo[] {
  let r = cacheLectura.get(elementos)
  if (r) return r
  const porRenglones = (es: ElementoLienzo[]) => {
    const medio = (e: ElementoLienzo) => e.y + e.alto / 2
    const renglones: ElementoLienzo[][] = []
    for (const e of [...es].sort((a, b) => medio(a) - medio(b))) {
      const renglon = renglones.find((f) => f.some((o) => Math.abs(medio(o) - medio(e)) < Math.min(o.alto, e.alto) / 2))
      if (renglon) renglon.push(e)
      else renglones.push([e])
    }
    return renglones.flatMap((f) => f.sort((a, b) => a.x - b.x))
  }
  const marcos = ordenDeMarcos(elementos)
  const vistos = new Set<string>()
  const salida: ElementoLienzo[] = []
  for (const m of marcos) {
    if (vistos.has(m.id)) continue
    // Un marco adentro de otro va con el de afuera.
    if (marcoDe(m, marcos) && !vistos.has(marcoDe(m, marcos)!.id)) continue
    vistos.add(m.id)
    salida.push(m)
    for (const e of porRenglones(contenidoDeMarco(elementos, m).filter((x) => !vistos.has(x.id)))) {
      vistos.add(e.id)
      salida.push(e)
    }
  }
  for (const m of marcos) if (!vistos.has(m.id)) (vistos.add(m.id), salida.push(m))
  salida.push(...porRenglones(elementos.filter((e) => !vistos.has(e.id))))
  cacheLectura.set(elementos, salida)
  return salida
}
