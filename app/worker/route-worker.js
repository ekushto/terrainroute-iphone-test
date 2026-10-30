// Background thread for everything heavy, so the map stays responsive on the phone: routing, 3D elevation tiles and
// the steep overlay for the current area. Messages are { id, type, ... }; every reply is { id, result } or
// { id, error, kind } (kind = the error class name, so the page can tell bad input from a bug).
import { buildGraphs, computeUtm, routeView } from "../engine/compute.js";
import { paramsFor } from "../engine/cost.js";
import { inverse, forward } from "../engine/utm.js";
import { steepOverlay } from "../prepare/overlay.js";
import { engineArea } from "../prepare/prepare.js";
import { demTilePixels } from "../prepare/tiles.js";

const state = { rec: null, area: null, lowest: 0, graphs: new Map(), last: null };

async function png(pixels, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

// Make `rec` the current area. Returns its trails as GeoJSON and the steep overlay as a PNG with its corner bounds.
async function loadArea(rec) {
  state.rec = rec;
  state.area = engineArea(rec);
  state.graphs.clear();
  state.last = null;
  state.lowest = state.area.grid.dem.reduce((m, v) => (v < m ? v : m), Infinity);
  const toLonLat = ([x, y]) => inverse(x, y, rec.zone).map(v => Math.round(v * 1e6) / 1e6);
  const trails = { type: "FeatureCollection", features: rec.trails.map(t => ({ type: "Feature",
    properties: { name: t.name || "", ref: t.ref ?? "" }, geometry: { type: "LineString", coordinates: t.xy.map(toLonLat) } })) };
  const ov = steepOverlay(rec, state.area.grid);
  return { name: rec.name, trails, steep: { bounds: ov.bounds, png: await png(ov.pixels, ov.width, ov.height) } };
}

function graphsFor(mode, friction) {
  const key = `${mode}|${friction}`;
  if (!state.graphs.has(key)) state.graphs.set(key, buildGraphs(state.area, paramsFor(mode, friction)));
  return state.graphs.get(key);
}

// All three routes between lat/lon pins a and b. Keeps the raw routes so a GPX or a kept route matches the display.
function route({ area, a, b, mode, friction }) {
  if (!state.area || state.rec.name !== area) throw new Error("area not loaded");
  const p = paramsFor(mode, friction), zone = state.rec.zone;
  const res = computeUtm(state.area, forward(a[1], a[0], zone), forward(b[1], b[0], zone), p, graphsFor(mode, friction));
  state.last = res;
  return {
    routes: res.routes.map(rt => ({ ...routeView(rt, zone), raw: { xy: rt.xy, z: rt.z, onTrail: rt.onTrail } })),
    notes: res.notes,
  };
}

async function demTile({ z, x, y }) {
  if (!state.area) throw new Error("area not loaded");
  return png(demTilePixels(state.area.grid, state.rec.zone, z, x, y, state.lowest), 256, 256);
}

const HANDLERS = { area: m => loadArea(m.rec), route, demTile };

self.onmessage = async ({ data }) => {
  try {
    const result = await HANDLERS[data.type](data);
    self.postMessage({ id: data.id, result });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message, kind: e.constructor.name });
  }
};
