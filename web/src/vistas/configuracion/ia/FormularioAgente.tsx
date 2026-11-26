// Crear o cambiar un agente (plan 14.7, 12.2, 12.3, 12.4 y F.4). Un agente es un miembro de la cuenta con su proveedor, su clave, su
// modelo, lo que puede hacer, cuándo pide permiso y cuánto puede gastar.
//   · Nuevo: un paso por vez (proveedor y modelo → nombre → qué puede hacer y el tope → instrucciones), con «Atrás» y «Siguiente».
//   · Existente: todo en una página con sus grupos, y además «Trabajar sin que lo mencionen» (disparadores y autonomía, apagado de
//     fábrica), si puede mencionar a otras IA, prenderlo o apagarlo y archivarlo (no se borra: deja de aparecer al mencionar).
//   · Se guarda con un botón (son muchos campos): el servidor revisa todo de nuevo y lo que no acepta se dice acá, con sus palabras.
//   · Si falta una clave, «Agregar una clave…» va a cargarla y vuelve acá con lo escrito (el borrador viaja en la vista).
import { ArrowLeft, Archive, Info, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { CAPACIDADES, CAPACIDADES_TEXTO, MAX_PROACTIVOS_POR_DIA, PREAJUSTES_PERMISOS, type Agente, type Capacidad, type ClaveIA, type EstadoIA, type ModoConfirmar } from '../../../../../compartido/ia'
import { COLORES } from '../../../../../compartido/constantes'
import type { Color } from '../../../../../compartido/tipos'
import { avisar } from '../../../estado/avisos'
import { useTienda } from '../../../estado/tienda'
import { Avatar, Girando, Interruptor, Segmentado } from '../../../ui/comunes'
import { apiIA } from '../../ia/api-ia'
import { Fila, Grupo } from '../piezas'
import { aEntrada, aliasDe, aNumero, borradorDe, borradorNuevo, errores, type BorradorAgente } from './borrador'
import { BarraGasto, Campo, PildoraEstado, SelectNativo, SOLO_CON_CUENTA, useConfigIA } from './piezas'
import { modelosDe, OPCIONES_PROVEEDOR, opcionPorId, type IdOpcion } from './proveedores'

const NOMBRE_CAPACIDAD: Record<Capacidad, string> = {
  comentar: 'Comentar',
  tarjetas: 'Tarjetas',
  lienzo: 'Lienzo',
  diseno: 'Diseño',
  archivar: 'Archivar',
  estructura: 'Estructura',
  codigo: 'Código',
}

const CONFIRMAR: { id: ModoConfirmar; nombre: string; ayuda: string }[] = [
  { id: 'peligrosas', nombre: 'Solo para lo delicado (recomendado)', ayuda: 'Archivar, sacar muchas cosas del lienzo, cambiar la estructura o tocar más de 10 tarjetas.' },
  { id: 'siempre', nombre: 'Para todo lo que cambie algo', ayuda: 'Te pide permiso cada vez, junto, en una sola tarjeta.' },
  { id: 'nunca', nombre: 'Nunca', ayuda: 'Hace lo que le pidas sin preguntar. Sigue valiendo lo que permitiste arriba.' },
]

const PASOS = ['Proveedor y modelo', 'Nombre', 'Qué puede hacer', 'Instrucciones'] as const

export function FormularioAgente({ id, borrador: inicial }: { id: string | 'nuevo'; borrador?: BorradorAgente }) {
  const { ia, puede, recargar, ir } = useConfigIA()
  const miembros = useTienda((s) => s.miembros)
  const existente = id === 'nuevo' ? null : (ia.agentes.find((a) => a.miembroId === id) ?? null)
  const [b, setB] = useState<BorradorAgente>(() => inicial ?? (existente ? borradorDe(existente, ia.claves) : conPredeterminados(borradorNuevo(), ia)))
  const [paso, setPaso] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [archivando, setArchivando] = useState(false)
  const cambiar = (c: Partial<BorradorAgente>) => setB((x) => ({ ...x, ...c }))
  const nuevo = !existente
  const e = errores(b, miembros.map((m) => ({ miembroId: m.id, alias: m.alias ?? '', nombre: m.nombre })), existente?.miembroId)
  const sinPermiso = !puede

  if (id !== 'nuevo' && !existente)
    return (
      <>
        <Volver />
        <p className="ia-aviso">Ese agente ya no está. Puede que lo hayan archivado desde otro lado.</p>
      </>
    )

  const visible = (n: number) => !nuevo || paso === n
  // Cada paso solo deja seguir si lo suyo está bien (los errores se ven al intentar, no antes de escribir).
  const bien = [!e.modelo && !e.precio, !e.nombre && !e.alias, !e.tope, true][paso]!

  async function guardar() {
    setError('')
    setGuardando(true)
    try {
      const a = await apiIA.guardarAgente(aEntrada(b, existente?.miembroId))
      avisar({ texto: nuevo ? `${a.nombre} está listo. Mencionalo con @${a.alias}.` : 'Cambios guardados.', tipo: 'ok', duracion: 2400 })
      await recargar()
      ir({ tipo: 'inicio' })
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x))
      setGuardando(false)
    }
  }

  async function archivar() {
    setGuardando(true)
    try {
      await apiIA.archivarAgente(existente!.miembroId)
      avisar({ texto: `${existente!.nombre} quedó archivado.`, tipo: 'ok', duracion: 2400 })
      await recargar()
      ir({ tipo: 'inicio' })
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
        if (nuevo && paso < PASOS.length - 1) return bien && setPaso(paso + 1)
        if (Object.keys(e).length === 0) void guardar()
      }}
    >
      <Volver />
      <header className="ia-formulario__cabecera">
        {existente ? <Avatar miembro={miembros.find((m) => m.id === existente.miembroId)} tam={40} /> : <span className="ia-formulario__chispa" aria-hidden><Sparkles size={20} /></span>}
        <div>
          <h4>{existente ? existente.nombre : 'Agregar agente'}</h4>
          {existente ? <PildoraEstado estado={existente.estado} /> : <p>Paso {paso + 1} de {PASOS.length} · {PASOS[paso]}</p>}
        </div>
      </header>
      {sinPermiso && <p className="ia-aviso ia-aviso--lectura" role="status">{SOLO_CON_CUENTA}</p>}

      <fieldset className="ia-formulario__cuerpo" disabled={sinPermiso || guardando}>
        {visible(0) && <PasoProveedor b={b} cambiar={cambiar} existente={existente} />}
        {visible(1) && <PasoNombre b={b} cambiar={cambiar} e={e} mostrarErrores={!nuevo || paso >= 1} />}
        {visible(2) && (
          <>
            <PasoPermisos b={b} cambiar={cambiar} />
            <PasoTope b={b} cambiar={cambiar} e={e} existente={existente} />
          </>
        )}
        {visible(3) && <PasoInstrucciones b={b} cambiar={cambiar} />}
        {!nuevo && <Proactivo b={b} cambiar={cambiar} e={e} />}
        {!nuevo && (
          <Grupo titulo="Otras opciones">
            <Fila nombre="Prendido" descripcion="Apagado, no responde ni dispara nada. No se pierde nada de lo pendiente.">
              <Interruptor valor={b.activo} etiqueta="Agente prendido" alCambiar={(v) => cambiar({ activo: v })} />
            </Fila>
            <Fila nombre="Puede mencionar a otras IA" descripcion="Apagado de fábrica: dos IA que se mencionan sin parar son plata que se va. Si lo prendés, son dos saltos como máximo, con espera entre respuestas.">
              <Interruptor valor={b.puedeMencionarIA} etiqueta="Puede mencionar a otras IA" alCambiar={(v) => cambiar({ puedeMencionarIA: v })} />
            </Fila>
          </Grupo>
        )}
      </fieldset>

      {error && (
        <p className="ia-aviso ia-aviso--error" role="alert">
          {error}
        </p>
      )}

      <footer className="ia-formulario__pie">
        {nuevo && paso > 0 ? (
          <button type="button" className="boton" onClick={() => setPaso(paso - 1)} disabled={guardando}>
            Atrás
          </button>
        ) : (
          <button type="button" className="boton boton--fantasma" onClick={() => ir({ tipo: 'inicio' })} disabled={guardando}>
            Cancelar
          </button>
        )}
        {nuevo && paso < PASOS.length - 1 ? (
          <button type="submit" className="boton boton--primario" disabled={sinPermiso || !bien}>
            Siguiente
          </button>
        ) : (
          <button type="submit" className="boton boton--primario" disabled={sinPermiso || guardando || Object.keys(e).length > 0}>
            {guardando ? <Girando tam={14} /> : null} {nuevo ? 'Crear agente' : 'Guardar'}
          </button>
        )}
        {existente &&
          (archivando ? (
            <span className="ia-formulario__archivar" role="alert">
              ¿Archivar a {existente.nombre}? Deja de aparecer al mencionar y no responde más. No se borra nada.
              <button type="button" className="boton boton--chico boton--peligro" onClick={archivar} disabled={sinPermiso || guardando}>
                Archivar
              </button>
              <button type="button" className="boton boton--chico boton--fantasma" onClick={() => setArchivando(false)}>
                No
              </button>
            </span>
          ) : (
            <button type="button" className="boton boton--fantasma boton--peligro ia-formulario__archivar-boton" onClick={() => setArchivando(true)} disabled={sinPermiso || guardando}>
              <Archive size={14} aria-hidden /> Archivar agente
            </button>
          ))}
      </footer>
    </form>
  )
}

/** El modelo de fábrica de Claude (si el catálogo del servidor no lo trae, el primero que traiga) y la primera clave de Anthropic que haya. */
function conPredeterminados(b: BorradorAgente, ia: EstadoIA): BorradorAgente {
  const modelos = modelosDe(opcionPorId(b.opcion), ia.modelos)
  const modelo = modelos.length && !modelos.some((m) => m.id === b.modelo) ? modelos[0]!.id : b.modelo
  return { ...b, modelo, claveId: clavesDe(b.opcion, ia.claves)[0]?.id ?? null }
}

/** Las claves cargadas que sirven para un proveedor (las de «compatible» se distinguen por su dirección). */
function clavesDe(id: IdOpcion, claves: readonly ClaveIA[]): ClaveIA[] {
  const o = opcionPorId(id)
  return claves.filter((c) => c.proveedor === o.proveedor && (o.proveedor !== 'compatible' || opcionDeClave(c.urlBase) === o.id))
}

function Volver() {
  const { ir } = useConfigIA()
  return (
    <button type="button" className="ia-volver" onClick={() => ir({ tipo: 'inicio' })}>
      <ArrowLeft size={15} aria-hidden /> IA
    </button>
  )
}

type Props = { b: BorradorAgente; cambiar: (c: Partial<BorradorAgente>) => void }

// ───────── 1 · Proveedor, clave y modelo ─────────

function PasoProveedor({ b, cambiar, existente }: Props & { existente: Agente | null }) {
  const { ia, ir } = useConfigIA()
  const o = opcionPorId(b.opcion)
  const claves = clavesDe(b.opcion, ia.claves)
  const modelos = modelosDe(o, ia.modelos)
  const conocido = modelos.find((m) => m.id === b.modelo)
  // Sin catálogo (o con un modelo que no figura, o «Otro»), el nombre se escribe a mano.
  const aMano = b.modeloAMano || o.pideUrlBase || modelos.length === 0 || (!!b.modelo && !conocido)
  const veImagenes = o.exigePrecios ? b.veImagenes === 'si' : (conocido?.veImagenes ?? true)

  function elegirOpcion(id: IdOpcion) {
    const n = opcionPorId(id)
    const delServidor = modelosDe(n, ia.modelos)
    cambiar({
      opcion: id,
      claveId: clavesDe(id, ia.claves)[0]?.id ?? null,
      modelo: delServidor.find((m) => m.id === n.modeloSugerido)?.id ?? delServidor[0]?.id ?? n.modeloSugerido ?? '',
      modeloAMano: false,
    })
  }

  return (
    <Grupo titulo="Proveedor y modelo">
      <Campo etiqueta="Proveedor" ayuda={o.aviso}>
        {(p) => (
          <SelectNativo {...p} value={b.opcion} onChange={(ev) => elegirOpcion(ev.target.value as IdOpcion)}>
            {OPCIONES_PROVEEDOR.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nombre}
              </option>
            ))}
          </SelectNativo>
        )}
      </Campo>
      <Campo etiqueta="Clave" ayuda={claves.length === 0 ? 'Todavía no cargaste una clave de este proveedor.' : 'Con esta clave se paga lo que use el agente.'}>
        {(p) => (
          <SelectNativo
            {...p}
            value={b.claveId ?? ''}
            onChange={(ev) => (ev.target.value === '__nueva' ? ir({ tipo: 'clave', id: 'nueva', opcion: b.opcion, volver: { id: existente?.miembroId ?? 'nuevo', borrador: b } }) : cambiar({ claveId: ev.target.value || null }))}
          >
            <option value="">Sin clave por ahora</option>
            {claves.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} · termina en …{c.ultimos4}
              </option>
            ))}
            <option value="__nueva">Agregar una clave…</option>
          </SelectNativo>
        )}
      </Campo>
      <Campo etiqueta="Modelo" ayuda={conocido?.aviso ?? (conocido?.costo ? 'El costo es una estimación de una respuesta común en una tarjeta.' : undefined)}>
        {(p) =>
          aMano ? (
            <input {...p} className="campo" value={b.modelo} placeholder={o.pideUrlBase ? 'El nombre del modelo, tal cual lo pide el servicio' : o.modeloSugerido ?? ''} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(ev) => cambiar({ modelo: ev.target.value.trim(), modeloAMano: true })} />
          ) : (
            <SelectNativo {...p} value={conocido ? b.modelo : ''} onChange={(ev) => (ev.target.value === '__otro' ? cambiar({ modeloAMano: true }) : cambiar({ modelo: ev.target.value, modeloAMano: false }))}>
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                  {m.costo ? ` · ≈ USD ${m.costo.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por respuesta` : ''}
                </option>
              ))}
              <option value="__otro">Otro modelo (escribir el nombre)…</option>
            </SelectNativo>
          )
        }
      </Campo>
      {o.exigePrecios && (
        <>
          <div className="ia-campos-fila">
            <Campo etiqueta="Precio de entrada" ayuda="USD por millón de tokens">
              {(p) => <input {...p} className="campo" inputMode="decimal" value={b.precioEntrada} onChange={(ev) => cambiar({ precioEntrada: ev.target.value })} />}
            </Campo>
            <Campo etiqueta="Precio de salida" ayuda="USD por millón de tokens">
              {(p) => <input {...p} className="campo" inputMode="decimal" value={b.precioSalida} onChange={(ev) => cambiar({ precioSalida: ev.target.value })} />}
            </Campo>
            <Campo etiqueta="Caché (lectura)" ayuda="Si no tiene, 0">
              {(p) => <input {...p} className="campo" inputMode="decimal" value={b.precioCache} onChange={(ev) => cambiar({ precioCache: ev.target.value })} />}
            </Campo>
          </div>
          <Fila nombre="Ve imágenes" descripcion="Para que pueda mirar lo que arma en Diseño.">
            <Interruptor valor={b.veImagenes === 'si'} etiqueta="Ve imágenes" alCambiar={(v) => cambiar({ veImagenes: v ? 'si' : 'no' })} />
          </Fila>
        </>
      )}
      {b.permisos.includes('diseno') && !veImagenes && (
        <p className="ia-aviso">
          <Info size={14} aria-hidden /> Este modelo no ve imágenes: va a diseñar sin mirar el resultado.
        </p>
      )}
    </Grupo>
  )
}

/** Qué opción de «compatible» es una clave, por su dirección (Gemini, DeepSeek u otra). */
function opcionDeClave(urlBase: string | null): IdOpcion {
  return OPCIONES_PROVEEDOR.find((o) => o.proveedor === 'compatible' && o.urlBase && urlBase?.startsWith(o.urlBase.replace(/\/+$/, '')))?.id ?? 'otro'
}

// ───────── 2 · Nombre, alias y color ─────────

function PasoNombre({ b, cambiar, e, mostrarErrores }: Props & { e: ReturnType<typeof errores>; mostrarErrores: boolean }) {
  const [tocado, setTocado] = useState({ nombre: false, alias: false })
  return (
    <Grupo titulo="Quién es">
      <Campo etiqueta="Nombre" error={mostrarErrores && tocado.nombre ? e.nombre : undefined} ayuda="Así firma sus respuestas y así aparece en la actividad.">
        {(p) => (
          <input
            {...p}
            className="campo"
            value={b.nombre}
            maxLength={40}
            autoComplete="off"
            onChange={(ev) => cambiar({ nombre: ev.target.value })}
            onBlur={() => setTocado((t) => ({ ...t, nombre: true }))}
          />
        )}
      </Campo>
      <Campo etiqueta="Alias" error={mostrarErrores && (tocado.alias || b.aliasTocado) ? e.alias : undefined} ayuda={`Así lo mencionás en un comentario: @${aliasDe(b) || 'alias'}.`}>
        {(p) => (
          <span className="perfil__alias">
            <span aria-hidden>@</span>
            <input
              {...p}
              value={b.aliasTocado ? b.alias : aliasDe(b)}
              maxLength={32}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(ev) => cambiar({ alias: ev.target.value, aliasTocado: true })}
              onBlur={() => setTocado((t) => ({ ...t, alias: true }))}
            />
          </span>
        )}
      </Campo>
      <div className="perfil__campo" role="group" aria-label="Color">
        <span>Color</span>
        <div className="perfil__colores">
          {COLORES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`herramientas__color${b.color === c.id ? ' herramientas__color--activo' : ''}`}
              style={{ background: `var(--e-${c.id}-s)` }}
              aria-label={c.nombre}
              aria-pressed={b.color === c.id}
              onClick={() => cambiar({ color: c.id as Color })}
            />
          ))}
        </div>
      </div>
    </Grupo>
  )
}

// ───────── 3 · Qué puede hacer, cuándo pide permiso, cuánto puede gastar ─────────

function PasoPermisos({ b, cambiar }: Props) {
  const { ia } = useConfigIA()
  const mismos = (a: readonly Capacidad[]) => a.length === b.permisos.length && a.every((c) => b.permisos.includes(c))
  const hayPreajuste = PREAJUSTES_PERMISOS.some((p) => mismos(p.permisos))
  const tieneGitHub = ia.claves.some((c) => c.proveedor === 'github')
  const alternar = (c: Capacidad, v: boolean) => cambiar({ permisos: CAPACIDADES.filter((x) => (x === c ? v : b.permisos.includes(x))) })
  return (
    <>
      <Grupo titulo="Qué puede hacer" bajada="Se puede cambiar cuando quieras. Lo que no marques, el agente no lo puede hacer aunque se lo pidan.">
        <div className="ia-preajustes" role="group" aria-label="Combinaciones de permisos">
          {PREAJUSTES_PERMISOS.map((p) => (
            <button key={p.id} type="button" className={`boton boton--chico${mismos(p.permisos) ? ' ia-preajuste--activo' : ''}`} aria-pressed={mismos(p.permisos)} onClick={() => cambiar({ permisos: [...p.permisos] })}>
              {p.nombre}
            </button>
          ))}
          {!hayPreajuste && <span className="ia-preajuste-medida">A medida</span>}
        </div>
        <ul className="ia-capacidades">
          {CAPACIDADES.map((c) => (
            <li key={c}>
              <label className="ia-capacidad">
                <input type="checkbox" checked={b.permisos.includes(c)} onChange={(ev) => alternar(c, ev.target.checked)} />
                <span>
                  <b>{NOMBRE_CAPACIDAD[c]}</b>
                  <small>
                    {CAPACIDADES_TEXTO[c][0]!.toUpperCase() + CAPACIDADES_TEXTO[c].slice(1)}
                    {c === 'codigo' && !tieneGitHub && b.permisos.includes('codigo') && '. Falta cargar el token de GitHub (más abajo en esta pantalla).'}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Grupo>
      <Grupo titulo="Pedime permiso">
        <div className="ia-opciones" role="radiogroup" aria-label="Cuándo pide permiso">
          {CONFIRMAR.map((c) => (
            <label key={c.id} className="ia-capacidad">
              <input type="radio" name="confirmar" checked={b.confirmar === c.id} onChange={() => cambiar({ confirmar: c.id })} />
              <span>
                <b>{c.nombre}</b>
                <small>{c.ayuda}</small>
              </span>
            </label>
          ))}
        </div>
      </Grupo>
    </>
  )
}

function PasoTope({ b, cambiar, e, existente }: Props & { e: ReturnType<typeof errores>; existente: Agente | null }) {
  return (
    <Grupo titulo="Tope por mes">
      <Campo etiqueta="Tope por mes (USD)" error={e.tope} ayuda="Al 80 % te aviso. Al 100 % frena sin perder nada.">
        {(p) => <input {...p} className="campo ia-numero" inputMode="decimal" value={b.topeMesUsd} onChange={(ev) => cambiar({ topeMesUsd: ev.target.value })} />}
      </Campo>
      {existente && <BarraGasto gasto={existente.gastoMesUsd} tope={aNumero(b.topeMesUsd) > 0 ? aNumero(b.topeMesUsd) : existente.topeMesUsd} etiqueta={`Gasto de ${existente.nombre} este mes`} />}
    </Grupo>
  )
}

// ───────── 4 · Instrucciones ─────────

function PasoInstrucciones({ b, cambiar }: Props) {
  return (
    <Grupo titulo="Instrucciones" bajada="Opcional. Cómo querés que trabaje en tu tablero (tono, qué mirar primero, qué nunca hacer). Lo que lee en las tarjetas son datos, no órdenes: estas instrucciones sí.">
      <Campo etiqueta="Instrucciones propias" ayuda={`${b.instrucciones.length} de 4.000`}>
        {(p) => <textarea {...p} className="campo-texto" rows={6} maxLength={4000} value={b.instrucciones} onChange={(ev) => cambiar({ instrucciones: ev.target.value })} />}
      </Campo>
    </Grupo>
  )
}

// ───────── Trabajar sin que lo mencionen (F.4) ─────────

function Proactivo({ b, cambiar, e }: Props & { e: ReturnType<typeof errores> }) {
  const tablero = useTienda((s) => s.tablero)
  const listas = (tablero?.listas ?? []).filter((l) => !l.archivada)
  const deOtros = b.listas.filter((id) => !listas.some((l) => l.id === id))
  const prendido = b.tarjetaNueva || b.resumenDiario
  return (
    <Grupo titulo="Trabajar sin que lo mencionen" bajada="Apagado de fábrica. Con esto prendido el agente mira por su cuenta y gasta de su tope; hasta el máximo de acá por día. Nunca menciona a otros ni dispara a otros agentes.">
      <Fila nombre="Revisar las tarjetas nuevas" descripcion="Cuando entra una tarjeta a las listas que elijas, la lee, comenta qué encontró («Revisado»), recomienda prioridad y lista, y deja una respuesta para Discord lista (que no se manda).">
        <Interruptor valor={b.tarjetaNueva} etiqueta="Revisar las tarjetas nuevas" alCambiar={(v) => cambiar({ tarjetaNueva: v })} />
      </Fila>
      {b.tarjetaNueva && (
        <div className="ia-listas" role="group" aria-label="Listas que revisa">
          <span className="perfil__ayuda">Las listas de «{tablero?.tablero.nombre ?? 'este tablero'}» (sugerida: la bandeja de Discord):</span>
          {listas.map((l) => (
            <label key={l.id} className="ia-capacidad ia-capacidad--lista">
              <input type="checkbox" checked={b.listas.includes(l.id)} onChange={(ev) => cambiar({ listas: ev.target.checked ? [...b.listas, l.id] : b.listas.filter((x) => x !== l.id) })} />
              <span>
                <b>{l.nombre}</b>
              </span>
            </label>
          ))}
          {deOtros.length > 0 && (
            <span className="perfil__ayuda">
              Y {deOtros.length === 1 ? 'una lista de otro tablero' : `${deOtros.length} listas de otros tableros`}, que se mantienen.
            </span>
          )}
          {e.listas && (
            <span className="perfil__ayuda perfil__ayuda--error" role="alert">
              {e.listas}
            </span>
          )}
        </div>
      )}
      <Fila nombre="Resumen diario" descripcion="Una vez por día, a la mañana: lo trabado, lo vencido y qué conviene hacer primero. Te llega como notificación.">
        <Interruptor valor={b.resumenDiario} etiqueta="Resumen diario" alCambiar={(v) => cambiar({ resumenDiario: v })} />
      </Fila>
      {prendido && (
        <>
          <Fila nombre="Autonomía" descripcion="«Solo sugiere»: comenta y avisa, no mueve nada. «También actúa»: además mueve tarjetas y cambia estados, con permiso de «Tarjetas» y con deshacer." apilada>
            <Segmentado
              opciones={[
                { id: 'sugiere', nombre: 'Solo sugiere' },
                { id: 'actua', nombre: 'También actúa' },
              ]}
              valor={b.autonomia}
              alCambiar={(v) => cambiar({ autonomia: v })}
              etiqueta="Autonomía"
              tam="grande"
            />
          </Fila>
          <Campo etiqueta="Máximo de trabajos por día" ayuda={`Si llega, descansa hasta mañana. De fábrica ${MAX_PROACTIVOS_POR_DIA}.`}>
            {(p) => <input {...p} className="campo ia-numero" inputMode="numeric" value={b.maxPorDia} onChange={(ev) => cambiar({ maxPorDia: ev.target.value.replace(/\D/g, '') })} />}
          </Campo>
        </>
      )}
    </Grupo>
  )
}
