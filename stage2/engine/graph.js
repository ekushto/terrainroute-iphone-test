// Terrain + trail graph (port of terrainroute/graph.py). Node ids 0..nc-1 are DEM cells (row * cols + col); ids nc..
// are trail nodes. Off-trail cell-to-cell edges (16 neighbours) are generated on the fly by the search, so only trail
// edges and trail<->cell connectors are stored. Trail nodes are separate from cells on purpose (see DECISIONS.md).
import { edgeCost, offtrailCost } from "./cost.js";
import { pyFixed } from "./pynum.js";

export const MOVES = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
export const TRAIL_STEP_M = 10.0;
const CONNECT_RADIUS_CELLS = 1;

// The two cells a knight move passes between, as [dr, dc] offsets; [] for ordinary 8-neighbour moves.
export function straddled(dr, dc) {
  if (Math.abs(dr) === 2) return [[dr / 2, 0], [dr / 2, dc]];
  if (Math.abs(dc) === 2) return [[0, dc / 2], [dr, dc / 2]];
  return [];
}

// Insert points so no segment exceeds step; original vertices are kept exactly (junctions).
export function densify(xy, step) {
  const pts = [xy[0]];
  for (let k = 1; k < xy.length; k++) {
    const a = xy[k - 1], b = xy[k], dx = b[0] - a[0], dy = b[1] - a[1];
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
    for (let i = 1; i <= n; i++) pts.push([a[0] + (i / n) * dx, a[1] + (i / n) * dy]);
  }
  return pts;
}

// Densified trail nodes with identical vertices merged (OSM junctions) and points without elevation dropped.
// Returns { xy: [[x, y]], z: [m], segs: [[i, j]] }.
export function trailNodes(grid, trails) {
  const index = new Map(), xy = [], segs = [];
  for (const tr of trails) {
    let prev = null;
    for (const pt of densify(tr.xy, TRAIL_STEP_M)) {
      const [r, c] = grid.xyToRc(pt[0], pt[1]);
      if (!grid.inBounds(r, c) || Number.isNaN(grid.bilinear(pt[0], pt[1]))) {
        prev = null;  // the trail leaves the data: break the chain
        continue;
      }
      const key = `${pyFixed(pt[0], 1)},${pyFixed(pt[1], 1)}`;
      if (!index.has(key)) {
        index.set(key, xy.length);
        xy.push(pt);
      }
      const i = index.get(key);
      if (prev !== null && prev !== i) segs.push([prev, i]);
      prev = i;
    }
  }
  return { xy, z: xy.map(([x, y]) => grid.bilinear(x, y)), segs };
}

// Directed graph for one area and cost profile; trails = [] gives the off-trail-only variant.
export function buildGraph(grid, trails, p) {
  const tan = grid.tanSlopeFilled(), passable = grid.passable(p.maxTerrainSlopeDeg);
  const nc = grid.rows * grid.cols, nodes = trailNodes(grid, trails);
  const g = { grid, p, nc, tan, passable, trailXy: nodes.xy, trailZ: nodes.z,
    trailOut: nodes.xy.map(() => new Map()), cellOut: new Map() };
  addTrailEdges(g, nodes.segs);
  addConnectors(g);
  return g;
}

// Keep the cheapest edge per (u, v), as Python's dedup does for overlapping trail ways.
function addEdge(g, u, v, w) {
  if (!(Number.isFinite(w) && w > 0)) throw new Error(`edge weight must be finite and positive, got ${w}`);
  let out;
  if (u >= g.nc) out = g.trailOut[u - g.nc];
  else if (!(out = g.cellOut.get(u))) g.cellOut.set(u, (out = new Map()));
  const old = out.get(v);
  if (old === undefined || w < old) out.set(v, w);
}

function addTrailEdges(g, segs) {
  const { nc, p, trailXy: xy, trailZ: z } = g;
  for (const [i, j] of segs) {
    const h = Math.hypot(xy[j][0] - xy[i][0], xy[j][1] - xy[i][1]), dz = z[j] - z[i];
    addEdge(g, nc + i, nc + j, edgeCost(h, dz, p.trailFriction));
    addEdge(g, nc + j, nc + i, edgeCost(h, -dz, p.trailFriction));
  }
}

// Connector edges trail node <-> the passable cells around it, each direction costed (and excluded) on its own.
function addConnectors(g) {
  const { grid, nc, p, tan, passable } = g, k = CONNECT_RADIUS_CELLS;
  g.trailXy.forEach(([x, y], i) => {
    const [r0, c0] = grid.xyToRc(x, y);
    if (!passable[r0 * grid.cols + c0]) return;  // the trail may cross steep ground; an approach to it may not
    for (let r = r0 - k; r <= r0 + k; r++) {
      for (let c = c0 - k; c <= c0 + k; c++) {
        const cell = r * grid.cols + c;
        if (!grid.inBounds(r, c) || !passable[cell]) continue;
        const [cx, cy] = grid.rcToXy(r, c);
        const h = Math.max(Math.hypot(cx - x, cy - y), 0.5), dz = grid.dem[cell] - g.trailZ[i];
        const steep = Math.max(tan[cell], tan[r0 * grid.cols + c0]);
        const out = offtrailCost(h, dz, steep, p), back = offtrailCost(h, -dz, steep, p);
        if (Number.isFinite(out)) addEdge(g, nc + i, cell, out);
        if (Number.isFinite(back)) addEdge(g, cell, nc + i, back);
      }
    }
  });
}

// [x, y, z] of a node: cell centre + DEM value, or a trail node's true position.
export function nodeXyz(g, node) {
  if (node >= g.nc) {
    const t = node - g.nc;
    return [g.trailXy[t][0], g.trailXy[t][1], g.trailZ[t]];
  }
  const r = Math.floor(node / g.grid.cols), c = node - r * g.grid.cols;
  return [...g.grid.rcToXy(r, c), g.grid.dem[node]];
}
