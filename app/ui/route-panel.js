// The Route tab: empty-state guidance, the headline numbers, profile, difficulty details, comparison and warnings.
import { buckets, drawProfile, profileStats } from "./profile.js";
import { DIFFICULTY, MODE_HINT, difficultyOf, pointName, state } from "./state.js";
import { dist, distUnit, effort, height, heightUnit } from "./units.js";

const $ = id => document.getElementById(id);
let scrub = () => null;

export const bestRoute = result => result?.routes.find(r => r.label === "hybrid") || result?.routes.find(r => r.label === "off-trail only") || null;

function emptyText() {
  if (!state.areas.length) return "No area on this device yet. Open Areas, move the map over your ground, and tap Download this area.";
  if (!state.area) return "Pick an area: tap one of the outlined squares on the map, or choose it under Areas.";
  if (!state.origin) return "Tap the map inside the area and choose Start here.";
  if (!state.dest) return "Now tap the end point and choose End here.";
  return "";
}

// Static controls that only change with settings: difficulty choices, mode buttons, unit labels.
export function renderControls() {
  const sel = $("friction");
  if (!sel.options.length) for (const d of DIFFICULTY) sel.add(new Option(`${d.name} downfall`, d.v));
  sel.value = state.friction;
  sel.title = difficultyOf(state.friction).desc;
  for (const b of document.querySelectorAll("[data-mode]")) b.classList.toggle("on", b.dataset.mode === state.mode);
  $("modeHint").textContent = `${MODE_HINT[state.mode]} ${difficultyOf(state.friction).desc}`;
  $("nameA").value = state.originName;
  $("nameB").value = state.destName;
  for (const [id, ll] of [["coordA", state.origin], ["coordB", state.dest]]) $(id).textContent = ll ? `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}` : "Tap the map to set";
}

export function renderRoute() {
  const text = emptyText();
  $("routeEmpty").textContent = text;
  $("routeEmpty").hidden = !text;
  $("routeBody").hidden = !state.area || !state.origin;
  renderControls();
  $("routeTitle").textContent = `${pointName("origin")} → ${pointName("dest")}`;
  $("routeState").textContent = state.busy ? "Calculating…" : "";
  const best = bestRoute(state.result);
  renderSummary(best);
  renderProfile(best);
  renderDetails(best);
  renderCompare(state.result);
  renderNotes(state.result);
  $("btnGpx").disabled = $("btnKeep").disabled = !best || state.busy;
}

function renderSummary(best) {
  const m = best?.metrics;
  $("sDist").textContent = m ? dist(m.distance_m) : "–";
  $("sUp").textContent = m ? height(m.ascent_m) : "–";
  $("sDown").textContent = m ? height(m.descent_m) : "–";
  $("sEffort").textContent = m ? effort(m.effort_flat_km) : "–";
  $("sDistU").textContent = distUnit();
  $("sUpU").textContent = `${heightUnit()} up`;
  $("sDownU").textContent = `${heightUnit()} down`;
  $("sEffortU").textContent = `effort ${distUnit()}`;
  $("strip").replaceChildren(...(best ? buckets(best, 24) : []).map(b => {
    const s = document.createElement("span");
    s.style.cssText = `flex: 1; background: ${b.color}`;
    return s;
  }));
}

function renderProfile(best) {
  scrub = drawProfile($("profile"), best);
  const st = best ? profileStats(best) : { start: "–", end: "–", high: "–", low: "–" };
  $("pStart").textContent = st.start;
  $("pEnd").textContent = st.end;
  $("pHigh").textContent = st.high;
  $("pLow").textContent = st.low;
  $("profileReadout").textContent = best ? "Drag along the profile" : "";
}

// Scrub the profile at a screen x (null = leave). Returns the route point under the cursor, or null.
export function scrubProfile(clientX) {
  const hit = scrub(clientX);
  if (hit) $("profileReadout").textContent = hit.text;
  return hit?.latlon || null;
}

function renderDetails(best) {
  const m = best?.metrics, d = best?.difficulty;
  const on = m ? m.distance_m * m.trail_pct / 100 : 0;
  $("dTrail").textContent = m ? `${dist(on)} ${distUnit()} (${Math.round(m.trail_pct)}%)` : "–";
  $("dOff").textContent = d ? `${dist(d.offtrail_m)} ${distUnit()}` + (d.offtrail_intensity ? ` at ${d.offtrail_intensity.toFixed(1)}× effort` : "") : "–";
  $("dHard").textContent = d?.hardest_intensity ? `${d.hardest_intensity.toFixed(1)}× at ${dist(d.hardest_from_m)}–${dist(d.hardest_to_m)} ${distUnit()}` : "–";
}

function renderCompare(result) {
  const names = { hybrid: "Best route (uses trail)", "off-trail only": "Off-trail only", "direct line": "Straight line" };
  $("cmpDistU").textContent = distUnit();
  $("cmpBody").replaceChildren(...(result?.routes || []).map(r => {
    const tr = document.createElement("tr");
    for (const v of [names[r.label] || r.label, dist(r.metrics.distance_m), effort(r.metrics.effort_flat_km)]) tr.insertCell().textContent = v;
    return tr;
  }));
}

function renderNotes(result) {
  $("notes").replaceChildren(...(result?.notes || []).map(n => {
    const li = document.createElement("li");
    li.textContent = n;
    return li;
  }));
}
