// El ÚNICO lugar donde el ciclo (ejecutor) se junta con lo de A (bóveda, claves, agentes, código de GitHub) y lo de B (proveedores y
// precios). `conectarIA` llama a `depsDeProduccion()` al arrancar y a `conectarPantalla()`; nada más del ciclo conoce un adaptador en
// particular.
//
// · `proveedorDe`: el registro de proveedores (proveedores/indice.ts). Anthropic, OpenAI y «compatible» siempre; el falso SOLO con
//   TABLERO_IA_FALSO=1 y nunca en Vercel (lo decide el registro, no este archivo: acá no hay ninguna rama de prueba).
// · `costoUsd`: la única cuenta (proveedores/precios.ts). Con el precio del modelo o, para lo que Telar no conoce, el que escribió el dueño;
//   sin ninguno tira `ErrorSinPrecio` y el ciclo no le pide nada al modelo (un tope que no puede medir no frena).
// · `bovedaAbrir`: abre la clave en claro, solo dentro del servidor (boveda.ts).
// · `prepararCodigo` / `ejecutarCodigo` / `pistasDeRutas`: leer el código de los repos (codigo.ts). Los límites de 12 llamadas y 150 KB por
//   trabajo los aplica `codigo.ts` (cuenta lo gastado en el libro de llamadas); el ejecutor no los repite.
// · Para la pantalla de Configuración → IA: probar una clave con su proveedor y el catálogo de modelos con su precio.
import { ponerCatalogoDeModelos, ponerProbadorDeClaves } from './agentes'
import { abrir } from './boveda'
import { ejecutarCodigo, pistasDeRutas, prepararCodigo } from './codigo'
import type { DepsEjecutor } from './ejecutor'
import { proveedorDe } from './proveedores/indice'
import { catalogoDeModelos, costoDelAgente } from './proveedores/precios'
import { iaDe } from './servicio-ia'

/** Las dependencias reales del ciclo. */
export function depsDeProduccion(): DepsEjecutor {
  return {
    proveedorDe: (id) => proveedorDe(id),
    bovedaAbrir: abrir,
    costoUsd: ({ proveedor, modelo, uso, precioManual, urlBase, ahora }) => costoDelAgente({ proveedor, modelo, uso, precioManual, urlBase, ahora }),
    prepararCodigo: (s, trabajo) => prepararCodigo(iaDe(s), trabajo),
    ejecutarCodigo,
    pistasDeRutas,
  }
}

/**
 * Lo que necesita la pantalla de Configuración → IA: probar una clave con su proveedor (así `estado` deja de ser «sin_probar») y el catálogo de
 * modelos con lo que cuesta una respuesta. El token de GitHub se prueba en agentes.ts con una llamada de solo lectura de codigo.ts.
 */
export function conectarPantalla(): void {
  ponerProbadorDeClaves(async ({ proveedor, clave, urlBase }) => {
    const r = await proveedorDe(proveedor).probar({ clave, urlBase })
    return { ok: r.ok, error: r.error, modelos: r.modelos }
  })
  ponerCatalogoDeModelos(() => catalogoDeModelos())
}
