// La barra del conector (5.7.4): `[Trazo ▾] | [Inicio ▾] [Fin ▾] [⇄ Invertir] | [Línea ▾] [Grosor ▾] [Color ▾] |
// [Etiqueta] | [⋯]`. Con varios conectores elegidos, el cambio va a todos en un solo paso. El estilo que se usa queda
// de fábrica para el próximo conector (si "Recordar el último estilo" está prendido).
import { ArrowLeftRight, Minus, Spline, Tag, Waypoints } from 'lucide-react'
import type { ReactNode } from 'react'
import { GROSORES, GUIONES, PUNTAS, TRAZOS } from '../../../../../compartido/lienzo'
import type { Color, Conector, Guion, Punta, Trazo } from '../../../../../compartido/tipos'
import { enUnPaso } from '../../../estado/deshacer'
import { usePreferencias } from '../../../estado/preferencias'
import { useTienda } from '../../../estado/tienda'
import { patronLinea } from '../conectores/Arista'
import { MuestraPunta } from '../conectores/Punta'
import { useLienzo } from '../estado'
import { useSeleccionLienzo } from '../seleccion'
import { BotonBarra, MenuBarra, Muestra, Separador, type TamBarra } from './piezas'
import { SelectorColor } from './SelectorColor'

const ICONOS_TRAZO: Record<Trazo, ReactNode> = {
  curvo: <Spline size={16} />,
  ortogonal: <Waypoints size={16} />,
  recto: <Minus size={16} style={{ rotate: '-35deg' }} />,
}

type CambioEstilo = Partial<Pick<Conector, 'trazo' | 'puntaInicio' | 'puntaFin' | 'guion' | 'grosor' | 'color'>>

/** Cambia el estilo de los conectores (un paso) y lo recuerda como el de fábrica del próximo. */
export async function cambiarConectores(cs: Conector[], cambios: CambioEstilo, etiqueta = 'cambiar conector') {
  if (!cs.length) return
  await enUnPaso(etiqueta, async () => {
    for (const c of cs) await useTienda.getState().actualizarConector(c.id, cambios)
  })
  usePreferencias.getState().recordar('conector', cambios)
}

function MuestraLinea({ guion, grosor = 2 }: { guion: Guion; grosor?: number }) {
  const p = patronLinea(guion, grosor)
  return (
    <svg width={34} height={12} viewBox="0 0 34 12" aria-hidden>
      <line x1={3} y1={6} x2={31} y2={6} stroke="currentColor" strokeWidth={grosor} strokeDasharray={p.dasharray} strokeLinecap={p.linecap} />
    </svg>
  )
}

function MenuPunta({ cs, extremo, tam }: { cs: Conector[]; extremo: 'inicio' | 'fin'; tam?: TamBarra }) {
  const clave = extremo === 'inicio' ? 'puntaInicio' : 'puntaFin'
  const actual = cs[0]![clave]
  return (
    <MenuBarra etiqueta={extremo === 'inicio' ? 'Punta del comienzo' : 'Punta del final'} tam={tam} disparador={<MuestraPunta tipo={actual} inicio={extremo === 'inicio'} />} ancho={196}>
      {(cerrar) => (
        <div className="menu__lista" role="listbox" aria-label={extremo === 'inicio' ? 'Punta del comienzo' : 'Punta del final'}>
          {PUNTAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={actual === p.id}
              className={`menu__item${actual === p.id ? ' menu__item--activo' : ''}`}
              onClick={() => {
                void cambiarConectores(cs, { [clave]: p.id as Punta })
                cerrar()
              }}
            >
              <span className="menu__icono menu__icono--ancho">
                <MuestraPunta tipo={p.id} inicio={extremo === 'inicio'} />
              </span>
              <span className="menu__texto">{p.nombre}</span>
            </button>
          ))}
        </div>
      )}
    </MenuBarra>
  )
}

/** La sección completa del conector (uno o varios). */
export function SeccionConector({ tam }: { tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const cs = sel.conectores
  if (!cs.length) return null
  const c = cs[0]!
  const uno = cs.length === 1
  return (
    <>
      <MenuBarra etiqueta="Trazo" tam={tam} disparador={ICONOS_TRAZO[c.trazo]} ancho={176}>
        {(cerrar) => (
          <div className="menu__lista" role="listbox" aria-label="Trazo">
            {TRAZOS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={c.trazo === t.id}
                className={`menu__item${c.trazo === t.id ? ' menu__item--activo' : ''}`}
                onClick={() => {
                  void cambiarConectores(cs, { trazo: t.id })
                  cerrar()
                }}
              >
                <span className="menu__icono">{ICONOS_TRAZO[t.id]}</span>
                <span className="menu__texto">{t.nombre}</span>
              </button>
            ))}
          </div>
        )}
      </MenuBarra>
      <Separador />
      <MenuPunta cs={cs} extremo="inicio" tam={tam} />
      <MenuPunta cs={cs} extremo="fin" tam={tam} />
      {uno && (
        <BotonBarra
          tam={tam}
          etiqueta="Invertir el sentido"
          icono={<ArrowLeftRight size={16} />}
          onClick={() =>
            void useTienda.getState().actualizarConector(c.id, { desdeId: c.hastaId, hastaId: c.desdeId, desdeLado: c.hastaLado, hastaLado: c.desdeLado })
          }
        />
      )}
      <Separador />
      <MenuBarra etiqueta="Línea" tam={tam} disparador={<MuestraLinea guion={c.guion} />} ancho={180}>
        {(cerrar) => (
          <div className="menu__lista" role="listbox" aria-label="Línea">
            {GUIONES.map((g) => (
              <button
                key={g.id}
                type="button"
                role="option"
                aria-selected={c.guion === g.id}
                className={`menu__item${c.guion === g.id ? ' menu__item--activo' : ''}`}
                onClick={() => {
                  void cambiarConectores(cs, { guion: g.id })
                  cerrar()
                }}
              >
                <span className="menu__icono menu__icono--ancho">
                  <MuestraLinea guion={g.id} />
                </span>
                <span className="menu__texto">{g.nombre}</span>
              </button>
            ))}
          </div>
        )}
      </MenuBarra>
      <MenuBarra etiqueta="Grosor" tam={tam} disparador={<span className="barra-ctx__numero">{c.grosor}</span>} ancho={150}>
        {(cerrar) => (
          <div className="menu__lista" role="listbox" aria-label="Grosor">
            {GROSORES.map((g) => (
              <button
                key={g}
                type="button"
                role="option"
                aria-selected={c.grosor === g}
                className={`menu__item${c.grosor === g ? ' menu__item--activo' : ''}`}
                onClick={() => {
                  void cambiarConectores(cs, { grosor: g })
                  cerrar()
                }}
              >
                <span className="menu__icono menu__icono--ancho">
                  <MuestraLinea guion="solido" grosor={g} />
                </span>
                <span className="menu__texto">{g} px</span>
              </button>
            ))}
          </div>
        )}
      </MenuBarra>
      <MenuBarra etiqueta="Color" tam={tam} disparador={c.color ? <Muestra color={c.color} variable="--e-s" /> : <span className="barra-ctx__muestra barra-ctx__muestra--auto" />}>
        {(cerrar) => (
          <SelectorColor
            valor={c.color ?? 'auto'}
            variable="--e-s"
            conAuto="Automático"
            tam={tam}
            alElegir={(col) => {
              void cambiarConectores(cs, { color: col === 'auto' || col === 'ninguno' ? null : (col as Color) })
              cerrar()
            }}
          />
        )}
      </MenuBarra>
      {uno && (
        <>
          <Separador />
          <BotonBarra
            tam={tam}
            etiqueta={c.etiqueta ? 'Editar la etiqueta' : 'Poner una etiqueta'}
            atajo="Enter"
            icono={<Tag size={15} />}
            texto="Etiqueta"
            onClick={() => useLienzo.getState().set({ etiquetaEditando: c.id })}
          />
        </>
      )}
    </>
  )
}
