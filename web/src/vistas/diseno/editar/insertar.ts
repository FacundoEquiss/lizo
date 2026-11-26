// Insertar con un clic dentro de un marco propio (plan 6.7, punto 3): Texto, Imagen (subir) o Caja, como hijos directos en
// position: absolute en el punto del clic. Después se selecciona lo creado (y un texto queda editándose).
import { avisar, avisarError } from '../../../estado/avisos'
import { apiDiseno } from '../api'
import { useDiseno } from '../estado'
import { empezarEdicionTexto } from './texto'

function elegirArchivo(acepta: string): Promise<File | null> {
  return new Promise((ok) => {
    const i = document.createElement('input')
    i.type = 'file'
    i.accept = acepta
    i.onchange = () => ok(i.files?.[0] ?? null)
    i.click()
  })
}

/** Espera a que el iframe del marco se vuelva a dibujar (después de guardar un cambio que no estaba en el DOM). */
function esperarDibujo(marco: string): Promise<void> {
  return new Promise((ok) => {
    const f = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== marco) return
      window.removeEventListener('telar:diseno-iframe', f)
      ok()
    }
    window.addEventListener('telar:diseno-iframe', f)
    setTimeout(() => (window.removeEventListener('telar:diseno-iframe', f), ok()), 3000)
  })
}

export async function insertarEnMarco(marco: string, tipo: 'texto' | 'imagen' | 'caja', x: number, y: number, extra?: { html?: string }) {
  const s = useDiseno.getState()
  const p = s.prefijo
  if (!p) return
  const pos = `position:absolute;left:${Math.round(x)}px;top:${Math.round(y)}px`
  let html = extra?.html ?? ''
  if (!html) {
    if (tipo === 'texto') html = `<p data-nombre="Texto" style="${pos};margin:0;font-size:32px;line-height:1.2;white-space:nowrap">Texto</p>`
    else if (tipo === 'caja') html = `<div data-nombre="Caja" style="${pos};width:200px;height:120px;background:#d9d9d9;border-radius:8px"></div>`
    else {
      const archivo = await elegirArchivo('image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif')
      if (!archivo) return
      try {
        const a = await apiDiseno.subirActivo(p, archivo, { nombre: archivo.name.replace(/\.\w+$/, '') })
        const ancho = Math.min(a.ancho ?? 300, 480)
        html = `<img data-nombre="${archivo.name.replace(/\.\w+$/, '').replace(/"/g, '')}" src="${a.ruta}" alt="" style="${pos};width:${ancho}px;height:auto">`
        void s.cargarItems('activo', true)
      } catch (e) {
        avisarError(e)
        return
      }
    }
  }
  const esperar = esperarDibujo(marco)
  const r = await s.editar(marco, [{ op: 'insertar', html }], { etiqueta: `insertar ${tipo === 'texto' ? 'un texto' : tipo === 'caja' ? 'una caja' : 'una imagen'}`, enDom: false })
  if (!r) return
  const nueva = r.creadas[0]
  await esperar
  if (nueva) {
    useDiseno.getState().seleccionar({ marco, capa: nueva })
    if (tipo === 'texto') empezarEdicionTexto(marco, nueva)
  } else avisar({ texto: 'Insertado.' })
}
