// Agregar rápido (plan del celular, 5.4): anotar es el uso número uno del teléfono. El "+" de la barra inferior y el
// «Agregar tarjeta» (y el «+» del encabezado) de cada lista abren esta hoja pegada al teclado: un compositor al pie de la
// lista quedaría tapado por el teclado en iOS. Enter crea la tarjeta y deja la hoja abierta y el campo vacío, para cargar
// varias seguidas.
//
// Tiene lo mismo que el compositor de escritorio (vistas/kanban/Compositor.tsx) con las mismas piezas: título, tipo,
// prioridad, etiquetas y el motivo (el porqué). La sintaxis rápida (error: … !alta #cocina @yo) sigue andando al escribir
// o dictar, y las píldoras muestran lo que entendió: en vez de la fila de símbolos (! # @ :) que había que conocer.
import { ArrowDownToLine, ArrowUp, ArrowUpToLine, ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { avisar, useAvisos } from '../../estado/avisos'
import { porOrden, useTienda } from '../../estado/tienda'
import { TextoAuto } from '../../ui/comunes'
import { BORRADOR_VACIO, datosDeAlta, entender, useBorrador } from '../../vistas/kanban/alta/borrador'
import { EtiquetasElegidas, PildoraEtiquetas, PildoraPrioridad, PildoraTipo } from '../../vistas/kanban/alta/Pildoras'
import { crearDesdeCompositor, esPendiente } from '../../pwa/sinconexion/bandeja'
import { useMovil } from '../estado'
import { vibrar } from '../haptica'
import { FilaTactil } from '../ui/FilaTactil'
import { HojaInferior } from '../ui/HojaInferior'

const BORRADOR = 'telar.borrador-rapido'
const BORRADOR_MOTIVO = 'telar.borrador-rapido-motivo'

const leer = (clave: string) => {
  try {
    return sessionStorage.getItem(clave) ?? ''
  } catch {
    return ''
  }
}

export function ComposerRapido() {
  const abierta = useMovil((s) => s.hoja === 'compositor')
  const cerrar = useMovil((s) => s.cerrar)
  const ref = useRef<HTMLTextAreaElement>(null)
  return (
    <HojaInferior abierta={abierta} alCerrar={cerrar} etiqueta="Nueva tarjeta" enfocar={ref} className="compositor-rapido">
      <ContenidoComposer refCampo={ref} />
    </HojaInferior>
  )
}

function ContenidoComposer({ refCampo }: { refCampo: React.RefObject<HTMLTextAreaElement | null> }) {
  const tablero = useTienda((s) => s.tablero)
  const listaVisible = useMovil((s) => s.listaVisible)
  const textoInicial = useMovil((s) => s.textoInicial)
  const listas = useMemo(() => [...(tablero?.listas ?? [])].sort(porOrden), [tablero?.listas])
  const { b, cambiar, alternarEtiqueta, agregarNueva, quitarNueva, siguiente } = useBorrador({
    ...BORRADOR_VACIO,
    titulo: textoInicial || leer(BORRADOR),
    motivo: textoInicial ? '' : leer(BORRADOR_MOTIVO),
  })
  const texto = b.titulo
  const etiquetasProyecto = useMemo(() => tablero?.etiquetas ?? [], [tablero?.etiquetas])
  const [listaId, setListaId] = useState(() => (listaVisible && listas.some((l) => l.id === listaVisible) ? listaVisible : listas[0]?.id ?? ''))
  const [arriba, setArriba] = useState(false)
  const [elegirLista, setElegirLista] = useState(false)
  const [varias, setVarias] = useState<string[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const lista = listas.find((l) => l.id === listaId) ?? listas[0]
  const entendido = useMemo(() => entender(b, etiquetasProyecto), [b, etiquetasProyecto])

  // Lo escrito sin enviar queda como borrador y vuelve la próxima vez.
  useEffect(() => {
    try {
      if (texto.trim()) sessionStorage.setItem(BORRADOR, texto)
      else sessionStorage.removeItem(BORRADOR)
      if (b.motivo.trim()) sessionStorage.setItem(BORRADOR_MOTIVO, b.motivo)
      else sessionStorage.removeItem(BORRADOR_MOTIVO)
    } catch {}
  }, [texto, b.motivo])
  useEffect(() => {
    if (textoInicial) useMovil.setState({ textoInicial: '' })
  }, [textoInicial])

  const crearUna = async (linea: string, conMotivo: boolean) => {
    if (!lista) return null
    // Lo elegido con las píldoras vale para cada línea; el motivo solo para una tarjeta suelta.
    const borrador = { ...b, titulo: linea, motivo: conMotivo ? b.motivo : '' }
    const datos = datosDeAlta(entender(borrador, etiquetasProyecto), borrador)
    if (!datos) return null
    // Sin conexión (o si se corta justo), la tarjeta nueva se guarda en el teléfono y se sube sola al volver la señal.
    return crearDesdeCompositor(lista.id, datos.titulo, datos.extra, arriba ? 'arriba' : 'abajo')
  }

  const enviar = async (lineas: string[]) => {
    if (!lista || enviando) return
    const validas = lineas.map((l) => l.trim()).filter(Boolean)
    if (!validas.length) return
    setEnviando(true)
    const soloUna = validas.length === 1
    const anterior = { titulo: b.titulo, motivo: b.motivo }
    siguiente()
    setVarias(null)
    refCampo.current?.focus()
    let hechas = 0
    let guardadas = 0
    let ultima = ''
    for (const linea of validas) {
      const r = await crearUna(linea, soloUna)
      if (!r) continue
      if (esPendiente(r.id)) guardadas++
      else {
        hechas++
        ultima = r.clave
      }
    }
    setEnviando(false)
    // Si no salió ninguna (el servidor la rechazó), lo escrito vuelve al campo: no se pierde.
    if (!hechas && !guardadas) {
      cambiar(anterior)
      return
    }
    vibrar('cambio')
    const donde = lista.nombre
    // Anotando varias seguidas, el aviso igual al anterior lo reemplaza (no se apilan cuatro iguales).
    const { avisos, quitar } = useAvisos.getState()
    const aviso = (a: Parameters<typeof avisar>[0]) => {
      for (const x of avisos) if (x.texto === a.texto) quitar(x.id)
      avisar(a)
    }
    if (guardadas && !hechas)
      aviso({
        texto: guardadas === 1 ? 'Guardada en el teléfono: se sube cuando haya conexión' : `${guardadas} tarjetas guardadas en el teléfono: se suben cuando haya conexión`,
        duracion: 3200,
      })
    else if (guardadas)
      aviso({ texto: `${hechas} creadas en ${donde}; ${guardadas} guardadas en el teléfono: se suben cuando haya conexión`, duracion: 4200 })
    else aviso({ texto: hechas === 1 ? `${ultima} creada en ${donde}` : `${hechas} tarjetas creadas en ${donde}`, tipo: 'ok', duracion: 2200 })
  }

  const intentar = () => {
    const lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lineas.length > 1) setVarias(lineas)
    else enviar(lineas)
  }

  return (
    <div className="compositor-rapido__cuerpo">
      <TextoAuto
        ref={refCampo}
        className="compositor-rapido__campo"
        value={texto}
        minFilas={1}
        placeholder="¿Qué hay que hacer?"
        aria-label="Título de la tarjeta nueva"
        enterKeyHint="send"
        onChange={(e) => {
          cambiar({ titulo: e.target.value })
          if (varias) setVarias(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            intentar()
          }
        }}
      />
      {varias && (
        <div className="compositor-rapido__varias" role="alert">
          <span>¿Crear {varias.length} tarjetas, una por línea?</span>
          <button type="button" className="boton boton--chico" onMouseDown={(e) => e.preventDefault()} onClick={() => enviar([varias.join(' ')])}>
            Una sola
          </button>
          <button type="button" className="boton boton--primario boton--chico" onMouseDown={(e) => e.preventDefault()} onClick={() => enviar(varias)}>
            Crear {varias.length}
          </button>
        </div>
      )}
      <TextoAuto
        className="compositor-rapido__motivo"
        value={b.motivo}
        minFilas={1}
        placeholder="Motivo, el porqué (opcional)"
        aria-label="Motivo de la tarjeta, el porqué (opcional)"
        onChange={(e) => cambiar({ motivo: e.target.value })}
      />
      <div className="compositor-rapido__pildoras">
        <PildoraTipo valor={entendido.tipo} alElegir={(tipo) => cambiar({ tipo })} />
        <PildoraPrioridad valor={entendido.prioridad} alElegir={(prioridad) => cambiar({ prioridad })} />
        <PildoraEtiquetas
          elegidas={b.etiquetas}
          nuevas={b.nuevas}
          alAlternar={alternarEtiqueta}
          alQuitarNueva={quitarNueva}
          alCrear={(n) => agregarNueva(n, etiquetasProyecto)}
        />
      </div>
      <EtiquetasElegidas etiquetas={entendido.etiquetas} alQuitar={(x) => (x.nueva ? quitarNueva(x.nombre) : alternarEtiqueta(x.clave))} />
      <div className="compositor-rapido__pie">
        <button type="button" className="pildora compositor-rapido__lista" onClick={() => setElegirLista(true)} aria-label={`Lista de destino: ${lista?.nombre ?? ''}`}>
          <span className={`punto-categoria${lista?.categoria ? ` punto-categoria--${lista.categoria}` : ''}`} aria-hidden />
          <span className="compositor-rapido__lista-nombre">en {lista?.nombre ?? '…'}</span>
          <ChevronDown size={15} aria-hidden />
        </button>
        <button
          type="button"
          className="boton-icono compositor-rapido__donde"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setArriba(!arriba)}
          aria-label={arriba ? 'Va arriba de la lista (tocá para ponerla abajo)' : 'Va abajo de la lista (tocá para ponerla arriba)'}
        >
          {arriba ? <ArrowUpToLine size={20} /> : <ArrowDownToLine size={20} />}
        </button>
        <span className="compositor-rapido__espacio" />
        <button
          type="button"
          className="compositor-rapido__enviar"
          disabled={!texto.trim() || enviando}
          onMouseDown={(e) => e.preventDefault()}
          onClick={intentar}
          aria-label="Crear tarjeta"
        >
          <ArrowUp size={20} strokeWidth={2.6} />
        </button>
      </div>
      <HojaInferior abierta={elegirLista} alCerrar={() => setElegirLista(false)} titulo="¿En qué lista?" devolverFoco={false}>
        {listas.map((l) => (
          <FilaTactil
            key={l.id}
            alto={48}
            icono={<span className={`punto-categoria${l.categoria ? ` punto-categoria--${l.categoria}` : ''}`} />}
            texto={l.nombre}
            detalle={l.id === listaId ? '✓' : undefined}
            onClick={() => {
              setListaId(l.id)
              setElegirLista(false)
              requestAnimationFrame(() => refCampo.current?.focus())
            }}
          />
        ))}
      </HojaInferior>
    </div>
  )
}
