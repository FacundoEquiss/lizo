// Telar no pudo arrancar (plan del celular, 9.6): sin red y sin nada guardado, o el servidor no contestó bien. Reintenta
// sola al volver la señal (y cada 10 s); el botón prueba en el momento. Reemplaza al ciclo de recargas de antes (N12a).
// La usan las dos apps (va en la raíz): en la computadora, una PWA instalada también puede abrirse sin red.
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Girando } from '../../ui/comunes'
import { usePwa } from '../estado'
import { reintentarInicio } from '../sinconexion/instantanea'

export function PantallaSinConexion() {
  const fallo = usePwa((s) => s.falloInicio)
  const [probando, setProbando] = useState(false)
  if (!fallo) return null
  return (
    <main className="sin-conexion" aria-labelledby="sin-conexion-titulo">
      <div className="sin-conexion__caja" role="alert">
        <div className="entrar__marca" aria-hidden="true">
          <span className="entrar__logo" />
          Telar
        </div>
        <h1 id="sin-conexion-titulo" className="sin-conexion__titulo">
          {fallo.sinRed ? 'Telar necesita conexión la primera vez' : 'No se pudo abrir Telar'}
        </h1>
        <p className="sin-conexion__texto">
          {fallo.sinRed
            ? 'Cuando vuelva la señal se abre sola. Después, lo último que veas queda guardado para leerlo sin conexión.'
            : `${fallo.mensaje || 'El servidor no contestó bien'}. Se vuelve a probar sola en unos segundos.`}
        </p>
        <button
          type="button"
          className="boton boton--primario sin-conexion__boton"
          disabled={probando}
          onClick={async () => {
            setProbando(true)
            await reintentarInicio()
            setProbando(false)
          }}
        >
          {probando ? (
            <Girando />
          ) : (
            <>
              <RefreshCw size={16} /> Reintentar
            </>
          )}
        </button>
      </div>
    </main>
  )
}
