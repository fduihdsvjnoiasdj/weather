// Service Worker pro PWA aplikaci předpovědi počasí
// Cachuje statické soubory pro offline použití a zprostředkovává zobrazení notifikací.

const CACHE_NAME = 'weather-pwa-v1';

// Seznam souborů, které se předem uloží do cache během instalace service workeru.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Instalace: načtení a uložené statických souborů
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  // Okamžitě aktivovat nový service worker
  self.skipWaiting();
});

// Aktivace: vyčištění starých cache (pokud verze změněna)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
  // Okamžitě převzít kontrolu nad klienty
  self.clients.claim();
});

// Fetch handler: pokud je požadavek v cache, použijeme jej, jinak stáhneme ze sítě
self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Odpovídáme pouze na GET dotazy
  if (request.method !== 'GET') {
    return;
  }
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).catch(() => {
        // Pokud síť selže, vrátíme základní stránku
        return caches.match('/index.html');
      });
    })
  );
});

// Příjem zpráv z hlavního skriptu pro zobrazování notifikací
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'notify') {
    const { title, options } = event.data;
    self.registration.showNotification(title, options);
  }
});

// Přijetí push zprávy ze serveru
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Nová notifikace';
  const options = {
    body: data.body,
    icon: data.icon || 'icons/icon-192.png',
    badge: data.badge || 'icons/icon-192.png',
    data: data.url || '/'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Ošetření kliknutí na notifikaci – otevřít nebo zaměřit aplikaci
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('index.html') || client.url === '/' ) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});