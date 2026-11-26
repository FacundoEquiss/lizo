// Editar un texto en el lugar (plan 6.7, punto 4): doble clic sobre un texto de un marco propio → contentEditable
// "plaintext-only" dentro del iframe (con los eventos habilitados solo en ese marco mientras dura). Esc o clic afuera
// confirma. Nunca se guarda HTML: viaja como la operación `texto`.
import { useDiseno } from '../estado'
import { elementoDeCapa } from '../lienzo/elegir'

export function empezarEdicionTexto(marco: string, capa: string) {
  const el = elementoDeCapa(marco, capa)
  if (!el) return
  const s = useDiseno.getState()
  const antes = el.textContent ?? ''
  s.set({ editandoTexto: { marco, capa } })
  el.setAttribute('contenteditable', 'plaintext-only')
  el.style.outline = 'none'
  el.style.caretColor = 'auto'
  // un cuadro de la animación para que el iframe ya reciba eventos
  requestAnimationFrame(() => {
    el.focus()
    const doc = el.ownerDocument
    const r = doc.createRange()
    r.selectNodeContents(el)
    const sel = doc.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
  })
  let listo = false
  const terminar = () => {
    if (listo) return
    listo = true
    el.removeEventListener('keydown', tecla)
    el.removeEventListener('blur', terminar)
    el.removeAttribute('contenteditable')
    el.style.removeProperty('outline')
    el.style.removeProperty('caret-color')
    const texto = (el.textContent ?? '').replace(/ /g, ' ')
    useDiseno.getState().set({ editandoTexto: null })
    if (texto !== antes) void useDiseno.getState().editar(marco, [{ op: 'texto', capa, texto }], { etiqueta: 'editar el texto' })
  }
  const tecla = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      e.stopPropagation()
      el.blur()
      terminar()
    }
  }
  el.addEventListener('keydown', tecla)
  el.addEventListener('blur', terminar)
}
