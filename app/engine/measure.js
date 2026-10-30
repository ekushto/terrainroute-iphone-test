// Route numbers (port of Route.metrics, difficulty, segment_intensity and diagnostics in terrainroute/route.py).
// Distances in metres, effort in flat-trail-equivalent km, intensities as "x flat-trail effort" (1.0 = flat trail).
import { FLAT_COST, effortKm } from "./cost.js";
import { cumsum0, degrees, npMod, npSum, pyFixed, pyRound } from "./pynum.js";

const STEEP_DESCENT_GRADE = 0.46630765815499864;  // numpy tan(radians(25)): hazardous off-trail descent (reporting)
export const HARDEST_WINDOW_M = 200.0;

const segLengths = rt => rt.xy.slice(1).map((p, i) => Math.hypot(p[0] - rt.xy[i][0], p[1] - rt.xy[i][1]));
const finite2 = v => (Number.isFinite(v) ? pyRound(v, 2) : null);

// Distance, ascent/descent, trail share (%), trail transitions, off-trail metres descending > 25 deg, effort.
export function metrics(rt) {
  const seg = segLengths(rt), dz = rt.z.slice(1).map((z, i) => z - rt.z[i]);
  const dist = npSum(seg), trail = npSum(seg.filter((_, i) => rt.onTrail[i]));
  let transitions = 0;
  for (let i = 1; i < rt.onTrail.length; i++) if (rt.onTrail[i] !== rt.onTrail[i - 1]) transitions++;
  const steepDown = seg.filter((s, i) => dz[i] / s < -STEEP_DESCENT_GRADE && !rt.onTrail[i] && s > 0);
  if (!(dist >= 0 && trail <= dist + 1e-6)) throw new Error("route distances do not reconcile");
  return {
    distance_m: pyRound(dist), ascent_m: pyRound(npSum(dz.filter(v => v > 0))),
    descent_m: pyRound(npSum(dz.filter(v => v < 0).map(v => -v))),
    trail_pct: dist ? pyRound(100 * trail / dist, 1) : 0.0, trail_transitions: transitions,
    offtrail_steep_descent_m: pyRound(npSum(steepDown)),
    effort_flat_km: Number.isFinite(rt.cost) ? pyRound(effortKm(rt.cost), 2) : null,
  };
}

// numpy.argmax: first maximum, or the first NaN if there is one.
function argmax(a) {
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i])) return i;
    if (a[i] > a[k]) k = i;
  }
  return k;
}

// Smallest index with sorted[idx] >= v (numpy.searchsorted, side="left").
function searchLeft(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Off-trail metres and mean intensity, and the hardest HARDEST_WINDOW_M stretch (intensity, start/end metres).
export function difficulty(rt) {
  const seg = segLengths(rt), c = rt.segCost;
  if (!c || c.length !== seg.length || c.some(v => v < 0)) throw new Error("route needs one non-negative cost per segment");
  const offIdx = seg.map((_, i) => i).filter(i => !rt.onTrail[i]);
  const offM = npSum(offIdx.map(i => seg[i]));
  const cum = cumsum0(seg), cc = cumsum0(c), reach = Math.min(HARDEST_WINDOW_M, cum.at(-1));
  const starts = [], ends = [], win = [];
  for (let i = 0; i < cum.length; i++) {
    const j = searchLeft(cum, cum[i] + reach - 1e-9);
    if (j >= cum.length) continue;
    const span = cum[j] - cum[i];
    starts.push(i);
    ends.push(j);
    win.push(span > 0 ? (cc[j] - cc[i]) / (FLAT_COST * span) : 0.0);
  }
  const k = argmax(win);
  return {
    offtrail_m: pyRound(offM),
    offtrail_intensity: offM > 0 ? finite2(npSum(offIdx.map(i => c[i])) / (FLAT_COST * offM)) : null,
    hardest_intensity: win.length ? finite2(win[k]) : null,
    hardest_from_m: win.length ? pyRound(cum[starts[k]]) : 0,
    hardest_to_m: win.length ? pyRound(cum[ends[k]]) : 0,
  };
}

// Per-segment intensity for shading a route (null where impassable).
export const segmentIntensity = rt =>
  segLengths(rt).map((s, i) => finite2(rt.segCost[i] / (FLAT_COST * Math.max(s, 0.5))));

// Heuristic red flags for implausible paths; returns human-readable warnings (empty = none).
export function diagnostics(rt, grid, straightM) {
  const warn = [], m = metrics(rt);
  if (straightM > 0 && m.distance_m / straightM > 2.0) {
    warn.push(`detour ratio ${pyFixed(m.distance_m / straightM, 2)}x straight-line distance`);
  }
  const edge = 3 * grid.cell, x0 = grid.xmin, y1 = grid.ymax;
  const x1 = x0 + grid.cols * grid.cell, y0 = y1 - grid.rows * grid.cell;
  const near = rt.xy.filter(([x, y]) => x - x0 < edge || x1 - x < edge || y - y0 < edge || y1 - y < edge).length;
  if (near / rt.xy.length > 0.05) {
    warn.push(`${pyFixed(100 * (near / rt.xy.length), 0)}% of vertices within ${pyFixed(edge, 0)} m of the data boundary (border hugging)`);
  }
  if (m.trail_transitions > 6) warn.push(`${m.trail_transitions} trail on/off transitions (possible trail-hopping artifact)`);
  const heading = rt.xy.slice(1).map((p, i) => degrees(Math.atan2(p[1] - rt.xy[i][1], p[0] - rt.xy[i][0])));
  let reversals = 0, offCount = 0;
  for (let i = 1; i < heading.length; i++) {
    const off = !(rt.onTrail[i] || rt.onTrail[i - 1]);  // trail switchbacks are legitimate reversals
    offCount += off;
    if (off && Math.abs(npMod(heading[i] - heading[i - 1] + 180, 360) - 180) > 135) reversals++;
  }
  if (reversals >= 3 && reversals > 0.02 * offCount) {
    warn.push(`${reversals} off-trail near-reversals (>135 deg turns): oscillation`);
  }
  return warn;
}
