// Geometría de los gráficos (pura, sin React): escalas con marcas «redondas», números cortos y arcos. Sin biblioteca de
// gráficos: barras, líneas y torta son poca geometría y así el trozo del lienzo no engorda (~100 KB menos).

/** Marcas redondas del eje (0, 50, 100…) hasta un máximo que las contiene. */
export function escalaNice(maximo: number, minimo = 0, marcas = 5): { min: number; max: number; marcas: number[] } {
  const hasta = Math.max(maximo, 0)
  const desde = Math.min(minimo, 0)
  if (hasta === 0 && desde === 0) return { min: 0, max: 1, marcas: [0, 0.5, 1] }
  const rango = hasta - desde
  const paso0 = rango / marcas
  const pot = Math.pow(10, Math.floor(Math.log10(paso0)))
  const f = paso0 / pot
  const paso = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pot
  const min = Math.floor(desde / paso) * paso
  const max = Math.ceil(hasta / paso) * paso
  const lista: number[] = []
  for (let v = min; v <= max + paso / 1000; v += paso) lista.push(Math.round(v / paso) * paso)
  return { min, max, marcas: lista }
}

/** 1.234.567 → «1,2 M»; 12.500 → «12,5 mil»; 0,5 → «0,5». Para los ejes y los rótulos chicos. */
export function corto(n: number): string {
  const a = Math.abs(n)
  const f = (v: number, d: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: d }).format(v)
  if (a >= 1e9) return `${f(n / 1e9, 1)} MM`
  if (a >= 1e6) return `${f(n / 1e6, 1)} M`
  if (a >= 1e4) return `${f(n / 1e3, 1)} mil`
  return f(n, a < 10 ? 2 : 1)
}

/** Un texto recortado para que entre en `px` (con letra de ~`letra` px). */
export function recortar(t: string, px: number, letra = 11): string {
  const max = Math.max(1, Math.floor(px / (letra * 0.58)))
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1))}…`
}

const rad = (a: number) => (a * Math.PI) / 180

/** Una porción de torta o anillo (ángulos en grados desde las 12 en punto, en sentido horario). */
export function arco(cx: number, cy: number, radio: number, hueco: number, desde: number, hasta: number): string {
  const punto = (r: number, a: number) => [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))] as const
  if (hasta - desde >= 359.99) {
    // Círculo entero: dos medios arcos (un solo arco de 360° no se dibuja).
    const [x1, y1] = punto(radio, 0)
    const [x2, y2] = punto(radio, 180)
    const entero = `M${x1},${y1} A${radio},${radio} 0 1 1 ${x2},${y2} A${radio},${radio} 0 1 1 ${x1},${y1}`
    if (hueco <= 0) return `${entero} Z`
    const [h1x, h1y] = punto(hueco, 0)
    const [h2x, h2y] = punto(hueco, 180)
    return `${entero} M${h1x},${h1y} A${hueco},${hueco} 0 1 0 ${h2x},${h2y} A${hueco},${hueco} 0 1 0 ${h1x},${h1y} Z`
  }
  const grande = hasta - desde > 180 ? 1 : 0
  const [x1, y1] = punto(radio, desde)
  const [x2, y2] = punto(radio, hasta)
  if (hueco <= 0) return `M${cx},${cy} L${x1},${y1} A${radio},${radio} 0 ${grande} 1 ${x2},${y2} Z`
  const [x3, y3] = punto(hueco, hasta)
  const [x4, y4] = punto(hueco, desde)
  return `M${x1},${y1} A${radio},${radio} 0 ${grande} 1 ${x2},${y2} L${x3},${y3} A${hueco},${hueco} 0 ${grande} 0 ${x4},${y4} Z`
}

/** El punto medio de una porción (para su rótulo). */
export function centroArco(cx: number, cy: number, r: number, desde: number, hasta: number): [number, number] {
  const a = rad((desde + hasta) / 2)
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
}
