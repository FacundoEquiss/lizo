import { X } from 'lucide-react'
import { useTienda } from '../estado/tienda'
import { Kbd } from '../ui/comunes'
import { Dialogo } from '../ui/Dialogo'
import { ATAJOS } from '../util/atajos'

export function Atajos() {
  const abierto = useTienda((s) => s.dialogo === 'atajos')
  const cerrar = () => useTienda.getState().setDialogo(null)
  return (
    <Dialogo abierto={abierto} alCerrar={cerrar} tituloId="titulo-atajos" className="dialogo--ancho">
      <header className="dialogo__cabecera">
        <h2 id="titulo-atajos">Atajos de teclado</h2>
        <button className="boton-icono" onClick={cerrar} aria-label="Cerrar">
          <X size={18} />
        </button>
      </header>
      <div className="atajos">
        {ATAJOS.map((g) => (
          <section key={g.titulo} className="atajos__grupo">
            <h3>{g.titulo}</h3>
            {g.atajos.map(([tecla, texto]) => (
              <div key={tecla + texto} className="atajos__fila">
                <span>{texto}</span>
                <Kbd atajo={tecla} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialogo>
  )
}
