// Service Worker pro PWA aplikaci předpovědi počasí
// Cachuje statické soubory pro offline použití a zprostředkovává zobrazení notifikací.

const CACHE_NAME = 'weather-pwa-v1';

// Seznam souborů, které se předem uloží do cache během instalace service workeru.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
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