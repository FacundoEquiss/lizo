// La opción «Archivar solas las tarjetas de Hecho» de un tablero: a los cuántos días de haber llegado a Hecho Telar archiva una
// tarjeta (Nunca / 7 / 14 / 30 / 60; de fábrica 30). Se guarda en los ajustes del tablero y vale igual en todos los dispositivos.
// El mismo contenido va en la ventanita del menú del tablero (escritorio) y en la hoja del celular.
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { DIAS_ARCHIVO_HECHO, leerDiasArchivoHecho, type DiasArchivoHecho } from '../../../../compartido/hecho'
import type { TableroResumen } from '../../../../compartido/tipos'
import { useTienda } from '../../estado/tienda'
import { esTactil } from '../../movil/detectar'
import { HojaInferior } from '../../movil/ui/HojaInferior'
import { Segmentado } from '../../ui/comunes'
import { Dialogo } from '../../ui/Dialogo'

type Id = 'nunca' | '7' | '14' | '30' | '60'
const OPCIONES: { id: Id; nombre: string }[] = [
  { id: 'nunca', nombre: 'Nunca' },
  ...DIAS_ARCHIVO_HECHO.map((d) => ({ id: String(d) as Id, nombre: String(d) })),
]
const aId = (d: DiasArchivoHecho): Id => (d === null ? 'nunca' : (String(d) as Id))
const aDias = (id: Id): DiasArchivoHecho => (id === 'nunca' ? null : (Number(id) as DiasArchivoHecho))

/** La frase que dice qué hace la opción elegida, en cristiano. */
export function fraseArchivoHecho(dias: DiasArchivoHecho): string {
  return dias === null
    ? 'Las tarjetas de Hecho se quedan hasta que las archives vos.'
    : `Las tarjetas que llevan más de ${dias} días en Hecho se archivan solas. Nada se borra: quedan en Archivadas y se restauran con un toque. No se archivan las que tienen una checklist sin terminar ni las que bloquean a otra tarjeta abierta.`
}

export function ArchivoHecho({ tablero }: { tablero: Pick<TableroResumen, 'id' | 'nombre' | 'ajustes'> }) {
  const dias = leerDiasArchivoHecho(tablero.ajustes)
  return (
    <div className="archivo-hecho">
      <div className="archivo-hecho__titulo" id={`archivo-hecho-${tablero.id}`}>
        Archivar solas las tarjetas de Hecho
      </div>
      <div className="archivo-hecho__control">
        <Segmentado<Id>
          etiqueta="Archivar solas las tarjetas de Hecho, a los días de haber llegado"
          opciones={OPCIONES}
          valor={aId(dias)}
          alCambiar={(id) => void useTienda.getState().actualizarTablero(tablero.id, { ajustes: { archivoHecho: { dias: aDias(id) as 7 | 14 | 30 | 60 | null } } })}
        />
        <span className="archivo-hecho__unidad">{dias === null ? '' : 'días'}</span>
      </div>
      <p className="archivo-hecho__frase" aria-live="polite">
        {fraseArchivoHecho(dias)}
      </p>
    </div>
  )
}

/**
 * La opción en su propio panel: un diálogo en la computadora y una hoja desde abajo en el celular. Se abre desde el menú de una
 * lista de Hecho («⋯») y desde las opciones de un tablero en el celular. Lee el tablero de la tienda, así se ve el cambio al toque.
 */
export function PanelArchivoHecho({ tableroId, abierto, alCerrar }: { tableroId: string; abierto: boolean; alCerrar: () => void }) {
  const tablero = useTienda((s) => s.proyectos.flatMap((p) => p.tableros).find((t) => t.id === tableroId))
  // Esc lo cierra (el atajo global de App.tsx solo conoce los diálogos de la tienda).
  useEffect(() => {
    if (!abierto || esTactil()) return
    const alTecla = (e: KeyboardEvent) => e.key === 'Escape' && alCerrar()
    window.addEventListener('keydown', alTecla)
    return () => window.removeEventListener('keydown', alTecla)
  }, [abierto, alCerrar])
  if (!tablero) return null
  if (esTactil())
    return (
      <HojaInferior abierta={abierto} alCerrar={alCerrar} titulo="Archivo de Hecho">
        <div className="archivo-hecho archivo-hecho--hoja">
          <ArchivoHecho tablero={tablero} />
        </div>
      </HojaInferior>
    )
  return (
    <Dialogo abierto={abierto} alCerrar={alCerrar} tituloId="titulo-archivo-hecho" className="dialogo--archivo-hecho">
      <header className="dialogo__cabecera">
        <div>
          <h2 id="titulo-archivo-hecho">Archivo de Hecho</h2>
          <p className="dialogo__bajada">En «{tablero.nombre}»: se ve igual en todos tus dispositivos.</p>
        </div>
        <button type="button" className="boton-icono" onClick={alCerrar} aria-label="Cerrar">
          <X size={18} />
        </button>
      </header>
      <ArchivoHecho tablero={tablero} />
      <div className="dialogo__pie">
        <button type="button" className="boton boton--primario" onClick={alCerrar}>
          Listo
        </button>
      </div>
    </Dialogo>
  )
}
