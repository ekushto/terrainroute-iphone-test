// Elevation profile of the shown route: filled line, hardest-200 m band, difficulty strip, and a cursor you scrub with
// the mouse or a finger (reports distance, elevation and local grade, and moves a marker on the map).
import { shadeOf } from "./shade.js";
import { dist, distUnit, height, heightUnit } from "./units.js";

const W = 320, X0 = 10, X1 = 310, Y0 = 8, Y1 = 82, STRIP_Y = 88, BUCKETS = 32, GRADE_WINDOW_M = 50;
const NS = "http://www.w3.org/2000/svg";

// Difficulty along the route in `n` equal-distance buckets: [{ color, from, to }] in metres.
export function buckets(rt, n = BUCKETS) {
  const d = rt.profile.d, total = d.at(-1) || 1, out = [];
  for (let b = 0; b < n; b++) {
    const from = total * b / n, to = total * (b + 1) / n;
    let cost = 0, len = 0, unknown = false;
    for (let k = 0; k < rt.intensity.length; k++) {
      const a = Math.max(d[k], from), z = Math.min(d[k + 1], to);
      if (z <= a) continue;
      if (rt.intensity[k] === null) unknown = true;
      else { cost += rt.intensity[k] * (z - a); len += z - a; }
    }
    out.push({ color: shadeOf(unknown || !len ? null : cost / len), from, to });
  }
  return out;
}

function scale(rt) {
  const z = rt.profile.z, lo = Math.min(...z), hi = Math.max(...z), pad = Math.max(10, (hi - lo) * 0.08), total = rt.profile.d.at(-1) || 1;
  return { x: d => X0 + (X1 - X0) * d / total, y: v => Y1 - (Y1 - Y0) * (v - lo + pad) / (hi - lo + 2 * pad), total, lo, hi };
}

const el = (tag, attrs) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// Draw the profile of route `rt` into <svg id="profile">; returns a scrub(clientX) -> {latlon, text} | null helper.
export function drawProfile(svg, rt) {
  svg.replaceChildren();
  if (!rt) return () => null;
  const sc = scale(rt), pts = rt.profile.d.map((d, k) => `${sc.x(d).toFixed(1)},${sc.y(rt.profile.z[k]).toFixed(1)}`);
  svg.append(el("path", { d: `M${pts.join(" L")} L${X1},${Y1} L${X0},${Y1} Z`, fill: "#0F5E54", "fill-opacity": 0.12, stroke: "none" }));
  const h = rt.difficulty;
  if (h.hardest_intensity !== null) {
    svg.append(el("rect", { x: sc.x(h.hardest_from_m), y: Y0, width: Math.max(1, sc.x(h.hardest_to_m) - sc.x(h.hardest_from_m)), height: Y1 - Y0, fill: "#7C2D12", "fill-opacity": 0.13, stroke: "none" }));
  }
  svg.append(el("path", { d: `M${pts.join(" L")}`, fill: "none", stroke: "#0F5E54", "stroke-width": 2 }));
  for (const b of buckets(rt)) svg.append(el("rect", { x: sc.x(b.from), y: STRIP_Y, width: sc.x(b.to) - sc.x(b.from) + 0.3, height: 8, fill: b.color, stroke: "none" }));
  const cursor = el("g", { visibility: "hidden" });
  cursor.append(el("line", { y1: Y0, y2: Y1, stroke: "#1C2127", "stroke-dasharray": "3 3" }), el("circle", { r: 4, fill: "#fff", stroke: "#1C2127", "stroke-width": 2 }));
  svg.append(cursor);
  return clientX => scrubAt(svg, rt, sc, cursor, clientX);
}

function scrubAt(svg, rt, sc, cursor, clientX) {
  if (clientX === null) { cursor.setAttribute("visibility", "hidden"); return null; }
  const box = svg.getBoundingClientRect(), want = Math.min(Math.max((clientX - box.left) / box.width * W, X0), X1);
  const d = rt.profile.d, target = (want - X0) / (X1 - X0) * sc.total;
  let k = d.findIndex(v => v >= target);
  if (k < 0) k = d.length - 1;
  const j = d.findIndex(v => v >= d[k] - GRADE_WINDOW_M), grade = d[k] > d[j] ? (rt.profile.z[k] - rt.profile.z[j]) / (d[k] - d[j]) : 0;
  cursor.setAttribute("visibility", "visible");
  cursor.firstChild.setAttribute("x1", sc.x(d[k]));
  cursor.firstChild.setAttribute("x2", sc.x(d[k]));
  cursor.lastChild.setAttribute("cx", sc.x(d[k]));
  cursor.lastChild.setAttribute("cy", sc.y(rt.profile.z[k]));
  return { latlon: rt.latlon[k], text: `${dist(d[k])} ${distUnit()} · ${height(rt.profile.z[k])} ${heightUnit()} · ${Math.round(grade * 100)}%` };
}

// Start / end / high / low elevations as display text.
export function profileStats(rt) {
  const z = rt.profile.z, f = v => `${height(v)} ${heightUnit()}`;
  return { start: f(z[0]), end: f(z.at(-1)), high: f(Math.max(...z)), low: f(Math.min(...z)) };
}
