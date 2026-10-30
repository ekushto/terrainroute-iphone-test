// Python/numpy-identical numerics, so the JavaScript engine reproduces the Python engine bit for bit where it matters:
// rounding at the exact binary value (Python round/format), numpy's x*10^d rounding, pairwise sums and linspace.

// Decimal string of x rounded to d places like Python's f"{x:.{d}f}": round-half-even on the EXACT binary value.
export function pyFixed(x, d) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const [ip, fp] = Math.abs(x).toFixed(100).split(".");  // toFixed(100) is the exact expansion for |x| > 1e-40
  let digits = ip + fp.slice(0, d);
  const rest = fp.slice(d);
  const half = "5".padEnd(rest.length, "0");
  const up = rest > half || (rest === half && Number(digits.at(-1)) % 2 === 1);
  if (up) digits = increment(digits);
  const whole = digits.slice(0, digits.length - d) || "0";
  const out = d > 0 ? `${whole}.${digits.slice(digits.length - d)}` : whole;
  return (x < 0 || Object.is(x, -0) ? "-" : "") + out;
}

function increment(s) {
  const a = s.split("");
  let i = a.length - 1;
  while (i >= 0 && a[i] === "9") a[i--] = "0";
  return i < 0 ? "1" + a.join("") : (a[i] = String(Number(a[i]) + 1), a.join(""));
}

// Python round(x, d) (d = 0 gives Python's round(x)). Non-finite values pass through.
export const pyRound = (x, d = 0) => (Number.isFinite(x) ? Number(pyFixed(x, d)) : x);

// numpy.round(x, d): rint(x * 10^d) / 10^d with half-to-even on the scaled value (not the exact value).
export function npRound(x, d = 0) {
  const f = 10 ** d, y = x * f, r = Math.round(y);
  const even = Math.abs(y % 1) === 0.5 ? 2 * Math.round(y / 2) : r;
  return (d > 0 ? even / f : even) || even;  // keeps -0 like numpy
}

// numpy.sum of a 1-D float64 array: pairwise summation with 8 accumulators (numpy's pairwise_sum, blocksize 128).
export function npSum(a, lo = 0, n = a.length) {
  if (n < 8) {
    let res = -0.0;
    for (let i = 0; i < n; i++) res += a[lo + i];
    return n ? res : 0;
  }
  if (n <= 128) {
    const r = [];
    for (let j = 0; j < 8; j++) r.push(a[lo + j]);
    let i = 8;
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
    let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; i++) res += a[lo + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return npSum(a, lo, n2) + npSum(a, lo + n2, n - n2);
}

// numpy.cumsum (plain running sum) with a leading 0, i.e. np.concatenate([[0], np.cumsum(a)]).
export function cumsum0(a) {
  const out = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) out[i + 1] = out[i] + a[i];
  return out;
}

// numpy.linspace(p, q, n) for 2-D points p, q: i*step + start, last point exactly q; numpy switches to
// (i/div)*delta for the whole array when any component's step is 0.
export function linspace2(p, q, n) {
  const div = n - 1, dx = q[0] - p[0], dy = q[1] - p[1];
  const sx = dx / div, sy = dy / div, zero = sx === 0 || sy === 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(zero ? [(i / div) * dx + p[0], (i / div) * dy + p[1]] : [i * sx + p[0], i * sy + p[1]]);
  }
  out[n - 1] = [q[0], q[1]];
  return out;
}

// numpy.remainder (result takes the divisor's sign).
export function npMod(a, b) {
  let m = a % b;
  if (m !== 0 && (m < 0) !== (b < 0)) m += b;
  return m;
}

export const degrees = r => r * (180 / Math.PI);
