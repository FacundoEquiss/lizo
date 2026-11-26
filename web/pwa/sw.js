// Service worker de Telar (plan del celular, 9.5). Es una plantilla: al compilar, web/pwa/plugin-sw.ts le pone la versión
// y la lista de archivos y la deja en dist/web/sw.js. Corto a propósito: un service worker con errores deja a todos en
// una versión vieja que no se arregla publicando, así que tiene que poder leerse entero.
//
// Lo que NUNCA toca: /api, /mcp y /archivos. Llevan sesión (una respuesta guardada se le podría servir a otra sesión o
// quedar vieja sin que nadie lo note), son el canal de la IA y los archivos son privados. Leer sin conexión lo resuelve
// la app (IndexedDB), que sabe de sesiones; el service worker no.
const VERSION = '__VERSION__'
const ARCHIVOS = __ARCHIVOS__
const CACHE = `telar-base-${VERSION}`
const PRIVADO = /^\/(api|mcp|archivos|oauth|\.well-known)(\/|$)/
const CAMBIANTE = /^\/(pwa|marca)\/|^\/manifest\.webmanifest$|^\/icono\.svg$/

// Al instalar se guarda el esqueleto de la app. Si falla un archivo, falla la instalación y sigue la versión anterior.
// No llama a skipWaiting: la versión nueva espera a que la app diga "ACTIVAR" (o a que se cierren todas las pestañas).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' })))))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('telar-base-') && k !== CACHE) await caches.delete(k)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (e) => {
  const tipo = e.data && e.data.tipo
  if (tipo === 'ACTIVAR') self.skipWaiting()
  else if (tipo === 'VERSION' && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION })
})

self.addEventListener('fetch', (e) => {
  const pedido = e.request
  if (pedido.method !== 'GET') return
  const url = new URL(pedido.url)
  if (url.origin !== self.location.origin || PRIVADO.test(url.pathname)) return
  // Es una app de una sola página: /RC/pendientes y /RC/pendientes/lienzo son el mismo index.html.
  if (pedido.mode === 'navigate') return e.respondWith(navegar(pedido))
  // Llevan el contenido en el nombre: nunca cambian.
  if (url.pathname.startsWith('/assets/')) return e.respondWith(primeroGuardado(pedido))
  // Íconos, marca y manifest: lo guardado al toque y, por detrás, se actualiza desde la red.
  if (CAMBIANTE.test(url.pathname)) return e.respondWith(guardadoYActualizar(e, pedido))
})

/** Guarda una respuesta solo si es buena: 200 y no HTML (Vercel devuelve index.html para lo que no existe). */
function guardable(r) {
  return r && r.status === 200 && !(r.headers.get('content-type') || '').includes('text/html')
}

async function navegar(pedido) {
  const guardado = await caches.match('/index.html', { cacheName: CACHE })
  if (guardado) return guardado
  return fetch(pedido)
}

async function primeroGuardado(pedido) {
  const cache = await caches.open(CACHE)
  const guardado = await cache.match(pedido)
  if (guardado) return guardado
  const r = await fetch(pedido)
  if (guardable(r)) cache.put(pedido, r.clone())
  return r
}

async function guardadoYActualizar(e, pedido) {
  const cache = await caches.open(CACHE)
  const guardado = await cache.match(pedido)
  const red = fetch(pedido)
    .then((r) => {
      if (guardable(r)) cache.put(pedido, r.clone())
      return r
    })
    .catch(() => null)
  if (guardado) {
    e.waitUntil(red)
    return guardado
  }
  return (await red) || new Response('', { status: 504, statusText: 'Sin conexión' })
}

// v0.3: notificaciones (la IA te dejó una pregunta, vence hoy). Quedan reservadas, sin lógica (plan, sección 11).
self.addEventListener('push', () => {})
self.addEventListener('notificationclick', (e) => e.notification.close())
