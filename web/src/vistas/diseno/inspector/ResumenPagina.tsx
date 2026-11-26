// Inspector sin selección (plan 6.6): resumen de la página (marcos, de dónde viene, última sincronización), los cambios de
// la última importación y la leyenda de teclas.
import { Kbd } from '../../../ui/comunes'
import { useDiseno } from '../estado'
import { cuando, nombreTipo, resumirCambios } from '../panel-izq/PastillaSync'
import { Fila, Seccion } from '../ui'

export function ResumenPagina() {
  const pagina = useDiseno((s) => s.pagina)
  const marcos = useDiseno((s) => s.marcos)
  const resumen = useDiseno((s) => s.resumen)
  const items = useDiseno((s) => s.items)
  if (!pagina || !resumen) return null
  const s = resumen.sincronizacion
  const cambios = s.ultima ? resumirCambios(s.ultima.cambios) : []
  const importada = pagina.origen === 'importado'
  const cuentaItems = (pagina.datos.tipos ?? []).reduce((n, t) => n + (items[t]?.length ?? resumen.conteo[t] ?? 0), 0)
  return (
    <>
      <div className="dz-icab">
        <p className="dz-icab__nombre">{pagina.nombre}</p>
        <p className="dz-icab__clase">
          {pagina.tipo === 'lienzo' ? 'Página de lienzo' : pagina.tipo === 'sistema' ? 'Página de sistema' : 'Tabla'} · {importada ? 'viene del código' : 'propia'}
        </p>
      </div>
      <Seccion titulo="Página">
        {pagina.tipo === 'lienzo' ? (
          <>
            <Fila etiqueta="Marcos">{marcos.length}</Fila>
            <Fila etiqueta="Secciones">{new Set(marcos.map((m) => m.seccion)).size}</Fila>
            <Fila etiqueta="Comentarios">{marcos.reduce((n, m) => n + m.comentarios, 0)}</Fila>
          </>
        ) : (
          <Fila etiqueta="Ítems">{cuentaItems}</Fila>
        )}
        {importada && <Fila etiqueta="Sincronizada">{s.importadoEn ? cuando(s.importadoEn) : 'nunca'}</Fila>}
        {importada && s.origen?.rama && <Fila etiqueta="Rama" mono>{s.origen.rama}</Fila>}
        {importada && s.origen?.commit && <Fila etiqueta="Commit" mono copia={s.origen.commit}>{s.origen.commit.slice(0, 7)}</Fila>}
      </Seccion>
      {importada && s.ultima && (
        <Seccion titulo={`Última importación (${s.ultima.n})`}>
          {cambios.length === 0 ? (
            <p className="dz-inota">0 cambios: el código y Telar ya coincidían.</p>
          ) : (
            <ul className="dz-cambios">
              {cambios.map((c) => (
                <li key={`${c.que}${c.tipo}`} className={`dz-cambios__fila dz-cambios__fila--${c.que}`}>
                  <span className="dz-cambios__n">
                    {c.que === 'nuevo' ? '+' : c.que === 'quitado' ? '−' : '~'}
                    {c.n}
                  </span>
                  {nombreTipo(c.tipo, c.n)}
                </li>
              ))}
            </ul>
          )}
          {s.ultima.cambios.length > 0 && (
            <ul className="dz-cambios dz-cambios--detalle">
              {s.ultima.cambios.slice(0, 12).map((c) => (
                <li key={`${c.tipo}:${c.clave}`} className="dz-cambios__item">
                  <span className={`dz-cambios__marca dz-cambios__marca--${c.que}`} />
                  {c.nombre ?? c.clave}
                </li>
              ))}
              {s.ultima.cambios.length > 12 && <li className="dz-cambios__item dz-cambios__item--mas">y {s.ultima.cambios.length - 12} más</li>}
            </ul>
          )}
        </Seccion>
      )}
      <Seccion titulo="Cómo se usa">
        <ul className="dz-leyenda">
          <li>
            <span>Clic</span> elige el marco; otro clic, la capa de adentro
          </li>
          <li>
            <span>Doble clic</span> baja un nivel (en un texto propio, lo edita)
          </li>
          <li>
            <Kbd atajo="$mod" suave /> + clic va directo a la capa de más adentro
          </li>
          <li>
            Mantené <Kbd atajo="Alt" suave /> para medir distancias
          </li>
          <li>
            <Kbd atajo="Enter" suave /> · <Kbd atajo="Shift+Enter" suave /> bajan y suben de nivel; <Kbd atajo="Escape" suave /> sale
          </li>
          <li>
            <Kbd atajo="Shift+1" suave /> ver todo · <Kbd atajo="N" suave /> marco siguiente
          </li>
        </ul>
      </Seccion>
    </>
  )
}
