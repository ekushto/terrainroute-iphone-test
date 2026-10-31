// The Route tab: empty-state guidance, the headline numbers, profile, difficulty details, comparison and warnings.
import { buckets, drawProfile, profileStats } from "./profile.js";
import { DIFFICULTY, MODE_HINT, difficultyOf, pointName, state } from "./state.js";
import { dist, distUnit, effort, height, heightUnit } from "./units.js";

const $ = id => document.getElementById(id);
let scrub = () => null;

export const ROUTE_NAMES = { hybrid: "Best route (uses trail)", "off-trail only": "Off-trail only", "direct line": "Straight line" };
export const ROUTE_COLORS = { hybrid: "#0F5E54", "off-trail only": "#6D28D9", "direct line": "#B3261E" };

// The route the panel, profile, GPX and Keep use: the one picked under Routes, else the best available.
export function shownRoute(result = state.result) {
  const rs = result?.routes || [];
  return rs.find(r => r.label === state.selected) || rs.find(r => r.label === "hybrid") || rs.find(r => r.label === "off-trail only") || rs[0] || null;
}

function emptyText() {
  if (!state.areas.length) return "No area on this device yet. Open Areas, move the map over your ground, and tap Download this area.";
  if (!state.area) return "Pick an area: tap one of the outlined squares on the map, or choose it under Areas.";
  if (!state.origin) return "Right-click the map (long-press on a phone) and choose Start here, or paste coordinates into A.";
  if (!state.dest) return "Now set the end: right-click (long-press) the map, or paste coordinates into B.";
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
  for (const [id, ll] of [["coordA", state.origin], ["coordB", state.dest]]) {
    if (document.activeElement !== $(id)) $(id).value = ll ? `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}` : "";
  }
  for (const id of ["pickA", "pickB"]) renderPicker($(id));
}

// "Saved point…" chooser under A and B; hidden until there is a saved point. Value = point id.
function renderPicker(sel) {
  sel.hidden = !state.points.length;
  const want = ["", ...state.points.map(p => `${p.id}\t${p.name}`)].join("\n");
  if (sel.dataset.list === want) return;
  sel.dataset.list = want;
  sel.replaceChildren(new Option("Saved point…", ""), ...state.points.map(p => new Option(p.name, p.id)));
}

export function renderRoute() {
  const text = emptyText();
  $("routeEmpty").textContent = text;
  $("routeEmpty").hidden = !text;
  $("routeBody").hidden = !state.area;
  for (const el of document.querySelectorAll(".needs-result")) el.hidden = !state.result;
  renderControls();
  const best = shownRoute();
  $("routeTitle").textContent = `${pointName("origin")} → ${pointName("dest")}` + (best && best.label !== "hybrid" ? ` · ${ROUTE_NAMES[best.label]}` : "");
  $("routeState").textContent = state.busy ? "Calculating…" : "";
  renderSummary(best);
  renderProfile(best);
  renderDetails(best);
  renderChoices(state.result, best);
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

// One button per computed route (best, off-trail only, straight line); the picked one drives the whole panel.
function renderChoices(result, shown) {
  $("showCompare").checked = state.compareOn;
  const order = Object.keys(ROUTE_NAMES), routes = [...(result?.routes || [])].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  $("routeChoices").replaceChildren(...routes.map(r => {
    const b = document.createElement("button");
    b.className = `choice${r === shown ? " on" : ""}`;
    b.dataset.route = r.label;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(r === shown));
    const parts = [["i", ""], ["span", ROUTE_NAMES[r.label] || r.label], ["span", `${dist(r.metrics.distance_m)} ${distUnit()}`],
      ["span", `effort ${effort(r.metrics.effort_flat_km)}`]];
    for (const [tag, text] of parts) b.append(Object.assign(document.createElement(tag), { textContent: text }));
    b.firstChild.style.background = ROUTE_COLORS[r.label];
    return b;
  }));
}

function renderNotes(result) {
  $("notes").replaceChildren(...(result?.notes || []).map(n => {
    const li = document.createElement("li");
    li.textContent = n;
    return li;
  }));
}
