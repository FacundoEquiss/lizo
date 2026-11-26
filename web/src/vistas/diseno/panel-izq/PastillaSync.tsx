// La pastilla de sincronización (plan 6.2): verde con la hora de la última importación, ámbar si hay una pedida, gris si
// nunca se importó. Clic: el origen (repo, rama, commit), el resumen de cambios y "Pedir sincronización".
import { GitBranch, GitCommitHorizontal, RefreshCw } from 'lucide-react'
import type { CambioImportacion } from '../../../../../compartido/diseno/tipos'
import { avisar, avisarError } from '../../../estado/avisos'
import { Desplegable } from '../../../ui/Desplegable'
import { apiDiseno } from '../api'
import { useDiseno } from '../estado'
import { ComoImportar } from '../ui'

const NOMBRES: Record<string, [string, string]> = {
  token: ['token', 'tokens'],
  estilo_texto: ['estilo de texto', 'estilos de texto'],
  color_suelto: ['color suelto', 'colores sueltos'],
  activo: ['activo', 'activos'],
  fuente: ['fuente', 'fuentes'],
  hoja: ['hoja', 'hojas'],
  pieza: ['pieza', 'piezas'],
  texto: ['texto', 'textos'],
  plantilla: ['plantilla', 'plantillas'],
  marco: ['pantalla', 'pantallas'],
}

export function cuando(iso: string): string {
  const d = new Date(iso)
  const hoy = new Date()
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (d.toDateString() === hoy.toDateString()) return `hoy ${hora}`
  const ayer = new Date(hoy.getTime() - 86400000)
  if (d.toDateString() === ayer.toDateString()) return `ayer ${hora}`
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

export function resumirCambios(cambios: CambioImportacion[]): { que: CambioImportacion['que']; tipo: string; n: number }[] {
  const m = new Map<string, { que: CambioImportacion['que']; tipo: string; n: number }>()
  for (const c of cambios) {
    const k = `${c.que}|${c.tipo}`
    if (!m.has(k)) m.set(k, { que: c.que, tipo: c.tipo, n: 0 })
    m.get(k)!.n++
  }
  const orden = { nuevo: 0, cambio: 1, quitado: 2 }
  return [...m.values()].sort((a, b) => orden[a.que] - orden[b.que] || b.n - a.n)
}

export const nombreTipo = (tipo: string, n: number) => (NOMBRES[tipo] ?? [tipo, tipo])[n === 1 ? 0 : 1]

const FEMENINOS = new Set(['marco', 'pieza', 'fuente', 'hoja', 'plantilla'])
/** "3 pantallas nuevas", "1 token cambiado". */
export function queCambio(tipo: string, que: CambioImportacion['que'], n: number): string {
  const raiz = que === 'nuevo' ? 'nuev' : que === 'quitado' ? 'quitad' : 'cambiad'
  return `${raiz}${FEMENINOS.has(tipo) ? 'a' : 'o'}${n === 1 ? '' : 's'}`
}

export function PastillaSync() {
  const resumen = useDiseno((s) => s.resumen)!
  const prefijo = useDiseno((s) => s.prefijo)!
  const s = resumen.sincronizacion
  const pedida = s.pedidoEn && (!s.importadoEn || s.pedidoEn > s.importadoEn)
  const estado = !s.tienePerfil && !s.importacion ? 'importar' : pedida ? 'pedida' : s.importadoEn ? 'ok' : 'nunca'
  const texto = estado === 'importar' ? 'Importar…' : estado === 'pedida' ? 'Pedida' : estado === 'ok' ? cuando(s.importadoEn!) : 'Sin importar'
  const pedir = () =>
    apiDiseno
      .config(prefijo, { pedir: true })
      .then(() => {
        avisar({ texto: 'Pedido. La próxima vez que Claude sincronice, trae lo nuevo del código.', tipo: 'ok' })
        void useDiseno.getState().recargarResumen()
      })
      .catch(avisarError)
  const cambios = s.ultima ? resumirCambios(s.ultima.cambios) : []
  return (
    <Desplegable
      lado="bottom-end"
      ancho={320}
      disparador={(p) => (
        <button {...p} className={`dz-pastilla dz-pastilla--${estado}`} aria-label={`Sincronización: ${texto}`}>
          <span className="dz-pastilla__punto" />
          {texto}
        </button>
      )}
    >
      {() => (
        <div className="diseno">
        <div className="dz-sync">
          {estado === 'importar' ? (
            <>
              <p className="dz-sync__titulo">Este proyecto todavía no tiene su diseño importado</p>
              <ComoImportar />
            </>
          ) : (
            <>
              <p className="dz-sync__titulo">{s.importadoEn ? `Sincronizado ${cuando(s.importadoEn)}` : 'Sin sincronizar'}</p>
              {s.origen && (
                <div className="dz-sync__origen">
                  {s.origen.repo && <span className="dz-sync__dato">{s.origen.repo}</span>}
                  {s.origen.rama && (
                    <span className="dz-sync__dato">
                      <GitBranch size={12} /> {s.origen.rama}
                    </span>
                  )}
                  {s.origen.commit && (
                    <span className="dz-sync__dato dz-sync__dato--mono">
                      <GitCommitHorizontal size={12} /> {s.origen.commit.slice(0, 7)}
                    </span>
                  )}
                  {s.origen.perfil && <span className="dz-sync__dato">perfil {s.origen.perfil}</span>}
                </div>
              )}
              {s.ultima && (
                <div className="dz-sync__cambios">
                  <p className="dz-sync__sub">Importación {s.ultima.n}</p>
                  {cambios.length === 0 ? (
                    <p className="dz-sync__linea">0 cambios: el código y Telar ya coincidían.</p>
                  ) : (
                    cambios.slice(0, 9).map((c) => (
                      <p key={`${c.que}${c.tipo}`} className={`dz-sync__linea dz-sync__linea--${c.que}`}>
                        <span className="dz-sync__n">{c.que === 'nuevo' ? '+' : c.que === 'quitado' ? '−' : '~'}{c.n}</span>
                        {nombreTipo(c.tipo, c.n)} {queCambio(c.tipo, c.que, c.n)}
                      </p>
                    ))
                  )}
                </div>
              )}
              {pedida && <p className="dz-sync__pedida">Hay una sincronización pedida desde {cuando(s.pedidoEn!)}.</p>}
              <button className="boton boton--chico dz-sync__boton" onClick={pedir}>
                <RefreshCw size={13} /> Pedir sincronización
              </button>
            </>
          )}
        </div>
        </div>
      )}
    </Desplegable>
  )
}
