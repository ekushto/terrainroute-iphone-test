// TerrainRoute mobile feasibility test: off-trail least-cost solver.
// A direct port of terrainroute/cost.py (Minetti x friction x steep-ground x steep-descent) and the off-trail part of
// terrainroute/graph.py (16-neighbour grid, knight moves check the cells they pass between). Trails are NOT included:
// this file exists to measure on-phone speed/memory and to check numerical parity with the Python engine.
// Works in the browser (globalThis.TR) and in Node (module.exports) so the parity check can run on the Mac.
(function (root) {
  "use strict";
  const NORMAL = { offtrail_friction: 1.8, max_edge_grade: 1.0, max_terrain_slope_deg: 42, steep_ground_start: 0.30,
                   steep_ground_k: 2.0, descent_start: 0.21, descent_k: 6.0, max_descent_grade: 0.70 };
  const PROFILES = { normal: NORMAL, packout: { ...NORMAL, steep_ground_k: 10.0, max_descent_grade: Math.tan(30 * Math.PI / 180) } };
  const FLAT_COST = 2.5;
  const MOVES = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
                 [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

  // Energy cost J/kg per metre at grade i (rise/run); quadratic extrapolation beyond |i| = 0.45 (as cost.minetti).
  function minetti(i) {
    const c = Math.max(-0.45, Math.min(0.45, i));
    const base = ((((280.5 * c - 58.7) * c - 76.8) * c + 51.9) * c + 19.6) * c + 2.5;
    return base * Math.max(Math.abs(i) / 0.45, 1) ** 2;
  }

  // Off-trail move cost (J/kg) or Infinity when excluded (as cost.offtrail_cost).
  function offtrailCost(h, dz, tan, p) {
    const g = dz / h;
    if (Math.abs(g) > p.max_edge_grade || -g > p.max_descent_grade) return Infinity;
    const f = p.offtrail_friction * (1 + p.steep_ground_k * Math.max(0, tan - p.steep_ground_start))
            * (1 + p.descent_k * Math.max(0, -g - p.descent_start));
    return minetti(g) * h * Math.sqrt(1 + g * g) * f;
  }

  // tan(slope) per cell like numpy.gradient (central inside, one-sided at edges); NaN DEM -> 99 (impassable).
  function tanSlope(dem, rows, cols, cell) {
    const t = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const at = (rr, cc) => dem[rr * cols + cc];
      const gx = c === 0 ? (at(r, 1) - at(r, 0)) / cell : c === cols - 1 ? (at(r, c) - at(r, c - 1)) / cell
                         : (at(r, c + 1) - at(r, c - 1)) / (2 * cell);
      const gy = r === 0 ? (at(1, c) - at(0, c)) / cell : r === rows - 1 ? (at(r, c) - at(r - 1, c)) / cell
                         : (at(r + 1, c) - at(r - 1, c)) / (2 * cell);
      const v = Math.hypot(gx, gy);
      t[r * cols + c] = Number.isFinite(v) ? v : 99;
    }
    return t;
  }

  function prepare(dem, rows, cols, cell, p) {
    const tan = tanSlope(dem, rows, cols, cell);
    const maxTan = Math.tan(p.max_terrain_slope_deg * Math.PI / 180);
    const ok = new Uint8Array(rows * cols);
    for (let i = 0; i < ok.length; i++) ok[i] = Number.isFinite(dem[i]) && tan[i] <= maxTan ? 1 : 0;
    return { dem, rows, cols, cell, p, tan, ok };
  }

  // Binary min-heap of (key, node) with lazy deletion; typed arrays so 300k nodes stay cheap on a phone.
  function Heap(cap) {
    let k = new Float64Array(cap), v = new Int32Array(cap), n = 0;
    const grow = () => { const k2 = new Float64Array(k.length * 2), v2 = new Int32Array(v.length * 2); k2.set(k); v2.set(v); k = k2; v = v2; };
    return {
      size: () => n,
      push(key, node) {
        if (n === k.length) grow();
        let i = n++;
        while (i > 0) { const par = (i - 1) >> 1; if (k[par] <= key) break; k[i] = k[par]; v[i] = v[par]; i = par; }
        k[i] = key; v[i] = node;
      },
      pop() {
        const topK = k[0], topV = v[0], lastK = k[--n], lastV = v[n];
        let i = 0;
        for (;;) {
          let ch = 2 * i + 1; if (ch >= n) break;
          if (ch + 1 < n && k[ch + 1] < k[ch]) ch++;
          if (k[ch] >= lastK) break;
          k[i] = k[ch]; v[i] = v[ch]; i = ch;
        }
        k[i] = lastK; v[i] = lastV;
        return [topK, topV];
      },
    };
  }

  // Dijkstra from src to dst over the 16-neighbour grid, edges generated on the fly (no stored graph).
  // Returns { cost (J/kg, Infinity if unreachable), nodes (cell ids src..dst), settled }.
  function solve(S, src, dst) {
    const { dem, rows, cols, cell, p, tan, ok } = S, n = rows * cols;
    const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const heap = Heap(1 << 16);
    dist[src] = 0; heap.push(0, src);
    let settled = 0;
    while (heap.size()) {
      const [d, u] = heap.pop();
      if (done[u]) continue;
      done[u] = 1; settled++;
      if (u === dst) break;
      const r = (u / cols) | 0, c = u - r * cols;
      for (const [dr, dc] of MOVES) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 < 0 || r2 >= rows || c2 < 0 || c2 >= cols) continue;
        const v = r2 * cols + c2;
        if (!ok[v] || done[v]) continue;
        let steep = Math.max(tan[u], tan[v]);
        if (Math.abs(dr) === 2 || Math.abs(dc) === 2) {  // knight move: the two cells it passes between
          const mids = Math.abs(dr) === 2 ? [[r + dr / 2, c], [r + dr / 2, c + dc]] : [[r, c + dc / 2], [r + dr, c + dc / 2]];
          let blocked = false;
          for (const [mr, mc] of mids) { const m = mr * cols + mc; if (!ok[m]) blocked = true; steep = Math.max(steep, tan[m]); }
          if (blocked) continue;
        }
        const w = offtrailCost(cell * Math.hypot(dr, dc), dem[v] - dem[u], steep, p);
        if (!Number.isFinite(w)) continue;
        const nd = d + w;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
      }
    }
    if (!Number.isFinite(dist[dst])) return { cost: Infinity, nodes: [], settled };
    const nodes = [dst];
    while (nodes[nodes.length - 1] !== src) nodes.push(prev[nodes[nodes.length - 1]]);
    return { cost: dist[dst], nodes: nodes.reverse(), settled };
  }

  // Nearest passable cell within 60 m of (x, y) UTM; -1 if none. (Simplified vs Python: no leg check.)
  function snap(S, x, y, xmin, ymax) {
    const { rows, cols, cell, ok } = S;
    const c0 = Math.floor((x - xmin) / cell), r0 = Math.floor((ymax - y) / cell), k = Math.ceil(60 / cell);
    let best = -1, bd = Infinity;
    for (let r = r0 - k; r <= r0 + k; r++) for (let c = c0 - k; c <= c0 + k; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols || !ok[r * cols + c]) continue;
      const d = Math.hypot(xmin + (c + 0.5) * cell - x, ymax - (r + 0.5) * cell - y);
      if (d <= 60 && d < bd) { bd = d; best = r * cols + c; }
    }
    return best;
  }

  const effortKm = cost => cost / FLAT_COST / 1000;
  root.TR = { PROFILES, minetti, offtrailCost, prepare, solve, snap, effortKm };
  if (typeof module !== "undefined") module.exports = root.TR;
})(typeof globalThis !== "undefined" ? globalThis : this);
