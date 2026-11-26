// Piezas (plan 6.2): buscador propio y tres grupos plegables — Piezas (miniatura, nombre, cantidad de variantes),
// Plantillas y Activos (grilla de 56 px). Clic: la muestra en el inspector. "Insertar" (o Enter): centrada en el marco propio
// seleccionado. Doble clic: va a su hoja de variantes.
import { ChevronRight, Component, LayoutTemplate, Plus, Search, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DatosActivo, DatosPieza, DatosPlantilla, ItemDiseno, MarcoResumen } from '../../../../../compartido/diseno/tipos'
import { avisar, avisarError } from '../../../estado/avisos'
import { apiDiseno, urlMiniatura } from '../api'
import { insertarEnMarco } from '../editar/insertar'
import { useDiseno } from '../estado'
import { irADiseno } from '../ruta'

/** Las hojas de variantes de las piezas (marcos con datos.pieza en las páginas Piezas y Componentes). */
function useHojasDePiezas(): Map<string, MarcoResumen & { paginaSlug: string }> {
  const prefijo = useDiseno((s) => s.prefijo)!
  const resumen = useDiseno((s) => s.resumen)
  const [mapa, setMapa] = useState(new Map<string, MarcoResumen & { paginaSlug: string }>())
  useEffect(() => {
    if (!resumen) return
    let vivo = true
    const paginas = resumen.paginas.filter((p) => !p.archivada && p.tipo === 'lienzo' && /pieza|component/i.test(p.slug + p.nombre))
    Promise.all(paginas.map((p) => apiDiseno.pagina(prefijo, p.id).then((r) => r.marcos.map((m) => ({ ...m, paginaSlug: p.slug })))))
      .then((listas) => {
        if (!vivo) return
        const m = new Map<string, MarcoResumen & { paginaSlug: string }>()
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

/** Pone una pieza centrada en el marco propio seleccionado. */
export async function insertarPieza(clave: string, pieza: DatosPieza) {
  const s = useDiseno.getState()
  const m = s.marcos.find((x) => x.id === s.seleccion.marco)
  if (!m || m.origen !== 'propio') return avisar({ texto: 'Elegí un marco propio para insertar la pieza.' })
  const ancho = pieza.ancho ?? 200
  const alto = pieza.alto ?? 80
  const x = Math.max(0, Math.round(m.ancho / 2 - ancho / 2))
  const y = Math.max(0, Math.round(m.alto / 2 - alto / 2))
  await insertarEnMarco(m.id, 'caja', x, y, { html: `<div data-pieza="${clave}" style="position:absolute;left:${x}px;top:${y}px"></div>` })
}

export function Piezas() {
  const prefijo = useDiseno((s) => s.prefijo)!
  const items = useDiseno((s) => s.items)
  const seleccion = useDiseno((s) => s.seleccion)
  const [q, setQ] = useState('')
  const [cerrados, setCerrados] = useState<Set<string>>(() => new Set())
  const hojas = useHojasDePiezas()

  useEffect(() => {
    const s = useDiseno.getState()
    void s.cargarItems('pieza')
    void s.cargarItems('plantilla')
    void s.cargarItems('activo')
  }, [])

  const filtrar = <T extends ItemDiseno>(l: T[] | undefined) => {
    const t = q.trim().toLowerCase()
    const lista = (l ?? []).filter((i) => !i.archivado)
    return t ? lista.filter((i) => (i.nombre + ' ' + i.clave + ' ' + i.grupo).toLowerCase().includes(t)) : lista
  }
  const piezas = useMemo(() => filtrar(items.pieza as ItemDiseno<'pieza'>[] | undefined), [items.pieza, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const plantillas = useMemo(() => filtrar(items.plantilla as ItemDiseno<'plantilla'>[] | undefined), [items.plantilla, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const activos = useMemo(() => filtrar(items.activo as ItemDiseno<'activo'>[] | undefined), [items.activo, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const alternar = (g: string) =>
    setCerrados((c) => {
      const n = new Set(c)
      if (n.has(g)) n.delete(g)
      else n.add(g)
      return n
    })
  const elegido = seleccion.item

  const subir = () => {
    const i = document.createElement('input')
    i.type = 'file'
    i.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif'
    i.multiple = true
    i.onchange = async () => {
      for (const f of Array.from(i.files ?? [])) {
        try {
          await apiDiseno.subirActivo(prefijo, f, { nombre: f.name.replace(/\.\w+$/, '') })
        } catch (e) {
          avisarError(e)
        }
      }
      void useDiseno.getState().cargarItems('activo', true)
    }
    i.click()
  }

  const vacio = !piezas.length && !plantillas.length && !activos.length
  return (
    <div className="dz-piezas">
      <label className="dz-piezas__buscar">
        <Search size={13} aria-hidden />
        <input value={q} placeholder="Buscar piezas y activos" aria-label="Buscar piezas y activos" onChange={(e) => setQ(e.currentTarget.value)} />
      </label>
      <div className="dz-piezas__cuerpo">
        {vacio && <p className="dz-izq__vacio">{q ? `Nada con «${q}».` : 'Todavía no hay piezas, plantillas ni activos.'}</p>}
        <Grupo titulo="Piezas" n={piezas.length} cerrado={cerrados.has('piezas')} alAlternar={() => alternar('piezas')}>
          {piezas.map((p) => {
            const hoja = hojas.get(p.clave)
            const variantes = p.datos.propiedades.filter((x) => x.clase === 'variante').reduce((n, v) => n * Math.max(1, v.valores?.length ?? 1), 1)
            const activa = elegido === `pieza:${p.clave}`
            return (
              <div
                key={p.clave}
                className={`dz-pieza${activa ? ' dz-pieza--activa' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => useDiseno.getState().seleccionar({ item: `pieza:${p.clave}` })}
                onDoubleClick={() => hoja && irADiseno({ pagina: hoja.paginaSlug, sel: hoja.id })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void insertarPieza(p.clave, p.datos)
                }}
              >
                <span className="dz-pieza__mini">
                  {hoja ? <img src={urlMiniatura(prefijo, hoja)} alt="" loading="lazy" decoding="async" /> : <Component size={18} />}
                </span>
                <span className="dz-pieza__datos">
                  <span className="dz-pieza__nombre">{p.nombre}</span>
                  <span className="dz-pieza__detalle">
                    {variantes > 1 ? `${variantes} variantes` : 'sin variantes'}
                    {p.origen === 'importado' ? ' · del código' : ''}
                  </span>
                </span>
                <button
                  className="boton boton--chico dz-pieza__insertar"
                  onClick={(e) => {
                    e.stopPropagation()
                    void insertarPieza(p.clave, p.datos)
                  }}
                  aria-label={`Insertar ${p.nombre}`}
                  data-tip="Insertar en el marco seleccionado"
                >
                  <Plus size={13} />
                </button>
              </div>
            )
          })}
        </Grupo>
        <Grupo titulo="Plantillas" n={plantillas.length} cerrado={cerrados.has('plantillas')} alAlternar={() => alternar('plantillas')}>
          {plantillas.map((p) => (
            <div
              key={p.clave}
              className={`dz-pieza${elegido === `plantilla:${p.clave}` ? ' dz-pieza--activa' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => useDiseno.getState().seleccionar({ item: `plantilla:${p.clave}` })}
              onKeyDown={(e) => e.key === 'Enter' && void crearDesdePlantilla(p)}
            >
              <span className="dz-pieza__mini dz-pieza__mini--plantilla" style={{ aspectRatio: `${(p.datos as DatosPlantilla).ancho} / ${(p.datos as DatosPlantilla).alto}` }}>
                <LayoutTemplate size={16} />
              </span>
              <span className="dz-pieza__datos">
                <span className="dz-pieza__nombre">{p.nombre}</span>
                <span className="dz-pieza__detalle">
                  {(p.datos as DatosPlantilla).ancho} × {(p.datos as DatosPlantilla).alto} · {(p.datos as DatosPlantilla).ranuras.length} ranuras
                </span>
              </span>
              <button
                className="boton boton--chico dz-pieza__insertar"
                onClick={(e) => {
                  e.stopPropagation()
                  void crearDesdePlantilla(p)
                }}
                aria-label={`Crear un marco con ${p.nombre}`}
                data-tip="Crear un marco con esta plantilla"
              >
                <Plus size={13} />
              </button>
            </div>
          ))}
        </Grupo>
        <Grupo
          titulo="Activos"
          n={activos.length}
          cerrado={cerrados.has('activos')}
          alAlternar={() => alternar('activos')}
          accion={
            <button className="boton-icono boton-icono--chico" onClick={subir} aria-label="Subir imágenes" data-tip="Subir imágenes">
              <Upload size={13} />
            </button>
          }
        >
          <div className="dz-activos-grilla">
            {activos.slice(0, 600).map((a) => (
              <button
                key={a.clave}
                className={`dz-activo-celda${elegido === `activo:${a.clave}` ? ' dz-activo-celda--activa' : ''}`}
                title={`${a.nombre} · ${(a.datos as DatosActivo).ancho}×${(a.datos as DatosActivo).alto}`}
                onClick={() => useDiseno.getState().seleccionar({ item: `activo:${a.clave}` })}
              >
                <img src={(a.datos as DatosActivo).ruta} alt={a.nombre} loading="lazy" decoding="async" draggable={false} />
              </button>
            ))}
          </div>
          {activos.length > 600 && <p className="dz-izq__vacio">Y {activos.length - 600} más: buscalos por nombre.</p>}
        </Grupo>
      </div>
    </div>
  )
}

/** Crea un marco desde una plantilla en la página propia actual (o en "Diseños" si la actual viene del código). */
export async function crearDesdePlantilla(p: ItemDiseno) {
  const s = useDiseno.getState()
  const prefijo = s.prefijo
  if (!prefijo) return
  const destino = s.pagina && s.pagina.origen === 'propio' && s.pagina.tipo === 'lienzo' ? s.pagina.id : 'Diseños'
  try {
    const r = await apiDiseno.crearMarco(prefijo, { pagina: destino, nombre: p.nombre, plantilla: p.clave })
    await s.recargarResumen()
    if (r.marco.paginaId !== s.pagina?.id) {
      const pg = useDiseno.getState().resumen?.paginas.find((x) => x.id === r.marco.paginaId)
      if (pg) irADiseno({ pagina: pg.slug, sel: r.marco.id })
      return
    }
    await s.recargarPagina()
    useDiseno.getState().seleccionar({ marco: r.marco.id, capa: null })
    window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar', { detail: { marco: r.marco.id } }))
  } catch (e) {
    avisarError(e)
  }
}

function Grupo({ titulo, n, cerrado, alAlternar, accion, children }: { titulo: string; n: number; cerrado: boolean; alAlternar: () => void; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="dz-piezas__grupo">
      <header className="dz-izq__seccion dz-izq__seccion--plegable">
        <button className="dz-piezas__plegar" onClick={alAlternar} aria-expanded={!cerrado}>
          <ChevronRight size={12} className={cerrado ? '' : 'dz-girada'} />
          <span>{titulo}</span>
          <span className="dz-piezas__n">{n}</span>
        </button>
        {accion}
      </header>
      {!cerrado && n > 0 && children}
    </section>
  )
}
