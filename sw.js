const CACHE_NAME = 'bine-zdravje-v48';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './nutrition-engine.js',
  './baza-znanja-vault.json',
  './body-map-data.json',
  './food-match.js',
  './food-vision-ui.js',
  './bp-ui.js',
  './food-db.json',
  './food-aliases.json',
  './exercise-db.json',
  './workout-templates.json',
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
  './assistant-ui.js',
  './error-guard.js',
  './backup-ui.js',
  './cloud-sync.js',
  './casovnica-ui.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './apple-touch-startup-image.png',
  './icon-maskable-512.png',
  './assets/anime/bg_ambient.mp4',
  './assets/anime/bg_ambient-opt.gif',
  './assets/anime/celebrate-opt.gif',
  './assets/anime/happy-opt.gif',
  './assets/anime/wink-opt.gif',
  './assets/anime/laugh-opt.gif',
  './assets/anime/thumbsup-opt.gif'
];

// 1. Namestitev: posamezni cache.add s catch, da manjkajoče datoteke ne zlomijo namestitve
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[SW] Opozorilo: vir ni bil predpomnjen:', asset, err && err.message ? err.message : err);
          })
        )
      );
    })
  );
  // Takoj prevzemi brez čakanja (iOS PWA)
  self.skipWaiting();
});

// 2. Aktivacija: čiščenje starih predpomnilnikov + clients.claim + postMessage obvestilo
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
    ).then(() => self.clients.claim()).then(() => {
      // Obvesti vse odprte zavihke/okna o posodobitvi: "nova različica, osveži"
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'SW_UPDATED',
            version: CACHE_NAME,
            message: 'Nova različica, osveži'
          });
        });
      });
    })
  );
});

// 3. Podpora za ročno sprožitev skipWaiting prek sporočila
self.addEventListener('message', (event) => {
  if (event.data) {
    if (event.data === 'SKIP_WAITING' || event.data.type === 'SKIP_WAITING' || event.data === 'skipWaiting') {
      self.skipWaiting();
    }
  }
});

// 4. Upravljanje zahtev (Fetch Handler)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // 4a. Ignoriraj zahteve, ki niso GET, ter protokole razen http/https
  if (req.method !== 'GET' || !url.startsWith('http')) return;

  // 4b. API klici, endpoint konfiguracija in zunanji dinamični viri: NIKOLI iz predpomnilnika
  if (
    url.includes('/api/') ||
    url.includes('food-vision-endpoint.json') ||
    url.includes('google-health-workouts.json')
  ) {
    return;
  }

  // 4c. HTML dokument / navigacija: Network-First s 3 s časovno omejitvijo
  const isHtml =
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    url.endsWith('.html') ||
    url.includes('index.html');

  if (isHtml) {
    event.respondWith(
      new Promise((resolve) => {
        let settled = false;

        const timeoutId = setTimeout(() => {
          if (!settled) {
            settled = true;
            caches.match(req, { ignoreSearch: true }).then((cached) => {
              if (cached) {
                resolve(cached);
              } else {
                caches.match('./index.html', { ignoreSearch: true }).then((idx) => {
                  resolve(idx || caches.match('./', { ignoreSearch: true }) || Response.error());
                });
              }
            });
          }
        }, 3000);

        fetch(req)
          .then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              const clone = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            if (!settled) {
              settled = true;
              clearTimeout(timeoutId);
              resolve(networkRes);
            }
          })
          .catch(() => {
            if (!settled) {
              settled = true;
              clearTimeout(timeoutId);
              caches.match(req, { ignoreSearch: true }).then((cached) => {
                if (cached) {
                  resolve(cached);
                } else {
                  caches.match('./index.html', { ignoreSearch: true }).then((idx) => {
                    resolve(idx || caches.match('./', { ignoreSearch: true }) || Response.error());
                  });
                }
              });
            }
          });
      })
    );
    return;
  }

  // 4d. Slike in mediji (PNG, JPG, GIF, WebM, MP4, SVG): Cache-First
  const isImageOrMedia =
    req.destination === 'image' ||
    req.destination === 'video' ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico|mp4|webm)(\?.*)?$/i.test(url) ||
    url.includes('/assets/');

  if (isImageOrMedia) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              const clone = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            return networkRes;
          })
          .catch(() => Response.error());
      })
    );
    return;
  }

  // 4e. JS, JSON, CSS in ostali statični viri: Stale-While-Revalidate
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
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
