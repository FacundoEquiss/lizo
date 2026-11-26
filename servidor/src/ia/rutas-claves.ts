// Rutas de Configuración → IA (plan 13.7, tarea 2.2), montadas en /api por `rutasIA`: el estado de la IA de la cuenta, sus claves, sus
// agentes, los ajustes y el gasto. Cada una corre con el Servicio de la cuenta del pedido: solo ve y toca lo suyo, y un id ajeno da 404
// con el mismo mensaje que uno que no existe.
//
// Quien cambia claves, agentes o ajustes tiene que entrar con SESIÓN (o ser local): la clave del MCP no alcanza (403). Así una IA de
// afuera no puede subirse el tope ni cambiar una clave. Leer (`GET`) lo puede cualquiera de la cuenta: con la clave del MCP la
// pantalla se ve pero no se cambia (`puedeCambiar: false`).
//
// La clave de un proveedor NUNCA vuelve en una respuesta: solo «termina en …1234» (`ultimos4`).
import { Hono } from 'hono'
import { z } from 'zod'
import { ErrorDominio } from '../dominio/servicio'
import { iaDe } from './servicio-ia'
import type { DepsRutasIA } from './rutas'

const MENSAJE_SESION = 'Esto se cambia desde Configuración, con tu cuenta.'

const esquemaClave = z.object({
  proveedor: z.string().optional(),
  nombre: z.string(),
  clave: z.string().optional(),
  urlBase: z.string().nullable().optional(),
})
// Lo que viene de la pantalla es el agente entero (con `estado` y `gastoMesUsd` de lo que leyó): lo que no se puede cambiar se ignora.
const esquemaAgente = z.object({
  nombre: z.string().optional(),
  alias: z.string().nullable().optional(),
  color: z.string().optional(),
  modo: z.string().optional(),
  proveedor: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  claveId: z.string().nullable().optional(),
  esfuerzo: z.string().nullable().optional(),
  instrucciones: z.string().optional(),
  permisos: z.array(z.string()).optional(),
  confirmar: z.string().optional(),
  puedeMencionarIA: z.boolean().optional(),
  topeMesUsd: z.union([z.number(), z.string()]).optional(),
  precioManual: z.object({ entrada: z.number(), salida: z.number(), cacheLectura: z.number().optional() }).nullable().optional(),
  veImagenes: z.boolean().nullable().optional(),
  autonomia: z.string().optional(),
  disparadores: z.unknown().optional(),
  activo: z.boolean().optional(),
})
const esquemaAjustes = z.object({
  topeMesUsd: z.union([z.number(), z.string()]).optional(),
  pausada: z.boolean().optional(),
  confirmarMcp: z.boolean().optional(),
  externasDisparan: z.boolean().optional(),
  reposCodigo: z.array(z.string()).optional(),
})

export function rutasClavesIA(d: DepsRutasIA) {
  const r = new Hono()
  const ia = () => iaDe(d.servicio())
  const sesion = () => {
    const via = d.via()
    if (via !== 'sesion' && via !== 'local') throw new ErrorDominio(MENSAJE_SESION, 403)
  }
  const cuerpo = async (c: { req: { json(): Promise<unknown> } }) => {
    const b = await c.req.json().catch(() => null)
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ErrorDominio('Mandá los datos como un objeto JSON.')
    return b
  }

  // Todo lo de la pantalla en una sola lectura: agentes (con su gasto y su estado), claves sin el secreto, ajustes y modelos conocidos.
  r.get('/ia/estado', async (c) => {
    const via = d.via()
    return c.json({ ...(await ia().estado()), puedeCambiar: via === 'sesion' || via === 'local' })
  })
  // El gasto de un mes (UTC, «2026-11»; de fábrica el actual): por agente y el detalle por trabajo.
  r.get('/ia/uso', async (c) => c.json(await ia().uso({ mes: c.req.query('mes') || undefined })))

  // Claves: se prueban antes de guardarse; una inválida no se guarda. Con `clave` se cambia el secreto; sin ella solo el nombre o la dirección.
  r.post('/ia/claves', async (c) => {
    sesion()
    const e = esquemaClave.parse(await cuerpo(c))
    return c.json(await ia().guardarClave({ ...e, id: undefined } as any), 201)
  })
  r.put('/ia/claves/:id', async (c) => {
    sesion()
    const e = esquemaClave.parse(await cuerpo(c))
    return c.json(await ia().guardarClave({ ...e, id: c.req.param('id') } as any))
  })
  r.post('/ia/claves/:id/probar', async (c) => {
    sesion()
    return c.json(await ia().probarClave(c.req.param('id')))
  })
  r.delete('/ia/claves/:id', async (c) => {
    sesion()
    await ia().quitarClave(c.req.param('id'))
    return c.json({ ok: true })
  })

  // Agentes: un miembro de la cuenta con su configuración. Al crear uno con el nombre de una IA que ya es miembro («Claude»), es ese miembro.
  r.post('/ia/agentes', async (c) => {
    sesion()
    const e = esquemaAgente.parse(await cuerpo(c))
    return c.json(await ia().guardarAgente({ ...e, miembroId: undefined, nombre: e.nombre ?? '' } as any, await d.ctx(c)), 201)
  })
  r.put('/ia/agentes/:id', async (c) => {
    sesion()
    const e = esquemaAgente.parse(await cuerpo(c))
    // el nombre es opcional al editar: lo que no viene queda como estaba
    return c.json(await ia().guardarAgente({ ...e, miembroId: c.req.param('id') } as any, await d.ctx(c)))
  })
  r.delete('/ia/agentes/:id', async (c) => {
    sesion()
    await ia().archivarAgente(c.req.param('id'), await d.ctx(c))
    return c.json({ ok: true })
  })

  // Ajustes de la cuenta: tope mensual, «pausar toda la IA», las dos opciones de las IA de afuera y los repos de código.
  r.put('/ia/ajustes', async (c) => {
    sesion()
    return c.json(await ia().guardarAjustes(esquemaAjustes.parse(await cuerpo(c)) as any))
  })

  return r
}
