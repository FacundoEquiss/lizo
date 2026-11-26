// Buscar (plan del celular, 4.3), el reemplazo de Ctrl+K en el teléfono. La paleta de escritorio está hecha para
// flechas y Enter; acá hace falta una lista táctil de filas altas. Se reusa lo que importa: la búsqueda del servidor y
// los mismos operadores (tipo:error, #área, @yo). Abrir una tarjeta la pone encima del buscador: "atrás" vuelve acá con
// el texto intacto.
import { Activity, Archive, Frame, Search, SquareKanban, WifiOff, X } from 'lucide-react'
import { tieneVista } from '../../../../compartido/vistas'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { normalizar } from '../../../../compartido/texto'
import type { ResultadoBusqueda, TarjetaResumen } from '../../../../compartido/tipos'
import { api } from '../../estado/api'
import { irA, useRuta } from '../../estado/ruta'
import { useTienda } from '../../estado/tienda'
import { useConexion } from '../../pwa/estado'
import { IconoTipo } from '../../ui/comunes'
import { useMovil } from '../estado'
import { FilaTactil } from '../ui/FilaTactil'
import { HojaInferior, useHoja } from '../ui/HojaInferior'

type Alcance = 'tablero' | 'todo'

/** Pone en negrita las palabras buscadas dentro del título (sin importar mayúsculas ni tildes). */
function resaltar(texto: string, consulta: string): ReactNode {
  const palabras = consulta
    .split(/\s+/)
    .filter((p) => p.length > 1 && !/[:#@!]/.test(p) && !p.startsWith('-'))
    .map(normalizar)
  if (!palabras.length) return texto
  const base = normalizar(texto)
  const marcas: [number, number][] = []
  for (const p of palabras) {
    let i = base.indexOf(p)
    while (i !== -1) {
      marcas.push([i, i + p.length])
      i = base.indexOf(p, i + p.length)
    }
  }
  if (!marcas.length || base.length !== texto.length) return texto
  marcas.sort((a, b) => a[0] - b[0])
  const partes: ReactNode[] = []
  let desde = 0
  for (const [a, b] of marcas) {
    if (a < desde) continue
    if (a > desde) partes.push(texto.slice(desde, a))
    partes.push(<b key={a}>{texto.slice(a, b)}</b>)
    desde = b
  }
  partes.push(texto.slice(desde))
  return partes
}

export function Buscar() {
  const abierta = useMovil((s) => s.hoja === 'buscar')
  const cerrar = useMovil((s) => s.cerrar)
  const tarjetaAbierta = useTienda((s) => !!s.claveAbierta)
  const ref = useRef<HTMLInputElement>(null)
  return (
    <HojaInferior
      abierta={abierta}
      alCerrar={cerrar}
      etiqueta="Buscar"
      alto="completa"
      enfocar={ref}
      inactiva={tarjetaAbierta}
      className="buscar-movil"
    >
      <ContenidoBuscar refCampo={ref} />
    </HojaInferior>
  )
}

function ContenidoBuscar({ refCampo }: { refCampo: React.RefObject<HTMLInputElement | null> }) {
  const hoja = useHoja()
  const tablero = useTienda((s) => s.tablero)
  const proyectos = useTienda((s) => s.proyectos)
  const enLinea = useConexion()
  const ruta = useRuta()
  const [q, setQ] = useState('')
  const [alcance, setAlcance] = useState<Alcance>('tablero')
  const [resultados, setResultados] = useState<ResultadoBusqueda[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [sinRed, setSinRed] = useState(false)
  const pedido = useRef(0)

  const texto = q.trim()
  useEffect(() => {
    if (texto.length < 2) {
      setResultados(null)
      setBuscando(false)
      return
    }
    setBuscando(true)
    const n = ++pedido.current
    const t = setTimeout(async () => {
      const local = () => buscarLocal(texto, tablero?.tarjetas ?? [], tablero?.listas ?? [])
      try {
        if (!navigator.onLine) throw new Error('sin red')
        const r = await api.buscar(texto, { tablero: alcance === 'tablero' ? tablero?.tablero.id : undefined, limite: 30 })
        if (n !== pedido.current) return
        setSinRed(false)
        setResultados(r)
      } catch {
        if (n !== pedido.current) return
        setSinRed(true)
        setResultados(local())
      } finally {
        if (n === pedido.current) setBuscando(false)
      }
    }, 180)
    return () => clearTimeout(t)
  }, [texto, alcance, tablero?.tablero.id])

  const recientes = useMemo(
    () =>
      tablero
        ? [...tablero.tarjetas]
            .filter((t) => !t.archivada && !t.id.startsWith('tmp-'))
            .sort((a, b) => (a.actualizadaEn < b.actualizadaEn ? 1 : -1))
            .slice(0, 6)
        : [],
    [tablero],
  )

  const abrirTarjeta = (t: TarjetaResumen) => {
    if (!tablero || t.tableroId === tablero.tablero.id) {
      useTienda.getState().abrirTarjeta(t.clave)
      return
    }
    const p = proyectos.find((x) => x.id === t.proyectoId)
    const tb = p?.tableros.find((x) => x.id === t.tableroId)
    if (p && tb) hoja?.cerrarYLuego(() => irA({ prefijo: p.prefijo, slug: tb.slug, tarjeta: t.clave }))
  }

  const ir = (fn: () => void) => hoja?.cerrarYLuego(fn)
  const otraVista = ruta.vista === 'lienzo' ? 'kanban' : 'lienzo'
  // Solo si el tablero tiene esa vista (un diagrama no tiene Kanban).
  const hayOtraVista = tieneVista(tablero?.tablero, otraVista)

  return (
    <div className="buscar-movil__marco">
      <div className="buscar-movil__fijo">
        <div className="buscar-movil__fila">
          <label className="buscar-movil__campo">
            <Search size={18} aria-hidden />
            <input
              ref={refCampo}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar tarjetas"
              aria-label="Buscar tarjetas"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
            {q && (
              <button type="button" className="buscar-movil__borrar" onClick={() => setQ('')} aria-label="Borrar lo escrito">
                <X size={16} />
              </button>
            )}
          </label>
          <button type="button" className="buscar-movil__cancelar" onClick={() => hoja?.cerrar()}>
            Cancelar
          </button>
        </div>
        <div className="buscar-movil__alcance" role="radiogroup" aria-label="Dónde buscar">
          {(
            [
              ['tablero', 'Este tablero'],
              ['todo', 'Todo'],
            ] as const
          ).map(([id, nombre]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={alcance === id}
              className={`pildora${alcance === id ? ' pildora--elegida' : ''}`}
              onClick={() => setAlcance(id)}
            >
              {nombre}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`buscar-movil__lista${buscando && resultados ? ' buscar-movil__lista--buscando' : ''}`}
        onTouchMove={() => {
          if (document.activeElement === refCampo.current) refCampo.current?.blur()
        }}
      >
        {(sinRed || !enLinea) && texto.length >= 2 && (
          <p className="buscar-movil__aviso">
            <WifiOff size={15} /> Sin conexión: busco solo en este tablero
          </p>
        )}
        {resultados === null ? (
          <>
            {recientes.length > 0 && (
              <section aria-label="Tocadas hace poco">
                <h3 className="buscar-movil__titulo">Tocadas hace poco</h3>
                {recientes.map((t) => (
                  <Resultado key={t.id} tarjeta={t} lista={tablero?.listas.find((l) => l.id === t.listaId)?.nombre ?? null} q="" alTocar={() => abrirTarjeta(t)} />
                ))}
              </section>
            )}
            <section aria-label="Ir a">
              <h3 className="buscar-movil__titulo">Ir a</h3>
              {hayOtraVista && (
                <FilaTactil
                  icono={otraVista === 'lienzo' ? <Frame size={20} /> : <SquareKanban size={20} />}
                  texto={otraVista === 'lienzo' ? 'Lienzo' : 'Kanban'}
                  flecha
                  onClick={() => ir(() => irA({ vista: otraVista, tarjeta: null }))}
                />
              )}
              <FilaTactil icono={<Activity size={20} />} texto="Actividad" flecha onClick={() => ir(() => useTienda.setState({ panel: 'actividad' }))} />
              <FilaTactil icono={<Archive size={20} />} texto="Archivadas" flecha onClick={() => ir(() => useTienda.setState({ panel: 'archivadas' }))} />
            </section>
          </>
        ) : resultados.length === 0 && !buscando ? (
          <p className="buscar-movil__vacio">Nada por acá. Probá con otra palabra.</p>
        ) : (
          resultados.map((r) => (
            <Resultado
              key={r.tarjeta.id}
              tarjeta={r.tarjeta}
              lista={r.listaNombre}
              tableroNombre={r.tarjeta.tableroId !== tablero?.tablero.id ? r.tableroNombre : undefined}
              q={texto}
              alTocar={() => abrirTarjeta(r.tarjeta)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function Resultado({
  tarjeta: t,
  lista,
  tableroNombre,
  q,
  alTocar,
}: {
  tarjeta: TarjetaResumen
  lista: string | null
  tableroNombre?: string
  q: string
  alTocar: () => void
}) {
  return (
    <button type="button" className="fila-tactil fila-tactil--60 buscar-movil__resultado" onClick={alTocar}>
      <span className="fila-tactil__icono">
        <IconoTipo tipo={t.tipo} tam={18} />
      </span>
      <span className="fila-tactil__texto">
        <span className="fila-tactil__principal">{resaltar(t.titulo, q)}</span>
        <span className="fila-tactil__bajada">
          <span className="mono">{t.clave}</span>
          {lista ? ` · ${lista}` : ''}
          {tableroNombre ? ` · ${tableroNombre}` : ''}
        </span>
      </span>
    </button>
  )
}

/** Sin conexión: busca en lo que está cargado (título y clave del tablero abierto). */
function buscarLocal(q: string, tarjetas: TarjetaResumen[], listas: { id: string; nombre: string }[]): ResultadoBusqueda[] {
  const palabras = normalizar(q).split(/\s+/).filter(Boolean)
  return tarjetas
    .filter((t) => !t.archivada && !t.id.startsWith('tmp-'))
    .filter((t) => {
      const base = normalizar(`${t.clave} ${t.titulo}`)
      return palabras.every((p) => base.includes(p))
    })
    .slice(0, 30)
    .map((t) => ({ tarjeta: t, tableroNombre: '', listaNombre: listas.find((l) => l.id === t.listaId)?.nombre ?? null, fragmento: '' }))
}
