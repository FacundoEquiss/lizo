// La tira de listas (plan del celular, 5.2). Con una lista por pantalla no se sabe cuántas hay ni en cuál se está, y
// llevar una tarjeta de la Bandeja a Hecho serían cuatro pantallas de arrastre. La tira lo resuelve: marca la lista a la
// vista, salta a otra con un toque y, durante un arrastre, cada pastilla es un destino (la tarjeta va al principio de
// esa lista: se soltó sin verla, así que lo recién movido tiene que ser lo primero que se encuentra).
// Se dibuja dentro del contexto de arrastre del Kanban (N3) y se lleva por portal a su ranura: debajo de la barra
// superior en vertical, dentro de ella en horizontal.
import { useDndMonitor, useDroppable } from '@dnd-kit/core'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { filtrarTarjetas, hayFiltro } from '../../../../compartido/filtro'
import type { Lista } from '../../../../compartido/tipos'
import { porOrden, useTienda } from '../../estado/tienda'
import { useMovil } from '../estado'
import { vibrar } from '../haptica'

export const PREFIJO_PASTILLA = 'pastilla:'

/** Lleva el paginado a esa lista. */
export function irALista(listaId: string, suave = true) {
  const el = document.querySelector<HTMLElement>(`.kanban__lienzo > .lista[data-lista="${CSS.escape(listaId)}"]`)
  el?.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', inline: 'start', block: 'nearest' })
}

export function TiraListas() {
  const tablero = useTienda((s) => s.tablero)!
  const filtro = useTienda((s) => s.filtro)
  const ranura = useMovil((s) => s.ranuraTira)
  const visible = useMovil((s) => s.listaVisible)
  const [arrastrando, setArrastrando] = useState(false)
  const refTira = useRef<HTMLDivElement>(null)
  const listas = useMemo(() => [...tablero.listas].sort(porOrden), [tablero.listas])

  const cuentas = useMemo(() => {
    const activas = tablero.tarjetas.filter((t) => !t.archivada)
    const total = new Map<string, number>()
    for (const t of activas) if (t.listaId) total.set(t.listaId, (total.get(t.listaId) ?? 0) + 1)
    if (!hayFiltro(filtro)) return { total, visibles: null as Map<string, number> | null }
    const filtradas = filtrarTarjetas(activas, filtro, {
      listas: new Map(tablero.listas.map((l) => [l.id, l])),
      etiquetas: new Map(tablero.etiquetas.map((e) => [e.id, e])),
      miembros: new Map(tablero.miembros.map((m) => [m.id, m])),
    })
    const visibles = new Map<string, number>()
    for (const t of filtradas) if (t.listaId) visibles.set(t.listaId, (visibles.get(t.listaId) ?? 0) + 1)
    return { total, visibles }
  }, [tablero.tarjetas, tablero.listas, tablero.etiquetas, tablero.miembros, filtro])

  // Qué lista está a la vista: la que más se ve del paginado (umbral 0,6).
  useEffect(() => {
    const raiz = document.querySelector('.kanban__lienzo')
    if (!raiz) return
    const proporciones = new Map<string, number>()
    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) proporciones.set((e.target as HTMLElement).dataset.lista!, e.intersectionRatio)
        let mejor: string | null = null
        let max = 0
        for (const l of listas) {
          const p = proporciones.get(l.id) ?? 0
          if (p > max + 0.01) {
            mejor = l.id
            max = p
          }
        }
        if (mejor && max >= 0.6) useMovil.setState({ listaVisible: mejor })
      },
      { root: raiz, threshold: [0, 0.6, 0.9, 1] },
    )
    raiz.querySelectorAll<HTMLElement>(':scope > .lista[data-lista]').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [listas, ranura])

  // La pastilla activa queda centrada en la tira.
  useEffect(() => {
    const tira = refTira.current
    const activa = tira?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!tira || !activa) return
    const destino = activa.offsetLeft - (tira.clientWidth - activa.offsetWidth) / 2
    tira.scrollTo({ left: Math.max(0, destino), behavior: 'smooth' })
  }, [visible, ranura])

  // Sobre la tira, la copia que se arrastra se achica y baja: si no, tapa la pastilla que se está eligiendo.
  const sobreTira = (si: boolean) => document.body.classList.toggle('sobre-tira', si)
  useDndMonitor({
    onDragStart: ({ active }) => {
      if (active.data.current?.tipo !== 'lista') setArrastrando(true)
    },
    onDragOver: ({ over }) => sobreTira(!!over && String(over.id).startsWith(PREFIJO_PASTILLA)),
    onDragEnd: ({ active, over }) => {
      sobreTira(false)
      setArrastrando(false)
      const destino = over ? String(over.id) : ''
      if (!destino.startsWith(PREFIJO_PASTILLA) || active.data.current?.tipo === 'lista') return
      const listaId = destino.slice(PREFIJO_PASTILLA.length)
      useTienda.getState().moverTarjeta(String(active.id), listaId, 0)
    },
    onDragCancel: () => {
      sobreTira(false)
      setArrastrando(false)
    },
  })

  if (!ranura) return null
  return createPortal(
    <div className={`tira-listas${arrastrando ? ' tira-listas--arrastrando' : ''}`} ref={refTira} role="toolbar" aria-label="Listas del tablero">
      {listas.map((l) => (
        <Pastilla
          key={l.id}
          lista={l}
          activa={visible === l.id}
          total={cuentas.total.get(l.id) ?? 0}
          visibles={cuentas.visibles ? (cuentas.visibles.get(l.id) ?? 0) : null}
        />
      ))}
    </div>,
    ranura,
  )
}

function Pastilla({ lista: l, activa, total, visibles }: { lista: Lista; activa: boolean; total: number; visibles: number | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: PREFIJO_PASTILLA + l.id, data: { tipo: 'pastilla', listaId: l.id } })
  useEffect(() => {
    if (isOver) vibrar('cruce')
  }, [isOver])
  const cuenta = visibles === null ? `${total}` : `${visibles}/${total}`
  const leida = visibles === null ? `${total} ${total === 1 ? 'tarjeta' : 'tarjetas'}` : `${visibles} de ${total} tarjetas`
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`pastilla-lista${activa ? ' pastilla-lista--activa' : ''}${isOver ? ' pastilla-lista--destino' : ''}`}
      onClick={() => irALista(l.id)}
      aria-current={activa ? 'true' : undefined}
      aria-label={`${l.nombre}, ${leida}`}
    >
      {activa && <motion.span layoutId="pastilla-activa" className="pastilla-lista__fondo" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
      <span className={`punto-categoria${l.categoria ? ` punto-categoria--${l.categoria}` : ''}`} aria-hidden />
      <span className="pastilla-lista__nombre">{l.nombre.length > 16 ? `${l.nombre.slice(0, 15).trimEnd()}…` : l.nombre}</span>
      <span className="pastilla-lista__cuenta">{cuenta}</span>
    </button>
  )
}
