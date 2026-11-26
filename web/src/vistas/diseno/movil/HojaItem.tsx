// La ficha de un ítem del sistema en el teléfono (un color, un tamaño de letra, una familia, un activo, una pieza, un
// texto…): la muestra grande, sus valores (un toque los copia), dónde se declara y dónde se usa, sus notas y sus
// tarjetas. Lo que viene del código no se edita acá (se cambia en el código): se propone, y la propuesta es una tarjeta
// con su porqué, que es justo lo que Telar hace bien. Los puntos de "Salud del sistema" se vuelven tarjeta.
import { Copy, Lightbulb, Plus, SquareKanban } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  DatosActivo,
  DatosColorSuelto,
  DatosEstiloTexto,
  DatosFuente,
  DatosHoja,
  DatosPieza,
  DatosPlantilla,
  DatosTexto,
  DatosToken,
  ItemDiseno,
  MarcoResumen,
  TipoItem,
  Uso,
} from '../../../../../compartido/diseno/tipos'
import { api } from '../../../estado/api'
import { avisar, avisarError } from '../../../estado/avisos'
import { irA } from '../../../estado/ruta'
import { useTienda } from '../../../estado/tienda'
import { FilaTactil } from '../../../movil/ui/FilaTactil'
import { HojaInferior, useHoja } from '../../../movil/ui/HojaInferior'
import { useConexion } from '../../../pwa/estado'
import { Girando, TextoAuto } from '../../../ui/comunes'
import { Markdown } from '../../../ui/Markdown'
import { apiDiseno, urlMiniatura, type VinculoTarjeta } from '../api'
import { SIN_ITEMS, useDiseno } from '../estado'
import { resaltarLlaves } from '../inspector/Item'
import { irADiseno } from '../ruta'
import { familiaCargada, usarFuentesDelProyecto } from '../sistema/PaginaSistema'
import { copiarTexto } from './compartir'
import { useDisenoMovil } from './estado'
import { cerrarHoja, useHojaDe, useUltimo } from './Hojas'
import { cuentaSalud } from './SistemaMovil'

const NOMBRE: Record<TipoItem, string> = {
  token: 'Token',
  estilo_texto: 'Estilo de texto',
  color_suelto: 'Color suelto',
  activo: 'Imagen',
  fuente: 'Familia de letra',
  hoja: 'Hoja de estilo',
  pieza: 'Pieza',
  texto: 'Texto',
  plantilla: 'Plantilla',
}

export function HojaItem() {
  const h = useHojaDe('item')
  const ultimo = useUltimo(h)
  const salud = ultimo?.clave.startsWith('salud:')
  const tipo = ultimo ? (ultimo.clave.slice(0, ultimo.clave.indexOf(':')) as TipoItem) : null
  // Un token de color se llama "Color" (lo que es para quien lo mira); los demás, por su tipo.
  const esColor = useDiseno((s) => {
    if (tipo !== 'token' || !ultimo) return false
    const k = ultimo.clave.slice(6)
    return (s.items.token?.find((x) => x.clave === k)?.datos as DatosToken | undefined)?.clase === 'color'
  })
  const titulo = salud ? 'Salud del sistema' : esColor ? 'Color' : tipo ? (NOMBRE[tipo] ?? 'Ficha') : 'Ficha'
  return (
    <HojaInferior abierta={!!h} alCerrar={cerrarHoja} titulo={titulo} className="dzm-hoja dzm-hoja--item">
      {ultimo && (salud ? <SaludDetalle clave={ultimo.clave} /> : <DetalleItem key={ultimo.clave} clave={ultimo.clave} />)}
    </HojaInferior>
  )
}

function useItem(clave: string): { item: ItemDiseno | null; cargando: boolean } {
  const i = clave.indexOf(':')
  const tipo = clave.slice(0, i) as TipoItem
  const k = clave.slice(i + 1)
  const deLista = useDiseno((s) => s.items[tipo]?.find((x) => x.clave === k) ?? null)
  const prefijo = useDiseno((s) => s.prefijo)!
  const [suelto, setSuelto] = useState<ItemDiseno | null>(null)
  const [cargando, setCargando] = useState(!deLista)
  useEffect(() => {
    if (deLista) return setCargando(false)
    let vivo = true
    setCargando(true)
    apiDiseno
      .item(prefijo, tipo, k)
      .then((x) => vivo && setSuelto(x))
      .catch(() => vivo && setSuelto(null))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [deLista, prefijo, tipo, k])
  return { item: deLista ?? suelto, cargando }
}

async function copiar(v: string) {
  const ok = await copiarTexto(v)
  avisar(ok ? { texto: 'Copiado', tipo: 'ok', duracion: 1400 } : { texto: 'No pude copiar: el navegador no dio permiso.', tipo: 'error' })
}

function Valor({ etiqueta, children, copia, color, mono = true }: { etiqueta: string; children: ReactNode; copia?: string; color?: string; mono?: boolean }) {
  return (
    <button type="button" className="dzm-valor" onClick={() => copia && void copiar(copia)} disabled={!copia} aria-label={copia ? `${etiqueta}: ${copia}. Copiar` : undefined}>
      <span className="dzm-valor__etiqueta">{etiqueta}</span>
      <span className={`dzm-valor__dato${mono ? ' dzm-valor__dato--mono' : ''}`}>
        {color && <span className="dzm-muestra" style={{ background: color }} aria-hidden />}
        <span className="dzm-valor__texto">{children}</span>
      </span>
      {copia && <Copy size={14} className="dzm-valor__copiar" aria-hidden />}
    </button>
  )
}

function DetalleItem({ clave }: { clave: string }) {
  const { item, cargando } = useItem(clave)
  if (!item)
    return cargando ? (
      <div className="dzm-estado dzm-estado--chico">
        <Girando tam={20} />
      </div>
    ) : (
      <p className="dzm-nota dzm-item__vacio">No encontré ese ítem: puede haberse archivado en la última sincronización.</p>
    )
  return <Ficha item={item} />
}

function Ficha({ item }: { item: ItemDiseno }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const fuentes = useDiseno((s) => (s.items.fuente ?? SIN_ITEMS) as ItemDiseno<'fuente'>[])
  const mapa = usarFuentesDelProyecto(fuentes, useDiseno.getState().resumen?.proyecto.id ?? 'p')
  const importado = item.origen === 'importado'
  const objetivo = `item:${item.tipo}:${item.clave}`
  let muestra: ReactNode = null
  let valores: ReactNode = null
  let usos: ReactNode = null
  let proponer: { titulo: string; actual: string } | null = null
  let extra: ReactNode = null
  let editar: ReactNode = null

  if (item.tipo === 'token') {
    const d = item.datos as DatosToken
    muestra =
      d.clase === 'color' ? (
        <div className="dzm-gran-muestra" style={{ background: d.modos?.oscuro ? `linear-gradient(135deg, ${d.valor} 50%, ${d.modos.oscuro} 50%)` : d.valor }} />
      ) : d.clase === 'sombra' ? (
        <div className="dzm-gran-muestra dzm-gran-muestra--lienzo">
          <span className="dzm-gran-muestra__caja" style={{ boxShadow: d.valor }} />
        </div>
      ) : d.clase === 'radio' ? (
        <div className="dzm-gran-muestra dzm-gran-muestra--lienzo">
          <span className="dzm-gran-muestra__caja dzm-gran-muestra__caja--radio" style={{ borderRadius: d.valor }} />
        </div>
      ) : null
    valores = (
      <>
        {d.css && (
          <Valor etiqueta="Variable" copia={`var(${d.css})`}>
            {d.css}
          </Valor>
        )}
        <Valor etiqueta="Valor" copia={d.valor} color={d.clase === 'color' ? d.valor : undefined}>
          {d.valor}
        </Valor>
        {d.unidad && (
          <Valor etiqueta="Equivale a" mono={false}>
            {d.unidad}
          </Valor>
        )}
        {Object.entries(d.modos ?? {}).map(([m, v]) => (
          <Valor key={m} etiqueta={`Modo ${m}`} copia={v} color={d.clase === 'color' ? v : undefined}>
            {v}
          </Valor>
        ))}
        {d.alias && <Valor etiqueta="Alias de">{d.alias}</Valor>}
        {d.alcance && <Valor etiqueta="Alcance">{d.alcance}</Valor>}
        {d.veces !== undefined && (
          <Valor etiqueta="Usos" mono={false}>
            {d.veces}
          </Valor>
        )}
      </>
    )
    usos = (
      <>
        <Usos titulo="Dónde se declara" usos={d.declaradoEn} />
        <Usos titulo="Dónde se usa" usos={d.usos} />
      </>
    )
    if (importado && d.css) proponer = { titulo: `Diseño: cambiar ${d.css}`, actual: d.valor }
    if (d.uso) extra = <p className="dzm-nota">{d.uso}</p>
    if (!importado) editar = <EditarToken item={item as ItemDiseno<'token'>} />
  } else if (item.tipo === 'color_suelto') {
    const d = item.datos as DatosColorSuelto
    muestra = <div className="dzm-gran-muestra" style={{ background: d.valor }} />
    valores = (
      <>
        <Valor etiqueta="Valor" copia={d.valor} color={d.valor}>
          {d.valor}
        </Valor>
        <Valor etiqueta="Usos" mono={false}>
          {d.veces}
        </Valor>
        {d.igualA && <Valor etiqueta="Igual a">{d.igualA}</Valor>}
        {d.cercaDe && <Valor etiqueta="A un paso de">{d.cercaDe}</Valor>}
        {d.familia && (
          <Valor etiqueta="Familia" mono={false}>
            {d.familia}
          </Valor>
        )}
      </>
    )
    usos = <Usos titulo="Dónde se usa" usos={d.usos} />
    if (importado) proponer = { titulo: `Darle nombre a ${d.valor}`, actual: d.valor }
  } else if (item.tipo === 'estilo_texto') {
    const d = item.datos as DatosEstiloTexto
    muestra = (
      <div className="dzm-gran-muestra dzm-gran-muestra--texto">
        <span
          style={{
            fontFamily: familiaCargada(`"${d.familia}"`, mapa),
            fontWeight: d.peso,
            fontSize: `min(${/var\(/.test(d.tamano) ? '32px' : d.tamano}, 44px)`,
            color: d.color,
            WebkitTextStroke: d.contorno ? `${d.contorno.grosor} ${d.contorno.color}` : undefined,
            paintOrder: 'stroke fill',
            textTransform: d.mayusculas ? 'uppercase' : undefined,
          }}
        >
          {item.nombre}
        </span>
      </div>
    )
    valores = (
      <>
        <Valor etiqueta="Clase" copia={`.${d.clase}`}>
          .{d.clase}
        </Valor>
        <Valor etiqueta="Familia" copia={d.familia} mono={false}>
          {d.familia}
        </Valor>
        <Valor etiqueta="Peso">{d.peso}</Valor>
        <Valor etiqueta="Tamaño" copia={d.tamano}>
          {d.tamano}
        </Valor>
        <Valor etiqueta="Interlineado">{d.interlineado}</Valor>
        {d.color && (
          <Valor etiqueta="Color" copia={d.color} color={d.color}>
            {d.color}
          </Valor>
        )}
        {d.contorno && (
          <Valor etiqueta="Contorno" copia={`${d.contorno.grosor} ${d.contorno.color}`} color={d.contorno.color}>
            {d.contorno.grosor} · {d.contorno.color}
          </Valor>
        )}
      </>
    )
    usos = <Usos titulo="Dónde se usa" usos={d.usos} />
  } else if (item.tipo === 'activo') {
    const d = item.datos as DatosActivo
    muestra = (
      <div className="dzm-gran-muestra dzm-gran-muestra--imagen">
        <img src={d.ruta} alt={item.nombre} />
      </div>
    )
    valores = (
      <>
        <Valor etiqueta="Tamaño">
          {d.ancho} × {d.alto}
        </Valor>
        <Valor etiqueta="Peso">{Math.max(1, Math.round(d.peso / 1024))} KB</Valor>
        {d.origen && (
          <Valor etiqueta="En el código" copia={d.origen}>
            {d.origen}
          </Valor>
        )}
      </>
    )
    if (d.nota) extra = <p className="dzm-nota">{d.nota}</p>
    usos = <Usos titulo="Dónde se usa" usos={d.usos} />
  } else if (item.tipo === 'fuente') {
    const d = item.datos as DatosFuente
    muestra = (
      <div className="dzm-gran-muestra dzm-gran-muestra--texto">
        <span style={{ fontFamily: familiaCargada(`"${d.familia}"`, mapa), fontSize: 56 }}>Aa</span>
      </div>
    )
    valores = (
      <>
        <Valor etiqueta="Familia" copia={d.familia} mono={false}>
          {d.familia}
        </Valor>
        <Valor etiqueta="Pesos">{d.pesos}</Valor>
        {d.licencia && (
          <Valor etiqueta="Licencia" mono={false}>
            {d.licencia}
          </Valor>
        )}
        <Valor etiqueta="Archivo" copia={d.archivo ?? d.ruta}>
          {d.archivo ?? d.ruta}
        </Valor>
      </>
    )
  } else if (item.tipo === 'texto') {
    const d = item.datos as DatosTexto
    muestra = <p className="dzm-gran-texto">{resaltarLlaves(d.valor)}</p>
    valores = (
      <>
        <Valor etiqueta="Clave" copia={d.claveOriginal ?? item.clave}>
          {d.claveOriginal ?? item.clave}
        </Valor>
        <Valor etiqueta="Largo">{d.valor.length} letras</Valor>
        {d.grupo && (
          <Valor etiqueta="Grupo" mono={false}>
            {d.grupo}
          </Valor>
        )}
        {d.archivo && (
          <Valor etiqueta="Archivo" copia={`${d.archivo}:${d.linea ?? 1}`}>
            {d.archivo}:{d.linea ?? 1}
          </Valor>
        )}
      </>
    )
    usos = <Usos titulo="Dónde se usa" usos={d.usos} />
    if (importado) proponer = { titulo: `Cambiar el texto ${d.claveOriginal ?? item.clave}`, actual: d.valor }
  } else if (item.tipo === 'pieza') {
    const d = item.datos as DatosPieza
    valores = (
      <>
        {d.ancho && (
          <Valor etiqueta="Tamaño">
            {d.ancho} × {d.alto ?? '…'}
          </Valor>
        )}
        {d.propiedades.map((p) => (
          <Valor key={p.nombre} etiqueta={p.nombre} mono={false}>
            {p.clase === 'variante' ? (p.valores ?? []).join(' · ') : p.clase === 'booleano' ? `sí o no (de fábrica: ${p.defecto ? 'sí' : 'no'})` : `${p.clase}: «${String(p.defecto)}»`}
          </Valor>
        ))}
      </>
    )
    if (d.descripcion) extra = <p className="dzm-nota">{d.descripcion}</p>
    muestra = <HojaDeVariantes pieza={item.clave} prefijo={prefijo} />
  } else if (item.tipo === 'plantilla') {
    const d = item.datos as DatosPlantilla
    valores = (
      <>
        <Valor etiqueta="Tamaño">
          {d.ancho} × {d.alto}
        </Valor>
        {d.ranuras.map((r) => (
          <Valor key={r.nombre} etiqueta={r.clase === 'texto' ? 'Texto' : 'Imagen'}>
            {r.nombre}
          </Valor>
        ))}
      </>
    )
    extra = <p className="dzm-nota">{d.descripcion ? `${d.descripcion} ` : ''}Los marcos nuevos con esta plantilla se crean en la computadora (o se los pedís a Claude).</p>
  } else if (item.tipo === 'hoja') {
    const d = item.datos as DatosHoja
    valores = (
      <>
        <Valor etiqueta="Reglas">{d.reglas}</Valor>
        <Valor etiqueta="Peso">{Math.max(1, Math.round(d.peso / 1024))} KB</Valor>
        {d.archivo && <Valor etiqueta="Archivo">{d.archivo}</Valor>}
      </>
    )
  }

  return (
    <div className="dzm-item">
      {muestra}
      <div className="dzm-item__cab">
        <p className="dzm-item__nombre">{item.nota?.nombrePropio || item.nombre}</p>
        <p className="dzm-item__clase">
          {item.nota?.nombrePropio ? `${item.nombre} · ` : ''}
          {importado ? 'Viene del código' : 'Propio'}
          {item.grupo ? ` · ${item.grupo.replace(/^Variables · /, '')}` : ''}
        </p>
        {item.nota?.uso && <p className="dzm-item__uso">{item.nota.uso}</p>}
      </div>
      {extra}
      <div className="dzm-valores">{valores}</div>
      {editar}
      {item.nota?.nota && (
        <section className="dzm-item__seccion">
          <h3 className="dzm-subtitulo">Nota</h3>
          <Markdown texto={item.nota.nota} className="dzm-detalles__nota" />
        </section>
      )}
      {usos}
      <TarjetasDe objetivo={objetivo} />
      {proponer && <Proponer objetivo={objetivo} titulo={proponer.titulo} actual={proponer.actual} />}
    </div>
  )
}

function Usos({ titulo, usos }: { titulo: string; usos: (Uso & { valor?: string })[] | undefined }) {
  const [todas, setTodas] = useState(false)
  if (!usos?.length) return null
  const lista = todas ? usos : usos.slice(0, 8)
  return (
    <section className="dzm-item__seccion">
      <h3 className="dzm-subtitulo">
        {titulo} <span className="dzm-subtitulo__n">{usos.length}</span>
      </h3>
      <ul className="dzm-usos">
        {lista.map((u, i) => (
          <li key={i}>
            <button type="button" className="dzm-usos__fila" onClick={() => void copiar(`${u.archivo}:${u.linea}`)} aria-label={`${u.archivo} línea ${u.linea}. Copiar`}>
              <span className="dzm-usos__lugar">
                {u.archivo}:{u.linea}
              </span>
              {(u.selector || u.propiedad) && (
                <span className="dzm-usos__detalle">
                  {u.selector}
                  {u.propiedad ? ` · ${u.propiedad}` : ''}
                  {u.valor ? ` = ${u.valor}` : ''}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {usos.length > 8 && !todas && (
        <button type="button" className="dzm-enlace" onClick={() => setTodas(true)}>
          Ver {usos.length === 9 ? 'la otra' : `las otras ${usos.length - 8}`}
        </button>
      )}
    </section>
  )
}

/** La hoja de variantes de una pieza (si la hay): su miniatura, y un toque la abre a pantalla completa. */
function HojaDeVariantes({ pieza, prefijo }: { pieza: string; prefijo: string }) {
  const hoja = useHoja()
  const resumen = useDiseno((s) => s.resumen)
  const [marco, setMarco] = useState<(MarcoResumen & { pagina: string }) | null>(null)
  useEffect(() => {
    if (!resumen) return
    let vivo = true
    const paginas = resumen.paginas.filter((p) => !p.archivada && p.tipo === 'lienzo' && /pieza|component/i.test(p.slug + p.nombre))
    Promise.all(paginas.map((p) => apiDiseno.pagina(prefijo, p.id).then((r) => r.marcos.map((m) => ({ ...m, pagina: p.slug })))))
      .then((ls) => vivo && setMarco(ls.flat().find((m) => m.datos.pieza === pieza) ?? null))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [resumen, prefijo, pieza])
  if (!marco) return null
  return (
    <button
      type="button"
      className="dzm-gran-muestra dzm-gran-muestra--marco"
      onClick={() => hoja?.cerrarYLuego(() => irADiseno({ pagina: marco.pagina, sel: marco.id }))}
      aria-label={`Abrir la hoja de variantes de ${pieza}`}
    >
      <img src={urlMiniatura(prefijo, marco)} alt="" style={{ aspectRatio: `${marco.ancho} / ${marco.alto}` }} />
      <span className="dzm-gran-muestra__pie">Ver todas sus variantes</span>
    </button>
  )
}

function TarjetasDe({ objetivo }: { objetivo: string }) {
  const hoja = useHoja()
  const prefijo = useDiseno((s) => s.prefijo)!
  const [lista, setLista] = useState<VinculoTarjeta[]>([])
  useEffect(() => {
    let vivo = true
    apiDiseno
      .vinculos(prefijo, objetivo)
      .then((r) => vivo && setLista(r))
      .catch(() => {})
    const f = () =>
      void apiDiseno
        .vinculos(prefijo, objetivo)
        .then((r) => vivo && setLista(r))
        .catch(() => {})
    window.addEventListener('telar:diseno-vinculos', f)
    return () => {
      vivo = false
      window.removeEventListener('telar:diseno-vinculos', f)
    }
  }, [prefijo, objetivo])
  if (!lista.length) return null
  return (
    <section className="dzm-item__seccion">
      <h3 className="dzm-subtitulo">Tarjetas</h3>
      {lista.map((t) => (
        <FilaTactil
          key={t.clave}
          icono={<SquareKanban size={20} />}
          texto={t.titulo}
          bajada={`${t.clave}${t.lista ? ` · ${t.lista}` : ''}`}
          flecha
          onClick={() => hoja?.cerrarYLuego(() => irA({ tarjeta: t.clave }))}
        />
      ))}
    </section>
  )
}

/**
 * Un token propio se cambia también desde el teléfono (es un valor: entra cómodo). Los marcos que lo usan lo muestran
 * enseguida. Los colores, con el selector del sistema; el resto, escrito.
 */
function EditarToken({ item }: { item: ItemDiseno<'token'> }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const enLinea = useConexion()
  const d = item.datos
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState(d.valor)
  const [enviando, setEnviando] = useState(false)
  useEffect(() => setValor(d.valor), [d.valor])
  const color = d.clase === 'color'
  const hex = /^#[0-9a-f]{6}$/i.test(valor) ? valor : /^#[0-9a-f]{3}$/i.test(valor) ? `#${[...valor.slice(1)].map((c) => c + c).join('')}` : '#000000'
  if (!abierto)
    return (
      <button type="button" className="boton dzm-boton-grande dzm-boton-grande--ancho" onClick={() => setAbierto(true)}>
        {color ? 'Cambiar el color' : 'Cambiar el valor'}
      </button>
    )
  const guardar = async () => {
    const v = valor.trim()
    if (!v || v === d.valor) return setAbierto(false)
    setEnviando(true)
    try {
      await apiDiseno.definirTokens(prefijo, { tokens: [{ nombre: item.clave, clase: d.clase, valor: v, modos: d.modos, uso: d.uso }] })
      avisar({ texto: `Cambié ${item.nombre}: los marcos que lo usan ya lo muestran.`, tipo: 'ok' })
      setAbierto(false)
      void useDiseno.getState().cargarItems('token', true)
      void useDiseno.getState().cargarTokens()
    } catch (e) {
      avisarError(e)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <form
      className="dzm-proponer"
      onSubmit={(e) => {
        e.preventDefault()
        void guardar()
      }}
    >
      <h3 className="dzm-subtitulo">{color ? 'Cambiar el color' : 'Cambiar el valor'}</h3>
      <div className="dzm-editar-token">
        {color && <input type="color" className="dzm-editar-token__selector" value={hex} onChange={(e) => setValor(e.currentTarget.value)} aria-label="Elegir el color" />}
        <input className="campo dzm-entrada dzm-entrada--mono" value={valor} spellCheck={false} autoCapitalize="none" onChange={(e) => setValor(e.currentTarget.value)} aria-label="Valor" />
      </div>
      <p className="dzm-nota">Cambia en todos los marcos que lo usan. Se puede volver a cambiar cuando quieras.</p>
      <div className="dzm-proponer__botones">
        <button type="button" className="boton dzm-boton-grande" onClick={() => (setValor(d.valor), setAbierto(false))}>
          Cancelar
        </button>
        <button type="submit" className="boton boton--primario dzm-boton-grande" disabled={enviando || !enLinea || !valor.trim()}>
          {enviando ? <Girando tam={16} /> : null} Guardar
        </button>
      </div>
    </form>
  )
}

/** "Proponer un cambio": una tarjeta de decisión vinculada al ítem, con el valor de hoy, el propuesto y el porqué. */
function Proponer({ objetivo, titulo, actual }: { objetivo: string; titulo: string; actual: string }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const enLinea = useConexion()
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState('')
  const [porque, setPorque] = useState('')
  const [enviando, setEnviando] = useState(false)
  if (!abierto)
    return (
      <div className="dzm-item__acciones">
        <button type="button" className="boton dzm-boton-grande dzm-boton-grande--ancho" onClick={() => setAbierto(true)}>
          <Lightbulb size={18} /> Proponer un cambio
        </button>
        <p className="dzm-nota">Viene del código: no se cambia desde acá. La propuesta queda como tarjeta, con su porqué, para que Claude la aplique.</p>
      </div>
    )
  return (
    <form
      className="dzm-proponer"
      onSubmit={async (e) => {
        e.preventDefault()
        setEnviando(true)
        try {
          const r = await apiDiseno.proponer(prefijo, { objetivo, propuesto: valor.trim() || undefined, porque: porque.trim() || undefined })
          avisar({ texto: `Creé ${r.clave}: «${r.titulo}».`, tipo: 'ok', accion: { etiqueta: 'Ver', fn: () => irA({ tarjeta: r.clave }) } })
          setAbierto(false)
          setValor('')
          setPorque('')
          window.dispatchEvent(new Event('telar:diseno-vinculos'))
        } catch (err) {
          avisarError(err)
        } finally {
          setEnviando(false)
        }
      }}
    >
      <h3 className="dzm-subtitulo">{titulo}</h3>
      <p className="dzm-nota dzm-nota--mono">Hoy: {actual}</p>
      <label className="dzm-campo dzm-campo--columna">
        <span className="dzm-campo__etiqueta">Lo que proponés</span>
        <input className="campo dzm-entrada" value={valor} onChange={(e) => setValor(e.currentTarget.value)} placeholder="El valor nuevo (opcional)" />
      </label>
      <label className="dzm-campo dzm-campo--columna">
        <span className="dzm-campo__etiqueta">Por qué</span>
        <TextoAuto className="campo-texto dzm-entrada" minFilas={2} value={porque} onChange={(e) => setPorque(e.currentTarget.value)} placeholder="Para qué sirve el cambio" />
      </label>
      <div className="dzm-proponer__botones">
        <button type="button" className="boton dzm-boton-grande" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
        <button type="submit" className="boton boton--primario dzm-boton-grande" disabled={enviando || !enLinea}>
          {enviando ? <Girando tam={16} /> : null} Crear la tarjeta
        </button>
      </div>
    </form>
  )
}

/** Un punto de "Salud del sistema": qué abarca, ejemplos y "Volverlo tarjeta" (queda vinculada a la página). */
function SaludDetalle({ clave }: { clave: string }) {
  const [, , ...resto] = clave.split(':')
  const titulo = resto.join(':')
  const items = useDiseno((s) => s.items)
  const pagina = useDiseno((s) => s.pagina)
  const prefijo = useDiseno((s) => s.prefijo)!
  const tablero = useTienda((s) => s.tablero?.tablero.id)
  const enLinea = useConexion()
  const [enviando, setEnviando] = useState(false)
  const ejemplos = useMemo(() => cuentaSalud(titulo, items), [titulo, items])
  // Otra ficha, la de ese ítem: la hoja se queda abierta y cambia de contenido.
  const abrir = (i: ItemDiseno) => useDisenoMovil.getState().abrirHoja({ tipo: 'item', clave: `${i.tipo}:${i.clave}` })
  const crear = async () => {
    if (!tablero || !pagina) return
    setEnviando(true)
    try {
      const lista = ejemplos
        .slice(0, 40)
        .map((i) => `- \`${i.clave}\` ${i.nombre !== i.clave ? i.nombre : ''}`)
        .join('\n')
      const t = await api.crearTarjeta({
        tableroId: tablero,
        titulo: `Diseño: ordenar ${ejemplos.length} ${titulo}`,
        tipo: 'tarea',
        descripcion: `Salió de **Salud del sistema** (página ${pagina.nombre} de Diseño).\n\n${lista}${ejemplos.length > 40 ? `\n- … y ${ejemplos.length - 40} más` : ''}`,
      })
      await apiDiseno.vincular(prefijo, `pagina:${pagina.id}`, t.clave).catch(() => {})
      avisar({ texto: `Creé ${t.clave}.`, tipo: 'ok', accion: { etiqueta: 'Ver', fn: () => irA({ tarjeta: t.clave }) } })
    } catch (e) {
      avisarError(e)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <div className="dzm-item">
      <div className="dzm-item__cab">
        <p className="dzm-item__nombre">
          {ejemplos.length} {titulo}
        </p>
      </div>
      {ejemplos.length === 0 && <p className="dzm-nota">Nada para ordenar acá.</p>}
      <div className="dzm-filas">
        {ejemplos.slice(0, 14).map((i) => {
          const v = (i.datos as unknown as { valor?: unknown }).valor
          const color = typeof v === 'string' && (i.tipo === 'color_suelto' || (i.datos as DatosToken).clase === 'color') ? v : undefined
          return (
            <button key={i.clave} type="button" className="dzm-token" onClick={() => abrir(i)}>
              <span className="dzm-token__nombre">
                {color && <span className="dzm-muestra" style={{ background: color }} aria-hidden />}
                {i.nombre}
              </span>
              {i.nombre !== i.clave && <span className="dzm-token__valor">{i.clave}</span>}
            </button>
          )
        })}
      </div>
      {ejemplos.length > 14 && <p className="dzm-nota">Y {ejemplos.length - 14} más.</p>}
      {ejemplos.length > 0 && (
        <div className="dzm-item__acciones">
          <button type="button" className="boton boton--primario dzm-boton-grande dzm-boton-grande--ancho" onClick={() => void crear()} disabled={!tablero || enviando || !enLinea}>
            {enviando ? <Girando tam={16} /> : <Plus size={18} />} Volverlo tarjeta
          </button>
        </div>
      )}
    </div>
  )
}
