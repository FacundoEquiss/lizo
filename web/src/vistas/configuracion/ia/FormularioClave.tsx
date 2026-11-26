// Agregar una clave de un proveedor o cambiar una que ya está (plan 10.1 y 14.7). Es el ÚNICO lugar donde se pega una clave: en un
// campo de contraseña, que no se ve, no se recuerda y no vuelve nunca a la pantalla (después solo se ve «termina en …1234»). La
// clave se prueba con el proveedor antes de guardarse: una que no anda no queda guardada y el servidor dice por qué.
//   · Anthropic, GPT, Gemini y DeepSeek traen su dirección; «Otro compatible con OpenAI» pide la suya (tiene que ser https).
//   · Con la clave del MCP (sin sesión) el formulario se ve pero no se puede mandar (14.7).
//   · Si se llegó desde «Agregar una clave…» de un agente, al guardar se vuelve a ese agente con la clave ya elegida.
import { ExternalLink, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { avisar } from '../../../estado/avisos'
import { Girando } from '../../../ui/comunes'
import { apiIA } from '../../ia/api-ia'
import { Grupo } from '../piezas'
import { Campo, CampoClave, SelectNativo, SOLO_CON_CUENTA, useConfigIA, type Vista } from './piezas'
import { opcionDe, opcionPorId, OPCIONES_PROVEEDOR, type IdOpcion } from './proveedores'

export function FormularioClave({ id, opcion: inicial, volver }: { id: string | 'nueva'; opcion?: IdOpcion; volver?: Extract<Vista, { tipo: 'clave' }>['volver'] }) {
  const { ia, puede, recargar, ir } = useConfigIA()
  const existente = id === 'nueva' ? null : (ia.claves.find((c) => c.id === id) ?? null)
  const [opcionId, setOpcionId] = useState<IdOpcion>(inicial ?? (existente ? opcionDe(existente.proveedor, existente.urlBase).id : 'anthropic'))
  const o = opcionPorId(opcionId)
  const [nombre, setNombre] = useState(existente?.nombre ?? o.nombreClave)
  const [nombreTocado, setNombreTocado] = useState(!!existente)
  const [clave, setClave] = useState('')
  const [urlBase, setUrlBase] = useState(existente?.urlBase ?? o.urlBase ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  if (id !== 'nueva' && !existente)
    return (
      <>
        <Atras volver={volver} />
        <p className="ia-aviso">Esa clave ya no está.</p>
      </>
    )

  const cambiaDireccion = o.pideUrlBase && urlBase.trim() !== (existente?.urlBase ?? '')
  const puedeMandar = puede && !guardando && nombre.trim().length > 0 && (existente ? clave.length > 0 || cambiaDireccion || nombre.trim() !== existente.nombre : clave.length >= 8) && (!o.pideUrlBase || /^https:\/\/\S+$/i.test(urlBase.trim()))

  function elegir(nuevo: IdOpcion) {
    const n = opcionPorId(nuevo)
    setOpcionId(nuevo)
    setUrlBase(n.urlBase ?? '')
    if (!nombreTocado) setNombre(n.nombreClave)
  }

  async function guardar() {
    setError('')
    setGuardando(true)
    try {
      const guardada = await apiIA.guardarClave({
        ...(existente ? { id: existente.id } : {}),
        proveedor: o.proveedor,
        nombre: nombre.trim(),
        ...(clave ? { clave } : {}),
        ...(o.pideUrlBase ? { urlBase: urlBase.trim() } : o.urlBase ? { urlBase: o.urlBase } : {}),
      })
      setClave('')
      avisar({ texto: existente ? 'Clave guardada.' : `Clave guardada y probada: ${guardada.nombre}, termina en …${guardada.ultimos4}.`, tipo: 'ok', duracion: 2600 })
      await recargar()
      ir(volver ? { tipo: 'agente', id: volver.id, borrador: { ...volver.borrador, claveId: guardada.id } } : { tipo: 'inicio' })
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x))
      setGuardando(false)
    }
  }

  return (
    <form
      className="ia-formulario"
      noValidate
      aria-busy={guardando}
      onSubmit={(ev) => {
        ev.preventDefault()
        if (puedeMandar) void guardar()
      }}
    >
      <Atras volver={volver} />
      <header className="ia-formulario__cabecera">
        <span className="ia-formulario__chispa" aria-hidden>
          <ShieldCheck size={20} />
        </span>
        <div>
          <h4>{existente ? `Cambiar «${existente.nombre}»` : 'Agregar clave'}</h4>
          {existente && <p>Termina en …{existente.ultimos4}</p>}
        </div>
      </header>
      {!puede && (
        <p className="ia-aviso ia-aviso--lectura" role="status">
          {SOLO_CON_CUENTA}
        </p>
      )}
      <fieldset className="ia-formulario__cuerpo" disabled={!puede || guardando}>
        <Grupo>
          {!existente && (
            <Campo etiqueta="Proveedor" ayuda={o.aviso}>
              {(p) => (
                <SelectNativo {...p} value={opcionId} onChange={(ev) => elegir(ev.target.value as IdOpcion)}>
                  {OPCIONES_PROVEEDOR.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nombre}
                    </option>
                  ))}
                </SelectNativo>
              )}
            </Campo>
          )}
          {existente && o.aviso && <p className="ia-aviso">{o.aviso}</p>}
          <Campo etiqueta="Nombre" ayuda="Para reconocerla en la lista. No es la clave.">
            {(p) => (
              <input
                {...p}
                className="campo"
                value={nombre}
                maxLength={60}
                autoComplete="off"
                onChange={(ev) => {
                  setNombre(ev.target.value)
                  setNombreTocado(true)
                }}
              />
            )}
          </Campo>
          {o.pideUrlBase && (
            <Campo etiqueta="Dirección base" ayuda="La del servicio, con https (por ejemplo https://api.groq.com/openai/v1).">
              {(p) => <input {...p} className="campo" type="url" inputMode="url" value={urlBase} placeholder="https://…" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(ev) => setUrlBase(ev.target.value)} />}
            </Campo>
          )}
          <Campo etiqueta={existente ? 'Clave nueva (si la querés cambiar)' : 'Clave'} ayuda="No la mandes por chat ni la guardes en otro lado.">
            {(p) => <CampoClave {...p} valor={clave} alCambiar={setClave} />}
          </Campo>
          <p className="ia-aviso ia-aviso--suave">
            <ShieldCheck size={14} aria-hidden />
            <span>
              {o.consola ? `La generás en ${o.consola.nombre} y la pegás acá. ` : 'La generás en el panel del servicio y la pegás acá. '}
              Se guarda cifrada y no se vuelve a mostrar. Telar no la comparte con nadie.
              {o.consola && (
                <>
                  {' '}
                  <a className="enlace" href={o.consola.url} target="_blank" rel="noopener noreferrer">
                    Abrir {o.consola.nombre} <ExternalLink size={12} aria-hidden />
                  </a>
                </>
              )}
            </span>
          </p>
        </Grupo>
      </fieldset>
      {error && (
        <p className="ia-aviso ia-aviso--error" role="alert">
          {error}
        </p>
      )}
      <footer className="ia-formulario__pie">
        <button type="button" className="boton boton--fantasma" onClick={() => ir(volver ? { tipo: 'agente', id: volver.id, borrador: volver.borrador } : { tipo: 'inicio' })} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="boton boton--primario" disabled={!puedeMandar}>
          {guardando ? <Girando tam={14} /> : null} {existente && !clave && !cambiaDireccion ? 'Guardar' : 'Guardar y probar'}
        </button>
      </footer>
    </form>
  )
}

function Atras({ volver }: { volver?: Extract<Vista, { tipo: 'clave' }>['volver'] }) {
  const { ir } = useConfigIA()
  return (
    <button type="button" className="ia-volver" onClick={() => ir(volver ? { tipo: 'agente', id: volver.id, borrador: volver.borrador } : { tipo: 'inicio' })}>
      <span aria-hidden>←</span> {volver ? 'Volver al agente' : 'IA'}
    </button>
  )
}
