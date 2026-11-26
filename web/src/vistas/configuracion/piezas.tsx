// Piezas de las secciones de Configuración (6): un grupo con su título chico y una fila de ajuste (nombre y descripción
// a la izquierda, el control a la derecha). Sin líneas divisorias: separa el aire.
import type { ReactNode } from 'react'

export function Grupo({ titulo, bajada, children }: { titulo?: string; bajada?: string; children: ReactNode }) {
  return (
    <section className="config-grupo">
      {titulo && <h3 className="config-grupo__titulo">{titulo}</h3>}
      {bajada && <p className="config-grupo__bajada">{bajada}</p>}
      <div className="config-grupo__filas">{children}</div>
    </section>
  )
}

export function Fila({ nombre, descripcion, children, apilada }: { nombre: string; descripcion?: ReactNode; children: ReactNode; apilada?: boolean }) {
  return (
    <div className={`config-fila${apilada ? ' config-fila--apilada' : ''}`}>
      <div className="config-fila__texto">
        <span className="config-fila__nombre">{nombre}</span>
        {descripcion && <span className="config-fila__descripcion">{descripcion}</span>}
      </div>
      <div className="config-fila__control">{children}</div>
    </div>
  )
}
