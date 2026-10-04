// Netzwerk zuerst (Änderungen an JSON-Dateien sofort sichtbar), offline aus dem Cache.
const V = 'fit-v4';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'calc.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'data/recipes.json', 'data/exercises.json', 'data/tips.json'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request)
    .then(r => { const c = r.clone(); caches.open(V).then(ca => ca.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
