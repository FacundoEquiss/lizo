// Inspector · pestaña Diseño de un marco o una capa (plan 6.6). Lee el DOM vivo del marco; en los marcos propios los valores
// se editan: el cambio se ve primero en el iframe y a los 250 ms viaja al servidor como operaciones (estado.editar).
import { Copy, CopyPlus, Link, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { claseDeCapa, nombreCapa, nombreDeRuta, type ElementoCapa } from '../../../../../compartido/diseno/capas'
import { propiedadesDe, type ValorProp } from '../../../../../compartido/diseno/documento'
import { crearElemento } from '../../../../../compartido/diseno/html'
import { PREFIJADOS } from '../../../../../compartido/diseno/prefijados'
import { aRgb, normalizarColor } from '../../../../../compartido/diseno/tokens'
import type { DatosActivo, DatosEstiloTexto, DatosPieza, DatosTexto, DatosToken, ItemDiseno, MarcoResumen } from '../../../../../compartido/diseno/tipos'
import type { OperacionMarco } from '../../../../../compartido/diseno/operaciones'
import { avisarError } from '../../../estado/avisos'
import { apiDiseno } from '../api'
import { duplicarSeleccion, quitarSeleccion, selATexto } from '../Diseno'
import { useDiseno } from '../estado'
import { enlaceA, irADiseno } from '../ruta'
import { CampoNumero, colorLegible, copiar, Fila, Interruptor, Muestra, primeraFamilia, Seccion, SelectorColor } from '../ui'
import { Exportar, Revisiones, Tarjetas } from './Extras'
import { useDetalle, type DetalleVivo } from './useDetalle'

const px = (v: string | undefined) => (v ? parseFloat(v) || 0 : 0)

/** "calc(var(--hu) * 19)" → "19 hu"; "calc(19 * var(--nv))" → "19 nv". */
export function enUnidad(original: string | undefined): string | null {
  if (!original) return null
  const a = /calc\(\s*var\(--([\w-]+)\)\s*\*\s*(-?[\d.]+)\s*\)/.exec(original)
  if (a) return `${a[2]} ${a[1]}`
  const b = /calc\(\s*(-?[\d.]+)\s*\*\s*var\(--([\w-]+)\)\s*\)/.exec(original)
  if (b) return `${b[1]} ${b[2]}`
  const c = /^(-?[\d.]+)(cqw|cqh|em|rem|%|vw|vh)$/.exec(original.trim())
  if (c) return `${c[1]} ${c[2]}`
  return null
}

/** Lo que muestra el selector de color: var(--token) si el color sale de un token (o coincide con uno), si no el valor. */
export function valorParaSelector(original: string | undefined, calculado: string, tokens: ItemDiseno[]): string {
  const t = tokenDe(original, calculado, tokens)
  return t ? `var(${(t.datos as DatosToken).css})` : (original ?? calculado)
}

/** El token que corresponde a un valor: el de la expresión original (var(--x)) o, si no, el que tiene el mismo color. */
export function tokenDe(original: string | undefined, calculado: string, tokens: ItemDiseno[]): ItemDiseno<'token'> | null {
  const v = original ? /var\((--[\w-]+)/.exec(original)?.[1] : undefined
  const lista = tokens as ItemDiseno<'token'>[]
  if (v) {
    const t = lista.find((x) => x.datos.css === v)
    if (t) return t
  }
  const c = normalizarColor(calculado)
  if (!c) return null
  return lista.find((x) => x.datos.clase === 'color' && !x.datos.suelto && normalizarColor(x.datos.valor) === c) ?? null
}

function elementoCapa(el: HTMLElement): ElementoCapa {
  let textoPropio = ''
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) textoPropio += n.textContent ?? ''
  return { etiqueta: el.tagName.toLowerCase(), attr: (n) => el.getAttribute(n), textoPropio, texto: el.textContent ?? '', hijosElemento: el.children.length }
}

function disposicion(cs: CSSStyleDeclaration): string | null {
  const gap = px(cs.columnGap) || px(cs.rowGap)
  const alineado = (v: string) =>
    ({ center: 'centrado', 'flex-start': 'al principio', start: 'al principio', 'flex-end': 'al final', end: 'al final', 'space-between': 'repartido', 'space-around': 'repartido', stretch: 'estirado' })[v] ?? v
  if (cs.display.includes('flex')) {
    const dir = cs.flexDirection.startsWith('column') ? 'Columna' : 'Fila'
    return [dir, gap ? `separación ${Math.round(gap)}` : null, cs.justifyContent !== 'normal' ? alineado(cs.justifyContent) : null, cs.alignItems !== 'normal' && cs.alignItems !== 'stretch' ? `${alineado(cs.alignItems)} en el otro eje` : null, cs.flexWrap === 'wrap' ? 'con ajuste' : null]
      .filter(Boolean)
      .join(' · ')
  }
  if (cs.display.includes('grid')) {
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length
    return [`Grilla · ${cols} ${cols === 1 ? 'columna' : 'columnas'}`, gap ? `separación ${Math.round(gap)}` : null].filter(Boolean).join(' · ')
  }
  return null
}

export function DisenoCapa({ marco, capa }: { marco: string; capa: string | null }) {
  const resumen = useDiseno((s) => s.marcos.find((m) => m.id === marco))
  const completo = useDiseno((s) => s.completos[marco])
  const items = useDiseno((s) => s.items)
  const { vivo, refrescar } = useDetalle(marco, capa)
  useEffect(() => {
    const s = useDiseno.getState()
    void s.cargarItems('token')
    void s.cargarItems('fuente')
    void s.cargarItems('estilo_texto')
    void s.cargarItems('activo')
    void s.cargarItems('texto')
  }, [])
  if (!resumen) return null
  const editable = resumen.origen === 'propio' && !resumen.bloqueado
  if (!capa) return <InspectorMarco m={resumen} vivo={vivo} editable={editable} />
  if (!vivo) return <p className="dz-inota">Leyendo la capa…</p>

  const tokens = items.token ?? []
  const { el, cs, detalle, caja } = vivo
  const ec = elementoCapa(el)
  const clase = claseDeCapa(ec)
  const nombre = nombreCapa(ec, new Map((items.activo ?? []).map((a) => [(a.datos as DatosActivo).ruta, a.nombre])))
  const absoluta = cs.position === 'absolute' || cs.position === 'fixed'
  const editar = (ops: OperacionMarco[], etiqueta: string, enDom = true) => useDiseno.getState().editar(marco, ops, { etiqueta, enDom })
  const estilo = (estilos: Record<string, string | null>, etiqueta: string) => {
    for (const [k, v] of Object.entries(estilos)) if (v === null) el.style.removeProperty(k)
    else el.style.setProperty(k, v)
    refrescar()
    void editar([{ op: 'estilo', capa, estilos }], etiqueta)
  }
  const reglaGanadora = detalle.reglas.find((r) => r.origen !== 'En línea')
  const origen = resumen.origen === 'propio' ? 'Propio' : reglaGanadora ? `Viene de ${reglaGanadora.origen}` : 'Viene del código'
  const pieza = el.getAttribute('data-pieza')
  const datosPieza = pieza ? completo?.piezas[pieza] : undefined

  return (
    <>
      <Cabecera
        nombre={nombre}
        clase={pieza ? `Instancia de «${(items.pieza ?? []).find((p) => p.clave === pieza)?.nombre ?? pieza}»` : `Capa · ${NOMBRE_CLASE[clase]}`}
        origen={origen}
        editableNombre={editable ? (n) => void editar([{ op: 'atributo', capa, nombre: 'data-nombre', valor: n || null }], 'renombrar la capa') : undefined}
        acciones={
          <>
            <BotonCab etiqueta="Copiar el enlace" onClick={() => void copiar(enlaceA(useDiseno.getState().pagina?.slug ?? null, selATexto(useDiseno.getState().seleccion)), 'Enlace copiado')}>
              <Link size={14} />
            </BotonCab>
            {editable && (
              <BotonCab etiqueta="Quitar la capa" onClick={() => void quitarSeleccion()}>
                <Trash2 size={14} />
              </BotonCab>
            )}
          </>
        }
      />
      <Seccion titulo="Medidas">
        <div className="dz-medidas">
          <CampoNumero etiqueta="X" valor={caja.x} apagado={!editable || !absoluta} alCambiar={(v) => estilo({ left: `${Math.round(v)}px` }, 'mover la capa')} />
          <CampoNumero etiqueta="Y" valor={caja.y} apagado={!editable || !absoluta} alCambiar={(v) => estilo({ top: `${Math.round(v)}px` }, 'mover la capa')} />
          <CampoNumero etiqueta="An" valor={caja.ancho} min={0} apagado={!editable} alCambiar={(v) => estilo({ width: `${Math.round(v)}px` }, 'cambiar el ancho')} />
          <CampoNumero etiqueta="Al" valor={caja.alto} min={0} apagado={!editable} alCambiar={(v) => estilo({ height: `${Math.round(v)}px` }, 'cambiar el alto')} />
        </div>
        {editable && !absoluta && <p className="dz-inota">A esta capa la acomoda su contenedor. Cambiá sus medidas acá o editá el CSS.</p>}
        {cs.transform !== 'none' && <Fila etiqueta="Transformación" mono copia={cs.transform}>{cs.transform}</Fila>}
        <DiagramaCaja cs={cs} />
      </Seccion>
      <SeccionDisposicion cs={cs} />
      <SeccionRelleno vivo={vivo} tokens={tokens} editable={editable} alCambiar={(v) => estilo({ background: v }, 'cambiar el relleno')} />
      <SeccionBorde vivo={vivo} tokens={tokens} editable={editable} estilo={estilo} />
      <SeccionSombra cs={cs} />
      {(clase === 'texto' || clase === 'campo' || (el.textContent ?? '').trim()) && !pieza && <SeccionTipografia vivo={vivo} items={items} editable={editable} estilo={estilo} />}
      {clase === 'texto' && !pieza && <SeccionTexto el={el} textos={(items.texto ?? []) as ItemDiseno<'texto'>[]} editable={editable} alCambiar={(t) => {
        el.textContent = t
        refrescar()
        void editar([{ op: 'texto', capa, texto: t }], 'editar el texto')
      }} />}
      {el instanceof el.ownerDocument.defaultView!.HTMLImageElement && (
        <SeccionImagen el={el as HTMLImageElement} activos={(items.activo ?? []) as ItemDiseno<'activo'>[]} editable={editable} alCambiar={(src) => void editar([{ op: 'atributo', capa, nombre: 'src', valor: src }], 'reemplazar la imagen', false)} />
      )}
      {pieza && <SeccionPieza el={el} pieza={datosPieza} editable={editable} alCambiar={(valores) => void editar([{ op: 'propiedades', capa, valores }], 'cambiar la pieza', false)} />}
      <Seccion titulo="Opacidad y visibilidad">
        <div className="dz-medidas dz-medidas--2">
          <CampoNumero etiqueta="Op." sufijo="%" valor={Math.round(parseFloat(cs.opacity) * 100)} min={0} max={100} apagado={!editable} alCambiar={(v) => estilo({ opacity: String(Math.round(v) / 100) }, 'cambiar la opacidad')} />
          <label className="dz-visible">
            <span>Visible</span>
            <Interruptor etiqueta="Visible" valor={cs.display !== 'none' && cs.visibility !== 'hidden'} apagado={!editable} alCambiar={(v) => estilo({ display: v ? null : 'none' }, v ? 'mostrar la capa' : 'ocultar la capa')} />
          </label>
        </div>
      </Seccion>
      <Tarjetas objetivo={`marco:${marco}#${capa}`} />
    </>
  )
}

const NOMBRE_CLASE: Record<string, string> = { pieza: 'pieza', instancia: 'instancia', texto: 'texto', imagen: 'imagen', svg: 'dibujo', campo: 'campo', caja: 'caja' }

function BotonCab({ etiqueta, onClick, children }: { etiqueta: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className="boton-icono boton-icono--chico" aria-label={etiqueta} data-tip={etiqueta} onClick={onClick}>
      {children}
    </button>
  )
}

export function Cabecera({ nombre, clase, origen, acciones, editableNombre }: { nombre: string; clase: string; origen: string; acciones?: ReactNode; editableNombre?: (n: string) => void }) {
  const [editando, setEditando] = useState(false)
  const [v, setV] = useState(nombre)
  useEffect(() => setV(nombre), [nombre])
  return (
    <div className="dz-icab">
      <div className="dz-icab__fila">
        {editando && editableNombre ? (
          <input
            className="dz-icab__campo"
            value={v}
            autoFocus
            aria-label="Nombre"
            onChange={(e) => setV(e.currentTarget.value)}
            onBlur={() => {
              setEditando(false)
              if (v.trim() && v !== nombre) editableNombre(v.trim())
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setV(nombre)
                setEditando(false)
              }
            }}
          />
        ) : (
          <p className="dz-icab__nombre" title={nombre} onDoubleClick={() => editableNombre && setEditando(true)}>
            {nombre}
          </p>
        )}
        <span className="dz-icab__acciones">{acciones}</span>
      </div>
      <p className="dz-icab__clase">
        {clase} · <span className="dz-icab__origen">{origen}</span>
      </p>
    </div>
  )
}

/** Diagrama de caja: margen, borde, relleno y contenido, cuatro números por anillo. */
function DiagramaCaja({ cs }: { cs: CSSStyleDeclaration }) {
  const lados = (pre: string, suf = '') => ['top', 'right', 'bottom', 'left'].map((l) => Math.round(px(cs.getPropertyValue(`${pre}-${l}${suf}`))))
  const m = lados('margin')
  const b = lados('border', '-width')
  const p = lados('padding')
  const ancho = Math.round(px(cs.width))
  const alto = Math.round(px(cs.height))
  const n = (v: number) => (v === 0 ? '–' : v)
  return (
    <div className="dz-caja" aria-label="Margen, borde, relleno y contenido">
      <div className="dz-caja__anillo dz-caja__anillo--margen">
        <span className="dz-caja__rotulo">margen</span>
        <span className="dz-caja__n dz-caja__n--arriba">{n(m[0]!)}</span>
        <span className="dz-caja__n dz-caja__n--der">{n(m[1]!)}</span>
        <span className="dz-caja__n dz-caja__n--abajo">{n(m[2]!)}</span>
        <span className="dz-caja__n dz-caja__n--izq">{n(m[3]!)}</span>
        <div className="dz-caja__anillo dz-caja__anillo--borde">
          <span className="dz-caja__rotulo">borde</span>
          <span className="dz-caja__n dz-caja__n--arriba">{n(b[0]!)}</span>
          <span className="dz-caja__n dz-caja__n--der">{n(b[1]!)}</span>
          <span className="dz-caja__n dz-caja__n--abajo">{n(b[2]!)}</span>
          <span className="dz-caja__n dz-caja__n--izq">{n(b[3]!)}</span>
          <div className="dz-caja__anillo dz-caja__anillo--relleno">
            <span className="dz-caja__rotulo">relleno</span>
            <span className="dz-caja__n dz-caja__n--arriba">{n(p[0]!)}</span>
            <span className="dz-caja__n dz-caja__n--der">{n(p[1]!)}</span>
            <span className="dz-caja__n dz-caja__n--abajo">{n(p[2]!)}</span>
            <span className="dz-caja__n dz-caja__n--izq">{n(p[3]!)}</span>
            <div className="dz-caja__contenido">
              {ancho} × {alto}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SeccionDisposicion({ cs }: { cs: CSSStyleDeclaration }) {
  const d = disposicion(cs)
  const pos = cs.position !== 'static' ? cs.position : null
  if (!d && !pos) return null
  return (
    <Seccion titulo="Disposición">
      {d && <Fila etiqueta="Acomoda">{d}</Fila>}
      {pos && (
        <Fila etiqueta="Posición" mono copia={`position: ${pos}`}>
          {pos}
          {pos === 'absolute' && ` · ${Math.round(px(cs.left))}, ${Math.round(px(cs.top))}`}
        </Fila>
      )}
      {cs.zIndex !== 'auto' && <Fila etiqueta="Capa (z)" mono>{cs.zIndex}</Fila>}
    </Seccion>
  )
}

function ValorColor({ valor, original, tokens }: { valor: string; original?: string; tokens: ItemDiseno[] }) {
  const t = tokenDe(original, valor, tokens)
  const legible = colorLegible(valor)
  return (
    <Fila etiqueta="Color" copia={t ? `var(${(t.datos as DatosToken).css})` : legible} mono>
      <Muestra color={valor} />
      {t && <span className="dz-token">{(t.datos as DatosToken).css}</span>}
      <span>{legible}</span>
    </Fila>
  )
}

function SeccionRelleno({ vivo, tokens, editable, alCambiar }: { vivo: DetalleVivo; tokens: ItemDiseno[]; editable: boolean; alCambiar: (v: string | null) => void }) {
  const { cs, detalle } = vivo
  const fondo = cs.backgroundColor
  const imagen = cs.backgroundImage !== 'none' ? cs.backgroundImage : null
  const transparente = (aRgb(fondo)?.[3] ?? 0) === 0
  if (transparente && !imagen && !editable) return null
  const url = imagen ? /url\(["']?([^"')]+)["']?\)/.exec(imagen)?.[1] : null
  return (
    <Seccion titulo="Relleno">
      {!transparente && <ValorColor valor={fondo} original={detalle.originales['background-color']} tokens={tokens} />}
      {imagen &&
        (url ? (
          <Fila etiqueta="Imagen" copia={url}>
            <img className="dz-mini-img" src={url} alt="" />
            <span className="dz-recorte">{nombreDeRuta(url)}</span>
          </Fila>
        ) : (
          <Fila etiqueta="Degradado" mono copia={imagen}>
            <span className="dz-muestra dz-muestra--ancha" style={{ ['--dz-muestra' as string]: imagen }} />
            <span className="dz-recorte">{imagen}</span>
          </Fila>
        ))}
      {editable && (
        <div className="dz-fila">
          <span className="dz-fila__etiqueta">{transparente ? 'Agregar' : 'Cambiar'}</span>
          <SelectorColor valor={transparente ? '' : valorParaSelector(detalle.originales['background-color'], fondo, tokens)} tokens={tokens} alCambiar={alCambiar} etiqueta="Relleno" />
        </div>
      )}
    </Seccion>
  )
}

function SeccionBorde({ vivo, tokens, editable, estilo }: { vivo: DetalleVivo; tokens: ItemDiseno[]; editable: boolean; estilo: (e: Record<string, string | null>, etiqueta: string) => void }) {
  const { cs } = vivo
  const grosor = px(cs.borderTopWidth)
  const radios = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((r) => Math.round(px(r)))
  const conRadio = radios.some(Boolean)
  if (!grosor && !conRadio && !editable) return null
  const iguales = radios.every((r) => r === radios[0])
  return (
    <Seccion titulo="Borde">
      {grosor > 0 && (
        <>
          <ValorColor valor={cs.borderTopColor} original={vivo.detalle.originales['border-color']} tokens={tokens} />
          <Fila etiqueta="Grosor" mono copia={`${grosor}px ${cs.borderTopStyle}`}>
            {grosor} px · {cs.borderTopStyle}
          </Fila>
        </>
      )}
      {conRadio && !editable && (
        <Fila etiqueta="Radio" mono copia={cs.borderRadius}>
          {iguales ? `${radios[0]} px` : radios.join(' · ')}
        </Fila>
      )}
      {editable && (
        <>
          <div className="dz-medidas dz-medidas--2">
            <CampoNumero etiqueta="Grosor" valor={grosor} min={0} max={200} alCambiar={(v) => estilo({ 'border-width': `${Math.round(v)}px`, 'border-style': v > 0 ? (cs.borderTopStyle === 'none' ? 'solid' : cs.borderTopStyle) : null }, 'cambiar el borde')} />
            <CampoNumero etiqueta="Radio" valor={radios[0]!} min={0} max={2000} alCambiar={(v) => estilo({ 'border-radius': `${Math.round(v)}px` }, 'cambiar el radio')} />
          </div>
          <div className="dz-fila">
            <span className="dz-fila__etiqueta">Color</span>
            <SelectorColor valor={grosor ? valorParaSelector(vivo.detalle.originales['border-color'], cs.borderTopColor, tokens) : ''} tokens={tokens} etiqueta="Color del borde" alCambiar={(v) => estilo({ 'border-color': v, 'border-style': v && !grosor ? 'solid' : cs.borderTopStyle === 'none' ? null : cs.borderTopStyle, 'border-width': v && !grosor ? '2px' : `${grosor}px` }, 'cambiar el color del borde')} />
          </div>
        </>
      )}
    </Seccion>
  )
}

function partirSombras(v: string): string[] {
  const r: string[] = []
  let prof = 0
  let ini = 0
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '(') prof++
    else if (v[i] === ')') prof--
    else if (v[i] === ',' && prof === 0) {
      r.push(v.slice(ini, i).trim())
      ini = i + 1
    }
  }
  r.push(v.slice(ini).trim())
  return r.filter(Boolean)
}

function SeccionSombra({ cs }: { cs: CSSStyleDeclaration }) {
  const sombras = cs.boxShadow !== 'none' ? partirSombras(cs.boxShadow) : []
  const texto = cs.textShadow !== 'none' ? partirSombras(cs.textShadow) : []
  if (!sombras.length && !texto.length) return null
  return (
    <Seccion titulo="Sombra">
      {sombras.map((s, i) => (
        <Fila key={`c${i}`} etiqueta={i === 0 ? 'Caja' : ''} mono copia={s}>
          <span className="dz-muestra-sombra" style={{ boxShadow: s }} />
          <span className="dz-recorte">{s}</span>
        </Fila>
      ))}
      {texto.slice(0, 6).map((s, i) => (
        <Fila key={`t${i}`} etiqueta={i === 0 ? 'Texto' : ''} mono copia={s}>
          <span className="dz-recorte">{s}</span>
        </Fila>
      ))}
      {texto.length > 6 && <p className="dz-inota">y {texto.length - 6} sombras de texto más (un contorno hecho con sombras)</p>}
    </Seccion>
  )
}

const PESOS = [100, 200, 300, 400, 500, 600, 700, 800, 900]

function SeccionTipografia({
  vivo,
  items,
  editable,
  estilo,
}: {
  vivo: DetalleVivo
  items: Partial<Record<string, ItemDiseno[]>>
  editable: boolean
  estilo: (e: Record<string, string | null>, etiqueta: string) => void
}) {
  const { cs, detalle, el } = vivo
  const tokens = items.token ?? []
  const familia = primeraFamilia(cs.fontFamily)
  const tam = Math.round(px(cs.fontSize) * 10) / 10
  const unidad = enUnidad(detalle.originales['font-size'])
  // el contorno puede estar en la capa o en su ::before/::after (el texto con contorno de RC lo dibuja así)
  const win = el.ownerDocument.defaultView!
  const conTrazo = (c: CSSStyleDeclaration) => px(c.getPropertyValue('-webkit-text-stroke-width')) > 0
  const pseudo = conTrazo(cs) ? null : (['::before', '::after'] as const).map((p) => ({ p, c: win.getComputedStyle(el, p) })).find((x) => x.c.content !== 'none' && conTrazo(x.c))
  const fuenteTrazo = pseudo?.c ?? cs
  const contorno = fuenteTrazo.getPropertyValue('-webkit-text-stroke-width')
  const contornoColor = fuenteTrazo.getPropertyValue('-webkit-text-stroke-color')
  const estilos = (items.estilo_texto ?? []) as ItemDiseno<'estilo_texto'>[]
  const estiloTexto = estilos.find((e) => e.datos.clase && el.classList.contains(e.datos.clase))
  const fuentes = useMemo(() => [...new Set([familia, ...((items.fuente ?? []) as ItemDiseno<'fuente'>[]).map((f) => f.datos.familia)])], [familia, items.fuente])
  return (
    <Seccion titulo="Tipografía">
      {estiloTexto && (
        <Fila etiqueta="Estilo" copia={estiloTexto.datos.clase}>
          <span className="dz-token">{estiloTexto.nombre}</span>
        </Fila>
      )}
      {editable ? (
        <>
          <div className="dz-fila">
            <span className="dz-fila__etiqueta">Familia</span>
            <select className="dz-select" value={familia} onChange={(e) => estilo({ 'font-family': `"${e.currentTarget.value}", system-ui, sans-serif` }, 'cambiar la letra')}>
              {fuentes.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="dz-medidas dz-medidas--2">
            <label className="dz-num">
              <span className="dz-num__etiqueta">Peso</span>
              <select className="dz-select dz-select--num" value={String(Math.round(Number(cs.fontWeight) / 100) * 100)} onChange={(e) => estilo({ 'font-weight': e.currentTarget.value }, 'cambiar el peso')}>
                {PESOS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <CampoNumero etiqueta="Tam." sufijo="px" valor={tam} min={1} max={2000} alCambiar={(v) => estilo({ 'font-size': `${v}px` }, 'cambiar el tamaño de letra')} />
            <CampoNumero etiqueta="Interl." valor={cs.lineHeight === 'normal' ? 1.2 : Math.round((px(cs.lineHeight) / px(cs.fontSize)) * 100) / 100} min={0.5} max={4} paso={0.05} alCambiar={(v) => estilo({ 'line-height': String(v) }, 'cambiar el interlineado')} />
            <CampoNumero etiqueta="Esp." sufijo="px" valor={cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing)} min={-20} max={100} paso={0.5} alCambiar={(v) => estilo({ 'letter-spacing': v ? `${v}px` : null }, 'cambiar el espaciado')} />
          </div>
          <div className="dz-fila">
            <span className="dz-fila__etiqueta">Alineación</span>
            <div className="segmentado segmentado--chico">
              {(
                [
                  ['left', 'Izq.'],
                  ['center', 'Centro'],
                  ['right', 'Der.'],
                ] as const
              ).map(([v, n]) => (
                <button key={v} className={`segmentado__opcion${cs.textAlign === v || (v === 'left' && cs.textAlign === 'start') ? ' segmentado__opcion--activa' : ''}`} onClick={() => estilo({ 'text-align': v }, 'cambiar la alineación')}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="dz-fila">
            <span className="dz-fila__etiqueta">Color</span>
            <SelectorColor valor={valorParaSelector(detalle.originales.color, cs.color, tokens)} tokens={tokens} etiqueta="Color del texto" alCambiar={(v) => estilo({ color: v }, 'cambiar el color del texto')} />
          </div>
        </>
      ) : (
        <>
          <Fila etiqueta="Familia" copia={familia}>
            {familia}
          </Fila>
          <Fila etiqueta="Peso" mono copia={cs.fontWeight}>
            {cs.fontWeight}
          </Fila>
          <Fila etiqueta="Tamaño" mono copia={detalle.originales['font-size'] ?? `${tam}px`} ayuda={detalle.originales['font-size']}>
            <span>
              {tam} px{unidad ? <span className="dz-unidad"> · {unidad}</span> : null}
            </span>
          </Fila>
          <Fila etiqueta="Interlineado" mono copia={cs.lineHeight}>
            {cs.lineHeight === 'normal' ? 'normal' : `${Math.round(px(cs.lineHeight))} px`}
          </Fila>
          {cs.letterSpacing !== 'normal' && px(cs.letterSpacing) !== 0 && (
            <Fila etiqueta="Espaciado" mono copia={cs.letterSpacing}>
              {cs.letterSpacing}
            </Fila>
          )}
          <Fila etiqueta="Alineación">{({ left: 'izquierda', start: 'izquierda', center: 'centro', right: 'derecha', end: 'derecha', justify: 'justificada' } as Record<string, string>)[cs.textAlign] ?? cs.textAlign}</Fila>
          {cs.textTransform !== 'none' && <Fila etiqueta="Mayúsculas">{cs.textTransform === 'uppercase' ? 'todo en mayúsculas' : cs.textTransform}</Fila>}
          <ValorColor valor={cs.color} original={detalle.originales.color} tokens={tokens} />
        </>
      )}
      {px(contorno) > 0 && (
        <Fila etiqueta="Contorno" mono copia={`-webkit-text-stroke: ${contorno} ${colorLegible(contornoColor)}`} ayuda={pseudo ? `Lo dibuja el ${pseudo.p} de la capa` : undefined}>
          <Muestra color={contornoColor} />
          <span>
            {Math.round(px(contorno) * 10) / 10} px · {colorLegible(contornoColor)}
            {pseudo && <span className="dz-unidad"> · {pseudo.p}</span>}
          </span>
        </Fila>
      )}
    </Seccion>
  )
}

function SeccionTexto({ el, textos, editable, alCambiar }: { el: HTMLElement; textos: ItemDiseno<'texto'>[]; editable: boolean; alCambiar: (t: string) => void }) {
  const actual = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const [v, setV] = useState(actual)
  useEffect(() => setV(actual), [actual])
  const delProyecto = textos.find((t) => (t.datos as DatosTexto).valor.replace(/\s+/g, ' ').trim() === actual)
  const tabla = useDiseno((s) => s.resumen?.paginas.find((p) => p.tipo === 'tabla'))
  return (
    <Seccion titulo="Texto">
      {editable ? (
        <textarea
          className="campo-texto dz-texto-campo"
          value={v}
          rows={Math.min(6, Math.max(2, Math.ceil(v.length / 34)))}
          onChange={(e) => setV(e.currentTarget.value)}
          onBlur={() => v !== actual && alCambiar(v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
          }}
          aria-label="Contenido del texto"
        />
      ) : (
        <p className="dz-texto-completo">{actual}</p>
      )}
      {delProyecto && (
        <Fila etiqueta="Del proyecto" mono copia={delProyecto.clave}>
          <button className="dz-enlace" onClick={() => tabla && irADiseno({ pagina: tabla.slug, sel: `item:texto:${delProyecto.clave}` })}>
            {delProyecto.clave}
          </button>
        </Fila>
      )}
    </Seccion>
  )
}

function SeccionImagen({ el, activos, editable, alCambiar }: { el: HTMLImageElement; activos: ItemDiseno<'activo'>[]; editable: boolean; alCambiar: (src: string) => void }) {
  const src = el.getAttribute('src') ?? ''
  const activo = activos.find((a) => a.datos.ruta === src.split('?')[0])
  const prefijo = useDiseno((s) => s.prefijo)!
  const [buscando, setBuscando] = useState(false)
  const [q, setQ] = useState('')
  const subir = () => {
    const i = document.createElement('input')
    i.type = 'file'
    i.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif'
    i.onchange = async () => {
      const f = i.files?.[0]
      if (!f) return
      try {
        const a = await apiDiseno.subirActivo(prefijo, f, { nombre: f.name.replace(/\.\w+$/, '') })
        void useDiseno.getState().cargarItems('activo', true)
        alCambiar(a.ruta)
      } catch (e) {
        avisarError(e)
      }
    }
    i.click()
  }
  const visibles = activos.filter((a) => !q || a.nombre.toLowerCase().includes(q.toLowerCase())).slice(0, 60)
  return (
    <Seccion titulo="Imagen">
      <div className="dz-imagen">
        <img src={src} alt="" className="dz-imagen__mini" />
        <div className="dz-imagen__datos">
          <p className="dz-imagen__nombre">{activo?.nombre ?? nombreDeRuta(src)}</p>
          <p className="dz-imagen__detalle">
            natural {el.naturalWidth} × {el.naturalHeight} · dibujada {Math.round(el.getBoundingClientRect().width)} × {Math.round(el.getBoundingClientRect().height)}
          </p>
          {activo && <p className="dz-imagen__detalle">{Math.max(1, Math.round(activo.datos.peso / 1024))} KB{activo.datos.nota ? ` · ${activo.datos.nota}` : ''}</p>}
        </div>
      </div>
      {editable && (
        <div className="dz-imagen__acciones">
          <button className="boton boton--chico" onClick={() => setBuscando((b) => !b)}>
            Reemplazar…
          </button>
          <button className="boton boton--chico boton--fantasma" onClick={subir}>
            <Upload size={13} /> Subir
          </button>
        </div>
      )}
      {buscando && (
        <div className="dz-elegir-activo">
          <input className="campo" placeholder="Buscar un activo" value={q} autoFocus onChange={(e) => setQ(e.currentTarget.value)} />
          <div className="dz-activos-grilla dz-activos-grilla--chica">
            {visibles.map((a) => (
              <button
                key={a.clave}
                className="dz-activo-celda"
                title={a.nombre}
                onClick={() => {
                  alCambiar(a.datos.ruta)
                  setBuscando(false)
                }}
              >
                <img src={a.datos.ruta} alt={a.nombre} loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
    </Seccion>
  )
}

function SeccionPieza({ el, pieza, editable, alCambiar }: { el: HTMLElement; pieza: DatosPieza | undefined; editable: boolean; alCambiar: (v: Record<string, string | boolean | null>) => void }) {
  const props = useMemo(() => propiedadesDe(crearElemento('div', [['data-props', el.getAttribute('data-props') ?? '{}']]), pieza), [el, pieza])
  if (!pieza) return <Seccion titulo="Pieza"><p className="dz-inota">Falta la definición de la pieza.</p></Seccion>
  const cambiar = (nombre: string, v: ValorProp) => alCambiar({ [nombre]: v })
  return (
    <Seccion titulo="Pieza">
      {pieza.propiedades.map((p) => {
        const v = props[p.nombre]
        if (p.clase === 'variante' && p.valores?.length)
          return (
            <div className="dz-fila" key={p.nombre}>
              <span className="dz-fila__etiqueta">{p.nombre}</span>
              {p.valores.length <= 3 ? (
                <div className="segmentado segmentado--chico">
                  {p.valores.map((x) => (
                    <button key={x} disabled={!editable} className={`segmentado__opcion${v === x ? ' segmentado__opcion--activa' : ''}`} onClick={() => cambiar(p.nombre, x)}>
                      {x}
                    </button>
                  ))}
                </div>
              ) : (
                <select className="dz-select" value={String(v)} disabled={!editable} onChange={(e) => cambiar(p.nombre, e.currentTarget.value)}>
                  {p.valores.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              )}
            </div>
          )
        if (p.clase === 'booleano')
          return (
            <div className="dz-fila" key={p.nombre}>
              <span className="dz-fila__etiqueta">{p.nombre}</span>
              <Interruptor etiqueta={p.nombre} valor={v === true} apagado={!editable} alCambiar={(x) => cambiar(p.nombre, x)} />
            </div>
          )
        return (
          <div className="dz-fila" key={p.nombre}>
            <span className="dz-fila__etiqueta">{p.nombre}</span>
            <input
              className="campo dz-campo-chico"
              defaultValue={String(v ?? '')}
              disabled={!editable}
              onBlur={(e) => e.currentTarget.value !== String(v ?? '') && cambiar(p.nombre, e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </div>
        )
      })}
      {!editable && <p className="dz-inota">Las propiedades se cambian en una copia editable.</p>}
    </Seccion>
  )
}

// ───────── un marco ─────────

function InspectorMarco({ m, vivo, editable }: { m: MarcoResumen; vivo: DetalleVivo | null; editable: boolean }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const items = useDiseno((s) => s.items)
  const resumen = useDiseno((s) => s.resumen)
  const editarMarco = (op: Extract<OperacionMarco, { op: 'marco' }>, etiqueta: string) => useDiseno.getState().editar(m.id, [op], { etiqueta, enDom: false })
  const delProyecto = useMemo(() => Object.entries(resumen?.vistas ?? {}).map(([id, v]) => ({ id, nombre: id, ancho: v.ancho, alto: v.alto })), [resumen])
  const avisos = m.datos.avisos ?? []
  const par = m.datos.par ? useDiseno.getState().marcos.find((x) => x.id !== m.id && x.datos.par === m.datos.par) : null
  return (
    <>
      <Cabecera
        nombre={m.nombre}
        clase={m.datos.pieza ? 'Hoja de variantes' : 'Marco'}
        origen={m.origen === 'propio' ? (m.datos.copiaDe ? 'Copia editable' : 'Propio') : `Viene del código${m.datos.vista ? ` · ${m.datos.vista}` : ''}`}
        editableNombre={editable ? (n) => void editarMarco({ op: 'marco', nombre: n }, 'renombrar el marco') : undefined}
        acciones={
          <>
            <BotonCab etiqueta="Copiar el enlace" onClick={() => void copiar(enlaceA(useDiseno.getState().pagina?.slug ?? null, m.id), 'Enlace copiado')}>
              <Link size={14} />
            </BotonCab>
            <BotonCab etiqueta={m.origen === 'propio' ? 'Duplicar' : 'Hacer una copia editable'} onClick={() => void duplicarSeleccion()}>
              {m.origen === 'propio' ? <Copy size={14} /> : <CopyPlus size={14} />}
            </BotonCab>
            {editable && (
              <BotonCab etiqueta="Archivar el marco" onClick={() => void quitarSeleccion()}>
                <Trash2 size={14} />
              </BotonCab>
            )}
          </>
        }
      />
      {m.origen !== 'propio' && (
        <button className="boton boton--ancho dz-copia-editable" onClick={() => void duplicarSeleccion()}>
          <CopyPlus size={14} /> Hacer una copia editable
        </button>
      )}
      <Seccion titulo="Medidas">
        <div className="dz-medidas">
          <CampoNumero etiqueta="X" valor={m.x} apagado={!editable} alCambiar={(v) => void useDiseno.getState().moverMarco(m.id, v, m.y)} />
          <CampoNumero etiqueta="Y" valor={m.y} apagado={!editable} alCambiar={(v) => void useDiseno.getState().moverMarco(m.id, m.x, v)} />
          <CampoNumero etiqueta="An" valor={m.ancho} min={16} max={8192} apagado={!editable} alCambiar={(v) => void useDiseno.getState().redimensionarMarco(m.id, v, m.alto)} />
          <CampoNumero etiqueta="Al" valor={m.alto} min={16} max={8192} apagado={!editable} alCambiar={(v) => void useDiseno.getState().redimensionarMarco(m.id, m.ancho, v)} />
        </div>
        {editable ? (
          <div className="dz-fila">
            <span className="dz-fila__etiqueta">Tamaño</span>
            <select className="dz-select" value={m.datos.prefijado ?? ''} onChange={(e) => e.currentTarget.value && void editarMarco({ op: 'marco', tamano: e.currentTarget.value }, 'cambiar el tamaño')}>
              <option value="">A medida</option>
              {delProyecto.length > 0 && (
                <optgroup label="Del proyecto">
                  {delProyecto.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} · {p.ancho} × {p.alto}
                    </option>
                  ))}
                </optgroup>
              )}
              {['Redes', 'Anuncios', 'Web', 'Presentación'].map((g) => (
                <optgroup key={g} label={g}>
                  {PREFIJADOS.filter((p) => p.grupo === g).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} · {p.ancho} × {p.alto}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        ) : (
          m.datos.prefijado && <Fila etiqueta="Tamaño">{PREFIJADOS.find((p) => p.id === m.datos.prefijado)?.nombre ?? m.datos.prefijado}</Fila>
        )}
        {par && (
          <Fila etiqueta="También en">
            <button className="dz-enlace" onClick={() => window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar', { detail: { marco: par.id } }))}>
              {par.datos.vista === 'pc' ? 'PC' : par.datos.vista === 'celular' ? 'celular' : par.nombre}
            </button>
          </Fila>
        )}
      </Seccion>
      <Seccion titulo="Fondo">
        {editable ? (
          <div className="dz-fila">
            <span className="dz-fila__etiqueta">Color</span>
            <SelectorColor valor={valorParaSelector(m.datos.fondo, m.datos.fondo ?? '#ffffff', items.token ?? [])} tokens={items.token ?? []} etiqueta="Fondo del marco" alCambiar={(v) => void editarMarco({ op: 'marco', fondo: v ?? 'transparent' }, 'cambiar el fondo')} />
          </div>
        ) : (
          <Fila etiqueta="Color" mono copia={m.datos.fondo ?? 'transparent'}>
            <Muestra color={m.datos.fondo ?? 'transparent'} />
            {m.datos.fondo ?? 'transparente'}
          </Fila>
        )}
        {vivo && <Fila etiqueta="Capas">{vivo.el.querySelectorAll('[data-id]').length}</Fila>}
        {m.datos.nota && <p className="dz-inota">{m.datos.nota}</p>}
      </Seccion>
      {avisos.length > 0 && (
        <Seccion titulo="Avisos del último dibujo">
          <ul className="dz-avisos">
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </Seccion>
      )}
      <Tarjetas objetivo={`marco:${m.id}`} />
      <Exportar marco={m} prefijo={prefijo} />
      {m.origen === 'propio' && <Revisiones marco={m} />}
    </>
  )
}

