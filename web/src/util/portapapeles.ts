// Copiar al portapapeles y descargar un texto, para lo que sale UNA sola vez (el enlace de una invitación, el de un restablecimiento y los
// códigos de recuperación). Pieza chica y sin dependencias: la usan la pantalla de entrar y Configuración, que no se cargan juntas.

/** Copia al portapapeles; si el navegador no deja (sin permiso o sin https), con el truco del campo seleccionado. */
export async function copiarTexto(texto: string, campo?: HTMLInputElement | HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    try {
      campo?.focus()
      campo?.select()
      return document.execCommand('copy')
    } catch {
      return false
    }
  }
}

/** Baja un texto como archivo .txt (en el celular lo guarda en Descargas o lo abre para guardarlo, según el sistema). */
export function descargarTexto(nombre: string, texto: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
