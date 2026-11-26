// Inspeccionar en el teléfono (el inspector de la PC, para leer): se toca algo del marco y la hoja dice qué es, cuánto
// mide y dónde está, con qué letra, de qué color y con qué reglas CSS (con su archivo y su línea cuando el marco viene del
// código). Para mirar las pantallas del juego en el teléfono y saber de qué están hechas. Un toque en un valor lo copia.
import { Copy } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { detalleDeElemento, type DetalleCapa } from '../../../../../compartido/diseno/reglas'
import { avisar } from '../../../estado/avisos'
import { HojaInferior } from '../../../movil/ui/HojaInferior'
import { useDiseno } from '../estado'
import { colorLegible, primeraFamilia } from '../ui'
import { copiarTexto } from './compartir'
import { useDisenoMovil } from './estado'
import { useHojaDe, useUltimo } from './Hojas'
import { capaDelVisor, documentoDelVisor } from './Visor'

export function HojaCapa() {
  const h = useHojaDe('capa')
  const ultimo = useUltimo(h)
  const revision = useDiseno((s) => (ultimo ? s.completos[ultimo.marco]?.marco.revision : undefined))
  const [d, setD] = useState<{ detalle: DetalleCapa; nombre: string; texto: string | null } | null>(null)
  const [pestana, setPestana] = useState<'diseno' | 'codigo'>('diseno')

  useEffect(() => {
    if (!h) return
    const el = h.capa ? capaDelVisor(h.capa) : (documentoDelVisor()?.body ?? null)
    if (!el) return setD(null)
    try {
      const detalle = detalleDeElemento(el, { maxHtml: 4000 })
      const etiqueta = el.tagName.toLowerCase()
      const clase = el.classList[0]
      const nombre = h.capa ? el.getAttribute('data-nombre') || (clase ? `${etiqueta}.${clase}` : etiqueta) : 'El marco entero'
      const soloTexto = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()) ? (el.textContent ?? '').trim().slice(0, 160) : null
      setD({ detalle, nombre, texto: soloTexto })
    } catch {
      setD(null)
    }
  }, [h?.marco, h?.capa, revision])

  const cerrar = () => useDisenoMovil.getState().set({ hoja: null, resaltada: null })
  return (
    <HojaInferior abierta={!!h} alCerrar={cerrar} titulo={d?.nombre ?? 'Capa'} className="dzm-hoja dzm-hoja--capa">
      {d ? (
        <div className="dzm-capa">
          <div className="dzm-segmentos dzm-segmentos--ancho" role="tablist" aria-label="Diseño o código">
            {(
              [
                ['diseno', 'Diseño'],
                ['codigo', 'Código'],
              ] as const
            ).map(([id, nombre]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={pestana === id}
                className={`dzm-segmentos__opcion${pestana === id ? ' dzm-segmentos__opcion--activa' : ''}`}
                onClick={() => setPestana(id)}
              >
                {nombre}
              </button>
            ))}
          </div>
          {pestana === 'diseno' ? <DisenoDeCapa d={d.detalle} texto={d.texto} /> : <CodigoDeCapa d={d.detalle} />}
        </div>
      ) : (
        <p className="dzm-nota dzm-capa__vacia">No pude leer esa capa: esperá a que el marco termine de dibujarse y tocala de nuevo.</p>
      )}
    </HojaInferior>
  )
}

async function copiar(v: string) {
  const ok = await copiarTexto(v)
  avisar(ok ? { texto: 'Copiado', tipo: 'ok', duracion: 1400 } : { texto: 'No pude copiar: el navegador no dio permiso.', tipo: 'error' })
}

function Valor({ etiqueta, valor, copia, color, mono = true }: { etiqueta: string; valor: ReactNode; copia?: string; color?: string; mono?: boolean }) {
  return (
    <button type="button" className="dzm-valor" onClick={() => copia && void copiar(copia)} disabled={!copia} aria-label={copia ? `${etiqueta}: ${copia}. Copiar` : undefined}>
      <span className="dzm-valor__etiqueta">{etiqueta}</span>
      <span className={`dzm-valor__dato${mono ? ' dzm-valor__dato--mono' : ''}`}>
        {color && <span className="dzm-muestra" style={{ background: color }} aria-hidden />}
        <span className="dzm-valor__texto">{valor}</span>
      </span>
      {copia && <Copy size={14} className="dzm-valor__copiar" aria-hidden />}
    </button>
  )
}

const px = (v?: string) => (v ? v.replace(/(\d+\.\d{2})\d+px/g, '$1px') : v)

function DisenoDeCapa({ d, texto }: { d: DetalleCapa; texto: string | null }) {
  const c = d.calculado
  const o = d.originales
  const [x, y, ancho, alto] = d.caja
  const tieneTexto = !!texto || !!c['font-family']
  const fondo = c['background-color'] && c['background-color'] !== 'rgba(0, 0, 0, 0)' ? c['background-color'] : null
  // Lo que vale lo de siempre no dice nada: un contorno o un borde de 0 px, la opacidad entera.
  const contorno = c['-webkit-text-stroke'] && !/^0px\b/.test(c['-webkit-text-stroke']) ? c['-webkit-text-stroke'] : null
  const borde = c.border && !/^0px\b/.test(c.border) ? c.border : null
  const opacidad = c.opacity && c.opacity !== '1' ? c.opacity : null
  const conOriginal = (p: string, v?: string) => (v && o[p] && o[p] !== v && !/^#|^rgb/.test(o[p]!) ? `${px(v)} · ${o[p]}` : px(v))
  return (
    <>
      <section className="dzm-capa__seccion">
        <h3 className="dzm-subtitulo">Medidas</h3>
        <div className="dzm-valores dzm-valores--dos">
          <Valor etiqueta="Ancho" valor={`${ancho} px`} copia={`${ancho}px`} />
          <Valor etiqueta="Alto" valor={`${alto} px`} copia={`${alto}px`} />
          <Valor etiqueta="X" valor={`${x} px`} copia={`${x}px`} />
          <Valor etiqueta="Y" valor={`${y} px`} copia={`${y}px`} />
        </div>
      </section>
      {tieneTexto && (
        <section className="dzm-capa__seccion">
          <h3 className="dzm-subtitulo">Texto</h3>
          {texto && <p className="dzm-capa__texto">«{texto}»</p>}
          <div className="dzm-valores">
            {c['font-family'] && <Valor etiqueta="Letra" valor={primeraFamilia(c['font-family'])} copia={c['font-family']} mono={false} />}
            {c['font-weight'] && <Valor etiqueta="Peso" valor={c['font-weight']} copia={c['font-weight']} />}
            {c['font-size'] && <Valor etiqueta="Tamaño" valor={conOriginal('font-size', c['font-size'])} copia={o['font-size'] ?? c['font-size']} />}
            {c['line-height'] && <Valor etiqueta="Interlineado" valor={px(c['line-height'])} copia={c['line-height']} />}
            {c['letter-spacing'] && <Valor etiqueta="Espaciado" valor={px(c['letter-spacing'])} copia={c['letter-spacing']} />}
            {c.color && <Valor etiqueta="Color" valor={colorLegible(c.color)} copia={o.color ?? colorLegible(c.color)} color={c.color} />}
            {contorno && <Valor etiqueta="Contorno" valor={contorno} copia={contorno} />}
            {c['text-shadow'] && <Valor etiqueta="Sombra" valor={c['text-shadow']} copia={c['text-shadow']} />}
            {c['text-transform'] && <Valor etiqueta="Mayúsculas" valor={c['text-transform']} copia={c['text-transform']} />}
            {c['text-align'] && <Valor etiqueta="Alineación" valor={c['text-align']} copia={c['text-align']} />}
          </div>
        </section>
      )}
      {(fondo || c['background-image'] || c['border-radius'] || borde || c['box-shadow'] || opacidad) && (
        <section className="dzm-capa__seccion">
          <h3 className="dzm-subtitulo">Relleno y borde</h3>
          <div className="dzm-valores">
            {fondo && <Valor etiqueta="Fondo" valor={colorLegible(fondo)} copia={o['background-color'] ?? colorLegible(fondo)} color={fondo} />}
            {c['background-image'] && <Valor etiqueta="Imagen" valor={c['background-image'].slice(0, 80)} copia={c['background-image']} />}
            {c['border-radius'] && <Valor etiqueta="Radio" valor={conOriginal('border-radius', c['border-radius'])} copia={o['border-radius'] ?? c['border-radius']} />}
            {borde && <Valor etiqueta="Borde" valor={borde} copia={borde} />}
            {c['box-shadow'] && <Valor etiqueta="Sombra" valor={c['box-shadow']} copia={c['box-shadow']} />}
            {opacidad && <Valor etiqueta="Opacidad" valor={opacidad} copia={opacidad} />}
          </div>
        </section>
      )}
      <section className="dzm-capa__seccion">
        <h3 className="dzm-subtitulo">Disposición</h3>
        <div className="dzm-valores">
          {c.display && <Valor etiqueta="Display" valor={c.display} copia={c.display} />}
          {c.position && c.position !== 'static' && <Valor etiqueta="Posición" valor={c.position} copia={c.position} />}
          {c['flex-direction'] && <Valor etiqueta="Dirección" valor={c['flex-direction']} copia={c['flex-direction']} />}
          {c['justify-content'] && <Valor etiqueta="Justificar" valor={c['justify-content']} copia={c['justify-content']} />}
          {c['align-items'] && <Valor etiqueta="Alinear" valor={c['align-items']} copia={c['align-items']} />}
          {c.gap && <Valor etiqueta="Separación" valor={conOriginal('gap', c.gap)} copia={o.gap ?? c.gap} />}
          {c.padding && <Valor etiqueta="Relleno" valor={conOriginal('padding', c.padding)} copia={o.padding ?? c.padding} />}
          {c.margin && <Valor etiqueta="Margen" valor={conOriginal('margin', c.margin)} copia={o.margin ?? c.margin} />}
        </div>
      </section>
    </>
  )
}

function CodigoDeCapa({ d }: { d: DetalleCapa }) {
  const reglas = useMemo(() => d.reglas.slice(0, 40), [d])
  return (
    <>
      {reglas.length === 0 && <p className="dzm-nota">Sin reglas propias: hereda todo de su contenedor.</p>}
      {reglas.map((r, i) => (
        <section key={i} className="dzm-regla">
          <p className="dzm-regla__origen">
            {r.origen}
            {r.condicion ? ` · ${r.condicion}` : ''}
          </p>
          <button type="button" className="dzm-regla__codigo" onClick={() => void copiar(`${r.selector} {\n  ${r.declaraciones.replace(/\n/g, '\n  ')}\n}`)} aria-label={`Copiar la regla ${r.selector}`}>
            <span className="dzm-regla__selector">{r.selector}</span>
            <span className="dzm-regla__decl">{r.declaraciones}</span>
          </button>
        </section>
      ))}
      {d.reglas.length > 40 && <p className="dzm-nota">Y {d.reglas.length - 40} reglas más: en la computadora se ven todas.</p>}
      <section className="dzm-regla">
        <p className="dzm-regla__origen">HTML</p>
        <button type="button" className="dzm-regla__codigo" onClick={() => void copiar(d.html)} aria-label="Copiar el HTML">
          <span className="dzm-regla__decl">{d.html}</span>
        </button>
      </section>
    </>
  )
}
