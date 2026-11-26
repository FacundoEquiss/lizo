// Capas (plan 6.2): árbol secciones → marcos → capas, con lista virtual (filas de 28 px, solo se dibujan las visibles).
// El árbol de un marco se arma al desplegarlo, leyendo el DOM del iframe (o el HTML guardado si el marco no está vivo).
// Resaltado cruzado: pasar por una fila resalta la capa en el lienzo y al revés. En sistema: grupos → ítems.
import { Box, ChevronRight, Component, Diamond, Eye, EyeOff, Frame, Image as IconoImagen, Lock, LockOpen, SquareDashed, TextCursorInput, Type } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { arbolDeHtml, claseDeCapa, nombreCapa, type ClaseCapa, type ElementoCapa, type NodoCapa } from '../../../../../compartido/diseno/capas'
import type { ItemDiseno, MarcoResumen } from '../../../../../compartido/diseno/tipos'
import { avisarError } from '../../../estado/avisos'
import { apiDiseno } from '../api'
import { useDiseno } from '../estado'
import { documentoDe, elementoDeCapa } from '../lienzo/elegir'

const ALTO = 28

const ICONO_CLASE: Record<ClaseCapa, ReactNode> = {
  pieza: <Component size={14} />,
  instancia: <Diamond size={14} />,
  texto: <Type size={14} />,
  imagen: <IconoImagen size={14} />,
  svg: <IconoImagen size={14} />,
  campo: <TextCursorInput size={14} />,
  caja: <Box size={14} />,
}

interface Fila {
  key: string
  nivel: number
  tipo: 'seccion' | 'marco' | 'capa' | 'grupo' | 'item'
  nombre: string
  icono: ReactNode
  marco?: MarcoResumen
  capa?: string
  item?: string
  hijos: boolean
  abierta: boolean
  oculta?: boolean
  cuenta?: number
}

/** Árbol desde el DOM vivo de un marco: misma regla que arbolDeHtml (solo cuentan los elementos con data-id). */
function arbolDeDom(doc: Document, activos: Map<string, string>): NodoCapa[] {
  const armar = (el: Element, prof: number): NodoCapa[] => {
    const r: NodoCapa[] = []
    for (const h of Array.from(el.children)) {
      const et = h.tagName.toLowerCase()
      if (et === 'style' || et === 'script' || et === 'link') continue
      const id = h.getAttribute('data-id')
      if (!id) {
        r.push(...armar(h, prof))
        continue
      }
      let textoPropio = ''
      for (const n of Array.from(h.childNodes)) if (n.nodeType === 3) textoPropio += n.textContent ?? ''
      const ec: ElementoCapa = { etiqueta: et, attr: (n) => h.getAttribute(n), textoPropio, texto: h.textContent ?? '', hijosElemento: h.children.length }
      const clase = claseDeCapa(ec)
      const oculto = (h as HTMLElement).style?.display === 'none' || h.hasAttribute('hidden')
      r.push({
        id,
        etiqueta: et,
        clase,
        nombre: nombreCapa(ec, activos),
        descriptor: et,
        profundidad: prof,
        hijos: clase === 'instancia' ? [] : armar(h, prof + 1),
        oculto,
      })
    }
    return r
  }
  return doc.body ? armar(doc.body, 0) : []
}

export function Capas() {
  const pagina = useDiseno((s) => s.pagina)!
  if (pagina.tipo !== 'lienzo') return <CapasDeItems />
  return <CapasDeMarcos />
}

function CapasDeMarcos() {
  const marcos = useDiseno((s) => s.marcos)
  const completos = useDiseno((s) => s.completos)
  const seleccion = useDiseno((s) => s.seleccion)
  const sobre = useDiseno((s) => s.sobre)
  const activosItems = useDiseno((s) => s.items.activo)
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set())
  const [arboles, setArboles] = useState<Record<string, NodoCapa[]>>({})
  const [version, setVersion] = useState(0)
  const activos = useMemo(() => new Map((activosItems ?? []).map((a) => [(a as ItemDiseno<'activo'>).datos.ruta, a.nombre])), [activosItems])

  // secciones abiertas de fábrica
  const secciones = useMemo(() => [...new Set(marcos.map((m) => m.seccion || ''))], [marcos])
  const conSecciones = secciones.length > 1 || (secciones[0] ?? '') !== ''

  // el árbol de los marcos desplegados (DOM vivo o HTML guardado)
  useEffect(() => {
    const nuevos: Record<string, NodoCapa[]> = {}
    for (const m of marcos) {
      if (!abiertas.has(`m:${m.id}`)) continue
      const doc = documentoDe(m.id)
      if (doc?.body && doc.body.childElementCount) nuevos[m.id] = arbolDeDom(doc, activos)
      else if (completos[m.id]) nuevos[m.id] = arbolDeHtml(completos[m.id]!.marco.html, { activos, piezas: completos[m.id]!.piezas })
      else void useDiseno.getState().cargarMarco(m.id)
    }
    setArboles(nuevos)
  }, [marcos, abiertas, completos, activos, version])
  // al cargar un iframe, se vuelve a leer su DOM
  useEffect(() => {
    const f = () => setVersion((v) => v + 1)
    window.addEventListener('telar:diseno-iframe', f)
    return () => window.removeEventListener('telar:diseno-iframe', f)
  }, [])

  // al seleccionar: se despliegan el marco y los padres de la capa (y dos niveles de fábrica)
  useEffect(() => {
    const id = seleccion.marco
    if (!id) return
    setAbiertas((a) => {
      const n = new Set(a)
      const m = marcos.find((x) => x.id === id)
      if (m && conSecciones) n.add(`sec:${m.seccion || ''}`)
      if (!n.has(`m:${id}`)) {
        n.add(`m:${id}`)
        for (const c of arboles[id] ?? []) n.add(`c:${id}.${c.id}`)
      }
      if (seleccion.capa) {
        const el = elementoDeCapa(id, seleccion.capa)
        for (let p = el?.parentElement; p && p.tagName !== 'BODY'; p = p.parentElement) {
          const pid = p.getAttribute('data-id')
          if (pid) n.add(`c:${id}.${pid}`)
        }
      }
      return n.size === a.size ? a : n
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccion.marco, seleccion.capa])
  useEffect(() => {
    if (!conSecciones) return
    setAbiertas((a) => {
      const n = new Set(a)
      for (const s of secciones) n.add(`sec:${s}`)
      return n
    })
  }, [secciones, conSecciones])

  const filas = useMemo(() => {
    const r: Fila[] = []
    const capas = (m: MarcoResumen, nodos: NodoCapa[], nivel: number) => {
      for (const c of nodos) {
        const key = `c:${m.id}.${c.id}`
        const abierta = abiertas.has(key)
        r.push({ key, nivel, tipo: 'capa', nombre: c.nombre, icono: ICONO_CLASE[c.clase], marco: m, capa: c.id, hijos: c.hijos.length > 0, abierta, oculta: c.oculto })
        if (abierta) capas(m, c.hijos, nivel + 1)
      }
    }
    const marcoFilas = (lista: MarcoResumen[], nivel: number) => {
      for (const m of lista) {
        const key = `m:${m.id}`
        const abierta = abiertas.has(key)
        r.push({ key, nivel, tipo: 'marco', nombre: m.nombre, icono: <Frame size={14} />, marco: m, hijos: true, abierta })
        if (abierta) capas(m, arboles[m.id] ?? [], nivel + 1)
      }
    }
    if (!conSecciones) marcoFilas(marcos, 0)
    else
      for (const s of secciones) {
        const key = `sec:${s}`
        const lista = marcos.filter((m) => (m.seccion || '') === s)
        const abierta = abiertas.has(key)
        r.push({ key, nivel: 0, tipo: 'seccion', nombre: s || 'Sin sección', icono: <SquareDashed size={14} />, hijos: true, abierta, cuenta: lista.length })
        if (abierta) marcoFilas(lista, 1)
      }
    return r
  }, [marcos, secciones, conSecciones, abiertas, arboles])

  const alternar = useCallback(
    (f: Fila, todo: boolean) => {
      setAbiertas((a) => {
        const n = new Set(a)
        const abrir = !a.has(f.key)
        const marcar = (k: string) => (abrir ? n.add(k) : n.delete(k))
        marcar(f.key)
        if (todo && f.marco) {
          const bajar = (ns: NodoCapa[]) => ns.forEach((c) => (marcar(`c:${f.marco!.id}.${c.id}`), bajar(c.hijos)))
          if (f.tipo === 'marco') bajar(arboles[f.marco.id] ?? [])
          else {
            const buscar = (ns: NodoCapa[]): NodoCapa | null => {
              for (const c of ns) {
                if (c.id === f.capa) return c
                const h = buscar(c.hijos)
                if (h) return h
              }
              return null
            }
            const c = buscar(arboles[f.marco.id] ?? [])
            if (c) bajar(c.hijos)
          }
        }
        // un marco recién abierto: dos niveles de fábrica
        if (abrir && f.tipo === 'marco' && !todo) for (const c of arboles[f.marco!.id] ?? []) n.add(`c:${f.marco!.id}.${c.id}`)
        return n
      })
    },
    [arboles],
  )

  const activa = (f: Fila) => (f.tipo === 'marco' ? seleccion.marco === f.marco!.id && !seleccion.capa : f.tipo === 'capa' ? seleccion.marco === f.marco!.id && seleccion.capa === f.capa : false)
  const resaltada = (f: Fila) => Boolean(sobre && f.marco && sobre.marco === f.marco.id && (f.tipo === 'marco' ? !sobre.capa : sobre.capa === f.capa))
  const indiceActivo = filas.findIndex(activa)

  if (!marcos.length) return <p className="dz-izq__vacio">Esta página no tiene marcos.</p>
  return (
    <ListaVirtual
      filas={filas}
      indiceActivo={indiceActivo}
      render={(f) => (
        <FilaArbol
          f={f}
          activa={activa(f)}
          resaltada={resaltada(f)}
          alAlternar={(todo) => alternar(f, todo)}
          alEntrar={() => f.marco && useDiseno.getState().setSobre({ marco: f.marco.id, capa: f.capa ?? null })}
          alSalir={() => useDiseno.getState().setSobre(null)}
          alClic={() => {
            if (f.tipo === 'seccion') return alternar(f, false)
            useDiseno.getState().seleccionar({ marco: f.marco!.id, capa: f.capa ?? null })
          }}
          alDobleClic={() => {
            if (!f.marco) return
            useDiseno.getState().seleccionar({ marco: f.marco.id, capa: f.capa ?? null })
            requestAnimationFrame(() => window.dispatchEvent(new Event('telar:diseno-ver-seleccion')))
          }}
          acciones={
            f.tipo === 'marco' ? (
              <button
                className="dz-arbol__accion"
                aria-label={f.marco!.bloqueado ? 'Desbloquear el marco' : 'Bloquear el marco'}
                data-tip={f.marco!.bloqueado ? 'Desbloquear' : 'Bloquear'}
                onClick={(e) => {
                  e.stopPropagation()
                  const s = useDiseno.getState()
                  apiDiseno
                    .actualizarMarco(s.prefijo!, f.marco!.id, { bloqueado: !f.marco!.bloqueado })
                    .then(() => s.recargarPagina())
                    .catch(avisarError)
                }}
              >
                {f.marco!.bloqueado ? <Lock size={13} /> : <LockOpen size={13} />}
              </button>
            ) : f.tipo === 'capa' && f.marco!.origen === 'propio' ? (
              <button
                className="dz-arbol__accion"
                aria-label={f.oculta ? 'Mostrar la capa' : 'Ocultar la capa'}
                data-tip={f.oculta ? 'Mostrar' : 'Ocultar'}
                onClick={(e) => {
                  e.stopPropagation()
                  const el = elementoDeCapa(f.marco!.id, f.capa!)
                  if (el) el.style.display = f.oculta ? '' : 'none'
                  setVersion((v) => v + 1)
                  void useDiseno.getState().editar(f.marco!.id, [{ op: 'estilo', capa: f.capa!, estilos: { display: f.oculta ? null : 'none' } }], { etiqueta: f.oculta ? 'mostrar la capa' : 'ocultar la capa' })
                }}
              >
                {f.oculta ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            ) : null
          }
        />
      )}
    />
  )
}

/** Páginas de sistema y de tabla: grupos → ítems. */
function CapasDeItems() {
  const pagina = useDiseno((s) => s.pagina)!
  const items = useDiseno((s) => s.items)
  const seleccion = useDiseno((s) => s.seleccion)
  const [cerrados, setCerrados] = useState<Set<string>>(() => new Set())
  const filas = useMemo(() => {
    const r: Fila[] = []
    const todos = (pagina.datos.tipos ?? []).flatMap((t) => items[t] ?? [])
    const grupos = new Map<string, ItemDiseno[]>()
    for (const i of todos) {
      const g = `${i.tipo}|${i.grupo || ''}`
      if (!grupos.has(g)) grupos.set(g, [])
      grupos.get(g)!.push(i)
    }
    for (const [g, lista] of grupos) {
      const key = `g:${g}`
      const abierta = !cerrados.has(key)
      const nombre = g.split('|')[1] || NOMBRE_TIPO[g.split('|')[0]!] || 'Sin grupo'
      r.push({ key, nivel: 0, tipo: 'grupo', nombre, icono: <SquareDashed size={14} />, hijos: true, abierta, cuenta: lista.length })
      if (abierta)
        for (const i of lista)
          r.push({ key: `i:${i.tipo}:${i.clave}`, nivel: 1, tipo: 'item', nombre: i.nombre, icono: iconoItem(i), item: `${i.tipo}:${i.clave}`, hijos: false, abierta: false })
    }
    return r
  }, [pagina, items, cerrados])
  const indiceActivo = filas.findIndex((f) => f.item && f.item === seleccion.item)
  if (!filas.length) return <p className="dz-izq__vacio">Todavía no hay nada en esta página.</p>
  return (
    <ListaVirtual
      filas={filas}
      indiceActivo={indiceActivo}
      render={(f) => (
        <FilaArbol
          f={f}
          activa={Boolean(f.item && f.item === seleccion.item)}
          resaltada={false}
          alAlternar={() =>
            setCerrados((c) => {
              const n = new Set(c)
              if (n.has(f.key)) n.delete(f.key)
              else n.add(f.key)
              return n
            })
          }
          alClic={() => {
            if (f.tipo === 'grupo')
              return setCerrados((c) => {
                const n = new Set(c)
                if (n.has(f.key)) n.delete(f.key)
                else n.add(f.key)
                return n
              })
            useDiseno.getState().seleccionar({ item: f.item! })
            window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar-item', { detail: { item: f.item } }))
          }}
        />
      )}
    />
  )
}

const NOMBRE_TIPO: Record<string, string> = {
  token: 'Tokens',
  estilo_texto: 'Estilos de texto',
  color_suelto: 'Colores sueltos',
  activo: 'Activos',
  fuente: 'Fuentes',
  hoja: 'Hojas',
  texto: 'Textos',
}

function iconoItem(i: ItemDiseno): ReactNode {
  const d = i.datos as unknown as Record<string, unknown>
  if ((i.tipo === 'token' && d.clase === 'color') || i.tipo === 'color_suelto')
    return <span className="dz-arbol__muestra" style={{ background: String(d.valor ?? 'transparent') }} />
  if (i.tipo === 'activo') return <IconoImagen size={14} />
  if (i.tipo === 'texto' || i.tipo === 'estilo_texto' || i.tipo === 'fuente') return <Type size={14} />
  return <Box size={14} />
}

function FilaArbol({
  f,
  activa,
  resaltada,
  alAlternar,
  alClic,
  alDobleClic,
  alEntrar,
  alSalir,
  acciones,
}: {
  f: Fila
  activa: boolean
  resaltada: boolean
  alAlternar: (todo: boolean) => void
  alClic: () => void
  alDobleClic?: () => void
  alEntrar?: () => void
  alSalir?: () => void
  acciones?: ReactNode
}) {
  return (
    <div
      className={`dz-arbol__fila dz-arbol__fila--${f.tipo}${activa ? ' dz-arbol__fila--activa' : ''}${resaltada ? ' dz-arbol__fila--sobre' : ''}${f.oculta ? ' dz-arbol__fila--oculta' : ''}`}
      style={{ paddingLeft: 6 + f.nivel * 14 }}
      role="treeitem"
      aria-level={f.nivel + 1}
      aria-selected={activa}
      aria-expanded={f.hijos ? f.abierta : undefined}
      onMouseEnter={alEntrar}
      onMouseLeave={alSalir}
      onClick={alClic}
      onDoubleClick={alDobleClic}
    >
      <button
        className={`dz-arbol__flecha${f.hijos ? '' : ' dz-arbol__flecha--nada'}${f.abierta ? ' dz-arbol__flecha--abierta' : ''}`}
        tabIndex={-1}
        aria-hidden
        onClick={(e) => {
          e.stopPropagation()
          if (f.hijos) alAlternar(e.altKey)
        }}
      >
        <ChevronRight size={12} />
      </button>
      <span className="dz-arbol__icono">{f.icono}</span>
      <span className="dz-arbol__nombre">{f.nombre}</span>
      {f.cuenta !== undefined && <span className="dz-arbol__cuenta">{f.cuenta}</span>}
      {acciones && <span className="dz-arbol__acciones">{acciones}</span>}
    </div>
  )
}

/** Lista virtual de alto fijo, sin biblioteca: solo se dibujan las filas visibles (y unas de margen). */
function ListaVirtual({ filas, render, indiceActivo }: { filas: Fila[]; render: (f: Fila) => ReactNode; indiceActivo: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [arriba, setArriba] = useState(0)
  const [alto, setAlto] = useState(400)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setAlto(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // la fila activa queda a la vista (sin mover el árbol si ya se ve)
  useEffect(() => {
    const el = ref.current
    if (!el || indiceActivo < 0) return
    const y = indiceActivo * ALTO
    if (y < el.scrollTop) el.scrollTop = y - ALTO
    else if (y + ALTO > el.scrollTop + el.clientHeight) el.scrollTop = y - el.clientHeight + ALTO * 2
  }, [indiceActivo])
  const desde = Math.max(0, Math.floor(arriba / ALTO) - 6)
  const hasta = Math.min(filas.length, Math.ceil((arriba + alto) / ALTO) + 6)
  return (
    <div ref={ref} className="dz-arbol" role="tree" aria-label="Capas" onScroll={(e) => setArriba(e.currentTarget.scrollTop)}>
      <div className="dz-arbol__alto" style={{ height: filas.length * ALTO }}>
        {filas.slice(desde, hasta).map((f, i) => (
          <div key={f.key} className="dz-arbol__lugar" style={{ transform: `translateY(${(desde + i) * ALTO}px)` }}>
            {render(f)}
          </div>
        ))}
      </div>
    </div>
  )
}
