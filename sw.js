const CACHE = 'st-cache-v1';
const FILES = ['index.html','manifest.json','icon-192.svg','icon-512.svg'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});

self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => r))
  );
});

// Background sync for notifications
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'NOTIF') {
    self.registration.showNotification(e.data.title, {
      body: e.data.body,
      icon: 'icon-192.svg',
      badge: 'icon-192.svg',
      tag: 'stage-tracker'
    });
  }
});
