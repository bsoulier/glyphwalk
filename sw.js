// Generated at build time by vite.config.ts.
const CACHE = 'glyphwalk-7f37d35af30d';
const FILES = ["./","apple-touch-icon.png","assets/index-BVIMykQM.css","assets/index-DaDjXeOj.js","icon-192.png","icon-512.png","icon-maskable-512.png","index.html","manifest.webmanifest"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('glyphwalk-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Module scripts send an Origin header the precache requests did not, so a server's "Vary: Origin" must not split them.
  const opts = { ignoreSearch: true, ignoreVary: true };
  if (req.mode === 'navigate') {
    // The page itself comes from the network when there is one, so updates arrive; offline it comes from the cache.
    e.respondWith(fetch(req).catch(() => caches.match(req, opts).then((hit) => hit || caches.match('index.html', opts))));
    return;
  }
  e.respondWith(caches.match(req, opts).then((hit) => hit || fetch(req)));
});
