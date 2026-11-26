// La caja de texto de notas, textos y formas: el editor (TipTap, cargado aparte) si el objeto se está editando, o la
// vista estática si no. Las dos usan el mismo elemento, las mismas clases y el mismo estilo: el texto no salta.
import { lazy, Suspense, useCallback, type CSSProperties } from 'react'
import { alternarTarea, docDesdeTexto, docVacio, textoPlano, type DocRico } from '../../../../../compartido/rico'
import type { ElementoLienzo } from '../../../../../compartido/tipos'
import { ultimoPasoCreo } from '../../../estado/deshacer'
import { estaCreandose, useTienda } from '../../../estado/tienda'
import { VistaRica } from './VistaRica'

const EditorRico = lazy(() => import('./EditorRico'))

/** Precarga el editor en un momento libre (después de abrir el lienzo). */
export function precargarEditor() {
  const ir = () => void import('./EditorRico')
  if ('requestIdleCallback' in window) window.requestIdleCallback(ir, { timeout: 4000 })
  else setTimeout(ir, 1500)
}

export interface AlTerminar {
  /** Datos extra a guardar junto con el texto (en el mismo paso de deshacer). */
  datos?: Record<string, unknown>
  /** Cambios del objeto (medidas reales) en el mismo paso. */
  objeto?: { ancho?: number; alto?: number }
  /** El objeto quedó vacío y se descarta (un texto sin nada). */
  borrar?: boolean
}

export interface PropsCajaTexto {
  elemento: ElementoLienzo
  texto: string
  rico?: DocRico
  className: string
  estilo?: CSSProperties
  permitirTitulos?: boolean
  marcador?: string
  /** Al terminar de editar: qué más guardar (o si se borra). Recibe el documento final y la caja en pantalla. */
  alTerminar?: (doc: DocRico, texto: string, nodo: HTMLElement | null) => AlTerminar | void
  /** Mientras se escribe, en cada cambio. */
  alCambiar?: (doc: DocRico, texto: string) => void
  alAlinear?: (a: 'izquierda' | 'centro' | 'derecha' | 'justificado') => void
}

export function guardarTexto(e: ElementoLienzo, doc: DocRico, texto: string, extra: AlTerminar = {}) {
  const tienda = useTienda.getState()
  if (extra.borrar) {
    // Recién creado y vacío: se va sin dejar rastro. Si ya existía (se le borró todo el texto), es un borrado común
    // y se puede deshacer (vuelve con el texto que tenía).
    void tienda.descartarVacio(e.id)
    return
  }
  const original = (e.datos.rico as DocRico | undefined) ?? docDesdeTexto(String(e.datos.texto ?? ''))
  const cambio = JSON.stringify(original) !== JSON.stringify(doc)
  const datos = { ...(cambio ? { rico: doc, texto } : {}), ...extra.datos }
  const objeto = Object.fromEntries(
    Object.entries(extra.objeto ?? {}).filter(([k, v]) => v !== undefined && Math.abs((v as number) - (e[k as 'ancho' | 'alto'] ?? 0)) > 0.5),
  )
  if (!Object.keys(datos).length && !Object.keys(objeto).length) return
  // El primer texto de un objeto recién creado va con su creación (deshacer lo saca entero, con lo escrito).
  const conLaCreacion = ultimoPasoCreo(e.id) || estaCreandose(e.id)
  void tienda.actualizarElementos(
    [{ id: e.id, ...objeto, ...(Object.keys(datos).length ? { datos } : {}) }],
    // Si solo cambiaron las medidas (sin texto), no es un paso para deshacer.
    { registrar: (cambio || extra.datos) && !conLaCreacion ? 'editar texto' : false },
  )
}

export function CajaTexto({ elemento, texto, rico, className, estilo, permitirTitulos, marcador, alTerminar, alCambiar, alAlinear }: PropsCajaTexto) {
  const id = elemento.id
  const editando = useTienda((s) => s.editando === id)
  // Estable (lee el documento del momento al tildar): así VistaRica no se vuelve a dibujar mientras se arrastra.
  const alternar = useCallback((i: number) => {
    const actual = useTienda.getState().tablero?.elementos.find((x) => x.id === id)
    if (!actual) return
    const doc = alternarTarea((actual.datos.rico as DocRico | undefined) ?? docDesdeTexto(String(actual.datos.texto ?? '')), i)
    guardarTexto(actual, doc, textoPlano(doc))
  }, [id])
  const vista = (
    <VistaRica doc={rico} texto={texto} className={className} estilo={estilo} marcador={marcador} alAlternarTarea={elemento.bloqueado ? undefined : alternar} />
  )
  if (!editando || elemento.bloqueado) return vista
  return (
    <Suspense fallback={vista}>
      <EditorRico
        id={elemento.id}
        doc={rico}
        texto={texto}
        permitirTitulos={permitirTitulos}
        marcador={marcador}
        className={`${className} nodrag nopan`}
        estilo={estilo}
        alAlinear={alAlinear}
        alCambiar={alCambiar}
        alSalir={(doc, plano) => {
          // Lo que esté en la tienda ahora (pudo cambiar el estilo mientras se escribía). Si ya no está (se deshizo su
          // creación, lo borró otro), no hay nada que guardar.
          const actual = useTienda.getState().tablero?.elementos.find((x) => x.id === elemento.id)
          if (!actual) return
          const nodo = document.querySelector<HTMLElement>(`.lienzo .react-flow__node[data-id="${CSS.escape(elemento.id)}"]`)
          const extra = alTerminar?.(doc, plano, nodo) ?? {}
          guardarTexto(actual, doc, plano, extra)
        }}
      />
    </Suspense>
  )
}

export { docVacio }
