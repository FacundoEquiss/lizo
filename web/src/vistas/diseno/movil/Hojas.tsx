// Las hojas de Diseño en el teléfono (la hoja inferior de siempre: se cierran con "atrás", deslizando el agarre o tocando
// afuera). Una sola a la vez; la que abre otra cosa se cierra primero (cerrarYLuego), así el historial queda en orden.
// Acá, la lista de marcos y el menú de un marco; las grandes viven en su archivo.
import { ChevronRight, Info, Link2, Maximize2, MessageCircle, Share2 } from 'lucide-react'
import { useMemo, useRef } from 'react'
import type { MarcoResumen } from '../../../../../compartido/diseno/tipos'
import { avisar } from '../../../estado/avisos'
import { FilaTactil } from '../../../movil/ui/FilaTactil'
import { HojaInferior, useHoja } from '../../../movil/ui/HojaInferior'
import { urlMiniatura } from '../api'
import { useDiseno } from '../estado'
import { enlaceA } from '../ruta'
import { copiarTexto } from './compartir'
import { useDisenoMovil, type HojaDiseno } from './estado'
import { HojaCapa } from './HojaCapa'
import { HojaComentarios } from './HojaComentarios'
import { HojaCompartir } from './HojaCompartir'
import { HojaDetalles } from './HojaDetalles'
import { HojaItem } from './HojaItem'
import { HojaTexto } from './HojaTexto'
import { enOrden } from './util'

/** Lo último que se mostró mientras la hoja estaba abierta: al cerrarse, la hoja baja con su contenido (no vacía). */
export function useUltimo<T>(valor: T | null | undefined): T | null {
  const ref = useRef<T | null>(null)
  if (valor != null) ref.current = valor
  return ref.current
}

/** La hoja abierta, si es de ese tipo. */
export function useHojaDe<K extends HojaDiseno['tipo']>(tipo: K): Extract<HojaDiseno, { tipo: K }> | null {
  return useDisenoMovil((s) => (s.hoja?.tipo === tipo ? (s.hoja as Extract<HojaDiseno, { tipo: K }>) : null))
}

export function cerrarHoja() {
  useDisenoMovil.getState().cerrarHoja()
}

export function Hojas() {
  return (
    <>
      <HojaMarcos />
      <HojaMenuMarco />
      <HojaComentarios />
      <HojaCompartir />
      <HojaDetalles />
      <HojaItem />
      <HojaTexto />
      <HojaCapa />
    </>
  )
}

/** Copia el enlace a un marco (el mismo que copia la PC: abre el marco en cualquier dispositivo). */
export async function copiarEnlaceMarco(marco: string) {
  const pagina = useDiseno.getState().pagina
  const ok = await copiarTexto(enlaceA(pagina?.slug ?? null, marco))
  avisar(ok ? { texto: 'Enlace copiado', tipo: 'ok', duracion: 1600 } : { texto: 'No pude copiar: el navegador no dio permiso.', tipo: 'error' })
}

// ───────── Marcos de la página ─────────

function HojaMarcos() {
  const abierta = !!useHojaDe('marcos')
  const pagina = useDiseno((s) => s.pagina)
  return (
    <HojaInferior abierta={abierta} alCerrar={cerrarHoja} titulo={pagina ? `Marcos de «${pagina.nombre}»` : 'Marcos'} className="dzm-hoja">
      <ListaMarcos />
    </HojaInferior>
  )
}

function ListaMarcos() {
  const hoja = useHoja()
  const marcos = useDiseno((s) => s.marcos)
  const prefijo = useDiseno((s) => s.prefijo)!
  const secciones = useMemo(() => {
    const r: { nombre: string; marcos: MarcoResumen[] }[] = []
    for (const m of enOrden(marcos)) {
      const s = m.seccion || ''
      let g = r.find((x) => x.nombre === s)
      if (!g) r.push((g = { nombre: s, marcos: [] }))
      g.marcos.push(m)
    }
    return r
  }, [marcos])
  return (
    <div className="diseno dzm-marcos">
      {secciones.map((s) => (
        <section key={s.nombre} className="dzm-marcos__seccion">
          {s.nombre && <h3 className="dzm-subtitulo">{s.nombre}</h3>}
          {s.marcos.map((m) => (
            <button key={m.id} type="button" className="dzm-fila-marco" onClick={() => hoja?.cerrarYLuego(() => useDisenoMovil.getState().abrirVisor(m.id))}>
              <span className="dzm-fila-marco__mini">
                <img src={urlMiniatura(prefijo, m)} alt="" loading="lazy" decoding="async" draggable={false} style={{ aspectRatio: `${m.ancho} / ${m.alto}` }} />
              </span>
              <span className="dzm-fila-marco__texto">
                <span className="dzm-fila-marco__nombre">{m.nombre}</span>
                <span className="dzm-fila-marco__detalle">
                  {m.ancho} × {m.alto}
                  {m.comentarios ? ` · ${m.comentarios} ${m.comentarios === 1 ? 'comentario' : 'comentarios'}` : ''}
                  {m.tarjetas.length ? ` · ${m.tarjetas.join(', ')}` : ''}
                </span>
              </span>
              <ChevronRight size={18} className="dzm-fila-marco__flecha" aria-hidden />
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

// ───────── Mantener apretado un marco ─────────

function HojaMenuMarco() {
  const h = useHojaDe('menu')
  const ultimo = useUltimo(h)
  const m = useDiseno((s) => s.marcos.find((x) => x.id === ultimo?.marco) ?? null)
  return (
    <HojaInferior abierta={!!h} alCerrar={cerrarHoja} titulo={m?.nombre ?? 'Marco'} className="dzm-hoja">
      {m && <MenuMarco m={m} />}
    </HojaInferior>
  )
}

function MenuMarco({ m }: { m: MarcoResumen }) {
  const hoja = useHoja()
  const ir = (fn: () => void) => hoja?.cerrarYLuego(fn)
  const st = useDisenoMovil.getState
  return (
    <div className="dzm-menu">
      <p className="dzm-menu__bajada">
        {m.ancho} × {m.alto}
        {m.origen === 'importado' ? ' · viene del código' : ''}
      </p>
      <FilaTactil icono={<Maximize2 size={20} />} texto="Abrir" flecha onClick={() => ir(() => st().abrirVisor(m.id))} />
      <FilaTactil
        icono={<MessageCircle size={20} />}
        texto="Comentarios"
        detalle={m.comentarios ? <span className="dzm-cuenta">{m.comentarios}</span> : undefined}
        flecha
        onClick={() => ir(() => st().abrirVisor(m.id, { tipo: 'comentarios', marco: m.id }))}
      />
      <FilaTactil icono={<Share2 size={20} />} texto="Compartir la imagen" flecha onClick={() => ir(() => st().abrirHoja({ tipo: 'compartir', marco: m.id }))} />
      <FilaTactil
        icono={<Link2 size={20} />}
        texto="Copiar el enlace"
        onClick={() => {
          // Se copia durante el toque (el navegador no deja copiar después) y recién ahí se cierra.
          void copiarEnlaceMarco(m.id)
          hoja?.cerrar()
        }}
      />
      <FilaTactil icono={<Info size={20} />} texto="Detalles" flecha onClick={() => ir(() => st().abrirHoja({ tipo: 'detalles', marco: m.id }))} />
    </div>
  )
}
