import { Check, Copy, Eye, EyeOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type ConexionOAuth } from '../estado/api'
import { useTienda } from '../estado/tienda'
import { Dialogo } from '../ui/Dialogo'
import { esMac } from '../util/teclas'

function Bloque({ titulo, texto, ayuda }: { titulo: string; texto: string; ayuda?: React.ReactNode }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="bloque-codigo">
      <div className="bloque-codigo__cabecera">
        <span>{titulo}</span>
        <button
          className="boton boton--chico"
          onClick={() => {
            navigator.clipboard.writeText(texto)
            setCopiado(true)
            setTimeout(() => setCopiado(false), 1600)
          }}
        >
          {copiado ? <Check size={13} /> : <Copy size={13} />} {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre>{texto}</pre>
      {ayuda && <p className="bloque-codigo__ayuda">{ayuda}</p>}
    </div>
  )
}

const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

/** ChatGPT y claude.ai (chat): se conectan con OAuth (sin clave). Acá están los pasos y las aplicaciones ya conectadas. */
function ChatOAuth({ urlMcp }: { urlMcp: string }) {
  const [conexiones, setConexiones] = useState<ConexionOAuth[] | null>(null)
  const [error, setError] = useState('')
  const cargar = () =>
    api
      .conexionesOAuth()
      .then((c) => {
        setConexiones(c)
        setError('')
      })
      .catch(() => setConexiones([]))
  useEffect(() => {
    cargar()
  }, [])
  const desconectar = async (familia: string) => {
    try {
      await api.desconectarOAuth(familia)
      await cargar()
    } catch (e) {
      setError((e as Error).message || 'No se pudo desconectar.')
    }
  }
  return (
    <>
      <Bloque
        titulo="Dirección del servidor (Telar)"
        texto={urlMcp}
        ayuda={
          <>
            <b>ChatGPT</b> (en la computadora, en chatgpt.com; en la app del celular no se puede): Plugins → <b>+</b> → «Add custom MCP server».
            Nombre <b>Telar</b>, esta dirección, autenticación <b>OAuth</b>. Después se abre Telar: entrá con tu cuenta y tocá{' '}
            <b>Permitir</b>. Según tu plan, ChatGPT puede solo leer (Plus y Pro) o también escribir (Business y Enterprise).
            <br />
            <b>claude.ai</b>: Configuración → Conectores → «Agregar conector personalizado», con la misma dirección. Se conecta con el mismo
            «Permitir».
          </>
        }
      />
      <div className="conexiones">
        <h3 className="conexiones__titulo">Conectadas ahora</h3>
        {conexiones === null && <p className="conexiones__vacio">Mirando…</p>}
        {conexiones?.length === 0 && <p className="conexiones__vacio">Todavía no hay ninguna.</p>}
        {conexiones?.map((c) => (
          <div className="conexiones__fila" key={c.familia}>
            <span>
              <b>{c.nombre}</b> <span className="conexiones__fecha">desde el {fechaCorta(c.desde)}</span>
            </span>
            <button className="boton boton--chico" onClick={() => desconectar(c.familia)}>
              Desconectar
            </button>
          </div>
        ))}
        {error && <p className="conexiones__error">{error}</p>}
      </div>
    </>
  )
}

export function ConectarIA() {
  const abierto = useTienda((s) => s.dialogo === 'conectar')
  const info = useTienda((s) => s.info)
  const [ver, setVer] = useState(false)
  // Online (publicado) no hay ruta local: solo sirve la conexión por HTTP con la clave.
  const online = info?.rutaTablero === ''
  // La clave es de la cuenta del dueño: una cuenta de Telar no la tiene y conecta su IA con «Permitir» (OAuth).
  const sinClave = online && !info?.clave
  const [pestana, setPestana] = useState<'code' | 'desktop' | 'http' | 'chat'>(online ? 'http' : 'code')
  useEffect(() => {
    if (sinClave && pestana !== 'chat') setPestana('chat')
  }, [sinClave, pestana])
  const [copiada, setCopiada] = useState(false)
  const copiarClave = () => {
    navigator.clipboard?.writeText(info?.clave ?? '').then(() => {
      setCopiada(true)
      setTimeout(() => setCopiada(false), 1800)
    })
  }
  const cerrar = () => useTienda.getState().setDialogo(null)
  const ruta = info?.rutaTablero ?? '/ruta/a/tablero'
  const clave = info?.clave ?? '…'
  const claveVista = ver ? clave : clave.slice(0, 7) + '•'.repeat(18)
  const windows = !esMac && /Win/.test(navigator.platform)

  const desktop = JSON.stringify(
    {
      mcpServers: {
        tablero: windows
          ? { command: 'cmd', args: ['/c', 'npm', 'run', '--silent', '--prefix', ruta, 'mcp'], env: { TABLERO_AUTOR: 'Claude Desktop' } }
          : { command: 'npm', args: ['run', '--silent', '--prefix', ruta, 'mcp'], env: { TABLERO_AUTOR: 'Claude Desktop' } },
      },
    },
    null,
    2,
  )
  const code = `claude mcp add telar --scope user -e TABLERO_AUTOR="Claude Code" -- npm run --silent --prefix "${ruta}" mcp`
  const http = `claude mcp add --transport http telar ${info?.urlMcp ?? 'http://127.0.0.1:4318/mcp'} --header "Authorization: Bearer ${clave}"`

  return (
    <Dialogo abierto={abierto} alCerrar={cerrar} tituloId="titulo-conectar" className="dialogo--ancho">
      <header className="dialogo__cabecera">
        <div>
          <h2 id="titulo-conectar">Conectar Claude, ChatGPT o Cursor</h2>
          <p className="dialogo__bajada">
            La IA entra por MCP: lee y escribe tarjetas, porqués y el lienzo. Lo que hace aparece acá en vivo y queda en la actividad con su nombre.
            Nada se borra de verdad: como mucho archiva una tarjeta o saca algo del lienzo, y vuelve.
          </p>
        </div>
        <button className="boton-icono" onClick={cerrar} aria-label="Cerrar">
          <X size={18} />
        </button>
      </header>
      <div className="segmentado segmentado--grande">
        {(
          (sinClave
            ? [['chat', 'ChatGPT, Claude y otras IA']]
            : online
            ? [
                ['http', 'Claude Code y otras IA'],
                ['chat', 'ChatGPT y Claude (chat)'],
              ]
            : [
                ['code', 'Claude Code'],
                ['desktop', 'Claude Desktop'],
                ['http', 'Por HTTP'],
              ]) as readonly (readonly ['code' | 'desktop' | 'http' | 'chat', string])[]
        ).map(([id, nombre]) => (
          <button key={id} className={`segmentado__opcion${pestana === id ? ' segmentado__opcion--activa' : ''}`} onClick={() => setPestana(id)}>
            {nombre}
          </button>
        ))}
      </div>
      {pestana === 'code' && (
        <Bloque
          titulo="En una terminal (una sola vez)"
          texto={code}
          ayuda={
            <>
              Usa stdio (<code>npm run mcp</code>). Si la app está abierta, los cambios aparecen en vivo; si no, el MCP la levanta solo.
            </>
          }
        />
      )}
      {pestana === 'desktop' && (
        <Bloque
          titulo={`claude_desktop_config.json (Configuración → Desarrollador → Editar configuración)`}
          texto={desktop}
          ayuda="Después de guardar, cerrá y volvé a abrir Claude Desktop. Va a aparecer «tablero» en las herramientas."
        />
      )}
      {pestana === 'chat' && online && <ChatOAuth urlMcp={info?.urlMcp ?? ''} />}
      {pestana === 'chat' && sinClave && (
        <Bloque
          titulo="Claude Code (en una terminal, una sola vez)"
          texto={`claude mcp add --transport http telar ${info?.urlMcp ?? ''}`}
          ayuda="Después, en Claude Code escribí /mcp y elegí «telar»: se abre Telar para que toques «Permitir». La IA ve solo lo de tu cuenta."
        />
      )}
      {pestana === 'http' && (
        <>
          <div className="clave">
            <span className="clave__nombre">Clave</span>
            <code className="clave__valor">{claveVista}</code>
            <button className="boton-icono boton-icono--chico" onClick={() => setVer(!ver)} aria-label={ver ? 'Ocultar clave' : 'Ver clave'}>
              {ver ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button className="boton boton--chico" onClick={copiarClave}>
              {copiada ? 'Copiada' : 'Copiar clave'}
            </button>
          </div>
          <Bloque
            titulo="Claude Code por HTTP"
            texto={http}
            ayuda={
              online ? (
                <>
                  En Claude Code en la nube ya está configurado: la primera vez Claude te muestra un formulario seguro y ahí pegás esta clave (no en
                  el chat). Para ChatGPT y el chat de claude.ai, mirá la otra pestaña (se conectan con «Permitir», sin clave).
                </>
              ) : (
                <>
                  El servidor escucha solo en esta computadora ({info?.urlMcp}). ChatGPT y claude.ai se conectan a la versión publicada
                  (telarapp.vercel.app), con «Permitir»: ahí está la pestaña «ChatGPT y Claude (chat)».
                </>
              )
            }
          />
        </>
      )}
      <div className="conectar__pie">
        <span>
          Base de datos: <b>{info?.baseDeDatos === 'postgres' ? 'Postgres' : 'PGlite (local)'}</b>
        </span>
        <span className="mono conectar__ruta">{info?.rutaDatos}</span>
      </div>
    </Dialogo>
  )
}
