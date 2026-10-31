// The map (MapLibre 4.7.1, vendored): USGS base maps (offline from the tile cache inside downloaded areas, online
// elsewhere when connected), 3D terrain from the current area's own elevation, overlays, pins and routes.
import * as engine from "./engine.js";
import { SHADE_STEPS } from "./shade.js";

const USGS = "https://basemap.nationalmap.gov/arcgis/rest/services";
const AWS_TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const EMPTY = { type: "FeatureCollection", features: [] };
const SHADE = ["step", ["coalesce", ["get", "i"], 99], ...SHADE_STEPS.flatMap(([c, t], k) => (k ? [t, c] : [c]))];

export const map = new maplibregl.Map({
  container: "map", center: [-107.4, 40.0], zoom: 11, maxPitch: 75, attributionControl: { compact: true },
  style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#E8E6E1" } }] },
});
export const scale = new maplibregl.ScaleControl({ unit: "imperial" });
map.addControl(scale, "bottom-left");
export const mapReady = new Promise(res => map.on("load", res));
const view = { bounds: null, markers: { origin: null, dest: null, hover: null, hardest: null, me: null, kept: [], points: [] } };

const lineOf = latlon => ({ type: "LineString", coordinates: latlon.map(([la, lo]) => [lo, la]) });
const ring = ([[s, w], [n, e]]) => ({ type: "LineString", coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] });
const feature = (geometry, properties = {}) => ({ type: "Feature", properties, geometry });

function tileTouches(z, x, y, bounds) {
  const n = 2 ** z, lon = v => v / n * 360 - 180, lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
  const [[s, w], [nn, e]] = bounds;
  return lon(x + 1) > w && lon(x) < e && lat(y) > s && lat(y + 1) < nn;
}

// 3D elevation: the current area's own DEM where the tile touches it (works offline); elsewhere AWS's free terrain
// when connected, else the area's edge values (a flat skirt) so the camera never falls off a missing tile.
maplibregl.addProtocol("trdem", async params => {
  const [z, x, y] = params.url.replace("trdem://", "").split("/").slice(1).map(Number);
  if (view.bounds && (tileTouches(z, x, y, view.bounds) || !navigator.onLine)) return { data: await engine.demTile(z, x, y) };
  const resp = await fetch(`${AWS_TERRAIN}/${z}/${x}/${y}.png`);
  if (!resp.ok) throw new Error(`elevation tile ${z}/${x}/${y}: HTTP ${resp.status}`);
  return { data: await resp.arrayBuffer() };
});

function addSources() {
  const raster = layer => ({ type: "raster", tiles: [`${USGS}/${layer}/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 16,
    attribution: "USGS The National Map" });
  map.addSource("topo", raster("USGSTopo"));
  map.addSource("imagery", raster("USGSImageryOnly"));
  map.addSource("dem", { type: "raster-dem", tiles: ["trdem://none/{z}/{x}/{y}"], encoding: "terrarium", tileSize: 256, minzoom: 8, maxzoom: 14 });
  for (const id of ["areas", "preview", "trails", "kept", "ghost", "compare", "route", "hardest", "joins"]) map.addSource(id, { type: "geojson", data: EMPTY });
}

function addLayers() {
  const line = (id, source, paint, extra = {}) => map.addLayer({ id, type: "line", source, layout: { "line-cap": "round", "line-join": "round" }, paint, ...extra });
  map.addLayer({ id: "base-topo", type: "raster", source: "topo" });
  map.addLayer({ id: "base-imagery", type: "raster", source: "imagery", layout: { visibility: "none" } });
  line("areas", "areas", { "line-color": "#0F5E54", "line-width": 1.5, "line-opacity": 0.7, "line-dasharray": [3, 2] });
  line("trails", "trails", { "line-color": "#8A5A33", "line-width": 2.4, "line-dasharray": [2.5, 1.8] });
  line("kept", "kept", { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.9 });
  line("ghost", "ghost", { "line-color": "#6B6B6B", "line-width": 4, "line-dasharray": [1.2, 1.4] });
  line("compare", "compare", { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.85, "line-dasharray": [1.5, 1.2] });
  line("hardest", "hardest", { "line-color": "#1C2127", "line-width": 16, "line-opacity": 0.22 });
  line("route-casing", "route", { "line-color": "#FFFFFF", "line-width": 10 });
  line("route", "route", { "line-color": ["case", ["get", "shade"], SHADE, "#0F5E54"], "line-width": 6 });
  map.addLayer({ id: "joins", type: "circle", source: "joins", paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": "#1C2127", "circle-stroke-width": 2 } });
  line("preview", "preview", { "line-color": "#0F5E54", "line-width": 3 }, { filter: ["!", ["get", "inner"]] });
  line("preview-inner", "preview", { "line-color": "#0F5E54", "line-width": 1.5, "line-dasharray": [3, 2] }, { filter: ["get", "inner"] });
}

mapReady.then(() => { addSources(); addLayers(); });

// Show the current area: trails, the steep overlay (an image placed on its Web Mercator bounds), 3D elevation from its
// own grid, and fly there. `bounds` = the area's inscribed lat/lon box.
export async function showArea(rec, layers, bounds, fit = true) {
  await mapReady;
  view.bounds = bounds;
  map.getSource("trails").setData(layers.trails);
  if (map.getLayer("steep")) map.removeLayer("steep");
  if (map.getSource("steep")) map.removeSource("steep");
  const [[ss, sw], [sn, se]] = layers.steep.bounds;
  const url = URL.createObjectURL(new Blob([layers.steep.png], { type: "image/png" }));
  map.addSource("steep", { type: "image", url, coordinates: [[sw, sn], [se, sn], [se, ss], [sw, ss]] });
  map.addLayer({ id: "steep", type: "raster", source: "steep", paint: { "raster-opacity": 0.6 } }, "areas");
  map.getSource("dem").setTiles([`trdem://${rec.name}/{z}/{x}/{y}`]);  // new URL = no stale tiles from another area
  const [[s, w], [n, e]] = bounds;
  if (fit) map.fitBounds([[w, s], [e, n]], { padding: 30, duration: 0, bearing: map.getBearing() });
}

export async function drawAreaOutlines(boundsList) {
  await mapReady;
  map.getSource("areas").setData({ type: "FeatureCollection", features: boundsList.map(b => feature(ring(b))) });
}

// The square a download would cover (outer) and the reliable inner part, as [lon, lat] rings; null clears.
export async function drawPreview(outer, inner) {
  await mapReady;
  const line = (coords, isInner) => feature({ type: "LineString", coordinates: coords }, { inner: isInner });
  map.getSource("preview").setData(outer ? { type: "FeatureCollection", features: [line(outer, false), line(inner, true)] } : EMPTY);
}

// Layer visibility and look from the state: base map, overlays and route shading.
export function applyLayers(s) {
  if (!map.getLayer("route")) return;
  const vis = on => (on ? "visible" : "none");
  map.setLayoutProperty("base-topo", "visibility", vis(s.base !== "imagery"));
  map.setLayoutProperty("base-imagery", "visibility", vis(s.base !== "topo"));
  map.setPaintProperty("base-imagery", "raster-opacity", s.base === "both" ? 0.45 : 1);
  if (map.getLayer("steep")) {
    map.setLayoutProperty("steep", "visibility", vis(s.steepOn));
    map.setPaintProperty("steep", "raster-opacity", s.steepOpacity);
  }
  map.setLayoutProperty("trails", "visibility", vis(s.trailsOn));
  map.setLayoutProperty("kept", "visibility", vis(s.keptOn));
  map.setLayoutProperty("compare", "visibility", vis(s.compareOn));
}

export const terrainActive = () => !!map.getTerrain?.();

function marker(cls, text, opts = {}) {
  const el = document.createElement("div");
  el.className = cls;
  if (text) el.textContent = text;
  return new maplibregl.Marker({ element: el, ...opts });
}

// Start (A) and end (B) pins with their names beside them; draggable, calling onDrag(which, [lat, lon]) when dropped.
export function drawPins(origin, dest, names, onDrag) {
  for (const [k, which, ll, cls, letter] of [[0, "origin", origin, "a", "A"], [1, "dest", dest, "b", "B"]]) {
    view.markers[which]?.remove();
    view.markers[which] = null;
    if (!ll) continue;
    const el = document.createElement("div");
    el.className = "mk-pin";
    el.innerHTML = `<span class="pin ${cls}">${letter}</span><span class="tag"></span>`;
    el.querySelector(".tag").textContent = names[k];
    const m = new maplibregl.Marker({ element: el, draggable: true, anchor: "left", offset: [-15, 0] }).setLngLat([ll[1], ll[0]]).addTo(map);
    m.on("dragend", () => { const p = m.getLngLat(); onDrag(which, [p.lat, p.lng]); });
    view.markers[which] = m;
  }
}

// The current answer: the picked route (difficulty-shaded or plain), the other routes thin and dashed (clickable to
// pick them), the grey previous route after an assumption change, trail join/leave points and the hardest 200 m.
const COLORS = { hybrid: "#0F5E54", "off-trail only": "#6D28D9", "direct line": "#B3261E" };
export function drawResult(result, ghost, shadeOn, selected) {
  if (!map.getSource("route")) return;
  const best = result?.routes.find(r => r.label === selected) || null;
  const segs = best ? best.intensity.map((i, k) => feature(lineOf([best.latlon[k], best.latlon[k + 1]]), { i, shade: shadeOn })) : [];
  map.getSource("route").setData({ type: "FeatureCollection", features: segs });
  map.getSource("ghost").setData(ghost ? feature(lineOf(ghost.latlon)) : EMPTY);
  const others = (result?.routes || []).filter(r => r !== best);
  map.getSource("compare").setData({ type: "FeatureCollection", features: others.map(r => feature(lineOf(r.latlon), { color: COLORS[r.label], label: r.label })) });
  const joins = best ? best.on_trail.flatMap((on, i) => (i > 0 && on !== best.on_trail[i - 1] ? [feature({ type: "Point", coordinates: [best.latlon[i][1], best.latlon[i][0]] })] : [])) : [];
  map.getSource("joins").setData({ type: "FeatureCollection", features: joins });
  drawHardest(best);
}

// Label of the route line under a map click (within a few pixels), or null.
export function routeAt(point) {
  if (!map.getLayer("compare") || map.getLayoutProperty("compare", "visibility") === "none") return null;
  const box = [[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]];
  return map.queryRenderedFeatures(box, { layers: ["compare"] })[0]?.properties.label || null;
}

function drawHardest(best) {
  view.markers.hardest?.remove();
  view.markers.hardest = null;
  const h = best?.difficulty;
  const idx = h && h.hardest_intensity !== null ? best.profile.d.flatMap((d, k) => (d >= h.hardest_from_m && d <= h.hardest_to_m ? [k] : [])) : [];
  map.getSource("hardest").setData(idx.length > 1 ? feature(lineOf(idx.map(k => best.latlon[k]))) : EMPTY);
  if (idx.length < 2) return;
  const mid = best.latlon[idx[Math.floor(idx.length / 2)]];
  view.markers.hardest = marker("mk-tag", `Hardest 200 m · ${h.hardest_intensity.toFixed(1)}×`, { anchor: "bottom", offset: [0, -12] })
    .setLngLat([mid[1], mid[0]]).addTo(map);
}

// Kept routes of the current area that are switched on, each labelled with its name.
export function drawKept(kept) {
  if (!map.getSource("kept")) return;
  for (const m of view.markers.kept) m.remove();
  view.markers.kept = [];
  map.getSource("kept").setData({ type: "FeatureCollection", features: kept.map(k => feature(lineOf(k.latlon), { color: k.color })) });
  for (const k of kept) {
    const at = k.latlon[Math.floor(k.latlon.length * 0.6)], m = marker("mk-tag", k.name, { anchor: "left", offset: [10, 0] });
    m.getElement().style.borderLeft = `4px solid ${k.color}`;
    view.markers.kept.push(m.setLngLat([at[1], at[0]]).addTo(map));
  }
}

// Saved points as small labelled markers; tapping one offers Start here / End here via onPick(point, which).
export function drawPoints(points, onPick) {
  for (const m of view.markers.points) m.remove();
  view.markers.points = points.map(p => {
    const el = document.createElement("div");
    el.className = "mk-point";
    el.innerHTML = '<span class="dot"></span><span class="tag"></span>';
    el.querySelector(".tag").textContent = p.name;
    el.addEventListener("click", e => { e.stopPropagation(); pointPopup([p.lat, p.lon], which => onPick(p, which), { title: p.name }); });
    return new maplibregl.Marker({ element: el, anchor: "left", offset: [-7, 0] }).setLngLat([p.lon, p.lat]).addTo(map);
  });
}

// Marker following the elevation-profile cursor; null hides it.
export function showHover(ll) {
  if (!ll) { view.markers.hover?.remove(); view.markers.hover = null; return; }
  if (!view.markers.hover) view.markers.hover = marker("mk-hover").setLngLat([ll[1], ll[0]]).addTo(map);
  else view.markers.hover.setLngLat([ll[1], ll[0]]);
}

export function showMe(ll) {
  view.markers.me?.remove();
  view.markers.me = ll ? marker("mk-me").setLngLat([ll[1], ll[0]]).addTo(map) : null;
}

// "Start here / End here" popup at a map point; onPick("origin" | "dest"). With `title` it is a saved point's popup;
// with `onSave` it also offers "Save point", which asks for a name and calls onSave(name).
export function pointPopup(ll, onPick, { title = "", onSave = null } = {}) {
  const el = document.createElement("div");
  el.className = "pop";
  el.innerHTML = '<b class="title"></b><div class="where"></div><div class="btns"><button class="sa">Start here</button><button class="sb">End here</button></div>' +
    '<button class="sp">Save point</button><form class="save" hidden><input maxlength="40" placeholder="Name, e.g. Camp" aria-label="Point name"><button>Save</button></form>';
  el.querySelector(".title").textContent = title;
  el.querySelector(".title").hidden = !title;
  el.querySelector(".where").textContent = `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}`;
  el.querySelector(".sp").hidden = !onSave;
  const popup = new maplibregl.Popup({ closeButton: false, maxWidth: "260px" }).setLngLat([ll[1], ll[0]]).setDOMContent(el).addTo(map);
  el.querySelector(".sa").onclick = () => { popup.remove(); onPick("origin"); };
  el.querySelector(".sb").onclick = () => { popup.remove(); onPick("dest"); };
  const form = el.querySelector(".save");
  el.querySelector(".sp").onclick = () => { el.querySelector(".sp").hidden = true; form.hidden = false; form.querySelector("input").focus(); };
  form.onsubmit = e => { e.preventDefault(); popup.remove(); onSave(form.querySelector("input").value); };
  return popup;
}

// 3D camera (MapLibre 4.7.1 internals, verified earlier in this project): a plain easeTo leaves an internal "freeze
// elevation" flag set, after which a camera below the terrain renders blank. Safe sequence: go flat and high, let the
// elevation load, finish with freezeElevation, then ease to the wanted tilt. Returns false if 3D could not settle.
const SAFE_3D_ZOOM = 11.5;
const nextIdle = () => Promise.race([new Promise(res => map.once("idle", res)), new Promise(res => setTimeout(res, 3000))]);
const easeDone = opts => new Promise(res => { map.once("moveend", res); map.easeTo({ ...opts, freezeElevation: true }); });

export async function set3D(on) {
  if (!on) {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, duration: 400 });
    return true;
  }
  const want = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing() };
  map.jumpTo({ pitch: 0, zoom: Math.min(want.zoom, SAFE_3D_ZOOM) });
  map.setTerrain({ source: "dem", exaggeration: 1.5 });
  await nextIdle();
  await easeDone({ center: want.center, duration: 0 });
  await nextIdle();
  await easeDone({ center: want.center, zoom: want.zoom, bearing: want.bearing, pitch: 60, duration: 700 });
  const z = map.getZoom(), ground = Number.isFinite(z) ? map.terrain.getElevationForLngLatZoom(map.getCenter(), Math.floor(z)) : NaN;
  if (Number.isFinite(z) && Math.abs(map.transform.elevation - ground) < 50) return true;
  map.setTerrain(null);
  map.jumpTo({ center: want.center, zoom: 12, pitch: 0 });
  return false;
}

// No current area (the last one was deleted): remove its trails, overlay and 3D source tiles.
export function clearArea() {
  view.bounds = null;
  if (map.getLayer("steep")) map.removeLayer("steep");
  if (map.getSource("steep")) map.removeSource("steep");
  map.getSource("trails")?.setData(EMPTY);
  map.getSource("dem")?.setTiles(["trdem://none/{z}/{x}/{y}"]);
}
