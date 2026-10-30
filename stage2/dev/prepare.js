// Stage 2 check page: prepare an area in the browser, keep it on the device, time routing. Results never include
// coordinates or area names (auto names encode the ~1 km centre).
import { buildGraphs, computeUtm, parseLatLon } from "../engine/compute.js";
import { paramsFor } from "../engine/cost.js";
import { metrics } from "../engine/measure.js";
import { autoName, inscribedBounds } from "../prepare/box.js";
import { engineArea, prepareAround } from "../prepare/prepare.js";
import { forward } from "../engine/utm.js";
import { deleteArea, downloadTiles, getArea, listAreas, saveArea, storageFacts, tilesPresent } from "../store/areas.js";

const $ = id => document.getElementById(id);
const state = { busy: false, log: [], areas: [] };
const say = (id, text, kind = "") => { $(id).textContent = text; $(id).className = `msg ${kind}`; };
const record = entry => state.log.push({ at: new Date().toISOString(), ...entry });
const areaIndex = name => state.areas.findIndex(a => a.name === name) + 1;

function setBusy(on) {
  state.busy = on;
  for (const id of ["prep", "time", "here"]) $(id).disabled = on;
}

// === PREPARE ===
async function onPrepare() {
  let lat, lon;
  try {
    [lat, lon] = parseLatLon($("center").value);
  } catch (e) {
    return say("prepMsg", e.message, "bad");
  }
  if (await getArea(autoName(lat, lon))) return say("prepMsg", "An area with this centre already exists on this device.", "bad");
  setBusy(true);
  const t0 = performance.now(), times = {};
  try {
    const rec = await prepareAround(lat, lon, Number($("radius").value), { onProgress: t => say("prepMsg", t) });
    times.dataMs = Math.round(performance.now() - t0);
    const persisted = await saveArea(rec);
    const t1 = performance.now();
    const basemaps = await downloadTiles(rec, { onProgress: (k, d, n) => say("prepMsg", `Downloading ${k} map tiles… ${d}/${n}`) });
    times.tilesMs = Math.round(performance.now() - t1);
    record({ event: "prepare", rows: rec.rows, cols: rec.cols, trails: rec.trails.length, trailSource: rec.trailSource,
      ...times, basemaps, persisted, ...(await storageFacts()) });
    const failed = basemaps.topo.failed + basemaps.imagery.failed;
    say("prepMsg", `Done in ${((performance.now() - t0) / 1000).toFixed(0)} s: ${rec.trails.length} trails (${rec.trailSource}), ` +
      `${basemaps.topo.tiles * 2 - failed}/${basemaps.topo.tiles * 2} map tiles.` + (failed ? " Some tiles failed; routing still works." : ""), "ok");
  } catch (e) {
    record({ event: "prepare failed", error: e.message, ms: Math.round(performance.now() - t0) });
    say("prepMsg", `Prepare failed: ${e.message}`, "bad");
  }
  setBusy(false);
  await renderAreas();
}

function onHere() {
  if (!navigator.geolocation) return say("prepMsg", "This browser has no location service.", "bad");
  say("prepMsg", "Finding your location…");
  navigator.geolocation.getCurrentPosition(
    p => { $("center").value = `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`; say("prepMsg", ""); },
    e => say("prepMsg", `No location: ${e.message}`, "bad"), { enableHighAccuracy: true, timeout: 30000 });
}

// === AREAS ===
async function renderAreas() {
  try {
    state.areas = await listAreas();
  } catch (e) {
    $("areas").innerHTML = "";
    return say("storage", e.message, "bad");
  }
  const box = $("areas");
  box.innerHTML = state.areas.length ? "" : '<p class="note">None yet.</p>';
  $("routeArea").innerHTML = "";
  for (const [i, a] of state.areas.entries()) {
    const div = document.createElement("div");
    div.className = "area";
    const present = await tilesPresent(a);
    div.innerHTML = `<b>${a.label || a.name}</b><br>${a.rows}×${a.cols} cells · ${a.trails.length} trails (${a.trailSource}) · ` +
      `map tiles ${present}/${(a.tileUrls || []).length} cached<br><button data-del="${a.name}" class="secondary">Delete</button>`;
    box.append(div);
    $("routeArea").append(new Option(`Area ${i + 1}: ${a.label || a.name}`, a.name));
  }
  const f = await storageFacts();
  say("storage", `Site storage: ${f.usedMB ?? "?"} MB used of ${f.quotaMB ?? "?"} MB · kept safe from clean-up: ${f.persisted ?? "unknown"}`);
}

async function onAreasClick(ev) {
  const name = ev.target.dataset?.del;
  if (!name || state.busy) return;
  setBusy(true);
  try {
    const removed = await deleteArea(name);
    record({ event: "delete", tilesRemoved: removed });
  } catch (e) {
    say("storage", e.message, "bad");
  }
  setBusy(false);
  await renderAreas();
}

// === ROUTE TIMING ===
function randomPairs(rec, n) {
  const [[s, w], [nn, e]] = inscribedBounds(rec), m = 0.004, out = [];
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const pt = () => forward(w + m + rnd() * (e - w - 2 * m), s + m + rnd() * (nn - s - 2 * m), rec.zone);
    out.push([pt(), pt()]);
  }
  return out;
}

async function onTime() {
  const rec = await getArea($("routeArea").value);
  if (!rec) return say("timeMsg", "Prepare an area first.", "bad");
  setBusy(true);
  say("timeMsg", "Routing…");
  await new Promise(r => setTimeout(r, 50));  // let the message paint before the (blocking) solve
  const body = $("timeTable").tBodies[0];
  body.innerHTML = "";
  const t0 = performance.now(), area = engineArea(rec), p = paramsFor(), graphs = buildGraphs(area, p);
  const setupMs = Math.round(performance.now() - t0), runs = [];
  for (const [i, [a, b]] of randomPairs(rec, 5).entries()) {
    const t = performance.now();
    let row;
    try {
      const res = computeUtm(area, a, b, p, graphs), hy = res.routes.find(r => r.label === "hybrid");
      row = { straightM: Math.round(res.straightM), hybridM: hy ? metrics(hy).distance_m : null,
        effortKm: hy ? metrics(hy).effort_flat_km : null, ms: Math.round(performance.now() - t) };
    } catch (e) {
      row = { error: e.message, ms: Math.round(performance.now() - t) };
    }
    runs.push(row);
    body.insertAdjacentHTML("beforeend", `<tr><td>${i + 1}</td><td>${row.straightM ?? "–"}</td><td>${row.hybridM ?? (row.error ? "error" : "unreachable")}</td><td>${row.effortKm ?? "–"}</td><td>${row.ms}</td></tr>`);
  }
  $("timeTable").hidden = false;
  record({ event: "route timing", area: areaIndex(rec.name), cells: rec.rows * rec.cols, trails: rec.trails.length, setupMs, runs });
  say("timeMsg", `Setup ${setupMs} ms (once per area), then ${runs.map(r => r.ms).join(", ")} ms per request (3 routes each).`, "ok");
  setBusy(false);
}

// === RESULTS ===
async function onCopy() {
  const text = [`TerrainRoute Stage 2 · ${navigator.userAgent}`, JSON.stringify(await storageFacts()),
    ...state.log.map(e => JSON.stringify(e))].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    say("copyMsg", "Copied. Paste it to Claude.", "ok");
  } catch (e) {
    say("copyMsg", `Copy blocked (${e.message}). Results:\n${text}`, "bad");
  }
}

// === INIT ===
$("prep").onclick = onPrepare;
$("here").onclick = onHere;
$("time").onclick = onTime;
$("copy").onclick = onCopy;
$("areas").onclick = onAreasClick;
renderAreas();
