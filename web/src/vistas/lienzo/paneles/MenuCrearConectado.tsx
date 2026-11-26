// Menú "Crear y conectar" (5.7.1): se abre al soltar un conector en el aire. Filtra con lo que se escribe; con el campo
// vacío, cada opción tiene su tecla (Enter: igual al origen; N nota, T texto, S forma, D tarjeta nueva, K tarjeta que
// ya existe, F marco). Las opciones de forma y de tarjeta abren su propio paso (grilla, título, buscador).
import { ArrowLeft, ChevronRight, Frame, Search, Shapes, SquareKanban, StickyNote, Type } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as EventoTecla, type ReactNode } from 'react'
import { FORMAS, type TipoForma } from '../../../../../compartido/lienzo'
import type { ElementoLienzo } from '../../../../../compartido/tipos'
import { normalizar } from '../../../../../compartido/texto'
import { tieneVista } from '../../../../../compartido/vistas'
import { usePreferencias } from '../../../estado/preferencias'
import { porOrden, useTienda } from '../../../estado/tienda'
import { movimientoReducido } from '../../../util/movimiento'
import type { OpcionCrear } from '../acciones'
import { MiniForma } from './Herramientas'
import { EstadoVacio } from '../../../ui/EstadoVacio'

export interface PropsMenuCrearConectado {
  /** Dónde se abre: el punto donde se soltó, en coordenadas de pantalla relativas al contenedor del lienzo. */
  punto: { x: number; y: number }
  origen: ElementoLienzo
  alElegir: (o: OpcionCrear) => void
  alCerrar: () => void
  /** 'hoja': sin posición ni animación propia (el celular lo pone en una hoja inferior). */
  presentacion?: 'menu' | 'hoja'
}

interface Fila {
  id: string
  nombre: string
  ayuda?: string
  icono: ReactNode
  tecla: string
  submenu?: boolean
  elegir: () => void
}

const NOMBRE_IGUAL: Partial<Record<ElementoLienzo['tipo'], string>> = { nota: 'Otra nota', texto: 'Otro texto', forma: 'Otra forma', marco: 'Otro marco' }
const ICONO: Partial<Record<ElementoLienzo['tipo'], ReactNode>> = {
  nota: <StickyNote size={16} />,
  texto: <Type size={16} />,
  forma: <Shapes size={16} />,
  marco: <Frame size={16} />,
}

type Paso = 'lista' | 'formas' | 'tarjeta-nueva' | 'tarjeta-existente'

export function MenuCrearConectado({ punto, origen, alElegir, alCerrar, presentacion = 'menu' }: PropsMenuCrearConectado) {
  const [paso, setPaso] = useState<Paso>('lista')
  const [filtro, setFiltro] = useState('')
  const [activo, setActivo] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLInputElement>(null)
  const ultimaForma = usePreferencias((s) => s.estilos.forma.forma)
  const listas = useTienda((s) => s.tablero?.listas)
  const tarjetas = useTienda((s) => s.tablero?.tarjetas)
  const conKanban = useTienda((s) => tieneVista(s.tablero?.tablero, 'kanban'))
  const listasOrdenadas = useMemo(() => [...(listas ?? [])].filter((l) => !l.archivada).sort(porOrden), [listas])
  const porHacer = listasOrdenadas.find((l) => l.categoria === 'por_hacer') ?? listasOrdenadas[0]
  const [listaId, setListaId] = useState<string | null>(porHacer?.id ?? null)
  // Si abajo no entra (o a la derecha), se abre hacia arriba (o a la izquierda) del punto.
  const [lugar, setLugar] = useState<{ left: number; top: number; origen: string }>({ left: punto.x + 8, top: punto.y + 8, origen: '0 0' })
  useLayoutEffect(() => {
    const el = ref.current
    const cont = el?.parentElement
    if (!el || !cont || presentacion !== 'menu') return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const arriba = punto.y + 8 + h > cont.clientHeight - 92
    const izquierda = punto.x + 8 + w > cont.clientWidth - 12
    setLugar({
      left: izquierda ? Math.max(12, punto.x - 8 - w) : punto.x + 8,
      top: arriba ? Math.max(68, punto.y - 8 - h) : punto.y + 8,
      origen: `${izquierda ? '100%' : '0'} ${arriba ? '100%' : '0'}`,
    })
  }, [punto, paso, presentacion])

  // Clic afuera: se cancela.
  useEffect(() => {
    const fuera = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) alCerrar()
    }
    window.addEventListener('pointerdown', fuera, true)
    return () => window.removeEventListener('pointerdown', fuera, true)
  }, [alCerrar])
  useEffect(() => {
    setFiltro('')
    // En la grilla de formas arranca en la última usada: Enter la repite.
    setActivo(paso === 'formas' ? Math.max(0, FORMAS.findIndex((f) => f.id === usePreferencias.getState().estilos.forma.forma)) : 0)
    requestAnimationFrame(() => campo.current?.focus())
  }, [paso])

  const filas: Fila[] = [
    ...(NOMBRE_IGUAL[origen.tipo]
      ? [{ id: 'igual', nombre: NOMBRE_IGUAL[origen.tipo]!, icono: ICONO[origen.tipo], tecla: '↵', elegir: () => alElegir({ tipo: 'igual' }) }]
      : []),
    // Aunque el origen sea una nota, "Nota" (N) está: es la de fábrica ("Otra nota" copia el estilo del origen).
    { id: 'nota', nombre: 'Nota', icono: <StickyNote size={16} />, tecla: 'N', elegir: () => alElegir({ tipo: 'nota' }) },
    { id: 'texto', nombre: 'Texto', icono: <Type size={16} />, tecla: 'T', elegir: () => alElegir({ tipo: 'texto' }) },
    { id: 'forma', nombre: 'Forma', icono: <Shapes size={16} />, tecla: 'S', submenu: true, elegir: () => setPaso('formas') },
    // Un tablero sin Kanban (un diagrama) no ofrece tarjetas: se sacan estas dos filas (y sus teclas D y K).
    { id: 'tarjeta-nueva', nombre: 'Tarjeta nueva del Kanban', icono: <SquareKanban size={16} />, tecla: 'D', elegir: () => setPaso('tarjeta-nueva') },
    // "del Kanban" no entra en 248 px: va en la ayuda (title).
    { id: 'tarjeta', nombre: 'Tarjeta que ya existe…', ayuda: 'Tarjeta del Kanban que ya existe', icono: <Search size={16} />, tecla: 'K', elegir: () => setPaso('tarjeta-existente') },
    { id: 'marco', nombre: 'Marco', icono: <Frame size={16} />, tecla: 'F', elegir: () => alElegir({ tipo: 'marco' }) },
  ].filter((f) => conKanban || (f.id !== 'tarjeta-nueva' && f.id !== 'tarjeta'))
  const q = normalizar(filtro.trim())
  const visibles = paso === 'lista' && q ? filas.filter((f) => normalizar(f.nombre).includes(q)) : filas
  const formasVisibles = paso === 'formas' && q ? FORMAS.filter((f) => normalizar(`${f.nombre} ${f.uso}`).includes(q)) : FORMAS

  const resultadosTarjetas = useMemo(() => {
    if (paso !== 'tarjeta-existente') return []
    const activas = (tarjetas ?? []).filter((t) => !t.archivada)
    const qq = normalizar(filtro.trim())
    return (qq ? activas.filter((t) => normalizar(`${t.clave} ${t.titulo}`).includes(qq)) : activas).slice(0, 8)
  }, [paso, tarjetas, filtro])

  const alTecla = (e: EventoTecla<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      if (paso === 'lista') alCerrar()
      else setPaso('lista')
      return
    }
    const cantidad = paso === 'lista' ? visibles.length : paso === 'formas' ? formasVisibles.length : paso === 'tarjeta-existente' ? resultadosTarjetas.length : 0
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (paso === 'formas' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
      if (!cantidad) return
      e.preventDefault()
      const salto = paso === 'formas' ? ({ ArrowDown: 5, ArrowUp: -5, ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[e.key]! : e.key === 'ArrowDown' ? 1 : -1
      setActivo((i) => (i + salto + cantidad) % cantidad)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (paso === 'lista') visibles[activo]?.elegir()
      else if (paso === 'formas') {
        const f = formasVisibles[activo]
        if (f) alElegir({ tipo: 'forma', forma: f.id })
      }
      else if (paso === 'tarjeta-nueva') {
        if (filtro.trim()) alElegir({ tipo: 'tarjeta-nueva', titulo: filtro.trim(), listaId })
      } else if (paso === 'tarjeta-existente') {
        const t = resultadosTarjetas[activo]
        if (t) alElegir({ tipo: 'tarjeta', tarjetaId: t.id })
      }
      return
    }
    // Con el campo vacío, las letras eligen (en la lista). En la grilla de formas, Backspace vuelve.
    if (paso === 'lista' && !filtro && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const f = filas.find((x) => x.tecla.toLowerCase() === e.key.toLowerCase())
      if (f) {
        e.preventDefault()
        f.elegir()
      }
      return
    }
    if (paso !== 'lista' && e.key === 'Backspace' && !filtro) {
      e.preventDefault()
      setPaso('lista')
    }
  }

  const titulo = paso === 'formas' ? 'Forma' : paso === 'tarjeta-nueva' ? 'Tarjeta nueva del Kanban' : paso === 'tarjeta-existente' ? 'Tarjeta que ya existe' : null
  const marcador =
    paso === 'lista' ? 'Crear y conectar…' : paso === 'formas' ? 'Buscar forma…' : paso === 'tarjeta-nueva' ? 'Título de la tarjeta' : 'Clave o título (RC-12, mozo…)'

  const reducido = movimientoReducido()
  return (
    <motion.div
      ref={ref}
      className={`menu-conectar menu-conectar--${presentacion}`}
      style={presentacion === 'menu' ? { left: lugar.left, top: lugar.top, transformOrigin: lugar.origen } : undefined}
      initial={presentacion === 'menu' ? (reducido ? { opacity: 0 } : { opacity: 0, scale: 0.96 }) : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reducido ? 0.08 : 0.14, ease: [0.15, 1, 0.3, 1] }}
      role="dialog"
      aria-label="Crear y conectar"
      onKeyDown={alTecla}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {titulo && (
        <button type="button" className="menu-conectar__volver" onClick={() => setPaso('lista')}>
          <ArrowLeft size={14} /> {titulo}
        </button>
      )}
      <input
        ref={campo}
        className="menu-conectar__campo"
        value={filtro}
        placeholder={marcador}
        aria-label={marcador}
        onChange={(e) => {
          setFiltro(e.target.value)
          setActivo(0)
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {paso === 'lista' &&
        (visibles.length ? (
          <div className="menu-conectar__lista" role="listbox" aria-label="Qué crear">
            {visibles.map((f, i) => (
              <button
                key={f.id}
                type="button"
                role="option"
                aria-selected={i === activo}
                className={`menu-conectar__fila${i === activo ? ' menu-conectar__fila--activa' : ''}`}
                onPointerEnter={() => setActivo(i)}
                onClick={f.elegir}
                title={f.ayuda}
              >
                <span className="menu-conectar__icono">{f.icono}</span>
                <span className="menu-conectar__nombre">{f.nombre}</span>
                {f.submenu && <ChevronRight size={14} className="menu-conectar__flecha" />}
                {!q && <kbd className="menu-conectar__tecla">{f.tecla}</kbd>}
              </button>
            ))}
          </div>
        ) : (
          <EstadoVacio chico titulo="No hay nada con ese nombre" />
        ))}
      {paso === 'formas' && (
        <div className="grilla-formas menu-conectar__formas" role="listbox" aria-label="Forma">
          {formasVisibles.map((f, i) => (
            <button
              key={f.id}
              type="button"
              role="option"
              aria-selected={i === activo}
              className={`grilla-formas__boton${i === activo ? ' grilla-formas__boton--activa' : ''}${f.id === ultimaForma ? ' grilla-formas__boton--ultima' : ''}`}
              onPointerEnter={() => setActivo(i)}
              onClick={() => alElegir({ tipo: 'forma', forma: f.id as TipoForma })}
              aria-label={`${f.nombre}: ${f.uso}`}
              data-tip={`${f.nombre} · ${f.uso}`}
            >
              <MiniForma forma={f.id} tam={24} />
            </button>
          ))}
        </div>
      )}
      {paso === 'tarjeta-nueva' && (
        <div className="menu-conectar__tarjeta">
          <label className="menu-conectar__etiqueta">
            Lista
            <select className="menu-conectar__select" value={listaId ?? ''} onChange={(e) => setListaId(e.target.value || null)}>
              {listasOrdenadas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="boton boton--chico boton--primario"
            disabled={!filtro.trim()}
            onClick={() => alElegir({ tipo: 'tarjeta-nueva', titulo: filtro.trim(), listaId })}
          >
            Crear
          </button>
        </div>
      )}
      {paso === 'tarjeta-existente' &&
        (resultadosTarjetas.length ? (
          <div className="menu-conectar__lista" role="listbox" aria-label="Tarjetas">
            {resultadosTarjetas.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={i === activo}
                className={`menu-conectar__fila${i === activo ? ' menu-conectar__fila--activa' : ''}`}
                onPointerEnter={() => setActivo(i)}
                onClick={() => alElegir({ tipo: 'tarjeta', tarjetaId: t.id })}
              >
                <span className="menu-conectar__clave">{t.clave}</span>
                <span className="menu-conectar__nombre">{t.titulo}</span>
              </button>
            ))}
          </div>
        ) : (
          <EstadoVacio chico titulo="No hay nada con ese nombre" />
        ))}
    </motion.div>
  )
}
