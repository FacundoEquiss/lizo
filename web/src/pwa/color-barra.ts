// El color de la barra del sistema (plan del celular, 9.8). index.html trae dos <meta name="theme-color"> con media para
// el primer cuadro; desde que arranca la app queda UNO solo, con el valor del token leído en vivo: así el tema que elige
// la app (que no depende del sistema) cambia también la barra, y cuando el plan de escritorio cambie el oscuro a carbón,
// la barra lo toma sola. Mientras la tarjeta está abierta la barra toma --c-superficie: en Android queda del color exacto
// de lo que tiene debajo y la app parece llegar hasta el borde.
const pila: { id: number; token: string }[] = []
let siguiente = 0
let iniciado = false

function meta(): HTMLMetaElement {
  const todas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
  const propia = todas.find((m) => !m.media) ?? document.createElement('meta')
  for (const m of todas) if (m !== propia) m.remove()
  if (!propia.isConnected) {
    propia.name = 'theme-color'
    document.head.appendChild(propia)
  }
  return propia
}

function aplicar() {
  const token = pila.at(-1)?.token ?? '--c-fondo'
  const valor = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  if (!valor) return
  const m = meta()
  if (m.content !== valor) m.content = valor
}

export function iniciarColorBarra() {
  if (iniciado) return
  iniciado = true
  new MutationObserver(aplicar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  aplicar()
  // En desarrollo los estilos llegan después del primer cuadro.
  addEventListener('load', aplicar)
  setTimeout(aplicar, 300)
}

/** Pone la barra del color de un token mientras haga falta. Devuelve cómo sacarlo. */
export function ponerColorBarra(token: string): () => void {
  const id = ++siguiente
  pila.push({ id, token })
  aplicar()
  return () => {
    const i = pila.findIndex((x) => x.id === id)
    if (i !== -1) pila.splice(i, 1)
    aplicar()
  }
}
