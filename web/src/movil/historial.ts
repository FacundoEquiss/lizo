// "Atrás" cierra lo que está encima (plan del celular, 3.5). En una app instalada no hay barra del navegador: el botón o
// el gesto de atrás es la única forma universal de cerrar. Cada hoja, panel o buscador que se abre suma una entrada al
// historial (misma dirección, estado { hoja: n }); "atrás" la saca y cierra la de más arriba. Si se cierra desde la
// interfaz, se hace history.back() para no dejar una entrada huérfana. ruta.ts no se entera: su dirección no cambió.
// La tarjeta abierta no usa esto: vive en la dirección (?tarjeta=RC-12).
import { useEffect, useRef } from 'react'

interface Entrada {
  id: number
  cerrar: () => void
}

const pila: Entrada[] = []
let siguiente = Date.now() % 100000
/** Cuántos popstate vienen de un history.back() nuestro (no hay que cerrar nada por ellos). */
let propios = 0
let despues: (() => void) | null = null
let reloj: ReturnType<typeof setTimeout> | null = null

// Si se recargó con una hoja abierta, su entrada quedó sin dueño.
if ((history.state as { hoja?: number } | null)?.hoja) history.replaceState(null, '')

function correrDespues() {
  if (reloj) clearTimeout(reloj)
  reloj = null
  const f = despues
  despues = null
  f?.()
}

addEventListener('popstate', (e) => {
  if (propios > 0) {
    propios--
    correrDespues()
    return
  }
  const actual = (e.state as { hoja?: number } | null)?.hoja
  // Se cierran las hojas que quedaron por encima de la entrada a la que se volvió.
  while (pila.length && (actual === undefined || pila[pila.length - 1]!.id > actual)) pila.pop()!.cerrar()
})

function registrar(cerrar: () => void): number {
  const id = ++siguiente
  pila.push({ id, cerrar })
  history.pushState({ hoja: id }, '')
  return id
}

/** Se cerró desde la interfaz: se saca su entrada del historial (si es la de arriba). */
function soltar(id: number, luego?: () => void) {
  const i = pila.findIndex((x) => x.id === id)
  if (i === -1) {
    luego?.()
    return
  }
  pila.splice(i, 1)
  if ((history.state as { hoja?: number } | null)?.hoja === id) {
    propios++
    despues = luego ?? null
    history.back()
    // Si por algo no llega el popstate (no había a dónde volver), lo pendiente corre igual.
    reloj = setTimeout(() => {
      if (propios > 0) propios--
      correrDespues()
    }, 400)
  } else luego?.()
}

/**
 * Cierra `cerrar` con "atrás" mientras `abierto` sea verdadero. Devuelve cerrarYLuego(fn): cierra sacando la entrada del
 * historial y recién después corre fn (para navegar después de cerrar sin que el back() se coma la navegación nueva).
 */
export function useCierraConAtras(abierto: boolean, cerrar: () => void) {
  const refCerrar = useRef(cerrar)
  refCerrar.current = cerrar
  const refId = useRef<number | null>(null)
  const refSoltar = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refLuego = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!abierto) return
    if (refSoltar.current) {
      // StrictMode desmonta y vuelve a montar al toque: se conserva la misma entrada.
      clearTimeout(refSoltar.current)
      refSoltar.current = null
    } else refId.current = registrar(() => refCerrar.current())
    const id = refId.current!
    return () => {
      refSoltar.current = setTimeout(() => {
        refSoltar.current = null
        const luego = refLuego.current ?? undefined
        refLuego.current = null
        soltar(id, luego)
      }, 0)
    }
  }, [abierto])

  return (luego: () => void) => {
    refLuego.current = luego
    refCerrar.current()
  }
}
