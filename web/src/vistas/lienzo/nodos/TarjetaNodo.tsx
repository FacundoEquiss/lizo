// Tarjeta del Kanban en el lienzo (5.6): la MISMA tarjeta que vive en su lista. Arriba a la izquierda, adentro, una
// insignia de origen ("● En curso") dice de dónde viene. Tres variantes: compacta (una fila), normal (el frente del
// Kanban, sin tocarlo) y expandida (además, el porqué, el avance de la lista de tareas y los responsables). El ancho se
// cambia arrastrando los lados (220 a 560); el alto es el del contenido.
import type { NodeProps } from '@xyflow/react'
import { Archive, Trash2 } from 'lucide-react'
import { memo, useContext } from 'react'
import { ESTADOS_PORQUE } from '../../../../../compartido/constantes'
import { ANCHO_MAX_TARJETA, leerTarjeta, MINIMOS } from '../../../../../compartido/lienzo'
import type { Lista, Miembro, TarjetaResumen } from '../../../../../compartido/tipos'
import { porId, useTienda } from '../../../estado/tienda'
import { Avatar, IconoTipo } from '../../../ui/comunes'
import { TarjetaFrente } from '../../kanban/TarjetaFrente'
import { ContextoNivel } from '../acciones'
import type { NodoLienzo } from '../tipos'
import { Candado, PuntosConexion, Redimensionar, Rotulo } from './comunes'

/** "● En curso": de qué lista del Kanban viene. */
function InsigniaOrigen({ tarjeta, lista }: { tarjeta: TarjetaResumen; lista: Lista | undefined }) {
  const nombre = lista?.nombre ?? 'Sin lista'
  return (
    <span className="tarjeta-lienzo__origen" title={`Tarjeta del Kanban · ${tarjeta.clave} · lista ${nombre}`}>
      <span className={`punto-categoria${lista?.categoria ? ` punto-categoria--${lista.categoria}` : ''}`} />
      {nombre}
    </span>
  )
}

/** El porqué (estado y motivo), el avance de la lista de tareas y los responsables: lo que suma la variante expandida. */
function BloquePorque({ tarjeta: t, miembros }: { tarjeta: TarjetaResumen; miembros: Miembro[] }) {
  const estado = t.porque?.motivo ? ESTADOS_PORQUE.find((e) => e.id === t.porque!.estado) : null
  const responsables = t.responsables.map((id) => miembros.find((m) => m.id === id)?.nombre).filter(Boolean) as string[]
  const { checklistHechos: hechos, checklistTotal: total } = t.contadores
  return (
    <div className="tarjeta-lienzo__mas">
      <div className="tarjeta-lienzo__porque">
        <span className="tarjeta-lienzo__rotulo">Porqué</span>
        {estado ? (
          <>
            <span className="tarjeta-lienzo__estado" style={{ background: `var(--e-${estado.color})`, color: `var(--e-${estado.color}-t)` }}>
              {estado.nombre}
            </span>
            <p className="tarjeta-lienzo__motivo">{t.porque!.motivo}</p>
          </>
        ) : (
          <p className="tarjeta-lienzo__motivo tarjeta-lienzo__motivo--vacio">Sin porqué todavía</p>
        )}
      </div>
      {total > 0 && (
        <div className="tarjeta-lienzo__avance" title={`Lista de tareas: ${hechos} de ${total}`}>
          <span className="tarjeta-lienzo__barra">
            <span style={{ width: `${Math.round((hechos / total) * 100)}%` }} />
          </span>
          <span className="tarjeta-lienzo__cuenta">
            {hechos}/{total}
          </span>
        </div>
      )}
      {responsables.length > 0 && <div className="tarjeta-lienzo__responsables">{responsables.join(', ')}</div>}
    </div>
  )
}

/** Variante compacta: una fila (tipo, clave, título y el primer responsable). */
function TarjetaCompacta({ tarjeta: t, miembros, lista }: { tarjeta: TarjetaResumen; miembros: Miembro[]; lista: Lista | undefined }) {
  const responsable = miembros.find((m) => m.id === t.responsables[0])
  return (
    <div className="tarjeta-lienzo__fila" title={`Tarjeta del Kanban · ${t.clave} · lista ${lista?.nombre ?? 'Sin lista'}`}>
      <span className={`punto-categoria${lista?.categoria ? ` punto-categoria--${lista.categoria}` : ''}`} />
      <IconoTipo tipo={t.tipo} tam={15} />
      <span className="tarjeta-lienzo__clave">{t.clave}</span>
      <span className="tarjeta-lienzo__titulo">{t.titulo}</span>
      {responsable && <Avatar miembro={responsable} tam={22} />}
    </div>
  )
}

export const TarjetaNodo = memo(function TarjetaNodo({ id, data, selected }: NodeProps<NodoLienzo>) {
  const e = data.elemento
  const { variante } = leerTarjeta(e.datos)
  const tarjeta = useTienda((s) => (s.tablero && e.tarjetaId ? porId(s.tablero.tarjetas).get(e.tarjetaId) : undefined))
  const lista = useTienda((s) => (s.tablero && tarjeta?.listaId ? porId(s.tablero.listas).get(tarjeta.listaId) : undefined))
  const etiquetasLista = useTienda((s) => s.tablero?.etiquetas)
  const miembros = useTienda((s) => s.miembros)
  const destello = useTienda((s) => (e.tarjetaId ? s.destellos[e.tarjetaId] : undefined))
  const etiquetas = etiquetasLista ? porId(etiquetasLista) : new Map()
  const soloCaja = useContext(ContextoNivel) === 'muy-lejos' && !selected
  if (!tarjeta || tarjeta.archivada)
    return (
      <div className="nodo nodo-tarjeta nodo-tarjeta--perdida">
        <span className="nodo-tarjeta__aviso">
          <Archive size={16} /> Esta tarjeta ya no está en el tablero
        </span>
        <button
          type="button"
          className="boton boton--chico nodrag"
          onClick={(ev) => {
            ev.stopPropagation()
            void useTienda.getState().eliminarSeleccion([id], [])
          }}
        >
          <Trash2 size={14} /> Sacar del lienzo
        </button>
        <PuntosConexion />
      </div>
    )
  const hecha = lista?.categoria === 'hecho'
  // Muy lejos (9.4): solo la caja, del alto que tenía (lo de adentro no se lee).
  if (soloCaja)
    return (
      <div className={`nodo nodo-tarjeta tarjeta-lienzo tarjeta-lienzo--${variante}`} style={{ height: e.alto }}>
        <Rotulo id={id} texto={`Tarjeta ${tarjeta.clave}, ${tarjeta.titulo}${lista ? `, lista ${lista.nombre}` : ''}${e.bloqueado ? ' (bloqueada)' : ''}`} />
        <PuntosConexion />
      </div>
    )
  return (
    <div className={`nodo nodo-tarjeta tarjeta-lienzo tarjeta-lienzo--${variante}`}>
      <Rotulo id={id} texto={`Tarjeta ${tarjeta.clave}, ${tarjeta.titulo}${lista ? `, lista ${lista.nombre}` : ''}${e.bloqueado ? ' (bloqueada)' : ''}`} />
      {selected && !e.bloqueado && (
        <Redimensionar id={id} min={MINIMOS.tarjeta} max={{ ancho: ANCHO_MAX_TARJETA }} esquinas={false} lados="horizontales" altoAuto />
      )}
      {variante === 'compacta' ? (
        <TarjetaCompacta tarjeta={tarjeta} miembros={miembros} lista={lista} />
      ) : (
        <>
          <InsigniaOrigen tarjeta={tarjeta} lista={lista} />
          <TarjetaFrente tarjeta={tarjeta} etiquetas={etiquetas} miembros={miembros} destello={destello} hecha={hecha} />
          {variante === 'expandida' && <BloquePorque tarjeta={tarjeta} miembros={miembros} />}
        </>
      )}
      {e.bloqueado && <Candado />}
      <PuntosConexion />
    </div>
  )
})
