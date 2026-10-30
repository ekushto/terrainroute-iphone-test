// The area box around a point (port of prepare.region_box / auto_name and data.Region geometry). An area is a UTM
// square snapped to whole 10 m cells; "region" below is { epsg, zone, xmin, ymin, xmax, ymax, cell }.
import { pyFixed, pyRound } from "../engine/pynum.js";
import { forward, inverse, zoneOf } from "../engine/utm.js";

export const MAX_RADIUS_KM = 4.0;
export const CELL_M = 10.0;
const CONUS = { s: 24.0, n: 50.0, w: -125.0, e: -66.0 };  // 3DEP 10 m + USFS trail coverage this tool is built around

export class PrepareError extends Error {}

const pyStr = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// "local_40p00_m107p40" style name; ~1 km precision so the name itself is not a pinpoint.
export const autoName = (lat, lon) => `local_${pyFixed(lat, 2)}_${pyFixed(lon, 2)}`.replaceAll("-", "m").replaceAll(".", "p");

// UTM square of radius radiusKm around lat/lon, snapped to whole cells. Throws PrepareError outside CONUS or for a
// radius outside (0, MAX_RADIUS_KM].
export function regionBox(lat, lon, radiusKm = MAX_RADIUS_KM, cell = CELL_M) {
  if (!(lat >= CONUS.s && lat <= CONUS.n && lon >= CONUS.w && lon <= CONUS.e)) {
    throw new PrepareError(`${pyStr(lat)}, ${pyStr(lon)} is outside the continental US (USGS 3DEP / USFS coverage)`);
  }
  if (!(radiusKm > 0 && radiusKm <= MAX_RADIUS_KM)) {
    throw new PrepareError(`radius must be >0 and <= ${pyStr(MAX_RADIUS_KM)} km (got ${pyStr(radiusKm)})`);
  }
  const zone = zoneOf(lon), [x, y] = forward(lon, lat, zone), r = radiusKm * 1000;
  const snap = v => pyRound(v / cell) * cell;
  return { epsg: 26900 + zone, zone, xmin: snap(x - r), ymin: snap(y - r), xmax: snap(x + r), ymax: snap(y + r), cell };
}

export const shape = region => [pyRound((region.ymax - region.ymin) / region.cell), pyRound((region.xmax - region.xmin) / region.cell)];

// [south, west, north, east] in degrees, padded 0.002 deg to fully cover the UTM box (for trail queries).
export function latlonBbox(region) {
  const corners = [[region.xmin, region.ymin], [region.xmax, region.ymin], [region.xmin, region.ymax], [region.xmax, region.ymax]]
    .map(([x, y]) => inverse(x, y, region.zone));
  const lons = corners.map(c => c[0]), lats = corners.map(c => c[1]);
  return [Math.min(...lats) - 0.002, Math.min(...lons) - 0.002, Math.max(...lats) + 0.002, Math.max(...lons) + 0.002];
}

// [[south, west], [north, east]]: the largest lat/lon box fully inside the (rotated) UTM box; the routable area.
export function inscribedBounds(region) {
  const [nw, ne, sw, se] = [[region.xmin, region.ymax], [region.xmax, region.ymax], [region.xmin, region.ymin],
    [region.xmax, region.ymin]].map(([x, y]) => inverse(x, y, region.zone));
  return [[Math.max(sw[1], se[1]), Math.max(nw[0], sw[0])], [Math.min(nw[1], ne[1]), Math.min(ne[0], se[0])]];
}
