// Una mención a un agente de adentro que no pudo responder (plan 14.4 y 14.6): «@claude quedó esperando: no tiene clave.» con
// «Configurar» (lleva a Configuración → IA) y «Reintentar» (crea el trabajo si ya se arregló). El motivo lo escribe el servidor
// con las cosas de hoy; si todavía no se puede, el servidor dice por qué y se avisa. Va en el hilo, en el lugar de la respuesta.
import { Hourglass, RotateCcw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { Mencion } from '../../../../compartido/ia'
import { abrirConfiguracionIA, useIA } from '../../estado/ia'
import { useTienda } from '../../estado/tienda'
import { Avatar, Girando } from '../../ui/comunes'
import { hace } from '../../util/fechas'
import '../../estilos/ia-trabajo.css'
import { enMinuscula, sinPunto } from './trabajo'

export function EsperandoMencion({ mencion: m }: { mencion: Mencion }) {
  const agente = useTienda((s) => s.miembros.find((x) => x.id === m.destinatarioId))
  const [reintentando, setReintentando] = useState(false)
  const alias = agente?.alias ?? agente?.nombre.toLowerCase() ?? 'la IA'
  return (
    <li className="comentario comentario--ia entrada-trabajo entrada-trabajo--espera" data-mencion={m.id}>
      <Avatar miembro={agente} tam={30} />
      <div className="comentario__cuerpo">
        <div className="comentario__cabecera">
          <b>{agente?.nombre ?? 'IA'}</b>
          <span className="marca-ia">
            <Sparkles size={10} /> IA
          </span>
          <span className="comentario__cuando">{hace(m.creadoEn)}</span>
        </div>
        <div className="entrada-trabajo__cuerpo">
          <p className="entrada-trabajo__linea entrada-trabajo__linea--pausa" role="status">
            <Hourglass size={14} aria-hidden />
            <span>
              @{alias} quedó esperando: {enMinuscula(sinPunto(m.motivo ?? 'todavía no puede responder'))}.
            </span>
          </p>
          <div className="entrada-trabajo__botones">
            <button type="button" className="boton boton--chico" onClick={abrirConfiguracionIA}>
              Configurar
            </button>
            <button
              type="button"
              className="boton boton--chico"
              disabled={reintentando}
              onClick={async () => {
                setReintentando(true)
                const bien = await useIA.getState().reintentarMencion(m.id)
                if (!bien) setReintentando(false)
              }}
            >
              {reintentando ? <Girando tam={12} /> : <RotateCcw size={13} aria-hidden />} Reintentar
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}
