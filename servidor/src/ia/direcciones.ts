// El filtro de direcciones web de un agente de adentro (plan 12.6, capa 3). Es por donde un dato podría salir de la cuenta: un
// modelo que armara `https://afuera.com/?x=<lo que leyó>` y lo cargara como imagen le entregaría datos a un tercero.
//
// Telar lleva, por trabajo, el conjunto de direcciones VISTAS: las del pedido y las instrucciones del dueño (confiables) y las de lo
// leído por herramientas (datos). Antes de ejecutar una herramienta se buscan direcciones http(s) en todos sus argumentos de texto,
// y lo mismo con la respuesta final:
//
//   la dirección…                         en un link o un «enlace»      donde se carga sola (imagen, subir_activo)
//   es de Telar                           pasa                          pasa
//   está exacta en el pedido/instruc.     pasa                          pasa
//   está exacta solo en datos leídos      pasa                          pide permiso (en cualquier modo)
//   no está en ningún lado                se rechaza                    se rechaza
//
// Puro (sin base de datos ni red): lo prueba direcciones.prueba.ts.

export interface DireccionEnArgs {
  url: string
  /** true: el servidor o el navegador la va a cargar solos (imagen del lienzo, imagen en Markdown, subir_activo desde una dirección). */
  carga: boolean
}

export interface Conocidas {
  /** Las del pedido y las instrucciones del dueño: las únicas que son órdenes. */
  confiables: ReadonlySet<string>
  /** Las de lo leído por herramientas: datos. */
  vistas: ReadonlySet<string>
  /** ¿Es una dirección de Telar (su propio origen)? */
  esPropia: (url: string) => boolean
}

export type Veredicto = { tipo: 'ok' } | { tipo: 'rechazar'; url: string } | { tipo: 'permiso'; url: string }

const RE_URL = /https?:\/\/[^\s<>"'`)\]}]+/gi
const RE_IMAGEN_MD = /!\[[^\]]*\]\((\s*https?:\/\/[^)\s]+)/gi

/** Sin la puntuación que se pega al final de una dirección en una frase. */
const limpiar = (u: string) => u.replace(/[.,;:!?'"]+$/, '')

/** Las direcciones http(s) de un texto, sin la puntuación del final. */
export function extraerDirecciones(texto: string): string[] {
  return [...texto.matchAll(RE_URL)].map((m) => limpiar(m[0]))
}

/** El conjunto de direcciones de varios textos. */
export function conjuntoDe(...textos: (string | null | undefined)[]): Set<string> {
  const c = new Set<string>()
  for (const t of textos) if (t) for (const u of extraerDirecciones(t)) c.add(u)
  return c
}

/**
 * Las direcciones de los argumentos de una herramienta y si se cargan solas: una imagen del lienzo (`tipo: 'imagen'` con `url`),
 * `subir_activo` con `url` y una imagen de Markdown (`![](…)`) en cualquier texto. Un link (`[x](…)`, un objeto «enlace», `vincular`)
 * no se carga solo.
 */
export function direccionesDeArgs(herramienta: string, argumentos: unknown): DireccionEnArgs[] {
  const salida: DireccionEnArgs[] = []
  const ver = (valor: unknown, padre: Record<string, unknown> | null, clave: string | null) => {
    if (typeof valor === 'string') {
      const imagenes = new Set([...valor.matchAll(RE_IMAGEN_MD)].map((m) => limpiar(m[1]!.trim())))
      for (const u of extraerDirecciones(valor)) {
        const cargaPorCampo = clave === 'url' && (herramienta === 'subir_activo' || padre?.tipo === 'imagen')
        salida.push({ url: u, carga: cargaPorCampo || imagenes.has(u) })
      }
    } else if (Array.isArray(valor)) {
      for (const x of valor) ver(x, padre, clave)
    } else if (valor && typeof valor === 'object') {
      const o = valor as Record<string, unknown>
      for (const [k, v] of Object.entries(o)) ver(v, o, k)
    }
  }
  ver(argumentos, null, null)
  return salida
}

/** Lo que pasa con las direcciones de una llamada: rechazar la primera inventada, pedir permiso por una que solo está en datos y se carga sola. */
export function juzgar(direcciones: DireccionEnArgs[], c: Conocidas): Veredicto {
  let permiso: string | null = null
  for (const d of direcciones) {
    if (c.esPropia(d.url) || c.confiables.has(d.url)) continue
    if (!c.vistas.has(d.url)) return { tipo: 'rechazar', url: d.url }
    if (d.carga && !permiso) permiso = d.url
  }
  return permiso ? { tipo: 'permiso', url: permiso } : { tipo: 'ok' }
}

/** El host de una dirección, para mostrarla («Traer una imagen de ejemplo.com»). */
export function hostDe(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 40)
  }
}

/**
 * La respuesta final: lo que no salió del tablero ni del pedido se quita (la respuesta se publica igual, sin la dirección armada), y una
 * imagen de Markdown cuya dirección solo está en datos pasa a link (así no se carga sola). Devuelve el texto y cuántas se quitaron.
 */
export function filtrarRespuesta(texto: string, c: Conocidas): { texto: string; quitadas: string[] } {
  const quitadas: string[] = []
  const permitida = (u: string) => c.esPropia(u) || c.confiables.has(u) || c.vistas.has(u)
  // 1) las imágenes: una que solo está en datos deja de cargarse sola (queda como link); una inventada se va
  let salida = texto.replace(/!\[([^\]]*)\]\((\s*https?:\/\/[^)\s]+)([^)]*)\)/gi, (_t, alt: string, u: string, resto: string) => {
    const url = limpiar(u.trim())
    if (c.esPropia(url) || c.confiables.has(url)) return `![${alt}](${url}${resto})`
    if (c.vistas.has(url)) return `[${alt || 'imagen'}](${url}${resto})`
    quitadas.push(url)
    return alt ? `(${alt})` : ''
  })
  // 2) cualquier otra dirección que no esté en ningún lado
  salida = salida.replace(RE_URL, (m) => {
    const url = limpiar(m)
    if (permitida(url)) return m
    quitadas.push(url)
    return '[dirección quitada]' + m.slice(url.length)
  })
  return { texto: salida, quitadas: [...new Set(quitadas)] }
}
