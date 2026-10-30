// One explicit state object for the page, with named mutators. Settings (not routes or areas) are remembered per
// device in localStorage; when that is unavailable (private browsing) the app still works with defaults.

const SETTINGS_KEY = "terrainroute.settings.v1";
const SAVED = ["units", "mode", "friction", "base", "steepOn", "steepOpacity", "trailsOn", "shadeOn", "keptOn", "prepRadius",
  "areaName"];

// Off-trail difficulty = how many times the effort of the same metre on a maintained trail (slope penalties stack).
// ASSUMPTIONS to calibrate in the field.
export const DIFFICULTY = [
  { v: 1.0, name: "Open", desc: "Park-like timber or meadow: off-trail as easy as trail." },
  { v: 1.3, name: "Light", desc: "Scattered deadfall, easy step-overs, occasional detour." },
  { v: 1.8, name: "Typical", desc: "Mixed beetle-kill: frequent step-overs, some weaving." },
  { v: 2.5, name: "Heavy", desc: "Continuous deadfall: climbing over logs constantly." },
  { v: 3.5, name: "Severe", desc: "Jackstrawed blowdown: crawling over and under, very slow." },
];
export const MODE_HINT = {
  normal: "Off-trail descents steeper than 35° are never routed.",
  packout: "Loaded: avoids sidehilling steep ground; off-trail descents steeper than 30° are never routed.",
};

export const state = {
  units: "imperial", mode: "normal", friction: 1.8, base: "topo", steepOn: false, steepOpacity: 0.6, trailsOn: true,
  shadeOn: true, keptOn: true, prepRadius: 4, areaName: null,
  areas: [], area: null,                 // area records on this device; the current one (full record)
  origin: null, dest: null, originName: "", destName: "",   // [lat, lon] pins
  result: null, ghost: null, busy: false, seq: 0, compareOn: false,
  kept: [], tab: "route", sheet: "peek", threeD: false, layersOpen: false,
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    for (const k of SAVED) if (k in saved) state[k] = saved[k];
  } catch {
    // no storage (private mode) or bad JSON: keep defaults
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.fromEntries(SAVED.map(k => [k, state[k]]))));
  } catch {
    // not saved this time; the app keeps working
  }
}

export function set(patch) {
  Object.assign(state, patch);
  if (Object.keys(patch).some(k => SAVED.includes(k))) saveSettings();
}

// A new pin or area makes the old answer stale; a changed assumption keeps it as the grey comparison line.
export function setPoint(which, latlon) {
  state[which] = latlon;
  state.result = null;
  state.ghost = null;
}

export function setAssumption(patch) {
  const hy = state.result?.routes.find(r => r.label === "hybrid");
  if (hy) state.ghost = hy;
  set(patch);
}

export const pointName = which => state[`${which}Name`] || (which === "origin" ? "Start" : "End");
export const difficultyOf = v => DIFFICULTY.find(d => d.v === v) || { v, name: `${v}×`, desc: "" };
