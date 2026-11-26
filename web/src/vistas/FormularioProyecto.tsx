// El formulario del proyecto (7.3), sin el marco del diálogo: lo usa DialogoProyecto y lo va a usar la hoja del celular.
// Crear o editar. Los cambios se juntan y se guardan juntos ("Guardar cambios" se apaga si no cambió nada). La foto se ve
// al instante (URL de objeto) y sube al guardar: si falla, vuelve la de antes y avisa. El color se ve en vivo también en la
// barra lateral (el sello y el hilo); "Cancelar" lo deja como estaba.
import { ArrowLeft, Camera, CaseSensitive, ExternalLink, ImagePlus, ImageUp, Smile } from 'lucide-react'
import { useIsPresent } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { COLORES } from '../../../compartido/constantes'
import type { Color, Proyecto } from '../../../compartido/tipos'
import { api } from '../estado/api'
import { avisar, avisarError } from '../estado/avisos'
import { irA } from '../estado/ruta'
import { useTienda } from '../estado/tienda'
import { AvatarProyecto } from '../ui/AvatarProyecto'
import { Girando } from '../ui/comunes'
import { Desplegable } from '../ui/Desplegable'
import { ErrorImagen, imagenDe, recortarCuadrada, TIPOS_IMAGEN } from '../util/imagen'
import { ElegirTipoTablero } from '../ui/TipoTablero'
import { TIPO_DE_FABRICA, VISTAS_DEL_TIPO, vistaInicial, type TipoTablero } from '../../../compartido/vistas'

export const LARGO_NOMBRE = 60
export const LARGO_DESCRIPCION = 280
/** Desde cuántos caracteres se muestra el contador de la descripción. */
const AVISO_DESCRIPCION = 200

/** 8 × 6, elegidos a mano: comida, juegos, herramientas, casa, ideas y un poco de todo. */
// prettier-ignore
export const EMOJIS_PROYECTO = [
  '🍝', '🍔', '🍗', '🍲', '🥪', '🍕', '🍰', '☕',
  '🎮', '🎲', '🧩', '🎯', '🕹️', '🏆', '🎨', '🎪',
  '🔧', '🔨', '🛠️', '⚙️', '🧰', '📐', '✏️', '🧪',
  '🏠', '🏨', '🏪', '🌳', '🪴', '🛋️', '🔑', '🚪',
  '💡', '🚀', '⭐', '🔥', '✨', '🌈', '🎵', '📚',
  '📈', '🗂️', '📝', '💬', '🧭', '🌍', '🐱', '🐶',
]

/** Las claves de las tarjetas: las iniciales de las palabras (hasta 4) o las tres primeras letras de una sola. */
export function prefijoDe(nombre: string) {
  const palabras = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  const p =
    palabras.length === 1
      ? palabras[0]!.slice(0, 3)
      : palabras
          .slice(0, 4)
          .map((x) => x[0])
          .join('')
  // Tiene que empezar con una letra (la clave RC-12 no puede ser 3D-12).
  return p.replace(/^[0-9]+/, '')
}

export const REPO_VALIDO = /^[\w.-]+\/[\w.-]+$/

/** Acepta que peguen la URL entera: "https://github.com/usuario/repo/tree/main" o "git@github.com:usuario/repo.git". */
export function normalizarRepo(texto: string): string {
  const t = texto.trim()
  const sinGithub = t
    .replace(/^git@github\.com:/i, '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/[?#].*$/, '')
  if (sinGithub !== t) {
    const [usuario, repo] = sinGithub.split('/').filter(Boolean)
    if (usuario && repo) return `${usuario}/${repo.replace(/\.git$/i, '')}`
  }
  return sinGithub.replace(/\.git$/i, '').replace(/\/+$/, '')
}

/** La cara elegida en el formulario, sin guardar todavía. */
type Cara = { tipo: 'igual' } | { tipo: 'foto'; blob: Blob; url: string } | { tipo: 'emoji'; emoji: string } | { tipo: 'iniciales' }

export interface PropsFormularioProyecto {
  modo: 'crear' | 'editar'
  /** Al editar: el proyecto. */
  proyecto?: Proyecto
  /** Después de crear, guardar o archivar. */
  alTerminar: () => void
  alCancelar: () => void
  /** Enfocar el nombre al abrir (de fábrica, sí). */
  enfocar?: boolean
}

/** El botón "Cambiar" del avatar y su menú: subir una imagen, elegir un emoji o usar las iniciales. */
function CambiarCara({
  emoji,
  alSubir,
  alEmoji,
  alIniciales,
}: {
  emoji: string | null
  alSubir: () => void
  alEmoji: (e: string) => void
  alIniciales: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [pagina, setPagina] = useState<'menu' | 'emojis'>('menu')
  const grilla = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) setPagina('menu')
  }, [abierto])
  useEffect(() => {
    if (pagina !== 'emojis') return
    const g = grilla.current
    ;(g?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? g?.querySelector<HTMLButtonElement>('button'))?.focus()
  }, [pagina])
  return (
    <Desplegable
      abierto={abierto}
      alCambiar={setAbierto}
      lado="bottom-start"
      ancho={pagina === 'emojis' ? 320 : 220}
      className="menu cambiar-cara"
      disparador={(p) => (
        <button type="button" className="formulario-proyecto__cambiar" aria-label="Cambiar la foto o el emoji" data-tip="Cambiar" {...p}>
          <Camera size={15} />
        </button>
      )}
    >
      {(cerrar) =>
        pagina === 'menu' ? (
          <div className="menu__lista" role="menu">
            <button
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                cerrar()
                alSubir()
              }}
            >
              <span className="menu__icono">
                <ImageUp size={15} />
              </span>
              <span className="menu__texto">Subir una imagen…</span>
            </button>
            <button type="button" role="menuitem" className="menu__item" onClick={() => setPagina('emojis')}>
              <span className="menu__icono">
                <Smile size={15} />
              </span>
              <span className="menu__texto">Elegir un emoji</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                cerrar()
                alIniciales()
              }}
            >
              <span className="menu__icono">
                <CaseSensitive size={16} />
              </span>
              <span className="menu__texto">Usar las iniciales</span>
            </button>
          </div>
        ) : (
          <div className="cambiar-cara__emojis">
            <div className="cambiar-cara__cabecera">
              <button type="button" className="boton-icono boton-icono--chico" onClick={() => setPagina('menu')} aria-label="Volver">
                <ArrowLeft size={15} />
              </button>
              <b>Elegí un emoji</b>
            </div>
            <div
              ref={grilla}
              className="cambiar-cara__grilla"
              role="group"
              aria-label="Emojis"
              onKeyDown={(e) => {
                const paso = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 } as Record<string, number>)[e.key]
                if (!paso) return
                const botones = [...e.currentTarget.querySelectorAll('button')]
                const i = botones.indexOf(document.activeElement as HTMLButtonElement)
                if (i < 0) return
                e.preventDefault()
                botones[Math.min(botones.length - 1, Math.max(0, i + paso))]?.focus()
              }}
            >
              {EMOJIS_PROYECTO.map((x) => (
                <button
                  key={x}
                  type="button"
                  className={`cambiar-cara__emoji${x === emoji ? ' cambiar-cara__emoji--elegido' : ''}`}
                  aria-pressed={x === emoji}
                  aria-label={x}
                  onClick={() => {
                    cerrar()
                    alEmoji(x)
                  }}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
        )
      }
    </Desplegable>
  )
}

export function FormularioProyecto({ modo, proyecto, alTerminar, alCancelar, enfocar = true }: PropsFormularioProyecto) {
  // Lo que había al abrir: la vista previa del color cambia el proyecto de la tienda, pero no lo que se compara.
  const [base] = useState(proyecto)
  const editar = modo === 'editar' && !!base
  const proyectos = useTienda((s) => s.proyectos)
  const [nombre, setNombre] = useState(base?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(base?.descripcion ?? '')
  // Al crear, un color al azar entre los vivos (los primeros 8).
  const [color, setColor] = useState<Color>(() => base?.color ?? COLORES[Math.floor(Math.random() * 8)]!.id)
  const [repo, setRepo] = useState(base?.repoGithub ?? '')
  const [repoTocado, setRepoTocado] = useState(false)
  const [prefijo, setPrefijo] = useState(base?.prefijo ?? '')
  const [prefijoTocado, setPrefijoTocado] = useState(false)
  const [cara, setCara] = useState<Cara>({ tipo: 'igual' })
  const [arrastrando, setArrastrando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  // El primer tablero del proyecto nuevo: de fábrica «Tablero» (solo Kanban); después se le suman vistas desde su menú.
  const [tipoTablero, setTipoTablero] = useState<TipoTablero>(TIPO_DE_FABRICA)
  const archivo = useRef<HTMLInputElement>(null)
  const campoNombre = useRef<HTMLInputElement>(null)

  // La vista previa del color en la barra lateral: si se cierra sin guardar, vuelve el de antes. En el diálogo, apenas
  // empieza a cerrarse (useIsPresent), no al terminar la animación; fuera de un AnimatePresence, al desmontarse.
  const guardado = useRef(false)
  const colorVisto = useRef(color)
  const restaurarColor = () => {
    if (!editar || guardado.current || colorVisto.current === base!.color) return
    colorVisto.current = base!.color
    useTienda.getState().ponerProyectoLocal(base!.id, { color: base!.color })
  }
  const presente = useIsPresent()
  useEffect(() => {
    if (!presente) restaurarColor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presente])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => restaurarColor(), [])
  const elegirColor = (c: Color) => {
    setColor(c)
    colorVisto.current = c
    if (editar) useTienda.getState().ponerProyectoLocal(base!.id, { color: c })
  }

  // La URL de objeto de la foto elegida se libera al cambiarla o al cerrar.
  const urlFoto = cara.tipo === 'foto' ? cara.url : null
  useEffect(() => () => void (urlFoto && URL.revokeObjectURL(urlFoto)), [urlFoto])

  useEffect(() => {
    if (!enfocar) return
    const c = campoNombre.current
    if (!c) return
    c.focus()
    c.setSelectionRange(c.value.length, c.value.length)
  }, [enfocar])

  const usarArchivo = async (f: File | null | undefined) => {
    if (!f) return
    try {
      const blob = await recortarCuadrada(f, 256)
      setCara({ tipo: 'foto', blob, url: URL.createObjectURL(blob) })
    } catch (e) {
      avisar({ texto: e instanceof ErrorImagen ? e.message : 'No se pudo usar esa imagen.', tipo: 'error' })
    }
  }

  // Pegar una imagen con el formulario abierto.
  useEffect(() => {
    const alPegar = (e: ClipboardEvent) => {
      const f = imagenDe(e.clipboardData)
      if (!f) return
      e.preventDefault()
      void usarArchivo(f)
    }
    window.addEventListener('paste', alPegar)
    return () => window.removeEventListener('paste', alPegar)
  }, [])

  // Lo que se ve en el avatar: lo elegido, o lo que ya tenía.
  const vista = {
    nombre: nombre.trim(),
    color,
    imagen: cara.tipo === 'foto' ? cara.url : cara.tipo === 'igual' ? (base?.imagen ?? null) : null,
    emoji: cara.tipo === 'emoji' ? cara.emoji : cara.tipo === 'igual' ? (base?.emoji ?? null) : null,
  }

  const repoN = normalizarRepo(repo)
  const errorRepo = repoN && !REPO_VALIDO.test(repoN) ? 'Tiene que ser usuario/repo' : null
  const prefijoFinal = editar ? base!.prefijo : prefijo || prefijoDe(nombre)
  const errorPrefijo = editar
    ? null
    : prefijoFinal && !/^[A-Z]/.test(prefijoFinal)
      ? 'Tiene que empezar con una letra'
      : prefijoFinal && proyectos.some((p) => p.prefijo === prefijoFinal)
        ? `Ya hay un proyecto con ${prefijoFinal}`
        : null

  // Qué cambió (al editar).
  const cambiosCara = (): { emoji?: string | null; imagen?: null } => {
    if (!editar) return {}
    const p = base!
    if (cara.tipo === 'emoji') return { ...(cara.emoji !== p.emoji ? { emoji: cara.emoji } : {}), ...(p.imagen ? { imagen: null } : {}) }
    if (cara.tipo === 'iniciales') return { ...(p.emoji ? { emoji: null } : {}), ...(p.imagen ? { imagen: null } : {}) }
    return {}
  }
  const cambios = (() => {
    if (!editar) return {}
    const p = base!
    return {
      ...(nombre.trim() !== p.nombre ? { nombre: nombre.trim() } : {}),
      ...(descripcion.trim() !== p.descripcion ? { descripcion: descripcion.trim() } : {}),
      ...(color !== p.color ? { color } : {}),
      ...((repoN || null) !== (p.repoGithub ?? null) ? { repoGithub: repoN || null } : {}),
      ...cambiosCara(),
    }
  })()
  const cambio = !editar || Object.keys(cambios).length > 0 || cara.tipo === 'foto'
  const valido = !!nombre.trim() && !errorRepo && !errorPrefijo && (editar || !!prefijoFinal)

  const enviar = async () => {
    setRepoTocado(true)
    if (!valido || !cambio || enviando) return
    setEnviando(true)
    const tienda = useTienda.getState()
    try {
      if (editar) {
        const p = base!
        let ok = true
        if (Object.keys(cambios).length) ok = !!(await tienda.actualizarProyecto(p.id, cambios))
        if (ok && cara.tipo === 'foto') {
          ok = !!(await tienda.subirImagenProyecto(p.id, cara.blob))
          // Si no subió, vuelve la de antes (el aviso ya lo dio la tienda).
          if (!ok) setCara({ tipo: 'igual' })
        }
        if (!ok) return
      } else {
        const p = await api.crearProyecto({
          nombre: nombre.trim(),
          prefijo: prefijoFinal,
          color,
          repoGithub: repoN || null,
          descripcion: descripcion.trim(),
          emoji: cara.tipo === 'emoji' ? cara.emoji : null,
          tipo: tipoTablero,
        })
        if (cara.tipo === 'foto') await api.subirImagenProyecto(p.id, cara.blob).catch(avisarError)
        useTienda.setState({ proyectos: await api.proyectos() })
        irA({ prefijo: p.prefijo, slug: p.tableros[0]?.slug ?? null, vista: vistaInicial(p.tableros[0]?.vistas ?? VISTAS_DEL_TIPO[tipoTablero]), tarjeta: null })
        avisar({ texto: `Proyecto ${p.nombre} creado (${p.prefijo})`, tipo: 'ok' })
      }
      guardado.current = true
      alTerminar()
    } catch (e) {
      avisarError(e)
    } finally {
      setEnviando(false)
    }
  }

  const archivar = async () => {
    restaurarColor()
    guardado.current = true
    alTerminar()
    await useTienda.getState().archivarProyecto(base!.id)
  }

  return (
    <form
      className={`formulario-proyecto${arrastrando ? ' formulario-proyecto--soltar' : ''}`}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void enviar()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault()
          void enviar()
        } else if ((e.target as HTMLElement).tagName === 'INPUT') setRepoTocado(true) // con el botón apagado, Enter no envía: que se vea por qué
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!arrastrando) setArrastrando(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastrando(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setArrastrando(false)
        const f = imagenDe(e.dataTransfer)
        if (f) void usarArchivo(f)
        else avisar({ texto: 'Soltá una imagen PNG, JPG, WebP o GIF.', tipo: 'error' })
      }}
    >
      <div className="formulario-proyecto__arriba">
        <div className="formulario-proyecto__cara">
          {vista.imagen || vista.emoji || vista.nombre ? (
            <AvatarProyecto proyecto={vista} tam={72} />
          ) : (
            <span
              className="avatar-proyecto avatar-proyecto--sello formulario-proyecto__vacio"
              aria-hidden
              style={{
                width: 72,
                height: 72,
                borderRadius: 23,
                background: `linear-gradient(140deg, var(--e-${color}-s), color-mix(in srgb, var(--e-${color}-s) 78%, #000))`,
              }}
            >
              <ImagePlus size={26} />
            </span>
          )}
          {arrastrando && (
            <span className="formulario-proyecto__soltar" aria-hidden>
              <ImageUp size={22} />
            </span>
          )}
          <CambiarCara
            emoji={vista.imagen ? null : vista.emoji}
            alSubir={() => archivo.current?.click()}
            alEmoji={(x) => setCara({ tipo: 'emoji', emoji: x })}
            alIniciales={() => setCara({ tipo: 'iniciales' })}
          />
          <input
            ref={archivo}
            type="file"
            accept={TIPOS_IMAGEN.join(',')}
            hidden
            onChange={(e) => {
              void usarArchivo(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        <label className="campo-etiquetado formulario-proyecto__nombre">
          <span>Nombre</span>
          <input
            ref={campoNombre}
            className="campo"
            value={nombre}
            maxLength={LARGO_NOMBRE}
            placeholder="Por ejemplo: Hotel City"
            aria-required
            onChange={(e) => {
              setNombre(e.target.value)
              if (!editar && !prefijoTocado) setPrefijo(prefijoDe(e.target.value))
            }}
          />
          <small>{arrastrando ? 'Soltá la imagen para usarla de foto' : 'La foto se cambia con la cámara, o soltando o pegando una imagen'}</small>
        </label>
      </div>

      <label className="campo-etiquetado">
        <span className="campo-etiquetado__fila">
          <span>Descripción (opcional)</span>
          {descripcion.length > AVISO_DESCRIPCION && (
            <span className={`contador${descripcion.length >= LARGO_DESCRIPCION ? ' contador--lleno' : ''}`}>
              {descripcion.length}/{LARGO_DESCRIPCION}
            </span>
          )}
        </span>
        <textarea
          className="campo campo--area"
          rows={3}
          value={descripcion}
          maxLength={LARGO_DESCRIPCION}
          placeholder="De qué se trata, en una o dos líneas"
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </label>

      <div className="campo-etiquetado">
        <span id="color-proyecto">Color</span>
        <div className="portadas formulario-proyecto__colores" role="radiogroup" aria-labelledby="color-proyecto">
          {COLORES.map((c) => (
            <button
              type="button"
              key={c.id}
              role="radio"
              aria-checked={color === c.id}
              className={`portadas__color${color === c.id ? ' portadas__color--activa' : ''}`}
              style={{ background: `var(--e-${c.id}-s)` }}
              onClick={() => elegirColor(c.id)}
              aria-label={c.nombre}
              data-tip={c.nombre}
            />
          ))}
        </div>
      </div>

      <label className="campo-etiquetado">
        <span>Repo de GitHub (opcional)</span>
        <span className="campo-con-boton">
          <input
            className={`campo mono${repoTocado && errorRepo ? ' campo--error' : ''}`}
            value={repo}
            placeholder="usuario/repo"
            spellCheck={false}
            aria-invalid={repoTocado && !!errorRepo}
            aria-describedby="repo-ayuda"
            onChange={(e) => setRepo(e.target.value)}
            onPaste={(e) => {
              const t = e.clipboardData.getData('text')
              if (!t || imagenDe(e.clipboardData)) return
              e.preventDefault()
              setRepo(normalizarRepo(t))
              setRepoTocado(true)
            }}
            onBlur={() => {
              setRepo(normalizarRepo(repo))
              setRepoTocado(true)
            }}
          />
          {repoN && !errorRepo && (
            <a
              className="campo-con-boton__boton"
              href={`https://github.com/${repoN}`}
              target="_blank"
              rel="noreferrer"
              aria-label="Abrir el repo en GitHub"
              data-tip="Abrir en GitHub"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </span>
        <small id="repo-ayuda" className={repoTocado && errorRepo ? 'campo-etiquetado__error' : undefined} aria-live="polite">
          {repoTocado && errorRepo ? errorRepo : 'Podés pegar la dirección entera'}
        </small>
      </label>
      <div className="campo-etiquetado">
        <label htmlFor="prefijo-proyecto">Prefijo de las claves</label>
        <div className="formulario-proyecto__prefijo">
          <input
            id="prefijo-proyecto"
            className={`campo mono${errorPrefijo ? ' campo--error' : ''}`}
            value={editar ? base!.prefijo : prefijo}
            maxLength={10}
            disabled={editar}
            aria-invalid={!!errorPrefijo}
            aria-describedby="prefijo-ayuda"
            onChange={(e) => {
              setPrefijoTocado(true)
              setPrefijo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
            }}
          />
          <small id="prefijo-ayuda" className={errorPrefijo ? 'campo-etiquetado__error' : undefined} aria-live="polite">
            {editar ? (
              <>
                El prefijo no se cambia: está en las claves de las tarjetas (<b className="mono">{base!.prefijo}-12</b>) y en las ramas de GitHub.
              </>
            ) : errorPrefijo ? (
              errorPrefijo
            ) : (
              <>
                Las tarjetas se van a llamar <b className="mono">{prefijoFinal || 'XX'}-1</b>, <b className="mono">{prefijoFinal || 'XX'}-2</b>…
              </>
            )}
          </small>
        </div>
      </div>

      {!editar && (
        <div className="campo-etiquetado">
          <span id="tipo-primer-tablero">Primer tablero</span>
          <ElegirTipoTablero compacto valor={tipoTablero} alCambiar={setTipoTablero} etiquetaId="tipo-primer-tablero" />
        </div>
      )}

      {confirmar ? (
        <div className="formulario-proyecto__confirmar" role="alertdialog" aria-label={`Archivar ${base!.nombre}`}>
          <span>
            ¿Archivar <b>{base!.nombre}</b>? Lo podés restaurar después.
          </span>
          <button type="button" className="boton boton--rojo" autoFocus onClick={() => void archivar()}>
            Archivar
          </button>
          <button type="button" className="boton" onClick={() => setConfirmar(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <div className="dialogo__pie formulario-proyecto__pie">
          {editar && (
            <button type="button" className="boton boton--fantasma boton--peligro formulario-proyecto__archivar" onClick={() => setConfirmar(true)}>
              Archivar proyecto
            </button>
          )}
          <span className="formulario-proyecto__espacio" />
          <button type="button" className="boton" onClick={alCancelar}>
            Cancelar
          </button>
          <button type="submit" className="boton boton--primario" disabled={!valido || !cambio || enviando}>
            {enviando && <Girando tam={14} />}
            {editar ? 'Guardar cambios' : 'Crear proyecto'}
          </button>
        </div>
      )}
    </form>
  )
}
