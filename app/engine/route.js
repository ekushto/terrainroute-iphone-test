// Routes on a graph (port of terrainroute/route.py): snapping pins, the short pin legs, least-cost search, exact
// endpoints and the straight-line baseline. A route is { label, xy: [[x, y]], z: [m], onTrail: [bool per segment],
// cost (J/kg, Infinity if impassable), notes: [text], segCost: [J/kg per segment] } in UTM metres, travel order.
import { offtrailCost } from "./cost.js";
import { nodeXyz } from "./graph.js";
import { cumsum0, degrees, linspace2, npSum, pyFixed } from "./pynum.js";
import { shortestPath } from "./search.js";

export const SNAP_RADIUS_M = 60.0;
const LEG_SAMPLE_M = 2.0;
const DIRECT_SAMPLE_M = 5.0;

export class RouteError extends Error {}

const fmax = (a, b) => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.max(a, b));  // numpy.fmax
const hyp = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);

// Node id of the nearest passable cell within SNAP_RADIUS_M of (x, y) whose straight leg to/from the exact point is
// allowed (leaving = true: point -> cell, i.e. an origin). Equal distances keep row-major order. Throws RouteError.
export function snap(g, x, y, leaving = true, role = "point") {
  const { grid } = g, [r, c] = grid.xyToRc(x, y);
  if (!grid.inBounds(r, c)) throw new RouteError(`${role} is outside the prepared region`);
  const k = Math.ceil(SNAP_RADIUS_M / grid.cell), cand = [];
  for (let rr = Math.max(0, r - k); rr < Math.min(grid.rows, r + k + 1); rr++) {
    for (let cc = Math.max(0, c - k); cc < Math.min(grid.cols, c + k + 1); cc++) {
      const [cx, cy] = grid.rcToXy(rr, cc), d = Math.hypot(cx - x, cy - y);
      if (g.passable[rr * grid.cols + cc] && d <= SNAP_RADIUS_M) cand.push({ d, node: rr * grid.cols + cc, xy: [cx, cy] });
    }
  }
  if (!cand.length) throw new RouteError(`${role}: no passable terrain within ${SNAP_RADIUS_M} m`);
  cand.sort((a, b) => a.d - b.d);
  for (const { node, xy } of cand) {
    const cost = leaving ? legCost(g, [x, y], xy) : legCost(g, xy, [x, y]);
    if (Number.isFinite(cost)) return node;
  }
  throw new RouteError(`${role}: every way to or from the point within ${SNAP_RADIUS_M} m is steeper than ` +
    "the model allows, or has no elevation data. Move the pin onto walkable ground.");
}

// Off-trail cost (J/kg) of the straight leg p -> q sampled every LEG_SAMPLE_M; Infinity (or NaN) when the model
// excludes it or it touches a cell with no elevation data.
export function legCost(g, p, q) {
  const length = hyp(p, q);
  if (length < 0.5) return 0.0;
  const { grid } = g, tan = grid.tanSlope();
  const xy = linspace2(p, q, Math.max(2, Math.ceil(length / LEG_SAMPLE_M) + 1));
  const z = xy.map(([x, y]) => grid.bilinear(x, y));
  const idx = xy.map(([x, y]) => { const [r, c] = grid.xyToRc(x, y); return r * grid.cols + c; });
  if (z.some(Number.isNaN) || idx.some(i => Number.isNaN(grid.dem[i]))) return Infinity;
  const costs = [];
  for (let i = 1; i < xy.length; i++) {
    costs.push(offtrailCost(hyp(xy[i - 1], xy[i]), z[i] - z[i - 1], fmax(tan[idx[i]], tan[idx[i - 1]]), g.p));
  }
  return npSum(costs);
}

// Least-cost route between two node ids. Throws RouteError if dst is unreachable.
export function leastCost(g, src, dst, label) {
  const res = shortestPath(g, src, dst);
  if (!Number.isFinite(res.cost)) throw new RouteError(`${label}: destination unreachable from origin under the cost model`);
  const xyz = res.nodes.map(n => nodeXyz(g, n)), trail = res.nodes.map(n => n >= g.nc);
  const total = npSum(res.segCost);
  if (Math.abs(total - res.cost) > 1e-6 + 1e-6 * Math.abs(res.cost)) throw new Error("edge costs must sum to the route cost");
  return { label, xy: xyz.map(v => [v[0], v[1]]), z: xyz.map(v => v[2]), onTrail: trail.slice(1).map((t, i) => t && trail[i]),
    cost: res.cost, notes: [], segCost: res.segCost };
}

// The route extended to the exact pins a (origin) and b (destination); the search ran on snapped cells. The two legs
// are costed and checked like any off-trail move. Throws RouteError if the model excludes one.
export function withExactEndpoints(rt, g, a, b) {
  const first = rt.xy[0], last = rt.xy.at(-1);
  const legA = legCost(g, a, first), legB = legCost(g, last, b), legs = legA + legB;
  if (!Number.isFinite(legs)) throw new RouteError(`${rt.label}: the short leg between a pin and the route is steeper than the model allows`);
  const notes = [...rt.notes];
  for (const [name, pt] of [["origin", a], ["destination", b]]) {
    const [r, c] = g.grid.xyToRc(pt[0], pt[1]);
    if (!g.passable[r * g.grid.cols + c]) {
      notes.push(`${name} pin sits on ground steeper than ${pyFixed(g.p.maxTerrainSlopeDeg, 0)} deg ` +
        "(the model avoids it elsewhere); the short leg to the route is included anyway");
    }
  }
  const all = [a, ...rt.xy, b], allOn = [false, ...rt.onTrail, false];
  const keep = all.map((pt, i) => i === 0 || hyp(all[i - 1], pt) > 0.5);
  const cum = cumsum0([legA, ...rt.segCost, legB]).filter((_, i) => keep[i]);
  const xy = all.filter((_, i) => keep[i]);
  return { label: rt.label, xy, z: xy.map(([x, y]) => g.grid.bilinear(x, y)),
    onTrail: allOn.filter((_, i) => keep[i + 1]), cost: rt.cost + legs, notes,
    segCost: cum.slice(1).map((v, i) => v - cum[i]) };  // a dropped point's cost moves to its neighbour
}

// Straight-line baseline sampled every DIRECT_SAMPLE_M with the same off-trail model; cost Infinity if any sample
// is on impassable ground, lacks elevation, or a step is excluded.
export function directLine(g, a, b) {
  const { grid, p } = g, tan = grid.tanSlopeFilled();
  const xy = linspace2(a, b, Math.max(2, Math.ceil(hyp(a, b) / DIRECT_SAMPLE_M) + 1));
  const z = xy.map(([x, y]) => grid.bilinear(x, y));
  const idx = xy.map(([x, y]) => { const [r, c] = grid.xyToRc(x, y); return r * grid.cols + c; });
  const segCost = [], badLen = [];
  for (let i = 1; i < xy.length; i++) {
    const h = hyp(xy[i - 1], xy[i]), dz = z[i] - z[i - 1];
    const w = Number.isFinite(dz) ? offtrailCost(h, dz, Math.max(tan[idx[i]], tan[idx[i - 1]]), p) : Infinity;
    segCost.push(w);
    if (!g.passable[idx[i]] || !g.passable[idx[i - 1]] || !Number.isFinite(w)) badLen.push(h);
  }
  const route = { label: "direct line", xy, z, onTrail: segCost.map(() => false),
    cost: npSum(segCost.filter(Number.isFinite)), notes: [], segCost };
  if (badLen.length) {
    route.cost = Infinity;
    route.notes.push(`crosses ${pyFixed(npSum(badLen), 0)} m the model marks impassable (cliff, over-steep, ` +
      `no elevation data, or descent > ${pyFixed(degrees(Math.atan(p.maxDescentGrade)), 0)} deg)`);
  }
  return route;
}
