// Inspector · pestaña Código (plan 6.6): las reglas que le aplican a la capa (de la que más manda a la que menos, con su
// archivo y línea), los valores calculados, el HTML y, en los marcos propios, editar el CSS del marco y el HTML de la capa
// (el servidor sanea; si rechaza algo, el mensaje queda debajo y no se pierde lo escrito).
import { Copy, Pencil } from 'lucide-react'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { PROPIEDADES_CALCULADAS } from '../../../../../compartido/diseno/reglas'
import { ErrorApi } from '../../../estado/api'
import { useDiseno } from '../estado'
import { copiar, paraPersonas, Seccion } from '../ui'
import { useDetalle } from './useDetalle'

// ───────── resaltado mínimo (propiedad, valor, comentario, selector) ─────────

export function resaltarCss(css: string): ReactNode[] {
  const r: ReactNode[] = []
  const re = /(\/\*[\s\S]*?\*\/)|([^{};]+)(\{)|([\w-]+)(\s*:\s*)([^;{}]*)(;?)|(\})/g
  let ultimo = 0
  let k = 0
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (m.index > ultimo) r.push(css.slice(ultimo, m.index))
    if (m[1]) r.push(<span key={k++} className="dz-cod-com">{m[1]}</span>)
    else if (m[2] !== undefined && m[3]) {
      r.push(<span key={k++} className="dz-cod-sel">{m[2]}</span>, m[3])
    } else if (m[4]) {
      r.push(<span key={k++} className="dz-cod-prop">{m[4]}</span>, m[5], <span key={k++} className="dz-cod-val">{m[6]}</span>, m[7])
    } else if (m[8]) r.push(m[8])
    ultimo = re.lastIndex
  }
  if (ultimo < css.length) r.push(css.slice(ultimo))
  return r
}

export function resaltarHtml(html: string): ReactNode[] {
  const r: ReactNode[] = []
  const re = /(<!--[\s\S]*?-->)|(<\/?)([\w-]+)|([\w:-]+)(=)("[^"]*"|'[^']*')|(\/?>)/g
  let ultimo = 0
  let k = 0
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index > ultimo) r.push(html.slice(ultimo, m.index))
    if (m[1]) r.push(<span key={k++} className="dz-cod-com">{m[1]}</span>)
    else if (m[2]) r.push(m[2], <span key={k++} className="dz-cod-sel">{m[3]}</span>)
    else if (m[4]) r.push(<span key={k++} className="dz-cod-prop">{m[4]}</span>, m[5], <span key={k++} className="dz-cod-val">{m[6]}</span>)
    else if (m[7]) r.push(m[7])
    ultimo = re.lastIndex
  }
  if (ultimo < html.length) r.push(html.slice(ultimo))
  return r
}

/** HTML con sangría (una etiqueta por línea), hasta 200 líneas. */
export function sangrarHtml(html: string, max = 200): string {
  const partes = html.replace(/>\s*</g, '>\n<').split('\n')
  const salida: string[] = []
  let nivel = 0
  for (const p of partes) {
    const cierra = /^<\//.test(p)
    const abre = /^<[\w-]+[^>]*[^/]>$/.test(p) && !/^<(img|br|hr|input|meta|link|source|wbr)\b/i.test(p) && !/<\/[\w-]+>$/.test(p)
    if (cierra) nivel = Math.max(0, nivel - 1)
    salida.push('  '.repeat(nivel) + p)
    if (abre) nivel++
    if (salida.length >= max) {
      salida.push('  …')
      break
    }
  }
  return salida.join('\n')
}

function Bloque({ cabecera, sub, codigo, lenguaje = 'css' }: { cabecera: ReactNode; sub?: ReactNode; codigo: string; lenguaje?: 'css' | 'html' }) {
  return (
    <div className="dz-bloque">
      <div className="dz-bloque__cab">
        <span className="dz-bloque__origen">{cabecera}</span>
        <button className="dz-bloque__copiar" onClick={() => void copiar(codigo)} aria-label="Copiar el bloque" data-tip="Copiar">
          <Copy size={12} />
        </button>
      </div>
      {sub && <div className="dz-bloque__sub">{sub}</div>}
      <pre className="dz-codigo">{lenguaje === 'css' ? resaltarCss(codigo) : resaltarHtml(codigo)}</pre>
    </div>
  )
}

export function Codigo({ marco, capa }: { marco: string; capa: string | null }) {
  const resumen = useDiseno((s) => s.marcos.find((m) => m.id === marco))
  const completo = useDiseno((s) => s.completos[marco])
  const { vivo, refrescar } = useDetalle(marco, capa)
  const [editando, setEditando] = useState<'css' | 'html' | null>(null)
  useEffect(() => setEditando(null), [marco, capa])
  if (!resumen) return null
  const editable = resumen.origen === 'propio' && !resumen.bloqueado
  if (editando && completo)
    return (
      <Editor
        titulo={editando === 'css' ? 'CSS del marco' : 'HTML de la capa'}
        inicial={editando === 'css' ? completo.marco.css : vivo ? limpiarHtmlCapa(vivo.el.outerHTML) : ''}
        alCancelar={() => setEditando(null)}
        alAplicar={async (texto) => {
          const s = useDiseno.getState()
          const r =
            editando === 'css'
              ? await s.editarDirecto(marco, [{ op: 'css', css: texto, como: 'reemplazar' }], 'editar el CSS del marco')
              : await s.editarDirecto(marco, [{ op: 'reemplazar', capa: capa!, html: texto }], 'editar el HTML de la capa')
          if (r === true) {
            setEditando(null)
            refrescar()
          }
          return r
        }}
      />
    )

  const reglas = vivo?.detalle.reglas ?? []
  const todo = reglas.map((r) => `/* ${r.origen}${r.condicion ? ' · ' + r.condicion : ''} */\n${r.selector} {\n  ${r.declaraciones.split('\n').join('\n  ')}\n}`).join('\n\n')
  return (
    <>
      {editable && (
        <div className="dz-codigo-acciones">
          <button className="boton boton--chico" onClick={() => setEditando('css')} disabled={!completo}>
            <Pencil size={13} /> Editar el CSS del marco
          </button>
          {capa && (
            <button className="boton boton--chico" onClick={() => setEditando('html')} disabled={!vivo}>
              <Pencil size={13} /> Editar el HTML de la capa
            </button>
          )}
        </div>
      )}
      {!vivo && <p className="dz-inota">Leyendo el marco…</p>}
      {vivo && (
        <>
          <Seccion
            titulo={`Reglas que le aplican (${reglas.length})`}
            accion={
              reglas.length > 0 && (
                <button className="dz-bloque__copiar" onClick={() => void copiar(todo)} data-tip="Copiar todo" aria-label="Copiar todas las reglas">
                  <Copy size={12} />
                </button>
              )
            }
          >
            {reglas.length === 0 && <p className="dz-inota">Ninguna regla le aplica: todo sale de lo que hereda.</p>}
            {reglas.slice(0, 40).map((r, i) => (
              <Bloque
                key={i}
                cabecera={
                  <>
                    <span className="dz-bloque__archivo">{r.origen}</span>
                    {r.pseudo && <span className="dz-bloque__pseudo">{r.pseudo}</span>}
                  </>
                }
                sub={r.condicion}
                codigo={`${r.selector} {\n  ${r.declaraciones.split('\n').join('\n  ')}\n}`}
              />
            ))}
            {reglas.length > 40 && <p className="dz-inota">y {reglas.length - 40} reglas más (con menos peso).</p>}
          </Seccion>
          <Seccion titulo="Calculado">
            <dl className="dz-calculado">
              {PROPIEDADES_CALCULADAS.filter((p) => vivo.detalle.calculado[p] !== undefined)
                .slice(0, capa ? 16 : 10)
                .map((p) => (
                  <Fragment key={p}>
                    <dt>{p}</dt>
                    <dd>
                      <button className="dz-calculado__valor" onClick={() => void copiar(`${p}: ${vivo.detalle.calculado[p]};`)} title="Copiar">
                        {vivo.detalle.calculado[p]}
                      </button>
                    </dd>
                  </Fragment>
                ))}
            </dl>
          </Seccion>
          <Seccion titulo="HTML">
            <Bloque cabecera={capa ? 'La capa' : 'El marco'} codigo={sangrarHtml(limpiarHtmlCapa(capa ? vivo.detalle.html : vivo.el.innerHTML))} lenguaje="html" />
          </Seccion>
          {!capa && completo && completo.marco.css.trim() && (
            <Seccion titulo="CSS del marco">
              <Bloque cabecera="Este marco" codigo={completo.marco.css.trim()} />
            </Seccion>
          )}
        </>
      )}
    </>
  )
}

/** Saca del HTML vivo lo que agrega Telar (edición en el lugar). */
function limpiarHtmlCapa(html: string) {
  return html.replace(/\s(contenteditable|spellcheck)="[^"]*"/g, '')
}

function Editor({ titulo, inicial, alAplicar, alCancelar }: { titulo: string; inicial: string; alAplicar: (t: string) => Promise<true | string>; alCancelar: () => void }) {
  const [texto, setTexto] = useState(inicial)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const aplicar = async () => {
    setGuardando(true)
    const r = await alAplicar(texto)
    setGuardando(false)
    setError(r === true ? null : paraPersonas(r))
  }
  return (
    <div className="dz-editor">
      <p className="dz-isec__titulo">{titulo}</p>
      <textarea
        className="dz-editor__campo"
        value={texto}
        spellCheck={false}
        autoFocus
        aria-label={titulo}
        onChange={(e) => setTexto(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void aplicar()
          }
          if (e.key === 'Escape') alCancelar()
          if (e.key === 'Tab') {
            e.preventDefault()
            const t = e.currentTarget
            const i = t.selectionStart
            setTexto(texto.slice(0, i) + '  ' + texto.slice(t.selectionEnd))
            requestAnimationFrame(() => (t.selectionStart = t.selectionEnd = i + 2))
          }
        }}
      />
      {error && (
        <pre className="dz-editor__error" role="alert">
          {error}
        </pre>
      )}
      <div className="dz-editor__botones">
        <button className="boton boton--fantasma boton--chico" onClick={alCancelar}>
          Cancelar
        </button>
        <button className="boton boton--primario boton--chico" onClick={() => void aplicar()} disabled={guardando} data-tecla="$mod+Enter">
          Aplicar
        </button>
      </div>
    </div>
  )
}

export const esErrorApi = (e: unknown): e is ErrorApi => e instanceof ErrorApi
