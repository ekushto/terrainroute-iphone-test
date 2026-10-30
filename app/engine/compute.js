// One routing request end to end (port of cli.compute and webdata.route_json): parse the pins, snap them, and run the
// direct line, off-trail-only and hybrid routes. An area is { grid, trails, zone } with trails as [{ name, ref, xy }].
import { buildGraph } from "./graph.js";
import { difficulty, diagnostics, metrics, segmentIntensity } from "./measure.js";
import { cumsum0, npRound } from "./pynum.js";
import { RouteError, directLine, leastCost, snap, withExactEndpoints } from "./route.js";
import { forward, inverse } from "./utm.js";

export class InputError extends Error {}

const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/;
const pyStr = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// Pasted decimal degrees "lat, lon" (comma and/or whitespace) -> [lat, lon]. Throws InputError.
export function parseLatLon(text) {
  const m = COORD_RE.exec(text);
  if (!m) throw new InputError(`unsupported coordinate format: '${text}' (expected decimal degrees 'lat, lon')`);
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) {
    throw new InputError(`coordinate out of range: ${pyStr(lat)}, ${pyStr(lon)}`);
  }
  return [lat, lon];
}

// Hybrid (with trails) and off-trail-only graphs for one area and cost profile; callers cache them.
export const buildGraphs = (area, p) => ({ hybrid: buildGraph(area.grid, area.trails, p), offtrail: buildGraph(area.grid, [], p) });

// All three routes for one pasted origin/destination. Returns { a, b, routes, notes, straightM }. Throws InputError
// or RouteError for bad pins; a route the model can't find becomes a note, not an error.
export function compute(area, originText, destText, p, graphs = null) {
  const [olat, olon] = parseLatLon(originText), [dlat, dlon] = parseLatLon(destText);
  return computeUtm(area, forward(olon, olat, area.zone), forward(dlon, dlat, area.zone), p, graphs);
}

// compute() for pins a, b already in the area's UTM metres.
export function computeUtm(area, a, b, p, graphs = null) {
  const straightM = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (straightM < 1.0) throw new RouteError("origin and destination are the same point");
  const { hybrid, offtrail } = graphs || buildGraphs(area, p);
  const src = snap(hybrid, a[0], a[1], true, "origin"), dst = snap(hybrid, b[0], b[1], false, "destination");
  const routes = [directLine(hybrid, a, b)], notes = [];
  for (const [label, g] of [["off-trail only", offtrail], ["hybrid", hybrid]]) {
    try {
      routes.push(withExactEndpoints(leastCost(g, src, dst, label), g, a, b));
    } catch (e) {
      if (!(e instanceof RouteError)) throw e;
      notes.push(e.message);
    }
  }
  for (const rt of routes) notes.push(...[...rt.notes, ...diagnostics(rt, area.grid, straightM)].map(w => `${rt.label}: ${w}`));
  return { a, b, routes, notes, straightM };
}

// Display data for one route: lat/lon geometry, on-trail flags, metrics, difficulty, shading and elevation profile.
export function routeView(rt, zone) {
  const dist = cumsum0(rt.xy.slice(1).map((p, i) => Math.hypot(p[0] - rt.xy[i][0], p[1] - rt.xy[i][1])));
  return {
    label: rt.label,
    latlon: rt.xy.map(([x, y]) => { const [lon, lat] = inverse(x, y, zone); return [npRound(lat, 6), npRound(lon, 6)]; }),
    on_trail: rt.onTrail, metrics: metrics(rt), difficulty: difficulty(rt), intensity: segmentIntensity(rt),
    profile: { d: Array.from(dist, v => npRound(v)), z: rt.z.map(v => npRound(v, 1)) },
  };
}
