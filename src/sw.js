// The service worker (docs/specs/11-release.md § PWA): Stompy installed and
// offline for single player. scripts/build.mjs writes it into dist/ with
// VERSION (a hash of everything it caches) and FILES (that everything); the
// development page never registers it.
// - The bundle, CSS, sounds, icons and manifest: from the cache first, all
//   fetched on install, so one online visit is enough.
// - index.html: from the network first, the cache when offline (cached on
//   install too, since the first visit loaded it before the worker existed).
// - Anything else (another origin; the relay is a WebSocket and never comes
//   here at all): left alone.
// A new version waits until the page says SKIP (UPDATED · RELOAD in the menu).
const VERSION = 'dev', FILES = [];
const CACHE = `stompy-${VERSION}`;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['index.html', ...FILES])));   // the page too: the first visit loaded it before this existed
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('stompy-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname, path = url.pathname.slice(scope.length);
  if (req.mode === 'navigate' || path === '' || path === 'index.html') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); }
      return res;
    }).catch(() => caches.match('index.html', { cacheName: CACHE })));
  } else if (FILES.includes(path)) {
    e.respondWith(caches.match(path, { cacheName: CACHE }).then(hit => hit || fetch(req)));
  }
});
