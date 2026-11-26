// Secciones del inspector que no son propiedades: Tarjetas vinculadas, Exportar y Revisiones (plan 6.6 y 6.7).
import { Download, History, Paperclip, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MarcoResumen } from '../../../../../compartido/diseno/tipos'
import { api } from '../../../estado/api'
import { avisar, avisarError } from '../../../estado/avisos'
import { irA } from '../../../estado/ruta'
import { useTienda } from '../../../estado/tienda'
import { IconoTipo } from '../../../ui/comunes'
import { Desplegable, Selector } from '../../../ui/Desplegable'
import { apiDiseno, urlRender, type VinculoTarjeta } from '../api'
import { useDiseno } from '../estado'
import { cuando } from '../panel-izq/PastillaSync'
import { Interruptor, Seccion } from '../ui'

export function Tarjetas({ objetivo }: { objetivo: string }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const tarjetasTablero = useTienda((s) => s.tablero?.tarjetas)
  const [lista, setLista] = useState<VinculoTarjeta[] | null>(null)
  const [v, setV] = useState(0)
  useEffect(() => {
    let vivo = true
    apiDiseno
      .vinculos(prefijo, objetivo)
      .then((r) => vivo && setLista(r))
      .catch(() => vivo && setLista([]))
    return () => {
      vivo = false
    }
  }, [prefijo, objetivo, v])
  const opciones = useMemo(
    () =>
      (tarjetasTablero ?? [])
        .filter((t) => !lista?.some((x) => x.clave === t.clave))
        .map((t) => ({ id: t.clave, etiqueta: `${t.clave} · ${t.titulo}`, buscar: `${t.clave} ${t.titulo}`, icono: <IconoTipo tipo={t.tipo} tam={14} /> })),
    [tarjetasTablero, lista],
  )
  const vincular = async (clave: string) => {
    try {
      await apiDiseno.vincular(prefijo, objetivo, clave)
      setV((x) => x + 1)
      void useDiseno.getState().recargarPagina()
    } catch (e) {
      avisarError(e)
    }
  }
  return (
    <Seccion
      titulo="Tarjetas"
      accion={
        <Desplegable
          lado="left-start"
          ancho={300}
          disparador={(p) => (
            <button {...p} className="boton-icono boton-icono--chico" aria-label="Vincular una tarjeta" data-tip="Vincular tarjeta…">
              <Plus size={14} />
            </button>
          )}
        >
          {(cerrar) => (
            <Selector
              opciones={opciones}
              elegidas={[]}
              placeholder="Buscar una tarjeta…"
              vacio="No hay tarjetas con ese nombre"
              alElegir={(clave) => {
                cerrar()
                void vincular(clave)
              }}
            />
          )}
        </Desplegable>
      }
    >
      {lista && lista.length === 0 && <p className="dz-inota">Sin tarjetas vinculadas.</p>}
      {lista?.map((t) => (
        <div key={t.clave} className="dz-tarjeta-vinculada">
          <button className="dz-tarjeta-vinculada__boton" onClick={() => irA({ tarjeta: t.clave })}>
            <IconoTipo tipo={t.tipo as never} tam={14} />
            <span className="dz-tarjeta-vinculada__clave">{t.clave}</span>
            <span className="dz-tarjeta-vinculada__titulo">{t.titulo}</span>
            {t.lista && <span className="dz-tarjeta-vinculada__lista">{t.lista}</span>}
          </button>
          <button
            className="boton-icono boton-icono--chico"
            aria-label={`Desvincular ${t.clave}`}
            onClick={async () => {
              try {
                await apiDiseno.desvincular(prefijo, objetivo, t.clave)
                setV((x) => x + 1)
                void useDiseno.getState().recargarPagina()
              } catch (e) {
                avisarError(e)
              }
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </Seccion>
  )
}

const FORMATOS = ['png', 'jpg', 'svg'] as const

export function Exportar({ marco, prefijo }: { marco: MarcoResumen; prefijo: string }) {
  const [formato, setFormato] = useState<(typeof FORMATOS)[number]>('png')
  const [escala, setEscala] = useState(2)
  const [sinFondo, setSinFondo] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const nombreArchivo = `${marco.nombre.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').toLowerCase() || 'marco'}-${marco.ancho}x${marco.alto}${formato === 'svg' ? '' : `@${escala}x`}.${formato}`
  const descargar = () => {
    const a = document.createElement('a')
    a.href = urlRender(prefijo, marco.id, { formato, escala, sinFondo, descargar: true })
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  const adjuntar = async (clave: string) => {
    setTrabajando(true)
    try {
      const r = await fetch(urlRender(prefijo, marco.id, { formato, escala, sinFondo }))
      if (!r.ok) throw new Error(`No se pudo dibujar el marco (${r.status}).`)
      const blob = await r.blob()
      await api.subirAdjunto(clave, new File([blob], nombreArchivo, { type: blob.type }))
      avisar({ texto: `Adjunté ${nombreArchivo} a ${clave}.`, tipo: 'ok', accion: { etiqueta: 'Ver', fn: () => irA({ tarjeta: clave }) } })
    } catch (e) {
      avisarError(e)
    } finally {
      setTrabajando(false)
    }
  }
  return (
    <Seccion titulo="Exportar">
      <div className="dz-exportar">
        <div className="segmentado segmentado--chico">
          {FORMATOS.map((f) => (
            <button key={f} className={`segmentado__opcion${formato === f ? ' segmentado__opcion--activa' : ''}`} onClick={() => setFormato(f)}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="segmentado segmentado--chico">
          {[1, 2, 3].map((e) => (
            <button key={e} disabled={formato === 'svg'} className={`segmentado__opcion${escala === e && formato !== 'svg' ? ' segmentado__opcion--activa' : ''}`} onClick={() => setEscala(e)}>
              {e}x
            </button>
          ))}
        </div>
      </div>
      <label className="dz-fila dz-fila--interruptor">
        <span className="dz-fila__etiqueta">Sin fondo</span>
        <Interruptor etiqueta="Sin fondo" valor={sinFondo} apagado={formato === 'jpg'} alCambiar={setSinFondo} />
      </label>
      <p className="dz-inota dz-inota--mono">{nombreArchivo}</p>
      <div className="dz-exportar__botones">
        <button className="boton boton--primario boton--chico" onClick={descargar} data-tecla="$mod+Shift+E">
          <Download size={13} /> Exportar
        </button>
        <AdjuntarATarjeta alElegir={adjuntar} ocupado={trabajando} vinculadas={marco.tarjetas} />
      </div>
    </Seccion>
  )
}

function AdjuntarATarjeta({ alElegir, ocupado, vinculadas }: { alElegir: (clave: string) => void; ocupado: boolean; vinculadas: string[] }) {
  const tarjetas = useTienda((s) => s.tablero?.tarjetas)
  const opciones = useMemo(() => {
    const todas = (tarjetas ?? []).map((t) => ({ id: t.clave, etiqueta: `${t.clave} · ${t.titulo}`, buscar: `${t.clave} ${t.titulo}`, icono: <IconoTipo tipo={t.tipo} tam={14} />, grupo: vinculadas.includes(t.clave) ? 'Vinculadas' : 'Todas' }))
    return [...todas.filter((t) => t.grupo === 'Vinculadas'), ...todas.filter((t) => t.grupo !== 'Vinculadas')]
  }, [tarjetas, vinculadas])
  if (vinculadas.length === 1)
    return (
      <button className="boton boton--chico" disabled={ocupado} onClick={() => alElegir(vinculadas[0]!)}>
        <Paperclip size={13} /> Adjuntar a {vinculadas[0]}
      </button>
    )
  return (
    <Desplegable
      lado="left-start"
      ancho={300}
      disparador={(p) => (
        <button {...p} className="boton boton--chico" disabled={ocupado}>
          <Paperclip size={13} /> Adjuntar a la tarjeta
        </button>
      )}
    >
      {(cerrar) => (
        <Selector
          opciones={opciones}
          elegidas={[]}
          placeholder="¿A qué tarjeta?"
          alElegir={(clave) => {
            cerrar()
            alElegir(clave)
          }}
        />
      )}
    </Desplegable>
  )
}

export function Revisiones({ marco }: { marco: MarcoResumen }) {
  const prefijo = useDiseno((s) => s.prefijo)!
  const [abierta, setAbierta] = useState(false)
  const [lista, setLista] = useState<{ actual: number; revisiones: { n: number; actor: { nombre: string } | null; resumen: string; creadoEn: string }[] } | null>(null)
  useEffect(() => {
    if (!abierta) return
    let vivo = true
    apiDiseno
      .revisiones(prefijo, marco.id)
      .then((r) => vivo && setLista(r))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [abierta, prefijo, marco.id, marco.revision])
  return (
    <Seccion
      titulo="Revisiones"
      accion={
        <button className="boton-icono boton-icono--chico" aria-expanded={abierta} aria-label="Ver las revisiones" data-tip={abierta ? 'Esconder' : 'Ver las últimas 50'} onClick={() => setAbierta((a) => !a)}>
          <History size={14} />
        </button>
      }
    >
      {!abierta && <p className="dz-inota">Revisión {marco.revision}. Cada cambio guarda una; deshacer vuelve a la anterior.</p>}
      {abierta && lista && (
        <ul className="dz-revisiones">
          {lista.revisiones.map((r) => (
            <li key={r.n} className={`dz-revision${r.n === lista.actual ? ' dz-revision--actual' : ''}`}>
              <span className="dz-revision__n">{r.n}</span>
              <span className="dz-revision__texto">
                <span className="dz-revision__resumen">{r.resumen || 'cambio'}</span>
                <span className="dz-revision__quien">
                  {r.actor?.nombre ?? '—'} · {cuando(r.creadoEn)}
                </span>
              </span>
              {r.n !== lista.actual && (
                <button
                  className="boton boton--chico boton--fantasma"
                  onClick={async () => {
                    try {
                      const res = await apiDiseno.restaurar(prefijo, marco.id, r.n)
                      const s = useDiseno.getState()
                      const c = s.completos[marco.id]
                      useDiseno.setState({
                        completos: c ? { ...s.completos, [marco.id]: { ...c, marco: res.marco } } : s.completos,
                        aplicada: { ...s.aplicada, [marco.id]: -1 },
                      })
                      await s.recargarPagina()
                      avisar({ texto: `Volví a la revisión ${r.n}.`, tipo: 'ok' })
                    } catch (e) {
                      avisarError(e)
                    }
                  }}
                >
                  Restaurar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  )
}
