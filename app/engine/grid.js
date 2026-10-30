// Metric DEM grid (port of terrainroute/graph.py Grid). Row 0 = north; cell centres at (c + 0.5, r + 0.5) cells.
import { degrees } from "./pynum.js";

export class Grid {
  // dem: Float64Array rows*cols in metres, NaN = no data. xmin/ymax: UTM metres of the top-left corner.
  constructor(dem, rows, cols, xmin, ymax, cell) {
    if (dem.length !== rows * cols) throw new Error(`DEM has ${dem.length} values, expected ${rows}x${cols}`);
    Object.assign(this, { dem, rows, cols, xmin, ymax, cell });
    this._tan = null;
    this._tan99 = null;
  }

  rcToXy(r, c) {
    return [this.xmin + (c + 0.5) * this.cell, this.ymax - (r + 0.5) * this.cell];
  }

  // Containing cell [row, col]; may be out of bounds (check with inBounds).
  xyToRc(x, y) {
    return [Math.floor((this.ymax - y) / this.cell), Math.floor((x - this.xmin) / this.cell)];
  }

  inBounds(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  // DEM value at UTM (x, y), bilinear between cell centres; edge cells clamp. NaN if a corner has no data.
  bilinear(x, y) {
    const fc = (x - this.xmin) / this.cell - 0.5, fr = (this.ymax - y) / this.cell - 0.5;
    const c0 = Math.min(Math.max(Math.floor(fc), 0), this.cols - 2);
    const r0 = Math.min(Math.max(Math.floor(fr), 0), this.rows - 2);
    const tc = Math.min(Math.max(fc - c0, 0), 1), tr = Math.min(Math.max(fr - r0, 0), 1);
    const d = this.dem, i = r0 * this.cols + c0;
    const top = d[i] * (1 - tc) + d[i + 1] * tc;
    const bot = d[i + this.cols] * (1 - tc) + d[i + this.cols + 1] * tc;
    return top * (1 - tr) + bot * tr;
  }

  // tan(terrain slope) per cell like numpy.gradient (central inside, one-sided at edges); NaN next to missing data.
  tanSlope() {
    if (this._tan) return this._tan;
    const { dem, rows, cols, cell } = this, t = new Float64Array(rows * cols);
    const at = (r, c) => dem[r * cols + c];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const gx = c === 0 ? (at(r, 1) - at(r, 0)) / cell : c === cols - 1 ? (at(r, c) - at(r, c - 1)) / cell
          : (at(r, c + 1) - at(r, c - 1)) / (2.0 * cell);
        const gy = r === 0 ? (at(1, c) - at(0, c)) / cell : r === rows - 1 ? (at(r, c) - at(r - 1, c)) / cell
          : (at(r + 1, c) - at(r - 1, c)) / (2.0 * cell);
        t[r * cols + c] = Math.hypot(gx, gy);
      }
    }
    return (this._tan = t);
  }

  // tanSlope() with missing values set to 99 (impassable), like Python's np.nan_to_num(tan, nan=99).
  tanSlopeFilled() {
    if (this._tan99) return this._tan99;
    const t = Float64Array.from(this.tanSlope(), v => (Number.isNaN(v) ? 99 : v));
    return (this._tan99 = t);
  }

  // 1 where off-trail travel is allowed: elevation known and terrain slope <= maxDeg degrees.
  passable(maxDeg) {
    const tan = this.tanSlopeFilled(), ok = new Uint8Array(tan.length);
    for (let i = 0; i < ok.length; i++) ok[i] = !Number.isNaN(this.dem[i]) && degrees(Math.atan(tan[i])) <= maxDeg ? 1 : 0;
    return ok;
  }
}
