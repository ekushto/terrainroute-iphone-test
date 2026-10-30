// Offline service worker for the iPhone test: answer from Cache Storage first, fall back to the network.
// The page itself fills the cache ("Download test area"); nothing is cached implicitly.
const CACHE = "tr-test-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true }))
    .then(hit => hit || fetch(e.request).catch(() => new Response("", { status: 404, statusText: "offline, not cached" }))));
});
