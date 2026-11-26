// El dibujo de un gráfico (SVG propio): barras, barras horizontales, líneas, área, torta, anillo y embudo. Recibe lo ya
// resuelto (compartido/grafico.ts) y el tamaño en px; la leyenda y el título son HTML aparte (Grafico.tsx). El color nunca
// va solo: cada serie y cada porción tiene su rótulo o su leyenda. Al pasar el mouse sale el valor (title del SVG).
import { formatearCelda } from '../../../../../compartido/tabla'
import type { DatosGrafico, GraficoResuelto } from '../../../../../compartido/grafico'
import { arco, centroArco, corto, escalaNice, recortar } from './dibujo'

const color = (c: string) => `var(--e-${c}-s)`
const numeroAR = (n: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n)

export function formatoValor(r: GraficoResuelto, n: number | null): string {
  if (n === null) return 'sin dato'
  return r.formato ? formatearCelda(r.formato, n) : numeroAR(n)
}

interface Props {
  g: DatosGrafico
  r: GraficoResuelto
  ancho: number
  alto: number
}

const LETRA = 11

export function DibujoGrafico({ g, r, ancho, alto }: Props) {
  if (!r.categorias.length || !r.series.length) return null
  const Comun = { width: ancho, height: alto, viewBox: `0 0 ${ancho} ${alto}`, role: 'img' as const, 'aria-hidden': true }
  switch (g.tipo) {
    case 'torta':
    case 'anillo':
      return <Torta g={g} r={r} {...Comun} />
    case 'embudo':
      return <Embudo g={g} r={r} {...Comun} />
    case 'lineas':
    case 'area':
      return <Lineas g={g} r={r} {...Comun} />
    case 'barras_h':
      return <BarrasH g={g} r={r} {...Comun} />
    default:
      return <Barras g={g} r={r} {...Comun} />
  }
}

type PropsSvg = Pick<Props, 'g' | 'r'> & { width: number; height: number; viewBox: string; role: 'img'; 'aria-hidden': boolean }

/** Cada categoría con la suma o el máximo de sus series (para la escala). */
function maximo(g: DatosGrafico, r: GraficoResuelto): { max: number; min: number } {
  const apilado = g.apilado && r.series.length > 1
  let max = 0
  let min = 0
  r.categorias.forEach((_, i) => {
    if (apilado) {
      const pos = r.series.reduce((s, x) => s + Math.max(x.valores[i] ?? 0, 0), 0)
      const neg = r.series.reduce((s, x) => s + Math.min(x.valores[i] ?? 0, 0), 0)
      max = Math.max(max, pos)
      min = Math.min(min, neg)
    } else
      for (const s of r.series) {
        max = Math.max(max, s.valores[i] ?? 0)
        min = Math.min(min, s.valores[i] ?? 0)
      }
  })
  return { max, min }
}

function Barras({ g, r, ...svg }: PropsSvg) {
  const { width: W, height: H } = svg
  const { max, min } = maximo(g, r)
  const esc = escalaNice(max, min)
  const mI = 46
  const mD = 10
  const mS = 14
  const mB = 26
  const anchoPlot = W - mI - mD
  const altoPlot = H - mS - mB
  const y = (v: number) => mS + altoPlot - ((v - esc.min) / (esc.max - esc.min || 1)) * altoPlot
  const banda = anchoPlot / r.categorias.length
  const apilado = g.apilado && r.series.length > 1
  const grupo = Math.min(banda * 0.72, 72 * r.series.length)
  const ancho = apilado ? grupo : grupo / r.series.length
  const unaSerie = r.series.length === 1
  return (
    <svg {...svg}>
      {esc.marcas.map((m) => (
        <g key={m}>
          <line x1={mI} x2={W - mD} y1={y(m)} y2={y(m)} className={m === 0 ? 'grafico__eje' : 'grafico__guia'} />
          <text x={mI - 6} y={y(m) + 3.5} textAnchor="end" className="grafico__rotulo">
            {corto(m)}
          </text>
        </g>
      ))}
      {r.categorias.map((cat, i) => {
        const x0 = mI + banda * i + (banda - grupo) / 2
        let acumP = 0
        let acumN = 0
        return (
          <g key={i}>
            {r.series.map((s, k) => {
              const v = s.valores[i]
              if (v === null || v === undefined) return null
              const c = unaSerie && r.coloresPorCategoria ? r.coloresCategoria[i]! : s.color
              let yb = y(Math.max(v, 0))
              let alto = Math.abs(y(v) - y(0))
              let x = x0 + (apilado ? 0 : k * ancho)
              if (apilado) {
                const base = v >= 0 ? acumP : acumN
                yb = y(v >= 0 ? base + v : base)
                alto = Math.abs(y(base + v) - y(base))
                if (v >= 0) acumP += v
                else acumN += v
                x = x0
              }
              const barra = (
                <rect key={k} x={x} y={yb} width={Math.max(ancho - (apilado ? 0 : 2), 1)} height={Math.max(alto, v === 0 ? 0 : 1)} rx={3} fill={color(c)}>
                  <title>{`${cat} · ${s.nombre}: ${formatoValor(r, v)}`}</title>
                </rect>
              )
              return barra
            })}
            {g.valores && !apilado && banda >= 26 &&
              r.series.map((s, k) => {
                const v = s.valores[i]
                if (v === null || v === undefined || ancho < 22) return null
                return (
                  <text key={`v${k}`} x={x0 + k * ancho + ancho / 2 - 1} y={(v >= 0 ? y(v) : y(0)) - 4} textAnchor="middle" className="grafico__valor">
                    {corto(v)}
                  </text>
                )
              })}
            <text x={mI + banda * i + banda / 2} y={H - 8} textAnchor="middle" className="grafico__rotulo">
              {recortar(cat, banda - 4, LETRA)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function BarrasH({ g, r, ...svg }: PropsSvg) {
  const { width: W, height: H } = svg
  const { max, min } = maximo(g, r)
  const esc = escalaNice(max, min)
  const largoEtiqueta = Math.min(130, Math.max(50, Math.max(...r.categorias.map((c) => c.length)) * 6.2))
  const mI = largoEtiqueta + 10
  const mD = 24
  const mS = 8
  const mB = 22
  const anchoPlot = W - mI - mD
  const altoPlot = H - mS - mB
  const x = (v: number) => mI + ((v - esc.min) / (esc.max - esc.min || 1)) * anchoPlot
  const banda = altoPlot / r.categorias.length
  const apilado = g.apilado && r.series.length > 1
  const grupo = Math.min(banda * 0.72, 40 * r.series.length)
  const alto = apilado ? grupo : grupo / r.series.length
  const unaSerie = r.series.length === 1
  return (
    <svg {...svg}>
      {esc.marcas.map((m) => (
        <g key={m}>
          <line y1={mS} y2={H - mB} x1={x(m)} x2={x(m)} className={m === 0 ? 'grafico__eje' : 'grafico__guia'} />
          <text x={x(m)} y={H - 6} textAnchor="middle" className="grafico__rotulo">
            {corto(m)}
          </text>
        </g>
      ))}
      {r.categorias.map((cat, i) => {
        const y0 = mS + banda * i + (banda - grupo) / 2
        let acum = 0
        return (
          <g key={i}>
            <text x={mI - 8} y={mS + banda * i + banda / 2 + 3.5} textAnchor="end" className="grafico__rotulo">
              {recortar(cat, largoEtiqueta, LETRA)}
            </text>
            {r.series.map((s, k) => {
              const v = s.valores[i]
              if (v === null || v === undefined) return null
              const c = unaSerie && r.coloresPorCategoria ? r.coloresCategoria[i]! : s.color
              const x1 = apilado ? x(acum) : x(Math.min(v, 0))
              const x2 = apilado ? x(acum + v) : x(Math.max(v, 0))
              if (apilado) acum += v
              return (
                <g key={k}>
                  <rect x={Math.min(x1, x2)} y={y0 + (apilado ? 0 : k * alto)} width={Math.max(Math.abs(x2 - x1), v === 0 ? 0 : 1)} height={Math.max(alto - (apilado ? 0 : 2), 1)} rx={3} fill={color(c)}>
                    <title>{`${cat} · ${s.nombre}: ${formatoValor(r, v)}`}</title>
                  </rect>
                  {g.valores && !apilado && banda >= 16 && (
                    <text x={Math.max(x1, x2) + 5} y={y0 + k * alto + alto / 2 + 3.5} className="grafico__valor">
                      {corto(v)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

function Lineas({ g, r, ...svg }: PropsSvg) {
  const { width: W, height: H } = svg
  const area = g.tipo === 'area'
  const apilado = area && g.apilado && r.series.length > 1
  const { max, min } = maximo({ ...g, apilado }, r)
  const esc = escalaNice(max, min)
  const mI = 46
  const mD = 16
  const mS = 14
  const mB = 26
  const anchoPlot = W - mI - mD
  const altoPlot = H - mS - mB
  const n = r.categorias.length
  const x = (i: number) => mI + (n === 1 ? anchoPlot / 2 : (anchoPlot * i) / (n - 1))
  const y = (v: number) => mS + altoPlot - ((v - esc.min) / (esc.max - esc.min || 1)) * altoPlot
  const salto = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(anchoPlot / 64))))
  const acum: number[] = r.categorias.map(() => 0)
  return (
    <svg {...svg}>
      {esc.marcas.map((m) => (
        <g key={m}>
          <line x1={mI} x2={W - mD} y1={y(m)} y2={y(m)} className={m === 0 ? 'grafico__eje' : 'grafico__guia'} />
          <text x={mI - 6} y={y(m) + 3.5} textAnchor="end" className="grafico__rotulo">
            {corto(m)}
          </text>
        </g>
      ))}
      {r.categorias.map((cat, i) =>
        i % salto === 0 ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="grafico__rotulo">
            {recortar(cat, Math.min(anchoPlot / Math.max(n / salto, 1), 90), LETRA)}
          </text>
        ) : null,
      )}
      {r.series.map((s, k) => {
        type Punto = { i: number; x: number; y: number }
        const puntos: (Punto | null)[] = r.categorias.map((_, i) => {
          const v = s.valores[i] ?? null
          const base = apilado ? acum[i]! : 0
          if (apilado && v !== null) acum[i] = base + v
          return v === null ? null : { i, x: x(i), y: y(base + v) }
        })
        const base = apilado ? r.categorias.map((_, i) => y(acum[i]! - (s.valores[i] ?? 0))) : null
        const tramos: Punto[][] = []
        let actual: Punto[] = []
        puntos.forEach((p) => {
          if (p) actual.push(p)
          else if (actual.length) {
            tramos.push(actual)
            actual = []
          }
        })
        if (actual.length) tramos.push(actual)
        return (
          <g key={k}>
            {tramos.map((t, j) => {
              const linea = t.map((p, idx) => `${idx ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
              const cierre = base
                ? [...t].reverse().map((p) => `L${p.x},${base[p.i]}`).join(' ')
                : `L${t[t.length - 1]!.x},${y(0)} L${t[0]!.x},${y(0)}`
              return (
                <g key={j}>
                  {area && <path d={`${linea} ${cierre} Z`} fill={color(s.color)} opacity={0.2} />}
                  <path d={linea} fill="none" stroke={color(s.color)} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              )
            })}
            {puntos.map((p, i) =>
              p ? (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={3.2} fill="var(--c-superficie)" stroke={color(s.color)} strokeWidth={2}>
                    <title>{`${r.categorias[i]} · ${s.nombre}: ${formatoValor(r, s.valores[i] ?? null)}`}</title>
                  </circle>
                  {g.valores && n <= 12 && !apilado && (
                    <text x={p.x} y={p.y - 8} textAnchor="middle" className="grafico__valor">
                      {corto(s.valores[i]!)}
                    </text>
                  )}
                </g>
              ) : null,
            )}
          </g>
        )
      })}
    </svg>
  )
}

function Torta({ g, r, ...svg }: PropsSvg) {
  const { width: W, height: H } = svg
  const serie = r.series[0]!
  const valores = r.categorias.map((_, i) => Math.max(serie.valores[i] ?? 0, 0))
  const total = valores.reduce((s, v) => s + v, 0)
  const radio = Math.max(Math.min(W, H) / 2 - 10, 20)
  const cx = W / 2
  const cy = H / 2
  const hueco = g.tipo === 'anillo' ? radio * 0.58 : 0
  if (total <= 0)
    return (
      <svg {...svg}>
        <text x={cx} y={cy} textAnchor="middle" className="grafico__rotulo">
          Todos los valores son 0
        </text>
      </svg>
    )
  let angulo = 0
  return (
    <svg {...svg}>
      {valores.map((v, i) => {
        const barrido = (v / total) * 360
        const desde = angulo
        angulo += barrido
        if (v <= 0) return null
        const c = r.coloresCategoria[i] ?? 'gris'
        const [tx, ty] = centroArco(cx, cy, hueco ? (radio + hueco) / 2 : radio * 0.65, desde, angulo)
        return (
          <g key={i}>
            <path d={arco(cx, cy, radio, hueco, desde, angulo)} fill={color(c)} stroke="var(--c-superficie)" strokeWidth={1.5}>
              <title>{`${r.categorias[i]}: ${formatoValor(r, v)} (${Math.round((v / total) * 100)} %)`}</title>
            </path>
            {g.valores && barrido >= 22 && (
              <text x={tx} y={ty + 4} textAnchor="middle" className="grafico__valor grafico__valor--sobre">
                {Math.round((v / total) * 100)} %
              </text>
            )}
          </g>
        )
      })}
      {hueco > 0 && (
        <g>
          <text x={cx} y={cy - 2} textAnchor="middle" className="grafico__total">
            {corto(total)}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" className="grafico__rotulo">
            total
          </text>
        </g>
      )}
    </svg>
  )
}

function Embudo({ g, r, ...svg }: PropsSvg) {
  const { width: W, height: H } = svg
  const serie = r.series[0]!
  const n = r.categorias.length
  const valores = r.categorias.map((_, i) => Math.max(serie.valores[i] ?? 0, 0))
  const maxV = Math.max(...valores, 1)
  const banda = (H - 8) / n
  const alto = Math.min(banda - 4, 56)
  return (
    <svg {...svg}>
      {valores.map((v, i) => {
        const w = Math.max((v / maxV) * (W - 16), 4)
        const x = (W - w) / 2
        const y = 4 + banda * i + (banda - alto) / 2
        const c = r.coloresCategoria[i] ?? 'azul'
        const pct = i > 0 && valores[i - 1]! > 0 ? ` (${Math.round((v / valores[i - 1]!) * 100)} % del paso anterior)` : ''
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={alto} rx={4} fill={color(c)}>
              <title>{`${r.categorias[i]}: ${formatoValor(r, v)}${pct}`}</title>
            </rect>
            {alto >= 16 && (
              <text x={W / 2} y={y + alto / 2 + 4} textAnchor="middle" className="grafico__valor grafico__valor--sobre">
                {recortar(r.categorias[i]!, w - 8, LETRA)}
                {g.valores && w > 90 ? ` · ${corto(v)}` : ''}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
