// El paquete de una importación (paso 7): ítems, páginas, marcos y archivos con nombre por hash. Lo arman los pasos 2 a 6 y
// lo sube subir.ts. Se guarda además en .datos/diseno-paquete/<proyecto>/ (ignorado por git) para poder mirarlo.
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { OrigenImportacion, TipoItem } from '../../compartido/diseno/tipos'

export interface ItemPaquete {
  tipo: TipoItem
  clave: string
  nombre: string
  grupo: string
  orden?: string
  datos: Record<string, unknown>
}
export interface PaginaPaquete {
  nombre: string
  slug: string
  tipo: 'lienzo' | 'sistema' | 'tabla'
  datos: Record<string, unknown>
  orden?: string
}
export interface MarcoPaquete {
  clave: string
  pagina: string
  nombre: string
  seccion: string
  ancho: number
  alto: number
  html: string
  css: string
  hojas: string[]
  datos: Record<string, unknown>
  miniatura?: string | null
}

export const sha12 = (d: Uint8Array | string) => createHash('sha1').update(d).digest('hex').slice(0, 12)

export class Paquete {
  readonly archivos = new Map<string, { bytes: Uint8Array; ext: string }>()
  readonly items: ItemPaquete[] = []
  readonly paginas: PaginaPaquete[] = []
  readonly marcos: MarcoPaquete[] = []
  readonly informe: string[] = []
  constructor(
    readonly proyectoId: string,
    readonly origen: OrigenImportacion,
  ) {}

  /** Guarda un archivo y devuelve su ruta pública (/archivos/diseno/<proyecto>/<sha12>.<ext>). */
  archivo(bytes: Uint8Array, ext: string): string {
    const e = ext.toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg')
    const nombre = `${sha12(bytes)}.${e}`
    if (!this.archivos.has(nombre)) this.archivos.set(nombre, { bytes, ext: e })
    return `/archivos/diseno/${this.proyectoId}/${nombre}`
  }

  item(it: ItemPaquete) {
    this.items.push(it)
  }

  nota(texto: string) {
    this.informe.push(texto)
  }

  /** Lo deja en disco para poder mirarlo (no se sube al repo: .datos está en .gitignore). */
  escribir(carpeta: string) {
    rmSync(carpeta, { recursive: true, force: true })
    mkdirSync(path.join(carpeta, 'archivos'), { recursive: true })
    for (const [nombre, a] of this.archivos) writeFileSync(path.join(carpeta, 'archivos', nombre), a.bytes)
    writeFileSync(
      path.join(carpeta, 'paquete.json'),
      JSON.stringify({ origen: this.origen, paginas: this.paginas, items: this.items, marcos: this.marcos, informe: this.informe, archivos: [...this.archivos.keys()] }, null, 1),
    )
  }
}
