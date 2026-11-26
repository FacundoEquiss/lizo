// El editor de una tabla del lienzo (doble clic en la tabla, o «Abrir» en la barra): una grilla con celdas que se editan
// según el tipo de columna, menú por columna, filas que se agregan, mueven y quitan, pegar desde Excel o Sheets, copiar
// para Excel y bajar CSV. En el celular ocupa toda la pantalla y las celdas miden 44 px. Cada cambio es una operación
// (compartido/tabla.ts): se ve al instante, se manda al servidor y se puede deshacer con el deshacer de siempre.
import { Copy, Download, EllipsisVertical, Palette, Plus, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { COLORES_LIENZO, NOMBRES_COLOR } from '../../../../../compartido/lienzo'
import {
  filasOrdenadas,
  idCorto,
  leerTabla,
  LIMITES_TABLA,
  normalizarCelda,
  partirGrilla,
  resumenLindo,
  tablaATexto,
  type ColumnaTabla,
  type DatosTabla,
  type OperacionTabla,
  type ValorCelda,
} from '../../../../../compartido/tabla'
import type { Color } from '../../../../../compartido/tipos'
import { avisar } from '../../../estado/avisos'
import { deshacer, useHistorial } from '../../../estado/deshacer'
import { useTienda } from '../../../estado/tienda'
import { Desplegable, Menu } from '../../../ui/Desplegable'
import { Dialogo } from '../../../ui/Dialogo'
import { useLienzo } from '../estado'
import { alineacionDe, Celda } from './Celda'
import { ICONO_TIPO } from './iconos'
import { MenuColumna } from './MenuColumna'

interface Celdita {
  fila: string
  col: string
}

/** El valor de una celda como se escribe en su campo. */
const aTextoEditable = (v: ValorCelda | undefined) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : '') : String(v))

function descargar(nombre: string, texto: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function CampoCelda({
  col,
  inicial,
  alConfirmar,
  alCancelar,
}: {
  col: ColumnaTabla
  inicial: string
  alConfirmar: (texto: string, mover: 'abajo' | 'derecha' | 'ninguno') => void
  alCancelar: () => void
}) {
  const [texto, setTexto] = useState(inicial)
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null)
  useEffect(() => {
    ref.current?.focus()
    if (ref.current instanceof HTMLInputElement && ref.current.type === 'text') ref.current.setSelectionRange(texto.length, texto.length)
  }, [])
  const confirmar = (mover: 'abajo' | 'derecha' | 'ninguno') => {
    const r = normalizarCelda(col, texto)
    if ('error' in r) return setError(r.error)
    alConfirmar(texto, mover)
  }
  const alTecla = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmar('abajo')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      confirmar('derecha')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      alCancelar()
    }
  }
  const comunes = { 'aria-label': col.nombre, onKeyDown: alTecla, onBlur: () => confirmar('ninguno') }
  const id = `opciones-${col.id}`
  return (
    <span className="editor-tabla__campo">
      {col.tipo === 'color' ? (
        <select ref={ref as React.RefObject<HTMLSelectElement>} value={texto} onChange={(e) => setTexto(e.target.value)} {...comunes}>
          <option value="">(vacío)</option>
          {COLORES_LIENZO.map((c) => (
            <option key={c} value={c}>
              {NOMBRES_COLOR[c]}
            </option>
          ))}
        </select>
      ) : (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          value={texto}
          onChange={(e) => (setTexto(e.target.value), setError(''))}
          type={col.tipo === 'fecha' ? (col.conHora ? 'datetime-local' : 'date') : 'text'}
          inputMode={col.tipo === 'numero' || col.tipo === 'moneda' || col.tipo === 'porcentaje' ? 'decimal' : col.tipo === 'telefono' ? 'tel' : col.tipo === 'email' ? 'email' : col.tipo === 'link' ? 'url' : undefined}
          list={col.tipo === 'etiqueta' ? id : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...comunes}
        />
      )}
      {col.tipo === 'etiqueta' && <datalist id={id}>{(col.opciones ?? []).map((o) => <option key={o.nombre} value={o.nombre} />)}</datalist>}
      {error && (
        <span className="editor-tabla__error" role="alert">
          {error}
        </span>
      )}
    </span>
  )
}

export default function DialogoTabla() {
  const id = useLienzo((s) => s.tablaAbierta)
  const elemento = useTienda((s) => (id ? s.tablero?.elementos.find((x) => x.id === id) : undefined))
  const cerrar = () => useLienzo.getState().set({ tablaAbierta: null })
  // Si la tabla se va (la sacaron del lienzo, o la borró otra persona), el editor se cierra.
  useEffect(() => {
    if (id && !elemento) cerrar()
  }, [id, elemento])
  const t = useMemo<DatosTabla | null>(() => (elemento ? leerTabla(elemento.datos) : null), [elemento?.datos])
  const filas = useMemo(() => (t ? filasOrdenadas(t) : []), [t])
  const [sel, setSel] = useState<Celdita | null>(null)
  const [editando, setEditando] = useState<string | null>(null) // texto inicial de la edición
  const { puedeDeshacer } = useHistorial()
  const grilla = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSel(null)
    setEditando(null)
  }, [id])

  async function operar(ops: OperacionTabla[], etiqueta?: string, cambios?: Record<string, unknown>) {
    if (!id) return
    const avisos = await useTienda.getState().operarTabla(id, ops, { etiqueta, cambios })
    if (avisos?.length) avisar({ texto: avisos.length === 1 ? avisos[0]! : `${avisos.length} valores no encajaron y quedaron vacíos (podés deshacer).`, tipo: 'info', duracion: 6000 })
  }

  if (!t || !elemento) return <Dialogo abierto={false} alCerrar={cerrar}>{null}</Dialogo>

  const bloqueada = elemento.bloqueado
  const colIndice = (colId: string) => t.columnas.findIndex((c) => c.id === colId)
  const filaIndice = (filaId: string) => filas.findIndex((f) => f.id === filaId)

  const mover = (desde: Celdita, dx: number, dy: number): Celdita => {
    if (!filas.length) return desde
    const i = Math.min(Math.max(filaIndice(desde.fila) + dy, 0), filas.length - 1)
    const j = Math.min(Math.max(colIndice(desde.col) + dx, 0), t.columnas.length - 1)
    return { fila: filas[i]!.id, col: t.columnas[j]!.id }
  }

  async function confirmarCelda(texto: string, mas: 'abajo' | 'derecha' | 'ninguno') {
    if (!sel) return
    const actual = filas.find((f) => f.id === sel.fila)
    const col = t!.columnas.find((c) => c.id === sel.col)
    setEditando(null)
    if (!actual || !col) return
    const antes = aTextoEditable(actual.celdas[col.id])
    if (texto !== antes) await operar([{ op: 'cambiar_celdas', celdas: [{ fila: sel.fila, columna: sel.col, valor: texto }] }], 'cambio de una celda')
    if (mas === 'abajo') setSel(sel.fila === filas[filas.length - 1]?.id ? sel : mover(sel, 0, 1))
    if (mas === 'derecha') setSel(mover(sel, 1, 0))
    grilla.current?.focus()
  }

  const empezar = (c: Celdita, texto?: string) => {
    if (bloqueada) return
    const col = t.columnas.find((x) => x.id === c.col)!
    setSel(c)
    if (col.tipo === 'casilla') {
      const fila = filas.find((f) => f.id === c.fila)
      return void operar([{ op: 'cambiar_celdas', celdas: [{ fila: c.fila, columna: c.col, valor: fila?.celdas[col.id] !== true }] }], 'casilla')
    }
    const f = filas.find((x) => x.id === c.fila)
    setEditando(texto ?? aTextoEditable(f?.celdas[c.col]))
  }

  const alTeclaGrilla = (e: KeyboardEvent) => {
    if (editando !== null || !sel || bloqueada) return
    const flechas: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
    if (flechas[e.key]) {
      e.preventDefault()
      return setSel(mover(sel, ...flechas[e.key]!))
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      return setSel(mover(sel, e.shiftKey ? -1 : 1, 0))
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      return empezar(sel)
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      return void operar([{ op: 'cambiar_celdas', celdas: [{ fila: sel.fila, columna: sel.col, valor: null }] }], 'celda vaciada')
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      return setSel(null)
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      empezar(sel, e.key)
    }
  }

  // Pegar desde Excel o Sheets: se llena desde la celda elegida; si faltan filas, se agregan.
  const alPegar = (e: ClipboardEvent) => {
    if (editando !== null || bloqueada) return
    const texto = e.clipboardData.getData('text/plain')
    if (!texto) return
    e.preventDefault()
    const g = partirGrilla(texto)
    if (!g.length) return
    const i0 = sel ? Math.max(filaIndice(sel.fila), 0) : 0
    const j0 = sel ? Math.max(colIndice(sel.col), 0) : 0
    const faltan = Math.max(0, i0 + g.length - filas.length)
    if (filas.length + faltan > LIMITES_TABLA.filas) return void avisar({ texto: `Una tabla admite hasta ${LIMITES_TABLA.filas} filas.`, tipo: 'error' })
    const nuevas = Array.from({ length: faltan }, () => idCorto('f'))
    const ops: OperacionTabla[] = []
    if (faltan) ops.push({ op: 'agregar_filas', filas: nuevas.map(() => []), ids: nuevas })
    const celdas: { fila: string; columna: string; valor: string }[] = []
    let sobran = 0
    g.forEach((fila, r) => {
      const refFila = i0 + r < filas.length ? filas[i0 + r]!.id : nuevas[i0 + r - filas.length]!
      fila.forEach((valor, c) => {
        const col = t.columnas[j0 + c]
        if (!col) return void sobran++
        celdas.push({ fila: refFila, columna: col.id, valor })
      })
    })
    ops.push({ op: 'cambiar_celdas', celdas })
    void operar(ops, 'pegar en la tabla')
    if (sobran) avisar({ texto: `Pegué ${celdas.length} valores; ${sobran} quedaron afuera porque no hay más columnas.`, tipo: 'info' })
  }

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(tablaATexto(t, 'tsv'))
      avisar({ texto: 'Copiada: pegala en Excel o Google Sheets.', tipo: 'ok' })
    } catch {
      avisar({ texto: 'No pude copiar. Probá descargar el CSV.', tipo: 'error' })
    }
  }

  const resumenes = t.columnas.map((c) => (c.resumen && c.resumen !== 'ninguno' ? resumenLindo(c, t.filas) : ''))
  const columnaOrden = t.orden ? t.columnas.find((c) => c.id === t.orden!.columna) : undefined

  return (
    <Dialogo abierto={!!id} alCerrar={cerrar} tituloId="titulo-tabla" className="dialogo--tabla" enfocarInicial={-1}>
      <header className="editor-tabla__cabecera">
        <input
          id="titulo-tabla"
          className="editor-tabla__titulo"
          defaultValue={t.titulo}
          key={`${id}-${t.titulo}`}
          placeholder="Título de la tabla"
          maxLength={120}
          disabled={bloqueada}
          onBlur={(e) => e.target.value.trim() !== t.titulo && void operar([], 'título de la tabla', { titulo: e.target.value.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          aria-label="Título de la tabla"
        />
        <div className="editor-tabla__acciones">
          <button type="button" className="boton boton--chico" onClick={() => void deshacer()} disabled={!puedeDeshacer} aria-label="Deshacer">
            <Undo2 size={14} /> <span className="editor-tabla__texto-boton">Deshacer</span>
          </button>
          <Desplegable
            lado="bottom-end"
            disparador={(p) => (
              <button {...p} type="button" className="boton boton--chico" aria-label="Estilo de la tabla">
                <Palette size={14} /> <span className="editor-tabla__texto-boton">Estilo</span>
              </button>
            )}
          >
            {() => (
              <div className="menu-columna" role="group" aria-label="Estilo de la tabla">
                <div className="menu-columna__campo">
                  <span>Color</span>
                  <div className="editor-tabla__colores">
                    {COLORES_LIENZO.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`herramientas__color${t.color === c ? ' herramientas__color--activo' : ''}`}
                        style={{ background: `var(--n-${c})` }}
                        aria-label={NOMBRES_COLOR[c]}
                        aria-pressed={t.color === c}
                        onClick={() => void operar([], 'color de la tabla', { color: c as Color })}
                      />
                    ))}
                  </div>
                </div>
                <div className="menu-columna__campo">
                  <span>Cabecera</span>
                  <div className="segmentado segmentado--chico" role="group" aria-label="Cabecera">
                    {(['tinte', 'fuerte', 'lisa'] as const).map((c) => (
                      <button key={c} type="button" className={`segmentado__opcion${t.cabecera === c ? ' segmentado__opcion--activa' : ''}`} onClick={() => void operar([], 'cabecera de la tabla', { cabecera: c })}>
                        {c === 'tinte' ? 'Suave' : c === 'fuerte' ? 'Fuerte' : 'Lisa'}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="menu-columna__check">
                  <input type="checkbox" checked={t.rayas} onChange={(e) => void operar([], 'rayas de la tabla', { rayas: e.target.checked })} />
                  <span>Filas con rayas</span>
                </label>
                <label className="menu-columna__check">
                  <input type="checkbox" checked={t.numerosFila} onChange={(e) => void operar([], 'números de fila', { numerosFila: e.target.checked })} />
                  <span>Número de fila</span>
                </label>
              </div>
            )}
          </Desplegable>
          <button type="button" className="boton boton--chico" onClick={copiar} aria-label="Copiar para Excel">
            <Copy size={14} /> <span className="editor-tabla__texto-boton">Copiar para Excel</span>
          </button>
          <button type="button" className="boton boton--chico" onClick={() => descargar(`${t.titulo || 'tabla'}.csv`, `﻿${tablaATexto(t, 'csv')}`, 'text/csv;charset=utf-8')} aria-label="Descargar CSV">
            <Download size={14} /> <span className="editor-tabla__texto-boton">CSV</span>
          </button>
          <button type="button" className="boton-icono" onClick={cerrar} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
      </header>

      {bloqueada && <p className="editor-tabla__aviso">La tabla está bloqueada: desbloqueala en el lienzo para cambiarla.</p>}
      {columnaOrden && (
        <p className="editor-tabla__aviso editor-tabla__aviso--suave">
          Ordenada por «{columnaOrden.nombre}» ({t.orden!.direccion === 'asc' ? 'A→Z' : 'Z→A'}). Los datos no se mueven: es solo la vista.{' '}
          <button type="button" className="boton boton--chico boton--fantasma" onClick={() => void operar([{ op: 'ordenar', columna: null }], 'orden de la tabla')}>
            Quitar orden
          </button>
        </p>
      )}

      <div className="editor-tabla__grilla" ref={grilla} tabIndex={0} onKeyDown={alTeclaGrilla} onPaste={alPegar} role="grid" aria-label={t.titulo || 'Tabla'} aria-rowcount={filas.length + 1}>
        <table className="editor-tabla">
          <thead>
            <tr>
              <th className="editor-tabla__num" scope="col" aria-label="Fila" />
              {t.columnas.map((c) => {
                const Icono = ICONO_TIPO[c.tipo]
                return (
                  <th key={c.id} scope="col" style={{ minWidth: c.ancho, width: c.ancho }} className={t.orden?.columna === c.id ? 'editor-tabla__th--orden' : undefined}>
                    <Desplegable
                      lado="bottom-start"
                      disparador={(p) => (
                        <button {...p} type="button" className="editor-tabla__cab" disabled={bloqueada} aria-label={`Columna ${c.nombre}: ajustes`}>
                          <Icono size={13} aria-hidden />
                          <span>{c.nombre}</span>
                          {t.orden?.columna === c.id && <small aria-hidden>{t.orden.direccion === 'asc' ? '↑' : '↓'}</small>}
                        </button>
                      )}
                    >
                      {(cerrarMenu) => <MenuColumna tabla={t} col={c} operar={operar} cerrar={cerrarMenu} />}
                    </Desplegable>
                  </th>
                )
              })}
              <th className="editor-tabla__mas-col">
                <button
                  type="button"
                  className="boton-icono boton-icono--chico"
                  aria-label="Agregar una columna"
                  disabled={bloqueada || t.columnas.length >= LIMITES_TABLA.columnas}
                  onClick={() => void operar([{ op: 'agregar_columna', columna: { nombre: `Columna ${t.columnas.length + 1}` }, id: idCorto('c') }], 'columna nueva')}
                >
                  <Plus size={15} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.id}>
                <th scope="row" className="editor-tabla__num">
                  <Menu
                    lado="bottom-start"
                    disparador={(p) => (
                      <button {...p} type="button" className="editor-tabla__fila-menu" disabled={bloqueada} aria-label={`Fila ${i + 1}: opciones`}>
                        <span>{i + 1}</span>
                        <EllipsisVertical size={13} aria-hidden />
                      </button>
                    )}
                    items={[
                      { id: 'arriba', etiqueta: 'Insertar arriba', alElegir: () => void operar([{ op: 'agregar_filas', filas: [[]], en: t.filas.indexOf(f) + 1, ids: [idCorto('f')] }], 'fila nueva') },
                      { id: 'abajo', etiqueta: 'Insertar abajo', alElegir: () => void operar([{ op: 'agregar_filas', filas: [[]], en: t.filas.indexOf(f) + 2, ids: [idCorto('f')] }], 'fila nueva') },
                      { id: 'quitar', etiqueta: 'Quitar la fila', peligro: true, separador: true, alElegir: () => void operar([{ op: 'quitar_filas', filas: [f.id] }], 'fila quitada') },
                    ]}
                  />
                </th>
                {t.columnas.map((c) => {
                  const esSel = sel?.fila === f.id && sel.col === c.id
                  return (
                    <td
                      key={c.id}
                      role="gridcell"
                      aria-selected={esSel || undefined}
                      className={`editor-tabla__celda editor-tabla__celda--${alineacionDe(c)}${esSel ? ' editor-tabla__celda--sel' : ''}`}
                      onClick={() => (esSel && editando === null ? empezar({ fila: f.id, col: c.id }) : setSel({ fila: f.id, col: c.id }))}
                      onDoubleClick={() => empezar({ fila: f.id, col: c.id })}
                    >
                      {esSel && editando !== null ? (
                        <CampoCelda col={c} inicial={editando} alConfirmar={confirmarCelda} alCancelar={() => (setEditando(null), grilla.current?.focus())} />
                      ) : (
                        <span className="editor-tabla__valor">
                          <Celda col={c} valor={f.celdas[c.id]} />
                        </span>
                      )}
                    </td>
                  )
                })}
                <td className="editor-tabla__vacio" />
              </tr>
            ))}
          </tbody>
          {resumenes.some(Boolean) && (
            <tfoot>
              <tr>
                <td className="editor-tabla__num" />
                {t.columnas.map((c, i) => (
                  <td key={c.id} className={`editor-tabla__resumen editor-tabla__celda--${alineacionDe(c)}`}>
                    {resumenes[i]}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <footer className="editor-tabla__pie">
        <button
          type="button"
          className="boton boton--chico"
          disabled={bloqueada || t.filas.length >= LIMITES_TABLA.filas}
          onClick={() => void operar([{ op: 'agregar_filas', filas: [[]], ids: [idCorto('f')] }], 'fila nueva')}
        >
          <Plus size={14} /> Fila
        </button>
        <span className="editor-tabla__cuenta">
          {t.filas.length} {t.filas.length === 1 ? 'fila' : 'filas'} · {t.columnas.length} {t.columnas.length === 1 ? 'columna' : 'columnas'}
        </span>
        <span className="editor-tabla__ayuda">Tocá una celda para escribir. Pegá desde Excel con Ctrl+V.</span>
      </footer>
    </Dialogo>
  )
}
