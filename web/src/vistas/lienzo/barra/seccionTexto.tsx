// Formato de texto en la barra contextual (5.2). Lo del objeto entero (fuente, tamaño, alineación, interlineado, fondo)
// se guarda en sus datos; lo del texto (negrita, cursiva, subrayado, tachado, color, resaltado, enlace, listas) va al
// editor si se está escribiendo, o se aplica a todo el texto del objeto si no.
import type { ChainedCommands } from '@tiptap/core'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  Heading1,
  Heading2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Plus,
  Strikethrough,
  Underline,
  WrapText,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import {
  FUENTES,
  INTERLINEADOS,
  leerForma,
  leerNota,
  leerTexto,
  TAMANOS_LETRA,
  type Alineacion,
  type AlineacionV,
  type EstiloTexto,
  type Fuente,
} from '../../../../../compartido/lienzo'
import { atributoDeMarca, bloquesDe, docDesdeTexto, enlaceSeguro, marcaEnTodo, quitarMarca, textoPlano, type DocRico } from '../../../../../compartido/rico'
import type { Color, ElementoLienzo } from '../../../../../compartido/tipos'
import { usePreferencias } from '../../../estado/preferencias'
import { useTienda } from '../../../estado/tienda'
import { Desplegable } from '../../../ui/Desplegable'
import { cambiarDatos, useSeleccionLienzo } from '../seleccion'
import { devolverAlEditor, useEditorActivo } from '../texto/editorActivo'
import { cargarTodas } from '../texto/fuentes'
import { BotonBarra, MenuBarra, Muestra, Separador, type TamBarra } from './piezas'
import { SelectorColor } from './SelectorColor'

type Comando = (c: ChainedCommands) => ChainedCommands
const atajoLegible = (a: string) => a.replace('$mod', /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl').replace(/\+/g, ' ')

const estiloDe = (e: ElementoLienzo): EstiloTexto => (e.tipo === 'nota' ? leerNota(e.datos) : e.tipo === 'forma' ? leerForma(e.datos) : leerTexto(e.datos))
const docDe = (e: ElementoLienzo): DocRico => (e.datos.rico as DocRico | undefined) ?? docDesdeTexto(String(e.datos.texto ?? ''))

/** El editor abierto, si es de uno de estos objetos (y se vuelve a dibujar en cada transacción). */
function useEditorDe(els: ElementoLienzo[]) {
  const editor = useEditorActivo((s) => (s.id && els.some((e) => e.id === s.id) ? s.editor : null))
  useEditorActivo((s) => s.version)
  return editor && !editor.isDestroyed ? editor : null
}

const editorDe = (els: ElementoLienzo[]) => {
  const a = useEditorActivo.getState()
  return a.editor && !a.editor.isDestroyed && a.id && els.some((e) => e.id === a.id) ? a.editor : null
}

/**
 * Aplica un comando de formato: adentro del editor si se está escribiendo, o a todo el texto de cada objeto si no
 * (un editor sin pantalla con todo seleccionado; un solo paso de deshacer para toda la selección).
 */
export async function aplicarFormato(els: ElementoLienzo[], comando: Comando, etiqueta: string, comandoTodo: Comando = comando) {
  const ed = editorDe(els)
  if (ed) {
    comando(ed.chain().focus()).run()
    return
  }
  const { formatearDoc } = await import('../texto/formatear')
  const cambios = els
    .filter((e) => !e.bloqueado)
    .map((e) => {
      const doc = formatearDoc(docDe(e), comandoTodo, e.tipo === 'texto')
      return { id: e.id, datos: { rico: doc, texto: textoPlano(doc) } }
    })
  if (cambios.length) void useTienda.getState().actualizarElementos(cambios, { registrar: etiqueta })
}

/** Un dato del objeto entero (fuente, tamaño, alineación…) y, si se está escribiendo, el foco vuelve al editor. */
function cambiarObjeto(els: ElementoLienzo[], datos: Record<string, unknown>, etiqueta: string) {
  cambiarDatos(els, datos, etiqueta)
  devolverAlEditor()
}

// ───────── fuente y tamaño ─────────

export function SelectorFuente({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useObjetosTexto(elementos)
  const [abierto, setAbierto] = useState(false)
  if (!els.length) return null
  const actual = estiloDe(els[0]!).fuente
  const nombre = FUENTES.find((f) => f.id === actual)?.nombre ?? 'Sans'
  return (
    <Desplegable
      lado="bottom-start"
      separacion={8}
      ancho={200}
      abierto={abierto}
      alCambiar={(v) => {
        setAbierto(v)
        if (v) void cargarTodas()
        else devolverAlEditor()
      }}
      enfocarInicial={Math.max(0, FUENTES.findIndex((f) => f.id === actual))}
      className="menu-barra"
      disparador={(p) => (
        <button
          {...p}
          type="button"
          className={`barra-ctx__boton barra-ctx__boton--fuente${tam === 'grande' ? ' barra-ctx__boton--grande' : ''}`}
          style={{ fontFamily: `var(--f-${actual})` }}
          onMouseDown={(e) => e.preventDefault()}
          onPointerEnter={() => void cargarTodas()}
          aria-label={`Fuente: ${nombre}`}
          data-tip="Fuente"
        >
          <span className="barra-ctx__fuente">{nombre}</span>
        </button>
      )}
    >
      {(cerrar) => (
        <div className="menu__lista" role="listbox" aria-label="Fuente">
          {FUENTES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="option"
              aria-selected={actual === f.id}
              className={`menu__item menu__item--fuente${actual === f.id ? ' menu__item--activo' : ''}`}
              style={{ fontFamily: `var(--f-${f.id})` }}
              onClick={() => {
                cambiarObjeto(els, { fuente: f.id as Fuente }, 'cambiar fuente')
                cerrar()
              }}
              title={f.papel}
            >
              <span className="menu__texto">{f.nombre}</span>
            </button>
          ))}
        </div>
      )}
    </Desplegable>
  )
}

const TAM_MIN = 8
const TAM_MAX = 400

export function SelectorTamano({ elementos, tam, conAuto }: { elementos?: ElementoLienzo[]; tam?: TamBarra; conAuto?: boolean }) {
  const els = useObjetosTexto(elementos)
  const actual = els.length ? estiloDe(els[0]!).tamano : 21
  const mostrar = actual === 'auto' ? 'Auto' : String(actual)
  const [texto, setTexto] = useState(mostrar)
  const [abierto, setAbierto] = useState(false)
  useEffect(() => setTexto(mostrar), [mostrar])
  if (!els.length) return null
  const poner = (t: number | 'auto') =>
    cambiarObjeto(els, { tamano: t === 'auto' ? 'auto' : Math.max(TAM_MIN, Math.min(TAM_MAX, Math.round(t))) }, 'cambiar tamaño de letra')
  // Para − y + el automático parte de un tamaño medio (el ajuste de la nota mide el real).
  const base = actual === 'auto' ? 24 : actual
  const paso = (dir: 1 | -1) => {
    const t = dir === 1 ? (TAMANOS_LETRA.find((x) => x > base) ?? Math.min(TAM_MAX, base + 16)) : ([...TAMANOS_LETRA].reverse().find((x) => x < base) ?? Math.max(TAM_MIN, base - 2))
    poner(t)
  }
  const confirmar = () => {
    const limpio = texto.trim().toLowerCase()
    if (conAuto && (limpio === 'auto' || limpio === '')) poner('auto')
    else {
      const n = Number(limpio.replace(',', '.'))
      if (Number.isFinite(n) && n > 0) poner(n)
      else setTexto(mostrar)
    }
  }
  return (
    <span className="selector-tamano" role="group" aria-label="Tamaño de letra">
      <BotonBarra tam={tam} etiqueta="Achicar la letra" icono={<Minus size={14} />} onClick={() => paso(-1)} deshabilitado={actual !== 'auto' && actual <= TAM_MIN} />
      <Desplegable
        lado="bottom"
        separacion={8}
        ancho={112}
        abierto={abierto}
        alCambiar={setAbierto}
        enfocarInicial={-1}
        className="menu-barra"
        disparador={(p) => (
          <input
            {...(p as object)}
            className="selector-tamano__numero"
            value={texto}
            aria-label="Tamaño de letra (8 a 400)"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setTexto(e.target.value)
              setAbierto(false)
            }}
            onFocus={(e) => e.target.select()}
            onBlur={() => setTexto(mostrar)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                confirmar()
                setAbierto(false)
                ;(e.target as HTMLInputElement).blur()
                devolverAlEditor()
              } else if (e.key === 'Escape') {
                setTexto(mostrar)
                setAbierto(false)
                ;(e.target as HTMLInputElement).blur()
                devolverAlEditor()
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                paso(e.key === 'ArrowUp' ? 1 : -1)
              }
            }}
          />
        )}
      >
        {(cerrar) => (
          <div className="menu__lista menu__lista--tamanos" role="listbox" aria-label="Tamaños">
            {conAuto && (
              <button
                type="button"
                role="option"
                aria-selected={actual === 'auto'}
                className={`menu__item${actual === 'auto' ? ' menu__item--activo' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  poner('auto')
                  cerrar()
                }}
              >
                <span className="menu__texto">Automático</span>
              </button>
            )}
            {TAMANOS_LETRA.map((t) => (
              <button
                key={t}
                type="button"
                role="option"
                aria-selected={actual === t}
                className={`menu__item${actual === t ? ' menu__item--activo' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  poner(t)
                  cerrar()
                }}
              >
                <span className="menu__texto">{t}</span>
              </button>
            ))}
          </div>
        )}
      </Desplegable>
      <BotonBarra tam={tam} etiqueta="Agrandar la letra" icono={<Plus size={14} />} onClick={() => paso(1)} deshabilitado={actual !== 'auto' && actual >= TAM_MAX} />
    </span>
  )
}

// ───────── formato del texto ─────────

const MARCAS: { marca: string; nombre: string; icono: ReactNode; atajo: string; cmd: Comando }[] = [
  { marca: 'bold', nombre: 'Negrita', icono: <Bold size={16} />, atajo: '$mod+B', cmd: (c) => c.toggleBold() },
  { marca: 'italic', nombre: 'Cursiva', icono: <Italic size={16} />, atajo: '$mod+I', cmd: (c) => c.toggleItalic() },
  { marca: 'underline', nombre: 'Subrayado', icono: <Underline size={16} />, atajo: '$mod+U', cmd: (c) => c.toggleUnderline() },
  { marca: 'strike', nombre: 'Tachado', icono: <Strikethrough size={16} />, atajo: '$mod+Shift+X', cmd: (c) => c.toggleStrike() },
]

/** Negrita, cursiva, subrayado y tachado (con su estado: aria-pressed). */
export function SeccionMarcas({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useObjetosTexto(elementos)
  const editor = useEditorDe(els)
  if (!els.length) return null
  const activa = (m: string) => (editor ? editor.isActive(m) : els.every((e) => marcaEnTodo(docDe(e), m)))
  return (
    <>
      {MARCAS.map((m) => {
        const si = activa(m.marca)
        return (
          <BotonBarra
            key={m.marca}
            tam={tam}
            etiqueta={m.nombre}
            atajo={m.atajo}
            icono={m.icono}
            activo={si}
            // Sin editor, sobre todo el texto: si ya estaba en todo, se saca; si no, se pone en todo.
            onClick={() =>
              void aplicarFormato(els, m.cmd, `${si ? 'sacar' : 'poner'} ${m.nombre.toLowerCase()}`, (c) => (si ? c.unsetMark(m.marca) : c.setMark(m.marca)))
            }
          />
        )
      })}
    </>
  )
}

/** Color del texto (por nombre: cambia con el tema). Sin editor, es el color del objeto entero. */
export function SeccionColorTexto({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useObjetosTexto(elementos)
  const editor = useEditorDe(els)
  if (!els.length) return null
  const objeto = estiloDe(els[0]!).colorTexto
  const marca = (editor ? editor.getAttributes('color').color : atributoDeMarca(docDe(els[0]!), 'color', 'color')) as Color | undefined
  const actual: Color | 'auto' = marca ?? objeto
  const elegir = (c: Color | 'auto') => {
    if (editorDe(els)) {
      void aplicarFormato(els, (x) => (c === 'auto' ? x.quitarColor() : x.ponerColor(c)), 'color del texto')
      return
    }
    // El objeto entero: su color, sin los colores sueltos que tuviera adentro (un solo paso).
    void useTienda.getState().actualizarElementos(
      els
        .filter((e) => !e.bloqueado)
        .map((e) => ({ id: e.id, datos: { colorTexto: c, ...(e.datos.rico ? { rico: quitarMarca(docDe(e), 'color') } : {}) } })),
      { registrar: 'color del texto' },
    )
    for (const t of new Set(els.map((e) => e.tipo))) if (t === 'texto' || t === 'nota' || t === 'forma') usePreferencias.getState().recordar(t, { colorTexto: c })
  }
  return (
    <MenuBarra
      etiqueta="Color del texto"
      tam={tam}
      disparador={
        <span className="barra-ctx__letra-color" aria-hidden>
          A
          <span style={{ background: actual === 'auto' ? 'currentColor' : `var(--tinta-${actual})` }} />
        </span>
      }
    >
      {(cerrar) => (
        <SelectorColor
          valor={actual}
          variable="--tinta"
          conAuto="Automático"
          tam={tam}
          alElegir={(c) => {
            elegir(c === 'ninguno' ? 'auto' : c)
            cerrar()
            devolverAlEditor()
          }}
        />
      )}
    </MenuBarra>
  )
}

export function SeccionResaltado({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useObjetosTexto(elementos)
  const editor = useEditorDe(els)
  if (!els.length) return null
  const actual = (
    editor ? (editor.isActive('resaltado') ? editor.getAttributes('resaltado').color : undefined) : atributoDeMarca(docDe(els[0]!), 'resaltado', 'color')
  ) as Color | undefined
  return (
    <MenuBarra
      etiqueta="Resaltado"
      tam={tam}
      activo={!!actual}
      disparador={
        <span className="barra-ctx__resaltado" aria-hidden>
          <Highlighter size={16} />
          <span style={{ background: actual ? `var(--n-${actual})` : 'transparent' }} />
        </span>
      }
    >
      {(cerrar) => (
        <SelectorColor
          valor={actual ?? 'ninguno'}
          variable="--n"
          conNinguno="Sin resaltado"
          tam={tam}
          alElegir={(c) => {
            void aplicarFormato(els, (x) => (c === 'ninguno' || c === 'auto' ? x.quitarResaltado() : x.ponerResaltado(c)), c === 'ninguno' ? 'sacar resaltado' : 'resaltar')
            cerrar()
            devolverAlEditor()
          }}
        />
      )}
    </MenuBarra>
  )
}

// ───────── párrafo ─────────

const ICONOS_ALINEACION: Record<Alineacion, ReactNode> = {
  izquierda: <AlignLeft size={16} />,
  centro: <AlignCenter size={16} />,
  derecha: <AlignRight size={16} />,
  justificado: <AlignJustify size={16} />,
}
const NOMBRES_ALINEACION: Record<Alineacion, string> = {
  izquierda: 'A la izquierda',
  centro: 'Centrado',
  derecha: 'A la derecha',
  justificado: 'Justificado',
}
const ATAJOS_ALINEACION: Record<Alineacion, string> = {
  izquierda: '$mod+Shift+L',
  centro: '$mod+Shift+E',
  derecha: '$mod+Shift+R',
  justificado: '$mod+Shift+J',
}

const ICONOS_ALINEACION_V: Record<AlineacionV, ReactNode> = {
  arriba: <AlignVerticalJustifyStart size={16} />,
  medio: <AlignVerticalJustifyCenter size={16} />,
  abajo: <AlignVerticalJustifyEnd size={16} />,
}
const NOMBRES_ALINEACION_V: Record<AlineacionV, string> = { arriba: 'Arriba', medio: 'En el medio', abajo: 'Abajo' }

/** Alineación del texto (y, en notas y formas, la vertical: arriba, en el medio, abajo). */
export function SeccionAlineacion({ elementos, tam, vertical }: { elementos?: ElementoLienzo[]; tam?: TamBarra; vertical?: boolean }) {
  const els = useObjetosTexto(elementos)
  if (!els.length) return null
  const estilo = estiloDe(els[0]!)
  const actual = estilo.alineacion
  const actualV = estilo.alineacionV
  return (
    <MenuBarra etiqueta="Alineación" tam={tam} disparador={ICONOS_ALINEACION[actual]}>
      {(cerrar) => (
        <div className="menu-iconos menu-iconos--filas">
          <div className="menu-iconos__fila" role="listbox" aria-label="Alineación" aria-orientation="horizontal">
            {(Object.keys(ICONOS_ALINEACION) as Alineacion[]).map((a) => (
              <button
                key={a}
                type="button"
                role="option"
                aria-selected={actual === a}
                className={`menu-iconos__boton${actual === a ? ' menu-iconos__boton--activo' : ''}`}
                onClick={() => {
                  cambiarObjeto(els, { alineacion: a }, 'alinear el texto')
                  cerrar()
                }}
                aria-label={NOMBRES_ALINEACION[a]}
                data-tip={NOMBRES_ALINEACION[a]}
                data-tecla={ATAJOS_ALINEACION[a]}
              >
                {ICONOS_ALINEACION[a]}
              </button>
            ))}
          </div>
          {vertical && (
            <div className="menu-iconos__fila" role="listbox" aria-label="Alineación vertical" aria-orientation="horizontal">
              {(Object.keys(ICONOS_ALINEACION_V) as AlineacionV[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  role="option"
                  aria-selected={actualV === a}
                  className={`menu-iconos__boton${actualV === a ? ' menu-iconos__boton--activo' : ''}`}
                  onClick={() => {
                    cambiarObjeto(els, { alineacionV: a }, 'alinear el texto')
                    cerrar()
                  }}
                  aria-label={NOMBRES_ALINEACION_V[a]}
                  data-tip={NOMBRES_ALINEACION_V[a]}
                >
                  {ICONOS_ALINEACION_V[a]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </MenuBarra>
  )
}

type TipoLista = 'vinetas' | 'numerada' | 'tareas'
const LISTAS: { id: TipoLista; nodo: string; nombre: string; icono: ReactNode; atajo: string; cmd: Comando }[] = [
  { id: 'vinetas', nodo: 'bulletList', nombre: 'Con viñetas', icono: <List size={15} />, atajo: '$mod+Shift+8', cmd: (c) => c.toggleBulletList() },
  { id: 'numerada', nodo: 'orderedList', nombre: 'Numerada', icono: <ListOrdered size={15} />, atajo: '$mod+Shift+7', cmd: (c) => c.toggleOrderedList() },
  { id: 'tareas', nodo: 'taskList', nombre: 'De tareas', icono: <ListChecks size={15} />, atajo: '$mod+Shift+9', cmd: (c) => c.toggleTaskList() },
]

/** Listas (viñetas, numerada, tareas, ninguna) y, en el objeto Texto, títulos 1 y 2. */
export function SeccionListas({ elementos, tam, titulos }: { elementos?: ElementoLienzo[]; tam?: TamBarra; titulos?: boolean }) {
  const els = useObjetosTexto(elementos)
  const editor = useEditorDe(els)
  if (!els.length) return null
  const doc = docDe(els[0]!)
  const bloques = editor ? null : bloquesDe(doc)
  const es = (nodo: string, nivel?: number) =>
    editor
      ? editor.isActive(nodo, nivel ? { level: nivel } : undefined)
      : !!bloques?.has(nodo) && (!nivel || (doc.content ?? []).some((n) => n.type === nodo && n.attrs?.level === nivel))
  const actual = LISTAS.find((l) => es(l.nodo))
  const icono = actual?.icono ?? (titulos && es('heading', 1) ? <Heading1 size={16} /> : titulos && es('heading', 2) ? <Heading2 size={16} /> : <List size={16} />)
  const elegir = (cmd: Comando, etiqueta: string, cerrar: () => void) => {
    void aplicarFormato(els, cmd, etiqueta)
    cerrar()
    devolverAlEditor()
  }
  return (
    <MenuBarra etiqueta={titulos ? 'Listas y títulos' : 'Lista'} tam={tam} activo={!!actual} disparador={icono} ancho={230}>
      {(cerrar) => (
        <div className="menu__lista" role="menu">
          {LISTAS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitemradio"
              aria-checked={actual?.id === l.id}
              className={`menu__item${actual?.id === l.id ? ' menu__item--activo' : ''}`}
              onClick={() => elegir(l.cmd, 'lista', cerrar)}
            >
              <span className="menu__icono">{l.icono}</span>
              <span className="menu__texto">{l.nombre}</span>
              <span className="menu__detalle">{atajoLegible(l.atajo)}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!actual}
            className={`menu__item${!actual ? ' menu__item--activo' : ''}`}
            onClick={() => elegir((c) => (actual ? actual.cmd(c) : c), 'sacar lista', cerrar)}
          >
            <span className="menu__icono">
              <Pilcrow size={15} />
            </span>
            <span className="menu__texto">Sin lista</span>
          </button>
          {titulos && (
            <>
              <div className="menu__separador" />
              {([1, 2] as const).map((nivel) => {
                const si = es('heading', nivel)
                return (
                  <button
                    key={nivel}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={si}
                    className={`menu__item${si ? ' menu__item--activo' : ''}`}
                    onClick={() => elegir((c) => c.toggleHeading({ level: nivel }), si ? 'sacar título' : 'título', cerrar)}
                  >
                    <span className="menu__icono">{nivel === 1 ? <Heading1 size={15} /> : <Heading2 size={15} />}</span>
                    <span className="menu__texto">Título {nivel}</span>
                    <span className="menu__detalle">{atajoLegible(`$mod+Alt+${nivel}`)}</span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </MenuBarra>
  )
}

export function SeccionInterlineado({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useObjetosTexto(elementos)
  if (!els.length) return null
  const actual = estiloDe(els[0]!).interlineado
  const cercano = INTERLINEADOS.reduce((a, b) => (Math.abs(b.valor - actual) < Math.abs(a.valor - actual) ? b : a))
  return (
    <MenuBarra etiqueta="Interlineado" tam={tam} disparador={<WrapText size={16} />} ancho={180}>
      {(cerrar) => (
        <div className="menu__lista" role="listbox" aria-label="Interlineado">
          {INTERLINEADOS.map((i) => (
            <button
              key={i.valor}
              type="button"
              role="option"
              aria-selected={cercano.valor === i.valor}
              className={`menu__item${cercano.valor === i.valor ? ' menu__item--activo' : ''}`}
              onClick={() => {
                cambiarObjeto(els, { interlineado: i.valor }, 'interlineado')
                cerrar()
              }}
            >
              <span className="menu__texto">{i.nombre}</span>
              <span className="menu__detalle">{String(i.valor).replace('.', ',')}</span>
            </button>
          ))}
        </div>
      )}
    </MenuBarra>
  )
}

// ───────── enlace y fondo ─────────

/** Completa lo que se escribió en el campo del enlace: "telar.app" → https://telar.app; "ana@x.com" → mailto:. */
export function normalizarEnlace(texto: string): string | null {
  const t = texto.trim()
  if (!t) return null
  if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(t)) return `mailto:${t}`
  return enlaceSeguro(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`)
}

/** Enlace: un campo para pegar la dirección (Ctrl/⌘ + K adentro del editor abre lo mismo). */
export function SeccionEnlace({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useObjetosTexto(elementos)
  const editor = useEditorDe(els)
  const pedir = useEditorActivo((s) => s.pedirEnlace)
  const [abierto, setAbierto] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!pedir) return
    useEditorActivo.getState().set({ pedirEnlace: false })
    setAbierto(true)
  }, [pedir])
  const primero = els[0]
  const actualHref = primero ? String((editor ? editor.getAttributes('link').href : atributoDeMarca(docDe(primero), 'link', 'href')) ?? '') : ''
  useEffect(() => {
    if (!abierto) return
    setUrl(actualHref)
    setError(false)
    // Solo al abrir: después manda lo que se escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])
  if (!els.length) return null
  const activo = editor ? editor.isActive('link') : els.every((e) => marcaEnTodo(docDe(e), 'link'))
  const cerrar = () => {
    setAbierto(false)
    devolverAlEditor()
  }
  const poner = () => {
    const href = normalizarEnlace(url)
    if (url.trim() && !href) {
      setError(true)
      return
    }
    const ed = editorDe(els)
    if (ed && href && ed.state.selection.empty && !ed.isActive('link')) {
      // Sin texto elegido: se escribe la dirección misma, ya como enlace.
      ed.chain()
        .focus()
        .insertContent({ type: 'text', text: url.trim(), marks: [{ type: 'link', attrs: { href } }] })
        .run()
    } else
      void aplicarFormato(
        els,
        (c) => (href ? c.extendMarkRange('link').setLink({ href }) : c.extendMarkRange('link').unsetLink()),
        href ? 'poner enlace' : 'sacar enlace',
        (c) => (href ? c.setLink({ href }) : c.unsetLink()),
      )
    cerrar()
  }
  return (
    <Desplegable
      lado="bottom"
      separacion={8}
      ancho={320}
      abierto={abierto}
      alCambiar={(v) => (v ? setAbierto(true) : cerrar())}
      className="menu-barra pedir-enlace"
      disparador={(p) => (
        <button
          {...p}
          type="button"
          className={`barra-ctx__boton${activo ? ' barra-ctx__boton--activo' : ''}${tam === 'grande' ? ' barra-ctx__boton--grande' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          aria-label="Enlace"
          aria-pressed={activo}
          data-tip="Enlace"
          data-tecla="$mod+K"
        >
          <Link2 size={16} />
        </button>
      )}
    >
      {() => (
        <form
          className="pedir-enlace__form"
          onSubmit={(e) => {
            e.preventDefault()
            poner()
          }}
        >
          <input
            autoFocus
            className={`campo pedir-enlace__campo${error ? ' campo--error' : ''}`}
            value={url}
            placeholder="Pegá el link (https://…)"
            aria-label="Dirección del enlace"
            aria-invalid={error || undefined}
            onChange={(e) => {
              setUrl(e.target.value)
              setError(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                e.preventDefault()
                cerrar()
              }
            }}
          />
          <button type="submit" className="boton boton--chico boton--primario">
            {url.trim() ? 'Poner' : actualHref ? 'Sacar' : 'Listo'}
          </button>
          {error && <p className="pedir-enlace__error">Solo direcciones web (https://…) o de correo.</p>}
        </form>
      )}
    </Desplegable>
  )
}

/** Fondo del objeto Texto (un rótulo): cualquiera de los 10 colores en su tono suave. */
export function SeccionFondo({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useObjetosTexto(elementos).filter((e) => e.tipo === 'texto')
  if (!els.length) return null
  const actual = leerTexto(els[0]!.datos).fondo
  return (
    <MenuBarra etiqueta="Fondo" tam={tam} disparador={<Muestra color={actual ?? 'ninguno'} variable="--e" />}>
      {(cerrar) => (
        <SelectorColor
          valor={actual ?? 'ninguno'}
          variable="--e"
          conNinguno="Sin fondo"
          conBlanco={{
            activo: (actual as string | null) === 'blanco',
            alElegir: () => {
              cambiarObjeto(els, { fondo: 'blanco' }, 'fondo blanco')
              cerrar()
            },
          }}
          tam={tam}
          alElegir={(c) => {
            cambiarObjeto(els, { fondo: c === 'ninguno' || c === 'auto' ? null : c }, 'fondo del texto')
            cerrar()
          }}
        />
      )}
    </MenuBarra>
  )
}

// ───────── secciones armadas ─────────

/** Los objetos de texto con los que trabaja una sección: los que se le pasan o los seleccionados (sin bloqueados). */
function useObjetosTexto(elementos?: ElementoLienzo[]): ElementoLienzo[] {
  const sel = useSeleccionLienzo()
  return (elementos ?? sel.nodos).filter((e) => (e.tipo === 'texto' || e.tipo === 'nota' || e.tipo === 'forma') && !e.bloqueado)
}

/**
 * La sección de texto completa, según lo seleccionado. Texto:
 * `[Fuente ▾] [− 21 +] | B I U S | Color Resaltado | Alineación Lista Interlineado | Enlace | Fondo`.
 * Notas y formas usan las mismas piezas (sin títulos ni fondo; el tamaño acepta "automático").
 */
/**
 * `acoplada` (la barra de abajo del teléfono, que se desliza de costado): primero lo que más se usa con el dedo
 * (negrita, cursiva, color, alineación) y después la letra; en escritorio, la letra primero.
 */
export function SeccionTexto({ elementos, tam, acoplada }: { elementos?: ElementoLienzo[]; tam?: TamBarra; acoplada?: boolean }) {
  const els = useObjetosTexto(elementos)
  if (!els.length) return null
  const soloTextos = els.every((e) => e.tipo === 'texto')
  if (acoplada)
    return (
      <>
        <SeccionMarcas elementos={els} tam={tam} />
        <Separador />
        <SeccionColorTexto elementos={els} tam={tam} />
        <SeccionResaltado elementos={els} tam={tam} />
        <Separador />
        <SeccionAlineacion elementos={els} tam={tam} />
        <SeccionListas elementos={els} tam={tam} titulos={soloTextos} />
        {soloTextos && <SeccionInterlineado elementos={els} tam={tam} />}
        <Separador />
        <SelectorFuente elementos={els} tam={tam} />
        <SelectorTamano elementos={els} tam={tam} conAuto={!soloTextos} />
        <Separador />
        <SeccionEnlace elementos={els} tam={tam} />
        {soloTextos && (
          <>
            <Separador />
            <SeccionFondo elementos={els} tam={tam} />
          </>
        )}
      </>
    )
  return (
    <>
      <SelectorFuente elementos={els} tam={tam} />
      <SelectorTamano elementos={els} tam={tam} conAuto={!soloTextos} />
      <Separador />
      <SeccionMarcas elementos={els} tam={tam} />
      <Separador />
      <SeccionColorTexto elementos={els} tam={tam} />
      <SeccionResaltado elementos={els} tam={tam} />
      <Separador />
      <SeccionAlineacion elementos={els} tam={tam} />
      <SeccionListas elementos={els} tam={tam} titulos={soloTextos} />
      {soloTextos && <SeccionInterlineado elementos={els} tam={tam} />}
      <Separador />
      <SeccionEnlace elementos={els} tam={tam} />
      {soloTextos && (
        <>
          <Separador />
          <SeccionFondo elementos={els} tam={tam} />
        </>
      )}
    </>
  )
}
