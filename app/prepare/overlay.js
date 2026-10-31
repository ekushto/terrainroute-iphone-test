// Slope-angle overlay (replaces the single-colour >30° overlay of terrainroute/overlays.py). The map stretches an
// image linearly in Web Mercator while the DEM is a rotated UTM grid, so each pixel is placed in Mercator and sampled
// back from the DEM.
import { forward } from "../engine/utm.js";
import { inscribedBounds } from "./box.js";

const R = 6378137.0;  // spherical Web Mercator radius (EPSG:3857)
const PIXEL_PER_CELL = 2;  // half-cell pixels, slope interpolated between cells: smooth band edges when zoomed in
// Standard slope-angle bands (degrees, lower bound inclusive) as in CalTopo / Gaia / onX; the page sets the opacity.
export const SLOPE_BANDS = [[27, [247, 228, 99]], [30, [242, 162, 58]], [35, [217, 71, 31]], [45, [107, 33, 168]]];
const BAND_TAN = SLOPE_BANDS.map(([deg, rgb]) => [Math.tan(deg * Math.PI / 180), [...rgb, 255]]);

const toMerc = (lon, lat) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
const fromMerc = (mx, my) => [mx / R * 180 / Math.PI, (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * 180 / Math.PI];

// tan(slope) at UTM (x, y), bilinear between cell centres; NaN outside the grid or next to missing data.
function tanAt(grid, tan, x, y) {
  const fc = (x - grid.xmin) / grid.cell - 0.5, fr = (grid.ymax - y) / grid.cell - 0.5;
  if (fc < -0.5 || fr < -0.5 || fc > grid.cols - 0.5 || fr > grid.rows - 0.5) return NaN;
  const c0 = Math.min(Math.max(Math.floor(fc), 0), grid.cols - 2), r0 = Math.min(Math.max(Math.floor(fr), 0), grid.rows - 2);
  const tc = Math.min(Math.max(fc - c0, 0), 1), tr = Math.min(Math.max(fr - r0, 0), 1), i = r0 * grid.cols + c0;
  const top = tan[i] * (1 - tc) + tan[i + 1] * tc, bot = tan[i + grid.cols] * (1 - tc) + tan[i + grid.cols + 1] * tc;
  return top * (1 - tr) + bot * tr;
}

// RGBA of the slope band for tan(slope) t, or null below the first band (left transparent).
export const bandOf = t => BAND_TAN.filter(([lo]) => t >= lo).at(-1)?.[1] ?? null;

// { bounds [[s, w], [n, e]], width, height, pixels RGBA } for the area: each pixel coloured by its slope band.
export function steepOverlay(region, grid) {
  const bounds = inscribedBounds(region), [[s, w], [n, e]] = bounds;
  const [mx0, my0] = toMerc(w, s), [mx1, my1] = toMerc(e, n);
  const step = grid.cell / PIXEL_PER_CELL / Math.cos(((s + n) / 2) * Math.PI / 180);  // Mercator metres per pixel
  const width = Math.trunc((mx1 - mx0) / step), height = Math.trunc((my1 - my0) / step), tan = grid.tanSlope();
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++) {
    const my = my1 - (j + 0.5) * (my1 - my0) / height;
    for (let i = 0; i < width; i++) {
      const [lon, lat] = fromMerc(mx0 + (i + 0.5) * (mx1 - mx0) / width, my);
      const band = bandOf(tanAt(grid, tan, ...forward(lon, lat, region.zone)));
      if (band) pixels.set(band, (j * width + i) * 4);
    }
  }
  return { bounds, width, height, pixels };
}
