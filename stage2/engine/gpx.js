// GPX 1.1 for onX and other apps (port of terrainroute/gpx.py to_gpx and cli.gpx_text): one track in travel order,
// named origin/destination waypoints, and Join/Leave trail waypoints away from the ends. WGS84 degrees, metres.
import { pyFixed } from "./pynum.js";
import { inverse } from "./utm.js";

const WAYPOINT_END_GAP_M = 50.0;

export class GPXError extends Error {}

const escape = s => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const eleXml = e => (Number.isFinite(e) ? `<ele>${pyFixed(e, 1)}</ele>` : "");
const wpt = ([name, lat, lon, ele]) =>
  `  <wpt lat="${pyFixed(lat, 7)}" lon="${pyFixed(lon, 7)}">${eleXml(ele)}<name>${escape(name)}</name></wpt>`;

// GPX document text. latlon: [[lat, lon]] in travel order; ele: metres per point; waypoints: [name, lat, lon, ele].
// Throws GPXError on fewer than two points or out-of-range coordinates.
export function toGpx(name, latlon, ele, waypoints, now = new Date()) {
  if (latlon.length < 2) throw new GPXError("a track needs at least two points");
  if (!latlon.every(([la, lo]) => Math.abs(la) <= 90 && Math.abs(lo) <= 180)) {
    throw new GPXError("track has out-of-range coordinates (expected [lat, lon] degrees)");
  }
  if (ele.length !== latlon.length) throw new GPXError("need one elevation per track point");
  const time = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="TerrainRoute PoC" xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    `  <metadata><name>${escape(name)}</name><desc>Computed route, not a verified path. ` +
      `Terrain/downfall may make it impassable.</desc><time>${time}</time></metadata>`,
    ...waypoints.map(wpt),
    `  <trk><name>${escape(name)}</name><trkseg>`,
    ...latlon.map(([la, lo], i) => `    <trkpt lat="${pyFixed(la, 7)}" lon="${pyFixed(lo, 7)}">${eleXml(ele[i])}</trkpt>`),
    "  </trkseg></trk>", "</gpx>", "",
  ];
  return lines.join("\n");
}

// GPX for a route in UTM zone `zone`: track + named ends + Join/Leave trail waypoints (not within 50 m of an end).
export function routeGpx(rt, zone, name, originName = "Origin", destName = "Destination", now = new Date()) {
  const latlon = rt.xy.map(([x, y]) => { const [lon, lat] = inverse(x, y, zone); return [lat, lon]; });
  const at = k => [latlon[k][0], latlon[k][1], rt.z[k]];
  const wpts = [[originName, ...at(0)], [destName, ...at(latlon.length - 1)]];
  const ends = [rt.xy[0], rt.xy.at(-1)];
  for (let k = 1; k < rt.onTrail.length; k++) {
    if (rt.onTrail[k] === rt.onTrail[k - 1]) continue;
    if (Math.min(...ends.map(e => Math.hypot(e[0] - rt.xy[k][0], e[1] - rt.xy[k][1]))) < WAYPOINT_END_GAP_M) continue;
    wpts.push([rt.onTrail[k] ? "Join trail" : "Leave trail", ...at(k)]);
  }
  return toGpx(name, latlon, rt.z, wpts, now);
}
