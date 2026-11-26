// La barra de una tabla y la de un gráfico (Telar 0.3). Tabla: `[Abrir] [+ Fila] [Color ▾] [Gráfico]`. Gráfico: `[Tipo ▾] [Datos]`.
// Lo demás (columnas, formato, orden, resumen, pegar desde Excel, CSV) está en el editor que abre «Abrir» o «Datos».
import { ChartColumn, Pencil, Plus, Table2 } from 'lucide-react'
import { fuenteSugerida, leerGrafico, TIPOS_GRAFICO, type TipoGrafico } from '../../../../../compartido/grafico'
import { idCorto, leerTabla } from '../../../../../compartido/tabla'
import { useTienda } from '../../../estado/tienda'
import { useAccionesLienzo } from '../acciones'
import { useLienzo } from '../estado'
import { cambiarDatos, useSeleccionLienzo } from '../seleccion'
import { BotonBarra, MenuBarra, Muestra, Separador, type TamBarra } from './piezas'
import { SelectorColor } from './SelectorColor'

export function SeccionTabla({ tam }: { tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const acciones = useAccionesLienzo()
  const e = sel.nodos[0]
  if (!e || sel.nodos.length !== 1 || e.tipo !== 'tabla') return null
  const t = leerTabla(e.datos)
  const conGrafico = async () => {
    const fuente = fuenteSugerida(t, e.id)
    if (!fuente) return
    const id = await acciones.crear(
      'grafico',
      e.x + e.ancho + 48,
      e.y,
      { v: 1, tipo: 'barras', titulo: '', fuente, propios: null },
      { ancho: 480, alto: 320 },
      { esperar: true },
    )
    if (id) acciones.irA([id])
  }
  return (
    <>
      <BotonBarra tam={tam} etiqueta="Abrir la tabla para editarla" icono={<Table2 size={16} />} texto="Abrir" onClick={() => useLienzo.getState().set({ tablaAbierta: e.id })} />
      <BotonBarra
        tam={tam}
        etiqueta="Agregar una fila"
        icono={<Plus size={16} />}
        texto="Fila"
        onClick={() => void useTienda.getState().operarTabla(e.id, [{ op: 'agregar_filas', filas: [[]], ids: [idCorto('f')] }], { etiqueta: 'fila nueva' })}
      />
      <Separador />
      <MenuBarra etiqueta="Color de la tabla" tam={tam} disparador={<Muestra color={t.color} variable="--e-s" />}>
        {(cerrar) => (
          <SelectorColor
            valor={t.color}
            variable="--e-s"
            tam={tam}
            alElegir={(c) => {
              void useTienda.getState().operarTabla(e.id, [], { etiqueta: 'color de la tabla', cambios: { color: c } })
              cerrar()
            }}
          />
        )}
      </MenuBarra>
      <BotonBarra tam={tam} etiqueta="Armar un gráfico con los datos de esta tabla" icono={<ChartColumn size={16} />} texto="Gráfico" onClick={() => void conGrafico()} />
    </>
  )
}

export function SeccionGrafico({ tam }: { tam?: TamBarra }) {
  const sel = useSeleccionLienzo()
  const e = sel.nodos[0]
  if (!e || sel.nodos.length !== 1 || e.tipo !== 'grafico') return null
  const g = leerGrafico(e.datos)
  const nombre = TIPOS_GRAFICO.find((x) => x.id === g.tipo)?.nombre ?? g.tipo
  return (
    <>
      <MenuBarra etiqueta="Tipo de gráfico" tam={tam} disparador={<span className="barra-ctx__texto-menu">{nombre}</span>}>
        {(cerrar) => (
          <div className="menu__lista" role="menu">
            {TIPOS_GRAFICO.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={g.tipo === t.id}
                className={`menu__item${g.tipo === t.id ? ' menu__item--activo' : ''}`}
                onClick={() => {
                  cambiarDatos([e], { tipo: t.id as TipoGrafico }, 'tipo de gráfico')
                  cerrar()
                }}
              >
                <span className="menu__texto">{t.nombre}</span>
              </button>
            ))}
          </div>
        )}
      </MenuBarra>
      <BotonBarra tam={tam} etiqueta="Elegir de dónde salen los datos" icono={<Pencil size={16} />} texto="Datos" onClick={() => useLienzo.getState().set({ graficoAbierto: e.id })} />
    </>
  )
}
