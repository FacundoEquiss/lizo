// Lo seleccionado en el lienzo, como objetos de la tienda (para la barra contextual, los menús y el celular).
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Conector, ElementoLienzo, TipoElemento } from '../../../../compartido/tipos'
import type { EstilosFabrica } from '../../../../compartido/lienzo'
import { usePreferencias } from '../../estado/preferencias'
import { porId, useTienda } from '../../estado/tienda'
import { useLienzo } from './estado'

export type TipoSeleccion = TipoElemento | 'conector' | 'mixta' | null

export interface SeleccionLienzo {
  nodos: ElementoLienzo[]
  conectores: Conector[]
  tipo: TipoSeleccion
}

export function useSeleccionLienzo(): SeleccionLienzo {
  const sel = useLienzo(useShallow((s) => s.seleccion))
  const elementos = useTienda((s) => s.tablero?.elementos)
  const conectores = useTienda((s) => s.tablero?.conectores)
  return useMemo(() => {
    const ie = elementos ? porId(elementos) : new Map<string, ElementoLienzo>()
    const ic = conectores ? porId(conectores) : new Map<string, Conector>()
    const nodos = sel.nodos.map((id) => ie.get(id)).filter(Boolean) as ElementoLienzo[]
    const cs = sel.conectores.map((id) => ic.get(id)).filter(Boolean) as Conector[]
    const tipos = new Set<string>([...nodos.map((e) => e.tipo), ...(cs.length ? ['conector'] : [])])
    const tipo: TipoSeleccion = tipos.size === 0 ? null : tipos.size === 1 ? ([...tipos][0] as TipoSeleccion) : 'mixta'
    return { nodos, conectores: cs, tipo }
  }, [sel, elementos, conectores])
}

/**
 * Cambia datos de estilo de varios objetos en un solo paso de deshacer. Con "Recordar el último estilo" prendido, lo
 * elegido queda de fábrica para el próximo objeto de ese tipo.
 */
export function cambiarDatos(elementos: ElementoLienzo[], datos: Record<string, unknown>, etiqueta = 'cambiar estilo') {
  if (!elementos.length) return
  void useTienda.getState().actualizarElementos(
    elementos.map((e) => ({ id: e.id, datos })),
    { registrar: etiqueta },
  )
  const tipos = new Set(elementos.map((e) => e.tipo))
  for (const t of tipos)
    if (t === 'nota' || t === 'texto' || t === 'forma' || t === 'marco') usePreferencias.getState().recordar(t, datos as Partial<EstilosFabrica[typeof t]>)
}
