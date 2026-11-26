// IndexedDB mínimo, sin bibliotecas (plan del celular, 9.6). Una base "telar" con dos almacenes:
//   instantanea   lo último que se cargó (inicio, tableros, tarjetas), para leer sin conexión
//   pendientes    las tarjetas nuevas creadas sin conexión, que se suben solas al volver la señal
export type Almacen = 'instantanea' | 'pendientes'

let base: Promise<IDBDatabase> | null = null

function abrir(): Promise<IDBDatabase> {
  if (!base)
    base = new Promise((ok, mal) => {
      const pedido = indexedDB.open('telar', 1)
      pedido.onupgradeneeded = () => {
        const db = pedido.result
        if (!db.objectStoreNames.contains('instantanea')) db.createObjectStore('instantanea')
        if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes')
      }
      pedido.onsuccess = () => ok(pedido.result)
      pedido.onerror = () => mal(pedido.error)
    })
  return base
}

async function hacer<T>(almacen: Almacen, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await abrir()
  return new Promise((ok, mal) => {
    const tx = db.transaction(almacen, modo)
    const pedido = fn(tx.objectStore(almacen))
    tx.oncomplete = () => ok(pedido.result as T)
    tx.onerror = () => mal(tx.error)
    tx.onabort = () => mal(tx.error)
  })
}

export const leer = <T>(almacen: Almacen, clave: string) => hacer<T | undefined>(almacen, 'readonly', (s) => s.get(clave)).catch(() => undefined)
export const guardar = (almacen: Almacen, clave: string, valor: unknown) => hacer(almacen, 'readwrite', (s) => s.put(valor, clave)).catch(() => undefined)
export const borrar = (almacen: Almacen, clave: string) => hacer(almacen, 'readwrite', (s) => s.delete(clave)).catch(() => undefined)
export const vaciar = (almacen: Almacen) => hacer(almacen, 'readwrite', (s) => s.clear()).catch(() => undefined)
export const todos = <T>(almacen: Almacen) => hacer<T[]>(almacen, 'readonly', (s) => s.getAll()).catch(() => [] as T[])
