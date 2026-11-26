// Los detalles de un marco en el teléfono: medidas, página y sección, de dónde viene, cuándo cambió, sus tarjetas
// vinculadas (un toque las abre) y sus notas. Al final dice qué se edita en la computadora: en 6 pulgadas no se arrastran
// capas ni se escribe CSS, y es mejor decirlo que esconderlo.
import { Laptop, Link2, Share2, SquareKanban } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MarcoResumen, NotaDiseno } from '../../../../../compartido/diseno/tipos'
import { irA } from '../../../estado/ruta'
import { FilaTactil } from '../../../movil/ui/FilaTactil'
import { HojaInferior, useHoja } from '../../../movil/ui/HojaInferior'
import { Markdown } from '../../../ui/Markdown'
import { hace } from '../../../util/fechas'
import { apiDiseno, urlMiniatura } from '../api'
import { useDiseno } from '../estado'
import { useDisenoMovil } from './estado'
import { cerrarHoja, copiarEnlaceMarco, useHojaDe, useUltimo } from './Hojas'

export function HojaDetalles() {
  const h = useHojaDe('detalles')
  const ultimo = useUltimo(h)
  const m = useDiseno((s) => s.marcos.find((x) => x.id === ultimo?.marco) ?? null)
  return (
    <HojaInferior abierta={!!h} alCerrar={cerrarHoja} titulo="Detalles del marco" className="dzm-hoja">
      {m && <Detalles m={m} />}
    </HojaInferior>
  )
}

function Detalles({ m }: { m: MarcoResumen }) {
  const hoja = useHoja()
  const prefijo = useDiseno((s) => s.prefijo)!
  const pagina = useDiseno((s) => s.pagina)
  const completo = useDiseno((s) => s.completos[m.id])
  const [nota, setNota] = useState<NotaDiseno | null>(null)
  const importado = m.origen === 'importado'

  useEffect(() => {
    void useDiseno.getState().cargarMarco(m.id)
    let vivo = true
    apiDiseno
      .notas(prefijo, [`marco:${m.id}`])
      .then((ns) => vivo && setNota(ns[0] ?? null))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [prefijo, m.id])

  const tarjetas = completo?.tarjetas ?? m.tarjetas.map((clave) => ({ clave, titulo: '', tipo: 'tarea', lista: null, categoria: null }))
  const ir = (fn: () => void) => hoja?.cerrarYLuego(fn)
  return (
    <div className="dzm-detalles">
      <div className="dzm-detalles__cabeza">
        <span className="dzm-detalles__mini">
          <img src={urlMiniatura(prefijo, m)} alt="" style={{ aspectRatio: `${m.ancho} / ${m.alto}` }} />
        </span>
        <div className="dzm-detalles__nombre">
          <b>{nota?.nombrePropio || m.nombre}</b>
          {nota?.nombrePropio && <span>{m.nombre}</span>}
          {nota?.uso && <span>{nota.uso}</span>}
        </div>
      </div>

      <dl className="dzm-datos">
        <Dato etiqueta="Tamaño">
          {m.ancho} × {m.alto} px
        </Dato>
        <Dato etiqueta="Página">
          {pagina?.nombre ?? '—'}
          {m.seccion ? ` · ${m.seccion}` : ''}
        </Dato>
        <Dato etiqueta="Origen">{importado ? 'Viene del código del proyecto' : 'Propio (hecho en Telar)'}</Dato>
        {m.datos.vista && <Dato etiqueta="Pantalla">{m.datos.vista === 'pc' ? 'PC' : m.datos.vista === 'celular' ? 'Celular' : m.datos.vista}</Dato>}
        {m.datos.pieza && <Dato etiqueta="Muestra">Variantes de la pieza «{m.datos.pieza}»</Dato>}
        {m.datos.plantilla && <Dato etiqueta="Plantilla">{m.datos.plantilla}</Dato>}
        <Dato etiqueta="Cambió">{hace(m.actualizadoEn)}</Dato>
        {m.creadoPor && <Dato etiqueta="Lo hizo">{m.creadoPor.nombre}</Dato>}
        <Dato etiqueta="Versión">{m.revision}</Dato>
        {m.bloqueado && <Dato etiqueta="Bloqueado">Sí: no se cambia sin desbloquearlo</Dato>}
      </dl>

      {m.datos.nota && <p className="dzm-nota">{m.datos.nota}</p>}
      {nota?.nota && (
        <section className="dzm-detalles__seccion">
          <h3 className="dzm-subtitulo">Nota</h3>
          <Markdown texto={nota.nota} className="dzm-detalles__nota" />
        </section>
      )}

      {tarjetas.length > 0 && (
        <section className="dzm-detalles__seccion">
          <h3 className="dzm-subtitulo">Tarjetas vinculadas</h3>
          {tarjetas.map((t) => (
            <FilaTactil
              key={t.clave}
              icono={<SquareKanban size={20} />}
              texto={t.titulo || t.clave}
              bajada={t.titulo ? `${t.clave}${t.lista ? ` · ${t.lista}` : ''}` : undefined}
              flecha
              onClick={() => ir(() => irA({ tarjeta: t.clave }))}
            />
          ))}
        </section>
      )}

      <section className="dzm-detalles__seccion">
        <FilaTactil icono={<Share2 size={20} />} texto="Compartir la imagen" flecha onClick={() => ir(() => useDisenoMovil.getState().abrirHoja({ tipo: 'compartir', marco: m.id }))} />
        <FilaTactil
          icono={<Link2 size={20} />}
          texto="Copiar el enlace"
          bajada="Abre este marco en la PC o en otro teléfono"
          onClick={() => void copiarEnlaceMarco(m.id)}
        />
      </section>

      <p className="dzm-en-la-compu">
        <Laptop size={18} aria-hidden />
        <span>
          {importado
            ? 'Este marco sale del código del proyecto: se cambia en el código. Si algo no va, dejá un comentario o una tarjeta y Claude lo arregla.'
            : m.bloqueado
              ? 'Está bloqueado para que nadie lo cambie sin querer: se desbloquea en la computadora.'
              : 'Mover capas, cambiar estilos, el tamaño o el código: eso se edita en la computadora. Acá podés cambiar los textos (Textos, abajo del marco).'}
        </span>
      </p>
    </div>
  )
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="dzm-datos__fila">
      <dt>{etiqueta}</dt>
      <dd>{children}</dd>
    </div>
  )
}
