// Disposición automática del lienzo para lo que arma la IA (MCP `armar_en_lienzo`): varios objetos como un diagrama de
// flujo (por capas, siguiendo los conectores), en fila, en columna o en grilla, y el tamaño aproximado de un texto (el
// servidor no mide letras: estima, y la web muestra el real).

export type Disposicion = 'flujo' | 'fila' | 'columna' | 'grilla'

interface Tam {
  ancho: number
  alto: number
}

/**
 * Posiciones relativas (desde el rincón de arriba a la izquierda del grupo) para objetos de esos tamaños.
 * En fila quedan centrados en alto; en columna, centrados en ancho; en grilla, cada uno centrado en su celda.
 */
export function disponer(tams: Tam[], como: Disposicion, separacion: number, columnas?: number): { x: number; y: number }[] {
  if (!tams.length) return []
  if (como === 'fila') {
    const alto = Math.max(...tams.map((t) => t.alto))
    let x = 0
    return tams.map((t) => {
      const p = { x, y: Math.round((alto - t.alto) / 2) }
      x += t.ancho + separacion
      return p
    })
  }
  if (como === 'columna') {
    const ancho = Math.max(...tams.map((t) => t.ancho))
    let y = 0
    return tams.map((t) => {
      const p = { x: Math.round((ancho - t.ancho) / 2), y }
      y += t.alto + separacion
      return p
    })
  }
  const cols = Math.max(1, Math.min(tams.length, columnas ?? Math.ceil(Math.sqrt(tams.length))))
  const filas = Math.ceil(tams.length / cols)
  const anchos = Array.from({ length: cols }, (_, c) => Math.max(0, ...tams.filter((_, i) => i % cols === c).map((t) => t.ancho)))
  const altos = Array.from({ length: filas }, (_, f) => Math.max(0, ...tams.slice(f * cols, f * cols + cols).map((t) => t.alto)))
  return tams.map((t, i) => {
    const c = i % cols
    const f = Math.floor(i / cols)
    const x0 = anchos.slice(0, c).reduce((a, b) => a + b + separacion, 0)
    const y0 = altos.slice(0, f).reduce((a, b) => a + b + separacion, 0)
    return { x: x0 + Math.round((anchos[c]! - t.ancho) / 2), y: y0 + Math.round((altos[f]! - t.alto) / 2) }
  })
}

/** Ancho promedio de una letra, en "em" (Figtree a peso medio; las otras fuentes andan cerca). */
const LETRA = 0.56

/**
 * Tamaño aproximado de un texto de `px` con ese interlineado: cada renglón es una línea; si hay ancho máximo, los
 * renglones largos se parten. Alcanza para ubicar sin encimar (la web dibuja el tamaño real).
 */
export function medidaTexto(texto: string, px: number, interlineado: number, anchoMax?: number): Tam {
  const renglones = (texto || ' ').split('\n')
  const largo = (r: string) => Math.max(1, r.length) * px * LETRA
  let lineas = 0
  let ancho = 0
  for (const r of renglones) {
    const l = largo(r)
    if (anchoMax && l > anchoMax) {
      lineas += Math.ceil(l / anchoMax)
      ancho = anchoMax
    } else {
      lineas += 1
      ancho = Math.max(ancho, l)
    }
  }
  return { ancho: Math.ceil(ancho) + 8, alto: Math.ceil(lineas * px * interlineado) + 8 }
}

/**
 * Como un diagrama de flujo, de izquierda a derecha: cada objeto va en la columna de su paso (el camino más largo desde
 * un comienzo, siguiendo los conectores) y los de un mismo paso se apilan, ordenados como los anteriores para que las
 * líneas no se crucen. Las vueltas atrás (ciclos) no empujan columnas. Lo que no tiene conectores va al final.
 */
export function disponerFlujo(tams: Tam[], aristas: [number, number][], separacion: number): { x: number; y: number }[] {
  const n = tams.length
  const salen = Array.from({ length: n }, () => [] as number[])
  const entran = Array.from({ length: n }, () => [] as number[])
  for (const [a, b] of aristas) {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue
    salen[a]!.push(b)
    entran[b]!.push(a)
  }
  // Las aristas que cierran un ciclo (encontradas recorriendo en orden) no cuentan para las columnas.
  const estado = new Array<number>(n).fill(0)
  const atras = new Set<string>()
  const recorrer = (v: number) => {
    estado[v] = 1
    for (const w of salen[v]!) {
      if (estado[w] === 1) atras.add(`${v}>${w}`)
      else if (estado[w] === 0) recorrer(w)
    }
    estado[v] = 2
  }
  for (let v = 0; v < n; v++) if (estado[v] === 0 && entran[v]!.length === 0) recorrer(v)
  for (let v = 0; v < n; v++) if (estado[v] === 0) recorrer(v)
  const paso = new Array<number>(n).fill(-1)
  const calcular = (v: number): number => {
    if (paso[v]! >= 0) return paso[v]!
    paso[v] = 0
    let p = 0
    for (const u of entran[v]!) if (!atras.has(`${u}>${v}`)) p = Math.max(p, calcular(u) + 1)
    return (paso[v] = p)
  }
  const conectados = new Set(aristas.flat())
  for (let v = 0; v < n; v++) if (conectados.has(v)) calcular(v)
  const ultimo = Math.max(-1, ...paso)
  for (let v = 0; v < n; v++) if (paso[v]! < 0) paso[v] = ultimo + 1
  const columnas: number[][] = []
  for (let v = 0; v < n; v++) (columnas[paso[v]!] ??= []).push(v)
  // Dentro de cada columna, en el orden promedio de los que les llegan (así las líneas no se cruzan).
  const fila = new Array<number>(n).fill(0)
  for (const col of columnas) {
    if (!col) continue
    const peso = (v: number) => {
      const previos = entran[v]!.filter((u) => paso[u]! < paso[v]!)
      return previos.length ? previos.reduce((a, u) => a + fila[u]!, 0) / previos.length : v
    }
    col.sort((a, b) => peso(a) - peso(b) || a - b)
    col.forEach((v, i) => (fila[v] = i))
  }
  const anchos = columnas.map((c) => Math.max(0, ...(c ?? []).map((v) => tams[v]!.ancho)))
  const altos = columnas.map((c) => (c ?? []).reduce((a, v) => a + tams[v]!.alto, 0) + Math.max(0, (c?.length ?? 1) - 1) * separacion * 0.6)
  const altoTotal = Math.max(...altos)
  const pos = new Array<{ x: number; y: number }>(n)
  let x = 0
  columnas.forEach((col, c) => {
    if (!col) return
    let y = Math.round((altoTotal - altos[c]!) / 2)
    for (const v of col) {
      pos[v] = { x: x + Math.round((anchos[c]! - tams[v]!.ancho) / 2), y }
      y += tams[v]!.alto + separacion * 0.6
    }
    x += anchos[c]! + separacion
  })
  return pos
}
