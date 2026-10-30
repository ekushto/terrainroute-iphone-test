// Steep-ground overlay (port of terrainroute/overlays.py). The map stretches an image linearly in Web Mercator while
// the DEM is a rotated UTM grid, so every overlay pixel is placed in Mercator and sampled back from the DEM.
import { forward } from "../engine/utm.js";
import { inscribedBounds } from "./box.js";

export const STEEP_DEG = 30.0;
const R = 6378137.0;  // spherical Web Mercator radius (EPSG:3857)
const STEEP_RGBA = [216, 38, 25, 255];  // [0.85, 0.15, 0.1, 1.0] as Python's PNG writer stores it

const toMerc = (lon, lat) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
const fromMerc = (mx, my) => [mx / R * 180 / Math.PI, (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * 180 / Math.PI];

// { bounds [[s, w], [n, e]], width, height, pixels RGBA } for the area: opaque red where the terrain under a pixel is
// steeper than STEEP_DEG, transparent elsewhere (the page sets the opacity).
export function steepOverlay(region, grid) {
  const bounds = inscribedBounds(region), [[s, w], [n, e]] = bounds;
  const [mx0, my0] = toMerc(w, s), [mx1, my1] = toMerc(e, n);
  const step = grid.cell * (1 / Math.cos(((s + n) / 2) * Math.PI / 180));  // Mercator metres per ground metre here
  const width = Math.trunc((mx1 - mx0) / step), height = Math.trunc((my1 - my0) / step);
  const tan = grid.tanSlope(), limit = Math.tan(STEEP_DEG * Math.PI / 180);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++) {
    const my = my1 - (j + 0.5) * (my1 - my0) / height;
    for (let i = 0; i < width; i++) {
      const [lon, lat] = fromMerc(mx0 + (i + 0.5) * (mx1 - mx0) / width, my);
      const [r, c] = grid.xyToRc(...forward(lon, lat, region.zone));
      if (grid.inBounds(r, c) && tan[r * grid.cols + c] > limit) pixels.set(STEEP_RGBA, (j * width + i) * 4);
    }
  }
  return { bounds, width, height, pixels };
}
