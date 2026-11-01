/* Wallet service worker: keeps the app shell so the wallet opens offline. Cards never pass through here (they live in localStorage). */
const VERSION = "wallet-v1";
// mount path ("" at the root, "/Wallet" behind aj124.com/Wallet), taken from where this worker lives
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll([`${BASE}/`, `${BASE}/manifest.webmanifest`, `${BASE}/icons/icon.svg`]).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// network first, cached copy when offline
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = (await cache.match(req)) || (req.mode === "navigate" ? await cache.match(`${BASE}/`) : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
