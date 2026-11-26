// La barra del marco (5.5): `[Color ▾] [Relleno ▾] | [Tamaño ▾] [Ajustar al contenido] | [Bloquear] | [⋯]`. Con varios
// marcos elegidos, cada cambio va a todos en un solo paso.
import { Focus, Lock, PanelLeft, Scan } from 'lucide-react'
import { leerMarco, type RellenoMarco, type TituloEnMarco } from '../../../../../compartido/lienzo'
import type { ElementoLienzo } from '../../../../../compartido/tipos'
import { useTienda } from '../../../estado/tienda'
import { useAccionesLienzo } from '../acciones'
import { conteoPorMarco } from '../indices'
import { cambiarDatos, useSeleccionLienzo } from '../seleccion'
import { BotonBarra, MenuBarra, Separador, type TamBarra } from './piezas'
import { SeccionColor } from './seccionColor'

/** Los tamaños rápidos: una diapositiva, una hoja o la pantalla del celular acostado. */
export const TAMANOS_MARCO: { id: string; nombre: string; ancho: number; alto: number }[] = [
  { id: '16:9', nombre: 'Diapositiva 16:9', ancho: 1280, alto: 720 },
  { id: '4:3', nombre: 'Diapositiva 4:3', ancho: 1024, alto: 768 },
  { id: 'a4', nombre: 'Hoja A4', ancho: 794, alto: 1123 },
  { id: 'celular', nombre: 'Celular horizontal', ancho: 844, alto: 390 },
]

const RELLENOS: { id: RellenoMarco; nombre: string; ayuda: string }[] = [
  { id: 'tinte', nombre: 'Tinte', ayuda: 'El color del marco, suave' },
  { id: 'tenue', nombre: 'Tenue', ayuda: 'Apenas se ve el área' },
  { id: 'liso', nombre: 'Liso', ayuda: 'Como una hoja' },
]

function useMarcos(elementos?: ElementoLienzo[]) {
  const sel = useSeleccionLienzo()
  return (elementos ?? sel.nodos).filter((e) => e.tipo === 'marco' && !e.bloqueado)
}

/** Muestra del relleno: un cuadradito con el color del marco elegido en ese relleno. */
function MuestraRelleno({ relleno, color }: { relleno: RellenoMarco; color: string }) {
  return (
    <span
      className={`muestra-relleno muestra-relleno--${relleno}`}
      style={{ ['--marco' as string]: `var(--m-${color})`, ['--marco-s' as string]: `var(--e-${color}-s)` }}
      aria-hidden
    />
  )
}

export function SeccionRellenoMarco({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useMarcos(elementos)
  if (!els.length) return null
  const d = leerMarco(els[0]!.datos)
  return (
    <MenuBarra etiqueta="Relleno" tam={tam} disparador={<MuestraRelleno relleno={d.relleno} color={d.color} />} ancho={230}>
      {(cerrar) => (
        <div className="menu__lista" role="listbox" aria-label="Relleno del marco">
          {RELLENOS.map((r) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={d.relleno === r.id}
              className={`menu__item menu__item--doble${d.relleno === r.id ? ' menu__item--activo' : ''}`}
              onClick={() => {
                cambiarDatos(els, { relleno: r.id }, 'relleno del marco')
                cerrar()
              }}
            >
              <span className="menu__icono">
                <MuestraRelleno relleno={r.id} color={d.color} />
              </span>
              <span className="menu__texto">
                {r.nombre}
                <small>{r.ayuda}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </MenuBarra>
  )
}

function IconoProporcion({ ancho, alto }: { ancho: number; alto: number }) {
  const k = 15 / Math.max(ancho, alto)
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
      <rect x={9 - (ancho * k) / 2} y={9 - (alto * k) / 2} width={ancho * k} height={alto * k} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1.6} />
    </svg>
  )
}

export function SeccionTamanoMarco({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useMarcos(elementos)
  const acciones = useAccionesLienzo()
  if (!els.length) return null
  const e = els[0]!
  const actual = TAMANOS_MARCO.find((t) => t.ancho === e.ancho && t.alto === e.alto)
  return (
    <MenuBarra etiqueta="Tamaño del marco" tam={tam} disparador={<IconoProporcion ancho={e.ancho} alto={e.alto} />} ancho={250}>
      {(cerrar) => (
        <div className="menu__lista" role="listbox" aria-label="Tamaño del marco">
          {TAMANOS_MARCO.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={actual?.id === t.id}
              className={`menu__item${actual?.id === t.id ? ' menu__item--activo' : ''}`}
              onClick={() => {
                acciones.tamanoMarco(t.ancho, t.alto, els.map((x) => x.id))
                cerrar()
              }}
            >
              <span className="menu__icono">
                <IconoProporcion ancho={t.ancho} alto={t.alto} />
              </span>
              <span className="menu__texto">{t.nombre}</span>
              <span className="menu__detalle">
                {t.ancho} × {t.alto}
              </span>
            </button>
          ))}
          <div className="menu__separador" />
          <div className={`menu__item menu__item--estatico${actual ? '' : ' menu__item--activo'}`} role="option" aria-selected={!actual}>
            <span className="menu__icono">
              <IconoProporcion ancho={e.ancho} alto={e.alto} />
            </span>
            <span className="menu__texto">Libre</span>
            <span className="menu__detalle">
              {Math.round(e.ancho)} × {Math.round(e.alto)}
            </span>
          </div>
        </div>
      )}
    </MenuBarra>
  )
}

const TITULOS: { id: TituloEnMarco; nombre: string; ayuda: string }[] = [
  { id: 'afuera', nombre: 'Afuera, arriba', ayuda: 'Como siempre' },
  { id: 'izquierda', nombre: 'Adentro, a la izquierda', ayuda: 'Un carril: título en vertical' },
  { id: 'arriba', nombre: 'Adentro, arriba', ayuda: 'Una franja con el título' },
]

/** Dónde va el título del marco: afuera, o adentro como un carril (andarivel) o una franja. */
export function SeccionTituloMarco({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const els = useMarcos(elementos)
  if (!els.length) return null
  const d = leerMarco(els[0]!.datos)
  return (
    <MenuBarra etiqueta="Dónde va el título" tam={tam} disparador={<PanelLeft size={16} />} ancho={250}>
      {(cerrar) => (
        <div className="menu__lista" role="listbox" aria-label="Dónde va el título del marco">
          {TITULOS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={d.tituloEn === t.id}
              className={`menu__item menu__item--doble${d.tituloEn === t.id ? ' menu__item--activo' : ''}`}
              onClick={() => {
                cambiarDatos(els, { tituloEn: t.id }, 'título del marco')
                cerrar()
              }}
            >
              <span className="menu__texto">{t.nombre}</span>
              <span className="menu__detalle">{t.ayuda}</span>
            </button>
          ))}
        </div>
      )}
    </MenuBarra>
  )
}

/** La barra completa del marco. */
export function SeccionMarco({ elementos, tam }: { elementos?: ElementoLienzo[]; tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const acciones = useAccionesLienzo()
  const els = useMarcos(elementos)
  const conContenido = useTienda((s) => {
    const conteo = s.tablero ? conteoPorMarco(s.tablero.elementos) : null
    return els.some((e) => (conteo?.get(e.id) ?? 0) > 0)
  })
  if (!els.length) return null
  const todos = elementos ?? sel.nodos
  return (
    <>
      <SeccionColor elementos={els} tam={tam} />
      <SeccionRellenoMarco elementos={els} tam={tam} />
      <SeccionTituloMarco elementos={els} tam={tam} />
      <Separador />
      <SeccionTamanoMarco elementos={els} tam={tam} />
      <BotonBarra
        tam={tam}
        etiqueta={conContenido ? 'Ajustar al contenido' : 'Ajustar al contenido (está vacío)'}
        icono={<Scan size={16} />}
        deshabilitado={!conContenido}
        onClick={() => acciones.ajustarMarco(els.map((e) => e.id))}
      />
      {els.length === 1 && <BotonBarra tam={tam} etiqueta="Ir a este marco (encuadrarlo en pantalla)" icono={<Focus size={16} />} onClick={() => acciones.irAMarco(els[0]!.id)} />}
      <Separador />
      <BotonBarra
        tam={tam}
        etiqueta="Bloquear"
        atajo="$mod+Shift+L"
        icono={<Lock size={15} />}
        activo={todos.length > 0 && todos.every((e) => e.bloqueado)}
        onClick={() => acciones.bloquear(true)}
      />
    </>
  )
}
