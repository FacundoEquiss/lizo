// Service worker de emergencia (plan del celular, 9.5). Si alguna vez llega a producción un service worker defectuoso,
// se compila con TELAR_SW=apagar (npm run build con esa variable) y se publica: este reemplaza al anterior, borra todas
// las cachés de Telar, se da de baja y recarga las pestañas abiertas. Es el único arreglo posible para quien quedó
// atrapado en una versión vieja.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('telar-')) await caches.delete(k)
      await self.registration.unregister()
      for (const cliente of await self.clients.matchAll({ type: 'window' })) cliente.navigate(cliente.url)
    })(),
  )
})
