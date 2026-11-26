// La variable --z (el zoom) para lo que tiene que medir lo mismo en pantalla con cualquier zoom: el marco de
// selección, las manijas, los puntos de conexión, el título de los marcos, las guías. No se escribe en el contenedor
// (eso obligaría a recalcular el estilo de todos los objetos en cada cuadro del zoom): va en una regla CSS que solo
// alcanza a los objetos que la usan en ese momento (seleccionados, bajo el mouse, marcos, bloqueados…).
const SELECTOR = [
  '.lienzo .react-flow__node.selected',
  '.lienzo .react-flow__node:hover',
  '.lienzo .react-flow__node.rf-marco',
  '.lienzo .react-flow__node.rf-bloqueado',
  '.lienzo .react-flow__node.rf-origen',
  '.lienzo .react-flow__node.rf-destino',
  '.lienzo[data-conectando] .react-flow__node',
  '.lienzo--conector .react-flow__node',
  '.lienzo .react-flow__nodesselection-rect',
  '.lienzo .guia',
  '.lienzo .fantasma',
  '.lienzo .react-flow__edge.selected',
  '.lienzo .react-flow__edges',
  '.lienzo .react-flow__edgelabel-renderer',
  '.lienzo .z-constante',
].join(',\n')

let regla: CSSStyleRule | null = null
let ultimo = ''

export function escribirZoom(zoom: number) {
  const valor = String(Math.round(zoom * 10000) / 10000)
  if (valor === ultimo && regla) return
  ultimo = valor
  if (!regla || !regla.parentStyleSheet?.ownerNode?.isConnected) {
    const el = document.createElement('style')
    el.dataset.telar = 'zoom'
    el.textContent = `${SELECTOR} { --z: ${valor}; }`
    document.head.appendChild(el)
    regla = el.sheet!.cssRules[0] as CSSStyleRule
    return
  }
  regla.style.setProperty('--z', valor)
}
