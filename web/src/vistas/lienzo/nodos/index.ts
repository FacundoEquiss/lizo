// Un componente por tipo de objeto del lienzo.
import { Enlace } from './Enlace'
import { Figma } from './Figma'
import { Forma } from './Forma'
import { GraficoNodo } from './Grafico'
import { Imagen } from './Imagen'
import { ListaNodo } from './ListaNodo'
import { Marco } from './Marco'
import { Nota } from './Nota'
import { TablaNodo } from './Tabla'
import { TarjetaNodo } from './TarjetaNodo'
import { Texto } from './Texto'

export const TIPOS_NODO = {
  nota: Nota,
  texto: Texto,
  forma: Forma,
  marco: Marco,
  tarjeta: TarjetaNodo,
  lista: ListaNodo,
  imagen: Imagen,
  enlace: Enlace,
  figma: Figma,
  tabla: TablaNodo,
  grafico: GraficoNodo,
}
