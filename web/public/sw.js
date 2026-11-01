/* Wallet service worker: keeps the app shell so the wallet opens offline. Cards never pass through here (they live in localStorage). */
const VERSION = "wallet-v2";
// mount path ("" at the root, "/Wallet" behind aj124.com/Wallet), taken from where this worker lives
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll([`${BASE}/`, `${BASE}/manifest.webmanifest`, `${BASE}/icons/icon.svg`]).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// network first, cached copy when offline or when the network is slow (Render's free plan takes ~50 s to wake);
// the slow response still refreshes the cache, and the page's version check reloads once the new build is live
const SLOW_MS = 3000;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // version.json must always come from the network so a new release is noticed
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.endsWith("/version.json")) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = () => cache.match(req).then((hit) => hit || (req.mode === "navigate" ? cache.match(`${BASE}/`) : undefined));
    const network = fetch(req).then(async (res) => {
      if (res.ok) await cache.put(req, res.clone());
      return res;
    });
    event.waitUntil(network.catch(() => {}));
    const slow = new Promise((resolve) => setTimeout(resolve, SLOW_MS)).then(cached);
    try {
      // whichever comes first: the network, or the cached copy after SLOW_MS (if there is one)
      return await Promise.race([network, slow.then((hit) => hit || network)]);
    } catch (err) {
      const hit = await cached();
      if (hit) return hit;
      throw err;
    }
  })());
});
