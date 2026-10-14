// Tabbook service worker: network first, falls back to the last saved copy when offline.
const V = "tabbook-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return; // never cache Supabase calls
  e.respondWith(
    fetch(r)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(r, copy)); }
        return res;
      })
      .catch(() => caches.match(r).then((m) => m || (r.mode === "navigate" ? caches.match("/") : Response.error())))
  );
});