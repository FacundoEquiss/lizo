// Una fila de tablero en la barra lateral (7.1): 32 px con sangría bajo el hilo del proyecto. El activo lleva el punto
// del color del proyecto sobre el hilo (se desliza al cambiar de tablero). A la derecha, sus tarjetas abiertas; al pasar
// el mouse, el menú del tablero. Doble clic o F2: renombrar en el lugar. Lleva el ícono de su tipo (Tablero, Diagrama, Diseño o
// Completo: compartido/vistas.ts) y las tarjetas abiertas solo si tiene Kanban; el menú tiene «Vistas…» para sumar o sacar una.
import { Archive, ArchiveRestore, Layers, Link2, MoreHorizontal, Pencil, Text } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Proyecto, TableroResumen } from '../../../../compartido/tipos'
import { tieneVista, vistaInicial } from '../../../../compartido/vistas'
import { avisar } from '../../estado/avisos'
import { irA, useRuta } from '../../estado/ruta'
import { useTienda } from '../../estado/tienda'
import { Desplegable, Menu } from '../../ui/Desplegable'
import { IconoTablero } from '../../ui/TipoTablero'
import { ArchivoHecho } from '../kanban/ArchivoHecho'
import { PanelVistas } from './PanelVistas'

export function enlaceTablero(p: Pick<Proyecto, 'prefijo'>, t: Pick<TableroResumen, 'slug'>) {
  return `${location.origin}/${encodeURIComponent(p.prefijo)}/${encodeURIComponent(t.slug)}`
}

export async function copiarEnlace(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    avisar({ texto: 'Enlace copiado', duracion: 1800 })
  } catch {
    avisar({ texto: url, duracion: 6000 })
  }
}

export function FilaTablero({ proyecto, tablero, activo, abiertas }: { proyecto: Proyecto; tablero: TableroResumen; activo: boolean; abiertas: number }) {
  const ruta = useRuta()
  const [renombrando, setRenombrando] = useState(false)
  const [descripcion, setDescripcion] = useState(false)
  const [archivoHecho, setArchivoHecho] = useState(false)
  const [vistas, setVistas] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [nombre, setNombre] = useState(tablero.nombre)
  const fila = useRef<HTMLDivElement>(null)
  useEffect(() => setNombre(tablero.nombre), [tablero.nombre])

  const guardarNombre = () => {
    setRenombrando(false)
    const n = nombre.trim()
    // Vacío: no guarda y vuelve al anterior.
    if (!n || n === tablero.nombre) return setNombre(tablero.nombre)
    void useTienda.getState().actualizarTablero(tablero.id, { nombre: n })
  }

  if (confirmar)
    return (
      <div className="tablero-item tablero-item--confirmar" role="alertdialog" aria-label={`Archivar el tablero ${tablero.nombre}`}>
        <span className="tablero-item__pregunta">¿Archivar «{tablero.nombre}»?</span>
        <button
          type="button"
          className="boton boton--chico boton--rojo"
          autoFocus
          onClick={() => {
            setConfirmar(false)
            void useTienda.getState().archivarTablero(tablero.id)
          }}
        >
          Archivar
        </button>
        <button type="button" className="boton boton--chico" onClick={() => setConfirmar(false)} onKeyDown={(e) => e.key === 'Escape' && setConfirmar(false)}>
          Cancelar
        </button>
      </div>
    )

  return (
    <div ref={fila} className={`tablero-item${activo ? ' tablero-item--activo' : ''}`}>
      {activo && (
        <motion.span
          layoutId="punto-tablero"
          className="tablero-item__punto"
          style={{ background: `var(--e-${proyecto.color}-s)` }}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        />
      )}
      {renombrando ? (
        <input
          className="tablero-item__campo"
          autoFocus
          value={nombre}
          aria-label="Nombre del tablero"
          onChange={(e) => setNombre(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={guardarNombre}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setNombre(tablero.nombre)
              setRenombrando(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="tablero-item__fila"
          // Se queda en la vista que se estaba mirando si este tablero la tiene; si no, entra por la primera que tiene.
          onClick={() =>
            irA({ prefijo: proyecto.prefijo, slug: tablero.slug, vista: tieneVista(tablero, ruta.vista) ? ruta.vista : vistaInicial(tablero.vistas), tarjeta: null })
          }
          onDoubleClick={() => setRenombrando(true)}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault()
              setRenombrando(true)
            }
          }}
          aria-current={activo ? 'page' : undefined}
          title={tablero.descripcion ? `${tablero.nombre}: ${tablero.descripcion}` : tablero.nombre}
        >
          <IconoTablero vistas={tablero.vistas} className="tablero-item__icono" />
          <span className="tablero-item__nombre">{tablero.nombre}</span>
          {tieneVista(tablero, 'kanban') && (
            <span className="tablero-item__cuenta" aria-label={`${abiertas} tarjetas abiertas`}>
              {abiertas}
            </span>
          )}
        </button>
      )}
      {!renombrando && (
        <Menu
          lado="bottom-end"
          items={[
            { id: 'renombrar', etiqueta: 'Renombrar', icono: <Pencil size={15} />, atajo: 'F2', alElegir: () => setRenombrando(true) },
            { id: 'descripcion', etiqueta: 'Editar descripción', icono: <Text size={15} />, alElegir: () => setDescripcion(true) },
            { id: 'vistas', etiqueta: 'Vistas…', icono: <Layers size={15} />, alElegir: () => setVistas(true) },
            ...(tieneVista(tablero, 'kanban')
              ? [{ id: 'archivo-hecho', etiqueta: 'Archivo de Hecho…', icono: <ArchiveRestore size={15} />, alElegir: () => setArchivoHecho(true) }]
              : []),
            { id: 'enlace', etiqueta: 'Copiar enlace', icono: <Link2 size={15} />, alElegir: () => void copiarEnlace(enlaceTablero(proyecto, tablero)) },
            {
              id: 'archivar',
              etiqueta: 'Archivar tablero',
              icono: <Archive size={15} />,
              separador: true,
              peligro: true,
              alElegir: () => {
                if (proyecto.tableros.length <= 1) avisar({ texto: 'Un proyecto necesita al menos un tablero: no se puede archivar el último.', tipo: 'error' })
                else setConfirmar(true)
              },
            },
          ]}
          disparador={(p) => (
            <button {...p} type="button" className="tablero-item__mas" aria-label={`Opciones del tablero ${tablero.nombre}`}>
              <MoreHorizontal size={15} />
            </button>
          )}
        />
      )}
      {descripcion && <EditarDescripcion tablero={tablero} alCerrar={() => setDescripcion(false)} />}
      {archivoHecho && <VentanitaArchivoHecho tablero={tablero} alCerrar={() => setArchivoHecho(false)} />}
      {vistas && <PanelVistas tableroId={tablero.id} abierto alCerrar={() => setVistas(false)} />}
    </div>
  )
}

/** La ventanita "Editar descripción", anclada a la fila: nombre y descripción del tablero. */
function EditarDescripcion({ tablero, alCerrar }: { tablero: TableroResumen; alCerrar: () => void }) {
  const [nombre, setNombre] = useState(tablero.nombre)
  const [texto, setTexto] = useState(tablero.descripcion)
  const guardar = () => {
    const cambios: { nombre?: string; descripcion?: string } = {}
    if (nombre.trim() && nombre.trim() !== tablero.nombre) cambios.nombre = nombre.trim()
    if (texto !== tablero.descripcion) cambios.descripcion = texto
    if (Object.keys(cambios).length) void useTienda.getState().actualizarTablero(tablero.id, cambios)
    alCerrar()
  }
  return (
    <Desplegable
      abierto
      alCambiar={(v) => !v && alCerrar()}
      lado="right-start"
      ancho={300}
      className="ventanita"
      disparador={(p) => <span {...(p as object)} className="tablero-item__ancla" />}
    >
      {() => (
        <form
          className="ventanita__form"
          onSubmit={(e) => {
            e.preventDefault()
            guardar()
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <label className="campo-etiquetado">
            <span>Nombre</span>
            <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
          </label>
          <label className="campo-etiquetado">
            <span>Descripción</span>
            <textarea className="campo campo--area" rows={3} value={texto} maxLength={280} onChange={(e) => setTexto(e.target.value)} placeholder="Para qué es este tablero" />
          </label>
          <div className="ventanita__pie">
            <button type="button" className="boton boton--chico" onClick={alCerrar}>
              Cancelar
            </button>
            <button type="submit" className="boton boton--chico boton--primario">
              Guardar
            </button>
          </div>
        </form>
      )}
    </Desplegable>
  )
}

/** La ventanita «Archivo de Hecho», anclada a la fila: a los cuántos días Telar archiva solas las tarjetas de Hecho de este tablero. */
function VentanitaArchivoHecho({ tablero, alCerrar }: { tablero: TableroResumen; alCerrar: () => void }) {
  return (
    <Desplegable
      abierto
      alCambiar={(v) => !v && alCerrar()}
      lado="right-start"
      ancho={320}
      className="ventanita"
      disparador={(p) => <span {...(p as object)} className="tablero-item__ancla" />}
    >
      {() => (
        <div className="ventanita__form" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
          <ArchivoHecho tablero={tablero} />
          <div className="ventanita__pie">
            <button type="button" className="boton boton--chico boton--primario" onClick={alCerrar}>
              Listo
            </button>
          </div>
        </div>
      )}
    </Desplegable>
  )
}
