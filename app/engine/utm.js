// WGS84 <-> UTM (northern hemisphere) by the Krüger series (Karney 2011 coefficients). Sub-millimetre within a
// zone; checked against pyproj. Lon/lat in degrees, easting/northing in metres. NAD83 is treated as WGS84, as
// pyproj does for these areas without a datum grid.
const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, E0 = 500000;
const n = f / (2 - f), A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
const al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
const be = [n / 2 - 2 * n * n / 3 + 37 * n ** 3 / 96, n * n / 48 + n ** 3 / 15, 17 * n ** 3 / 480];
const de = [2 * n - 2 * n * n / 3 - 2 * n ** 3, 7 * n * n / 3 - 8 * n ** 3 / 5, 56 * n ** 3 / 15];
const rad = Math.PI / 180;

export function forward(lon, lat, zone) {
  const lam0 = ((zone - 1) * 6 - 180 + 3) * rad, phi = lat * rad, lam = lon * rad - lam0;
  const s = 2 * Math.sqrt(n) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - s * Math.atanh(s * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  for (let j = 1; j <= 3; j++) {
    E += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    N += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return [E0 + k0 * A * E, k0 * A * N];
}

export function inverse(E, N, zone) {
  const xi = N / (k0 * A), eta = (E - E0) / (k0 * A);
  let xp = xi, ep = eta;
  for (let j = 1; j <= 3; j++) {
    xp -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    ep -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += de[j - 1] * Math.sin(2 * j * chi);
  const lam0 = ((zone - 1) * 6 - 180 + 3) * rad;
  return [(lam0 + Math.atan2(Math.sinh(ep), Math.cos(xp))) / rad, phi / rad];
}

export const zoneOf = lon => Math.floor((lon + 180) / 6) + 1;
