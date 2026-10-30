// Least-cost search (Dijkstra) over a graph from graph.js. Off-trail cell edges are generated on the fly exactly as
// Python's _offtrail_edges builds them; stored trail/connector edges come from g.trailOut / g.cellOut.
import { offtrailCost } from "./cost.js";
import { MOVES, straddled } from "./graph.js";

const LENGTHS = MOVES.map(([dr, dc]) => Math.sqrt(dr * dr + dc * dc));
const MIDS = MOVES.map(([dr, dc]) => straddled(dr, dc));

// Binary min-heap of (key, node) in typed arrays, lazy deletion; cheap for ~1M pushes on a phone.
class Heap {
  constructor(cap = 1 << 16) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
    this.n = 0;
  }

  push(key, node) {
    if (this.n === this.k.length) this._grow();
    const { k, v } = this;
    let i = this.n++;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (k[par] <= key) break;
      k[i] = k[par];
      v[i] = v[par];
      i = par;
    }
    k[i] = key;
    v[i] = node;
  }

  // Removes the minimum; returns its node and leaves its key in this.top.
  pop() {
    const { k, v } = this, node = v[0], lastK = k[--this.n], lastV = v[this.n];
    this.top = k[0];
    let i = 0;
    for (;;) {
      let ch = 2 * i + 1;
      if (ch >= this.n) break;
      if (ch + 1 < this.n && k[ch + 1] < k[ch]) ch++;
      if (k[ch] >= lastK) break;
      k[i] = k[ch];
      v[i] = v[ch];
      i = ch;
    }
    k[i] = lastK;
    v[i] = lastV;
    return node;
  }

  _grow() {
    const k = new Float64Array(this.k.length * 2), v = new Int32Array(this.v.length * 2);
    k.set(this.k);
    v.set(this.v);
    this.k = k;
    this.v = v;
  }
}

// Calls visit(v, w) for every edge out of cell u (the 16-neighbour moves, then any stored connectors).
function cellEdges(g, u, visit) {
  const { grid, tan, passable, p } = g, { cols, rows, dem, cell } = grid;
  const r = Math.floor(u / cols), c = u - r * cols;
  if (passable[u]) {
    for (let m = 0; m < 16; m++) {
      const r2 = r + MOVES[m][0], c2 = c + MOVES[m][1];
      if (r2 < 0 || r2 >= rows || c2 < 0 || c2 >= cols) continue;
      const v = r2 * cols + c2;
      if (!passable[v]) continue;
      let steep = Math.max(tan[u], tan[v]), blocked = false;
      for (const [mr, mc] of MIDS[m]) {  // a knight move must not jump over impassable cells
        const mid = (r + mr) * cols + c + mc;
        if (!passable[mid]) blocked = true;
        steep = Math.max(steep, tan[mid]);
      }
      if (blocked) continue;
      const w = offtrailCost(cell * LENGTHS[m], dem[v] - dem[u], steep, p);
      if (Number.isFinite(w)) visit(v, w);
    }
  }
  const extra = g.cellOut.get(u);
  if (extra) for (const [v, w] of extra) visit(v, w);
}

// Dijkstra from src to dst. Returns { cost (J/kg; Infinity if unreachable), nodes [src..dst], segCost [per edge] }.
export function shortestPath(g, src, dst) {
  const n = g.nc + g.trailXy.length;
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const prevW = new Float64Array(n), done = new Uint8Array(n), heap = new Heap();
  dist[src] = 0;
  heap.push(0, src);
  let d = 0;
  const relax = (v, w) => {
    const nd = d + w;
    if (nd < dist[v]) {
      dist[v] = nd;
      prev[v] = current;
      prevW[v] = w;
      heap.push(nd, v);
    }
  };
  let current = src;
  while (heap.n) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === dst) break;
    d = heap.top;
    current = u;
    if (u < g.nc) cellEdges(g, u, relax);
    else for (const [v, w] of g.trailOut[u - g.nc]) relax(v, w);
  }
  if (!Number.isFinite(dist[dst])) return { cost: Infinity, nodes: [], segCost: [] };
  const nodes = [dst], segCost = [];
  while (nodes.at(-1) !== src) {
    const v = nodes.at(-1);
    if (prev[v] < 0) throw new Error("broken predecessor chain");
    segCost.push(prevW[v]);
    nodes.push(prev[v]);
  }
  return { cost: dist[dst], nodes: nodes.reverse(), segCost: segCost.reverse() };
}
