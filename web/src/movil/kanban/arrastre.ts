// Arrastrar con el dedo (plan del celular, 5.3). Reparto de gestos sin ambigüedad en una pantalla que se desplaza en dos
// ejes: toque corto abre, deslizar desplaza (en vertical la lista, en horizontal el paginado) y MANTENER APRETADO 220 ms
// sin moverse más de 8 px despega la tarjeta. Menos de 180 ms se dispara al empezar un scroll lento; más de 300 se siente
// trabado; los dedos tiemblan más que el mouse. Los tiempos están acá solos para ajustarlos tras probar en un teléfono.
//
// Con mouse o lápiz devuelve exactamente lo de siempre (PointerSensor a 5 px y el teclado): el escritorio no cambia.
import {
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type AutoScrollOptions,
  type PointerActivationConstraint,
  type PointerSensorOptions,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useMemo } from 'react'
import { useTienda } from '../../estado/tienda'
import { useConexion } from '../../pwa/estado'
import { useEsMovil } from '../detectar'

export const ESPERA_DEDO = 220
export const TOLERANCIA_DEDO = 8
const ACELERACION_ESCRITORIO = 14
const ACELERACION_TELEFONO = 9

/** El PointerSensor de siempre, pero sin el dedo: en táctil manda el TouchSensor, con su espera. */
class SensorPuntero extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (evento: React.PointerEvent, opciones: PointerSensorOptions) =>
        evento.nativeEvent.pointerType !== 'touch' && PointerSensor.activators[0]!.handler(evento, opciones),
    },
  ]
}

function nombre(id: UniqueIdentifier | undefined): string {
  if (id == null) return 'nada'
  const s = String(id)
  const t = useTienda.getState().tablero
  const listaId = s.startsWith('pastilla:') ? s.slice(9) : s
  const lista = t?.listas.find((l) => l.id === listaId)
  if (lista) return `la lista ${lista.nombre}`
  const tarjeta = t?.tarjetas.find((x) => x.id === s)
  return tarjeta ? `la tarjeta ${tarjeta.clave}, ${tarjeta.titulo}` : 'el elemento'
}

/** Lo que dice el lector de pantalla mientras se arrastra (N4): en castellano. */
const anuncios: Announcements = {
  onDragStart: ({ active }) => `Agarraste ${nombre(active.id)}.`,
  onDragOver: ({ active, over }) => (over ? `${nombre(active.id)} está sobre ${nombre(over.id)}.` : `${nombre(active.id)} no está sobre un lugar donde soltarla.`),
  onDragEnd: ({ active, over }) => (over ? `Soltaste ${nombre(active.id)} sobre ${nombre(over.id)}.` : `Soltaste ${nombre(active.id)}.`),
  onDragCancel: ({ active }) => `Cancelaste el arrastre: ${nombre(active.id)} volvió a su lugar.`,
}

const instrucciones: ScreenReaderInstructions = {
  draggable:
    'Para agarrarla, apretá la barra espaciadora. Mientras la arrastrás, usá las flechas para moverla. Apretá la barra espaciadora o Enter para soltarla, o Escape para cancelar.',
}

export function useAjustesArrastre() {
  const movil = useEsMovil()
  const enLinea = useConexion()
  // Sin conexión, en el teléfono no se arrastra: es feo ver aterrizar una tarjeta y que vuelva sola a su lugar.
  const puedeArrastrar = !movil || enLinea
  const puntero = useSensor(SensorPuntero, { activationConstraint: { distance: 5 } as PointerActivationConstraint })
  const dedo = useSensor(TouchSensor, { activationConstraint: { delay: ESPERA_DEDO, tolerance: TOLERANCIA_DEDO } })
  const teclado = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
    keyboardCodes: { start: [KeyboardCode.Space], cancel: [KeyboardCode.Esc], end: [KeyboardCode.Space, KeyboardCode.Enter] },
  })
  const sensores = useSensors(puedeArrastrar ? puntero : null, puedeArrastrar ? dedo : null, teclado)
  const autoScroll = useMemo<AutoScrollOptions>(
    // En el teléfono el recorrido es más corto: a 14 se pasa de largo.
    () => ({ acceleration: movil ? ACELERACION_TELEFONO : ACELERACION_ESCRITORIO, threshold: { x: 0.14, y: 0.18 }, interval: 5 }),
    [movil],
  )
  const accesibilidad = useMemo(() => ({ announcements: anuncios, screenReaderInstructions: instrucciones }), [])
  return { sensores, autoScroll, accesibilidad }
}
