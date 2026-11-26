// Configuración → IA → «Código (GitHub)» (Anexo F.3): para que un agente conteste mirando el código real de los repos, la cuenta carga
// UN token de GitHub de solo lectura. Acá se explica cómo generarlo en cuatro pasos (con el enlace oficial), se pega (campo de
// contraseña, cifrado, no vuelve nunca a la pantalla), se prueba y se elige qué repos puede leer: los de los proyectos de la cuenta
// (que ya figuran) y los que se sumen a mano. El agente además tiene que tener permitido «Código» en sus permisos.
//   Estados: sin token (los pasos y el campo), con token que anda, con token que no anda (con el motivo) y sin probar.
import { ExternalLink, GitBranch, X } from 'lucide-react'
import { useState } from 'react'
import { avisar, avisarError } from '../../../estado/avisos'
import { useTienda } from '../../../estado/tienda'
import { Girando } from '../../../ui/comunes'
import { apiIA } from '../../ia/api-ia'
import { Fila, Grupo } from '../piezas'
import { Campo, CampoClave, PildoraClave, useConfigIA } from './piezas'

const URL_NUEVO_TOKEN = 'https://github.com/settings/personal-access-tokens/new'
const URL_AYUDA = 'https://docs.github.com/es/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens'

/** «dueño/repo» o una dirección de GitHub; null si no se entiende. */
function aRepo(t: string): string | null {
  const limpio = t.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '')
  return /^[\w.-]+\/[\w.-]+$/.test(limpio) ? limpio : null
}

export function GrupoCodigo() {
  const { ia, puede, recargar } = useConfigIA()
  const proyectos = useTienda((s) => s.proyectos)
  const token = ia.claves.find((c) => c.proveedor === 'github') ?? null
  const reposDeProyectos = [...new Set(proyectos.map((p) => p.repoGithub).filter((r): r is string => !!r))]
  const [clave, setClave] = useState('')
  const [cambiando, setCambiando] = useState(false)
  const [ocupado, setOcupado] = useState<'guardar' | 'probar' | 'quitar' | null>(null)
  const [error, setError] = useState('')
  const [quitando, setQuitando] = useState(false)
  const [repo, setRepo] = useState('')
  const [errorRepo, setErrorRepo] = useState('')

  async function guardarToken() {
    setError('')
    setOcupado('guardar')
    try {
      await apiIA.guardarClave({ ...(token ? { id: token.id } : {}), proveedor: 'github', nombre: token?.nombre ?? 'GitHub', clave })
      setClave('')
      setCambiando(false)
      avisar({ texto: 'Token de GitHub guardado y probado.', tipo: 'ok', duracion: 2400 })
      await recargar()
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x))
    }
    setOcupado(null)
  }

  async function probar() {
    setOcupado('probar')
    try {
      const c = await apiIA.probarClave(token!.id)
      await recargar()
      avisar(c.estado === 'valida' ? { texto: 'El token anda.', tipo: 'ok', duracion: 2000 } : { texto: c.error ?? 'El token no anda.', tipo: 'error' })
    } catch (x) {
      avisarError(x)
    }
    setOcupado(null)
  }

  async function quitar() {
    setOcupado('quitar')
    try {
      await apiIA.quitarClave(token!.id)
      setQuitando(false)
      await recargar()
    } catch (x) {
      avisarError(x)
    }
    setOcupado(null)
  }

  async function guardarRepos(repos: string[]) {
    try {
      await apiIA.guardarAjustes({ reposCodigo: repos })
      await recargar()
    } catch (x) {
      avisarError(x)
    }
  }

  function sumar() {
    const r = aRepo(repo)
    if (!r) return setErrorRepo('Escribilo así: dueño/repo (por ejemplo <usuario>/<repo-del-juego>), o pegá la dirección de GitHub.')
    if (ia.ajustes.reposCodigo.some((x) => x.toLowerCase() === r.toLowerCase()) || reposDeProyectos.some((x) => aRepo(x)?.toLowerCase() === r.toLowerCase())) return setErrorRepo('Ese repo ya está.')
    setErrorRepo('')
    setRepo('')
    void guardarRepos([...ia.ajustes.reposCodigo, r])
  }

  const formulario = (
    <form
      className="ia-codigo__token"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault()
        if (clave.length >= 8 && puede && !ocupado) void guardarToken()
      }}
    >
      <Campo etiqueta={token ? 'Token nuevo' : 'Token de GitHub'} error={error} ayuda="No lo mandes por chat ni lo guardes en otro lado. Se guarda cifrado y no se vuelve a mostrar.">
        {(p) => <CampoClave {...p} valor={clave} alCambiar={setClave} deshabilitado={!puede || ocupado === 'guardar'} placeholder="Pegá el token acá (github_pat_…)" />}
      </Campo>
      <div className="ia-botones">
        <button type="submit" className="boton boton--primario boton--chico" disabled={!puede || clave.length < 8 || !!ocupado}>
          {ocupado === 'guardar' ? <Girando tam={13} /> : null} Guardar y probar
        </button>
        {token && (
          <button type="button" className="boton boton--chico boton--fantasma" onClick={() => (setCambiando(false), setClave(''), setError(''))} disabled={ocupado === 'guardar'}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )

  return (
    <Grupo titulo="Código (GitHub)" bajada="Para que una IA conteste una tarjeta mirando el código real de la rama o la ruta que tiene. Solo lee: nunca escribe en tus repos.">
      {!token ? (
        <>
          <ol className="ia-pasos">
            <li>
              Entrá a GitHub y creá un token de acceso personal «fine-grained»:{' '}
              <a className="enlace" href={URL_NUEVO_TOKEN} target="_blank" rel="noopener noreferrer">
                github.com/settings/personal-access-tokens/new <ExternalLink size={12} aria-hidden />
              </a>
              .
            </li>
            <li>Ponele un nombre (por ejemplo «Telar») y una fecha de vencimiento.</li>
            <li>En «Repository access» elegí «Only select repositories» y marcá los repos que quieras que lea.</li>
            <li>
              En «Permissions → Repository permissions» poné «Contents: Read-only» (Metadata queda en solo lectura). Generalo, copialo y pegalo acá abajo.{' '}
              <a className="enlace" href={URL_AYUDA} target="_blank" rel="noopener noreferrer">
                Ayuda de GitHub <ExternalLink size={12} aria-hidden />
              </a>
            </li>
          </ol>
          {formulario}
        </>
      ) : (
        <>
          <Fila nombre={token.nombre} descripcion={`Termina en …${token.ultimos4}${token.estado === 'invalida' && token.error ? ` · ${token.error}` : ''}`}>
            <PildoraClave clave={token} />
          </Fila>
          {cambiando ? (
            formulario
          ) : (
            <div className="ia-botones">
              <button type="button" className="boton boton--chico" onClick={probar} disabled={!puede || !!ocupado}>
                {ocupado === 'probar' ? <Girando tam={13} /> : null} Probar
              </button>
              <button type="button" className="boton boton--chico" onClick={() => setCambiando(true)} disabled={!puede || !!ocupado}>
                Cambiar
              </button>
              {quitando ? (
                <span className="ia-confirmar-quitar" role="alert">
                  Los agentes dejan de poder leer código.
                  <button type="button" className="boton boton--chico boton--peligro" onClick={quitar} disabled={!puede || !!ocupado}>
                    {ocupado === 'quitar' ? <Girando tam={13} /> : null} Quitar
                  </button>
                  <button type="button" className="boton boton--chico boton--fantasma" onClick={() => setQuitando(false)}>
                    No
                  </button>
                </span>
              ) : (
                <button type="button" className="boton boton--chico boton--fantasma boton--peligro" onClick={() => setQuitando(true)} disabled={!puede || !!ocupado}>
                  Quitar
                </button>
              )}
            </div>
          )}
        </>
      )}

      <div className="ia-repos">
        <span className="perfil__campo ia-campo">
          <span>Repos que puede leer</span>
        </span>
        <ul className="ia-repos__lista" aria-label="Repos que puede leer">
          {reposDeProyectos.map((r) => (
            <li key={`p-${r}`} className="ia-repo">
              <GitBranch size={13} aria-hidden /> {r} <small>de un proyecto</small>
            </li>
          ))}
          {ia.ajustes.reposCodigo.map((r) => (
            <li key={`a-${r}`} className="ia-repo">
              <GitBranch size={13} aria-hidden /> {r}
              <button type="button" className="ia-repo__quitar" aria-label={`Sacar ${r}`} disabled={!puede} onClick={() => void guardarRepos(ia.ajustes.reposCodigo.filter((x) => x !== r))}>
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
          {reposDeProyectos.length + ia.ajustes.reposCodigo.length === 0 && <li className="ia-repo ia-repo--vacio">Ninguno todavía. Los repos de tus proyectos aparecen solos.</li>}
        </ul>
        <form
          className="ia-repos__sumar"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault()
            if (puede) sumar()
          }}
        >
          <Campo etiqueta="Sumar otro repo" error={errorRepo} ayuda="Dueño/repo o la dirección de GitHub.">
            {(p) => <input {...p} className="campo" value={repo} placeholder="dueño/repo" disabled={!puede} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(ev) => (setRepo(ev.target.value), setErrorRepo(''))} />}
          </Campo>
          <button type="submit" className="boton boton--chico" disabled={!puede || !repo.trim()}>
            Sumar
          </button>
        </form>
      </div>
    </Grupo>
  )
}
