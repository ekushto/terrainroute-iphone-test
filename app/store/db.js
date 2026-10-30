// The app's one IndexedDB database: "areas" (prepared areas) and "routes" (kept routes). Per device, never uploaded.

const DB = "terrainroute", VERSION = 2;
const STORES = { areas: "name", routes: "id" };

export class StoreError extends Error {}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StoreError(`cannot open storage: ${req.error?.message}`));
    req.onblocked = () => reject(new StoreError("storage is in use by another TerrainRoute tab; close it and retry"));
  });
}

// Run fn(objectStore) in one transaction on `store`; resolves with fn's request result once the transaction commits.
export async function tx(store, mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = t.onabort = () => reject(new StoreError(`storage failed: ${t.error?.message || "aborted"}`));
    });
  } finally {
    db.close();
  }
}
