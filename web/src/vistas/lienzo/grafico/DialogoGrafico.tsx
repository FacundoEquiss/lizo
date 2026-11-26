// «Datos» del gráfico: el tipo, de dónde salen los números (una tabla del lienzo, o datos propios que se escriben acá),
// el título y el estilo, con una vista previa grande. Cada cambio se guarda al instante y se puede deshacer (usa el mismo
// camino que cualquier cambio de un objeto). En el celular ocupa toda la pantalla.
import { Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  fuenteSugerida,
  leerGrafico,
  resolverGrafico,
  TIPOS_GRAFICO,
  type Agrupar,
  type DatosGrafico,
  type PropiosGrafico,
  type TipoGrafico,
} from '../../../../../compartido/grafico'
import { esNumerica, leerTabla, NOMBRE_TIPO_COLUMNA } from '../../../../../compartido/tabla'
import { useTienda } from '../../../estado/tienda'
import { Dialogo } from '../../../ui/Dialogo'
import { useLienzo } from '../estado'
import { DibujoGrafico } from './Dibujo'

type Origen = 'tabla' | 'propios'

export default function DialogoGrafico() {
  const id = useLienzo((s) => s.graficoAbierto)
  const elementos = useTienda((s) => s.tablero?.elementos)
  const elemento = id ? elementos?.find((x) => x.id === id) : undefined
  const cerrar = () => useLienzo.getState().set({ graficoAbierto: null })
  useEffect(() => {
    if (id && !elemento) cerrar()
  }, [id, elemento])

  const g = useMemo<DatosGrafico | null>(() => (elemento ? leerGrafico(elemento.datos) : null), [elemento?.datos])
  const tablas = useMemo(() => (elementos ?? []).filter((x) => x.tipo === 'tabla'), [elementos])
  const origenTabla = g?.fuente ? tablas.find((x) => x.id === g.fuente!.tabla) : undefined
  const tabla = useMemo(() => (origenTabla ? leerTabla(origenTabla.datos) : null), [origenTabla?.datos])
  const r = useMemo(() => (g ? resolverGrafico(g, tabla) : null), [g, tabla])
  const [origen, setOrigen] = useState<Origen>('tabla')
  useEffect(() => {
    if (g) setOrigen(g.propios ? 'propios' : tablas.length || g.fuente ? 'tabla' : 'propios')
  }, [id])

  // Los datos propios se editan en un borrador y se guardan al salir de cada campo.
  const [borrador, setBorrador] = useState<PropiosGrafico>({ categorias: [], series: [] })
  useEffect(() => {
    if (g) setBorrador(g.propios ?? { categorias: ['A', 'B', 'C'], series: [{ nombre: 'Serie 1', valores: [3, 5, 2] }] })
  }, [id, g?.propios])

  if (!g || !r || !elemento) return <Dialogo abierto={false} alCerrar={cerrar}>{null}</Dialogo>

  const bloqueado = elemento.bloqueado
  const guardar = (datos: Record<string, unknown>, etiqueta = 'cambio en el gráfico') =>
    void useTienda.getState().actualizarElementos([{ id: elemento.id, datos }], { registrar: etiqueta })

  const elegirTabla = (tablaId: string) => {
    const el = tablas.find((x) => x.id === tablaId)
    if (!el) return
    const sug = fuenteSugerida(leerTabla(el.datos), el.id)
    if (sug) guardar({ fuente: sug, propios: null })
  }
  const cambiarFuente = (cambios: Partial<NonNullable<DatosGrafico['fuente']>>) => {
    if (!g.fuente) return
    const f = { ...g.fuente, ...cambios }
    if (f.agrupar === 'contar') f.series = []
    else if (!f.series.length && tabla) f.series = tabla.columnas.filter((c) => c.id !== f.categoria && esNumerica(c.tipo)).slice(0, 1).map((c) => c.id)
    guardar({ fuente: f, propios: null })
  }
  const guardarPropios = (p: PropiosGrafico) => {
    setBorrador(p)
    guardar({ propios: p, fuente: null }, 'datos del gráfico')
  }
  const numerosDe = (texto: string): number | null => {
    const n = Number(texto.replace(',', '.'))
    return texto.trim() === '' || !Number.isFinite(n) ? null : n
  }

  const colsNumericas = tabla ? tabla.columnas.filter((c) => esNumerica(c.tipo)) : []

  return (
    <Dialogo abierto={!!id} alCerrar={cerrar} tituloId="titulo-grafico" className="dialogo--grafico" enfocarInicial={-1}>
      <header className="editor-tabla__cabecera">
        <input
          id="titulo-grafico"
          className="editor-tabla__titulo"
          defaultValue={g.titulo}
          key={`${id}-${g.titulo}`}
          placeholder="Título del gráfico"
          maxLength={120}
          disabled={bloqueado}
          onBlur={(e) => e.target.value.trim() !== g.titulo && guardar({ titulo: e.target.value.trim() }, 'título del gráfico')}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          aria-label="Título del gráfico"
        />
        <button type="button" className="boton-icono" onClick={cerrar} aria-label="Cerrar">
          <X size={18} />
        </button>
      </header>

      <div className="editor-grafico">
        <div className="editor-grafico__ajustes">
          <section>
            <h3>Tipo</h3>
            <div className="editor-grafico__tipos" role="group" aria-label="Tipo de gráfico">
              {TIPOS_GRAFICO.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`editor-grafico__tipo${g.tipo === t.id ? ' editor-grafico__tipo--activo' : ''}`}
                  aria-pressed={g.tipo === t.id}
                  disabled={bloqueado}
                  title={t.uso}
                  onClick={() => guardar({ tipo: t.id as TipoGrafico }, 'tipo de gráfico')}
                >
                  {t.nombre}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>Datos</h3>
            <div className="segmentado segmentado--chico" role="group" aria-label="De dónde salen los datos">
              <button type="button" className={`segmentado__opcion${origen === 'tabla' ? ' segmentado__opcion--activa' : ''}`} onClick={() => setOrigen('tabla')}>
                De una tabla
              </button>
              <button type="button" className={`segmentado__opcion${origen === 'propios' ? ' segmentado__opcion--activa' : ''}`} onClick={() => setOrigen('propios')}>
                Escribirlos acá
              </button>
            </div>

            {origen === 'tabla' && (
              <div className="editor-grafico__campos">
                {tablas.length === 0 ? (
                  <p className="editor-grafico__ayuda">No hay tablas en este lienzo. Creá una con «Tabla» en las herramientas, o escribí los datos acá.</p>
                ) : (
                  <>
                    <label className="menu-columna__campo">
                      <span>Tabla</span>
                      <select value={g.fuente?.tabla ?? ''} disabled={bloqueado} onChange={(e) => elegirTabla(e.target.value)}>
                        <option value="" disabled>
                          Elegí una tabla…
                        </option>
                        {tablas.map((x) => (
                          <option key={x.id} value={x.id}>
                            {String(x.datos.titulo || 'Tabla sin título')}
                          </option>
                        ))}
                      </select>
                    </label>
                    {g.fuente && tabla && (
                      <>
                        <label className="menu-columna__campo">
                          <span>Categorías (el eje)</span>
                          <select value={g.fuente.categoria} disabled={bloqueado} onChange={(e) => cambiarFuente({ categoria: e.target.value })}>
                            {tabla.columnas.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nombre} ({NOMBRE_TIPO_COLUMNA(c.tipo)})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="menu-columna__campo">
                          <span>Si una categoría se repite</span>
                          <select value={g.fuente.agrupar} disabled={bloqueado} onChange={(e) => cambiarFuente({ agrupar: e.target.value as Agrupar })}>
                            <option value="suma">Sumar</option>
                            <option value="promedio">Promediar</option>
                            <option value="contar">Contar filas</option>
                          </select>
                        </label>
                        {g.fuente.agrupar !== 'contar' && (
                          <fieldset className="menu-columna__campo editor-grafico__series">
                            <legend>Qué dibujar</legend>
                            {colsNumericas.length === 0 && <p className="editor-grafico__ayuda">La tabla no tiene columnas con números (número, moneda, porcentaje o duración).</p>}
                            {colsNumericas.map((c) => (
                              <label key={c.id} className="menu-columna__check">
                                <input
                                  type="checkbox"
                                  disabled={bloqueado}
                                  checked={g.fuente!.series.includes(c.id)}
                                  onChange={(e) => {
                                    const lista = e.target.checked ? [...g.fuente!.series, c.id] : g.fuente!.series.filter((x) => x !== c.id)
                                    cambiarFuente({ series: lista.slice(0, 8) })
                                  }}
                                />
                                <span>{c.nombre}</span>
                              </label>
                            ))}
                          </fieldset>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {origen === 'propios' && (
              <div className="editor-grafico__campos">
                <div className="editor-grafico__grilla" role="group" aria-label="Datos del gráfico">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Categoría</th>
                        {borrador.series.map((s, k) => (
                          <th key={k} scope="col">
                            <input
                              aria-label={`Nombre de la serie ${k + 1}`}
                              defaultValue={s.nombre}
                              key={`${k}-${s.nombre}`}
                              disabled={bloqueado}
                              onBlur={(e) => e.target.value !== s.nombre && guardarPropios({ ...borrador, series: borrador.series.map((x, j) => (j === k ? { ...x, nombre: e.target.value || `Serie ${k + 1}` } : x)) })}
                            />
                            {borrador.series.length > 1 && (
                              <button type="button" className="boton-icono boton-icono--chico" aria-label={`Quitar la serie ${s.nombre}`} onClick={() => guardarPropios({ ...borrador, series: borrador.series.filter((_, j) => j !== k) })}>
                                <X size={12} />
                              </button>
                            )}
                          </th>
                        ))}
                        <th>
                          <button type="button" className="boton-icono boton-icono--chico" aria-label="Agregar una serie" disabled={bloqueado || borrador.series.length >= 8} onClick={() => guardarPropios({ ...borrador, series: [...borrador.series, { nombre: `Serie ${borrador.series.length + 1}`, valores: borrador.categorias.map(() => null) }] })}>
                            <Plus size={14} />
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {borrador.categorias.map((c, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              aria-label={`Categoría ${i + 1}`}
                              defaultValue={c}
                              key={`${i}-${c}`}
                              disabled={bloqueado}
                              onBlur={(e) => e.target.value !== c && guardarPropios({ ...borrador, categorias: borrador.categorias.map((x, j) => (j === i ? e.target.value : x)) })}
                            />
                          </td>
                          {borrador.series.map((s, k) => (
                            <td key={k}>
                              <input
                                aria-label={`${c || `Categoría ${i + 1}`}: ${s.nombre}`}
                                inputMode="decimal"
                                defaultValue={s.valores[i] ?? ''}
                                key={`${i}-${k}-${s.valores[i]}`}
                                disabled={bloqueado}
                                onBlur={(e) => {
                                  const n = numerosDe(e.target.value)
                                  if (n !== (s.valores[i] ?? null)) guardarPropios({ ...borrador, series: borrador.series.map((x, j) => (j === k ? { ...x, valores: x.valores.map((v, m) => (m === i ? n : v)) } : x)) })
                                }}
                              />
                            </td>
                          ))}
                          <td>
                            {borrador.categorias.length > 1 && (
                              <button
                                type="button"
                                className="boton-icono boton-icono--chico"
                                aria-label={`Quitar ${c || `la categoría ${i + 1}`}`}
                                onClick={() =>
                                  guardarPropios({ categorias: borrador.categorias.filter((_, j) => j !== i), series: borrador.series.map((x) => ({ ...x, valores: x.valores.filter((_, j) => j !== i) })) })
                                }
                              >
                                <X size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    type="button"
                    className="boton boton--chico"
                    disabled={bloqueado || borrador.categorias.length >= 60}
                    onClick={() => guardarPropios({ categorias: [...borrador.categorias, `Categoría ${borrador.categorias.length + 1}`], series: borrador.series.map((x) => ({ ...x, valores: [...x.valores, null] })) })}
                  >
                    <Plus size={14} /> Categoría
                  </button>
                </div>
              </div>
            )}
          </section>

          <section>
            <h3>Estilo</h3>
            <label className="menu-columna__check">
              <input type="checkbox" checked={g.valores} disabled={bloqueado} onChange={(e) => guardar({ valores: e.target.checked }, 'valores del gráfico')} />
              <span>Mostrar los valores</span>
            </label>
            {(g.tipo === 'barras' || g.tipo === 'barras_h' || g.tipo === 'area') && (
              <label className="menu-columna__check">
                <input type="checkbox" checked={g.apilado} disabled={bloqueado} onChange={(e) => guardar({ apilado: e.target.checked }, 'gráfico apilado')} />
                <span>Series apiladas</span>
              </label>
            )}
            <label className="menu-columna__campo">
              <span>Leyenda</span>
              <select value={g.leyenda} disabled={bloqueado} onChange={(e) => guardar({ leyenda: e.target.value }, 'leyenda del gráfico')}>
                <option value="auto">Automática</option>
                <option value="si">Siempre</option>
                <option value="no">Nunca</option>
              </select>
            </label>
          </section>
        </div>

        <div className="editor-grafico__vista" aria-label="Vista previa">
          {r.categorias.length && r.series.length ? (
            <div className="grafico-nodo editor-grafico__previa">
              <DibujoGrafico g={g} r={r} ancho={520} alto={340} />
            </div>
          ) : (
            <p className="editor-grafico__ayuda">{r.aviso ?? 'Todavía no hay datos.'}</p>
          )}
          {r.aviso && r.categorias.length > 0 && <p className="editor-grafico__ayuda">{r.aviso}</p>}
        </div>
      </div>
    </Dialogo>
  )
}
