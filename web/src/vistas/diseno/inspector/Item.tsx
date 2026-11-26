// Inspector de un ítem del sistema (plan 6.6): token, color suelto, estilo de texto, activo, fuente, texto, pieza,
// plantilla u hoja. Muestra grande, nombre y nombre propio, valor por modo, alias, dónde se declara y dónde se usa. Para lo
// importado: "Proponer un cambio" (crea la tarjeta vinculada) y, en un token, "Probar un valor" en vivo en los marcos.
import { FlaskConical, Lightbulb, Plus, Undo2 } from 'lucide-react'
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
  TipoItem,
  Uso,
} from '../../../../../compartido/diseno/tipos'
import { api } from '../../../estado/api'
import { irA } from '../../../estado/ruta'
import { useTienda } from '../../../estado/tienda'
import { avisar, avisarError } from '../../../estado/avisos'
import { apiDiseno } from '../api'
import { SIN_ITEMS, useDiseno } from '../estado'
import { crearDesdePlantilla, insertarPieza } from '../panel-izq/Piezas'
import { familiaCargada, usarFuentesDelProyecto } from '../sistema/PaginaSistema'
import { copiar, Fila, Muestra, Seccion } from '../ui'
import { resaltarCss, resaltarHtml, sangrarHtml } from './Codigo'
import { Tarjetas } from './Extras'

const NOMBRE: Record<TipoItem, string> = {
  token: 'Token',
  estilo_texto: 'Estilo de texto',
  color_suelto: 'Color suelto',
  activo: 'Activo',
  fuente: 'Fuente',
  hoja: 'Hoja de estilo',
  pieza: 'Pieza',
  texto: 'Texto',
  plantilla: 'Plantilla',
}

function useItem(clave: string): ItemDiseno | null {
  const i = clave.indexOf(':')
  const tipo = clave.slice(0, i) as TipoItem
  const k = clave.slice(i + 1)
  const deLista = useDiseno((s) => s.items[tipo]?.find((x) => x.clave === k) ?? null)
  const prefijo = useDiseno((s) => s.prefijo)!
  const [suelto, setSuelto] = useState<ItemDiseno | null>(null)
  useEffect(() => {
    if (deLista) return
    let vivo = true
    apiDiseno
      .item(prefijo, tipo, k)
      .then((x) => vivo && setSuelto(x))
      .catch(() => vivo && setSuelto(null))
    return () => {
      vivo = false
    }
  }, [deLista, prefijo, tipo, k])
  return deLista ?? suelto
}

export function InspectorItem({ clave, pestana }: { clave: string; pestana: 'diseno' | 'codigo' | 'notas' }) {
  if (clave.startsWith('salud:')) return <SaludItem clave={clave} />
  return <InspectorItemDe clave={clave} pestana={pestana} />
}

/** Una tarjeta de "Salud del sistema": qué abarca, ejemplos y "Volverlo tarjeta" (queda vinculada a la página). */
function SaludItem({ clave }: { clave: string }) {
  const [, tipo, ...resto] = clave.split(':')
  const titulo = resto.join(':')
  const items = useDiseno((s) => (s.items[tipo as TipoItem] ?? SIN_ITEMS) as ItemDiseno[])
  const pagina = useDiseno((s) => s.pagina)
  const prefijo = useDiseno((s) => s.prefijo)!
  const tablero = useTienda((s) => s.tablero?.tablero.id)
  const ejemplos = useMemo(() => {
    const d = (i: ItemDiseno) => i.datos as unknown as Record<string, unknown>
    const prueba: Record<string, (i: ItemDiseno) => boolean> = {
      'colores sin nombre': (i) => !d(i).igualA,
      'colores a un paso de otro': (i) => Boolean(d(i).cercaDe),
      'variables repetidas': (i) => !d(i).suelto && ((d(i).declaradoEn as unknown[] | undefined)?.length ?? 0) > 1,
      'activos sin uso encontrado': (i) => i.origen === 'importado' && !(d(i).usos as unknown[] | undefined)?.length,
      'activos sin nota': (i) => i.origen === 'importado' && !d(i).nota && !i.nota?.nota,
      'textos sin uso': (i) => Array.isArray(d(i).usos) && !(d(i).usos as unknown[]).length,
    }
    return items.filter(prueba[titulo] ?? (() => false))
  }, [items, titulo])
  const crear = async () => {
    if (!tablero || !pagina) return
    try {
      const lista = ejemplos.slice(0, 40).map((i) => `- \`${i.clave}\` ${i.nombre !== i.clave ? i.nombre : ''}`).join('\n')
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
    }
  }
  return (
    <>
      <div className="dz-icab">
        <p className="dz-icab__nombre">
          {ejemplos.length} {titulo}
        </p>
        <p className="dz-icab__clase">Salud del sistema</p>
      </div>
      <Seccion titulo="Ejemplos">
        {ejemplos.length === 0 && <p className="dz-inota">Nada para ordenar acá.</p>}
        <ul className="dz-usos">
          {ejemplos.slice(0, 14).map((i) => (
            <li key={i.clave}>
              <button className="dz-usos__fila dz-usos__fila--item" onClick={() => useDiseno.getState().seleccionar({ item: `${i.tipo}:${i.clave}` })}>
                {typeof (i.datos as unknown as { valor?: unknown }).valor === 'string' && (i.tipo === 'color_suelto' || (i.datos as DatosToken).clase === 'color') && (
                  <Muestra color={(i.datos as unknown as { valor: string }).valor} tam={16} />
                )}
                <span className="dz-usos__lugar">{i.nombre}</span>
                {i.nombre !== i.clave && <span className="dz-usos__detalle">{i.clave}</span>}
              </button>
            </li>
          ))}
        </ul>
        {ejemplos.length > 14 && <p className="dz-inota">y {ejemplos.length - 14} más</p>}
      </Seccion>
      {ejemplos.length > 0 && (
        <div className="dz-item-acciones">
          <button className="boton boton--chico boton--primario" onClick={() => void crear()} disabled={!tablero}>
            <Plus size={13} /> Volverlo tarjeta
          </button>
        </div>
      )}
    </>
  )
}

function InspectorItemDe({ clave, pestana }: { clave: string; pestana: 'diseno' | 'codigo' | 'notas' }) {
  const item = useItem(clave)
  if (!item) return <p className="dz-inota">Buscando…</p>
  if (pestana === 'codigo') return <CodigoItem item={item} />
  return <DisenoItem item={item} />
}

function Usos({ titulo, usos }: { titulo: string; usos: (Uso & { valor?: string })[] | undefined }) {
  const [todas, setTodas] = useState(false)
  if (!usos?.length) return null
  const lista = todas ? usos : usos.slice(0, 30)
  return (
    <Seccion titulo={`${titulo} (${usos.length})`}>
      <ul className="dz-usos">
        {lista.map((u, i) => (
          <li key={i}>
            <button className="dz-usos__fila" onClick={() => void copiar(`${u.archivo}:${u.linea}`)} title="Copiar archivo y línea">
              <span className="dz-usos__lugar">
                {u.archivo}:{u.linea}
              </span>
              {(u.selector || u.propiedad) && (
                <span className="dz-usos__detalle">
                  {u.selector}
                  {u.propiedad ? ` · ${u.propiedad}` : ''}
                  {u.valor ? ` = ${u.valor}` : ''}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {usos.length > 30 && !todas && (
        <button className="dz-enlace" onClick={() => setTodas(true)}>
          Ver todas
        </button>
      )}
    </Seccion>
  )
}

function DisenoItem({ item }: { item: ItemDiseno }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const fuentes = useDiseno((s) => (s.items.fuente ?? SIN_ITEMS) as ItemDiseno<'fuente'>[])
  const mapa = usarFuentesDelProyecto(fuentes, prefijo)
  const importado = item.origen === 'importado'
  const objetivo = `item:${item.tipo}:${item.clave}`
  let muestra: ReactNode = null
  let filas: ReactNode = null
  let usos: ReactNode = null
  let extra: ReactNode = null

  if (item.tipo === 'token') {
    const d = item.datos as DatosToken
    muestra =
      d.clase === 'color' ? (
        <div className="dz-gran-muestra" style={{ background: d.valor }} />
      ) : d.clase === 'sombra' ? (
        <div className="dz-gran-muestra dz-gran-muestra--sombra">
          <span style={{ boxShadow: d.valor }} />
        </div>
      ) : d.clase === 'radio' ? (
        <div className="dz-gran-muestra dz-gran-muestra--radio">
          <span style={{ borderRadius: d.valor }} />
        </div>
      ) : null
    filas = (
      <>
        {d.css && (
          <Fila etiqueta="Variable" mono copia={`var(${d.css})`}>
            {d.css}
          </Fila>
        )}
        <Fila etiqueta="Valor" mono copia={d.valor}>
          {d.clase === 'color' && <Muestra color={d.valor} />}
          {d.valor}
        </Fila>
        {d.unidad && <Fila etiqueta="Equivale a">{d.unidad}</Fila>}
        {Object.entries(d.modos ?? {}).map(([m, v]) => (
          <Fila key={m} etiqueta={`Modo ${m}`} mono copia={v}>
            {d.clase === 'color' && <Muestra color={v} />}
            {v}
          </Fila>
        ))}
        {d.alias && <Fila etiqueta="Alias de">{d.alias}</Fila>}
        {d.alcance && (
          <Fila etiqueta="Alcance" mono>
            {d.alcance}
          </Fila>
        )}
        {d.veces !== undefined && <Fila etiqueta="Usos">{d.veces}</Fila>}
        {d.uso && <p className="dz-inota">{d.uso}</p>}
      </>
    )
    usos = (
      <>
        <Usos titulo="Dónde se declara" usos={d.declaradoEn} />
        <Usos titulo="Dónde se usa" usos={d.usos} />
      </>
    )
    if (d.css) extra = importado ? <ProbarYProponer item={item} variable={d.css} valor={d.valor} /> : <EditarToken item={item} />
  } else if (item.tipo === 'color_suelto') {
    const d = item.datos as DatosColorSuelto
    muestra = <div className="dz-gran-muestra" style={{ background: d.valor }} />
    filas = (
      <>
        <Fila etiqueta="Valor" mono copia={d.valor}>
          <Muestra color={d.valor} />
          {d.valor}
        </Fila>
        <Fila etiqueta="Usos">{d.veces}</Fila>
        {d.igualA && <Fila etiqueta="Igual a">{d.igualA}</Fila>}
        {d.cercaDe && <Fila etiqueta="A un paso de">{d.cercaDe}</Fila>}
        {d.familia && <Fila etiqueta="Familia">{d.familia}</Fila>}
      </>
    )
    usos = <Usos titulo="Dónde se usa" usos={d.usos} />
    extra = importado ? <Proponer objetivo={objetivo} titulo={`Darle nombre a ${d.valor}`} actual={d.valor} /> : null
  } else if (item.tipo === 'estilo_texto') {
    const d = item.datos as DatosEstiloTexto
    muestra = (
      <div
        className="dz-gran-muestra dz-gran-muestra--texto"
        style={{
          fontFamily: familiaCargada(d.familia, mapa),
          fontWeight: d.peso,
          fontSize: `min(${d.tamano}, 44px)`,
          color: d.color,
          WebkitTextStroke: d.contorno ? `${d.contorno.grosor} ${d.contorno.color}` : undefined,
          paintOrder: 'stroke fill',
          textTransform: d.mayusculas ? 'uppercase' : undefined,
        }}
      >
        {item.nombre}
      </div>
    )
    filas = (
      <>
        <Fila etiqueta="Clase" mono copia={d.clase}>
          .{d.clase}
        </Fila>
        <Fila etiqueta="Familia">{d.familia}</Fila>
        <Fila etiqueta="Peso" mono>
          {d.peso}
        </Fila>
        <Fila etiqueta="Tamaño" mono copia={d.tamano}>
          {d.tamano}
        </Fila>
        <Fila etiqueta="Interlineado" mono>
          {d.interlineado}
        </Fila>
        {d.color && (
          <Fila etiqueta="Color" mono copia={d.color}>
            <Muestra color={d.color} />
            {d.color}
          </Fila>
        )}
        {d.contorno && (
          <Fila etiqueta="Contorno" mono copia={`${d.contorno.grosor} ${d.contorno.color}`}>
            <Muestra color={d.contorno.color} />
            {d.contorno.grosor} · {d.contorno.color}
          </Fila>
        )}
      </>
    )
    usos = <Usos titulo="Dónde se usa" usos={d.usos} />
  } else if (item.tipo === 'activo') {
    const d = item.datos as DatosActivo
    muestra = (
      <div className="dz-gran-muestra dz-gran-muestra--imagen">
        <img src={d.ruta} alt={item.nombre} />
      </div>
    )
    filas = (
      <>
        <Fila etiqueta="Tamaño" mono>
          {d.ancho} × {d.alto}
        </Fila>
        <Fila etiqueta="Peso" mono>
          {Math.max(1, Math.round(d.peso / 1024))} KB
        </Fila>
        <Fila etiqueta="Ruta" mono copia={d.ruta}>
          <span className="dz-recorte">{d.ruta}</span>
        </Fila>
        {d.origen && (
          <Fila etiqueta="En el código" mono copia={d.origen}>
            <span className="dz-recorte">{d.origen}</span>
          </Fila>
        )}
        {d.nota && <p className="dz-inota">{d.nota}</p>}
      </>
    )
    usos = <Usos titulo="Dónde se usa" usos={d.usos} />
  } else if (item.tipo === 'fuente') {
    const d = item.datos as DatosFuente
    muestra = (
      <div className="dz-gran-muestra dz-gran-muestra--texto" style={{ fontFamily: familiaCargada(d.familia, mapa), fontSize: 48 }}>
        Aa
      </div>
    )
    filas = (
      <>
        <Fila etiqueta="Familia" copia={d.familia}>
          {d.familia}
        </Fila>
        <Fila etiqueta="Pesos" mono>
          {d.pesos}
        </Fila>
        {d.licencia && <Fila etiqueta="Licencia">{d.licencia}</Fila>}
        <Fila etiqueta="Archivo" mono copia={d.ruta}>
          <span className="dz-recorte">{d.archivo ?? d.ruta}</span>
        </Fila>
      </>
    )
  } else if (item.tipo === 'texto') {
    const d = item.datos as DatosTexto
    muestra = <p className="dz-texto-completo dz-texto-completo--grande">{resaltarLlaves(d.valor)}</p>
    filas = (
      <>
        <Fila etiqueta="Clave" mono copia={d.claveOriginal ?? item.clave}>
          {d.claveOriginal ?? item.clave}
        </Fila>
        <Fila etiqueta="Largo" mono>
          {d.valor.length}
        </Fila>
        {d.grupo && <Fila etiqueta="Grupo">{d.grupo}</Fila>}
        {d.archivo && (
          <Fila etiqueta="Archivo" mono copia={`${d.archivo}:${d.linea ?? 1}`}>
            {d.archivo}:{d.linea}
          </Fila>
        )}
      </>
    )
    usos = <Usos titulo="Dónde se usa" usos={d.usos} />
    extra = importado ? <Proponer objetivo={objetivo} titulo={`Cambiar el texto ${d.claveOriginal ?? item.clave}`} actual={d.valor} /> : null
  } else if (item.tipo === 'pieza') {
    const d = item.datos as DatosPieza
    filas = (
      <>
        {d.descripcion && <p className="dz-inota">{d.descripcion}</p>}
        {d.ancho && (
          <Fila etiqueta="Tamaño" mono>
            {d.ancho} × {d.alto ?? '…'}
          </Fila>
        )}
        {d.propiedades.map((p) => (
          <Fila key={p.nombre} etiqueta={p.nombre} mono>
            {p.clase === 'variante' ? (p.valores ?? []).join(' · ') : p.clase === 'booleano' ? `sí / no (de fábrica ${p.defecto ? 'sí' : 'no'})` : `${p.clase}: «${String(p.defecto)}»`}
          </Fila>
        ))}
        {d.hojas.length > 0 && <Fila etiqueta="Hojas">{d.hojas.length}</Fila>}
      </>
    )
    extra = (
      <button className="boton boton--chico" onClick={() => void insertarPieza(item.clave, d)}>
        <Plus size={13} /> Insertar en el marco seleccionado
      </button>
    )
  } else if (item.tipo === 'plantilla') {
    const d = item.datos as DatosPlantilla
    filas = (
      <>
        {d.descripcion && <p className="dz-inota">{d.descripcion}</p>}
        <Fila etiqueta="Tamaño" mono>
          {d.ancho} × {d.alto}
        </Fila>
        {d.ranuras.map((r) => (
          <Fila key={r.nombre} etiqueta={r.clase === 'texto' ? 'Texto' : 'Imagen'} mono>
            {r.nombre}
          </Fila>
        ))}
      </>
    )
    extra = (
      <button className="boton boton--primario boton--chico" onClick={() => void crearDesdePlantilla(item)}>
        <Plus size={13} /> Crear un marco con esta plantilla
      </button>
    )
  } else if (item.tipo === 'hoja') {
    const d = item.datos as DatosHoja
    filas = (
      <>
        <Fila etiqueta="Reglas" mono>
          {d.reglas}
        </Fila>
        <Fila etiqueta="Peso" mono>
          {Math.max(1, Math.round(d.peso / 1024))} KB
        </Fila>
        {d.archivo && (
          <Fila etiqueta="Archivo" mono>
            {d.archivo}
          </Fila>
        )}
      </>
    )
  }

  return (
    <>
      <div className="dz-icab">
        <p className="dz-icab__nombre">{item.nota?.nombrePropio || item.nombre}</p>
        <p className="dz-icab__clase">
          {NOMBRE[item.tipo]}
          {item.nota?.nombrePropio ? ` · ${item.nombre}` : ''} · <span className="dz-icab__origen">{importado ? 'viene del código' : 'propio'}</span>
          {item.grupo ? ` · ${item.grupo}` : ''}
        </p>
      </div>
      {muestra}
      <Seccion titulo="Valores">{filas}</Seccion>
      {extra && <div className="dz-item-acciones">{extra}</div>}
      {usos}
      <Tarjetas objetivo={objetivo} />
    </>
  )
}

/** Las llaves de las plantillas de texto ({100}) se resaltan. */
export function resaltarLlaves(t: string): ReactNode[] {
  return t.split(/(\{[^{}]{1,40}\})/g).map((p, i) => (i % 2 ? <mark key={i} className="dz-llave">{p}</mark> : p))
}

function ProbarYProponer({ item, variable, valor }: { item: ItemDiseno; variable: string; valor: string }) {
  const probando = useDiseno((s) => (s.probarValor?.variable === variable ? s.probarValor.valor : null))
  const [v, setV] = useState(probando ?? valor)
  const [proponer, setProponer] = useState(false)
  useEffect(() => () => useDiseno.getState().set({ probarValor: null }), [])
  return (
    <div className="dz-probar">
      {probando !== null ? (
        <div className="dz-probar__cartel" role="status">
          <FlaskConical size={14} /> Probando: no se guarda
          <button className="boton boton--chico boton--fantasma" onClick={() => useDiseno.getState().set({ probarValor: null })}>
            <Undo2 size={12} /> Volver
          </button>
        </div>
      ) : null}
      <label className="dz-campo-etiquetado">
        <span>Probar un valor</span>
        <span className="dz-probar__fila">
          <input
            className="campo dz-campo-mono"
            value={v}
            spellCheck={false}
            onChange={(e) => {
              setV(e.currentTarget.value)
              useDiseno.getState().set({ probarValor: { variable, valor: e.currentTarget.value } })
            }}
          />
        </span>
      </label>
      <button className="boton boton--chico" onClick={() => setProponer((x) => !x)}>
        <Lightbulb size={13} /> {probando !== null ? 'Proponer este cambio' : 'Proponer un cambio'}
      </button>
      {proponer && <Proponer objetivo={`item:${item.tipo}:${item.clave}`} titulo={`Diseño: cambiar ${variable}`} actual={valor} propuesto={probando ?? ''} abierto />}
    </div>
  )
}

/** "Proponer un cambio": crea una tarjeta de decisión vinculada al ítem, con el valor de hoy y el propuesto. */
function Proponer({ objetivo, titulo, actual, propuesto = '', abierto }: { objetivo: string; titulo: string; actual: string; propuesto?: string; abierto?: boolean }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const [mostrar, setMostrar] = useState(Boolean(abierto))
  const [valor, setValor] = useState(propuesto)
  const [porque, setPorque] = useState('')
  const [enviando, setEnviando] = useState(false)
  useEffect(() => setValor(propuesto), [propuesto])
  if (!mostrar)
    return (
      <button className="boton boton--chico" onClick={() => setMostrar(true)}>
        <Lightbulb size={13} /> Proponer un cambio
      </button>
    )
  return (
    <form
      className="dz-proponer"
      onSubmit={async (e) => {
        e.preventDefault()
        setEnviando(true)
        try {
          const r = await apiDiseno.proponer(prefijo, { objetivo, propuesto: valor || undefined, porque: porque || undefined })
          avisar({ texto: `Creé ${r.clave}: «${r.titulo}».`, tipo: 'ok', accion: { etiqueta: 'Ver', fn: () => irA({ tarjeta: r.clave }) } })
          setMostrar(false)
          setPorque('')
        } catch (err) {
          avisarError(err)
        } finally {
          setEnviando(false)
        }
      }}
    >
      <p className="dz-proponer__titulo">{titulo}</p>
      <p className="dz-inota dz-inota--mono">Hoy: {actual}</p>
      <label className="dz-campo-etiquetado">
        <span>Valor propuesto</span>
        <input className="campo dz-campo-mono" value={valor} onChange={(e) => setValor(e.currentTarget.value)} />
      </label>
      <label className="dz-campo-etiquetado">
        <span>Por qué</span>
        <textarea className="campo-texto" rows={2} value={porque} onChange={(e) => setPorque(e.currentTarget.value)} placeholder="Para qué sirve el cambio" />
      </label>
      <div className="dz-editor__botones">
        <button type="button" className="boton boton--chico boton--fantasma" onClick={() => setMostrar(false)}>
          Cancelar
        </button>
        <button type="submit" className="boton boton--chico boton--primario" disabled={enviando}>
          Crear la tarjeta
        </button>
      </div>
    </form>
  )
}

/** Token propio: el valor se cambia acá (definir_tokens). */
function EditarToken({ item }: { item: ItemDiseno }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const d = item.datos as DatosToken
  const [v, setV] = useState(d.valor)
  useEffect(() => setV(d.valor), [d.valor])
  const guardar = async () => {
    if (!v.trim() || v === d.valor) return
    try {
      await apiDiseno.definirTokens(prefijo, { tokens: [{ nombre: item.clave, clase: d.clase, valor: v.trim(), modos: d.modos, uso: d.uso }] })
      avisar({ texto: `Cambié ${item.nombre}: los marcos que lo usan ya lo muestran.`, tipo: 'ok' })
    } catch (e) {
      avisarError(e)
      setV(d.valor)
    }
  }
  return (
    <label className="dz-campo-etiquetado">
      <span>Valor</span>
      <span className="dz-probar__fila">
        {d.clase === 'color' && <input type="color" className="dz-selector-color__sistema" value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'} onChange={(e) => setV(e.currentTarget.value)} onBlur={() => void guardar()} />}
        <input className="campo dz-campo-mono" value={v} onChange={(e) => setV(e.currentTarget.value)} onBlur={() => void guardar()} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      </span>
    </label>
  )
}

function CodigoItem({ item }: { item: ItemDiseno }) {
  const bloques = useMemo(() => {
    const r: { titulo: string; codigo: string; lenguaje: 'css' | 'html' | 'texto' }[] = []
    if (item.tipo === 'token') {
      const d = item.datos as DatosToken
      if (d.css) r.push({ titulo: 'Uso', codigo: `var(${d.css})`, lenguaje: 'css' })
      r.push({ titulo: 'Declaración', codigo: `${d.alcance ?? ':root'} {\n  ${d.css || '/* sin nombre */'}: ${d.valor};\n}`, lenguaje: 'css' })
    } else if (item.tipo === 'estilo_texto') {
      const d = item.datos as DatosEstiloTexto
      r.push({ titulo: 'Clase', codigo: `.${d.clase} {\n  font-family: ${d.familia};\n  font-weight: ${d.peso};\n  font-size: ${d.tamano};\n  line-height: ${d.interlineado};${d.color ? `\n  color: ${d.color};` : ''}${d.contorno ? `\n  -webkit-text-stroke: ${d.contorno.grosor} ${d.contorno.color};` : ''}\n}`, lenguaje: 'css' })
    } else if (item.tipo === 'activo') {
      const d = item.datos as DatosActivo
      r.push({ titulo: 'En Telar', codigo: `<img src="${d.ruta}" alt="${item.nombre}">`, lenguaje: 'html' })
      if (d.origen) r.push({ titulo: 'En el código', codigo: d.origen, lenguaje: 'texto' })
    } else if (item.tipo === 'texto') {
      const d = item.datos as DatosTexto
      r.push({ titulo: 'Clave', codigo: d.claveOriginal ?? item.clave, lenguaje: 'texto' })
    } else if (item.tipo === 'pieza') {
      const d = item.datos as DatosPieza
      r.push({ titulo: 'Instancia', codigo: `<div data-pieza="${item.clave}" data-props='${JSON.stringify(Object.fromEntries(d.propiedades.map((p) => [p.nombre, p.defecto])))}'></div>`, lenguaje: 'html' })
      if (d.html) r.push({ titulo: 'HTML', codigo: sangrarHtml(d.html), lenguaje: 'html' })
      if (d.css.trim()) r.push({ titulo: 'CSS', codigo: d.css.trim(), lenguaje: 'css' })
    } else if (item.tipo === 'plantilla') {
      const d = item.datos as DatosPlantilla
      r.push({ titulo: 'HTML', codigo: sangrarHtml(d.html), lenguaje: 'html' })
      if (d.css.trim()) r.push({ titulo: 'CSS', codigo: d.css.trim(), lenguaje: 'css' })
    } else if (item.tipo === 'fuente') {
      const d = item.datos as DatosFuente
      r.push({ titulo: '@font-face', codigo: `@font-face {\n  font-family: "${d.familia}";\n  src: url(${d.ruta});\n  font-weight: ${d.pesos};\n}`, lenguaje: 'css' })
    } else if (item.tipo === 'color_suelto') {
      const d = item.datos as DatosColorSuelto
      r.push({ titulo: 'Valor', codigo: d.valor, lenguaje: 'css' })
    } else if (item.tipo === 'hoja') {
      const d = item.datos as DatosHoja
      r.push({ titulo: 'Ruta', codigo: d.ruta ?? d.archivo ?? '', lenguaje: 'texto' })
    }
    return r
  }, [item])
  return (
    <>
      {bloques.map((b) => (
        <Seccion key={b.titulo} titulo={b.titulo}>
          <div className="dz-bloque">
            <pre className="dz-codigo" onClick={() => void copiar(b.codigo)} title="Clic para copiar">
              {b.lenguaje === 'css' ? resaltarCss(b.codigo) : b.lenguaje === 'html' ? resaltarHtml(b.codigo) : b.codigo}
            </pre>
          </div>
        </Seccion>
      ))}
    </>
  )
}
