// La campana de las notificaciones y su bandeja (plan de la IA integrada, 8.4 y 14.5).
//   · PC: un botón de campana en la barra, a la izquierda de «Actividad», con el número de no leídas (hasta «9+»). Abre un
//     Desplegable de 360 px: arriba «Notificaciones» y «Marcar todo como leído», la lista agrupada en «Hoy» y «Antes», y
//     abajo «Preferencias». El Desplegable ya atrapa el foco mientras está abierto y lo devuelve al cerrar.
//   · Celular: la misma lista (`ListaNotificaciones`) dentro de una hoja (movil/ia/HojaNotificaciones).
//   · Estados: cargando (en el lugar de la lista), error (con «Reintentar»), vacía («Nada nuevo»), con no leídas, y «Ver más»
//     de a 30 con su propio cargando y su error. Si el servidor no tiene las rutas de la IA, la campana ni aparece.
//   · Nada se sondea: el número y la lista siguen a los eventos en vivo (estado/ia.ts).
import { Bell, BellRing, CheckCheck, CloudOff, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Notificacion, TrabajoResumen } from '../../../compartido/ia'
import { abrirNotificacion, useIA } from '../estado/ia'
import { useTienda } from '../estado/tienda'
import { Girando } from '../ui/comunes'
import { Desplegable } from '../ui/Desplegable'
import { EstadoVacio } from '../ui/EstadoVacio'
import { FilaNotificacion } from './ia/FilaNotificacion'

/** El número de la campana: hasta 9, y «9+» después. */
export const numeroDeCampana = (n: number) => (n > 9 ? '9+' : String(n))

/** El nombre de la campana para el lector de pantalla: «Notificaciones, 3 sin leer». */
export const nombreDeCampana = (sinLeer: number) => (sinLeer > 0 ? `Notificaciones, ${sinLeer} sin leer` : 'Notificaciones')

/**
 * Avisa por voz (región en vivo, cortés) cuando llega una notificación nueva con la app abierta; no anuncia las que ya
 * estaban al cargar ni cada vez que cambia el número.
 */
export function AnuncioDeNotificacion() {
  const ultima = useIA((s) => s.notificaciones[0])
  const cargadas = useIA((s) => s.cargadas)
  const anterior = useRef<string | null | undefined>(undefined)
  const [texto, setTexto] = useState('')
  useEffect(() => {
    if (!cargadas) return
    if (anterior.current !== undefined && ultima && ultima.id !== anterior.current && !ultima.leidaEn) setTexto(`Notificación nueva: ${ultima.titulo}`)
    anterior.current = ultima?.id ?? null
  }, [ultima?.id, cargadas])
  return (
    <span className="solo-lectores" role="status" aria-live="polite">
      {texto}
    </span>
  )
}

/** Lo que se lee en voz alta cuando cambia el estado de un trabajo (14.9): una frase por cambio, no por paso. */
function anuncioDeTrabajo(t: TrabajoResumen): string | null {
  switch (t.estado) {
    case 'en_cola':
      return `${t.agenteNombre} está pensando`
    case 'esperando_confirmacion':
      return `${t.agenteNombre} necesita tu permiso`
    case 'pausado_tope':
      return `${t.agenteNombre} se pausó`
    case 'hecho':
      return `${t.agenteNombre} respondió`
    case 'fallado':
      return `${t.agenteNombre} no pudo terminar`
    default:
      return null
  }
}

/**
 * Región en vivo (cortés) del avance de los agentes (plan 14.9): «Claude está pensando», «Claude necesita tu permiso», «Claude
 * respondió». Anuncia cuando un trabajo cambia de estado, no cada paso, y no lo que ya estaba al abrir.
 */
export function AnuncioDeTrabajo() {
  const trabajos = useIA((s) => s.trabajos)
  const cargadas = useIA((s) => s.cargadas)
  const vistos = useRef<Record<string, string> | null>(null)
  const [texto, setTexto] = useState('')
  useEffect(() => {
    if (!cargadas) return
    const antes = vistos.current
    if (antes)
      for (const t of Object.values(trabajos)) {
        const dicho = anuncioDeTrabajo(t)
        if (dicho && antes[t.id] !== t.estado) setTexto(dicho)
      }
    vistos.current = Object.fromEntries(Object.values(trabajos).map((t) => [t.id, t.estado]))
  }, [trabajos, cargadas])
  return (
    <span className="solo-lectores" role="status" aria-live="polite">
      {texto}
    </span>
  )
}

/** El círculo con el número, sobre la campana. */
export function NumeroDeCampana({ sinLeer }: { sinLeer: number }) {
  if (sinLeer <= 0) return null
  return (
    <span className="campana__numero" aria-hidden>
      {numeroDeCampana(sinLeer)}
    </span>
  )
}

/** La campana de la barra de escritorio, con su bandeja. No se dibuja si el servidor no tiene las rutas de la IA. */
export function Campana() {
  const estado = useIA((s) => s.estado)
  const sinLeer = useIA((s) => s.sinLeer)
  if (estado === 'no_disponible') return null
  return (
    <>
      <AnuncioDeNotificacion />
      <AnuncioDeTrabajo />
      <Desplegable
        lado="bottom-end"
        ancho={360}
        className="bandeja"
        separacion={8}
        disparador={(props) => (
          <button
            {...props}
            type="button"
            className={`boton-icono campana${props['data-abierto'] ? ' boton-icono--activo' : ''}${sinLeer > 0 ? ' campana--con-numero' : ''}`}
            data-tip={props['data-abierto'] ? undefined : 'Notificaciones'}
            aria-label={nombreDeCampana(sinLeer)}
            aria-haspopup="dialog"
            aria-expanded={!!props['data-abierto']}
          >
            {sinLeer > 0 ? <BellRing size={17} /> : <Bell size={17} />}
            <NumeroDeCampana sinLeer={sinLeer} />
          </button>
        )}
      >
        {(cerrar) => <Bandeja cerrar={cerrar} />}
      </Desplegable>
    </>
  )
}

/** «Marcar todo como leído» (con su porqué cuando no hay nada que marcar). */
export function BotonMarcarTodo({ className = 'boton boton--fantasma boton--chico' }: { className?: string }) {
  const sinLeer = useIA((s) => s.sinLeer)
  return (
    <button type="button" className={className} disabled={sinLeer === 0} title={sinLeer === 0 ? 'No hay nada sin leer' : undefined} onClick={() => void useIA.getState().marcarLeidas()}>
      <CheckCheck size={14} /> Marcar todo como leído
    </button>
  )
}

/** «Preferencias»: abre Configuración → Notificaciones (en el celular, que no tiene Configuración, `alTocar` abre su hoja). */
export function BotonPreferencias({ className = 'boton boton--fantasma boton--chico', antes, alTocar }: { className?: string; antes?: () => void; alTocar?: () => void }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        antes?.()
        if (alTocar) alTocar()
        else useTienda.getState().abrirConfiguracion('notificaciones')
      }}
    >
      <Settings2 size={14} /> Preferencias
    </button>
  )
}

/** La bandeja flotante de escritorio. */
function Bandeja({ cerrar }: { cerrar: () => void }) {
  return (
    <div className="bandeja__marco">
      <header className="bandeja__cabecera">
        <h2>Notificaciones</h2>
        <BotonMarcarTodo />
      </header>
      <ListaNotificaciones alAbrir={(n) => (cerrar(), abrirNotificacion(n))} />
      <footer className="bandeja__pie">
        <BotonPreferencias antes={cerrar} />
      </footer>
    </div>
  )
}

const esDeHoy = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

/** La lista con todos sus estados: cargando, error, vacía, con notificaciones («Hoy» y «Antes») y «Ver más». */
export function ListaNotificaciones({ alAbrir }: { alAbrir: (n: Notificacion) => void }) {
  const estado = useIA((s) => s.estado)
  const cargadas = useIA((s) => s.cargadas)
  const notificaciones = useIA((s) => s.notificaciones)
  const hayMas = useIA((s) => s.hayMas)
  const cargandoMas = useIA((s) => s.cargandoMas)
  const errorMas = useIA((s) => s.errorMas)

  if (!cargadas && (estado === 'cargando' || estado === 'sin_pedir'))
    return (
      <div className="bandeja__lista" aria-busy="true">
        <p className="bandeja__cargando" role="status">
          <Girando tam={14} /> Cargando…
        </p>
      </div>
    )
  if (!cargadas && estado === 'error')
    return (
      <div className="bandeja__lista">
        <EstadoVacio
          icono={CloudOff}
          titulo="No pude traer las notificaciones"
          ayuda="Revisá la conexión y probá de nuevo."
          accion={
            <button type="button" className="boton boton--chico" onClick={() => void useIA.getState().cargarNovedades()}>
              Reintentar
            </button>
          }
        />
      </div>
    )
  if (notificaciones.length === 0)
    return (
      <div className="bandeja__lista">
        <EstadoVacio icono={Bell} titulo="Nada nuevo" ayuda="Cuando alguien te mencione o una IA te responda, aparece acá." />
      </div>
    )

  const hoy = notificaciones.filter((n) => esDeHoy(n.creadoEn))
  const antes = notificaciones.filter((n) => !esDeHoy(n.creadoEn))
  const grupo = (titulo: string, lista: Notificacion[]) =>
    lista.length > 0 && (
      <section className="bandeja__grupo" aria-label={titulo}>
        <h3>{titulo}</h3>
        {lista.map((n) => (
          <FilaNotificacion key={n.id} n={n} alAbrir={alAbrir} />
        ))}
      </section>
    )
  return (
    <div className="bandeja__lista">
      {grupo('Hoy', hoy)}
      {grupo('Antes', antes)}
      {hayMas && (
        <div className="bandeja__mas">
          {errorMas && <span className="bandeja__error">No pude traer más.</span>}
          <button type="button" className="boton boton--chico" disabled={cargandoMas} onClick={() => void useIA.getState().cargarMasNotificaciones()}>
            {cargandoMas ? (
              <>
                <Girando tam={13} /> Cargando…
              </>
            ) : errorMas ? (
              'Reintentar'
            ) : (
              'Ver más'
            )}
          </button>
        </div>
      )}
    </div>
  )
}
