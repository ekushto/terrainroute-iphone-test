// Event wiring: every control on the page and on the map, mapped to an action or a state change.
import { parseLatLon } from "../engine/compute.js";
import { renameArea } from "../store/areas.js";
import { deleteRoute, listRoutes, saveRoute } from "../store/routes.js";
import * as actions from "./actions.js";
import { applySheet, render, renderAreaList, setTab, toast, updatePreview } from "./main.js";
import * as mapui from "./map.js";
import { scrubProfile } from "./route-panel.js";
import { set, setAssumption, setPoint, state } from "./state.js";
import { renderSettings } from "./lists.js";

const $ = id => document.getElementById(id);
const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
const SHEET_ORDER = ["peek", "half", "full"];

function bindMap() {
  const m = mapui.map;
  m.on("click", e => mapui.pointPopup([e.lngLat.lat, e.lngLat.lng], which => actions.placePoint(which, [e.lngLat.lat, e.lngLat.lng])));
  m.on("moveend", updatePreview);
  on("btnZoomIn", "click", () => m.zoomIn());
  on("btnZoomOut", "click", () => m.zoomOut());
  on("btnNorth", "click", () => m.easeTo({ bearing: 0, pitch: state.threeD ? m.getPitch() : 0 }));
  on("btn3d", "click", async () => {
    set({ threeD: !state.threeD });
    render();
    if (!(await mapui.set3D(state.threeD))) { set({ threeD: false }); render(); toast("3D could not be set up here; showing 2D. Zoom out and try again."); }
  });
  on("btnLocate", "click", () => locate(ll => { mapui.showMe(ll); m.flyTo({ center: [ll[1], ll[0]], zoom: Math.max(m.getZoom(), 14) }); }));
  on("search", "submit", e => {
    e.preventDefault();
    try {
      const ll = parseLatLon($("searchInput").value);
      m.flyTo({ center: [ll[1], ll[0]], zoom: Math.max(m.getZoom(), 14) });
      m.once("moveend", () => mapui.pointPopup(ll, which => actions.placePoint(which, ll)));
      $("searchInput").blur();
    } catch (err) {
      toast(err.message);
    }
  });
}

// Current position (high accuracy, 30 s), handed to onFix([lat, lon]); failures become a toast.
function locate(onFix) {
  if (!navigator.geolocation) return toast("This browser has no location service.");
  toast("Finding your location…");
  navigator.geolocation.getCurrentPosition(p => { $("toast").hidden = true; onFix([p.coords.latitude, p.coords.longitude]); },
    e => toast(`No location: ${e.message}`), { enableHighAccuracy: true, timeout: 30000, maximumAge: 10000 });
}

function bindRoute() {
  for (const b of document.querySelectorAll("[data-mode]")) b.onclick = () => { setAssumption({ mode: b.dataset.mode }); actions.calculate(); render(); };
  on("friction", "change", () => { setAssumption({ friction: Number($("friction").value) }); actions.calculate(); render(); });
  on("nameA", "change", () => { set({ originName: $("nameA").value.trim().slice(0, 40) }); render(); });
  on("nameB", "change", () => { set({ destName: $("nameB").value.trim().slice(0, 40) }); render(); });
  on("swap", "click", () => {
    const { origin, dest, originName, destName } = state;
    setPoint("origin", dest);
    setPoint("dest", origin);
    set({ originName: destName, destName: originName });
    actions.drawAll();
    actions.calculate();
    render();
  });
  on("locA", "click", () => locate(ll => { mapui.showMe(ll); actions.placePoint("origin", ll); }));
  on("btnGpx", "click", () => actions.shareBest());
  on("btnKeep", "click", () => actions.keepBest());
  on("showCompare", "change", () => { set({ compareOn: $("showCompare").checked }); mapui.applyLayers(state); });
  const scrub = e => mapui.showHover(scrubProfile(e.clientX));
  on("profile", "pointermove", scrub);
  on("profile", "pointerdown", scrub);
  on("profile", "pointerleave", () => mapui.showHover(scrubProfile(null)));
}

function bindLayers() {
  on("btnLayers", "click", () => { set({ layersOpen: !state.layersOpen }); render(); });
  on("layersClose", "click", () => { set({ layersOpen: false }); render(); });
  for (const b of document.querySelectorAll("[data-base]")) b.onclick = () => { set({ base: b.dataset.base }); mapui.applyLayers(state); render(); };
  const toggle = (id, key) => on(id, "change", () => { set({ [key]: $(id).checked }); actions.drawAll(); });
  toggle("ovSteep", "steepOn");
  toggle("ovTrails", "trailsOn");
  toggle("ovShade", "shadeOn");
  toggle("ovKept", "keptOn");
  on("steepOpacity", "input", () => { set({ steepOpacity: $("steepOpacity").value / 100 }); mapui.applyLayers(state); });
}

function bindSheet() {
  for (const b of document.querySelectorAll("[data-tab]")) b.onclick = () => setTab(b.dataset.tab);
  on("areaChip", "click", () => setTab("areas"));
  let drag = null;
  on("grabber", "pointerdown", e => { drag = { y: e.clientY, h: $("panel").offsetHeight, moved: false }; $("grabber").setPointerCapture(e.pointerId); });
  on("grabber", "pointermove", e => {
    if (!drag) return;
    drag.moved ||= Math.abs(e.clientY - drag.y) > 6;
    document.documentElement.style.setProperty("--sheet-h", `${Math.max(120, drag.h + drag.y - e.clientY)}px`);
  });
  on("grabber", "pointerup", e => {
    if (!drag) return;
    const h = drag.h + drag.y - e.clientY, pick = !drag.moved ? SHEET_ORDER[(SHEET_ORDER.indexOf(state.sheet) + 1) % 3]
      : h < innerHeight * 0.35 ? "peek" : h < innerHeight * 0.7 ? "half" : "full";
    drag = null;
    if (state.tab !== "route") set({ tab: "route" });
    set({ sheet: pick });
    render();
    applySheet();
  });
}

// Two-tap delete: the first tap arms the button for 4 s, the second deletes.
function armed(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = "1";
  const old = btn.textContent;
  btn.textContent = "Tap again to delete";
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, 4000);
  return false;
}

function bindLists() {
  on("savedList", "click", async e => {
    const btn = e.target.closest("button[data-act]");
    const k = btn && state.kept.find(r => r.id === btn.dataset.id);
    if (!k) return;
    if (btn.dataset.act === "show") await saveRoute({ ...k, visible: !k.visible });
    if (btn.dataset.act === "gpx") return actions.shareGpx(k.raw, state.areas.find(a => a.name === k.area)?.zone, k.name, [k.originName, k.destName]);
    if (btn.dataset.act === "del" && !armed(btn)) return;
    if (btn.dataset.act === "del") await deleteRoute(k.id);
    state.kept = await listRoutes();
    actions.drawAll();
    render();
  });
  on("areaList", "click", async e => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const name = btn.dataset.id, act = btn.dataset.act;
    if (act === "open") await actions.openArea(name);
    if (act === "rename") return startRename(btn, name);
    if (act === "del" && armed(btn)) await actions.removeArea(name);
    renderAreaList();
  });
}

function startRename(btn, name) {
  const box = btn.closest(".item"), input = Object.assign(document.createElement("input"), { value: state.areas.find(a => a.name === name)?.label || "", maxLength: 40, placeholder: "Area name" });
  box.querySelector(".btns").replaceChildren(input, Object.assign(document.createElement("button"), { textContent: "Save", className: "on" }));
  input.focus();
  const save = async () => { await renameArea(name, input.value); await actions.reloadLists(); set({ area: state.areas.find(a => a.name === name) || state.area }); render(); renderAreaList(); };
  box.querySelector(".btns button").onclick = save;
  input.onkeydown = ev => { if (ev.key === "Enter") save(); };
}

function bindAreas() {
  for (const b of document.querySelectorAll("[data-size]")) b.onclick = () => { set({ prepRadius: Number(b.dataset.size) }); updatePreview(); render(); };
  on("btnPrepare", "click", async () => {
    const c = mapui.map.getCenter(), msg = $("prepMsg");
    $("btnPrepare").disabled = true;
    msg.className = "msg";
    try {
      const failed = await actions.prepareHere(c.lat, c.lng, state.prepRadius, t => { msg.textContent = t; });
      msg.className = "msg ok";
      msg.textContent = failed ? `Area ready. ${failed} map tiles failed; routing still works. Download again later to fill them.` : "Area ready and available offline.";
    } catch (e) {
      msg.className = "msg bad";
      msg.textContent = `Download failed: ${e.message}`;
    }
    $("btnPrepare").disabled = false;
    renderAreaList();
  });
  for (const b of document.querySelectorAll("[data-units]")) b.onclick = () => { set({ units: b.dataset.units }); mapui.scale.setUnit(b.dataset.units === "metric" ? "metric" : "imperial"); render(); renderSettings(); };
  on("btnPersist", "click", async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? "The browser agreed to keep your data." : "The browser declined. On iPhone, add TerrainRoute to the Home Screen and try again."); renderSettings(); });
}

function bindBackup() {
  const msg = (text, kind = "") => { $("backupMsg").textContent = text; $("backupMsg").className = `msg ${kind}`; };
  on("btnBackup", "click", async () => {
    try {
      const r = await actions.exportBackup(msg);
      msg(`Backup saved: ${r.areas} areas, ${r.tiles} map tiles, ${r.mb} MB.`, "ok");
    } catch (e) {
      msg(`Backup failed: ${e.message}`, "bad");
    }
  });
  on("importFile", "change", async () => {
    const file = $("importFile").files[0];
    $("importFile").value = "";
    if (!file) return;
    try {
      msg("Reading backup…");
      const r = await actions.importBackup(file, msg);
      msg(`Restored ${r.areas} areas, ${r.tiles} map tiles and ${r.routes} kept routes.`, "ok");
      renderAreaList();
    } catch (e) {
      msg(`Import failed: ${e.message}`, "bad");
    }
  });
}

export function bindEvents() {
  bindBackup();
  bindMap();
  bindRoute();
  bindLayers();
  bindSheet();
  bindLists();
  bindAreas();
}
