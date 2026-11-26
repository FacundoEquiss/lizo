export const esMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** Muestra un atajo con los símbolos del sistema: "$mod+K" → "⌘K" o "Ctrl K". */
export function teclaLegible(atajo: string): string[] {
  return atajo.split('+').map((p) => {
    switch (p) {
      case '$mod':
        return esMac ? '⌘' : 'Ctrl'
      case 'Shift':
        return esMac ? '⇧' : 'Shift'
      case 'Alt':
        return esMac ? '⌥' : 'Alt'
      case 'Enter':
        return '↵'
      case 'Escape':
        return 'Esc'
      case 'ArrowUp':
        return '↑'
      case 'ArrowDown':
        return '↓'
      case 'ArrowLeft':
        return '←'
      case 'ArrowRight':
        return '→'
      case 'Backspace':
        return '⌫'
      // Como dicen las teclas de un teclado en castellano.
      case 'Delete':
        return esMac ? '⌦' : 'Supr'
      case 'PageUp':
        return esMac ? '⇞' : 'RePág'
      case 'PageDown':
        return esMac ? '⇟' : 'AvPág'
      case 'Space':
        return 'Espacio'
      default:
        return p.length === 1 ? p.toUpperCase() : p
    }
  })
}

/** ¿El foco está en un campo de texto? (ahí no corren los atajos de una tecla). */
export function escribiendo(e?: Event): boolean {
  const el = (e?.target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null)
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
