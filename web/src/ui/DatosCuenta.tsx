// El mail de la cuenta, «Cambiar contraseña» y los códigos de recuperación, para el menú del celular (en la computadora están en Configuración → Cuenta).
import { useEffect, useState } from 'react'
import { api, type MiCuenta } from '../estado/api'
import { CambiarClave } from './CambiarClave'
import { CodigosCuenta } from './CodigosCuenta'

export function DatosCuenta() {
  const [cuenta, setCuenta] = useState<MiCuenta | null>(null)
  useEffect(() => {
    api.cuenta().then(setCuenta, () => setCuenta(null))
  }, [])
  if (!cuenta) return null
  return (
    <div className="datos-cuenta">
      <p className="datos-cuenta__mail">
        {cuenta.tipo === 'juego' ? 'Cuenta del juego' : 'Tu mail'}: <b>{cuenta.email ?? '—'}</b>
      </p>
      {cuenta.tipo === 'telar' && <CambiarClave email={cuenta.email} />}
      {cuenta.tipo === 'telar' && <CodigosCuenta email={cuenta.email} conTitulo />}
    </div>
  )
}
