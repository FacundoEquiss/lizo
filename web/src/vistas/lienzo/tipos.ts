// Tipos del lienzo en React Flow: cada objeto de la tienda es un nodo y cada conector, una arista.
import type { Edge, Node } from '@xyflow/react'
import type { Conector, ElementoLienzo } from '../../../../compartido/tipos'

export type DatosNodo = { elemento: ElementoLienzo }
export type NodoLienzo = Node<DatosNodo>
export type AristaConector = Edge<{ conector: Conector }, 'conector'>

/** Las piezas de escritorio que el celular puede apagar para poner las suyas (contrato con el plan móvil). */
export interface InterfazLienzo {
  herramientas?: boolean
  aviso?: boolean
  controles?: boolean
  paneles?: boolean
  barraContextual?: boolean
  minimapa?: boolean
  /** El menú "Crear y conectar" de escritorio (el celular puede poner el suyo, en una hoja, con MenuCrearConectado). */
  menuConectar?: boolean
  /** El panel "Buscar en el lienzo" de escritorio (el celular pone una hoja, que abre la misma lupa: useLienzo.buscando). */
  buscador?: boolean
  /** La barra contextual va abajo, en el lugar de la de herramientas, con las opciones desplazables (el teléfono). */
  barraContextualAbajo?: boolean
}
