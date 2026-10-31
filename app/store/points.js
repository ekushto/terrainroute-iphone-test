// Saved points (camp, trailhead, kill site…): a name and a [lat, lon], usable as a start or end in any area.
// Per device like everything else; they travel in the backup file.
import { tx } from "./db.js";

export const listPoints = () => tx("points", "readonly", s => s.getAll());
export const savePoint = rec => tx("points", "readwrite", s => s.put(rec));
export const deletePoint = id => tx("points", "readwrite", s => s.delete(id));

// A new point record; throws RangeError on a position that is not a real lat/lon (never store junk).
export function newPoint(name, ll) {
  const [lat, lon] = ll || [];
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new RangeError(`not a position: ${ll}`);
  return { id: `p${Date.now()}`, name: String(name || "").trim().slice(0, 40) || "Saved point", lat, lon, createdAt: new Date().toISOString() };
}
