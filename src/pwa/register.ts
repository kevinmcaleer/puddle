// Register the service worker in production builds; the dev server serves modules it shouldn't cache.
declare const __PUDDLE_BUILD__: string;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const url = new URL(`sw.js?build=${encodeURIComponent(__PUDDLE_BUILD__)}`, new URL(import.meta.env.BASE_URL, location.href));
  navigator.serviceWorker.register(url.href, { scope: import.meta.env.BASE_URL }).catch((e: unknown) => console.warn('Puddle: offline support is unavailable.', e));
}
