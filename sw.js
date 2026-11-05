const CACHE_NAME = 'bine-zdravje-v35';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './nutrition-engine.js',
  './baza-znanja-vault.json',
  './body-map-data.json',
  './food-match.js',
  './food-vision-ui.js',
  './food-db.json',
  './food-aliases.json',
  './exercise-db.json',
  './workout-templates.json',
  './google-health-workouts.json',
  './exercise-match.js',
  './workout-engine.js',
  './recovery-engine.js',
  './workout-parser.js',
  './workout-io.js',
  './workout-ui.js',
  './skin-storage.js',
  './skinhair-engine.js',
  './skinhair-ui.js',
  './cikel-plan.js',
  './danes-podatki.js',
  './protocol-diary.js',
  './protocol-diary-ui.js',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Odstranjujem star predpomnilnik:', key);
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 1. Za navigacijo (HTML dokument): VEDNO Network-First, da se takoj naloži nova koda
  if (req.mode === 'navigate' || req.destination === 'document' || req.url.includes('index.html')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // 1b. Endpoint in API klici: vedno omrežje
  if (req.method !== 'GET' || req.url.includes('food-vision-endpoint.json') || req.url.includes('/api/')) return;

  // 2. Za ostale statične vire: Stale-While-Revalidate (takoj iz cache-a, vzporedno posodobi)
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => cached || Response.error());

      return cached || fetchPromise;
    })
  );
});
