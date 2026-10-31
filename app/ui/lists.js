// The Saved, Areas and Settings tabs. Lists are rebuilt from state on every change; button clicks are handled by one
// delegated listener per list in main.js (data-act + data-id), so nothing here keeps stale closures.
import { inscribedBounds } from "../prepare/box.js";
import { areaTileUrls, storageFacts } from "../store/areas.js";
import { state } from "./state.js";
import { dist, distUnit, effort, height, heightUnit } from "./units.js";

const $ = id => document.getElementById(id);

function item(html) {
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = html;
  return div;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const areaLabel = a => a.label || (a.name === "local" ? "Area" : a.name.startsWith("local_") ? "Unnamed area" : a.name);

export function renderSaved() {
  const here = state.kept.filter(k => !state.area || k.area === state.area.name);
  const list = $("savedList");
  if (!here.length) {
    list.innerHTML = '<p class="empty">No kept routes in this area yet. Calculate a route and tap Keep.</p>';
    return;
  }
  list.replaceChildren(...here.map(k => {
    const m = k.metrics, eff = effort(m.effort_flat_km);
    const el = item(`<div class="top"><span class="bar" style="background:${esc(k.color)}"></span><div><div class="name"></div>
      <div class="sub">${dist(m.distance_m)} ${distUnit()} · ${height(m.ascent_m)} ${heightUnit()} up · effort ${eff} · ${esc(k.mode)}</div></div></div>
      <div class="btns"><button data-act="show" data-id="${esc(k.id)}" class="${k.visible ? "on" : ""}">${k.visible ? "On map" : "Hidden"}</button>
      <button data-act="gpx" data-id="${esc(k.id)}">Share GPX</button><button data-act="del" data-id="${esc(k.id)}" class="danger">Delete</button></div>`);
    el.querySelector(".name").textContent = k.name;
    return el;
  }));
}

// Saved points: each can start or end a route, be renamed or deleted. The area it falls in is shown for context.
// Rebuilt only when the points change, so a rename in progress or an armed Delete survives other redraws.
export function renderPoints() {
  const list = $("pointList"), key = JSON.stringify([state.points, state.areas.map(areaLabel), state.units]);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  if (!state.points.length) {
    list.innerHTML = '<p class="empty">No saved points yet.</p>';
    return;
  }
  list.replaceChildren(...state.points.map(p => {
    const area = state.areas.find(a => { const [[s, w], [n, e]] = inscribedBounds(a); return p.lat > s && p.lat < n && p.lon > w && p.lon < e; });
    const el = item(`<div class="top"><div><div class="name"></div><div class="sub"></div></div></div>
      <div class="btns"><button data-act="start" data-id="${esc(p.id)}">Start</button><button data-act="end" data-id="${esc(p.id)}">End</button>
      <button data-act="rename" data-id="${esc(p.id)}">Rename</button><button data-act="del" data-id="${esc(p.id)}" class="danger">Delete</button></div>`);
    el.querySelector(".name").textContent = p.name;
    el.querySelector(".sub").textContent = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} · ${area ? areaLabel(area) : "outside your areas"}`;
    return el;
  }));
}

export function renderAreas(tilesPresent) {
  const list = $("areaList");
  if (!state.areas.length) {
    list.innerHTML = '<p class="empty">None yet.</p>';
    return;
  }
  list.replaceChildren(...state.areas.map(a => {
    const tiles = areaTileUrls(a).length, have = tilesPresent[a.name] ?? 0, current = state.area?.name === a.name;
    const status = have === tiles ? "Available offline" : `Map tiles ${have}/${tiles} offline (routing works)`;
    const el = item(`<div class="top"><div><div class="name"></div><div class="sub ${have === tiles && tiles ? "ok" : ""}">${esc(status)}</div>
      <div class="sub">${(a.cols * a.cell / 1000).toFixed(1)} × ${(a.rows * a.cell / 1000).toFixed(1)} km · ${a.trails.length} trails</div></div></div>
      <div class="btns"><button data-act="open" data-id="${esc(a.name)}" class="${current ? "on" : ""}">${current ? "Current" : "Show"}</button>
      ${have < tiles ? `<button data-act="tiles" data-id="${esc(a.name)}">Update map</button>` : ""}
      <button data-act="rename" data-id="${esc(a.name)}">Rename</button><button data-act="del" data-id="${esc(a.name)}" class="danger">Delete</button></div>`);
    el.querySelector(".name").textContent = areaLabel(a);
    return el;
  }));
}

export const areaBounds = a => inscribedBounds(a);

export async function renderSettings() {
  for (const b of document.querySelectorAll("[data-units]")) b.classList.toggle("on", b.dataset.units === state.units);
  const f = await storageFacts();
  $("storageFacts").textContent = `${f.usedMB ?? "?"} MB used of ${f.quotaMB ?? "?"} MB available · ` +
    (f.persisted ? "the browser has agreed to keep this data" : "the browser may clear this data if space runs low");
  $("btnPersist").hidden = !!f.persisted;
}
