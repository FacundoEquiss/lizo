// Un proyecto en la barra lateral (7.1): la cabecera (avatar, nombre y "6 abiertas · 2 tableros"; al pasar el mouse, su
// menú y la flecha de plegar) y sus tableros colgando de un hilo del color del proyecto. Sin caja alrededor. «Nuevo tablero» abre el
// diálogo donde se elige el nombre y el tipo (Tablero, Diagrama, Diseño o Completo): un tablero tiene solo las vistas que necesita.
import { Archive, ChevronRight, ExternalLink, Link2, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { Proyecto } from '../../../../compartido/tipos'
import { irA, useRuta } from '../../estado/ruta'
import { useTienda } from '../../estado/tienda'
import { AvatarProyecto } from '../../ui/AvatarProyecto'
import { Menu } from '../../ui/Desplegable'
import { movimientoReducido } from '../../util/movimiento'
import { copiarEnlace, enlaceTablero, FilaTablero } from './FilaTablero'

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export function TarjetaProyecto({ proyecto: p, abierto, alPlegar }: { proyecto: Proyecto; abierto: boolean; alPlegar: () => void }) {
  const tablero = useTienda((s) => s.tablero)
  const ruta = useRuta()
  const activo = tablero?.proyecto.id === p.id
  // El tablero abierto cuenta con lo que hay en pantalla (al día); los demás, con lo que mandó el servidor.
  const abiertasActivo = useTienda((s) => (s.tablero && s.tablero.proyecto.id === p.id ? s.tablero.tarjetas.filter((t) => !t.archivada).length : null))
  const abiertasDe = (id: string, deServidor: number) => (tablero?.tablero.id === id && abiertasActivo !== null ? abiertasActivo : deServidor)
  const total = p.tableros.reduce((n, t) => n + abiertasDe(t.id, t.abiertas), 0)
  const [confirmar, setConfirmar] = useState(false)

  const nuevoTablero = () => {
    if (!abierto) alPlegar()
    useTienda.getState().nuevoTablero(p.id)
  }

  const subtitulo = total === 0 ? 'Sin tarjetas abiertas' : `${plural(total, 'abierta', 'abiertas')} · ${plural(p.tableros.length, 'tablero', 'tableros')}`

  return (
    <section className={`proyecto${activo ? ' proyecto--activo' : ''}`} style={{ ['--proyecto' as string]: `var(--e-${p.color}-s)` }}>
      {confirmar ? (
        <div className="proyecto__confirmar" role="alertdialog" aria-label={`Archivar ${p.nombre}`}>
          <span>¿Archivar {p.nombre}? Lo podés restaurar después.</span>
          <div>
            <button
              type="button"
              className="boton boton--chico boton--rojo"
              autoFocus
              onClick={() => {
                setConfirmar(false)
                void useTienda.getState().archivarProyecto(p.id)
              }}
            >
              Archivar
            </button>
            <button type="button" className="boton boton--chico" onClick={() => setConfirmar(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="proyecto__cabecera">
          <button
            type="button"
            className="proyecto__fila"
            onClick={() => {
              if (!abierto) alPlegar()
              if (!activo) irA({ prefijo: p.prefijo, slug: p.tableros[0]?.slug ?? null, vista: ruta.vista, tarjeta: null })
            }}
            title={p.nombre}
          >
            <AvatarProyecto proyecto={p} tam={28} />
            <span className="proyecto__textos">
              <span className="proyecto__nombre">{p.nombre}</span>
              <span className="proyecto__subtitulo">{subtitulo}</span>
            </span>
          </button>
          <Menu
            lado="bottom-end"
            items={[
              { id: 'editar', etiqueta: 'Editar proyecto', icono: <Pencil size={15} />, alElegir: () => useTienda.getState().editarProyecto(p.id) },
              {
                id: 'tablero',
                etiqueta: 'Nuevo tablero',
                icono: <Plus size={15} />,
                alElegir: nuevoTablero,
              },
              {
                id: 'enlace',
                etiqueta: 'Copiar enlace',
                icono: <Link2 size={15} />,
                alElegir: () => void copiarEnlace(p.tableros[0] ? enlaceTablero(p, p.tableros[0]) : `${location.origin}/${p.prefijo}`),
              },
              ...(p.repoGithub
                ? [
                    {
                      id: 'repo',
                      etiqueta: 'Abrir el repo en GitHub',
                      icono: <ExternalLink size={15} />,
                      alElegir: () => window.open(`https://github.com/${p.repoGithub}`, '_blank', 'noopener,noreferrer'),
                    },
                  ]
                : []),
              { id: 'archivar', etiqueta: 'Archivar proyecto', icono: <Archive size={15} />, separador: true, peligro: true, alElegir: () => setConfirmar(true) },
            ]}
            disparador={(props) => (
              <button {...props} type="button" className="proyecto__accion" aria-label={`Opciones de ${p.nombre}`}>
                <MoreHorizontal size={16} />
              </button>
            )}
          />
          <button
            type="button"
            className={`proyecto__accion proyecto__plegar${abierto ? ' proyecto__plegar--abierto' : ''}`}
            onClick={alPlegar}
            aria-expanded={abierto}
            aria-label={abierto ? `Plegar ${p.nombre}` : `Desplegar ${p.nombre}`}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {abierto && (
          <motion.div
            className="proyecto__tableros"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: movimientoReducido() ? 0 : 0.2, ease: [0.15, 1, 0.3, 1] }}
          >
            <div className="proyecto__hilo" aria-hidden />
            {p.tableros.map((t) => (
              <FilaTablero key={t.id} proyecto={p} tablero={t} activo={tablero?.tablero.id === t.id} abiertas={abiertasDe(t.id, t.abiertas)} />
            ))}
            <button type="button" className="tablero-item__nuevo" onClick={nuevoTablero}>
              <Plus size={13} /> Nuevo tablero
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
