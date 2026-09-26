import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesIn(p));
    else out.push(relative(dir, p).split('\\').join('/'));
  }
  return out;
}

/**
 * Emits sw.js with every built file in its precache list. Asset names carry content hashes, so hashing
 * the list gives a cache name that changes exactly when something did.
 */
function offline(): Plugin {
  return {
    name: 'glyphwalk-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = [...new Set(['index.html', ...Object.keys(bundle), ...filesIn('public')])].filter((f) => f !== 'sw.js').sort();
      const version = createHash('sha1').update(files.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(version, ['./', ...files]) });
    },
  };
}

function serviceWorker(version: string, files: string[]): string {
  return `// Generated at build time by vite.config.ts.
const CACHE = 'glyphwalk-${version}';
const FILES = ${JSON.stringify(files)};

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
`;
}

export default defineConfig({
  // Relative asset URLs, so the build works from any folder (e.g. a GitHub Pages project path).
  base: './',
  plugins: [offline()],
});
