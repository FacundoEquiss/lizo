// Perfil de importación (plan 5.2): de dónde sale el sistema de diseño de un proyecto. Se guarda en diseno_config.perfil
// (editable por MCP con sincronizar_diseno) o en scripts/diseno/perfiles/<prefijo>.json. Validado con zod.
import { z } from 'zod'

const accion = z.union([
  z.object({ clic: z.string().min(1) }).strict(),
  z.object({ evaluar: z.string().min(1) }).strict(),
  z.object({ esperar: z.union([z.string().min(1), z.number().int().min(0).max(20000)]) }).strict(),
  z.object({ tecla: z.string().min(1) }).strict(),
])
export type AccionPerfil = z.infer<typeof accion>

const vista = z.object({
  ancho: z.number().int().min(160).max(4096),
  alto: z.number().int().min(160).max(4096),
  densidad: z.number().min(1).max(3).optional(),
  tactil: z.boolean().optional(),
})

export const esquemaPantalla = z.object({
  /** "Celular", "PC" o "*" (una por vista: Celular para "celular", PC para "pc"). */
  pagina: z.string().min(1),
  seccion: z.string().default(''),
  nombre: z.string().min(1),
  clave: z.string().regex(/^[\w.-]+$/, 'Solo letras, números, puntos y guiones.'),
  vistas: z.array(z.string()).min(1),
  url: z.string().min(1),
  acciones: z.array(accion).optional(),
  /** Selector del elemento que se fotografía (por defecto <body>). */
  raiz: z.string().optional(),
  /** Selector que tiene que existir antes de sacar la instantánea. */
  esperar: z.string().optional(),
  fondo: z.string().optional(),
  /** Código que corre antes que el de la página (Playwright addInitScript). */
  antes: z.string().optional(),
  nota: z.string().optional(),
})
export type PantallaPerfil = z.infer<typeof esquemaPantalla>

export const esquemaPerfil = z.object({
  nombre: z.string().min(1),
  fuente: z
    .union([z.object({ clase: z.literal('repo') }), z.object({ clase: z.literal('web'), base: z.string().url() })])
    .default({ clase: 'repo' }),
  hojas: z.array(z.string()).default([]),
  raizClase: z.string().optional(),
  fuentes: z
    .array(
      z.object({
        familia: z.string().min(1),
        archivo: z.string().min(1),
        pesos: z.string().default('400'),
        estilo: z.enum(['normal', 'italic']).optional(),
        licencia: z.string().optional(),
      }),
    )
    .default([]),
  activos: z
    .array(
      z.object({
        grupo: z.string().min(1),
        patron: z.string().min(1),
        /** "ruta/indice.json#clave": un JSON con fichas por nombre ({ archivo, w, h, origen, nota }). */
        indice: z.string().optional(),
        agruparPor: z.enum(['prefijo', 'carpeta']).optional(),
      }),
    )
    .default([]),
  /** Dónde buscar los usos de activos y textos. */
  usos: z.array(z.string()).default([]),
  textos: z
    .array(
      z.object({
        modulo: z.string().optional(),
        exporta: z.string().default('T'),
        patronUso: z.string().optional(),
        json: z.string().optional(),
      }),
    )
    .default([]),
  /** Unidades propias del proyecto ("--hu": "px del celular, HUD nuevo"). */
  unidades: z.record(z.string(), z.string()).default({}),
  vistas: z.record(z.string(), vista).default({}),
  pantallas: z.array(esquemaPantalla).default([]),
  /** Módulo que corre en la página de prueba y devuelve las piezas con sus variantes (5.2, "Recetas"). */
  recetas: z.string().optional(),
  /** Página donde corren las recetas (por defecto, la url de la primera pantalla). */
  paginaRecetas: z.string().optional(),
  /** Código que corre antes que el de cada página (todas). */
  antes: z.string().optional(),
  /** Pedidos de red que se contestan con un archivo local: { "https://cdn…/three.module.js": "ruta/en/el/repo.js" }. */
  reemplazos: z.record(z.string(), z.string()).default({}),
  /** Archivos del repo que nunca se suben (globs): material que no puede salir del proyecto. Las url() de las hojas que
   *  apuntan ahí se quitan, y no se toman como activos, fuentes ni imágenes de las pantallas. */
  excluir: z.array(z.string()).default([]),
})
export type Perfil = z.infer<typeof esquemaPerfil>

/** Página de destino de una pantalla para una vista ("*" → Celular o PC). */
export function paginaDeVista(p: PantallaPerfil, vista: string): string {
  if (p.pagina !== '*') return p.pagina
  return vista === 'pc' ? 'PC' : vista === 'celular' ? 'Celular' : vista[0]!.toUpperCase() + vista.slice(1)
}
