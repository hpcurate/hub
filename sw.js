/* ── The web app's service worker ─────────────────────────────────────────────
   HUB is three things already — a page opened off disk, an extension page, and
   the page a blocked YouTube tab lands on. This is the fourth: served over
   https, it installs, keeps its own window, and opens with no network at all.

   Nothing in the app knows about this. The board is static files and
   localStorage; the whole of "make it a web app" is a manifest, this file, and
   the twenty lines in js/webapp.js that register it. If this worker never
   installs — off disk, inside the extension, in a browser that has none — the
   board is exactly what it was, which is the only acceptable outcome for a
   thing whose entire job is to be invisible.

   **Never registered inside the extension.** An extension page has its own
   service worker (the guard's), its own origin and its own update rules; a
   second one on top of that is a way to break the guard for no gain. js/webapp.js
   checks the protocol before it registers anything.

   ── The strategy ────────────────────────────────────────────────────────────
   Network first for our own files, cache first for fonts.

   Network first is the deliberate choice. A cache-first shell is faster on the
   second load and is how you ship a board that quietly keeps showing last
   week's code — the classic "I updated it and nothing changed". HUB is a
   handful of small local files; the network is not the slow part, and being
   wrong about which version is running is a much worse failure than a few
   milliseconds. Offline, the cache answers, which is the whole point.

   With one exception, which the first honest test of this found: when the
   browser already knows there is no network, network first means every single
   file on the page waits for its own connection to fail before the cache is
   asked, and a cold offline start takes seconds instead of nothing. So
   `navigator.onLine` short-circuits it. It is a poor answer to "can I reach
   this server" — a captive portal is online by that measure — but a completely
   reliable answer to "is there definitely no network at all", which is the only
   thing being asked here, and the fallback is unchanged either way.

   Fonts are the other way round: they are large, immutable, and on someone
   else's server. Once fetched they never need fetching again.
*/

const VERSION = 'v0.20.0';
const SHELL   = 'hub-shell-' + VERSION;
const FONTS   = 'hub-fonts-' + VERSION;

/* Everything the board is. Relative so it works from a subpath — GitHub Pages
   serves this at /hub/, not at the root. */
const PRECACHE = [
  './',
  './index.html',
  './css/tokens.css',
  './css/hub.css',
  './ext/scope.js',
  './ext/model.js',
  './ext/yt.js',
  './ext/ig.js',
  './js/store.js',
  './js/bridge.js',
  './js/enrich.js',
  './js/webapp.js',
  './js/app.js',
  './app.webmanifest',
  './icons/192.png',
  './icons/512.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/* Install: fetch the shell. One file that will not come back must not take the
   whole install with it, so they are added one at a time and a failure is
   survivable — a missing file is fetched from the network later like anything
   else. */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(PRECACHE.map(u =>
      cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    /* Take over straight away rather than waiting for every tab to close. The
       strategy is network first, so there is no half-updated app to protect. */
    await self.skipWaiting();
  })());
});

/* Activate: drop every cache that is not this version's, and start answering
   for pages that are already open. */
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, FONTS]);
    const names = await caches.keys();
    await Promise.all(names.map(n => (keep.has(n) || !n.startsWith('hub-')) ? null : caches.delete(n)));
    await self.clients.claim();
  })());
});

/* A response worth keeping: our own, a real one, and not a range request's
   slice. Opaque responses (the fonts, which are cross-origin and no-cors) have
   status 0 and are still worth caching — they are only ever read back by the
   browser itself, which knows what to do with them. */
const storable = res => !!res && (res.status === 200 || res.type === 'opaque');

async function fromNetwork(req, cacheName){
  const res = await fetch(req);
  if (storable(res)){
    const copy = res.clone();
    caches.open(cacheName).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url) } catch { return }

  /* Fonts: cache first, forever. */
  if (FONT_HOSTS.includes(url.hostname)){
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try { return await fromNetwork(req, FONTS) }
      catch { return Response.error() }
    })());
    return;
  }

  /* Anything else on someone else's origin — a channel avatar, a YouTube page
     the extension asked for — is none of our business. Avatars are hotlinked
     from Google's own CDN with their own caching, and a stale avatar in a cache
     of ours would outlive the one the browser keeps. */
  if (url.origin !== self.location.origin) return;

  /* Our own files: network first, cache as the answer when there is no network
     — or cache first when the browser has already said there is none. A
     navigation that finds neither falls back to the shell, so an installed app
     opened on a plane opens the board rather than a browser error. */
  e.respondWith((async () => {
    const cached = () => caches.match(req);

    if (self.navigator && self.navigator.onLine === false){
      const hit = await cached();
      if (hit) return hit;
    }

    try { return await fromNetwork(req, SHELL) }
    catch {
      const hit = await cached();
      if (hit) return hit;
      if (req.mode === 'navigate'){
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});

/* The page can ask what is running, which is what settings shows. */
self.addEventListener('message', e => {
  if (e.data === 'version' && e.source) e.source.postMessage({ sw: VERSION });
});
