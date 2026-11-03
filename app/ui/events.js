// Event wiring: every control on the page and on the map, mapped to an action or a state change.
import { parseLatLon } from "../engine/compute.js";
import { renameArea } from "../store/areas.js";
import { deleteRoute, listRoutes, saveRoute } from "../store/routes.js";
import * as actions from "./actions.js";
import { SHEET, applySheet, render, renderAreaList, setTab, toast, updatePreview } from "./main.js";
import * as mapui from "./map.js";
import { scrubProfile } from "./route-panel.js";
import { pointName, set, setAssumption, setPoint, state } from "./state.js";
import { renderSettings } from "./lists.js";

const $ = id => document.getElementById(id);
const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

function bindMap() {
  const m = mapui.map;
  const popupAt = ll => mapui.pointPopup(ll, which => actions.placePoint(which, ll), { onSave: name => actions.addPoint(name, ll) });
  m.on("click", e => { const label = mapui.routeAt(e.point); if (label) actions.selectRoute(label); });
  m.on("contextmenu", e => { e.preventDefault(); popupAt([e.lngLat.lat, e.lngLat.lng]); });
  bindLongPress(m, popupAt);
  m.on("rotate", () => { $("btnNorth").firstElementChild.style.transform = `rotate(${-m.getBearing()}deg)`; });
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
  const goTo = ll => {
    m.flyTo({ center: [ll[1], ll[0]], zoom: Math.max(m.getZoom(), 14) });
    m.once("moveend", () => popupAt(ll));
    $("searchInput").blur();
  };
  on("search", "submit", e => {
    e.preventDefault();
    try {
      goTo(parseLatLon($("searchInput").value));
    } catch (err) {
      toast(err.message);
    }
  });
  pasteOnTap($("searchInput"), goTo);
}

// On a phone, tapping a "Paste lat, lon" box pastes the clipboard instead of raising the keyboard. If the clipboard
// holds no coordinates (or can't be read), the box unlocks so a second tap types them by hand.
function pasteOnTap(input, apply) {
  if (!matchMedia("(pointer: coarse)").matches) return;
  input.readOnly = true;
  input.addEventListener("blur", () => { input.readOnly = true; });
  input.addEventListener("click", async () => {
    if (!input.readOnly) return;
    input.blur();
    let text = "";
    try {
      text = (await navigator.clipboard.readText()).trim();
      const ll = parseLatLon(text);
      input.value = `${ll[0]}, ${ll[1]}`;
      apply(ll);
    } catch {
      input.readOnly = false;
      toast(text ? "The clipboard doesn't hold 'lat, lon' coordinates. Tap the box again to type them." : "Nothing to paste. Copy coordinates first, or tap the box again to type them.");
    }
  });
}

// Phones have no right-click: a 550 ms press without moving opens the Start/End popup.
function bindLongPress(m, popupAt) {
  let timer = null, start = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  m.on("touchstart", e => {
    cancel();
    if (e.points.length !== 1) return;
    start = e.point;
    timer = setTimeout(() => popupAt([e.lngLat.lat, e.lngLat.lng]), 550);
  });
  m.on("touchmove", e => { if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 10) cancel(); });
  m.on("touchend", cancel);
  m.on("touchcancel", cancel);
  m.on("movestart", cancel);
}

// Current position (high accuracy, 30 s), handed to onFix([lat, lon]); failures become a toast.
function locate(onFix) {
  if (!navigator.geolocation) return toast("This browser has no location service.");
  toast("Finding your location…");
  navigator.geolocation.getCurrentPosition(p => { $("toast").hidden = true; onFix([p.coords.latitude, p.coords.longitude]); },
    e => toast(`No location: ${e.message}`), { enableHighAccuracy: true, timeout: 30000, maximumAge: 10000 });
}

// Bring a point into view (only if it is off-screen) before a pin goes there.
function showOnMap(ll) {
  if (!mapui.map.getBounds().contains([ll[1], ll[0]])) mapui.map.flyTo({ center: [ll[1], ll[0]], zoom: Math.max(mapui.map.getZoom(), 13) });
}

function bindRoute() {
  for (const b of document.querySelectorAll("[data-mode]")) b.onclick = () => { setAssumption({ mode: b.dataset.mode }); actions.calculate(); render(); };
  on("friction", "change", () => { setAssumption({ friction: Number($("friction").value) }); actions.calculate(); render(); });
  on("nameA", "change", () => { set({ originName: $("nameA").value.trim().slice(0, 40) }); actions.drawAll(); render(); });
  on("nameB", "change", () => { set({ destName: $("nameB").value.trim().slice(0, 40) }); actions.drawAll(); render(); });
  on("swap", "click", () => {
    const { origin, dest, originName, destName } = state;
    setPoint("origin", dest);
    setPoint("dest", origin);
    set({ originName: destName, destName: originName });
    actions.drawAll();
    actions.calculate();
    render();
  });
  for (const [id, which] of [["coordA", "origin"], ["coordB", "dest"]]) {
    const place = ll => { showOnMap(ll); actions.placePoint(which, ll); };
    on(id, "change", () => {
      const text = $(id).value.trim();
      if (!text) return;
      try {
        place(parseLatLon(text));
      } catch (err) {
        toast(err.message);
      }
    });
    pasteOnTap($(id), place);
  }
  for (const [id, which] of [["saveA", "origin"], ["saveB", "dest"]]) {
    on(id, "click", () => (state[which] ? actions.addPoint(state[`${which}Name`], state[which]) : toast(`Set ${pointName(which).toLowerCase()} first, then save it.`)));
  }
  for (const [id, which] of [["pickA", "origin"], ["pickB", "dest"]]) {
    on(id, "change", () => {
      const p = state.points.find(q => q.id === $(id).value);
      $(id).value = "";
      if (!p) return;
      showOnMap([p.lat, p.lon]);
      actions.placePoint(which, [p.lat, p.lon], p.name);
    });
  }
  on("routeChoices", "click", e => { const b = e.target.closest("[data-route]"); if (b) actions.selectRoute(b.dataset.route); });
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
  toggle("ovPoints", "pointsOn");
  on("steepOpacity", "input", () => { set({ steepOpacity: $("steepOpacity").value / 100 }); mapui.applyLayers(state); });
}

function bindSheet() {
  for (const b of document.querySelectorAll("[data-tab]")) b.onclick = () => setTab(b.dataset.tab);
  on("areaChip", "click", () => setTab("areas"));
  let drag = null;
  const root = document.documentElement;
  on("grabber", "pointerdown", e => {
    drag = { y: e.clientY, h: $("panel").offsetHeight, moved: false };
    root.classList.add("dragging");
    $("grabber").setPointerCapture(e.pointerId);
  });
  on("grabber", "pointermove", e => {
    if (!drag) return;
    drag.moved ||= Math.abs(e.clientY - drag.y) > 6;
    root.style.setProperty("--sheet-h", `${Math.min(innerHeight - 100, Math.max(SHEET.nub(), drag.h + drag.y - e.clientY))}px`);
  });
  const release = e => {
    if (!drag) return;
    root.classList.remove("dragging");
    set({ sheet: drag.moved ? snapSheet(drag.h, drag.h + drag.y - e.clientY) : state.sheet === "full" || state.sheet === "nub" ? "peek" : state.sheet === "peek" ? "half" : "full" });
    drag = null;
    applySheet();
  };
  on("grabber", "pointerup", release);
  on("grabber", "pointercancel", release);
}

// Where a dragged sheet settles: the nearest height in the direction it was pulled (one flick = one step), so a short
// pull down from the peek view collapses it to the nub. from / to = heights in px at the start and end of the drag.
function snapSheet(from, to) {
  const all = Object.keys(SHEET).map(k => [k, SHEET[k]()]), dir = Math.sign(to - from);
  const ahead = Math.abs(to - from) < 30 ? all : all.filter(([, h]) => (h - from) * dir > 10);
  return (ahead.length ? ahead : all).reduce((best, c) => (Math.abs(c[1] - to) < Math.abs(best[1] - to) ? c : best))[0];
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
    if (act === "tiles") return updateAreaTiles(btn, name);
    if (act === "rename") {
      return startRename(btn, state.areas.find(a => a.name === name)?.label || "", "Area name", async v => {
        await renameArea(name, v);
        await actions.reloadLists();
        set({ area: state.areas.find(a => a.name === name) || state.area });
        render();
        renderAreaList();
      });
    }
    if (act === "del") {
      if (!armed(btn)) return;  // first tap only arms the button; re-rendering now would undo that
      await actions.removeArea(name);
    }
    renderAreaList();
  });
  on("pointList", "click", e => {
    const btn = e.target.closest("button[data-act]"), p = btn && state.points.find(q => q.id === btn.dataset.id);
    if (!p) return;
    const act = btn.dataset.act;
    if (act === "start" || act === "end") {
      showOnMap([p.lat, p.lon]);
      return actions.placePoint(act === "start" ? "origin" : "dest", [p.lat, p.lon], p.name);
    }
    if (act === "rename") {
      return startRename(btn, p.name, "Point name", v => { delete $("pointList").dataset.key; return actions.updatePoint({ ...p, name: v || p.name }); });
    }
    if (act === "del" && armed(btn)) actions.removePoint(p.id);
  });
}

// "Update map" on an area: download its missing tiles, reporting progress and the outcome under Areas.
async function updateAreaTiles(btn, name) {
  const msg = $("prepMsg");
  btn.disabled = true;
  msg.className = "msg";
  try {
    const failed = await actions.updateTiles(name, t => { msg.textContent = t; });
    msg.className = "msg ok";
    msg.textContent = failed ? `Map updated; ${failed} tiles failed. Try Update map again later.` : "Map updated and available offline.";
  } catch (e) {
    msg.className = "msg bad";
    msg.textContent = `Map update failed: ${e.message}`;
  }
  renderAreaList();
}

// Swap a list item's buttons for a name box and Save; onSave(text) does the renaming.
function startRename(btn, value, placeholder, onSave) {
  const box = btn.closest(".item"), input = Object.assign(document.createElement("input"), { value, maxLength: 40, placeholder });
  box.querySelector(".btns").replaceChildren(input, Object.assign(document.createElement("button"), { textContent: "Save", className: "on" }));
  input.focus();
  const save = () => onSave(input.value.trim());
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
  on("btnPersist", "click", async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? "The browser agreed to keep your data." : persistAdvice());
    renderSettings();
  });
  on("btnWelcome", "click", () => { set({ welcomeOpen: true }); render(); });
  on("btnWelcomeDone", "click", () => { set({ welcomeOpen: false, welcomed: true }); render(); });
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
      msg(`Restored ${r.areas} areas, ${r.tiles} map tiles, ${r.routes} kept routes and ${r.points} saved points.`, "ok");
      renderAreaList();
    } catch (e) {
      msg(`Import failed: ${e.message}`, "bad");
    }
  });
}

// Why a browser said no to keeping data, and what to do about it, per platform.
function persistAdvice() {
  const ios = /iPhone|iPad/.test(navigator.userAgent), installed = matchMedia("(display-mode: standalone)").matches;
  if (ios && !installed) return "Safari only keeps data for sites added to the Home Screen: Share → Add to Home Screen, open it from there, and try again.";
  if (ios) return "iOS declined for now. Your data stays unless the phone runs very low on space; use Back up areas to be safe.";
  return "This browser keeps data for sites you use often or install (Chrome: the install icon in the address bar; Safari: File → Add to Dock). " +
    "On a Mac it is rarely cleared anyway; use Back up areas to be safe.";
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
