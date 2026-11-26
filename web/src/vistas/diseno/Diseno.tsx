// La vista «Diseño» (plan 6.1): tres columnas fijas (panel izquierdo · lienzo · inspector) dentro de la escena de Telar.
// Se carga con lazy desde App.tsx. La página y la selección viven en la URL (/RC/tablero/diseno/celular?sel=m_1.a1b2c3).
import { Layers, PanelsTopLeft, Puzzle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { tinykeys } from 'tinykeys'
import { avisar, avisarError } from '../../estado/avisos'
import { useRuta } from '../../estado/ruta'
import { Girando } from '../../ui/comunes'
import { escribiendo } from '../../util/teclas'
import '../../estilos/diseno.css'
import { apiDiseno, urlRender } from './api'
import { esPropio, useDiseno, type Seleccion } from './estado'
import { Inspector } from './inspector/Inspector'
import LienzoDiseno from './lienzo/LienzoDiseno'
import { elementoDeCapa } from './lienzo/elegir'
import { PanelIzquierdo } from './panel-izq/PanelIzquierdo'
import { enlaceA, irADiseno, rutaDiseno, useRutaDiseno } from './ruta'
import { PaginaTabla } from './tabla/PaginaTabla'
import { ComoImportar, copiar, EstadoVacio } from './ui'
import { publicarComandosDiseno } from './comandos'
import { PREFIJADOS } from '../../../../compartido/diseno/prefijados'

/** Selección → texto de la URL: "m_1.a1b2c3", "m_1" o "item:token:--rc-azul". */
export function selATexto(s: Seleccion): string | null {
  if (s.item) return `item:${s.item}`
  if (!s.marco) return null
  return s.capa ? `${s.marco}.${s.capa}` : s.marco
}

function textoASel(t: string): Partial<Seleccion> {
  if (t.startsWith('item:')) return { item: t.slice(5), marco: null, capa: null }
  const i = t.indexOf('.')
  return i < 0 ? { marco: t, capa: null } : { marco: t.slice(0, i), capa: t.slice(i + 1) }
}

function useMedia(q: string) {
  const [si, setSi] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = () => setSi(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [q])
  return si
}

export default function Diseno() {
  const ruta = useRuta()
  const rd = useRutaDiseno()
  const resumen = useDiseno((s) => s.resumen)
  const error = useDiseno((s) => s.error)
  const pagina = useDiseno((s) => s.pagina)
  const marcos = useDiseno((s) => s.marcos)
  const cargandoPagina = useDiseno((s) => s.cargandoPagina)
  const paneles = useDiseno((s) => s.paneles)
  const izq = useDiseno((s) => s.pref.izq)
  const der = useDiseno((s) => s.pref.der)
  const estrecho = useMedia('(max-width: 1099px)')
  const [izqFlotante, setIzqFlotante] = useState(false)

  // proyecto
  useEffect(() => {
    if (ruta.prefijo) void useDiseno.getState().abrirProyecto(ruta.prefijo)
  }, [ruta.prefijo])
  // al volver a la vista, lo que haya cambiado mientras tanto
  useEffect(() => {
    const s = useDiseno.getState()
    if (s.resumen && s.prefijo === ruta.prefijo) {
      void s.recargarResumen()
      void s.recargarPagina()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // "Ver en PC / en celular" (otra página) y clic en un pin (abre el hilo en Notas)
  useEffect(() => {
    const ir = (e: Event) => {
      const { pagina, marco } = (e as CustomEvent<{ pagina: string; marco: string }>).detail
      const s = useDiseno.getState()
      const pg = s.resumen?.paginas.find((p) => p.id === pagina || p.slug === pagina)
      if (!pg) return
      if (pg.id === s.pagina?.id) window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar', { detail: { marco } }))
      else irADiseno({ pagina: pg.slug, sel: marco })
    }
    const pin = (e: Event) => {
      const { marco } = (e as CustomEvent<{ id: string; marco: string }>).detail
      const s = useDiseno.getState()
      s.seleccionar({ marco, capa: null })
      s.setPref({ pestanaInspector: 'notas' })
      s.set({ paneles: true })
    }
    window.addEventListener('telar:diseno-ir', ir)
    window.addEventListener('telar:diseno-pin', pin)
    return () => {
      window.removeEventListener('telar:diseno-ir', ir)
      window.removeEventListener('telar:diseno-pin', pin)
    }
  }, [])
  // eventos en vivo (estado/eventos.ts los reenvía como telar:diseno)
  useEffect(() => {
    const f = (e: Event) => useDiseno.getState().aplicarEvento((e as CustomEvent).detail)
    window.addEventListener('telar:diseno', f)
    return () => window.removeEventListener('telar:diseno', f)
  }, [])

  // página de la URL (o la primera)
  useEffect(() => {
    if (!resumen) return
    const visibles = resumen.paginas.filter((p) => !p.archivada)
    const buscada = rd.pagina ? visibles.find((p) => p.slug === rd.pagina || p.id === rd.pagina) : null
    if (!buscada) {
      const primera = visibles[0]
      if (primera) irADiseno({ pagina: primera.slug }, true)
      return
    }
    if (useDiseno.getState().pagina?.id !== buscada.id) void useDiseno.getState().abrirPagina(buscada.slug)
  }, [resumen, rd.pagina])

  // URL → selección (enlace directo, atrás y adelante)
  useEffect(() => {
    if (!pagina || cargandoPagina) return
    const s = useDiseno.getState()
    if ((rd.sel ?? null) === selATexto(s.seleccion)) return
    if (!rd.sel) return s.seleccionar({ marco: null, capa: null, item: null, marcos: [] })
    const nueva = textoASel(rd.sel)
    if (nueva.marco && !s.marcos.some((m) => m.id === nueva.marco)) return
    s.seleccionar(nueva)
    if (nueva.item) setTimeout(() => window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar-item', { detail: { item: nueva.item } })), 120)
    if (nueva.marco) requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar', { detail: { marco: nueva.marco, capa: nueva.capa ?? undefined } })))
  }, [rd.sel, pagina, cargandoPagina, marcos.length])
  // selección → URL (se reemplaza: no llena el historial)
  useEffect(
    () =>
      useDiseno.subscribe((s, a) => {
        if (s.seleccion !== a.seleccion && s.pagina && s.pagina.slug === rutaDiseno().pagina) irADiseno({ sel: selATexto(s.seleccion) }, true)
      }),
    [],
  )

  // comandos de la paleta (Ctrl/⌘+K)
  useEffect(() => {
    if (!resumen) return
    const s = () => useDiseno.getState()
    const marcoNuevo = (id: string) => {
      const p = PREFIJADOS.find((x) => x.id === id)!
      if (s().pagina?.origen === 'importado' || s().pagina?.tipo !== 'lienzo') return avisar({ texto: 'Abrí una página propia de lienzo para crear el marco (o usá "Página nueva").' })
      s().set({ herramienta: 'marco', marcoNuevo: { prefijado: p.id, ancho: p.ancho, alto: p.alto, nombre: p.nombre } })
    }
    publicarComandosDiseno([
      ...resumen.paginas
        .filter((p) => !p.archivada)
        .map((p) => ({ id: `pg:${p.id}`, etiqueta: `Página «${p.nombre}»`, buscar: 'ir pagina', accion: () => irADiseno({ pagina: p.slug }) })),
      { id: 'nuevo-historia', etiqueta: 'Marco nuevo: historia de Instagram', buscar: 'story reel 1080 1920', atajo: 'F', accion: () => marcoNuevo('instagram-historia') },
      { id: 'nuevo-posteo', etiqueta: 'Marco nuevo: posteo de Instagram', buscar: 'post 1080', accion: () => marcoNuevo('instagram-posteo') },
      { id: 'nuevo-presentacion', etiqueta: 'Marco nuevo: presentación', buscar: 'slide 1920', accion: () => marcoNuevo('presentacion') },
      { id: 'exportar', etiqueta: 'Exportar la selección (PNG a 2x)', buscar: 'descargar png', atajo: '$mod+Shift+E', accion: () => exportarSeleccion() },
      {
        id: 'sincronizar',
        etiqueta: 'Pedir sincronización del diseño',
        buscar: 'importar codigo',
        accion: () =>
          void apiDiseno
            .config(s().prefijo!, { pedir: true })
            .then(() => avisar({ texto: 'Pedido: la próxima vez que Claude sincronice, trae lo nuevo del código.', tipo: 'ok' }))
            .catch(avisarError),
      },
      { id: 'paneles', etiqueta: 'Esconder o mostrar los paneles', atajo: '$mod+\\', accion: () => s().set({ paneles: !s().paneles }) },
    ])
    return () => publicarComandosDiseno([])
  }, [resumen])

  // teclas de la vista (las del lienzo viven en LienzoDiseno)
  useEffect(() => {
    const s = () => useDiseno.getState()
    const una = (fn: (e: KeyboardEvent) => void) => (e: KeyboardEvent) => {
      if (escribiendo(e) || s().editandoTexto) return
      fn(e)
    }
    const irPagina = (paso: number) => {
      const r = s().resumen
      const pg = s().pagina
      if (!r || !pg) return
      const lista = r.paginas.filter((p) => !p.archivada)
      const i = lista.findIndex((p) => p.id === pg.id)
      const otra = lista[(i + paso + lista.length) % lista.length]
      if (otra) irADiseno({ pagina: otra.slug })
    }
    return tinykeys(window, {
      '$mod+Backslash': (e) => {
        e.preventDefault()
        s().set({ paneles: !s().paneles })
      },
      'Alt+Digit1': una((e) => (e.preventDefault(), s().setPref({ pestanaIzq: 'capas' }), s().set({ paneles: true }))),
      'Alt+Digit2': una((e) => (e.preventDefault(), s().setPref({ pestanaIzq: 'piezas' }), s().set({ paneles: true }))),
      'Alt+Digit8': una((e) => (e.preventDefault(), s().setPref({ pestanaInspector: 'diseno' }), s().set({ paneles: true }))),
      'Alt+Digit9': una((e) => (e.preventDefault(), s().setPref({ pestanaInspector: 'codigo' }), s().set({ paneles: true }))),
      '$mod+KeyF': (e) => {
        e.preventDefault()
        s().set({ paneles: true })
        window.dispatchEvent(new Event('telar:diseno-buscar'))
      },
      Slash: una((e) => {
        e.preventDefault()
        s().set({ paneles: true })
        window.dispatchEvent(new Event('telar:diseno-buscar'))
      }),
      PageUp: una((e) => (e.preventDefault(), irPagina(-1))),
      PageDown: una((e) => (e.preventDefault(), irPagina(1))),
      '$mod+KeyD': una((e) => {
        e.preventDefault()
        void duplicarSeleccion()
      }),
      Delete: una(() => void quitarSeleccion()),
      Backspace: una(() => void quitarSeleccion()),
      '$mod+Shift+KeyE': una((e) => {
        e.preventDefault()
        exportarSeleccion()
      }),
      '$mod+Shift+KeyC': una((e) => {
        e.preventDefault()
        const st = s()
        void copiar(enlaceA(st.pagina?.slug ?? null, selATexto(st.seleccion)), 'Enlace copiado')
      }),
    })
  }, [])

  const estilo = { '--dz-izq': `${izq}px`, '--dz-der': `${der}px` } as CSSProperties
  const sinNada = resumen && !resumen.paginas.some((p) => !p.archivada)
  const izqVisible = paneles && (!estrecho || izqFlotante)
  return (
    <div
      className={`diseno diseno--vista${paneles ? '' : ' diseno--sin-paneles'}${estrecho ? ' diseno--estrecho' : ''}${izqFlotante && estrecho ? ' diseno--izq-flotante' : ''}`}
      style={estilo}
    >
      {estrecho && paneles && (
        <nav className="diseno__tira" aria-label="Paneles de Diseño">
          <button className="boton-icono" data-tip="Páginas" data-tip-lado="derecha" onClick={() => setIzqFlotante((v) => !v)} aria-label="Páginas">
            <PanelsTopLeft size={18} />
          </button>
          <button
            className="boton-icono"
            data-tip="Capas"
            data-tip-lado="derecha"
            aria-label="Capas"
            onClick={() => {
              useDiseno.getState().setPref({ pestanaIzq: 'capas' })
              setIzqFlotante(true)
            }}
          >
            <Layers size={18} />
          </button>
          <button
            className="boton-icono"
            data-tip="Piezas"
            data-tip-lado="derecha"
            aria-label="Piezas"
            onClick={() => {
              useDiseno.getState().setPref({ pestanaIzq: 'piezas' })
              setIzqFlotante(true)
            }}
          >
            <Puzzle size={18} />
          </button>
        </nav>
      )}
      <AnimatePresence initial={false}>
        {izqVisible && (
          <motion.div
            key="izq"
            className="diseno__izq"
            initial={{ x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.15, 1, 0.3, 1] }}
          >
            <PanelIzquierdo alCerrar={estrecho ? () => setIzqFlotante(false) : undefined} />
            {!estrecho && <Agarradera lado="izq" />}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="diseno__centro">
        {!resumen && !error && (
          <div className="dz-centro-estado">
            <Girando tam={22} />
          </div>
        )}
        {error && !resumen && <div className="dz-centro-estado">No pude abrir Diseño: {error}</div>}
        {sinNada && <ProyectoVacio />}
        {resumen && !sinNada && pagina && (pagina.tipo === 'tabla' ? <PaginaTabla /> : <LienzoDiseno />)}
        {resumen && !sinNada && pagina && <VacioDePagina />}
      </div>
      <AnimatePresence initial={false}>
        {paneles && (
          <motion.div
            key="der"
            className="diseno__der"
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.15, 1, 0.3, 1] }}
          >
            <Agarradera lado="der" />
            <Inspector />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Borde que se arrastra para cambiar el ancho del panel (200 a 400 px). */
function Agarradera({ lado }: { lado: 'izq' | 'der' }) {
  const inicio = useRef<{ x: number; ancho: number } | null>(null)
  const mover = useCallback(
    (e: PointerEvent) => {
      if (!inicio.current) return
      const d = e.clientX - inicio.current.x
      const ancho = Math.round(Math.min(400, Math.max(200, inicio.current.ancho + (lado === 'izq' ? d : -d))))
      document.querySelector<HTMLElement>('.diseno--vista')?.style.setProperty(lado === 'izq' ? '--dz-izq' : '--dz-der', `${ancho}px`)
    },
    [lado],
  )
  const soltar = useCallback(
    (e: PointerEvent) => {
      if (!inicio.current) return
      const d = e.clientX - inicio.current.x
      const ancho = Math.round(Math.min(400, Math.max(200, inicio.current.ancho + (lado === 'izq' ? d : -d))))
      inicio.current = null
      document.querySelector('.diseno--vista')?.classList.remove('diseno--arrastrando')
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      useDiseno.getState().setPref(lado === 'izq' ? { izq: ancho } : { der: ancho })
    },
    [lado, mover],
  )
  return (
    <div
      className={`dz-agarradera dz-agarradera--${lado}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={lado === 'izq' ? 'Ancho del panel de capas' : 'Ancho del inspector'}
      onPointerDown={(e) => {
        e.preventDefault()
        const p = useDiseno.getState().pref
        inicio.current = { x: e.clientX, ancho: lado === 'izq' ? p.izq : p.der }
        document.querySelector('.diseno--vista')?.classList.add('diseno--arrastrando')
        window.addEventListener('pointermove', mover)
        window.addEventListener('pointerup', soltar)
      }}
      onDoubleClick={() => useDiseno.getState().setPref(lado === 'izq' ? { izq: 248 } : { der: 288 })}
    />
  )
}

function ProyectoVacio() {
  const prefijo = useDiseno((s) => s.prefijo)!
  const [explicar, setExplicar] = useState(false)
  return (
    <div className="dz-centro-estado">
      <EstadoVacio
        icono={<PanelsTopLeft size={28} />}
        titulo="Todavía no hay diseño en este proyecto"
        ayuda="Importá el sistema de diseño de su código o empezá una página en blanco."
      >
        <button
          className="boton boton--primario"
          onClick={async () => {
            try {
              const p = await apiDiseno.crearPagina(prefijo, 'Página 1')
              await useDiseno.getState().recargarResumen()
              irADiseno({ pagina: p.slug })
            } catch (e) {
              avisarError(e)
            }
          }}
        >
          Página nueva
        </button>
        <button className="boton" onClick={() => setExplicar((v) => !v)}>
          Cómo importar
        </button>
      </EstadoVacio>
      {explicar && <ComoImportar />}
    </div>
  )
}

function VacioDePagina() {
  const pagina = useDiseno((s) => s.pagina)!
  const marcos = useDiseno((s) => s.marcos)
  const cargando = useDiseno((s) => s.cargandoPagina)
  const items = useDiseno((s) => s.items)
  const prefijo = useDiseno((s) => s.prefijo)!
  if (cargando) return null
  if (pagina.tipo === 'lienzo' && marcos.length === 0) {
    if (pagina.origen === 'importado')
      return (
        <div className="dz-centro-estado dz-centro-estado--encima">
          <EstadoVacio
            icono={<PanelsTopLeft size={28} />}
            titulo="Falta sincronizar las pantallas"
            ayuda="Los colores, los íconos y los textos ya están. Para ver las pantallas hay que abrir la interfaz del proyecto en un navegador."
          >
            <button
              className="boton"
              onClick={() =>
                apiDiseno
                  .config(prefijo, { pedir: true })
                  .then(() => avisar({ texto: 'Pedido: la próxima vez que Claude sincronice, trae las pantallas.', tipo: 'ok' }))
                  .catch(avisarError)
              }
            >
              Pedir sincronización
            </button>
          </EstadoVacio>
        </div>
      )
    return (
      <div className="dz-centro-estado dz-centro-estado--encima">
        <EstadoVacio
          icono={<PanelsTopLeft size={28} />}
          titulo="Esta página está vacía"
          ayuda={
            <>
              Creá un marco con <kbd className="dz-tecla">F</kbd> o pedile a Claude que arme uno.
            </>
          }
        />
      </div>
    )
  }
  if (pagina.tipo === 'sistema' && (pagina.datos.tipos ?? []).every((t) => items[t] && items[t]!.length === 0))
    return (
      <div className="dz-centro-estado dz-centro-estado--encima">
        <EstadoVacio icono={<PanelsTopLeft size={28} />} titulo="Todavía no hay nada acá" ayuda="Cuando se importe el sistema de diseño (o Claude defina tokens), aparece en esta página." />
      </div>
    )
  return null
}

// ───────── acciones sobre la selección (teclado y menús) ─────────

export async function duplicarSeleccion() {
  const s = useDiseno.getState()
  const p = s.prefijo
  const m = s.marcos.find((x) => x.id === s.seleccion.marco)
  if (!p || !m || s.seleccion.capa) return
  try {
    const r = await apiDiseno.duplicar(p, m.id)
    const nuevo = r[0]
    if (!nuevo) return
    await s.recargarResumen()
    if (nuevo.paginaId !== s.pagina?.id) {
      const pg = useDiseno.getState().resumen?.paginas.find((x) => x.id === nuevo.paginaId)
      avisar({ texto: `Copia editable creada en «${pg?.nombre ?? 'Copias editables'}».`, tipo: 'ok', accion: pg ? { etiqueta: 'Ir', fn: () => irADiseno({ pagina: pg.slug, sel: nuevo.id }) } : undefined })
      return
    }
    await s.recargarPagina()
    useDiseno.getState().seleccionar({ marco: nuevo.id, capa: null })
  } catch (e) {
    avisarError(e)
  }
}

export async function quitarSeleccion() {
  const s = useDiseno.getState()
  const p = s.prefijo
  const m = s.marcos.find((x) => x.id === s.seleccion.marco)
  if (!p || !m) return
  if (!esPropio(m)) return avisar({ texto: 'Este marco viene del código: no se borra desde acá.' })
  if (s.seleccion.capa) {
    const capa = s.seleccion.capa
    elementoDeCapa(m.id, capa)?.remove()
    s.seleccionar({ marco: m.id, capa: null })
    await s.editar(m.id, [{ op: 'quitar', capa }], { etiqueta: 'quitar la capa' })
    return
  }
  try {
    await apiDiseno.archivarMarco(p, m.id, true)
    s.seleccionar({ marco: null, capa: null, marcos: [] })
    await s.recargarPagina()
    avisar({
      texto: `Archivé «${m.nombre}».`,
      accion: {
        etiqueta: 'Deshacer',
        fn: () =>
          void apiDiseno
            .archivarMarco(p, m.id, false)
            .then(() => useDiseno.getState().recargarPagina())
            .catch(avisarError),
      },
    })
  } catch (e) {
    avisarError(e)
  }
}

export function exportarSeleccion(o: { formato?: string; escala?: number; sinFondo?: boolean } = {}) {
  const s = useDiseno.getState()
  const p = s.prefijo
  const ids = s.seleccion.marcos.length ? s.seleccion.marcos : s.seleccion.marco ? [s.seleccion.marco] : []
  if (!p || !ids.length) return avisar({ texto: 'Elegí un marco para exportar.' })
  for (const id of ids) {
    const a = document.createElement('a')
    a.href = urlRender(p, id, { formato: o.formato ?? 'png', escala: o.escala ?? 2, sinFondo: o.sinFondo, descargar: true })
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
}
