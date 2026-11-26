// Configuración → Apariencia (de este dispositivo): tema, densidad, movimiento y la barra lateral.
import { Check } from 'lucide-react'
import { usePreferencias, type Densidad, type Movimiento } from '../../estado/preferencias'
import { useTienda, type Tema } from '../../estado/tienda'
import { Interruptor, Segmentado } from '../../ui/comunes'
import { Fila, Grupo } from './piezas'

/** Una miniatura de la app dibujada con los colores de un tema (barra lateral, barra de arriba y tres listas). */
function Miniatura({ tema }: { tema: 'light' | 'dark' }) {
  return (
    <span className="mini-tema" data-theme={tema} aria-hidden>
      <span className="mini-tema__lateral">
        <span />
        <span />
        <span />
      </span>
      <span className="mini-tema__principal">
        <span className="mini-tema__barra" />
        <span className="mini-tema__listas">
          {[2, 3, 1].map((n, i) => (
            <span key={i} className="mini-tema__lista">
              {Array.from({ length: n }, (_, j) => (
                <span key={j} className="mini-tema__tarjeta" />
              ))}
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}

const TEMAS: { id: Tema; nombre: string }[] = [
  { id: 'claro', nombre: 'Claro' },
  { id: 'oscuro', nombre: 'Oscuro' },
  { id: 'sistema', nombre: 'Como el sistema' },
]

export function SeccionApariencia() {
  const tema = useTienda((s) => s.tema)
  const lateral = useTienda((s) => s.lateralAbierto)
  const densidad = usePreferencias((s) => s.densidad)
  const movimiento = usePreferencias((s) => s.movimiento)
  const cambiar = usePreferencias((s) => s.cambiar)
  return (
    <>
      <Grupo titulo="De este dispositivo">
        <Fila nombre="Tema" apilada>
          <div className="temas" role="radiogroup" aria-label="Tema">
            {TEMAS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tema === t.id}
                className={`tema-tarjeta${tema === t.id ? ' tema-tarjeta--activa' : ''}`}
                onClick={() => useTienda.getState().setTema(t.id)}
              >
                <span className="tema-tarjeta__dibujo">
                  {t.id === 'sistema' ? (
                    <span className="tema-tarjeta__partida">
                      <Miniatura tema="light" />
                      <Miniatura tema="dark" />
                    </span>
                  ) : (
                    <Miniatura tema={t.id === 'claro' ? 'light' : 'dark'} />
                  )}
                </span>
                <span className="tema-tarjeta__nombre">
                  {tema === t.id && <Check size={13} strokeWidth={3} />}
                  {t.nombre}
                </span>
              </button>
            ))}
          </div>
        </Fila>
        <Fila nombre="Densidad" descripcion="Compacta achica alturas y separaciones: entra más en la pantalla.">
          <Segmentado<Densidad>
            etiqueta="Densidad"
            valor={densidad}
            alCambiar={(v) => cambiar({ densidad: v })}
            opciones={[
              { id: 'comoda', nombre: 'Cómoda' },
              { id: 'compacta', nombre: 'Compacta' },
            ]}
          />
        </Fila>
        <Fila nombre="Movimiento" descripcion="Reducido quita los movimientos grandes: todo aparece con un fundido corto.">
          <Segmentado<Movimiento>
            etiqueta="Movimiento"
            valor={movimiento}
            alCambiar={(v) => cambiar({ movimiento: v })}
            opciones={[
              { id: 'sistema', nombre: 'Como el sistema' },
              { id: 'reducido', nombre: 'Reducido' },
              { id: 'completo', nombre: 'Completo' },
            ]}
          />
        </Fila>
        <Fila nombre="Mostrar la barra lateral" descripcion={
            <>
              También con la tecla <kbd>[</kbd> en cualquier lado.
            </>
          }>
          <Interruptor etiqueta="Mostrar la barra lateral" valor={lateral} alCambiar={(v) => v !== lateral && useTienda.getState().alternarLateral()} />
        </Fila>
      </Grupo>
    </>
  )
}
