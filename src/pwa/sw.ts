// Puddle's service worker: keeps the app, the eh WASM bundle and the self-hosted extensions so Puddle runs
// offline after the first visit. Registered as sw.js?build=<id>, so each deploy installs a fresh cache.
import { CACHE_PREFIX, cacheName, strategyFor } from './precache';

declare const self: ServiceWorkerGlobalScope;

const build = new URL(self.location.href).searchParams.get('build') ?? 'dev';
const CACHE = cacheName(build);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('precache.json', { cache: 'no-store' });
      const files: string[] = res.ok ? await res.json() : [];
      const cache = await caches.open(CACHE);
      await cache.addAll(files);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const strategy = strategyFor(new URL(req.url), self.location.origin, req.mode);
  if (strategy === 'network') return;
  event.respondWith(strategy === 'page' ? page(req) : cacheFirst(req));
});

/** Pages: the network when it answers, else the cached app shell (which carries the isolation headers). */
async function page(req: Request): Promise<Response> {
  try {
    return await fetch(req);
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match('./')) ?? (await cache.match('index.html')) ?? Response.error();
  }
}

/** Versioned files: the cache, else the network, keeping what comes back for next time. */
async function cacheFirst(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') await cache.put(req, res.clone());
  return res;
}
