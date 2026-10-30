// Downloads for a new area (port of terrainroute/data.py): USGS 3DEP elevation, USFS trails, OpenStreetMap trails.
// All three servers allow browser requests (CORS checked 2026-10-30). Every function takes a fetch implementation so
// tests can substitute one; failures throw PrepareError with the server's own message where there is one.
import { forward } from "../engine/utm.js";
import { PrepareError, latlonBbox, shape } from "./box.js";

export const DEM_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
export const USFS_TRAILS_URL = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0/query";
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const TRAIL_HIGHWAYS = "path|footway|bridleway|track";
const NODATA_BELOW = -1000.0, NODATA_ABOVE = 9000;
const RETRY_STATUS = new Set([429, 502, 503, 504]);

const sleep = ms => new Promise(res => setTimeout(res, ms));

// GET url?params with 3 attempts (retrying busy-server statuses and network errors, waiting 5 s then 10 s).
// Returns the Response body as an ArrayBuffer. Throws PrepareError.
export async function httpGet(url, params, { fetchFn = fetch, wait = sleep, signal } = {}) {
  const full = `${url}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetchFn(full, { signal });
    } catch (e) {
      if (signal?.aborted) throw new PrepareError("cancelled");
      if (attempt === 2) throw new PrepareError(`network error fetching ${url}: ${e.message}`);
    }
    if (res?.ok) return res.arrayBuffer();
    if (res && !RETRY_STATUS.has(res.status)) {
      throw new PrepareError(`HTTP ${res.status} from ${url}: ${(await res.text()).slice(0, 300)}`);
    }
    if (attempt < 2) await wait(5000 * (attempt + 1));
  }
  throw new PrepareError(`gave up on ${url} after 3 attempts`);
}

// Elevation grid for the region in metres (Float32Array, row 0 = north; NaN = no data), as Python's fetch_dem +
// load_dem. Uses the raw "bip" format: rows*cols float32 values followed by a 1-bit-per-pixel mask (not needed:
// missing data is detected by value, exactly as Python does with the TIFF).
export async function fetchDem(region, opts = {}) {
  const [rows, cols] = shape(region);
  const params = {
    bbox: `${region.xmin},${region.ymin},${region.xmax},${region.ymax}`, bboxSR: region.epsg, imageSR: region.epsg,
    size: `${cols},${rows}`, format: "bip", pixelType: "F32", noDataInterpretation: "esriNoDataMatchAny",
    interpolation: "RSP_BilinearInterpolation", f: "image",
  };
  const buf = await httpGet(DEM_URL, params, opts), n = rows * cols;
  if (buf.byteLength !== n * 4 + Math.ceil(n / 8)) {
    const text = new TextDecoder().decode(buf.slice(0, 200));
    throw new PrepareError(`3DEP did not return ${rows}x${cols} elevations (${buf.byteLength} bytes): ${text}`);
  }
  const dem = new Float32Array(buf.slice(0, n * 4));  // little-endian on every supported device
  for (let i = 0; i < n; i++) if (dem[i] < NODATA_BELOW || dem[i] > NODATA_ABOVE) dem[i] = NaN;
  return { dem, rows, cols, params };
}

const json = buf => JSON.parse(new TextDecoder().decode(buf));
const titleCase = s => s.toLowerCase().replace(/[a-z]+/gi, w => w[0].toUpperCase() + w.slice(1));  // Python str.title

// USFS National Forest System trails as [{ id, name, ref, trail_class, xy }] in the region's UTM metres.
export async function fetchTrailsUsfs(region, opts = {}) {
  const [s, w, n, e] = latlonBbox(region);
  const params = {
    geometry: `${w},${s},${e},${n}`, geometryType: "esriGeometryEnvelope", inSR: 4326, outSR: 4326,
    spatialRel: "esriSpatialRelIntersects", outFields: "TRAIL_NO,TRAIL_NAME,TRAIL_CLASS", returnGeometry: "true", f: "json",
  };
  let doc;
  try {
    doc = json(await httpGet(USFS_TRAILS_URL, params, opts));
    if (!Array.isArray(doc.features)) throw new Error(doc.error?.message || "no features list");
  } catch (e) {
    if (e instanceof PrepareError) throw e;
    throw new PrepareError(`bad USFS response: ${e.message}`);
  }
  if (doc.exceededTransferLimit) throw new PrepareError("USFS query hit the server record limit; region too large for one request");
  const trails = [];
  doc.features.forEach((f, k) => {
    const a = Object.fromEntries(Object.entries(f.attributes || {}).map(([key, v]) => [key.toLowerCase(), v]));
    for (const path of f.geometry?.paths || []) {  // multipart lines become separate trails
      if (path.length < 2) continue;
      trails.push({ id: k, name: titleCase(a.trail_name || "") || null, ref: a.trail_no ?? null,
        trail_class: a.trail_class ?? null, xy: path.map(([lon, lat]) => forward(lon, lat, region.zone)) });
    }
  });
  return { trails, params };
}

// OpenStreetMap trail-like ways (path/footway/bridleway/track) via Overpass, same shape as fetchTrailsUsfs.
export async function fetchTrailsOsm(region, opts = {}) {
  const [s, w, n, e] = latlonBbox(region);
  const query = `[out:json][timeout:120];way["highway"~"^(${TRAIL_HIGHWAYS})$"](${s},${w},${n},${e});out tags geom;`;
  let elements;
  try {
    elements = json(await httpGet(OVERPASS_URL, { data: query }, opts)).elements;
    if (!Array.isArray(elements)) throw new Error("no elements list");
  } catch (e) {
    if (e instanceof PrepareError) throw e;
    throw new PrepareError(`bad Overpass response: ${e.message}`);
  }
  const trails = elements.filter(el => (el.geometry || []).length >= 2).map(el => ({
    id: el.id, name: el.tags?.name ?? null, ref: el.tags?.ref ?? null, highway: el.tags?.highway ?? null,
    xy: el.geometry.map(g => forward(g.lon, g.lat, region.zone)),
  }));
  return { trails, query };
}
