// What the buttons do: open an area, place pins, route, keep, share GPX, prepare and delete areas. Each action updates
// the state and then calls render() (set by main.js); errors become a toast and never leave the app half-updated.
import { routeGpx } from "../engine/gpx.js";
import { autoName, inscribedBounds } from "../prepare/box.js";
import { prepareAround } from "../prepare/prepare.js";
import { TILE_CACHE, deleteArea, downloadTiles, getArea, listAreas, saveArea, saveTile } from "../store/areas.js";
import { packBackup, unpackBackup } from "../store/backup.js";
import { deletePoint, listPoints, newPoint, savePoint } from "../store/points.js";
import { ROUTE_COLORS, deleteRoutesOfArea, listRoutes, saveRoute } from "../store/routes.js";
import * as engine from "./engine.js";
import * as mapui from "./map.js";
import { ROUTE_NAMES, shownRoute } from "./route-panel.js";
import { pointName, set, setPoint, state } from "./state.js";

export const hooks = { render: () => {}, toast: () => {} };
const inBox = (ll, [[s, w], [n, e]]) => ll && ll[0] > s && ll[0] < n && ll[1] > w && ll[1] < e;
export const areaAt = ll => state.areas.find(a => inBox(ll, inscribedBounds(a))) || null;

export async function reloadLists() {
  state.areas = (await listAreas()).sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
  state.kept = await listRoutes();
  state.points = (await listPoints()).sort((a, b) => a.name.localeCompare(b.name));
  mapui.drawAreaOutlines(state.areas.map(inscribedBounds));
}

// Make an area current (load it into the routing worker and the map). Pins outside it are cleared.
export async function openArea(name, fit = true) {
  const rec = state.areas.find(a => a.name === name);
  if (!rec) return;
  set({ area: rec, areaName: name, result: null, ghost: null });
  for (const which of ["origin", "dest"]) if (state[which] && !inBox(state[which], inscribedBounds(rec))) setPoint(which, null);
  const layers = await engine.loadArea(rec);
  await mapui.showArea(rec, layers, inscribedBounds(rec), fit);
  drawAll();
  hooks.render();
  await calculate();
}

export function drawAll() {
  mapui.applyLayers(state);
  mapui.drawPins(state.origin, state.dest, [pointName("origin"), pointName("dest")], (which, ll) => placePoint(which, ll, state[`${which}Name`]));
  mapui.drawResult(state.result, state.ghost, state.shadeOn, shownRoute()?.label);
  mapui.drawKept(state.kept.filter(k => k.visible && k.area === state.area?.name));
  mapui.drawPoints(state.pointsOn ? state.points : [], (p, which) => placePoint(which, [p.lat, p.lon], p.name));
}

// Put the start or end pin at [lat, lon], named `name` (a new spot starts unnamed; dragging a pin keeps its name).
// A point in another area switches to that area.
export async function placePoint(which, ll, name = "") {
  const target = areaAt(ll);
  if (!target) {
    hooks.toast("That point is outside your downloaded areas. Download an area there first (Areas tab).");
    drawAll();
    return;
  }
  setPoint(which, ll);
  set({ [`${which}Name`]: name });
  if (target.name !== state.area?.name) return openArea(target.name, false);
  drawAll();
  hooks.render();
  await calculate();
}

// Route between the pins when both are set. A newer request makes an older answer stale; it is then dropped.
export async function calculate() {
  if (!state.area || !state.origin || !state.dest) return;
  const seq = ++state.seq;
  set({ busy: true });
  hooks.render();
  try {
    const result = await engine.route({ area: state.area.name, a: state.origin, b: state.dest, mode: state.mode, friction: state.friction });
    if (seq !== state.seq) return;
    set({ result });
  } catch (e) {
    if (seq !== state.seq) return;
    set({ result: null });
    hooks.toast(e.kind === "RouteError" || e.kind === "InputError" ? e.message : `Routing failed: ${e.message}`);
  } finally {
    if (seq === state.seq) set({ busy: false });
  }
  drawAll();
  hooks.render();
}

const slug = s => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "route";

// Hand a file to the iPhone share sheet, or download it on the Mac.
async function shareFile(file, title) {
  if (navigator.canShare?.({ files: [file] }) && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ files: [file], title });
    } catch (e) {
      if (e.name !== "AbortError") hooks.toast(`Sharing failed: ${e.message}`);
    }
    return;
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// Share or download a route as GPX. raw = { xy, z, onTrail } in UTM zone `zone`.
export function shareGpx(raw, zone, title, names = [pointName("origin"), pointName("dest")]) {
  const xml = routeGpx(raw, zone, title, ...names);
  return shareFile(new File([xml], `${slug(title)}.gpx`, { type: "application/gpx+xml" }), title);
}

// Show another computed route (best / off-trail only / straight line) in the panel and on the map.
export function selectRoute(label) {
  if (!state.result?.routes.some(r => r.label === label)) return;
  state.selected = label;
  drawAll();
  hooks.render();
}

export function shareBest() {
  const best = shownRoute();
  const kind = best?.label === "hybrid" ? "" : `, ${ROUTE_NAMES[best?.label]?.toLowerCase()}`;
  if (best) return shareGpx(best.raw, state.area.zone, `${pointName("origin")} to ${pointName("dest")} (${state.mode}${kind})`);
}

export async function keepBest() {
  const best = shownRoute();
  if (!best) return;
  const color = ROUTE_COLORS[state.kept.filter(k => k.area === state.area.name).length % ROUTE_COLORS.length];
  await saveRoute({ id: `${Date.now()}`, area: state.area.name, name: `${pointName("origin")} → ${pointName("dest")}` + (best.label === "hybrid" ? "" : ` (${ROUTE_NAMES[best.label].toLowerCase()})`), color,
    mode: state.mode, friction: state.friction, metrics: best.metrics, latlon: best.latlon, raw: best.raw,
    originName: pointName("origin"), destName: pointName("dest"), visible: true, createdAt: new Date().toISOString() });
  state.kept = await listRoutes();
  drawAll();
  hooks.render();
  hooks.toast("Kept. It stays on the map; manage it under Saved.");
}

// Add, change or delete saved points, then show the result everywhere; storage failures become a toast.
async function changePoints(op, message) {
  try {
    await op();
  } catch (e) {
    return hooks.toast(`Saved points: ${e.message}`);
  }
  await reloadLists();
  drawAll();
  hooks.render();
  if (message) hooks.toast(message);
}

export const addPoint = (name, ll) => changePoints(() => savePoint(newPoint(name, ll)), "Point saved. Pick it under A or B, or tap it on the map.");
export const updatePoint = rec => changePoints(() => savePoint(rec));
export const removePoint = id => changePoints(() => deletePoint(id));

// Download a new area around lat/lon (elevation, trails, then offline map tiles). progress(text) reports each step.
export async function prepareHere(lat, lon, radiusKm, progress) {
  if (await getArea(autoName(lat, lon))) throw new Error("You already have an area centred here. Move the map a little to make a new one.");
  const rec = await prepareAround(lat, lon, radiusKm, { onProgress: progress });
  await saveArea(rec);
  const tiles = await downloadTiles(rec, { onProgress: (kind, d, n) => progress(`Saving ${kind === "topo" ? "Topo" : "Imagery"} map for offline use… ${d}/${n}`) });
  await reloadLists();
  await openArea(rec.name);
  return tiles.topo.failed + tiles.imagery.failed;
}

// Delete an area, its offline tiles (unless another area shares them) and its kept routes.
export async function removeArea(name) {
  await deleteArea(name);
  await deleteRoutesOfArea(name);
  if (state.area?.name === name) set({ area: null, areaName: null, origin: null, dest: null, result: null, ghost: null });
  await reloadLists();
  if (!state.area && state.areas.length) await openArea(state.areas[0].name);
  if (!state.area) mapui.clearArea();
  drawAll();
  hooks.render();
}

// Save every area, its offline tiles, kept routes and saved points as one .trarea file (Files on iPhone, Downloads on the Mac).
export async function exportBackup(progress) {
  const areas = await listAreas(), cache = await caches.open(TILE_CACHE), tiles = new Map();
  for (const a of areas) {
    for (const url of a.tileUrls || []) {
      if (tiles.has(url)) continue;
      const hit = await cache.match(url);
      if (hit) tiles.set(url, await hit.blob());
    }
    progress(`Collecting ${tiles.size} map tiles…`);
  }
  const blob = packBackup(areas, tiles, await listRoutes(), await listPoints());
  const name = `TerrainRoute-backup-${new Date().toISOString().slice(0, 10)}.trarea`;
  await shareFile(new File([blob], name, { type: "application/octet-stream" }), "TerrainRoute backup");
  return { areas: areas.length, tiles: tiles.size, mb: Math.round(blob.size / 1e5) / 10 };
}

// Restore a backup file: areas, kept routes and saved points are added (an area with the same name is replaced) and tiles cached.
export async function importBackup(file, progress) {
  const data = unpackBackup(await file.arrayBuffer());
  for (const a of data.areas) await saveArea(a);
  let n = 0;
  for (const t of data.tiles) {
    await saveTile(t.url, t.blob);
    if (++n % 100 === 0) progress(`Restoring map tiles… ${n}/${data.tiles.length}`);
  }
  for (const r of data.routes) await saveRoute(r);
  for (const p of data.points) await savePoint(p);
  await reloadLists();
  if (!state.area && state.areas.length) await openArea(state.areas[0].name);
  drawAll();
  hooks.render();
  return { areas: data.areas.length, tiles: data.tiles.length, routes: data.routes.length, points: data.points.length };
}
