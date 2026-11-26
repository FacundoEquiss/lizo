// Cambiar de proyecto y de tablero (plan del celular, 4.2). Una hoja desde abajo, entera bajo el pulgar: se cambia de
// tablero pocas veces por sesión, así que no merece un cajón ni un gesto de borde. Tocar un proyecto lo despliega (no
// navega: el destino real es un tablero); tocar un tablero va ahí. Mantener apretado un tablero: Renombrar, Vistas o Archivar.
// «Nuevo tablero» abre una hoja con el nombre y el tipo (Tablero, Diagrama, Diseño o Completo): un tablero tiene solo las vistas que
// necesita (compartido/vistas.ts). Cada tablero lleva el ícono de su tipo.
import { Archive, ArchiveRestore, ChevronDown, Layers, Pencil, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Proyecto, TableroResumen } from '../../../../compartido/tipos'
import { TIPO_DE_FABRICA, tieneVista, vistaInicial, VISTAS_DEL_TIPO, type TipoTablero } from '../../../../compartido/vistas'
import { api } from '../../estado/api'
import { avisar, avisarError } from '../../estado/avisos'
import { irA, rutaActual } from '../../estado/ruta'
import { useTienda } from '../../estado/tienda'
import { ElegirTipoTablero, IconoTablero } from '../../ui/TipoTablero'
import { PanelArchivoHecho } from '../../vistas/kanban/ArchivoHecho'
import { PanelVistas } from '../../vistas/lateral/PanelVistas'
import { useMovil } from '../estado'
import { FilaTactil, SelloProyecto } from '../ui/FilaTactil'
import { HojaInferior, useHoja } from '../ui/HojaInferior'
import { useMantenerApretado } from '../ui/mantener'

const refrescarProyectos = async () => useTienda.setState({ proyectos: await api.proyectos() })

export function SelectorTablero() {
  const abierta = useMovil((s) => s.hoja === 'tableros')
  const cerrar = useMovil((s) => s.cerrar)
  const proyectos = useTienda((s) => s.proyectos)
  const actual = useTienda((s) => s.tablero?.proyecto.id)
  const [desplegados, setDesplegados] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (abierta) setDesplegados(new Set(actual ? [actual] : []))
  }, [abierta, actual])

  return (
    <HojaInferior abierta={abierta} alCerrar={cerrar} titulo="Proyectos" className="selector-tablero">
      {proyectos.map((p) => (
        <ProyectoFila
          key={p.id}
          proyecto={p}
          desplegado={desplegados.has(p.id)}
          alternar={() =>
            setDesplegados((d) => {
              const n = new Set(d)
              if (n.has(p.id)) n.delete(p.id)
              else n.add(p.id)
              return n
            })
          }
        />
      ))}
      <NuevoProyecto />
    </HojaInferior>
  )
}

function NuevoProyecto() {
  const hoja = useHoja()
  return (
    <FilaTactil
      className="selector-tablero__nuevo-proyecto"
      icono={<Plus size={20} />}
      texto="Nuevo proyecto"
      onClick={() => hoja?.cerrarYLuego(() => useTienda.getState().setDialogo('nuevo-proyecto'))}
    />
  )
}

function ProyectoFila({ proyecto: p, desplegado, alternar }: { proyecto: Proyecto; desplegado: boolean; alternar: () => void }) {
  const tablero = useTienda((s) => s.tablero)
  const esActual = tablero?.proyecto.id === p.id
  return (
    <section className={`selector-tablero__proyecto${esActual ? ' selector-tablero__proyecto--actual' : ''}`}>
      <button type="button" className="fila-tactil fila-tactil--56 selector-tablero__cabecera" onClick={alternar} aria-expanded={desplegado}>
        <SelloProyecto proyecto={p} tam={36} />
        <span className="fila-tactil__texto">
          <span className="fila-tactil__principal selector-tablero__nombre">{p.nombre}</span>
        </span>
        <ChevronDown size={18} className={`selector-tablero__flecha${desplegado ? ' selector-tablero__flecha--abierta' : ''}`} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {desplegado && (
          <motion.div
            className="selector-tablero__tableros"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.15, 1, 0.3, 1] }}
          >
            {p.tableros.map((t) => (
              <FilaTablero key={t.id} proyecto={p} tablero={t} />
            ))}
            <NuevoTablero proyecto={p} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function FilaTablero({ proyecto: p, tablero: t }: { proyecto: Proyecto; tablero: TableroResumen }) {
  const hoja = useHoja()
  const tablero = useTienda((s) => s.tablero)
  const esActual = tablero?.tablero.id === t.id
  const abiertas = esActual
    ? tablero!.tarjetas.filter((x) => !x.archivada).length
    : ((t as TableroResumen & { abiertas?: number }).abiertas ?? null)
  const [menu, setMenu] = useState(false)
  const [renombrando, setRenombrando] = useState(false)
  const [archivoHecho, setArchivoHecho] = useState(false)
  const [vistas, setVistas] = useState(false)
  const { fueMantener, ...gestos } = useMantenerApretado(() => setMenu(true))

  const ir = () => {
    if (fueMantener()) return
    // Se queda en la vista que se estaba mirando si este tablero la tiene; si no, entra por la primera que tiene.
    const actual = rutaActual().vista
    hoja?.cerrarYLuego(() => irA({ prefijo: p.prefijo, slug: t.slug, vista: tieneVista(t, actual) ? actual : vistaInicial(t.vistas), tarjeta: null }))
  }

  const archivar = async () => {
    setMenu(false)
    if (p.tableros.length <= 1) return avisar({ texto: 'Un proyecto necesita al menos un tablero.' })
    try {
      await api.actualizarTablero(t.id, { archivado: true })
      await refrescarProyectos()
      if (esActual) {
        const otro = p.tableros.find((x) => x.id !== t.id)
        if (otro) irA({ prefijo: p.prefijo, slug: otro.slug, tarjeta: null }, true)
      }
      avisar({
        texto: `Archivaste «${t.nombre}»`,
        accion: {
          etiqueta: 'Deshacer',
          fn: async () => {
            await api.actualizarTablero(t.id, { archivado: false })
            await refrescarProyectos()
          },
        },
      })
    } catch (e) {
      avisarError(e)
    }
  }

  if (renombrando)
    return (
      <CampoEnLinea
        inicial={t.nombre}
        etiqueta="Nombre del tablero"
        boton="Guardar"
        alCancelar={() => setRenombrando(false)}
        alGuardar={async (nombre) => {
          setRenombrando(false)
          if (nombre === t.nombre) return
          try {
            await api.actualizarTablero(t.id, { nombre })
            await refrescarProyectos()
            if (esActual) useTienda.getState().recargarTablero()
          } catch (e) {
            avisarError(e)
          }
        }}
      />
    )

  return (
    <>
      <button
        type="button"
        className={`fila-tactil fila-tactil--48 selector-tablero__tablero${esActual ? ' selector-tablero__tablero--actual' : ''}`}
        onClick={ir}
        aria-current={esActual ? 'page' : undefined}
        {...gestos}
      >
        <IconoTablero vistas={t.vistas} tam={18} className="selector-tablero__icono" />
        <span className="fila-tactil__texto">
          <span className="fila-tactil__principal">{t.nombre}</span>
        </span>
        {abiertas != null && tieneVista(t, 'kanban') && (
          <span className="fila-tactil__detalle" aria-label={`${abiertas} tarjetas abiertas`}>
            {abiertas}
          </span>
        )}
      </button>
      <HojaInferior abierta={menu} alCerrar={() => setMenu(false)} titulo={t.nombre}>
        <FilaTactil
          icono={<Pencil size={20} />}
          texto="Renombrar"
          alto={48}
          onClick={() => {
            setMenu(false)
            setRenombrando(true)
          }}
        />
        <FilaTactil
          icono={<Layers size={20} />}
          texto="Vistas"
          bajada="Sumar o sacar Kanban, Lienzo o Diseño"
          alto={56}
          onClick={() => {
            setMenu(false)
            setVistas(true)
          }}
        />
        {tieneVista(t, 'kanban') && (
          <FilaTactil
            icono={<ArchiveRestore size={20} />}
            texto="Archivo de Hecho"
            bajada="Archivar solas las tarjetas de Hecho"
            alto={48}
            onClick={() => {
              setMenu(false)
              setArchivoHecho(true)
            }}
          />
        )}
        <FilaTactil icono={<Archive size={20} />} texto="Archivar" alto={48} peligro onClick={archivar} />
      </HojaInferior>
      {archivoHecho && <PanelArchivoHecho tableroId={t.id} abierto alCerrar={() => setArchivoHecho(false)} />}
      {vistas && <PanelVistas tableroId={t.id} abierto alCerrar={() => setVistas(false)} />}
    </>
  )
}

function NuevoTablero({ proyecto: p }: { proyecto: Proyecto }) {
  const hojaDeProyectos = useHoja()
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <button type="button" className="fila-tactil fila-tactil--48 selector-tablero__nuevo" onClick={() => setAbierto(true)}>
        <Plus size={18} />
        <span className="fila-tactil__texto">
          <span className="fila-tactil__principal">Nuevo tablero</span>
        </span>
      </button>
      <HojaInferior abierta={abierto} alCerrar={() => setAbierto(false)} titulo={`Nuevo tablero en ${p.nombre}`}>
        <FormularioNuevoTablero proyecto={p} hojaDeProyectos={hojaDeProyectos} />
      </HojaInferior>
    </>
  )
}

/**
 * El nombre y el tipo del tablero nuevo. Vive adentro de su hoja (se arma de cero cada vez que se abre). Al crear cierra las dos
 * hojas en orden (la suya y después la de proyectos, cada una saca su entrada del historial) y recién entonces navega: si no, el
 * back() de la segunda se comería la navegación.
 */
function FormularioNuevoTablero({ proyecto: p, hojaDeProyectos }: { proyecto: Proyecto; hojaDeProyectos: ReturnType<typeof useHoja> }) {
  const propia = useHoja()
  const [nombre, setNombre] = useState('')
  // De fábrica «Tablero» (solo Kanban); siempre se puede cambiar de opinión después, con «Vistas» de ese tablero.
  const [tipo, setTipo] = useState<TipoTablero>(TIPO_DE_FABRICA)
  const [enviando, setEnviando] = useState(false)
  const crear = async () => {
    const n = nombre.trim()
    if (!n || enviando) return
    setEnviando(true)
    try {
      const t = await api.crearTablero(p.id, n, tipo)
      await refrescarProyectos()
      // Entra directo a la primera vista que tiene (un diagrama abre el lienzo, no un Kanban que no hay).
      const entrar = () => irA({ prefijo: p.prefijo, slug: t.slug, vista: vistaInicial(t.vistas ?? VISTAS_DEL_TIPO[tipo]), tarjeta: null })
      if (propia) propia.cerrarYLuego(() => (hojaDeProyectos ? hojaDeProyectos.cerrarYLuego(entrar) : entrar()))
      else entrar()
    } catch (e) {
      avisarError(e)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <form
      className="nuevo-tablero-movil"
      onSubmit={(e) => {
        e.preventDefault()
        void crear()
      }}
    >
      <label className="campo-etiquetado">
        <span>Nombre</span>
        <input
          className="campo"
          value={nombre}
          maxLength={60}
          placeholder="Por ejemplo: Lanzamiento"
          enterKeyHint="done"
          onChange={(e) => setNombre(e.target.value)}
        />
      </label>
      <div className="campo-etiquetado">
        <span id={`tipo-tablero-${p.id}`}>Tipo</span>
        <ElegirTipoTablero valor={tipo} alCambiar={setTipo} etiquetaId={`tipo-tablero-${p.id}`} />
      </div>
      <button type="submit" className="boton boton--primario nuevo-tablero-movil__crear" disabled={!nombre.trim() || enviando}>
        Crear tablero
      </button>
    </form>
  )
}

function CampoEnLinea({
  inicial,
  etiqueta,
  placeholder,
  boton,
  enfocar,
  alGuardar,
  alCancelar,
}: {
  inicial: string
  etiqueta: string
  placeholder?: string
  boton: string
  enfocar?: boolean
  alGuardar: (v: string) => void
  alCancelar: () => void
}) {
  const [valor, setValor] = useState(inicial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // Se pidió escribir: acá sí se abre el teclado (el campo queda arriba de él, la hoja se sube sola).
    if (enfocar || inicial) requestAnimationFrame(() => ref.current?.focus())
  }, [enfocar, inicial])
  const guardar = () => {
    const v = valor.trim()
    if (v) alGuardar(v)
  }
  return (
    <form
      className="campo-en-linea"
      onSubmit={(e) => {
        e.preventDefault()
        guardar()
      }}
    >
      <input
        ref={ref}
        className="campo campo-en-linea__campo"
        value={valor}
        aria-label={etiqueta}
        placeholder={placeholder}
        enterKeyHint="done"
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            alCancelar()
          }
        }}
      />
      <button type="submit" className="boton boton--primario" disabled={!valor.trim()} onMouseDown={(e) => e.preventDefault()}>
        {boton}
      </button>
      <button type="button" className="boton boton--fantasma" onMouseDown={(e) => e.preventDefault()} onClick={alCancelar}>
        Cancelar
      </button>
    </form>
  )
}
