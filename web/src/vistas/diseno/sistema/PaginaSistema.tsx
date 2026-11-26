// Páginas de sistema (plan 6.12): se dibujan solas en el mismo lienzo a partir de los ítems, un nodo por sección.
// Cada muestra lleva data-item="<tipo>:<clave>" (la selección y el inspector la encuentran). Las fuentes del proyecto se
// cargan con FontFace bajo un nombre propio (dz-<proyecto>-<Familia>) para no chocar con las de Telar.
import type { Node, NodeProps } from '@xyflow/react'
import { memo, useEffect, useMemo } from 'react'
import { acomodar } from '../../../../../compartido/diseno/acomodar'
import { aHsl, aRgb, luminancia, variableDeToken } from '../../../../../compartido/diseno/tokens'
import type { DatosActivo, DatosColorSuelto, DatosEstiloTexto, DatosFuente, DatosHoja, DatosTexto, DatosToken, ItemDiseno, PaginaDiseno, ResumenDiseno, TipoItem } from '../../../../../compartido/diseno/tipos'
import { SIN_ITEMS, useDiseno } from '../estado'

export type Seccion =
  | 'variables'
  | 'otras'
  | 'sueltos'
  | 'familias'
  | 'escala'
  | 'estilos'
  | 'radios'
  | 'sombras'
  | 'movimiento'
  | 'unidades'
  | 'salud'
  | 'hojas'
  | 'activos'

export interface DatosNodoSistema extends Record<string, unknown> {
  seccion: Seccion
  titulo: string
  bajada: string
  items: ItemDiseno[]
  grupo?: string
  ancho: number
  alto: number
}
export type NodoSistema = Node<DatosNodoSistema, 'marcoSistema'>

const tipo = <T extends TipoItem>(items: ItemDiseno[], t: T) => items.filter((i) => i.tipo === t) as ItemDiseno<T>[]
const fuentesCargadas = new Set<string>()

/** Carga las fuentes del proyecto con un nombre propio. Devuelve "familia original → nombre cargado". */
export function usarFuentesDelProyecto(fuentes: ItemDiseno<'fuente'>[], proyecto: string): Map<string, string> {
  const mapa = useMemo(() => new Map(fuentes.map((f) => [f.datos.familia, `dz-${proyecto}-${f.datos.familia}`])), [fuentes, proyecto])
  useEffect(() => {
    for (const f of fuentes) {
      const nombre = `dz-${proyecto}-${f.datos.familia}`
      const clave = `${nombre}|${f.datos.ruta}|${f.datos.estilo ?? ''}`
      if (fuentesCargadas.has(clave) || !f.datos.ruta) continue
      fuentesCargadas.add(clave)
      const ff = new FontFace(nombre, `url(${f.datos.ruta})`, { weight: f.datos.pesos || '400', style: f.datos.estilo === 'italic' ? 'italic' : 'normal' })
      ff.load()
        .then((x) => document.fonts.add(x))
        .catch(() => fuentesCargadas.delete(clave))
    }
  }, [fuentes, proyecto])
  return mapa
}

/** La familia de un valor de font-family del proyecto, con la fuente cargada si la hay. */
export function familiaCargada(valor: string, mapa: Map<string, string>): string {
  const primera = valor.split(',')[0]!.trim().replace(/^["']|["']$/g, '')
  const cargada = mapa.get(primera)
  return cargada ? `"${cargada}", ${valor}` : valor
}

// ───────── armado de los nodos ─────────

const COL = 1480
/** Ancho de un grupo de colores: sus tarjetas (120) con 16 de separación, hasta 10 por fila. */
export const anchoGrupoColores = (n: number) => Math.min(Math.max(n, 2), 10) * 136 - 16

export function nodosDeSistema(pagina: PaginaDiseno, todos: Partial<Record<TipoItem, ItemDiseno[]>>, resumen: ResumenDiseno | null): NodoSistema[] {
  const tipos = pagina.datos.tipos ?? []
  const items = tipos.flatMap((t) => todos[t] ?? [])
  const secciones: DatosNodoSistema[] = []
  const tokens = tipo(items, 'token')
  const nombrados = tokens.filter((t) => !t.datos.suelto)
  const colores = nombrados.filter((t) => t.datos.clase === 'color')
  const otras = nombrados.filter((t) => t.datos.clase !== 'color')
  const sueltos = tokens.filter((t) => t.datos.suelto)
  const filas = (n: number, porFila: number, altoFila: number) => Math.ceil(n / porFila) * altoFila
  if (tipos.includes('token')) {
    if (colores.length) {
      const grupos = new Map<string, number>()
      for (const c of colores) grupos.set(c.grupo, (grupos.get(c.grupo) ?? 0) + 1)
      // los grupos chicos comparten fila (como en el CSS: cada grupo mide lo que sus tarjetas)
      let alto = 120
      let usado = 0
      let altoFila = 0
      for (const n of grupos.values()) {
        const ancho = anchoGrupoColores(n) + 40
        if (usado + ancho > COL - 80 + 40 && usado > 0) {
          alto += altoFila
          usado = 0
          altoFila = 0
        }
        usado += ancho
        altoFila = Math.max(altoFila, 44 + filas(n, 10, 124))
      }
      alto += altoFila
      secciones.push({ seccion: 'variables', titulo: 'Color · Variables', bajada: `${colores.length} colores con nombre, por colección`, items: colores, ancho: COL, alto })
    }
    if (otras.length) secciones.push({ seccion: 'otras', titulo: 'Medidas y otros tokens', bajada: `${otras.length} tokens con nombre`, items: otras, ancho: COL, alto: 140 + filas(otras.length, 3, 46) })
  }
  if (tipos.includes('color_suelto')) {
    const s = tipo(items, 'color_suelto')
    if (s.length) {
      const grupos = new Map<string, number>()
      for (const c of s) grupos.set(c.grupo, (grupos.get(c.grupo) ?? 0) + 1)
      const alto = 120 + [...grupos.values()].reduce((t, n) => t + 40 + filas(n, 20, 70), 0)
      secciones.push({ seccion: 'sueltos', titulo: 'Color · Sueltos', bajada: `${s.length} colores escritos a mano en el código, por familia (la esquina dice cuántas veces se usan)`, items: s, ancho: COL, alto })
    }
  }
  if (tipos.includes('fuente')) {
    const f = tipo(items, 'fuente')
    const pesos = sueltos.filter((t) => t.clave.startsWith('font-weight:'))
    if (f.length) secciones.push({ seccion: 'familias', titulo: 'Tipografía · Familias', bajada: `${f.length} familias del proyecto`, items: [...f, ...pesos], ancho: COL, alto: 120 + filas(f.length, 2, 380) })
  }
  const tamanos = sueltos.filter((t) => t.clave.startsWith('font-size:'))
  if (tamanos.length) {
    const alto = 120 + tamanos.reduce((s, t) => s + Math.max(40, Math.min(140, tamanoPx(t.datos.valor) * 1.3)) + 8, 0)
    secciones.push({ seccion: 'escala', titulo: 'Tipografía · Escala', bajada: `${tamanos.length} tamaños de letra, de mayor a menor`, items: tamanos, ancho: COL, alto: Math.min(alto, 9000) })
  }
  if (tipos.includes('estilo_texto')) {
    const e = tipo(items, 'estilo_texto')
    if (e.length) secciones.push({ seccion: 'estilos', titulo: 'Tipografía · Estilos de texto', bajada: `${e.length} estilos (y pares de relleno y contorno)`, items: e, ancho: COL, alto: 120 + filas(e.length, 3, 120) })
  }
  const radios = tokens.filter((t) => t.datos.clase === 'radio')
  if (radios.length) secciones.push({ seccion: 'radios', titulo: 'Radios', bajada: `${radios.length} radios de borde, por uso`, items: radios, ancho: COL, alto: 120 + filas(radios.length, 10, 150) })
  const sombras = tokens.filter((t) => t.datos.clase === 'sombra')
  if (sombras.length) secciones.push({ seccion: 'sombras', titulo: 'Sombras', bajada: `${sombras.length} sombras, por uso`, items: sombras, ancho: COL, alto: 120 + filas(sombras.length, 6, 190) })
  const mov = tokens.filter((t) => ['duracion', 'curva', 'animacion'].includes(t.datos.clase))
  if (mov.length) secciones.push({ seccion: 'movimiento', titulo: 'Movimiento', bajada: 'Duraciones y curvas (pasá el mouse para verlas) y las animaciones', items: mov, ancho: COL, alto: 160 + filas(mov.filter((m) => m.datos.clase !== 'animacion').length, 4, 96) + filas(mov.filter((m) => m.datos.clase === 'animacion').length, 4, 44) })
  if (tipos.includes('token') && resumen && Object.keys(resumen.unidades).length)
    secciones.push({ seccion: 'unidades', titulo: 'Unidades', bajada: 'Qué es cada unidad del proyecto', items: [], ancho: COL, alto: 140 + Object.keys(resumen.unidades).length * 44 })
  if (tipos.includes('hoja')) {
    const h = tipo(items, 'hoja')
    if (h.length) secciones.push({ seccion: 'hojas', titulo: 'Hojas de estilo', bajada: `${h.length} hojas importadas del código`, items: h, ancho: COL, alto: 130 + h.length * 44 })
  }
  if (tipos.includes('color_suelto') && tipo(items, 'color_suelto').length)
    secciones.unshift({ seccion: 'salud', titulo: 'Salud del sistema', bajada: 'Lo que conviene ordenar en el código. Cada punto se puede volver tarjeta.', items: [], ancho: COL, alto: 330 })
  if (tipos.includes('activo')) {
    const a = tipo(items, 'activo')
    const grupos = new Map<string, ItemDiseno<'activo'>[]>()
    for (const x of a) {
      if (!grupos.has(x.grupo)) grupos.set(x.grupo, [])
      grupos.get(x.grupo)!.push(x)
    }
    for (const [g, lista] of grupos) secciones.push({ seccion: 'activos', titulo: g || 'Activos', bajada: `${lista.length} ${lista.length === 1 ? 'imagen' : 'imágenes'}`, items: lista, grupo: g, ancho: COL, alto: 110 + filas(lista.length, 12, 124) })
  }
  if (!secciones.length) return []
  // una columna, como un documento: el encuadre de entrada (ancho de la columna) deja todo legible
  const lugares = acomodar(secciones.map((s, i) => ({ id: String(i), seccion: '', ancho: s.ancho, alto: s.alto })), { anchoFila: COL, separacion: 96 })
  return secciones.map((s, i) => ({
    id: `sis-${s.seccion}-${i}`,
    type: 'marcoSistema',
    position: lugares.get(String(i))!,
    data: s,
    width: s.ancho,
    height: s.alto,
    draggable: false,
    selectable: false,
  }))
}

/** "calc(var(--hu) * 19)" → 19; "18px" → 18; "1.2em" → 19 (aprox.). */
export function tamanoPx(v: string): number {
  const m = /([\d.]+)\s*\)?\s*$/.exec(v.replace(/px/g, ''))
  const n = m ? parseFloat(m[1]!) : 16
  if (/em\b/.test(v)) return n * 16
  return Math.max(6, Math.min(140, n || 16))
}

// ───────── el nodo ─────────

export const MarcoSistemaNodo = memo(function MarcoSistemaNodo({ data }: NodeProps<NodoSistema>) {
  const resumen = useDiseno((s) => s.resumen)
  const fuentes = useDiseno((s) => (s.items.fuente ?? SIN_ITEMS) as ItemDiseno<'fuente'>[])
  const mapa = usarFuentesDelProyecto(fuentes, resumen?.proyecto.id ?? 'p')
  return (
    <div className="dz-sis" style={{ width: data.ancho, minHeight: data.alto }}>
      <header className="dz-sis__cab">
        <h2>{data.titulo}</h2>
        <p>{data.bajada}</p>
      </header>
      <Contenido data={data} mapa={mapa} />
    </div>
  )
})

function Contenido({ data, mapa }: { data: DatosNodoSistema; mapa: Map<string, string> }) {
  switch (data.seccion) {
    case 'variables':
      return <Variables items={data.items as ItemDiseno<'token'>[]} />
    case 'otras':
      return <Otras items={data.items as ItemDiseno<'token'>[]} />
    case 'sueltos':
      return <Sueltos items={data.items as ItemDiseno<'color_suelto'>[]} />
    case 'familias':
      return <Familias items={data.items} mapa={mapa} />
    case 'escala':
      return <Escala items={data.items as ItemDiseno<'token'>[]} mapa={mapa} />
    case 'estilos':
      return <Estilos items={data.items as ItemDiseno<'estilo_texto'>[]} mapa={mapa} />
    case 'radios':
      return <Radios items={data.items as ItemDiseno<'token'>[]} />
    case 'sombras':
      return <Sombras items={data.items as ItemDiseno<'token'>[]} />
    case 'movimiento':
      return <Movimiento items={data.items as ItemDiseno<'token'>[]} />
    case 'unidades':
      return <Unidades />
    case 'salud':
      return <Salud />
    case 'hojas':
      return <Hojas items={data.items as ItemDiseno<'hoja'>[]} />
    case 'activos':
      return <Activos items={data.items as ItemDiseno<'activo'>[]} />
  }
}

const marcaNuevo = (i: ItemDiseno) => (i.nuevo ? <span className="dz-sis__nuevo" title="Cambió en la última sincronización" /> : null)
const textoSobre = (hex: string) => {
  const c = aRgb(hex)
  return c && luminancia(c) > 0.45 ? '#1b1a18' : '#ffffff'
}

function agrupar<T extends ItemDiseno>(items: T[]): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const i of items) {
    if (!m.has(i.grupo)) m.set(i.grupo, [])
    m.get(i.grupo)!.push(i)
  }
  return [...m]
}

function Variables({ items }: { items: ItemDiseno<'token'>[] }) {
  return (
    <div className="dz-sis__cuerpo dz-grupos-en-fila">
      {agrupar(items).map(([g, lista]) => (
        <section key={g} className="dz-sis__grupo" style={{ width: anchoGrupoColores(lista.length) }}>
          <h3 title={g}>{g.replace(/^Variables · /, '')}</h3>
          <div className="dz-colores">
            {lista.map((t) => {
              const oscuro = t.datos.modos?.oscuro
              return (
                <div key={t.clave} className="dz-color" data-item={`token:${t.clave}`}>
                  <div className="dz-color__muestra" style={{ background: oscuro ? `linear-gradient(135deg, ${t.datos.valor} 50%, ${oscuro} 50%)` : t.datos.valor }}>
                    {marcaNuevo(t)}
                  </div>
                  <div className="dz-color__nombre" title={t.clave}>
                    {t.nota?.nombrePropio || (t.origen === 'importado' ? t.clave : t.clave.split('/').pop())}
                  </div>
                  <div className="dz-color__valor">{t.datos.alias ? `→ ${t.datos.alias}` : t.datos.valor}</div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function Otras({ items }: { items: ItemDiseno<'token'>[] }) {
  return (
    <div className="dz-sis__cuerpo dz-otras">
      {items.map((t) => (
        <div key={t.clave} className="dz-fila-token" data-item={`token:${t.clave}`}>
          <span className="dz-fila-token__nombre">{t.origen === 'importado' ? t.clave : t.clave}</span>
          <span className="dz-fila-token__var">{t.origen === 'importado' ? '' : `var(${t.datos.css || variableDeToken(t.clave)})`}</span>
          <span className="dz-fila-token__valor">{t.datos.valor}</span>
          {t.datos.clase === 'medida' && /^\d+(\.\d+)?px$/.test(t.datos.valor) && <span className="dz-fila-token__barra" style={{ width: Math.min(160, parseFloat(t.datos.valor)) }} />}
        </div>
      ))}
    </div>
  )
}

function Sueltos({ items }: { items: ItemDiseno<'color_suelto'>[] }) {
  const ordenados = useMemo(() => {
    const porGrupo = agrupar(items)
    return porGrupo.map(([g, l]) => [g, [...l].sort((a, b) => {
      const [ha, sa, la] = aHsl(a.datos.rgb)
      const [hb, sb, lb] = aHsl(b.datos.rgb)
      return Math.round(ha / 20) - Math.round(hb / 20) || lb - la || sb - sa
    })] as [string, ItemDiseno<'color_suelto'>[]])
  }, [items])
  return (
    <div className="dz-sis__cuerpo">
      {ordenados.map(([g, lista]) => (
        <section key={g} className="dz-sis__grupo">
          <h3>
            {g} <small>{lista.length}</small>
          </h3>
          <div className="dz-fichas">
            {lista.map((c) => {
              const d: DatosColorSuelto = c.datos
              return (
                <div
                  key={c.clave}
                  className="dz-ficha"
                  data-item={`color_suelto:${c.clave}`}
                  style={{ background: d.valor, color: textoSobre(d.valor) }}
                  title={`${d.valor} · ${d.veces} usos${d.igualA ? ` · = ${d.igualA}` : ''}${d.cercaDe ? ` · a un paso de ${d.cercaDe}` : ''}`}
                >
                  <span className="dz-ficha__usos">{d.veces}</span>
                  {d.igualA && <span className="dz-ficha__nombre">{d.igualA}</span>}
                  {d.cercaDe && <span className="dz-ficha__cerca" />}
                  {marcaNuevo(c)}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

const ABC = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnÑñOoPpQqRrSsTtUuVvWwXxYyZz'
function Familias({ items, mapa }: { items: ItemDiseno[]; mapa: Map<string, string> }) {
  const fuentes = items.filter((i) => i.tipo === 'fuente') as ItemDiseno<'fuente'>[]
  const pesosUsados = items.filter((i) => i.tipo === 'token').map((t) => Number((t as ItemDiseno<'token'>).datos.valor)).filter((n) => n >= 100 && n <= 1000)
  const pesos = [...new Set(pesosUsados.length ? pesosUsados : [400, 700])].sort((a, b) => a - b).slice(0, 8)
  const nombre = useDiseno((s) => s.resumen?.proyecto.nombre ?? 'Telar')
  return (
    <div className="dz-sis__cuerpo dz-familias">
      {fuentes.map((f) => {
        const d: DatosFuente = f.datos
        const fam = familiaCargada(`"${d.familia}"`, mapa)
        return (
          <div key={f.clave} className="dz-familia" data-item={`fuente:${f.clave}`}>
            <div className="dz-familia__aa" style={{ fontFamily: fam }}>
              Aa
            </div>
            <div className="dz-familia__datos">
              <b>{d.familia}</b>
              <span>
                pesos {d.pesos} · {d.licencia ?? 'sin licencia anotada'}
              </span>
            </div>
            <div className="dz-familia__abc" style={{ fontFamily: fam }}>
              {ABC}
            </div>
            <div className="dz-familia__abc" style={{ fontFamily: fam }}>
              0123456789 ¡¿?! $ % & @ — «»
            </div>
            <div className="dz-familia__pesos">
              {pesos.map((p) => (
                <div key={p} style={{ fontFamily: fam, fontWeight: p }}>
                  <small>{p}</small> {nombre} 71.096
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Escala({ items, mapa }: { items: ItemDiseno<'token'>[]; mapa: Map<string, string> }) {
  const fuentes = useDiseno((s) => (s.items.fuente ?? SIN_ITEMS) as ItemDiseno<'fuente'>[])
  const fam = fuentes[0] ? familiaCargada(`"${fuentes[0].datos.familia}"`, mapa) : undefined
  const orden = useMemo(() => [...items].sort((a, b) => tamanoPx(b.datos.valor) - tamanoPx(a.datos.valor)), [items])
  const nombre = useDiseno((s) => s.resumen?.proyecto.nombre ?? 'Telar')
  return (
    <div className="dz-sis__cuerpo dz-escala">
      {orden.map((t) => {
        const px = tamanoPx(t.datos.valor)
        return (
          <div key={t.clave} className="dz-escala__fila" data-item={`token:${t.clave}`}>
            <div className="dz-escala__dato">
              <b>{t.datos.unidad ?? t.datos.valor}</b>
              <span>
                {Math.round(px * 10) / 10} px · {t.datos.veces ?? 0} usos
              </span>
            </div>
            <div className="dz-escala__muestra" style={{ fontSize: px, fontFamily: fam }}>
              {nombre} 1.234
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Estilos({ items, mapa }: { items: ItemDiseno<'estilo_texto'>[]; mapa: Map<string, string> }) {
  return (
    <div className="dz-sis__cuerpo dz-estilos">
      {items.map((e) => {
        const d: DatosEstiloTexto = e.datos
        const tam = d.tamano && !/var\(/.test(d.tamano) ? d.tamano : '30px'
        return (
          <div key={e.clave} className="dz-estilo" data-item={`estilo_texto:${e.clave}`}>
            <div
              className={`dz-estilo__muestra${d.contorno ? ' dz-estilo__muestra--contorno' : ''}`}
              style={{
                fontFamily: familiaCargada(`"${d.familia}"`, mapa),
                fontWeight: d.peso,
                fontSize: tam,
                lineHeight: d.interlineado,
                letterSpacing: d.espaciado,
                textTransform: d.mayusculas ? 'uppercase' : undefined,
                color: d.color,
                ['--borde' as string]: d.contorno?.color,
              }}
            >
              {d.contorno ? '71.096' : e.nombre}
            </div>
            <div className="dz-estilo__dato">
              {d.contorno ? `${d.color} con borde ${d.contorno.color}` : `${d.familia} ${d.peso} · ${d.tamano}/${d.interlineado}`}
              {d.veces ? ` · ${d.veces} usos` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Radios({ items }: { items: ItemDiseno<'token'>[] }) {
  const orden = useMemo(() => [...items].sort((a, b) => (b.datos.veces ?? 0) - (a.datos.veces ?? 0)), [items])
  return (
    <div className="dz-sis__cuerpo dz-radios">
      {orden.map((t) => (
        <div key={t.clave} className="dz-radio" data-item={`token:${t.clave}`}>
          <div className="dz-radio__muestra" style={{ borderRadius: /var\(--/.test(t.datos.valor) ? t.datos.valor.replace(/var\(--[\w-]+\)/g, '1px') : t.datos.valor }} />
          <div className="dz-radio__dato">{t.datos.unidad ?? t.datos.valor}</div>
          <div className="dz-radio__usos">{t.datos.veces ?? 0} usos</div>
        </div>
      ))}
    </div>
  )
}

const sinUnidades = (v: string) => v.replace(/calc\(\s*var\(--[\w-]+\)\s*\*\s*([\d.]+)\s*\)/g, '$1px').replace(/var\(--[\w-]+,?\s*([^)]*)\)/g, '$1')

function Sombras({ items }: { items: ItemDiseno<'token'>[] }) {
  const orden = useMemo(() => [...items].sort((a, b) => (b.datos.veces ?? 0) - (a.datos.veces ?? 0)), [items])
  return (
    <div className="dz-sis__cuerpo dz-sombras">
      {orden.map((t) => (
        <div key={t.clave} className="dz-sombra" data-item={`token:${t.clave}`}>
          <div className={`dz-sombra__muestra${t.clave.startsWith('text-shadow') ? ' dz-sombra__muestra--texto' : ''}`} style={t.clave.startsWith('text-shadow') ? { textShadow: sinUnidades(t.datos.valor) } : { boxShadow: sinUnidades(t.datos.valor) }}>
            {t.clave.startsWith('text-shadow') ? 'Aa' : ''}
          </div>
          <div className="dz-sombra__dato" title={t.datos.valor}>
            {t.datos.valor}
          </div>
          <div className="dz-sombra__usos">{t.datos.veces ?? 0} usos</div>
        </div>
      ))}
    </div>
  )
}

function Movimiento({ items }: { items: ItemDiseno<'token'>[] }) {
  const duraciones = items.filter((i) => i.datos.clase === 'duracion').sort((a, b) => parseFloat(a.datos.valor) * (/ms/.test(a.datos.valor) ? 1 : 1000) - parseFloat(b.datos.valor) * (/ms/.test(b.datos.valor) ? 1 : 1000))
  const curvas = items.filter((i) => i.datos.clase === 'curva')
  const anims = items.filter((i) => i.datos.clase === 'animacion')
  return (
    <div className="dz-sis__cuerpo">
      <section className="dz-sis__grupo">
        <h3>Duraciones y curvas</h3>
        <div className="dz-movs">
          {[...duraciones, ...curvas].map((t) => (
            <div key={t.clave} className="dz-mov" data-item={`token:${t.clave}`} style={{ ['--dur' as string]: t.datos.clase === 'duracion' ? t.datos.valor : '600ms', ['--curva-m' as string]: t.datos.clase === 'curva' ? t.datos.valor : 'ease' }}>
              <div className="dz-mov__pista">
                <span className="dz-mov__punto" />
              </div>
              <div className="dz-mov__dato">
                <b>{t.datos.valor}</b> · {t.datos.veces ?? 0} usos
              </div>
            </div>
          ))}
        </div>
      </section>
      {anims.length > 0 && (
        <section className="dz-sis__grupo">
          <h3>Animaciones (@keyframes)</h3>
          <div className="dz-anims">
            {anims.map((t) => (
              <div key={t.clave} className="dz-anim" data-item={`token:${t.clave}`}>
                <b>{t.nombre}</b> <span>{t.datos.veces ?? 0} usos</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Unidades() {
  const resumen = useDiseno((s) => s.resumen)
  if (!resumen) return null
  const vistas = Object.entries(resumen.vistas)
  return (
    <div className="dz-sis__cuerpo">
      <table className="dz-unidades">
        <thead>
          <tr>
            <th>Unidad</th>
            <th>Qué es</th>
            {vistas.map(([v, d]) => (
              <th key={v}>
                {v} ({d.ancho}×{d.alto})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(resumen.unidades).map(([u, que]) => (
            <tr key={u}>
              <td className="mono">{u}</td>
              <td>{que}</td>
              {vistas.map(([v]) => (
                <td key={v} className="mono">
                  la calcula el código para esa vista
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Salud() {
  const items = useDiseno((s) => s.items)
  const cargar = useDiseno((s) => s.cargarItems)
  useEffect(() => {
    void cargar('activo')
    void cargar('texto')
  }, [cargar])
  const colores = (items.color_suelto ?? []) as ItemDiseno<'color_suelto'>[]
  const tokens = (items.token ?? []) as ItemDiseno<'token'>[]
  const activos = (items.activo ?? []) as ItemDiseno<'activo'>[]
  const textos = (items.texto ?? []) as ItemDiseno<'texto'>[]
  const repetidas = tokens.filter((t) => !t.datos.suelto && (t.datos.declaradoEn?.length ?? 0) > 1)
  const distintas = repetidas.filter((t) => new Set(t.datos.declaradoEn!.map((d) => d.valor)).size > 1)
  const tarjetas: [string, number, string, string][] = [
    ['colores sin nombre', colores.filter((c) => !c.datos.igualA).length, 'escritos a mano, sin variable', 'color_suelto'],
    ['colores a un paso de otro', colores.filter((c) => c.datos.cercaDe).length, 'casi iguales (ΔE < 2): candidatos a unificar', 'color_suelto'],
    ['variables repetidas', repetidas.length, `declaradas en más de una hoja (${distintas.length} con valores distintos)`, 'token'],
    ['activos sin uso encontrado', activos.filter((a) => a.origen === 'importado' && !(a.datos as DatosActivo).usos?.length).length, 'no aparecen en el código', 'activo'],
    ['activos sin nota', activos.filter((a) => a.origen === 'importado' && !(a.datos as DatosActivo).nota && !a.nota?.nota).length, 'sin ficha en el índice', 'activo'],
    ['textos sin uso', textos.filter((t) => (t.datos as DatosTexto).usos && !(t.datos as DatosTexto).usos!.length).length, 'no se usan con T.<clave>', 'texto'],
  ]
  return (
    <div className="dz-sis__cuerpo dz-salud">
      {tarjetas.map(([titulo, n, ayuda, t]) => (
        <div key={titulo} className={`dz-salud__tarjeta${n ? '' : ' dz-salud__tarjeta--ok'}`} data-item={`salud:${t}:${titulo}`}>
          <b>{n}</b>
          <span>{titulo}</span>
          <small>{ayuda}</small>
        </div>
      ))}
    </div>
  )
}

function Hojas({ items }: { items: ItemDiseno<'hoja'>[] }) {
  return (
    <div className="dz-sis__cuerpo">
      {items.map((h) => {
        const d: DatosHoja = h.datos
        return (
          <div key={h.clave} className="dz-fila-token" data-item={`hoja:${h.clave}`}>
            <span className="dz-fila-token__nombre">{h.clave}</span>
            <span className="dz-fila-token__var">{d.archivo}</span>
            <span className="dz-fila-token__valor">
              {d.reglas} reglas · {Math.round(d.peso / 1024)} KB
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Activos({ items }: { items: ItemDiseno<'activo'>[] }) {
  return (
    <div className="dz-sis__cuerpo dz-activos">
      {items.map((a) => {
        const d: DatosActivo = a.datos
        return (
          <div key={a.clave} className="dz-activo" data-item={`activo:${a.clave}`} title={`${a.nombre} · ${d.ancho}×${d.alto}${d.nota ? ` · ${d.nota}` : ''}`}>
            <div className="dz-activo__img">
              <img src={d.ruta} alt="" loading="lazy" decoding="async" draggable={false} />
            </div>
            <div className="dz-activo__nombre">{a.nombre}</div>
            {marcaNuevo(a)}
          </div>
        )
      })}
    </div>
  )
}

export function datosToken(i: ItemDiseno): DatosToken | null {
  return i.tipo === 'token' ? (i.datos as DatosToken) : null
}
