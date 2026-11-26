// Lo primero que se ve en Configuración → IA (plan 14.7): cómo está la IA de la cuenta (y «Pausar toda la IA»), los agentes con su
// estado y su gasto, las claves («termina en …1234», probar, cambiar, quitar) y el camino sin gasto por MCP. «Código (GitHub)» y
// «Gasto» son grupos aparte (Codigo.tsx, Gasto.tsx). Lo que cambia algo se aplica al instante (los interruptores) o pasa por un
// formulario (agentes y claves); con la clave del MCP todo se ve pero queda apagado, con «Esto se cambia desde tu cuenta».
import { ChevronRight, KeyRound, Plus, PlugZap, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { ClaveIA } from '../../../../../compartido/ia'
import { avisar, avisarError } from '../../../estado/avisos'
import { useTienda } from '../../../estado/tienda'
import { Avatar, Girando, Interruptor } from '../../../ui/comunes'
import { EstadoVacio } from '../../../ui/EstadoVacio'
import { hace } from '../../../util/fechas'
import { ponerEstadoIA } from '../../ia/estado-ia'
import { apiIA } from '../../ia/api-ia'
import { Fila, Grupo } from '../piezas'
import { BarraGasto, PildoraClave, PildoraEstado, useConfigIA } from './piezas'
import { opcionDe } from './proveedores'

// ───────── Cómo está la IA ─────────

export function GrupoResumen() {
  const { ia, puede } = useConfigIA()
  const { ajustes, agentes, claves } = ia
  const propias = claves.filter((c) => c.proveedor !== 'github' && c.proveedor !== 'disparador')
  const enTope = ajustes.topeMesUsd > 0 && ajustes.gastoMesUsd >= ajustes.topeMesUsd
  const [texto, tono] = ajustes.pausada
    ? (['Pausada: nadie responde hasta que la prendas de nuevo.', 'neutro'] as const)
    : enTope
      ? (['En el tope de este mes: los pedidos esperan, no se pierde nada.', 'aviso'] as const)
      : propias.length === 0
        ? (['Todavía no hay claves: ninguna IA puede trabajar adentro de Telar.', 'aviso'] as const)
        : agentes.some((a) => a.estado === 'listo')
          ? ([`Lista: ${agentes.filter((a) => a.estado === 'listo').length === 1 ? '1 agente puede' : `${agentes.filter((a) => a.estado === 'listo').length} agentes pueden`} responder cuando lo mencionan.`, 'ok'] as const)
          : (['Hay claves, pero ningún agente está listo todavía.', 'aviso'] as const)

  async function pausar(v: boolean) {
    const antes = ajustes
    ponerEstadoIA((x) => ({ ...x, ajustes: { ...x.ajustes, pausada: v } }))
    try {
      const guardados = await apiIA.guardarAjustes({ pausada: v })
      ponerEstadoIA((x) => ({ ...x, ajustes: { ...x.ajustes, ...guardados } }))
    } catch (e) {
      ponerEstadoIA((x) => ({ ...x, ajustes: antes }))
      avisarError(e)
    }
  }

  return (
    <Grupo>
      <div className={`ia-estado ia-estado--${tono}`} role="status">
        <Sparkles size={16} aria-hidden />
        <span>{texto}</span>
      </div>
      <BarraGasto gasto={ajustes.gastoMesUsd} tope={ajustes.topeMesUsd} etiqueta="Gasto de toda la IA este mes" />
      <Fila nombre="Pausar toda la IA" descripcion="Nadie responde hasta que lo prendas de nuevo. Lo pendiente queda guardado.">
        <Interruptor valor={ajustes.pausada} etiqueta="Pausar toda la IA" deshabilitado={!puede} alCambiar={pausar} />
      </Fila>
    </Grupo>
  )
}

// ───────── Agentes ─────────

export function GrupoAgentes() {
  const { ia, puede, ir } = useConfigIA()
  const miembros = useTienda((s) => s.miembros)
  return (
    <Grupo titulo="Agentes" bajada="Una IA con nombre que responde adentro de Telar cuando la mencionás con @ en una tarjeta.">
      {ia.agentes.length === 0 ? (
        <EstadoVacio
          chico
          icono={Sparkles}
          titulo="Todavía no hay agentes"
          ayuda="Con una clave de un proveedor, un agente te contesta en la tarjeta y puede ordenarla, con tope de gasto."
        />
      ) : (
        <ul className="ia-lista">
          {ia.agentes.map((a) => (
            <li key={a.miembroId}>
              <button type="button" className="ia-fila" onClick={() => ir({ tipo: 'agente', id: a.miembroId })}>
                <Avatar miembro={miembros.find((m) => m.id === a.miembroId)} tam={34} />
                <span className="ia-fila__texto">
                  <span className="ia-fila__titulo">
                    <b>{a.nombre}</b>
                    <small>@{a.alias}</small>
                  </span>
                  <span className="ia-fila__detalle">{a.modelo ?? 'Sin modelo elegido'}</span>
                  <BarraGasto gasto={a.gastoMesUsd} tope={a.topeMesUsd} etiqueta={`Gasto de ${a.nombre} este mes`} />
                </span>
                <PildoraEstado estado={a.estado} />
                <ChevronRight size={16} className="ia-fila__flecha" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ia-botones">
        <button type="button" className="boton boton--chico" onClick={() => ir({ tipo: 'agente', id: 'nuevo' })} disabled={!puede}>
          <Plus size={14} aria-hidden /> Agregar agente
        </button>
      </div>
    </Grupo>
  )
}

// ───────── Claves ─────────

export function GrupoClaves() {
  const { ia, puede, ir } = useConfigIA()
  // El token de GitHub y el del agente por disparo tienen su propio lugar: acá van las claves de los modelos.
  const claves = ia.claves.filter((c) => c.proveedor !== 'github' && c.proveedor !== 'disparador')
  return (
    <Grupo titulo="Claves" bajada="La clave de un proveedor es lo que le da permiso a Telar para usar su IA, con tu cuenta y tu saldo.">
      {claves.length === 0 ? (
        <EstadoVacio
          chico
          icono={KeyRound}
          titulo="Cargá una clave para que una IA trabaje adentro de Telar"
          ayuda="La generás en la consola del proveedor y la pegás acá. Se guarda cifrada y no se vuelve a mostrar."
        />
      ) : (
        <ul className="ia-lista">
          {claves.map((c) => (
            <FilaClave key={c.id} clave={c} />
          ))}
        </ul>
      )}
      <div className="ia-botones">
        <button type="button" className="boton boton--chico" onClick={() => ir({ tipo: 'clave', id: 'nueva' })} disabled={!puede}>
          <Plus size={14} aria-hidden /> Agregar clave
        </button>
      </div>
    </Grupo>
  )
}

function FilaClave({ clave: c }: { clave: ClaveIA }) {
  const { ia, puede, recargar, ir } = useConfigIA()
  const [ocupado, setOcupado] = useState<'probar' | 'quitar' | null>(null)
  const [quitando, setQuitando] = useState(false)
  const usan = ia.agentes.filter((a) => c.enUso.includes(a.miembroId))
  const o = opcionDe(c.proveedor, c.urlBase)

  async function probar() {
    setOcupado('probar')
    try {
      const r = await apiIA.probarClave(c.id)
      await recargar()
      avisar(r.estado === 'valida' ? { texto: `${c.nombre} anda.`, tipo: 'ok', duracion: 2000 } : { texto: r.error ?? `${c.nombre} no anda.`, tipo: 'error' })
    } catch (e) {
      avisarError(e)
    }
    setOcupado(null)
  }

  async function quitar() {
    setOcupado('quitar')
    try {
      await apiIA.quitarClave(c.id)
      avisar({ texto: `Clave «${c.nombre}» quitada.`, tipo: 'ok', duracion: 2200 })
      await recargar()
    } catch (e) {
      avisarError(e)
      setOcupado(null)
    }
  }

  return (
    <li className="ia-clave-fila">
      <div className="ia-fila ia-fila--fija">
        <span className="ia-fila__icono" aria-hidden>
          <KeyRound size={16} />
        </span>
        <span className="ia-fila__texto">
          <span className="ia-fila__titulo">
            <b>{c.nombre}</b>
            <small>termina en …{c.ultimos4}</small>
          </span>
          <span className="ia-fila__detalle">
            {o.nombre}
            {c.probadaEn && c.estado === 'valida' ? ` · probada ${hace(c.probadaEn)}` : ''}
            {usan.length > 0 ? ` · la usa ${usan.map((a) => a.nombre).join(', ')}` : ' · sin agentes'}
          </span>
          {c.estado === 'invalida' && (
            <span className="ia-fila__error" role="status">
              {c.error ?? `${o.nombre.split(' ')[0]} la rechazó. Revisá que esté completa y que no esté vencida.`}
            </span>
          )}
        </span>
        <PildoraClave clave={c} />
      </div>
      <div className="ia-botones ia-botones--fila">
        {quitando ? (
          <span className="ia-confirmar-quitar" role="alert">
            {usan.length > 0 ? `${usan.map((a) => a.nombre).join(', ')} se queda${usan.length > 1 ? 'n' : ''} sin clave.` : 'No la usa ningún agente.'}
            <button type="button" className="boton boton--chico boton--peligro" onClick={quitar} disabled={!puede || ocupado === 'quitar'}>
              {ocupado === 'quitar' ? <Girando tam={13} /> : null} Quitar
            </button>
            <button type="button" className="boton boton--chico boton--fantasma" onClick={() => setQuitando(false)}>
              No
            </button>
          </span>
        ) : (
          <>
            <button type="button" className="boton boton--chico" onClick={probar} disabled={!puede || !!ocupado}>
              {ocupado === 'probar' ? <Girando tam={13} /> : null} Probar
            </button>
            <button type="button" className="boton boton--chico" onClick={() => ir({ tipo: 'clave', id: c.id })} disabled={!puede}>
              Cambiar
            </button>
            <button type="button" className="boton boton--chico boton--fantasma boton--peligro" onClick={() => setQuitando(true)} disabled={!puede}>
              Quitar
            </button>
          </>
        )}
      </div>
    </li>
  )
}

// ───────── Agentes de afuera (sin gasto) ─────────

export function GrupoAfuera({ alIrAConectar }: { alIrAConectar: () => void }) {
  const { ia, puede } = useConfigIA()
  async function cambiar(c: { confirmarMcp?: boolean; externasDisparan?: boolean }) {
    const antes = ia.ajustes
    ponerEstadoIA((x) => ({ ...x, ajustes: { ...x.ajustes, ...c } }))
    try {
      const guardados = await apiIA.guardarAjustes(c)
      ponerEstadoIA((x) => ({ ...x, ajustes: { ...x.ajustes, ...guardados } }))
    } catch (e) {
      ponerEstadoIA((x) => ({ ...x, ajustes: antes }))
      avisarError(e)
    }
  }
  return (
    <Grupo titulo="Agentes de afuera (sin gasto)" bajada="Claude Code, ChatGPT o claude.ai pueden leer y ordenar tus tableros con su propio plan, por MCP: sin clave de API y sin gasto para Telar.">
      <Fila nombre="Conectar una IA por MCP" descripcion="Te explica cómo conectar Claude Code, ChatGPT o claude.ai en un par de pasos.">
        <button type="button" className="boton boton--chico" onClick={alIrAConectar}>
          <PlugZap size={14} aria-hidden /> Conectar IA
        </button>
      </Fila>
      <Fila nombre="Pedime confirmación también por MCP" descripcion="Apagado de fábrica. Prendido, una IA de afuera que quiera hacer algo delicado queda esperando que la dejes.">
        <Interruptor valor={ia.ajustes.confirmarMcp} etiqueta="Pedime confirmación también por MCP" deshabilitado={!puede} alCambiar={(v) => cambiar({ confirmarMcp: v })} />
      </Fila>
      <Fila nombre="Las IA de afuera pueden pedirle a mis agentes" descripcion="Apagado de fábrica. Prendido, una IA conectada por MCP puede mencionar a tus agentes y hacerlos trabajar (y gastar de su tope).">
        <Interruptor valor={ia.ajustes.externasDisparan} etiqueta="Las IA de afuera pueden pedirle a mis agentes" deshabilitado={!puede} alCambiar={(v) => cambiar({ externasDisparan: v })} />
      </Fila>
    </Grupo>
  )
}
