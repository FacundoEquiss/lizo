// Recetas de las piezas de Restaurant City (plan 5.2). Corre en el navegador, en la página de prueba del juego
// (juego3d/prueba-ui.html), y usa el código REAL de la interfaz (juego3d/ui/piezas.js…) para armar cada pieza con sus
// variantes: así la hoja de variantes es lo que el juego dibuja, no una copia escrita a mano.
// `api.importar(ruta)` importa un módulo del juego (relativo a la página). Cada receta: { clave, nombre, grupo, escala,
// variantes: { nombre: Element }, estados: ['normal', 'hover', 'active', 'apagado'] }.
export default async function recetas(api) {
  const p = await api.importar('./ui/piezas.js')
  const s = await api.importar('./ui/sprites.js')
  const { T } = await api.importar('./ui/textos.js')
  const c = await api.importar('./ui/carrito.js')
  const escala = { '--n': '1.6px', '--nv': '1.6px', '--tu': '1.6px', '--hu': '1.6px', '--u': '1.6px' }
  const de = (lista, fn) => Object.fromEntries(lista.map((x) => [x, fn(x)]))

  // botones amarillo y azul del HUD (llevan su sprite de fondo en una variable)
  const hudBoton = (tipo, texto, sprite) => {
    const b = p.h('button', `toc hud-boton ${tipo}`, p.h('span', '', texto))
    b.style.setProperty(tipo === 'amarillo' ? '--img-amarillo' : '--img-azul', `url(${s.src(sprite)})`)
    b.style.position = 'relative'
    b.style.top = '0'
    return b
  }
  const tip = (texto, abajo = false) => {
    const t = p.h('div', 'rc-tip' + (abajo ? ' abajo' : ''), p.h('span', 'txt', texto), s.img('tooltip-punta', 'punta'))
    return t
  }
  const aviso = (texto) => {
    const a = p.h('div', 'rc-aviso on', texto)
    a.style.transform = 'none'
    return a
  }

  return [
    {
      clave: 'boton-sprite',
      nombre: 'Botón de sprite',
      grupo: 'Botones',
      escala,
      variantes: de(['ok', 'cancelar', 'ok-azul', 'ok-gris'], (t) => p.boton(t)),
      estados: ['normal', 'hover', 'active'],
    },
    {
      clave: 'boton-texto',
      nombre: 'Botón con texto',
      grupo: 'Botones',
      escala,
      variantes: de(['verde', 'azul', 'gris', 'subir', 'subir-off', 'aprender', 'aprender-off', 'comprar', 'tab', 'tab-on'], (t) => p.botonTexto('Aceptar', t)),
      estados: ['normal', 'hover', 'active', 'apagado'],
    },
    {
      clave: 'flecha',
      nombre: 'Flecha',
      grupo: 'Botones',
      escala,
      variantes: {
        ...de(['izq', 'der', 'arriba', 'abajo', 'doble-izq', 'doble-der'], (d) => p.flecha(d)),
        ...Object.fromEntries(['izq', 'der'].map((d) => [`${d} gris`, p.flecha(d, null, true)])),
      },
      estados: ['normal', 'hover', 'active'],
    },
    {
      clave: 'boton-hud',
      nombre: 'Botón del HUD (¡Más pesos!)',
      grupo: 'Botones',
      escala,
      variantes: { amarillo: hudBoton('amarillo', T.masPesos, 'hud-boton-amarillo'), azul: hudBoton('azul', T.masAustrales, 'hud-boton-azul') },
      estados: ['normal', 'hover', 'active'],
    },
    {
      clave: 'boton-plano',
      nombre: 'Botón plano (tienda y Barrio)',
      grupo: 'Botones',
      escala,
      variantes: {
        azul: c.botonPlano('Girar', c.SVG.girar, '', 'Girar'),
        verde: c.botonPlano('Listo', c.SVG.listo, 'verde', 'Listo'),
        rojo: c.botonPlano('Sacar', c.SVG.tacho, 'rojo', 'Sacar'),
        carrito: c.botonPlano('Carrito', c.SVG.carro, 'amarillo', 'Carrito'),
      },
      estados: ['normal', 'active', 'apagado'],
    },
    {
      clave: 'texto-contorno',
      nombre: 'Texto con contorno',
      grupo: 'Texto',
      escala,
      variantes: {
        'blanco / tinta': p.rt('71.096', '', { tam: 21, color: '#fff', borde: '#1d1d1d' }),
        'austral': p.rt('19', '', { tam: 21, color: '#8fe3fb', borde: '#0d5874' }),
        'nivel': p.rt('20', '', { tam: 28, color: '#d4e0d8', borde: '#3d4a45', grosor: 3.6 }),
        'verde': p.rt('¡Listo!', '', { tam: 21, color: '#fff', borde: '#4a9410', grosor: 1.5 }),
        'azul': p.rt('Comprar', '', { tam: 21, color: '#fff', borde: '#0b7894', grosor: 1.5 }),
        'cartel': p.rt(T.cerrado, '', { tam: 15, color: '#fff', borde: '#4c4845', grosor: 3.2 }),
      },
      estados: ['normal'],
    },
    {
      clave: 'campo',
      nombre: 'Campo de texto de RC',
      grupo: 'Texto',
      escala,
      variantes: {
        liso: p.campo('Un campo de texto de RC', 0, 0, 220, 26, { tam: 14, color: '#1d1d1d' }),
        'con borde': p.campo('Con contorno', 0, 0, 220, 30, { tam: 18, color: '#fff', borde: '#536868', grosor: 2 }),
        'a la izquierda': p.campo('Alineado a la izquierda', 0, 0, 220, 26, { tam: 14, color: '#536868', alin: 'left' }),
      },
      estados: ['normal'],
    },
    {
      clave: 'globo',
      nombre: 'Globo y aviso',
      grupo: 'Avisos',
      escala,
      variantes: {
        'globo (tooltip)': tip(T.calle),
        'globo de abajo': tip(T.decorar, true),
        aviso: aviso('¡Tu restaurante está listo! Tocá el cartel para abrir.'),
      },
      estados: ['normal'],
    },
    {
      clave: 'cartel-cerrado',
      nombre: 'Cartel de cerrado',
      grupo: 'Avisos',
      escala,
      variantes: { cerrado: p.h('button', 'toc cartel-cerrado', p.rt(T.cerrado)) },
      estados: ['normal', 'hover', 'active'],
    },
  ]
}
