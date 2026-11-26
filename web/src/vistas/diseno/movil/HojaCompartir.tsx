// Compartir la imagen de un marco desde el teléfono: PNG o JPG, a 1x, 2x o 3x. La imagen se prepara apenas se abre la
// hoja (y otra vez si cambia el formato o el tamaño), así "Compartir" abre la hoja del sistema en el mismo toque
// (WhatsApp, Drive, Fotos…). Donde no se puede compartir un archivo, el botón principal descarga.
import { Download, Link2, RefreshCw, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { avisar, avisarError } from '../../../estado/avisos'
import { HojaInferior, useHoja } from '../../../movil/ui/HojaInferior'
import { useConexion } from '../../../pwa/estado'
import { Girando } from '../../../ui/comunes'
import { urlMiniatura } from '../api'
import { useDiseno } from '../estado'
import { armarImagen, compartirArchivo, descargarArchivo, escalaDeFabrica, puedeCompartir, type Formato } from './compartir'
import { cerrarHoja, copiarEnlaceMarco, useHojaDe, useUltimo } from './Hojas'

export function HojaCompartir() {
  const h = useHojaDe('compartir')
  const ultimo = useUltimo(h)
  const m = useDiseno((s) => s.marcos.find((x) => x.id === ultimo?.marco) ?? null)
  return (
    <HojaInferior abierta={!!h} alCerrar={cerrarHoja} titulo="Compartir la imagen" className="dzm-hoja dzm-hoja--compartir">
      {m && <Compartir key={m.id} marco={m} abierta={!!h} />}
    </HojaInferior>
  )
}

const ESCALAS = [1, 2, 3] as const

function Compartir({ marco: m, abierta }: { marco: { id: string; nombre: string; ancho: number; alto: number; revision: number }; abierta: boolean }) {
  const hoja = useHoja()
  const prefijo = useDiseno((s) => s.prefijo)!
  const enLinea = useConexion()
  const [formato, setFormato] = useState<Formato>('png')
  const [escala, setEscala] = useState<number>(() => escalaDeFabrica(m))
  const [archivo, setArchivo] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)

  // Se prepara al abrir y al cambiar el formato o el tamaño (lo anterior se cancela).
  useEffect(() => {
    if (!abierta || !enLinea) return
    const control = new AbortController()
    setArchivo(null)
    setError(null)
    armarImagen(prefijo, m, formato, escala, control.signal)
      .then((f) => setArchivo(f))
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
    return () => control.abort()
  }, [abierta, enLinea, prefijo, m.id, m.revision, formato, escala, intento])

  const compartible = !!archivo && puedeCompartir(archivo)
  const pesoKb = archivo ? Math.max(1, Math.round(archivo.size / 1024)) : 0
  const compartir = async () => {
    if (!archivo) return
    try {
      const r = await compartirArchivo(archivo, m.nombre)
      if (r === 'ok') hoja?.cerrar()
    } catch (e) {
      // Algunos destinos no aceptan archivos: se descarga y se avisa.
      descargarArchivo(archivo)
      avisar({ texto: 'No se pudo compartir desde acá: la descargué.', tipo: 'info' })
      void e
    }
  }
  const descargar = () => {
    if (!archivo) return
    descargarArchivo(archivo)
    avisar({ texto: `Descargué ${archivo.name}`, tipo: 'ok' })
  }

  return (
    <div className="dzm-compartir">
      <div className="dzm-compartir__vista">
        <img src={urlMiniatura(prefijo, m)} alt={m.nombre} style={{ aspectRatio: `${m.ancho} / ${m.alto}` }} />
      </div>
      <div className="dzm-compartir__opciones">
        <div className="dzm-campo">
          <span className="dzm-campo__etiqueta">Formato</span>
          <div className="dzm-segmentos" role="radiogroup" aria-label="Formato">
            {(['png', 'jpg'] as const).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={formato === f} className={`dzm-segmentos__opcion${formato === f ? ' dzm-segmentos__opcion--activa' : ''}`} onClick={() => setFormato(f)}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="dzm-campo">
          <span className="dzm-campo__etiqueta">Tamaño</span>
          <div className="dzm-segmentos" role="radiogroup" aria-label="Tamaño">
            {ESCALAS.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={escala === e} className={`dzm-segmentos__opcion${escala === e ? ' dzm-segmentos__opcion--activa' : ''}`} onClick={() => setEscala(e)}>
                {e}x
              </button>
            ))}
          </div>
        </div>
        <p className="dzm-compartir__dato" aria-live="polite">
          {Math.round(m.ancho * escala)} × {Math.round(m.alto * escala)} px
          {archivo ? ` · ${pesoKb >= 1024 ? `${(pesoKb / 1024).toFixed(1).replace('.', ',')} MB` : `${pesoKb} KB`}` : ''}
          {formato === 'jpg' ? ' · sin transparencia' : ''}
        </p>
      </div>

      {!enLinea ? (
        <p className="dzm-compartir__estado">Sin conexión: la imagen la arma el servidor. Probá cuando vuelva la señal.</p>
      ) : error ? (
        <div className="dzm-compartir__estado dzm-compartir__estado--error" role="alert">
          <span>{error}</span>
          <button type="button" className="boton" onClick={() => setIntento((n) => n + 1)}>
            <RefreshCw size={16} /> Reintentar
          </button>
        </div>
      ) : !archivo ? (
        <p className="dzm-compartir__estado" role="status">
          <Girando tam={16} /> Preparando la imagen…
        </p>
      ) : null}

      <div className="dzm-compartir__botones">
        {compartible ? (
          <>
            <button type="button" className="boton dzm-boton-grande" disabled={!archivo} onClick={descargar}>
              <Download size={18} /> Descargar
            </button>
            <button type="button" className="boton boton--primario dzm-boton-grande" disabled={!archivo} onClick={() => void compartir()}>
              <Share2 size={18} /> Compartir
            </button>
          </>
        ) : (
          <button type="button" className="boton boton--primario dzm-boton-grande" disabled={!archivo} onClick={descargar}>
            <Download size={18} /> Descargar
          </button>
        )}
      </div>
      <button
        type="button"
        className="dzm-enlace dzm-compartir__enlace"
        onClick={() => {
          void copiarEnlaceMarco(m.id).catch(avisarError)
        }}
      >
        <Link2 size={16} /> Copiar el enlace al marco
      </button>
    </div>
  )
}
