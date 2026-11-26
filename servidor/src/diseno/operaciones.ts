// Aplica las operaciones de editar_marco (y de la web) sobre el HTML y el CSS de un marco. Todas o ninguna: se trabaja
// sobre una copia y, si una falla, no se guarda nada. Cada error dice qué hacer (plan 7.3, regla 4).
import { medidasDe } from '../../../compartido/diseno/prefijados'
import {
  agregarHijo,
  analizarHtml,
  attr,
  buscarPorId,
  clases,
  crearTexto,
  elementosHijos,
  escribirEstilo,
  insertarAntes,
  insertarDespues,
  leerEstilo,
  ponerAttr,
  quitarAttr,
  quitarNodo,
  recorrer,
  reemplazarHijos,
  serializarHtml,
  textoDe,
  textoPropio,
  type ElementoHtml,
} from '../../../compartido/diseno/html'
import { claseDeCapa, elementoCapaDeHtml, nombreCapa } from '../../../compartido/diseno/capas'
import type { OperacionMarco } from '../../../compartido/diseno/operaciones'
import type { DatosMarco } from '../../../compartido/diseno/tipos'
import { ErrorDominio } from '../dominio/servicio'
import { sanearCss, sanearEstiloEnLinea, sanearHtml, validarUrl } from './sanear'

export interface EstadoMarco {
  html: string
  css: string
  datos: DatosMarco
  ancho: number
  alto: number
  nombre: string
  seccion: string
  grupo: string | null
  x: number
  y: number
}

export interface ResultadoOperaciones {
  estado: EstadoMarco
  lineas: string[]
  creadas: string[]
  avisos: string[]
  /** Cambió el contenido (html, css, datos o tamaño): hace falta una revisión nueva. */
  contenido: boolean
}

const corto = (s: string, n = 48) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

export function listaDeCapas(raiz: ElementoHtml, max = 14): string {
  const r: string[] = []
  let total = 0
  recorrer(raiz, (el) => {
    const id = attr(el, 'data-id')
    if (!id) return
    total++
    if (r.length < max) r.push(`\`${id}\` ${nombreCapa(elementoCapaDeHtml(el))}`)
  })
  if (!total) return 'el marco no tiene capas todavía'
  return r.join(', ') + (total > max ? ` y ${total - max} más (leer_diseno con marco las lista todas)` : '')
}

function capaDe(raiz: ElementoHtml, id: string, que = 'la capa'): ElementoHtml {
  const el = buscarPorId(raiz, id.replace(/^#/, ''))
  if (!el) throw new ErrorDominio(`No existe ${que} \`${id}\`. Las capas de este marco: ${listaDeCapas(raiz)}.`, 404)
  return el
}

const describir = (el: ElementoHtml) => `${attr(el, 'data-id')} (${nombreCapa(elementoCapaDeHtml(el))})`

export function aplicarOperaciones(inicial: EstadoMarco, ops: OperacionMarco[]): ResultadoOperaciones {
  const estado: EstadoMarco = { ...inicial, datos: { ...inicial.datos } }
  const raiz = analizarHtml(estado.html)
  const lineas: string[] = []
  const creadas: string[] = []
  const avisos: string[] = []
  let contenido = false
  const idsActuales = () => {
    const s = new Set<string>()
    recorrer(raiz, (el) => {
      const id = attr(el, 'data-id')
      if (id) s.add(id)
    })
    return s
  }
  const fragmento = (html: string) => {
    const s = sanearHtml(html, { idsExistentes: idsActuales() })
    avisos.push(...s.avisos)
    if (s.css) {
      estado.css = (estado.css ? estado.css + '\n' : '') + s.css
      lineas.push(`css: sumé el <style> que venía en el HTML (${s.css.length} caracteres)`)
    }
    creadas.push(...s.idsNuevos)
    return analizarHtml(s.html).hijos
  }

  ops.forEach((op, i) => {
    const n = ops.length > 1 ? `${i + 1}. ` : ''
    switch (op.op) {
      case 'texto': {
        const el = capaDe(raiz, op.capa)
        if (attr(el, 'data-pieza') !== null)
          throw new ErrorDominio(`La capa \`${op.capa}\` es una instancia de «${attr(el, 'data-pieza')}»: su texto se cambia con la operación propiedades.`, 400)
        const conTexto = elementosHijos(el)
        if (conTexto.length) {
          let sugerida: ElementoHtml | null = null
          recorrer(el, (h) => {
            if (!sugerida && attr(h, 'data-id') && textoPropio(h).trim()) sugerida = h
          })
          const s = sugerida as ElementoHtml | null
          throw new ErrorDominio(
            `La capa \`${op.capa}\` tiene capas adentro${s ? `; el texto está en \`${attr(s, 'data-id')}\` (${nombreCapa(elementoCapaDeHtml(s))})` : ''}. Cambiá el texto de esa capa, o usá reemplazar con el HTML nuevo.`,
            400,
          )
        }
        const antes = textoDe(el)
        reemplazarHijos(el, op.texto ? [crearTexto(op.texto)] : [])
        lineas.push(`${n}texto ${op.capa}: «${corto(antes)}» → «${corto(op.texto)}»`)
        contenido = true
        break
      }
      case 'estilo': {
        const el = capaDe(raiz, op.capa)
        const estilo = leerEstilo(el)
        const cambios: string[] = []
        for (const [k0, v] of Object.entries(op.estilos)) {
          const k = k0.trim().startsWith('--') ? k0.trim() : k0.trim().toLowerCase().replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
          if (!/^(--)?[a-z][\w-]*$/i.test(k)) throw new ErrorDominio(`«${k0}» no es una propiedad de CSS.`, 400)
          if (v === null || v === '') {
            estilo.delete(k)
            cambios.push(`sin ${k}`)
          } else {
            const valor = sanearEstiloEnLinea(typeof v === 'number' ? (/^(opacity|z-index|flex|flex-grow|flex-shrink|order|font-weight|line-height)$/.test(k) ? String(v) : `${v}px`) : String(v))
            if (/[;{}]/.test(valor)) throw new ErrorDominio(`El valor de ${k} no puede tener ; ni llaves.`, 400)
            estilo.set(k, valor.trim())
            cambios.push(`${k} ${corto(valor.trim(), 40)}`)
          }
        }
        escribirEstilo(el, estilo)
        lineas.push(`${n}estilo ${describir(el)}: ${cambios.join(', ')}`)
        contenido = true
        break
      }
      case 'atributo': {
        const el = capaDe(raiz, op.capa)
        const nombre = op.nombre.trim()
        const nb = nombre.toLowerCase()
        if (nb === 'data-id') throw new ErrorDominio('El data-id no se cambia: es la dirección de la capa.', 400)
        if (nb.startsWith('on')) throw new ErrorDominio('Los marcos no corren código: no hay atributos de eventos.', 400)
        if (!/^[a-z_:][\w:.-]*$/i.test(nombre)) throw new ErrorDominio(`«${nombre}» no es un nombre de atributo válido.`, 400)
        if (op.valor === null) {
          quitarAttr(el, nombre)
          lineas.push(`${n}atributo ${op.capa}: sin ${nombre}`)
        } else {
          let v = op.valor
          if (nb === 'src' || nb === 'poster') v = validarUrl(v)
          else if (nb === 'style') v = sanearEstiloEnLinea(v)
          else if (nb === 'href') {
            ponerAttr(el, 'data-href', v)
            lineas.push(`${n}atributo ${op.capa}: data-href (los enlaces no navegan dentro de un marco)`)
            contenido = true
            break
          } else if (nb === 'data-props') {
            try {
              const j = JSON.parse(v)
              if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error()
            } catch {
              throw new ErrorDominio(`data-props tiene que ser un objeto JSON: {"color":"verde"}.`, 400)
            }
          } else if (['srcdoc', 'formaction', 'action', 'srcset'].includes(nb)) throw new ErrorDominio(`El atributo ${nombre} no se acepta en un marco.`, 400)
          const antes = attr(el, nombre)
          ponerAttr(el, nombre, v)
          lineas.push(`${n}atributo ${op.capa}: ${nombre} ${antes === null ? '' : `«${corto(antes, 30)}» → `}«${corto(v, 50)}»`)
        }
        contenido = true
        break
      }
      case 'propiedades': {
        const el = capaDe(raiz, op.capa)
        const pieza = attr(el, 'data-pieza')
        if (pieza === null)
          throw new ErrorDominio(`La capa \`${op.capa}\` no es una instancia de pieza (no tiene data-pieza). Para cambiar su texto usá texto; para su aspecto, estilo.`, 400)
        let props: Record<string, unknown> = {}
        try {
          props = JSON.parse(attr(el, 'data-props') || '{}')
        } catch {
          props = {}
        }
        const cambios: string[] = []
        for (const [k, v] of Object.entries(op.valores)) {
          const antes = props[k]
          if (v === null) delete props[k]
          else props[k] = v
          cambios.push(`${k} ${antes === undefined ? '' : `${JSON.stringify(antes)} → `}${v === null ? '(de fábrica)' : JSON.stringify(v)}`)
        }
        ponerAttr(el, 'data-props', JSON.stringify(props))
        lineas.push(`${n}propiedades ${op.capa} (◇ ${pieza}): ${cambios.join(', ')}`)
        contenido = true
        break
      }
      case 'reemplazar': {
        const el = capaDe(raiz, op.capa)
        const nuevos = fragmento(op.html)
        if (!nuevos.length) throw new ErrorDominio('El HTML nuevo quedó vacío después de sanearlo.', 400)
        const primero = nuevos.find((x): x is ElementoHtml => x.tipo === 'el')
        const viejo = attr(el, 'data-id')!
        // el primer elemento nuevo hereda la dirección de la capa (así los enlaces y comentarios la siguen)
        if (primero && viejo) {
          const nuevoId = attr(primero, 'data-id')
          if (nuevoId) {
            const k = creadas.indexOf(nuevoId)
            if (k >= 0) creadas.splice(k, 1)
          }
          ponerAttr(primero, 'data-id', viejo)
          primero.attrs = [['data-id', viejo], ...primero.attrs.filter((a) => a[0] !== 'data-id')]
        }
        for (const nuevo of nuevos) insertarAntes(el, nuevo)
        quitarNodo(el)
        lineas.push(`${n}reemplazar ${viejo}: ${nuevos.length} nodo(s) nuevo(s)`)
        contenido = true
        break
      }
      case 'insertar': {
        const destinos = [op.dentro, op.antes_de, op.despues_de].filter(Boolean)
        if (destinos.length > 1) throw new ErrorDominio('Mandá solo uno de dentro, antes_de o despues_de.', 400)
        const antesDeCrear = creadas.length
        const nuevos = fragmento(op.html)
        if (!nuevos.length) throw new ErrorDominio('El HTML a insertar quedó vacío después de sanearlo.', 400)
        if (op.antes_de) {
          const ref = capaDe(raiz, op.antes_de)
          for (const x of nuevos) insertarAntes(ref, x)
        } else if (op.despues_de) {
          let ref = capaDe(raiz, op.despues_de)
          for (const x of nuevos) {
            insertarDespues(ref, x)
            if (x.tipo === 'el') ref = x
          }
        } else {
          const padre = op.dentro && op.dentro !== 'marco' ? capaDe(raiz, op.dentro) : raiz
          if (attr(padre, 'data-pieza') !== null) throw new ErrorDominio('No se puede insertar dentro de una instancia: su contenido lo pone la pieza.', 400)
          for (const x of nuevos) agregarHijo(padre, x)
        }
        const ids = creadas.slice(antesDeCrear)
        lineas.push(
          `${n}insertar ${ids.length} capa(s)${ids.length ? `: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? '…' : ''}` : ''}${op.dentro ? ` dentro de ${op.dentro}` : op.antes_de ? ` antes de ${op.antes_de}` : op.despues_de ? ` después de ${op.despues_de}` : ' al final del marco'}`,
        )
        contenido = true
        break
      }
      case 'quitar': {
        const el = capaDe(raiz, op.capa)
        const d = describir(el)
        quitarNodo(el)
        lineas.push(`${n}quitar ${d}`)
        contenido = true
        break
      }
      case 'mover': {
        const el = capaDe(raiz, op.capa)
        const destinos = [op.dentro, op.antes_de, op.despues_de].filter(Boolean)
        if (destinos.length !== 1) throw new ErrorDominio('Para mover, mandá uno (y solo uno) de dentro, antes_de o despues_de.', 400)
        const objetivo = op.dentro === 'marco' ? raiz : capaDe(raiz, (op.dentro ?? op.antes_de ?? op.despues_de)!, 'la capa de destino')
        for (let p: ElementoHtml | null = objetivo; p; p = p.padre)
          if (p === el) throw new ErrorDominio('No se puede mover una capa adentro de sí misma.', 400)
        if (op.antes_de) insertarAntes(objetivo, el)
        else if (op.despues_de) insertarDespues(objetivo, el)
        else {
          if (attr(objetivo, 'data-pieza') !== null) throw new ErrorDominio('No se puede mover algo adentro de una instancia.', 400)
          agregarHijo(objetivo, el)
        }
        lineas.push(`${n}mover ${describir(el)} ${op.dentro ? `dentro de ${op.dentro}` : op.antes_de ? `antes de ${op.antes_de}` : `después de ${op.despues_de}`}`)
        contenido = true
        break
      }
      case 'css': {
        const css = sanearCss(op.css)
        if (op.como === 'reemplazar') {
          estado.css = css
          lineas.push(`${n}css: reemplacé el CSS del marco (${css.length} caracteres)`)
        } else {
          estado.css = (estado.css ? estado.css.trimEnd() + '\n' : '') + css
          lineas.push(`${n}css: agregué ${css.length} caracteres al final`)
        }
        contenido = true
        break
      }
      case 'marco': {
        const partes: string[] = []
        if (op.nombre !== undefined) {
          estado.nombre = op.nombre.trim()
          partes.push(`nombre «${estado.nombre}»`)
        }
        if (op.tamano !== undefined) {
          const m = medidasDe(op.tamano)
          if (!m) throw new ErrorDominio(`No entiendo el tamaño «${JSON.stringify(op.tamano)}». Usá un prefijado (instagram-historia) o { ancho, alto }.`, 400)
          if (m.ancho < 16 || m.alto < 16 || m.ancho > 8192 || m.alto > 8192) throw new ErrorDominio('Un marco mide entre 16 y 8192 px de lado.', 400)
          estado.ancho = m.ancho
          estado.alto = m.alto
          estado.datos.prefijado = m.prefijado ?? undefined
          partes.push(`tamaño ${m.ancho}×${m.alto}`)
          contenido = true
        }
        if (op.fondo !== undefined) {
          estado.datos.fondo = sanearEstiloEnLinea(op.fondo).replace(/[;{}]/g, '')
          partes.push(`fondo ${estado.datos.fondo}`)
          contenido = true
        }
        if (op.modo !== undefined) {
          estado.datos.modo = op.modo ?? undefined
          partes.push(op.modo ? `modo ${op.modo}` : 'sin modo')
          contenido = true
        }
        if (op.seccion !== undefined) {
          estado.seccion = op.seccion.trim()
          partes.push(`sección «${estado.seccion}»`)
        }
        if (op.grupo !== undefined) {
          estado.grupo = op.grupo
          partes.push(op.grupo ? `grupo «${op.grupo}»` : 'sin grupo')
        }
        if (op.x !== undefined) estado.x = Math.round(op.x)
        if (op.y !== undefined) estado.y = Math.round(op.y)
        if (op.x !== undefined || op.y !== undefined) partes.push(`posición ${estado.x},${estado.y}`)
        lineas.push(`${n}marco: ${partes.join(', ') || 'sin cambios'}`)
        break
      }
      case 'restaurar':
        throw new ErrorDominio('restaurar va sola (o primera) en la lista de operaciones.', 400)
    }
  })

  // Una pasada final de saneado: ids nuevos para lo que no los tenga y la misma forma de siempre.
  const final = sanearHtml(serializarHtml(raiz), {})
  creadas.push(...final.idsNuevos)
  estado.html = final.html
  void clases
  void claseDeCapa
  return { estado, lineas, creadas: [...new Set(creadas)], avisos: [...new Set(avisos)], contenido }
}
