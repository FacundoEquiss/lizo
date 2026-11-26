// Fotos chicas hechas en el navegador (la del proyecto): recorte al cuadrado central y achique a 256 × 256 con un
// <canvas>, exportada como WebP (o JPEG si el navegador no exporta WebP). Queda en menos de 60 KB: online los archivos
// van a la base y Vercel no acepta pedidos grandes; un avatar no necesita más.

/** Los formatos que se aceptan (no SVG: puede traer código y se sirve desde el mismo dominio). */
export const TIPOS_IMAGEN = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export class ErrorImagen extends Error {}

function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((r) => canvas.toBlob(r, tipo, calidad))
}

/** Recorta el cuadrado central de la imagen y lo achica a `lado` px. De un GIF, el primer cuadro. */
export async function recortarCuadrada(archivo: Blob, lado = 256): Promise<Blob> {
  if (!TIPOS_IMAGEN.includes(archivo.type)) throw new ErrorImagen('La foto tiene que ser PNG, JPG, WebP o GIF.')
  let imagen: ImageBitmap
  try {
    imagen = await createImageBitmap(archivo)
  } catch {
    throw new ErrorImagen('No se pudo leer esa imagen.')
  }
  const corte = Math.min(imagen.width, imagen.height)
  const sx = (imagen.width - corte) / 2
  const sy = (imagen.height - corte) / 2
  const tam = Math.min(lado, corte)
  const canvas = document.createElement('canvas')
  canvas.width = tam
  canvas.height = tam
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ErrorImagen('No se pudo preparar la imagen.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(imagen, sx, sy, corte, corte, 0, 0, tam, tam)
  imagen.close()
  const webp = await aBlob(canvas, 'image/webp', 0.9)
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await aBlob(canvas, 'image/jpeg', 0.9)
  if (!jpeg) throw new ErrorImagen('No se pudo guardar la imagen.')
  return jpeg
}

/** La primera imagen de un pegado o de un arrastre (o null). */
export function imagenDe(datos: DataTransfer | null): File | null {
  return [...(datos?.files ?? [])].find((f) => f.type.startsWith('image/')) ?? null
}
