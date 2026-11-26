// Operaciones de edición de un marco (plan 7.3, editar_marco). Las mismas para la web (inspector, edición en el lugar,
// mover capas) y para el MCP: se aplican en orden y todas o ninguna (servidor/src/diseno/operaciones.ts).
import { z } from 'zod'

const capa = z.string().min(1).describe('Id de la capa (data-id), como lo da leer_diseno.')
const valorEstilo = z.union([z.string(), z.number(), z.null()])

export const esquemaOperacion = z.discriminatedUnion('op', [
  z.object({ op: z.literal('texto'), capa, texto: z.string().describe('Texto nuevo (texto plano).') }),
  z.object({
    op: z.literal('estilo'),
    capa,
    estilos: z
      .record(z.string(), valorEstilo)
      .describe('Estilos en línea: { "color": "var(--color-marca-tinta)", "font-size": "10cqw" }. null quita la propiedad.'),
  }),
  z.object({
    op: z.literal('atributo'),
    capa,
    nombre: z.string().min(1).describe('src, alt, class, data-nombre, data-props…'),
    valor: z.union([z.string(), z.null()]).describe('null quita el atributo.'),
  }),
  z.object({
    op: z.literal('propiedades'),
    capa,
    valores: z.record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.null()])).describe('Propiedades de una instancia de pieza.'),
  }),
  z.object({ op: z.literal('reemplazar'), capa, html: z.string().describe('HTML que reemplaza a la capa entera.') }),
  z.object({
    op: z.literal('insertar'),
    html: z.string().min(1),
    dentro: z.string().optional().describe('Id de la capa donde va (al final). Sin dentro/antes_de/despues_de: al final del marco.'),
    antes_de: z.string().optional(),
    despues_de: z.string().optional(),
  }),
  z.object({ op: z.literal('quitar'), capa }),
  z.object({
    op: z.literal('mover'),
    capa,
    antes_de: z.string().optional(),
    despues_de: z.string().optional(),
    dentro: z.string().optional().describe('Id del nuevo padre (va al final). "marco" = el marco mismo.'),
  }),
  z.object({
    op: z.literal('css'),
    css: z.string(),
    como: z.enum(['reemplazar', 'agregar']).default('agregar').describe('reemplazar todo el CSS del marco o agregar al final.'),
  }),
  z.object({
    op: z.literal('marco'),
    nombre: z.string().min(1).optional(),
    tamano: z.union([z.string(), z.object({ ancho: z.number().int(), alto: z.number().int() })]).optional(),
    fondo: z.string().optional(),
    modo: z.string().nullable().optional(),
    seccion: z.string().optional(),
    grupo: z.string().nullable().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({ op: z.literal('restaurar'), revision: z.number().int().min(1).describe('Número de revisión a la que se vuelve.') }),
])

export type OperacionMarco = z.infer<typeof esquemaOperacion>
export type TipoOperacion = OperacionMarco['op']
