// Backup file (.trarea): areas (elevation, trails, box), their offline map tiles and kept routes in one binary file,
// to restore after the browser's data is cleared or to move areas from the Mac to the phone without re-downloading.
// Layout: "TRAREA1\n", a little-endian uint32 header length, the JSON header, then the binary parts it points into.

const MAGIC = "TRAREA1\n";
export const BACKUP_VERSION = 1;

export class BackupError extends Error {}

// Blob of a backup. areas: area records (with dem Float32Array); tiles: Map url -> Blob; routes: kept route records.
export function packBackup(areas, tiles, routes) {
  const parts = [], header = { version: BACKUP_VERSION, exportedAt: new Date().toISOString(), areas: [], tiles: [], routes };
  let offset = 0;
  const add = blob => { parts.push(blob); const at = offset; offset += blob.size; return { offset: at, length: blob.size }; };
  for (const a of areas) {
    const { dem, ...rest } = a;
    header.areas.push({ ...rest, dem: add(new Blob([new Uint8Array(dem.buffer, dem.byteOffset, dem.byteLength)])) });
  }
  for (const [url, blob] of tiles) header.tiles.push({ url, type: blob.type || "image/jpeg", ...add(blob) });
  const json = new TextEncoder().encode(JSON.stringify(header)), len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, json.length, true);
  return new Blob([MAGIC, len, json, ...parts], { type: "application/octet-stream" });
}

// { areas (dem restored as Float32Array), tiles: [{ url, blob }], routes } from a backup's bytes. Throws BackupError
// on anything that is not a complete backup of a version this app reads.
export function unpackBackup(buf) {
  const bytes = new Uint8Array(buf), magic = new TextDecoder().decode(bytes.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new BackupError("This is not a TerrainRoute backup file.");
  const len = new DataView(buf, MAGIC.length, 4).getUint32(0, true), start = MAGIC.length + 4;
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + len)));
  } catch (e) {
    throw new BackupError(`The backup file is damaged (${e.message}).`);
  }
  if (header.version !== BACKUP_VERSION) throw new BackupError(`Backup version ${header.version} is not supported by this app.`);
  const base = start + len, slice = ({ offset, length }) => {
    if (base + offset + length > bytes.length) throw new BackupError("The backup file is incomplete (cut off while copying?).");
    return buf.slice(base + offset, base + offset + length);
  };
  const areas = header.areas.map(({ dem, ...a }) => {
    const out = { ...a, dem: new Float32Array(slice(dem)) };
    if (out.dem.length !== a.rows * a.cols) throw new BackupError(`Area ${a.label || a.name} has the wrong amount of elevation data.`);
    return out;
  });
  const tiles = header.tiles.map(t => ({ url: t.url, blob: new Blob([slice(t)], { type: t.type }) }));
  return { areas, tiles, routes: header.routes || [], exportedAt: header.exportedAt };
}
