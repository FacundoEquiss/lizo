// Página de tabla (plan 6.12): los textos del proyecto en una tabla virtual a pantalla completa del centro. Columnas: Clave ·
// Texto (con la letra del proyecto, si se pide) · Original · Largo · Usos. Grupos con cabecera pegada arriba, orden por
// columna y filtro. Las llaves de las plantillas ({100}) se resaltan. La selección abre el inspector como en el resto.
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DatosTexto, ItemDiseno } from '../../../../../compartido/diseno/tipos'
import { SIN_ITEMS, useDiseno } from '../estado'
import { resaltarLlaves } from '../inspector/Item'
import { usarFuentesDelProyecto } from '../sistema/PaginaSistema'
import { Interruptor } from '../ui'

const ALTO = 36
type Columna = 'clave' | 'texto' | 'original' | 'largo' | 'usos'
type Fila = { tipo: 'grupo'; nombre: string; n: number } | { tipo: 'texto'; item: ItemDiseno<'texto'> }

export function PaginaTabla() {
  const items = useDiseno((s) => (s.items.texto ?? SIN_ITEMS) as ItemDiseno<'texto'>[])
  const cargando = useDiseno((s) => s.cargandoItems.texto)
  const fuentes = useDiseno((s) => (s.items.fuente ?? SIN_ITEMS) as ItemDiseno<'fuente'>[])
  const prefijo = useDiseno((s) => s.prefijo)!
  const seleccion = useDiseno((s) => s.seleccion.item)
  const mapa = usarFuentesDelProyecto(fuentes, prefijo)
  const [filtro, setFiltro] = useState('')
  const [orden, setOrden] = useState<{ col: Columna; asc: boolean }>({ col: 'clave', asc: true })
  const [conLetra, setConLetra] = useState(() => localStorage.getItem('telar.diseno.tabla.letra') === 'si')
  const [arriba, setArriba] = useState(0)
  const [alto, setAlto] = useState(600)
  const ref = useRef<HTMLDivElement>(null)
  const letra = fuentes[0] ? mapa.get(fuentes[0].datos.familia) : undefined

  useEffect(() => {
    void useDiseno.getState().cargarItems('texto')
    void useDiseno.getState().cargarItems('fuente')
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setAlto(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const filas = useMemo<Fila[]>(() => {
    const t = filtro.trim().toLowerCase()
    const lista = items.filter((i) => !i.archivado && (!t || `${i.clave} ${i.datos.valor} ${i.datos.claveOriginal ?? ''}`.toLowerCase().includes(t)))
    const valor = (i: ItemDiseno<'texto'>): string | number =>
      orden.col === 'clave' ? i.clave : orden.col === 'texto' ? i.datos.valor : orden.col === 'original' ? (i.datos.claveOriginal ?? '') : orden.col === 'largo' ? i.datos.valor.length : (i.datos.usos?.length ?? 0)
    lista.sort((a, b) => {
      const va = valor(a)
      const vb = valor(b)
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')
      return orden.asc ? c : -c
    })
    const grupos = new Map<string, ItemDiseno<'texto'>[]>()
    for (const i of lista) {
      const g = i.grupo || i.datos.grupo || 'Textos'
      if (!grupos.has(g)) grupos.set(g, [])
      grupos.get(g)!.push(i)
    }
    const r: Fila[] = []
    for (const [g, l] of [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))) {
      r.push({ tipo: 'grupo', nombre: g, n: l.length })
      for (const item of l) r.push({ tipo: 'texto', item })
    }
    return r
  }, [items, filtro, orden])

  // la fila elegida queda a la vista
  useEffect(() => {
    const el = ref.current
    if (!el || !seleccion?.startsWith('texto:')) return
    const i = filas.findIndex((f) => f.tipo === 'texto' && `texto:${f.item.clave}` === seleccion)
    if (i < 0) return
    const y = i * ALTO
    if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - ALTO * 2) el.scrollTop = Math.max(0, y - el.clientHeight / 3)
  }, [seleccion, filas])

  const desde = Math.max(0, Math.floor(arriba / ALTO) - 8)
  const hasta = Math.min(filas.length, Math.ceil((arriba + alto) / ALTO) + 8)
  // el grupo de la primera fila visible queda pegado arriba
  let grupoArriba: Fila | null = null
  for (let i = Math.min(filas.length - 1, Math.floor(arriba / ALTO)); i >= 0; i--)
    if (filas[i]!.tipo === 'grupo') {
      grupoArriba = filas[i]!
      break
    }
  const total = filas.filter((f) => f.tipo === 'texto').length

  const Cab = ({ col, nombre, clase }: { col: Columna; nombre: string; clase: string }) => (
    <button
      className={`dz-tabla__cab-celda ${clase}${orden.col === col ? ' dz-tabla__cab-celda--activa' : ''}`}
      onClick={() => setOrden((o) => ({ col, asc: o.col === col ? !o.asc : true }))}
      aria-sort={orden.col === col ? (orden.asc ? 'ascending' : 'descending') : 'none'}
    >
      {nombre}
      {orden.col === col && (orden.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  )

  return (
    <div className="dz-tabla">
      <div className="dz-tabla__barra">
        <label className="dz-tabla__filtro">
          <Search size={14} aria-hidden />
          <input value={filtro} placeholder={`Filtrar ${total} textos`} aria-label="Filtrar los textos" onChange={(e) => setFiltro(e.currentTarget.value)} />
        </label>
        {letra && (
          <label className="dz-tabla__letra">
            <span>Con la letra del proyecto</span>
            <Interruptor
              etiqueta="Con la letra del proyecto"
              valor={conLetra}
              alCambiar={(v) => {
                setConLetra(v)
                localStorage.setItem('telar.diseno.tabla.letra', v ? 'si' : 'no')
              }}
            />
          </label>
        )}
        <span className="dz-tabla__cuenta">{cargando ? 'Cargando…' : `${total} textos`}</span>
      </div>
      <div className="dz-tabla__cab" role="row">
        <Cab col="clave" nombre="Clave" clase="dz-tabla__c-clave" />
        <Cab col="texto" nombre="Texto" clase="dz-tabla__c-texto" />
        <Cab col="original" nombre="Original" clase="dz-tabla__c-original" />
        <Cab col="largo" nombre="Largo" clase="dz-tabla__c-num" />
        <Cab col="usos" nombre="Usos" clase="dz-tabla__c-num" />
      </div>
      <div ref={ref} className="dz-tabla__cuerpo" role="grid" aria-rowcount={filas.length} onScroll={(e) => setArriba(e.currentTarget.scrollTop)}>
        {grupoArriba && grupoArriba.tipo === 'grupo' && arriba > 0 && (
          <div className="dz-tabla__grupo dz-tabla__grupo--pegado">
            {grupoArriba.nombre} <span>{grupoArriba.n}</span>
          </div>
        )}
        <div style={{ height: filas.length * ALTO, position: 'relative' }}>
          {filas.slice(desde, hasta).map((f, k) => {
            const i = desde + k
            const estilo = { transform: `translateY(${i * ALTO}px)` }
            if (f.tipo === 'grupo')
              return (
                <div key={`g:${f.nombre}`} className="dz-tabla__grupo" style={estilo}>
                  {f.nombre} <span>{f.n}</span>
                </div>
              )
            const d = f.item.datos as DatosTexto
            const elegida = seleccion === `texto:${f.item.clave}`
            return (
              <div
                key={f.item.clave}
                role="row"
                aria-selected={elegida}
                className={`dz-tabla__fila${elegida ? ' dz-tabla__fila--elegida' : ''}`}
                style={estilo}
                data-item={`texto:${f.item.clave}`}
                onClick={() => useDiseno.getState().seleccionar({ item: `texto:${f.item.clave}` })}
              >
                <span className="dz-tabla__c-clave dz-tabla__mono" title={f.item.clave}>
                  {f.item.clave}
                </span>
                <span className="dz-tabla__c-texto" style={conLetra && letra ? { fontFamily: `"${letra}", var(--fuente)`, fontSize: 15 } : undefined} title={d.valor}>
                  {resaltarLlaves(d.valor)}
                </span>
                <span className="dz-tabla__c-original dz-tabla__mono" title={d.claveOriginal ?? (d.archivo ? `${d.archivo}:${d.linea ?? 1}` : '')}>
                  {d.claveOriginal ?? (d.archivo ? `${d.archivo.split('/').pop()}:${d.linea ?? 1}` : '')}
                </span>
                <span className="dz-tabla__c-num dz-tabla__mono">{d.valor.length}</span>
                <span className="dz-tabla__c-num dz-tabla__mono">{d.usos?.length ?? '–'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
