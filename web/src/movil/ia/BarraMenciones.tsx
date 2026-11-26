// Las sugerencias de menciones en el teléfono (plan de la IA integrada, 14.3 y 7.8): no flotan bajo el cursor, que el dedo y
// el teclado taparían. Son una fila de chips que se desplaza de costado y queda pegada arriba del campo, sobre el teclado.
//   · Cada chip es una opción: avatar, nombre, `@alias` y lo que va a pasar. 44 px de alto; un toque inserta el alias.
//   · Nunca le saca el foco al campo (si no, el teclado se cerraría): se atiende al soltar y se evita el desenfoque al apretar.
//   · Con `data-conserva-foco`, tocar un chip no cuenta como «tocar fuera del campo» (movil/teclado.ts).
// La ofrece AppMovil por PresentacionMenciones (ui/CampoConMenciones.tsx): CampoConMenciones no importa nada de movil/.
import { autoUpdate, flip, FloatingPortal, offset, size, useFloating } from '@floating-ui/react'
import { useEffect, useRef } from 'react'
import { Avatar } from '../../ui/comunes'
import type { PropsSugerencias } from '../../ui/CampoConMenciones'
import { nombreDeOpcion } from '../../ui/CampoConMenciones'

export function BarraMenciones({ ancla, opciones, activa, idLista, idOpcion, alElegir, alPasarPor }: PropsSugerencias) {
  const { refs, floatingStyles } = useFloating({
    elements: { reference: ancla },
    open: true,
    strategy: 'fixed',
    placement: 'top-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      // Si arriba no hay lugar (el campo está pegado a la cabecera) pasa abajo. Del ancho del campo, así que de costado no se sale.
      flip({ padding: 8 }),
      size({
        apply({ rects, elements }) {
          elements.floating.style.width = `${rects.reference.width}px`
        },
      }),
    ],
  })
  // Con el teclado (tablet con teclado, o lector de pantalla) la opción activa se mantiene a la vista.
  const lista = useRef<HTMLUListElement | null>(null)
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[id="${idOpcion(activa)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activa])
  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, zIndex: 90 }}
        className="barra-menciones"
        data-conserva-foco
        // El campo conserva el foco (y el teclado abierto) mientras se toca la barra.
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => e.preventDefault()}
      >
        {opciones.length === 0 ? (
          <p className="barra-menciones__vacio">No hay nadie con ese nombre</p>
        ) : (
          <ul ref={lista} className="barra-menciones__lista" role="listbox" id={idLista} aria-label="Mencionar a">
            {opciones.map((o, i) => (
              <li
                key={o.miembro.id}
                id={idOpcion(i)}
                role="option"
                aria-selected={i === activa}
                aria-label={nombreDeOpcion(o)}
                className={`barra-menciones__chip${i === activa ? ' barra-menciones__chip--activa' : ''}`}
                onClick={() => alElegir(i)}
                onMouseMove={() => i !== activa && alPasarPor(i)}
              >
                <Avatar miembro={o.miembro} tam={24} />
                <span className="barra-menciones__nombre">{o.miembro.nombre}</span>
                <span className="barra-menciones__alias">@{o.alias}</span>
                <span className={`barra-menciones__efecto${o.efecto.problema ? ' barra-menciones__efecto--problema' : ''}`}>{o.efecto.texto}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FloatingPortal>
  )
}
