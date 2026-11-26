// Una página de sistema (Fundamentos, Íconos) en el teléfono: en la PC es un lienzo de columnas de 1.480 px; en el
// teléfono es un documento que se lee de arriba abajo, con las mismas secciones (colores con nombre, sueltos, letras,
// escala, estilos, radios, sombras, movimiento, piezas, activos…) acomodadas al ancho. Arriba, un índice para saltar de
// sección. Un toque en cualquier muestra abre su ficha (valor, dónde se usa, notas y comentarios).
import { Component, LayoutTemplate } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { aHsl, aRgb, luminancia, variableDeToken } from '../../../../../compartido/diseno/tokens'
import type {
  DatosActivo,
  DatosColorSuelto,
  DatosEstiloTexto,
  DatosFuente,
  DatosHoja,
  DatosPieza,
  DatosPlantilla,
  DatosTexto,
  ItemDiseno,
  MarcoResumen,
  TipoItem,
} from '../../../../../compartido/diseno/tipos'
import { Girando } from '../../../ui/comunes'
import { apiDiseno, urlMiniatura } from '../api'
import { SIN_ITEMS, useDiseno } from '../estado'
import { familiaCargada, tamanoPx, usarFuentesDelProyecto } from '../sistema/PaginaSistema'
import { useDisenoMovil } from './estado'
import { EVENTO_INICIO } from './TiraPaginas'
import { VacioDeSistema } from './Vacios'

interface Seccion {
  id: string
  /** En el índice de arriba. */
  corto: string
  titulo: string
  bajada: string
  cuerpo: ReactNode
}

const tipo = <T extends TipoItem>(items: ItemDiseno[], t: T) => items.filter((i) => i.tipo === t && !i.archivado) as ItemDiseno<T>[]
const abrirItem = (i: ItemDiseno) => useDisenoMovil.getState().abrirHoja({ tipo: 'item', clave: `${i.tipo}:${i.clave}` })

function agrupar<T extends ItemDiseno>(items: T[]): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const i of items) {
    if (!m.has(i.grupo)) m.set(i.grupo, [])
    m.get(i.grupo)!.push(i)
  }
  return [...m]
}

const textoSobre = (valor: string) => {
  const c = aRgb(valor)
  return c && luminancia(c) > 0.45 ? '#1b1a18' : '#ffffff'
}

export function SistemaMovil() {
  const pagina = useDiseno((s) => s.pagina)!
  const items = useDiseno((s) => s.items)
  const cargandoItems = useDiseno((s) => s.cargandoItems)
  const resumen = useDiseno((s) => s.resumen)
  const prefijo = useDiseno((s) => s.prefijo)!
  const fuentes = useDiseno((s) => (s.items.fuente ?? SIN_ITEMS) as ItemDiseno<'fuente'>[])
  const mapa = usarFuentesDelProyecto(fuentes, resumen?.proyecto.id ?? 'p')
  const ref = useRef<HTMLDivElement>(null)
  const [activa, setActiva] = useState<string | null>(null)
  const tipos = pagina.datos.tipos ?? []
  const conPiezas = tipos.includes('token')

  // Lo que la página muestra (abrirPagina ya pide sus tipos); con los tokens, también piezas y plantillas.
  useEffect(() => {
    const s = useDiseno.getState()
    for (const t of tipos) void s.cargarItems(t)
    if (conPiezas) {
      void s.cargarItems('pieza')
      void s.cargarItems('plantilla')
      void s.cargarItems('fuente')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina.id])

  const listo = tipos.every((t) => items[t] !== undefined) || tipos.some((t) => (items[t]?.length ?? 0) > 0)
  const cargando = tipos.some((t) => cargandoItems[t])
  const secciones = useMemo(
    () => armarSecciones(tipos, items, resumen?.unidades ?? {}, mapa, conPiezas, prefijo, resumen?.proyecto.nombre ?? 'Telar'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tipos.join(','), items, resumen, mapa, conPiezas, prefijo],
  )

  // Qué sección se está leyendo (para el índice).
  useEffect(() => {
    const raiz = ref.current
    if (!raiz) return
    const alDesplazar = () => {
      const arriba = raiz.getBoundingClientRect().top + 64
      let actual: string | null = null
      for (const el of Array.from(raiz.querySelectorAll<HTMLElement>('[data-seccion]'))) {
        if (el.getBoundingClientRect().top <= arriba) actual = el.dataset.seccion!
        else break
      }
      setActiva(actual ?? secciones[0]?.id ?? null)
    }
    alDesplazar()
    raiz.addEventListener('scroll', alDesplazar, { passive: true })
    return () => raiz.removeEventListener('scroll', alDesplazar)
  }, [secciones])

  // El índice acompaña: la sección que se lee queda a la vista en la tira.
  useEffect(() => {
    const chip = ref.current?.querySelector<HTMLElement>(`.dzm-indice [data-ir="${CSS.escape(activa ?? '')}"]`)
    const tira = chip?.parentElement
    if (!chip || !tira) return
    tira.scrollTo({ left: Math.max(0, chip.offsetLeft - (tira.clientWidth - chip.offsetWidth) / 2), behavior: 'smooth' })
  }, [activa])

  // Volver a tocar Diseño: arriba de todo.
  useEffect(() => {
    const f = () => ref.current?.scrollTo({ top: 0, behavior: 'smooth' })
    window.addEventListener(EVENTO_INICIO, f)
    return () => window.removeEventListener(EVENTO_INICIO, f)
  }, [])

  if (!secciones.length)
    return cargando || !listo ? (
      <div className="dzm-estado">
        <Girando tam={22} />
      </div>
    ) : (
      <VacioDeSistema />
    )

  const ir = (id: string) => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-seccion="${CSS.escape(id)}"]`)
    const raiz = ref.current
    if (!el || !raiz) return
    raiz.scrollTo({ top: el.offsetTop - 52, behavior: 'smooth' })
  }

  return (
    <div className="dzm-sistema" ref={ref}>
      {secciones.length > 1 && (
        <nav className="dzm-indice" aria-label="Secciones">
          {secciones.map((s) => (
            <button
              key={s.id}
              type="button"
              data-ir={s.id}
              className={`dzm-indice__chip${activa === s.id ? ' dzm-indice__chip--activo' : ''}`}
              aria-current={activa === s.id ? 'true' : undefined}
              onClick={() => ir(s.id)}
            >
              {s.corto}
            </button>
          ))}
        </nav>
      )}
      {secciones.map((s) => (
        <section key={s.id} className="dzm-seccion" data-seccion={s.id} aria-labelledby={`dzm-s-${s.id}`}>
          <header className="dzm-seccion__cab">
            <h2 id={`dzm-s-${s.id}`}>{s.titulo}</h2>
            <p>{s.bajada}</p>
          </header>
          {s.cuerpo}
        </section>
      ))}
      <p className="dzm-sistema__pie">Los colores, las letras y las piezas se definen en la computadora o por Claude. Acá se miran, se comentan y se proponen cambios.</p>
    </div>
  )
}

// ───────── armado ─────────

function armarSecciones(
  tipos: TipoItem[],
  todos: Partial<Record<TipoItem, ItemDiseno[]>>,
  unidades: Record<string, string>,
  mapa: Map<string, string>,
  conPiezas: boolean,
  prefijo: string,
  proyecto: string,
): Seccion[] {
  const items = tipos.flatMap((t) => todos[t] ?? [])
  const r: Seccion[] = []
  const tokens = tipo(items, 'token')
  const nombrados = tokens.filter((t) => !t.datos.suelto)
  const colores = nombrados.filter((t) => t.datos.clase === 'color')
  const otras = nombrados.filter((t) => !['color', 'radio', 'sombra', 'duracion', 'curva', 'animacion'].includes(t.datos.clase))
  const sueltos = tokens.filter((t) => t.datos.suelto)
  const coloresSueltos = tipo(items, 'color_suelto')

  if (coloresSueltos.length) r.push({ id: 'salud', corto: 'Salud', titulo: 'Salud del sistema', bajada: 'Lo que conviene ordenar en el código. Cada punto se puede volver tarjeta.', cuerpo: <Salud /> })
  if (colores.length)
    r.push({ id: 'colores', corto: 'Colores', titulo: 'Color · Variables', bajada: `${colores.length} colores con nombre, por colección`, cuerpo: <Variables items={colores} /> })
  if (coloresSueltos.length)
    r.push({
      id: 'sueltos',
      corto: 'Sueltos',
      titulo: 'Color · Sueltos',
      bajada: `${coloresSueltos.length} colores escritos a mano en el código (el número dice cuántas veces se usan)`,
      cuerpo: <Sueltos items={coloresSueltos} />,
    })
  const familias = tipo(items, 'fuente')
  if (familias.length) {
    const pesos = sueltos.filter((t) => t.clave.startsWith('font-weight:'))
    r.push({ id: 'familias', corto: 'Letras', titulo: 'Tipografía · Familias', bajada: `${familias.length} ${familias.length === 1 ? 'familia' : 'familias'} del proyecto`, cuerpo: <Familias fuentes={familias} pesos={pesos} mapa={mapa} proyecto={proyecto} /> })
  }
  const tamanos = sueltos.filter((t) => t.clave.startsWith('font-size:'))
  if (tamanos.length) r.push({ id: 'escala', corto: 'Escala', titulo: 'Tipografía · Escala', bajada: `${tamanos.length} tamaños de letra, de mayor a menor`, cuerpo: <Escala items={tamanos} mapa={mapa} fuentes={familias} proyecto={proyecto} /> })
  const estilos = tipo(items, 'estilo_texto')
  if (estilos.length) r.push({ id: 'estilos', corto: 'Estilos', titulo: 'Tipografía · Estilos de texto', bajada: `${estilos.length} estilos`, cuerpo: <Estilos items={estilos} mapa={mapa} /> })
  if (otras.length) r.push({ id: 'medidas', corto: 'Medidas', titulo: 'Medidas y otros tokens', bajada: `${otras.length} tokens con nombre`, cuerpo: <Otras items={otras} /> })
  const radios = tokens.filter((t) => t.datos.clase === 'radio')
  if (radios.length) r.push({ id: 'radios', corto: 'Radios', titulo: 'Radios', bajada: `${radios.length} radios de borde`, cuerpo: <Radios items={radios} /> })
  const sombras = tokens.filter((t) => t.datos.clase === 'sombra')
  if (sombras.length) r.push({ id: 'sombras', corto: 'Sombras', titulo: 'Sombras', bajada: `${sombras.length} sombras`, cuerpo: <Sombras items={sombras} /> })
  const mov = tokens.filter((t) => ['duracion', 'curva', 'animacion'].includes(t.datos.clase))
  if (mov.length) r.push({ id: 'movimiento', corto: 'Movimiento', titulo: 'Movimiento', bajada: 'Duraciones, curvas y animaciones (tocá una para verla andar)', cuerpo: <Movimiento items={mov} /> })
  if (tipos.includes('token') && Object.keys(unidades).length)
    r.push({ id: 'unidades', corto: 'Unidades', titulo: 'Unidades', bajada: 'Qué es cada unidad del proyecto', cuerpo: <Unidades unidades={unidades} /> })
  if (conPiezas) {
    const piezas = (todos.pieza ?? []).filter((i) => !i.archivado) as ItemDiseno<'pieza'>[]
    const plantillas = (todos.plantilla ?? []).filter((i) => !i.archivado) as ItemDiseno<'plantilla'>[]
    if (piezas.length || plantillas.length)
      r.push({
        id: 'piezas',
        corto: 'Piezas',
        titulo: 'Piezas y plantillas',
        bajada: `${piezas.length} ${piezas.length === 1 ? 'pieza' : 'piezas'}${plantillas.length ? ` y ${plantillas.length} ${plantillas.length === 1 ? 'plantilla' : 'plantillas'}` : ''}`,
        cuerpo: <Piezas piezas={piezas} plantillas={plantillas} prefijo={prefijo} />,
      })
  }
  const hojas = tipo(items, 'hoja')
  if (hojas.length) r.push({ id: 'hojas', corto: 'Hojas', titulo: 'Hojas de estilo', bajada: `${hojas.length} hojas importadas del código`, cuerpo: <Hojas items={hojas} /> })
  const activos = tipo(items, 'activo')
  for (const [g, lista] of agrupar(activos))
    r.push({ id: `activos-${g}`, corto: g || 'Activos', titulo: g || 'Activos', bajada: `${lista.length} ${lista.length === 1 ? 'imagen' : 'imágenes'}`, cuerpo: <Activos items={lista} /> })
  const textos = tipo(items, 'texto')
  if (textos.length) r.push({ id: 'textos', corto: 'Textos', titulo: 'Textos', bajada: `${textos.length} textos`, cuerpo: <TextosChicos items={textos} /> })
  return r
}

// ───────── secciones ─────────

const marcaNuevo = (i: ItemDiseno) => (i.nuevo ? <span className="dzm-nuevo" aria-label="Cambió en la última sincronización" /> : null)

function Variables({ items }: { items: ItemDiseno<'token'>[] }) {
  const grupos = useMemo(() => agrupar(items), [items])
  return (
    <>
      {grupos.map(([g, lista]) => (
        <div key={g} className="dzm-grupo">
          {grupos.length > 1 && <h3 className="dzm-subtitulo">{g.replace(/^Variables · /, '')}</h3>}
          <div className="dzm-colores">
            {lista.map((t) => {
              const oscuro = t.datos.modos?.oscuro
              return (
                <button key={t.clave} type="button" className="dzm-color" onClick={() => abrirItem(t)} aria-label={`${t.nota?.nombrePropio || t.clave}: ${t.datos.valor}`}>
                  <span className="dzm-color__muestra" style={{ background: oscuro ? `linear-gradient(135deg, ${t.datos.valor} 50%, ${oscuro} 50%)` : t.datos.valor }}>
                    {marcaNuevo(t)}
                  </span>
                  <span className="dzm-color__nombre">{t.nota?.nombrePropio || (t.origen === 'importado' ? t.clave : t.clave.split('/').pop())}</span>
                  <span className="dzm-color__valor">{t.datos.alias ? `→ ${t.datos.alias}` : t.datos.valor}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

function Sueltos({ items }: { items: ItemDiseno<'color_suelto'>[] }) {
  const grupos = useMemo(
    () =>
      agrupar(items).map(
        ([g, l]) =>
          [
            g,
            [...l].sort((a, b) => {
              const [ha, sa, la] = aHsl(a.datos.rgb)
              const [hb, sb, lb] = aHsl(b.datos.rgb)
              return Math.round(ha / 20) - Math.round(hb / 20) || lb - la || sb - sa
            }),
          ] as [string, ItemDiseno<'color_suelto'>[]],
      ),
    [items],
  )
  return (
    <>
      {grupos.map(([g, lista]) => (
        <div key={g} className="dzm-grupo">
          <h3 className="dzm-subtitulo">
            {g} <span className="dzm-subtitulo__n">{lista.length}</span>
          </h3>
          <div className="dzm-fichas">
            {lista.map((c) => {
              const d: DatosColorSuelto = c.datos
              return (
                <button
                  key={c.clave}
                  type="button"
                  className="dzm-ficha"
                  style={{ background: d.valor, color: textoSobre(d.valor) }}
                  onClick={() => abrirItem(c)}
                  aria-label={`${d.valor}, ${d.veces} usos${d.igualA ? `, igual a ${d.igualA}` : ''}`}
                >
                  <span className="dzm-ficha__usos">{d.veces}</span>
                  {d.cercaDe && <span className="dzm-ficha__cerca" aria-hidden />}
                  {marcaNuevo(c)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

const ABC = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnÑñOoPpQqRrSsTtUuVvWwXxYyZz'

function Familias({ fuentes, pesos, mapa, proyecto }: { fuentes: ItemDiseno<'fuente'>[]; pesos: ItemDiseno<'token'>[]; mapa: Map<string, string>; proyecto: string }) {
  const usados = pesos.map((t) => Number(t.datos.valor)).filter((n) => n >= 100 && n <= 1000)
  const lista = [...new Set(usados.length ? usados : [400, 700])].sort((a, b) => a - b).slice(0, 6)
  return (
    <div className="dzm-familias">
      {fuentes.map((f) => {
        const d: DatosFuente = f.datos
        const fam = familiaCargada(`"${d.familia}"`, mapa)
        return (
          <button key={f.clave} type="button" className="dzm-familia" onClick={() => abrirItem(f)}>
            <span className="dzm-familia__cabeza">
              <span className="dzm-familia__aa" style={{ fontFamily: fam }}>
                Aa
              </span>
              <span className="dzm-familia__datos">
                <b>{d.familia}</b>
                <span>
                  pesos {d.pesos}
                  {d.licencia ? ` · ${d.licencia}` : ''}
                </span>
              </span>
            </span>
            <span className="dzm-familia__abc" style={{ fontFamily: fam }}>
              {ABC}
            </span>
            <span className="dzm-familia__abc" style={{ fontFamily: fam }}>
              0123456789 ¡¿?! $ % & @
            </span>
            <span className="dzm-familia__pesos">
              {lista.map((p) => (
                <span key={p} style={{ fontFamily: fam, fontWeight: p }}>
                  <small>{p}</small> {proyecto}
                </span>
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Escala({ items, mapa, fuentes, proyecto }: { items: ItemDiseno<'token'>[]; mapa: Map<string, string>; fuentes: ItemDiseno<'fuente'>[]; proyecto: string }) {
  const fam = fuentes[0] ? familiaCargada(`"${fuentes[0].datos.familia}"`, mapa) : undefined
  const orden = useMemo(() => [...items].sort((a, b) => tamanoPx(b.datos.valor) - tamanoPx(a.datos.valor)), [items])
  return (
    <div className="dzm-filas">
      {orden.map((t) => {
        const px = tamanoPx(t.datos.valor)
        return (
          <button key={t.clave} type="button" className="dzm-escala" onClick={() => abrirItem(t)}>
            <span className="dzm-escala__muestra" style={{ fontSize: Math.min(px, 64), fontFamily: fam }}>
              {proyecto}
            </span>
            <span className="dzm-escala__dato">
              <b>{t.datos.unidad ?? t.datos.valor}</b> · {Math.round(px * 10) / 10} px · {t.datos.veces ?? 0} usos
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Estilos({ items, mapa }: { items: ItemDiseno<'estilo_texto'>[]; mapa: Map<string, string> }) {
  return (
    <div className="dzm-filas">
      {items.map((e) => {
        const d: DatosEstiloTexto = e.datos
        const tam = d.tamano && !/var\(/.test(d.tamano) ? `min(${d.tamano}, 44px)` : '28px'
        return (
          <button key={e.clave} type="button" className="dzm-estilo" onClick={() => abrirItem(e)}>
            <span
              className={`dzm-estilo__muestra${d.contorno ? ' dzm-estilo__muestra--contorno' : ''}`}
              style={{
                fontFamily: familiaCargada(`"${d.familia}"`, mapa),
                fontWeight: d.peso,
                fontSize: tam,
                lineHeight: d.interlineado,
                letterSpacing: d.espaciado,
                textTransform: d.mayusculas ? 'uppercase' : undefined,
                color: d.color,
                WebkitTextStroke: d.contorno ? `${d.contorno.grosor} ${d.contorno.color}` : undefined,
                paintOrder: d.contorno ? 'stroke fill' : undefined,
              }}
            >
              {d.contorno ? '71.096' : e.nombre}
            </span>
            <span className="dzm-estilo__dato">
              {d.contorno ? `${d.color} con borde ${d.contorno.color}` : `${d.familia} ${d.peso} · ${d.tamano} / ${d.interlineado}`}
              {d.veces ? ` · ${d.veces} usos` : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Otras({ items }: { items: ItemDiseno<'token'>[] }) {
  return (
    <div className="dzm-filas dzm-filas--tabla">
      {items.map((t) => (
        <button key={t.clave} type="button" className="dzm-token" onClick={() => abrirItem(t)}>
          <span className="dzm-token__nombre">{t.nota?.nombrePropio || t.clave}</span>
          <span className="dzm-token__valor">
            {t.datos.clase === 'medida' && /^\d+(\.\d+)?px$/.test(t.datos.valor) && <span className="dzm-token__barra" style={{ width: Math.min(96, parseFloat(t.datos.valor)) }} aria-hidden />}
            {t.datos.valor}
          </span>
          {t.origen !== 'importado' && <span className="dzm-token__var">var({t.datos.css || variableDeToken(t.clave)})</span>}
        </button>
      ))}
    </div>
  )
}

const sinUnidades = (v: string) => v.replace(/calc\(\s*var\(--[\w-]+\)\s*\*\s*([\d.]+)\s*\)/g, '$1px').replace(/var\(--[\w-]+,?\s*([^)]*)\)/g, '$1')

function Radios({ items }: { items: ItemDiseno<'token'>[] }) {
  const orden = useMemo(() => [...items].sort((a, b) => (b.datos.veces ?? 0) - (a.datos.veces ?? 0)), [items])
  return (
    <div className="dzm-mosaico">
      {orden.map((t) => (
        <button key={t.clave} type="button" className="dzm-radio" onClick={() => abrirItem(t)}>
          <span className="dzm-radio__muestra" style={{ borderRadius: sinUnidades(t.datos.valor) }} aria-hidden />
          <span className="dzm-mosaico__dato">{t.datos.unidad ?? t.datos.valor}</span>
          <span className="dzm-mosaico__bajada">{t.nota?.nombrePropio || (t.datos.veces !== undefined ? `${t.datos.veces} usos` : t.clave.split('/').pop())}</span>
        </button>
      ))}
    </div>
  )
}

function Sombras({ items }: { items: ItemDiseno<'token'>[] }) {
  const orden = useMemo(() => [...items].sort((a, b) => (b.datos.veces ?? 0) - (a.datos.veces ?? 0)), [items])
  return (
    <div className="dzm-mosaico dzm-mosaico--sombras">
      {orden.map((t) => {
        const texto = t.clave.startsWith('text-shadow')
        return (
          <button key={t.clave} type="button" className="dzm-sombra" onClick={() => abrirItem(t)}>
            <span className={`dzm-sombra__muestra${texto ? ' dzm-sombra__muestra--texto' : ''}`} style={texto ? { textShadow: sinUnidades(t.datos.valor) } : { boxShadow: sinUnidades(t.datos.valor) }} aria-hidden>
              {texto ? 'Aa' : ''}
            </span>
            <span className="dzm-mosaico__dato">{t.nota?.nombrePropio || (t.origen === 'importado' ? `${t.datos.veces ?? 0} usos` : t.clave.split('/').pop())}</span>
            <span className="dzm-mosaico__bajada dzm-mosaico__bajada--mono">{t.datos.valor}</span>
          </button>
        )
      })}
    </div>
  )
}

function Movimiento({ items }: { items: ItemDiseno<'token'>[] }) {
  const [andando, setAndando] = useState<string | null>(null)
  const ms = (v: string) => parseFloat(v) * (/ms/.test(v) ? 1 : 1000)
  const duraciones = items.filter((i) => i.datos.clase === 'duracion').sort((a, b) => ms(a.datos.valor) - ms(b.datos.valor))
  const curvas = items.filter((i) => i.datos.clase === 'curva')
  const anims = items.filter((i) => i.datos.clase === 'animacion')
  return (
    <div className="dzm-filas">
      {[...duraciones, ...curvas].map((t) => (
        <div key={t.clave} className="dzm-mov">
          <button
            type="button"
            className={`dzm-mov__pista${andando === t.clave ? ' dzm-mov__pista--andando' : ''}`}
            style={{ ['--dur' as string]: t.datos.clase === 'duracion' ? t.datos.valor : '700ms', ['--curva-m' as string]: t.datos.clase === 'curva' ? t.datos.valor : 'ease' }}
            onClick={() => {
              setAndando(null)
              requestAnimationFrame(() => setAndando(t.clave))
            }}
            aria-label={`Ver andar ${t.datos.valor}`}
          >
            <span className="dzm-mov__punto" />
          </button>
          <button type="button" className="dzm-mov__dato" onClick={() => abrirItem(t)}>
            <b>{t.datos.valor}</b>
            <span>
              {t.nota?.nombrePropio || (t.origen === 'importado' ? '' : t.clave.split('/').pop())}
              {t.datos.veces !== undefined ? ` · ${t.datos.veces} usos` : ''}
            </span>
          </button>
        </div>
      ))}
      {anims.map((t) => (
        <button key={t.clave} type="button" className="dzm-token" onClick={() => abrirItem(t)}>
          <span className="dzm-token__nombre">@keyframes {t.nombre}</span>
          <span className="dzm-token__valor">{t.datos.veces ?? 0} usos</span>
        </button>
      ))}
    </div>
  )
}

function Unidades({ unidades }: { unidades: Record<string, string> }) {
  return (
    <dl className="dzm-datos">
      {Object.entries(unidades).map(([u, que]) => (
        <div key={u} className="dzm-datos__fila">
          <dt className="mono">{u}</dt>
          <dd>{que}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Las hojas de variantes de las piezas (marcos con datos.pieza en las páginas de piezas), para mostrar su miniatura. */
function useHojasDePiezas(prefijo: string): Map<string, MarcoResumen> {
  const resumen = useDiseno((s) => s.resumen)
  const [mapa, setMapa] = useState(new Map<string, MarcoResumen>())
  useEffect(() => {
    if (!resumen) return
    let vivo = true
    const paginas = resumen.paginas.filter((p) => !p.archivada && p.tipo === 'lienzo' && /pieza|component/i.test(p.slug + p.nombre))
    Promise.all(paginas.map((p) => apiDiseno.pagina(prefijo, p.id).then((r) => r.marcos)))
      .then((listas) => {
        if (!vivo) return
        const m = new Map<string, MarcoResumen>()
        for (const x of listas.flat()) if (x.datos.pieza && !m.has(x.datos.pieza)) m.set(x.datos.pieza, x)
        setMapa(m)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [prefijo, resumen])
  return mapa
}

function Piezas({ piezas, plantillas, prefijo }: { piezas: ItemDiseno<'pieza'>[]; plantillas: ItemDiseno<'plantilla'>[]; prefijo: string }) {
  const hojas = useHojasDePiezas(prefijo)
  return (
    <div className="dzm-filas">
      {piezas.map((p) => {
        const hoja = hojas.get(p.clave)
        const d: DatosPieza = p.datos
        const variantes = d.propiedades.filter((x) => x.clase === 'variante').reduce((n, v) => n * Math.max(1, v.valores?.length ?? 1), 1)
        return (
          <button key={p.clave} type="button" className="dzm-pieza" onClick={() => abrirItem(p)}>
            <span className="dzm-pieza__mini">{hoja ? <img src={urlMiniatura(prefijo, hoja)} alt="" loading="lazy" decoding="async" /> : <Component size={20} />}</span>
            <span className="dzm-pieza__texto">
              <b>{p.nombre}</b>
              <span>
                {variantes > 1 ? `${variantes} variantes` : 'sin variantes'}
                {d.propiedades.length ? ` · ${d.propiedades.map((x) => x.nombre).join(', ')}` : ''}
              </span>
            </span>
          </button>
        )
      })}
      {plantillas.map((p) => {
        const d: DatosPlantilla = p.datos
        return (
          <button key={p.clave} type="button" className="dzm-pieza" onClick={() => abrirItem(p)}>
            <span className="dzm-pieza__mini">
              <LayoutTemplate size={20} />
            </span>
            <span className="dzm-pieza__texto">
              <b>{p.nombre}</b>
              <span>
                Plantilla · {d.ancho} × {d.alto}
                {d.ranuras.length ? ` · ${d.ranuras.length} ${d.ranuras.length === 1 ? 'ranura' : 'ranuras'}` : ''}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Hojas({ items }: { items: ItemDiseno<'hoja'>[] }) {
  return (
    <div className="dzm-filas dzm-filas--tabla">
      {items.map((h) => {
        const d: DatosHoja = h.datos
        return (
          <button key={h.clave} type="button" className="dzm-token" onClick={() => abrirItem(h)}>
            <span className="dzm-token__nombre">{h.clave}</span>
            <span className="dzm-token__valor">
              {d.reglas} reglas · {Math.max(1, Math.round(d.peso / 1024))} KB
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Activos({ items }: { items: ItemDiseno<'activo'>[] }) {
  return (
    <div className="dzm-activos">
      {items.map((a) => {
        const d: DatosActivo = a.datos
        return (
          <button key={a.clave} type="button" className="dzm-activo" onClick={() => abrirItem(a)} aria-label={`${a.nombre}, ${d.ancho} × ${d.alto}`}>
            <span className="dzm-activo__img">
              <img src={d.ruta} alt="" loading="lazy" decoding="async" draggable={false} />
            </span>
            <span className="dzm-activo__nombre">{a.nombre}</span>
            {marcaNuevo(a)}
          </button>
        )
      })}
    </div>
  )
}

function TextosChicos({ items }: { items: ItemDiseno<'texto'>[] }) {
  return (
    <div className="dzm-filas">
      {items.slice(0, 200).map((t) => (
        <button key={t.clave} type="button" className="dzm-token" onClick={() => abrirItem(t)}>
          <span className="dzm-token__nombre">{(t.datos as DatosTexto).valor}</span>
          <span className="dzm-token__valor">{t.clave}</span>
        </button>
      ))}
    </div>
  )
}

// ───────── salud ─────────

const SALUD: { titulo: string; ayuda: string; tipo: TipoItem }[] = [
  { titulo: 'colores sin nombre', ayuda: 'escritos a mano, sin variable', tipo: 'color_suelto' },
  { titulo: 'colores a un paso de otro', ayuda: 'casi iguales: candidatos a unificar', tipo: 'color_suelto' },
  { titulo: 'variables repetidas', ayuda: 'declaradas en más de una hoja', tipo: 'token' },
  { titulo: 'activos sin uso encontrado', ayuda: 'no aparecen en el código', tipo: 'activo' },
  { titulo: 'activos sin nota', ayuda: 'sin ficha en el índice', tipo: 'activo' },
  { titulo: 'textos sin uso', ayuda: 'no se usan en el código', tipo: 'texto' },
]

/** Cuántos ítems caen en cada punto de la salud (la misma cuenta que la PC). */
export function cuentaSalud(titulo: string, items: Partial<Record<TipoItem, ItemDiseno[]>>): ItemDiseno[] {
  const colores = (items.color_suelto ?? []) as ItemDiseno<'color_suelto'>[]
  const tokens = (items.token ?? []) as ItemDiseno<'token'>[]
  const activos = (items.activo ?? []) as ItemDiseno<'activo'>[]
  const textos = (items.texto ?? []) as ItemDiseno<'texto'>[]
  switch (titulo) {
    case 'colores sin nombre':
      return colores.filter((c) => !c.datos.igualA)
    case 'colores a un paso de otro':
      return colores.filter((c) => c.datos.cercaDe)
    case 'variables repetidas':
      return tokens.filter((t) => !t.datos.suelto && (t.datos.declaradoEn?.length ?? 0) > 1)
    case 'activos sin uso encontrado':
      return activos.filter((a) => a.origen === 'importado' && !a.datos.usos?.length)
    case 'activos sin nota':
      return activos.filter((a) => a.origen === 'importado' && !a.datos.nota && !a.nota?.nota)
    case 'textos sin uso':
      return textos.filter((t) => t.datos.usos && !t.datos.usos.length)
  }
  return []
}

function Salud() {
  const items = useDiseno((s) => s.items)
  useEffect(() => {
    void useDiseno.getState().cargarItems('activo')
    void useDiseno.getState().cargarItems('texto')
  }, [])
  return (
    <div className="dzm-salud">
      {SALUD.map((s) => {
        const n = cuentaSalud(s.titulo, items).length
        return (
          <button
            key={s.titulo}
            type="button"
            className={`dzm-salud__tarjeta${n ? '' : ' dzm-salud__tarjeta--ok'}`}
            onClick={() => useDisenoMovil.getState().abrirHoja({ tipo: 'item', clave: `salud:${s.tipo}:${s.titulo}` })}
          >
            <b>{n}</b>
            <span>{s.titulo}</span>
            <small>{s.ayuda}</small>
          </button>
        )
      })}
    </div>
  )
}
