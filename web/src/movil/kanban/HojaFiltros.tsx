// Filtrar con el pulgar (plan del celular, 5.5). El filtro sigue siendo EL MISMO TEXTO de la tienda (setFiltro): la hoja
// solo lo arma con toques. Así no hay dos sistemas de filtro, lo que se filtra acá es exactamente lo que se filtraría en
// escritorio, y cualquier operador nuevo sirve en los dos lados. Los operadores son los de compartido/filtro.ts.
import { useMemo } from 'react'
import { PRIORIDADES, TIPOS_TARJETA } from '../../../../compartido/constantes'
import { analizarConsulta, filtrarTarjetas, hayFiltro } from '../../../../compartido/filtro'
import { useTienda } from '../../estado/tienda'
import { IconoPrioridad, IconoTipo } from '../../ui/comunes'
import { useMovil } from '../estado'
import { HojaInferior } from '../ui/HojaInferior'

/** Los términos del filtro tal como se escribieron (con su signo y sus comillas). */
const TERMINO = /-?(?:\w+:)?(?:"[^"]*"|\S+)/g
const terminos = (texto: string) => texto.match(TERMINO) ?? []

/** Dos términos son el mismo si dicen lo mismo para el filtro (#Cocina = etiqueta:cocina, !alta = prioridad:alta). */
function mismo(a: string, b: string) {
  const [x] = analizarConsulta(a)
  const [y] = analizarConsulta(b)
  return !!x && !!y && x.campo === y.campo && x.negado === y.negado && x.valor === y.valor
}

function etiquetaATermino(nombre: string) {
  return /\s/.test(nombre) ? `etiqueta:"${nombre}"` : `#${nombre}`
}

export function HojaFiltros() {
  const abierta = useMovil((s) => s.hoja === 'filtros')
  const cerrar = useMovil((s) => s.cerrar)
  const filtro = useTienda((s) => s.filtro)
  const setFiltro = useTienda((s) => s.setFiltro)
  const tablero = useTienda((s) => s.tablero)

  const coinciden = useMemo(() => {
    if (!tablero) return 0
    const activas = tablero.tarjetas.filter((t) => !t.archivada)
    if (!hayFiltro(filtro)) return activas.length
    return filtrarTarjetas(activas, filtro, {
      listas: new Map(tablero.listas.map((l) => [l.id, l])),
      etiquetas: new Map(tablero.etiquetas.map((e) => [e.id, e])),
      miembros: new Map(tablero.miembros.map((m) => [m.id, m])),
    }).length
  }, [tablero, filtro])

  const actuales = terminos(filtro)
  const activo = (t: string) => actuales.some((x) => mismo(x, t))
  const alternar = (t: string) => {
    const quedan = actuales.filter((x) => !mismo(x, t))
    setFiltro((quedan.length === actuales.length ? [...actuales, t] : quedan).join(' '))
  }
  const etiquetas = (tablero?.etiquetas ?? []).filter((e) => e.grupo !== 'tipo').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  const grupos: { titulo: string; opciones: { termino: string; texto: string; icono?: React.ReactNode; color?: string }[] }[] = [
    { titulo: 'Míos', opciones: [{ termino: '@yo', texto: 'Asignadas a mí' }] },
    {
      titulo: 'Tipo',
      opciones: TIPOS_TARJETA.map((t) => ({ termino: `tipo:${t.id}`, texto: t.nombre, icono: <IconoTipo tipo={t.id} tam={16} /> })),
    },
    {
      titulo: 'Prioridad',
      opciones: PRIORIDADES.filter((p) => p.id !== 'ninguna').map((p) => ({ termino: `!${p.id}`, texto: p.nombre, icono: <IconoPrioridad prioridad={p.id} tam={16} /> })),
    },
    ...(etiquetas.length
      ? [{ titulo: 'Etiquetas', opciones: etiquetas.map((e) => ({ termino: etiquetaATermino(e.nombre), texto: e.nombre, color: e.color })) }]
      : []),
    {
      titulo: 'Vence',
      opciones: [
        { termino: 'vence:hoy', texto: 'Hoy' },
        { termino: 'vence:semana', texto: 'Esta semana' },
        { termino: 'vence:vencidas', texto: 'Vencidas' },
      ],
    },
    {
      titulo: 'Tiene',
      opciones: [
        { termino: 'tiene:pr', texto: 'Pull request' },
        { termino: 'tiene:porque', texto: 'Porqué' },
        { termino: 'tiene:adjuntos', texto: 'Adjuntos' },
      ],
    },
  ]

  return (
    <HojaInferior
      abierta={abierta}
      alCerrar={cerrar}
      titulo="Filtrar"
      className="hoja-filtros"
      pie={
        <>
          <button type="button" className="boton boton--fantasma" onClick={() => setFiltro('')} disabled={!filtro}>
            Limpiar
          </button>
          <span className="hoja-filtros__espacio" />
          <button type="button" className="boton boton--primario hoja-filtros__ver" onClick={cerrar}>
            {coinciden === 1 ? 'Ver 1 tarjeta' : `Ver ${coinciden} tarjetas`}
          </button>
        </>
      }
    >
      <div className="hoja-filtros__cuerpo">
        <input
          className="campo hoja-filtros__campo"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="tipo:error  #área  @yo  vence:semana"
          aria-label="Filtro escrito (con operadores)"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {grupos.map((g) => (
          <section key={g.titulo} className="hoja-filtros__grupo" aria-label={g.titulo}>
            <h3>{g.titulo}</h3>
            <div className="hoja-filtros__opciones">
              {g.opciones.map((o) => {
                const si = activo(o.termino)
                return (
                  <button
                    key={o.termino}
                    type="button"
                    className={`pildora hoja-filtros__opcion${si ? ' pildora--elegida' : ''}`}
                    aria-pressed={si}
                    onClick={() => alternar(o.termino)}
                  >
                    {o.color && <span className="punto" style={{ background: `var(--e-${o.color}-s)` }} aria-hidden />}
                    {o.icono}
                    {o.texto}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
        <p className="hoja-filtros__ayuda">Se combinan: «Míos» + «Error» + «Alta» muestra tus errores de prioridad alta.</p>
      </div>
    </HojaInferior>
  )
}

