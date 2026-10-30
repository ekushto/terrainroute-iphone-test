// What the buttons do: open an area, place pins, route, keep, share GPX, prepare and delete areas. Each action updates
// the state and then calls render() (set by main.js); errors become a toast and never leave the app half-updated.
import { routeGpx } from "../engine/gpx.js";
import { autoName, inscribedBounds } from "../prepare/box.js";
import { prepareAround } from "../prepare/prepare.js";
import { TILE_CACHE, deleteArea, downloadTiles, getArea, listAreas, saveArea, saveTile } from "../store/areas.js";
import { packBackup, unpackBackup } from "../store/backup.js";
import { ROUTE_COLORS, deleteRoutesOfArea, listRoutes, saveRoute } from "../store/routes.js";
import * as engine from "./engine.js";
import * as mapui from "./map.js";
import { bestRoute } from "./route-panel.js";
import { pointName, set, setPoint, state } from "./state.js";

export const hooks = { render: () => {}, toast: () => {} };
const inBox = (ll, [[s, w], [n, e]]) => ll && ll[0] > s && ll[0] < n && ll[1] > w && ll[1] < e;
export const areaAt = ll => state.areas.find(a => inBox(ll, inscribedBounds(a))) || null;

export async function reloadLists() {
  state.areas = (await listAreas()).sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
  state.kept = await listRoutes();
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
  mapui.drawPins(state.origin, state.dest, (which, ll) => placePoint(which, ll));
  mapui.drawResult(state.result, state.ghost, state.shadeOn);
  mapui.drawKept(state.kept.filter(k => k.visible && k.area === state.area?.name));
}

// Put the start or end pin at [lat, lon]. A point in another area switches to that area.
export async function placePoint(which, ll) {
  const target = areaAt(ll);
  if (!target) {
    hooks.toast("That point is outside your downloaded areas. Download an area there first (Areas tab).");
    drawAll();
    return;
  }
  setPoint(which, ll);
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

export function shareBest() {
  const best = bestRoute(state.result);
  if (best) return shareGpx(best.raw, state.area.zone, `${pointName("origin")} to ${pointName("dest")} (${state.mode})`);
}

export async function keepBest() {
  const best = bestRoute(state.result);
  if (!best) return;
  const color = ROUTE_COLORS[state.kept.filter(k => k.area === state.area.name).length % ROUTE_COLORS.length];
  await saveRoute({ id: `${Date.now()}`, area: state.area.name, name: `${pointName("origin")} → ${pointName("dest")}`, color,
    mode: state.mode, friction: state.friction, metrics: best.metrics, latlon: best.latlon, raw: best.raw,
    originName: pointName("origin"), destName: pointName("dest"), visible: true, createdAt: new Date().toISOString() });
  state.kept = await listRoutes();
  drawAll();
  hooks.render();
  hooks.toast("Kept. It stays on the map; manage it under Saved.");
}

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

// Save every area, its offline tiles and kept routes as one .trarea file (Files on iPhone, Downloads on the Mac).
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
  const blob = packBackup(areas, tiles, await listRoutes());
  const name = `TerrainRoute-backup-${new Date().toISOString().slice(0, 10)}.trarea`;
  await shareFile(new File([blob], name, { type: "application/octet-stream" }), "TerrainRoute backup");
  return { areas: areas.length, tiles: tiles.size, mb: Math.round(blob.size / 1e5) / 10 };
}

// Restore a backup file: areas and kept routes are added (an area with the same name is replaced) and tiles cached.
export async function importBackup(file, progress) {
  const data = unpackBackup(await file.arrayBuffer());
  for (const a of data.areas) await saveArea(a);
  let n = 0;
  for (const t of data.tiles) {
    await saveTile(t.url, t.blob);
    if (++n % 100 === 0) progress(`Restoring map tiles… ${n}/${data.tiles.length}`);
  }
  for (const r of data.routes) await saveRoute(r);
  await reloadLists();
  if (!state.area && state.areas.length) await openArea(state.areas[0].name);
  drawAll();
  hooks.render();
  return { areas: data.areas.length, tiles: data.tiles.length, routes: data.routes.length };
}
