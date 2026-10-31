// Offline support. The app's own files are cached at install (cache-first, replaced as a whole when BUILD changes);
// USGS map tiles saved with an area are answered from the tile cache, so the map works with no signal. Everything
// else goes to the network as usual. BUILD is a hash of the app files, written by `npm run stamp` (a test checks it).
const BUILD = "20ef74be67a4";
const APP_CACHE = `tr-app-${BUILD}`, TILE_CACHE = "tr-tiles-v1", TILE_HOST = "basemap.nationalmap.gov";
const APP_FILES = [
  "./", "index.html", "app.css", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
  "vendor/maplibre/maplibre-gl.js", "vendor/maplibre/maplibre-gl.css",
  "engine/compute.js", "engine/cost.js", "engine/gpx.js", "engine/graph.js", "engine/grid.js", "engine/measure.js",
  "engine/pynum.js", "engine/route.js", "engine/search.js", "engine/utm.js",
  "prepare/box.js", "prepare/overlay.js", "prepare/prepare.js", "prepare/sources.js", "prepare/tiles.js",
  "store/areas.js", "store/backup.js", "store/db.js", "store/points.js", "store/routes.js",
  "ui/actions.js", "ui/engine.js", "ui/events.js", "ui/lists.js", "ui/main.js", "ui/map.js", "ui/profile.js",
  "ui/route-panel.js", "ui/shade.js", "ui/state.js", "ui/units.js",
  "worker/route-worker.js",
];

self.addEventListener("install", e => {
  // cache: "reload" bypasses the browser's HTTP cache, so a new build never stores stale copies of older files
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES.map(f => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("tr-app-") && k !== APP_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const offline = () => new Response("", { status: 504, statusText: "offline and not saved on this device" });

async function fromCache(cacheName, request, opts) {
  const hit = await (await caches.open(cacheName)).match(request, opts);
  return hit || fetch(request).catch(offline);
}

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.host === TILE_HOST) return e.respondWith(fromCache(TILE_CACHE, e.request));
  if (url.origin !== self.location.origin) return;
  if (e.request.mode === "navigate") return e.respondWith(fromCache(APP_CACHE, "index.html"));
  e.respondWith(fromCache(APP_CACHE, e.request, { ignoreSearch: true }));
});

self.addEventListener("message", e => { if (e.data === "build") e.source.postMessage({ build: BUILD }); });
