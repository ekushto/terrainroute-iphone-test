// Prepared areas on this device. Area records (elevation grid, trails, box) live in IndexedDB; offline map tiles live
// in Cache Storage under their real USGS URLs, so the service worker can answer the map's own tile requests offline
// and areas that overlap share tiles. Each area remembers its tile URLs; deleting an area removes only tiles no other
// area still uses. Everything here is per device and per browser: nothing is uploaded.

import { inscribedBounds } from "../prepare/box.js";
import { BASEMAP_URLS, BASEMAP_ZOOMS, fetchBasemap, tileUrl, tilesCovering } from "../prepare/tiles.js";

const DB = "terrainroute", STORE = "areas", VERSION = 1;
export const TILE_CACHE = "tr-tiles-v1";

export class StoreError extends Error {}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "name" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StoreError(`cannot open area storage: ${req.error?.message}`));
    req.onblocked = () => reject(new StoreError("area storage is in use by another TerrainRoute tab; close it and retry"));
  });
}

// Run fn(objectStore) in one transaction; resolves with fn's request result once the transaction commits.
async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = t.onabort = () => reject(new StoreError(`area storage failed: ${t.error?.message || "aborted"}`));
    });
  } finally {
    db.close();
  }
}

// Save (or replace) a prepared area record from prepare.js. Asks the browser to keep this site's data (persistent
// storage) the first time; returns whether the browser agreed.
export async function saveArea(rec) {
  await tx("readwrite", s => s.put(rec));
  return navigator.storage?.persist ? navigator.storage.persist() : false;
}

export const getArea = name => tx("readonly", s => s.get(name));
export const listAreas = () => tx("readonly", s => s.getAll());

// Set the display label (whitespace collapsed, at most 40 characters; blank clears it). Throws if the area is missing.
export async function renameArea(name, label) {
  const rec = await getArea(name);
  if (!rec) throw new StoreError(`unknown area '${name}'`);
  rec.label = String(label).split(/\s+/).filter(Boolean).join(" ").slice(0, 40) || null;
  await tx("readwrite", s => s.put(rec));
  return rec.label;
}

// Delete an area and the offline tiles no other area uses. Returns the number of tiles removed.
export async function deleteArea(name) {
  const all = await listAreas(), rec = all.find(a => a.name === name);
  if (!rec) throw new StoreError(`unknown area '${name}'`);
  const keep = new Set(all.filter(a => a.name !== name).flatMap(a => a.tileUrls || []));
  await tx("readwrite", s => s.delete(name));
  const cache = await caches.open(TILE_CACHE);
  let removed = 0;
  for (const url of rec.tileUrls || []) if (!keep.has(url) && (await cache.delete(url))) removed++;
  return removed;
}

// Store one downloaded map tile under its source URL.
export async function saveTile(url, blob) {
  const cache = await caches.open(TILE_CACHE);
  await cache.put(url, new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } }));
}

// How many of an area's tiles are still in the cache (the browser may evict data it was not told to keep).
export async function tilesPresent(rec) {
  const cache = await caches.open(TILE_CACHE);
  let n = 0;
  for (const url of rec.tileUrls || []) if (await cache.match(url)) n++;
  return n;
}

// { usedMB, quotaMB, persisted } for this site, or nulls where the browser does not say.
export async function storageFacts() {
  const est = (await navigator.storage?.estimate?.()) || {};
  const mb = v => (v === undefined ? null : Math.round(v / 1e5) / 10);
  return { usedMB: mb(est.usage), quotaMB: mb(est.quota), persisted: (await navigator.storage?.persisted?.()) ?? null };
}

// Download the area's offline USGS Topo and Imagery tiles into the cache and record them on the area. Optional, like
// in Python: failures are counted in rec.basemaps, never thrown. onProgress(kind, done, total).
export async function downloadTiles(rec, { onProgress = () => {}, fetchFn, signal } = {}) {
  const bounds = inscribedBounds(rec), list = tilesCovering(bounds, BASEMAP_ZOOMS);
  rec.tileUrls = Object.keys(BASEMAP_URLS).flatMap(kind => list.map(t => tileUrl(kind, t)));
  rec.basemaps = {};
  for (const kind of Object.keys(BASEMAP_URLS)) {
    rec.basemaps[kind] = await fetchBasemap(kind, bounds, (t, blob) => saveTile(tileUrl(kind, t), blob),
      { fetchFn, signal, onProgress: (d, n) => onProgress(kind, d, n) });
  }
  await tx("readwrite", s => s.put(rec));
  return rec.basemaps;
}
