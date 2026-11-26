// Avisar cada cambio de la vista del lienzo (mover o hacer zoom, con el mouse, el teclado o un encuadre).
//
// Por qué no `useOnViewportChange` de React Flow: guarda UN solo oyente por lienzo (lo pone en su tienda de opciones).
// Con dos componentes que lo usaban (el lienzo para el nivel de detalle y la barra contextual para esconderse), ganaba
// el último que se volvía a dibujar: al mover el lienzo la barra se redibujaba, se quedaba con el oyente y el lienzo
// dejaba de enterarse del zoom. El nivel de detalle quedaba trabado en «muy lejos» y las formas y notas se veían sin
// texto aunque se acercara otra vez (lo que vio el dueño en «Mini juegos»). Acá cada componente se suscribe por su
// cuenta a la tienda de la vista: pueden ser varios y ninguno pisa al otro.
import { useReactFlowStoreApi, type Viewport } from '@xyflow/react'
import { useEffect, useLayoutEffect, useRef } from 'react'

/** Llama a `alCambiar` con la vista nueva cada vez que cambia (sin hacer render). Se pueden usar varios a la vez. */
export function useAlCambiarVista(alCambiar: (vista: Viewport) => void) {
  const { viewportStore } = useReactFlowStoreApi()
  // La función del último dibujo, sin volver a suscribirse en cada uno.
  const ultima = useRef(alCambiar)
  useLayoutEffect(() => {
    ultima.current = alCambiar
  })
  useEffect(
    () =>
      viewportStore.subscribe((s, antes) => {
        if (s.transform === antes.transform) return
        const [x, y, zoom] = s.transform
        ultima.current({ x, y, zoom })
      }),
    [viewportStore],
  )
}
