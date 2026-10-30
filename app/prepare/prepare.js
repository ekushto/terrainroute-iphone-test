// Prepare a routing area (port of prepare.prepare): pick the box, download elevation and trails, return one
// self-contained area record. Saving it (and the optional offline map tiles) is the caller's job, so a failed download
// never leaves a half-prepared area behind.
import { Grid } from "../engine/grid.js";
import { MAX_RADIUS_KM, PrepareError, autoName, regionBox } from "./box.js";
import { DEM_URL, OVERPASS_URL, USFS_TRAILS_URL, fetchDem, fetchTrailsOsm, fetchTrailsUsfs } from "./sources.js";

const NAME_RE = /^[a-z0-9_]{1,60}$/;
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// Area record for an explicit box. trailSource: "auto" (USFS, else OSM when the box has no Forest Service trails),
// "usfs" or "osm". opts: { fetchFn, onProgress(step text), signal }. Throws PrepareError.
export async function prepareBox(name, region, trailSource = "auto", opts = {}) {
  if (!NAME_RE.test(name)) throw new PrepareError(`area name must be lowercase letters, digits, underscore: '${name}'`);
  const say = opts.onProgress || (() => {});
  say("Downloading elevation (USGS 3DEP)…");
  const dem = await fetchDem(region, opts);
  if (dem.dem.every(Number.isNaN)) throw new PrepareError("USGS returned no elevation data for this area");
  let source = trailSource === "osm" ? "osm" : "usfs", trails, prov;
  if (source === "usfs") {
    say("Downloading Forest Service trails…");
    const res = await fetchTrailsUsfs(region, opts);
    ({ trails } = res);
    prov = { source: "USFS EDW TrailNFSPublish (public domain)", url: USFS_TRAILS_URL, params: res.params };
    if (!trails.length && trailSource === "auto") source = "osm";
  }
  if (source === "osm") {
    say("Downloading OpenStreetMap trails…");
    const res = await fetchTrailsOsm(region, opts);
    ({ trails } = res);
    prov = { source: "OpenStreetMap via Overpass API (ODbL 1.0, (c) OpenStreetMap contributors)", url: OVERPASS_URL, query: res.query };
  }
  return {
    version: 1, name, label: null, ...region, rows: dem.rows, cols: dem.cols, trailSource: source,
    dem: dem.dem, trails, createdAt: now(),
    provenance: {
      dem: { source: "USGS 3DEP Bare Earth DEM Dynamic ImageServer (public domain)", url: DEM_URL, params: dem.params, fetched_utc: now() },
      trails: { ...prov, count: trails.length, fetched_utc: now() },
    },
  };
}

// Area record for a radiusKm square around lat/lon, auto-named. Throws PrepareError.
export async function prepareAround(lat, lon, radiusKm = MAX_RADIUS_KM, opts = {}) {
  const region = regionBox(lat, lon, radiusKm);
  const area = await prepareBox(autoName(lat, lon), region, "auto", opts);
  return { ...area, center: [lat, lon], radiusKm };
}

// The engine's view of an area record: { grid, trails, zone }.
export function engineArea(rec) {
  const grid = new Grid(Float64Array.from(rec.dem), rec.rows, rec.cols, rec.xmin, rec.ymax, rec.cell);
  return { grid, trails: rec.trails, zone: rec.zone };
}
