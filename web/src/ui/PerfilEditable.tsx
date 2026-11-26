// Mi perfil: el nombre y el color con los que aparezco en Telar (en las tarjetas, los comentarios y la actividad). Se guarda al
// salir del campo o al tocar un color. La usan Configuración → Cuenta (escritorio) y el menú del celular.
import { useEffect, useState } from 'react'
import { COLORES_LIENZO, NOMBRES_COLOR } from '../../../compartido/lienzo'
import { ALIAS_RESERVADOS, aliasValido } from '../../../compartido/menciones'
import { api } from '../estado/api'
import { avisar, avisarError } from '../estado/avisos'
import { useTienda } from '../estado/tienda'
import { Avatar } from './comunes'

export function PerfilEditable() {
  const yo = useTienda((s) => s.miembros.find((m) => m.esYo))
  const [nombre, setNombre] = useState(yo?.nombre ?? '')
  const [alias, setAlias] = useState(yo?.alias ?? '')
  const [errorAlias, setErrorAlias] = useState('')
  useEffect(() => setNombre(yo?.nombre ?? ''), [yo?.nombre])
  useEffect(() => setAlias(yo?.alias ?? ''), [yo?.alias])
  if (!yo) return <p className="perfil__vacio">Todavía no hay un perfil: se crea con tu primer cambio en Telar.</p>

  async function guardar(cambios: { nombre?: string; color?: string }) {
    try {
      await api.actualizarMiembro(yo!.id, cambios)
      const miembros = await api.miembros()
      useTienda.setState({ miembros })
      avisar({ texto: 'Perfil guardado.', tipo: 'ok', duracion: 1800 })
    } catch (e) {
      avisarError(e)
      setNombre(yo!.nombre)
    }
  }

  /** Cambia el alias con el que me mencionan (`@facundo`): se revisa acá y el servidor lo vuelve a revisar (único en la cuenta). */
  async function guardarAlias() {
    const nuevo = alias.trim().toLowerCase().replace(/^@/, '')
    if (nuevo === yo!.alias) return setAlias(nuevo)
    if (ALIAS_RESERVADOS.includes(nuevo)) return setErrorAlias(`«${nuevo}» es un nombre reservado de Telar: elegí otro.`)
    if (!aliasValido(nuevo)) return setErrorAlias('Usá entre 2 y 32 letras minúsculas, números, punto, guion o guion bajo, y empezá con una letra o un número.')
    try {
      await api.actualizarMiembro(yo!.id, { alias: nuevo })
      setErrorAlias('')
      useTienda.setState({ miembros: await api.miembros() })
      avisar({ texto: `Ahora te mencionan con @${nuevo}.`, tipo: 'ok', duracion: 1800 })
    } catch (e) {
      setErrorAlias(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="perfil">
      <Avatar miembro={yo} tam={56} />
      <div className="perfil__campos">
        <label className="perfil__campo">
          <span>Tu nombre</span>
          <input
            value={nombre}
            maxLength={40}
            autoComplete="name"
            onChange={(e) => setNombre(e.target.value)}
            onBlur={() => nombre.trim() && nombre.trim() !== yo.nombre && void guardar({ nombre: nombre.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </label>
        {yo.alias !== undefined && (
          <label className="perfil__campo">
            <span>Tu alias</span>
            <span className="perfil__alias">
              <span aria-hidden>@</span>
              <input
                value={alias}
                maxLength={32}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={!!errorAlias}
                aria-describedby="perfil-alias-ayuda"
                onChange={(e) => {
                  setAlias(e.target.value)
                  setErrorAlias('')
                }}
                onBlur={() => void guardarAlias()}
                onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              />
            </span>
            <span id="perfil-alias-ayuda" className={`perfil__ayuda${errorAlias ? ' perfil__ayuda--error' : ''}`} role={errorAlias ? 'alert' : undefined}>
              {errorAlias || 'Así te mencionan en los comentarios: @' + (yo.alias || 'alias') + '.'}
            </span>
          </label>
        )}
        <div className="perfil__campo" role="group" aria-label="Tu color">
          <span>Tu color</span>
          <div className="perfil__colores">
            {COLORES_LIENZO.map((c) => (
              <button
                key={c}
                type="button"
                className={`herramientas__color${yo.color === c ? ' herramientas__color--activo' : ''}`}
                style={{ background: `var(--e-${c}-s)` }}
                aria-label={NOMBRES_COLOR[c]}
                aria-pressed={yo.color === c}
                onClick={() => yo.color !== c && void guardar({ color: c })}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
