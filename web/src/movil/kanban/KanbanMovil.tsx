// El Kanban en el teléfono (plan del celular, 5): el MISMO <Kanban /> de escritorio, con una lista por pantalla (CSS bajo
// html[data-movil]), la tira de listas como destino (N3) y lo que se siente con el dedo: vibra al despegar, al cruzar a
// otra lista y al soltar, y al soltar el paginado se acomoda sobre la lista donde quedó la tarjeta.
import { useDndMonitor, type Active, type Over } from '@dnd-kit/core'
import { useEffect, useRef } from 'react'
import { LEYENDA_FALLIDA, LEYENDA_PENDIENTE, LEYENDA_SUBIENDO } from '../../pwa/sinconexion/bandeja'
import { Kanban } from '../../vistas/kanban/Kanban'
import { useMovil } from '../estado'
import { vibrar } from '../haptica'
import { EVENTO_KANBAN_INICIO } from '../ui/BarraInferior'
import { irALista, PREFIJO_PASTILLA, TiraListas } from './TiraListas'

/** A qué lista apunta un destino del arrastre: una lista, una tarjeta de esa lista o una pastilla de la tira. */
function listaDe(over: Over | null, active: Active): string | null {
  if (!over) return null
  const id = String(over.id)
  if (id.startsWith(PREFIJO_PASTILLA)) return id.slice(PREFIJO_PASTILLA.length)
  const datos = over.data.current as { tipo?: string; listaId?: string } | undefined
  if (datos?.tipo === 'lista') return id
  if (id === String(active.id)) return null
  return datos?.listaId ?? null
}

function MonitorArrastre() {
  const ultima = useRef<string | null>(null)
  useDndMonitor({
    onDragStart: ({ active }) => {
      ultima.current = (active.data.current as { listaId?: string } | undefined)?.listaId ?? null
      if (active.data.current?.tipo !== 'lista') vibrar('agarre')
    },
    onDragOver: ({ active, over }) => {
      if (active.data.current?.tipo === 'lista') return
      const l = listaDe(over, active)
      if (l && l !== ultima.current) {
        if (!String(over?.id).startsWith(PREFIJO_PASTILLA)) vibrar('cruce')
        ultima.current = l
      }
    },
    onDragEnd: ({ active, over }) => {
      if (active.data.current?.tipo === 'lista') return
      vibrar('suelta')
      const destino = listaDe(over, active) ?? ultima.current
      // Se reactiva el paginado a presión y el tablero se acomoda sobre la lista donde quedó la tarjeta.
      if (destino) setTimeout(() => irALista(destino), 300)
    },
  })
  return null
}

/** «Agregar tarjeta» de una lista (el pie y el «+» del encabezado): abre la hoja con esa lista elegida. */
function agregarEn(listaId: string) {
  useMovil.setState({ listaVisible: listaId })
  useMovil.getState().abrir('compositor')
}

export function KanbanMovil() {
  // Volver a tocar "Kanban" en la barra inferior: primera lista y arriba.
  useEffect(() => {
    const alInicio = () => {
      const lienzo = document.querySelector<HTMLElement>('.kanban__lienzo')
      lienzo?.scrollTo({ left: 0, behavior: 'smooth' })
      lienzo?.querySelectorAll<HTMLElement>('.lista__tarjetas').forEach((l) => l.scrollTo({ top: 0, behavior: 'smooth' }))
    }
    addEventListener(EVENTO_KANBAN_INICIO, alInicio)
    return () => removeEventListener(EVENTO_KANBAN_INICIO, alInicio)
  }, [])

  // Las tarjetas anotadas sin conexión no se abren (todavía no existen en el servidor): tocarlas abre la hoja de las que
  // faltan subir, con Reintentar y Descartar. Se reconocen por su leyenda, que el frente muestra en lugar de la clave.
  useEffect(() => {
    const deLaBandeja = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('.kanban .ordenable')
      const etiqueta = el?.getAttribute('aria-label') ?? ''
      return [LEYENDA_PENDIENTE, LEYENDA_SUBIENDO, LEYENDA_FALLIDA].some((l) => etiqueta.startsWith(`${l}: `))
    }
    const tocar = (e: MouseEvent) => {
      if (deLaBandeja(e)) useMovil.getState().abrir('pendientes')
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !deLaBandeja(e)) return
      e.preventDefault()
      e.stopPropagation()
      useMovil.getState().abrir('pendientes')
    }
    document.addEventListener('click', tocar)
    document.addEventListener('keydown', tecla, true)
    return () => {
      document.removeEventListener('click', tocar)
      document.removeEventListener('keydown', tecla, true)
    }
  }, [])

  // Si se gira el teléfono a mitad de un arrastre, se cancela (Escape, como en escritorio). Sobre body y no sobre document:
  // los atajos (tinykeys) esperan que el destino de la tecla sea un elemento.
  useEffect(() => {
    const girar = () => {
      if (document.body.classList.contains('arrastrando')) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    }
    addEventListener('orientationchange', girar)
    return () => removeEventListener('orientationchange', girar)
  }, [])

  return (
    <Kanban
      alAgregar={agregarEn}
      dentro={
        <>
          <TiraListas />
          <MonitorArrastre />
        </>
      }
    />
  )
}
