// Los ajustes de una columna: nombre, tipo, formato, ancho, alineación, resumen y orden; insertar o quitar. Se abre desde
// la cabecera del editor de la tabla. Cada cambio es una operación (compartido/tabla.ts) y se puede deshacer.
import { ArrowDownAZ, ArrowUpAZ, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { COLORES_LIENZO, NOMBRES_COLOR } from '../../../../../compartido/lienzo'
import {
  aplicarOperaciones,
  idCorto,
  NOMBRE_RESUMEN,
  TIPOS_COLUMNA,
  esNumerica,
  type ColumnaTabla,
  type DatosTabla,
  type EntradaColumna,
  type OperacionTabla,
  type Resumen,
  type TipoColumna,
} from '../../../../../compartido/tabla'
import type { Color } from '../../../../../compartido/tipos'

type Operar = (ops: OperacionTabla[], etiqueta?: string) => Promise<void>

const MONEDAS = [
  ['ARS', '$ (pesos)'],
  ['USD', 'US$ (dólares)'],
  ['EUR', '€ (euros)'],
  ['BRL', 'R$ (reales)'],
] as const

export function MenuColumna({ tabla, col, operar, cerrar }: { tabla: DatosTabla; col: ColumnaTabla; operar: Operar; cerrar: () => void }) {
  const [nombre, setNombre] = useState(col.nombre)
  const [aviso, setAviso] = useState('')
  const [tipoPendiente, setTipoPendiente] = useState<TipoColumna | null>(null)
  const indice = tabla.columnas.findIndex((c) => c.id === col.id)
  const cambiar = (cambios: Partial<EntradaColumna>, forzar = false) =>
    operar([{ op: 'cambiar_columna', columna: col.id, cambios, forzar }], `cambio en la columna «${col.nombre}»`)

  async function cambiarTipo(tipo: TipoColumna) {
    setAviso('')
    // Se prueba antes: si hay valores que no encajan, se avisa y se pregunta (no se pierden datos sin querer).
    try {
      aplicarOperaciones(tabla, [{ op: 'cambiar_columna', columna: col.id, cambios: { tipo } }])
      await cambiar({ tipo })
    } catch (e) {
      setTipoPendiente(tipo)
      setAviso((e as Error).message.replace(/ Si no importa perderlos, repetí con forzar: true\.$/, ''))
    }
  }

  const resumenes: Resumen[] = esNumerica(col.tipo) ? ['ninguno', 'suma', 'promedio', 'minimo', 'maximo', 'contar', 'llenas'] : ['ninguno', 'contar', 'llenas']

  return (
    <div className="menu-columna" role="group" aria-label={`Columna ${col.nombre}`}>
      <label className="menu-columna__campo">
        <span>Nombre</span>
        <input
          value={nombre}
          maxLength={80}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={() => nombre.trim() && nombre.trim() !== col.nombre && void cambiar({ nombre: nombre.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
      </label>

      <label className="menu-columna__campo">
        <span>Tipo</span>
        <select value={col.tipo} onChange={(e) => void cambiarTipo(e.target.value as TipoColumna)}>
          {TIPOS_COLUMNA.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
      </label>
      {tipoPendiente && (
        <div className="menu-columna__aviso" role="alert">
          {aviso}
          <div className="menu-columna__acciones">
            <button
              type="button"
              className="boton boton--chico"
              onClick={() => {
                const t = tipoPendiente
                setTipoPendiente(null)
                setAviso('')
                void cambiar({ tipo: t }, true)
              }}
            >
              Cambiar igual (se vacían)
            </button>
            <button type="button" className="boton boton--chico boton--fantasma" onClick={() => (setTipoPendiente(null), setAviso(''))}>
              No cambiar
            </button>
          </div>
        </div>
      )}

      {col.tipo === 'moneda' && (
        <label className="menu-columna__campo">
          <span>Moneda</span>
          <select value={(col.moneda ?? 'ARS').toUpperCase()} onChange={(e) => void cambiar({ moneda: e.target.value })}>
            {MONEDAS.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      {(col.tipo === 'numero' || col.tipo === 'moneda' || col.tipo === 'porcentaje') && (
        <label className="menu-columna__campo">
          <span>Decimales</span>
          <select value={typeof col.decimales === 'number' ? String(col.decimales) : 'auto'} onChange={(e) => e.target.value !== 'auto' && void cambiar({ decimales: Number(e.target.value) })}>
            <option value="auto">Automático</option>
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      {col.tipo === 'fecha' && (
        <label className="menu-columna__check">
          <input type="checkbox" checked={!!col.conHora} onChange={(e) => void cambiar({ conHora: e.target.checked })} />
          <span>Con hora</span>
        </label>
      )}
      {col.tipo === 'etiqueta' && (
        <div className="menu-columna__campo">
          <span>Opciones</span>
          <ul className="menu-columna__opciones">
            {(col.opciones ?? []).map((o) => (
              <li key={o.nombre}>
                <select
                  aria-label={`Color de ${o.nombre}`}
                  value={o.color}
                  onChange={(e) => void cambiar({ opciones: (col.opciones ?? []).map((x) => (x.nombre === o.nombre ? { ...x, color: e.target.value as Color } : x)) })}
                >
                  {COLORES_LIENZO.map((c) => (
                    <option key={c} value={c}>
                      {NOMBRES_COLOR[c]}
                    </option>
                  ))}
                </select>
                <span className="celda__pastilla" style={{ background: `var(--e-${o.color})`, color: `var(--e-${o.color}-t)` }}>
                  {o.nombre}
                </span>
                <button
                  type="button"
                  className="boton-icono boton-icono--chico"
                  aria-label={`Quitar la opción ${o.nombre}`}
                  onClick={() => void cambiar({ opciones: (col.opciones ?? []).filter((x) => x.nombre !== o.nombre) })}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <p className="menu-columna__ayuda">Una opción nueva se suma sola al escribirla en una celda.</p>
        </div>
      )}

      <label className="menu-columna__campo">
        <span>Ancho: {col.ancho} px</span>
        <input type="range" min={60} max={640} step={10} value={col.ancho} onChange={(e) => void cambiar({ ancho: Number(e.target.value) })} />
      </label>
      <div className="menu-columna__campo">
        <span>Alineación</span>
        <div className="segmentado segmentado--chico" role="group" aria-label="Alineación">
          {(['izquierda', 'centro', 'derecha'] as const).map((a) => (
            <button key={a} type="button" className={`segmentado__opcion${col.alineacion === a ? ' segmentado__opcion--activa' : ''}`} onClick={() => void cambiar({ alineacion: a })}>
              {a === 'izquierda' ? 'Izq.' : a === 'centro' ? 'Centro' : 'Der.'}
            </button>
          ))}
        </div>
      </div>
      <label className="menu-columna__campo">
        <span>Resumen al pie</span>
        <select value={col.resumen ?? 'ninguno'} onChange={(e) => void cambiar({ resumen: e.target.value as Resumen })}>
          {resumenes.map((r) => (
            <option key={r} value={r}>
              {NOMBRE_RESUMEN[r]}
            </option>
          ))}
        </select>
      </label>

      <div className="menu-columna__acciones">
        <button type="button" className="boton boton--chico" onClick={() => (void operar([{ op: 'ordenar', columna: col.id, direccion: 'asc' }], 'orden de la tabla'), cerrar())}>
          <ArrowDownAZ size={14} /> Ordenar A→Z
        </button>
        <button type="button" className="boton boton--chico" onClick={() => (void operar([{ op: 'ordenar', columna: col.id, direccion: 'desc' }], 'orden de la tabla'), cerrar())}>
          <ArrowUpAZ size={14} /> Z→A
        </button>
        {tabla.orden && (
          <button type="button" className="boton boton--chico boton--fantasma" onClick={() => (void operar([{ op: 'ordenar', columna: null }], 'orden de la tabla'), cerrar())}>
            Quitar orden
          </button>
        )}
      </div>
      <div className="menu-columna__acciones">
        <button
          type="button"
          className="boton boton--chico"
          onClick={() => (void operar([{ op: 'agregar_columna', columna: { nombre: 'Columna nueva' }, en: indice + 1, id: idCorto('c') }], 'columna nueva'), cerrar())}
        >
          <Plus size={14} /> Insertar a la izquierda
        </button>
        <button
          type="button"
          className="boton boton--chico"
          onClick={() => (void operar([{ op: 'agregar_columna', columna: { nombre: 'Columna nueva' }, en: indice + 2, id: idCorto('c') }], 'columna nueva'), cerrar())}
        >
          <Plus size={14} /> A la derecha
        </button>
        {tabla.columnas.length > 1 && (
          <button type="button" className="boton boton--chico boton--peligro" onClick={() => (void operar([{ op: 'quitar_columna', columna: col.id }], 'columna quitada'), cerrar())}>
            <Trash2 size={14} /> Quitar la columna
          </button>
        )}
      </div>
    </div>
  )
}
