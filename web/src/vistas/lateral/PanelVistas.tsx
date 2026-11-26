// El panel «Vistas» de un tablero (menú ⋯ de la barra lateral y opciones del tablero en el celular): tres interruptores, uno por
// vista (Kanban, Lienzo, Diseño), para sumar o sacar lo que el tablero necesita. Siempre queda al menos una.
// Sacar una vista NO borra nada: las tarjetas, los objetos del lienzo y la hoja de diseño quedan guardados y vuelven al sumarla otra
// vez. Si la vista tiene contenido, antes de sacarla se pregunta (en el mismo panel, sin otro diálogo encima) y se dice cuánto hay.
// Diseño es del proyecto: sacarla de un tablero no toca el sistema de diseño ni a los otros tableros que lo tengan.
// Escritorio: un diálogo. Celular: una hoja desde abajo (como «Archivo de Hecho»).
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ResumenDiseno } from '../../../../compartido/diseno/tipos'
import { frasePorVistas, NOMBRE_VISTA, ordenarVistas, tieneVista, VISTAS, type VistaTablero } from '../../../../compartido/vistas'
import { api, pedir } from '../../estado/api'
import { useTienda } from '../../estado/tienda'
import { esTactil } from '../../movil/detectar'
import { HojaInferior } from '../../movil/ui/HojaInferior'
import { Girando } from '../../ui/comunes'
import { Dialogo } from '../../ui/Dialogo'
import { ICONO_VISTA } from '../../ui/TipoTablero'

const DETALLE: Record<VistaTablero, string> = {
  kanban: 'Listas y tarjetas con su porqué.',
  lienzo: 'Lienzo infinito: diagramas, notas, tablas y conectores.',
  diseno: 'La hoja de diseño del proyecto: manual de marca, sistema, marcos.',
}

type Cantidades = Partial<Record<VistaTablero, number>>

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Lo que se pierde de vista (no de la base) al sacar una vista, dicho en cristiano. */
function frase(v: VistaTablero, n: number): string {
  if (v === 'kanban') return `Este tablero tiene ${plural(n, 'tarjeta abierta', 'tarjetas abiertas')} y sus listas. No se borra nada: quedan guardadas y vuelven si sumás el Kanban otra vez.`
  if (v === 'lienzo') return `El lienzo tiene ${plural(n, 'objeto', 'objetos')}. No se borra nada: quedan guardados y vuelven si sumás el lienzo otra vez.`
  return `El Diseño del proyecto tiene ${plural(n, 'marco', 'marcos')}. No se borra nada, y los otros tableros del proyecto que tengan Diseño lo siguen viendo.`
}

/** El contenido del panel: los tres interruptores y la pregunta al sacar una vista que tiene cosas. */
export function ContenidoVistas({ tableroId, hoja }: { tableroId: string; hoja?: boolean }) {
  const proyecto = useTienda((s) => s.proyectos.find((p) => p.tableros.some((t) => t.id === tableroId)))
  const tablero = proyecto?.tableros.find((t) => t.id === tableroId)
  const [cantidades, setCantidades] = useState<Cantidades | null>(null)
  const [pendiente, setPendiente] = useState<VistaTablero | null>(null)
  const prefijo = proyecto?.prefijo
  const conDiseno = tablero ? tieneVista(tablero, 'diseno') : false

  // Cuánto hay en cada vista (para saber si hay que preguntar). Un tablero que no tiene una vista no tiene nada que contar de ella.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const c = await api.tablero(tableroId)
        const r: Cantidades = { kanban: c.tarjetas.filter((t) => !t.archivada).length, lienzo: c.elementos.length }
        if (conDiseno && prefijo) {
          const d = await pedir<ResumenDiseno>('GET', `/api/diseno/${encodeURIComponent(prefijo)}`).catch(() => null)
          r.diseno = d ? d.paginas.reduce((n, p) => n + p.marcos, 0) : 0
        }
        if (vivo) setCantidades(r)
      } catch {
        if (vivo) setCantidades({})
      }
    })()
    return () => {
      vivo = false
    }
  }, [tableroId, prefijo, conDiseno])

  if (!tablero) return null
  const vistas = tablero.vistas ?? [...VISTAS]
  const aplicar = (siguiente: VistaTablero[]) => {
    setPendiente(null)
    void useTienda.getState().actualizarTablero(tableroId, { vistas: ordenarVistas(siguiente) })
  }
  const alternar = (v: VistaTablero) => {
    const tiene = vistas.includes(v)
    if (!tiene) return aplicar([...vistas, v])
    if (vistas.length <= 1) return
    const n = cantidades?.[v] ?? 0
    if (n > 0) return setPendiente(v)
    aplicar(vistas.filter((x) => x !== v))
  }
  return (
    <div className={`vistas-panel${hoja ? ' vistas-panel--hoja' : ''}`}>
      {VISTAS.map((v) => {
        const Icono = ICONO_VISTA[v]
        const si = vistas.includes(v)
        const ultima = si && vistas.length <= 1
        return (
          <button
            key={v}
            type="button"
            role="switch"
            aria-checked={si}
            aria-describedby={`vista-${tableroId}-${v}`}
            disabled={ultima}
            className={`vistas-panel__fila${si ? ' vistas-panel__fila--si' : ''}`}
            title={ultima ? 'Un tablero necesita al menos una vista' : undefined}
            onClick={() => alternar(v)}
          >
            <span className="vistas-panel__icono">
              <Icono size={17} aria-hidden />
            </span>
            <span className="vistas-panel__textos">
              <span className="vistas-panel__nombre">{NOMBRE_VISTA[v]}</span>
              <span className="vistas-panel__detalle" id={`vista-${tableroId}-${v}`}>
                {ultima ? 'Es la única que tiene: un tablero necesita al menos una vista.' : DETALLE[v]}
              </span>
            </span>
            <span className={`interruptor${si ? ' interruptor--si' : ''}`} aria-hidden>
              <span className="interruptor__perilla" />
            </span>
          </button>
        )
      })}
      {pendiente && (
        <div className="vistas-panel__confirmar" role="alertdialog" aria-label={`Sacar ${NOMBRE_VISTA[pendiente]}`}>
          <p>{frase(pendiente, cantidades?.[pendiente] ?? 0)}</p>
          <div className="vistas-panel__botones">
            <button type="button" className="boton" onClick={() => setPendiente(null)}>
              Cancelar
            </button>
            <button type="button" className="boton boton--primario" autoFocus onClick={() => aplicar(vistas.filter((x) => x !== pendiente))}>
              Sacar {pendiente === 'diseno' ? 'Diseño' : pendiente === 'kanban' ? 'el Kanban' : 'el lienzo'}
            </button>
          </div>
        </div>
      )}
      {cantidades === null && (
        <span className="vistas-panel__nota" aria-live="polite">
          <Girando tam={12} /> Mirando lo que tiene cada vista…
        </span>
      )}
      <p className="vistas-panel__nota">
        Ahora tiene: {frasePorVistas(vistas)}. Sacar una vista no borra nada: lo que había queda guardado y vuelve al sumarla.
      </p>
    </div>
  )
}

/**
 * El panel en su propia ventana: un diálogo en la computadora y una hoja desde abajo en el celular. Lee el tablero de la tienda, así
 * se ven los cambios al toque.
 */
export function PanelVistas({ tableroId, abierto, alCerrar }: { tableroId: string; abierto: boolean; alCerrar: () => void }) {
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
      <HojaInferior abierta={abierto} alCerrar={alCerrar} titulo={`Vistas de «${tablero.nombre}»`}>
        <ContenidoVistas tableroId={tableroId} hoja />
      </HojaInferior>
    )
  return (
    <Dialogo abierto={abierto} alCerrar={alCerrar} tituloId={`titulo-vistas-${tableroId}`} className="dialogo--vistas">
      <header className="dialogo__cabecera">
        <div>
          <h2 id={`titulo-vistas-${tableroId}`}>Vistas</h2>
          <p className="dialogo__bajada">En «{tablero.nombre}». Se ve igual en todos tus dispositivos.</p>
        </div>
        <button type="button" className="boton-icono" onClick={alCerrar} aria-label="Cerrar">
          <X size={18} />
        </button>
      </header>
      <ContenidoVistas tableroId={tableroId} />
      <div className="dialogo__pie">
        <button type="button" className="boton boton--primario" onClick={alCerrar}>
          Listo
        </button>
      </div>
    </Dialogo>
  )
}
