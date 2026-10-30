// Page side of the background worker (worker/route-worker.js): request/response with ids, errors re-thrown here with
// the worker's error class name in `kind` so the page can tell bad input (RouteError, InputError) from a bug.

const worker = new Worker(new URL("../worker/route-worker.js", import.meta.url), { type: "module" });
const pending = new Map();
let nextId = 1;

export class EngineError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  if (data.error) p.reject(new EngineError(data.error, data.kind));
  else p.resolve(data.result);
};
worker.onerror = e => {
  for (const p of pending.values()) p.reject(new EngineError(`routing engine failed to start: ${e.message || "unknown"}`, "Error"));
  pending.clear();
};

function call(type, payload, transfer = []) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...payload }, transfer);
  });
}

// Make an area record current in the worker; returns { name, trails (GeoJSON), steep { bounds, png } }.
export const loadArea = rec => call("area", { rec });
// All three routes between [lat, lon] pins; returns { routes: [view + raw], notes }.
export const route = req => call("route", req);
// PNG bytes of a Terrarium elevation tile of the current area.
export const demTile = (z, x, y) => call("demTile", { z, x, y });
