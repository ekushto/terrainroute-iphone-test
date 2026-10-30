// Kept routes: a route the user chose to keep stays on the map (per area) until hidden or deleted. Each record holds
// the display data and the exact geometry, so its GPX reproduces the saved line exactly.
import { tx } from "./db.js";

export const ROUTE_COLORS = ["#0F5E54", "#6D28D9", "#B45309", "#1D4ED8", "#BE185D", "#4D7C0F"];

export const listRoutes = () => tx("routes", "readonly", s => s.getAll());
export const saveRoute = rec => tx("routes", "readwrite", s => s.put(rec));
export const deleteRoute = id => tx("routes", "readwrite", s => s.delete(id));

// Delete every kept route of an area (when the area itself is deleted). Returns how many were removed.
export async function deleteRoutesOfArea(area) {
  const gone = (await listRoutes()).filter(r => r.area === area);
  for (const r of gone) await deleteRoute(r.id);
  return gone.length;
}
