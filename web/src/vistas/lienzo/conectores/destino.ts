// El objeto al que llega un conector mientras se arrastra (uno nuevo o un extremo que se reengancha): el de más arriba
// bajo el puntero, sin contar los marcos salvo sobre su título. Se resalta con la clase rf-destino, directo al DOM
// (cambia en cada movimiento del mouse: no vale un render de React).
import type { ReactFlowInstance } from '@xyflow/react'
import type { AristaConector, NodoLienzo } from '../tipos'

export function nodoBajoPuntero(
  rf: ReactFlowInstance<NodoLienzo, AristaConector>,
  punto: { x: number; y: number },
  excluir: string[] = [],
  pantalla?: { x: number; y: number },
): NodoLienzo | null {
  const candidatos = rf
    .getIntersectingNodes({ x: punto.x, y: punto.y, width: 1, height: 1 }, true)
    .filter((n) => !excluir.includes(n.id) && n.type !== 'marco')
  if (candidatos.length) return candidatos.sort((a, b) => a.data.elemento.z - b.data.elemento.z).at(-1)!
  // Un marco se conecta soltando sobre su título (que está arriba del marco, afuera de su caja).
  if (pantalla) {
    const titulo = document.elementsFromPoint(pantalla.x, pantalla.y).find((el) => el.closest('.marco__titulo'))
    const id = titulo?.closest('.react-flow__node')?.getAttribute('data-id')
    if (id && !excluir.includes(id)) return rf.getNode(id) ?? null
  }
  return null
}

let marcado: string | null = null

/** Resalta el objeto de destino (o ninguno). */
export function marcarDestino(id: string | null) {
  if (marcado === id) {
    // React puede haber vuelto a dibujar el nodo y sacado la clase: se repone.
    if (id) document.querySelector(`.lienzo .react-flow__node[data-id="${CSS.escape(id)}"]`)?.classList.add('rf-destino')
    return
  }
  if (marcado) document.querySelector(`.lienzo .react-flow__node[data-id="${CSS.escape(marcado)}"]`)?.classList.remove('rf-destino')
  marcado = id
  if (id) document.querySelector(`.lienzo .react-flow__node[data-id="${CSS.escape(id)}"]`)?.classList.add('rf-destino')
}
