// Map tiles (port of terrainroute/tiles.py): z/x/y Web Mercator tile maths, the offline USGS Topo/Hybrid downloads,
// and Terrarium-encoded elevation tiles generated from our own DEM for MapLibre 3D.
import { forward } from "../engine/utm.js";

const USGS = "https://basemap.nationalmap.gov/arcgis/rest/services";
export const BASEMAP_URLS = {
  topo: `${USGS}/USGSTopo/MapServer/tile/{z}/{y}/{x}`,
  imagery: `${USGS}/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}`,  // "Hybrid": the photo with contours, streams and names
};
export const BASEMAP_ZOOMS = [11, 12, 13, 14, 15, 16];  // USGS caches both to z16 (z17 returns 404)
export const DEM_ZOOMS = [8, 9, 10, 11, 12, 13, 14];    // z14 is ~7 m/pixel at 40 deg N, finer than our 10 m DEM
export const TILE = 256;
const POLITE_WORKERS = 4;

// [x, y] of the tile containing lon/lat at zoom z (clamped to the world).
export function lonlatToTile(lon, lat, z) {
  const n = 2 ** z, clamp = v => Math.min(Math.max(v, 0), n - 1);
  const x = Math.trunc((lon + 180) / 360 * n);
  const y = Math.trunc((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return [clamp(x), clamp(y)];
}

// All [z, x, y] tiles touching bounds [[south, west], [north, east]] at the given zooms.
export function tilesCovering([[s, w], [n, e]], zooms) {
  const out = [];
  for (const z of zooms) {
    const [x0, y0] = lonlatToTile(w, n, z), [x1, y1] = lonlatToTile(e, s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}

export const tileUrl = (kind, [z, x, y]) => BASEMAP_URLS[kind].replace("{z}", z).replace("{y}", y).replace("{x}", x);

// Download every basemap tile of `kind` for the bounds, 4 at a time (polite to USGS), handing each to
// save(tile, blob). Basemaps are optional: failures are counted, never thrown. Returns { tiles, failed }.
export async function fetchBasemap(kind, bounds, save, { fetchFn = fetch, onProgress = () => {}, signal } = {}) {
  const todo = tilesCovering(bounds, BASEMAP_ZOOMS);
  let next = 0, failed = 0, done = 0;
  async function worker() {
    while (next < todo.length && !signal?.aborted) {
      const t = todo[next++];
      try {
        const res = await fetchFn(tileUrl(kind, t), { signal });
        if (!res.ok || !(res.headers.get("Content-Type") || "").startsWith("image/")) throw new Error(`HTTP ${res.status}`);
        await save(t, await res.blob());
      } catch {
        failed++;  // counted and reported: one bad tile must not sink the area
      }
      onProgress(++done, todo.length);
    }
  }
  await Promise.all(Array.from({ length: POLITE_WORKERS }, worker));
  return { tiles: todo.length, failed: failed + (todo.length - done) };
}

// Terrarium RGB for one elevation (elevation = R*256 + G + B/256 - 32768), as Python's terrarium_encode.
export function terrariumEncode(elev) {
  const v = Math.min(Math.max(elev, -32000), 32000) + 32768.0;
  const r = Math.floor(v / 256), g = Math.floor(v - r * 256), b = Math.floor((v - r * 256 - g) * 256);
  return [r, g, b];
}

export const terrariumDecode = (r, g, b) => r * 256 + g + b / 256 - 32768;

// RGBA pixels (Uint8ClampedArray, 256x256) of Terrarium tile z/x/y sampled bilinearly from the area's grid. Pixels
// outside the DEM take the nearest edge value; DEM gaps render as the area's lowest point.
export function demTilePixels(grid, zone, z, x, y, lowest) {
  const n = 2 ** z, px = new Uint8ClampedArray(TILE * TILE * 4);
  for (let j = 0; j < TILE; j++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ((y + (j + 0.5) / TILE) / n)))) * (180 / Math.PI);
    for (let i = 0; i < TILE; i++) {
      const lon = ((x + (i + 0.5) / TILE) / n) * 360 - 180;
      const e = grid.bilinear(...forward(lon, lat, zone));
      const [r, g, b] = terrariumEncode(Number.isFinite(e) ? e : lowest);
      px.set([r, g, b, 255], (j * TILE + i) * 4);
    }
  }
  return px;
}
