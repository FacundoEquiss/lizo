// Configuración → IA → «Gasto» (plan 12.1, 14.7): lo que gastó la IA este mes contra el tope de la cuenta, por agente y, si se quiere,
// trabajo por trabajo («Ver el detalle»). Y el tope de toda la IA (de fábrica USD 25): al 80 % Telar avisa, al 100 % frena sin
// perder nada. El número de cada trabajo es el que anota el servidor al cobrar (si un pedido se cortó, una estimación: se marca).
//   Estados: cargando, error con «Reintentar», un mes sin gasto y el detalle vacío. Se puede mirar el mes anterior.
import { ChevronLeft, ChevronRight, CloudOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { UsoIA } from '../../../../../compartido/ia'
import { avisar, avisarError } from '../../../estado/avisos'
import { Girando } from '../../../ui/comunes'
import { EstadoVacio } from '../../../ui/EstadoVacio'
import { fechaCorta } from '../../../util/fechas'
import { apiIA } from '../../ia/api-ia'
import { Fila, Grupo } from '../piezas'
import { aNumero } from './borrador'
import { BarraGasto, Campo, dolares, useConfigIA } from './piezas'

/** «2026-11» → «noviembre de 2026». */
const nombreDeMes = (mes: string) => {
  const t = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const mesDesplazado = (mes: string, d: number) => {
  const f = new Date(`${mes}-15T12:00:00Z`)
  f.setUTCMonth(f.getUTCMonth() + d)
  return f.toISOString().slice(0, 7)
}

export function GrupoGasto() {
  const { ia, puede, recargar } = useConfigIA()
  const [mes, setMes] = useState<string | undefined>(undefined)
  const [uso, setUso] = useState<UsoIA | null>(null)
  const [fallo, setFallo] = useState(false)
  const [detalle, setDetalle] = useState(false)
  const [tope, setTope] = useState(String(ia.ajustes.topeMesUsd))
  const [guardando, setGuardando] = useState(false)
  const [errorTope, setErrorTope] = useState('')

  const cargar = useCallback(() => {
    setFallo(false)
    setUso(null)
    apiIA.uso(mes).then(setUso, () => setFallo(true))
  }, [mes])
  useEffect(cargar, [cargar])

  const actual = uso?.mes ?? mes
  const esteMes = new Date().toISOString().slice(0, 7)
  const valor = aNumero(tope)
  const cambio = Number.isFinite(valor) && valor !== ia.ajustes.topeMesUsd

  async function guardarTope() {
    if (!(valor >= 0.01 && valor <= 100000)) return setErrorTope('El tope va de USD 0,01 a USD 100.000.')
    setErrorTope('')
    setGuardando(true)
    try {
      await apiIA.guardarAjustes({ topeMesUsd: valor })
      avisar({ texto: `Tope de toda la IA: ${dolares(valor)} por mes.`, tipo: 'ok', duracion: 2200 })
      await recargar()
      cargar()
    } catch (x) {
      avisarError(x)
      setTope(String(ia.ajustes.topeMesUsd))
    }
    setGuardando(false)
  }

  return (
    <Grupo titulo="Gasto" bajada="Lo que gastó la IA de tu cuenta. Es lo que cobra cada proveedor por los pedidos de tus agentes; Telar no cobra nada.">
      <div className="ia-mes">
        <button type="button" className="boton-icono" onClick={() => actual && setMes(mesDesplazado(actual, -1))} aria-label="Mes anterior" disabled={!actual}>
          <ChevronLeft size={16} />
        </button>
        <b>{actual ? nombreDeMes(actual) : '…'}</b>
        <button type="button" className="boton-icono" onClick={() => actual && setMes(mesDesplazado(actual, 1))} aria-label="Mes siguiente" disabled={!actual || actual >= esteMes}>
          <ChevronRight size={16} />
        </button>
      </div>

      {fallo ? (
        <EstadoVacio
          chico
          icono={CloudOff}
          titulo="No pude traer el gasto"
          ayuda="Revisá la conexión y probá de nuevo."
          accion={
            <button type="button" className="boton boton--chico" onClick={cargar}>
              Reintentar
            </button>
          }
        />
      ) : !uso ? (
        <p className="notif-config__cargando" role="status" aria-busy="true">
          <Girando tam={14} /> Cargando el gasto…
        </p>
      ) : (
        <>
          <BarraGasto gasto={uso.gastoMesUsd} tope={uso.topeMesUsd} etiqueta="Gasto de toda la IA" />
          {uso.agentes.length === 0 ? (
            <p className="ia-vacio-chico">Este mes la IA no gastó nada.</p>
          ) : (
            <ul className="ia-uso">
              {uso.agentes.map((a) => {
                const agente = ia.agentes.find((x) => x.miembroId === a.agenteId)
                return (
                  <li key={a.agenteId}>
                    <span className="ia-uso__nombre">
                      <b>{a.agenteNombre}</b>
                      <small>
                        {a.llamadas} {a.llamadas === 1 ? 'pedido' : 'pedidos'} al modelo
                      </small>
                    </span>
                    {agente && uso.mes === esteMes ? <BarraGasto gasto={a.costoUsd} tope={agente.topeMesUsd} etiqueta={`Gasto de ${a.agenteNombre}`} /> : <span className="ia-gasto__texto">{dolares(a.costoUsd)}</span>}
                  </li>
                )
              })}
            </ul>
          )}
          <button type="button" className="boton boton--chico boton--fantasma ia-detalle-boton" aria-expanded={detalle} onClick={() => setDetalle(!detalle)}>
            {detalle ? 'Ocultar el detalle' : 'Ver el detalle'}
          </button>
          {detalle &&
            (uso.trabajos.length === 0 ? (
              <p className="ia-vacio-chico">No hubo pedidos este mes.</p>
            ) : (
              <ul className="ia-detalle" aria-label="Pedidos del mes">
                {uso.trabajos.map((t) => (
                  <li key={t.trabajoId}>
                    <span>
                      <b>{t.donde ?? 'Sin tarjeta'}</b> · {t.agenteNombre}
                      <small>
                        {t.pedidoPor} · {fechaCorta(t.creadoEn, true)} · {t.pasos} {t.pasos === 1 ? 'paso' : 'pasos'}
                      </small>
                    </span>
                    <span className="ia-detalle__costo">
                      {t.estimado ? '≈ ' : ''}
                      {dolares(t.costoUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            ))}
        </>
      )}

      <Fila nombre="Tope de toda la IA" descripcion="Entre todos los agentes. Al 80 % te aviso; al 100 % frena sin perder nada (lo pendiente queda guardado)." apilada>
        <form
          className="ia-tope"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault()
            if (puede && cambio && !guardando) void guardarTope()
          }}
        >
          <Campo etiqueta="Tope por mes (USD)" error={errorTope}>
            {(p) => <input {...p} className="campo ia-numero" inputMode="decimal" value={tope} disabled={!puede} onChange={(ev) => setTope(ev.target.value)} />}
          </Campo>
          <button type="submit" className="boton boton--chico" disabled={!puede || !cambio || guardando}>
            {guardando ? <Girando tam={13} /> : null} Guardar
          </button>
        </form>
      </Fila>
    </Grupo>
  )
}
