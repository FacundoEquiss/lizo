// El diálogo del proyecto (7.3): "Nuevo proyecto" o "Editar proyecto", con FormularioProyecto adentro (el celular usa el
// mismo formulario en una hoja). También el de "Nuevo tablero": el nombre y el TIPO (Tablero, Diagrama, Diseño o Completo:
// un tablero tiene solo las vistas que necesita, compartido/vistas.ts). Se abre desde la barra lateral (`nuevoTablero`).
import { X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../estado/api'
import { avisarError } from '../estado/avisos'
import { irA } from '../estado/ruta'
import { useTienda } from '../estado/tienda'
import { Dialogo } from '../ui/Dialogo'
import { ElegirTipoTablero } from '../ui/TipoTablero'
import { TIPO_DE_FABRICA, VISTAS_DEL_TIPO, vistaInicial, type TipoTablero } from '../../../compartido/vistas'
import { FormularioProyecto } from './FormularioProyecto'

function FormularioTablero({ proyectoId, alTerminar }: { proyectoId: string; alTerminar: () => void }) {
  const [nombre, setNombre] = useState('')
  // De fábrica «Tablero» (solo Kanban); siempre se puede cambiar de opinión después, con «Vistas…» del menú del tablero.
  const [tipo, setTipo] = useState<TipoTablero>(TIPO_DE_FABRICA)
  const [enviando, setEnviando] = useState(false)
  const crear = async () => {
    if (!nombre.trim() || enviando) return
    setEnviando(true)
    try {
      const t = await api.crearTablero(proyectoId, nombre.trim(), tipo)
      const proyectos = await api.proyectos()
      useTienda.setState({ proyectos })
      const p = proyectos.find((x) => x.id === proyectoId)
      // Entra directo a la primera vista que tiene (un diagrama abre el lienzo, no un Kanban que no hay).
      if (p) irA({ prefijo: p.prefijo, slug: t.slug, vista: vistaInicial(t.vistas ?? VISTAS_DEL_TIPO[tipo]), tarjeta: null })
      alTerminar()
    } catch (e) {
      avisarError(e)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <form
      className="formulario-proyecto"
      onSubmit={(e) => {
        e.preventDefault()
        void crear()
      }}
    >
      <label className="campo-etiquetado">
        <span>Nombre</span>
        <input
          className="campo"
          autoFocus
          value={nombre}
          maxLength={60}
          placeholder="Por ejemplo: Lanzamiento"
          onChange={(e) => setNombre(e.target.value)}
        />
      </label>
      <div className="campo-etiquetado">
        <span id="tipo-tablero-nuevo">Tipo</span>
        <ElegirTipoTablero valor={tipo} alCambiar={setTipo} etiquetaId="tipo-tablero-nuevo" />
      </div>
      <div className="dialogo__pie">
        <button type="button" className="boton" onClick={alTerminar}>
          Cancelar
        </button>
        <button type="submit" className="boton boton--primario" disabled={!nombre.trim() || enviando}>
          Crear tablero
        </button>
      </div>
    </form>
  )
}

export function DialogoProyecto() {
  const dialogo = useTienda((s) => s.dialogo)
  const idProyecto = useTienda((s) => s.proyectoDialogo ?? s.tablero?.proyecto.id ?? null)
  const proyecto = useTienda((s) => s.proyectos.find((p) => p.id === idProyecto))
  const modo =
    dialogo === 'nuevo-proyecto'
      ? 'crear'
      : dialogo === 'editar-proyecto' && proyecto
        ? 'editar'
        : dialogo === 'nuevo-tablero' && proyecto
          ? 'tablero'
          : null
  const cerrar = () => useTienda.getState().setDialogo(null)
  const titulo = modo === 'crear' ? 'Nuevo proyecto' : modo === 'editar' ? 'Editar proyecto' : 'Nuevo tablero'
  return (
    <Dialogo
      abierto={!!modo}
      alCerrar={cerrar}
      tituloId="titulo-dialogo-proyecto"
      className={modo === 'tablero' ? 'dialogo--tablero' : 'dialogo--proyecto'}
      // Lo primero que se enfoca lo decide el formulario (el nombre).
      enfocarInicial={-1}
    >
      <header className="dialogo__cabecera">
        <div>
          <h2 id="titulo-dialogo-proyecto">{titulo}</h2>
          {modo === 'tablero' && <p className="dialogo__bajada">En {proyecto!.nombre}. Elegí qué necesita: tiene solo las vistas que le des.</p>}
        </div>
        <button type="button" className="boton-icono" onClick={cerrar} aria-label="Cerrar">
          <X size={18} />
        </button>
      </header>
      {modo === 'tablero' ? (
        <FormularioTablero proyectoId={proyecto!.id} alTerminar={cerrar} />
      ) : (
        modo && (
          <FormularioProyecto
            key={modo === 'editar' ? proyecto!.id : 'nuevo'}
            modo={modo}
            proyecto={modo === 'editar' ? proyecto : undefined}
            alTerminar={cerrar}
            alCancelar={cerrar}
          />
        )
      )}
    </Dialogo>
  )
}
