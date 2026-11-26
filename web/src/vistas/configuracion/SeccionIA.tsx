// Configuración → IA (plan de la IA integrada, 14.7, Anexo F y tarea 2.3): donde se carga la clave de un proveedor, se crean y se cambian
// los agentes, se les pone tope de gasto, se ve cuánto gastó la IA y se pausa todo. La usan el diálogo de Configuración (PC) y la hoja
// «IA» del menú del teléfono (que no tiene Configuración: movil/ia/HojaIA.tsx), igual que Notificaciones.
//   · Una sola lectura (`GET /api/ia/estado`) trae agentes, claves (sin el secreto), ajustes y modelos; lo que se hace después se
//     refleja al instante o se vuelve a leer. Con lo que ya había en la tienda se dibuja enseguida (sin cartel de «cargando»).
//   · Dentro de la sección se navega sin abrir otro diálogo: el inicio (cómo está la IA, agentes, claves, código, gasto, afuera) y
//     los formularios de un agente o de una clave. «Atrás» del teléfono cierra la hoja entera: es lo esperable.
//   · Estados: cargando (esqueleto), error con «Reintentar», un servidor sin estas rutas, vacío (sin claves y sin agentes), con clave
//     que no anda, en el tope, pausada y, entrando con la clave del MCP, solo lectura: «Esto se cambia desde tu cuenta».
//   · La clave se pega SOLO en su formulario; nunca vuelve a la pantalla (FormularioClave.tsx).
import { CloudOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorApi } from '../../estado/api'
import { useIA } from '../../estado/ia'
import { useTienda } from '../../estado/tienda'
import { EstadoVacio } from '../../ui/EstadoVacio'
import '../../estilos/config-ia.css'
import { cargarEstadoIA } from '../ia/estado-ia'
import { GrupoCodigo } from './ia/Codigo'
import { FormularioAgente } from './ia/FormularioAgente'
import { FormularioClave } from './ia/FormularioClave'
import { GrupoGasto } from './ia/Gasto'
import { GrupoAfuera, GrupoAgentes, GrupoClaves, GrupoResumen } from './ia/Inicio'
import { AvisoSoloLectura, ContextoIA, type Vista } from './ia/piezas'

type Carga = 'cargando' | 'lista' | 'error' | 'sin_rutas'

/** `alIrAConectar`: en el teléfono hay que cerrar la hoja antes de abrir «Conectar IA». */
export function SeccionIA({ alIrAConectar }: { alIrAConectar?: () => void }) {
  const ia = useIA((s) => s.ia)
  const [carga, setCarga] = useState<Carga>(ia ? 'lista' : 'cargando')
  const [vista, setVista] = useState<Vista>({ tipo: 'inicio' })
  const raiz = useRef<HTMLDivElement>(null)
  const primera = useRef(true)

  const cargar = useCallback(async () => {
    try {
      await cargarEstadoIA()
      setCarga('lista')
    } catch (e) {
      // Si ya había algo a la vista, se queda (lo último antes que un cartel); si no, el error con «Reintentar».
      setCarga((c) => (c === 'lista' ? c : e instanceof ErrorApi && (e.estado === 404 || e.estado === 405) ? 'sin_rutas' : 'error'))
    }
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  // Al pasar de una vista a otra se vuelve al principio (el contenedor que se desplaza es el de afuera).
  useEffect(() => {
    if (primera.current) primera.current = false
    else raiz.current?.scrollIntoView({ block: 'start' })
  }, [vista])

  if (!ia && carga === 'cargando')
    return (
      <div className="ia-esqueleto" role="status" aria-busy="true" aria-label="Cargando la IA">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} />
        ))}
      </div>
    )
  if (!ia)
    return (
      <EstadoVacio
        icono={CloudOff}
        titulo={carga === 'sin_rutas' ? 'La IA integrada todavía no está en este Telar' : 'No pude cargar la configuración de IA'}
        ayuda={carga === 'sin_rutas' ? 'Cuando se publique la versión nueva, la vas a poder configurar acá.' : 'Revisá la conexión y probá de nuevo.'}
        accion={
          carga === 'sin_rutas' ? undefined : (
            <button
              type="button"
              className="boton boton--chico"
              onClick={() => {
                setCarga('cargando')
                void cargar()
              }}
            >
              Reintentar
            </button>
          )
        }
      />
    )

  const conectar = () => {
    alIrAConectar?.()
    useTienda.getState().setDialogo('conectar')
  }

  return (
    <ContextoIA.Provider value={{ ia, puede: ia.puedeCambiar, recargar: cargar, ir: setVista }}>
      <div ref={raiz} className="ia-seccion">
        {!ia.puedeCambiar && <AvisoSoloLectura />}
        {vista.tipo === 'agente' ? (
          <FormularioAgente key={vista.id} id={vista.id} borrador={vista.borrador} />
        ) : vista.tipo === 'clave' ? (
          <FormularioClave key={vista.id} id={vista.id} opcion={vista.opcion} volver={vista.volver} />
        ) : (
          <>
            <GrupoResumen />
            <GrupoAgentes />
            <GrupoClaves />
            <GrupoCodigo />
            <GrupoGasto />
            <GrupoAfuera alIrAConectar={conectar} />
          </>
        )}
      </div>
    </ContextoIA.Provider>
  )
}
