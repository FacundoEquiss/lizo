// La entrada de un trabajo de un agente en el hilo de la tarjeta (plan 14.4): en el lugar donde va a quedar su respuesta, con su
// avatar violeta, dice qué está pasando mientras no hay comentario todavía. Cuando termina bien, desaparece y queda el comentario de
// verdad (con su `PieTrabajo`). Los estados, con las palabras de 14.6:
//   · en cola o en curso: «Claude está pensando…» (o lo que hace: «Leyendo RC-98…») con un pulso y «Frenar»; lo que ya hizo, abajo;
//   · esperando permiso: la lista de acciones con «Permitir · No · Elegir» (`ConfirmarAcciones`);
//   · pausado: por qué («llegó a su tope de USD 10 de noviembre. No se perdió nada.») y qué hacer: subir el tope y seguir, reanudar,
//     o «Seguir igual» / «Dejarlo acá» si fue el tope de este pedido;
//   · fallado: «No pude terminar: {motivo}.» y «Reintentar»; cancelado: «Cancelado.» (se va sola a los pocos segundos).
// El pulso es de opacidad y se apaga con «reducir movimiento» (el texto queda). Nada de esto se mueve si no cambió algo.
import { Pause, RotateCcw, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import type { TrabajoResumen } from '../../../../compartido/ia'
import { apiIA } from './api-ia'
import { avisar, avisarError } from '../../estado/avisos'
import { abrirConfiguracionIA, useIA } from '../../estado/ia'
import { useTienda } from '../../estado/tienda'
import { Avatar, Girando } from '../../ui/comunes'
import { hace } from '../../util/fechas'
import '../../estilos/ia-trabajo.css'
import { ConfirmarAcciones } from './ConfirmarAcciones'
import { ponerEstadoIA, useEstadoIA } from './estado-ia'
import { costoLegible, enMinuscula, haciendo, miembroDeAgente, sinPunto, textoDePausa, usd } from './trabajo'

export function EntradaTrabajo({ trabajo: t }: { trabajo: TrabajoResumen }) {
  const miembros = useTienda((s) => s.miembros)
  const miembro = miembroDeAgente(t, miembros) ?? { id: t.agenteId, nombre: t.agenteNombre, tipo: 'ia' as const, color: 'violeta' as const, iniciales: '', esYo: false }
  const costo = costoLegible(t.costoUsd)
  return (
    <li className="comentario comentario--ia entrada-trabajo" data-trabajo={t.id} data-estado={t.estado}>
      <Avatar miembro={miembro} tam={30} />
      <div className="comentario__cuerpo">
        <div className="comentario__cabecera">
          <b>{t.agenteNombre}</b>
          <span className="marca-ia">
            <Sparkles size={10} /> IA
          </span>
          <span className="comentario__cuando">{hace(t.creadoEn)}</span>
        </div>
        <div className="entrada-trabajo__cuerpo">
          <Cuerpo t={t} />
          {t.hizo.length > 0 && (
            <p className="entrada-trabajo__hizo">
              Ya hizo: {t.hizo.join(' · ')}
            </p>
          )}
          {costo && <p className="entrada-trabajo__costo">{costo}</p>}
        </div>
      </div>
    </li>
  )
}

function Cuerpo({ t }: { t: TrabajoResumen }) {
  switch (t.estado) {
    case 'en_cola':
    case 'en_curso':
      return <EnCurso t={t} />
    case 'esperando_confirmacion':
      return <ConfirmarAcciones trabajo={t} />
    case 'pausado_tope':
      return <Pausado t={t} />
    case 'fallado':
      return <Fallado t={t} />
    case 'cancelado':
      return <p className="entrada-trabajo__linea">Cancelado.</p>
    default:
      return <p className="entrada-trabajo__linea">{t.agenteNombre} terminó.</p>
  }
}

function EnCurso({ t }: { t: TrabajoResumen }) {
  // Frenar un trabajo en curso es un pedido: el ciclo lo ve entre pasos. El botón queda en «Frenando…» hasta que el trabajo cambie.
  const [frenando, setFrenando] = useState(false)
  return (
    <div className="entrada-trabajo__linea entrada-trabajo__linea--curso">
      <span className="entrada-trabajo__pulso" aria-hidden>
        <Sparkles size={14} />
      </span>
      <span className="entrada-trabajo__texto">{haciendo(t)}</span>
      <button
        type="button"
        className="boton boton--fantasma boton--chico entrada-trabajo__frenar"
        disabled={frenando}
        aria-label={`Frenar el pedido de ${t.agenteNombre}`}
        onClick={async () => {
          setFrenando(true)
          if (!(await useIA.getState().cancelar(t.id))) setFrenando(false)
        }}
      >
        {frenando ? <Girando tam={12} /> : <X size={13} aria-hidden />} {frenando ? 'Frenando…' : 'Frenar'}
      </button>
    </div>
  )
}

function Fallado({ t }: { t: TrabajoResumen }) {
  const otra = useAccion()
  return (
    <>
      <p className="entrada-trabajo__linea entrada-trabajo__linea--error" role="status">
        No pude terminar: {enMinuscula(sinPunto(t.motivo ?? 'algo salió mal'))}.
      </p>
      <div className="entrada-trabajo__botones">
        <button type="button" className="boton boton--chico" disabled={otra.ocupado} onClick={() => otra.hacer(() => useIA.getState().reanudar(t.id))}>
          {otra.ocupado ? <Girando tam={12} /> : <RotateCcw size={13} aria-hidden />} Reintentar
        </button>
        {/Configuración → IA/.test(t.motivo ?? '') && (
          <button type="button" className="boton boton--fantasma boton--chico" onClick={abrirConfiguracionIA}>
            Configuración → IA
          </button>
        )}
      </div>
    </>
  )
}

function Pausado({ t }: { t: TrabajoResumen }) {
  // Los topes que nombra el texto: se piden la primera vez (el texto sale sin el número mientras tanto).
  const estado = useEstadoIA()
  const { texto, tipo } = textoDePausa(t, estado)
  const otra = useAccion()
  const [subiendo, setSubiendo] = useState(false)
  const reanudar = () => otra.hacer(() => useIA.getState().reanudar(t.id))
  return (
    <>
      <p className="entrada-trabajo__linea entrada-trabajo__linea--pausa" role="status">
        <Pause size={14} aria-hidden /> <span>{texto}</span>
      </p>
      {subiendo ? (
        <SubirTope t={t} tipo={tipo === 'cuenta' ? 'cuenta' : 'agente'} alTerminar={() => setSubiendo(false)} />
      ) : (
        <div className="entrada-trabajo__botones">
          {(tipo === 'agente' || tipo === 'cuenta') && (
            <button type="button" className="boton boton--primario boton--chico" disabled={otra.ocupado} onClick={() => setSubiendo(true)}>
              Subir el tope
            </button>
          )}
          {tipo === 'pausa' && (
            <button
              type="button"
              className="boton boton--primario boton--chico"
              disabled={otra.ocupado}
              onClick={() =>
                otra.hacer(async () => {
                  await apiIA.guardarAjustes({ pausada: false })
                  ponerEstadoIA((ia) => ({ ...ia, ajustes: { ...ia.ajustes, pausada: false } }))
                  await useIA.getState().reanudar(t.id)
                })
              }
            >
              Prender la IA y seguir
            </button>
          )}
          {tipo === 'trabajo' ? (
            <>
              <button type="button" className="boton boton--primario boton--chico" disabled={otra.ocupado} onClick={reanudar}>
                Seguir igual
              </button>
              <button type="button" className="boton boton--chico" disabled={otra.ocupado} onClick={() => otra.hacer(() => useIA.getState().cancelar(t.id))}>
                Dejarlo acá
              </button>
            </>
          ) : (
            tipo !== 'pausa' && (
              <button type="button" className="boton boton--chico" disabled={otra.ocupado} onClick={reanudar}>
                {otra.ocupado ? <Girando tam={12} /> : null} Reanudar
              </button>
            )
          )}
          {tipo === 'pausa' && (
            <button type="button" className="boton boton--fantasma boton--chico" onClick={abrirConfiguracionIA}>
              Configuración → IA
            </button>
          )}
        </div>
      )}
    </>
  )
}

/** Subir el tope del agente (o el de toda la cuenta) desde donde se frenó, y seguir: sin ir a buscar la pantalla de ajustes. */
function SubirTope({ t, tipo, alTerminar }: { t: TrabajoResumen; tipo: 'agente' | 'cuenta'; alTerminar: () => void }) {
  const estado = useEstadoIA()
  const actual = tipo === 'cuenta' ? estado?.ajustes.topeMesUsd : estado?.agentes.find((a) => a.miembroId === t.agenteId)?.topeMesUsd
  const [valor, setValor] = useState('')
  const otra = useAccion()
  const numero = Number(valor.replace(',', '.'))
  const sugerido = actual ? String(Math.ceil(actual * 2)) : ''
  const valido = Number.isFinite(numero) && numero > (actual ?? 0)
  const subir = () =>
    otra.hacer(async () => {
      if (tipo === 'cuenta') {
        const ajustes = await apiIA.guardarAjustes({ topeMesUsd: numero })
        ponerEstadoIA((ia) => ({ ...ia, ajustes: { ...ia.ajustes, ...ajustes } }))
      } else {
        const agente = await apiIA.guardarAgente({ miembroId: t.agenteId, topeMesUsd: numero })
        ponerEstadoIA((ia) => ({ ...ia, agentes: ia.agentes.map((a) => (a.miembroId === agente.miembroId ? agente : a)) }))
      }
      avisar({ texto: `Tope subido a ${usd(numero)}. ${t.agenteNombre} sigue.`, tipo: 'ok' })
      await useIA.getState().reanudar(t.id)
      alTerminar()
    })
  return (
    <form
      className="entrada-trabajo__tope"
      onSubmit={(e) => {
        e.preventDefault()
        if (valido) subir()
      }}
    >
      <label>
        <span>{tipo === 'cuenta' ? 'Nuevo tope de toda la IA' : `Nuevo tope de ${t.agenteNombre}`} (USD por mes)</span>
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          value={valor}
          placeholder={sugerido}
          aria-describedby={`tope-ayuda-${t.id}`}
          onChange={(e) => setValor(e.target.value)}
        />
      </label>
      <small id={`tope-ayuda-${t.id}`}>{actual ? `Ahora es ${usd(actual)}. Tiene que ser más.` : 'Cargando el tope de ahora…'}</small>
      <div className="entrada-trabajo__botones">
        <button type="submit" className="boton boton--primario boton--chico" disabled={!valido || otra.ocupado}>
          {otra.ocupado ? <Girando tam={12} /> : null} Subir y seguir
        </button>
        <button type="button" className="boton boton--fantasma boton--chico" disabled={otra.ocupado} onClick={alTerminar}>
          Volver
        </button>
      </div>
    </form>
  )
}

/** Una acción de un botón: mientras corre queda apagado; si falla, avisa con las palabras del servidor y se puede repetir. */
function useAccion() {
  const [ocupado, setOcupado] = useState(false)
  return {
    ocupado,
    async hacer(fn: () => Promise<unknown>) {
      setOcupado(true)
      try {
        await fn()
      } catch (e) {
        avisarError(e)
      } finally {
        setOcupado(false)
      }
    },
  }
}
