// Configuración → Acerca de: la versión, dónde están los datos, conectar la IA y las novedades de la 0.2.
import { Check, Copy, PlugZap } from 'lucide-react'
import { useState } from 'react'
import { VERSION } from '../../../../compartido/constantes'
import { useTienda } from '../../estado/tienda'
import { MarcaTelar } from '../../ui/marcas'
import { Fila, Grupo } from './piezas'

const NOVEDADES = [
  'Tema oscuro nuevo: gris carbón.',
  'Lienzo: texto con fuentes y formato, notas que ajustan la letra, 13 formas, marcos que se recorren con una tecla.',
  'Conectores: soltalos en el aire y creá lo que sigue.',
  'Tarjetas del Kanban en el lienzo: tres tamaños, con su porqué.',
  'Proyectos con foto, y todo se puede editar y archivar.',
  'Configuración, ícono nuevo y deshacer en todo.',
]

export function SeccionAcercaDe() {
  const info = useTienda((s) => s.info)
  const [copiada, setCopiada] = useState(false)
  const online = info?.rutaTablero === ''
  const base = !info ? 'Base de datos' : info.baseDeDatos === 'pglite' ? 'En esta computadora (PGlite)' : online ? 'En Supabase (Postgres)' : 'En Postgres'
  const copiar = () => {
    if (!info?.rutaDatos) return
    void navigator.clipboard?.writeText(info.rutaDatos).then(() => {
      setCopiada(true)
      setTimeout(() => setCopiada(false), 1600)
    })
  }
  return (
    <>
      <div className="acerca">
        <span className="acerca__marca">
          <MarcaTelar size={48} />
        </span>
        <div>
          <b className="acerca__nombre">Telar {VERSION}</b>
          <span className="acerca__bajada">Lienzo infinito y Kanban para ordenar todos tus proyectos, con tu IA trabajando por MCP.</span>
        </div>
      </div>
      <Grupo titulo="Tus datos">
        <Fila nombre={base} descripcion={<span className="acerca__ruta">{info?.rutaDatos ?? '…'}</span>}>
          {!online && info?.rutaDatos && (
            <button type="button" className="boton boton--chico" onClick={copiar}>
              {copiada ? <Check size={13} /> : <Copy size={13} />} {copiada ? 'Copiada' : 'Copiar la ruta'}
            </button>
          )}
        </Fila>
        <Fila nombre="Tu IA" descripcion="Claude o ChatGPT pueden leer y armar tus tableros por MCP.">
          <button type="button" className="boton boton--chico" onClick={() => useTienda.getState().setDialogo('conectar')}>
            <PlugZap size={13} /> Conectar IA
          </button>
        </Fila>
      </Grupo>
      <Grupo titulo="Novedades de la 0.2">
        <ol className="novedades">
          {NOVEDADES.map((n, i) => (
            <li key={i}>
              <span className="novedades__numero">{i + 1}</span>
              <span>{n}</span>
            </li>
          ))}
        </ol>
      </Grupo>
    </>
  )
}
