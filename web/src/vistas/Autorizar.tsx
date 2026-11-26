// «Permitir»: la pantalla donde una cuenta autoriza a ChatGPT o Claude (OAuth) a usar SU Telar (la IA ve solo lo de esa cuenta). Una sola decisión por pantalla.
// El servidor ya validó todo (/oauth/autorizar) y mandó acá con un pedido firmado de 10 minutos. Si no hay sesión, main.tsx
// muestra la pantalla de entrar y al volver cae de nuevo en esta pantalla (la dirección no cambia).
import { useEffect, useState } from 'react'
import { api, type PedidoOAuth } from '../estado/api'
import { Girando } from '../ui/comunes'
import { MarcaTelar } from '../ui/marcas'

type Estado = { fase: 'cargando' } | { fase: 'listo'; pedido: PedidoOAuth } | { fase: 'error'; mensaje: string }

export default function Autorizar() {
  const token = new URLSearchParams(location.search).get('pedido') ?? ''
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const [enviando, setEnviando] = useState<'permitir' | 'no' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return setEstado({ fase: 'error', mensaje: 'Este enlace no sirve. Volvé a la aplicación y probá de nuevo.' })
    let vivo = true
    api
      .pedidoOAuth(token)
      .then((pedido) => vivo && setEstado({ fase: 'listo', pedido }))
      .catch((e: Error) => vivo && setEstado({ fase: 'error', mensaje: e.message || 'No pude leer el pedido.' }))
    return () => {
      vivo = false
    }
  }, [token])

  async function decidir(permitir: boolean) {
    if (enviando) return
    setError('')
    setEnviando(permitir ? 'permitir' : 'no')
    try {
      const r = await api.decidirOAuth(token, permitir)
      // Vuelve a la aplicación (con el código si permitió); si la pestaña la abrió ella, se cierra sola o queda ahí.
      location.assign(r.redirigir)
    } catch (e) {
      setError((e as Error).message || 'No se pudo. Probá de nuevo.')
      setEnviando(null)
    }
  }

  return (
    <main className="entrar">
      <div className="entrar__caja" role="group" aria-labelledby="autorizar-titulo">
        <div className="entrar__marca" aria-hidden="true">
          <span className="entrar__logo">
            <MarcaTelar size={44} />
          </span>
          Telar
        </div>

        {estado.fase === 'cargando' && (
          <p className="entrar__texto autorizar__cargando" role="status">
            <Girando /> Leyendo el pedido…
          </p>
        )}

        {estado.fase === 'error' && (
          <>
            <h1 className="entrar__titulo" id="autorizar-titulo">
              No se pudo conectar
            </h1>
            <p className="entrar__error" role="alert">
              {estado.mensaje}
            </p>
            <p className="entrar__texto">Este pedido vence a los 10 minutos. Volvé a ChatGPT o a Claude y probá de nuevo.</p>
          </>
        )}

        {estado.fase === 'listo' && (
          <>
            <h1 className="entrar__titulo" id="autorizar-titulo">
              {estado.pedido.cliente} quiere usar tu Telar
            </h1>
            <p className="entrar__texto">
              Va a poder leer y cambiar tus proyectos, tableros y diseños. Lo que haga queda en la actividad con su nombre. Nada se borra de
              verdad.
            </p>
            <p className="autorizar__sitio">
              Después de tu respuesta vuelve a <b>{estado.pedido.sitio}</b>.
            </p>
            {error && (
              <p className="entrar__error" role="alert">
                {error}
              </p>
            )}
            <div className="autorizar__acciones">
              <button className="boton boton--primario boton--ancho entrar__boton" onClick={() => decidir(true)} disabled={enviando !== null}>
                {enviando === 'permitir' ? <Girando /> : 'Permitir'}
              </button>
              <button className="boton boton--ancho entrar__boton" onClick={() => decidir(false)} disabled={enviando !== null}>
                {enviando === 'no' ? <Girando /> : 'No permitir'}
              </button>
            </div>
            <p className="autorizar__pie">Lo desconectás cuando quieras desde «Conectar IA».</p>
          </>
        )}
      </div>
    </main>
  )
}
