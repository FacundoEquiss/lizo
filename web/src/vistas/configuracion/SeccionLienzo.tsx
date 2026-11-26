// Configuración → Lienzo. Arriba, lo de este tablero (fondo, grilla e imanes: se guarda en el tablero y se ve igual en
// todos los dispositivos, y en vivo en las otras pestañas); abajo, lo de este dispositivo.
import { useId } from 'react'
import { FONDOS, GRILLAS, leerAjustesLienzo, type AjustesLienzo, type FondoLienzo, type GrillaLienzo } from '../../../../compartido/lienzo'
import { usePreferencias, type ModoRueda } from '../../estado/preferencias'
import { useTienda } from '../../estado/tienda'
import { Interruptor, Segmentado } from '../../ui/comunes'
import { Fila, Grupo } from './piezas'

const RUEDAS: { id: ModoRueda; nombre: string; ayuda: string }[] = [
  { id: 'auto', nombre: 'Automático', ayuda: 'Se da cuenta solo si usás mouse o trackpad.' },
  { id: 'mouse', nombre: 'Mouse', ayuda: 'La rueda acerca y aleja; para moverte, arrastrá con Espacio apretado o con la mano (H).' },
  { id: 'trackpad', nombre: 'Trackpad', ayuda: 'Dos dedos mueven el lienzo; pellizcar acerca y aleja.' },
]

/** La muestra de un fondo (56 × 40), con el mismo patrón que dibuja el lienzo (puntos, líneas o cruces cada 10 px). */
function MuestraFondo({ fondo }: { fondo: FondoLienzo }) {
  const id = 'fondo' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <svg className="muestra-fondo" width={56} height={40} viewBox="0 0 56 40" aria-hidden>
      <rect width={56} height={40} className="muestra-fondo__papel" />
      {fondo !== 'liso' && (
        <>
          <defs>
            <pattern id={id} width={10} height={10} patternUnits="userSpaceOnUse" x={3} y={0}>
              {fondo === 'puntos' && <circle cx={5} cy={5} r={1.1} className="muestra-fondo__punto" />}
              {fondo === 'lineas' && <path d="M0 0.5H10M0.5 0V10" className="muestra-fondo__linea" />}
              {fondo === 'cruces' && <path d="M2.5 5H7.5M5 2.5V7.5" className="muestra-fondo__cruz" />}
            </pattern>
          </defs>
          <rect width={56} height={40} fill={`url(#${id})`} />
        </>
      )}
    </svg>
  )
}

export function SeccionLienzo() {
  const tablero = useTienda((s) => s.tablero?.tablero)
  const grilla = useTienda((s) => s.grilla)
  const minimapa = useTienda((s) => s.minimapa)
  const rueda = usePreferencias((s) => s.rueda)
  const avisoHerramientas = usePreferencias((s) => s.avisoHerramientas)
  const atajosDeUnaTecla = usePreferencias((s) => s.atajosDeUnaTecla)
  const cambiar = usePreferencias((s) => s.cambiar)
  const ajustes = leerAjustesLienzo(tablero?.ajustes)
  const cambiarTablero = (c: Partial<AjustesLienzo>) => {
    if (tablero) void useTienda.getState().actualizarTablero(tablero.id, { ajustes: { lienzo: c } })
  }
  return (
    <>
      <Grupo titulo="De este tablero" bajada={tablero ? `Se guarda en «${tablero.nombre}»: se ve igual en todos tus dispositivos.` : 'Abrí un tablero para cambiar su lienzo.'}>
        <Fila nombre="Fondo" apilada>
          <div className="fondos" role="radiogroup" aria-label="Fondo del lienzo">
            {FONDOS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={ajustes.fondo === f.id}
                disabled={!tablero}
                className={`fondo-opcion${ajustes.fondo === f.id ? ' fondo-opcion--activa' : ''}`}
                onClick={() => cambiarTablero({ fondo: f.id })}
              >
                <MuestraFondo fondo={f.id} />
                <span>{f.nombre}</span>
              </button>
            ))}
          </div>
        </Fila>
        <Fila nombre="Tamaño de la grilla" descripcion="La distancia entre puntos (o líneas) y el paso del imán.">
          <Segmentado<GrillaLienzo>
            etiqueta="Tamaño de la grilla"
            deshabilitado={!tablero}
            valor={ajustes.grilla}
            alCambiar={(v) => cambiarTablero({ grilla: v })}
            opciones={GRILLAS.map((g) => ({ id: g, nombre: String(g) }))}
          />
        </Fila>
        <Fila nombre="Imán a la grilla" descripcion="Los objetos se acomodan a la grilla al moverlos y al cambiarles el tamaño.">
          <Interruptor etiqueta="Imán a la grilla" valor={ajustes.imanGrilla} deshabilitado={!tablero} alCambiar={(v) => cambiarTablero({ imanGrilla: v })} />
        </Fila>
        <Fila
          nombre="Imán a los objetos"
          descripcion={
            <>
              Guías que alinean con los bordes y centros de otros objetos. Mantené <kbd>Ctrl</kbd> mientras arrastrás para apagar los dos imanes.
            </>
          }
        >
          <Interruptor etiqueta="Imán a los objetos" valor={ajustes.imanObjetos} deshabilitado={!tablero} alCambiar={(v) => cambiarTablero({ imanObjetos: v })} />
        </Fila>
      </Grupo>
      <Grupo titulo="De este dispositivo">
        <Fila nombre="Mostrar la grilla" descripcion={
            <>
              También con la tecla <kbd>G</kbd> en el lienzo.
            </>
          }>
          <Interruptor etiqueta="Mostrar la grilla" valor={grilla} alCambiar={(v) => v !== grilla && useTienda.getState().alternarGrilla()} />
        </Fila>
        <Fila nombre="Minimapa" descripcion={
            <>
              También con la tecla <kbd>M</kbd> en el lienzo.
            </>
          }>
          <Interruptor etiqueta="Minimapa" valor={minimapa} alCambiar={(v) => v !== minimapa && useTienda.getState().alternarMinimapa()} />
        </Fila>
        <Fila nombre="Rueda del mouse" descripcion={RUEDAS.find((r) => r.id === rueda)?.ayuda}>
          <Segmentado<ModoRueda> etiqueta="Rueda del mouse" valor={rueda} alCambiar={(v) => usePreferencias.getState().setRueda(v)} opciones={RUEDAS} />
        </Fila>
        <Fila nombre="Ayuda de las herramientas" descripcion="El cartel de arriba que dice qué hace cada herramienta.">
          <Interruptor etiqueta="Ayuda de las herramientas" valor={avisoHerramientas} alCambiar={(v) => cambiar({ avisoHerramientas: v })} />
        </Fila>
        <Fila nombre="Atajos de una sola tecla" descripcion="V, N, T… Apagalos si escribís con lector de pantalla o dictado.">
          <Interruptor etiqueta="Atajos de una sola tecla" valor={atajosDeUnaTecla} alCambiar={(v) => cambiar({ atajosDeUnaTecla: v })} />
        </Fila>
      </Grupo>
    </>
  )
}
