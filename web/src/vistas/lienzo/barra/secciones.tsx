// Secciones de la barra contextual. Cada una es un componente suelto (sin la caja flotante): la barra de escritorio las
// pone en fila y el celular puede ponerlas en una hoja inferior (tam="grande").
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  CopyPlus,
  ExternalLink,
  Frame,
  LayoutGrid,
  Lock,
  Replace,
  Shapes,
  SquareKanban,
  StickyNote,
  Trash2,
  Type,
  Unlock,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { ANCHO_TARJETA, leerTarjeta, NOMBRES_COLOR, type VarianteTarjeta } from '../../../../../compartido/lienzo'
import type { Color, ElementoLienzo, TarjetaResumen } from '../../../../../compartido/tipos'
import { irA } from '../../../estado/ruta'
import { enUnPaso } from '../../../estado/deshacer'
import { porOrden, useTienda } from '../../../estado/tienda'
import { useAccionesLienzo, type ComoAlinear } from '../acciones'
import { useSeleccionLienzo } from '../seleccion'
import { MenuMas, type ItemExtra } from './MenuMas'
import { BotonBarra, MenuBarra, Muestra, Separador, type TamBarra } from './piezas'
import { SelectorColor } from './SelectorColor'

// Piezas y secciones sueltas (el celular las puede poner en una hoja inferior).
export { BotonBarra, MenuBarra, Muestra, Separador, type TamBarra, type VariableColor } from './piezas'
export { SelectorColor } from './SelectorColor'
export { SeccionColor } from './seccionColor'
export { SeccionConvertir, SeccionNota, SeccionTamanoNota } from './seccionNota'
export { SeccionBorde, SeccionForma, SeccionOpacidad, SeccionRelleno, SelectorForma } from './seccionForma'
export { SeccionGrafico, SeccionTabla } from './seccionTabla'
export { SeccionMarco, SeccionRellenoMarco, SeccionTamanoMarco, TAMANOS_MARCO } from './seccionMarco'
export { cambiarConectores, SeccionConector } from './seccionConector'
export {
  SeccionAlineacion,
  SeccionColorTexto,
  SeccionEnlace,
  SeccionFondo,
  SeccionInterlineado,
  SeccionListas,
  SeccionMarcas,
  SeccionResaltado,
  SeccionTexto,
  SelectorFuente,
  SelectorTamano,
} from './seccionTexto'

// ───────── secciones ─────────

/** Forma: grilla de las 13 (5 columnas). */
const VARIANTES: { id: VarianteTarjeta; nombre: string; ayuda: string }[] = [
  { id: 'compacta', nombre: 'Compacta', ayuda: 'Una fila: clave y título' },
  { id: 'normal', nombre: 'Normal', ayuda: 'Como en el Kanban' },
  { id: 'expandida', nombre: 'Expandida', ayuda: 'Con el porqué y el avance' },
]

/**
 * Tarjeta del Kanban: `[Abrir] | [Lista ▾] | [Variante ▾] | [Sacar del lienzo]`. Con varias tarjetas elegidas, Lista y
 * Variante van a todas (un paso de deshacer). `sinSacar`: la barra de abajo del teléfono ya lo tiene fijo a la derecha.
 */
export function SeccionTarjeta({ tam, sinSacar }: { tam?: TamBarra; sinSacar?: boolean }) {
  const sel = useSeleccionLienzo()
  const acciones = useAccionesLienzo()
  const tablero = useTienda((s) => s.tablero)
  const els = sel.nodos.filter((x) => x.tipo === 'tarjeta')
  const tarjetas = els.map((x) => (x.tarjetaId ? tablero?.tarjetas.find((t) => t.id === x.tarjetaId) : undefined)).filter(Boolean) as TarjetaResumen[]
  const t = tarjetas[0]
  const listas = [...(tablero?.listas ?? [])].filter((l) => !l.archivada).sort(porOrden)
  const listaActual = t ? listas.find((l) => l.id === t.listaId) : undefined
  const variante = els[0] ? leerTarjeta(els[0].datos).variante : 'normal'
  const libres = els.filter((x) => !x.bloqueado)
  return (
    <>
      {t && els.length === 1 && (
        <BotonBarra tam={tam} etiqueta="Abrir la tarjeta" atajo="Enter" icono={<ExternalLink size={16} />} texto="Abrir" onClick={() => useTienda.getState().abrirTarjeta(t.clave)} />
      )}
      {tarjetas.length > 0 && (
        <>
          <Separador />
          <MenuBarra
            etiqueta="Mover a otra lista"
            tam={tam}
            ancho={220}
            disparador={
              <span className="barra-ctx__lista">
                <span className={`punto-categoria${listaActual?.categoria ? ` punto-categoria--${listaActual.categoria}` : ''}`} />
                {tarjetas.length === 1 ? (listaActual?.nombre ?? 'Sin lista') : 'Lista'}
              </span>
            }
          >
            {(cerrar) => (
              <div className="menu__lista" role="listbox" aria-label="Lista">
                <div className="menu__titulo">Mover a</div>
                {listas.map((l) => {
                  const ya = tarjetas.every((x) => x.listaId === l.id)
                  return (
                    <button
                      key={l.id}
                      type="button"
                      role="option"
                      aria-selected={ya}
                      className={`menu__item${ya ? ' menu__item--activo' : ''}`}
                      onClick={() => {
                        cerrar()
                        const mover = tarjetas.filter((x) => x.listaId !== l.id)
                        if (!mover.length) return
                        // Al final de la lista elegida, todas en un paso.
                        void enUnPaso(mover.length === 1 ? `mover ${mover[0]!.clave}` : `mover ${mover.length} tarjetas`, async () => {
                          for (const x of mover) {
                            const cuantas = (useTienda.getState().tablero?.tarjetas ?? []).filter((y) => y.listaId === l.id && !y.archivada).length
                            await useTienda.getState().moverTarjeta(x.id, l.id, cuantas)
                          }
                        })
                      }}
                    >
                      <span className={`punto-categoria${l.categoria ? ` punto-categoria--${l.categoria}` : ''}`} />
                      <span className="menu__texto">{l.nombre}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </MenuBarra>
        </>
      )}
      {libres.length > 0 && <Separador />}
      {libres.length > 0 && (
        <MenuBarra etiqueta="Variante" tam={tam} ancho={240} disparador={<span className="barra-ctx__boton-texto">{VARIANTES.find((v) => v.id === variante)?.nombre}</span>}>
          {(cerrar) => (
            <div className="menu__lista" role="listbox" aria-label="Variante">
              {VARIANTES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="option"
                  aria-selected={variante === v.id}
                  className={`menu__item menu__item--doble${variante === v.id ? ' menu__item--activo' : ''}`}
                  onClick={() => {
                    cerrar()
                    // Cada variante tiene su ancho de fábrica (compacta 260, normal 288, expandida 340).
                    void useTienda.getState().actualizarElementos(
                      libres.map((x) => ({ id: x.id, ancho: ANCHO_TARJETA[v.id], datos: { variante: v.id } })),
                      { registrar: 'variante de la tarjeta' },
                    )
                  }}
                >
                  <span className="menu__texto">
                    {v.nombre}
                    <small>{v.ayuda}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </MenuBarra>
      )}
      {!sinSacar && (
        <>
          <Separador />
          <BotonBarra
            tam={tam}
            etiqueta="Sacar del lienzo: la tarjeta sigue en su lista"
            atajo="Delete"
            icono={<Trash2 size={16} />}
            texto="Sacar del lienzo"
            onClick={() => acciones.borrar(els.map((x) => x.id), [])}
          />
        </>
      )}
    </>
  )
}

/** Alinear, repartir y ordenar en grilla (varios objetos). */
export function SeccionAlinear({ tam }: { tam?: TamBarra }) {
  const acciones = useAccionesLienzo()
  const fila = (items: [ComoAlinear, string, ReactNode, string][], cerrar: () => void) => (
    <div className="menu-alinear__fila">
      {items.map(([como, nombre, icono, atajo]) => (
        <button
          key={como}
          className="menu-alinear__boton"
          onClick={() => {
            acciones.alinear(como)
            cerrar()
          }}
          aria-label={nombre}
          data-tip={nombre}
          data-tecla={atajo || undefined}
        >
          {icono}
        </button>
      ))}
    </div>
  )
  return (
    <MenuBarra etiqueta="Alinear" tam={tam} disparador={<AlignStartVertical size={16} />}>
      {(cerrar) => (
        <div className="menu-alinear">
          {fila(
            [
              ['izq', 'Alinear a la izquierda', <AlignStartVertical key="a" size={16} />, 'Alt+A'],
              ['centroH', 'Centrar en horizontal', <AlignCenterVertical key="b" size={16} />, 'Alt+H'],
              ['der', 'Alinear a la derecha', <AlignEndVertical key="c" size={16} />, 'Alt+D'],
            ],
            cerrar,
          )}
          {fila(
            [
              ['arriba', 'Alinear arriba', <AlignStartHorizontal key="a" size={16} />, 'Alt+W'],
              ['medio', 'Centrar en vertical', <AlignCenterHorizontal key="b" size={16} />, 'Alt+V'],
              ['abajo', 'Alinear abajo', <AlignEndHorizontal key="c" size={16} />, 'Alt+S'],
            ],
            cerrar,
          )}
          <div className="menu__separador" />
          {(
            [
              ['distH', 'Repartir en horizontal', <AlignHorizontalSpaceAround key="h" size={15} />],
              ['distV', 'Repartir en vertical', <AlignVerticalSpaceAround key="v" size={15} />],
              ['grilla', 'Ordenar en grilla', <LayoutGrid key="g" size={15} />],
            ] as [ComoAlinear, string, ReactNode][]
          ).map(([como, nombre, icono]) => (
            <button
              key={como}
              className="menu__item"
              onClick={() => {
                acciones.alinear(como)
                cerrar()
              }}
            >
              <span className="menu__icono">{icono}</span>
              <span className="menu__texto">{nombre}</span>
            </button>
          ))}
        </div>
      )}
    </MenuBarra>
  )
}

/** Varios objetos de distinto tipo. */
/** La clave del color de cada tipo que tiene uno (la nota y el marco, su color; la forma, su relleno). */
const CLAVE_COLOR: Partial<Record<ElementoLienzo['tipo'], string>> = { nota: 'color', marco: 'color', forma: 'relleno' }

/** Color para una selección mixta (si todo lo elegido tiene color): a cada cosa, el suyo, en un solo paso. */
export function SeccionColorMixto({ tam }: { tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const nodos = sel.nodos.filter((e) => !e.bloqueado)
  if (!nodos.length || !nodos.every((e) => CLAVE_COLOR[e.tipo])) return null
  const primero = nodos[0]!
  const actual = (primero.datos[CLAVE_COLOR[primero.tipo]!] as Color | undefined) ?? null
  const todosIgual = nodos.every((e) => e.datos[CLAVE_COLOR[e.tipo]!] === actual)
  return (
    <MenuBarra
      etiqueta="Color"
      tam={tam}
      disparador={todosIgual ? <Muestra color={actual} variable="--e-s" /> : <span className="barra-ctx__muestra barra-ctx__muestra--mixta" aria-label="Colores distintos" />}
    >
      {(cerrar) => (
        <SelectorColor
          valor={todosIgual ? actual : null}
          variable="--e-s"
          tam={tam}
          alElegir={(c) => {
            if (c === 'ninguno' || c === 'auto') return
            void enUnPaso('cambiar color', async () => {
              await useTienda.getState().actualizarElementos(
                nodos.map((e) => ({ id: e.id, datos: { [CLAVE_COLOR[e.tipo]!]: c } })),
                { registrar: 'cambiar color' },
              )
              for (const x of sel.conectores) await useTienda.getState().actualizarConector(x.id, { color: c })
            })
            cerrar()
          }}
        />
      )}
    </MenuBarra>
  )
}

/** Varios objetos de distinto tipo: `[n objetos] | [Alinear ▾] | [Color ▾] | [Agrupar en marco] [Bloquear] [Duplicar] | [⋯]`. */
export function SeccionMultiple({ tam }: { tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const acciones = useAccionesLienzo()
  const n = sel.nodos.length + sel.conectores.length
  const conColor = sel.nodos.length > 0 && sel.nodos.every((e) => CLAVE_COLOR[e.tipo] && !e.bloqueado)
  return (
    <>
      <span className="barra-ctx__cuenta">{n} objetos</span>
      <Separador />
      <SeccionAlinear tam={tam} />
      {conColor && (
        <>
          <Separador />
          <SeccionColorMixto tam={tam} />
        </>
      )}
      <Separador />
      <BotonBarra tam={tam} etiqueta="Agrupar en marco" atajo="$mod+G" icono={<Frame size={16} />} onClick={() => void acciones.agruparEnMarco()} />
      <BotonBarra tam={tam} etiqueta="Bloquear" atajo="$mod+Shift+L" icono={<Lock size={16} />} onClick={() => acciones.bloquear(true)} />
      <BotonBarra tam={tam} etiqueta="Duplicar" atajo="$mod+D" icono={<CopyPlus size={16} />} onClick={() => acciones.duplicar(null, null)} />
    </>
  )
}

export function SeccionBloqueado({ tam }: { tam?: TamBarra }) {
  const acciones = useAccionesLienzo()
  return <BotonBarra tam={tam} etiqueta="Desbloquear" atajo="$mod+Shift+L" icono={<Unlock size={16} />} texto="Desbloquear" onClick={() => acciones.bloquear(false)} />
}

/** Imagen, enlace, Figma y lista: abrir (y reemplazar la imagen). */
export function SeccionAbrir({ tam, alReemplazar }: { tam?: TamBarra; alReemplazar?: () => void }) {
  const sel = useSeleccionLienzo()
  const e = sel.nodos[0]
  if (!e) return null
  const url = String(e.datos.url ?? '')
  const lista = e.tipo === 'lista' ? useTienda.getState().tablero?.listas.find((l) => l.id === e.listaId) : null
  return (
    <>
      {e.tipo === 'imagen' && alReemplazar && <BotonBarra tam={tam} etiqueta="Reemplazar la imagen" icono={<Replace size={16} />} texto="Reemplazar" onClick={alReemplazar} />}
      {url && <BotonBarra tam={tam} etiqueta="Abrir en otra pestaña" icono={<ExternalLink size={16} />} texto="Abrir" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} />}
      {lista && (
        <BotonBarra
          tam={tam}
          etiqueta="Ver la lista en el Kanban"
          icono={<ExternalLink size={16} />}
          texto="Abrir"
          onClick={() => irA({ vista: 'kanban' })}
        />
      )}
    </>
  )
}

/**
 * El menú ⋯ (copiar y pegar estilo, duplicar, capas, bloquear, borrar). Con un texto o una forma, también "Convertir"
 * (la nota lo tiene en su barra).
 */
export function SeccionOrden({ tam }: { tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const acciones = useAccionesLienzo()
  const e = sel.nodos.length === 1 && !sel.conectores.length ? sel.nodos[0]! : null
  // Supr borra solo el marco (lo de adentro queda); acá, también lo de adentro.
  if (e && e.tipo === 'marco' && !e.bloqueado)
    return (
      <MenuMas
        tam={tam}
        extra={[
          { id: 'borrar-todo', etiqueta: 'Borrar con su contenido', icono: <Trash2 size={15} />, peligro: true, alElegir: () => acciones.borrarConContenido(e.id) },
        ]}
      />
    )
  const extra: ItemExtra[] =
    e && !e.bloqueado && (e.tipo === 'texto' || e.tipo === 'forma')
      ? (
          [
            ['tarjeta', 'Convertir en tarjeta del Kanban', <SquareKanban key="t" size={15} />],
            ['nota', 'Convertir en nota', <StickyNote key="n" size={15} />],
            ['forma', 'Convertir en forma', <Shapes key="f" size={15} />],
            ['texto', 'Convertir en texto', <Type key="x" size={15} />],
          ] as const
        )
          .filter(([a]) => a !== e.tipo)
          .map(([a, etiqueta, icono]) => ({
            id: `convertir-${a}`,
            etiqueta,
            icono,
            alElegir: () => void acciones.convertir(a, null, e.id),
          }))
      : []
  return <MenuMas tam={tam} extra={extra} />
}

export const nombreColor = (c: Color) => NOMBRES_COLOR[c]
