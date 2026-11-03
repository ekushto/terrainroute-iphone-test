// Entry point: start-up, rendering, the phone sheet, tabs, and the download-preview square. Event wiring lives in
// events.js; what the buttons do lives in actions.js.
import { boxRings, regionBox } from "../prepare/box.js";
import { tilesPresent } from "../store/areas.js";
import * as actions from "./actions.js";
import { bindEvents } from "./events.js";
import { renderAreas, renderPoints, renderSaved, renderSettings } from "./lists.js";
import * as mapui from "./map.js";
import { renderRoute } from "./route-panel.js";
import { loadSettings, set, state } from "./state.js";
import { setUnits } from "./units.js";

const $ = id => document.getElementById(id);
const wide = matchMedia("(min-width: 900px)");
// Phone sheet heights in px, smallest first. "nub" leaves only the handle above the tab bar, to show the most map.
export const SHEET = { nub: () => 26, peek: () => 236, half: () => Math.round(innerHeight * 0.5), full: () => innerHeight - 150 };
const TAB_SHEET = { route: "peek", saved: "full", areas: "half", settings: "full" };
const SIZE_NOTE = {
  4: "8 × 8 km · about 22 MB · about 6 s on Wi-Fi (measured on an iPhone)",
  2: "4 × 4 km · roughly a quarter of the full size (estimate)",
  1: "2 × 2 km · the smallest; quickest to download (estimate)",
};

let toastTimer;
export function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 6000);
}

export function render() {
  setUnits(state.units);
  mapui.scale.setUnit(state.units === "metric" ? "metric" : "imperial");
  for (const b of document.querySelectorAll("[data-tab]")) b.classList.toggle("on", b.dataset.tab === state.tab);
  for (const t of ["route", "saved", "areas", "settings"]) $(`tab-${t}`).hidden = state.tab !== t;
  $("areaChipText").textContent = state.area ? (state.area.label || "Current area") : "No area yet";
  $("areaChip").classList.toggle("ready", !!state.area);
  renderRoute();
  renderSaved();
  renderPoints();
  for (const b of document.querySelectorAll("[data-size]")) b.classList.toggle("on", Number(b.dataset.size) === state.prepRadius);
  $("sizeNote").textContent = SIZE_NOTE[state.prepRadius];
  for (const b of document.querySelectorAll("[data-base]")) b.classList.toggle("on", b.dataset.base === state.base);
  $("ovSteep").checked = state.steepOn;
  $("ovTrails").checked = state.trailsOn;
  $("ovShade").checked = state.shadeOn;
  $("ovKept").checked = state.keptOn;
  $("ovPoints").checked = state.pointsOn;
  $("steepOpacity").value = Math.round(state.steepOpacity * 100);
  $("layers").hidden = !state.layersOpen;
  $("btnLayers").setAttribute("aria-expanded", String(state.layersOpen));
  $("btn3d").setAttribute("aria-pressed", String(state.threeD));
  $("welcome").hidden = !state.welcomeOpen;
  applySheet();
}

export async function renderAreaList() {
  const counts = {};
  for (const a of state.areas) counts[a.name] = await tilesPresent(a);
  renderAreas(counts);
}

// Phone sheet height from state.sheet (opening a tab sets that tab's usual height; the handle changes it).
export function applySheet() {
  if (!wide.matches) document.documentElement.style.setProperty("--sheet-h", `${SHEET[state.sheet]()}px`);
}

export function setTab(tab) {
  set({ tab, sheet: TAB_SHEET[tab] });
  if (tab === "areas") { renderAreaList(); updatePreview(); } else mapui.drawPreview(null);
  if (tab === "settings") renderSettings();
  render();
}

// While the Areas tab is open, outline the square a download at the map centre would cover.
export function updatePreview() {
  if (state.tab !== "areas") return;
  const c = mapui.map.getCenter();
  try {
    const rings = boxRings(regionBox(c.lat, c.lng, state.prepRadius));
    mapui.drawPreview(rings.outer, rings.inner);
    $("btnPrepare").disabled = false;
  } catch (e) {
    mapui.drawPreview(null);
    $("btnPrepare").disabled = true;
    $("prepMsg").textContent = e.message;
  }
}

// Install the service worker (offline app + saved map tiles) and show which build is running.
function registerOffline() {
  if (!("serviceWorker" in navigator)) { $("version").textContent = "Offline use is not available in this browser."; return; }
  // A new build takes over in the background; reload once so the page never runs a mix of old and new files.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) location.reload(); }, { once: true });
  navigator.serviceWorker.register("sw.js").catch(e => { $("version").textContent = `Offline use failed to start: ${e.message}`; });
  navigator.serviceWorker.addEventListener("message", e => { if (e.data?.build) $("version").textContent = `Build ${e.data.build}`; });
  navigator.serviceWorker.ready.then(reg => reg.active?.postMessage("build"));
}

// The launch screen is in the page markup; lift it once the map has drawn, shown at least 0.6 s and at most 3 s (the
// cap matters offline, where the map may never report loaded). The welcome card follows on a device's first open.
async function liftSplash() {
  const minimum = new Promise(res => setTimeout(res, 600));
  const cap = new Promise(res => setTimeout(res, 3000));
  await Promise.race([Promise.all([minimum, mapui.mapReady]), cap]);
  $("splash").classList.add("gone");
  setTimeout(() => $("splash").remove(), 400);
  if (!state.welcomed) { set({ welcomeOpen: true }); render(); }
}

async function init() {
  loadSettings();
  set({ tab: "route", sheet: "nub", layersOpen: false, threeD: false });
  actions.hooks.render = render;
  actions.hooks.toast = toast;
  bindEvents();
  registerOffline();
  render();
  liftSplash();
  try {
    await actions.reloadLists();
    const start = state.areas.find(a => a.name === state.areaName) || state.areas[0];
    if (start) await actions.openArea(start.name);
    else setTab("areas");
  } catch (e) {
    toast(`Could not open your saved areas: ${e.message}`);
  }
  render();
}

wide.addEventListener("change", () => { document.documentElement.style.removeProperty("--sheet-h"); applySheet(); mapui.map.resize(); });
init();
