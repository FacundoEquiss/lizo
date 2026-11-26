// La tabla en el lienzo (solo lectura, liviana: sin editor). Se ve el título, la cabecera, hasta 60 filas, el pie con los
// resúmenes y «+ N filas · Abrir». Se edita en un diálogo (doble clic o «Abrir» en la barra): una sola grilla para la
// computadora y el celular. De lejos se dibuja solo el bloque con su título (sin pastillas ni sombras).
import type { NodeProps } from '@xyflow/react'
import { memo, useContext, useMemo } from 'react'

import { filasOrdenadas, formatearCelda, leerTabla, LIMITES_TABLA, resumenLindo, type ColumnaTabla } from '../../../../../compartido/tabla'
import { ContextoNivel } from '../acciones'
import { useLienzo } from '../estado'
import { alineacionDe, Celda } from '../tabla/Celda'
import type { NodoLienzo } from '../tipos'
import { Candado, Destello, PuntosConexion, Rotulo } from './comunes'

export const TablaNodo = memo(function TablaNodo({ id, data, selected }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  const nivel = useContext(ContextoNivel)
  const t = useMemo(() => leerTabla(e.datos), [e.datos])
  const filas = useMemo(() => filasOrdenadas(t), [t])
  const visibles = filas.slice(0, LIMITES_TABLA.filasEnLienzo)
  const resumenes = useMemo(() => t.columnas.map((c) => (c.resumen && c.resumen !== 'ninguno' ? resumenLindo(c, t.filas) : '')), [t])
  const hayResumen = resumenes.some(Boolean)
  const abrir = () => !e.bloqueado && useLienzo.getState().set({ tablaAbierta: id })
  const clase = `nodo tabla-nodo tabla-nodo--${t.cabecera}${t.rayas ? ' tabla-nodo--rayas' : ''}${nivel ? ` tabla-nodo--${nivel}` : ''}`
  const colorVars = { ['--tabla-color' as string]: `var(--e-${t.color})`, ['--tabla-tinta' as string]: `var(--e-${t.color}-t)`, ['--tabla-fuerte' as string]: `var(--e-${t.color}-s)` }

  return (
    <div className={clase} style={colorVars} aria-label={`Tabla ${t.titulo}`}>
      {nivel === 'muy-lejos' && !selected ? (
        <div className="tabla-nodo__lejos">{t.titulo || 'Tabla'}</div>
      ) : (
        <>
          {t.titulo && <div className="tabla-nodo__titulo">{t.titulo}</div>}
          <div className="tabla-nodo__cuerpo" role="table" aria-label={t.titulo || 'Tabla'}>
            <div className="tabla-nodo__fila tabla-nodo__fila--cabecera" role="row">
              {t.numerosFila && <span className="tabla-nodo__celda tabla-nodo__celda--numero" role="columnheader" />}
              {t.columnas.map((c) => (
                <span key={c.id} className={`tabla-nodo__celda tabla-nodo__celda--${alineacionDe(c)}`} style={{ width: c.ancho }} role="columnheader" title={c.nombre}>
                  {c.nombre}
                </span>
              ))}
            </div>
            {visibles.map((f, i) => (
              <div key={f.id} className="tabla-nodo__fila" role="row">
                {t.numerosFila && <span className="tabla-nodo__celda tabla-nodo__celda--numero" role="cell">{i + 1}</span>}
                {t.columnas.map((c: ColumnaTabla) => (
                  <span key={c.id} className={`tabla-nodo__celda tabla-nodo__celda--${alineacionDe(c)}`} style={{ width: c.ancho }} role="cell">
                    {nivel ? formatearCelda(c, f.celdas[c.id] ?? null) : <Celda col={c} valor={f.celdas[c.id]} />}
                  </span>
                ))}
              </div>
            ))}
            {visibles.length === 0 && (
              <div className="tabla-nodo__fila" role="row">
                <span className="tabla-nodo__vacia">Sin filas todavía</span>
              </div>
            )}
            {filas.length > visibles.length && (
              <button type="button" className="tabla-nodo__mas nodrag" onClick={abrir} onPointerDown={(ev) => ev.stopPropagation()}>
                + {filas.length - visibles.length} filas · Abrir
              </button>
            )}
            {hayResumen && (
              <div className="tabla-nodo__fila tabla-nodo__fila--resumen" role="row">
                {t.numerosFila && <span className="tabla-nodo__celda tabla-nodo__celda--numero" />}
                {t.columnas.map((c, i) => (
                  <span key={c.id} className={`tabla-nodo__celda tabla-nodo__celda--${alineacionDe(c)}`} style={{ width: c.ancho }}>
                    {resumenes[i]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {e.bloqueado && <Candado />}
      <PuntosConexion />
      <Rotulo id={id} texto={`Tabla ${t.titulo || ''}: ${t.columnas.length} columnas y ${t.filas.length} filas`} />
      <Destello id={id} />
    </div>
  )
})

