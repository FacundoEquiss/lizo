// Inspector (plan 6.6): pestañas Diseño · Código · Notas. Con un marco o una capa muestra sus propiedades (editables en los
// propios); con un ítem del sistema, su muestra, valor, dónde se declara y dónde se usa; sin selección, el resumen de la
// página. El contenido hace un fundido de 100 ms al cambiar de selección (sin moverse).
import { motion } from 'motion/react'
import { useDiseno } from '../estado'
import { Codigo } from './Codigo'
import { DisenoCapa } from './DisenoCapa'
import { InspectorItem } from './Item'
import { Notas } from './Notas'
import { ResumenPagina } from './ResumenPagina'

const PESTANAS = [
  ['diseno', 'Diseño', 'Alt+8'],
  ['codigo', 'Código', 'Alt+9'],
  ['notas', 'Notas', ''],
] as const

export function Inspector() {
  const pestana = useDiseno((s) => s.pref.pestanaInspector)
  const sel = useDiseno((s) => s.seleccion)
  const clave = sel.item ? `i:${sel.item}` : sel.marco ? `m:${sel.marco}.${sel.capa ?? ''}` : 'nada'
  const objetivo = sel.item ? `item:${sel.item}` : sel.marco ? `marco:${sel.marco}${sel.capa ? '#' + sel.capa : ''}` : null
  return (
    <aside className="dz-inspector" aria-label="Inspector">
      <header className="dz-inspector__cab">
        <div className="segmentado segmentado--chico dz-inspector__pestanas" role="tablist" aria-label="Pestañas del inspector">
          {PESTANAS.map(([id, nombre, tecla]) => (
            <button
              key={id}
              role="tab"
              aria-selected={pestana === id}
              aria-keyshortcuts={tecla || undefined}
              data-tip={tecla ? `${nombre}` : undefined}
              data-tecla={tecla ? tecla : undefined}
              className={`segmentado__opcion${pestana === id ? ' segmentado__opcion--activa' : ''}`}
              onClick={() => useDiseno.getState().setPref({ pestanaInspector: id })}
            >
              {nombre}
            </button>
          ))}
        </div>
      </header>
      <motion.div key={`${clave}|${pestana}`} className="dz-inspector__cuerpo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.1 }}>
        {pestana === 'notas' ? (
          objetivo ? (
            <Notas objetivo={objetivo} />
          ) : (
            <ResumenPagina />
          )
        ) : sel.item ? (
          <InspectorItem clave={sel.item} pestana={pestana} />
        ) : sel.marco ? (
          pestana === 'codigo' ? (
            <Codigo marco={sel.marco} capa={sel.capa} />
          ) : (
            <DisenoCapa marco={sel.marco} capa={sel.capa} />
          )
        ) : (
          <ResumenPagina />
        )}
      </motion.div>
    </aside>
  )
}
