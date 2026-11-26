// Lo que se arma al agregar una tarjeta (compositor de escritorio y hoja del celular): el título, el tipo, la prioridad,
// las etiquetas y el motivo. Las dos pantallas comparten esto para que "agregar" se entienda igual en la PC y en el
// teléfono y mande lo mismo al servidor (POST /api/tarjetas ya aceptaba todo: no hizo falta tocar nada del servidor).
//
// Lo elegido con los selectores gana sobre lo que dice el texto (error: … !alta #cocina): si alguien elige «Idea» y
// además escribe «error:», vale la elección. Las etiquetas se suman. `entender` devuelve lo que se va a mandar, y es lo
// mismo que se muestra en pantalla: lo que se ve es lo que se crea.
import { useCallback, useState } from 'react'
import type { Color, Etiqueta, Prioridad, TipoTarjeta } from '../../../../../compartido/tipos'
import { normalizar } from '../../../../../compartido/texto'
import { analizarRapido } from './analizar'

export interface Borrador {
  titulo: string
  /** Elegido con el selector; si es null vale lo que dice el texto («error:») o «Tarea». */
  tipo: TipoTarjeta | null
  prioridad: Prioridad | null
  /** Etiquetas del proyecto elegidas (ids). */
  etiquetas: string[]
  /** Etiquetas que todavía no existen: el servidor las crea junto con la tarjeta. */
  nuevas: string[]
  motivo: string
}

export const BORRADOR_VACIO: Borrador = { titulo: '', tipo: null, prioridad: null, etiquetas: [], nuevas: [], motivo: '' }

/** Una etiqueta tal como se muestra en el compositor. */
export interface EtiquetaAlta {
  clave: string
  nombre: string
  color: Color
  /** No existe todavía en el proyecto. */
  nueva: boolean
  /** Sale de lo escrito en el título (#cocina): se saca editando el texto, no tocándola. */
  deTexto: boolean
}

export interface Entendido {
  titulo: string
  tipo: TipoTarjeta
  prioridad: Prioridad
  etiquetas: EtiquetaAlta[]
  responsables: string[]
  motivo: string
}

/** Lo que el compositor entendió: elección + sintaxis rápida del título. */
export function entender(b: Borrador, existentes: Etiqueta[]): Entendido {
  const r = analizarRapido(b.titulo)
  const etiquetas: EtiquetaAlta[] = []
  const vistas = new Set<string>()
  const agregar = (e: EtiquetaAlta) => {
    const k = normalizar(e.nombre)
    if (vistas.has(k)) return
    vistas.add(k)
    etiquetas.push(e)
  }
  for (const id of b.etiquetas) {
    const e = existentes.find((x) => x.id === id)
    if (e) agregar({ clave: e.id, nombre: e.nombre, color: e.color, nueva: false, deTexto: false })
  }
  for (const n of b.nuevas) agregar({ clave: `nueva:${n}`, nombre: n, color: 'gris', nueva: true, deTexto: false })
  for (const n of r.etiquetas) {
    const e = existentes.find((x) => normalizar(x.nombre) === normalizar(n))
    agregar(
      e
        ? { clave: e.id, nombre: e.nombre, color: e.color, nueva: false, deTexto: true }
        : { clave: `nueva:${n}`, nombre: n, color: 'gris', nueva: true, deTexto: true },
    )
  }
  return {
    titulo: r.titulo,
    tipo: b.tipo ?? r.tipo ?? 'tarea',
    prioridad: b.prioridad ?? r.prioridad ?? 'ninguna',
    etiquetas,
    responsables: r.responsables,
    motivo: b.motivo.trim(),
  }
}

/** Lo que se manda a crear: el título limpio y los datos extra. Sin título no hay tarjeta (null). */
export function datosDeAlta(e: Entendido, b: Borrador): { titulo: string; extra: Record<string, unknown> } | null {
  if (!e.titulo) return null
  const extra: Record<string, unknown> = {}
  const tipoElegido = b.tipo ?? analizarRapido(b.titulo).tipo
  const prioridadElegida = b.prioridad ?? analizarRapido(b.titulo).prioridad
  if (tipoElegido) extra.tipo = e.tipo
  if (prioridadElegida) extra.prioridad = e.prioridad
  // Los existentes van por id; los nuevos por nombre (el servidor los crea con el siguiente color de la paleta).
  if (e.etiquetas.length) extra.etiquetas = e.etiquetas.map((x) => (x.nueva ? x.nombre : x.clave))
  if (e.responsables.length) extra.responsables = e.responsables
  if (e.motivo) extra.porque = { motivo: e.motivo }
  return { titulo: e.titulo, extra }
}

/** ¿Hay algo escrito que valga la pena no perder? (Tipo, prioridad y etiquetas solos no cuentan.) */
export const hayTexto = (b: Borrador) => Boolean(b.titulo.trim() || b.motivo.trim())

/** El estado del borrador y las acciones para cambiarlo, iguales en las dos pantallas. */
export function useBorrador(inicial: Borrador = BORRADOR_VACIO) {
  const [b, poner] = useState<Borrador>(inicial)
  const cambiar = useCallback((c: Partial<Borrador>) => poner((x) => ({ ...x, ...c })), [])
  const alternarEtiqueta = useCallback(
    (id: string) =>
      poner((x) => ({ ...x, etiquetas: x.etiquetas.includes(id) ? x.etiquetas.filter((e) => e !== id) : [...x.etiquetas, id] })),
    [],
  )
  const quitarNueva = useCallback((n: string) => poner((x) => ({ ...x, nuevas: x.nuevas.filter((e) => e !== n) })), [])
  const agregarNueva = useCallback(
    (nombre: string, existentes: Etiqueta[]) =>
      poner((x) => {
        const limpio = nombre.trim().replace(/^#/, '')
        if (!limpio) return x
        // Si ya existe una con ese nombre, se elige esa en vez de duplicarla.
        const e = existentes.find((y) => normalizar(y.nombre) === normalizar(limpio))
        if (e) return x.etiquetas.includes(e.id) ? x : { ...x, etiquetas: [...x.etiquetas, e.id] }
        if (x.nuevas.some((n) => normalizar(n) === normalizar(limpio))) return x
        return { ...x, nuevas: [...x.nuevas, limpio] }
      }),
    [],
  )
  /** Después de agregar: se limpia lo que es de esta tarjeta; tipo, prioridad y etiquetas quedan para la siguiente. */
  const siguiente = useCallback(() => poner((x) => ({ ...x, titulo: '', motivo: '' })), [])
  const vaciar = useCallback(() => poner(BORRADOR_VACIO), [])
  return { b, poner, cambiar, alternarEtiqueta, agregarNueva, quitarNueva, siguiente, vaciar }
}

/** Una tarjeta que no se pudo agregar: queda a la vista para reintentar (no se pierde lo escrito). */
export interface Fallida {
  id: number
  titulo: string
  datos: { titulo: string; extra: Record<string, unknown> }
}
