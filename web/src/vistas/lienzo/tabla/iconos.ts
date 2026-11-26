// Un ícono por tipo de columna (cabecera, menú de columna y selector de tipo).
import { Calendar, CheckSquare, Clock, DollarSign, Folder, GitBranch, Hash, Link2, Mail, MapPin, Palette, Percent, Phone, SquareKanban, Tag, Type } from 'lucide-react'
import type { TipoColumna } from '../../../../../compartido/tabla'

export const ICONO_TIPO: Record<TipoColumna, typeof Type> = {
  texto: Type,
  numero: Hash,
  moneda: DollarSign,
  porcentaje: Percent,
  fecha: Calendar,
  duracion: Clock,
  casilla: CheckSquare,
  etiqueta: Tag,
  link: Link2,
  email: Mail,
  telefono: Phone,
  ubicacion: MapPin,
  rama: GitBranch,
  directorio: Folder,
  tarjeta: SquareKanban,
  color: Palette,
}
