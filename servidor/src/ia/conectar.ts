// Engancha la IA al Servicio al arrancar (servidor.ts y vercel.ts). Sin esto el Servicio anda igual que antes: los ganchos
// (dominio/ganchos.ts) están vacíos y guardar un texto no mira menciones. `servicio.ts` nunca importa nada de acá.
import type { Servicio } from '../dominio/servicio'
import { conectarPantalla, depsDeProduccion } from './cableado'
import { detenerRedLocal, iniciarRedLocal } from './despacho'
import { configurarEjecutor, type DepsEjecutor } from './ejecutor'
import { iaDe } from './servicio-ia'

export interface OpcionesConectar {
  /** Las dependencias del ciclo (proveedores, bóveda, precios, código). De fábrica, las de producción (`cableado.ts`); con las de fábrica también se conecta la prueba de claves y el catálogo de modelos de la pantalla. */
  deps?: DepsEjecutor | null
  /** false: no arrancar el temporizador local (las pruebas que manejan el tiempo a mano). */
  red?: boolean
}

/**
 * Engancha la IA al Servicio raíz (los de cada cuenta comparten sus ganchos): las menciones, lo que se borra y las tarjetas que entran a una
 * lista (la IA proactiva). Conecta lo que el ciclo necesita y, en la computadora, prende la red de seguridad de los trabajos trabados.
 * Se llama una vez al arrancar.
 */
export function conectarIA(raiz: Servicio, op: OpcionesConectar = {}): void {
  raiz.ganchos.textoGuardado = (s, ctx, textos) => iaDe(s).procesarTextos(ctx, textos)
  raiz.ganchos.textoBorrado = (s, ctx, origenes) => iaDe(s).retirarOrigenes(ctx, origenes)
  raiz.ganchos.tarjetaEnLista = async (s, ctx, e) => {
    await iaDe(s).revisarTarjetaNueva(ctx, e.tarjetaId)
  }
  raiz.ganchos.avisoDeTelar = async (s, a) => {
    await iaDe(s).avisarAlYo(a)
  }
  const deps = op.deps === undefined ? depsDeProduccion() : op.deps
  configurarEjecutor(deps)
  if (op.deps === undefined) conectarPantalla()
  if (op.red === false) detenerRedLocal()
  else iniciarRedLocal(raiz)
}
