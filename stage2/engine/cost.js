// Direction-sensitive walking cost model; a line-for-line port of terrainroute/cost.py (see its docstring for the
// physiology). Costs are J/kg; grades are rise/run (+ = uphill); tan values are tan(terrain slope).

export const MINETTI_LIMIT = 0.45;
export const FLAT_COST = 2.5;  // C(0), J/kg/m: effort is reported as flat-trail-equivalent km

const NORMAL = Object.freeze({
  offtrailFriction: 1.8,    // pervasive-downfall multiplier vs a maintained trail (ASSUMPTION)
  trailFriction: 1.0,
  maxEdgeGrade: 1.0,        // off-trail edges steeper than 45 deg are excluded
  maxTerrainSlopeDeg: 42.0, // cells steeper than this are impassable off-trail (cliff proxy)
  steepGroundStart: 0.30,
  steepGroundK: 2.0,
  descentStart: 0.21,
  descentK: 6.0,
  maxDescentGrade: 0.70,    // off-trail descents steeper than ~35 deg are excluded
});

// "packout" = loaded, often at night: harsher on steep ground, no descents over 30 deg. The 30 deg value is numpy's
// tan(radians(30)) exactly; Math.tan can differ in the last bit, which would move the exclusion edge.
export const PROFILES = Object.freeze({
  normal: NORMAL,
  packout: Object.freeze({ ...NORMAL, steepGroundK: 10.0, maxDescentGrade: 0.5773502691896256 }),
});

// Cost params for a mode, with an optional off-trail difficulty override (1.0-5.0). Throws on bad input.
export function paramsFor(mode = "normal", friction = null) {
  const base = PROFILES[mode];
  if (!base) throw new Error(`unknown mode '${mode}'`);
  if (friction === null || friction === undefined) return base;
  if (typeof friction !== "number" || !(friction >= 1.0 && friction <= 5.0)) {
    throw new Error("friction must be a number between 1.0 and 5.0");
  }
  return Object.freeze({ ...base, offtrailFriction: friction });
}

// Energy cost J/kg per metre travelled at grade i; quadratic growth beyond |i| = 0.45. Always > 0.
export function minetti(i) {
  const c = Math.min(Math.max(i, -MINETTI_LIMIT), MINETTI_LIMIT);
  const base = ((((280.5 * c - 58.7) * c - 76.8) * c + 51.9) * c + 19.6) * c + 2.5;
  return base * Math.max(Math.abs(i) / MINETTI_LIMIT, 1.0) ** 2;
}

// Cost (J/kg) of an edge of horizontal length h (> 0) rising dz, times friction.
export function edgeCost(h, dz, friction) {
  const grade = dz / h;
  return minetti(grade) * h * Math.sqrt(1.0 + grade ** 2) * friction;
}

// Off-trail move cost (J/kg): Minetti x friction x steep-ground x steep-descent; Infinity when excluded.
export function offtrailCost(h, dz, tan, p) {
  const grade = dz / h;
  if (Math.abs(grade) > p.maxEdgeGrade || -grade > p.maxDescentGrade) return Infinity;
  const steep = 1.0 + p.steepGroundK * Math.max(0.0, tan - p.steepGroundStart);
  const descent = 1.0 + p.descentK * Math.max(0.0, -grade - p.descentStart);
  return edgeCost(h, dz, p.offtrailFriction * steep * descent);
}

export const effortKm = cost => cost / FLAT_COST / 1000.0;
