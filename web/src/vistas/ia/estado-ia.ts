// Configuración → IA y los topes que citan los textos del hilo salen de una sola lectura (`GET /api/ia/estado`). Se pide cuando se
// abre una de las dos cosas y queda en la tienda de la IA (`ia`) para que las dos vean lo mismo. Va aparte de `estado/ia.ts`
// porque esa tienda se baja con el arranque y esto no hace falta hasta que se abre la sección o aparece un trabajo pausado.
import { useEffect } from 'react'
import type { EstadoIA } from '../../../../compartido/ia'
import { apiIA } from './api-ia'
import { useIA } from '../../estado/ia'

let enCurso: Promise<EstadoIA> | null = null

/** Pide el estado de la IA de la cuenta y lo deja en la tienda. Dos pedidos a la vez comparten la respuesta. Falla con el error del servidor. */
export function cargarEstadoIA(): Promise<EstadoIA> {
  enCurso ??= apiIA
    .estado()
    .then((ia) => {
      useIA.setState({ ia })
      return ia
    })
    .finally(() => {
      enCurso = null
    })
  return enCurso
}

/** Lo que el servidor contestó al cambiar algo (un agente, un ajuste): se refleja sin volver a pedir todo. */
export const ponerEstadoIA = (cambiar: (ia: EstadoIA) => EstadoIA) => useIA.setState((s) => (s.ia ? { ia: cambiar(s.ia) } : s))

/** El estado de la IA de la cuenta para una pieza que lo necesita: lo que ya hay y, si falta, lo pide una vez. */
export function useEstadoIA(): EstadoIA | null {
  const ia = useIA((s) => s.ia)
  useEffect(() => {
    if (!ia) cargarEstadoIA().catch(() => {})
  }, [!!ia])
  return ia
}
